// I comandi del menu Tracciato oltre «Oggetto in tracciato» (livello
// Esperto): il contorno che diventa una forma, lo scostamento, la
// semplificazione e l'inchiostro che diventa un tracciato. Ognuno diventa un
// `batch` solo, come i comandi di «Disponi»; la geometria è in `offset.ts`,
// `simplify.ts` e `spine.ts`.
//
// - **Un gruppo o un collegamento** passano il comando alle parti, tranne
//   quelle bloccate.
// - **«Contorno in tracciato»** fa del contorno visibile di una forma, con
//   estremi, angoli e tratteggio, una forma piena del suo colore, al suo
//   posto e con il suo id. Una forma anche piena diventa un gruppo, con lo
//   stesso id, la stessa trasformazione e la stessa opacità, del
//   riempimento sotto e del contorno sopra. Testi, immagini, tratti a penna
//   e forme senza contorno restano come sono, e il comando li conta.
// - **«Scostamento»** aggiunge accanto a ogni forma il tracciato parallelo,
//   a una distanza nella scena: sotto la forma se è più grande, sopra se è
//   più piccolo, con i suoi colori e la sua trasformazione. Dopo sono scelti
//   i tracciati nuovi.
// - **«Semplifica»** toglie i nodi entro una tolleranza nella scena. Una
//   forma che perde nodi diventa un tracciato; le altre restano.
// - **«Inchiostro in tracciato»** fa di un tratto a penna la sua spina, i
//   nodi che lo strumento Nodi mostra, col colore dell'inchiostro come
//   contorno e lo spessore del pennello, come «Rendi forma».

