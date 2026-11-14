// Le sorgenti del lanciatore: per ogni modo, che cosa c'è da scegliere.
//
// Ogni modo chiede a chi già sa (il canale dati, il registro dei comandi, la
// memoria delle recenti, le persone, la superficie attiva) e restituisce righe
// pronte da disegnare, oppure la frase che dice perché non ce ne sono. Qui non
// c'è DOM e non c'è gara: chi chiama decide se una risposta è ancora quella
// attesa.
//
// «Tutto» è la somma di tre gruppi: le note per nome, il testo delle note e i
// titoli della nota aperta. Un gruppo è una riga d'intestazione (`group`) che
// non si sceglie: le frecce la saltano.
import type { Span } from "../../../host/contract";
import { api } from "../../../host/ipc";
import {
  SearchSyntaxError,
  WITHOUT_PAGE,
  matchingDocuments,
  notesByName,
  searchExpression,
  vaultStatus,
  vaultTags,
} from "../../../host/query";
import { t } from "../../../i18n/strings";
import { pageName } from "../../../rules/mirrored";
import { charToByteIndex } from "../../../rules/offsets";
import { searchedName } from "../../../rules/searched-name";
import type { SlashSection } from "../../../editors/core/editor-menu";
import { slashCatalog } from "../../../panels/slash/entries";
import { paneOf } from "../../../state/document-controller";
import { activeDoc, layout } from "../../../state/layout";
import { paletteHost } from "../../../state/palette-host";
import { searchPeople, peopleFolder } from "../../../state/people";
import { existingRecentNotes } from "../../../state/recent";
import { openVaultRoot, state, vaultArg } from "../../../state/store";
import { allCommands, type CommandEntry } from "../../../ui/commands";
import { filterCommands, orderCommands, paletteHistoryForTest, viewEntries } from "../../../ui/palette";
import { filterByText, linePlace, lineTarget, type Mode } from "./model";

/// Il comando del kernel che crea una nota da un modello. Il lanciatore non
/// ha più un modo dei modelli: lo lancia il comando «Nuova nota da un modello».
export const TEMPLATE_COMMAND = "note.from_template";
/// Quanti risultati mostra una ricerca nel testo: il resto si dice nel conto.
export const SEARCH_LIMIT = 50;
/// Quante righe mostra un elenco che si filtra di qua.
export const LIST_LIMIT = 200;
/// I comandi che «Tutto» offre per la nota aperta, a campo vuoto.
export const NOTE_COMMANDS: readonly string[] = ["note.export", "note.duplicate", "note.subpage"];
/// Le sezioni del «/» che sono blocchi da inserire nella nota, nel loro ordine.
const BLOCK_SECTIONS: readonly SlashSection[] = ["text", "lists", "blocks", "code", "media", "page"];

/// Le azioni di una riga (Tab): qui, a lato, rinomina, copia il link, appunta.
/// La sbirciata non c'è ancora: le azioni la aggiungeranno.
export type ActionId = "open" | "split" | "rename" | "copy-link" | "pin";

/// Perché una nota è in elenco: fra le recenti, per nome, o per il suo testo.
/// Solo chi viene dal testo lascia una ricerca fra le recenti.
export type NoteHit = "recent" | "name" | "text";

export type Row =
  | { kind: "group"; key: string; title: string }
  | { kind: "note"; key: string; doc: string; hit: NoteHit; at: number | null; snippet: { text: string; highlights: Span[] } | null }
  | { kind: "command"; key: string; entry: CommandEntry }
  | { kind: "heading"; key: string; doc: string; level: number; text: string; at: number }
  | { kind: "tag"; key: string; name: string; count: number }
  | { kind: "line"; key: string; doc: string; line: number; column: number | null; lines: number; at: number }
  | { kind: "person"; key: string; doc: string }
  | { kind: "create-person"; key: string; name: string }
  | { kind: "block"; key: string; entry: CommandEntry }
  | { kind: "help"; key: string; entry: CommandEntry }
  | { kind: "action"; key: string; action: ActionId; doc: string; title: string; keys: string | null };

export interface Listing {
  rows: Row[];
  /// Che cosa dire quando non c'è niente da scegliere.
  note: string | null;
  /// Quanti sono in tutto, quando se ne mostra solo una parte.
  total: number | null;
}

/// Una riga che si sceglie: le intestazioni dei gruppi no.
export function selectable(row: Row): boolean {
  return row.kind !== "group";
}

const nothing = (note: string): Listing => ({ rows: [], note, total: null });
const listed = (rows: Row[], total: number | null = null): Listing => ({ rows, note: null, total });
const group = (id: string, title: string): Row => ({ kind: "group", key: `g:${id}`, title });
const noteRow = (doc: string, hit: NoteHit, at: number | null, snippet: Extract<Row, { kind: "note" }>["snippet"]): Row => ({
  kind: "note",
  key: `n:${doc}`,
  doc,
  hit,
  at,
  snippet,
});

