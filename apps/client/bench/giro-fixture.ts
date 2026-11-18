// I finti del gruppo «editor» del giro (`?giro=editor`, `bench/giro/editor.mjs`):
// ciò che il vault del banco non ha e che una persona fa nei quattro editor dei
// file degli altri. Soltanto il giro li accende: l'albero e i conteggi delle
// scene restano quelli delle loro baseline.
//
// - **Il manuale in PDF**: un PDF vero di quattro pagine, col testo che pdf.js
//   sa cercare. La parola del compito sta soltanto a pagina 3.
// - **La cartella di Excel che risponde** (con `?workbook=1`): il finto della
//   griglia (`GridBytesFake`) è un registratore, non un motore, e salvando
//   non innesta il giornale nei byte (tiene quelli che aveva). Una persona
//   però scrive una formula, la vede calcolata, salva e continua: dopo il
//   salvataggio la shell riapre la cartella, e il registratore la
//   riaprirebbe com'era prima. `GiroWorkbook` è il provider che il compito
//   chiede, e niente di più: sa la formula `=B2*12` in B7 e «Ordina dalla Z
//   alla A» su A2:B3, con le finestre della cartella col risultato dentro
//   come il provider le dà, e ricorda che cosa il salvataggio ha innestato.
//   Ogni altra modifica o comando lo rifiuta, come un provider che non lo
//   serve: un gesto sbagliato del compito si vede, non passa.

import type {
  GridApplyRequest,
  GridBytesSession,
  GridBytesWindow,
  GridCommand,
  GridCommandOutcome,
  GridCommandRequest,
  GridCommit,
  PluginError,
} from "../src/host/contract";
import type { Call } from "../src/host/fake";
import { gridJournalText, parseGridJournal } from "../src/state/grid-journal";

// ── Il manuale in PDF ──────────────────────────────────────────────────

export const GIRO_PDF_DOC = "Documenti/Manuale di Fub.pdf";
/// La parola che il compito cerca: c'è soltanto a pagina 3.
export const GIRO_PDF_WORD = "segnalibro";

/// Le righe di ogni pagina: il titolo, poi il testo.
const PDF_PAGES: readonly (readonly string[])[] = [
  ["Manuale di Fub", "Le note, i fogli, i disegni e i PDF del tuo vault.", "Pagina 1: come si comincia."],
  ["Le note", "Una nota e' un file Markdown nel vault.", "Pagina 2: scrivere, collegare, cercare."],
  ["I PDF", `Nel visore un ${GIRO_PDF_WORD} tiene il punto in cui sei arrivato.`, "Pagina 3: leggere e cercare nei PDF."],
  ["I disegni", "Un disegno e' un file SVG che anche le altre app aprono.", "Pagina 4: le forme e la penna."],
];

