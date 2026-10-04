// L'editor del disegno: una barra e il foglio. Tiene insieme ciò che i
// pacchetti precedenti hanno costruito — il motore delle operazioni, il
// painter e lo strato sopra, la pipeline della penna, la camera condivisa — e
// ci mette sopra gli strumenti.
//
// Le regole:
//
// - **Il livello filtra.** La barra e i tasti sono quelli del livello
//   (`registry.ts`), che cambia dal vivo: ciò che sale compare, ciò che scende
//   sparisce, e il documento resta com'è. L'Essenziale è una barra sola,
//   senza pannelli.
// - **Ogni segno il suo inchiostro.** La penna e le forme condividono colore
//   e spessore; l'evidenziatore ha i suoi, giallo e largo, e li ritrova quando
//   lo si riprende. Dal livello Standard un colore si sceglie anche a piacere,
//   e resta come campione in più accanto alla tavolozza.
// - **Un gesto, un'operazione.** Ogni strumento lavora sull'anteprima finché
//   il puntatore è giù e scrive una volta sola quando si alza: il tratto
//   sullo strato sopra, la forma su un livello di anteprima con gli stessi
//   attributi che scriverà, lo spostamento e la gomma come bozza del painter
//   sui nodi della scena. Un gesto annullato non scrive niente.
// - **Una pipeline per tutti.** Ogni strumento riceve i punti dalla stessa
//   pipeline della penna, così il palmo non seleziona e non cancella, e due
//   dita muovono la vista con qualunque strumento.
// - **Lo stesso dato.** Selezione e gomma toccano gli oggetti con l'indice di
//   `hit.ts`, costruito sugli stessi nodi che il painter disegna.
// - **Annunci.** Una regione live dice creazione, eliminazione, selezione,
//   cambio di strumento e ciò che non si è potuto fare.
// - **Tutto da tastiera.** Ogni strumento ha la sua lettera, e funziona anche
//   senza puntatore: le frecce muovono un cursore sul foglio e Spazio preme e
//   rilascia, coi gesti della stessa pipeline. Con una selezione le frecce la
//   spostano, con Ctrl o ⌘ la ridimensionano, Tab passa all'oggetto dopo e
//   Invio apre le proprietà con i numeri; senza selezione Tab esce dal
//   foglio, che non trattiene mai il fuoco. «?» elenca i tasti.
// - **L'albero degli oggetti** è il disegno come elenco (`objects.ts`), con la
//   stessa selezione del foglio; i nomi vengono da `describe.ts`.
// - **Moto ridotto per costruzione.** La camera non si anima mai: ogni
//   inquadratura è immediata, quindi non c'è moto da ridurre.
// - **Disporre.** Dal livello Standard, con una selezione, una barra in cima
//   al foglio duplica, raggruppa e separa, cambia l'ordine e allinea
//   (`arrange.ts`); Alt+F10 ci porta il fuoco, Esc lo riporta al foglio.
//   Ogni comando è un passo di annulla, e la selezione segue ciò che ha
//   fatto: le copie, il gruppo, i figli.
// - **Livelli.** Dal livello Standard si disegna nel livello corrente, che un
//   pulsante della barra mostra e un menu sceglie, crea e cambia
//   (`layers.ts`); scegliere oggetti di un livello solo lo rende corrente. Un
//   livello corrente bloccato o nascosto non riceve niente, e lo si dice.
//   Sotto lo Standard il disegno va nel livello più alto che si vede e non è
//   bloccato.
// - **Griglia e pagina.** Dal livello Standard il pulsante «Pagina e griglia»
//   mostra la griglia, ne accende l'aggancio e ne sceglie il passo
//   (`grid.ts`), e adatta la pagina al disegno. La griglia aiuta la vista e
//   non entra nel file. Con l'aggancio vanno sulla griglia le forme, gli
//   spostamenti, le copie, le immagini incollate e il cursore. Ctrl o ⌘,
//   tenuto durante un gesto del puntatore, lo sospende.
// - **Immagini incollate.** Un'immagine incollata o trascinata sul foglio
//   entra nel file come data URI (`images.ts`): il disegno resta un file
//   solo. Oltre il peso massimo l'editor propone di ridurla.
// - **Testo.** Dal livello Standard lo strumento Testo scrive dove si tocca,
//   in un campo sopra il foglio, col carattere, il corpo, il colore e la
//   trasformazione del testo, così ciò che si scrive sta dove resterà
//   (`text.ts`). Lo stesso campo cambia un testo che c'è: col tocco dello
//   strumento, col doppio tocco della selezione, o con F2. Il testo si scrive
//   quando il campo si chiude, in un passo di annulla solo.
// - **Collegamenti.** Dal livello Standard Ctrl+K collega gli oggetti scelti
//   a una nota del vault, che sceglie chi monta l'editor, o porta a un'altra
//   nota il collegamento scelto; Ctrl+Maiusc+K lo toglie (`arrange.ts`). A
//   ogni livello un segno sull'angolo di ogni collegamento ne apre la nota,
//   con lo strumento Selezione o quando il disegno non si scrive, e Alt+Invio
//   apre quella del collegamento scelto.
//
// La superficie che lo monta nella shell gli passa il motore del
// documento e riceve ogni modifica con `onChange`; una sincronizzazione da
// un'altra superficie arriva con `setEngine`, e annulla e ripeti restano.

import { onLanguage, resolvedLanguage } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { ariaBinding, displayBinding, modifierName } from "../../../ui/commands";
import { promptForm, showKeys, type FormField, type KeyGroup, type MoreKeys } from "../../../ui/form-dialog";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { showContextMenu, type MenuItem } from "../../../ui/menu";
import { fit as fitBounds, screenToWorld, zoomAtPoint, type Camera, type ScaleLimits } from "../../../spatial/camera";
import type { TextOperation } from "../../core/text-operation";
import { countObjects, describe, keyOf, linkName, outline, type OutlineNode } from "../describe";
import { brushForInput, PF1_DEFAULTS, type Pf1Brush } from "../ink/brush";
import { pf1Outline } from "../ink/pf1";
import { INK_MAX_SAMPLES, quantizeInk, type InkSample } from "../ink/sample";
import { formatNumber } from "../number";
import { attachPenInput, type FinishedStroke, type InkPointerType, type PenInputOptions, type StrokeStart } from "../pen/pen-input";
import type { TouchPolicy } from "../pen/roles";
import { BoundsBuilder, type Bounds } from "../scene/geometry";
import { apply, compose, type Matrix, type Point } from "../scene/matrix";
import { elementChildren } from "../scene/model";
import { MAX_IMAGE_BYTES } from "../scene/analysis";
import { MAX_EDIT_BYTES, SVG_NS } from "../scene/read";
import { utf8Length } from "../scene/text";
import type { Applied, SceneEngine } from "../scene/engine";
import type { Tool } from "../scene/analysis";
import type { Item } from "../scene/classify";
import type { Op, Reason } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { plural, t, type DrawKey } from "../strings";
import { createOverlay, type OverlayHandle } from "../painter/overlay";
import { PaintBuilder, type PaintNode, type PaintScene } from "../painter/paint";
import { createSvgPainter, type PainterOptions } from "../painter/svg-dom";
import {
  addOp,
  boxMatrix,
  destination,
  destinationIn,
  fittedPage,
  gesture as asGesture,
  mappedBounds,
  moveOps,
  movedMatrix,
  NewIds,
  pageFor,
  removeOps,
  roundDelta,
  strokeElem,
  transformOps,
  transformValue,
  type Destination,
} from "./edit";
import {
  alignOps,
  distributeOps,
  duplicateOps,
  groupOps,
  holdsLinks,
  isGroup,
  isLink,
  linkOps,
  linkTarget,
  nodeOf,
  orderOps,
  Plan,
  relinkOps,
  ungroupOps,
  unlinkOps,
  type Arranged,
  type Axis,
  type Edge,
  type Order,
} from "./arrange";
import { attributeOps, cites, renameOps, subjectOf, type Subject } from "./attributes";
import {
  DEFAULT_GRID,
  GRID_MAJOR,
  GRID_STEPS,
  gridLines,
  lineBeyond,
  nearestCorner,
  snapDelta,
  snapPoint,
  snapValue,
  validStep,
  wholeSteps,
  type Grid,
} from "./grid";
import { elemBounds, linesBounds, SceneIndex, SceneIndexer, type LayerInfo, type TextLook, type Unit } from "./hit";
import { History, type Replay } from "./history";
import {
  browserCodec,
  budgetFor,
  carriesFiles,
  dataUri,
  imageElem,
  imageFiles,
  jpegOrientation,
  limitsFor,
  MIN_ROOM,
  placeImage,
  reduce,
  sniffRaster,
  type Decoded,
  type Encoded,
  type ImageCodec,
} from "./images";
import {
  addLayerOps,
  canShiftLayer,
  freshLayerName,
  hideLayerOps,
  inLayer,
  intoLayerOps,
  layerName,
  lockLayerOps,
  MAX_LAYER_NAME,
  removeLayerOps,
  renameLayerOps,
  shiftLayerOps,
  type Shift,
} from "./layers";
import { createInspector } from "./inspector";
import { createObjectTree, type TreeEntry } from "./objects";
import {
  customColor,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  HIGHLIGHTER_COLOR,
  HIGHLIGHTER_OPACITY,
  HIGHLIGHTER_WIDTH,
  HIGHLIGHTER_WIDTHS,
  isLight,
  PALETTE,
  swatchOf,
  WIDTHS,
  type Width,
} from "./palette";
import { DEFAULT_TOOL, levelsAbove, reaches, toolForKey, TOOLS, toolsFor, toolSpec, type Level, type ToolId, type ToolSpec } from "./registry";
import { constrainEnd, shapeElem, type ShapeTool } from "./shapes";
import { editableText, ensureTextFont, LINE_SPACING, TEXT_FAMILY, TEXT_SIZE, TEXT_SIZES, textElem, textLines } from "./text";

/// Una modifica del testo fatta da questa superficie, nella forma di
/// `EditorChange` (operazioni sulla scena, §6).
export interface DrawChange {
  /// Il testo grezzo di dopo, coi terminatori del file.
  readonly text: string;
  /// Le modifiche sul testo a LF di prima.
  readonly operation: TextOperation;
  readonly origin: "input" | "undo" | "redo";
}

/// I collegamenti del disegno verso il vault, da chi monta l'editor: chi
/// sceglie la nota e chi la apre. Senza, l'editor non crea collegamenti e non
/// li apre, ma li nomina nell'albero e li toglie.
export interface DrawLinks {
  /// Chiede la nota a cui portare un collegamento; `current` è l'`href` di
  /// quello che si cambia, `null` per uno nuovo. Torna l'`href` da scrivere,
  /// relativo al disegno, o `null` se chi disegna rinuncia.
  choose(current: string | null): Promise<string | null>;
  /// Apre la nota a cui porta `href`, com'è scritto nel disegno. Se non ci
  /// riesce, lo dice chi la apre.
  open(href: string): void;
}

export interface DrawEditorOptions {
  /// Il livello degli strumenti (default `essential`); cambia con
  /// `setLevel`.
  readonly level?: Level;
  readonly images?: PainterOptions["images"];
  /// Che cosa fa un dito quando nessuna penna è vicina (default `auto`).
  readonly touch?: TouchPolicy;
  /// Chi legge e ricodifica le immagini incollate: quello del browser, se
  /// non è dato; `null` le rifiuta.
  readonly imageCodec?: ImageCodec | null;
  /// La griglia di partenza (default spenta, col passo di 20 unità).
  readonly grid?: Grid;
  /// Chi disegna ha cambiato la griglia, dal menu o coi tasti.
  readonly onGridChange?: (grid: Grid) => void;
  readonly links?: DrawLinks;
  readonly onChange?: (change: DrawChange) => void;
  /// La selezione è cambiata: altri oggetti, o gli stessi con chiavi nuove.
  readonly onSelectionChange?: () => void;
}

export interface DrawEditor {
  readonly element: HTMLElement;
  readonly engine: SceneEngine;
  readonly level: Level;
  readonly tool: ToolId;
  /// Il colore e lo spessore dello strumento di adesso.
  readonly color: string;
  readonly width: number;
  /// Le chiavi degli oggetti selezionati in ordine di documento: l'id, o
  /// `@` e il percorso per un oggetto che non ne ha.
  readonly selection: readonly string[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /// Il documento ricostruito dal testo autorevole (operazioni sulla scena,
  /// §7): la cronologia resta, la selezione tiene gli oggetti che ci sono
  /// ancora. Il motore ha un modello: un documento in sola lettura non si
  /// monta nell'editor.
  setEngine(engine: SceneEngine): void;
  /// Un altro documento al posto di questo, come `setDoc` delle superfici:
  /// cronologia e selezione si azzerano, e il foglio si inquadra.
  load(engine: SceneEngine): void;
  /// Toglie o ridà la scrittura, per chi monta l'editor: la barra si spegne
  /// e i gesti non scrivono, ma il disegno si guarda.
  setReadOnly(readOnly: boolean): void;
  /// Sceglie l'oggetto il cui testo contiene il byte `offset` del file, e lo
  /// porta in vista. `false` se nessun oggetto lo contiene.
  reveal(offset: number): boolean;
  /// «Modifica» su un SVG estraneo: l'operazione `adopt`, un passo
  /// di annulla. `false` se il documento non è estraneo o la scrittura è
  /// tolta.
  adopt(): boolean;
  /// Un altro livello, dal vivo: la barra e i tasti cambiano, il documento
  /// e la cronologia restano. Uno strumento che il livello non ha più torna
  /// alla penna, e un colore personalizzato al nero.
  setLevel(level: Level): void;
  setTool(id: ToolId): void;
  /// Il colore dello strumento di adesso: uno della tavolozza o, dal livello
  /// Standard, uno a piacere, come lo legge `customColor`.
  setColor(color: string): void;
  setWidth(width: number): void;
  /// La griglia: se si vede, se aggancia, e il passo.
  readonly grid: Grid;
  /// Un'altra griglia, da chi monta l'editor: non si annuncia e non torna a
  /// `onGridChange`. Un passo fuori dai limiti lascia quello di prima.
  setGrid(grid: Grid): void;
  select(keys: readonly string[]): void;
  deleteSelection(): void;
  undo(): void;
  redo(): void;
  /// Inquadra la pagina e tutto ciò che ne esce.
  fit(): void;
  focus(): void;
  dispose(): void;
}

/// I limiti della camera del disegno.
export const DRAW_SCALE_LIMITS: ScaleLimits = { min: 0.1, max: 32 };

/// Quanto lontano dal tratto un tocco prende ancora l'oggetto, in pixel: il
/// dito copre più della penna.
const HIT_PX: Readonly<Record<InkPointerType, number>> = { pen: 6, mouse: 4, touch: 12 };

/// Il raggio della gomma, in pixel.
const ERASER_PX: Readonly<Record<InkPointerType, number>> = { pen: 8, mouse: 8, touch: 16 };

/// Oltre questo spostamento, in pixel, un tocco su un oggetto diventa un
/// trascinamento.
const DRAG_PX: Readonly<Record<InkPointerType, number>> = { pen: 3, mouse: 3, touch: 8 };

/// Sotto questa misura, in pixel, una forma è un tocco e non si scrive.
const MIN_SHAPE_PX = 4;

/// Lo scarto fra un oggetto e la cornice della sua selezione, in pixel.
const FRAME_PX = 4;

const ZOOM_STEP = 1.25;

/// La lettera dei pulsanti delle dimensioni del testo, in pixel.
const SIZE_GLYPH_PX: readonly number[] = [12, 16, 22];
const FIT_PAD = 0.08;

/// Di quanto le frecce spostano o ridimensionano la selezione, in unità
/// della scena.
const NUDGE = 1;
const NUDGE_SHIFT = 10;

/// La misura più piccola a cui le frecce riducono un lato della selezione.
const MIN_SIZE = 1;

/// Di quanto le frecce muovono il cursore del foglio, in pixel: con Maiusc a
/// passi lunghi, con Ctrl o ⌘ a passi corti.
const CURSOR_PX = 10;
const CURSOR_PX_SHIFT = 50;
const CURSOR_PX_FINE = 1;

/// Un campione ogni tanti pixel quando il cursore traccia, a un intervallo
/// da mouse: il tratto da tastiera è fitto come uno col puntatore.
const CURSOR_SAMPLE_PX = 4;
const CURSOR_SAMPLE_MS = 16;

/// Quanto il cursore resta lontano dal bordo del foglio, in pixel: oltre, la
/// vista lo segue.
const CURSOR_MARGIN_PX = 24;

/// Le frecce, come direzione.
const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/// Le frecce come si leggono nell'elenco dei tasti.
const ARROW_KEYS = "←↑→↓";

/// Il nome di ogni livello, come lo dice l'elenco dei tasti.
const LEVEL_NAMES: Readonly<Record<Level, DrawKey>> = {
  essential: "draw.level.essential",
  standard: "draw.level.standard",
  expert: "draw.level.expert",
};

/// Il tasto che mostra e nasconde gli attributi, dal livello Esperto: lo
/// stesso dell'editor XML di Inkscape.
const ATTRIBUTES_BINDING = "Mod-Shift-x";

/// Lo scarto di una copia dal suo originale, e fra due immagini incollate
/// insieme, in pixel dello schermo: si vedono tutte, a ogni zoom.
const COPY_STEP_PX = 24;

const INK_KEY = "pen";

/// Due tocchi sullo stesso testo entro questo tempo, in millisecondi, e
/// questa distanza, in pixel, lo aprono: un doppio tocco come quello di un
/// mouse, che vale anche per la penna e il dito.
const DOUBLE_TAP_MS = 500;
const DOUBLE_TAP_PX: Readonly<Record<InkPointerType, number>> = { pen: 8, mouse: 6, touch: 16 };

/// Dove sta la linea di base nella riga di un campo di testo, in volte il
/// corpo, sotto la metà della riga: metà della differenza fra la parte sopra
/// e quella sotto del carattere. Il browser la misura; dove non sa, vale
/// quella di Inter.
const BASELINE_EM = 0.363;

/// Lo spazio del cursore di testo in fondo alla riga più lunga, in pixel.
const CARET_PX = 2;

/// Quanto è largo un carattere, in volte il corpo, dove il browser non
/// misura il campo: una stima.
const CHAR_EM = 0.6;

/// Le icone della barra, col costrutto di `ui/icons.ts`.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-select": ["M6 3v15.5l4.2-4.1 2.9 6.6 2.6-1.1-2.9-6.5H19z"],
  "draw-pen": ["M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z", "M14 6.5l3 3"],
  "draw-eraser": ["M9 20h11", "M5.5 15.5l9.6-9.6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12.5 18.5 9 20l-3.5-1.5a2 2 0 0 1 0-3z", "M10 11l5 5"],
  "draw-rect": ["M4 6h16v12H4z"],
  "draw-ellipse": ["M3 12a9 6.5 0 1 0 18 0a9 6.5 0 1 0-18 0"],
  "draw-line": ["M5 19L19 5"],
  "draw-arrow": ["M5 19L19 5", "M10 5h9v9"],
  "draw-highlighter": ["M13.5 3.5l7 7-7 7-7-7z", "M6.5 10.5L3 18l3 3 7.5-3.5", "M15 21h6"],
  "draw-color-more": ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 8v8", "M8 12h8"],
  "draw-undo": ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  "draw-redo": ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  "draw-zoom-in": ["M12 5v14", "M5 12h14"],
  "draw-zoom-out": ["M5 12h14"],
  "draw-fit": ["M4 9V4h5", "M15 4h5v5", "M20 15v5h-5", "M9 20H4v-5"],
  "draw-duplicate": ["M9 9h11v11H9z", "M15 9V4H4v11h5"],
  "draw-group": ["M3 7V3h4", "M17 3h4v4", "M21 17v4h-4", "M7 21H3v-4", "M7 7h6v6H7z", "M11 11h6v6h-6z"],
  "draw-ungroup": ["M3 3h8v8H3z", "M13 13h8v8h-8z"],
  "draw-order": ["M10 14H4V4h10v6", "M10 10h10v10H10z"],
  "draw-align": ["M4 3v18", "M8 6h12v5H8z", "M8 14h7v5H8z"],
  "draw-layers": ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5", "M3 17.5l9 5 9-5"],
  "draw-into-layer": ["M12 11l9 5-9 5-9-5z", "M12 2v7", "M9 6l3 3 3-3"],
  "draw-page-grid": ["M3 3h18v18H3z", "M9 3v18", "M15 3v18", "M3 9h18", "M3 15h18"],
  "draw-text": ["M5 7V4h14v3", "M12 4v16", "M9 20h6"],
  "draw-text-edit": ["M3 6V4h11v2", "M8.5 4v15", "M6 19h5", "M18 8v12", "M16 8h4", "M16 20h4"],
  "draw-link": ["M9.5 14.5l5-5", "M11 6.5l1.5-1.5a3.5 3.5 0 0 1 5 5L16 11.5", "M8 12.5L6.5 14a3.5 3.5 0 0 0 5 5L13 17.5"],
  "draw-unlink": ["M11 6.5l1.5-1.5a3.5 3.5 0 0 1 5 5L16 11.5", "M8 12.5L6.5 14a3.5 3.5 0 0 0 5 5L13 17.5", "M4 8h2.5", "M8 4v2.5", "M20 16h-2.5", "M16 20v-2.5"],
  "draw-open-link": ["M14 4h6v6", "M20 4l-9 9", "M18 14v6H4V6h6"],
  "draw-attributes": ["M8 7l-5 5 5 5", "M16 7l5 5-5 5", "M13.5 5l-3 14"],
};

/// Registra le icone una volta per tutte le superfici: restano finché la
/// shell vive, come quelle di serie.
function ensureIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
}

/// Un collegamento che si vede, col suo segno sul foglio.
interface LinkMark {
  readonly unit: Unit;
  /// Dove porta, com'è scritto.
  readonly target: string;
  readonly element: HTMLButtonElement;
}

/// Un gesto in corso, dalla pipeline della penna.
type Gesture = InkGesture | ShapeGesture | SelectGesture | EraseGesture | TextGesture | RefusedGesture;

interface GestureBase {
  /// Il tratto della pipeline: cambia quando un gesto lungo continua in un
  /// tratto nuovo al limite dei campioni.
  stroke: number;
  readonly pointer: InkPointerType;
}

