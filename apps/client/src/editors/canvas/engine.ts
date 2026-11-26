
import type { SyntaxForm } from "../../host/contract";
import { t, onLanguage } from "../../i18n/strings";
import { idleSchedule } from "../../ink/dom/idle";
import { PenQuiet, type Schedule } from "../../ink/quiet";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { focusZone } from "../../ui/a11y";
import {
  type CardEditorContext,
  type CardCellBox,
  type CardMode,
  type CardPageBox,
  type CardQuiet,
  type CardView,
} from "../core/cards/contract";
import { type BoardReading } from "./a11y";
import { type InkEraserMode } from "./ink-erase";
import { buildCanvasCommands, type CanvasCommand, type CanvasTip, type CanvasToolId } from "./chrome/commands";
import { CANVAS_INK_TOOLS, createCanvasRail, type CanvasRail } from "./chrome/rail";
import type { Radial } from "../spatial/tools/radial";
import { createCanvasEmpty, type CanvasEmpty } from "./chrome/empty";
import { createCanvasNavigator, type CanvasNavigator } from "./chrome/navigator";
import { CanvasJumps } from "./jumps";
import { boardFindIndex, type FindMark } from "./find";
import { createCanvasFindBar, type CanvasFindBar } from "./chrome/find-bar";
import { createCanvasOptions, type CanvasOptions } from "./chrome/options";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "./text-style";
import { createCanvasWorkspace, type CanvasWorkspaceControl } from "./chrome/workspace";
import { createCanvasSelectionBar, type CanvasSelectionBar } from "./chrome/selection-bar";
import { type LassoPoint } from "./lasso";
import { createOptionsBar, type OptionItem, type OptionsBar } from "../../kit/options-bar";
import { rovingToolbar, type RovingToolbar } from "../../kit/toolbar-keys";
import { canvasStatusItems, readAttachmentFolder } from "./chrome/status";
import type { SurfaceStatusItem } from "../core/registry";
import { CitationCounts, headZonePaths } from "./card-head";
import { type DropFolderChoice } from "../../state/canvas-intake";
import { type CommandSearchHandle } from "./chrome/command-search";
import { type InkLayer } from "./ink-layer";
import { createCanvasRuler, type CanvasRuler } from "./ink-ruler";
import { StrokeGuide } from "./ink-shapes";
import { InkPathCache, type DryStroke } from "./ink-paint";
import { createPenMenu, type PenMenu } from "./pen-menu";
import { type PopoverHandle } from "../../kit";
import { type PartsPickerHandle } from "./parts-picker";
import { type CardFormulaBar } from "../core/formula-bar";
import { type ReaderHandle } from "./reader";
import { DEFAULT_PREFERENCES, currentPreferences, snapStepOf, watchPreferences, type DragEmptyAction, type PenButtonAction, type WheelAction } from "./preferences";
import { type TouchCamera, type TouchPoint } from "./touch";
import { type MotionState } from "../../spatial/camera";
import { reducedMotion } from "../../theme/reduced-motion";
import { DEFAULT_INK_CHOICE, inkStrokeTool, type InkPenChoice, type InkLayerRef } from "./ink-record";
import { upsertNodePatch } from "./operation";
import { type CanvasDocument, type CanvasNode } from "./model";
import { CanvasViewRecorder, type CanvasView } from "./view-state";
import { CanvasCoreError, type CanvasCore } from "./wasm/core";
import { CanvasCorePort, SHARED_CORE, SHARED_INK_MOUSE, SHARED_PEN, CanvasEngineOptions } from "./engine-options";
import {
  CardEditor,
  LastPaste,
  CanvasStep,
  InkChain,
  CardDrag,
  DropGhost,
  InkErase,
  StrokeDrag,
  LassoLayer,
  MarqueeLayer,
  MarqueeGesture,
  InkTarget,
  InkMarks,
  InkPoint,
  InkStates,
  PendingText,
  CropSession,
  CardEntry,
  Viewport,
  PanSample,
  ConnectGesture,
  clampZoom,
  FIT_MARGIN,
} from "./engine-parts";
import { ResizeCorner, ResizeBox } from "./engine-geometry";
import { withPending, lostCore, nodeText } from "./engine-names";
import { mixMethods } from "../core/mix-methods";
import { cropMethods, type CropMethods } from "./engine-crop";
import { documentMethods, type DocumentMethods } from "./engine-document";
import { textMethods, type TextMethods } from "./engine-text";
import { inkMethods, type InkMethods } from "./engine-ink";
import { lassoMethods, type LassoMethods } from "./engine-lasso";
import { toolsMethods, type ToolsMethods } from "./engine-tools";
import { cameraMethods, type CameraMethods } from "./engine-camera";
import { keysMethods, type KeysMethods } from "./engine-keys";
import { intakeMethods, type IntakeMethods } from "./engine-intake";
import { convertMethods, type ConvertMethods } from "./engine-convert";
import { clipboardMethods, type ClipboardMethods } from "./engine-clipboard";
import { commandsMethods, type CommandsMethods } from "./engine-commands";
import { cardToolsMethods, type CardToolsMethods } from "./engine-card-tools";
import { menuMethods, type MenuMethods } from "./engine-menu";
import { edgesMethods, type EdgesMethods } from "./engine-edges";
import { pointerMethods, type PointerMethods } from "./engine-pointer";
import { dragMethods, type DragMethods } from "./engine-drag";
import { cardsMethods, type CardsMethods } from "./engine-cards";
import { cardOpenMethods, type CardOpenMethods } from "./engine-card-open";
import { listenMethods, type ListenMethods } from "./engine-listen";
import { documentApi, type DocumentApi } from "./engine-api-document";
import { menuApi, type MenuApi } from "./engine-api-menu";
export {
  CANVAS_SNAP,
  CANVAS_GRID_DOT_STEPS,
  CANVAS_GRID_MIN_PX,
  CANVAS_MIN_SIZE,
  MAX_CANVAS_HISTORY,
  CARD_PAUSE_MS,
  SPREAD_CONFIRM_ABOVE,
  WHEEL_SETTLE_MS,
  MEASURE_IMAGE_TIMEOUT_MS,
  type CanvasChange,
  type CanvasMediaPort,
  type CanvasAttachmentPort,
  type CanvasRepoint,
  type CanvasDepositCards,
  type CanvasCorePort,
  type CanvasInkMouseMemory,
  type CanvasPenMemory,
  type CardLinkRef,
  type CanvasEngineOptions,
  type CanvasNotesPort,
  type CanvasCards,
} from "./engine-options";
export {
  LONG_PRESS_MS,
  FINGERS_TAP_MS,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  CANVAS_ZOOM_STEP,
  EDGE_SCROLL_ZONE,
  EDGE_SCROLL_MAX,
} from "./engine-parts";
export {
  edgeScrollSpeed,
  looseCards,
  type ResizeCorner,
  RESIZE_ONE_HANDLE_PX,
  RESIZE_FINGER_GRIP_PX,
  CANVAS_TEXT_FIT_MAX_WIDTH,
  NEXT_CARD_GAP,
  NEXT_CARD_TRIES,
  type ResizeBox,
  type ResizeOptions,
  resizeBox,
  boxAround,
  scaleInto,
  eraseAlongSegments,
  erasePathPieces,
} from "./engine-geometry";
export { proposedNoteName } from "./engine-names";

/**
 * I membri `_nome` sono interni al motore: li usano soltanto i file
 * `engine*.ts` di questa cartella, e una guardia lo controlla
 * (`editors/core/mix-methods.test.ts`). Erano privati del linguaggio (`#nome`)
 * finché la classe stava in un file solo.
 */
