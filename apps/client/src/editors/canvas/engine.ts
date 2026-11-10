import type { Theme } from "../../theme/theme";
import type { SyntaxForm } from "../../host/contract";
import { t, onLanguage } from "../../i18n/strings";
import { MENU_RULE, type SurfaceClipboardOp, type SurfaceMenu, type SurfaceMenuClipboard, type SurfaceMenuEntry, type SurfaceMenuItem } from "../core/editor-menu";
import { clipboardSupports, readClipboard, writeClipboardData, writeClipboardText } from "../../platform/clipboard";
import { lineFeeds, operationFromText, type EditorChangeOrigin, type TextOperation } from "../core/text-operation";
import { idleSchedule } from "../../ink/dom/idle";
import type { InkPointerType } from "../../ink/input/pointer";
import { PenQuiet } from "../../ink/quiet";
import type { InkSample } from "../../ink/sample";
import { ERASER } from "../../ink/tools/eraser";
import { EraseSweep, type Spot } from "../../ink/tools/sweep";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { mediaKindOfId } from "../media/media-types";
import { anchorAt, strokeBounds, StrokeBox, type Bounds } from "./anchor";
import { parseTsv } from "../core/tsv";
import { bornSize, dropLayout, markdownTable, spreadLayout, type DropItem } from "./drop-layout";
import { parsePageRanges } from "./page-ranges";
import type { PdfPagesReader } from "./cards/pdf";
import { ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE } from "../../ui/drag-types";
import {
  cardKindOf,
  liveCardIds,
  updateLiveCards,
  type CardContext,
  type CardKind,
  type CardMode,
  type CardQuiet,
  type CardRegistry,
  type CardRenderer,
  type CardSize,
  type CardSnapshots,
  type CardView,
  type Rect,
} from "./cards";
import {
  cutInk,
  cutPath,
  cutStrokePatches,
  erasableInk,
  InkEraseSource,
  inkKey,
  pieceRecords,
  type CutPiece,
  type ErasableInk,
  type InkEraserMode,
  type StrokeCut,
} from "./ink-erase";
import {
  CANVAS_ALIGN,
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
  type CanvasNudge,
  type CanvasTip,
  type CanvasToolId,
} from "./chrome/commands";
import { CANVAS_INK_TOOLS, CANVAS_WRITING_TOOLS, createCanvasRail, type CanvasRail } from "./chrome/rail";
import { createCanvasEmpty, isEmptyBoard, transferOf, type CanvasEmpty } from "./chrome/empty";
import { createCanvasNavigator, type CanvasNavigator } from "./chrome/navigator";
import {
  CANVAS_CLIPBOARD_TYPE,
  CANVAS_PASTE_STEP,
  cardsMarkdown,
  clipboardJson,
  copiedCards,
  placedCards,
  readCanvasClipboard,
  type CanvasClipboard,
} from "./clipboard";
import { createCanvasOptions, type CanvasOptions } from "./chrome/options";
import type { OptionItem } from "../../kit/options-bar";
import {
  canvasStatusItems,
  dropFolderOf,
  readAttachmentFolder,
  statusSignature,
  type CanvasStatusPort,
} from "./chrome/status";
import type { SurfaceStatusItem } from "../core/registry";
import { CanvasDepositError, type DropFolderChoice } from "../../state/canvas-intake";
import { SHARED_RECENT_COMMANDS, openCommandSearch, type CommandSearchHandle, type RecentCommands } from "./chrome/command-search";
import { inkFitMode } from "./ink-fit";
import { mountInkLayer, type InkLayer, type InkLayerStroke } from "./ink-layer";
import { cutInkStroke, fadeInkStroke, InkPathCache, paintBoard, paintCard, type DryStroke } from "./ink-paint";
import { createPenMenu, pickerText as canvasPickerText, type PenMenu } from "./pen-menu";
// I colori delle schede e dei fili (T47).
import {
  JSON_CANVAS_COLORS,
  NOTE_COLORS,
  colorChoiceOf,
  colorLook,
  colorMenuLabel,
  colorName,
  colorValueOf,
  writeColor,
  type CanvasColorChoice,
} from "./colors";
import { createColorPicker, openDialog, openPopover, textField, type PopoverHandle } from "../../kit";
import { DEFAULT_PREFERENCES, currentPreferences, readInkMouse, readPen, saveInkMouse, savePen, watchPreferences, type WheelAction } from "./preferences";
import { isTap, pinchCamera, type TouchCamera, type TouchPoint, type ZoomLimits } from "./touch";
import { fit, stepCamera, zoomAtPoint, type Camera, type MotionState, type ScaleLimits } from "../../spatial/camera";
import { onReducedMotionChange, reducedMotion } from "../../theme/reduced-motion";
import {
  DEFAULT_INK_CHOICE,
  dryStroke,
  inkLook,
  type InkPenChoice,
  foreignInkLayer,
  inkLayerStates,
  strokeRecord,
  toDry,
  type DrawableStroke,
  type InkLayerRef,
  type InkLayerState,
} from "./ink-record";
import {
  addStrokePatch,
  eraseStrokePatches,
  newNodeId,
  removeEdgePatch,
  removeNodePatch,
  upsertEdgePatch,
  upsertNodePatch,
  type CanvasOperation,
  type CanvasPatch,
  type InkPatch,
} from "./operation";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "./model";
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
import { CanvasViewRecorder, type CanvasView, type CanvasViewMemory, type CanvasViewSnapshot } from "./view-state";
import {
  CanvasCoreError,
  canvasCoreReady,
  openCoreNow,
  type CanvasCore,
  type CanvasCoreErrorCode,
  type CanvasInkLayer,
  type CanvasSourceEdit,
} from "./wasm/core";

export const CANVAS_SNAP = 8;
export const CANVAS_MIN_SIZE = 40;
export const MAX_CANVAS_HISTORY = 100;
/** La pausa dopo l'ultimo tasto in una scheda, prima che il suo testo si registri. */
export const CARD_PAUSE_MS = 250;
/** Oltre questo numero di schede nuove, «Spargi le pagine» (T72) chiede conferma. */
export const SPREAD_CONFIRM_ABOVE = 200;
/** Quanto si aspetta dopo l'ultimo scatto della rotella prima di dire finito il gesto (A-7). */
export const WHEEL_SETTLE_MS = 150;
/** Una riga della rotella in pixel: un valore di partenza, come nella lavagna del grafo. */
const WHEEL_LINE_PX = 16;

/**
 * Il delta della rotella in pixel, qualunque unità abbia scelto il browser:
 * `deltaMode` 1 conta righe, 2 pagine, e la pagina è la misura della vista.
 */
function wheelPixels(delta: number, deltaMode: number, page: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * page;
  return delta;
}

/** I tasti che una scheda scelta e non attiva può prendere (`CardView.key`, T14). */
const CARD_KEYS: ReadonlySet<string> = new Set(["PageUp", "PageDown", "Home", "End"]);

/** Le specie in cui il doppio clic entra, come Invio (T14). */
const DOUBLE_CLICK_ENTERS: ReadonlySet<CardKind> = new Set(["note", "document", "sheet"]);
/** Il testo più lungo di una scheda, in byte UTF-8: oltre, il nucleo rifiuta la lavagna (`invalid`). */
const MAX_CARD_TEXT_BYTES = 1_048_576;
/** Quanto si aspetta la misura di un'immagine portata dentro, prima di usare quella di serie. */
export const MEASURE_IMAGE_TIMEOUT_MS = 3_000;
/** Quante immagini si misurano insieme quando ne arrivano tante. */
const MEASURE_IMAGE_PARALLEL = 4;
const utf8 = new TextEncoder();
const MAX_INTERACTIVE_NODES = 2_000;
const MAX_INTERACTIVE_EDGES = 4_000;

export interface CanvasChange {
  readonly text: string;
  readonly operation: CanvasOperation;
  readonly origin: EditorChangeOrigin;
}

export interface CanvasMediaPort {
  readonly openExternal: (target: string) => void | Promise<void>;
  readonly openViewer?: (target: string) => void | Promise<void>;
}
/** External bytes become cards only after deposit returns; no implicit file writes. */
export interface CanvasAttachmentPort {
  /** Receipts contain vault-relative paths after collision-safe, explicit deposit.
   *  `cards` sono le schede che questo gesto farà nascere coi percorsi tornati:
   *  un gesto dopo (la notifica «Fanne una copia», T32b) le ripunta per id. */
  readonly deposit: (files: readonly File[], documentId: string, cards: CanvasDepositCards) => Promise<readonly string[]>;
  /** Resolve only existing trusted vault paths/folders, never local filesystem bytes. */
  readonly resolvePaths?: (data: DataTransfer, documentId: string) => Promise<readonly string[]>;
  /** Enumerate direct files and OS folder entries once; every result passes through deposit. */
  readonly expandFiles?: (data: DataTransfer) => Promise<readonly File[]>;
}

/** Una scheda da ripuntare: mostrava `from`, mostrerà `to`. */
export interface CanvasRepoint {
  readonly from: string;
  readonly to: string;
}

/**
 * Le schede nate da un deposito dal computer (T32b). La lavagna le ricorda per
 * id, non per percorso: una scheda tolta dopo non si tocca, una spostata si
 * ripunta lo stesso, e una che mostra già un altro file resta com'è. Una
 * scheda che il vault aveva già sulla lavagna, con lo stesso file, non è di
 * questo gesto e non cambia.
 */
export interface CanvasDepositCards {
  /** Falso dopo che la lavagna è stata chiusa o è diventata di sola lettura:
   *  l'azione di una notifica rimasta a galla non fa più niente. */
  readonly live: () => boolean;
  /** Ripunta le schede del gesto in un commit solo (un Ctrl+Z torna ai file di
   *  prima) e dice quante ne ha cambiate. */
  readonly repoint: (changes: readonly CanvasRepoint[]) => number;
}

/**
 * Dove la tela apre le sue lavagne: per difetto il nucleo condiviso della
 * shell (`wasm/core.ts`). `openNow` apre subito, o dà `null` se il nucleo non
 * è carico; `ready` lo carica.
 */
export interface CanvasCorePort {
  readonly openNow: (text: string) => CanvasCore | null;
  readonly ready: () => Promise<void>;
}

const SHARED_CORE: CanvasCorePort = { openNow: openCoreNow, ready: canvasCoreReady };

/**
 * Dove la lavagna ricorda l'interruttore «Scrivi col mouse»: `read` dà lo
 * stato con cui una lavagna che si apre comincia (spento, salvo «Ricorda se
 * scrivi col mouse» acceso); `save` ricorda una scelta fatta col pulsante.
 * Per difetto lo stato di vista di questo computer (`preferences.ts`).
 */
export interface CanvasInkMouseMemory {
  readonly read: () => Promise<boolean>;
  readonly save: (on: boolean) => void;
}

const SHARED_INK_MOUSE: CanvasInkMouseMemory = { read: readInkMouse, save: saveInkMouse };

/**
 * Dove la lavagna ricorda la penna scelta nel menu (A19): `read` dà quella
 * con cui una lavagna che si apre comincia, `save` ricorda una scelta fatta.
 * Per difetto lo stato di vista `canvas.pen` di questo computer.
 */
export interface CanvasPenMemory {
  readonly read: () => Promise<InkPenChoice>;
  readonly save: (choice: InkPenChoice) => void;
}

const SHARED_PEN: CanvasPenMemory = { read: readPen, save: savePen };

type CardField = "text" | "label" | "url" | "file";

/** Il campo aperto su una scheda. */
interface CardEditor {
  readonly id: string;
  readonly field: CardField;
  readonly input: HTMLInputElement | HTMLTextAreaElement;
  readonly article: HTMLElement;
  readonly lifetime: AbortController;
  /** Una composizione dell'IME o un tasto morto in corso: la pausa aspetta la sua fine. */
  composing: boolean;
  /** Invio in una scheda di testo: l'a capo che arriva si registra subito. */
  recordOnInput: boolean;
}

/**
 * Un passo d'annulla (o di ripeti). Due vie per farlo: se il testo è ancora
 * quello che il passo ha lasciato (`version`), si rimette il tratto `removed`
 * al posto di `inserted`, byte per byte, e il testo torna alla sua versione di
 * prima (`restores`); se no si passano `patches` al nucleo, che le fonde con
 * ciò che è cambiato da un'altra parte.
 */
interface CanvasStep {
  /** Le toppe che fanno questo passo sul modello di adesso. */
  readonly patches: CanvasPatch[];
  /** Le toppe che disfano questo passo: valgono sul testo che il passo rimette. */
  readonly back: CanvasPatch[];
  /** Dove comincia il tratto, in unità UTF-16. */
  readonly start: number;
  /** Il tratto del testo di adesso che il passo toglie. */
  readonly inserted: string;
  /** Il tratto che il passo rimette al suo posto. */
  readonly removed: string;
  /** La versione del testo che il passo ha lasciato: se è ancora quella, la via è il tratto. */
  readonly version: number;
  /** La versione del testo che il passo rimette. */
  readonly restores: number;
}

/**
 * Un tratto spezzato al limite dei campioni (`split`) che continua nel pezzo
 * dopo: il passo che tiene i pezzi già scritti e il testo di prima del primo
 * pezzo. Il pezzo dopo si fonde in quel passo (A4).
 */
interface InkChain {
  readonly step: CanvasStep;
  readonly before: string;
}

/**
 * Una passata della gomma: il tratto dell'adattatore che la fa, il registro
 * di ciò che ha preso e i tratti disegnati che può prendere, fissati quando
 * comincia. Con `"piece"` (T22) anche il cammino fatto, in coordinate della
 * lavagna, e il taglio di adesso di ogni tratto toccato, per chiave.
 */
interface InkErase {
  readonly id: number;
  readonly sweep: EraseSweep<ErasableInk>;
  readonly source: InkEraseSource;
  readonly mode: InkEraserMode;
  readonly path: Spot[];
  readonly cuts: Map<string, InkErasing>;
}

/** Un tratto che la gomma «Solo il pezzo» sta tagliando. */
interface InkErasing {
  readonly unit: ErasableInk;
  readonly pieces: readonly CutPiece[];
  /** Il contorno dei pezzi, per l'anteprima. */
  readonly preview: string;
}

// --- a chi appartiene il tratto (T69) ---
/**
 * Il tratto della punta in corso e l'ancora che avrebbe se finisse adesso: il
 * riquadro cresce coi punti che la vista vede (`pointermove`, dopo la scia),
 * il bordo tratteggiato e il testo dell'etichetta cambiano solo quando cambia
 * l'ancora.
 */
interface InkTarget {
  readonly pointerId: number;
  readonly box: StrokeBox;
  /** Lo spessore del tratto in unità della lavagna: il pennello che la scia usa. */
  readonly size: number;
  /** Dove sta la vista sullo schermo, letto all'inizio del tratto: nessuna lettura del layout mentre si scrive. */
  readonly view: DOMRect;
  readonly label: HTMLElement;
  /** Il contenitore dei quattro lati del bordo, sullo stage. */
  readonly frames: HTMLElement;
  /** L'id della scheda mostrata, `null` se il tratto è libero; `undefined` prima del primo giro. */
  holder: string | null | undefined;
}

/**
 * L'etichetta e i lati del bordo, nati al primo tratto e tenuti per i tratti
 * dopo (nascosti a penna su): un tratto che comincia non crea nodi e non
 * chiede il layout. La misura dell'etichetta arriva da un `ResizeObserver`,
 * dopo il layout che il browser fa comunque: mai una lettura forzata.
 */
interface InkMarks {
  readonly label: HTMLElement;
  /**
   * Il bordo tratteggiato attorno alla scheda: quattro lati sottili in un
   * contenitore sullo stage, non il contorno della scheda. Mostrarlo o
   * toglierlo ridipinge solo i lati: il contorno ridipingerebbe tutta la
   * scheda (una tabella di diecimila celle in S8) due volte per tratto. Il
   * contenitore resta sullo stage: un tratto non vi aggiunge né toglie nodi.
   */
  readonly frames: HTMLElement;
  /** La misura dell'etichetta e lo stacco dalla punta; zero finché non è misurata. */
  width: number;
  height: number;
  gap: number;
}

/** I quattro lati del bordo tratteggiato della scheda sotto la penna. */
const INK_FRAME_SIDES = ["top", "right", "bottom", "left"] as const;

/** Il punto dove comincia il tratto che sta per nascere: l'ultimo appoggio, poi l'ultimo movimento visto. */
interface InkPoint {
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** Il tasto che fa scrivere il mouse finché è giù (regola 1). */
function isInkKey(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "d";
}

/** Un campo dove i tasti scrivono. */
function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;
}

/** Gli stati dei livelli d'inchiostro, per il modello e i livelli del nucleo da cui vengono. */
interface InkStates {
  readonly doc: CanvasDocument;
  readonly layers: readonly CanvasInkLayer[];
  readonly states: readonly InkLayerState[];
}

/** Il testo del campo non ancora registrato: la scheda com'era, il campo, il testo. */
interface PendingText {
  card: CanvasNode;
  readonly field: CardField;
  text: string;
}

/**
 * Una voce del menu del tasto destro dal comando `id` del catalogo: `args`
 * dice su che cosa, `refocus` rimette il fuoco sulla tela dopo il gesto.
 */
type MenuEntryMaker = (id: string, args?: CanvasCommandArgs, refocus?: boolean, extra?: Partial<SurfaceMenuItem>) => SurfaceMenuItem;

/**
 * «Colore ›» col colore di adesso segnato (`undefined` quello di serie, `null`
 * nessuno: colori diversi), le voci come scelte esclusive (T47).
 */
type ColorMenuMaker = (current: string | null | undefined, args?: CanvasCommandArgs) => SurfaceMenuItem;

export interface CanvasEngineOptions {
  readonly surfaceId: string;
  /** Il nucleo che apre le lavagne; i test ne passano uno che conta le chiamate. */
  readonly core?: CanvasCorePort;
  readonly formatId?: string | null;
  readonly revision?: string;
  readonly onChange: (change: CanvasChange) => void;
  readonly onSelectionChange: () => void;
  readonly onOpenWikilink?: (page: string, heading: string | null, block: string | null) => void | Promise<void>;
  readonly onOpenPath?: (path: string, from?: string) => void | Promise<void>;
  /** «Apri a lato» dal menu di una scheda di file: come `onOpenPath`, in un riquadro accanto. */
  readonly onOpenPathBeside?: (path: string, from?: string) => void | Promise<void>;
  /**
   * «Sposta anche il file nel cestino» (T17): il file `path` del vault nel
   * cestino, con il gesto dell'albero. `true` se il file è nel cestino,
   * `false` se è rimasto (una domanda a cui si è detto di no); un rifiuto
   * dell'host arriva come errore. Mai la conseguenza di un tasto.
   */
  readonly onTrashPath?: (path: string) => Promise<boolean>;
  readonly onCreateNote?: (initialText: string) => string | void | Promise<string | void>;
  /**
   * Sceglie il file del vault a cui punta una nuova card file; `null` o niente
   * se l'utente rinuncia. Assente = niente bottone «aggiungi file»: una card
   * che punta a un file inventato è un rimando rotto scritto nel documento.
   * Con `name` (il nome del file di una scheda che non c'è più, «Ritrova…») la
   * scelta mette per prima una voce con quel nome.
   */
  readonly onPickFile?: (name?: string) => string | null | void | Promise<string | null | void>;
  readonly documentId?: string;
  readonly media?: CanvasMediaPort;
  readonly attachments?: CanvasAttachmentPort;
  readonly theme?: Theme;
  /**
   * Il testo in sospeso di una scheda è cambiato: `true` se ne resta. Nessun
   * lavoro in più: chi ascolta chiede `pendingText` quando gli serve.
   */
  readonly onPendingChange?: (pending: boolean) => void;
  /**
   * Una voce della banda di stato può essere cambiata: a fine gesto, mai a
   * ogni fotogramma (`chrome/status.ts`). Chi ascolta la rilegge con
   * `statusItems`.
   */
  readonly onStatusChange?: () => void;
  /** Apre le Impostazioni su una voce (la cartella dei file trascinati, dalla banda). */
  readonly onOpenSettings?: (key: string) => void;
  /**
   * Resa markdown reale di una card testo (stesso `renderMarkdown` della
   * lettura, con `mountMarkdown` per sanitizzazione/embed). Assente = testo
   * non interattivo: nessun secondo parser né scanner locale. `forms` sono le
   * sintassi che il vault dà al Markdown delle card (`EMBEDDED_GRAMMAR`);
   * assenti finché la superficie non le ha ricevute.
   */
  readonly renderMarkdownForCard?: (
    nodeId: string,
    text: string,
    host: HTMLElement,
    forms: readonly SyntaxForm[] | undefined,
  ) => (() => void) | void;
  /**
   * «Il dito sposta le schede», letto quando il primo dito si posa: un cambio
   * vale dal tocco dopo. I test lo passano; assente, la lavagna segue le
   * Impostazioni di questo computer (`watchPreferences`).
   */
  readonly fingerMovesCard?: () => boolean;
  /**
   * Dove si ricorda «Scrivi col mouse»: letto una volta all'apertura, scritto
   * a ogni clic sul pulsante. I test lo passano; assente, lo stato di vista
   * di questo computer.
   */
  readonly inkMouseMemory?: CanvasInkMouseMemory;
  /**
   * Dove si ricorda la penna del menu: letta una volta all'apertura, scritta
   * a ogni scelta. I test lo passano; assente, lo stato di vista di questo
   * computer.
   */
  readonly penMemory?: CanvasPenMemory;
  /**
   * Dove si ricordano i comandi usati di recente in ogni lavagna, per la
   * ricerca dei comandi (T48). I test lo passano; assente, lo stato di vista
   * di questo computer.
   */
  readonly recentCommands?: RecentCommands;
  /**
   * Le schede di file e di link: chi le disegna per specie e le immagini
   * ferme. Assente (un'altra finestra, le prove vecchie): il corpo di sempre,
   * col percorso e il segnaposto.
   */
  readonly cards?: CanvasCards;
  /**
   * La misura in pixel dell'immagine `path` del vault, per la misura di
   * nascita della sua scheda (T15); `null` se non si sa. Assente, o una
   * risposta che non arriva in tempo: la misura di serie della specie.
   */
  readonly measureImage?: (path: string) => Promise<{ readonly width: number; readonly height: number } | null>;
  /**
   * Il Markdown dell'HTML degli appunti (una tabella copiata da un foglio o da
   * una pagina), come lo incolla l'editor Markdown; `null` se non ce n'è.
   * Assente: l'HTML non si legge, e le celle arrivano solo dal testo a
   * tabulazioni.
   */
  readonly clipboardMarkdown?: (data: DataTransfer) => Promise<string | null>;
  /**
   * Dove si ricorda la vista della lavagna su questo computer (T36): la
   * camera, la scelta e la pagina dei PDF, lette all'apertura e scritte con
   * un ritardo. Assente, o senza `documentId`: si inquadra tutto a ogni
   * apertura, come prima.
   */
  readonly viewMemory?: CanvasViewMemory;
}

/**
 * Le schede della tela: il registro dei renderer, la cache delle immagini ferme
 * e l'ascolto dei file. Una scheda il cui file manca non ha una vista: `watch`
 * avvisa quando il file torna, e la scheda si rimonta da sé (T16).
 */
export interface CanvasCards {
  readonly registry: CardRegistry;
  readonly snapshots: CardSnapshots;
  /** Avvisa quando il file `path` cambia, sparisce o torna; restituisce come smettere. */
  watch(path: string, changed: () => void): () => void;
  /**
   * Le pagine di un PDF per «Spargi le pagine» (T72). Assente (senza il lettore
   * dei PDF): il comando è spento col perché.
   */
  readonly pdfPages?: PdfPagesReader;
}

/**
 * Una scheda sulla scena, tenuta per id da una resa all'altra: l'elemento, il
 * corpo e ciò che lo tiene vivo (il Markdown montato, la vista del renderer).
 */
interface CardEntry {
  readonly id: string;
  readonly article: HTMLElement;
  readonly title: HTMLElement;
  readonly connect: HTMLButtonElement;
  /** La scheda com'è nel documento di adesso. */
  node: CanvasNode;
  type: CanvasNode["type"];
  body: HTMLElement;
  /** La chiave del corpo (`cardBodyKey`): se cambia, il corpo si rifà; `null`, da rifare. */
  bodyKey: string | null;
  /** Le quattro maniglie agli angoli (T66); `null` in sola lettura. */
  resize: readonly HTMLElement[] | null;
  /** Lo smontaggio del Markdown di una scheda di testo. */
  teardown: (() => void) | null;
  /**
   * La vista del renderer e la sua vita; `null` col corpo di sempre. Col file
   * mancante la vita tiene l'ascolto del file e i gesti, al posto della vista.
   */
  view: CardView | null;
  viewLife: Lifetime | null;
  /** La misura che la vista conosce: quella del montaggio o dell'ultimo `resize()`. */
  viewSize: CardSize | null;
  /**
   * Il file della scheda non c'è: la chiave della vista (`cardBodyKey`) con cui
   * il renderer l'ha detto. `null` se il file c'è, o non si sa.
   */
  missingFor: string | null;
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Un punto della scia di uno spostamento, in px del client, col suo tempo in ms (T53). */
interface PanSample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

/** Dove sta il puntatore di un trascinamento, e i tasti tenuti: ciò che serve per rifare il passo (T53). */
type PointerAt = Pick<PointerEvent, "pointerId" | "clientX" | "clientY" | "shiftKey" | "altKey">;

/** Sotto il dito fanno come col mouse: i controlli sempre, le maniglie se la lavagna si cambia. */
const FINGER_CONTROLS = "button, a, input, textarea, select, [contenteditable]:not([contenteditable='false'])";
/**
 * Fino a questa larghezza della finestra, in px, la colonna degli strumenti
 * sta sotto la lavagna; e così in un riquadro largo fino a `NARROW_PANE`,
 * anche in una finestra larga (gli stessi valori del disegno).
 */
const NARROW_WIDTH = 700;
const NARROW_PANE = 480;
/** Il filo con cui nasce una scheda lasciata nel vuoto (T67): da `from`, dal lato `fromSide` se c'è. */
interface CardLink {
  readonly from: string;
  readonly fromSide?: EdgeSide;
}

/**
 * Il filo che si sta tirando (T67): da `from`, partito dal punto `fromSide`
 * (senza: il lato lo sceglie `edges.ts` al rilascio), o l'estremità
 * `endpoint` del filo `edgeId` che si riattacca. `back`: il filo di
 * «Collega…», finito il quale la colonna torna alla Selezione. `moved` dice
 * se il puntatore si è mosso: un clic fermo su un punto non fa una scheda.
 */
interface ConnectGesture {
  readonly pointerId: number;
  readonly from: string;
  readonly fromSide?: EdgeSide;
  readonly edgeId?: string;
  readonly endpoint?: "from" | "to";
  readonly back?: boolean;
  readonly startX: number;
  readonly startY: number;
  moved: boolean;
}

const FINGER_HANDLES = ".canvas-node-handle, [data-resize], [data-resize-frame], [data-reconnect], [data-connect], .canvas-port";

/** I limiti dello zoom, dal 5% al 400% (T53): la rotella, i tasti, i pulsanti e il pizzico. */
const ZOOM_LIMITS: ZoomLimits = { min: 0.05, max: 4 };

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, zoom));
}

// --- muoversi (T53) ---------------------------------------------------------

/** Il passo di + e −, lo stesso del disegno (`ZOOM_STEP` dei disegni, 1,25). */
export const CANVAS_ZOOM_STEP = 1.25;

/**
 * «Mostra tutto» non ingrandisce oltre il 100%, e lascia attorno alle schede
 * un margine di `FIT_MARGIN` unità della lavagna per lato, come prima.
 */
const FIT_LIMITS: ScaleLimits = { min: ZOOM_LIMITS.min, max: 1 };
const FIT_MARGIN = 80;

/** A meno di tanti px dal bordo della vista, un trascinamento la fa scorrere. */
export const EDGE_SCROLL_ZONE = 40;

/** La velocità dello scorrimento al bordo, in px dello schermo al ms, sul bordo e fuori. */
export const EDGE_SCROLL_MAX = 1.2;

/** L'inerzia parte solo da un dito che va almeno a tanto, in px al ms. */
const INERTIA_MIN_SPEED = 0.05;

/** La velocità del dito si misura sugli ultimi ms del gesto. */
const INERTIA_WINDOW_MS = 100;

/** Il passo più lungo di un fotogramma, in ms: dopo una pausa del browser la vista non salta. */
const MAX_FRAME_MS = 64;

/** La camera della tela nella forma di `spatial/camera.ts`, e ritorno. */
function toCamera(view: Viewport): Camera {
  return { scale: view.zoom, tx: view.x, ty: view.y };
}

function fromCamera(camera: Camera): Viewport {
  return { x: camera.tx, y: camera.ty, zoom: camera.scale };
}

/**
 * La velocità dello scorrimento al bordo su un asse, in px al ms: `near` è la
 * distanza dal bordo di inizio, `far` da quello di fine (negative fuori dalla
 * vista). Positiva verso la fine, negativa verso l'inizio, zero fuori dalla
 * fascia; più veloce più si è vicini, la massima sul bordo e oltre.
 */
export function edgeScrollSpeed(near: number, far: number): number {
  const pull = (distance: number): number =>
    distance >= EDGE_SCROLL_ZONE ? 0 : EDGE_SCROLL_MAX * Math.min(1, 1 - Math.max(0, distance) / EDGE_SCROLL_ZONE);
  return pull(far) - pull(near);
}

/** Le due camere sono la stessa. */
function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/**
 * Il rettangolo di `node` e `view` si sovrappongono davvero: una scheda che
 * tocca la vista solo sul bordo è fuori.
 */
function overlaps(node: Rect, view: Rect): boolean {
  return node.x < view.x + view.width && node.x + node.width > view.x
    && node.y < view.y + view.height && node.y + node.height > view.y;
}

function snap(value: number): number {
  return Math.round(value / CANVAS_SNAP) * CANVAS_SNAP;
}

// --- ridimensionare (T66) -------------------------------------------------------

/** Un angolo di una scheda, o della cornice della scelta: dove sta una maniglia. */
export type ResizeCorner = "nw" | "ne" | "sw" | "se";

/**
 * Le quattro maniglie, nell'ordine in cui stanno nel DOM: prima quella in
 * basso a destra, la maniglia di sempre, che resta l'unica sotto
 * `RESIZE_ONE_HANDLE_PX`.
 */
const RESIZE_CORNERS: readonly ResizeCorner[] = ["se", "sw", "ne", "nw"];

/** Sotto questa misura sullo schermo, in px, una scheda ha solo la maniglia in basso a destra. */
export const RESIZE_ONE_HANDLE_PX = 24;

/**
 * La metà della presa del dito, in px sullo schermo: un'area di 44 px
 * centrata sull'angolo. Col mouse la presa è l'elemento della maniglia, 20
 * px, misurata dalla pelle.
 */
export const RESIZE_FINGER_GRIP_PX = 22;

/** La larghezza più grande che il doppio clic su una maniglia dà a una scheda di testo (T44). */
export const CANVAS_TEXT_FIT_MAX_WIDTH = 480;

/** Un rettangolo nella lavagna. */
export interface ResizeBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Come si tira una maniglia. */
export interface ResizeOptions {
  /** Maiusc: le proporzioni di partenza restano. */
  readonly keepRatio: boolean;
  /** Alt: il centro resta fermo e la misura cambia dai due lati. */
  readonly fromCenter: boolean;
  /** L'aggancio delle misure a `CANVAS_SNAP` (A-23); con le proporzioni tenute non c'è. */
  readonly snap: boolean;
  readonly minWidth: number;
  readonly minHeight: number;
}

/**
 * Il rettangolo `start` tirato dalla maniglia `corner` di `(dx, dy)`, in
 * unità della lavagna. Senza Alt sta fermo l'angolo opposto, con Alt il
 * centro; con Maiusc vince il lato che cresce di più, e l'altro lo segue.
 * Mai sotto il minimo, mai `NaN`.
 */
export function resizeBox(start: ResizeBox, corner: ResizeCorner, dx: number, dy: number, options: ResizeOptions): ResizeBox {
  const east = corner === "ne" || corner === "se";
  const south = corner === "sw" || corner === "se";
  const reach = options.fromCenter ? 2 : 1;
  let width = start.width + (east ? dx : -dx) * reach;
  let height = start.height + (south ? dy : -dy) * reach;
  if (options.keepRatio && start.width > 0 && start.height > 0) {
    const scale = Math.max(
      width / start.width,
      height / start.height,
      options.minWidth / start.width,
      options.minHeight / start.height,
    );
    width = start.width * scale;
    height = start.height * scale;
  } else if (options.snap) {
    width = snap(width);
    height = snap(height);
  }
  width = Math.round(Math.max(options.minWidth, Number.isFinite(width) ? width : start.width));
  height = Math.round(Math.max(options.minHeight, Number.isFinite(height) ? height : start.height));
  const x = options.fromCenter
    ? Math.round(start.x + (start.width - width) / 2)
    : east ? start.x : start.x + start.width - width;
  const y = options.fromCenter
    ? Math.round(start.y + (start.height - height) / 2)
    : south ? start.y : start.y + start.height - height;
  return { x, y, width, height };
}

/** Il rettangolo che contiene tutte le schede `nodes`; `null` senza schede. */
export function boxAround(nodes: readonly ResizeBox[]): ResizeBox | null {
  if (nodes.length === 0) return null;
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
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * La scheda `node` dentro la cornice `from` portata nella cornice `to`: la
 * posizione e la misura scalano come la cornice (le maniglie della scelta).
 */
export function scaleInto(node: ResizeBox, from: ResizeBox, to: ResizeBox, min: number): ResizeBox {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    x: Math.round(to.x + (node.x - from.x) * sx),
    y: Math.round(to.y + (node.y - from.y) * sy),
    width: Math.max(min, Math.round(node.width * sx)),
    height: Math.max(min, Math.round(node.height * sy)),
  };
}

/** Il primo multiplo di `CANVAS_SNAP` che non taglia `value`. */
function snapUp(value: number): number {
  return Math.ceil(value / CANVAS_SNAP) * CANVAS_SNAP;
}

/** L'angolo scritto su una maniglia; senza, quello in basso a destra. */
function cornerOf(value: string | undefined): ResizeCorner {
  return value === "nw" || value === "ne" || value === "sw" ? value : "se";
}

/** Un lato del rettangolo `box` è sotto `RESIZE_ONE_HANDLE_PX` sullo schermo. */
function tinyOnScreen(box: ResizeBox, zoom: number): boolean {
  return box.width * zoom < RESIZE_ONE_HANDLE_PX || box.height * zoom < RESIZE_ONE_HANDLE_PX;
}

/**
 * Una maniglia: l'area di presa all'angolo `corner`, che la pelle misura e
 * disegna. `node` è la scheda che ridimensiona; `null` per la cornice della
 * scelta, che ridimensiona tutte le schede scelte.
 */
function resizeHandle(corner: ResizeCorner, node: string | null): HTMLElement {
  const handle = document.createElement("div");
  handle.className = "canvas-resize";
  handle.dataset.corner = corner;
  if (node === null) handle.dataset.resizeFrame = "";
  else handle.dataset.resize = node;
  handle.setAttribute("aria-hidden", "true");
  return handle;
}

/** Una scheda (o la cornice) troppo piccola sullo schermo tiene solo la maniglia in basso a destra: le altre la coprirebbero. */
function markHandles(el: HTMLElement, box: ResizeBox, zoom: number): void {
  if (tinyOnScreen(box, zoom)) el.dataset.handles = "one";
  else delete el.dataset.handles;
}

/**
 * La misura del testo di una scheda (`article`, col corpo `body`): la
 * larghezza che il testo vuole senza andare a capo, fino a
 * `CANVAS_TEXT_FIT_MAX_WIDTH`, e l'altezza che allora gli serve, la testata
 * compresa; agganciate per eccesso a `CANVAS_SNAP`, così niente si taglia.
 * Misura sullo stile della scheda e lo rimette com'era. `null` senza
 * impaginazione.
 */
