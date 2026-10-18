// Il testo a pezzi che si scrive sul posto (livello Standard): le righe di
// un testo coi loro pezzi, come le cambia il campo di scrittura, e come
// tornano righe del file (formato della scena, testo).
//
// - **Il campo lavora su questo modello, non sul suo DOM.** Ciò che si
//   scrive, si cancella o si formatta cambia il modello, e il campo lo
//   ridisegna: i pezzi restano quelli che il file scriverà.
// - **Ciò che si scrive prende lo stile del carattere prima**, o del primo
//   dopo all'inizio di una riga, come nei programmi di scrittura; dopo un
//   a capo, quello della fine della riga spezzata.
// - **Una riga nuova copia la riga in cui nasce**, senza `id`, e scende
//   dell'interlinea del testo, come le righe nuove dell'operazione `text`;
//   la riga spezzata tiene i suoi attributi, così la prima riga resta dove
//   comincia il testo.
// - **Un intervallo cambia carattere per carattere.** Grassetto, corsivo,
//   sottolineato e barrato si accendono se manca a qualcuno, e si spengono
//   se ce l'hanno tutti. Un valore uguale a quello della riga si toglie dal
//   pezzo, che resta corto, o se ne va.
// - **Una linea della riga o del testo** non si spegne in un pezzo, perché
//   SVG la tira sotto tutto ciò che contiene: scende ai pezzi che la
//   tengono, e la riga o il testo la lasciano.
// - **Gli spazi come li mostra SVG**, come in `text.ts`: spazi e
//   tabulazioni in fila ne valgono uno, anche a cavallo di due pezzi, e ai
//   bordi di una riga niente; le righe vuote in testa e in coda non si
//   scrivono, e quella fra due scritte è uno spazio indivisibile.

import { formatNumber } from "../number";
import type { TextLine } from "../scene/ops";
import type { Elem, Run } from "../scene/serialize";
import { length, letterSpacing, nonNegativeLength, paint, textDecoration, trim } from "../scene/values";
import { BLANK_LINE, LINE_SPACING, xmlText } from "./text";

/// Gli attributi di un elemento, come li nomina un'operazione.
export type Attrs = Readonly<Record<string, string>>;

/// Un tratto di una riga: il suo testo, e gli attributi del pezzo; `null` è
/// il testo della riga.
export interface Span {
  readonly text: string;
  readonly attrs: Attrs | null;
}

/// Una riga: gli attributi del suo `tspan` e i tratti.
export interface RichLine {
  readonly attrs: Attrs;
  readonly spans: readonly Span[];
}

/// Un testo: gli attributi del `text`, ciò che eredita da chi lo contiene, e
/// le righe.
export interface Rich {
  readonly attrs: Attrs;
  /// I valori che il `text` vede dai contenitori, per gli attributi che si
  /// ereditano ([`INHERITED`]).
  readonly inherited: Attrs;
  readonly lines: readonly RichLine[];
}

/// Un punto del testo: la riga, e quante unità UTF-16 la precedono nella
/// riga.
export interface Caret {
  readonly line: number;
  readonly offset: number;
}

/// Gli attributi che un pezzo eredita dalla riga e dal testo, e che il campo
/// mostra.
export const INHERITED: readonly string[] = ["fill", "font-family", "font-size", "font-weight", "font-style", "letter-spacing"];

/// Le enfasi che si accendono e si spengono su un intervallo.
export type Emphasis = "bold" | "italic" | "underline" | "strike";

export const EMPHASES: readonly Emphasis[] = ["bold", "italic", "underline", "strike"];

/// La linea di `text-decoration` di ogni enfasi che ne ha una.
const LINES: Readonly<Partial<Record<Emphasis, string>>> = { underline: "underline", strike: "line-through" };

/// Le linee nell'ordine in cui si scrivono.
const LINE_ORDER = ["underline", "overline", "line-through"];

/// Il peso da cui un carattere è in grassetto.
const BOLD_FROM = 600;

/// Ciò che XML 1.0 non ammette, e le righe.
const BREAK = /\r\n|[\r\n\u2028\u2029]/;

/// L'attributo di una riga che continua il paragrafo della riga prima, in
/// un testo in area (formato della scena, testo): `space` o `word`.
export const JOIN = "fub:join";

/// Gli attributi di `attrs` senza [`JOIN`].
export function withoutJoin(attrs: Attrs): Attrs {
  if (attrs[JOIN] === undefined) return attrs;
  const out: Record<string, string> = { ...attrs };
  delete out[JOIN];
  return out;
}

// ---------------------------------------------------------------------------
// Leggere.
// ---------------------------------------------------------------------------

/// Vero se `a` e `b` hanno gli stessi attributi, o sono tutti e due `null`.
export function sameAttrs(a: Attrs | null, b: Attrs | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
}

