// Gli a capo di un testo in area (formato della scena, testo): le righe che
// FubDraw scrive perché un paragrafo stia nella larghezza del riquadro.
//
// - **Un paragrafo** sono le righe che lo continuano con `fub:join`: con
//   `space` l'a capo ha preso il posto di uno spazio, con `word` sta dentro
//   una parola. Le righe tornano il paragrafo senza perdere un carattere.
// - **Ogni riga prende tutte le parole che ci stanno**, e la dopo comincia
//   dalla prima che non ci sta. Si va a capo dopo una serie di spazi, di cui
//   l'ultimo non si scrive, o dopo un trattino che segue un carattere che
//   non è uno spazio.
// - **Una parola più larga del riquadro** si spezza fra due grafemi, dove ne
//   stanno di più, con almeno un grafema per riga: solo allora una riga va
//   oltre il riquadro, e il risultato lo dice.
// - **Gli spazi a fine riga** non contano nella larghezza.
// - **Una riga di un paragrafo** copia gli attributi della prima, senza
//   `id`, e scende dell'interlinea del testo.

import { formatNumber } from "../number";
import { letterSpacing, nonNegativeLength } from "../scene/values";
import { graphemes, type Font, type Measure } from "./measure";
import { canonicalSpans, lineText, newLeading, seenIn, type Attrs, type Caret, type Rich, type RichLine, type Span } from "./rich";

/// Come una riga continua il paragrafo della riga prima.
export type Join = "space" | "word";

/// L'attributo che lo scrive.
export const JOIN = "fub:join";

/// L'attributo della larghezza del riquadro, sul `text`.
export const WRAP = "fub:wrap";

/// I trattini dopo cui si va a capo.
const HYPHENS: ReadonlySet<string> = new Set(["-", "‐", "–", "—"]);

const isSpace = (grapheme: string): boolean => grapheme === " " || grapheme === "\t";

/// Il `fub:join` di `attrs`, se vale.
export function joinOf(attrs: Attrs): Join | null {
  const value = attrs[JOIN];
  return value === "space" || value === "word" ? value : null;
}

/// Una riga di un paragrafo andato a capo: i suoi tratti, e come continua
/// la riga prima; `null` per la prima.
export interface WrappedLine {
  readonly spans: readonly Span[];
  readonly join: Join | null;
}

/// Un paragrafo andato a capo.
export interface WrappedParagraph {
  readonly lines: readonly WrappedLine[];
  /// Vero se una riga va oltre il riquadro: un grafema da solo non ci sta.
  readonly overflow: boolean;
}

/// Dove si può andare a capo: prima del grafema `at`; con `space` il
/// grafema prima, uno spazio, non si scrive.
interface Break {
  readonly at: number;
  readonly join: Join;
}

