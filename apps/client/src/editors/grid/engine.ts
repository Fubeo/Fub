import type {
  GridCommand,
  GridBytesCell,
  GridBytesSession,
  GridBytesWindow,
  GridCellPatch as GridRequestPatch,
  GridCellStyle as GridBytesStyle,
  GridCommandState,
  GridBook,
  GridMerge,
  GridObject,
  GridSheetView,
  GridTable,
} from "../../host/contract";
import { settings } from "../../host/query";
import { onEvent } from "../../state/kernel";
import { type EditorChangeOrigin, type TextOperation } from "../core/text-operation";
import { gridJournalEntry, gridJournalText, parseGridJournal, recordGridJournal } from "../../state/grid-journal";
import { adapter, type Adapter, type Paper } from "../../theme/adapt";
import type { Theme } from "../../theme/theme";
import type { PdfEngineLoader } from "../media/pdf-view";
import type { Spring } from "../../moto/spring";
import { t, onLanguage, resolvedLanguage } from "../../i18n/strings";
import { textButton, type TabsHandle } from "../../kit";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { createTextEngine, type TextEngine } from "../text/engine";
import { createFormulaProfile, formulaReferences, operandSlot, type FormulaMove } from "../text/profiles/formula";
import { isMultiCell, nextCell, nextInRange, type Move, type Shape } from "../../tabella/navigation";
import { clipboardData, clipboardRows, cutDestination, pasteTargets, type ClipboardCell } from "../../tabella/clipboard";
import { withRange } from "../../tabella/selection";
import {
  columnLabel,
  coordinateAt,
  normalizedSelection,
  type GridPosition,
  type GridSelection,
  type GridWorkbook,
} from "./model";
import { inverseGridPatches, selectionText, selectionTsv } from "./operation";
import { cellA1, mergeAt, mergesIn, parseRangeA1, rangeA1, type GridRange } from "./merges";
import { attachCommentCards, commentDescription } from "./comment-card";
import {
  COPY_MARK_KEY,
  copyMarkOf,
  createMarksMotion,
  fadeOutResizeLabel,
  hideEditorFrame,
  SELECTION_SPEED_KEY,
  selectionMotion,
  selectionSpeedOf,
  showEditorFrame,
  slideLines,
  SLIDE,
  type CopyMark,
  type MarksMotion,
  type SelectionSpeed,
} from "./grid-motion";
import {
  cornerSeen,
  edgeParts,
  rectPieces,
  selectionParts,
  wholeRect,
  type Bands,
  type MarkGeometry,
  type MarkPart,
  type Rect,
  type SelectionLook,
  type Zone,
} from "./marks";
import { GridMediaCache } from "./objects";
import { hasBorders, horizontalOf, iconOf, paintBorders, paintCell, spills } from "./paint";
import { morphChildren, placeInOrder, setAttributeIfChanged, syncAttributes } from "./dom-sync";
import {
  cellKey,
  decimalSeparator,
  DEFAULT_SHEET_VIEW,
  fileInput,
  localInput,
  objectKey,
  WORKBOOK_SCALE,
  type WorkbookView,
} from "./workbook";
import {
  axisLayout,
  commonSize,
  DRAG_SCROLL_MAX,
  DRAG_SCROLL_MS,
  fillTarget,
  indexAt,
  marginWindow,
  mergeCovers,
  MOVE_SLOP,
  openSpan,
  pixelsToChars,
  previewSizes,
  RESIZE_LABEL_GAP,
  RESIZE_SLOP,
  resizeLabelAt,
  samePosition,
  sameRange,
  tableRange,
  type AxisLayout,
  type CellDrag,
  type ObjectGesture,
  type ObjectRect,
  type OpenSpan,
  type Pointing,
  type ResizeDrag,
  type ResizeEdge,
  type SizePreview,
} from "./engine-geometry";
import {
  type BytesState,
  type CellWrite,
  type GridCommandEffect,
  type GridEngineOptions,
  type GridRun,
} from "./engine-host";
import {
  SELECTED_TEXT_CELLS,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_COLUMN_WIDTH,
  ROW_HEADER_WIDTH,
  COLUMN_HEADER_HEIGHT,
  GRID_FRAME_REFILLS,
  GRID_FRAME_NEW_ROWS,
  GRID_FRAME_BAND,
  PASTE_FROM,
  Copied,
  Waiting,
  PastePreview,
  QUERIES,
  READ_WITHOUT_PARAMS,
  UNDO,
  REDO,
  SheetFrame,
  HistoryStep,
  EditingState,
  GridEditMode,
  EditorDress,
  EDITOR_SLACK,
  EDITOR_PAPER,
  measureContext,
  zoneOf,
  MARK_BLEED,
  FILL_SLOP,
  TAP_MOVE,
  LONG_PRESS_MS,
  DOUBLE_TAP_MS,
  GRIP_R,
  TouchPress,
  Drawing,
  PaperView,
  DrawnRow,
  WrittenCell,
  isDataRow,
} from "./engine-parts";
import { mixMethods } from "../core/mix-methods";
import { objectsMethods, type ObjectsMethods } from "./engine-objects";
import { sheetsMethods, type SheetsMethods } from "./engine-sheets";
import { sessionMethods, type SessionMethods } from "./engine-session";
import { writeMethods, type WriteMethods } from "./engine-write";
import { commandsMethods, type CommandsMethods } from "./engine-commands";
import { selectionMethods, type SelectionMethods } from "./engine-selection";
import { keysMethods, type KeysMethods } from "./engine-keys";
export {
  GRID_WINDOW_ROWS,
  GRID_WINDOW_COLUMNS,
  MAX_GRID_SESSION_WINDOWS,
  GridEditMode,
  typingOpens,
} from "./engine-parts";

export { fillTarget, gestureRect, openSpan, pixelsToChars } from "./engine-geometry";
export type { GridChange, GridCommandEffect, GridEngineOptions, GridHost, GridRun } from "./engine-host";

/**
 * I membri `_nome` sono interni al motore: li usano soltanto i file
 * `engine*.ts` di questa cartella, e una guardia lo controlla
 * (`editors/core/mix-methods.test.ts`). Erano privati del linguaggio (`#nome`)
 * finché la classe stava in un file solo.
 */
export class GridEngine {
  readonly _root: HTMLElement;
  readonly _formulaHost: HTMLElement;
  readonly _viewport: HTMLElement;
  /// Il piano: grande quanto il foglio, con gli strati uno sopra l'altro
  /// (le righe del corpo, i livelli dei segni, la testa). Le fasce ferme ci
  /// stanno col solo `sticky`: nessuno script le rimette a posto.
  readonly _plane: HTMLElement;
  /// La testa, ferma in alto: la riga delle intestazioni e le righe bloccate.
  readonly _head: HTMLElement;
  /// Le righe del corpo, che scorrono.
  readonly _body: HTMLElement;
  /// Un livello dei segni per zona: ognuno taglia ciò che esce dalla zona.
  readonly _layers: Readonly<Record<Zone, HTMLElement>>;
  /// Il livello «lift» di ogni zona: i segni d'angolo e gli oggetti, interi.
  /// Per il corpo è il suo livello dei segni.
  readonly _lifts: Readonly<Record<Zone, HTMLElement>>;
  /// Fermo nell'angolo del riquadro: la guida e la misura di un bordo tirato.
  readonly _fixed: HTMLElement;
  /// La carta sotto le righe, coi suoi fili: dove una riga non è ancora
  /// disegnata si vede la griglia vuota, mai il bianco. È grande quanto il
  /// riquadro e ci sta ferma; i fili delle colonne in `_paperRulesHost`. Sta
  /// nel riquadro prima del piano, non nel piano: vedi `structure.css`. La
  /// sua copia nelle fasce ferme: la testa, la colonna ferma e l'angolo.
  readonly _sheetPaper: HTMLElement;
  readonly _paperRulesHost: HTMLElement;
  readonly _paperTop: HTMLElement;
  readonly _paperLeft: HTMLElement;
  readonly _paperCorner: HTMLElement;
  /// Le carte coi fili delle righe, che prendono la fase (`_placePaper`): la
  /// carta del corpo e le due strisce della colonna ferma, non i fili delle
  /// colonne che ci stanno accanto.
  readonly _paperStrips: readonly HTMLElement[];
  /// Ciò che la carta ha scritto l'ultima volta (`_placePaper`): la misura,
  /// la fase dei fili delle righe e lo spostamento di quelli delle colonne.
  _paperPlaced = "";
  /// L'altezza di serie delle righe, su cui la carta ripete i fili.
  _paperPeriod = DEFAULT_ROW_HEIGHT;
  /// Le celle disegnate che aspettano di essere misurate (`_fitPending`).
  _pendingFits: HTMLElement[] = [];
  /// Le misure del riquadro lette dal gestore dello scorrimento prima di
  /// scrivere, buone fino al fotogramma chiesto: chi disegna in mezzo (una
  /// finestra arrivata) non obbliga il browser a impaginare per rileggerle.
  _scrollView: PaperView | null = null;
  /// Quante celle già disegnate il disegno in corso può ancora rifare
  /// (`_renderRows`), e se ne ha lasciate per il fotogramma dopo.
  _refills = Infinity;
  _rowsBehind = false;
  readonly _corner: HTMLElement;
  /// La cella aperta (griglia T4): sta nel livello «lift» della zona della
  /// sua cella, non dentro la cella, così ne esce e cresce. Dentro, la
  /// cornice (un pezzo a parte, attorno) e il campo di CodeMirror.
  readonly _cellEditorHost: HTMLElement;
  readonly _cellEditorFrame: HTMLElement;
  readonly _cellEditorField: HTMLElement;
  /// Com'è vestita la cella aperta: la cella da cui ha preso il carattere, la
  /// carta e i margini, il carattere che misura il testo e i margini letti.
  _editorDress: EditorDress | null = null;
  /// La misura del testo della cella aperta, rifatta a ogni cambio della
  /// bozza: la riga più larga (margini compresi) e quante righe.
  _editorNeed: { readonly width: number; readonly lines: number } | null = null;
  /// L'altezza del testo andato a capo, letta per la larghezza `width`.
  _editorHeight: { readonly width: number; readonly height: number } | null = null;
  readonly _notice: HTMLElement;
  readonly _ribbonHost: HTMLElement;
  readonly _sheetBar: HTMLElement;
  readonly _formulaEditor: TextEngine;
  /// Il campo della cella aperta, creato la prima volta che una cella si
  /// apre (`_cellEditor`): una cartella che si guarda soltanto non monta un
  /// secondo CodeMirror. Il tema e la sola lettura arrivano con lui.
  _cellEngine: TextEngine | null = null;
  _cellTheme: Theme | undefined;
  readonly _options: GridEngineOptions;
  readonly _stopLanguage: () => void;
  readonly _abort = new AbortController();
  _workbook: GridWorkbook | null = null;
  /// La cartella di Excel che la griglia mostra.
  _view: WorkbookView | null = null;
  /// La sessione aperta; `null` mentre si apre o se non si è aperta.
  _bytes: BytesState | null = null;
  _bytesOpening = false;
  /// Annulla e ripeti arrivati mentre il giornale si scriveva, quando la
  /// scrittura ha fatto riaprire la cartella: vanno alla sessione nuova appena
  /// aperta, prima delle celle che la riapertura riporta (`_openBytes`).
  _heldHistory: GridCommand[] = [];
  /// L'ultima sessione mostrata e le finestre lette: restano mentre la
  /// cartella si riapre, così la griglia non si svuota.
  _shownSession: GridBytesSession | null = null;
  _windows: GridBytesWindow[] = [];
  /// La revisione dei byte su cui la sessione è aperta.
  _bytesBase: string | null = null;
  /// Il giornale pubblicato alla sessione, e quello che il provider tiene.
  _journal = "";
  _confirmedJournal = "";
  /// Cresce a ogni apertura: un passo in coda di prima non vale più.
  _bytesEpoch = 0;
  /// Cresce quando una modifica non entra: quelle in coda partivano da lei.
  _editEpoch = 0;
  _bytesTickets = 0;
  /// Le celle scritte a comandi il cui giornale il provider non ha ancora
  /// confermato e pubblicato alla sessione: soltanto il provider le tiene.
  /// Una riapertura che tiene il documento (dopo un salvataggio, un altro
  /// riquadro) le riscrive sulla sessione nuova invece di perderle (IMP-512).
  _unpublished: GridRequestPatch[] = [];
  /// Quelle portate da una riapertura, finché una non riesce e le riscrive.
  _carried: GridRequestPatch[] = [];
  /// Il biglietto dell'ultima scrittura prima della riapertura: quelle
  /// scritte mentre si riapre hanno il loro, e pubblicano dopo.
  _carriedTicket = 0;
  _bytesConflicts = 0;
  /// L'ultima frase di un gesto rifiutato o di un guasto, sotto gli avvisi.
  _bytesMessage: string | null = null;
  _decimal: "." | "," = decimalSeparator(resolvedLanguage());
  _sheetTabs: { readonly handle: TabsHandle; readonly names: string; readonly lifetime: Lifetime } | null = null;
  _sheetIndex = 0;
  _viewportLoad: Promise<void> | null = null;
  _viewportLoadQueued = false;
  _selection: GridSelection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
  _rows: AxisLayout = { offsets: [0], sizes: [], total: 0 };
  _columns: AxisLayout = { offsets: [0], sizes: [], total: 0 };
  _editing: EditingState | null = null;
  /// Chi vuole sapere se la cella aperta tiene testo non confermato (la
  /// sessione, per la bozza di recupero), e l'ultima risposta data.
  readonly _pendingWatchers = new Set<(pending: boolean) => void>();
  _pendingSaid = false;
  _pointing: Pointing | null = null;
  /// Ciò che si è tagliato e non ancora incollato: le formiche attorno
  /// all'intervallo, e il testo che l'incolla riconosce per spostarlo.
  _cutMark: { readonly sheet: string; readonly range: GridRange; readonly text: string } | null = null;
  /// Ciò che copia o taglia hanno preso dalla cartella: l'incolla che trova
  /// lo stesso testo negli appunti lo rifà con `fub.pasteFrom`.
  _copied: Copied | null = null;
  /// Ciò che si è copiato e non ancora incollato: il tratteggio largo attorno
  /// all'intervallo, sul suo foglio, finché non si incolla, si scrive o si
  /// preme Esc (griglia T6).
  _copyMark: { readonly sheet: string; readonly range: GridRange } | null = null;
  /// Le due preferenze della griglia (griglia T9): il segno di una copia e
  /// come la selezione va alla cella nuova. Di serie come il prototipo finché
  /// l'host non le dice; valgono dal gesto dopo che cambiano.
  _copyMarkStyle: CopyMark = "dash-pulse";
  _selectionSpeed: SelectionSpeed = "normal";
  /// L'ultima lettura delle preferenze: una risposta più vecchia non scrive
  /// sopra una più nuova.
  _preferencesRead = 0;
  /// L'ultimo gesto che aspetta il foglio (un riempimento, un taglio
  /// incollato): le formiche attorno camminano finché non risponde.
  _waiting: Waiting | null = null;
  /// La colonna dove una serie di Tab è cominciata: Invio ci torna.
  _tabStart: number | null = null;
  /// Il disegno chiesto dallo scorrimento, uno per fotogramma.
  _renderFrame: number | null = null;
  /// Le righe disegnate restano: ognuna ricorda le sue celle, che cambiano
  /// solo se cambia ciò che mostrano (`_drawRow`).
  readonly _drawnRows = new WeakMap<HTMLElement, DrawnRow>();
  /// Un numero per ogni oggetto letto (la cella della finestra, lo stile, la
  /// carta): la firma di una cella li confronta per identità.
  readonly _refIds = new WeakMap<object, number>();
  _nextRefId = 1;
  /// Cresce quando cambia ciò che una cella mostra senza che cambino i suoi
  /// dati: la lingua (le descrizioni dei commenti).
  _cellEpoch = 0;
  /// Il foglio delle righe disegnate: un altro foglio le rifà tutte.
  _drawnSheet: string | null = null;
  /// I fili delle colonne della carta, per colonna: quelli delle colonne
  /// disegnate, nella carta del corpo o in quella della colonna ferma.
  readonly _paperRules = new Map<number, { readonly element: HTMLElement; left: number }>();
  _readOnly = false;
  /// L'effetto di un comando, da chi conosce il catalogo
  /// (`setCommandEffects`): in sola lettura passano soltanto `legge` e
  /// `mostra`, e le finestre di `_readOnlyDialogs`.
  _effectOf: (id: string) => GridCommandEffect | undefined = () => undefined;
  _readOnlyDialogs: ReadonlySet<string> = new Set();
  _destroyed = false;
  _providerCommitTail: Promise<void> = Promise.resolve();
  /// Annulla e ripeti dei gesti sulle celle. Un passo «nel giornale» è un
  /// comando che il provider ha ancora in cima al suo giornale (una formula
  /// scritta nella sessione a comandi): lo annulla il provider. Gli altri si
  /// annullano scrivendo l'input di prima, anche dopo che un salvataggio ha
  /// messo il giornale nei byte (IMP-027).
  _undo: HistoryStep[] = [];
  _redo: HistoryStep[] = [];
  /// Il gesto del puntatore sulle celle: una selezione che si allarga
  /// (celle, righe o colonne intere) o il quadratino di riempimento tirato.
  _drag: CellDrag | null = null;
  /// Dove stava il riquadro all'ultimo evento del gesto: se al rilascio sta
  /// altrove, ciò che c'è sopra ha cambiato misura e la cella sotto il punto
  /// fermo può essere un'altra.
  _dragSeen: { readonly left: number; readonly top: number } | null = null;
  _resize: ResizeDrag | null = null;
  /// Il dito giù, finché non è un tocco, un tocco lungo o uno scorrimento.
  _touch: TouchPress | null = null;
  /// L'ultimo puntatore è stato un dito: il quadratino non si mostra, perché
  /// col dito il riempimento si fa dal menu.
  _touchLast = false;
  /// Le due maniglie del tocco lungo, agli angoli della selezione.
  _grips = false;
  /// La cella che dichiara sua la cella aperta (`aria-owns`), finché è aperta:
  /// l'elemento disegnato e la sua posizione, perché ogni cella rifatta dal
  /// disegno porti lo stesso attributo.
  _editorOwner: { readonly cell: HTMLElement; readonly position: GridPosition } | null = null;
  /// L'ultimo tocco su una cella, per il doppio tocco che la apre.
  _lastTap: { readonly at: number; readonly position: GridPosition } | null = null;
  /// Gli altri intervalli di una selezione a più intervalli, sul foglio
  /// mostrato; quello in cui si lavora è `_selection`.
  _others: GridRange[] = [];
  /// Maiusc+F8: i movimenti tengono gli intervalli già scelti.
  _adding = false;
  /// Lo scorrimento mentre il gesto esce dal bordo della griglia.
  _dragScroll: ReturnType<typeof setInterval> | null = null;
  /// Il catalogo dei comandi sulla selezione, come il provider l'ha dato.
  _commands: GridCommandState[] = [];
  _commandsLoad: Promise<void> | null = null;
  _commandsQueued = false;
  /// Il giornale confermato è di comandi: annulla e ripeti sono del provider.
  _confirmedCommands = false;
  /// Le richieste in coda che porteranno la sessione ai comandi.
  _pendingCommandMode = 0;
  _frame: SheetFrame = {
    view: DEFAULT_SHEET_VIEW,
    zoom: 1,
    rowHeader: ROW_HEADER_WIDTH,
    columnHeader: COLUMN_HEADER_HEIGHT,
    frozenRows: 0,
    frozenColumns: 0,
    frozenHeight: 0,
    frozenWidth: 0,
  };
  /// La famiglia di caratteri della griglia, per un carattere del file che manca.
  _fallbackFont: string | null = null;
  /// La carta su cui i colori del file si portano, nell'aspetto adattato.
  _paper: Adapter | null = null;
  /// Le immagini lette, per impronta: restano fra una finestra e l'altra, e
  /// l'host non le rimanda.
  readonly _media = new GridMediaCache();
  /// Le finestre lette hanno portato immagini nuove: quelle a cui ne
  /// mancano si possono richiedere.
  _mediaAdded = false;
  /// L'elenco degli oggetti del foglio, per chi non li vede.
  readonly _objectsSummary: HTMLElement;
  /// L'oggetto selezionato (`objectKey`): la tastiera è sua finché c'è.
  _selectedObject: string | null = null;
  _objectGesture: ObjectGesture | null = null;
  /// Dove un oggetto spostato si mostra finché la finestra riletta non lo
  /// porta lì: vale finché l'oggetto è ancora quello di prima.
  _placed: { readonly key: string; readonly before: GridObject; readonly rect: ObjectRect; readonly zone: Zone } | null = null;
  /// Il testo di una casella di testo che si scrive.
  _objectText: { readonly key: string; readonly field: HTMLTextAreaElement; readonly original: string } | null = null;
  /// Ciò che si dice a chi non vede quando un oggetto si seleziona.
  readonly _objectsAnnounce: HTMLElement;
  /// L'avviso di una bozza la cui cella è cambiata sotto, con i due pulsanti.
  readonly _draftNotice: HTMLElement;
  readonly _draftText: HTMLElement;
  /// Ciò che vive quanto la griglia e si toglie con una vita: la scheda delle
  /// note e dei commenti.
  readonly _life: Lifetime = openLifetime();
  /// I segni della selezione, che restano e scivolano (`grid-motion.ts`).
  readonly _marks: MarksMotion;
  /// Il prossimo disegno dei segni salta al bersaglio: una selezione rimessa
  /// dall'host. Anche il cambio di foglio salta (`_marksSheet`).
  _marksJump = true;
  _marksSheet: string | null = null;
  /// La molla del prossimo disegno dei segni, se non è `GLIDE`: `SLIDE`
  /// quando una misura tirata sposta le colonne o le righe (griglia T5).
  _marksSpring: Spring | null = null;
  /// Le celle scritte che aspettano il provider (griglia T5), per foglio,
  /// riga e colonna: l'anteprima che `_showWritten` ha messo nella finestra.
  _written = new Map<string, WrittenCell>();
  /// Le anteprime di una formula scritta: tenui finché il provider non le
  /// rilegge (la sua cella è un oggetto nuovo).
  _pendingCells = new WeakSet<GridBytesCell>();
  /// Le misure tirate che aspettano il provider (griglia T5), dalla più
  /// vecchia: valgono subito nelle misure della griglia, e la più nuova vince.
  _sizePreviews: SizePreview[] = [];
  _sizeTickets = 0;
  /// La misura dell'etichetta di un bordo tirato all'ultimo disegno, nel
  /// verso del bordo, per metterla dentro il riquadro senza misurarla prima
  /// che ci sia.
  _resizeLabelSize = 0;

