// Il giornale delle celle di una cartella di Excel, come lo tiene la shell.
//
// È il testo della `DocumentSession` di un documento con `text_kind`
// `grid_journal` (ADR 0216): le celle cambiate rispetto ai byte sul disco, con
// l'input che hanno nel file e quello nuovo. La regola vive in
// `crates/fub-abi/src/grid_bytes.rs` (`GridJournal`); questo è il suo mirror,
// legato dalla fixture `GridJournalRebase` di `mirror-samples.json`.
//
// Il testo vuoto è il giornale vuoto. Altrimenti è JSON in una forma sola:
// le voci in ordine di chiave (`sheet`, `row`, `column`, confrontate come
// byte), nessuna chiave due volte, nessuna voce che non cambia niente. Gli id
// sono ASCII stampabile, così l'ordine di JavaScript è quello di Rust, e
// `JSON.stringify` scrive gli stessi byte di `serde_json`.
import type { GridCellKey } from "../host/contract";

export const GRID_JOURNAL_VERSION = 1;
/// `MAX_GRID_JOURNAL_ENTRIES` del codec: quante patch porta un commit.
export const MAX_GRID_JOURNAL_ENTRIES = 16_384;
/// `MAX_GRID_JOURNAL_INPUT_BYTES`: gli input, `before` e `after` insieme.
export const MAX_GRID_JOURNAL_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_GRID_ID_BYTES = 64;
const ID = /^[\x21-\x7e]+$/u;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u;

export interface GridJournalEntry {
  readonly sheet: string;
  readonly row: string;
  readonly column: string;
  /// L'input che la cella ha nei byte su cui il giornale si applica.
  readonly before: string;
  readonly after: string;
}

/// Un giornale valido, in ordine di chiave.
export interface GridJournal {
  readonly entries: readonly GridJournalEntry[];
}

export const EMPTY_GRID_JOURNAL: GridJournal = { entries: [] };

function journalError(message: string): never {
  throw new TypeError(`giornale della griglia: ${message}`);
}

function validId(id: unknown): id is string {
  return typeof id === "string" && id.length <= MAX_GRID_ID_BYTES && ID.test(id);
}

function compareKeys(left: GridCellKey, right: GridCellKey): number {
  for (const field of ["sheet", "row", "column"] as const) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return 0;
}

