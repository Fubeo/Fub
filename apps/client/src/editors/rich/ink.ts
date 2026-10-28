// La scheda «Disegna» dei documenti: si scrive a mano sopra la pagina, come
// in Word.
//
// Un velo copre il testo mentre è scelto uno strumento che disegna. La penna
// e l'evidenziatore raccolgono i tratti con l'inchiostro del disegno
// (`ink/dom/pointer-adapter.ts`: penna, dito e mouse, palmo, pressione) e li
// mostrano subito con lo stesso contorno; i tratti di una sessione diventano
// un oggetto `ink` della proiezione, davanti al testo, ancorato al paragrafo
// più vicino, in una transazione sola: un passo di Annulla. La sessione si
// chiude cambiando strumento, con Esc, quando la barra si smonta o dopo una
// pausa.
//
// La gomma e il lazo lavorano sugli oggetti d'inchiostro già nel documento:
// la gomma toglie tratti interi o i punti che tocca, il lazo sceglie tratti che
// Canc toglie e che il trascinamento sposta. Un oggetto cambiato è un oggetto
// nuovo: un inchiostro di Word tenuto perde il suo `k` e si riscrive.
//
// Un formato che non scrive inchiostro (OpenDocument) riceve la sessione come
// disegno: l'SVG dei tratti, in linea.

import { attachInkInput, type InkInput } from "../../ink/dom/pointer-adapter";
import type { TouchPolicy } from "../../ink/input/roles";
import { outlinePath } from "../../ink/pf1";
import type { InkSample } from "../../ink/sample";
import { HIGHLIGHTER } from "../../ink/tools/highlighter";
import { PEN } from "../../ink/tools/pen";
import { previewOutline } from "../../ink/tools/stroke";
import { INK_DEFAULT_COLOR, INK_DEFAULT_WIDTH, INK_HIGHLIGHTER_COLOR, INK_HIGHLIGHTER_WIDTH, INK_HIGHLIGHTER_WIDTHS, INK_WIDTHS } from "../../ink/palette";
import { t, type Key } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { Node as PmNode } from "prosemirror-model";
import { closeHistory } from "prosemirror-history";
import type { EditorState, Transaction } from "prosemirror-state";
import type { RichEngine } from "./engine";
import { boxOf, erase, lassoed, lineOpacity, lineOutline, moved, shapeSvg, tracesOf, type InkBox, type InkPoint, type InkTrace } from "./ink-shape";
import { DEFAULT_PEN, penBrush, PENS, type PenId } from "../../ink/pens";
import type { InkShape, Place } from "./projection";
import { richSchema } from "./schema";

export type RichInkTool = "select" | "lasso" | "pen" | "highlighter" | "eraser";
export const RICH_INK_TOOLS: readonly RichInkTool[] = ["select", "lasso", "pen", "highlighter", "eraser"];

/// Punti tipografici per pixel CSS.
const PT = 3 / 4;
/// La pausa dopo l'ultimo tratto che chiude la sessione, in millisecondi.
export const INK_SESSION_PAUSE = 1500;
/// Il raggio della gomma, in punti.
const ERASER_RADIUS = 6;
const SVG_NS = "http://www.w3.org/2000/svg";
/// Un PNG trasparente di un pixel: il ripiego quando il browser non disegna
/// su una tela (i test).
const BLANK_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";

export interface RichInkOptions {
  /// Il formato scrive l'inchiostro come disegno (OpenDocument).
  readonly asDrawing?: boolean;
  /// Il PNG di ripiego di un oggetto, in base64. Di serie lo disegna una tela
  /// a doppia densità; i test lo sostituiscono.
  readonly renderPng?: (shape: InkShape, w: number, h: number) => string;
  /// Dice una cosa a chi usa il lettore di schermo.
  readonly announce?: (text: string) => void;
}

/// Un oggetto d'inchiostro del documento, con i suoi tratti al loro posto.
interface InkAtom {
  readonly pos: number;
  readonly node: PmNode;
  /// L'angolo dell'oggetto e quello del paragrafo dell'ancora, in punti
  /// dall'angolo del testo.
  readonly x: number;
  readonly y: number;
  readonly anchorLeft: number;
  readonly anchorTop: number;
  readonly traces: InkTrace[];
}

