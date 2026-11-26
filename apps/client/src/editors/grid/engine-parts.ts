// Il motore della griglia: le costanti, i tipi interni e gli aiuti liberi.
// Tolti da `engine.ts`, che riesporta quelli pubblici.
import type {
  GridBytesCell,
  GridBytesWindow,
  GridCellStyle as GridBytesStyle,
  GridObject,
  GridSheetView,
} from "../../host/contract";
import { type Key } from "../../i18n/strings";
import { composingKey } from "../../kit";
import { type GridCoordinate, type GridPosition, type GridSheet } from "./model";
import { type GridCellPatch } from "./operation";
import { parseRangeA1, type GridRange } from "./merges";
import { type Zone } from "./marks";


/// Oltre queste celle un intervallo non viaggia nel contesto: rifarne il
/// testo a ogni movimento della selezione costerebbe quanto copiarlo.
export const SELECTED_TEXT_CELLS = 10_000;

export const DEFAULT_ROW_HEIGHT = 28;
export const DEFAULT_COLUMN_WIDTH = 120;
export const ROW_HEADER_WIDTH = 52;
export const COLUMN_HEADER_HEIGHT = 28;
export const EMPTY_SHEET: GridSheet = { id: "", name: "", rows: [], columns: [] };
/// Quante celle già disegnate rifà al più un disegno che arriva nel mezzo
/// dello scorrimento (una finestra arrivata, il fotogramma dopo): le altre
/// aspettano il fotogramma seguente, così un giro non si allunga oltre un
/// fotogramma. Le celle nuove e quelle che cambiano posto si fanno sempre.
export const GRID_FRAME_REFILLS = 48;
/// Quante righe nuove del margine aggiunge al più un disegno nel mezzo dello
/// scorrimento (il gestore, il fotogramma dopo), oltre a quelle del riquadro
/// e della fascia attorno a lui (`GRID_FRAME_BAND`, una frazione del
/// riquadro): il resto del margine lo finiscono i fotogrammi seguenti. Così
/// uno scorrimento lungo non mette nel documento tutte insieme le righe di
/// un riquadro intero di margine, che il browser deve poi impaginare.
export const GRID_FRAME_NEW_ROWS = 3;
export const GRID_FRAME_BAND = 0.1;
export const GRID_WINDOW_ROWS = 256;
export const GRID_WINDOW_COLUMNS = 128;
export const MAX_GRID_SESSION_WINDOWS = 256;
/// Le parti di una cartella che la griglia non disegna, per codice d'avviso
/// di `fub-format-xlsx` (`not-shown-…`).
export const NOT_SHOWN_KEYS: Readonly<Record<string, Key>> = {
  "not-shown-slicers": "grid.workbook.part.slicers",
};
/// Il comando con cui una formula, o un input, entra in una sessione a comandi.
export const SET_VALUES = "range.setValues";
/// Copia o sposta un intervallo della cartella in un passo solo, con
/// formule, formati e unioni (comando composto di `fub-format-xlsx`).
export const PASTE_FROM = "fub.pasteFrom";
/// Gli ordinamenti rapidi: da una cella sola ordinano la sua zona.
export const SORTS: ReadonlySet<string> = new Set(["data.sortAscending", "data.sortDescending"]);

/// L'intervallo che `selection.currentRegion` rende (`{"selection":"A1:B3"}`),
/// se è uno solo.
export function regionOf(read: string | null): string | null {
  if (!read) return null;
  try {
    const region = (JSON.parse(read) as { selection?: unknown }).selection;
    return typeof region === "string" && parseRangeA1(region) ? region : null;
  } catch {
    return null;
  }
}