  constructor(parent: HTMLElement, options: GridEngineOptions) {
    const signal = this._abort.signal;
    this._options = options;
    this._root = document.createElement("div");
    this._root.className = "grid-surface";
    this._notice = document.createElement("p");
    this._notice.className = "grid-notice";
    this._notice.setAttribute("role", "status");
    this._notice.hidden = true;
    this._draftNotice = document.createElement("div");
    this._draftNotice.className = "grid-draft-notice";
    this._draftNotice.setAttribute("role", "alert");
    this._draftNotice.hidden = true;
    this._draftText = document.createElement("p");
    this._draftNotice.append(
      this._draftText,
      textButton({ label: t("grid.draft.keep"), kind: "primary", onPress: () => this._keepDraft() }),
      textButton({ label: t("grid.draft.take"), onPress: () => this._takeTheirs() }),
    );
    this._ribbonHost = document.createElement("div");
    this._ribbonHost.className = "grid-ribbon-host";
    this._sheetBar = document.createElement("div");
    this._sheetBar.className = "grid-sheets";
    this._sheetBar.hidden = true;

    const formula = document.createElement("div");
    formula.className = "grid-formula-bar";
    const name = document.createElement("span");
    name.className = "grid-cell-name";
    name.setAttribute("aria-hidden", "true");
    this._formulaHost = document.createElement("div");
    this._formulaHost.className = "grid-formula-editor";
    formula.append(name, this._formulaHost);

    this._viewport = document.createElement("div");
    this._viewport.className = "grid-viewport";
    this._viewport.tabIndex = 0;
    this._viewport.setAttribute("role", "grid");
    this._viewport.setAttribute("aria-label", t("grid.surface"));
    const part = (className: string, hidden = true): HTMLElement => {
      const element = document.createElement("div");
      element.className = className;
      if (hidden) element.setAttribute("aria-hidden", "true");
      return element;
    };
    this._plane = part("grid-plane", false);
    this._plane.setAttribute("role", "presentation");
    this._head = part("grid-head", false);
    this._body = part("grid-rows", false);
    const body = part("grid-marks-body");
    this._layers = { body, top: part("grid-marks-top"), left: part("grid-marks-left"), corner: part("grid-marks-corner") };
    this._lifts = { body, top: part("grid-lift-top"), left: part("grid-lift-left"), corner: part("grid-lift-corner") };
    this._fixed = part("grid-fixed");
    this._marks = createMarksMotion({
      layers: this._layers,
      lifts: this._lifts,
      lifetime: this._life,
      bands: () => this._bands(),
      title: (kind) => (kind === "handle" ? t("grid.fill.handle") : null),
    });
    this._sheetPaper = part("grid-paper");
    this._paperRulesHost = part("grid-paper-rules", false);
    this._sheetPaper.append(this._paperRulesHost);
    this._paperTop = part("grid-paper-top");
    this._paperCorner = part("grid-paper-corner");
    this._paperLeft = part("grid-paper-left");
    const leftStrips = [part("grid-paper-left-head", false), part("grid-paper-left-cells", false)];
    this._paperLeft.append(...leftStrips);
    this._paperStrips = [this._sheetPaper, ...leftStrips];
    // La testa prima del corpo, per chi legge: `sticky` e `z-index` la tengono
    // sopra comunque. La sua carta sta sotto le sue righe, i suoi livelli
    // dopo.
    this._head.append(this._paperTop, this._paperCorner, this._layers.top, this._lifts.top, this._layers.corner, this._lifts.corner);
    this._corner = document.createElement("div");
    this._corner.className = "grid-corner";
    this._cellEditorHost = document.createElement("div");
    this._cellEditorHost.className = "grid-cell-editor";
    this._cellEditorHost.id = `grid-${this._options.surfaceId}-editor`;
    this._cellEditorHost.hidden = true;
    this._cellEditorHost.setAttribute("aria-hidden", "true");
    this._cellEditorFrame = part("grid-cell-editor-frame");
    this._cellEditorField = part("grid-cell-editor-text", false);
    this._cellEditorHost.append(this._cellEditorFrame, this._cellEditorField);
    this._plane.append(this._head, this._body, body, this._paperLeft, this._layers.left, this._lifts.left, this._fixed, this._cellEditorHost);
    // La carta prima del piano, nel riquadro: `structure.css` dice perché.
    this._viewport.append(this._sheetPaper, this._plane);
    this._objectsSummary = document.createElement("p");
    this._objectsSummary.className = "grid-objects-summary sr-only";
    this._objectsSummary.id = `grid-${options.surfaceId}-objects`;
    this._objectsAnnounce = document.createElement("p");
    this._objectsAnnounce.className = "grid-objects-announce sr-only";
    this._objectsAnnounce.setAttribute("role", "status");
    this._root.append(this._ribbonHost, this._notice, this._draftNotice, formula, this._viewport, this._objectsSummary, this._objectsAnnounce, this._sheetBar);
    parent.replaceChildren(this._root);
    // Le preferenze si rileggono quando una delle due cambia: tutte le
    // griglie aperte, dal gesto dopo, senza riaprire il foglio.
    this._life.add(onEvent("setting_changed", (event) => {
      if (event.key === COPY_MARK_KEY || event.key === SELECTION_SPEED_KEY) void this._loadPreferences();
    }));
    void this._loadPreferences();
    this._stopLanguage = onLanguage(() => {
      this._cellEpoch += 1;
      this._viewport.setAttribute("aria-label", t("grid.surface"));
      this._decimal = decimalSeparator(resolvedLanguage());
      this._showNotice();
      this._sheetBar.querySelector(".kit-tabs")?.setAttribute("aria-label", t("grid.workbook.sheets"));
      if (!this._editing) this._syncFormulaBar();
      this._render();
    });

    // La barra della formula è sempre in «Modifica»: le frecce muovono il
    // cursore, Invio e Tab confermano e spostano come nella cella.
    const formulaProfile = createFormulaProfile({
      singleLine: false,
      callbacks: {
        commit: (_value, move, arrow) => this._commitAndMove(move, arrow),
        cancel: () => this._finishEditing(false, "input"),
      },
    });
    this._formulaEditor = createTextEngine(this._formulaHost, {
      onChange: (change) => this._draftFromEditor("formula", change.text),
      onSelectionChange: () => {},
      theme: options.theme,
      field: true,
      extensions: () => formulaProfile.extensions(),
    });
    this._cellTheme = options.theme;

    // Le righe si disegnano nel gestore dello scorrimento, non in un
    // fotogramma dopo: quelle nuove ci sono già nel fotogramma che le mostra.
    // Il resto (i segni, gli oggetti, la cella aperta) nel fotogramma. Il
    // caricamento chiede le sue misure prima che le righe scrivano: dopo,
    // obbligherebbe il browser a impaginare dentro il gestore.
    this._viewport.addEventListener("scroll", () => {
      void this._loadViewport();
      const view = this._readView();
      this._scrollView = view;
      if (this._workbook) this._renderRows(this._selectedRange(), true, view, Infinity, GRID_FRAME_NEW_ROWS);
      // Sotto il puntatore fermo passa un'altra cella: il gesto la prende.
      if (this._drag) this._dragTo(this._drag);
      this._scheduleRender();
    }, { signal });
    // L'editor della cella sta dentro la griglia, e i suoi eventi salgono fin
    // qui: battute, clic per spostare il cursore, appunti. Sono suoi, e la
    // griglia non li legge come gesti sulle celle (riaprirebbe la cella, la
    // chiuderebbe, o taglierebbe la selezione invece del testo).
    const grid = <E extends Event>(handler: (event: E) => void) => (event: E) => {
      if (event.target instanceof Node && this._cellEditorHost.contains(event.target)) return;
      handler(event);
    };
    this._viewport.addEventListener("keydown", grid((event) => this._keydown(event)), { signal });
    this._viewport.addEventListener("pointerdown", grid((event) => this._pointerDown(event)), { signal });
    this._viewport.addEventListener("pointermove", grid((event) => this._pointerMove(event)), { signal });
    this._viewport.addEventListener("pointerup", (event) => {
      this._endTouch(event, true);
      this._endResize(true);
      this._endDrag(true, event.ctrlKey || event.metaKey, { x: event.clientX, y: event.clientY });
      this._endObjectGesture(event, true);
    }, { signal });
    this._viewport.addEventListener("pointercancel", (event) => {
      this._endTouch(event, false);
      this._endResize(false);
      this._endDrag(false, false);
      this._endObjectGesture(event, false);
    }, { signal });
    // Col dito chi decide se il foglio scorre è `touch-action` (la griglia
    // dice `pan-x pan-y`); la presa di una maniglia invece è geometrica, e
    // la si ferma qui: un dito solo sulla maniglia la tira, non fa scorrere.
    // Due dita (lo zoom del sistema) passano.
    this._viewport.addEventListener("touchstart", (event) => {
      const finger = event.touches.length === 1 ? event.touches[0] : null;
      if (finger && this._gripAt(finger.clientX, finger.clientY)) event.preventDefault();
    }, { signal, passive: false });
    // Il tocco lungo mette le maniglie, non il menu: né quello del sistema né
    // quello dell'editor. Il mouse e la tastiera aprono il menu come sempre.
    this._viewport.addEventListener("contextmenu", (event) => {
      if (this._touch || ("pointerType" in event && (event as PointerEvent).pointerType === "touch")) event.preventDefault();
    }, { signal });
    this._life.add(() => this._stopDragScroll());
    this._life.add(() => this._cancelTouch());
    this._viewport.addEventListener("copy", grid((event) => this._copy(event)), { signal });
    this._viewport.addEventListener("cut", grid((event) => this._cut(event)), { signal });
    this._viewport.addEventListener("paste", grid((event) => this._paste(event)), { signal });
    this._viewport.addEventListener("dblclick", grid((event) => {
      // Col dito apre il doppio tocco (`_tap`), non il doppio clic che il
      // browser ne ricava.
      if (this._touchLast) return;
      // Sul bordo di un'intestazione il doppio clic adatta la misura.
      const edge = this._resizeEdge(event.clientX, event.clientY);
      if (edge) {
        const id = edge.axis === "column" ? "home.autofitColumnWidth" : "home.autofitRowHeight";
        const lines = this._resizeLines(edge);
        if (this._serves(id)) this.command(id, JSON.stringify(edge.axis === "column" ? { cols: lines } : { rows: lines }));
        return;
      }
      // Il puntatore è catturato dalla griglia dal `pointerdown`: il browser
      // dà il doppio clic a lei, e ciò che c'era sotto lo dice il punto.
      // Due clic che puntano una formula non aprono un'altra cella.
      if (this._pointing) return;
      const target = event.target === this._viewport
        ? document.elementFromPoint?.(event.clientX, event.clientY) ?? null
        : event.target instanceof Element ? event.target : null;
      if (!target || !this._viewport.contains(target)) return;
      if (target.closest(".grid-object-text-editor")) return;
      if (this._onFillHandle(event.clientX, event.clientY)) {
        this._fillToNeighbour();
        return;
      }
      const object = target.closest<HTMLElement>(".grid-object");
      if (object) {
        if (object.dataset.object) this._beginObjectText(object.dataset.object);
        return;
      }
      const position = this._pressedCell(target, event.clientX, event.clientY);
      if (position) this._beginEditing("cell", this._anchorOf(position), undefined, "edit");
    }), { signal });
    this._formulaHost.addEventListener("focusin", () => {
      // Dalla cella aperta alla barra la bozza passa con lei.
      if (this._editing?.owner === "cell") {
        const draft = this._editing.draft;
        this._finishEditing(false, "input", false);
        this._beginEditing("formula", this._active(), draft, "edit");
        return;
      }
      this._beginEditing("formula", this._active());
    }, { signal });
    this._formulaHost.addEventListener("focusout", () => this._commitAfterBlur("formula"), { signal });
    // Un clic altrove, o il fuoco che se ne va, conferma la cella, come la
    // barra della formula; non quando il fuoco passa alla barra.
    this._cellEditorHost.addEventListener("focusout", (event) => {
      if (
        event.relatedTarget instanceof Node
        && (this._formulaHost.contains(event.relatedTarget) || this._draftNotice.contains(event.relatedTarget))
      ) return;
      this._commitAfterBlur("cell");
    }, { signal });
    attachCommentCards({
      root: this._viewport,
      lifetime: this._life,
      comment: (cell) => {
        const position = this._positionOf(cell);
        return position ? this._workbookCell(position)?.bytes?.comment ?? null : null;
      },
      address: (cell) => {
        const position = this._positionOf(cell);
        return position ? cellA1(position) : "";
      },
      serves: (id) => this.commandable() && this._commands.some((command) => command.id === id && command.enabled),
      run: (id, params) => this.run(id, JSON.stringify(params)),
      edit: (cell) => {
        const position = this._positionOf(cell);
        if (!position) return;
        this._select(position, false);
        this.focus();
        const threaded = cell.dataset.comment === "thread";
        this.openDialog(threaded ? "comment" : "note", JSON.stringify({ threaded }));
      },
    });
  }
  setDoc(source: string): void {
    if (this._destroyed) return;
    this._openWorkbook(source, true);
  }

  /// Il campo della cella aperta, creato adesso se non c'è ancora: soltanto
  /// chi apre una cella lo chiede.
  get _cellEditor(): TextEngine {
    this._cellEngine ??= this._createCellEditor();
    return this._cellEngine;
  }

  /// Se il campo della cella aperta è già nato (le prove lo guardano).
  cellEditorMounted(): boolean {
    return this._cellEngine !== null;
  }

  _createCellEditor(): TextEngine {
    const profile = createFormulaProfile({
      singleLine: false,
      callbacks: {
        commit: (_value, move, arrow) => this._commitAndMove(move, arrow),
        cancel: () => this._finishEditing(false, "input"),
        arrowsCommit: () => this._editing?.mode === "insert",
        toggleMode: () => this._toggleEditMode(),
        point: (move, extend) => this._pointByKey(move, extend),
      },
    });
    const engine = createTextEngine(this._cellEditorField, {
      onChange: (change) => this._draftFromEditor("cell", change.text),
      onSelectionChange: () => {},
      theme: this._cellTheme,
      field: true,
      extensions: () => profile.extensions(),
    });
    if (this._readOnly) engine.setReadOnly(true);
    return engine;
  }

  syncDoc(update: { readonly text: string; readonly operation: TextOperation | null } | string): void {
    if (this._destroyed) return;
    const source = typeof update === "string" ? update : update.text;
    // Il giornale che la griglia ha già, sugli stessi byte: niente da fare.
    // Altrimenti è cambiato altrove (un altro riquadro, un salvataggio che
    // l'ha messo nei byte, una ricarica) e la griglia si riapre.
    if (source === this._journal && this._currentBase() === this._bytesBase) return;
    this._openWorkbook(source, false);
  }

  getDoc(): string { return this._journal; }

  /// Il giornale con dentro la cella aperta, come lo scriverebbe la sua
  /// conferma; `null` se la cella non tiene niente di nuovo, o se la conferma
  /// passa dal provider (una sessione a comandi, una formula): allora la
  /// bozza tiene l'ultimo giornale accettato. Non cambia niente.
  pendingText(): string | null {
    const editing = this._editing;
    if (this._destroyed || !editing || editing.draft === editing.original || this._readOnly || !this._view) return null;
    if (this._commandMode() || this._writeRefusal(editing.position)) return null;
    const coordinate = coordinateAt(this._sheet(), editing.position);
    if (!coordinate) return null;
    const after = fileInput(editing.draft, this._decimal);
    const current = this._workbookCell(editing.position)?.bytes.input ?? "";
    try {
      const journal = parseGridJournal(this._journal);
      if (after.startsWith("=") && gridJournalEntry(journal, coordinate)?.before !== after) return null;
      return after === current ? this._journal : gridJournalText(recordGridJournal(journal, coordinate, current, after));
    } catch {
      return null;
    }
  }

  /// Conferma adesso la cella aperta, come Invio senza spostarsi. La
  /// conferma arriva al giornale definitivo col suo turno della coda del
  /// provider (subito in anticipo per un valore, soltanto allora per una
  /// formula o in una sessione a comandi): la promessa dice quando, e chi
  /// salva o chiude la sessione la aspetta.
  commitPending(): Promise<void> | undefined {
    if (this._destroyed || !this._pendingNow()) return undefined;
    const ticket = this._bytesTickets;
    this._finishEditing(true, "input", false);
    return this._bytesTickets !== ticket ? this._providerCommitTail : undefined;
  }

  /// Avvisa a ogni cambio del testo della cella aperta, con `true` finché
  /// ce n'è di non confermato. Il disposer ferma gli avvisi.
  watchPending(listener: (pending: boolean) => void): () => void {
    this._pendingWatchers.add(listener);
    return () => this._pendingWatchers.delete(listener);
  }

  _pendingNow(): boolean {
    const editing = this._editing;
    return editing !== null && editing.draft !== editing.original;
  }

  /// Ogni battuta conta (la sessione riarma la bozza su ogni cambio); quando
  /// non resta niente lo si dice una volta.
  _pendingChanged(): void {
    const pending = this._pendingNow();
    if (!pending && !this._pendingSaid) return;
    this._pendingSaid = pending;
    for (const listener of [...this._pendingWatchers]) listener(pending);
  }

  selection(): GridSelection {
    const { anchor, focus, active } = this._selection;
    return active
      ? { anchor: { ...anchor }, focus: { ...focus }, active: { ...active } }
      : { anchor: { ...anchor }, focus: { ...focus } };
  }

  /// Le celle tagliate in attesa di un incolla, sul foglio di adesso, o
  /// `null`: lo stesso segno della Tabella (`TableFrame.cutRange`).
  cutRange(): { r0: number; c0: number; r1: number; c1: number } | null {
    const mark = this._cutMark;
    return mark && mark.sheet === this._sheet().id ? tableRange(mark.range) : null;
  }

  /// Quanti intervalli sono scelti (Ctrl+clic, Maiusc+F8).
  rangeCount(): number {
    return this._others.length + 1;
  }

  /// Il modo della cella: «Pronto», «Inserisci» o «Modifica».
  editMode(): GridEditMode {
    return this._editing?.mode ?? "ready";
  }

  renderedCellCount(): number {
    return this._viewport.querySelectorAll(".grid-cell").length;
  }

  focus(): void {
    if (this._destroyed) return;
    // Una cella aperta (Inserisci funzione l'ha appena cominciata) tiene il
    // fuoco nel suo campo: la griglia lo prenderebbe chiudendola.
    if (this._editing) (this._editing.owner === "cell" ? this._cellEditor : this._formulaEditor).focus();
    else this._viewport.focus();
  }

  /** Il testo della selezione da leggere ([`selectionText`]), o `null` oltre il tetto. */
  selectedText(): { primary: string; secondary: string[] } | null {
    if (this._destroyed || !this._workbook) return null;
    const range = normalizedSelection(this._selection);
    const cells = (range.rowEnd - range.rowStart + 1) * (range.columnEnd - range.columnStart + 1);
    if (cells > SELECTED_TEXT_CELLS) return null;
    return { primary: selectionText(this._selection, (position) => this._cellAt(position)), secondary: [] };
  }

  setReadOnly(requested: boolean): void {
    const readOnly = requested;
    const changed = readOnly !== this._readOnly;
    this._readOnly = readOnly;
    this._formulaEditor.setReadOnly(readOnly);
    this._cellEngine?.setReadOnly(readOnly);
    this._root.dataset.readOnly = String(readOnly);
    if (readOnly) this._finishEditing(false, "input");
    // Quali comandi si danno cambia con la sola lettura: la barra si rilegge.
    if (changed && !this._destroyed) this._options.onCommands?.();
  }

  setTheme(theme: Theme): void {
    this._formulaEditor.setTheme(theme);
    this._cellTheme = theme;
    this._cellEngine?.setTheme(theme);
    this._root.dataset.theme = theme;
  }

  /// La carta del tema nell'aspetto adattato, o `null` negli altri: le celle
  /// si ridipingono soltanto se cambia.
  setPaper(paper: Paper | null): void {
    const next = paper ? adapter(paper) : null;
    if (next === this._paper) return;
    this._paper = next;
    this._render();
  }

  undo(): boolean {
    if (this._providerHistory()) return this._documentHistory(UNDO);
    if (this._refuseStaleHistory()) return false;
    return this._history(this._undo, this._redo, UNDO, (step) => this._commit(inverseGridPatches(step.patches), "undo", false));
  }

  redo(): boolean {
    if (this._providerHistory()) return this._documentHistory(REDO);
    if (this._refuseStaleHistory()) return false;
    return this._history(this._redo, this._undo, REDO, (step) => this._commit(step.patches, "redo", false));
  }

  /// Il catalogo dei comandi sulla selezione: vuoto se la sessione non ne
  /// serve.
  commands(): readonly GridCommandState[] {
    return this._commands;
  }

  /// Lo stile della cella attiva, per lo stato dei controlli della barra.
  activeStyle(): GridBytesStyle | undefined {
    return this._workbookCell(this._active())?.style;
  }

  /// Dove la barra multifunzione si monta, sopra la barra della formula.
  ribbonHost(): HTMLElement {
    return this._ribbonHost;
  }

  /// La vista del foglio mostrato.
  sheetView(): GridSheetView {
    return this._sheetView();
  }

  /// Il lettore dei PDF per l'anteprima di stampa, se la shell ne ha uno.
  pdfLoader(): PdfEngineLoader | null {
    return this._options.pdf ?? null;
  }

  /// L'esportazione in PDF, se la shell la offre adesso.
  pdfExport(): (() => void) | null {
    const exporting = this._options.exportPdf;
    if (!exporting || !this._bytes || !exporting.available()) return null;
    return () => {
      this._finishEditing(true, "input", false);
      exporting.run();
    };
  }

  /// L'oggetto selezionato, per le schede che lo cambiano.
  selectedObject(): GridObject | null {
    return this._objects().find((object) => objectKey(object) === this._selectedObject) ?? null;
  }

  /// Le tabelle lette del foglio mostrato.
  tables(): readonly GridTable[] {
    return this._view?.sheets[this._sheetIndex]?.tables ?? [];
  }

  /// Ciò che vale per la cartella; `null` finché nessuna sessione è mostrata.
  book(): GridBook | null {
    return this._shownSession?.book ?? null;
  }

  /// I fogli nascosti della cartella, per scoprirli.
  hiddenSheets(): readonly { id: string; name: string }[] {
    const session = this._shownSession;
    if (!session) return [];
    return session.sheets
      .filter((sheet) => session.hidden.includes(sheet.id))
      .map((sheet) => ({ id: sheet.id, name: sheet.name }));
  }

  /// Dice alla griglia l'effetto di ogni comando e le finestre scritte a
  /// mano che non cambiano niente: in sola lettura lascia passare soltanto
  /// quelli. Senza, in sola lettura non passa niente.
  setCommandEffects(effectOf: (id: string) => GridCommandEffect | undefined, readOnlyDialogs: Iterable<string> = []): void {
    this._effectOf = effectOf;
    this._readOnlyDialogs = new Set(readOnlyDialogs);
  }

