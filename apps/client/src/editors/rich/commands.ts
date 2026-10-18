// I gesti di scrittura della superficie ricca, come comandi ProseMirror, e il
// catalogo che li nomina con gli id delle azioni dell'editor
// (`editors/core/editor-actions.ts`).
//
// Gli id sono quelli che la barra di formattazione e la palette conoscono già
// (`markdown.bold`, `markdown.heading.2`, `text.undo`): l'id nomina il gesto,
// non la sintassi, e la superficie che lo esegue decide come. Qui un titolo è
// un ruolo del paragrafo, il grassetto una marca; il documento ne fa stile o
// formattazione diretta al salvataggio.
//
// Le regole di Word che contano per non perdere niente:
//
// - **a capo** divide il paragrafo e le sue proprietà vanno a tutte e due le
//   metà; la sezione resta dopo la seconda, che finisce dove finiva lui. In
//   fondo a un titolo il paragrafo nuovo è testo normale, e una voce d'elenco
//   vuota esce dall'elenco;
// - **unire** due paragrafi tiene le proprietà del primo; una sezione fra i
//   due è un blocco a sé, e il Backspace la seleziona prima di toglierla.
import { chainCommands, deleteSelection, joinBackward, joinForward, selectNodeBackward, selectNodeForward, toggleMark } from "prosemirror-commands";
import { redo, redoDepth, undo, undoDepth } from "prosemirror-history";
import type { Mark as PmMark, MarkType, Node as PmNode, ResolvedPos } from "prosemirror-model";
import { NodeSelection, Plugin, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import {
  BODY,
  COLOR_AUTO,
  HIGHLIGHT_DEFAULT,
  plainLayout,
  type Align,
  type AtomKind,
  type Layout,
  type LayoutLength,
  type Line,
  type Look,
  type Role,
} from "./projection";
import { safeHref } from "./paste";
import { richSchema } from "./schema";

const { para, row: rowType, cell: cellType, table: tableType, brk } = richSchema.nodes;

/// I paragrafi toccati dalla selezione, con la loro posizione.
function selectedParas(state: EditorState): { node: PmNode; pos: number }[] {
  const out: { node: PmNode; pos: number }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === para) {
      out.push({ node, pos });
      return false;
    }
    return true;
  });
  return out;
}

function sameRole(a: Role, b: Role): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/// Il ruolo comune ai paragrafi selezionati, o `null` se sono diversi.
export function selectedRole(state: EditorState): Role | null {
  const paras = selectedParas(state);
  if (paras.length === 0) return null;
  const first = paras[0].node.attrs.role as Role;
  return paras.every(({ node }) => sameRole(node.attrs.role as Role, first)) ? first : null;
}

/// Dà `role` ai paragrafi selezionati. `toggle`: se l'hanno già tutti, tornano
/// testo normale.
export function setRole(role: Role, toggle = false): Command {
  return (state, dispatch) => {
    const paras = selectedParas(state);
    if (paras.length === 0) return false;
    const current = selectedRole(state);
    const next = toggle && current && sameRole(current, role) ? BODY : role;
    if (paras.every(({ node }) => sameRole(node.attrs.role as Role, next))) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos } of paras) tr.setNodeMarkup(pos, null, { ...node.attrs, role: next });
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/// Sposta di `delta` il livello delle voci d'elenco selezionate (da 0 a 8).
export function shiftListLevel(delta: number): Command {
  return (state, dispatch) => {
    const paras = selectedParas(state);
    if (paras.length === 0) return false;
    const changes: { node: PmNode; pos: number; role: Role }[] = [];
    for (const { node, pos } of paras) {
      const role = node.attrs.role as Role;
      if (role.kind !== "list") return false;
      const level = Math.min(8, Math.max(0, role.level + delta));
      if (level !== role.level) changes.push({ node, pos, role: { ...role, level } });
    }
    if (changes.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos, role } of changes) tr.setNodeMarkup(pos, null, { ...node.attrs, role });
      dispatch(tr);
    }
    return true;
  };
}

/// La marca è attiva su tutta la selezione (o nelle marche del cursore).
export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  let all = true;
  let any = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isInline) return true;
    if (node.type.name === "atom") return false;
    any = true;
    if (!type.isInSet(node.marks)) all = false;
    return false;
  });
  return any && all;
}

/// Le marche dell'aspetto di un tratto: ciò che «Copia formato» porta e
/// «Cancella formattazione» toglie. Il link e le proprietà opache no.
export const FORMAT_MARKS: readonly string[] = ["b", "i", "u", "s", "h", "sup", "sub", "caps", "small_caps", "font", "size", "color"];

/// Toglie la formattazione dei tratti selezionati: l'enfasi, l'aspetto e le
/// proprietà del tratto, che tornano quelle del paragrafo (come «Cancella
/// formattazione» di Word). Il link resta: è contenuto, non aspetto.
export const clearFormatting: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  const types = ["run", ...FORMAT_MARKS].map((name) => richSchema.marks[name]);
  if (empty) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    if (!marks.some((mark) => types.includes(mark.type))) return false;
    if (dispatch) dispatch(state.tr.setStoredMarks(marks.filter((mark) => !types.includes(mark.type))));
    return true;
  }
  let found = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && node.marks.some((mark) => types.includes(mark.type))) found = true;
    return !found;
  });
  if (!found) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const type of types) tr.removeMark(from, to, type);
    dispatch(tr);
  }
  return true;
};

// ── L'aspetto del carattere ─────────────────────────────────────────────────

/// Le dimensioni che i menu propongono e su cui «Ingrandisci» e «Riduci»
/// fanno un passo, come in Word.
export const FONT_SIZES: readonly number[] = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 1638;