/// `spans`, un paragrafo, nelle righe che stanno in `width`; ogni tratto si
/// misura con `measure` e col carattere che gli dà `fontOf`.
export function wrapSpans(spans: readonly Span[], width: number, fontOf: (span: Span) => Font, measure: Measure): WrappedParagraph {
  // I grafemi, col tratto e la posizione UTF-16 di ciascuno.
  const marks: string[] = [];
  const owner: number[] = [];
  const offsets: number[] = [];
  let offset = 0;
  spans.forEach((span, s) => {
    for (const grapheme of graphemes(span.text)) {
      marks.push(grapheme);
      owner.push(s);
      offsets.push(offset);
      offset += grapheme.length;
    }
  });
  const total = marks.length;
  offsets.push(offset);
  const fonts = spans.map(fontOf);

  /// La larghezza dei grafemi da `from` a `to`, senza gli spazi in fondo.
  const widthOf = (from: number, to: number): number => {
    let end = to;
    while (end > from && isSpace(marks[end - 1]!)) end--;
    let sum = 0;
    let start = from;
    while (start < end) {
      let stop = start;
      while (stop < end && owner[stop] === owner[start]) stop++;
      sum += measure(marks.slice(start, stop).join(""), fonts[owner[start]!]!);
      start = stop;
    }
    return sum;
  };

  // Dove si può andare a capo, in ordine.
  const breaks: Break[] = [];
  let seen = false;
  for (let i = 1; i < total; i++) {
    const before = marks[i - 1]!;
    const here = marks[i]!;
    if (!isSpace(before)) seen = true;
    if (isSpace(here)) continue;
    if (isSpace(before) && seen) breaks.push({ at: i, join: "space" });
    else if (HYPHENS.has(before) && i >= 2 && !isSpace(marks[i - 2]!)) breaks.push({ at: i, join: "word" });
  }

  /// I tratti dei grafemi da `from` a `to`.
  const slice = (from: number, to: number): Span[] => {
    const out: Span[] = [];
    const a = offsets[from]!;
    const b = offsets[to]!;
    let at = 0;
    for (const span of spans) {
      const end = at + span.text.length;
      const lo = Math.max(a, at);
      const hi = Math.min(b, end);
      if (lo < hi) out.push({ text: span.text.slice(lo - at, hi - at), attrs: span.attrs });
      at = end;
    }
    return canonicalSpans(out);
  };

  const lines: WrappedLine[] = [];
  let overflow = false;
  let start = 0;
  let join: Join | null = null;
  /// L'ultimo a capo dopo cui la riga di adesso ci sta ancora.
  let fit: Break | null = null;
  const emit = (end: number, next: Join, from: number): void => {
    lines.push({ spans: slice(start, end), join });
    join = next;
    start = from;
    fit = null;
  };
  let k = 0;
  for (;;) {
    // Il prossimo a capo possibile dopo l'inizio della riga, e dove la riga
    // finirebbe andando a capo lì.
    while (k < breaks.length && breaks[k]!.at <= start) k++;
    const next = breaks[k];
    const at = next?.at ?? total;
    const end = next?.join === "space" ? at - 1 : at;
    if (widthOf(start, end) <= width) {
      if (next === undefined) break;
      fit = next;
      k++;
      continue;
    }
    if (fit !== null) {
      const last: Break = fit;
      emit(last.join === "space" ? last.at - 1 : last.at, last.join, last.at);
      continue;
    }
    // Una parola sola che non ci sta: i grafemi che ci stanno, almeno uno
    // che non sia uno spazio.
    let content = end;
    while (content > start && isSpace(marks[content - 1]!)) content--;
    let first = start;
    while (isSpace(marks[first]!)) first++;
    let lo = first - start + 1;
    let hi = content - start;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (widthOf(start, start + mid) <= width) lo = mid;
      else hi = mid - 1;
    }
    if (start + lo < content) {
      if (widthOf(start, first + 1) > width) overflow = true;
      emit(start + lo, "word", start + lo);
      continue;
    }
    // Un grafema solo, più largo del riquadro: la riga va oltre, e finisce
    // dove finisce la parola.
    overflow = true;
    if (next === undefined) break;
    emit(end, next.join, next.at);
  }
  lines.push({ spans: slice(start, total), join });
  return { lines, overflow };
}

/// Il carattere con cui si vede il tratto `span` della riga `line` di
/// `rich`.
export function fontIn(rich: Rich, line: RichLine, span: Span | null): Font {
  const seen = (name: string): string | undefined => seenIn(rich, line, span, name);
  const size = seen("font-size");
  const spacing = seen("letter-spacing");
  return {
    family: seen("font-family") ?? "sans-serif",
    size: (size === undefined ? null : nonNegativeLength(size)) ?? 16,
    weight: seen("font-weight") ?? "normal",
    style: seen("font-style") ?? "normal",
    spacing: (spacing === undefined ? null : letterSpacing(spacing)) ?? 0,
  };
}

/// Gli attributi di `attrs` senza `fub:join`.
function withoutJoin(attrs: Attrs): Attrs {
  if (attrs[JOIN] === undefined) return attrs;
  const out: Record<string, string> = { ...attrs };
  delete out[JOIN];
  return out;
}

