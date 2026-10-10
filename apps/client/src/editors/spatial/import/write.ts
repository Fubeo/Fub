// Lo scrittore dei diagrammi importati: dal diagramma letto (`diagram.ts`) al
// testo di un disegno nuovo di FubDraw, con le stesse operazioni e lo stesso
// seguito dell'editor, come i modelli di «Nuovo disegno» (`templates/`).
//
// - **Il file è quello che FubDraw scriverebbe.** Le forme sono quelle degli
//   strumenti e del pannello «Forme», le etichette e i connettori quelli dei
//   loro strumenti; il motore, col seguito dell'editor, mette le etichette al
//   centro, fa passare i connettori fra gli oggetti e colora le punte.
// - **Un passo solo per il contenuto.** Tutti gli oggetti entrano in un
//   `batch`, livello per livello e nell'ordine del file, e il seguito li
//   sistema insieme: un diagramma di mille oggetti non riscrive il testo
//   mille volte. Un diagramma che non sta in un `batch` va in più passi, e i
//   connettori si ricalcolano alla fine.
// - **Vicino all'origine.** Il disegno si sposta tutto insieme, di numeri
//   interi, perché cominci a un margine dall'angolo; la pagina è poi quella
//   di «Adatta la pagina al disegno». Ciò che si sa solo scrivendo, come il
//   posto di un'etichetta accanto alla sua linea, può sporgere: allora il
//   disegno si scrive di nuovo, spostato di quanto la pagina non comincia
//   nell'angolo.
// - **Prima i contenuti, poi i blocchi.** Un oggetto o un livello bloccato
//   lo diventa all'ultimo passo: il motore non scrive dentro ciò che è
//   bloccato.

import { PF1_DEFAULTS, type Pf1Brush } from "../ink/brush";
import { INK_MAX_SAMPLES, quantizeInk, type InkSample } from "../ink/sample";
import { formatNumber } from "../number";
import { PaintBuilder, type Page } from "../painter/paint";
import { connectorSegments, MAX_ELBOW_POINTS, writeLabelPlace, type ConnectorEnd, type ConnectorKind, type LabelPlace } from "../scene/connectors";
import { SceneEngine } from "../scene/engine";
import { BoundsBuilder, chords, Track, type Bounds, type Segment } from "../scene/geometry";
import type { IdKind } from "../scene/ids";
import { apply, compose, IDENTITY, rotate, translate, type Matrix, type Point } from "../scene/matrix";
import type { DocumentModel, ElementPart } from "../scene/model";
import { MAX_BATCH, MAX_NESTING, MAX_OP_BYTES, type Op } from "../scene/ops";
import { MAX_BOARDS } from "../scene/read";
import { pathData, type Elem } from "../scene/serialize";
import { elemOf, nodeOf } from "../tools/arrange";
import { addBoardOps, boardsOf, pageBoardOps, rectText, renameBoardOps, type Rect } from "../tools/boards";
import { connectorElem, followConnectors, LABEL_GAP, labelCentre, labelPlace, sceneRoute } from "../tools/connectors";
import { cropOps } from "../tools/crop";
import { fittedPage, gesture, NewIds, strokeElem, transformValue } from "../tools/edit";
import { effectsOps, effectsRefusal, followEffects, type Effect } from "../tools/effects";
import { hatchElem, hatchFallback, clampSpacing, clampWidth, presetHatch, type Hatch } from "../tools/hatches";
import { SceneIndexer, shapeSegments, type Unit } from "../tools/hit";
import { imageElem } from "../tools/images";
import { elemTextBox } from "../tools/label-hosts";
import { ASCENT_EM, DESCENT_EM, followLabels, LABEL_PAD } from "../tools/labels";
import { libraryElem } from "../tools/library-insert";
import { initialText } from "../tools/look";
import type { Measure } from "../tools/measure";
import { dashValue, type Cap } from "../tools/outline";
import { DEFAULT_COLOR, DEFAULT_WIDTH } from "../tools/palette";
import { homeOf } from "../tools/resources";
import { lineText, richElem, tidyRich, type Rich, type RichLine, type Span } from "../tools/rich";
import { libraryShape } from "../tools/shape-library";
import { shapeElem } from "../tools/shapes";
import { followTips, Shelf, type TipEnd } from "../tools/tips";
import { HYPHENS, joinOf, unwrap, WRAP, wrapParagraphs, wrapValue, type Wrapped } from "../tools/wrap";
import { smoothSegments } from "./curves";
import type { Content, Diagram, End, Fill, Flip, Frame, Hook, InkNode, Layer, LineNode, Look, Node, PathNode, Run, ShapeNode, Spin, TextNode, Type } from "./diagram";

/// Il margine fra l'angolo della pagina e il disegno: quello di «Adatta la
/// pagina al disegno».
const MARGIN = 20;

/// Un numero come lo scrive il file.
const n = (value: number): string => formatNumber(value, 2);

/// Quanti gruppi uno dentro l'altro si scrivono: il file ne tiene
/// [`MAX_NESTING`] livelli, e il livello, un'etichetta e una forma della
/// raccolta fatta di più pezzi ne prendono altri. Un gruppo più dentro
/// lascia i suoi oggetti nel gruppo che lo contiene.
const MAX_GROUPS = MAX_NESTING - 8;

/// L'ombra che getta un oggetto: quella che draw.io disegna, spostata di 3
/// in basso a destra, sfocata di 1,7 e blu ardesia al 40%. FubDraw scrive la
/// metà della sfocatura come deviazione, come draw.io.
const SHADOW: Effect = { kind: "shadow", dx: 3, dy: 3, blur: 3.4, color: "#3d4574", opacity: 0.4, hidden: false };

/// Quanti oggetti prendono l'ombra in un passo.
const SHADOW_BATCH = 500;

/// Ciò che serve allo scrittore oltre al diagramma: il titolo, il metro del
/// testo, i nomi di partenza nella lingua di chi importa e gli id.
export interface Setup {
  readonly title: string;
  readonly measure: Measure;
  /// «Livello 1», «Tavola 1»: i nomi che l'editor dà a ciò che non ne ha.
  readonly layerName: (n: number) => string;
  readonly boardName: (n: number) => string;
  /// Il nome di una forma della raccolta, dalla sua chiave.
  readonly shapeName: (key: string) => string;
  /// Gli id nuovi; senza, casuali come quelli dell'editor.
  readonly ids?: (taken: (id: string) => boolean) => NewIds;
}

/// Un diagramma che non sta in un disegno: più grande, o con più oggetti,
/// tavole o risorse di quanti un disegno ne tiene.
export class TooLarge extends Error {}

/// Il testo del disegno che `diagram` diventa. Lancia [`TooLarge`] se non
/// sta in un disegno.
export function writeDiagram(diagram: Diagram, setup: Setup): string {
  const writer = new Writer(diagram, setup, [0, 0]);
  const text = writer.run();
  const [x, y] = writer.corner();
  return x === 0 && y === 0 ? text : new Writer(diagram, setup, [-x, -y]).run();
}

/// Il testo di un `title`, `desc` o attributo come lo vuole XML.
const escaped = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/// `text` col titolo `title`: il primo `<title>`, quello della radice, che
/// `startText` scrive prima di ogni oggetto.
export function retitled(text: string, title: string): string {
  return text.replace(/<title>[^<]*<\/title>/, () => `<title>${escaped(title)}</title>`);
}