/// Un intervallo copiato, o tagliato (`move`), dalla cartella.
export interface Copied {
  readonly sheet: string;
  readonly range: GridRange;
  readonly text: string;
  readonly move: boolean;
}
/// Un gesto che aspetta la risposta del foglio, con le formiche che
/// camminano attorno a `range` sul suo foglio (griglia T6): un riempimento
/// (`fill`, la sorgente in `source` se si sa) o un taglio incollato (`move`,
/// attorno a ciò che si sposta).
export interface Waiting {
  readonly kind: "fill" | "move";
  readonly sheet: string;
  readonly range: GridRange;
  readonly source: GridRange | null;
}
/// Una cella mostrata come anteprima di un incolla (`#previewPaste`), con ciò
/// che la finestra aveva prima, per rimetterlo se il foglio dice di no.
export interface PastePreview {
  readonly window: GridBytesWindow;
  readonly previous: GridBytesCell | undefined;
  readonly shown: GridBytesCell;
}
/// I comandi del catalogo che riempiono: mentre il foglio risponde le
/// formiche camminano attorno a ciò che riempiranno.
export const FILL_COMMANDS: ReadonlySet<string> = new Set([
  "edit.autoFill",
  "edit.fillDown",
  "edit.fillRight",
  "edit.fillUp",
  "edit.fillLeft",
  "edit.fillSeries",
  "edit.flashFill",
]);
/// I comandi del catalogo che soltanto leggono, e che `query` può chiedere.
export const QUERIES: ReadonlySet<string> = new Set([
  "formulas.functions",
  "formulas.recentlyUsed",
  "formulas.nameManager",
  "formulas.evaluate",
  "cell.get",
  "home.manageRules",
  // Senza parametri, Imposta pagina rende le impostazioni del foglio e non
  // cambia niente (`query` lo chiede soltanto così).
  "pageLayout.pageSetup",
  // L'anteprima e il PDF senza percorso leggono la cartella com'è adesso.
  "file.printPreview",
  "file.exportPdf",
  // L'area di dati della cella attiva: sposta la selezione della facciata e
  // basta, che il comando dopo rimette; «Crea tabella» la propone.
  "selection.currentRegion",
]);
/// I comandi di `QUERIES` che leggono soltanto senza parametri.
export const READ_WITHOUT_PARAMS: ReadonlySet<string> = new Set(["pageLayout.pageSetup", "selection.currentRegion"]);
export const UNDO = "edit.undo";
export const REDO = "edit.redo";
/// Quante volte un annulla o un ripeti torna alla sessione riaperta da un
/// salvataggio arrivato mentre era in volo.
export const HISTORY_RETRIES = 2;
/// Perché una cella non si modifica, per codice di blocco.
export const LOCK_KEYS: Readonly<Record<string, Key>> = {
  array: "grid.workbook.lock.array",
  spill: "grid.workbook.lock.spill",
  "shared-formula": "grid.workbook.lock.shared_formula",
  "data-table": "grid.workbook.lock.data_table",
  "table-header": "grid.workbook.lock.table_header",
  "table-totals": "grid.workbook.lock.table_totals",
  merged: "grid.workbook.lock.merged",
  pivot: "grid.workbook.lock.pivot",
  "rich-value": "grid.workbook.lock.rich_value",
  protected: "grid.workbook.lock.protected",
  "sheet-shape": "grid.workbook.lock.sheet_shape",
};
export const PLAIN_STYLE: GridBytesStyle = {
  bold: false,
  italic: false,
  text_color: null,
  fill_color: null,
  horizontal: null,
  number_format: null,
  font: null,
  font_size: null,
  underline: null,
  strike: false,
  script: null,
  vertical: null,
  wrap: false,
  shrink: false,
  indent: 0,
  rotation: 0,
  borders: { top: null, right: null, bottom: null, left: null, diagonal_down: null, diagonal_up: null },
};

/// Il foglio con le misure in pixel della griglia: righe e colonne bloccate,
/// intestazioni e zoom.
export interface SheetFrame {
  readonly view: GridSheetView;
  readonly zoom: number;
  readonly rowHeader: number;
  readonly columnHeader: number;
  readonly frozenRows: number;
  readonly frozenColumns: number;
  readonly frozenHeight: number;
  readonly frozenWidth: number;
}

/// Gli oggetti che si spostano e si misurano: quelli che galleggiano sulle
/// celle, con il nome del tipo che i comandi di GridCraft vogliono.
export const MOVABLE: Readonly<Partial<Record<GridObject["kind"], string>>> = { chart: "chart", image: "image", shape: "shape" };
/// Le maniglie di un oggetto selezionato: dove stanno e che lati muovono.
export const HANDLES: readonly { readonly id: string; readonly x: number; readonly y: number }[] = [
  { id: "nw", x: 0, y: 0 }, { id: "n", x: 0.5, y: 0 }, { id: "ne", x: 1, y: 0 },
  { id: "e", x: 1, y: 0.5 }, { id: "se", x: 1, y: 1 }, { id: "s", x: 0.5, y: 1 },
  { id: "sw", x: 0, y: 1 }, { id: "w", x: 0, y: 0.5 },
];
/// Sotto questa distanza in pixel un clic su un oggetto non lo sposta.
export const DRAG_SLOP = 3;
/// Gli oggetti che l'elenco per chi non vede nomina, al più.
export const SUMMARY_OBJECTS = 50;

/// Il valore che il motore dà a una formula su un riferimento circolare.
const CIRCULAR = "#CIRC!";

export function isCircular(cell: GridBytesCell): boolean {
  return cell.value.kind === "error" && cell.value.value === CIRCULAR;
}

