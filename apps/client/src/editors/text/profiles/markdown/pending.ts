// La guida della Live (07): un segno aperto a mano, sulla riga del cursore,
// mette «in sospeso» il testo che lo segue, che prende subito lo stile che
// avrà, e dopo il cursore appare in grigio la chiusura che manca. La chiusura
// in grigio non è nel file: → o Tab la scrivono, Esc la spegne per quel segno,
// lo spazio chiude apice e pedice. Un segno rimasto aperto su un'altra riga
// prende l'ondulato. Tutto guarda una riga alla volta: quella del cursore per
// lo stato in sospeso, quelle in vista per l'ondulato.
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  Annotation, type EditorState, type Extension, type Line, Prec, type Range, StateEffect, StateField, type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { liveGuide } from "../../live-reveal";
import { frontmatterRange } from "./render";
import { liveStrings } from "./strings";

export type PendingKind = "strong" | "em" | "strike" | "sup" | "sub" | "code" | "math" | "link";

/// Un segno d'apertura senza chiusura, in colonne della riga.
export interface PendingMark {
  readonly kind: PendingKind;
  /// Il segno: da `from` a `to`.
  readonly from: number;
  readonly to: number;
  /// La chiusura che manca.
  readonly close: string;
  /// Soltanto per il link: dove finisce il testo e comincia `](`.
  readonly textTo?: number;
}

const PUNCTUATION = /[\p{P}\p{S}]/u;
const space = (c: string | undefined): boolean => c === undefined || /\s/.test(c);
const punctuation = (c: string | undefined): boolean => c !== undefined && PUNCTUATION.test(c);

/// Un segno aperto che aspetta la sua chiusura: `rem` caratteri da `from`.
interface Opener {
  readonly key: "*" | "_" | "~~" | "~" | "^";
  readonly from: number;
  rem: number;
}

function runLength(text: string, at: number, char: string): number {
  let end = at;
  while (text[end] === char) end++;
  return end - at;
}

/// La prossima corsa di esattamente `length` caratteri `char` da `from`.
function runAt(text: string, from: number, char: string, length: number): number {
  for (let at = text.indexOf(char, from); at >= 0; at = text.indexOf(char, at + 1)) {
    const run = runLength(text, at, char);
    if (run === length) return at;
    at += run - 1;
  }
  return -1;
}

/// La `$` che chiude una formula aperta prima di `from`, con la regola di
/// Pandoc: preceduta da un carattere che non è spazio, non seguita da una cifra.
function mathClose(text: string, from: number): number {
  for (let at = from; at < text.length; at++) {
    if (text[at] === "\\") { at++; continue; }
    if (text[at] === "$" && !space(text[at - 1]) && !/\d/.test(text[at + 1] ?? "")) return at;
  }
  return -1;
}

const CLOSE: Record<Opener["key"], string> = { "*": "*", "_": "_", "~~": "~~", "~": "~", "^": "^" };

function openerMarks(opener: Opener): PendingMark[] {
  const { key, from, rem } = opener;
  if (key === "~~") return [{ kind: "strike", from, to: from + 2, close: "~~" }];
  if (key === "~") return [{ kind: "sub", from, to: from + 1, close: "~" }];
  if (key === "^") return [{ kind: "sup", from, to: from + 1, close: "^" }];
  const close = CLOSE[key];
  if (rem === 1) return [{ kind: "em", from, to: from + 1, close }];
  if (rem === 2) return [{ kind: "strong", from, to: from + 2, close: close + close }];
  return [
    { kind: "strong", from, to: from + 2, close: close + close },
    { kind: "em", from: from + 2, to: from + 3, close },
  ];
}