import { parseBrush } from "../ink/brush";
import { formatNumber } from "../number";
import { parsePath, type Segment } from "../scene/geometry";
import { invert, type Matrix } from "../scene/matrix";
import type { DocumentModel, ElementPart } from "../scene/model";
import { pathData, type Elem } from "../scene/serialize";
import { nonNegativeLength, number } from "../scene/values";
import { elemOf, fubAttributes, nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import { mapped } from "./boolean";
import type { NewIds } from "./edit";
import { shapeSegments, type SceneIndex, type Unit } from "./hit";
import { isPenStroke, strokePoints } from "./inkshape";
import { writeNodes } from "./nodes";
import { offsetArea, strokeArea, type Cap, type Join, type OffsetStyle, type StrokeStyle } from "./offset";
import { writtenDashes } from "./outline";
import { nodeCount, simplified } from "./simplify";
import { fitSpine, spineTolerance } from "./spine";
import { GEOMETRY, replaceElem, rewriteShape, syntheticNulls, withoutStill } from "./topath";

/// Le forme: ciò che ha un tracciato e un'area o un contorno.
const SHAPES: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon", "arrow", "ngon", "star", "stroke"]);

/// Gli attributi di pittura che si ereditano, coi valori di SVG.
const PAINT: ReadonlyMap<string, string> = new Map([
  ["fill", "black"],
  ["fill-opacity", "1"],
  ["stroke", "none"],
  ["stroke-opacity", "1"],
  ["stroke-width", "1"],
  ["stroke-linecap", "butt"],
  ["stroke-linejoin", "miter"],
  ["stroke-miterlimit", "4"],
  ["stroke-dasharray", "none"],
  ["stroke-dashoffset", "0"],
]);

/// Gli attributi del contorno, che una forma piena non ha più.
const STROKE_ATTRIBUTES = ["stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset"];

/// Un comando del menu Tracciato pronto: le operazioni; quanti oggetti
/// cambiano; quanti il comando non riguarda, come un testo; e quanti non
/// riesce a cambiare, perché la geometria è troppo intricata o non si
/// scrive.
export interface PathsDone extends Arranged {
  readonly changed: number;
  readonly skipped: number;
  readonly refused: number;
}

/// Lo scostamento pronto: anche quante forme spariscono, più strette del
/// doppio della distanza, e i tracciati nuovi nella scena, per l'anteprima.
export interface Offsetted extends PathsDone {
  readonly vanished: number;
  readonly preview: readonly Segment[][];
}

/// La semplificazione pronta: anche i nodi prima e dopo, e le forme come
/// diventano nella scena, per l'anteprima.
export interface Simplified extends PathsDone {
  readonly before: number;
  readonly after: number;
  readonly preview: readonly Segment[][];
}

/// I valori di pittura che `node` vede: i suoi, o quelli ereditati.
function paintOf(node: ElementPart | null): Map<string, string> {
  const chain: ElementPart[] = [];
  for (let at = node; at !== null; at = at.parent) chain.push(at);
  const out = new Map(PAINT);
  for (let i = chain.length - 1; i >= 0; i--) {
    const own = chain[i]!.parent === null ? new Map<string, string>() : plainAttributes(chain[i]!);
    for (const name of PAINT.keys()) {
      const value = own.get(name)?.trim();
      if (value !== undefined && value !== "inherit") out.set(name, value);
    }
  }
  return out;
}

/// La geometria di una forma, nelle sue coordinate.
function segmentsOf(node: ElementPart): Segment[] {
  const tag = node.details!.tag;
  const segments = shapeSegments(tag, [...plainAttributes(node)]);
  return tag === "rect" ? withoutStill(segments) : [...segments];
}

/// I trattini e gli spazi di `stroke-dasharray`, come li disegna SVG: un
/// numero dispari di valori si ripete, e un tratteggio senza lunghezza è
/// continuo.
export function dashesOf(value: string): number[] {
  const written = writtenDashes(value);
  if (written === null || written === "none") return [];
  const lengths = written.split(" ").map(Number);
  const even = lengths.length % 2 === 0 ? lengths : [...lengths, ...lengths];
  return even.reduce((sum, length) => sum + length, 0) > 0 ? even : [];
}

/// Il contorno che `paint` disegna; `null` se non si vede.
function strokeStyleOf(paint: ReadonlyMap<string, string>): StrokeStyle | null {
  if (paint.get("stroke") === "none") return null;
  const width = nonNegativeLength(paint.get("stroke-width")!) ?? 1;
  if (!(width > 0)) return null;
  const cap = paint.get("stroke-linecap")!;
  const join = paint.get("stroke-linejoin")!;
  const limit = number(paint.get("stroke-miterlimit")!);
  return {
    width,
    cap: cap === "round" || cap === "square" ? (cap as Cap) : "butt",
    join: join === "round" || join === "bevel" ? (join as Join) : "miter",
    miterLimit: limit !== null && limit >= 1 ? limit : 4,
    dashes: dashesOf(paint.get("stroke-dasharray")!),
  };
}

/// Vero se `d` si scrive e si rilegge.
const readable = (d: string): boolean => parsePath(d) !== null;

/// Gli attributi di `elem` senza `names`.
function without(attrs: Readonly<Record<string, string>>, names: Iterable<string>): Record<string, string> {
  const out = { ...attrs };
  for (const name of names) delete out[name];
  return out;
}

/// Gli attributi che fanno di un tracciato una forma piena del colore del
/// contorno `paint`, dentro un genitore che dà `inherited`: ciò che il
/// genitore dà già non si scrive.
function strokeAsFill(paint: ReadonlyMap<string, string>, inherited: ReadonlyMap<string, string>): Record<string, string> {
  const out: Record<string, string> = { fill: paint.get("stroke")! };
  if (paint.get("stroke-opacity") !== inherited.get("fill-opacity")) out["fill-opacity"] = paint.get("stroke-opacity")!;
  if (inherited.get("stroke") !== "none") out.stroke = "none";
  return out;
}

/// Visita le forme di `units`, e dentro i gruppi e i collegamenti le parti
/// non bloccate; per i testi, le immagini e gli altri oggetti, `other`.
function visitShapes(index: SceneIndex, units: readonly Unit[], shape: (unit: Unit) => void, other: (unit: Unit) => void): void {
  const visit = (unit: Unit): void => {
    if (unit.role === "group" || unit.role === "link") for (const child of index.children(unit)) visit(child);
    else if (SHAPES.has(unit.role)) shape(unit);
    else other(unit);
  };
  for (const unit of units) visit(unit);
}

/// Vero se fra `units`, o dentro i loro gruppi, c'è una forma per cui
/// `test` è vero.
function holds(index: SceneIndex, units: readonly Unit[], test: (unit: Unit) => boolean): boolean {
  return units.some((unit) => (unit.role === "group" || unit.role === "link" ? holds(index, index.children(unit), test) : SHAPES.has(unit.role) && test(unit)));
}

/// Vero se fra `units`, o dentro i loro gruppi, c'è una forma: ciò che lo
/// scostamento allarga e la semplificazione semplifica.
export const holdsShape = (index: SceneIndex, units: readonly Unit[]): boolean => holds(index, units, () => true);

/// Vero se fra `units`, o dentro i loro gruppi, c'è una forma col contorno
/// che si vede: ciò che «Contorno in tracciato» cambia.
export const holdsStroke = (index: SceneIndex, units: readonly Unit[]): boolean =>
  holds(index, units, (unit) => unit.role !== "stroke" && strokeStyleOf(paintOf(unit.node)) !== null);

/// La selezione dopo un comando che lascia gli oggetti dove sono.
const sameKeys = (model: DocumentModel, plan: Plan, units: readonly Unit[]): string[] => units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key));

