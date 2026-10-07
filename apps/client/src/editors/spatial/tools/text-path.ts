// Il testo su tracciato, dal livello Esperto (formato della scena, testo): i
// comandi che ce lo mettono, lo tolgono e lo rovesciano. Ogni comando è un
// `batch` solo, un passo di annulla.
//
// - **Metti sul tracciato.** Un testo e una forma scelti insieme: la forma
//   lascia il disegno e diventa il tracciato del testo, una risorsa privata
//   nella `defs`, scritta nelle coordinate del testo, così il tracciato resta
//   dove si vedeva la forma. Il testo diventa una riga sola: le righe si
//   uniscono con uno spazio, o senza dentro una parola di un testo in area.
//   Comincia nel punto del tracciato più vicino a dove cominciava, o tanto
//   prima quanto serve perché ci stia tutto.
// - **Una forma da seguire** è un tracciato o una forma geometrica:
//   rettangolo, ellisse, cerchio, linea, spezzata, poligono, freccia,
//   poligono regolare, stella. Il testo segue il tracciato con cui SVG 2 la
//   disegna, dallo stesso punto e nello stesso verso. Un tratto a penna o
//   una linea a spessore variabile disegnano un contorno, non una linea da
//   seguire, e non lo diventano.
// - **Togli dal tracciato.** Il testo torna una riga dritta, che comincia,
//   sta al centro o finisce dove lo faceva sul tracciato. Il tracciato
//   privato che nessuno segue più se ne va con la raccolta del motore.
// - **Rovescia.** Il tracciato si percorre al contrario: il testo passa
//   dall'altra parte e resta dov'era lungo il tracciato. Un tracciato che
//   segue anche un altro testo, o che non è privato, resta com'è, e il testo
//   ne prende uno suo, rovesciato.

