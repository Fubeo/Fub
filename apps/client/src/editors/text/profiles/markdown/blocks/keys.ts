// I tasti di Scrittura, coi blocchi accesi e spenti (`editor.blocks`, E2).
//
// Accesi: Mod-Shift-↑/↓ spostano il blocco (H5), Backspace all'inizio di un
// testo lo unisce al blocco sopra (H8), Invio in un paragrafo ne apre uno
// nuovo (Maiusc+Invio va a capo dentro), Mod-a prende il testo del blocco e poi
// tutti i blocchi, Mod-d duplica il blocco, e dentro un blocco di codice Tab
// rientra il codice (C4).
// Spenti, come un editor di testo: Mod-a il corpo della nota (titolo e
// proprietà no, non sono il corpo del file), Mod-d la prossima occorrenza,
// Mod-Shift-↑/↓ le righe scelte; Esc non è di Scrittura.
// Nessuno vale durante una composizione, né con Vim fuori dal modo
// inserimento (H15).
import { syntaxTree } from "@codemirror/language";
import { indentLess, indentMore, insertTab, moveLineDown, moveLineUp } from "@codemirror/commands";
import { selectNextOccurrence } from "@codemirror/search";
import { EditorSelection, type EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { calloutHead } from "../callout-head";
import { keepingHeader, movesHeader } from "../commands";
import { frontmatterRange } from "../render";
import { type Block, type BlockKind, innermostAt, subtreeEnd } from "./model";
import { cursorRun, moveRun, siblingsOf } from "./move";
import { blockSelection, duplicateRun, runOfSelection, selectBlocks, setBlockSelection, spanOf, vimOn } from "./selection";
import { modelOf, unwrap } from "./transform";

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
    const { follow, origin, moved, ...move } = spec;
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
  const blocks = modelOf(view.state);
  const range = mergeUpChange(view.state, blocks) ?? emptyParagraphChange(view.state, blocks);
  if (!range) return false;
  view.dispatch({ changes: range, selection: EditorSelection.cursor(range.from), userEvent: "delete.backward", scrollIntoView: true });
  return true;
};

/// Una riga che chiede un a capo vero: la riga di una tabella che si sta
/// scrivendo (un `|` davanti: la riga dei trattini viene dopo, senza righe
/// vuote) o un a capo forzato di Markdown in fondo (`\` o due spazi).
const TABLE_ROW = /^\s*\|/;
const HARD_BREAK = /(?:\\| {2,})$/;

/// Invio coi blocchi, come in Notion e nel prototipo: dentro un paragrafo
/// apre un paragrafo nuovo (una riga vuota in mezzo, cioè un blocco suo), e il
/// testo dopo il cursore ci va dentro. Senza, le righe scritte con Invio
/// sarebbero un paragrafo solo di Markdown, e Esc e Backspace le
/// prenderebbero tutte insieme, la nota intera se è tutta lì (IMP-6106).
/// L'a capo dentro il paragrafo resta Maiusc+Invio. Altrove (titoli, elenchi,
/// citazioni, codice, una riga vuota) Invio è quello di sempre.
function paragraphBreakChange(state: EditorState, blocks: readonly Block[]): { from: number; to: number; insert: string } | null {
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  const index = innermostAt(blocks, main.head);
  if (index < 0 || blocks[index]!.kind !== "paragraph") return null;
  const block = blocks[index]!;
  if (TABLE_ROW.test(state.doc.lineAt(block.from).text)) return null;
  const line = state.doc.lineAt(main.head);
  if (main.head === line.to && HARD_BREAK.test(line.text)) return null;
  return { from: main.head, to: main.head, insert: "\n\n" };
}

const paragraphBreak: Command = (view) => {
  if (view.state.readOnly) return false;
  const change = paragraphBreakChange(view.state, modelOf(view.state));
  if (!change) return false;
  view.dispatch({
    changes: change,
    selection: EditorSelection.cursor(change.from + change.insert.length),
    userEvent: "input",
    scrollIntoView: true,
  });
  return true;
};

/// Backspace sulla riga vuota che Invio ha appena aperto sotto un paragrafo:
/// torna in fondo al paragrafo in un colpo, come in Notion, invece di
/// mangiare una riga vuota alla volta.
function emptyParagraphChange(state: EditorState, blocks: readonly Block[]): { from: number; to: number } | null {
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  const line = state.doc.lineAt(main.head);
  if (line.text !== "" || line.number < 3) return null;
  const gap = state.doc.line(line.number - 1);
  const text = state.doc.line(line.number - 2);
  if (gap.text.trim() !== "" || text.text.trim() === "") return null;
  const index = innermostAt(blocks, text.to);
  if (index < 0 || blocks[index]!.kind !== "paragraph" || blocks[index]!.to !== text.to) return null;
  return { from: text.to, to: main.head };
}

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