// ---------------------------------------------------------------------------
// Contorno in tracciato.
// ---------------------------------------------------------------------------

/// Le operazioni di «Contorno in tracciato» su `units`. La selezione resta la
/// stessa.
export function outlineStrokeOps(model: DocumentModel, index: SceneIndex, units: readonly Unit[], ids: NewIds): PathsDone {
  const plan = new Plan(model, ids);
  let [changed, skipped, refused] = [0, 0, 0];
  const shape = (unit: Unit): void => {
    const node = unit.node;
    const paint = paintOf(node);
    const style = unit.role === "stroke" ? null : strokeStyleOf(paint);
    if (style === null) {
      skipped++;
      return;
    }
    const area = strokeArea(segmentsOf(node), style);
    if (typeof area === "string") {
      refused++;
      return;
    }
    // Un contorno che non disegna niente, come quello di una linea lunga
    // zero senza estremi, non c'è.
    if (area.length === 0) {
      skipped++;
      return;
    }
    const d = pathData(area);
    const elem = elemOf(node);
    if (!readable(d) || elem === null) {
      refused++;
      return;
    }
    const tag = node.details!.tag;
    const geometry = [...(GEOMETRY[tag] ?? []), "d"];
    const synthetic = Object.keys(syntheticNulls(node));
    const inherited = paintOf(node.parent);
    const filled = paint.get("fill") !== "none" && tag !== "line";
    let out: Elem;
    if (!filled) {
      const attrs = without(elem.attrs, ["id", ...geometry, ...synthetic, ...STROKE_ATTRIBUTES, "fill", "fill-opacity"]);
      out = { tag: "path", attrs: { ...attrs, d, ...strokeAsFill(paint, inherited) }, ...(elem.children === undefined ? {} : { children: elem.children }) };
    } else {
      // Il gruppo prende il posto della forma: l'id, la trasformazione,
      // l'opacità, il titolo e gli altri attributi. Dentro, il riempimento
      // resta la forma che era, senza contorno, e il contorno le sta sopra.
      const paints = new Set([...PAINT.keys()]);
      const group = without(elem.attrs, ["id", ...geometry, ...synthetic, ...paints]);
      const own = (name: string): Record<string, string> => (elem.attrs[name] === undefined ? {} : { [name]: elem.attrs[name]! });
      const shapeAttrs: Record<string, string> = { id: ids.next("object") };
      for (const name of [...geometry, ...synthetic]) Object.assign(shapeAttrs, own(name));
      Object.assign(shapeAttrs, own("fill"), own("fill-opacity"));
      if (inherited.get("stroke") !== "none") shapeAttrs.stroke = "none";
      const fill: Elem = { tag, attrs: shapeAttrs };
      const outline: Elem = { tag: "path", attrs: { id: ids.next("object"), d, ...strokeAsFill(paint, inherited) } };
      out = { tag: "g", attrs: group, children: [...(elem.children ?? []), fill, outline] };
    }
    if (!replaceElem(plan, node, out)) {
      refused++;
      return;
    }
    changed++;
  };
  visitShapes(index, units, shape, () => skipped++);
  return { ...plan.finish(sameKeys(model, plan, units)), changed, skipped, refused };
}

