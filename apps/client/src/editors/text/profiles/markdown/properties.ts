// Il frontmatter come proprietà. In Live, lontano dal cursore, diventa una
// tabella (`visible`) o una riga sola (`hidden`); un click riapre lo YAML,
// che resta l'unica cosa che si scrive. Due gesti lo scrivono senza mouse:
// `Mod-;` apre una riga nuova per una proprietà, `Alt-↑/↓` sulla riga di una
// chiave sposta la voce intera, con le righe rientrate che le appartengono.
import {
  EditorState,
  StateField,
  Transaction,
  type Extension,
  type StateCommand,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { t } from "../../../../i18n/strings";
import { propertiesDisplay } from "../../properties-display";
import { frontmatterRange } from "./render";

/// Una voce del frontmatter: la riga della chiave e le righe rientrate che la
/// seguono. `from`/`to` coprono righe intere, senza l'a capo finale.
export interface PropertyEntry {
  readonly key: string;
  readonly value: string;
  readonly from: number;
  readonly to: number;
  /// Il numero della riga della chiave.
  readonly line: number;
}

export interface PropertyBlock {
  /// Dalla riga di apertura alla fine di quella di chiusura.
  readonly from: number;
  readonly to: number;
  /// La riga di chiusura (`---` o `...`).
  readonly closing: number;
  readonly entries: readonly PropertyEntry[];
}

const KEY_LINE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#:"'-][^:]*?|-[^\s:][^:]*?))\s*:(?:\s+(.*))?$/;

function unquote(text: string): string {
  const value = text.trim();
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) return value.slice(1, -1).replace(/\\"/g, "\"");
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

/// Ciò che una voce dice, in una riga: una lista diventa `a, b`, un testo su
/// più righe una riga sola. È una lettura per gli occhi, non un parser YAML:
/// il valore vero resta nel testo.
function display(head: string, rest: readonly string[]): string {
  const value = head.trim();
  if (/^[|>][+-]?\d*$/.test(value)) return rest.map((line) => line.trim()).filter(Boolean).join(" ");
  if (value === "") {
    const items = rest.map((line) => line.trim()).filter(Boolean);
    if (items.length > 0 && items.every((item) => item.startsWith("- ") || item === "-")) {
      return items.map((item) => unquote(item.slice(1))).filter(Boolean).join(", ");
    }
    return items.join(" ");
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1).split(",").map(unquote).filter(Boolean).join(", ");
  }
  return unquote(value);
}

/// Il frontmatter in cima al documento, voce per voce; `null` se non c'è.
export function propertyBlock(state: EditorState): PropertyBlock | null {
  const range = frontmatterRange(state.doc);
  if (!range) return null;
  const doc = state.doc;
  const opening = doc.lineAt(range.from);
  const closing = doc.lineAt(range.to > 0 && doc.sliceString(range.to - 1, range.to) === "\n" ? range.to - 1 : range.to);
  const entries: PropertyEntry[] = [];
  let current: { key: string; head: string; rest: string[]; from: number; to: number; line: number } | null = null;
  const close = () => {
    if (current) entries.push({ key: current.key, value: display(current.head, current.rest), from: current.from, to: current.to, line: current.line });
    current = null;
  };
  for (let number = opening.number + 1; number < closing.number; number++) {
    const line = doc.line(number);
    const text = line.text;
    const indented = /^[ \t]/.test(text) || text === "-" || text.startsWith("- ");
    if (indented && text.trim() !== "") {
      if (current) {
        current.rest.push(text);
        current.to = line.to;
      }
      continue;
    }
    close();
    if (text.trim() === "" || text.startsWith("#")) continue;
    const match = KEY_LINE.exec(text);
    if (!match) continue;
    const key = match[1] !== undefined ? match[1].replace(/\\"/g, "\"")
      : match[2] !== undefined ? match[2].replace(/''/g, "'")
      : match[3]!.trim();
    current = { key, head: match[4] ?? "", rest: [], from: line.from, to: line.to, line: number };
  }
  close();
  return { from: opening.from, to: closing.to, closing: closing.number, entries };
}

