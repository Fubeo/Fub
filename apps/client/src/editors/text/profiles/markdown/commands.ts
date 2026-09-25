import {
  EditorSelection,
  EditorState,
  Prec,
  type ChangeSpec,
  type Extension,
  type Line,
  type StateCommand,
} from "@codemirror/state";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import { indentUnit, syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";
import { taskChecked } from "../../../../rules/mirrored";
import { nextMarker, listItem, type ListEntry } from "../../../../rules/syntax";
import { isStrictlyInsideCode } from "./parser";
import { textKeymap } from "../../commands";

// ── Formattazione inline ─────────────────────────────────────────────────────

/// Corsa di `*` contigui a ridosso di `pos`, verso sinistra o destra. Serve a
/// non scambiare il `**` del grassetto per un `*` di corsivo: `*x*`, `**x**` e
/// `***x***` si distinguono per la *parità* della corsa, non guardando un solo
/// carattere.
function starRun(state: EditorState, pos: number, dir: -1 | 1): number {
  let n = 0;
  for (;;) {
    const p = dir === -1 ? pos - n - 1 : pos + n;
    if (p < 0 || p >= state.doc.length) return n;
    if (state.sliceDoc(p, p + 1) !== "*") return n;
    n += 1;
  }
}

/// I marcatori stanno subito *fuori* da `[from,to)`? Per il corsivo il singolo
/// `*` conta solo se le corse ai due lati sono dispari: dentro `**…**` non c'è
/// un corsivo da togliere, c'è un grassetto da lasciare in pace.
function wrappedOutside(
  state: EditorState,
  from: number,
  to: number,
  open: string,
  close: string,
): boolean {
  if (from < open.length) return false;
  if (state.sliceDoc(from - open.length, from) !== open) return false;
  if (state.sliceDoc(to, to + close.length) !== close) return false;
  if (open !== "*") return true;
  return starRun(state, from, -1) % 2 === 1 && starRun(state, to, 1) % 2 === 1;
}

/// I marcatori stanno *dentro* la selezione (`‹**x**›`)? Stessa regola di
/// parità del caso "fuori" per il corsivo.
function wrappedInside(sel: string, open: string, close: string): boolean {
  if (sel.length < open.length + close.length) return false;
  if (!sel.startsWith(open) || !sel.endsWith(close)) return false;
  if (open !== "*") return true;
  let l = 0;
  while (l < sel.length && sel.charAt(l) === "*") l += 1;
  let r = 0;
  while (r < sel.length - l && sel.charAt(sel.length - 1 - r) === "*") r += 1;
  return l % 2 === 1 && r % 2 === 1;
}

/// Toggle di un marcatore inline sulla selezione — o sulla parola sotto il
/// cursore, o (senza parola) su una coppia vuota col cursore in mezzo. "Già
/// formattato" vale sia coi marcatori inclusi nella selezione sia con la
/// parola dentro i marcatori: nei due casi si tolgono, altrimenti si avvolge.
function toggleWrap(open: string, close: string = open): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    dispatch(
      state.update(
        state.changeByRange((range) => {
          const backward = range.anchor > range.head;
          const orient = (from: number, to: number) =>
            backward ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
          let { from, to } = range;
          let hadWord = from !== to;
          if (from === to) {
            if (
              from >= open.length &&
              state.sliceDoc(from - open.length, from) === open &&
              state.sliceDoc(from, from + close.length) === close
            ) {
              return {
                changes: [
                  { from: from - open.length, to: from },
                  { from, to: from + close.length },
                ],
                range: EditorSelection.cursor(from - open.length),
              };
            }
            const word = state.wordAt(range.head);
            if (word) {
              ({ from, to } = word);
              hadWord = true;
            }
          }
          if (open === "[[" && close === "]]") {
            const line = state.doc.lineAt(from);
            const lineText = line.text;
            const localFrom = from - line.from;
            const localTo = to - line.from;
            const wikilinks = /\[\[[^\]\n]*\|[^\]\n]*\]\]/g;
            let match: RegExpExecArray | null;
            while ((match = wikilinks.exec(lineText))) {
              const start = match.index;
              const end = start + match[0].length;
              const pipe = match[0].indexOf("|");
              if (localFrom >= start + pipe + 1 && localTo <= end - 2) {
                from = line.from + start;
                to = line.from + end;
                break;
              }
            }
          }
          if (from === to && !hadWord) {
            return {
              changes: { from, insert: open + close },
              range: EditorSelection.cursor(from + open.length),
            };
          }
          if (wrappedInside(state.sliceDoc(from, to), open, close)) {
            return {
              changes: [
                { from, to: from + open.length },
                { from: to - close.length, to },
              ],
              range: orient(from, to - open.length - close.length),
            };
          }
          if (wrappedOutside(state, from, to, open, close)) {
            return {
              changes: [
                { from: from - open.length, to: from },
                { from: to, to: to + close.length },
              ],
              range: orient(from - open.length, to - open.length),
            };
          }
          return {
            changes: [
              { from, insert: open },
              { from: to, insert: close },
            ],
            range: orient(from + open.length, to + open.length),
          };
        }),
        { scrollIntoView: true, userEvent: "input" },
      ),
    );
    return true;
  };
}