  /// Se la sessione serve dei comandi, anche in sola lettura: quelli che
  /// leggono o cambiano soltanto ciò che si vede si danno lo stesso.
  servesCommands(): boolean {
    return !this._destroyed && this._bytes !== null && this._commands.length > 0;
  }

  /// Se i comandi si possono dare adesso: una sessione che ne serve, e un
  /// documento che si modifica.
  commandable(): boolean {
    return !this._destroyed && this._bytes !== null && !this._readOnly && this._commands.length > 0;
  }

  /// La misura della parte della griglia che si vede, in pixel CSS.
  viewportSize(): { width: number; height: number } {
    return { width: this._viewport.clientWidth, height: this._viewport.clientHeight };
  }

  /// Scrive `text` dove si sta scrivendo una cella, al cursore; senza una
  /// cella aperta, apre la cella attiva con `=` e `text`: una funzione da
  /// cominciare (`SOMMA(`) o un nome definito.
  writeFormula(text: string): boolean {
    if (this._destroyed || this._readOnly || !this._workbook) return false;
    if (this._editing) {
      const editor = this._editing.owner === "cell" ? this._cellEditor : this._formulaEditor;
      const written = editor.insertAtCursor(text);
      editor.focus();
      return written;
    }
    this._beginEditing("cell", this._active(), `=${text}`);
    if (!this._editing) return false;
    this._cellEditor.focus();
    return true;
  }

  /// Chiede al provider un comando che soltanto legge, come l'elenco delle
  /// funzioni: il risultato come testo JSON, o `null` se non arriva. La
  /// cartella, la selezione e la cronologia restano come sono.
  query(id: string, params = "{}"): Promise<string | null> {
    if (!QUERIES.has(id) || !this._bytes || !this._serves(id)) return Promise.resolve(null);
    if (READ_WITHOUT_PARAMS.has(id) && params.trim() !== "{}") return Promise.resolve(null);
    const command: GridCommand = { id, params, ...this._commandSelection() };
    const epoch = this._bytesEpoch;
    return new Promise((resolve) => {
      this._enqueueProtocol(async () => {
        const host = this._options.grid;
        const state = this._bytes;
        if (!host || !state || this._destroyed || epoch !== this._bytesEpoch) {
          resolve(null);
          return;
        }
        try {
          const outcome = await host.gridBytesCommand(state.surface, state.instance, { revision: state.session.revision, command });
          const edit = outcome.commit.edit;
          resolve(edit.from === edit.to && !edit.inserted ? outcome.result : null);
        } catch {
          resolve(null);
        }
      });
    });
  }

  /// Dà il comando `id` del catalogo sulla selezione, con i parametri come
  /// testo di un oggetto JSON. Falso se il catalogo non lo serve acceso.
  command(id: string, params = "{}"): boolean {
    return this._command(id, params);
  }

  /// Dà il comando `id` come `command`, e rende come è andato: il risultato
  /// del provider, o la ragione per cui non l'ha dato. Per le finestre di
  /// dialogo, che dicono il rifiuto dentro di sé e non in un avviso della
  /// griglia. `error: null` vuol dire che il comando non è arrivato: la
  /// cartella è cambiata sotto, o la griglia è stata smontata.
  run(id: string, params = "{}"): Promise<GridRun> {
    const state = this._commands.find((command) => command.id === id);
    if (!this._bytes || !this._allowed(id) || !state) return Promise.resolve({ ok: false, error: null });
    if (!state.enabled) return Promise.resolve({ ok: false, error: state.reason ?? null });
    this._finishEditing(true, "input", false);
    return new Promise((resolve) => this._give(id, params, false, resolve));
  }

  /// Chiede alla shell la finestra `id` (`onDialog`), come la chiederebbe
  /// un comando: per le finestre che nessun comando del catalogo apre da sé.
  openDialog(id: string, params = "{}"): boolean {
    const allowed = this._readOnly ? this.servesCommands() && this._readOnlyDialogs.has(id) : this.commandable();
    if (!allowed || !this._options.onDialog) return false;
    this._finishEditing(true, "input", false);
    this._options.onDialog({ id, params });
    return true;
  }

  /// Il tasto destro nel punto `x`, `y` della finestra, come in Excel: su un
  /// oggetto lo seleziona; sulla linguetta di un foglio lo mostra; su una
  /// cella, una riga o una colonna fuori dalla selezione la sceglie, dentro
  /// la lascia com'è. Torna su cosa si è premuto, o `null` fuori dalla griglia.
  pointAt(x: number, y: number): "cell" | "row" | "column" | "corner" | "sheet" | "object" | null {
    if (this._destroyed || !this._workbook) return null;
    const element = document.elementFromPoint(x, y);
    if (!element || !this._root.contains(element)) return null;
    const tab = this._sheetBar.contains(element) ? element.closest<HTMLElement>("[data-tab]") : null;
    if (tab) {
      const index = this._workbook.sheets.findIndex((sheet) => sheet.id === tab.dataset.tab);
      if (index < 0) return null;
      this._showSheetAt(index);
      return "sheet";
    }
    const object = element.closest<HTMLElement>(".grid-object");
    const key = object?.dataset.object ?? null;
    if (key && this._objectByKey(key)) {
      this._finishEditing(true, "input", false);
      this._selectObject(key);
      return "object";
    }
    if (!this._viewport.contains(element)) return null;
    const cell = this._pressedCell(element, x, y);
    const hit = cell ?? this._hit(x, y, false);
    if (!hit) return null;
    if (this._selectedObject !== null) this._selectObject(null);
    const sheet = this._sheet();
    const lastRow = Math.max(0, sheet.rows.length - 1);
    const lastColumn = Math.max(0, sheet.columns.length - 1);
    const range = normalizedSelection(this._selection);
    const kind = hit.row === null && hit.column === null ? "all" : hit.row === null ? "columns" : hit.column === null ? "rows" : "cells";
    let next: GridSelection | null = null;
    if (kind === "all") {
      next = { anchor: { row: lastRow, column: lastColumn }, focus: { row: 0, column: 0 } };
    } else {
      const position = { row: hit.row ?? 0, column: hit.column ?? 0 };
      const whole = kind === "rows"
        ? range.columnStart === 0 && range.columnEnd === lastColumn
        : kind === "columns" ? range.rowStart === 0 && range.rowEnd === lastRow : true;
      const inside = whole
        && (kind === "columns" || (position.row >= range.rowStart && position.row <= range.rowEnd))
        && (kind === "rows" || (position.column >= range.columnStart && position.column <= range.columnEnd));
      if (!inside) {
        const anchor = this._anchorOf(position);
        next = kind === "cells" ? { anchor, focus: anchor } : this._dragSelection(kind, anchor, position);
      }
    }
    if (next) {
      this._finishEditing(true, "input", false);
      this._others = [];
      this._selection = next;
      this._syncFormulaBar();
      this._render();
      this._selectionChanged();
    }
    return kind === "all" ? "corner" : kind === "rows" ? "row" : kind === "columns" ? "column" : "cell";
  }

  /// Il riquadro della cella attiva nella finestra, per aprire il menu dalla
  /// tastiera.
  activeCellBox(): { left: number; top: number; right: number; bottom: number } | null {
    const cell = this._viewport.querySelector<HTMLElement>(".grid-cell.active");
    const box = (cell ?? this._viewport).getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  }

  /// Si scrive nelle celle: una cartella letta e un documento non in sola
  /// lettura.
  writable(): boolean {
    return !this._destroyed && !this._readOnly && this._workbook !== null;
  }

  /// Sceglie tutto il foglio, come l'angolo delle intestazioni.
  selectAll(): void {
    if (this._destroyed || !this._workbook) return;
    const sheet = this._sheet();
    if (this._selectedObject !== null) this._selectObject(null);
    this._others = [];
    this._selection = {
      anchor: { row: Math.max(0, sheet.rows.length - 1), column: Math.max(0, sheet.columns.length - 1) },
      focus: { row: 0, column: 0 },
      active: { row: this._edgeVisible("row", false), column: this._edgeVisible("column", false) },
    };
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
  }

  /// La selezione come la copia Mod-c: testo separato da tabulazioni.
  selectionTsv(): string {
    return selectionTsv(this._selection, (position) => this._cellAt(position));
  }

  /// Incolla `text` (righe e tabulazioni) dalla cella attiva, come Mod-v.
  pasteText(text: string): void {
    if (this._readOnly || this._destroyed) return;
    this._pasteTsv(text);
  }

  /// Svuota le celle scelte, come Canc.
  clearCells(): void {
    this._clearSelection();
  }

  /// La selezione come la scrive una formula: il nome del foglio,
  /// l'intervallo e la cella attiva in A1.
  selectionRefs(): { readonly sheet: string; readonly range: string; readonly active: string } {
    return {
      sheet: this._sheet().name,
      range: rangeA1(this._selectedRange()),
      active: cellA1(this._active()),
    };
  }

  /// I nomi dei fogli della cartella, nell'ordine.
  sheetNames(): readonly string[] {
    return this._shownSession?.sheets.map((sheet) => sheet.name) ?? [];
  }

  /// L'altezza della riga o la larghezza della colonna `index` del foglio
  /// mostrato, nei pixel della cartella; `null` se non è letta.
  lineSize(axis: "row" | "column", index: number): number | null {
    const sheet = this._sheet();
    const size = axis === "row" ? sheet.rows[index]?.height : sheet.columns[index]?.width;
    return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : null;
  }

  /// Legge le due preferenze della griglia, come `TextEngine` legge le sue.
  /// Le tiene soltanto: il segno che scivola finisce la sua corsa, e la scelta
  /// nuova vale dal gesto dopo. Senza un vault, o se la lettura fallisce,
  /// restano quelle di prima.
  async _loadPreferences(): Promise<void> {
    const read = ++this._preferencesRead;
    let entries: Awaited<ReturnType<typeof settings>>;
    try {
      entries = await settings();
    } catch {
      return;
    }
    if (this._destroyed || read !== this._preferencesRead) return;
    const value = (key: string) => entries.find((entry) => entry.spec.key === key)?.value;
    this._copyMarkStyle = copyMarkOf(value(COPY_MARK_KEY));
    this._selectionSpeed = selectionSpeedOf(value(SELECTION_SPEED_KEY));
  }

  /// Toglie il tratteggio di ciò che si è copiato, se c'è.
  _dropCopyMark(): void {
    if (!this._copyMark) return;
    this._copyMark = null;
    if (this._workbook) this._updateMarks(this._selectedRange());
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._stopLanguage();
    this._abort.abort();
    if (this._renderFrame !== null) cancelAnimationFrame(this._renderFrame);
    this._renderFrame = null;
    this._bytesEpoch++;
    this._closeBytes();
    this._sheetTabs?.lifetime.close();
    this._sheetTabs = null;
    this._formulaEditor.destroy();
    this._cellEngine?.destroy();
    this._cellEngine = null;
    this._media.clear();
    this._life.close();
    this._root.remove();
  }

  /// La vista del foglio mostrato, come l'ultima finestra letta la dà.
  _sheetView(): GridSheetView {
    return this._view?.sheets[this._sheetIndex]?.view ?? DEFAULT_SHEET_VIEW;
  }

  /// Le unioni lette del foglio mostrato.
  _merges(): readonly GridMerge[] {
    return this._view?.sheets[this._sheetIndex]?.merges ?? [];
  }

  _rebuildLayout(): void {
    const sheet = this._sheet();
    const view = this._sheetView();
    const zoom = view.zoom / 100;
    // Una misura tirata vale subito, finché il provider non risponde.
    const previews = this._sizePreviews.filter((preview) => preview.sheet === sheet.id);
    this._rows = axisLayout(previewSizes(sheet.rows, "height", previews.filter((preview) => preview.axis === "row")), DEFAULT_ROW_HEIGHT, "height", zoom);
    this._columns = axisLayout(previewSizes(sheet.columns, "width", previews.filter((preview) => preview.axis === "column")), DEFAULT_COLUMN_WIDTH, "width", zoom);
    const frozenRows = Math.min(view.frozen_rows, this._rows.sizes.length);
    const frozenColumns = Math.min(view.frozen_columns, this._columns.sizes.length);
    this._frame = {
      view,
      zoom,
      rowHeader: view.headings ? Math.round(ROW_HEADER_WIDTH * zoom) : 0,
      columnHeader: view.headings ? Math.round(COLUMN_HEADER_HEIGHT * zoom) : 0,
      frozenRows,
      frozenColumns,
      frozenHeight: this._rows.offsets[frozenRows] ?? 0,
      frozenWidth: this._columns.offsets[frozenColumns] ?? 0,
    };
    // La misura del piano e delle fasce ferme, per gli strati di `structure.css`.
    const plane = this._plane.style;
    const bands = this._bands();
    plane.setProperty("--grid-w", `${this._frame.rowHeader + this._columns.total}px`);
    plane.setProperty("--grid-h", `${this._frame.columnHeader + this._rows.total}px`);
    plane.setProperty("--grid-top-h", `${bands.top}px`);
    plane.setProperty("--grid-left-w", `${bands.left}px`);
    // La carta: l'altezza di serie delle righe su cui ripete i fili, e la
    // misura delle intestazioni, per la sua copia nelle fasce ferme.
    this._paperPeriod = commonSize(this._rows, Math.round(DEFAULT_ROW_HEIGHT * zoom));
    this._viewport.style.setProperty("--grid-row", `${this._paperPeriod}px`);
    this._paperPlaced = "";
    plane.setProperty("--grid-head-h", `${this._frame.columnHeader}px`);
    plane.setProperty("--grid-head-w", `${this._frame.rowHeader}px`);
    this._paperTop.hidden = bands.top === 0;
    this._paperLeft.hidden = bands.left === 0;
    (this._paperLeft.firstElementChild as HTMLElement).hidden = this._frame.rowHeader === 0;
    this._paperCorner.hidden = bands.top === 0 || bands.left === 0;
    plane.fontSize = zoom === 1 ? "" : `${(zoom * 100).toFixed(1)}%`;
    this._viewport.classList.toggle("no-gridlines", !view.gridlines);
    this._viewport.setAttribute("aria-rowcount", String(sheet.rows.length + 1));
    this._viewport.setAttribute("aria-colcount", String(sheet.columns.length + 1));
  }

  /// La famiglia di caratteri della griglia, letta una volta.
  _gridFont(): string {
    this._fallbackFont ??= getComputedStyle(this._viewport).fontFamily ?? "";
    return this._fallbackFont;
  }

  /// Le righe (o le colonne) da disegnare: quelle bloccate, quelle dello
  /// schermo con un riquadro di margine prima e dopo, e quella della cella
  /// che si scrive.
  _renderedIndices(layout: AxisLayout, frozen: number, frozenSize: number, scroll: number, extent: number, editing: number | null): number[] {
    const window = marginWindow(layout, scroll + frozenSize, Math.max(0, extent - frozenSize));
    const out: number[] = [];
    for (let index = 0; index < frozen; index += 1) out.push(index);
    for (let index = Math.max(frozen, window.start); index <= window.end; index += 1) out.push(index);
    if (editing !== null && editing >= 0 && editing < layout.sizes.length && !out.includes(editing)) {
      out.push(editing);
      out.sort((left, right) => left - right);
    }
    return out;
  }

  /// La sinistra di una colonna nel piano. Una colonna bloccata la tiene
  /// ferma `sticky`, non lo scorrimento sommato qui.
  _columnLeft(column: number): number {
    return this._frame.rowHeader + this._columns.offsets[column];
  }

  /// La misura delle fasce ferme nel piano: l'altezza della testa e la
  /// larghezza della colonna ferma, ognuna col suo filo sull'ultimo pixel.
  _bands(): Bands {
    const frame = this._frame;
    return { top: frame.columnHeader + frame.frozenHeight, left: frame.rowHeader + frame.frozenWidth };
  }

  /// Quanto una zona è scorsa: le fasce ferme non scorrono nel loro verso.
  _zoneScroll(frozenColumn: boolean, frozenRow: boolean): { left: number; top: number } {
    return { left: frozenColumn ? 0 : this._viewport.scrollLeft, top: frozenRow ? 0 : this._viewport.scrollTop };
  }

  /// Mette `element` nel disegno di `container`.
  _draw(drawing: Drawing, container: HTMLElement, element: HTMLElement): void {
    const list = drawing.get(container);
    if (list) list.push(element);
    else drawing.set(container, [element]);
  }

  /// Un segno a rettangolo (`box` nel piano): un pezzo per zona che tocca,
  /// tagliato da `marks.ts`, nel livello della sua zona.
  _rectMark(drawing: Drawing, className: string, box: { left: number; top: number; width: number; height: number }): void {
    const rect: Rect = { x: box.left, y: box.top, w: box.width, h: box.height };
    for (const piece of rectPieces(rect, this._bands(), { bleed: MARK_BLEED })) {
      const element = document.createElement("div");
      element.className = className;
      element.setAttribute("aria-hidden", "true");
      this._place(element, piece.rect.x, piece.rect.y, piece.rect.w, piece.rect.h);
      this._draw(drawing, this._layers[piece.zone], element);
    }
  }

  /// Il disegno intero: le righe (`rows`), poi i segni, la cella aperta e
  /// ciò che chi legge sente. Il fotogramma chiesto dallo scorrimento, che
  /// le righe le ha già disegnate nel suo gestore, non le rifà.
  ///
  /// `loaded` (una finestra arrivata, `_showView`): le righe con le misure
  /// lette dal gestore dello scorrimento, e la misura delle celle al
  /// fotogramma chiesto.
  _render(rows = true, loaded = false): void {
    if (!this._workbook) return;
    const range = this._selectedRange();
    if (rows && loaded) this._renderRows(range, true, this._scrollView, GRID_FRAME_REFILLS, GRID_FRAME_NEW_ROWS);
    else if (rows) this._renderRows(range);
    else if (this._rowsBehind) this._renderRows(range, true, this._scrollView, GRID_FRAME_REFILLS, GRID_FRAME_NEW_ROWS);
    if (loaded) this._scheduleRender();
    else this._fitPending();
    this._settleWritten();
    // I segni, ognuno nel livello della zona dove cade.
    const drawing: Drawing = new Map();
    this._objectElements(drawing);
    this._updateMarks(range);
    this._resizeMarks(drawing);
    this._moveMarks(drawing);
    this._referenceMarks(drawing);
    this._viewport.classList.toggle("filling", this._drag?.kind === "fill");
    this._viewport.classList.toggle("moving", this._drag?.kind === "move");

    // Ciò che non cambia resta: la cella sotto il puntatore riceve il clic e
    // il doppio clic. I pezzi dei segni che restano (`_marks`) non passano di
    // qui, né la cella aperta, che sta in fondo al suo livello «lift» e non
    // perde il fuoco: ciò che si disegna ci va prima.
    const host = this._cellEditorHost;
    for (const container of new Set([...Object.values(this._layers), ...Object.values(this._lifts), this._fixed])) {
      const drawn = [...container.children].filter((element) => !this._marks.owns(element) && element !== host) as HTMLElement[];
      this._reconcile(container, drawn, drawing.get(container) ?? [], host.parentElement === container ? host : null);
    }
    this._fitResizeLabel();
    const editing = this._editing?.owner === "cell" ? this._editing : null;
    if (editing) {
      const cell = this._findCell(editing.position);
      if (cell && this._isVisiblePosition(editing.position)) {
        this._mountCellEditor(editing.position, cell);
        this._positionEditor(editing.position);
      } else {
        this._editing = null;
        this._cellEditorHost.hidden = true;
        this._cellEditorHost.setAttribute("aria-hidden", "true");
        this._editorForReaders(null);
        this._plane.append(this._cellEditorHost);
        this._pendingChanged();
      }
    }
    const active = this._active();
    if (this._isVisiblePosition(active) && this._findCell(active)) {
      setAttributeIfChanged(this._viewport, "aria-activedescendant", this._cellId(active));
    } else {
      this._viewport.removeAttribute("aria-activedescendant");
    }
    const name = this._root.querySelector<HTMLElement>(".grid-cell-name");
    if (name) {
      const label = this._isVisiblePosition(active) ? cellA1(active) : "";
      if (name.textContent !== label) name.textContent = label;
    }
  }