/// L'aspetto del testo selezionato: un campo è `null` dove la selezione ne
/// mescola più d'uno. `hl` è `null` anche dove il testo non è evidenziato.
export interface LookState {
  readonly font: string | null;
  readonly size: number | null;
  readonly color: string | null;
  readonly hl: string | null;
}

/// L'aspetto di un testo con queste marche nel paragrafo `paragraph`.
function lookAt(marks: readonly PmMark[], paragraph: PmNode | null): { font?: string; size?: number; color: string; hl: string | null } {
  const base = (paragraph?.attrs.f as Look | null) ?? null;
  let font = base?.font;
  let size = base?.size;
  let color = COLOR_AUTO;
  let hl: string | null = null;
  for (const mark of marks) {
    const name = mark.type.name;
    if (name === "font") font = mark.attrs.family as string;
    else if (name === "size") size = mark.attrs.pt as number;
    else if (name === "color") color = mark.attrs.value as string;
    else if (name === "h") hl = (mark.attrs.color as string | null) ?? HIGHLIGHT_DEFAULT;
  }
  return { font, size, color, hl };
}

export function selectedLook(state: EditorState): LookState {
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const look = lookAt(state.storedMarks ?? $from.marks(), $from.parent.type === para ? $from.parent : null);
    return { font: look.font ?? null, size: look.size ?? null, color: look.color, hl: look.hl };
  }
  const seen: ReturnType<typeof lookAt>[] = [];
  state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (!node.isInline) return true;
    if (node.type.name !== "atom") seen.push(lookAt(node.marks, parent));
    return false;
  });
  if (seen.length === 0) return { font: null, size: null, color: null, hl: null };
  const common = <T>(pick: (look: ReturnType<typeof lookAt>) => T): T | null =>
    seen.every((look) => pick(look) === pick(seen[0])) ? pick(seen[0]) : null;
  return {
    font: common((look) => look.font ?? null),
    size: common((look) => look.size ?? null),
    color: common((look) => look.color),
    hl: common((look) => look.hl),
  };
}

/// I tratti di testo della selezione, ciascuno col suo paragrafo.
function selectedRuns(state: EditorState): { from: number; to: number; paragraph: PmNode; node: PmNode }[] {
  const out: { from: number; to: number; paragraph: PmNode; node: PmNode }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isInline) return true;
    if (node.type.name !== "atom" && parent) {
      out.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), paragraph: parent, node });
    }
    return false;
  });
  return out;
}

/// Mette su ogni tratto selezionato la marca che `make` sceglie per lui
/// (`null`: nessuna). Senza selezione vale per ciò che si scrive dopo.
function setMarkPerRun(type: MarkType, make: (run: { paragraph: PmNode; marks: readonly PmMark[] }) => PmMark | null): Command {
  return (state, dispatch) => {
    const { empty, $from } = state.selection;
    if (empty) {
      if ($from.parent.type !== para) return false;
      if (dispatch) {
        const marks = type.removeFromSet(state.storedMarks ?? $from.marks());
        const mark = make({ paragraph: $from.parent, marks: state.storedMarks ?? $from.marks() });
        dispatch(state.tr.setStoredMarks(mark ? mark.addToSet(marks) : marks));
      }
      return true;
    }
    const runs = selectedRuns(state);
    if (runs.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const run of runs) {
        tr.removeMark(run.from, run.to, type);
        const mark = make({ paragraph: run.paragraph, marks: run.node.marks });
        if (mark) tr.addMark(run.from, run.to, mark);
      }
      dispatch(tr);
    }
    return true;
  };
}

/// Il carattere della selezione. Quello del paragrafo non si scrive: il
/// tratto torna a seguirlo.
export function setFont(family: string | null): Command {
  const type = richSchema.marks.font;
  return setMarkPerRun(type, ({ paragraph }) => {
    const base = (paragraph.attrs.f as Look | null)?.font;
    return family && family !== base ? type.create({ family }) : null;
  });
}

function clampSize(pt: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(pt * 2) / 2));
}

/// La dimensione della selezione, in punti.
export function setSize(pt: number | null): Command {
  const type = richSchema.marks.size;
  return setMarkPerRun(type, ({ paragraph }) => {
    if (pt === null || !Number.isFinite(pt)) return null;
    const size = clampSize(pt);
    const base = (paragraph.attrs.f as Look | null)?.size;
    return size !== base ? type.create({ pt: size }) : null;
  });
}

/// Un passo della scala `FONT_SIZES` per ogni tratto, dalla sua dimensione.
export function stepSize(direction: 1 | -1): Command {
  const type = richSchema.marks.size;
  return setMarkPerRun(type, ({ paragraph, marks }) => {
    const base = (paragraph.attrs.f as Look | null)?.size;
    const current = (type.isInSet(marks)?.attrs.pt as number | undefined) ?? base ?? 11;
    const next =
      direction > 0
        ? FONT_SIZES.find((size) => size > current) ?? clampSize(current + 10)
        : [...FONT_SIZES].reverse().find((size) => size < current) ?? clampSize(current - 1);
    return next !== base ? type.create({ pt: next }) : null;
  });
}

/// Il colore del testo selezionato; `null` lo riporta a quello del paragrafo.
export function setColor(value: string | null): Command {
  const type = richSchema.marks.color;
  return setMarkPerRun(type, () => (value ? type.create({ value }) : null));
}

/// L'evidenziatore sulla selezione, nel colore dato; `null` lo toglie.
export function setHighlight(color: string | null): Command {
  const type = richSchema.marks.h;
  return setMarkPerRun(type, () => (color ? type.create({ color: color === HIGHLIGHT_DEFAULT ? null : color }) : null));
}