/// I tratti `spans` senza quelli vuoti, coi vicini uguali uniti e i pezzi
/// senza attributi fatti testo della riga.
export function canonicalSpans(spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    if (span.text === "") continue;
    const attrs = span.attrs !== null && Object.keys(span.attrs).length === 0 ? null : span.attrs;
    const last = out[out.length - 1];
    if (last !== undefined && sameAttrs(last.attrs, attrs)) out[out.length - 1] = { text: last.text + span.text, attrs };
    else out.push(attrs === span.attrs ? span : { text: span.text, attrs });
  }
  return out;
}

/// La riga coi tratti di `content`, il testo o le parti di una riga del file.
export function richLine(attrs: Attrs, content: string | readonly Run[]): RichLine {
  if (typeof content === "string") return { attrs, spans: canonicalSpans([{ text: content, attrs: null }]) };
  return { attrs, spans: canonicalSpans(content.map((run) => (typeof run === "string" ? { text: run, attrs: null } : { text: run.text, attrs: run.attrs }))) };
}

/// Il testo `elem`, come lo scrive un'operazione, che eredita `inherited`:
/// ogni `tspan` figlio è una riga, e il `textPath` di un testo su tracciato
/// la riga sola, senza attributi.
export function richOf(elem: Elem, inherited: Attrs): Rich {
  const lines = (elem.children ?? []).flatMap((child) => {
    if (child.tag === "tspan") return [richLine(child.attrs, child.runs ?? child.text ?? "")];
    return child.tag === "textPath" ? [richLine({}, child.runs ?? child.text ?? "")] : [];
  });
  return { attrs: elem.attrs, inherited, lines: lines.length === 0 ? [{ attrs: { dy: "0" }, spans: [] }] : lines };
}

/// `rich` come si apre per scriverlo: una riga che non ha niente da leggere,
/// come lo spazio indivisibile di una riga vuota, si apre vuota.
export function editableRich(rich: Rich): Rich {
  return { ...rich, lines: rich.lines.map((line) => (lineText(line).trim() === "" ? { attrs: line.attrs, spans: [] } : line)) };
}

/// Il testo `old` con gli attributi e le righe di `rich`; gli altri figli,
/// come un titolo, restano prima delle righe, come li mette l'operazione
/// `text`. Un testo su tracciato ha la prima riga nel suo `textPath`.
export function richElem(old: Elem, rich: Rich): Elem {
  const along = old.children?.find((child) => child.tag === "textPath");
  if (along !== undefined) {
    const runs = lineRuns(rich.lines[0] ?? { attrs: {}, spans: [] });
    const path: Elem = typeof runs === "string" ? { tag: "textPath", attrs: along.attrs, text: runs } : { tag: "textPath", attrs: along.attrs, runs };
    return { tag: old.tag, attrs: rich.attrs, children: old.children!.map((child) => (child === along ? path : child)) };
  }
  const others = (old.children ?? []).filter((child) => child.tag !== "tspan");
  const lines = rich.lines.map((line): Elem => {
    const runs = lineRuns(line);
    return typeof runs === "string" ? { tag: "tspan", attrs: line.attrs, text: runs } : { tag: "tspan", attrs: line.attrs, runs };
  });
  return { tag: old.tag, attrs: rich.attrs, children: [...others, ...lines] };
}

/// Il testo di `line`, coi pezzi.
export function lineText(line: RichLine): string {
  return line.spans.map((span) => span.text).join("");
}

/// Le parti di `line` come le prende l'operazione `text`: una stringa se non
/// ha pezzi.
export function lineRuns(line: RichLine): TextLine {
  const spans = canonicalSpans(line.spans);
  if (spans.every((span) => span.attrs === null)) return spans.map((span) => span.text).join("");
  return spans.map((span): Run => (span.attrs === null ? span.text : { text: span.text, attrs: span.attrs }));
}

/// Il testo di `rich`, una riga per riga.
export function richText(rich: Rich): string {
  return rich.lines.map(lineText).join("\n");
}

/// Il valore di `name`, uno di [`INHERITED`], che vede il tratto `span`
/// della riga `line`.
export function seenIn(rich: Rich, line: RichLine, span: Span | null, name: string): string | undefined {
  return span?.attrs?.[name] ?? line.attrs[name] ?? rich.attrs[name] ?? rich.inherited[name];
}

/// Le linee che si tirano sotto `span`: le sue, quelle della riga e quelle
/// del testo.
export function linesOf(rich: Rich, line: RichLine, span: Span | null): Set<string> {
  const out = new Set<string>();
  for (const value of [rich.attrs["text-decoration"], line.attrs["text-decoration"], span?.attrs?.["text-decoration"]]) {
    for (const each of value === undefined ? [] : textDecoration(value) ?? []) out.add(each);
  }
  return out;
}

/// Il peso di `value` come numero: `normal` 400, `bold` 700.
export function weightOf(value: string | undefined): number {
  const text = trim(value ?? "normal");
  if (text === "normal") return 400;
  if (text === "bold") return 700;
  const n = Number(text);
  return Number.isFinite(n) ? n : 400;
}