interface InkGesture extends GestureBase {
  readonly kind: "ink";
  readonly tool: Tool;
  readonly color: string;
  readonly brush: Pf1Brush;
  readonly to: Destination;
  readonly ids: NewIds;
  /// I campioni nella scena e nelle coordinate del livello.
  readonly scene: InkSample[];
  readonly local: InkSample[];
  predicted: readonly InkSample[];
}

interface ShapeGesture extends GestureBase {
  readonly kind: "shape";
  readonly tool: ShapeTool;
  readonly color: string;
  readonly width: number;
  readonly to: Destination;
  readonly ids: NewIds;
  from: Point | null;
  end: Point | null;
}

interface SelectGesture extends GestureBase {
  readonly kind: "select";
  from: Point | null;
  end: Point | null;
  /// `pending` finché un tocco su un oggetto non diventa trascinamento.
  mode: "pending" | "move" | "marquee";
  units: readonly Unit[];
  /// Per il riquadro: la selezione di partenza, che Maiusc conserva.
  base: readonly string[];
  /// Maiusc su un oggetto già scelto: un tocco lo toglie dalla selezione.
  release: string | null;
  /// L'angolo della geometria scelta che la griglia aggancia: il più vicino
  /// al punto preso.
  source: Point | null;
  /// L'oggetto sotto il primo punto, per il doppio tocco.
  hit: string | null;
}

interface EraseGesture extends GestureBase {
  readonly kind: "erase";
  last: Point | null;
  readonly marked: Map<string, Unit>;
}

/// Un tocco dello strumento Testo: dove si alza il puntatore si scrive.
interface TextGesture extends GestureBase {
  readonly kind: "text";
  from: Point | null;
}

/// Un testo che si sta scrivendo nel campo sopra il foglio.
interface Typing {
  /// La chiave del testo che si cambia; `null` per uno nuovo.
  readonly key: string | null;
  /// Il testo del campo all'apertura: se non cambia, non si scrive niente.
  readonly before: string;
  /// Come si vede il testo che si cambia; `null` per uno nuovo, che ha il
  /// colore e la dimensione dello strumento.
  readonly look: TextLook | null;
  /// Il punto d'ancoraggio, nelle coordinate del testo.
  readonly at: Point;
  /// Dalle coordinate del testo a quelle della scena.
  readonly matrix: Matrix;
}

/// Un gesto che non scrive: il documento non si modifica, o nessun livello
/// lo riceve.
interface RefusedGesture extends GestureBase {
  readonly kind: "refused";
}

function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

function union(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (a === null || b === null) return a ?? b;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])],
  };
}

function translated(bounds: Bounds | null, dx: number, dy: number): Bounds | null {
  return bounds === null ? null : { min: [bounds.min[0] + dx, bounds.min[1] + dy], max: [bounds.max[0] + dx, bounds.max[1] + dy] };
}

function toLocal(sample: InkSample, inverse: Matrix): InkSample {
  const [x, y] = apply(inverse, [sample.x, sample.y]);
  return { ...sample, x, y };
}

function sameDestination(a: Destination, b: Destination): boolean {
  return a.parent === b.parent && a.prelude.length === b.prelude.length && a.matrix.every((v, i) => v === b.matrix[i]);
}

function matrixText(m: Matrix): string {
  return `matrix(${m.join(" ")})`;
}

/// Quanti caratteri del nome di un livello entrano nel nome di un comando:
/// il resto, come «su» e «giù», deve restare in vista.
const LAYER_IN_COMMAND = 24;