export const toggleBold = toggleWrap("**");
export const toggleItalic = toggleWrap("*");
export const toggleStrikethrough = toggleWrap("~~");
/// I delimitatori devono essere più lunghi di ogni corsa di backtick nel
/// contenuto. Il padding CommonMark separa i backtick ai bordi e preserva gli
/// spazi significativi; il parser individua il tratto da liberare al toggle.
export const toggleInlineCode: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const orient = (from: number, to: number) =>
          range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
        let node = syntaxTree(state).resolveInner(range.from, 1);
        while (node.name !== "InlineCode" && node.parent) node = node.parent;
        if (node.name === "InlineCode" && range.to <= node.to) {
          const marks = node.getChildren("CodeMark");
          if (marks.length === 2) {
            let contentFrom = marks[0].to;
            let contentTo = marks[1].from;
            const content = state.sliceDoc(contentFrom, contentTo);
            if (content.startsWith(" ") && content.endsWith(" ") && /\S/.test(content)) {
              contentFrom++;
              contentTo--;
            }
            return {
              changes: [{ from: node.from, to: contentFrom }, { from: contentTo, to: node.to }],
              range: orient(node.from, node.from + contentTo - contentFrom),
            };
          }
        }
        let { from, to } = range;
        if (range.empty) {
          if (from > 0 && state.sliceDoc(from - 1, from + 1) === "``") {
            return {
              changes: { from: from - 1, to: from + 1 },
              range: EditorSelection.cursor(from - 1),
            };
          }
          const word = state.wordAt(from);
          if (word) ({ from, to } = word);
        }
        const content = state.sliceDoc(from, to);
        let width = 1;
        for (const match of content.matchAll(/`+/g)) width = Math.max(width, match[0].length + 1);
        const fence = "`".repeat(width);
        const padded = content.startsWith("`") || content.endsWith("`") ||
          (content.startsWith(" ") && content.endsWith(" ") && /\S/.test(content));
        const open = fence + (padded ? " " : "");
        const close = (padded ? " " : "") + fence;
        return {
          changes: [{ from, insert: open }, { from: to, insert: close }],
          range: orient(from + open.length, to + open.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
};
export const toggleWikilink = toggleWrap("[[", "]]");

// ── Liste ────────────────────────────────────────────────────────────────────

// La lettura di una voce di lista **non sta più qui**: sta in
// `rules/sintassi.ts`, che è il posto unico in cui la shell riconosce sintassi
// (§4.4, decisione 0115). Stava scritto due volte — qui per i gesti, in
// `livepreview.ts` per la casella — e le due non erano d'accordo: su
// `> - [ ] x` la vivi preview disegnava una checkbox e questo file leggeva una
// citazione, quindi `Mod-Enter` non la spuntava; su `-  [ ] x` (due spazi) la
// vivi preview vedeva una todo e questo file un bullet.

/// `Enter` dentro una lista: continua la voce (il testo dopo il cursore scende
/// sulla riga nuova), rinumera le numerate a valle, e su una voce vuota toglie
/// il marcatore chiudendo la lista. Fuori dalle liste — o con una selezione,
/// o col cursore ancora dentro il marcatore — restituisce `false`: lì l'Enter
/// di default fa già la cosa giusta.
export const smartListEnter: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const owned: { line: Line; item: ListEntry }[] = [];
  const splits = new Map<number, number>();
  const emptied = new Set<number>();
  for (const range of state.selection.ranges) {
    if (!range.empty || isStrictlyInsideCode(state, range.head)) return false;
    const line = state.doc.lineAt(range.head);
    const item = listItem(line.text);
    if (!item || range.head < line.from + item.markerEnd) return false;
    owned.push({ line, item });
    if (item.content.trim() === "") emptied.add(line.number);
    else if (item.kind === "ordered") splits.set(line.number, (splits.get(line.number) ?? 0) + 1);
  }

  // Ogni tratta numerata ha un solo piano, compresi più cursori sulla stessa
  // voce. Una riga svuotata interrompe la tratta prima della rinumerazione.
  const numbered = new Map<number, { line: Line; item: ListEntry; number: number }>();
  for (const { line, item } of owned) {
    if (item.kind !== "ordered" || emptied.has(line.number) || numbered.has(line.number)) continue;
    let expected = item.number!;
    for (let n = line.number; n <= state.doc.lines; n++) {
      const row = n === line.number ? line : state.doc.line(n);
      const entry = n === line.number ? item : listItem(row.text);
      if (!entry || entry.quote !== item.quote || emptied.has(n)) break;
      if (entry.indent.length > item.indent.length) continue;
      if (entry.indent.length < item.indent.length || entry.kind !== "ordered") break;
      numbered.set(n, { line: row, item: entry, number: expected });
      expected += 1 + (splits.get(n) ?? 0);
    }
  }

  const edits: { from: number; to?: number; insert?: string }[] = [];
  for (const { line, item, number } of numbered.values()) {
    if (item.number === number) continue;
    const start = item.quote.length + item.indent.length;
    edits.push({
      from: line.from + start,
      to: line.from + line.text.indexOf(item.bullet, start),
      insert: String(number),
    });
  }
  const inserted = new Map<number, number>();
  const removed = new Set<number>();
  for (let index = 0; index < owned.length; index++) {
    const { line, item } = owned[index];
    if (emptied.has(line.number)) {
      if (!removed.has(line.number)) {
        edits.push({ from: line.from + item.quote.length, to: line.to });
        removed.add(line.number);
      }
      continue;
    }
    const count = inserted.get(line.number) ?? 0;
    const entry = item.kind === "ordered"
      ? { ...item, number: numbered.get(line.number)!.number + count }
      : item;
    edits.push({ from: state.selection.ranges[index].head, insert: state.lineBreak + nextMarker(entry) });
    inserted.set(line.number, count + 1);
  }
  edits.sort((a, b) => a.from - b.from);
  const changes = state.changes(edits);
  dispatch(state.update({
    changes,
    selection: EditorSelection.create(
      state.selection.ranges.map((range) => EditorSelection.cursor(changes.mapPos(range.head, 1))),
      state.selection.mainIndex,
    ),
    scrollIntoView: true,
    userEvent: "input",
  }));
  return true;
};

/// Le righe toccate dalla selezione, una volta sola ciascuna. Un capolinea
/// posato esattamente a inizio riga non "seleziona" quella riga: è la stessa
/// convenzione dei comandi di riga di CodeMirror.
function selectedLines(state: EditorState): Line[] {
  const lines: Line[] = [];
  let last = 0;
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toL = state.doc.lineAt(range.to);
    let toLine = toL.number;
    if (!range.empty && range.to === toL.from) toLine -= 1;
    for (let n = Math.max(fromLine, last + 1); n <= toLine; n++) {
      lines.push(state.doc.line(n));
      last = n;
    }
  }
  return lines;
}

/// `Tab` su voci di lista: un livello in più a ogni riga selezionata che sia
/// una voce. Fuori dalle liste → `false`, e il Tab cade sul binding di default
/// (l'`indentWithTab` già montato nell'engine).
export const indentListItem: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const lines = selectedLines(state)
    .map((l) => ({ line: l, item: listItem(l.text) }))
    .filter((entry): entry is { line: Line; item: ListEntry } => entry.item !== null);
  if (lines.length === 0) return false;
  const unit = state.facet(indentUnit);
  dispatch(
    state.update({
      changes: lines.map(({ line, item }) => ({ from: line.from + item.quote.length, insert: unit })),
      scrollIntoView: true,
      userEvent: "input.indent",
    }),
  );
  return true;
};