// ---------------------------------------------------------------------------
// Scostamento.
// ---------------------------------------------------------------------------

/// Le operazioni dello scostamento di `distance` nella scena, positivo
/// verso fuori, su `units`. Dopo sono scelti i tracciati nuovi; senza, la
/// selezione resta la stessa.
export function offsetOps(model: DocumentModel, index: SceneIndex, units: readonly Unit[], distance: number, style: OffsetStyle, ids: NewIds): Offsetted {
  const plan = new Plan(model, ids);
  let [changed, skipped, refused, vanished] = [0, 0, 0, 0];
  const keys: string[] = [];
  const preview: Segment[][] = [];
  const shape = (unit: Unit): void => {
    const node = unit.node;
    const back = invert(unit.matrix);
    if (back === null) {
      refused++;
      return;
    }
    const filled = unit.role === "stroke" || paintOf(node).get("fill") !== "none";
    const area = offsetArea(mapped(segmentsOf(node), unit.matrix), distance, style, filled);
    if (typeof area === "string") {
      refused++;
      return;
    }
    if (area.length === 0) {
      vanished++;
      return;
    }
    const d = pathData(mapped(area, back));
    const elem = elemOf(node);
    if (!readable(d) || elem === null) {
      refused++;
      return;
    }
    const tag = node.details!.tag;
    const geometry = [...(GEOMETRY[tag] ?? []), "d"];
    const synthetic = Object.keys(syntheticNulls(node));
    // I colori, la trasformazione e gli attributi della forma; l'inchiostro,
    // il pennello e i titoli restano suoi.
    const look = without(elem.attrs, ["id", ...geometry, ...synthetic]);
    const id = plan.idOf(node);
    const added = ids.next("object");
    const parent = plan.parentOf(node);
    plan.ops.push({ op: "add", parent, pos: { after: id }, elem: { tag: "path", attrs: { ...look, id: added, d } } });
    // Più grande, sta sotto: la forma torna sopra.
    if (distance > 0) plan.ops.push({ op: "move", target: id, parent, pos: { after: added } });
    keys.push(added);
    preview.push(area);
    changed++;
  };
  visitShapes(index, units, shape, () => skipped++);
  return { ...plan.finish(keys.length > 0 ? keys : sameKeys(model, plan, units)), changed, skipped, refused, vanished, preview };
}

// ---------------------------------------------------------------------------
// Semplifica.
// ---------------------------------------------------------------------------

