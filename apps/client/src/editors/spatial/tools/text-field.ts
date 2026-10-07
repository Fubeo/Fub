// Il campo dove si scrive un testo sul posto (livello Standard): le righe e
// i pezzi del testo come si vedranno, e ciò che si scrive, si cancella e si
// formatta.
//
// - **Un campo modificabile, non un'area di testo**: un `div` con
//   `contenteditable`, un blocco per riga e un elemento per pezzo, ciascuno
//   col suo carattere, il suo corpo, il suo colore e le sue linee. Il campo
//   sta sopra il testo, che resta nascosto, e le righe scendono quanto i
//   loro `dy`: ogni linea di base cade dove il file la mette.
// - **Il campo scrive nel modello, e il modello nel DOM** (`rich.ts`): ciò
//   che si sa fare da un `beforeinput` — scrivere, andare a capo, incollare,
//   cancellare, annullare, formattare — cambia il modello, e il campo si
//   ridisegna col cursore al suo posto. Ciò che si compone con un metodo
//   d'immissione, come un accento composto o il giapponese, lo fa il
//   browser, e il campo lo rilegge quando la composizione finisce.
// - **Incollare incolla il testo**, con lo stile di dove arriva.
// - **Annulla e ripeti sono del campo**, mentre si scrive: le battute di
//   seguito sono un passo solo. Chiuso il campo, tutto ciò che si è fatto
//   nel testo è un passo solo del disegno.
// - **Grassetto, corsivo, sottolineato e barrato**, coi tasti dei programmi
//   di scrittura, valgono per ciò che è scelto o, senza scelta, per ciò che
//   si scriverà lì; il campo dice com'è adesso. Così il colore e il corpo
//   che arrivano dalla barra mentre si scrive.
// - **Un testo in area va a capo da sé** (formato della scena, testo): a
//   ogni cambio il campo rifà gli a capo del riquadro con le misure del
//   browser (`wrap.ts`), come il file li scriverà, e il cursore li segue.
//   Cancellare all'inizio di una riga che continua una parola cancella il
//   carattere prima. Un testo su tracciato ha una riga sola: Invio non va a
//   capo, e ciò che si incolla sta sulla riga.

import type { Lifetime } from "../../../ui/lifetime";
import { length, letterSpacing, nonNegativeLength, trim } from "../scene/values";
import { t, type DrawKey } from "../strings";
import type { Measure } from "./measure";
import { customColor } from "./palette";
import {
  compareCarets,
  JOIN,
  emphasisIn,
  emphasize,
  endOf,
  freshAttrs,
  lineText,
  newLeading,
  ordered,
  ownLines,
  replaceRange,
  restyleWhole,
  sameRich,
  seenIn,
  setInRange,
  sizeIn,
  styleAt,
  type Attrs,
  type Caret,
  type Emphasis,
  type Rich,
  type Span,
} from "./rich";
import { LINE_SPACING } from "./text";
import { reflow } from "./wrap";

/// Ciò che il campo chiede all'editor.
export interface TextFieldOptions {
  /// Il testo è cambiato: l'editor rimette il campo al suo posto.
  onChange(): void;
  /// Esc, Tab o Ctrl+Invio: il testo è finito.
  onFinish(): void;
  /// Dice `text` a chi usa uno screen reader.
  announce(text: string): void;
}

/// Le misure del campo disegnato, in pixel dello schermo.
export interface FieldLayout {
  readonly width: number;
  readonly height: number;
  /// Dalla cima del campo alla linea di base della prima riga.
  readonly baseline: number;
  /// Dal bordo sinistro del campo a quello del riquadro di un testo in
  /// area: lo spazio per il cursore, dalla parte dove le righe finiscono.
  readonly inset: number;
}

/// Come va a capo il testo del campo: con Invio soltanto (`lines`); anche da
/// sé, nel riquadro largo `width` unità del testo, misurando con `measure`
/// (`area`); o mai, su una riga sola (`line`).
export type FieldForm =
  | { readonly kind: "lines" }
  | { readonly kind: "area"; readonly width: number; readonly measure: Measure }
  | { readonly kind: "line" };

/// Il campo di un testo che va a capo solo con Invio.
export const LINES_FORM: FieldForm = { kind: "lines" };

