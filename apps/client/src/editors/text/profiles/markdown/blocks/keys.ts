// I tasti dei Blocchi: Mod-Shift-↑/↓ spostano il blocco (H5), Backspace
// all'inizio di un testo lo unisce al blocco sopra (H8), e dentro un blocco di
// codice Tab rientra il codice e Mod-a seleziona prima il codice, poi tutto
// (C4). Nessuno vale durante una composizione, né con Vim fuori dal modo
// inserimento (H15).
import { syntaxTree } from "@codemirror/language";
import { indentLess, indentMore, insertTab } from "@codemirror/commands";
import { EditorSelection, type EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { type Block, type BlockKind } from "./model";
import { cursorRun, moveRun, siblingsOf } from "./move";
import { blockSelection, runOfSelection, setBlockSelection, vimOn } from "./selection";
import { modelOf } from "./transform";

type Command = (view: EditorView) => boolean;

/// Vim acceso e fuori dal modo inserimento: i tasti sono suoi.
function vimNormal(view: EditorView): boolean {
  if (!vimOn(view)) return false;
  const vim = (getCM(view)?.state as { vim?: { insertMode?: boolean } } | undefined)?.vim;
  return !vim?.insertMode;
}

/// Un comando che si fa da parte durante una composizione e con Vim normale.
function guarded(run: Command): Command {
  return (view) => (view.composing || vimNormal(view) ? false : run(view));
}

function moveBy(dir: -1 | 1): Command {
  return (view) => {
    const state = view.state;
    if (state.readOnly) return false;
    const blocks = modelOf(state);
    const selected = state.field(blockSelection, false);
    const run = selected ? runOfSelection(blocks, selected) : cursorRun(state, blocks);
    if (!run) return false;
    const spec = moveRun(state, blocks, run, dir);
    if (!spec) return true;
    const { follow, ...move } = spec;
    // La selezione di blocchi si porta dietro i suoi capi.
    const effects = selected
      ? setBlockSelection.of({ anchor: follow(selected.anchor) ?? selected.anchor, head: follow(selected.head) ?? selected.head, depth: selected.depth })
      : [];
    view.dispatch({ ...move, effects });
    return true;
  };
}

const TEXTUAL: ReadonlySet<BlockKind> = new Set(["paragraph", "heading", "bullet", "ordered", "task", "quote", "callout"]);

/// Backspace all'inizio di un paragrafo di primo livello: le righe vuote
/// sopra vanno via e il testo si attacca in fondo al blocco di testo sopra,
/// come in Notion. Sopra un blocco che non è testo resta il Backspace di
/// sempre.
export function mergeUpChange(state: EditorState, blocks: readonly Block[]): { from: number; to: number } | null {
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  const index = blocks.findIndex((block) => block.from === main.head && block.depth === 0);
  if (index < 0 || blocks[index]!.kind !== "paragraph") return null;
  const sibs = siblingsOf(blocks, index);
  const at = sibs.indexOf(index);
  if (at <= 0) return null;
  const above = blocks[sibs[at - 1]!]!;
  if (!TEXTUAL.has(above.kind)) return null;
  // Il blocco sopra finisce nel suo ultimo discendente: il testo va lì.
  return { from: above.to, to: main.head };
}

const mergeUp: Command = (view) => {
  if (view.state.readOnly) return false;
  const range = mergeUpChange(view.state, modelOf(view.state));
  if (!range) return false;
  view.dispatch({ changes: range, selection: EditorSelection.cursor(range.from), userEvent: "delete.backward", scrollIntoView: true });
  return true;
};

/// Il testo del blocco di codice recintato che contiene `pos`.
export function codeTextAt(state: EditorState, pos: number): { from: number; to: number } | null {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name !== "FencedCode") continue;
    const text = node.getChild("CodeText");
    if (!text) return null;
    return pos >= text.from && pos <= text.to ? { from: text.from, to: text.to } : null;
  }
  return null;
}

function inCode(view: EditorView): boolean {
  const { ranges } = view.state.selection;
  return ranges.every((range) => codeTextAt(view.state, range.from) !== null && codeTextAt(view.state, range.to) !== null);
}

/// Tab nel codice: un rientro al cursore, o alle righe di una selezione.
const codeTab: Command = (view) => {
  if (!inCode(view)) return false;
  return view.state.selection.ranges.some((range) => !range.empty) ? indentMore(view) : insertTab(view);
};
const codeUntab: Command = (view) => (inCode(view) ? indentLess(view) : false);

/// Mod-a nel codice: prima il codice, poi, se è già tutto selezionato, il
/// resto della nota.
const codeSelectAll: Command = (view) => {
  const { main } = view.state.selection;
  const code = codeTextAt(view.state, main.head);
  if (!code || (main.from === code.from && main.to === code.to)) return false;
  view.dispatch({ selection: EditorSelection.single(code.from, code.to) });
  return true;
};

export const blockKeys: readonly KeyBinding[] = [
  { key: "Mod-Shift-ArrowUp", run: guarded(moveBy(-1)) },
  { key: "Mod-Shift-ArrowDown", run: guarded(moveBy(1)) },
  { key: "Backspace", run: guarded(mergeUp) },
  { key: "Tab", run: guarded(codeTab) },
  { key: "Shift-Tab", run: guarded(codeUntab) },
  { key: "Mod-a", run: guarded(codeSelectAll) },
];

export const blockKeysExtension: Extension = Prec.high(keymap.of(blockKeys));