/// Quanto `m` ingrandisce, in media sui due assi.
const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/// Le operazioni di «Semplifica» con la tolleranza `tolerance` nella scena,
/// su `units`. La selezione resta la stessa.
export function simplifyOps(model: DocumentModel, index: SceneIndex, units: readonly Unit[], tolerance: number, ids: NewIds): Simplified {
  const plan = new Plan(model, ids);
  let [changed, skipped, refused, before, after] = [0, 0, 0, 0, 0];
  const preview: Segment[][] = [];
  const shape = (unit: Unit): void => {
    // Un tratto a penna si ridisegna dal suo inchiostro: si semplifica la
    // sua spina, con «Inchiostro in tracciato».
    if (unit.role === "stroke") {
      skipped++;
      return;
    }
    const node = unit.node;
    const segments = segmentsOf(node);
    const scale = scaleOf(unit.matrix);
    const out = scale > 0 && Number.isFinite(scale) ? simplified(segments, tolerance / scale) : segments;
    const [was, is] = [nodeCount(segments), nodeCount(out)];
    before += was;
    preview.push(mapped(out, unit.matrix));
    if (is >= was) {
      after += was;
      return;
    }
    const d = pathData(out);
    if (!readable(d) || !rewriteShape(plan, node, d)) {
      after += was;
      refused++;
      return;
    }
    after += is;
    changed++;
  };
  visitShapes(index, units, shape, () => skipped++);
  return { ...plan.finish(sameKeys(model, plan, units)), changed, skipped, refused, before, after, preview };
}

// ---------------------------------------------------------------------------
// Inchiostro in tracciato.
// ---------------------------------------------------------------------------

/// Gli attributi del tratto che il tracciato non tiene: l'inchiostro, il
/// pennello e il riempimento, che diventa il contorno.
const INK = ["id", "d", "fill", "fill-opacity", "fub:tool", "fub:ink", "fub:brush", "fub:at"];

/// Il tracciato che prende il posto del tratto a penna `node`: la sua spina,
/// nelle sue coordinate. `null` se l'inchiostro o il pennello non si
/// leggono.
export function inkPathElem(node: ElementPart): Elem | null {
  const elem = elemOf(node);
  const points = strokePoints(node);
  if (elem === null || points === null || points.length === 0) return null;
  let brush;
  try {
    brush = parseBrush(fubAttributes(node).get("brush") ?? "");
  } catch {
    return null;
  }
  const { sub } = fitSpine(points, spineTolerance(brush.size));
  // Un punto è una linea lunga zero, che gli estremi tondi fanno vedere:
  // la penna lo disegna tondo anche con un pennello senza estremi.
  const dot = sub.nodes.length < 2;
  const segments: Segment[] = dot ? [{ kind: "move", to: sub.nodes[0]! }, { kind: "line", to: sub.nodes[0]! }] : writeNodes([sub]);
  const d = pathData(segments);
  if (!readable(d)) return null;
  const attrs: Record<string, string> = { ...without(elem.attrs, INK), d, fill: "none", stroke: elem.attrs.fill ?? "#000000", "stroke-width": formatNumber(brush.size, 2) };
  if (elem.attrs["fill-opacity"] !== undefined) attrs["stroke-opacity"] = elem.attrs["fill-opacity"];
  if (dot || brush.capStart || brush.capEnd) attrs["stroke-linecap"] = "round";
  attrs["stroke-linejoin"] = "round";
  return elem.children === undefined ? { tag: "path", attrs } : { tag: "path", attrs, children: elem.children };
}

/// Le operazioni di «Inchiostro in tracciato» su `units`: i tratti a penna
/// diventano tracciati, gli altri oggetti non contano. La selezione resta
/// la stessa.
export function inkPathOps(model: DocumentModel, index: SceneIndex, units: readonly Unit[], ids: NewIds): PathsDone {
  const plan = new Plan(model, ids);
  let [changed, refused] = [0, 0];
  const visit = (unit: Unit): void => {
    if (unit.role === "group" || unit.role === "link") {
      for (const child of index.children(unit)) visit(child);
      return;
    }
    if (!isPenStroke(unit.node)) return;
    const elem = inkPathElem(unit.node);
    if (elem === null || !replaceElem(plan, unit.node, elem)) {
      refused++;
      return;
    }
    changed++;
  };
  for (const unit of units) visit(unit);
  return { ...plan.finish(sameKeys(model, plan, units)), changed, skipped: 0, refused };
}