/// I segni d'apertura senza chiusura della riga `text` prima della colonna
/// `column`: per `*` e `_` le regole di apertura di CommonMark, per `$`, `^` e
/// `~` quelle di Pandoc (dopo il segno niente spazio; apice e pedice senza
/// spazi dentro; una `$` seguita da una cifra è una valuta). Un segno col
/// backslash non conta, e dentro il codice in riga niente è un segno. Un
/// segno doppio appena scritto (`**|`) apre già: la lettera sta per venire.
export function pendingMarks(text: string, column: number): PendingMark[] {
  const stack: Opener[] = [];
  const found: PendingMark[] = [];
  /// Le parti già chiuse da saltare: da dove a dove.
  const jumps = new Map<number, number>();
  let limit = text.length;
  let at = 0;
  while (at < limit) {
    const jump = jumps.get(at);
    if (jump !== undefined) { at = jump; continue; }
    const c = text[at]!;
    if (c === "\\") { at += 2; continue; }
    if (/\s/.test(c)) {
      // Apice e pedice non hanno spazi dentro.
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index]!.key === "^" || stack[index]!.key === "~") stack.splice(index, 1);
      }
      at++;
      continue;
    }
    // Il testo di un apice o di un pedice è letterale, come per Lezer: niente
    // vi si apre, e il primo `^` o `~` lo chiude.
    const top = stack[stack.length - 1];
    if (top && (top.key === "^" || top.key === "~")) {
      if (c === top.key) stack.pop();
      at++;
      continue;
    }
    if (c === "`") {
      const length = runLength(text, at, "`");
      const close = runAt(text, at + length, "`", length);
      if (close >= 0) { at = close + length; continue; }
      if (at + length < column) found.push({ kind: "code", from: at, to: at + length, close: "`".repeat(length) });
      break;
    }
    if (c === "$") {
      if (text[at + 1] === "$") { at += 2; continue; }
      const next = text[at + 1];
      if (space(next) || /\d/.test(next!)) { at++; continue; }
      const close = mathClose(text, at + 1);
      if (close >= 0) { at = close + 1; continue; }
      if (at + 1 < column) found.push({ kind: "math", from: at, to: at + 1, close: "$" });
      break;
    }
    if (c === "[") {
      if (text[at + 1] === "[") {
        const end = text.indexOf("]]", at + 2);
        at = end < 0 ? at + 2 : end + 2;
        continue;
      }
      const middle = text.indexOf("](", at + 1);
      if (middle >= 0) {
        const end = text.indexOf(")", middle + 2);
        if (end >= 0) jumps.set(middle, end + 1);
        else if (middle + 2 <= column) {
          found.push({ kind: "link", from: at, to: at + 1, close: ")", textTo: middle });
          limit = middle;
        }
      }
      at++;
      continue;
    }
    if (c === "=") { at += runLength(text, at, "="); continue; }
    if (c === "*" || c === "_" || c === "~" || c === "^") {
      const length = runLength(text, at, c);
      const prev = text[at - 1];
      // Un segno doppio che finisce sul cursore, prima di niente: si sta
      // scrivendo, e la lettera viene dopo.
      const typing = length >= 2 && at + length === column && space(text[column]);
      const next = typing ? "a" : text[at + length];
      let key: Opener["key"] | null = null;
      let canOpen = false;
      let canClose = false;
      if (c === "^" || (c === "~" && length === 1)) {
        if (length === 1) {
          key = c === "^" ? "^" : "~";
          canOpen = !space(next);
          canClose = !space(prev);
        }
      } else if (c !== "~" || length === 2) {
        key = c === "~" ? "~~" : c;
        const left = !space(next) && (!punctuation(next) || space(prev) || punctuation(prev));
        const right = !space(prev) && (!punctuation(prev) || space(next) || punctuation(next));
        canOpen = c === "_" ? left && (!right || punctuation(prev)) : left;
        canClose = c === "_" ? right && (!left || punctuation(next)) : right;
      }
      if (key !== null) {
        let rem = key === "~~" || key === "~" || key === "^" ? 1 : length;
        if (canClose) {
          while (rem > 0) {
            let index = stack.length - 1;
            while (index >= 0 && stack[index]!.key !== key) index--;
            if (index < 0) break;
            stack.splice(index + 1);
            const opener = stack[index]!;
            const used = key === "*" || key === "_" ? (rem >= 2 && opener.rem >= 2 ? 2 : 1) : 1;
            opener.rem -= used;
            rem -= used;
            if (opener.rem <= 0) stack.splice(index, 1);
          }
        }
        if (canOpen && rem > 0) stack.push({ key, from: at, rem });
      }
      at += length;
      continue;
    }
    at++;
  }
  const marks = [...stack.filter((opener) => opener.from < column).flatMap(openerMarks), ...found];
  return marks.sort((a, b) => a.from - b.from);
}

// ── La cache ─────────────────────────────────────────────────────────────────