/// Vero se il tratto `span` della riga `line` ha l'enfasi `which`.
export function hasEmphasis(rich: Rich, line: RichLine, span: Span | null, which: Emphasis): boolean {
  switch (which) {
    case "bold":
      return weightOf(seenIn(rich, line, span, "font-weight")) >= BOLD_FROM;
    case "italic": {
      const style = trim(seenIn(rich, line, span, "font-style") ?? "normal");
      return style === "italic" || style === "oblique";
    }
    default:
      return linesOf(rich, line, span).has(LINES[which]!);
  }
}

/// Il corpo con cui si vede il tratto `span` della riga `line`; 16 se
/// nessuno lo scrive.
export function sizeIn(rich: Rich, line: RichLine, span: Span | null): number {
  const value = seenIn(rich, line, span, "font-size");
  return (value === undefined ? null : nonNegativeLength(value)) ?? 16;
}

// ---------------------------------------------------------------------------
// I punti.
// ---------------------------------------------------------------------------

/// Negativo se `a` viene prima di `b`, positivo se dopo.
export function compareCarets(a: Caret, b: Caret): number {
  return a.line - b.line || a.offset - b.offset;
}

/// `a` e `b` in ordine.
export function ordered(a: Caret, b: Caret): [Caret, Caret] {
  return compareCarets(a, b) <= 0 ? [a, b] : [b, a];
}

/// `caret` dentro `rich`.
export function clampCaret(rich: Rich, caret: Caret): Caret {
  const line = Math.max(0, Math.min(rich.lines.length - 1, caret.line));
  const size = lineText(rich.lines[line]!).length;
  return { line, offset: Math.max(0, Math.min(size, caret.offset)) };
}

/// La fine di `rich`.
export function endOf(rich: Rich): Caret {
  const line = rich.lines.length - 1;
  return { line, offset: lineText(rich.lines[line]!).length };
}

/// I tratti di `spans` prima e dopo `offset`.
function splitAt(spans: readonly Span[], offset: number): [Span[], Span[]] {
  const before: Span[] = [];
  const after: Span[] = [];
  let at = 0;
  for (const span of spans) {
    const end = at + span.text.length;
    if (end <= offset) before.push(span);
    else if (at >= offset) after.push(span);
    else {
      before.push({ text: span.text.slice(0, offset - at), attrs: span.attrs });
      after.push({ text: span.text.slice(offset - at), attrs: span.attrs });
    }
    at = end;
  }
  return [before, after];
}

/// Gli attributi del pezzo a `caret`: quelli del carattere prima, o del
/// primo dopo all'inizio di una riga; `null` per il testo della riga.
export function styleAt(rich: Rich, caret: Caret): Attrs | null {
  const line = rich.lines[caret.line];
  if (line === undefined) return null;
  const [before, after] = splitAt(line.spans, caret.offset);
  return (before[before.length - 1] ?? after[0])?.attrs ?? null;
}

// ---------------------------------------------------------------------------
// Scrivere e cancellare.
// ---------------------------------------------------------------------------

/// L'interlinea di una riga nuova, come la dà l'operazione `text`: il `dy`
/// dell'ultima riga dopo la prima che lo scrive, oppure 1,25 volte il corpo
/// dell'ultima riga.
export function newLeading(rich: Rich): string {
  for (let k = rich.lines.length - 1; k >= 1; k--) {
    const dy = rich.lines[k]!.attrs.dy;
    if (dy !== undefined) return dy;
  }
  const last = rich.lines[rich.lines.length - 1];
  const size = last === undefined ? sizeOf(rich.attrs["font-size"] ?? rich.inherited["font-size"]) : sizeOf(last.attrs["font-size"] ?? rich.attrs["font-size"] ?? rich.inherited["font-size"]);
  return formatNumber(size * LINE_SPACING, 2);
}

const sizeOf = (value: string | undefined): number => (value === undefined ? null : nonNegativeLength(value)) ?? 16;

/// Gli attributi di una riga nuova dopo `previous`: i suoi, senza `id`, e
/// l'interlinea `leading`. Una riga nuova comincia un paragrafo: non copia
/// [`JOIN`].
export function freshAttrs(previous: RichLine, leading: string): Attrs {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(previous.attrs)) if (name !== "id" && name !== "dy" && name !== JOIN) out[name] = value;
  out.dy = leading;
  return out;
}

/// Ciò che il file può scrivere di `text`: senza i caratteri che XML non
/// ammette.
export const cleanText = (text: string): string => xmlText(text);