/// La linea di base sotto la metà della riga, in volte il corpo, di un
/// carattere scritto come `font-style`, `font-weight` e `font-family`.
export type BaselineOf = (style: string, weight: string, family: string) => number;

export interface TextField {
  readonly element: HTMLElement;
  /// Il testo di adesso.
  readonly rich: Rich;
  /// Come va a capo il testo che si apre dopo.
  form(next: FieldForm): void;
  /// Apre il campo su `rich`, col cursore alla fine.
  open(rich: Rich): void;
  /// Svuota il campo.
  close(): void;
  /// Disegna il campo a `scale` pixel per unità del testo, e lo misura.
  layout(scale: number, baselineOf: BaselineOf): FieldLayout;
  /// Accende o spegne `which` su ciò che è scelto, o su ciò che si scriverà.
  emphasize(which: Emphasis): void;
  /// Dà `value` a `name`, uno degli attributi che si ereditano, su ciò che è
  /// scelto o che si scriverà.
  restyle(name: string, value: string): void;
  /// Dà `value` a `name` su ciò che è scelto o, senza scelta, sul testo
  /// intero: com'è un testo nuovo che la barra cambia.
  restyleWhole(name: string, value: string): void;
  /// Il cursore alla fine del testo.
  toEnd(): void;
}

/// Ciò che si scriverà al cursore, cambiato prima di scriverlo.
type Change = { readonly emphasis: Emphasis; readonly on: boolean } | { readonly name: string; readonly value: string };

interface Pending {
  /// Dove si scriverà: col cursore altrove non vale più.
  readonly at: Caret;
  /// Gli attributi del pezzo da cui si parte.
  readonly base: Attrs | null;
  readonly changes: readonly Change[];
}

interface Snapshot {
  readonly rich: Rich;
  readonly anchor: Caret;
  readonly focus: Caret;
}

/// I nomi delle enfasi, come si dicono.
const EMPHASIS_NAMES: Readonly<Record<Emphasis, DrawKey>> = {
  bold: "draw.text.bold",
  italic: "draw.text.italic",
  underline: "draw.text.underline",
  strike: "draw.text.strike",
};

/// I passi di annulla che il campo ricorda.
const HISTORY = 200;

/// Lo spazio per il cursore dopo l'ultimo carattere.
const CARET_PX = 2;

/// La larghezza di un carattere, in volte il corpo, dove il browser non
/// misura.
const CHAR_EM = 0.6;

/// La linea di base sotto la metà della riga di Inter, dove il browser non
/// misura.
const BASELINE_EM = 0.363;

/// Il colore di un testo che non ne scrive uno che il campo sa mostrare.
const INK = "#000000";

/// Gli a capo di ciò che si scrive in un campo di una riga sola.
const BREAKS = /\r\n|[\r\n\u2028\u2029]/g;

const LINE_CLASS = "draw-text-line";
const PIECE_CLASS = "draw-text-piece";

/// Un pezzo di testo come lo divide `Intl.Segmenter`, che la libreria di
/// riferimento dei tipi non ha ancora.
interface Segment {
  readonly segment: string;
  readonly index: number;
  readonly isWordLike?: boolean;
}
type Segmenter = { segment(text: string): Iterable<Segment> };
const SEGMENTER = (Intl as unknown as { Segmenter?: new (locale: undefined, options: { granularity: string }) => Segmenter }).Segmenter;

/// Chi divide una riga in caratteri o in parole; `null` dove il browser non
/// sa.
const segmenters = new Map<"grapheme" | "word", Segmenter | null>();
function segmenter(granularity: "grapheme" | "word"): Segmenter | null {
  if (!segmenters.has(granularity)) segmenters.set(granularity, SEGMENTER === undefined ? null : new SEGMENTER(undefined, { granularity }));
  return segmenters.get(granularity)!;
}

/// Dove comincia il carattere, o la parola, prima di `offset` in `text`.
function stepBack(text: string, offset: number, unit: "grapheme" | "word"): number {
  const split = segmenter(unit);
  if (split === null) {
    if (unit === "grapheme") return Math.max(0, offset - (offset >= 2 && /[\udc00-\udfff]/.test(text[offset - 1]!) ? 2 : 1));
    let at = offset;
    while (at > 0 && /\s/.test(text[at - 1]!)) at--;
    while (at > 0 && !/\s/.test(text[at - 1]!)) at--;
    return at;
  }
  let found = 0;
  let word = false;
  for (const part of split.segment(text)) {
    if (part.index >= offset) break;
    if (unit === "grapheme" || part.isWordLike === true) found = part.index;
    word = true;
  }
  return word ? found : 0;
}