/// Un passo della history delle celle: le patch che lo fanno, e se il suo
/// comando è ancora in cima al giornale del provider (`journaled`), dove lo
/// annulla `edit.undo`. Un passo che non lo è più (il giornale è finito nei
/// byte, o un'altra scrittura gli è passata sopra) si annulla con le patch.
export interface HistoryStep {
  readonly patches: readonly GridCellPatch[];
  journaled: boolean;
}

export interface EditingState {
  readonly position: GridPosition;
  /// L'input della cella quando si è aperta: confermare scrive soltanto se
  /// la bozza è diversa.
  original: string;
  draft: string;
  readonly owner: "cell" | "formula";
  /// «Inserisci», aperta da una battuta: le frecce confermano e spostano.
  /// «Modifica», aperta con F2 o il doppio clic: le frecce muovono il
  /// cursore. F2 alterna.
  mode: GridEditMode;
  /// L'input che la cella ha preso sotto la bozza, da un salvataggio o da un
  /// altro riquadro, finché non si sceglie quale tenere.
  theirs: string | null;
  /// La cella per id (foglio, riga, colonna): una riscrittura la ritrova anche
  /// se la sua riga si è spostata, o dice che non c'è più.
  readonly coordinate: GridCoordinate | undefined;
}

/// Il foglio come si mostrava quando una riscrittura da fuori è arrivata: le
/// righe e le colonne per id, e l'input di ogni cella letta per id, così si
/// dice quali celle sono cambiate davvero.
export interface ShownWindow {
  readonly rowStart: number;
  readonly columnStart: number;
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  readonly inputs: ReadonlyMap<string, string>;
}

const inputKey = (row: string, column: string): string => `${row}\u0000${column}`;

/// Le finestre lette del foglio `sheet`, per il confronto dopo una riscrittura.
export function shownWindows(windows: readonly GridBytesWindow[], sheet: string): ShownWindow[] {
  return windows.filter((window) => window.sheet === sheet).map((window) => ({
    rowStart: window.row_start,
    columnStart: window.column_start,
    rows: window.rows.map((row) => row.id),
    columns: window.columns.map((column) => column.id),
    inputs: new Map(window.cells.map((cell) => [inputKey(cell.key.row, cell.key.column), cell.input] as const)),
  }));
}

/// Vero se una cella letta prima e dopo ha un input diverso, salvo la cella
/// `open` che si sta scrivendo: quella ha la sua bozza e il suo avviso.
export function changedElsewhere(before: readonly ShownWindow[], after: readonly ShownWindow[], open: GridCoordinate | undefined): boolean {
  const isOpen = (row: string, column: string): boolean => open !== undefined && row === open.row && column === open.column;
  for (const old of before) {
    for (const next of after) {
      const rowFrom = Math.max(old.rowStart, next.rowStart);
      const rowTo = Math.min(old.rowStart + old.rows.length, next.rowStart + next.rows.length);
      const columnFrom = Math.max(old.columnStart, next.columnStart);
      const columnTo = Math.min(old.columnStart + old.columns.length, next.columnStart + next.columns.length);
      for (let row = rowFrom; row < rowTo; row += 1) {
        for (let column = columnFrom; column < columnTo; column += 1) {
          const oldRow = old.rows[row - old.rowStart]!;
          const oldColumn = old.columns[column - old.columnStart]!;
          const newRow = next.rows[row - next.rowStart]!;
          const newColumn = next.columns[column - next.columnStart]!;
          if (isOpen(oldRow, oldColumn) || isOpen(newRow, newColumn)) continue;
          const was = old.inputs.get(inputKey(oldRow, oldColumn)) ?? "";
          if (was !== (next.inputs.get(inputKey(newRow, newColumn)) ?? "")) return true;
        }
      }
    }
  }
  return false;
}

