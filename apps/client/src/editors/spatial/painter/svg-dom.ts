// Il painter SVG DOM: disegna una `PaintScene` dentro un elemento della
// shell, uno strato sopra l'altro nell'ordine del documento.
//
// - **Strati vivi:** un elemento `svg` grande quanto la vista, con un `g`
//   che porta la camera. Le forme si creano con `createElementNS` e i soli
//   attributi dipinti: nessun testo della sorgente diventa DOM, nessun `id`
//   del disegno entra nel documento della shell (resta in `data-scene-id`),
//   un collegamento è un `g`. Fra un aggiornamento e l'altro si
//   riconciliano per identità: una forma che la scena ripete è lo stesso
//   nodo DOM.
// - **Strati immagine:** un `<img>` da blob, disegnato per il rettangolo della
//   vista più un margine. Mentre la camera si muove l'immagine segue con una
//   trasformazione CSS; quando si ferma si ridisegna alla nuova scala, e la
//   nuova immagine prende il posto della vecchia solo dopo la decodifica,
//   senza lampi. Ogni URL di blob si revoca quando l'immagine lascia il DOM.
// - **Immagini del vault:** un'`image` viva con un percorso del vault chiede
//   l'URL a chi monta il painter, con una vita sua che si chiude quando
//   l'elemento esce dalla scena. Un'immagine che non si risolve, e ogni URL
//   remoto, mostrano il segnaposto.
// - **Anteprima degli strumenti:** mentre si trascina una selezione o si
//   passa la gomma, `setDraft` cambia il `transform` dei nodi vivi o li
//   sbiadisce, senza ricrearli e senza toccare la scena; l'operazione scritta
//   alla fine porta la scena nuova.
//
// Tutto ciò che il painter apre (timer, osservatori, lease) appartiene alla
// sua vita, e la vita di chi lo monta la chiude.

import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import {
  IMAGE_PLACEHOLDER,
  imageDocument,
  PAINTED_ATTRIBUTES,
  type ImageFrame,
  type ImageLayer,
  type LiveLayer,
  type PaintAttr,
  type PaintGroup,
  type PaintNode,
  type PaintScene,
  type PaintShape,
} from "./paint";

const SVG = "http://www.w3.org/2000/svg";
const XML = "http://www.w3.org/XML/1998/namespace";

/// La camera come la legge il painter: punto dello schermo = punto della
/// scena × `scale` + (`tx`, `ty`), in pixel CSS dall'angolo dell'elemento.
export interface PainterView {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}

export interface PainterOptions {
  /// L'URL di un'immagine del vault, aperto nella vita che riceve: `null`
  /// se non si risolve. Senza, ogni immagine del vault è un segnaposto.
  readonly images?: (path: string, life: Lifetime) => Promise<string | null>;
  /// Dopo quanti millisecondi senza movimento gli strati immagine si
  /// ridisegnano alla vista nuova.
  readonly settleMs?: number;
}

/// Ciò che uno strumento mostra prima di scriverlo, sui nodi della scena
/// corrente: non cambia la scena, e la scena dopo non lo cancella.
export interface PainterDraft {
  /// Il `transform` da mostrare al posto di quello dipinto; `null` lo toglie.
  /// È il valore che l'operazione scriverà, così l'anteprima è il risultato.
  readonly transforms?: ReadonlyMap<PaintNode, string | null>;
  /// I nodi che la gomma sta per togliere: si vedono sbiaditi.
  readonly faded?: ReadonlySet<PaintNode>;
}

/// L'opacità di un nodo sbiadito dalla gomma.
export const FADED_OPACITY = "0.25";

export interface ScenePainter {
  /// Disegna `scene` al posto della scena precedente.
  update(scene: PaintScene): void;
  /// Mostra `draft` sopra la scena, al posto del precedente; `null` lo
  /// toglie. Vale finché non lo si cambia, anche dopo un `update`: un gruppo
  /// si ritrova dal suo contenitore, una forma che la scena nuova non
  /// contiene più resta senza anteprima.
  setDraft(draft: PainterDraft | null): void;
  /// Sposta la camera.
  setView(view: PainterView): void;
  /// Ridisegna subito gli strati immagine che ne hanno bisogno, senza
  /// aspettare che la camera stia ferma.
  settle(): void;
  /// Toglie tutto dal DOM e revoca ogni risorsa. Chiudere la vita di chi lo
  /// ha montato fa lo stesso.
  dispose(): void;
}