/// `rich` con il testo fra `from` e `to` sostituito da `text`, che può
/// andare a capo, scritto coi pezzi `attrs`; e il punto dopo ciò che si è
/// scritto.
export function replaceRange(rich: Rich, from: Caret, to: Caret, text: string, attrs: Attrs | null): { readonly rich: Rich; readonly caret: Caret } {
  const [start, end] = ordered(clampCaret(rich, from), clampCaret(rich, to));
  const first = rich.lines[start.line]!;
  const last = rich.lines[end.line]!;
  const [head] = splitAt(first.spans, start.offset);
  const [, tail] = splitAt(last.spans, end.offset);
  const chunks = cleanText(text).split(BREAK);
  const leading = newLeading(rich);
  const made: RichLine[] = [];
  let caret: Caret = start;
  chunks.forEach((chunk, i) => {
    const piece: Span = { text: chunk, attrs };
    const line: RichLine = i === 0 ? { attrs: first.attrs, spans: [...head, piece] } : { attrs: freshAttrs(made[i - 1]!, leading), spans: [piece] };
    made.push(line);
    caret = { line: start.line + i, offset: lineText(line).length };
  });
  const closing = made[made.length - 1]!;
  made[made.length - 1] = { attrs: closing.attrs, spans: [...closing.spans, ...tail] };
  const lines = [...rich.lines.slice(0, start.line), ...made.map((line) => ({ attrs: line.attrs, spans: canonicalSpans(line.spans) })), ...rich.lines.slice(end.line + 1)];
  return { rich: { ...rich, lines }, caret };
}

// ---------------------------------------------------------------------------
// Formattare.
// ---------------------------------------------------------------------------

/// `rich` con i tratti fra `from` e `to` passati per `change`, che riceve il
/// tratto e la sua riga e dà gli attributi del pezzo.
function mapRange(rich: Rich, from: Caret, to: Caret, change: (span: Span, line: RichLine) => Attrs | null): Rich {
  const [start, end] = ordered(clampCaret(rich, from), clampCaret(rich, to));
  const lines = rich.lines.map((line, i) => {
    if (i < start.line || i > end.line) return line;
    const a = i === start.line ? start.offset : 0;
    const b = i === end.line ? end.offset : lineText(line).length;
    if (a >= b) return line;
    const [before, rest] = splitAt(line.spans, a);
    const [inside, after] = splitAt(rest, b - a);
    const changed = inside.map((span) => ({ text: span.text, attrs: change(span, line) }));
    return { attrs: line.attrs, spans: canonicalSpans([...before, ...changed, ...after]) };
  });
  return { ...rich, lines };
}

/// I tratti fra `from` e `to`, con la loro riga; quelli vuoti no.
function spansIn(rich: Rich, from: Caret, to: Caret): Array<{ readonly line: RichLine; readonly span: Span }> {
  const [start, end] = ordered(clampCaret(rich, from), clampCaret(rich, to));
  const out: Array<{ line: RichLine; span: Span }> = [];
  for (let i = start.line; i <= end.line; i++) {
    const line = rich.lines[i]!;
    const a = i === start.line ? start.offset : 0;
    const b = i === end.line ? end.offset : lineText(line).length;
    if (a >= b) continue;
    const [, rest] = splitAt(line.spans, a);
    const [inside] = splitAt(rest, b - a);
    for (const span of inside) out.push({ line, span });
  }
  return out;
}

/// Vero se l'intervallo fra `from` e `to` non ha caratteri.
export function emptyRange(rich: Rich, from: Caret, to: Caret): boolean {
  return spansIn(rich, from, to).length === 0;
}

/// Gli attributi `attrs` con `name` a `value`, o senza se `value` è `null`.
function withAttr(attrs: Attrs | null, name: string, value: string | null): Attrs | null {
  const out: Record<string, string> = { ...(attrs ?? {}) };
  if (value === null) delete out[name];
  else out[name] = value;
  return Object.keys(out).length === 0 ? null : out;
}

/// Il valore di `name` che vede la riga `line`, senza i pezzi.
const lineSeen = (rich: Rich, line: RichLine, name: string): string | undefined => line.attrs[name] ?? rich.attrs[name] ?? rich.inherited[name];

/// `rich` coi caratteri fra `from` e `to` che vedono `value` in `name`, uno
/// di [`INHERITED`]: un pezzo che lo vedrebbe comunque dalla riga non lo
/// scrive.
export function setInRange(rich: Rich, from: Caret, to: Caret, name: string, value: string): Rich {
  return mapRange(rich, from, to, (span, line) => withAttr(span.attrs, name, sameValue(name, lineSeen(rich, line, name), value) ? null : value));
}