/// Un tratto scelto col lazo: di quale oggetto, e quale.
interface Picked {
  readonly atom: number;
  readonly stroke: number;
}

export class RichInk {
  readonly #engine: RichEngine;
  readonly #options: RichInkOptions;
  readonly #life: Lifetime = openLifetime();
  readonly #listeners = new Set<() => void>();
  #tool: RichInkTool = "select";
  #penColor = INK_DEFAULT_COLOR;
  #penWidth = INK_DEFAULT_WIDTH;
  /// La penna della Penna, dalla galleria (P15): le stesse del disegno.
  #pen: PenId = DEFAULT_PEN;
  #markerColor = INK_HIGHLIGHTER_COLOR;
  #markerWidth = INK_HIGHLIGHTER_WIDTH;
  #touch: TouchPolicy = "auto";
  #wholeStrokes = true;
  #veil: HTMLElement | null = null;
  #veilLife: Lifetime | null = null;
  #input: InkInput | null = null;
  #layer: SVGGElement | null = null;
  #live: SVGPathElement | null = null;
  /// I tratti della sessione aperta, in punti dall'angolo del testo.
  #pending: InkTrace[] = [];
  #drawing: { samples: InkSample[]; predicted: InkSample[]; pressure: boolean } | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #picked: Picked[] = [];
  #destroyed = false;

  constructor(engine: RichEngine, options: RichInkOptions = {}) {
    this.#engine = engine;
    this.#options = options;
    this.#life.add(() => this.#cancelTimer());
  }

  get tool(): RichInkTool {
    return this.#tool;
  }

  /// Il colore e lo spessore dello strumento di adesso (la penna, se non è
  /// uno strumento che scrive).
  get color(): string {
    return this.#tool === "highlighter" ? this.#markerColor : this.#penColor;
  }

  /// La penna della Penna.
  get pen(): PenId {
    return this.#pen;
  }

  get width(): number {
    return this.#tool === "highlighter" ? this.#markerWidth : this.#penWidth;
  }

  /// La posizione dello spessore (Sottile, Medio, Spesso) dello strumento.
  get widthIndex(): number {
    const widths = this.#tool === "highlighter" ? INK_HIGHLIGHTER_WIDTHS : INK_WIDTHS;
    return widths.findIndex((each) => each.value === this.width);
  }

  get touch(): TouchPolicy {
    return this.#touch;
  }

  get wholeStrokes(): boolean {
    return this.#wholeStrokes;
  }

  /// I tratti della sessione aperta, non ancora nel documento.
  get pending(): readonly InkTrace[] {
    return this.#pending;
  }

