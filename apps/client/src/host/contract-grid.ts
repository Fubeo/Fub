// I tipi del confine per la griglia dei fogli di calcolo
// (rispecchiati a mano dal Rust; `contract.ts` li ri-esporta).
import type {
  GridBorderStyle,
  GridCalculation,
  GridHorizontalAlign,
  GridObjectKind,
  GridObjectMissing,
  GridScript,
  GridShapeAlign,
  GridShapeAnchor,
  GridShapeKind,
  GridUnderline,
  GridVerticalAlign,
  GridViewMode,
} from "./enums.generated";

// Dati strutturati a finestre per la famiglia grid. La shell possiede
// rendering, input e clipboard; il provider possiede la lettura del file e
// l'innesto delle celle. Nessun DOM, callback o oggetto CodeMirror attraversa
// questo contratto. Le forme qui sotto sono quelle che il protocollo a byte
// riusa.
export const GRID_FAMILY = "grid";

export interface GridSurfaceSpec {
  id: string;
  format: string;
  family: string;
  protocol_version: number;
}

export interface GridSheet {
  id: string;
  name: string;
  row_count: number;
  column_count: number;
}

export interface GridRow {
  id: string;
  index: number;
  height: number | null;
  hidden: boolean;
}

export interface GridColumn {
  id: string;
  index: number;
  width: number | null;
  hidden: boolean;
}

export interface GridCellKey {
  sheet: string;
  row: string;
  column: string;
}

export type {
  GridBorderStyle,
  GridCalculation,
  GridHorizontalAlign,
  GridObjectKind,
  GridObjectMissing,
  GridScript,
  GridShapeAlign,
  GridShapeAnchor,
  GridShapeKind,
  GridUnderline,
  GridVerticalAlign,
  GridViewMode,
} from "./enums.generated";

/** Un lato del bordo; `color` assente è il colore automatico. */
export interface GridBorder {
  style: GridBorderStyle;
  color: string | null;
}

export interface GridBorders {
  top: GridBorder | null;
  right: GridBorder | null;
  bottom: GridBorder | null;
  left: GridBorder | null;
  diagonal_down: GridBorder | null;
  diagonal_up: GridBorder | null;
}

/** L'aspetto di una cella, già risolto dal provider: tema, stile della
 *  tabella e formattazione condizionale sono dentro. Un campo assente è il
 *  valore di serie del formato. */
export interface GridCellStyle {
  bold: boolean;
  italic: boolean;
  text_color: string | null;
  fill_color: string | null;
  horizontal: GridHorizontalAlign | null;
  number_format: string | null;
  font: string | null;
  /** In punti. */
  font_size: number | null;
  underline: GridUnderline | null;
  strike: boolean;
  script: GridScript | null;
  vertical: GridVerticalAlign | null;
  wrap: boolean;
  shrink: boolean;
  /** Livelli di rientro, come in Excel. */
  indent: number;
  /** Gradi in senso antiorario, da -90 a 90; 255 è il testo in colonna. */
  rotation: number;
  borders: GridBorders;
}

/** La rotazione del testo in colonna (`GRID_STACKED_ROTATION`). */
export const GRID_STACKED_ROTATION = 255;

export interface GridWindowRequest {
  revision: string;
  sheet: string;
  row_start: number;
  row_count: number;
  column_start: number;
  column_count: number;
  /** Le chiavi delle immagini che la shell ha già: i loro byte non tornano. */
  known_media: string[];
}

/** Le chiavi d'immagine che una richiesta di finestra porta, al più (`MAX_GRID_KNOWN_MEDIA`). */
export const MAX_GRID_KNOWN_MEDIA = 256;

/** La misura di una chiave d'immagine (`MAX_GRID_MEDIA_KEY_BYTES`). */
export const MAX_GRID_MEDIA_KEY_BYTES = 64;

/** Patch atomica input-only: lo stile resta intatto. */
export interface GridCellPatch {
  cell: GridCellKey;
  before: string | null;
  after: string;
}

export interface GridApplyRequest {
  revision: string;
  patches: GridCellPatch[];
}

export type GridInvalidation =
  | { kind: "cells"; cells: GridCellKey[] }
  | { kind: "all" };

export interface GridSourceEdit {
  from: number;
  to: number;
  deleted: string;
  inserted: string;
}

export interface GridCommit {
  revision: string;
  edit: GridSourceEdit;
  invalidation: GridInvalidation;
}

// La versione 2 della griglia (ADR 0216, `fub_abi::grid_bytes`): la superficie
// si apre sui byte del documento, che legge l'host, e il testo della
// `DocumentSession` è il **giornale** delle celle cambiate. Il
// `GridCommit.edit` di `apply` è il diff del giornale.
export const GRID_BYTES_PROTOCOL_VERSION = 2;