/// Il margine di un'immagine attorno alla vista, per lato, in frazioni della
/// vista: lo spazio che una panoramica può scoprire prima del ridisegno.
const MARGIN = 1 / 8;

const DEFAULT_SETTLE_MS = 150;

/// Una forma o un gruppo nel DOM.
interface NodeRecord {
  readonly paint: PaintNode;
  readonly el: SVGElement;
  /// La vita delle risorse di un'`image` del vault.
  readonly life: Lifetime | null;
  /// I figli di un gruppo.
  children: NodeRecord[];
}

interface LiveRecord {
  readonly kind: "live";
  layer: LiveLayer;
  readonly el: SVGSVGElement;
  readonly camera: SVGGElement;
  rootAttrs: readonly PaintAttr[];
  children: NodeRecord[];
}

/// Un'immagine decodificata, pronta o in mostra.
interface Rendered {
  readonly img: HTMLImageElement;
  readonly url: string;
  readonly frame: ImageFrame;
  /// La vista per cui è stata disegnata, e la sua posizione nell'elemento.
  readonly view: PainterView;
  readonly left: number;
  readonly top: number;
}

interface ImageRecord {
  readonly kind: "image";
  layer: ImageLayer;
  /// Il segnaposto nel DOM finché non c'è un'immagine, poi l'immagine.
  el: HTMLElement;
  shown: Rendered | null;
  /// L'immagine in decodifica, se c'è.
  pending: Rendered | null;
  /// Cresce a ogni richiesta di ridisegno: una decodifica arrivata tardi non
  /// sostituisce un'immagine più nuova.
  generation: number;
}

type LayerRecord = LiveRecord | ImageRecord;