/// Quanto togliere dall'inizio riga per salire di un livello: l'unità
/// configurata se c'è, altrimenti un tab, altrimenti gli spazi che restano.
function dedentWidth(text: string, unit: string): number {
  if (text.startsWith(unit)) return unit.length;
  if (text.startsWith("\t")) return 1;
  let n = 0;
  while (n < unit.length && text.charAt(n) === " ") n += 1;
  return n;
}

/// `Shift-Tab`, speculare a `indentListItem`. Una voce già a filo del margine
/// resta com'è ma la battuta conta come gestita: de-indentare una lista non
export const dedentListItem: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const lines = selectedLines(state)
    .map((l) => ({ line: l, item: listItem(l.text) }))
    .filter((entry): entry is { line: Line; item: ListEntry } => entry.item !== null);
  if (lines.length === 0) return false;
  const unit = state.facet(indentUnit);
  const changes: ChangeSpec[] = [];
  for (const { line, item } of lines) {
    const width = dedentWidth(line.text.slice(item.quote.length), unit);
    if (width > 0) changes.push({ from: line.from + item.quote.length, to: line.from + item.quote.length + width });
  }
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: "delete.dedent" }));
  return true;
};

/// `Mod-Enter`: spunta/s-spunta le todo delle righe selezionate; una voce di
/// lista senza checkbox la guadagna, non spuntata. Righe che non sono voci
export const toggleCheckbox: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const changes: ChangeSpec[] = [];
  for (const l of selectedLines(state)) {
    const item = listItem(l.text);
    if (!item || item.kind === "quote") continue;
    if (item.symbol !== null) {
      // Il simbolo sta fra le parentesi, e `boxFrom` dice dove sono: leggerlo
      // contando all'indietro dal marcatore presupponeva che la casella fosse
      // sempre `[x] ` di quattro caratteri, che a fine riga è falso.
      const box = l.from + item.boxFrom;
      changes.push({ from: box + 1, to: box + 2, insert: taskChecked(item.symbol) ? " " : "x" });
    } else {
      changes.push({ from: l.from + item.markerEnd, insert: "[ ] " });
    }
  }
  if (changes.length === 0) return false;
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }));
  return true;
};

