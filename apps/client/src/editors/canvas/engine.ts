import type { Theme } from "../../theme/theme";
import { nearFreeSpot } from "./free-spot";
import type { SyntaxForm } from "../../host/contract";
import { errorText } from "../../host/errors";
import { t, onLanguage, plural, type Key } from "../../i18n/strings";
import { MENU_RULE, menuBelow, type SurfaceClipboardOp, type SurfaceMenu, type SurfaceMenuClipboard, type SurfaceMenuEntry, type SurfaceMenuItem } from "../core/editor-menu";
import { clipboardSupports, readClipboard, writeClipboardData, writeClipboardText } from "../../platform/clipboard";
import { type EditorChangeOrigin, type TextOperation } from "../core/text-operation";
import { idleSchedule } from "../../ink/dom/idle";
import type { InkPointerType } from "../../ink/input/pointer";
import { PenQuiet, type Schedule } from "../../ink/quiet";
import type { InkSample } from "../../ink/sample";
import { ERASER } from "../../ink/tools/eraser";
import { EraseSweep, type Spot } from "../../ink/tools/sweep";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { notify } from "../../ui/notify";
import { searchedName } from "../../rules/searched-name";
import { focusableElements, focusZone } from "../../ui/a11y";
import { mediaKindOfId } from "../media/media-types";
import { anchorAt, cellAnchorAt, pageAnchorAt, strokeBounds, StrokeBox, type Bounds } from "./anchor";
import { parseTsv } from "../core/tsv";
import { DROP_GROUP_THRESHOLD, markdownTable, sortedDrop, type DropFile } from "./drop-layout";
import { parsePageRanges } from "./page-ranges";
import { ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE } from "../../ui/drag-types";
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
  type CardTextEditor,
  type CardView,
  type CardWriting,
  type Rect,
} from "../core/cards/contract";
import { boardReading, cardLabel, cardTitle, changeAnnouncement, nearestCard, stepInOrder, type BoardReading } from "./a11y";
import { applyCardDetails, cardDetail, detailLevel, farTitle } from "./lod";
import {
  cutInk,
  cutPath,
  cutStrokePatches,
  erasableInk,
  InkEraseSource,
  inkKey,
  pieceRecords,
  type ErasableInk,
  type InkEraserMode,
  type StrokeCut,
} from "./ink-erase";
import {
  CANVAS_ALIGN,
  CANVAS_LAYOUTS,
  CANVAS_COLORS,
  CANVAS_TIPS,
  CANVAS_TOOL_KEYS,
  buildCanvasCommands,
  commandForKey,
  commandHint,
  isCommandSearchKey,
  menuChord,
  toolOfCommand,
  type CanvasAlign,
  type CanvasColorId,
  type CanvasCommand,
  type CanvasCommandArgs,
  type CanvasCommandBehaviour,
  type CanvasLayout,
  type CanvasNudge,
  type CanvasTip,
  type CanvasToolId,
} from "./chrome/commands";
import { CANVAS_INK_TOOLS, CANVAS_WRITING_TOOLS, createCanvasRail, saveFingerWrites, type CanvasRail } from "./chrome/rail";
import { openCanvasRadial, rememberRecent } from "./chrome/radial";
import type { Radial, RadialPointer } from "../spatial/tools/radial";
import { createCanvasEmpty, isEmptyBoard, transferOf, type CanvasEmpty } from "./chrome/empty";
import { checkProblemText, clipboardText, codeTextProblem, problemPhrase, readCodeList, summaryText, warningsText } from "./code-text";
import { asCopies, asUpdates, codeClashes, placedAt, type CodeClashes } from "./code-paste";
import { createCanvasNavigator, type CanvasNavigator } from "./chrome/navigator";
import { CanvasJumps } from "./jumps";
import { applyFindMarks, boardFindIndex, findMarks, type FindMark, type FindTarget } from "./find";
import { createCanvasFindBar, type CanvasFindBar } from "./chrome/find-bar";
import {
  CANVAS_CLIPBOARD_TYPE,
  CANVAS_PASTE_STEP,
  cardsMarkdown,
  clipboardJson,
  copiedSelection,
  joinedInkPatches,
  pastedInkOps,
  placedSelection,
  readCanvasClipboard,
  type CanvasClipboard,
} from "./clipboard";
import { createCanvasOptions, type CanvasChosenText, type CanvasOptions } from "./chrome/options";
import { DEFAULT_TEXT_STYLE, isTextAlign, isTextSize, textStyle, withTextStyle, type TextStyle } from "./text-style";
import { createCanvasWorkspace, isBareKey, type CanvasWorkspaceControl } from "./chrome/workspace";
import {
  createCanvasSelectionBar,
  selectionBarWanted,
  type CanvasSelectionBar,
  type SelectionBarRestyle,
  type SelectionBarShow,
  type SelectionBarStrokes,
} from "./chrome/selection-bar";
import { Lasso, LASSO_MIN_STEP, extendLasso, lassoPath, type LassoPoint } from "./lasso";
import { cardsTouched, edgesBetween, marqueeBox, marqueeMoved, sameIds, unionIds } from "./marquee";
import { createOptionsBar, type OptionItem, type OptionsBar } from "../../kit/options-bar";
import { rovingToolbar, type RovingToolbar } from "../../kit/toolbar-keys";
import { watchWholeLines } from "./whole-lines";
import {
  canvasStatusItems,
  dropFolderOf,
  readAttachmentFolder,
  statusSignature,
  type CanvasStatusPort,
} from "./chrome/status";
import type { SurfaceStatusItem } from "../core/registry";
import { CitationCounts, cardFilePath, headZonePaths, syncCardHead, twinGroups } from "./card-head";
import { CanvasDepositError, type DropFolderChoice } from "../../state/canvas-intake";
import { saveStateKey } from "../../state/saving";
import { SHARED_RECENT_COMMANDS, openCommandSearch, type CommandSearchHandle } from "./chrome/command-search";
import { inkFitMode, validAspect } from "./ink-fit";
import { mountInkLayer, type InkGuide, type InkGuideStart, type InkLayer, type InkLayerStroke } from "./ink-layer";
import { createCanvasRuler, type CanvasRuler } from "./ink-ruler";
import { HOLD_MS, shapeKind, StrokeGuide } from "./ink-shapes";
import { cutInkStroke, fadeInkStroke, fadeInkStrokes, InkPathCache, paintBoard, paintCard, type DryStroke } from "./ink-paint";
import { inkReflowWidth, syncInkReflow } from "./ink-reflow";
import { createPenMenu, pickerText as canvasPickerText, type PenMenu } from "./pen-menu";
// I colori delle schede e dei fili (T47).
import {
  JSON_CANVAS_COLORS,
  NOTE_COLORS,
  colorChoiceOf,
  colorLook,
  colorMenuLabel,
  colorValueOf,
  writeColor,
  type CanvasColorChoice,
} from "./colors";
import { createColorPicker, openDialog, openPopover, textField, type PopoverHandle } from "../../kit";
import { PARTS_KEY, cardParts, nodeParts, partsFit, writeParts, type PartsExtra } from "./parts";
import { cardTarget } from "./sources";
import { PARTS_PICKER_MIN_SECTIONS, openPartsPicker, partsSections, type PartsHeading, type PartsPickerHandle, type PartsPickerPlace } from "./parts-picker";
import { cardFormulaBar, type CardFormulaBar } from "../core/formula-bar";
import { noteHeadingOf } from "../core/cards/kinds/note";
import { excerptSourcePath, noteExcerptOf, noteSectionsText, sectionHeading, syncExcerptHead } from "./excerpt";
import { READER_TAP_MS, READER_TAP_SLOP, openReader, type ReaderHandle } from "./reader";
import { DEFAULT_PREFERENCES, currentPreferences, snapStepOf, watchPreferences, type DragEmptyAction, type PenButtonAction, type WheelAction } from "./preferences";
import { TAP_MAX_MS, TAP_SLOP_PX, isTap, pinchCamera, type TouchCamera, type TouchPoint } from "./touch";
import { fit, stepCamera, zoomAtPoint, type MotionState } from "../../spatial/camera";
import { onReducedMotionChange, reducedMotion } from "../../theme/reduced-motion";
import {
  DEFAULT_INK_CHOICE,
  dryStroke,
  inkLook,
  inkStrokeTool,
  type InkPenChoice,
  foreignInkLayer,
  INK_KEY,
  inkLayerStates,
  strokeRecord,
  toDry,
  type DrawableStroke,
  type InkLayerRef,
  type InkLayerState,
  type InkStrokeRecord,
} from "./ink-record";
import {
  moveStrokesOp,
  newNodeId,
  restyleStrokesOp,
  sameLayer,
  upsertNodePatch,
  type CanvasOperation,
  type CanvasPatch,
  type InkPatch,
} from "./operation";
import { edgeEnd, type CanvasDocument, type CanvasEdge, type CanvasNode } from "./model";
import {
  EDGE_SIDES,
  edgeAt,
  edgePathData,
  insideBox,
  linkedCardPlacement,
  nearestSides,
  sidePoint,
  type EdgePoint,
  type EdgeSide,
  type PlacedEdge,
} from "./edges";
import { CanvasViewRecorder, type CanvasView, type CanvasViewSnapshot } from "./view-state";
import { GUIDE_SCREEN_PX, snapGuides, type GuideRect, type GuideResult, type GuideSegment } from "./guides";
import {
  CanvasCoreError,
  changedModel,
  type CanvasCheckReport,
  type CanvasCommitted,
  type CanvasCompiled,
  type CanvasCore,
  type CanvasCoreErrorCode,
  type CanvasInkLayer,
  type CanvasIntentOp,
  type CanvasSourceEdit,
} from "./wasm/core";
import { composingKey } from "../../kit/ime";
import {
  CANVAS_SNAP,
  CanvasArrange,
  LASSO_FRAME_PAD,
  CANVAS_GRID_DOT_STEPS,
  CANVAS_GRID_MIN_PX,
  CANVAS_MIN_SIZE,
  MAX_CANVAS_HISTORY,
  CARD_PAUSE_MS,
  SPREAD_CONFIRM_ABOVE,
  WHEEL_SETTLE_MS,
  wheelPixels,
  CARD_KEYS,
  NEAREST_CARD_KEYS,
  CARD_ONLY_NEAREST_KEYS,
  LABEL_BATCH,
  DOUBLE_CLICK_ENTERS,
  FileShowing,
  MAX_CARD_TEXT_BYTES,
  MEASURE_IMAGE_PARALLEL,
  MAX_DROP_GHOSTS,
  MOVE_CONTENTS_MAX,
  utf8,
  MAX_INTERACTIVE_NODES,
  MAX_INTERACTIVE_EDGES,
  CanvasDepositCards,
  CanvasCorePort,
  SHARED_CORE,
  CanvasInkMouseMemory,
  SHARED_INK_MOUSE,
  CanvasPenMemory,
  SHARED_PEN,
  CardLinkRef,
  CanvasEngineOptions,
  CanvasCards,
} from "./engine-options";
import {
  CardField,
  CardEditor,
  LastPaste,
  PasteChoice,
  CanvasStep,
  InkChain,
  CardDrag,
  DropGhost,
  InkErase,
  InkErasing,
  StrokeDrag,
  LassoLayer,
  MarqueeLayer,
  MarqueeGesture,
  strokesByLayer,
  keysAfter,
  randomSeed,
  InkTarget,
  InkMarks,
  INK_FRAME_SIDES,
  InkPoint,
  isInkKey,
  VIEW_ZOOM_COMMANDS,
  HISTORY_COMMANDS,
  isMenuKey,
  keepsItsUndo,
  isTextTarget,
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
  NARROW_WIDTH,
  NARROW_PANE,
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
  CANVAS_ZOOM_STEP,
  FIT_LIMITS,
  FIT_MARGIN,
  INERTIA_MIN_SPEED,
  CARD_FLASH_MS,
  INERTIA_WINDOW_MS,
  MAX_FRAME_MS,
} from "./engine-parts";
import {
  toCamera,
  fromCamera,
  edgeScrollSpeed,
  sameViewport,
  overlaps,
  looseCards,
  snap,
  snapTo,
  SETTLE_MS,
  MOVE_SIDES,
  ResizeCorner,
  RESIZE_CORNERS,
  RESIZE_FINGER_GRIP_PX,
  TEXT_CARD_HEIGHT,
  NEXT_CARD_GAP,
  ResizeBox,
  resizeBox,
  boxAround,
  scaleInto,
  cornerOf,
  tinyOnScreen,
  resizeHandle,
  markHandles,
  measureText,
  measureWriting,
  freeSpot,
  naturalSize,
  paintColor,
  paintTextStyle,
  measuredImage,
  isVaultPath,
  externalUrl,
  eraseAlongSegments,
  erasePathPieces,
} from "./engine-geometry";
import {
  setOp,
  withPending,
  inkPatches,
  copyPatches,
  mergeSteps,
  passesToShell,
  lostCore,
  sourceOperation,
  cardBodyKey,
  inkHolderText,
  setPixels,
  fileName,
  cardMenuName,
  relinkedFile,
  proposedNoteName,
  noteDisplayName,
  writingName,
  nodeTitle,
  nodeText,
  SECTIONS_PROBE,
  partsChosen,
  cardLinkOf,
  linkedCardOf,
} from "./engine-names";
import { mixMethods } from "../core/mix-methods";
import { cropMethods, type CropMethods } from "./engine-crop";
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

  // --- il nucleo --------------------------------------------------------------

  /**
   * Il modello del testo `text` nel nucleo: `reset` della lavagna aperta, o
   * una lavagna nuova. `null` se il nucleo non è carico o è morto (allora
   * serve `_revive`); un testo che il nucleo rifiuta lancia.
   */
  _open(text: string): CanvasDocument | null {
    if (this._core) {
      try {
        return this._core.reset(text);
      } catch (error) {
        if (!lostCore(error)) throw error;
        this._dropCore();
      }
    }
    let core: CanvasCore | null;
    try {
      core = this._port.openNow(text);
    } catch (error) {
      if (lostCore(error)) return null;
      throw error;
    }
    if (!core) return null;
    this._core = core;
    return core.model();
  }

  /** Il modello del nucleo; `null` se non c'è o se è appena morto (allora si riapre). */
  _coreModel(): CanvasDocument | null {
    const core = this._core;
    if (!core) return null;
    try {
      return core.model();
    } catch (error) {
      if (!lostCore(error)) throw error;
      this._lose();
      return null;
    }
  }

  _dropCore(): void {
    const core = this._core;
    this._core = null;
    try {
      core?.close();
    } catch {
      // Un'istanza morta ha già perso le sue lavagne.
    }
  }

  /** Una trappola: la lavagna si riapre su un'istanza nuova, dal testo della sessione. */
  _lose(): void {
    this._dropCore();
    this._traps += 1;
    // Due di fila: lo si dice, e si riprova soltanto al prossimo testo.
    if (this._traps > 1) {
      this._coreUnavailable();
      return;
    }
    void this._revive();
  }

  async _revive(): Promise<void> {
    const revival = ++this._revival;
    try {
      await this._port.ready();
    } catch {
      if (!this._destroyed && revival === this._revival) this._coreUnavailable();
      return;
    }
    if (this._destroyed || revival !== this._revival || this._core) return;
    let document: CanvasDocument | null;
    try {
      document = this._open(this._source);
    } catch {
      document = null;
    }
    if (!document) {
      this._coreUnavailable();
      return;
    }
    const first = this._doc === null;
    this._doc = document;
    this._checkWritable();
    this._pruneSelection();
    if (first) this._fitCamera(false);
    this._render();
    if (first) {
      this._markOpenView();
      const held = this._heldView;
      if (held) this._restoreView(held.round, held.view);
    }
    if (this._pending) this._recordPending();
  }

  _coreUnavailable(): void {
    this._showNotice(t("canvas.core_unavailable"));
  }

  /**
   * Passa le toppe al nucleo: tutte o nessuna. Il testo nuovo è il tratto che
   * il nucleo ha cambiato; `record` riceve il passo che lo disfa (le toppe
   * inverse dello stesso commit e il tratto di prima) prima che la sessione
   * sappia della modifica (che può tornare qui con un `syncDoc`). Il codice
   * del rifiuto, se il nucleo rifiuta.
   */
  _commitLocal(
    patches: readonly CanvasPatch[],
    origin: EditorChangeOrigin,
    record: ((step: CanvasStep) => void) | null,
    render = true,
  ): true | CanvasCoreErrorCode {
    // Mai una lista vuota: su un sorgente vuoto il nucleo riscriverebbe tutto.
    if (!patches.length) return "request";
    if (this._destroyed || !this._doc || this._readOnly || this._isSceneOversized()) return "rejected";
    const core = this._core;
    if (!core) return "trap";
    const before = this._source;
    let committed: CanvasCommitted;
    try {
      committed = core.commit(patches);
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return "trap";
      }
      if (error instanceof CanvasCoreError) return error.code;
      throw error;
    }
    this._traps = 0;
    const { edit } = committed;
    const after = before.slice(0, edit.start) + edit.text + before.slice(edit.end);
    const restores = this._version;
    this._source = after;
    this._version = ++this._versions;
    // Un commit di soli tratti dice che cosa ha cambiato: il modello nuovo
    // si fa da quello di prima, senza rileggere la lavagna intera (T20e).
    const changed = committed.changed && this._doc ? changedModel(this._doc, committed.changed) : null;
    this._doc = changed ?? this._coreModel() ?? this._doc;
    // Una modifica nuova: l'avviso di un togliere di prima se ne va (T17).
    this._dropRemoval();
    const operation: CanvasOperation = {
      kind: "canvas",
      patches: copyPatches(patches),
      ...sourceOperation(before, after, edit),
    };
    record?.({
      patches: committed.inverse,
      back: copyPatches(patches),
      start: edit.start,
      inserted: edit.text,
      removed: before.slice(edit.start, edit.end),
      version: this._version,
      restores,
    });
    this._pruneSelection();
    if (render) this._render();
    this._options.onChange({ text: after, operation, origin });
    return true;
  }

  /**
   * Fa un passo d'annulla o di ripeti. Se il testo è quello che il passo ha
   * lasciato, rimette il suo tratto con un `reset` sul testo esatto (una
   * lettura intera: va bene per un annulla, non per ogni gesto); se no passa
   * le sue toppe al nucleo. `record` riceve il passo opposto.
   */
  _replay(step: CanvasStep, origin: "undo" | "redo", record: (step: CanvasStep) => void): true | CanvasCoreErrorCode {
    const before = this._source;
    const end = step.start + step.inserted.length;
    // Un passo fatto solo di tratti cambia solo l'inchiostro: si ridisegna lo
    // strato, non le schede.
    const inkOnly = step.patches.length > 0 && step.patches.every((patch) => patch.kind === "ink");
    if (step.version !== this._version || before.slice(step.start, end) !== step.inserted) {
      const code = this._commitLocal(step.patches, origin, record, !inkOnly);
      if (code === true && inkOnly) this._paintInk();
      return code;
    }
    // Il testo esatto del passo torna anche su una scena troppo grande: un
    // passo locale che l'ha portata oltre il limite (un «Incolla codice» di
    // migliaia di schede) si annulla e si ripete, e la lavagna torna
    // interattiva (LIC T25).
    if (this._destroyed || !this._doc || this._readOnly) return "rejected";
    const core = this._core;
    if (!core) return "trap";
    const after = before.slice(0, step.start) + step.removed + before.slice(end);
    let document: CanvasDocument;
    try {
      document = core.reset(after);
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return "trap";
      }
      // Il nucleo non riapre il testo di prima (non dovrebbe mai): restano le toppe.
      if (error instanceof CanvasCoreError) {
        const code = this._commitLocal(step.patches, origin, record, !inkOnly);
        if (code === true && inkOnly) this._paintInk();
        return code;
      }
      throw error;
    }
    this._traps = 0;
    this._source = after;
    this._version = step.restores;
    this._doc = document;
    this._dropRemoval();
    const edit: CanvasSourceEdit = { start: step.start, end, text: step.removed };
    const operation: CanvasOperation = {
      kind: "canvas",
      patches: copyPatches(step.patches),
      ...sourceOperation(before, after, edit),
    };
    record({
      patches: step.back,
      back: step.patches,
      start: step.start,
      inserted: step.removed,
      removed: step.inserted,
      version: step.restores,
      restores: step.version,
    });
    this._pruneSelection();
    if (inkOnly) this._paintInk();
    else this._render();
    this._options.onChange({ text: after, operation, origin });
    return true;
  }

  /** Un gesto della tela: prima il testo in sospeso, poi le sue toppe, un passo d'annulla. */
  _commit(patches: readonly CanvasPatch[], origin: EditorChangeOrigin): boolean {
    this._recordPending();
    const done = this._commitLocal(patches, origin, (step) => this._pushUndo(step, true)) === true;
    // Una scheda tolta, un filo nuovo, una scheda spostata: lo dice la regione
    // viva della tela (T61).
    const said = done && this._doc ? changeAnnouncement(patches, this._doc) : null;
    if (said !== null) this._sayGesture(said);
    return done;
  }

  _pushUndo(step: CanvasStep, fresh: boolean): void {
    this._undo.push(step);
    if (this._undo.length > MAX_CANVAS_HISTORY) this._undo.shift();
    if (fresh) this._redo = [];
  }

  // --- il testo di una scheda ---------------------------------------------------

  /**
   * Registra il testo in sospeso: un commit, una modifica alla sessione, un
   * passo d'annulla. `false` se resta da registrare (il nucleo l'ha rifiutato:
   * il testo resta nel campo, e l'avviso dice perché).
   */
  _recordPending(): boolean {
    clearTimeout(this._pauseTimer);
    this._pauseTimer = undefined;
    const pending = this._pending;
    if (!pending) return true;
    if (!this._doc || this._readOnly || this._destroyed) return false;
    // La misura del testo com'è adesso: l'ultimo tasto può non averla ancora data (T44).
    const editor = this._editor;
    if (editor && editor.id === pending.card.id && !editor.composing) this._growWriting(editor);
    let code = "rejected" as true | CanvasCoreErrorCode;
    for (let attempt = 0; attempt < 2 && code !== true; attempt++) {
      const doc: CanvasDocument = this._doc;
      // La scheda com'è adesso; se non c'è più, com'era, col testo del campo.
      const current = doc.nodes.find((node) => node.id === pending.card.id);
      if (current) pending.card = current;
      const next = withPending(pending.card, pending);
      // Il campo scrive con le operazioni (T23): `set` dei campi cambiati, o
      // la scheda intera se intanto è sparita.
      const op = current ? setOp(current, next) : { op: "add_card", node: next };
      const compiled = op ? this._compileField(op) : { patches: [] };
      if (typeof compiled === "string") {
        code = compiled;
        break;
      }
      if (compiled.patches.length === 0) {
        this._setPending(null);
        return true;
      }
      code = this._commitLocal(compiled.patches, "input", (step) => {
        this._setPending(null);
        this._pushUndo(step, true);
      });
      // Il testo è cambiato da un'altra parte: si riprova sulla scheda di adesso.
      const fresh = code === "stale" ? this._coreModel() : null;
      if (!fresh) break;
      this._doc = fresh;
    }
    if (code === true) {
      if (this._intakeError) this._showNotice("");
      return true;
    }
    if (code === "invalid" || code === "limit") {
      this._showNotice(t(pending.field === "text" && utf8.encode(pending.text).length > MAX_CARD_TEXT_BYTES
        ? "canvas.card_too_long" : "canvas.card_invalid"));
    }
    return false;
  }

  /**
   * Compila l'operazione del campo di una scheda, senza registrare il testo
   * in sospeso (è lui che si registra): le toppe, o il codice del rifiuto.
   * Un'operazione che il nucleo non accetta vale come una scheda che il
   * formato non accetta (`invalid`): l'avviso del campo lo dice.
   */
  _compileField(op: CanvasIntentOp): CanvasCompiled | CanvasCoreErrorCode {
    const core = this._core;
    if (!core) return "trap";
    if (this._isSceneOversized()) return "rejected";
    try {
      return core.compile([op], this._seed());
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return "trap";
      }
      if (error instanceof CanvasCoreError) return error.code === "op" ? "invalid" : error.code;
      throw error;
    }
  }

  /** La `set` del testo `text` nella scheda di testo `id`, come la registra il suo campo. */
  _textOps(id: string, text: string): CanvasIntentOp[] | null {
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (!node) return null;
    const op = setOp(node, { ...node, text });
    return op ? [op] : null;
  }

  /**
   * Chiude il campo aperto, dopo averne registrato il testo. Se il nucleo lo
   * rifiuta il campo resta aperto col suo testo, a meno di `force` (la
   * superficie si chiude, o diventa di sola lettura): allora quel testo si
   * perde, e l'avviso l'ha già detto.
   */
  _closeField(force: boolean): boolean {
    const recorded = this._recordPending();
    if (!recorded && !force) return false;
    this._setPending(null);
    const editor = this._editor;
    if (!editor) return true;
    this._editor = null;
    editor.lifetime.abort();
    editor.input.disabled = true;
    // L'editor delle note si smonta con la vita del campo; qui anche se la
    // porta non l'avesse legato a quella vita.
    editor.live?.destroy();
    editor.live = null;
    // La scheda nuova lasciata vuota se ne va (T44).
    if (editor.born && recorded) this._dropBlankBorn(editor.id, editor.born);
    return true;
  }

  /**
   * Esc, Invio, l'uscita dal campo: registra e chiude. Con `choose` (Esc) la
   * scheda resta scelta: un secondo Esc toglie la scelta (T44).
   */
  _leaveField(focus: boolean, choose = false): void {
    const id = this._editor?.id;
    if (!this._closeField(false)) return;
    if (choose && id !== undefined && this._doc?.nodes.some((node) => node.id === id)
      && (this._selection.length !== 1 || this._selection[0] !== id || this._edgeSelection.length > 0)) {
      this._selection = [id];
      this._edgeSelection = [];
      this._options.onSelectionChange();
    }
    this._render();
    if (focus) this._viewport.focus();
  }

  /**
   * La scheda `id`, nata adesso col passo `born`, se è rimasta senza testo se
   * ne va senza lasciare un passo d'annulla («Ho creato schede vuote per
   * sbaglio», T44): si disfano la nascita e ciò che dopo ha toccato solo lei
   * (il testo scritto e poi cancellato), e il testo torna ai byte di prima. Se
   * nel frattempo un altro passo ha cambiato altro, la si toglie come
   * «Togli dalla lavagna», col suo passo. Una scheda che c'era già non passa
   * di qui: resta anche vuota.
   */
  _dropBlankBorn(id: string, born: CanvasStep): void {
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (!node || node.type !== "text" || (node.text ?? "").trim() !== "") return;
    const at = this._undo.lastIndexOf(born);
    const after = at < 0 ? [] : this._undo.slice(at + 1);
    if (at < 0 || !after.every((step) => step.back.every((patch) => patch.kind === "upsert-node" && patch.after.id === id))) {
      this._removeNodes([id], []);
      return;
    }
    while (this._undo.length > at) {
      const step = this._undo.pop()!;
      if (this._replay(step, "undo", () => {}) !== true) {
        // Il nucleo non lo prende (sola lettura, una trappola): la scheda resta.
        this._undo.push(step);
        return;
      }
    }
  }

  _setPending(next: PendingText | null): void {
    const had = this._pending !== null;
    this._pending = next;
    // Ogni tasto conta: la sessione arma la bozza su ogni cambio, non solo sul primo.
    if (next || had) this._options.onPendingChange?.(next !== null);
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

  _schedulePause(): void {
    clearTimeout(this._pauseTimer);
    this._pauseTimer = setTimeout(() => {
      this._pauseTimer = undefined;
      this._deferPending();
    }, CARD_PAUSE_MS);
  }

  /**
   * Registra il testo in sospeso adesso o, con una penna giù, quando si alza:
   * il commit ridisegna le schede. Il tratto, quando finisce, lo registra da sé
   * prima di scriversi.
   */
  _deferPending(): void {
    if (this._destroyed) return;
    this._quiet.defer("pending", () => {
      if (!this._destroyed) this._recordPending();
    });
  }

  _showNotice(text: string): void {
    if (this._destroyed || this._intakeError === text) return;
    this._intakeError = text;
    this._drawToolbar();
  }

  _pruneSelection(): void {
    if (!this._doc) {
      this._selection = [];
      this._edgeSelection = [];
      return;
    }
    const nodes = new Set(this._doc.nodes.map((n) => n.id));
    const edges = new Set(this._doc.edges.map((e) => e.id));
    this._selection = this._selection.filter((id) => nodes.has(id));
    this._edgeSelection = this._edgeSelection.filter((id) => edges.has(id));
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

  _selectedNodes(): CanvasNode[] {
    if (!this._doc) return [];
    const byId = new Map(this._doc.nodes.map((n) => [n.id, n]));
    return this._selection.map((id) => byId.get(id)!).filter(Boolean);
  }

  // --- l'inchiostro -------------------------------------------------------------

  /** Una penna è giù: un tratto della punta o della gomma è in corso. */
  get _penDown(): boolean {
    return this._quiet.active || (this._inkLayer?.drawing ?? false);
  }

  /**
   * Monta lo strato della penna quando la lavagna si può cambiare e smontarlo
   * quando no (sola lettura del pannello o della tela, scena troppo grande,
   * lavagna chiusa: A8). Smontarlo annulla il tratto in corso: la scia sparisce.
   */
  _syncInkLayer(): void {
    const wanted = !this._destroyed && this._doc !== null && !this._readOnly && !this._isSceneOversized();
    if (wanted === (this._inkLayer !== null)) return;
    if (!wanted) {
      const life = this._inkLife;
      this._inkGuides.clear();
      clearTimeout(this._shapeTimer);
      this._inkLayer = null;
      this._inkLife = null;
      this._inkChain = null;
      life?.close();
      this._inkTargetClose();
      this._eraseDrop();
      this._applyInkMouse();
      return;
    }
    const life = openLifetime();
    this._inkLife = life;
    this._inkLayer = mountInkLayer({
      viewport: this._viewport,
      toWorld: (clientX, clientY) => this._screenToWorld(clientX, clientY),
      // La penna scelta (A11 prima di ogni scelta) allo zoom di quando il
      // tratto comincia: una scelta a metà tratto vale dal tratto dopo.
      look: (input) => {
        const look = inkLook(this._penChoice, this._camera.zoom, input.pressure);
        this._inkTargetStarting(look.brush.size);
        return look;
      },
      // Lo strumento Gomma: la punta e il mouse che scrive cancellano (A21).
      tipErases: () => this._penChoice.tool === "eraser",
      // «Il dito scrive» (T64): letto a ogni appoggio.
      fingerWrites: () => this._fingerWritesSetting,
      quiet: this._quiet,
      mouse: this._inkMouseOn ? "ink" : "ignore",
      // Il righello, Maiusc e la penna ferma (T87).
      guide: (start) => this._inkGuideStart(start),
      onStroke: (stroke) => this._inkStroke(stroke),
      onCancel: (id) => {
        this._inkGuideDrop(id);
        this._inkTargetClose();
        this._eraseCancel(id);
      },
      onEraseStart: (id, pointerType) => this._eraseStart(id, pointerType),
      onErase: (id, points) => this._eraseAlong(id, points),
      onEraseEnd: (id) => this._eraseEnd(id),
      // Il tasto laterale (T63): la gomma, o ciò che dicono le Impostazioni.
      barrelErases: () => this._penButtonSetting === "eraser",
      onBarrel: (event) => this._barrelDown(event),
    }, life);
    this._inkLayer.setCamera(this._camera.x, this._camera.y, this._camera.zoom);
    this._applyInkMouse();
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

  /**
   * Sceglie lo strumento (il comando `canvas.tool.<id>`, la colonna, il suo
   * tasto). In sola lettura gli strumenti che scrivono non si scelgono. Penna,
   * Evidenziatore e Gomma chiamano la penna del menu di N4 (la scelta si
   * ricorda come una scelta del menu) e fanno scrivere il mouse.
   */
  _pickTool(tool: CanvasToolId): void {
    if (this._destroyed) return;
    if (CANVAS_WRITING_TOOLS.has(tool) && (this._readOnly || this._isSceneOversized())) return;
    // Uno strumento scelto: l'interruttore ricordato non arriva più a cambiarlo.
    this._inkMouseTurns += 1;
    if (CANVAS_INK_TOOLS.has(tool) && this._penChoice.tool !== tool) {
      this._choosePen({ ...this._penChoice, tool: tool as InkPenChoice["tool"] }, true);
    }
    this._setTool(tool);
  }

  /**
   * «Collega…» (T17): il filo parte dalla scheda `id`, come dal pulsante →
   * della sua testata; il prossimo clic su un'altra scheda lo chiude. La
   * colonna mostra Collega finché il filo non c'è.
   */
  _beginConnectFrom(id: string): void {
    if (this._destroyed || this._readOnly || this._isSceneOversized()) return;
    if (!this._doc?.nodes.some((node) => node.id === id)) return;
    this._pickTool("connect");
    this._connectFrom = id;
  }

  /** Il pulsante «Mostra l'anteprima» della scheda di pagina web `id`, se c'è adesso. */
  _webPreviewButton(id: string): HTMLButtonElement | null {
    return this._cards.get(id)?.article.querySelector<HTMLButtonElement>(".canvas-card-web-preview") ?? null;
  }

  /** Lo strumento di adesso, mostrato nella colonna, sull'interruttore e sul viewport. */
  _setTool(tool: CanvasToolId): void {
    // Uno strumento scelto rinuncia al filo cominciato da «Collega…».
    this._connectFrom = null;
    // Lasciando il Lazo i tratti scelti non lo sono più: solo lui li sposta (T86).
    if (tool !== "lasso" && this._strokeSelection.size > 0) {
      this._strokeSelection = new Set();
      this._paintLasso();
      this._syncSelectionBar();
    }
    // Lo strumento di prima va fra i recenti del menu radiale (T63).
    if (tool !== this._tool) this._recentTools = rememberRecent(this._recentTools, tool, this._tool);
    this._tool = tool;
    this._inkMouseButton.setAttribute("aria-pressed", String(this._inkMouse));
    this._viewport.dataset.tool = tool;
    this._rail.sync();
    this._canvasOptions.sync();
    this._applyInkMouse();
  }

  /**
   * L'interruttore con cui la lavagna si apre: lo stato ricordato (spento con
   * «Ricorda se scrivi col mouse» spento), letto una volta sola, così un
   * cambio dell'impostazione a lavagna aperta vale dalla prossima apertura.
   * Arriva solo se nel frattempo nessuno ha toccato l'interruttore; una
   * lettura che non riesce lo lascia spento.
   */
  _restoreInkMouse(memory: CanvasInkMouseMemory): void {
    const turns = this._inkMouseTurns;
    void memory.read().then((on) => {
      if (on && !this._destroyed && turns === this._inkMouseTurns) this.setInkMouse(true);
    }, () => undefined);
  }

  /** Il clic sul pulsante: cambia l'interruttore e lo ricorda. */
  _toggleInkMouse(): void {
    this.setInkMouse(!this._inkMouse);
    (this._options.inkMouseMemory ?? SHARED_INK_MOUSE).save(this._inkMouse);
  }

  /** D lasciato, la finestra senza fuoco o nascosta: il mouse torna com'era. */
  _releaseInkKey(): void {
    if (!this._inkKeyDown) return;
    this._inkKeyDown = false;
    this._applyInkMouse();
  }

  /**
   * Dice allo strato che cosa fa il mouse, e lo mostra solo quando scrive
   * davvero (lo strato c'è): `data-ink="pen"`, o `"eraser"` con lo strumento
   * Gomma del menu, sul viewport; la croce (o la cella) la porta il velo
   * (T20d), mostrato solo con un mouse o una penna sospesa sopra la vista.
   * Ogni attributo si scrive solo se cambia.
   */
  _applyInkMouse(): void {
    // Con Spazio tenuto il mouse sposta la vista (T53).
    const on = this._inkMouseOn && !this._spaceHeld;
    const layer = this._inkLayer;
    layer?.setMouse(on ? "ink" : "ignore");
    const ink = on && layer ? (this._penChoice.tool === "eraser" ? "eraser" : "pen") : null;
    if (ink === null) {
      if (this._viewport.dataset.ink !== undefined) delete this._viewport.dataset.ink;
    } else if (this._viewport.dataset.ink !== ink) {
      this._viewport.dataset.ink = ink;
    }
    const veil = this._penVeil;
    const shown = ink !== null && this._veilPointer;
    if (shown && veil.dataset.tool !== ink) veil.dataset.tool = ink;
    if (shown === veil.hasAttribute("data-idle")) veil.toggleAttribute("data-idle", !shown);
  }

  /**
   * Un mouse o una penna sospesa entra nella vista o ci si muove (`true`), la
   * penna esce dal raggio o un dito si appoggia (`false`): il velo della croce c'è solo per i
   * primi. Il dito non ha cursore, e sotto il velo non toccherebbe il
   * contenuto delle schede.
   */
  _setVeilPointer(over: boolean): void {
    if (this._veilPointer === over) return;
    this._veilPointer = over;
    this._applyInkMouse();
  }

  /**
   * Il puntatore passa su un altro elemento della vista (T20f). Sul velo della
   * croce la scheda di prima tiene l'aspetto del passaggio: il velo gliel'ha
   * tolto, ma il puntatore non se n'è andato. Durante un tratto il passaggio
   * va alla vista per la cattura, e non conta. Altrove il passaggio è quello
   * vero: la scheda sotto (o nessuna) e niente più da tenere, nello stesso
   * fotogramma in cui `:hover` torna, così la scheda non cambia aspetto.
   * Solo ai confini, mai a ogni movimento, e senza ricerche per punto.
   */
  _pointerOver(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    const target = event.target;
    if (target === this._penVeil) {
      this._holdHover(this._hoverCard);
      return;
    }
    if (this._penDown) return;
    this._hoverCard = target instanceof Element && this._stage.contains(target)
      ? target.closest<HTMLElement>(".canvas-node")
      : null;
    this._holdHover(null);
  }

  /** La scheda `card` tiene l'aspetto del passaggio (`data-hover-held`); `null` lo lascia. */
  _holdHover(card: HTMLElement | null): void {
    if (card === this._heldCard) return;
    this._heldCard?.removeAttribute("data-hover-held");
    this._heldCard = card;
    card?.setAttribute("data-hover-held", "");
  }

  /**
   * L'elemento in cima nel punto `clientX`, `clientY` della finestra come se
   * il velo della croce non ci fosse: le ricerche per punto della lavagna
   * (il menu, il filo, il deposito) guardano le schede, non il velo.
   */
  _elementAt(clientX: number, clientY: number): Element | null {
    const top = document.elementFromPoint?.(clientX, clientY) ?? null;
    if (top !== this._penVeil) return top;
    const stack = document.elementsFromPoint?.(clientX, clientY) ?? [];
    const at = stack.indexOf(this._penVeil);
    return at < 0 ? null : stack[at + 1] ?? null;
  }

  /**
   * Il bersaglio di un evento del puntatore come se il velo della croce non
   * ci fosse: ciò che c'è sotto il punto, cercato una volta per evento (la
   * vista se sotto non c'è niente). Un evento che non ha preso il velo dà il
   * suo bersaglio, senza ricerche.
   */
  _targetOf(event: MouseEvent): EventTarget | null {
    if (event.target !== this._penVeil) return event.target;
    let under = this._underVeil.get(event);
    if (under === undefined) {
      const found = this._elementAt(event.clientX, event.clientY);
      under = found !== null && this._viewport.contains(found) ? found : this._viewport;
      this._underVeil.set(event, under);
    }
    return under;
  }

  // --- il menu della penna (T21) -------------------------------------------

  /**
   * Una scelta del menu della penna: vale dal prossimo tratto o dalla
   * prossima passata (quelli in corso finiscono come sono cominciati). Una
   * scelta fatta (`settled`) si ricorda per le lavagne che si aprono dopo;
   * quelle aperte tengono la loro.
   */
  _choosePen(next: InkPenChoice, settled: boolean): void {
    if (this._destroyed) return;
    this._penTurns += 1;
    // Un colore nuovo va fra i recenti del menu radiale (T63), col colore di prima.
    const before = this._penColor;
    const after = next.color[inkStrokeTool(next)];
    if (after !== before) this._recentColors = rememberRecent(this._recentColors, after, before);
    this._penChoice = next;
    this._followPen();
    this._penMenu.sync();
    if (settled) (this._options.penMemory ?? SHARED_PEN).save(next);
  }

  /**
   * La penna cambiata: se il mouse scrive con la colonna, la colonna passa
   * allo strumento della penna (la Gomma del menu è la Gomma della colonna).
   */
  _followPen(): void {
    if (this._inkMouse && this._tool !== this._penChoice.tool) this._setTool(this._penChoice.tool);
    else this._applyInkMouse();
  }

  /**
   * La penna con cui la lavagna si apre: quella ricordata, letta una volta.
   * Arriva solo se nel frattempo nessuno ha scelto; una lettura che non
   * riesce lascia quella di serie.
   */
  _restorePen(memory: CanvasPenMemory): void {
    const turns = this._penTurns;
    void memory.read().then((choice) => {
      if (this._destroyed || turns !== this._penTurns) return;
      this._penChoice = choice;
      this._followPen();
      this._penMenu.sync();
    }, () => undefined);
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

  /**
   * Comincia una passata del retro della penna o del tasto laterale: i tratti
   * che può prendere sono quelli disegnati adesso, dove si vedono.
   */
  _eraseStart(id: number, pointerType: InkPointerType): void {
    this._eraseDrop();
    this._erase = {
      id,
      sweep: new EraseSweep(ERASER, pointerType),
      source: new InkEraseSource(erasableInk(this._inkStateList(), this._pagesShown, this._aspectsShown, this._cellsShown)),
      mode: this._penChoice.eraser,
      path: [],
      cuts: new Map(),
      radius: 0,
    };
  }

  /**
   * Punti nuovi della passata: i tratti presi si attenuano, il resto no. Con
   * `"piece"` si attenua solo il pezzo strofinato: i tratti vicini ai punti
   * nuovi si ritagliano sul cammino fatto fin qui.
   */
  _eraseAlong(id: number, points: readonly InkSample[]): void {
    const erase = this._erase;
    if (!erase || erase.id !== id || points.length === 0) return;
    const zoom = this._camera.zoom;
    const before = erase.sweep.size;
    if (erase.mode === "stroke") {
      for (const point of points) erase.sweep.along(erase.source, [point.x, point.y], zoom);
      const marked = erase.sweep.marked();
      for (let i = before; i < marked.length; i++) this._fadeInk(marked[i]!, true);
      return;
    }
    const radius = erase.sweep.radius / zoom;
    erase.radius = radius;
    const last = erase.path[erase.path.length - 1];
    let loX = last ? last[0] : Infinity;
    let loY = last ? last[1] : Infinity;
    let hiX = last ? last[0] : -Infinity;
    let hiY = last ? last[1] : -Infinity;
    for (const point of points) {
      const spot: Spot = [point.x, point.y];
      erase.path.push(spot);
      erase.sweep.along(erase.source, spot, zoom);
      loX = Math.min(loX, spot[0]);
      loY = Math.min(loY, spot[1]);
      hiX = Math.max(hiX, spot[0]);
      hiY = Math.max(hiY, spot[1]);
    }
    loX -= radius;
    loY -= radius;
    hiX += radius;
    hiY += radius;
    const marked = erase.sweep.marked();
    for (let i = 0; i < marked.length; i++) {
      const unit = marked[i]!;
      // Un tratto già preso cambia solo se i punti nuovi gli passano vicino.
      if (i < before && (unit.maxX < loX || unit.minX > hiX || unit.maxY < loY || unit.minY > hiY)) continue;
      const pieces = cutInk(unit, erase.path, radius);
      if (pieces === null) {
        if (erase.cuts.delete(unit.key)) this._showCut(unit, null);
        continue;
      }
      const preview = cutPath(pieces);
      erase.cuts.set(unit.key, { unit, pieces, preview });
      this._showCut(unit, preview);
    }
  }

  /**
   * La passata è finita: i tratti presi si cancellano (o si tagliano) con un
   * commit solo, un passo d'annulla, anche se stanno in più livelli. Niente
   * preso, niente commit; un commit che non riesce rimette i tratti come
   * erano.
   */
  _eraseEnd(id: number): void {
    const erase = this._erase;
    if (!erase || erase.id !== id) return;
    this._erase = null;
    if (erase.mode === "stroke" ? erase.sweep.size === 0 : erase.cuts.size === 0) return;
    let done = false;
    try {
      done = erase.mode === "stroke" ? this._eraseCommit(erase.sweep.marked()) : this._cutCommit(this._cutsOf(erase), erase.path, erase.radius);
    } finally {
      if (!done) this._restoreErase(erase);
    }
  }

  /** La passata annullata (palmo, finestra nascosta, sola lettura): i tratti tornano normali. */
  _eraseCancel(id: number): void {
    if (this._erase?.id === id) this._eraseDrop();
  }

  _eraseDrop(): void {
    const erase = this._erase;
    this._erase = null;
    if (erase) this._restoreErase(erase);
  }

  /** Rimette come erano i tratti che la passata `erase` mostrava presi o tagliati. */
  _restoreErase(erase: InkErase): void {
    if (erase.mode === "stroke") for (const unit of erase.sweep.marked()) this._fadeInk(unit, false);
    else for (const { unit } of erase.cuts.values()) this._showCut(unit, null);
  }

  /** I tagli della passata nell'ordine in cui la gomma ha preso i tratti. */
  _cutsOf(erase: InkErase): InkErasing[] {
    const cuts: InkErasing[] = [];
    for (const unit of erase.sweep.marked()) {
      const cut = erase.cuts.get(unit.key);
      if (cut) cuts.push(cut);
    }
    return cuts;
  }

  /** L'elemento della scheda `node` sulla scena; `null` se non c'è. */
  _inkOwner(node: string): HTMLElement | null {
    return this._stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(node)}"]`);
  }

  /** Attenua o rimette il percorso disegnato di un tratto, senza ridisegnare. */
  _fadeInk(unit: ErasableInk, faded: boolean): void {
    if (unit.node === null) {
      fadeInkStroke(this._stage, "board", unit.id, faded);
      return;
    }
    const element = this._inkOwner(unit.node);
    if (element) fadeInkStroke(element, "card", unit.id, faded);
  }

  /** Attenua o rimette i tratti `units`, una passata per livello: col Lazo possono essere migliaia (T86). */
  _fadeUnits(units: readonly ErasableInk[], faded: boolean): void {
    for (const { layer, ids } of strokesByLayer(units)) {
      const owner = layer === "board" ? this._stage : this._inkOwner(layer.node);
      if (owner) fadeInkStrokes(owner, layer === "board" ? "board" : "card", new Set(ids), faded);
    }
  }

  /** Mostra il taglio `preview` di un tratto (o lo toglie con `null`), senza ridisegnare. */
  _showCut(unit: ErasableInk, preview: string | null): void {
    if (unit.node === null) {
      cutInkStroke(this._stage, "board", unit.id, preview);
      return;
    }
    const element = this._inkOwner(unit.node);
    if (element) cutInkStroke(element, "card", unit.id, preview);
  }

  /** Il primo passo di un commit della gomma: il documento e i livelli di adesso, dopo il testo in sospeso. */
  _inkEditStart(): { readonly doc: CanvasDocument; readonly layers: readonly CanvasInkLayer[] } | null {
    if (this._destroyed || !this._doc || this._readOnly || this._isSceneOversized()) return null;
    this._recordPending();
    const doc = this._doc;
    const layers = this._inkLayersNow();
    return layers ? { doc, layers } : null;
  }

  /**
   * Un commit solo con le toppe della gomma, un passo d'annulla; ciò che il
   * nucleo rifiuta lo dice l'avviso. `true` se è riuscito.
   */
  _commitInkEdit(patches: readonly InkPatch[]): boolean {
    if (patches.length === 0) return false;
    const code = this._commitLocal(patches, "input", (step) => this._pushUndo(step, true), false);
    if (code !== true) {
      // Una trappola la dice il nucleo che si riapre.
      if (code !== "trap") this._showNotice(t(code === "limit" ? "canvas.ink.full" : "canvas.ink.refused"));
      return false;
    }
    this._inkChain = null;
    this._paintInk();
    if (this._intakeError) this._showNotice("");
    this._inkGestureDone();
    return true;
  }

  /**
   * Un gesto d'inchiostro è appena diventato l'ultimo passo d'annulla. La
   * penna non prende il fuoco (un tratto non chiude il campo che si scrive):
   * perché Ctrl+Z, subito dopo, tolga il tratto, il fuoco dentro una scheda
   * che scrive ricorda il passo (`_inkUndoKey`); ogni altro fuoco (un
   * pulsante della colonna o della riga, un'altra parte della finestra,
   * nessuno) passa alla vista, come dopo un clic sulla lavagna.
   */
  _inkGestureDone(): void {
    const step = this._undo[this._undo.length - 1];
    if (!step || this._destroyed) return;
    const active = document.activeElement;
    const inCard = active instanceof Element && active !== this._viewport && this._viewport.contains(active)
      ? active.closest(".canvas-node") : null;
    if (inCard && inCard !== active) {
      this._inkOverField.push(step);
      this._inkOverFieldRedo = [];
      return;
    }
    this._inkOverField = [];
    this._inkOverFieldRedo = [];
    // Una scheda o la vista col fuoco: i tasti arrivano già alla tela.
    if (active instanceof Element && this._viewport.contains(active)) return;
    this._viewport.focus({ preventScroll: true });
  }

  /**
   * Ctrl+Z (Ctrl+Maiusc+Z, Ctrl+Y) col fuoco in una scheda che scrive,
   * subito dopo uno o più gesti d'inchiostro (`_inkOverField`): annulla (o
   * rifà) il gesto, e il campo resta aperto col suo testo. Ogni altro tasto
   * li lascia, e da lì i tasti sono del campo.
   */
  _inkUndoKey(event: KeyboardEvent): void {
    if (event.key === "Control" || event.key === "Meta" || event.key === "Shift" || event.key === "Alt") return;
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
    const letter = event.key.toLowerCase();
    const chord = mod && letter === "z" ? (event.shiftKey ? "redo" : "undo") : mod && letter === "y" && !event.shiftKey ? "redo" : null;
    if (chord === null || composingKey(event)) {
      this._inkOverField = [];
      this._inkOverFieldRedo = [];
      return;
    }
    if (event.defaultPrevented || this._penDown || this._pending !== null || this._readOnly) return;
    const from = chord === "undo" ? this._inkOverField : this._inkOverFieldRedo;
    const history = chord === "undo" ? this._undo : this._redo;
    const step = from[from.length - 1];
    if (!step) return;
    if (history[history.length - 1] !== step) {
      // La storia è cambiata sotto (un annulla dal menu, una modifica): i
      // passi ricordati non sono più gli ultimi.
      this._inkOverField = [];
      this._inkOverFieldRedo = [];
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    from.pop();
    history.pop();
    const done = chord === "undo"
      ? this._replay(step, "undo", (again) => {
        this._redo.push(again);
        this._inkOverFieldRedo.push(again);
      })
      : this._replay(step, "redo", (again) => {
        this._pushUndo(again, false);
        this._inkOverField.push(again);
      });
    if (done !== true) {
      history.push(step);
      from.push(step);
    }
    this._statusSettle();
  }

  /**
   * Cancella i tratti `marked` dal documento di adesso: prima il testo in
   * sospeso (un passo suo, come prima di ogni gesto), poi una toppa per
   * tratto, livello per livello nell'ordine in cui la gomma li ha presi. Un
   * tratto che nel frattempo non c'è più si lascia; un livello diventato
   * estraneo non si tocca. `true` se il commit è riuscito.
   */
  _eraseCommit(marked: readonly ErasableInk[]): boolean {
    const start = this._inkEditStart();
    if (!start) return false;
    const { layers } = start;
    const present = new Set<string>();
    for (const state of this._inkStateList()) {
      for (const entry of state.strokes) present.add(inkKey(state.layer, entry.id));
    }
    const groups = new Map<string, { readonly layer: InkLayerRef; readonly ids: string[] }>();
    for (const unit of marked) {
      if (!present.has(unit.key)) continue;
      const group = unit.node === null ? "board" : `node\u0000${unit.node}`;
      let entry = groups.get(group);
      if (!entry) {
        entry = { layer: unit.layer, ids: [] };
        groups.set(group, entry);
      }
      entry.ids.push(unit.id);
    }
    // Una `erase_strokes` per livello, nell'ordine in cui la gomma li ha presi (T24).
    const ops: CanvasIntentOp[] = [];
    for (const { layer, ids } of groups.values()) {
      if (foreignInkLayer(layers, layer)) continue;
      ops.push({ op: "erase_strokes", layer: layer === "board" ? "board" : { node: layer.node }, ids: [...ids] });
    }
    const patches = ops.length > 0 ? this._compileOps(ops) : null;
    return patches !== null && this._commitInkEdit(inkPatches(patches));
  }

  /**
   * Taglia i tratti di `cuts` nel documento di adesso: prima il testo in
   * sospeso, poi, livello per livello, i pezzi al posto di ogni tratto e nel
   * suo ordine (`cutStrokePatches`), in un commit solo. Un tratto che nel
   * frattempo non c'è più, o è cambiato, si lascia; un livello diventato
   * estraneo non si tocca. `true` se il commit è riuscito.
   */
  _cutCommit(cuts: readonly InkErasing[], path: readonly Spot[], radius: number): boolean {
    const start = this._inkEditStart();
    if (!start) return false;
    const { doc, layers } = start;
    const present = new Map<string, DrawableStroke>();
    for (const state of this._inkStateList()) {
      for (const stroke of state.drawable) present.set(inkKey(state.layer, stroke.id), stroke);
    }
    const groups = new Map<string, { readonly layer: InkLayerRef; readonly cuts: StrokeCut[] }>();
    for (const { unit, pieces } of cuts) {
      const now = present.get(unit.key);
      if (!now || now.inkText !== unit.stroke.inkText || now.brushText !== unit.stroke.brushText) continue;
      const group = unit.node === null ? "board" : `node\u0000${unit.node}`;
      let entry = groups.get(group);
      if (!entry) {
        entry = { layer: unit.layer, cuts: [] };
        groups.set(group, entry);
      }
      entry.cuts.push({ id: unit.id, pieces: pieceRecords(now, pieces) });
    }
    const along = this._eraseAlongOps(cuts, path, radius);
    if (along !== null) {
      const patches = along.length > 0 ? this._compileOps(along) : null;
      return patches !== null && this._commitInkEdit(inkPatches(patches));
    }
    const patches: InkPatch[] = [];
    for (const { layer, cuts: layerCuts } of groups.values()) {
      const made = cutStrokePatches(doc, layers, layer, layerCuts);
      if (made) patches.push(...made);
    }
    return this._commitInkEdit(patches);
  }

  /**
   * La gomma «Solo il pezzo» come `erase_along` (T24): un'operazione per
   * posto toccato, col cammino fatto e la sua larghezza: nelle coordinate
   * della lavagna per i tratti liberi (`on: "board"`), in quelle della scheda
   * per i suoi (`on` col suo id, con la proporzione del contenuto che
   * mostra), in punti della pagina mostrata per quelli di un PDF
   * (`on: {card, page, page_size}`) e in pixel del foglio dall'angolo della
   * cella per quelli di una cella (`on: {card, sheet, cell}`). `null` se la
   * scheda non dice più dove mostra la pagina o la cella di un tratto tagliato
   * (allora la tela scrive i pezzi che ha tagliato lei).
   */
  _eraseAlongOps(cuts: readonly InkErasing[], path: readonly Spot[], radius: number): CanvasIntentOp[] | null {
    const doc = this._doc;
    if (!doc || path.length === 0 || !(radius > 0)) return null;
    // Dove taglia ogni operazione: la radice, una scheda, una sua pagina o una
    // sua cella, con l'angolo e la scala con cui la scheda la mostra (come
    // `erasableInk`): il cammino ci torna con `(punto − angolo) / scala`.
    const targets = new Map<string, { readonly on: unknown; readonly x: number; readonly y: number; readonly s: number; readonly aspect?: number }>();
    for (const { unit } of cuts) {
      const { page, cell } = unit.stroke;
      if (unit.node === null) {
        targets.set("board", { on: "board", x: 0, y: 0, s: 1 });
        continue;
      }
      const node = doc.nodes.find((one) => one.id === unit.node);
      if (!node) return null;
      if (cell !== null) {
        const box = this._cellRectOf(node.id, cell.sheet, cell.cell);
        if (!box || !(box.zoom > 0) || !Number.isFinite(box.rect.x) || !Number.isFinite(box.rect.y)) return null;
        targets.set(`cell\u0000${node.id}\u0000${cell.sheet}\u0000${cell.cell}`, {
          on: { card: node.id, sheet: cell.sheet, cell: cell.cell },
          x: node.x + box.rect.x,
          y: node.y + box.rect.y,
          s: box.zoom,
        });
      } else if (page !== null) {
        const box = this._pageBoxOf(node.id);
        if (!box || box.page !== page) return null;
        // `pageFit`: il fattore minore, dall'angolo del rettangolo.
        const s = Math.min(box.rect.width / box.size.width, box.rect.height / box.size.height);
        if (!(s > 0) || !Number.isFinite(s)) return null;
        targets.set(`page\u0000${node.id}\u0000${page}`, {
          on: { card: node.id, page, page_size: [box.size.width, box.size.height] },
          x: node.x + box.rect.x,
          y: node.y + box.rect.y,
          s,
        });
      } else if (!targets.has(`card\u0000${node.id}`)) {
        const aspect = this._layerAspect({ node: node.id });
        targets.set(`card\u0000${node.id}`, {
          on: node.id,
          x: node.x,
          y: node.y,
          s: 1,
          ...(validAspect(aspect) ? { aspect } : {}),
        });
      }
    }
    // Un cammino lungo va in pezzi di fila che si toccano in un estremo: ogni
    // pezzo resta sotto i tetti del nucleo (punti e lavoro), e la lista
    // resta una, cioè un passo d'annulla.
    const pieces = erasePathPieces(path, eraseAlongSegments(cuts.map(({ unit }) => unit), radius));
    const ops: CanvasIntentOp[] = [];
    for (const target of targets.values()) {
      for (const piece of pieces) {
        ops.push({
          op: "erase_along",
          points: piece.map(([x, y]) => [(x - target.x) / target.s, (y - target.y) / target.s]),
          size: (radius * 2) / target.s,
          on: target.on,
          ...(target.aspect === undefined ? {} : { aspect: target.aspect }),
        });
      }
    }
    return ops;
  }

  /**
   * I livelli d'inchiostro del testo di adesso: lo stato lo dice il nucleo, una
   * volta per testo (`inkLayers()` li tiene fino al prossimo `reset` o
   * `commit`), e qui si decodificano una volta per modello.
   */
  _inkStateList(): readonly InkLayerState[] {
    const doc = this._doc;
    const layers = this._inkLayersNow();
    if (!doc || !layers) return [];
    const cached = this._inkStates;
    if (cached && cached.doc === doc && cached.layers === layers) return cached.states;
    const states = inkLayerStates(doc, layers);
    this._inkStates = { doc, layers, states };
    return states;
  }

  /** I livelli del nucleo per il testo di adesso; `null` senza nucleo o se è appena morto. */
  _inkLayersNow(): readonly CanvasInkLayer[] | null {
    const core = this._core;
    if (!core) return null;
    try {
      return core.inkLayers();
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return null;
      }
      if (error instanceof CanvasCoreError) return null;
      throw error;
    }
  }

  /**
   * Ridisegna l'asciutto di tutte le schede sulla scena e della radice, senza
   * rifare le schede: dopo `_render`, o dopo un annulla fatto solo di tratti.
   */
  _paintInk(): void {
    if (!this._doc || this._isSceneOversized()) return;
    const cards = new Map<string, readonly DryStroke[]>();
    let board: DryStroke[] = [];
    // Ciò che la gomma ha preso resta attenuato (o tagliato) anche se lo
    // strato si ridisegna.
    const erase = this._erase;
    const faded = erase?.mode === "stroke" ? new Set(erase.sweep.marked().map((unit) => unit.key)) : null;
    const cuts = erase?.mode === "piece" ? erase.cuts : null;
    for (const state of this._inkStateList()) {
      const drys: DryStroke[] = [];
      for (const stroke of state.drawable) {
        const dry = dryStroke(stroke, this._inkPaths);
        if (!dry) continue;
        const key = inkKey(state.layer, stroke.id);
        const cut = cuts?.get(key);
        if (cut && cut.unit.stroke.inkText === stroke.inkText) drys.push({ ...dry, cut: cut.preview });
        else drys.push(faded?.has(key) ? { ...dry, faded: true } : dry);
      }
      if (state.node) cards.set(state.node.id, drys);
      else board = drys;
    }
    const nodes = new Map(this._doc.nodes.map((node) => [node.id, node]));
    for (const element of this._stage.children) {
      if (!(element instanceof HTMLElement) || !element.classList.contains("canvas-node")) continue;
      const node = nodes.get(element.dataset.node ?? "");
      if (node) this._paintCardInk(element, node, cards.get(node.id) ?? []);
    }
    paintBoard(this._stage, board);
    this._inkCards = cards;
    this._inkBoard = board;
    // I tratti scelti col Lazo, sopra l'inchiostro libero (T86).
    this._paintLasso();
    this._inkPaths.sweep();
  }

  /**
   * Un tratto della penna è finito: si scrive, e la sua scia va via nello
   * stesso giro. La sua guida (T87) dice che cosa: sul bordo del righello,
   * dritto con Maiusc, o com'era e poi la forma della penna ferma.
   */
  _inkStroke(stroke: InkLayerStroke): void {
    const layer = this._inkLayer;
    const guide = this._inkGuides.get(stroke.id) ?? null;
    this._inkGuideDrop(stroke.id);
    // L'etichetta sparisce all'alzata; il tratto si attacca a ciò che diceva.
    this._inkTargetClose();
    try {
      const guided = guide?.finish(stroke.samples, stroke.split) ?? null;
      this._writeStroke(guided === null ? stroke : { ...stroke, samples: guided.samples }, guided?.shape ?? null);
    } finally {
      layer?.settle(stroke.id);
    }
  }

  /**
   * Scrive il tratto `stroke`: prima il testo in sospeso (un passo suo, A1),
   * poi la scheda che lo tiene sul documento di adesso (A3, A9), il record,
   * la toppa e un commit solo, senza ridisegnare le schede; l'asciutto del
   * solo livello toccato si aggiunge qui. Un pezzo che continua un tratto
   * spezzato si fonde nel passo del pezzo di prima (A4). Ciò che non si
   * scrive lo dice l'avviso della barra.
   */
  _writeStroke(stroke: InkLayerStroke, shape: readonly InkSample[] | null = null): void {
    const chain = stroke.continued ? this._inkChain : null;
    this._inkChain = null;
    if (this._destroyed || !this._doc || this._readOnly || this._isSceneOversized()) return;
    // Come prima di ogni gesto: il testo e poi il tratto, due passi. Il campo
    // resta aperto col suo testo.
    this._recordPending();
    const doc = this._doc;
    const layers = this._inkLayersNow();
    if (!layers) return;
    const bounds = strokeBounds(stroke.samples, stroke.brush.size);
    const holder = this._inkHolder(doc.nodes, layers, bounds);
    const ref: InkLayerRef = holder ? { node: holder.id } : "board";
    if (foreignInkLayer(layers, ref)) {
      this._showNotice(t("canvas.ink.foreign"));
      return;
    }
    // Sulla pagina di un PDF il tratto è della pagina se comincia lì (T19);
    // sulla griglia di un foglio, della cella sotto il centro (T37, T38).
    const page = holder ? pageAnchorAt(holder, this._pageBoxOf(holder.id), stroke.samples[0]) : null;
    const cell = holder && !page ? cellAnchorAt(holder, bounds, (point) => this._cellAtOf(holder.id, point)) : null;
    const made = strokeRecord(stroke, holder, { brush: stroke.brush, color: stroke.color, tool: stroke.tool }, Date.now(), page ?? cell);
    if (!made.ok) {
      // Un tocco che non fa contorno non è niente da dire.
      if (made.reason !== "empty") this._showNotice(t(made.reason === "full" ? "canvas.ink.full" : "canvas.ink.refused"));
      return;
    }
    // Il tratto entra con `add_strokes` (T24): la codifica dei punti è della
    // tela (N4), il livello, l'ordine dei campi e l'id li dà il nucleo.
    const { id: _id, ...fields } = made.record as unknown as Record<string, unknown>;
    const compiled = this._compileIntent([{ op: "add_strokes", layer: ref === "board" ? "board" : { node: ref.node }, strokes: [fields] }], "canvas.ink.refused");
    const added = compiled?.patches.find((patch): patch is InkPatch => patch.kind === "ink" && patch.after !== null);
    if (!compiled || !added?.after) return;
    const record = added.after as unknown as InkStrokeRecord;
    const before = this._source;
    const code = this._commitLocal(compiled.patches, "input", (step) => this._pushInkStep(step, chain), false);
    if (code !== true) {
      // Una trappola la dice il nucleo che si riapre.
      if (code !== "trap") this._showNotice(t(code === "limit" ? "canvas.ink.full" : "canvas.ink.refused"));
      return;
    }
    const top = this._undo[this._undo.length - 1];
    if (stroke.split && top) this._inkChain = { step: top, before: chain?.before ?? before };
    const dry = toDry(record, this._inkPaths);
    if (dry) this._paintStroke(holder, dry);
    if (this._intakeError) this._showNotice("");
    // Il pezzo di un tratto spezzato non si annuncia: lo dice l'ultimo.
    if (!stroke.split) {
      this._sayInkHolder(holder);
      this._inkGestureDone();
    }
    if (shape !== null) this._writeShape(stroke, shape, record, ref, holder, page ?? cell);
  }

  /**
   * La forma della penna ferma prende il posto del tratto `written`, appena
   * scritto, in un passo d'annulla suo (T87): un tratto `fub:ink` con lo
   * stesso id, la stessa penna, lo stesso colore, lo stesso spessore, la
   * stessa ancora e lo stesso posto nel livello. Annullare riporta il tratto
   * com'era. Una forma che non si scrive lascia il tratto e lo dice.
   */
  _writeShape(
    stroke: InkLayerStroke,
    shape: readonly InkSample[],
    written: InkStrokeRecord,
    ref: InkLayerRef,
    holder: CanvasNode | null,
    content: Parameters<typeof strokeRecord>[4],
  ): void {
    const start = this._inkEditStart();
    if (!start) return;
    const look = { brush: stroke.brush, color: stroke.color, tool: stroke.tool };
    const made = strokeRecord({ samples: shape, pressure: stroke.pressure, split: false }, holder, look, Date.now(), content);
    if (!made.ok) {
      if (made.reason !== "empty") this._showNotice(t(made.reason === "full" ? "canvas.ink.full" : "canvas.ink.refused"));
      return;
    }
    const after: Record<string, unknown> = { ...made.record, id: written.id };
    if (written.at === undefined) delete after.at;
    else after.at = written.at;
    // Il tratto appena scritto è l'ultimo del suo livello: toglierlo e
    // rimettere la forma con lo stesso id la lascia al suo posto (T24).
    const layer = ref === "board" ? "board" : { node: ref.node };
    const patches = this._compileOps([
      { op: "erase_strokes", layer, ids: [written.id] },
      { op: "add_strokes", layer, strokes: [after] },
    ]);
    if (patches) this._commitInkEdit(inkPatches(patches));
  }

  /**
   * Il tratto della punta `start` comincia: la sua guida (T87), col righello di
   * adesso, lo zoom di adesso e Maiusc letto quando serve. Campioni nuovi che
   * fanno uscire la punta dal punto fermo fanno ripartire il mezzo secondo;
   * nessun riconoscimento a ogni campione.
   */
  _inkGuideStart(start: InkGuideStart): InkGuide {
    const guide = new StrokeGuide({
      pointer: start.pointerType,
      tool: start.look.tool,
      size: start.look.brush.size,
      zoom: this._camera.zoom,
      ruler: this._inkRuler?.ruler ?? null,
      continued: start.continued,
      shift: () => this._shiftHeld,
    });
    this._inkGuides.set(start.id, guide);
    return {
      add: (samples) => {
        if (guide.add(samples)) this._armShape(start.id);
      },
      trail: (samples, predicted) => guide.trail(samples, predicted),
    };
  }

  /** Il mezzo secondo della penna ferma riparte per il tratto `id`. */
  _armShape(id: number): void {
    clearTimeout(this._shapeTimer);
    this._shapeTimer = setTimeout(() => {
      this._shapeTimer = undefined;
      const guide = this._inkGuides.get(id);
      if (this._destroyed || !guide || !guide.hold()) return;
      this._inkLayer?.repaint();
      const shape = guide.shapeNow();
      if (shape) this._sayGesture(t("canvas.ink.shape", { kind: t(`canvas.ink.shape.${shapeKind(shape)}`) }));
    }, HOLD_MS);
  }

  /** Il tratto `id` è finito o annullato: la sua guida e il suo mezzo secondo se ne vanno. */
  _inkGuideDrop(id: number): void {
    if (!this._inkGuides.delete(id)) return;
    clearTimeout(this._shapeTimer);
    this._shapeTimer = undefined;
  }

  /** Maiusc tenuto o lasciato: a penna giù la scia si raddrizza o torna com'era subito. */
  _setShiftHeld(held: boolean): void {
    if (held === this._shiftHeld) return;
    this._shiftHeld = held;
    if (this._inkGuides.size > 0) this._inkLayer?.repaint();
  }

  /**
   * La pagina che la scheda `id` mostra e dove (T19): la chiede alla sua
   * vista; `null` se la scheda non ha una vista o non mostra una pagina.
   */
  _pageBoxOf(id: string): CardPageBox | null {
    const view = this._cards.get(id)?.view;
    if (!view?.pageBox) return null;
    try {
      return view.pageBox();
    } catch (error) {
      // Una vista che lancia non ferma l'inchiostro: la pagina non si vede.
      console.warn(`canvas: la pagina della scheda ${id} non si misura`, error);
      return null;
    }
  }

  /** `_pageBoxOf` come funzione, per la gomma e il Lazo (`erasableInk`). */
  readonly _pagesShown = (id: string): CardPageBox | null => this._pageBoxOf(id);

  /**
   * La cella sotto `point` (dall'angolo della scheda) nella scheda di foglio
   * `id` (T38): la chiede alla sua vista; `null` se la scheda non ha una
   * vista o lì non c'è una cella.
   */
  _cellAtOf(id: string, point: { readonly x: number; readonly y: number }): CardCellBox | null {
    const view = this._cards.get(id)?.view;
    if (!view?.cellAt) return null;
    try {
      return view.cellAt(point);
    } catch (error) {
      // Una vista che lancia non ferma l'inchiostro: il tratto è della scheda.
      console.warn(`canvas: la cella della scheda ${id} non si trova`, error);
      return null;
    }
  }

  /**
   * Dove la scheda di foglio `id` mostra la cella `cell` del foglio `sheet`
   * (T38): lo chiede alla sua vista; `null` se non la mostra.
   */
  _cellRectOf(id: string, sheet: string, cell: string): CardCellBox | null {
    const view = this._cards.get(id)?.view;
    if (!view?.cellRect) return null;
    try {
      return view.cellRect(sheet, cell);
    } catch (error) {
      // Una vista che lancia non ferma l'inchiostro: la cella non si vede.
      console.warn(`canvas: la cella ${cell} della scheda ${id} non si misura`, error);
      return null;
    }
  }

  /** `_cellRectOf` come funzione, per la gomma e il Lazo (`erasableInk`). */
  readonly _cellsShown = (id: string, sheet: string, cell: string): CardCellBox | null => this._cellRectOf(id, sheet, cell);

  /**
   * La proporzione del contenuto che la scheda `id` mostra (T39): la chiede
   * alla sua vista; `null` se la scheda non ha una vista o non la sa.
   */
  _contentAspectOf(id: string): number | null {
    const view = this._cards.get(id)?.view;
    if (!view?.contentAspect) return null;
    try {
      const aspect = view.contentAspect();
      return typeof aspect === "number" && Number.isFinite(aspect) && aspect > 0 ? aspect : null;
    } catch (error) {
      // Una vista che lancia non ferma l'inchiostro: segue tutta la scheda.
      console.warn(`canvas: il contenuto della scheda ${id} non si misura`, error);
      return null;
    }
  }

  /**
   * La proporzione del contenuto della scheda che tiene il livello `layer`,
   * per le operazioni che il nucleo compila (`move_strokes`,
   * `restyle_strokes`, T98): la stessa della resa, così il tratto va dove lo
   * porta il puntatore. `null` per la radice e per le schede che non scalano.
   */
  _layerAspect(layer: InkLayerRef): number | null {
    if (layer === "board") return null;
    const node = this._doc?.nodes.find((one) => one.id === layer.node);
    return node && inkFitMode(node) === "scale" ? this._contentAspectOf(node.id) : null;
  }

  /** `_contentAspectOf` come funzione, per la gomma e il Lazo (`erasableInk`). */
  readonly _aspectsShown = (id: string): number | null => this._contentAspectOf(id);

  /**
   * Disegna i tratti `drys` dentro l'elemento della scheda `node`: col modo
   * della scheda, la pagina che mostra (T19), le celle che mostra (T38) e la
   * proporzione del suo contenuto (T39), che chiede solo alle schede `scale`.
   */
  _paintCardInk(element: HTMLElement, node: CanvasNode, drys: readonly DryStroke[]): void {
    const mode = inkFitMode(node);
    const aspect = mode === "scale" && drys.length > 0 ? this._contentAspectOf(node.id) : null;
    const cells = drys.some((dry) => dry.cell !== undefined)
      ? (sheet: string, cell: string) => this._cellRectOf(node.id, sheet, cell)
      : null;
    paintCard(element, drys, mode, drys.length > 0 ? this._pageBoxOf(node.id) : null, aspect, cells);
    syncInkReflow(element, inkReflowWidth(node, drys), !this._readOnly);
  }

  /**
   * «Torna a N px» dell'avviso dei tratti sul testo (`ink-reflow.ts`): la
   * scheda `id` riprende la larghezza `width` in cui i tratti sono stati
   * scritti, col lato sinistro fermo e la sua altezza, in un passo d'annulla.
   */
  _restoreInkWidth(id: string, width: number): void {
    const node = this._doc?.nodes.find((entry) => entry.id === id);
    if (!node || this._readOnly || this._isSceneOversized() || !(width > 0) || node.width === width) return;
    // La misura l'ha scelta chi usa: scrivendo la scheda non si allarga più (T44).
    this._sizedByHand.add(id);
    this._writeOps([{ op: "resize", id, width, height: node.height }]);
  }

  /**
   * La scheda `entry` mostra un'altra pagina, o nessuna (T19), il suo
   * contenuto ha cambiato proporzione (T39) o le sue celle si sono spostate
   * (T38): si ridisegna il suo solo inchiostro, coi tratti già calcolati,
   * subito, nello stesso fotogramma della scheda.
   */
  _pageShown(entry: CardEntry): void {
    if (this._destroyed || !this._doc || this._isSceneOversized()) return;
    const drys = this._inkCards.get(entry.id);
    if (!drys || drys.length === 0) return;
    this._paintCardInk(entry.article, entry.node, drys);
  }

  /** Aggiunge l'asciutto di un tratto appena scritto al solo livello che lo tiene. */
  _paintStroke(holder: CanvasNode | null, dry: DryStroke): void {
    if (!holder) {
      this._inkBoard = [...this._inkBoard, dry];
      paintBoard(this._stage, this._inkBoard);
      return;
    }
    const drys = [...(this._inkCards.get(holder.id) ?? []), dry];
    this._inkCards.set(holder.id, drys);
    const element = this._stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(holder.id)}"]`);
    // Una scheda arrivata da fuori a penna giù non è ancora sulla scena: la
    // disegna il ridisegno rimandato.
    if (element) this._paintCardInk(element, holder, drys);
  }

  /**
   * Il passo d'annulla di un tratto: nuovo, o fuso col pezzo di prima dello
   * stesso tratto se nel frattempo il testo non è cambiato.
   */
  _pushInkStep(step: CanvasStep, chain: InkChain | null): void {
    const top = this._undo[this._undo.length - 1];
    if (chain && top === chain.step && top.version === step.restores) {
      this._undo[this._undo.length - 1] = mergeSteps(chain.before, top, step, this._source);
      this._redo = [];
      return;
    }
    this._pushUndo(step, true);
  }

  // --- a chi appartiene il tratto (T69) -------------------------------------

  /**
   * La scheda a cui si attacca il tratto di riquadro `bounds`, o `null` se
   * resta libero: la regola di N4 (`anchorAt`), che non sceglie le schede col
   * livello d'inchiostro di un altro programma; con Alt tenuto, libero.
   * L'etichetta e l'alzata la chiedono qui tutte e due.
   */
  _inkHolder(nodes: readonly CanvasNode[], layers: readonly CanvasInkLayer[], bounds: Bounds): CanvasNode | null {
    if (this._altHeld) return null;
    return anchorAt(nodes, bounds, (node) => !foreignInkLayer(layers, { node: node.id }));
  }

  /** Un appoggio sulla vista: il punto da cui partirà il riquadro, se diventa un tratto. */
  _inkSeen(event: PointerEvent): void {
    const at = this._inkAt;
    at.pointerId = event.pointerId;
    at.clientX = event.clientX;
    at.clientY = event.clientY;
  }

  /**
   * Comincia un tratto della punta (chiamato da `look`, una volta per tratto e
   * per pezzo): si ricordano lo spessore e la vista, già misurata da chi ha
   * appena portato l'appoggio nella lavagna. L'etichetta nasce al primo
   * movimento: un tocco non la mostra.
   */
  _inkTargetStarting(size: number): void {
    this._inkTargetClose();
    if (this._destroyed) return;
    this._inkStarting = { size, view: this._viewport.getBoundingClientRect() };
    // La cattura porta il passaggio alla vista: la scheda sotto la punta tiene il suo aspetto (T20f).
    this._holdHover(this._hoverCard);
  }

  /**
   * Un movimento sulla vista, dopo lo strato della penna: la scia è già
   * disegnata. A penna su non fa niente; a penna giù allarga il riquadro coi
   * punti dell'evento e rifà l'ancora solo se il riquadro è cresciuto. Il
   * browser manda un `pointermove` per fotogramma: al più un aggiornamento per
   * fotogramma, senza `requestAnimationFrame` (DEC-26).
   */
  _inkTargetMove(event: PointerEvent): void {
    if (!this._inkTarget && !this._inkStarting) return;
    const target = this._inkTarget ?? this._inkTargetOpen(event.pointerId);
    if (!target || event.pointerId !== target.pointerId) return;
    // Alt preso o lasciato senza che la finestra lo sapesse (il fuoco altrove).
    if (event.altKey !== this._altHeld) {
      this._altHeld = event.altKey;
      target.holder = undefined;
    }
    const { zoom, x, y } = this._camera;
    const { left, top } = target.view;
    const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    let grew = false;
    for (const one of coalesced.length > 0 ? coalesced : [event]) {
      if (target.box.add((one.clientX - left - x) / zoom, (one.clientY - top - y) / zoom)) grew = true;
    }
    this._inkSeen(event);
    this._inkTargetShow(target, grew);
  }

  /** Apre l'etichetta del tratto appena cominciato, dal punto dell'appoggio. */
  _inkTargetOpen(pointerId: number): InkTarget | null {
    const starting = this._inkStarting;
    this._inkStarting = null;
    if (!starting || this._destroyed || !this._doc) return null;
    const marks = this._inkMarksNow();
    marks.label.removeAttribute("data-idle");
    const target: InkTarget = {
      pointerId,
      box: new StrokeBox(),
      size: starting.size,
      view: starting.view,
      label: marks.label,
      frames: marks.frames,
      holder: undefined,
    };
    this._inkTarget = target;
    const at = this._inkAt;
    if (at.pointerId === pointerId) {
      const { zoom, x, y } = this._camera;
      target.box.add((at.clientX - starting.view.left - x) / zoom, (at.clientY - starting.view.top - y) / zoom);
    }
    return target;
  }

  /**
   * Mostra l'ancora del riquadro di adesso: il bordo tratteggiato passa alla
   * scheda nuova e il testo cambia solo quando l'ancora cambia (`grew` dice se
   * c'è da rifarla); l'etichetta segue la punta, accanto e mai sotto.
   */
  _inkTargetShow(target: InkTarget, grew: boolean): void {
    // Un ridisegno della scena toglie ciò che non è una scheda: i lati si rimettono.
    if (target.holder && !target.frames.isConnected) target.holder = undefined;
    if (grew || target.holder === undefined) {
      const doc = this._doc;
      const layers = this._inkLayersNow();
      const holder = doc && layers ? this._inkHolder(doc.nodes, layers, target.box.bounds(target.size)) : null;
      const id = holder?.id ?? null;
      if (id !== target.holder) {
        target.holder = id;
        this._placeInkFrame(target.frames, holder);
        const text = inkHolderText(holder);
        // Lo stesso testo del tratto prima non si riscrive: niente misura nuova.
        if (target.label.textContent !== text) target.label.textContent = text;
        target.label.toggleAttribute("data-free", holder === null);
      }
    }
    this._placeInkLabel(target);
  }

  /** L'etichetta accanto alla punta, con la misura che ha già: nessuna lettura del layout. */
  _placeInkLabel(target: InkTarget): void {
    this._placeInkLabelAt(target.view, this._inkAt.clientX, this._inkAt.clientY);
  }

  /** L'etichetta accanto al punto `clientX`, `clientY` della vista `view`: per la penna e per il Lazo (T86). */
  _placeInkLabelAt(view: DOMRect, clientX: number, clientY: number): void {
    const marks = this._inkMarks;
    if (!marks) return;
    const { left, top, width } = view;
    const px = clientX - left;
    const py = clientY - top;
    // Sopra a destra della punta; a sinistra o sotto se lì non c'è posto.
    marks.label.toggleAttribute("data-flip-x", px + marks.gap + marks.width > width);
    marks.label.toggleAttribute("data-flip-y", py - marks.gap - marks.height < 0);
    marks.label.style.setProperty("--canvas-ink-x", `${px}px`);
    marks.label.style.setProperty("--canvas-ink-y", `${py}px`);
  }

  /**
   * Mette il bordo tratteggiato attorno a `holder`, nelle coordinate della
   * lavagna (lo stage lo porta con la camera), o lo toglie se il tratto è
   * libero. Lo stacco e lo spessore sono in `structure.css`, il colore nella pelle.
   *
   * Il contenitore è uno strato composto suo (T20f): si scrive solo ciò che è
   * cambiato, così un tratto che comincia sulla scheda del tratto prima cambia
   * solo `data-idle`, cioè l'opacità dello strato, e non ridipinge niente.
   */
  _placeInkFrame(frames: HTMLElement, holder: CanvasNode | null): void {
    if (!holder) {
      frames.setAttribute("data-idle", "");
      return;
    }
    if (frames.dataset.node !== holder.id) frames.dataset.node = holder.id;
    // I lati ereditano la misura dal contenitore: quattro proprietà, non sedici.
    setPixels(frames, "--canvas-frame-x", holder.x);
    setPixels(frames, "--canvas-frame-y", holder.y);
    setPixels(frames, "--canvas-frame-w", holder.width);
    setPixels(frames, "--canvas-frame-h", holder.height);
    if (!frames.isConnected) this._stage.append(frames);
    frames.removeAttribute("data-idle");
  }

  /** L'etichetta e i lati del bordo: creati la prima volta, poi gli stessi. */
  _inkMarksNow(): InkMarks {
    if (this._inkMarks) return this._inkMarks;
    const label = document.createElement("div");
    label.className = "canvas-ink-label";
    // A penna su resta al suo posto, invisibile: mostrarla non rifà il layout.
    label.setAttribute("data-idle", "");
    // Il lettore di schermo la sente all'alzata, non a ogni cambio.
    label.setAttribute("aria-hidden", "true");
    this._viewport.append(label);
    const frames = document.createElement("div");
    frames.className = "canvas-ink-frames";
    // Come l'etichetta: si nasconde con `data-idle`, mai con `hidden`. Le
    // regole `:has()` della shell leggono `[hidden]` dentro `#layout`,
    // `#panes` e `.pane`: cambiarlo qui sotto farebbe ricalcolare lo stile di
    // tutta la finestra all'inizio di ogni tratto (80–140 ms col foglio vivo).
    frames.setAttribute("data-idle", "");
    frames.setAttribute("aria-hidden", "true");
    for (const side of INK_FRAME_SIDES) {
      const edge = document.createElement("div");
      edge.className = "canvas-ink-frame";
      edge.dataset.side = side;
      frames.append(edge);
    }
    this._stage.append(frames);
    const marks: InkMarks = {
      label,
      frames,
      width: 0,
      height: 0,
      gap: 0,
    };
    this._inkMarks = marks;
    if (typeof ResizeObserver !== "undefined") {
      // Il testo cambiato si misura dopo il layout del fotogramma, non quando cambia.
      const observer = new ResizeObserver(() => {
        marks.width = label.offsetWidth;
        marks.height = label.offsetHeight;
        if (marks.gap === 0) marks.gap = parseFloat(getComputedStyle(label).getPropertyValue("--canvas-ink-label-gap")) || 0;
        if (this._inkTarget) this._placeInkLabel(this._inkTarget);
        const drag = this._strokeDrag;
        if (drag?.moved) this._placeInkLabelAt(drag.view, drag.clientX, drag.clientY);
      });
      observer.observe(label);
      this._life.add(() => observer.disconnect());
    }
    return marks;
  }

  /** Il tratto è finito o non c'è più: via l'etichetta e il bordo. */
  _inkTargetClose(): void {
    this._inkStarting = null;
    const target = this._inkTarget;
    if (!target) return;
    this._inkTarget = null;
    target.frames.setAttribute("data-idle", "");
    target.label.setAttribute("data-idle", "");
    // Sotto il velo il puntatore può aver lasciato la scheda tenuta senza un
    // `pointerover`: se il tratto non era suo, a penna su la lascia (T20f).
    const held = this._heldCard;
    if (held && held.dataset.node !== target.holder) this._holdHover(null);
  }

  /** Alt tenuto o lasciato: a penna giù l'etichetta lo dice subito, anche se la punta è ferma. */
  _setAltHeld(held: boolean): void {
    if (held === this._altHeld) return;
    this._altHeld = held;
    const target = this._inkTarget;
    if (target) {
      target.holder = undefined;
      this._inkTargetShow(target, false);
    }
    // Spostando i tratti col Lazo, Alt li lascia liberi anche a puntatore fermo (T86).
    const drag = this._strokeDrag;
    if (drag?.moved && drag.units.length > 0) this._showStrokeHolder(drag);
  }

  /**
   * Dice al lettore di schermo a che cosa si è attaccato il tratto appena
   * scritto, con le parole dell'etichetta; lo stesso testo di prima non si
   * ripete, così una pagina di tratti sulla stessa scheda resta in silenzio.
   */
  _sayInkHolder(holder: CanvasNode | null): void {
    if (this._destroyed) return;
    let said = this._inkSaid;
    if (!said) {
      said = document.createElement("div");
      said.className = "sr-only canvas-ink-said";
      said.setAttribute("role", "status");
      said.setAttribute("aria-live", "polite");
      this._root.append(said);
      this._inkSaid = said;
    }
    const text = inkHolderText(holder);
    if (said.textContent !== text) said.textContent = text;
  }

  // --- il Lazo (T86) ------------------------------------------------------------

  /**
   * I tratti scelti col Lazo che ci sono ancora e si vedono, in coordinate
   * della lavagna; non quelli delle schede scelte, che vanno con loro.
   */
  _chosenStrokes(): ErasableInk[] {
    if (this._strokeSelection.size === 0 || !this._doc || this._isSceneOversized()) return [];
    const cards = new Set(this._selection);
    return erasableInk(this._inkStateList(), this._pagesShown, this._aspectsShown, this._cellsShown)
      .filter((unit) => this._strokeSelection.has(unit.key) && (unit.node === null || !cards.has(unit.node)));
  }

  /** I tratti scelti come li mostra la barra della selezione: colore, spessore sullo schermo, sola lettura. */
  _strokesShown(units: readonly ErasableInk[]): SelectionBarStrokes | null {
    if (units.length === 0) return null;
    const zoom = this._camera.zoom;
    const colors = new Set(units.map((unit) => unit.stroke.color.toLowerCase()));
    // Lo spessore come si vede, al mezzo pixel: il passo del cursore.
    const widths = new Set(units.map((unit) => Math.round(unit.stroke.brush.size * unit.fit.s * zoom * 2) / 2));
    const [color] = colors;
    const [width] = widths;
    return {
      count: units.length,
      color: colors.size === 1 ? color! : null,
      width: widths.size === 1 ? width! : null,
      tool: units.every((unit) => unit.stroke.tool === "highlighter") ? "highlighter" : "pen",
      off: this._readOnly ? t("canvas.commands.why.read_only") : null,
    };
  }

  /** Lo strato del lazo, creato la prima volta e poi lo stesso, in cima allo stage. */
  _lassoLayerNow(): LassoLayer {
    let layer = this._lassoLayer;
    if (!layer) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "canvas-lasso");
      svg.setAttribute("aria-hidden", "true");
      const chosen = document.createElementNS(ns, "g");
      chosen.setAttribute("class", "canvas-lasso-chosen");
      const frame = document.createElementNS(ns, "rect");
      frame.setAttribute("class", "canvas-lasso-frame");
      const path = document.createElementNS(ns, "path");
      path.setAttribute("class", "canvas-lasso-path");
      svg.append(chosen, frame, path);
      layer = { svg, chosen, frame, path };
      this._lassoLayer = layer;
    }
    if (this._stage.lastElementChild !== layer.svg) this._stage.append(layer.svg);
    return layer;
  }

  /**
   * Disegna lo strato del lazo: il giro in corso, i tratti scelti col loro
   * contorno d'accento e la cornice tratteggiata attorno. Spostandosi, i
   * tratti portano il loro colore sopra gli originali attenuati. Senza giro
   * e senza tratti scelti lo strato esce dallo stage.
   */
  _paintLasso(): void {
    if (this._destroyed) return;
    const lasso = this._lasso;
    const drag = this._strokeDrag;
    const units = drag ? drag.units : this._chosenStrokes();
    if (!lasso && units.length === 0) {
      this._lassoLayer?.svg.remove();
      return;
    }
    const layer = this._lassoLayerNow();
    layer.path.setAttribute("d", lasso ? lassoPath(lasso.points) : "");
    const moving = drag !== null && drag.moved;
    const paths = layer.chosen.children;
    let count = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const unit of units) {
      const dry = dryStroke(unit.stroke, this._inkPaths);
      if (!dry) continue;
      let path = paths[count] as SVGPathElement | undefined;
      if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        layer.chosen.append(path);
      }
      count += 1;
      path.setAttribute("d", dry.path);
      path.setAttribute("transform", `matrix(${unit.fit.s} 0 0 ${unit.fit.s} ${unit.fit.x} ${unit.fit.y})`);
      path.setAttribute("fill", moving ? dry.fill : "none");
      if (moving && dry.opacity !== undefined) path.setAttribute("fill-opacity", String(dry.opacity));
      else path.removeAttribute("fill-opacity");
      minX = Math.min(minX, unit.minX);
      minY = Math.min(minY, unit.minY);
      maxX = Math.max(maxX, unit.maxX);
      maxY = Math.max(maxY, unit.maxY);
    }
    while (paths.length > count) paths[paths.length - 1]!.remove();
    if (count > 0) {
      // Qualche pixel dello schermo attorno ai tratti, a ogni zoom.
      const pad = LASSO_FRAME_PAD / this._camera.zoom;
      layer.frame.setAttribute("x", String(minX - pad));
      layer.frame.setAttribute("y", String(minY - pad));
      layer.frame.setAttribute("width", String(maxX - minX + 2 * pad));
      layer.frame.setAttribute("height", String(maxY - minY + 2 * pad));
      layer.frame.removeAttribute("display");
    } else {
      layer.frame.setAttribute("display", "none");
    }
    this._shiftLasso(moving ? drag.dx : 0, moving ? drag.dy : 0);
  }

  /** Porta i tratti scelti e la loro cornice di `dx`, `dy`, senza ridisegnarli. */
  _shiftLasso(dx: number, dy: number): void {
    const layer = this._lassoLayer;
    if (!layer) return;
    const shift = dx === 0 && dy === 0 ? null : `translate(${dx} ${dy})`;
    for (const element of [layer.chosen, layer.frame]) {
      if (shift === null) element.removeAttribute("transform");
      else element.setAttribute("transform", shift);
    }
  }

  /** Comincia un giro del Lazo dal punto dell'appoggio; con Maiusc aggiungerà alla scelta. */
  _beginLasso(event: PointerEvent): void {
    this._lasso = {
      pointerId: event.pointerId,
      points: [this._screenToWorld(event.clientX, event.clientY)],
      additive: event.shiftKey,
      pressed: this._nodeAt(this._targetOf(event)),
    };
    this._viewport.setPointerCapture?.(event.pointerId);
    this._paintLasso();
  }

  /** Il giro cresce coi punti dell'evento che si allontanano dall'ultimo (un passo per pixel dello schermo). */
  _moveLasso(event: PointerEvent): void {
    const lasso = this._lasso;
    if (!lasso) return;
    const rect = this._viewport.getBoundingClientRect();
    const { x, y, zoom } = this._camera;
    const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    let grew = false;
    for (const one of coalesced.length > 0 ? coalesced : [event]) {
      const point = { x: (one.clientX - rect.left - x) / zoom, y: (one.clientY - rect.top - y) / zoom };
      if (extendLasso(lasso.points, point, LASSO_MIN_STEP / zoom)) grew = true;
    }
    if (grew) this._lassoLayer?.path.setAttribute("d", lassoPath(lasso.points));
  }

  /**
   * Il giro chiuso sceglie le schede tutte dentro e i tratti coi punti tutti
   * dentro (`lasso.ts`); i tratti delle schede scelte vanno con loro e non si
   * scelgono a parte. Con Maiusc si aggiunge alla scelta. Un giro senza area è
   * un clic: sceglie la scheda sotto, o toglie la scelta.
   */
  _endLasso(): void {
    const lasso = this._lasso;
    this._lasso = null;
    const doc = this._doc;
    if (!lasso || !doc) {
      this._paintLasso();
      return;
    }
    const loop = new Lasso(lasso.points);
    if (!loop.closed) {
      if (lasso.pressed !== null) this._selectNode(lasso.pressed, lasso.additive);
      else if (!lasso.additive) this._clearSelection();
      this._paintLasso();
      return;
    }
    const cards = doc.nodes.filter((node) => loop.containsBox(node)).map((node) => node.id);
    const selection = lasso.additive ? [...this._selection, ...cards.filter((id) => !this._selection.includes(id))] : cards;
    const held = new Set(selection);
    const strokes: string[] = [];
    for (const unit of erasableInk(this._inkStateList(), this._pagesShown, this._aspectsShown, this._cellsShown)) {
      if (unit.node !== null && held.has(unit.node)) continue;
      // Un tratto di pagina (T19) o di cella (T38) il Lazo non lo prende: il
      // nucleo non sa dove la pagina o la cella sta nella scheda, e non lo
      // sposta né lo ridimensiona.
      if (unit.stroke.page !== null || unit.stroke.cell !== null) continue;
      // Il riquadro prima dei punti: i tratti lontani si lasciano subito.
      if (unit.maxX < loop.minX || unit.minX > loop.maxX || unit.maxY < loop.minY || unit.minY > loop.maxY) continue;
      if (loop.containsPoints(unit.points)) strokes.push(unit.key);
    }
    this._selection = selection;
    this._edgeSelection = [];
    this._strokeSelection = new Set(lasso.additive ? [...this._strokeSelection, ...strokes] : strokes);
    this._options.onSelectionChange();
    this._displaySelection();
  }

  /** L'appoggio cade dentro ciò che il Lazo ha scelto: la cornice dei tratti, o una scheda scelta. */
  _insideChosen(event: PointerEvent): boolean {
    const { x, y } = this._screenToWorld(event.clientX, event.clientY);
    for (const node of this._selectedNodes()) {
      if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) return true;
    }
    const units = this._chosenStrokes();
    if (units.length === 0) return false;
    const pad = LASSO_FRAME_PAD / this._camera.zoom;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const unit of units) {
      minX = Math.min(minX, unit.minX);
      minY = Math.min(minY, unit.minY);
      maxX = Math.max(maxX, unit.maxX);
      maxY = Math.max(maxY, unit.maxY);
    }
    return x >= minX - pad && x <= maxX + pad && y >= minY - pad && y <= maxY + pad;
  }

  /** Comincia a spostare le schede scelte (coi gruppi, ciò che contengono) e i tratti scelti. */
  _beginStrokeDrag(event: PointerEvent): void {
    const doc = this._doc;
    if (!doc) return;
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of this._selection) {
      const node = doc.nodes.find((n) => n.id === id);
      if (node) origin.set(id, { x: node.x, y: node.y });
    }
    for (const group of doc.nodes.filter((node) => origin.has(node.id) && node.type === "group")) {
      for (const child of doc.nodes) {
        if (child.id !== group.id && child.x >= group.x && child.y >= group.y
          && child.x + child.width <= group.x + group.width
          && child.y + child.height <= group.y + group.height) {
          origin.set(child.id, { x: child.x, y: child.y });
        }
      }
    }
    // I tratti delle schede che si spostano vanno con loro.
    const units = this._chosenStrokes().filter((unit) => unit.node === null || !origin.has(unit.node));
    this._strokeDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      units,
      view: this._viewport.getBoundingClientRect(),
      moved: false,
      dx: 0,
      dy: 0,
      clientX: event.clientX,
      clientY: event.clientY,
      holder: undefined,
    };
    this._viewport.setPointerCapture?.(event.pointerId);
  }

  /**
   * Le schede e i tratti scelti seguono il puntatore, in unità intere della
   * lavagna. Sopra un'altra scheda i tratti la accendono come la penna
   * (T69): bordo tratteggiato ed etichetta; Alt li lascia liberi.
   */
  _moveStrokeDrag(event: PointerEvent): void {
    const drag = this._strokeDrag;
    const doc = this._doc;
    if (!drag || !doc) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) <= 3) return;
    const first = !drag.moved;
    drag.moved = true;
    const zoom = this._camera.zoom;
    drag.dx = Math.round((event.clientX - drag.startX) / zoom);
    drag.dy = Math.round((event.clientY - drag.startY) / zoom);
    if (drag.origin.size > 0) {
      const byId = new Map(doc.nodes.map((node) => [node.id, node] as const));
      for (const [id, start] of drag.origin) {
        const node = byId.get(id);
        if (!node) continue;
        node.x = start.x + drag.dx;
        node.y = start.y + drag.dy;
      }
      this._renderLive();
    }
    if (first) {
      this._fadeUnits(drag.units, true);
      this._syncSelectionBar();
      this._paintLasso();
    } else {
      this._shiftLasso(drag.dx, drag.dy);
    }
    if (event.altKey !== this._altHeld) this._altHeld = event.altKey;
    if (drag.units.length > 0) this._showStrokeHolder(drag);
  }

  /**
   * La scheda che prenderebbe i tratti spostati adesso: la regola della penna
   * (`anchorAt`) sul loro riquadro spostato, fra le schede che non si
   * spostano con loro e non hanno il livello d'un altro programma; con Alt,
   * nessuna.
   */
  _strokeHolder(drag: StrokeDrag): CanvasNode | null {
    const doc = this._doc;
    const layers = this._inkLayersNow();
    if (this._altHeld || !doc || !layers || drag.units.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const unit of drag.units) {
      minX = Math.min(minX, unit.minX);
      minY = Math.min(minY, unit.minY);
      maxX = Math.max(maxX, unit.maxX);
      maxY = Math.max(maxY, unit.maxY);
    }
    const bounds = { x: minX + drag.dx, y: minY + drag.dy, width: maxX - minX, height: maxY - minY };
    return anchorAt(doc.nodes, bounds, (node) => !drag.origin.has(node.id) && !foreignInkLayer(layers, { node: node.id }));
  }

  /** Mostra a chi andranno i tratti spostati: il bordo attorno alla scheda e l'etichetta accanto al puntatore. */
  _showStrokeHolder(drag: StrokeDrag): void {
    const holder = this._strokeHolder(drag);
    const marks = this._inkMarksNow();
    const id = holder?.id ?? null;
    if (id !== drag.holder || !marks.frames.isConnected) {
      drag.holder = id;
      this._placeInkFrame(marks.frames, holder);
      const text = inkHolderText(holder);
      if (marks.label.textContent !== text) marks.label.textContent = text;
      marks.label.toggleAttribute("data-free", holder === null);
    }
    marks.label.removeAttribute("data-idle");
    this._placeInkLabelAt(drag.view, drag.clientX, drag.clientY);
  }

  /** Via il bordo e l'etichetta dello spostamento. */
  _hideStrokeHolder(): void {
    const marks = this._inkMarks;
    if (!marks || this._inkTarget) return;
    marks.frames.setAttribute("data-idle", "");
    marks.label.setAttribute("data-idle", "");
  }

  /** Il rilascio: il modello in mano torna quello del nucleo, poi lo spostamento va nel file. */
  _endStrokeDrag(): void {
    const drag = this._strokeDrag;
    this._strokeDrag = null;
    if (!drag) return;
    this._hideStrokeHolder();
    this._fadeUnits(drag.units, false);
    if (!drag.moved) {
      this._paintLasso();
      return;
    }
    this._doc = this._coreModel() ?? this._doc;
    this._moveChosen([...drag.origin.keys()], drag.units, drag.dx, drag.dy, drag.holder ?? null);
  }

  /**
   * Sposta in un commit solo, un passo d'annulla, le schede `cards` e i
   * tratti `units` di `dx`, `dy`: le schede con `move`, i tratti con
   * `move_strokes` livello per livello. Se i tratti finiscono su un'altra
   * scheda (`holder`) passano a lei, e l'avviso lo dice con «Annulla» e
   * «Rendilo libero». Ciò che il nucleo rifiuta lo dice l'avviso, e la
   * lavagna resta com'era.
   */
  _moveChosen(cards: readonly string[], units: readonly ErasableInk[], dx: number, dy: number, holder: string | null): void {
    const to: InkLayerRef = holder === null ? "board" : { node: holder };
    const ops: CanvasIntentOp[] = [];
    if (cards.length > 0 && (dx !== 0 || dy !== 0)) ops.push({ op: "move", ids: [...cards], dx, dy });
    const groups = strokesByLayer(units);
    let passed = false;
    for (const { layer, ids } of groups) {
      const same = sameLayer(layer, to);
      if (same && dx === 0 && dy === 0) continue;
      if (!same) passed = true;
      ops.push(moveStrokesOp(layer, ids, dx, dy, to, this._layerAspect(layer)));
    }
    const patches = ops.length > 0 ? this._compileOps(ops) : null;
    if (!patches || patches.length === 0) {
      this._render();
      return;
    }
    if (!this._commitChosen(patches)) {
      this._render();
      return;
    }
    const node = holder === null ? null : this._doc?.nodes.find((one) => one.id === holder) ?? null;
    if (passed && node) {
      const ids = patches.flatMap((patch) => patch.kind === "ink" && !patch.before && patch.after && sameLayer(patch.layer, to) ? [patch.after.id] : []);
      const name = cardMenuName(node);
      this._showRemoval(name ? t("canvas.ink.moved_to", { name }) : t("canvas.ink.moved_card"), true, { layer: to, ids });
    }
    this._statusSettle();
  }

  /**
   * Il commit delle toppe compilate dal Lazo, un passo d'annulla; i tratti
   * scelti restano scelti dove sono andati. `false` se il nucleo l'ha
   * rifiutato (l'avviso dice perché).
   */
  _commitChosen(patches: readonly CanvasPatch[]): boolean {
    const inkOnly = patches.every((patch) => patch.kind === "ink");
    const chosen = keysAfter(this._strokeSelection, patches);
    const code = this._commitLocal(patches, "input", (step) => this._pushUndo(step, true), !inkOnly);
    if (code !== true) {
      // Una trappola la dice il nucleo che si riapre.
      if (code !== "trap") this._showNotice(t(code === "limit" ? "canvas.ink.full" : "canvas.ink.refused"));
      return false;
    }
    this._inkChain = null;
    this._strokeSelection = chosen;
    if (inkOnly) this._paintInk();
    else this._paintLasso();
    if (this._intakeError) this._showNotice("");
    return true;
  }

  /** Le toppe delle operazioni d'intento `ops` sul modello di adesso; `null` se il nucleo le rifiuta (lo dice l'avviso). */
  _compileOps(ops: readonly CanvasIntentOp[]): CanvasPatch[] | null {
    return this._compileIntent(ops, "canvas.ink.refused")?.patches ?? null;
  }

  /** Il seme degli id nuovi di un'azione: quello delle opzioni, o uno a caso. */
  _seed(): bigint {
    return this._options.seed?.() ?? randomSeed();
  }

  /**
   * Compila le operazioni d'intento `ops` sul modello di adesso, dopo aver
   * registrato il testo in sospeso. `null` se la tela non scrive (sola
   * lettura, troppo grande, il nucleo non ancora pronto) o se il nucleo le
   * rifiuta: allora l'avviso `refused` lo dice (nessun avviso con `null`:
   * lo dà chi chiama).
   */
  _compileIntent(ops: readonly CanvasIntentOp[], refused: Key | null, seed?: bigint): CanvasCompiled | null {
    const core = this._core;
    if (!core || this._destroyed || this._readOnly || this._isSceneOversized()) return null;
    this._recordPending();
    try {
      return core.compile(ops, seed ?? this._seed());
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return null;
      }
      if (error instanceof CanvasCoreError) {
        if (refused !== null) this._showNotice(t(refused));
        return null;
      }
      throw error;
    }
  }

  /**
   * Un'azione del menu, della barra, di un campo o di un tasto (T23): le sue
   * operazioni d'intento, compilate dal nucleo e scritte in un passo
   * d'annulla, come le scrive `canvas.apply`. Torna gli id nati (schede, poi
   * fili, come `created`), o `null` se non ha scritto niente: nessuna
   * operazione, nessuna toppa, la tela che non scrive, o il nucleo che le
   * rifiuta (lo dice l'avviso `refused`, o nessuno con `null`, quando lo dà
   * chi chiama). Se il nucleo rifiuta la compilazione o il commit (un limite),
   * i campi della barra tornano al valore del modello. `seed` è quello di un
   * controllo già fatto («Incolla codice»), così gli id nati sono i suoi.
   */
  _writeOps(
    ops: readonly CanvasIntentOp[] | null,
    refused: Key | null = "canvas.change_refused",
    seed?: bigint,
  ): readonly string[] | null {
    if (!ops || ops.length === 0) return null;
    const compiled = this._compileIntent(ops, refused, seed);
    if (!compiled) {
      if (!this._destroyed) this._drawToolbar();
      return null;
    }
    if (compiled.patches.length === 0) return null;
    if (!this._commit(compiled.patches, "input")) {
      if (!this._destroyed) this._drawToolbar();
      return null;
    }
    return compiled.created;
  }

  /**
   * «Rendilo libero» dell'avviso: i tratti appena passati a una scheda
   * tornano liberi sulla lavagna, dove si vedono, in un passo d'annulla suo.
   * Vale finché lo spostamento è l'ultimo passo.
   */
  _freeMovedInk(): void {
    const removal = this._removal;
    const free = removal?.free;
    if (!removal || !free || removal.step === undefined || this._undo[this._undo.length - 1] !== removal.step) {
      this._dropRemoval();
      return;
    }
    const patches = this._compileOps([moveStrokesOp(free.layer, free.ids, 0, 0, "board", this._layerAspect(free.layer))]);
    if (patches && patches.length > 0 && this._commitChosen(patches)) this._dropRemoval();
    this._statusSettle();
    this._viewport.focus({ preventScroll: true });
  }

  /**
   * Cambia colore o spessore dei tratti scelti dalla barra della selezione,
   * livello per livello in un commit solo: un annulla per gesto. Lo spessore
   * arriva in pixel dello schermo e va nel file in unità della lavagna.
   */
  _restyleChosen(change: SelectionBarRestyle): void {
    if (this._destroyed || this._readOnly || this._isSceneOversized()) return;
    const units = this._chosenStrokes();
    if (units.length === 0) return;
    let style: { readonly color?: string; readonly size?: number };
    if ("color" in change) style = { color: change.color };
    else {
      const size = Math.round((change.width / this._camera.zoom) * 1000) / 1000;
      if (!(size > 0)) return;
      style = { size };
    }
    const ops = strokesByLayer(units).map(({ layer, ids }) =>
      restyleStrokesOp(layer, ids, style, "size" in style ? this._layerAspect(layer) : null),
    );
    const patches = this._compileOps(ops);
    if (patches && patches.length > 0) this._commitChosen(patches);
    this._statusSettle();
  }


  // --- camera ---------------------------------------------------------------

  _applyCamera(): void {
    // Camera transforms are immediate for both motion preferences.
    this._stage.style.transform = `translate(${this._camera.x}px, ${this._camera.y}px) scale(${this._camera.zoom})`;
    // Il filo sta nello stage (T91): la sua camera è quella dello stage. Le prese no.
    this._handleLayer.style.transform = `translate(${this._camera.x}px, ${this._camera.y}px) scale(${this._camera.zoom})`;
    this._inkLayer?.setCamera(this._camera.x, this._camera.y, this._camera.zoom);
    this._inkRuler?.place();
    this._paintGrid();
    // Le maniglie e i segni sopra le schede restano della stessa misura sullo
    // schermo a ogni zoom (T66): la pelle divide per `--canvas-zoom`.
    this._stage.style.setProperty("--canvas-zoom", String(this._camera.zoom));
    this._markAllHandles();
    // Il selettore delle sezioni resta attaccato alla sua scheda (T74).
    this._partsPicker?.handle.reposition();
    // E la barra del ritaglio alla sua (T78), e quella della selezione alle
    // schede scelte, anche durante lo zoom (#411 C-06).
    this._placeCropBar();
    this._followSelectionBar();
    // Anche la resa passa di qui: la scelta cambiata si ricorda con la camera.
    this._viewMemo?.changed();
    // Ogni cambio di zoom passa di qui (bottoni, tasti, menu, `fitCamera`): la
    // banda lo legge a fine gesto, dentro un gesto `_statusSettle` tace.
    this._statusSettle();
  }

  // --- riaprire dove eri (T36) ------------------------------------------------

  /** Ciò che si ricorda adesso: `null` se la lavagna non mostra un documento. */
  _viewSnapshot(): CanvasViewSnapshot {
    if (!this._doc) return null;
    const camera = { ...this._camera };
    const selection = [...this._selection];
    return {
      camera,
      selection,
      ...(this._navigatorHidden ? { navigatorHidden: true } : {}),
      ...(this._gridOverride !== null ? { grid: this._gridOverride } : {}),
    };
  }

  /** La lavagna si è appena mostrata: la vista ricordata, se arriva, parte da qui. */
  _markOpenView(): void {
    if (!this._viewMemo) return;
    this._openView = {
      camera: { ...this._camera },
      selection: this._selection.join("\n"),
      navigatorHidden: this._navigatorHidden,
      grid: this._gridOverride,
    };
  }

  /**
   * La vista ricordata per l'apertura `round`: la camera, se nessuno l'ha
   * mossa e se almeno una scheda cade nella vista ricordata (se no resta
   * «inquadra tutto»); la scelta, se è ancora vuota, con le sole schede che ci
   * sono; e le schede PDF già montate su un'altra pagina si rimontano sulla
   * loro. Arrivata prima che il nucleo aprisse il testo, aspetta `_revive`.
   */
  _restoreView(round: number, view: CanvasView | null): void {
    if (this._destroyed || round !== this._viewRound || view === null) return;
    const doc = this._doc;
    const open = this._openView;
    if (!doc || !open) {
      this._heldView = { round, view };
      return;
    }
    this._heldView = null;
    this._openView = null;
    let moved = false;
    const camera = view.camera;
    if (camera && sameViewport(this._camera, open.camera)) {
      const next: Viewport = { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom) };
      const seen = this._viewRectOf(next);
      if (doc.nodes.some((node) => overlaps(node, seen))) {
        this._camera = next;
        moved = true;
      }
    }
    let selected = false;
    if (view.selection.length > 0 && this._selection.join("\n") === open.selection && this._edgeSelection.length === 0) {
      const present = new Set(doc.nodes.map((node) => node.id));
      const selection = view.selection.filter((id) => present.has(id));
      if (selection.length > 0) {
        this._selection = selection;
        selected = true;
      }
    }
    // «Nascondi il navigatore» (T55), se nessuno l'ha cambiato nel frattempo.
    const hidden = view.navigatorHidden === true;
    if (this._navigatorHidden === open.navigatorHidden && hidden !== this._navigatorHidden) {
      this._navigatorHidden = hidden;
      this._statusSettle();
    }
    // La griglia di Ctrl+' per questa lavagna (T71), se nessuno l'ha cambiata nel frattempo.
    if (view.grid !== undefined && this._gridOverride === open.grid && this._gridOverride !== view.grid) {
      this._gridOverride = view.grid;
      this._paintGrid();
    }
    let remount = false;
    for (const entry of this._cards.values()) {
      const page = this._viewMemo?.page(entry.id) ?? null;
      const shown = entry.view?.page?.();
      if (page === null || shown === undefined || shown === page) continue;
      // Una chiave che nessun corpo ha: la resa smonta la vista e la rimonta.
      entry.bodyKey = null;
      remount = true;
    }
    if (!moved && !selected && !remount) return;
    this._render();
    if (selected) this._options.onSelectionChange();
  }

  _screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this._viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this._camera.x) / this._camera.zoom,
      y: (clientY - rect.top - this._camera.y) / this._camera.zoom,
    };
  }

  _fitCamera(announce = true, nodes = this._doc?.nodes ?? []): void {
    this._stopMotion(false);
    this._camera = this._fitTarget(nodes);
    if (announce) {
      this._applyCamera();
      this._refreshLive();
    }
  }

  /**
   * La camera che mostra tutte le schede `nodes` (T53: con `fit` di
   * `spatial/camera.ts`): al centro, con `FIT_MARGIN` per lato, mai oltre il
   * 100%. Senza schede, il 100% con l'origine in alto a sinistra.
   */
  _fitTarget(nodes: readonly CanvasNode[], margin = FIT_MARGIN): Viewport {
    if (!nodes.length) return { x: 24, y: 24, zoom: 1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    const rect = this._viewport.getBoundingClientRect();
    const view = { w: Math.max(1, rect.width || 800), h: Math.max(1, rect.height || 600) };
    // Il margine sta nei bordi, in unità della lavagna: il centro non cambia.
    const bounds = {
      minX: minX - margin,
      minY: minY - margin,
      maxX: Math.max(minX + 1, maxX) + margin,
      maxY: Math.max(minY + 1, maxY) + margin,
    };
    return fromCamera(fit(bounds, view, 0, 0, FIT_LIMITS));
  }

  _zoomAt(clientX: number, clientY: number, factor: number): void {
    this._stopMotion(false);
    const rect = this._viewport.getBoundingClientRect();
    const at = { x: clientX - rect.left, y: clientY - rect.top };
    this._camera = fromCamera(zoomAtPoint(toCamera(this._camera), factor, at, ZOOM_LIMITS));
    this._applyCamera();
    // Dai pulsanti e dai tasti lo zoom è un gesto finito; dalla rotella il
    // gesto è ancora in corso e `_refreshLive` aspetta che finisca.
    this._refreshLive();
  }

  // --- muoversi (T53) ---------------------------------------------------------

  /**
   * Il salto della camera a `target`: Maiusc+1, Maiusc+2, 0 e il clic nel
   * navigatore (T55). È il solo posto da cui la vista salta: qui il salto entra
   * nella storia di Indietro e Avanti (T56), se sposta la vista. Vola con
   * `stepCamera`; col movimento ridotto arriva subito, senza volo.
   */
  _jumpCamera(target: Viewport): void {
    const goal: Viewport = { x: target.x, y: target.y, zoom: clampZoom(target.zoom) };
    // Un salto che non sposta niente non entra nella storia.
    if (!sameViewport(goal, this._camera)) this._jumps.record(this._camera, goal);
    this._flyCamera(goal);
  }

  /**
   * Porta la vista a `target` senza ricordarlo: è il volo di ogni salto, e
   * anche di Indietro e Avanti (T56), che non scrivono una storia loro.
   */
  _flyCamera(target: Viewport): void {
    this._stopMotion(false);
    const goal: Viewport = { x: target.x, y: target.y, zoom: clampZoom(target.zoom) };
    if (this._reducedMotion || sameViewport(goal, this._camera)) {
      this._camera = goal;
      this._applyCamera();
      this._refreshLive();
      return;
    }
    const from = this._camera;
    this._runMotion({
      scale: from.zoom, tx: from.x, ty: from.y,
      targetScale: goal.zoom, targetTx: goal.x, targetTy: goal.y,
      vx: 0, vy: 0,
    });
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

  /**
   * Il velo dei risultati `matches` (`null` lo toglie), con quello di adesso
   * segnato: un giro sulle schede che scrive solo dove il segno cambia.
   */
  _showFound(matches: readonly FindTarget[] | null, current: number): void {
    this._findMarkOf = findMarks(matches, current);
    applyFindMarks(this._cards, this._findMarkOf);
  }

  /**
   * Il salto a un risultato (T60): le sue schede al centro della vista, con lo
   * zoom di adesso, o più lontano se non ci stanno. È un salto come gli altri
   * (`_jumpCamera`): Indietro torna da dove si era partiti; col movimento
   * ridotto arriva senza volo.
   */
  _jumpToFound(target: FindTarget): void {
    const ids = new Set(target.nodes);
    const nodes = (this._doc?.nodes ?? []).filter((node) => ids.has(node.id));
    if (nodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    const rect = this._viewport.getBoundingClientRect();
    const zoom = Math.min(this._camera.zoom, this._fitTarget(nodes).zoom);
    this._jumpCamera({
      x: (rect.width || 800) / 2 - ((minX + maxX) / 2) * zoom,
      y: (rect.height || 600) / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    });
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
   * «Nascondi il navigatore» e «Mostra il navigatore» (T55): per questa
   * lavagna, ricordato nella vista (T36). Il fuoco che stava sul navigatore
   * torna alla lavagna.
   */
  _setNavigatorHidden(hidden: boolean): void {
    if (this._navigatorClosed() === hidden) return;
    const focused = this._navigator.element.contains(document.activeElement);
    if (this._workspace.workspace === "simple") {
      // Nello spazio Semplice la scelta vale per questa apertura (T65).
      this._simpleNavigator = !hidden;
      this._statusSettle();
      if (focused && this._navigator.element.hidden) this._viewport.focus();
      return;
    }
    this._navigatorHidden = hidden;
    this._viewMemo?.changed();
    this._statusSettle();
    if (focused && this._navigator.element.hidden) this._viewport.focus();
  }

  /**
   * Il navigatore è chiuso per scelta: nello spazio Semplice finché non lo si
   * mostra (T65), nello Completo come dice la vista (T55).
   */
  _navigatorClosed(): boolean {
    return this._workspace.workspace === "simple" ? !this._simpleNavigator : this._navigatorHidden;
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

  // --- tastiera e lettore di schermo (T61) ------------------------------------

  /** La lettura della lavagna di adesso (`boardReading`): si rifà solo se il documento è cambiato. */
  _boardReading(): BoardReading | null {
    const doc = this._doc;
    if (!doc) return null;
    if (this._reading?.doc !== doc) this._reading = { doc, value: boardReading(doc) };
    return this._reading.value;
  }

  /** I nomi scritti sulle schede sono quelli del documento e della lingua di adesso. */
  _labelsCurrent(): boolean {
    const done = this._labelled;
    return !done.stale && done.doc === this._doc && done.round === this._languageRound;
  }

  /**
   * I nomi delle schede vecchi (un documento nuovo, una scheda nuova, un'altra
   * lingua): li riscrive quando il thread è libero, non durante la resa. La
   * scheda che prende il fuoco prima non aspetta: il suo lo scrive subito.
   */
  _scheduleLabels(): void {
    if (this._labelsPending !== null || this._destroyed || this._labelsCurrent()) return;
    this._labelsPending = this._labelsSchedule(() => this._labelStep());
  }

  /**
   * Un passo del giro dei nomi: `LABEL_BATCH` schede, poi il thread torna
   * libero e il giro riprende dove era. Un documento nuovo, una lingua nuova o
   * una scheda nata nel frattempo lo fanno ricominciare da capo.
   */
  _labelStep(): void {
    this._labelsPending = null;
    const doc = this._doc;
    if (!doc || this._destroyed || this._isSceneOversized()) return;
    let run = this._labelRun;
    if (!run || run.doc !== doc || run.round !== this._languageRound || this._labelled.stale) {
      run = { doc, round: this._languageRound, queue: [...this._cards.values()], at: 0 };
      this._labelled = { doc: null, round: -1, stale: false };
    }
    const end = Math.min(run.queue.length, run.at + LABEL_BATCH);
    for (; run.at < end; run.at++) {
      const entry = run.queue[run.at]!;
      if (this._cards.get(entry.id) === entry) this._labelCard(entry);
    }
    if (run.at < run.queue.length) {
      this._labelRun = run;
      this._labelsPending = this._labelsSchedule(() => this._labelStep());
      return;
    }
    this._labelRun = null;
    this._labelled = { doc, round: run.round, stale: false };
  }

  /** Il nome della scheda `entry` com'è adesso, scritto sul suo nodo se è cambiato. */
  _labelCard(entry: CardEntry): void {
    const doc = this._doc;
    const reading = this._boardReading();
    if (!doc || !reading) return;
    const label = cardLabel(entry.node, doc, reading);
    if (entry.label === label) return;
    entry.label = label;
    entry.article.setAttribute("aria-label", label);
  }

  /**
   * Sceglie la scheda `node`, la porta in vista e le dà il fuoco: Tab e
   * Alt+frecce. In vista vuol dire tutta dentro la vista; se no la vista vola
   * fino a metterla al centro col zoom di adesso (col movimento ridotto arriva
   * subito). Non è un salto di Indietro e Avanti: è un passo della tastiera,
   * come uno spostamento a mano.
   */
  _focusCard(node: CanvasNode): void {
    const entry = this._cards.get(node.id);
    if (!entry) return;
    if (this._selection.length !== 1 || this._selection[0] !== node.id || this._edgeSelection.length > 0) {
      this._selection = [node.id];
      this._edgeSelection = [];
      this._options.onSelectionChange();
      this._displaySelection();
    }
    const { view, zoom } = this._viewRect();
    const inside = node.x >= view.x && node.y >= view.y
      && node.x + node.width <= view.x + view.width && node.y + node.height <= view.y + view.height;
    if (!inside) {
      const rect = this._viewport.getBoundingClientRect();
      this._flyCamera({
        x: (rect.width || 800) / 2 - (node.x + node.width / 2) * zoom,
        y: (rect.height || 600) / 2 - (node.y + node.height / 2) * zoom,
        zoom,
      });
    }
    entry.article.focus({ preventScroll: true });
  }

  /**
   * Tab e Maiusc+Tab col fuoco sulla lavagna o su una scheda: la scheda dopo
   * o prima nell'ordine di lettura (T58). Dalla lavagna Tab va alla scheda
   * scelta, o alla prima; Maiusc+Tab dalla lavagna esce come sempre. Prima
   * della prima scheda si torna alla lavagna; dopo l'ultima il fuoco esce
   * dalla vista, verso ciò che la segue. Una lavagna senza schede non prende
   * il Tab: va ai pulsanti della lavagna vuota (T62). `true` se il tasto è suo.
   */
  _tabKey(event: KeyboardEvent): boolean {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (!this._onCardOrBoard(event.target)) return false;
    const reading = this._boardReading();
    if (!reading || reading.order.length === 0) return false;
    const step = event.shiftKey ? -1 : 1;
    const from = event.target === this._viewport ? null : this._nodeAt(event.target);
    if (from === null && step < 0) return false;
    const next = from === null ? this._selectionFocus() ?? stepInOrder(reading, null, 1) : stepInOrder(reading, from, step);
    if (next) {
      event.preventDefault();
      this._focusCard(next);
      return true;
    }
    if (step < 0) {
      event.preventDefault();
      this._viewport.focus({ preventScroll: true });
      return true;
    }
    const after = this._afterViewport();
    if (!after) return false;
    event.preventDefault();
    after.focus();
    return true;
  }

  /** Il primo elemento che il Tab raggiunge dopo la vista e fuori da lei. */
  _afterViewport(): HTMLElement | null {
    const viewport = this._viewport;
    return focusableElements(document.body).find((el) => !viewport.contains(el)
      && (viewport.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) ?? null;
  }

  /**
   * Alt+frecce col fuoco sulla lavagna o su una scheda (M1): la scheda più
   * vicina in quella direzione (`nearestCard`), da quella col fuoco o da
   * quella scelta; senza, la prima nell'ordine di lettura. Se da quella parte
   * non c'è niente lo dice la regione viva. Alt+← e Alt+→ solo col fuoco su
   * una scheda: sulla lavagna senza una scheda a fuoco, e fuori, restano
   * Indietro e Avanti dello Scrittoio (`shell.pane.back`/`forward`,
   * DECISIONS.md, T56). Il tasto preso non arriva al registro della shell.
   * `true` se il tasto è suo.
   */
  _nearestKey(event: KeyboardEvent): boolean {
    if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return false;
    const direction = NEAREST_CARD_KEYS.get(event.key);
    if (direction === undefined || !this._onCardOrBoard(event.target)) return false;
    if (CARD_ONLY_NEAREST_KEYS.has(event.key) && this._nodeAt(event.target) === null) return false;
    const reading = this._boardReading();
    if (!reading || reading.order.length === 0) return false;
    event.preventDefault();
    event.stopPropagation();
    const fromId = this._nodeAt(event.target) ?? (this._selection.length === 1 ? this._selection[0]! : null);
    const from = fromId === null ? undefined : reading.byId.get(fromId);
    const next = from ? nearestCard(from, reading, direction) : stepInOrder(reading, null, 1);
    if (next) this._focusCard(next);
    else this._sayGesture(t("canvas.a11y.none_that_way"));
    return true;
  }

  /** «0»: il 100% sul centro della vista. */
  _zoomToActual(): void {
    const rect = this._viewport.getBoundingClientRect();
    const center = { x: (rect.width || 800) / 2, y: (rect.height || 600) / 2 };
    this._jumpCamera(fromCamera(zoomAtPoint(toCamera(this._camera), 1 / this._camera.zoom, center, ZOOM_LIMITS)));
  }

  /**
   * L'inerzia dopo uno spostamento col dito: la vista va avanti alla
   * velocità del gesto (px al ms) e rallenta con `stepCamera`. Col movimento
   * ridotto niente.
   */
  _fling(vx: number, vy: number): void {
    if (this._reducedMotion || Math.hypot(vx, vy) < INERTIA_MIN_SPEED) return;
    const at = this._camera;
    this._runMotion({ scale: at.zoom, tx: at.x, ty: at.y, targetScale: at.zoom, targetTx: at.x, targetTy: at.y, vx, vy });
  }

  /** La velocità alla fine di uno spostamento, in px al ms, sugli ultimi `INERTIA_WINDOW_MS` della scia. */
  _panSpeed(trail: readonly PanSample[], end: PanSample): { vx: number; vy: number } {
    const first = trail.find((point) => end.t - point.t <= INERTIA_WINDOW_MS);
    if (!first || end.t - first.t <= 0) return { vx: 0, vy: 0 };
    return { vx: (end.x - first.x) / (end.t - first.t), vy: (end.y - first.y) / (end.t - first.t) };
  }

  _runMotion(state: MotionState): void {
    this._motion = { state, last: null };
    if (this._motionFrame === undefined) this._motionFrame = requestAnimationFrame((now) => this._motionStep(now));
  }

  _motionStep(now: number): void {
    this._motionFrame = undefined;
    const motion = this._motion;
    if (!motion || this._destroyed) return;
    if (this._reducedMotion) {
      this._stopMotion(true);
      return;
    }
    const dt = motion.last === null ? 16 : Math.min(MAX_FRAME_MS, Math.max(0, now - motion.last));
    motion.last = now;
    const state = stepCamera(motion.state, dt);
    motion.state = state;
    const resting = Math.abs(state.scale - state.targetScale) < 0.001
      && Math.abs(state.tx - state.targetTx) < 0.5
      && Math.abs(state.ty - state.targetTy) < 0.5
      && state.vx === 0 && state.vy === 0;
    if (resting) {
      this._stopMotion(true);
      return;
    }
    this._camera = { x: state.tx, y: state.ty, zoom: state.scale };
    this._applyCamera();
    this._motionFrame = requestAnimationFrame((later) => this._motionStep(later));
  }

  /**
   * Ferma il volo o l'inerzia. Con `arrive` la vista va dove andava (il volo
   * finisce sul suo bersaglio, l'inerzia dov'è) e le schede vive si rifanno.
   */
  _stopMotion(arrive: boolean): void {
    if (this._motionFrame !== undefined) cancelAnimationFrame(this._motionFrame);
    this._motionFrame = undefined;
    const motion = this._motion;
    if (!motion) return;
    this._motion = null;
    if (!arrive || this._destroyed) return;
    const { targetScale, targetTx, targetTy } = motion.state;
    this._camera = { x: targetTx, y: targetTy, zoom: targetScale };
    this._applyCamera();
    this._refreshLive();
  }

  /** La finestra perde il fuoco: niente scorre più da solo, e Spazio non è più tenuto. */
  _stillCamera(): void {
    this._releaseSpace();
    this._stopEdgeScroll();
    this._stopMotion(true);
  }

  /**
   * Spazio giù sulla lavagna o su una scheda (non in un campo né dentro la
   * scheda attiva): `true` se l'ha preso. Con una penna giù non vale (la
   * penna ha la precedenza), ma la pagina non scorre.
   */
  _holdSpace(event: KeyboardEvent): boolean {
    if (event.key !== " " || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (isTextTarget(event.target) || !this._onCardOrBoard(event.target)) return false;
    event.preventDefault();
    if (this._spaceHeld || this._penDown) return true;
    this._spaceHeld = true;
    // Il tocco conta dal primo tasto giù, non dalla ripetizione del sistema.
    this._spaceTap = event.repeat ? null : { at: event.timeStamp, from: this._pointerSeen, spoiled: false };
    this._viewport.toggleAttribute("data-space-pan", true);
    // Il mouse che scrive torna alla lavagna finché Spazio è giù.
    this._applyInkMouse();
    return true;
  }

  _releaseSpace(): void {
    this._spaceTap = null;
    if (!this._spaceHeld) return;
    this._spaceHeld = false;
    this._viewport.removeAttribute("data-space-pan");
    if (!this._destroyed) this._applyInkMouse();
  }

  /**
   * Un trascinamento (una scheda, una maniglia, un filo) si è mosso a
   * `event`: vicino al bordo della vista la fa scorrere, fuori dalla fascia
   * smette. Il primo fotogramma parte da qui.
   */
  _trackEdge(event: PointerEvent): void {
    const speed = this._edgeSpeed(event.clientX, event.clientY);
    if (speed.x === 0 && speed.y === 0) {
      this._stopEdgeScroll();
      return;
    }
    const last = this._edgeScroll?.last ?? null;
    this._edgeScroll = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      shiftKey: event.shiftKey, altKey: event.altKey, last,
    };
    if (this._edgeFrame === undefined) this._edgeFrame = requestAnimationFrame((now) => this._edgeStep(now));
  }

  /** La velocità dello scorrimento al bordo nel punto, in px al ms, verso dove va la vista. */
  _edgeSpeed(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this._viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: edgeScrollSpeed(clientX - rect.left, rect.right - clientX),
      y: edgeScrollSpeed(clientY - rect.top, rect.bottom - clientY),
    };
  }

  _edgeStep(now: number): void {
    this._edgeFrame = undefined;
    const edge = this._edgeScroll;
    if (!edge || this._destroyed) return;
    const drag = this._drag?.pointerId === edge.pointerId ? this._drag : null;
    const resize = this._resize?.pointerId === edge.pointerId ? this._resize : null;
    const connect = this._connect?.pointerId === edge.pointerId ? this._connect : null;
    if (!drag && !resize && !connect) {
      this._stopEdgeScroll();
      return;
    }
    const dt = edge.last === null ? 16 : Math.min(MAX_FRAME_MS, Math.max(0, now - edge.last));
    edge.last = now;
    const speed = this._edgeSpeed(edge.clientX, edge.clientY);
    // La vista va verso il bordo: la lavagna scorre al contrario.
    const dx = -speed.x * dt;
    const dy = -speed.y * dt;
    this._camera = { ...this._camera, x: this._camera.x + dx, y: this._camera.y + dy };
    this._applyCamera();
    // Ciò che si tira resta sotto il puntatore fermo: il punto di partenza
    // del gesto scorre con la lavagna.
    if (drag) {
      drag.startX += dx;
      drag.startY += dy;
      this._moveDrag(edge);
    } else if (resize) {
      resize.startX += dx;
      resize.startY += dy;
      this._moveResize(edge);
    } else {
      this._moveConnect(edge.clientX, edge.clientY);
    }
    this._edgeFrame = requestAnimationFrame((later) => this._edgeStep(later));
  }

  _stopEdgeScroll(): void {
    if (this._edgeFrame !== undefined) cancelAnimationFrame(this._edgeFrame);
    this._edgeFrame = undefined;
    this._edgeScroll = null;
  }

  // --- toolbar ----------------------------------------------------------------

  _drawToolbar(): void {
    // La barra di N4 si rifà da capo, salvo l'interruttore «Scrivi col
    // mouse», che resta lo stesso elemento in testa: il fuoco non si perde.
    // Ciò che è passato nella riga delle opzioni (T50: il menu della penna,
    // davanti e dietro, allinea e distribuisci, la Vista) non c'è più; il
    // resto aspetta i suoi task (la barra della selezione T51, i fili e il
    // colore esatto T47 e T59, la lavagna vuota T62). I controlli nascono in
    // `bar`, staccata, e passano alla barra del kit (`_toolbarBar`), che
    // lascia al suo posto chi c'è già e manda in «…» ciò che non ci sta.
    const bar = document.createElement("div");
    const inkMouse = this._inkMouseButton;
    this._penMenu.sync();
    // La colonna e la riga delle opzioni: lo strumento, la scelta e la sola
    // lettura di adesso.
    this._rail.sync();
    this._canvasOptions.sync();
    // «Scrivi col mouse», in testa.
    inkMouse.textContent = t("canvas.ink.mouse");
    inkMouse.title = t("canvas.ink.mouse_hint");
    inkMouse.setAttribute("aria-pressed", String(this._inkMouse));
    inkMouse.disabled = this._readOnly || this._isSceneOversized();
    const mk = (
      action: string,
      label: string,
      run: () => void,
      disabled = false,
      mutates = true,
      focusViewport = true,
    ): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.canvasAction = action;
      button.textContent = label;
      button.disabled = disabled || (mutates && (this._readOnly || this._isSceneOversized()));
      button.addEventListener("click", (e) => {
        e.preventDefault();
        this._recordPending();
        run();
        if (focusViewport) this._viewport.focus();
      });
      bar.append(button);
      return button;
    };
    // La scheda nasce in scrittura (IMP-042): il fuoco va nel suo testo, non sulla vista.
    mk("add-text", t("canvas.add_text"), () => this._placeText(), false, true, false);
    if (this._options.onPickFile) {
      mk("add-file", t("canvas.add_file"), () => {
        void this._addFileNode().catch((error: unknown) => this._showIntakeError(error));
      });
    }
    mk("add-link", t("canvas.add_link"), () => this._addNode("link"));
    mk("add-group", t("canvas.add_group"), () => this._addNode("group"));
    const hasSelection = this._selection.length > 0 || this._edgeSelection.length > 0;
    mk("duplicate", t("canvas.duplicate"), () => this._duplicateSelection(), !hasSelection);
    mk("delete", t("canvas.delete"), () => this._deleteSelection(), !hasSelection);
    mk("fit-selection", t("canvas.fit_selection"), () => this._fitCamera(true, this._selectedNodes()), this._selection.length === 0, false);
    if (!this._isSceneOversized() && this._doc?.edges.length && this._doc.edges.length <= MAX_INTERACTIVE_EDGES) {
      const picker = document.createElement("select");
      picker.dataset.canvasField = "select-edge";
      picker.setAttribute("aria-label", t("canvas.select_edge"));
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = t("canvas.select_edge");
      picker.append(empty);
      for (const edge of this._doc.edges) {
        const option = document.createElement("option");
        option.value = edge.id;
        option.textContent = edge.label || edge.id;
        picker.append(option);
      }
      picker.value = this._edgeSelection[0] ?? "";
      picker.addEventListener("change", () => {
        this._edgeSelection = picker.value ? [picker.value] : [];
        this._selection = [];
        this._options.onSelectionChange();
        this._displaySelection();
        // Il campo del nome, se si vede; se è finito in «…», il fuoco va lì.
        const label = this._toolbar.querySelector<HTMLInputElement>('[data-canvas-field="edge-label"]');
        if (label && !label.closest("[hidden]")) label.focus();
        else this._toolbar.querySelector<HTMLElement>(".kit-options-more:not([hidden])")?.focus();
      });
      bar.append(picker);
    }
    // Il colore delle schede e dei fili non sta più qui: è nel menu «Colore»
    // del tasto destro e nel pozzo della riga delle opzioni (T47).
    if (!this._isSceneOversized() && this._edgeSelection.length === 1) this._drawEdgeInspector(bar);
    // Un avviso solo, nel suo posto all'inizio della barra, dove si legge
    // senza scorrere: quello dell'ultimo gesto, o la sola lettura della tela.
    // Una scena oltre il limite ha già il suo, nella tela.
    const head: HTMLElement[] = [];
    const notice = this._intakeError
      || (this._unwritable && !this._isSceneOversized() ? t("canvas.unwritable") : "");
    if (notice) {
      const error = document.createElement("output");
      error.setAttribute("role", "alert");
      error.className = "canvas-intake-error";
      error.textContent = notice;
      head.push(error);
    }
    // L'avviso di «Togli dalla lavagna» (T17), dopo quello dell'ultimo gesto
    // e dopo «Scrivi col mouse»: una notizia e non un guasto, con «Annulla»
    // accanto.
    const told: HTMLElement[] = [];
    const removal = this._removal;
    if (removal) {
      const said = document.createElement("output");
      said.setAttribute("role", "status");
      said.className = "canvas-removal";
      said.textContent = removal.text;
      told.push(said);
      if (removal.undo && removal.step !== undefined) {
        const undo = document.createElement("button");
        undo.type = "button";
        undo.dataset.canvasAction = "undo-removal";
        undo.textContent = t("app.undo");
        undo.title = t(removal.free ? "canvas.ink.moved_undo" : "canvas.card.removed_undo");
        // Il pulsante si rifà con la barra: l'ascolto se ne va con lui.
        undo.addEventListener("click", () => this._undoRemoval());
        told.push(undo);
        // I tratti passati a una scheda col Lazo (T86): «Rendilo libero».
        if (removal.free) {
          const free = document.createElement("button");
          free.type = "button";
          free.dataset.canvasAction = "free-ink";
          free.textContent = t("canvas.ink.make_free");
          free.title = t("canvas.ink.make_free_hint");
          free.addEventListener("click", () => this._freeMovedInk());
          told.push(free);
        }
      }
    }
    // Gli avvisi e i loro pulsanti restano nella riga più a lungo dei comandi
    // (priorità 1): si leggono senza aprire «…».
    const notices = new Set<HTMLElement>([...head, ...told]);
    const controls: HTMLElement[] = [...head, inkMouse, ...told, ...(bar.children as HTMLCollectionOf<HTMLElement>)];
    this._toolbarBar.setItems(controls.map((element, index) => {
      element.classList.add("canvas-toolbar-item");
      return {
        id: element.dataset.canvasAction ?? element.dataset.canvasField ?? `${element.className}-${index}`,
        element,
        priority: notices.has(element) ? 1 : 0,
      };
    }));
    this._toolbarKeys.refresh();
  }

  _showIntakeError(error: unknown): void {
    if (this._destroyed) return;
    // Qui arrivano anche i messaggi che l'editor scrive di proposito (il
    // deposito, un allegato troppo grande): `errorText` li tiene, e legge
    // l'errore tipizzato dell'host senza «[object Object]».
    this._intakeError = errorText(error).slice(0, 300);
    this._drawToolbar();
  }

  _layoutSelection(axis: CanvasArrange): void {
    if (this._readOnly || !this._doc) return;
    this._writeOps(this._arrangeOps(axis));
  }

  /**
   * `align` o `distribute` delle schede scelte: i lati e i passi li decide il
   * nucleo (`layout::arrange`). `null` con meno di due schede (tre per
   * distribuire), come i bottoni spenti.
   */
  _arrangeOps(axis: CanvasArrange): CanvasIntentOp[] | null {
    const ids = this._selectedNodes().map((node) => node.id);
    if (axis === "distribute-x" || axis === "distribute-y") {
      return ids.length >= 3 ? [{ op: "distribute", ids, axis: axis === "distribute-x" ? "x" : "y" }] : null;
    }
    return ids.length >= 2 ? [{ op: "align", ids, to: axis }] : null;
  }

  /**
   * «Disponi» (LIC T25): `layout` delle schede scelte, o, senza selezione,
   * delle schede libere (il nucleo le sceglie se mancano gli `ids`). `null`
   * con meno di due, come la voce spenta.
   */
  _layoutOps(kind: CanvasLayout): CanvasIntentOp[] | null {
    const ids = this._selectedNodes().map((node) => node.id);
    if (ids.length >= 2) return [{ op: "layout", ids, kind }];
    if (ids.length === 0 && this._doc && looseCards(this._doc.nodes).length >= 2) return [{ op: "layout", kind }];
    return null;
  }

  /**
   * Perché «Disponi» è spento: una scheda sola scelta o, senza selezione,
   * meno di due schede libere (quelle che il nucleo dispone: non gruppi, e
   * non dentro un gruppo).
   */
  _layoutWhy(): string | null {
    const chosen = this._selectedNodes().length;
    if (chosen === 1) return t("canvas.commands.why.two");
    if (chosen >= 2) return null;
    if (!this._doc?.nodes.length) return t("canvas.commands.why.empty");
    return looseCards(this._doc.nodes).length >= 2 ? null : t("canvas.commands.why.two");
  }

  /** «Disponi»: scrive il `layout`; se le schede sono già disposte così lo dice, mai il silenzio. */
  _arrangeLayout(kind: CanvasLayout): void {
    if (this._readOnly || this._isSceneOversized()) return;
    const ops = this._layoutOps(kind);
    if (!ops) return;
    const compiled = this._compileIntent(ops, "canvas.change_refused");
    if (!compiled) return;
    if (compiled.patches.length === 0) {
      this._showNotice(t("canvas.layout.nothing"));
      return;
    }
    this._commit(compiled.patches, "input");
  }

  _drawEdgeInspector(bar: HTMLElement): void {
    const id = this._edgeSelection[0];
    const edge = this._doc?.edges.find((entry) => entry.id === id);
    if (!edge) return;
    // Un campo del filo scrive la sua `set` (T23); un valore che il nucleo
    // rifiuta non scrive, e la barra torna al valore del modello.
    const change = (values: Partial<CanvasEdge>): void => {
      const current = this._doc?.edges.find((entry) => entry.id === id);
      if (!current || !this._doc) return;
      const next = { ...current, ...values };
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete next[key];
      }
      const op = setOp(current, next);
      if (op) this._writeOps([op]);
    };
    const label = document.createElement("input");
    label.type = "text";
    label.value = edge.label ?? "";
    label.maxLength = 65_536;
    label.disabled = this._readOnly;
    label.dataset.canvasField = "edge-label";
    label.setAttribute("aria-label", t("canvas.edge_label"));
    label.addEventListener("change", () => change({ label: label.value }));
    bar.append(label);
    for (const field of ["fromNode", "toNode"] as const) {
      const select = document.createElement("select");
      select.dataset.canvasField = `edge-${field}`;
      select.setAttribute("aria-label", t(field === "fromNode" ? "canvas.edge_from_node" : "canvas.edge_to_node"));
      select.disabled = this._readOnly;
      for (const node of this._doc!.nodes) {
        const option = document.createElement("option");
        option.value = node.id;
        option.textContent = nodeTitle(node);
        select.append(option);
      }
      select.value = edge[field];
      select.addEventListener("change", () => change({ [field]: select.value } as Partial<CanvasEdge>));
      bar.append(select);
    }
    for (const field of ["fromSide", "toSide", "fromEnd", "toEnd"] as const) {
      const select = document.createElement("select");
      select.dataset.canvasField = `edge-${field}`;
      const fieldLabels = {
        fromSide: "canvas.edge_from_side",
        toSide: "canvas.edge_to_side",
        fromEnd: "canvas.edge_from_end",
        toEnd: "canvas.edge_to_end",
      } as const;
      select.setAttribute("aria-label", t(fieldLabels[field]));
      select.disabled = this._readOnly;
      const values = field.endsWith("Side") ? ["", "top", "right", "bottom", "left"] : ["", "none", "arrow"];
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value || t("canvas.default");
        select.append(option);
      }
      select.value = edge[field] ?? "";
      select.addEventListener("change", () => change({ [field]: select.value || undefined } as Partial<CanvasEdge>));
      bar.append(select);
    }
  }

  async _intake(event: DragEvent | ClipboardEvent): Promise<void> {
    if (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true]")) return;
    const drop = event.type === "drop" && "dataTransfer" in event;
    const data = drop ? event.dataTransfer : "clipboardData" in event ? event.clipboardData : null;
    const port = this._options.attachments;
    const documentId = this._options.documentId;
    if (!data || this._readOnly || !this._doc || this._destroyed || this._isSceneOversized()) return;
    // Le schede di Fub negli appunti (T68) vincono sul loro Markdown; una
    // forma rotta si incolla come testo.
    const cards = drop ? "" : data.getData(CANVAS_CLIPBOARD_TYPE) || "";
    if (cards && this._pasteCards(event, cards)) return;
    if (!port && data.files.length) return;
    const text = data.getData("text/plain") || cards;
    if (!port && !text) return;
    this._intakeError = "";
    this._drawToolbar();
    event.preventDefault();
    const before = this._source;
    const epoch = this._epoch;
    const stale = (): boolean => this._destroyed || this._readOnly || this._source !== before
      || this._epoch !== epoch || !this._doc;
    // Il punto e la scheda sotto si prendono subito: durante il deposito il
    // puntatore si muove.
    const point = this._intakePoint(event, drop);
    const existing = drop ? this._nodeAt(this._elementAt(event.clientX, event.clientY) ?? null) : null;
    const files = [...new Set(port?.expandFiles ? await port.expandFiles(data) : [...data.files])];
    if (files.length && (!port || !documentId)) return;
    // Le schede che questo gesto fa nascere, per percorso: «Fanne una copia»
    // le ripunta per id (T32b).
    const born = new Map<string, string[]>();
    const bear = (path: string, id: string): void => { born.set(path, [...(born.get(path) ?? []), id]); };
    // External bytes pass the explicit deposit. Internal folder paths resolve
    // only via the host port; never trust a raw DataTransfer path.
    // Un deposito fermato a metà porta i percorsi già fatti: le loro schede
    // nascono lo stesso, e l'errore si mostra dopo, in ogni uscita (T15b).
    let paths: readonly string[] = [];
    let failure: CanvasDepositError | null = null;
    if (files.length) {
      try {
        paths = await port!.deposit(files, documentId!, this._depositCards(born));
      } catch (error) {
        if (!(error instanceof CanvasDepositError)) throw error;
        paths = error.paths;
        failure = error;
      }
    } else if (port?.resolvePaths && documentId) {
      paths = await port.resolvePaths(data, documentId);
    }
    try {
      if (stale()) return;
      const unique = [...new Set(paths)].filter(isVaultPath);
      if ((!unique.length && !text) || (paths.length > 0 && !unique.length)) return;
      const ops: CanvasIntentOp[] = [];
      // Una nota sola rilasciata dal vault, senza Alt: dopo il commit si apre
      // il selettore delle sezioni (T74). Un file depositato dal computer non
      // è ancora nell'indice: lo si sceglie dopo, con «Parti…».
      const single = drop && !files.length && unique.length === 1 && !(event as DragEvent).altKey ? unique[0]! : null;
      const file = this._doc!.nodes.find((node) => node.id === existing && node.type === "file");
      // Su una scheda di file il primo file ne prende il posto (A-8): una `set`.
      if (file && unique.length) {
        const path = unique.shift()!;
        const op = setOp(file, { ...file, file: path, subpath: undefined });
        if (op) ops.push(op);
        bear(path, file.id);
      }
      if (unique.length) {
        const items = await this._bornItems(unique);
        if (stale()) return;
        ops.push(...this._dropOps(items, point, bear));
      }
      // Gli appunti diventano testo solo se non c'era un file da depositare:
      // un file rifiutato non si trasforma in una scheda di testo (T15b).
      if (!paths.length && text && !failure) {
        const table = await this._pastedTable(data, text);
        if (stale()) return;
        const url = table === null ? externalUrl(text.trim()) : null;
        // La forma breve di `add_card` (T9): la misura la dà il nucleo.
        ops.push({ op: "add_card", ...(url ? { url } : { text: table ?? text }), x: snap(point.x), y: snap(point.y) });
      }
      // Una lista sola: un annulla toglie tutto ciò che è nato.
      const committed = this._writeOps(ops) !== null;
      const card = single === null ? undefined : born.get(single)?.[0];
      if (committed && card !== undefined && this._partsPickerSetting) void this._openParts(card, "drop");
    } finally {
      // Dopo le schede, e in ogni uscita: uscire presto non deve perdere l'errore.
      if (failure) this._showIntakeError(failure);
    }
  }

  /**
   * La porta con cui un gesto dopo il deposito ripunta le schede che il
   * deposito ha fatto nascere (`born`: percorso → id, riempita quando nascono).
   * Ogni scheda si cerca per id e cambia solo se mostra ancora il file di
   * prima: tolta, o già puntata altrove, resta com'è. Tutte in un commit solo.
   */
  _depositCards(born: ReadonlyMap<string, readonly string[]>): CanvasDepositCards {
    const live = (): boolean => !this._destroyed && !this._readOnly && this._doc !== null;
    return {
      live,
      repoint: (changes) => {
        if (!live()) return 0;
        const doc = this._doc!;
        const ops: CanvasIntentOp[] = [];
        const touched = new Set<string>();
        for (const { from, to } of changes) {
          if (!isVaultPath(to)) continue;
          for (const id of born.get(from) ?? []) {
            const node = doc.nodes.find((candidate) => candidate.id === id);
            if (!node || touched.has(id) || node.type !== "file" || node.file !== from) continue;
            ops.push({ op: "set", id, fields: { file: to } });
            touched.add(id);
          }
        }
        return ops.length > 0 && this._writeOps(ops) !== null ? ops.length : 0;
      },
    };
  }

  /**
   * Il punto della lavagna in cui nasce ciò che arriva: quello del rilascio;
   * per un incolla, l'ultimo punto in cui il puntatore è stato visto sulla
   * vista, sennò il centro della vista.
   */
  _intakePoint(event: DragEvent | ClipboardEvent | null, drop: boolean): { x: number; y: number } {
    if (drop && event && "clientX" in event) return this._screenToWorld(event.clientX, event.clientY);
    if (this._pointerSeen) return this._screenToWorld(this._pointerSeen.x, this._pointerSeen.y);
    const rect = this._viewport.getBoundingClientRect();
    return this._screenToWorld(rect.left + this._viewport.clientWidth / 2, rect.top + this._viewport.clientHeight / 2);
  }

  /**
   * I file lasciati cadere, ognuno con le dimensioni del suo contenuto quando
   * si sanno: le immagini chiedono i loro pixel alla porta, poche alla volta;
   * una misura che non c'è, fallisce o non arriva in tempo non si dà, e il
   * nucleo prende la misura di serie della specie.
   */
  async _bornItems(paths: readonly string[]): Promise<DropFile[]> {
    const items: DropFile[] = paths.map((path) => ({ path }));
    const measure = this._options.measureImage;
    if (!measure) return items;
    const images = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => cardKindOf({ id: "", type: "file", file: item.path, x: 0, y: 0, width: 0, height: 0 }) === "image");
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < images.length && !this._destroyed) {
        const { item, index } = images[next++]!;
        const size = await measuredImage(measure, item.path);
        if (size) items[index] = { ...item, contentSize: [size.width, size.height] };
      }
    };
    await Promise.all(Array.from({ length: Math.min(MEASURE_IMAGE_PARALLEL, images.length) }, worker));
    return items;
  }

  /**
   * Le operazioni dei file lasciati cadere in `at` (T24): la tela li ordina
   * per nome (`sortedDrop`), poi un `add_card` per file, con il suo `id` e
   * `content_size` quando la misura si sa; con più file la griglia del
   * nucleo (`layout` `grid`) dal punto del rilascio, agganciato a 8, e oltre
   * `DROP_GROUP_THRESHOLD` il gruppo che li tiene (`group`). Un file solo
   * nasce già lì: la griglia di una scheda è il suo angolo agganciato.
   * `bear` riceve ogni scheda che nasce, col suo percorso; `newId` dà gli id.
   */
  _dropOps(
    items: readonly DropFile[],
    at: { readonly x: number; readonly y: number },
    bear: (path: string, id: string) => void,
    newId: () => string = () => this._newId(),
  ): CanvasIntentOp[] {
    const x = snap(at.x);
    const y = snap(at.y);
    const sorted = sortedDrop(items);
    const ops: CanvasIntentOp[] = [];
    const ids: string[] = [];
    for (const item of sorted) {
      const id = newId();
      ids.push(id);
      bear(item.path, id);
      ops.push({
        op: "add_card",
        id,
        file: item.path,
        ...(item.contentSize ? { content_size: [...item.contentSize] } : {}),
        ...(sorted.length === 1 ? { x, y } : {}),
      });
    }
    if (sorted.length > 1) ops.push({ op: "layout", ids, kind: "grid", x, y });
    if (sorted.length > DROP_GROUP_THRESHOLD) {
      ops.push({ op: "group", ids, label: t("canvas.intake.group", { count: String(sorted.length) }) });
    }
    return ops;
  }

  /**
   * Le celle copiate come tabella Markdown: l'HTML con una tabella, tramite
   * la porta; sennò il testo a tabulazioni su più righe. `null` se non sono
   * celle.
   */
  async _pastedTable(data: DataTransfer, text: string): Promise<string | null> {
    const convert = this._options.clipboardMarkdown;
    if (convert && /<table[\s>]/i.test(data.getData("text/html") ?? "")) {
      const markdown = await convert(data).catch(() => null);
      if (markdown && markdown.trim()) return markdown;
    }
    if (!text.includes("\t")) return null;
    const rows = parseTsv(text);
    if (rows.length < 2) return null;
    return markdownTable(rows) || null;
  }

  /**
   * I rettangoli tratteggiati dove nasceranno le schede di un trascinamento
   * di file o di voci dell'albero: uno per file, se si sa quanti sono, sennò
   * uno (le voci dell'albero non si leggono prima del rilascio).
   */
  _showDropGhosts(event: DragEvent): void {
    const data = event.dataTransfer;
    if (!data || !this._options.attachments) return;
    const types = [...(data.types ?? [])];
    // Senza tipi leggibili (WebKit durante il trascinamento) può essere un file.
    const carries = types.length === 0 || types.includes("Files")
      || types.includes(ENTRIES_DRAG_TYPE) || types.includes(NOTE_DRAG_TYPE);
    if (!carries) {
      this._hideDropGhosts();
      return;
    }
    const count = Math.max(1, [...(data.items ?? [])].filter((item) => item.kind === "file").length);
    const pointer = this._screenToWorld(event.clientX, event.clientY);
    // I riquadri si calcolano una volta, all'entrata (o quando cambia il
    // numero dei file): poi seguono il puntatore sulla griglia, senza
    // chiamare il nucleo a ogni movimento.
    if (this._dropGhostCount !== count) {
      this._dropGhost = this._dropGhostShape(count, pointer);
      this._dropGhostCount = count;
    }
    const ghost = this._dropGhost;
    if (!ghost) {
      this._dropGhosts?.remove();
      this._dropGhosts = null;
      return;
    }
    const shiftX = snap(pointer.x) - ghost.x;
    const shiftY = snap(pointer.y) - ghost.y;
    let layer = this._dropGhosts;
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "canvas-drop-ghosts";
      layer.setAttribute("aria-hidden", "true");
      this._viewport.append(layer);
      this._dropGhosts = layer;
    }
    layer.style.transform = `translate(${this._camera.x}px, ${this._camera.y}px) scale(${this._camera.zoom})`;
    // Il filo e il numero restano della stessa misura sullo schermo (la pelle divide per lo zoom).
    layer.style.setProperty("--canvas-zoom", String(this._camera.zoom));
    // Oltre i dodici (prototipo T25), la cornice del gruppo che li terrà col
    // numero in mezzo: mentre si trascina si sa quanti sono, non come si chiamano.
    const rects = ghost.group ? [ghost.group] : ghost.cards;
    const grouped = ghost.group !== null;
    while (layer.children.length > rects.length) layer.lastElementChild!.remove();
    rects.forEach((card, index) => {
      let ghost = layer.children[index] as HTMLElement | undefined;
      if (!ghost) {
        ghost = document.createElement("div");
        ghost.className = "canvas-drop-ghost";
        layer.append(ghost);
      }
      ghost.classList.toggle("canvas-drop-ghost-group", grouped);
      if (grouped) {
        let name = ghost.firstElementChild as HTMLElement | null;
        if (!name) {
          name = document.createElement("span");
          name.className = "canvas-drop-ghost-name";
          ghost.append(name);
        }
        const text = t("canvas.intake.group", { count });
        if (name.textContent !== text) name.textContent = text;
      } else {
        ghost.replaceChildren();
      }
      ghost.style.transform = `translate(${card.x + shiftX}px, ${card.y + shiftY}px)`;
      ghost.style.width = `${card.width}px`;
      ghost.style.height = `${card.height}px`;
    });
  }

  /**
   * I riquadri di `count` file che nascerebbero in `at`: le operazioni del
   * rilascio (`_dropOps`, con nomi che tengono l'ordine dato e la misura di
   * serie di un file) compilate dal nucleo senza scrivere niente, così la
   * griglia e il gruppo sono quelli che il rilascio farà. `null` se il nucleo
   * non c'è o le rifiuta (una lavagna piena): allora nessun riquadro.
   */
  _dropGhostShape(count: number, at: { readonly x: number; readonly y: number }): DropGhost | null {
    const core = this._core;
    if (!core || this._destroyed || count > MAX_DROP_GHOSTS) return null;
    const items = Array.from({ length: count }, (_, index) => ({ path: String(index).padStart(8, "0") }));
    // Gli id dei riquadri sono suoi: non consumano quelli di `newId`.
    const ids: string[] = [];
    const ops = this._dropOps(items, at, (_path, id) => ids.push(id), () => `drop-ghost-${ids.length}`);
    let compiled: CanvasCompiled;
    try {
      compiled = core.compile(ops, this._seed());
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return null;
      }
      if (error instanceof CanvasCoreError) return null;
      throw error;
    }
    const placed = new Map<string, Rect>();
    for (const patch of compiled.patches) {
      if (patch.kind === "upsert-node") {
        const { x, y, width, height } = patch.after;
        placed.set(patch.after.id, { x, y, width, height });
      }
    }
    const cards = ids.flatMap((id) => placed.get(id) ?? []);
    const groupId = count > DROP_GROUP_THRESHOLD ? compiled.created[compiled.created.length - 1] : undefined;
    const group = groupId === undefined ? null : placed.get(groupId) ?? null;
    return { count, x: snap(at.x), y: snap(at.y), cards, group };
  }

  _hideDropGhosts(): void {
    this._dropGhosts?.remove();
    this._dropGhosts = null;
    this._dropGhost = null;
    this._dropGhostCount = null;
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

  // --- convertire (T70) ---------------------------------------------------------

  /** La cartella della lavagna nel vault, `""` alla radice: lì nascono le note estratte. */
  _boardFolder(): string {
    const id = (this._options.documentId ?? "").replace(/^\/+/, "");
    const cut = id.lastIndexOf("/");
    return cut < 0 ? "" : id.slice(0, cut);
  }

  /**
   * «Estrai in una nota» (T70): chiede il nome (proposto dalla prima riga,
   * libero nella cartella della lavagna), fa nascere la nota col testo e
   * mette al posto della scheda di testo una scheda di file su di lei, con lo
   * stesso id: posto, misura, colore, fili e inchiostro restano. Un commit, un
   * annulla; la nota resta nel vault anche annullando, e la notifica lo dice.
   */
  async _extractNote(id: string): Promise<void> {
    const notes = this._options.notes;
    if (!notes || this._readOnly || this._destroyed || !this._doc) return;
    // Il testo che si sta scrivendo nella scheda va nella nota.
    if (!this._closeField(false)) return;
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (node?.type !== "text") return;
    const text = node.text ?? "";
    const folder = this._boardFolder();
    const proposed = await notes.freeName(folder, proposedNoteName(text));
    if (this._destroyed || this._readOnly) return;
    const name = await this._askNoteName(proposed, folder);
    if (name === null || this._destroyed || this._readOnly) return;
    // La scheda è cambiata mentre si sceglieva il nome: nessuna nota nasce.
    const before = this._doc?.nodes.find((one) => one.id === id);
    if (before?.type !== "text" || (before.text ?? "") !== text) return;
    const path = await notes.create(folder, name, text);
    const opened = (): void => {
      void Promise.resolve(this._options.onOpenPath?.(`/${path.replace(/^\/+/, "")}`, this._options.documentId))
        .catch((error: unknown) => this._showIntakeError(error));
    };
    const shown = noteDisplayName(path);
    const open = { label: t("canvas.extract.open"), hint: t("canvas.extract.open_hint", { name: shown }), run: opened };
    const current = this._doc?.nodes.find((one) => one.id === id);
    if (this._destroyed || this._readOnly || !this._doc || current?.type !== "text" || (current.text ?? "") !== text) {
      // La nota c'è, la scheda no (o è cambiata): la scheda resta com'è, e la notifica lo dice.
      if (!this._destroyed) notify(t("canvas.extract.stale", { name: shown }), "info", open);
      return;
    }
    // La nota c'è: la scheda diventa sua con `convert` (id, posto, fili e
    // inchiostro restano). Se il nucleo la rifiuta l'avviso è uno solo,
    // `canvas.extract.stale`: dice che la nota c'è e la apre.
    if (!this._writeOps([{ op: "convert", id, file: path }], null)) {
      notify(t("canvas.extract.stale", { name: shown }), "info", open);
      return;
    }
    this._statusSettle();
    notify(t("canvas.extract.done", { name: shown }), "info", open);
  }

  /**
   * Il nome della nota da estrarre (T70), con `proposed` già scritto: `null`
   * se si rinuncia. Il nome che si conferma è pulito come quello di una nota
   * nuova (`searchedName`); un nome fatto solo di caratteri vietati non chiude
   * il dialogo.
   */
  _askNoteName(proposed: string, folder: string): Promise<string | null> {
    const own = openLifetime();
    this._life.add(() => own.close());
    const field = textField({
      label: t("canvas.extract.field"),
      value: proposed,
      lifetime: own,
    });
    const handle = openDialog<"extract" | "cancel">({
      title: t("canvas.extract.title"),
      description: folder === ""
        ? t("canvas.extract.description_root")
        : t("canvas.extract.description", { folder }),
      body: field.element,
      actions: [
        { id: "cancel", label: t("app.cancel"), value: "cancel" },
        { id: "extract", label: t("canvas.extract.action"), kind: "primary", value: "extract" },
      ],
      dismissValue: "cancel",
      lifetime: own,
      submit: "extract",
      confirm: (value) => value === "cancel" || searchedName(field.value()) !== null,
    });
    return handle.result.then((value) => {
      own.close();
      return value === "extract" ? searchedName(field.value()) : null;
    });
  }

  /**
   * «Copia il testo qui» (T70): una scheda di testo col testo della nota (di
   * un estratto, le sole sezioni mostrate: T99), accanto alla sua scheda, al
   * primo posto libero; la nota non cambia. Larga
   * come la scheda della nota, alta come lei ma non più della vista: una
   * nota lunga scorre dentro la scheda. Un commit, un annulla.
   */
  async _copyNoteText(id: string): Promise<void> {
    const notes = this._options.notes;
    if (!notes || this._readOnly || this._destroyed || !this._doc) return;
    const node = this._doc.nodes.find((one) => one.id === id);
    if (!node || cardKindOf(node) !== "note") return;
    const path = cardTarget(node).path;
    const epoch = this._epoch;
    // Di un estratto serve anche il sommario del provider (i titoli col loro
    // byte), chiesto insieme al testo; senza, si copia la nota intera.
    const parts = this._options.parts;
    const outline: Promise<readonly PartsHeading[] | null> = noteExcerptOf(node) && parts
      ? parts.outline(path).catch(() => null)
      : Promise.resolve(null);
    const [whole, headings] = await Promise.all([notes.read(path), outline]);
    if (this._destroyed || this._readOnly || !this._doc || this._epoch !== epoch) return;
    const source = this._doc.nodes.find((one) => one.id === id);
    if (!source || cardKindOf(source) !== "note" || cardTarget(source).path !== path) return;
    // Una scheda-estratto (T75) copia solo le sezioni che mostra (T99), nel
    // suo ordine; una sezione sparita dalla nota non si copia. Se non ne resta
    // nessuna non nasce niente, e la lavagna dice quali mancano. Se il
    // sommario non arriva, o non combacia col testo, la nota intera.
    let text = whole;
    const excerpt = noteExcerptOf(source);
    const shown = excerpt && headings ? noteSectionsText(whole, headings, excerpt.sections) : null;
    if (excerpt && shown) {
      if (shown.missing.length === excerpt.sections.length) {
        const names = shown.missing.map((key) => sectionHeading(key) ?? key);
        this._showNotice(names.length === 1
          ? t("canvas.excerpt.section_missing", { name: names[0]! })
          : t("canvas.excerpt.sections_missing", { names: names.join(", ") }));
        return;
      }
      text = shown.text;
    }
    if (utf8.encode(text).length > MAX_CARD_TEXT_BYTES) {
      this._showNotice(t("canvas.card_too_long"));
      return;
    }
    const card = this._writeOps(this._copyNoteTextOps(source, text))?.[0];
    if (card === undefined) return;
    this._selection = [card];
    this._edgeSelection = [];
    this._options.onSelectionChange();
    this._displaySelection();
    this._statusSettle();
  }

  /**
   * L'`add_card` di «Copia il testo qui»: il testo `text` accanto alla scheda
   * della nota `source`, al primo posto libero di `freeSpot` (a
   * `NEXT_CARD_GAP` e scendendo sotto una scheda che c'è già, come la scheda
   * dopo, T44); larga come lei, alta come lei ma non più della vista. Il posto
   * è scritto: `near` del nucleo lascia 48 a destra e scivola con la misura di
   * nascita (rapporto di T23).
   */
  _copyNoteTextOps(source: CanvasNode, text: string): CanvasIntentOp[] | null {
    const doc = this._doc;
    if (!doc) return null;
    const { view } = this._viewRect();
    const height = Math.max(TEXT_CARD_HEIGHT, Math.min(source.height, Math.floor(view.height)));
    const spot = freeSpot(doc.nodes, { x: source.x + source.width + NEXT_CARD_GAP, y: source.y, width: source.width, height });
    return [{ op: "add_card", text, ...spot }];
  }

  /**
   * «Sostituisci il file…» (T70): il selettore dei file di sempre, e la
   * scheda punta al file scelto. Tiene id, posto, misura, colore, fili e
   * inchiostro; perde ciò che era del file di prima (la sezione o la pagina,
   * le parti). Con un file di un'altra specie la scheda cambia specie;
   * l'inchiostro (`fub:ink` della scheda) resta com'era e si disegna con la
   * regola della specie nuova (`inkFitMode`). Un commit, un annulla.
   */
  async _replaceFile(id: string): Promise<void> {
    const pick = this._options.onPickFile;
    if (!pick || this._readOnly || this._destroyed || !this._doc) return;
    const node = this._doc.nodes.find((one) => one.id === id);
    if (node?.type !== "file") return;
    const chosen = await pick();
    if (!isVaultPath(chosen) || this._destroyed || this._readOnly || !this._doc) return;
    const current = this._doc.nodes.find((one) => one.id === id);
    if (current?.type !== "file" || current.file === chosen) return;
    if (this._writeOps(this._replaceFileOps(current, chosen))) this._statusSettle();
  }

  /** La `set` che punta la scheda di file `node` a `file`, togliendo la sezione o la pagina e le parti di prima. */
  _replaceFileOps(node: CanvasNode, file: string): CanvasIntentOp[] | null {
    const next: CanvasNode = { ...node, file };
    delete next.subpath;
    delete next[PARTS_KEY];
    const op = setOp(node, next);
    return op ? [op] : null;
  }

  async _addFileNode(at?: { x: number; y: number }): Promise<void> {
    const pick = this._options.onPickFile;
    if (!pick || this._readOnly || this._destroyed || !this._doc) return;
    const source = this._source;
    const epoch = this._epoch;
    const path = await pick();
    if (!isVaultPath(path) || this._destroyed || this._readOnly || source !== this._source
      || this._epoch !== epoch) return;
    this._addNode("file", path, at);
  }

  /** Una card nuova al centro della vista, o in `at` (coordinate del mondo);
   *  una card file vuole il suo `file`. Torna la card messa, o `null`. */
  _addNode(type: CanvasNode["type"], file?: string, at?: { x: number; y: number }, link?: CardLink): CanvasNode | null {
    if (!this._doc || this._readOnly || (type === "file" && !file)) return null;
    if (!link) {
      // Dal menu, dalla barra o dallo strumento Testo: la sua `add_card` (T23).
      const id = this._writeOps(this._addOps(type, file, at))?.[0];
      const node = id === undefined ? undefined : this._doc?.nodes.find((one) => one.id === id);
      if (!node) return null;
      this._selection = [node.id];
      this._edgeSelection = [];
      this._options.onSelectionChange();
      return node;
    }
    // Collegata (T67): la scheda nasce col filo dal gesto di Collega (T24).
    const rect = this._viewport.getBoundingClientRect();
    const width = type === "group" ? 480 : 320;
    const height = type === "group" ? 320 : type === "link" ? 120 : 160;
    // Collegata (T67): il lato verso l'altro capo cade sotto il puntatore.
    const source = link ? this._doc.nodes.find((one) => one.id === link.from) : undefined;
    const anchor = source && (link?.fromSide
      ? sidePoint(source, link.fromSide)
      : { x: source.x + source.width / 2, y: source.y + source.height / 2 });
    const facing = anchor && at ? linkedCardPlacement(anchor, at, width, height) : null;
    const center = facing
      ? { x: facing.x + 160, y: facing.y + 80 }
      : at
      ? { x: at.x + 160, y: at.y + 80 }
      : this._screenToWorld(rect.left + (rect.width || 800) / 2, rect.top + (rect.height || 600) / 2);
    const born: CanvasNode = {
      id: this._newId(),
      type,
      x: snap(center.x - 160),
      y: snap(center.y - 80),
      width,
      height,
      ...(type === "text" ? { text: "" } : {}),
      ...(type === "file" ? { file } : {}),
      ...(type === "link" ? { url: "https://" } : {}),
      ...(type === "group" ? { label: "" } : {}),
    };
    // Una scheda dello strumento Testo nasce con la misura e l'allineamento
    // scelti nella sua riga (T92).
    const node = (type === "text" && this._tool === "text" ? withTextStyle(born, this._textNext) : null) ?? born;
    // La scheda con il suo `id`, poi il filo verso di lei, in una lista sola
    // (T24): un passo d'annulla.
    const ops: CanvasIntentOp[] = [{ op: "add_card", node: { ...node } }];
    if (source && facing) {
      const fromSide = link?.fromSide ?? nearestSides(node, source, facing.side).toSide;
      const edge = this._connectOps(source.id, node.id, { from: fromSide, to: facing.side }, node.id);
      if (edge) ops.push(...edge);
    }
    const id = this._writeOps(ops)?.[0];
    const placed = id === undefined ? undefined : this._doc?.nodes.find((one) => one.id === id);
    if (!placed) return null;
    this._selection = [placed.id];
    this._edgeSelection = [];
    this._options.onSelectionChange();
    return placed;
  }

  /**
   * L'id di una scheda che un gesto fa nascere e che le operazioni della
   * stessa lista nominano (il filo verso di lei, la griglia del rilascio):
   * quello di `newId` delle opzioni, o uno a caso (T24).
   */
  _newId(): string {
    return this._options.newId?.() ?? newNodeId("n");
  }

  /**
   * La `add_card` di una scheda nuova dal menu, dalla barra o dallo strumento
   * Testo: al centro della vista, o in `at` (coordinate del mondo), con la
   * misura di sempre della GUI per il tipo (scritta, così non cambia con la
   * specie del file). Una scheda dello strumento Testo nasce con la misura e
   * l'allineamento scelti nella sua riga (T92): allora la forma intera, che
   * porta `fub:text`. `null` senza una lavagna, o un file senza percorso.
   */
  _addOps(type: CanvasNode["type"], file?: string, at?: { x: number; y: number }): CanvasIntentOp[] | null {
    if (!this._doc || (type === "file" && !file)) return null;
    const rect = this._viewport.getBoundingClientRect();
    const width = type === "group" ? 480 : 320;
    const height = type === "group" ? 320 : type === "link" ? 120 : 160;
    const center = at
      ? { x: at.x + 160, y: at.y + 80 }
      : this._screenToWorld(rect.left + (rect.width || 800) / 2, rect.top + (rect.height || 600) / 2);
    const place = { x: snap(center.x - 160), y: snap(center.y - 80), width, height };
    if (type === "text" && this._tool === "text") {
      const styled = withTextStyle({ id: "", type, ...place, text: "" }, this._textNext);
      if (styled) {
        const { id: _id, ...node } = styled;
        return [{ op: "add_card", node }];
      }
    }
    switch (type) {
      case "text": return [{ op: "add_card", text: "", ...place }];
      case "file": return [{ op: "add_card", file, ...place }];
      case "link": return [{ op: "add_card", url: "https://", ...place }];
      case "group": return [{ op: "add_card", label: "", ...place }];
    }
  }

  _duplicateSelection(): void {
    if (!this._doc || this._readOnly) return;
    const nodes = this._selectedNodes();
    const created = this._writeOps(this._duplicateOps());
    if (!created) return;
    // Le schede copiate vengono prima dei fili fra loro (`created`).
    const copies = created.slice(0, nodes.length);
    this._lastDuplicate = { sources: nodes.map((node) => node.id), copies };
    this._selection = copies;
    this._edgeSelection = [];
    this._options.onSelectionChange();
  }

  /**
   * `duplicate` delle schede scelte, con i fili fra loro (D1). Le copie
   * dell'ultimo Ctrl+D ripetono il suo spostamento (T68); se no lo
   * spostamento di serie del nucleo, 32 e 32 agganciato a 8.
   */
  _duplicateOps(): CanvasIntentOp[] | null {
    const nodes = this._selectedNodes();
    if (nodes.length === 0) return null;
    const ids = nodes.map((node) => node.id);
    const repeat = this._repeatedOffset(nodes);
    return [repeat ? { op: "duplicate", ids, dx: repeat.x, dy: repeat.y } : { op: "duplicate", ids }];
  }

  // --- copia e incolla le schede (T68) --------------------------------------------

  /**
   * Lo spostamento che Ctrl+D ripete: le schede `nodes` sono proprio le copie
   * dell'ultimo Ctrl+D e la prima scheda di partenza c'è ancora; si ripete la
   * distanza di adesso fra le due, anche se la copia è stata spostata. `null`
   * sennò, o se la copia sta sopra la sua scheda.
   */
  _repeatedOffset(nodes: readonly CanvasNode[]): { readonly x: number; readonly y: number } | null {
    const last = this._lastDuplicate;
    if (!last || !this._doc || last.copies.length !== nodes.length) return null;
    const chosen = new Set(nodes.map((node) => node.id));
    if (!last.copies.every((id) => chosen.has(id))) return null;
    const copy = this._doc.nodes.find((node) => node.id === last.copies[0]);
    const source = this._doc.nodes.find((node) => node.id === last.sources[0]);
    if (!copy || !source) return null;
    const x = copy.x - source.x;
    const y = copy.y - source.y;
    return x === 0 && y === 0 ? null : { x, y };
  }

  /**
   * Gli appunti sono della lavagna: lo chiede il menu, oppure il fuoco è sulla
   * vista o su una scheda, non in un campo né nel contenuto della scheda
   * attiva, e dentro la lavagna non c'è un testo scelto (quello lo copia il
   * browser, com'è).
   */
  _ownsClipboard(): boolean {
    if (this._clipboardCommand !== null) return true;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this._viewport.contains(active)) return false;
    if (isTextTarget(active) || this._insideActive(active, false)) return false;
    const selection = document.getSelection();
    return !(selection && !selection.isCollapsed && this._viewport.contains(selection.anchorNode));
  }

  /**
   * Ctrl+C e Ctrl+X, e «Copia» e «Taglia» del menu: le schede scelte e i
   * tratti liberi scelti col Lazo negli appunti; tagliando, poi tolti.
   */
  _copyEvent(event: ClipboardEvent, cut: boolean): void {
    if (event.defaultPrevented || !event.clipboardData || !this._doc || this._destroyed) return;
    if (!this._ownsClipboard()) return;
    const cutting = cut || this._clipboardCommand === "cut";
    if (cutting && this._readOnly) return;
    const clipboard = copiedSelection(this._doc, this._selection, this._chosenFreeStrokes());
    if (!clipboard) return;
    event.preventDefault();
    event.clipboardData.setData(CANVAS_CLIPBOARD_TYPE, clipboardJson(clipboard));
    event.clipboardData.setData("text/plain", cardsMarkdown(clipboard.nodes));
    // Appunti nuovi: il prossimo incolla parte di nuovo sotto il puntatore.
    this._lastPaste = null;
    if (cutting) this._cutSelection(clipboard);
  }

  /** Gli id dei tratti liberi scelti col Lazo, quelli che vanno negli appunti (T94). */
  _chosenFreeStrokes(): string[] {
    return this._chosenStrokes().filter((unit) => unit.node === null).map((unit) => unit.id);
  }

  /**
   * Toglie ciò che `clipboard` ha appena copiato, in un commit solo: le
   * schede come «Togli dalla lavagna» (i file restano, e l'avviso lo dice col
   * suo «Annulla») e i tratti liberi dal livello della radice.
   */
  _cutSelection(clipboard: CanvasClipboard): void {
    const ids = clipboard.nodes.map((node) => node.id);
    const strokes = (clipboard[INK_KEY]?.strokes ?? []).map((stroke) => stroke.id);
    if (this._readOnly || !this._removeCards(ids, [], strokes)) return;
    this._selection = this._selection.filter((id) => !ids.includes(id));
    this._edgeSelection = [];
    if (strokes.length > 0) {
      const gone = new Set(strokes.map((id) => inkKey("board", id)));
      this._strokeSelection = new Set([...this._strokeSelection].filter((key) => !gone.has(key)));
    }
    this._options.onSelectionChange();
    this._displaySelection();
  }

  /**
   * Un incolla che il browser manda fuori dalla vista (al corpo della pagina,
   * o dove sta la selezione di testo) mentre il fuoco è sulla lavagna: passa
   * da `_intake` come uno sulla vista. Quello sulla vista l'ha già preso lei.
   */
  _pasteFromOutside(event: ClipboardEvent): void {
    if (event.defaultPrevented || (event.target instanceof Node && this._viewport.contains(event.target))) return;
    if (this._clipboardCommand !== null || !this._ownsClipboard()) return;
    void this._intake(event).catch((error: unknown) => this._showIntakeError(error));
  }

  /**
   * Incolla le schede e i tratti liberi di Fub dal testo `raw` degli
   * appunti, nel punto dell'incolla (T15): un commit, un annulla, le schede
   * incollate scelte. Lo stesso testo incollato di nuovo nello stesso punto si
   * sfalsa. Una versione futura non incolla niente e lo dice; un `fub:ink`
   * rotto o fuori dai limiti non incolla niente e lo dice come una forma che
   * il nucleo rifiuta. `false` se `raw` non è la forma di Fub: allora si
   * incolla come testo.
   */
  _pasteCards(event: ClipboardEvent | DragEvent, raw: string): boolean {
    const read = readCanvasClipboard(raw);
    if (read.kind === "broken") return false;
    event.preventDefault();
    this._recordPending();
    if (read.kind === "future") {
      this._showNotice(t("canvas.clipboard.future"));
      return true;
    }
    if (read.kind === "refused") {
      this._showNotice(t("canvas.clipboard.refused"));
      return true;
    }
    const spot = this._pasteSpot(raw);
    if (!this._commitPasted(read.clipboard, spot.at)) {
      this._showNotice(t("canvas.clipboard.refused"));
      return true;
    }
    this._lastPaste = spot.last;
    this._showNotice("");
    return true;
  }

  /**
   * Dove cade un incolla (Ctrl+V, «Aggiungi come copie» di «Incolla codice»):
   * l'angolo del blocco sul puntatore (o al centro della vista), sulla
   * griglia; lo stesso testo incollato di nuovo nello stesso punto scende di
   * `CANVAS_PASTE_STEP` ogni volta. `last` va in `_lastPaste` solo se
   * l'incolla scrive.
   */
  _pasteSpot(raw: string): { readonly at: { x: number; y: number }; readonly last: LastPaste } {
    const point = this._intakePoint(null, false);
    const x = snap(point.x);
    const y = snap(point.y);
    const last = this._lastPaste;
    const count = last && last.raw === raw && last.x === x && last.y === y ? last.count + 1 : 0;
    const step = count * CANVAS_PASTE_STEP;
    return { at: { x: x + step, y: y + step }, last: { raw, x, y, count } };
  }

  /**
   * Le schede e i tratti liberi di `clipboard` con l'angolo del loro
   * riquadro in `at`, in un commit solo, poi scelti (i tratti solo col Lazo,
   * l'unico che li tiene scelti). Le schede e i fili entrano con `insert`
   * (il frammento di N6 T68, con id nuovi dal nucleo), i tratti nel livello
   * della radice con `add_strokes` e `move_strokes` (T24), tutto in una
   * compilazione. `false` se il nucleo rifiuta qualcosa (un filo senza una
   * delle sue schede, un tratto che non vale): allora non entra niente.
   */
  _commitPasted(clipboard: CanvasClipboard, at: { readonly x: number; readonly y: number }): boolean {
    const doc = this._doc;
    if (!doc || this._readOnly) return false;
    // Lo spostamento del blocco e gli id nuovi dei tratti: le schede si
    // spostano quanto i tratti, così restano dove erano gli uni per gli altri.
    const placed = placedSelection(clipboard, at, newNodeId);
    const ops: CanvasIntentOp[] = [];
    if (clipboard.nodes.length > 0) {
      let left = Infinity;
      let top = Infinity;
      for (const node of clipboard.nodes) {
        left = Math.min(left, node.x);
        top = Math.min(top, node.y);
      }
      const fragment = { version: clipboard.version, nodes: clipboard.nodes, edges: clipboard.edges };
      ops.push({ op: "insert", fragment: JSON.parse(JSON.stringify(fragment)) as Record<string, unknown>, x: left + placed.dx, y: top + placed.dy });
    }
    ops.push(...pastedInkOps(placed));
    const compiled = this._compileIntent(ops, null);
    if (!compiled) return false;
    const patches = joinedInkPatches(compiled.patches);
    if (patches.length === 0 || !this._commit(patches, "input")) return false;
    this._selection = compiled.created.slice(0, clipboard.nodes.length);
    this._edgeSelection = [];
    this._strokeSelection = this._tool === "lasso"
      ? new Set(placed.strokes.map((stroke) => inkKey("board", stroke.id)))
      : new Set();
    this._options.onSelectionChange();
    this._displaySelection();
    return true;
  }

  /**
   * «Copia», «Taglia» e «Incolla» del tasto destro. Copia e taglia mandano la
   * copia del browser, la stessa di Ctrl+C; dove non parte, scrivono con gli
   * appunti della shell (il tipo di Fub solo dove la shell lo accetta, come
   * formato della pagina). Incolla legge gli appunti e passa da `_intake`
   * come un Ctrl+V.
   */
  _clipboardMenu(op: SurfaceClipboardOp): void {
    if (op === "paste") {
      this._pasteFromMenu();
      return;
    }
    if (op !== "copy" && op !== "cut") return;
    this._clipboardCommand = op;
    let sent = false;
    try {
      sent = typeof document.execCommand === "function" && document.execCommand("copy");
    } catch {
      sent = false;
    } finally {
      this._clipboardCommand = null;
    }
    if (!sent) this._writeCards(op === "cut");
  }

  /**
   * Scrive le schede e i tratti liberi scelti con gli appunti della shell;
   * con `cut` li toglie, solo dopo averli scritti. Dei soli tratti, dove la
   * shell non accetta il tipo di Fub, non resterebbe niente negli appunti:
   * l'avviso dice che la copia non è riuscita, e niente si toglie.
   */
  _writeCards(cut: boolean): void {
    if (!this._doc || (cut && this._readOnly)) return;
    const clipboard = copiedSelection(this._doc, this._selection, this._chosenFreeStrokes());
    if (!clipboard) return;
    const markdown = cardsMarkdown(clipboard.nodes);
    const web = `web ${CANVAS_CLIPBOARD_TYPE}`;
    const typed = clipboardSupports(web);
    if (!typed && clipboard.nodes.length === 0) {
      this._showNotice(t("editor_menu.copy_failed"));
      return;
    }
    const write = typed
      ? writeClipboardData({
          "text/plain": new Blob([markdown], { type: "text/plain" }),
          [web]: new Blob([clipboardJson(clipboard)], { type: CANVAS_CLIPBOARD_TYPE }),
        })
      : writeClipboardText(markdown);
    const source = this._source;
    this._lastPaste = null;
    void write.then(
      () => {
        if (cut && !this._destroyed && this._source === source) this._cutSelection(clipboard);
      },
      () => {
        if (!this._destroyed) this._showNotice(t("editor_menu.copy_failed"));
      },
    );
  }

  /** «Incolla» del menu: gli appunti letti come li legge la lavagna vuota (`transferOf`, schede di Fub comprese). */
  _pasteFromMenu(): void {
    if (this._readOnly || this._destroyed) return;
    readClipboard().then(async (entries) => {
      const data = await transferOf(entries);
      if (this._destroyed) return;
      if (data === null) this._showNotice(t("canvas.blank.paste_none"));
      else this._receive(data);
    }).catch(() => {
      if (!this._destroyed) this._showNotice(t("editor_menu.paste_failed"));
    });
  }

  _deleteSelection(): void {
    if (!this._doc || this._readOnly) return;
    if (this._removeCards(this._selection, this._edgeSelection)) {
      this._selection = [];
      this._edgeSelection = [];
      this._options.onSelectionChange();
    }
  }

  /**
   * «Togli dalla lavagna» (Canc, Backspace, il menu, la scheda mancante):
   * toglie le schede `nodes` e le linee `edges`, mai i file, e lo dice con
   * «Annulla». «I file restano» solo se fra le tolte c'è una scheda di file;
   * togliere solo dei fili, o dei tratti liberi `strokes` (il taglia del
   * Lazo), non dice niente.
   */
  _removeCards(nodes: readonly string[], edges: readonly string[], strokes: readonly string[] = []): boolean {
    if (!this._doc) return false;
    const gone = this._doc.nodes.filter((node) => nodes.includes(node.id));
    if (!this._removeNodes(nodes, edges, strokes)) return false;
    if (gone.length > 0) {
      const files = gone.some((node) => node.type === "file");
      const many = gone.length > 1;
      const key = files
        ? (many ? "canvas.card.removed_many" : "canvas.card.removed")
        : (many ? "canvas.card.removed_plain_many" : "canvas.card.removed_plain");
      this._showRemoval(t(key, { n: String(gone.length) }), true);
    }
    return true;
  }

  /**
   * L'avviso di un togliere appena fatto, legato al suo passo d'annulla; con
   * `undo` porta «Annulla». Va nel posto degli avvisi della tela.
   */
  _showRemoval(text: string, undo: boolean, free?: { readonly layer: InkLayerRef; readonly ids: readonly string[] }): void {
    if (this._destroyed) return;
    this._removal = free
      ? { text, step: this._undo[this._undo.length - 1], undo, free }
      : { text, step: this._undo[this._undo.length - 1], undo };
    this._drawToolbar();
  }

  /** La modifica dopo il togliere: il suo avviso se ne va. */
  _dropRemoval(): void {
    if (this._removal === null) return;
    this._removal = null;
    this._drawToolbar();
  }

  /**
   * «Annulla» dell'avviso: ciò che fa Ctrl+Z, finché il togliere è l'ultimo
   * passo; dopo, l'avviso non c'è già più.
   */
  _undoRemoval(): void {
    const removal = this._removal;
    if (removal === null || removal.step === undefined || this._undo[this._undo.length - 1] !== removal.step) {
      this._dropRemoval();
      return;
    }
    this.undo();
    this._dropRemoval();
    this._statusSettle();
    this._viewport.focus({ preventScroll: true });
  }

  /**
   * «Sposta anche il file nel cestino» (T17): i file delle schede scelte nel
   * cestino, uno alla volta, con la porta dell'host (il gesto dell'albero);
   * poi via dalla lavagna ogni scheda di un file che ci è andato, anche quelle
   * non scelte (la stessa nota in due schede), e le schede scelte senza file.
   * Un file che l'host rifiuta lascia le sue schede, e l'errore dell'host si
   * legge nel posto degli avvisi. Mai da un tasto: il comando non ne ha.
   */
  async _trashSelectedFiles(): Promise<void> {
    const trash = this._options.onTrashPath;
    if (!trash || !this._doc || this._readOnly) return;
    const chosen = this._selectedNodes();
    const paths = [...new Set(chosen.filter((node) => node.type === "file").map((node) => cardTarget(node).path))]
      .filter(isVaultPath);
    if (!paths.length) return;
    const plain = chosen.filter((node) => node.type !== "file").map((node) => node.id);
    const document = this._source;
    const trashed: string[] = [];
    let failure: unknown = null;
    for (const path of paths) {
      try {
        if (await trash(path)) trashed.push(path);
      } catch (error) {
        failure = error;
        break;
      }
      if (this._destroyed) return;
    }
    if (this._destroyed) return;
    if (failure !== null) this._showIntakeError(failure);
    if (!trashed.length || !this._doc || this._readOnly) return;
    // Le schede dei file andati, come sono adesso: il documento può essere
    // cambiato durante l'attesa. Le schede senza file si tolgono solo se il
    // documento è quello di quando il gesto è partito.
    const gone = new Set(trashed);
    const cards = this._doc.nodes.filter((node) => node.type === "file" && gone.has(cardTarget(node).path)).map((node) => node.id);
    const ids = [...cards, ...(this._source === document ? plain : [])];
    if (!this._removeNodes(ids, [])) return;
    this._pruneSelection();
    this._options.onSelectionChange();
    const key = trashed.length > 1
      ? "canvas.card.trashed_files"
      : ids.length > 1 ? "canvas.card.trashed_many" : "canvas.card.trashed";
    this._showRemoval(t(key, { n: String(ids.length), name: fileName(trashed[0]!), files: String(trashed.length) }), false);
  }

  /**
   * «Spargi le pagine…» (T72): una scheda per pagina del PDF scelto, in riga
   * accanto alla sua, a capo ogni 10 e in gruppo oltre 12. Chiede le pagine (di
   * serie tutte), chiede conferma oltre `SPREAD_CONFIRM_ABOVE`, misura ogni
   * pagina come nasce un PDF (T29) e scrive tutto con `spread_pages` (T23), in
   * un passo solo: un annulla le toglie. Il file non si cambia.
   */
  async _spreadPages(): Promise<void> {
    const pages = this._options.cards?.pdfPages;
    const chosen = this._selectedNodes();
    const one = chosen.length === 1 ? chosen[0]! : null;
    if (!pages || !this._doc || this._readOnly || one?.type !== "file" || cardKindOf(one) !== "pdf") return;
    const path = cardTarget(one).path;
    if (!isVaultPath(path)) return;
    const id = one.id;
    const epoch = this._epoch;
    // Dopo ogni attesa: la lavagna è ancora quella, e la scheda c'è ancora.
    const alive = (): boolean => !this._destroyed && !this._readOnly && this._epoch === epoch
      && this._doc !== null && this._doc.nodes.some((node) => node.id === id);
    const count = await pages.count(path);
    if (!alive()) return;
    if (count === null) {
      this._markBroken(path);
      this._showIntakeError(t("canvas.card.unreadable", { name: fileName(path) }));
      return;
    }
    this._forgetBroken(path);
    const wanted = await this._askPages(fileName(path), count);
    if (wanted === null || !alive()) return;
    if (wanted.length > SPREAD_CONFIRM_ABOVE && !(await this._confirmSpread(wanted.length))) return;
    if (!alive()) return;
    const measured = await pages.sizes(path, wanted);
    if (!alive()) return;
    this._writeOps(this._spreadOps(id, wanted, count, measured));
  }

  /**
   * La forma in codice di «Spargi le pagine» (T23): `page_sizes` va per numero
   * di pagina, e una pagina non misurata ha `[0, 0]`, che il nucleo fa nascere
   * come la GUI senza misura. L'etichetta del gruppo è quella della lingua.
   */
  _spreadOps(
    id: string,
    wanted: readonly number[],
    count: number,
    measured: readonly ({ readonly width: number; readonly height: number } | null | undefined)[] = [],
  ): CanvasIntentOp[] {
    const last = Math.max(0, ...wanted);
    const sizes: number[][] = Array.from({ length: last }, () => [0, 0]);
    wanted.forEach((page, index) => {
      const size = measured[index];
      if (size) sizes[page - 1] = [size.width, size.height];
    });
    return [{
      op: "spread_pages", id, pages: [...wanted], page_count: count,
      ...(measured.some(Boolean) ? { page_sizes: sizes } : {}),
      label: t("canvas.spread.group", { count: String(wanted.length) }),
    }];
  }

  /**
   * Chiede quali pagine «Spargi le pagine» deve fare (T72): `null` se si rinuncia.
   * Il campo parte da tutte le pagine e dice a ogni tasto che cosa nascerà; un
   * pezzo che non si legge non chiude il dialogo, e il dialogo dice quale.
   */
  _askPages(name: string, count: number): Promise<readonly number[] | null> {
    const own = openLifetime();
    this._life.add(() => own.close());
    const note = document.createElement("p");
    note.className = "kit-dialog-description";
    const field = textField({
      label: t("canvas.spread.field"),
      value: count > 1 ? `1-${count}` : "1",
      placeholder: t("canvas.spread.placeholder"),
      lifetime: own,
      onInput: () => say(),
    });
    const say = (): void => {
      const ranges = parsePageRanges(field.value(), count);
      note.textContent = ranges.ok
        ? (ranges.cut
          ? t("canvas.spread.cut", { pages: String(count), n: String(ranges.pages.length) })
          : t("canvas.spread.count", { n: String(ranges.pages.length) }))
        : ranges.bad === null
          ? t("canvas.spread.none", { pages: String(count) })
          : t("canvas.spread.bad", { text: ranges.bad });
    };
    const body = document.createElement("div");
    body.append(field.element, note);
    say();
    const handle = openDialog<"spread" | "cancel">({
      title: t("canvas.spread.title"),
      description: t("canvas.spread.description", { name, pages: String(count) }),
      body,
      actions: [
        { id: "cancel", label: t("app.cancel"), value: "cancel" },
        { id: "spread", label: t("canvas.spread.action"), kind: "primary", value: "spread" },
      ],
      dismissValue: "cancel",
      lifetime: own,
      submit: "spread",
      confirm: (value) => value === "cancel" || parsePageRanges(field.value(), count).ok,
    });
    return handle.result.then((value) => {
      own.close();
      if (value !== "spread") return null;
      const ranges = parsePageRanges(field.value(), count);
      return ranges.ok ? ranges.pages : null;
    });
  }

  /** La conferma prima di far nascere più di `SPREAD_CONFIRM_ABOVE` schede (T72); «Annulla» di serie. */
  _confirmSpread(count: number): Promise<boolean> {
    const own = openLifetime();
    this._life.add(() => own.close());
    const handle = openDialog<boolean>({
      title: t("canvas.spread.confirm.title", { n: String(count) }),
      description: t("canvas.spread.confirm.description", { n: String(count) }),
      actions: [
        { id: "cancel", label: t("app.cancel"), value: false, autofocus: true },
        { id: "spread", label: t("canvas.spread.action"), kind: "primary", value: true },
      ],
      dismissValue: false,
      lifetime: own,
    });
    return handle.result.then((yes) => {
      own.close();
      return yes;
    });
  }

  /**
   * Che cosa copia «Copia come codice»: senza niente di scelto la lavagna
   * intera (`null`); se no le schede scelte (con gli archi fra loro e il loro
   * inchiostro) e i tratti liberi scelti col Lazo. Un arco o un tratto di
   * scheda scelti senza le loro schede non si copiano da soli: allora
   * `"partial"`, e la voce è spenta col perché.
   */
  _codeSelection(): { readonly cards: readonly string[]; readonly free: readonly string[] } | null | "partial" {
    const cards = this._selectedNodes().map((node) => node.id);
    const strokes = this._chosenStrokes();
    if (cards.length === 0 && this._edgeSelection.length === 0 && strokes.length === 0) return null;
    const chosen = new Set(cards);
    const edges = this._doc?.edges ?? [];
    const lonely = this._edgeSelection.some((id) => {
      const edge = edges.find((one) => one.id === id);
      return !edge || !chosen.has(edge.fromNode) || !chosen.has(edge.toNode);
    });
    if (lonely || strokes.some((unit) => unit.node !== null)) return "partial";
    return { cards, free: strokes.map((unit) => unit.id) };
  }

  /** Perché «Copia come codice» è spento: la lavagna vuota, o una scelta che non si copia. */
  _copyCodeWhy(): string | null {
    if (!this._doc || isEmptyBoard(this._doc)) return t("canvas.commands.why.empty");
    return this._codeSelection() === "partial" ? t("canvas.copy_code.why") : null;
  }

  /**
   * «Copia come codice» (LIC T25): ciò che è scelto, o la lavagna intera
   * senza selezione, come la lista di operazioni che lo rifà, negli appunti
   * come testo. Le schede le scrive il nucleo (`canvas_describe`); i tratti
   * liberi scelti seguono in una `add_strokes` della radice, com'è nel file
   * (la stessa forma di `describe`). Non scrive la lavagna.
   */
  _copyCode(): void {
    const core = this._core;
    const doc = this._doc;
    if (this._destroyed || !core || !doc || this._copyCodeWhy() !== null) return;
    this._recordPending();
    const chosen = this._codeSelection();
    if (chosen === "partial") return;
    let text: string;
    try {
      if (chosen === null) text = core.describe();
      else {
        const ops = chosen.cards.length > 0 ? JSON.parse(core.describe(chosen.cards)) as unknown[] : [];
        const free = copiedSelection(doc, [], chosen.free)?.[INK_KEY]?.strokes ?? [];
        if (free.length > 0) ops.push({ op: "add_strokes", layer: "board", strokes: free });
        text = JSON.stringify(ops, null, 2);
      }
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return;
      }
      if (error instanceof CanvasCoreError) {
        this._showNotice(t("editor_menu.copy_failed"));
        return;
      }
      throw error;
    }
    writeClipboardText(text).catch(() => {
      if (!this._destroyed) this._showNotice(t("editor_menu.copy_failed"));
    });
  }

  /** Un avviso di «Incolla codice» senza finestra: il fuoco torna alla tela, dove si era. */
  _pasteNotice(text: string): void {
    this._showNotice(text);
    if (!this._destroyed) this._viewport.focus({ preventScroll: true });
  }

  /** Il controllo del nucleo, o `null` se il nucleo è morto (allora la tela si riapre) o rifiuta la chiamata. */
  _checkCode(ops: readonly unknown[], seed: bigint): CanvasCheckReport | null {
    const core = this._core;
    if (!core) return null;
    try {
      return core.check(ops, seed);
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return null;
      }
      if (error instanceof CanvasCoreError) {
        this._pasteNotice(t("canvas.change_refused"));
        return null;
      }
      throw error;
    }
  }

  /**
   * «Incolla codice» (LIC T25): legge il testo degli appunti una volta come
   * lista (`readCodeList`), e dà lo stesso valore al controllo del nucleo
   * (`canvas_check`) e poi alla scrittura, con lo stesso seme: gli id nati
   * sono quelli del riassunto. Se la lista nomina schede, archi o tratti che
   * la lavagna ha già, la finestra offre «Aggiorna le schede» e «Aggiungi
   * come copie» (`code-paste.ts`); se no «Incolla». Un passo d'annulla in
   * ogni caso. Un problema, appunti vuoti o una lista che non cambia niente
   * li dice l'avviso, senza finestra; Esc o «Annulla» non scrivono.
   */
  async _pasteCode(): Promise<void> {
    if (this._destroyed || this._readOnly || this._isSceneOversized()) return;
    // L'avviso di un incolla di prima non resta dietro la finestra di questo.
    if (this._intakeError) this._showNotice("");
    let text: string;
    try {
      text = await clipboardText();
    } catch {
      if (!this._destroyed) this._pasteNotice(t("editor_menu.paste_failed"));
      return;
    }
    if (this._destroyed || this._readOnly || !this._core || !this._doc || this._isSceneOversized()) return;
    const read = readCodeList(text);
    if (!read.ok) {
      this._pasteNotice(codeTextProblem(read.problem));
      return;
    }
    this._recordPending();
    const doc = this._doc;
    const clashes = codeClashes(doc, read.ops);
    if (!clashes.ok) {
      const { index, id, kind } = clashes.kind;
      this._pasteNotice(t("canvas.paste_code.kind", {
        n: String(index + 1), id, kind: t(`canvas.paste_code.kind.${kind}` as Key),
      }));
      return;
    }
    const seed = this._seed();
    const source = this._source;
    // Le copie cadono come un Ctrl+V: il punto si prende ora, dov'era il puntatore.
    const spot = this._pasteSpot(text);
    const choices: PasteChoice[] = [];
    if (!clashes.clashes) {
      const report = this._checkCode(read.ops, seed);
      if (!report) return;
      if (!report.ok || !report.summary) {
        this._pasteNotice(checkProblemText(report.problems[0]));
        return;
      }
      const said = summaryText(report.summary);
      if (said === "") {
        this._pasteNotice(t("canvas.paste_code.nothing"));
        return;
      }
      choices.push({ id: "paste", ops: read.ops, said, report });
    } else {
      const update = asUpdates(doc, read.ops);
      const copies = asCopies(doc, read.ops, seed, placedAt(spot.at));
      for (const [id, ops, updated] of [["update", update.ops, update.updated], ["copies", copies, new Set<string>()]] as const) {
        const report = this._checkCode(ops, seed);
        if (!report) return;
        const said = report.ok && report.summary ? summaryText(report.summary, updated) : "";
        choices.push({ id, ops, said, report });
      }
      if (choices.every((choice) => choice.said === "")) {
        const refused = choices.find((choice) => !choice.report.ok);
        this._pasteNotice(refused ? checkProblemText(refused.report.problems[0]) : t("canvas.paste_code.nothing"));
        return;
      }
    }
    const chosen = await this._confirmPaste(choices, clashes.clashes);
    if (!chosen || this._destroyed) return;
    // Intanto la lavagna può essere cambiata (un altro riquadro, il disco), o
    // diventata di sola lettura o troppo grande: il riassunto non dice più il
    // vero, e non si scrive. Mai il silenzio.
    if (this._readOnly || this._isSceneOversized() || !this._doc) {
      this._pasteNotice(t("canvas.paste_code.locked"));
      return;
    }
    if (this._source !== source) {
      this._pasteNotice(t("canvas.paste_code.changed"));
      return;
    }
    const created = this._writeOps(chosen.ops as CanvasIntentOp[], "canvas.change_refused", seed);
    if (!created || this._destroyed || !this._doc) return;
    if (chosen.id === "copies") this._lastPaste = spot.last;
    const born = new Set(this._doc.nodes.map((node) => node.id));
    const cards = created.filter((id) => born.has(id));
    if (cards.length > 0) {
      this._selection = cards;
      this._edgeSelection = [];
      this._displaySelection();
      this._options.onSelectionChange();
    }
  }

  /**
   * La conferma di «Incolla codice»: il riassunto di ogni scelta e gli
   * avvisi. Senza id presi una scelta, «Incolla»; con id presi «Aggiorna le
   * schede» (proposta) e «Aggiungi come copie», ognuna col suo riassunto, o
   * col suo problema e senza bottone se non si può. «Annulla» di serie, Esc
   * come «Annulla».
   */
  _confirmPaste(choices: readonly PasteChoice[], clashes: CodeClashes | null): Promise<PasteChoice | null> {
    const own = openLifetime();
    this._life.add(() => own.close());
    const sentences: string[] = [];
    const usable = choices.filter((choice) => choice.said !== "");
    if (!clashes) sentences.push(t("canvas.paste_code.description", { summary: choices[0]!.said }));
    else {
      const named = [
        [clashes.cards.length, "cards"], [clashes.edges.length, "edges"], [clashes.strokes, "strokes"],
      ] as const;
      const list = named.filter(([count]) => count > 0)
        .map(([count, what]) => plural(count, `canvas.paste_code.count.${what}.one` as Key, `canvas.paste_code.count.${what}` as Key));
      sentences.push(t("canvas.paste_code.clash", { list: list.join(", ") }));
      for (const choice of choices) {
        const problem = choice.report.ok ? null : choice.report.problems[0];
        const summary = problem
          ? t("canvas.paste_code.option_refused", { n: String((problem.index ?? 0) + 1), problem: problemPhrase(problem) })
          : choice.said || t("canvas.paste_code.option_nothing");
        sentences.push(t(choice.id === "update" ? "canvas.paste_code.as_update" : "canvas.paste_code.as_copies", { summary }));
      }
    }
    // Gli avvisi della scelta proposta (la prima che si può).
    const first = usable[0];
    const warnings = first ? warningsText(first.report.warnings, first.report.warnings_omitted) : "";
    if (warnings !== "") sentences.push(warnings);
    const labels: Readonly<Record<PasteChoice["id"], Key>> = {
      paste: "canvas.paste_code.action",
      update: "canvas.paste_code.update",
      copies: "canvas.paste_code.copies",
    };
    const handle = openDialog<PasteChoice | null>({
      title: t("canvas.paste_code.title"),
      description: sentences.join(" "),
      actions: [
        { id: "cancel", label: t("app.cancel"), value: null, autofocus: true },
        // Prima le copie, poi la proposta, che è il bottone pieno in fondo.
        ...[...usable].reverse().map((choice, index, all) => ({
          id: choice.id,
          label: t(labels[choice.id]),
          value: choice,
          ...(index === all.length - 1 ? { kind: "primary" as const } : {}),
        })),
      ],
      dismissValue: null,
      lifetime: own,
    });
    return handle.result.then((chosen) => {
      own.close();
      return chosen;
    });
  }

  /** Un PDF che non si apre: «Spargi le pagine» si spegne, finché il file non cambia (T72). */
  _markBroken(path: string): void {
    if (this._destroyed || this._pdfBroken.has(path)) return;
    const stop = this._options.cards?.watch(path, () => this._forgetBroken(path));
    this._pdfBroken.set(path, stop ?? (() => {}));
  }

  /** Il file di un PDF guasto è cambiato, è tornato o si è aperto: il comando torna acceso. */
  _forgetBroken(path: string): void {
    const stop = this._pdfBroken.get(path);
    if (stop === undefined) return;
    this._pdfBroken.delete(path);
    stop();
  }

  /**
   * Toglie le schede `nodes` e le linee `edges`, con le linee che le tengono,
   * e i tratti `strokes` del livello della radice: un commit solo, che un
   * annulla riporta. `false` se non c'era niente da togliere, o se un tratto
   * non si toglie (allora non si toglie niente).
   */
  _removeNodes(nodes: readonly string[], edges: readonly string[], strokes: readonly string[] = []): boolean {
    if (!this._doc) return false;
    if (strokes.length === 0) return this._writeOps(this._removeOps(nodes, edges)) !== null;
    // Il taglia del Lazo, coi tratti liberi: un gesto degli appunti (T24),
    // con `erase_strokes` e `remove` in una lista sola.
    const ops: CanvasIntentOp[] = [{ op: "erase_strokes", layer: "board", ids: [...strokes] }];
    ops.push(...(this._removeOps(nodes, edges) ?? []));
    return this._writeOps(ops, null) !== null;
  }

  /**
   * `remove` delle schede `nodes` e dei fili `edges` che ci sono (i fili che
   * toccano una scheda tolta li toglie il nucleo); `null` se nessuno c'è.
   */
  _removeOps(nodes: readonly string[], edges: readonly string[]): CanvasIntentOp[] | null {
    const doc = this._doc;
    if (!doc) return null;
    const cards = new Set(doc.nodes.map((node) => node.id));
    const wires = new Set(doc.edges.map((edge) => edge.id));
    const ids = [...new Set([...nodes.filter((id) => cards.has(id)), ...edges.filter((id) => wires.has(id))])];
    return ids.length > 0 ? [{ op: "remove", ids }] : null;
  }

  _reorderSelection(where: "front" | "back"): void {
    if (!this._doc || this._readOnly) return;
    this._writeOps(this._reorderOps(where));
  }

  /** `reorder` delle schede scelte, nell'ordine in cui sono state scelte. */
  _reorderOps(where: "front" | "back"): CanvasIntentOp[] | null {
    const ids = this._selectedNodes().map((node) => node.id);
    if (ids.length === 0) return null;
    return [where === "front" ? { op: "reorder", ids } : { op: "reorder", ids, to: "back" }];
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

  /** Ciò che la banda legge della lavagna e ciò che può chiederle. */
  _statusPort(): CanvasStatusPort {
    const port: CanvasStatusPort = {
      zoomPercent: () => Math.round(this._camera.zoom * 100),
      chosenCount: () => this._selection.length,
      writing: () => {
        const id = this._writingId;
        const entry = id === null ? undefined : this._cards.get(id);
        if (!entry || entry.article.dataset.cardEditing === undefined) return null;
        // In un foglio, anche la cella: «Misure.xlsx · D4» (T27).
        const cell = this._writingContext?.cell ?? "";
        return cell === "" ? writingName(entry.node) : `${writingName(entry.node)} · ${cell}`;
      },
      readOnlyWhy: () => (this._readOnly
        ? (this._unwritable ? t("canvas.unwritable") : t("canvas.status.readonly.panel"))
        : null),
      folder: () => dropFolderOf(this._attachmentDeclared, this._dropChoice, this._options.documentId ?? ""),
      twins: () => {
        const ids = this._shownTwins();
        if (ids === null) return null;
        return {
          count: ids.length,
          frame: () => {
            const chosen = new Set(ids);
            const nodes = this._doc?.nodes.filter((node) => chosen.has(node.id)) ?? [];
            if (nodes.length === 0) return;
            this._fitCamera(true, nodes);
            this._statusSettle();
          },
        };
      },
      zoomTo: (zoom) => {
        if (this._destroyed || !this._doc) return;
        const rect = this._viewport.getBoundingClientRect();
        this._zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, zoom / this._camera.zoom);
        this._statusSettle();
      },
      command: (id) => {
        const found = this.commands().find((command) => command.id === id);
        if (!found) return null;
        return {
          label: found.label,
          hint: commandHint(found),
          disabled: found.disabled(),
          run: () => {
            found.run();
            this._statusSettle();
          },
        };
      },
      zoomMenuAt: () => {
        const rect = this._viewport.getBoundingClientRect();
        return { x: Math.round(rect.right), y: Math.round(rect.bottom) };
      },
    };
    const openSettings = this._options.onOpenSettings;
    return openSettings ? { ...port, openSettings } : port;
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

  /** Che cosa fa il comando `id` su questa tela, o `null` se non lo conosce. */
  _commandBehaviour(id: string): CanvasCommandBehaviour | null {
    const writable = (): string | null => (this._readOnly ? t("canvas.commands.why.read_only") : null);
    const withSelection = (): string | null =>
      writable() ?? (this._selectedNodes().length > 0 ? null : t("canvas.commands.why.no_selection"));
    const withNodes = (): string | null => (this._doc?.nodes.length ? null : t("canvas.commands.why.empty"));
    const only = (): CanvasNode | null => {
      const nodes = this._selectedNodes();
      return nodes.length === 1 ? nodes[0]! : null;
    };
    const center = (): { x: number; y: number } => {
      const rect = this._viewport.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const world = (args?: CanvasCommandArgs) => (args?.at ? this._screenToWorld(args.at.x, args.at.y) : undefined);
    const add = (type: CanvasNode["type"]): CanvasCommandBehaviour => ({
      disabled: writable,
      op: (input) => this._addOps(type, undefined, world(input)),
      run: (args) => this._addNode(type, undefined, world(args)),
    });
    if (id.startsWith("canvas.color.")) {
      // I colori (T47): nessuno, i sei, i nove delle note; «Altro…» apre il
      // selettore del kit.
      const choice = id.slice("canvas.color.".length) as CanvasColorId;
      if (!(CANVAS_COLORS as readonly string[]).includes(choice)) return null;
      return {
        disabled: () => writable() ?? (this._selectedNodes().length || this._edgeSelection.length ? null : t("canvas.commands.why.no_selection")),
        // «Altro…» scrive il colore che il selettore dà (`value`).
        op: (input) => {
          const value = colorValueOf(choice);
          if (value === null) return input?.value === undefined ? null : this._colorOps(input.value, input.edge);
          return this._colorOps(value, input?.edge);
        },
        run: (args) => {
          const value = colorValueOf(choice);
          if (value === null) this._openColorPicker(args?.edge);
          else this._colorSelection(value, args?.edge);
        },
      };
    }
    if (id.startsWith("canvas.layout.")) {
      // «Disponi» (LIC T25): `layout` sulle schede scelte, o su tutte quelle
      // fuori dai gruppi; le posizioni le decide il nucleo.
      const kind = id.slice("canvas.layout.".length) as CanvasLayout;
      if (!(CANVAS_LAYOUTS as readonly string[]).includes(kind)) return null;
      return {
        disabled: () => writable() ?? (this._isSceneOversized() ? t("canvas.too_large") : this._layoutWhy()),
        op: () => this._layoutOps(kind),
        run: () => this._arrangeLayout(kind),
      };
    }
    if (id.startsWith("canvas.align.")) {
      const axis = id.slice("canvas.align.".length) as CanvasAlign;
      if (!(CANVAS_ALIGN as readonly string[]).includes(axis)) return null;
      return {
        disabled: () => writable() ?? (this._selectedNodes().length >= 2 ? null : t("canvas.commands.why.two")),
        op: () => this._arrangeOps(axis),
        run: () => this._layoutSelection(axis),
      };
    }
    if (id.startsWith("canvas.text_size.") || id.startsWith("canvas.text_align.")) {
      // La misura e l'allineamento del testo (T92): delle schede di testo
      // scelte, in un commit, e delle prossime dello strumento Testo.
      const size = id.startsWith("canvas.text_size.") ? id.slice("canvas.text_size.".length) : null;
      const align = id.startsWith("canvas.text_align.") ? id.slice("canvas.text_align.".length) : null;
      const change: Partial<TextStyle> | null = isTextSize(size) ? { size } : isTextAlign(align) ? { align } : null;
      if (change === null) return null;
      return {
        disabled: () => writable()
          ?? (this._isSceneOversized() ? t("canvas.too_large") : null)
          ?? (this._tool === "text" || this._chosenTextNodes().length > 0 ? null : t("canvas.commands.why.no_text_card")),
        // Le prossime schede del Testo non sono nel file: scrivono solo le scelte.
        op: () => this._styleTextOps(change),
        run: () => this._styleText(change),
      };
    }
    if (id.startsWith("canvas.tips.")) {
      const tip = id.slice("canvas.tips.".length) as CanvasTip;
      if (!(CANVAS_TIPS as readonly string[]).includes(tip)) return null;
      return {
        disabled: writable,
        run: () => {
          this._tips = tip;
          this._canvasOptions.sync();
        },
      };
    }
    if (id.startsWith("canvas.nudge.")) {
      const [way, far] = id.slice("canvas.nudge.".length).split(".") as [CanvasNudge, string | undefined];
      const step = far === "far" ? CANVAS_SNAP * 4 : far === "fine" ? 1 : CANVAS_SNAP;
      const dx = way === "left" ? -step : way === "right" ? step : 0;
      const dy = way === "up" ? -step : way === "down" ? step : 0;
      return {
        disabled: withNodes,
        // In sola lettura le frecce scelgono la scheda vicina: non scrivono.
        op: () => (this._readOnly ? null : this._nudgeOps(dx, dy)),
        run: () => this._nudge(dx, dy, way === "down" || way === "right"),
      };
    }
    const tool = toolOfCommand(id);
    if (tool !== null) {
      // C con due schede scelte le collega: la sola volta che uno strumento
      // scrive. Con un filo scelto C non collega (`run` sotto), e così `op`.
      const pair = tool === "connect" ? { op: () => (this._edgeSelection.length > 0 ? null : this._connectPairOps()) } : {};
      return {
        disabled: () => (CANVAS_WRITING_TOOLS.has(tool) ? writable() ?? (this._isSceneOversized() ? t("canvas.too_large") : null) : null),
        ...pair,
        run: () => {
          // C con una scheda scelta comincia il filo da lei, come «Collega…»
          // (T17); con due le collega (T67, D-19 (a)); senza, sceglie lo
          // strumento.
          const chosen = tool === "connect" && this._edgeSelection.length === 0 ? this._selectedNodes() : [];
          if (chosen.length === 2) this._connectPair(chosen[0]!, chosen[1]!);
          else if (chosen.length === 1) this._beginConnectFrom(chosen[0]!.id);
          else this._pickTool(tool);
        },
      };
    }
    if (id === "canvas.parts") {
      // «Parti…» (T74): una sola scheda di nota; spenta se la nota, l'ultima
      // volta che se ne è letto il sommario, non aveva due sezioni.
      if (!this._options.parts) return null;
      return {
        disabled: () => {
          const why = writable();
          if (why !== null) return why;
          const one = only();
          if (!one || !this._partsNote(one)) return t("canvas.commands.why.one_note");
          const count = this._partsCounts.get(one.file!);
          return count !== undefined && count < PARTS_PICKER_MIN_SECTIONS ? t("canvas.commands.why.no_sections") : null;
        },
        run: () => {
          const one = only();
          if (one && this._partsNote(one)) void this._openParts(one.id, "command");
        },
      };
    }
    if (id === "canvas.whole_file") {
      // «Mostra tutto il file» (T75): la scheda-estratto torna la nota intera.
      return {
        disabled: () => {
          const why = writable();
          if (why !== null) return why;
          const one = only();
          return one && noteExcerptOf(one) ? null : t("canvas.commands.why.one_excerpt");
        },
        op: () => {
          const one = only();
          return one ? this._wholeFileOps(one.id) : null;
        },
        run: () => {
          const one = only();
          if (one) this._showWholeFile(one.id);
        },
      };
    }
    if (id === "canvas.crop") {
      // «Ritaglia e ruota» (T78): senza il renderer delle immagini non c'è
      // niente da tagliare, e il comando non c'è.
      if (!this._cropRenderer()) return null;
      return {
        disabled: () => {
          const why = writable() ?? (this._isSceneOversized() ? t("canvas.too_large") : null);
          if (why !== null) return why;
          const one = only();
          if (!one || !this._cropImage(one)) return t("canvas.commands.why.one_image");
          return this._cropUnreadable(one.id) ? t("canvas.crop.why.unreadable") : null;
        },
        run: () => {
          const one = only();
          if (one) this._beginCrop(one.id);
        },
      };
    }
    if (id === "canvas.extract_note" || id === "canvas.copy_note_text") {
      // Convertire (T70): senza la porta delle note i due comandi non ci sono.
      if (!this._options.notes) return null;
      if (id === "canvas.extract_note") {
        return {
          disabled: () => writable() ?? (only()?.type === "text" ? null : t("canvas.commands.why.one_text")),
          // `value` è il percorso della nota appena nata: la crea la shell, prima.
          op: (input) => {
            const one = only();
            return one?.type === "text" && input?.value ? [{ op: "convert", id: one.id, file: input.value }] : null;
          },
          run: () => {
            const one = only();
            if (one?.type === "text") void this._extractNote(one.id).catch((error: unknown) => this._showIntakeError(error));
          },
        };
      }
      return {
        disabled: () => {
          const one = only();
          return writable() ?? (one && cardKindOf(one) === "note" ? null : t("canvas.commands.why.one_note"));
        },
        // `value` è il testo letto dalla nota (o dalle sezioni dell'estratto).
        op: (input) => {
          const one = only();
          return one && cardKindOf(one) === "note" && input?.value !== undefined ? this._copyNoteTextOps(one, input.value) : null;
        },
        run: () => {
          const one = only();
          if (one && cardKindOf(one) === "note") void this._copyNoteText(one.id).catch((error: unknown) => this._showIntakeError(error));
        },
      };
    }
    switch (id) {
      case "canvas.replace_file":
        return {
          disabled: () => {
            const why = writable();
            if (why !== null) return why;
            if (!this._options.onPickFile) return t("canvas.commands.why.no_file_picker");
            return only()?.type === "file" ? null : t("canvas.commands.why.one_file");
          },
          // `value` è il file scelto nel selettore.
          op: (input) => {
            const one = only();
            return one?.type === "file" && input?.value ? this._replaceFileOps(one, input.value) : null;
          },
          run: () => {
            const one = only();
            if (one?.type === "file") void this._replaceFile(one.id).catch((error: unknown) => this._showIntakeError(error));
          },
        };
      // «Il dito scrive» (T64): una scelta di questo computer, anche in sola lettura.
      case "canvas.finger_writes":
        return {
          disabled: () => null,
          run: () => this._setFingerWrites(!this._fingerWritesSetting),
        };
      case "canvas.escape":
        return {
          disabled: () => (this._selection.length || this._edgeSelection.length || this._strokeSelection.size || this._tool !== "select"
            ? null
            : t("canvas.commands.why.no_selection")),
          run: () => {
            // Un filo cominciato da «Collega…» si lascia prima di tutto.
            if (this._connectFrom !== null) this._pickTool("select");
            else if (this._selection.length || this._edgeSelection.length || this._strokeSelection.size) this._clearSelection();
            else this._pickTool("select");
          },
        };
      case "canvas.undo":
        return { disabled: () => (this._undo.length || this._pending ? null : t("canvas.commands.why.no_undo")), run: () => void this.undo() };
      case "canvas.redo":
        return { disabled: () => (this._redo.length ? null : t("canvas.commands.why.no_redo")), run: () => void this.redo() };
      case "canvas.commands":
        return { disabled: () => null, run: () => this._openCommandSearch() };
      case "canvas.add.text":
        // Nasce in scrittura, dove dice il menu o in un posto libero vicino al
        // centro (IMP-042); lasciata vuota se ne va (T44).
        return {
          ...add("text"),
          run: (args) => (args?.at ? this._placeText(args.at.x, args.at.y) : this._placeText()),
        };
      case "canvas.add.link":
        return add("link");
      case "canvas.add.group":
        return add("group");
      case "canvas.add.file":
        return {
          disabled: () => writable() ?? (this._options.onPickFile ? null : t("canvas.commands.why.no_file_picker")),
          // `value` è il file scelto nel selettore.
          op: (input) => (input?.value ? this._addOps("file", input.value, world(input)) : null),
          run: (args) => void this._addFileNode(world(args)).catch((error: unknown) => this._showIntakeError(error)),
        };
      case "canvas.duplicate":
        return { disabled: withSelection, op: () => this._duplicateOps(), run: () => this._duplicateSelection() };
      case "canvas.select_all":
        return { disabled: withNodes, run: () => this._selectAll() };
      case "canvas.enter":
        return {
          disabled: () => (this._selectionFocus() ? null : t("canvas.commands.why.no_selection")),
          // Su una scheda di testo apre il campo: `value` è il testo che vi si registra.
          op: (input) => {
            const focus = this._selectionFocus();
            return focus?.type === "text" && !this._readOnly && input?.value !== undefined ? this._textOps(focus.id, input.value) : null;
          },
          run: () => {
            const focus = this._selectionFocus();
            if (focus) this._enterOrEdit(focus);
          },
        };
      case "canvas.edit":
        return {
          disabled: () => writable() ?? (only()?.type === "text" ? null : t("canvas.commands.why.one_text")),
          // Apre il campo della scheda: `value` è il testo che vi si registra.
          op: (input) => {
            const one = only();
            return one?.type === "text" && input?.value !== undefined ? this._textOps(one.id, input.value) : null;
          },
          run: () => {
            const one = only();
            if (one?.type === "text") this._beginCardEdit(one);
          },
        };
      case "canvas.open":
        return {
          disabled: () => {
            const one = only();
            return one?.type === "file" && one.file ? null : t("canvas.commands.why.one_file");
          },
          run: () => {
            const one = only();
            if (one) this._openFileNode(one);
          },
        };
      case "canvas.open_url":
        return {
          disabled: () => {
            const one = only();
            if (one?.type !== "link") return t("canvas.commands.why.one_link");
            return externalUrl(one.url ?? "") !== null && this._options.media ? null : t("canvas.commands.why.no_url");
          },
          run: () => {
            const one = only();
            const destination = one?.type === "link" ? externalUrl(one.url ?? "") : null;
            const media = this._options.media;
            if (!destination || !media) return;
            if (media.openViewer) void media.openViewer(destination);
            else void media.openExternal(destination);
          },
        };
      // Il menu della scheda (T17).
      case "canvas.open_beside":
        return {
          disabled: () => {
            const one = only();
            if (one?.type !== "file" || !one.file) return t("canvas.commands.why.one_file");
            return this._options.onOpenPathBeside ? null : t("canvas.commands.why.no_beside");
          },
          run: () => {
            const one = only();
            const beside = this._options.onOpenPathBeside;
            if (one?.type !== "file" || !one.file || !beside) return;
            const path = `/${one.file.replace(/^\/+/, "")}${one.subpath ?? ""}`;
            void Promise.resolve(beside(path, this._options.documentId)).catch((error: unknown) => this._showIntakeError(error));
          },
        };
      // «Apri a lato per questo» (T45): la scheda attiva, allo stesso punto.
      case "canvas.open_beside_here":
        return {
          label: () => this._besideHere()?.label ?? null,
          disabled: () => {
            if (this._besideHere() === null) return t("canvas.commands.why.no_active_card");
            return this._besideOpener() ? null : t("canvas.commands.why.no_beside");
          },
          run: () => {
            const here = this._besideHere();
            const open = this._besideOpener();
            if (!here || !open) return;
            void Promise.resolve(open(here.path, this._options.documentId)).catch((error: unknown) => this._showIntakeError(error));
          },
        };
      case "canvas.open_viewer":
        return {
          disabled: () => {
            const one = only();
            return one && cardKindOf(one) === "image" ? null : t("canvas.commands.why.one_image");
          },
          run: () => {
            const one = only();
            if (!one || cardKindOf(one) !== "image" || one.type !== "file" || !one.file) return;
            const path = `/${cardTarget(one).path.replace(/^\/+/, "")}`;
            void this._options.onOpenPath?.(path, this._options.documentId);
          },
        };
      case "canvas.web_preview":
        return {
          disabled: () => {
            const one = only();
            if (one?.type !== "link") return t("canvas.commands.why.one_link");
            const button = this._webPreviewButton(one.id);
            return button && !button.disabled ? null : t("canvas.commands.why.no_preview");
          },
          // Lo stesso gesto del pulsante della scheda: la sua porta, una
          // richiesta sola.
          run: () => {
            const one = only();
            const button = one ? this._webPreviewButton(one.id) : null;
            if (button && !button.disabled) button.click();
          },
        };
      case "canvas.connect":
        // Con una scheda comincia il filo da lei; con due le collega, come C
        // (T67, D-19 (a)): così vale anche nella barra della selezione (T51).
        return {
          disabled: () => {
            const why = writable();
            if (why !== null) return why;
            const count = this._selectedNodes().length;
            return count === 1 || count === 2 ? null : t("canvas.commands.why.one_or_two");
          },
          // Con una scheda sola il filo si tira col gesto: scrive solo con due.
          op: () => this._connectPairOps(),
          run: () => {
            const chosen = this._selectedNodes();
            if (chosen.length === 2) this._connectPair(chosen[0]!, chosen[1]!);
            else if (chosen.length === 1) this._beginConnectFrom(chosen[0]!.id);
          },
        };
      case "canvas.group":
        return {
          disabled: () => withSelection() ?? (this._isSceneOversized() ? t("canvas.too_large") : null),
          op: () => this._groupOps(),
          run: () => this._groupSelection(),
        };
      case "canvas.trash_file":
        return {
          disabled: () => {
            const why = writable();
            if (why !== null) return why;
            if (!this._options.onTrashPath) return t("canvas.commands.why.no_trash");
            return this._selectedNodes().some((node) => node.type === "file" && isVaultPath(cardTarget(node).path))
              ? null
              : t("canvas.commands.why.no_file_card");
          },
          // Il cestino è della shell (`onTrashPath`); poi le schede se ne vanno.
          op: () => this._removeOps(this._selectedNodes().map((node) => node.id), []),
          run: () => void this._trashSelectedFiles().catch((error: unknown) => this._showIntakeError(error)),
        };
      case "canvas.spread_pages":
        return {
          disabled: () => {
            const why = writable();
            if (why !== null) return why;
            const one = only();
            if (one?.type !== "file" || cardKindOf(one) !== "pdf" || !isVaultPath(cardTarget(one).path)) return t("canvas.commands.why.no_pdf");
            if (!this._options.cards?.pdfPages) return t("canvas.commands.why.no_pdf_reader");
            return this._pdfBroken.has(cardTarget(one).path) ? t("canvas.commands.why.pdf_unreadable") : null;
          },
          // `value` sono le pagine scritte nel campo; il conto e le misure le
          // legge `canvas.apply` dal PDF, come qui li legge la tela. Quante
          // pagine nasceranno lo sa solo il conto: l'etichetta del gruppo
          // resta quella di serie del nucleo.
          op: (input) => {
            const one = only();
            return one && input?.value ? [{ op: "spread_pages", id: one.id, pages: input.value }] : null;
          },
          run: () => void this._spreadPages().catch((error: unknown) => this._showIntakeError(error)),
        };
      case "canvas.edge.reverse":
        return {
          disabled: () => writable() ?? (this._edgeSelection.length ? null : t("canvas.commands.why.no_edge")),
          op: (input) => this._reverseOps(input?.edge ?? this._edgeSelection[0]),
          run: (args) => this._reverseEdge(args?.edge ?? this._edgeSelection[0]),
        };
      case "canvas.delete":
        return {
          disabled: () => writable() ?? (this._selection.length || this._edgeSelection.length ? null : t("canvas.commands.why.no_selection")),
          op: () => this._removeOps(this._selection, this._edgeSelection),
          run: () => this._deleteSelection(),
        };
      case "canvas.bring_front":
        return { disabled: withSelection, op: () => this._reorderOps("front"), run: () => this._reorderSelection("front") };
      case "canvas.send_back":
        return { disabled: withSelection, op: () => this._reorderOps("back"), run: () => this._reorderSelection("back") };
      // La lavagna come codice (LIC T25). Copiare non scrive: vale anche in
      // sola lettura. Incollare legge gli appunti, controlla e chiede.
      case "canvas.copy_code":
        return {
          disabled: () => this._copyCodeWhy(),
          run: () => this._copyCode(),
        };
      case "canvas.paste_code":
        return {
          disabled: () => writable() ?? (this._isSceneOversized() ? t("canvas.too_large") : null),
          // `value` è il testo degli appunti: la lista che scriverebbe, se è una lista.
          op: (input) => {
            const read = input?.value === undefined ? null : readCodeList(input.value);
            return read?.ok ? (read.ops as CanvasIntentOp[]) : null;
          },
          run: () => void this._pasteCode(),
        };
      case "canvas.distribute_x":
      case "canvas.distribute_y": {
        const axis = id === "canvas.distribute_x" ? "distribute-x" : "distribute-y";
        return {
          disabled: () => writable() ?? (this._selectedNodes().length >= 3 ? null : t("canvas.commands.why.three")),
          op: () => this._arrangeOps(axis),
          run: () => this._layoutSelection(axis),
        };
      }
      // I menu della riga delle opzioni (T50).
      case "canvas.pen_menu":
        return {
          disabled: () => writable() ?? (this._isSceneOversized() ? t("canvas.too_large") : null),
          run: () => {
            // Con uno strumento che non scrive a mano, prima lo strumento
            // della penna: la riga mostra il pulsante e il menu ci si apre.
            if (!CANVAS_INK_TOOLS.has(this._tool)) this._pickTool(this._penChoice.tool);
            this._penMenu.open();
          },
        };
      case "canvas.color_menu":
        return { disabled: withSelection, run: () => this._canvasOptions.openColorMenu() };
      case "canvas.align_menu":
        return {
          disabled: () => writable() ?? (this._selectedNodes().length >= 2 ? null : t("canvas.commands.why.two")),
          run: () => this._canvasOptions.openAlignMenu(),
        };
      case "canvas.fit":
        return {
          disabled: () => null,
          // Un salto (T53): vola, o arriva subito col movimento ridotto.
          run: () => this._jumpCamera(this._fitTarget(this._doc?.nodes ?? [])),
        };
      case "canvas.fit_selection":
        return {
          disabled: () => (this._selectedNodes().length ? null : t("canvas.commands.why.no_selection")),
          run: () => this._jumpCamera(this._fitTarget(this._selectedNodes())),
        };
      case "canvas.zoom_reset":
        return { disabled: () => null, run: () => this._zoomToActual() };
      // Il menu radiale (T63): dove si è cliccato, o al centro della vista.
      case "canvas.radial":
        return { disabled: () => null, run: (args) => this._openRadialFromMenu(args?.at ?? null) };
      // La griglia di questa lavagna (T71): la vista, anche in sola lettura.
      case "canvas.grid_toggle":
        return { disabled: () => null, run: () => this._toggleGrid() };
      // Senza interfaccia (T65): la vista, anche in sola lettura.
      case "canvas.bare":
        return { disabled: () => null, run: () => this._workspace.setBare(!this._workspace.bare) };
      // Il navigatore (T55): c'è la voce che serve adesso, Nascondi o Mostra.
      case "canvas.navigator.hide":
      case "canvas.navigator.show": {
        const hide = id === "canvas.navigator.hide";
        if (hide === this._navigatorClosed()) return null;
        return { disabled: () => null, run: () => this._setNavigatorHidden(hide) };
      }
      case "canvas.zoom_in":
      case "canvas.zoom_out":
        return {
          disabled: () => null,
          run: (args) => {
            const at = args?.at ?? center();
            this._zoomAt(at.x, at.y, id === "canvas.zoom_in" ? CANVAS_ZOOM_STEP : 1 / CANVAS_ZOOM_STEP);
          },
        };
      default:
        return null;
    }
  }

  /**
   * Le punte di un filo nuovo, come dice la riga delle opzioni: alla fine
   * (`toEnd: "arrow"`, come sempre), all'inizio, o nessuna. JSON Canvas mette
   * la punta alla fine quando `toEnd` manca: «nessuna» la scrive.
   */
  _tipEnds(): Pick<CanvasEdge, "fromEnd" | "toEnd"> {
    if (this._tips === "none") return { toEnd: "none" };
    if (this._tips === "start") return { fromEnd: "arrow", toEnd: "none" };
    return { toEnd: "arrow" };
  }

  /** Le schede di testo fra quelle scelte. */
  _chosenTextNodes(): CanvasNode[] {
    return this._selectedNodes().filter((node) => node.type === "text");
  }

  /**
   * La misura e l'allineamento che la riga segna (T92): quelli delle schede
   * di testo scelte (`null` se sono diversi); senza, col Testo quelli delle
   * sue prossime schede, e nessuno con le altre schede (i controlli sono
   * spenti).
   */
  _chosenText(): CanvasChosenText {
    const nodes = this._chosenTextNodes();
    if (nodes.length === 0) return this._tool === "text" ? this._textNext : { size: null, align: null };
    const styles = nodes.map(textStyle);
    const first = styles[0]!;
    return {
      size: styles.every((style) => style.size === first.size) ? first.size : null,
      align: styles.every((style) => style.align === first.align) ? first.align : null,
    };
  }

  /**
   * Cambia la misura o l'allineamento (T92): le prossime schede dello
   * strumento Testo lo prendono, e le schede di testo scelte lo scrivono in
   * `fub:text`, tutte in un commit (un annulla). Ogni scheda tiene l'altro
   * valore suo; una che si mostra già così non cambia, e tornata di serie
   * perde il campo. Il testo della scheda non si tocca.
   */
  _styleText(change: Partial<TextStyle>): void {
    if (this._readOnly || this._destroyed) return;
    this._textNext = { ...this._textNext, ...change };
    this._writeOps(this._styleTextOps(change));
    this._canvasOptions.sync();
  }

  /**
   * La `set` di `fub:text` di ogni scheda di testo scelta che con `change` si
   * mostra diversa; `null` se nessuna cambia.
   */
  _styleTextOps(change: Partial<TextStyle>): CanvasIntentOp[] | null {
    const ops: CanvasIntentOp[] = [];
    for (const node of this._chosenTextNodes()) {
      const next = withTextStyle(node, { ...textStyle(node), ...change });
      const op = next ? setOp(node, next) : null;
      if (op) ops.push(op);
    }
    return ops.length > 0 ? ops : null;
  }

  /** Il colore delle schede scelte: `undefined` quello di serie, `null` se sono diversi. */
  _chosenColor(): string | null | undefined {
    const colors = new Set(this._selectedNodes().map((node) => node.color ?? ""));
    if (colors.size > 1) return null;
    const [only] = colors;
    return only ? only : undefined;
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

  // --- la barra della selezione (T51) ------------------------------------------

  /**
   * Mostra la barra della selezione sopra le schede scelte, o la toglie: la
   * toglie durante un gesto sulle schede (spostare, ridimensionare, scegliere
   * col rettangolo o col lazo), con la penna giù e mentre si scrive in una
   * scheda (`selectionBarWanted`), e quando le schede sono tutte fuori dalla
   * vista. Con la penna giù torna quando si alza (il silenzio della penna).
   * Lo zoom e lo spostamento della vista non la tolgono: la barra segue le
   * schede a ogni passo della camera (`_followSelectionBar`, #411 C-06).
   */
  _syncSelectionBar(): void {
    const bar = this._selectionBar as CanvasSelectionBar | undefined;
    // Le preferenze arrivano anche durante il costruttore, prima della barra.
    if (!bar) return;
    const shown = this._doc && !this._destroyed && !this._isSceneOversized() && this._isShown();
    const nodes = shown ? this._selectedNodes() : [];
    // I tratti scelti col Lazo (T86) contano come le schede.
    const units = shown ? this._chosenStrokes() : [];
    const chosen = nodes.length + units.length;
    const pen = this._penDown;
    // Col ritaglio aperto la sua barra prende il posto di quella della selezione.
    const writing = this._editor !== null || this._activeId !== null || this._canvasOptions.mode === "writing" || this._crop !== null;
    // La vista ha cambiato misura, o la scheda: la barra del ritaglio si riposa.
    this._placeCropBar();
    if (!selectionBarWanted({ chosen, gesture: this._cardGestureActive(), pen, writing })) {
      bar.hide();
      if (pen && chosen > 0 && this._quiet.active) this._quiet.defer("selection-bar", () => this._syncSelectionBar());
      return;
    }
    const one = nodes.length === 1 ? nodes[0]! : null;
    const open = one?.type === "file" && one.file ? "canvas.open" : one?.type === "link" ? "canvas.open_url" : null;
    bar.show({
      chosen: nodes.length,
      open,
      crop: one !== null && !this._readOnly && this._cropImage(one) && this._cropRenderer(),
      strokes: this._strokesShown(units),
      ...this._selectionBarWhere(nodes, units),
    });
  }

  /**
   * La barra della selezione già mostrata segue le schede scelte alla camera
   * di adesso (#411 C-06): solo il posto, senza rifare i pulsanti, così
   * regge un passo di zoom a ogni fotogramma.
   */
  _followSelectionBar(): void {
    const bar = this._selectionBar as CanvasSelectionBar | undefined;
    if (!bar?.shown) return;
    bar.follow(this._selectionBarWhere(this._selectedNodes(), this._chosenStrokes()));
  }

  /** Dove sta la barra della selezione: il riquadro delle schede e dei tratti scelti sullo schermo, e la vista. */
  _selectionBarWhere(
    nodes: readonly CanvasNode[],
    units: readonly { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }[],
  ): Pick<SelectionBarShow, "box" | "view" | "offset"> {
    const zoom = this._camera.zoom;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of nodes) {
      left = Math.min(left, node.x);
      top = Math.min(top, node.y);
      right = Math.max(right, node.x + node.width);
      bottom = Math.max(bottom, node.y + node.height);
    }
    for (const unit of units) {
      left = Math.min(left, unit.minX);
      top = Math.min(top, unit.minY);
      right = Math.max(right, unit.maxX);
      bottom = Math.max(bottom, unit.maxY);
    }
    const box = {
      left: left * zoom + this._camera.x,
      top: top * zoom + this._camera.y,
      right: right * zoom + this._camera.x,
      bottom: bottom * zoom + this._camera.y,
    };
    const rect = this._viewport.getBoundingClientRect();
    return {
      box,
      view: { width: rect.width || 800, height: rect.height || 600 },
      offset: { left: this._viewport.offsetLeft, top: this._viewport.offsetTop },
    };
  }

  /**
   * Raggruppa (T51): un gruppo attorno alle schede scelte, con un margine,
   * messo nella pila subito sotto la prima di loro, così resta dietro; poi è
   * scelto lui. Un passo d'annulla solo.
   */
  _groupSelection(): void {
    if (!this._doc || this._readOnly || this._isSceneOversized()) return;
    const group = this._writeOps(this._groupOps())?.[0];
    if (group === undefined) return;
    this._selection = [group];
    this._edgeSelection = [];
    this._options.onSelectionChange();
    this._render();
  }

  /** `group` delle schede scelte: il rettangolo, il margine e il posto nella pila li dà il nucleo. */
  _groupOps(): CanvasIntentOp[] | null {
    const ids = this._selectedNodes().map((node) => node.id);
    return ids.length > 0 ? [{ op: "group", ids }] : null;
  }

  /** La prima scheda scelta, a cui vanno le frecce e Invio. */
  _selectionFocus(): CanvasNode | undefined {
    const first = this._selection[0];
    return first ? this._doc?.nodes.find((n) => n.id === first) : undefined;
  }

  _selectAll(): void {
    if (!this._doc) return;
    this._selection = this._doc.nodes.map((n) => n.id);
    this._edgeSelection = [];
    this._options.onSelectionChange();
    this._render();
  }

  /**
   * Le frecce: con la lavagna scrivibile spostano la scelta di `dx`, `dy`;
   * in sola lettura passano alla scheda dopo (`forward`) o prima; senza
   * scelta prendono la prima scheda.
   */
  _nudge(dx: number, dy: number, forward: boolean): void {
    if (!this._doc) return;
    const focus = this._selectionFocus();
    if (focus && !this._readOnly) {
      this._writeOps(this._nudgeOps(dx, dy));
    } else if (focus) {
      const index = this._doc.nodes.indexOf(focus);
      const next = this._doc.nodes[index + (forward ? 1 : -1)];
      if (next) {
        this._selection = [next.id];
        this._options.onSelectionChange();
        this._render();
      }
    } else if (this._doc.nodes.length) {
      this._selection = [this._doc.nodes[0].id];
      this._options.onSelectionChange();
      this._render();
    }
  }

  /** Il colore `color` (`undefined`: quello di serie) al filo `edge`, o alle schede scelte, o ai fili scelti. */
  _colorSelection(color: string | undefined, edge?: string): void {
    if (!this._doc || this._readOnly) return;
    this._writeOps(this._colorOps(color, edge));
  }

  /**
   * `color` di ciò che il menu colora: il filo `edge`, o le schede scelte, o
   * i fili scelti (nell'ordine della lavagna). `undefined` toglie il colore.
   * `null` se non c'è niente da colorare.
   */
  _colorOps(color: string | undefined, edge?: string): CanvasIntentOp[] | null {
    const doc = this._doc;
    if (!doc) return null;
    const nodes = edge === undefined ? this._selectedNodes().map((node) => node.id) : [];
    const wires = edge === undefined ? this._edgeSelection : [edge];
    const ids = nodes.length > 0 ? nodes : doc.edges.filter((one) => wires.includes(one.id)).map((one) => one.id);
    return ids.length > 0 ? [{ op: "color", ids, color: color ?? null }] : null;
  }

  /** `move` delle schede scelte di `dx`, `dy` (le frecce): un gruppo si sposta da solo. */
  _nudgeOps(dx: number, dy: number): CanvasIntentOp[] | null {
    const ids = this._selectedNodes().map((node) => node.id);
    return ids.length > 0 && (dx !== 0 || dy !== 0) ? [{ op: "move", ids, dx, dy }] : null;
  }

  // --- i colori (T47) ---------------------------------------------------------

  /**
   * Il colore di ciò che il menu colora: il filo `edge`, o le schede scelte,
   * o i fili scelti. `undefined` quello di serie, `null` se sono diversi.
   */
  _targetColor(edge?: string): string | null | undefined {
    if (edge !== undefined) return this._doc?.edges.find((one) => one.id === edge)?.color;
    if (this._selectedNodes().length) return this._chosenColor();
    const colors = new Set((this._doc?.edges ?? []).filter((one) => this._edgeSelection.includes(one.id)).map((one) => one.color ?? ""));
    if (colors.size > 1) return null;
    const [only] = colors;
    return only ? only : undefined;
  }

  /**
   * I pallini del menu dei colori: il colore che la pelle dà a ogni scelta,
   * letto da un campione con la sua chiave dentro la lavagna. Così il menu
   * mostra le tinte del tema di adesso e non ne scrive una sua; «Nessuno» è
   * un pallino vuoto, «Altro…» non ne ha.
   */
  _colorSwatches(): ReadonlyMap<CanvasColorChoice, string> {
    const swatches = new Map<CanvasColorChoice, string>([["none", "transparent"]]);
    const probe = document.createElement("span");
    probe.hidden = true;
    this._root.append(probe);
    try {
      for (const choice of [...JSON_CANVAS_COLORS, ...NOTE_COLORS.map((color) => color.id)]) {
        probe.dataset.canvasColor = choice;
        const value = getComputedStyle(probe).getPropertyValue("--canvas-color").trim();
        if (value) swatches.set(choice, value);
      }
    } finally {
      probe.remove();
    }
    return swatches;
  }

  /**
   * «Altro…» (T47): il selettore del kit sotto la scheda scelta (o sulla
   * lavagna, per un filo), col colore di adesso, i nove delle note fra i
   * consigliati e i colori liberi della lavagna fra quelli del documento. Un
   * colore scelto si scrive `#rrggbb` minuscolo; Esc o un clic fuori lo
   * chiudono, e con la lavagna si chiude anche lui.
   */
  _openColorPicker(edge?: string): void {
    if (!this._doc || this._readOnly || this._destroyed) return;
    this._colorPicker?.close();
    const current = this._targetColor(edge);
    const own = openLifetime();
    const free = new Set<string>();
    for (const one of [...this._doc.nodes, ...this._doc.edges]) {
      if (colorLook(one.color)?.key === "custom" && free.size < 12) free.add(one.color!.toLowerCase());
    }
    const picker = createColorPicker({
      value: current && colorLook(current) && current.startsWith("#") ? current : null,
      text: canvasPickerText(),
      recommended: NOTE_COLORS.map((color) => ({ color: color.hex, name: colorMenuLabel(color.id) })),
      documentColors: [...free].map((color) => ({ color, name: color })),
      onChange: (color) => {
        const value = writeColor(color);
        if (value === null) return;
        this._recordPending();
        this._colorSelection(value, edge);
      },
      lifetime: own,
    });
    const first = edge === undefined && this._selection[0];
    const card = first ? this._stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(first)}"]`) : null;
    const handle = openPopover({
      anchor: card ?? this._viewport,
      content: picker.element,
      label: t("canvas.color.command.other"),
      className: "kit-color-popover",
      lifetime: own,
      onClose: () => {
        if (this._colorPicker === handle) this._colorPicker = null;
        own.close();
      },
    });
    this._colorPicker = handle;
    picker.focus();
  }

  /** Il filo `edge` va nell'altro verso: estremi, lati e punte si scambiano. */
  _reverseEdge(edge: string | undefined): void {
    if (!this._doc || this._readOnly) return;
    this._writeOps(this._reverseOps(edge));
  }

  /**
   * L'inversione del filo `edge`: `reverse` del nucleo, che scambia estremi e
   * lati e tiene le punte sulla scheda a cui stavano, come `reversedEdge` di
   * `model.ts` (#353). `null` se il filo non c'è.
   */
  _reverseOps(edge: string | undefined): CanvasIntentOp[] | null {
    const current = edge === undefined ? undefined : this._doc?.edges.find((one) => one.id === edge);
    return current ? [{ op: "reverse", ids: [current.id] }] : null;
  }

  /**
   * Apre la ricerca dei comandi sopra la tela, in alto al centro. Esc la
   * chiude e rimette il fuoco dov'era, anche nel campo di una scheda; un
   * comando scelto chiude prima il campo (il testo si registra) e poi parte.
   */
  _openCommandSearch(): void {
    if (this._destroyed || !this._doc || this._searching) return;
    const recents = this._options.recentCommands ?? SHARED_RECENT_COMMANDS;
    const documentId = this._options.documentId ?? "";
    const viewport = this._viewport;
    const anchor = {
      getBoundingClientRect: () => {
        const rect = viewport.getBoundingClientRect();
        return { left: rect.left, top: rect.top + 8, width: rect.width, height: 0 };
      },
    };
    const commands = this.commands().filter((command) => command.id !== "canvas.commands");
    this._searching = true;
    const search = openCommandSearch({
      anchor,
      commands,
      recent: () => recents.list(documentId),
      lifetime: this._life,
      onClose: (reason, chosen) => {
        this._commandSearch = null;
        this._searching = false;
        if (this._destroyed) return;
        const editor = this._editor;
        if (chosen) {
          if (editor) this._leaveField(true);
          recents.remember(documentId, chosen.id);
          if (chosen.disabled() === null) chosen.run();
          this._statusSettle();
          return;
        }
        // Esc riporta il fuoco nel campo; un gesto fuori lo lascia, come
        // l'avrebbe lasciato senza la ricerca.
        if (editor && reason !== "escape" && !editor.place.contains(document.activeElement)) this._leaveField(false);
      },
    });
    this._commandSearch = search;
    // I recenti ricordati arrivano dopo la prima lettura, e l'elenco si rifà.
    void recents.load(documentId).then(() => {
      if (this._commandSearch === search) search.refresh();
    });
  }

  // --- il selettore delle sezioni (T74) ---------------------------------------

  /** La scheda mostra una nota di cui si possono scegliere le sezioni (`.md`, T73). */
  _partsNote(node: CanvasNode): node is CanvasNode & { file: string } {
    return node.type === "file" && isVaultPath(node.file) && partsFit(SECTIONS_PROBE, node.file);
  }

  /**
   * Apre il selettore delle sezioni sulla scheda `id`: dopo il rilascio
   * (`drop`, e solo se la scheda mostra ancora la nota intera) o da «Parti…»
   * (`command`, con le sezioni di adesso già spuntate). Il sommario arriva
   * dall'indice; una nota con meno di due titoli non apre niente, e da
   * «Parti…» la barra dice perché. Una risposta arrivata dopo un'altra
   * richiesta, o dopo che la scheda è cambiata o sparita, non apre niente.
   */
  async _openParts(id: string, from: "drop" | "command"): Promise<void> {
    const port = this._options.parts;
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (!port || !node || !this._partsNote(node) || this._readOnly || this._destroyed) return;
    const path = node.file;
    const round = ++this._partsRound;
    this._closePartsPicker();
    let headings: readonly PartsHeading[];
    try {
      headings = await port.outline(path);
    } catch {
      headings = [];
    }
    if (round !== this._partsRound || this._destroyed || this._readOnly || !this._doc || this._isSceneOversized()) return;
    const now = this._doc.nodes.find((one) => one.id === id);
    if (!now || !this._partsNote(now) || now.file !== path) return;
    if (from === "drop" && (now.subpath !== undefined || Object.prototype.hasOwnProperty.call(now, PARTS_KEY))) return;
    const sections = partsSections(headings);
    this._partsCounts.set(path, sections.length);
    if (sections.length < PARTS_PICKER_MIN_SECTIONS) {
      if (from === "command") this._showNotice(t("canvas.commands.why.no_sections"));
      return;
    }
    let opened: PartsPickerHandle | null = null;
    const forget = (): void => {
      if (opened !== null && this._partsPicker?.handle === opened) this._partsPicker = null;
    };
    const show = port.show;
    opened = openPartsPicker({
      path,
      sections,
      chosen: partsChosen(now),
      place: () => this._partsPlace(id),
      ...(show ? { show: (file: string, heading: string | null, host: HTMLElement, life: Lifetime) => show.call(port, file, heading, host, life) } : {}),
      onPut: (keys) => {
        forget();
        this._putParts(id, path, keys);
      },
      onClose: forget,
      lifetime: this._life,
    });
    if (!opened.closed) this._partsPicker = { handle: opened, node: id, path };
  }

  /**
   * Scrive le sezioni scelte sulla scheda, in un commit (un annulla riporta
   * la nota intera): una sezione è il `subpath` `#Titolo`; due o più anche
   * `fub:parts` `sections` (T73); nessuna toglie l'una e l'altro. I campi
   * sconosciuti di un `fub:parts` di sezioni valido restano.
   */
  _putParts(id: string, path: string, keys: readonly string[]): void {
    const doc = this._doc;
    const node = doc?.nodes.find((one) => one.id === id);
    if (!doc || !node || node.type !== "file" || node.file !== path || this._readOnly || this._destroyed) return;
    const next: CanvasNode = { ...node };
    delete next.subpath;
    delete next[PARTS_KEY];
    if (keys.length > 0) {
      const read = nodeParts(node);
      const extra: PartsExtra = read?.state === "ok" && read.parts.kind === "sections" ? read.parts.extra : {};
      const written = writeParts(path, { kind: "sections", sections: keys, extra });
      if (written.outcome !== "written") return;
      if (written.subpath !== null) next.subpath = written.subpath;
      if (written.parts !== null) next[PARTS_KEY] = written.parts;
    }
    // I campi cambiati della scheda, con una `set` (T24).
    const op = setOp(node, next);
    if (op) this._writeOps([op]);
  }

  /**
   * «Mostra tutto il file» (T75): la scheda `id` toglie `fub:parts` e il
   * `subpath` in un commit, e mostra la nota intera; un annulla riporta
   * l'estratto. Una scheda che non è un estratto non cambia.
   */
  _showWholeFile(id: string): void {
    if (this._readOnly || this._destroyed || this._isSceneOversized()) return;
    this._writeOps(this._wholeFileOps(id));
  }

  /** La `set` che toglie `subpath` e `fub:parts` alla scheda-estratto `id`; `null` se non è un estratto. */
  _wholeFileOps(id: string): CanvasIntentOp[] | null {
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (!node || !noteExcerptOf(node)) return null;
    const next: CanvasNode = { ...node };
    delete next.subpath;
    delete next[PARTS_KEY];
    const op = setOp(node, next);
    return op ? [op] : null;
  }

  /**
   * Apre la fonte di un estratto alla sua prima sezione (T75): accanto
   * (`beside`, nella finestra stretta nello stesso riquadro, come «Apri a
   * lato per questo») o nel riquadro (`pane`, Ctrl+clic). La scheda non
   * cambia.
   */
  _openExcerptSource(node: CanvasNode, where: "beside" | "pane"): void {
    const excerpt = noteExcerptOf(node);
    if (!excerpt || node.type !== "file" || !node.file) return;
    const path = excerptSourcePath(node.file, excerpt);
    const open = where === "pane" ? this._options.onOpenPath ?? null : this._besideOpener() ?? this._options.onOpenPath ?? null;
    if (!open) return;
    void Promise.resolve(open(path, this._options.documentId)).catch((error: unknown) => this._showIntakeError(error));
  }

  /** Chiude il selettore se la sua scheda non c'è più, mostra un altro file o la lavagna non si scrive. */
  _syncPartsPicker(): void {
    const open = this._partsPicker;
    if (!open) return;
    const node = this._doc?.nodes.find((one) => one.id === open.node);
    const alive = node !== undefined && node.type === "file" && node.file === open.path;
    if (alive && !this._readOnly && !this._destroyed && !this._isSceneOversized()) return;
    this._closePartsPicker();
  }

  _closePartsPicker(): void {
    const open = this._partsPicker;
    this._partsPicker = null;
    open?.handle.close();
  }

  // --- il lettore (T76) ---------------------------------------------------------

  /** Il puntatore si è mosso con Spazio giù: oltre `READER_TAP_SLOP` non è più un tocco. */
  _spaceTapMoved(x: number, y: number): void {
    const tap = this._spaceTap;
    if (!tap || tap.spoiled) return;
    if (tap.from === null) {
      tap.from = { x, y };
      return;
    }
    if (Math.hypot(x - tap.from.x, y - tap.from.y) > READER_TAP_SLOP) tap.spoiled = true;
  }

  /**
   * Il tocco di Spazio: con una sola scheda di nota scelta (intera o un
   * estratto) apre il lettore sopra l'area della lavagna. Senza niente
   * scelto, con più schede, con una scheda d'altro o un file mancante non fa
   * niente. La vista e la scelta non cambiano; il fuoco va sulla scheda, e
   * ci torna quando il lettore si chiude.
   */
  _openReaderOnChoice(): void {
    const port = this._options.parts;
    if (!port?.show || this._reader || this._destroyed || !this._doc || this._isSceneOversized()) return;
    if (this._selection.length !== 1 || this._edgeSelection.length > 0) return;
    const node = this._doc.nodes.find((one) => one.id === this._selection[0]);
    if (!node || !this._partsNote(node)) return;
    const entry = this._cards.get(node.id);
    if (!entry || entry.article.hasAttribute("data-card-missing")) return;
    const path = node.file;
    this._closePartsPicker();
    // Il fuoco parte dalla scheda: chiuso il lettore, ci torna.
    entry.article.focus({ preventScroll: true });
    const show = port.show;
    const watch = this._options.cards?.watch;
    let opened: ReaderHandle | null = null;
    opened = openReader({
      host: this._area,
      path,
      excerpt: partsChosen(node),
      writable: this._readerWritable(node),
      port: {
        outline: (file) => port.outline(file),
        show: (file, heading, host, life) => show.call(port, file, heading, host, life),
        ...(watch ? { watch: (file: string, changed: () => void) => watch(file, changed) } : {}),
      },
      onAdd: (keys) => {
        if (this._reader?.handle !== opened) return;
        const now = this._doc?.nodes.find((one) => one.id === node.id);
        if (!now || !this._readerWritable(now)) return;
        this._putParts(node.id, path, keys);
      },
      onClose: (reason) => {
        if (opened === null || this._reader?.handle !== opened) return;
        this._reader = null;
        if (reason === "closed" || this._destroyed) return;
        const back = this._cards.get(node.id);
        if (back?.article.isConnected) back.article.focus({ preventScroll: true });
        else this._viewport.focus({ preventScroll: true });
      },
      lifetime: this._life,
    });
    if (!opened.closed) this._reader = { handle: opened, node: node.id, path };
  }

  /** «+ Aggiungi all'estratto» c'è: un estratto, su una lavagna che si scrive. */
  _readerWritable(node: CanvasNode): boolean {
    return !this._readOnly && !this._isSceneOversized() && noteExcerptOf(node) !== null;
  }

  /**
   * La lavagna è cambiata col lettore aperto: la scheda tolta, o su un altro
   * file, lo chiude; un'altra scelta di sezioni o la sola lettura lo
   * aggiornano.
   */
  _syncReader(): void {
    const open = this._reader;
    if (!open) return;
    const node = this._doc?.nodes.find((one) => one.id === open.node);
    if (!node || node.type !== "file" || node.file !== open.path || this._destroyed || this._isSceneOversized()) {
      this._reader = null;
      open.handle.close();
      return;
    }
    open.handle.update({ excerpt: partsChosen(node), writable: this._readerWritable(node) });
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

  /**
   * La testata del menu di una scheda (T17): «Scheda di {specie}» col nome
   * (il file, l'indirizzo, la prima riga del testo), o «{n} schede».
   */
  _cardMenuTarget(nodes: readonly CanvasNode[], ref: string): SurfaceMenu["target"] {
    if (nodes.length !== 1) return { kind: "node", ref, label: t("canvas_menu.header_many", { n: String(nodes.length) }) };
    const one = nodes[0]!;
    const kind = one.type === "text" ? "text" : cardKindOf(one) ?? "file";
    const label = t("canvas_menu.header", { kind: t(`canvas_menu.kind.${kind}`) });
    const name = cardMenuName(one);
    return name ? { kind: "node", ref, label, name } : { kind: "node", ref, label };
  }

  /**
   * Il menu «Scheda della lavagna» (T17), voci del catalogo nell'ordine di
   * `tasto-destro.md`: Apri, Apri a lato, Collega… · C; Colore › (scelte
   * esclusive), Disponi ›, Duplica; in fondo, in rosso, Togli dalla lavagna e,
   * con le schede di file, Sposta anche il file nel cestino. Con più schede
   * niente Apri né Collega…; in sola lettura le voci che cambiano sono spente
   * col perché, non nascoste. Con `inside` (il tasto destro dentro la scheda
   * attiva) in testa c'è «Apri a lato» sul punto in cui si è (T45): ciò che
   * la scheda non fa, nell'editor intero.
   */
  _cardMenu(nodes: readonly CanvasNode[], entry: MenuEntryMaker, colors: ColorMenuMaker, inside = false): SurfaceMenuEntry[] {
    const one = nodes.length === 1 ? nodes[0]! : null;
    const readOnly = this._readOnly ? t("canvas.commands.why.read_only") : null;
    const state = (why: string | null): Pick<SurfaceMenuItem, "enabled" | "description"> =>
      why === null ? { enabled: true } : { enabled: false, description: why };
    const context: SurfaceMenuEntry[] = [];
    if (inside && one?.type === "file" && this._besideHere() !== null) {
      context.push(entry("canvas.open_beside_here", undefined, false, { icon: "draw-open-link" }), MENU_RULE);
    }
    // «Parti…» per prima, come nel prototipo (T28): riapre il selettore.
    if (one && this._options.parts && this._partsNote(one)) context.push(entry("canvas.parts", undefined, false));
    // «Mostra tutto il file» sotto «Parti…» (T75, prototipo T28); in sola lettura no.
    if (one && !this._readOnly && noteExcerptOf(one)) context.push(entry("canvas.whole_file", undefined, false));
    if (one?.type === "text") {
      context.push(entry("canvas.edit", undefined, false));
      // Convertire (T70): il testo in una nota nuova; il dialogo prende il fuoco.
      if (this._options.notes) context.push(entry("canvas.extract_note", undefined, false));
    }
    if (one?.type === "file" && one.file) {
      context.push(entry(cardKindOf(one) === "image" ? "canvas.open_viewer" : "canvas.open", undefined, false));
      // «Ritaglia e ruota» (T78), come nel prototipo T28 dopo Apri; in sola
      // lettura la voce non c'è.
      if (!this._readOnly && this._cropImage(one) && this._cropRenderer()) {
        context.push(entry("canvas.crop", undefined, false, { icon: "draw-image" }));
      }
      if (this._options.onOpenPathBeside) context.push(entry("canvas.open_beside", undefined, false));
      // «Spargi le pagine…» (T72): solo su un PDF; spenta, col perché, se non si apre.
      if (cardKindOf(one) === "pdf") context.push(entry("canvas.spread_pages", undefined, false));
      // Convertire (T70): il testo della nota accanto; un altro file al posto di questo.
      if (this._options.notes && cardKindOf(one) === "note") context.push(entry("canvas.copy_note_text"));
      if (this._options.onPickFile) context.push(entry("canvas.replace_file", undefined, false));
    }
    if (one?.type === "link") {
      context.push(entry("canvas.open_url", undefined, false));
      if (this._options.cards) context.push(entry("canvas.web_preview", undefined, false));
    }
    // Collega… si fa anche con C, il tasto dello strumento.
    if (one) context.push(entry("canvas.connect", undefined, true, { chord: menuChord([CANVAS_TOOL_KEYS.connect]) }));
    if (context.length) context.push(MENU_RULE);
    const two = nodes.length >= 2 ? null : t("canvas.commands.why.two");
    const three = nodes.length >= 3 ? null : t("canvas.commands.why.three");
    context.push(
      { ...colors(this._chosenColor()), ...state(readOnly) },
      {
        id: "canvas.arrange",
        label: t("canvas_menu.arrange"),
        ...state(readOnly),
        items: [
          entry("canvas.bring_front"),
          entry("canvas.send_back"),
          MENU_RULE,
          {
            id: "canvas.align",
            label: t("canvas_menu.align_to"),
            ...state(readOnly ?? two),
            items: CANVAS_ALIGN.map((axis) => entry(`canvas.align.${axis}`)),
          },
          {
            id: "canvas.distribute",
            label: t("canvas_menu.distribute"),
            ...state(readOnly ?? three),
            items: [entry("canvas.distribute_x"), entry("canvas.distribute_y")],
          },
          // «Disponi» col nucleo (LIC T25): griglia, riga, colonna, albero.
          MENU_RULE,
          ...CANVAS_LAYOUTS.map((kind) => entry(`canvas.layout.${kind}`)),
        ],
      },
      entry("canvas.duplicate"),
      // La lavagna come codice (LIC T25): «Incolla codice» apre la conferma, che prende il fuoco.
      entry("canvas.copy_code"),
      entry("canvas.paste_code", undefined, false),
      MENU_RULE,
      entry("canvas.delete"),
    );
    if (this._options.onTrashPath && nodes.some((node) => node.type === "file")) context.push(entry("canvas.trash_file", undefined, false));
    return context;
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

  /**
   * Ciò che la lavagna vuota riceve, dagli appunti o dal selettore dei file: lo
   * stesso evento di Ctrl+V sulla vista, così passa dalla stessa strada
   * (`_intake`) e dal deposito, come un rilascio.
   */
  _receive(data: DataTransfer): void {
    this._viewport.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
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
   * Apre il menu radiale in `x`, `y` della finestra (`openRadial`, che a un
   * bordo lo sposta dove si vede intero): Annulla e Ripeti, gli ultimi tre
   * strumenti e gli ultimi tre colori della penna. `held` è il puntatore
   * ancora giù che l'ha aperto, che il menu segue; `keyboard` lo apre dalla
   * tastiera, col fuoco sulla prima voce.
   */
  _openRadial(x: number, y: number, held: RadialPointer | null, keyboard = false): void {
    if (this._destroyed || !this._doc) return;
    // Le voci sono comandi del catalogo, letti adesso: dopo una voce la banda
    // di stato si rilegge, come dopo una voce del menu.
    const catalog = new Map(this.commands().map((command) => [command.id, command]));
    let radial: Radial | null = null;
    radial = openCanvasRadial(x, y, {
      command: (id) => {
        const command = catalog.get(id);
        return command === undefined ? null : {
          ...command,
          run: (args) => {
            command.run(args);
            this._statusSettle();
          },
        };
      },
      tool: this._tool,
      recentTools: this._recentTools,
      color: this._penColor,
      recentColors: this._recentColors,
      readOnly: this._readOnly || this._isSceneOversized(),
      pickTool: (tool) => {
        this._recordPending();
        this._pickTool(tool);
      },
      pickColor: (color) => {
        const tool = inkStrokeTool(this._penChoice);
        this._choosePen({ ...this._penChoice, color: { ...this._penChoice.color, [tool]: color } }, true);
      },
    }, {
      held,
      keyboard,
      onClose: () => {
        if (this._radial === radial) this._radial = null;
      },
    });
    this._radial = radial;
  }

  /** «Menu radiale» del menu del tasto destro: dove si è cliccato, o al centro della vista dalla tastiera. */
  _openRadialFromMenu(at: { x: number; y: number } | null): void {
    if (at) {
      this._openRadial(at.x, at.y, null);
      return;
    }
    const rect = this._viewport.getBoundingClientRect();
    this._openRadial(rect.left + rect.width / 2, rect.top + rect.height / 2, null, true);
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

  // --- i fili (T67) --------------------------------------------------------------

  /**
   * Comincia a tirare un filo (`gesture`): dai punti, da →, con Alt dal
   * corpo, con lo strumento Collega o riattaccando un'estremità. Mai in sola
   * lettura e mai con la penna, che scrive (D3 è v2). Il fuoco va sulla vista,
   * così Esc arriva e annulla.
   */
  _beginConnect(
    event: PointerEvent,
    gesture: Omit<ConnectGesture, "pointerId" | "startX" | "startY" | "moved">,
  ): boolean {
    if (this._readOnly || !this._doc || event.pointerType === "pen" || this._isSceneOversized()) return false;
    if (!this._doc.nodes.some((node) => node.id === gesture.from)) return false;
    this._endConnect();
    this._connect = { ...gesture, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    this._viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    if (!this._viewport.contains(document.activeElement)) this._viewport.focus({ preventScroll: true });
    const draft = document.createElementNS("http://www.w3.org/2000/svg", "path");
    draft.classList.add("canvas-edge-draft");
    this._connectDraft = draft;
    this._edgeLayer.append(draft);
    this._viewport.toggleAttribute("data-connecting", true);
    this._setEdgeHover(null);
    return true;
  }

  /** Il filo in corso segue il puntatore; sopra una scheda arriva al lato che sceglierà. */
  _moveConnect(clientX: number, clientY: number): void {
    const connect = this._connect;
    if (!connect || !this._doc) return;
    if (!connect.moved && Math.abs(clientX - connect.startX) + Math.abs(clientY - connect.startY) > 3) {
      connect.moved = true;
    }
    const target = this._connectTargetAt(connect, clientX, clientY);
    this._markConnectTarget(target);
    const ends = this._connectEnds(connect, target, this._screenToWorld(clientX, clientY));
    if (ends && this._connectDraft) this._connectDraft.setAttribute("d", edgePathData(ends.start, ends.end));
  }

  /**
   * La scheda dove il filo arriverebbe sotto `clientX`, `clientY`: la più in
   * alto, perché `elementFromPoint` dà quella sopra. Un filo nuovo non torna
   * sulla scheda da cui parte.
   */
  _connectTargetAt(connect: ConnectGesture, clientX: number, clientY: number): CanvasNode | null {
    const id = this._nodeAt(this._elementAt(clientX, clientY));
    if (id === null || (!connect.edgeId && id === connect.from)) return null;
    return this._doc?.nodes.find((node) => node.id === id) ?? null;
  }

  /** I due capi del filo in corso: il capo fermo e quello che segue il puntatore. */
  _connectEnds(
    connect: ConnectGesture,
    target: CanvasNode | null,
    pointer: EdgePoint,
  ): { start: EdgePoint; end: EdgePoint } | null {
    const doc = this._doc;
    if (!doc) return null;
    const byId = new Map(doc.nodes.map((node) => [node.id, node]));
    let anchor: CanvasNode | undefined;
    let anchorSide: EdgeSide | undefined;
    if (connect.edgeId) {
      const edge = doc.edges.find((one) => one.id === connect.edgeId);
      if (!edge) return null;
      anchor = byId.get(connect.endpoint === "from" ? edge.toNode : edge.fromNode);
      anchorSide = connect.endpoint === "from" ? edge.toSide ?? "left" : edge.fromSide ?? "right";
    } else {
      anchor = byId.get(connect.from);
      anchorSide = connect.fromSide;
    }
    if (!anchor) return null;
    if (target) {
      const sides = nearestSides(anchor, target, anchorSide, target.id === anchor.id);
      return { start: sidePoint(anchor, sides.fromSide), end: sidePoint(target, sides.toSide) };
    }
    const side = anchorSide ?? nearestSides(anchor, { x: pointer.x, y: pointer.y, width: 0, height: 0 }).fromSide;
    return { start: sidePoint(anchor, side), end: pointer };
  }

  /** La scheda su cui il filo arriverebbe porta `data-connect-target`. */
  _markConnectTarget(target: CanvasNode | null): void {
    const id = target?.id ?? null;
    if (id === this._connectTarget) return;
    if (this._connectTarget !== null) this._cards.get(this._connectTarget)?.article.removeAttribute("data-connect-target");
    this._connectTarget = id;
    if (id !== null) this._cards.get(id)?.article.toggleAttribute("data-connect-target", true);
  }

  /** Il filo in corso finisce: niente tratto, niente bersaglio, niente gesto. */
  _endConnect(): void {
    this._connect = null;
    this._connectDraft?.remove();
    this._connectDraft = null;
    this._markConnectTarget(null);
    this._viewport.removeAttribute("data-connecting");
  }

  /** Esc mentre si tira un filo: non resta niente, come se non fosse cominciato. */
  _cancelConnect(): void {
    const connect = this._connect;
    if (!connect) return;
    this._endConnect();
    try {
      this._viewport.releasePointerCapture?.(connect.pointerId);
    } catch {
      // Il puntatore era già libero.
    }
    if (connect.back) this._pickTool("select");
  }

  /**
   * Il rilascio del filo `connect` in `clientX`, `clientY`. Su una scheda: il
   * filo, coi lati scelti da `edges.ts`; un'estremità riattaccata cambia
   * scheda. Nel vuoto: un filo nuovo fa nascere lì una scheda di testo
   * collegata, in un commit solo (`true`: la scheda è in scrittura);
   * un'estremità torna dov'era. Sulla scheda di partenza non succede niente.
   */
  _finishConnect(connect: ConnectGesture, clientX: number, clientY: number): boolean {
    const doc = this._doc;
    if (!doc || this._readOnly) return false;
    const hit = this._elementAt(clientX, clientY);
    const target = this._connectTargetAt(connect, clientX, clientY);
    if (connect.edgeId) {
      const existing = doc.edges.find((edge) => edge.id === connect.edgeId);
      if (!existing || !target) return false;
      const movesFrom = connect.endpoint === "from";
      const other = doc.nodes.find((node) => node.id === (movesFrom ? existing.toNode : existing.fromNode));
      if (!other) return false;
      const otherSide = movesFrom ? existing.toSide ?? "left" : existing.fromSide ?? "right";
      const side = nearestSides(other, target, otherSide, other.id === target.id).toSide;
      // L'estremità riattaccata è una `set` dell'arco (T24): la scheda e il lato.
      const fields = movesFrom ? { fromNode: target.id, fromSide: side } : { toNode: target.id, toSide: side };
      this._writeOps([{ op: "set", id: existing.id, fields }]);
      return false;
    }
    const source = doc.nodes.find((node) => node.id === connect.from);
    if (!source) return false;
    if (target) {
      // Il filo lasciato sul corpo di una scheda va ai lati più vicini
      // (`sides: "auto"`); partito da un lato (un punto della scheda, T67),
      // tiene quello, e l'arrivo è il lato più vicino a lui (T24).
      const sides = connect.fromSide === undefined
        ? "auto"
        : { from: connect.fromSide, to: nearestSides(source, target, connect.fromSide).toSide };
      this._writeOps(this._connectOps(source.id, target.id, sides));
      return false;
    }
    // Nel vuoto, solo dopo un vero tiro e dentro la vista (non sulla
    // scheda di partenza, né fuori dalla lavagna).
    if (!connect.moved || !hit || !this._viewport.contains(hit) || this._nodeAt(hit) !== null) return false;
    this._placeText(clientX, clientY, { from: source.id, fromSide: connect.fromSide });
    return true;
  }

  /** C con due schede scelte (D-19 (a)): un filo dalla prima alla seconda, coi lati di `edges.ts`. */
  _connectPair(from: CanvasNode, to: CanvasNode): void {
    if (!this._doc || this._readOnly) return;
    this._writeOps(this._connectOps(from.id, to.id));
  }

  /**
   * La `connect` delle due schede scelte («Collega…», e C senza fili scelti);
   * `null` se non sono due.
   */
  _connectPairOps(): CanvasIntentOp[] | null {
    const chosen = this._selectedNodes();
    return chosen.length === 2 ? this._connectOps(chosen[0]!.id, chosen[1]!.id) : null;
  }

  /**
   * La `connect` da `from` a `to`, coi lati più vicini (`sides: "auto"`, la
   * regola di `nearestSides` di `edges.ts`) o coi lati dati, e le punte scelte
   * nella riga di Collega (T50): `arrow` di serie, `none`, o la sola punta
   * all'inizio, che la forma breve non ha (allora l'arco intero, coi lati di
   * `nearestSides`). `born` è l'id di una scheda che nasce nella stessa lista
   * (Collega nel vuoto, Ctrl+Maiusc+Invio): allora può non esserci ancora.
   * `null` se una delle due non c'è.
   */
  _connectOps(
    from: string,
    to: string,
    sides: "auto" | { readonly from: EdgeSide; readonly to: EdgeSide } = "auto",
    born?: string,
  ): CanvasIntentOp[] | null {
    const a = this._doc?.nodes.find((node) => node.id === from);
    const b = this._doc?.nodes.find((node) => node.id === to);
    if (!a && from !== born) return null;
    if (!b && to !== born) return null;
    if (this._tips === "start") {
      const pair = sides === "auto" && a && b ? nearestSides(a, b) : null;
      const fromSide = pair ? pair.fromSide : sides === "auto" ? undefined : sides.from;
      const toSide = pair ? pair.toSide : sides === "auto" ? undefined : sides.to;
      return [{ op: "connect", edge: { fromNode: from, toNode: to, fromSide, toSide, ...this._tipEnds() } }];
    }
    const short = { op: "connect", from, to, sides: sides === "auto" ? sides : { ...sides } };
    return [this._tips === "none" ? { ...short, ends: "none" } : short];
  }

  /** I fili con i loro capi sulla lavagna, per cercare quello sotto il puntatore. */
  _placedEdges(): PlacedEdge[] {
    const doc = this._doc;
    if (!doc) return [];
    const byId = new Map(doc.nodes.map((node) => [node.id, node]));
    const placed: PlacedEdge[] = [];
    for (const edge of doc.edges) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (from && to) placed.push({ id: edge.id, a: sidePoint(from, edge.fromSide ?? "right"), b: sidePoint(to, edge.toSide ?? "left") });
    }
    return placed;
  }

  /**
   * Il filo entro 8 px dello schermo da `clientX`, `clientY`, fra quelli in
   * vista. Sopra la scheda `over` il filo vince solo dove si vede, fuori da
   * lei: altrove la scheda (D8).
   */
  _edgeUnder(clientX: number, clientY: number, over: string | null): string | null {
    const doc = this._doc;
    if (!doc || doc.edges.length === 0 || this._isSceneOversized()) return null;
    const rect = this._viewport.getBoundingClientRect();
    const corner = this._screenToWorld(rect.left, rect.top);
    const zoom = this._camera.zoom;
    const view = { x: corner.x, y: corner.y, width: (rect.width || 800) / zoom, height: (rect.height || 600) / zoom };
    const hit = edgeAt(this._screenToWorld(clientX, clientY), this._placedEdges(), zoom, view);
    if (!hit) return null;
    const card = over === null ? undefined : doc.nodes.find((node) => node.id === over);
    return card && insideBox(hit.point, card) ? null : hit.id;
  }

  /**
   * Il filo che un clic o il passaggio su `target` prende: mai dentro la
   * scheda attiva né sopra un controllo (un punto, una maniglia, un pulsante,
   * un link, un campo), che restano loro.
   */
  _wireAt(target: EventTarget | null, clientX: number, clientY: number): string | null {
    if (this._insideActive(target, false)) return null;
    if (target instanceof Element && target.closest(".canvas-port, [data-resize], button, a, input, textarea, select")) return null;
    return this._edgeUnder(clientX, clientY, this._nodeAt(target));
  }

  /** Il passaggio del mouse: il filo sotto si scurisce (`data-hover`). */
  _hoverEdge(clientX: number, clientY: number, target: EventTarget | null): void {
    this._setEdgeHover(this._wireAt(target, clientX, clientY));
  }

  _setEdgeHover(id: string | null): void {
    if (id === this._edgeHover) return;
    if (this._edgeHover !== null) this._edgeGroup(this._edgeHover)?.removeAttribute("data-hover");
    this._edgeHover = id;
    if (id !== null) this._edgeGroup(id)?.toggleAttribute("data-hover", true);
    this._viewport.toggleAttribute("data-edge-hover", id !== null);
  }

  /** Il gruppo SVG del filo `id` sulla scena. */
  _edgeGroup(id: string): SVGGElement | null {
    for (const hit of this._edgeLayer.querySelectorAll<SVGPathElement>(".canvas-edge-hit")) {
      if (hit.dataset.edge === id) return hit.parentElement as SVGGElement | null;
    }
    return null;
  }

  /** I quattro punti sui lati della scheda `el` (T67): ci sono solo se si può scrivere. */
  _syncPorts(el: HTMLElement): void {
    const ports = el.querySelectorAll<HTMLElement>(":scope > .canvas-port");
    if (this._readOnly) {
      for (const port of ports) port.remove();
      return;
    }
    if (ports.length === EDGE_SIDES.length) return;
    for (const port of ports) port.remove();
    for (const side of EDGE_SIDES) {
      const port = document.createElement("div");
      port.className = "canvas-port";
      port.dataset.side = side;
      port.setAttribute("aria-hidden", "true");
      el.append(port);
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

  _wheel(event: WheelEvent): void {
    const target = this._targetOf(event);
    // Sopra la scheda attiva la rotella scorre lei (A-11); Ctrl+rotella e il
    // pizzico ingrandiscono sempre la lavagna.
    if (!event.ctrlKey && !event.metaKey && this._insideActive(target, true)) {
      this._wheelUnderVeil(event, target);
      return;
    }
    // Sopra il testo che si scrive in una scheda la rotella scorre il testo
    // (una scheda di testo lunga, T43).
    if (!event.ctrlKey && !event.metaKey && target instanceof Node && this._editor?.place.contains(target)) {
      this._wheelUnderVeil(event, target);
      return;
    }
    event.preventDefault();
    // La rotella prende la vista: un volo o un'inerzia si fermano (T53).
    this._stopMotion(false);
    // Prima di muovere la camera: lo zoom della rotella è un gesto in corso.
    clearTimeout(this._wheelTimer);
    this._wheelTimer = setTimeout(() => {
      this._wheelTimer = undefined;
      this._refreshLive();
      // La rotella finita è un gesto finito: la banda legge lo zoom nuovo.
      this._statusSettle();
    }, WHEEL_SETTLE_MS);
    // Il delta in pixel: la pagina della rotella è la vista, misurata solo se serve.
    const page = event.deltaMode === 2 ? this._viewport.getBoundingClientRect() : null;
    const dx = wheelPixels(event.deltaX, event.deltaMode, page?.width ?? 0);
    const dy = wheelPixels(event.deltaY, event.deltaMode, page?.height ?? 0);
    // Ctrl+rotella e il pizzico ingrandiscono con qualunque impostazione; uno
    // scatto senza parte verticale non ingrandisce.
    if (event.ctrlKey || event.metaKey) {
      if (dy !== 0) this._zoomAt(event.clientX, event.clientY, dy < 0 ? 1.1 : 1 / 1.1);
      return;
    }
    // Maiusc sposta di lato. Dove il sistema non manda `deltaX`, si usa `deltaY`.
    if (event.shiftKey) {
      this._camera.x -= dx !== 0 ? dx : dy;
      this._applyCamera();
      return;
    }
    // `zoom`: la rotella ingrandisce. Un evento con una parte orizzontale (le due
    // dita sul touchpad) sposta, come in `pan`, così il touchpad resta usabile.
    if (this._wheelSetting === "zoom" && dx === 0) {
      if (dy !== 0) this._zoomAt(event.clientX, event.clientY, dy < 0 ? 1.1 : 1 / 1.1);
      return;
    }
    this._camera.x -= dx;
    this._camera.y -= dy;
    this._applyCamera();
  }

  /**
   * La rotella sopra la scheda attiva, presa dal velo della croce (T20d): il
   * browser scorrerebbe gli antenati del velo, cioè niente. La scorre la
   * lavagna: il primo antenato di `under` che può scorrere in quella
   * direzione, dentro la vista. Senza velo scorre il browser, come sempre.
   */
  _wheelUnderVeil(event: WheelEvent, under: EventTarget | null): void {
    if (event.target !== this._penVeil || !(under instanceof Element)) return;
    for (let element: Element | null = under; element && element !== this._viewport; element = element.parentElement) {
      const dx = wheelPixels(event.deltaX, event.deltaMode, element.clientWidth);
      const dy = wheelPixels(event.deltaY, event.deltaMode, element.clientHeight);
      const style = getComputedStyle(element);
      const free = (overflow: string): boolean => overflow === "auto" || overflow === "scroll";
      const vertical = dy !== 0 && free(style.overflowY) && element.scrollHeight > element.clientHeight;
      const horizontal = dx !== 0 && free(style.overflowX) && element.scrollWidth > element.clientWidth;
      if (!vertical && !horizontal) continue;
      event.preventDefault();
      element.scrollBy({ left: horizontal ? dx : 0, top: vertical ? dy : 0 });
      return;
    }
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

  _keydown(event: KeyboardEvent): void {
    if (!this._doc || event.defaultPrevented || composingKey(event) || this._shellKeys.has(event)) return;
    // Col ritaglio aperto Invio lo scrive ed Esc lo chiude, da ogni punto della lavagna (T78).
    if (this._crop?.editor?.key(event)) {
      event.preventDefault();
      return;
    }
    // Spazio tenuto sulla lavagna sposta la vista, anche in una lavagna troppo
    // grande (T53); in un campo o dentro la scheda attiva resta uno spazio.
    if (!(this._activeId !== null && this._insideActive(event.target, false)) && this._holdSpace(event)) return;
    if (this._isSceneOversized()) return;
    // Esc mentre si tira un filo lo lascia, e nient'altro (T67).
    if (event.key === "Escape" && this._connect) {
      event.preventDefault();
      this._cancelConnect();
      return;
    }
    // Esc mentre si trascina o si ridimensiona una scheda ferma il gesto: le
    // schede tornano dov'erano e il file non cambia (T24).
    if (event.key === "Escape" && (this._drag !== null || this._resize !== null)) {
      event.preventDefault();
      this._cancelGestures();
      return;
    }
    // Esc mentre si trascina il rettangolo lo annulla, e la scelta torna com'era (N6 T20b).
    if (event.key === "Escape" && this._marquee !== null) {
      event.preventDefault();
      this._cancelMarquee();
      return;
    }
    // D da solo, fuori dai campi: il mouse scrive finché il tasto è giù
    // (regola 1). La ripetizione del tasto non cambia niente.
    if (isInkKey(event) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      && !isTextTarget(event.target)) {
      if (!event.repeat && !this._inkKeyDown) {
        this._inkKeyDown = true;
        this._applyInkMouse();
      }
      return;
    }
    // Dentro la scheda attiva i tasti sono del contenuto; Esc, se il
    // contenuto non lo usa (un rettangolo di celle che si sta scegliendo),
    // esce e rimette il fuoco sulla scheda.
    if (this._activeId !== null && this._insideActive(event.target, false)) {
      if (event.key === "Escape") {
        event.preventDefault();
        this._leaveCard(true);
      } else if (isCommandSearchKey(event)) {
        // Ctrl+/ si apre anche da dentro la scheda, ed Esc ci torna.
        event.preventDefault();
        this._openCommandSearch();
      }
      return;
    }
    // Il tasto Menu o Maiusc+F10 su una scheda o sulla lavagna: il menu del
    // tasto destro, sulla scelta e accanto a lei (IMP-6301). In un campo resta
    // quello del campo.
    if (isMenuKey(event) && !isTextTarget(event.target)) {
      event.preventDefault();
      this._keyboardMenu(event.target);
      return;
    }
    this._recordPending();
    // Tab e Alt+frecce muovono il fuoco fra le schede (T61): non sono comandi,
    // non cambiano il file.
    if (this._tabKey(event) || this._nearestKey(event)) return;
    const commands = this.commands();
    const where = { writing: isTextTarget(event.target), onBoard: this._onCardOrBoard(event.target) };
    // Prima i tasti con Ctrl o Alt: valgono anche col fuoco in un campo.
    const held = commandForKey(commands, event, { ...where, writing: true });
    if (held) {
      this._runKey(event, held);
      return;
    }
    const focus = this._selectionFocus();
    // La scheda scelta e non attiva riceve le pagine (il PDF), se li vuole.
    if (focus && this._selection.length === 1 && CARD_KEYS.has(event.key) && this._onCardOrBoard(event.target)) {
      const view = this._cards.get(focus.id)?.view;
      let used = false;
      try {
        used = view?.key?.(event) === true;
      } catch (error) {
        console.warn(`canvas: la scheda ${focus.id} non prende il tasto`, error);
      }
      if (used) {
        event.preventDefault();
        return;
      }
    }
    // Poi i tasti che scrivono (Canc, le frecce, Invio, i segni): mai mentre
    // si scrive in un campo.
    const bare = commandForKey(commands, event, where);
    if (bare) this._runKey(event, bare);
  }

  /** Il tasto è del comando `command`: lo prende, e il comando parte se si può. */
  _runKey(event: KeyboardEvent, command: CanvasCommand): void {
    // Esc senza niente da togliere resta a chi sta fuori (la shell).
    if (command.id === "canvas.escape" && command.disabled() !== null) return;
    event.preventDefault();
    if (command.disabled() === null) command.run();
    this._statusSettle();
  }

  /**
   * Un tasto dello zoom fuori dalla vista (la riga delle opzioni, la colonna, il
   * navigatore) zooma, come i tasti degli strumenti sulla colonna (IMP-040).
   * Dentro la vista lo prende `_keydown`, che sa della scheda attiva e dei campi.
   */
  _zoomKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || !this._doc || this._isSceneOversized()) return;
    if (event.target instanceof Node && this._viewport.contains(event.target)) return;
    const zoom = this.commands().filter((command) => VIEW_ZOOM_COMMANDS.has(command.id));
    // In una casella a discesa (i campi del filo nella barra della selezione) un
    // numero o un segno cerca l'opzione, come in un campo: solo Ctrl zooma.
    const writing = isTextTarget(event.target) || event.target instanceof HTMLSelectElement;
    const command = commandForKey(zoom, event, { writing, onBoard: false });
    if (command) this._runKey(event, command);
  }

  /**
   * Annulla e Ripeti fuori dalla vista (la colonna, la riga delle opzioni, la
   * barra della scelta, il navigatore), come i tasti dello zoom (IMP-6300). Un
   * campo che scrive tiene il suo Ctrl+Z; dentro la vista lo prende `_keydown`.
   */
  _historyKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || composingKey(event) || !this._doc || this._isSceneOversized()) return;
    if (event.target instanceof Node && this._viewport.contains(event.target)) return;
    if (keepsItsUndo(event.target)) return;
    const history = this.commands().filter((command) => HISTORY_COMMANDS.has(command.id));
    const command = commandForKey(history, event, { writing: false, onBoard: false });
    if (command) this._runKey(event, command);
  }

  /**
   * Il menu del tasto destro aperto dalla tastiera (IMP-6301): lo stesso
   * `contextmenu` che il riquadro apre col tasto destro, ma senza un punto
   * (`clientX`/`clientY` a zero, nessun tasto del mouse), così il menu va sulla
   * scelta e si apre accanto a lei. Un `contextmenu` che il sistema mandasse
   * subito dopo per lo stesso tasto non ne apre un secondo.
   */
  _keyboardMenu(target: EventTarget | null): void {
    const from = target instanceof Element && this._viewport.contains(target) ? target : this._viewport;
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, button: 0 });
    this._ownMenu = menu;
    try {
      from.dispatchEvent(menu);
    } finally {
      this._ownMenu = null;
    }
    this._menuEchoUntil = performance.now() + MENU_ECHO_MS;
  }

  /**
   * Un tasto col fuoco sulla colonna: gli strumenti e la ricerca dei comandi
   * valgono anche qui; frecce, Invio e Spazio restano della colonna (il kit).
   */
  _railKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || !this._doc || this._isSceneOversized()) return;
    if (isCommandSearchKey(event)) {
      event.preventDefault();
      this._openCommandSearch();
      return;
    }
    const tools = this.commands().filter((command) => toolOfCommand(command.id) !== null);
    const command = commandForKey(tools, event, { writing: false, onBoard: false });
    if (command) this._runKey(event, command);
  }

  /**
   * Stretta (la finestra fino a 700 px, o il riquadro fino a 480): la colonna
   * va sotto la lavagna, in riga, come nel disegno.
   */
  _syncNarrow(): void {
    const width = this._root.clientWidth;
    if (width === 0) return;
    const narrow = width <= NARROW_PANE || window.innerWidth <= NARROW_WIDTH;
    if (narrow === this._root.hasAttribute("data-narrow")) return;
    this._root.toggleAttribute("data-narrow", narrow);
    this._rail.setNarrow(narrow);
    // «Apri a lato» diventa «Apri qui» e al contrario (T45).
    this._canvasOptions.sync();
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

  _drawEdges(): void {
    if (!this._doc) return;
    const byId = new Map(this._doc.nodes.map((n) => [n.id, n]));
    this._edgeLayer.replaceChildren();
    this._handleLayer.replaceChildren();
    const worldW = this._worldSize();
    // Le prese stanno nelle stesse coordinate dei fili (T91).
    for (const layer of [this._edgeLayer, this._handleLayer]) {
      layer.setAttribute("viewBox", `0 0 ${worldW.w} ${worldW.h}`);
      layer.style.width = `${worldW.w}px`;
      layer.style.height = `${worldW.h}px`;
    }
    for (const edge of this._doc.edges) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (!from || !to) continue;
      const a = sidePoint(from, edge.fromSide ?? "right");
      const b = sidePoint(to, edge.toSide ?? "left");
      const selected = this._edgeSelection.includes(edge.id);
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("canvas-edge");
      // Il filo sotto il puntatore si scurisce (T67).
      if (this._edgeHover === edge.id) group.toggleAttribute("data-hover", true);
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.classList.add("canvas-edge-hit");
      hit.dataset.edge = edge.id;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.classList.add("canvas-edge-line");
      line.dataset.edge = edge.id;
      if (selected) line.classList.add("selected");
      const d = edgePathData(a, b);
      hit.setAttribute("d", d);
      line.setAttribute("d", d);
      // Il colore del filo, per la pelle: il tratto e le punte (T47).
      paintColor(group, edge.color);
      group.append(hit, line);
      for (const [endpoint, point] of [["from", a], ["to", b]] as const) {
        if (edgeEnd(edge, endpoint) !== "arrow") continue;
        const angle = Math.atan2(b.y - a.y, b.x - a.x) + (endpoint === "from" ? Math.PI : 0);
        const dx = Math.cos(angle) * 10;
        const dy = Math.sin(angle) * 10;
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "path");
        marker.setAttribute("d", `M ${point.x} ${point.y} L ${point.x - dx - dy / 2} ${point.y - dy + dx / 2} L ${point.x - dx + dy / 2} ${point.y - dy - dx / 2} Z`);
        marker.classList.add("canvas-edge-arrow");
        group.append(marker);
      }
      if (edge.label) {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", String((a.x + b.x) / 2));
        label.setAttribute("y", String((a.y + b.y) / 2 - 6));
        label.classList.add("canvas-edge-label");
        label.textContent = edge.label;
        group.append(label);
      }
      if (selected && !this._readOnly) {
        for (const [endpoint, point] of [["from", a], ["to", b]] as const) {
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.classList.add("canvas-edge-reconnect");
          handle.dataset.reconnect = edge.id;
          handle.dataset.endpoint = endpoint;
          handle.setAttribute("cx", String(point.x));
          handle.setAttribute("cy", String(point.y));
          handle.setAttribute("r", "8");
          // Sopra lo stage, non nel filo: un punto della scheda non la copre (T91, rotta 5).
          this._handleLayer.append(handle);
        }
      }
      this._edgeLayer.append(group);
    }
    // Il filo che si sta tirando resta sopra gli altri.
    if (this._connectDraft) this._edgeLayer.append(this._connectDraft);
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

  /**
   * Apre il campo della scheda `target`. `born` è il passo che l'ha appena
   * messa per scriverci (lo strumento Testo, Ctrl+Invio): lasciata vuota, se
   * ne va con lui (T44).
   */
  _beginCardEdit(target: CanvasNode, born: CanvasStep | null = null, point: { x: number; y: number } | null = null): void {
    if (this._readOnly || !this._doc) return;
    const node = this._doc.nodes.find((candidate) => candidate.id === target.id);
    if (!node) return;
    if (this._editor) {
      if (this._editor.id === node.id) return;
      // Il testo dell'altra scheda si registra prima; se non si può, resta lì.
      if (!this._closeField(false)) return;
      this._render();
    }
    const entry = this._cards.get(node.id);
    if (!entry || entry.article.parentElement !== this._stage) return;
    const { article, body } = entry;
    // Il campo prende il posto del corpo: la vista o il Markdown si smontano,
    // e il corpo si rifà alla prima resa dopo che il campo si chiude. Anche il
    // «file mancante» e il suo ascolto se ne vanno: alla chiusura il file si chiede di nuovo.
    this._releaseBody(entry);
    entry.missingFor = null;
    const field: CardField = node.type === "text" ? "text" : node.type === "group" ? "label" : node.type === "link" ? "url" : "file";
    const input = node.type === "text" ? document.createElement("textarea") : document.createElement("input");
    input.className = node.type === "text" ? "canvas-text-editor" : "canvas-field-editor";
    input.value = node[field] ?? "";
    input.setAttribute("aria-label", t("canvas.edit_text", { card: cardTitle(node) }));
    const lifetime = new AbortController();
    const editor: CardEditor = {
      id: node.id, field, input, place: input, live: null, article, lifetime, composing: false, recordOnInput: false,
      born, grown: null, point,
    };
    this._editor = editor;
    // Mentre si scrive nella scheda la barra della selezione non c'è (T51).
    this._syncSelectionBar();
    // Il campo semplice ha i suoi ascolti: smettono quando l'editor delle note
    // lo sostituisce (T43), o quando il campo si chiude.
    const simple = new AbortController();
    lifetime.signal.addEventListener("abort", () => simple.abort(), { once: true });
    const signal = simple.signal;
    // Il testo resta qui finché non c'è una pausa: niente commit per tasto.
    input.addEventListener("input", () => this._fieldText(editor, node, input.value), { signal });
    // Durante la composizione (IME) la pausa non corre: conta dalla fine.
    input.addEventListener("compositionstart", () => this._fieldComposing(editor), { signal });
    input.addEventListener("compositionend", () => this._fieldComposed(editor, node, input.value), { signal });
    input.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      // Col campo aperto i tasti, Ctrl+Z compreso, sono del campo; un tasto
      // della shell che il campo non usa (Ctrl+W) sale, la tela no.
      if (passesToShell(event)) this._shellKeys.add(event);
      else event.stopPropagation();
      editor.recordOnInput = false;
      if (composingKey(event) || editor.composing) return;
      if (isCommandSearchKey(event)) {
        // Ctrl+/ si apre anche mentre si scrive; Esc torna nel campo.
        event.preventDefault();
        this._openCommandSearch();
      } else if (isBareKey(event)) {
        // Il campo non usa Ctrl+.: nasconde l'interfaccia, e si resta a scrivere (T65).
        event.preventDefault();
        this._workspace.setBare(!this._workspace.bare);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this._leaveField(true, true);
      } else if (event.key === "Enter") {
        if (field === "text" && !event.ctrlKey && !event.metaKey) {
          // L'a capo entra nel campo, e con lui il testo si registra.
          editor.recordOnInput = true;
          return;
        }
        event.preventDefault();
        // Ctrl+Invio in una scheda di testo apre la scheda dopo (T44); negli altri campi chiude (A15).
        if (field === "text") this._writeNext(event.shiftKey);
        else this._leaveField(true);
      }
    }, { signal });
    // Il fuoco che va nella ricerca dei comandi non chiude il campo: ci torna.
    input.addEventListener("blur", () => {
      if (!this._searching) this._leaveField(false);
    }, { signal });
    body.replaceChildren(input);
    input.focus();
    if (node.type === "text") input.setSelectionRange(input.value.length, input.value.length);
    else input.select();
    // La scheda di testo si scrive come una nota (T43): l'editor delle note
    // prende il posto del campo appena si monta; se non si monta, il campo resta.
    if (node.type === "text") this._openLiveText(editor, node, body, simple, false);
  }

  /**
   * Il testo del campo è cambiato: va nel testo in attesa (la bozza lo vede
   * subito), e il commit arriva dopo la pausa, o subito dopo un a capo.
   */
  _fieldText(editor: CardEditor, node: CanvasNode, text: string): void {
    if (this._editor !== editor) return;
    const card = this._doc?.nodes.find((candidate) => candidate.id === node.id) ?? this._pending?.card ?? node;
    // La scheda di testo cresce col testo (T44); durante una composizione no:
    // la misura arriva con la sua fine.
    if (!editor.composing) this._growWriting(editor, card);
    this._setPending({ card, field: editor.field, text, ...(editor.grown ? { size: editor.grown } : {}) });
    if (editor.composing) return;
    if (editor.recordOnInput) {
      editor.recordOnInput = false;
      this._recordPending();
      return;
    }
    this._schedulePause();
  }

  /**
   * La scheda di testo che si scrive cresce col testo (T44): in larghezza
   * fino a `CANVAS_TEXT_FIT_MAX_WIDTH`, se nessuno l'ha ridimensionata a mano,
   * poi va a capo e cresce in altezza; da sola non si restringe mai. La misura
   * si vede subito, sta in `editor.grown` e nel testo in sospeso, e arriva al
   * `.canvas` col commit del testo.
   */
  _growWriting(editor: CardEditor, card?: CanvasNode): void {
    if (editor.field !== "text") return;
    const node = card ?? this._doc?.nodes.find((candidate) => candidate.id === editor.id) ?? this._pending?.card;
    if (!node || node.type !== "text") return;
    const measured = measureWriting(editor.article, editor.place, this._sizedByHand.has(node.id));
    if (!measured) return;
    const before = editor.grown ?? node;
    const width = Math.max(before.width, node.width, measured.width);
    const height = Math.max(before.height, node.height, measured.height);
    if (editor.grown?.width === width && editor.grown.height === height) return;
    if (!editor.grown && width === node.width && height === node.height) return;
    editor.grown = { width, height };
    editor.article.style.width = `${width}px`;
    editor.article.style.height = `${height}px`;
    const pending = this._pending;
    if (pending && pending.card.id === editor.id) pending.size = editor.grown;
  }

  /**
   * Ctrl+Invio in una scheda di testo (T44, allarga A15): registra, chiude e
   * apre una scheda di testo nuova, già in scrittura, larga come questa, a
   * `NEXT_CARD_GAP` sotto; con `beside` (Ctrl+Maiusc+Invio) a destra,
   * collegata con un filo. In una scheda nuova ancora vuota non fa niente:
   * è già la scheda nuova.
   */
  _writeNext(beside: boolean): void {
    const editor = this._editor;
    if (!editor || this._readOnly || !this._doc) return;
    const id = editor.id;
    if (editor.born) {
      const text = this._pending?.card.id === id ? this._pending.text : this._doc.nodes.find((node) => node.id === id)?.text;
      if ((text ?? "").trim() === "") return;
    }
    if (!this._closeField(false)) return;
    this._render();
    const source = this._doc?.nodes.find((node) => node.id === id);
    const placed = source ? this._addTextNext(source, beside) : null;
    if (!placed) {
      this._viewport.focus();
      return;
    }
    this._render();
    this._beginCardEdit(placed, this._undo[this._undo.length - 1] ?? null);
  }

  /**
   * La scheda di testo vuota accanto a `source` (sotto, o a destra con
   * `beside` e un filo da lei), al primo posto libero; un commit e un passo
   * d'annulla. Torna la scheda messa, scelta, o `null`.
   */
  _addTextNext(source: CanvasNode, beside: boolean): CanvasNode | null {
    const doc = this._doc;
    if (!doc || this._readOnly) return null;
    const spot = freeSpot(doc.nodes, beside
      ? { x: source.x + source.width + NEXT_CARD_GAP, y: source.y, width: source.width, height: TEXT_CARD_HEIGHT }
      : { x: source.x, y: source.y + source.height + NEXT_CARD_GAP, width: source.width, height: TEXT_CARD_HEIGHT });
    // Il posto lo sceglie la tela (`freeSpot`, larga come la scheda di
    // partenza): la scheda nasce con `add_card` e il suo `id`, il filo con
    // `connect`, in una lista sola (T24).
    const id = this._newId();
    const ops: CanvasIntentOp[] = [{ op: "add_card", id, text: "", ...spot }];
    if (beside) {
      const edge = this._connectOps(source.id, id, { from: "right", to: "left" }, id);
      if (edge) ops.push(...edge);
    }
    const written = this._writeOps(ops)?.[0];
    const node = written === undefined ? undefined : this._doc?.nodes.find((one) => one.id === written);
    if (!node) return null;
    this._selection = [node.id];
    this._edgeSelection = [];
    this._options.onSelectionChange();
    return node;
  }

  _fieldComposing(editor: CardEditor): void {
    if (this._editor !== editor) return;
    editor.composing = true;
    clearTimeout(this._pauseTimer);
    this._pauseTimer = undefined;
  }

  _fieldComposed(editor: CardEditor, node: CanvasNode, text: string): void {
    if (this._editor !== editor) return;
    editor.composing = false;
    editor.recordOnInput = false;
    this._fieldText(editor, node, text);
  }

  /**
   * Monta l'editor delle note in Live sopra il testo della scheda (T43), dalla
   * porta delle schede: la tela non importa nessun editor. Finché non c'è si
   * scrive nel campo semplice; se nel frattempo lì è cambiato qualcosa, si
   * riapre una volta sul testo di adesso. Se la porta dice no, il campo resta.
   */
  _openLiveText(editor: CardEditor, node: CanvasNode, body: HTMLElement, simple: AbortController, again: boolean): void {
    const port = this._options.cards?.editors;
    if (!port?.openText || this._editor !== editor) return;
    const host = document.createElement("div");
    // L'aspetto della nota che si scrive in una scheda (T41). Il contenitore è
    // alto quanto il corpo e non trabocca: il testo scorre nell'editor, e ciò
    // che l'editor tiene sotto di sé per la Lettura resta fuori dalla vista.
    host.className = "canvas-card-note canvas-text-live";
    host.style.height = "100%";
    host.style.overflow = "hidden";
    host.hidden = true;
    body.append(host);
    const life = openLifetime();
    editor.lifetime.signal.addEventListener("abort", () => life.close(), { once: true });
    const giveUp = (): void => {
      life.close();
      host.remove();
    };
    const start = editor.input.value;
    let opened: Promise<CardTextEditor | null>;
    try {
      opened = port.openText(host, start, {
        // Solo ciò che si scrive nell'editor che si vede.
        onText: (text) => {
          if (editor.place === host) this._fieldText(editor, node, text);
        },
        readOnly: this._readOnly,
        lifetime: life,
        documentId: this._options.documentId ?? "",
        ...(this._forms ? { forms: this._forms } : {}),
      });
    } catch (error) {
      console.warn(`canvas: l'editor delle note non si monta nella scheda ${node.id}`, error);
      giveUp();
      return;
    }
    void opened.then((live) => {
      if (!live) {
        giveUp();
        return;
      }
      if (this._editor !== editor || life.closed) {
        live.destroy();
        giveUp();
        return;
      }
      if (editor.input.value !== start) {
        live.destroy();
        giveUp();
        if (!again) this._openLiveText(editor, node, body, simple, true);
        return;
      }
      this._showLiveText(editor, node, live, host, simple);
    }, (error: unknown) => {
      console.warn(`canvas: l'editor delle note non si monta nella scheda ${node.id}`, error);
      giveUp();
    });
  }

  /**
   * L'editor delle note prende il posto del campo semplice, col cursore dove
   * era. I tasti restano dell'editor (Ctrl+Z annulla lì); Esc, se non chiude
   * dei suggerimenti, e Ctrl+Invio registrano e chiudono (A14, A15); Invio va a capo e
   * registra; il fuoco che esce dall'editor chiude, come per il campo.
   */
  _showLiveText(editor: CardEditor, node: CanvasNode, live: CardTextEditor, host: HTMLElement, simple: AbortController): void {
    const input = editor.input;
    const focused = document.activeElement === input;
    const caret = input.selectionEnd ?? input.value.length;
    // Gli ascolti del campo smettono prima che esca: toglierlo col fuoco non lo chiude.
    simple.abort();
    editor.live = live;
    editor.place = host;
    const signal = editor.lifetime.signal;
    // Esc chiude prima un elenco di suggerimenti aperto nell'editor; se no esce.
    // L'editor delle note usa Esc anche per altro (lo segna come usato): non
    // conta, come nella scheda di nota (T41).
    let escapeForEditor = false;
    host.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      editor.recordOnInput = false;
      escapeForEditor = false;
      if (composingKey(event) || editor.composing) return;
      if (event.key === "Escape") {
        // Il menu «/» galleggia fuori dalla scheda: lo dice l'editor stesso
        // (`aria-haspopup`), finché è aperto.
        escapeForEditor = host.querySelector('[role="listbox"], [aria-haspopup="listbox"]') !== null;
      } else if (isCommandSearchKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        this._openCommandSearch();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        // Prima dell'editor, che non deve farne un a capo: la scheda dopo (T44).
        event.preventDefault();
        event.stopPropagation();
        this._writeNext(event.shiftKey);
      } else if (event.key === "Enter") {
        // L'a capo che l'editor scrive si registra subito, come nel campo.
        editor.recordOnInput = true;
      }
    }, { signal, capture: true });
    host.addEventListener("keydown", (event) => {
      // I tasti sono dell'editor, Ctrl+Z compreso: la tela non li vede. Un
      // tasto della shell che l'editor non ha usato (Ctrl+W) sale fino a lei,
      // e la tela lo lascia passare.
      if (event instanceof KeyboardEvent && passesToShell(event)) this._shellKeys.add(event);
      else event.stopPropagation();
      if (!(event instanceof KeyboardEvent) || composingKey(event) || editor.composing) return;
      if (event.key === "Escape" && !escapeForEditor) {
        event.preventDefault();
        this._leaveField(true, true);
      } else if (!event.defaultPrevented && isBareKey(event)) {
        // Ctrl+. che l'editor non usa nasconde l'interfaccia (T65).
        event.preventDefault();
        this._workspace.setBare(!this._workspace.bare);
      }
    }, { signal });
    host.addEventListener("compositionstart", () => this._fieldComposing(editor), { signal });
    host.addEventListener("compositionend", () => this._fieldComposed(editor, node, live.text()), { signal });
    // Il fuoco che va nella ricerca dei comandi non chiude il campo: ci torna.
    host.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && host.contains(next)) return;
      if (!this._searching) this._leaveField(false);
    }, { signal });
    // Portare il cursore in vista non sposta il contenitore: scorre l'editor.
    host.addEventListener("scroll", () => {
      if (host.scrollTop !== 0) host.scrollTop = 0;
      if (host.scrollLeft !== 0) host.scrollLeft = 0;
    }, { signal });
    input.remove();
    host.hidden = false;
    // Il cursore dove era il doppio clic, se nel campo non si è ancora scritto
    // niente; se no (o fuori dal testo) dov'era nel campo (IMP-3808).
    const untouched = input.value === (node.text ?? "");
    if (focused && !(untouched && editor.point && live.focusAtPoint?.(editor.point))) live.focus(caret);
  }
}

export interface CanvasEngine extends CropMethods {}
mixMethods(CanvasEngine.prototype, cropMethods);