/// `rich` con `value` in `name`, uno di [`INHERITED`], sul testo intero: le
/// righe e i pezzi che ne scrivevano un altro lo lasciano. Un corpo nuovo
/// porta con sé le interlinee e le spaziature delle lettere, ciascuna in
/// proporzione al corpo su cui si misura: il testo cambia grandezza e non
/// forma.
export function restyleWhole(rich: Rich, name: string, value: string): Rich {
  const after = name === "font-size" ? nonNegativeLength(value) : null;
  const leadings = after === null ? [] : rich.lines.map((_, i) => leadingOf(rich, i));
  /// La spaziatura scritta in `attrs`, per chi la vede col corpo `size`,
  /// portata al corpo nuovo.
  const respace = (attrs: Record<string, string>, size: number): void => {
    const gap = attrs["letter-spacing"] === undefined ? null : length(attrs["letter-spacing"]);
    if (after !== null && gap !== null && size > 0) attrs["letter-spacing"] = formatNumber((gap / size) * after, 2);
  };
  const attrs: Record<string, string> = { ...rich.attrs };
  respace(attrs, sizeOf(rich.attrs["font-size"] ?? rich.inherited["font-size"]));
  attrs[name] = value;
  return {
    ...rich,
    attrs,
    lines: rich.lines.map((line, i) => {
      const own: Record<string, string> = { ...line.attrs };
      respace(own, sizeIn(rich, line, null));
      delete own[name];
      const leading = leadings[i];
      if (after !== null && leading !== null && leading !== undefined) own.dy = formatNumber(leading * after, 2);
      return {
        attrs: own,
        spans: canonicalSpans(
          line.spans.map((span) => {
            if (span.attrs === null) return span;
            const piece: Record<string, string> = { ...span.attrs };
            respace(piece, sizeIn(rich, line, span));
            delete piece[name];
            return { text: span.text, attrs: Object.keys(piece).length === 0 ? null : piece };
          }),
        ),
      };
    }),
  };
}

/// `rich` con `value` in `name`, uno di [`INHERITED`], scritto sul testo,
/// come lo dà uno stile a un testo che non ha lo stesso valore dappertutto:
/// le righe e i pezzi che ne scrivono un altro lo tengono, come una parola
/// in grassetto o in un altro colore, e lasciano soltanto lo stesso valore.
/// Un corpo nuovo porta con sé le interlinee e le spaziature scritte, come
/// in [`restyleWhole`].
export function restyleKeeping(rich: Rich, name: string, value: string): Rich {
  const keep = (attrs: Attrs | null): Attrs | null => (attrs !== null && sameValue(name, attrs[name], value) ? withAttr(attrs, name, null) : attrs);
  const next: Rich = {
    ...rich,
    attrs: { ...rich.attrs, [name]: value },
    lines: rich.lines.map((line) => ({ attrs: keep(line.attrs) ?? {}, spans: line.spans.map((span) => ({ text: span.text, attrs: keep(span.attrs) })) })),
  };
  const sized = name === "font-size" ? resized(rich, next) : next;
  return { ...sized, lines: sized.lines.map((line) => ({ attrs: line.attrs, spans: canonicalSpans(line.spans) })) };
}

/// `after`, che è `before` con altri corpi e le stesse righe e gli stessi
/// pezzi: ogni spaziatura scritta resta la stessa in volte il corpo su cui
/// si misura, e ogni interlinea in volte il corpo più grande delle due
/// righe.
function resized(before: Rich, after: Rich): Rich {
  const respace = (attrs: Attrs | null, from: number, to: number): Attrs | null => {
    const gap = attrs?.["letter-spacing"] === undefined ? null : length(attrs["letter-spacing"]);
    return gap === null || !(from > 0) || from === to ? attrs : { ...attrs, "letter-spacing": formatNumber((gap / from) * to, 2) };
  };
  const spaced: Rich = {
    ...after,
    attrs: respace(after.attrs, sizeOf(before.attrs["font-size"] ?? before.inherited["font-size"]), sizeOf(after.attrs["font-size"] ?? after.inherited["font-size"])) ?? {},
    lines: after.lines.map((line, i) => {
      const old = before.lines[i]!;
      return {
        attrs: respace(line.attrs, sizeIn(before, old, null), sizeIn(after, line, null)) ?? {},
        spans: line.spans.map((span, k) => ({ text: span.text, attrs: respace(span.attrs, sizeIn(before, old, old.spans[k]!), sizeIn(after, line, span)) })),
      };
    }),
  };
  return {
    ...spaced,
    lines: spaced.lines.map((line, i) => {
      const leading = leadingOf(before, i);
      if (leading === null) return line;
      const size = Math.max(tallestIn(spaced, spaced.lines[i - 1]!), tallestIn(spaced, line));
      return { attrs: { ...line.attrs, dy: formatNumber(leading * size, 2) }, spans: line.spans };
    }),
  };
}

/// `rich` con la linea `which`, il sottolineato o il barrato, accesa o
/// spenta sul testo, come la dà uno stile a un testo che non l'ha
/// dappertutto: le righe e i pezzi che la scrivono la tengono.
export function emphasizeKeeping(rich: Rich, which: "underline" | "strike", on: boolean): Rich {
  return { ...rich, attrs: withLine(rich.attrs, LINES[which]!, on) ?? {} };
}

// ---------------------------------------------------------------------------
// Il testo intero, come lo legge e lo scrive il pannello.
// ---------------------------------------------------------------------------

/// I tratti che si leggono: con almeno un carattere che non è uno spazio.
export function visibleSpans(rich: Rich): Array<{ readonly line: RichLine; readonly span: Span }> {
  const out: Array<{ line: RichLine; span: Span }> = [];
  for (const line of rich.lines) for (const span of line.spans) if (span.text.trim() !== "") out.push({ line, span });
  return out;
}