  /// I tratti scelti col lazo.
  get picked(): number {
    return this.#picked.length;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  /// Sceglie lo strumento. «Seleziona» toglie il velo e torna al testo; in
  /// sola lettura non si sceglie altro.
  setTool(tool: RichInkTool): void {
    if (this.#destroyed) return;
    if (tool !== "select" && !this.#engine.editable()) tool = "select";
    this.commit();
    this.#picked = [];
    this.#tool = tool;
    if (tool === "select") this.#removeVeil();
    else this.#ensureVeil();
    this.#paintPicked();
    this.#changed();
  }

  setColor(color: string): void {
    if (this.#tool === "highlighter") this.#markerColor = color;
    else this.#penColor = color;
    this.#changed();
  }

  /// Sceglie la penna della Penna; l'evidenziatore resta il suo. Lo
  /// strumento diventa la Penna, come nella galleria del disegno.
  setPen(pen: PenId): void {
    if (this.#destroyed || PENS[pen].tool !== "pen") return;
    this.#pen = pen;
    if (this.#tool !== "pen") this.setTool("pen");
    this.#changed();
  }

  /// Lo spessore per posizione: 0 sottile, 1 medio, 2 spesso.
  setWidth(index: number): void {
    const widths = this.#tool === "highlighter" ? INK_HIGHLIGHTER_WIDTHS : INK_WIDTHS;
    const width = widths[index];
    if (!width) return;
    if (this.#tool === "highlighter") this.#markerWidth = width.value;
    else this.#penWidth = width.value;
    this.#changed();
  }

  /// «Disegna con la penna»: il dito scorre la pagina invece di disegnare.
  setTouch(policy: TouchPolicy): void {
    this.#touch = policy;
    this.#input?.setTouchPolicy(policy);
    this.#changed();
  }

  setWholeStrokes(whole: boolean): void {
    this.#wholeStrokes = whole;
    this.#changed();
  }

  // ── Il velo ──────────────────────────────────────────────────────────

  #ensureVeil(): void {
    const content = this.#engine.contentElement();
    const desk = content.parentElement;
    if (!desk) return;
    if (!this.#veil) {
      const veil = document.createElement("div");
      veil.className = "rich-ink-veil";
      veil.tabIndex = -1;
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("aria-hidden", "true");
      const layer = document.createElementNS(SVG_NS, "g");
      svg.append(layer);
      veil.append(svg);
      desk.append(veil);
      this.#veil = veil;
      this.#layer = layer;
      const life = openLifetime();
      this.#veilLife = life;
      life.listen(veil, "keydown", (event) => this.#key(event));
      life.listen(veil, "pointerdown", (event) => this.#pointerDown(event));
    }
    this.#veil.dataset.tool = this.#tool;
    this.#veil.setAttribute("aria-label", t(`rich.ink.${this.#tool}` as Key));
    this.#input?.destroy();
    this.#input = null;
    if (this.#tool === "pen" || this.#tool === "highlighter") this.#attachInput();
    this.#placeLayer();
  }

  #removeVeil(): void {
    const { veil, life } = { veil: this.#veil, life: this.#veilLife };
    this.#veil = null;
    this.#veilLife = null;
    this.#layer = null;
    this.#live = null;
    this.#input?.destroy();
    this.#input = null;
    // Un gesto a metà si chiude senza scrivere: il velo non c'è più.
    life?.close();
    veil?.remove();
  }

  /// I disegni del velo stanno in punti dall'angolo del testo.
  #placeLayer(): void {
    if (!this.#veil || !this.#layer) return;
    const content = this.#engine.contentElement().getBoundingClientRect();
    const veil = this.#veil.getBoundingClientRect();
    const zoom = this.#engine.zoom();
    this.#layer.setAttribute("transform", `translate(${(content.left - veil.left) / zoom} ${(content.top - veil.top) / zoom}) scale(${1 / PT})`);
  }

  /// Da coordinate dello schermo a punti dall'angolo del testo.
  #toPoint(clientX: number, clientY: number): InkPoint {
    const content = this.#engine.contentElement().getBoundingClientRect();
    const zoom = this.#engine.zoom();
    return { x: ((clientX - content.left) / zoom) * PT, y: ((clientY - content.top) / zoom) * PT };
  }

  #attachInput(): void {
    const veil = this.#veil;
    const life = this.#veilLife;
    if (!veil || !life) return;
    this.#input = attachInkInput(
      veil,
      {
        toScene: (x, y) => this.#toPoint(x, y),
        touch: this.#touch,
        scale: () => this.#engine.zoom() / PT,
        onStart: (stroke) => {
          this.#cancelTimer();
          this.#placeLayer();
          this.#drawing = { samples: [], predicted: [], pressure: stroke.pressure };
        },
        onSamples: (_id, samples) => this.#drawing?.samples.push(...samples),
        onPredicted: (_id, samples) => {
          if (this.#drawing) this.#drawing.predicted = [...samples];
        },
        onSettled: () => this.#paintLive(),
        onEnd: (stroke) => {
          this.#drawing = null;
          this.#clearLive();
          const hl = this.#tool === "highlighter";
          const points = stroke.samples.map((sample) => ({ x: sample.x, y: sample.y, ...(stroke.pressure && sample.p !== undefined ? { p: sample.p } : {}) }));
          if (points.length === 0) return;
          // La penna di serie non si scrive: il tratto resta com'era prima
          // delle penne.
          const pen = !hl && this.#pen !== DEFAULT_PEN ? { pen: this.#pen } : {};
          this.#pending.push({ color: this.color, width: this.width, hl, points, ...pen });
          this.#paintPending();
          this.#armTimer();
          this.#changed();
        },
        onCancel: () => {
          this.#drawing = null;
          this.#clearLive();
        },
      },
      life,
    );
  }

  // ── L'anteprima ──────────────────────────────────────────────────────

  #path(d: string, color: string, hl: boolean, pen?: PenId): SVGPathElement {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", color);
    const opacity = lineOpacity({ color, width: 1, xy: [], ...(hl ? { hl } : {}), ...(pen === undefined ? {} : { pen }) });
    if (opacity !== null) path.setAttribute("fill-opacity", String(opacity));
    if (hl) path.setAttribute("class", "rich-ink-highlight");
    return path;
  }

  #paintLive(): void {
    const drawing = this.#drawing;
    if (!drawing || !this.#layer) return;
    const hl = this.#tool === "highlighter";
    const pen = hl || this.#pen === DEFAULT_PEN ? undefined : this.#pen;
    const brush = pen !== undefined
      ? penBrush(pen, this.width, drawing.pressure)
      : (hl ? HIGHLIGHTER : PEN).brush(this.width, { pressure: drawing.pressure, continued: false });
    const outline = previewOutline(drawing.samples, drawing.predicted, brush, false);
    const d = outline.length > 2 ? outlinePath(outline) : "";
    if (!this.#live) {
      this.#live = this.#path(d, this.color, hl, pen);
      this.#live.classList.add("rich-ink-live");
      this.#layer.append(this.#live);
    } else {
      this.#live.setAttribute("d", d);
    }
  }

  #clearLive(): void {
    this.#live?.remove();
    this.#live = null;
  }

  #paintPending(): void {
    const layer = this.#layer;
    if (!layer) return;
    for (const old of [...layer.querySelectorAll(".rich-ink-pending")]) old.remove();
    for (const trace of this.#pending) {
      const d = lineOutline(lineOf(trace));
      if (!d) continue;
      const path = this.#path(d, trace.color, trace.hl, trace.pen);
      path.classList.add("rich-ink-pending");
      layer.append(path);
    }
  }

  #paintPicked(): void {
    const layer = this.#layer;
    if (!layer) return;
    for (const old of [...layer.querySelectorAll(".rich-ink-picked")]) old.remove();
    if (this.#picked.length === 0) return;
    const atoms = this.#atoms();
    const traces = this.#picked.flatMap((pick) => (atoms[pick.atom]?.traces[pick.stroke] ? [atoms[pick.atom]!.traces[pick.stroke]!] : []));
    const box = boxOf(traces);
    if (!box) return;
    const frame = document.createElementNS(SVG_NS, "rect");
    for (const [name, value] of [["x", box.x], ["y", box.y], ["width", box.w], ["height", box.h]] as const) frame.setAttribute(name, String(value));
    frame.setAttribute("class", "rich-ink-picked");
    frame.setAttribute("fill", "none");
    frame.setAttribute("stroke", "currentColor");
    frame.setAttribute("stroke-dasharray", "3 2");
    frame.setAttribute("vector-effect", "non-scaling-stroke");
    layer.append(frame);
  }

  // ── La sessione ──────────────────────────────────────────────────────

  #armTimer(): void {
    this.#cancelTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.commit();
    }, INK_SESSION_PAUSE);
  }

  #cancelTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /// I tratti della sessione entrano nel documento come un oggetto, in un
  /// passo di Annulla. Senza tratti non fa niente.
  commit(): void {
    this.#cancelTimer();
    if (this.#pending.length === 0) return;
    const traces = this.#pending;
    this.#pending = [];
    this.#paintPending();
    const box = boxOf(traces);
    if (!box || !this.#engine.editable()) return;
    const done = this.#insert(box);
    if (!done) this.#options.announce?.(t("rich.ink.refused"));
    this.#changed();
  }

  #png(shape: InkShape, w: number, h: number): string {
    if (this.#options.renderPng) return this.#options.renderPng(shape, w, h);
    return renderInkPng(shape, w, h) ?? BLANK_PNG;
  }

  /// L'oggetto di `box`, ancorato al primo paragrafo che lo accoglie, dal più
  /// vicino.
  #insert(box: InkBox): boolean {
    const paragraphs = this.#paragraphs().sort((a, b) => Math.abs(a.top - box.y) - Math.abs(b.top - box.y) || a.top - b.top);
    // Il paragrafo che contiene l'angolo in alto vince sul più vicino.
    const holding = paragraphs.findIndex((each) => each.top <= box.y && box.y < each.bottom);
    if (holding > 0) paragraphs.unshift(...paragraphs.splice(holding, 1));
    const data = this.#png(box.shape, box.w, box.h);
    for (const paragraph of paragraphs) {
      const place: Place = { wrap: "front", x: round(box.x - paragraph.left), y: round(box.y - paragraph.top) };
      const node = this.#atomNode(box, data, place);
      const done = this.#engine.apply((state, dispatch) => {
        // Una sessione è un passo suo, anche subito dopo un'altra.
        if (dispatch) dispatch(closeHistory(state.tr.insert(paragraph.pos + 1, node)));
        return true;
      }, false);
      if (done) return true;
    }
    return false;
  }