/// Le marche d'aspetto all'inizio della selezione: ciò che «Copia formato»
/// prende.
export function formatAt(state: EditorState): PmMark[] {
  const { $from, empty } = state.selection;
  const marks = empty ? state.storedMarks ?? $from.marks() : (state.doc.nodeAt($from.pos)?.marks ?? $from.marks());
  return marks.filter((mark) => FORMAT_MARKS.includes(mark.type.name));
}

/// Dà alla selezione l'aspetto `marks`, al posto del suo.
export function applyFormat(marks: readonly PmMark[]): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const name of FORMAT_MARKS) tr.removeMark(from, to, richSchema.marks[name]);
      for (const mark of marks) tr.addMark(from, to, mark);
      dispatch(tr);
    }
    return true;
  };
}

/// A capo dentro un paragrafo, con le regole di Word.
export const splitParagraph: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if ($from.parent.type !== para || !$from.sameParent($to)) return false;
  const paragraph = $from.parent;
  const role = paragraph.attrs.role as Role;
  if (paragraph.content.size === 0 && role.kind === "list") {
    // Una voce vuota esce dall'elenco invece di farne un'altra.
    if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(), null, { ...paragraph.attrs, role: BODY }));
    return true;
  }
  if (!dispatch) return true;
  const tr = state.tr;
  if (!state.selection.empty) tr.deleteSelection();
  const $pos = tr.selection.$from;
  const atEnd = $pos.parentOffset === $pos.parent.content.size;
  const leavesHeading = atEnd && role.kind === "heading";
  const marks = state.storedMarks ?? $pos.marks();
  tr.split($pos.pos, 1, [{ type: para, attrs: { ...paragraph.attrs, role: leavesHeading ? BODY : role } }]);
  // L'enfasi di un titolo viene dal suo stile: non segue nel testo normale.
  if (!leavesHeading) tr.ensureMarks(marks.filter((mark) => mark.type.name !== "link"));
  dispatch(tr.scrollIntoView());
  return true;
};

/// Un a-capo dentro il paragrafo (Maiusc+Invio), un salto pagina (Mod+Invio),
/// un salto di colonna (Mod+Maiusc+Invio).
export function insertBreak(ch: "\n" | "\u000c" | "\u000e"): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.inlineContent) return false;
    if (dispatch) {
      const marks = (state.storedMarks ?? $from.marks()).filter((mark) => mark.type.name !== "link");
      dispatch(state.tr.replaceSelectionWith(brk.create({ ch }, null, marks), false).scrollIntoView());
    }
    return true;
  };
}

/// Un oggetto nuovo al posto della selezione, senza le marche del testo
/// intorno: il formato lo scrive con le sue proprietà.
function insertAtom(attrs: { kind: AtomKind; data?: string; note?: string; end?: boolean; w?: number; h?: number }): Command {
  return (state, dispatch) => {
    if (!state.selection.$from.parent.inlineContent) return false;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(richSchema.nodes.atom.create(attrs), false).scrollIntoView());
    return true;
  };
}

/// Un'immagine nuova: i suoi byte in base64 e la sua misura in punti.
export function insertImage(data: string, w: number, h: number): Command {
  return insertAtom({ kind: "image", data, w, h });
}

/// Una nota nuova a piè di pagina, o di chiusura se `end`, con il suo testo.
export function insertNote(text: string, end: boolean): Command {
  const note = text.trim();
  if (note === "" || /[\p{Cc}\uFFFC]/u.test(note)) return () => false;
  return insertAtom({ kind: "note", note, end });
}

/// Inserisce una tabulazione dove sta il cursore.
export const insertTab: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.inlineContent) return false;
  if (dispatch) dispatch(state.tr.insertText("\t").scrollIntoView());
  return true;
};

/// Il cursore in testa (o in fondo) a un paragrafo accanto a una sezione la
/// seleziona: `joinBackward` toglierebbe un blocco atomico vicino senza
/// mostrarlo, e una sezione porta impaginazione, intestazioni e piè di pagina.
function selectSection(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { $head, empty } = state.selection;
    if (!empty || !$head.parent.isTextblock) return false;
    const atEdge = dir < 0 ? $head.parentOffset === 0 : $head.parentOffset === $head.parent.content.size;
    if (!atEdge) return false;
    const $cut = state.doc.resolve(dir < 0 ? $head.before() : $head.after());
    const node = dir < 0 ? $cut.nodeBefore : $cut.nodeAfter;
    if (node?.type !== richSchema.nodes.section) return false;
    if (dispatch) {
      const pos = dir < 0 ? $cut.pos - node.nodeSize : $cut.pos;
      dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView());
    }
    return true;
  };
}

/// Backspace: cancella la selezione, seleziona una sezione prima invece di
/// toglierla, unisce al paragrafo prima, oppure seleziona l'oggetto prima.
export const backspace: Command = chainCommands(deleteSelection, selectSection(-1), joinBackward, selectNodeBackward);
export const deleteForward: Command = chainCommands(deleteSelection, selectSection(1), joinForward, selectNodeForward);

// ── Le righe di una tabella ──────────────────────────────────────────────────

interface InRow {
  readonly table: PmNode;
  readonly tablePos: number;
  readonly row: PmNode;
  readonly rowIndex: number;
  readonly rowPos: number;
  readonly depth: number;
}