/// I valori di `name`, uno di [`INHERITED`], che vedono i caratteri del
/// testo, una volta ciascuno; quello del testo se non ha caratteri.
export function seenValues(rich: Rich, name: string): string[] {
  const spans = visibleSpans(rich);
  if (spans.length === 0) {
    const value = rich.attrs[name] ?? rich.inherited[name];
    return value === undefined ? [] : [value];
  }
  return [...new Set(spans.map(({ line, span }) => seenIn(rich, line, span, name) ?? ""))];
}

/// Il corpo più grande della riga `line`: quello che la fa alta.
export function tallestIn(rich: Rich, line: RichLine): number {
  return Math.max(sizeIn(rich, line, null), ...line.spans.filter((span) => span.text !== "").map((span) => sizeIn(rich, line, span)));
}

/// L'interlinea della riga `i`, in volte il corpo: quanto scende dalla riga
/// prima, sul corpo più grande delle due. `null` per la prima riga, o per
/// una che non scende di una lunghezza.
export function leadingOf(rich: Rich, i: number): number | null {
  const line = rich.lines[i];
  if (i === 0 || line === undefined) return null;
  const dy = line.attrs.dy === undefined ? null : length(line.attrs.dy);
  const size = Math.max(tallestIn(rich, rich.lines[i - 1]!), tallestIn(rich, line));
  return dy === null || size <= 0 ? null : dy / size;
}

/// `rich` con l'interlinea `leading`, in volte il corpo, su ogni riga dopo
/// la prima.
export function withLeading(rich: Rich, leading: number): Rich {
  return {
    ...rich,
    lines: rich.lines.map((line, i) => {
      if (i === 0) return line;
      const size = Math.max(tallestIn(rich, rich.lines[i - 1]!), tallestIn(rich, line));
      return { attrs: { ...line.attrs, dy: formatNumber(leading * size, 2) }, spans: line.spans };
    }),
  };
}

/// La spaziatura delle lettere dei caratteri del testo, in volte il loro
/// corpo, una volta ciascuna.
export function spacingsOf(rich: Rich): number[] {
  const spans = visibleSpans(rich);
  const seen = spans.length === 0 ? [{ line: rich.lines[0] ?? { attrs: {}, spans: [] }, span: null }] : spans;
  const out = new Set<number>();
  for (const { line, span } of seen) {
    const size = sizeIn(rich, line, span);
    const gap = letterSpacing(seenIn(rich, line, span, "letter-spacing") ?? "normal") ?? 0;
    out.add(size > 0 ? Math.round((gap / size) * 1e4) / 1e4 : 0);
  }
  return [...out];
}

/// `rich` con le lettere spaziate di `spacing` volte il corpo, sul testo
/// intero: il testo la scrive sul suo corpo, e una riga o un pezzo di un
/// altro corpo sul proprio.
export function withSpacing(rich: Rich, spacing: number): Rich {
  const gap = (size: number): string => (spacing === 0 ? "0" : formatNumber(spacing * size, 2));
  const text = sizeOf(rich.attrs["font-size"] ?? rich.inherited["font-size"]);
  const base = restyleWhole(rich, "letter-spacing", gap(text));
  return {
    ...base,
    lines: base.lines.map((line, i) => {
      const before = rich.lines[i]!;
      const lineSize = sizeIn(rich, before, null);
      const attrs: Record<string, string> = { ...line.attrs };
      if (before.attrs["font-size"] !== undefined && gap(lineSize) !== gap(text)) attrs["letter-spacing"] = gap(lineSize);
      const seenGap = attrs["letter-spacing"] ?? gap(text);
      return {
        attrs,
        spans: canonicalSpans(
          line.spans.map((span) => {
            if (span.attrs === null || span.attrs["font-size"] === undefined) return span;
            const own = gap(sizeIn(rich, before, span));
            return own === seenGap ? span : { text: span.text, attrs: { ...span.attrs, "letter-spacing": own } };
          }),
        ),
      };
    }),
  };
}

/// Vero se tutti i caratteri del testo hanno l'enfasi `which`, falso se
/// nessuno, `null` se qualcuno sì e qualcuno no.
export function emphasisOf(rich: Rich, which: Emphasis): boolean | null {
  const spans = visibleSpans(rich);
  const seen = spans.length === 0 ? [{ line: rich.lines[0] ?? { attrs: {}, spans: [] }, span: null }] : spans;
  const on = seen.map(({ line, span }) => hasEmphasis(rich, line, span, which));
  return on.every(Boolean) ? true : on.some(Boolean) ? null : false;
}

/// `rich` con l'enfasi `which` accesa o spenta sul testo intero: il peso o
/// il corsivo come un altro attributo; una linea la scrive il testo, che la
/// tira col suo colore sotto tutte le righe, e righe e pezzi la lasciano.
export function emphasizeWhole(rich: Rich, which: Emphasis, on: boolean): Rich {
  if (which === "bold") return restyleWhole(rich, "font-weight", on ? "bold" : "normal");
  if (which === "italic") return restyleWhole(rich, "font-style", on ? "italic" : "normal");
  const line = LINES[which]!;
  const strip = (attrs: Attrs | null): Attrs | null => withLine(attrs, line, false);
  return {
    ...rich,
    attrs: withLine(rich.attrs, line, on) ?? {},
    lines: rich.lines.map((row) => ({ attrs: strip(row.attrs) ?? {}, spans: canonicalSpans(row.spans.map((span) => ({ text: span.text, attrs: strip(span.attrs) }))) })),
  };
}