/// `Mod-Shift-8/7`: le righe selezionate diventano elenco puntato/numerato.
/// Toggle: se lo sono già *tutte*, i marcatori si tolgono. La conversione da
/// un tipo all'altro sostituisce solo pallino/numero e conserva la checkbox
/// (una todo resta una todo); le righe vuote in mezzo si saltano.
function setListKind(kind: "bullet" | "ordered"): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const lines = selectedLines(state).filter((l) => l.text.trim() !== "");
    if (lines.length === 0) return false;
    const items = lines.map((l) => listItem(l.text));
    const allSame = items.every((it) => it !== null && it.kind === kind);
    const changes: ChangeSpec[] = [];
    let n = 1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const it = items[i];
      if (allSame) {
        changes.push({ from: l.from + it!.quote.length + it!.indent.length, to: l.from + it!.markerEnd });
        continue;
      }
      const marker = kind === "bullet" ? "- " : `${n}. `;
      n += 1;
      if (it) {
        // La checkbox sopravvive: si sostituisce fino a **dove comincia la
        // casella**, che è un fatto letto, non i quattro caratteri che si
        // presumeva avesse sempre.
        const end = it.symbol !== null ? l.from + it.boxFrom : l.from + it.markerEnd;
        changes.push({ from: l.from + it.quote.length + it.indent.length, to: end, insert: marker });
      } else {
        const indentLen = /^\s*/.exec(l.text)![0].length;
        changes.push({ from: l.from + indentLen, insert: marker });
      }
    }
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const toggleBulletList = setListKind("bullet");
export const toggleOrderedList = setListKind("ordered");

