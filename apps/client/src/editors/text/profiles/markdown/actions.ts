// Le azioni dell'editor del profilo Markdown: il catalogo che la barra di
// formattazione e l'intento `fub.editor.action` raggiungono per id.
//
// Ogni voce dice tre cose: come si esegue (uno `StateCommand`, lo stesso che
// la tastiera usa quando ha un accordo), dove è già applicata (lo stato
// «premuto») e se adesso ha dove agire. Gli id sono il vocabolario del
// contratto (`docs/reference/ipc-contract.md`): cambiarne uno spegne il
// pulsante di chi lo nomina.
//
// La sintassi riconosciuta è quella che la shell riconosce altrove: l'albero
// Lezer per enfasi, codice, titoli, citazioni, link e tabelle; `listItem` per
// le voci di lista; le regole dichiarate per `==` e `%%`; `containerMath` per
// le formule in riga.
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type Line,
  type StateCommand,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { listItem } from "../../../../rules/syntax";
import { t } from "../../../../i18n/strings";
import { isStrictlyInsideCode } from "./parser";
import { containerMath, isMathContainer } from "./render-inline";
import {
  dedentListItem,
  deleteTableColumn,
  deleteTableRow,
  indentListItem,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
  selectedLines,
  sortTableRows,
  toggleBold,
  toggleBulletList,
  toggleComment,
  toggleHighlight,
  toggleInlineCode,
  toggleInlineMath,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
  toggleWikilink,
} from "./commands";

export interface MarkdownAction {
  readonly run: StateCommand;
  /// Già applicata dove sta il cursore principale; assente per chi inserisce.
  readonly active?: (state: EditorState) => boolean;
  /// Ha dove agire. Assente = ovunque si scriva.
  readonly applicable?: (state: EditorState) => boolean;
  /// Dentro il codice il testo è letterale: l'azione non ha senso lì, e la
  /// barra la spegne invece di scrivere marcatori che diventano codice.
  readonly prose?: boolean;
  /// L'accordo della keymap del profilo, per il suggerimento del pulsante.
  readonly chord?: string;
}

// ── Letture ──────────────────────────────────────────────────────────────────

/// Il nodo più interno di uno dei tipi dati che contiene la selezione
/// principale. A cursore vuoto conta l'interno stretto: subito fuori da
/// `**x**` il grassetto non è premuto.
function enclosing(state: EditorState, names: ReadonlySet<string>): SyntaxNode | null {
  const { from, to, empty } = state.selection.main;
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
  for (; node; node = node.parent) {
    if (!names.has(node.name)) continue;
    if (empty ? node.from < from && from < node.to : node.from <= from && to <= node.to) return node;
  }
  if (!empty) return null;
  // A fine nodo `resolveInner(pos, 1)` guarda già oltre: si riprova a sinistra.
  node = syntaxTree(state).resolveInner(from, -1);
  for (; node; node = node.parent) {
    if (names.has(node.name) && node.from < from && from < node.to) return node;
  }
  return null;
}

const nodeSet = (...names: string[]): ReadonlySet<string> => new Set(names);
const STRONG = nodeSet("StrongEmphasis");
const EMPHASIS = nodeSet("Emphasis");
const STRIKE = nodeSet("Strikethrough");
const INLINE_CODE = nodeSet("InlineCode");
const LINK = nodeSet("Link");
const FENCED = nodeSet("FencedCode");
const TABLE = nodeSet("Table");

/// Una coppia di delimitatori sulla riga del cursore contiene la selezione?
/// Per `==` e `%%`, che l'albero Lezer non conosce.
function insidePair(state: EditorState, pattern: RegExp): boolean {
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from);
  if (to > line.to) return false;
  const start = from - line.from;
  const end = to - line.from;
  for (const match of line.text.matchAll(pattern)) {
    const at = match.index;
    if (at < start && end < at + match[0].length || (at <= start && end <= at + match[0].length && start !== end)) {
      return true;
    }
  }
  return false;
}

const HIGHLIGHT_PAIR = /==(?=\S)(?:[^=\n]|=(?!=))*?\S==/g;
const COMMENT_PAIR = /%%[^\n]*?%%/g;
const WIKILINK_PAIR = /\[\[[^\]\n]*\]\]/g;

