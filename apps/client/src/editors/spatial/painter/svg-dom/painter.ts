// Il painter SVG DOM: `createSvgPainter`, una chiusura sola con lo stato di
// una superficie, i suoi strati vivi e immagine, le risorse, i simboli, la
// camera e l'anteprima degli strumenti (`../svg-dom.ts`).

import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { compose, invert, type Matrix } from "../../scene/matrix";
import type { Elem } from "../../scene/serialize";
import { toScene, viewMatrix, viewTransform } from "../../view";
import { fubLiveFamily } from "../../fonts/faces";
import { layerText, namesVault } from "../../fonts/vault";
import {
  imageDocument,
  type ImageFrame,
  type ImageLayer,
  type LiveLayer,
  type PaintAttr,
  type PaintGroup,
  type PaintNode,
  type PaintResource,
  type PaintScene,
  type PaintShape,
} from "../paint";
import {
  type CropCover,
  CROPPED_OPACITY,
  DEFAULT_SETTLE_MS,
  type DefsRecord,
  DIMMED_OPACITY,
  DRAFTED,
  drawn,
  FADED_OPACITY,
  type ImageRecord,
  LARGE_CARRY,
  LARGE_MARGIN,
  LARGE_SCENE_SHAPES,
  type LayerRecord,
  type LiveDom,
  liveId,
  type LiveRecord,
  MARGIN,
  type NodeRecord,
  outlineSheet,
  type PainterDraft,
  type PainterOptions,
  type PainterView,
  PAINTING,
  refreshFamilies,
  type Rendered,
  type ScenePainter,
  setRootFamily,
  SHAPE_GEOMETRY,
  SVG,
} from "./base";
import { copiesOf, defElement, inside, opacityOf, paintDefOf, place, push, resourceElement, setCommon, setPainted, setSymbol, shapeCount, shapeElement } from "./elements";

/// Quante superfici si sono disegnate: ognuna ha il suo prefisso per gli id
/// delle risorse.
let surfaces = 0;