import { formatNumber } from "../number";
import { reversed } from "../scene/curves";
import { parsePath, Track, type Segment } from "../scene/geometry";
import { compose, invert, type Point } from "../scene/matrix";
import { elementChildren, pathOf, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import type { Op } from "../scene/ops";
import { pathData, type Elem } from "../scene/serialize";
import { startOffset } from "../scene/values";
import { elemOf, nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import { mapped } from "./boolean";
import type { NewIds } from "./edit";
import { shapeSegments, type Unit } from "./hit";
import { textInherited } from "./look";
import type { Measure } from "./measure";
import { homeOf, resourcesOf, type Home } from "./resources";
import { canonicalSpans, JOIN, lineRuns, lineText, richOf, type Rich, type RichLine, type Span } from "./rich";
import { replaceElem } from "./topath";
import { fontIn, joinOf, WRAP } from "./wrap";

/// I ruoli delle forme che un testo sa seguire.
const TRACKS: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon", "arrow", "ngon", "star"]);

/// Gli attributi di una riga che la mettono al suo posto, e che la riga del
/// tracciato non ha.
const PLACEMENT: ReadonlySet<string> = new Set(["id", "x", "y", "dx", "dy", "rotate", "textLength", "lengthAdjust", JOIN]);

/// Perché un comando del testo su tracciato non si fa:
/// - `pair`, non sono scelti un testo e una forma soltanto;
/// - `not_track`, la forma scelta col testo non si segue;
/// - `none`, fra gli oggetti scelti non c'è un testo su tracciato;
/// - `empty`, il tracciato è lungo zero;
/// - `foreign`, il testo ha parti che un'operazione non sa riscrivere.
export interface TextPathRefused {
  readonly reason: "pair" | "not_track" | "none" | "empty" | "foreign";
}

/// Vero se `unit` è una forma che un testo sa seguire.
export const isTrack = (unit: Unit): boolean => TRACKS.has(unit.role);

/// Vero se `unit` è un testo su tracciato.
export const isAlongPath = (unit: Unit): boolean => unit.role === "text" && unit.node.details?.textPath !== undefined;

/// Il tracciato che segue il testo `node`, la sua risorsa; `null` se non è
/// un testo su tracciato, o se la risorsa non c'è o non è un `path`.
export function trackOf(model: DocumentModel, node: ElementPart): LeafNode | null {
  const target = node.details?.textPath;
  if (target === undefined) return null;
  const resource = resourcesOf(model).get(target);
  return resource?.details?.tag === "path" ? resource : null;
}

/// Il testo e la forma da seguire fra `units`; perché no, se non ci sono
/// soltanto loro.
export function pairOf(units: readonly Unit[]): { readonly text: Unit; readonly track: Unit } | TextPathRefused {
  const texts = units.filter((unit) => unit.role === "text");
  const others = units.filter((unit) => unit.role !== "text");
  if (texts.length !== 1 || others.length !== 1) return { reason: "pair" };
  if (!isTrack(others[0]!) || texts[0]!.look === null) return { reason: "not_track" };
  return { text: texts[0]!, track: others[0]! };
}

/// `segments` percorsi al contrario, dall'ultimo sottotracciato al primo.
/// Uno chiuso comincia dallo stesso punto, nell'altro verso.
export function backward(segments: readonly Segment[]): Segment[] {
  interface Sub {
    readonly start: Point;
    readonly steps: Array<{ readonly from: Point; readonly curve: Exclude<Segment, { readonly kind: "move" | "close" }> }>;
    closed: boolean;
  }
  const subs: Sub[] = [];
  let at: Point = [0, 0];
  let current: Sub | null = null;
  for (const segment of segments) {
    if (segment.kind === "move") {
      current = { start: segment.to, steps: [], closed: false };
      subs.push(current);
      at = segment.to;
      continue;
    }
    if (current === null) {
      current = { start: at, steps: [], closed: false };
      subs.push(current);
    }
    if (segment.kind === "close") {
      current.closed = true;
      at = current.start;
      // Dopo una chiusura il tracciato riparte dallo stesso punto.
      current = null;
      continue;
    }
    current.steps.push({ from: at, curve: segment });
    at = segment.to;
  }
  const out: Segment[] = [];
  for (const sub of subs.reverse()) {
    const steps = sub.steps;
    const end = steps.length === 0 ? sub.start : steps[steps.length - 1]!.curve.to;
    if (sub.closed) {
      out.push({ kind: "move", to: sub.start });
      // Il lato che chiude, se non è già scritto, ora apre.
      if (end[0] !== sub.start[0] || end[1] !== sub.start[1]) out.push({ kind: "line", to: end });
    } else {
      out.push({ kind: "move", to: end });
    }
    for (let i = steps.length - 1; i >= 0; i--) out.push(reversed(steps[i]!.from, steps[i]!.curve));
    if (sub.closed) out.push({ kind: "close" });
  }
  return out;
}

/// Le righe di `rich` in una sola, il testo di un tracciato: le righe si
/// uniscono con uno spazio, senza dentro una parola, e una riga vuota non
/// conta. Lo stile di una riga passa ai suoi pezzi.
export function oneLine(rich: Rich): Rich {
  const spans: Span[] = [];
  let text = "";
  rich.lines.forEach((line, i) => {
    if (lineText(line).trim() === "") return;
    const style: Record<string, string> = {};
    for (const [name, value] of Object.entries(line.attrs)) if (!PLACEMENT.has(name)) style[name] = value;
    const own = Object.keys(style).length === 0 ? null : style;
    if (i > 0 && text !== "" && !/\s$/.test(text) && joinOf(line.attrs) !== "word") {
      spans.push({ text: " ", attrs: null });
      text += " ";
    }
    for (const span of line.spans) {
      spans.push({ text: span.text, attrs: own === null ? span.attrs : { ...own, ...(span.attrs ?? {}) } });
      text += span.text;
    }
  });
  return { ...rich, lines: [{ attrs: {}, spans: canonicalSpans(spans) }] };
}

/// La larghezza della prima riga di `rich`, coi suoi caratteri.
function widthOf(rich: Rich, measure: Measure): number {
  const line: RichLine = rich.lines[0] ?? { attrs: {}, spans: [] };
  return line.spans.reduce((sum, span) => sum + measure(span.text, fontIn(rich, line, span)), 0);
}

/// Quanto del testo sta prima del suo punto d'ancoraggio.
const leadOf = (anchor: "start" | "middle" | "end", width: number): number => (anchor === "middle" ? width / 2 : anchor === "end" ? width : 0);

/// Dove va il punto d'ancoraggio di un testo largo `width` su un tracciato
/// lungo `length`: a `near`, o tanto prima o dopo quanto serve perché il
/// testo ci stia tutto. Un testo più lungo del tracciato ne comincia
/// l'inizio, ne occupa il centro o ne finisce la fine.
function fitted(near: number, width: number, length: number, anchor: "start" | "middle" | "end"): number {
  const lead = leadOf(anchor, width);
  if (width >= length) return lead === 0 ? 0 : lead === width ? length : length / 2;
  return Math.min(Math.max(near, lead), length - (width - lead));
}

/// Il `textPath` di un testo che segue `href` da `offset`, con la riga `line`.
function textPathElem(href: string, offset: string | null, line: RichLine): Elem {
  const attrs: Record<string, string> = offset === null ? { href } : { startOffset: offset, href };
  const runs = lineRuns(line);
  return typeof runs === "string" ? { tag: "textPath", attrs, text: runs } : { tag: "textPath", attrs, runs };
}

/// `attrs` senza `id`: un elemento che ne prende il posto con `replaceElem`.
function withoutId(attrs: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) if (name !== "id") out[name] = value;
  return out;
}

/// Una distanza lungo il tracciato come la scrive `startOffset`; `null` per
/// l'inizio, che non si scrive.
const offsetValue = (distance: number): string | null => (formatNumber(distance, 2) === "0" ? null : formatNumber(distance, 2));

/// L'aggiunta del tracciato privato `d` con un id nuovo; il primo prepara
/// la `defs` di FubDraw, se non c'è. Le operazioni vanno prima di quelle
/// dei testi che li seguono.
class Tracks {
  private home: Home | null = null;
  readonly ops: Op[] = [];

  constructor(
    private readonly model: DocumentModel,
    private readonly ids: NewIds,
  ) {}

  /// Il percorso di `node` dopo le operazioni dei tracciati: una `defs` nata
  /// alla radice sta dopo titolo e descrizione, prima di ogni oggetto.
  pathOf(node: ElementPart): number[] {
    const path = [...pathOf(node)];
    if (this.home !== null && this.home.prelude.length > 0) path[0]! += 1;
    return path;
  }

  add(d: string): string {
    const id = this.ids.next("resource");
    if (this.home === null) {
      this.home = homeOf(this.model);
      this.ops.push(...this.home.prelude);
    }
    this.ops.push({ op: "add", parent: this.home.parent, pos: { last: true }, elem: { tag: "path", attrs: { id, "fub:role": "private", d } } });
    return id;
  }
}

/// «Metti sul tracciato»: il testo e la forma scelti insieme, e solo loro.
/// `measure` misura il testo per farlo stare sul tracciato. Dopo è scelto
/// il testo.
export function putOnPathOps(model: DocumentModel, units: readonly Unit[], measure: Measure, ids: NewIds): Arranged | TextPathRefused {
  const pair = pairOf(units);
  if ("reason" in pair) return pair;
  const { text, track } = pair;
  const into = invert(text.matrix);
  if (into === null) return { reason: "empty" };
  const shape = nodeOf(model, track);
  const segments = mapped(shapeSegments(shape.details!.tag, [...plainAttributes(shape)]), compose(into, track.matrix));
  const d = pathData(segments);
  const followed = new Track(segments);
  if (!(followed.length > 0) || parsePath(d) === null) return { reason: "empty" };
  const node = nodeOf(model, text);
  const elem = elemOf(node);
  if (elem === null) return { reason: "foreign" };
  const look = text.look!;
  const line = oneLine(richOf(elem, textInherited(node)));
  const at = fitted(followed.nearest([look.x, look.y]), widthOf(line, measure), followed.length, look.anchor);

  const plan = new Plan(model, ids);
  const tracks = new Tracks(model, ids);
  const href = `#${tracks.add(d)}`;
  plan.ops.push(...tracks.ops);
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(withoutId(elem.attrs))) if (name !== "x" && name !== "y" && name !== WRAP) attrs[name] = value;
  const others = (elem.children ?? []).filter((child) => child.tag !== "tspan" && child.tag !== "textPath");
  const along: Elem = { tag: "text", attrs, children: [...others, textPathElem(href, offsetValue(at), line.lines[0]!)] };
  if (!replaceElem(plan, node, along, tracks.pathOf(node))) return { reason: "foreign" };
  plan.ops.push({ op: "remove", target: plan.idOf(shape) });
  return plan.finish([plan.keyOf(node, text.key)]);
}