/** Un avviso della sorgente, in un codice chiuso del provider. */
export interface GridNotice {
  code: string;
  count: number;
}

export interface GridBytesSession {
  instance: string;
  revision: string;
  sheets: GridSheet[];
  /** Il foglio che la sorgente apre per primo. */
  active: string;
  /** I fogli che la sorgente nasconde. */
  hidden: string[];
  notices: GridNotice[];
  /** Le voci del giornale che i byte non confermano. */
  conflicts: GridCellKey[];
  /** I comandi che la sessione serve (ADR 0219): vuoto per un provider che modifica soltanto con le patch. */
  commands: GridCommandState[];
  book: GridBook;
}

/** I colori del tema della cartella, sempre dodici (`GRID_THEME_COLORS`). */
export const GRID_THEME_COLORS = 12;

/**
 * Ciò che vale per tutta la cartella: i colori del tema in `#RRGGBB`, in
 * ordine (sfondo 1, testo 1, sfondo 2, testo 2, sei colori, collegamento,
 * collegamento visitato), i nomi definiti che l'utente vede, il calcolo, la
 * struttura protetta e il carattere dello stile Normale, che lo stile di una
 * cella tace.
 */
export interface GridBook {
  theme_colors: string[];
  names: string[];
  calculation: GridCalculation;
  protected: boolean;
  font: string;
  /** In punti. */
  font_size: number;
}

/** Il foglio, gli intervalli A1 separati da virgola e la cella attiva. */
export interface GridSelection {
  sheet: string;
  selection: string;
  active: string;
}

/** Un comando del catalogo; spento, porta il perché nel testo del provider. */
export interface GridCommandState {
  id: string;
  enabled: boolean;
  reason: string | null;
}

/**
 * Un comando del giornale (`GridCommand`): l'id del comando del provider, i
 * parametri come testo di un oggetto JSON e la selezione su cui è stato dato.
 */
export interface GridCommand {
  id: string;
  params: string;
  sheet: string;
  selection: string;
  active: string;
}

/** Un comando da dare alla sessione alla sua revisione. */
export interface GridCommandRequest {
  revision: string;
  command: GridCommand;
}

/** Una finestra di dialogo che il comando chiede alla shell, con i parametri come testo JSON. */
export interface GridDialog {
  id: string;
  params: string;
}

/**
 * L'esito di un comando: `commit.edit` è il diff del giornale (vuoto se la
 * cartella non cambia), poi i fogli, la selezione nuova, il risultato come
 * testo JSON, la finestra chiesta e il catalogo sulla selezione nuova.
 */
export interface GridCommandOutcome {
  commit: GridCommit;
  sheets: GridSheet[];
  hidden: string[];
  selection: GridSelection;
  result: string | null;
  dialog: GridDialog | null;
  commands: GridCommandState[];
  book: GridBook;
}

/** Un errore porta il suo testo (`#N/A`, `#DIV/0!`): ogni formato ha i suoi. */
export type GridValue =
  | { kind: "blank" }
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "error"; value: string };

/** La barra di dati della formattazione condizionale, già risolta. */
export interface GridDataBar {
  /** La parte della cella che la barra riempie, da 0 a 1. */
  fraction: number;
  color: string;
  gradient: boolean;
}

/** L'icona di un insieme della formattazione condizionale. */
export interface GridIcon {
  set: string;
  index: number;
}

export interface GridCommentReply {
  author: string;
  text: string;
}

/** Una nota o un commento in thread, con le risposte. */
export interface GridComment {
  author: string;
  text: string;
  threaded: boolean;
  resolved: boolean;
  replies: GridCommentReply[];
}

/** Un collegamento: un riferimento nella cartella, o fuori se `external`. */
export interface GridLink {
  target: string;
  tooltip: string | null;
  external: boolean;
}

/** Un'unione di celle che tocca la finestra, in coordinate del foglio. */
export interface GridMerge {
  row: number;
  column: number;
  rows: number;
  columns: number;
}

/** Come il foglio si guarda: riquadri bloccati, griglia, intestazioni, zoom. */
export interface GridSheetView {
  frozen_rows: number;
  frozen_columns: number;
  gridlines: boolean;
  headings: boolean;
  /** Per cento, da 10 a 400. */
  zoom: number;
  right_to_left: boolean;
  mode: GridViewMode;
  /** Le celle mostrano le formule al posto dei valori. */
  formulas: boolean;
  /** Il foglio è protetto. */
  protected: boolean;
  /** La stampa porta la griglia e le intestazioni. */
  print_gridlines: boolean;
  print_headings: boolean;
}