function rowAt($pos: ResolvedPos): InRow | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === rowType && $pos.node(depth - 1).type === tableType) {
      return {
        table: $pos.node(depth - 1),
        tablePos: $pos.before(depth - 1),
        row: $pos.node(depth),
        rowIndex: $pos.index(depth - 1),
        rowPos: $pos.before(depth),
        depth,
      };
    }
  }
  return null;
}

/// Una cella vuota come `cell`: stesse proprietà di cella e del paragrafo.
function emptyCellLike(cell: PmNode): PmNode {
  const first = cell.firstChild;
  const attrs = first?.type === para ? { ...first.attrs, role: BODY } : undefined;
  return cellType.create(cell.attrs, para.create(attrs));
}

/// Una riga nuova come quella del cursore: stesse proprietà di riga e di
/// cella (come «Inserisci riga» di Word), celle vuote.
function emptyRowLike(row: PmNode): PmNode {
  const cells: PmNode[] = [];
  row.forEach((cell) => cells.push(emptyCellLike(cell)));
  return rowType.create(row.attrs, cells);
}

export function insertRow(where: "before" | "after"): Command {
  return (state, dispatch) => {
    const at = rowAt(state.selection.$from);
    if (!at) return false;
    if (dispatch) {
      const pos = where === "before" ? at.rowPos : at.rowPos + at.row.nodeSize;
      const tr = state.tr.insert(pos, emptyRowLike(at.row));
      dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 3))).scrollIntoView());
    }
    return true;
  };
}

export function moveRow(delta: -1 | 1): Command {
  return (state, dispatch) => {
    const at = rowAt(state.selection.$from);
    if (!at) return false;
    const target = at.rowIndex + delta;
    if (target < 0 || target >= at.table.childCount) return false;
    if (dispatch) {
      const other = at.table.child(target);
      const offset = state.selection.from - at.rowPos;
      const tr = state.tr;
      if (delta < 0) {
        const otherPos = at.rowPos - other.nodeSize;
        tr.replaceWith(otherPos, at.rowPos + at.row.nodeSize, [at.row, other]);
        tr.setSelection(TextSelection.near(tr.doc.resolve(otherPos + offset)));
      } else {
        const end = at.rowPos + at.row.nodeSize + other.nodeSize;
        tr.replaceWith(at.rowPos, end, [other, at.row]);
        tr.setSelection(TextSelection.near(tr.doc.resolve(at.rowPos + other.nodeSize + offset)));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/// Toglie la riga del cursore; l'ultima no, perché una tabella senza righe
/// non si scrive: si toglie la tabella intera, apposta.
export const deleteRow: Command = (state, dispatch) => {
  const at = rowAt(state.selection.$from);
  if (!at || at.table.childCount <= 1) return false;
  if (dispatch) {
    const tr = state.tr.delete(at.rowPos, at.rowPos + at.row.nodeSize);
    const near = Math.min(at.rowPos, tr.doc.content.size);
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(near), -1)).scrollIntoView());
  }
  return true;
};

// ── Le colonne di una tabella ────────────────────────────────────────────────

interface InColumn extends InRow {
  readonly cellIndex: number;
  /// Il cursore dall'inizio del contenuto della sua cella.
  readonly offset: number;
}

/// Le colonne si toccano soltanto dove ogni riga ha le stesse celle, nessuna
/// unita: con celle unite in larghezza non si sa di quale colonna sia una
/// cella.
function columnAt(state: EditorState): InColumn | null {
  const { $from } = state.selection;
  const at = rowAt($from);
  if (!at) return null;
  let even = true;
  at.table.forEach((row) => {
    even &&= row.childCount === at.row.childCount;
    row.forEach((cell) => {
      even &&= cell.attrs.span === 1;
    });
  });
  if (!even) return null;
  return { ...at, cellIndex: $from.index(at.depth), offset: $from.pos - $from.start(at.depth + 1) };
}

/// Rifà le righe della tabella del cursore con `cells` e mette il cursore
/// nella cella `cell` della sua riga, `offset` dopo il suo inizio.
function rebuildColumns(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  at: InColumn,
  cells: (row: PmNode) => PmNode[],
  cell: number,
  offset: number,
): void {
  const rows: PmNode[] = [];
  at.table.forEach((row) => rows.push(rowType.create(row.attrs, cells(row))));
  const table = tableType.create(at.table.attrs, rows);
  const tr = state.tr.replaceWith(at.tablePos, at.tablePos + at.table.nodeSize, table);
  let pos = at.tablePos + 1;
  for (let r = 0; r < at.rowIndex; r += 1) pos += table.child(r).nodeSize;
  const row = table.child(at.rowIndex);
  pos += 1;
  for (let c = 0; c < cell; c += 1) pos += row.child(c).nodeSize;
  const inside = Math.min(pos + 1 + offset, pos + row.child(cell).nodeSize - 1);
  dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(inside))).scrollIntoView());
}

/// Una colonna vuota accanto a quella del cursore: ogni cella copia le
/// proprietà di quella accanto, come in Word.
export function insertColumn(where: "before" | "after"): Command {
  return (state, dispatch) => {
    const at = columnAt(state);
    if (!at || at.row.childCount >= TABLE_MAX_COLS) return false;
    if (dispatch) {
      const index = where === "before" ? at.cellIndex : at.cellIndex + 1;
      const cells = (row: PmNode) => {
        const out: PmNode[] = [];
        row.forEach((cell) => out.push(cell));
        out.splice(index, 0, emptyCellLike(row.child(at.cellIndex)));
        return out;
      };
      rebuildColumns(state, dispatch, at, cells, index, 0);
    }
    return true;
  };
}