/// L'allineamento che vede ogni riga del testo, una volta ciascuno.
export function anchorsOf(rich: Rich): string[] {
  const lines = rich.lines.filter((line) => lineText(line).trim() !== "");
  const seen = lines.length === 0 ? rich.lines : lines;
  return [...new Set(seen.map((line) => trim(line.attrs["text-anchor"] ?? rich.attrs["text-anchor"] ?? rich.inherited["text-anchor"] ?? "start")))];
}

/// Due valori di `name` che si vedono uguali.
function sameValue(name: string, a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  if (name === "font-weight") return weightOf(a) === weightOf(b);
  if (name === "fill") {
    // Lo stesso colore, scritto in un altro modo.
    const p = paint(a);
    const q = paint(b);
    if (p !== null && q !== null) return p === "none" || q === "none" ? p === q : p.every((value, at) => value === q[at]);
  }
  if (name === "font-size" || name === "letter-spacing") {
    const p = trim(a) === "normal" ? 0 : length(a);
    const q = trim(b) === "normal" ? 0 : length(b);
    return p !== null && q !== null && formatNumber(p, 2) === formatNumber(q, 2);
  }
  return trim(a) === trim(b);
}

/// Il valore di `text-decoration` con le linee `lines`, o `null` se non ne
/// ha.
function decorationValue(lines: ReadonlySet<string>): string | null {
  const ordered = LINE_ORDER.filter((each) => lines.has(each));
  return ordered.length === 0 ? null : ordered.join(" ");
}

/// Le linee scritte in `attrs`, senza quelle di chi li contiene.
export const ownLines = (attrs: Attrs | null): Set<string> => new Set(attrs?.["text-decoration"] === undefined ? [] : textDecoration(attrs["text-decoration"]) ?? []);

/// `attrs` con la linea `which` aggiunta o tolta.
function withLine(attrs: Attrs | null, which: string, on: boolean): Attrs | null {
  const lines = ownLines(attrs);
  if (on) lines.add(which);
  else lines.delete(which);
  return withAttr(attrs, "text-decoration", decorationValue(lines));
}

/// Vero se ogni carattere fra `from` e `to` ha l'enfasi `which`; con un
/// intervallo vuoto, il carattere a `from` come lo scriverebbe `styleAt`.
export function emphasisIn(rich: Rich, from: Caret, to: Caret, which: Emphasis): boolean {
  const spans = spansIn(rich, from, to);
  if (spans.length > 0) return spans.every(({ line, span }) => hasEmphasis(rich, line, span, which));
  const line = rich.lines[clampCaret(rich, from).line]!;
  return hasEmphasis(rich, line, { text: "", attrs: styleAt(rich, from) }, which);
}

/// `rich` coi caratteri fra `from` e `to` con l'enfasi `which` accesa o
/// spenta.
export function emphasize(rich: Rich, from: Caret, to: Caret, which: Emphasis, on: boolean): Rich {
  if (which === "bold") return setInRange(rich, from, to, "font-weight", on ? "bold" : "normal");
  if (which === "italic") return setInRange(rich, from, to, "font-style", on ? "italic" : "normal");
  const line = LINES[which]!;
  if (on) return mapRange(rich, from, to, (span, row) => (linesOf(rich, row, span).has(line) ? span.attrs : withLine(span.attrs, line, true)));
  // Spegnere: la linea della riga o del testo scende prima ai tratti.
  const [start, end] = ordered(clampCaret(rich, from), clampCaret(rich, to));
  let next = rich;
  if (ownLines(rich.attrs).has(line)) {
    next = {
      attrs: withLine(rich.attrs, line, false) ?? {},
      inherited: rich.inherited,
      lines: rich.lines.map((row) => ({ attrs: withLine(row.attrs, line, true) ?? {}, spans: row.spans })),
    };
  }
  const lines = next.lines.map((row, i) => {
    if (i < start.line || i > end.line || !ownLines(row.attrs).has(line)) return row;
    return { attrs: withLine(row.attrs, line, false) ?? {}, spans: canonicalSpans(row.spans.map((span) => ({ text: span.text, attrs: withLine(span.attrs, line, true) }))) };
  });
  next = { ...next, lines };
  return mapRange(next, start, end, (span) => withLine(span.attrs, line, false));
}

/// `rich` con l'enfasi `which` fra `from` e `to` cambiata: spenta se ce
/// l'hanno tutti, accesa altrimenti.
export function toggleEmphasis(rich: Rich, from: Caret, to: Caret, which: Emphasis): Rich {
  return emphasize(rich, from, to, which, !emphasisIn(rich, from, to, which));
}

