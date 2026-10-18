// Le sorgenti del lanciatore: per ogni modo, che cosa c'è da scegliere.
//
// Ogni modo chiede a chi già sa (il canale dati, il registro dei comandi, la
// memoria delle recenti, la superficie attiva) e restituisce righe pronte da
// disegnare, oppure la frase che dice perché non ce ne sono. Qui non c'è DOM
// e non c'è gara: chi chiama decide se una risposta è ancora quella attesa.
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
import { paneOf } from "../../../state/document-controller";
import { activeDoc, layout } from "../../../state/layout";
import { paletteHost } from "../../../state/palette-host";
import { existingRecentNotes, recentSearches } from "../../../state/recent";
import { openVaultRoot, state, vaultArg } from "../../../state/store";
import { allCommands, type CommandEntry } from "../../../ui/commands";
import { filterCommands, orderCommands, paletteHistoryForTest, viewEntries } from "../../../ui/palette";
import { filterByText, linePlace, lineTarget, type Mode } from "./model";

/// Il comando del kernel che crea una nota da un modello.
export const TEMPLATE_COMMAND = "note.from_template";
/// La cartella dei modelli: la stessa di `fub-features` (`template.rs`), che
/// oggi non la pubblica né come impostazione né come specchio.
export const TEMPLATES_FOLDER = "Templates";
/// Quanti risultati mostra una ricerca: il resto si dice nel conto.
export const SEARCH_LIMIT = 50;
/// Quante righe mostra un elenco che si filtra di qua.
export const LIST_LIMIT = 200;

export type Row =
  | { kind: "note"; key: string; doc: string; recent: boolean; at: number | null; snippet: { text: string; highlights: Span[] } | null }
  | { kind: "query"; key: string; query: string }
  | { kind: "create"; key: string; name: string }
  | { kind: "command"; key: string; entry: CommandEntry }
  | { kind: "heading"; key: string; doc: string; level: number; text: string; at: number }
  | { kind: "tag"; key: string; name: string; count: number }
  | { kind: "line"; key: string; doc: string; line: number; column: number | null; lines: number; at: number }
  | { kind: "template"; key: string; doc: string };

export interface Listing {
  rows: Row[];
  /// Che cosa dire quando non c'è niente da scegliere.
  note: string | null;
  /// Quanti sono in tutto, quando se ne mostra solo una parte.
  total: number | null;
}

const nothing = (note: string): Listing => ({ rows: [], note, total: null });
const listed = (rows: Row[], total: number | null = null): Listing => ({ rows, note: null, total });

/// Le prime righe di un elenco lungo, col conto di tutte.
function capped(rows: Row[]): Listing {
  return rows.length > LIST_LIMIT ? listed(rows.slice(0, LIST_LIMIT), rows.length) : listed(rows);
}

async function files(text: string): Promise<Listing> {
  if (!state.vaultRoot) return nothing(t("launcher.note.no_vault"));
  const written = text.trim();
  if (written === "") {
    const recent = await existingRecentNotes();
    if (recent.length === 0) return nothing(t("launcher.note.files"));
    return listed(recent.map((doc) => ({ kind: "note", key: `n:${doc}`, doc, recent: true, at: null, snippet: null })));
  }
  const found = await notesByName(written);
  if (found.length > 0) {
    return listed(found.map((doc) => ({ kind: "note", key: `n:${doc}`, doc, recent: false, at: null, snippet: null })));
  }
  // Senza risultati la domanda diventa un nome: crearla è l'unica cosa che
  // resta da fare, e si offre solo se quel testo può esserlo.
  const name = searchedName(written);
  if (name === null) return nothing(t("launcher.note.files.none", { query: written }));
  return listed([{ kind: "create", key: "create", name }]);
}

function commands(text: string): Listing {
  const entries = orderCommands([...allCommands(), ...viewEntries(paletteHost)], paletteHistoryForTest());
  const kept = filterCommands(entries, text);
  if (kept.length === 0) return nothing(t("launcher.note.commands.none", { query: text.trim() }));
  return listed(kept.map((entry) => ({ kind: "command", key: `c:${entry.id}`, entry })));
}