export function moveColumn(delta: -1 | 1): Command {
  return (state, dispatch) => {
    const at = columnAt(state);
    const target = (at?.cellIndex ?? -2) + delta;
    if (!at || target < 0 || target >= at.row.childCount) return false;
    if (dispatch) {
      const cells = (row: PmNode) => {
        const out: PmNode[] = [];
        row.forEach((cell) => out.push(cell));
        [out[at.cellIndex], out[target]] = [out[target]!, out[at.cellIndex]!];
        return out;
      };
      rebuildColumns(state, dispatch, at, cells, target, at.offset);
    }
    return true;
  };
}

/// Toglie la colonna del cursore; l'ultima no, come l'ultima riga.
export const deleteColumn: Command = (state, dispatch) => {
  const at = columnAt(state);
  if (!at || at.row.childCount <= 1) return false;
  if (dispatch) {
    const cells = (row: PmNode) => {
      const out: PmNode[] = [];
      row.forEach((cell, _offset, c) => {
        if (c !== at.cellIndex) out.push(cell);
      });
      return out;
    };
    rebuildColumns(state, dispatch, at, cells, Math.min(at.cellIndex, at.row.childCount - 2), 0);
  }
  return true;
};

// ── Celle unite ──────────────────────────────────────────────────────────────

/// La posizione della cella `index` della riga in `at`.
function cellPos(at: InRow, index: number): number {
  let pos = at.rowPos + 1;
  for (let c = 0; c < index; c += 1) pos += at.row.child(c).nodeSize;
  return pos;
}

/// Unisce le celle che la selezione tocca in una riga: la prima copre le
/// colonne di tutte e ne raccoglie i blocchi, tranne i paragrafi vuoti.
export const mergeCells: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  const at = rowAt($from);
  const end = rowAt($to);
  if (!at || !end || at.rowPos !== end.rowPos) return false;
  const from = $from.index(at.depth);
  const to = $to.index(at.depth);
  if (from >= to) return false;
  let span = 0;
  const content: PmNode[] = [];
  for (let c = from; c <= to; c += 1) {
    const cell = at.row.child(c);
    span += cell.attrs.span as number;
    cell.forEach((block) => {
      if (block.type !== para || block.content.size > 0) content.push(block);
    });
  }
  if (span > TABLE_MAX_COLS) return false;
  if (dispatch) {
    const first = at.row.child(from);
    const blocks = content.length > 0 ? content : [first.firstChild!];
    const merged = cellType.create({ ...first.attrs, span }, blocks);
    const pos = cellPos(at, from);
    const tr = state.tr.replaceWith(pos, cellPos(at, to) + at.row.child(to).nodeSize, merged);
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))).scrollIntoView());
  }
  return true;
};

/// Divide la cella unita del cursore: tiene il contenuto in una colonna, e
/// le altre tornano celle vuote come lei.
export const splitCell: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const at = rowAt($from);
  if (!at) return false;
  const index = $from.index(at.depth);
  const cell = at.row.child(index);
  const span = cell.attrs.span as number;
  if (span <= 1) return false;
  if (dispatch) {
    const one = (node: PmNode) => cellType.create({ ...node.attrs, span: 1 }, node.content);
    const cells = [one(cell), ...Array.from({ length: span - 1 }, () => one(emptyCellLike(cell)))];
    const pos = cellPos(at, index);
    const tr = state.tr.replaceWith(pos, pos + cell.nodeSize, cells);
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve($from.pos))).scrollIntoView());
  }
  return true;
};

// ── Le tabelle nuove ─────────────────────────────────────────────────────────

/// Le colonne che una tabella di Word può avere.
export const TABLE_MAX_COLS = 63;

/// Una tabella `rows × cols` vuota, senza `k`: il formato la scrive con le sue
/// proprietà predefinite (in Word, la griglia a tutta riga). Va dopo il blocco
/// del cursore, o prima di un paragrafo vuoto, come in Word; un paragrafo la
/// segue sempre, perché due tabelle accostate Word le fonde. Non dentro una
/// tabella: le tabelle annidate non si creano qui.
export function insertTable(rows: number, cols: number): Command {
  return (state, dispatch) => {
    const fits = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;
    if (!fits(rows, 1000) || !fits(cols, TABLE_MAX_COLS)) return false;
    const { $from } = state.selection;
    if ($from.depth < 1 || !$from.parent.inlineContent || rowAt($from)) return false;
    if (dispatch) {
      const block = $from.node(1);
      const empty = block.type === para && block.content.size === 0;
      const pos = empty ? $from.before(1) : $from.after(1);
      const cells = () => Array.from({ length: cols }, () => cellType.create(null, para.create()));
      const table = tableType.create(
        null,
        Array.from({ length: rows }, () => rowType.create(null, cells())),
      );
      const tr = state.tr.insert(pos, table);
      const after = pos + table.nodeSize;
      if (tr.doc.resolve(after).nodeAfter?.type !== para) tr.insert(after, para.create());
      // Tabella, riga, cella, paragrafo: il cursore nella prima cella.
      dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 4)).scrollIntoView());
    }
    return true;
  };
}