/// Dentro una formula `$…$`, letta sul suo contenitore come fa la Lettura: può
/// cominciare su una riga e chiudere sulla seguente.
function insideInlineMath(state: EditorState): boolean {
  const { from, to } = state.selection.main;
  let container: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
  while (container && !isMathContainer(container.name)) container = container.parent;
  if (!container) return false;
  return containerMath(state.sliceDoc(container.from, container.to), container).formulas.some((math) =>
    !math.display && (from === to ? math.from < from && from < math.to : math.from <= from && to <= math.to)
  );
}

/// Dove comincia il contenuto di una riga: dopo citazione, pallino e casella.
function contentStart(text: string): number {
  return listItem(text)?.markerEnd ?? 0;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;

function headingLevel(text: string): number {
  return ATX.exec(text.slice(contentStart(text)))?.[1].length ?? 0;
}

/// Le righe su cui agisce un'azione di riga: quelle della selezione, senza le
/// vuote quando sono più d'una (un titolo su una riga vuota è un titolo da
/// scrivere; dieci righe vuote in una selezione no) e senza il codice.
function proseLines(state: EditorState): Line[] {
  const lines = selectedLines(state);
  const chosen = lines.length > 1 ? lines.filter((line) => line.text.trim() !== "") : lines;
  return chosen.filter((line) => !isStrictlyInsideCode(state, line.from));
}

/// Applica le modifiche come una battuta, con i cursori che finiscono **dopo**
/// ciò che è stato inserito dove stavano: su una riga vuota, `## ` lascia il
/// cursore pronto a scrivere il titolo.
function dispatchChanges(
  state: EditorState,
  dispatch: Parameters<StateCommand>[0]["dispatch"],
  specs: readonly ChangeSpec[],
): boolean {
  if (specs.length === 0) return false;
  const changes = state.changes(specs);
  if (changes.empty) return false;
  dispatch(state.update({
    changes,
    selection: state.selection.map(changes, 1),
    scrollIntoView: true,
    userEvent: "input",
  }));
  return true;
}

/// Un comando si può eseguire qui? Lo si chiede al comando stesso, con un
/// `dispatch` che non scrive: i comandi del profilo restituiscono `false`
/// dove non hanno niente da fare.
function wouldRun(command: StateCommand): (state: EditorState) => boolean {
  return (state) => command({ state, dispatch: () => {} });
}

// ── Titoli e paragrafo ───────────────────────────────────────────────────────

/// Fa delle righe un titolo del livello dato, `0` = paragrafo. Se sono già
/// tutte di quel livello tornano paragrafo: il pulsante premuto si spegne.
function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const lines = proseLines(state);
    if (lines.length === 0) return false;
    const next = level > 0 && lines.every((line) => headingLevel(line.text) === level) ? 0 : level;
    const specs: ChangeSpec[] = [];
    for (const line of lines) {
      const start = contentStart(line.text);
      const match = ATX.exec(line.text.slice(start));
      const from = line.from + start;
      const to = from + (match ? match[0].length : /^ {0,3}/.exec(line.text.slice(start))![0].length);
      const insert = next > 0 ? `${"#".repeat(next)} ` : "";
      if (state.sliceDoc(from, to) !== insert) specs.push({ from, to, insert });
    }
    return dispatchChanges(state, dispatch, specs) || specs.length === 0;
  };
}

function headingActive(level: number): (state: EditorState) => boolean {
  return (state) => {
    const line = state.doc.lineAt(state.selection.main.head);
    if (isStrictlyInsideCode(state, line.from)) return false;
    return headingLevel(line.text) === level;
  };
}

// ── Citazione e callout ──────────────────────────────────────────────────────

const QUOTED = /^( {0,3})> ?/;

/// Citazione come interruttore: se tutte le righe lo sono già perdono un
/// livello, altrimenti diventano citazione quelle che non lo sono. Le righe
/// vuote in mezzo restano dentro (`>`), o la citazione si spezzerebbe.
const toggleQuote: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const lines = selectedLines(state).filter((line) => !isStrictlyInsideCode(state, line.from));
  if (lines.length === 0) return false;
  const quoted = lines.filter((line) => line.text.trim() !== "");
  const all = (quoted.length ? quoted : lines).every((line) => QUOTED.test(line.text));
  const specs: ChangeSpec[] = [];
  for (const line of lines) {
    const match = QUOTED.exec(line.text);
    if (all) {
      if (match) specs.push({ from: line.from, to: line.from + match[0].length, insert: match[1] });
    } else if (!match) {
      specs.push({ from: line.from, insert: line.text.trim() === "" && lines.length > 1 ? ">" : "> " });
    }
  }
  return dispatchChanges(state, dispatch, specs);
};