// ── Tabelle GFM ──────────────────────────────────────────────────────────────

type TableAction =
  | { kind: "insertRow"; side: "before" | "after" }
  | { kind: "deleteRow" | "moveRow"; direction?: -1 | 1 }
  | { kind: "sortRows"; direction: -1 | 1 }
  | { kind: "insertColumn"; side: "before" | "after" }
  | { kind: "deleteColumn" | "moveColumn"; direction?: -1 | 1 }
  | { kind: "sortColumns"; direction: -1 | 1 };

/// The pipe positions belong to the source, not to the rendered cells. In
/// particular, an escaped pipe is data, including when preceded by \\.
function tableCells(text: string): { cells: string[]; starts: number[]; prefix: string; suffix: string } {
  const parts: string[] = [];
  const starts: number[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "|") continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) slashes++;
    if (slashes % 2) continue;
    parts.push(text.slice(start, i));
    starts.push(start);
    start = i + 1;
  }
  parts.push(text.slice(start));
  starts.push(start);
  const left = parts.length > 1 && parts[0]!.trim() === "";
  const right = parts.length > 1 && parts[parts.length - 1]!.trim() === "";
  const first = left ? 1 : 0;
  const last = right ? parts.length - 1 : parts.length;
  return {
    cells: parts.slice(first, last),
    starts: starts.slice(first, last),
    prefix: left ? `${parts[0]}|` : "",
    suffix: right ? `|${parts[parts.length - 1]}` : "",
  };
}

function tableLine(cells: string[], source: string): string {
  const { prefix, suffix } = tableCells(source);
  return `${prefix}${cells.join("|")}${suffix}`;
}