/// I paragrafi di `rich`, ciascuno una riga: le righe che continuano la
/// riga prima con `fub:join` le si uniscono, con uno spazio dove l'a capo ne
/// ha preso il posto. Una riga è un paragrafo con gli attributi della sua
/// prima riga.
export function unwrap(rich: Rich): Rich {
  const lines: RichLine[] = [];
  rich.lines.forEach((line, i) => {
    const join = i === 0 ? null : joinOf(line.attrs);
    const last = lines[lines.length - 1];
    if (join === null || last === undefined) {
      lines.push({ attrs: withoutJoin(line.attrs), spans: line.spans });
      return;
    }
    // Lo spazio tolto ha lo stile della fine della riga prima.
    const space: Span[] = join === "space" ? [{ text: " ", attrs: last.spans[last.spans.length - 1]?.attrs ?? null }] : [];
    lines[lines.length - 1] = { attrs: last.attrs, spans: canonicalSpans([...last.spans, ...space, ...line.spans]) };
  });
  return { ...rich, lines };
}

/// Un testo andato a capo.
export interface Wrapped {
  readonly rich: Rich;
  readonly overflow: boolean;
}

/// `paragraphs`, un paragrafo per riga, andati a capo in `width`: ogni riga
/// di un paragrafo dopo la prima copia gli attributi del paragrafo senza
/// `id` e scende di `leading`, con il suo `fub:join`.
export function wrapParagraphs(paragraphs: Rich, width: number, measure: Measure, leading: string): Wrapped {
  const lines: RichLine[] = [];
  let overflow = false;
  for (const paragraph of paragraphs.lines) {
    const wrapped = wrapSpans(paragraph.spans, width, (span) => fontIn(paragraphs, paragraph, span), measure);
    overflow ||= wrapped.overflow;
    const base = withoutJoin(paragraph.attrs);
    for (const line of wrapped.lines) {
      if (line.join === null) {
        lines.push({ attrs: base, spans: line.spans });
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const [name, value] of Object.entries(base)) if (name !== "id" && name !== "dy") attrs[name] = value;
      attrs.dy = leading;
      attrs[JOIN] = line.join;
      lines.push({ attrs, spans: line.spans });
    }
  }
  return { rich: { ...paragraphs, lines }, overflow };
}

/// Un testo in area andato di nuovo a capo, e dove va un punto di prima.
export interface Reflowed extends Wrapped {
  caret(at: Caret): Caret;
}

/// Le posizioni di un punto in un paragrafo: il paragrafo, e le unità UTF-16
/// prima del punto nel paragrafo.
interface Place {
  readonly paragraph: number;
  readonly offset: number;
}

/// Per ogni riga di `rich`: il paragrafo, e dove comincia nel paragrafo.
function placesOf(rich: Rich): Place[] {
  const out: Place[] = [];
  let paragraph = -1;
  let offset = 0;
  rich.lines.forEach((line, i) => {
    const join = i === 0 ? null : joinOf(line.attrs);
    if (join === null) {
      paragraph++;
      offset = 0;
    } else {
      offset += lineText(rich.lines[i - 1]!).length + (join === "space" ? 1 : 0);
    }
    out.push({ paragraph, offset });
  });
  return out;
}

/// `rich`, un testo in area, di nuovo a capo in `width`, coi suoi
/// paragrafi e la sua interlinea; e il punto di dopo per ogni punto di
/// prima.
export function reflow(rich: Rich, width: number, measure: Measure): Reflowed {
  const leading = newLeading(rich);
  const wrapped = wrapParagraphs(unwrap(rich), width, measure, leading);
  const before = placesOf(rich);
  const after = placesOf(wrapped.rich);
  return {
    ...wrapped,
    caret(at: Caret): Caret {
      const from = before[at.line];
      if (from === undefined) return at;
      const target = from.offset + at.offset;
      // L'ultima riga del paragrafo che comincia prima del punto; un punto
      // dopo lo spazio tolto è all'inizio della riga dopo.
      let found = at;
      for (let i = 0; i < after.length; i++) {
        const place = after[i]!;
        if (place.paragraph !== from.paragraph || place.offset > target) continue;
        found = { line: i, offset: Math.min(target - place.offset, lineText(wrapped.rich.lines[i]!).length) };
      }
      return found;
    },
  };
}

/// La larghezza di un riquadro, come la scrive il file.
export const wrapValue = (width: number): string => formatNumber(width, 2);
