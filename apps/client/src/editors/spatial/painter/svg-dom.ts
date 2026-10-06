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
//   sbiadisce, e cambia il `d` di un tracciato i cui nodi si spostano, senza
//   ricrearli e senza toccare la scena; l'operazione scritta
//   alla fine porta la scena nuova. Un testo che si scrive sul posto si
//   nasconde allo stesso modo. Uno strato immagine che sta tutto dentro un
//   gruppo che si sposta segue il gruppo con una trasformazione CSS, e dopo
//   l'operazione resta dove l'ha portato finché la sua immagine nuova non è
//   pronta.
// - **Isolamento:** con un gruppo isolato, `setFocus` attenua tutto ciò che
//   gli sta fuori, carta esclusa, con l'opacità degli elementi; il disegno
//   non cambia.
//
// - **Miniature:** `paintMiniature` disegna alcuni nodi della scena in un
//   `svg` a sé, con gli stessi elementi e gli stessi attributi, dentro gli
//   stili di chi li contiene: l'albero degli oggetti le mostra accanto ai
//   nomi.
//
// Tutto ciò che il painter apre (timer, osservatori, lease) appartiene alla
// sua vita, e la vita di chi lo monta la chiude.

import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { Matrix } from "../scene/matrix";
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
  /// Il `d` da mostrare al posto di quello dipinto: un tracciato i cui nodi
  /// si stanno spostando. Anche questo è il valore che si scriverà.
  readonly paths?: ReadonlyMap<PaintNode, string>;
  /// I raggi degli angoli da mostrare al posto di quelli dipinti, `rx` e
  /// `ry`: un rettangolo mentre la maniglia lo arrotonda; `null` ne toglie
  /// uno. Gli altri nomi non contano.
  readonly radii?: ReadonlyMap<PaintNode, Readonly<Record<string, string | null>>>;
  /// I nodi che la gomma sta per togliere: si vedono sbiaditi.
  readonly faded?: ReadonlySet<PaintNode>;
  /// I nodi che non si vedono: un testo mentre lo si scrive sul posto, che
  /// l'editor mostra al suo posto.
  readonly hidden?: ReadonlySet<PaintNode>;
  /// Come si spostano i contenitori che si trasformano, per chiave
  /// (`PaintGroup.key`): la trasformazione della scena da dove sono a dove
  /// si mostrano. Uno strato immagine che sta tutto dentro uno di loro la
  /// segue; dentro più d'uno, segue il più esterno.
  readonly carried?: ReadonlyMap<object, Matrix>;
  /// I contenitori che la gomma sta per togliere, per chiave: uno strato
  /// immagine che sta tutto dentro uno di loro si vede sbiadito.
  readonly fadedContainers?: ReadonlySet<object>;
}

/// Gli attributi che un'anteprima cambia, e che toglierla riporta a com'erano
/// dipinti.
const DRAFTED = ["transform", "d", "rx", "ry"] as const;

/// L'opacità di un nodo sbiadito dalla gomma.
export const FADED_OPACITY = "0.25";

/// Quanto si attenua ciò che sta fuori dal gruppo isolato: un fattore
/// dell'opacità che il nodo ha già.
export const DIMMED_OPACITY = 0.4;

export interface ScenePainter {
  /// Disegna `scene` al posto della scena precedente.
  update(scene: PaintScene): void;
  /// Mostra `draft` sopra la scena, al posto del precedente; `null` lo
  /// toglie. Vale finché non lo si cambia, anche dopo un `update`: un gruppo
  /// si ritrova dal suo contenitore, una forma che la scena nuova non
  /// contiene più resta senza anteprima.
  setDraft(draft: PainterDraft | null): void;
  /// Attenua tutto tranne ciò che sta dentro l'ultimo dei contenitori
  /// `chain`, chiavi di gruppi della scena (`PaintGroup.key`) dal più
  /// esterno al più interno: il gruppo isolato e chi lo contiene. La carta
  /// resta com'è. `null` toglie l'attenuazione. Vale finché non la si
  /// cambia, anche dopo un `update`.
  setFocus(chain: readonly object[] | null): void;
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
  /// Lo spostamento della scena con cui si mostra; `null` se nessuno.
  carried: Matrix | null;
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
  /// Lo spostamento che l'anteprima dà allo strato; `null` se nessuno.
  carried: Matrix | null;
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