/// I valori di `name`, uno di [`INHERITED`], dei caratteri fra `from` e
/// `to`; con un intervallo vuoto, quello del carattere che si scriverebbe.
export function valuesIn(rich: Rich, from: Caret, to: Caret, name: string): Array<string | undefined> {
  const spans = spansIn(rich, from, to);
  if (spans.length > 0) return spans.map(({ line, span }) => seenIn(rich, line, span, name));
  const line = rich.lines[clampCaret(rich, from).line]!;
  return [seenIn(rich, line, { text: "", attrs: styleAt(rich, from) }, name)];
}

// ---------------------------------------------------------------------------
// Il testo come lo scrive il file.
// ---------------------------------------------------------------------------

/// La riga `line` con gli spazi come li mostra SVG: in fila ne vale uno, del
/// tratto dove la fila comincia, e ai bordi niente.
function tidyLine(line: RichLine): RichLine {
  const chars: Array<{ ch: string; attrs: Attrs | null }> = [];
  for (const span of line.spans) {
    for (const ch of cleanText(span.text).replace(/\t/g, " ")) {
      if (ch === " " && (chars.length === 0 || chars[chars.length - 1]!.ch === " ")) continue;
      chars.push({ ch, attrs: span.attrs });
    }
  }
  while (chars.length > 0 && chars[chars.length - 1]!.ch === " ") chars.pop();
  return { attrs: line.attrs, spans: canonicalSpans(chars.map(({ ch, attrs }) => ({ text: ch, attrs }))) };
}

/// Vero se `line` non ha niente da leggere.
const blank = (line: RichLine): boolean => lineText(line).trim() === "";

/// `rich` come lo scrive il file: gli spazi come li mostra SVG, senza righe
/// vuote in testa e in coda, e quelle in mezzo uno spazio indivisibile. La
/// prima riga che resta scende quanto la prima di prima. Nessuna riga se non
/// c'è niente da leggere.
export function tidyRich(rich: Rich): Rich {
  const lines = rich.lines.map(tidyLine);
  let first = 0;
  let last = lines.length;
  while (first < last && blank(lines[first]!)) first++;
  while (last > first && blank(lines[last - 1]!)) last--;
  const kept = lines.slice(first, last).map((line) => (blank(line) ? { attrs: line.attrs, spans: [{ text: BLANK_LINE, attrs: null }] } : line));
  if (first > 0 && kept.length > 0) {
    const top = { ...kept[0]!.attrs } as Record<string, string>;
    const dy = rich.lines[0]!.attrs.dy;
    if (dy === undefined) delete top.dy;
    else top.dy = dy;
    kept[0] = { attrs: top, spans: kept[0]!.spans };
  }
  return { ...rich, lines: kept };
}

/// Vero se `a` e `b` scrivono lo stesso testo.
export function sameRich(a: Rich, b: Rich): boolean {
  return (
    sameAttrs(a.attrs, b.attrs) &&
    a.lines.length === b.lines.length &&
    a.lines.every((line, i) => {
      const other = b.lines[i]!;
      const p = canonicalSpans(line.spans);
      const q = canonicalSpans(other.spans);
      return sameAttrs(line.attrs, other.attrs) && p.length === q.length && p.every((span, k) => span.text === q[k]!.text && sameAttrs(span.attrs, q[k]!.attrs));
    })
  );
}

/// Come scrivere `after` al posto di `before`, il testo che c'era: niente,
/// le righe con l'operazione `text` se gli attributi del testo e delle
/// righe restano quelli che lei darebbe, o il testo intero. Le righe di un
/// testo in area dicono anche come continua ciascuna il suo paragrafo, se
/// cambia: `joins`, il [`JOIN`] di ogni riga.
export type RichChange =
  | { readonly kind: "none" }
  | { readonly kind: "lines"; readonly lines: readonly TextLine[]; readonly joins?: readonly (string | null)[] }
  | { readonly kind: "elem"; readonly rich: Rich };

export function richChange(before: Rich, after: Rich): RichChange {
  if (sameRich(before, after)) return { kind: "none" };
  if (!sameAttrs(before.attrs, after.attrs) || before.lines.length === 0) return { kind: "elem", rich: after };
  const leading = newLeading(before);
  let joins = false;
  for (let i = 0; i < after.lines.length; i++) {
    const own = after.lines[i]!.attrs;
    const old = i < before.lines.length ? before.lines[i]!.attrs : null;
    const expected = old !== null ? withoutJoin(old) : freshAttrs(after.lines[i - 1]!, leading);
    if (!sameAttrs(expected, withoutJoin(own))) return { kind: "elem", rich: after };
    if ((own[JOIN] ?? null) !== (old?.[JOIN] ?? null)) joins = true;
  }
  const lines = after.lines.map(lineRuns);
  return joins ? { kind: "lines", lines, joins: after.lines.map((line) => line.attrs[JOIN] ?? null) } : { kind: "lines", lines };
}
