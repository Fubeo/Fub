// I colori del contenuto (K1): `<span class="fub-color-*">` per il testo,
// `<mark class="fub-bg-*">` per il fondo, i nove nomi di Notion. È HTML in
// riga che il provider conserva e la Lettura, la Live e l'export rendono
// (`colorClasses` in `render-inline.ts`, `content_classes` in `render.rs`); i
// colori veri li dà il tema.
//
// «Colore» lavora sulla selezione, o senza selezione sul testo della riga del
// cursore, dopo i segni del blocco; in una riga vuota scrive la coppia vuota. Se quel testo è già avvolto da un tag di
// colore, cambia la sua classe invece di avvolgerlo di nuovo; «Predefinito»
// toglie la classe, e con l'ultima il tag.
import { EditorSelection, type ChangeSpec, type EditorState, type StateCommand } from "@codemirror/state";
import { CONTENT_COLORS } from "../../../../ui/sanitize";
import { colorClasses } from "./render-inline";

export type ContentColor = (typeof CONTENT_COLORS)[number];
/// Il testo o il fondo.
export type ColorKind = "text" | "fill";

export { CONTENT_COLORS };

const PREFIX = { text: "fub-color-", fill: "fub-bg-" } as const;
const ELEMENT = { text: "span", fill: "mark" } as const;

/// I segni di blocco all'inizio di una riga: rientro, citazione, titolo, voce
/// di lista, casella del compito. Il colore del blocco comincia dopo.
const BLOCK_MARKS = /^(?:\s*>\s?)*\s*(?:#{1,6}\s+|(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?/;

/// Il tratto su cui lavora «Colore»: la selezione principale, o il testo della
/// riga del cursore dopo i segni del blocco.
export function colorRange(state: EditorState): { from: number; to: number } | null {
  const main = state.selection.main;
  if (!main.empty) return { from: main.from, to: main.to };
  return lineText(state, main.head, main.head);
}

/// Il testo delle righe da `from` a `to`, dopo i segni del blocco della prima.
export function lineText(state: EditorState, from: number, to: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(from);
  const start = line.from + (BLOCK_MARKS.exec(line.text)?.[0].length ?? 0);
  const end = state.doc.lineAt(Math.max(from, to)).to;
  return start < end ? { from: start, to: end } : null;
}

/// Un tag di colore che avvolge esattamente `[from, to)`.
type Wrapper = { open: { from: number; to: number }; close: { from: number; to: number }; name: string; classes: string };

const OPEN_BEFORE = /<(span|mark)\s+class\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>$/i;

function wrapperOf(state: EditorState, from: number, to: number): Wrapper | null {
  const before = state.sliceDoc(Math.max(0, from - 120), from);
  const open = OPEN_BEFORE.exec(before);
  if (!open) return null;
  const classes = colorClasses(open[2] ?? open[3] ?? "");
  if (!classes) return null;
  const name = open[1]!.toLowerCase();
  const closing = `</${name}>`;
  if (state.sliceDoc(to, to + closing.length).toLowerCase() !== closing) return null;
  return {
    open: { from: from - open[0].length, to: from },
    close: { from: to, to: to + closing.length },
    name,
    classes,
  };
}

/// I colori del tratto di «Colore»: quello del testo e quello del fondo.
export function colorsAt(state: EditorState): { text: ContentColor | null; fill: ContentColor | null } {
  const range = colorRange(state);
  const wrapper = range && wrapperOf(state, range.from, range.to);
  const pick = (kind: ColorKind): ContentColor | null => {
    const token = wrapper?.classes.split(" ").find((each) => each.startsWith(PREFIX[kind]));
    return (token?.slice(PREFIX[kind].length) as ContentColor | undefined) ?? null;
  };
  return { text: pick("text"), fill: pick("fill") };
}

/// Dà al tratto il colore `color` del testo o del fondo; `null` lo toglie.
/// `at` sceglie il tratto al posto della selezione (il menu del blocco).
export function setContentColor(kind: ColorKind, color: ContentColor | null, at?: { from: number; to: number }): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const range = at ?? colorRange(state);
    if (!range) {
      // Una riga ancora vuota (il «/» appena scritto): la coppia vuota, col
      // cursore dentro, perché il colore valga per ciò che si scrive dopo.
      if (!color) return false;
      const head = state.selection.main.head;
      const open = `<${ELEMENT[kind]} class="${PREFIX[kind]}${color}">`;
      dispatch(state.update({
        changes: { from: head, insert: `${open}</${ELEMENT[kind]}>` },
        selection: EditorSelection.cursor(head + open.length),
        userEvent: "input.format",
      }));
      return true;
    }
    const wrapper = wrapperOf(state, range.from, range.to);
    const kept = (wrapper?.classes.split(" ") ?? []).filter((each) => !each.startsWith(PREFIX[kind]));
    const classes = colorClasses([...kept, ...(color ? [`${PREFIX[kind]}${color}`] : [])].join(" "));
    let changes: ChangeSpec[];
    let shift: number;
    if (wrapper) {
      if (wrapper.classes === (classes ?? "")) return false;
      if (classes) {
        const open = `<${wrapper.name} class="${classes}">`;
        changes = [{ from: wrapper.open.from, to: wrapper.open.to, insert: open }];
        shift = open.length - (wrapper.open.to - wrapper.open.from);
      } else {
        changes = [{ from: wrapper.open.from, to: wrapper.open.to }, { from: wrapper.close.from, to: wrapper.close.to }];
        shift = -(wrapper.open.to - wrapper.open.from);
      }
    } else {
      if (!classes) return false;
      const name = ELEMENT[kind];
      const open = `<${name} class="${classes}">`;
      changes = [{ from: range.from, insert: open }, { from: range.to, insert: `</${name}>` }];
      shift = open.length;
    }
    const main = state.selection.main;
    const selection = at ? undefined : main.empty
      ? EditorSelection.cursor(Math.max(range.from + shift, main.head + shift))
      : EditorSelection.range(range.from + shift, range.to + shift);
    dispatch(state.update({ changes, selection, userEvent: "input.format", scrollIntoView: true }));
    return true;
  };
}
