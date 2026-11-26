import type { Theme } from "../../theme/theme";
import { nearFreeSpot } from "./free-spot";
import type { SyntaxForm } from "../../host/contract";
import { t, onLanguage } from "../../i18n/strings";
import { MENU_RULE, menuBelow, type SurfaceMenu, type SurfaceMenuClipboard, type SurfaceMenuEntry, type SurfaceMenuItem } from "../core/editor-menu";
import { type TextOperation } from "../core/text-operation";
import { idleSchedule } from "../../ink/dom/idle";
import { PenQuiet, type Schedule } from "../../ink/quiet";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { focusZone } from "../../ui/a11y";
import { mediaKindOfId } from "../media/media-types";
import {
  cardKindOf,
  liveCardIds,
  updateLiveCards,
  type CardContext,
  type CardEditorContext,
  type CardCellBox,
  type CardEditorState,
  type CardKind,
  type CardMode,
  type CardPageBox,
  type CardQuiet,
  type CardRenderer,
  type CardSnapshots,
  type CardView,
  type CardWriting,
  type Rect,
} from "../core/cards/contract";
import { cardTitle, type BoardReading } from "./a11y";
import { applyCardDetails, cardDetail, detailLevel, farTitle } from "./lod";
import { type InkEraserMode } from "./ink-erase";
import {
  CANVAS_LAYOUTS,
  buildCanvasCommands,
  menuChord,
  type CanvasCommand,
  type CanvasTip,
  type CanvasToolId,
} from "./chrome/commands";
import { CANVAS_INK_TOOLS, createCanvasRail, saveFingerWrites, type CanvasRail } from "./chrome/rail";
import type { Radial } from "../spatial/tools/radial";
import { createCanvasEmpty, isEmptyBoard, type CanvasEmpty } from "./chrome/empty";
import { createCanvasNavigator, type CanvasNavigator } from "./chrome/navigator";
import { CanvasJumps } from "./jumps";
import { applyFindMarks, boardFindIndex, type FindMark } from "./find";
import { createCanvasFindBar, type CanvasFindBar } from "./chrome/find-bar";
import { createCanvasOptions, type CanvasOptions } from "./chrome/options";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "./text-style";
import { createCanvasWorkspace, isBareKey, type CanvasWorkspaceControl } from "./chrome/workspace";
import { createCanvasSelectionBar, type CanvasSelectionBar } from "./chrome/selection-bar";
import { type LassoPoint } from "./lasso";
import { cardsTouched, edgesBetween, marqueeBox, marqueeMoved, sameIds, unionIds } from "./marquee";
import { createOptionsBar, type OptionItem, type OptionsBar } from "../../kit/options-bar";
import { rovingToolbar, type RovingToolbar } from "../../kit/toolbar-keys";
import { watchWholeLines } from "./whole-lines";
import { canvasStatusItems, readAttachmentFolder, statusSignature } from "./chrome/status";
import type { SurfaceStatusItem } from "../core/registry";
import { CitationCounts, cardFilePath, headZonePaths, syncCardHead, twinGroups } from "./card-head";
import { type DropFolderChoice } from "../../state/canvas-intake";
import { saveStateKey } from "../../state/saving";
import { type CommandSearchHandle } from "./chrome/command-search";
import { type InkLayer } from "./ink-layer";
import { createCanvasRuler, type CanvasRuler } from "./ink-ruler";
import { StrokeGuide } from "./ink-shapes";
import { InkPathCache, type DryStroke } from "./ink-paint";
import { inkReflowWidth, syncInkReflow } from "./ink-reflow";
import { createPenMenu, type PenMenu } from "./pen-menu";
// I colori delle schede e dei fili (T47).
import { JSON_CANVAS_COLORS, NOTE_COLORS, colorChoiceOf, colorMenuLabel, type CanvasColorChoice } from "./colors";
import { type PopoverHandle } from "../../kit";
import { cardParts } from "./parts";
import { cardTarget } from "./sources";
import { type PartsPickerHandle, type PartsPickerPlace } from "./parts-picker";
import { cardFormulaBar, type CardFormulaBar } from "../core/formula-bar";
import { noteHeadingOf } from "../core/cards/kinds/note";
import { noteExcerptOf, syncExcerptHead } from "./excerpt";
import { READER_TAP_MS, type ReaderHandle } from "./reader";
import { DEFAULT_PREFERENCES, currentPreferences, snapStepOf, watchPreferences, type DragEmptyAction, type PenButtonAction, type WheelAction } from "./preferences";
import { TAP_MAX_MS, TAP_SLOP_PX, isTap, pinchCamera, type TouchCamera, type TouchPoint } from "./touch";
import { type MotionState } from "../../spatial/camera";
import { onReducedMotionChange, reducedMotion } from "../../theme/reduced-motion";
import { DEFAULT_INK_CHOICE, inkStrokeTool, type InkPenChoice, type InkLayerRef } from "./ink-record";
import { upsertNodePatch, type CanvasPatch } from "./operation";
import { type CanvasDocument, type CanvasNode } from "./model";
import { type EdgeSide } from "./edges";
import { CanvasViewRecorder, type CanvasView } from "./view-state";
import { GUIDE_SCREEN_PX, snapGuides, type GuideRect, type GuideResult, type GuideSegment } from "./guides";
import { CanvasCoreError, type CanvasCore, type CanvasIntentOp } from "./wasm/core";
import {
  CANVAS_SNAP,
  CANVAS_GRID_DOT_STEPS,
  CANVAS_GRID_MIN_PX,
  CANVAS_MIN_SIZE,
  DOUBLE_CLICK_ENTERS,
  FileShowing,
  MOVE_CONTENTS_MAX,
  MAX_INTERACTIVE_NODES,
  MAX_INTERACTIVE_EDGES,
  CanvasCorePort,
  SHARED_CORE,
  SHARED_INK_MOUSE,
  SHARED_PEN,
  CardLinkRef,
  CanvasEngineOptions,
  CanvasCards,
} from "./engine-options";
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
  isInkKey,
  InkStates,
  PendingText,
  CropSession,
  MenuEntryMaker,
  ColorMenuMaker,
  CardEntry,
  Viewport,
  PanSample,
  PointerAt,
  FINGER_CONTROLS,
  BESIDE_HERE_NAMES,
  CardLink,
  ConnectGesture,
  FINGER_HANDLES,
  LONG_PRESS_MS,
  FINGERS_TAP_MS,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  MENU_ECHO_MS,
  ZOOM_LIMITS,
  clampZoom,
  FIT_MARGIN,
  CARD_FLASH_MS,
  INERTIA_WINDOW_MS,
} from "./engine-parts";
import {
  overlaps,
  snap,
  snapTo,
  SETTLE_MS,
  MOVE_SIDES,
  ResizeCorner,
  RESIZE_CORNERS,
  RESIZE_FINGER_GRIP_PX,
  TEXT_CARD_HEIGHT,
  ResizeBox,
  resizeBox,
  boxAround,
  scaleInto,
  cornerOf,
  tinyOnScreen,
  resizeHandle,
  markHandles,
  measureText,
  naturalSize,
  paintColor,
  paintTextStyle,
  isVaultPath,
  externalUrl,
} from "./engine-geometry";
import {
  setOp,
  withPending,
  lostCore,
  cardBodyKey,
  fileName,
  relinkedFile,
  nodeTitle,
  nodeText,
  cardLinkOf,
  linkedCardOf,
} from "./engine-names";
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
  CanvasChange,
  CanvasMediaPort,
  CanvasAttachmentPort,
  CanvasRepoint,
  CanvasDepositCards,
  CanvasCorePort,
  CanvasInkMouseMemory,
  CanvasPenMemory,
  CardLinkRef,
  CanvasEngineOptions,
  CanvasNotesPort,
  CanvasCards,
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
  ResizeCorner,
  RESIZE_ONE_HANDLE_PX,
  RESIZE_FINGER_GRIP_PX,
  CANVAS_TEXT_FIT_MAX_WIDTH,
  NEXT_CARD_GAP,
  NEXT_CARD_TRIES,
  ResizeBox,
  ResizeOptions,
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
    // I tasti degli strumenti valgono anche col fuoco sulla colonna (dopo un
    // clic su una casella); gli altri tasti lì sono della colonna.
    this._life.listen(this._rail.element, "keydown", (event) => this._railKeydown(event));
    // Ctrl+. nasconde e riporta l'interfaccia (T65) da ogni punto della
    // lavagna: la vista, la colonna, la riga, la barra, il navigatore. Dentro
    // una scheda che scrive il tasto è prima dell'editor: arriva qui solo se
    // l'editor non lo usa. Sulla vista il comando `canvas.bare` lo prende già.
    this._life.listen(this._root, "keydown", (event) => {
      if (event.defaultPrevented || !isBareKey(event)) return;
      event.preventDefault();
      this._workspace.setBare(!this._workspace.bare);
    });
    // I tasti dello zoom valgono anche fuori dalla vista (la riga, la colonna, il
    // navigatore), come Ctrl+.: col fuoco su un pulsante dello zoom «+» zooma (IMP-040).
    this._life.listen(this._root, "keydown", (event) => this._zoomKeydown(event));
    // Ctrl+Z e Ctrl+Y anche dopo un clic su un pulsante della colonna, della riga
    // o della barra della scelta (IMP-6300); in un campo vero restano del campo.
    this._life.listen(this._root, "keydown", (event) => this._historyKeydown(event));
    const signal = this._abort.signal;
    // Le dita giù, prima dello strato della penna (T64): in cattura e prima di
    // lui, che si monta dopo. Un dito che lo strato prende per scrivere non
    // arriva qui sotto, e resta `swallowed`.
    this._viewport.addEventListener("pointerdown", (event) => {
      // Ogni puntatore giù si ricorda, anche quello che lo strato della penna
      // prende per sé: il suo rilascio perso lo chiude dal punto dov'era (T20a).
      this._pressed.set(event.pointerId, { last: event, held: event.buttons !== 0 });
      if (event.pointerType !== "touch") return;
      const { clientX: x, clientY: y } = event;
      this._touches.set(event.pointerId, { startX: x, startY: y, at: event.timeStamp, x, y, swallowed: true });
    }, { capture: true, signal });
    this._viewport.addEventListener("pointermove", (event) => {
      this._pointerMoved(event);
      const touch = event.pointerType === "touch" ? this._touches.get(event.pointerId) : undefined;
      if (touch) {
        touch.x = event.clientX;
        touch.y = event.clientY;
      }
    }, { capture: true, signal });
    // Un gesto che comincia toglie la barra della selezione: torna a fine gesto.
    this._viewport.addEventListener("pointerdown", (event) => {
      const touch = event.pointerType === "touch" ? this._touches.get(event.pointerId) : undefined;
      if (touch) touch.swallowed = false;
      // Un tasto premuto con Spazio giù è uno spostamento, non un tocco (T76).
      if (this._spaceTap) this._spaceTap.spoiled = true;
      this._selectionBar.hide();
      this._downByTouch = event.pointerType === "touch";
      this._pointerDown(event);
      // I gesti del dito (T63) guardano ciò che il dito ha appena cominciato.
      if (event.pointerType === "touch") this._gestureDown(event);
    }, { signal });
    this._viewport.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") this._gestureMove(event);
      this._pointerMove(event);
    }, { signal });
    // Il rilascio vero: la fine del gesto è quella di `_gestureEnd`, che passa
    // anche dalle chiusure senza rilascio (T20a).
    this._viewport.addEventListener("pointerup", (event) => this._gestureEnd(event, false), { signal });
    // La cattura persa è un rilascio che non arriva più: il gesto si chiude come
    // se il puntatore si fosse alzato, una volta sola (T20a). Un dito no: la
    // cattura gliela tolgono lo strato della penna e il browser quando il dito
    // passa a scrivere o a far da navigazione (T64), e il suo gesto lo chiudono
    // il rilascio, il `pointercancel` o la finestra.
    this._viewport.addEventListener("lostpointercapture", (event) => {
      if (event.pointerType !== "touch") this._gestureLost(event);
    }, { signal });
    // La vista che cambia misura, o che torna in vista da un'altra linguetta
    // (da zero alla sua misura), rifà la scelta delle schede vive. La vista
    // cambia misura anche quando cambia quella della superficie: allora la
    // colonna va sotto la lavagna, o torna di lato (`_syncNarrow`).
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        this._syncNarrow();
        this._refreshLive();
        // La lavagna può stare tutta nella vista nuova, o non più (T55).
        this._statusSettle();
      });
      observer.observe(this._viewport);
      this._life.add(() => observer.disconnect());
    }
    this._viewport.addEventListener("pointercancel", (event) => {
      if (event.pointerType === "touch") this._fingers.delete(event.pointerId);
      this._cancelGestures();
      if (event.pointerType === "touch") this._gestureUp(event, true);
    }, { signal });
    // Il tasto laterale lasciato, o un dito alzato fuori dalla vista (T63):
    // sul documento, perché il rilascio può cadere sul menu radiale.
    this._life.listen(document, "pointerup", (event) => this._pointerEnded(event), { capture: true });
    this._life.listen(document, "pointercancel", (event) => this._pointerEnded(event), { capture: true });
    // Il menu del sistema dietro al tasto laterale o al tocco lungo non apre
    // quello della lavagna (T63); quello che la lavagna manda da sé sì.
    this._viewport.addEventListener("contextmenu", (event) => {
      if (event === this._ownMenu) return;
      if (this._longPress !== null || this._menuHeld !== null || this._radial !== null || performance.now() < this._menuEchoUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, { signal, capture: true });
    this._life.add(() => {
      this._cancelLongPress();
      this._radial?.close();
    });
    this._viewport.addEventListener("wheel", (event) => this._wheel(event), { signal, passive: false });
    // La vista si muove solo con la camera: uno scorrimento del browser (un
    // editor in una scheda che porta il cursore in vista, T43) si annulla.
    this._viewport.addEventListener("scroll", () => {
      if (this._viewport.scrollTop !== 0) this._viewport.scrollTop = 0;
      if (this._viewport.scrollLeft !== 0) this._viewport.scrollLeft = 0;
    }, { signal });
    this._viewport.addEventListener("keydown", (event) => {
      this._keydown(event);
      this._statusSettle();
    }, { signal });
    // Prima delle schede che scrivono: Ctrl+Z subito dopo un tratto fatto
    // sopra un campo aperto annulla il tratto, non il testo.
    this._viewport.addEventListener("keydown", (event) => this._inkUndoKey(event), { signal, capture: true });
    // D lasciato ovunque, la finestra che perde il fuoco o si nasconde: il
    // mouse torna a selezionare.
    this._life.listen(window, "keyup", (event) => {
      if (isInkKey(event)) this._releaseInkKey();
    });
    this._life.listen(window, "blur", () => this._releaseInkKey());
    this._life.listen(document, "visibilitychange", () => this._releaseInkKey());
    // La finestra che perde il fuoco: i rilasci dei puntatori giù non
    // arriveranno, e ogni gesto aperto si chiude come un rilascio (T20a).
    this._life.listen(window, "blur", () => this._gesturesLost());
    // Muoversi (T53). Spazio lasciato ovunque, o la finestra che perde il
    // fuoco: il tasto principale torna allo strumento. Con la finestra che
    // perde il fuoco l'inerzia e lo scorrimento al bordo si fermano, e un
    // volo arriva dove andava.
    // Spazio lasciato dopo un tocco breve, col puntatore fermo e una nota
    // scelta: il lettore (T76). Lo spostamento non aspetta il tocco.
    this._life.listen(window, "keyup", (event) => {
      if (event.key !== " ") return;
      const tap = this._spaceTap;
      const tapped = tap !== null && !tap.spoiled && event.timeStamp - tap.at >= 0 && event.timeStamp - tap.at < READER_TAP_MS;
      this._releaseSpace();
      if (tapped) this._openReaderOnChoice();
    });
    this._life.listen(window, "blur", () => this._stillCamera());
    this._life.listen(document, "visibilitychange", () => {
      if (document.hidden) this._stillCamera();
    });
    this._life.add(onReducedMotionChange((reduced) => {
      this._reducedMotion = reduced;
      // Cambiato a lavagna aperta: un volo arriva subito, l'inerzia si ferma.
      if (reduced) this._stopMotion(true);
    }));
    this._life.add(() => {
      this._stopMotion(false);
      this._stopEdgeScroll();
    });
    // Prima dello strato della penna, che ferma i suoi eventi: ogni
    // appoggio, anche della penna, ferma la vista che scorre da sola.
    this._viewport.addEventListener("pointerdown", () => this._stopMotion(false), { signal, capture: true });
    this._viewport.addEventListener("dblclick", (event) => this._dblclick(event), { signal });
    // Prima del contenuto delle schede: fuori da una scheda attiva il clic
    // sceglie, entra, o segue un link con Ctrl, e non arriva al contenuto.
    this._viewport.addEventListener("click", (event) => this._cardClick(event), { signal, capture: true });
    // Dove si incolla: l'ultimo punto visto sulla vista, finché il puntatore
    // non ne esce.
    this._viewport.addEventListener("pointermove", (event) => {
      this._pointerSeen = { x: event.clientX, y: event.clientY };
      this._spaceTapMoved(event.clientX, event.clientY);
    }, { signal });
    // A chi appartiene il tratto (T69). L'appoggio si legge in cattura, prima
    // dello strato della penna che lo ferma: è solo un punto. I movimenti si
    // leggono dopo, quando la scia è già disegnata; Alt si legge ovunque.
    this._viewport.addEventListener("pointerdown", (event) => this._inkSeen(event), { signal, capture: true });
    this._viewport.addEventListener("pointermove", (event) => this._inkTargetMove(event), { signal });
    // Il velo della croce (T20d): c'è col mouse e con la penna sospesa sopra
    // la vista; un dito che si appoggia, o la penna che esce dal raggio, lo
    // toglie. Il mouse che esce no: fuori dalla vista il velo non conta, e
    // ogni volta che compare sotto il puntatore la scheda sotto perde il suo
    // `:hover` e si ridipinge.
    const veilOver = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") this._setVeilPointer(true);
    };
    this._viewport.addEventListener("pointerover", veilOver, { signal, capture: true });
    this._viewport.addEventListener("pointermove", veilOver, { signal, capture: true });
    this._viewport.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") this._setVeilPointer(false);
    }, { signal, capture: true });
    this._viewport.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "pen") this._setVeilPointer(false);
    }, { signal });
    // «Torna a N px» dell'avviso dei tratti sul testo (`ink-reflow.ts`).
    this._viewport.addEventListener("click", (event) => {
      const back = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-ink-reflow]") : null;
      const id = back?.closest<HTMLElement>(".canvas-node")?.dataset.node;
      if (!back || id === undefined) return;
      event.stopPropagation();
      this._restoreInkWidth(id, Number(back.dataset.inkReflow));
    }, { signal });
    // «×N» illumina le gemelle al passaggio e col fuoco (C14, T22); si
    // spengono quando li perde tutti e due.
    const twinsButton = (target: EventTarget | null): Element | null =>
      target instanceof Element ? target.closest(".canvas-node-twins") : null;
    this._viewport.addEventListener("pointerover", (event) => {
      const button = twinsButton(event.target);
      if (!button) return;
      this._twinsHover = button;
      this._lightTwinsFrom(button);
    }, { signal });
    this._viewport.addEventListener("pointerout", (event) => {
      const button = twinsButton(event.target);
      if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
      if (this._twinsHover === button) this._twinsHover = null;
      if (!button.contains(document.activeElement)) this._lightTwins(null);
    }, { signal });
    this._viewport.addEventListener("focusin", (event) => {
      const button = twinsButton(event.target);
      if (button) this._lightTwinsFrom(button);
    }, { signal });
    this._viewport.addEventListener("focusout", (event) => {
      const button = twinsButton(event.target);
      if (button && this._twinsHover !== button) this._lightTwins(null);
    }, { signal });
    // La scheda sotto il puntatore tiene l'aspetto del passaggio quando il
    // velo o la cattura del tratto le tolgono `:hover` (T20f).
    this._viewport.addEventListener("pointerover", (event) => this._pointerOver(event), { signal, capture: true });
    this._viewport.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      this._hoverCard = null;
      this._holdHover(null);
    }, { signal });
    this._life.listen(window, "keydown", (event) => {
      if (event.key === "Alt") this._setAltHeld(true);
    });
    this._life.listen(window, "keyup", (event) => {
      if (event.key === "Alt") this._setAltHeld(false);
    });
    this._life.listen(window, "blur", () => this._setAltHeld(false));
    // Maiusc (T87): il tratto dritto e la forma regolare, letti ovunque; un
    // movimento della penna lo rilegge, se la finestra non l'ha saputo.
    this._life.listen(window, "keydown", (event) => {
      if (event.key === "Shift") this._setShiftHeld(true);
    });
    this._life.listen(window, "keyup", (event) => {
      if (event.key === "Shift") this._setShiftHeld(false);
    });
    this._life.listen(window, "blur", () => this._setShiftHeld(false));
    this._viewport.addEventListener("pointermove", (event) => {
      if (this._inkGuides.size > 0 && event.shiftKey !== this._shiftHeld) this._setShiftHeld(event.shiftKey);
    }, { signal });
    this._life.add(() => {
      clearTimeout(this._shapeTimer);
      this._inkGuides.clear();
    });
    this._viewport.addEventListener("pointerleave", () => {
      this._pointerSeen = null;
      // Il puntatore fuori dalla lavagna: nessun filo si scurisce (T67).
      this._setEdgeHover(null);
    }, { signal });
    this._viewport.addEventListener("dragover", (event) => {
      if (!this._readOnly && !this._isSceneOversized() && event.dataTransfer
        && (this._options.attachments || event.dataTransfer.types.includes("text/plain"))) {
        event.preventDefault();
        this._showDropGhosts(event);
      }
    }, { signal });
    this._viewport.addEventListener("dragleave", (event) => {
      // Passare da un figlio all'altro della vista non è uscire.
      const next = event.relatedTarget;
      if (next instanceof Node && this._viewport.contains(next)) return;
      this._hideDropGhosts();
    }, { signal });
    this._viewport.addEventListener("drop", (event) => {
      this._hideDropGhosts();
      void this._intake(event).catch((error: unknown) => this._showIntakeError(error));
    }, { signal });
    this._viewport.addEventListener("paste", (event) => {
      void this._intake(event).catch((error: unknown) => this._showIntakeError(error));
    }, { signal });
    // Copia, taglia e incolla delle schede (T68). Il browser manda l'evento a
    // chi ha il fuoco o alla selezione di testo, che può stare altrove (il
    // corpo della pagina): si ascolta il documento e si guarda il fuoco.
    this._life.listen(document, "copy", (event) => this._copyEvent(event, false));
    this._life.listen(document, "cut", (event) => this._copyEvent(event, true));
    this._life.listen(document, "paste", (event) => this._pasteFromOutside(event));
    this._drawToolbar();
    this._restoreInkMouse(options.inkMouseMemory ?? SHARED_INK_MOUSE);
    this._restorePen(options.penMemory ?? SHARED_PEN);
  }

  /**
   * Apre il testo `source` nel nucleo, da capo: la storia dell'annulla
   * ricomincia. Un testo che il nucleo non apre lancia, e la tela resta com'era.
   */
  setDoc(source: string): void {
    if (this._destroyed) return;
    // Il testo in sospeso è del documento di prima: si registra lì.
    this._closeField(true);
    const document = this._open(source);
    // La vista di prima si scrive adesso, poi si legge quella ricordata
    // (T36): arriva dopo, e prende ciò che nessuno ha toccato.
    const remembered = this._viewMemo?.begin();
    const viewRound = ++this._viewRound;
    this._openView = null;
    this._heldView = null;
    if (remembered) void remembered.then((view) => this._restoreView(viewRound, view));
    // Un documento nuovo: la risposta di prima era dell'altro testo.
    if (this._unwritable) {
      this._unwritable = false;
      this._root.dataset.readOnly = String(this._readOnly);
    }
    this._epoch++;
    this._cancelGestures();
    // Un documento nuovo: il menu radiale era dell'altro (T63).
    this._radial?.close();
    this._lastTap = null;
    // Un documento nuovo: il tratto in corso era dell'altro.
    this._inkLayer?.cancel();
    this._inkChain = null;
    this._source = source;
    this._version = ++this._versions;
    this._doc = document;
    this._intakeError = "";
    this._removal = null;
    this._connectFrom = null;
    // Un documento nuovo: si esce dalla scheda dell'altro.
    this._leaveCard(false, false);
    this._selection = [];
    this._edgeSelection = [];
    this._undo = [];
    this._redo = [];
    this._inkOverField = [];
    this._inkOverFieldRedo = [];
    this._statusSettle();
    this._syncEmpty();
    if (!document) {
      void this._revive();
      return;
    }
    this._checkWritable();
    this._fitCamera(false);
    this._render();
    this._markOpenView();
  }

  /**
   * Il testo cambiato da un'altra parte (un'altra superficie, un altro
   * programma). Il campo aperto resta aperto, e il suo testo in sospeso si
   * registra subito dopo, sulla scheda com'è nel testo nuovo.
   */
  syncDoc(update: { readonly text: string; readonly operation: TextOperation | null } | string): void {
    if (this._destroyed) return;
    const source = typeof update === "string" ? update : update.text;
    const document = this._open(source);
    this._cancelGestures();
    this._epoch++;
    this._intakeError = "";
    // Lo stesso testo (l'eco di un commit di qui) lascia valida la via del tratto.
    const changed = source !== this._source;
    if (changed) this._version = ++this._versions;
    // Un testo cambiato altrove è una modifica dopo il togliere (T17).
    if (changed) this._removal = null;
    this._source = source;
    if (!document) {
      void this._revive();
      return;
    }
    this._doc = document;
    // Lo stesso testo si riscrive come prima: la domanda serve solo a un testo nuovo.
    if (changed) this._checkWritable();
    this._pruneSelection();
    // Modello e sorgente sono già quelli nuovi; il ridisegno, con una penna
    // giù, aspetta che si alzi (A9). Il tratto in corso non si perde: la
    // scheda si sceglie sul documento del momento in cui la penna si alza.
    this._quiet.defer("render", () => {
      if (!this._destroyed) this._render();
    });
    // Fuori dalla consegna che ci ha portato il testo: la sessione la sta
    // ancora facendo agli altri riquadri.
    if (this._pending) queueMicrotask(() => this._deferPending());
  }

  getDoc(): string {
    return this._source;
  }

  /**
   * La scelta adesso, per l'ispettore (T59): le id delle schede e dei fili.
   * Sono copie: chi le legge non cambia la scelta.
   */
  selection(): { readonly nodes: readonly string[]; readonly edges: readonly string[] } {
    return { nodes: [...this._selection], edges: [...this._edgeSelection] };
  }

  /** Il modello della lavagna adesso, per l'ispettore (T59); `null` senza lavagna. */
  doc(): CanvasDocument | null {
    return this._doc;
  }

  /**
   * Un gesto dell'ispettore (T59): le toppe fanno un commit solo, col suo
   * annulla, come un gesto della tela. Senza lavagna o in sola lettura non
   * cambia niente, come gli altri gesti.
   */
  commitPatches(patches: readonly CanvasPatch[]): void {
    if (patches.length === 0) return;
    this._commit(patches, "input");
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

  /**
   * Brings into view the card whose source holds `byteOffset` (UTF-8 bytes,
   * the currency of the model's spans): selects it and frames it. `false`
   * when the offset is outside every card, or the scene is too large to draw.
   *
   * Con `"jump"` (l'ispettore, «Schede» e «Fonti», T99) la vista ci va come
   * ogni salto (`_jumpCamera`): vola, e Indietro torna da dove si era. Con
   * `"frame"` (la shell, l'apertura a un punto) la camera si mette lì e basta.
   */
  revealSource(byteOffset: number, how: "frame" | "jump" = "frame"): boolean {
    if (this._destroyed || !this._doc || !this._core || this._isSceneOversized()) return false;
    let index: number | null;
    try {
      index = this._core.nodeAt(byteOffset);
    } catch (error) {
      if (lostCore(error)) this._lose();
      return false;
    }
    const node = index === null ? undefined : this._doc.nodes[index];
    if (!node) return false;
    this._closeField(false);
    this._cancelGestures();
    this._selection = [node.id];
    this._edgeSelection = [];
    if (how === "jump") this._jumpCamera(this._fitTarget([node]));
    else this._fitCamera(false, [node]);
    this._render();
    this._viewport.focus();
    this._options.onSelectionChange();
    return true;
  }

  setReadOnly(readOnly: boolean): void {
    // In sola lettura il campo si chiude comunque: ciò che non si registra
    // l'avviso l'ha già detto.
    this._closeField(readOnly);
    this._cancelGestures();
    this._panelReadOnly = readOnly;
    this._root.dataset.readOnly = String(this._readOnly);
    this._render();
    this._statusSettle();
  }

  /** In sola lettura per il pannello o per la tela: nessun gesto cambia il testo. */
  get _readOnly(): boolean {
    return this._panelReadOnly || this._unwritable;
  }

  /**
   * Chiede al nucleo se il testo di adesso si riscrive: un'anteprima senza
   * toppe passa dallo stesso ritocco di ogni commit, e un testo che il
   * ritocco rifiuta (una chiave doppia, anche annidata in un campo
   * sconosciuto) risponde `rejected`. Allora la tela resta da guardare: il
   * campo aperto si chiude come per la sola lettura del pannello, e l'avviso
   * della barra dice perché. Un nucleo assente o morto non risponde: la
   * risposta di prima resta finché `_revive` non riapre il testo.
   */
  _checkWritable(): void {
    const core = this._core;
    if (!core) return;
    let unwritable: boolean;
    try {
      core.preview([]);
      unwritable = false;
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return;
      }
      if (!(error instanceof CanvasCoreError)) throw error;
      unwritable = error.code === "rejected";
    }
    if (unwritable === this._unwritable) return;
    if (unwritable) {
      this._unwritable = true;
      this._closeField(true);
      this._cancelGestures();
    } else {
      this._unwritable = false;
    }
    this._root.dataset.readOnly = String(this._readOnly);
    // Subito, anche con una penna giù e il ridisegno rimandato: lo strato se
    // ne va (il tratto in corso si annulla) o torna, e la barra dice perché.
    this._syncInkLayer();
    this._drawToolbar();
  }

  setTheme(theme: Theme): void {
    this._root.dataset.theme = theme;
    // I campioni che si leggono poco lo dicono per il tema di adesso (A23).
    this._penMenu.sync();
  }

  /**
   * Le sintassi del Markdown delle card, com'è montato in questo vault. Una
   * card in modifica tiene il suo editor: la resa nuova arriva col disegno
   * successivo.
   */
  setSyntaxForms(forms: readonly SyntaxForm[]): void {
    this._forms = forms;
    this._formsRound++;
    if (!this._editor) this._render();
  }

  /**
   * Annulla l'ultimo passo: il testo di prima byte per byte se nessuno l'ha
   * cambiato nel frattempo, se no le toppe inverse che il nucleo ha dato al
   * suo commit.
   */
  undo(): boolean {
    // Con una penna giù annulla e ripeti non fanno niente (A5).
    if (this._penDown) return false;
    const editing = this._editor !== null;
    const born = this._editor?.born ? this._editor.id : null;
    if (!this._closeField(false)) return false;
    if (editing) this._render();
    // La scheda nuova lasciata vuota se n'è andata chiudendo: era lei da annullare (T44).
    if (born !== null && !this._doc?.nodes.some((node) => node.id === born)) return true;
    const step = this._undo.pop();
    if (!step || !this._doc) return false;
    if (this._replay(step, "undo", (again) => this._redo.push(again)) !== true) {
      this._undo.push(step);
      return false;
    }
    return true;
  }

  /** Rifà il passo annullato, con le stesse due vie dell'annulla. */
  redo(): boolean {
    if (this._penDown) return false;
    const editing = this._editor !== null;
    if (!this._closeField(false)) return false;
    if (editing) this._render();
    const step = this._redo.pop();
    if (!step || !this._doc) return false;
    if (this._replay(step, "redo", (again) => this._pushUndo(again, false)) !== true) {
      this._redo.push(step);
      return false;
    }
    return true;
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

  _isSceneOversized(): boolean {
    return !!this._doc && (this._doc.nodes.length > MAX_INTERACTIVE_NODES
      || this._doc.edges.length > MAX_INTERACTIVE_EDGES);
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

  // --- la griglia e le guide (T71) -------------------------------------------

  /**
   * I punti della griglia, ogni `CANVAS_GRID_DOT_STEPS` passi di `CANVAS_SNAP`
   * (32 unità della lavagna, su incroci dell'aggancio), nella vista
   * e sotto le schede. Il livello segue la camera con la sua posizione e il
   * suo passo, senza variabili CSS (lo stage ne ha già). Il punto sta al
   * centro della sua cella, così cade sulle intersezioni. Sotto
   * `CANVAS_GRID_MIN_PX` sullo schermo non si disegna.
   */
  _paintGrid(): void {
    const grid = this._grid;
    if (!grid) return;
    const step = CANVAS_SNAP * CANVAS_GRID_DOT_STEPS * this._camera.zoom;
    grid.hidden = !(this._gridOverride ?? this._gridSetting) || step < CANVAS_GRID_MIN_PX;
    if (grid.hidden) return;
    grid.style.backgroundSize = `${step}px ${step}px`;
    grid.style.backgroundPosition = `${this._camera.x - step / 2}px ${this._camera.y - step / 2}px`;
  }

  /** Ctrl+' (T71): mostra o nasconde la griglia di questa lavagna, e la ricorda con la vista. */
  _toggleGrid(): void {
    this._gridOverride = !(this._gridOverride ?? this._gridSetting);
    this._paintGrid();
    this._viewMemo?.changed();
  }

  /**
   * Le guide del gesto: un elemento solo sopra le schede, con un segno per
   * segmento, nelle coordinate dello schermo. Si svuota a ogni passo; `[]`
   * le toglie.
   */
  _showGuides(segments: readonly GuideSegment[]): void {
    if (segments.length === 0) {
      this._hideGuides();
      return;
    }
    let layer = this._guideLayer;
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "canvas-guides";
      layer.setAttribute("aria-hidden", "true");
      this._viewport.insertBefore(layer, this._handleLayer);
      this._guideLayer = layer;
    }
    const { x, y, zoom } = this._camera;
    layer.replaceChildren(...segments.map((segment) => {
      const line = document.createElement("div");
      const vertical = segment.x1 === segment.x2;
      line.className = "canvas-guide";
      line.dataset.kind = segment.kind;
      line.dataset.axis = vertical ? "v" : "h";
      if (vertical) {
        line.style.left = `${segment.x1 * zoom + x}px`;
        line.style.top = `${Math.min(segment.y1, segment.y2) * zoom + y}px`;
        line.style.height = `${Math.abs(segment.y2 - segment.y1) * zoom}px`;
      } else {
        line.style.left = `${Math.min(segment.x1, segment.x2) * zoom + x}px`;
        line.style.top = `${segment.y1 * zoom + y}px`;
        line.style.width = `${Math.abs(segment.x2 - segment.x1) * zoom}px`;
      }
      return line;
    }));
  }

  _hideGuides(): void {
    this._guideLayer?.remove();
    this._guideLayer = null;
  }

  /**
   * Le schede in vista che un gesto può agganciare: quelle che non si
   * muovono (`moving`) e che stanno nella vista, così con 2000 schede si
   * guarda solo quello che si vede.
   */
  _snapTargets(moving: ReadonlyMap<string, unknown>): GuideRect[] {
    const doc = this._doc;
    if (!doc) return [];
    const { view } = this._viewRect();
    const out: GuideRect[] = [];
    for (const node of doc.nodes) {
      if (!moving.has(node.id) && overlaps(node, view)) out.push(node);
    }
    return out;
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
   * Avvisa la banda se una sua voce è cambiata, a fine gesto: dentro un gesto
   * (un trascinamento, una panoramica, la rotella che gira) non dice niente, e
   * con la stessa firma di prima non avvisa.
   */
  _statusSettle(): void {
    // La barra della selezione si rilegge anche lei qui: dentro un gesto sulle
    // schede sparisce. Dentro un gesto della camera (la rotella, il volo) la
    // segue già `_followSelectionBar`, senza rifarla a ogni passo (#411 C-06).
    if (!this._gestureActive() || this._cardGestureActive()) this._syncSelectionBar();
    if (this._destroyed || !this._doc || this._gestureActive()) return;
    // Il navigatore si rilegge con la banda, a fine gesto e al cambio del documento (T55).
    this._navigator.settle();
    this._twinsShown = this._twinsKey();
    const shown = statusSignature(canvasStatusItems(this._statusPort()));
    if (shown === this._statusShown) return;
    this._statusShown = shown;
    this._options.onStatusChange?.();
  }

  // --- la testata: «↩ N» e le gemelle (T22) ----------------------------------

  /** Rifà la testata di ogni scheda: un conto nuovo dall'indice, la lingua. */
  _syncHeads(): void {
    if (this._destroyed) return;
    for (const entry of this._cards.values()) this._syncHead(entry);
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

  /** «↩ N» e «×N» nella testata di `entry`, e `data-card-twin` se le sue gemelle sono illuminate. */
  _syncHead(entry: CardEntry): void {
    const path = cardFilePath(entry.node);
    const cites = path !== "" && this._citations ? this._citations.get(path) : 0;
    const twins = path !== "" ? this._twins.get(path)?.length ?? 0 : 0;
    syncCardHead(entry.title, cites, twins);
    const lit = twins > 1 && this._litTwins?.path === path;
    if (lit !== entry.article.hasAttribute("data-card-twin")) entry.article.toggleAttribute("data-card-twin", lit);
  }

  /** Illumina le gemelle della scheda che porta il «×N» `button`. */
  _lightTwinsFrom(button: Element): void {
    const id = button.closest<HTMLElement>(".canvas-node")?.dataset.node;
    this._lightTwins(id ?? null);
  }

  /**
   * Illumina tutte le schede che mostrano il file della scheda `id`, lei
   * compresa, anche fuori dalla vista; `null` le spegne. La banda dice quante
   * sono e le inquadra.
   */
  _lightTwins(id: string | null): void {
    const node = id === null ? undefined : this._cards.get(id)?.node;
    const path = node ? cardFilePath(node) : "";
    const next = id !== null && path !== "" && this._twins.has(path) ? { from: id, path } : null;
    const now = this._litTwins;
    if (now?.from === next?.from && now?.path === next?.path) return;
    this._litTwins = next;
    const touched = new Set([...(now ? this._twins.get(now.path) ?? [] : []), ...(next ? this._twins.get(next.path) ?? [] : [])]);
    for (const twin of touched) {
      const entry = this._cards.get(twin);
      if (entry) this._syncHead(entry);
    }
    this._statusSettle();
  }

  /**
   * Le gemelle che la banda dice: quelle illuminate, o quelle della sola
   * scheda scelta; `null` se nessuna.
   */
  _shownTwins(): readonly string[] | null {
    let path = this._litTwins?.path ?? null;
    if (path === null && this._selection.length === 1) {
      const node = this._cards.get(this._selection[0]!)?.node;
      path = node ? cardFilePath(node) : null;
    }
    return path ? this._twins.get(path) ?? null : null;
  }

  /** Una firma delle gemelle della banda: se cambia, la banda si rilegge. */
  _twinsKey(): string {
    const ids = this._shownTwins();
    return ids === null ? "" : `${ids.length}\u0000${ids.join("\u0001")}`;
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

  /** Dove sono la scheda `id` (con la testata sopra, T39) e la lavagna, nella finestra. */
  _partsPlace(id: string): PartsPickerPlace {
    const rect = this._viewport.getBoundingClientRect();
    const board = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const node = this._doc?.nodes.find((one) => one.id === id);
    const zoom = this._camera.zoom;
    let card = node
      ? { left: rect.left + this._camera.x + node.x * zoom, top: rect.top + this._camera.y + node.y * zoom, width: node.width * zoom, height: node.height * zoom }
      : { left: rect.left, top: rect.top, width: 0, height: 0 };
    const handle = this._stage.querySelector(`.canvas-node[data-node="${CSS.escape(id)}"] > .canvas-node-handle`)?.getBoundingClientRect();
    if (handle && handle.height > 0 && handle.top < card.top) {
      card = { ...card, top: handle.top, height: card.top + card.height - handle.top };
    }
    return { card, board, narrow: this._root.hasAttribute("data-narrow") };
  }


  // --- menu -----------------------------------------------------------------------

  /** Il menu del tasto destro nel punto `at` della finestra (`null`: dalla
   *  tastiera, sulla selezione). Una scheda o un collegamento fuori dalla
   *  selezione diventano la selezione; sul vuoto si aggiunge lì. */
  contextMenu(at: { x: number; y: number } | null): SurfaceMenu | null {
    if (this._destroyed || !this._doc || this._isSceneOversized()) return null;
    const element = at ? this._elementAt(at.x, at.y) : null;
    if (at && (!element || !this._viewport.contains(element))) return null;
    const node = element ? this._nodeAt(element) : this._selection[0] ?? null;
    const edge = node ? null : element ? this._edgeAt(element) : this._edgeSelection[0] ?? null;
    const chosen = node ? !this._selection.includes(node) : edge ? !this._edgeSelection.includes(edge) : at !== null && (this._selection.length > 0 || this._edgeSelection.length > 0);
    if (chosen) {
      this._selection = node ? [node] : [];
      this._edgeSelection = edge ? [edge] : [];
      this._options.onSelectionChange();
      this._displaySelection();
    }
    // Le voci vengono dal catalogo dei comandi (T48): il nome, il tasto, se
    // si può e perché no. Il menu dice solo quali voci, in che ordine e su
    // che cosa (`args`); `refocus` rimette il fuoco sulla tela dopo il gesto.
    const catalog = new Map(this.commands().map((command) => [command.id, command]));
    const entry: MenuEntryMaker = (id, args, refocus = true, extra = {}) => {
      const command = catalog.get(id);
      if (!command) throw new Error(`canvas: il comando ${id} non è nel catalogo`);
      const why = command.disabled();
      const chord = menuChord(command.keys);
      return {
        id,
        label: command.label,
        ...(chord === undefined ? {} : { chord }),
        enabled: why === null,
        ...(why === null ? {} : { description: why }),
        ...(command.danger ? { danger: true } : {}),
        ...extra,
        run: () => {
          if (command.disabled() !== null) return;
          command.run(args);
          this._statusSettle();
          if (refocus) this._viewport.focus();
        },
      };
    };
    const writable = !this._readOnly;
    // «Colore ›» (T47): Nessuno e i sei di JSON Canvas col loro pallino,
    // «Colori delle note ›» coi nove, «Altro…» che apre il selettore. Tutte
    // scelte esclusive, segnata quella di adesso; `null` (colori diversi) non
    // ne segna nessuna, come un colore che non è un colore.
    let swatches: ReadonlyMap<CanvasColorChoice, string> | null = null;
    const colors: ColorMenuMaker = (current, args) => {
      swatches ??= this._colorSwatches();
      const chosen = current === null ? null : colorChoiceOf(current);
      const choice = (value: CanvasColorChoice): SurfaceMenuItem => {
        const swatch = swatches!.get(value);
        return entry(`canvas.color.${value}`, args, value !== "other", {
          label: colorMenuLabel(value),
          radio: true,
          checked: chosen === value,
          ...(swatch === undefined ? {} : { swatches: [swatch] }),
        });
      };
      return {
        id: "canvas.color",
        label: t("canvas_menu.color"),
        enabled: writable,
        items: [
          choice("none"),
          ...JSON_CANVAS_COLORS.map(choice),
          MENU_RULE,
          {
            id: "canvas.color.notes",
            label: t("canvas_menu.color.notes"),
            enabled: writable,
            items: NOTE_COLORS.map((color) => choice(color.id)),
          },
          choice("other"),
        ],
      };
    };
    if (node) {
      const nodes = this._selectedNodes();
      const one = nodes.length === 1 ? nodes[0]! : null;
      const box = this._stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(node)}"]`)?.getBoundingClientRect();
      const at = box ? menuBelow(box) : undefined;
      // Copia, Taglia e Incolla portano le schede, i fili fra loro e l'inchiostro (T68).
      const clipboard: SurfaceMenuClipboard = {
        offers: { cut: writable, copy: true, paste: writable },
        run: (op) => this._clipboardMenu(op),
      };
      if (one?.type !== "group") {
        // Dentro la scheda attiva (una cella, la nota che si scrive, la
        // pagina), o dalla tastiera con la scheda attiva, il menu porta in
        // testa «Apri a lato» su quel punto (T45).
        const inside = node === this._activeId && (element === null || this._insideActive(element, true));
        return { target: this._cardMenuTarget(nodes, node), at, context: this._cardMenu(nodes, entry, colors, inside), clipboard };
      }
      // Un gruppo solo ha il suo menu di sempre.
      const context: SurfaceMenuEntry[] = [
        colors(one.color),
        entry("canvas.duplicate"),
        {
          id: "canvas.order",
          label: t("canvas_menu.order"),
          enabled: writable,
          items: [entry("canvas.bring_front"), entry("canvas.send_back")],
        },
        entry("canvas.fit_selection", undefined, false),
        entry("canvas.delete"),
      ];
      return { target: { kind: "group", ref: node }, at, context, clipboard };
    }
    if (edge) {
      const current = this._doc.edges.find((one) => one.id === edge);
      if (!current) return null;
      return {
        target: { kind: "edge", ref: edge },
        context: [colors(current.color, { edge }), entry("canvas.edge.reverse", { edge }), entry("canvas.delete")],
      };
    }
    const here = at ? { at } : undefined;
    return {
      target: { kind: "empty" },
      clipboard: { offers: { paste: writable }, run: (op) => this._clipboardMenu(op) },
      context: [
        {
          id: "canvas.add",
          label: t("canvas_menu.add_here"),
          enabled: writable,
          items: [
            // La scheda nasce in scrittura (IMP-042): il fuoco resta nel suo testo.
            entry("canvas.add.text", here, false),
            ...(this._options.onPickFile ? [entry("canvas.add.file", here, false)] : []),
            entry("canvas.add.link", here),
            entry("canvas.add.group", here),
          ],
        },
        // «Disponi ›» senza selezione (LIC T25): tutte le schede fuori dai gruppi.
        {
          id: "canvas.arrange",
          label: t("canvas_menu.arrange"),
          enabled: writable,
          items: CANVAS_LAYOUTS.map((kind) => entry(`canvas.layout.${kind}`)),
        },
        entry("canvas.copy_code"),
        entry("canvas.paste_code", undefined, false),
        MENU_RULE,
        entry("canvas.fit", undefined, false),
        ...(at ? [entry("canvas.zoom_in", here, false), entry("canvas.zoom_out", here, false)] : []),
        // Nascondi o Mostra il navigatore (T55), quella che c'è.
        ...["canvas.navigator.hide", "canvas.navigator.show"].filter((id) => catalog.has(id)).map((id) => entry(id, undefined, false)),
        // Il menu radiale (T63), anche dalla tastiera (Maiusc+F10): il fuoco
        // va al menu, non torna sulla lavagna.
        entry("canvas.radial", here, false),
      ],
    };
  }

  // --- pointer ------------------------------------------------------------------

  _nodeAt(target: EventTarget | null): string | null {
    const el = target instanceof Element ? target.closest<HTMLElement>(".canvas-node") : null;
    return el?.dataset.node ?? null;
  }

  _edgeAt(target: EventTarget | null): string | null {
    const el = target instanceof Element ? target.closest<SVGElement>(".canvas-edge-hit") : null;
    return el?.dataset.edge ?? null;
  }
  _displaySelection(): void {
    for (const el of this._stage.querySelectorAll<HTMLElement>(".canvas-node")) {
      el.classList.toggle("selected", this._selection.includes(el.dataset.node ?? ""));
    }
    if (this._doc && !this._isSceneOversized()) this._drawEdges();
    this._syncSelectionFrame();
    this._paintLasso();
    this._drawToolbar();
    // Una scheda sola scelta con delle gemelle: la banda le dice (T22).
    if (this._twinsKey() !== this._twinsShown) this._statusSettle();
  }

  _pointerDown(event: PointerEvent): void {
    // Sotto il velo della croce (T20d) vale ciò che c'è sotto.
    const target = this._targetOf(event);
    // Un clic fuori dal ritaglio lo applica, come «Fatto» (il ritaglio del
    // disegno fa lo stesso, A-27). I gesti dentro il ritaglio non arrivano qui.
    const crop = this._crop;
    if (crop?.editor && !crop.editor.contains(target)) this._finishCrop("done", crop.editor.zone());
    // Il tasto laterale della penna senza lo strato della penna (la sola
    // lettura), che altrimenti lo prende prima (T63).
    if (event.pointerType === "pen" && event.button === 2 && this._inkLayer === null && this._penButtonSetting !== "eraser") {
      event.preventDefault();
      this._barrelDown(event);
      return;
    }
    // Un clic fuori dalle maniglie chiude il doppio clic che le adatta (T66).
    if (!(target instanceof Element && target.closest("[data-resize], [data-resize-frame]"))) this._handleTap = null;
    // Prima di ogni gesto, il testo in sospeso (non i clic dentro il campo).
    if (!(target instanceof Node && this._editor?.place.contains(target))) this._recordPending();
    const pressed = this._nodeAt(target);
    this._pressedSelected = pressed !== null && this._selection.length === 1 && this._selection[0] === pressed
      ? pressed
      : null;
    // Un clic fuori dalla scheda attiva ne esce. La penna no: scrive sopra
    // anche una scheda attiva (N4); e il tasto centrale, che sposta la vista,
    // non toglie la scrittura (T41).
    const panning = event.button === 1 && this._writingId !== null;
    if (this._activeId !== null && event.pointerType !== "pen" && !panning && !this._insideActive(target, false)) {
      this._leaveCard(false);
    }
    if (event.pointerType === "touch") this._touchDown(event);
    else this._mouseDown(event);
  }

  _mouseDown(event: PointerEvent): void {
    const modifier = event.ctrlKey || event.metaKey;
    const target = this._targetOf(event);
    // Ctrl+clic (Cmd+clic) su un link di una scheda lo segue (D-18 (c)): il
    // `click` deve arrivare al link, non a uno spostamento della lavagna.
    if (event.button === 0 && modifier && this._cardLinkAt(target) !== null) return;
    // ↗ di un estratto (T75) prende il suo clic, anche con Ctrl (Cmd).
    if (event.button === 0 && target instanceof Element && target.closest("[data-excerpt-open]")) return;
    // Anche «Torna a N px» dell'avviso dei tratti sul testo.
    if (event.button === 0 && target instanceof Element && target.closest("[data-ink-reflow]")) return;
    // Spazio tenuto: il tasto principale sposta la vista, con qualsiasi
    // strumento e sopra ogni cosa (T53).
    if (event.button === 0 && this._spaceHeld) {
      // Il clic che segue non entra nella scheda scelta sotto il puntatore.
      this._pressedSelected = null;
      this._beginPan(event.pointerId, event.clientX, event.clientY);
      event.preventDefault();
      return;
    }
    // Una maniglia vince su Alt (dal centro) e su Maiusc (le proporzioni):
    // i tasti si leggono mentre si tira (T66). La Mano sposta e basta.
    if (event.button === 0 && !modifier && this._tool !== "hand" && this._resizeFromHandle(event)) return;
    // Alt+trascina dal corpo di una scheda tira un filo (T67); nel vuoto Alt
    // sposta ancora la vista.
    if (event.button === 0 && event.altKey && !modifier && this._tool !== "hand"
      && !this._insideActive(target, false)) {
      const from = this._nodeAt(target);
      if (from && this._beginConnect(event, { from })) return;
    }
    if (event.button === 1 || modifier || event.altKey) {
      const toggle = event.button === 0 && modifier && !event.altKey ? this._nodeAt(target) ?? undefined : undefined;
      this._pan = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, camX: this._camera.x, camY: this._camera.y, toggle };
      this._viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    // La Mano sposta la lavagna, anche sopra le schede, e non sceglie niente.
    if (this._tool === "hand") {
      this._beginPan(event.pointerId, event.clientX, event.clientY);
      event.preventDefault();
      return;
    }
    // Il Lazo (T86): dentro ciò che ha scelto lo sposta; altrove, o con
    // Maiusc che aggiunge, fa un giro nuovo. In sola lettura sceglie e basta.
    if (this._tool === "lasso" && this._doc && !this._isSceneOversized()) {
      event.preventDefault();
      if (!this._readOnly && !event.shiftKey && this._insideChosen(event)) this._beginStrokeDrag(event);
      else this._beginLasso(event);
      return;
    }
    const endpoint = target instanceof Element ? target.closest<SVGElement>("[data-reconnect]") : null;
    if (endpoint && !this._readOnly) {
      const edge = this._doc?.edges.find((entry) => entry.id === endpoint.dataset.reconnect);
      if (!edge) return;
      const side = endpoint.dataset.endpoint === "from" ? "from" : "to";
      this._beginConnect(event, { from: edge.fromNode, edgeId: edge.id, endpoint: side });
      return;
    }
    const connectHandle = target instanceof Element ? target.closest<HTMLElement>("[data-connect]") : null;
    if (connectHandle) {
      if (this._readOnly) return;
      this._beginConnect(event, { from: connectHandle.dataset.connect! });
      return;
    }
    // I quattro punti sui lati (T67): il filo parte da quel lato.
    const port = target instanceof Element ? target.closest<HTMLElement>(".canvas-port") : null;
    const portOwner = port ? this._nodeAt(port) : null;
    if (port && portOwner) {
      this._beginConnect(event, { from: portOwner, fromSide: port.dataset.side as EdgeSide });
      return;
    }
    const nodeId = this._nodeAt(target);
    // Collega: da una scheda si trascina il filo fino a un'altra, come dalla
    // maniglia di collegamento.
    if (nodeId && this._tool === "connect" && !this._readOnly) {
      // Dopo «Collega…» il filo parte dalla scheda scelta allora, e il clic
      // su un'altra lo chiude dove si alza (T17).
      const from = this._connectFrom;
      this._connectFrom = null;
      this._beginConnect(event, from !== null && from !== nodeId ? { from, back: true } : { from: nodeId });
      return;
    }
    // Un filo entro 8 px vince sulla scheda dove si vede, fuori dalla scheda (T67).
    const wire = this._wireAt(target, event.clientX, event.clientY);
    if (wire) {
      // Scegliere il filo rifà i fili, e il bersaglio di questo clic esce dal
      // documento: WebKitGTK porterebbe il fuoco su BODY. Il mouse giù annullato
      // lo lascia, e il fuoco va sulla vista qui sotto (IMP-052).
      event.preventDefault();
      this._selectEdge(wire);
      this._claimFocus(null);
      return;
    }
    if (nodeId) {
      this._selectNode(nodeId, event.shiftKey);
      this._keepContentFocus(event, nodeId);
      // Il fuoco rimasto su un pulsante della colonna o della riga torna alla
      // lavagna: Canc, Ctrl+Z e lo zoom valgono per la scheda appena scelta (IMP-040).
      this._claimFocus(this._cards.get(nodeId)?.article ?? null);
      if (this._readOnly || !this._doc || !this._dragsCard(target, nodeId)) return;
      this._beginDrag(event);
      return;
    }
    const edgeId = this._edgeAt(target);
    if (edgeId) {
      this._selectEdge(edgeId);
      this._claimFocus(null);
      return;
    }
    // Testo: un clic sul vuoto mette lì una scheda di testo, col campo aperto,
    // e la colonna torna alla Selezione.
    if (this._tool === "text" && !this._readOnly) {
      event.preventDefault();
      this._placeText(event.clientX, event.clientY);
      return;
    }
    // Col mouse e con la Selezione, il vuoto sceglie con un rettangolo (N6 T20b);
    // con «sposta la vista» resta il comportamento di prima, qui sotto. Il dito e
    // la penna nel vuoto spostano sempre la vista, e arrivano da un'altra strada.
    if (event.pointerType === "mouse" && this._tool === "select" && this._doc && this._dragEmptySetting === "select"
      && !this._isSceneOversized()) {
      this._beginMarquee(event);
      return;
    }
    if (!event.shiftKey) this._clearSelection();
    this._claimFocus(null);
    this._beginPan(event.pointerId, event.clientX, event.clientY);
  }

  /**
   * Il fuoco fuori dalla lavagna (un pulsante della colonna, della riga delle
   * opzioni o della barra dei comandi appena cliccato) va su `card`, o sulla
   * vista: i tasti della lavagna arrivano di nuovo (IMP-040). Il fuoco già
   * dentro la vista resta dov'è (una scheda, il campo che scrive).
   */
  _claimFocus(card: HTMLElement | null): void {
    if (this._viewport.contains(document.activeElement)) return;
    (card?.isConnected ? card : this._viewport).focus({ preventScroll: true });
  }

  /**
   * Il mouse giù su `target` sposta la scheda `id` (IMP-041): dalla testata
   * sempre; dal corpo se la scheda non è attiva né in scrittura (allora il
   * corpo è del contenuto) e se sotto il puntatore non c'è un controllo della
   * vista (un pulsante, un campo), che tiene il suo clic. Un clic fermo resta
   * un clic: lo spostamento comincia oltre i 3 px.
   */
  _dragsCard(target: EventTarget | null, id: string): boolean {
    if (!(target instanceof Element)) return false;
    if (target.closest(".canvas-node-handle")) return true;
    if (this._activeId === id || this._editor?.id === id) return false;
    const entry = this._cards.get(id);
    if (!entry || !entry.article.contains(target)) return false;
    const control = target.closest("button, input, textarea, select, [contenteditable=''], [contenteditable='true']");
    return control === null || !entry.article.contains(control);
  }

  /**
   * Il trascinamento sinistro sul vuoto con la Selezione (N6 T20b) comincia il
   * rettangolo: il puntatore è preso dalla lavagna, e il fuoco va sulla vista, così
   * Esc arriva. Il clic non cambia ancora la scelta: lo fa il rilascio. Il
   * rettangolo si disegna al movimento; la scelta si aggiorna una volta per
   * fotogramma, e a fine gesto.
   */
  _beginMarquee(event: PointerEvent): void {
    const at = this._screenToWorld(event.clientX, event.clientY);
    this._marquee = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: at,
      to: at,
      additive: event.shiftKey,
      moved: false,
      base: { nodes: [...this._selection], edges: [...this._edgeSelection], strokes: new Set(this._strokeSelection) },
    };
    this._viewport.setPointerCapture?.(event.pointerId);
    this._viewport.focus({ preventScroll: true });
    event.preventDefault();
  }

  /** Il puntatore del rettangolo si muove: il riquadro segue subito, la scelta aspetta il fotogramma. */
  _moveMarquee(event: PointerEvent): void {
    const marquee = this._marquee;
    if (!marquee) return;
    marquee.to = this._screenToWorld(event.clientX, event.clientY);
    if (!marquee.moved) {
      if (!marqueeMoved(marquee.startX, marquee.startY, event.clientX, event.clientY)) return;
      marquee.moved = true;
    }
    this._paintMarquee(marquee);
    this._scheduleMarquee();
  }

  /**
   * Lo strato del rettangolo sullo stage, creato la prima volta che serve e poi lo
   * stesso. Si aggiunge allo stage quando serve, e non a ogni movimento: ogni
   * spostamento di un figlio dello stage rifà lo stile di ciò che gli sta attorno.
   */
  _marqueeLayerNow(): MarqueeLayer {
    let layer = this._marqueeLayer;
    if (!layer) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "canvas-marquee");
      svg.setAttribute("aria-hidden", "true");
      const box = document.createElementNS(ns, "rect");
      box.setAttribute("class", "canvas-marquee-box");
      svg.append(box);
      layer = { svg, box };
      this._marqueeLayer = layer;
    }
    if (layer.svg.parentElement !== this._stage) this._stage.append(layer.svg);
    return layer;
  }

  /** Disegna il rettangolo del gesto nel suo strato: quattro attributi, nessuna scheda toccata. */
  _paintMarquee(marquee: MarqueeGesture): void {
    const layer = this._marqueeLayerNow();
    const box = marqueeBox(marquee.from, marquee.to);
    layer.box.setAttribute("x", String(box.minX));
    layer.box.setAttribute("y", String(box.minY));
    layer.box.setAttribute("width", String(box.maxX - box.minX));
    layer.box.setAttribute("height", String(box.maxY - box.minY));
  }

  /** Chiede un fotogramma per la scelta, se non ce n'è già uno in attesa. */
  _scheduleMarquee(): void {
    if (this._marqueeFrame === undefined) this._marqueeFrame = requestAnimationFrame(() => this._marqueeStep());
  }

  /** Il fotogramma del rettangolo: la scelta si rifà una volta, con il rettangolo di adesso. */
  _marqueeStep(): void {
    this._marqueeFrame = undefined;
    const marquee = this._marquee;
    if (marquee !== null && marquee.moved && !this._destroyed) this._applyMarquee(marquee);
  }

  /** La scelta che il rettangolo fa adesso: le schede che tocca (più quelle di prima, con Maiusc) e i fili fra due di loro. */
  _applyMarquee(marquee: MarqueeGesture): void {
    const doc = this._doc;
    if (!doc) return;
    const touched = cardsTouched(marqueeBox(marquee.from, marquee.to), doc.nodes);
    const nodes = marquee.additive ? unionIds(marquee.base.nodes, touched) : touched;
    const edges = edgesBetween(new Set(nodes), doc.edges);
    this._setChoice(
      nodes,
      marquee.additive ? unionIds(marquee.base.edges, edges) : edges,
      marquee.additive ? marquee.base.strokes : new Set(),
    );
  }

  /**
   * Mette la scelta a `nodes`, `edges` e `strokes` e la mostra sullo stage. Solo le
   * schede che cambiano stato toccano la classe, e i fili si rifanno solo se la
   * loro scelta cambia: un fotogramma che non sposta niente non tocca lo stage.
   * La riga delle opzioni e la barra dei comandi si rifanno solo quando la scelta
   * passa da vuota a piena o viceversa, e lo stato verso chi ascolta (l'ispettore)
   * solo a fine gesto, come il lazo: a ogni fotogramma costano troppo (N6 T20b).
   * A fine gesto le rifà chi chiama.
   */
  _setChoice(nodes: readonly string[], edges: readonly string[], strokes: ReadonlySet<string>): void {
    const was = new Set(this._selection);
    const next = new Set(nodes);
    const changed = new Set<string>();
    for (const id of was) if (!next.has(id)) changed.add(id);
    for (const id of next) if (!was.has(id)) changed.add(id);
    const edgesChanged = !sameIds(this._edgeSelection, edges);
    const strokesChanged = !sameIds(this._strokeSelection, strokes);
    if (changed.size === 0 && !edgesChanged && !strokesChanged) return;
    this._selection = [...nodes];
    this._edgeSelection = [...edges];
    this._strokeSelection = new Set(strokes);
    if (changed.size > 0) {
      for (const el of this._stage.querySelectorAll<HTMLElement>(".canvas-node")) {
        const id = el.dataset.node ?? "";
        if (changed.has(id)) el.classList.toggle("selected", next.has(id));
      }
    }
    if (edgesChanged && this._doc && !this._isSceneOversized()) this._drawEdges();
    if (strokesChanged) this._paintLasso();
    this._syncSelectionFrame();
    if ((was.size === 0) !== (next.size === 0)) this._drawToolbar();
  }

  /**
   * Il rettangolo finisce col rilascio, con la cattura persa o con la finestra
   * (una volta sola). Uno spostato lascia la scelta dove il rettangolo l'ha
   * portata; un clic senza spostamento toglie la scelta, come prima, se non c'è
   * Maiusc.
   */
  _endMarquee(): void {
    const marquee = this._marquee;
    if (marquee === null) return;
    if (marquee.moved) this._applyMarquee(marquee);
    else if (!marquee.additive) this._clearSelection();
    this._stopMarquee();
    // La riga, la barra dei comandi e chi ascolta la scelta si rifanno a fine gesto, con la scelta di adesso.
    if (marquee.moved) this._settleChoice();
  }

  /** Esc: il rettangolo si annulla e la scelta torna com'era prima del trascinamento. */
  _cancelMarquee(): void {
    const marquee = this._marquee;
    if (marquee === null) return;
    this._stopMarquee();
    if (marquee.moved) {
      this._setChoice(marquee.base.nodes, marquee.base.edges, marquee.base.strokes);
      this._settleChoice();
    }
  }

  /** La scelta del rettangolo è quella finale: la riga e la barra si rifanno, e chi ascolta la scelta ne è avvisato una volta. */
  _settleChoice(): void {
    this._drawToolbar();
    this._options.onSelectionChange();
  }

  /** Il rettangolo smette: il fotogramma in attesa si ferma e lo strato esce dallo stage. */
  _stopMarquee(): void {
    this._marquee = null;
    if (this._marqueeFrame !== undefined) cancelAnimationFrame(this._marqueeFrame);
    this._marqueeFrame = undefined;
    this._marqueeLayer?.svg.remove();
  }

  /**
   * La scheda di testo dello strumento Testo, nel punto `clientX`, `clientY` della
   * finestra; senza punto, al centro della vista («Scrivi una scheda», T62). Si
   * apre in scrittura. Con `link` (un filo lasciato nel vuoto, T67) nasce
   * collegata alla scheda `link.from`, nello stesso commit. La colonna torna
   * alla Selezione, salvo con `keepTool` (il doppio tocco, T63).
   */
  _placeText(clientX?: number, clientY?: number, link?: CardLink, keepTool = false): void {
    const at = clientX === undefined || clientY === undefined
      ? this._freeTextSpot()
      : link ? this._screenToWorld(clientX, clientY) : this._freeTextSpotAt(this._screenToWorld(clientX, clientY));
    const placed = this._addNode("text", undefined, at, link);
    if (!placed) return;
    // Il passo che l'ha messa: lasciata vuota, se ne va con lui (T44).
    const born = this._undo[this._undo.length - 1] ?? null;
    // Il doppio tocco (T63) lascia lo strumento com'è.
    if (!keepTool) this._pickTool("select");
    this._render();
    this._beginCardEdit(placed, born);
  }

  /**
   * L'angolo in alto a sinistra di una scheda di testo nuova senza un punto
   * scelto («Aggiungi testo», «Scrivi una scheda»): al centro della vista, o
   * al posto libero più vicino, così non copre un'altra scheda (IMP-042).
   */
  _freeTextSpot(): { x: number; y: number } | undefined {
    const doc = this._doc;
    if (!doc) return undefined;
    const rect = this._viewport.getBoundingClientRect();
    const center = this._screenToWorld(rect.left + (rect.width || 800) / 2, rect.top + (rect.height || 600) / 2);
    const spot = nearFreeSpot(doc.nodes, { x: snap(center.x - 160), y: snap(center.y - 80), width: 320, height: TEXT_CARD_HEIGHT });
    return { x: spot.x, y: spot.y };
  }

  /**
   * L'angolo in alto a sinistra di una scheda di testo nuova nel punto `at`
   * (del mondo) scelto da chi usa (il doppio clic, il doppio tocco, il menu):
   * lì, se la scheda ci sta senza coprirne un'altra; se no al posto libero più
   * vicino, con la regola di «Aggiungi testo» (IMP-042). Una scheda che nasce
   * sopra quelle accanto le nasconde, e il clic dopo cade su di loro
   * (IMP-3808).
   */
  _freeTextSpotAt(at: { x: number; y: number }): { x: number; y: number } {
    const doc = this._doc;
    if (!doc) return at;
    const spot = nearFreeSpot(doc.nodes, { x: snap(at.x), y: snap(at.y), width: 320, height: TEXT_CARD_HEIGHT });
    return { x: spot.x, y: spot.y };
  }

  /** La lavagna vuota (T62): le righe e i pulsanti, se la lavagna è vuota e si può scrivere. */
  _syncEmpty(): void {
    const doc = this._doc;
    this._empty.sync({
      empty: !this._destroyed && doc !== null && isEmptyBoard(doc),
      editable: !this._readOnly && !this._isSceneOversized(),
    });
  }

  /** La scheda `nodeId` presa col clic: `additive` (Maiuscolo) la aggiunge o la toglie. */
  _selectNode(nodeId: string, additive: boolean): void {
    if (additive) {
      this._selection = this._selection.includes(nodeId)
        ? this._selection.filter((id) => id !== nodeId)
        : [...this._selection, nodeId];
    } else if (!this._selection.includes(nodeId)) {
      this._selection = [nodeId];
      this._strokeSelection = new Set();
    } else {
      return;
    }
    this._edgeSelection = [];
    this._options.onSelectionChange();
    this._displaySelection();
  }

  _selectEdge(edgeId: string): void {
    this._edgeSelection = [edgeId];
    this._selection = [];
    this._strokeSelection = new Set();
    this._options.onSelectionChange();
    this._displaySelection();
  }

  _clearSelection(): void {
    this._selection = [];
    this._edgeSelection = [];
    this._strokeSelection = new Set();
    this._options.onSelectionChange();
    this._displaySelection();
  }

  /** Comincia a trascinare le schede scelte, e ciò che i gruppi scelti contengono. */
  _beginDrag(event: PointerEvent): void {
    if (!this._doc) return;
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of this._selection) {
      const node = this._doc.nodes.find((n) => n.id === id);
      if (node) origin.set(id, { x: node.x, y: node.y });
    }
    // A group carries every card fully inside it. Containment is geometric,
    // not a second persisted parent relation that would conflict with Canvas.
    for (const group of this._doc.nodes.filter((node) => origin.has(node.id) && node.type === "group")) {
      for (const child of this._doc.nodes) {
        if (child.id !== group.id && child.x >= group.x && child.y >= group.y
          && child.x + child.width <= group.x + group.width
          && child.y + child.height <= group.y + group.height) {
          origin.set(child.id, { x: child.x, y: child.y });
        }
      }
    }
    const ids = this._selection.filter((id) => origin.has(id));
    this._drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, ids, origin, moved: false, dx: 0, dy: 0, aimDx: 0, aimDy: 0 };
    // La cattura arriva con lo spostamento (`_moveDrag`), non qui: un clic fermo
    // resta un clic, e il suo doppio clic arriva alla scheda, non alla vista (IMP-053).
    event.preventDefault();
  }

  _beginPan(pointerId: number, clientX: number, clientY: number): void {
    this._pan = { pointerId, startX: clientX, startY: clientY, camX: this._camera.x, camY: this._camera.y };
    this._viewport.setPointerCapture?.(pointerId);
  }

  // --- il dito -----------------------------------------------------------------

  /** «Il dito sposta le schede», adesso. */
  _fingerMovesCard(): boolean {
    return this._options.fingerMovesCard ? this._options.fingerMovesCard() : this._fingerMovesCardSetting;
  }

  /**
   * Un dito si posa. Il primo sposta la lavagna, anche sopra le schede, e se
   * si alza presto e vicino fa quello che fa un clic; con «Il dito sposta le
   * schede» sopra una scheda la sposta. Le maniglie (testata, ridimensiona,
   * collega) e i controlli (pulsanti, collegamenti, campi) fanno come col
   * mouse; in sola lettura le maniglie spostano la lavagna. Il secondo dito
   * comincia il pizzico, salvo durante un gesto su una scheda, che tiene il
   * dito suo. Con una penna giù il dito non fa niente, e il palmo nemmeno.
   *
   * Con «Il dito scrive» (T64) il primo dito scrive e qui non arriva: lo
   * prende lo strato della penna. Il secondo dito annulla il suo tratto (lo
   * fa la sessione della penna) e lo prende con sé: i due pizzicano.
   */
  _touchDown(event: PointerEvent): void {
    if (this._penDown || this._palm(event.pointerId) || this._drag || this._resize || this._connect || this._pinch) return;
    this._adopted = this._adoptWritingFingers(event.pointerId);
    this._fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this._fingers.size >= 2) {
      this._beginPinch();
      event.preventDefault();
      return;
    }
    const hit = this._targetOf(event);
    const target = hit instanceof Element ? hit : null;
    // Vicino a un angolo della scelta il dito prende la maniglia (T66); un
    // controllo sotto il dito (il pulsante del filo) resta suo.
    if (!target?.closest(FINGER_CONTROLS) && this._resizeFromFinger(event)) return;
    if (target?.closest(FINGER_CONTROLS) || (!this._readOnly && target?.closest(FINGER_HANDLES))) {
      this._mouseDown(event);
      return;
    }
    const nodeId = this._nodeAt(target);
    if (nodeId && !this._readOnly && this._doc && this._fingerMovesCard()) {
      this._selectNode(nodeId, event.shiftKey);
      this._beginDrag(event);
      return;
    }
    this._tap = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, at: event.timeStamp, target, shift: event.shiftKey };
    this._beginPan(event.pointerId, event.clientX, event.clientY);
  }

  /**
   * Le dita che scrivevano (T64) e che la sessione della penna ha appena
   * fatto diventare navigazione, perché si è posato il dito `except`: da qui
   * la lavagna le segue come le sue, dal punto dove sono adesso. Un dito che
   * la lavagna non ha preso per altre ragioni (posato durante uno
   * spostamento, il palmo) non era dello strato e resta fuori.
   */
  _adoptWritingFingers(except: number): number[] {
    const adopted: number[] = [];
    for (const [id, touch] of this._touches) {
      if (id === except || !touch.swallowed || this._fingers.has(id)) continue;
      if (this._inkLayer?.roleOf(id) !== "navigate") continue;
      touch.swallowed = false;
      this._fingers.set(id, { x: touch.x, y: touch.y });
      adopted.push(id);
    }
    return adopted;
  }

  /** «Il dito scrive» dall'interruttore della colonna: vale subito, e si scrive nelle Impostazioni di questo computer. */
  _setFingerWrites(on: boolean): void {
    if (this._destroyed || on === this._fingerWritesSetting) return;
    const before = this._fingerWritesSetting;
    this._fingerWritesSetting = on;
    this._rail.sync();
    // Una scrittura che non riesce lascia il valore di prima, se nel frattempo
    // nessuno l'ha cambiato.
    saveFingerWrites(on, () => {
      if (this._destroyed || this._fingerWritesSetting !== on) return;
      this._fingerWritesSetting = before;
      this._rail.sync();
    });
  }

  /**
   * Il dito `pointerId` è il palmo: lo decide la sessione della penna
   * (`ink/input/roles.ts`), che fa palmo ogni dito con una penna giù o
   * sospesa, e le dita già giù quando la penna arriva. Senza lo strato (sola
   * lettura) non c'è penna che scriva, e nessun dito è palmo.
   */
  _palm(pointerId: number): boolean {
    return this._inkLayer?.roleOf(pointerId) === "ignore";
  }

  /** Le prime due dita giù diventano un pizzico: il pan e il tocco breve finiscono. */
  _beginPinch(): void {
    const [a, b] = [...this._fingers.keys()];
    if (a === undefined || b === undefined) return;
    this._pan = null;
    this._tap = null;
    this._pinch = { a, b, a0: this._local(this._fingers.get(a)!), b0: this._local(this._fingers.get(b)!), start: { ...this._camera } };
    this._viewport.setPointerCapture?.(b);
  }

  /** Un punto del client in coordinate del viewport. */
  _local(point: TouchPoint): TouchPoint {
    const rect = this._viewport.getBoundingClientRect();
    return { x: point.x - rect.left, y: point.y - rect.top };
  }

  /** Un dito si muove: `true` se l'ha preso il dito, `false` se tocca al gesto comune. */
  _touchMove(event: PointerEvent): boolean {
    if (!this._fingers.has(event.pointerId)) return true;
    this._fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // La penna vince, giù o sospesa: il dito si ferma, e una scheda che
    // spostava torna dov'era.
    if (this._penDown || this._palm(event.pointerId)) {
      this._cancelGestures();
      return true;
    }
    const pinch = this._pinch;
    if (pinch) {
      const a = this._fingers.get(pinch.a);
      const b = this._fingers.get(pinch.b);
      if (a && b && (event.pointerId === pinch.a || event.pointerId === pinch.b)) {
        this._camera = { ...pinchCamera(pinch.start, pinch.a0, pinch.b0, this._local(a), this._local(b), ZOOM_LIMITS) };
        this._applyCamera();
      }
      return true;
    }
    const tap = this._tap;
    if (tap?.pointerId === event.pointerId && !isTap(tap.startX, tap.startY, event.clientX, event.clientY, 0)) this._tap = null;
    return false;
  }

  /**
   * Un dito si alza: `true` se l'ha preso il dito. Dal pizzico, il dito che
   * resta sposta la lavagna; un tocco breve fa quello che fa un clic.
   */
  _touchUp(event: PointerEvent): boolean {
    if (!this._fingers.delete(event.pointerId)) return true;
    const pinch = this._pinch;
    if (pinch) {
      if (event.pointerId !== pinch.a && event.pointerId !== pinch.b) return true;
      this._pinch = null;
      const rest = [...this._fingers][0];
      if (rest) this._beginPan(rest[0], rest[1].x, rest[1].y);
      return true;
    }
    const tap = this._tap;
    if (tap?.pointerId !== event.pointerId) return false;
    this._tap = null;
    this._pan = null;
    if (isTap(tap.startX, tap.startY, event.clientX, event.clientY, event.timeStamp - tap.at)) this._tapAt(tap.target, tap.shift);
    return true;
  }

  /** Il tocco breve su `target`: sceglie come il clic del mouse. */
  _tapAt(target: Element | null, additive: boolean): void {
    if (!target?.isConnected) return;
    const nodeId = this._nodeAt(target);
    if (nodeId) {
      this._selectNode(nodeId, additive);
      return;
    }
    const edgeId = this._edgeAt(target);
    if (edgeId) this._selectEdge(edgeId);
    else if (!additive) this._clearSelection();
  }

  // --- il menu radiale e i gesti (T63) ------------------------------------------

  /** Il colore della penna di adesso: quello dell'evidenziatore con l'evidenziatore. */
  get _penColor(): string {
    return this._penChoice.color[inkStrokeTool(this._penChoice)];
  }

  /**
   * La penna si appoggia col tasto laterale (`canvas.pen_button`): apre il
   * menu radiale, che la segue finché il tasto è giù; o sposta la lavagna; o
   * fa un giro di Lazo che sceglie come lo strumento Lazo, e lo strumento di
   * prima resta. Con `eraser` cancella lo strato della penna, e qui non
   * arriva. I movimenti e il rilascio sono quelli di ogni puntatore.
   */
  _barrelDown(event: PointerEvent): void {
    const action = this._penButtonSetting;
    if (this._destroyed || !this._doc || action === "eraser") return;
    this._menuHeld = event.pointerId;
    this._recordPending();
    if (action === "radial") {
      this._openRadial(event.clientX, event.clientY, { pointerType: "pen", pointerId: event.pointerId });
    } else if (action === "pan") {
      this._beginPan(event.pointerId, event.clientX, event.clientY);
    } else if (!this._isSceneOversized()) {
      this._selectionBar.hide();
      this._beginLasso(event);
    }
  }

  /**
   * Un puntatore si alza o si perde, ovunque. Quello che aveva preso un gesto
   * della lavagna (il tasto laterale, il tocco lungo) lascia dietro di sé, per
   * poco, il silenzio del menu del sistema. Un dito alzato fuori dalla vista
   * chiude il suo tocco, che non è più un tocco.
   */
  _pointerEnded(event: PointerEvent): void {
    this._pointerLeft(event);
    if (event.pointerType === "touch" && !(event.target instanceof Node && this._viewport.contains(event.target))) {
      this._gestureUp(event, true);
    }
  }

  /**
   * Il puntatore `event` si è alzato davvero: il rilascio vero, dal documento,
   * prima della vista. Si toglie dal ricordo (`_pressed`), dalle dita che il
   * tocco teneva e dal menu che aveva aperto. Una chiusura senza rilascio non
   * lo chiama: un dito che ha perso la cattura può essere ancora giù.
   */
  _pointerLeft(event: PointerEvent): void {
    this._pressed.delete(event.pointerId);
    if (event.pointerType === "touch") this._touches.delete(event.pointerId);
    this._menuLet(event.pointerId);
  }

  /** Il menu che il puntatore `pointerId` teneva non è più suo: il silenzio del menu di sistema resta per poco (`MENU_ECHO_MS`). */
  _menuLet(pointerId: number): void {
    if (pointerId !== this._menuHeld) return;
    this._menuHeld = null;
    this._menuEchoUntil = performance.now() + MENU_ECHO_MS;
  }

  /**
   * Un movimento di un puntatore premuto: ne ricorda il punto. Senza tasto, il
   * rilascio non è arrivato (il browser l'ha perso, o è caduto fuori dalla
   * finestra): la pressione è finita e il gesto del puntatore si chiude adesso
   * (T20a). Il dito no: non ha un tasto da lasciare, e il suo contatto lo
   * chiudono il rilascio, il `pointercancel` o la finestra.
   */
  _pointerMoved(event: PointerEvent): void {
    const seen = this._pressed.get(event.pointerId);
    if (seen === undefined) return;
    seen.last = event;
    if (event.buttons === 0 && seen.held && event.pointerType !== "touch") {
      seen.held = false;
      this._gestureLost(event);
    }
  }

  /**
   * Il gesto di `event` si chiude senza il suo rilascio, con l'ultimo evento
   * del puntatore: un movimento senza tasto, o la cattura persa (solo col mouse
   * e la penna: il browser e lo strato della penna tolgono la cattura a un dito
   * che passa a scrivere o a far da navigazione, T64), o la finestra che perde
   * il fuoco. Passa dalla stessa fine del rilascio (`_gestureEnd`) e non fa
   * niente se il gesto non c'è più: un rilascio che arriva dopo non trova niente
   * da chiudere. Il ricordo del puntatore (`_pressed`, `_touches`) resta, perché
   * il suo rilascio vero lo toglie.
   */
  _gestureLost(event: PointerEvent): void {
    if (!this._gestureOpen(event.pointerId)) return;
    // Il menu radiale che il puntatore teneva si chiude con lui: senza rilascio
    // non c'è una voce su cui si è alzato, e nessuna si sceglie.
    const menu = this._menuHeld === event.pointerId;
    this._gestureEnd(event, true);
    this._menuLet(event.pointerId);
    if (menu) this._radial?.close();
    if (this._viewport.hasPointerCapture?.(event.pointerId)) this._viewport.releasePointerCapture(event.pointerId);
  }

  /** La finestra perde il fuoco: ogni puntatore premuto si chiude come se si fosse alzato (`_gestureLost`). */
  _gesturesLost(): void {
    for (const { last } of [...this._pressed.values()]) this._gestureLost(last);
  }

  /**
   * Un gesto della lavagna è aperto per il puntatore `pointerId`: lo spostamento
   * della vista, il trascinamento di una scheda o di un tratto del Lazo, il
   * ridimensionamento, il filo, il giro del Lazo, il rettangolo della Selezione
   * (N6 T20b), il pizzico e il dito, il tocco lungo, il menu radiale che il
   * puntatore tiene. Il tratto della penna no:
   * lo tiene l'adattatore dell'inchiostro (`ink/dom/pointer-adapter.ts`), che
   * lo annulla alla cattura persa e alla finestra.
   */
  _gestureOpen(pointerId: number): boolean {
    return this._pan?.pointerId === pointerId || this._tap?.pointerId === pointerId
      || this._drag?.pointerId === pointerId || this._resize?.pointerId === pointerId
      || this._connect?.pointerId === pointerId || this._lasso?.pointerId === pointerId
      || this._marquee?.pointerId === pointerId
      || this._strokeDrag?.pointerId === pointerId || this._edgeScroll?.pointerId === pointerId
      || this._longPress?.pointerId === pointerId || this._pinch?.a === pointerId || this._pinch?.b === pointerId
      || this._fingers.has(pointerId) || this._menuHeld === pointerId;
  }

  /**
   * Un dito si posa, dopo ciò che il dito fa di suo (`_touchDown`): comincia
   * o cresce un tocco di più dita e, se è il primo e si ferma lì, il tocco
   * lungo. Con la penna giù o col palmo non è un tocco.
   */
  _gestureDown(event: PointerEvent): void {
    const point = { x: event.clientX, y: event.clientY };
    const hit = this._targetOf(event);
    const target = hit instanceof Element ? hit : null;
    // Le dita che scrivevano, prese da questo (T64), sono nel tocco dal loro
    // appoggio: un dito che ha già scritto più in là non fa un tocco.
    const adopted = this._adopted.flatMap((id) => {
      const touch = this._touches.get(id);
      return touch ? [[id, touch] as const] : [];
    });
    this._adopted = [];
    const start = Math.min(event.timeStamp, ...adopted.map(([, touch]) => touch.at));
    const taps = this._fingerTap ??= { down: new Map(), first: point, most: 0, start, spoiled: false, target };
    for (const [id, touch] of adopted) {
      taps.down.set(id, { x: touch.startX, y: touch.startY });
      if (Math.hypot(touch.x - touch.startX, touch.y - touch.startY) > TAP_SLOP_PX) taps.spoiled = true;
    }
    taps.down.set(event.pointerId, point);
    taps.most = Math.max(taps.most, taps.down.size);
    if (this._penDown || this._palm(event.pointerId)) taps.spoiled = true;
    // Il secondo dito: è un pizzico o un tocco di più dita, non un tocco lungo.
    this._cancelLongPress();
    if (taps.down.size === 1 && !taps.spoiled && this._fingers.has(event.pointerId) && this._longPressHere(target)) {
      const timer = setTimeout(() => this._longPressFire(), LONG_PRESS_MS);
      this._longPress = { pointerId: event.pointerId, x: point.x, y: point.y, target, timer };
    }
  }

  /** Dove il tocco lungo vale: sulla lavagna e sulle schede, non sui controlli né dentro la scheda in cui si scrive. */
  _longPressHere(target: Element | null): boolean {
    if (!target || !this._viewport.contains(target) || target.closest(FINGER_CONTROLS)) return false;
    if (this._resize !== null || this._connect !== null) return false;
    return !(this._activeId !== null && this._insideActive(target, false));
  }

  /**
   * Un dito si muove: oltre `TAP_SLOP_PX` dal suo appoggio non è più un tocco
   * né un tocco lungo (due dita che si muovono sono un pizzico). Solo un
   * confronto di distanza per evento.
   */
  _gestureMove(event: PointerEvent): void {
    const taps = this._fingerTap;
    if (!taps || (taps.spoiled && this._longPress === null)) return;
    const from = taps.down.get(event.pointerId);
    if (!from || Math.hypot(event.clientX - from.x, event.clientY - from.y) <= TAP_SLOP_PX) return;
    taps.spoiled = true;
    if (this._longPress?.pointerId === event.pointerId) this._cancelLongPress();
  }

  /** Il tocco lungo che aspetta si ferma, col suo timer. */
  _cancelLongPress(): void {
    const press = this._longPress;
    if (!press) return;
    this._longPress = null;
    clearTimeout(press.timer);
  }

  /**
   * Il dito è rimasto fermo `LONG_PRESS_MS`: sopra una scheda il suo menu
   * (lo stesso del tasto destro, nel punto del dito), altrove il menu
   * radiale, che segue il dito finché non si alza. Il gesto del dito si
   * ferma dov'era. La penna giù, o il dito diventato palmo, vincono.
   */
  _longPressFire(): void {
    const press = this._longPress;
    this._longPress = null;
    if (!press || this._destroyed || !this._doc) return;
    if (this._penDown || this._palm(press.pointerId) || !this._fingers.has(press.pointerId)) return;
    this._lastTap = null;
    this._cancelGestures();
    this._menuHeld = press.pointerId;
    const target = press.target;
    if (target?.isConnected && this._nodeAt(target) !== null) {
      const menu = new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, composed: true, clientX: press.x, clientY: press.y, button: 2,
      });
      this._ownMenu = menu;
      try {
        target.dispatchEvent(menu);
      } finally {
        this._ownMenu = null;
      }
      return;
    }
    this._openRadial(press.x, press.y, { pointerType: "touch", pointerId: press.pointerId });
  }

  /**
   * Un dito si alza (o si perde: `cancelled`). Quando si è alzato l'ultimo:
   * due dita che non si sono mosse, entro `FINGERS_TAP_MS` dal primo
   * appoggio, annullano; tre ripetono. Un dito solo nel vuoto, due volte
   * vicino e presto, mette lì una scheda di testo già in scrittura.
   */
  _gestureUp(event: PointerEvent, cancelled: boolean): void {
    if (this._longPress?.pointerId === event.pointerId) this._cancelLongPress();
    const taps = this._fingerTap;
    if (!taps || !taps.down.has(event.pointerId)) return;
    if (cancelled || this._penDown) taps.spoiled = true;
    taps.down.delete(event.pointerId);
    if (taps.down.size > 0) return;
    this._fingerTap = null;
    const ms = event.timeStamp - taps.start;
    if (taps.spoiled || taps.most > 3) {
      this._lastTap = null;
      return;
    }
    if (taps.most >= 2) {
      this._lastTap = null;
      if (ms <= FINGERS_TAP_MS) this._fingersTapped(taps.most === 2 ? "undo" : "redo");
      return;
    }
    if (ms > TAP_MAX_MS || !this._emptyAt(taps.target)) {
      this._lastTap = null;
      return;
    }
    const last = this._lastTap;
    if (last && taps.start - last.at <= DOUBLE_TAP_MS && Math.hypot(taps.first.x - last.x, taps.first.y - last.y) <= DOUBLE_TAP_PX) {
      this._lastTap = null;
      this._placeText(taps.first.x, taps.first.y, undefined, true);
      return;
    }
    this._lastTap = { x: taps.first.x, y: taps.first.y, at: event.timeStamp };
  }

  /** Il vuoto della lavagna sotto `target`: niente schede, fili, maniglie o controlli, e la lavagna si cambia. */
  _emptyAt(target: Element | null): boolean {
    if (!target?.isConnected || !this._viewport.contains(target) || this._readOnly || this._isSceneOversized()) return false;
    return this._emptyTarget(target);
  }

  /** `target` non è una scheda, un filo, una maniglia né un controllo: la regola del doppio tocco e del doppio clic. */
  _emptyTarget(target: Element): boolean {
    return this._nodeAt(target) === null && this._edgeAt(target) === null
      && target.closest(FINGER_CONTROLS) === null && target.closest(FINGER_HANDLES) === null;
  }

  /** Il tocco di due dita annulla, quello di tre ripete; se non c'è niente, lo dice. */
  _fingersTapped(command: "undo" | "redo"): void {
    const can = !this._readOnly && (command === "undo" ? this._undo.length > 0 || this._pending !== null : this._redo.length > 0);
    if (!can) {
      this._sayGesture(t(command === "undo" ? "canvas.gesture.no_undo" : "canvas.gesture.no_redo"));
      return;
    }
    if (command === "undo") this.undo();
    else this.redo();
    this._statusSettle();
  }

  /**
   * La regione viva della tela: dice al lettore di schermo ciò che un gesto
   * non ha fatto (T63), ciò che un commit ha cambiato e la scheda che da una
   * parte non c'è (T61). La stessa frase si ridice: uno spazio fermo in coda,
   * alterno, la fa annunciare di nuovo.
   */
  _sayGesture(text: string): void {
    if (this._destroyed) return;
    let said = this._gestureSaid;
    if (!said) {
      said = document.createElement("div");
      said.className = "sr-only canvas-gesture-said";
      said.setAttribute("role", "status");
      said.setAttribute("aria-live", "polite");
      this._root.append(said);
      this._gestureSaid = said;
    }
    this._gestureEcho = !this._gestureEcho;
    said.textContent = this._gestureEcho ? text : `${text} `;
  }

  // --- ridimensionare (T66) ---------------------------------------------------

  /**
   * Il mouse (o il dito, o la penna) giù su una maniglia: comincia il
   * ridimensionamento della sua scheda, o della scelta se è una maniglia
   * della cornice. `false` se sotto non c'è una maniglia che si possa tirare.
   */
  _resizeFromHandle(event: PointerEvent): boolean {
    if (this._readOnly || !this._doc) return false;
    const hit = this._targetOf(event);
    const target = hit instanceof Element ? hit : null;
    const handle = target?.closest<HTMLElement>("[data-resize], [data-resize-frame]");
    if (!handle) return false;
    const corner = cornerOf(handle.dataset.corner);
    const ids = handle.dataset.resize !== undefined ? [handle.dataset.resize] : this._resizableSelection();
    if (!this._beginResize(event, corner, ids)) return false;
    event.preventDefault();
    return true;
  }

  /**
   * Il dito giù vicino a un angolo della scheda scelta, o della cornice della
   * scelta: la presa è di 44 px sullo schermo a ogni zoom, più larga di
   * quella del mouse. Lo spazio Semplice (T65) non c'è ancora: decide il
   * tipo di puntatore.
   */
  _resizeFromFinger(event: PointerEvent): boolean {
    if (this._readOnly || !this._doc || this._isSceneOversized()) return false;
    const ids = this._resizableSelection();
    const box = this._boxOf(ids);
    if (!box) return false;
    const rect = this._viewport.getBoundingClientRect();
    const { x: camX, y: camY, zoom } = this._camera;
    let best: { corner: ResizeCorner; distance: number } | null = null;
    for (const corner of this._cornersOf(box)) {
      const east = corner === "ne" || corner === "se";
      const south = corner === "sw" || corner === "se";
      const x = rect.left + camX + (box.x + (east ? box.width : 0)) * zoom;
      const y = rect.top + camY + (box.y + (south ? box.height : 0)) * zoom;
      const distance = Math.max(Math.abs(event.clientX - x), Math.abs(event.clientY - y));
      if (distance <= RESIZE_FINGER_GRIP_PX && (!best || distance < best.distance)) best = { corner, distance };
    }
    if (!best || !this._beginResize(event, best.corner, ids)) return false;
    event.preventDefault();
    return true;
  }

  /**
   * Le schede che un doppio clic su una maniglia adatta: quelle dell'ultima
   * maniglia presa senza muoversi, o quelle della maniglia sotto `target`;
   * `null` se il doppio clic non è su una maniglia. Si usa una volta.
   */
  _takeHandleTap(target: EventTarget | null): readonly string[] | null {
    const tap = this._handleTap;
    this._handleTap = null;
    if (tap) return tap;
    const handle = target instanceof Element ? target.closest<HTMLElement>("[data-resize], [data-resize-frame]") : null;
    if (!handle) return null;
    return handle.dataset.resize !== undefined ? [handle.dataset.resize] : this._resizableSelection();
  }

  /** Le schede scelte che il documento ha. */
  _resizableSelection(): string[] {
    const doc = this._doc;
    if (!doc) return [];
    // Un insieme, non una ricerca per ogni scelta: il rettangolo (N6 T20b) lo rifà a ogni fotogramma.
    const present = new Set(doc.nodes.map((node) => node.id));
    return this._selection.filter((id) => present.has(id));
  }

  /** Il rettangolo attorno alle schede `ids` del documento di adesso. */
  _boxOf(ids: readonly string[]): ResizeBox | null {
    const doc = this._doc;
    if (!doc) return null;
    const wanted = new Set(ids);
    return boxAround(doc.nodes.filter((node) => wanted.has(node.id)));
  }

  /** Le maniglie che una cornice mostra a questo zoom: troppo piccola, solo quella in basso a destra. */
  _cornersOf(box: ResizeBox): readonly ResizeCorner[] {
    return tinyOnScreen(box, this._camera.zoom) ? ["se"] : RESIZE_CORNERS;
  }

  _beginResize(event: PointerEvent, corner: ResizeCorner, ids: readonly string[]): boolean {
    const doc = this._doc;
    if (!doc) return false;
    const origin = new Map<string, ResizeBox>();
    for (const id of ids) {
      const node = doc.nodes.find((entry) => entry.id === id);
      if (node) origin.set(id, { x: node.x, y: node.y, width: node.width, height: node.height });
    }
    const box = boxAround([...origin.values()]);
    if (!box) return false;
    this._resize = { pointerId: event.pointerId, corner, startX: event.clientX, startY: event.clientY, box, origin, moved: false };
    this._viewport.setPointerCapture?.(event.pointerId);
    return true;
  }

  /**
   * Il puntatore che tira una maniglia: Maiusc tiene le proporzioni, Alt
   * tiene fermo il centro, tutti e due insieme. Una scheda sola ha
   * l'aggancio di 8 px (A-23); la scelta scala tutto, posizioni comprese,
   * senza che una scheda scenda sotto il minimo. L'inchiostro attaccato sta
   * nella scheda e la segue nella resa (N4).
   */
  _moveResize(event: PointerAt): void {
    const resize = this._resize;
    const doc = this._doc;
    if (!resize || !doc) return;
    // Un clic sulla maniglia (o il primo dei due del doppio clic) non cambia
    // la scheda: senza questo l'aggancio la porterebbe subito sulla griglia.
    if (Math.abs(event.clientX - resize.startX) + Math.abs(event.clientY - resize.startY) > 3) resize.moved = true;
    if (!resize.moved) return;
    const dx = (event.clientX - resize.startX) / this._camera.zoom;
    const dy = (event.clientY - resize.startY) / this._camera.zoom;
    const single = resize.origin.size === 1;
    const starts = [...resize.origin.values()];
    const narrowest = Math.max(1, Math.min(...starts.map((start) => start.width)));
    const shortest = Math.max(1, Math.min(...starts.map((start) => start.height)));
    const minWidth = single ? CANVAS_MIN_SIZE : resize.box.width * Math.min(1, CANVAS_MIN_SIZE / narrowest);
    const minHeight = single ? CANVAS_MIN_SIZE : resize.box.height * Math.min(1, CANVAS_MIN_SIZE / shortest);
    // Le guide (T71) portano il lato che tira sulle schede vicine. Solo per una
    // scheda sola, senza Alt (che spegne l'aggancio per il gesto), senza Maiusc
    // (le proporzioni) e con `canvas.snap` acceso.
    const aligning = single && this._snapSetting && !event.altKey && !event.shiftKey;
    let guided = { x: false, y: false };
    let ddx = dx;
    let ddy = dy;
    if (aligning) {
      const east = resize.corner === "ne" || resize.corner === "se";
      const south = resize.corner === "se" || resize.corner === "sw";
      const free = resizeBox(resize.box, resize.corner, dx, dy, { keepRatio: false, fromCenter: false, snap: false, minWidth, minHeight });
      const guide = snapGuides({
        moving: free,
        others: this._snapTargets(resize.origin),
        threshold: GUIDE_SCREEN_PX / this._camera.zoom,
        sides: { x: [east ? "end" : "start"], y: [south ? "end" : "start"] },
      });
      this._showGuides(guide.segments);
      ddx = dx + guide.dx;
      ddy = dy + guide.dy;
      guided = { x: guide.guidedX, y: guide.guidedY };
    } else {
      this._hideGuides();
    }
    const box = resizeBox(resize.box, resize.corner, ddx, ddy, {
      keepRatio: event.shiftKey,
      fromCenter: event.altKey,
      snap: single && this._snapSetting && !event.altKey,
      step: this._snapStep,
      guided,
      minWidth,
      minHeight,
    });
    for (const [id, start] of resize.origin) {
      const node = doc.nodes.find((entry) => entry.id === id);
      if (!node) continue;
      const next = single ? box : scaleInto(start, resize.box, box, CANVAS_MIN_SIZE);
      node.x = next.x;
      node.y = next.y;
      node.width = next.width;
      node.height = next.height;
    }
    this._renderLive();
  }

  /**
   * La cornice della scelta: con due schede scelte o più, attorno a tutte,
   * con le sue quattro maniglie che scalano tutto; le maniglie delle schede
   * allora si nascondono (`data-selection="many"`). In sola lettura niente.
   */
  _syncSelectionFrame(): void {
    const ids = !this._readOnly && !this._isSceneOversized() ? this._resizableSelection() : [];
    const box = ids.length >= 2 ? this._boxOf(ids) : null;
    // Scrivere lo stesso valore non deve rifare lo stile delle maniglie di ogni
    // scheda: la regola `[data-selection="many"] > .canvas-node` le legge tutte (N6 T20b).
    if (box) {
      if (this._stage.dataset.selection !== "many") this._stage.dataset.selection = "many";
    } else if (this._stage.dataset.selection !== undefined) {
      delete this._stage.dataset.selection;
    }
    if (!box) {
      this._selectionFrame?.remove();
      return;
    }
    let frame = this._selectionFrame;
    if (!frame) {
      frame = document.createElement("div");
      frame.className = "canvas-selection-frame";
      frame.setAttribute("aria-hidden", "true");
      for (const corner of RESIZE_CORNERS) frame.append(resizeHandle(corner, null));
      this._selectionFrame = frame;
    }
    frame.style.transform = `translate(${box.x}px, ${box.y}px)`;
    frame.style.width = `${box.width}px`;
    frame.style.height = `${box.height}px`;
    markHandles(frame, box, this._camera.zoom);
    // Sopra le schede e l'inchiostro libero: le sue maniglie si prendono.
    if (frame.parentElement !== this._stage || frame.nextSibling) this._stage.append(frame);
  }

  /** Lo zoom è cambiato: le schede (e la cornice) troppo piccole tengono solo una maniglia. */
  _markAllHandles(): void {
    const zoom = this._camera.zoom;
    if (zoom === this._handlesZoom) return;
    this._handlesZoom = zoom;
    for (const entry of this._cards.values()) markHandles(entry.article, entry.node, zoom);
    const frame = this._selectionFrame;
    const box = frame?.isConnected ? this._boxOf(this._resizableSelection()) : null;
    if (frame && box) markHandles(frame, box, zoom);
  }

  /**
   * Il doppio clic su una maniglia: ogni scheda `ids` prende la misura del
   * suo contenuto, in un commit e un annulla. Una scheda di testo la misura
   * del suo testo, fino a `CANVAS_TEXT_FIT_MAX_WIDTH` di larghezza;
   * un'immagine o un PDF le proporzioni del contenuto alla larghezza di
   * adesso; le altre non cambiano. L'angolo in alto a sinistra resta.
   */
  _fitToContent(ids: readonly string[]): void {
    const doc = this._doc;
    if (!doc || this._readOnly || this._isSceneOversized()) return;
    const ops: CanvasIntentOp[] = [];
    for (const id of ids) {
      const node = doc.nodes.find((entry) => entry.id === id);
      const entry = this._cards.get(id);
      if (!node || !entry) continue;
      const size = this._contentSize(entry, node);
      // La misura del contenuto è di nuovo quella che la scheda prende da sé (T44).
      if (size) this._sizedByHand.delete(id);
      if (!size || (size.width === node.width && size.height === node.height)) continue;
      // La misura la prende la tela dal DOM (il testo come si vede, il corpo
      // senza testata): il nucleo la scrive con `resize` (T24).
      ops.push({ op: "resize", id, width: Math.round(size.width), height: Math.round(size.height) });
    }
    this._writeOps(ops);
  }

  /** La misura del contenuto della scheda `node`; `null` se non c'è o non si sa. */
  _contentSize(entry: CardEntry, node: CanvasNode): { width: number; height: number } | null {
    if (node.type === "text") {
      // Col campo aperto il testo è nel campo, che non ha una misura sua.
      if (this._editor?.id === node.id) return null;
      const measured = measureText(entry.article, entry.body);
      return measured && { width: Math.max(CANVAS_MIN_SIZE, measured.width), height: Math.max(CANVAS_MIN_SIZE, measured.height) };
    }
    if (node.type !== "file" || typeof node.file !== "string") return null;
    const media = mediaKindOfId(node.file);
    if (media !== "image" && media !== "pdf") return null;
    const natural = naturalSize(entry.body);
    if (!natural) return null;
    // Il riquadro del contenuto: il corpo senza il suo margine interno; il
    // resto della scheda (la testata) resta com'è. Senza misure (prima della
    // prima impaginazione) il contenuto è tutta la scheda.
    const style = getComputedStyle(entry.body);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const innerWidth = entry.body.clientWidth - padX;
    const innerHeight = entry.body.clientHeight - padY;
    const known = innerWidth > 0 && innerHeight > 0;
    const width = known ? innerWidth : node.width;
    const rest = known ? node.height - innerHeight : 0;
    return { width: node.width, height: Math.max(CANVAS_MIN_SIZE, Math.round(rest + width * natural.height / natural.width)) };
  }

  _pointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch" && this._touchMove(event)) return;
    if (this._lasso && event.pointerId === this._lasso.pointerId) {
      this._moveLasso(event);
      return;
    }
    if (this._marquee && event.pointerId === this._marquee.pointerId) {
      this._moveMarquee(event);
      return;
    }
    if (this._strokeDrag && event.pointerId === this._strokeDrag.pointerId) {
      this._moveStrokeDrag(event);
      return;
    }
    if (this._connect && event.pointerId === this._connect.pointerId) {
      this._moveConnect(event.clientX, event.clientY);
      // Vicino al bordo la vista scorre da sola (T53).
      if (this._connect.moved) this._trackEdge(event);
      return;
    }
    if (!this._pan && !this._resize && !this._drag && event.pointerType === "mouse") {
      // Sotto il velo della croce (T20d) il mouse scrive: nessun filo si
      // scurisce, e nessuna ricerca a ogni movimento del tratto.
      if (event.target === this._penVeil) this._setEdgeHover(null);
      else this._hoverEdge(event.clientX, event.clientY, event.target);
    }
    if (this._pan && event.pointerId === this._pan.pointerId) {
      this._camera.x = this._pan.camX + (event.clientX - this._pan.startX);
      this._camera.y = this._pan.camY + (event.clientY - this._pan.startY);
      // La scia del dito, per l'inerzia del rilascio (T53).
      if (event.pointerType === "touch") {
        const trail = this._pan.trail ??= [];
        trail.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
        while (trail.length > 1 && event.timeStamp - trail[0]!.t > INERTIA_WINDOW_MS) trail.shift();
      }
      this._applyCamera();
      return;
    }
    if (this._resize && event.pointerId === this._resize.pointerId && this._doc) {
      this._moveResize(event);
      if (this._resize.moved) this._trackEdge(event);
      return;
    }
    if (this._drag && event.pointerId === this._drag.pointerId && this._doc) {
      this._moveDrag(event);
      if (this._drag.moved) this._trackEdge(event);
    }
  }

  /** Le schede che si trascinano seguono il puntatore `at`. */
  _moveDrag(at: PointerAt): void {
    const drag = this._drag;
    const doc = this._doc;
    if (!drag || !doc) return;
    const dx = (at.clientX - drag.startX) / this._camera.zoom;
    const dy = (at.clientY - drag.startY) / this._camera.zoom;
    if (!drag.moved && Math.abs(at.clientX - drag.startX) + Math.abs(at.clientY - drag.startY) > 3) {
      drag.moved = true;
      // Lo spostamento prende il puntatore adesso: così non lo perde se esce dalla vista.
      this._viewport.setPointerCapture?.(drag.pointerId);
    }
    const byId = new Map(doc.nodes.map((node) => [node.id, node] as const));
    // Le schede seguono il puntatore 1:1, in unità intere (#411 C-05): niente
    // salti sotto la mano. L'aggancio è la mira, che vale al rilascio
    // (`_settleDrag`): le guide (T71), che si vedono già, vincono sulla
    // griglia di `canvas.snap_step`, su ogni asse. Alt tenuto, o `canvas.snap`
    // spento: la mira è dove sta la scheda. Lo spostamento è uno per tutte
    // (una `move`, T24): la griglia aggancia l'angolo in alto a sinistra del
    // loro riquadro, come le guide, e le schede tengono le loro distanze.
    const free = at.altKey || !this._snapSetting;
    const guide = drag.moved && !free ? this._dragGuide(drag.origin, byId, dx, dy) : null;
    if (guide === null) this._hideGuides();
    let left = Infinity;
    let top = Infinity;
    for (const origin of drag.origin.values()) {
      left = Math.min(left, origin.x);
      top = Math.min(top, origin.y);
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    const step = this._snapStep;
    const along = (start: number, delta: number, guided: boolean, pull: number): number =>
      free || (!guided && step === null) ? Math.round(delta)
        : guided ? Math.round(delta + pull) : snapTo(start + delta, step!) - start;
    drag.dx = Math.round(dx);
    drag.dy = Math.round(dy);
    drag.aimDx = along(left, dx, guide?.guidedX ?? false, guide?.dx ?? 0);
    drag.aimDy = along(top, dy, guide?.guidedY ?? false, guide?.dy ?? 0);
    for (const [id, origin] of drag.origin) {
      const node = byId.get(id);
      if (!node) continue;
      node.x = origin.x + drag.dx;
      node.y = origin.y + drag.dy;
    }
    this._renderLive();
  }

  /**
   * Il rilascio di uno spostamento agganciato (#411 C-05): le schede vanno
   * dalla posizione sotto il puntatore a quella della mira, scivolando in
   * `SETTLE_MS` (col movimento ridotto subito). Lo stato e i fili sono subito
   * quelli finali: la scivolata è solo dell'aspetto della scheda.
   */
  _settleDrag(drag: CardDrag): void {
    const fromDx = drag.dx;
    const fromDy = drag.dy;
    if (drag.aimDx === fromDx && drag.aimDy === fromDy) return;
    drag.dx = drag.aimDx;
    drag.dy = drag.aimDy;
    const byId = new Map((this._doc?.nodes ?? []).map((node) => [node.id, node] as const));
    for (const [id, origin] of drag.origin) {
      const node = byId.get(id);
      if (!node) continue;
      node.x = origin.x + drag.dx;
      node.y = origin.y + drag.dy;
    }
    this._renderLive();
    if (this._reducedMotion) return;
    for (const [id, origin] of drag.origin) {
      const article = this._cards.get(id)?.article;
      if (typeof article?.animate !== "function") continue;
      article.animate(
        [
          { transform: `translate(${origin.x + fromDx}px, ${origin.y + fromDy}px)` },
          { transform: `translate(${origin.x + drag.dx}px, ${origin.y + drag.dy}px)` },
        ],
        { duration: SETTLE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    }
  }

  /**
   * Le guide di uno spostamento: il riquadro delle schede trascinate nella
   * posizione libera, con le schede in vista che restano. Mostra i segmenti
   * che vincono e dà lo spostamento; `null` se non c'è nulla da portare.
   */
  _dragGuide(
    origin: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
    byId: ReadonlyMap<string, CanvasNode>,
    dx: number,
    dy: number,
  ): GuideResult | null {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const [id, start] of origin) {
      const node = byId.get(id);
      if (!node) continue;
      left = Math.min(left, start.x + dx);
      top = Math.min(top, start.y + dy);
      right = Math.max(right, start.x + dx + node.width);
      bottom = Math.max(bottom, start.y + dy + node.height);
    }
    if (!(left <= right)) return null;
    const guide = snapGuides({
      moving: { x: left, y: top, width: right - left, height: bottom - top },
      others: this._snapTargets(origin),
      threshold: GUIDE_SCREEN_PX / this._camera.zoom,
      sides: { x: MOVE_SIDES, y: MOVE_SIDES },
    });
    this._showGuides(guide.segments);
    return guide;
  }

  /**
   * La fine del gesto di un puntatore: il suo rilascio (`lost` falso) o una
   * chiusura senza rilascio (`lost` vero, da `_gestureLost`), per una sola
   * strada. Se chiude uno spostamento, un pizzico, un trascinamento o un
   * ridimensionamento (A-7), le schede vive si rifanno sulla vista e sulle
   * schede di adesso. Un tocco chiuso senza rilascio non conta come tocco
   * breve (`_gestureUp` lo tratta come annullato).
   */
  _gestureEnd(event: PointerEvent, lost: boolean): void {
    const moving = this._gestureMoving();
    this._pointerRelease(event);
    if (moving) this._refreshLive();
    // Dopo il tocco breve della lavagna: il doppio tocco mette la scheda
    // dopo che il primo ha tolto la scelta (T63).
    if (event.pointerType === "touch") this._gestureUp(event, lost);
    // A fine gesto (e dopo ogni tasto) la banda di stato si rilegge: dentro un
    // gesto `_statusSettle` non dice niente.
    this._statusSettle();
  }

  _pointerRelease(event: PointerEvent): void {
    // Il rilascio ferma lo scorrimento al bordo, anche fuori dalla finestra (T53).
    if (this._edgeScroll?.pointerId === event.pointerId) this._stopEdgeScroll();
    if (event.pointerType === "touch" && this._touchUp(event)) return;
    if (this._pan && event.pointerId === this._pan.pointerId) {
      const pan = this._pan;
      this._pan = null;
      // Il dito lasciato in corsa: la vista va avanti da sola (T53).
      if (event.pointerType === "touch" && pan.trail) {
        const speed = this._panSpeed(pan.trail, { t: event.timeStamp, x: event.clientX, y: event.clientY });
        this._fling(speed.vx, speed.vy);
      }
      // Ctrl+clic fermo su una scheda: la aggiunge alla scelta, o la toglie.
      if (pan.toggle !== undefined
        && Math.abs(event.clientX - pan.startX) + Math.abs(event.clientY - pan.startY) <= 3) {
        this._camera.x = pan.camX;
        this._camera.y = pan.camY;
        this._applyCamera();
        this._selectNode(pan.toggle, true);
      }
      return;
    }
    if (this._lasso && event.pointerId === this._lasso.pointerId) {
      this._endLasso();
      return;
    }
    if (this._marquee && event.pointerId === this._marquee.pointerId) {
      this._endMarquee();
      return;
    }
    if (this._strokeDrag && event.pointerId === this._strokeDrag.pointerId) {
      this._endStrokeDrag();
      return;
    }
    if (this._resize && event.pointerId === this._resize.pointerId && this._doc) {
      const resize = this._resize;
      this._resize = null;
      this._hideGuides();
      this._handleTap = resize.moved ? null : [...resize.origin.keys()];
      // La misura l'ha scelta chi usa: scrivendo la scheda non si allarga più (T44).
      if (resize.moved) for (const id of resize.origin.keys()) this._sizedByHand.add(id);
      this._writeGesture(resize.moved ? this._resizeOps(resize.origin) : null);
      return;
    }
    if (this._drag && event.pointerId === this._drag.pointerId) {
      const drag = this._drag;
      this._drag = null;
      this._hideGuides();
      // Una scheda spostata dal corpo non ci entra col clic che segue il rilascio.
      if (drag.moved) this._pressedSelected = null;
      // L'aggancio vale qui (#411 C-05), se Alt non è tenuto al rilascio.
      if (drag.moved && !event.altKey && this._snapSetting) this._settleDrag(drag);
      if (drag.moved) this._writeGesture(this._dragOps(drag));
      return;
    }
    if (this._connect && event.pointerId === this._connect.pointerId) {
      const connect = this._connect;
      this._endConnect();
      // Il filo di «Collega…» fatto, la colonna torna alla Selezione.
      if (connect.back) this._pickTool("select");
      // Nel vuoto nasce una scheda già in scrittura: la disegna `_placeText`.
      if (this._finishConnect(connect, event.clientX, event.clientY)) return;
      this._render();
    }
  }

  _cancelGestures(): void {
    const active = this._drag !== null || this._resize !== null || this._strokeDrag !== null;
    const moving = this._gestureMoving();
    this._drag = null;
    this._resize = null;
    // Il lazo fermato non sceglie; lo spostamento fermato rimette i tratti.
    const strokeDrag = this._strokeDrag;
    this._strokeDrag = null;
    if (strokeDrag) {
      this._hideStrokeHolder();
      this._fadeUnits(strokeDrag.units, false);
    }
    if (this._lasso || strokeDrag) {
      this._lasso = null;
      this._paintLasso();
    }
    // Il rettangolo fermato lascia la scelta com'è (N6 T20b): un documento nuovo la
    // rifà da sé, e un puntatore annullato non la tocca.
    if (this._marquee !== null) this._stopMarquee();
    this._hideGuides();
    this._pan = null;
    this._endConnect();
    this._stopEdgeScroll();
    this._fingers.clear();
    this._tap = null;
    this._pinch = null;
    // Neanche il tocco lungo e il tocco di più dita (T63) sono più un gesto.
    this._cancelLongPress();
    if (this._fingerTap) this._fingerTap.spoiled = true;
    // Il gesto aveva mosso il modello in mano: torna quello del nucleo.
    const model = active && this._doc ? this._coreModel() : null;
    if (model) {
      this._doc = model;
      this._render();
    }
    // Un gesto fermato (la penna che si posa sotto il dito, un pointercancel)
    // è un gesto finito: la vista è quella dove si è fermato. Con la penna
    // giù il cambio aspetta che si alzi.
    if (moving) this._refreshLive();
    this._statusSettle();
  }

  /**
   * La fine di un gesto che ha mosso il modello in mano (un trascinamento, un
   * ridimensionamento): il modello torna quello del nucleo, poi le operazioni
   * del gesto vanno nel file in un passo d'annulla (T24). Senza operazioni, o
   * se il nucleo le rifiuta, la lavagna si ridisegna com'era.
   */
  _writeGesture(ops: readonly CanvasIntentOp[] | null): void {
    const model = this._coreModel();
    if (model) this._doc = model;
    if (this._writeOps(ops) === null && !this._destroyed) this._render();
  }

  /**
   * La `move` di un trascinamento (T24): le schede scelte dello spostamento
   * del gesto; un gruppo porta le schede che ci stanno dentro (`contents`,
   * T10), come le ha portate la vista. Oltre `MOVE_CONTENTS_MAX` schede
   * portate il nucleo rifiuta `contents`: allora la `move` dice tutte le
   * schede che la vista ha portato, una per una. `null` se non si è mosso
   * niente.
   */
  _dragOps(drag: CardDrag): CanvasIntentOp[] | null {
    if (drag.ids.length === 0 || (drag.dx === 0 && drag.dy === 0)) return null;
    const groups = drag.ids.some((id) => this._doc?.nodes.find((node) => node.id === id)?.type === "group");
    if (groups && drag.origin.size > MOVE_CONTENTS_MAX) {
      return [{ op: "move", ids: [...drag.origin.keys()], dx: drag.dx, dy: drag.dy }];
    }
    return [{ op: "move", ids: [...drag.ids], dx: drag.dx, dy: drag.dy, ...(groups ? { contents: true } : {}) }];
  }

  /**
   * Le operazioni di un ridimensionamento (T24), scheda per scheda: una
   * `move` se l'angolo in alto a sinistra è cambiato (le maniglie a sinistra o
   * in alto, Alt, la scelta che scala), una `resize` con le misure del gesto se
   * è cambiata la misura. Le misure sono già in unità intere della lavagna, a
   * ogni zoom. `null` se niente è cambiato.
   */
  _resizeOps(origin: ReadonlyMap<string, ResizeBox>): CanvasIntentOp[] | null {
    const doc = this._doc;
    if (!doc) return null;
    const ops: CanvasIntentOp[] = [];
    for (const [id, start] of origin) {
      const node = doc.nodes.find((entry) => entry.id === id);
      if (!node) continue;
      if (node.x !== start.x || node.y !== start.y) ops.push({ op: "move", ids: [id], dx: node.x - start.x, dy: node.y - start.y });
      if (node.width !== start.width || node.height !== start.height) {
        ops.push({ op: "resize", id, width: node.width, height: node.height });
      }
    }
    return ops.length > 0 ? ops : null;
  }

  _dblclick(event: MouseEvent): void {
    const target = this._targetOf(event);
    if (this._readOnly || this._nodeAt(target)) return;
    // Su una maniglia della cornice della scelta: tutte le schede scelte
    // prendono la misura del loro contenuto (T66). Con la cattura del
    // puntatore il doppio clic su una maniglia arriva qui.
    const tap = this._takeHandleTap(target);
    if (tap) {
      this._fitToContent(tap);
      return;
    }
    // Il doppio tocco del dito mette la sua scheda da sé (T63): il `dblclick`
    // che il browser ne fa non ne mette un'altra.
    if (this._downByTouch) return;
    // Il doppio clic su una porta, su un filo o su un controllo non mette
    // niente, come il doppio tocco (IMP-053). Conta ciò che è sotto il punto del
    // clic, non il bersaglio: con la cattura del puntatore (il filo che parte da
    // una porta) il `dblclick` arriva alla vista, ma la porta è lì sotto.
    const under = this._elementAt(event.clientX, event.clientY);
    const at = under !== null && this._viewport.contains(under) ? under : target;
    if (!(at instanceof Element) || !this._emptyTarget(at)) return;
    // Nel punto del clic, già in scrittura, come il doppio tocco (T63, T100).
    this._placeText(event.clientX, event.clientY);
  }

  // --- render -------------------------------------------------------------------

  _renderLive(): void {
    // Drag/resize updates moved nodes and connected edges without replacing cards.
    const moved = this._drag?.origin.keys() ?? this._strokeDrag?.origin.keys() ?? this._resize?.origin.keys() ?? this._selection.values();
    for (const id of moved) {
      const node = this._doc?.nodes.find((n) => n.id === id);
      const el = this._stage.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`);
      if (node && el) {
        el.style.transform = `translate(${node.x}px, ${node.y}px)`;
        el.style.width = `${node.width}px`;
        el.style.height = `${this._shownHeight(node)}px`;
        markHandles(el, node, this._camera.zoom);
        // L'avviso dei tratti sul testo si vede già mentre si tira il bordo.
        syncInkReflow(el, inkReflowWidth(node, this._inkCards.get(id) ?? []), !this._readOnly);
      }
    }
    this._drawEdges();
    this._syncSelectionFrame();
  }

  _render(): void {
    this._syncEmpty();
    this._syncPartsPicker();
    this._syncReader();
    this._syncCrop();
    // Dopo `destroy` niente rinasce: una vista montata qui non avrebbe padrone.
    if (!this._doc || this._destroyed) return;
    this._syncInkLayer();
    this._applyCamera();
    this._drawToolbar();
    this._viewport.dataset.canvasNodes = String(this._doc.nodes.length);
    this._viewport.dataset.canvasEdges = String(this._doc.edges.length);
    if (this._isSceneOversized()) {
      this._dropCards();
      this._edgeLayer.replaceChildren();
      this._handleLayer.replaceChildren();
      // Il livello dei fili resta il primo figlio dello stage (T91).
      this._stage.replaceChildren(this._edgeLayer);
      delete this._stage.dataset.selection;
      const fallback = document.createElement("p");
      fallback.className = "canvas-large-fallback";
      fallback.textContent = t("canvas.too_large");
      this._stage.append(fallback);
      this._viewport.dataset.canvasProtocol = "source-fallback";
      // L'inchiostro si vede dove si vedono le schede (A8).
      this._inkCards = new Map();
      this._inkBoard = [];
      this._inkPaths.clear();
      return;
    }
    this._drawEdges();
    this._placeCards(this._doc.nodes);
    this._scheduleLabels();
    // La ricerca aperta si rifà col documento di adesso; una scheda nata ora
    // prende il suo segno (T60).
    this._findBar.refresh();
    applyFindMarks(this._cards, this._findMarkOf);
    this._paintInk();
    this._syncSelectionFrame();
    this._viewport.dataset.canvasProtocol = "source";
    this._refreshLive();
  }

  // --- le schede vive ---------------------------------------------------------

  /**
   * Un gesto che muove la vista o le schede: il puntatore è ancora giù. Il
   * rettangolo della Selezione conta da quando si è mosso: finché è un clic, non è
   * ancora un gesto (N6 T20b).
   */
  _gestureMoving(): boolean {
    return this._drag !== null || this._resize !== null || this._pan !== null || this._pinch !== null
      || this._lasso !== null || this._strokeDrag !== null || this._marquee?.moved === true;
  }

  /**
   * Un gesto sulle schede o sui tratti (spostare, ridimensionare, il
   * rettangolo, il lazo): la barra della selezione si toglie. La camera che
   * si muove (lo zoom, lo spostamento della vista, il volo) non lo è: la barra
   * la segue (#411 C-06).
   */
  _cardGestureActive(): boolean {
    return this._drag !== null || this._resize !== null || this._lasso !== null
      || this._strokeDrag !== null || this._marquee?.moved === true;
  }

  /** Un gesto in corso, rotella, volo e inerzia compresi (T53): nessuna scheda cambia modo. */
  _gestureActive(): boolean {
    // Il riquadro del navigatore trascinato è un gesto anche lui (T55).
    return this._gestureMoving() || this._wheelTimer !== undefined || this._motion !== null || this._navigator.dragging();
  }

  /**
   * La lavagna si vede: è nel documento, nessun antenato è `hidden` (la
   * linguetta di un altro riquadro) e, dove il browser lo sa dire, niente la
   * toglie dalla pagina (`display: none`).
   */
  _isShown(): boolean {
    const viewport = this._viewport;
    if (!viewport.isConnected || viewport.closest("[hidden]") !== null) return false;
    return typeof viewport.checkVisibility === "function" ? viewport.checkVisibility() : true;
  }

  /**
   * Sceglie le schede vive con la vista di adesso, in coordinate della
   * lavagna, e lo zoom (`liveCardIds`), poi cambia il modo a chi lo deve
   * cambiare (`updateLiveCards`, nel silenzio della penna: con la penna giù
   * aspetta che si alzi). Non fa niente a gesto in corso (lo rifà la fine del
   * gesto) e con la lavagna nascosta (lo rifà la vista che torna e cambia
   * misura): le schede restano come sono.
   */
  _refreshLive(): void {
    const doc = this._doc;
    if (this._destroyed || !doc) return;
    if (this._gestureActive() || !this._isShown()) return;
    const { view, zoom } = this._viewRect();
    this._askCitations(doc.nodes);
    if (this._views.size === 0) {
      this._refreshDetail(zoom);
      return;
    }
    // Contano solo le schede con una vista: una specie senza renderer non
    // toglie posto a quelle che si accendono.
    const nodes = doc.nodes.filter((node) => this._views.has(node.id));
    // La scheda attiva che esce dalla vista (non da quella allargata) ne esce.
    const active = this._activeId;
    if (active !== null) {
      const node = nodes.find((candidate) => candidate.id === active);
      // Quella che scrive resta finché si scrive (T41).
      if (!node || (!overlaps(node, view) && this._writingId !== active)) this._leaveCard(true, false);
    }
    // La scheda attiva, e quella in cui si sta entrando, restano vive anche
    // se la regola le spegnerebbe (lo zoom, il limite).
    const wanted = liveCardIds(nodes, view, zoom);
    // E quella col ritaglio aperto (T78): l'immagine intera si legge viva.
    for (const id of [this._activeId, this._enteringId, this._crop?.node ?? null]) {
      if (id !== null && this._views.has(id)) wanted.add(id);
    }
    // Prima che le vive si spengano: chi è vivo adesso conta come visto.
    this._refreshDetail(zoom);
    updateLiveCards(this._views, wanted, this._liveModes, this._cardQuiet);
  }

  /**
   * Il livello di dettaglio di ogni scheda allo zoom `zoom` (T54, A-22), a
   * gesto finito: lo chiama solo `_refreshLive`. Un solo giro sulle schede,
   * che scrive `data-card-detail` solo dove cambia, e la misura del titolo
   * grande (`--canvas-detail-zoom`) una volta sulla scena. La scheda attiva,
   * quella in cui si entra, quella che scrive e quella col campo aperto
   * restano come da vicino.
   */
  _refreshDetail(zoom: number): void {
    for (const [id, mode] of this._liveModes) {
      if (mode === "live") this._seenLive.add(id);
    }
    const level = detailLevel(zoom);
    const kept = new Set<string>();
    for (const id of [this._activeId, this._enteringId, this._writingId, this._editor?.id ?? null]) {
      if (id !== null) kept.add(id);
    }
    const seen = this._seenLive;
    applyCardDetails(this._cards, (id) => cardDetail(level, seen.has(id), kept.has(id)));
    const scale = String(zoom);
    if (this._stage.style.getPropertyValue("--canvas-detail-zoom") !== scale) {
      this._stage.style.setProperty("--canvas-detail-zoom", scale);
    }
  }

  /**
   * La vista di adesso in coordinate della lavagna, e lo zoom. Senza misura
   * (happy-dom, una vista non ancora disposta) vale quella di riserva di
   * `_fitCamera`: la camera è fatta su quella.
   */
  _viewRect(): { readonly view: Rect; readonly zoom: number } {
    return { view: this._viewRectOf(this._camera), zoom: this._camera.zoom };
  }

  /** La vista in coordinate della lavagna con la camera `camera`, con la misura di riserva di `_viewRect`. */
  _viewRectOf(camera: Viewport): Rect {
    const rect = this._viewport.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 600;
    const { x, y, zoom } = camera;
    return { x: -x / zoom, y: -y / zoom, width: width / zoom, height: height / zoom };
  }

  // --- entrare e uscire (T14) ---------------------------------------------------

  /** La scheda ha la vista di un renderer, e non è il segnaposto di un file mancante. */
  _hasLiveContent(entry: CardEntry): boolean {
    return entry.view !== null && entry.article.dataset.cardMissing === undefined;
  }

  /**
   * `target` sta nella scheda attiva: in tutta la scheda, o solo nel corpo
   * (`bodyOnly`), dove sta il contenuto della vista.
   */
  _insideActive(target: EventTarget | null, bodyOnly: boolean): boolean {
    const id = this._activeId;
    if (id === null || !(target instanceof Node)) return false;
    const entry = this._cards.get(id);
    if (!entry) return false;
    return (bodyOnly ? entry.body : entry.article).contains(target);
  }

  /** Il tasto arriva alla lavagna o a una scheda col fuoco, non a un campo o al contenuto. */
  _onCardOrBoard(target: EventTarget | null): boolean {
    return target === this._viewport || (target instanceof HTMLElement && target.classList.contains("canvas-node"));
  }

  /** Il link sotto `target`, se sta nel contenuto della vista di una scheda. */
  _cardLinkAt(target: EventTarget | null): HTMLAnchorElement | null {
    if (!(target instanceof Element)) return null;
    const id = this._nodeAt(target);
    const entry = id === null ? undefined : this._cards.get(id);
    if (!entry || !this._hasLiveContent(entry)) return null;
    const link = target.closest("a");
    return link !== null && entry.body.contains(link) ? link : null;
  }

  /**
   * Il clic nel contenuto di una scheda, prima che lo veda il contenuto.
   * Dentro la scheda attiva passa. Fuori, Ctrl+clic (Cmd+clic) su un link
   * passa e il link si segue (D-18 (c)); un pulsante della vista passa (il
   * suo «Apri»); ogni altro clic si ferma qui (A-12: sceglie, non segue), e
   * se la scheda era già la sola scelta prima del clic ci entra. Un link che
   * porta a un file del vault lo segue la tela (T57), non la montatura.
   */
  _cardClick(event: MouseEvent): void {
    const pressed = this._pressedSelected;
    this._pressedSelected = null;
    const target = this._targetOf(event);
    if (event.button !== 0 || !(target instanceof Element)) return;
    const id = this._nodeAt(target);
    const entry = id === null ? undefined : this._cards.get(id);
    if (!id || !entry || !this._hasLiveContent(entry) || !entry.body.contains(target)) return;
    if (this._crop?.editor?.contains(target)) return;
    const modifier = event.ctrlKey || event.metaKey;
    if ((modifier || this._activeId === id) && this._followCardLink(event, entry)) return;
    if (this._activeId === id) return;
    if (modifier && this._cardLinkAt(target) !== null) return;
    const button = target.closest("button");
    if (button !== null && entry.body.contains(button) && !modifier) return;
    event.preventDefault();
    event.stopPropagation();
    if (!modifier && !event.shiftKey && !event.altKey && pressed === id) this._enterCard(id);
  }

  // --- seguire un link (T57) ----------------------------------------------------

  /**
   * Il clic su un link di una scheda che porta a un file del vault (T57): la
   * tela lo prende (`preventDefault`, `stopPropagation`) e lo segue con
   * `_openCardLink`. `false` se il link non è di quelli (un indirizzo web, un
   * link senza `resolveCardLink`): allora vale la montatura di sempre.
   */
  _followCardLink(event: MouseEvent, entry: CardEntry): boolean {
    const target = this._targetOf(event);
    if (!this._options.resolveCardLink || !(target instanceof Element)) return false;
    const anchor = this._cardLinkAt(target);
    const link = anchor === null ? null : cardLinkOf(anchor);
    if (link === null) return false;
    event.preventDefault();
    event.stopPropagation();
    const node = entry.node;
    const from = node.type === "file" && node.file ? node.file : this._options.documentId;
    void this._openCardLink(link, from).catch((error: unknown) => this._showIntakeError(error));
    return true;
  }

  /**
   * Segue un link di una scheda (T57). Se il file a cui punta ha una scheda su
   * questa lavagna, la vista vola fino a lei e la scheda lampeggia (con
   * `_jumpCamera`, dunque Indietro torna qui). Altrimenti il file si apre
   * accanto, come il wikilink di una nota. Un link rotto va dove va quello delle
   * note: il riquadro, che per un wikilink crea la nota che manca.
   */
  async _openCardLink(link: CardLinkRef, from: string | undefined): Promise<void> {
    const resolve = this._options.resolveCardLink;
    if (!resolve) return;
    const doc = await resolve(link, from);
    // La lavagna chiusa mentre la shell risolveva: il link non porta più a niente.
    if (this._destroyed) return;
    if (doc === null) {
      if (link.kind === "wiki") await this._options.onOpenWikilink?.(link.page, link.heading, link.block);
      else await this._options.onOpenPath?.(link.path, from);
      return;
    }
    const node = linkedCardOf(this._doc?.nodes ?? [], doc, link, this._viewCenter());
    if (node) {
      this._jumpToCard(node);
      return;
    }
    if (link.kind === "wiki") await (this._options.onOpenWikilinkBeside ?? this._options.onOpenWikilink)?.(link.page, link.heading, link.block);
    else await (this._options.onOpenPathBeside ?? this._options.onOpenPath)?.(link.path, from);
  }

  /** Il centro della vista, in coordinate della lavagna: quale scheda di un file è la più vicina. */
  _viewCenter(): { x: number; y: number } {
    const rect = this._viewport.getBoundingClientRect();
    return {
      x: ((rect.width || 800) / 2 - this._camera.x) / this._camera.zoom,
      y: ((rect.height || 600) / 2 - this._camera.y) / this._camera.zoom,
    };
  }

  /**
   * Il salto a una scheda (T57): la vista la mette al centro col zoom di adesso,
   * come ogni salto (`_jumpCamera`, che lo ricorda per Indietro), e la scheda
   * lampeggia una volta.
   */
  _jumpToCard(node: CanvasNode): void {
    const rect = this._viewport.getBoundingClientRect();
    const zoom = this._camera.zoom;
    this._jumpCamera({
      x: (rect.width || 800) / 2 - (node.x + node.width / 2) * zoom,
      y: (rect.height || 600) / 2 - (node.y + node.height / 2) * zoom,
      zoom,
    });
    this._flashCard(node.id);
  }

  /**
   * Il lampo di una scheda: `data-card-flash` sulla sua `article`, che il CSS
   * anima una volta (`pulse`), o che resta fermo (`still`) col movimento ridotto.
   * Un solo lampo alla volta: un altro lo spegne. Il timer lo toglie, e la
   * distruzione della lavagna lo ferma.
   */
  _flashCard(id: string): void {
    const entry = this._cards.get(id);
    if (!entry) return;
    this._endFlash();
    const article = entry.article;
    // Via e poi di nuovo, con una lettura in mezzo: il lampo riparte da capo se
    // la stessa scheda si raggiunge due volte di fila.
    article.removeAttribute("data-card-flash");
    void article.offsetWidth;
    article.dataset.cardFlash = this._reducedMotion ? "still" : "pulse";
    this._flashing = article;
    this._flashTimer = setTimeout(() => this._endFlash(), CARD_FLASH_MS);
  }

  _endFlash(): void {
    clearTimeout(this._flashTimer);
    this._flashTimer = undefined;
    const article = this._flashing;
    if (!article) return;
    this._flashing = null;
    delete article.dataset.cardFlash;
  }

  /**
   * Il mouse giù nel contenuto di una scheda non attiva: il fuoco va alla
   * scheda, non a un link o al testo del contenuto (che fuori non prendono
   * la tastiera), e il testo non si comincia a scegliere. Un pulsante della
   * vista resta suo.
   */
  _keepContentFocus(event: PointerEvent, id: string): void {
    const target = this._targetOf(event);
    const entry = this._cards.get(id);
    if (!(target instanceof Element) || !entry || this._activeId === id || !this._hasLiveContent(entry)) return;
    if (!entry.body.contains(target)) return;
    const button = target.closest("button");
    if (button !== null && entry.body.contains(button)) return;
    event.preventDefault();
    entry.article.focus({ preventScroll: true });
  }

  /**
   * Invio, o il doppio clic su una scheda: scrive dentro se si può (T41),
   * altrimenti entra, altrimenti ciò che faceva (il campo). Una scheda di file
   * che non si mostra non apre il campo: fa l'azione che serve (T93).
   */
  _enterOrEdit(node: CanvasNode, from?: EventTarget | null): void {
    if (node.type === "file" && this._fileGesture(node, from)) return;
    if (node.type !== "text" && (this._beginWriting(node.id, from) || this._enterCard(node.id))) return;
    this._beginCardEdit(node);
  }

  /**
   * Il gesto su una scheda di file che non si mostra, al posto del campo del
   * percorso (T93): «File mancante» chiede il file come «Ritrova…» (o lo dice, in
   * sola lettura o senza un selettore); «Non riesco a mostrare» apre il file come
   * «Apri» del menu (T17); mentre carica non fa niente. `false` se la scheda si
   * mostra: il gesto va a entrare o al campo, come prima. Con `from` sul
   * pulsante della scheda, il gesto è del pulsante: il suo clic ha già fatto l'azione.
   */
  _fileGesture(node: CanvasNode, from?: EventTarget | null): boolean {
    const entry = this._cards.get(node.id);
    if (!entry) return false;
    const showing = this._fileShowing(entry);
    if (showing === "shown") return false;
    const button = from instanceof Element ? from.closest("button") : null;
    if (button !== null && entry.body.contains(button)) return true;
    if (showing === "loading") return true;
    if (showing === "unreadable") {
      this._openFileNode(node);
      return true;
    }
    if (this._readOnly || !this._options.onPickFile) {
      this._showNotice(t("canvas.card.missing", { path: cardTarget(node).path }));
    } else {
      this._relink(node.id);
    }
    return true;
  }

  /**
   * Che cosa mostra una scheda di file (T93): il segnaposto di un file mancante
   * lo dice la tela (`cardMissing`); carica o non si mostra lo dice la radice
   * della vista in `data-card-state`, come fanno la nota, l'immagine, il foglio
   * e il PDF (vedi `docs/reference/canvas-cards.md`).
   */
  _fileShowing(entry: CardEntry): FileShowing {
    if (entry.article.dataset.cardMissing !== undefined) return "missing";
    const state = entry.body.querySelector<HTMLElement>(":scope > [data-card-state]")?.dataset.cardState;
    if (state === "loading") return "loading";
    if (state === "unreadable" || state === "unavailable" || state === "too-large") return "unreadable";
    return "shown";
  }

  /**
   * Dove porta «Apri a lato per questo» (T45): il file della scheda attiva col
   * punto in cui si è dentro, e il nome della voce che lo dice. Il punto è la
   * cella che si scrive (`#B3`, dal contesto della scheda, T42), la pagina
   * mostrata da un PDF (`#page=3`), la sezione che la scheda di nota mostra
   * (`#Titolo`, il suo `subpath`); senza, il `subpath` della scheda, com'è.
   * `null` senza una scheda di file attiva. La sola lettura non conta: aprire
   * è guardare.
   */
  _besideHere(): { readonly path: string; readonly label: string } | null {
    const id = this._activeId;
    const entry = id === null ? undefined : this._cards.get(id);
    const node = entry?.node;
    if (!entry || node?.type !== "file") return null;
    const target = cardTarget(node);
    const file = target.path.replace(/^\/+/, "");
    if (file === "") return null;
    const at = (subpath: string, label: string) => ({ path: `/${file}${subpath}`, label });
    // Nella finestra stretta si apre nello stesso riquadro, e il nome lo dice.
    const here = this._root.hasAttribute("data-narrow");
    const name = (point: "cell" | "section" | "page" | null, args: Record<string, string> = {}): string =>
      t((here ? BESIDE_HERE_NAMES.here : BESIDE_HERE_NAMES.beside)[point ?? "none"], args);
    const cell = this._writingId === id ? this._writingContext?.cell ?? "" : "";
    if (cell !== "") return at(`#${cell}`, name("cell", { cell }));
    const kind = cardKindOf(node);
    if (kind === "pdf") {
      let page: number | undefined;
      try {
        page = entry.view?.page?.();
      } catch (error) {
        console.warn(`canvas: la scheda ${node.id} non dice la pagina`, error);
      }
      if (page !== undefined && Number.isSafeInteger(page) && page >= 1) {
        return at(`#page=${page}`, name("page", { n: String(page) }));
      }
    }
    const subpath = target.subpath ?? "";
    const heading = kind === "note" ? noteHeadingOf(target.subpath) : null;
    if (heading !== null) return at(subpath, name("section", { name: heading }));
    return at(subpath, name(null));
  }

  /**
   * Chi apre per «Apri a lato per questo» (T45): accanto o, nella finestra
   * stretta, nello stesso riquadro come «Apri»; `null` se da qui non si può.
   */
  _besideOpener(): ((path: string, from?: string) => void | Promise<void>) | null {
    if (this._root.hasAttribute("data-narrow")) return this._options.onOpenPath ?? null;
    return this._options.onOpenPathBeside ?? null;
  }

  /** «Apri» del menu di una scheda di file (T17): il file si apre nel riquadro. */
  _openFileNode(node: CanvasNode): void {
    if (node.type !== "file" || !node.file) return;
    const path = `/${node.file.replace(/^\/+/, "")}${node.subpath ?? ""}`;
    void this._options.onOpenPath?.(path, this._options.documentId);
  }

  /**
   * Entra nella scheda `id` e ci scrive (T41): la scheda diventa attiva, poi
   * `edit()` monta l'editor vero del file. `false` se la vista non scrive mai
   * (non ha `edit`); se `edit()` dice no la scheda resta attiva, da leggere, e
   * la risposta è `true`. La sola lettura della lavagna non conta (T96): la
   * scheda scrive in un altro file, con la sua sessione e la sua sola
   * lettura, che dice la porta.
   */
  _beginWriting(id: string, from?: EventTarget | null): boolean {
    if (this._writingId === id) return true;
    const entry = this._cards.get(id);
    const view = entry?.view;
    if (!entry || !view?.edit) return false;
    if (!this._enterCard(id)) return false;
    let started = false;
    try {
      started = view.edit(from) === true;
    } catch (error) {
      console.warn(`canvas: nella scheda ${id} non si scrive`, error);
    }
    if (started) this._writingId = id;
    return true;
  }

  /**
   * La vista dice che scrive (con la sua barra) o che ha smesso: il segno
   * `data-card-editing`, la barra nella riga delle opzioni al posto di quelle
   * dello strumento, il nome nella banda.
   */
  _cardWriting(entry: CardEntry, writing: CardWriting | null): void {
    if (this._writingId !== entry.id) return;
    if (writing === null) {
      this._writingId = null;
      this._clearWritingContext();
      delete entry.article.dataset.cardEditing;
      this.setCardOptions(null);
      this._statusSettle();
      return;
    }
    entry.article.dataset.cardEditing = "";
    const context = writing.context ?? null;
    if (context !== null) {
      this._showWritingContext(context);
      this._statusSettle();
      return;
    }
    this._clearWritingContext();
    if (writing.toolbar) {
      const item = document.createElement("div");
      item.className = "canvas-options-item";
      item.dataset.option = "format";
      item.append(writing.toolbar);
      this.setCardOptions([{ id: "format", element: item, priority: 1 }]);
    } else {
      this.setCardOptions(null);
    }
    this._statusSettle();
  }

  /**
   * Il contesto della scheda che scrive nella riga delle opzioni (T42, come
   * nel prototipo T27): il nome della cella e la sua formula, nella forma
   * della barra della formula del foglio. Il primo arrivo monta l'elemento,
   * i successivi ne cambiano soltanto il testo.
   */
  _showWritingContext(context: CardEditorContext): void {
    this._writingContext = context;
    let item = this._formulaItem;
    if (item === null) {
      const element = document.createElement("div");
      element.className = "canvas-options-item";
      element.dataset.option = "formula";
      item = cardFormulaBar();
      element.append(item.element);
      this._formulaItem = item;
      this.setCardOptions([{ id: "formula", element, priority: 1 }]);
    }
    item.show(context);
    // «Apri a lato su B3» segue la cella (T45).
    this._canvasOptions.sync();
  }

  _clearWritingContext(): void {
    this._writingContext = null;
    this._formulaItem = null;
  }

  /**
   * A che punto è ciò che si scrive nella scheda, nella riga del titolo
   * (T41, T96): lo stato del salvataggio con la parola della testata dei
   * riquadri (`.save-state`, `saveStateKey`) o «Sola lettura» col perché
   * (`.canvas-card-lock`).
   */
  _cardEditState(entry: CardEntry, state: CardEditorState | null, reason: string | null): void {
    const handle = entry.connect.parentElement;
    if (!handle) return;
    handle.querySelector(":scope > .save-state")?.remove();
    handle.querySelector(":scope > .canvas-card-lock")?.remove();
    if (state === null) return;
    const mark = document.createElement("span");
    if (state === "readonly") {
      mark.className = "canvas-card-lock";
      mark.textContent = t("canvas.card.readonly");
      if (reason) mark.title = reason;
    } else {
      mark.className = "save-state";
      mark.dataset.state = state;
      mark.textContent = t(saveStateKey(state));
    }
    entry.connect.before(mark);
  }

  /**
   * Entra nella scheda `id`: se è ferma la accende (passando dalla scelta
   * delle vive, che la tiene accesa con le altre), poi chiama `enter()`. Se
   * dice sì, la scheda è attiva: `data-card-active`, «Esc per uscire» nella
   * testata, il fuoco nel corpo. Una scheda fuori dalla vista, o che non si
   * accende adesso (la penna giù, la lavagna nascosta), non entra.
   */
  _enterCard(id: string): boolean {
    if (this._activeId === id) return true;
    const entry = this._cards.get(id);
    const view = entry?.view;
    if (this._destroyed || !entry || !view?.enter || !this._hasLiveContent(entry)) return false;
    if (!overlaps(entry.node, this._viewRect().view)) return false;
    this._leaveCard(false);
    if (this._liveModes.get(id) !== "live") {
      // Un clic o un tasto chiudono il gesto della rotella: la scelta si rifà adesso.
      clearTimeout(this._wheelTimer);
      this._wheelTimer = undefined;
      this._enteringId = id;
      try {
        this._refreshLive();
      } finally {
        this._enteringId = null;
      }
      if (this._liveModes.get(id) !== "live") {
        this._refreshLive();
        return false;
      }
    }
    let entered = false;
    try {
      entered = view.enter() === true;
    } catch (error) {
      console.warn(`canvas: non si entra nella scheda ${id}`, error);
    }
    if (!entered) {
      // Accesa per entrare e poi no: torna a ciò che dice la regola.
      this._refreshLive();
      return false;
    }
    this._activeId = id;
    this._syncSelectionBar();
    // La riga delle opzioni offre «Apri a lato» su questa scheda (T45).
    this._canvasOptions.sync();
    const article = entry.article;
    article.dataset.cardActive = "";
    const hint = document.createElement("span");
    hint.className = "canvas-exit-hint";
    hint.textContent = t("canvas.card.exit_hint");
    article.querySelector(":scope > .canvas-node-handle")?.append(hint);
    entry.body.tabIndex = -1;
    entry.body.focus({ preventScroll: true });
    return true;
  }

  /**
   * Esce dalla scheda attiva, se c'è: `leave()`, via segno e suggerimento.
   * Con `refocus` il fuoco che era dentro torna sulla scheda; con `refresh`
   * la scelta delle vive si rifà (la scheda può tornare ferma).
   */
  _leaveCard(refocus: boolean, refresh = true): void {
    const id = this._activeId;
    if (id === null) return;
    this._activeId = null;
    const entry = this._cards.get(id);
    if (entry) {
      this._unmarkActive(entry, refocus);
      try {
        entry.view?.leave?.();
      } catch (error) {
        console.warn(`canvas: la scheda ${id} non esce`, error);
      }
    }
    if (refresh) this._refreshLive();
    this._syncSelectionBar();
    this._canvasOptions.sync();
  }

  _unmarkActive(entry: CardEntry, refocus: boolean): void {
    const article = entry.article;
    const focusInside = article.contains(document.activeElement) && document.activeElement !== article;
    delete article.dataset.cardActive;
    article.querySelector(":scope > .canvas-node-handle > .canvas-exit-hint")?.remove();
    // Uscendo si smette anche di scrivere (T41): la riga delle opzioni torna
    // allo strumento, la riga del titolo perde stato e lucchetto.
    this._cardEditState(entry, null, null);
    if (this._writingId === entry.id || article.dataset.cardEditing !== undefined) {
      this._writingId = null;
      this._clearWritingContext();
      delete article.dataset.cardEditing;
      this.setCardOptions(null);
      this._statusSettle();
    }
    entry.body.removeAttribute("tabindex");
    if (refocus && focusInside && article.isConnected) article.focus({ preventScroll: true });
  }

  /**
   * Dice alla vista di `entry` che la scheda ha cambiato misura, a gesto
   * finito: durante un ridimensionamento aspetta il rilascio, e il primo
   * disegno dopo lo dice una volta sola.
   */
  _resizeView(entry: CardEntry): void {
    const view = entry.view;
    const known = entry.viewSize;
    if (!view || !known || this._resize !== null) return;
    const { width, height } = entry.node;
    if (known.width === width && known.height === height) return;
    entry.viewSize = { width, height };
    try {
      view.resize?.();
    } catch (error) {
      console.warn(`canvas: la scheda ${entry.id} non cambia misura`, error);
    }
  }

  _worldSize(): { w: number; h: number } {
    let w = 2000;
    let h = 2000;
    for (const node of this._doc?.nodes ?? []) {
      w = Math.max(w, node.x + node.width + 400);
      h = Math.max(h, node.y + node.height + 400);
    }
    return { w, h };
  }

  /**
   * Mette sulla scena le schede di `nodes`, tenute per id: chi c'è già si
   * aggiorna (posto, misura, colore, titolo, scelta), chi è nuovo nasce, chi
   * non c'è più si distrugge. Il corpo si rifà solo se cambia la sua chiave
   * (`cardBodyKey`): una vista viva sopravvive a ciò che non la riguarda.
   * L'ordine sulla scena è quello del file: la prima sotto, l'ultima sopra.
   * I gruppi però stanno sempre sotto i fili, quindi sotto ogni scheda (T91).
   */
  _placeCards(nodes: readonly CanvasNode[]): void {
    // La scheda col campo aperto non si sposta e non rifà il corpo: muoverla
    // toglierebbe il fuoco al campo. Le altre le si mettono attorno; se il
    // documento non l'ha più, resta finché il campo non si chiude.
    const editor = this._editor;
    const keptEntry = editor ? this._cards.get(editor.id) : undefined;
    const kept = keptEntry && keptEntry.article === editor?.article && keptEntry.article.parentElement === this._stage
      ? keptEntry
      : undefined;
    const present = new Set(nodes.map((node) => node.id));
    // Le gemelle col documento di adesso (T22). Se la scheda da cui si erano
    // illuminate non c'è più, o non mostra più quel file, o il file ha ormai
    // una scheda sola, si spengono.
    this._twins = twinGroups(nodes);
    const lit = this._litTwins;
    let unlit = false;
    if (lit !== null) {
      const from = nodes.find((node) => node.id === lit.from);
      if (!from || cardFilePath(from) !== lit.path || !this._twins.has(lit.path)) {
        this._litTwins = null;
        this._twinsHover = null;
        unlit = true;
      }
    }
    for (const [id, entry] of this._cards) {
      if (present.has(id) || entry === kept) continue;
      // La scheda col fuoco che se ne va (Canc, un annulla) lo lascia alla
      // vista: il tasto dopo (Ctrl+Z) arriva ancora alla lavagna (IMP-040).
      const hadFocus = entry.article.contains(document.activeElement);
      this._cards.delete(id);
      this._releaseBody(entry);
      entry.article.remove();
      if (hadFocus && !this._destroyed) this._viewport.focus({ preventScroll: true });
    }
    // Ciò che sulla scena non è una scheda (il messaggio della scena troppo
    // grande) va via; l'inchiostro libero resta, `_paintInk` lo rimette in cima,
    // e il bordo del tratto in corso pure.
    const ours = new Set<Element>([...this._cards.values()].map((entry) => entry.article));
    for (const child of [...this._stage.children]) {
      // Lo strato dei fili (T91, primo figlio della scena: le schede gli
      // vanno dopo), il bordo del tratto in corso (T69) e la
      // cornice della scelta restano: non sono della scena.
      if (child !== this._edgeLayer && !ours.has(child) && !child.classList.contains("canvas-ink-board") && !child.classList.contains("canvas-ink-frames") && child !== this._selectionFrame && child !== this._lassoLayer?.svg) child.remove();
    }
    const children = this._stage.children;
    let index = children[0] === this._edgeLayer ? 1 : 0;
    for (const node of nodes) {
      let entry = this._cards.get(node.id);
      if (!entry) {
        entry = this._createCard(node);
        this._cards.set(node.id, entry);
      }
      if (entry === kept) {
        while (children[index] && children[index] !== entry.article) {
          this._stage.insertBefore(children[index]!, entry.article.nextSibling);
        }
      } else if (children[index] !== entry.article) {
        this._stage.insertBefore(entry.article, children[index] ?? null);
      }
      index++;
      this._refreshCard(entry, node, entry !== kept);
      // La scheda che si scrive tiene la misura a cui è cresciuta, anche
      // prima che il suo commit arrivi (T44).
      const grown = entry === kept ? editor?.grown : null;
      if (grown) {
        entry.article.style.width = `${Math.max(node.width, grown.width)}px`;
        entry.article.style.height = `${Math.max(node.height, grown.height)}px`;
      }
      this._resizeView(entry);
    }
    if (unlit) this._statusSettle();
    this._askCitations(nodes);
  }

  /** L'involucro di una scheda nuova, col corpo ancora vuoto: lo riempie `_refreshCard`. */
  _createCard(node: CanvasNode): CardEntry {
    const id = node.id;
    const el = document.createElement("article");
    el.className = `canvas-node canvas-node-${node.type}`;
    el.dataset.node = id;
    el.tabIndex = 0;
    // Il ruolo è quello di `article`, che accetta un nome, scritto per chi
    // legge solo l'attributo: `role="group"` su un `article` non è ammesso
    // (axe, `aria-allowed-role`).
    el.setAttribute("role", "article");
    // Una scheda nuova non ha ancora il suo nome (T61).
    this._labelled.stale = true;
    const header = document.createElement("div");
    header.className = "canvas-node-handle";
    header.dataset.drag = id;
    const title = document.createElement("span");
    title.className = "canvas-node-title";
    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "canvas-connect";
    connect.dataset.connect = id;
    connect.textContent = "→";
    connect.addEventListener("click", (e) => e.stopPropagation());
    header.append(title, connect);
    // ↗ di un estratto (T75): la fonte accanto, alla prima sezione; con
    // Ctrl (Cmd) nel riquadro. Il pulsante lo mette `syncExcerptHead`.
    header.addEventListener("click", (e) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-excerpt-open]")) return;
      e.stopPropagation();
      this._openExcerptSource(entry.node, e.ctrlKey || e.metaKey ? "pane" : "beside");
    });
    const body = document.createElement("div");
    body.className = "canvas-card-body";
    // Il titolo grande da lontano (T54), prima dell'inchiostro della scheda:
    // è trasparente e l'inchiostro gli resta sopra.
    const far = document.createElement("div");
    far.className = "canvas-node-far";
    far.setAttribute("aria-hidden", "true");
    el.append(header, body, far);
    const entry: CardEntry = {
      id, article: el, title, connect, node, type: node.type, body,
      bodyKey: null, resize: null, teardown: null, view: null, viewLife: null, viewSize: null, missingFor: null,
      far, detail: null, find: null, label: null, titled: null,
    };
    el.addEventListener("focus", () => {
      // Col fuoco il nome dev'essere quello di adesso, anche prima del giro
      // rimandato di `_scheduleLabels`.
      if (!this._labelsCurrent()) this._labelCard(entry);
      if (!this._selection.includes(id)) {
        this._selection = [id];
        this._edgeSelection = [];
        this._options.onSelectionChange();
        this._displaySelection();
      }
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      // Il doppio clic su una maniglia adatta la scheda al contenuto (T66).
      const tap = this._takeHandleTap(e.target);
      if (tap) {
        this._fitToContent(tap);
        return;
      }
      // Il doppio clic sulla testata di un estratto apre la fonte accanto
      // (T75), come ↗; quello su ↗ è già il suo clic.
      if (e.target instanceof Element && e.target.closest(".canvas-node-handle") && noteExcerptOf(entry.node)) {
        if (!e.target.closest("[data-excerpt-open]")) this._openExcerptSource(entry.node, "beside");
        return;
      }
      // Dentro la scheda attiva il doppio clic è del contenuto (una parola);
      // in una nota che si legge comincia a scriverci (T41).
      // L'elemento sotto il gesto, per una scheda che scrive da lì (la cella
      // di un foglio, T42): il bersaglio dell'evento è dove il primo clic è
      // sceso, il corpo della scheda che non prendeva ancora il puntatore; al
      // doppio clic la scheda è attiva e il contenuto lo prende.
      const under = document.elementFromPoint?.(e.clientX, e.clientY) ?? null;
      const from = under !== null && el.contains(under) ? under : e.target;
      if (this._activeId === id) {
        if (this._writingId !== id) this._beginWriting(id, from);
        return;
      }
      const kind = cardKindOf(entry.node);
      // Il visore lo apre la vista dell'immagine, che ascolta il suo doppio clic (T5).
      if (kind === "image" && this._hasLiveContent(entry)) return;
      // Una scheda di file prende il gesto anche senza vista, se manca o non si mostra (T93).
      const takesGesture = entry.node.type === "file" || (kind !== null && DOUBLE_CLICK_ENTERS.has(kind));
      if (takesGesture) this._enterOrEdit(entry.node, from);
      else this._beginCardEdit(entry.node, null, { x: e.clientX, y: e.clientY });
    });
    return entry;
  }

  /**
   * Aggiorna la scheda `entry` a `node`: l'involucro sempre, il corpo
   * (`withBody`) solo se la sua chiave è cambiata.
   */
  _refreshCard(entry: CardEntry, node: CanvasNode, withBody: boolean): void {
    entry.node = node;
    const el = entry.article;
    if (entry.type !== node.type) {
      el.classList.replace(`canvas-node-${entry.type}`, `canvas-node-${node.type}`);
      entry.type = node.type;
    }
    el.style.transform = `translate(${node.x}px, ${node.y}px)`;
    el.style.width = `${node.width}px`;
    el.style.height = `${this._shownHeight(node)}px`;
    // La carta e il colore li dà la pelle (T47); il nome del colore arriva a
    // chi ascolta.
    paintColor(el, node.color);
    paintTextStyle(el, node);
    if (node.type === "group" && node.backgroundStyle) el.dataset.backgroundStyle = node.backgroundStyle;
    else delete el.dataset.backgroundStyle;
    // Il nome per il lettore di schermo (T61) lo scrive `_scheduleLabels`, solo
    // quando il documento cambia: non qui, a ogni resa.
    el.classList.toggle("selected", this._selection.includes(node.id));
    // I nomi della testata dipendono solo dalla scheda e dalla lingua.
    if (entry.titled?.node !== node || entry.titled.round !== this._languageRound) {
      entry.titled = { node, round: this._languageRound };
      const title = nodeTitle(node);
      if (entry.title.textContent !== title) entry.title.textContent = title;
      const far = farTitle(node);
      if (entry.far.textContent !== far) entry.far.textContent = far;
      // Il nome di → è quello del lettore di schermo: la specie e il nome della scheda.
      const connectLabel = t("canvas.connect", { card: cardTitle(node) });
      if (entry.connect.getAttribute("aria-label") !== connectLabel) entry.connect.setAttribute("aria-label", connectLabel);
    }
    // «↩ N» e «×N» dopo il titolo, e la luce delle gemelle (T22).
    this._syncHead(entry);
    // La testata dell'estratto (T75): le parti e ↗, prima di →.
    const handle = entry.connect.parentElement;
    if (handle) syncExcerptHead(el, handle, entry.connect, node.type === "file" ? node.file ?? null : null, noteExcerptOf(node));
    this._syncPorts(el);
    // Le quattro maniglie (T66): in sola lettura nessuna.
    if (this._readOnly) {
      for (const handle of entry.resize ?? []) handle.remove();
      entry.resize = null;
    } else if (!entry.resize) {
      const handles = RESIZE_CORNERS.map((corner) => resizeHandle(corner, node.id));
      // Dopo il corpo, prima dell'inchiostro della scheda: come quando nasce.
      entry.body.after(...handles);
      entry.resize = handles;
    }
    markHandles(el, node, this._camera.zoom);
    if (!withBody) return;
    const kind = cardKindOf(node);
    const cards = this._options.cards;
    const renderer = kind && cards ? cards.registry.rendererFor(kind) : null;
    // Una vista dipende solo dalla scheda; il corpo di sempre anche dalla
    // lingua, e quello di testo dalle sintassi e dalla sola lettura (il
    // pulsante che ne fa una nota).
    const viewKey = cardBodyKey(node, renderer ? this._viewKeyOf(node)
      : node.type === "text" ? `${this._languageRound}:${this._formsRound}:${this._readOnly}`
      : `${this._languageRound}`);
    // Il file cambiato (o la scheda) non è più quello che mancava: si riprova.
    if (entry.missingFor !== null && entry.missingFor !== viewKey) entry.missingFor = null;
    // Il segnaposto di un file mancante dipende dalla lingua e dalla sola lettura (i gesti).
    const missing = entry.missingFor !== null && cards !== undefined;
    const key = missing ? cardBodyKey(node, `missing:${this._languageRound}:${this._readOnly}`) : viewKey;
    if (key === entry.bodyKey) return;
    this._releaseBody(entry);
    const body = document.createElement("div");
    body.className = "canvas-card-body";
    entry.body.replaceWith(body);
    entry.body = body;
    entry.bodyKey = key;
    if (missing && cards) this._fillMissing(entry, body, node, cards);
    else if (renderer && kind && cards) this._mountView(entry, node, kind, renderer, cards.snapshots);
    else this._fillBody(entry, body, node);
  }

  /**
   * Monta la vista del renderer nel corpo, ferma: chi è vivo lo decide la
   * tela più tardi. Un renderer che lancia lascia il corpo di sempre, e la
   * tela va avanti.
   */
  _mountView(entry: CardEntry, node: CanvasNode, kind: CardKind, renderer: CardRenderer, snapshots: CardSnapshots): void {
    const body = entry.body;
    const life = openLifetime();
    const target = cardTarget(node);
    // Finché il renderer monta, un «file mancante» si registra a montaggio finito.
    let mounting = true;
    let missingWhileMounting = false;
    const context: CardContext = {
      path: target.path,
      subpath: target.subpath,
      documentId: this._options.documentId ?? "",
      lifetime: life,
      snapshots,
      size: () => ({ width: entry.node.width, height: entry.node.height }),
      zoom: () => this._camera.zoom,
      initialPage: this._viewMemo?.page(node.id) ?? null,
      // Le parti dell'estratto (T73); col ritaglio aperto l'immagine intera (T78).
      parts: this._crop?.node === node.id ? null : cardParts(node),
      // I gesti dell'avviso «Sezione non trovata» (T75), non in sola lettura.
      ...(!this._readOnly && noteExcerptOf(node) !== null ? {
        excerpt: {
          ...(this._options.parts ? { chooseAgain: () => void this._openParts(entry.id, "command") } : {}),
          showWhole: () => this._showWholeFile(entry.id),
        },
      } : {}),
      pageChanged: (page) => {
        // Una vista già smontata non parla più per questa scheda.
        if (life.closed || entry.body !== body) return;
        this._viewMemo?.pageChanged(entry.id, page);
        // «Apri a lato alla pagina 3» segue la pagina della scheda attiva (T45).
        if (this._activeId === entry.id) this._canvasOptions.sync();
      },
      // L'inchiostro di pagina segue la pagina che si vede (T19). Durante il
      // montaggio non c'è ancora la vista: lo disegna il giro della resa.
      pageShown: () => {
        if (life.closed || entry.body !== body || mounting) return;
        this._pageShown(entry);
      },
      // L'inchiostro `scale` segue il contenuto che si vede (T39), come sopra.
      contentShown: () => {
        if (life.closed || entry.body !== body || mounting) return;
        this._pageShown(entry);
      },
      // L'inchiostro di cella segue il foglio che scorre (T38), come sopra.
      cellsShown: () => {
        if (life.closed || entry.body !== body || mounting) return;
        this._pageShown(entry);
      },
      ...(this._options.cards?.editors ? { editors: this._options.cards.editors } : {}),
      writing: (writing) => {
        if (life.closed || entry.body !== body) return;
        this._cardWriting(entry, writing);
      },
      editState: (state, reason) => {
        if (life.closed || entry.body !== body) return;
        this._cardEditState(entry, state, reason ?? null);
      },
      missing: () => {
        // Una vista già distrutta non parla più per questa scheda; un link non manca mai.
        if (life.closed || entry.body !== body || entry.node.type !== "file") return;
        if (mounting) {
          missingWhileMounting = true;
          return;
        }
        this._markMissing(entry);
      },
    };
    let view: CardView;
    try {
      view = renderer.mount(node, body, "snapshot", context);
    } catch (error) {
      life.close();
      console.warn(`canvas: la scheda ${node.id} non si mostra (${kind})`, error);
      if (entry.body === body) {
        body.replaceChildren();
        this._fillBody(entry, body, node);
      }
      return;
    } finally {
      mounting = false;
    }
    entry.view = view;
    entry.viewLife = life;
    entry.viewSize = { width: node.width, height: node.height };
    const article = entry.article;
    article.dataset.cardKind = kind;
    article.dataset.cardMode = "snapshot";
    // Nasce ferma: la tela non le chiede «ferma» di nuovo.
    this._liveModes.set(entry.id, "snapshot");
    this._views.set(entry.id, {
      setMode: (mode) => {
        view.setMode(mode);
        article.dataset.cardMode = mode;
      },
      // Questa voce serve solo al cambio di modo: la vista la smonta `_releaseBody`.
      destroy: () => {},
    });
    if (missingWhileMounting) this._markMissing(entry);
  }

  /**
   * Il renderer dice che il file della scheda non c'è: la vista si smonta, e il
   * corpo diventa «File mancante» con i suoi gesti. La scheda resta così finché
   * il file non torna (o cambia): allora la sua vista si rimonta.
   */
  _markMissing(entry: CardEntry): void {
    entry.missingFor = cardBodyKey(entry.node, this._viewKeyOf(entry.node));
    this._refreshCard(entry, entry.node, true);
  }

  /**
   * Il file di una scheda mancante è tornato (o è cambiato): la scheda si
   * rimonta da sé, con la sua vista, e la tela decide se si accende.
   */
  _fileBack(id: string): void {
    const entry = this._cards.get(id);
    if (this._destroyed || !entry || entry.missingFor === null) return;
    entry.missingFor = null;
    this._refreshCard(entry, entry.node, true);
    this._refreshLive();
  }

  /**
   * Il corpo di una scheda il cui file non c'è: il nome del file, e «Ritrova…» e
   * «Togli dalla lavagna» se la lavagna si può cambiare. Il file si ascolta da
   * qui (la vita del corpo): quando torna, `_fileBack` rimonta la vista.
   */
  _fillMissing(entry: CardEntry, body: HTMLElement, node: CanvasNode, cards: CanvasCards): void {
    const id = node.id;
    const path = cardTarget(node).path;
    const life = openLifetime();
    entry.viewLife = life;
    entry.article.dataset.cardMissing = "true";
    // Il buco nella lavagna (prototipo T25): il messaggio nel riquadro grigio
    // delle schede di file, sotto i due pulsanti del kit.
    const missing = document.createElement("div");
    missing.className = "canvas-card-missing";
    const message = document.createElement("span");
    message.className = "canvas-media-placeholder";
    message.textContent = t("canvas.card.missing", { path });
    // Su una scheda piccola il messaggio sta su una riga, tagliato: intero qui (IMP-045).
    message.title = message.textContent;
    missing.append(message);
    body.append(missing);
    life.add(cards.watch(path, () => this._fileBack(id)));
    if (this._readOnly) return;
    const actions = document.createElement("div");
    actions.className = "canvas-card-missing-actions";
    missing.append(actions);
    const pick = this._options.onPickFile;
    if (pick) {
      const relink = document.createElement("button");
      relink.type = "button";
      relink.className = "kit-button";
      relink.dataset.kind = "primary";
      relink.dataset.cardAction = "relink";
      relink.textContent = t("canvas.card.relink");
    relink.title = relink.textContent;
      life.listen(relink, "click", (event) => {
        event.stopPropagation();
        this._relink(id);
      });
      actions.append(relink);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "kit-button";
    remove.dataset.kind = "normal";
    remove.dataset.cardAction = "remove";
    remove.textContent = t("canvas.card.remove");
    remove.title = remove.textContent;
    life.listen(remove, "click", (event) => {
      event.stopPropagation();
      this._removeCard(id);
    });
    actions.append(remove);
  }

  /** «Ritrova…» di una scheda mancante, dal pulsante o dal gesto: lo stesso selettore e lo stesso commit (T16, T93). */
  _relink(id: string): void {
    const pick = this._options.onPickFile;
    if (!pick) return;
    this._relinkCard(id, pick).catch((error: unknown) => this._showIntakeError(error));
  }

  /**
   * «Ritrova…»: il file scelto (con il nome di quello che manca in testa) sostituisce
   * il percorso della scheda, in un commit solo. La scelta vale solo se la scheda è
   * ancora mancante per lo stesso file: se il file è tornato, o la scheda è cambiata
   * mentre il selettore era aperto, la scelta è vecchia e non tocca niente.
   */
  async _relinkCard(id: string, pick: NonNullable<CanvasEngineOptions["onPickFile"]>): Promise<void> {
    const expected = this._cards.get(id)?.missingFor ?? null;
    const shown = this._doc?.nodes.find((candidate) => candidate.id === id);
    if (expected === null || !shown) return;
    const chosen = await pick(fileName(cardTarget(shown).path));
    if (!isVaultPath(chosen) || this._destroyed || this._readOnly || !this._doc) return;
    if (this._cards.get(id)?.missingFor !== expected) return;
    const now = this._doc.nodes.find((candidate) => candidate.id === id);
    if (!now) return;
    const op = setOp(now, { ...now, file: relinkedFile(now, chosen) });
    if (op) this._writeOps([op]);
  }

  /** «Togli dalla lavagna» di una scheda mancante: come Canc, per quella scheda sola. */
  _removeCard(id: string): void {
    if (this._removeCards([id], [])) this._options.onSelectionChange();
  }

  /** Smonta ciò che tiene vivo il corpo di `entry` (Markdown, vista) e lo segna da rifare. */
  _releaseBody(entry: CardEntry): void {
    const teardown = entry.teardown;
    const view = entry.view;
    const life = entry.viewLife;
    entry.teardown = null;
    entry.view = null;
    entry.viewLife = null;
    entry.viewSize = null;
    entry.bodyKey = null;
    if (view) {
      this._views.delete(entry.id);
      this._liveModes.delete(entry.id);
      this._seenLive.delete(entry.id);
    }
    // La scheda attiva che perde il corpo (tolta, un annulla, un file
    // cambiato, il campo che prende il posto della vista) ne esce prima.
    if (this._activeId === entry.id) {
      this._activeId = null;
      this._unmarkActive(entry, false);
      try {
        view?.leave?.();
      } catch (error) {
        console.warn(`canvas: la scheda ${entry.id} non esce`, error);
      }
      this._canvasOptions.sync();
    }
    delete entry.article.dataset.cardKind;
    delete entry.article.dataset.cardMode;
    delete entry.article.dataset.cardMissing;
    // Una vista che lancia nel distruggersi non tiene vive le altre.
    if (teardown) {
      try {
        teardown();
      } catch (error) {
        console.warn(`canvas: la scheda ${entry.id} non si smonta`, error);
      }
    }
    if (view) {
      try {
        view.destroy();
      } catch (error) {
        console.warn(`canvas: la scheda ${entry.id} non si smonta`, error);
      }
    }
    life?.close();
  }

  /** Tutte le schede giù dalla scena: ogni vista si distrugge una volta. */
  _dropCards(): void {
    const entries = [...this._cards.values()];
    this._cards.clear();
    for (const entry of entries) {
      this._releaseBody(entry);
      entry.article.remove();
    }
  }

  /** Il corpo di sempre di `node`, in `body`: testo, file, link o gruppo. */
  _fillBody(entry: CardEntry, body: HTMLElement, node: CanvasNode): void {
    switch (node.type) {
      case "text": {
        const text = node.text ?? "";
        const render = this._options.renderMarkdownForCard;
        if (render) {
          const host = document.createElement("div");
          host.className = "canvas-markdown";
          const teardown = render(node.id, text, host, this._forms);
          if (typeof teardown === "function") entry.teardown = teardown;
          body.append(host);
        } else {
          // Senza hook: testo non interattivo. Nessuno scanner locale: un
          // secondo parser linkificherebbe codice che il markdown esclude.
          body.textContent = text;
          if (!text) {
            body.classList.add("canvas-empty");
            body.textContent = t("canvas.empty_text");
          }
        }
        if (this._options.notes && !this._readOnly) {
          const convert = document.createElement("button");
          convert.type = "button";
          convert.className = "canvas-convert-note";
          convert.textContent = t("canvas.extract_note");
          convert.addEventListener("click", (event) => {
            event.stopPropagation();
            // Lo stesso gesto di «Estrai in una nota» del menu (T70), sulla
            // scheda di adesso: il corpo resta anche se la si sposta.
            void this._extractNote(entry.id).catch((error: unknown) => this._showIntakeError(error));
          });
          body.append(convert);
        }
        // Un testo che non ci sta si ferma sotto l'ultima riga intera (#411),
        // «Estrai in una nota…» compreso: mai una riga tagliata a metà.
        const lines = openLifetime();
        watchWholeLines(body, lines);
        const unmount = entry.teardown;
        entry.teardown = () => {
          lines.close();
          unmount?.();
        };
        break;
      }
      case "file": {
        const path = node.file ?? "";
        // Lo stesso tipo che decide come l'inchiostro segue la scheda
        // (`inkFitMode`): resa e segnaposto non si contraddicono.
        const media = mediaKindOfId(path);
        const kind = media === "other" ? "file" : media;
        body.dataset.mediaKind = kind;
        if (kind !== "file") {
          const placeholder = document.createElement("span");
          placeholder.className = "canvas-media-placeholder";
          placeholder.textContent = `${kind.toUpperCase()} · ${path}`;
          body.append(placeholder);
        }
        const link = document.createElement("button");
        link.type = "button";
        link.className = "canvas-file-link internal-path";
        link.textContent = node.subpath ? `${path}${node.subpath}` : path;
        link.addEventListener("click", (e) => {
          e.stopPropagation();
          void this._options.onOpenPath?.(`/${path.replace(/^\/+/, "")}${node.subpath ?? ""}`, this._options.documentId);
        });
        body.append(link);
        break;
      }
      case "link": {
        // Anteprima inerte: mai iframe, mai fetch. Apertura via viewer isolato
        // o esterno attraverso la porta media iniettata.
        const url = node.url ?? "";
        const preview = document.createElement("span");
        preview.className = "canvas-url-text";
        preview.textContent = url;
        const open = document.createElement("button");
        open.type = "button";
        const media = this._options.media;
        const destination = externalUrl(url);
        open.className = "canvas-open-url";
        open.textContent = t("canvas.open_url");
        open.disabled = destination === null || !media;
        open.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!destination) return;
          if (media?.openViewer) void media.openViewer(destination);
          else if (media) void media.openExternal(destination);
        });
        body.append(preview, open);
        break;
      }
      case "group": {
        const label = document.createElement("div");
        label.className = "canvas-group-label";
        label.textContent = node.label || t("canvas.ungrouped");
        body.append(label);
        if (node.background) {
          const bg = document.createElement("span");
          bg.className = "canvas-group-bg";
          bg.textContent = node.background;
          body.append(bg);
        }
        break;
      }
    }
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