/// Il frontmatter è coperto dal widget? Lo è finché nessuna selezione ci
/// entra; un cursore *prima* dell'apertura non lo apre.
function folded(state: EditorState, block: PropertyBlock): boolean {
  if (state.facet(propertiesDisplay) === "source") return false;
  return !state.selection.ranges.some((range) => range.to > block.from && range.from <= block.to);
}

class PropertiesWidget extends WidgetType {
  constructor(readonly mode: "visible" | "hidden", readonly entries: readonly PropertyEntry[]) {
    super();
  }

  override eq(other: PropertiesWidget): boolean {
    return other.mode === this.mode && other.entries.length === this.entries.length
      && other.entries.every((entry, index) => {
        const mine = this.entries[index]!;
        return entry.key === mine.key && entry.value === mine.value && entry.from === mine.from;
      });
  }

  toDOM(): HTMLElement {
    const root = document.createElement("div");
    root.className = `cm-fub-properties cm-fub-properties-${this.mode}`;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", t("editor.properties.label"));
    root.title = t("editor.properties.edit");
    if (this.mode === "hidden") {
      root.textContent = t("editor.properties.folded", { count: String(this.entries.length) });
      return root;
    }
    if (this.entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cm-fub-properties-empty";
      empty.textContent = t("editor.properties.empty");
      root.append(empty);
      return root;
    }
    const list = document.createElement("dl");
    for (const entry of this.entries) {
      const row = document.createElement("div");
      row.className = "cm-fub-properties-row";
      row.dataset.at = String(entry.from);
      const key = document.createElement("dt");
      key.textContent = entry.key;
      const value = document.createElement("dd");
      value.textContent = entry.value;
      row.append(key, value);
      list.append(row);
    }
    root.append(list);
    return root;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

interface PropertiesState {
  readonly block: PropertyBlock | null;
  readonly decorations: DecorationSet;
}

function decorate(state: EditorState, block: PropertyBlock | null): PropertiesState {
  if (!block || !folded(state, block)) return { block, decorations: Decoration.none };
  const mode = state.facet(propertiesDisplay) === "hidden" ? "hidden" : "visible";
  const widget = new PropertiesWidget(mode, block.entries);
  return { block, decorations: Decoration.set([Decoration.replace({ block: true, widget }).range(block.from, block.to)]) };
}

const properties = StateField.define<PropertiesState>({
  create: (state) => decorate(state, propertyBlock(state)),
  update(value, transaction) {
    const display = transaction.startState.facet(propertiesDisplay) !== transaction.state.facet(propertiesDisplay);
    if (!transaction.docChanged && !transaction.selection && !display) return value;
    return decorate(transaction.state, transaction.docChanged ? propertyBlock(transaction.state) : value.block);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/// Col widget al posto del frontmatter, il cursore all'inizio del documento
/// sta *prima* dell'apertura: ciò che si scrive lì andrebbe sopra `---` e
/// farebbe del frontmatter testo qualunque, senza che lo si veda. Il testo
/// scende sotto la chiusura; un `Canc` lì non mangia il `---`.
const guardOpening = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || !(transaction.isUserEvent("input") || transaction.isUserEvent("delete"))) return transaction;
  const before = transaction.startState.field(properties, false);
  const block = before?.block;
  if (!block || before.decorations.size === 0) return transaction;
  // `null`: nessuna modifica tocca il frontmatter; `""`: una lo cancella o
  // ce n'è più d'una, e la transazione non passa.
  const seen: { inserted: string | null } = { inserted: null };
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    if (fromA > block.to || toA < block.from) return;
    const pure = fromA === block.from && toA === block.from && seen.inserted === null;
    seen.inserted = pure ? text.toString() : "";
  });
  const inserted = seen.inserted;
  if (inserted === null) return transaction;
  if (inserted === "") return {};
  const doc = transaction.startState.doc;
  const at = block.to < doc.length ? block.to + 1 : block.to;
  const insert = block.to < doc.length ? inserted : `\n${inserted}`;
  return {
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    scrollIntoView: true,
    userEvent: transaction.annotation(Transaction.userEvent) ?? "input",
  };
});