export class CanvasEngine {
  readonly _root: HTMLElement;
  readonly _toolbar: HTMLElement;
  /** La barra dei comandi sulla barra delle opzioni del kit: ciò che non ci sta va in «…» (#411). */
  readonly _toolbarBar: OptionsBar;
  readonly _toolbarKeys: RovingToolbar;
  readonly _viewport: HTMLElement;
  readonly _stage: HTMLElement;
  /** I fili, primo figlio dello stage (T91, rotta 4): un gruppo gli sta sotto, le schede sopra. */
  readonly _edgeLayer: SVGSVGElement;
  /** Le prese dei fili scelti, sopra lo stage (T91, rotta 5): il puntatore le prende prima dei punti. */
  readonly _handleLayer: SVGSVGElement;
  readonly _options: CanvasEngineOptions;
  _forms: readonly SyntaxForm[] | undefined;
  readonly _stopLanguage: () => void;
  readonly _abort = new AbortController();
  _doc: CanvasDocument | null = null;
  _source = "";
  _epoch = 0;
  _selection: string[] = [];
  _edgeSelection: string[] = [];
  _camera: Viewport = { x: 0, y: 0, zoom: 1 };
  /** La sola lettura del pannello (`setReadOnly`): i suoi motivi sono del pannello. */
  _panelReadOnly = false;
  /**
   * La sola lettura della tela: il nucleo apre il testo ma non lo sa
   * riscrivere senza perdere qualcosa (una chiave doppia, R3). Si somma a
   * quella del pannello e se ne va da sola quando il testo torna riscrivibile.
   */
  _unwritable = false;
  _undo: CanvasStep[] = [];
  _redo: CanvasStep[] = [];
  /**
   * I passi dei gesti d'inchiostro fatti col fuoco dentro una scheda che
   * scrive (un campo, l'editor di una nota), dall'ultimo tasto premuto: i
   * tasti sono del campo, ma Ctrl+Z subito dopo un tratto annulla il tratto,
   * e Ctrl+Maiusc+Z (Ctrl+Y) lo rifà (`_inkUndoKey`). Un altro tasto li
   * lascia: da lì Ctrl+Z torna al campo.
   */
  _inkOverField: CanvasStep[] = [];
  _inkOverFieldRedo: CanvasStep[] = [];
  /**
   * La versione del testo di adesso. Un testo nuovo (un gesto, un annulla
   * passato dalle toppe, `setDoc`, una `syncDoc` che cambia il testo) ne
   * prende una mai usata da `_versions`; l'annulla e il ripeti che rimettono
   * un tratto byte per byte ridanno al testo la versione che aveva. Una
   * versione dice sempre un testo solo.
   */
  _version = 0;
  _versions = 0;
  /** Le schede sulla scena, per id: sopravvivono a una resa che non le riguarda. */
  readonly _cards = new Map<string, CardEntry>();
  /**
   * Le viste montate, per id, come le legge `updateLiveCards`: la mappa è
   * viva, perché il lavoro rimandato la legge quando gira. Ogni voce avvolge
   * la vista del renderer e, se `setMode` riesce, scrive il modo sulla scheda.
   */
  readonly _views = new Map<string, CardView>();
  /** Il modo che ogni vista montata ha davvero (il `current` di `updateLiveCards`). */
  readonly _liveModes = new Map<string, CardMode>();
  /**
   * Le schede la cui vista è stata viva in questa seduta (T54): da lontano
   * mostrano l'ultima immagine ferma (`still`) e non il titolo grande. Esce
   * chi perde la vista (tolta, un file cambiato).
   */
  readonly _seenLive = new Set<string>();
  /**
   * La scheda attiva (T14): `enter()` ha detto sì, e il suo contenuto prende
   * puntatore, tastiera e rotella finché non si esce. Una sola alla volta.
   */
  _activeId: string | null = null;
  /**
   * La scheda attiva che scrive nel suo file (T41): `edit()` ha detto sì.
   * `data-card-editing` arriva quando la vista dice che l'editor c'è.
   */
  _writingId: string | null = null;
  /**
   * Il contesto di ciò che si scrive nella scheda `_writingId` (T42: la cella
   * attiva di un foglio e la sua formula), e l'elemento della riga delle
   * opzioni che lo mostra, aggiornato sul posto a ogni cambio.
   */
  _writingContext: CardEditorContext | null = null;
  _formulaItem: CardFormulaBar | null = null;
  /** La scheda in cui si sta entrando: la scelta delle vive la accende con le altre. */
  _enteringId: string | null = null;
  /**
   * La scheda sotto l'ultimo `pointerdown`, se era già la sola scelta: il
   * `click` che segue ci entra. Un clic che la sceglie soltanto non entra.
   */
  _pressedSelected: string | null = null;
  /**
   * I tasti con Ctrl (Cmd) che il campo di una scheda non ha usato e che
   * salgono alla shell (Ctrl+W chiude la linguetta come fuori dalla scrittura):
   * la tela li lascia passare senza farne un suo comando.
   */
  readonly _shellKeys = new WeakSet<Event>();
  /** Il gesto della rotella finisce `WHEEL_SETTLE_MS` dopo l'ultimo scatto. */
  _wheelTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /**
   * Il silenzio della penna come lo vuole `updateLiveCards`. Il lavoro che
   * gira quando la penna si alza non cambia modi a gesto in corso (lo rifà la
   * fine del gesto) e non lascia uscire l'errore di una vista: va in console.
   */
  readonly _cardQuiet: CardQuiet = {
    defer: (key, work) => this._quiet.defer(key, () => {
      if (this._destroyed || this._gestureActive()) return;
      try {
        work();
      } catch (error) {
        console.warn("canvas: una scheda non cambia modo", error);
      }
    }),
  };
  /**
   * Crescono quando cambia ciò che i corpi di sempre leggono oltre alla
   * scheda: la lingua (tutti) e le sintassi del Markdown (le schede di
   * testo). Quei corpi si rifanno alla resa dopo; le viste dei renderer no.
   */
  _languageRound = 0;
  _formsRound = 0;
  _destroyed = false;
  _intakeError = "";
  /** L'ultimo punto (dello schermo) in cui il puntatore è stato visto sulla vista; `null` se ne è uscito. */
  _pointerSeen: { x: number; y: number } | null = null;
  /** I rettangoli tratteggiati di un trascinamento in corso sopra la vista. */
  _dropGhosts: HTMLElement | null = null;
  /** I riquadri del trascinamento di file in corso, calcolati all'entrata (T24). */
  _dropGhost: DropGhost | null = null;
  /**
   * Per quanti file sono stati calcolati i riquadri: con `_dropGhost` a `null`
   * vuol dire «nessun riquadro» (troppi file, il nucleo li rifiuta), e non si
   * ricompila a ogni movimento finché il numero resta quello.
   */
  _dropGhostCount: number | null = null;
  /** La griglia (T71): i punti sotto le schede, nella vista; `null` prima del montaggio. */
  _grid: HTMLElement | null = null;
  /** Le guide del gesto in corso (T71): un solo elemento sopra le schede; `null` a gesto fermo. */
  _guideLayer: HTMLElement | null = null;
  /** `canvas.grid` e `canvas.snap` (impostazioni del vault), dal vivo. */
  _gridSetting = DEFAULT_PREFERENCES.grid;
  _snapSetting = DEFAULT_PREFERENCES.snap;
  /** `canvas.snap_step` (#411 C-05): il passo della griglia dell'aggancio; `null` senza griglia. */
  _snapStep: number | null = snapStepOf(DEFAULT_PREFERENCES.snapStep);
  /** Ctrl+' per questa lavagna (T71): `null` segue `canvas.grid`; si ricorda con la vista. */
  _gridOverride: boolean | null = null;
  /** Il trascinamento delle schede in corso (`CardDrag`). */
  _drag: CardDrag | null = null;
  /**
   * Il ridimensionamento in corso (T66): la maniglia `corner`, la cornice di
   * partenza `box` (la scheda, o la cornice della scelta) e le schede che
   * cambiano, ognuna col suo rettangolo di partenza.
   */
  _resize: {
    pointerId: number;
    corner: ResizeCorner;
    startX: number;
    startY: number;
    box: ResizeBox;
    origin: Map<string, ResizeBox>;
    /** Il puntatore si è mosso di più di 3 px: non è un clic sulla maniglia. */
    moved: boolean;
  } | null = null;
  /**
   * Le schede dell'ultima maniglia presa e lasciata senza muoversi: il doppio
   * clic che segue le adatta al contenuto. Serve perché, con la cattura del
   * puntatore, il `dblclick` arriva alla vista e non alla maniglia.
   */
  _handleTap: readonly string[] | null = null;
  /** La cornice della scelta con le sue maniglie, con due schede scelte o più (T66). */
  _selectionFrame: HTMLElement | null = null;
  /** Lo zoom con cui si sono contate le schede troppo piccole per quattro maniglie. */
  _handlesZoom = 0;
  /**
   * Lo spostamento della lavagna in corso. `toggle` è la scheda sotto un
   * Ctrl+clic (Cmd+clic): se il puntatore si alza senza essersi mosso, la
   * scheda entra nella scelta o ne esce, come con Maiuscolo.
   */
  _pan: {
    pointerId: number;
    startX: number;
    startY: number;
    camX: number;
    camY: number;
    toggle?: string;
    /** Gli ultimi punti del puntatore, col loro tempo: la velocità dell'inerzia del dito (T53). */
    trail?: PanSample[];
  } | null = null;
  /** Il filo che si sta tirando (T67). */
  _connect: ConnectGesture | null = null;
  /** Il tratto del filo in corso, nello strato dei fili; e la scheda sotto il puntatore. */
  _connectDraft: SVGPathElement | null = null;
  _connectTarget: string | null = null;
  /** Il filo sotto il puntatore, che si scurisce (T67). */
  _edgeHover: string | null = null;
  /**
   * «Collega…» dal menu o C con una scheda scelta (T17): la scheda da cui
   * parte il filo; il prossimo clic su un'altra scheda lo chiude e la
   * colonna torna alla Selezione. Esc o un altro strumento rinunciano.
   */
  _connectFrom: string | null = null;
  /**
   * L'avviso di «Togli dalla lavagna» (T17), col suo «Annulla»: il testo e il
   * passo d'annulla del togliere. Vale finché quel passo è l'ultimo: la
   * modifica dopo lo spegne, così «Annulla» annulla sempre il togliere.
   */
  _removal: {
    readonly text: string;
    readonly step: CanvasStep | undefined;
    readonly undo: boolean;
    /** I tratti appena passati a una scheda col Lazo (T86): «Rendilo libero» li riporta sulla radice. */
    readonly free?: { readonly layer: InkLayerRef; readonly ids: readonly string[] };
  } | null = null;
  /**
   * I PDF che non si sono aperti con «Spargi le pagine» (T72), per percorso, con
   * ciò che smette di guardarne il file: il comando resta spento finché il file
   * cambia, sparisce o torna (`watch`), o la lavagna si chiude.
   */
  readonly _pdfBroken = new Map<string, () => void>();
  /** Le dita giù che la lavagna segue, in coordinate del client. */
  readonly _fingers = new Map<number, TouchPoint>();
  /** Il dito che può ancora essere un tocco breve: dove e quando si è posato, e su che cosa. */
  _tap: { pointerId: number; startX: number; startY: number; at: number; target: Element | null; shift: boolean } | null = null;
  /** Il pizzico in corso: le due dita e la camera di quando il secondo si è posato. */
  _pinch: { a: number; b: number; a0: TouchPoint; b0: TouchPoint; start: TouchCamera } | null = null;
  /** «Il dito sposta le schede» dalle Impostazioni, quando non lo passano le opzioni. */
  _fingerMovesCardSetting = false;
  /** «Il dito scrive» (`canvas.finger_writes`, T64): dalle Impostazioni, o dall'interruttore della colonna. */
  _fingerWritesSetting = currentPreferences().fingerWrites;
  /**
   * Ogni dito giù sulla vista, visto prima dello strato della penna: dove e
   * quando si è posato, dov'è adesso, e se lo strato l'ha preso per scrivere
   * (`swallowed`: il suo `pointerdown` non è arrivato alla lavagna).
   */
  readonly _touches = new Map<number, { readonly startX: number; readonly startY: number; readonly at: number; x: number; y: number; swallowed: boolean }>();
  /** Le dita che scrivevano, prese dal dito appena posato (`_touchDown`): `_gestureDown` le conta nel tocco. */
  _adopted: number[] = [];
  /**
   * I puntatori premuti sulla vista, per id: l'ultimo evento che la vista ha
   * visto di ciascuno, e se il tasto era giù all'appoggio (`held`). Un gesto
   * che perde il rilascio si chiude da qui, dove il puntatore era (T20a).
   */
  readonly _pressed = new Map<number, { last: PointerEvent; held: boolean }>();
  // --- il menu radiale e i gesti (T63) ---
  /** «Il tasto della penna» dalle Impostazioni (`canvas.pen_button`): vale dall'appoggio dopo. */
  _penButtonSetting: PenButtonAction = DEFAULT_PREFERENCES.penButton;
  /** Il menu radiale aperto da questa lavagna, se c'è. */
  _radial: Radial | null = null;
  /** Gli strumenti e i colori della penna usati in questa seduta, il più recente in testa. */
  _recentTools: CanvasToolId[] = [];
  _recentColors: string[] = [];
  /** Il dito che può diventare un tocco lungo: dove si è posato, su che cosa, e il suo timer. */
  _longPress: { readonly pointerId: number; readonly x: number; readonly y: number; readonly target: Element | null; readonly timer: ReturnType<typeof setTimeout> } | null = null;
  /**
   * Le dita di un tocco (T63): dove si è posata ciascuna, quante al massimo,
   * da quando, su che cosa si è posata la prima, e se è ancora un tocco. Un
   * dito che scorre, il tocco lungo, la penna o il palmo non lo sono più.
   */
  _fingerTap: { readonly down: Map<number, TouchPoint>; readonly first: TouchPoint; most: number; readonly start: number; spoiled: boolean; readonly target: Element | null } | null = null;
  /** L'ultimo tocco breve di un dito nel vuoto: dove e quando si è alzato, per il doppio tocco. */
  _lastTap: { readonly x: number; readonly y: number; readonly at: number } | null = null;
  /** L'ultimo appoggio sulla vista era di un dito: il `dblclick` che ne nasce non è del mouse. */
  _downByTouch = false;
  /**
   * Il puntatore che ha preso un gesto della lavagna, finché è giù: la penna
   * col tasto laterale che non cancella, il dito del tocco lungo.
   */
  _menuHeld: number | null = null;
  /** Fino a quando (`performance.now()`) il menu del sistema dietro a un gesto si ferma. */
  _menuEchoUntil = -Infinity;
  /** Il `contextmenu` che la lavagna manda da sé per il tocco lungo su una scheda. */
  _ownMenu: Event | null = null;
  /** La regione viva dei gesti, e il suo spazio alterno per ridire la stessa frase. */
  _gestureSaid: HTMLElement | null = null;
  _gestureEcho = false;
  // --- tastiera e lettore di schermo (T61) ---
  /** La lettura della lavagna (ordine, gruppi, fili) del documento `doc`: si rifà solo se il documento cambia. */
  _reading: { readonly doc: CanvasDocument; readonly value: BoardReading } | null = null;
  /** I nomi delle schede sono scritti per questo documento e questa lingua; `stale` dopo una scheda nuova. */
  _labelled: { doc: CanvasDocument | null; round: number; stale: boolean } = { doc: null, round: -1, stale: true };
  /** La scrittura dei nomi rimandata a quando il thread è libero, se ce n'è una in attesa. */
  _labelsPending: (() => void) | null = null;
  /** Il giro dei nomi a metà: le schede da nominare e fin dove è arrivato. */
  _labelRun: { readonly doc: CanvasDocument; readonly round: number; readonly queue: readonly CardEntry[]; at: number } | null = null;
  readonly _labelsSchedule: Schedule;
  /** «La rotella del mouse» dalle Impostazioni: `pan` di serie, come prima di T35. */
  _wheelSetting: WheelAction = DEFAULT_PREFERENCES.wheel;
  /** «Trascinare nel vuoto» dalle Impostazioni (N6 T20b): `select` di serie, il rettangolo. */
  _dragEmptySetting: DragEmptyAction = DEFAULT_PREFERENCES.dragEmpty;
  // --- il selettore delle sezioni (T74) ---
  /** «Selettore delle parti» dalle Impostazioni (`canvas.parts_picker`): si apre da sé al rilascio. */
  _partsPickerSetting = DEFAULT_PREFERENCES.partsPicker;
  /** Il selettore aperto e la scheda a cui è attaccato. */
  _partsPicker: { readonly handle: PartsPickerHandle; readonly node: string; readonly path: string } | null = null;
  /** Cresce a ogni richiesta del sommario: una risposta vecchia non apre niente. */
  _partsRound = 0;
  /** Quante sezioni ha una nota, dall'ultimo sommario letto: spegne «Parti…» se meno di due. */
  readonly _partsCounts = new Map<string, number>();
  // --- il ritaglio di un'immagine (T78) ---
  /**
   * Il ritaglio aperto: la scheda, il suo file, la zona di quando si è aperto
   * e l'altezza che la scheda mostra intanto (l'immagine intera, ruotata),
   * `null` finché l'immagine non ha misure. Niente si scrive finché non si
   * chiude con «Fatto» o «Togli il ritaglio».
   */
  _crop: CropSession | null = null;
  // --- muoversi (T53) ---
  /** Spazio tenuto sulla lavagna: il tasto principale sposta la vista, con qualsiasi strumento. */
  _spaceHeld = false;
  /**
   * Il tocco di Spazio in corso (T76): quando è sceso il primo tasto
   * (`timeStamp` dell'evento), dov'era il puntatore, e se si è già mosso o
   * ha premuto. Lasciato entro `READER_TAP_MS`, intatto, apre il lettore.
   */
  _spaceTap: { readonly at: number; from: { x: number; y: number } | null; spoiled: boolean } | null = null;
  // --- il lettore (T76) ---
  /** Il lettore aperto, la scheda che legge e il suo file. */
  _reader: { readonly handle: ReaderHandle; readonly node: string; readonly path: string } | null = null;
  /**
   * Il volo di un salto o l'inerzia del dito: lo stato che `stepCamera`
   * insegue, e il tempo dell'ultimo fotogramma. `null` a vista ferma.
   */
  _motion: { state: MotionState; last: number | null } | null = null;
  _motionFrame: number | undefined = undefined;
  /**
   * Lo scorrimento al bordo mentre si tira una scheda, una maniglia o un filo:
   * l'ultimo punto del puntatore, i tasti tenuti e il tempo dell'ultimo
   * fotogramma. `null` fuori dalla fascia del bordo.
   */
  _edgeScroll: { pointerId: number; clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; last: number | null } | null = null;
  _edgeFrame: number | undefined = undefined;
  /** Il movimento ridotto, di sistema o dalle Impostazioni, letto dal vivo. */
  _reducedMotion = reducedMotion();
  readonly _port: CanvasCorePort;
  /** La lavagna aperta nel nucleo; `null` prima di aprirla o dopo una trappola. */
  _core: CanvasCore | null = null;
  /** Il giro di riapertura dopo una trappola: uno più nuovo rende vecchi gli altri. */
  _revival = 0;
  /** Le trappole di fila senza un commit riuscito in mezzo. */
  _traps = 0;
  _editor: CardEditor | null = null;
  /**
   * Le schede ridimensionate a mano da quando la lavagna è aperta: scrivendoci
   * non crescono più in larghezza, perché la misura l'ha scelta chi usa (T44).
   * Il `.canvas` non lo dice: riaprendo la lavagna si ricomincia.
   */
  readonly _sizedByHand = new Set<string>();
  /** La ricerca dei comandi aperta (Ctrl+/, T48): finché c'è, il campo di una scheda non si chiude perdendo il fuoco. */
  _commandSearch: CommandSearchHandle | null = null;
  /** Vero dall'apertura della ricerca alla sua chiusura, anche mentre si apre e prende il fuoco. */
  _searching = false;
  /** L'unico posto del testo di una scheda non ancora registrato. */
  _pending: PendingText | null = null;
  _pauseTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /** La scheda che lampeggia dopo un link (T57): un solo lampo alla volta. */
  _flashing: HTMLElement | null = null;
  /** Il timer che spegne il lampo (T57): lo cancella `_endFlash`, e `destroy` lo chiude. */
  _flashTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /** Chi possiede l'inchiostro: lo scheduler del silenzio della penna e lo strato. Si chiude in `destroy`. */
  readonly _life: Lifetime = openLifetime();
  /** Il selettore di «Altro…» aperto (T47); si chiude con la vita della lavagna. */
  _colorPicker: PopoverHandle | null = null;
  /** Il lavoro pesante (il ridisegno dopo una modifica da fuori) aspetta che la penna si alzi. */
  readonly _quiet: PenQuiet;
  /** Lo strato della penna; `null` in sola lettura, con la scena troppo grande o senza lavagna (A8). */
  _inkLayer: InkLayer | null = null;
  _inkLife: Lifetime | null = null;
  readonly _inkPaths = new InkPathCache();
  _inkStates: InkStates | null = null;
  /** L'asciutto disegnato adesso: per scheda e sulla radice. */
  _inkCards = new Map<string, readonly DryStroke[]>();
  _inkBoard: readonly DryStroke[] = [];
  _inkChain: InkChain | null = null;
  /** La passata di gomma in corso; `null` se nessuna. */
  _erase: InkErase | null = null;
  /** D tenuto giù sul viewport: il mouse scrive finché non si alza. */
  _inkKeyDown = false;
  /**
   * Il velo della croce (T20d): sopra le schede, porta lui il cursore del
   * mouse che scrive. Mostrarlo cambia un elemento solo; `cursor` messo sul
   * viewport si ereditava e ricalcolava lo stile di tutta la lavagna.
   */
  readonly _penVeil: HTMLElement;
  /** Sopra la vista c'è un mouse, o una penna sospesa: il velo serve solo a loro. */
  _veilPointer = false;
  /** Ciò che c'è sotto il velo per un evento che l'ha preso, cercato una volta. */
  readonly _underVeil = new WeakMap<Event, EventTarget>();
  /**
   * La scheda che ha il `:hover` vero, letta a ogni `pointerover` che non è del
   * velo né della cattura di un tratto (T20f): è quella a cui il velo che
   * compare o la cattura del tratto tolgono il passaggio.
   */
  _hoverCard: HTMLElement | null = null;
  /**
   * La scheda che tiene l'aspetto del passaggio (`data-hover-held`) mentre il
   * velo o la cattura del tratto le tolgono `:hover`: perderlo all'inizio del
   * tratto ridipingeva tutta la scheda, anche un foglio vivo (T20f).
   */
  _heldCard: HTMLElement | null = null;
  // --- a chi appartiene il tratto (T69) ---
  /** Un tratto della punta è appena cominciato: lo spessore e la vista, finché il primo movimento non apre l'etichetta. */
  _inkStarting: { readonly size: number; readonly view: DOMRect } | null = null;
  /** Il tratto in corso e l'ancora mostrata; `null` a penna su. */
  _inkTarget: InkTarget | null = null;
  /** L'ultimo punto della penna che la vista ha visto: da qui parte il riquadro. */
  readonly _inkAt: InkPoint = { pointerId: -1, clientX: 0, clientY: 0 };
  /** Alt tenuto: il tratto resta libero sulla lavagna. */
  _altHeld = false;
  // --- le forme dal tratto, Maiusc e il righello (T87) ---
  /** Le guide dei tratti della punta aperti, per id del tratto. */
  readonly _inkGuides = new Map<number, StrokeGuide>();
  /** Il mezzo secondo della penna ferma: uno solo, perché il tratto della punta è uno. */
  _shapeTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /** Maiusc tenuto: il tratto in corso resta dritto, la forma regolare. */
  _shiftHeld = false;
  /** Il righello sulla lavagna; nasce col corpo della lavagna. */
  _inkRuler: CanvasRuler | null = null;
  /** Per il lettore di schermo: l'ancora dell'ultimo tratto, detta all'alzata. */
  _inkSaid: HTMLElement | null = null;
  /** L'etichetta e il bordo, tenuti fra un tratto e l'altro. */
  _inkMarks: InkMarks | null = null;
  /** I tratti scelti col Lazo (T86), per chiave (`inkKey`). */
  _strokeSelection: ReadonlySet<string> = new Set();
  /** Il giro del Lazo in corso (T86), in coordinate della lavagna, e la scheda sotto l'appoggio. */
  _lasso: { readonly pointerId: number; readonly points: LassoPoint[]; readonly additive: boolean; readonly pressed: string | null } | null = null;
  /** Lo spostamento di ciò che il Lazo ha scelto (T86). */
  _strokeDrag: StrokeDrag | null = null;
  /** Lo strato del lazo sullo stage, creato la prima volta che serve. */
  _lassoLayer: LassoLayer | null = null;
  /** Il trascinamento nel vuoto con la Selezione, il rettangolo che sceglie (N6 T20b). */
  _marquee: MarqueeGesture | null = null;
  /** Lo strato del rettangolo sullo stage, creato la prima volta che serve. */
  _marqueeLayer: MarqueeLayer | null = null;
  /** Il fotogramma che aggiorna la scelta del rettangolo, in attesa. */
  _marqueeFrame: number | undefined = undefined;
  // --- copia e incolla (T68) ---
  /** «Copia» o «Taglia» del menu mentre manda la copia del browser: l'evento è nostro anche col fuoco nel menu. */
  _clipboardCommand: "copy" | "cut" | null = null;
  /** L'ultimo incolla delle schede di Fub: lo stesso testo nello stesso punto si sfalsa di nuovo. */
  _lastPaste: LastPaste | null = null;
  /** L'ultimo Ctrl+D: le schede di partenza e le copie, nello stesso ordine; il prossimo ne ripete lo spostamento. */
  _lastDuplicate: { readonly sources: readonly string[]; readonly copies: readonly string[] } | null = null;
  /**
   * Lo strumento della colonna (T49): che cosa fa il mouse sulla lavagna. Con
   * Penna, Evidenziatore o Gomma il mouse scrive con la penna del menu, ed è
   * lo stesso stato dell'interruttore «Scrivi col mouse» (`setInkMouse`).
   */
  _tool: CanvasToolId = "select";
  /** La colonna degli strumenti, a sinistra della lavagna o sotto (stretta). */
  readonly _rail: CanvasRail;
  /** Lo spazio di lavoro (T65) e l'interfaccia nascosta con Ctrl+.. */
  readonly _workspace: CanvasWorkspaceControl;
  /**
   * Il navigatore mostrato nello spazio Semplice, dove è chiuso di serie: vale
   * finché la lavagna resta aperta in quello spazio, e non si ricorda nella
   * vista, che tiene la scelta dello spazio Completo.
   */
  _simpleNavigator = false;
  /** La lavagna vuota (T62): al centro, quando non c'è niente. */
  readonly _empty: CanvasEmpty;
  /** Quante volte l'interruttore è cambiato: lo stato ricordato arriva solo se nessuno l'ha toccato prima. */
  _inkMouseTurns = 0;
  /** Il pulsante «Scrivi col mouse»: lo stesso elemento in ogni barra. */
  readonly _inkMouseButton: HTMLButtonElement;
  /**
   * La penna scelta nel menu (A19): strumento, penna, colore, spessore e che
   * cosa cancella la gomma (`setInkEraser`, di serie il tratto intero, A20).
   */
  _penChoice: InkPenChoice = DEFAULT_INK_CHOICE;
  /** Quante volte la penna è cambiata: quella ricordata arriva solo se nessuno l'ha scelta prima. */
  _penTurns = 0;
  /** Il menu della penna, nella riga delle opzioni: il suo pulsante è sempre lo stesso. */
  readonly _penMenu: PenMenu;
  /**
   * La riga delle opzioni sopra la lavagna (T50): le opzioni dello strumento
   * e delle schede scelte, o la barra di una scheda in scrittura.
   */
  readonly _canvasOptions: CanvasOptions;
  /** La barra della selezione (T51), sopra le schede scelte, a fine gesto. */
  readonly _selectionBar: CanvasSelectionBar;
  /** La zona della vista con le barre che non scalano (la selezione, il ritaglio). */
  readonly _area: HTMLElement;
  /** Le punte dei fili che lo strumento Collega tira (T50); di serie alla fine. */
  _tips: CanvasTip = "end";
  /**
   * La misura e l'allineamento delle prossime schede dello strumento Testo
   * (T92): l'ultimo scelto nella riga, di serie medio e a sinistra.
   */
  _textNext: TextStyle = DEFAULT_TEXT_STYLE;
  /** La vista ricordata su questo computer (T36); `null` senza memoria o senza lavagna. */
  readonly _viewMemo: CanvasViewRecorder | null;
  /** Cresce a ogni `setDoc`: la vista letta per un'apertura di prima non vale più. */
  _viewRound = 0;
  /**
   * La camera e la scelta subito dopo l'apertura, finché la vista ricordata
   * non arriva: la prende solo ciò che nessuno ha cambiato nel frattempo.
   * `null` prima che la lavagna si mostri, e dopo che la vista è arrivata.
   */
  _openView: { readonly camera: Viewport; readonly selection: string; readonly navigatorHidden: boolean; readonly grid: boolean | null } | null = null;
  /** La vista letta prima che il nucleo aprisse il testo: la prende `_revive`. */
  _heldView: { readonly round: number; readonly view: CanvasView } | null = null;
  /**
   * La firma delle voci della banda che la shell ha: si avvisa solo se cambia.
   * `_attachmentDeclared` è `files.attachment-folder` com'è scritto (`null`
   * finché non arriva, o se non è un testo): la banda mostra la cartella del deposito.
   */
  _statusShown = "";
  _attachmentDeclared: string | null = null;
  /**
   * Le gemelle (C14, T22): per ogni file che più schede mostrano, i loro id;
   * rifatte a ogni resa. `_litTwins` sono quelle illuminate da «×N» (la
   * scheda da cui si è acceso e il suo file), `null` se spente;
   * `_twinsHover` il «×N» sotto il puntatore; `_twinsShown` la firma
   * delle gemelle che la banda ha letto.
   */
  _twins: Map<string, readonly string[]> = new Map();
  _litTwins: { readonly from: string; readonly path: string } | null = null;
  _twinsHover: Element | null = null;
  _twinsShown = "";
  /** I conti «↩ N» dall'indice (T22); `null` senza la porta. */
  readonly _citations: CitationCounts | null;
  /** Il navigatore (T55), in basso a destra della vista. */
  readonly _navigator: CanvasNavigator;
  /** «Nascondi il navigatore» per questa lavagna (T55): si ricorda nella vista (T36). */
  _navigatorHidden = false;
  /** I salti della vista per Indietro e Avanti (T56): solo in memoria, per questa lavagna aperta. */
  readonly _jumps = new CanvasJumps();
  /** La barra «Cerca nella lavagna» (T60), in alto a destra della vista. */
  readonly _findBar: CanvasFindBar;
  /** Il segno della ricerca di ogni scheda (T60): lo legge anche la scheda che nasce dopo. */
  _findMarkOf: (id: string) => FindMark = () => null;
  /** `canvas.drop_folder` e il suo percorso (T34), dal vivo; `null` finché non arriva. */
  _dropChoice: DropFolderChoice | null = null;