/// Dove finisce il carattere, o la parola, dopo `offset` in `text`.
function stepForward(text: string, offset: number, unit: "grapheme" | "word"): number {
  const split = segmenter(unit);
  if (split === null) {
    if (unit === "grapheme") return Math.min(text.length, offset + (/[\ud800-\udbff]/.test(text[offset] ?? "") ? 2 : 1));
    let at = offset;
    while (at < text.length && /\s/.test(text[at]!)) at++;
    while (at < text.length && !/\s/.test(text[at]!)) at++;
    return at;
  }
  for (const part of split.segment(text)) {
    const end = part.index + part.segment.length;
    if (end <= offset) continue;
    if (unit === "grapheme" || part.isWordLike === true) return end;
  }
  return text.length;
}

/// Lo stile CSS di `attrs`, scritto su `style` a `scale` pixel per unità.
/// Ciò che `attrs` non scrive si toglie, e il campo lo eredita.
function paintCss(style: CSSStyleDeclaration, attrs: Attrs | null, lines: ReadonlySet<string> | null, scale: number): void {
  const read = (name: string): string | undefined => attrs?.[name];
  const family = read("font-family");
  style.fontFamily = family === undefined ? "" : family;
  const size = read("font-size");
  const px = size === undefined ? null : nonNegativeLength(size);
  style.fontSize = px === null ? "" : `${px * scale}px`;
  const weight = read("font-weight");
  style.fontWeight = weight === undefined ? "" : trim(weight);
  const italic = read("font-style");
  style.fontStyle = italic === undefined ? "" : trim(italic);
  const spacing = read("letter-spacing");
  const gap = spacing === undefined ? null : letterSpacing(spacing);
  style.letterSpacing = gap === null ? "" : `${gap * scale}px`;
  const fill = read("fill");
  // Un colore che il campo non sa mostrare, come un gradiente, lascia quello
  // di chi lo contiene.
  style.color = fill === undefined ? "" : customColor(fill) ?? "";
  style.textDecorationLine = lines === null || lines.size === 0 ? "" : [...lines].join(" ");
}