/// Ridà un `k` alle righe e alle celle che ProseMirror ha creato riparando
/// una tabella: quello della riga accanto, e per una cella quello della cella
/// alla stessa colonna nella riga accanto, o della cella accanto. Una tabella
/// non ha mai righe senza proprietà: le avrebbe il file, e qui non si
/// inventano; una tabella nuova non ne ha in nessuna riga, e resta così.
export const fillTableKeys = new Plugin({
  appendTransaction(transactions, _old, state) {
    if (!transactions.some((tr) => tr.docChanged)) return null;
    const tr = state.tr;
    state.doc.descendants((node, pos) => {
      if (node.type !== tableType) return node.isBlock;
      const rows: PmNode[] = [];
      node.forEach((row) => rows.push(row));
      const rowKey = (i: number): string | null => {
        for (let d = 1; d < rows.length; d += 1) {
          for (const j of [i - d, i + d]) {
            const k = rows[j]?.attrs.k as string | null | undefined;
            if (k) return k;
          }
        }
        return null;
      };
      const cellKey = (i: number, c: number): string | null => {
        for (let d = 1; d < rows.length; d += 1) {
          for (const j of [i - d, i + d]) {
            const row = rows[j];
            const k = row && c < row.childCount ? (row.child(c).attrs.k as string | null) : null;
            if (k) return k;
          }
        }
        const row = rows[i];
        for (let d = 1; d < row.childCount; d += 1) {
          for (const j of [c - d, c + d]) {
            const k = j >= 0 && j < row.childCount ? (row.child(j).attrs.k as string | null) : null;
            if (k) return k;
          }
        }
        return null;
      };
      let rowPos = pos + 1;
      rows.forEach((row, i) => {
        if (!row.attrs.k) {
          const k = rowKey(i);
          if (k) tr.setNodeAttribute(rowPos, "k", k);
        }
        let cellPos = rowPos + 1;
        row.forEach((cell, _offset, c) => {
          if (!cell.attrs.k) {
            const k = cellKey(i, c);
            if (k) tr.setNodeAttribute(cellPos, "k", k);
          }
          cellPos += cell.nodeSize;
        });
        rowPos += row.nodeSize;
      });
      return false;
    });
    return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
  },
});

// ── I link ───────────────────────────────────────────────────────────────────

/// Il link al cursore o sulla selezione: il suo indirizzo e il tratto che
/// copre nel paragrafo. Con una selezione, soltanto se tutta dentro lo stesso
/// link.
export function linkAt(state: EditorState): { href: string; from: number; to: number } | null {
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to) || $from.parent.type !== para) return null;
  const type = richSchema.marks.link;
  const parent = $from.parent;
  const start = $from.start();
  // I figli del paragrafo con il loro inizio.
  const pieces: { from: number; to: number; href: string | null }[] = [];
  parent.forEach((child, offset) => {
    const mark = type.isInSet(child.marks);
    pieces.push({ from: start + offset, to: start + offset + child.nodeSize, href: (mark?.attrs.href as string | undefined) ?? null });
  });
  const at = $from.pos;
  // Il pezzo che contiene il cursore; in fondo a un link, quello prima.
  let index = pieces.findIndex((piece) => piece.from <= at && at < piece.to && piece.href !== null);
  if (index < 0) index = pieces.findIndex((piece) => piece.to === at && piece.href !== null);
  if (index < 0) return null;
  const href = pieces[index]!.href!;
  let first = index;
  let last = index;
  while (first > 0 && pieces[first - 1]!.href === href) first -= 1;
  while (last < pieces.length - 1 && pieces[last + 1]!.href === href) last += 1;
  const from = pieces[first]!.from;
  const to = pieces[last]!.to;
  if (!state.selection.empty && ($from.pos < from || $to.pos > to)) return null;
  return { href, from, to };
}

/// L'azione che chiede un link: la striscia apre il modulo dell'indirizzo.
export const LINK_ACTION = "rich.link";
export const LINK_CHORD = "Mod-k";
/// Trova e sostituisci: `Mod-h` come in Word, perché `Mod-f` è la ricerca
/// della shell dentro il documento.
export const FIND_ACTION = "rich.find";
/// Le azioni che chiedono qualcosa a chi scrive prima di fare: le apre chi
/// sa chiedere (la striscia).
export const ASK_ACTIONS: ReadonlySet<string> = new Set([LINK_ACTION, FIND_ACTION]);