  constructor(parent: HTMLElement, options: CanvasEngineOptions) {
    this._options = options;
    this._viewMemo = options.viewMemory && options.documentId
      ? new CanvasViewRecorder(options.viewMemory, options.documentId, () => this._viewSnapshot())
      : null;
    this._quiet = new PenQuiet(idleSchedule(this._life));
    this._labelsSchedule = idleSchedule(this._life);
    this._life.add(() => this._quiet.dispose());
    if (!options.fingerMovesCard) {
      this._life.add(watchPreferences((preferences) => {
        this._fingerMovesCardSetting = preferences.fingerMovesCard;
        // Il suggerimento di «Il dito scrive» dice se questa vale.
        this._rail.sync();
      }));
    }
    // La rotella segue «La rotella del mouse» a ogni cambio: vale dallo scatto
    // dopo. La colonna segue quella scelta nelle Impostazioni
    // (`canvas.toolbar`), dal vivo; la lettura arriva dopo il costruttore.
    this._life.add(watchPreferences((preferences) => {
      this._wheelSetting = preferences.wheel;
      // Il trascinamento nel vuoto (N6 T20b) vale dal gesto dopo; la riga dice il gesto di adesso.
      this._dragEmptySetting = preferences.dragEmpty;
      this._canvasOptions.sync();
      this._penButtonSetting = preferences.penButton;
      this._partsPickerSetting = preferences.partsPicker;
      this._gridSetting = preferences.grid;
      this._snapSetting = preferences.snap;
      this._snapStep = snapStepOf(preferences.snapStep);
      this._fingerWritesSetting = preferences.fingerWrites;
      this._paintGrid();
      this._rail.setToolbar(preferences.toolbar);
      this._rail.sync();
      // Lo spazio di lavoro (T65): `auto` sceglie col dispositivo.
      (this._workspace as CanvasWorkspaceControl | undefined)?.setMode(preferences.workspace);
      this._dropChoice = { dropFolder: preferences.dropFolder, dropFolderPath: preferences.dropFolderPath };
      this._statusSettle();
    }));
    this._port = options.core ?? SHARED_CORE;
    // La cartella dei file trascinati arriva da `files.attachment-folder`, letta
    // una volta: la banda la mostra quando arriva. Una lettura che fallisce
    // lascia la cartella di serie.
    void readAttachmentFolder().then((declared) => {
      this._attachmentDeclared = declared;
      this._statusSettle();
    }, () => undefined);
    this._root = document.createElement("div");
    this._root.className = "canvas-surface";
    // La barra dei comandi è la barra delle opzioni del kit, come la riga
    // sopra: una riga sola, e ciò che non ci sta va in «…» invece di scorrere
    // di lato senza segno (#411). Le frecce passano fra i controlli che si
    // vedono, «…» compreso.
    this._toolbarBar = createOptionsBar({
      label: t("canvas.surface"),
      moreLabel: t("canvas.toolbar.more"),
      lifetime: this._life,
      onFit: () => this._toolbarKeys?.refresh(),
    });
    this._toolbar = this._toolbarBar.element;
    this._toolbar.classList.add("canvas-toolbar");
    const toolbarRow = this._toolbar.querySelector<HTMLElement>(".kit-options-row")!;
    const toolbarMore = this._toolbar.querySelector<HTMLElement>(".kit-options-more")!;
    this._toolbarKeys = rovingToolbar(this._toolbar, {
      controls: () => [...toolbarRow.querySelectorAll<HTMLElement>("button, select, input"), toolbarMore],
    }, this._life);
    this._viewport = document.createElement("div");
    this._viewport.className = "canvas-viewport";
    this._viewport.tabIndex = 0;
    this._viewport.setAttribute("role", "application");
    this._viewport.setAttribute("aria-label", t("canvas.surface"));
    this._stage = document.createElement("div");
    this._stage.className = "canvas-stage";
    // I fili sono il primo figlio dello stage, nella stessa pila delle schede
    // (T91, rotta 4): sotto le schede, ma sopra lo sfondo di un gruppo, che CSS
    // mette sotto. Lo stage ha la camera; il filo non ne ha una sua.
    this._edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this._edgeLayer.classList.add("canvas-edges");
    this._edgeLayer.setAttribute("aria-hidden", "true");
    this._stage.append(this._edgeLayer);
    // Le prese dei fili scelti stanno sopra lo stage, così il puntatore le
    // prende prima dei punti delle schede che le coprono (T91, rotta 5).
    this._handleLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this._handleLayer.classList.add("canvas-edge-handles");
    this._handleLayer.setAttribute("aria-hidden", "true");
    // La griglia (T71) sta sotto lo stage: i suoi punti non passano sopra le schede.
    this._grid = document.createElement("div");
    this._grid.className = "canvas-grid";
    this._grid.setAttribute("aria-hidden", "true");
    // Il velo della croce (T20d) sopra tutto ciò che il puntatore prende: si
    // mostra con `data-idle` tolto, mai con `hidden`, che le regole `:has()`
    // della shell leggono (vedi i riquadri dei bersagli, T20c).
    this._penVeil = document.createElement("div");
    this._penVeil.className = "canvas-pen-veil";
    this._penVeil.setAttribute("aria-hidden", "true");
    this._penVeil.setAttribute("data-idle", "");
    this._viewport.append(this._grid, this._stage, this._handleLayer, this._penVeil);
    this._paintGrid();
    // Lo spazio di lavoro (T65): Semplice o Completo, e Ctrl+. che nasconde
    // l'interfaccia. Gli attributi stanno sulla superficie; la colonna, la
    // riga e il navigatore si rifanno qui.
    this._workspace = createCanvasWorkspace({
      root: this._root,
      lifetime: this._life,
      mode: currentPreferences().workspace,
      parts: () => [...this._root.querySelectorAll<HTMLElement>(".canvas-header, .canvas-toolbar, .canvas-rail, .canvas-selection-bar, .canvas-navigator")],
      focusBoard: () => this._viewport.focus({ preventScroll: true }),
      onWorkspace: (workspace) => {
        // Si entra nel Semplice col navigatore chiuso.
        if (workspace === "simple") this._simpleNavigator = false;
        this._rail.setWorkspace(workspace);
        this._canvasOptions.sync();
        this._statusSettle();
      },
      onBare: (bare) => {
        // I menu aperti dalla riga non restano senza la riga.
        if (bare) this._canvasOptions.closeMenus();
        this._statusSettle();
      },
    });
    // Il corpo: la colonna degli strumenti (T49) e l'area della lavagna, come
    // il corpo del disegno. Stretta, la colonna va sotto, in riga.
    this._rail = createCanvasRail({
      tool: () => this._tool,
      pick: (tool) => {
        this._recordPending();
        this._pickTool(tool);
      },
      editable: () => !this._readOnly && !this._isSceneOversized(),
      toolbar: currentPreferences().toolbar,
      workspace: this._workspace.workspace,
      onFull: () => this._workspace.chooseFull(),
      fingerWrites: () => this._fingerWritesSetting,
      fingerMovesCard: () => this._fingerMovesCard(),
      onFingerWrites: (on) => this._setFingerWrites(on),
      ruler: () => (this._inkRuler?.ruler ?? null) !== null,
      onRuler: (on) => this._inkRuler?.set(on),
      lifetime: this._life,
    });
    // La lavagna vuota (T62) è un fratello della vista, non un suo figlio: i
    // suoi pulsanti non passano dal puntatore della vista.
    this._empty = createCanvasEmpty({
      lifetime: this._life,
      write: () => this._placeText(),
      receive: (data) => this._receive(data),
      addFiles: options.attachments !== undefined && options.documentId !== undefined,
    });
    // Il navigatore (T55): un fratello della vista, come la lavagna vuota; un
    // clic è un salto (`_jumpCamera`), un trascinamento sposta la vista.
    this._navigator = createCanvasNavigator({
      lifetime: this._life,
      nodes: () => (this._doc && !this._isSceneOversized() ? this._doc.nodes : null),
      view: () => {
        const rect = this._viewport.getBoundingClientRect();
        return { camera: { ...this._camera }, width: rect.width || 800, height: rect.height || 600 };
      },
      enabled: () => !this._workspace.bare && !this._navigatorClosed(),
      jump: (camera) => this._jumpCamera(camera),
      pan: (camera) => {
        this._stopMotion(false);
        this._camera = { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom) };
        this._applyCamera();
      },
      settled: () => {
        this._refreshLive();
        this._statusSettle();
      },
    });
    // Cerca nella lavagna (T60): un fratello della vista, come il navigatore.
    // Ogni risultato è un salto (`_jumpCamera`); il velo lo scrive la tela.
    this._findBar = createCanvasFindBar({
      lifetime: this._life,
      index: () => (this._doc ? boardFindIndex(this._doc) : null),
      ...(options.findNotes ? { notes: options.findNotes } : {}),
      show: (matches, current) => this._showFound(matches, current),
      go: (target) => this._jumpToFound(target),
      closed: (hadFocus) => {
        if (hadFocus && !this._destroyed) this._viewport.focus({ preventScroll: true });
      },
    });
    const area = document.createElement("div");
    this._area = area;
    area.className = "canvas-area";
    area.append(this._viewport, this._empty.element, this._findBar.element, this._navigator.element);
    // Il righello (T87): un fratello della vista, sopra di lei, così il suo
    // corpo non passa dallo strato della penna.
    this._inkRuler = createCanvasRuler({
      host: area,
      camera: () => this._camera,
      viewCenter: () => {
        const rect = this._viewport.getBoundingClientRect();
        const { x, y } = this._screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return [x, y];
      },
      announce: (text) => this._sayGesture(text),
      onToggle: () => this._rail.sync(),
      lifetime: this._life,
    });
    const body = document.createElement("div");
    body.className = "canvas-body";
    body.append(this._rail.element, area);
    this._root.append(this._toolbar, body);
    this._viewport.dataset.tool = this._tool;
    // I due comandi dell'inchiostro, in testa alla barra e gli stessi in ogni
    // barra: il menu della penna (il rialzo aperto non si stacca quando la
    // barra si rifà) e l'interruttore «Scrivi col mouse», che tiene il fuoco
    // dopo il clic, così chi usa la tastiera sente lo stato nuovo.
    // Il selettore di «Altro…» (T47) non resta aperto senza la lavagna.
    this._life.add(() => this._colorPicker?.close());
    this._penMenu = createPenMenu({
      lifetime: this._life,
      choice: () => this._penChoice,
      choose: (next, settled) => this._choosePen(next, settled),
      editable: () => !this._readOnly && !this._isSceneOversized(),
      theme: () => ((this._root.dataset.theme ?? options.theme) === "dark" ? "dark" : "light"),
    });
    // La testata, sopra la barra di N4 e la lavagna: la riga delle opzioni
    // (T50), col menu della penna dentro.
    this._canvasOptions = createCanvasOptions({
      lifetime: this._life,
      tool: () => this._tool,
      chosen: () => this._selectedNodes().length,
      color: () => this._chosenColor(),
      tips: () => this._tips,
      text: () => this._chosenText(),
      commands: () => this.commands(),
      run: (id) => {
        this._recordPending();
        const command = this.commands().find((one) => one.id === id);
        if (command && command.disabled() === null) command.run();
      },
      penMenu: this._penMenu,
      swatches: () => this._colorSwatches(),
      activeCard: () => this._besideHere() !== null,
      simple: () => this._workspace.workspace === "simple",
      dragEmpty: () => this._dragEmptySetting,
    });
    // La barra della selezione (T51): una sorella della vista, come il
    // navigatore, così i suoi clic non passano dal puntatore della lavagna.
    this._selectionBar = createCanvasSelectionBar({
      lifetime: this._life,
      commands: () => this.commands(),
      run: (id, trigger) => {
        this._recordPending();
        const command = this.commands().find((one) => one.id === id);
        if (!command || command.disabled() !== null) return;
        // I menu si aprono sotto il pulsante della barra.
        if (id === "canvas.color_menu") this._canvasOptions.openColorMenu(trigger);
        else if (id === "canvas.align_menu") this._canvasOptions.openAlignMenu(trigger);
        else command.run();
        this._statusSettle();
      },
      color: () => this._chosenColor(),
      back: () => this._viewport.focus({ preventScroll: true }),
      restyle: (change) => this._restyleChosen(change),
    });
    area.append(this._selectionBar.element);
    const header = document.createElement("div");
    header.className = "canvas-header";
    header.append(this._canvasOptions.element);
    this._toolbar.before(header);
    const inkMouse = document.createElement("button");
    inkMouse.type = "button";
    inkMouse.dataset.canvasAction = "ink-mouse";
    this._life.listen(inkMouse, "click", (event) => {
      event.preventDefault();
      this._recordPending();
      this._toggleInkMouse();
    });
    this._inkMouseButton = inkMouse;
    parent.replaceChildren(this._root);
    const citations = options.cards?.citations;
    this._citations = citations ? new CitationCounts(citations, () => this._syncHeads()) : null;
    this._life.add(() => this._citations?.dispose());
    this._stopLanguage = onLanguage(() => {
      // I corpi di sempre hanno parole: alla prossima resa si rifanno.
      this._languageRound++;
      this._syncHeads();
      this._scheduleLabels();
      this._viewport.setAttribute("aria-label", t("canvas.surface"));
      this._toolbar.setAttribute("aria-label", t("canvas.surface"));
      this._toolbar.querySelector(".kit-options-more")?.setAttribute("aria-label", t("canvas.toolbar.more"));
      this._drawToolbar();
      this._rail.relabel();
      this._empty.relabel();
      this._navigator.relabel();
      this._findBar.relabel();
      this._canvasOptions.sync();
      this._selectionBar.relabel();
    });
    this._listen();
    this._drawToolbar();
    this._restoreInkMouse(options.inkMouseMemory ?? SHARED_INK_MOUSE);
    this._restorePen(options.penMemory ?? SHARED_PEN);
  }

  focus(): void {
    if (!this._destroyed) this._viewport.focus();
  }

  /**
   * Tutta la lavagna nella vista, subito, senza volo e senza entrare nella
   * storia di Indietro: la zona lavagna di una nota a riposo (T47), che si
   * guarda sempre intera, anche dopo un cambio di misura o di testo.
   * `margin`, in unità della lavagna per lato: la scheda ne vuole meno di
   * un riquadro.
   */
  fitAll(margin = FIT_MARGIN): void {
    if (this._destroyed || !this._doc) return;
    this._stopMotion(false);
    this._camera = this._fitTarget(this._doc.nodes, margin);
    this._applyCamera();
    this._refreshLive();
  }

  /** In sola lettura per il pannello o per la tela: nessun gesto cambia il testo. */
  get _readOnly(): boolean {
    return this._panelReadOnly || this._unwritable;
  }

  destroy(): void {
    if (this._destroyed) return;
    // Il testo in sospeso va nel documento che il riquadro mostrava.
    this._closeField(true);
    // L'ultima vista si scrive adesso; dopo, nessuna scrittura parte più.
    this._viewMemo?.close();
    this._destroyed = true;
    if (this._marquee !== null) this._stopMarquee();
    clearTimeout(this._pauseTimer);
    this._pauseTimer = undefined;
    clearTimeout(this._wheelTimer);
    this._wheelTimer = undefined;
    this._endFlash();
    this._revival++;
    // Un tratto in corso si perde senza errori: lo strato lo annulla, e la
    // vita chiude lo scheduler e ciò che il silenzio della penna teneva.
    this._syncInkLayer();
    this._life.close();
    this._hideGuides();
    this._dropCore();
    // Ogni vista si distrugge qui, una volta: `_releaseBody` la dimentica.
    this._dropCards();
    // I PDF guasti smettono di guardare i loro file (T72).
    for (const stop of this._pdfBroken.values()) stop();
    this._pdfBroken.clear();
    this._stopLanguage();
    this._abort.abort();
    this._root.remove();
  }

  /**
   * Il testo intero del documento col testo in sospeso dentro, come lo
   * scriverebbe il commit, senza cambiare la lavagna; `null` se non c'è testo
   * in sospeso o il nucleo non lo prende (allora vale l'ultimo testo accettato,
   * e lo si annota nel registro).
   */
  pendingText(): string | null {
    const pending = this._pending;
    if (!pending || this._destroyed || !this._doc) return null;
    const core = this._core;
    if (!core) return null;
    let doc: CanvasDocument = this._doc;
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = doc.nodes.find((node) => node.id === pending.card.id);
      const next = withPending(current ?? pending.card, pending);
      const patch = upsertNodePatch(doc, next);
      // Il campo dice ciò che la lavagna ha già.
      if (!patch) return this._source;
      try {
        return core.preview([patch]);
      } catch (error) {
        if (lostCore(error)) {
          this._lose();
          return null;
        }
        if (!(error instanceof CanvasCoreError)) throw error;
        const fresh = error.code === "stale" && attempt === 0 ? this._coreModel() : null;
        if (!fresh) {
          console.warn(`canvas: il testo in sospeso non entra nella bozza (${error.code})`);
          return null;
        }
        doc = fresh;
      }
    }
    return null;
  }

  /** Registra adesso il testo in sospeso, come alla fine della pausa. */
  commitPending(): void {
    if (!this._destroyed) this._recordPending();
  }

  /** Se c'è testo di una scheda non ancora registrato. */
  get hasPending(): boolean {
    return this._pending !== null;
  }

  /**
   * The selected cards as text: a card's text, a file's path, a link's URL, a
   * group's label. The last one picked is the primary.
   */
  selectedText(): { primary: string; secondary: string[] } | null {
    const nodes = this._selectedNodes();
    const last = nodes[nodes.length - 1];
    if (this._destroyed || !last) return null;
    return { primary: nodeText(last), secondary: nodes.slice(0, -1).map(nodeText) };
  }

  // --- l'inchiostro -------------------------------------------------------------

  /** Una penna è giù: un tratto della punta o della gomma è in corso. */
  get _penDown(): boolean {
    return this._quiet.active || (this._inkLayer?.drawing ?? false);
  }

  /** L'interruttore «Scrivi col mouse»: lo strumento della colonna è dell'inchiostro. */
  get _inkMouse(): boolean {
    return CANVAS_INK_TOOLS.has(this._tool);
  }

  /** Il mouse scrive: D tenuto, o uno strumento dell'inchiostro nella colonna. */
  get _inkMouseOn(): boolean {
    return this._inkMouse || this._inkKeyDown;
  }

  /**
   * Fa scrivere il mouse (`on`) o lo lascia alla lavagna, dal prossimo
   * appoggio: l'interruttore «Scrivi col mouse». Acceso, la colonna passa
   * allo strumento della penna del menu (Penna, Evidenziatore o Gomma);
   * spento, dall'inchiostro torna alla Selezione. Un tratto già giù finisce
   * com'è. D tenuto lo fa scrivere anche da spento.
   */
  setInkMouse(on: boolean): void {
    if (this._destroyed) return;
    this._inkMouseTurns += 1;
    if (on) this._setTool(this._penChoice.tool);
    else if (this._inkMouse) this._setTool("select");
  }

  /** Lo strumento scelto adesso nella colonna. */
  get tool(): CanvasToolId {
    return this._tool;
  }

  // --- la gomma: «Il tratto intero» (A20) e «Solo il pezzo» (T22) -----------

  /**
   * Che cosa fa la gomma dalla prossima passata: toglie il tratto intero
   * (`"stroke"`, di serie) o ne taglia solo il pezzo strofinato (`"piece"`).
   * Una passata già cominciata finisce com'è.
   */
  setInkEraser(mode: InkEraserMode): void {
    if (this._destroyed || (mode !== "stroke" && mode !== "piece")) return;
    if (mode === this._penChoice.eraser) return;
    this._penTurns += 1;
    this._penChoice = { ...this._penChoice, eraser: mode };
    this._penMenu.sync();
  }

  /** `_pageBoxOf` come funzione, per la gomma e il Lazo (`erasableInk`). */
  readonly _pagesShown = (id: string): CardPageBox | null => this._pageBoxOf(id);

  /** `_cellRectOf` come funzione, per la gomma e il Lazo (`erasableInk`). */
  readonly _cellsShown = (id: string, sheet: string, cell: string): CardCellBox | null => this._cellRectOf(id, sheet, cell);

  /** `_contentAspectOf` come funzione, per la gomma e il Lazo (`erasableInk`). */
  readonly _aspectsShown = (id: string): number | null => this._contentAspectOf(id);

  _fitCamera(announce = true, nodes = this._doc?.nodes ?? []): void {
    this._stopMotion(false);
    this._camera = this._fitTarget(nodes);
    if (announce) {
      this._applyCamera();
      this._refreshLive();
    }
  }

  // --- cerca nella lavagna (T60) ---------------------------------------------

  /**
   * Apre la barra «Cerca nella lavagna» e le dà il fuoco: è `find()` della
   * superficie, la strada di Ctrl+F dello Scrittoio. `false` senza documento:
   * allora la shell cerca da sé.
   */
  find(): boolean {
    if (this._destroyed || !this._doc) return false;
    this._findBar.open();
    return true;
  }

  // --- indietro e avanti (T56) ------------------------------------------------

  /**
   * Indietro (`EditorSurface.jumps`): torna al salto precedente, in volo. `false`
   * se non ci sono salti a cui tornare: allora vale la cronologia del riquadro.
   */
  jumpBack(): boolean {
    if (this._destroyed || !this._doc) return false;
    const target = this._jumps.back();
    if (target === null) return false;
    this._flyCamera(target);
    return true;
  }

  /** Avanti (`EditorSurface.jumps`): rifà il salto che Indietro ha lasciato. `false` se non c'è. */
  jumpForward(): boolean {
    if (this._destroyed || !this._doc) return false;
    const target = this._jumps.forward();
    if (target === null) return false;
    this._flyCamera(target);
    return true;
  }

  /**
   * F6 dentro la lavagna (`EditorSurface.zone`): la vista, il navigatore se si
   * vede (T55), la colonna degli strumenti e la riga delle opzioni (T61); dopo,
   * la shell passa all'ispettore. `false` quando non resta una zona da quella
   * parte. La vista e il navigatore prendono il fuoco loro; la colonna e la
   * riga lo danno al controllo che il Tab raggiunge (`focusZone`).
   */
  zone(step: 1 | -1): boolean {
    if (this._destroyed) return false;
    const own = new Set<HTMLElement>([this._viewport, this._navigator.element]);
    // Senza interfaccia (T65) restano la vista e il navigatore, se si vede.
    const chrome = this._workspace.bare ? [] : [this._rail.element, this._canvasOptions.element];
    const zones = [this._viewport, this._navigator.element, ...chrome]
      .filter((zone) => zone.closest("[hidden]") === null);
    const at = zones.findIndex((zone) => zone.contains(document.activeElement));
    const target = zones[at < 0 ? (step > 0 ? 0 : zones.length - 1) : at + step];
    if (target === undefined) return false;
    if (own.has(target)) target.focus();
    else focusZone(target);
    return true;
  }

  // --- i comandi (T48) --------------------------------------------------------------

  /**
   * I comandi della lavagna adesso: il catalogo (`chrome/commands.ts`) con
   * ciò che fanno qui. Li leggono il menu del tasto destro, i tasti e la
   * ricerca dei comandi.
   */
  commands(): CanvasCommand[] {
    if (this._destroyed) return [];
    return buildCanvasCommands((id) => this._commandBehaviour(id), t);
  }

  // --- la banda di stato (T52) ------------------------------------------------

  /** Le voci della banda adesso (`EditorSurface.status`): nessuna senza una lavagna. */
  statusItems(): SurfaceStatusItem[] {
    if (this._destroyed || !this._doc) return [];
    return canvasStatusItems(this._statusPort());
  }

  /**
   * Chiede i conti «↩ N» della zona (`headZonePaths`): le schede in vista o
   * vicine, dallo zoom in cui la testata si vede, più quelle che lavorano.
   * Lo chiamano la resa e la fine di ogni gesto (`_refreshLive`); a lavagna
   * nascosta o a gesto in corso non chiede niente.
   */
  _askCitations(nodes: readonly CanvasNode[] | undefined = this._doc?.nodes): void {
    const citations = this._citations;
    if (!citations || !nodes || this._destroyed) return;
    if (this._gestureActive() || !this._isShown()) return;
    const kept = new Set<string>();
    for (const id of [this._activeId, this._enteringId, this._writingId]) if (id !== null) kept.add(id);
    const { view, zoom } = this._viewRect();
    citations.want(headZonePaths(nodes, view, zoom, kept));
  }

  /**
   * La barra di una scheda in scrittura nella riga delle opzioni (T50): la
   * barra di formato della nota (T41) o la formula della cella (T42), al
   * posto delle opzioni dello strumento. `null` quando la scheda esce: la
   * riga torna allo strumento.
   */
  setCardOptions(items: readonly OptionItem[] | null): void {
    if (this._destroyed) return;
    this._canvasOptions.setWriting(items);
    this._syncSelectionBar();
  }

  // --- il menu radiale e i gesti (T63) ------------------------------------------

  /** Il colore della penna di adesso: quello dell'evidenziatore con l'evidenziatore. */
  get _penColor(): string {
    return this._penChoice.color[inkStrokeTool(this._penChoice)];
  }
}