const quoteActive = (state: EditorState): boolean => {
  const line = state.doc.lineAt(state.selection.main.head);
  return QUOTED.test(line.text) && !isStrictlyInsideCode(state, line.from);
};

/// Un callout: l'intestazione `> [!note]` sopra le righe, che diventano il suo
/// corpo. Su una riga vuota si scrive l'intestazione e si resta nel corpo.
const insertCallout: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const lines = selectedLines(state);
  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  if (lines.length === 1 && first.text.trim() === "") {
    const insert = `> [!note]${state.lineBreak}> `;
    dispatch(state.update({
      changes: { from: first.from, to: first.to, insert },
      selection: EditorSelection.cursor(first.from + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    }));
    return true;
  }
  const body = state.doc.sliceString(first.from, last.to).split(state.lineBreak)
    .map((text) => (text.trim() === "" ? ">" : `> ${text}`));
  const insert = [`> [!note]`, ...body].join(state.lineBreak);
  dispatch(state.update({
    changes: { from: first.from, to: last.to, insert },
    // Il tipo, `note`, fra `> [!` e `]`: lo si riscrive per scegliere un altro.
    selection: EditorSelection.range(first.from + 4, first.from + 8),
    scrollIntoView: true,
    userEvent: "input",
  }));
  return true;
};

// ── Liste ────────────────────────────────────────────────────────────────────

/// Le righe diventano attività; se lo sono già tutte, tornano voci semplici.
/// Una voce senza casella la guadagna, una riga senza voce diventa `- [ ] `.
/// Spuntare resta di `Mod-Enter`: questo pulsante dice «è una lista di cose
/// da fare», non «è fatta».
const toggleTaskList: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const lines = proseLines(state);
  if (lines.length === 0) return false;
  const items = lines.map((line) => listItem(line.text));
  const all = items.every((item) => item !== null && item.symbol !== null);
  const specs: ChangeSpec[] = [];
  lines.forEach((line, index) => {
    const item = items[index];
    if (all) {
      specs.push({ from: line.from + item!.boxFrom, to: line.from + item!.markerEnd });
      return;
    }
    if (item && item.symbol !== null) return;
    if (item && item.kind !== "quote") {
      specs.push({ from: line.from + item.markerEnd, insert: "[ ] " });
      return;
    }
    const at = item ? item.markerEnd : /^\s*/.exec(line.text)![0].length;
    specs.push({ from: line.from + at, insert: "- [ ] " });
  });
  return dispatchChanges(state, dispatch, specs);
};

function listActive(kind: "bullet" | "ordered" | "task"): (state: EditorState) => boolean {
  return (state) => {
    const line = state.doc.lineAt(state.selection.main.head);
    if (isStrictlyInsideCode(state, line.from)) return false;
    const item = listItem(line.text);
    if (!item || item.kind === "quote") return false;
    if (kind === "task") return item.symbol !== null;
    return item.kind === kind && item.symbol === null;
  };
}

// ── Blocchi recintati ────────────────────────────────────────────────────────

/// Il recinto che contiene la selezione principale, se c'è: `from`/`to` delle
/// righe d'apertura e di chiusura.
interface Fence {
  readonly open: Line;
  readonly close: Line | null;
}

function enclosingCodeFence(state: EditorState): Fence | null {
  const node = enclosing(state, FENCED) ?? (() => {
    // Sulla riga del recinto stessa il cursore è nel nodo anche a bordo.
    const line = state.doc.lineAt(state.selection.main.head);
    const inner = syntaxTree(state).resolveInner(line.from, 1);
    for (let n: SyntaxNode | null = inner; n; n = n.parent) if (n.name === "FencedCode") return n;
    return null;
  })();
  if (!node) return null;
  const marks = node.getChildren("CodeMark");
  const open = state.doc.lineAt(node.from);
  const close = marks.length >= 2 ? state.doc.lineAt(marks[marks.length - 1]!.from) : null;
  return { open, close: close && close.number !== open.number ? close : null };
}

const MATH_FENCE = /^\s*\$\$\s*$/;
/// Quante righe si guardano sopra e sotto per trovare i `$$` di un blocco di
/// formula: il parser non lo conosce, e leggere il documento intero a ogni
/// movimento del cursore sarebbe il costo sbagliato per un pulsante.
const MATH_SCAN_LINES = 200;