/// Le prime righe di un elenco lungo, col conto di quelle scelte. Un gruppo
/// che resta senza righe in coda si toglie.
function capped(rows: Row[]): Listing {
  const picked = rows.filter(selectable).length;
  if (picked <= LIST_LIMIT) return listed(rows);
  const kept: Row[] = [];
  let seen = 0;
  for (const row of rows) {
    if (selectable(row)) {
      if (seen === LIST_LIMIT) break;
      seen += 1;
    }
    kept.push(row);
  }
  while (kept.length > 0 && !selectable(kept[kept.length - 1]!)) kept.pop();
  return listed(kept, picked);
}

/// Il testo della scheda attiva, se è un testo: è la superficie a saperlo, e
/// una vista o un'immagine non hanno righe a cui andare.
function activeText(): { doc: string; text: string } | null {
  const doc = activeDoc();
  const pane = paneOf(layout.focus);
  if (!doc || pane?.shown?.k !== "doc" || pane.shown.doc !== doc) return null;
  const text = pane.surface?.buffer?.getDoc();
  return text === undefined ? null : { doc, text };
}

/// I titoli della nota attiva che contengono la domanda.
async function headingRows(doc: string, text: string): Promise<Row[]> {
  const answer = await api.queryIndex({ kind: "outline", doc }, ...vaultArg(openVaultRoot()));
  const all = answer.kind === "outline" ? answer.value : [];
  return filterByText(all, text, (heading) => heading.text).map((heading) => ({
    kind: "heading",
    key: `h:${heading.span.start}`,
    doc,
    level: heading.level,
    text: heading.text,
    at: heading.span.start,
  }));
}

/// «Tutto», a campo vuoto: le note recenti e tre comandi per la nota aperta.
/// Con un testo: le note il cui nome lo contiene, le note che lo contengono
/// nel testo (senza ripetere le prime) e i titoli della nota aperta.
async function everything(text: string): Promise<Listing> {
  if (!state.vaultRoot) return nothing(t("launcher.note.no_vault"));
  const written = text.trim();
  const doc = activeDoc();
  if (written === "") {
    const rows: Row[] = [];
    const recent = await existingRecentNotes();
    if (recent.length > 0) {
      rows.push(group("recent", t("launcher.group.recent")));
      rows.push(...recent.map((each) => noteRow(each, "recent", null, null)));
    }
    const entries = allCommands();
    const here = doc
      ? NOTE_COMMANDS.flatMap((id) => {
        const entry = entries.find((each) => each.id === id);
        return entry ? [entry] : [];
      })
      : [];
    if (here.length > 0) {
      rows.push(group("here", t("launcher.group.here")));
      rows.push(...here.map((entry): Row => ({ kind: "command", key: `c:${entry.id}`, entry })));
    }
    if (rows.length === 0) return nothing(t("launcher.note.all"));
    return capped(rows);
  }

  const names = await notesByName(written);
  const named = new Set(names);
  const rows: Row[] = [];
  if (names.length > 0) {
    rows.push(group("notes", t("launcher.group.notes")));
    rows.push(...names.map((each) => noteRow(each, "name", null, null)));
  }
  let syntax: string | null = null;
  const inText: Row[] = [];
  try {
    const page = await matchingDocuments(searchExpression(written), { offset: 0, limit: SEARCH_LIMIT });
    for (const match of page.items) {
      if (named.has(match.doc)) continue;
      inText.push(noteRow(
        match.doc,
        "text",
        match.occurrences?.[0]?.span.start ?? null,
        match.snippet ? { text: match.snippet, highlights: match.highlights ?? [] } : null,
      ));
    }
  } catch (error) {
    // Una sintassi a metà è normale mentre si scrive: si dice, non è un guasto.
    if (!(error instanceof SearchSyntaxError)) throw error;
    syntax = error.message;
  }
  if (inText.length > 0) {
    rows.push(group("text", t("launcher.group.text")));
    rows.push(...inText);
  }
  // I titoli sono un gruppo in più: se l'indice non li dà, le note restano
  // dove sono, e chi cerca una nota non perde il suo risultato per un titolo.
  const headings = doc ? await headingRows(doc, written).catch(() => []) : [];
  if (headings.length > 0) {
    rows.push(group("headings", t("launcher.group.headings")));
    rows.push(...headings);
  }
  if (rows.length === 0) {
    if (syntax !== null) return nothing(syntax);
    const status = await vaultStatus();
    if (status.indexing === "running") return nothing(t("launcher.note.all.indexing"));
    // Il testo che può essere un nome di nota si propone con Maiusc-Invio.
    const name = searchedName(written);
    return nothing(
      name === null
        ? t("launcher.note.all.none", { query: written })
        : t("launcher.note.all.create", { query: written, name }),
    );
  }
  return capped(rows);
}