/// Un click sul widget porta il cursore nella riga della proprietà toccata,
/// o nella prima del frontmatter: lo YAML si riapre lì.
const openOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const target = event.target instanceof Element ? event.target : null;
    const widget = target?.closest(".cm-fub-properties");
    if (!widget || !view.contentDOM.contains(widget)) return false;
    const block = view.state.field(properties).block;
    if (!block) return false;
    event.preventDefault();
    const row = target?.closest<HTMLElement>(".cm-fub-properties-row");
    const doc = view.state.doc;
    const at = row?.dataset.at !== undefined ? Number(row.dataset.at) : NaN;
    const anchor = Number.isSafeInteger(at) && at >= block.from && at <= block.to
      ? doc.lineAt(at).to
      : doc.line(Math.min(doc.lineAt(block.from).number + 1, block.closing)).from;
    view.dispatch({ selection: { anchor }, scrollIntoView: true, userEvent: "select.pointer" });
    view.focus();
    return true;
  },
});

/// `Mod-;`: una riga vuota per una proprietà nuova, prima della chiusura del
/// frontmatter; senza frontmatter, lo crea in cima. Il cursore ci entra, e lo
/// YAML si apre per scriverla.
export const addProperty: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const block = propertyBlock(state);
  if (!block) {
    const at = state.doc.sliceString(0, 1) === "﻿" ? 1 : 0;
    const insert = "---\n\n---\n";
    dispatch(state.update({ changes: { from: at, insert }, selection: { anchor: at + 4 }, scrollIntoView: true, userEvent: "input" }));
    return true;
  }
  const closing = state.doc.line(block.closing);
  const previous = state.doc.line(block.closing - 1);
  if (previous.number > state.doc.lineAt(block.from).number && previous.text.trim() === "") {
    dispatch(state.update({ selection: { anchor: previous.from }, scrollIntoView: true, userEvent: "select" }));
    return true;
  }
  dispatch(state.update({
    changes: { from: closing.from, insert: "\n" },
    selection: { anchor: closing.from },
    scrollIntoView: true,
    userEvent: "input",
  }));
  return true;
};

/// Toglie tutto il frontmatter, con l'a capo che lo segue: come
/// `note.properties.clear`, ma nel buffer, e un annullo lo rimette.
export const clearProperties: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const block = propertyBlock(state);
  if (!block) return false;
  const to = state.doc.sliceString(block.to, block.to + 1) === "\n" ? block.to + 1 : block.to;
  dispatch(state.update({ changes: { from: block.from, to }, selection: { anchor: block.from }, scrollIntoView: true, userEvent: "delete" }));
  return true;
};

/// Il valore di una proprietà, come lo legge il widget; `null` se non c'è.
export function propertyValue(state: EditorState, key: string): string | null {
  return propertyBlock(state)?.entries.find((entry) => entry.key === key)?.value ?? null;
}

