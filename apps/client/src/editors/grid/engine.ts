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
import { type TextOperation } from "../core/text-operation";
import { gridJournalEntry, gridJournalText, parseGridJournal, recordGridJournal } from "../../state/grid-journal";
import { adapter, type Adapter, type Paper } from "../../theme/adapt";
import type { Theme } from "../../theme/theme";
import type { PdfEngineLoader } from "../media/pdf-view";
import type { Spring } from "../../moto/spring";
import { t, onLanguage, resolvedLanguage } from "../../i18n/strings";
import { textButton, type TabsHandle } from "../../kit";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { createTextEngine, type TextEngine } from "../text/engine";
import { createFormulaProfile } from "../text/profiles/formula";
import {
  coordinateAt,
  normalizedSelection,
  type GridPosition,
  type GridSelection,
  type GridWorkbook,
} from "./model";
import { inverseGridPatches, selectionText, selectionTsv } from "./operation";
import { cellA1, rangeA1, type GridRange } from "./merges";
import { attachCommentCards } from "./comment-card";
import {
  COPY_MARK_KEY,
  copyMarkOf,
  createMarksMotion,
  SELECTION_SPEED_KEY,
  selectionSpeedOf,
  type CopyMark,
  type MarksMotion,
  type SelectionSpeed,
} from "./grid-motion";
import { type Zone } from "./marks";
import { GridMediaCache } from "./objects";
import { hasBorders } from "./paint";
import { decimalSeparator, DEFAULT_SHEET_VIEW, fileInput, objectKey, type WorkbookView } from "./workbook";
import {
  tableRange,
  type AxisLayout,
  type CellDrag,
  type ObjectGesture,
  type ObjectRect,
  type Pointing,
  type ResizeDrag,
  type SizePreview,
} from "./engine-geometry";
import { type BytesState, type GridCommandEffect, type GridEngineOptions, type GridRun } from "./engine-host";
import {
  SELECTED_TEXT_CELLS,
  DEFAULT_ROW_HEIGHT,
  ROW_HEADER_WIDTH,
  COLUMN_HEADER_HEIGHT,
  GRID_FRAME_NEW_ROWS,
  Copied,
  Waiting,
  QUERIES,
  READ_WITHOUT_PARAMS,
  UNDO,
  REDO,
  SheetFrame,
  HistoryStep,
  EditingState,
  GridEditMode,
  EditorDress,
  TouchPress,
  PaperView,
  DrawnRow,
  WrittenCell,
} from "./engine-parts";
import { mixMethods } from "../core/mix-methods";
import { objectsMethods, type ObjectsMethods } from "./engine-objects";
import { sheetsMethods, type SheetsMethods } from "./engine-sheets";
import { sessionMethods, type SessionMethods } from "./engine-session";
import { writeMethods, type WriteMethods } from "./engine-write";
import { commandsMethods, type CommandsMethods } from "./engine-commands";
import { selectionMethods, type SelectionMethods } from "./engine-selection";
import { keysMethods, type KeysMethods } from "./engine-keys";
import { paintMethods, type PaintMethods } from "./engine-paint";
import { marksMethods, type MarksMethods } from "./engine-marks";
import { editingMethods, type EditingMethods } from "./engine-editing";
import { clipboardMethods, type ClipboardMethods } from "./engine-clipboard";
import { pointerMethods, type PointerMethods } from "./engine-pointer";
export {
  GRID_WINDOW_ROWS,
  GRID_WINDOW_COLUMNS,
  MAX_GRID_SESSION_WINDOWS,
  type GridEditMode,
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
  _findCell(position: GridPosition): HTMLElement | null {
    return this._viewport.querySelector<HTMLElement>(`.grid-cell[data-row="${position.row}"][data-column="${position.column}"]`);
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
export interface GridEngine extends PaintMethods {}
mixMethods(GridEngine.prototype, paintMethods);
export interface GridEngine extends MarksMethods {}
mixMethods(GridEngine.prototype, marksMethods);
export interface GridEngine extends EditingMethods {}
mixMethods(GridEngine.prototype, editingMethods);
export interface GridEngine extends ClipboardMethods {}
mixMethods(GridEngine.prototype, clipboardMethods);
export interface GridEngine extends PointerMethods {}
mixMethods(GridEngine.prototype, pointerMethods);