export function createTextField(life: Lifetime, options: TextFieldOptions): TextField {
  const element = document.createElement("div");
  element.className = "draw-text-input";
  element.contentEditable = "true";
  element.spellcheck = true;
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-multiline", "true");
  element.setAttribute("autocapitalize", "sentences");
  element.translate = false;
  // Ogni parte di una riga è alta il suo corpo per l'interlinea, centrata
  // sul suo carattere: la riga è alta quanto la parte più grande.
  element.style.lineHeight = String(LINE_SPACING);

  const blank: Rich = { attrs: {}, inherited: {}, lines: [{ attrs: {}, spans: [] }] };
  let rich: Rich = blank;
  /// Gli attributi di ogni riga e di ogni pezzo disegnati, per rileggerli.
  const lineAttrs = new WeakMap<Element, Attrs>();
  const pieceAttrs = new WeakMap<Element, Attrs>();
  let scale = 1;
  let composing = false;
  let undos: Snapshot[] = [];
  let redos: Snapshot[] = [];
  /// Dove è finita l'ultima battuta: la prossima lì continua lo stesso passo.
  let typed: Caret | null = null;
  let pending: Pending | null = null;
  let shape: FieldForm = LINES_FORM;

  /// `next`, con la scelta da `anchor` a `focus`, come lo mostra il campo:
  /// un testo in area di nuovo a capo nel suo riquadro, la scelta con lui.
  function flowed(next: Rich, anchor: Caret, focus: Caret): Snapshot {
    if (shape.kind !== "area") return { rich: next, anchor, focus };
    const made = reflow(next, shape.width, shape.measure);
    return { rich: made.rich, anchor: made.caret(anchor), focus: made.caret(focus) };
  }

  // --- Disegnare ----------------------------------------------------------------

  const lineEls = (): HTMLElement[] => [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(LINE_CLASS));

  function render(): void {
    const made = rich.lines.map((line) => {
      const row = document.createElement("div");
      row.className = LINE_CLASS;
      lineAttrs.set(row, line.attrs);
      for (const span of line.spans) {
        if (span.attrs === null) {
          row.append(document.createTextNode(span.text));
          continue;
        }
        const piece = document.createElement("span");
        piece.className = PIECE_CLASS;
        piece.textContent = span.text;
        pieceAttrs.set(piece, span.attrs);
        row.append(piece);
      }
      // Una riga vuota ha la sua altezza, e il cursore ci sta.
      if (lineText(line) === "") row.append(document.createElement("br"));
      return row;
    });
    element.replaceChildren(...made);
    paint();
  }

  /// Ciò che il testo vede, sul campo intero.
  const textSeen = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(rich.inherited)) out[name] = value;
    for (const [name, value] of Object.entries(rich.attrs)) out[name] = value;
    return out;
  };

  /// Lo stile del campo, delle righe e dei pezzi, a `scale`.
  function paint(): void {
    const seen = textSeen();
    paintCss(element.style, seen, ownLines(rich.attrs), scale);
    if (element.style.color === "") element.style.color = INK;
    const rows = lineEls();
    rows.forEach((row, i) => {
      const line = rich.lines[i];
      if (line === undefined) return;
      paintCss(row.style, line.attrs, ownLines(line.attrs), scale);
      const anchor = trim(line.attrs["text-anchor"] ?? seen["text-anchor"] ?? "start");
      row.style.textAlign = anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";
      for (const piece of row.querySelectorAll<HTMLElement>(`.${PIECE_CLASS}`)) {
        const attrs = pieceAttrs.get(piece) ?? null;
        paintCss(piece.style, attrs, ownLines(attrs), scale);
      }
    });
  }

  function layout(next: number, baselineOf: BaselineOf): FieldLayout {
    scale = next;
    paint();
    const rows = lineEls();
    const family = getComputedStyle(element).fontFamily;
    let height = 0;
    let baseline = 0;
    let longest = 0;
    /// L'altezza della riga prima, e dalla sua cima alla sua linea di base.
    let before: { box: number; drop: number } | null = null;
    rich.lines.forEach((line, i) => {
      const own = sizeIn(rich, line, null) * scale;
      const tallest = Math.max(own, ...line.spans.map((span) => sizeIn(rich, line, span) * scale));
      const box = tallest * LINE_SPACING;
      const b = baselineOf(trim(seenIn(rich, line, null, "font-style") ?? "normal"), trim(seenIn(rich, line, null, "font-weight") ?? "normal"), seenIn(rich, line, null, "font-family") || family);
      // Dalla cima della riga alla sua linea di base, che la parte più grande
      // tiene più in basso.
      const drop = box / 2 + (Number.isFinite(b) ? b : BASELINE_EM) * tallest;
      const row = rows[i];
      let margin = 0;
      // La linea di base scende di `dy` da quella della riga prima.
      if (before !== null) {
        const dy = (line.attrs.dy === undefined ? null : length(line.attrs.dy)) ?? 0;
        margin = dy * scale - before.box + before.drop - drop;
      } else {
        baseline = drop;
      }
      if (row !== undefined) row.style.marginTop = i === 0 ? "" : `${margin}px`;
      height += (i === 0 ? 0 : margin) + box;
      before = { box, drop };
      longest = Math.max(longest, [...lineText(line)].length * CHAR_EM * tallest);
    });
    element.style.height = `${height}px`;
    let inset = 0;
    let width: number;
    if (shape.kind === "area") {
      // Il riquadro è largo quanto quello del testo; il cursore ha il suo
      // spazio fuori, dalla parte dove le righe finiscono.
      const box = shape.width * scale;
      const anchor = trim(textSeen()["text-anchor"] ?? "start");
      inset = anchor === "end" ? CARET_PX : anchor === "middle" ? CARET_PX / 2 : 0;
      element.style.width = `${box}px`;
      element.style.paddingLeft = `${inset}px`;
      element.style.paddingRight = `${CARET_PX - inset}px`;
      width = box + CARET_PX;
    } else {
      element.style.paddingLeft = "";
      element.style.paddingRight = "";
      element.style.width = "";
      width = Math.ceil(element.offsetWidth || longest) + CARET_PX;
      element.style.width = `${width}px`;
    }
    element.scrollLeft = 0;
    element.scrollTop = 0;
    return { width, height, baseline, inset };
  }

  // --- Leggere il DOM -----------------------------------------------------------

  /// Il testo come lo mostra il DOM, dopo che il browser l'ha cambiato da
  /// sé: le righe che conosce coi loro attributi, i pezzi coi loro.
  function readDom(): Rich {
    const lines: Array<{ attrs: Attrs; spans: Span[] }> = [];
    const leading = newLeading(rich);
    const open = (attrs: Attrs | undefined): void => {
      const previous = lines[lines.length - 1];
      lines.push({ attrs: attrs ?? (previous === undefined ? rich.lines[0]?.attrs ?? {} : freshAttrs(previous, leading)), spans: [] });
    };
    const add = (text: string, attrs: Attrs | null): void => {
      const parts = text.split("\n");
      parts.forEach((part, i) => {
        if (i > 0 || lines.length === 0) open(undefined);
        if (part !== "") lines[lines.length - 1]!.spans.push({ text: part, attrs });
      });
    };
    const visit = (node: Node, attrs: Attrs | null, top: boolean): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        add(node.nodeValue ?? "", attrs);
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === "BR") return;
      const block = top || node.tagName === "DIV" || node.tagName === "P";
      if (block) open(lineAttrs.get(node));
      const inner = pieceAttrs.get(node) ?? attrs;
      for (const child of node.childNodes) visit(child, inner, false);
    };
    for (const child of element.childNodes) {
      if (child instanceof HTMLElement && child.tagName !== "BR") visit(child, null, true);
      else visit(child, null, false);
    }
    if (lines.length === 0) open(undefined);
    return { attrs: rich.attrs, inherited: rich.inherited, lines: lines.map((line) => ({ attrs: line.attrs, spans: line.spans })) };
  }

  // --- La scelta ----------------------------------------------------------------

  /// Il punto del testo di un punto del DOM; `null` se non è nel campo.
  function caretOf(node: Node, offset: number): Caret | null {
    if (!element.contains(node)) return null;
    const rows = lineEls();
    if (node === element) {
      if (offset >= rows.length) return endOf(rich);
      return { line: offset, offset: 0 };
    }
    let row: Node | null = node;
    while (row !== null && !(row instanceof HTMLElement && row.parentNode === element && row.classList.contains(LINE_CLASS))) row = row.parentNode;
    if (row === null) return null;
    const line = rows.indexOf(row as HTMLElement);
    const range = document.createRange();
    range.setStart(row, 0);
    range.setEnd(node, offset);
    return { line, offset: range.toString().length };
  }

  /// Il punto del DOM di `caret`: alla fine del tratto prima, come lo stile
  /// di ciò che si scrive.
  function pointOf(caret: Caret): [Node, number] {
    const rows = lineEls();
    const row = rows[Math.min(caret.line, rows.length - 1)];
    if (row === undefined) return [element, 0];
    let left = caret.offset;
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
      const size = node.data.length;
      if (left <= size && (left > 0 || last === null)) return [node, left];
      left -= size;
      last = node;
    }
    return last === null ? [row, 0] : [last, last.data.length];
  }

  /// Ciò che è scelto nel campo, dall'ancora al fuoco; la fine se la scelta
  /// è altrove.
  function selected(): { anchor: Caret; focus: Caret } {
    const selection = document.getSelection();
    if (selection !== null && selection.anchorNode !== null && selection.focusNode !== null) {
      const anchor = caretOf(selection.anchorNode, selection.anchorOffset);
      const focus = caretOf(selection.focusNode, selection.focusOffset);
      if (anchor !== null && focus !== null) return { anchor, focus };
    }
    const end = endOf(rich);
    return { anchor: end, focus: end };
  }

  function select(anchor: Caret, focus: Caret = anchor): void {
    const selection = document.getSelection();
    if (selection === null) return;
    const [a, ao] = pointOf(anchor);
    const [f, fo] = pointOf(focus);
    try {
      selection.setBaseAndExtent(a, ao, f, fo);
    } catch {
      // Un punto che il browser non accetta lascia la scelta com'era.
    }
  }

  // --- Cambiare -----------------------------------------------------------------

  const snapshot = (): Snapshot => {
    const { anchor, focus } = selected();
    return { rich, anchor, focus };
  };

  const remember = (): void => {
    undos.push(snapshot());
    if (undos.length > HISTORY) undos = undos.slice(undos.length - HISTORY);
    redos = [];
  };

  /// Il testo diventa `next`, con la scelta da `anchor` a `focus`; torna
  /// com'è e dov'è la scelta, dopo gli a capo di un testo in area.
  function show(next: Rich, anchor: Caret, focus: Caret = anchor): Snapshot {
    const shown = flowed(next, anchor, focus);
    rich = shown.rich;
    render();
    select(shown.anchor, shown.focus);
    options.onChange();
    return shown;
  }

  /// Il cambio di un passo nuovo.
  function change(next: Rich, anchor: Caret, focus: Caret = anchor): void {
    remember();
    typed = null;
    pending = null;
    show(next, anchor, focus);
  }

  const pendingAt = (at: Caret): Pending | null => (pending !== null && compareCarets(pending.at, at) === 0 ? pending : null);

  /// `rich` con `change` sui caratteri da `from` a `to`.
  function applied(target: Rich, from: Caret, to: Caret, step: Change): Rich {
    return "emphasis" in step ? emphasize(target, from, to, step.emphasis, step.on) : setInRange(target, from, to, step.name, step.value);
  }

  /// Scrive `text` fra `from` e `to`, con lo stile che vi si scriverebbe;
  /// `typing` se è una battuta, che continua il passo di quella prima.
  function insert(raw: string, from: Caret, to: Caret, typing: boolean): void {
    const text = shape.kind === "line" ? raw.replace(BREAKS, " ") : raw;
    const [start, end] = ordered(from, to);
    const collapsed = compareCarets(start, end) === 0;
    const waiting = collapsed ? pendingAt(start) : null;
    // Al posto di ciò che è scelto si scrive col suo stile.
    const base = waiting !== null ? waiting.base : collapsed ? styleAt(rich, start) : styleAt(rich, { line: start.line, offset: start.offset + 1 });
    const made = replaceRange(rich, start, end, text, base);
    let next = made.rich;
    for (const step of waiting?.changes ?? []) next = applied(next, start, made.caret, step);
    const continues = typing && collapsed && typed !== null && compareCarets(typed, start) === 0;
    if (!continues) remember();
    else redos = [];
    pending = null;
    // Dopo un a capo si continua con lo stile della fine della riga.
    const after = text.endsWith("\n") ? { base: waiting !== null ? waiting.base : styleAt(rich, start), changes: waiting?.changes ?? [] } : null;
    // Si continua dove il cursore è finito, anche su un'altra riga di un
    // testo in area.
    const shown = show(next, made.caret);
    if (after !== null) pending = { at: shown.focus, ...after };
    typed = typing && !text.includes("\n") ? shown.focus : null;
  }

  function remove(from: Caret, to: Caret): void {
    const [start, end] = ordered(from, to);
    if (compareCarets(start, end) === 0) return;
    const made = replaceRange(rich, start, end, "", null);
    change(made.rich, made.caret);
  }

  /// Ciò che cancella `type` da `from`, `to` se la scelta non è vuota.
  function deletion(type: string, from: Caret, to: Caret): [Caret, Caret] | null {
    if (compareCarets(from, to) !== 0) return ordered(from, to);
    const text = lineText(rich.lines[from.line]!);
    const previousEnd = (): Caret => (from.line === 0 ? from : { line: from.line - 1, offset: lineText(rich.lines[from.line - 1]!).length });
    const nextStart = (): Caret => (from.line === rich.lines.length - 1 ? from : { line: from.line + 1, offset: 0 });
    // Fra due righe che spezzano una parola non c'è niente da cancellare: si
    // cancella il carattere, o la parola, di là.
    const unit = type.includes("Word") ? "word" : "grapheme";
    const backward = type === "deleteContentBackward" || type === "deleteWordBackward";
    const forward = type === "deleteContentForward" || type === "deleteWordForward";
    if (backward && from.offset === 0 && from.line > 0 && rich.lines[from.line]!.attrs[JOIN] === "word") {
      const end = previousEnd();
      return [{ line: end.line, offset: stepBack(lineText(rich.lines[end.line]!), end.offset, unit) }, end];
    }
    const next = rich.lines[from.line + 1];
    if (forward && from.offset === text.length && next?.attrs[JOIN] === "word") {
      return [nextStart(), { line: from.line + 1, offset: stepForward(lineText(next), 0, unit) }];
    }
    switch (type) {
      case "deleteContentBackward":
      case "deleteWordBackward":
        return from.offset === 0 ? [previousEnd(), from] : [{ line: from.line, offset: stepBack(text, from.offset, type === "deleteWordBackward" ? "word" : "grapheme") }, from];
      case "deleteContentForward":
      case "deleteWordForward":
        return from.offset === text.length ? [from, nextStart()] : [from, { line: from.line, offset: stepForward(text, from.offset, type === "deleteWordForward" ? "word" : "grapheme") }];
      case "deleteSoftLineBackward":
      case "deleteHardLineBackward":
        return from.offset === 0 ? [previousEnd(), from] : [{ line: from.line, offset: 0 }, from];
      case "deleteSoftLineForward":
      case "deleteHardLineForward":
        return from.offset === text.length ? [from, nextStart()] : [from, { line: from.line, offset: text.length }];
      case "deleteEntireSoftLine":
        return [{ line: from.line, offset: 0 }, { line: from.line, offset: text.length }];
      default:
        return null;
    }
  }

  function undo(): void {
    const last = undos.pop();
    if (last === undefined) return;
    redos.push(snapshot());
    typed = null;
    pending = null;
    show(last.rich, last.anchor, last.focus);
  }

  function redo(): void {
    const next = redos.pop();
    if (next === undefined) return;
    undos.push(snapshot());
    typed = null;
    pending = null;
    show(next.rich, next.anchor, next.focus);
  }

  /// Il testo con un carattere scritto al cursore `at` come vi si
  /// scriverebbe, per sapere com'è ciò che si scriverà.
  function probe(at: Caret): { rich: Rich; from: Caret; to: Caret; base: Attrs | null; changes: readonly Change[] } {
    const waiting = pendingAt(at);
    const base = waiting !== null ? waiting.base : styleAt(rich, at);
    const made = replaceRange(rich, at, at, "x", base);
    let next = made.rich;
    for (const step of waiting?.changes ?? []) next = applied(next, at, made.caret, step);
    return { rich: next, from: at, to: made.caret, base, changes: waiting?.changes ?? [] };
  }

  function emphasizeNow(which: Emphasis): void {
    const { anchor, focus } = selected();
    const [from, to] = ordered(anchor, focus);
    let on: boolean;
    if (compareCarets(from, to) === 0 || rich.lines.every((line) => lineText(line) === "")) {
      const now = probe(from);
      on = !emphasisIn(now.rich, now.from, now.to, which);
      pending = { at: from, base: now.base, changes: [...now.changes, { emphasis: which, on }] };
      typed = null;
    } else {
      on = !emphasisIn(rich, from, to, which);
      change(emphasize(rich, from, to, which, on), anchor, focus);
    }
    options.announce(t(on ? "draw.text.emphasis.on" : "draw.text.emphasis.off", { name: t(EMPHASIS_NAMES[which]) }));
  }

  function restyleNow(name: string, value: string): void {
    const { anchor, focus } = selected();
    const [from, to] = ordered(anchor, focus);
    if (compareCarets(from, to) === 0) {
      const now = probe(from);
      pending = { at: from, base: now.base, changes: [...now.changes, { name, value }] };
      typed = null;
      return;
    }
    change(setInRange(rich, from, to, name, value), anchor, focus);
  }

  function restyleWholeNow(name: string, value: string): void {
    const { anchor, focus } = selected();
    const [from, to] = ordered(anchor, focus);
    if (compareCarets(from, to) !== 0) {
      change(setInRange(rich, from, to, name, value), anchor, focus);
      return;
    }
    const next = restyleWhole(rich, name, value);
    if (sameRich(next, rich)) return;
    // Un campo ancora vuoto non ha niente da annullare.
    if (rich.lines.every((line) => line.spans.length === 0)) {
      rich = next;
      pending = null;
      paint();
      if (document.activeElement === element) select(anchor, focus);
      options.onChange();
      return;
    }
    change(next, anchor, focus);
  }

  // --- Gli eventi ---------------------------------------------------------------

  /// Il punto d'inizio e di fine di ciò che `event` cambia: quello che dice
  /// il browser, o la scelta.
  function targetOf(event: InputEvent): [Caret, Caret] {
    const ranges = typeof event.getTargetRanges === "function" ? event.getTargetRanges() : [];
    const range = ranges[0];
    if (range !== undefined) {
      const from = caretOf(range.startContainer, range.startOffset);
      const to = caretOf(range.endContainer, range.endOffset);
      if (from !== null && to !== null) return [from, to];
    }
    const { anchor, focus } = selected();
    return ordered(anchor, focus);
  }

  const plainOf = (event: InputEvent): string => event.data ?? event.dataTransfer?.getData("text/plain") ?? "";

  life.listen(element, "beforeinput", (event) => {
    if (event.isComposing || composing || !event.cancelable) return;
    const type = event.inputType;
    if (type === "historyUndo" || type === "historyRedo") {
      event.preventDefault();
      if (type === "historyUndo") undo();
      else redo();
      return;
    }
    if (type.startsWith("format")) {
      event.preventDefault();
      const which: Emphasis | null =
        type === "formatBold" ? "bold" : type === "formatItalic" ? "italic" : type === "formatUnderline" ? "underline" : type === "formatStrikeThrough" ? "strike" : null;
      if (which !== null) emphasizeNow(which);
      return;
    }
    const [from, to] = targetOf(event);
    if (type === "insertText" || type === "insertReplacementText") {
      event.preventDefault();
      const text = plainOf(event);
      insert(text, from, to, type === "insertText" && !/\s/.test(text));
      return;
    }
    if (type === "insertParagraph" || type === "insertLineBreak") {
      event.preventDefault();
      if (shape.kind !== "line") insert("\n", from, to, false);
      return;
    }
    if (type.startsWith("insertFrom")) {
      event.preventDefault();
      insert(plainOf(event), from, to, false);
      return;
    }
    if (type.startsWith("delete")) {
      const range = deletion(type, from, to) ?? (compareCarets(from, to) === 0 ? null : ([from, to] as [Caret, Caret]));
      if (range === null) return;
      event.preventDefault();
      remove(range[0], range[1]);
    }
  });

  // Il browser che cambia da sé, come una composizione o ciò che il campo
  // non conosce: il campo rilegge il testo, e lo ridisegna a composizione
  // finita.
  life.listen(element, "input", () => {
    const { anchor, focus } = selected();
    const next = readDom();
    if (!composing) remember();
    typed = null;
    pending = null;
    if (composing) {
      rich = next;
      options.onChange();
      return;
    }
    show(next, anchor, focus);
  });
  life.listen(element, "compositionstart", () => {
    composing = true;
    remember();
  });
  life.listen(element, "compositionend", () => {
    composing = false;
    const { anchor, focus } = selected();
    show(readDom(), anchor, focus);
  });
  // Incollare incolla il testo: anche dove il `beforeinput` non lo porta.
  life.listen(element, "paste", (event) => {
    const text = event.clipboardData?.getData("text/plain");
    if (text === undefined) return;
    event.preventDefault();
    const { anchor, focus } = selected();
    insert(text, anchor, focus, false);
  });
  life.listen(element, "keydown", (event) => {
    if (event.isComposing || composing) return;
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
    if (event.key === "Escape" || event.key === "Tab" || (event.key === "Enter" && mod)) {
      event.preventDefault();
      options.onFinish();
      return;
    }
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "b" && !event.shiftKey) emphasizeNow("bold");
    else if (key === "i" && !event.shiftKey) emphasizeNow("italic");
    else if (key === "u" && !event.shiftKey) emphasizeNow("underline");
    else if (key === "x" && event.shiftKey) emphasizeNow("strike");
    else if (key === "z") (event.shiftKey ? redo : undo)();
    else if (key === "y" && !event.shiftKey) redo();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });

  return {
    element,
    get rich() {
      return rich;
    },
    form(next) {
      shape = next;
      element.setAttribute("aria-multiline", String(next.kind !== "line"));
    },
    open(next) {
      rich = next;
      undos = [];
      redos = [];
      typed = null;
      pending = null;
      composing = false;
      render();
    },
    close() {
      rich = blank;
      undos = [];
      redos = [];
      pending = null;
      element.replaceChildren();
    },
    layout,
    emphasize: emphasizeNow,
    restyle: restyleNow,
    restyleWhole: restyleWholeNow,
    toEnd: () => select(endOf(rich)),
  };
}