/// Una stringa PDF: le parentesi e la barra si scappano.
function pdfText(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

/// Un PDF vero di più pagine A4, solo testo in Helvetica: pdf.js lo legge e
/// ne estrae il testo come da uno qualunque.
function manualPdf(): Uint8Array {
  const pages = PDF_PAGES.length;
  // 1 il catalogo, 2 le pagine, 3 il carattere, poi pagina e contenuto per
  // ogni pagina.
  const pageObject = (i: number) => 4 + i * 2;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${PDF_PAGES.map((_, i) => `${pageObject(i)} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  PDF_PAGES.forEach(([title, ...lines]) => {
    const content = [
      "1 g 0 0 595 842 re f",
      `0.1 g BT /F1 28 Tf 64 732 Td (${pdfText(title!)}) Tj ET`,
      ...lines.map((line, j) => `0.25 g BT /F1 13 Tf 64 ${690 - j * 24} Td (${pdfText(line)}) Tj ET`),
    ].join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function giroResources(): Record<string, { bytes: Uint8Array; mime: string }> {
  return { [GIRO_PDF_DOC]: { bytes: manualPdf(), mime: "application/pdf" } };
}

// ── La cartella di Excel che risponde ──────────────────────────────────

/// La formula del compito, la cella dove la si scrive (B7: la riga 6 è
/// nascosta) e il comando dell'ordine sull'intervallo che il compito sceglie.
export const GIRO_FORMULA = "=B2*12";
export const GIRO_FORMULA_CELL = { sheet: "s1", row: "r6", column: "c1" } as const;
export const GIRO_SORT_COMMAND = "data.sortDescending";
export const GIRO_SORT_RANGE = "A2:B3";

/// Che cosa c'è nella cartella: com'è nel file, con la formula, con la
/// formula e l'ordine.
type Stato = "file" | "formula" | "ordinata";

/// La sessione aperta: che cosa mostra e il giornale che la shell ha.
interface Aperta {
  instance: string;
  stato: Stato;
  journal: string;
}

/// Le porte della griglia del finto di sotto che il compito usa.
export interface GridPorts {
  openGridBytes(surface: string, doc: string, journal: string, base: string): Promise<GridBytesSession>;
}

type Cell = GridBytesWindow["cells"][number];

const at = (cell: Cell, row: string, column: string) => cell.key.row === row && cell.key.column === column;
const byteLength = (text: string) => new TextEncoder().encode(text).length;

/// Una cella numerica della finestra, o un errore che dice quale manca.
function numberCell(window: GridBytesWindow, row: string, column: string, name: string): { cell: Cell; value: number } {
  const cell = window.cells.find((candidate) => at(candidate, row, column));
  if (!cell || cell.value.kind !== "number") throw new Error(`giro: ${name} della cartella del banco non è un numero`);
  return { cell, value: cell.value.value };
}

/// Una copia della finestra alla revisione `revision`, con le celle cambiate.
function windowWith(base: GridBytesWindow, revision: string, cells: (cell: Cell) => Cell, added: Cell[] = []): GridBytesWindow {
  const copy = structuredClone(base);
  copy.revision = revision;
  copy.cells = [...copy.cells.map(cells), ...added];
  return copy;
}

/// Il nome A1 di una cella dagli id `r<riga>` e `c<colonna>` (da zero).
function cellName(row: string, column: string): string {
  let letters = "";
  for (let n = Number(column.slice(1)) + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return `${letters}${Number(row.slice(1)) + 1}`;
}

function unserved(what: string): PluginError {
  return { kind: "bad_args", message: `host fake: ${what} non è servito dal finto del giro` };
}

export class GiroWorkbook {
  /// Le finestre del primo foglio con la formula e con l'ordine: il finto di
  /// sotto le dà per revisione.
  readonly windows: GridBytesWindow[];
  readonly #session: GridBytesSession;
  readonly #revisions: Record<Stato, string>;
  /// Che cosa i byte sul disco hanno dentro: ciò che l'ultimo salvataggio ha
  /// innestato.
  #disk: Stato = "file";
  #open: Aperta | null = null;

  constructor(
    readonly doc: string,
    session: GridBytesSession,
    base: GridBytesWindow,
    readonly ports: GridPorts,
    readonly record: (call: Call) => void,
  ) {
    this.#session = session;
    const price = numberCell(base, "r1", "c1", "B2");
    const spend = numberCell(base, "r2", "c1", "B3");
    const total = numberCell(base, "r3", "c1", "B4");
    // Le revisioni sono opache per la shell, come quelle vere.
    this.#revisions = { file: session.revision, formula: `sha256:${"f0".repeat(32)}`, ordinata: `sha256:${"50".repeat(32)}` };
    const formula: Cell = {
      ...structuredClone(price.cell),
      key: { ...GIRO_FORMULA_CELL },
      input: GIRO_FORMULA,
      value: { kind: "number", value: price.value * 12 },
      display: String(price.value * 12),
    };
    const withFormula = windowWith(base, this.#revisions.formula, (cell) => cell, [formula]);
    // Dalla Z alla A su A2:B3: «Spesa» sale sopra «Affitto», col suo importo;
    // le formule che li leggono (C3 = B3/B4, B7 = B2*12) si ricalcolano.
    const swap: Record<string, string> = { r1: "r2", r2: "r1" };
    const quota = price.value / total.value;
    const sorted = windowWith(withFormula, this.#revisions.ordinata, (cell) => {
      const moved = swap[cell.key.row];
      if (moved && (cell.key.column === "c0" || cell.key.column === "c1")) return { ...cell, key: { ...cell.key, row: moved } };
      if (at(cell, "r2", "c2")) return { ...cell, value: { kind: "number", value: quota }, display: `${(quota * 100).toFixed(2)}%` };
      if (at(cell, GIRO_FORMULA_CELL.row, GIRO_FORMULA_CELL.column)) {
        return { ...cell, value: { kind: "number", value: spend.value * 12 }, display: String(spend.value * 12) };
      }
      return cell;
    });
    this.windows = [withFormula, sorted];
  }

  /// La sessione mostra ciò che i byte hanno dentro: dopo un salvataggio, ciò
  /// che il giornale ha innestato, col giornale di nuovo vuoto.
  async openGridBytes(surface: string, doc: string, journal: string, base: string): Promise<GridBytesSession> {
    const session = await this.ports.openGridBytes(surface, doc, journal, base);
    if (doc !== this.doc) return session;
    if (journal !== "") throw unserved("un giornale non vuoto all'apertura");
    this.#open = { instance: session.instance, stato: this.#disk, journal };
    return { ...session, revision: this.#revisions[this.#disk] };
  }

  /// La sola modifica che il finto sa: la formula del compito nella cartella
  /// com'è nel file. Una formula porta la sessione ai comandi, come il
  /// provider: entra nel giornale come `range.setValues`.
  applyGridBytes(_surface: string, instance: string, request: GridApplyRequest): Promise<GridCommit> {
    this.record({ gate: "applyGridBytes", args: [instance, structuredClone(request)] });
    const open = this.#current(instance, request.revision);
    const [patch, ...more] = request.patches;
    const { sheet, row, column } = GIRO_FORMULA_CELL;
    if (!open || open.stato !== "file" || more.length > 0 || patch?.after !== GIRO_FORMULA
      || patch.cell.sheet !== sheet || patch.cell.row !== row || patch.cell.column !== column) {
      return Promise.reject(unserved(`la modifica ${JSON.stringify(request.patches)}`));
    }
    const name = cellName(row, column);
    const command = { id: "range.setValues", params: JSON.stringify({ range: name, values: [[GIRO_FORMULA]] }), sheet, selection: name, active: name };
    return Promise.resolve(this.#advance(open, "formula", command));
  }

  /// Il solo comando che il finto sa: l'ordine del compito, dopo la formula.
  /// I comandi che la griglia chiede da sé (le funzioni proposte mentre si
  /// scrive una formula) li rifiuta, come il finto senza risposte.
  gridBytesCommand(_surface: string, instance: string, request: GridCommandRequest): Promise<GridCommandOutcome> {
    this.record({ gate: "gridBytesCommand", args: [instance, structuredClone(request)] });
    const open = this.#current(instance, request.revision);
    const { command } = request;
    if (!open || open.stato !== "formula" || command.id !== GIRO_SORT_COMMAND || command.sheet !== "s1" || command.selection !== GIRO_SORT_RANGE) {
      return Promise.reject(unserved(`il comando della griglia \`${command.id}\` su ${command.selection}`));
    }
    const session = this.#session;
    return Promise.resolve({
      commit: this.#advance(open, "ordinata", command),
      sheets: session.sheets,
      hidden: session.hidden,
      selection: { sheet: command.sheet, selection: command.selection, active: command.active },
      result: null,
      dialog: null,
      commands: session.commands,
      book: session.book,
    });
  }

  /// La shell ha salvato `source` sulla cartella: se è il giornale della
  /// sessione, i byte ne hanno adesso il risultato.
  saved(doc: string, source: string): void {
    if (doc === this.doc && this.#open && source === this.#open.journal) this.#disk = this.#open.stato;
  }

  /// La sessione aperta, se è questa e parte dalla revisione che mostra.
  #current(instance: string, revision: string): Aperta | null {
    const open = this.#open;
    return open && open.instance === instance && this.#revisions[open.stato] === revision ? open : null;
  }

  /// La sessione passa a `stato` col comando in fondo al giornale.
  #advance(open: Aperta, stato: Stato, command: GridCommand): GridCommit {
    const before = open.journal;
    const commands = before === "" ? [] : parseGridJournal(before).commands;
    const journal = gridJournalText({ entries: [], commands: [...commands, command] });
    open.stato = stato;
    open.journal = journal;
    return {
      revision: this.#revisions[stato],
      edit: { from: 0, to: byteLength(before), deleted: before, inserted: journal },
      invalidation: { kind: "all" },
    };
  }
}

