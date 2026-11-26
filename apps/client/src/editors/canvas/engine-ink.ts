// Il motore della lavagna: l'inchiostro (penna, gomma, tratti, strati).
// Metodi della classe `CanvasEngine`, montati sul suo prototipo da
// `engine.ts` (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import type { InkPointerType } from "../../ink/input/pointer";
import type { InkSample } from "../../ink/sample";
import { ERASER } from "../../ink/tools/eraser";
import { EraseSweep, type Spot } from "../../ink/tools/sweep";
import { anchorAt, cellAnchorAt, pageAnchorAt, strokeBounds, StrokeBox, type Bounds } from "./anchor";
import { type CardCellBox, type CardPageBox } from "../core/cards/contract";
import {
  cutInk,
  cutPath,
  cutStrokePatches,
  erasableInk,
  InkEraseSource,
  inkKey,
  pieceRecords,
  type ErasableInk,
  type StrokeCut,
} from "./ink-erase";
import { inkFitMode, validAspect } from "./ink-fit";
import { type InkGuide, type InkGuideStart, type InkLayerStroke } from "./ink-layer";
import { HOLD_MS, shapeKind, StrokeGuide } from "./ink-shapes";
import { cutInkStroke, fadeInkStroke, fadeInkStrokes, paintBoard, paintCard, type DryStroke } from "./ink-paint";
import { inkReflowWidth, syncInkReflow } from "./ink-reflow";
import {
  dryStroke,
  foreignInkLayer,
  inkLayerStates,
  strokeRecord,
  toDry,
  type DrawableStroke,
  type InkLayerRef,
  type InkLayerState,
  type InkStrokeRecord,
} from "./ink-record";
import { type InkPatch } from "./operation";
import { type CanvasDocument, type CanvasNode } from "./model";
import { CanvasCoreError, type CanvasInkLayer, type CanvasIntentOp } from "./wasm/core";
import { composingKey } from "../../kit/ime";
import {
  CanvasStep,
  InkChain,
  InkErase,
  InkErasing,
  strokesByLayer,
  InkTarget,
  InkMarks,
  INK_FRAME_SIDES,
  CardEntry,
} from "./engine-parts";
import { eraseAlongSegments, erasePathPieces } from "./engine-geometry";
import { inkPatches, mergeSteps, lostCore, inkHolderText, setPixels } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const inkMethods = {
  /**
   * Comincia una passata del retro della penna o del tasto laterale: i tratti
   * che può prendere sono quelli disegnati adesso, dove si vedono.
   */
  _eraseStart(this: CanvasEngine, id: number, pointerType: InkPointerType): void {
    this._eraseDrop();
    this._erase = {
      id,
      sweep: new EraseSweep(ERASER, pointerType),
      source: new InkEraseSource(erasableInk(this._inkStateList(), this._pagesShown, this._aspectsShown, this._cellsShown)),
      mode: this._penChoice.eraser,
      path: [],
      cuts: new Map(),
      radius: 0,
    };
  },

  /**
   * Punti nuovi della passata: i tratti presi si attenuano, il resto no. Con
   * `"piece"` si attenua solo il pezzo strofinato: i tratti vicini ai punti
   * nuovi si ritagliano sul cammino fatto fin qui.
   */
  _eraseAlong(this: CanvasEngine, id: number, points: readonly InkSample[]): void {
    const erase = this._erase;
    if (!erase || erase.id !== id || points.length === 0) return;
    const zoom = this._camera.zoom;
    const before = erase.sweep.size;
    if (erase.mode === "stroke") {
      for (const point of points) erase.sweep.along(erase.source, [point.x, point.y], zoom);
      const marked = erase.sweep.marked();
      for (let i = before; i < marked.length; i++) this._fadeInk(marked[i]!, true);
      return;
    }
    const radius = erase.sweep.radius / zoom;
    erase.radius = radius;
    const last = erase.path[erase.path.length - 1];
    let loX = last ? last[0] : Infinity;
    let loY = last ? last[1] : Infinity;
    let hiX = last ? last[0] : -Infinity;
    let hiY = last ? last[1] : -Infinity;
    for (const point of points) {
      const spot: Spot = [point.x, point.y];
      erase.path.push(spot);
      erase.sweep.along(erase.source, spot, zoom);
      loX = Math.min(loX, spot[0]);
      loY = Math.min(loY, spot[1]);
      hiX = Math.max(hiX, spot[0]);
      hiY = Math.max(hiY, spot[1]);
    }
    loX -= radius;
    loY -= radius;
    hiX += radius;
    hiY += radius;
    const marked = erase.sweep.marked();
    for (let i = 0; i < marked.length; i++) {
      const unit = marked[i]!;
      // Un tratto già preso cambia solo se i punti nuovi gli passano vicino.
      if (i < before && (unit.maxX < loX || unit.minX > hiX || unit.maxY < loY || unit.minY > hiY)) continue;
      const pieces = cutInk(unit, erase.path, radius);
      if (pieces === null) {
        if (erase.cuts.delete(unit.key)) this._showCut(unit, null);
        continue;
      }
      const preview = cutPath(pieces);
      erase.cuts.set(unit.key, { unit, pieces, preview });
      this._showCut(unit, preview);
    }
  },

  /**
   * La passata è finita: i tratti presi si cancellano (o si tagliano) con un
   * commit solo, un passo d'annulla, anche se stanno in più livelli. Niente
   * preso, niente commit; un commit che non riesce rimette i tratti come
   * erano.
   */
  _eraseEnd(this: CanvasEngine, id: number): void {
    const erase = this._erase;
    if (!erase || erase.id !== id) return;
    this._erase = null;
    if (erase.mode === "stroke" ? erase.sweep.size === 0 : erase.cuts.size === 0) return;
    let done = false;
    try {
      done = erase.mode === "stroke" ? this._eraseCommit(erase.sweep.marked()) : this._cutCommit(this._cutsOf(erase), erase.path, erase.radius);
    } finally {
      if (!done) this._restoreErase(erase);
    }
  },

  /** La passata annullata (palmo, finestra nascosta, sola lettura): i tratti tornano normali. */
  _eraseCancel(this: CanvasEngine, id: number): void {
    if (this._erase?.id === id) this._eraseDrop();
  },

  _eraseDrop(this: CanvasEngine): void {
    const erase = this._erase;
    this._erase = null;
    if (erase) this._restoreErase(erase);
  },

  /** Rimette come erano i tratti che la passata `erase` mostrava presi o tagliati. */
  _restoreErase(this: CanvasEngine, erase: InkErase): void {
    if (erase.mode === "stroke") for (const unit of erase.sweep.marked()) this._fadeInk(unit, false);
    else for (const { unit } of erase.cuts.values()) this._showCut(unit, null);
  },

  /** I tagli della passata nell'ordine in cui la gomma ha preso i tratti. */
  _cutsOf(this: CanvasEngine, erase: InkErase): InkErasing[] {
    const cuts: InkErasing[] = [];
    for (const unit of erase.sweep.marked()) {
      const cut = erase.cuts.get(unit.key);
      if (cut) cuts.push(cut);
    }
    return cuts;
  },

  /** L'elemento della scheda `node` sulla scena; `null` se non c'è. */
  _inkOwner(this: CanvasEngine, node: string): HTMLElement | null {
    return this._stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(node)}"]`);
  },

  /** Attenua o rimette il percorso disegnato di un tratto, senza ridisegnare. */
  _fadeInk(this: CanvasEngine, unit: ErasableInk, faded: boolean): void {
    if (unit.node === null) {
      fadeInkStroke(this._stage, "board", unit.id, faded);
      return;
    }
    const element = this._inkOwner(unit.node);
    if (element) fadeInkStroke(element, "card", unit.id, faded);
  },

  /** Attenua o rimette i tratti `units`, una passata per livello: col Lazo possono essere migliaia (T86). */
  _fadeUnits(this: CanvasEngine, units: readonly ErasableInk[], faded: boolean): void {
    for (const { layer, ids } of strokesByLayer(units)) {
      const owner = layer === "board" ? this._stage : this._inkOwner(layer.node);
      if (owner) fadeInkStrokes(owner, layer === "board" ? "board" : "card", new Set(ids), faded);
    }
  },

  /** Mostra il taglio `preview` di un tratto (o lo toglie con `null`), senza ridisegnare. */
  _showCut(this: CanvasEngine, unit: ErasableInk, preview: string | null): void {
    if (unit.node === null) {
      cutInkStroke(this._stage, "board", unit.id, preview);
      return;
    }
    const element = this._inkOwner(unit.node);
    if (element) cutInkStroke(element, "card", unit.id, preview);
  },

  /** Il primo passo di un commit della gomma: il documento e i livelli di adesso, dopo il testo in sospeso. */
  _inkEditStart(this: CanvasEngine): { readonly doc: CanvasDocument; readonly layers: readonly CanvasInkLayer[] } | null {
    if (this._destroyed || !this._doc || this._readOnly || this._isSceneOversized()) return null;
    this._recordPending();
    const doc = this._doc;
    const layers = this._inkLayersNow();
    return layers ? { doc, layers } : null;
  },

  /**
   * Un commit solo con le toppe della gomma, un passo d'annulla; ciò che il
   * nucleo rifiuta lo dice l'avviso. `true` se è riuscito.
   */
  _commitInkEdit(this: CanvasEngine, patches: readonly InkPatch[]): boolean {
    if (patches.length === 0) return false;
    const code = this._commitLocal(patches, "input", (step) => this._pushUndo(step, true), false);
    if (code !== true) {
      // Una trappola la dice il nucleo che si riapre.
      if (code !== "trap") this._showNotice(t(code === "limit" ? "canvas.ink.full" : "canvas.ink.refused"));
      return false;
    }
    this._inkChain = null;
    this._paintInk();
    if (this._intakeError) this._showNotice("");
    this._inkGestureDone();
    return true;
  },

  /**
   * Un gesto d'inchiostro è appena diventato l'ultimo passo d'annulla. La
   * penna non prende il fuoco (un tratto non chiude il campo che si scrive):
   * perché Ctrl+Z, subito dopo, tolga il tratto, il fuoco dentro una scheda
   * che scrive ricorda il passo (`_inkUndoKey`); ogni altro fuoco (un
   * pulsante della colonna o della riga, un'altra parte della finestra,
   * nessuno) passa alla vista, come dopo un clic sulla lavagna.
   */
  _inkGestureDone(this: CanvasEngine): void {
    const step = this._undo[this._undo.length - 1];
    if (!step || this._destroyed) return;
    const active = document.activeElement;
    const inCard = active instanceof Element && active !== this._viewport && this._viewport.contains(active)
      ? active.closest(".canvas-node") : null;
    if (inCard && inCard !== active) {
      this._inkOverField.push(step);
      this._inkOverFieldRedo = [];
      return;
    }
    this._inkOverField = [];
    this._inkOverFieldRedo = [];
    // Una scheda o la vista col fuoco: i tasti arrivano già alla tela.
    if (active instanceof Element && this._viewport.contains(active)) return;
    this._viewport.focus({ preventScroll: true });
  },

  /**
   * Ctrl+Z (Ctrl+Maiusc+Z, Ctrl+Y) col fuoco in una scheda che scrive,
   * subito dopo uno o più gesti d'inchiostro (`_inkOverField`): annulla (o
   * rifà) il gesto, e il campo resta aperto col suo testo. Ogni altro tasto
   * li lascia, e da lì i tasti sono del campo.
   */
  _inkUndoKey(this: CanvasEngine, event: KeyboardEvent): void {
    if (event.key === "Control" || event.key === "Meta" || event.key === "Shift" || event.key === "Alt") return;
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
    const letter = event.key.toLowerCase();
    const chord = mod && letter === "z" ? (event.shiftKey ? "redo" : "undo") : mod && letter === "y" && !event.shiftKey ? "redo" : null;
    if (chord === null || composingKey(event)) {
      this._inkOverField = [];
      this._inkOverFieldRedo = [];
      return;
    }
    if (event.defaultPrevented || this._penDown || this._pending !== null || this._readOnly) return;
    const from = chord === "undo" ? this._inkOverField : this._inkOverFieldRedo;
    const history = chord === "undo" ? this._undo : this._redo;
    const step = from[from.length - 1];
    if (!step) return;
    if (history[history.length - 1] !== step) {
      // La storia è cambiata sotto (un annulla dal menu, una modifica): i
      // passi ricordati non sono più gli ultimi.
      this._inkOverField = [];
      this._inkOverFieldRedo = [];
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    from.pop();
    history.pop();
    const done = chord === "undo"
      ? this._replay(step, "undo", (again) => {
        this._redo.push(again);
        this._inkOverFieldRedo.push(again);
      })
      : this._replay(step, "redo", (again) => {
        this._pushUndo(again, false);
        this._inkOverField.push(again);
      });
    if (done !== true) {
      history.push(step);
      from.push(step);
    }
    this._statusSettle();
  },

  /**
   * Cancella i tratti `marked` dal documento di adesso: prima il testo in
   * sospeso (un passo suo, come prima di ogni gesto), poi una toppa per
   * tratto, livello per livello nell'ordine in cui la gomma li ha presi. Un
   * tratto che nel frattempo non c'è più si lascia; un livello diventato
   * estraneo non si tocca. `true` se il commit è riuscito.
   */
  _eraseCommit(this: CanvasEngine, marked: readonly ErasableInk[]): boolean {
    const start = this._inkEditStart();
    if (!start) return false;
    const { layers } = start;
    const present = new Set<string>();
    for (const state of this._inkStateList()) {
      for (const entry of state.strokes) present.add(inkKey(state.layer, entry.id));
    }
    const groups = new Map<string, { readonly layer: InkLayerRef; readonly ids: string[] }>();
    for (const unit of marked) {
      if (!present.has(unit.key)) continue;
      const group = unit.node === null ? "board" : `node\u0000${unit.node}`;
      let entry = groups.get(group);
      if (!entry) {
        entry = { layer: unit.layer, ids: [] };
        groups.set(group, entry);
      }
      entry.ids.push(unit.id);
    }
    // Una `erase_strokes` per livello, nell'ordine in cui la gomma li ha presi (T24).
    const ops: CanvasIntentOp[] = [];
    for (const { layer, ids } of groups.values()) {
      if (foreignInkLayer(layers, layer)) continue;
      ops.push({ op: "erase_strokes", layer: layer === "board" ? "board" : { node: layer.node }, ids: [...ids] });
    }
    const patches = ops.length > 0 ? this._compileOps(ops) : null;
    return patches !== null && this._commitInkEdit(inkPatches(patches));
  },

  /**
   * Taglia i tratti di `cuts` nel documento di adesso: prima il testo in
   * sospeso, poi, livello per livello, i pezzi al posto di ogni tratto e nel
   * suo ordine (`cutStrokePatches`), in un commit solo. Un tratto che nel
   * frattempo non c'è più, o è cambiato, si lascia; un livello diventato
   * estraneo non si tocca. `true` se il commit è riuscito.
   */
  _cutCommit(this: CanvasEngine, cuts: readonly InkErasing[], path: readonly Spot[], radius: number): boolean {
    const start = this._inkEditStart();
    if (!start) return false;
    const { doc, layers } = start;
    const present = new Map<string, DrawableStroke>();
    for (const state of this._inkStateList()) {
      for (const stroke of state.drawable) present.set(inkKey(state.layer, stroke.id), stroke);
    }
    const groups = new Map<string, { readonly layer: InkLayerRef; readonly cuts: StrokeCut[] }>();
    for (const { unit, pieces } of cuts) {
      const now = present.get(unit.key);
      if (!now || now.inkText !== unit.stroke.inkText || now.brushText !== unit.stroke.brushText) continue;
      const group = unit.node === null ? "board" : `node\u0000${unit.node}`;
      let entry = groups.get(group);
      if (!entry) {
        entry = { layer: unit.layer, cuts: [] };
        groups.set(group, entry);
      }
      entry.cuts.push({ id: unit.id, pieces: pieceRecords(now, pieces) });
    }
    const along = this._eraseAlongOps(cuts, path, radius);
    if (along !== null) {
      const patches = along.length > 0 ? this._compileOps(along) : null;
      return patches !== null && this._commitInkEdit(inkPatches(patches));
    }
    const patches: InkPatch[] = [];
    for (const { layer, cuts: layerCuts } of groups.values()) {
      const made = cutStrokePatches(doc, layers, layer, layerCuts);
      if (made) patches.push(...made);
    }
    return this._commitInkEdit(patches);
  },

  /**
   * La gomma «Solo il pezzo» come `erase_along` (T24): un'operazione per
   * posto toccato, col cammino fatto e la sua larghezza: nelle coordinate
   * della lavagna per i tratti liberi (`on: "board"`), in quelle della scheda
   * per i suoi (`on` col suo id, con la proporzione del contenuto che
   * mostra), in punti della pagina mostrata per quelli di un PDF
   * (`on: {card, page, page_size}`) e in pixel del foglio dall'angolo della
   * cella per quelli di una cella (`on: {card, sheet, cell}`). `null` se la
   * scheda non dice più dove mostra la pagina o la cella di un tratto tagliato
   * (allora la tela scrive i pezzi che ha tagliato lei).
   */
  _eraseAlongOps(this: CanvasEngine, cuts: readonly InkErasing[], path: readonly Spot[], radius: number): CanvasIntentOp[] | null {
    const doc = this._doc;
    if (!doc || path.length === 0 || !(radius > 0)) return null;
    // Dove taglia ogni operazione: la radice, una scheda, una sua pagina o una
    // sua cella, con l'angolo e la scala con cui la scheda la mostra (come
    // `erasableInk`): il cammino ci torna con `(punto − angolo) / scala`.
    const targets = new Map<string, { readonly on: unknown; readonly x: number; readonly y: number; readonly s: number; readonly aspect?: number }>();
    for (const { unit } of cuts) {
      const { page, cell } = unit.stroke;
      if (unit.node === null) {
        targets.set("board", { on: "board", x: 0, y: 0, s: 1 });
        continue;
      }
      const node = doc.nodes.find((one) => one.id === unit.node);
      if (!node) return null;
      if (cell !== null) {
        const box = this._cellRectOf(node.id, cell.sheet, cell.cell);
        if (!box || !(box.zoom > 0) || !Number.isFinite(box.rect.x) || !Number.isFinite(box.rect.y)) return null;
        targets.set(`cell\u0000${node.id}\u0000${cell.sheet}\u0000${cell.cell}`, {
          on: { card: node.id, sheet: cell.sheet, cell: cell.cell },
          x: node.x + box.rect.x,
          y: node.y + box.rect.y,
          s: box.zoom,
        });
      } else if (page !== null) {
        const box = this._pageBoxOf(node.id);
        if (!box || box.page !== page) return null;
        // `pageFit`: il fattore minore, dall'angolo del rettangolo.
        const s = Math.min(box.rect.width / box.size.width, box.rect.height / box.size.height);
        if (!(s > 0) || !Number.isFinite(s)) return null;
        targets.set(`page\u0000${node.id}\u0000${page}`, {
          on: { card: node.id, page, page_size: [box.size.width, box.size.height] },
          x: node.x + box.rect.x,
          y: node.y + box.rect.y,
          s,
        });
      } else if (!targets.has(`card\u0000${node.id}`)) {
        const aspect = this._layerAspect({ node: node.id });
        targets.set(`card\u0000${node.id}`, {
          on: node.id,
          x: node.x,
          y: node.y,
          s: 1,
          ...(validAspect(aspect) ? { aspect } : {}),
        });
      }
    }
    // Un cammino lungo va in pezzi di fila che si toccano in un estremo: ogni
    // pezzo resta sotto i tetti del nucleo (punti e lavoro), e la lista
    // resta una, cioè un passo d'annulla.
    const pieces = erasePathPieces(path, eraseAlongSegments(cuts.map(({ unit }) => unit), radius));
    const ops: CanvasIntentOp[] = [];
    for (const target of targets.values()) {
      for (const piece of pieces) {
        ops.push({
          op: "erase_along",
          points: piece.map(([x, y]) => [(x - target.x) / target.s, (y - target.y) / target.s]),
          size: (radius * 2) / target.s,
          on: target.on,
          ...(target.aspect === undefined ? {} : { aspect: target.aspect }),
        });
      }
    }
    return ops;
  },

  /**
   * I livelli d'inchiostro del testo di adesso: lo stato lo dice il nucleo, una
   * volta per testo (`inkLayers()` li tiene fino al prossimo `reset` o
   * `commit`), e qui si decodificano una volta per modello.
   */
  _inkStateList(this: CanvasEngine): readonly InkLayerState[] {
    const doc = this._doc;
    const layers = this._inkLayersNow();
    if (!doc || !layers) return [];
    const cached = this._inkStates;
    if (cached && cached.doc === doc && cached.layers === layers) return cached.states;
    const states = inkLayerStates(doc, layers);
    this._inkStates = { doc, layers, states };
    return states;
  },

  /** I livelli del nucleo per il testo di adesso; `null` senza nucleo o se è appena morto. */
  _inkLayersNow(this: CanvasEngine): readonly CanvasInkLayer[] | null {
    const core = this._core;
    if (!core) return null;
    try {
      return core.inkLayers();
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return null;
      }
      if (error instanceof CanvasCoreError) return null;
      throw error;
    }
  },

  /**
   * Ridisegna l'asciutto di tutte le schede sulla scena e della radice, senza
   * rifare le schede: dopo `_render`, o dopo un annulla fatto solo di tratti.
   */
  _paintInk(this: CanvasEngine): void {
    if (!this._doc || this._isSceneOversized()) return;
    const cards = new Map<string, readonly DryStroke[]>();
    let board: DryStroke[] = [];
    // Ciò che la gomma ha preso resta attenuato (o tagliato) anche se lo
    // strato si ridisegna.
    const erase = this._erase;
    const faded = erase?.mode === "stroke" ? new Set(erase.sweep.marked().map((unit) => unit.key)) : null;
    const cuts = erase?.mode === "piece" ? erase.cuts : null;
    for (const state of this._inkStateList()) {
      const drys: DryStroke[] = [];
      for (const stroke of state.drawable) {
        const dry = dryStroke(stroke, this._inkPaths);
        if (!dry) continue;
        const key = inkKey(state.layer, stroke.id);
        const cut = cuts?.get(key);
        if (cut && cut.unit.stroke.inkText === stroke.inkText) drys.push({ ...dry, cut: cut.preview });
        else drys.push(faded?.has(key) ? { ...dry, faded: true } : dry);
      }
      if (state.node) cards.set(state.node.id, drys);
      else board = drys;
    }
    const nodes = new Map(this._doc.nodes.map((node) => [node.id, node]));
    for (const element of this._stage.children) {
      if (!(element instanceof HTMLElement) || !element.classList.contains("canvas-node")) continue;
      const node = nodes.get(element.dataset.node ?? "");
      if (node) this._paintCardInk(element, node, cards.get(node.id) ?? []);
    }
    paintBoard(this._stage, board);
    this._inkCards = cards;
    this._inkBoard = board;
    // I tratti scelti col Lazo, sopra l'inchiostro libero (T86).
    this._paintLasso();
    this._inkPaths.sweep();
  },

  /**
   * Un tratto della penna è finito: si scrive, e la sua scia va via nello
   * stesso giro. La sua guida (T87) dice che cosa: sul bordo del righello,
   * dritto con Maiusc, o com'era e poi la forma della penna ferma.
   */
  _inkStroke(this: CanvasEngine, stroke: InkLayerStroke): void {
    const layer = this._inkLayer;
    const guide = this._inkGuides.get(stroke.id) ?? null;
    this._inkGuideDrop(stroke.id);
    // L'etichetta sparisce all'alzata; il tratto si attacca a ciò che diceva.
    this._inkTargetClose();
    try {
      const guided = guide?.finish(stroke.samples, stroke.split) ?? null;
      this._writeStroke(guided === null ? stroke : { ...stroke, samples: guided.samples }, guided?.shape ?? null);
    } finally {
      layer?.settle(stroke.id);
    }
  },

  /**
   * Scrive il tratto `stroke`: prima il testo in sospeso (un passo suo, A1),
   * poi la scheda che lo tiene sul documento di adesso (A3, A9), il record,
   * la toppa e un commit solo, senza ridisegnare le schede; l'asciutto del
   * solo livello toccato si aggiunge qui. Un pezzo che continua un tratto
   * spezzato si fonde nel passo del pezzo di prima (A4). Ciò che non si
   * scrive lo dice l'avviso della barra.
   */
  _writeStroke(this: CanvasEngine, stroke: InkLayerStroke, shape: readonly InkSample[] | null = null): void {
    const chain = stroke.continued ? this._inkChain : null;
    this._inkChain = null;
    if (this._destroyed || !this._doc || this._readOnly || this._isSceneOversized()) return;
    // Come prima di ogni gesto: il testo e poi il tratto, due passi. Il campo
    // resta aperto col suo testo.
    this._recordPending();
    const doc = this._doc;
    const layers = this._inkLayersNow();
    if (!layers) return;
    const bounds = strokeBounds(stroke.samples, stroke.brush.size);
    const holder = this._inkHolder(doc.nodes, layers, bounds);
    const ref: InkLayerRef = holder ? { node: holder.id } : "board";
    if (foreignInkLayer(layers, ref)) {
      this._showNotice(t("canvas.ink.foreign"));
      return;
    }
    // Sulla pagina di un PDF il tratto è della pagina se comincia lì (T19);
    // sulla griglia di un foglio, della cella sotto il centro (T37, T38).
    const page = holder ? pageAnchorAt(holder, this._pageBoxOf(holder.id), stroke.samples[0]) : null;
    const cell = holder && !page ? cellAnchorAt(holder, bounds, (point) => this._cellAtOf(holder.id, point)) : null;
    const made = strokeRecord(stroke, holder, { brush: stroke.brush, color: stroke.color, tool: stroke.tool }, Date.now(), page ?? cell);
    if (!made.ok) {
      // Un tocco che non fa contorno non è niente da dire.
      if (made.reason !== "empty") this._showNotice(t(made.reason === "full" ? "canvas.ink.full" : "canvas.ink.refused"));
      return;
    }
    // Il tratto entra con `add_strokes` (T24): la codifica dei punti è della
    // tela (N4), il livello, l'ordine dei campi e l'id li dà il nucleo.
    const { id: _id, ...fields } = made.record as unknown as Record<string, unknown>;
    const compiled = this._compileIntent([{ op: "add_strokes", layer: ref === "board" ? "board" : { node: ref.node }, strokes: [fields] }], "canvas.ink.refused");
    const added = compiled?.patches.find((patch): patch is InkPatch => patch.kind === "ink" && patch.after !== null);
    if (!compiled || !added?.after) return;
    const record = added.after as unknown as InkStrokeRecord;
    const before = this._source;
    const code = this._commitLocal(compiled.patches, "input", (step) => this._pushInkStep(step, chain), false);
    if (code !== true) {
      // Una trappola la dice il nucleo che si riapre.
      if (code !== "trap") this._showNotice(t(code === "limit" ? "canvas.ink.full" : "canvas.ink.refused"));
      return;
    }
    const top = this._undo[this._undo.length - 1];
    if (stroke.split && top) this._inkChain = { step: top, before: chain?.before ?? before };
    const dry = toDry(record, this._inkPaths);
    if (dry) this._paintStroke(holder, dry);
    if (this._intakeError) this._showNotice("");
    // Il pezzo di un tratto spezzato non si annuncia: lo dice l'ultimo.
    if (!stroke.split) {
      this._sayInkHolder(holder);
      this._inkGestureDone();
    }
    if (shape !== null) this._writeShape(stroke, shape, record, ref, holder, page ?? cell);
  },

  /**
   * La forma della penna ferma prende il posto del tratto `written`, appena
   * scritto, in un passo d'annulla suo (T87): un tratto `fub:ink` con lo
   * stesso id, la stessa penna, lo stesso colore, lo stesso spessore, la
   * stessa ancora e lo stesso posto nel livello. Annullare riporta il tratto
   * com'era. Una forma che non si scrive lascia il tratto e lo dice.
   */
  _writeShape(
    this: CanvasEngine,
    stroke: InkLayerStroke,
    shape: readonly InkSample[],
    written: InkStrokeRecord,
    ref: InkLayerRef,
    holder: CanvasNode | null,
    content: Parameters<typeof strokeRecord>[4],
  ): void {
    const start = this._inkEditStart();
    if (!start) return;
    const look = { brush: stroke.brush, color: stroke.color, tool: stroke.tool };
    const made = strokeRecord({ samples: shape, pressure: stroke.pressure, split: false }, holder, look, Date.now(), content);
    if (!made.ok) {
      if (made.reason !== "empty") this._showNotice(t(made.reason === "full" ? "canvas.ink.full" : "canvas.ink.refused"));
      return;
    }
    const after: Record<string, unknown> = { ...made.record, id: written.id };
    if (written.at === undefined) delete after.at;
    else after.at = written.at;
    // Il tratto appena scritto è l'ultimo del suo livello: toglierlo e
    // rimettere la forma con lo stesso id la lascia al suo posto (T24).
    const layer = ref === "board" ? "board" : { node: ref.node };
    const patches = this._compileOps([
      { op: "erase_strokes", layer, ids: [written.id] },
      { op: "add_strokes", layer, strokes: [after] },
    ]);
    if (patches) this._commitInkEdit(inkPatches(patches));
  },

  /**
   * Il tratto della punta `start` comincia: la sua guida (T87), col righello di
   * adesso, lo zoom di adesso e Maiusc letto quando serve. Campioni nuovi che
   * fanno uscire la punta dal punto fermo fanno ripartire il mezzo secondo;
   * nessun riconoscimento a ogni campione.
   */
  _inkGuideStart(this: CanvasEngine, start: InkGuideStart): InkGuide {
    const guide = new StrokeGuide({
      pointer: start.pointerType,
      tool: start.look.tool,
      size: start.look.brush.size,
      zoom: this._camera.zoom,
      ruler: this._inkRuler?.ruler ?? null,
      continued: start.continued,
      shift: () => this._shiftHeld,
    });
    this._inkGuides.set(start.id, guide);
    return {
      add: (samples) => {
        if (guide.add(samples)) this._armShape(start.id);
      },
      trail: (samples, predicted) => guide.trail(samples, predicted),
    };
  },

  /** Il mezzo secondo della penna ferma riparte per il tratto `id`. */
  _armShape(this: CanvasEngine, id: number): void {
    clearTimeout(this._shapeTimer);
    this._shapeTimer = setTimeout(() => {
      this._shapeTimer = undefined;
      const guide = this._inkGuides.get(id);
      if (this._destroyed || !guide || !guide.hold()) return;
      this._inkLayer?.repaint();
      const shape = guide.shapeNow();
      if (shape) this._sayGesture(t("canvas.ink.shape", { kind: t(`canvas.ink.shape.${shapeKind(shape)}`) }));
    }, HOLD_MS);
  },

  /** Il tratto `id` è finito o annullato: la sua guida e il suo mezzo secondo se ne vanno. */
  _inkGuideDrop(this: CanvasEngine, id: number): void {
    if (!this._inkGuides.delete(id)) return;
    clearTimeout(this._shapeTimer);
    this._shapeTimer = undefined;
  },

  /** Maiusc tenuto o lasciato: a penna giù la scia si raddrizza o torna com'era subito. */
  _setShiftHeld(this: CanvasEngine, held: boolean): void {
    if (held === this._shiftHeld) return;
    this._shiftHeld = held;
    if (this._inkGuides.size > 0) this._inkLayer?.repaint();
  },

  /**
   * La pagina che la scheda `id` mostra e dove (T19): la chiede alla sua
   * vista; `null` se la scheda non ha una vista o non mostra una pagina.
   */
  _pageBoxOf(this: CanvasEngine, id: string): CardPageBox | null {
    const view = this._cards.get(id)?.view;
    if (!view?.pageBox) return null;
    try {
      return view.pageBox();
    } catch (error) {
      // Una vista che lancia non ferma l'inchiostro: la pagina non si vede.
      console.warn(`canvas: la pagina della scheda ${id} non si misura`, error);
      return null;
    }
  },

  /**
   * La cella sotto `point` (dall'angolo della scheda) nella scheda di foglio
   * `id` (T38): la chiede alla sua vista; `null` se la scheda non ha una
   * vista o lì non c'è una cella.
   */
  _cellAtOf(this: CanvasEngine, id: string, point: { readonly x: number; readonly y: number }): CardCellBox | null {
    const view = this._cards.get(id)?.view;
    if (!view?.cellAt) return null;
    try {
      return view.cellAt(point);
    } catch (error) {
      // Una vista che lancia non ferma l'inchiostro: il tratto è della scheda.
      console.warn(`canvas: la cella della scheda ${id} non si trova`, error);
      return null;
    }
  },

  /**
   * Dove la scheda di foglio `id` mostra la cella `cell` del foglio `sheet`
   * (T38): lo chiede alla sua vista; `null` se non la mostra.
   */
  _cellRectOf(this: CanvasEngine, id: string, sheet: string, cell: string): CardCellBox | null {
    const view = this._cards.get(id)?.view;
    if (!view?.cellRect) return null;
    try {
      return view.cellRect(sheet, cell);
    } catch (error) {
      // Una vista che lancia non ferma l'inchiostro: la cella non si vede.
      console.warn(`canvas: la cella ${cell} della scheda ${id} non si misura`, error);
      return null;
    }
  },

  /**
   * La proporzione del contenuto che la scheda `id` mostra (T39): la chiede
   * alla sua vista; `null` se la scheda non ha una vista o non la sa.
   */
  _contentAspectOf(this: CanvasEngine, id: string): number | null {
    const view = this._cards.get(id)?.view;
    if (!view?.contentAspect) return null;
    try {
      const aspect = view.contentAspect();
      return typeof aspect === "number" && Number.isFinite(aspect) && aspect > 0 ? aspect : null;
    } catch (error) {
      // Una vista che lancia non ferma l'inchiostro: segue tutta la scheda.
      console.warn(`canvas: il contenuto della scheda ${id} non si misura`, error);
      return null;
    }
  },

  /**
   * La proporzione del contenuto della scheda che tiene il livello `layer`,
   * per le operazioni che il nucleo compila (`move_strokes`,
   * `restyle_strokes`, T98): la stessa della resa, così il tratto va dove lo
   * porta il puntatore. `null` per la radice e per le schede che non scalano.
   */
  _layerAspect(this: CanvasEngine, layer: InkLayerRef): number | null {
    if (layer === "board") return null;
    const node = this._doc?.nodes.find((one) => one.id === layer.node);
    return node && inkFitMode(node) === "scale" ? this._contentAspectOf(node.id) : null;
  },

  /**
   * Disegna i tratti `drys` dentro l'elemento della scheda `node`: col modo
   * della scheda, la pagina che mostra (T19), le celle che mostra (T38) e la
   * proporzione del suo contenuto (T39), che chiede solo alle schede `scale`.
   */
  _paintCardInk(this: CanvasEngine, element: HTMLElement, node: CanvasNode, drys: readonly DryStroke[]): void {
    const mode = inkFitMode(node);
    const aspect = mode === "scale" && drys.length > 0 ? this._contentAspectOf(node.id) : null;
    const cells = drys.some((dry) => dry.cell !== undefined)
      ? (sheet: string, cell: string) => this._cellRectOf(node.id, sheet, cell)
      : null;
    paintCard(element, drys, mode, drys.length > 0 ? this._pageBoxOf(node.id) : null, aspect, cells);
    syncInkReflow(element, inkReflowWidth(node, drys), !this._readOnly);
  },

  /**
   * «Torna a N px» dell'avviso dei tratti sul testo (`ink-reflow.ts`): la
   * scheda `id` riprende la larghezza `width` in cui i tratti sono stati
   * scritti, col lato sinistro fermo e la sua altezza, in un passo d'annulla.
   */
  _restoreInkWidth(this: CanvasEngine, id: string, width: number): void {
    const node = this._doc?.nodes.find((entry) => entry.id === id);
    if (!node || this._readOnly || this._isSceneOversized() || !(width > 0) || node.width === width) return;
    // La misura l'ha scelta chi usa: scrivendo la scheda non si allarga più (T44).
    this._sizedByHand.add(id);
    this._writeOps([{ op: "resize", id, width, height: node.height }]);
  },

  /**
   * La scheda `entry` mostra un'altra pagina, o nessuna (T19), il suo
   * contenuto ha cambiato proporzione (T39) o le sue celle si sono spostate
   * (T38): si ridisegna il suo solo inchiostro, coi tratti già calcolati,
   * subito, nello stesso fotogramma della scheda.
   */
  _pageShown(this: CanvasEngine, entry: CardEntry): void {
    if (this._destroyed || !this._doc || this._isSceneOversized()) return;
    const drys = this._inkCards.get(entry.id);
    if (!drys || drys.length === 0) return;
    this._paintCardInk(entry.article, entry.node, drys);
  },

  /** Aggiunge l'asciutto di un tratto appena scritto al solo livello che lo tiene. */
  _paintStroke(this: CanvasEngine, holder: CanvasNode | null, dry: DryStroke): void {
    if (!holder) {
      this._inkBoard = [...this._inkBoard, dry];
      paintBoard(this._stage, this._inkBoard);
      return;
    }
    const drys = [...(this._inkCards.get(holder.id) ?? []), dry];
    this._inkCards.set(holder.id, drys);
    const element = this._stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(holder.id)}"]`);
    // Una scheda arrivata da fuori a penna giù non è ancora sulla scena: la
    // disegna il ridisegno rimandato.
    if (element) this._paintCardInk(element, holder, drys);
  },

  /**
   * Il passo d'annulla di un tratto: nuovo, o fuso col pezzo di prima dello
   * stesso tratto se nel frattempo il testo non è cambiato.
   */
  _pushInkStep(this: CanvasEngine, step: CanvasStep, chain: InkChain | null): void {
    const top = this._undo[this._undo.length - 1];
    if (chain && top === chain.step && top.version === step.restores) {
      this._undo[this._undo.length - 1] = mergeSteps(chain.before, top, step, this._source);
      this._redo = [];
      return;
    }
    this._pushUndo(step, true);
  },

  // --- a chi appartiene il tratto (T69) -------------------------------------

  /**
   * La scheda a cui si attacca il tratto di riquadro `bounds`, o `null` se
   * resta libero: la regola di N4 (`anchorAt`), che non sceglie le schede col
   * livello d'inchiostro di un altro programma; con Alt tenuto, libero.
   * L'etichetta e l'alzata la chiedono qui tutte e due.
   */
  _inkHolder(this: CanvasEngine, nodes: readonly CanvasNode[], layers: readonly CanvasInkLayer[], bounds: Bounds): CanvasNode | null {
    if (this._altHeld) return null;
    return anchorAt(nodes, bounds, (node) => !foreignInkLayer(layers, { node: node.id }));
  },

  /** Un appoggio sulla vista: il punto da cui partirà il riquadro, se diventa un tratto. */
  _inkSeen(this: CanvasEngine, event: PointerEvent): void {
    const at = this._inkAt;
    at.pointerId = event.pointerId;
    at.clientX = event.clientX;
    at.clientY = event.clientY;
  },

  /**
   * Comincia un tratto della punta (chiamato da `look`, una volta per tratto e
   * per pezzo): si ricordano lo spessore e la vista, già misurata da chi ha
   * appena portato l'appoggio nella lavagna. L'etichetta nasce al primo
   * movimento: un tocco non la mostra.
   */
  _inkTargetStarting(this: CanvasEngine, size: number): void {
    this._inkTargetClose();
    if (this._destroyed) return;
    this._inkStarting = { size, view: this._viewport.getBoundingClientRect() };
    // La cattura porta il passaggio alla vista: la scheda sotto la punta tiene il suo aspetto (T20f).
    this._holdHover(this._hoverCard);
  },

  /**
   * Un movimento sulla vista, dopo lo strato della penna: la scia è già
   * disegnata. A penna su non fa niente; a penna giù allarga il riquadro coi
   * punti dell'evento e rifà l'ancora solo se il riquadro è cresciuto. Il
   * browser manda un `pointermove` per fotogramma: al più un aggiornamento per
   * fotogramma, senza `requestAnimationFrame` (DEC-26).
   */
  _inkTargetMove(this: CanvasEngine, event: PointerEvent): void {
    if (!this._inkTarget && !this._inkStarting) return;
    const target = this._inkTarget ?? this._inkTargetOpen(event.pointerId);
    if (!target || event.pointerId !== target.pointerId) return;
    // Alt preso o lasciato senza che la finestra lo sapesse (il fuoco altrove).
    if (event.altKey !== this._altHeld) {
      this._altHeld = event.altKey;
      target.holder = undefined;
    }
    const { zoom, x, y } = this._camera;
    const { left, top } = target.view;
    const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    let grew = false;
    for (const one of coalesced.length > 0 ? coalesced : [event]) {
      if (target.box.add((one.clientX - left - x) / zoom, (one.clientY - top - y) / zoom)) grew = true;
    }
    this._inkSeen(event);
    this._inkTargetShow(target, grew);
  },

  /** Apre l'etichetta del tratto appena cominciato, dal punto dell'appoggio. */
  _inkTargetOpen(this: CanvasEngine, pointerId: number): InkTarget | null {
    const starting = this._inkStarting;
    this._inkStarting = null;
    if (!starting || this._destroyed || !this._doc) return null;
    const marks = this._inkMarksNow();
    marks.label.removeAttribute("data-idle");
    const target: InkTarget = {
      pointerId,
      box: new StrokeBox(),
      size: starting.size,
      view: starting.view,
      label: marks.label,
      frames: marks.frames,
      holder: undefined,
    };
    this._inkTarget = target;
    const at = this._inkAt;
    if (at.pointerId === pointerId) {
      const { zoom, x, y } = this._camera;
      target.box.add((at.clientX - starting.view.left - x) / zoom, (at.clientY - starting.view.top - y) / zoom);
    }
    return target;
  },

  /**
   * Mostra l'ancora del riquadro di adesso: il bordo tratteggiato passa alla
   * scheda nuova e il testo cambia solo quando l'ancora cambia (`grew` dice se
   * c'è da rifarla); l'etichetta segue la punta, accanto e mai sotto.
   */
  _inkTargetShow(this: CanvasEngine, target: InkTarget, grew: boolean): void {
    // Un ridisegno della scena toglie ciò che non è una scheda: i lati si rimettono.
    if (target.holder && !target.frames.isConnected) target.holder = undefined;
    if (grew || target.holder === undefined) {
      const doc = this._doc;
      const layers = this._inkLayersNow();
      const holder = doc && layers ? this._inkHolder(doc.nodes, layers, target.box.bounds(target.size)) : null;
      const id = holder?.id ?? null;
      if (id !== target.holder) {
        target.holder = id;
        this._placeInkFrame(target.frames, holder);
        const text = inkHolderText(holder);
        // Lo stesso testo del tratto prima non si riscrive: niente misura nuova.
        if (target.label.textContent !== text) target.label.textContent = text;
        target.label.toggleAttribute("data-free", holder === null);
      }
    }
    this._placeInkLabel(target);
  },

  /** L'etichetta accanto alla punta, con la misura che ha già: nessuna lettura del layout. */
  _placeInkLabel(this: CanvasEngine, target: InkTarget): void {
    this._placeInkLabelAt(target.view, this._inkAt.clientX, this._inkAt.clientY);
  },

  /** L'etichetta accanto al punto `clientX`, `clientY` della vista `view`: per la penna e per il Lazo (T86). */
  _placeInkLabelAt(this: CanvasEngine, view: DOMRect, clientX: number, clientY: number): void {
    const marks = this._inkMarks;
    if (!marks) return;
    const { left, top, width } = view;
    const px = clientX - left;
    const py = clientY - top;
    // Sopra a destra della punta; a sinistra o sotto se lì non c'è posto.
    marks.label.toggleAttribute("data-flip-x", px + marks.gap + marks.width > width);
    marks.label.toggleAttribute("data-flip-y", py - marks.gap - marks.height < 0);
    marks.label.style.setProperty("--canvas-ink-x", `${px}px`);
    marks.label.style.setProperty("--canvas-ink-y", `${py}px`);
  },

  /**
   * Mette il bordo tratteggiato attorno a `holder`, nelle coordinate della
   * lavagna (lo stage lo porta con la camera), o lo toglie se il tratto è
   * libero. Lo stacco e lo spessore sono in `structure.css`, il colore nella pelle.
   *
   * Il contenitore è uno strato composto suo (T20f): si scrive solo ciò che è
   * cambiato, così un tratto che comincia sulla scheda del tratto prima cambia
   * solo `data-idle`, cioè l'opacità dello strato, e non ridipinge niente.
   */
  _placeInkFrame(this: CanvasEngine, frames: HTMLElement, holder: CanvasNode | null): void {
    if (!holder) {
      frames.setAttribute("data-idle", "");
      return;
    }
    if (frames.dataset.node !== holder.id) frames.dataset.node = holder.id;
    // I lati ereditano la misura dal contenitore: quattro proprietà, non sedici.
    setPixels(frames, "--canvas-frame-x", holder.x);
    setPixels(frames, "--canvas-frame-y", holder.y);
    setPixels(frames, "--canvas-frame-w", holder.width);
    setPixels(frames, "--canvas-frame-h", holder.height);
    if (!frames.isConnected) this._stage.append(frames);
    frames.removeAttribute("data-idle");
  },

  /** L'etichetta e i lati del bordo: creati la prima volta, poi gli stessi. */
  _inkMarksNow(this: CanvasEngine): InkMarks {
    if (this._inkMarks) return this._inkMarks;
    const label = document.createElement("div");
    label.className = "canvas-ink-label";
    // A penna su resta al suo posto, invisibile: mostrarla non rifà il layout.
    label.setAttribute("data-idle", "");
    // Il lettore di schermo la sente all'alzata, non a ogni cambio.
    label.setAttribute("aria-hidden", "true");
    this._viewport.append(label);
    const frames = document.createElement("div");
    frames.className = "canvas-ink-frames";
    // Come l'etichetta: si nasconde con `data-idle`, mai con `hidden`. Le
    // regole `:has()` della shell leggono `[hidden]` dentro `#layout`,
    // `#panes` e `.pane`: cambiarlo qui sotto farebbe ricalcolare lo stile di
    // tutta la finestra all'inizio di ogni tratto (80–140 ms col foglio vivo).
    frames.setAttribute("data-idle", "");
    frames.setAttribute("aria-hidden", "true");
    for (const side of INK_FRAME_SIDES) {
      const edge = document.createElement("div");
      edge.className = "canvas-ink-frame";
      edge.dataset.side = side;
      frames.append(edge);
    }
    this._stage.append(frames);
    const marks: InkMarks = {
      label,
      frames,
      width: 0,
      height: 0,
      gap: 0,
    };
    this._inkMarks = marks;
    if (typeof ResizeObserver !== "undefined") {
      // Il testo cambiato si misura dopo il layout del fotogramma, non quando cambia.
      const observer = new ResizeObserver(() => {
        marks.width = label.offsetWidth;
        marks.height = label.offsetHeight;
        if (marks.gap === 0) marks.gap = parseFloat(getComputedStyle(label).getPropertyValue("--canvas-ink-label-gap")) || 0;
        if (this._inkTarget) this._placeInkLabel(this._inkTarget);
        const drag = this._strokeDrag;
        if (drag?.moved) this._placeInkLabelAt(drag.view, drag.clientX, drag.clientY);
      });
      observer.observe(label);
      this._life.add(() => observer.disconnect());
    }
    return marks;
  },

  /** Il tratto è finito o non c'è più: via l'etichetta e il bordo. */
  _inkTargetClose(this: CanvasEngine): void {
    this._inkStarting = null;
    const target = this._inkTarget;
    if (!target) return;
    this._inkTarget = null;
    target.frames.setAttribute("data-idle", "");
    target.label.setAttribute("data-idle", "");
    // Sotto il velo il puntatore può aver lasciato la scheda tenuta senza un
    // `pointerover`: se il tratto non era suo, a penna su la lascia (T20f).
    const held = this._heldCard;
    if (held && held.dataset.node !== target.holder) this._holdHover(null);
  },

  /** Alt tenuto o lasciato: a penna giù l'etichetta lo dice subito, anche se la punta è ferma. */
  _setAltHeld(this: CanvasEngine, held: boolean): void {
    if (held === this._altHeld) return;
    this._altHeld = held;
    const target = this._inkTarget;
    if (target) {
      target.holder = undefined;
      this._inkTargetShow(target, false);
    }
    // Spostando i tratti col Lazo, Alt li lascia liberi anche a puntatore fermo (T86).
    const drag = this._strokeDrag;
    if (drag?.moved && drag.units.length > 0) this._showStrokeHolder(drag);
  },

  /**
   * Dice al lettore di schermo a che cosa si è attaccato il tratto appena
   * scritto, con le parole dell'etichetta; lo stesso testo di prima non si
   * ripete, così una pagina di tratti sulla stessa scheda resta in silenzio.
   */
  _sayInkHolder(this: CanvasEngine, holder: CanvasNode | null): void {
    if (this._destroyed) return;
    let said = this._inkSaid;
    if (!said) {
      said = document.createElement("div");
      said.className = "sr-only canvas-ink-said";
      said.setAttribute("role", "status");
      said.setAttribute("aria-live", "polite");
      this._root.append(said);
      this._inkSaid = said;
    }
    const text = inkHolderText(holder);
    if (said.textContent !== text) said.textContent = text;
  },
};
export type InkMethods = typeof inkMethods;