function keyOf(entry: GridCellKey): string {
  return `${entry.sheet}\u0000${entry.row}\u0000${entry.column}`;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function validate(entries: readonly GridJournalEntry[]): void {
  if (entries.length > MAX_GRID_JOURNAL_ENTRIES) journalError("troppe voci");
  let bytes = 0;
  for (const entry of entries) {
    if (!validId(entry.sheet) || !validId(entry.row) || !validId(entry.column)) journalError("id di cella non valido");
    if (entry.before === entry.after) journalError("una voce non cambia niente");
    bytes += utf8Length(entry.before) + utf8Length(entry.after);
  }
  if (bytes > MAX_GRID_JOURNAL_INPUT_BYTES) journalError("input oltre il limite");
}

function fromMap(cells: ReadonlyMap<string, GridJournalEntry>): GridJournal {
  return { entries: [...cells.values()].sort(compareKeys) };
}

/// Il testo canonico.
export function gridJournalText(journal: GridJournal): string {
  if (!journal.entries.length) return "";
  return JSON.stringify({
    version: GRID_JOURNAL_VERSION,
    cells: journal.entries.map(({ sheet, row, column, before, after }) => ({ sheet, row, column, before, after })),
  });
}

/// Legge un giornale, soltanto nella forma canonica: lancia altrimenti.
export function parseGridJournal(text: string): GridJournal {
  if (text === "") return EMPTY_GRID_JOURNAL;
  if (utf8Length(text) > MAX_GRID_JOURNAL_INPUT_BYTES + MAX_GRID_JOURNAL_ENTRIES * 512) journalError("oltre il limite di byte");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    journalError("non è JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) journalError("non è un oggetto");
  const wire = raw as Record<string, unknown>;
  if (wire.version !== GRID_JOURNAL_VERSION) journalError("versione sconosciuta");
  if (!Array.isArray(wire.cells)) journalError("le celle non sono una lista");
  const cells = new Map<string, GridJournalEntry>();
  for (const cell of wire.cells as unknown[]) {
    if (!cell || typeof cell !== "object" || Array.isArray(cell)) journalError("una voce non è un oggetto");
    const { sheet, row, column, before, after } = cell as Record<string, unknown>;
    if (typeof before !== "string" || typeof after !== "string") journalError("un input non è una stringa");
    // `serde_json` rifiuta un surrogato solo, anche scritto come `\ud800`.
    if (LONE_SURROGATE.test(before) || LONE_SURROGATE.test(after)) journalError("surrogato solo");
    if (!validId(sheet) || !validId(row) || !validId(column)) journalError("id di cella non valido");
    const entry = { sheet, row, column, before, after };
    if (cells.has(keyOf(entry))) journalError("una cella compare due volte");
    cells.set(keyOf(entry), entry);
  }
  const journal = fromMap(cells);
  validate(journal.entries);
  if (gridJournalText(journal) !== text) journalError("non è in forma canonica");
  return journal;
}

/// La voce di una cella.
export function gridJournalEntry(journal: GridJournal, key: GridCellKey): GridJournalEntry | undefined {
  return journal.entries.find((entry) => compareKeys(entry, key) === 0);
}

/// Registra che `key` passa da `before` (l'input nei byte) ad `after`, come
/// `GridJournal::record`: una cella già nel giornale tiene il suo `before`, e
/// una cella che torna al suo input esce. Lancia oltre i limiti, e il
/// giornale resta com'era.
export function recordGridJournal(journal: GridJournal, key: GridCellKey, before: string, after: string): GridJournal {
  if (!validId(key.sheet) || !validId(key.row) || !validId(key.column)) journalError("id di cella non valido");
  const cells = new Map(journal.entries.map((entry) => [keyOf(entry), entry] as const));
  const original = cells.get(keyOf(key))?.before ?? before;
  if (original === after) cells.delete(keyOf(key));
  else cells.set(keyOf(key), { sheet: key.sheet, row: key.row, column: key.column, before: original, after });
  const next = fromMap(cells);
  validate(next.entries);
  return next;
}

/// Il giornale riportato sui byte che il salvataggio di `saved` ha scritto,
/// come `GridJournal::rebase`: per ogni cella, l'input che il disco ha adesso
/// è il `before`, e quello che `current` vuole è l'`after`. Le voci salvate e
/// non più toccate escono; una cella tornata al suo input durante il
/// salvataggio entra, per riportarlo sul disco.
export function rebaseGridJournal(current: GridJournal, saved: GridJournal): GridJournal {
  const now = new Map(current.entries.map((entry) => [keyOf(entry), entry] as const));
  const written = new Map(saved.entries.map((entry) => [keyOf(entry), entry] as const));
  const out = new Map<string, GridJournalEntry>();
  for (const key of new Set([...now.keys(), ...written.keys()])) {
    const mine = now.get(key);
    const disk = written.get(key);
    const cell = (mine ?? disk)!;
    const wanted = mine ? mine.after : disk!.before;
    const onDisk = disk ? disk.after : mine!.before;
    if (wanted !== onDisk) {
      out.set(key, { sheet: cell.sheet, row: cell.row, column: cell.column, before: onDisk, after: wanted });
    }
  }
  return fromMap(out);
}

/// `rebaseGridJournal` sui testi: il testo che resta da salvare dopo che
/// `saved` è sul disco.
export function rebaseGridJournalText(current: string, saved: string): string {
  return gridJournalText(rebaseGridJournal(parseGridJournal(current), parseGridJournal(saved)));
}