function tableCommand(action: TableAction): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const tree = syntaxTree(state);
    let table: SyntaxNodeRef | null = null;
    const rows = new Set<number>();
    const columns = new Set<number>();
    for (const range of state.selection.ranges) {
      let node = tree.resolve(Math.min(range.from, state.doc.length), 1);
      while (node.name !== "Table" && node.parent) node = node.parent;
      if (node.name !== "Table" || (table && (table.from !== node.from || table.to !== node.to))) return false;
      if (range.from < node.from || range.to > node.to) return false;
      table = node;
      const line = state.doc.lineAt(Math.min(range.head, node.to));
      const firstLine = state.doc.lineAt(node.from).number;
      const index = line.number - firstLine;
      if (index < 0 || line.from > node.to) return false;
      const endLine = state.doc.lineAt(range.to);
      const endIndex = endLine.number - firstLine -
        (!range.empty && range.to === endLine.from ? 1 : 0);
      const startIndex = state.doc.lineAt(range.from).number - firstLine;
      if ((action.kind === "deleteRow" || action.kind === "moveRow") && startIndex === 0) return false;
      for (let row = startIndex; row <= endIndex; row++) {
        if (row >= 2) rows.add(row);
      }
      const parsed = tableCells(line.text);
      if (!parsed.cells.length) return false;
      const relative = range.head - line.from;
      let column = parsed.starts.findIndex((start, i) =>
        relative >= start && relative <= start + parsed.cells[i]!.length
      );
      if (column < 0) column = relative < parsed.starts[0]! ? 0 : parsed.cells.length - 1;
      columns.add(column);
    }
    if (!table) return false;
    const first = state.doc.lineAt(table.from);
    const last = state.doc.lineAt(table.to);
    const lines = Array.from(
      { length: last.number - first.number + 1 },
      (_, i) => state.doc.line(first.number + i).text,
    );
    if (lines.length < 2 || !table.node.getChild("TableHeader") || !table.node.getChild("TableDelimiter")) return false;
    const width = tableCells(lines[0]!).cells.length;
    if (!width || lines.some((line) => tableCells(line).cells.length !== width)) return false;
    const targets = [...rows].sort((a, b) => a - b);
    const cols = [...columns].sort((a, b) => a - b);
    switch (action.kind) {
      case "insertRow": {
        // A header cursor inserts in the body; the delimiter never moves.
        for (const index of targets.length ? targets.reverse() : [2]) {
          const at = targets.length ? index + (action.side === "after" ? 1 : 0) : 2;
          const template = lines[Math.min(Math.max(at, 2), lines.length - 1)] ?? lines[0]!;
          lines.splice(Math.max(2, at), 0, tableLine(Array(width).fill(" "), template));
        }
        break;
      }
      case "deleteRow":
        if (!targets.length) return false;
        for (const index of targets.reverse()) lines.splice(index, 1);
        break;
      case "moveRow": {
        if (!targets.length) return false;
        const chosen = new Set(targets);
        const direction = action.direction ?? -1;
        const indices = direction < 0 ? targets : targets.reverse();
        let moved = false;
        for (const index of indices) {
          const neighbor = index + direction;
          if (neighbor < 2 || neighbor >= lines.length || chosen.has(neighbor)) continue;
          [lines[index], lines[neighbor]] = [lines[neighbor]!, lines[index]!];
          chosen.delete(index);
          chosen.add(neighbor);
          moved = true;
        }
        if (!moved) return false;
        break;
      }
      case "sortRows": {
        const col = cols[0] ?? 0;
        const body = lines.slice(2).map((line, index) => ({ line, index }));
        body.sort((a, b) =>
          action.direction * tableCells(a.line).cells[col]!.trim().localeCompare(
            tableCells(b.line).cells[col]!.trim(), undefined, { numeric: true },
          ) || a.index - b.index
        );
        lines.splice(2, body.length, ...body.map(({ line }) => line));
        break;
      }
      case "sortColumns": {
        const headings = tableCells(lines[0]!).cells;
        const order = Array.from({ length: width }, (_, index) => index);
        order.sort((a, b) =>
          action.direction * headings[a]!.trim().localeCompare(
            headings[b]!.trim(), undefined, { numeric: true },
          ) || a - b
        );
        for (let i = 0; i < lines.length; i++) {
          const source = lines[i]!;
          const cells = tableCells(source).cells;
          lines[i] = tableLine(order.map((index) => cells[index]!), source);
        }
        break;
      }
      case "insertColumn":
      case "deleteColumn":
      case "moveColumn": {
        if (action.kind === "deleteColumn" && cols.length >= width) return false;
        let touched = false;
        for (let i = 0; i < lines.length; i++) {
          const original = lines[i]!;
          const cells = tableCells(original).cells;
          if (action.kind === "insertColumn") {
            for (const col of [...cols].reverse()) {
              cells.splice(col + (action.side === "after" ? 1 : 0), 0, i === 1 ? " --- " : " ");
              touched = true;
            }
          } else if (action.kind === "deleteColumn") {
            for (const col of [...cols].reverse()) cells.splice(col, 1);
            touched = true;
          } else {
            const direction = action.direction ?? -1;
            const chosen = new Set(cols);
            for (const col of direction < 0 ? cols : [...cols].reverse()) {
              const neighbor = col + direction;
              if (neighbor < 0 || neighbor >= width || chosen.has(neighbor)) continue;
              [cells[col], cells[neighbor]] = [cells[neighbor]!, cells[col]!];
              chosen.delete(col);
              chosen.add(neighbor);
              touched = true;
            }
          }
          lines[i] = tableLine(cells, original);
        }
        if (!touched) return false;
        break;
      }
    }
    const insert = lines.join(state.lineBreak);
    if (insert === state.sliceDoc(first.from, last.to)) return false;
    dispatch(state.update({
      changes: { from: first.from, to: last.to, insert },
      scrollIntoView: true,
      userEvent: "input",
    }));
    return true;
  };
}