  /// Le righe: quelle bloccate nella testa, le altre nel corpo, con un
  /// riquadro di margine sopra e sotto (e a sinistra e a destra per le
  /// colonne). Le righe che restano non si rifanno: uno scorrimento ne
  /// aggiunge e ne toglie solo ai bordi, un salto (o un altro foglio) le
  /// rifà tutte perché nessuna resta. Una cella cambia solo se cambia ciò che
  /// mostra, e si aggiorna sul posto (`_drawRow`).
  ///
  /// Le misure del riquadro si leggono tutte prima di scrivere, così il
  /// gestore dello scorrimento non obbliga il browser a impaginare a metà.
  /// Le celle da misurare (i numeri, quelle che si stringono) le misura
  /// `_fitPending`: subito, o con `deferFit` nel fotogramma chiesto, prima
  /// che il fotogramma si dipinga.
  _renderRows(range: GridRange, deferFit = false, known: PaperView | null = null, refills = Infinity, newRows = Infinity): void {
    const frame = this._frame;
    this._refills = refills;
    this._rowsBehind = false;
    const view = known ?? this._readView();
    const sheet = this._sheet().id;
    if (sheet !== this._drawnSheet) {
      this._drawnSheet = sheet;
      for (const parent of [this._head, this._body]) {
        for (const row of [...parent.children]) if (isDataRow(row)) row.remove();
      }
    }
    const editingPosition = this._editing?.owner === "cell" ? this._editing.position : null;
    const drawnIn = (parent: HTMLElement) => {
      const rows = new Map<number, HTMLElement>();
      for (const element of parent.children) if (isDataRow(element)) rows.set(Number(element.dataset.row), element);
      return rows;
    };
    const drawnHead = drawnIn(this._head);
    const drawnBody = drawnIn(this._body);
    const renderedRows = this._drawableRows(
      this._renderedIndices(
        this._rows, frame.frozenRows, frame.frozenHeight, view.scrollTop,
        view.height - frame.columnHeader, editingPosition?.row ?? null,
      ),
      view,
      (row) => drawnHead.has(row) || drawnBody.has(row) || row === editingPosition?.row,
      newRows,
    );
    const renderedColumns = this._renderedIndices(
      this._columns, frame.frozenColumns, frame.frozenWidth, view.scrollLeft,
      view.width - frame.rowHeader, editingPosition?.column ?? null,
    );
    const merges = this._merges();
    const firstRow = renderedRows[0] ?? 0;
    const lastRow = renderedRows[renderedRows.length - 1] ?? -1;
    const firstColumn = renderedColumns[0] ?? 0;
    const lastColumn = renderedColumns[renderedColumns.length - 1] ?? -1;
    // Le unioni sullo schermo: ognuna si disegna una volta, nella prima riga
    // disegnata che copre, e le celle che copre non si disegnano.
    const visibleMerges = mergesIn(merges, { rowStart: firstRow, rowEnd: lastRow, columnStart: firstColumn, columnEnd: lastColumn });
    const covered = new Set<number>();
    const anchorsByRow = new Map<number, GridMerge[]>();
    for (const merge of visibleMerges) {
      for (let row = Math.max(merge.row, firstRow); row <= Math.min(merge.row + merge.rows - 1, lastRow); row += 1) {
        for (let column = Math.max(merge.column, firstColumn); column <= Math.min(merge.column + merge.columns - 1, lastColumn); column += 1) {
          covered.add(cellKey({ row, column }));
        }
      }
      const host = renderedRows.find((row) => row >= merge.row && this._rows.sizes[row] > 0);
      if (host !== undefined && host < merge.row + merge.rows) {
        anchorsByRow.set(host, [...(anchorsByRow.get(host) ?? []), merge]);
      }
    }
    const measures: HTMLElement[] = [];
    const headRows: HTMLElement[] = [];
    const bodyRows: HTMLElement[] = [];
    for (const row of renderedRows) {
      if (this._rows.sizes[row] === 0) continue;
      const frozen = row < frame.frozenRows;
      const before = (frozen ? drawnHead : drawnBody).get(row);
      const element = this._drawRow(row, before, renderedColumns, covered, anchorsByRow.get(row) ?? [], range, measures);
      (frozen ? headRows : bodyRows).push(element);
    }

    // La riga delle intestazioni di colonna: ogni intestazione resta per
    // colonna e si aggiorna sul posto (una freccia cambia solo `selected`).
    const headerRow = [...this._head.children].find((element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains("grid-column-header-row")) ?? null;
    let header: HTMLElement | null = null;
    if (frame.columnHeader > 0) {
      const fresh = this._columnHeaders(renderedColumns, range);
      if (headerRow) {
        syncAttributes(headerRow, fresh);
        this._keepHeaders(headerRow, fresh);
        header = headerRow;
      } else {
        fresh.prepend(this._corner);
        header = fresh;
      }
    } else {
      headerRow?.remove();
    }
    const head = header ? [header, ...headRows] : headRows;
    // Le righe della testa stanno dopo la sua carta e prima dei suoi livelli.
    placeInOrder(this._head, head, this._layers.top, (element) => element.classList.contains("grid-row"));
    placeInOrder(this._body, bodyRows, null, (element) => element.classList.contains("grid-row"));
    // Un gruppo di righe vuoto non è un gruppo, per chi legge.
    // Solo quando cambia: a ogni passo dello scorrimento conta ogni scrittura.
    for (const [group, rows] of [[this._head, head], [this._body, bodyRows]] as const) {
      if (rows.length) setAttributeIfChanged(group, "role", "rowgroup");
      else group.removeAttribute("role");
    }
    this._placePaper(view);
    this._paperColumns(renderedColumns);
    this._pendingFits.push(...measures);
    if (!deferFit) this._fitPending();
    if (this._rowsBehind) this._scheduleRender();
  }

  /// Delle righe del margine (`rows`), quelle da disegnare in questo giro:
  /// le bloccate, quelle del riquadro e della fascia attorno a lui, quelle
  /// già disegnate (`kept`) e al più `budget` altre, le più vicine al
  /// riquadro prima. Se ne restano fuori, il disegno resta indietro
  /// (`_rowsBehind`) e le aggiunge il fotogramma dopo.
  _drawableRows(rows: readonly number[], view: PaperView, kept: (row: number) => boolean, budget: number): number[] {
    if (budget === Infinity) return [...rows];
    const frame = this._frame;
    const extent = Math.max(0, view.height - frame.columnHeader - frame.frozenHeight);
    const band = Math.round(extent * GRID_FRAME_BAND);
    const top = view.scrollTop + frame.frozenHeight;
    const first = indexAt(this._rows, Math.max(0, top - band));
    const last = indexAt(this._rows, top + extent + band);
    const distance = (row: number) => (row < first ? first - row : row - last);
    const waiting = rows.filter((row) => row >= frame.frozenRows && (row < first || row > last) && !kept(row));
    const chosen = new Set(waiting.sort((left, right) => distance(left) - distance(right)).slice(0, Math.max(0, budget)));
    if (chosen.size < waiting.length) this._rowsBehind = true;
    return rows.filter((row) => row < frame.frozenRows || (row >= first && row <= last) || kept(row) || chosen.has(row));
  }

  /// Le misure del riquadro, lette tutte insieme.
  _readView(): PaperView {
    return {
      scrollTop: this._viewport.scrollTop,
      scrollLeft: this._viewport.scrollLeft,
      width: this._viewport.clientWidth,
      height: this._viewport.clientHeight,
    };
  }

  /// Misura le celle disegnate che aspettano (`_renderRows`): leggere la loro
  /// larghezza impagina, e nel gestore dello scorrimento lo fa il fotogramma.
  _fitPending(): void {
    const cells = this._pendingFits.filter((cell) => cell.isConnected);
    this._pendingFits = [];
    if (cells.length) this._fitCells(cells);
  }

  /// La riga `row`: quella già disegnata (`before`) aggiornata, o una nuova.
  /// L'intestazione si rifà sul posto se cambia; ogni cella resta se la sua
  /// firma non cambia, e prende soltanto la selezione; se cambia, si rifà
  /// sul posto, nello stesso elemento; quelle uscite dal margine si tolgono.
  _drawRow(
    row: number,
    before: HTMLElement | undefined,
    columns: readonly number[],
    covered: ReadonlySet<number>,
    anchors: readonly GridMerge[],
    range: GridRange,
    measures: HTMLElement[],
  ): HTMLElement {
    const frame = this._frame;
    const frozen = row < frame.frozenRows;
    const known = before ? this._drawnRows.get(before) : undefined;
    const element = known ? before! : document.createElement("div");
    const state: DrawnRow = known ?? { place: "", header: null, headerKey: "", cells: new Map() };
    if (!known) {
      this._drawnRows.set(element, state);
      element.setAttribute("role", "row");
    }
    const className = frozen ? "grid-row frozen" : "grid-row";
    if (element.className !== className) element.className = className;
    if (element.dataset.row !== String(row)) element.dataset.row = String(row);
    if (element.getAttribute("aria-rowindex") !== String(row + 2)) element.setAttribute("aria-rowindex", String(row + 2));
    // Una riga bloccata sta nella testa, che è ferma da sé; le altre nel
    // corpo, che scorre. Tutte e due al loro posto nel piano.
    const top = frame.columnHeader + this._rows.offsets[row];
    const width = frame.rowHeader + this._columns.total;
    const place = `${top}|${width}|${this._rows.sizes[row]}`;
    if (state.place !== place) {
      this._place(element, 0, top, width, this._rows.sizes[row]);
      state.place = place;
    }

    const children: HTMLElement[] = [];
    if (frame.rowHeader > 0) {
      const selected = [range, ...this._others].some((area) => row >= area.rowStart && row <= area.rowEnd);
      const afterHidden = row > 0 && this._rows.sizes[row - 1] === 0;
      const headerKey = `${selected}|${afterHidden}|${frame.rowHeader}|${this._rows.sizes[row]}|${frame.zoom}`;
      if (!state.header || state.headerKey !== headerKey) {
        const header = document.createElement("div");
        header.className = "grid-header grid-row-header";
        if (selected) header.classList.add("selected");
        if (afterHidden) header.classList.add("after-hidden");
        header.setAttribute("role", "rowheader");
        header.setAttribute("aria-rowindex", String(row + 2));
        header.setAttribute("aria-colindex", "1");
        header.textContent = String(row + 1);
        header.style.pointerEvents = "none";
        if (frame.zoom !== 1) header.style.fontSize = `calc(var(--text-sm) * ${frame.zoom})`;
        this._stickLeft(header, 0, 0, frame.rowHeader, this._rows.sizes[row]);
        if (state.header) syncAttributes(state.header, header);
        else state.header = header;
        state.headerKey = headerKey;
      }
      children.push(state.header);
    } else if (state.header) {
      state.header.remove();
      state.header = null;
      state.headerKey = "";
    }

    const seen = new Set<string>();
    const borders: HTMLElement[] = [];
    const active = this._active();
    const visit = (position: GridPosition, merge: GridMerge | null, slot: string) => {
      const signed = this._cellSignature(position, merge, row);
      if (signed === null) return;
      const { place, signature } = signed;
      let drawn = state.cells.get(slot);
      // Una cella che resta dov'era e cambia soltanto ciò che mostra può
      // aspettare il fotogramma dopo, se questo disegno ha finito i suoi
      // rifacimenti (`_refills`): la si lascia com'è, e il disegno resta
      // indietro (`_rowsBehind`).
      if (drawn && drawn.signature !== signature && drawn.place === place && this._refills <= 0) {
        this._rowsBehind = true;
      } else if (!drawn || drawn.signature !== signature) {
        if (drawn) this._refills -= 1;
        const fresh = this._cellElement(position, merge, row);
        if (!fresh) return;
        if (!drawn) {
          drawn = { cell: fresh.cell, border: fresh.border, place, signature, html: null, base: fresh.cell.className };
          state.cells.set(slot, drawn);
          if (fresh.measure) measures.push(fresh.cell);
        } else {
          // La cella nuova com'è, prima di ogni selezione e misura: se è
          // uguale a quella disegnata, la disegnata resta com'è. Una cella
          // senza HTML (mai confrontata) si rifà: il risultato è lo stesso.
          const html = fresh.cell.outerHTML;
          if (drawn.html !== html) {
            this._refillCell(drawn.cell, fresh.cell);
            if (fresh.measure) measures.push(drawn.cell);
          }
          if (fresh.border && drawn.border) {
            syncAttributes(drawn.border, fresh.border);
          } else {
            drawn.border?.remove();
            drawn.border = fresh.border;
          }
          drawn.place = place;
          drawn.signature = signature;
          drawn.html = html;
          drawn.base = fresh.cell.className;
        }
      }
      seen.add(slot);
      const lastRow = merge ? merge.row + merge.rows - 1 : position.row;
      const lastColumn = merge ? merge.column + merge.columns - 1 : position.column;
      const selected = this._inSelection(range, position.row, position.column, lastRow, lastColumn);
      const classes = `${drawn.base}${selected ? " selected" : ""}${samePosition(position, active) ? " active" : ""}`;
      if (drawn.cell.className !== classes) drawn.cell.className = classes;
      if (drawn.cell.getAttribute("aria-selected") !== String(selected)) drawn.cell.setAttribute("aria-selected", String(selected));
      children.push(drawn.cell);
      if (drawn.border) borders.push(drawn.border);
    };
    for (const column of columns) {
      if (this._columns.sizes[column] === 0 || covered.has(cellKey({ row, column }))) continue;
      visit({ row, column }, null, String(column));
    }
    for (const merge of anchors) visit({ row: merge.row, column: merge.column }, merge, `merge:${merge.row}:${merge.column}`);
    for (const [slot, drawn] of state.cells) {
      if (seen.has(slot)) continue;
      drawn.cell.remove();
      drawn.border?.remove();
      state.cells.delete(slot);
    }
    // Prima l'intestazione e le celle, poi i bordi del file, sopra le celle.
    children.push(...borders);
    placeInOrder(element, children, null, () => true);
    return element;
  }

  /// Rifà sul posto la cella `target` com'è `fresh`: gli attributi e il
  /// contenuto, nello stesso elemento, così il clic e il doppio clic che ci
  /// stanno sopra arrivano. La cella aperta non ci sta dentro: sta nel
  /// livello «lift» della sua zona.
  _refillCell(target: HTMLElement, fresh: HTMLElement): void {
    syncAttributes(target, fresh);
    morphChildren(target, fresh, null);
  }

  /// Ciò che la cella in `position`, disegnata nella riga `hostRow`, mostra:
  /// gli oggetti letti (la cella della finestra, lo stile, la carta) per
  /// identità, e la misura, il posto, il debordare e i bordi di un'unione.
  /// Due firme uguali danno la stessa cella. `place` è la parte della firma
  /// che dice dove sta e quanto è grande. `null` se la cella non ha misura
  /// (una colonna o una riga nascosta).
  _cellSignature(position: GridPosition, merge: GridMerge | null, hostRow: number): { place: string; signature: string } | null {
    const { row, column } = position;
    const lastRow = merge ? merge.row + merge.rows - 1 : row;
    const lastColumn = merge ? merge.column + merge.columns - 1 : column;
    const width = this._columns.offsets[lastColumn + 1] - this._columns.offsets[column];
    const height = this._rows.offsets[lastRow + 1] - this._rows.offsets[row];
    if (width <= 0 || height <= 0) return null;
    const workbookCell = this._workbookCell(position);
    const bytes = workbookCell?.bytes;
    const style = workbookCell?.style;
    const reach = !merge && bytes && spills(style, bytes) ? this._spillReach(position, horizontalOf(style, bytes.value)) : 0;
    // Un'unione prende i bordi di destra e di sotto dalle celle che stanno lì.
    const edges = merge
      ? `${this._refId(this._workbookCell({ row, column: lastColumn })?.style)}:${this._refId(this._workbookCell({ row: lastRow, column })?.style)}`
      : "";
    const place = [
      merge ? `${merge.rows}x${merge.columns}` : "",
      width,
      height,
      this._columnLeft(column),
      this._rows.offsets[row] - this._rows.offsets[hostRow],
      column < this._frame.frozenColumns ? 1 : 0,
    ].join("|");
    const signature = [
      place,
      this._refId(bytes),
      this._refId(style),
      edges,
      reach,
      this._refId(this._paper),
      this._cellEpoch,
    ].join("|");
    return { place, signature };
  }

  /// Il numero di `value` per le firme delle celle: lo stesso oggetto dà lo
  /// stesso numero; niente dà zero.
  _refId(value: object | null | undefined): number {
    if (!value) return 0;
    let id = this._refIds.get(value);
    if (id === undefined) {
      id = this._nextRefId;
      this._nextRefId += 1;
      this._refIds.set(value, id);
    }
    return id;
  }

  /// La carta grande quanto il riquadro (non più del foglio, che non deve
  /// crescere per lei), e i suoi fili dove lo scorrimento li porta: la fase
  /// dei fili delle righe dalla prima riga che si vede, i fili delle colonne
  /// spostati di quanto si è scorso di lato. Lo scrive il gestore dello
  /// scorrimento: fra lo scorrimento e lui, dove una riga non c'è ancora, i
  /// fili sono quelli di un fotogramma prima. La carta sta nel flusso del
  /// riquadro, prima del piano: il margine sotto, negativo quanto lei, non le
  /// lascia occupare posto.
  _placePaper(view: PaperView): void {
    const frame = this._frame;
    const { scrollTop, scrollLeft } = view;
    const width = Math.max(0, Math.min(view.width, frame.rowHeader + this._columns.total));
    const height = Math.max(0, Math.min(view.height, frame.columnHeader + this._rows.total));
    const period = this._paperPeriod;
    const top = this._rows.sizes.length ? this._rows.offsets[indexAt(this._rows, scrollTop)] : 0;
    const phase = (((frame.columnHeader + top - scrollTop) % period) + period) % period;
    const placed = `${width}|${height}|${phase}|${scrollLeft}|${this._bands().left}`;
    if (placed === this._paperPlaced) return;
    this._paperPlaced = placed;
    const paper = this._sheetPaper.style;
    const write = (style: CSSStyleDeclaration, property: "width" | "height" | "marginBottom" | "backgroundPositionY", value: string) => {
      if (style[property] !== value) style[property] = value;
    };
    write(paper, "width", `${width}px`);
    write(paper, "height", `${height}px`);
    write(paper, "marginBottom", `${-height}px`);
    write(this._paperLeft.style, "width", `${Math.min(width, this._bands().left)}px`);
    write(this._paperLeft.style, "height", `${height}px`);
    for (const strip of this._paperStrips) write(strip.style, "backgroundPositionY", `${phase}px`);
    const shift = scrollLeft ? `translateX(${-scrollLeft}px)` : "";
    if (this._paperRulesHost.style.transform !== shift) this._paperRulesHost.style.transform = shift;
  }

  /// I fili delle colonne della carta, uno per colonna disegnata, sull'ultimo
  /// pixel della colonna: quelli delle colonne bloccate nella carta della
  /// colonna ferma, gli altri nella carta del corpo. Restano quelli che
  /// c'erano; si aggiungono e si tolgono ai bordi, come le celle.
  _paperColumns(columns: readonly number[]): void {
    const frame = this._frame;
    const wanted = new Set<number>();
    for (const column of columns) {
      if (this._columns.sizes[column] === 0) continue;
      wanted.add(column);
      const parent = column < frame.frozenColumns ? this._paperLeft : this._paperRulesHost;
      const left = frame.rowHeader + this._columns.offsets[column + 1] - 1;
      let rule = this._paperRules.get(column);
      if (rule && rule.element.parentElement !== parent) {
        rule.element.remove();
        rule = undefined;
      }
      if (!rule) {
        const element = document.createElement("div");
        element.className = "grid-rule-column";
        rule = { element, left: Number.NaN };
        this._paperRules.set(column, rule);
        parent.append(element);
      }
      if (rule.left !== left) {
        rule.element.style.left = `${left}px`;
        rule.left = left;
      }
    }
    for (const [column, rule] of this._paperRules) {
      if (wanted.has(column)) continue;
      rule.element.remove();
      this._paperRules.delete(column);
    }
  }

  /// Mette in `parent` gli elementi `fresh`, nell'ordine, al posto dei
  /// `drawn`. Un elemento disegnato uguale a quello nuovo, confrontato per
  /// intero, resta dov'è. Gli oggetti si rifanno sempre. Le righe di celle
  /// hanno il loro disegno (`_drawRow`); qui passano i segni e le
  /// intestazioni di colonna.
  _reconcile(parent: HTMLElement, drawn: readonly HTMLElement[], fresh: readonly HTMLElement[], end: ChildNode | null = null): void {
    const key = (element: HTMLElement): string | null =>
      element.classList.contains("grid-object") ? null : `html:${element.outerHTML}`;
    const old = new Map<string, HTMLElement>();
    for (const element of drawn) {
      const name = key(element);
      if (name !== null && !old.has(name)) old.set(name, element);
    }
    const kept = new Set<HTMLElement>();
    const placed = fresh.map((element) => {
      const name = key(element);
      const before = name === null ? undefined : old.get(name);
      if (!before) return element;
      old.delete(name!);
      kept.add(before);
      return before;
    });
    for (const element of drawn) if (!kept.has(element)) element.remove();
    // Dal fondo: un elemento già al suo posto non si muove.
    let next: ChildNode | null = end;
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      const element = placed[index];
      if (element.parentNode !== parent || element.nextSibling !== next) parent.insertBefore(element, next);
      next = element;
    }
  }