async function search(text: string): Promise<Listing> {
  if (!state.vaultRoot) return nothing(t("launcher.note.no_vault"));
  const written = text.trim();
  if (written === "") {
    const recent = recentSearches();
    if (recent.length === 0) return nothing(t("launcher.note.search"));
    return listed(recent.map((query) => ({ kind: "query", key: `q:${query}`, query })));
  }
  let expression;
  try {
    expression = searchExpression(written);
  } catch (error) {
    // Una sintassi a metà è normale mentre si scrive: si dice, non è un guasto.
    if (error instanceof SearchSyntaxError) return nothing(error.message);
    throw error;
  }
  const page = await matchingDocuments(expression, { offset: 0, limit: SEARCH_LIMIT });
  if (page.items.length === 0) {
    const status = await vaultStatus();
    return nothing(
      status.indexing === "running"
        ? t("launcher.note.search.indexing")
        : t("launcher.note.search.none", { query: written }),
    );
  }
  const rows = page.items.map((match): Row => ({
    kind: "note",
    key: `n:${match.doc}`,
    doc: match.doc,
    recent: false,
    at: match.occurrences?.[0]?.span.start ?? null,
    snippet: match.snippet ? { text: match.snippet, highlights: match.highlights ?? [] } : null,
  }));
  return listed(rows, page.total > rows.length ? page.total : null);
}

async function headings(text: string): Promise<Listing> {
  const doc = activeDoc();
  if (!doc) return nothing(t("launcher.note.no_doc"));
  const answer = await api.queryIndex({ kind: "outline", doc }, ...vaultArg(openVaultRoot()));
  const all = answer.kind === "outline" ? answer.value : [];
  if (all.length === 0) return nothing(t("launcher.note.headings"));
  const kept = filterByText(all, text, (heading) => heading.text);
  if (kept.length === 0) return nothing(t("launcher.note.headings.none", { query: text.trim() }));
  return capped(kept.map((heading) => ({
    kind: "heading",
    key: `h:${heading.span.start}`,
    doc,
    level: heading.level,
    text: heading.text,
    at: heading.span.start,
  })));
}

async function tags(text: string): Promise<Listing> {
  if (!state.vaultRoot) return nothing(t("launcher.note.no_vault"));
  const all = await vaultTags(WITHOUT_PAGE);
  if (all.length === 0) return nothing(t("launcher.note.tags"));
  const kept = filterByText(all, text, (tag) => tag.name, true);
  if (kept.length === 0) return nothing(t("launcher.note.tags.none", { query: text.trim() }));
  return capped(kept.map((tag) => ({ kind: "tag", key: `t:${tag.name}`, name: tag.name, count: tag.count })));
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

async function templates(text: string): Promise<Listing> {
  if (!allCommands().some((entry) => entry.id === TEMPLATE_COMMAND)) {
    return nothing(t("launcher.note.templates.unavailable"));
  }
  const page = await matchingDocuments(searchExpression(`folder:${TEMPLATES_FOLDER}`), WITHOUT_PAGE);
  if (page.items.length === 0) return nothing(t("launcher.note.templates", { folder: TEMPLATES_FOLDER }));
  const kept = filterByText(page.items.map((match) => match.doc), text, pageName, true);
  if (kept.length === 0) return nothing(t("launcher.note.templates.none", { query: text.trim() }));
  return capped(kept.map((doc) => ({ kind: "template", key: `m:${doc}`, doc })));
}

/// Che cosa un modo offre per una domanda. Chi risponde senza aspettare
/// nessuno (`answersAtOnce`) rende l'elenco, gli altri una promessa.
export function listing(mode: Mode, text: string): Listing | Promise<Listing> {
  switch (mode) {
    case "files":
      return files(text);
    case "commands":
      return commands(text);
    case "search":
      return search(text);
    case "headings":
      return headings(text);
    case "tags":
      return tags(text);
    case "line":
      return line(text);
    case "templates":
      return templates(text);
  }
}

/// I modi che rispondono senza aspettare nessuno: non trattengono le battute
/// e non hanno un'attesa da dire.
export function answersAtOnce(mode: Mode): boolean {
  return mode === "commands" || mode === "line";
}