/** Una tabella che tocca la finestra, in coordinate del foglio, con l'intestazione e i totali. */
export interface GridTable {
  name: string;
  row: number;
  column: number;
  rows: number;
  columns: number;
  header_row: boolean;
  totals_row: boolean;
  banded_rows: boolean;
  banded_columns: boolean;
  first_column: boolean;
  last_column: boolean;
  filter_button: boolean;
  /** Il nome dello stile (`TableStyleMedium2`), vuoto se la tabella non ne ha. */
  style: string;
}

/**
 * Una forma come la shell la disegna: i colori risolti (`#RRGGBB`, `null` per
 * niente), il testo e il suo aspetto, con i predefiniti già scelti. Per
 * un'icona il testo è il nome; per un tratto a mano libera i punti
 * `x,y;x,y;…` in pixel dall'angolo dell'oggetto.
 */
export interface GridShape {
  kind: GridShapeKind;
  fill: string | null;
  line: string | null;
  text: string;
  font: string | null;
  /** In punti. */
  font_size: number;
  bold: boolean;
  italic: boolean;
  text_color: string;
  align: GridShapeAlign;
  anchor: GridShapeAnchor;
  right_to_left: boolean;
}

/**
 * I byte di un'immagine. `key` è la loro impronta: la stessa immagine ha la
 * stessa chiave in ogni finestra, e `data` (base64) è `null` quando la
 * richiesta dice di averla già o quando la finestra non ha più posto.
 */
export interface GridMedia {
  mime: string;
  key: string;
  data: string | null;
}

/**
 * Un oggetto del foglio che tocca la finestra: la cella dell'angolo in alto a
 * sinistra, lo scarto da lei e la misura in pixel a zoom 100. Un grafico porta
 * il suo disegno (`svg`), un'immagine i suoi byte, una forma il suo aspetto;
 * `missing` dice perché non porta niente. Gli oggetti vengono nell'ordine in
 * cui si disegnano.
 */
export interface GridObject {
  kind: GridObjectKind;
  /** L'id del file per grafici, immagini e forme; per gli altri il posto nel foglio. */
  id: number;
  row: number;
  column: number;
  dx: number;
  dy: number;
  width: number;
  height: number;
  alt: string;
  svg: string | null;
  media: GridMedia | null;
  shape: GridShape | null;
  missing: GridObjectMissing | null;
}

/** Gli oggetti di una finestra, al più (`MAX_GRID_WINDOW_OBJECTS`). */
export const MAX_GRID_WINDOW_OBJECTS = 1024;

/** Il disegno di un grafico, al più (`MAX_GRID_OBJECT_SVG_BYTES`). */
export const MAX_GRID_OBJECT_SVG_BYTES = 1024 * 1024;

/** I byte di un'immagine in base64, al più (`MAX_GRID_MEDIA_BYTES`). */
export const MAX_GRID_MEDIA_BYTES = 3 * 1024 * 1024;

/** Il testo di una forma, al più (`MAX_GRID_SHAPE_TEXT_BYTES`). */
export const MAX_GRID_SHAPE_TEXT_BYTES = 64 * 1024;

/** I tipi d'immagine che una finestra porta (`GRID_MEDIA_TYPES`). */
export const GRID_MEDIA_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/bmp",
  "image/webp",
  "image/svg+xml",
];

export interface GridBytesCell {
  key: GridCellKey;
  input: string;
  /** L'indice dello stile in `GridBytesWindow.styles`. */
  style: number;
  value: GridValue;
  /** Il valore già formattato dal provider. */
  display: string;
  /** Perché la cella non si modifica, in un codice chiuso del provider. */
  lock: string | null;
  /** Il valore è quello del file, e una cella da cui dipende è cambiata. */
  stale: boolean;
  /** La cella è nel giornale e i byte hanno un terzo input. */
  conflict: boolean;
  data_bar: GridDataBar | null;
  icon: GridIcon | null;
  comment: GridComment | null;
  link: GridLink | null;
}

export interface GridBytesWindow {
  revision: string;
  sheet: string;
  row_start: number;
  column_start: number;
  total_rows: number;
  total_columns: number;
  rows: GridRow[];
  columns: GridColumn[];
  cells: GridBytesCell[];
  /** Gli stili delle celle, ognuno una volta. */
  styles: GridCellStyle[];
  merges: GridMerge[];
  view: GridSheetView;
  tables: GridTable[];
  /** Gli oggetti che toccano la finestra, anche quelli ancorati fuori. */
  objects: GridObject[];
}