/// Il documento nuovo del provider dei disegni, come in `templates/sheet.ts`:
/// la radice 1600 × 1000, il titolo, la carta col colore `paper` e il primo
/// livello. Il nome della radice sta in una costante: nessun file del client
/// scrive quell'elemento a mano fuori dalle prove.
function startText(title: string, paper: string, layer: Layer, name: string, id: string): string {
  const root = "svg";
  const hidden = layer.hidden ? ' display="none"' : "";
  return [
    `<${root} xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">`,
    `  <title>${escaped(title)}</title>`,
    `  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="${paper}"/>`,
    `  <g id="${id}" fub:layer="${escaped(name)}"${hidden}>`,
    "  </g>",
    `</${root}>`,
    "",
  ].join("\n");
}

/// Gli id nuovi che cominciano da uno già scelto: il primo `object` che si
/// chiede è `first`, e poi decide `inner`. Serve a dare l'id deciso prima a
/// ciò che costruisce un comando di `tools/`.
class Starting extends NewIds {
  private first: string | null;

  constructor(
    first: string,
    private readonly inner: NewIds,
  ) {
    super(() => false);
    this.first = first;
  }

  override next(kind: IdKind): string {
    if (kind === "object" && this.first !== null) {
      const id = this.first;
      this.first = null;
      return id;
    }
    return this.inner.next(kind);
  }
}

/// I tag di una forma chiusa: quelli che prendono il riempimento in una
/// forma della raccolta fatta di più pezzi.
const CLOSED_TAGS: ReadonlySet<string> = new Set(["rect", "ellipse", "circle", "polygon"]);

/// Vero se `elem`, un pezzo di una forma della raccolta, è chiuso.
function closedPiece(elem: Elem): boolean {
  if (CLOSED_TAGS.has(elem.tag)) return true;
  return elem.tag === "path" && /[zZ]\s*$/.test(elem.attrs.d ?? "");
}

/// Gli attributi di un testo da `type`: il colore, il carattere, il corpo e
/// le enfasi che non sono quelle di partenza.
function typeAttrs(type: Type): Record<string, string> {
  const attrs: Record<string, string> = { fill: type.color, "font-family": type.family, "font-size": n(type.size) };
  if (type.bold) attrs["font-weight"] = "bold";
  if (type.italic) attrs["font-style"] = "italic";
  const lines = [type.underline ? "underline" : null, type.strike ? "line-through" : null].filter((each) => each !== null);
  if (lines.length > 0) attrs["text-decoration"] = lines.join(" ");
  return attrs;
}

/// Gli attributi di un pezzo che si scosta da `base`: soltanto ciò che
/// cambia; `null` se niente.
function runAttrs(base: Type, run: Run): Record<string, string> | null {
  const type = run.type;
  if (type === null) return null;
  const attrs: Record<string, string> = {};
  if (type.color !== undefined && type.color !== base.color) attrs.fill = type.color;
  if (type.family !== undefined && type.family !== base.family) attrs["font-family"] = type.family;
  if (type.size !== undefined && n(type.size) !== n(base.size)) attrs["font-size"] = n(type.size);
  if (type.bold !== undefined && type.bold !== base.bold) attrs["font-weight"] = type.bold ? "bold" : "normal";
  if (type.italic !== undefined && type.italic !== base.italic) attrs["font-style"] = type.italic ? "italic" : "normal";
  const underline = type.underline ?? base.underline;
  const strike = type.strike ?? base.strike;
  if (underline !== base.underline || strike !== base.strike) {
    const lines = [underline ? "underline" : null, strike ? "line-through" : null].filter((each) => each !== null);
    attrs["text-decoration"] = lines.length === 0 ? "none" : lines.join(" ");
  }
  return Object.keys(attrs).length === 0 ? null : attrs;
}

/// Il testo `content` come lo scrive l'editor, senza posto: gli attributi
/// del carattere, l'ancora se non è quella di partenza, e un paragrafo per
/// riga, a `leading` volte il corpo l'una dall'altra.
function draftOf(content: Content, extra: Readonly<Record<string, string>> = {}): Rich {
  const attrs: Record<string, string> = { ...typeAttrs(content.type), ...extra };
  if (content.align !== "start") attrs["text-anchor"] = content.align;
  const leading = n(content.leading * content.type.size);
  const lines: RichLine[] = content.paragraphs.map((runs, i) => ({
    attrs: { dy: i === 0 ? "0" : leading },
    spans: runs.length === 0 ? [{ text: "", attrs: null }] : runs.map((run): Span => ({ text: run.text, attrs: runAttrs(content.type, run) })),
  }));
  return { attrs, inherited: initialText(), lines: lines.length === 0 ? [{ attrs: { dy: "0" }, spans: [{ text: "", attrs: null }] }] : lines };
}

/// Il corpo più piccolo di un testo che va a capo, in volte il suo. Il
/// carattere di FubDraw può essere più largo di quello del file, e una
/// parola che lì stava su una riga qui si spezzerebbe: il testo scende di
/// corpo quanto basta perché nessuna si spezzi, fino a qui. Una parola che
/// non ci sta nemmeno così si spezzava già nel file.
const FIT_LEAST = 0.6;

/// I passi della ricerca del corpo che ci sta.
const FIT_STEPS = 6;

/// `content` col corpo, suo e dei pezzi, volte `scale`, a mezza unità.
function scaled(content: Content, scale: number): Content {
  if (scale === 1) return content;
  const size = (value: number): number => Math.max(1, Math.floor(value * scale * 2) / 2);
  return {
    ...content,
    type: { ...content.type, size: size(content.type.size) },
    paragraphs: content.paragraphs.map((runs) => runs.map((run): Run => (run.type?.size === undefined ? run : { ...run, type: { ...run.type, size: size(run.type.size) } }))),
  };
}

/// I passi lungo la linea, da una parte e dall'altra del punto del file, in
/// cui si cerca il posto di un'etichetta di connettore, e quanto è lungo un
/// passo, in parti della linea.
const SPREAD_STEPS = 6;
const SPREAD_STEP = 0.05;

/// Quanto costa un'etichetta di connettore spostata lungo la linea, per
/// unità di strada e di altezza, e messa sotto la linea, per unità d'area:
/// meno di quanto costa coprire qualcosa.
const SPREAD_SLIDE = 0.25;
const SPREAD_SIDE = 0.02;

/// Quanto costa coprire un testo, per unità d'area: più di una forma.
const SPREAD_TEXT = 3;

/// Ciò che un'etichetta di connettore può coprire: un testo, una cosa
/// piena, o delle righe, come una linea o il contorno di una forma vuota.
type Mark =
  | { readonly kind: "text" | "solid"; readonly box: Bounds }
  | { readonly kind: "lines"; readonly box: Bounds; readonly chords: readonly (readonly [Point, Point])[] };

/// Il segno delle righe `parts`.
function lineMark(parts: readonly (readonly [Point, Point])[]): Mark {
  const box = new BoundsBuilder();
  for (const [a, b] of parts) {
    box.include(a);
    box.include(b);
  }
  return { kind: "lines", box: box.finish() ?? { min: [0, 0], max: [0, 0] }, chords: parts };
}

/// Quanto costa che l'etichetta in `box`, alta `height`, copra `mark`: l'area
/// coperta, e per le righe la loro strada sotto l'etichetta per la sua
/// altezza.
function markCost(mark: Mark, box: Bounds, height: number): number {
  if (mark.kind !== "lines") return overlap(mark.box, box) * (mark.kind === "text" ? SPREAD_TEXT : 1);
  if (!touches(mark.box, box)) return 0;
  let run = 0;
  for (const part of mark.chords) run += within(part, box);
  return run * height;
}