function commands(text: string): Listing {
  const entries = orderCommands([...allCommands(), ...viewEntries(paletteHost)], paletteHistoryForTest());
  const kept = filterCommands(entries, text);
  if (kept.length === 0) return nothing(t("launcher.note.commands.none", { query: text.trim() }));
  return listed(kept.map((entry) => ({ kind: "command", key: `c:${entry.id}`, entry })));
}

async function tags(text: string): Promise<Listing> {
  if (!state.vaultRoot) return nothing(t("launcher.note.no_vault"));
  const all = await vaultTags(WITHOUT_PAGE);
  if (all.length === 0) return nothing(t("launcher.note.tags"));
  const kept = filterByText(all, text, (tag) => tag.name, true);
  if (kept.length === 0) return nothing(t("launcher.note.tags.none", { query: text.trim() }));
  return capped(kept.map((tag) => ({ kind: "tag", key: `t:${tag.name}`, name: tag.name, count: tag.count })));
}

/// Le persone della cartella delle persone il cui nome contiene la domanda.
/// Con una domanda che non è ancora una persona, la riga in fondo la crea.
async function people(text: string): Promise<Listing> {
  if (!state.vaultRoot) return nothing(t("launcher.note.no_vault"));
  if (peopleFolder() === "") return nothing(t("launcher.note.people.off"));
  const written = text.trim();
  const found = await searchPeople(written);
  const rows: Row[] = found.map((doc) => ({ kind: "person", key: `p:${doc}`, doc }));
  const name = searchedName(written);
  if (name !== null && !found.some((doc) => pageName(doc).toLowerCase() === name.toLowerCase())) {
    rows.push({ kind: "create-person", key: `P:${name}`, name });
  }
  if (rows.length === 0) {
    return nothing(written === "" ? t("launcher.note.people") : t("launcher.note.people.none", { query: written }));
  }
  return capped(rows);
}

/// I blocchi che il «/» della nota aperta offre: quelli che la superficie sa
/// fare adesso. Sono le azioni `markdown.*` del registro, che la shell esegue
/// sulla superficie col fuoco: nessun gesto nuovo per inserirli.
function blocks(text: string): Listing {
  if (!activeText()) return nothing(t("launcher.note.blocks.no_text"));
  const entries = allCommands();
  const offered = slashCatalog(state.commandSpecs, (id) => id.startsWith("markdown.") && entries.some((each) => each.id === id))
    .listed.filter((each) => each.action && BLOCK_SECTIONS.includes(each.section))
    .sort((left, right) => BLOCK_SECTIONS.indexOf(left.section) - BLOCK_SECTIONS.indexOf(right.section));
  const found = offered.flatMap((each) => {
    const entry = entries.find((candidate) => candidate.id === each.id);
    return entry ? [entry] : [];
  });
  const kept = filterCommands(found, text);
  if (kept.length === 0) return nothing(t("launcher.note.blocks.none", { query: text.trim() }));
  return capped(kept.map((entry) => ({ kind: "block", key: `b:${entry.id}`, entry })));
}

/// Ciò che si può fare qui, con il suo tasto: i comandi che hanno un accordo
/// adesso, col tasto che vale davvero (anche quello cambiato dall'utente).
function help(text: string): Listing {
  const bound = allCommands().filter((entry) => entry.binding !== null && !entry.unavailable);
  const kept = filterCommands(bound, text);
  if (kept.length === 0) {
    return nothing(text.trim() === "" ? t("launcher.note.help") : t("launcher.note.help.none", { query: text.trim() }));
  }
  return capped(kept.map((entry) => ({ kind: "help", key: `k:${entry.id}`, entry })));
}

function line(text: string): Listing {
  const active = activeText();
  if (!active) return nothing(t("launcher.note.line.no_text"));
  const target = lineTarget(text);
  if (!target) {
    return nothing(t("launcher.note.line", { lines: linePlace(active.text, { line: 1, column: null }).lines }));
  }
  const place = linePlace(active.text, target);
  return listed([{
    kind: "line",
    key: "line",
    doc: active.doc,
    line: place.line,
    column: place.column,
    lines: place.lines,
    at: charToByteIndex(active.text, place.char),
  }]);
}

/// Che cosa un modo offre per una domanda. Chi risponde senza aspettare
/// nessuno (`answersAtOnce`) rende l'elenco, gli altri una promessa.
export function listing(mode: Mode, text: string): Listing | Promise<Listing> {
  switch (mode) {
    case "all":
      return everything(text);
    case "commands":
      return commands(text);
    case "tags":
      return tags(text);
    case "people":
      return people(text);
    case "blocks":
      return blocks(text);
    case "help":
      return help(text);
    case "line":
      return line(text);
  }
}

/// I modi che rispondono senza aspettare nessuno: non trattengono le battute
/// e non hanno un'attesa da dire.
export function answersAtOnce(mode: Mode): boolean {
  return mode === "commands" || mode === "blocks" || mode === "help" || mode === "line";
}
