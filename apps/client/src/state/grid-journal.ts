// Il giornale di una cartella di Excel, come lo tiene la shell.
//
// È il testo della `DocumentSession` di un documento con `text_kind`
// `grid_journal`, in una di due forme: le celle cambiate rispetto ai byte sul
// disco, con l'input che hanno nel file e quello nuovo (versione 1, ADR
// 0216), oppure i comandi dati sui byte, in ordine (versione 2, ADR 0219). La
// regola vive in `crates/fub-abi/src/grid_bytes.rs` (`GridJournal`); questo è
// il suo mirror, legato dalla fixture `GridJournalRebase` di
// `mirror-samples.json`.
//
// Il testo vuoto è il giornale vuoto. Altrimenti è JSON in una forma sola. Di
// celle: le voci in ordine di chiave (`sheet`, `row`, `column`, confrontate
// come byte), nessuna chiave due volte, nessuna voce che non cambia niente.
// Di comandi: almeno uno, ognuno con i parametri come testo di un oggetto
// JSON che nessuno riscrive. Gli id sono ASCII stampabile, così l'ordine di
// JavaScript è quello di Rust, e `JSON.stringify` scrive gli stessi byte di
// `serde_json`.
import type { GridCellKey } from "../host/contract";

export const GRID_JOURNAL_VERSION = 1;
export const GRID_COMMAND_JOURNAL_VERSION = 2;
/// `MAX_GRID_JOURNAL_COMMANDS` del codec.
export const MAX_GRID_JOURNAL_COMMANDS = 16_384;
/// `MAX_GRID_COMMAND_PARAMS_BYTES`: i parametri di un comando, come testo.
export const MAX_GRID_COMMAND_PARAMS_BYTES = 64 * 1024;
/// `MAX_GRID_COMMAND_JOURNAL_BYTES`: il testo di un giornale di comandi.
export const MAX_GRID_COMMAND_JOURNAL_BYTES = 16 * 1024 * 1024;
const MAX_GRID_SELECTION_BYTES = 4 * 1024;
const REFERENCE = /^[A-Za-z0-9:,$]+$/u;
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

/// Un comando del giornale, come `GridCommand`: l'id del comando del
/// provider, i parametri come testo di un oggetto JSON e la selezione su cui è
/// stato dato (il foglio, gli intervalli A1 separati da virgola, la cella
/// attiva).
export interface GridCommand {
  readonly id: string;
  readonly params: string;
  readonly sheet: string;
  readonly selection: string;
  readonly active: string;
}

/// Un giornale valido: le voci in ordine di chiave, oppure i comandi in
/// ordine, mai entrambi.
export interface GridJournal {
  readonly entries: readonly GridJournalEntry[];
  readonly commands: readonly GridCommand[];
}

export const EMPTY_GRID_JOURNAL: GridJournal = { entries: [], commands: [] };

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

function validReference(text: unknown): text is string {
  return typeof text === "string" && text.length <= MAX_GRID_SELECTION_BYTES && REFERENCE.test(text);
}

function validateCommand(command: GridCommand): void {
  if (!validId(command.id) || !validId(command.sheet)) journalError("id di comando non valido");
  if (!validReference(command.selection) || !validReference(command.active) || /[:,]/u.test(command.active)) {
    journalError("selezione non valida");
  }
  if (typeof command.params !== "string" || utf8Length(command.params) > MAX_GRID_COMMAND_PARAMS_BYTES) {
    journalError("parametri oltre il limite");
  }
  if (LONE_SURROGATE.test(command.params)) journalError("surrogato solo");
  let params: unknown;
  try {
    params = JSON.parse(command.params);
  } catch {
    journalError("i parametri non sono JSON");
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) journalError("i parametri non sono un oggetto");
}

function validateCommands(commands: readonly GridCommand[]): void {
  if (commands.length > MAX_GRID_JOURNAL_COMMANDS) journalError("troppi comandi");
  let bytes = 0;
  for (const command of commands) {
    validateCommand(command);
    bytes += command.id.length + utf8Length(command.params) + command.sheet.length + command.selection.length + command.active.length;
  }
  if (bytes * 2 > MAX_GRID_COMMAND_JOURNAL_BYTES) journalError("comandi oltre il limite di byte");
}

function fromMap(cells: ReadonlyMap<string, GridJournalEntry>): GridJournal {
  return { entries: [...cells.values()].sort(compareKeys), commands: [] };
}

/// Il testo canonico.
export function gridJournalText(journal: GridJournal): string {
  if (journal.commands.length) {
    return JSON.stringify({
      version: GRID_COMMAND_JOURNAL_VERSION,
      commands: journal.commands.map(({ id, params, sheet, selection, active }) => ({
        id,
        params,
        sheet,
        selection,
        active,
      })),
    });
  }
  if (!journal.entries.length) return "";
  return JSON.stringify({
    version: GRID_JOURNAL_VERSION,
    cells: journal.entries.map(({ sheet, row, column, before, after }) => ({
      sheet,
      row,
      column,
      before,
      after,
    })),
  });
}