export interface CanvasEngine extends CropMethods {}
mixMethods(CanvasEngine.prototype, cropMethods);
export interface CanvasEngine extends DocumentMethods {}
mixMethods(CanvasEngine.prototype, documentMethods);
export interface CanvasEngine extends TextMethods {}
mixMethods(CanvasEngine.prototype, textMethods);
export interface CanvasEngine extends InkMethods {}
mixMethods(CanvasEngine.prototype, inkMethods);
export interface CanvasEngine extends LassoMethods {}
mixMethods(CanvasEngine.prototype, lassoMethods);
export interface CanvasEngine extends ToolsMethods {}
mixMethods(CanvasEngine.prototype, toolsMethods);
export interface CanvasEngine extends CameraMethods {}
mixMethods(CanvasEngine.prototype, cameraMethods);
export interface CanvasEngine extends KeysMethods {}
mixMethods(CanvasEngine.prototype, keysMethods);
export interface CanvasEngine extends IntakeMethods {}
mixMethods(CanvasEngine.prototype, intakeMethods);
export interface CanvasEngine extends ConvertMethods {}
mixMethods(CanvasEngine.prototype, convertMethods);
export interface CanvasEngine extends ClipboardMethods {}
mixMethods(CanvasEngine.prototype, clipboardMethods);
export interface CanvasEngine extends CommandsMethods {}
mixMethods(CanvasEngine.prototype, commandsMethods);
export interface CanvasEngine extends CardToolsMethods {}
mixMethods(CanvasEngine.prototype, cardToolsMethods);
export interface CanvasEngine extends MenuMethods {}
mixMethods(CanvasEngine.prototype, menuMethods);
export interface CanvasEngine extends EdgesMethods {}
mixMethods(CanvasEngine.prototype, edgesMethods);
export interface CanvasEngine extends PointerMethods {}
mixMethods(CanvasEngine.prototype, pointerMethods);
export interface CanvasEngine extends DragMethods {}
mixMethods(CanvasEngine.prototype, dragMethods);
export interface CanvasEngine extends CardsMethods {}
mixMethods(CanvasEngine.prototype, cardsMethods);
export interface CanvasEngine extends CardOpenMethods {}
mixMethods(CanvasEngine.prototype, cardOpenMethods);
export interface CanvasEngine extends ListenMethods {}
mixMethods(CanvasEngine.prototype, listenMethods);
export interface CanvasEngine extends DocumentApi {}
mixMethods(CanvasEngine.prototype, documentApi);
export interface CanvasEngine extends MenuApi {}
mixMethods(CanvasEngine.prototype, menuApi);
