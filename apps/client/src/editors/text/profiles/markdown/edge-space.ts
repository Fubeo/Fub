// Lo spazio al bordo di un elemento, in Live. Markdown non vuole spazi
// contro i segni (`**ciao **` non è grassetto, `^a b^` non è apice), e in
// Live i segni non si vedono: lo spazio scritto lì li farebbe apparire.
//
// - Alla fine del testo di un elemento lo spazio va dopo i segni di
//   chiusura, e la lettera che segue li riporta dopo di sé: si continua a
//   scrivere in grassetto, come in Word. Apice e pedice invece finiscono lì,
//   come quando lo spazio chiude un apice in sospeso.
// - All'inizio del testo va prima dei segni d'apertura.
// - In mezzo a un apice o a un pedice l'elemento passa al tag gemello
//   (`<sup>a b</sup>`), che gli spazi li porta.
import { type EditorState, type Extension, Prec, StateEffect, StateField, type TransactionSpec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import { elementMarksAt, type CursorElement, type ElementMarks } from "./cursor-elements";
import { heldPairAt, spaceBeforePair } from "./empty-pair";

const EDGED: readonly CursorElement[] = ["sup", "sub", "strong", "em", "strike", "highlight"];
const LEAVES: ReadonlySet<CursorElement> = new Set(["sup", "sub"]);
const SIGNS = /^[*_~^=]+$/;

/// I segni rimandati: chiudevano in `[from, to)`, e la prossima lettera
/// scritta in `cursor` li riporta dopo di sé.
interface Carry {
  readonly from: number;
  readonly to: number;
  readonly cursor: number;
}

const carry = StateEffect.define<Carry | null>();

const carried = StateField.define<Carry | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(carry)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

interface Edge {
  readonly element: CursorElement;
  readonly marks: ElementMarks;
}

/// Gli elementi coi segni (non coi tag) che chiudono, uno dopo l'altro, da
/// `pos`: in `***x|***` il grassetto e poi il corsivo.
function closingFrom(state: EditorState, pos: number): Edge[] {
  const out: Edge[] = [];
  for (let at = pos; ;) {
    const here = { from: at, to: at, empty: true };
    const edge = EDGED
      .map((element) => ({ element, marks: elementMarksAt(state, here, element) }))
      .find((found): found is Edge => found.marks !== null && found.marks.closeFrom === at);
    if (!edge || !SIGNS.test(state.sliceDoc(edge.marks.closeFrom, edge.marks.to))) return out;
    out.push(edge);
    at = edge.marks.to;
  }
}

/// Lo stesso all'indietro, per i segni d'apertura che finiscono in `pos`.
function openingTo(state: EditorState, pos: number): number {
  for (let at = pos; ;) {
    const here = { from: at, to: at, empty: true };
    const edge = EDGED
      .map((element) => elementMarksAt(state, here, element))
      .find((marks): marks is ElementMarks => marks !== null && marks.openTo === at);
    if (!edge || !SIGNS.test(state.sliceDoc(edge.from, edge.openTo))) return at;
    at = edge.from;
  }
}

function caret(state: EditorState): number | null {
  const selection = state.selection;
  if (state.readOnly || selection.ranges.length > 1 || !selection.main.empty) return null;
  return selection.main.head;
}

/// La decisione dello spazio scritto in un bordo, o `null` se lo spazio va
/// dove sta il cursore.
export function edgeSpace(state: EditorState): TransactionSpec | null {
  const head = caret(state);
  if (head === null) return null;
  const pair = heldPairAt(state);
  if (pair) {
    // Alla fine del testo di un elemento la coppia, che aspettava una
    // lettera, se ne va: lo spazio esce dall'elemento come senza di lei.
    const end = pair.from + pair.open + pair.close;
    const closes = closingFrom(state, end);
    if (closes.length) {
      const size = end - pair.from;
      const stop = closes[closes.length - 1]!.marks.to - size;
      const outer = closes.filter((edge) => !LEAVES.has(edge.element));
      return {
        changes: [{ from: pair.from, to: end }, { from: stop + size, insert: " " }],
        selection: { anchor: stop + 1 },
        effects: carry.of(outer.length ? { from: outer[0]!.marks.closeFrom - size, to: stop, cursor: stop + 1 } : null),
        userEvent: "input.type",
        scrollIntoView: true,
      };
    }
    // All'inizio del testo di un elemento lo spazio esce anche dai suoi segni.
    return spaceBeforePair(state, (pos) => openingTo(state, pos));
  }
  const pending = state.field(carried, false);
  if (pending && pending.cursor === head) {
    return {
      changes: { from: head, insert: " " },
      selection: { anchor: head + 1 },
      effects: carry.of({ ...pending, cursor: head + 1 }),
      userEvent: "input.type",
      scrollIntoView: true,
    };
  }
  const closes = closingFrom(state, head);
  if (closes.length) {
    const end = closes[closes.length - 1]!.marks.to;
    const outer = closes.filter((edge) => !LEAVES.has(edge.element));
    return {
      changes: { from: end, insert: " " },
      selection: { anchor: end + 1 },
      effects: carry.of(outer.length ? { from: outer[0]!.marks.closeFrom, to: end, cursor: end + 1 } : null),
      userEvent: "input.type",
      scrollIntoView: true,
    };
  }
  const start = openingTo(state, head);
  if (start < head) {
    return { changes: { from: start, insert: " " }, selection: { anchor: head + 1 }, userEvent: "input.type", scrollIntoView: true };
  }
  let node = syntaxTree(state).resolveInner(head, -1);
  while (node.parent && node.name !== "Superscript" && node.name !== "Subscript") node = node.parent;
  if ((node.name !== "Superscript" && node.name !== "Subscript") || !(node.from < head && head < node.to)) return null;
  const tag = node.name === "Superscript" ? "sup" : "sub";
  return {
    changes: [
      { from: node.from, to: node.from + 1, insert: `<${tag}>` },
      { from: head, insert: " " },
      { from: node.to - 1, to: node.to, insert: `</${tag}>` },
    ],
    selection: { anchor: head + tag.length + 2 },
    userEvent: "input.type",
    scrollIntoView: true,
  };
}

/// La lettera scritta dopo gli spazi rimandati riporta i segni dopo di sé.
export function carriedLetter(state: EditorState, text: string): TransactionSpec | null {
  const head = caret(state);
  const pending = state.field(carried, false);
  if (head === null || !pending || pending.cursor !== head || /\s/.test(text)) return null;
  const signs = state.sliceDoc(pending.from, pending.to);
  return {
    changes: [{ from: pending.from, to: pending.to }, { from: head, insert: text + signs }],
    selection: { anchor: head - signs.length + text.length },
    userEvent: "input.type",
    scrollIntoView: true,
  };
}

/// Backspace sugli spazi rimandati: l'ultimo riporta il cursore dentro.
function uncarry(view: EditorView): boolean {
  const head = caret(view.state);
  const pending = view.state.field(carried, false);
  if (head === null || !pending || pending.cursor !== head) return false;
  const last = head - 1 === pending.to;
  view.dispatch({
    changes: { from: head - 1, to: head },
    selection: { anchor: last ? pending.from : head - 1 },
    effects: carry.of(last ? null : { ...pending, cursor: head - 1 }),
    userEvent: "delete.backward",
  });
  return true;
}

const typing = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || view.compositionStarted || [...text].length !== 1) return false;
  const spec = text === " " ? edgeSpace(view.state) : carriedLetter(view.state, text);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
});

/// Lo spazio ai bordi degli elementi, per la Live.
export function edgeSpaces(): Extension {
  return [carried, typing, Prec.highest(keymap.of([{ key: "Backspace", run: uncarry }]))];
}