/// Legge un giornale, soltanto nella forma canonica: lancia altrimenti.
export function parseGridJournal(text: string): GridJournal {
  if (text === "") return EMPTY_GRID_JOURNAL;
  const length = utf8Length(text);
  if (length > MAX_GRID_COMMAND_JOURNAL_BYTES) journalError("oltre il limite di byte");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    journalError("non è JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) journalError("non è un oggetto");
  const wire = raw as Record<string, unknown>;
  if (wire.version === GRID_COMMAND_JOURNAL_VERSION) return parseCommands(wire, text);
  if (wire.version !== GRID_JOURNAL_VERSION) journalError("versione sconosciuta");
  if (length > MAX_GRID_JOURNAL_INPUT_BYTES + MAX_GRID_JOURNAL_ENTRIES * 512) journalError("oltre il limite di byte");
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

function parseCommands(wire: Record<string, unknown>, text: string): GridJournal {
  if (!Array.isArray(wire.commands) || !wire.commands.length) journalError("i comandi non sono una lista");
  const commands: GridCommand[] = [];
  for (const raw of wire.commands as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) journalError("un comando non è un oggetto");
    const { id, params, sheet, selection, active } = raw as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      typeof params !== "string" ||
      typeof sheet !== "string" ||
      typeof selection !== "string" ||
      typeof active !== "string"
    ) {
      journalError("un campo del comando non è una stringa");
    }
    commands.push({ id, params, sheet, selection, active });
  }
  validateCommands(commands);
  const journal: GridJournal = { entries: [], commands };
  if (gridJournalText(journal) !== text) journalError("non è in forma canonica");
  return journal;
}

/// Aggiunge un comando in coda, come `GridJournal::push_command`: un giornale
/// di celle non ne prende, e oltre i limiti lancia.
export function pushGridCommand(journal: GridJournal, command: GridCommand): GridJournal {
  if (journal.entries.length) journalError("un giornale di celle non prende comandi");
  const commands = [...journal.commands, { ...command }];
  validateCommands(commands);
  return { entries: [], commands };
}

/// Toglie l'ultimo comando, come `GridJournal::pop_command`.
export function popGridCommand(journal: GridJournal): GridJournal {
  return { entries: [], commands: journal.commands.slice(0, -1) };
}

function sameCommand(left: GridCommand, right: GridCommand): boolean {
  return (
    left.id === right.id &&
    left.params === right.params &&
    left.sheet === right.sheet &&
    left.selection === right.selection &&
    left.active === right.active
  );
}

function commonPrefix(left: readonly GridCommand[], right: readonly GridCommand[]): number {
  let count = 0;
  while (count < left.length && count < right.length && sameCommand(left[count]!, right[count]!)) count += 1;
  return count;
}

/// I comandi che il salvataggio di `saved` ha scritto e che `current` non ha
/// più, come `GridJournal::reverted_by`: restano nei byte.
export function gridJournalReverted(current: GridJournal, saved: GridJournal): number {
  return saved.commands.length - commonPrefix(current.commands, saved.commands);
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
  if (journal.commands.length) journalError("un giornale di comandi non prende voci di cella");
  if (!validId(key.sheet) || !validId(key.row) || !validId(key.column)) journalError("id di cella non valido");
  const cells = new Map(journal.entries.map((entry) => [keyOf(entry), entry] as const));
  const original = cells.get(keyOf(key))?.before ?? before;
  if (original === after) cells.delete(keyOf(key));
  else
    cells.set(keyOf(key), {
      sheet: key.sheet,
      row: key.row,
      column: key.column,
      before: original,
      after,
    });
  const next = fromMap(cells);
  validate(next.entries);
  return next;
}

/// Il giornale riportato sui byte che il salvataggio di `saved` ha scritto,
/// come `GridJournal::rebase`: per ogni cella, l'input che il disco ha adesso
/// è il `before`, e quello che `current` vuole è l'`after`. Le voci salvate e
/// non più toccate escono; una cella tornata al suo input durante il
/// salvataggio entra, per riportarlo sul disco. Di comandi: escono quelli in
/// comune con `saved` dall'inizio; sopra un salvataggio dell'altra forma il
/// giornale resta com'è.
export function rebaseGridJournal(current: GridJournal, saved: GridJournal): GridJournal {
  if (current.commands.length || saved.commands.length) {
    if (!saved.commands.length || (!current.commands.length && current.entries.length)) return current;
    return {
      entries: [],
      commands: current.commands.slice(commonPrefix(current.commands, saved.commands)),
    };
  }
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
      out.set(key, {
        sheet: cell.sheet,
        row: cell.row,
        column: cell.column,
        before: onDisk,
        after: wanted,
      });
    }
  }
  return fromMap(out);
}

/// `rebaseGridJournal` sui testi: il testo che resta da salvare dopo che
/// `saved` è sul disco.
export function rebaseGridJournalText(current: string, saved: string): string {
  return gridJournalText(rebaseGridJournal(parseGridJournal(current), parseGridJournal(saved)));
}