const CACHE_SIZE = 256;
const cache = new Map<string, readonly PendingMark[]>();

/// `pendingMarks` con una cache per testo di riga e colonna: il riconoscitore
/// gira una volta per riga finché la riga non cambia.
export function pendingOfLine(text: string, column: number): readonly PendingMark[] {
  const key = `${column}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const marks = pendingMarks(text, column);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, marks);
  return marks;
}

// ── Dove la guida tace ───────────────────────────────────────────────────────

const OPAQUE_BLOCKS = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock"]);
const OPAQUE_INLINE = new Set(["InlineCode", "URL", "Autolink", "HTMLTag", "Comment", "CodeText"]);

/// La riga è codice, HTML, un commento o il frontmatter.
function opaqueLine(state: EditorState, line: Line): boolean {
  const yaml = frontmatterRange(state.doc);
  if (yaml && line.from < yaml.to) return true;
  for (let node = syntaxTree(state).resolveInner(line.from, 1); node; node = node.parent!) {
    if (OPAQUE_BLOCKS.has(node.name)) return true;
    if (!node.parent) break;
  }
  return false;
}

/// Il segno a `pos` è davvero un segno aperto: l'albero non lo chiude già
/// su un'altra riga, e non sta in un indirizzo o in un tag.
function openAt(state: EditorState, pos: number): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent!) {
    if (OPAQUE_INLINE.has(node.name)) return false;
    // Anche dentro una corsa di segni già letti: in `***~b~***` l'ultimo `*`
    // chiude il corsivo, e non resta in sospeso.
    if (node.from <= pos && pos < node.to && node.name.endsWith("Mark")) return false;
    if (!node.parent) break;
  }
  return true;
}

// ── Lo stato della guida ─────────────────────────────────────────────────────

/// La chiusura che la guida ha appena scritto: Backspace subito dopo la toglie.
interface Written {
  readonly from: number;
  readonly to: number;
  /// Dove sta il cursore subito dopo: dopo la chiusura, o dopo lo spazio.
  readonly cursor: number;
}

/// Le transazioni della guida: la chiusura scritta, e il suo annullamento.
export const guideEvent = Annotation.define<"close" | "undo">();
const wrote = StateEffect.define<Written>();
const dismiss = StateEffect.define<readonly number[]>();

const written = StateField.define<Written | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(wrote)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

/// I segni per cui Esc ha spento la guida, portati attraverso le modifiche.
const dismissed = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let next = tr.docChanged ? value.map((pos) => tr.changes.mapPos(pos, 1)) : value;
    for (const effect of tr.effects) if (effect.is(dismiss)) next = [...next, ...effect.value];
    return next;
  },
});

/// La riga del cursore con i suoi segni in sospeso, in posizioni del
/// documento; `ghost` è la chiusura in grigio, se si vede.
export interface Guide {
  readonly head: number;
  readonly marks: readonly PendingMark[];
  readonly ghost: string | null;
}

/// I segni in sospeso attorno al cursore, o `null` dove la guida tace.
export function guideAt(state: EditorState): Guide | null {
  if (!state.facet(liveGuide) || state.readOnly) return null;
  const selection = state.selection;
  if (selection.ranges.length > 1 || !selection.main.empty) return null;
  const head = selection.main.head;
  const line = state.doc.lineAt(head);
  const column = head - line.from;
  const local = pendingOfLine(line.text, column);
  if (!local.length || opaqueLine(state, line)) return null;
  const off = state.field(dismissed, false) ?? [];
  const marks = local
    .map((mark) => ({
      ...mark,
      from: line.from + mark.from,
      to: line.from + mark.to,
      ...(mark.textTo === undefined ? {} : { textTo: line.from + mark.textTo }),
    }))
    .filter((mark) => openAt(state, mark.from) && !off.includes(mark.from));
  if (!marks.length) return null;
  // La chiusura in grigio va dove la si scriverebbe: a fine riga o prima di
  // uno spazio, non in mezzo a una parola.
  const ghost = space(line.text[column]) ? [...marks].reverse().map((mark) => mark.close).join("") : null;
  return { head, marks, ghost };
}

// ── I gesti ──────────────────────────────────────────────────────────────────

function closing(text: string, from: number, cursor: number, insert: string): TransactionSpec {
  return {
    changes: { from, insert },
    selection: { anchor: cursor },
    effects: wrote.of({ from, to: from + text.length, cursor }),
    annotations: [guideEvent.of("close"), isolateHistory.of("full")],
    userEvent: "input.complete",
    scrollIntoView: true,
  };
}

/// → e Tab sulla chiusura in grigio la scrivono.
function accept(view: EditorView): boolean {
  const guide = guideAt(view.state);
  if (!guide?.ghost) return false;
  const end = guide.head + guide.ghost.length;
  view.dispatch(closing(guide.ghost, guide.head, end, guide.ghost));
  return true;
}

/// Esc spegne la guida per i segni in sospeso.
function quiet(view: EditorView): boolean {
  const guide = guideAt(view.state);
  if (!guide) return false;
  view.dispatch({ effects: dismiss.of(guide.marks.map((mark) => mark.from)) });
  return true;
}

/// Backspace subito dopo una chiusura della guida la toglie, e il testo resta
/// com'era.
function unwrite(view: EditorView): boolean {
  const last = view.state.field(written, false);
  const selection = view.state.selection;
  if (!last || selection.ranges.length > 1 || !selection.main.empty || selection.main.head !== last.cursor) return false;
  view.dispatch({
    changes: { from: last.from, to: last.to },
    selection: { anchor: last.cursor - (last.to - last.from) },
    annotations: [guideEvent.of("undo"), isolateHistory.of("full")],
    userEvent: "delete.backward",
  });
  return true;
}

/// La decisione dello spazio, separata dalla view: con un apice o un pedice in
/// sospeso, lo spazio scrive prima la chiusura.
export function spaceClosing(state: EditorState): TransactionSpec | null {
  const guide = guideAt(state);
  const inner = guide?.marks[guide.marks.length - 1];
  if (!guide?.ghost || !inner || (inner.kind !== "sup" && inner.kind !== "sub")) return null;
  return closing(inner.close, guide.head, guide.head + inner.close.length + 1, `${inner.close} `);
}

const spaceCloses = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== " " || from !== to || view.compositionStarted) return false;
  const spec = spaceClosing(view.state);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
});

/// I segni che apice e pedice non portano dentro.
const NOT_IN_LEAF = new Set(["~", "^", "*", "`"]);
const LEAF_MARKS = new Set(["SuperscriptMark", "SubscriptMark", "StrikethroughMark"]);

/// La decisione di un segno scritto accanto a un apice o a un pedice, come
/// `spaceClosing`. In sospeso, un segno che non ci starebbe dentro prima lo
/// chiude: `x^2` e `~` danno `x^2^~`, e Backspace toglie la chiusura. Subito
/// dopo il segno d'apertura, `~` e `^` lo cambiano: `x^` e `~` danno `x~`.
export function leafTyping(state: EditorState, text: string): TransactionSpec | null {
  if (!NOT_IN_LEAF.has(text) || !state.facet(liveGuide) || state.readOnly) return null;
  const selection = state.selection;
  if (selection.ranges.length > 1 || !selection.main.empty) return null;
  const head = selection.main.head;
  const guide = guideAt(state);
  const inner = guide?.marks[guide.marks.length - 1];
  if (guide?.ghost && inner && (inner.kind === "sup" || inner.kind === "sub")) {
    if (text === inner.close) return null;
    return closing(inner.close, head, head + inner.close.length + text.length, inner.close + text);
  }
  if (text !== "~" && text !== "^") return null;
  const other = text === "~" ? "^" : "~";
  if (state.sliceDoc(head - 1, head) !== other || state.sliceDoc(head - 2, head - 1) === other) return null;
  if (opaqueLine(state, state.doc.lineAt(head))) return null;
  if (LEAF_MARKS.has(syntaxTree(state).resolveInner(head - 1, 1).name)) return null;
  return {
    changes: { from: head - 1, to: head, insert: text },
    selection: { anchor: head },
    userEvent: "input.type",
    scrollIntoView: true,
  };
}

const leafCloses = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || view.compositionStarted) return false;
  const spec = leafTyping(view.state, text);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
});