export function createSvgPainter(host: HTMLElement, owner: Lifetime, options: PainterOptions = {}): ScenePainter {
  const life = openLifetime();
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const prefix = `fubdraw${++surfaces}-`;
  const dom: LiveDom = { prefix, family: options.families?.live ?? fubLiveFamily };
  const root = document.createElement("div");
  root.className = "spatial-painter";
  // La scena si legge dalla sua struttura accessibile, non dal disegno.
  root.setAttribute("aria-hidden", "true");
  host.append(root);

  /// La vista in cui gli strati sono disegnati, e quella che la camera
  /// chiede: in una scena grande la seconda corre avanti mentre la camera si
  /// muove, e la radice porta gli strati dalla prima alla seconda.
  let view: PainterView = { scale: 1, angle: 0, tx: 0, ty: 0 };
  let wanted: PainterView = view;
  /// La scena ha almeno [`LARGE_SCENE_SHAPES`] forme vive.
  let large = false;
  /// La radice porta gli strati verso la vista che la camera chiede.
  let carrying = false;
  let width = host.clientWidth;
  let height = host.clientHeight;
  /// Il margine dipinto attorno alla vista in una scena grande, in pixel:
  /// [`LARGE_MARGIN`] dove il browser conosce `overflow-clip-margin`;
  /// altrimenti la radice taglia sul suo bordo, e il margine è nullo.
  let margin = 0;
  const clipMargin = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("overflow-clip-margin", "1px");
  let layers: LayerRecord[] = [];
  let defs: DefsRecord | null = null;
  let disposed = false;
  /// Gli originali delle copie vive, e gli elementi a cui il painter ha dato
  /// il loro id vivo.
  let originals: ReadonlySet<string> = new Set();
  const anchors = new Set<SVGElement>();
  const anchor = (el: SVGElement, id: string | null): void => {
    if (id === null || !originals.has(id)) return;
    el.setAttribute("id", liveId(dom.prefix, id));
    anchors.add(el);
  };

  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const clearSettle = (): void => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };
  life.add(clearSettle);
  if (options.families !== undefined) {
    life.add(options.families.watch(() => {
      refreshFamilies(root, dom);
      // Gli strati immagine coi testi nelle famiglie del vault si ridisegnano
      // col foglio nuovo.
      for (const record of layers) if (record.kind === "image" && namesVault(record.layer)) render(record);
    }));
  }

  // --- forme ------------------------------------------------------------------

  const createShape = (shape: PaintShape): NodeRecord => {
    const { el, life: imageLife } = shapeElement(shape, shape.id, dom, options.images, null);
    anchor(el, shape.id);
    return { paint: shape, el, life: imageLife, children: [] };
  };

  const createGroup = (group: PaintGroup): NodeRecord => {
    const el = document.createElementNS(SVG, group.role === "symbol" ? "symbol" : "g");
    setPainted(el, group.attrs, [], dom);
    setCommon(el, group.id, group.space);
    if (group.role === "symbol") setSymbol(el, group.id!, dom);
    else anchor(el, group.id);
    const record: NodeRecord = { paint: group, el, life: null, children: [] };
    record.children = reconcile(el, [], group.children);
    return record;
  };

  const updateGroup = (record: NodeRecord, group: PaintGroup): NodeRecord => {
    const previous = record.paint as PaintGroup;
    setPainted(record.el, group.attrs, previous.attrs, dom);
    if (group.id !== previous.id || group.space !== previous.space) setCommon(record.el, group.id, group.space);
    if (group.role === "symbol" && group.id !== previous.id) setSymbol(record.el, group.id!, dom);
    const children = reconcile(record.el, record.children, group.children);
    return { paint: group, el: record.el, life: null, children };
  };

  const disposeNode = (record: NodeRecord): void => {
    record.life?.close();
    anchors.delete(record.el);
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
  /// Le immagini coperte da un ricalco, che si mostrano con l'anteprima.
  let covers: ReadonlyMap<PaintNode, Elem> | null = null;
  /// Le immagini che si ritagliano.
  let crops: ReadonlyMap<PaintNode, CropCover> | null = null;
  /// I nodi che mostrano l'anteprima, da riportare alla scena.
  let drafted: NodeRecord[] = [];
  /// I `path` e i gruppi che l'anteprima mostra al posto delle forme.
  let standIns: Element[] = [];
  /// Le risorse a cui l'anteprima ha cambiato il `d`, con quello di prima.
  let retraced: Array<readonly [Element, string | null]> = [];
  /// I pezzi di un testo col loro colore a cui l'anteprima ha dato quello
  /// del testo, con l'attributo.
  let repainted: Array<readonly [Element, "fill" | "stroke"]> = [];
  /// La `defs` delle sfumature e dei ritagli dell'anteprima, finché ne
  /// mostra.
  let draftDefs: SVGSVGElement | null = null;
  let draftIds = 0;

  /// Mette `elem` nella `defs` dell'anteprima, con un id nuovo; `null` se
  /// non è una risorsa che il painter dipinge.
  const draftResource = (elem: Elem): SVGElement | null => {
    const el = defElement(paintDefOf(elem), null, dom);
    return el === null ? null : draftDef(el);
  };

  /// Mette la risorsa `el` nella `defs` dell'anteprima, con un id nuovo.
  const draftDef = (el: SVGElement): SVGElement => {
    el.setAttribute("id", `${prefix}draft-${++draftIds}`);
    if (draftDefs === null) {
      draftDefs = document.createElementNS(SVG, "svg");
      draftDefs.setAttribute("class", "spatial-layer spatial-defs");
      draftDefs.append(document.createElementNS(SVG, "defs"));
      root.append(draftDefs);
    }
    draftDefs.firstElementChild!.append(el);
    return el;
  };
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
    // Il contenuto dei simboli: un'anteprima lì si vede in ogni istanza.
    for (const record of defs?.symbolRecords ?? []) add(record);
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
    record.el.style.removeProperty("stroke");
    record.el.style.removeProperty("fill");
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
    for (const record of drafted) {
      restore(record);
      copiesOf.delete(record.el);
    }
    drafted = [];
    for (const stand of standIns) stand.remove();
    standIns = [];
    for (const [el, d] of retraced) {
      if (d === null) el.removeAttribute("d");
      else el.setAttribute("d", d);
    }
    retraced = [];
    for (const [el, name] of repainted) (el as SVGElement).style.removeProperty(name);
    repainted = [];
    draftDefs?.remove();
    draftDefs = null;
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
    if (draft === null && covers === null && crops === null) return;
    const touched = new Set<NodeRecord>();
    for (const [paint, transform] of draft?.transforms ?? []) {
      for (const record of recordsOf(paint)) {
        if (transform === null) record.el.removeAttribute("transform");
        else record.el.setAttribute("transform", transform);
        touched.add(record);
      }
    }
    for (const [paint, d] of draft?.paths ?? []) {
      for (const record of recordsOf(paint)) {
        touched.add(record);
        if (record.el.localName === "path") {
          record.el.setAttribute("d", d);
          continue;
        }
        const stand = record.el.ownerDocument.createElementNS(SVG, "path");
        for (const { name, value } of [...record.el.attributes]) if (name !== "id" && !name.startsWith("data-") && !SHAPE_GEOMETRY.has(name)) stand.setAttribute(name, value);
        stand.setAttribute("d", d);
        record.el.after(stand);
        record.el.style.setProperty("visibility", "hidden");
        standIns.push(stand);
      }
    }
    for (const [paint, radii] of draft?.radii ?? []) {
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
    for (const [paint, attrs] of draft?.strokes ?? []) {
      for (const record of recordsOf(paint)) {
        touched.add(record);
        const stand = record.el.ownerDocument.createElementNS(SVG, "path");
        for (const { name, value } of [...record.el.attributes]) {
          if (name !== "id" && !name.startsWith("data-") && !SHAPE_GEOMETRY.has(name) && !PAINTING.test(name)) stand.setAttribute(name, value);
        }
        // La pittura nello stile in linea, che vale più dei fogli di stile
        // del disegno.
        for (const [name, value] of Object.entries(attrs)) {
          if (name === "d") stand.setAttribute(name, value);
          else stand.style.setProperty(name, value);
        }
        stand.style.setProperty("stroke", "none");
        record.el.style.setProperty("stroke", "none");
        record.el.after(stand);
        standIns.push(stand);
      }
    }
    for (const paint of draft?.faded ?? []) {
      for (const record of recordsOf(paint)) {
        record.el.style.setProperty("opacity", FADED_OPACITY);
        touched.add(record);
      }
    }
    for (const paint of draft?.hidden ?? []) {
      for (const record of recordsOf(paint)) {
        record.el.style.setProperty("visibility", "hidden");
        touched.add(record);
      }
    }
    for (const [paint, channels] of draft?.paints ?? []) {
      const records = recordsOf(paint);
      if (records.length === 0) continue;
      for (const name of ["fill", "stroke"] as const) {
        const value = channels[name];
        if (value === undefined) continue;
        const shown = typeof value === "string" ? value : draftResource(value)?.id;
        if (shown === undefined) continue;
        const css = typeof value === "string" ? shown : `url(#${shown})`;
        for (const record of records) {
          record.el.style.setProperty(name, css);
          touched.add(record);
          // I pezzi di un testo col loro colore prendono quello del testo,
          // come quando il cambio si scrive.
          if (record.el.localName !== "text") continue;
          for (const piece of record.el.querySelectorAll<SVGElement>(`[${name}]`)) {
            piece.style.setProperty(name, css);
            repainted.push([piece, name]);
          }
        }
      }
    }
    for (const [paint, elem] of [...(covers ?? []), ...(draft?.replaced ?? [])]) {
      for (const record of recordsOf(paint)) {
        const stand = drawn(record.el.ownerDocument, elem, dom);
        const transform = record.el.getAttribute("transform");
        if (transform === null) stand.removeAttribute("transform");
        else stand.setAttribute("transform", transform);
        record.el.after(stand);
        record.el.style.setProperty("visibility", "hidden");
        standIns.push(stand);
        touched.add(record);
      }
    }
    for (const [paint, crop] of crops ?? []) {
      for (const record of recordsOf(paint)) {
        if (record.el.localName !== "image") continue;
        const [whole, kept] = croppedStands(record.el, crop);
        record.el.after(whole, kept);
        record.el.style.setProperty("visibility", "hidden");
        standIns.push(whole, kept);
        touched.add(record);
      }
    }
    drafted = [...touched];
    if (draft === null) return;
    for (const [id, d] of draft.tracks ?? []) {
      const resource = defs?.resources.find((each) => each.id === id);
      const el = resource === undefined ? undefined : defs!.nodes.get(resource);
      if (el?.localName !== "path") continue;
      retraced.push([el, el.getAttribute("d")]);
      el.setAttribute("d", d);
    }
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

  const setCovers = (next: ReadonlyMap<PaintNode, Elem> | null): void => {
    if (disposed) return;
    clearDraft();
    covers = next;
    applyDraft();
  };

  /// L'immagine `el` come la mostra il ritaglio `crop`: una copia intera,
  /// in un gruppo attenuato, e una copia ritagliata sopra, con un
  /// `clipPath` nella `defs` dell'anteprima. Le copie hanno l'URL che
  /// l'immagine mostra già, e nessun id della scena; se l'URL arriva dopo,
  /// lo prendono quando arriva.
  const croppedStands = (el: SVGElement, crop: CropCover): readonly [Element, Element] => {
    const { box, rect } = crop;
    const copies = new Set<Element>();
    copiesOf.set(el, copies);
    const copy = (): SVGElement => {
      const image = el.cloneNode(false) as SVGElement;
      copies.add(image);
      image.removeAttribute("data-scene-id");
      image.removeAttribute("clip-path");
      image.removeAttribute("mask");
      image.style.removeProperty("visibility");
      image.setAttribute("x", String(box.min[0]));
      image.setAttribute("y", String(box.min[1]));
      image.setAttribute("width", String(box.max[0] - box.min[0]));
      image.setAttribute("height", String(box.max[1] - box.min[1]));
      return image;
    };
    const whole = document.createElementNS(SVG, "g");
    whole.style.setProperty("opacity", CROPPED_OPACITY);
    whole.append(copy());
    const kept = copy();
    const clip = document.createElementNS(SVG, "clipPath");
    const shape = document.createElementNS(SVG, "rect");
    shape.setAttribute("x", String(rect.min[0]));
    shape.setAttribute("y", String(rect.min[1]));
    shape.setAttribute("width", String(rect.max[0] - rect.min[0]));
    shape.setAttribute("height", String(rect.max[1] - rect.min[1]));
    clip.append(shape);
    draftDef(clip);
    kept.setAttribute("clip-path", `url(#${clip.id})`);
    return [whole, kept];
  };

  const setCrops = (next: ReadonlyMap<PaintNode, CropCover> | null): void => {
    if (disposed) return;
    clearDraft();
    crops = next;
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
        } else if (paint === chain[depth] && depth === chain.length - 1) {
          // L'istanza da cui si modifica il simbolo isolato.
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

  const cameraTransform = (): string => viewTransform(view);

  const createLive = (layer: LiveLayer, rootAttrs: readonly PaintAttr[]): LiveRecord => {
    const el = document.createElementNS(SVG, "svg");
    el.setAttribute("class", "spatial-layer");
    const camera = document.createElementNS(SVG, "g");
    camera.setAttribute("transform", cameraTransform());
    setPainted(camera, rootAttrs, [], dom);
    setRootFamily(camera, rootAttrs, dom);
    el.append(camera);
    const record: LiveRecord = { kind: "live", layer, el, camera, rootAttrs, children: [] };
    record.children = reconcile(camera, [], layer.nodes);
    return record;
  };

  const updateLive = (record: LiveRecord, layer: LiveLayer, rootAttrs: readonly PaintAttr[]): void => {
    if (rootAttrs !== record.rootAttrs) {
      // Il trasforma della camera non è fra gli attributi della radice.
      setPainted(record.camera, rootAttrs, record.rootAttrs, dom);
      setRootFamily(record.camera, rootAttrs, dom);
      record.rootAttrs = rootAttrs;
    }
    if (layer === record.layer) return;
    record.children = reconcile(record.camera, record.children, layer.nodes);
    record.layer = layer;
  };

  const disposeLive = (record: LiveRecord): void => {
    for (const child of record.children) disposeNode(child);
  };

  const disposeDefs = (record: DefsRecord): void => {
    record.el.remove();
    for (const child of record.symbolRecords) disposeNode(child);
  };

  // --- risorse ---------------------------------------------------------------

  /// Porta la `defs` viva a `resources` e a `symbols`: una risorsa che
  /// resta è lo stesso nodo, una nuova o cambiata si crea, e i simboli si
  /// riconciliano come uno strato vivo. Senza risorse né simboli la `defs`
  /// esce.
  const updateDefs = (resources: readonly PaintResource[], symbols: readonly PaintGroup[], rootAttrs: readonly PaintAttr[]): void => {
    if (resources.length === 0 && symbols.length === 0) {
      if (defs !== null) disposeDefs(defs);
      defs = null;
      return;
    }
    if (defs === null) {
      const el = document.createElementNS(SVG, "svg");
      el.setAttribute("class", "spatial-layer spatial-defs");
      const element = document.createElementNS(SVG, "defs");
      const symbolDefs = document.createElementNS(SVG, "defs");
      el.append(element, symbolDefs);
      defs = { el, defs: element, resources: [], nodes: new Map(), rootAttrs: [], symbolDefs, symbols: [], symbolRecords: [] };
      setRootFamily(element, [], dom);
    }
    if (symbols !== defs.symbols) {
      defs.symbolRecords = reconcile(defs.symbolDefs, defs.symbolRecords, symbols);
      defs.symbols = symbols;
    }
    if (rootAttrs !== defs.rootAttrs) {
      setPainted(defs.defs, rootAttrs, defs.rootAttrs, dom);
      setRootFamily(defs.defs, rootAttrs, dom);
      defs.rootAttrs = rootAttrs;
    }
    if (resources === defs.resources) return;
    const kept = new Set(resources);
    // Prima escono le risorse che non ci sono più: l'id di una che cambia
    // passa alla nuova, e non deve trovare la vecchia.
    for (const [resource, el] of defs.nodes) if (!kept.has(resource)) el.remove();
    const nodes = new Map<PaintResource, SVGElement>();
    for (const resource of resources) {
      const el = defs.nodes.get(resource) ?? nodes.get(resource) ?? resourceElement(resource, dom);
      if (el !== null) nodes.set(resource, el);
    }
    place(defs.defs, [...nodes.values()]);
    defs.nodes = nodes;
    defs.resources = resources;
  };

  // --- strati immagine ----------------------------------------------------------

  /// Il rettangolo che un'immagine copre per la vista corrente.
  const frameNow = (): { frame: ImageFrame; left: number; top: number } | null => {
    if (width <= 0 || height <= 0 || !(view.scale > 0)) return null;
    const left = -Math.round(width * MARGIN);
    const top = -Math.round(height * MARGIN);
    const pixelWidth = width - 2 * left;
    const pixelHeight = height - 2 * top;
    if (view.angle !== 0) {
      // Girata, l'immagine copre lo stesso rettangolo dello schermo, e il
      // suo angolo in alto a sinistra è un punto della scena.
      const [x, y] = toScene(view, [left, top]);
      const frame = { x, y, width: pixelWidth / view.scale, height: pixelHeight / view.scale, pixelWidth, pixelHeight, angle: view.angle };
      return { left, top, frame };
    }
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
    if (shown.view.scale !== view.scale || shown.view.angle !== view.angle) return true;
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
    if (view.angle !== 0 || rendered.view.angle !== 0) {
      turned(rendered);
      return;
    }
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

  /// `position` quando una delle due viste è girata: il pixel `p`
  /// dell'immagine è il punto `p + (left, top)` dello schermo della vista con
  /// cui è stata disegnata; da lì torna nella scena, segue lo spostamento
  /// dell'anteprima e va sullo schermo con la vista di adesso.
  const turned = (rendered: Rendered): void => {
    if (rendered.carried === null && rendered.view.scale === view.scale && rendered.view.angle === view.angle) {
      // Allo stesso angolo e alla stessa scala la vista si è solo spostata:
      // l'immagine resta sui pixel interi, senza il rumore dei conti.
      const x = rendered.left + view.tx - rendered.view.tx;
      const y = rendered.top + view.ty - rendered.view.ty;
      rendered.img.style.transform = `translate(${x}px, ${y}px)`;
      return;
    }
    const back = invert(viewMatrix(rendered.view));
    if (back === null) return;
    const shown = compose(back, [1, 0, 0, 1, rendered.left, rendered.top]);
    const moved = rendered.carried === null ? shown : compose(rendered.carried, shown);
    const [a, b, c, d, e, f] = compose(viewMatrix(view), moved);
    rendered.img.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
  };

  const revoke = (rendered: Rendered | null): void => {
    if (rendered !== null) URL.revokeObjectURL(rendered.url);
  };

  /// Il foglio dei caratteri che lo strato di `record` nomina, se sono già
  /// letti. Altrimenti lo strato si disegna subito coi caratteri del sistema,
  /// e di nuovo quando arrivano, se nel frattempo non è cambiato.
  const fontsOf = (record: ImageRecord, generation: number): string => {
    const lines = outline ? outlineSheet("") : "";
    const fonts = options.fonts;
    if (fonts === undefined) return lines;
    const named = layerText(record.layer);
    const css = fonts.now(named);
    if (css !== null) return css + lines;
    void fonts.load(named).then(() => {
      if (!disposed && record.generation === generation && fonts.now(named) !== null) render(record);
    });
    return lines;
  };

  // La vista dei contorni: un foglio per gli strati vivi, che la radice
  // accende, e lo stesso dentro ogni strato immagine, ridisegnato.
  let outline = false;
  let outlineStyle: HTMLStyleElement | null = null;
  const setOutline = (on: boolean): void => {
    if (disposed || on === outline) return;
    outline = on;
    root.toggleAttribute("data-outline", on);
    outlineStyle?.remove();
    outlineStyle = null;
    if (on) {
      outlineStyle = document.createElement("style");
      outlineStyle.textContent = outlineSheet(".spatial-painter[data-outline] ");
      root.prepend(outlineStyle);
    }
    for (const record of layers) if (record.kind === "image") render(record);
  };

  const render = (record: ImageRecord): void => {
    const target = frameNow();
    if (target === null) return;
    const generation = ++record.generation;
    revoke(record.pending);
    record.pending = null;
    const blob = new Blob([imageDocument(record.layer, target.frame, fontsOf(record, generation))], { type: "image/svg+xml" });
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
    const anchored = originals;
    originals = scene.originals;
    updateDefs(scene.resources, scene.symbols, rootAttrs);
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
    // Ciò che si crea ha già l'id vivo; se gli originali cambiano, lo
    // riceve o lo perde anche ciò che resta.
    if (originals !== anchored) reanchor();
    // Le risorse prima degli strati, come nel file.
    place(root, [...(defs === null ? [] : [defs.el]), ...layers.map((record) => record.el)]);
    let shapes = 0;
    for (const layer of scene.layers) if (layer.kind === "live") shapes += shapeCount(layer.nodes, LARGE_SCENE_SHAPES);
    setLarge(shapes >= LARGE_SCENE_SHAPES);
    applyFocus();
    applyDraft();
    // Uno strato che la scena ridisegna tiene spostata l'immagine vecchia
    // finché la nuova non la sostituisce; gli altri tornano al loro posto.
    for (const [record, generation] of generations) {
      if (frozen.delete(record) && record.generation === generation) carry(record, null);
    }
  };

  /// Gli id vivi degli originali di `originals` su tutti i nodi, e su nessun
  /// altro.
  const reanchor = (): void => {
    for (const el of anchors) {
      const id = el.getAttribute("data-scene-id");
      if (id !== null && originals.has(id)) continue;
      el.removeAttribute("id");
      anchors.delete(el);
    }
    if (originals.size === 0) return;
    for (const records of indexRecords().paints.values()) {
      for (const record of records) if (record.paint.role !== "symbol") anchor(record.el, record.paint.id);
    }
  };

  // --- vista ----------------------------------------------------------------------

  const sameView = (a: PainterView, b: PainterView): boolean => a.scale === b.scale && a.angle === b.angle && a.tx === b.tx && a.ty === b.ty;

  /// Disegna gli strati nella vista che la camera chiede: la camera degli
  /// strati vivi, il posto delle immagini. La radice torna ferma.
  const commitView = (): void => {
    if (!sameView(wanted, view)) {
      view = wanted;
      const transform = cameraTransform();
      for (const record of layers) {
        if (record.kind === "live") record.camera.setAttribute("transform", transform);
        else if (record.shown !== null) position(record.shown);
      }
    }
    root.style.removeProperty("transform");
    carrying = false;
  };

  /// Il margine di una scena grande per la misura di adesso della vista.
  const setMargin = (): void => {
    margin = large && clipMargin ? Math.round(Math.max(width, height) * LARGE_MARGIN) : 0;
    if (margin > 0) root.style.setProperty("overflow-clip-margin", `${margin}px`);
    else root.style.removeProperty("overflow-clip-margin");
  };

  /// La scena diventa grande, o smette di esserlo: [`LARGE_SCENE_SHAPES`].
  /// Una scena grande ha la radice che una trasformazione sposta senza
  /// ridipingerla, e che taglia ciò che sta oltre il margine. La radice ha
  /// sempre una trasformazione, anche ferma: in Chromium il passo da nessuna
  /// trasformazione a una conta come un cambio di scala.
  const setLarge = (next: boolean): void => {
    if (next === large) return;
    large = next;
    root.toggleAttribute("data-large", large);
    setMargin();
    if (!large) commitView();
  };

  /// Vero se la radice può portare gli strati con `carry`, dalla vista in cui
  /// sono disegnati a quella che la camera chiede. Ogni angolo della radice,
  /// riportato nella vista disegnata, deve cadere nel margine dipinto: un
  /// rettangolo trasformato è convesso, e se ci stanno i suoi angoli ci sta
  /// tutto. Da ferma, poi, la radice non parte ingrandita oltre
  /// [`LARGE_CARRY`].
  const carries = (carry: Matrix): boolean => {
    if (!carrying && wanted.scale / view.scale > LARGE_CARRY) return false;
    const back = invert(carry);
    if (back === null) return false;
    const [a, b, c, d, e, f] = back;
    for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]] as const) {
      const u = a * x + c * y + e;
      const v = b * x + d * y + f;
      if (u < -margin || u > width + margin || v < -margin || v > height + margin) return false;
    }
    return true;
  };

  const settle = (): void => {
    clearSettle();
    if (disposed) return;
    commitView();
    for (const record of layers) if (record.kind === "image" && stale(record)) render(record);
  };

  const setView = (next: PainterView): void => {
    if (disposed) return;
    if (sameView(next, wanted)) return;
    wanted = { scale: next.scale, angle: next.angle, tx: next.tx, ty: next.ty };
    // Dalla vista in cui gli strati sono disegnati, alla scena, alla vista
    // nuova.
    const back = large && !sameView(wanted, view) ? invert(viewMatrix(view)) : null;
    const carry = back === null ? null : compose(viewMatrix(wanted), back);
    if (carry === null || !carries(carry)) {
      commitView();
    } else {
      // Fra due viste c'è una similitudine: una rotazione `r`, una scala `s`,
      // una traslazione `t`. La scala va nella coordinata omogenea, non nella
      // parte lineare: il punto `p` diventa `(r p + t / s) / (1 / s)`, cioè
      // `s r p + t`, lo stesso a schermo. Chromium invece, quando la parte
      // lineare della trasformazione di un blocco cambia scala, ridispone
      // ogni testo SVG che ha dentro al layout seguente, e qualunque cosa
      // nella pagina ne chiede uno a ogni passo.
      const [a, b, c, d, e, f] = carry;
      const s = Math.sqrt(Math.abs(a * d - b * c));
      root.style.transform = `matrix3d(${a / s}, ${b / s}, 0, 0, ${c / s}, ${d / s}, 0, 0, 0, 0, 1, 0, ${e / s}, ${f / s}, 0, ${1 / s})`;
      carrying = true;
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
      setMargin();
      settle();
    });
    resizeObserver.observe(host);
    life.add(() => resizeObserver.disconnect());
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    draft = null;
    covers = null;
    crops = null;
    drafted = [];
    carriedImages = [];
    fadedImages = [];
    frozen.clear();
    focus = null;
    dimmed.clear();
    byPaint = null;
    anchors.clear();
    for (const record of layers) disposeLayer(record);
    layers = [];
    if (defs !== null) disposeDefs(defs);
    defs = null;
    root.remove();
    life.close();
  };
  owner.add(dispose);

  return { update, setDraft, setFocus, setCovers, setCrops, setView, settle, setOutline, dispose };
}