  /// Porta la riga delle intestazioni `row` a essere come `fresh`: l'angolo
  /// in testa, poi un'intestazione per colonna, ritrovata per colonna e
  /// aggiornata sul posto. Entra solo la colonna che entra nel margine, ed
  /// esce solo quella che ne esce.
  _keepHeaders(row: HTMLElement, fresh: HTMLElement): void {
    const old = new Map<string, HTMLElement>();
    for (const child of row.children) {
      const column = child.getAttribute("aria-colindex");
      if (child !== this._corner && column !== null && child instanceof HTMLElement) old.set(column, child);
    }
    const placed: HTMLElement[] = [this._corner];
    for (const element of [...fresh.children] as HTMLElement[]) {
      const column = element.getAttribute("aria-colindex") ?? "";
      const before = old.get(column);
      if (!before) {
        placed.push(element);
        continue;
      }
      old.delete(column);
      syncAttributes(before, element);
      if (before.textContent !== element.textContent) before.textContent = element.textContent;
      placed.push(before);
    }
    const keep = new Set<Element>(placed);
    for (const child of [...row.children]) if (!keep.has(child)) child.remove();
    // Dal fondo: un'intestazione già al suo posto non si muove.
    let next: ChildNode | null = null;
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      const element = placed[index];
      if (element.parentNode !== row || element.nextSibling !== next) row.insertBefore(element, next);
      next = element;
    }
  }

  /// Se la selezione è la sola cella attiva, o l'unione che la contiene.
  _lone(range: GridRange): boolean {
    const active = this._active();
    const merge = mergeAt(this._merges(), active);
    const cell = merge
      ? { rowStart: merge.row, rowEnd: merge.row + merge.rows - 1, columnStart: merge.column, columnEnd: merge.column + merge.columns - 1 }
      : { rowStart: active.row, rowEnd: active.row, columnStart: active.column, columnEnd: active.column };
    return sameRange(range, cell);
  }

  /// I segni della selezione, che restano e scivolano: il rettangolo, la
  /// cella attiva, il velo, le fasce delle intestazioni, il quadratino; e,
  /// fermi, i fili del blocco e gli altri intervalli scelti. Li disegna e li
  /// muove `grid-motion.ts` dai dieci numeri di `_markGeometry`.
  _updateMarks(range: GridRange): void {
    const geometry = this._markGeometry(range);
    if (!geometry) {
      this._marks.clear();
      return;
    }
    const sheet = this._sheet().id;
    const glide = !this._marksJump && this._marksSheet === sheet;
    // Le maniglie del tocco sono della selezione su cui sono nate.
    if (this._marksSheet !== sheet) this._grips = false;
    this._marksJump = false;
    this._marksSheet = sheet;
    const motion = selectionMotion(this._selectionSpeed, this._marksSpring);
    this._marksSpring = null;
    const frame = this._frame;
    const clip = this._clipMark(sheet);
    const ants = this._antsMark(sheet);
    const look: SelectionLook = {
      lone: this._lone(range) && !this._others.length,
      // Sul tratteggio di una copia o di un taglio, o sulle formiche, il
      // bordo pieno li coprirebbe.
      edges: !(clip && sameRange(clip.range, range)) && !(ants && sameRange(ants.range, range)),
      // Col dito il riempimento si fa dal menu: il quadratino non c'è.
      handle: this._fillServed() && !this._touchLast,
      grips: this._grips,
      header: { width: frame.rowHeader, height: frame.columnHeader },
    };
    const still: MarkPart[] = [...this._freezeParts()];
    const outline = (area: GridRange) => {
      const box = this._rangeBox(area);
      return box ? { L: box.left, T: box.top, R: box.left + box.width, B: box.top + box.height } : null;
    };
    const clipBox = clip ? outline(clip.range) : null;
    if (clip && clipBox) still.push(...edgeParts("clip", clip.kind, clipBox, 2, { glide: false, fade: true }));
    const antsBox = ants ? outline(ants.range) : null;
    if (antsBox) still.push(...edgeParts("ants", "ants", antsBox, 2, { glide: false, fade: true }));
    this._others.forEach((area, index) => {
      const box = this._rangeBox(area);
      if (!box) return;
      const edges = { L: box.left, T: box.top, R: box.left + box.width, B: box.top + box.height };
      still.push(...edgeParts(`other-${index}`, "edge", edges, 2, { glide: false }));
      still.push({ name: `other-${index}-veil`, kind: "veil", rect: { x: box.left, y: box.top, w: box.width, h: box.height }, glide: false });
    });
    this._marks.update({
      geometry,
      parts: (shown) => selectionParts(shown, look),
      still,
      fill: this._drag?.kind === "fill",
      glide,
      walk: ants?.walk ?? false,
      spring: motion.spring,
      snap: motion.snap,
    });
  }

  /// Il tratteggio di ciò che si è copiato (largo) o tagliato (fitto) sul
  /// foglio `sheet`, o `null`.
  _clipMark(sheet: string): { readonly kind: "copy" | "cut"; readonly range: GridRange } | null {
    const cut = this._cutMark;
    if (cut) return cut.sheet === sheet ? { kind: "cut", range: cut.range } : null;
    const copy = this._copyMark;
    return copy && copy.sheet === sheet ? { kind: "copy", range: copy.range } : null;
  }

  /// Le formiche sul foglio `sheet`: ferme attorno al riempimento che si
  /// tira, in cammino attorno al gesto che aspetta il foglio; o `null`.
  _antsMark(sheet: string): { readonly range: GridRange; readonly walk: boolean } | null {
    const drag = this._drag?.kind === "fill" ? this._drag : null;
    if (drag && !sameRange(drag.source, drag.target)) return { range: drag.target, walk: false };
    const wait = this._waiting;
    return wait && wait.sheet === sheet ? { range: wait.range, walk: true } : null;
  }

  /// I dieci numeri dei segni (`MarkGeometry`): il rettangolo di `range`, la
  /// cella attiva (con la sua unione) e l'angolo del quadratino, che mentre
  /// si tira il riempimento sta su quello del riempimento. `null` se il
  /// rettangolo o la cella attiva non hanno misura (righe o colonne
  /// nascoste).
  _markGeometry(range: GridRange): MarkGeometry | null {
    const active = this._active();
    const merge = mergeAt(this._merges(), active);
    const cell: GridRange = merge
      ? { rowStart: merge.row, rowEnd: merge.row + merge.rows - 1, columnStart: merge.column, columnEnd: merge.column + merge.columns - 1 }
      : { rowStart: active.row, rowEnd: active.row, columnStart: active.column, columnEnd: active.column };
    const box = this._rangeBox(range);
    const own = this._rangeBox(cell);
    if (!box || !own) return null;
    const drag = this._drag?.kind === "fill" ? this._drag : null;
    const fill = (drag ? this._rangeBox(drag.target) : null) ?? box;
    return [
      box.left, box.top, box.left + box.width, box.top + box.height,
      own.left, own.top, own.left + own.width, own.top + own.height,
      fill.left + fill.width, fill.top + fill.height,
    ];
  }

  /// Se il punto (dello schermo) prende il quadratino: dove si vede il suo
  /// angolo, entro `FILL_SLOP` px, anche sulla metà che una fascia ferma
  /// copre, e mai quando l'angolo è passato sotto la fascia. Decide questa
  /// prova, non il bersaglio del DOM, che sul filo dipende da chi copre chi.
  _onFillHandle(x: number, y: number): boolean {
    // Dopo un dito il quadratino non si mostra, e non si prende.
    if (!this._fillServed() || this._touchLast) return false;
    const box = this._rangeBox(this._selectedRange());
    if (!box) return false;
    const seen = cornerSeen(box.left + box.width, box.top + box.height, false, this._bands(), {
      left: this._viewport.scrollLeft,
      top: this._viewport.scrollTop,
    });
    if (!seen) return false;
    const rect = this._viewport.getBoundingClientRect();
    const px = x - rect.left - this._viewport.clientLeft;
    const py = y - rect.top - this._viewport.clientTop;
    return Math.abs(px - (seen.x - 1)) <= FILL_SLOP && Math.abs(py - (seen.y - 1)) <= FILL_SLOP;
  }

  /// Mentre si tira il bordo di un'intestazione: la guida dove cadrà e la
  /// misura, nelle unità di Excel e in pixel del file. Stanno nel livello
  /// fermo nell'angolo del riquadro, nelle sue coordinate.
  _resizeMarks(drawing: Drawing): void {
    const resize = this._resize;
    if (!resize) return;
    const frame = this._frame;
    const guide = document.createElement("div");
    guide.className = "grid-resize-guide";
    guide.setAttribute("aria-hidden", "true");
    const label = document.createElement("div");
    label.className = "grid-resize-label";
    label.setAttribute("aria-hidden", "true");
    const pixels = Math.round(resize.now / (WORKBOOK_SCALE * frame.zoom));
    const number = (value: number) => new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: 2 }).format(value);
    // Nel riquadro: una colonna o una riga bloccata non è scorsa. La misura
    // sta dentro il riquadro, dalla parte del bordo dove c'è posto (griglia
    // T5): la sua misura è quella dell'ultimo disegno, e `_fitResizeLabel`
    // la corregge appena l'etichetta c'è.
    label.style.position = "absolute";
    if (resize.axis === "column") {
      const x = this._columnLeft(resize.index) + resize.now - this._zoneScroll(resize.index < frame.frozenColumns, true).left;
      this._place(guide, x - 1, 0, 2, this._viewport.clientHeight);
      label.textContent = t("grid.resize.width", { chars: number(pixelsToChars(pixels)), px: String(pixels) });
      label.dataset.edge = String(x);
      label.style.left = `${resizeLabelAt(x, this._resizeLabelSize, this._viewport.clientWidth)}px`;
      label.style.top = `${frame.columnHeader + RESIZE_LABEL_GAP}px`;
    } else {
      const y = frame.columnHeader + this._rows.offsets[resize.index] + resize.now - this._zoneScroll(true, resize.index < frame.frozenRows).top;
      this._place(guide, 0, y - 1, this._viewport.clientWidth, 2);
      label.textContent = t("grid.resize.height", { points: number(pixels * 0.75), px: String(pixels) });
      label.dataset.edge = String(y);
      label.style.left = `${frame.rowHeader + RESIZE_LABEL_GAP}px`;
      label.style.top = `${resizeLabelAt(y, this._resizeLabelSize, this._viewport.clientHeight)}px`;
    }
    this._draw(drawing, this._fixed, guide);
    this._draw(drawing, this._fixed, label);
  }

  /// L'etichetta della misura disegnata, con la sua misura vera nel verso del
  /// bordo: se non è quella con cui `_resizeMarks` l'ha messa, la rimette
  /// dentro il riquadro.
  _fitResizeLabel(): void {
    const resize = this._resize;
    if (!resize) return;
    const label = this._fixed.querySelector<HTMLElement>(".grid-resize-label");
    if (!label?.dataset.edge) return;
    const column = resize.axis === "column";
    const size = column ? label.offsetWidth : label.offsetHeight;
    if (size === this._resizeLabelSize) return;
    this._resizeLabelSize = size;
    const at = `${resizeLabelAt(Number(label.dataset.edge), size, column ? this._viewport.clientWidth : this._viewport.clientHeight)}px`;
    if (column) label.style.left = at;
    else label.style.top = at;
  }

  /// Il bordo fra due intestazioni sotto il punto, se si può misurare: un
  /// bordo è preso a `RESIZE_SLOP` pixel, e senza il comando servito non c'è.
  _resizeEdge(x: number, y: number): ResizeEdge | null {
    if (!this.commandable() || this._editing || this._selectedObject !== null) return null;
    const frame = this._frame;
    const rect = this._viewport.getBoundingClientRect();
    const px = x - rect.left - this._viewport.clientLeft;
    const py = y - rect.top - this._viewport.clientTop;
    const nearest = (point: number, header: number, frozen: number, scroll: number, layout: AxisLayout): number | null => {
      const inside = point - header;
      const offset = inside < frozen ? inside : inside + scroll;
      let best: number | null = null;
      let distance = RESIZE_SLOP + 1;
      for (let index = 0; index < layout.sizes.length; index += 1) {
        if (layout.sizes[index] === 0) continue;
        const gap = Math.abs(layout.offsets[index + 1] - offset);
        if (gap <= distance) {
          best = index;
          distance = gap;
        }
        if (layout.offsets[index] > offset + RESIZE_SLOP) break;
      }
      return best;
    };
    if (py >= 0 && py < frame.columnHeader && px >= frame.rowHeader && px < this._viewport.clientWidth) {
      if (!this._serves("home.columnWidth")) return null;
      const index = nearest(px, frame.rowHeader, frame.frozenWidth, this._viewport.scrollLeft, this._columns);
      return index === null ? null : { axis: "column", index };
    }
    if (px >= 0 && px < frame.rowHeader && py >= frame.columnHeader && py < this._viewport.clientHeight) {
      if (!this._serves("home.rowHeight")) return null;
      const index = nearest(py, frame.columnHeader, frame.frozenHeight, this._viewport.scrollTop, this._rows);
      return index === null ? null : { axis: "row", index };
    }
    return null;
  }

  /// Le linee che una misura tocca, la prima e l'ultima: tutte quelle
  /// scelte intere, se `index` è fra loro, come in Excel; altrimenti `index`
  /// sola.
  _resizeSpan(edge: ResizeEdge): readonly [number, number] {
    const range = this._selectedRange();
    const sheet = this._sheet();
    if (edge.axis === "column") {
      const whole = range.rowStart === 0 && range.rowEnd >= sheet.rows.length - 1;
      return whole && edge.index >= range.columnStart && edge.index <= range.columnEnd
        ? [range.columnStart, range.columnEnd]
        : [edge.index, edge.index];
    }
    const whole = range.columnStart === 0 && range.columnEnd >= sheet.columns.length - 1;
    return whole && edge.index >= range.rowStart && edge.index <= range.rowEnd
      ? [range.rowStart, range.rowEnd]
      : [edge.index, edge.index];
  }

  /// Le linee di `_resizeSpan`, in A1 per GridCraft.
  _resizeLines(edge: ResizeEdge): string {
    const [a, b] = this._resizeSpan(edge);
    return edge.axis === "column" ? `${columnLabel(a)}:${columnLabel(b)}` : `${a + 1}:${b + 1}`;
  }

  /// Il rilascio di un bordo tirato (griglia T5). La misura nuova vale
  /// subito, come anteprima (`_sizePreviews`), e le linee dopo scivolano al
  /// posto nuovo; il comando va al provider come prima. Quando il provider ha
  /// risposto, e la griglia ha riletto le finestre, l'anteprima esce: se ha
  /// detto sì le misure lette sono già quelle, se ha detto no tornano com'erano
  /// scivolando, e l'avviso dice perché (`_giveNow`).
  _endResize(commit: boolean): void {
    const resize = this._resize;
    if (!resize) return;
    this._resize = null;
    const label = this._fixed.querySelector<HTMLElement>(".grid-resize-label");
    if (label) fadeOutResizeLabel(label);
    if (!commit || Math.round(resize.now) === Math.round(resize.size)) {
      this._render();
      return;
    }
    const pixels = Math.round(resize.now / (WORKBOOK_SCALE * this._frame.zoom));
    const lines = this._resizeLines(resize);
    const id = resize.axis === "column" ? "home.columnWidth" : "home.rowHeight";
    const params = JSON.stringify(resize.axis === "column" ? { cols: lines, width: pixels } : { rows: lines, height: pixels });
    const state = this._commands.find((command) => command.id === id);
    if (!this._bytes || !this._allowed(id) || !state?.enabled) {
      // Niente anteprima: `command` dice perché il comando non si dà.
      this._render();
      this.command(id, params);
      return;
    }
    const [first, last] = this._resizeSpan(resize);
    const preview: SizePreview = {
      ticket: ++this._sizeTickets,
      sheet: this._sheet().id,
      axis: resize.axis,
      first,
      last,
      size: pixels * WORKBOOK_SCALE,
    };
    this._slideSizes(resize.axis, first, () => this._sizePreviews.push(preview));
    this._give(id, params, false);
    // La coda del protocollo è in fila: questo passo parte quando il comando
    // ha avuto la sua risposta e le finestre sono rilette.
    this._enqueueProtocol(async () => this._dropSizePreview(preview));
  }

  /// L'anteprima `preview` ha avuto la risposta: esce. Un'anteprima più
  /// nuova sulle stesse linee resta, e vince ancora.
  _dropSizePreview(preview: SizePreview): void {
    const index = this._sizePreviews.indexOf(preview);
    if (index < 0 || this._destroyed) return;
    const drop = () => {
      this._sizePreviews.splice(this._sizePreviews.indexOf(preview), 1);
    };
    if (!this._view || preview.sheet !== this._sheet().id) {
      drop();
      return;
    }
    this._slideSizes(preview.axis, preview.first, drop);
  }

  /// Cambia le misure con `mutate` e ridisegna: ciò che sta dopo la linea
  /// `index` scivola dal posto di prima (`slideLines`), e i segni con la
  /// stessa molla.
  _slideSizes(axis: "column" | "row", index: number, mutate: () => void): void {
    slideLines(this._linesAfter(axis, index), () => {
      mutate();
      this._marksSpring = SLIDE;
      this._rebuildLayout();
      this._render();
    }, this._life);
  }

  /// I pezzi disegnati che una misura della linea `index` sposta, nelle righe
  /// che si vedono: per una colonna le celle dopo (coi loro bordi), le
  /// intestazioni e i fili della carta; per una riga le righe dopo.
  _linesAfter(axis: "column" | "row", index: number): HTMLElement[] {
    const frame = this._frame;
    const top = this._viewport.scrollTop + frame.frozenHeight;
    const bottom = this._viewport.scrollTop + this._viewport.clientHeight - frame.columnHeader;
    const seen = (row: number) => row < frame.frozenRows || (this._rows.offsets[row + 1] > top && this._rows.offsets[row] < bottom);
    const out: HTMLElement[] = [];
    for (const parent of [this._head, this._body]) {
      for (const element of parent.children) {
        if (!isDataRow(element)) continue;
        const row = Number(element.dataset.row);
        if (!seen(row)) continue;
        if (axis === "row") {
          if (row > index) out.push(element);
          continue;
        }
        for (const [slot, drawn] of this._drawnRows.get(element)?.cells ?? []) {
          const column = slot.startsWith("merge:") ? Number(slot.split(":")[2]) : Number(slot);
          if (column <= index) continue;
          out.push(drawn.cell);
          if (drawn.border) out.push(drawn.border);
        }
      }
    }
    if (axis === "column") {
      for (const header of this._head.querySelectorAll<HTMLElement>(".grid-column-header")) {
        if (Number(header.getAttribute("aria-colindex")) - 2 > index) out.push(header);
      }
      for (const [column, rule] of this._paperRules) if (column >= index) out.push(rule.element);
    }
    return out;
  }

  /// Mentre si tira il bordo della selezione: il contorno di dove andrà.
  _moveMarks(drawing: Drawing): void {
    const drag = this._drag?.kind === "move" ? this._drag : null;
    if (!drag || sameRange(drag.source, drag.target)) return;
    const box = this._rangeBox(drag.target);
    if (box) this._rectMark(drawing, "grid-move-preview", box);
  }

  /// Se il punto sta sul bordo della selezione, a `MOVE_SLOP` pixel, e la
  /// selezione si può spostare: un intervallo solo, di celle, con
  /// `fub.pasteFrom` servito. L'angolo del quadratino resta al riempimento.
  _onSelectionEdge(x: number, y: number): boolean {
    if (!this.commandable() || !this._serves(PASTE_FROM) || this._editing || this._selectedObject !== null || this._others.length) return false;
    const range = this._selectedRange();
    const sheet = this._sheet();
    const whole = (range.rowStart === 0 && range.rowEnd >= sheet.rows.length - 1)
      || (range.columnStart === 0 && range.columnEnd >= sheet.columns.length - 1);
    const box = whole ? null : this._rangeBox(range);
    if (!box) return false;
    // Ogni lato nel riquadro: un lato su una colonna o una riga bloccata non
    // è scorso.
    const frame = this._frame;
    const rect = this._viewport.getBoundingClientRect();
    const originX = rect.left + this._viewport.clientLeft;
    const originY = rect.top + this._viewport.clientTop;
    const scrollStart = this._zoneScroll(range.columnStart < frame.frozenColumns, range.rowStart < frame.frozenRows);
    const scrollEnd = this._zoneScroll(range.columnEnd < frame.frozenColumns, range.rowEnd < frame.frozenRows);
    const left = originX + box.left - scrollStart.left;
    const top = originY + box.top - scrollStart.top;
    const right = originX + box.left + box.width - scrollEnd.left;
    const bottom = originY + box.top + box.height - scrollEnd.top;
    const outside = x < left - MOVE_SLOP || x > right + MOVE_SLOP || y < top - MOVE_SLOP || y > bottom + MOVE_SLOP;
    const inside = x > left + MOVE_SLOP && x < right - MOVE_SLOP && y > top + MOVE_SLOP && y < bottom - MOVE_SLOP;
    const handle = this._fillServed() && x >= right - 6 && y >= bottom - 6;
    return !outside && !inside && !handle;
  }

  /// Lo spostamento (o con `copy` la copia) di `source` in `target`, con
  /// `fub.pasteFrom`; dopo, la selezione è dove si è lasciato.
  _moveRange(source: GridRange, target: GridRange, copy: boolean): void {
    const sheet = this._sheet().id;
    this._others = [];
    this._selection = {
      anchor: { row: target.rowStart, column: target.columnStart },
      focus: { row: target.rowEnd, column: target.columnEnd },
    };
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
    this.command(PASTE_FROM, JSON.stringify({ source: rangeA1(source), sourceSheet: sheet, move: !copy }));
  }

  /// Il rettangolo di `range` nel piano, come lo disegnano le celle: senza lo
  /// scorrimento, anche sulle righe e le colonne bloccate.
  _rangeBox(range: GridRange): { left: number; top: number; width: number; height: number } | null {
    const frame = this._frame;
    const width = (this._columns.offsets[range.columnEnd + 1] ?? 0) - (this._columns.offsets[range.columnStart] ?? 0);
    const height = (this._rows.offsets[range.rowEnd + 1] ?? 0) - (this._rows.offsets[range.rowStart] ?? 0);
    if (!(width > 0 && height > 0)) return null;
    return { left: this._columnLeft(range.columnStart), top: frame.columnHeader + this._rows.offsets[range.rowStart], width, height };
  }

  /// La riga delle intestazioni di colonna, senza l'angolo: l'angolo è uno
  /// solo e resta dov'è (`_keepHeaders`); qui si aggiorna sul posto.
  _columnHeaders(columns: readonly number[], range: GridRange): HTMLElement {
    const frame = this._frame;
    const row = document.createElement("div");
    row.className = "grid-row grid-column-header-row";
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", "1");
    this._place(row, 0, 0, frame.rowHeader + this._columns.total, frame.columnHeader);
    if (this._corner.className !== "grid-corner") this._corner.className = "grid-corner";
    if (this._corner.getAttribute("role") !== "presentation") this._corner.setAttribute("role", "presentation");
    if (this._corner.firstChild) this._corner.textContent = "";
    this._corner.style.pointerEvents = "none";
    this._stickLeft(this._corner, 0, 0, frame.rowHeader, frame.columnHeader);
    for (const column of columns) {
      if (this._columns.sizes[column] === 0) continue;
      const header = document.createElement("div");
      header.className = column < frame.frozenColumns ? "grid-header grid-column-header frozen" : "grid-header grid-column-header";
      if ([range, ...this._others].some((area) => column >= area.columnStart && column <= area.columnEnd)) header.classList.add("selected");
      if (column > 0 && this._columns.sizes[column - 1] === 0) header.classList.add("after-hidden");
      header.setAttribute("role", "columnheader");
      header.setAttribute("aria-rowindex", "1");
      header.setAttribute("aria-colindex", String(column + 2));
      header.textContent = columnLabel(column);
      header.style.pointerEvents = "none";
      if (frame.zoom !== 1) header.style.fontSize = `calc(var(--text-sm) * ${frame.zoom})`;
      if (column < frame.frozenColumns) this._stickLeft(header, this._columnLeft(column), 0, this._columns.sizes[column], frame.columnHeader);
      else this._place(header, this._columnLeft(column), 0, this._columns.sizes[column], frame.columnHeader);
      row.append(header);
    }
    return row;
  }

  /// I fili sotto le righe bloccate e a destra delle colonne bloccate: pezzi
  /// fermi nei livelli della testa, della colonna ferma e dell'angolo, che
  /// stanno fermi con loro.
  _freezeParts(): MarkPart[] {
    const frame = this._frame;
    const bands = this._bands();
    const width = frame.rowHeader + this._columns.total;
    const height = frame.columnHeader + this._rows.total;
    const out: MarkPart[] = [];
    if (frame.frozenRows > 0 && width > 0) {
      out.push({ name: "freeze-rows", kind: "freeze", dir: "h", rect: { x: 0, y: bands.top - 1, w: width, h: 1 }, zones: ["top", "corner"], band: true, glide: false });
    }
    if (frame.frozenColumns > 0 && height > frame.columnHeader) {
      out.push({ name: "freeze-columns", kind: "freeze", dir: "v", rect: { x: bands.left - 1, y: frame.columnHeader, w: 1, h: height - frame.columnHeader }, zones: ["left", "corner"], band: true, glide: false });
    }
    return out;
  }

  /// L'elemento della cella in `position`, disegnato nella riga `hostRow`
  /// (un'unione può cominciare sopra la prima riga disegnata), con i suoi
  /// bordi. `measure` chiede di misurarla dopo: si stringe, o è un numero
  /// che potrebbe non entrare.
  _cellElement(
    position: GridPosition,
    merge: GridMerge | null,
    hostRow: number,
  ): { cell: HTMLElement; border: HTMLElement | null; measure: boolean } | null {
    const { row, column } = position;
    const frame = this._frame;
    const workbookCell = this._workbookCell(position);
    const bytes = workbookCell?.bytes;
    const style = workbookCell?.style;
    const lastRow = merge ? merge.row + merge.rows - 1 : row;
    const lastColumn = merge ? merge.column + merge.columns - 1 : column;
    const width = this._columns.offsets[lastColumn + 1] - this._columns.offsets[column];
    const height = this._rows.offsets[lastRow + 1] - this._rows.offsets[row];
    if (width <= 0 || height <= 0) return null;
    const frozenColumn = column < frame.frozenColumns;
    const element = document.createElement("div");
    element.className = frozenColumn ? "grid-cell frozen" : "grid-cell";
    element.dataset.row = String(row);
    element.dataset.column = String(column);
    element.id = this._cellId(position);
    element.setAttribute("role", "gridcell");
    element.setAttribute("aria-rowindex", String(row + 2));
    element.setAttribute("aria-colindex", String(column + 2));
    const owner = this._editorOwner?.position;
    if (owner && owner.row === row && owner.column === column) element.setAttribute("aria-owns", this._cellEditorHost.id);
    if (merge) {
      element.classList.add("merged");
      element.setAttribute("aria-rowspan", String(merge.rows));
      element.setAttribute("aria-colspan", String(merge.columns));
    }
    const text = document.createElement("span");
    text.className = "grid-cell-text";
    text.textContent = workbookCell?.cell.input ?? "";
    paintCell(element, text, style, bytes, this._gridFont(), this._paper);
    if (bytes?.data_bar) {
      const bar = document.createElement("div");
      bar.className = "grid-data-bar";
      bar.setAttribute("aria-hidden", "true");
      bar.style.width = `calc((100% - 4px) * ${bytes.data_bar.fraction})`;
      bar.style.background = bytes.data_bar.gradient
        ? `linear-gradient(to right, ${bytes.data_bar.color}, color-mix(in srgb, ${bytes.data_bar.color} 15%, white))`
        : bytes.data_bar.color;
      element.append(bar);
    }
    if (bytes?.icon) {
      const icon = iconOf(bytes.icon);
      if (icon) {
        const mark = document.createElement("span");
        mark.className = "grid-icon";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = icon.glyph;
        mark.style.color = icon.color;
        element.append(mark);
        if (horizontalOf(style, bytes.value) === "start") element.style.paddingInlineStart = "calc(0.45rem + 1.3em)";
      }
    }
    element.append(text);
    if (bytes?.comment) {
      // Il thread lo mostra la scheda al passaggio (`comment-card.ts`), e a
      // chi non vede lo dice la cella quando diventa attiva.
      const mark = document.createElement("span");
      mark.className = bytes.comment.threaded ? "grid-comment-mark threaded" : "grid-comment-mark";
      if (bytes.comment.threaded && bytes.comment.resolved) mark.classList.add("resolved");
      mark.setAttribute("aria-hidden", "true");
      element.append(mark);
      element.dataset.comment = bytes.comment.threaded ? "thread" : "note";
      element.setAttribute("aria-description", commentDescription(bytes.comment));
    } else if (bytes?.link) {
      element.title = bytes.link.tooltip ?? bytes.link.target;
    }
    if (bytes?.stale) element.classList.add("stale");
    if (bytes && this._pendingCells.has(bytes)) element.classList.add("pending");
    if (bytes?.conflict) {
      element.classList.add("conflict");
      element.setAttribute("aria-invalid", "true");
    }
    if (bytes?.lock) element.setAttribute("aria-readonly", "true");
    // Un testo che non va a capo passa nelle celle vuote accanto, fino alla
    // prima che ha un valore.
    if (style?.shrink) element.dataset.shrink = "true";
    let measure = Boolean(style?.shrink) || bytes?.value.kind === "number";
    if (!merge && bytes && spills(style, bytes)) {
      const reach = this._spillReach(position, horizontalOf(style, bytes.value));
      if (reach > 0) {
        const align = horizontalOf(style, bytes.value);
        element.classList.add("spill");
        text.style.maxWidth = `calc(${width + reach}px - 0.9rem)`;
        text.style.justifySelf = align === "end" ? "unsafe end" : align === "center" ? "unsafe center" : "start";
        measure = false;
      }
    }
    // Una cella di una colonna bloccata sta ferma a sinistra da sé
    // (`_stickLeft`); le altre scorrono con la riga.
    const top = this._rows.offsets[row] - this._rows.offsets[hostRow];
    const put = frozenColumn
      ? (target: HTMLElement, left: number, y: number, w: number, h: number) => this._stickLeft(target, left, y, w, h)
      : (target: HTMLElement, left: number, y: number, w: number, h: number) => this._place(target, left, y, w, h);
    put(element, this._columnLeft(column), top, width, height);
    let border: HTMLElement | null = null;
    const borders = this._cellBorders(position, lastRow, lastColumn);
    if (borders) {
      border = document.createElement("div");
      border.className = frozenColumn ? "grid-border frozen" : "grid-border";
      border.setAttribute("aria-hidden", "true");
      paintBorders(border, borders);
      put(border, this._columnLeft(column) - 1, top - 1, width + 1, height + 1);
    }
    return { cell: element, border, measure };
  }

  /// I bordi da disegnare attorno alla cella, o all'unione che finisce in
  /// `lastRow` e `lastColumn`: sopra e a sinistra quelli della prima cella,
  /// sotto e a destra quelli delle celle che stanno lì.
  _cellBorders(position: GridPosition, lastRow: number, lastColumn: number) {
    const own = this._workbookCell(position)?.style?.borders;
    if (lastRow === position.row && lastColumn === position.column) return hasBorders(own) ? own : null;
    const right = this._workbookCell({ row: position.row, column: lastColumn })?.style?.borders ?? own;
    const bottom = this._workbookCell({ row: lastRow, column: position.column })?.style?.borders ?? own;
    const borders = {
      top: own?.top ?? null,
      left: own?.left ?? null,
      right: right?.right ?? null,
      bottom: bottom?.bottom ?? null,
      diagonal_down: own?.diagonal_down ?? null,
      diagonal_up: own?.diagonal_up ?? null,
    };
    return hasBorders(borders) ? borders : null;
  }

  /// Quanti pixel accanto il testo di `position` può prendere: le celle
  /// vuote verso dove si allinea, fino alla prima con un valore, a
  /// un'unione o al bordo delle colonne disegnabili.
  _spillReach(position: GridPosition, align: "start" | "center" | "end" | "justify"): number {
    const free = (step: 1 | -1): number => {
      let reach = 0;
      for (let column = position.column + step, seen = 0; column >= 0 && column < this._columns.sizes.length && seen < 64; column += step, seen += 1) {
        if (column < this._frame.frozenColumns !== position.column < this._frame.frozenColumns) break;
        const at = { row: position.row, column };
        if (this._workbookCell(at)?.cell.input || mergeAt(this._merges(), at)) break;
        reach += this._columns.sizes[column];
      }
      return reach;
    };
    switch (align) {
      case "start": return free(1);
      case "end": return free(-1);
      case "center": return 2 * Math.min(free(1), free(-1));
      default: return 0;
    }
  }

  /// Misura le celle che si stringono e i numeri: un testo che si stringe
  /// cala il carattere finché entra, un numero che non entra si mostra con
  /// i cancelletti, come in Excel. Prima si legge tutto, poi si scrive.
  _fitCells(cells: readonly HTMLElement[]): void {
    const fits: { text: HTMLElement; shrink: boolean; ratio: number }[] = [];
    // Il margine interno è lo stesso per le celle che non ne hanno uno loro
    // (un rientro o un'icona lo allargano): si legge una volta per quelle.
    let shared: number | null = null;
    for (const cell of cells) {
      const text = cell.querySelector<HTMLElement>(".grid-cell-text");
      if (!text) continue;
      let padding: number;
      if (!cell.style.paddingInlineStart && !cell.style.paddingInlineEnd && shared !== null) {
        padding = shared;
      } else {
        const computed = getComputedStyle(cell);
        padding = (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0);
        if (!cell.style.paddingInlineStart && !cell.style.paddingInlineEnd) shared = padding;
      }
      const room = cell.clientWidth - padding;
      const needed = text.scrollWidth;
      if (room > 0 && needed > room) fits.push({ text, shrink: cell.style.whiteSpace !== "pre-wrap" && cell.dataset.shrink === "true", ratio: room / needed });
    }
    for (const { text, shrink, ratio } of fits) {
      if (shrink) {
        text.style.fontSize = `${Math.max(0.3, ratio).toFixed(3)}em`;
      } else {
        const length = text.textContent?.length ?? 0;
        text.textContent = "#".repeat(Math.max(1, Math.floor(length * ratio)));
      }
    }
  }

  /// Un elemento che sta fermo a sinistra dentro la sua riga, a `left` dal
  /// bordo del riquadro: un'intestazione di riga, l'angolo, una cella o
  /// un'intestazione di una colonna bloccata. È nel flusso della riga senza
  /// occuparvi posto (i margini ne annullano la larghezza), con la posizione
  /// naturale all'inizio della riga, e `sticky` lo tiene a `left`: lo fa il
  /// compositore, nello stesso fotogramma dello scorrimento. `top` è dalla
  /// cima della riga (un'unione può cominciare sopra di lei).
  _stickLeft(element: HTMLElement, left: number, top: number, width: number, height: number): void {
    const before = Math.min(0, left);
    element.style.position = "sticky";
    element.style.left = `${left}px`;
    element.style.top = "";
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.marginTop = top ? `${top}px` : "";
    element.style.marginLeft = before ? `${before}px` : "";
    element.style.marginRight = `${-(width + before)}px`;
  }

  _place(element: HTMLElement, left: number, top: number, width: number, height: number): void {
    element.style.position = "absolute";
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }
  _findCell(position: GridPosition): HTMLElement | null {
    return this._viewport.querySelector<HTMLElement>(`.grid-cell[data-row="${position.row}"][data-column="${position.column}"]`);
  }

  _detachCellEditor(): void {
    const host = this._cellEditorHost;
    if (host.parentElement !== this._plane) this._plane.append(host);
    host.classList.remove("wraps");
    delete host.dataset.row;
    delete host.dataset.column;
    this._editorDress = null;
    this._editorNeed = null;
    this._editorHeight = null;
  }

  /// La cella che l'elemento disegna, dai suoi `data-row`/`data-column`.
  _positionOf(cell: HTMLElement): GridPosition | null {
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
  }

  _cellId(position: GridPosition): string {
    return `grid-${this._options.surfaceId}-${position.row}-${position.column}`;
  }

  /// Apre la cella (o la barra della formula) su `position`. Una battuta
  /// (`initial`) apre in «Inserisci», F2 e il doppio clic in «Modifica».
  _beginEditing(
    owner: "cell" | "formula",
    position: GridPosition,
    initial?: string,
    mode: "insert" | "edit" = initial === undefined ? "edit" : "insert",
  ): void {
    if (this._readOnly || !this._workbook || !this._isVisiblePosition(position)) return;
    const refusal = this._writeRefusal(position);
    if (refusal) {
      this._refuse(refusal);
      return;
    }
    const current = localInput(this._workbookCell(position)?.bytes.input ?? "", this._decimal);
    if (this._editing && (!samePosition(this._editing.position, position) || this._editing.owner !== owner)) {
      this._finishEditing(true, "input", false);
    }
    this._editing = {
      position,
      original: current,
      draft: initial ?? current,
      owner,
      mode,
      theirs: null,
      coordinate: coordinateAt(this._sheet(), position),
    };
    if (owner === "cell") {
      const cell = this._findCell(position);
      if (!cell) {
        this._editing = null;
        return;
      }
      // La cella aperta è la cella: il suo carattere, la sua carta, il testo
      // dove stava. Il resto è subito al suo posto; la cornice compare.
      this._editorDress = null;
      this._mountCellEditor(position, cell);
      this._cellEditor.setDoc(this._editing.draft);
      this._positionEditor(position, true);
      showEditorFrame(this._cellEditorFrame, this._life);
      // La maniglia del riempimento se ne va (`_fillServed`): resterebbe
      // sopra il testo della cella aperta, che ora si allarga oltre l'angolo.
      this._updateMarks(this._selectedRange());
      // Il cursore va in fondo, come nei fogli di calcolo: la battuta che ha
      // aperto la cella è già scritta, e le altre la seguono. Non con
      // `revealByteOffset`: porterebbe la riga del cursore in cima scorrendo
      // anche la griglia, che invece resta dov'è (la cella è già in vista, e
      // la cella aperta sta sopra di lei). Scorre solo il testo nel campo.
      const editor = this._cellEditor;
      if (editor.placeCursor(editor.getDoc().length)) {
        editor.focus();
        const scroller = this._cellEditorField.querySelector<HTMLElement>(".cm-scroller");
        if (scroller && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop = scroller.scrollHeight;
      } else {
        editor.revealByteOffset(new TextEncoder().encode(this._editing.draft).length);
      }
    } else {
      this._formulaEditor.setDoc(this._editing.draft);
    }
    this._options.onEditMode?.();
    this._pendingChanged();
  }

  /// Un disegno dei segni, uno per fotogramma: lo chiedono lo scorrimento
  /// (le righe le disegna il suo gestore), i riferimenti della formula e un
  /// disegno rimasto indietro (`_rowsBehind`), che ci finisce le sue celle
  /// con le misure lette dal gestore. Dopo, le misure si rileggono.
  _scheduleRender(): void {
    if (this._renderFrame !== null) return;
    this._renderFrame = requestAnimationFrame(() => {
      this._renderFrame = null;
      if (!this._destroyed) this._render(false);
      this._scrollView = null;
    });
  }

  /// F2 nella cella aperta: «Inserisci» ⇄ «Modifica».
  _toggleEditMode(): void {
    const editing = this._editing;
    if (editing?.owner !== "cell") return;
    editing.mode = editing.mode === "insert" ? "edit" : "insert";
    this._options.onEditMode?.();
  }

  /// Invio, Tab o una freccia nella cella aperta: conferma e si sposta.
  /// Ctrl+Invio scrive la bozza in tutta la selezione e resta.
  _commitAndMove(move: FormulaMove, arrow = false): void {
    const editing = this._editing;
    if (!editing) return;
    if (move === "fill") {
      this._fillDraft(editing);
      return;
    }
    this._finishEditing(true, "input");
    this._advance(move);
    // Soltanto Tab comincia una serie: una freccia la chiude.
    if (arrow) this._tabStart = null;
  }

  /// La bozza in ogni cella visibile della selezione.
  _fillDraft(editing: EditingState): void {
    const range = this._selectedRange();
    const inside = editing.position.row >= range.rowStart && editing.position.row <= range.rowEnd
      && editing.position.column >= range.columnStart && editing.position.column <= range.columnEnd;
    if (!inside) {
      this._finishEditing(true, "input");
      return;
    }
    this._finishEditing(false, "input");
    if (!this._rangeRead(range)) {
      this._refuse(t("grid.workbook.not_loaded"));
      return;
    }
    const after = fileInput(editing.draft, this._decimal);
    const writes: CellWrite[] = [];
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
        const position = { row, column };
        if (!this._isVisiblePosition(position)) continue;
        const merge = mergeAt(this._merges(), position);
        if (merge && (merge.row !== row || merge.column !== column)) continue;
        writes.push({ position, after });
      }
    }
    this._commitCells(writes, "input", true);
  }

  /// Sposta la cella attiva di un passo di Invio o di Tab: dentro la
  /// selezione se è più di una cella, altrimenti accanto (Invio torna alla
  /// colonna dove una serie di Tab era cominciata). Falso se oltre non c'è
  /// niente.
  _advance(move: Move): boolean {
    const shape: Shape = {
      step: (axis, from, step) => this._nextVisible(axis, from, step),
      visible: (axis, index) => ((axis === "row" ? this._rows.sizes : this._columns.sizes)[index] ?? 0) > 0,
    };
    const range = this._selectedRange();
    const active = this._active();
    const bounds = { r0: range.rowStart, c0: range.columnStart, r1: range.rowEnd, c1: range.columnEnd };
    if (isMultiCell(bounds) && !mergeCovers(this._merges(), range)) {
      const cell = nextInRange(bounds, active, move, shape);
      this._selection = { ...this._selection, active: cell };
      this._ensureVisible(cell);
      this._syncFormulaBar();
      this._render();
      this._selectionChanged();
      return true;
    }
    // Da un'unione si parte dal suo bordo.
    const merge = mergeAt(this._merges(), active);
    const from = merge
      ? {
        row: move === "down" ? merge.row + merge.rows - 1 : active.row,
        column: move === "right" ? merge.column + merge.columns - 1 : active.column,
      }
      : active;
    const step = nextCell(from, move, this._tabStart, shape);
    if (!step) return false;
    this._select(step.cell, false);
    this._tabStart = step.tabStart;
    return true;
  }

  _draftFromEditor(owner: "cell" | "formula", draft: string): void {
    const editing = this._editing;
    if (editing?.owner !== owner) return;
    // I contorni dei riferimenti seguono la formula.
    const formula = draft.startsWith("=") || editing.draft.startsWith("=");
    editing.draft = draft;
    this._pendingChanged();
    // La cella aperta si misura a ogni cambio della bozza, senza chiedere
    // niente all'host.
    if (owner === "cell" && !this._cellEditorHost.hidden) this._positionEditor(editing.position, true);
    if (formula) this._scheduleRender();
  }

  /// Il campo della formula aperta.
  _openEditor(): TextEngine | null {
    const editing = this._editing;
    if (!editing) return null;
    return editing.owner === "cell" ? this._cellEditor : this._formulaEditor;
  }

  /// Dove un riferimento puntato andrebbe adesso: quello appena puntato, se
  /// il cursore è ancora alla sua fine, o un posto dove la formula aspetta un
  /// operando.
  _pointSlot(): { readonly from: number; readonly to: number } | null {
    const editor = this._openEditor();
    if (!editor) return null;
    const text = editor.getDoc();
    const head = editor.cursorContext().head;
    const pointing = this._pointing;
    if (pointing && pointing.text === text && head === pointing.to) return { from: pointing.from, to: pointing.to };
    this._pointing = null;
    return operandSlot(text, head);
  }

  /// Scrive al posto di `slot` il riferimento da `anchor` a `focus`, con il
  /// cursore dopo, come una battuta.
  _writeReference(slot: { readonly from: number; readonly to: number }, anchor: GridPosition, focus: GridPosition): void {
    const editor = this._openEditor();
    if (!editor) return;
    const reference = rangeA1({
      rowStart: Math.min(anchor.row, focus.row),
      rowEnd: Math.max(anchor.row, focus.row),
      columnStart: Math.min(anchor.column, focus.column),
      columnEnd: Math.max(anchor.column, focus.column),
    });
    if (!editor.applyUserEdit(slot.from, slot.to, reference)) return;
    editor.placeCursor(slot.from + reference.length);
    this._pointing = { from: slot.from, to: slot.from + reference.length, text: editor.getDoc(), anchor, focus };
    this._scheduleRender();
  }

  /// Un clic (o l'inizio di un trascinamento) su una cella mentre la formula
  /// aspetta un operando scrive il riferimento, e la cella resta aperta.
  _pointerReference(event: PointerEvent): boolean {
    const slot = this._pointSlot();
    if (!slot) return false;
    const hit = this._eventPosition(event) ?? this._hit(event.clientX, event.clientY, false);
    if (!hit || hit.row === null || hit.column === null) return false;
    // Il fuoco resta nel campo della formula.
    event.preventDefault();
    const position = { row: hit.row, column: hit.column };
    this._writeReference(slot, position, position);
    this._drag = { kind: "point", anchor: position, x: event.clientX, y: event.clientY };
    this._viewport.setPointerCapture?.(event.pointerId);
    return true;
  }

  /// Le frecce nel modo «Inserisci» dove la formula aspetta un operando:
  /// muovono il riferimento puntato (dalla cella aperta, la prima volta), e
  /// con Maiuscolo lo allargano.
  _pointByKey(move: "down" | "up" | "right" | "left", extend: boolean): boolean {
    const editing = this._editing;
    if (!editing || editing.owner !== "cell") return false;
    const slot = this._pointSlot();
    if (!slot) return false;
    const pointing = this._pointing;
    const focus = this._stepPosition(pointing?.focus ?? editing.position, move);
    this._writeReference(slot, extend && pointing ? pointing.anchor : focus, focus);
    return true;
  }

  /// La cella accanto a `from` verso `move`, oltre righe e colonne nascoste.
  _stepPosition(from: GridPosition, move: "down" | "up" | "right" | "left"): GridPosition {
    const rows = move === "down" ? 1 : move === "up" ? -1 : 0;
    const columns = move === "right" ? 1 : move === "left" ? -1 : 0;
    let { row, column } = from;
    do {
      row += rows;
      column += columns;
    } while (
      row >= 0 && column >= 0 && row < this._rows.sizes.length && column < this._columns.sizes.length
      && (this._rows.sizes[row] === 0 || this._columns.sizes[column] === 0)
    );
    return this._clampedPosition({ row, column });
  }

  /// Il contorno di ogni riferimento della formula aperta che sta sul foglio
  /// mostrato, del colore che ha nel testo.
  _referenceMarks(drawing: Drawing): void {
    const draft = this._editing?.draft ?? "";
    if (!draft.startsWith("=")) return;
    const name = this._sheet().name.toLowerCase();
    for (const reference of formulaReferences(draft)) {
      const bang = reference.text.lastIndexOf("!");
      if (bang >= 0) {
        const sheet = reference.text.slice(0, bang).replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
        if (sheet.toLowerCase() !== name) continue;
      }
      const range = parseRangeA1(reference.text.slice(bang + 1).toUpperCase());
      const box = range ? this._rangeBox(range) : null;
      if (box) this._rectMark(drawing, `grid-formula-ref grid-formula-ref-${reference.color + 1}`, box);
    }
  }

  _commitAfterBlur(owner: "cell" | "formula"): void {
    queueMicrotask(() => {
      if (this._destroyed || this._editing?.owner !== owner) return;
      // Un clic che punta un riferimento può portare via il fuoco: torna al
      // campo della formula, che resta aperto.
      if (this._drag?.kind === "point") {
        this._openEditor()?.focus();
        return;
      }
      const host = owner === "cell" ? this._cellEditorHost : this._formulaHost;
      // Il fuoco è andato altrove di sua volontà: la cella si conferma e il
      // fuoco resta dove è andato.
      if (!host.contains(document.activeElement)) this._finishEditing(true, "input", false);
    });
  }

  _finishEditing(commit: boolean, origin: EditorChangeOrigin, restoreFocus = true): void {
    const editing = this._editing;
    if (!editing) return;
    this._editing = null;
    this._pointing = null;
    this._draftNotice.hidden = true;
    // La cornice esce da dov'è (anche a metà della sua entrata); il campo
    // sparisce subito, e la cella sotto ha già il valore.
    if (editing.owner === "cell" && !this._cellEditorHost.hidden) hideEditorFrame(this._cellEditorFrame);
    this._detachCellEditor();
    this._cellEditorHost.hidden = true;
    this._cellEditorHost.setAttribute("aria-hidden", "true");
    this._editorForReaders(null);
    this._options.onEditMode?.();
    if (commit && editing.draft !== editing.original) {
      this._commitCells([{ position: editing.position, after: fileInput(editing.draft, this._decimal) }], origin, true);
    }
    this._pendingChanged();
    this._syncFormulaBar();
    this._render();
    // Il fuoco torna alla griglia, se nel frattempo non si è aperta un'altra
    // cella: le toglierebbe il fuoco, e la confermerebbe.
    if (restoreFocus) queueMicrotask(() => {
      if (!this._destroyed && !this._editing) this._viewport.focus();
    });
  }

  /// La zona del piano della cella aperta: quella della sua cella.
  _editorZone(position: GridPosition): Zone {
    return zoneOf(position.column < this._frame.frozenColumns, position.row < this._frame.frozenRows);
  }

  /// Mette la cella aperta in fondo al livello «lift» della zona della sua
  /// cella, la mostra e la veste come la cella. Spostandola, il fuoco resta
  /// nel campo.
  _mountCellEditor(position: GridPosition, cell: HTMLElement): void {
    // Il campo prima delle misure: la veste legge il carattere dal suo
    // `.cm-content`.
    const field = this._cellEditor;
    const host = this._cellEditorHost;
    const lift = this._lifts[this._editorZone(position)];
    if (host.parentElement !== lift) {
      const focused = host.contains(document.activeElement);
      lift.append(host);
      if (focused) field.focus();
    }
    host.dataset.row = String(position.row);
    host.dataset.column = String(position.column);
    host.hidden = false;
    host.removeAttribute("aria-hidden");
    this._editorForReaders({ lift, cell, position });
    this._dressEditor(position, cell);
  }

  /// La cella aperta per chi usa un lettore di schermo. I livelli «lift» non
  /// si leggono, salvo quello che porta la cella aperta: un campo col fuoco
  /// dentro un `aria-hidden` sparisce (axe `aria-hidden-focus`); ciò che il
  /// livello porta oltre al campo (i segni d'angolo, gli oggetti) è
  /// `aria-hidden` da sé. E il campo sta nel livello, non nella cella, ma una
  /// griglia contiene solo righe e celle: la cella lo dichiara suo
  /// (`aria-owns`), e chi legge lo trova dov'è la cella. `null` quando la
  /// cella si chiude.
  _editorForReaders(
    open: { readonly lift: HTMLElement; readonly cell: HTMLElement; readonly position: GridPosition } | null,
  ): void {
    for (const lift of new Set(Object.values(this._lifts))) {
      if (lift === open?.lift) lift.removeAttribute("aria-hidden");
      else lift.setAttribute("aria-hidden", "true");
    }
    const before = this._editorOwner?.cell;
    if (before && before !== open?.cell) before.removeAttribute("aria-owns");
    this._editorOwner = open ? { cell: open.cell, position: open.position } : null;
    open?.cell.setAttribute("aria-owns", this._cellEditorHost.id);
  }

  /// Veste la cella aperta come la cella `cell`: la carta e l'inchiostro del
  /// file, il carattere (`--field-font`, che la pelle dell'editor dà a
  /// `.cm-content`), il peso, la misura, l'allineamento e i margini, così il
  /// testo non si sposta di un pixel. In «Inserisci» il testo parte da
  /// sinistra; in «Modifica» tiene l'allineamento della cella. Si rifà solo
  /// quando la cella o lo stile cambiano: legge le misure.
  _dressEditor(position: GridPosition, cell: HTMLElement): void {
    const workbookCell = this._workbookCell(position);
    const horizontal = this._editing?.mode === "insert" || !workbookCell?.bytes
      ? "start"
      : horizontalOf(workbookCell.style, workbookCell.bytes.value);
    const align = horizontal === "center" || horizontal === "end" ? horizontal : "start";
    const key = `${position.row},${position.column}|${align}|${this._frame.zoom}|${cell.style.cssText}`;
    if (this._editorDress?.key === key) return;
    const style = this._cellEditorHost.style;
    for (const name of EDITOR_PAPER) {
      const value = cell.style.getPropertyValue(name);
      if (value) style.setProperty(name, value);
      else style.removeProperty(name);
    }
    style.fontWeight = cell.style.fontWeight;
    style.fontStyle = cell.style.fontStyle;
    style.fontSize = cell.style.fontSize;
    style.textAlign = align;
    style.setProperty("--field-font", cell.style.fontFamily || this._gridFont() || "inherit");
    const computed = getComputedStyle(cell);
    const padLeft = parseFloat(computed.paddingLeft) || 0;
    const padRight = parseFloat(computed.paddingRight) || 0;
    style.setProperty("--field-pad-top", `${Math.max(0, this._textTop(cell, computed))}px`);
    style.setProperty("--field-pad-left", `${padLeft}px`);
    style.setProperty("--field-pad-right", `${padRight}px`);
    const content = this._cellEditorField.querySelector<HTMLElement>(".cm-content");
    const font = content ? getComputedStyle(content) : computed;
    this._editorDress = {
      key,
      font: font.font || `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`,
      size: parseFloat(font.fontSize) || 13,
      padLeft,
      padRight,
    };
    this._editorNeed = null;
    this._editorHeight = null;
  }

  /// Dove comincia il testo nella cella, dal suo bordo alto: la prima riga
  /// del testo, o, per una cella vuota, dove la riga starebbe secondo
  /// l'allineamento in verticale (`paint.ts`, `alignContent`).
  _textTop(cell: HTMLElement, computed: CSSStyleDeclaration): number {
    const text = cell.querySelector<HTMLElement>(".grid-cell-text");
    if (!text) return parseFloat(computed.paddingTop) || 0;
    const box = cell.getBoundingClientRect();
    const at = text.getBoundingClientRect();
    if (at.height > 0) return at.top - box.top;
    const line = parseFloat(computed.lineHeight) || (parseFloat(computed.fontSize) || 13) * 1.3;
    switch (computed.alignContent) {
      case "start": return at.top - box.top;
      case "center": return at.top - box.top - line / 2;
      default: return at.bottom - box.top - line;
    }
  }

  /// La misura del testo della bozza: la riga più larga col carattere della
  /// cella, sulla tela, più i margini; e quante righe.
  _measureEditorText(): { readonly width: number; readonly lines: number } {
    const dress = this._editorDress;
    const lines = (this._editing?.draft ?? "").split("\n");
    let widest = 0;
    const context = dress ? measureContext() : null;
    if (context && dress) {
      context.font = dress.font;
      for (const line of lines) widest = Math.max(widest, context.measureText(line).width);
    } else {
      // Senza tela (un DOM di prova): una stima larga.
      for (const line of lines) widest = Math.max(widest, line.length * (dress?.size ?? 13) * 0.6);
    }
    return { width: Math.ceil(widest) + (dress?.padLeft ?? 0) + (dress?.padRight ?? 0) + EDITOR_SLACK, lines: lines.length };
  }

  /// L'altezza del testo della cella aperta larga `width`: dalla cima del
  /// campo al fondo dell'ultima riga. Si rilegge quando il testo cambia o la
  /// larghezza è un'altra.
  _editorTextHeight(width: number, measure: boolean): number {
    const known = this._editorHeight;
    if (!measure && known?.width === width) return known.height;
    const content = this._cellEditorField.querySelector<HTMLElement>(".cm-content");
    const last = content?.querySelector<HTMLElement>(".cm-line:last-child");
    const height = content && last ? last.getBoundingClientRect().bottom - content.getBoundingClientRect().top : 0;
    this._editorHeight = { width, height };
    return height;
  }

  /// Il posto e la misura della cella aperta (B2): parte dalla cella e cresce
  /// a colonne intere verso dove il testo va (a destra, o a sinistra per una
  /// cella allineata a destra) finché il testo ci sta, fino al bordo del
  /// riquadro; dall'altra parte no, perché il testo resti dov'era. Se non ci
  /// sta va a capo (`wraps`) e cresce in giù a righe intere fino a metà del
  /// riquadro e non oltre il suo fondo, poi il testo scorre dentro. Sta nel
  /// livello della sua zona, che scorre con le celle: una cella di una colonna
  /// bloccata cresce dentro la sua zona e oltre. `measure` rimisura il testo.
  _positionEditor(position: GridPosition, measure = false): void {
    const host = this._cellEditorHost;
    const frame = this._frame;
    const rows = this._rows;
    const merge = mergeAt(this._merges(), position);
    const lastRow = merge ? merge.row + merge.rows - 1 : position.row;
    const lastColumn = merge ? merge.column + merge.columns - 1 : position.column;
    if (measure || !this._editorNeed) this._editorNeed = this._measureEditorText();
    const need = this._editorNeed;
    const view = this._readView();
    const bands = this._bands();
    const frozenColumn = position.column < frame.frozenColumns;
    const frozenRow = position.row < frame.frozenRows;
    // I confini delle colonne e delle righe sullo schermo, dall'angolo del
    // riquadro: quelli di una fascia ferma non scorrono.
    const x = (index: number) => this._columnLeft(index) - (frozenColumn && index <= frame.frozenColumns ? 0 : view.scrollLeft);
    const y = (index: number) => frame.columnHeader + rows.offsets[index] - (frozenRow && index <= frame.frozenRows ? 0 : view.scrollTop);
    const across = openSpan(
      x,
      this._columns.sizes.length,
      position.column,
      lastColumn + 1,
      need.width,
      frozenColumn ? frame.rowHeader : bands.left,
      view.width,
      host.style.textAlign === "end" ? ["before"] : ["after"],
    );
    const width = Math.max(0, x(across.end) - x(across.start) - 1);
    const left = this._columnLeft(position.column) - (x(position.column) - x(across.start));
    const wraps = !across.fits;
    host.classList.toggle("wraps", wraps);
    let down: OpenSpan = { start: position.row, end: lastRow + 1, fits: true };
    if (wraps || need.lines > 1) {
      host.style.width = `${width}px`;
      const height = this._editorTextHeight(width, measure);
      const cap = Math.max(rows.offsets[lastRow + 1] - rows.offsets[position.row] - 1, view.height / 2);
      const low = frozenRow ? frame.columnHeader : bands.top;
      down = openSpan(y, rows.sizes.length, position.row, lastRow + 1, height, low, Math.min(view.height, y(position.row) + cap + 1), ["after"]);
    }
    const height = Math.max(0, y(down.end) - y(down.start) - 1);
    const top = frame.columnHeader + rows.offsets[position.row] - (y(position.row) - y(down.start));
    const at = wholeRect(this._editorZone(position), { x: left, y: top, w: width, h: height }, bands);
    this._place(host, at.x, at.y, at.w, at.h);
  }

  /// Copia scrive il TSV degli input e una tabella HTML di ciò che si
  /// vede, come i fogli di calcolo; toglie le formiche di un taglio. Attorno
  /// a ciò che si è copiato restano un tratteggio largo e, una volta, un
  /// battito (griglia T6), finché non si incolla, si scrive o si preme Esc.
  _copy(event: ClipboardEvent): void {
    if (!this._takeCopy(event)) return;
    const range = this._selectedRange();
    const style = this._copyMarkStyle;
    this._cutMark = null;
    // «Solo il battito»: niente tratteggio da ricordare, e il bordo della
    // selezione resta.
    this._copyMark = style === "pulse" ? null : { sheet: this._sheet().id, range };
    this._render();
    const box = this._rangeBox(range);
    if (box && style !== "dash") this._marks.pulse({ x: box.left, y: box.top, w: box.width, h: box.height });
  }

  /// Mette negli appunti la selezione e la ricorda (`_copied`). Falso se non
  /// si copia niente.
  _takeCopy(event: ClipboardEvent): boolean {
    if (!event.clipboardData) return false;
    event.preventDefault();
    // Come in Excel: più intervalli non si copiano insieme.
    if (this._others.length) {
      this._refuse(t("grid.multi.refused"));
      return false;
    }
    const { text, html } = this._clipboard();
    event.clipboardData.setData("text/plain", text);
    event.clipboardData.setData("text/html", html);
    this._copied = { sheet: this._sheet().id, range: this._selectedRange(), text, move: false };
    return true;
  }

  /// Taglia non svuota subito: segna l'intervallo con un tratteggio fitto, e
  /// l'incolla che segue lo sposta. Esc toglie il segno.
  _cut(event: ClipboardEvent): void {
    if (this._readOnly || !event.clipboardData) return;
    if (!this._takeCopy(event)) return;
    this._cutMark = { sheet: this._sheet().id, range: this._selectedRange(), text: this._clipboard().text };
    this._copied = { ...this._cutMark, move: true };
    this._copyMark = null;
    this._render();
  }

  _paste(event: ClipboardEvent): void {
    if (this._readOnly || !event.clipboardData) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    const copied = this._copied;
    if (copied && copied.text === text && this._pasteFrom(copied)) return;
    const mark = this._cutMark;
    if (mark && mark.text === text && mark.sheet === this._sheet().id) {
      this._pasteCut(mark);
      return;
    }
    this._pasteRows(clipboardRows(text, event.clipboardData.getData("text/html")));
  }

  /// L'incolla di ciò che si è copiato dalla cartella, quando il catalogo
  /// serve `fub.pasteFrom`: dall'angolo della selezione, ripetuto dove la
  /// selezione ne contiene più copie. Un taglio si incolla una volta.
  ///
  /// I valori si vedono subito, come anteprima (`_previewPaste`), e quelli
  /// che il provider rilegge prendono il loro posto; se dice di no, le celle
  /// tornano com'erano e l'avviso dice perché. Un taglio incollato ha le
  /// formiche attorno a ciò che si sposta finché il foglio non risponde.
  _pasteFrom(copied: Copied): boolean {
    if (!this.commandable() || !this._serves(PASTE_FROM) || this._others.length) return false;
    const params = { source: rangeA1(copied.range), sourceSheet: copied.sheet, move: copied.move };
    const wait: Waiting | null = copied.move ? { kind: "move", sheet: copied.sheet, range: copied.range, source: null } : null;
    let previews: PastePreview[] = [];
    const given = this._command(PASTE_FROM, JSON.stringify(params), (applied) => {
      if (!applied) this._unshowPaste(previews);
      if (wait) this._settleWait(wait, applied);
    });
    if (!given) return false;
    // Incollare toglie il tratteggio di ciò che si è copiato; ciò che si è
    // copiato resta, e si incolla ancora.
    this._copyMark = null;
    if (copied.move) {
      this._copied = null;
      this._cutMark = null;
      this._waiting = wait;
    }
    previews = this._previewPaste(copied);
    this._render();
    return true;
  }

  /// I valori di `copied` dove l'incolla li scriverà, come anteprima con le
  /// regole delle celle scritte (`_showWritten`): ogni copia che la selezione
  /// contiene, o la sola destinazione di un taglio, che svuota le celle da
  /// cui parte. Una formula resta com'era: i suoi riferimenti li sposta il
  /// provider. Una cella che non si scrive (bloccata, fuori dal foglio, non
  /// letta) non si mostra.
  _previewPaste(copied: Copied): PastePreview[] {
    const values = clipboardRows(copied.text, "");
    const block = { rows: values.length, columns: Math.max(0, ...values.map((row) => row.length)) };
    if (!block.rows || !block.columns) return [];
    const selection = tableRange(this._selectedRange());
    const targets = copied.move ? [cutDestination(tableRange(copied.range), selection)] : pasteTargets(selection, block);
    const sheet = this._sheet();
    const writes = new Map<string, { readonly position: GridPosition; readonly after: string }>();
    const put = (position: GridPosition, after: string) => {
      if (position.row >= sheet.rows.length || position.column >= sheet.columns.length) return;
      writes.set(`${position.row}:${position.column}`, { position, after });
    };
    if (copied.move && copied.sheet === sheet.id) {
      for (let row = copied.range.rowStart; row <= copied.range.rowEnd; row += 1) {
        for (let column = copied.range.columnStart; column <= copied.range.columnEnd; column += 1) put({ row, column }, "");
      }
    }
    for (const target of targets) {
      values.forEach((line, rowOffset) => line.forEach((value, columnOffset) => {
        put({ row: target.r0 + rowOffset, column: target.c0 + columnOffset }, fileInput(value, this._decimal));
      }));
    }
    const shown: PastePreview[] = [];
    for (const { position, after } of writes.values()) {
      if (after.startsWith("=") || this._writeRefusal(position)) continue;
      const merge = mergeAt(this._merges(), position);
      if (merge && (merge.row !== position.row || merge.column !== position.column)) continue;
      if ((this._workbookCell(position)?.bytes.input ?? "") === after) continue;
      const preview = this._showWritten(position, after);
      if (preview) shown.push(preview);
    }
    if (shown.length) this._showView(sheet.id, false);
    return shown;
  }

  /// Il provider non ha preso l'incolla: le celle mostrate in anticipo
  /// tornano com'erano, se una lettura non le ha già sostituite.
  _unshowPaste(previews: readonly PastePreview[]): void {
    if (this._destroyed || !previews.length) return;
    let restored = false;
    const gone = new Set<GridBytesCell>();
    for (const { window, previous, shown } of previews) {
      if (!window.cells.includes(shown)) continue;
      window.cells = [...window.cells.filter((cell) => cell !== shown), ...(previous ? [previous] : [])];
      this._pendingCells.delete(shown);
      gone.add(shown);
      restored = true;
    }
    // Ciò che torna non è un valore nuovo: niente dissolvenza d'entrata.
    for (const [key, written] of this._written) if (gone.has(written.shown)) this._written.delete(key);
    if (restored && this._workbook) this._showView(this._sheet().id, false);
  }

  _clipboard(): { readonly text: string; readonly html: string } {
    const range = this._selectedRange();
    const rows: ClipboardCell[][] = [];
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      const cells: ClipboardCell[] = [];
      for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
        const bytes = this._workbookCell({ row, column })?.bytes;
        const input = this._cellAt({ row, column })?.input ?? "";
        cells.push({ input, shown: bytes?.display || input });
      }
      rows.push(cells);
    }
    return clipboardData(rows);
  }

  _pasteTsv(text: string): void {
    this._pasteRows(clipboardRows(text, ""));
  }

  /// Incolla dall'angolo in alto a sinistra della selezione. Un valore, o un
  /// blocco che la selezione contiene un numero intero di volte, la riempie.
  /// Dopo, la selezione è ciò che si è scritto.
  _pasteRows(values: readonly (readonly string[])[]): void {
    const block = { rows: values.length, columns: Math.max(0, ...values.map((row) => row.length)) };
    const range = this._selectedRange();
    const targets = pasteTargets(
      { r0: range.rowStart, c0: range.columnStart, r1: range.rowEnd, c1: range.columnEnd },
      block,
    );
    if (!targets.length) return;
    const writes = new Map<string, CellWrite>();
    for (const target of targets) {
      values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
        const position = { row: target.r0 + rowOffset, column: target.c0 + columnOffset };
        writes.set(`${position.row}:${position.column}`, { position, after: fileInput(value, this._decimal) });
      }));
    }
    const last = targets[targets.length - 1];
    this._writePasted([...writes.values()], { rowStart: targets[0].r0, columnStart: targets[0].c0, rowEnd: last.r1, columnEnd: last.c1 });
  }

  /// L'incolla dopo un taglio: gli input vanno all'angolo della selezione e
  /// le celle tagliate che restano fuori si svuotano, in un passo solo.
  _pasteCut(mark: { readonly range: GridRange; readonly text: string }): void {
    const destination = cutDestination(tableRange(mark.range), tableRange(this._selectedRange()));
    const to: GridRange = {
      rowStart: destination.r0,
      columnStart: destination.c0,
      rowEnd: destination.r1,
      columnEnd: destination.c1,
    };
    const inside = (range: GridRange, row: number, column: number) =>
      row >= range.rowStart && row <= range.rowEnd && column >= range.columnStart && column <= range.columnEnd;
    const writes: CellWrite[] = [];
    for (let row = mark.range.rowStart; row <= mark.range.rowEnd; row += 1) {
      for (let column = mark.range.columnStart; column <= mark.range.columnEnd; column += 1) {
        const input = this._cellAt({ row, column })?.input ?? "";
        const moved = { row: row - mark.range.rowStart + to.rowStart, column: column - mark.range.columnStart + to.columnStart };
        if (!inside(to, row, column) && input !== "") writes.push({ position: { row, column }, after: "" });
        writes.push({ position: moved, after: input });
      }
    }
    this._cutMark = null;
    // Le formiche attorno a ciò che si sposta, finché il foglio non ha
    // risposto alla scrittura: il passo dopo nella coda del protocollo.
    const wait: Waiting = { kind: "move", sheet: this._sheet().id, range: mark.range, source: null };
    this._waiting = wait;
    if (!this._writePasted(writes, to)) {
      this._waiting = null;
      this._updateMarks(this._selectedRange());
      return;
    }
    this._enqueueProtocol(async () => this._settleWait(wait, true));
  }

  _writePasted(writes: readonly CellWrite[], range: GridRange): boolean {
    const sheet = this._sheet();
    const fits = writes.filter(({ position }) => position.row < sheet.rows.length && position.column < sheet.columns.length);
    if (!this._commitCells(fits, "input", true)) {
      this._render();
      return false;
    }
    const anchor = { row: range.rowStart, column: range.columnStart };
    const focus = this._clampedPosition({ row: range.rowEnd, column: range.columnEnd });
    this._others = [];
    this._selection = { anchor, focus };
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
    return true;
  }

  _pointerDown(event: PointerEvent): void {
    // Solo il tasto principale; un evento senza tasto vale come quello.
    if (event.button > 0) return;
    // Una formula aperta che aspetta un operando prende il riferimento.
    if (this._editing && this._pointerReference(event)) return;
    // La cella aperta si conferma prima di scegliere altro, come in un foglio
    // di calcolo; il disegno che segue tiene la cella sotto il puntatore.
    if (this._editing?.owner === "cell") this._finishEditing(true, "input", false);
    const object = event.target instanceof Element ? event.target.closest<HTMLElement>(".grid-object") : null;
    if (object && this._objectPointerDown(event, object)) return;
    // Col dito trascinare scorre e basta: la griglia sceglie solo al tocco.
    if (event.pointerType === "touch") {
      this._touchDown(event);
      return;
    }
    // Il mouse e la penna fanno ciò che fanno sempre; tolgono le maniglie del
    // tocco e rimettono il quadratino.
    if (this._touchLast || this._grips) {
      this._touchLast = false;
      this._grips = false;
      this._lastTap = null;
      this._render();
    }
    const edge = this._resizeEdge(event.clientX, event.clientY);
    if (edge) {
      event.preventDefault();
      const size = (edge.axis === "column" ? this._columns : this._rows).sizes[edge.index];
      this._resize = { ...edge, from: edge.axis === "column" ? event.clientX : event.clientY, size, now: size };
      this._viewport.setPointerCapture?.(event.pointerId);
      this._viewport.focus();
      this._render();
      return;
    }
    if (this._onSelectionEdge(event.clientX, event.clientY)) {
      const hit = this._hit(event.clientX, event.clientY, true);
      if (hit && hit.row !== null && hit.column !== null) {
        event.preventDefault();
        const source = this._selectedRange();
        // La cella presa dentro la selezione, più vicina al punto.
        const grab = {
          row: Math.min(source.rowEnd, Math.max(source.rowStart, hit.row)) - source.rowStart,
          column: Math.min(source.columnEnd, Math.max(source.columnStart, hit.column)) - source.columnStart,
        };
        this._drag = { kind: "move", source, grab, target: source, x: event.clientX, y: event.clientY };
        this._viewport.setPointerCapture?.(event.pointerId);
        this._viewport.focus();
        this._render();
        return;
      }
    }
    if (this._onFillHandle(event.clientX, event.clientY)) {
      event.preventDefault();
      const source = this._selectedRange();
      this._drag = { kind: "fill", source, target: source, x: event.clientX, y: event.clientY };
      this._viewport.setPointerCapture?.(event.pointerId);
      this._viewport.focus();
      this._render();
      return;
    }
    // Su una cella vale la cella; fuori (le intestazioni non prendono il
    // puntatore) vale il punto.
    const cell = this._eventPosition(event);
    const hit = cell ?? this._hit(event.clientX, event.clientY, false);
    if (!hit) return;
    event.preventDefault();
    if (this._selectedObject !== null) this._selectObject(null);
    const sheet = this._sheet();
    const lastRow = Math.max(0, sheet.rows.length - 1);
    const lastColumn = Math.max(0, sheet.columns.length - 1);
    // Sull'intestazione di una colonna si prende la colonna intera, su quella
    // di una riga la riga, sull'angolo il foglio, come in Excel.
    const kind = hit.row === null && hit.column === null ? "all" : hit.row === null ? "columns" : hit.column === null ? "rows" : "cells";
    // Ctrl+clic (e Ctrl+trascina) aggiunge un intervallo a quelli scelti;
    // Maiuscolo estende l'ultimo; un clic semplice ricomincia.
    const adding = (event.ctrlKey || event.metaKey) && !event.shiftKey && kind !== "all";
    if (adding) this._others = this._rangesOf(withRange(this._others.map(tableRange), tableRange(this._selectedRange())));
    else if (!event.shiftKey && !this._adding) this._others = [];
    if (kind === "all") {
      this._others = [];
      this._selection = {
        anchor: { row: lastRow, column: lastColumn },
        focus: { row: 0, column: 0 },
        active: { row: this._edgeVisible("row", false), column: this._edgeVisible("column", false) },
      };
    } else {
      const position = this._anchorOf({ row: hit.row ?? 0, column: hit.column ?? 0 });
      const anchor = event.shiftKey ? this._selection.anchor : position;
      this._tabStart = null;
      this._drag = { kind, anchor, x: event.clientX, y: event.clientY };
      this._dragSeen = this._viewportAt();
      this._selection = this._dragSelection(kind, anchor, position);
    }
    this._viewport.setPointerCapture?.(event.pointerId);
    this._viewport.focus();
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
  }

  /// Un dito giù sulla griglia (B4). Sulla presa di una maniglia del tocco
  /// lungo comincia a tirarla; altrove aspetta: alzato entro `TAP_MOVE` è un
  /// tocco (`_tap`), fermo per `LONG_PRESS_MS` un tocco lungo, e oltre
  /// `TAP_MOVE` scorre, col browser, senza scegliere niente. Non chiama
  /// `preventDefault`, che fermerebbe lo scorrimento.
  _touchDown(event: PointerEvent): void {
    this._cancelTouch();
    this._touchLast = true;
    const grip = this._gripAt(event.clientX, event.clientY);
    if (grip) {
      event.preventDefault();
      const range = this._selectedRange();
      const fixed = grip === "b"
        ? { row: range.rowStart, column: range.columnStart }
        : { row: range.rowEnd, column: range.columnEnd };
      this._drag = { kind: "handle", fixed, x: event.clientX, y: event.clientY };
      this._dragSeen = this._viewportAt();
      this._viewport.setPointerCapture?.(event.pointerId);
      this._viewport.focus({ preventScroll: true });
      return;
    }
    const cell = this._eventPosition(event);
    const hit = cell ?? this._hit(event.clientX, event.clientY, false);
    if (!hit) return;
    const touch: TouchPress = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, hit, timer: null, long: false };
    touch.timer = setTimeout(() => this._longPress(touch), LONG_PRESS_MS);
    this._touch = touch;
  }

  /// Il tocco lungo su una cella: la sceglie, se non è già nella selezione,
  /// e mette le due maniglie agli angoli della selezione.
  _longPress(touch: TouchPress): void {
    if (this._touch !== touch) return;
    touch.timer = null;
    touch.long = true;
    const { row, column } = touch.hit;
    if (row === null || column === null) return;
    const position = this._anchorOf({ row, column });
    const range = this._selectedRange();
    const inside = position.row >= range.rowStart && position.row <= range.rowEnd
      && position.column >= range.columnStart && position.column <= range.columnEnd;
    if (!inside) {
      this._others = [];
      this._tabStart = null;
      this._selection = { anchor: position, focus: position };
      this._syncFormulaBar();
    }
    if (this._selectedObject !== null) this._selectObject(null);
    this._grips = true;
    this._lastTap = null;
    this._viewport.focus({ preventScroll: true });
    this._render();
    if (!inside) this._selectionChanged();
  }

  /// Il dito si alza (`commit`) o il browser se lo prende per scorrere.
  _endTouch(event: PointerEvent, commit: boolean): void {
    const touch = this._touch;
    if (!touch || event.pointerId !== touch.pointerId) return;
    this._cancelTouch();
    if (commit && !touch.long) this._tap(touch.hit);
  }

  _cancelTouch(): void {
    const touch = this._touch;
    if (!touch) return;
    if (touch.timer !== null) clearTimeout(touch.timer);
    touch.timer = null;
    this._touch = null;
  }

  /// Un tocco: sceglie la cella, la colonna, la riga o il foglio, come un
  /// clic, e toglie le maniglie; un secondo tocco sulla stessa cella entro
  /// `DOUBLE_TAP_MS` la apre.
  _tap(hit: { readonly row: number | null; readonly column: number | null }): void {
    this._grips = false;
    if (this._selectedObject !== null) this._selectObject(null);
    const sheet = this._sheet();
    const lastRow = Math.max(0, sheet.rows.length - 1);
    const lastColumn = Math.max(0, sheet.columns.length - 1);
    const kind = hit.row === null && hit.column === null ? "all" : hit.row === null ? "columns" : hit.column === null ? "rows" : "cells";
    const position = this._anchorOf({ row: hit.row ?? 0, column: hit.column ?? 0 });
    if (kind === "cells") {
      const now = performance.now();
      const last = this._lastTap;
      if (last && now - last.at < DOUBLE_TAP_MS && samePosition(last.position, position)) {
        this._lastTap = null;
        this._beginEditing("cell", position, undefined, "edit");
        return;
      }
      this._lastTap = { at: now, position };
    } else {
      this._lastTap = null;
    }
    this._others = [];
    this._tabStart = null;
    this._selection = kind === "all"
      ? {
          anchor: { row: lastRow, column: lastColumn },
          focus: { row: 0, column: 0 },
          active: { row: this._edgeVisible("row", false), column: this._edgeVisible("column", false) },
        }
      : this._dragSelection(kind, position, position);
    this._viewport.focus({ preventScroll: true });
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
  }

  /// La maniglia del tocco sotto il punto (dello schermo): `"a"` all'inizio
  /// della selezione, `"b"` alla fine, o `null`. La presa è un cerchio di
  /// `GRIP_R` attorno al suo angolo, come si vede adesso, anche dove una
  /// fascia ferma copre metà maniglia; non quando l'angolo stesso è passato
  /// sotto la fascia. Le maniglie non prendono il puntatore: decide questa
  /// prova.
  _gripAt(x: number, y: number): "a" | "b" | null {
    if (!this._grips) return null;
    const geometry = this._marks.shown() ?? this._markGeometry(this._selectedRange());
    if (!geometry) return null;
    const rect = this._viewport.getBoundingClientRect();
    const px = x - rect.left - this._viewport.clientLeft;
    const py = y - rect.top - this._viewport.clientTop;
    const bands = this._bands();
    const scroll = { left: this._viewport.scrollLeft, top: this._viewport.scrollTop };
    const corners: readonly (readonly ["a" | "b", number, number, boolean])[] = [
      ["b", geometry[2], geometry[3], false],
      ["a", geometry[0], geometry[1], true],
    ];
    for (const [grip, cx, cy, start] of corners) {
      const seen = cornerSeen(cx, cy, start, bands, scroll);
      if (seen && Math.hypot(px - (seen.x - 1), py - (seen.y - 1)) <= GRIP_R) return grip;
    }
    return null;
  }

  /// La cella attiva di una selezione da `anchor` a `focus` tirata con una
  /// maniglia: resta dov'era se ci sta dentro, sennò va al primo angolo.
  _activeWithin(anchor: GridPosition, focus: GridPosition): GridPosition {
    const active = this._active();
    const rowStart = Math.min(anchor.row, focus.row);
    const rowEnd = Math.max(anchor.row, focus.row);
    const columnStart = Math.min(anchor.column, focus.column);
    const columnEnd = Math.max(anchor.column, focus.column);
    const inside = active.row >= rowStart && active.row <= rowEnd && active.column >= columnStart && active.column <= columnEnd;
    return inside ? active : { row: rowStart, column: columnStart };
  }

  _pointerMove(event: PointerEvent): void {
    const touch = this._touch;
    if (touch && event.pointerId === touch.pointerId) {
      // Oltre `TAP_MOVE` il dito scorre il foglio (lo fa il browser): non è
      // più un tocco. Dopo un tocco lungo il dito non sceglie altro.
      if (!touch.long && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TAP_MOVE) this._cancelTouch();
      return;
    }
    if (this._objectGesture) {
      this._objectPointerMove(event, this._objectGesture);
      return;
    }
    const resize = this._resize;
    if (resize) {
      if (event.buttons === 0) {
        this._endResize(false);
        return;
      }
      const point = resize.axis === "column" ? event.clientX : event.clientY;
      // Fino a zero, che nasconde, come in Excel.
      resize.now = Math.max(0, resize.size + point - resize.from);
      this._render();
      return;
    }
    const drag = this._drag;
    if (!drag) {
      const edge = this._resizeEdge(event.clientX, event.clientY);
      this._viewport.classList.toggle("resize-column", edge?.axis === "column");
      this._viewport.classList.toggle("resize-row", edge?.axis === "row");
      const fill = !edge && this._onFillHandle(event.clientX, event.clientY);
      this._viewport.classList.toggle("fill-handle", fill);
      this._viewport.classList.toggle("move-selection", !edge && !fill && this._onSelectionEdge(event.clientX, event.clientY));
      return;
    }
    if (event.buttons === 0) {
      this._endDrag(false, false);
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    this._dragTo(drag);
    this._dragScrollIfOutside(drag);
  }

  /// Porta il gesto al punto `drag.x`, `drag.y`: fuori dalla griglia vale il
  /// bordo, perché il gesto continua mentre la griglia scorre.
  _dragTo(drag: CellDrag): void {
    const hit = this._hit(drag.x, drag.y, true);
    if (!hit) return;
    this._dragSeen = this._viewportAt();
    const position = { row: hit.row ?? 0, column: hit.column ?? 0 };
    if (drag.kind === "point") {
      const pointing = this._pointing;
      if (!pointing || samePosition(pointing.focus, position)) return;
      this._writeReference({ from: pointing.from, to: pointing.to }, drag.anchor, position);
      return;
    }
    if (drag.kind === "move") {
      const sheet = this._sheet();
      const rows = drag.source.rowEnd - drag.source.rowStart;
      const columns = drag.source.columnEnd - drag.source.columnStart;
      const rowStart = Math.max(0, Math.min(Math.max(0, sheet.rows.length - 1 - rows), position.row - drag.grab.row));
      const columnStart = Math.max(0, Math.min(Math.max(0, sheet.columns.length - 1 - columns), position.column - drag.grab.column));
      const target = { rowStart, columnStart, rowEnd: rowStart + rows, columnEnd: columnStart + columns };
      if (sameRange(target, drag.target)) return;
      drag.target = target;
      this._render();
      return;
    }
    if (drag.kind === "fill") {
      const target = fillTarget(drag.source, position);
      if (sameRange(target, drag.target)) return;
      drag.target = target;
      this._render();
      return;
    }
    if (drag.kind === "handle") {
      if (samePosition(position, this._selection.focus) && samePosition(drag.fixed, this._selection.anchor)) return;
      this._selection = { anchor: drag.fixed, focus: position, active: this._activeWithin(drag.fixed, position) };
      this._syncFormulaBar();
      this._render();
      this._selectionChanged();
      return;
    }
    const next = this._dragSelection(drag.kind, drag.anchor, position);
    if (samePosition(next.focus, this._selection.focus) && samePosition(next.anchor, this._selection.anchor)) return;
    this._selection = next;
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
  }

  /// La selezione di un gesto da `anchor` a `position`: righe e colonne
  /// intere vanno da un capo all'altro del foglio, con la cella attiva (il
  /// fuoco) sulla prima colonna o sulla prima riga, come in Excel.
  _dragSelection(kind: "cells" | "rows" | "columns", anchor: GridPosition, position: GridPosition): GridSelection {
    const sheet = this._sheet();
    const lastRow = Math.max(0, sheet.rows.length - 1);
    const lastColumn = Math.max(0, sheet.columns.length - 1);
    // Righe e colonne intere: la cella attiva è la prima visibile di quella
    // da cui si è partiti.
    if (kind === "rows") {
      return {
        anchor: { row: anchor.row, column: lastColumn },
        focus: { row: position.row, column: 0 },
        active: { row: anchor.row, column: this._edgeVisible("column", false) },
      };
    }
    if (kind === "columns") {
      return {
        anchor: { row: lastRow, column: anchor.column },
        focus: { row: 0, column: position.column },
        active: { row: this._edgeVisible("row", false), column: anchor.column },
      };
    }
    return { anchor, focus: position };
  }

  /// Fuori dal bordo la griglia scorre da sé verso il puntatore, più svelta
  /// quanto più è lontano, finché il gesto finisce o il puntatore rientra.
  _dragScrollIfOutside(drag: CellDrag): void {
    const step = this._dragScrollStep(drag);
    if (!step) {
      this._stopDragScroll();
      return;
    }
    if (this._dragScroll !== null) return;
    this._dragScroll = setInterval(() => {
      const current = this._drag;
      const next = current ? this._dragScrollStep(current) : null;
      if (!current || !next) {
        this._stopDragScroll();
        return;
      }
      this._viewport.scrollBy(next.x, next.y);
      this._dragTo(current);
    }, DRAG_SCROLL_MS);
  }

  _dragScrollStep(drag: CellDrag): { x: number; y: number } | null {
    const rect = this._viewport.getBoundingClientRect();
    const frame = this._frame;
    const left = rect.left + this._viewport.clientLeft + frame.rowHeader;
    const top = rect.top + this._viewport.clientTop + frame.columnHeader;
    const right = rect.left + this._viewport.clientLeft + this._viewport.clientWidth;
    const bottom = rect.top + this._viewport.clientTop + this._viewport.clientHeight;
    const speed = (distance: number) => Math.min(DRAG_SCROLL_MAX, Math.max(4, Math.round(distance / 2)));
    // Righe intere non scorrono di lato, colonne intere non scorrono in giù.
    const x = drag.kind === "rows" ? 0 : drag.x > right ? speed(drag.x - right) : drag.x < left ? -speed(left - drag.x) : 0;
    const y = drag.kind === "columns" ? 0 : drag.y > bottom ? speed(drag.y - bottom) : drag.y < top ? -speed(top - drag.y) : 0;
    return x === 0 && y === 0 ? null : { x, y };
  }

  _stopDragScroll(): void {
    if (this._dragScroll === null) return;
    clearInterval(this._dragScroll);
    this._dragScroll = null;
  }

  /// Chiude il gesto. Il riempimento tirato fuori dalla sorgente dà
  /// `edit.autoFill`; con Ctrl tirato, il modo alternato di Excel (un numero
  /// solo conta, una serie si copia).
  ///
  /// Il rilascio in `point` conta come l'ultimo spostamento: la selezione
  /// finisce sulla cella sotto il punto dove il puntatore si è alzato.
  _endDrag(commit: boolean, alternate: boolean, point?: { readonly x: number; readonly y: number }): void {
    const drag = this._drag;
    this._stopDragScroll();
    if (!drag) return;
    // Solo se il punto è nuovo, o se sotto il punto fermo è passata un'altra
    // cella: un rilascio dove si è premuto non sposta.
    if (commit && point && (point.x !== drag.x || point.y !== drag.y || this._shiftedUnder(drag))) {
      drag.x = point.x;
      drag.y = point.y;
      this._dragTo(drag);
    }
    this._drag = null;
    this._dragSeen = null;
    if (drag.kind === "move") {
      if (commit && !sameRange(drag.source, drag.target)) this._moveRange(drag.source, drag.target, alternate);
      else this._render();
      return;
    }
    if (drag.kind !== "fill") return;
    if (commit && !sameRange(drag.source, drag.target)) this._autoFill(drag.source, drag.target, alternate);
    else this._render();
  }

  /// Se sotto il punto fermo di una selezione col puntatore sta un'altra
  /// cella da quella che il gesto ha preso: ciò che sta sopra la griglia ha
  /// cambiato misura e l'ha spostata, senza che scorresse. Il riempimento e lo
  /// spostamento non si rifanno: un rilascio dove si è premuto non li avvia.
  _shiftedUnder(drag: CellDrag): boolean {
    if (drag.kind !== "cells" && drag.kind !== "rows" && drag.kind !== "columns") return false;
    const seen = this._dragSeen;
    const now = this._viewportAt();
    if (!seen || (seen.left === now.left && seen.top === now.top)) return false;
    const hit = this._hit(drag.x, drag.y, true);
    if (!hit) return false;
    const focus = this._selection.focus;
    if (drag.kind === "rows") return (hit.row ?? 0) !== focus.row;
    if (drag.kind === "columns") return (hit.column ?? 0) !== focus.column;
    // Su un'unione conta l'unione: un clic dentro non sposta il fuoco.
    return !samePosition(this._anchorOf({ row: hit.row ?? 0, column: hit.column ?? 0 }), this._anchorOf(focus));
  }

  _viewportAt(): { readonly left: number; readonly top: number } {
    const rect = this._viewport.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  /// Il riempimento tirato fino a `target` (griglia T6): il contorno resta
  /// con le formiche in cammino finché il foglio non risponde (`_beginFill`),
  /// e la selezione resta sulla sorgente; il provider la mette sul
  /// riempimento, la cella attiva al primo angolo, e i segni ci scivolano.
  _autoFill(source: GridRange, target: GridRange, alternate: boolean): void {
    const params: Record<string, string> = { source: rangeA1(source), target: rangeA1(target) };
    if (alternate) params.mode = "alternate";
    this.command("edit.autoFill", JSON.stringify(params));
    this._render();
  }

  /// Il doppio clic sul quadratino, come in Excel: riempie in giù fin dove
  /// arriva la colonna accanto (quella a sinistra, o se è vuota quella a
  /// destra), nelle righe che la griglia ha letto.
  _fillToNeighbour(): void {
    if (!this._fillServed()) return;
    const source = this._selectedRange();
    const filled = (column: number, row: number) => column >= 0 && (this._workbookCell({ row, column })?.cell.input ?? "") !== "";
    const reach = (column: number): number => {
      let row = source.rowEnd;
      while (row + 1 < this._sheet().rows.length && filled(column, row + 1)) row += 1;
      return row;
    };
    const last = Math.max(reach(source.columnStart - 1), reach(source.columnEnd + 1));
    if (last <= source.rowEnd) return;
    this._autoFill(source, { ...source, rowEnd: last }, false);
  }

  /// Se il quadratino di riempimento si può tirare: una sessione a comandi che
  /// serve `edit.autoFill`, nessuna cella aperta, nessun oggetto scelto.
  /// Mentre un riempimento aspetta il foglio, il quadratino non c'è.
  _fillServed(): boolean {
    const waiting = this._waiting?.kind === "fill" && this._waiting.sheet === this._sheet().id;
    return this.commandable() && this._serves("edit.autoFill") && !this._editing && this._selectedObject === null && !this._others.length && !waiting;
  }

  /// La riga e la colonna sotto il punto `x`, `y` dello schermo; `null` dove
  /// c'è un'intestazione (la riga sull'intestazione delle colonne, la colonna
  /// su quella delle righe). Fuori dalla griglia, o sulle sue barre di
  /// scorrimento, niente; con `clampToGrid` vale il bordo più vicino, e le
  /// intestazioni contano come la prima riga o colonna che si vede.
  _hit(x: number, y: number, clampToGrid: boolean): { row: number | null; column: number | null } | null {
    const frame = this._frame;
    const rect = this._viewport.getBoundingClientRect();
    let px = x - rect.left - this._viewport.clientLeft;
    let py = y - rect.top - this._viewport.clientTop;
    const width = this._viewport.clientWidth;
    const height = this._viewport.clientHeight;
    if (clampToGrid) {
      px = Math.min(Math.max(px, frame.rowHeader), width - 1);
      py = Math.min(Math.max(py, frame.columnHeader), height - 1);
    } else if (px < 0 || py < 0 || px >= width || py >= height) {
      return null;
    }
    const axis = (point: number, header: number, frozen: number, scroll: number, layout: AxisLayout): number | null => {
      if (point < header) return null;
      const inside = point - header;
      const offset = inside < frozen ? inside : inside + scroll;
      if (!layout.sizes.length || offset >= layout.total) return clampToGrid ? Math.max(0, layout.sizes.length - 1) : null;
      return indexAt(layout, offset);
    };
    const column = axis(px, frame.rowHeader, frame.frozenWidth, this._viewport.scrollLeft, this._columns);
    const row = axis(py, frame.columnHeader, frame.frozenHeight, this._viewport.scrollTop, this._rows);
    // Oltre l'ultima riga o colonna del foglio non c'è niente da prendere.
    if (!clampToGrid && ((px >= frame.rowHeader && column === null) || (py >= frame.columnHeader && row === null))) return null;
    return { row, column };
  }

  /// La cella sotto il punto `x`, `y`, a partire dall'elemento premuto. Un
  /// testo che deborda (`.spill`) sta sopra le celle vuote accanto, e il
  /// browser gli dà il puntatore anche lì: per lui vale il punto, non la
  /// cella del testo, o il clic sceglierebbe la cella sbagliata (IMP-512).
  _pressedCell(element: EventTarget | null, x: number, y: number): GridPosition | null {
    const target = element instanceof Element ? element.closest<HTMLElement>(".grid-cell") : null;
    if (!target) return null;
    // Un evento senza punto (uno sintetico, da tastiera) vale per la cella.
    if (target.classList.contains("spill") && Number.isFinite(x) && Number.isFinite(y)) {
      const hit = this._hit(x, y, false);
      if (hit && hit.row !== null && hit.column !== null) return { row: hit.row, column: hit.column };
    }
    return this._positionOf(target);
  }

  _eventPosition(event: MouseEvent): GridPosition | null {
    return this._pressedCell(event.target, event.clientX, event.clientY);
  }
}

export interface GridEngine extends ObjectsMethods {}
mixMethods(GridEngine.prototype, objectsMethods);
export interface GridEngine extends SheetsMethods {}
mixMethods(GridEngine.prototype, sheetsMethods);
export interface GridEngine extends SessionMethods {}
mixMethods(GridEngine.prototype, sessionMethods);
export interface GridEngine extends WriteMethods {}
mixMethods(GridEngine.prototype, writeMethods);
export interface GridEngine extends CommandsMethods {}
mixMethods(GridEngine.prototype, commandsMethods);
export interface GridEngine extends SelectionMethods {}
mixMethods(GridEngine.prototype, selectionMethods);
export interface GridEngine extends KeysMethods {}
mixMethods(GridEngine.prototype, keysMethods);