/// Un valore YAML su una riga: fra virgolette quando, nudo, YAML lo leggerebbe
/// come un'altra cosa (un `#` di commento, `: `, un segno iniziale riservato,
/// spazi ai bordi, `true`, un numero).
function scalar(value: string, inList = false): string {
  const plain = value !== "" && value.trim() === value
    && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)
    && !(inList && /[,[\]{}]/.test(value))
    && !/: |\s#/.test(value)
    && !/^(?:true|false|yes|no|on|off|null|~|[-+]?\d[\d._]*)$/i.test(value);
  return plain ? value : `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

/// Scrive (o toglie, con `null`) la proprietà `key`, con tutte le righe della
/// voce che c'era; senza frontmatter lo crea in cima. È la modifica, da
/// mandare con una transazione: chi chiama sceglie l'evento.
export function setProperty(state: EditorState, key: string, value: string | readonly string[] | null): { from: number; to: number; insert: string } | null {
  const text = value === null ? null
    : typeof value === "string" ? `${key}: ${scalar(value)}`
    : `${key}: [${value.map((item) => scalar(item, true)).join(", ")}]`;
  const block = propertyBlock(state);
  if (!block) {
    if (text === null) return null;
    const at = state.doc.sliceString(0, 1) === "\ufeff" ? 1 : 0;
    return { from: at, to: at, insert: `---\n${text}\n---\n` };
  }
  const entry = block.entries.find((item) => item.key === key);
  if (entry) {
    if (text === null) {
      const to = entry.to < state.doc.length ? entry.to + 1 : entry.to;
      return { from: entry.from, to, insert: "" };
    }
    return { from: entry.from, to: entry.to, insert: text };
  }
  if (text === null) return null;
  const closing = state.doc.line(block.closing);
  return { from: closing.from, to: closing.from, insert: `${text}\n` };
}

/// Le voci di una proprietà a elenco (`[a, b]` o una per riga), una per una.
export function propertyList(state: EditorState, key: string): string[] {
  const value = propertyValue(state, key);
  return value === null ? [] : value.split(/,\s*|\s+/).map((item) => item.trim()).filter(Boolean);
}

/// La voce sulla cui riga di chiave sta l'unico cursore, con le vicine.
function entryAtCursor(state: EditorState): { block: PropertyBlock; index: number } | null {
  if (state.selection.ranges.length !== 1) return null;
  const head = state.selection.main;
  const block = propertyBlock(state);
  if (!block) return null;
  const line = state.doc.lineAt(head.head).number;
  if (state.doc.lineAt(head.anchor).number !== line) return null;
  const index = block.entries.findIndex((entry) => entry.line === line);
  return index === -1 ? null : { block, index };
}

function swapEntries(doc: Text, first: PropertyEntry, second: PropertyEntry): string {
  return doc.sliceString(second.from, second.to) + doc.sliceString(first.to, second.from) + doc.sliceString(first.from, first.to);
}

/// Sposta la voce del cursore prima o dopo la vicina, con tutte le sue righe.
/// Fuori da una riga di chiave non fa nulla e lascia `Alt-↑/↓` alle righe;
/// sulla prima o sull'ultima voce trattiene il tasto, che altrimenti
/// porterebbe la chiave fuori dal frontmatter.
export function moveProperty(direction: -1 | 1): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const found = entryAtCursor(state);
    if (!found) return false;
    const { block, index } = found;
    const other = block.entries[index + direction];
    if (!other) return true;
    const entry = block.entries[index]!;
    const [first, second] = direction === -1 ? [other, entry] : [entry, other];
    const offset = state.selection.main.head - entry.from;
    const insert = swapEntries(state.doc, first, second);
    // Il testo nuovo è «seconda, ciò che stava in mezzo, prima».
    const start = direction === -1 ? first.from : first.from + (second.to - second.from) + (second.from - first.to);
    dispatch(state.update({
      changes: { from: first.from, to: second.to, insert },
      selection: { anchor: start + offset },
      scrollIntoView: true,
      userEvent: "move.line",
    }));
    return true;
  };
}

/// Si può spostare la voce del cursore in quella direzione?
export function canMoveProperty(direction: -1 | 1): (state: EditorState) => boolean {
  return (state) => {
    const found = entryAtCursor(state);
    return found !== null && found.block.entries[found.index + direction] !== undefined;
  };
}

const theme = EditorView.baseTheme({
  ".cm-fub-properties": {
    cursor: "text",
    margin: "0 0 0.6em",
    padding: "0.5em 0.75em",
    borderRadius: "var(--radius-sm, 4px)",
    background: "var(--doc-fill-soft, rgba(135, 135, 135, 0.08))",
    fontSize: "0.9em",
    lineHeight: "var(--leading-normal, 1.5)",
  },
  ".cm-fub-properties-hidden, .cm-fub-properties-empty": {
    color: "var(--doc-muted, var(--doc-gutter-fg, inherit))",
  },
  ".cm-fub-properties dl": { margin: "0", display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "1em" },
  ".cm-fub-properties-row": { display: "contents" },
  ".cm-fub-properties dt": { color: "var(--doc-muted, var(--doc-gutter-fg, inherit))", fontWeight: "500" },
  ".cm-fub-properties dd": { margin: "0", overflowWrap: "anywhere" },
});

export function propertiesExtension(): Extension {
  return [properties, guardOpening, openOnClick, theme];
}