/// L'area comune di due riquadri.
function overlap(a: Bounds, b: Bounds): number {
  const w = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const h = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/// Vero se due riquadri si toccano, anche solo sul bordo: una linea dritta
/// ha un riquadro sottile.
const touches = (a: Bounds, b: Bounds): boolean => a.min[0] <= b.max[0] && b.min[0] <= a.max[0] && a.min[1] <= b.max[1] && b.min[1] <= a.max[1];

/// Quanto del tratto `a b` sta dentro `box` (Liang e Barsky).
function within([a, b]: readonly [Point, Point], box: Bounds): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  let [lo, hi] = [0, 1];
  const cut = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > hi) return false;
      lo = Math.max(lo, r);
    } else {
      if (r < lo) return false;
      hi = Math.min(hi, r);
    }
    return true;
  };
  if (!cut(-dx, a[0] - box.min[0]) || !cut(dx, box.max[0] - a[0]) || !cut(-dy, a[1] - box.min[1]) || !cut(dy, box.max[1] - a[1])) return 0;
  return hi > lo ? (hi - lo) * Math.hypot(dx, dy) : 0;
}

/// `segment` portato da `m`; un arco resta com'è, e un connettore non ne ha.
function movedSegment(segment: Segment, m: Matrix): Segment {
  switch (segment.kind) {
    case "move":
    case "line":
      return { ...segment, to: apply(m, segment.to) };
    case "quad":
      return { ...segment, control: apply(m, segment.control), to: apply(m, segment.to) };
    case "cubic":
      return { ...segment, c1: apply(m, segment.c1), c2: apply(m, segment.c2), to: apply(m, segment.to) };
    default:
      return segment;
  }
}

/// Il contorno chiuso `segments`, coi punti in frazioni del riquadro `box`,
/// come un tracciato dello strumento Penna; `null` se non ha almeno un
/// tratto.
function outlineElem(segments: readonly Segment[], id: string, box: Bounds, style: { readonly color: string; readonly width: number }): Elem | null {
  if (!segments.some((segment) => segment.kind === "line" || segment.kind === "cubic")) return null;
  const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
  const scale: Matrix = [w, 0, 0, h, box.min[0], box.min[1]];
  return { tag: "path", attrs: { id, d: pathData(segments.map((segment) => movedSegment(segment, scale))), fill: "none", stroke: style.color, "stroke-width": n(style.width) } };
}

/// Vero se `content` non ha niente da leggere.
const emptyContent = (content: Content): boolean => content.paragraphs.every((runs) => runs.every((run) => run.text.trim() === ""));

/// Vero se un oggetto con l'aspetto `look` getta un'ombra: la chiede, e ha
/// un contorno o, se `filled`, un riempimento.
const casts = (look: Look, filled: boolean): boolean => look.shadow === true && (look.stroke !== null || (filled && look.fill !== null));

/// Vero se `node` disegna qualcosa: un gruppo, se lo fa almeno uno dei suoi
/// oggetti.
function drawsAny(node: Node): boolean {
  switch (node.type) {
    case "group":
      return node.children.some(drawsAny);
    case "path":
      return node.points.length >= 2;
    case "ink":
      return node.samples.length > 0;
    default:
      return true;
  }
}

/// Vero se `count` punti fanno la geometria di un connettore `kind`.
function fitsKind(kind: ConnectorKind, count: number): boolean {
  return kind === "straight" ? count === 2 : kind === "curved" ? count === 4 : count >= 2 && count <= MAX_ELBOW_POINTS;
}

/// I campioni di un tratto, al più [`INK_MAX_SAMPLES`]: uno ogni tanto,
/// col primo e l'ultimo.
function fewer<T>(samples: readonly T[]): readonly T[] {
  if (samples.length <= INK_MAX_SAMPLES) return samples;
  const step = (samples.length - 1) / (INK_MAX_SAMPLES - 1);
  return Array.from({ length: INK_MAX_SAMPLES }, (_, i) => samples[Math.round(i * step)]!);
}

/// Ciò che un oggetto del diagramma diventa: l'id dell'elemento più esterno,
/// a cui si aggancia un connettore come lo aggancia lo strumento: una forma
/// con l'etichetta col suo gruppo, una forma di più pezzi col suo.
interface Planned {
  readonly outer: string;
  /// Falso per un connettore, a cui non ci si aggancia.
  readonly attach: boolean;
  /// Il centro del suo riquadro, nella tela d'origine: dove parte un
  /// connettore prima che il seguito lo faccia passare.
  readonly centre: Point;
}

class Writer {
  private engine: SceneEngine | null = null;
  private readonly ids: NewIds;
  private readonly builder = new PaintBuilder();
  private readonly indexer: SceneIndexer;
  private readonly planned = new Map<Node, Planned>();
  private readonly hooks = new Map<string, Planned>();
  private readonly lockedIds: string[] = [];
  private readonly cropped: { readonly id: string; readonly box: Bounds; readonly rect: Bounds }[] = [];
  /// Le risorse nuove: la `defs`, se manca, e le campiture.
  private readonly resources: Op[] = [];
  private home: string | null = null;
  private shelf: Shelf | null = null;
  private dx = 0;
  private dy = 0;
  /// I connettori che tengono il percorso del file: finché il disegno si
  /// scrive, il seguito non li ricalcola.
  private readonly kept = new Set<string>();
  /// Falso nei passi che non spostano niente, come i ritagli e i blocchi:
  /// lì i connettori non si ricalcolano.
  private lines = true;
  /// Le etichette dei connettori, con la linea e il punto del file.
  private readonly alongs: { readonly label: string; readonly line: string; readonly t: number }[] = [];
  /// Gli oggetti che gettano un'ombra, per id.
  private readonly shadowed: string[] = [];

  /// `nudge` sposta il disegno, oltre a quanto lo porta vicino all'origine.
  constructor(
    private readonly diagram: Diagram,
    private readonly setup: Setup,
    private readonly nudge: Point,
  ) {
    const find = (id: string): ElementPart | null => this.engine?.holder(id) ?? null;
    this.ids = (setup.ids ?? ((taken) => new NewIds(taken)))((id) => find(id) !== null);
    this.indexer = new SceneIndexer(this.builder, find);
  }

  /// L'angolo in alto a sinistra della pagina scritta.
  corner(): Point {
    const page = this.builder.build(this.engine!).root.page;
    return page === null ? [0, 0] : [page.x, page.y];
  }

  private get model(): DocumentModel {
    const model = this.engine?.model ?? null;
    if (model === null) throw new Error("il disegno non si legge");
    return model;
  }

  /// Applica un passo. Un rifiuto per i limiti del disegno vuol dire che il
  /// diagramma non ci sta; un altro rifiuto è un errore dello scrittore.
  private step(what: string, ops: readonly Op[]): void {
    const op = gesture(ops);
    if (op === null) return;
    const outcome = this.engine!.apply(op);
    if (outcome.outcome !== "applied" && outcome.reason === "limit") throw new TooLarge(`${what}: ${outcome.detail}`);
    if (outcome.outcome !== "applied") throw new Error(`${what}: il motore rifiuta il passo (${outcome.reason}: ${outcome.detail})`);
  }