function enclosingMathFence(state: EditorState): Fence | null {
  const here = state.doc.lineAt(state.selection.main.head);
  let open: Line | null = null;
  for (let n = here.number; n >= Math.max(1, here.number - MATH_SCAN_LINES); n--) {
    const line = state.doc.line(n);
    if (MATH_FENCE.test(line.text)) {
      open = line;
      break;
    }
    if (n !== here.number && line.text.trim() === "") return null;
  }
  if (!open) return null;
  const limit = Math.min(state.doc.lines, here.number + MATH_SCAN_LINES);
  for (let n = open.number + 1; n <= limit; n++) {
    const line = state.doc.line(n);
    if (MATH_FENCE.test(line.text)) {
      // Il cursore sulla riga di chiusura sta ancora nel blocco; oltre, no.
      return here.number <= n ? { open, close: line } : null;
    }
  }
  return null;
}

/// Avvolge le righe della selezione in un recinto, o lo toglie se il cursore
/// ci sta già dentro. Su una riga vuota apre un recinto vuoto col cursore in
/// mezzo.
function toggleFence(
  fence: (content: string) => string,
  find: (state: EditorState) => Fence | null,
): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const found = find(state);
    if (found) {
      const specs: ChangeSpec[] = [];
      const breakLength = state.lineBreak.length;
      specs.push({ from: found.open.from, to: Math.min(found.open.to + breakLength, state.doc.length) });
      if (found.close) {
        specs.push({ from: Math.max(0, found.close.from - breakLength), to: found.close.to });
      }
      return dispatchChanges(state, dispatch, specs);
    }
    const lines = selectedLines(state);
    const first = lines[0]!;
    const last = lines[lines.length - 1]!;
    const content = state.doc.sliceString(first.from, last.to);
    const mark = fence(content);
    const nl = state.lineBreak;
    if (lines.length === 1 && content.trim() === "") {
      dispatch(state.update({
        changes: { from: first.from, to: first.to, insert: `${mark}${nl}${nl}${mark}` },
        selection: EditorSelection.cursor(first.from + mark.length + nl.length),
        scrollIntoView: true,
        userEvent: "input",
      }));
      return true;
    }
    const changes = state.changes([
      { from: first.from, insert: `${mark}${nl}` },
      { from: last.to, insert: `${nl}${mark}` },
    ]);
    // La selezione resta sul contenuto: dentro l'apertura, prima della chiusura.
    const map = (pos: number) => changes.mapPos(pos, pos >= last.to ? -1 : 1);
    dispatch(state.update({
      changes,
      selection: EditorSelection.create(
        state.selection.ranges.map((range) => EditorSelection.range(map(range.anchor), map(range.head))),
        state.selection.mainIndex,
      ),
      scrollIntoView: true,
      userEvent: "input",
    }));
    return true;
  };
}