/// Monta un painter dentro `host`.
export function createSvgPainter(host: HTMLElement, owner: Lifetime, options: PainterOptions = {}): ScenePainter {
  const life = openLifetime();
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const root = document.createElement("div");
  root.className = "spatial-painter";
  // La scena si legge dalla sua struttura accessibile, non dal disegno.
  root.setAttribute("aria-hidden", "true");
  host.append(root);

  let view: PainterView = { scale: 1, tx: 0, ty: 0 };
  let width = host.clientWidth;
  let height = host.clientHeight;
  let layers: LayerRecord[] = [];
  let disposed = false;

  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const clearSettle = (): void => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };
  life.add(clearSettle);

  // --- forme ------------------------------------------------------------------

  const setPainted = (el: SVGElement, attrs: readonly PaintAttr[], previous: readonly PaintAttr[]): void => {
    if (attrs === previous) return;
    const next = new Set<string>();
    for (const [name, value] of attrs) {
      // La scena porta solo nomi dipinti; il controllo resta qui perché è il
      // DOM a non doverne ricevere altri.
      if (!PAINTED_ATTRIBUTES.has(name)) continue;
      next.add(name);
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
    for (const [name] of previous) if (!next.has(name)) el.removeAttribute(name);
  };

  const setCommon = (el: SVGElement, id: string | null, space: string | null): void => {
    if (id === null) el.removeAttribute("data-scene-id");
    else el.setAttribute("data-scene-id", id);
    if (space === null) el.removeAttributeNS(XML, "space");
    else el.setAttributeNS(XML, "xml:space", space);
  };

  const showVaultImage = (el: SVGElement, path: string, imageLife: Lifetime): void => {
    const resolve = options.images;
    if (resolve === undefined) {
      el.setAttribute("href", IMAGE_PLACEHOLDER);
      return;
    }
    resolve(path, imageLife).then(
      (url) => {
        if (imageLife.closed) return;
        el.setAttribute("href", url ?? IMAGE_PLACEHOLDER);
      },
      () => {
        if (!imageLife.closed) el.setAttribute("href", IMAGE_PLACEHOLDER);
      },
    );
  };

  const createShape = (shape: PaintShape): NodeRecord => {
    const el = document.createElementNS(SVG, shape.tag);
    setPainted(el, shape.attrs, []);
    setCommon(el, shape.id, shape.space);
    let imageLife: Lifetime | null = null;
    if (shape.runs !== undefined) {
      for (const run of shape.runs) {
        if (run.kind === "space") {
          el.append(document.createTextNode(run.text));
          continue;
        }
        const span = document.createElementNS(SVG, "tspan");
        setPainted(span, run.attrs, []);
        if (run.space !== null) span.setAttributeNS(XML, "xml:space", run.space);
        span.textContent = run.text;
        el.append(span);
      }
    }
    const image = shape.image;
    if (image !== undefined) {
      if (image.kind === "data") {
        el.setAttribute("href", image.url);
      } else if (image.kind === "remote") {
        el.setAttribute("href", IMAGE_PLACEHOLDER);
      } else {
        imageLife = openLifetime();
        showVaultImage(el, image.path, imageLife);
      }
    }
    return { paint: shape, el, life: imageLife, children: [] };
  };

  const createGroup = (group: PaintGroup): NodeRecord => {
    const el = document.createElementNS(SVG, "g");
    setPainted(el, group.attrs, []);
    setCommon(el, group.id, group.space);
    const record: NodeRecord = { paint: group, el, life: null, children: [] };
    record.children = reconcile(el, [], group.children);
    return record;
  };

  const updateGroup = (record: NodeRecord, group: PaintGroup): NodeRecord => {
    const previous = record.paint as PaintGroup;
    setPainted(record.el, group.attrs, previous.attrs);
    if (group.id !== previous.id || group.space !== previous.space) setCommon(record.el, group.id, group.space);
    const children = reconcile(record.el, record.children, group.children);
    return { paint: group, el: record.el, life: null, children };
  };

  const disposeNode = (record: NodeRecord): void => {
    record.life?.close();
    for (const child of record.children) disposeNode(child);
  };

  /// Porta i figli di `parent` da `previous` a `next`, riusando ciò che
  /// resta: prima gli oggetti identici, poi i gruppi dello stesso
  /// contenitore.
  function reconcile(parent: SVGElement, previous: readonly NodeRecord[], next: readonly PaintNode[]): NodeRecord[] {
    const byPaint = new Map<PaintNode, NodeRecord[]>();
    const byKey = new Map<object, NodeRecord[]>();
    for (const record of previous) {
      push(byPaint, record.paint, record);
      if (record.paint.kind === "group") push(byKey, record.paint.key, record);
    }
    const used = new Set<NodeRecord>();
    const take = (pool: Map<object, NodeRecord[]>, key: object): NodeRecord | undefined => {
      const list = pool.get(key);
      while (list !== undefined && list.length > 0) {
        const record = list.shift()!;
        if (!used.has(record)) return record;
      }
      return undefined;
    };
    const out: Array<NodeRecord | null> = next.map((node) => {
      const same = take(byPaint, node);
      if (same !== undefined) {
        used.add(same);
        return same;
      }
      return null;
    });
    for (let i = 0; i < next.length; i++) {
      if (out[i] !== null) continue;
      const node = next[i]!;
      if (node.kind === "group") {
        const similar = take(byKey, node.key);
        if (similar !== undefined) {
          used.add(similar);
          out[i] = updateGroup(similar, node);
          continue;
        }
        out[i] = createGroup(node);
      } else {
        out[i] = createShape(node);
      }
    }
    for (const record of previous) {
      if (used.has(record)) continue;
      record.el.remove();
      disposeNode(record);
    }
    const records = out as NodeRecord[];
    place(parent, records.map((record) => record.el));
    return records;
  }

  // --- anteprima degli strumenti -------------------------------------------------

  let draft: PainterDraft | null = null;
  /// I nodi che mostrano l'anteprima, da riportare alla scena.
  let drafted: NodeRecord[] = [];
  /// I nodi del DOM per nodo della scena, e quelli dei gruppi per
  /// contenitore: ricostruiti solo quando servono.
  let byPaint: { readonly paints: Map<PaintNode, NodeRecord[]>; readonly keys: Map<object, NodeRecord[]> } | null = null;

  const indexRecords = (): NonNullable<typeof byPaint> => {
    if (byPaint !== null) return byPaint;
    const index = { paints: new Map<PaintNode, NodeRecord[]>(), keys: new Map<object, NodeRecord[]>() };
    const add = (record: NodeRecord): void => {
      push(index.paints, record.paint, record);
      if (record.paint.kind === "group") push(index.keys, record.paint.key, record);
      for (const child of record.children) add(child);
    };
    for (const layer of layers) if (layer.kind === "live") for (const record of layer.children) add(record);
    byPaint = index;
    return index;
  };

  /// I nodi del DOM di `paint`. Un gruppo si ritrova anche dal suo
  /// contenitore: un figlio cambiato da un'altra superficie fa un gruppo
  /// nuovo, e l'anteprima non deve sparire a metà di un trascinamento.
  const recordsOf = (paint: PaintNode): readonly NodeRecord[] => {
    const index = indexRecords();
    const same = index.paints.get(paint);
    if (same !== undefined) return same;
    return paint.kind === "group" ? index.keys.get(paint.key) ?? [] : [];
  };

  /// Riporta un nodo a ciò che la sua scena dipinge.
  const restore = (record: NodeRecord): void => {
    const painted = record.paint.attrs.find(([name]) => name === "transform");
    if (painted === undefined) record.el.removeAttribute("transform");
    else if (record.el.getAttribute("transform") !== painted[1]) record.el.setAttribute("transform", painted[1]);
    record.el.style.removeProperty("opacity");
  };

  const clearDraft = (): void => {
    for (const record of drafted) restore(record);
    drafted = [];
  };

  const applyDraft = (): void => {
    if (draft === null) return;
    const touched = new Set<NodeRecord>();
    for (const [paint, transform] of draft.transforms ?? []) {
      for (const record of recordsOf(paint)) {
        if (transform === null) record.el.removeAttribute("transform");
        else record.el.setAttribute("transform", transform);
        touched.add(record);
      }
    }
    for (const paint of draft.faded ?? []) {
      for (const record of recordsOf(paint)) {
        record.el.style.setProperty("opacity", FADED_OPACITY);
        touched.add(record);
      }
    }
    drafted = [...touched];
  };

  const setDraft = (next: PainterDraft | null): void => {
    if (disposed) return;
    clearDraft();
    draft = next;
    applyDraft();
  };

  // --- strati vivi ------------------------------------------------------------

  const cameraTransform = (): string => `matrix(${view.scale} 0 0 ${view.scale} ${view.tx} ${view.ty})`;

  const createLive = (layer: LiveLayer, rootAttrs: readonly PaintAttr[]): LiveRecord => {
    const el = document.createElementNS(SVG, "svg");
    el.setAttribute("class", "spatial-layer");
    const camera = document.createElementNS(SVG, "g");
    camera.setAttribute("transform", cameraTransform());
    setPainted(camera, rootAttrs, []);
    el.append(camera);
    const record: LiveRecord = { kind: "live", layer, el, camera, rootAttrs, children: [] };
    record.children = reconcile(camera, [], layer.nodes);
    return record;
  };

  const updateLive = (record: LiveRecord, layer: LiveLayer, rootAttrs: readonly PaintAttr[]): void => {
    if (rootAttrs !== record.rootAttrs) {
      // Il trasforma della camera non è fra gli attributi della radice.
      setPainted(record.camera, rootAttrs, record.rootAttrs);
      record.rootAttrs = rootAttrs;
    }
    if (layer === record.layer) return;
    record.children = reconcile(record.camera, record.children, layer.nodes);
    record.layer = layer;
  };

  const disposeLive = (record: LiveRecord): void => {
    for (const child of record.children) disposeNode(child);
  };

  // --- strati immagine ----------------------------------------------------------

  /// Il rettangolo che un'immagine copre per la vista corrente.
  const frameNow = (): { frame: ImageFrame; left: number; top: number } | null => {
    if (width <= 0 || height <= 0 || !(view.scale > 0)) return null;
    const left = -Math.round(width * MARGIN);
    const top = -Math.round(height * MARGIN);
    const pixelWidth = width - 2 * left;
    const pixelHeight = height - 2 * top;
    return {
      left,
      top,
      frame: {
        x: (left - view.tx) / view.scale,
        y: (top - view.ty) / view.scale,
        width: pixelWidth / view.scale,
        height: pixelHeight / view.scale,
        pixelWidth,
        pixelHeight,
      },
    };
  };

  /// Vero se l'immagine mostrata va ridisegnata per la vista corrente: la
  /// scala è cambiata, o la vista ha consumato più di metà del margine.
  const stale = (record: ImageRecord): boolean => {
    const shown = record.pending ?? record.shown;
    if (shown === null) return true;
    if (shown.view.scale !== view.scale) return true;
    const dx = view.tx - shown.view.tx;
    const dy = view.ty - shown.view.ty;
    const slackX = -shown.left / 2;
    const slackY = -shown.top / 2;
    return Math.abs(dx) > slackX || Math.abs(dy) > slackY
      || shown.frame.pixelWidth !== width - 2 * shown.left || shown.frame.pixelHeight !== height - 2 * shown.top;
  };

  /// Mette `rendered` dove sta per la vista corrente: la sua posizione per
  /// la vista con cui è stata disegnata, portata a quella di adesso.
  const position = (rendered: Rendered): void => {
    const k = view.scale / rendered.view.scale;
    const x = rendered.left * k + view.tx - rendered.view.tx * k;
    const y = rendered.top * k + view.ty - rendered.view.ty * k;
    rendered.img.style.transform = k === 1 ? `translate(${x}px, ${y}px)` : `matrix(${k}, 0, 0, ${k}, ${x}, ${y})`;
  };

  const revoke = (rendered: Rendered | null): void => {
    if (rendered !== null) URL.revokeObjectURL(rendered.url);
  };

  const render = (record: ImageRecord): void => {
    const target = frameNow();
    if (target === null) return;
    const generation = ++record.generation;
    revoke(record.pending);
    record.pending = null;
    const blob = new Blob([imageDocument(record.layer, target.frame)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.className = "spatial-image";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.decoding = "async";
    img.draggable = false;
    img.width = target.frame.pixelWidth;
    img.height = target.frame.pixelHeight;
    img.style.width = `${target.frame.pixelWidth}px`;
    img.style.height = `${target.frame.pixelHeight}px`;
    const rendered: Rendered = { img, url, frame: target.frame, view, left: target.left, top: target.top };
    record.pending = rendered;
    img.src = url;
    const swap = (): void => {
      if (disposed || record.generation !== generation || record.pending !== rendered) return;
      record.pending = null;
      position(rendered);
      record.el.replaceWith(img);
      revoke(record.shown);
      record.shown = rendered;
      record.el = img;
    };
    const failed = (): void => {
      if (disposed || record.generation !== generation || record.pending !== rendered) return;
      // Un documento che il browser non disegna: lo strato resta vuoto, e
      // l'immagine precedente non resta a mentire.
      record.pending = null;
      revoke(rendered);
      const empty = emptySlot();
      record.el.replaceWith(empty);
      revoke(record.shown);
      record.shown = null;
      record.el = empty;
    };
    if (typeof img.decode === "function") img.decode().then(swap, failed);
    else swap();
  };

  const emptySlot = (): HTMLElement => {
    const slot = document.createElement("span");
    slot.className = "spatial-image-slot";
    return slot;
  };

  const createImage = (layer: ImageLayer): ImageRecord => {
    const record: ImageRecord = { kind: "image", layer, el: emptySlot(), shown: null, pending: null, generation: 0 };
    render(record);
    return record;
  };

  const updateImage = (record: ImageRecord, layer: ImageLayer): void => {
    if (layer.key === record.layer.key) {
      record.layer = layer;
      return;
    }
    record.layer = layer;
    render(record);
  };

  const disposeImage = (record: ImageRecord): void => {
    record.generation++;
    revoke(record.pending);
    revoke(record.shown);
    record.pending = null;
    record.shown = null;
  };

  // --- strati -------------------------------------------------------------------

  const disposeLayer = (record: LayerRecord): void => {
    record.el.remove();
    if (record.kind === "live") disposeLive(record);
    else disposeImage(record);
  };

  const update = (scene: PaintScene): void => {
    if (disposed) return;
    // L'anteprima esce prima della riconciliazione, che confronta il DOM
    // con la scena di prima, e rientra sui nodi nuovi.
    clearDraft();
    byPaint = null;
    const rootAttrs = scene.root.attrs;
    const lives = layers.filter((r): r is LiveRecord => r.kind === "live");
    const images = layers.filter((r): r is ImageRecord => r.kind === "image");
    const used = new Set<LayerRecord>();
    // Prima le corrispondenze esatte: uno strato vivo identico, un'immagine
    // con la stessa chiave.
    const out: Array<LayerRecord | null> = scene.layers.map((layer) => {
      const match = layer.kind === "live"
        ? lives.find((r) => r.layer === layer && !used.has(r))
        : images.find((r) => r.layer.key === layer.key && !used.has(r));
      if (match !== undefined) used.add(match);
      return match ?? null;
    });
    // Poi, nell'ordine, gli strati dello stesso tipo che restano: un vivo si
    // riconcilia, un'immagine si ridisegna nel posto della vecchia.
    for (let i = 0; i < scene.layers.length; i++) {
      const layer = scene.layers[i]!;
      const current = out[i];
      if (current !== null && current !== undefined) {
        if (current.kind === "live" && layer.kind === "live") updateLive(current, layer, rootAttrs);
        else if (current.kind === "image" && layer.kind === "image") current.layer = layer;
        continue;
      }
      if (layer.kind === "live") {
        const reuse = lives.find((r) => !used.has(r));
        if (reuse !== undefined) {
          used.add(reuse);
          updateLive(reuse, layer, rootAttrs);
          out[i] = reuse;
        } else {
          out[i] = createLive(layer, rootAttrs);
        }
      } else {
        const reuse = images.find((r) => !used.has(r));
        if (reuse !== undefined) {
          used.add(reuse);
          updateImage(reuse, layer);
          out[i] = reuse;
        } else {
          out[i] = createImage(layer);
        }
      }
    }
    for (const record of layers) if (!used.has(record)) disposeLayer(record);
    layers = out as LayerRecord[];
    place(root, layers.map((record) => record.el));
    applyDraft();
  };

  // --- vista ----------------------------------------------------------------------

  const settle = (): void => {
    clearSettle();
    if (disposed) return;
    for (const record of layers) if (record.kind === "image" && stale(record)) render(record);
  };

  const setView = (next: PainterView): void => {
    if (disposed) return;
    if (next.scale === view.scale && next.tx === view.tx && next.ty === view.ty) return;
    view = { scale: next.scale, tx: next.tx, ty: next.ty };
    const transform = cameraTransform();
    for (const record of layers) {
      if (record.kind === "live") record.camera.setAttribute("transform", transform);
      else if (record.shown !== null) position(record.shown);
    }
    clearSettle();
    settleTimer = setTimeout(settle, settleMs);
  };

  if (typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = host.clientWidth;
      const nextHeight = host.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      settle();
    });
    resizeObserver.observe(host);
    life.add(() => resizeObserver.disconnect());
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    draft = null;
    drafted = [];
    byPaint = null;
    for (const record of layers) disposeLayer(record);
    layers = [];
    root.remove();
    life.close();
  };
  owner.add(dispose);

  return { update, setDraft, setView, settle, dispose };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/// Mette i figli di `parent` nell'ordine di `children`, spostando solo
/// quelli fuori posto. `children` contiene tutti i figli che restano.
function place(parent: Element, children: readonly Element[]): void {
  let cursor = parent.firstChild;
  for (const child of children) {
    if (child === cursor) {
      cursor = cursor.nextSibling;
      continue;
    }
    parent.insertBefore(child, cursor);
  }
}