/// Mette il link `href` sulla selezione, o sul link al cursore; senza
/// selezione e fuori da un link scrive `text` (o l'indirizzo) come link.
/// `null` toglie il link. Un indirizzo che non porta sul web non si scrive.
export function setLink(href: string | null, text?: string): Command {
  return (state, dispatch) => {
    const type = richSchema.marks.link;
    if (href !== null && !safeHref(href)) return false;
    const around = linkAt(state);
    const { from, to, empty } = state.selection;
    if (href === null) {
      const range = around ?? (empty ? null : { from, to });
      if (!range || !state.doc.rangeHasMark(range.from, range.to, type)) return false;
      if (dispatch) dispatch(state.tr.removeMark(range.from, range.to, type));
      return true;
    }
    if (!state.selection.$from.parent.inlineContent) return false;
    if (dispatch) {
      const tr = state.tr;
      const mark = type.create({ href });
      if (around && empty) {
        tr.removeMark(around.from, around.to, type).addMark(around.from, around.to, mark);
      } else if (!empty) {
        tr.removeMark(from, to, type).addMark(from, to, mark);
      } else {
        const marks = (state.storedMarks ?? state.selection.$from.marks()).filter((m) => m.type !== type);
        const node = richSchema.text(text || href, [...marks, mark]);
        tr.replaceSelectionWith(node, false);
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// ── Il paragrafo ─────────────────────────────────────────────────────────────

/// Il passo di «Aumenta rientro» e «Riduci rientro»: mezzo pollice, come Word.
export const INDENT_STEP = 36;
/// Le interlinee che il menu propone, in multipli della riga singola.
export const LINE_SPACINGS: readonly number[] = [1, 1.15, 1.5, 2, 2.5, 3];

/// Cambia gli attributi dei paragrafi selezionati con `change`; `false` se
/// nessuno cambierebbe.
function updateParas(change: (node: PmNode) => Record<string, unknown> | null): Command {
  return (state, dispatch) => {
    const edits: { pos: number; attrs: Record<string, unknown> }[] = [];
    for (const { node, pos } of selectedParas(state)) {
      const attrs = change(node);
      if (attrs && Object.entries(attrs).some(([key, value]) => JSON.stringify(node.attrs[key]) !== JSON.stringify(value))) {
        edits.push({ pos, attrs: { ...node.attrs, ...attrs } });
      }
    }
    if (edits.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { pos, attrs } of edits) tr.setNodeMarkup(pos, null, attrs);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/// Il valore comune ai paragrafi selezionati, o `null` se sono diversi.
function common<T>(state: EditorState, pick: (node: PmNode) => T): T | null {
  const paras = selectedParas(state);
  if (paras.length === 0) return null;
  const first = JSON.stringify(pick(paras[0].node));
  return paras.every(({ node }) => JSON.stringify(pick(node)) === first) ? pick(paras[0].node) : null;
}

/// L'allineamento comune ai paragrafi selezionati; senza, è a sinistra.
export function selectedAlign(state: EditorState): Align | null {
  return common(state, (node) => (node.attrs.align as Align | null) ?? "left");
}

/// Allinea i paragrafi selezionati. Se lo sono già tutti, tornano a
/// sinistra, come in Word.
export function setAlign(align: Align): Command {
  return (state, dispatch) => {
    const next = align !== "left" && selectedAlign(state) === align ? "left" : align;
    return updateParas(() => ({ align: next === "left" ? null : next }))(state, dispatch);
  };
}

function layoutOf(node: PmNode): Layout {
  return (node.attrs.p as Layout | null) ?? {};
}

/// Un campo della disposizione comune ai paragrafi selezionati: `undefined`
/// dove tutti seguono lo stile, `null` dove sono diversi.
export function selectedLayout<K extends LayoutLength | "line">(state: EditorState, key: K): Layout[K] | null {
  if (selectedParas(state).length === 0) return null;
  const value = common(state, (node) => layoutOf(node)[key] ?? "style");
  return value === "style" ? undefined : (value as Layout[K] | null);
}

/// Cambia la disposizione dei paragrafi selezionati; un campo `null` torna a
/// quello dello stile.
export function setLayout(change: { readonly [K in LayoutLength]?: number | null } & { readonly line?: Line | null }): Command {
  return updateParas((node) => {
    const next: Record<string, unknown> = { ...layoutOf(node) };
    for (const [key, value] of Object.entries(change)) {
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = value;
    }
    return { p: plainLayout(next as Layout) ?? null };
  });
}

/// Sposta di `delta` punti il rientro sinistro dei paragrafi selezionati, non
/// oltre il margine.
export function shiftIndent(delta: number): Command {
  return updateParas((node) => {
    const layout = layoutOf(node);
    const left = Math.max(0, (layout.left ?? 0) + delta);
    return { p: plainLayout({ ...layout, left }) ?? null };
  });
}

/// L'interlinea dei paragrafi selezionati, in multipli della riga singola.
export function setLineSpacing(multiple: number | null): Command {
  return setLayout({ line: multiple === null ? null : { multiple } });
}

function lineIs(state: EditorState, multiple: number): boolean {
  const line = selectedLayout(state, "line");
  return !!line && "multiple" in line && line.multiple === multiple;
}

/// Uno stile della galleria: un ruolo, o uno stile di paragrafo del documento.
export type StylePick = { readonly role: Role } | { readonly s: string; readonly f?: Look };

/// Lo stile comune ai paragrafi selezionati, come la galleria lo nomina:
/// `body`, `h:<livello>`, `quote`, `s:<id>`; `null` se sono diversi o in un
/// elenco.
export function selectedStyle(state: EditorState): string | null {
  return common(state, (node) => {
    const role = node.attrs.role as Role;
    if (role.kind === "heading") return `h:${role.level}`;
    if (role.kind === "quote") return "quote";
    if (role.kind === "list") return "list";
    const s = node.attrs.s as string | null;
    return s ? `s:${s}` : "body";
  }) as string | null;
}

/// Dà ai paragrafi selezionati uno stile della galleria. Uno stile del
/// documento li fa testo normale con quello stile; un ruolo toglie lo stile.
/// `look` è l'aspetto del testo senza stile: quello che un paragrafo di corpo
/// torna a mostrare.
export function setStyle(pick: StylePick, look: Look | undefined): Command {
  return updateParas(() => {
    if ("s" in pick) return { role: BODY, s: pick.s, f: pick.f ?? look ?? null };
    if (pick.role.kind === "body") return { role: BODY, s: null, f: look ?? null };
    return { role: pick.role, s: null };
  });
}

// ── Il catalogo ──────────────────────────────────────────────────────────────

export interface RichAction {
  readonly run: Command;
  /// Per un'azione che commuta: è già applicata.
  readonly active?: (state: EditorState) => boolean;
  readonly chord?: string;
}

function roleAction(role: Role, active: (r: Role | null) => boolean, chord?: string): RichAction {
  return { run: setRole(role, role.kind !== "body"), active: (state) => active(selectedRole(state)), chord };
}

function heading(level: number): RichAction {
  return roleAction({ kind: "heading", level }, (role) => role?.kind === "heading" && role.level === level);
}

function mark(name: string, chord?: string): RichAction {
  const type = richSchema.marks[name];
  return { run: toggleMark(type), active: (state) => markActive(state, type), chord };
}

function list(ordered: boolean, chord: string): RichAction {
  return roleAction(
    { kind: "list", ordered, level: 0 },
    (role) => role?.kind === "list" && role.ordered === ordered,
    chord,
  );
}

function align(value: Align, chord?: string): RichAction {
  return { run: setAlign(value), active: (state) => selectedAlign(state) === value, chord };
}

/// Id → azione. Gli accordi sono quelli del profilo Markdown per lo stesso id.
export const RICH_ACTIONS: ReadonlyMap<string, RichAction> = new Map<string, RichAction>([
  ["text.undo", { run: undo, chord: "Mod-z" }],
  ["text.redo", { run: redo, chord: "Mod-Shift-z" }],
  ["markdown.paragraph", roleAction(BODY, (role) => role?.kind === "body")],
  ["markdown.heading.1", heading(1)],
  ["markdown.heading.2", heading(2)],
  ["markdown.heading.3", heading(3)],
  ["markdown.heading.4", heading(4)],
  ["markdown.heading.5", heading(5)],
  ["markdown.heading.6", heading(6)],
  ["markdown.bold", mark("b", "Mod-b")],
  ["markdown.italic", mark("i", "Mod-i")],
  ["markdown.strikethrough", mark("s", "Mod-Shift-x")],
  ["markdown.highlight", mark("h")],
  ["rich.underline", mark("u", "Mod-u")],
  ["rich.superscript", mark("sup", "Mod-Shift-=")],
  ["rich.subscript", mark("sub", "Mod-=")],
  ["rich.caps", mark("caps", "Mod-Shift-a")],
  ["rich.small_caps", mark("small_caps", "Mod-Shift-k")],
  ["rich.font.grow", { run: stepSize(1), chord: "Mod-]" }],
  ["rich.font.shrink", { run: stepSize(-1), chord: "Mod-[" }],
  ["markdown.clear", { run: clearFormatting }],
  ["markdown.list.bullet", list(false, "Mod-Shift-8")],
  ["markdown.list.ordered", list(true, "Mod-Shift-7")],
  ["markdown.list.indent", { run: shiftListLevel(1), chord: "Tab" }],
  ["markdown.list.dedent", { run: shiftListLevel(-1), chord: "Shift-Tab" }],
  ["markdown.quote", roleAction({ kind: "quote" }, (role) => role?.kind === "quote")],
  ["rich.align.left", align("left", "Mod-l")],
  ["rich.align.center", align("center")],
  ["rich.align.right", align("right", "Mod-r")],
  ["rich.align.justify", align("justify", "Mod-j")],
  ["rich.indent.increase", { run: shiftIndent(INDENT_STEP), chord: "Mod-m" }],
  ["rich.indent.decrease", { run: shiftIndent(-INDENT_STEP), chord: "Mod-Shift-m" }],
  ...LINE_SPACINGS.map((multiple): [string, RichAction] => [
    `rich.line.${multiple}`,
    {
      run: setLineSpacing(multiple),
      active: (state) => lineIs(state, multiple),
      chord: multiple === 1 ? "Mod-1" : multiple === 1.5 ? "Mod-5" : multiple === 2 ? "Mod-2" : undefined,
    },
  ]),
  ["rich.break.page", { run: insertBreak("\u000c"), chord: "Mod-Enter" }],
  ["rich.break.column", { run: insertBreak("\u000e"), chord: "Mod-Shift-Enter" }],
  [LINK_ACTION, { run: (state) => state.selection.$from.parent.inlineContent, active: (state) => linkAt(state) !== null, chord: LINK_CHORD }],
  ["rich.link.remove", { run: setLink(null) }],
  [FIND_ACTION, { run: () => true, chord: "Mod-h" }],
  ["markdown.table", { run: insertTable(2, 2) }],
  ["markdown.table.row.before", { run: insertRow("before"), chord: "Mod-Alt-Shift-ArrowUp" }],
  ["markdown.table.row.after", { run: insertRow("after"), chord: "Mod-Alt-Shift-ArrowDown" }],
  ["markdown.table.row.up", { run: moveRow(-1), chord: "Mod-Alt-ArrowUp" }],
  ["markdown.table.row.down", { run: moveRow(1), chord: "Mod-Alt-ArrowDown" }],
  ["markdown.table.row.delete", { run: deleteRow, chord: "Mod-Alt-Backspace" }],
  ["markdown.table.column.before", { run: insertColumn("before"), chord: "Mod-Alt-Shift-ArrowLeft" }],
  ["markdown.table.column.after", { run: insertColumn("after"), chord: "Mod-Alt-Shift-ArrowRight" }],
  ["markdown.table.column.left", { run: moveColumn(-1), chord: "Mod-Alt-ArrowLeft" }],
  ["markdown.table.column.right", { run: moveColumn(1), chord: "Mod-Alt-ArrowRight" }],
  ["markdown.table.column.delete", { run: deleteColumn, chord: "Mod-Alt-Shift-Backspace" }],
  ["rich.table.merge", { run: mergeCells }],
  ["rich.table.split", { run: splitCell }],
]);

/// Lo stato di un'azione: si può eseguire adesso, ed è già applicata.
export function richActionState(id: string, state: EditorState): { enabled: boolean; active: boolean | null } {
  const action = RICH_ACTIONS.get(id);
  if (!action) return { enabled: false, active: null };
  if (id === "text.undo") return { enabled: undoDepth(state) > 0, active: null };
  if (id === "text.redo") return { enabled: redoDepth(state) > 0, active: null };
  const active = action.active ? action.active(state) : null;
  // Un'azione che commuta ed è attiva si può sempre togliere.
  return { enabled: active === true || action.run(state), active };
}