export const insertTableRow = (side: "before" | "after" = "after") => tableCommand({ kind: "insertRow", side });
export const deleteTableRow = tableCommand({ kind: "deleteRow" });
export const moveTableRow = (direction: -1 | 1) => tableCommand({ kind: "moveRow", direction });
export const sortTableRows = (direction: -1 | 1 = 1) => tableCommand({ kind: "sortRows", direction });
export const insertTableColumn = (side: "before" | "after" = "after") => tableCommand({ kind: "insertColumn", side });
export const deleteTableColumn = tableCommand({ kind: "deleteColumn" });
export const moveTableColumn = (direction: -1 | 1) => tableCommand({ kind: "moveColumn", direction });
export const sortTableColumns = (direction: -1 | 1 = 1) => tableCommand({ kind: "sortColumns", direction });

// ── Auto-pair dei marcatori ──────────────────────────────────────────────────

/// Cosa fare al posto della battuta: `insert` la sostituisce (col cursore a
/// `cursor` code unit dall'inizio dell'inserito), `skip` lascia il cursore oltre
/// il carattere già presente, `null` lascia l'inserimento normale.
export type PairDecision =
  | { action: "insert"; text: string; cursor: number }
  | { action: "skip" };

/// La decisione dell'auto-pair, separata dalla view così si testa a secco.
/// Copre `[[`→`]]`, `==` e `$$`; il singolo `*` e il singolo `$` non si
/// auto-chiudono apposta —
/// nel testo normale lo si digita di continuo, e una chiusura automatica
/// sarebbe più danno che aiuto.
export function autoPairDecision(
  state: EditorState,
  from: number,
  to: number,
  typed: string,
): PairDecision | null {
  // Solo battute singole a selezione vuota: incolla e IME non si toccano.
  if (from !== to || typed.length !== 1) return null;
  // Tutti i marker gestiti sotto sono sintassi Markdown: dentro il codice
  // prevale il confine del parser, non il carattere appena battuto.
  if (isStrictlyInsideCode(state, from)) return null;
  const next = (n: number) => state.sliceDoc(from, from + n);
  const prev = (n: number) => state.sliceDoc(Math.max(0, from - n), from);
  switch (typed) {
    case "[":
      // `[[` → chiudi subito con `]]`, se una chiusura non è già lì davanti.
      if (prev(1) === "[" && next(2) !== "]]") return { action: "insert", text: "[]]", cursor: 1 };
      return null;
    case "]":
      // Davanti a una `]` già presente si scavalca invece di raddoppiare.
      return next(1) === "]" ? { action: "skip" } : null;
    case "=":
      if (next(1) === "=" && (prev(1) === "=" || next(2) === "==")) return { action: "skip" };
      // `==` → chiudi con `==`, ma senza allungare corse di `=` già più lunghe.
      const line = state.doc.lineAt(from);
      const beforeMarker = state.sliceDoc(line.from, Math.max(line.from, from - 1));
      if (prev(1) === "=" && beforeMarker.trim() === "") return null;
      if (prev(1) === "=" && prev(2) !== "==" && next(1) !== "=") {
        return { action: "insert", text: "===", cursor: 1 };
      }
      return null;
    case "$": {
      // Un `$` da solo non si chiude: nel testo è quasi sempre una valuta
      // («5$ al mese», «costa $5»), e una chiusura automatica ne fa una formula.
      const line = state.doc.lineAt(from);
      const before = state.sliceDoc(line.from, from);
      // `$$` a inizio riga apre il math a blocco: `$$|$$`.
      if (before.trim() === "$" && next(1) !== "$") return { action: "insert", text: "$$$", cursor: 1 };
      // Si scavalca solo la `$` che chiude una formula già aperta sulla riga:
      // l'ultima `$` prima del cursore apre se è seguita subito da un
      // carattere non bianco (`$x`), come vuole la sintassi del math in riga.
      const last = before.lastIndexOf("$");
      const open = last >= 0 && before[last - 1] !== "\\" && /\S/.test(before[last + 1] ?? " ");
      if (next(1) === "$" && open) return { action: "skip" };
      return null;
    }
  }
  return null;
}