  run(): string {
    // Troppe tavole si sanno subito, prima di scrivere il resto.
    if (this.diagram.boards.length > MAX_BOARDS) throw new TooLarge(`tavole: più di ${MAX_BOARDS}`);
    const layers: readonly Layer[] = this.diagram.layers.length > 0 ? this.diagram.layers : [{ name: "", hidden: false, locked: false, nodes: [] }];
    const layerIds = layers.map(() => this.ids.next("layer"));
    const names = layers.map((layer, i) => (layer.name.trim() === "" ? this.setup.layerName(i + 1) : layer.name.trim()));
    this.engine = SceneEngine.open(startText(this.setup.title, this.diagram.background ?? "#ffffff", layers[0]!, names[0]!, layerIds[0]!));
    const find = (id: string): ElementPart | null => this.engine!.holder(id);
    const measure = this.setup.measure;
    this.engine.follow = (model, touched, op) => {
      const labels = followLabels(model, touched, find, measure, op);
      const lines = this.lines ? this.keep(followConnectors(model, touched, find, measure, op)) : null;
      const tips = followTips(model, touched, this.ids, find);
      const regions = followEffects(model, touched, find, measure);
      const ops = [labels, lines, tips, regions].filter((each): each is Op => each !== null);
      return ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { op: "batch", ops };
    };
    // Gli altri livelli, sopra il primo.
    this.step(
      "livelli",
      layers.slice(1).map((layer, i): Op => {
        const attrs: Record<string, string> = { id: layerIds[i + 1]!, "fub:layer": names[i + 1]! };
        if (layer.hidden) attrs.display = "none";
        return { op: "add", parent: "#root", pos: { last: true }, elem: { tag: "g", attrs, children: [] } };
      }),
    );
    this.place(layers);
    for (const layer of layers) for (const node of layer.nodes) this.plan(node, 0);
    this.shelf = new Shelf(this.model, this.ids);
    const adds: Op[] = [];
    layers.forEach((layer, i) => {
      for (const node of layer.nodes) for (const elem of this.build(node, false, 0)) adds.push({ op: "add", parent: layerIds[i]!, pos: { last: true }, elem });
    });
    const first = [...this.resources, ...this.shelf.ops(this.resources.length === 0)];
    const chunks = this.chunks([...first, ...adds]);
    for (const chunk of chunks) this.step("contenuto", chunk);
    if (chunks.length > 1) this.reroute();
    this.lines = false;
    for (const crop of this.cropped) this.crop(crop);
    this.placeKept();
    this.spread();
    this.shadows();
    this.boards();
    this.fit();
    const locks: Op[] = this.lockedIds.map((id) => ({ op: "set", id, attrs: { "fub:locked": "true" } }));
    layers.forEach((layer, i) => {
      if (layer.locked) locks.push({ op: "set", id: layerIds[i]!, attrs: { "fub:locked": "true" } });
    });
    this.step("blocchi", locks);
    return this.engine.text;
  }

  // -- Il posto ----------------------------------------------------------------