/// Il recinto deve essere più lungo di ogni corsa di backtick a inizio riga
/// nel contenuto, altrimenti lo chiuderebbe il contenuto stesso.
function backtickFence(content: string): string {
  let width = 3;
  for (const match of content.matchAll(/^\s*(`{3,})/gm)) width = Math.max(width, match[1]!.length + 1);
  return "`".repeat(width);
}

const toggleCodeBlock = toggleFence(backtickFence, enclosingCodeFence);
const toggleMathBlock = toggleFence(() => "$$", enclosingMathFence);

// ── Inserimenti ──────────────────────────────────────────────────────────────

/// Inserisce un blocco su righe sue, separato da righe vuote da ciò che gli
/// sta intorno: al posto della riga del cursore se è vuota, altrimenti dopo.
/// Senza la riga vuota sopra, `---` sotto un paragrafo lo farebbe diventare un
/// titolo Setext e una tabella gli si attaccherebbe. Dopo il blocco resta una
/// riga su cui continuare a scrivere. `select` riceve dove comincia il blocco.
function insertBlock(
  state: EditorState,
  dispatch: Parameters<StateCommand>[0]["dispatch"],
  lines: readonly string[],
  select: (start: number) => { anchor: number; head?: number },
): boolean {
  if (state.readOnly) return false;
  const here = state.doc.lineAt(state.selection.main.to);
  const nl = state.lineBreak;
  const blank = here.text.trim() === "";
  const previous = here.number > 1 ? state.doc.line(here.number - 1) : null;
  const next = here.number < state.doc.lines ? state.doc.line(here.number + 1) : null;
  const before = blank ? (previous && previous.text.trim() !== "" ? nl : "") : `${nl}${nl}`;
  // La riga che chiude il blocco: la porta il testo originale se sotto c'è già
  // una riga vuota, altrimenti la si scrive.
  const after = next === null || next.text.trim() !== "" ? nl : "";
  const from = blank ? here.from : here.to;
  const start = from + before.length;
  const { anchor, head } = select(start);
  dispatch(state.update({
    changes: { from, to: here.to, insert: `${before}${lines.join(nl)}${after}` },
    selection: EditorSelection.single(anchor, head ?? anchor),
    scrollIntoView: true,
    userEvent: "input",
  }));
  return true;
}

const insertRule: StateCommand = ({ state, dispatch }) =>
  insertBlock(state, dispatch, ["---"], (start) => ({ anchor: start + 3 + state.lineBreak.length }));

/// Una tabella da due colonne, con la prima intestazione selezionata per
/// scriverci sopra. Righe separate da tabulazioni (incollate da un foglio)
/// diventano invece la tabella stessa, la prima riga come intestazione.
const insertTable: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  const rows = selected.split(/\r?\n/).filter((row) => row.trim() !== "");
  if (!range.empty && rows.length > 0 && rows.every((row) => row.includes("\t"))) {
    const cells = rows.map((row) => row.split("\t").map((cell) => cell.trim().replace(/\|/g, "\\|")));
    const width = Math.max(...cells.map((row) => row.length));
    const line = (row: string[]) =>
      `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
    const table = [line(cells[0]!), `| ${Array(width).fill("---").join(" | ")} |`, ...cells.slice(1).map(line)];
    dispatch(state.update({
      changes: { from: range.from, to: range.to, insert: table.join(state.lineBreak) },
      scrollIntoView: true,
      userEvent: "input",
    }));
    return true;
  }
  const first = t("editor.table.column", { n: 1 });
  const second = t("editor.table.column", { n: 2 });
  const lines = [`| ${first} | ${second} |`, "| --- | --- |", "|  |  |"];
  return insertBlock(state, dispatch, lines, (start) => ({ anchor: start + 2, head: start + 2 + first.length }));
};

/// Il link: la selezione ne diventa il testo, o l'indirizzo se lo è già; il
/// cursore finisce dove resta da scrivere. Dentro un link lo toglie, e resta
/// il testo.
const toggleLink: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const link = enclosing(state, LINK);
  if (link) {
    const marks = link.getChildren("LinkMark");
    if (marks.length < 2) return false;
    const label = state.sliceDoc(marks[0]!.to, marks[1]!.from);
    dispatch(state.update({
      changes: { from: link.from, to: link.to, insert: label },
      selection: EditorSelection.range(link.from, link.from + label.length),
      scrollIntoView: true,
      userEvent: "input",
    }));
    return true;
  }
  return wrapLink("")({ state, dispatch });
};

function wrapLink(prefix: string): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    let { from, to } = state.selection.main;
    if (from === to && prefix === "") {
      const word = state.wordAt(from);
      if (word) ({ from, to } = word);
    }
    const text = state.sliceDoc(from, to);
    const url = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)\S+$/i.test(text.trim());
    const insert = url ? `${prefix}[](${text.trim()})` : `${prefix}[${text}]()`;
    const cursor = url ? from + prefix.length + 1 : from + insert.length - 1;
    dispatch(state.update({
      changes: { from, to, insert },
      selection: EditorSelection.cursor(text === "" ? from + prefix.length + 1 : cursor),
      scrollIntoView: true,
      userEvent: "input",
    }));
    return true;
  };
}

const insertImage = wrapLink("!");

/// Una nota a piè di pagina: il richiamo dopo la selezione col primo numero
/// libero, la definizione in fondo al documento, e il cursore lì a scriverla.
const insertFootnote: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const text = state.doc.toString();
  const used = new Set([...text.matchAll(/\[\^([^\]\s]+)\]/g)].map((match) => match[1]));
  let n = 1;
  while (used.has(String(n))) n += 1;
  const reference = `[^${n}]`;
  const nl = state.lineBreak;
  const tail = text.endsWith(`${nl}${nl}`) || text === "" ? "" : text.endsWith(nl) ? nl : `${nl}${nl}`;
  const definition = `${tail}${reference}: `;
  const at = state.selection.main.to;
  dispatch(state.update({
    changes: [{ from: at, insert: reference }, { from: state.doc.length, insert: definition }],
    selection: EditorSelection.cursor(state.doc.length + reference.length + definition.length),
    scrollIntoView: true,
    userEvent: "input",
  }));
  return true;
};

// ── Pulizia ──────────────────────────────────────────────────────────────────

const FORMATTED = nodeSet("StrongEmphasis", "Emphasis", "Strikethrough", "InlineCode");
const MARKS = nodeSet("EmphasisMark", "StrikethroughMark", "CodeMark");

/// Toglie la formattazione in riga: i marcatori dei tratti che la selezione
/// contiene per intero, e di quelli che la contengono. Un tratto preso a
/// metà resta com'è: togliergli un marcatore solo lo romperebbe.
const clearFormatting: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const specs: { from: number; to: number }[] = [];
  const seen = new Set<number>();
  const strip = (node: SyntaxNode) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (MARKS.has(child.name) && !seen.has(child.from)) {
        seen.add(child.from);
        specs.push({ from: child.from, to: child.to });
      }
    }
  };
  for (const range of state.selection.ranges) {
    const tree = syntaxTree(state);
    for (let node: SyntaxNode | null = tree.resolveInner(range.from, 1); node; node = node.parent) {
      if (FORMATTED.has(node.name) && node.from <= range.from && range.to <= node.to) strip(node);
    }
    if (!range.empty) {
      tree.iterate({
        from: range.from,
        to: range.to,
        enter: (ref) => {
          if (FORMATTED.has(ref.name) && range.from <= ref.from && ref.to <= range.to) strip(ref.node);
        },
      });
    }
    // `==` e `%%` sulla riga: stessi due casi.
    const line = state.doc.lineAt(range.from);
    if (range.to <= line.to) {
      for (const pattern of [HIGHLIGHT_PAIR, COMMENT_PAIR]) {
        for (const match of line.text.matchAll(pattern)) {
          const from = line.from + match.index;
          const to = from + match[0].length;
          const contains = from <= range.from && range.to <= to;
          const within = range.from <= from && to <= range.to;
          if (!(contains || within) || seen.has(from)) continue;
          seen.add(from);
          specs.push({ from, to: from + 2 }, { from: to - 2, to });
        }
      }
    }
  }
  specs.sort((a, b) => a.from - b.from);
  return dispatchChanges(state, dispatch, specs);
};

// ── Il catalogo ──────────────────────────────────────────────────────────────

const inTable = (state: EditorState) => enclosing(state, TABLE) !== null ||
  (() => {
    const line = state.doc.lineAt(state.selection.main.head);
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, 1); n; n = n.parent) {
      if (n.name === "Table") return true;
    }
    return false;
  })();

function tableAction(run: StateCommand): MarkdownAction {
  return { run, applicable: (state) => inTable(state) && wouldRun(run)(state) };
}

function heading(level: number): MarkdownAction {
  return { run: setHeading(level), active: headingActive(level), prose: true };
}

/// Id → azione. L'ordine non conta: quello della barra è della dichiarazione
/// del plugin.
export const MARKDOWN_ACTIONS: ReadonlyMap<string, MarkdownAction> = new Map<string, MarkdownAction>([
  ["markdown.paragraph", { run: setHeading(0), active: headingActive(0), prose: true }],
  ["markdown.heading.1", heading(1)],
  ["markdown.heading.2", heading(2)],
  ["markdown.heading.3", heading(3)],
  ["markdown.heading.4", heading(4)],
  ["markdown.heading.5", heading(5)],
  ["markdown.heading.6", heading(6)],
  ["markdown.bold", { run: toggleBold, active: (s) => enclosing(s, STRONG) !== null, prose: true, chord: "Mod-b" }],
  ["markdown.italic", { run: toggleItalic, active: (s) => enclosing(s, EMPHASIS) !== null, prose: true, chord: "Mod-i" }],
  ["markdown.strikethrough", {
    run: toggleStrikethrough,
    active: (s) => enclosing(s, STRIKE) !== null,
    prose: true,
    chord: "Mod-Shift-x",
  }],
  ["markdown.highlight", { run: toggleHighlight, active: (s) => insidePair(s, HIGHLIGHT_PAIR), prose: true }],
  ["markdown.code", { run: toggleInlineCode, active: (s) => enclosing(s, INLINE_CODE) !== null, chord: "Mod-`" }],
  ["markdown.math", { run: toggleInlineMath, active: insideInlineMath, prose: true }],
  ["markdown.comment", { run: toggleComment, active: (s) => insidePair(s, COMMENT_PAIR), prose: true }],
  ["markdown.clear", { run: clearFormatting, applicable: wouldRun(clearFormatting), prose: true }],
  ["markdown.link", { run: toggleLink, active: (s) => enclosing(s, LINK) !== null, prose: true }],
  ["markdown.wikilink", { run: toggleWikilink, active: (s) => insidePair(s, WIKILINK_PAIR), prose: true, chord: "Mod-k" }],
  ["markdown.image", { run: insertImage, prose: true }],
  ["markdown.footnote", { run: insertFootnote, prose: true }],
  ["markdown.list.bullet", {
    run: toggleBulletList,
    active: listActive("bullet"),
    prose: true,
    chord: "Mod-Shift-8",
  }],
  ["markdown.list.ordered", {
    run: toggleOrderedList,
    active: listActive("ordered"),
    prose: true,
    chord: "Mod-Shift-7",
  }],
  ["markdown.list.task", { run: toggleTaskList, active: listActive("task"), prose: true }],
  ["markdown.list.indent", { run: indentListItem, applicable: wouldRun(indentListItem), prose: true, chord: "Tab" }],
  ["markdown.list.dedent", {
    run: dedentListItem,
    applicable: wouldRun(dedentListItem),
    prose: true,
    chord: "Shift-Tab",
  }],
  ["markdown.quote", { run: toggleQuote, active: quoteActive, prose: true }],
  ["markdown.callout", { run: insertCallout, prose: true }],
  ["markdown.codeblock", { run: toggleCodeBlock, active: (s) => enclosingCodeFence(s) !== null }],
  ["markdown.mathblock", { run: toggleMathBlock, active: (s) => enclosingMathFence(s) !== null, prose: true }],
  ["markdown.rule", { run: insertRule, prose: true }],
  ["markdown.table", { run: insertTable, prose: true }],
  ["markdown.table.row.before", { ...tableAction(insertTableRow("before")), chord: "Mod-Alt-Shift-ArrowUp" }],
  ["markdown.table.row.after", { ...tableAction(insertTableRow("after")), chord: "Mod-Alt-Shift-ArrowDown" }],
  ["markdown.table.row.up", { ...tableAction(moveTableRow(-1)), chord: "Mod-Alt-ArrowUp" }],
  ["markdown.table.row.down", { ...tableAction(moveTableRow(1)), chord: "Mod-Alt-ArrowDown" }],
  ["markdown.table.row.delete", { ...tableAction(deleteTableRow), chord: "Mod-Alt-Backspace" }],
  ["markdown.table.column.before", { ...tableAction(insertTableColumn("before")), chord: "Mod-Alt-Shift-ArrowLeft" }],
  ["markdown.table.column.after", { ...tableAction(insertTableColumn("after")), chord: "Mod-Alt-Shift-ArrowRight" }],
  ["markdown.table.column.left", { ...tableAction(moveTableColumn(-1)), chord: "Mod-Alt-ArrowLeft" }],
  ["markdown.table.column.right", { ...tableAction(moveTableColumn(1)), chord: "Mod-Alt-ArrowRight" }],
  ["markdown.table.column.delete", { ...tableAction(deleteTableColumn), chord: "Mod-Alt-Shift-Backspace" }],
  ["markdown.table.sort.ascending", { ...tableAction(sortTableRows(1)), chord: "Mod-Alt-s" }],
  ["markdown.table.sort.descending", { ...tableAction(sortTableRows(-1)), chord: "Mod-Alt-Shift-s" }],
]);

/// Lo stato di un'azione del catalogo, già deciso per chi non scrive (sola
/// lettura, modalità di lettura: lo decide chi chiama).
export function markdownActionState(
  action: MarkdownAction,
  state: EditorState,
): { enabled: boolean; active: boolean | null } {
  const head = state.selection.main.head;
  const literal = action.prose === true && isStrictlyInsideCode(state, head);
  const enabled = !literal && (action.applicable?.(state) ?? true);
  const active = action.active ? enabled && action.active(state) : null;
  return { enabled, active };
}