/// Gli avvisi che stanno insieme su una riga, saltando quelli vuoti.
export function joinNotices(...parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

/// Il modo della cella aperta, come lo dice la banda di stato.
export type GridEditMode = "ready" | "insert" | "edit";

/// Che cosa fa una battuta su una cella scelta. Un tasto vero (`isTrusted`)
/// stampabile, morto o di composizione (`Process`, `composingKey`) apre la
/// cella e lascia che il browser ci scriva: così passano tasti morti e IME.
/// Un evento sintetico non scrive niente da sé, e la cella si apre col suo
/// carattere. Le scorciatoie (Ctrl, Cmd, Alt senza AltGr) non aprono.
export function typingOpens(event: KeyboardEvent): "browser" | "seed" | null {
  const altGraph = event.getModifierState?.("AltGraph") ?? false;
  if (event.ctrlKey && !altGraph) return null;
  if (event.metaKey || (event.altKey && !altGraph)) return null;
  const composing = composingKey(event) || event.key === "Process" || event.key === "Dead";
  if (event.isTrusted && (composing || event.key.length === 1)) return "browser";
  return !composing && event.key.length === 1 ? "seed" : null;
}

/// Com'è vestita la cella aperta (`#dressEditor`): `key` dice da che cella e
/// con che stile, `font` è il carattere per misurare il testo, `padLeft` e
/// `padRight` i margini del testo, gli stessi della cella.
export interface EditorDress {
  readonly key: string;
  readonly font: string;
  readonly size: number;
  readonly padLeft: number;
  readonly padRight: number;
}
/// Quanto il testo della cella aperta ha di margine oltre la sua misura: il
/// cursore alla fine, e gli arrotondamenti della misura sulla tela.
export const EDITOR_SLACK = 4;
/// Le proprietà in linea della cella (`paint.ts`) che la cella aperta prende:
/// la carta e l'inchiostro del file, e la loro versione adattata.
export const EDITOR_PAPER = ["--file-fill", "--file-color", "--file-fill-a", "--file-color-a"] as const;

/// La tela su cui la cella aperta misura il suo testo, fatta una volta;
/// `null` dove non c'è (un DOM di prova).
let measureCanvas: CanvasRenderingContext2D | null | undefined;
export function measureContext(): CanvasRenderingContext2D | null {
  if (measureCanvas === undefined) {
    try {
      measureCanvas = document.createElement("canvas").getContext("2d");
    } catch {
      measureCanvas = null;
    }
  }
  return measureCanvas;
}

/// La zona del piano di ciò che sta su una colonna e una riga, bloccate o no.
export function zoneOf(frozenColumn: boolean, frozenRow: boolean): Zone {
  return frozenColumn && frozenRow ? "corner" : frozenRow ? "top" : frozenColumn ? "left" : "body";
}
/// Di quanto il lato di un segno tagliato dal bordo della sua zona passa
/// oltre il taglio: il livello lo taglia, e il bordo del segno non si vede
/// dove la zona finisce (`marks.ts`, `bleed`). Più dei 2 px del bordo.
export const MARK_BLEED = 3;
/// Il quadratino si prende entro tanti px dall'angolo dei fili.
export const FILL_SLOP = 6;
/// Col dito: oltre tanti px il dito scorre, e il gesto non è più un tocco.
export const TAP_MOVE = 8;
/// Col dito: fermo tanto (ms) è un tocco lungo, che mette le due maniglie.
export const LONG_PRESS_MS = 450;
/// Col dito: due tocchi sulla stessa cella entro tanto (ms) la aprono.
export const DOUBLE_TAP_MS = 300;
/// La presa di una maniglia del tocco: un cerchio di tanti px attorno al
/// suo angolo, che copre il tondo e il suo bordo.
export const GRIP_R = 9;
/// Un dito sulla griglia, finché non si alza, scorre o diventa lungo.
export interface TouchPress {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly hit: { readonly row: number | null; readonly column: number | null };
  timer: ReturnType<typeof setTimeout> | null;
  long: boolean;
}
/// Ciò che un disegno mette in ogni livello del piano, nell'ordine.
export type Drawing = Map<HTMLElement, HTMLElement[]>;
/// Una cella disegnata in una riga che resta: l'elemento, il suo bordo, la
/// firma di ciò che mostra (`#cellSignature`), il suo HTML senza la
/// selezione e le classi senza la selezione. L'HTML si legge solo quando la
/// firma cambia (`#drawRow`): una cella appena entrata non ce l'ha
/// (`null`), perché serializzarla a ogni riga che lo scorrimento aggiunge
/// costa e serve soltanto a un confronto che forse non verrà mai.
interface DrawnCell {
  readonly cell: HTMLElement;
  border: HTMLElement | null;
  place: string;
  signature: string;
  html: string | null;
  base: string;
}
/// Le misure del riquadro lette una volta, prima di scrivere (`#renderRows`).
export interface PaperView {
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly width: number;
  readonly height: number;
}
/// Ciò che una riga disegnata ricorda: la sua misura, l'intestazione e le
/// celle, per colonna (o per unione).
export interface DrawnRow {
  place: string;
  header: HTMLElement | null;
  headerKey: string;
  readonly cells: Map<string, DrawnCell>;
}

/// Una cella scritta che aspetta il provider (griglia T5): dove sta, e
/// l'anteprima messa nella sua finestra.
export interface WrittenCell {
  readonly sheet: string;
  readonly position: GridPosition;
  readonly shown: GridBytesCell;
}

/// Se `element` è una riga di celle, nella testa o nel corpo (non la riga
/// delle intestazioni di colonna).
export function isDataRow(element: Element): element is HTMLElement {
  return element instanceof HTMLElement && element.classList.contains("grid-row") && !element.classList.contains("grid-column-header-row");
}