/// I testi su tracciato fra `units`, coi loro nodi e i loro elementi;
/// perché no, se non ce n'è o uno non si sa riscrivere.
function alongOf(model: DocumentModel, units: readonly Unit[]): Array<{ readonly unit: Unit; readonly node: ElementPart; readonly elem: Elem; readonly path: Elem }> | TextPathRefused {
  const out = [];
  for (const unit of units.filter(isAlongPath)) {
    const node = nodeOf(model, unit);
    const elem = elemOf(node);
    const path = elem?.children?.find((child) => child.tag === "textPath");
    if (elem === null || path === undefined || unit.look === null) return { reason: "foreign" };
    out.push({ unit, node, elem, path });
  }
  return out.length === 0 ? { reason: "none" } : out;
}

/// «Togli dal tracciato»: i testi su tracciato scelti tornano righe dritte,
/// col loro punto d'ancoraggio dove l'avevano sul tracciato. La selezione
/// resta la stessa.
export function releaseOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged | TextPathRefused {
  const along = alongOf(model, units);
  if ("reason" in along) return along;
  const plan = new Plan(model, ids);
  for (const { unit, node, elem, path } of along) {
    const x = formatNumber(unit.look!.x, 2);
    const y = formatNumber(unit.look!.y, 2);
    const attrs: Record<string, string> = { ...withoutId(elem.attrs), x, y };
    const line: Elem = path.runs === undefined ? { tag: "tspan", attrs: { x, dy: "0" }, text: path.text ?? "" } : { tag: "tspan", attrs: { x, dy: "0" }, runs: path.runs };
    const children = (elem.children ?? []).map((child) => (child === path ? line : child));
    if (!replaceElem(plan, node, { tag: "text", attrs, children })) return { reason: "foreign" };
  }
  return plan.finish(units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key)));
}