  const createShape = (shape: PaintShape): NodeRecord => {
    const { el, life: imageLife } = shapeElement(shape, shape.id, options.images, null);
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

  /// Riporta un nodo a ciò che la sua scena dipinge, attenuato se sta fuori
  /// dal gruppo isolato.
  const restore = (record: NodeRecord): void => {
    for (const name of DRAFTED) {
      const painted = record.paint.attrs.find(([key]) => key === name);
      if (painted === undefined) record.el.removeAttribute(name);
      else if (record.el.getAttribute(name) !== painted[1]) record.el.setAttribute(name, painted[1]);
    }
    const dim = dimmed.get(record.el);
    if (dim === undefined) record.el.style.removeProperty("opacity");
    else record.el.style.setProperty("opacity", dim);
    record.el.style.removeProperty("visibility");
  };

  /// Gli strati immagine che l'anteprima sposta, e quelli che sbiadisce.
  let carriedImages: ImageRecord[] = [];
  let fadedImages: ImageRecord[] = [];
  /// Gli strati immagine che un'anteprima appena tolta spostava: restano
  /// dove sono finché non si sa se la scena cambia. Se la scena nuova li
  /// ridisegna, l'immagine vecchia resta spostata finché la nuova non è
  /// pronta, così niente torna indietro per un attimo; altrimenti tornano al
  /// loro posto subito dopo.
  const frozen = new Set<ImageRecord>();
  let releasing = false;

  /// Mostra lo strato `record` spostato di `matrix`, anche l'immagine in
  /// decodifica.
  const carry = (record: ImageRecord, matrix: Matrix | null): void => {
    record.carried = matrix;
    if (record.pending !== null) record.pending.carried = matrix;
    if (record.shown !== null) {
      record.shown.carried = matrix;
      position(record.shown);
    }
  };

  const releaseFrozen = (): void => {
    releasing = false;
    if (disposed) return;
    for (const record of frozen) carry(record, null);
    frozen.clear();
  };

  const clearDraft = (): void => {
    for (const record of drafted) restore(record);
    drafted = [];
    for (const record of carriedImages) {
      record.carried = null;
      frozen.add(record);
    }
    carriedImages = [];
    if (frozen.size > 0 && !releasing) {
      releasing = true;
      queueMicrotask(releaseFrozen);
    }
    for (const record of fadedImages) {
      const dim = dimmed.get(record.el);
      if (dim === undefined) record.el.style.removeProperty("opacity");
      else record.el.style.setProperty("opacity", dim);
    }
    fadedImages = [];
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
    for (const [paint, d] of draft.paths ?? []) {
      for (const record of recordsOf(paint)) {
        record.el.setAttribute("d", d);
        touched.add(record);
      }
    }
    for (const [paint, radii] of draft.radii ?? []) {
      for (const record of recordsOf(paint)) {
        for (const name of ["rx", "ry"]) {
          const value = radii[name];
          if (value === undefined) continue;
          if (value === null) record.el.removeAttribute(name);
          else record.el.setAttribute(name, value);
        }
        touched.add(record);
      }
    }
    for (const paint of draft.faded ?? []) {
      for (const record of recordsOf(paint)) {
        record.el.style.setProperty("opacity", FADED_OPACITY);
        touched.add(record);
      }
    }
    for (const paint of draft.hidden ?? []) {
      for (const record of recordsOf(paint)) {
        record.el.style.setProperty("visibility", "hidden");
        touched.add(record);
      }
    }
    drafted = [...touched];
    const { carried, fadedContainers } = draft;
    if (carried === undefined && fadedContainers === undefined) return;
    for (const record of layers) {
      if (record.kind !== "image") continue;
      const containers = record.layer.containers;
      const key = carried === undefined ? undefined : containers.find((container) => carried.has(container));
      if (key !== undefined) {
        frozen.delete(record);
        carry(record, carried!.get(key)!);
        carriedImages.push(record);
      }
      if (fadedContainers !== undefined && containers.some((container) => fadedContainers.has(container))) {
        record.el.style.setProperty("opacity", FADED_OPACITY);
        fadedImages.push(record);
      }
    }
  };

  const setDraft = (next: PainterDraft | null): void => {
    if (disposed) return;
    clearDraft();
    draft = next;
    applyDraft();
  };

  // --- isolamento ---------------------------------------------------------------

  let focus: readonly object[] | null = null;
  /// Gli elementi attenuati, con l'opacità che mostrano.
  const dimmed = new Map<HTMLElement | SVGElement, string>();

  /// Attenua `el`, che dipinge l'opacità `painted`: CSS vince
  /// sull'attributo, quindi il fattore si moltiplica qui.
  const dim = (el: HTMLElement | SVGElement, painted: string | undefined): void => {
    const value = String(Math.round(opacityOf(painted) * DIMMED_OPACITY * 1000) / 1000);
    el.style.setProperty("opacity", value);
    dimmed.set(el, value);
  };

  const clearFocus = (): void => {
    for (const el of dimmed.keys()) el.style.removeProperty("opacity");
    dimmed.clear();
  };

  const applyFocus = (): void => {
    const chain = focus;
    if (chain === null) return;
    const visit = (records: readonly NodeRecord[], depth: number): void => {
      for (const record of records) {
        const paint = record.paint;
        if (paint.kind === "group" && paint.key === chain[depth]) {
          if (depth + 1 < chain.length) visit(record.children, depth + 1);
        } else if (paint.role !== "paper") {
          dim(record.el, paint.attrs.find(([name]) => name === "opacity")?.[1]);
        }
      }
    };
    for (const layer of layers) {
      if (layer.kind === "live") visit(layer.children, 0);
      else if (!inside(layer.layer.containers, chain)) dim(layer.el, undefined);
    }
  };

  const setFocus = (chain: readonly object[] | null): void => {
    if (disposed) return;
    clearFocus();
    focus = chain === null || chain.length === 0 ? null : [...chain];
    applyFocus();
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
  /// la vista con cui è stata disegnata, portata a quella di adesso, e
  /// spostata come la scena se l'anteprima la sposta.
  const position = (rendered: Rendered): void => {
    const k = view.scale / rendered.view.scale;
    const m = rendered.carried;
    if (m === null) {
      const x = rendered.left * k + view.tx - rendered.view.tx * k;
      const y = rendered.top * k + view.ty - rendered.view.ty * k;
      rendered.img.style.transform = k === 1 ? `translate(${x}px, ${y}px)` : `matrix(${k}, 0, 0, ${k}, ${x}, ${y})`;
      return;
    }
    // Il pixel `p` dell'immagine mostra il punto (p + left - t₀) / s₀ della
    // scena, che va in `m` e poi sullo schermo con la vista di adesso.
    const [a, b, c, d, e, f] = m;
    const u = rendered.left - rendered.view.tx;
    const v = rendered.top - rendered.view.ty;
    const x = k * (a * u + c * v) + view.scale * e + view.tx;
    const y = k * (b * u + d * v) + view.scale * f + view.ty;
    rendered.img.style.transform = `matrix(${k * a}, ${k * b}, ${k * c}, ${k * d}, ${x}, ${y})`;
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
    const rendered: Rendered = { img, url, frame: target.frame, view, left: target.left, top: target.top, carried: record.carried };
    record.pending = rendered;
    img.src = url;
    const swap = (): void => {
      if (disposed || record.generation !== generation || record.pending !== rendered) return;
      record.pending = null;
      position(rendered);
      record.el.replaceWith(img);
      revoke(record.shown);
      record.shown = rendered;
      swapped(record, img);
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
      swapped(record, empty);
    };
    if (typeof img.decode === "function") img.decode().then(swap, failed);
    else swap();
  };

  /// Mette `el` al posto dell'elemento di `record`, attenuato e sbiadito
  /// come lui.
  const swapped = (record: ImageRecord, el: HTMLElement): void => {
    const dim = dimmed.get(record.el);
    if (dim !== undefined) {
      dimmed.delete(record.el);
      el.style.setProperty("opacity", dim);
      dimmed.set(el, dim);
    }
    if (fadedImages.includes(record)) el.style.setProperty("opacity", FADED_OPACITY);
    record.el = el;
  };

  const emptySlot = (): HTMLElement => {
    const slot = document.createElement("span");
    slot.className = "spatial-image-slot";
    return slot;
  };

  const createImage = (layer: ImageLayer): ImageRecord => {
    const record: ImageRecord = { kind: "image", layer, el: emptySlot(), shown: null, pending: null, generation: 0, carried: null };
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
    // L'anteprima e l'attenuazione escono prima della riconciliazione, che
    // confronta il DOM con la scena di prima, e rientrano sui nodi nuovi.
    clearDraft();
    clearFocus();
    byPaint = null;
    const generations = new Map<ImageRecord, number>();
    for (const record of frozen) generations.set(record, record.generation);
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
    applyFocus();
    applyDraft();
    // Uno strato che la scena ridisegna tiene spostata l'immagine vecchia
    // finché la nuova non la sostituisce; gli altri tornano al loro posto.
    for (const [record, generation] of generations) {
      if (frozen.delete(record) && record.generation === generation) carry(record, null);
    }
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
    carriedImages = [];
    fadedImages = [];
    frozen.clear();
    focus = null;
    dimmed.clear();
    byPaint = null;
    for (const record of layers) disposeLayer(record);
    layers = [];
    root.remove();
    life.close();
  };
  owner.add(dispose);

  return { update, setDraft, setFocus, setView, settle, dispose };
}

/// Vero se lo strato racchiuso da `containers` sta dentro l'ultimo dei
/// contenitori `chain`: `chain` comincia come `containers`.
function inside(containers: readonly object[], chain: readonly object[]): boolean {
  return chain.length <= containers.length && chain.every((key, i) => containers[i] === key);
}

/// L'opacità che un attributo `opacity` dipinge: un numero o una
/// percentuale, fra 0 e 1; 1 se manca o non si legge.
// --- forme -------------------------------------------------------------------

function setPainted(el: SVGElement, attrs: readonly PaintAttr[], previous: readonly PaintAttr[]): void {
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
}

function setCommon(el: SVGElement, id: string | null, space: string | null): void {
  if (id === null) el.removeAttribute("data-scene-id");
  else el.setAttribute("data-scene-id", id);
  if (space === null) el.removeAttributeNS(XML, "space");
  else el.setAttributeNS(XML, "xml:space", space);
}

function showVaultImage(el: SVGElement, path: string, resolve: PainterOptions["images"], imageLife: Lifetime): void {
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
}

/// L'elemento di `shape`, con `id` in `data-scene-id`: le righe di un testo,
/// l'URL di un'immagine. Un'immagine del vault lo chiede a `resolve` nella
/// vita `life`, o in una sua se è `null`; la vita che torna è quella.
function shapeElement(
  shape: PaintShape,
  id: string | null,
  resolve: PainterOptions["images"],
  life: Lifetime | null,
): { readonly el: SVGElement; readonly life: Lifetime | null } {
  const el = document.createElementNS(SVG, shape.tag);
  setPainted(el, shape.attrs, []);
  setCommon(el, id, shape.space);
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
      imageLife = life ?? openLifetime();
      showVaultImage(el, image.path, resolve, imageLife);
    }
  }
  return { el, life: imageLife };
}