/// Il nome di un livello come si mostra: gli spazi raccolti e, oltre `max`
/// caratteri, tagliato coi puntini. Un livello senza nome lo dice.
function layerTitle(layer: LayerInfo, max = MAX_LAYER_NAME): string {
  const name = layer.name.replace(/\s+/g, " ").trim();
  if (name === "") return t("draw.layer.unnamed");
  const chars = Array.from(name);
  return chars.length <= max ? name : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/// Lo stato di un livello a parole, come nell'albero degli oggetti: vuoto se
/// si vede e non è bloccato.
function layerState(layer: LayerInfo): string {
  const parts: string[] = [];
  if (layer.locked) parts.push(t("draw.state.locked"));
  if (layer.hidden) parts.push(t("draw.state.hidden"));
  return parts.join(", ");
}

/// Perché in `layer` non si disegna, o `null` se ci si disegna.
function layerRefusal(layer: LayerInfo): DrawKey | null {
  return layer.hidden ? "draw.layer.hidden_here" : layer.locked ? "draw.layer.locked_here" : null;
}

/// `next` come griglia, col passo di `before` se il suo è fuori dai limiti.
function checkedGrid(next: Grid, before: Grid): Grid {
  return { shown: next.shown, snap: next.snap, step: validStep(next.step) ? next.step : before.step };
}

/// Il verso di una freccia su un asse.
function sign(value: number): 1 | -1 {
  return value < 0 ? -1 : 1;
}

/// Monta l'editor dentro `host`.
export function createDrawEditor(host: HTMLElement, initial: SceneEngine, owner: Lifetime, options: DrawEditorOptions = {}): DrawEditor {
  ensureIcons();
  const life = openLifetime();
  let level: Level = options.level ?? "essential";
  let tools = toolsFor(level);
  const relabels: Array<() => void> = [];

  let engine = initial;
  let tool: ToolId = DEFAULT_TOOL;
  /// Il colore e lo spessore di chi scrive: la penna e le forme li
  /// condividono, l'evidenziatore ha i suoi.
  const styles: Record<Tool, { color: string; width: number }> = {
    pen: { color: DEFAULT_COLOR, width: DEFAULT_WIDTH },
    highlighter: { color: HIGHLIGHTER_COLOR, width: HIGHLIGHTER_WIDTH },
  };
  /// Il testo ha il colore della penna e il corpo suo, che la barra mostra
  /// al posto dello spessore.
  const textStyle = {
    get color(): string {
      return styles.pen.color;
    },
    set color(value: string) {
      styles.pen.color = value;
    },
    width: TEXT_SIZE,
  };
  const style = (): { color: string; width: number } => (tool === "text" ? textStyle : styles[tool === "highlighter" ? "highlighter" : "pen"]);
  /// Gli spessori, o le dimensioni del testo, che la barra offre allo
  /// strumento di adesso.
  const widthsNow = (): readonly Width[] => (tool === "highlighter" ? HIGHLIGHTER_WIDTHS : tool === "text" ? TEXT_SIZES : WIDTHS);
  /// L'ultimo colore scelto a piacere: un campione in più nella barra.
  let custom: string | null = null;
  let selection: string[] = [];
  let camera: Camera = { scale: 1, tx: 0, ty: 0 };
  /// Il formato della percentuale di zoom, nella lingua di adesso.
  let percent: Intl.NumberFormat | null = null;
  const zoomText = (): string =>
    (percent ??= new Intl.NumberFormat(resolvedLanguage(), { style: "percent", maximumFractionDigits: 0 })).format(camera.scale);
  let placed = false;
  let current: Gesture | null = null;
  let shift = false;
  let disposed = false;
  /// La scrittura tolta da chi monta l'editor.
  let locked = false;
  /// La selezione dell'ultima notifica, per non ripeterla.
  let noticed = "";
  /// Il cursore del foglio, nella scena: dove disegna la tastiera. `null`
  /// finché nessuno l'ha mosso.
  let cursor: Point | null = null;
  /// Il gesto che la tastiera tiene premuto: i campioni dati finora, l'ultimo
  /// punto e il suo tempo.
  let pressed: { readonly start: StrokeStart; readonly samples: InkSample[]; at: Point; time: number } | null = null;
  /// Gli id dei tratti da tastiera: negativi, così non incontrano mai quelli
  /// della pipeline, che crescono da zero.
  let keyStrokes = 0;
  /// Una finestra dell'editor è aperta, o un'immagine sta entrando: un
  /// secondo Invio non ne apre un'altra.
  let asking = false;
  /// Quante volte l'editor ha caricato un altro documento: un'immagine letta
  /// per il documento di prima non entra in quello nuovo.
  let loads = 0;
  /// Il livello corrente scelto, dal livello Standard: la sua chiave, e il
  /// suo posto fra i figli della radice per ritrovarlo quando la chiave non
  /// c'è più. `null` finché nessuno ne sceglie uno.
  let chosen: { readonly key: string; readonly at: number } | null = null;
  /// La griglia, e se Ctrl o ⌘ è tenuto durante un gesto del puntatore: col
  /// tasto giù l'aggancio aspetta.
  let grid: Grid = options.grid === undefined ? DEFAULT_GRID : checkedGrid(options.grid, DEFAULT_GRID);
  let free = false;
  /// Il testo che si sta scrivendo nel campo sopra il foglio.
  let typing: Typing | null = null;
  /// Il puntatore è sceso sul foglio mentre si scriveva: quel tocco chiude il
  /// testo, e lo strumento Testo non ne apre un altro.
  let closedTyping = false;
  /// L'ultimo tocco della selezione su un oggetto, per il doppio tocco.
  let lastTap: { readonly key: string; readonly time: number; readonly at: Point } | null = null;
  const history = new History();

  // --- DOM ----------------------------------------------------------------

  const root = document.createElement("div");
  root.className = "draw-editor";
  const header = document.createElement("div");
  header.className = "draw-header";
  const toolbar = document.createElement("div");
  toolbar.className = "draw-toolbar";
  toolbar.setAttribute("role", "toolbar");
  const surface = document.createElement("div");
  surface.className = "draw-surface";
  surface.tabIndex = 0;
  surface.setAttribute("role", "application");
  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  // Che cosa fanno i tasti sul foglio, letto quando ci arriva il fuoco.
  const surfaceHint = document.createElement("span");
  surfaceHint.className = "sr-only";
  surfaceHint.id = identifier("draw-surface-hint");
  surface.setAttribute("aria-describedby", surfaceHint.id);
  /// Il suggerimento del foglio dice anche come si arriva ai comandi della
  /// selezione, dal livello che li ha.
  const showSurfaceHint = (): void => {
    surfaceHint.textContent = t(reaches(level, "standard") ? "draw.surface.hint.arrange" : "draw.surface.hint");
  };
  relabels.push(() => {
    toolbar.setAttribute("aria-label", t("draw.toolbar"));
    surface.setAttribute("aria-label", t("draw.surface"));
    showSurfaceHint();
  });

  const group = (label: DrawKey, radio: boolean): HTMLElement => {
    const element = document.createElement("div");
    element.className = "draw-group";
    element.setAttribute("role", radio ? "radiogroup" : "group");
    relabels.push(() => element.setAttribute("aria-label", t(label)));
    toolbar.append(element);
    return element;
  };

  const button = (parent: HTMLElement, className: string, label: () => string, iconName: string | null, run: () => void): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = className;
    control.tabIndex = -1;
    if (iconName !== null) {
      const svg = iconEl(iconName);
      if (svg !== null) control.append(svg);
    }
    relabels.push(() => {
      const text = label();
      control.setAttribute("aria-label", text);
      control.title = text;
    });
    life.listen(control, "click", () => run());
    parent.append(control);
    return control;
  };

  // Ogni strumento del registro ha il suo pulsante; quelli sopra il livello
  // restano nascosti finché il livello non sale.
  const toolButtons = new Map<ToolId, HTMLButtonElement>();
  const toolGroup = group("draw.tools", true);
  for (const spec of TOOLS) {
    const shortcut = spec.shortcut.toUpperCase();
    const control = button(toolGroup, "draw-button draw-tool", () => `${t(spec.label)} (${shortcut})`, spec.icon, () => setTool(spec.id));
    control.setAttribute("role", "radio");
    control.setAttribute("aria-keyshortcuts", shortcut);
    control.dataset.tool = spec.id;
    const hint = document.createElement("span");
    hint.className = "sr-only";
    hint.id = identifier(`draw-hint-${spec.id}`);
    control.setAttribute("aria-describedby", hint.id);
    relabels.push(() => {
      hint.textContent = t(spec.description);
      control.setAttribute("aria-label", t(spec.label));
    });
    control.append(hint);
    toolButtons.set(spec.id, control);
  }

  const colorButtons = new Map<string, HTMLButtonElement>();
  const colorGroup = group("draw.colors", true);
  for (const swatch of PALETTE) {
    const control = button(colorGroup, "draw-button draw-color", () => t(swatch.label), null, () => setColor(swatch.color));
    control.setAttribute("role", "radio");
    const frame = document.createElement("span");
    frame.className = "draw-swatch-frame";
    frame.dataset.shape = swatch.shape;
    const chip = document.createElement("span");
    chip.className = "draw-swatch";
    chip.style.setProperty("--swatch", swatch.color);
    frame.append(chip);
    control.append(frame);
    colorButtons.set(swatch.color, control);
  }
  // Il colore a piacere: il suo campione, nella stessa scelta della
  // tavolozza, e dopo il pulsante che lo chiede. Il campione ha una forma
  // sua, l'anello, e il nome dice il codice.
  const customLabel = (): string =>
    custom === null ? t("draw.color.dialog") : t(isLight(custom) ? "draw.color.custom.light" : "draw.color.custom", { code: custom });
  const customButton = button(colorGroup, "draw-button draw-color", customLabel, null, () => {
    if (custom !== null) setColor(custom);
  });
  customButton.setAttribute("role", "radio");
  const customFrame = document.createElement("span");
  customFrame.className = "draw-swatch-frame";
  customFrame.dataset.shape = "ring";
  const customChip = document.createElement("span");
  customChip.className = "draw-swatch";
  customFrame.append(customChip);
  customButton.append(customFrame);
  const moreGroup = document.createElement("div");
  moreGroup.className = "draw-group";
  toolbar.append(moreGroup);
  const moreButton = button(moreGroup, "draw-button", () => t("draw.color.more"), "draw-color-more", () => void chooseColor());
  moreButton.setAttribute("aria-haspopup", "dialog");

  // Gli spessori, per posizione: Sottile, Medio, Spesso valgono per la penna
  // e le forme quelli della tavolozza, per l'evidenziatore i suoi. Per il
  // testo sono le dimensioni, Piccolo, Medio e Grande, con una lettera al
  // posto della barra.
  const widthButtons: Array<{ readonly control: HTMLButtonElement; readonly bar: HTMLElement; readonly glyph: HTMLElement }> = [];
  const widthGroup = group("draw.widths", true);
  WIDTHS.forEach((_, at) => {
    const control = button(widthGroup, "draw-button draw-width", () => t(widthsNow()[at]!.label), null, () => setWidth(widthsNow()[at]!.value));
    control.setAttribute("role", "radio");
    const bar = document.createElement("span");
    bar.className = "draw-width-bar";
    const glyph = document.createElement("span");
    glyph.className = "draw-size-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "A";
    glyph.style.setProperty("--draw-size", `${SIZE_GLYPH_PX[at]}px`);
    control.append(bar, glyph);
    widthButtons.push({ control, bar, glyph });
  });
  /// Il nome del gruppo e dei pulsanti: spessori, o dimensioni del testo.
  const showWidthLabels = (): void => {
    const label = t(tool === "text" ? "draw.sizes" : "draw.widths");
    if (widthGroup.getAttribute("aria-label") !== label) widthGroup.setAttribute("aria-label", label);
    const widths = widthsNow();
    widthButtons.forEach(({ control }, at) => {
      const text = t(widths[at]!.label);
      if (control.getAttribute("aria-label") === text) return;
      control.setAttribute("aria-label", text);
      control.title = text;
    });
  };
  relabels.push(showWidthLabels);

  const editGroup = group("draw.edit", false);
  const undoButton = button(editGroup, "draw-button", () => t("draw.undo"), "draw-undo", () => undo());
  undoButton.setAttribute("aria-keyshortcuts", "Control+Z");
  const redoButton = button(editGroup, "draw-button", () => t("draw.redo"), "draw-redo", () => redo());
  redoButton.setAttribute("aria-keyshortcuts", "Control+Shift+Z Control+Y");
  const deleteButton = button(editGroup, "draw-button", () => t("draw.delete"), "trash", () => deleteSelection());
  deleteButton.setAttribute("aria-keyshortcuts", "Delete");
  const propertiesButton = button(editGroup, "draw-button", () => t("draw.properties"), "properties", () => void properties());
  propertiesButton.setAttribute("aria-keyshortcuts", "Enter");
  propertiesButton.setAttribute("aria-haspopup", "dialog");

  // I livelli, dal livello Standard: il pulsante dice dove si disegna e apre
  // il menu che li sceglie e li cambia.
  const layerGroup = group("draw.layers", false);
  const layersButton = button(layerGroup, "draw-button draw-layer-button", () => layersLabel(), "draw-layers", () => openMenu(layersButton, layerItems()));
  layersButton.setAttribute("aria-haspopup", "menu");
  layersButton.setAttribute("aria-expanded", "false");
  const layerText = document.createElement("span");
  layerText.className = "draw-layer-name";
  const layerStateText = document.createElement("span");
  layerStateText.className = "draw-layer-state";
  layersButton.append(layerText, layerStateText);

  // L'albero degli oggetti, chiuso finché qualcuno non lo apre.
  const tree = createObjectTree(life, {
    onSelect(keys) {
      cancelGesture();
      select(keys);
      const unit = keys.length === 1 ? currentIndex().get(keys[0]!) : null;
      if (unit !== null) frameBounds(unit.bounds);
    },
    onActivate: () => void properties(),
    onDelete: () => deleteSelection(),
    onLeave: () => surface.focus({ preventScroll: true }),
  });
  tree.element.hidden = true;
  relabels.push(() => tree.relabel());

  // Gli attributi dell'oggetto scelto, dal livello Esperto: chiusi finché
  // qualcuno non li apre, sotto l'albero se è aperto anche quello.
  const inspector = createInspector(life, {
    onSet: (subject, key, value) => {
      const change = attributeOps(subject, key, value, newIds());
      return changeObject("draw.action.attribute", change.ops, change.id);
    },
    onRename: (subject, next) => changeObject("draw.action.rename", renameOps(subject, next), next),
    taken: (id) => engine.holder(id) !== null,
    cited: (id) => cited(id),
    announce: (text) => announce(text),
    onLeave: () => surface.focus({ preventScroll: true }),
  });
  inspector.element.hidden = true;
  relabels.push(() => inspector.relabel());

  const viewGroup = group("draw.view", false);
  button(viewGroup, "draw-button", () => t("draw.zoom_out"), "draw-zoom-out", () => zoomBy(1 / ZOOM_STEP));
  // Il nome contiene la percentuale che si vede (WCAG 2.5.3): chi la dice a
  // voce trova il pulsante.
  const zoomLevel = button(viewGroup, "draw-button draw-zoom-level", () => t("draw.zoom_reset", { zoom: zoomText() }), null, () => zoomBy(1 / camera.scale));
  button(viewGroup, "draw-button", () => t("draw.zoom_in"), "draw-zoom-in", () => zoomBy(ZOOM_STEP));
  const fitButton = button(viewGroup, "draw-button", () => t("draw.fit"), "draw-fit", () => fit());
  fitButton.setAttribute("aria-keyshortcuts", "Shift+1");
  // La griglia e la pagina, dal livello Standard: un menu.
  const pageButton = button(viewGroup, "draw-button", () => t("draw.page_grid"), "draw-page-grid", () => openMenu(pageButton, pageItems()));
  pageButton.setAttribute("aria-haspopup", "menu");
  pageButton.setAttribute("aria-expanded", "false");
  const objectsButton = button(viewGroup, "draw-button", () => t("draw.objects"), "outline", () => showObjects(tree.element.hidden));
  objectsButton.setAttribute("aria-expanded", "false");
  objectsButton.setAttribute("aria-controls", tree.element.id);
  // Gli attributi, dal livello Esperto.
  const attributesButton = button(viewGroup, "draw-button", () => t("draw.attributes"), "draw-attributes", () => showAttributes(inspector.element.hidden));
  attributesButton.setAttribute("aria-expanded", "false");
  attributesButton.setAttribute("aria-controls", inspector.element.id);
  attributesButton.setAttribute("aria-keyshortcuts", ariaBinding(ATTRIBUTES_BINDING));
  relabels.push(() => {
    attributesButton.title = `${t("draw.attributes")} (${displayBinding(ATTRIBUTES_BINDING)})`;
  });
  const keysButton = button(viewGroup, "draw-button", () => t("draw.keys"), "keyboard", () => void keys());
  keysButton.setAttribute("aria-keyshortcuts", "?");
  keysButton.setAttribute("aria-haspopup", "dialog");

  const titleField = document.createElement("label");
  titleField.className = "draw-title";
  const titleText = document.createElement("span");
  titleText.className = "draw-title-label";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "draw-title-input";
  titleInput.autocomplete = "off";
  titleInput.spellcheck = true;
  titleField.append(titleText, titleInput);
  relabels.push(() => {
    titleText.textContent = t("draw.title");
    titleInput.placeholder = t("draw.title.placeholder");
  });

  // I comandi della selezione, dal livello Standard: una barra che galleggia
  // in cima al foglio finché c'è qualcosa di scelto, così sceglie non sposta
  // niente. Ordine e allineamento sono due menu: la barra resta corta anche
  // su un telefono.
  const arrangeBar = document.createElement("div");
  arrangeBar.className = "draw-arrange";
  arrangeBar.setAttribute("role", "toolbar");
  arrangeBar.hidden = true;
  relabels.push(() => arrangeBar.setAttribute("aria-label", t("draw.arrange")));
  /// Il nome di un pulsante della barra, e nel suggerimento la scorciatoia.
  const nameArrange = (control: HTMLButtonElement, text: string, binding: string | null): void => {
    control.setAttribute("aria-label", text);
    control.title = binding === null ? text : `${text} (${displayBinding(binding)})`;
  };
  /// Un pulsante della barra; il nome è una chiave, o una funzione per quelli
  /// che cambiano nome con la selezione.
  const arrangeButton = (label: DrawKey | (() => string), iconName: string, binding: string | null, run: () => void): HTMLButtonElement => {
    const text = typeof label === "function" ? label : () => t(label);
    const control = button(arrangeBar, "draw-button", text, iconName, run);
    // Un tasto senza modificatori, come F2, si scrive com'è.
    if (binding !== null) control.setAttribute("aria-keyshortcuts", ariaBinding(binding) || binding);
    relabels.push(() => nameArrange(control, text(), binding));
    return control;
  };
  // Un testo scelto da solo si cambia sul posto.
  const textButton = arrangeButton("draw.text.edit", "draw-text-edit", "F2", () => editSelectedText());
  arrangeButton("draw.duplicate", "draw-duplicate", "Mod-d", () => duplicateSelection());
  const groupButton = arrangeButton("draw.group", "draw-group", "Mod-g", () => groupSelection());
  const ungroupButton = arrangeButton("draw.ungroup", "draw-ungroup", "Mod-Shift-g", () => ungroupSelection());
  // Il collegamento scelto da solo: dove porta, e il suo nome. Il pulsante
  // che collega lo cambia, e quello che apre lo nomina.
  let shownLink: { readonly target: string | null } | null = null;
  const linkText = (): string => t(shownLink === null ? "draw.link" : "draw.link.change");
  const openLinkText = (): string => {
    const target = shownLink?.target ?? null;
    return t("draw.link.open", { note: target === null ? "" : linkName(target) });
  };
  const linkButton = arrangeButton(linkText, "draw-link", "Mod-k", () => void linkSelection());
  linkButton.setAttribute("aria-haspopup", "dialog");
  const openLinkButton = arrangeButton(openLinkText, "draw-open-link", "Alt-Enter", () => openSelectedLink());
  const unlinkButton = arrangeButton("draw.unlink", "draw-unlink", "Mod-Shift-k", () => unlinkSelection());
  const orderButton = arrangeButton("draw.order", "draw-order", null, () => openMenu(orderButton, orderItems()));
  const intoButton = arrangeButton("draw.into_layer", "draw-into-layer", null, () => openMenu(intoButton, intoItems()));
  const alignButton = arrangeButton("draw.align", "draw-align", null, () => openMenu(alignButton, alignItems()));
  for (const control of [orderButton, intoButton, alignButton]) {
    control.setAttribute("aria-haspopup", "menu");
    control.setAttribute("aria-expanded", "false");
  }
  // Esc nella barra torna al foglio, con la selezione com'era.
  life.listen(arrangeBar, "keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    surface.focus({ preventScroll: true });
  });

  // Il campo in cui si scrive un testo: sopra il foglio e fuori dalla sua
  // pipeline, nascosto finché non si scrive. Lo strato lo taglia ai bordi
  // del foglio e non scorre mai.
  const textLayer = document.createElement("div");
  textLayer.className = "draw-text-layer";
  textLayer.hidden = true;
  const textInput = document.createElement("textarea");
  textInput.className = "draw-text-input";
  textInput.wrap = "off";
  textInput.rows = 1;
  textInput.autocomplete = "off";
  textInput.spellcheck = true;
  const textHint = document.createElement("span");
  textHint.className = "sr-only";
  textHint.id = identifier("draw-text-hint");
  textInput.setAttribute("aria-describedby", textHint.id);
  textLayer.append(textInput, textHint);
  /// Il nome del campo: un testo nuovo, o uno che c'è.
  const labelText = (): void => textInput.setAttribute("aria-label", t(typing !== null && typing.key !== null ? "draw.text.change" : "draw.text.new"));
  relabels.push(() => {
    textHint.textContent = t("draw.text.hint", { key: modifierName("Mod") ?? "Ctrl" });
    labelText();
  });
  ensureTextFont();

  // I segni dei collegamenti: uno sull'angolo in alto a destra di ogni
  // collegamento che si vede, sopra il foglio e fuori dalla sua pipeline. Il
  // tocco apre la nota con lo strumento Selezione, o quando il disegno non si
  // scrive; con gli altri strumenti il foglio è di chi disegna, e il segno si
  // vede soltanto. Dalla tastiera si apre con Alt+Invio.
  const linkLayer = document.createElement("div");
  linkLayer.className = "draw-link-layer";
  linkLayer.hidden = options.links === undefined;

  // Il foglio con la sua barra e, accanto, i pannelli: l'albero degli
  // oggetti e, sotto, gli attributi.
  const stage = document.createElement("div");
  stage.className = "draw-stage";
  stage.append(surface, linkLayer, textLayer, arrangeBar);
  const dock = document.createElement("div");
  dock.className = "draw-dock";
  dock.hidden = true;
  dock.append(tree.element, inspector.element);
  const body = document.createElement("div");
  body.className = "draw-body";
  body.append(stage, dock);
  header.append(toolbar, titleField);
  root.append(header, body, surfaceHint, live);
  host.append(root);

  // La carta, la griglia, il painter, poi l'anteprima delle forme, poi lo
  // strato sopra: l'ordine in cui si vedono. La carta è bianca in ogni tema:
  // è il fondo su cui il disegno si legge anche fuori dall'editor, e su cui
  // S009 misura il contrasto del tratto.
  const paper = document.createElement("div");
  paper.className = "draw-page";
  paper.setAttribute("aria-hidden", "true");
  surface.append(paper);
  // Le righe sottili e, una ogni cinque, quelle marcate.
  const gridMark = document.createElementNS(SVG_NS, "svg");
  gridMark.setAttribute("class", "draw-grid");
  gridMark.setAttribute("aria-hidden", "true");
  const gridMinor = document.createElementNS(SVG_NS, "path");
  const gridMajor = document.createElementNS(SVG_NS, "path");
  gridMajor.setAttribute("data-major", "");
  gridMark.append(gridMinor, gridMajor);
  surface.append(gridMark);
  const painter = createSvgPainter(surface, life, options.images === undefined ? {} : { images: options.images });
  const preview = document.createElementNS(SVG_NS, "svg");
  preview.setAttribute("class", "draw-preview");
  preview.setAttribute("aria-hidden", "true");
  const previewCamera = document.createElementNS(SVG_NS, "g");
  const previewLayer = document.createElementNS(SVG_NS, "g");
  previewCamera.append(previewLayer);
  preview.append(previewCamera);
  surface.append(preview);
  const overlay = createOverlay(surface, life);
  // Il cursore del foglio: si vede quando lo muove la tastiera.
  const cursorMark = document.createElement("div");
  cursorMark.className = "draw-cursor";
  cursorMark.setAttribute("aria-hidden", "true");
  cursorMark.hidden = true;
  surface.append(cursorMark);

  const builder = new PaintBuilder();
  const indexer = new SceneIndexer(builder);
  let scene: PaintScene = builder.build(engine);
  let index: SceneIndex | null = null;
  const EMPTY = new SceneIndex([], []);

  const editable = (): boolean => !locked && engine.status === "fubdraw" && engine.model !== null;

  const currentIndex = (): SceneIndex => {
    if (index === null) index = engine.model === null ? EMPTY : indexer.index(engine.model);
    return index;
  };

  const newIds = (): NewIds => new NewIds((id) => engine.holder(id) !== null);

  // --- Annunci ------------------------------------------------------------

  let echo = false;
  /// Il testo cambia sempre, anche quando la frase è la stessa di prima:
  /// uno spazio fermo in coda, alterno, la fa annunciare di nuovo.
  const announce = (text: string): void => {
    echo = !echo;
    live.textContent = echo ? text : `${text} `;
  };

  const objects = (): string => plural(currentIndex().units.length, "draw.objects.one", "draw.objects.other");

  const announceSelection = (): void => {
    announce(selection.length === 0 ? t("draw.selected.none") : plural(selection.length, "draw.selected.one", "draw.selected.other"));
  };

  // --- Camera -------------------------------------------------------------

  const showZoom = (force = false): void => {
    const text = zoomText();
    if (!force && zoomLevel.textContent === text) return;
    zoomLevel.textContent = text;
    const label = t("draw.zoom_reset", { zoom: text });
    zoomLevel.setAttribute("aria-label", label);
    zoomLevel.title = label;
  };

  /// La pagina sullo schermo; senza pagina la carta è tutto il foglio.
  const showPage = (): void => {
    const page = scene.root.page;
    surface.toggleAttribute("data-unbounded", page === null);
    paper.hidden = page === null;
    if (page === null) return;
    const { scale, tx, ty } = camera;
    paper.style.transform = `translate(${tx + scale * page.x}px, ${ty + scale * page.y}px)`;
    paper.style.width = `${scale * page.width}px`;
    paper.style.height = `${scale * page.height}px`;
  };

  /// La griglia sullo schermo, dal livello Standard e se la si vuole vedere.
  const showGrid = (): void => {
    const shown = reaches(level, "standard") && grid.shown;
    gridMark.style.display = shown ? "" : "none";
    if (!shown) return;
    const lines = gridLines(camera, surface.clientWidth, surface.clientHeight, grid.step);
    gridMinor.setAttribute("d", lines.minor);
    gridMajor.setAttribute("d", lines.major);
  };

  /// Il cursore del foglio sullo schermo; pieno mentre la tastiera preme.
  const showCursor = (): void => {
    cursorMark.toggleAttribute("data-pressed", pressed !== null);
    if (cursor === null) return;
    const { scale, tx, ty } = camera;
    cursorMark.style.transform = `translate(${tx + scale * cursor[0]}px, ${ty + scale * cursor[1]}px)`;
  };

  const setCamera = (next: Camera): void => {
    camera = next;
    painter.setView(next);
    overlay.setView(next);
    previewCamera.setAttribute("transform", `matrix(${next.scale} 0 0 ${next.scale} ${next.tx} ${next.ty})`);
    showPage();
    showGrid();
    showZoom();
    showCursor();
    placeText();
    showLinks();
  };
  /// Il formato delle coordinate dette a voce, nella lingua di adesso.
  let coordinates: Intl.NumberFormat | null = null;
  const numberText = (value: number): string =>
    (coordinates ??= new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: 1 })).format(Math.round(value * 10) / 10 || 0);
  relabels.push(() => {
    percent = null;
    coordinates = null;
    showZoom(true);
  });

  const localPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = surface.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const zoomBy = (factor: number): void => {
    setCamera(zoomAtPoint(camera, factor, { x: surface.clientWidth / 2, y: surface.clientHeight / 2 }, DRAW_SCALE_LIMITS));
  };

  function fit(): void {
    const page = scene.root.page;
    let bounds: Bounds | null = page === null ? null : { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] };
    for (const unit of currentIndex().units) bounds = union(bounds, unit.bounds);
    const view = { w: surface.clientWidth, h: surface.clientHeight };
    if (view.w === 0 || view.h === 0) return;
    placed = true;
    if (bounds === null) {
      setCamera({ scale: 1, tx: 0, ty: 0 });
      return;
    }
    const world = { minX: bounds.min[0], minY: bounds.min[1], maxX: bounds.max[0], maxY: bounds.max[1] };
    setCamera(fitBounds(world, view, FIT_PAD, 0, DRAW_SCALE_LIMITS));
  }

  // Il primo inquadramento aspetta che il foglio abbia una misura.
  if (typeof ResizeObserver !== "undefined") {
    const sizeObserver = new ResizeObserver(() => {
      if (!placed) fit();
      showGrid();
    });
    sizeObserver.observe(surface);
    life.add(() => sizeObserver.disconnect());
  }

  // --- Selezione e anteprime ----------------------------------------------

  const selectedUnits = (): Unit[] => {
    const keys = new Set(selection);
    return currentIndex().units.filter((unit) => keys.has(unit.key));
  };

  /// Le chiavi di `keys` che sono oggetti adesso, in ordine di documento.
  const inOrder = (keys: Iterable<string>): string[] => {
    const wanted = new Set(keys);
    return currentIndex().units.filter((unit) => wanted.has(unit.key)).map((unit) => unit.key);
  };

  /// Le cornici della selezione, e il riquadro di un trascinamento sul vuoto.
  const showHandles = (): void => {
    const handles: OverlayHandle[] = [];
    const move = current?.kind === "select" && current.mode === "move" ? current : null;
    const delta = move === null ? null : moveDelta(move);
    for (const unit of selectedUnits()) {
      const frame = unit.frame();
      if (frame === null) continue;
      let matrix = unit.matrix;
      if (delta !== null) {
        const moved = movedMatrix(unit, delta[0], delta[1]);
        if (moved !== null) matrix = compose(unit.parent, moved);
      }
      const scale = scaleOf(matrix) * camera.scale;
      const pad = scale > 0 ? FRAME_PX / scale : 0;
      handles.push({
        kind: "box",
        x: frame.min[0] - pad,
        y: frame.min[1] - pad,
        width: frame.max[0] - frame.min[0] + 2 * pad,
        height: frame.max[1] - frame.min[1] + 2 * pad,
        matrix,
      });
    }
    if (current?.kind === "select" && current.mode === "marquee" && current.from !== null && current.end !== null) {
      const [x1, y1] = current.from;
      const [x2, y2] = current.end;
      handles.push({ kind: "lasso", points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] });
    }
    overlay.setHandles(handles);
    showLinks(delta);
    const keys = selection.join("\n");
    if (keys !== noticed) {
      noticed = keys;
      followSelection();
      syncTree();
      syncInspector();
      options.onSelectionChange?.();
    }
  };

  // --- I segni dei collegamenti ---------------------------------------------

  /// I collegamenti che si vedono, ognuno col suo segno: si ricostruiscono
  /// quando cambia la scena.
  let marks: LinkMark[] | null = null;

  const labelMarks = (): void => {
    for (const { target, element } of marks ?? []) {
      const text = t("draw.link.open", { note: linkName(target) });
      element.setAttribute("aria-label", text);
      element.title = text;
    }
  };
  relabels.push(labelMarks);

  /// I segni sullo schermo. Durante uno spostamento seguono gli oggetti
  /// scelti, di `delta` nella scena, e i collegamenti che contengono.
  function showLinks(delta: readonly [number, number] | null = null): void {
    if (options.links === undefined) return;
    if (marks === null) {
      const model = engine.model;
      const list: LinkMark[] = [];
      for (const unit of model === null ? [] : indexer.links(model)) {
        const target = linkTarget(nodeOf(model!, unit));
        if (target === null || unit.bounds === null) continue;
        const element = document.createElement("button");
        element.type = "button";
        element.className = "draw-link-mark";
        element.tabIndex = -1;
        element.dataset.mark = String(list.length);
        const svg = iconEl("draw-link");
        if (svg !== null) element.append(svg);
        list.push({ unit, target, element });
      }
      marks = list;
      linkLayer.replaceChildren(...list.map((mark) => mark.element));
      labelMarks();
    }
    const moving = delta === null ? [] : selectedUnits().map((unit) => unit.path);
    const { scale, tx, ty } = camera;
    for (const { unit, element } of marks) {
      const moved = delta !== null && moving.some((path) => path.every((at, i) => unit.path[i] === at));
      const bounds = (moved ? translated(unit.bounds, delta[0], delta[1]) : unit.bounds)!;
      element.style.transform = `translate(${tx + scale * bounds.max[0]}px, ${ty + scale * bounds.min[1]}px)`;
    }
  }

  /// Apre la nota a cui porta `target`: il gesto in corso si annulla, e un
  /// testo che si scrive si chiude.
  const openLink = (target: string): void => {
    const links = options.links;
    if (links === undefined) return;
    finishText();
    cancelGesture();
    links.open(target);
  };

  life.listen(linkLayer, "click", (event) => {
    const element = event.target instanceof Element ? event.target.closest(".draw-link-mark") : null;
    const mark = element instanceof HTMLElement ? marks?.[Number(element.dataset.mark)] : undefined;
    if (mark !== undefined) openLink(mark.target);
  });

  const showShape = (elem: Elem | null, matrix: Matrix): void => {
    previewLayer.replaceChildren();
    if (elem === null) return;
    previewLayer.setAttribute("transform", matrixText(matrix));
    const shape = document.createElementNS(SVG_NS, elem.tag);
    // I nomi con un prefisso sono dati di FubDraw: non si disegnano.
    for (const [name, value] of Object.entries(elem.attrs)) if (!name.includes(":")) shape.setAttribute(name, value);
    previewLayer.append(shape);
  };

  const clearPreviews = (): void => {
    overlay.setInk(INK_KEY, null);
    showShape(null, [1, 0, 0, 1, 0, 0]);
    painter.setDraft(null);
    showHandles();
    overlay.flush();
  };

  // --- L'albero degli oggetti ----------------------------------------------

  /// Il disegno in albero, ricalcolato quando cambia la scena, e i suoi nodi
  /// per chiave.
  let outlined: { readonly items: readonly Item[]; readonly nodes: OutlineNode[]; readonly byKey: Map<string, OutlineNode> } | null = null;
  const outlineNow = (): NonNullable<typeof outlined> => {
    const items = engine.scene();
    if (outlined?.items !== items) {
      const model = engine.model;
      const nodes = outline(items, (item) => (model === null ? null : linkTarget(nodeOf(model, item))));
      const byKey = new Map<string, OutlineNode>();
      const walkNodes = (list: readonly OutlineNode[]): void => {
        for (const node of list) {
          byKey.set(node.key, node);
          walkNodes(node.children);
        }
      };
      walkNodes(nodes);
      outlined = { items, nodes, byKey };
    }
    return outlined;
  };

  /// Il nome del colore di un oggetto, se è uno della tavolozza: il
  /// contorno, o il riempimento se non ne ha.
  const colorOf = (unit: Unit | undefined): string | null => {
    const attrs = new Map(unit?.paints[0]?.attrs ?? []);
    const stroke = attrs.get("stroke");
    const value = stroke !== undefined && stroke !== "none" ? stroke : attrs.get("fill");
    const swatch = value === undefined ? null : swatchOf(value);
    return swatch === null ? null : t(swatch.label);
  };

  const describeNode = (node: OutlineNode, unit: Unit | undefined): string => describe(node, { parts: true, color: colorOf(unit) });

  /// Il nome a parole di un oggetto che si sceglie.
  const labelOf = (unit: Unit): string => {
    const node = outlineNow().byKey.get(unit.key);
    return node === undefined ? unit.tag : describeNode(node, unit);
  };

  /// Le voci dell'albero; il livello di chiave `current` dice che è quello
  /// corrente.
  const entriesOf = (nodes: readonly OutlineNode[], index: SceneIndex, current: string | null): TreeEntry[] =>
    nodes.map((node) => {
      const unit = index.get(node.key) ?? undefined;
      const layer = node.item.role === "layer";
      const mark = layer && node.key === current ? `, ${t("draw.state.current")}` : "";
      return {
        key: node.key,
        layer,
        selectable: unit !== undefined,
        children: layer ? entriesOf(node.children, index, current) : [],
        label: () => `${describeNode(node, unit)}${mark}`,
      };
    });

  /// Le voci dell'albero per l'indice e il livello corrente di adesso, e la
  /// selezione mostrata.
  let treeShown: { readonly index: SceneIndex; readonly layer: string | null; readonly entries: TreeEntry[]; readonly count: number; keys: string } | null = null;

  /// Porta l'albero, se è aperto, alla scena e alla selezione di adesso.
  function syncTree(): void {
    if (tree.element.hidden) return;
    const index = currentIndex();
    const keys = selection.join("\n");
    const layer = reaches(level, "standard") ? currentLayer() : null;
    const current = layer === null ? null : keyOf(layer);
    if (treeShown?.index !== index || treeShown.layer !== current) {
      const nodes = outlineNow().nodes;
      treeShown = { index, layer: current, entries: entriesOf(nodes, index, current), count: countObjects(nodes), keys: "" };
    } else if (treeShown.keys === keys) {
      return;
    }
    treeShown.keys = keys;
    tree.update(treeShown.entries, selection, treeShown.count);
  }

  /// Apre o chiude l'albero; aperto, il fuoco ci va.
  function showObjects(open: boolean): void {
    if (!open && tree.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    tree.element.hidden = !open;
    objectsButton.setAttribute("aria-expanded", String(open));
    dock.hidden = tree.element.hidden && inspector.element.hidden;
    if (open) {
      treeShown = null;
      syncTree();
      tree.focus();
    }
  }

  // --- Gli attributi -----------------------------------------------------------

  /// Ciò che il pannello mostra; la chiave con cui conosce l'oggetto, che
  /// resta la stessa quando l'oggetto riceve un id o lo cambia dal pannello.
  let inspectorShown: {
    readonly subject: Subject | null;
    readonly unit: string | null;
    readonly key: string | null;
    readonly label: string;
    readonly count: number;
    readonly editable: boolean;
  } | null = null;
  /// L'oggetto che il pannello ha appena cambiato, con la chiave di prima.
  let carried: { readonly unit: string; readonly key: string | null } | null = null;
  /// Vero mentre il pannello cambia l'oggetto: la selezione lo segue dopo.
  let changing = false;

  /// Porta il pannello degli attributi, se è aperto, all'oggetto scelto.
  function syncInspector(): void {
    if (inspector.element.hidden || changing) return;
    const units = selectedUnits();
    const unit = units.length === 1 ? units[0]! : null;
    const model = engine.model;
    const subject = unit === null || model === null ? null : subjectOf(nodeOf(model, unit));
    if (carried !== null && carried.unit !== unit?.key) carried = null;
    const key = unit === null ? null : carried !== null ? carried.key : unit.key;
    const label = unit === null ? "" : labelOf(unit);
    const canEdit = editable();
    const last = inspectorShown;
    if (last !== null && last.subject === subject && last.unit === (unit?.key ?? null) && last.key === key && last.label === label && last.count === units.length && last.editable === canEdit) return;
    inspectorShown = { subject, unit: unit?.key ?? null, key, label, count: units.length, editable: canEdit };
    inspector.update({ subject, key, label, count: units.length, editable: canEdit });
  }

  /// Apre o chiude gli attributi; aperti, il fuoco ci va. Chiusi, un valore
  /// scritto a metà parte prima, come lasciando il campo.
  function showAttributes(open: boolean): void {
    if (open && !reaches(level, "expert")) return;
    if (!open && inspector.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    inspector.element.hidden = !open;
    attributesButton.setAttribute("aria-expanded", String(open));
    dock.hidden = tree.element.hidden && inspector.element.hidden;
    if (open) {
      inspectorShown = null;
      syncInspector();
      inspector.focus();
    }
  }

  /// Applica il cambio `ops` dell'oggetto che porterà l'id `id`, e lo tiene
  /// scelto: anche se l'id l'ha appena ricevuto, o cambiato. `null` se il
  /// disegno l'ha accettato, altrimenti la ragione per cui no.
  function changeObject(label: DrawKey, ops: readonly Op[], id: string): string | null {
    const before = inspectorShown?.key ?? null;
    cancelGesture();
    changing = true;
    let outcome: Applied | string | null;
    try {
      outcome = attempt(label, asGesture(ops));
    } finally {
      changing = false;
    }
    if (outcome === null) return t("draw.rejected", { reason: t("draw.reason.read_only") });
    if (typeof outcome === "string") return t("draw.rejected", { reason: outcome });
    carried = { unit: id, key: before };
    select([id]);
    return null;
  }

  /// Vero se una parte estranea del disegno cita `id`: cambiarlo romperebbe
  /// il riferimento. Le parti che FubDraw scrive non citano niente.
  const cited = (id: string): boolean => {
    const model = engine.model;
    if (model === null) return false;
    if (cites(model.root.head, id)) return true;
    const text = engine.text;
    return engine.scene().some((item) => item.kind === "foreign" && cites(text.slice(item.utf16[0], item.utf16[1]), id));
  };

  // --- Il livello corrente ---------------------------------------------------

  /// Il livello scelto, se c'è ancora: per chiave; o allo stesso posto, se ha
  /// perso l'id con annulla o se non l'aveva e l'ha ricevuto; o, se se n'è
  /// andato, quello che gli stava sotto, o il più basso.
  const chosenIn = (layers: readonly LayerInfo[]): LayerInfo | null => {
    if (chosen === null) return null;
    const { key, at } = chosen;
    const same = layers.find((layer) => keyOf(layer) === key)
      ?? layers.find((layer) => layer.path[0] === at && (layer.id === null || key.startsWith("@")));
    if (same !== undefined) return same;
    let below: LayerInfo | null = null;
    for (const layer of layers) if (layer.path[0]! < at) below = layer;
    return below ?? layers[0] ?? null;
  };

  /// Il livello in cui si disegna dal livello Standard: quello scelto; se
  /// nessuno l'ha scelto, il più alto che si vede e non è bloccato, o il più
  /// alto. `null` se il disegno non ha livelli.
  function currentLayer(): LayerInfo | null {
    const layers = currentIndex().layers;
    const found = chosenIn(layers);
    if (found !== null) return found;
    for (let i = layers.length - 1; i >= 0; i--) if (!layers[i]!.locked && !layers[i]!.hidden) return layers[i]!;
    return layers[layers.length - 1] ?? null;
  }

  /// `layer` diventa il livello corrente.
  const choose = (layer: LayerInfo): void => {
    chosen = { key: keyOf(layer), at: layer.path[0]! };
    syncLayers();
  };

  /// Dal livello Standard il livello corrente segue la selezione: diventa
  /// quello degli oggetti scelti, se stanno tutti in uno.
  function followSelection(): void {
    if (!reaches(level, "standard") || selection.length === 0) return;
    const units = selectedUnits();
    const at = units[0]?.path[0];
    if (at === undefined || units.some((unit) => unit.path.length < 2 || unit.path[0] !== at)) return;
    const layer = currentIndex().layers.find((other) => other.path[0] === at);
    if (layer !== undefined) choose(layer);
  }

  /// Il nome del pulsante dei livelli: dove si disegna e, a parole, lo stato
  /// di quel livello.
  function layersLabel(): string {
    const layer = currentLayer();
    if (layer === null) return t("draw.layers.none");
    const label = t("draw.layers.current", { name: layerTitle(layer) });
    const state = layerState(layer);
    return state === "" ? label : `${label}, ${state}`;
  }

  /// Il pulsante dei livelli c'è dal livello Standard, e mostra il nome del
  /// livello corrente e il suo stato; l'albero dice qual è.
  function syncLayers(): void {
    layerGroup.hidden = !reaches(level, "standard");
    layersButton.disabled = !editable();
    if (!layerGroup.hidden) {
      const layer = currentLayer();
      const name = layer === null ? t("draw.layers.none.short") : layerTitle(layer);
      const state = layer === null ? "" : layerState(layer);
      if (layerText.textContent !== name) layerText.textContent = name;
      if (layerStateText.textContent !== state) layerStateText.textContent = state;
      layerStateText.hidden = state === "";
      const label = layersLabel();
      if (layersButton.getAttribute("aria-label") !== label) {
        layersButton.setAttribute("aria-label", label);
        layersButton.title = label;
      }
    }
    syncTree();
  }

  // --- Stato dei controlli --------------------------------------------------

  /// Il `title` o la `desc` del disegno: i figli della radice con quel ruolo.
  const rootText = (role: "title" | "desc"): string => {
    const model = engine.model;
    if (model === null) return "";
    for (const child of elementChildren(model.root)) {
      if (child.kind === "leaf" && child.details?.role === role) return child.details.text ?? "";
    }
    return "";
  };
  const currentTitle = (): string => rootText("title");

  /// Il campione del colore a piacere: il colore, il nome, e se si vede.
  const showCustom = (): void => {
    customButton.hidden = custom === null || !reaches(level, "standard");
    if (custom === null) return;
    customChip.style.setProperty("--swatch", custom);
    const label = customLabel();
    customButton.setAttribute("aria-label", label);
    customButton.title = label;
  };

  /// La barra della selezione: c'è dal livello Standard, con qualcosa di
  /// scelto e il disegno che si scrive, e non mentre si scrive un testo. Un
  /// pulsante che non serve si spegne; se aveva il fuoco, il fuoco passa a
  /// quello che prende il Tab, o al foglio quando la barra se ne va.
  const syncArrange = (): void => {
    const focused = arrangeBar.contains(document.activeElement);
    const units = typing === null && reaches(level, "standard") && editable() && selection.length > 0 ? selectedUnits() : [];
    arrangeBar.hidden = units.length === 0;
    textButton.hidden = units.length !== 1 || units[0]!.look === null;
    groupButton.disabled = units.length < 2;
    ungroupButton.disabled = !units.some(isGroup);
    // Un collegamento non ne contiene un altro: attorno a uno che c'è non se
    // ne crea un secondo, ma quello scelto da solo si cambia.
    const single = units.length === 1 && isLink(units[0]!) ? units[0]! : null;
    shownLink = single === null ? null : { target: linkTarget(nodeOf(engine.model!, single)) };
    linkButton.hidden = options.links === undefined;
    linkButton.disabled = shownLink === null && units.length > 0 && holdsLinks(engine.model!, units);
    nameArrange(linkButton, linkText(), "Mod-k");
    openLinkButton.hidden = options.links === undefined || (shownLink?.target ?? null) === null;
    nameArrange(openLinkButton, openLinkText(), "Alt-Enter");
    unlinkButton.hidden = !units.some(isLink);
    // Con un livello solo, che ha già tutto, non c'è dove spostare.
    const layers = currentIndex().layers;
    intoButton.hidden = layers.length === 0 || (layers.length === 1 && units.every((unit) => inLayer(unit, layers[0]!)));
    arrangeFocus.sync(null);
    if (!focused) return;
    const active = document.activeElement;
    if (!arrangeBar.hidden && active instanceof HTMLButtonElement && arrangeBar.contains(active) && !active.disabled && !active.hidden) return;
    const next = arrangeBar.hidden ? null : arrangeFocus.current();
    if (next !== null) next.focus();
    else surface.focus({ preventScroll: true });
  };

  const syncControls = (): void => {
    const canEdit = editable();
    const now = style();
    root.toggleAttribute("data-readonly", !canEdit);
    surface.dataset.tool = tool;
    linkLayer.toggleAttribute("data-active", tool === "select" || !canEdit);
    for (const [id, control] of toolButtons) {
      control.hidden = !tools.some((spec) => spec.id === id);
      control.setAttribute("aria-checked", String(id === tool));
      control.disabled = !canEdit;
    }
    for (const [value, control] of colorButtons) {
      control.setAttribute("aria-checked", String(value === now.color));
      control.disabled = !canEdit;
    }
    showCustom();
    customButton.setAttribute("aria-checked", String(custom !== null && now.color === custom));
    customButton.disabled = !canEdit;
    // Il gruppo intero, non solo il pulsante: un gruppo vuoto nella barra
    // occuperebbe comunque il suo spazio.
    moreGroup.hidden = !reaches(level, "standard");
    moreButton.hidden = moreGroup.hidden;
    moreButton.disabled = !canEdit;
    const widths = widthsNow();
    const sizes = tool === "text";
    widthButtons.forEach(({ control, bar, glyph }, at) => {
      const value = widths[at]!.value;
      bar.hidden = sizes;
      glyph.hidden = !sizes;
      if (!sizes) bar.style.setProperty("--draw-width", `${value}px`);
      control.setAttribute("aria-checked", String(value === now.width));
      control.disabled = !canEdit;
    });
    showWidthLabels();
    undoButton.disabled = !canEdit || !history.canUndo;
    redoButton.disabled = !canEdit || !history.canRedo;
    deleteButton.disabled = !canEdit || selection.length === 0;
    propertiesButton.disabled = !canEdit;
    pageButton.hidden = !reaches(level, "standard");
    attributesButton.hidden = !reaches(level, "expert");
    if (attributesButton.hidden && !inspector.element.hidden) showAttributes(false);
    syncInspector();
    titleInput.disabled = !canEdit;
    if (document.activeElement !== titleInput) titleInput.value = currentTitle();
    syncLayers();
    toolbarFocus.sync(null);
    syncArrange();
  };

  /// Porta la superficie alla scena del motore.
  const refresh = (): void => {
    scene = builder.build(engine);
    painter.setDraft(null);
    painter.update(scene);
    showPage();
    index = null;
    marks = null;
    selection = inOrder(selection);
    // Il livello scelto si ritrova anche se ha cambiato posto o chiave.
    if (chosen !== null) {
      const layer = chosenIn(currentIndex().layers);
      chosen = layer === null ? null : { key: keyOf(layer), at: layer.path[0]! };
    }
    showTyping();
    syncControls();
    showHandles();
    syncTree();
    syncInspector();
  };

  // --- Operazioni -----------------------------------------------------------

  const emit = (applied: Applied, origin: DrawChange["origin"]): void => {
    if (applied.duplicate) return;
    options.onChange?.({ text: applied.text, operation: applied.operation, origin });
  };

  /// Applica il gesto `op` come `commit`, in silenzio: un rifiuto rende la
  /// sua ragione, a parole.
  const attempt = (label: DrawKey, op: Op | null): Applied | string | null => {
    if (op === null || !editable()) return null;
    const outcome = engine.apply(op);
    if (outcome.outcome === "rejected") {
      clearPreviews();
      return t(REASONS[outcome.reason]);
    }
    history.record(label, outcome);
    refresh();
    emit(outcome, "input");
    return outcome;
  };

  /// Applica il gesto `op` e lo mette nella cronologia col nome `label`.
  const commit = (label: DrawKey, op: Op | null): Applied | null => {
    const outcome = attempt(label, op);
    if (typeof outcome !== "string") return outcome;
    announce(t("draw.rejected", { reason: outcome }));
    return null;
  };

  const replay = (step: Replay | null, origin: "undo" | "redo"): void => {
    if (step === null) return;
    const action = t(step.step.label);
    if (step.outcome.outcome === "rejected") {
      syncControls();
      announce(t(origin === "undo" ? "draw.undo.failed" : "draw.redo.failed", { action }));
      return;
    }
    const applied = step.outcome;
    refresh();
    // La selezione segue ciò che il passo ha toccato e che c'è ancora, e
    // così il livello corrente.
    const touched = inOrder(applied.touched);
    if (touched.length > 0) selection = touched;
    const layer = reaches(level, "standard") ? currentIndex().layers.find((other) => other.id !== null && applied.touched.includes(other.id)) : undefined;
    if (layer !== undefined) choose(layer);
    else if (touched.length > 0) followSelection();
    syncControls();
    showHandles();
    emit(applied, origin);
    announce(t(origin === "undo" ? "draw.undone" : "draw.redone", { action }));
  };

  function undo(): void {
    if (!editable()) return;
    finishText();
    cancelGesture();
    replay(history.undo(engine), "undo");
  }

  function redo(): void {
    if (!editable()) return;
    finishText();
    cancelGesture();
    replay(history.redo(engine), "redo");
  }

  function deleteSelection(): void {
    const units = selectedUnits();
    if (units.length === 0 || !editable()) return;
    cancelGesture();
    if (commit("draw.action.delete", asGesture(removeOps(units))) === null) return;
    selection = [];
    syncControls();
    showHandles();
    announce(`${plural(units.length, "draw.deleted.one", "draw.deleted.other")} ${objects()}`);
  }

  /// Sposta gli oggetti scelti e ne tiene la selezione: un oggetto senza id
  /// lo riceve, e la sua chiave diventa quella.
  const moveSelection = (units: readonly Unit[], dx: number, dy: number): void => {
    if (units.length === 0 || (dx === 0 && dy === 0)) return;
    const moved = moveOps(units, dx, dy, newIds());
    let bounds: Bounds | null = null;
    for (const unit of units) bounds = union(bounds, translated(unit.bounds, dx, dy));
    const page = pageFor(scene.root.page, bounds);
    const ops: Op[] = [...moved.ops];
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.move", asGesture(ops)) === null) return;
    selection = inOrder(moved.keys);
    syncControls();
    showHandles();
    announce(plural(units.length, "draw.moved.one", "draw.moved.other"));
  };

  function select(keys: readonly string[]): void {
    selection = inOrder(keys);
    syncControls();
    showHandles();
  }

  /// Porta `bounds` in vista: resta dov'è se si vede già intero, va al
  /// centro se ci sta allo zoom di adesso, altrimenti si inquadra.
  const frameBounds = (bounds: Bounds | null): void => {
    const view = { w: surface.clientWidth, h: surface.clientHeight };
    if (bounds === null || view.w === 0 || view.h === 0) return;
    placed = true;
    const { scale, tx, ty } = camera;
    const left = tx + scale * bounds.min[0];
    const top = ty + scale * bounds.min[1];
    const right = tx + scale * bounds.max[0];
    const bottom = ty + scale * bounds.max[1];
    if (left >= 0 && top >= 0 && right <= view.w && bottom <= view.h) return;
    const usable = 1 - 2 * FIT_PAD;
    if (right - left <= view.w * usable && bottom - top <= view.h * usable) {
      const cx = (bounds.min[0] + bounds.max[0]) / 2;
      const cy = (bounds.min[1] + bounds.max[1]) / 2;
      setCamera({ scale, tx: view.w / 2 - scale * cx, ty: view.h / 2 - scale * cy });
      return;
    }
    const world = { minX: bounds.min[0], minY: bounds.min[1], maxX: bounds.max[0], maxY: bounds.max[1] };
    setCamera(fitBounds(world, view, FIT_PAD, 0, DRAW_SCALE_LIMITS));
  };

  function reveal(offset: number): boolean {
    if (engine.model === null) return false;
    const index = currentIndex();
    // L'oggetto è il più esterno fra quelli che contengono il byte e che si
    // scelgono interi: un livello non lo è, un figlio di un gruppo nemmeno.
    // La scena è in ordine di documento: chi contiene viene prima.
    let found: Unit | null = null;
    for (const item of engine.scene()) {
      if (item.kind !== "element" || offset < item.bytes[0] || offset >= item.bytes[1]) continue;
      found = index.get(item.id ?? `@${item.path.join(".")}`) ?? null;
      if (found !== null) break;
    }
    if (found === null) return false;
    finishText();
    cancelGesture();
    select([found.key]);
    frameBounds(found.bounds);
    announceSelection();
    return true;
  }

  function adopt(): boolean {
    if (locked || engine.status !== "foreign" || engine.model === null) return false;
    cancelGesture();
    const outcome = engine.apply({ op: "adopt" });
    if (outcome.outcome === "rejected") {
      announce(t("draw.rejected", { reason: t(REASONS[outcome.reason]) }));
      return false;
    }
    history.record("draw.action.adopt", outcome);
    refresh();
    emit(outcome, "input");
    announce(t("draw.adopted"));
    return true;
  }

  function setReadOnly(readOnly: boolean): void {
    if (readOnly === locked) return;
    // Un documento che non si scrive più non riceve il testo in corso.
    if (readOnly) finishText(false);
    locked = readOnly;
    if (locked) cancelGesture();
    syncControls();
  }

  // --- Strumenti --------------------------------------------------------------

  function setLevel(next: Level): void {
    if (next === level) return;
    finishText();
    level = next;
    tools = toolsFor(level);
    if (!tools.some((spec) => spec.id === tool)) {
      cancelGesture();
      tool = DEFAULT_TOOL;
    }
    // Sotto lo Standard la barra non ha un campione per un colore a piacere:
    // chi lo usava riparte dai colori di partenza, che la barra mostra.
    if (!reaches(level, "standard")) {
      if (swatchOf(styles.pen.color) === null) styles.pen.color = DEFAULT_COLOR;
      if (swatchOf(styles.highlighter.color) === null) styles.highlighter.color = HIGHLIGHTER_COLOR;
    }
    showSurfaceHint();
    showGrid();
    syncControls();
  }

  function setTool(id: ToolId): void {
    if (!tools.some((spec) => spec.id === id)) return;
    if (id !== tool) {
      finishText();
      cancelGesture();
    }
    tool = id;
    syncControls();
    announce(t("draw.announce.tool", { tool: t(toolSpec(id).label) }));
  }

  function setColor(value: string): void {
    const code = customColor(value);
    if (code === null) return;
    if (swatchOf(code) === null) {
      if (!reaches(level, "standard")) return;
      custom = code;
    }
    style().color = code;
    syncControls();
    // Un testo nuovo cambia colore mentre lo si scrive.
    placeText();
  }

  function setWidth(value: number): void {
    if (!widthsNow().some((option) => option.value === value)) return;
    style().width = value;
    syncControls();
    placeText();
  }

  /// «Altro colore…»: il codice, o il selettore del sistema. Un colore della
  /// tavolozza sceglie il suo campione.
  async function chooseColor(): Promise<void> {
    if (asking || !editable() || !reaches(level, "standard")) return;
    asking = true;
    cancelGesture();
    try {
      const answer = await promptForm({
        title: t("draw.color.dialog"),
        fields: [{ id: "color", label: t("draw.color.code"), value: style().color, kind: "color" }],
      });
      if (answer === null || disposed) return;
      const code = customColor(answer.color ?? "");
      if (code === null) return;
      setColor(code);
      const swatch = swatchOf(code);
      announce(t("draw.announce.color", { color: swatch === null ? customLabel() : t(swatch.label) }));
    } finally {
      asking = false;
    }
  }

  function cancelGesture(): void {
    if (pressed !== null) cancelPress();
    else if (current !== null) pen.cancel();
  }

  // --- La pipeline della penna ------------------------------------------------

  /// Il livello che riceve: dal livello Standard quello corrente; sotto, il
  /// più alto che si vede e non è bloccato. Se non c'è o non riceve, lo si
  /// dice, e il gesto non scrive.
  const target = (ids: NewIds): Destination | null => {
    const layer = reaches(level, "standard") ? currentLayer() : null;
    if (layer === null) {
      const to = destination(currentIndex(), ids);
      if (to === null) announce(t("draw.no_layer"));
      return to;
    }
    const name = layerTitle(layer);
    const refusal = layerRefusal(layer);
    if (refusal !== null) {
      announce(t(refusal, { name }));
      return null;
    }
    const to = destinationIn(layer, ids);
    if (to === null) announce(t("draw.layer.flat", { name }));
    return to;
  };

  /// La griglia aggancia: dal livello Standard, con l'aggancio acceso. `at`
  /// è il livello da guardare, di solito quello di adesso.
  const gridOn = (at: Level = level): boolean => reaches(at, "standard") && grid.snap;

  /// Un punto di un gesto: sull'incrocio più vicino quando la griglia
  /// aggancia e Ctrl o ⌘ non è tenuto.
  const snapped = (p: Point): Point => (gridOn() && !free ? snapPoint(p, grid.step) : p);

  const begin = (start: StrokeStart): Gesture => {
    const base = { stroke: start.id, pointer: start.pointerType };
    if (!editable()) return { ...base, kind: "refused" };
    switch (tool) {
      case "pen":
      case "highlighter": {
        const ids = newIds();
        const to = target(ids);
        if (to === null) return { ...base, kind: "refused" };
        const { color, width } = style();
        // L'evidenziatore ha lo spessore costante e le punte piatte, come un
        // pennarello a scalpello: la pressione non lo cambia.
        let brush = tool === "highlighter"
          ? { ...PF1_DEFAULTS, size: width, thinning: 0, capStart: false, capEnd: false, sim: false }
          : brushForInput({ ...PF1_DEFAULTS, size: width, sim: false }, start.pressure);
        // Il seguito di un tratto chiuso al limite non si assottiglia alla
        // giunzione.
        if (start.continued) brush = { ...brush, taperStart: 0 };
        return { ...base, kind: "ink", tool, color, brush, to, ids, scene: [], local: [], predicted: [] };
      }
      case "rect":
      case "ellipse":
      case "line":
      case "arrow": {
        const ids = newIds();
        const to = target(ids);
        if (to === null) return { ...base, kind: "refused" };
        const { color, width } = style();
        return { ...base, kind: "shape", tool, color, width, to, ids, from: null, end: null };
      }
      case "eraser":
        return { ...base, kind: "erase", last: null, marked: new Map() };
      case "select":
        return { ...base, kind: "select", from: null, end: null, mode: "pending", units: [], base: [], release: null, source: null, hit: null };
      case "text":
        // Il tocco che ha concluso un testo non ne apre un altro.
        return closedTyping ? { ...base, kind: "refused" } : { ...base, kind: "text", from: null };
    }
  };

  const drawInk = (g: InkGesture): void => {
    const samples = g.local.length + g.predicted.length <= INK_MAX_SAMPLES ? [...g.local, ...g.predicted] : g.local;
    let outline: ReturnType<typeof pf1Outline> = [];
    if (samples.length > 0) {
      try {
        outline = pf1Outline(quantizeInk(samples), g.brush, { last: false });
      } catch {
        outline = [];
      }
    }
    const opacity = g.tool === "highlighter" ? Number(HIGHLIGHTER_OPACITY) : 1;
    overlay.setInk(INK_KEY, outline.length === 0 ? null : { outline, matrix: g.to.matrix, color: g.color, opacity });
    overlay.flush();
  };

  /// Gli estremi di una forma nelle coordinate del suo livello, con Maiusc
  /// applicato lì: un quadrato resta un quadrato nel livello.
  const shapeEnds = (g: ShapeGesture, to: Destination): [Point, Point] | null => {
    if (g.from === null || g.end === null) return null;
    const from = apply(to.inverse, g.from);
    const end = apply(to.inverse, snapped(g.end));
    return [from, shift ? constrainEnd(g.tool, from, end) : end];
  };

  const minimumFor = (to: Destination): number => {
    const scale = camera.scale * scaleOf(to.matrix);
    return scale > 0 ? MIN_SHAPE_PX / scale : 0;
  };

  const drawShape = (g: ShapeGesture): void => {
    const ends = shapeEnds(g, g.to);
    const elem = ends === null ? null : shapeElem(g.tool, "preview", ends[0], ends[1], { color: g.color, width: g.width }, minimumFor(g.to));
    showShape(elem, g.to.matrix);
  };

  const moveDelta = (g: SelectGesture): [number, number] => {
    if (g.from === null || g.end === null) return [0, 0];
    const dx = g.end[0] - g.from[0];
    const dy = g.end[1] - g.from[1];
    if (gridOn() && !free && g.source !== null) return snapDelta(g.source, dx, dy, grid.step);
    return [roundDelta(dx), roundDelta(dy)];
  };

  /// Il primo punto di un gesto di selezione: un oggetto sotto il puntatore
  /// si sceglie e si potrà trascinare; il vuoto comincia un riquadro.
  const selectStart = (g: SelectGesture, p: Point): void => {
    g.from = p;
    g.end = p;
    const hit = currentIndex().at(p, HIT_PX[g.pointer] / camera.scale);
    g.hit = hit?.key ?? null;
    if (hit === null) {
      g.mode = "marquee";
      g.base = shift ? selection : [];
      if (!shift) select([]);
      return;
    }
    const chosen = selection.includes(hit.key);
    if (shift) {
      if (chosen) g.release = hit.key;
      else select([...selection, hit.key]);
    } else if (!chosen) {
      select([hit.key]);
    }
    g.units = selectedUnits();
    const geometry = geometryOf(g.units);
    g.source = geometry === null ? null : nearestCorner(geometry, p);
  };

  const selectUpdate = (g: SelectGesture): void => {
    if (g.from === null || g.end === null) return;
    if (g.mode === "pending") {
      const distance = Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * camera.scale;
      if (distance <= DRAG_PX[g.pointer]) return;
      g.mode = "move";
      g.release = null;
    }
    if (g.mode === "move") {
      const [dx, dy] = moveDelta(g);
      const transforms = new Map<PaintNode, string | null>();
      for (const unit of g.units) {
        const moved = movedMatrix(unit, dx, dy);
        if (moved === null) continue;
        const value = transformValue(moved);
        for (const paint of unit.paints) transforms.set(paint, value);
      }
      painter.setDraft({ transforms });
    } else {
      const [x1, y1] = g.from;
      const [x2, y2] = g.end;
      const area: Bounds = { min: [Math.min(x1, x2), Math.min(y1, y2)], max: [Math.max(x1, x2), Math.max(y1, y2)] };
      selection = inOrder([...g.base, ...currentIndex().within(area).map((unit) => unit.key)]);
      syncControls();
    }
    showHandles();
  };

  const selectEnd = (g: SelectGesture, time: number): void => {
    if (g.mode === "move") {
      lastTap = null;
      const [dx, dy] = moveDelta(g);
      painter.setDraft(null);
      current = null;
      moveSelection(g.units, dx, dy);
      showHandles();
      return;
    }
    current = null;
    if (g.mode === "pending" && g.release !== null) select(selection.filter((key) => key !== g.release));
    // Due tocchi sullo stesso testo lo aprono.
    const tap = g.mode === "pending" && g.release === null && !shift && g.hit !== null && g.from !== null ? { key: g.hit, time, at: g.from } : null;
    const previous = lastTap;
    lastTap = tap;
    if (tap !== null && previous !== null && previous.key === tap.key && tap.time - previous.time <= DOUBLE_TAP_MS) {
      const apart = Math.hypot(tap.at[0] - previous.at[0], tap.at[1] - previous.at[1]) * camera.scale;
      const unit = apart <= DOUBLE_TAP_PX[g.pointer] ? currentIndex().get(tap.key) : null;
      if (unit !== null && unit.look !== null && reaches(level, "standard") && editable()) {
        lastTap = null;
        editText(unit);
        return;
      }
    }
    showHandles();
    announceSelection();
  };

  const eraseAlong = (g: EraseGesture, p: Point): void => {
    const from = g.last ?? p;
    g.last = p;
    for (const unit of currentIndex().along(from, p, ERASER_PX[g.pointer] / camera.scale)) g.marked.set(unit.key, unit);
  };

  const showErased = (g: EraseGesture): void => {
    const faded = new Set<PaintNode>();
    for (const unit of g.marked.values()) for (const paint of unit.paints) faded.add(paint);
    painter.setDraft(faded.size === 0 ? null : { faded });
  };

  const finishInk = (g: InkGesture, stroke: FinishedStroke): void => {
    // Il livello di adesso: mentre il gesto durava, il disegno può essere
    // cambiato.
    const to = target(g.ids);
    if (to === null) return;
    const local = sameDestination(to, g.to) ? g.local : g.scene.map((sample) => toLocal(sample, to.inverse));
    let brush = g.brush;
    if (stroke.split) brush = { ...brush, taperEnd: 0 };
    let ink;
    let outline;
    try {
      ink = quantizeInk(local);
      outline = pf1Outline(ink, brush);
    } catch {
      announce(t("draw.ink_failed"));
      return;
    }
    if (outline.length === 0) return;
    const bounds = new BoundsBuilder();
    for (const point of outline) bounds.include(apply(to.matrix, point));
    const id = g.ids.next("object");
    const at = new Date(performance.timeOrigin + stroke.timeStamp).toISOString();
    const ops: Op[] = [...to.prelude, addOp(to, strokeElem(id, g.color, brush, ink, at, g.tool))];
    const page = pageFor(scene.root.page, bounds.finish());
    if (page !== null) ops.push({ op: "page", viewBox: page });
    const marker = g.tool === "highlighter";
    if (commit(marker ? "draw.action.highlight" : "draw.action.stroke", asGesture(ops)) !== null) {
      announce(`${t(marker ? "draw.added.highlight" : "draw.added.stroke")} ${objects()}`);
    }
  };

  const finishShape = (g: ShapeGesture): void => {
    // Il livello di adesso: mentre il gesto durava, il disegno può essere
    // cambiato.
    const to = target(g.ids);
    if (to === null) return;
    const ends = shapeEnds(g, to);
    if (ends === null) return;
    const elem = shapeElem(g.tool, g.ids.next("object"), ends[0], ends[1], { color: g.color, width: g.width }, minimumFor(to));
    if (elem === null) return;
    const ops: Op[] = [...to.prelude, addOp(to, elem)];
    const page = pageFor(scene.root.page, elemBounds(elem, to.matrix));
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit(toolSpec(g.tool).label, asGesture(ops)) !== null) announce(`${t(ADDED[g.tool])} ${objects()}`);
  };

  const finishErase = (g: EraseGesture): void => {
    const units = [...g.marked.values()];
    if (units.length === 0) {
      painter.setDraft(null);
      return;
    }
    if (commit("draw.action.erase", asGesture(removeOps(units))) !== null) {
      announce(`${plural(units.length, "draw.erased.one", "draw.erased.other")} ${objects()}`);
    }
  };

  const toPoint = (sample: InkSample): Point => [sample.x, sample.y];

  // Maiusc, e Ctrl o ⌘, si leggono dall'evento del puntatore prima della
  // pipeline, che ascolta in cattura sullo stesso elemento: registrato prima
  // di lei, questo ascolto la precede, e il gesto vede lo stato dell'evento
  // in corso.
  const readModifiers = (event: PointerEvent): void => {
    shift = event.shiftKey;
    free = event.ctrlKey || event.metaKey;
  };
  /// Il puntatore porta con sé il cursore del foglio, che si nasconde: la
  /// tastiera ripartirà da lì.
  const followPointer = (event: PointerEvent): void => {
    if (pressed !== null) return;
    const point = screenToWorld(camera, localPoint(event.clientX, event.clientY));
    cursor = [point.x, point.y];
    cursorMark.hidden = true;
  };
  life.listen(
    surface,
    "pointerdown",
    (event) => {
      readModifiers(event);
      // Il puntatore prende il posto della tastiera: il suo gesto finisce.
      cancelPress();
      followPointer(event);
      // Il puntatore sul foglio conclude il testo che si scrive.
      closedTyping = typing !== null;
      finishText();
      // Dopo un tratto le scorciatoie valgono: il fuoco va al foglio.
      if (document.activeElement !== surface) surface.focus({ preventScroll: true });
    },
    { capture: true },
  );
  life.listen(
    surface,
    "pointermove",
    (event) => {
      readModifiers(event);
      followPointer(event);
    },
    { capture: true },
  );

  // I gestori della pipeline, che riceve anche il cursore del foglio.
  const handlers: PenInputOptions = {
    toScene: (clientX, clientY) => screenToWorld(camera, localPoint(clientX, clientY)),
    onStart(start) {
      // Un gesto lungo che la pipeline divide al limite dei campioni
      // continua nel tratto nuovo; il tratto a penna si scrive a pezzi.
      if (start.continued && current !== null && current.kind !== "ink" && current.kind !== "refused") {
        current.stroke = start.id;
        return;
      }
      current = begin(start);
    },
    onSamples(id, samples) {
      const g = current;
      if (g === null || g.stroke !== id || samples.length === 0) return;
      switch (g.kind) {
        case "ink":
          for (const sample of samples) {
            g.scene.push(sample);
            g.local.push(toLocal(sample, g.to.inverse));
          }
          drawInk(g);
          break;
        case "shape":
          // Il primo punto si aggancia subito, l'ultimo a ogni disegno:
          // Ctrl o ⌘ può cambiare a metà gesto.
          g.from ??= snapped(toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          drawShape(g);
          break;
        case "select":
          if (g.from === null) selectStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          selectUpdate(g);
          break;
        case "erase":
          for (const sample of samples) eraseAlong(g, toPoint(sample));
          showErased(g);
          break;
        case "text":
          g.from ??= toPoint(samples[0]!);
          break;
        case "refused":
          break;
      }
    },
    onPredicted(id, samples) {
      const g = current;
      if (g === null || g.stroke !== id || g.kind !== "ink") return;
      g.predicted = samples.map((sample) => toLocal(sample, g.to.inverse));
      drawInk(g);
    },
    onEnd(stroke) {
      const g = current;
      if (g === null || g.stroke !== stroke.id) return;
      if (stroke.split && g.kind !== "ink") return;
      switch (g.kind) {
        case "ink":
          current = null;
          // Prima il tratto nella scena, poi via quello in corso: nello
          // stesso gestore, quindi a schermo non c'è un fotogramma senza
          // nessuno dei due.
          finishInk(g, stroke);
          overlay.setInk(INK_KEY, null);
          overlay.flush();
          return;
        case "shape":
          current = null;
          finishShape(g);
          showShape(null, g.to.matrix);
          return;
        case "select":
          selectEnd(g, stroke.timeStamp);
          return;
        case "erase":
          current = null;
          finishErase(g);
          return;
        case "text":
          current = null;
          if (g.from !== null) openText(g.from, g.pointer);
          return;
        case "refused":
          current = null;
          return;
      }
    },
    onCancel(id) {
      const g = current;
      if (g === null || g.stroke !== id) return;
      current = null;
      if (g.kind === "select" && g.mode === "marquee") select(g.base);
      clearPreviews();
    },
    ...(options.touch === undefined ? {} : { touch: options.touch }),
  };
  const pen = attachPenInput(surface, handlers, life);

  // --- Il testo ------------------------------------------------------------------
  //
  // Il campo prende il posto del testo che si scrive: il testo che c'è si
  // nasconde, e il campo ha il suo carattere, il suo corpo, il suo colore e
  // la sua trasformazione, così le righe stanno dove resteranno. Si scrive
  // quando il campo si chiude, in un passo di annulla solo.

  /// Come si vede il testo che si scrive: quello che c'è, o uno nuovo col
  /// colore e la dimensione dello strumento.
  const lookOf = (now: Typing): TextLook =>
    now.look ?? {
      x: now.at[0],
      y: now.at[1],
      size: textStyle.width,
      leading: textStyle.width * LINE_SPACING,
      anchor: "start",
      family: TEXT_FAMILY,
      weight: null,
      color: textStyle.color,
    };

  /// Il contesto con cui il browser misura un carattere; `null` dove non sa.
  let probe: CanvasRenderingContext2D | null | undefined;
  /// La linea di base sotto la metà della riga, in volte il corpo, per un
  /// carattere scritto come `font-style`, `font-weight` e `font-family`.
  const baselineOf = (style: string, weight: string, family: string): number => {
    probe ??= document.createElement("canvas").getContext("2d");
    if (probe === null) return BASELINE_EM;
    probe.font = `${style} ${weight} 100px ${family}`;
    const metrics = probe.measureText("");
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    if (!Number.isFinite(ascent) || !Number.isFinite(descent) || ascent + descent <= 0) return BASELINE_EM;
    return (ascent - descent) / 200;
  };

  /// Porta il campo sopra il testo che si scrive, sullo schermo: la prima
  /// linea di base dove il file la mette, il punto d'ancoraggio al suo
  /// posto, e la larghezza delle righe, più il cursore.
  function placeText(): void {
    const now = typing;
    if (now === null) return;
    const look = lookOf(now);
    // Dalle coordinate del testo a quelle dello strato, che copre il foglio.
    const view: Matrix = [camera.scale, 0, 0, camera.scale, camera.tx + surface.offsetLeft + surface.clientLeft, camera.ty + surface.offsetTop + surface.clientTop];
    const m = compose(view, now.matrix);
    const k = scaleOf(m);
    const style = textInput.style;
    // Un testo schiacciato su una linea non ha un campo da mostrare.
    style.visibility = k > 0 && Number.isFinite(k) ? "" : "hidden";
    if (style.visibility === "hidden") return;
    const size = look.size * k;
    const leading = look.leading * k;
    style.fontFamily = look.family ?? "";
    style.fontWeight = look.weight ?? "";
    style.fontSize = `${size}px`;
    style.lineHeight = `${leading}px`;
    // Un colore che il campo non sa mostrare, come un gradiente, lascia il
    // nero, il colore di un testo che non ne scrive uno.
    style.color = "#000000";
    if (look.color !== null) style.color = look.color;
    style.textAlign = look.anchor === "middle" ? "center" : look.anchor === "end" ? "right" : "left";
    const rows = textInput.value.split("\n");
    style.height = `${rows.length * leading}px`;
    style.width = "0px";
    const longest = Math.max(...rows.map((row) => [...row].length));
    const width = Math.ceil(textInput.scrollWidth || longest * CHAR_EM * size) + CARET_PX;
    style.width = `${width}px`;
    const computed = getComputedStyle(textInput);
    const baseline = baselineOf(computed.fontStyle, computed.fontWeight, computed.fontFamily);
    const left = look.x * k - (look.anchor === "middle" ? width / 2 : look.anchor === "end" ? width : 0);
    const top = look.y * k - leading / 2 - baseline * size;
    style.transform = `matrix(${m[0] / k}, ${m[1] / k}, ${m[2] / k}, ${m[3] / k}, ${m[4]}, ${m[5]}) translate(${left}px, ${top}px)`;
    textInput.scrollLeft = 0;
    textInput.scrollTop = 0;
  }

  /// Il testo che si cambia resta nascosto sotto il campo anche quando il
  /// painter ridisegna, e il campo lo segue.
  function showTyping(): void {
    if (typing === null) return;
    const unit = typing.key === null ? null : currentIndex().get(typing.key);
    if (unit !== null) painter.setDraft({ hidden: new Set(unit.paints) });
    placeText();
  }

  /// Apre il campo con `text`, e il fuoco ci va. Il testo di prima si
  /// conclude.
  const startTyping = (next: Typing, text: string): void => {
    finishText();
    cancelGesture();
    typing = next;
    textInput.value = text;
    labelText();
    textLayer.hidden = false;
    cursorMark.hidden = true;
    select([]);
    showTyping();
    textInput.focus({ preventScroll: true });
    textInput.setSelectionRange(text.length, text.length);
  };

  /// Apre il campo su `unit`, un testo che c'è.
  const editText = (unit: Unit): void => {
    const look = unit.look;
    const model = engine.model;
    if (look === null || model === null || !editable() || !reaches(level, "standard")) return;
    const text = editableText(nodeOf(model, unit).details?.lines ?? []);
    startTyping({ key: unit.key, before: text, look, at: [look.x, look.y], matrix: unit.matrix }, text);
  };

  /// F2, o «Modifica il testo»: il testo scelto, se è solo.
  function editSelectedText(): void {
    if (!editable() || !reaches(level, "standard")) return;
    const units = selectedUnits();
    if (units.length !== 1 || units[0]!.look === null) {
      announce(t("draw.text.none"));
      return;
    }
    editText(units[0]!);
  }

  /// Lo strumento Testo in `p`: cambia il testo che c'è sotto, o ne comincia
  /// uno nuovo con la prima riga a metà su `p`, come il cursore di testo.
  /// Con l'aggancio la linea di base va sulla griglia.
  const openText = (p: Point, pointer: InkPointerType): void => {
    if (!editable() || !reaches(level, "standard")) return;
    const hit = currentIndex().at(p, HIT_PX[pointer] / camera.scale);
    if (hit !== null && hit.look !== null) {
      editText(hit);
      return;
    }
    const to = target(newIds());
    if (to === null) return;
    const local = apply(to.inverse, p);
    const below = baselineOf("normal", "400", TEXT_FAMILY) * textStyle.width;
    const base = snapped(apply(to.matrix, [local[0], local[1] + below]));
    startTyping({ key: null, before: "", look: null, at: apply(to.inverse, base), matrix: to.matrix }, "");
  };

  /// Chiude il campo; con `write` scrive ciò che è cambiato, in un passo di
  /// annulla. Un testo nuovo entra nel livello che riceve, uno che c'è
  /// cambia le sue righe, e uno svuotato se ne va.
  function finishText(write = true): void {
    const now = typing;
    if (now === null) return;
    typing = null;
    const value = textInput.value;
    // Il fuoco torna al foglio prima che il campo sparisca: altrimenti
    // andrebbe alla pagina, e i tasti del disegno non varrebbero più.
    if (document.activeElement === textInput) surface.focus({ preventScroll: true });
    textLayer.hidden = true;
    textInput.value = "";
    painter.setDraft(null);
    const unit = now.key === null ? null : currentIndex().get(now.key);
    const lines = textLines(value);
    if (!write || value === now.before || !editable() || (now.key === null && lines.length === 0)) {
      if (unit !== null) select([unit.key]);
      else syncControls();
      return;
    }
    if (now.key === null) {
      const ids = newIds();
      const to = target(ids);
      if (to === null) {
        syncControls();
        return;
      }
      const id = ids.next("object");
      const elem = textElem(id, apply(to.inverse, apply(now.matrix, now.at)), lines, { color: textStyle.color, size: textStyle.width });
      const ops: Op[] = [...to.prelude, addOp(to, elem)];
      const page = pageFor(scene.root.page, elemBounds(elem, to.matrix));
      if (page !== null) ops.push({ op: "page", viewBox: page });
      if (commit("draw.action.text", asGesture(ops)) === null) return;
      select([id]);
      announce(`${t("draw.added.text")} ${objects()}`);
      return;
    }
    const model = engine.model;
    if (unit === null || model === null) {
      announce(t("draw.rejected", { reason: t("draw.reason.missing_target") }));
      syncControls();
      return;
    }
    if (lines.length === 0) {
      if (commit("draw.action.delete", asGesture(removeOps([unit]))) === null) return;
      select([]);
      announce(`${plural(1, "draw.deleted.one", "draw.deleted.other")} ${objects()}`);
      return;
    }
    const node = nodeOf(model, unit);
    const old = node.details?.lines ?? [];
    if (old.length === lines.length && old.every((line, i) => line === lines[i])) {
      select([unit.key]);
      return;
    }
    const plan = new Plan(model, newIds());
    const id = plan.idOf(node);
    plan.ops.push({ op: "text", id, lines });
    const ops: Op[] = [...plan.finish([id]).ops];
    const page = pageFor(scene.root.page, linesBounds(unit.look ?? now.look!, lines, unit.matrix));
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.text_edit", asGesture(ops)) === null) return;
    select([id]);
    announce(t("draw.text.edited"));
  }

  life.listen(textInput, "input", () => placeText());
  life.listen(textInput, "keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape" || event.key === "Tab" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      finishText();
    }
  });
  // Il fuoco che va altrove conclude il testo. Una finestra dell'editor, come
  // «Altro colore…», lo ridà al campo quando si chiude, e così la finestra
  // del browser quando ci si torna.
  life.listen(textInput, "blur", () => {
    if (asking || !document.hasFocus()) return;
    finishText();
  });
  // Lo strato non scorre: il campo resta sopra il suo testo.
  life.listen(textLayer, "scroll", () => {
    textLayer.scrollTop = 0;
    textLayer.scrollLeft = 0;
  });
  // Un carattere che arriva dopo cambia le misure del campo.
  if (typeof document.fonts?.addEventListener === "function") life.listen(document.fonts, "loadingdone", () => placeText());
  // Il tocco che apre un testo col dito manda dopo, per compatibilità, un
  // `mousedown` che porterebbe il fuoco al foglio.
  life.listen(surface, "mousedown", (event) => {
    if (typing !== null) event.preventDefault();
  });
  // Un pulsante della barra non toglie il fuoco al campo: il colore e la
  // dimensione scelti mentre si scrive valgono per il testo nuovo, e i
  // pulsanti che cambiano altro lo concludono da sé.
  life.listen(toolbar, "mousedown", (event) => {
    if (typing !== null && (event.target as Element | null)?.closest("button")) event.preventDefault();
  });

  // --- Il cursore del foglio ----------------------------------------------------
  //
  // La tastiera disegna con gli stessi gesti del puntatore: Spazio preme e,
  // di nuovo, rilascia, e in mezzo le frecce portano il cursore. I campioni
  // vanno ai gestori della pipeline come quelli di un mouse, così ogni
  // strumento funziona da tastiera senza un secondo codice.

  /// Il cursore dov'è, o al centro di ciò che si vede.
  const cursorPoint = (): Point => {
    if (cursor === null) {
      const center = screenToWorld(camera, { x: surface.clientWidth / 2, y: surface.clientHeight / 2 });
      cursor = [center.x, center.y];
    }
    return cursor;
  };

  /// La vista segue il cursore quando arriva al bordo.
  const keepInView = (p: Point): void => {
    const w = surface.clientWidth;
    const h = surface.clientHeight;
    if (w === 0 || h === 0) return;
    const margin = Math.min(CURSOR_MARGIN_PX, w / 4, h / 4);
    const x = camera.tx + camera.scale * p[0];
    const y = camera.ty + camera.scale * p[1];
    const dx = x < margin ? margin - x : x > w - margin ? w - margin - x : 0;
    const dy = y < margin ? margin - y : y > h - margin ? h - margin - y : 0;
    if (dx === 0 && dy === 0) return;
    placed = true;
    setCamera({ ...camera, tx: camera.tx + dx, ty: camera.ty + dy });
  };

  /// Dove è il cursore, e che cosa c'è sotto.
  const announceCursor = (): void => {
    const p = cursorPoint();
    const at = t("draw.cursor.at", { x: numberText(p[0]), y: numberText(p[1]) });
    const hit = pressed === null ? currentIndex().at(p, HIT_PX.mouse / camera.scale) : null;
    announce(hit === null ? at : `${at}: ${labelOf(hit)}`);
  };

  /// Il gesto da tastiera arriva a `p`, con un campione ogni
  /// [`CURSOR_SAMPLE_PX`] pixel. Al limite dei campioni si rilascia.
  const trace = (p: Point): void => {
    const g = pressed;
    if (g === null) return;
    const [x0, y0] = g.at;
    const steps = Math.max(1, Math.ceil((Math.hypot(p[0] - x0, p[1] - y0) * camera.scale) / CURSOR_SAMPLE_PX));
    const samples: InkSample[] = [];
    for (let i = 1; i <= steps && g.samples.length + samples.length < INK_MAX_SAMPLES; i++) {
      g.time += CURSOR_SAMPLE_MS;
      samples.push({ x: x0 + ((p[0] - x0) * i) / steps, y: y0 + ((p[1] - y0) * i) / steps, t: g.time });
    }
    g.at = p;
    g.samples.push(...samples);
    if (samples.length > 0) handlers.onSamples(g.start.id, samples);
    if (g.samples.length >= INK_MAX_SAMPLES) release();
  };

  /// Porta il cursore in `next`, un punto della scena.
  const placeCursor = (next: Point): void => {
    cursor = next;
    cursorMark.hidden = false;
    keepInView(next);
    showCursor();
    trace(next);
    announceCursor();
  };

  /// Muove il cursore di (`dx`, `dy`) pixel dello schermo.
  const moveCursor = (dx: number, dy: number): void => {
    const [x, y] = cursorPoint();
    placeCursor([x + dx / camera.scale, y + dy / camera.scale]);
  };

  /// Con l'aggancio, una freccia porta il cursore all'incrocio `lines` righe
  /// più in là nel suo verso, e sulla riga più vicina sull'altro asse.
  const moveCursorOnGrid = (x: number, y: number, lines: number): void => {
    const [cx, cy] = cursorPoint();
    placeCursor([
      x === 0 ? snapValue(cx, grid.step) : lineBeyond(cx, grid.step, sign(x), lines),
      y === 0 ? snapValue(cy, grid.step) : lineBeyond(cy, grid.step, sign(y), lines),
    ]);
  };

  /// Spazio: il gesto comincia dove è il cursore.
  const press = (timeStamp: number): void => {
    if (pressed !== null || !editable()) return;
    cancelGesture();
    closedTyping = false;
    const at = cursorPoint();
    const start: StrokeStart = { id: --keyStrokes, pointerType: "mouse", pressure: false, timeStamp, continued: false };
    const first: InkSample = { x: at[0], y: at[1], t: 0 };
    pressed = { start, samples: [first], at, time: 0 };
    cursorMark.hidden = false;
    showCursor();
    handlers.onStart(start);
    handlers.onSamples(start.id, [first]);
    announce(t("draw.cursor.down"));
  };

  /// Spazio di nuovo, o Invio: il gesto finisce e scrive. Se non dice niente
  /// lui, si dice che il cursore è su.
  function release(): void {
    const g = pressed;
    if (g === null) return;
    pressed = null;
    showCursor();
    const before = live.textContent;
    handlers.onEnd({ ...g.start, samples: g.samples, tilt: false, split: false });
    if (live.textContent === before) announce(t("draw.cursor.up"));
  }

  /// Il gesto da tastiera non scrive niente.
  function cancelPress(): void {
    const g = pressed;
    if (g === null) return;
    pressed = null;
    showCursor();
    handlers.onCancel(g.start.id, "api");
  }

  // Il fuoco che lascia il foglio porta via il gesto e il cursore.
  life.listen(surface, "blur", () => {
    cancelPress();
    cursorMark.hidden = true;
  });

  // --- Navigazione: tasto centrale, dita, rotella ------------------------------

  const navigating = new Map<number, { x: number; y: number }>();
  let pinch: { key: string; center: { x: number; y: number }; distance: number } | null = null;

  const measure = (): typeof pinch => {
    if (navigating.size === 0) return null;
    const points = [...navigating.values()];
    const center = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    const distance = points.length >= 2 ? Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) : 0;
    return { key: [...navigating.keys()].sort((a, b) => a - b).join(","), center, distance };
  };

  const followPinch = (): void => {
    const next = measure();
    if (next !== null && pinch !== null && next.key === pinch.key) {
      let c = camera;
      if (next.distance > 0 && pinch.distance > 0) c = zoomAtPoint(c, next.distance / pinch.distance, pinch.center, DRAW_SCALE_LIMITS);
      setCamera({ ...c, tx: c.tx + next.center.x - pinch.center.x, ty: c.ty + next.center.y - pinch.center.y });
    }
    pinch = next;
  };

  const onPointer = (event: PointerEvent): void => {
    if (pen.roleOf(event.pointerId) === "navigate") {
      if (!navigating.has(event.pointerId)) {
        try {
          surface.setPointerCapture(event.pointerId);
        } catch {
          // Non catturabile: il gesto prosegue finché il puntatore resta sopra.
        }
      }
      navigating.set(event.pointerId, localPoint(event.clientX, event.clientY));
      // Il tasto centrale del mouse, senza questo, apre lo scorrimento automatico.
      if (event.type === "pointerdown") event.preventDefault();
    } else {
      navigating.delete(event.pointerId);
    }
    followPinch();
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (!navigating.delete(event.pointerId)) return;
    followPinch();
  };

  life.listen(surface, "pointerdown", onPointer);
  life.listen(surface, "pointermove", onPointer);
  life.listen(surface, "pointerup", onPointerEnd);
  life.listen(surface, "pointercancel", onPointerEnd);
  life.listen(surface, "lostpointercapture", onPointerEnd);

  /// La rotella e il pizzico del trackpad, sul foglio e sul campo del testo.
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) {
      // Il pizzico del trackpad arriva così, a passi piccoli; la rotella del
      // mouse a passi da 100: il limite tiene lo scatto entro il 22%.
      const step = Math.max(-50, Math.min(50, dy));
      setCamera(zoomAtPoint(camera, Math.exp(-step * 0.005), localPoint(event.clientX, event.clientY), DRAW_SCALE_LIMITS));
    } else if (event.shiftKey && dx === 0) {
      setCamera({ ...camera, tx: camera.tx - dy });
    } else {
      setCamera({ ...camera, tx: camera.tx - dx, ty: camera.ty - dy });
    }
  };
  life.listen(surface, "wheel", onWheel, { passive: false });
  life.listen(textLayer, "wheel", onWheel, { passive: false });

  // --- Tastiera --------------------------------------------------------------

  /// Una barra di pulsanti col roving tabindex: uno solo prende il Tab, le
  /// frecce, Inizio e Fine passano agli altri, e il puntatore non prende il
  /// fuoco, che resta al foglio con le scorciatoie. Dà la funzione che porta
  /// il Tab su `target`, o lo tiene dov'è se c'è ancora; e il pulsante che lo
  /// tiene.
  const rove = (bar: HTMLElement): { readonly sync: (target: HTMLButtonElement | null) => void; readonly current: () => HTMLButtonElement | null } => {
    let current: HTMLButtonElement | null = null;
    const focusable = (): HTMLButtonElement[] =>
      [...bar.querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.disabled && !control.hidden);
    const sync = (target: HTMLButtonElement | null): void => {
      const controls = focusable();
      const keep = target ?? current;
      current = keep !== null && controls.includes(keep) ? keep : controls[0] ?? null;
      for (const control of bar.querySelectorAll<HTMLButtonElement>("button")) control.tabIndex = control === current ? 0 : -1;
    };
    life.listen(bar, "keydown", (event) => {
      const controls = focusable();
      const at = controls.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      let next: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (at + 1) % controls.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (at - 1 + controls.length) % controls.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = controls.length - 1;
      if (next === null) return;
      event.preventDefault();
      sync(controls[next]!);
      controls[next]!.focus();
    });
    life.listen(bar, "focusin", (event) => {
      if (event.target instanceof HTMLButtonElement) sync(event.target);
    });
    life.listen(bar, "mousedown", (event) => {
      if ((event.target as Element | null)?.closest("button")) event.preventDefault();
    });
    return { sync, current: () => current };
  };
  const toolbarFocus = rove(toolbar);
  const arrangeFocus = rove(arrangeBar);

  life.listen(titleInput, "change", () => {
    const value = titleInput.value.trim();
    if (value === currentTitle()) return;
    commit("draw.action.title", { op: "meta", title: value === "" ? null : value });
  });
  life.listen(titleInput, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      titleInput.blur();
      surface.focus({ preventScroll: true });
    } else if (event.key === "Escape") {
      event.preventDefault();
      titleInput.value = currentTitle();
      surface.focus({ preventScroll: true });
    }
  });
  life.listen(titleInput, "blur", () => {
    if (titleInput.value.trim() === currentTitle()) titleInput.value = currentTitle();
  });

  /// Il riquadro di `units` nella scena, contorno compreso.
  const boundsOf = (units: readonly Unit[]): Bounds | null => {
    let bounds: Bounds | null = null;
    for (const unit of units) bounds = union(bounds, unit.bounds);
    return bounds;
  };

  /// Il riquadro della geometria di `units`, senza contorno: quello che la
  /// griglia aggancia. Un oggetto senza geometria conta col suo riquadro.
  const geometryOf = (units: readonly Unit[]): Bounds | null => {
    let bounds: Bounds | null = null;
    for (const unit of units) bounds = union(bounds, unit.geometry ?? unit.bounds);
    return bounds;
  };

  /// Porta il riquadro `from` della selezione in `to`, e la tiene scelta: la
  /// pagina cresce se serve, come per ogni oggetto che ne esce.
  const placeSelection = (units: readonly Unit[], from: Bounds, to: Bounds): boolean =>
    // Il riquadro va da `from` a `to` scalando sugli assi: ogni oggetto, il
    // suo contorno compreso, finisce dentro `to`.
    transformSelection(units, boxMatrix(from, to), to);

  /// Applica `m`, una scala e una traslazione della scena, agli oggetti
  /// scelti, e li tiene scelti: la pagina cresce se `extent`, dove finiscono,
  /// ne esce.
  const transformSelection = (units: readonly Unit[], m: Matrix, extent: Bounds): boolean => {
    const moved = transformOps(units, m, newIds());
    const ops: Op[] = [...moved.ops];
    const page = pageFor(scene.root.page, extent);
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.resize", asGesture(ops)) === null) return false;
    selection = inOrder(moved.keys);
    syncControls();
    showHandles();
    return true;
  };

  /// Ctrl o ⌘ e le frecce: la selezione cresce o cala di (`dw`, `dh`),
  /// ferma nell'angolo in alto a sinistra. Un lato che misura zero, come
  /// quello di una linea dritta, resta zero.
  const resizeSelection = (dw: number, dh: number): void => {
    const units = selectedUnits();
    const from = boundsOf(units);
    if (from === null) return;
    const w = from.max[0] - from.min[0];
    const h = from.max[1] - from.min[1];
    const width = w > 0 ? Math.max(Math.min(w, MIN_SIZE), w + dw) : w;
    const height = h > 0 ? Math.max(Math.min(h, MIN_SIZE), h + dh) : h;
    if (width === w && height === h) return;
    const to: Bounds = { min: from.min, max: [from.min[0] + width, from.min[1] + height] };
    if (placeSelection(units, from, to)) announce(t("draw.resized", { width: numberText(width), height: numberText(height) }));
  };

  /// Con l'aggancio, le frecce portano l'angolo in alto a sinistra della
  /// geometria scelta alla riga `lines` righe più in là, sull'asse della
  /// freccia.
  const moveOnGrid = (x: number, y: number, lines: number): void => {
    const units = selectedUnits();
    const from = geometryOf(units);
    if (from === null) return;
    const [left, top] = from.min;
    const dx = x === 0 ? 0 : lineBeyond(left, grid.step, sign(x), lines) - left;
    const dy = y === 0 ? 0 : lineBeyond(top, grid.step, sign(y), lines) - top;
    moveSelection(units, roundDelta(dx), roundDelta(dy));
  };

  /// Con l'aggancio, Ctrl o ⌘ e le frecce portano il lato destro o quello in
  /// basso della geometria scelta alla riga `lines` righe più in là, fermo
  /// l'angolo in alto a sinistra. Il lato non passa la prima riga dopo
  /// quello opposto, e un lato che misura zero resta zero.
  const resizeOnGrid = (x: number, y: number, lines: number): void => {
    const units = selectedUnits();
    const from = geometryOf(units);
    const shown = boundsOf(units);
    if (from === null || shown === null) return;
    const edge = (min: number, max: number, direction: number): number =>
      direction === 0 || max <= min ? max : Math.max(lineBeyond(max, grid.step, sign(direction), lines), lineBeyond(min, grid.step, 1, 1));
    const right = edge(from.min[0], from.max[0], x);
    const bottom = edge(from.min[1], from.max[1], y);
    if (right === from.max[0] && bottom === from.max[1]) return;
    const m = boxMatrix(from, { min: from.min, max: [right, bottom] });
    const to = mappedBounds(shown, m);
    if (transformSelection(units, m, to)) {
      announce(t("draw.resized", { width: numberText(to.max[0] - to.min[0]), height: numberText(to.max[1] - to.min[1]) }));
    }
  };

  // --- Disporre ----------------------------------------------------------------

  /// Gli oggetti su cui lavora un comando di disposizione: quelli scelti, dal
  /// livello Standard e col disegno che si scrive. `null`, e lo si dice, se
  /// non c'è niente di scelto.
  const arranging = (): Unit[] | null => {
    if (!reaches(level, "standard") || !editable()) return null;
    const units = selectedUnits();
    if (units.length === 0) {
      announce(t("draw.selected.none"));
      return null;
    }
    cancelGesture();
    return units;
  };

  /// Scrive `arranged` col nome `label`, e la selezione diventa la sua; la
  /// pagina cresce se `extent` ne esce. `false` se non c'era niente da
  /// cambiare, e lo si dice, o se il motore ha rifiutato.
  const arrange = (label: DrawKey, arranged: Arranged, extent: Bounds | null = null): boolean => {
    if (arranged.ops.length === 0) {
      announce(t("draw.unchanged"));
      return false;
    }
    const ops: Op[] = [...arranged.ops];
    const page = pageFor(scene.root.page, extent);
    if (page !== null) ops.push({ op: "page", viewBox: page });
    // La selezione è già quella di dopo quando l'editor si rinfresca: la
    // barra non sparisce per un istante, e il fuoco che ci sta resta.
    const before = selection;
    selection = [...arranged.keys];
    if (commit(label, asGesture(ops)) === null) {
      select(before);
      return false;
    }
    select(arranged.keys);
    return true;
  };

  /// Copia gli oggetti scelti un passo più in basso a destra, sopra gli
  /// originali; la selezione passa alle copie, così un secondo Ctrl+D
  /// prosegue la fila.
  function duplicateSelection(): void {
    const units = arranging();
    if (units === null) return;
    // Con l'aggancio le copie si scostano di passi interi della griglia, e
    // ciò che ci stava sopra ci resta.
    const distance = COPY_STEP_PX / camera.scale;
    const step = gridOn() ? wholeSteps(distance, grid.step) : roundDelta(distance);
    const arranged = duplicateOps(engine.model!, units, step, step, newIds());
    if (arranged === null) {
      announce(t("draw.duplicate.foreign"));
      return;
    }
    if (!arrange("draw.action.duplicate", arranged, translated(boundsOf(units), step, step))) return;
    announce(`${plural(units.length, "draw.duplicated.one", "draw.duplicated.other")} ${objects()}`);
  }

  function orderSelection(order: Order): void {
    const units = arranging();
    if (units === null) return;
    if (arrange("draw.action.order", orderOps(engine.model!, currentIndex(), units, order, newIds()))) announce(t(ORDERED[order]));
  }

  function groupSelection(): void {
    const units = arranging();
    if (units === null) return;
    if (units.length < 2) {
      announce(t("draw.group.few"));
      return;
    }
    const arranged = groupOps(engine.model!, units, newIds());
    if (arranged === null) {
      announce(t("draw.rejected", { reason: t("draw.reason.invalid") }));
      return;
    }
    if (arrange("draw.action.group", arranged)) announce(t("draw.grouped", { count: units.length }));
  }

  function ungroupSelection(): void {
    const units = arranging();
    if (units === null) return;
    const groups = units.filter(isGroup).length;
    if (groups === 0) {
      announce(t("draw.ungroup.none"));
      return;
    }
    const arranged = ungroupOps(engine.model!, units, newIds());
    if (arranged === "foreign") {
      announce(t("draw.ungroup.foreign"));
      return;
    }
    if (arrange("draw.action.ungroup", arranged)) announce(plural(groups, "draw.ungrouped.one", "draw.ungrouped.other"));
  }

  /// Il collegamento scelto da solo, se c'è.
  const lonelyLink = (units: readonly Unit[]): Unit | null => (units.length === 1 && isLink(units[0]!) ? units[0]! : null);

  /// Ctrl+K, o «Collega a una nota…»: collega gli oggetti scelti a una nota
  /// che sceglie chi monta l'editor, o porta a un'altra nota il collegamento
  /// scelto da solo. Il collegamento nuovo è un passo di annulla, e la
  /// selezione passa a lui.
  async function linkSelection(): Promise<void> {
    const links = options.links;
    if (links === undefined || asking) return;
    const units = arranging();
    if (units === null) return;
    const single = lonelyLink(units);
    if (single === null && holdsLinks(engine.model!, units)) {
      announce(t("draw.link.nested"));
      return;
    }
    const current = single === null ? null : linkTarget(nodeOf(engine.model!, single));
    const opened = loads;
    asking = true;
    let href: string | null;
    try {
      href = await links.choose(current);
    } catch {
      // Chi sceglie dice da sé perché non ha potuto.
      href = null;
    } finally {
      asking = false;
    }
    if (href === null || disposed || loads !== opened) return;
    // Mentre si sceglieva il disegno può essere cambiato: valgono gli oggetti
    // scelti adesso.
    const now = arranging();
    if (now === null) return;
    const again = lonelyLink(now);
    if (again !== null) {
      if (arrange("draw.action.relink", relinkOps(engine.model!, again, href, newIds()))) announce(t("draw.relinked", { note: linkName(href) }));
      return;
    }
    const arranged = linkOps(engine.model!, now, href, newIds());
    if (arranged === "nested") {
      announce(t("draw.link.nested"));
      return;
    }
    if (arranged === null) {
      announce(t("draw.rejected", { reason: t("draw.reason.invalid") }));
      return;
    }
    if (arrange("draw.action.link", arranged)) announce(t("draw.linked", { note: linkName(href) }));
  }

  /// Ctrl+Maiusc+K, o «Togli il collegamento»: gli oggetti dei collegamenti
  /// scelti restano dov'erano, e la selezione passa a loro.
  function unlinkSelection(): void {
    const units = arranging();
    if (units === null) return;
    const count = units.filter(isLink).length;
    if (count === 0) {
      announce(t("draw.unlink.none"));
      return;
    }
    const arranged = unlinkOps(engine.model!, units, newIds());
    if (arranged === "foreign") {
      announce(t("draw.unlink.foreign"));
      return;
    }
    if (arrange("draw.action.unlink", arranged)) announce(plural(count, "draw.unlinked.one", "draw.unlinked.other"));
  }

  /// Alt+Invio, o «Apri»: la nota del collegamento scelto da solo, a ogni
  /// livello e anche quando il disegno non si scrive. `false` se non ce n'è
  /// uno che porta nel vault.
  function openSelectedLink(): boolean {
    const single = lonelyLink(selectedUnits());
    const target = single === null || engine.model === null ? null : linkTarget(nodeOf(engine.model, single));
    if (options.links === undefined || target === null) return false;
    openLink(target);
    return true;
  }

  /// Il riquadro a cui si allinea la selezione: la pagina per un oggetto
  /// solo, il riquadro della selezione per più d'uno. `null` per un oggetto
  /// solo in un disegno senza pagina.
  const alignReference = (units: readonly Unit[]): Bounds | null => {
    if (units.length > 1) return boundsOf(units);
    const page = scene.root.page;
    return page === null ? null : { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] };
  };

  function alignSelection(edge: Edge): void {
    const units = arranging();
    if (units === null) return;
    const reference = alignReference(units);
    if (reference === null) return;
    if (arrange("draw.action.align", alignOps(units, edge, reference, newIds()))) {
      announce(plural(units.length, "draw.aligned.one", "draw.aligned.other"));
    }
  }

  /// Gli oggetti scelti che disegnano qualcosa: quelli che si distribuiscono.
  const drawn = (units: readonly Unit[]): number => units.filter((unit) => unit.bounds !== null).length;

  function distributeSelection(axis: Axis): void {
    const units = arranging();
    if (units === null) return;
    const count = drawn(units);
    if (count < 3) {
      announce(t("draw.distribute.few"));
      return;
    }
    if (arrange("draw.action.distribute", distributeOps(units, axis, newIds()))) announce(t("draw.distributed", { count }));
  }

  /// Apre il menu di un pulsante, sotto il pulsante, col nome del pulsante.
  function openMenu(trigger: HTMLButtonElement, items: MenuItem[]): void {
    const box = trigger.getBoundingClientRect();
    if (trigger.id === "") trigger.id = identifier("draw-menu-button");
    trigger.setAttribute("aria-expanded", "true");
    showContextMenu(new MouseEvent("click", { clientX: box.left, clientY: box.bottom + 4 }), items, {
      labelledBy: trigger.id,
      onClose: () => trigger.setAttribute("aria-expanded", "false"),
    });
  }

  /// Le voci dell'ordine: spenta quella che non cambierebbe niente.
  const orderItems = (): MenuItem[] => {
    const units = selectedUnits();
    const model = engine.model;
    const index = currentIndex();
    return ORDERS.map(({ order, label, binding }) => ({
      label: t(label),
      hint: displayBinding(binding),
      disabled: model === null || units.length === 0 || orderOps(model, index, units, order, newIds()).ops.length === 0,
      run: () => orderSelection(order),
    }));
  };

  /// Le voci dell'allineamento e della distribuzione. Per un oggetto solo il
  /// riferimento è la pagina, e il nome lo dice; distribuire chiede almeno
  /// tre oggetti, e la voce spenta dice perché.
  const alignItems = (): MenuItem[] => {
    const units = selectedUnits();
    const single = units.length === 1;
    const usable = units.length > 0 && alignReference(units) !== null;
    const items: MenuItem[] = EDGES.map(({ edge, label }) => ({
      label: single ? t("draw.align.to_page", { action: t(label) }) : t(label),
      disabled: !usable,
      run: () => alignSelection(edge),
    }));
    const few = drawn(units) < 3;
    for (const { axis, label } of AXES) {
      items.push({
        label: t(label),
        separator: axis === "x",
        disabled: few,
        ...(few ? { description: t("draw.distribute.few") } : {}),
        run: () => distributeSelection(axis),
      });
    }
    return items;
  };

  /// Porta gli oggetti scelti in cima a `layer`, dove si vedevano.
  function moveIntoLayer(layer: LayerInfo): void {
    const units = arranging();
    if (units === null) return;
    const name = layerTitle(layer);
    const refusal = layerRefusal(layer);
    if (refusal !== null) {
      announce(t(refusal, { name }));
      return;
    }
    const arranged = intoLayerOps(engine.model!, units, layer, newIds());
    if (arranged === null) {
      announce(t("draw.layer.flat", { name }));
      return;
    }
    const moving = units.filter((unit) => !inLayer(unit, layer)).length;
    if (!arrange("draw.action.into_layer", arranged)) return;
    // La selezione ha le stesse chiavi, ma sta nel livello nuovo.
    followSelection();
    announce(plural(moving, "draw.moved_to_layer.one", "draw.moved_to_layer.other", { name }));
  }

  /// Le voci di «Sposta in un livello», dalla cima: spento il livello che ha
  /// già tutti gli oggetti scelti, e quello bloccato o nascosto, che lo dice.
  const intoItems = (): MenuItem[] => {
    const units = selectedUnits();
    const layers = currentIndex().layers;
    const items: MenuItem[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]!;
      const here = units.length > 0 && units.every((unit) => inLayer(unit, layer));
      const description = here ? t("draw.into_layer.here") : layerState(layer);
      items.push({
        label: layerTitle(layer),
        disabled: here || layerRefusal(layer) !== null,
        ...(description === "" ? {} : { description }),
        run: () => moveIntoLayer(layer),
      });
    }
    return items;
  };

  // --- Livelli -----------------------------------------------------------------

  /// Il livello su cui lavora un comando dei livelli: quello corrente, dal
  /// livello Standard e col disegno che si scrive.
  const layering = (): LayerInfo | null => {
    if (!reaches(level, "standard") || !editable()) return null;
    cancelGesture();
    return currentLayer();
  };

  /// Scrive un comando sui livelli col nome `label`; il livello di chiave
  /// `key`, se c'è, diventa quello corrente. `false` se non c'era niente da
  /// cambiare, e lo si dice, o se il motore ha rifiutato.
  const writeLayers = (label: DrawKey, arranged: Arranged, key: string | null): boolean => {
    if (arranged.ops.length === 0) {
      announce(t("draw.unchanged"));
      return false;
    }
    // Il livello corrente è già quello di dopo quando l'editor si rinfresca.
    const before = chosen;
    if (key !== null) chosen = { key, at: chosen?.at ?? 0 };
    if (commit(label, asGesture(arranged.ops)) === null) {
      chosen = before;
      syncLayers();
      return false;
    }
    return true;
  };

  /// Sceglie il livello corrente; se lì non si disegna, lo dice subito.
  function chooseLayer(layer: LayerInfo): void {
    if (!reaches(level, "standard")) return;
    choose(layer);
    const name = layerTitle(layer);
    const refusal = layerRefusal(layer);
    announce(refusal === null ? t("draw.layer.chosen", { name }) : `${t("draw.layer.chosen", { name })} ${t(refusal, { name })}`);
  }

  /// Un livello nuovo e vuoto sopra quello corrente, che diventa lui.
  function addLayer(): void {
    if (!reaches(level, "standard") || !editable()) return;
    cancelGesture();
    const name = freshLayerName(currentIndex().layers, (n) => t("draw.layer.default", { n }));
    const arranged = addLayerOps(engine.model!, currentLayer(), name, newIds());
    if (writeLayers("draw.action.layer_add", arranged, arranged.keys[0] ?? null)) announce(t("draw.layer.added", { name }));
  }

  /// «Rinomina…»: il nome nuovo del livello corrente, mai vuoto.
  async function renameLayer(): Promise<void> {
    if (asking) return;
    const layer = layering();
    if (layer === null) return;
    asking = true;
    try {
      const answer = await promptForm({
        title: t("draw.layer.rename.dialog"),
        fields: [{ id: "name", label: t("draw.layer.name"), value: layer.name, kind: "text", required: true, maxLength: MAX_LAYER_NAME }],
      });
      if (answer === null || disposed || !editable()) return;
      const name = layerName(answer.name ?? "");
      // Mentre la finestra era aperta il disegno può essere cambiato: vale il
      // livello che ha ancora la stessa chiave.
      const now = currentIndex().layers.find((other) => keyOf(other) === keyOf(layer));
      if (name === "" || now === undefined) return;
      const arranged = renameLayerOps(engine.model!, now, name, newIds());
      if (writeLayers("draw.action.layer_rename", arranged, arranged.keys[0] ?? null)) {
        announce(t("draw.layer.renamed", { name: layerTitle({ ...now, name }) }));
      }
    } finally {
      asking = false;
    }
  }

  function hideLayer(hidden: boolean): void {
    const layer = layering();
    if (layer === null) return;
    const arranged = hideLayerOps(engine.model!, layer, hidden, newIds());
    if (writeLayers(hidden ? "draw.action.layer_hide" : "draw.action.layer_show", arranged, arranged.keys[0] ?? null)) {
      announce(t(hidden ? "draw.layer.hidden" : "draw.layer.shown", { name: layerTitle(layer) }));
    }
  }

  function lockLayer(locked: boolean): void {
    const layer = layering();
    if (layer === null) return;
    const arranged = lockLayerOps(engine.model!, layer, locked, newIds());
    if (writeLayers(locked ? "draw.action.layer_lock" : "draw.action.layer_unlock", arranged, arranged.keys[0] ?? null)) {
      announce(t(locked ? "draw.layer.locked" : "draw.layer.unlocked", { name: layerTitle(layer) }));
    }
  }

  /// Porta il livello corrente sopra quello che ha sopra, o sotto quello
  /// che ha sotto.
  function shiftLayer(shift: Shift): void {
    const layer = layering();
    if (layer === null) return;
    const layers = currentIndex().layers;
    const at = layers.findIndex((other) => other.path[0] === layer.path[0]);
    const other = layers[shift === "up" ? at + 1 : at - 1];
    const arranged = shiftLayerOps(engine.model!, layers, layer, shift, newIds());
    if (writeLayers("draw.action.layer_order", arranged, arranged.keys[0] ?? null) && other !== undefined) {
      announce(t(shift === "up" ? "draw.layer.moved_up" : "draw.layer.moved_down", { name: layerTitle(layer), other: layerTitle(other) }));
    }
  }

  /// Elimina il livello corrente con ciò che contiene; diventa corrente
  /// quello sotto, o quello sopra. L'unico livello, o uno bloccato, resta.
  function deleteLayer(): void {
    const layer = layering();
    if (layer === null) return;
    const layers = currentIndex().layers;
    if (layers.length < 2 || layer.locked) return;
    const at = layers.findIndex((other) => other.path[0] === layer.path[0]);
    const next = layers[at - 1] ?? layers[at + 1]!;
    // Dopo, il livello sopra ha un posto in meno.
    const nextAt = next.path[0]! > layer.path[0]! ? next.path[0]! - 1 : next.path[0]!;
    const count = outlineNow().byKey.get(keyOf(layer))?.children.length ?? 0;
    if (!writeLayers("draw.action.layer_delete", removeLayerOps(layer), next.id ?? `@${nextAt}`)) return;
    const name = layerTitle(layer);
    const gone = count === 0 ? t("draw.layer.deleted", { name }) : plural(count, "draw.layer.deleted.one", "draw.layer.deleted.other", { name });
    announce(`${gone} ${t("draw.layer.chosen", { name: layerTitle(next) })}`);
  }

  /// Il menu dei livelli: i livelli dalla cima, per scegliere quello
  /// corrente, e i comandi su quello corrente.
  const layerItems = (): MenuItem[] => {
    const layers = currentIndex().layers;
    const current = currentLayer();
    const items: MenuItem[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]!;
      const checked = current !== null && layer.path[0] === current.path[0];
      const state = layerState(layer);
      items.push({
        label: layerTitle(layer),
        choice: "radio",
        checked,
        selected: checked,
        ...(state === "" ? {} : { description: state }),
        run: () => chooseLayer(layer),
      });
    }
    items.push({ label: t("draw.layer.new"), separator: true, run: () => addLayer() });
    if (current === null) return items;
    const name = layerTitle(current, LAYER_IN_COMMAND);
    const lone = layers.length < 2;
    items.push(
      { label: t("draw.layer.rename", { name }), run: () => void renameLayer() },
      { label: t(current.hidden ? "draw.layer.show" : "draw.layer.hide", { name }), run: () => hideLayer(!current.hidden) },
      { label: t(current.locked ? "draw.layer.unlock" : "draw.layer.lock", { name }), run: () => lockLayer(!current.locked) },
      { label: t("draw.layer.up", { name }), disabled: !canShiftLayer(layers, current, "up"), run: () => shiftLayer("up") },
      { label: t("draw.layer.down", { name }), disabled: !canShiftLayer(layers, current, "down"), run: () => shiftLayer("down") },
      {
        label: t("draw.layer.delete", { name }),
        separator: true,
        danger: true,
        disabled: lone || current.locked,
        ...(lone ? { description: t("draw.layer.delete.last") } : current.locked ? { description: t("draw.layer.delete.locked") } : {}),
        run: () => deleteLayer(),
      },
    );
    return items;
  };

  // --- Griglia e pagina -------------------------------------------------------

  /// La griglia diventa `next` per scelta di chi disegna: si vede subito, si
  /// dice che cosa è cambiato, e chi monta l'editor lo sa.
  const changeGrid = (next: Grid): void => {
    const before = grid;
    grid = checkedGrid(next, before);
    showGrid();
    if (grid.shown !== before.shown) announce(t(grid.shown ? "draw.grid.shown" : "draw.grid.hidden"));
    else if (grid.snap !== before.snap) announce(t(grid.snap ? "draw.grid.snap.on" : "draw.grid.snap.off"));
    else if (grid.step !== before.step) announce(t("draw.grid.stepped", { step: numberText(grid.step) }));
    else return;
    options.onGridChange?.(grid);
  };

  /// «Adatta la pagina al disegno»: la pagina va attorno a tutto il disegno,
  /// livelli bloccati e nascosti compresi, con un margine. È un passo di
  /// annulla, e gli oggetti restano dove sono.
  function fitPage(): void {
    if (!reaches(level, "standard") || !editable()) return;
    cancelGesture();
    const extent = indexer.extent(engine.model!);
    const viewBox = fittedPage(scene.root.page, extent);
    if (viewBox === null) {
      announce(t(extent === null ? "draw.page.fit.empty" : "draw.page.fit.already"));
      return;
    }
    if (commit("draw.action.fit_page", { op: "page", viewBox }) === null) return;
    const page = scene.root.page;
    if (page !== null) announce(t("draw.page.fitted", { width: numberText(page.width), height: numberText(page.height) }));
  }

  /// Le voci di «Pagina e griglia»: la griglia, il suo passo, e la pagina.
  /// Adattare la pagina si spegne, e dice perché, quando non cambierebbe
  /// niente.
  const pageItems = (): MenuItem[] => {
    const steps = GRID_STEPS.includes(grid.step) ? GRID_STEPS : [...GRID_STEPS, grid.step].sort((a, b) => a - b);
    const extent = engine.model === null ? null : indexer.extent(engine.model);
    const viewBox = fittedPage(scene.root.page, extent);
    const fitItem: MenuItem = { label: t("draw.page.fit"), separator: true, disabled: !editable() || viewBox === null, run: () => fitPage() };
    if (extent === null) fitItem.description = t("draw.page.fit.empty");
    else if (viewBox === null) fitItem.description = t("draw.page.fit.already");
    return [
      { label: t("draw.grid.show"), choice: "checkbox", checked: grid.shown, hint: "#", run: () => changeGrid({ ...grid, shown: !grid.shown }) },
      {
        label: t("draw.grid.snap"),
        choice: "checkbox",
        checked: grid.snap,
        hint: "%",
        description: t("draw.grid.snap.free", { key: modifierName("Mod") ?? "Ctrl" }),
        run: () => changeGrid({ ...grid, snap: !grid.snap }),
      },
      ...steps.map((step, at): MenuItem => ({
        label: t("draw.grid.step", { step: numberText(step) }),
        choice: "radio",
        checked: step === grid.step,
        separator: at === 0,
        run: () => changeGrid({ ...grid, step }),
      })),
      fitItem,
    ];
  };

  // --- Frecce, finestre ed elenco dei tasti -----------------------------------

  /// Alt+F10: il fuoco va alla barra della selezione, se c'è.
  const focusArrange = (): boolean => {
    if (arrangeBar.hidden) return false;
    arrangeFocus.sync(null);
    const target = arrangeFocus.current();
    if (target === null) return false;
    target.focus();
    return true;
  };

  /// Le frecce sul foglio. Con una selezione la spostano, e con Ctrl o ⌘ la
  /// ridimensionano; senza, o mentre la tastiera preme, muovono il cursore.
  /// Con l'aggancio vanno di riga in riga della griglia, cinque con Maiusc.
  const arrows = (event: KeyboardEvent): boolean => {
    const direction = ARROWS[event.key];
    if (direction === undefined) return false;
    const [x, y] = direction;
    const fine = event.ctrlKey || event.metaKey;
    const lines = event.shiftKey ? GRID_MAJOR : 1;
    if (pressed === null && selection.length > 0 && editable()) {
      const step = event.shiftKey ? NUDGE_SHIFT : NUDGE;
      if (gridOn()) {
        if (fine) resizeOnGrid(x, y, lines);
        else moveOnGrid(x, y, lines);
      } else if (fine) {
        resizeSelection(x * step, y * step);
      } else {
        moveSelection(selectedUnits(), x * step, y * step);
      }
      return true;
    }
    // Ctrl o ⌘ lascia il cursore libero, come lascia libero il puntatore.
    if (gridOn() && !fine) {
      moveCursorOnGrid(x, y, lines);
      return true;
    }
    const px = fine ? CURSOR_PX_FINE : event.shiftKey ? CURSOR_PX_SHIFT : CURSOR_PX;
    moveCursor(x * px, y * px);
    return true;
  };

  /// Sceglie l'oggetto `at` in ordine di documento, lo porta in vista e lo
  /// dice. `false` se non c'è.
  const visit = (at: number): boolean => {
    const units = currentIndex().units;
    const unit = units[at];
    if (unit === undefined) return false;
    cancelGesture();
    select([unit.key]);
    frameBounds(unit.bounds);
    announce(t("draw.walk", { object: labelOf(unit), index: at + 1, count: units.length }));
    return true;
  };

  /// Tab con una selezione: l'oggetto dopo l'ultimo scelto, o con Maiusc
  /// quello prima del primo. Oltre le estremità il Tab esce dal foglio.
  const walk = (step: 1 | -1): boolean => {
    if (selection.length === 0 || pressed !== null) return false;
    const anchor = step > 0 ? selection[selection.length - 1] : selection[0];
    const at = currentIndex().units.findIndex((unit) => unit.key === anchor);
    return at >= 0 && visit(at + step);
  };

  /// Invio: posizione e misure della selezione, o le proprietà del disegno.
  /// Il fuoco torna dov'era, come da ogni finestra.
  async function properties(): Promise<void> {
    if (asking || !editable()) return;
    finishText();
    asking = true;
    cancelGesture();
    try {
      if (selection.length > 0) await placeDialog();
      else await documentDialog();
    } finally {
      asking = false;
    }
  }

  const PLACES = 2;

  const placeDialog = async (): Promise<void> => {
    const before = boundsOf(selectedUnits());
    if (before === null) return;
    const w = before.max[0] - before.min[0];
    const h = before.max[1] - before.min[1];
    const shown = [before.min[0], before.min[1], w, h].map((value) => formatNumber(value, PLACES));
    const answer = await promptForm({
      title: t("draw.properties.selection"),
      fields: [
        { id: "x", label: "X", value: shown[0]!, kind: "number" },
        { id: "y", label: "Y", value: shown[1]!, kind: "number" },
        // Un lato più corto di un centesimo non ha una misura da scrivere.
        { id: "w", label: t("draw.field.width"), value: shown[2]!, kind: "number", min: 0.01, disabled: w < 0.01 },
        { id: "h", label: t("draw.field.height"), value: shown[3]!, kind: "number", min: 0.01, disabled: h < 0.01 },
      ],
    });
    if (answer === null || disposed || !editable()) return;
    // Mentre la finestra era aperta il disegno può essere cambiato: valgono
    // gli oggetti scelti adesso, e i campi non toccati restano esatti.
    const units = selectedUnits();
    const from = boundsOf(units);
    if (from === null) return;
    const exact = [from.min[0], from.min[1], from.max[0] - from.min[0], from.max[1] - from.min[1]];
    const value = (id: string, at: number): number => (answer[id] === undefined || answer[id] === shown[at] ? exact[at]! : Number(answer[id]));
    const [x, y, width, height] = [value("x", 0), value("y", 1), value("w", 2), value("h", 3)];
    if (width === exact[2] && height === exact[3]) {
      moveSelection(units, x - from.min[0], y - from.min[1]);
      return;
    }
    if (placeSelection(units, from, { min: [x, y], max: [x + width, y + height] })) {
      announce(t("draw.resized", { width: numberText(width), height: numberText(height) }));
    }
  };

  const documentDialog = async (): Promise<void> => {
    const title = rootText("title");
    const desc = rootText("desc");
    const page = scene.root.page;
    const fields: FormField[] = [
      { id: "title", label: t("draw.field.title"), value: title, kind: "text" },
      { id: "desc", label: t("draw.field.desc"), value: desc, kind: "multiline" },
    ];
    const size = page === null ? null : [formatNumber(page.width, PLACES), formatNumber(page.height, PLACES)];
    if (size !== null) {
      fields.push(
        { id: "w", label: t("draw.field.page_width"), value: size[0]!, kind: "number", min: 1 },
        { id: "h", label: t("draw.field.page_height"), value: size[1]!, kind: "number", min: 1 },
      );
    }
    const answer = await promptForm({ title: t("draw.properties.document"), fields });
    if (answer === null || disposed || !editable()) return;
    const ops: Op[] = [];
    const meta: { title?: string | null; desc?: string | null } = {};
    const nextTitle = (answer.title ?? "").trim();
    const nextDesc = (answer.desc ?? "").trim();
    if (nextTitle !== title.trim()) meta.title = nextTitle === "" ? null : nextTitle;
    if (nextDesc !== desc.trim()) meta.desc = nextDesc === "" ? null : nextDesc;
    if (Object.keys(meta).length > 0) ops.push({ op: "meta", ...meta });
    const now = scene.root.page;
    if (now !== null && size !== null && (answer.w !== size[0] || answer.h !== size[1])) {
      const width = answer.w === size[0] ? now.width : Number(answer.w);
      const height = answer.h === size[1] ? now.height : Number(answer.h);
      ops.push({ op: "page", viewBox: [now.x, now.y, width, height].map((v) => formatNumber(v, PLACES)).join(" ") });
    }
    commit("draw.properties.document", asGesture(ops));
  };

  /// I tasti dei comandi della selezione, dal livello Standard.
  const arrangeKeys = (at: Level): KeyGroup[] =>
    reaches(at, "standard")
      ? [
          {
            title: t("draw.arrange"),
            rows: [
              ["Mod-d", t("draw.duplicate")],
              ["Mod-g", t("draw.group")],
              ["Mod-Shift-g", t("draw.ungroup")],
              ...(options.links === undefined ? [] : [["Mod-k", t("draw.keys.link")] as const]),
              ["Mod-Shift-k", t("draw.unlink")],
              ["Mod-Shift-] Shift-PageUp", t("draw.order.front")],
              ["Mod-] PageUp", t("draw.order.forward")],
              ["Mod-[ PageDown", t("draw.order.backward")],
              ["Mod-Shift-[ Shift-PageDown", t("draw.order.back")],
              ["Alt-F10", t("draw.keys.arrange")],
            ],
          },
        ]
      : [];

  /// I tasti della griglia, dal livello Standard.
  const gridKeys = (at: Level): KeyGroup[] =>
    reaches(at, "standard")
      ? [
          {
            title: t("draw.keys.grid"),
            rows: [
              ["#", t("draw.keys.grid.show")],
              ["%", t("draw.keys.grid.snap")],
              ["Mod", t("draw.keys.grid.free")],
            ],
          },
        ]
      : [];

  /// I tasti degli attributi, dal livello Esperto.
  const attributeKeys = (at: Level): KeyGroup[] =>
    reaches(at, "expert")
      ? [
          {
            title: t("draw.attributes"),
            rows: [
              [ATTRIBUTES_BINDING, t("draw.keys.attributes.toggle")],
              ["Enter", t("draw.keys.attributes.apply")],
              ["Shift-Enter", t("draw.keys.attributes.newline")],
              ["Escape", t("draw.keys.attributes.revert")],
            ],
          },
        ]
      : [];

  /// I tasti del testo, dal livello Standard.
  const textKeys = (at: Level): KeyGroup[] =>
    reaches(at, "standard")
      ? [
          {
            title: t("draw.keys.text"),
            rows: [
              ["Space", t("draw.keys.text.write")],
              ["F2", t("draw.keys.text.edit")],
              ["Enter", t("draw.keys.text.newline")],
              ["Escape Tab Mod-Enter", t("draw.keys.text.finish")],
            ],
          },
        ]
      : [];

  /// L'elenco dei tasti del livello `at`, nei gruppi in cui si usano.
  const keyGroups = (at: Level): KeyGroup[] => [
    { title: t("draw.keys.tools"), rows: toolsFor(at).map((spec) => [spec.shortcut, t(spec.label)] as const) },
    {
      title: t("draw.keys.cursor"),
      rows: [
        [ARROW_KEYS, t(gridOn(at) ? "draw.keys.cursor.move.grid" : "draw.keys.cursor.move")],
        ["Space Enter", t("draw.keys.cursor.press")],
        ["Escape", t("draw.keys.cancel")],
      ],
    },
    {
      title: t("draw.objects"),
      rows: [
        [ARROW_KEYS, t(gridOn(at) ? "draw.keys.nudge.grid" : "draw.keys.nudge")],
        [`Mod-${ARROW_KEYS}`, t(gridOn(at) ? "draw.keys.resize.grid" : "draw.keys.resize")],
        ["Tab Shift-Tab", t("draw.keys.walk")],
        ["Home End", t("draw.keys.ends")],
        ["Enter", t("draw.properties")],
        ...(options.links === undefined ? [] : [["Alt-Enter", t("draw.keys.link.open")] as const]),
        ["Delete", t("draw.delete")],
        ["Mod-a", t("draw.keys.all")],
        ["Escape", t("draw.keys.deselect")],
      ],
    },
    ...arrangeKeys(at),
    ...textKeys(at),
    ...gridKeys(at),
    ...attributeKeys(at),
    {
      title: t("draw.view"),
      rows: [
        ["+", t("draw.zoom_in")],
        ["-", t("draw.zoom_out")],
        ["0", t("draw.keys.actual")],
        ["Shift-1", t("draw.fit")],
      ],
    },
    {
      title: t("draw.edit"),
      rows: [
        ["Mod-z", t("draw.undo")],
        ["Mod-Shift-z Mod-y", t("draw.redo")],
        ["Mod-v", t("draw.keys.paste")],
        ["?", t("draw.keys")],
      ],
    },
  ];

  /// I tasti che i livelli sopra quello di adesso aggiungono, col livello da
  /// cui valgono: una riga è nuova se il suo gruppo non aveva i suoi tasti.
  const moreKeys = (): MoreKeys => {
    const seen = new Set<string>();
    const remember = (group: KeyGroup, keys: string): boolean => {
      const id = `${group.title}\u0000${keys}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    };
    for (const group of keyGroups(level)) for (const [keys] of group.rows) remember(group, keys);
    const groups: KeyGroup[] = [];
    for (const above of levelsAbove(level)) {
      for (const group of keyGroups(above)) {
        const rows = group.rows.filter(([keys]) => remember(group, keys));
        if (rows.length > 0) groups.push({ title: t("draw.keys.from_level", { group: group.title, level: t(LEVEL_NAMES[above]) }), rows });
      }
    }
    return { groups, note: t("draw.keys.more", { level: t(LEVEL_NAMES[level]) }) };
  };

  /// «?»: l'elenco dei tasti di questo livello, e con «Mostra tutto» quelli
  /// dei livelli sopra. Il livello non si cambia da qui: lo sceglie chi
  /// prepara il vault, e l'Essenziale resta tale anche in mano a un bambino.
  async function keys(): Promise<void> {
    if (asking) return;
    asking = true;
    cancelGesture();
    try {
      await showKeys(t("draw.keys"), keyGroups(level), moreKeys());
    } finally {
      asking = false;
    }
  }

  // --- Le immagini incollate --------------------------------------------------

  const codec = options.imageCodec === undefined ? browserCodec() : options.imageCodec;

  /// Un peso come si legge: KiB sotto il MiB, MiB sopra.
  const sizeText = (bytes: number): string =>
    bytes < 1024 * 1024 ? `${numberText(bytes / 1024)} KiB` : `${numberText(bytes / (1024 * 1024))} MiB`;

  /// Ciò che si vede del foglio, nella scena.
  const viewBounds = (): Bounds => {
    const a = screenToWorld(camera, { x: 0, y: 0 });
    const b = screenToWorld(camera, { x: surface.clientWidth, y: surface.clientHeight });
    return { min: [a.x, a.y], max: [b.x, b.y] };
  };

  /// Un'immagine pronta: i byte del file e le misure dell'originale, che
  /// decidono quanto è grande sul foglio anche dopo una riduzione.
  interface Picture {
    readonly decoded: Decoded;
    encoded: Encoded;
  }

  /// I byte di `file` come entrano nel disegno: così come sono se sono PNG,
  /// JPEG diritto, WebP o GIF; altrimenti ricodificati. `null` se non è
  /// un'immagine che il browser sa leggere.
  const pictureOf = async (file: File, decoder: ImageCodec): Promise<Picture | null> => {
    let bytes: Uint8Array;
    let decoded: Decoded | null;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      decoded = await decoder.decode(file);
    } catch {
      return null;
    }
    if (decoded === null) return null;
    let type = sniffRaster(bytes);
    if (type === "image/jpeg" && jpegOrientation(bytes) !== 1) type = null;
    if (type !== null) return { decoded, encoded: { type, bytes } };
    // Un JPEG girato resta JPEG, diritto; il resto diventa PNG, che non perde.
    const as = sniffRaster(bytes) === "image/jpeg" ? "image/jpeg" : "image/png";
    const encoded = await decoded.encode(as, 1);
    if (encoded === null) {
      decoded.close();
      return null;
    }
    return { decoded, encoded: { type: as, bytes: encoded } };
  };

  /// Chiede se ridurre le immagini oltre il loro peso massimo.
  const askReduce = (pictures: readonly Picture[], limits: readonly number[], room: boolean): Promise<boolean> => {
    const over = pictures.filter((picture, i) => picture.encoded.bytes.length > limits[i]!);
    const total = pictures.reduce((sum, picture) => sum + picture.encoded.bytes.length, 0);
    const budget = limits.reduce((sum, limit) => sum + limit, 0);
    let message: string;
    if (room) message = t("draw.image.room", { limit: sizeText(budget), size: sizeText(total) });
    else if (pictures.length === 1) message = t("draw.image.large", { size: sizeText(total), limit: sizeText(limits[0]!) });
    else message = t("draw.image.shared", { size: sizeText(total), limit: sizeText(budget) });
    return promptForm({
      title: plural(over.length, "draw.image.heavy.one", "draw.image.heavy.other"),
      message,
      fields: [],
      okLabel: t("draw.image.reduce"),
    }).then((answer) => answer !== null);
  };

  /// `files` sul foglio, in un gesto solo: al cursore se si vede, o al
  /// centro della vista, scelti, con lo strumento della selezione.
  async function addImages(files: readonly File[], at: Point | null): Promise<void> {
    if (asking || disposed || files.length === 0) return;
    if (!editable()) return;
    if (codec === null) {
      announce(t("draw.image.unreadable"));
      return;
    }
    finishText();
    asking = true;
    cancelGesture();
    const loaded = loads;
    const pictures: Picture[] = [];
    try {
      for (const file of files) {
        const picture = await pictureOf(file, codec);
        if (picture !== null) pictures.push(picture);
      }
      const gone = (): boolean => disposed || loads !== loaded || !editable();
      if (gone()) return;
      if (pictures.length === 0) {
        announce(t("draw.image.unreadable"));
        return;
      }
      const docBytes = utf8Length(engine.text);
      const budget = budgetFor(docBytes, pictures.length);
      if (budget < MIN_ROOM) {
        announce(t("draw.image.full", { limit: sizeText(MAX_EDIT_BYTES) }));
        return;
      }
      const limits = limitsFor(pictures.map((picture) => picture.encoded.bytes.length), budget);
      if (pictures.some((picture, i) => picture.encoded.bytes.length > limits[i]!)) {
        if (!(await askReduce(pictures, limits, budget < MAX_IMAGE_BYTES))) return;
        if (gone()) return;
        announce(t("draw.image.reducing"));
        for (const [i, picture] of pictures.entries()) {
          if (picture.encoded.bytes.length <= limits[i]!) continue;
          const reduced = await reduce(picture.decoded, limits[i]!);
          if (reduced === null) {
            announce(t("draw.image.failed"));
            return;
          }
          picture.encoded = reduced;
        }
        if (gone()) return;
      }
      placeImages(pictures, at);
    } finally {
      for (const picture of pictures) picture.decoded.close();
      asking = false;
    }
  }

  /// Le immagini nel livello che riceve, una sopra l'altra con uno scarto.
  const placeImages = (pictures: readonly Picture[], at: Point | null): void => {
    const ids = newIds();
    const to = target(ids);
    if (to === null) return;
    const view = viewBounds();
    const inView = at !== null && at[0] >= view.min[0] && at[0] <= view.max[0] && at[1] >= view.min[1] && at[1] <= view.max[1];
    const base: Point = inView ? at : [(view.min[0] + view.max[0]) / 2, (view.min[1] + view.max[1]) / 2];
    const distance = COPY_STEP_PX / camera.scale;
    const step = gridOn() ? wholeSteps(distance, grid.step) : distance;
    // La scala del livello: una unità della scena vale `1 / k` unità sue.
    const k = Math.sqrt(Math.abs(to.matrix[0] * to.matrix[3] - to.matrix[1] * to.matrix[2]));
    const ops: Op[] = [...to.prelude];
    const keys: string[] = [];
    const bounds = new BoundsBuilder();
    let hrefBytes = 0;
    pictures.forEach((picture, i) => {
      let box = placeImage(picture.decoded.width, picture.decoded.height, view, [base[0] + i * step, base[1] + i * step]);
      // Con l'aggancio, l'angolo in alto a sinistra va sull'incrocio più
      // vicino.
      if (gridOn()) box = translated(box, ...snapDelta(box.min, 0, 0, grid.step))!;
      const [cx, cy] = apply(to.inverse, [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2]);
      const w = (box.max[0] - box.min[0]) / k;
      const h = (box.max[1] - box.min[1]) / k;
      const id = ids.next("object");
      const elem = imageElem(id, dataUri(picture.encoded.type, picture.encoded.bytes), { min: [cx - w / 2, cy - h / 2], max: [cx + w / 2, cy + h / 2] });
      ops.push(addOp(to, elem));
      keys.push(id);
      hrefBytes += utf8Length(elem.attrs.href!);
      const extent = elemBounds(elem, to.matrix);
      if (extent !== null) {
        bounds.include(extent.min);
        bounds.include(extent.max);
      }
    });
    const page = pageFor(scene.root.page, bounds.finish());
    if (page !== null) ops.push({ op: "page", viewBox: page });
    // Il documento è cambiato mentre si decideva: deve restare modificabile.
    if (utf8Length(engine.text) + hrefBytes > MAX_EDIT_BYTES) {
      announce(t("draw.image.full", { limit: sizeText(MAX_EDIT_BYTES) }));
      return;
    }
    if (commit("draw.action.image", asGesture(ops)) === null) return;
    const switched = tool !== "select" && tools.some((spec) => spec.id === "select");
    if (switched) {
      tool = "select";
      syncControls();
    }
    select(keys);
    const added = plural(keys.length, "draw.added.image.one", "draw.added.image.other");
    const now = switched ? ` ${t("draw.announce.tool", { tool: t(toolSpec("select").label) })}` : "";
    announce(`${added}${now} ${objects()}`);
  };

  // Un incolla che porta immagini non va oltre; uno di solo testo, o in un
  // campo, segue la sua strada.
  life.listen(root, "paste", (event) => {
    const origin = event.target;
    if (origin instanceof Element && origin.closest("input, textarea, [contenteditable=true]")) return;
    const files = imageFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void addImages(files, cursor);
  });
  const onDragOver = (event: DragEvent): void => {
    if (!editable() || !carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
  };
  const onDrop = (event: DragEvent): void => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Un file lasciato qui non apre una pagina al posto della shell.
    event.preventDefault();
    if (!editable()) return;
    const files = imageFiles(event.dataTransfer);
    if (files.length === 0) {
      announce(t("draw.image.unreadable"));
      return;
    }
    const world = screenToWorld(camera, localPoint(event.clientX, event.clientY));
    void addImages(files, [world.x, world.y]);
  };
  // Anche sul campo del testo, che sta sopra il foglio: un'immagine lasciata
  // lì conclude il testo ed entra nel disegno.
  for (const target of [surface, textLayer]) {
    life.listen(target, "dragover", onDragOver);
    life.listen(target, "drop", onDrop);
  }

  /// Maiusc, Ctrl o ⌘ premuti o lasciati a metà gesto: la forma e lo
  /// spostamento si ridisegnano subito.
  const onModifiers = (event: KeyboardEvent): void => {
    if (event.key === "Shift") shift = event.type === "keydown";
    else if (event.key === "Control" || event.key === "Meta") free = event.ctrlKey || event.metaKey;
    else return;
    if (current?.kind === "shape") drawShape(current);
    else if (current?.kind === "select" && current.mode === "move") selectUpdate(current);
  };

  life.listen(root, "keyup", onModifiers);
  life.listen(root, "keydown", (event) => {
    onModifiers(event);
    if (event.defaultPrevented || event.target === titleInput || event.target === textInput) return;
    // Il pannello degli attributi tiene i suoi tasti: un `?` o un Canc
    // scritti in un valore restano lì, e un Canc sul pulsante che toglie un
    // attributo non toglie l'oggetto. Passano il tasto che lo chiude e, fuori
    // da un campo di testo, annulla e ripeti.
    if (event.target instanceof Node && inspector.element.contains(event.target)) {
      const key = event.key.toLowerCase();
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (!(mod && ((key === "x" && event.shiftKey) || (!field && (key === "z" || (key === "y" && !event.shiftKey)))))) return;
    }
    const onSurface = event.target === surface;
    if (onSurface && !event.altKey && arrows(event)) {
      event.preventDefault();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    // «#» e «%» valgono come si scrivono, anche con AltGr, che su Windows
    // arriva come Ctrl e Alt insieme.
    const altGraph = typeof event.getModifierState === "function" && event.getModifierState("AltGraph");
    if ((event.key === "#" || event.key === "%") && (altGraph || !mod) && reaches(level, "standard")) {
      if (event.key === "#") changeGrid({ ...grid, shown: !grid.shown });
      else changeGrid({ ...grid, snap: !grid.snap });
      event.preventDefault();
      return;
    }
    // I comandi della selezione prendono i loro tasti solo quando c'è una
    // selezione: senza, Ctrl+D e gli altri restano a chi li aveva.
    const arranges = reaches(level, "standard") && selection.length > 0 && editable();
    if (mod) {
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      // Le parentesi quadre per posizione, dove le ha una tastiera americana:
      // su quella italiana sono «è» e «+», che si premono senza AltGr.
      const bracket = event.code === "BracketRight" || key === "]" || key === "}" ? 1 : event.code === "BracketLeft" || key === "[" || key === "{" ? -1 : 0;
      if (key === "z") {
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y" && !event.shiftKey) {
        redo();
      } else if (key === "a" && !event.shiftKey) {
        select(currentIndex().units.map((unit) => unit.key));
        announceSelection();
      } else if (key === "x" && event.shiftKey && reaches(level, "expert")) {
        showAttributes(inspector.element.hidden);
      } else if (arranges && key === "d" && !event.shiftKey) {
        duplicateSelection();
      } else if (arranges && key === "g") {
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
      } else if (arranges && key === "k" && (event.shiftKey || options.links !== undefined)) {
        if (event.shiftKey) unlinkSelection();
        else void linkSelection();
      } else if (arranges && bracket !== 0) {
        if (bracket > 0) orderSelection(event.shiftKey ? "front" : "forward");
        else orderSelection(event.shiftKey ? "back" : "backward");
      } else {
        return;
      }
      event.preventDefault();
      return;
    }
    if (event.altKey) {
      if (onSurface && event.key === "Enter" && !event.shiftKey && options.links !== undefined) {
        if (pressed !== null) return;
        if (!openSelectedLink()) announce(t("draw.link.open.none"));
      } else if (event.key !== "F10" || event.shiftKey || !focusArrange()) {
        return;
      }
      event.preventDefault();
      return;
    }
    if (onSurface && event.key === "Tab") {
      if (!walk(event.shiftKey ? -1 : 1)) return;
    } else if (onSurface && arranges && (event.key === "PageUp" || event.key === "PageDown")) {
      if (pressed !== null) return;
      if (event.key === "PageUp") orderSelection(event.shiftKey ? "front" : "forward");
      else orderSelection(event.shiftKey ? "back" : "backward");
    } else if (onSurface && (event.key === "Home" || event.key === "End")) {
      if (pressed !== null || !visit(event.key === "Home" ? 0 : currentIndex().units.length - 1)) return;
    } else if (onSurface && event.key === " ") {
      if (event.repeat) {
        // Tenuto giù: un tasto, un passo.
      } else if (pressed === null && tool === "text") openText(cursorPoint(), "mouse");
      else if (pressed === null) press(event.timeStamp);
      else release();
    } else if (onSurface && event.key === "F2" && reaches(level, "standard")) {
      if (pressed !== null) return;
      editSelectedText();
    } else if (onSurface && event.key === "Enter") {
      if (pressed !== null) release();
      else void properties();
    } else if (event.key === "?") {
      void keys();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (selection.length === 0) return;
      deleteSelection();
    } else if (event.key === "Escape") {
      if (current !== null) cancelGesture();
      else if (selection.length > 0) {
        select([]);
        announceSelection();
      } else return;
    } else if (event.shiftKey && event.code === "Digit1") {
      fit();
    } else if (event.key === "+" || event.key === "=") {
      zoomBy(ZOOM_STEP);
    } else if (event.key === "-") {
      zoomBy(1 / ZOOM_STEP);
    } else if (event.key === "0") {
      zoomBy(1 / camera.scale);
    } else {
      const spec: ToolSpec | null = event.shiftKey ? null : toolForKey(tools, event.key);
      if (spec === null || !editable()) return;
      setTool(spec.id);
    }
    event.preventDefault();
  });

  // --- Vita ------------------------------------------------------------------

  const relabel = (): void => {
    for (const run of relabels) run();
  };
  relabel();
  life.add(onLanguage(relabel));
  setCamera(camera);
  refresh();

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    life.close();
    root.remove();
  };
  owner.add(dispose);

  return {
    element: root,
    get engine() {
      return engine;
    },
    get level() {
      return level;
    },
    get tool() {
      return tool;
    },
    get color() {
      return style().color;
    },
    get width() {
      return style().width;
    },
    get selection() {
      return selection;
    },
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },
    get grid() {
      return grid;
    },
    setGrid(next) {
      if (disposed) return;
      grid = checkedGrid(next, grid);
      showGrid();
    },
    setEngine(next) {
      if (disposed) return;
      if (next.model === null) throw new Error("documento in sola lettura: non si monta nell'editor");
      // Chi sposta o cancella guarda oggetti che il testo nuovo può non
      // avere più: il gesto si annulla. Tratto e forma si scrivono alla fine,
      // sul livello che c'è allora.
      if (current !== null && (current.kind === "select" || current.kind === "erase")) cancelGesture();
      engine = next;
      refresh();
    },
    load(next) {
      if (disposed) return;
      if (next.model === null) throw new Error("documento in sola lettura: non si monta nell'editor");
      cancelGesture();
      // Il testo in corso era del documento di prima.
      finishText(false);
      engine = next;
      loads++;
      history.clear();
      selection = [];
      chosen = null;
      cursor = null;
      cursorMark.hidden = true;
      refresh();
      placed = false;
      fit();
    },
    setReadOnly,
    reveal,
    adopt,
    setLevel,
    setTool,
    setColor,
    setWidth,
    select,
    deleteSelection,
    undo,
    redo,
    fit,
    focus() {
      surface.focus({ preventScroll: true });
    },
    dispose,
  };
}

/// Perché il motore ha rifiutato un gesto, detto a chi disegna.
const REASONS: Readonly<Record<Reason, DrawKey>> = {
  "missing-target": "draw.reason.missing_target",
  "missing-parent": "draw.reason.missing_parent",
  "missing-anchor": "draw.reason.missing_target",
  "duplicate-id": "draw.reason.duplicate_id",
  "invalid-elem": "draw.reason.invalid",
  locked: "draw.reason.locked",
  foreign: "draw.reason.foreign",
  cycle: "draw.reason.invalid",
  limit: "draw.reason.limit",
  "read-only": "draw.reason.read_only",
};

/// Le voci dell'ordine, dalla cima al fondo, con le loro scorciatoie.
const ORDERS: ReadonlyArray<{ readonly order: Order; readonly label: DrawKey; readonly binding: string }> = [
  { order: "front", label: "draw.order.front", binding: "Mod-Shift-]" },
  { order: "forward", label: "draw.order.forward", binding: "Mod-]" },
  { order: "backward", label: "draw.order.backward", binding: "Mod-[" },
  { order: "back", label: "draw.order.back", binding: "Mod-Shift-[" },
];

/// Che cosa si annuncia dopo un cambio d'ordine.
const ORDERED: Readonly<Record<Order, DrawKey>> = {
  front: "draw.ordered.front",
  forward: "draw.ordered.forward",
  backward: "draw.ordered.backward",
  back: "draw.ordered.back",
};

/// Le voci dell'allineamento: prima i bordi e il centro in orizzontale, poi
/// in verticale.
const EDGES: ReadonlyArray<{ readonly edge: Edge; readonly label: DrawKey }> = [
  { edge: "left", label: "draw.align.left" },
  { edge: "center", label: "draw.align.center" },
  { edge: "right", label: "draw.align.right" },
  { edge: "top", label: "draw.align.top" },
  { edge: "middle", label: "draw.align.middle" },
  { edge: "bottom", label: "draw.align.bottom" },
];

const AXES: ReadonlyArray<{ readonly axis: Axis; readonly label: DrawKey }> = [
  { axis: "x", label: "draw.distribute.x" },
  { axis: "y", label: "draw.distribute.y" },
];

/// Che cosa si annuncia quando una forma entra nel disegno.
const ADDED: Readonly<Record<ShapeTool, DrawKey>> = {
  rect: "draw.added.rect",
  ellipse: "draw.added.ellipse",
  line: "draw.added.line",
  arrow: "draw.added.arrow",
};