// ── Che cosa si vede ─────────────────────────────────────────────────────────

class GhostWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: GhostWidget): boolean { return other.text === this.text; }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-fub-ghost";
    el.setAttribute("aria-hidden", "true");
    el.textContent = this.text;
    return el;
  }
  ignoreEvent(): boolean { return false; }
}

const STYLE: Record<PendingKind, string> = {
  strong: "cm-fub-strong",
  em: "cm-fub-em",
  strike: "cm-fub-strike",
  sup: "cm-fub-sup",
  sub: "cm-fub-sub",
  code: "cm-fub-code",
  math: "cm-fub-pending-math",
  link: "cm-fub-link",
};
const pendingMark = Decoration.mark({ class: "cm-fub-pending-mark" });
const styleMarks = new Map(Object.entries(STYLE).map(([kind, cls]) => [kind, Decoration.mark({ class: `${cls} cm-fub-pending` })]));

/// Le righe in vista, fuori da quella del cursore, con i loro segni rimasti
/// aperti. `scan` è il riconoscitore: il test ci conta le chiamate.
export function openMarksInView(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  scan: (text: string, column: number) => readonly PendingMark[] = pendingOfLine,
): { from: number; to: number; sign: string }[] {
  const out: { from: number; to: number; sign: string }[] = [];
  const cursorLine = state.selection.ranges.length === 1 ? state.doc.lineAt(state.selection.main.head).number : -1;
  let lastLine = 0;
  for (const range of ranges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastLine) continue;
      lastLine = line.number;
      if (line.number === cursorLine || !line.length) continue;
      const marks = scan(line.text, line.length);
      if (!marks.length || opaqueLine(state, line)) continue;
      for (const mark of marks) {
        const from = line.from + mark.from;
        if (openAt(state, from)) out.push({ from, to: line.from + mark.to, sign: line.text.slice(mark.from, mark.to) });
      }
    }
  }
  return out;
}