function measureText(article: HTMLElement, body: HTMLElement): { width: number; height: number } | null {
  const { width, height } = article.style;
  try {
    article.style.width = "max-content";
    // La larghezza usata, coi decimali: `offsetWidth` arrotonda, e un testo
    // largo 320,3 px a 320 andrebbe a capo.
    let measured = Math.max(article.offsetWidth, parseFloat(getComputedStyle(article).width) || 0);
    if (measured > CANVAS_TEXT_FIT_MAX_WIDTH) {
      article.style.width = `${CANVAS_TEXT_FIT_MAX_WIDTH}px`;
      measured = CANVAS_TEXT_FIT_MAX_WIDTH;
    } else {
      article.style.width = `${measured}px`;
    }
    // La testata e i bordi: quello che non è il corpo. Poi il corpo a zero,
    // perché scorra tutto e `scrollHeight` dica l'altezza del testo.
    const chrome = Math.max(0, article.offsetHeight - body.offsetHeight);
    article.style.height = `${chrome}px`;
    const content = body.scrollHeight;
    if (measured <= 0 || content <= 0) return null;
    return { width: Math.min(CANVAS_TEXT_FIT_MAX_WIDTH, snapUp(measured)), height: snapUp(chrome + content) };
  } finally {
    article.style.width = width;
    article.style.height = height;
  }
}

/** La misura del contenuto disegnato nel corpo: l'immagine, o la pagina del PDF. `null` se non c'è ancora. */
function naturalSize(body: HTMLElement): { width: number; height: number } | null {
  for (const picture of body.querySelectorAll<HTMLImageElement | HTMLCanvasElement>("img, canvas")) {
    const width = picture instanceof HTMLImageElement ? picture.naturalWidth : picture.width;
    const height = picture instanceof HTMLImageElement ? picture.naturalHeight : picture.height;
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

/**
 * Il colore `color` sull'elemento `el` di una scheda o di un filo (T47): la
 * chiave in `data-canvas-color` e, per un colore libero, il suo valore in
 * `--canvas-color`, com'è nel file. L'aspetto lo dà la pelle; un valore che
 * non è un colore non segna niente.
 */
function paintColor(el: HTMLElement | SVGElement, color: string | undefined): void {
  const look = colorLook(color);
  if (look) el.dataset.canvasColor = look.key;
  else delete el.dataset.canvasColor;
  if (look?.custom) el.style.setProperty("--canvas-color", look.custom);
  else el.style.removeProperty("--canvas-color");
}

/**
 * La misura di un'immagine dalla porta, o `null` se non arriva entro
 * `MEASURE_IMAGE_TIMEOUT_MS`, fallisce o non è una misura.
 */
async function measuredImage(
  measure: NonNullable<CanvasEngineOptions["measureImage"]>,
  path: string,
): Promise<{ width: number; height: number } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), MEASURE_IMAGE_TIMEOUT_MS);
  });
  try {
    const size = await Promise.race([measure(path).catch(() => null), late]);
    return size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
      ? { width: size.width, height: size.height }
      : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Un path relativo alla radice del vault, senza risalite né caratteri di controllo. */
function isVaultPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 8192
    && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..")
    && !/[\u0000-\u001f]/u.test(path);
}

function externalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export class CanvasEngine {
  readonly #root: HTMLElement;
  readonly #toolbar: HTMLElement;
  readonly #viewport: HTMLElement;
  readonly #stage: HTMLElement;
  /** I fili, primo figlio dello stage (T91, rotta 4): un gruppo gli sta sotto, le schede sopra. */
  readonly #edgeLayer: SVGSVGElement;
  /** Le prese dei fili scelti, sopra lo stage (T91, rotta 5): il puntatore le prende prima dei punti. */
  readonly #handleLayer: SVGSVGElement;
  readonly #options: CanvasEngineOptions;
  #forms: readonly SyntaxForm[] | undefined;
  readonly #stopLanguage: () => void;
  readonly #abort = new AbortController();
  #doc: CanvasDocument | null = null;
  #source = "";
  #epoch = 0;
  #selection: string[] = [];
  #edgeSelection: string[] = [];
  #camera: Viewport = { x: 0, y: 0, zoom: 1 };
  /** La sola lettura del pannello (`setReadOnly`): i suoi motivi sono del pannello. */
  #panelReadOnly = false;
  /**
   * La sola lettura della tela: il nucleo apre il testo ma non lo sa
   * riscrivere senza perdere qualcosa (una chiave doppia, R3). Si somma a
   * quella del pannello e se ne va da sola quando il testo torna riscrivibile.
   */
  #unwritable = false;
  #undo: CanvasStep[] = [];
  #redo: CanvasStep[] = [];
  /**
   * La versione del testo di adesso. Un testo nuovo (un gesto, un annulla
   * passato dalle toppe, `setDoc`, una `syncDoc` che cambia il testo) ne
   * prende una mai usata da `#versions`; l'annulla e il ripeti che rimettono
   * un tratto byte per byte ridanno al testo la versione che aveva. Una
   * versione dice sempre un testo solo.
   */
  #version = 0;
  #versions = 0;
  /** Le schede sulla scena, per id: sopravvivono a una resa che non le riguarda. */
  readonly #cards = new Map<string, CardEntry>();
  /**
   * Le viste montate, per id, come le legge `updateLiveCards`: la mappa è
   * viva, perché il lavoro rimandato la legge quando gira. Ogni voce avvolge
   * la vista del renderer e, se `setMode` riesce, scrive il modo sulla scheda.
   */
  readonly #views = new Map<string, CardView>();
  /** Il modo che ogni vista montata ha davvero (il `current` di `updateLiveCards`). */
  readonly #liveModes = new Map<string, CardMode>();
  /**
   * La scheda attiva (T14): `enter()` ha detto sì, e il suo contenuto prende
   * puntatore, tastiera e rotella finché non si esce. Una sola alla volta.
   */
  #activeId: string | null = null;
  /** La scheda in cui si sta entrando: la scelta delle vive la accende con le altre. */
  #enteringId: string | null = null;
  /**
   * La scheda sotto l'ultimo `pointerdown`, se era già la sola scelta: il
   * `click` che segue ci entra. Un clic che la sceglie soltanto non entra.
   */
  #pressedSelected: string | null = null;
  /** Il gesto della rotella finisce `WHEEL_SETTLE_MS` dopo l'ultimo scatto. */
  #wheelTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /**
   * Il silenzio della penna come lo vuole `updateLiveCards`. Il lavoro che
   * gira quando la penna si alza non cambia modi a gesto in corso (lo rifà la
   * fine del gesto) e non lascia uscire l'errore di una vista: va in console.
   */
  readonly #cardQuiet: CardQuiet = {
    defer: (key, work) => this.#quiet.defer(key, () => {
      if (this.#destroyed || this.#gestureActive()) return;
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
  #languageRound = 0;
  #formsRound = 0;
  #destroyed = false;
  #intakeError = "";
  /** L'ultimo punto (dello schermo) in cui il puntatore è stato visto sulla vista; `null` se ne è uscito. */
  #pointerSeen: { x: number; y: number } | null = null;
  /** I rettangoli tratteggiati di un trascinamento in corso sopra la vista. */
  #dropGhosts: HTMLElement | null = null;
  #drag: { pointerId: number; startX: number; startY: number; origin: Map<string, { x: number; y: number }>; moved: boolean } | null = null;
  /**
   * Il ridimensionamento in corso (T66): la maniglia `corner`, la cornice di
   * partenza `box` (la scheda, o la cornice della scelta) e le schede che
   * cambiano, ognuna col suo rettangolo di partenza.
   */
  #resize: {
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
  #handleTap: readonly string[] | null = null;
  /** La cornice della scelta con le sue maniglie, con due schede scelte o più (T66). */
  #selectionFrame: HTMLElement | null = null;
  /** Lo zoom con cui si sono contate le schede troppo piccole per quattro maniglie. */
  #handlesZoom = 0;
  /**
   * Lo spostamento della lavagna in corso. `toggle` è la scheda sotto un
   * Ctrl+clic (Cmd+clic): se il puntatore si alza senza essersi mosso, la
   * scheda entra nella scelta o ne esce, come con Maiuscolo.
   */
  #pan: {
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
  #connect: ConnectGesture | null = null;
  /** Il tratto del filo in corso, nello strato dei fili; e la scheda sotto il puntatore. */
  #connectDraft: SVGPathElement | null = null;
  #connectTarget: string | null = null;
  /** Il filo sotto il puntatore, che si scurisce (T67). */
  #edgeHover: string | null = null;
  /**
   * «Collega…» dal menu o C con una scheda scelta (T17): la scheda da cui
   * parte il filo; il prossimo clic su un'altra scheda lo chiude e la
   * colonna torna alla Selezione. Esc o un altro strumento rinunciano.
   */
  #connectFrom: string | null = null;
  /**
   * L'avviso di «Togli dalla lavagna» (T17), col suo «Annulla»: il testo e il
   * passo d'annulla del togliere. Vale finché quel passo è l'ultimo: la
   * modifica dopo lo spegne, così «Annulla» annulla sempre il togliere.
   */
  #removal: { readonly text: string; readonly step: CanvasStep | undefined; readonly undo: boolean } | null = null;
  /**
   * I PDF che non si sono aperti con «Spargi le pagine» (T72), per percorso, con
   * ciò che smette di guardarne il file: il comando resta spento finché il file
   * cambia, sparisce o torna (`watch`), o la lavagna si chiude.
   */
  readonly #pdfBroken = new Map<string, () => void>();
  /** Le dita giù che la lavagna segue, in coordinate del client. */
  readonly #fingers = new Map<number, TouchPoint>();
  /** Il dito che può ancora essere un tocco breve: dove e quando si è posato, e su che cosa. */
  #tap: { pointerId: number; startX: number; startY: number; at: number; target: Element | null; shift: boolean } | null = null;
  /** Il pizzico in corso: le due dita e la camera di quando il secondo si è posato. */
  #pinch: { a: number; b: number; a0: TouchPoint; b0: TouchPoint; start: TouchCamera } | null = null;
  /** «Il dito sposta le schede» dalle Impostazioni, quando non lo passano le opzioni. */
  #fingerMovesCardSetting = false;
  /** «La rotella del mouse» dalle Impostazioni: `pan` di serie, come prima di T35. */
  #wheelSetting: WheelAction = DEFAULT_PREFERENCES.wheel;
  // --- muoversi (T53) ---
  /** Spazio tenuto sulla lavagna: il tasto principale sposta la vista, con qualsiasi strumento. */
  #spaceHeld = false;
  /**
   * Il volo di un salto o l'inerzia del dito: lo stato che `stepCamera`
   * insegue, e il tempo dell'ultimo fotogramma. `null` a vista ferma.
   */
  #motion: { state: MotionState; last: number | null } | null = null;
  #motionFrame: number | undefined = undefined;
  /**
   * Lo scorrimento al bordo mentre si tira una scheda, una maniglia o un filo:
   * l'ultimo punto del puntatore, i tasti tenuti e il tempo dell'ultimo
   * fotogramma. `null` fuori dalla fascia del bordo.
   */
  #edgeScroll: { pointerId: number; clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; last: number | null } | null = null;
  #edgeFrame: number | undefined = undefined;
  /** Il movimento ridotto, di sistema o dalle Impostazioni, letto dal vivo. */
  #reducedMotion = reducedMotion();
  readonly #port: CanvasCorePort;
  /** La lavagna aperta nel nucleo; `null` prima di aprirla o dopo una trappola. */
  #core: CanvasCore | null = null;
  /** Il giro di riapertura dopo una trappola: uno più nuovo rende vecchi gli altri. */
  #revival = 0;
  /** Le trappole di fila senza un commit riuscito in mezzo. */
  #traps = 0;
  #editor: CardEditor | null = null;
  /** La ricerca dei comandi aperta (Ctrl+/, T48): finché c'è, il campo di una scheda non si chiude perdendo il fuoco. */
  #commandSearch: CommandSearchHandle | null = null;
  /** Vero dall'apertura della ricerca alla sua chiusura, anche mentre si apre e prende il fuoco. */
  #searching = false;
  /** L'unico posto del testo di una scheda non ancora registrato. */
  #pending: PendingText | null = null;
  #pauseTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /** Chi possiede l'inchiostro: lo scheduler del silenzio della penna e lo strato. Si chiude in `destroy`. */
  readonly #life: Lifetime = openLifetime();
  /** Il selettore di «Altro…» aperto (T47); si chiude con la vita della lavagna. */
  #colorPicker: PopoverHandle | null = null;
  /** Il lavoro pesante (il ridisegno dopo una modifica da fuori) aspetta che la penna si alzi. */
  readonly #quiet: PenQuiet;
  /** Lo strato della penna; `null` in sola lettura, con la scena troppo grande o senza lavagna (A8). */
  #inkLayer: InkLayer | null = null;
  #inkLife: Lifetime | null = null;
  readonly #inkPaths = new InkPathCache();
  #inkStates: InkStates | null = null;
  /** L'asciutto disegnato adesso: per scheda e sulla radice. */
  #inkCards = new Map<string, readonly DryStroke[]>();
  #inkBoard: readonly DryStroke[] = [];
  #inkChain: InkChain | null = null;
  /** La passata di gomma in corso; `null` se nessuna. */
  #erase: InkErase | null = null;
  /** D tenuto giù sul viewport: il mouse scrive finché non si alza. */
  #inkKeyDown = false;
  // --- a chi appartiene il tratto (T69) ---
  /** Un tratto della punta è appena cominciato: lo spessore e la vista, finché il primo movimento non apre l'etichetta. */
  #inkStarting: { readonly size: number; readonly view: DOMRect } | null = null;
  /** Il tratto in corso e l'ancora mostrata; `null` a penna su. */
  #inkTarget: InkTarget | null = null;
  /** L'ultimo punto della penna che la vista ha visto: da qui parte il riquadro. */
  readonly #inkAt: InkPoint = { pointerId: -1, clientX: 0, clientY: 0 };
  /** Alt tenuto: il tratto resta libero sulla lavagna. */
  #altHeld = false;
  /** Per il lettore di schermo: l'ancora dell'ultimo tratto, detta all'alzata. */
  #inkSaid: HTMLElement | null = null;
  /** L'etichetta e il bordo, tenuti fra un tratto e l'altro. */
  #inkMarks: InkMarks | null = null;
  // --- copia e incolla (T68) ---
  /** «Copia» o «Taglia» del menu mentre manda la copia del browser: l'evento è nostro anche col fuoco nel menu. */
  #clipboardCommand: "copy" | "cut" | null = null;
  /** L'ultimo incolla delle schede di Fub: lo stesso testo nello stesso punto si sfalsa di nuovo. */
  #lastPaste: { readonly raw: string; readonly x: number; readonly y: number; readonly count: number } | null = null;
  /** L'ultimo Ctrl+D: le schede di partenza e le copie, nello stesso ordine; il prossimo ne ripete lo spostamento. */
  #lastDuplicate: { readonly sources: readonly string[]; readonly copies: readonly string[] } | null = null;
  /**
   * Lo strumento della colonna (T49): che cosa fa il mouse sulla lavagna. Con
   * Penna, Evidenziatore o Gomma il mouse scrive con la penna del menu, ed è
   * lo stesso stato dell'interruttore «Scrivi col mouse» (`setInkMouse`).
   */
  #tool: CanvasToolId = "select";
  /** La colonna degli strumenti, a sinistra della lavagna o sotto (stretta). */
  readonly #rail: CanvasRail;
  /** La lavagna vuota (T62): al centro, quando non c'è niente. */
  readonly #empty: CanvasEmpty;
  /** Quante volte l'interruttore è cambiato: lo stato ricordato arriva solo se nessuno l'ha toccato prima. */
  #inkMouseTurns = 0;
  /** Il pulsante «Scrivi col mouse»: lo stesso elemento in ogni barra. */
  readonly #inkMouseButton: HTMLButtonElement;
  /**
   * La penna scelta nel menu (A19): strumento, penna, colore, spessore e che
   * cosa cancella la gomma (`setInkEraser`, di serie il tratto intero, A20).
   */
  #penChoice: InkPenChoice = DEFAULT_INK_CHOICE;
  /** Quante volte la penna è cambiata: quella ricordata arriva solo se nessuno l'ha scelta prima. */
  #penTurns = 0;
  /** Il menu della penna, nella riga delle opzioni: il suo pulsante è sempre lo stesso. */
  readonly #penMenu: PenMenu;
  /**
   * La riga delle opzioni sopra la lavagna (T50): le opzioni dello strumento
   * e delle schede scelte, o la barra di una scheda in scrittura.
   */
  readonly #canvasOptions: CanvasOptions;
  /** Le punte dei fili che lo strumento Collega tira (T50); di serie alla fine. */
  #tips: CanvasTip = "end";
  /** La vista ricordata su questo computer (T36); `null` senza memoria o senza lavagna. */
  readonly #viewMemo: CanvasViewRecorder | null;
  /** Cresce a ogni `setDoc`: la vista letta per un'apertura di prima non vale più. */
  #viewRound = 0;
  /**
   * La camera e la scelta subito dopo l'apertura, finché la vista ricordata
   * non arriva: la prende solo ciò che nessuno ha cambiato nel frattempo.
   * `null` prima che la lavagna si mostri, e dopo che la vista è arrivata.
   */
  #openView: { readonly camera: Viewport; readonly selection: string; readonly navigatorHidden: boolean } | null = null;
  /** La vista letta prima che il nucleo aprisse il testo: la prende `#revive`. */
  #heldView: { readonly round: number; readonly view: CanvasView } | null = null;
  /**
   * La firma delle voci della banda che la shell ha: si avvisa solo se cambia.
   * `#attachmentDeclared` è `files.attachment-folder` com'è scritto (`null`
   * finché non arriva, o se non è un testo): la banda mostra la cartella del deposito.
   */
  #statusShown = "";
  #attachmentDeclared: string | null = null;
  /** Il navigatore (T55), in basso a destra della vista. */
  readonly #navigator: CanvasNavigator;
  /** «Nascondi il navigatore» per questa lavagna (T55): si ricorda nella vista (T36). */
  #navigatorHidden = false;
  /** `canvas.drop_folder` e il suo percorso (T34), dal vivo; `null` finché non arriva. */
  #dropChoice: DropFolderChoice | null = null;

  constructor(parent: HTMLElement, options: CanvasEngineOptions) {
    this.#options = options;
    this.#viewMemo = options.viewMemory && options.documentId
      ? new CanvasViewRecorder(options.viewMemory, options.documentId, () => this.#viewSnapshot())
      : null;
    this.#quiet = new PenQuiet(idleSchedule(this.#life));
    this.#life.add(() => this.#quiet.dispose());
    if (!options.fingerMovesCard) {
      this.#life.add(watchPreferences((preferences) => {
        this.#fingerMovesCardSetting = preferences.fingerMovesCard;
      }));
    }
    // La rotella segue «La rotella del mouse» a ogni cambio: vale dallo scatto
    // dopo. La colonna segue quella scelta nelle Impostazioni
    // (`canvas.toolbar`), dal vivo; la lettura arriva dopo il costruttore.
    this.#life.add(watchPreferences((preferences) => {
      this.#wheelSetting = preferences.wheel;
      this.#rail.setToolbar(preferences.toolbar);
      this.#dropChoice = { dropFolder: preferences.dropFolder, dropFolderPath: preferences.dropFolderPath };
      this.#statusSettle();
    }));
    this.#port = options.core ?? SHARED_CORE;
    // La cartella dei file trascinati arriva da `files.attachment-folder`, letta
    // una volta: la banda la mostra quando arriva. Una lettura che fallisce
    // lascia la cartella di serie.
    void readAttachmentFolder().then((declared) => {
      this.#attachmentDeclared = declared;
      this.#statusSettle();
    }, () => undefined);
    this.#root = document.createElement("div");
    this.#root.className = "canvas-surface";
    this.#toolbar = document.createElement("div");
    this.#toolbar.className = "canvas-toolbar";
    this.#toolbar.setAttribute("role", "toolbar");
    this.#toolbar.setAttribute("aria-label", t("canvas.surface"));
    this.#viewport = document.createElement("div");
    this.#viewport.className = "canvas-viewport";
    this.#viewport.tabIndex = 0;
    this.#viewport.setAttribute("role", "application");
    this.#viewport.setAttribute("aria-label", t("canvas.surface"));
    this.#stage = document.createElement("div");
    this.#stage.className = "canvas-stage";
    // I fili sono il primo figlio dello stage, nella stessa pila delle schede
    // (T91, rotta 4): sotto le schede, ma sopra lo sfondo di un gruppo, che CSS
    // mette sotto. Lo stage ha la camera; il filo non ne ha una sua.
    this.#edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.#edgeLayer.classList.add("canvas-edges");
    this.#edgeLayer.setAttribute("aria-hidden", "true");
    this.#stage.append(this.#edgeLayer);
    // Le prese dei fili scelti stanno sopra lo stage, così il puntatore le
    // prende prima dei punti delle schede che le coprono (T91, rotta 5).
    this.#handleLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.#handleLayer.classList.add("canvas-edge-handles");
    this.#handleLayer.setAttribute("aria-hidden", "true");
    this.#viewport.append(this.#stage, this.#handleLayer);
    // Il corpo: la colonna degli strumenti (T49) e l'area della lavagna, come
    // il corpo del disegno. Stretta, la colonna va sotto, in riga.
    this.#rail = createCanvasRail({
      tool: () => this.#tool,
      pick: (tool) => {
        this.#recordPending();
        this.#pickTool(tool);
      },
      editable: () => !this.#readOnly && !this.#isSceneOversized(),
      toolbar: currentPreferences().toolbar,
      lifetime: this.#life,
    });
    // La lavagna vuota (T62) è un fratello della vista, non un suo figlio: i
    // suoi pulsanti non passano dal puntatore della vista.
    this.#empty = createCanvasEmpty({
      lifetime: this.#life,
      write: () => this.#placeText(),
      receive: (data) => this.#receive(data),
      addFiles: options.attachments !== undefined && options.documentId !== undefined,
    });
    // Il navigatore (T55): un fratello della vista, come la lavagna vuota; un
    // clic è un salto (`#jumpCamera`), un trascinamento sposta la vista.
    this.#navigator = createCanvasNavigator({
      lifetime: this.#life,
      nodes: () => (this.#doc && !this.#isSceneOversized() ? this.#doc.nodes : null),
      view: () => {
        const rect = this.#viewport.getBoundingClientRect();
        return { camera: { ...this.#camera }, width: rect.width || 800, height: rect.height || 600 };
      },
      enabled: () => !this.#navigatorHidden,
      jump: (camera) => this.#jumpCamera(camera),
      pan: (camera) => {
        this.#stopMotion(false);
        this.#camera = { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom) };
        this.#applyCamera();
      },
      settled: () => {
        this.#refreshLive();
        this.#statusSettle();
      },
    });
    const area = document.createElement("div");
    area.className = "canvas-area";
    area.append(this.#viewport, this.#empty.element, this.#navigator.element);
    const body = document.createElement("div");
    body.className = "canvas-body";
    body.append(this.#rail.element, area);
    this.#root.append(this.#toolbar, body);
    this.#viewport.dataset.tool = this.#tool;
    // I due comandi dell'inchiostro, in testa alla barra e gli stessi in ogni
    // barra: il menu della penna (il rialzo aperto non si stacca quando la
    // barra si rifà) e l'interruttore «Scrivi col mouse», che tiene il fuoco
    // dopo il clic, così chi usa la tastiera sente lo stato nuovo.
    // Il selettore di «Altro…» (T47) non resta aperto senza la lavagna.
    this.#life.add(() => this.#colorPicker?.close());
    this.#penMenu = createPenMenu({
      lifetime: this.#life,
      choice: () => this.#penChoice,
      choose: (next, settled) => this.#choosePen(next, settled),
      editable: () => !this.#readOnly && !this.#isSceneOversized(),
      theme: () => ((this.#root.dataset.theme ?? options.theme) === "dark" ? "dark" : "light"),
    });
    // La testata, sopra la barra di N4 e la lavagna: la riga delle opzioni
    // (T50), col menu della penna dentro.
    this.#canvasOptions = createCanvasOptions({
      lifetime: this.#life,
      tool: () => this.#tool,
      chosen: () => this.#selectedNodes().length,
      color: () => this.#chosenColor(),
      tips: () => this.#tips,
      commands: () => this.commands(),
      run: (id) => {
        this.#recordPending();
        const command = this.commands().find((one) => one.id === id);
        if (command && command.disabled() === null) command.run();
      },
      penMenu: this.#penMenu,
      swatches: () => this.#colorSwatches(),
    });
    const header = document.createElement("div");
    header.className = "canvas-header";
    header.append(this.#canvasOptions.element);
    this.#toolbar.before(header);
    const inkMouse = document.createElement("button");
    inkMouse.type = "button";
    inkMouse.dataset.canvasAction = "ink-mouse";
    this.#life.listen(inkMouse, "click", (event) => {
      event.preventDefault();
      this.#recordPending();
      this.#toggleInkMouse();
    });
    this.#inkMouseButton = inkMouse;
    parent.replaceChildren(this.#root);
    this.#stopLanguage = onLanguage(() => {
      // I corpi di sempre hanno parole: alla prossima resa si rifanno.
      this.#languageRound++;
      this.#viewport.setAttribute("aria-label", t("canvas.surface"));
      this.#toolbar.setAttribute("aria-label", t("canvas.surface"));
      this.#drawToolbar();
      this.#rail.relabel();
      this.#empty.relabel();
      this.#navigator.relabel();
      this.#canvasOptions.sync();
    });
    // I tasti degli strumenti valgono anche col fuoco sulla colonna (dopo un
    // clic su una casella); gli altri tasti lì sono della colonna.
    this.#life.listen(this.#rail.element, "keydown", (event) => this.#railKeydown(event));
    const signal = this.#abort.signal;
    this.#viewport.addEventListener("pointerdown", (event) => this.#pointerDown(event), { signal });
    this.#viewport.addEventListener("pointermove", (event) => this.#pointerMove(event), { signal });
    // A fine gesto (e dopo ogni tasto) la banda di stato si rilegge: dentro un
    // gesto `#statusSettle` non dice niente.
    this.#viewport.addEventListener("pointerup", (event) => {
      this.#pointerUp(event);
      this.#statusSettle();
    }, { signal });
    // La vista che cambia misura, o che torna in vista da un'altra linguetta
    // (da zero alla sua misura), rifà la scelta delle schede vive. La vista
    // cambia misura anche quando cambia quella della superficie: allora la
    // colonna va sotto la lavagna, o torna di lato (`#syncNarrow`).
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        this.#syncNarrow();
        this.#refreshLive();
        // La lavagna può stare tutta nella vista nuova, o non più (T55).
        this.#statusSettle();
      });
      observer.observe(this.#viewport);
      this.#life.add(() => observer.disconnect());
    }
    this.#viewport.addEventListener("pointercancel", (event) => {
      if (event.pointerType === "touch") this.#fingers.delete(event.pointerId);
      this.#cancelGestures();
    }, { signal });
    this.#viewport.addEventListener("wheel", (event) => this.#wheel(event), { signal, passive: false });
    this.#viewport.addEventListener("keydown", (event) => {
      this.#keydown(event);
      this.#statusSettle();
    }, { signal });
    // D lasciato ovunque, la finestra che perde il fuoco o si nasconde: il
    // mouse torna a selezionare.
    this.#life.listen(window, "keyup", (event) => {
      if (isInkKey(event)) this.#releaseInkKey();
    });
    this.#life.listen(window, "blur", () => this.#releaseInkKey());
    this.#life.listen(document, "visibilitychange", () => this.#releaseInkKey());
    // Muoversi (T53). Spazio lasciato ovunque, o la finestra che perde il
    // fuoco: il tasto principale torna allo strumento. Con la finestra che
    // perde il fuoco l'inerzia e lo scorrimento al bordo si fermano, e un
    // volo arriva dove andava.
    this.#life.listen(window, "keyup", (event) => {
      if (event.key === " ") this.#releaseSpace();
    });
    this.#life.listen(window, "blur", () => this.#stillCamera());
    this.#life.listen(document, "visibilitychange", () => {
      if (document.hidden) this.#stillCamera();
    });
    this.#life.add(onReducedMotionChange((reduced) => {
      this.#reducedMotion = reduced;
      // Cambiato a lavagna aperta: un volo arriva subito, l'inerzia si ferma.
      if (reduced) this.#stopMotion(true);
    }));
    this.#life.add(() => {
      this.#stopMotion(false);
      this.#stopEdgeScroll();
    });
    // Prima dello strato della penna, che ferma i suoi eventi: ogni
    // appoggio, anche della penna, ferma la vista che scorre da sola.
    this.#viewport.addEventListener("pointerdown", () => this.#stopMotion(false), { signal, capture: true });
    this.#viewport.addEventListener("dblclick", (event) => this.#dblclick(event), { signal });
    // Prima del contenuto delle schede: fuori da una scheda attiva il clic
    // sceglie, entra, o segue un link con Ctrl, e non arriva al contenuto.
    this.#viewport.addEventListener("click", (event) => this.#cardClick(event), { signal, capture: true });
    // Dove si incolla: l'ultimo punto visto sulla vista, finché il puntatore
    // non ne esce.
    this.#viewport.addEventListener("pointermove", (event) => {
      this.#pointerSeen = { x: event.clientX, y: event.clientY };
    }, { signal });
    // A chi appartiene il tratto (T69). L'appoggio si legge in cattura, prima
    // dello strato della penna che lo ferma: è solo un punto. I movimenti si
    // leggono dopo, quando la scia è già disegnata; Alt si legge ovunque.
    this.#viewport.addEventListener("pointerdown", (event) => this.#inkSeen(event), { signal, capture: true });
    this.#viewport.addEventListener("pointermove", (event) => this.#inkTargetMove(event), { signal });
    this.#life.listen(window, "keydown", (event) => {
      if (event.key === "Alt") this.#setAltHeld(true);
    });
    this.#life.listen(window, "keyup", (event) => {
      if (event.key === "Alt") this.#setAltHeld(false);
    });
    this.#life.listen(window, "blur", () => this.#setAltHeld(false));
    this.#viewport.addEventListener("pointerleave", () => {
      this.#pointerSeen = null;
      // Il puntatore fuori dalla lavagna: nessun filo si scurisce (T67).
      this.#setEdgeHover(null);
    }, { signal });
    this.#viewport.addEventListener("dragover", (event) => {
      if (!this.#readOnly && !this.#isSceneOversized() && event.dataTransfer
        && (this.#options.attachments || event.dataTransfer.types.includes("text/plain"))) {
        event.preventDefault();
        this.#showDropGhosts(event);
      }
    }, { signal });
    this.#viewport.addEventListener("dragleave", (event) => {
      // Passare da un figlio all'altro della vista non è uscire.
      const next = event.relatedTarget;
      if (next instanceof Node && this.#viewport.contains(next)) return;
      this.#hideDropGhosts();
    }, { signal });
    this.#viewport.addEventListener("drop", (event) => {
      this.#hideDropGhosts();
      void this.#intake(event).catch((error: unknown) => this.#showIntakeError(error));
    }, { signal });
    this.#viewport.addEventListener("paste", (event) => {
      void this.#intake(event).catch((error: unknown) => this.#showIntakeError(error));
    }, { signal });
    // Copia, taglia e incolla delle schede (T68). Il browser manda l'evento a
    // chi ha il fuoco o alla selezione di testo, che può stare altrove (il
    // corpo della pagina): si ascolta il documento e si guarda il fuoco.
    this.#life.listen(document, "copy", (event) => this.#copyEvent(event, false));
    this.#life.listen(document, "cut", (event) => this.#copyEvent(event, true));
    this.#life.listen(document, "paste", (event) => this.#pasteFromOutside(event));
    this.#drawToolbar();
    this.#restoreInkMouse(options.inkMouseMemory ?? SHARED_INK_MOUSE);
    this.#restorePen(options.penMemory ?? SHARED_PEN);
  }

  /**
   * Apre il testo `source` nel nucleo, da capo: la storia dell'annulla
   * ricomincia. Un testo che il nucleo non apre lancia, e la tela resta com'era.
   */
  setDoc(source: string): void {
    if (this.#destroyed) return;
    // Il testo in sospeso è del documento di prima: si registra lì.
    this.#closeField(true);
    const document = this.#open(source);
    // La vista di prima si scrive adesso, poi si legge quella ricordata
    // (T36): arriva dopo, e prende ciò che nessuno ha toccato.
    const remembered = this.#viewMemo?.begin();
    const viewRound = ++this.#viewRound;
    this.#openView = null;
    this.#heldView = null;
    if (remembered) void remembered.then((view) => this.#restoreView(viewRound, view));
    // Un documento nuovo: la risposta di prima era dell'altro testo.
    if (this.#unwritable) {
      this.#unwritable = false;
      this.#root.dataset.readOnly = String(this.#readOnly);
    }
    this.#epoch++;
    this.#cancelGestures();
    // Un documento nuovo: il tratto in corso era dell'altro.
    this.#inkLayer?.cancel();
    this.#inkChain = null;
    this.#source = source;
    this.#version = ++this.#versions;
    this.#doc = document;
    this.#intakeError = "";
    this.#removal = null;
    this.#connectFrom = null;
    // Un documento nuovo: si esce dalla scheda dell'altro.
    this.#leaveCard(false, false);
    this.#selection = [];
    this.#edgeSelection = [];
    this.#undo = [];
    this.#redo = [];
    this.#statusSettle();
    this.#syncEmpty();
    if (!document) {
      void this.#revive();
      return;
    }
    this.#checkWritable();
    this.#fitCamera(false);
    this.#render();
    this.#markOpenView();
  }

  /**
   * Il testo cambiato da un'altra parte (un'altra superficie, un altro
   * programma). Il campo aperto resta aperto, e il suo testo in sospeso si
   * registra subito dopo, sulla scheda com'è nel testo nuovo.
   */
  syncDoc(update: { readonly text: string; readonly operation: TextOperation | null } | string): void {
    if (this.#destroyed) return;
    const source = typeof update === "string" ? update : update.text;
    const document = this.#open(source);
    this.#cancelGestures();
    this.#epoch++;
    this.#intakeError = "";
    // Lo stesso testo (l'eco di un commit di qui) lascia valida la via del tratto.
    const changed = source !== this.#source;
    if (changed) this.#version = ++this.#versions;
    // Un testo cambiato altrove è una modifica dopo il togliere (T17).
    if (changed) this.#removal = null;
    this.#source = source;
    if (!document) {
      void this.#revive();
      return;
    }
    this.#doc = document;
    // Lo stesso testo si riscrive come prima: la domanda serve solo a un testo nuovo.
    if (changed) this.#checkWritable();
    this.#pruneSelection();
    // Modello e sorgente sono già quelli nuovi; il ridisegno, con una penna
    // giù, aspetta che si alzi (A9). Il tratto in corso non si perde: la
    // scheda si sceglie sul documento del momento in cui la penna si alza.
    this.#quiet.defer("render", () => {
      if (!this.#destroyed) this.#render();
    });
    // Fuori dalla consegna che ci ha portato il testo: la sessione la sta
    // ancora facendo agli altri riquadri.
    if (this.#pending) queueMicrotask(() => this.#deferPending());
  }

  getDoc(): string {
    return this.#source;
  }

  focus(): void {
    if (!this.#destroyed) this.#viewport.focus();
  }

  /**
   * Brings into view the card whose source holds `byteOffset` (UTF-8 bytes,
   * the currency of the model's spans): selects it and frames it. `false`
   * when the offset is outside every card, or the scene is too large to draw.
   */
  revealSource(byteOffset: number): boolean {
    if (this.#destroyed || !this.#doc || !this.#core || this.#isSceneOversized()) return false;
    let index: number | null;
    try {
      index = this.#core.nodeAt(byteOffset);
    } catch (error) {
      if (lostCore(error)) this.#lose();
      return false;
    }
    const node = index === null ? undefined : this.#doc.nodes[index];
    if (!node) return false;
    this.#closeField(false);
    this.#cancelGestures();
    this.#selection = [node.id];
    this.#edgeSelection = [];
    this.#fitCamera(false, [node]);
    this.#render();
    this.#viewport.focus();
    this.#options.onSelectionChange();
    return true;
  }

  setReadOnly(readOnly: boolean): void {
    // In sola lettura il campo si chiude comunque: ciò che non si registra
    // l'avviso l'ha già detto.
    this.#closeField(readOnly);
    this.#cancelGestures();
    this.#panelReadOnly = readOnly;
    this.#root.dataset.readOnly = String(this.#readOnly);
    this.#render();
    this.#statusSettle();
  }

  /** In sola lettura per il pannello o per la tela: nessun gesto cambia il testo. */
  get #readOnly(): boolean {
    return this.#panelReadOnly || this.#unwritable;
  }

  /**
   * Chiede al nucleo se il testo di adesso si riscrive: un'anteprima senza
   * toppe passa dallo stesso ritocco di ogni commit, e un testo che il
   * ritocco rifiuta (una chiave doppia, anche annidata in un campo
   * sconosciuto) risponde `rejected`. Allora la tela resta da guardare: il
   * campo aperto si chiude come per la sola lettura del pannello, e l'avviso
   * della barra dice perché. Un nucleo assente o morto non risponde: la
   * risposta di prima resta finché `#revive` non riapre il testo.
   */
  #checkWritable(): void {
    const core = this.#core;
    if (!core) return;
    let unwritable: boolean;
    try {
      core.preview([]);
      unwritable = false;
    } catch (error) {
      if (lostCore(error)) {
        this.#lose();
        return;
      }
      if (!(error instanceof CanvasCoreError)) throw error;
      unwritable = error.code === "rejected";
    }
    if (unwritable === this.#unwritable) return;
    if (unwritable) {
      this.#unwritable = true;
      this.#closeField(true);
      this.#cancelGestures();
    } else {
      this.#unwritable = false;
    }
    this.#root.dataset.readOnly = String(this.#readOnly);
    // Subito, anche con una penna giù e il ridisegno rimandato: lo strato se
    // ne va (il tratto in corso si annulla) o torna, e la barra dice perché.
    this.#syncInkLayer();
    this.#drawToolbar();
  }

  setTheme(theme: Theme): void {
    this.#root.dataset.theme = theme;
    // I campioni che si leggono poco lo dicono per il tema di adesso (A23).
    this.#penMenu.sync();
  }

  /**
   * Le sintassi del Markdown delle card, com'è montato in questo vault. Una
   * card in modifica tiene il suo editor: la resa nuova arriva col disegno
   * successivo.
   */
  setSyntaxForms(forms: readonly SyntaxForm[]): void {
    this.#forms = forms;
    this.#formsRound++;
    if (!this.#editor) this.#render();
  }

  /**
   * Annulla l'ultimo passo: il testo di prima byte per byte se nessuno l'ha
   * cambiato nel frattempo, se no le toppe inverse che il nucleo ha dato al
   * suo commit.
   */
  undo(): boolean {
    // Con una penna giù annulla e ripeti non fanno niente (A5).
    if (this.#penDown) return false;
    const editing = this.#editor !== null;
    if (!this.#closeField(false)) return false;
    if (editing) this.#render();
    const step = this.#undo.pop();
    if (!step || !this.#doc) return false;
    if (this.#replay(step, "undo", (again) => this.#redo.push(again)) !== true) {
      this.#undo.push(step);
      return false;
    }
    return true;
  }

  /** Rifà il passo annullato, con le stesse due vie dell'annulla. */
  redo(): boolean {
    if (this.#penDown) return false;
    const editing = this.#editor !== null;
    if (!this.#closeField(false)) return false;
    if (editing) this.#render();
    const step = this.#redo.pop();
    if (!step || !this.#doc) return false;
    if (this.#replay(step, "redo", (again) => this.#pushUndo(again, false)) !== true) {
      this.#redo.push(step);
      return false;
    }
    return true;
  }

  destroy(): void {
    if (this.#destroyed) return;
    // Il testo in sospeso va nel documento che il riquadro mostrava.
    this.#closeField(true);
    // L'ultima vista si scrive adesso; dopo, nessuna scrittura parte più.
    this.#viewMemo?.close();
    this.#destroyed = true;
    clearTimeout(this.#pauseTimer);
    this.#pauseTimer = undefined;
    clearTimeout(this.#wheelTimer);
    this.#wheelTimer = undefined;
    this.#revival++;
    // Un tratto in corso si perde senza errori: lo strato lo annulla, e la
    // vita chiude lo scheduler e ciò che il silenzio della penna teneva.
    this.#syncInkLayer();
    this.#life.close();
    this.#dropCore();
    // Ogni vista si distrugge qui, una volta: `#releaseBody` la dimentica.
    this.#dropCards();
    // I PDF guasti smettono di guardare i loro file (T72).
    for (const stop of this.#pdfBroken.values()) stop();
    this.#pdfBroken.clear();
    this.#stopLanguage();
    this.#abort.abort();
    this.#root.remove();
  }

  #isSceneOversized(): boolean {
    return !!this.#doc && (this.#doc.nodes.length > MAX_INTERACTIVE_NODES
      || this.#doc.edges.length > MAX_INTERACTIVE_EDGES);
  }

  // --- il nucleo --------------------------------------------------------------

  /**
   * Il modello del testo `text` nel nucleo: `reset` della lavagna aperta, o
   * una lavagna nuova. `null` se il nucleo non è carico o è morto (allora
   * serve `#revive`); un testo che il nucleo rifiuta lancia.
   */
  #open(text: string): CanvasDocument | null {
    if (this.#core) {
      try {
        return this.#core.reset(text);
      } catch (error) {
        if (!lostCore(error)) throw error;
        this.#dropCore();
      }
    }
    let core: CanvasCore | null;
    try {
      core = this.#port.openNow(text);
    } catch (error) {
      if (lostCore(error)) return null;
      throw error;
    }
    if (!core) return null;
    this.#core = core;
    return core.model();
  }

  /** Il modello del nucleo; `null` se non c'è o se è appena morto (allora si riapre). */
  #coreModel(): CanvasDocument | null {
    const core = this.#core;
    if (!core) return null;
    try {
      return core.model();
    } catch (error) {
      if (!lostCore(error)) throw error;
      this.#lose();
      return null;
    }
  }

  #dropCore(): void {
    const core = this.#core;
    this.#core = null;
    try {
      core?.close();
    } catch {
      // Un'istanza morta ha già perso le sue lavagne.
    }
  }

  /** Una trappola: la lavagna si riapre su un'istanza nuova, dal testo della sessione. */
  #lose(): void {
    this.#dropCore();
    this.#traps += 1;
    // Due di fila: lo si dice, e si riprova soltanto al prossimo testo.
    if (this.#traps > 1) {
      this.#coreUnavailable();
      return;
    }
    void this.#revive();
  }

  async #revive(): Promise<void> {
    const revival = ++this.#revival;
    try {
      await this.#port.ready();
    } catch {
      if (!this.#destroyed && revival === this.#revival) this.#coreUnavailable();
      return;
    }
    if (this.#destroyed || revival !== this.#revival || this.#core) return;
    let document: CanvasDocument | null;
    try {
      document = this.#open(this.#source);
    } catch {
      document = null;
    }
    if (!document) {
      this.#coreUnavailable();
      return;
    }
    const first = this.#doc === null;
    this.#doc = document;
    this.#checkWritable();
    this.#pruneSelection();
    if (first) this.#fitCamera(false);
    this.#render();
    if (first) {
      this.#markOpenView();
      const held = this.#heldView;
      if (held) this.#restoreView(held.round, held.view);
    }
    if (this.#pending) this.#recordPending();
  }

  #coreUnavailable(): void {
    this.#showNotice(t("canvas.core_unavailable"));
  }

  /**
   * Passa le toppe al nucleo: tutte o nessuna. Il testo nuovo è il tratto che
   * il nucleo ha cambiato; `record` riceve il passo che lo disfa (le toppe
   * inverse dello stesso commit e il tratto di prima) prima che la sessione
   * sappia della modifica (che può tornare qui con un `syncDoc`). Il codice
   * del rifiuto, se il nucleo rifiuta.
   */
  #commitLocal(
    patches: readonly CanvasPatch[],
    origin: EditorChangeOrigin,
    record: ((step: CanvasStep) => void) | null,
    render = true,
  ): true | CanvasCoreErrorCode {
    // Mai una lista vuota: su un sorgente vuoto il nucleo riscriverebbe tutto.
    if (!patches.length) return "request";
    if (this.#destroyed || !this.#doc || this.#readOnly || this.#isSceneOversized()) return "rejected";
    const core = this.#core;
    if (!core) return "trap";
    const before = this.#source;
    let committed: { readonly edit: CanvasSourceEdit; readonly inverse: CanvasPatch[] };
    try {
      committed = core.commit(patches);
    } catch (error) {
      if (lostCore(error)) {
        this.#lose();
        return "trap";
      }
      if (error instanceof CanvasCoreError) return error.code;
      throw error;
    }
    this.#traps = 0;
    const { edit } = committed;
    const after = before.slice(0, edit.start) + edit.text + before.slice(edit.end);
    const restores = this.#version;
    this.#source = after;
    this.#version = ++this.#versions;
    this.#doc = this.#coreModel() ?? this.#doc;
    // Una modifica nuova: l'avviso di un togliere di prima se ne va (T17).
    this.#dropRemoval();
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
      version: this.#version,
      restores,
    });
    this.#pruneSelection();
    if (render) this.#render();
    this.#options.onChange({ text: after, operation, origin });
    return true;
  }

  /**
   * Fa un passo d'annulla o di ripeti. Se il testo è quello che il passo ha
   * lasciato, rimette il suo tratto con un `reset` sul testo esatto (una
   * lettura intera: va bene per un annulla, non per ogni gesto); se no passa
   * le sue toppe al nucleo. `record` riceve il passo opposto.
   */
  #replay(step: CanvasStep, origin: "undo" | "redo", record: (step: CanvasStep) => void): true | CanvasCoreErrorCode {
    const before = this.#source;
    const end = step.start + step.inserted.length;
    // Un passo fatto solo di tratti cambia solo l'inchiostro: si ridisegna lo
    // strato, non le schede.
    const inkOnly = step.patches.length > 0 && step.patches.every((patch) => patch.kind === "ink");
    if (step.version !== this.#version || before.slice(step.start, end) !== step.inserted) {
      const code = this.#commitLocal(step.patches, origin, record, !inkOnly);
      if (code === true && inkOnly) this.#paintInk();
      return code;
    }
    if (this.#destroyed || !this.#doc || this.#readOnly || this.#isSceneOversized()) return "rejected";
    const core = this.#core;
    if (!core) return "trap";
    const after = before.slice(0, step.start) + step.removed + before.slice(end);
    let document: CanvasDocument;
    try {
      document = core.reset(after);
    } catch (error) {
      if (lostCore(error)) {
        this.#lose();
        return "trap";
      }
      // Il nucleo non riapre il testo di prima (non dovrebbe mai): restano le toppe.
      if (error instanceof CanvasCoreError) {
        const code = this.#commitLocal(step.patches, origin, record, !inkOnly);
        if (code === true && inkOnly) this.#paintInk();
        return code;
      }
      throw error;
    }
    this.#traps = 0;
    this.#source = after;
    this.#version = step.restores;
    this.#doc = document;
    this.#dropRemoval();
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
    this.#pruneSelection();
    if (inkOnly) this.#paintInk();
    else this.#render();
    this.#options.onChange({ text: after, operation, origin });
    return true;
  }

  /** Un gesto della tela: prima il testo in sospeso, poi le sue toppe, un passo d'annulla. */
  #commit(patches: readonly CanvasPatch[], origin: EditorChangeOrigin): boolean {
    this.#recordPending();
    return this.#commitLocal(patches, origin, (step) => this.#pushUndo(step, true)) === true;
  }

  #pushUndo(step: CanvasStep, fresh: boolean): void {
    this.#undo.push(step);
    if (this.#undo.length > MAX_CANVAS_HISTORY) this.#undo.shift();
    if (fresh) this.#redo = [];
  }

  // --- il testo di una scheda ---------------------------------------------------

  /**
   * Registra il testo in sospeso: un commit, una modifica alla sessione, un
   * passo d'annulla. `false` se resta da registrare (il nucleo l'ha rifiutato:
   * il testo resta nel campo, e l'avviso dice perché).
   */
  #recordPending(): boolean {
    clearTimeout(this.#pauseTimer);
    this.#pauseTimer = undefined;
    const pending = this.#pending;
    if (!pending) return true;
    if (!this.#doc || this.#readOnly || this.#destroyed) return false;
    let code = "rejected" as true | CanvasCoreErrorCode;
    for (let attempt = 0; attempt < 2 && code !== true; attempt++) {
      const doc: CanvasDocument = this.#doc;
      // La scheda com'è adesso; se non c'è più, com'era, col testo del campo.
      const current = doc.nodes.find((node) => node.id === pending.card.id);
      if (current) pending.card = current;
      const next = { ...pending.card };
      next[pending.field] = pending.text;
      const patch = upsertNodePatch(doc, next);
      if (!patch) {
        this.#setPending(null);
        return true;
      }
      code = this.#commitLocal([patch], "input", (step) => {
        this.#setPending(null);
        this.#pushUndo(step, true);
      });
      // Il testo è cambiato da un'altra parte: si riprova sulla scheda di adesso.
      const fresh = code === "stale" ? this.#coreModel() : null;
      if (!fresh) break;
      this.#doc = fresh;
    }
    if (code === true) {
      if (this.#intakeError) this.#showNotice("");
      return true;
    }
    if (code === "invalid" || code === "limit") {
      this.#showNotice(t(pending.field === "text" && utf8.encode(pending.text).length > MAX_CARD_TEXT_BYTES
        ? "canvas.card_too_long" : "canvas.card_invalid"));
    }
    return false;
  }

  /**
   * Chiude il campo aperto, dopo averne registrato il testo. Se il nucleo lo
   * rifiuta il campo resta aperto col suo testo, a meno di `force` (la
   * superficie si chiude, o diventa di sola lettura): allora quel testo si
   * perde, e l'avviso l'ha già detto.
   */
  #closeField(force: boolean): boolean {
    const recorded = this.#recordPending();
    if (!recorded && !force) return false;
    this.#setPending(null);
    const editor = this.#editor;
    if (!editor) return true;
    this.#editor = null;
    editor.lifetime.abort();
    editor.input.disabled = true;
    return true;
  }

  /** Esc, Invio, l'uscita dal campo: registra e chiude. */
  #leaveField(focus: boolean): void {
    if (!this.#closeField(false)) return;
    this.#render();
    if (focus) this.#viewport.focus();
  }

  #setPending(next: PendingText | null): void {
    const had = this.#pending !== null;
    this.#pending = next;
    // Ogni tasto conta: la sessione arma la bozza su ogni cambio, non solo sul primo.
    if (next || had) this.#options.onPendingChange?.(next !== null);
  }

  /**
   * Il testo intero del documento col testo in sospeso dentro, come lo
   * scriverebbe il commit, senza cambiare la lavagna; `null` se non c'è testo
   * in sospeso o il nucleo non lo prende (allora vale l'ultimo testo accettato,
   * e lo si annota nel registro).
   */
  pendingText(): string | null {
    const pending = this.#pending;
    if (!pending || this.#destroyed || !this.#doc) return null;
    const core = this.#core;
    if (!core) return null;
    let doc: CanvasDocument = this.#doc;
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = doc.nodes.find((node) => node.id === pending.card.id);
      const next = { ...(current ?? pending.card) };
      next[pending.field] = pending.text;
      const patch = upsertNodePatch(doc, next);
      // Il campo dice ciò che la lavagna ha già.
      if (!patch) return this.#source;
      try {
        return core.preview([patch]);
      } catch (error) {
        if (lostCore(error)) {
          this.#lose();
          return null;
        }
        if (!(error instanceof CanvasCoreError)) throw error;
        const fresh = error.code === "stale" && attempt === 0 ? this.#coreModel() : null;
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
    if (!this.#destroyed) this.#recordPending();
  }

  /** Se c'è testo di una scheda non ancora registrato. */
  get hasPending(): boolean {
    return this.#pending !== null;
  }

  #schedulePause(): void {
    clearTimeout(this.#pauseTimer);
    this.#pauseTimer = setTimeout(() => {
      this.#pauseTimer = undefined;
      this.#deferPending();
    }, CARD_PAUSE_MS);
  }

  /**
   * Registra il testo in sospeso adesso o, con una penna giù, quando si alza:
   * il commit ridisegna le schede. Il tratto, quando finisce, lo registra da sé
   * prima di scriversi.
   */
  #deferPending(): void {
    if (this.#destroyed) return;
    this.#quiet.defer("pending", () => {
      if (!this.#destroyed) this.#recordPending();
    });
  }

  #showNotice(text: string): void {
    if (this.#destroyed || this.#intakeError === text) return;
    this.#intakeError = text;
    this.#drawToolbar();
  }

  #pruneSelection(): void {
    if (!this.#doc) {
      this.#selection = [];
      this.#edgeSelection = [];
      return;
    }
    const nodes = new Set(this.#doc.nodes.map((n) => n.id));
    const edges = new Set(this.#doc.edges.map((e) => e.id));
    this.#selection = this.#selection.filter((id) => nodes.has(id));
    this.#edgeSelection = this.#edgeSelection.filter((id) => edges.has(id));
  }

  /**
   * The selected cards as text: a card's text, a file's path, a link's URL, a
   * group's label. The last one picked is the primary.
   */
  selectedText(): { primary: string; secondary: string[] } | null {
    const nodes = this.#selectedNodes();
    const last = nodes[nodes.length - 1];
    if (this.#destroyed || !last) return null;
    return { primary: nodeText(last), secondary: nodes.slice(0, -1).map(nodeText) };
  }

  #selectedNodes(): CanvasNode[] {
    if (!this.#doc) return [];
    const byId = new Map(this.#doc.nodes.map((n) => [n.id, n]));
    return this.#selection.map((id) => byId.get(id)!).filter(Boolean);
  }

  // --- l'inchiostro -------------------------------------------------------------

  /** Una penna è giù: un tratto della punta o della gomma è in corso. */
  get #penDown(): boolean {
    return this.#quiet.active || (this.#inkLayer?.drawing ?? false);
  }

  /**
   * Monta lo strato della penna quando la lavagna si può cambiare e smontarlo
   * quando no (sola lettura del pannello o della tela, scena troppo grande,
   * lavagna chiusa: A8). Smontarlo annulla il tratto in corso: la scia sparisce.
   */
  #syncInkLayer(): void {
    const wanted = !this.#destroyed && this.#doc !== null && !this.#readOnly && !this.#isSceneOversized();
    if (wanted === (this.#inkLayer !== null)) return;
    if (!wanted) {
      const life = this.#inkLife;
      this.#inkLayer = null;
      this.#inkLife = null;
      this.#inkChain = null;
      life?.close();
      this.#inkTargetClose();
      this.#eraseDrop();
      this.#applyInkMouse();
      return;
    }
    const life = openLifetime();
    this.#inkLife = life;
    this.#inkLayer = mountInkLayer({
      viewport: this.#viewport,
      toWorld: (clientX, clientY) => this.#screenToWorld(clientX, clientY),
      // La penna scelta (A11 prima di ogni scelta) allo zoom di quando il
      // tratto comincia: una scelta a metà tratto vale dal tratto dopo.
      look: (input) => {
        const look = inkLook(this.#penChoice, this.#camera.zoom, input.pressure);
        this.#inkTargetStarting(look.brush.size);
        return look;
      },
      // Lo strumento Gomma: la punta e il mouse che scrive cancellano (A21).
      tipErases: () => this.#penChoice.tool === "eraser",
      quiet: this.#quiet,
      mouse: this.#inkMouseOn ? "ink" : "ignore",
      onStroke: (stroke) => this.#inkStroke(stroke),
      onCancel: (id) => {
        this.#inkTargetClose();
        this.#eraseCancel(id);
      },
      onEraseStart: (id, pointerType) => this.#eraseStart(id, pointerType),
      onErase: (id, points) => this.#eraseAlong(id, points),
      onEraseEnd: (id) => this.#eraseEnd(id),
    }, life);
    this.#inkLayer.setCamera(this.#camera.x, this.#camera.y, this.#camera.zoom);
    this.#applyInkMouse();
  }

  /** L'interruttore «Scrivi col mouse»: lo strumento della colonna è dell'inchiostro. */
  get #inkMouse(): boolean {
    return CANVAS_INK_TOOLS.has(this.#tool);
  }

  /** Il mouse scrive: D tenuto, o uno strumento dell'inchiostro nella colonna. */
  get #inkMouseOn(): boolean {
    return this.#inkMouse || this.#inkKeyDown;
  }

  /**
   * Fa scrivere il mouse (`on`) o lo lascia alla lavagna, dal prossimo
   * appoggio: l'interruttore «Scrivi col mouse». Acceso, la colonna passa
   * allo strumento della penna del menu (Penna, Evidenziatore o Gomma);
   * spento, dall'inchiostro torna alla Selezione. Un tratto già giù finisce
   * com'è. D tenuto lo fa scrivere anche da spento.
   */
  setInkMouse(on: boolean): void {
    if (this.#destroyed) return;
    this.#inkMouseTurns += 1;
    if (on) this.#setTool(this.#penChoice.tool);
    else if (this.#inkMouse) this.#setTool("select");
  }

  /** Lo strumento scelto adesso nella colonna. */
  get tool(): CanvasToolId {
    return this.#tool;
  }

  /**
   * Sceglie lo strumento (il comando `canvas.tool.<id>`, la colonna, il suo
   * tasto). In sola lettura gli strumenti che scrivono non si scelgono. Penna,
   * Evidenziatore e Gomma chiamano la penna del menu di N4 (la scelta si
   * ricorda come una scelta del menu) e fanno scrivere il mouse.
   */
  #pickTool(tool: CanvasToolId): void {
    if (this.#destroyed) return;
    if (CANVAS_WRITING_TOOLS.has(tool) && (this.#readOnly || this.#isSceneOversized())) return;
    // Uno strumento scelto: l'interruttore ricordato non arriva più a cambiarlo.
    this.#inkMouseTurns += 1;
    if (CANVAS_INK_TOOLS.has(tool) && this.#penChoice.tool !== tool) {
      this.#choosePen({ ...this.#penChoice, tool: tool as InkPenChoice["tool"] }, true);
    }
    this.#setTool(tool);
  }

  /**
   * «Collega…» (T17): il filo parte dalla scheda `id`, come dal pulsante →
   * della sua testata; il prossimo clic su un'altra scheda lo chiude. La
   * colonna mostra Collega finché il filo non c'è.
   */
  #beginConnectFrom(id: string): void {
    if (this.#destroyed || this.#readOnly || this.#isSceneOversized()) return;
    if (!this.#doc?.nodes.some((node) => node.id === id)) return;
    this.#pickTool("connect");
    this.#connectFrom = id;
  }

  /** Il pulsante «Mostra l'anteprima» della scheda di pagina web `id`, se c'è adesso. */
  #webPreviewButton(id: string): HTMLButtonElement | null {
    return this.#cards.get(id)?.article.querySelector<HTMLButtonElement>(".canvas-card-web-preview") ?? null;
  }

  /** Lo strumento di adesso, mostrato nella colonna, sull'interruttore e sul viewport. */
  #setTool(tool: CanvasToolId): void {
    // Uno strumento scelto rinuncia al filo cominciato da «Collega…».
    this.#connectFrom = null;
    this.#tool = tool;
    this.#inkMouseButton.setAttribute("aria-pressed", String(this.#inkMouse));
    this.#viewport.dataset.tool = tool;
    this.#rail.sync();
    this.#canvasOptions.sync();
    this.#applyInkMouse();
  }

  /**
   * L'interruttore con cui la lavagna si apre: lo stato ricordato (spento con
   * «Ricorda se scrivi col mouse» spento), letto una volta sola, così un
   * cambio dell'impostazione a lavagna aperta vale dalla prossima apertura.
   * Arriva solo se nel frattempo nessuno ha toccato l'interruttore; una
   * lettura che non riesce lo lascia spento.
   */
  #restoreInkMouse(memory: CanvasInkMouseMemory): void {
    const turns = this.#inkMouseTurns;
    void memory.read().then((on) => {
      if (on && !this.#destroyed && turns === this.#inkMouseTurns) this.setInkMouse(true);
    }, () => undefined);
  }

  /** Il clic sul pulsante: cambia l'interruttore e lo ricorda. */
  #toggleInkMouse(): void {
    this.setInkMouse(!this.#inkMouse);
    (this.#options.inkMouseMemory ?? SHARED_INK_MOUSE).save(this.#inkMouse);
  }

  /** D lasciato, la finestra senza fuoco o nascosta: il mouse torna com'era. */
  #releaseInkKey(): void {
    if (!this.#inkKeyDown) return;
    this.#inkKeyDown = false;
    this.#applyInkMouse();
  }

  /**
   * Dice allo strato che cosa fa il mouse, e lo mostra sul viewport solo
   * quando scrive davvero (lo strato c'è): `data-ink="pen"`, o `"eraser"` con
   * lo strumento Gomma del menu.
   */
  #applyInkMouse(): void {
    // Con Spazio tenuto il mouse sposta la vista (T53).
    const on = this.#inkMouseOn && !this.#spaceHeld;
    const layer = this.#inkLayer;
    layer?.setMouse(on ? "ink" : "ignore");
    if (on && layer) this.#viewport.dataset.ink = this.#penChoice.tool === "eraser" ? "eraser" : "pen";
    else delete this.#viewport.dataset.ink;
  }

  // --- il menu della penna (T21) -------------------------------------------

  /**
   * Una scelta del menu della penna: vale dal prossimo tratto o dalla
   * prossima passata (quelli in corso finiscono come sono cominciati). Una
   * scelta fatta (`settled`) si ricorda per le lavagne che si aprono dopo;
   * quelle aperte tengono la loro.
   */
  #choosePen(next: InkPenChoice, settled: boolean): void {
    if (this.#destroyed) return;
    this.#penTurns += 1;
    this.#penChoice = next;
    this.#followPen();
    this.#penMenu.sync();
    if (settled) (this.#options.penMemory ?? SHARED_PEN).save(next);
  }

  /**
   * La penna cambiata: se il mouse scrive con la colonna, la colonna passa
   * allo strumento della penna (la Gomma del menu è la Gomma della colonna).
   */
  #followPen(): void {
    if (this.#inkMouse && this.#tool !== this.#penChoice.tool) this.#setTool(this.#penChoice.tool);
    else this.#applyInkMouse();
  }

  /**
   * La penna con cui la lavagna si apre: quella ricordata, letta una volta.
   * Arriva solo se nel frattempo nessuno ha scelto; una lettura che non
   * riesce lascia quella di serie.
   */
  #restorePen(memory: CanvasPenMemory): void {
    const turns = this.#penTurns;
    void memory.read().then((choice) => {
      if (this.#destroyed || turns !== this.#penTurns) return;
      this.#penChoice = choice;
      this.#followPen();
      this.#penMenu.sync();
    }, () => undefined);
  }

  // --- la gomma: «Il tratto intero» (A20) e «Solo il pezzo» (T22) -----------

  /**
   * Che cosa fa la gomma dalla prossima passata: toglie il tratto intero
   * (`"stroke"`, di serie) o ne taglia solo il pezzo strofinato (`"piece"`).
   * Una passata già cominciata finisce com'è.
   */
  setInkEraser(mode: InkEraserMode): void {
    if (this.#destroyed || (mode !== "stroke" && mode !== "piece")) return;
    if (mode === this.#penChoice.eraser) return;
    this.#penTurns += 1;
    this.#penChoice = { ...this.#penChoice, eraser: mode };
    this.#penMenu.sync();
  }

  /**
   * Comincia una passata del retro della penna o del tasto laterale: i tratti
   * che può prendere sono quelli disegnati adesso, dove si vedono.
   */
  #eraseStart(id: number, pointerType: InkPointerType): void {
    this.#eraseDrop();
    this.#erase = {
      id,
      sweep: new EraseSweep(ERASER, pointerType),
      source: new InkEraseSource(erasableInk(this.#inkStateList())),
      mode: this.#penChoice.eraser,
      path: [],
      cuts: new Map(),
    };
  }

  /**
   * Punti nuovi della passata: i tratti presi si attenuano, il resto no. Con
   * `"piece"` si attenua solo il pezzo strofinato: i tratti vicini ai punti
   * nuovi si ritagliano sul cammino fatto fin qui.
   */
  #eraseAlong(id: number, points: readonly InkSample[]): void {
    const erase = this.#erase;
    if (!erase || erase.id !== id || points.length === 0) return;
    const zoom = this.#camera.zoom;
    const before = erase.sweep.size;
    if (erase.mode === "stroke") {
      for (const point of points) erase.sweep.along(erase.source, [point.x, point.y], zoom);
      const marked = erase.sweep.marked();
      for (let i = before; i < marked.length; i++) this.#fadeInk(marked[i]!, true);
      return;
    }
    const radius = erase.sweep.radius / zoom;
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
        if (erase.cuts.delete(unit.key)) this.#showCut(unit, null);
        continue;
      }
      const preview = cutPath(pieces);
      erase.cuts.set(unit.key, { unit, pieces, preview });
      this.#showCut(unit, preview);
    }
  }

  /**
   * La passata è finita: i tratti presi si cancellano (o si tagliano) con un
   * commit solo, un passo d'annulla, anche se stanno in più livelli. Niente
   * preso, niente commit; un commit che non riesce rimette i tratti come
   * erano.
   */
  #eraseEnd(id: number): void {
    const erase = this.#erase;
    if (!erase || erase.id !== id) return;
    this.#erase = null;
    if (erase.mode === "stroke" ? erase.sweep.size === 0 : erase.cuts.size === 0) return;
    let done = false;
    try {
      done = erase.mode === "stroke" ? this.#eraseCommit(erase.sweep.marked()) : this.#cutCommit(this.#cutsOf(erase));
    } finally {
      if (!done) this.#restoreErase(erase);
    }
  }

  /** La passata annullata (palmo, finestra nascosta, sola lettura): i tratti tornano normali. */
  #eraseCancel(id: number): void {
    if (this.#erase?.id === id) this.#eraseDrop();
  }

  #eraseDrop(): void {
    const erase = this.#erase;
    this.#erase = null;
    if (erase) this.#restoreErase(erase);
  }

  /** Rimette come erano i tratti che la passata `erase` mostrava presi o tagliati. */
  #restoreErase(erase: InkErase): void {
    if (erase.mode === "stroke") for (const unit of erase.sweep.marked()) this.#fadeInk(unit, false);
    else for (const { unit } of erase.cuts.values()) this.#showCut(unit, null);
  }

  /** I tagli della passata nell'ordine in cui la gomma ha preso i tratti. */
  #cutsOf(erase: InkErase): InkErasing[] {
    const cuts: InkErasing[] = [];
    for (const unit of erase.sweep.marked()) {
      const cut = erase.cuts.get(unit.key);
      if (cut) cuts.push(cut);
    }
    return cuts;
  }

  /** L'elemento della scheda `node` sulla scena; `null` se non c'è. */
  #inkOwner(node: string): HTMLElement | null {
    return this.#stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(node)}"]`);
  }

  /** Attenua o rimette il percorso disegnato di un tratto, senza ridisegnare. */
  #fadeInk(unit: ErasableInk, faded: boolean): void {
    if (unit.node === null) {
      fadeInkStroke(this.#stage, "board", unit.id, faded);
      return;
    }
    const element = this.#inkOwner(unit.node);
    if (element) fadeInkStroke(element, "card", unit.id, faded);
  }

  /** Mostra il taglio `preview` di un tratto (o lo toglie con `null`), senza ridisegnare. */
  #showCut(unit: ErasableInk, preview: string | null): void {
    if (unit.node === null) {
      cutInkStroke(this.#stage, "board", unit.id, preview);
      return;
    }
    const element = this.#inkOwner(unit.node);
    if (element) cutInkStroke(element, "card", unit.id, preview);
  }

  /** Il primo passo di un commit della gomma: il documento e i livelli di adesso, dopo il testo in sospeso. */
  #inkEditStart(): { readonly doc: CanvasDocument; readonly layers: readonly CanvasInkLayer[] } | null {
    if (this.#destroyed || !this.#doc || this.#readOnly || this.#isSceneOversized()) return null;
    this.#recordPending();
    const doc = this.#doc;
    const layers = this.#inkLayersNow();
    return layers ? { doc, layers } : null;
  }

  /**
   * Un commit solo con le toppe della gomma, un passo d'annulla; ciò che il
   * nucleo rifiuta lo dice l'avviso. `true` se è riuscito.
   */
  #commitInkEdit(patches: readonly InkPatch[]): boolean {
    if (patches.length === 0) return false;
    const code = this.#commitLocal(patches, "input", (step) => this.#pushUndo(step, true), false);
    if (code !== true) {
      // Una trappola la dice il nucleo che si riapre.
      if (code !== "trap") this.#showNotice(t(code === "limit" ? "canvas.ink.full" : "canvas.ink.refused"));
      return false;
    }
    this.#inkChain = null;
    this.#paintInk();
    if (this.#intakeError) this.#showNotice("");
    return true;
  }

  /**
   * Cancella i tratti `marked` dal documento di adesso: prima il testo in
   * sospeso (un passo suo, come prima di ogni gesto), poi una toppa per
   * tratto, livello per livello nell'ordine in cui la gomma li ha presi. Un
   * tratto che nel frattempo non c'è più si lascia; un livello diventato
   * estraneo non si tocca. `true` se il commit è riuscito.
   */
  #eraseCommit(marked: readonly ErasableInk[]): boolean {
    const start = this.#inkEditStart();
    if (!start) return false;
    const { doc, layers } = start;
    const present = new Set<string>();
    for (const state of this.#inkStateList()) {
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
    const patches: InkPatch[] = [];
    for (const { layer, ids } of groups.values()) {
      const made = eraseStrokePatches(doc, layers, layer, ids);
      if (made) patches.push(...made);
    }
    return this.#commitInkEdit(patches);
  }

  /**
   * Taglia i tratti di `cuts` nel documento di adesso: prima il testo in
   * sospeso, poi, livello per livello, i pezzi al posto di ogni tratto e nel
   * suo ordine (`cutStrokePatches`), in un commit solo. Un tratto che nel
   * frattempo non c'è più, o è cambiato, si lascia; un livello diventato
   * estraneo non si tocca. `true` se il commit è riuscito.
   */
  #cutCommit(cuts: readonly InkErasing[]): boolean {
    const start = this.#inkEditStart();
    if (!start) return false;
    const { doc, layers } = start;
    const present = new Map<string, DrawableStroke>();
    for (const state of this.#inkStateList()) {
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
    const patches: InkPatch[] = [];
    for (const { layer, cuts: layerCuts } of groups.values()) {
      const made = cutStrokePatches(doc, layers, layer, layerCuts);
      if (made) patches.push(...made);
    }
    return this.#commitInkEdit(patches);
  }

  /**
   * I livelli d'inchiostro del testo di adesso: lo stato lo dice il nucleo, una
   * volta per testo (`inkLayers()` li tiene fino al prossimo `reset` o
   * `commit`), e qui si decodificano una volta per modello.
   */
  #inkStateList(): readonly InkLayerState[] {
    const doc = this.#doc;
    const layers = this.#inkLayersNow();
    if (!doc || !layers) return [];
    const cached = this.#inkStates;
    if (cached && cached.doc === doc && cached.layers === layers) return cached.states;
    const states = inkLayerStates(doc, layers);
    this.#inkStates = { doc, layers, states };
    return states;
  }

  /** I livelli del nucleo per il testo di adesso; `null` senza nucleo o se è appena morto. */
  #inkLayersNow(): readonly CanvasInkLayer[] | null {
    const core = this.#core;
    if (!core) return null;
    try {
      return core.inkLayers();
    } catch (error) {
      if (lostCore(error)) {
        this.#lose();
        return null;
      }
      if (error instanceof CanvasCoreError) return null;
      throw error;
    }
  }

  /**
   * Ridisegna l'asciutto di tutte le schede sulla scena e della radice, senza
   * rifare le schede: dopo `#render`, o dopo un annulla fatto solo di tratti.
   */
  #paintInk(): void {
    if (!this.#doc || this.#isSceneOversized()) return;
    const cards = new Map<string, readonly DryStroke[]>();
    let board: DryStroke[] = [];
    // Ciò che la gomma ha preso resta attenuato (o tagliato) anche se lo
    // strato si ridisegna.
    const erase = this.#erase;
    const faded = erase?.mode === "stroke" ? new Set(erase.sweep.marked().map((unit) => unit.key)) : null;
    const cuts = erase?.mode === "piece" ? erase.cuts : null;
    for (const state of this.#inkStateList()) {
      const drys: DryStroke[] = [];
      for (const stroke of state.drawable) {
        const dry = dryStroke(stroke, this.#inkPaths);
        if (!dry) continue;
        const key = inkKey(state.layer, stroke.id);
        const cut = cuts?.get(key);
        if (cut && cut.unit.stroke.inkText === stroke.inkText) drys.push({ ...dry, cut: cut.preview });
        else drys.push(faded?.has(key) ? { ...dry, faded: true } : dry);
      }
      if (state.node) cards.set(state.node.id, drys);
      else board = drys;
    }
    const nodes = new Map(this.#doc.nodes.map((node) => [node.id, node]));
    for (const element of this.#stage.children) {
      if (!(element instanceof HTMLElement) || !element.classList.contains("canvas-node")) continue;
      const node = nodes.get(element.dataset.node ?? "");
      if (node) paintCard(element, cards.get(node.id) ?? [], inkFitMode(node));
    }
    paintBoard(this.#stage, board);
    this.#inkCards = cards;
    this.#inkBoard = board;
    this.#inkPaths.sweep();
  }

  /** Un tratto della penna è finito: si scrive, e la sua scia va via nello stesso giro. */
  #inkStroke(stroke: InkLayerStroke): void {
    const layer = this.#inkLayer;
    // L'etichetta sparisce all'alzata; il tratto si attacca a ciò che diceva.
    this.#inkTargetClose();
    try {
      this.#writeStroke(stroke);
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
  #writeStroke(stroke: InkLayerStroke): void {
    const chain = stroke.continued ? this.#inkChain : null;
    this.#inkChain = null;
    if (this.#destroyed || !this.#doc || this.#readOnly || this.#isSceneOversized()) return;
    // Come prima di ogni gesto: il testo e poi il tratto, due passi. Il campo
    // resta aperto col suo testo.
    this.#recordPending();
    const doc = this.#doc;
    const layers = this.#inkLayersNow();
    if (!layers) return;
    const holder = this.#inkHolder(doc.nodes, layers, strokeBounds(stroke.samples, stroke.brush.size));
    const ref: InkLayerRef = holder ? { node: holder.id } : "board";
    if (foreignInkLayer(layers, ref)) {
      this.#showNotice(t("canvas.ink.foreign"));
      return;
    }
    const made = strokeRecord(stroke, holder, { brush: stroke.brush, color: stroke.color, tool: stroke.tool }, Date.now());
    if (!made.ok) {
      // Un tocco che non fa contorno non è niente da dire.
      if (made.reason !== "empty") this.#showNotice(t(made.reason === "full" ? "canvas.ink.full" : "canvas.ink.refused"));
      return;
    }
    const patch = addStrokePatch(doc, layers, ref, made.record);
    if (!patch) {
      this.#showNotice(t("canvas.ink.refused"));
      return;
    }
    const before = this.#source;
    const code = this.#commitLocal([patch], "input", (step) => this.#pushInkStep(step, chain), false);
    if (code !== true) {
      // Una trappola la dice il nucleo che si riapre.
      if (code !== "trap") this.#showNotice(t(code === "limit" ? "canvas.ink.full" : "canvas.ink.refused"));
      return;
    }
    const top = this.#undo[this.#undo.length - 1];
    if (stroke.split && top) this.#inkChain = { step: top, before: chain?.before ?? before };
    const dry = toDry(made.record, this.#inkPaths);
    if (dry) this.#paintStroke(holder, dry);
    if (this.#intakeError) this.#showNotice("");
    // Il pezzo di un tratto spezzato non si annuncia: lo dice l'ultimo.
    if (!stroke.split) this.#sayInkHolder(holder);
  }

  /** Aggiunge l'asciutto di un tratto appena scritto al solo livello che lo tiene. */
  #paintStroke(holder: CanvasNode | null, dry: DryStroke): void {
    if (!holder) {
      this.#inkBoard = [...this.#inkBoard, dry];
      paintBoard(this.#stage, this.#inkBoard);
      return;
    }
    const drys = [...(this.#inkCards.get(holder.id) ?? []), dry];
    this.#inkCards.set(holder.id, drys);
    const element = this.#stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(holder.id)}"]`);
    // Una scheda arrivata da fuori a penna giù non è ancora sulla scena: la
    // disegna il ridisegno rimandato.
    if (element) paintCard(element, drys, inkFitMode(holder));
  }

  /**
   * Il passo d'annulla di un tratto: nuovo, o fuso col pezzo di prima dello
   * stesso tratto se nel frattempo il testo non è cambiato.
   */
  #pushInkStep(step: CanvasStep, chain: InkChain | null): void {
    const top = this.#undo[this.#undo.length - 1];
    if (chain && top === chain.step && top.version === step.restores) {
      this.#undo[this.#undo.length - 1] = mergeSteps(chain.before, top, step, this.#source);
      this.#redo = [];
      return;
    }
    this.#pushUndo(step, true);
  }

  // --- a chi appartiene il tratto (T69) -------------------------------------

  /**
   * La scheda a cui si attacca il tratto di riquadro `bounds`, o `null` se
   * resta libero: la regola di N4 (`anchorAt`), che non sceglie le schede col
   * livello d'inchiostro di un altro programma; con Alt tenuto, libero.
   * L'etichetta e l'alzata la chiedono qui tutte e due.
   */
  #inkHolder(nodes: readonly CanvasNode[], layers: readonly CanvasInkLayer[], bounds: Bounds): CanvasNode | null {
    if (this.#altHeld) return null;
    return anchorAt(nodes, bounds, (node) => !foreignInkLayer(layers, { node: node.id }));
  }

  /** Un appoggio sulla vista: il punto da cui partirà il riquadro, se diventa un tratto. */
  #inkSeen(event: PointerEvent): void {
    const at = this.#inkAt;
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
  #inkTargetStarting(size: number): void {
    this.#inkTargetClose();
    if (this.#destroyed) return;
    this.#inkStarting = { size, view: this.#viewport.getBoundingClientRect() };
  }

  /**
   * Un movimento sulla vista, dopo lo strato della penna: la scia è già
   * disegnata. A penna su non fa niente; a penna giù allarga il riquadro coi
   * punti dell'evento e rifà l'ancora solo se il riquadro è cresciuto. Il
   * browser manda un `pointermove` per fotogramma: al più un aggiornamento per
   * fotogramma, senza `requestAnimationFrame` (DEC-26).
   */
  #inkTargetMove(event: PointerEvent): void {
    if (!this.#inkTarget && !this.#inkStarting) return;
    const target = this.#inkTarget ?? this.#inkTargetOpen(event.pointerId);
    if (!target || event.pointerId !== target.pointerId) return;
    // Alt preso o lasciato senza che la finestra lo sapesse (il fuoco altrove).
    if (event.altKey !== this.#altHeld) {
      this.#altHeld = event.altKey;
      target.holder = undefined;
    }
    const { zoom, x, y } = this.#camera;
    const { left, top } = target.view;
    const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    let grew = false;
    for (const one of coalesced.length > 0 ? coalesced : [event]) {
      if (target.box.add((one.clientX - left - x) / zoom, (one.clientY - top - y) / zoom)) grew = true;
    }
    this.#inkSeen(event);
    this.#inkTargetShow(target, grew);
  }

  /** Apre l'etichetta del tratto appena cominciato, dal punto dell'appoggio. */
  #inkTargetOpen(pointerId: number): InkTarget | null {
    const starting = this.#inkStarting;
    this.#inkStarting = null;
    if (!starting || this.#destroyed || !this.#doc) return null;
    const marks = this.#inkMarksNow();
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
    this.#inkTarget = target;
    const at = this.#inkAt;
    if (at.pointerId === pointerId) {
      const { zoom, x, y } = this.#camera;
      target.box.add((at.clientX - starting.view.left - x) / zoom, (at.clientY - starting.view.top - y) / zoom);
    }
    return target;
  }

  /**
   * Mostra l'ancora del riquadro di adesso: il bordo tratteggiato passa alla
   * scheda nuova e il testo cambia solo quando l'ancora cambia (`grew` dice se
   * c'è da rifarla); l'etichetta segue la punta, accanto e mai sotto.
   */
  #inkTargetShow(target: InkTarget, grew: boolean): void {
    // Un ridisegno della scena toglie ciò che non è una scheda: i lati si rimettono.
    if (target.holder && !target.frames.isConnected) target.holder = undefined;
    if (grew || target.holder === undefined) {
      const doc = this.#doc;
      const layers = this.#inkLayersNow();
      const holder = doc && layers ? this.#inkHolder(doc.nodes, layers, target.box.bounds(target.size)) : null;
      const id = holder?.id ?? null;
      if (id !== target.holder) {
        target.holder = id;
        this.#placeInkFrame(target, holder);
        const text = inkHolderText(holder);
        // Lo stesso testo del tratto prima non si riscrive: niente misura nuova.
        if (target.label.textContent !== text) target.label.textContent = text;
        target.label.toggleAttribute("data-free", holder === null);
      }
    }
    this.#placeInkLabel(target);
  }

  /** L'etichetta accanto alla punta, con la misura che ha già: nessuna lettura del layout. */
  #placeInkLabel(target: InkTarget): void {
    const marks = this.#inkMarks;
    if (!marks) return;
    const { left, top, width } = target.view;
    const px = this.#inkAt.clientX - left;
    const py = this.#inkAt.clientY - top;
    // Sopra a destra della punta; a sinistra o sotto se lì non c'è posto.
    target.label.toggleAttribute("data-flip-x", px + marks.gap + marks.width > width);
    target.label.toggleAttribute("data-flip-y", py - marks.gap - marks.height < 0);
    target.label.style.setProperty("--canvas-ink-x", `${px}px`);
    target.label.style.setProperty("--canvas-ink-y", `${py}px`);
  }

  /**
   * Mette il bordo tratteggiato attorno a `holder`, nelle coordinate della
   * lavagna (lo stage lo porta con la camera), o lo toglie se il tratto è
   * libero. Lo stacco e lo spessore sono in `structure.css`, il colore nella pelle.
   */
  #placeInkFrame(target: InkTarget, holder: CanvasNode | null): void {
    const frames = target.frames;
    if (!holder) {
      frames.hidden = true;
      return;
    }
    // I lati ereditano la misura dal contenitore: quattro scritture, non sedici.
    frames.dataset.node = holder.id;
    frames.style.setProperty("--canvas-frame-x", `${holder.x}px`);
    frames.style.setProperty("--canvas-frame-y", `${holder.y}px`);
    frames.style.setProperty("--canvas-frame-w", `${holder.width}px`);
    frames.style.setProperty("--canvas-frame-h", `${holder.height}px`);
    if (!frames.isConnected) this.#stage.append(frames);
    frames.hidden = false;
  }

  /** L'etichetta e i lati del bordo: creati la prima volta, poi gli stessi. */
  #inkMarksNow(): InkMarks {
    if (this.#inkMarks) return this.#inkMarks;
    const label = document.createElement("div");
    label.className = "canvas-ink-label";
    // A penna su resta al suo posto, invisibile: mostrarla non rifà il layout.
    label.setAttribute("data-idle", "");
    // Il lettore di schermo la sente all'alzata, non a ogni cambio.
    label.setAttribute("aria-hidden", "true");
    this.#viewport.append(label);
    const frames = document.createElement("div");
    frames.className = "canvas-ink-frames";
    frames.hidden = true;
    frames.setAttribute("aria-hidden", "true");
    for (const side of INK_FRAME_SIDES) {
      const edge = document.createElement("div");
      edge.className = "canvas-ink-frame";
      edge.dataset.side = side;
      frames.append(edge);
    }
    this.#stage.append(frames);
    const marks: InkMarks = {
      label,
      frames,
      width: 0,
      height: 0,
      gap: 0,
    };
    this.#inkMarks = marks;
    if (typeof ResizeObserver !== "undefined") {
      // Il testo cambiato si misura dopo il layout del fotogramma, non quando cambia.
      const observer = new ResizeObserver(() => {
        marks.width = label.offsetWidth;
        marks.height = label.offsetHeight;
        if (marks.gap === 0) marks.gap = parseFloat(getComputedStyle(label).getPropertyValue("--canvas-ink-label-gap")) || 0;
        if (this.#inkTarget) this.#placeInkLabel(this.#inkTarget);
      });
      observer.observe(label);
      this.#life.add(() => observer.disconnect());
    }
    return marks;
  }

  /** Il tratto è finito o non c'è più: via l'etichetta e il bordo. */
  #inkTargetClose(): void {
    this.#inkStarting = null;
    const target = this.#inkTarget;
    if (!target) return;
    this.#inkTarget = null;
    target.frames.hidden = true;
    target.label.setAttribute("data-idle", "");
  }

  /** Alt tenuto o lasciato: a penna giù l'etichetta lo dice subito, anche se la punta è ferma. */
  #setAltHeld(held: boolean): void {
    if (held === this.#altHeld) return;
    this.#altHeld = held;
    const target = this.#inkTarget;
    if (target) {
      target.holder = undefined;
      this.#inkTargetShow(target, false);
    }
  }

  /**
   * Dice al lettore di schermo a che cosa si è attaccato il tratto appena
   * scritto, con le parole dell'etichetta; lo stesso testo di prima non si
   * ripete, così una pagina di tratti sulla stessa scheda resta in silenzio.
   */
  #sayInkHolder(holder: CanvasNode | null): void {
    if (this.#destroyed) return;
    let said = this.#inkSaid;
    if (!said) {
      said = document.createElement("div");
      said.className = "sr-only canvas-ink-said";
      said.setAttribute("role", "status");
      said.setAttribute("aria-live", "polite");
      this.#root.append(said);
      this.#inkSaid = said;
    }
    const text = inkHolderText(holder);
    if (said.textContent !== text) said.textContent = text;
  }

  // --- camera ---------------------------------------------------------------

  #applyCamera(): void {
    // Camera transforms are immediate for both motion preferences.
    this.#stage.style.transform = `translate(${this.#camera.x}px, ${this.#camera.y}px) scale(${this.#camera.zoom})`;
    // Il filo sta nello stage (T91): la sua camera è quella dello stage. Le prese no.
    this.#handleLayer.style.transform = `translate(${this.#camera.x}px, ${this.#camera.y}px) scale(${this.#camera.zoom})`;
    this.#inkLayer?.setCamera(this.#camera.x, this.#camera.y, this.#camera.zoom);
    // Le maniglie e i segni sopra le schede restano della stessa misura sullo
    // schermo a ogni zoom (T66): la pelle divide per `--canvas-zoom`.
    this.#stage.style.setProperty("--canvas-zoom", String(this.#camera.zoom));
    this.#markAllHandles();
    // Anche la resa passa di qui: la scelta cambiata si ricorda con la camera.
    this.#viewMemo?.changed();
    // Ogni cambio di zoom passa di qui (bottoni, tasti, menu, `fitCamera`): la
    // banda lo legge a fine gesto, dentro un gesto `#statusSettle` tace.
    this.#statusSettle();
  }

  // --- riaprire dove eri (T36) ------------------------------------------------

  /** Ciò che si ricorda adesso: `null` se la lavagna non mostra un documento. */
  #viewSnapshot(): CanvasViewSnapshot {
    if (!this.#doc) return null;
    const camera = { ...this.#camera };
    const selection = [...this.#selection];
    return this.#navigatorHidden ? { camera, selection, navigatorHidden: true } : { camera, selection };
  }

  /** La lavagna si è appena mostrata: la vista ricordata, se arriva, parte da qui. */
  #markOpenView(): void {
    if (!this.#viewMemo) return;
    this.#openView = { camera: { ...this.#camera }, selection: this.#selection.join("\n"), navigatorHidden: this.#navigatorHidden };
  }

  /**
   * La vista ricordata per l'apertura `round`: la camera, se nessuno l'ha
   * mossa e se almeno una scheda cade nella vista ricordata (se no resta
   * «inquadra tutto»); la scelta, se è ancora vuota, con le sole schede che ci
   * sono; e le schede PDF già montate su un'altra pagina si rimontano sulla
   * loro. Arrivata prima che il nucleo aprisse il testo, aspetta `#revive`.
   */
  #restoreView(round: number, view: CanvasView | null): void {
    if (this.#destroyed || round !== this.#viewRound || view === null) return;
    const doc = this.#doc;
    const open = this.#openView;
    if (!doc || !open) {
      this.#heldView = { round, view };
      return;
    }
    this.#heldView = null;
    this.#openView = null;
    let moved = false;
    const camera = view.camera;
    if (camera && sameViewport(this.#camera, open.camera)) {
      const next: Viewport = { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom) };
      const seen = this.#viewRectOf(next);
      if (doc.nodes.some((node) => overlaps(node, seen))) {
        this.#camera = next;
        moved = true;
      }
    }
    let selected = false;
    if (view.selection.length > 0 && this.#selection.join("\n") === open.selection && this.#edgeSelection.length === 0) {
      const present = new Set(doc.nodes.map((node) => node.id));
      const selection = view.selection.filter((id) => present.has(id));
      if (selection.length > 0) {
        this.#selection = selection;
        selected = true;
      }
    }
    // «Nascondi il navigatore» (T55), se nessuno l'ha cambiato nel frattempo.
    const hidden = view.navigatorHidden === true;
    if (this.#navigatorHidden === open.navigatorHidden && hidden !== this.#navigatorHidden) {
      this.#navigatorHidden = hidden;
      this.#statusSettle();
    }
    let remount = false;
    for (const entry of this.#cards.values()) {
      const page = this.#viewMemo?.page(entry.id) ?? null;
      const shown = entry.view?.page?.();
      if (page === null || shown === undefined || shown === page) continue;
      // Una chiave che nessun corpo ha: la resa smonta la vista e la rimonta.
      entry.bodyKey = null;
      remount = true;
    }
    if (!moved && !selected && !remount) return;
    this.#render();
    if (selected) this.#options.onSelectionChange();
  }

  #screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.#viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.#camera.x) / this.#camera.zoom,
      y: (clientY - rect.top - this.#camera.y) / this.#camera.zoom,
    };
  }

  #fitCamera(announce = true, nodes = this.#doc?.nodes ?? []): void {
    this.#stopMotion(false);
    this.#camera = this.#fitTarget(nodes);
    if (announce) {
      this.#applyCamera();
      this.#refreshLive();
    }
  }

  /**
   * La camera che mostra tutte le schede `nodes` (T53: con `fit` di
   * `spatial/camera.ts`): al centro, con `FIT_MARGIN` per lato, mai oltre il
   * 100%. Senza schede, il 100% con l'origine in alto a sinistra.
   */
  #fitTarget(nodes: readonly CanvasNode[]): Viewport {
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
    const rect = this.#viewport.getBoundingClientRect();
    const view = { w: Math.max(1, rect.width || 800), h: Math.max(1, rect.height || 600) };
    // Il margine sta nei bordi, in unità della lavagna: il centro non cambia.
    const bounds = {
      minX: minX - FIT_MARGIN,
      minY: minY - FIT_MARGIN,
      maxX: Math.max(minX + 1, maxX) + FIT_MARGIN,
      maxY: Math.max(minY + 1, maxY) + FIT_MARGIN,
    };
    return fromCamera(fit(bounds, view, 0, 0, FIT_LIMITS));
  }

  #zoomAt(clientX: number, clientY: number, factor: number): void {
    this.#stopMotion(false);
    const rect = this.#viewport.getBoundingClientRect();
    const at = { x: clientX - rect.left, y: clientY - rect.top };
    this.#camera = fromCamera(zoomAtPoint(toCamera(this.#camera), factor, at, ZOOM_LIMITS));
    this.#applyCamera();
    // Dai pulsanti e dai tasti lo zoom è un gesto finito; dalla rotella il
    // gesto è ancora in corso e `#refreshLive` aspetta che finisca.
    this.#refreshLive();
  }

  // --- muoversi (T53) ---------------------------------------------------------

  /**
   * Il salto della camera a `target`: Maiusc+1, Maiusc+2 e 0. È il solo posto
   * da cui la vista salta (il navigatore di T55 e Indietro e Avanti di T56
   * passeranno di qui). Vola con `stepCamera`; col movimento ridotto arriva
   * subito, senza volo.
   */
  #jumpCamera(target: Viewport): void {
    this.#stopMotion(false);
    const goal: Viewport = { x: target.x, y: target.y, zoom: clampZoom(target.zoom) };
    if (this.#reducedMotion || sameViewport(goal, this.#camera)) {
      this.#camera = goal;
      this.#applyCamera();
      this.#refreshLive();
      return;
    }
    const from = this.#camera;
    this.#runMotion({
      scale: from.zoom, tx: from.x, ty: from.y,
      targetScale: goal.zoom, targetTx: goal.x, targetTy: goal.y,
      vx: 0, vy: 0,
    });
  }

  /**
   * «Nascondi il navigatore» e «Mostra il navigatore» (T55): per questa
   * lavagna, ricordato nella vista (T36). Il fuoco che stava sul navigatore
   * torna alla lavagna.
   */
  #setNavigatorHidden(hidden: boolean): void {
    if (this.#navigatorHidden === hidden) return;
    this.#navigatorHidden = hidden;
    const focused = this.#navigator.element.contains(document.activeElement);
    this.#viewMemo?.changed();
    this.#statusSettle();
    if (focused && this.#navigator.element.hidden) this.#viewport.focus();
  }

  /**
   * F6 dentro la lavagna (`EditorSurface.zone`): la vista, poi il navigatore
   * se si vede (T55). `false` quando non resta una zona da quella parte.
   */
  zone(step: 1 | -1): boolean {
    if (this.#destroyed) return false;
    const zones = [this.#viewport, this.#navigator.element].filter((zone) => !zone.hidden);
    const at = zones.findIndex((zone) => zone.contains(document.activeElement));
    const target = zones[at < 0 ? (step > 0 ? 0 : zones.length - 1) : at + step];
    if (target === undefined) return false;
    target.focus();
    return true;
  }

  /** «0»: il 100% sul centro della vista. */
  #zoomToActual(): void {
    const rect = this.#viewport.getBoundingClientRect();
    const center = { x: (rect.width || 800) / 2, y: (rect.height || 600) / 2 };
    this.#jumpCamera(fromCamera(zoomAtPoint(toCamera(this.#camera), 1 / this.#camera.zoom, center, ZOOM_LIMITS)));
  }

  /**
   * L'inerzia dopo uno spostamento col dito: la vista va avanti alla
   * velocità del gesto (px al ms) e rallenta con `stepCamera`. Col movimento
   * ridotto niente.
   */
  #fling(vx: number, vy: number): void {
    if (this.#reducedMotion || Math.hypot(vx, vy) < INERTIA_MIN_SPEED) return;
    const at = this.#camera;
    this.#runMotion({ scale: at.zoom, tx: at.x, ty: at.y, targetScale: at.zoom, targetTx: at.x, targetTy: at.y, vx, vy });
  }

  /** La velocità alla fine di uno spostamento, in px al ms, sugli ultimi `INERTIA_WINDOW_MS` della scia. */
  #panSpeed(trail: readonly PanSample[], end: PanSample): { vx: number; vy: number } {
    const first = trail.find((point) => end.t - point.t <= INERTIA_WINDOW_MS);
    if (!first || end.t - first.t <= 0) return { vx: 0, vy: 0 };
    return { vx: (end.x - first.x) / (end.t - first.t), vy: (end.y - first.y) / (end.t - first.t) };
  }

  #runMotion(state: MotionState): void {
    this.#motion = { state, last: null };
    if (this.#motionFrame === undefined) this.#motionFrame = requestAnimationFrame((now) => this.#motionStep(now));
  }

  #motionStep(now: number): void {
    this.#motionFrame = undefined;
    const motion = this.#motion;
    if (!motion || this.#destroyed) return;
    if (this.#reducedMotion) {
      this.#stopMotion(true);
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
      this.#stopMotion(true);
      return;
    }
    this.#camera = { x: state.tx, y: state.ty, zoom: state.scale };
    this.#applyCamera();
    this.#motionFrame = requestAnimationFrame((later) => this.#motionStep(later));
  }

  /**
   * Ferma il volo o l'inerzia. Con `arrive` la vista va dove andava (il volo
   * finisce sul suo bersaglio, l'inerzia dov'è) e le schede vive si rifanno.
   */
  #stopMotion(arrive: boolean): void {
    if (this.#motionFrame !== undefined) cancelAnimationFrame(this.#motionFrame);
    this.#motionFrame = undefined;
    const motion = this.#motion;
    if (!motion) return;
    this.#motion = null;
    if (!arrive || this.#destroyed) return;
    const { targetScale, targetTx, targetTy } = motion.state;
    this.#camera = { x: targetTx, y: targetTy, zoom: targetScale };
    this.#applyCamera();
    this.#refreshLive();
  }

  /** La finestra perde il fuoco: niente scorre più da solo, e Spazio non è più tenuto. */
  #stillCamera(): void {
    this.#releaseSpace();
    this.#stopEdgeScroll();
    this.#stopMotion(true);
  }

  /**
   * Spazio giù sulla lavagna o su una scheda (non in un campo né dentro la
   * scheda attiva): `true` se l'ha preso. Con una penna giù non vale (la
   * penna ha la precedenza), ma la pagina non scorre.
   */
  #holdSpace(event: KeyboardEvent): boolean {
    if (event.key !== " " || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (isTextTarget(event.target) || !this.#onCardOrBoard(event.target)) return false;
    event.preventDefault();
    if (this.#spaceHeld || this.#penDown) return true;
    this.#spaceHeld = true;
    this.#viewport.toggleAttribute("data-space-pan", true);
    // Il mouse che scrive torna alla lavagna finché Spazio è giù.
    this.#applyInkMouse();
    return true;
  }

  #releaseSpace(): void {
    if (!this.#spaceHeld) return;
    this.#spaceHeld = false;
    this.#viewport.removeAttribute("data-space-pan");
    if (!this.#destroyed) this.#applyInkMouse();
  }

  /**
   * Un trascinamento (una scheda, una maniglia, un filo) si è mosso a
   * `event`: vicino al bordo della vista la fa scorrere, fuori dalla fascia
   * smette. Il primo fotogramma parte da qui.
   */
  #trackEdge(event: PointerEvent): void {
    const speed = this.#edgeSpeed(event.clientX, event.clientY);
    if (speed.x === 0 && speed.y === 0) {
      this.#stopEdgeScroll();
      return;
    }
    const last = this.#edgeScroll?.last ?? null;
    this.#edgeScroll = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      shiftKey: event.shiftKey, altKey: event.altKey, last,
    };
    if (this.#edgeFrame === undefined) this.#edgeFrame = requestAnimationFrame((now) => this.#edgeStep(now));
  }

  /** La velocità dello scorrimento al bordo nel punto, in px al ms, verso dove va la vista. */
  #edgeSpeed(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.#viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: edgeScrollSpeed(clientX - rect.left, rect.right - clientX),
      y: edgeScrollSpeed(clientY - rect.top, rect.bottom - clientY),
    };
  }

  #edgeStep(now: number): void {
    this.#edgeFrame = undefined;
    const edge = this.#edgeScroll;
    if (!edge || this.#destroyed) return;
    const drag = this.#drag?.pointerId === edge.pointerId ? this.#drag : null;
    const resize = this.#resize?.pointerId === edge.pointerId ? this.#resize : null;
    const connect = this.#connect?.pointerId === edge.pointerId ? this.#connect : null;
    if (!drag && !resize && !connect) {
      this.#stopEdgeScroll();
      return;
    }
    const dt = edge.last === null ? 16 : Math.min(MAX_FRAME_MS, Math.max(0, now - edge.last));
    edge.last = now;
    const speed = this.#edgeSpeed(edge.clientX, edge.clientY);
    // La vista va verso il bordo: la lavagna scorre al contrario.
    const dx = -speed.x * dt;
    const dy = -speed.y * dt;
    this.#camera = { ...this.#camera, x: this.#camera.x + dx, y: this.#camera.y + dy };
    this.#applyCamera();
    // Ciò che si tira resta sotto il puntatore fermo: il punto di partenza
    // del gesto scorre con la lavagna.
    if (drag) {
      drag.startX += dx;
      drag.startY += dy;
      this.#moveDrag(edge);
    } else if (resize) {
      resize.startX += dx;
      resize.startY += dy;
      this.#moveResize(edge);
    } else {
      this.#moveConnect(edge.clientX, edge.clientY);
    }
    this.#edgeFrame = requestAnimationFrame((later) => this.#edgeStep(later));
  }

  #stopEdgeScroll(): void {
    if (this.#edgeFrame !== undefined) cancelAnimationFrame(this.#edgeFrame);
    this.#edgeFrame = undefined;
    this.#edgeScroll = null;
  }

  // --- toolbar ----------------------------------------------------------------

  #drawToolbar(): void {
    const bar = this.#toolbar;
    // La barra di N4 si rifà da capo, salvo l'interruttore «Scrivi col
    // mouse», che resta lo stesso elemento in testa: il fuoco non si perde.
    // Ciò che è passato nella riga delle opzioni (T50: il menu della penna,
    // davanti e dietro, allinea e distribuisci, la Vista) non c'è più; il
    // resto aspetta i suoi task (la barra della selezione T51, i fili e il
    // colore esatto T47 e T59, la lavagna vuota T62).
    const inkMouse = this.#inkMouseButton;
    for (const child of [...bar.children]) if (child !== inkMouse) child.remove();
    if (bar.firstElementChild !== inkMouse) bar.prepend(inkMouse);
    this.#penMenu.sync();
    // La colonna e la riga delle opzioni: lo strumento, la scelta e la sola
    // lettura di adesso.
    this.#rail.sync();
    this.#canvasOptions.sync();
    // «Scrivi col mouse», in testa.
    inkMouse.textContent = t("canvas.ink.mouse");
    inkMouse.title = t("canvas.ink.mouse_hint");
    inkMouse.setAttribute("aria-pressed", String(this.#inkMouse));
    inkMouse.disabled = this.#readOnly || this.#isSceneOversized();
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
      button.disabled = disabled || (mutates && (this.#readOnly || this.#isSceneOversized()));
      button.addEventListener("click", (e) => {
        e.preventDefault();
        this.#recordPending();
        run();
        if (focusViewport) this.#viewport.focus();
      });
      bar.append(button);
      return button;
    };
    mk("add-text", t("canvas.add_text"), () => this.#addNode("text"));
    if (this.#options.onPickFile) {
      mk("add-file", t("canvas.add_file"), () => {
        void this.#addFileNode().catch((error: unknown) => this.#showIntakeError(error));
      });
    }
    mk("add-link", t("canvas.add_link"), () => this.#addNode("link"));
    mk("add-group", t("canvas.add_group"), () => this.#addNode("group"));
    const hasSelection = this.#selection.length > 0 || this.#edgeSelection.length > 0;
    mk("duplicate", t("canvas.duplicate"), () => this.#duplicateSelection(), !hasSelection);
    mk("delete", t("canvas.delete"), () => this.#deleteSelection(), !hasSelection);
    mk("fit-selection", t("canvas.fit_selection"), () => this.#fitCamera(true, this.#selectedNodes()), this.#selection.length === 0, false);
    if (!this.#isSceneOversized() && this.#doc?.edges.length && this.#doc.edges.length <= MAX_INTERACTIVE_EDGES) {
      const picker = document.createElement("select");
      picker.dataset.canvasField = "select-edge";
      picker.setAttribute("aria-label", t("canvas.select_edge"));
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = t("canvas.select_edge");
      picker.append(empty);
      for (const edge of this.#doc.edges) {
        const option = document.createElement("option");
        option.value = edge.id;
        option.textContent = edge.label || edge.id;
        picker.append(option);
      }
      picker.value = this.#edgeSelection[0] ?? "";
      picker.addEventListener("change", () => {
        this.#edgeSelection = picker.value ? [picker.value] : [];
        this.#selection = [];
        this.#options.onSelectionChange();
        this.#displaySelection();
        this.#toolbar.querySelector<HTMLInputElement>('[data-canvas-field="edge-label"]')?.focus();
      });
      bar.append(picker);
    }
    // Il colore delle schede e dei fili non sta più qui: è nel menu «Colore»
    // del tasto destro e nel pozzo della riga delle opzioni (T47).
    if (!this.#isSceneOversized() && this.#edgeSelection.length === 1) this.#drawEdgeInspector(bar);
    // Un avviso solo, nel suo posto all'inizio della barra, dove si legge
    // senza scorrere: quello dell'ultimo gesto, o la sola lettura della tela.
    // Una scena oltre il limite ha già il suo, nella tela.
    const notice = this.#intakeError
      || (this.#unwritable && !this.#isSceneOversized() ? t("canvas.unwritable") : "");
    if (notice) {
      const error = document.createElement("output");
      error.setAttribute("role", "alert");
      error.className = "canvas-intake-error";
      error.textContent = notice;
      bar.prepend(error);
    }
    // L'avviso di «Togli dalla lavagna» (T17), dopo quello dell'ultimo gesto:
    // una notizia e non un guasto, con «Annulla» accanto.
    const removal = this.#removal;
    if (removal) {
      const said = document.createElement("output");
      said.setAttribute("role", "status");
      said.className = "canvas-removal";
      said.textContent = removal.text;
      const place = bar.querySelector(".canvas-intake-error")?.nextSibling ?? inkMouse.nextSibling;
      bar.insertBefore(said, place);
      if (removal.undo && removal.step !== undefined) {
        const undo = document.createElement("button");
        undo.type = "button";
        undo.dataset.canvasAction = "undo-removal";
        undo.textContent = t("app.undo");
        undo.title = t("canvas.card.removed_undo");
        // Il pulsante si rifà con la barra: l'ascolto se ne va con lui.
        undo.addEventListener("click", () => this.#undoRemoval());
        bar.insertBefore(undo, said.nextSibling);
      }
    }
  }

  #showIntakeError(error: unknown): void {
    if (this.#destroyed) return;
    this.#intakeError = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    this.#drawToolbar();
  }

  #layoutSelection(axis: "left" | "center" | "right" | "top" | "middle" | "bottom" | "distribute-x" | "distribute-y"): void {
    const nodes = this.#selectedNodes();
    if (this.#readOnly || !this.#doc || nodes.length < (axis.startsWith("distribute") ? 3 : 2)) return;
    const horizontal = axis === "distribute-x";
    const ordered = axis.startsWith("distribute")
      ? [...nodes].sort((a, b) => (horizontal ? a.x + a.width / 2 - b.x - b.width / 2 : a.y + a.height / 2 - b.y - b.height / 2))
      : nodes;
    const minX = Math.min(...nodes.map((node) => node.x));
    const maxX = Math.max(...nodes.map((node) => node.x + node.width));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxY = Math.max(...nodes.map((node) => node.y + node.height));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const start = horizontal ? first.x + first.width / 2 : first.y + first.height / 2;
    const end = horizontal ? last.x + last.width / 2 : last.y + last.height / 2;
    const patches: CanvasPatch[] = [];
    ordered.forEach((node, index) => {
      const target = { ...node };
      switch (axis) {
        case "left": target.x = snap(minX); break;
        case "center": target.x = snap((minX + maxX - node.width) / 2); break;
        case "right": target.x = snap(maxX - node.width); break;
        case "top": target.y = snap(minY); break;
        case "middle": target.y = snap((minY + maxY - node.height) / 2); break;
        case "bottom": target.y = snap(maxY - node.height); break;
        case "distribute-x":
          if (index && index < ordered.length - 1) target.x = snap(start + (end - start) * index / (ordered.length - 1) - node.width / 2);
          break;
        case "distribute-y":
          if (index && index < ordered.length - 1) target.y = snap(start + (end - start) * index / (ordered.length - 1) - node.height / 2);
          break;
      }
      const patch = upsertNodePatch(this.#doc!, target);
      if (patch) patches.push(patch);
    });
    this.#commit(patches, "input");
  }

  #drawEdgeInspector(bar: HTMLElement): void {
    const id = this.#edgeSelection[0];
    const edge = this.#doc?.edges.find((entry) => entry.id === id);
    if (!edge) return;
    const change = (values: Partial<CanvasEdge>): void => {
      const current = this.#doc?.edges.find((entry) => entry.id === id);
      if (!current || !this.#doc) return;
      const next = { ...current, ...values };
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete next[key];
      }
      const patch = upsertEdgePatch(this.#doc, next);
      if (patch) this.#commit([patch], "input");
    };
    const label = document.createElement("input");
    label.type = "text";
    label.value = edge.label ?? "";
    label.maxLength = 65_536;
    label.disabled = this.#readOnly;
    label.dataset.canvasField = "edge-label";
    label.setAttribute("aria-label", t("canvas.edge_label"));
    label.addEventListener("change", () => change({ label: label.value }));
    bar.append(label);
    for (const field of ["fromNode", "toNode"] as const) {
      const select = document.createElement("select");
      select.dataset.canvasField = `edge-${field}`;
      select.setAttribute("aria-label", t(field === "fromNode" ? "canvas.edge_from_node" : "canvas.edge_to_node"));
      select.disabled = this.#readOnly;
      for (const node of this.#doc!.nodes) {
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
      select.disabled = this.#readOnly;
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

  async #intake(event: DragEvent | ClipboardEvent): Promise<void> {
    if (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true]")) return;
    const drop = event.type === "drop" && "dataTransfer" in event;
    const data = drop ? event.dataTransfer : "clipboardData" in event ? event.clipboardData : null;
    const port = this.#options.attachments;
    const documentId = this.#options.documentId;
    if (!data || this.#readOnly || !this.#doc || this.#destroyed || this.#isSceneOversized()) return;
    // Le schede di Fub negli appunti (T68) vincono sul loro Markdown; una
    // forma rotta si incolla come testo.
    const cards = drop ? "" : data.getData(CANVAS_CLIPBOARD_TYPE) || "";
    if (cards && this.#pasteCards(event, cards)) return;
    if (!port && data.files.length) return;
    const text = data.getData("text/plain") || cards;
    if (!port && !text) return;
    this.#intakeError = "";
    this.#drawToolbar();
    event.preventDefault();
    const before = this.#source;
    const epoch = this.#epoch;
    const stale = (): boolean => this.#destroyed || this.#readOnly || this.#source !== before
      || this.#epoch !== epoch || !this.#doc;
    // Il punto e la scheda sotto si prendono subito: durante il deposito il
    // puntatore si muove.
    const point = this.#intakePoint(event, drop);
    const existing = drop ? this.#nodeAt(document.elementFromPoint?.(event.clientX, event.clientY) ?? null) : null;
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
        paths = await port!.deposit(files, documentId!, this.#depositCards(born));
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
      const patches: CanvasPatch[] = [];
      const file = this.#doc!.nodes.find((node) => node.id === existing && node.type === "file");
      // Su una scheda di file il primo file ne prende il posto (A-8).
      if (file && unique.length) {
        const path = unique.shift()!;
        const patch = upsertNodePatch(this.#doc!, { ...file, file: path, subpath: undefined });
        if (patch) patches.push(patch);
        bear(path, file.id);
      }
      if (unique.length) {
        const items = await this.#bornItems(unique);
        if (stale()) return;
        const layout = dropLayout(items, point);
        if (layout.group) {
          // Il gruppo prima delle schede, così sta sotto di loro.
          const patch = upsertNodePatch(this.#doc!, {
            id: newNodeId("n"), type: "group", ...layout.group,
            label: t("canvas.intake.group", { count: String(layout.cards.length) }),
          });
          if (patch) patches.push(patch);
        }
        for (const card of layout.cards) {
          const id = newNodeId("n");
          const patch = upsertNodePatch(this.#doc!, {
            id, type: "file", file: card.path,
            x: card.x, y: card.y, width: card.width, height: card.height,
          });
          if (patch) patches.push(patch);
          bear(card.path, id);
        }
      }
      // Gli appunti diventano testo solo se non c'era un file da depositare:
      // un file rifiutato non si trasforma in una scheda di testo (T15b).
      if (!paths.length && text && !failure) {
        const table = await this.#pastedTable(data, text);
        if (stale()) return;
        const url = table === null ? externalUrl(text.trim()) : null;
        const node: CanvasNode = {
          id: newNodeId("n"), type: url ? "link" : "text",
          x: snap(point.x), y: snap(point.y), width: 320, height: 160,
          ...(url ? { url } : { text: table ?? text }),
        };
        const patch = upsertNodePatch(this.#doc!, node);
        if (patch) patches.push(patch);
      }
      // Un commit solo: un annulla toglie tutto ciò che è nato.
      this.#commit(patches, "input");
    } finally {
      // Dopo le schede, e in ogni uscita: uscire presto non deve perdere l'errore.
      if (failure) this.#showIntakeError(failure);
    }
  }

  /**
   * La porta con cui un gesto dopo il deposito ripunta le schede che il
   * deposito ha fatto nascere (`born`: percorso → id, riempita quando nascono).
   * Ogni scheda si cerca per id e cambia solo se mostra ancora il file di
   * prima: tolta, o già puntata altrove, resta com'è. Tutte in un commit solo.
   */
  #depositCards(born: ReadonlyMap<string, readonly string[]>): CanvasDepositCards {
    const live = (): boolean => !this.#destroyed && !this.#readOnly && this.#doc !== null;
    return {
      live,
      repoint: (changes) => {
        if (!live()) return 0;
        const doc = this.#doc!;
        const patches: CanvasPatch[] = [];
        const touched = new Set<string>();
        for (const { from, to } of changes) {
          if (!isVaultPath(to)) continue;
          for (const id of born.get(from) ?? []) {
            const node = doc.nodes.find((candidate) => candidate.id === id);
            if (!node || touched.has(id) || node.type !== "file" || node.file !== from) continue;
            const patch = upsertNodePatch(doc, { ...node, file: to });
            if (patch) patches.push(patch);
            touched.add(id);
          }
        }
        if (patches.length) this.#commit(patches, "input");
        return patches.length;
      },
    };
  }

  /**
   * Il punto della lavagna in cui nasce ciò che arriva: quello del rilascio;
   * per un incolla, l'ultimo punto in cui il puntatore è stato visto sulla
   * vista, sennò il centro della vista.
   */
  #intakePoint(event: DragEvent | ClipboardEvent, drop: boolean): { x: number; y: number } {
    if (drop && "clientX" in event) return this.#screenToWorld(event.clientX, event.clientY);
    if (this.#pointerSeen) return this.#screenToWorld(this.#pointerSeen.x, this.#pointerSeen.y);
    const rect = this.#viewport.getBoundingClientRect();
    return this.#screenToWorld(rect.left + this.#viewport.clientWidth / 2, rect.top + this.#viewport.clientHeight / 2);
  }

  /**
   * I file con la specie e la misura di nascita. Le immagini chiedono la loro
   * misura alla porta, poche alla volta; una misura che non c'è, fallisce o
   * non arriva in tempo lascia quella di serie.
   */
  async #bornItems(paths: readonly string[]): Promise<DropItem[]> {
    const items: DropItem[] = paths.map((path) => {
      const kind = cardKindOf({ id: "", type: "file", file: path, x: 0, y: 0, width: 0, height: 0 }) ?? "file";
      return { path, kind, size: bornSize(kind) };
    });
    const measure = this.#options.measureImage;
    if (!measure) return items;
    const images = items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === "image");
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < images.length && !this.#destroyed) {
        const { item, index } = images[next++]!;
        const size = await measuredImage(measure, item.path);
        if (size) items[index] = { ...item, size: bornSize("image", size) };
      }
    };
    await Promise.all(Array.from({ length: Math.min(MEASURE_IMAGE_PARALLEL, images.length) }, worker));
    return items;
  }

  /**
   * Le celle copiate come tabella Markdown: l'HTML con una tabella, tramite
   * la porta; sennò il testo a tabulazioni su più righe. `null` se non sono
   * celle.
   */
  async #pastedTable(data: DataTransfer, text: string): Promise<string | null> {
    const convert = this.#options.clipboardMarkdown;
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
  #showDropGhosts(event: DragEvent): void {
    const data = event.dataTransfer;
    if (!data || !this.#options.attachments) return;
    const types = [...(data.types ?? [])];
    // Senza tipi leggibili (WebKit durante il trascinamento) può essere un file.
    const carries = types.length === 0 || types.includes("Files")
      || types.includes(ENTRIES_DRAG_TYPE) || types.includes(NOTE_DRAG_TYPE);
    if (!carries) {
      this.#hideDropGhosts();
      return;
    }
    const count = Math.max(1, [...(data.items ?? [])].filter((item) => item.kind === "file").length);
    // Nomi che tengono l'ordine dato: la griglia è quella del rilascio.
    const items: DropItem[] = Array.from({ length: count }, (_, index) => ({
      path: String(index).padStart(8, "0"), kind: "file", size: bornSize("file"),
    }));
    const layout = dropLayout(items, this.#screenToWorld(event.clientX, event.clientY));
    let layer = this.#dropGhosts;
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "canvas-drop-ghosts";
      layer.setAttribute("aria-hidden", "true");
      this.#viewport.append(layer);
      this.#dropGhosts = layer;
    }
    layer.style.transform = `translate(${this.#camera.x}px, ${this.#camera.y}px) scale(${this.#camera.zoom})`;
    while (layer.children.length > layout.cards.length) layer.lastElementChild!.remove();
    layout.cards.forEach((card, index) => {
      let ghost = layer.children[index] as HTMLElement | undefined;
      if (!ghost) {
        ghost = document.createElement("div");
        ghost.className = "canvas-drop-ghost";
        layer.append(ghost);
      }
      ghost.style.transform = `translate(${card.x}px, ${card.y}px)`;
      ghost.style.width = `${card.width}px`;
      ghost.style.height = `${card.height}px`;
    });
  }

  #hideDropGhosts(): void {
    this.#dropGhosts?.remove();
    this.#dropGhosts = null;
  }

  async #convertTextToNote(node: CanvasNode): Promise<void> {
    if (this.#readOnly || this.#destroyed || !this.#doc || node.type !== "text") return;
    const create = this.#options.onCreateNote;
    if (!create) return;
    const source = this.#source;
    const epoch = this.#epoch;
    const path = await create(node.text ?? "");
    const current = this.#doc?.nodes.find((entry) => entry.id === node.id);
    if (!path || !current || this.#destroyed || this.#readOnly || source !== this.#source || this.#epoch !== epoch
      || JSON.stringify(current) !== JSON.stringify(node)) return;
    const next: CanvasNode = { ...current, type: "file", file: path };
    delete next.text;
    const patch = upsertNodePatch(this.#doc!, next);
    if (patch) this.#commit([patch], "input");
  }

  async #addFileNode(at?: { x: number; y: number }): Promise<void> {
    const pick = this.#options.onPickFile;
    if (!pick || this.#readOnly || this.#destroyed || !this.#doc) return;
    const source = this.#source;
    const epoch = this.#epoch;
    const path = await pick();
    if (!isVaultPath(path) || this.#destroyed || this.#readOnly || source !== this.#source
      || this.#epoch !== epoch) return;
    this.#addNode("file", path, at);
  }

  /** Una card nuova al centro della vista, o in `at` (coordinate del mondo);
   *  una card file vuole il suo `file`. Torna la card messa, o `null`. */
  #addNode(type: CanvasNode["type"], file?: string, at?: { x: number; y: number }, link?: CardLink): CanvasNode | null {
    if (!this.#doc || this.#readOnly || (type === "file" && !file)) return null;
    const rect = this.#viewport.getBoundingClientRect();
    const width = type === "group" ? 480 : 320;
    const height = type === "group" ? 320 : type === "link" ? 120 : 160;
    // Collegata (T67): il lato verso l'altro capo cade sotto il puntatore.
    const source = link ? this.#doc.nodes.find((one) => one.id === link.from) : undefined;
    const anchor = source && (link?.fromSide
      ? sidePoint(source, link.fromSide)
      : { x: source.x + source.width / 2, y: source.y + source.height / 2 });
    const facing = anchor && at ? linkedCardPlacement(anchor, at, width, height) : null;
    const center = facing
      ? { x: facing.x + 160, y: facing.y + 80 }
      : at
      ? { x: at.x + 160, y: at.y + 80 }
      : this.#screenToWorld(rect.left + (rect.width || 800) / 2, rect.top + (rect.height || 600) / 2);
    const node: CanvasNode = {
      id: newNodeId("n"),
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
    const patches: CanvasPatch[] = [];
    const patch = upsertNodePatch(this.#doc, node);
    if (patch) patches.push(patch);
    if (patch && source && facing) {
      const fromSide = link?.fromSide ?? nearestSides(node, source, facing.side).toSide;
      const edgePatch = upsertEdgePatch(this.#doc, {
        id: newNodeId("e"), fromNode: source.id, toNode: node.id, fromSide, toSide: facing.side, ...this.#tipEnds(),
      });
      if (edgePatch) patches.push(edgePatch);
    }
    if (patches.length && this.#commit(patches, "input")) {
      this.#selection = [node.id];
      this.#edgeSelection = [];
      this.#options.onSelectionChange();
      return node;
    }
    return null;
  }

  #duplicateSelection(): void {
    if (!this.#doc || this.#readOnly) return;
    const nodes = this.#selectedNodes();
    if (!nodes.length) return;
    // Le copie dell'ultimo Ctrl+D ripetono il suo spostamento (T68).
    const repeat = this.#repeatedOffset(nodes);
    const idMap = new Map<string, string>();
    for (const node of nodes) idMap.set(node.id, newNodeId("n"));
    const patches: CanvasPatch[] = [];
    for (const node of nodes) {
      const copy: CanvasNode = JSON.parse(JSON.stringify(node)) as CanvasNode;
      copy.id = idMap.get(node.id)!;
      copy.x = repeat ? node.x + repeat.x : snap(node.x + CANVAS_PASTE_STEP);
      copy.y = repeat ? node.y + repeat.y : snap(node.y + CANVAS_PASTE_STEP);
      const patch = upsertNodePatch(this.#doc, copy);
      if (patch) patches.push(patch);
    }
    if (patches.length && this.#commit(patches, "input")) {
      this.#lastDuplicate = { sources: nodes.map((node) => node.id), copies: nodes.map((node) => idMap.get(node.id)!) };
      this.#selection = [...idMap.values()];
      this.#edgeSelection = [];
      this.#options.onSelectionChange();
    }
  }

  // --- copia e incolla le schede (T68) --------------------------------------------

  /**
   * Lo spostamento che Ctrl+D ripete: le schede `nodes` sono proprio le copie
   * dell'ultimo Ctrl+D e la prima scheda di partenza c'è ancora; si ripete la
   * distanza di adesso fra le due, anche se la copia è stata spostata. `null`
   * sennò, o se la copia sta sopra la sua scheda.
   */
  #repeatedOffset(nodes: readonly CanvasNode[]): { readonly x: number; readonly y: number } | null {
    const last = this.#lastDuplicate;
    if (!last || !this.#doc || last.copies.length !== nodes.length) return null;
    const chosen = new Set(nodes.map((node) => node.id));
    if (!last.copies.every((id) => chosen.has(id))) return null;
    const copy = this.#doc.nodes.find((node) => node.id === last.copies[0]);
    const source = this.#doc.nodes.find((node) => node.id === last.sources[0]);
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
  #ownsClipboard(): boolean {
    if (this.#clipboardCommand !== null) return true;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.#viewport.contains(active)) return false;
    if (isTextTarget(active) || this.#insideActive(active, false)) return false;
    const selection = document.getSelection();
    return !(selection && !selection.isCollapsed && this.#viewport.contains(selection.anchorNode));
  }

  /** Ctrl+C e Ctrl+X, e «Copia» e «Taglia» del menu: le schede scelte negli appunti; tagliando, poi tolte. */
  #copyEvent(event: ClipboardEvent, cut: boolean): void {
    if (event.defaultPrevented || !event.clipboardData || !this.#doc || this.#destroyed) return;
    if (!this.#ownsClipboard()) return;
    const cutting = cut || this.#clipboardCommand === "cut";
    if (cutting && this.#readOnly) return;
    const clipboard = copiedCards(this.#doc, this.#selection);
    if (!clipboard) return;
    event.preventDefault();
    event.clipboardData.setData(CANVAS_CLIPBOARD_TYPE, clipboardJson(clipboard));
    event.clipboardData.setData("text/plain", cardsMarkdown(clipboard.nodes));
    // Appunti nuovi: il prossimo incolla parte di nuovo sotto il puntatore.
    this.#lastPaste = null;
    if (cutting) this.#cutCards(clipboard.nodes.map((node) => node.id));
  }

  /** Toglie le schede tagliate come «Togli dalla lavagna»: i file restano, e l'avviso lo dice col suo «Annulla». */
  #cutCards(ids: readonly string[]): void {
    if (this.#readOnly || !this.#removeCards(ids, [])) return;
    this.#selection = this.#selection.filter((id) => !ids.includes(id));
    this.#edgeSelection = [];
    this.#options.onSelectionChange();
  }

  /**
   * Un incolla che il browser manda fuori dalla vista (al corpo della pagina,
   * o dove sta la selezione di testo) mentre il fuoco è sulla lavagna: passa
   * da `#intake` come uno sulla vista. Quello sulla vista l'ha già preso lei.
   */
  #pasteFromOutside(event: ClipboardEvent): void {
    if (event.defaultPrevented || (event.target instanceof Node && this.#viewport.contains(event.target))) return;
    if (this.#clipboardCommand !== null || !this.#ownsClipboard()) return;
    void this.#intake(event).catch((error: unknown) => this.#showIntakeError(error));
  }

  /**
   * Incolla le schede di Fub dal testo `raw` degli appunti, nel punto
   * dell'incolla (T15): un commit, un annulla, le schede incollate scelte. Lo
   * stesso testo incollato di nuovo nello stesso punto si sfalsa. Una versione
   * futura non incolla niente e lo dice. `false` se `raw` non è la forma di
   * Fub: allora si incolla come testo.
   */
  #pasteCards(event: ClipboardEvent | DragEvent, raw: string): boolean {
    const read = readCanvasClipboard(raw);
    if (read.kind === "broken") return false;
    event.preventDefault();
    this.#recordPending();
    if (read.kind === "future") {
      this.#showNotice(t("canvas.clipboard.future"));
      return true;
    }
    const point = this.#intakePoint(event, false);
    const x = snap(point.x);
    const y = snap(point.y);
    const last = this.#lastPaste;
    const count = last && last.raw === raw && last.x === x && last.y === y ? last.count + 1 : 0;
    const step = count * CANVAS_PASTE_STEP;
    if (!this.#commitPasted(read.clipboard, { x: x + step, y: y + step })) {
      this.#showNotice(t("canvas.clipboard.refused"));
      return true;
    }
    this.#lastPaste = { raw, x, y, count };
    this.#showNotice("");
    return true;
  }

  /** Le schede di `clipboard` con l'angolo del loro riquadro in `at`, in un commit solo, poi scelte. `false` se il nucleo le rifiuta. */
  #commitPasted(clipboard: CanvasClipboard, at: { readonly x: number; readonly y: number }): boolean {
    const doc = this.#doc;
    if (!doc || this.#readOnly) return false;
    const placed = placedCards(clipboard, at, newNodeId);
    const patches: CanvasPatch[] = [];
    for (const node of placed.nodes) {
      const patch = upsertNodePatch(doc, node);
      if (patch) patches.push(patch);
    }
    for (const edge of placed.edges) {
      const patch = upsertEdgePatch(doc, edge);
      if (patch) patches.push(patch);
    }
    if (!this.#commit(patches, "input")) return false;
    this.#selection = placed.nodes.map((node) => node.id);
    this.#edgeSelection = [];
    this.#options.onSelectionChange();
    return true;
  }

  /**
   * «Copia», «Taglia» e «Incolla» del tasto destro. Copia e taglia mandano la
   * copia del browser, la stessa di Ctrl+C; dove non parte, scrivono con gli
   * appunti della shell (il tipo di Fub solo dove la shell lo accetta, come
   * formato della pagina). Incolla legge gli appunti e passa da `#intake`
   * come un Ctrl+V.
   */
  #clipboardMenu(op: SurfaceClipboardOp): void {
    if (op === "paste") {
      this.#pasteFromMenu();
      return;
    }
    if (op !== "copy" && op !== "cut") return;
    this.#clipboardCommand = op;
    let sent = false;
    try {
      sent = typeof document.execCommand === "function" && document.execCommand("copy");
    } catch {
      sent = false;
    } finally {
      this.#clipboardCommand = null;
    }
    if (!sent) this.#writeCards(op === "cut");
  }

  /** Scrive le schede scelte con gli appunti della shell; con `cut` le toglie, solo dopo averle scritte. */
  #writeCards(cut: boolean): void {
    if (!this.#doc || (cut && this.#readOnly)) return;
    const clipboard = copiedCards(this.#doc, this.#selection);
    if (!clipboard) return;
    const markdown = cardsMarkdown(clipboard.nodes);
    const web = `web ${CANVAS_CLIPBOARD_TYPE}`;
    const write = clipboardSupports(web)
      ? writeClipboardData({
          "text/plain": new Blob([markdown], { type: "text/plain" }),
          [web]: new Blob([clipboardJson(clipboard)], { type: CANVAS_CLIPBOARD_TYPE }),
        })
      : writeClipboardText(markdown);
    const ids = clipboard.nodes.map((node) => node.id);
    const source = this.#source;
    this.#lastPaste = null;
    void write.then(
      () => {
        if (cut && !this.#destroyed && this.#source === source) this.#cutCards(ids);
      },
      () => {
        if (!this.#destroyed) this.#showNotice(t("editor_menu.copy_failed"));
      },
    );
  }

  /** «Incolla» del menu: gli appunti letti come li legge la lavagna vuota (`transferOf`, schede di Fub comprese). */
  #pasteFromMenu(): void {
    if (this.#readOnly || this.#destroyed) return;
    readClipboard().then(async (entries) => {
      const data = await transferOf(entries);
      if (this.#destroyed) return;
      if (data === null) this.#showNotice(t("canvas.blank.paste_none"));
      else this.#receive(data);
    }).catch(() => {
      if (!this.#destroyed) this.#showNotice(t("editor_menu.paste_failed"));
    });
  }

  #deleteSelection(): void {
    if (!this.#doc || this.#readOnly) return;
    if (this.#removeCards(this.#selection, this.#edgeSelection)) {
      this.#selection = [];
      this.#edgeSelection = [];
      this.#options.onSelectionChange();
    }
  }

  /**
   * «Togli dalla lavagna» (Canc, Backspace, il menu, la scheda mancante):
   * toglie le schede `nodes` e le linee `edges`, mai i file, e lo dice con
   * «Annulla». «I file restano» solo se fra le tolte c'è una scheda di file;
   * togliere solo dei fili non dice niente.
   */
  #removeCards(nodes: readonly string[], edges: readonly string[]): boolean {
    if (!this.#doc) return false;
    const gone = this.#doc.nodes.filter((node) => nodes.includes(node.id));
    if (!this.#removeNodes(nodes, edges)) return false;
    if (gone.length > 0) {
      const files = gone.some((node) => node.type === "file");
      const many = gone.length > 1;
      const key = files
        ? (many ? "canvas.card.removed_many" : "canvas.card.removed")
        : (many ? "canvas.card.removed_plain_many" : "canvas.card.removed_plain");
      this.#showRemoval(t(key, { n: String(gone.length) }), true);
    }
    return true;
  }

  /**
   * L'avviso di un togliere appena fatto, legato al suo passo d'annulla; con
   * `undo` porta «Annulla». Va nel posto degli avvisi della tela.
   */
  #showRemoval(text: string, undo: boolean): void {
    if (this.#destroyed) return;
    this.#removal = { text, step: this.#undo[this.#undo.length - 1], undo };
    this.#drawToolbar();
  }

  /** La modifica dopo il togliere: il suo avviso se ne va. */
  #dropRemoval(): void {
    if (this.#removal === null) return;
    this.#removal = null;
    this.#drawToolbar();
  }

  /**
   * «Annulla» dell'avviso: ciò che fa Ctrl+Z, finché il togliere è l'ultimo
   * passo; dopo, l'avviso non c'è già più.
   */
  #undoRemoval(): void {
    const removal = this.#removal;
    if (removal === null || removal.step === undefined || this.#undo[this.#undo.length - 1] !== removal.step) {
      this.#dropRemoval();
      return;
    }
    this.undo();
    this.#dropRemoval();
    this.#statusSettle();
    this.#viewport.focus({ preventScroll: true });
  }

  /**
   * «Sposta anche il file nel cestino» (T17): i file delle schede scelte nel
   * cestino, uno alla volta, con la porta dell'host (il gesto dell'albero);
   * poi via dalla lavagna ogni scheda di un file che ci è andato, anche quelle
   * non scelte (la stessa nota in due schede), e le schede scelte senza file.
   * Un file che l'host rifiuta lascia le sue schede, e l'errore dell'host si
   * legge nel posto degli avvisi. Mai da un tasto: il comando non ne ha.
   */
  async #trashSelectedFiles(): Promise<void> {
    const trash = this.#options.onTrashPath;
    if (!trash || !this.#doc || this.#readOnly) return;
    const chosen = this.#selectedNodes();
    const paths = [...new Set(chosen.filter((node) => node.type === "file").map((node) => cardTarget(node).path))]
      .filter(isVaultPath);
    if (!paths.length) return;
    const plain = chosen.filter((node) => node.type !== "file").map((node) => node.id);
    const document = this.#source;
    const trashed: string[] = [];
    let failure: unknown = null;
    for (const path of paths) {
      try {
        if (await trash(path)) trashed.push(path);
      } catch (error) {
        failure = error;
        break;
      }
      if (this.#destroyed) return;
    }
    if (this.#destroyed) return;
    if (failure !== null) this.#showIntakeError(failure);
    if (!trashed.length || !this.#doc || this.#readOnly) return;
    // Le schede dei file andati, come sono adesso: il documento può essere
    // cambiato durante l'attesa. Le schede senza file si tolgono solo se il
    // documento è quello di quando il gesto è partito.
    const gone = new Set(trashed);
    const cards = this.#doc.nodes.filter((node) => node.type === "file" && gone.has(cardTarget(node).path)).map((node) => node.id);
    const ids = [...cards, ...(this.#source === document ? plain : [])];
    if (!this.#removeNodes(ids, [])) return;
    this.#pruneSelection();
    this.#options.onSelectionChange();
    const key = trashed.length > 1
      ? "canvas.card.trashed_files"
      : ids.length > 1 ? "canvas.card.trashed_many" : "canvas.card.trashed";
    this.#showRemoval(t(key, { n: String(ids.length), name: fileName(trashed[0]!), files: String(trashed.length) }), false);
  }

  /**
   * «Spargi le pagine…» (T72): una scheda per pagina del PDF scelto, in riga
   * accanto alla sua, a capo ogni 10 e in gruppo oltre 12. Chiede le pagine (di
   * serie tutte), chiede conferma oltre `SPREAD_CONFIRM_ABOVE`, misura ogni
   * pagina come nasce un PDF (T29) e mette tutto in un commit solo: un annulla
   * le toglie. Il file non si cambia.
   */
  async #spreadPages(): Promise<void> {
    const pages = this.#options.cards?.pdfPages;
    const chosen = this.#selectedNodes();
    const one = chosen.length === 1 ? chosen[0]! : null;
    if (!pages || !this.#doc || this.#readOnly || one?.type !== "file" || cardKindOf(one) !== "pdf") return;
    const path = cardTarget(one).path;
    if (!isVaultPath(path)) return;
    const id = one.id;
    const epoch = this.#epoch;
    // Dopo ogni attesa: la lavagna è ancora quella, e la scheda c'è ancora.
    const alive = (): boolean => !this.#destroyed && !this.#readOnly && this.#epoch === epoch
      && this.#doc !== null && this.#doc.nodes.some((node) => node.id === id);
    const count = await pages.count(path);
    if (!alive()) return;
    if (count === null) {
      this.#markBroken(path);
      this.#showIntakeError(t("canvas.card.unreadable", { name: fileName(path) }));
      return;
    }
    this.#forgetBroken(path);
    const wanted = await this.#askPages(fileName(path), count);
    if (wanted === null || !alive()) return;
    if (wanted.length > SPREAD_CONFIRM_ABOVE && !(await this.#confirmSpread(wanted.length))) return;
    if (!alive()) return;
    const measured = await pages.sizes(path, wanted);
    if (!alive()) return;
    const doc = this.#doc;
    const beside = doc?.nodes.find((node) => node.id === id);
    if (!doc || !beside) return;
    const layout = spreadLayout(wanted.map((_, index) => bornSize("pdf", measured[index] ?? undefined)), beside);
    const patches: CanvasPatch[] = [];
    if (layout.group) {
      const patch = upsertNodePatch(doc, {
        id: newNodeId("n"), type: "group", ...layout.group,
        label: t("canvas.spread.group", { count: String(wanted.length) }),
      });
      if (patch) patches.push(patch);
    }
    wanted.forEach((page, index) => {
      const patch = upsertNodePatch(doc, {
        id: newNodeId("n"), type: "file", file: path, subpath: `#page=${page}`, ...layout.rects[index]!,
      });
      if (patch) patches.push(patch);
    });
    if (patches.length) this.#commit(patches, "input");
  }

  /**
   * Chiede quali pagine «Spargi le pagine» deve fare (T72): `null` se si rinuncia.
   * Il campo parte da tutte le pagine e dice a ogni tasto che cosa nascerà; un
   * pezzo che non si legge non chiude il dialogo, e il dialogo dice quale.
   */
  #askPages(name: string, count: number): Promise<readonly number[] | null> {
    const own = openLifetime();
    this.#life.add(() => own.close());
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
  #confirmSpread(count: number): Promise<boolean> {
    const own = openLifetime();
    this.#life.add(() => own.close());
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

  /** Un PDF che non si apre: «Spargi le pagine» si spegne, finché il file non cambia (T72). */
  #markBroken(path: string): void {
    if (this.#destroyed || this.#pdfBroken.has(path)) return;
    const stop = this.#options.cards?.watch(path, () => this.#forgetBroken(path));
    this.#pdfBroken.set(path, stop ?? (() => {}));
  }

  /** Il file di un PDF guasto è cambiato, è tornato o si è aperto: il comando torna acceso. */
  #forgetBroken(path: string): void {
    const stop = this.#pdfBroken.get(path);
    if (stop === undefined) return;
    this.#pdfBroken.delete(path);
    stop();
  }

  /**
   * Toglie le schede `nodes` e le linee `edges`, con le linee che le tengono:
   * un commit solo, che un annulla riporta. `false` se non c'era niente da togliere.
   */
  #removeNodes(nodes: readonly string[], edges: readonly string[]): boolean {
    if (!this.#doc) return false;
    const patches: CanvasPatch[] = [];
    const selected = new Set(nodes);
    const removed = new Set(edges);
    for (const edge of this.#doc.edges) {
      if (selected.has(edge.fromNode) || selected.has(edge.toNode)) removed.add(edge.id);
    }
    for (const id of removed) {
      const patch = removeEdgePatch(this.#doc, id);
      if (patch) patches.push(patch);
    }
    for (const id of selected) {
      const patch = removeNodePatch(this.#doc, id);
      if (patch) patches.push(patch);
    }
    return patches.length > 0 && this.#commit(patches, "input");
  }

  #reorderSelection(where: "front" | "back"): void {
    if (!this.#doc || this.#readOnly || !this.#selection.length) return;
    const ids = this.#doc.nodes.map((n) => n.id);
    const selected = new Set(this.#selection);
    const rest = ids.filter((id) => !selected.has(id));
    const after = where === "front" ? [...rest, ...this.#selection] : [...this.#selection, ...rest];
    if (JSON.stringify(ids) === JSON.stringify(after)) return;
    this.#commit([{ kind: "reorder", before: ids, after }], "input");
  }

  // --- i comandi (T48) --------------------------------------------------------------

  /**
   * I comandi della lavagna adesso: il catalogo (`chrome/commands.ts`) con
   * ciò che fanno qui. Li leggono il menu del tasto destro, i tasti e la
   * ricerca dei comandi.
   */
  commands(): CanvasCommand[] {
    if (this.#destroyed) return [];
    return buildCanvasCommands((id) => this.#commandBehaviour(id), t);
  }

  // --- la banda di stato (T52) ------------------------------------------------

  /** Le voci della banda adesso (`EditorSurface.status`): nessuna senza una lavagna. */
  statusItems(): SurfaceStatusItem[] {
    if (this.#destroyed || !this.#doc) return [];
    return canvasStatusItems(this.#statusPort());
  }

  /** Ciò che la banda legge della lavagna e ciò che può chiederle. */
  #statusPort(): CanvasStatusPort {
    const port: CanvasStatusPort = {
      zoomPercent: () => Math.round(this.#camera.zoom * 100),
      chosenCount: () => this.#selection.length,
      readOnlyWhy: () => (this.#readOnly
        ? (this.#unwritable ? t("canvas.unwritable") : t("canvas.status.readonly.panel"))
        : null),
      folder: () => dropFolderOf(this.#attachmentDeclared, this.#dropChoice, this.#options.documentId ?? ""),
      zoomTo: (zoom) => {
        if (this.#destroyed || !this.#doc) return;
        const rect = this.#viewport.getBoundingClientRect();
        this.#zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, zoom / this.#camera.zoom);
        this.#statusSettle();
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
            this.#statusSettle();
          },
        };
      },
      zoomMenuAt: () => {
        const rect = this.#viewport.getBoundingClientRect();
        return { x: Math.round(rect.right), y: Math.round(rect.bottom) };
      },
    };
    const openSettings = this.#options.onOpenSettings;
    return openSettings ? { ...port, openSettings } : port;
  }

  /**
   * Avvisa la banda se una sua voce è cambiata, a fine gesto: dentro un gesto
   * (un trascinamento, una panoramica, la rotella che gira) non dice niente, e
   * con la stessa firma di prima non avvisa.
   */
  #statusSettle(): void {
    if (this.#destroyed || !this.#doc || this.#gestureActive()) return;
    // Il navigatore si rilegge con la banda, a fine gesto e al cambio del documento (T55).
    this.#navigator.settle();
    const shown = statusSignature(canvasStatusItems(this.#statusPort()));
    if (shown === this.#statusShown) return;
    this.#statusShown = shown;
    this.#options.onStatusChange?.();
  }

  /** Che cosa fa il comando `id` su questa tela, o `null` se non lo conosce. */
  #commandBehaviour(id: string): CanvasCommandBehaviour | null {
    const writable = (): string | null => (this.#readOnly ? t("canvas.commands.why.read_only") : null);
    const withSelection = (): string | null =>
      writable() ?? (this.#selectedNodes().length > 0 ? null : t("canvas.commands.why.no_selection"));
    const withNodes = (): string | null => (this.#doc?.nodes.length ? null : t("canvas.commands.why.empty"));
    const only = (): CanvasNode | null => {
      const nodes = this.#selectedNodes();
      return nodes.length === 1 ? nodes[0]! : null;
    };
    const center = (): { x: number; y: number } => {
      const rect = this.#viewport.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const world = (args?: CanvasCommandArgs) => (args?.at ? this.#screenToWorld(args.at.x, args.at.y) : undefined);
    const add = (type: CanvasNode["type"]): CanvasCommandBehaviour => ({
      disabled: writable,
      run: (args) => this.#addNode(type, undefined, world(args)),
    });
    if (id.startsWith("canvas.color.")) {
      // I colori (T47): nessuno, i sei, i nove delle note; «Altro…» apre il
      // selettore del kit.
      const choice = id.slice("canvas.color.".length) as CanvasColorId;
      if (!(CANVAS_COLORS as readonly string[]).includes(choice)) return null;
      return {
        disabled: () => writable() ?? (this.#selectedNodes().length || this.#edgeSelection.length ? null : t("canvas.commands.why.no_selection")),
        run: (args) => {
          const value = colorValueOf(choice);
          if (value === null) this.#openColorPicker(args?.edge);
          else this.#colorSelection(value, args?.edge);
        },
      };
    }
    if (id.startsWith("canvas.align.")) {
      const axis = id.slice("canvas.align.".length) as CanvasAlign;
      if (!(CANVAS_ALIGN as readonly string[]).includes(axis)) return null;
      return {
        disabled: () => writable() ?? (this.#selectedNodes().length >= 2 ? null : t("canvas.commands.why.two")),
        run: () => this.#layoutSelection(axis),
      };
    }
    if (id.startsWith("canvas.tips.")) {
      const tip = id.slice("canvas.tips.".length) as CanvasTip;
      if (!(CANVAS_TIPS as readonly string[]).includes(tip)) return null;
      return {
        disabled: writable,
        run: () => {
          this.#tips = tip;
          this.#canvasOptions.sync();
        },
      };
    }
    if (id.startsWith("canvas.nudge.")) {
      const [way, far] = id.slice("canvas.nudge.".length).split(".") as [CanvasNudge, string | undefined];
      const step = far === "far" ? CANVAS_SNAP * 4 : CANVAS_SNAP;
      const dx = way === "left" ? -step : way === "right" ? step : 0;
      const dy = way === "up" ? -step : way === "down" ? step : 0;
      return { disabled: withNodes, run: () => this.#nudge(dx, dy, way === "down" || way === "right") };
    }
    const tool = toolOfCommand(id);
    if (tool !== null) {
      return {
        disabled: () => (CANVAS_WRITING_TOOLS.has(tool) ? writable() ?? (this.#isSceneOversized() ? t("canvas.too_large") : null) : null),
        run: () => {
          // C con una scheda scelta comincia il filo da lei, come «Collega…»
          // (T17); con due le collega (T67, D-19 (a)); senza, sceglie lo
          // strumento.
          const chosen = tool === "connect" && this.#edgeSelection.length === 0 ? this.#selectedNodes() : [];
          if (chosen.length === 2) this.#connectPair(chosen[0]!, chosen[1]!);
          else if (chosen.length === 1) this.#beginConnectFrom(chosen[0]!.id);
          else this.#pickTool(tool);
        },
      };
    }
    switch (id) {
      case "canvas.escape":
        return {
          disabled: () => (this.#selection.length || this.#edgeSelection.length || this.#tool !== "select" ? null : t("canvas.commands.why.no_selection")),
          run: () => {
            // Un filo cominciato da «Collega…» si lascia prima di tutto.
            if (this.#connectFrom !== null) this.#pickTool("select");
            else if (this.#selection.length || this.#edgeSelection.length) this.#clearSelection();
            else this.#pickTool("select");
          },
        };
      case "canvas.undo":
        return { disabled: () => (this.#undo.length || this.#pending ? null : t("canvas.commands.why.no_undo")), run: () => void this.undo() };
      case "canvas.redo":
        return { disabled: () => (this.#redo.length ? null : t("canvas.commands.why.no_redo")), run: () => void this.redo() };
      case "canvas.commands":
        return { disabled: () => null, run: () => this.#openCommandSearch() };
      case "canvas.add.text":
        return add("text");
      case "canvas.add.link":
        return add("link");
      case "canvas.add.group":
        return add("group");
      case "canvas.add.file":
        return {
          disabled: () => writable() ?? (this.#options.onPickFile ? null : t("canvas.commands.why.no_file_picker")),
          run: (args) => void this.#addFileNode(world(args)).catch((error: unknown) => this.#showIntakeError(error)),
        };
      case "canvas.duplicate":
        return { disabled: withSelection, run: () => this.#duplicateSelection() };
      case "canvas.select_all":
        return { disabled: withNodes, run: () => this.#selectAll() };
      case "canvas.enter":
        return {
          disabled: () => (this.#selectionFocus() ? null : t("canvas.commands.why.no_selection")),
          run: () => {
            const focus = this.#selectionFocus();
            if (focus) this.#enterOrEdit(focus);
          },
        };
      case "canvas.edit":
        return {
          disabled: () => writable() ?? (only()?.type === "text" ? null : t("canvas.commands.why.one_text")),
          run: () => {
            const one = only();
            if (one?.type === "text") this.#beginCardEdit(one);
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
            if (one?.type !== "file" || !one.file) return;
            const path = `/${one.file.replace(/^\/+/, "")}${one.subpath ?? ""}`;
            void this.#options.onOpenPath?.(path, this.#options.documentId);
          },
        };
      case "canvas.open_url":
        return {
          disabled: () => {
            const one = only();
            if (one?.type !== "link") return t("canvas.commands.why.one_link");
            return externalUrl(one.url ?? "") !== null && this.#options.media ? null : t("canvas.commands.why.no_url");
          },
          run: () => {
            const one = only();
            const destination = one?.type === "link" ? externalUrl(one.url ?? "") : null;
            const media = this.#options.media;
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
            return this.#options.onOpenPathBeside ? null : t("canvas.commands.why.no_beside");
          },
          run: () => {
            const one = only();
            const beside = this.#options.onOpenPathBeside;
            if (one?.type !== "file" || !one.file || !beside) return;
            const path = `/${one.file.replace(/^\/+/, "")}${one.subpath ?? ""}`;
            void Promise.resolve(beside(path, this.#options.documentId)).catch((error: unknown) => this.#showIntakeError(error));
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
            void this.#options.onOpenPath?.(path, this.#options.documentId);
          },
        };
      case "canvas.web_preview":
        return {
          disabled: () => {
            const one = only();
            if (one?.type !== "link") return t("canvas.commands.why.one_link");
            const button = this.#webPreviewButton(one.id);
            return button && !button.disabled ? null : t("canvas.commands.why.no_preview");
          },
          // Lo stesso gesto del pulsante della scheda: la sua porta, una
          // richiesta sola.
          run: () => {
            const one = only();
            const button = one ? this.#webPreviewButton(one.id) : null;
            if (button && !button.disabled) button.click();
          },
        };
      case "canvas.connect":
        return {
          disabled: () => writable() ?? (only() ? null : t("canvas.commands.why.one_card")),
          run: () => {
            const one = only();
            if (one) this.#beginConnectFrom(one.id);
          },
        };
      case "canvas.trash_file":
        return {
          disabled: () => {
            const why = writable();
            if (why !== null) return why;
            if (!this.#options.onTrashPath) return t("canvas.commands.why.no_trash");
            return this.#selectedNodes().some((node) => node.type === "file" && isVaultPath(cardTarget(node).path))
              ? null
              : t("canvas.commands.why.no_file_card");
          },
          run: () => void this.#trashSelectedFiles().catch((error: unknown) => this.#showIntakeError(error)),
        };
      case "canvas.spread_pages":
        return {
          disabled: () => {
            const why = writable();
            if (why !== null) return why;
            const one = only();
            if (one?.type !== "file" || cardKindOf(one) !== "pdf" || !isVaultPath(cardTarget(one).path)) return t("canvas.commands.why.no_pdf");
            if (!this.#options.cards?.pdfPages) return t("canvas.commands.why.no_pdf_reader");
            return this.#pdfBroken.has(cardTarget(one).path) ? t("canvas.commands.why.pdf_unreadable") : null;
          },
          run: () => void this.#spreadPages().catch((error: unknown) => this.#showIntakeError(error)),
        };
      case "canvas.edge.reverse":
        return {
          disabled: () => writable() ?? (this.#edgeSelection.length ? null : t("canvas.commands.why.no_edge")),
          run: (args) => this.#reverseEdge(args?.edge ?? this.#edgeSelection[0]),
        };
      case "canvas.delete":
        return {
          disabled: () => writable() ?? (this.#selection.length || this.#edgeSelection.length ? null : t("canvas.commands.why.no_selection")),
          run: () => this.#deleteSelection(),
        };
      case "canvas.bring_front":
        return { disabled: withSelection, run: () => this.#reorderSelection("front") };
      case "canvas.send_back":
        return { disabled: withSelection, run: () => this.#reorderSelection("back") };
      case "canvas.distribute_x":
      case "canvas.distribute_y":
        return {
          disabled: () => writable() ?? (this.#selectedNodes().length >= 3 ? null : t("canvas.commands.why.three")),
          run: () => this.#layoutSelection(id === "canvas.distribute_x" ? "distribute-x" : "distribute-y"),
        };
      // I menu della riga delle opzioni (T50).
      case "canvas.pen_menu":
        return {
          disabled: () => writable() ?? (this.#isSceneOversized() ? t("canvas.too_large") : null),
          run: () => {
            // Con uno strumento che non scrive a mano, prima lo strumento
            // della penna: la riga mostra il pulsante e il menu ci si apre.
            if (!CANVAS_INK_TOOLS.has(this.#tool)) this.#pickTool(this.#penChoice.tool);
            this.#penMenu.open();
          },
        };
      case "canvas.color_menu":
        return { disabled: withSelection, run: () => this.#canvasOptions.openColorMenu() };
      case "canvas.align_menu":
        return {
          disabled: () => writable() ?? (this.#selectedNodes().length >= 2 ? null : t("canvas.commands.why.two")),
          run: () => this.#canvasOptions.openAlignMenu(),
        };
      case "canvas.fit":
        return {
          disabled: () => null,
          // Un salto (T53): vola, o arriva subito col movimento ridotto.
          run: () => this.#jumpCamera(this.#fitTarget(this.#doc?.nodes ?? [])),
        };
      case "canvas.fit_selection":
        return {
          disabled: () => (this.#selectedNodes().length ? null : t("canvas.commands.why.no_selection")),
          run: () => this.#jumpCamera(this.#fitTarget(this.#selectedNodes())),
        };
      case "canvas.zoom_reset":
        return { disabled: () => null, run: () => this.#zoomToActual() };
      // Il navigatore (T55): c'è la voce che serve adesso, Nascondi o Mostra.
      case "canvas.navigator.hide":
      case "canvas.navigator.show": {
        const hide = id === "canvas.navigator.hide";
        if (hide === this.#navigatorHidden) return null;
        return { disabled: () => null, run: () => this.#setNavigatorHidden(hide) };
      }
      case "canvas.zoom_in":
      case "canvas.zoom_out":
        return {
          disabled: () => null,
          run: (args) => {
            const at = args?.at ?? center();
            this.#zoomAt(at.x, at.y, id === "canvas.zoom_in" ? CANVAS_ZOOM_STEP : 1 / CANVAS_ZOOM_STEP);
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
  #tipEnds(): Pick<CanvasEdge, "fromEnd" | "toEnd"> {
    if (this.#tips === "none") return { toEnd: "none" };
    if (this.#tips === "start") return { fromEnd: "arrow", toEnd: "none" };
    return { toEnd: "arrow" };
  }

  /** Il colore delle schede scelte: `undefined` quello di serie, `null` se sono diversi. */
  #chosenColor(): string | null | undefined {
    const colors = new Set(this.#selectedNodes().map((node) => node.color ?? ""));
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
    if (this.#destroyed) return;
    this.#canvasOptions.setWriting(items);
  }

  /** La prima scheda scelta, a cui vanno le frecce e Invio. */
  #selectionFocus(): CanvasNode | undefined {
    const first = this.#selection[0];
    return first ? this.#doc?.nodes.find((n) => n.id === first) : undefined;
  }

  #selectAll(): void {
    if (!this.#doc) return;
    this.#selection = this.#doc.nodes.map((n) => n.id);
    this.#edgeSelection = [];
    this.#options.onSelectionChange();
    this.#render();
  }

  /**
   * Le frecce: con la lavagna scrivibile spostano la scelta di `dx`, `dy`;
   * in sola lettura passano alla scheda dopo (`forward`) o prima; senza
   * scelta prendono la prima scheda.
   */
  #nudge(dx: number, dy: number, forward: boolean): void {
    if (!this.#doc) return;
    const focus = this.#selectionFocus();
    if (focus && !this.#readOnly) {
      const patches: CanvasPatch[] = [];
      for (const id of this.#selection) {
        const node = this.#doc.nodes.find((n) => n.id === id);
        if (node) {
          const patch = upsertNodePatch(this.#doc, { ...node, x: node.x + dx, y: node.y + dy });
          if (patch) patches.push(patch);
        }
      }
      this.#commit(patches, "input");
    } else if (focus) {
      const index = this.#doc.nodes.indexOf(focus);
      const next = this.#doc.nodes[index + (forward ? 1 : -1)];
      if (next) {
        this.#selection = [next.id];
        this.#options.onSelectionChange();
        this.#render();
      }
    } else if (this.#doc.nodes.length) {
      this.#selection = [this.#doc.nodes[0].id];
      this.#options.onSelectionChange();
      this.#render();
    }
  }

  /** Il colore `color` (`undefined`: quello di serie) al filo `edge`, o alle schede scelte, o ai fili scelti. */
  #colorSelection(color: string | undefined, edge?: string): void {
    if (!this.#doc || this.#readOnly) return;
    const paint = <T extends { color?: string }>(current: T): T => {
      const next = { ...current };
      if (color === undefined) delete next.color;
      else next.color = color;
      return next;
    };
    const nodes = edge === undefined ? this.#selectedNodes() : [];
    if (nodes.length) {
      const patches = nodes.map((current) => upsertNodePatch(this.#doc!, paint(current)));
      this.#commit(patches.filter((patch): patch is NonNullable<typeof patch> => patch !== null), "input");
      return;
    }
    const ids = edge === undefined ? this.#edgeSelection : [edge];
    const patches = this.#doc.edges
      .filter((one) => ids.includes(one.id))
      .map((current) => upsertEdgePatch(this.#doc!, paint(current)))
      .filter((patch): patch is NonNullable<typeof patch> => patch !== null);
    if (patches.length) this.#commit(patches, "input");
  }

  // --- i colori (T47) ---------------------------------------------------------

  /**
   * Il colore di ciò che il menu colora: il filo `edge`, o le schede scelte,
   * o i fili scelti. `undefined` quello di serie, `null` se sono diversi.
   */
  #targetColor(edge?: string): string | null | undefined {
    if (edge !== undefined) return this.#doc?.edges.find((one) => one.id === edge)?.color;
    if (this.#selectedNodes().length) return this.#chosenColor();
    const colors = new Set((this.#doc?.edges ?? []).filter((one) => this.#edgeSelection.includes(one.id)).map((one) => one.color ?? ""));
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
  #colorSwatches(): ReadonlyMap<CanvasColorChoice, string> {
    const swatches = new Map<CanvasColorChoice, string>([["none", "transparent"]]);
    const probe = document.createElement("span");
    probe.hidden = true;
    this.#root.append(probe);
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
  #openColorPicker(edge?: string): void {
    if (!this.#doc || this.#readOnly || this.#destroyed) return;
    this.#colorPicker?.close();
    const current = this.#targetColor(edge);
    const own = openLifetime();
    const free = new Set<string>();
    for (const one of [...this.#doc.nodes, ...this.#doc.edges]) {
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
        this.#recordPending();
        this.#colorSelection(value, edge);
      },
      lifetime: own,
    });
    const first = edge === undefined && this.#selection[0];
    const card = first ? this.#stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(first)}"]`) : null;
    const handle = openPopover({
      anchor: card ?? this.#viewport,
      content: picker.element,
      label: t("canvas.color.command.other"),
      className: "kit-color-popover",
      lifetime: own,
      onClose: () => {
        if (this.#colorPicker === handle) this.#colorPicker = null;
        own.close();
      },
    });
    this.#colorPicker = handle;
    picker.focus();
  }

  /** Il filo `edge` va nell'altro verso: estremi, lati e punte si scambiano. */
  #reverseEdge(edge: string | undefined): void {
    if (!this.#doc || this.#readOnly || edge === undefined) return;
    const current = this.#doc.edges.find((one) => one.id === edge);
    if (!current) return;
    const next = { ...current, fromNode: current.toNode, toNode: current.fromNode };
    for (const [from, to] of [["fromSide", "toSide"], ["fromEnd", "toEnd"]] as const) {
      const a = current[from];
      const b = current[to];
      if (b === undefined) delete next[from];
      else (next as Record<string, unknown>)[from] = b;
      if (a === undefined) delete next[to];
      else (next as Record<string, unknown>)[to] = a;
    }
    const patch = upsertEdgePatch(this.#doc, next);
    if (patch) this.#commit([patch], "input");
  }

  /**
   * Apre la ricerca dei comandi sopra la tela, in alto al centro. Esc la
   * chiude e rimette il fuoco dov'era, anche nel campo di una scheda; un
   * comando scelto chiude prima il campo (il testo si registra) e poi parte.
   */
  #openCommandSearch(): void {
    if (this.#destroyed || !this.#doc || this.#searching) return;
    const recents = this.#options.recentCommands ?? SHARED_RECENT_COMMANDS;
    const documentId = this.#options.documentId ?? "";
    const viewport = this.#viewport;
    const anchor = {
      getBoundingClientRect: () => {
        const rect = viewport.getBoundingClientRect();
        return { left: rect.left, top: rect.top + 8, width: rect.width, height: 0 };
      },
    };
    const commands = this.commands().filter((command) => command.id !== "canvas.commands");
    this.#searching = true;
    const search = openCommandSearch({
      anchor,
      commands,
      recent: () => recents.list(documentId),
      lifetime: this.#life,
      onClose: (reason, chosen) => {
        this.#commandSearch = null;
        this.#searching = false;
        if (this.#destroyed) return;
        const editor = this.#editor;
        if (chosen) {
          if (editor) this.#leaveField(true);
          recents.remember(documentId, chosen.id);
          if (chosen.disabled() === null) chosen.run();
          this.#statusSettle();
          return;
        }
        // Esc riporta il fuoco nel campo; un gesto fuori lo lascia, come
        // l'avrebbe lasciato senza la ricerca.
        if (editor && reason !== "escape" && document.activeElement !== editor.input) this.#leaveField(false);
      },
    });
    this.#commandSearch = search;
    // I recenti ricordati arrivano dopo la prima lettura, e l'elenco si rifà.
    void recents.load(documentId).then(() => {
      if (this.#commandSearch === search) search.refresh();
    });
  }

  // --- menu -----------------------------------------------------------------------

  /** Il menu del tasto destro nel punto `at` della finestra (`null`: dalla
   *  tastiera, sulla selezione). Una scheda o un collegamento fuori dalla
   *  selezione diventano la selezione; sul vuoto si aggiunge lì. */
  contextMenu(at: { x: number; y: number } | null): SurfaceMenu | null {
    if (this.#destroyed || !this.#doc || this.#isSceneOversized()) return null;
    const element = at ? document.elementFromPoint(at.x, at.y) : null;
    if (at && (!element || !this.#viewport.contains(element))) return null;
    const node = element ? this.#nodeAt(element) : this.#selection[0] ?? null;
    const edge = node ? null : element ? this.#edgeAt(element) : this.#edgeSelection[0] ?? null;
    const chosen = node ? !this.#selection.includes(node) : edge ? !this.#edgeSelection.includes(edge) : at !== null && (this.#selection.length > 0 || this.#edgeSelection.length > 0);
    if (chosen) {
      this.#selection = node ? [node] : [];
      this.#edgeSelection = edge ? [edge] : [];
      this.#options.onSelectionChange();
      this.#displaySelection();
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
          this.#statusSettle();
          if (refocus) this.#viewport.focus();
        },
      };
    };
    const writable = !this.#readOnly;
    // «Colore ›» (T47): Nessuno e i sei di JSON Canvas col loro pallino,
    // «Colori delle note ›» coi nove, «Altro…» che apre il selettore. Tutte
    // scelte esclusive, segnata quella di adesso; `null` (colori diversi) non
    // ne segna nessuna, come un colore che non è un colore.
    let swatches: ReadonlyMap<CanvasColorChoice, string> | null = null;
    const colors: ColorMenuMaker = (current, args) => {
      swatches ??= this.#colorSwatches();
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
      const nodes = this.#selectedNodes();
      const one = nodes.length === 1 ? nodes[0]! : null;
      const box = this.#stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(node)}"]`)?.getBoundingClientRect();
      const at = box ? { x: Math.round(box.left), y: Math.round(box.bottom) + 4 } : undefined;
      // Copia, Taglia e Incolla portano le schede, i fili fra loro e l'inchiostro (T68).
      const clipboard: SurfaceMenuClipboard = {
        offers: { cut: writable, copy: true, paste: writable },
        run: (op) => this.#clipboardMenu(op),
      };
      if (one?.type !== "group") {
        return { target: this.#cardMenuTarget(nodes, node), at, context: this.#cardMenu(nodes, entry, colors), clipboard };
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
      const current = this.#doc.edges.find((one) => one.id === edge);
      if (!current) return null;
      return {
        target: { kind: "edge", ref: edge },
        context: [colors(current.color, { edge }), entry("canvas.edge.reverse", { edge }), entry("canvas.delete")],
      };
    }
    const here = at ? { at } : undefined;
    return {
      target: { kind: "empty" },
      clipboard: { offers: { paste: writable }, run: (op) => this.#clipboardMenu(op) },
      context: [
        {
          id: "canvas.add",
          label: t("canvas_menu.add_here"),
          enabled: writable,
          items: [
            entry("canvas.add.text", here),
            ...(this.#options.onPickFile ? [entry("canvas.add.file", here, false)] : []),
            entry("canvas.add.link", here),
            entry("canvas.add.group", here),
          ],
        },
        entry("canvas.fit", undefined, false),
        ...(at ? [entry("canvas.zoom_in", here, false), entry("canvas.zoom_out", here, false)] : []),
        // Nascondi o Mostra il navigatore (T55), quella che c'è.
        ...["canvas.navigator.hide", "canvas.navigator.show"].filter((id) => catalog.has(id)).map((id) => entry(id, undefined, false)),
      ],
    };
  }

  /**
   * La testata del menu di una scheda (T17): «Scheda di {specie}» col nome
   * (il file, l'indirizzo, la prima riga del testo), o «{n} schede».
   */
  #cardMenuTarget(nodes: readonly CanvasNode[], ref: string): SurfaceMenu["target"] {
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
   * col perché, non nascoste.
   */
  #cardMenu(nodes: readonly CanvasNode[], entry: MenuEntryMaker, colors: ColorMenuMaker): SurfaceMenuEntry[] {
    const one = nodes.length === 1 ? nodes[0]! : null;
    const readOnly = this.#readOnly ? t("canvas.commands.why.read_only") : null;
    const state = (why: string | null): Pick<SurfaceMenuItem, "enabled" | "description"> =>
      why === null ? { enabled: true } : { enabled: false, description: why };
    const context: SurfaceMenuEntry[] = [];
    if (one?.type === "text") context.push(entry("canvas.edit", undefined, false));
    if (one?.type === "file" && one.file) {
      context.push(entry(cardKindOf(one) === "image" ? "canvas.open_viewer" : "canvas.open", undefined, false));
      if (this.#options.onOpenPathBeside) context.push(entry("canvas.open_beside", undefined, false));
      // «Spargi le pagine…» (T72): solo su un PDF; spenta, col perché, se non si apre.
      if (cardKindOf(one) === "pdf") context.push(entry("canvas.spread_pages", undefined, false));
    }
    if (one?.type === "link") {
      context.push(entry("canvas.open_url", undefined, false));
      if (this.#options.cards) context.push(entry("canvas.web_preview", undefined, false));
    }
    // Collega… si fa anche con C, il tasto dello strumento.
    if (one) context.push(entry("canvas.connect", undefined, true, { chord: menuChord([CANVAS_TOOL_KEYS.connect]) }));
    if (context.length) context.push(MENU_RULE);
    const two = nodes.length >= 2 ? null : t("canvas.commands.why.two");
    const three = nodes.length >= 3 ? null : t("canvas.commands.why.three");
    context.push(
      { ...colors(this.#chosenColor()), ...state(readOnly) },
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
        ],
      },
      entry("canvas.duplicate"),
      MENU_RULE,
      entry("canvas.delete"),
    );
    if (this.#options.onTrashPath && nodes.some((node) => node.type === "file")) context.push(entry("canvas.trash_file", undefined, false));
    return context;
  }

  // --- pointer ------------------------------------------------------------------

  #nodeAt(target: EventTarget | null): string | null {
    const el = target instanceof Element ? target.closest<HTMLElement>(".canvas-node") : null;
    return el?.dataset.node ?? null;
  }

  #edgeAt(target: EventTarget | null): string | null {
    const el = target instanceof Element ? target.closest<SVGElement>(".canvas-edge-hit") : null;
    return el?.dataset.edge ?? null;
  }
  #displaySelection(): void {
    for (const el of this.#stage.querySelectorAll<HTMLElement>(".canvas-node")) {
      el.classList.toggle("selected", this.#selection.includes(el.dataset.node ?? ""));
    }
    if (this.#doc && !this.#isSceneOversized()) this.#drawEdges();
    this.#syncSelectionFrame();
    this.#drawToolbar();
  }

  #pointerDown(event: PointerEvent): void {
    // Un clic fuori dalle maniglie chiude il doppio clic che le adatta (T66).
    if (!(event.target instanceof Element && event.target.closest("[data-resize], [data-resize-frame]"))) this.#handleTap = null;
    // Prima di ogni gesto, il testo in sospeso (non i clic dentro il campo).
    if (!(event.target instanceof Node && this.#editor?.input.contains(event.target))) this.#recordPending();
    const pressed = this.#nodeAt(event.target);
    this.#pressedSelected = pressed !== null && this.#selection.length === 1 && this.#selection[0] === pressed
      ? pressed
      : null;
    // Un clic fuori dalla scheda attiva ne esce. La penna no: scrive sopra
    // anche una scheda attiva (N4).
    if (this.#activeId !== null && event.pointerType !== "pen" && !this.#insideActive(event.target, false)) {
      this.#leaveCard(false);
    }
    if (event.pointerType === "touch") this.#touchDown(event);
    else this.#mouseDown(event);
  }

  #mouseDown(event: PointerEvent): void {
    const modifier = event.ctrlKey || event.metaKey;
    // Ctrl+clic (Cmd+clic) su un link di una scheda lo segue (D-18 (c)): il
    // `click` deve arrivare al link, non a uno spostamento della lavagna.
    if (event.button === 0 && modifier && this.#cardLinkAt(event.target) !== null) return;
    // Spazio tenuto: il tasto principale sposta la vista, con qualsiasi
    // strumento e sopra ogni cosa (T53).
    if (event.button === 0 && this.#spaceHeld) {
      // Il clic che segue non entra nella scheda scelta sotto il puntatore.
      this.#pressedSelected = null;
      this.#beginPan(event.pointerId, event.clientX, event.clientY);
      event.preventDefault();
      return;
    }
    // Una maniglia vince su Alt (dal centro) e su Maiusc (le proporzioni):
    // i tasti si leggono mentre si tira (T66). La Mano sposta e basta.
    if (event.button === 0 && !modifier && this.#tool !== "hand" && this.#resizeFromHandle(event)) return;
    // Alt+trascina dal corpo di una scheda tira un filo (T67); nel vuoto Alt
    // sposta ancora la vista.
    if (event.button === 0 && event.altKey && !modifier && this.#tool !== "hand"
      && !this.#insideActive(event.target, false)) {
      const from = this.#nodeAt(event.target);
      if (from && this.#beginConnect(event, { from })) return;
    }
    if (event.button === 1 || modifier || event.altKey) {
      const toggle = event.button === 0 && modifier && !event.altKey ? this.#nodeAt(event.target) ?? undefined : undefined;
      this.#pan = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, camX: this.#camera.x, camY: this.#camera.y, toggle };
      this.#viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    // La Mano sposta la lavagna, anche sopra le schede, e non sceglie niente.
    if (this.#tool === "hand") {
      this.#beginPan(event.pointerId, event.clientX, event.clientY);
      event.preventDefault();
      return;
    }
    const target = event.target;
    const endpoint = target instanceof Element ? target.closest<SVGElement>("[data-reconnect]") : null;
    if (endpoint && !this.#readOnly) {
      const edge = this.#doc?.edges.find((entry) => entry.id === endpoint.dataset.reconnect);
      if (!edge) return;
      const side = endpoint.dataset.endpoint === "from" ? "from" : "to";
      this.#beginConnect(event, { from: edge.fromNode, edgeId: edge.id, endpoint: side });
      return;
    }
    const connectHandle = target instanceof Element ? target.closest<HTMLElement>("[data-connect]") : null;
    if (connectHandle) {
      if (this.#readOnly) return;
      this.#beginConnect(event, { from: connectHandle.dataset.connect! });
      return;
    }
    // I quattro punti sui lati (T67): il filo parte da quel lato.
    const port = target instanceof Element ? target.closest<HTMLElement>(".canvas-port") : null;
    const portOwner = port ? this.#nodeAt(port) : null;
    if (port && portOwner) {
      this.#beginConnect(event, { from: portOwner, fromSide: port.dataset.side as EdgeSide });
      return;
    }
    const nodeId = this.#nodeAt(target);
    // Collega: da una scheda si trascina il filo fino a un'altra, come dalla
    // maniglia di collegamento.
    if (nodeId && this.#tool === "connect" && !this.#readOnly) {
      // Dopo «Collega…» il filo parte dalla scheda scelta allora, e il clic
      // su un'altra lo chiude dove si alza (T17).
      const from = this.#connectFrom;
      this.#connectFrom = null;
      this.#beginConnect(event, from !== null && from !== nodeId ? { from, back: true } : { from: nodeId });
      return;
    }
    // Un filo entro 8 px vince sulla scheda dove si vede, fuori dalla scheda (T67).
    const wire = this.#wireAt(target, event.clientX, event.clientY);
    if (wire) {
      this.#selectEdge(wire);
      return;
    }
    if (nodeId) {
      this.#selectNode(nodeId, event.shiftKey);
      this.#keepContentFocus(event, nodeId);
      if (this.#readOnly || !this.#doc || !(target instanceof Element && target.closest(".canvas-node-handle"))) return;
      this.#beginDrag(event);
      return;
    }
    const edgeId = this.#edgeAt(target);
    if (edgeId) {
      this.#selectEdge(edgeId);
      return;
    }
    // Testo: un clic sul vuoto mette lì una scheda di testo, col campo aperto,
    // e la colonna torna alla Selezione.
    if (this.#tool === "text" && !this.#readOnly) {
      event.preventDefault();
      this.#placeText(event.clientX, event.clientY);
      return;
    }
    if (!event.shiftKey) this.#clearSelection();
    this.#beginPan(event.pointerId, event.clientX, event.clientY);
  }

  /**
   * La scheda di testo dello strumento Testo, nel punto `clientX`, `clientY` della
   * finestra; senza punto, al centro della vista («Scrivi una scheda», T62). Si
   * apre in scrittura. Con `link` (un filo lasciato nel vuoto, T67) nasce
   * collegata alla scheda `link.from`, nello stesso commit.
   */
  #placeText(clientX?: number, clientY?: number, link?: CardLink): void {
    const at = clientX === undefined || clientY === undefined ? undefined : this.#screenToWorld(clientX, clientY);
    const placed = this.#addNode("text", undefined, at, link);
    if (!placed) return;
    this.#pickTool("select");
    this.#render();
    this.#beginCardEdit(placed);
  }

  /** La lavagna vuota (T62): le righe e i pulsanti, se la lavagna è vuota e si può scrivere. */
  #syncEmpty(): void {
    const doc = this.#doc;
    this.#empty.sync({
      empty: !this.#destroyed && doc !== null && isEmptyBoard(doc),
      editable: !this.#readOnly && !this.#isSceneOversized(),
    });
  }

  /**
   * Ciò che la lavagna vuota riceve, dagli appunti o dal selettore dei file: lo
   * stesso evento di Ctrl+V sulla vista, così passa dalla stessa strada
   * (`#intake`) e dal deposito, come un rilascio.
   */
  #receive(data: DataTransfer): void {
    this.#viewport.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }

  /** La scheda `nodeId` presa col clic: `additive` (Maiuscolo) la aggiunge o la toglie. */
  #selectNode(nodeId: string, additive: boolean): void {
    if (additive) {
      this.#selection = this.#selection.includes(nodeId)
        ? this.#selection.filter((id) => id !== nodeId)
        : [...this.#selection, nodeId];
    } else if (!this.#selection.includes(nodeId)) {
      this.#selection = [nodeId];
    } else {
      return;
    }
    this.#edgeSelection = [];
    this.#options.onSelectionChange();
    this.#displaySelection();
  }

  #selectEdge(edgeId: string): void {
    this.#edgeSelection = [edgeId];
    this.#selection = [];
    this.#options.onSelectionChange();
    this.#displaySelection();
  }

  #clearSelection(): void {
    this.#selection = [];
    this.#edgeSelection = [];
    this.#options.onSelectionChange();
    this.#displaySelection();
  }

  /** Comincia a trascinare le schede scelte, e ciò che i gruppi scelti contengono. */
  #beginDrag(event: PointerEvent): void {
    if (!this.#doc) return;
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of this.#selection) {
      const node = this.#doc.nodes.find((n) => n.id === id);
      if (node) origin.set(id, { x: node.x, y: node.y });
    }
    // A group carries every card fully inside it. Containment is geometric,
    // not a second persisted parent relation that would conflict with Canvas.
    for (const group of this.#doc.nodes.filter((node) => origin.has(node.id) && node.type === "group")) {
      for (const child of this.#doc.nodes) {
        if (child.id !== group.id && child.x >= group.x && child.y >= group.y
          && child.x + child.width <= group.x + group.width
          && child.y + child.height <= group.y + group.height) {
          origin.set(child.id, { x: child.x, y: child.y });
        }
      }
    }
    this.#drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, moved: false };
    this.#viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  #beginPan(pointerId: number, clientX: number, clientY: number): void {
    this.#pan = { pointerId, startX: clientX, startY: clientY, camX: this.#camera.x, camY: this.#camera.y };
    this.#viewport.setPointerCapture?.(pointerId);
  }

  // --- il dito -----------------------------------------------------------------

  /** «Il dito sposta le schede», adesso. */
  #fingerMovesCard(): boolean {
    return this.#options.fingerMovesCard ? this.#options.fingerMovesCard() : this.#fingerMovesCardSetting;
  }

  /**
   * Un dito si posa. Il primo sposta la lavagna, anche sopra le schede, e se
   * si alza presto e vicino fa quello che fa un clic; con «Il dito sposta le
   * schede» sopra una scheda la sposta. Le maniglie (testata, ridimensiona,
   * collega) e i controlli (pulsanti, collegamenti, campi) fanno come col
   * mouse; in sola lettura le maniglie spostano la lavagna. Il secondo dito
   * comincia il pizzico, salvo durante un gesto su una scheda, che tiene il
   * dito suo. Con una penna giù il dito non fa niente, e il palmo nemmeno.
   */
  #touchDown(event: PointerEvent): void {
    if (this.#penDown || this.#palm(event.pointerId) || this.#drag || this.#resize || this.#connect || this.#pinch) return;
    this.#fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.#fingers.size >= 2) {
      this.#beginPinch();
      event.preventDefault();
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    // Vicino a un angolo della scelta il dito prende la maniglia (T66); un
    // controllo sotto il dito (il pulsante del filo) resta suo.
    if (!target?.closest(FINGER_CONTROLS) && this.#resizeFromFinger(event)) return;
    if (target?.closest(FINGER_CONTROLS) || (!this.#readOnly && target?.closest(FINGER_HANDLES))) {
      this.#mouseDown(event);
      return;
    }
    const nodeId = this.#nodeAt(target);
    if (nodeId && !this.#readOnly && this.#doc && this.#fingerMovesCard()) {
      this.#selectNode(nodeId, event.shiftKey);
      this.#beginDrag(event);
      return;
    }
    this.#tap = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, at: event.timeStamp, target, shift: event.shiftKey };
    this.#beginPan(event.pointerId, event.clientX, event.clientY);
  }

  /**
   * Il dito `pointerId` è il palmo: lo decide la sessione della penna
   * (`ink/input/roles.ts`), che fa palmo ogni dito con una penna giù o
   * sospesa, e le dita già giù quando la penna arriva. Senza lo strato (sola
   * lettura) non c'è penna che scriva, e nessun dito è palmo.
   */
  #palm(pointerId: number): boolean {
    return this.#inkLayer?.roleOf(pointerId) === "ignore";
  }

  /** Le prime due dita giù diventano un pizzico: il pan e il tocco breve finiscono. */
  #beginPinch(): void {
    const [a, b] = [...this.#fingers.keys()];
    if (a === undefined || b === undefined) return;
    this.#pan = null;
    this.#tap = null;
    this.#pinch = { a, b, a0: this.#local(this.#fingers.get(a)!), b0: this.#local(this.#fingers.get(b)!), start: { ...this.#camera } };
    this.#viewport.setPointerCapture?.(b);
  }

  /** Un punto del client in coordinate del viewport. */
  #local(point: TouchPoint): TouchPoint {
    const rect = this.#viewport.getBoundingClientRect();
    return { x: point.x - rect.left, y: point.y - rect.top };
  }

  /** Un dito si muove: `true` se l'ha preso il dito, `false` se tocca al gesto comune. */
  #touchMove(event: PointerEvent): boolean {
    if (!this.#fingers.has(event.pointerId)) return true;
    this.#fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // La penna vince, giù o sospesa: il dito si ferma, e una scheda che
    // spostava torna dov'era.
    if (this.#penDown || this.#palm(event.pointerId)) {
      this.#cancelGestures();
      return true;
    }
    const pinch = this.#pinch;
    if (pinch) {
      const a = this.#fingers.get(pinch.a);
      const b = this.#fingers.get(pinch.b);
      if (a && b && (event.pointerId === pinch.a || event.pointerId === pinch.b)) {
        this.#camera = { ...pinchCamera(pinch.start, pinch.a0, pinch.b0, this.#local(a), this.#local(b), ZOOM_LIMITS) };
        this.#applyCamera();
      }
      return true;
    }
    const tap = this.#tap;
    if (tap?.pointerId === event.pointerId && !isTap(tap.startX, tap.startY, event.clientX, event.clientY, 0)) this.#tap = null;
    return false;
  }

  /**
   * Un dito si alza: `true` se l'ha preso il dito. Dal pizzico, il dito che
   * resta sposta la lavagna; un tocco breve fa quello che fa un clic.
   */
  #touchUp(event: PointerEvent): boolean {
    if (!this.#fingers.delete(event.pointerId)) return true;
    const pinch = this.#pinch;
    if (pinch) {
      if (event.pointerId !== pinch.a && event.pointerId !== pinch.b) return true;
      this.#pinch = null;
      const rest = [...this.#fingers][0];
      if (rest) this.#beginPan(rest[0], rest[1].x, rest[1].y);
      return true;
    }
    const tap = this.#tap;
    if (tap?.pointerId !== event.pointerId) return false;
    this.#tap = null;
    this.#pan = null;
    if (isTap(tap.startX, tap.startY, event.clientX, event.clientY, event.timeStamp - tap.at)) this.#tapAt(tap.target, tap.shift);
    return true;
  }

  /** Il tocco breve su `target`: sceglie come il clic del mouse. */
  #tapAt(target: Element | null, additive: boolean): void {
    if (!target?.isConnected) return;
    const nodeId = this.#nodeAt(target);
    if (nodeId) {
      this.#selectNode(nodeId, additive);
      return;
    }
    const edgeId = this.#edgeAt(target);
    if (edgeId) this.#selectEdge(edgeId);
    else if (!additive) this.#clearSelection();
  }

  // --- ridimensionare (T66) ---------------------------------------------------

  /**
   * Il mouse (o il dito, o la penna) giù su una maniglia: comincia il
   * ridimensionamento della sua scheda, o della scelta se è una maniglia
   * della cornice. `false` se sotto non c'è una maniglia che si possa tirare.
   */
  #resizeFromHandle(event: PointerEvent): boolean {
    if (this.#readOnly || !this.#doc) return false;
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest<HTMLElement>("[data-resize], [data-resize-frame]");
    if (!handle) return false;
    const corner = cornerOf(handle.dataset.corner);
    const ids = handle.dataset.resize !== undefined ? [handle.dataset.resize] : this.#resizableSelection();
    if (!this.#beginResize(event, corner, ids)) return false;
    event.preventDefault();
    return true;
  }

  /**
   * Il dito giù vicino a un angolo della scheda scelta, o della cornice della
   * scelta: la presa è di 44 px sullo schermo a ogni zoom, più larga di
   * quella del mouse. Lo spazio Semplice (T65) non c'è ancora: decide il
   * tipo di puntatore.
   */
  #resizeFromFinger(event: PointerEvent): boolean {
    if (this.#readOnly || !this.#doc || this.#isSceneOversized()) return false;
    const ids = this.#resizableSelection();
    const box = this.#boxOf(ids);
    if (!box) return false;
    const rect = this.#viewport.getBoundingClientRect();
    const { x: camX, y: camY, zoom } = this.#camera;
    let best: { corner: ResizeCorner; distance: number } | null = null;
    for (const corner of this.#cornersOf(box)) {
      const east = corner === "ne" || corner === "se";
      const south = corner === "sw" || corner === "se";
      const x = rect.left + camX + (box.x + (east ? box.width : 0)) * zoom;
      const y = rect.top + camY + (box.y + (south ? box.height : 0)) * zoom;
      const distance = Math.max(Math.abs(event.clientX - x), Math.abs(event.clientY - y));
      if (distance <= RESIZE_FINGER_GRIP_PX && (!best || distance < best.distance)) best = { corner, distance };
    }
    if (!best || !this.#beginResize(event, best.corner, ids)) return false;
    event.preventDefault();
    return true;
  }

  /**
   * Le schede che un doppio clic su una maniglia adatta: quelle dell'ultima
   * maniglia presa senza muoversi, o quelle della maniglia sotto `target`;
   * `null` se il doppio clic non è su una maniglia. Si usa una volta.
   */
  #takeHandleTap(target: EventTarget | null): readonly string[] | null {
    const tap = this.#handleTap;
    this.#handleTap = null;
    if (tap) return tap;
    const handle = target instanceof Element ? target.closest<HTMLElement>("[data-resize], [data-resize-frame]") : null;
    if (!handle) return null;
    return handle.dataset.resize !== undefined ? [handle.dataset.resize] : this.#resizableSelection();
  }

  /** Le schede scelte che il documento ha. */
  #resizableSelection(): string[] {
    const doc = this.#doc;
    if (!doc) return [];
    return this.#selection.filter((id) => doc.nodes.some((node) => node.id === id));
  }

  /** Il rettangolo attorno alle schede `ids` del documento di adesso. */
  #boxOf(ids: readonly string[]): ResizeBox | null {
    const doc = this.#doc;
    if (!doc) return null;
    return boxAround(ids.flatMap((id) => doc.nodes.filter((node) => node.id === id)));
  }

  /** Le maniglie che una cornice mostra a questo zoom: troppo piccola, solo quella in basso a destra. */
  #cornersOf(box: ResizeBox): readonly ResizeCorner[] {
    return tinyOnScreen(box, this.#camera.zoom) ? ["se"] : RESIZE_CORNERS;
  }

  #beginResize(event: PointerEvent, corner: ResizeCorner, ids: readonly string[]): boolean {
    const doc = this.#doc;
    if (!doc) return false;
    const origin = new Map<string, ResizeBox>();
    for (const id of ids) {
      const node = doc.nodes.find((entry) => entry.id === id);
      if (node) origin.set(id, { x: node.x, y: node.y, width: node.width, height: node.height });
    }
    const box = boxAround([...origin.values()]);
    if (!box) return false;
    this.#resize = { pointerId: event.pointerId, corner, startX: event.clientX, startY: event.clientY, box, origin, moved: false };
    this.#viewport.setPointerCapture?.(event.pointerId);
    return true;
  }

  /**
   * Il puntatore che tira una maniglia: Maiusc tiene le proporzioni, Alt
   * tiene fermo il centro, tutti e due insieme. Una scheda sola ha
   * l'aggancio di 8 px (A-23); la scelta scala tutto, posizioni comprese,
   * senza che una scheda scenda sotto il minimo. L'inchiostro attaccato sta
   * nella scheda e la segue nella resa (N4).
   */
  #moveResize(event: PointerAt): void {
    const resize = this.#resize;
    const doc = this.#doc;
    if (!resize || !doc) return;
    // Un clic sulla maniglia (o il primo dei due del doppio clic) non cambia
    // la scheda: senza questo l'aggancio la porterebbe subito sulla griglia.
    if (Math.abs(event.clientX - resize.startX) + Math.abs(event.clientY - resize.startY) > 3) resize.moved = true;
    if (!resize.moved) return;
    const dx = (event.clientX - resize.startX) / this.#camera.zoom;
    const dy = (event.clientY - resize.startY) / this.#camera.zoom;
    const single = resize.origin.size === 1;
    const starts = [...resize.origin.values()];
    const narrowest = Math.max(1, Math.min(...starts.map((start) => start.width)));
    const shortest = Math.max(1, Math.min(...starts.map((start) => start.height)));
    const box = resizeBox(resize.box, resize.corner, dx, dy, {
      keepRatio: event.shiftKey,
      fromCenter: event.altKey,
      snap: single,
      minWidth: single ? CANVAS_MIN_SIZE : resize.box.width * Math.min(1, CANVAS_MIN_SIZE / narrowest),
      minHeight: single ? CANVAS_MIN_SIZE : resize.box.height * Math.min(1, CANVAS_MIN_SIZE / shortest),
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
    this.#renderLive();
  }

  /**
   * La cornice della scelta: con due schede scelte o più, attorno a tutte,
   * con le sue quattro maniglie che scalano tutto; le maniglie delle schede
   * allora si nascondono (`data-selection="many"`). In sola lettura niente.
   */
  #syncSelectionFrame(): void {
    const ids = !this.#readOnly && !this.#isSceneOversized() ? this.#resizableSelection() : [];
    const box = ids.length >= 2 ? this.#boxOf(ids) : null;
    if (box) this.#stage.dataset.selection = "many";
    else delete this.#stage.dataset.selection;
    if (!box) {
      this.#selectionFrame?.remove();
      return;
    }
    let frame = this.#selectionFrame;
    if (!frame) {
      frame = document.createElement("div");
      frame.className = "canvas-selection-frame";
      frame.setAttribute("aria-hidden", "true");
      for (const corner of RESIZE_CORNERS) frame.append(resizeHandle(corner, null));
      this.#selectionFrame = frame;
    }
    frame.style.transform = `translate(${box.x}px, ${box.y}px)`;
    frame.style.width = `${box.width}px`;
    frame.style.height = `${box.height}px`;
    markHandles(frame, box, this.#camera.zoom);
    // Sopra le schede e l'inchiostro libero: le sue maniglie si prendono.
    if (frame.parentElement !== this.#stage || frame.nextSibling) this.#stage.append(frame);
  }

  /** Lo zoom è cambiato: le schede (e la cornice) troppo piccole tengono solo una maniglia. */
  #markAllHandles(): void {
    const zoom = this.#camera.zoom;
    if (zoom === this.#handlesZoom) return;
    this.#handlesZoom = zoom;
    for (const entry of this.#cards.values()) markHandles(entry.article, entry.node, zoom);
    const frame = this.#selectionFrame;
    const box = frame?.isConnected ? this.#boxOf(this.#resizableSelection()) : null;
    if (frame && box) markHandles(frame, box, zoom);
  }

  /**
   * Il doppio clic su una maniglia: ogni scheda `ids` prende la misura del
   * suo contenuto, in un commit e un annulla. Una scheda di testo la misura
   * del suo testo, fino a `CANVAS_TEXT_FIT_MAX_WIDTH` di larghezza;
   * un'immagine o un PDF le proporzioni del contenuto alla larghezza di
   * adesso; le altre non cambiano. L'angolo in alto a sinistra resta.
   */
  #fitToContent(ids: readonly string[]): void {
    const doc = this.#doc;
    if (!doc || this.#readOnly || this.#isSceneOversized()) return;
    let changed = false;
    for (const id of ids) {
      const node = doc.nodes.find((entry) => entry.id === id);
      const entry = this.#cards.get(id);
      if (!node || !entry) continue;
      const size = this.#contentSize(entry, node);
      if (!size || (size.width === node.width && size.height === node.height)) continue;
      node.width = size.width;
      node.height = size.height;
      changed = true;
    }
    if (changed) this.#commitFromSource("input");
  }

  /** La misura del contenuto della scheda `node`; `null` se non c'è o non si sa. */
  #contentSize(entry: CardEntry, node: CanvasNode): { width: number; height: number } | null {
    if (node.type === "text") {
      // Col campo aperto il testo è nel campo, che non ha una misura sua.
      if (this.#editor?.id === node.id) return null;
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

  #pointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch" && this.#touchMove(event)) return;
    if (this.#connect && event.pointerId === this.#connect.pointerId) {
      this.#moveConnect(event.clientX, event.clientY);
      // Vicino al bordo la vista scorre da sola (T53).
      if (this.#connect.moved) this.#trackEdge(event);
      return;
    }
    if (!this.#pan && !this.#resize && !this.#drag && event.pointerType === "mouse") {
      this.#hoverEdge(event.clientX, event.clientY, event.target);
    }
    if (this.#pan && event.pointerId === this.#pan.pointerId) {
      this.#camera.x = this.#pan.camX + (event.clientX - this.#pan.startX);
      this.#camera.y = this.#pan.camY + (event.clientY - this.#pan.startY);
      // La scia del dito, per l'inerzia del rilascio (T53).
      if (event.pointerType === "touch") {
        const trail = this.#pan.trail ??= [];
        trail.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
        while (trail.length > 1 && event.timeStamp - trail[0]!.t > INERTIA_WINDOW_MS) trail.shift();
      }
      this.#applyCamera();
      return;
    }
    if (this.#resize && event.pointerId === this.#resize.pointerId && this.#doc) {
      this.#moveResize(event);
      if (this.#resize.moved) this.#trackEdge(event);
      return;
    }
    if (this.#drag && event.pointerId === this.#drag.pointerId && this.#doc) {
      this.#moveDrag(event);
      if (this.#drag.moved) this.#trackEdge(event);
    }
  }

  /** Le schede che si trascinano seguono il puntatore `at`. */
  #moveDrag(at: PointerAt): void {
    const drag = this.#drag;
    const doc = this.#doc;
    if (!drag || !doc) return;
    const dx = (at.clientX - drag.startX) / this.#camera.zoom;
    const dy = (at.clientY - drag.startY) / this.#camera.zoom;
    if (Math.abs(at.clientX - drag.startX) + Math.abs(at.clientY - drag.startY) > 3) {
      drag.moved = true;
    }
    for (const [id, origin] of drag.origin) {
      const node = doc.nodes.find((n) => n.id === id);
      if (node) {
        node.x = snap(origin.x + dx);
        node.y = snap(origin.y + dy);
      }
    }
    this.#renderLive();
  }

  /**
   * Il rilascio di un puntatore. Se chiude uno spostamento, un pizzico, un
   * trascinamento o un ridimensionamento (A-7), le schede vive si rifanno
   * sulla vista e sulle schede di adesso.
   */
  #pointerUp(event: PointerEvent): void {
    const moving = this.#gestureMoving();
    this.#pointerRelease(event);
    if (moving) this.#refreshLive();
  }

  #pointerRelease(event: PointerEvent): void {
    // Il rilascio ferma lo scorrimento al bordo, anche fuori dalla finestra (T53).
    if (this.#edgeScroll?.pointerId === event.pointerId) this.#stopEdgeScroll();
    if (event.pointerType === "touch" && this.#touchUp(event)) return;
    if (this.#pan && event.pointerId === this.#pan.pointerId) {
      const pan = this.#pan;
      this.#pan = null;
      // Il dito lasciato in corsa: la vista va avanti da sola (T53).
      if (event.pointerType === "touch" && pan.trail) {
        const speed = this.#panSpeed(pan.trail, { t: event.timeStamp, x: event.clientX, y: event.clientY });
        this.#fling(speed.vx, speed.vy);
      }
      // Ctrl+clic fermo su una scheda: la aggiunge alla scelta, o la toglie.
      if (pan.toggle !== undefined
        && Math.abs(event.clientX - pan.startX) + Math.abs(event.clientY - pan.startY) <= 3) {
        this.#camera.x = pan.camX;
        this.#camera.y = pan.camY;
        this.#applyCamera();
        this.#selectNode(pan.toggle, true);
      }
      return;
    }
    if (this.#resize && event.pointerId === this.#resize.pointerId && this.#doc) {
      const resize = this.#resize;
      this.#resize = null;
      this.#handleTap = resize.moved ? null : [...resize.origin.keys()];
      this.#commitFromSource("input");
      return;
    }
    if (this.#drag && event.pointerId === this.#drag.pointerId) {
      const drag = this.#drag;
      this.#drag = null;
      if (drag.moved) this.#commitFromSource("input");
      return;
    }
    if (this.#connect && event.pointerId === this.#connect.pointerId) {
      const connect = this.#connect;
      this.#endConnect();
      // Il filo di «Collega…» fatto, la colonna torna alla Selezione.
      if (connect.back) this.#pickTool("select");
      // Nel vuoto nasce una scheda già in scrittura: la disegna `#placeText`.
      if (this.#finishConnect(connect, event.clientX, event.clientY)) return;
      this.#render();
    }
  }

  // --- i fili (T67) --------------------------------------------------------------

  /**
   * Comincia a tirare un filo (`gesture`): dai punti, da →, con Alt dal
   * corpo, con lo strumento Collega o riattaccando un'estremità. Mai in sola
   * lettura e mai con la penna, che scrive (D3 è v2). Il fuoco va sulla vista,
   * così Esc arriva e annulla.
   */
  #beginConnect(
    event: PointerEvent,
    gesture: Omit<ConnectGesture, "pointerId" | "startX" | "startY" | "moved">,
  ): boolean {
    if (this.#readOnly || !this.#doc || event.pointerType === "pen" || this.#isSceneOversized()) return false;
    if (!this.#doc.nodes.some((node) => node.id === gesture.from)) return false;
    this.#endConnect();
    this.#connect = { ...gesture, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    this.#viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    if (!this.#viewport.contains(document.activeElement)) this.#viewport.focus({ preventScroll: true });
    const draft = document.createElementNS("http://www.w3.org/2000/svg", "path");
    draft.classList.add("canvas-edge-draft");
    this.#connectDraft = draft;
    this.#edgeLayer.append(draft);
    this.#viewport.toggleAttribute("data-connecting", true);
    this.#setEdgeHover(null);
    return true;
  }

  /** Il filo in corso segue il puntatore; sopra una scheda arriva al lato che sceglierà. */
  #moveConnect(clientX: number, clientY: number): void {
    const connect = this.#connect;
    if (!connect || !this.#doc) return;
    if (!connect.moved && Math.abs(clientX - connect.startX) + Math.abs(clientY - connect.startY) > 3) {
      connect.moved = true;
    }
    const target = this.#connectTargetAt(connect, clientX, clientY);
    this.#markConnectTarget(target);
    const ends = this.#connectEnds(connect, target, this.#screenToWorld(clientX, clientY));
    if (ends && this.#connectDraft) this.#connectDraft.setAttribute("d", edgePathData(ends.start, ends.end));
  }

  /**
   * La scheda dove il filo arriverebbe sotto `clientX`, `clientY`: la più in
   * alto, perché `elementFromPoint` dà quella sopra. Un filo nuovo non torna
   * sulla scheda da cui parte.
   */
  #connectTargetAt(connect: ConnectGesture, clientX: number, clientY: number): CanvasNode | null {
    const id = this.#nodeAt(document.elementFromPoint(clientX, clientY));
    if (id === null || (!connect.edgeId && id === connect.from)) return null;
    return this.#doc?.nodes.find((node) => node.id === id) ?? null;
  }

  /** I due capi del filo in corso: il capo fermo e quello che segue il puntatore. */
  #connectEnds(
    connect: ConnectGesture,
    target: CanvasNode | null,
    pointer: EdgePoint,
  ): { start: EdgePoint; end: EdgePoint } | null {
    const doc = this.#doc;
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
  #markConnectTarget(target: CanvasNode | null): void {
    const id = target?.id ?? null;
    if (id === this.#connectTarget) return;
    if (this.#connectTarget !== null) this.#cards.get(this.#connectTarget)?.article.removeAttribute("data-connect-target");
    this.#connectTarget = id;
    if (id !== null) this.#cards.get(id)?.article.toggleAttribute("data-connect-target", true);
  }

  /** Il filo in corso finisce: niente tratto, niente bersaglio, niente gesto. */
  #endConnect(): void {
    this.#connect = null;
    this.#connectDraft?.remove();
    this.#connectDraft = null;
    this.#markConnectTarget(null);
    this.#viewport.removeAttribute("data-connecting");
  }

  /** Esc mentre si tira un filo: non resta niente, come se non fosse cominciato. */
  #cancelConnect(): void {
    const connect = this.#connect;
    if (!connect) return;
    this.#endConnect();
    try {
      this.#viewport.releasePointerCapture?.(connect.pointerId);
    } catch {
      // Il puntatore era già libero.
    }
    if (connect.back) this.#pickTool("select");
  }

  /**
   * Il rilascio del filo `connect` in `clientX`, `clientY`. Su una scheda: il
   * filo, coi lati scelti da `edges.ts`; un'estremità riattaccata cambia
   * scheda. Nel vuoto: un filo nuovo fa nascere lì una scheda di testo
   * collegata, in un commit solo (`true`: la scheda è in scrittura);
   * un'estremità torna dov'era. Sulla scheda di partenza non succede niente.
   */
  #finishConnect(connect: ConnectGesture, clientX: number, clientY: number): boolean {
    const doc = this.#doc;
    if (!doc || this.#readOnly) return false;
    const hit = document.elementFromPoint(clientX, clientY);
    const target = this.#connectTargetAt(connect, clientX, clientY);
    if (connect.edgeId) {
      const existing = doc.edges.find((edge) => edge.id === connect.edgeId);
      if (!existing || !target) return false;
      const movesFrom = connect.endpoint === "from";
      const other = doc.nodes.find((node) => node.id === (movesFrom ? existing.toNode : existing.fromNode));
      if (!other) return false;
      const otherSide = movesFrom ? existing.toSide ?? "left" : existing.fromSide ?? "right";
      const side = nearestSides(other, target, otherSide, other.id === target.id).toSide;
      const edge: CanvasEdge = movesFrom
        ? { ...existing, fromNode: target.id, fromSide: side }
        : { ...existing, toNode: target.id, toSide: side };
      const patch = upsertEdgePatch(doc, edge);
      if (patch) this.#commit([patch], "input");
      return false;
    }
    const source = doc.nodes.find((node) => node.id === connect.from);
    if (!source) return false;
    if (target) {
      const sides = nearestSides(source, target, connect.fromSide);
      const patch = upsertEdgePatch(doc, {
        id: newNodeId("e"), fromNode: source.id, toNode: target.id, ...sides, ...this.#tipEnds(),
      });
      if (patch) this.#commit([patch], "input");
      return false;
    }
    // Nel vuoto, solo dopo un vero tiro e dentro la vista (non sulla
    // scheda di partenza, né fuori dalla lavagna).
    if (!connect.moved || !hit || !this.#viewport.contains(hit) || this.#nodeAt(hit) !== null) return false;
    this.#placeText(clientX, clientY, { from: source.id, fromSide: connect.fromSide });
    return true;
  }

  /** C con due schede scelte (D-19 (a)): un filo dalla prima alla seconda, coi lati di `edges.ts`. */
  #connectPair(from: CanvasNode, to: CanvasNode): void {
    if (!this.#doc || this.#readOnly) return;
    const patch = upsertEdgePatch(this.#doc, {
      id: newNodeId("e"), fromNode: from.id, toNode: to.id, ...nearestSides(from, to), ...this.#tipEnds(),
    });
    if (patch) this.#commit([patch], "input");
  }

  /** I fili con i loro capi sulla lavagna, per cercare quello sotto il puntatore. */
  #placedEdges(): PlacedEdge[] {
    const doc = this.#doc;
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
  #edgeUnder(clientX: number, clientY: number, over: string | null): string | null {
    const doc = this.#doc;
    if (!doc || doc.edges.length === 0 || this.#isSceneOversized()) return null;
    const rect = this.#viewport.getBoundingClientRect();
    const corner = this.#screenToWorld(rect.left, rect.top);
    const zoom = this.#camera.zoom;
    const view = { x: corner.x, y: corner.y, width: (rect.width || 800) / zoom, height: (rect.height || 600) / zoom };
    const hit = edgeAt(this.#screenToWorld(clientX, clientY), this.#placedEdges(), zoom, view);
    if (!hit) return null;
    const card = over === null ? undefined : doc.nodes.find((node) => node.id === over);
    return card && insideBox(hit.point, card) ? null : hit.id;
  }

  /**
   * Il filo che un clic o il passaggio su `target` prende: mai dentro la
   * scheda attiva né sopra un controllo (un punto, una maniglia, un pulsante,
   * un link, un campo), che restano loro.
   */
  #wireAt(target: EventTarget | null, clientX: number, clientY: number): string | null {
    if (this.#insideActive(target, false)) return null;
    if (target instanceof Element && target.closest(".canvas-port, [data-resize], button, a, input, textarea, select")) return null;
    return this.#edgeUnder(clientX, clientY, this.#nodeAt(target));
  }

  /** Il passaggio del mouse: il filo sotto si scurisce (`data-hover`). */
  #hoverEdge(clientX: number, clientY: number, target: EventTarget | null): void {
    this.#setEdgeHover(this.#wireAt(target, clientX, clientY));
  }

  #setEdgeHover(id: string | null): void {
    if (id === this.#edgeHover) return;
    if (this.#edgeHover !== null) this.#edgeGroup(this.#edgeHover)?.removeAttribute("data-hover");
    this.#edgeHover = id;
    if (id !== null) this.#edgeGroup(id)?.toggleAttribute("data-hover", true);
    this.#viewport.toggleAttribute("data-edge-hover", id !== null);
  }

  /** Il gruppo SVG del filo `id` sulla scena. */
  #edgeGroup(id: string): SVGGElement | null {
    for (const hit of this.#edgeLayer.querySelectorAll<SVGPathElement>(".canvas-edge-hit")) {
      if (hit.dataset.edge === id) return hit.parentElement as SVGGElement | null;
    }
    return null;
  }

  /** I quattro punti sui lati della scheda `el` (T67): ci sono solo se si può scrivere. */
  #syncPorts(el: HTMLElement): void {
    const ports = el.querySelectorAll<HTMLElement>(":scope > .canvas-port");
    if (this.#readOnly) {
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

  #cancelGestures(): void {
    const active = this.#drag !== null || this.#resize !== null;
    const moving = this.#gestureMoving();
    this.#drag = null;
    this.#resize = null;
    this.#pan = null;
    this.#endConnect();
    this.#stopEdgeScroll();
    this.#fingers.clear();
    this.#tap = null;
    this.#pinch = null;
    // Il gesto aveva mosso il modello in mano: torna quello del nucleo.
    const model = active && this.#doc ? this.#coreModel() : null;
    if (model) {
      this.#doc = model;
      this.#render();
    }
    // Un gesto fermato (la penna che si posa sotto il dito, un pointercancel)
    // è un gesto finito: la vista è quella dove si è fermato. Con la penna
    // giù il cambio aspetta che si alzi.
    if (moving) this.#refreshLive();
    this.#statusSettle();
  }

  #commitFromSource(origin: EditorChangeOrigin): void {
    if (!this.#doc) return;
    // Ricostruisce le patch confrontando live vs nucleo: preimmagini vere,
    // mai snap del live come before.
    const before = this.#coreModel();
    if (!before) {
      this.#render();
      return;
    }
    const patches: CanvasPatch[] = [];
    const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
    const liveNodes = new Map(this.#doc.nodes.map((n) => [n.id, n]));
    for (const [id, live] of liveNodes) {
      const prev = beforeNodes.get(id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(live)) {
        patches.push({
          kind: "upsert-node",
          before: prev ? JSON.parse(JSON.stringify(prev)) as CanvasNode : null,
          after: JSON.parse(JSON.stringify(live)) as CanvasNode,
        });
      }
    }
    for (const [id, prev] of beforeNodes) {
      if (!liveNodes.has(id)) {
        patches.push({
          kind: "remove-node",
          before: JSON.parse(JSON.stringify(prev)) as CanvasNode,
          at: before.nodes.findIndex((node) => node.id === id),
          after: null,
        });
      }
    }
    const beforeOrder = before.nodes.map((n) => n.id);
    const liveOrder = this.#doc.nodes.map((n) => n.id);
    if (JSON.stringify(beforeOrder) !== JSON.stringify(liveOrder)
      && JSON.stringify([...liveOrder].sort()) === JSON.stringify([...beforeOrder].sort())) {
      patches.push({ kind: "reorder", before: beforeOrder, after: liveOrder });
    }
    this.#doc = before;
    if (patches.length) this.#commit(patches, origin);
    else this.#render();
  }

  #wheel(event: WheelEvent): void {
    // Sopra la scheda attiva la rotella scorre lei (A-11); Ctrl+rotella e il
    // pizzico ingrandiscono sempre la lavagna.
    if (!event.ctrlKey && !event.metaKey && this.#insideActive(event.target, true)) return;
    event.preventDefault();
    // La rotella prende la vista: un volo o un'inerzia si fermano (T53).
    this.#stopMotion(false);
    // Prima di muovere la camera: lo zoom della rotella è un gesto in corso.
    clearTimeout(this.#wheelTimer);
    this.#wheelTimer = setTimeout(() => {
      this.#wheelTimer = undefined;
      this.#refreshLive();
      // La rotella finita è un gesto finito: la banda legge lo zoom nuovo.
      this.#statusSettle();
    }, WHEEL_SETTLE_MS);
    // Il delta in pixel: la pagina della rotella è la vista, misurata solo se serve.
    const page = event.deltaMode === 2 ? this.#viewport.getBoundingClientRect() : null;
    const dx = wheelPixels(event.deltaX, event.deltaMode, page?.width ?? 0);
    const dy = wheelPixels(event.deltaY, event.deltaMode, page?.height ?? 0);
    // Ctrl+rotella e il pizzico ingrandiscono con qualunque impostazione; uno
    // scatto senza parte verticale non ingrandisce.
    if (event.ctrlKey || event.metaKey) {
      if (dy !== 0) this.#zoomAt(event.clientX, event.clientY, dy < 0 ? 1.1 : 1 / 1.1);
      return;
    }
    // Maiusc sposta di lato. Dove il sistema non manda `deltaX`, si usa `deltaY`.
    if (event.shiftKey) {
      this.#camera.x -= dx !== 0 ? dx : dy;
      this.#applyCamera();
      return;
    }
    // `zoom`: la rotella ingrandisce. Un evento con una parte orizzontale (le due
    // dita sul touchpad) sposta, come in `pan`, così il touchpad resta usabile.
    if (this.#wheelSetting === "zoom" && dx === 0) {
      if (dy !== 0) this.#zoomAt(event.clientX, event.clientY, dy < 0 ? 1.1 : 1 / 1.1);
      return;
    }
    this.#camera.x -= dx;
    this.#camera.y -= dy;
    this.#applyCamera();
  }

  #dblclick(event: MouseEvent): void {
    if (this.#readOnly || this.#nodeAt(event.target)) return;
    // Su una maniglia della cornice della scelta: tutte le schede scelte
    // prendono la misura del loro contenuto (T66). Con la cattura del
    // puntatore il doppio clic su una maniglia arriva qui.
    const tap = this.#takeHandleTap(event.target);
    if (tap) {
      this.#fitToContent(tap);
      return;
    }
    this.#addNode("text");
  }

  #keydown(event: KeyboardEvent): void {
    if (!this.#doc || event.defaultPrevented) return;
    // Spazio tenuto sulla lavagna sposta la vista, anche in una lavagna troppo
    // grande (T53); in un campo o dentro la scheda attiva resta uno spazio.
    if (!(this.#activeId !== null && this.#insideActive(event.target, false)) && this.#holdSpace(event)) return;
    if (this.#isSceneOversized()) return;
    // Esc mentre si tira un filo lo lascia, e nient'altro (T67).
    if (event.key === "Escape" && this.#connect) {
      event.preventDefault();
      this.#cancelConnect();
      return;
    }
    // D da solo, fuori dai campi: il mouse scrive finché il tasto è giù
    // (regola 1). La ripetizione del tasto non cambia niente.
    if (isInkKey(event) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      && !isTextTarget(event.target)) {
      if (!event.repeat && !this.#inkKeyDown) {
        this.#inkKeyDown = true;
        this.#applyInkMouse();
      }
      return;
    }
    // Dentro la scheda attiva i tasti sono del contenuto; Esc, se il
    // contenuto non lo usa (un rettangolo di celle che si sta scegliendo),
    // esce e rimette il fuoco sulla scheda.
    if (this.#activeId !== null && this.#insideActive(event.target, false)) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.#leaveCard(true);
      } else if (isCommandSearchKey(event)) {
        // Ctrl+/ si apre anche da dentro la scheda, ed Esc ci torna.
        event.preventDefault();
        this.#openCommandSearch();
      }
      return;
    }
    this.#recordPending();
    const commands = this.commands();
    const where = { writing: isTextTarget(event.target), onBoard: this.#onCardOrBoard(event.target) };
    // Prima i tasti con Ctrl o Alt: valgono anche col fuoco in un campo.
    const held = commandForKey(commands, event, { ...where, writing: true });
    if (held) {
      this.#runKey(event, held);
      return;
    }
    const focus = this.#selectionFocus();
    // La scheda scelta e non attiva riceve le pagine (il PDF), se li vuole.
    if (focus && this.#selection.length === 1 && CARD_KEYS.has(event.key) && this.#onCardOrBoard(event.target)) {
      const view = this.#cards.get(focus.id)?.view;
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
    if (bare) this.#runKey(event, bare);
  }

  /** Il tasto è del comando `command`: lo prende, e il comando parte se si può. */
  #runKey(event: KeyboardEvent, command: CanvasCommand): void {
    // Esc senza niente da togliere resta a chi sta fuori (la shell).
    if (command.id === "canvas.escape" && command.disabled() !== null) return;
    event.preventDefault();
    if (command.disabled() === null) command.run();
    this.#statusSettle();
  }

  /**
   * Un tasto col fuoco sulla colonna: gli strumenti e la ricerca dei comandi
   * valgono anche qui; frecce, Invio e Spazio restano della colonna (il kit).
   */
  #railKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || !this.#doc || this.#isSceneOversized()) return;
    if (isCommandSearchKey(event)) {
      event.preventDefault();
      this.#openCommandSearch();
      return;
    }
    const tools = this.commands().filter((command) => toolOfCommand(command.id) !== null);
    const command = commandForKey(tools, event, { writing: false, onBoard: false });
    if (command) this.#runKey(event, command);
  }

  /**
   * Stretta (la finestra fino a 700 px, o il riquadro fino a 480): la colonna
   * va sotto la lavagna, in riga, come nel disegno.
   */
  #syncNarrow(): void {
    const width = this.#root.clientWidth;
    if (width === 0) return;
    const narrow = width <= NARROW_PANE || window.innerWidth <= NARROW_WIDTH;
    if (narrow === this.#root.hasAttribute("data-narrow")) return;
    this.#root.toggleAttribute("data-narrow", narrow);
    this.#rail.setNarrow(narrow);
  }

  // --- render -------------------------------------------------------------------

  #renderLive(): void {
    // Drag/resize updates moved nodes and connected edges without replacing cards.
    const moved = this.#drag?.origin.keys() ?? this.#resize?.origin.keys() ?? this.#selection.values();
    for (const id of moved) {
      const node = this.#doc?.nodes.find((n) => n.id === id);
      const el = this.#stage.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`);
      if (node && el) {
        el.style.transform = `translate(${node.x}px, ${node.y}px)`;
        el.style.width = `${node.width}px`;
        el.style.height = `${node.height}px`;
        markHandles(el, node, this.#camera.zoom);
      }
    }
    this.#drawEdges();
    this.#syncSelectionFrame();
  }

  #render(): void {
    this.#syncEmpty();
    // Dopo `destroy` niente rinasce: una vista montata qui non avrebbe padrone.
    if (!this.#doc || this.#destroyed) return;
    this.#syncInkLayer();
    this.#applyCamera();
    this.#drawToolbar();
    this.#viewport.dataset.canvasNodes = String(this.#doc.nodes.length);
    this.#viewport.dataset.canvasEdges = String(this.#doc.edges.length);
    if (this.#isSceneOversized()) {
      this.#dropCards();
      this.#edgeLayer.replaceChildren();
      this.#handleLayer.replaceChildren();
      // Il livello dei fili resta il primo figlio dello stage (T91).
      this.#stage.replaceChildren(this.#edgeLayer);
      delete this.#stage.dataset.selection;
      const fallback = document.createElement("p");
      fallback.className = "canvas-large-fallback";
      fallback.textContent = t("canvas.too_large");
      this.#stage.append(fallback);
      this.#viewport.dataset.canvasProtocol = "source-fallback";
      // L'inchiostro si vede dove si vedono le schede (A8).
      this.#inkCards = new Map();
      this.#inkBoard = [];
      this.#inkPaths.clear();
      return;
    }
    this.#drawEdges();
    this.#placeCards(this.#doc.nodes);
    this.#paintInk();
    this.#syncSelectionFrame();
    this.#viewport.dataset.canvasProtocol = "source";
    this.#refreshLive();
  }

  // --- le schede vive ---------------------------------------------------------

  /** Un gesto che muove la vista o le schede: il puntatore è ancora giù. */
  #gestureMoving(): boolean {
    return this.#drag !== null || this.#resize !== null || this.#pan !== null || this.#pinch !== null;
  }

  /** Un gesto in corso, rotella, volo e inerzia compresi (T53): nessuna scheda cambia modo. */
  #gestureActive(): boolean {
    // Il riquadro del navigatore trascinato è un gesto anche lui (T55).
    return this.#gestureMoving() || this.#wheelTimer !== undefined || this.#motion !== null || this.#navigator.dragging();
  }

  /**
   * La lavagna si vede: è nel documento, nessun antenato è `hidden` (la
   * linguetta di un altro riquadro) e, dove il browser lo sa dire, niente la
   * toglie dalla pagina (`display: none`).
   */
  #isShown(): boolean {
    const viewport = this.#viewport;
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
  #refreshLive(): void {
    const doc = this.#doc;
    if (this.#destroyed || !doc || this.#views.size === 0) return;
    if (this.#gestureActive() || !this.#isShown()) return;
    const { view, zoom } = this.#viewRect();
    // Contano solo le schede con una vista: una specie senza renderer non
    // toglie posto a quelle che si accendono.
    const nodes = doc.nodes.filter((node) => this.#views.has(node.id));
    // La scheda attiva che esce dalla vista (non da quella allargata) ne esce.
    const active = this.#activeId;
    if (active !== null) {
      const node = nodes.find((candidate) => candidate.id === active);
      if (!node || !overlaps(node, view)) this.#leaveCard(true, false);
    }
    // La scheda attiva, e quella in cui si sta entrando, restano vive anche
    // se la regola le spegnerebbe (lo zoom, il limite).
    const wanted = liveCardIds(nodes, view, zoom);
    for (const id of [this.#activeId, this.#enteringId]) {
      if (id !== null && this.#views.has(id)) wanted.add(id);
    }
    updateLiveCards(this.#views, wanted, this.#liveModes, this.#cardQuiet);
  }

  /**
   * La vista di adesso in coordinate della lavagna, e lo zoom. Senza misura
   * (happy-dom, una vista non ancora disposta) vale quella di riserva di
   * `#fitCamera`: la camera è fatta su quella.
   */
  #viewRect(): { readonly view: Rect; readonly zoom: number } {
    return { view: this.#viewRectOf(this.#camera), zoom: this.#camera.zoom };
  }

  /** La vista in coordinate della lavagna con la camera `camera`, con la misura di riserva di `#viewRect`. */
  #viewRectOf(camera: Viewport): Rect {
    const rect = this.#viewport.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 600;
    const { x, y, zoom } = camera;
    return { x: -x / zoom, y: -y / zoom, width: width / zoom, height: height / zoom };
  }

  // --- entrare e uscire (T14) ---------------------------------------------------

  /** La scheda ha la vista di un renderer, e non è il segnaposto di un file mancante. */
  #hasLiveContent(entry: CardEntry): boolean {
    return entry.view !== null && entry.article.dataset.cardMissing === undefined;
  }

  /**
   * `target` sta nella scheda attiva: in tutta la scheda, o solo nel corpo
   * (`bodyOnly`), dove sta il contenuto della vista.
   */
  #insideActive(target: EventTarget | null, bodyOnly: boolean): boolean {
    const id = this.#activeId;
    if (id === null || !(target instanceof Node)) return false;
    const entry = this.#cards.get(id);
    if (!entry) return false;
    return (bodyOnly ? entry.body : entry.article).contains(target);
  }

  /** Il tasto arriva alla lavagna o a una scheda col fuoco, non a un campo o al contenuto. */
  #onCardOrBoard(target: EventTarget | null): boolean {
    return target === this.#viewport || (target instanceof HTMLElement && target.classList.contains("canvas-node"));
  }

  /** Il link sotto `target`, se sta nel contenuto della vista di una scheda. */
  #cardLinkAt(target: EventTarget | null): HTMLAnchorElement | null {
    if (!(target instanceof Element)) return null;
    const id = this.#nodeAt(target);
    const entry = id === null ? undefined : this.#cards.get(id);
    if (!entry || !this.#hasLiveContent(entry)) return null;
    const link = target.closest("a");
    return link !== null && entry.body.contains(link) ? link : null;
  }

  /**
   * Il clic nel contenuto di una scheda, prima che lo veda il contenuto.
   * Dentro la scheda attiva passa. Fuori, Ctrl+clic (Cmd+clic) su un link
   * passa e il link si segue (D-18 (c)); un pulsante della vista passa (il
   * suo «Apri»); ogni altro clic si ferma qui (A-12: sceglie, non segue), e
   * se la scheda era già la sola scelta prima del clic ci entra.
   */
  #cardClick(event: MouseEvent): void {
    const pressed = this.#pressedSelected;
    this.#pressedSelected = null;
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const target = event.target;
    const id = this.#nodeAt(target);
    const entry = id === null ? undefined : this.#cards.get(id);
    if (!id || !entry || !this.#hasLiveContent(entry) || !entry.body.contains(target)) return;
    if (this.#activeId === id) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && this.#cardLinkAt(target) !== null) return;
    const button = target.closest("button");
    if (button !== null && entry.body.contains(button) && !modifier) return;
    event.preventDefault();
    event.stopPropagation();
    if (!modifier && !event.shiftKey && !event.altKey && pressed === id) this.#enterCard(id);
  }

  /**
   * Il mouse giù nel contenuto di una scheda non attiva: il fuoco va alla
   * scheda, non a un link o al testo del contenuto (che fuori non prendono
   * la tastiera), e il testo non si comincia a scegliere. Un pulsante della
   * vista resta suo.
   */
  #keepContentFocus(event: PointerEvent, id: string): void {
    const target = event.target;
    const entry = this.#cards.get(id);
    if (!(target instanceof Element) || !entry || this.#activeId === id || !this.#hasLiveContent(entry)) return;
    if (!entry.body.contains(target)) return;
    const button = target.closest("button");
    if (button !== null && entry.body.contains(button)) return;
    event.preventDefault();
    entry.article.focus({ preventScroll: true });
  }

  /** Invio, o il doppio clic su una nota: entra se si può, altrimenti ciò che faceva (il campo). */
  #enterOrEdit(node: CanvasNode): void {
    if (node.type !== "text" && this.#enterCard(node.id)) return;
    this.#beginCardEdit(node);
  }

  /**
   * Entra nella scheda `id`: se è ferma la accende (passando dalla scelta
   * delle vive, che la tiene accesa con le altre), poi chiama `enter()`. Se
   * dice sì, la scheda è attiva: `data-card-active`, «Esc per uscire» nella
   * testata, il fuoco nel corpo. Una scheda fuori dalla vista, o che non si
   * accende adesso (la penna giù, la lavagna nascosta), non entra.
   */
  #enterCard(id: string): boolean {
    if (this.#activeId === id) return true;
    const entry = this.#cards.get(id);
    const view = entry?.view;
    if (this.#destroyed || !entry || !view?.enter || !this.#hasLiveContent(entry)) return false;
    if (!overlaps(entry.node, this.#viewRect().view)) return false;
    this.#leaveCard(false);
    if (this.#liveModes.get(id) !== "live") {
      // Un clic o un tasto chiudono il gesto della rotella: la scelta si rifà adesso.
      clearTimeout(this.#wheelTimer);
      this.#wheelTimer = undefined;
      this.#enteringId = id;
      try {
        this.#refreshLive();
      } finally {
        this.#enteringId = null;
      }
      if (this.#liveModes.get(id) !== "live") {
        this.#refreshLive();
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
      this.#refreshLive();
      return false;
    }
    this.#activeId = id;
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
  #leaveCard(refocus: boolean, refresh = true): void {
    const id = this.#activeId;
    if (id === null) return;
    this.#activeId = null;
    const entry = this.#cards.get(id);
    if (entry) {
      this.#unmarkActive(entry, refocus);
      try {
        entry.view?.leave?.();
      } catch (error) {
        console.warn(`canvas: la scheda ${id} non esce`, error);
      }
    }
    if (refresh) this.#refreshLive();
  }

  #unmarkActive(entry: CardEntry, refocus: boolean): void {
    const article = entry.article;
    const focusInside = article.contains(document.activeElement) && document.activeElement !== article;
    delete article.dataset.cardActive;
    article.querySelector(":scope > .canvas-node-handle > .canvas-exit-hint")?.remove();
    entry.body.removeAttribute("tabindex");
    if (refocus && focusInside && article.isConnected) article.focus({ preventScroll: true });
  }

  /**
   * Dice alla vista di `entry` che la scheda ha cambiato misura, a gesto
   * finito: durante un ridimensionamento aspetta il rilascio, e il primo
   * disegno dopo lo dice una volta sola.
   */
  #resizeView(entry: CardEntry): void {
    const view = entry.view;
    const known = entry.viewSize;
    if (!view || !known || this.#resize !== null) return;
    const { width, height } = entry.node;
    if (known.width === width && known.height === height) return;
    entry.viewSize = { width, height };
    try {
      view.resize?.();
    } catch (error) {
      console.warn(`canvas: la scheda ${entry.id} non cambia misura`, error);
    }
  }

  #drawEdges(): void {
    if (!this.#doc) return;
    const byId = new Map(this.#doc.nodes.map((n) => [n.id, n]));
    this.#edgeLayer.replaceChildren();
    this.#handleLayer.replaceChildren();
    const worldW = this.#worldSize();
    // Le prese stanno nelle stesse coordinate dei fili (T91).
    for (const layer of [this.#edgeLayer, this.#handleLayer]) {
      layer.setAttribute("viewBox", `0 0 ${worldW.w} ${worldW.h}`);
      layer.style.width = `${worldW.w}px`;
      layer.style.height = `${worldW.h}px`;
    }
    for (const edge of this.#doc.edges) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (!from || !to) continue;
      const a = sidePoint(from, edge.fromSide ?? "right");
      const b = sidePoint(to, edge.toSide ?? "left");
      const selected = this.#edgeSelection.includes(edge.id);
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("canvas-edge");
      // Il filo sotto il puntatore si scurisce (T67).
      if (this.#edgeHover === edge.id) group.toggleAttribute("data-hover", true);
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
      for (const [endpoint, point, end] of [
        ["from", a, edge.fromEnd], ["to", b, edge.toEnd],
      ] as const) {
        if (end !== "arrow") continue;
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
      if (selected && !this.#readOnly) {
        for (const [endpoint, point] of [["from", a], ["to", b]] as const) {
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.classList.add("canvas-edge-reconnect");
          handle.dataset.reconnect = edge.id;
          handle.dataset.endpoint = endpoint;
          handle.setAttribute("cx", String(point.x));
          handle.setAttribute("cy", String(point.y));
          handle.setAttribute("r", "8");
          // Sopra lo stage, non nel filo: un punto della scheda non la copre (T91, rotta 5).
          this.#handleLayer.append(handle);
        }
      }
      this.#edgeLayer.append(group);
    }
    // Il filo che si sta tirando resta sopra gli altri.
    if (this.#connectDraft) this.#edgeLayer.append(this.#connectDraft);
  }

  #worldSize(): { w: number; h: number } {
    let w = 2000;
    let h = 2000;
    for (const node of this.#doc?.nodes ?? []) {
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
  #placeCards(nodes: readonly CanvasNode[]): void {
    // La scheda col campo aperto non si sposta e non rifà il corpo: muoverla
    // toglierebbe il fuoco al campo. Le altre le si mettono attorno; se il
    // documento non l'ha più, resta finché il campo non si chiude.
    const editor = this.#editor;
    const keptEntry = editor ? this.#cards.get(editor.id) : undefined;
    const kept = keptEntry && keptEntry.article === editor?.article && keptEntry.article.parentElement === this.#stage
      ? keptEntry
      : undefined;
    const present = new Set(nodes.map((node) => node.id));
    for (const [id, entry] of this.#cards) {
      if (present.has(id) || entry === kept) continue;
      this.#cards.delete(id);
      this.#releaseBody(entry);
      entry.article.remove();
    }
    // Ciò che sulla scena non è una scheda (il messaggio della scena troppo
    // grande) va via; l'inchiostro libero resta, `#paintInk` lo rimette in cima,
    // e il bordo del tratto in corso pure.
    const ours = new Set<Element>([...this.#cards.values()].map((entry) => entry.article));
    for (const child of [...this.#stage.children]) {
      // Lo strato dei fili (T91, primo figlio della scena: le schede gli
      // vanno dopo), il bordo del tratto in corso (T69) e la
      // cornice della scelta restano: non sono della scena.
      if (child !== this.#edgeLayer && !ours.has(child) && !child.classList.contains("canvas-ink-board") && !child.classList.contains("canvas-ink-frames") && child !== this.#selectionFrame) child.remove();
    }
    const children = this.#stage.children;
    let index = children[0] === this.#edgeLayer ? 1 : 0;
    for (const node of nodes) {
      let entry = this.#cards.get(node.id);
      if (!entry) {
        entry = this.#createCard(node);
        this.#cards.set(node.id, entry);
      }
      if (entry === kept) {
        while (children[index] && children[index] !== entry.article) {
          this.#stage.insertBefore(children[index]!, entry.article.nextSibling);
        }
      } else if (children[index] !== entry.article) {
        this.#stage.insertBefore(entry.article, children[index] ?? null);
      }
      index++;
      this.#refreshCard(entry, node, entry !== kept);
      this.#resizeView(entry);
    }
  }

  /** L'involucro di una scheda nuova, col corpo ancora vuoto: lo riempie `#refreshCard`. */
  #createCard(node: CanvasNode): CardEntry {
    const id = node.id;
    const el = document.createElement("article");
    el.className = `canvas-node canvas-node-${node.type}`;
    el.dataset.node = id;
    el.tabIndex = 0;
    el.setAttribute("role", "group");
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
    const body = document.createElement("div");
    body.className = "canvas-card-body";
    el.append(header, body);
    const entry: CardEntry = {
      id, article: el, title, connect, node, type: node.type, body,
      bodyKey: null, resize: null, teardown: null, view: null, viewLife: null, viewSize: null, missingFor: null,
    };
    el.addEventListener("focus", () => {
      if (!this.#selection.includes(id)) {
        this.#selection = [id];
        this.#edgeSelection = [];
        this.#options.onSelectionChange();
        this.#displaySelection();
      }
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      // Il doppio clic su una maniglia adatta la scheda al contenuto (T66).
      const tap = this.#takeHandleTap(e.target);
      if (tap) {
        this.#fitToContent(tap);
        return;
      }
      // Dentro la scheda attiva il doppio clic è del contenuto (una parola).
      if (this.#activeId === id) return;
      const kind = this.#hasLiveContent(entry) ? cardKindOf(entry.node) : null;
      // Il visore lo apre la vista dell'immagine, che ascolta il suo doppio clic (T5).
      if (kind === "image") return;
      if (kind !== null && DOUBLE_CLICK_ENTERS.has(kind)) this.#enterOrEdit(entry.node);
      else this.#beginCardEdit(entry.node);
    });
    return entry;
  }

  /**
   * Aggiorna la scheda `entry` a `node`: l'involucro sempre, il corpo
   * (`withBody`) solo se la sua chiave è cambiata.
   */
  #refreshCard(entry: CardEntry, node: CanvasNode, withBody: boolean): void {
    entry.node = node;
    const el = entry.article;
    if (entry.type !== node.type) {
      el.classList.replace(`canvas-node-${entry.type}`, `canvas-node-${node.type}`);
      entry.type = node.type;
    }
    el.style.transform = `translate(${node.x}px, ${node.y}px)`;
    el.style.width = `${node.width}px`;
    el.style.height = `${node.height}px`;
    // La carta e il colore li dà la pelle (T47); il nome del colore arriva a
    // chi ascolta.
    paintColor(el, node.color);
    if (node.type === "group" && node.backgroundStyle) el.dataset.backgroundStyle = node.backgroundStyle;
    else delete el.dataset.backgroundStyle;
    el.setAttribute("aria-label", node.color
      ? `${node.type} ${node.id}, ${t("canvas.options.color_value", { name: colorName(node.color) })}`
      : `${node.type} ${node.id}`);
    el.classList.toggle("selected", this.#selection.includes(node.id));
    const title = nodeTitle(node);
    if (entry.title.textContent !== title) entry.title.textContent = title;
    entry.connect.setAttribute("aria-label", t("canvas.connect", { id: node.id }));
    this.#syncPorts(el);
    // Le quattro maniglie (T66): in sola lettura nessuna.
    if (this.#readOnly) {
      for (const handle of entry.resize ?? []) handle.remove();
      entry.resize = null;
    } else if (!entry.resize) {
      const handles = RESIZE_CORNERS.map((corner) => resizeHandle(corner, node.id));
      // Dopo il corpo, prima dell'inchiostro della scheda: come quando nasce.
      entry.body.after(...handles);
      entry.resize = handles;
    }
    markHandles(el, node, this.#camera.zoom);
    if (!withBody) return;
    const kind = cardKindOf(node);
    const cards = this.#options.cards;
    const renderer = kind && cards ? cards.registry.rendererFor(kind) : null;
    // Una vista dipende solo dalla scheda; il corpo di sempre anche dalla
    // lingua, e quello di testo dalle sintassi e dalla sola lettura (il
    // pulsante che ne fa una nota).
    const viewKey = cardBodyKey(node, renderer ? "view"
      : node.type === "text" ? `${this.#languageRound}:${this.#formsRound}:${this.#readOnly}`
      : `${this.#languageRound}`);
    // Il file cambiato (o la scheda) non è più quello che mancava: si riprova.
    if (entry.missingFor !== null && entry.missingFor !== viewKey) entry.missingFor = null;
    // Il segnaposto di un file mancante dipende dalla lingua e dalla sola lettura (i gesti).
    const missing = entry.missingFor !== null && cards !== undefined;
    const key = missing ? cardBodyKey(node, `missing:${this.#languageRound}:${this.#readOnly}`) : viewKey;
    if (key === entry.bodyKey) return;
    this.#releaseBody(entry);
    const body = document.createElement("div");
    body.className = "canvas-card-body";
    entry.body.replaceWith(body);
    entry.body = body;
    entry.bodyKey = key;
    if (missing && cards) this.#fillMissing(entry, body, node, cards);
    else if (renderer && kind && cards) this.#mountView(entry, node, kind, renderer, cards.snapshots);
    else this.#fillBody(entry, body, node);
  }

  /**
   * Monta la vista del renderer nel corpo, ferma: chi è vivo lo decide la
   * tela più tardi. Un renderer che lancia lascia il corpo di sempre, e la
   * tela va avanti.
   */
  #mountView(entry: CardEntry, node: CanvasNode, kind: CardKind, renderer: CardRenderer, snapshots: CardSnapshots): void {
    const body = entry.body;
    const life = openLifetime();
    const target = cardTarget(node);
    // Finché il renderer monta, un «file mancante» si registra a montaggio finito.
    let mounting = true;
    let missingWhileMounting = false;
    const context: CardContext = {
      path: target.path,
      subpath: target.subpath,
      documentId: this.#options.documentId ?? "",
      lifetime: life,
      snapshots,
      size: () => ({ width: entry.node.width, height: entry.node.height }),
      zoom: () => this.#camera.zoom,
      initialPage: this.#viewMemo?.page(node.id) ?? null,
      pageChanged: (page) => {
        // Una vista già smontata non parla più per questa scheda.
        if (life.closed || entry.body !== body) return;
        this.#viewMemo?.pageChanged(entry.id, page);
      },
      missing: () => {
        // Una vista già distrutta non parla più per questa scheda; un link non manca mai.
        if (life.closed || entry.body !== body || entry.node.type !== "file") return;
        if (mounting) {
          missingWhileMounting = true;
          return;
        }
        this.#markMissing(entry);
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
        this.#fillBody(entry, body, node);
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
    this.#liveModes.set(entry.id, "snapshot");
    this.#views.set(entry.id, {
      setMode: (mode) => {
        view.setMode(mode);
        article.dataset.cardMode = mode;
      },
      // Questa voce serve solo al cambio di modo: la vista la smonta `#releaseBody`.
      destroy: () => {},
    });
    if (missingWhileMounting) this.#markMissing(entry);
  }

  /**
   * Il renderer dice che il file della scheda non c'è: la vista si smonta, e il
   * corpo diventa «File mancante» con i suoi gesti. La scheda resta così finché
   * il file non torna (o cambia): allora la sua vista si rimonta.
   */
  #markMissing(entry: CardEntry): void {
    entry.missingFor = cardBodyKey(entry.node, "view");
    this.#refreshCard(entry, entry.node, true);
  }

  /**
   * Il file di una scheda mancante è tornato (o è cambiato): la scheda si
   * rimonta da sé, con la sua vista, e la tela decide se si accende.
   */
  #fileBack(id: string): void {
    const entry = this.#cards.get(id);
    if (this.#destroyed || !entry || entry.missingFor === null) return;
    entry.missingFor = null;
    this.#refreshCard(entry, entry.node, true);
    this.#refreshLive();
  }

  /**
   * Il corpo di una scheda il cui file non c'è: il nome del file, e «Ritrova…» e
   * «Togli dalla lavagna» se la lavagna si può cambiare. Il file si ascolta da
   * qui (la vita del corpo): quando torna, `#fileBack` rimonta la vista.
   */
  #fillMissing(entry: CardEntry, body: HTMLElement, node: CanvasNode, cards: CanvasCards): void {
    const id = node.id;
    const path = cardTarget(node).path;
    const life = openLifetime();
    entry.viewLife = life;
    entry.article.dataset.cardMissing = "true";
    const message = document.createElement("span");
    message.className = "canvas-media-placeholder";
    message.textContent = t("canvas.card.missing", { path });
    body.append(message);
    life.add(cards.watch(path, () => this.#fileBack(id)));
    if (this.#readOnly) return;
    const pick = this.#options.onPickFile;
    if (pick) {
      const relink = document.createElement("button");
      relink.type = "button";
      // La classe dei gesti di testo dentro una scheda: nessun aspetto nuovo.
      relink.className = "canvas-file-link";
      relink.dataset.cardAction = "relink";
      relink.textContent = t("canvas.card.relink");
      life.listen(relink, "click", (event) => {
        event.stopPropagation();
        this.#relinkCard(id, pick).catch((error: unknown) => this.#showIntakeError(error));
      });
      body.append(relink);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "canvas-file-link";
    remove.dataset.cardAction = "remove";
    remove.textContent = t("canvas.card.remove");
    life.listen(remove, "click", (event) => {
      event.stopPropagation();
      this.#removeCard(id);
    });
    body.append(remove);
  }

  /**
   * «Ritrova…»: il file scelto (con il nome di quello che manca in testa) sostituisce
   * il percorso della scheda, in un commit solo. La scelta vale solo se la scheda è
   * ancora mancante per lo stesso file: se il file è tornato, o la scheda è cambiata
   * mentre il selettore era aperto, la scelta è vecchia e non tocca niente.
   */
  async #relinkCard(id: string, pick: NonNullable<CanvasEngineOptions["onPickFile"]>): Promise<void> {
    const expected = this.#cards.get(id)?.missingFor ?? null;
    const shown = this.#doc?.nodes.find((candidate) => candidate.id === id);
    if (expected === null || !shown) return;
    const chosen = await pick(fileName(cardTarget(shown).path));
    if (!isVaultPath(chosen) || this.#destroyed || this.#readOnly || !this.#doc) return;
    if (this.#cards.get(id)?.missingFor !== expected) return;
    const now = this.#doc.nodes.find((candidate) => candidate.id === id);
    if (!now) return;
    const patch = upsertNodePatch(this.#doc, { ...now, file: relinkedFile(now, chosen) });
    if (patch) this.#commit([patch], "input");
  }

  /** «Togli dalla lavagna» di una scheda mancante: come Canc, per quella scheda sola. */
  #removeCard(id: string): void {
    if (this.#removeCards([id], [])) this.#options.onSelectionChange();
  }

  /** Smonta ciò che tiene vivo il corpo di `entry` (Markdown, vista) e lo segna da rifare. */
  #releaseBody(entry: CardEntry): void {
    const teardown = entry.teardown;
    const view = entry.view;
    const life = entry.viewLife;
    entry.teardown = null;
    entry.view = null;
    entry.viewLife = null;
    entry.viewSize = null;
    entry.bodyKey = null;
    if (view) {
      this.#views.delete(entry.id);
      this.#liveModes.delete(entry.id);
    }
    // La scheda attiva che perde il corpo (tolta, un annulla, un file
    // cambiato, il campo che prende il posto della vista) ne esce prima.
    if (this.#activeId === entry.id) {
      this.#activeId = null;
      this.#unmarkActive(entry, false);
      try {
        view?.leave?.();
      } catch (error) {
        console.warn(`canvas: la scheda ${entry.id} non esce`, error);
      }
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
  #dropCards(): void {
    const entries = [...this.#cards.values()];
    this.#cards.clear();
    for (const entry of entries) {
      this.#releaseBody(entry);
      entry.article.remove();
    }
  }

  /** Il corpo di sempre di `node`, in `body`: testo, file, link o gruppo. */
  #fillBody(entry: CardEntry, body: HTMLElement, node: CanvasNode): void {
    switch (node.type) {
      case "text": {
        const text = node.text ?? "";
        const render = this.#options.renderMarkdownForCard;
        if (render) {
          const host = document.createElement("div");
          host.className = "canvas-markdown";
          const teardown = render(node.id, text, host, this.#forms);
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
        if (this.#options.onCreateNote && !this.#readOnly) {
          const convert = document.createElement("button");
          convert.type = "button";
          convert.className = "canvas-convert-note";
          convert.textContent = t("canvas.convert_note");
          convert.addEventListener("click", (event) => {
            event.stopPropagation();
            // La scheda di adesso: il corpo resta anche se la si sposta.
            void this.#convertTextToNote(entry.node).catch((error: unknown) => this.#showIntakeError(error));
          });
          body.append(convert);
        }
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
          void this.#options.onOpenPath?.(`/${path.replace(/^\/+/, "")}${node.subpath ?? ""}`, this.#options.documentId);
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
        const media = this.#options.media;
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

  #beginCardEdit(target: CanvasNode): void {
    if (this.#readOnly || !this.#doc) return;
    const node = this.#doc.nodes.find((candidate) => candidate.id === target.id);
    if (!node) return;
    if (this.#editor) {
      if (this.#editor.id === node.id) return;
      // Il testo dell'altra scheda si registra prima; se non si può, resta lì.
      if (!this.#closeField(false)) return;
      this.#render();
    }
    const entry = this.#cards.get(node.id);
    if (!entry || entry.article.parentElement !== this.#stage) return;
    const { article, body } = entry;
    // Il campo prende il posto del corpo: la vista o il Markdown si smontano,
    // e il corpo si rifà alla prima resa dopo che il campo si chiude. Anche il
    // «file mancante» e il suo ascolto se ne vanno: alla chiusura il file si chiede di nuovo.
    this.#releaseBody(entry);
    entry.missingFor = null;
    const field: CardField = node.type === "text" ? "text" : node.type === "group" ? "label" : node.type === "link" ? "url" : "file";
    const input = node.type === "text" ? document.createElement("textarea") : document.createElement("input");
    input.className = node.type === "text" ? "canvas-text-editor" : "canvas-field-editor";
    input.value = node[field] ?? "";
    input.setAttribute("aria-label", t("canvas.edit_text", { id: node.id }));
    const lifetime = new AbortController();
    const editor: CardEditor = { id: node.id, field, input, article, lifetime, composing: false, recordOnInput: false };
    this.#editor = editor;
    const signal = lifetime.signal;
    const hold = (): void => {
      const card = this.#doc?.nodes.find((candidate) => candidate.id === node.id) ?? this.#pending?.card ?? node;
      this.#setPending({ card, field, text: input.value });
    };
    // Il testo resta qui finché non c'è una pausa: niente commit per tasto.
    input.addEventListener("input", () => {
      hold();
      if (editor.composing) return;
      if (editor.recordOnInput) {
        editor.recordOnInput = false;
        this.#recordPending();
        return;
      }
      this.#schedulePause();
    }, { signal });
    // Durante la composizione (IME) la pausa non corre: conta dalla fine.
    input.addEventListener("compositionstart", () => {
      editor.composing = true;
      clearTimeout(this.#pauseTimer);
      this.#pauseTimer = undefined;
    }, { signal });
    input.addEventListener("compositionend", () => {
      editor.composing = false;
      hold();
      this.#schedulePause();
    }, { signal });
    input.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      // Col campo aperto i tasti, Ctrl+Z compreso, sono del campo.
      event.stopPropagation();
      editor.recordOnInput = false;
      if (event.isComposing || editor.composing) return;
      if (isCommandSearchKey(event)) {
        // Ctrl+/ si apre anche mentre si scrive; Esc torna nel campo.
        event.preventDefault();
        this.#openCommandSearch();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.#leaveField(true);
      } else if (event.key === "Enter") {
        if (field === "text" && !event.ctrlKey && !event.metaKey) {
          // L'a capo entra nel campo, e con lui il testo si registra.
          editor.recordOnInput = true;
          return;
        }
        event.preventDefault();
        this.#leaveField(true);
      }
    }, { signal });
    // Il fuoco che va nella ricerca dei comandi non chiude il campo: ci torna.
    input.addEventListener("blur", () => {
      if (!this.#searching) this.#leaveField(false);
    }, { signal });
    body.replaceChildren(input);
    input.focus();
    if (node.type === "text") input.setSelectionRange(input.value.length, input.value.length);
    else input.select();
  }
}

/** Una copia delle toppe, che chi le ha date può ancora cambiare. */
function copyPatches(patches: readonly CanvasPatch[]): CanvasPatch[] {
  return JSON.parse(JSON.stringify(patches)) as CanvasPatch[];
}

/**
 * Due passi di fila in uno: `first` ha portato il testo da `before` a un
 * testo di mezzo, `second` da quello ad `after`. Le toppe si fanno in fila
 * (le inverse al contrario); il tratto del testo è la parte che cambia fra
 * `before` e `after`, senza spezzare una coppia surrogata.
 */
function mergeSteps(before: string, first: CanvasStep, second: CanvasStep, after: string): CanvasStep {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--;
    endAfter--;
  }
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  // Il tratto finale si allarga di un'unità in tutti e due i testi, che lì sono uguali.
  if (endBefore < before.length && isLowSurrogate(before.charCodeAt(endBefore))) {
    endBefore++;
    endAfter++;
  }
  return {
    patches: [...second.patches, ...first.patches],
    back: [...first.back, ...second.back],
    start,
    inserted: after.slice(start, endAfter),
    removed: before.slice(start, endBefore),
    version: second.version,
    restores: first.restores,
  };
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** Una trappola o un'istanza persa: il nucleo va riaperto. */
function lostCore(error: unknown): boolean {
  return error instanceof CanvasCoreError && (error.code === "trap" || error.code === "handle");
}

/**
 * La modifica al testo che il nucleo ha fatto, come `TextOperation`: il tratto
 * cambiato così com'è, o, con dei CR nel testo, la differenza contata sui `\n`.
 */
function sourceOperation(before: string, after: string, edit: CanvasSourceEdit): Pick<TextOperation, "beforeLength" | "afterLength" | "edits"> {
  if (before.includes("\r") || after.includes("\r")) {
    return operationFromText(lineFeeds(before), lineFeeds(after));
  }
  const deleted = before.slice(edit.start, edit.end);
  if (deleted === edit.text) return { beforeLength: before.length, afterLength: after.length, edits: [] };
  return {
    beforeLength: before.length,
    afterLength: after.length,
    edits: [{ from: edit.start, to: edit.end, deleted, inserted: edit.text }],
  };
}

/**
 * La chiave del corpo di una scheda: ciò che il corpo mostra (`type`, `file`,
 * `subpath`, `url`, `text`, `label`, lo sfondo di un gruppo) più `extra`, ciò
 * che il corpo legge da fuori. Posto, misura, colore e scelta non ci sono:
 * cambiarli non rifà il corpo.
 */
function cardBodyKey(node: CanvasNode, extra: string): string {
  return JSON.stringify([
    node.type, node.file ?? null, node.subpath ?? null, node.url ?? null,
    node.text ?? null, node.label ?? null, node.background ?? null, extra,
  ]);
}

/**
 * Il file di una scheda per il suo renderer: il percorso senza `#…` e il
 * `subpath`, da `subpath` o, se manca, dal `#` nel percorso. Una scheda di
 * link non ha file: il percorso è vuoto e l'indirizzo è in `node.url`.
 */
function cardTarget(node: CanvasNode): { path: string; subpath: string | null } {
  if (node.type !== "file") return { path: "", subpath: null };
  const file = typeof node.file === "string" ? node.file : "";
  const hash = file.indexOf("#");
  const path = hash < 0 ? file : file.slice(0, hash);
  const subpath = typeof node.subpath === "string" && node.subpath ? node.subpath : hash < 0 ? null : file.slice(hash);
  return { path, subpath };
}

/** Che cosa dice l'etichetta della penna (T69): la scheda col suo nome, o il tratto libero. */
function inkHolderText(holder: CanvasNode | null): string {
  if (!holder) return t("canvas.ink.free");
  const name = cardMenuName(holder);
  return name ? t("canvas.ink.attach", { name }) : t("canvas.ink.attach_card");
}

/** Il nome di un file senza le cartelle: `Corsi/foto.png` → `foto.png`. */
function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Quanto è lungo, al più, il nome di una scheda nella testata del menu. */
const MENU_NAME_MAX = 40;

/**
 * Il nome di una scheda nella testata del menu (T17): il file senza le
 * cartelle, l'host di una pagina web, la prima riga di un testo, l'etichetta
 * di un gruppo; accorciato con «…». `""` se non ne ha.
 */
function cardMenuName(node: CanvasNode): string {
  let name = "";
  if (node.type === "file") name = fileName(cardTarget(node).path);
  else if (node.type === "link") {
    const address = externalUrl(node.url ?? "");
    name = address === null ? node.url ?? "" : new URL(address).host;
  } else if (node.type === "text") name = (node.text ?? "").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  else name = node.label ?? "";
  name = name.trim();
  return name.length > MENU_NAME_MAX ? `${name.slice(0, MENU_NAME_MAX - 1).trimEnd()}…` : name;
}

/**
 * Il `file` di una scheda dopo «Ritrova…»: il percorso scelto, col `#…` che la
 * scheda aveva in linea (il titolo o la pagina). Il `subpath` separato resta com'è.
 */
function relinkedFile(node: CanvasNode, chosen: string): string {
  const file = typeof node.file === "string" ? node.file : "";
  const hash = file.indexOf("#");
  return hash < 0 ? chosen : `${chosen}${file.slice(hash)}`;
}

function nodeTitle(node: CanvasNode): string {
  switch (node.type) {
    case "text":
      return (node.text ?? "").split("\n", 1)[0]?.slice(0, 48) || node.id;
    case "file":
      return node.file ?? node.id;
    case "link":
      return node.url ?? node.id;
    case "group":
      return node.label || node.id;
  }
}

function nodeText(node: CanvasNode): string {
  switch (node.type) {
    case "text": return node.text ?? "";
    case "file": return node.subpath ? `${node.file ?? ""}${node.subpath}` : node.file ?? "";
    case "link": return node.url ?? "";
    default: return node.label ?? "";
  }
}