// --- miniature ----------------------------------------------------------------

/// Gli attributi che nascondono: una miniatura mostra anche ciò che il
/// disegno nasconde.
const HIDING: ReadonlySet<string> = new Set(["display", "visibility"]);

/// Il riquadro che una miniatura inquadra, in unità della scena.
export interface MiniatureBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Il margine di una miniatura attorno al suo riquadro, in frazioni del lato
/// più lungo.
const MINIATURE_MARGIN = 0.06;

/// Una miniatura dei nodi `nodes`: un `svg` che inquadra `box`, con dentro un
/// `g` per ogni contenitore di `chain`, dal più esterno, che porta i suoi
/// attributi dipinti. Né i nodi né chi li contiene sono nascosti; ciò che è
/// nascosto dentro di loro sì. Nessun `data-scene-id`: la miniatura non è
/// la scena. Le immagini del vault le chiede a `resolve` nella vita `life`.
export function paintMiniature(
  nodes: readonly PaintNode[],
  chain: readonly (readonly PaintAttr[])[],
  box: MiniatureBox,
  life: Lifetime,
  resolve?: PainterOptions["images"],
): SVGSVGElement {
  const visible = (attrs: readonly PaintAttr[]): readonly PaintAttr[] => attrs.filter(([name]) => !HIDING.has(name));
  const svg = document.createElementNS(SVG, "svg");
  const pad = Math.max(box.width, box.height) * MINIATURE_MARGIN || 1;
  svg.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("focusable", "false");
  let parent: SVGElement = svg;
  for (const attrs of chain) {
    const g = document.createElementNS(SVG, "g");
    setPainted(g, visible(attrs), []);
    parent.append(g);
    parent = g;
  }
  const copy = (node: PaintNode, top: boolean): SVGElement => {
    if (node.kind === "shape") {
      const { el } = shapeElement(node, null, resolve, life);
      if (top) for (const name of HIDING) el.removeAttribute(name);
      return el;
    }
    const el = document.createElementNS(SVG, "g");
    setPainted(el, top ? visible(node.attrs) : node.attrs, []);
    setCommon(el, null, node.space);
    for (const child of node.children) el.append(copy(child, false));
    return el;
  };
  for (const node of nodes) parent.append(copy(node, true));
  return svg;
}

/// La miniatura `svg` come immagine ferma: un `img` solo al posto di tante
/// forme vive. Le immagini del vault non ci sono, perché un'immagine non ne
/// carica altre. L'URL si revoca quando si chiude `life`.
export function miniaturePicture(svg: SVGSVGElement, life: Lifetime): HTMLImageElement {
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  life.add(() => URL.revokeObjectURL(url));
  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.src = url;
  return img;
}

/// Quante forme ha `nodes`, contando fino a `limit`: oltre, `limit + 1`.
export function shapeCount(nodes: readonly PaintNode[], limit: number): number {
  let count = 0;
  const visit = (list: readonly PaintNode[]): void => {
    for (const node of list) {
      if (count > limit) return;
      if (node.kind === "shape") count++;
      else visit(node.children);
    }
  };
  visit(nodes);
  return Math.min(count, limit + 1);
}

function opacityOf(value: string | undefined): number {
  if (value === undefined) return 1;
  const text = value.trim();
  const number = text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
  return text === "" || text === "%" || !Number.isFinite(number) ? 1 : Math.min(1, Math.max(0, number));
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