/// Quanti testi seguono ogni tracciato di `model`, per id.
function followers(model: DocumentModel): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (node: ElementPart): void => {
    const target = node.details?.textPath;
    if (target !== undefined) out.set(target, (out.get(target) ?? 0) + 1);
    if (node.kind === "container") for (const child of elementChildren(node)) visit(child);
  };
  visit(model.root);
  return out;
}

/// «Rovescia»: il tracciato di ogni testo su tracciato scelto si percorre
/// al contrario, e il testo resta dov'era lungo il tracciato; `measure`
/// misura il testo. La selezione resta la stessa.
export function flipOps(model: DocumentModel, units: readonly Unit[], measure: Measure, ids: NewIds): Arranged | TextPathRefused {
  const along = alongOf(model, units);
  if ("reason" in along) return along;
  const resources = resourcesOf(model);
  const users = followers(model);
  const plan = new Plan(model, ids);
  const tracks = new Tracks(model, ids);
  const edits: Op[] = [];
  const replaced: Array<{ readonly node: ElementPart; readonly elem: Elem }> = [];
  for (const { unit, node, elem, path } of along) {
    const target = node.details!.textPath!;
    const resource = resources.get(target);
    const segments = resource === undefined ? [] : parsePath(plainAttributes(resource).get("d") ?? "") ?? [];
    const followed = new Track(segments);
    if (!(followed.length > 0)) return { reason: "empty" };
    const d = pathData(backward(segments));
    // Lo stesso tratto del tracciato, contato dall'altro capo.
    const length = followed.length;
    const width = widthOf(richOf(elem, textInherited(node)), measure);
    const lead = leadOf(unit.look!.anchor, width);
    const written = path.attrs.startOffset;
    const offset = (written === undefined ? null : startOffset(written)) ?? { value: 0, share: false };
    const from = offset.share ? offset.value * length : offset.value;
    const to = Math.min(Math.max(length - from + 2 * lead - width, 0), length);
    const value = offset.share ? `${formatNumber((to / length) * 100, 2)}%` : offsetValue(to);
    // Il riferimento resta scritto com'era: `href` o `xlink:href`.
    const name = path.attrs.href !== undefined ? "href" : Object.keys(path.attrs).find((key) => key.endsWith(":href")) ?? "href";
    let href = path.attrs[name] ?? `#${target}`;
    if (resource!.details!.lifecycle === "private" && users.get(target) === 1) edits.push({ op: "set", id: target, attrs: { d } });
    else href = `#${tracks.add(d)}`;
    if (value === (written ?? null) && href === path.attrs[name]) continue;
    const attrs: Record<string, string> = {};
    for (const [key, v] of Object.entries(path.attrs)) if (key !== "startOffset") attrs[key] = v;
    if (value !== null) attrs.startOffset = value;
    attrs[name] = href;
    const children = (elem.children ?? []).map((child): Elem => (child === path ? { ...path, attrs } : child));
    replaced.push({ node, elem: { tag: "text", attrs: withoutId(elem.attrs), children } });
  }
  plan.ops.push(...edits, ...tracks.ops);
  for (const { node, elem } of replaced) if (!replaceElem(plan, node, elem, tracks.pathOf(node))) return { reason: "foreign" };
  return plan.finish(units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key)));
}