/// La fine dell'ultima riga non vuota fra `from` e `to`, mai prima di `from`.
function trimEnd(state: EditorState, from: number, to: number): number {
  let line = state.doc.lineAt(Math.max(from, to));
  while (line.from > from && line.text.trim() === "") line = state.doc.line(line.number - 1);
  return Math.max(from, Math.min(to, line.to));
}

const ATX_HEAD = /^\s*#{1,6}(?:[ \t]+|$)/;
const ATX_CLOSE = /[ \t]+#+[ \t]*$/;
const QUOTE_HEAD = /^\s*(?:>[ \t]?)+/;

/// Il testo del blocco `index`: ciò che si scrive, senza i segni davanti
/// (`## `, `- [ ] `, `> `) né i figli. Per il codice il codice, per un
/// riquadro il titolo e il corpo; per i blocchi senza un testo proprio (una
/// tabella, una linea, l'HTML, un ripiegabile) il blocco intero.
export function blockTextSpan(state: EditorState, blocks: readonly Block[], index: number): { from: number; to: number } {
  const block = blocks[index]!;
  const first = state.doc.lineAt(block.from);
  if (block.kind === "code") {
    const code = codeTextAt(state, Math.min(block.to, first.to + 1));
    if (code) return code;
    // Un recinto ancora vuoto non ha testo; il codice rientrato è tutto testo.
    return /^\s*(?:`{3,}|~{3,})/.test(first.text) ? { from: first.to, to: first.to } : { from: block.from, to: block.to };
  }
  const parts = block.kind === "details" ? null : unwrap(state, blocks, index);
  if (!parts) return { from: block.from, to: block.to };
  // Le righe proprie finiscono dove comincia il primo figlio.
  const end = subtreeEnd(blocks, index);
  const ownTo = trimEnd(state, block.from, end > index + 1 ? blocks[index + 1]!.from - 1 : block.to);
  switch (block.kind) {
    case "heading": {
      const atx = ATX_HEAD.exec(first.text);
      if (atx) {
        const from = first.from + atx[0].length;
        return { from, to: Math.max(from, first.from + first.text.replace(ATX_CLOSE, "").length) };
      }
      // Setext: tutte le righe tranne la sottolineatura.
      const last = state.doc.lineAt(ownTo);
      return { from: first.from + parts.column, to: last.number > first.number ? state.doc.line(last.number - 1).to : ownTo };
    }
    case "callout": {
      const head = calloutHead(first.text);
      if (head && head.title.to > head.title.from) return { from: first.from + head.title.from, to: ownTo };
      if (ownTo <= first.to) return { from: ownTo, to: ownTo };
      const second = state.doc.line(first.number + 1);
      return { from: second.from + (QUOTE_HEAD.exec(second.text)?.[0].length ?? 0), to: ownTo };
    }
    default:
      return { from: Math.min(ownTo, first.from + parts.column), to: ownTo };
  }
}

/// I blocchi di primo livello del corpo: tutti, tranne il frontmatter, che è
/// la testata della pagina e non un blocco da scegliere.
function bodyRun(blocks: readonly Block[]): { first: number; last: number } | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.depth !== 0 || block.kind === "frontmatter") continue;
    if (first < 0) first = i;
    last = i;
  }
  return first < 0 ? null : { first, last };
}

/// Mod-a coi blocchi: la prima volta il testo del blocco del cursore, la
/// seconda tutti i blocchi del corpo, come selezione di blocchi. Oltre non
/// fa altro. Una nota col solo frontmatter non ha blocchi da prendere: il
/// tasto si ferma lì e la selezione resta com'era.
export const selectBlockThenAll: Command = (view) => {
  const state = view.state;
  const blocks = modelOf(state);
  const { main } = state.selection;
  const selected = state.field(blockSelection, false) ?? null;
  const index = selected ? -1 : cursorRun(state, blocks)?.first ?? -1;
  if (index >= 0 && blocks[index]!.kind !== "frontmatter" && state.selection.ranges.length === 1) {
    const span = blockTextSpan(state, blocks, index);
    if (span.to > span.from && !(main.from <= span.from && main.to >= span.to)) {
      view.dispatch({ selection: EditorSelection.single(span.from, span.to), userEvent: "select" });
      return true;
    }
  }
  const body = bodyRun(blocks);
  if (!body) return true;
  const current = selected ? runOfSelection(blocks, selected) : null;
  if (current && current.first === body.first && current.last === body.last) return true;
  view.dispatch(selectBlocks(state, blocks, body.first, body.last));
  return true;
};

/// Mod-d coi blocchi: duplica la selezione di blocchi, o il blocco del
/// cursore. Dal cursore si continua a scrivere nella copia, allo stesso punto
/// del testo; il frontmatter non si duplica (farebbe una seconda testata) e
/// lascia il tasto alla copia della riga.
const duplicateBlock: Command = (view) => {
  const state = view.state;
  if (state.readOnly) return false;
  const blocks = modelOf(state);
  const value = state.field(blockSelection, false);
  if (value) {
    const selected = runOfSelection(blocks, value);
    if (!selected) return false;
    view.dispatch(duplicateRun(state, blocks, selected));
    return true;
  }
  const run = cursorRun(state, blocks);
  if (!run || blocks[run.first]!.kind === "frontmatter") return false;
  const spec = duplicateRun(state, blocks, run);
  const span = spanOf(blocks, run);
  const copy = (spec.selection as EditorSelection).main.from;
  const { anchor, head } = state.selection.main;
  view.dispatch({ ...spec, selection: EditorSelection.single(copy + anchor - span.from, copy + head - span.from), effects: [] });
  return true;
};

export const blockKeys: readonly KeyBinding[] = [
  { key: "Backspace", run: guarded(mergeUp) },
  { key: "Enter", run: guarded(paragraphBreak) },
  { key: "Tab", run: guarded(codeTab) },
  { key: "Shift-Tab", run: guarded(codeUntab) },
];

/// Gli accordi che il testo ha già (Mod-a sceglie tutto, Mod-d copia la riga):
/// stanno sopra la mappa del profilo, che a pari precedenza viene prima e li
/// prenderebbe lei.
export const blockChords: readonly KeyBinding[] = [
  { key: "Mod-Shift-ArrowUp", run: guarded(moveBy(-1)) },
  { key: "Mod-Shift-ArrowDown", run: guarded(moveBy(1)) },
  { key: "Mod-a", run: guarded(selectBlockThenAll) },
  { key: "Mod-d", run: guarded(duplicateBlock) },
];

export const blockKeysExtension: Extension = [Prec.high(keymap.of(blockKeys)), Prec.highest(keymap.of(blockChords))];

/// Il corpo della nota: dal primo blocco dopo il frontmatter alla fine, o
/// tutto se il frontmatter non c'è. `null` se non c'è niente oltre il
/// frontmatter.
export function bodySpan(state: EditorState): { from: number; to: number } | null {
  const doc = state.doc;
  const range = frontmatterRange(doc);
  if (!range) return doc.length > 0 ? { from: 0, to: doc.length } : null;
  let line = doc.lineAt(Math.max(0, range.to - 1));
  while (line.number < doc.lines) {
    line = doc.line(line.number + 1);
    if (line.text.trim() !== "") return { from: line.from, to: doc.length };
  }
  return null;
}

/// Mod-a coi blocchi spenti: il corpo della nota. Il secondo non fa altro; una
/// nota col solo frontmatter non prende niente.
export const selectBody: Command = (view) => {
  const body = bodySpan(view.state);
  if (!body) return true;
  const { main, ranges } = view.state.selection;
  if (ranges.length === 1 && main.from === body.from && main.to === body.to) return true;
  view.dispatch({ selection: EditorSelection.single(body.from, body.to), userEvent: "select" });
  return true;
};

/// Mod-Shift-↑/↓ coi blocchi spenti: le righe scelte, come Alt-↑/↓, con la
/// stessa guardia della testata: una mossa che porterebbe una riga dentro o
/// fuori dal frontmatter, o ne sposterebbe un `---`, non fa niente, e il tasto
/// si ferma lì.
function moveLines(dir: -1 | 1): Command {
  return keepingHeader(dir === -1 ? moveLineUp : moveLineDown, (state) => movesHeader(state, dir));
}

export const plainKeys: readonly KeyBinding[] = [
  { key: "Mod-Shift-ArrowUp", run: guarded(moveLines(-1)) },
  { key: "Mod-Shift-ArrowDown", run: guarded(moveLines(1)) },
  { key: "Mod-a", run: guarded(selectBody) },
  { key: "Mod-d", run: guarded(selectNextOccurrence) },
];

export const plainKeysExtension: Extension = Prec.highest(keymap.of(plainKeys));