  /// Lo spostamento che porta il disegno a [`MARGIN`] dall'angolo: il
  /// riquadro si stima dai numeri del diagramma, e i testi dal loro corpo.
  private place(layers: readonly Layer[]): void {
    const out = new BoundsBuilder();
    const box = (bounds: Bounds, spin: Spin | null): void => {
      const corners: Point[] = [bounds.min, [bounds.max[0], bounds.min[1]], bounds.max, [bounds.min[0], bounds.max[1]]];
      const m = spin === null ? null : compose(translate(spin.centre[0], spin.centre[1]), compose(rotate(spin.angle), translate(-spin.centre[0], -spin.centre[1])));
      for (const [x, y] of corners) out.include(m === null ? [x, y] : [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    };
    const visit = (node: Node): void => {
      switch (node.type) {
        case "shape":
        case "image":
          box(node.box, node.spin);
          return;
        case "text": {
          const size = node.content.type.size;
          const longest = Math.max(0, ...node.content.paragraphs.map((runs) => runs.reduce((sum, run) => sum + run.text.length, 0)));
          const width = node.width ?? longest * 0.6 * size;
          const left = node.content.align === "start" ? 0 : node.content.align === "middle" ? width / 2 : width;
          const height = node.content.leading * size * Math.max(1, node.content.paragraphs.length);
          const top = node.frame === null ? node.at[1] - size : node.frame.top;
          const bottom = node.frame === null ? top + height : Math.max(node.frame.bottom, top + height);
          box({ min: [node.at[0] - left, top], max: [node.at[0] - left + width, bottom] }, node.spin);
          return;
        }
        case "path":
          for (const p of node.points) out.include(p);
          return;
        case "line":
          for (const end of [node.from, node.to]) out.include(end.at);
          return;
        case "ink":
          for (const sample of node.samples) out.include([sample.x, sample.y]);
          return;
        case "group":
          node.children.forEach(visit);
          return;
      }
    };
    for (const layer of layers) layer.nodes.forEach(visit);
    for (const board of this.diagram.boards) box(board.box, null);
    const bounds = out.finish();
    if (bounds === null) return;
    this.dx = Math.round(MARGIN - bounds.min[0]) + this.nudge[0];
    this.dy = Math.round(MARGIN - bounds.min[1]) + this.nudge[1];
  }

  private at(p: Point): Point {
    return [p[0] + this.dx, p[1] + this.dy];
  }

  private moved(box: Bounds): Bounds {
    return { min: this.at(box.min), max: this.at(box.max) };
  }

  /// Il `transform` di `spin`, spostato col disegno; `null` se è dritto.
  private turn(spin: Spin | null, flip: Flip | null = null): string | null {
    const turned = spin !== null && Math.abs(spin.angle % 360) >= 1e-9;
    if (!turned && flip === null) return null;
    let matrix: Matrix = IDENTITY;
    if (flip !== null) {
      const [cx, cy] = this.at(flip.centre);
      matrix = compose(translate(cx, cy), compose([flip.x ? -1 : 1, 0, 0, flip.y ? -1 : 1, 0, 0], translate(-cx, -cy)));
    }
    if (turned) {
      const [cx, cy] = this.at(spin.centre);
      matrix = compose(compose(translate(cx, cy), compose(rotate(spin.angle), translate(-cx, -cy))), matrix);
    }
    return transformValue(matrix);
  }

  // -- Gli id, prima di scrivere -------------------------------------------------

  /// Dà a `node`, e a ciò che contiene, l'id dell'elemento più esterno,
  /// prima di scrivere: un connettore può nominare un oggetto che sta più in
  /// alto di lui. `depth` è quanti gruppi scritti stanno attorno a `node`.
  private plan(node: Node, depth: number): void {
    const outer = this.ids.next("object");
    let centre: Point = [0, 0];
    switch (node.type) {
      case "shape":
      case "image":
        centre = [(node.box.min[0] + node.box.max[0]) / 2, (node.box.min[1] + node.box.max[1]) / 2];
        break;
      case "text":
        centre = node.at;
        break;
      case "path":
      case "ink": {
        const points: readonly Point[] = node.type === "path" ? node.points : node.samples.map((s): Point => [s.x, s.y]);
        const box = new BoundsBuilder();
        for (const p of points) box.include(p);
        const done = box.finish();
        if (done !== null) centre = [(done.min[0] + done.max[0]) / 2, (done.min[1] + done.max[1]) / 2];
        break;
      }
      case "line":
        centre = node.from.at;
        break;
      case "group":
        for (const child of node.children) this.plan(child, depth < MAX_GROUPS ? depth + 1 : depth);
        break;
    }
    // Un connettore si attacca a un gruppo soltanto se il gruppo si scrive.
    const attach = node.type === "group" ? depth < MAX_GROUPS && drawsAny(node) : node.type !== "line";
    const planned = { outer, centre, attach };
    this.planned.set(node, planned);
    if (node.key !== "") this.hooks.set(node.key, planned);
  }

  /// Vero se la forma della raccolta di `node` è fatta di più pezzi: è già
  /// un gruppo.
  private pieced(node: ShapeNode): boolean {
    if (node.form.kind !== "library") return false;
    const shape = libraryShape(node.form.id);
    const [w, h] = [node.box.max[0] - node.box.min[0], node.box.max[1] - node.box.min[1]];
    return shape !== null && shape.build(Math.max(w, 1), Math.max(h, 1)).length > 1;
  }

  // -- Gli elementi ------------------------------------------------------------

  /// Gli elementi di `node`, nell'ordine in cui vanno nel genitore; vuoto se
  /// non disegna niente. `inGroup` dice se il genitore è un gruppo, `depth`
  /// quanti gruppi scritti gli stanno attorno.
  private build(node: Node, inGroup: boolean, depth: number): Elem[] {
    const planned = this.planned.get(node)!;
    let elems: Elem[];
    switch (node.type) {
      case "shape":
        elems = this.shape(node, planned.outer, inGroup);
        break;
      case "text": {
        // Un testo con righe orizzontali è un gruppo, se non è già in uno.
        const grouped = !inGroup && this.ruled(node);
        const id = grouped ? this.ids.next("object") : planned.outer;
        const parts = this.text(node, id);
        elems = grouped && parts.length > 1 ? [{ tag: "g", attrs: { id: planned.outer }, children: parts }] : parts;
        // L'ombra va sul testo con le sue righe, se le hanno un gruppo.
        if (node.content.shadow === true && parts.length > 0) this.shadowed.push(elems.length === 1 && elems[0]!.tag === "g" ? planned.outer : id);
        break;
      }
      case "path": {
        const elem = this.path(node, planned.outer);
        elems = elem === null ? [] : [elem];
        if (elem !== null && casts(node.look, node.closed)) this.shadowed.push(planned.outer);
        break;
      }
      case "line":
        elems = this.line(node, planned.outer);
        break;
      case "ink": {
        const elem = this.ink(node, planned.outer);
        elems = elem === null ? [] : [elem];
        break;
      }
      case "image": {
        const box = this.moved(node.box);
        const attrs: Record<string, string> = { ...imageElem(planned.outer, node.href, box).attrs };
        if (node.opacity < 1) attrs.opacity = n(node.opacity);
        const transform = this.turn(node.spin, node.flip);
        if (transform !== null) attrs.transform = transform;
        if (node.crop !== null) {
          const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
          const rect: Bounds = { min: [box.min[0] + node.crop.min[0] * w, box.min[1] + node.crop.min[1] * h], max: [box.min[0] + node.crop.max[0] * w, box.min[1] + node.crop.max[1] * h] };
          this.cropped.push({ id: planned.outer, box, rect });
        }
        elems = [{ tag: "image", attrs }];
        if (node.shadow === true) this.shadowed.push(planned.outer);
        break;
      }
      case "group": {
        if (depth >= MAX_GROUPS) return node.children.flatMap((child) => this.build(child, inGroup, depth));
        const children = node.children.flatMap((child) => this.build(child, true, depth + 1));
        if (children.length === 0) return [];
        const title: Elem[] = node.name.trim() === "" ? [] : [{ tag: "title", attrs: {}, text: node.name.trim() }];
        elems = [{ tag: "g", attrs: { id: planned.outer }, children: [...title, ...children] }];
        break;
      }
    }
    if (node.locked && elems.length > 0) this.lockedIds.push(planned.outer);
    return elems;
  }

  /// La `defs` del disegno, dove vanno le risorse nuove.
  private defs(): string {
    if (this.home === null) {
      const home = homeOf(this.model);
      this.resources.push(...home.prelude);
      this.home = home.parent;
    }
    return this.home;
  }

  /// Il valore di `fill` per `fill`, con la campitura nuova se ne serve una.
  private fillValue(fill: Fill | null): string {
    if (fill === null) return "none";
    if (fill.kind === "color") return fill.color;
    const preset = presetHatch(fill.hatch === "lines" ? "diagonal" : fill.hatch === "cross" ? "cross" : "dots");
    const spacing = clampSpacing(fill.spacing);
    const hatch: Hatch = { ...preset, spacing, width: clampWidth(fill.width, spacing), color: fill.color, background: fill.background };
    const parent = this.defs();
    const id = this.ids.next("resource");
    this.resources.push({ op: "add", parent, pos: { last: true }, elem: hatchElem(id, hatch) });
    return `url(#${id}) ${hatchFallback(hatch)}`;
  }

  /// `attrs` col contorno e il riempimento di `look`; `fill` falso per un
  /// pezzo aperto, che non si riempie.
  private paint(attrs: Record<string, string>, look: Look, fill: boolean): void {
    if (look.stroke === null) {
      attrs.stroke = "none";
      delete attrs["stroke-width"];
    } else if (look.stroke.dash !== "solid") {
      const width = Number(attrs["stroke-width"] ?? look.stroke.width);
      attrs["stroke-dasharray"] = dashValue(look.stroke.dash, width, (attrs["stroke-linecap"] ?? "butt") as Cap);
    }
    if (fill && "fill" in attrs) attrs.fill = this.fillValue(look.fill);
  }

  /// Gli elementi di una forma: la forma, e la sua etichetta in un gruppo
  /// nuovo o accanto a lei nel suo gruppo, come le scrive l'editor.
  private shape(node: ShapeNode, outer: string, inGroup: boolean): Elem[] {
    const box = this.moved(node.box);
    const style = { color: node.look.stroke?.color ?? DEFAULT_COLOR, width: node.look.stroke?.width ?? DEFAULT_WIDTH };
    const label = node.label !== null && !emptyContent(node.label) ? node.label : null;
    const pieced = this.pieced(node);
    // Senza etichetta, o fatta di più pezzi, la forma è l'elemento più
    // esterno; con un'etichetta in un livello sta in un gruppo nuovo.
    const own = label === null || pieced || inGroup ? outer : this.ids.next("object");
    let main: Elem | null;
    if (node.form.kind === "library") {
      const shape = libraryShape(node.form.id);
      if (shape === null) throw new Error(`nessuna forma ${node.form.id}`);
      main = libraryElem(shape, box, style, this.setup.shapeName(shape.name), new Starting(own, this.ids));
    } else if (node.form.kind === "outline") {
      main = outlineElem(node.form.segments, own, box, style);
    } else {
      main = shapeElem(node.form.kind, own, box.min, box.max, style, 0);
      if (main !== null && node.form.kind === "rect" && node.form.corner > 0) {
        const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
        main = { ...main, attrs: { ...main.attrs, rx: n(Math.min(node.form.corner, w / 2, h / 2)) } };
      }
    }
    if (main === null) return [];
    const name = node.name?.trim() ?? "";
    if (name !== "") {
      // Il nome del file prende il posto di quello di partenza.
      const title: Elem = { tag: "title", attrs: {}, text: name };
      main = { ...main, children: [title, ...(main.children ?? []).filter((child) => child.tag !== "title")] };
    }
    const transform = this.turn(node.spin);
    if (main.tag === "g") {
      const children = (main.children ?? []).map((child): Elem => {
        if (child.tag === "title") return child;
        const attrs = { ...child.attrs };
        // Le righe sottili di una forma restano senza riempimento.
        this.paint(attrs, node.look, closedPiece(child) && attrs.fill === "none");
        return { ...child, attrs };
      });
      const attrs: Record<string, string> = { ...main.attrs };
      if (transform !== null) attrs.transform = transform;
      main = { ...main, attrs, children };
    } else {
      const attrs: Record<string, string> = { ...main.attrs };
      this.paint(attrs, node.look, true);
      if (transform !== null) attrs.transform = transform;
      main = { ...main, attrs };
    }
    const opaque = (elem: Elem): Elem => (node.look.opacity < 1 ? { ...elem, attrs: { ...elem.attrs, opacity: n(node.look.opacity) } } : elem);
    // L'ombra va sulla forma intera: su tutti i suoi pezzi insieme, che non
    // la gettano l'uno sull'altro.
    const body = casts(node.look, true);
    if (body) this.shadowed.push(main.attrs.id!);
    if (label === null) return [opaque(main)];
    if (main.tag === "g") {
      // L'etichetta va accanto al primo pezzo chiuso, nel gruppo della forma.
      const children = [...(main.children ?? [])];
      const host = children.findIndex((child) => child.tag !== "title" && closedPiece(child));
      if (host < 0) return [opaque(main)];
      const text = this.label(label, children[host]!, box);
      // Nel gruppo della forma, l'etichetta ha già l'ombra della forma.
      if (label.shadow === true && !body) this.shadowed.push(text.attrs.id!);
      children.splice(host + 1, 0, text);
      return [opaque({ ...main, children })];
    }
    const text = this.label(label, main, box);
    if (label.shadow === true) this.shadowed.push(text.attrs.id!);
    if (inGroup) return [opaque(main), text];
    return [opaque({ tag: "g", attrs: { id: outer }, children: [main, text] })];
  }

  /// L'etichetta `content` della forma `host`, che sta in `box`: centrata
  /// nell'origine, a capo alla larghezza del riquadro del testo della forma
  /// meno il margine, come la scrive l'editor. Il seguito la porta al centro
  /// della forma.
  private label(content: Content, host: Elem, box: Bounds): Elem {
    const id = this.ids.next("object");
    const frame = elemTextBox(host) ?? box;
    const room = frame.max[0] - frame.min[0] - 2 * LABEL_PAD;
    const fit = this.fitted(content, room);
    const width = Number(wrapValue(Math.max(fit.type.size, room)));
    const draft = draftOf({ ...fit, align: "middle" });
    const wrapped = this.wrapped(draft, fit, width).rich;
    const attrs: Record<string, string> = { ...wrapped.attrs, id, "fub:inside": host.attrs.id!, [WRAP]: wrapValue(width), x: "0", y: "0", "text-anchor": content.align };
    return richElem({ tag: "text", attrs: {} }, { ...wrapped, attrs, lines: wrapped.lines.map((line) => ({ ...line, attrs: { ...line.attrs, x: "0" } })) });
  }

  /// `draft`, il testo di `content`, a capo a `width`.
  private wrapped(draft: Rich, content: Content, width: number): Wrapped {
    return wrapParagraphs(tidyRich(unwrap({ ...draft, attrs: { ...draft.attrs, [WRAP]: wrapValue(width) } })), width, this.setup.measure, n(content.leading * content.type.size));
  }

  /// `content` col corpo più grande, fino al suo, a cui nessuna parola va a
  /// capo a metà a `width`; com'è se una si spezza anche al corpo più
  /// piccolo.
  private fitted(content: Content, width: number): Content {
    const splits = (scale: number): boolean => {
      const each = scaled(content, scale);
      const lines = this.wrapped(draftOf(each), each, width).rich.lines;
      return lines.some((line, i) => {
        if (i === 0 || joinOf(line.attrs) !== "word") return false;
        const before = lineText(lines[i - 1]!);
        return !HYPHENS.has(before.slice(-1));
      });
    };
    if (!splits(1)) return content;
    if (splits(FIT_LEAST)) return content;
    let [good, bad] = [FIT_LEAST, 1];
    for (let step = 0; step < FIT_STEPS; step++) {
      const mid = (good + bad) / 2;
      if (splits(mid)) bad = mid;
      else good = mid;
    }
    return scaled(content, good);
  }

  /// Vero se `node` disegna righe orizzontali: è in area, con la sua fascia.
  private ruled(node: TextNode): boolean {
    return node.width !== null && node.frame !== null && (node.content.rules?.length ?? 0) > 0 && !emptyContent(node.content);
  }

  /// Un testo, a punto o in area, come lo scrive lo strumento Testo, e le
  /// sue righe orizzontali dopo, ognuna una linea.
  private text(node: TextNode, id: string): Elem[] {
    if (emptyContent(node.content)) return [];
    const [x, y] = this.at(node.at).map(n) as [string, string];
    let rich: Rich;
    let fit = node.content;
    if (node.width !== null) {
      const content = (fit = this.fitted(node.content, node.width));
      const width = Number(wrapValue(Math.max(content.type.size, node.width)));
      rich = this.wrapped(draftOf(content), content, width).rich;
    } else {
      rich = tidyRich(draftOf(node.content));
    }
    const attrs: Record<string, string> = { id, x, y: node.frame === null ? y : n(this.baseline(node.frame, rich.lines.length, fit)), ...rich.attrs };
    if (node.opacity < 1) attrs.opacity = n(node.opacity);
    const transform = this.turn(node.spin);
    if (transform !== null) attrs.transform = transform;
    const text = richElem({ tag: "text", attrs: {} }, { ...rich, attrs, lines: rich.lines.map((line) => ({ ...line, attrs: { x, ...line.attrs } })) });
    if (!this.ruled(node)) return [text];
    return [text, ...this.rules(node, rich.lines, fit)];
  }

  /// Le righe orizzontali del testo in area `node`, scritto in `lines` col
  /// carattere di `content`: ognuna a metà della sua riga vuota, da un lato
  /// all'altro della larghezza.
  private rules(node: TextNode, lines: readonly RichLine[], content: Content): Elem[] {
    const frame = node.frame!;
    const width = node.width!;
    const line = content.leading * content.type.size;
    const height = Math.max(1, lines.length) * line;
    const start = frame.align === "top" ? frame.top : frame.align === "bottom" ? frame.bottom - height : (frame.top + frame.bottom - height) / 2;
    // La prima riga di ogni paragrafo: le altre continuano quella prima.
    const firsts = lines.flatMap((each, i) => (joinOf(each.attrs) === null ? [i] : []));
    const left = node.at[0] - (node.content.align === "start" ? 0 : node.content.align === "middle" ? width / 2 : width);
    const out: Elem[] = [];
    for (const rule of node.content.rules ?? []) {
      const p = rule.paragraph;
      const index = p < 0 ? p : p < firsts.length ? firsts[p]! : lines.length + p - firsts.length;
      const y = start + (index + 0.5) * line;
      const path: PathNode = {
        type: "path",
        key: "",
        locked: node.locked,
        spin: node.spin,
        points: [
          [left, y],
          [left + width, y],
        ],
        smooth: false,
        closed: false,
        look: { stroke: { color: rule.color, width: rule.width, dash: "solid" }, fill: null, opacity: node.opacity },
        start: null,
        end: null,
      };
      const elem = this.path(path, this.ids.next("object"));
      if (elem !== null) out.push(elem);
    }
    return out;
  }

  /// La riga di base della prima di `count` righe di `content` nella fascia
  /// `frame`: il blocco è alto `count` interlinee, e ogni riga sta in mezzo
  /// alla sua interlinea come la misurano le etichette.
  private baseline(frame: Frame, count: number, content: Content): number {
    const size = content.type.size;
    const line = content.leading * size;
    const height = Math.max(1, count) * line;
    const [top, bottom] = [frame.top + this.dy, frame.bottom + this.dy];
    const start = frame.align === "top" ? top : frame.align === "bottom" ? bottom - height : (top + bottom - height) / 2;
    return start + (line - (ASCENT_EM + DESCENT_EM) * size) / 2 + ASCENT_EM * size;
  }

  /// L'id del marcatore della punta `end` del colore `paint`.
  private tip(end: End | null, at: TipEnd, paint: string): string | null {
    return end === null ? null : this.shelf!.idFor({ shape: end.shape, size: end.size }, at, { paint, opacity: 1 });
  }

  /// Una linea fatta di punti: una `line` se sono due e dritta, se no un
  /// `path`, con gli estremi e gli angoli tondi.
  private path(node: PathNode, id: string): Elem | null {
    const points = node.points.map((p) => this.at(p));
    if (points.length < 2) return null;
    const stroke = node.look.stroke;
    const color = stroke?.color ?? DEFAULT_COLOR;
    let attrs: Record<string, string>;
    if (points.length === 2 && !node.closed) {
      const line = shapeElem("line", id, points[0]!, points[1]!, { color, width: stroke?.width ?? DEFAULT_WIDTH }, 0);
      if (line === null) return null;
      attrs = { ...line.attrs };
    } else {
      const segments: Segment[] = node.smooth
        ? smoothSegments(node.closed ? points.slice(0, -1) : points, node.closed)
        : [{ kind: "move", to: points[0]! }, ...points.slice(1, node.closed ? -1 : undefined).map((to): Segment => ({ kind: "line", to })), ...(node.closed ? [{ kind: "close" } as Segment] : [])];
      attrs = { id, d: pathData(segments), fill: "none", stroke: color, "stroke-width": n(stroke?.width ?? DEFAULT_WIDTH), "stroke-linecap": "round", "stroke-linejoin": "round" };
    }
    this.paint(attrs, node.look, node.closed);
    if (!node.closed) {
      const start = this.tip(node.start, "start", color);
      const end = this.tip(node.end, "end", color);
      if (start !== null) attrs["marker-start"] = `url(#${start})`;
      if (end !== null) attrs["marker-end"] = `url(#${end})`;
    }
    if (node.look.opacity < 1) attrs.opacity = n(node.look.opacity);
    const transform = this.turn(node.spin);
    if (transform !== null) attrs.transform = transform;
    return { tag: points.length === 2 && !node.closed ? "line" : "path", attrs };
  }

  /// Un capo: l'oggetto e il lato, se il diagramma lo ha; se no il punto.
  private end(hook: Hook, other: string | null): { readonly end: ConnectorEnd | null; readonly at: Point } {
    if ("node" in hook) {
      const planned = this.hooks.get(hook.node);
      if (planned !== undefined && planned.attach && planned.outer !== other) return { end: { id: planned.outer, anchor: hook.anchor }, at: planned.centre };
    }
    return { end: null, at: hook.at };
  }

  /// Un connettore, come lo tira lo strumento Connettore, e la sua
  /// etichetta subito dopo, come la scrive il pannello. Il percorso di
  /// partenza va dritto fra i capi: il seguito lo fa passare fra gli
  /// oggetti.
  private line(node: LineNode, id: string): Elem[] {
    const stroke = node.look.stroke;
    const color = stroke?.color ?? DEFAULT_COLOR;
    const from = this.end(node.from, null);
    const to = this.end(node.to, from.end?.id ?? null);
    let points: readonly Point[];
    if (node.route !== null && fitsKind(node.kind, node.route.length)) {
      points = node.route.map((p) => this.at(p));
      this.kept.add(id);
    } else {
      const a = this.at(from.at);
      let b = this.at(to.at);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) b = [a[0] + 1, a[1]];
      points = sceneRoute(node.kind, { at: a }, { at: b }, this.setup.measure);
    }
    const endTip = this.tip(node.end, "end", color);
    const startTip = this.tip(node.start, "start", color);
    const elem = connectorElem(id, node.kind, points, from.end, to.end, { paint: color, width: stroke?.width ?? DEFAULT_WIDTH, tip: endTip ?? "" });
    const attrs: Record<string, string> = { ...elem.attrs };
    if (endTip === null) delete attrs["marker-end"];
    if (startTip !== null) attrs["marker-start"] = `url(#${startTip})`;
    if (stroke !== null && stroke.dash !== "solid") attrs["stroke-dasharray"] = dashValue(stroke.dash, Number(attrs["stroke-width"]), "round");
    if (node.look.opacity < 1) attrs.opacity = n(node.look.opacity);
    const out: Elem[] = [{ tag: "path", attrs }];
    if (casts(node.look, false)) this.shadowed.push(id);
    for (const each of node.labels) {
      if (emptyContent(each.content)) continue;
      const draft = tidyRich(draftOf({ ...each.content, align: "middle" }));
      const place = writeLabelPlace({ ...labelPlace(id), t: each.t, offset: LABEL_GAP });
      const labelId = this.ids.next("object");
      this.alongs.push({ label: labelId, line: id, t: each.t });
      const label: Rich = {
        ...draft,
        attrs: { id: labelId, x: "0", y: "0", ...draft.attrs, "text-anchor": "middle", "fub:along": place },
        lines: draft.lines.map((line) => ({ ...line, attrs: { x: "0", ...line.attrs } })),
      };
      out.push(richElem({ tag: "text", attrs: {} }, label));
      if (each.content.shadow === true) this.shadowed.push(labelId);
    }
    return out;
  }

  /// Un tratto a mano libera, come lo scrive la Penna.
  private ink(node: InkNode, id: string): Elem | null {
    if (node.samples.length === 0) return null;
    const pressure = !node.simulate && node.samples.every((sample) => sample.p !== undefined);
    const samples = fewer(node.samples).map((sample): InkSample => {
      const [x, y] = this.at([sample.x, sample.y]);
      return pressure ? { x, y, p: sample.p!, t: 0 } : { x, y, t: 0 };
    });
    const brush: Pf1Brush = { ...PF1_DEFAULTS, size: node.size, thinning: node.thinning, sim: !pressure };
    const elem = strokeElem(id, node.color, brush, quantizeInk(samples), null, "pen");
    const attrs: Record<string, string> = { ...elem.attrs };
    if (node.opacity < 1) attrs.opacity = n(node.opacity);
    const transform = this.turn(node.spin);
    if (transform !== null) attrs.transform = transform;
    return { ...elem, attrs };
  }

  // -- I passi dopo il contenuto -------------------------------------------------

  /// Le operazioni in `batch` che il motore accetta: al più [`MAX_BATCH`]
  /// operazioni e meno di [`MAX_OP_BYTES`] byte l'uno, a stima.
  private chunks(ops: readonly Op[]): Op[][] {
    const out: Op[][] = [];
    let chunk: Op[] = [];
    let bytes = 0;
    const room = MAX_OP_BYTES * 0.75;
    for (const op of ops) {
      const size = JSON.stringify(op).length * 2;
      if (chunk.length > 0 && (chunk.length >= MAX_BATCH / 2 || bytes + size > room)) {
        out.push(chunk);
        chunk = [];
        bytes = 0;
      }
      chunk.push(op);
      bytes += size;
    }
    if (chunk.length > 0) out.push(chunk);
    return out;
  }

  /// Ricalcola i connettori dopo un contenuto scritto in più passi: un capo
  /// poteva nominare un oggetto di un passo dopo.
  private reroute(): void {
    const touched = new Set<string>();
    for (const planned of this.hooks.values()) touched.add(planned.outer);
    const op = this.keep(followConnectors(this.model, touched, (id) => this.engine!.holder(id), this.setup.measure));
    if (op !== null) this.step("connettori", [op]);
  }

  /// `op` senza i percorsi nuovi dei connettori che tengono il loro.
  private keep(op: Op | null): Op | null {
    if (op === null || this.kept.size === 0) return op;
    const out = (op.op === "batch" ? op.ops : [op]).flatMap((each): Op[] => {
      if (each.op !== "set" || !this.kept.has(each.id)) return [each];
      const attrs = { ...each.attrs };
      delete attrs["fub:geom"];
      delete attrs.d;
      return Object.keys(attrs).length === 0 ? [] : [{ ...each, attrs }];
    });
    return gesture(out);
  }

  /// Le etichette dei connettori che tengono il loro percorso, al loro posto
  /// lungo di lui: il seguito le aveva messe sul percorso di FubDraw.
  private placeKept(): void {
    this.placeLabels(this.kept);
  }

  /// Rimette le etichette dei connettori `lines` al loro posto lungo la
  /// linea. Un passo che non nomina niente: i connettori non si
  /// ricalcolano.
  private placeLabels(lines: ReadonlySet<string>): void {
    if (lines.size === 0) return;
    const op = this.keep(followConnectors(this.model, lines, (id) => this.engine!.holder(id), this.setup.measure, { op: "batch", ops: [] }));
    if (op !== null) this.step("etichette dei connettori", [op]);
  }

  /// Ogni etichetta di un connettore dalla parte della linea, e nel punto
  /// vicino a quello del file, dove copre meno. Il file la mette sopra la
  /// linea, che le passa sotto; FubDraw la mette accanto, e accanto c'è
  /// spesso altro: un testo, una forma, un'altra linea. Le etichette si
  /// sistemano una alla volta, nell'ordine del file, e ognuna è poi un testo
  /// che le altre evitano.
  private spread(): void {
    if (this.alongs.length === 0) return;
    this.builder.build(this.engine!);
    const index = this.indexer.index(this.model);
    const ours = new Set(this.alongs.map((along) => along.label));
    const marks: Mark[] = [];
    const tracks = new Map<string, Track>();
    const visit = (unit: Unit): void => {
      const m = compose(unit.parent, unit.transform);
      const facts = unit.node.details?.connector;
      if (facts !== undefined) {
        const segments = connectorSegments(facts.geom).map((segment) => movedSegment(segment, m));
        if (unit.id !== null) tracks.set(unit.id, new Track(segments));
        marks.push(lineMark(chords(segments)));
        return;
      }
      if (unit.id !== null && ours.has(unit.id)) return;
      const children = index.children(unit);
      if (children.length > 0) {
        for (const child of children) visit(child);
        return;
      }
      if (unit.bounds === null) return;
      if (unit.tag === "text") {
        marks.push({ kind: "text", box: unit.bounds });
        return;
      }
      const elem = elemOf(unit.node);
      if (elem !== null && elem.attrs.fill === "none") {
        const local = chords(shapeSegments(elem.tag, Object.entries(elem.attrs)));
        marks.push(lineMark(local.map(([a, b]): [Point, Point] => [apply(m, a), apply(m, b)])));
        return;
      }
      marks.push({ kind: "solid", box: unit.bounds });
    };
    for (const unit of index.units) visit(unit);
    const ops: Op[] = [];
    const moved = new Set<string>();
    for (const along of this.alongs) {
      const label = index.get(along.label);
      const track = tracks.get(along.line);
      if (label === null || label.bounds === null || track === undefined || !(track.length > 0)) continue;
      const size = { width: label.bounds.max[0] - label.bounds.min[0], height: label.bounds.max[1] - label.bounds.min[1] };
      const candidates: { readonly place: LabelPlace; readonly box: Bounds; readonly cost: number }[] = [];
      for (let k = -SPREAD_STEPS; k <= SPREAD_STEPS; k++) {
        const t = along.t + k * SPREAD_STEP;
        if (t < SPREAD_STEP / 2 || t > 1 - SPREAD_STEP / 2) continue;
        for (const offset of [LABEL_GAP, -LABEL_GAP]) {
          const place: LabelPlace = { id: along.line, t, offset };
          const centre = labelCentre(track, place, size);
          if (centre === null) continue;
          const box: Bounds = { min: [centre[0] - size.width / 2, centre[1] - size.height / 2], max: [centre[0] + size.width / 2, centre[1] + size.height / 2] };
          // Scivolare lungo la linea, o passare sotto, costa un poco: a
          // parità resta dov'era.
          const slide = Math.abs(k * SPREAD_STEP) * track.length * size.height * SPREAD_SLIDE;
          const side = offset < 0 ? size.width * size.height * SPREAD_SIDE : 0;
          candidates.push({ place, box, cost: slide + side });
        }
      }
      if (candidates.length === 0) continue;
      const region = new BoundsBuilder();
      for (const candidate of candidates) {
        region.include(candidate.box.min);
        region.include(candidate.box.max);
      }
      const reach = region.finish()!;
      const near = marks.filter((mark) => touches(mark.box, reach));
      let best = candidates[0]!;
      let bestCost = Infinity;
      for (const candidate of candidates) {
        let cost = candidate.cost;
        for (const mark of near) cost += markCost(mark, candidate.box, size.height);
        if (cost < bestCost - 1e-6) {
          best = candidate;
          bestCost = cost;
        }
      }
      marks.push({ kind: "text", box: best.box });
      if (best.place.t === along.t && best.place.offset === LABEL_GAP) continue;
      ops.push({ op: "set", id: along.label, attrs: { "fub:along": writeLabelPlace(best.place) } });
      moved.add(along.line);
    }
    this.step("posto delle etichette dei connettori", ops);
    this.placeLabels(moved);
  }

  /// L'ombra degli oggetti che la gettano, come la dà il pannello degli
  /// effetti, a passi che il motore accetta. Un oggetto che non la prende,
  /// come un'immagine ritagliata, resta senza.
  private shadows(): void {
    for (let at = 0; at < this.shadowed.length; at += SHADOW_BATCH) {
      this.builder.build(this.engine!);
      const index = this.indexer.index(this.model);
      const units = this.shadowed.slice(at, at + SHADOW_BATCH).flatMap((id) => {
        const unit = index.get(id);
        return unit !== null && effectsRefusal(this.model, nodeOf(this.model, unit), this.setup.measure) === null ? [unit] : [];
      });
      const done = effectsOps(this.model, units, { kind: "set", effects: [SHADOW] }, this.setup.measure, this.ids);
      if (typeof done === "string") throw new Error(`ombre: ${done}`);
      this.step("ombre", done.ops);
    }
  }

  /// Il ritaglio di un'immagine, come lo dà il pannello.
  private crop(crop: { readonly id: string; readonly box: Bounds; readonly rect: Bounds }): void {
    const node = this.engine!.holder(crop.id);
    if (node === null) return;
    this.step("ritaglio", cropOps(this.model, node, { box: crop.box, rect: crop.rect }, this.ids));
  }

  /// Le tavole: la prima nasce dalla pagina, le altre dopo di lei, ognuna
  /// col suo nome.
  private boards(): void {
    const boards = this.diagram.boards;
    if (boards.length === 0) return;
    const rectOf = (box: Bounds): Rect => {
      const moved = this.moved(box);
      return [moved.min[0], moved.min[1], moved.max[0] - moved.min[0], moved.max[1] - moved.min[1]];
    };
    this.step("pagina della prima tavola", [{ op: "page", viewBox: rectText(rectOf(boards[0]!.box)) }]);
    const page = (): Page | null => this.builder.build(this.engine!).root.page;
    const made = pageBoardOps(this.model, this.setup.boardName, this.ids, page()!);
    if (typeof made === "string") throw new Error("la pagina non diventa una tavola");
    this.step("prima tavola", made.ops);
    for (const board of boards.slice(1)) {
      const all = boardsOf(this.model);
      const added = addBoardOps(this.model, rectOf(board.box), this.setup.boardName, this.ids, page(), all[all.length - 1] ?? null);
      if (typeof added === "string") throw new TooLarge(`tavola: ${added}`);
      this.step("tavola", added.ops);
    }
    boardsOf(this.model).forEach((board, i) => {
      const name = boards[i]?.name.trim() ?? "";
      if (name === "") return;
      const renamed = renameBoardOps(this.model, board, name, this.ids);
      if (typeof renamed !== "string") this.step("nome della tavola", renamed.ops);
    });
  }

  /// La pagina attorno a tutto il disegno, come «Adatta la pagina al
  /// disegno».
  private fit(): void {
    this.builder.build(this.engine!);
    const out = new BoundsBuilder();
    const extent = this.indexer.extent(this.model);
    if (extent !== null) {
      out.include(extent.min);
      out.include(extent.max);
    }
    for (const board of boardsOf(this.model)) {
      out.include(board.box.min);
      out.include(board.box.max);
    }
    const viewBox = fittedPage(this.builder.build(this.engine!).root.page, out.finish());
    if (viewBox !== null) this.step("pagina", [{ op: "page", viewBox }]);
  }
}