// L'unico punto del modulo che tocca la view: applica la decisione presa
// sopra. `from + text.length` per lo skip = subito oltre il carattere gemello
// già presente (le battute qui sono sempre singole).
const autoPair = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.state.selection.ranges.length > 1) return false;
  const decision = autoPairDecision(view.state, from, to, text);
  if (decision === null) return false;
  view.dispatch(
    decision.action === "skip"
      ? { selection: { anchor: from + text.length }, scrollIntoView: true, userEvent: "input.type" }
      : {
          changes: { from, to, insert: decision.text },
          selection: { anchor: from + decision.cursor },
          scrollIntoView: true,
          userEvent: "input.type",
        },
  );
  return true;
});

// ── Il pacchetto ─────────────────────────────────────────────────────────────

/// Gli accordi specifici del profilo Markdown, senza quelli della meccanica
/// condivisa.
const markdownKeymapPrefix: KeyBinding[] = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-Shift-x", run: toggleStrikethrough },
  { key: "Mod-`", run: toggleInlineCode },
  { key: "Mod-k", run: toggleWikilink },
  { key: "Enter", run: smartListEnter },
  { key: "Mod-Enter", run: toggleCheckbox },
  { key: "Tab", run: indentListItem },
  { key: "Shift-Tab", run: dedentListItem },
];

const markdownKeymapSuffix: KeyBinding[] = [
  { key: "Mod-Shift-8", run: toggleBulletList },
  { key: "Mod-Shift-7", run: toggleOrderedList },
  { key: "Mod-Alt-ArrowUp", run: moveTableRow(-1) },
  { key: "Mod-Alt-ArrowDown", run: moveTableRow(1) },
  { key: "Mod-Alt-Shift-ArrowUp", run: insertTableRow("before") },
  { key: "Mod-Alt-Shift-ArrowDown", run: insertTableRow("after") },
  { key: "Mod-Alt-Backspace", run: deleteTableRow },
  { key: "Mod-Alt-ArrowLeft", run: moveTableColumn(-1) },
  { key: "Mod-Alt-ArrowRight", run: moveTableColumn(1) },
  { key: "Mod-Alt-Shift-ArrowLeft", run: insertTableColumn("before") },
  { key: "Mod-Alt-Shift-ArrowRight", run: insertTableColumn("after") },
  { key: "Mod-Alt-Shift-Backspace", run: deleteTableColumn },
  { key: "Mod-Alt-s", run: sortTableRows() },
  { key: "Mod-Alt-Shift-s", run: sortTableRows(-1) },
  { key: "Mod-Alt-c", run: sortTableColumns() },
  { key: "Mod-Alt-Shift-c", run: sortTableColumns(-1) },
];

export const markdownKeymap: KeyBinding[] = [...markdownKeymapPrefix, ...markdownKeymapSuffix];

/// Il keymap completo conservato dall'adapter storico: i comandi condivisi
/// restano nella posizione precedente fra i gesti Markdown.
export const obsidianKeymap: KeyBinding[] = [
  ...markdownKeymapPrefix,
  ...textKeymap,
  ...markdownKeymapSuffix,
];

/// Le estensioni del profilo Markdown, pronte per l'adapter compatibile.
export function markdownEditingExtensions(): Extension {
  return [Prec.high(keymap.of(obsidianKeymap)), autoPair];
}