function decorate(view: EditorView): DecorationSet {
  const state = view.state;
  if (!state.facet(liveGuide)) return Decoration.none;
  const out: Range<Decoration>[] = [];
  const guide = guideAt(state);
  if (guide) {
    for (const mark of guide.marks) {
      out.push(pendingMark.range(mark.from, mark.to));
      const styleTo = mark.textTo ?? guide.head;
      if (styleTo > mark.to) out.push(styleMarks.get(mark.kind)!.range(mark.to, styleTo));
      if (mark.textTo !== undefined && guide.head > mark.textTo) out.push(pendingMark.range(mark.textTo, guide.head));
    }
    if (guide.ghost) out.push(Decoration.widget({ widget: new GhostWidget(guide.ghost), side: 1 }).range(guide.head));
  }
  for (const open of openMarksInView(state, view.visibleRanges)) {
    out.push(Decoration.mark({
      class: "cm-fub-wavy",
      attributes: { title: liveStrings.t("live.guide.open", { sign: open.sign }) },
    }).range(open.from, open.to));
  }
  return Decoration.set(out, true);
}

const guidePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = decorate(view); }
    update(update: ViewUpdate): void {
      if (
        update.docChanged || update.selectionSet || update.viewportChanged
        || update.startState.facet(liveGuide) !== update.state.facet(liveGuide)
        || update.startState.field(dismissed, false) !== update.state.field(dismissed, false)
        || syntaxTree(update.startState) !== syntaxTree(update.state)
      ) this.decorations = decorate(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const theme = EditorView.baseTheme({
  // I colori sono della pelle (`document.css`).
  ".cm-fub-ghost": { pointerEvents: "none", userSelect: "none" },
  ".cm-fub-pending-math": { fontStyle: "italic" },
  ".cm-fub-wavy": { textDecorationLine: "underline", textDecorationStyle: "wavy", textUnderlineOffset: "3px" },
});

/// La guida della Live: lo stato in sospeso, la chiusura in grigio, lo spazio
/// che chiude apice e pedice, l'ondulato. `editor.live-guide` la spegne.
export function pendingGuide(): Extension {
  return [
    written, dismissed, guidePlugin, theme, spaceCloses, leafCloses,
    // Sopra il rientro delle voci e il Backspace della Live: vincono soltanto
    // quando la chiusura in grigio c'è, o è appena stata scritta.
    Prec.highest(keymap.of([
      { key: "ArrowRight", run: accept },
      { key: "Tab", run: accept },
      { key: "Escape", run: quiet },
      { key: "Backspace", run: unwrite },
    ])),
  ];
}