  #atomNode(box: InkBox, data: string, place: Place): PmNode {
    const common = { k: null, label: "", w: box.w, h: box.h, data, note: null, end: false, toc: null, comment: null };
    if (this.#options.asDrawing) {
      return richSchema.nodes.atom.create({ ...common, kind: "drawing", ink: null, svg: shapeSvg(box.shape, box.w, box.h), float: null });
    }
    return richSchema.nodes.atom.create({ ...common, kind: "ink", ink: box.shape, svg: null, float: place });
  }

  /// I paragrafi del corpo (non nelle tabelle) che si vedono, in punti
  /// dall'angolo del testo.
  #paragraphs(): Array<{ pos: number; left: number; top: number; bottom: number }> {
    const out: Array<{ pos: number; left: number; top: number; bottom: number }> = [];
    const content = this.#engine.contentElement().getBoundingClientRect();
    const zoom = this.#engine.zoom();
    this.#engine.state.doc.forEach((node, pos) => {
      if (node.type !== richSchema.nodes.para) return;
      const rect = this.#engine.elementAt(pos)?.getBoundingClientRect();
      if (!rect) return;
      out.push({
        pos,
        left: ((rect.left - content.left) / zoom) * PT,
        top: ((rect.top - content.top) / zoom) * PT,
        bottom: ((rect.bottom - content.top) / zoom) * PT,
      });
    });
    return out;
  }

  /// Gli oggetti d'inchiostro coi loro tratti al loro posto.
  #atoms(): InkAtom[] {
    const out: InkAtom[] = [];
    const content = this.#engine.contentElement().getBoundingClientRect();
    const zoom = this.#engine.zoom();
    const at = (rect: DOMRect) => ({ x: ((rect.left - content.left) / zoom) * PT, y: ((rect.top - content.top) / zoom) * PT });
    const state = this.#engine.state;
    state.doc.descendants((node, pos) => {
      if (node.type !== richSchema.nodes.atom) return true;
      const shape = node.attrs.ink as InkShape | null;
      if (node.attrs.kind !== "ink" || !shape) return false;
      const element = this.#engine.elementAt(pos);
      if (!element) return false;
      const corner = at(element.getBoundingClientRect());
      const $pos = state.doc.resolve(pos);
      const paragraph = this.#engine.elementAt($pos.before($pos.depth));
      const anchor = paragraph ? at(paragraph.getBoundingClientRect()) : corner;
      out.push({ pos, node, x: corner.x, y: corner.y, anchorLeft: anchor.x, anchorTop: anchor.y, traces: tracesOf(shape, corner.x, corner.y) });
      return false;
    });
    return out;
  }

  /// Riscrive gli oggetti cambiati (`next`, per indice in `atoms`) in una
  /// transazione: un oggetto senza tratti si toglie.
  #rewrite(atoms: readonly InkAtom[], next: ReadonlyMap<number, InkTrace[]>): boolean {
    if (next.size === 0) return false;
    return this.#engine.apply((state: EditorState, dispatch?: (tr: Transaction) => void) => {
      let tr = state.tr;
      // Dal fondo, così le posizioni prima restano valide.
      for (const index of [...next.keys()].sort((a, b) => atoms[b]!.pos - atoms[a]!.pos)) {
        const atom = atoms[index]!;
        const box = boxOf(next.get(index)!);
        if (!box) {
          tr = tr.delete(atom.pos, atom.pos + atom.node.nodeSize);
          continue;
        }
        const old = atom.node.attrs.float as Place | null;
        const place: Place = { wrap: old?.wrap ?? "front", x: round(box.x - atom.anchorLeft), y: round(box.y - atom.anchorTop) };
        const node = this.#atomNode(box, this.#png(box.shape, box.w, box.h), place);
        // Un inchiostro tenuto cambiato è nuovo; il testo alternativo resta.
        tr = tr.replaceWith(atom.pos, atom.pos + atom.node.nodeSize, node.type.create({ ...node.attrs, label: atom.node.attrs.label }));
      }
      dispatch?.(tr);
      return true;
    }, false);
  }

  // ── Gomma e lazo ─────────────────────────────────────────────────────

  #pointerDown(event: PointerEvent): void {
    if (this.#tool !== "eraser" && this.#tool !== "lasso") return;
    if (event.button !== 0 || !this.#veil || !this.#veilLife) return;
    event.preventDefault();
    this.#veil.focus({ preventScroll: true });
    this.#placeLayer();
    const start = this.#toPoint(event.clientX, event.clientY);
    const gesture = openLifetime();
    const life = this.#veilLife;
    life.add(() => gesture.close());
    try {
      this.#veil.setPointerCapture(event.pointerId);
    } catch {
      // Un puntatore finto (i test) non si cattura.
    }
    if (this.#tool === "eraser") {
      this.#eraseAt(start);
      gesture.listen(this.#veil, "pointermove", (move) => this.#eraseAt(this.#toPoint(move.clientX, move.clientY)));
    } else {
      this.#lasso(start, gesture);
    }
    const end = () => gesture.close();
    gesture.listen(this.#veil, "pointerup", end);
    gesture.listen(this.#veil, "pointercancel", end);
  }

  #eraseAt(spot: InkPoint): void {
    const atoms = this.#atoms();
    const next = new Map<number, InkTrace[]>();
    atoms.forEach((atom, index) => {
      const left = erase(atom.traces, spot, ERASER_RADIUS, this.#wholeStrokes);
      if (left) next.set(index, left);
    });
    if (this.#rewrite(atoms, next)) this.#changed();
  }

  #lasso(start: InkPoint, gesture: Lifetime): void {
    const veil = this.#veil!;
    const atoms = this.#atoms();
    const picked = this.#picked;
    const pickedTraces = picked.flatMap((pick) => (atoms[pick.atom]?.traces[pick.stroke] ? [atoms[pick.atom]!.traces[pick.stroke]!] : []));
    const box = boxOf(pickedTraces);
    // Dentro i tratti scelti il trascinamento li sposta; altrove si disegna
    // un lazo nuovo.
    if (box && start.x >= box.x && start.x <= box.x + box.w && start.y >= box.y && start.y <= box.y + box.h) {
      let last = start;
      gesture.listen(veil, "pointermove", (move) => (last = this.#toPoint(move.clientX, move.clientY)));
      gesture.add(() => {
        const dx = last.x - start.x;
        const dy = last.y - start.y;
        if (Math.hypot(dx, dy) < 0.5 || this.#veil !== veil) return;
        this.#movePicked(atoms, dx, dy);
      });
      return;
    }
    const ring: InkPoint[] = [start];
    const outline = document.createElementNS(SVG_NS, "polyline");
    outline.setAttribute("class", "rich-ink-lasso");
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "currentColor");
    outline.setAttribute("stroke-dasharray", "2 2");
    outline.setAttribute("vector-effect", "non-scaling-stroke");
    this.#layer?.append(outline);
    gesture.listen(veil, "pointermove", (move) => {
      ring.push(this.#toPoint(move.clientX, move.clientY));
      outline.setAttribute("points", ring.map((p) => `${p.x},${p.y}`).join(" "));
    });
    gesture.add(() => {
      outline.remove();
      if (this.#veil !== veil) return;
      this.#picked = [];
      atoms.forEach((atom, a) => atom.traces.forEach((trace, s) => {
        if (lassoed(trace, ring)) this.#picked.push({ atom: a, stroke: s });
      }));
      this.#paintPicked();
      this.#changed();
    });
  }

  #movePicked(atoms: readonly InkAtom[], dx: number, dy: number): void {
    const next = new Map<number, InkTrace[]>();
    for (const pick of this.#picked) {
      const traces = next.get(pick.atom) ?? [...atoms[pick.atom]!.traces];
      traces[pick.stroke] = moved([traces[pick.stroke]!], dx, dy)[0]!;
      next.set(pick.atom, traces);
    }
    if (this.#rewrite(atoms, next)) {
      // Gli oggetti riscritti hanno gli stessi tratti nello stesso ordine.
      this.#paintPicked();
      this.#changed();
    }
  }

  /// Toglie i tratti scelti col lazo.
  deletePicked(): boolean {
    if (this.#picked.length === 0) return false;
    const atoms = this.#atoms();
    const drop = new Map<number, Set<number>>();
    for (const pick of this.#picked) drop.set(pick.atom, (drop.get(pick.atom) ?? new Set()).add(pick.stroke));
    const next = new Map<number, InkTrace[]>();
    for (const [index, strokes] of drop) next.set(index, atoms[index]!.traces.filter((_, s) => !strokes.has(s)));
    this.#picked = [];
    const done = this.#rewrite(atoms, next);
    this.#paintPicked();
    this.#changed();
    return done;
  }

  #key(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.#picked.length > 0) {
        this.#picked = [];
        this.#paintPicked();
        this.#changed();
      } else {
        this.setTool("select");
        this.#engine.focus();
      }
    } else if ((event.key === "Delete" || event.key === "Backspace") && this.#tool === "lasso") {
      if (this.deletePicked()) event.preventDefault();
    }
  }

  /// Chiude la sessione (i tratti entrano nel documento) e toglie il velo.
  destroy(): void {
    if (this.#destroyed) return;
    this.commit();
    this.#destroyed = true;
    this.#removeVeil();
    this.#life.close();
    this.#listeners.clear();
  }
}

const round = (value: number): number => Math.round(value * 100) / 100;

/// Il tratto `trace` nella forma della proiezione, alle sue coordinate.
function lineOf(trace: InkTrace) {
  const pressured = trace.points.every((point) => point.p !== undefined);
  return {
    color: trace.color,
    width: trace.width,
    ...(trace.hl ? { hl: true } : {}),
    xy: trace.points.flatMap((point) => [point.x, point.y]),
    ...(pressured ? { p: trace.points.map((point) => point.p!) } : {}),
    ...(trace.pen !== undefined && !trace.hl ? { pen: trace.pen } : {}),
  };
}

/// Il PNG di ripiego di un oggetto d'inchiostro, a doppia densità, in base64;
/// `null` se il browser non disegna su una tela.
export function renderInkPng(shape: InkShape, w: number, h: number): string | null {
  const density = (2 * 4) / 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w * density));
  canvas.height = Math.max(1, Math.ceil(h * density));
  const context = canvas.getContext?.("2d");
  if (!context || typeof Path2D !== "function") return null;
  context.scale(density, density);
  for (const line of shape.strokes) {
    const d = lineOutline(line);
    if (!d) continue;
    context.globalAlpha = lineOpacity(line) ?? 1;
    context.globalCompositeOperation = line.hl ? "multiply" : "source-over";
    context.fillStyle = line.color;
    context.fill(new Path2D(d));
  }
  const url = canvas.toDataURL("image/png");
  const comma = url.indexOf(",");
  return url.startsWith("data:image/png") && comma > 0 ? url.slice(comma + 1) : null;
}
