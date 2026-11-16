// Il frontmatter come proprietà. In Live, lontano dal cursore, diventa una
// tabella (`visible`) o una riga sola (`hidden`); un click riapre lo YAML,
// che resta l'unica cosa che si scrive. Due gesti lo scrivono senza mouse:
// `Mod-;` apre una riga nuova per una proprietà, `Alt-↑/↓` sulla riga di una
// chiave sposta la voce intera, con le righe rientrate che le appartengono.
// In Scrittura le proprietà le mostra la testata della pagina
// (`page/header.ts`, `headerShowsProperties`): qui resta lo YAML.
import {
  EditorState,
  Facet,
  StateField,
  Transaction,
  type Extension,
  type StateCommand,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { t } from "../../../../i18n/strings";
import { withLineBreaks } from "../../line-breaks";
import { propertiesDisplay } from "../../properties-display";
import { frontmatterRange } from "./render";

/// Una voce del frontmatter: la riga della chiave e le righe rientrate che la
/// seguono. `from`/`to` coprono righe intere, senza l'a capo finale.
export interface PropertyEntry {
  readonly key: string;
  readonly value: string;
  /// Il valore si riscrive senza perdere niente: nessun commento, ancora,
  /// alias, etichetta o testo a blocco. Se no, chi lo cambia apre lo YAML.
  readonly simple: boolean;
  readonly from: number;
  readonly to: number;
  /// Il numero della riga della chiave.
  readonly line: number;
  /// Le voci, se il valore è un elenco (`[a, b]` o una per riga), senza
  /// virgolette; `null` per un valore che non è un elenco.
  readonly items: readonly string[] | null;
  /// Il rientro delle voci di un elenco scritto una per riga (`""` o `"  "`):
  /// chi lo riscrive tiene la forma. `null` per ogni altro valore.
  readonly blockIndent: string | null;
  /// Il valore è uno scalare fra virgolette: `"true"` è un testo, non un sì.
  readonly quoted: boolean;
}

export interface PropertyBlock {
  /// Dalla riga di apertura alla fine di quella di chiusura.
  readonly from: number;
  readonly to: number;
  /// La riga di chiusura (`---` o `...`).
  readonly closing: number;
  /// Le voci nell'ordine del file, anche due con la stessa chiave: YAML ne
  /// tiene l'ultima (`lastEntry`).
  readonly entries: readonly PropertyEntry[];
  /// YAML non lo legge (una riga che non è una chiave, una parentesi o una
  /// virgoletta aperta, un rientro a tabulazioni…): le voci qui sopra non
  /// dicono tutto, e il modello lo conserva come testo. Le regole sono quelle
  /// del modello, sulla fixture `frontmatter-readability.json`.
  readonly unreadable: boolean;
}

const KEY_LINE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#:"'-][^:]*?|-[^\s:][^:]*?))\s*:(?:\s+(.*))?$/;

/// Il valore senza ancora (`&img`) e senza etichetta di tipo (`!!str`).
function withoutProps(value: string): string {
  let text = value;
  for (;;) {
    const match = /^[&!]\S*(?:\s+|$)/.exec(text);
    if (!match) return text;
    text = text.slice(match[0].length);
  }
}

/// Un testo semplice senza il commento in coda (` # …`).
function withoutComment(text: string): string {
  const match = /(?:^|\s)#/.exec(text);
  return (match ? text.slice(0, match.index) : text).trim();
}

/// Dove finisce lo scalare fra virgolette che comincia in `text[0]`; -1 se
/// non si chiude.
function quotedEnd(text: string): number {
  const quote = text[0]!;
  for (let i = 1; i < text.length; i++) {
    const char = text[i];
    if (quote === "\"" && char === "\\") i++;
    else if (char === quote) {
      if (quote === "'" && text[i + 1] === "'") i++;
      else return i + 1;
    }
  }
  return -1;
}

/// Dove finisce l'elenco o la mappa in riga che comincia in `text[0]`; -1
/// se le parentesi non si chiudono.
function flowEnd(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if ((char === "\"" || char === "'") && /[\s[{,:]/.test(text[i - 1] ?? " ")) {
      const end = quotedEnd(text.slice(i));
      if (end < 0) return -1;
      i += end - 1;
    } else if (char === "#" && /\s/.test(text[i - 1] ?? " ")) {
      const newline = text.indexOf("\n", i);
      if (newline < 0) return -1;
      i = newline;
    } else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/// Dopo uno scalare chiuso possono stare solo spazi e un commento, anche
/// sulle righe seguenti della stessa voce.
function onlyComments(text: string): boolean {
  return text.split("\n").every((line) => /^\s*(?:#.*)?$/.test(line));
}

interface ValueReading {
  /// YAML non lo legge (`serde_yaml_ng`, come il modello).
  readonly unreadable: boolean;
  /// Si riscrive senza perdere niente: nessun commento, nessuna ancora,
  /// alias o etichetta, nessun testo a blocco.
  readonly simple: boolean;
}

/// Che cosa dice YAML del valore di una voce: `head` dopo i due punti, `rest`
/// le righe rientrate che seguono. Le stesse regole del modello, misurate
/// sulla fixture `frontmatter-readability.json`.
function readValue(head: string, rest: readonly string[]): ValueReading {
  const raw = head.trim();
  const value = withoutProps(raw);
  const props = value !== raw;
  const lines = rest.map((line) => line.trim());
  const comments = lines.some((line) => line.startsWith("#"));
  if (value === "") {
    // Un elenco o una mappa rientrati: semplice se ogni voce è `- valore`.
    const items = lines.filter(Boolean);
    const simple = !props && !comments && items.every((item) => /^-(?:\s|$)/.test(item) && !/\s#/.test(item) && !/^-\s+[&*!|>[{]/.test(item));
    return { unreadable: false, simple };
  }
  if (value.startsWith("\"") || value.startsWith("'")) {
    const joined = [value, ...lines].join("\n");
    const end = quotedEnd(joined);
    if (end < 0 || !onlyComments(joined.slice(end))) return { unreadable: true, simple: false };
    return { unreadable: false, simple: !props && end === value.length && lines.every((line) => line === "") };
  }
  if (value.startsWith("[") || value.startsWith("{")) {
    const joined = [value, ...lines].join("\n");
    const end = flowEnd(joined);
    if (end < 0 || !onlyComments(joined.slice(end))) return { unreadable: true, simple: false };
    return { unreadable: false, simple: !props && end === value.length && lines.every((line) => line === "") && !/\s#/.test(value) };
  }
  if (/^[|>]/.test(value)) return { unreadable: false, simple: false };
  if (value.startsWith("*")) return { unreadable: false, simple: false };
  // Uno scalare semplice, anche su più righe: un `: ` (o i due punti in
  // fondo) lo farebbe una mappa, che lì YAML non accetta.
  const plain = [value, ...lines.filter((line) => line !== "" && !line.startsWith("#"))];
  if (plain.some((line) => /:(?:\s|$)/.test(withoutComment(line)))) return { unreadable: true, simple: false };
  return { unreadable: false, simple: !props && !comments && lines.every((line) => line === "") && withoutComment(value) === value };
}

function unquote(text: string): string {
  const value = text.trim();
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) return value.slice(1, -1).replace(/\\"/g, "\"");
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

/// Un elemento di un elenco, per gli occhi: fra virgolette tolte, o senza
/// commento.
function item(text: string): string {
  const value = text.trim();
  return value.startsWith("\"") || value.startsWith("'") ? unquote(value) : withoutComment(value);
}

/// Ciò che una voce dice, in una riga: una lista diventa `a, b`, un testo su
/// più righe una riga sola, senza commenti. È una lettura per gli occhi, non
/// un parser YAML: il valore vero resta nel testo.
function display(head: string, rest: readonly string[]): string {
  const value = withoutProps(head.trim());
  const lines = rest.map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  if (/^[|>][+-]?\d*(?:\s+#.*)?$/.test(value)) return lines.join(" ");
  if (value === "") {
    if (lines.length > 0 && lines.every((line) => /^-(?:\s|$)/.test(line))) {
      return lines.map((line) => item(line.slice(1))).filter(Boolean).join(", ");
    }
    return lines.map(withoutComment).join(" ");
  }
  if (value.startsWith("[")) {
    const end = flowEnd(value);
    const inner = end > 0 ? value.slice(1, end - 1) : value.slice(1);
    return inner.split(",").map(item).filter(Boolean).join(", ");
  }
  if (value.startsWith("\"") || value.startsWith("'")) {
    const end = quotedEnd(value);
    return unquote(end > 0 ? value.slice(0, end) : value);
  }
  return [value, ...lines].map(withoutComment).filter(Boolean).join(" ");
}

/// Le voci di un elenco in riga, senza le parentesi: si divide alle virgole
/// fuori dalle virgolette e dalle parentesi annidate.
function flowItems(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i]!;
    if ((char === "\"" || char === "'") && /[\s[{,]/.test(inner[i - 1] ?? " ")) {
      const end = quotedEnd(inner.slice(i));
      if (end < 0) break;
      i += end - 1;
    } else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") depth--;
    else if (char === "," && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out.map(item).filter(Boolean);
}

/// Le voci di un elenco, e il rientro se è scritto una per riga; `null` per
/// un valore che non è un elenco.
function listOf(head: string, rest: readonly string[]): { items: string[]; indent: string | null } | null {
  const value = withoutProps(head.trim());
  if (value === "") {
    const lines = rest.filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
    if (lines.length === 0 || !lines.every((line) => /^\s*-(?:\s|$)/.test(line))) return null;
    const indent = /^\s*/.exec(lines[0]!)![0];
    return { items: lines.map((line) => item(line.trim().slice(1))).filter(Boolean), indent };
  }
  if (!value.startsWith("[")) return null;
  const end = flowEnd(value);
  return { items: flowItems(end > 0 ? value.slice(1, end - 1) : value.slice(1)), indent: null };
}

/// L'ultima voce con quella chiave: con due voci uguali YAML (e il modello)
/// tengono l'ultima.
export function lastEntry(entries: readonly PropertyEntry[], key: string): PropertyEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index]!.key === key) return entries[index];
  }
  return undefined;
}

/// Un blocco `---` … `---` in cima che il rilevatore del corpo non prende per
/// frontmatter (nessun `:` dentro: `- a`, `solo testo`). Il modello sì, e lo
/// conserva com'è perché non è una mappa: la testata lo dice illeggibile
/// invece di scriverne un altro sopra.
function bareFence(state: EditorState): PropertyBlock | null {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.replace(/^\uFEFF/, "").trim() !== "---") return null;
  const last = Math.min(doc.lines, 2000);
  for (let number = 2; number <= last; number++) {
    const text = doc.line(number).text.trim();
    if (text === "---" || text === "...") {
      return { from: 0, to: doc.line(number).to, closing: number, entries: [], unreadable: true };
    }
  }
  return null;
}

/// Il frontmatter in cima al documento, voce per voce; `null` se non c'è.
export function propertyBlock(state: EditorState): PropertyBlock | null {
  const range = frontmatterRange(state.doc);
  if (!range) return bareFence(state);
  const doc = state.doc;
  const opening = doc.lineAt(range.from);
  const closing = doc.lineAt(range.to > 0 && doc.sliceString(range.to - 1, range.to) === "\n" ? range.to - 1 : range.to);
  const entries: PropertyEntry[] = [];
  let unreadable = false;
  let current: { key: string; head: string; rest: string[]; blanks: number; from: number; to: number; line: number } | null = null;
  const close = () => {
    if (current) {
      const reading = readValue(current.head, current.rest);
      if (reading.unreadable) unreadable = true;
      const list = listOf(current.head, current.rest);
      const head = withoutProps(current.head.trim());
      entries.push({
        key: current.key,
        value: display(current.head, current.rest),
        simple: reading.simple,
        from: current.from,
        to: current.to,
        line: current.line,
        items: list?.items ?? null,
        blockIndent: list?.indent ?? null,
        quoted: head.startsWith("\"") || head.startsWith("'"),
      });
    }
    current = null;
  };
  for (let number = opening.number + 1; number < closing.number; number++) {
    const line = doc.line(number);
    const text = line.text;
    // YAML non rientra con le tabulazioni.
    if (text.startsWith("\t")) unreadable = true;
    // Una riga vuota non chiude la voce: un testo a blocco può averne dentro.
    if (text.trim() === "") {
      if (current) current.blanks++;
      continue;
    }
    // Rientrata, o un elemento d'elenco allo stesso rientro della chiave.
    if (/^[ \t]/.test(text) || /^-(?:\s|$)/.test(text)) {
      if (!current) {
        unreadable = true;
        continue;
      }
      for (; current.blanks > 0; current.blanks--) current.rest.push("");
      current.rest.push(text);
      current.to = line.to;
      continue;
    }
    close();
    if (text.startsWith("#")) continue;
    const match = KEY_LINE.exec(text);
    if (!match) {
      unreadable = true;
      continue;
    }
    const key = match[1] !== undefined ? match[1].replace(/\\"/g, "\"")
      : match[2] !== undefined ? match[2].replace(/''/g, "'")
      : match[3]!.trim();
    current = { key, head: match[4] ?? "", rest: [], blanks: 0, from: line.from, to: line.to, line: number };
  }
  close();
  return { from: opening.from, to: closing.to, closing: closing.number, entries, unreadable };
}

/// Il frontmatter è coperto dal widget? Lo è finché nessuna selezione ci
/// entra; un cursore *prima* dell'apertura non lo apre.
function folded(state: EditorState, block: PropertyBlock): boolean {
  if (state.facet(propertiesDisplay) === "source") return false;
  return !state.selection.ranges.some((range) => range.to > block.from && range.from <= block.to);
}

/// La testata della pagina mostra le proprietà (`page/header.ts`): chiuso, il
/// frontmatter non ha più un widget suo e sta tutto nella testata; illeggibile,
/// resta YAML sotto il titolo, e la testata lo dice.
export const headerShowsProperties = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

/// Il frontmatter si vede come YAML da scrivere: in `source`, o perché una
/// selezione ci è entrata.
export function frontmatterOpen(state: EditorState, block: PropertyBlock): boolean {
  return !folded(state, block);
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
  if (state.facet(headerShowsProperties)) {
    if (block.unreadable) return { block, decorations: Decoration.none };
    return { block, decorations: Decoration.set([Decoration.replace({ block: true }).range(block.from, block.to)]) };
  }
  const mode = state.facet(propertiesDisplay) === "hidden" ? "hidden" : "visible";
  const widget = new PropertiesWidget(mode, block.entries);
  return { block, decorations: Decoration.set([Decoration.replace({ block: true, widget }).range(block.from, block.to)]) };
}

const properties = StateField.define<PropertiesState>({
  create: (state) => decorate(state, propertyBlock(state)),
  update(value, transaction) {
    const display = transaction.startState.facet(propertiesDisplay) !== transaction.state.facet(propertiesDisplay)
      || transaction.startState.facet(headerShowsProperties) !== transaction.state.facet(headerShowsProperties);
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
  // Le voci fra le due righe `---` le scrive la testata della pagina (icona,
  // copertina, «Aggiungi una proprietà»): passano, perché non toccano né
  // l'apertura né la chiusura. Col frontmatter coperto nessun cursore ci sta,
  // e una battuta non ci arriva.
  const doc = transaction.startState.doc;
  const openingEnd = doc.lineAt(block.from).to;
  const closingFrom = doc.line(block.closing).from;
  const seen: { inserted: string | null } = { inserted: null };
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    if (fromA > block.to || toA < block.from) return;
    // Fino a `closingFrom` compreso solo da un inizio di riga: togliere l'a
    // capo prima della chiusura la attaccherebbe alla voce (`stato: x---`).
    if (fromA > openingEnd && (toA < closingFrom || (toA === closingFrom && fromA === doc.lineAt(fromA).from))) return;
    const pure = fromA === block.from && toA === block.from && seen.inserted === null;
    seen.inserted = pure ? text.toString() : "";
  });
  const inserted = seen.inserted;
  if (inserted === null) return transaction;
  if (inserted === "") return {};
  const at = block.to < doc.length ? block.to + 1 : block.to;
  // `inserted` va a capo con "\n" (`Text.toString`): la lunghezza è in posizioni.
  const insert = block.to < doc.length ? inserted : `\n${inserted}`;
  return {
    changes: { from: at, insert: withLineBreaks(transaction.startState, insert) },
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
    const row = target?.closest<HTMLElement>(".cm-fub-properties-row");
    const at = row?.dataset.at !== undefined ? Number(row.dataset.at) : null;
    if (!view.state.field(properties).block) return false;
    event.preventDefault();
    return openPropertyAt(view, at, "select.pointer");
  },
});

/// Riapre lo YAML alla fine della voce che comincia in `at`, o sulla prima
/// riga del frontmatter: il cursore ci entra, e il frontmatter si scrive.
/// `false` se la nota non ha frontmatter.
export function openPropertyAt(view: EditorView, at: number | null, userEvent = "select"): boolean {
  const block = propertyBlock(view.state);
  if (!block) return false;
  const doc = view.state.doc;
  const anchor = at !== null && Number.isSafeInteger(at) && at >= block.from && at <= block.to
    ? doc.lineAt(at).to
    : doc.line(Math.min(doc.lineAt(block.from).number + 1, block.closing)).from;
  view.dispatch({ selection: { anchor }, scrollIntoView: true, userEvent });
  view.focus();
  return true;
}

/// `Mod-;`: una riga vuota per una proprietà nuova, prima della chiusura del
/// frontmatter; senza frontmatter, lo crea in cima. Il cursore ci entra, e lo
/// YAML si apre per scriverla.
export const addProperty: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const block = propertyBlock(state);
  if (!block) {
    const at = state.doc.sliceString(0, 1) === "﻿" ? 1 : 0;
    const insert = withLineBreaks(state, "---\n\n---\n");
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
    changes: { from: closing.from, insert: state.lineBreak },
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
  const block = propertyBlock(state);
  return block ? lastEntry(block.entries, key)?.value ?? null : null;
}

/// Un valore YAML su una riga: fra virgolette quando, nudo, YAML lo leggerebbe
/// come un'altra cosa (un `#` di commento, `: `, un segno iniziale riservato,
/// spazi ai bordi, `true`, un numero, un a capo o un altro carattere di
/// controllo, che fra virgolette doppie si scrive `\n`, `\t`, `\uXXXX`).
function scalar(value: string, inList = false): string {
  const plain = value !== "" && value.trim() === value
    && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)
    && !(inList && /[,[\]{}]/.test(value))
    && !/: |\s#|:$/.test(value)
    && !CONTROL.test(value)
    && !/^(?:true|false|yes|no|on|off|null|~|[-+]?\d[\d._]*)$/i.test(value);
  if (plain) return value;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")
    .replace(CONTROLS, (char) => CONTROL_ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"${escaped}"`;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001f\u007f]/g;
const CONTROL_ESCAPES: Readonly<Record<string, string>> = { "\n": "\\n", "\t": "\\t", "\r": "\\r" };

/// Un valore che `setProperty` sa scrivere: un testo (vuoto, la chiave sola),
/// un numero o un sì/no YAML nudi, un elenco.
export type PropertyWrite = string | number | boolean | readonly string[];

/// La chiave come YAML la scrive: nuda se si legge uguale, se no fra
/// virgolette doppie.
function keyText(key: string): string {
  const plain = /^[^\s#:"'\-[\]{},&*!|>%@`?][^:#]*$/.test(key) && key.trim() === key && !CONTROL.test(key);
  return plain ? key : `"${key.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

/// Scrive (o toglie, con `null`) la proprietà `key`, con tutte le righe della
/// voce che c'era; un numero e un sì/no si scrivono come YAML li legge, non
/// fra virgolette; un testo vuoto lascia la chiave sola. Un elenco scritto una
/// voce per riga resta così, col suo rientro. Senza frontmatter lo crea in
/// cima. È la modifica, da mandare con una transazione: chi chiama sceglie
/// l'evento.
export function setProperty(state: EditorState, key: string, value: PropertyWrite | null): { from: number; to: number; insert: string } | null {
  const block = propertyBlock(state);
  const entry = block ? lastEntry(block.entries, key) : undefined;
  const first = entry ? state.doc.lineAt(entry.from).text : "";
  const name = entry && keyLength(first) > 0 ? first.slice(0, keyLength(first)) : keyText(key);
  const text = value === null ? null
    : typeof value === "number" ? `${name}: ${Number.isFinite(value) ? value : 0}`
    : typeof value === "boolean" ? `${name}: ${value}`
    : typeof value === "string" ? (value === "" ? `${name}:` : `${name}: ${scalar(value)}`)
    : entry?.blockIndent != null && value.length > 0
      ? `${name}:${value.map((item) => `\n${entry.blockIndent}- ${scalar(item, true)}`).join("")}`
      : `${name}: [${value.map((item) => scalar(item, true)).join(", ")}]`;
  return setPropertyText(state, block, entry, text);
}

/// Quanto è lunga la chiave in testa alla riga `line`, fino ai due punti
/// esclusi: la chiave resta scritta com'era (virgolette comprese).
function keyLength(line: string): number {
  if (!KEY_LINE.test(line)) return 0;
  if (line.startsWith("\"") || line.startsWith("'")) return Math.max(0, quotedEnd(line));
  return line.slice(0, line.indexOf(":")).trimEnd().length;
}

function setPropertyText(
  state: EditorState,
  block: PropertyBlock | null,
  entry: PropertyEntry | undefined,
  text: string | null,
): { from: number; to: number; insert: string } | null {
  if (!block) {
    if (text === null) return null;
    const at = state.doc.sliceString(0, 1) === "\ufeff" ? 1 : 0;
    return { from: at, to: at, insert: withLineBreaks(state, `---\n${text}\n---\n`) };
  }
  if (entry) {
    if (text === null) {
      const to = entry.to < state.doc.length ? entry.to + 1 : entry.to;
      return { from: entry.from, to, insert: "" };
    }
    return { from: entry.from, to: entry.to, insert: withLineBreaks(state, text) };
  }
  if (text === null) return null;
  const closing = state.doc.line(block.closing);
  return { from: closing.from, to: closing.from, insert: `${withLineBreaks(state, text)}${state.lineBreak}` };
}

/// Rinomina la chiave della voce `key` nel frontmatter, senza toccare il
/// valore: la modifica, o `null` se la voce non c'è o il nome nuovo è vuoto.
export function renamePropertyKey(state: EditorState, key: string, name: string): { from: number; to: number; insert: string } | null {
  const block = propertyBlock(state);
  const entry = block ? lastEntry(block.entries, key) : undefined;
  const next = name.trim();
  if (!entry || next === "" || next === key) return null;
  const line = state.doc.lineAt(entry.from);
  const length = keyLength(line.text);
  if (length === 0) return null;
  return { from: line.from, to: line.from + length, insert: keyText(next) };
}

/// Sposta la voce `key`, con tutte le sue righe, prima della voce `before`;
/// con `null` in fondo, prima della chiusura. La modifica, o `null` se non
/// cambia niente.
export function moveEntryBefore(state: EditorState, key: string, before: string | null): { from: number; to: number; insert: string }[] | null {
  const block = propertyBlock(state);
  if (!block) return null;
  const entry = lastEntry(block.entries, key);
  if (!entry) return null;
  const target = before === null ? null : lastEntry(block.entries, before);
  if (before !== null && !target) return null;
  if (target === entry) return null;
  const doc = state.doc;
  const at = target ? target.from : doc.line(block.closing).from;
  const end = entry.to < doc.length ? entry.to + 1 : entry.to;
  // Già lì: la voce sta subito prima del posto (o è l'ultima).
  if (end === at) return null;
  const text = doc.sliceString(entry.from, entry.to) + state.lineBreak;
  return [
    { from: entry.from, to: end, insert: "" },
    { from: at, to: at, insert: text },
  ];
}

/// Le voci di una proprietà a elenco (`[a, b]` o una per riga), una per una.
export function propertyList(state: EditorState, key: string): string[] {
  return listItems(propertyValue(state, key));
}

/// Le voci di un valore letto (`a, b`), una per una.
export function listItems(value: string | null): string[] {
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
    // Il testo con "\n": `start` e `offset` sono posizioni del documento.
    const insert = swapEntries(state.doc, first, second);
    // Il testo nuovo è «seconda, ciò che stava in mezzo, prima».
    const start = direction === -1 ? first.from : first.from + (second.to - second.from) + (second.from - first.to);
    dispatch(state.update({
      changes: { from: first.from, to: second.to, insert: withLineBreaks(state, insert) },
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
