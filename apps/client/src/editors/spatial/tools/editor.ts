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
// - **Righelli e guide.** Dal livello Standard i righelli stanno sui bordi
//   del foglio, nell'unità del documento (`fub:units`), e segnano la pagina,
//   la selezione e il puntatore (`rulers.ts`). Da un righello si tira una
//   guida, che entra nel file (`fub:guides`): con lo strumento Selezione la
//   si sposta, riportata su un righello se ne va, e ciò che si muove ci si
//   aggancia. «Guide…» le scrive coi numeri (`guide-dialog.ts`). L'unità
//   vale per i righelli, i campi, le misure e gli annunci; il disegno resta
//   in unità della scena.
// - **Immagini incollate.** Un'immagine incollata o trascinata sul foglio
//   entra nel file come data URI (`images.ts`): il disegno resta un file
//   solo. Oltre il peso massimo l'editor propone di ridurla.
// - **Immagini del vault.** Dal livello Standard Ctrl+I, o «Immagine dal
//   vault…», mette nel disegno un'immagine del vault che sceglie chi monta
//   l'editor: entra per riferimento, col percorso relativo al disegno, dove
//   entrerebbe incollata. Il foglio la mostra con l'URL che chi monta
//   l'editor apre (`images`).
// - **Testo.** Dal livello Standard lo strumento Testo scrive dove si tocca,
//   in un campo sopra il foglio, col carattere, il corpo, il colore e la
//   trasformazione del testo, così ciò che si scrive sta dove resterà
//   (`text.ts`). Lo stesso campo cambia un testo che c'è: col tocco dello
//   strumento, col doppio tocco della selezione, o con F2. Il testo si scrive
//   quando il campo si chiude, in un passo di annulla solo.
// - **Nodi.** Dal livello Esperto lo strumento Nodi modifica un tracciato
//   dell'oggetto scelto (`nodes.ts`): si trascinano un nodo coi suoi
//   compagni scelti, una maniglia o un punto di un segmento, e un riquadro
//   sceglie più nodi. Una barra in cima al foglio, al posto di quella della
//   selezione, aggiunge, elimina, cambia tipo, spezza e unisce, coi tasti di
//   Inkscape; Tab passa di nodo in nodo e le frecce spostano quelli scelti.
//   Ogni modifica riscrive il `d` intero, in un passo di annulla.
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
import { BoundsBuilder, parsePath, type Bounds } from "../scene/geometry";
import { apply, compose, IDENTITY, invert, translate, type Matrix, type Point } from "../scene/matrix";
import { elementChildren, pathOf, tagName, type LeafNode } from "../scene/model";
import { MAX_IMAGE_BYTES } from "../scene/analysis";
import { MAX_EDIT_BYTES, SVG_NS } from "../scene/read";
import { utf8Length } from "../scene/text";
import type { Applied, SceneEngine } from "../scene/engine";
import type { Role, Tool } from "../scene/analysis";
import type { Item } from "../scene/classify";
import { ROOT, type Op, type Reason } from "../scene/ops";
import { MAX_GUIDES, UNITS, writeGuides, type LengthUnit, type RulerGuide } from "../scene/rulers";
import { pathData, type Elem } from "../scene/serialize";
import { plural, t, type DrawKey } from "../strings";
import { createOverlay, type NodeShape, type OverlayHandle } from "../painter/overlay";
import { PaintBuilder, type PaintNode, type PaintScene } from "../painter/paint";
import { createSvgPainter } from "../painter/svg-dom";
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
  transformedMatrix,
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
  plainAttributes,
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
import { CAPS, DASHES, JOINS, lookOf as outlineLook, outlineOps, outlinesOf, type Cap, type Dash, type Join, type OutlineChange } from "./outline";
import { boundsAfter, numericMatrix, numericOps } from "./transform";
import {
  angleOf,
  FRAME_PX,
  frameCenter,
  frameGuides,
  frameSize,
  frameView,
  gridSnap,
  gripAt,
  gripCursor,
  isCorner,
  MAGNET_DEGREES,
  movedFrame,
  normalized,
  pull,
  resized,
  resizeMatrix,
  rotation,
  rotationMatrix,
  upright,
  type Axis as FrameAxis,
  type Frame,
  type FrameView,
  type Grip,
  type GripCursor,
} from "./frame";
import {
  anchorsOf,
  GUIDE_PX,
  GuideIndex,
  measure as measureBetween,
  nearer,
  ON_GUIDE,
  type Edge as GuideEdge,
  type GuideLine,
  type GuideTarget,
  type Spacing,
} from "./guides";
import { applyOps } from "./apply";
import { pathOps } from "./topath";
import type { BooleanKind } from "./boolean";
import { combineOps, isShape, type Refused } from "./combine";
import {
  bend,
  breakNodes,
  deleteNodes,
  handleAt,
  handleNode,
  handlePoint,
  handlesFor,
  insertNode,
  insertNodes,
  joinNodes,
  kindOf,
  linkAt,
  moveHandle,
  moveNodes,
  nodeAt,
  nodeKey,
  nodesWithin,
  parseKey,
  readNodes,
  samePlace,
  setKind,
  setLinks,
  writeNodes,
  type HandleRef,
  type KindOf,
  type NodeKey,
  type NodeKind,
  type Subpath,
} from "./nodes";
import { collapsed, penKind, penNode, penPath, type PenNode } from "./bezier";
import {
  DEFAULT_GRID,
  GRID_MAJOR,
  gridLines,
  gridStep,
  lineBeyond,
  nearestCorner,
  sameStep,
  snapDelta,
  snapPoint,
  snapValue,
  unitSteps,
  validStep,
  validSteps,
  wholeSteps,
  withStep,
  type Grid,
} from "./grid";
import { guideDialog, unitSuffix } from "./guide-dialog";
import { createGuideLines, createRulers, fieldMin, fieldText, fromUnit, GUIDE_HIT_PX, guideAt, RULER_PX, toUnit, UNIT_PLACES } from "./rulers";
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
import {
  CUSTOM_DEFAULT,
  featuresFor,
  levelsAbove,
  startTool,
  toolForKey,
  TOOLS,
  toolsOf,
  toolSpec,
  type Feature,
  type Level,
  type ToolId,
  type ToolSpec,
} from "./registry";
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

/// Le immagini del vault, da chi monta l'editor: chi le apre, chi ne legge i
/// byte e chi ne sceglie una da inserire. Senza, ogni immagine del vault è un
/// segnaposto e l'editor non ne inserisce.
export interface DrawImages {
  /// L'URL dell'immagine `href`, com'è scritto nel disegno, aperto nella vita
  /// che riceve; `null` se non si risolve.
  url(href: string, life: Lifetime): Promise<string | null>;
  /// I byte dell'immagine `href`; `null` se non si risolve.
  read(href: string): Promise<Blob | null>;
  /// Chiede l'immagine del vault da inserire; torna l'`href` da scrivere,
  /// relativo al disegno, o `null` se chi disegna rinuncia. Senza, l'editor
  /// non ne inserisce.
  choose?(): Promise<string | null>;
}

export interface DrawEditorOptions {
  /// Il livello degli strumenti (default `essential`); cambia con
  /// `setLevel`.
  readonly level?: Level;
  /// Le parti del livello Personalizzato, per nome (default quelle
  /// dell'Essenziale): un nome che l'editor non conosce non conta.
  readonly custom?: readonly string[];
  readonly images?: DrawImages;
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
  /// Le parti che il livello di adesso offre.
  readonly features: ReadonlySet<Feature>;
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
  /// Un altro livello, dal vivo, e le parti del Personalizzato (default
  /// quelle di prima): la barra e i tasti cambiano, il documento e la
  /// cronologia restano. Uno strumento che il livello non ha più torna alla
  /// penna, o al primo che c'è, e un colore personalizzato al nero.
  setLevel(level: Level, custom?: readonly string[]): void;
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

const ZOOM_STEP = 1.25;

/// La lettera dei pulsanti delle dimensioni del testo, in pixel.
const SIZE_GLYPH_PX: readonly number[] = [12, 16, 22];
const FIT_PAD = 0.08;

/// Di quanto le frecce spostano o ridimensionano la selezione, in unità
/// della scena.
const NUDGE = 1;
const NUDGE_SHIFT = 10;

/// La misura più piccola a cui le frecce, o la cornice, riducono un lato
/// della selezione.
const MIN_SIZE = 1;

/// Il passo di `[` e `]`, e della rotazione con Maiusc, in gradi; con Maiusc
/// i tasti girano di un angolo retto.
const ROTATE_STEP = 15;
const ROTATE_STEP_SHIFT = 90;

/// Gli oggetti che la cornice ridimensiona dagli angoli tenendo le
/// proporzioni, se Maiusc non dice il contrario: deformati, non sono più
/// loro.
const RATIO_ROLES: ReadonlySet<Role> = new Set<Role>(["group", "link", "stroke", "text", "image"]);

/// Di quanto il segno di un collegamento scelto si scosta, in pixel CSS, in
/// alto e a destra: oltre la maniglia d'angolo, che sporge di 4 dalla cornice.
const MARK_CLEAR_PX = FRAME_PX + 4;

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
  custom: "draw.level.custom",
};

/// Le parti che hanno un pulsante nella barra della selezione.
const BAR_FEATURES: readonly Feature[] = ["text", "arrange", "links", "layers", "transform", "apply", "path", "boolean", "outline"];

/// Il tasto che mostra e nasconde gli attributi, dal livello Esperto: lo
/// stesso dell'editor XML di Inkscape.
const ATTRIBUTES_BINDING = "Mod-Shift-x";

/// «Trasforma», dal livello Esperto: lo stesso tasto della finestra di
/// Inkscape.
const TRANSFORM_BINDING = "Mod-Shift-m";

/// «Immagine dal vault…», dal livello Standard: il tasto con cui Inkscape
/// importa.
const IMAGE_BINDING = "Mod-i";

/// I limiti dei campi di «Trasforma»: una scala fino a mille volte, e
/// un'inclinazione che non arriva all'angolo retto, dove non ha misura.
const MAX_SCALE_PERCENT = 100_000;
const MAX_SKEW = 89;

/// Lo scarto di una copia dal suo originale, e fra due immagini incollate
/// insieme, in pixel dello schermo: si vedono tutte, a ogni zoom.
const COPY_STEP_PX = 24;

const INK_KEY = "pen";

/// Due tocchi sullo stesso testo entro questo tempo, in millisecondi, e
/// questa distanza, in pixel, lo aprono: un doppio tocco come quello di un
/// mouse, che vale anche per la penna e il dito.
const DOUBLE_TAP_MS = 500;
const DOUBLE_TAP_PX: Readonly<Record<InkPointerType, number>> = { pen: 8, mouse: 6, touch: 16 };

/// Quanto lontano da un nodo o da una maniglia un tocco li prende ancora, in
/// pixel: un bersaglio largo almeno 24 pixel (WCAG 2.5.8), di più per il
/// dito. Fra due vicini vince il più vicino.
const NODE_PX: Readonly<Record<InkPointerType, number>> = { pen: 12, mouse: 12, touch: 20 };

/// La forma di un nodo, per tipo, come la disegna lo strato sopra.
const NODE_SHAPES: Readonly<Record<NodeKind, NodeShape>> = { corner: "diamond", smooth: "square", symmetric: "circle" };

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
  "draw-image": ["M3 5h18v14H3z", "M3 17l5-5 5 5", "M11 15l4-4 6 6", "M14.5 8.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"],
  "draw-text-edit": ["M3 6V4h11v2", "M8.5 4v15", "M6 19h5", "M18 8v12", "M16 8h4", "M16 20h4"],
  "draw-link": ["M9.5 14.5l5-5", "M11 6.5l1.5-1.5a3.5 3.5 0 0 1 5 5L16 11.5", "M8 12.5L6.5 14a3.5 3.5 0 0 0 5 5L13 17.5"],
  "draw-unlink": ["M11 6.5l1.5-1.5a3.5 3.5 0 0 1 5 5L16 11.5", "M8 12.5L6.5 14a3.5 3.5 0 0 0 5 5L13 17.5", "M4 8h2.5", "M8 4v2.5", "M20 16h-2.5", "M16 20v-2.5"],
  "draw-open-link": ["M14 4h6v6", "M20 4l-9 9", "M18 14v6H4V6h6"],
  "draw-attributes": ["M8 7l-5 5 5 5", "M16 7l5 5-5 5", "M13.5 5l-3 14"],
  "draw-outline": ["M3 6h18", "M3 12h4", "M10 12h4", "M17 12h4", "M3.5 18h0", "M8.5 18h0", "M13.5 18h0", "M18.5 18h0"],
  "draw-transform": ["M4 10h10v10H4z", "M10 4a10 10 0 0 1 10 10", "M16.5 11.5L20 14l2.5-3.5"],
  "draw-apply-transform": ["M2 17L6 5h9l-4 12z", "M15 16.5l2.5 2.5L22 14"],
  "draw-to-path": ["M5 19C5 11 11 5 19 5", "M3 17h4v4H3z", "M17 3h4v4h-4z"],
  "draw-boolean": ["M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0", "M7 14a7 7 0 1 0 14 0a7 7 0 1 0-14 0"],
  "draw-nodes": ["M4 3v12l3.2-3.1 2.3 5.1 2-.9-2.3-5H15z", "M16 16h5v5h-5z"],
  "draw-bezier": ["M12 21L7 12l3-8h4l3 8z", "M12 21v-7.5", "M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"],
  "draw-node-add": ["M3 19c4-6 14-6 18 0", "M10.5 13h3v3h-3z", "M12 3v6", "M9 6h6"],
  "draw-node-delete": ["M3 19c4-6 14-6 18 0", "M10.5 13h3v3h-3z", "M9 6h6"],
  "draw-node-corner": ["M3 20l9-13 9 13", "M12 4l3 3-3 3-3-3z"],
  "draw-node-smooth": ["M3 20C3 13 7 8 12 8s9 5 9 12", "M10.5 6.5h3v3h-3z", "M7 8h3.5", "M13.5 8H20"],
  "draw-node-symmetric": ["M3 20C3 13 7 8 12 8s9 5 9 12", "M10.5 8a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0", "M5 8h5.5", "M13.5 8H19"],
  "draw-segment-line": ["M3 17h4v4H3z", "M17 3h4v4h-4z", "M7 17L17 7"],
  "draw-segment-curve": ["M3 17h4v4H3z", "M17 3h4v4h-4z", "M7 19c7 0 12-5 12-12"],
  "draw-node-break": ["M2 12h6", "M16 12h6", "M8 10h3v4H8z", "M13 10h3v4h-3z"],
  "draw-node-join": ["M2 12h4", "M18 12h4", "M10.5 10.5h3v3h-3z", "M6 9l3 3-3 3", "M18 9l-3 3 3 3"],
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
type Gesture = InkGesture | ShapeGesture | SelectGesture | NodesGesture | BezierGesture | EraseGesture | TextGesture | GuideGesture | RefusedGesture;

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
  /// `pending` finché un tocco su un oggetto, o su una maniglia della
  /// cornice, non diventa trascinamento.
  mode: "pending" | "move" | "marquee" | "resize" | "rotate";
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
  /// La maniglia della cornice presa, con la cornice di allora.
  grip: { readonly grip: Grip; readonly frame: Frame } | null;
  /// La trasformazione della scena che la cornice mostra, e i gradi della
  /// rotazione.
  matrix: Matrix | null;
  angle: number;
}

/// Che cosa ha preso il primo punto di un gesto dei nodi: un nodo, una
/// maniglia, un punto di un segmento, il vuoto per un riquadro, o niente da
/// trascinare. `origin` è dov'era il punto preso, nella scena.
type NodeGrab =
  | { readonly kind: "node"; readonly key: NodeKey; readonly origin: Point; readonly toggle: boolean; readonly only: boolean }
  | { readonly kind: "handle"; readonly handle: HandleRef; readonly origin: Point }
  | { readonly kind: "segment"; readonly sub: number; readonly link: number; readonly t: number }
  /// Un riquadro sceglie nodi, o oggetti se non c'è un tracciato da
  /// modificare; con Maiusc aggiunge a quelli scelti.
  | { readonly kind: "marquee"; readonly objects: boolean; readonly additive: boolean }
  | { readonly kind: "none" };

/// Un gesto dello strumento Nodi.
interface NodesGesture extends GestureBase {
  readonly kind: "nodes";
  from: Point | null;
  end: Point | null;
  grab: NodeGrab | null;
  /// Oltre la soglia del trascinamento.
  dragging: boolean;
  /// I nodi scelti e la selezione di prima, che un gesto annullato
  /// ripristina; per il riquadro, ciò che Maiusc conserva.
  readonly nodes: ReadonlySet<NodeKey>;
  readonly selection: readonly string[];
  /// I nodi come li lascia il trascinamento, da scrivere quando si alza.
  draft: readonly Subpath[] | null;
}

/// Un gesto della penna di Bézier: aggiunge un nodo, chiude il tracciato sul
/// primo nodo, o prende l'ultimo, che un tocco conclude e un trascinamento
/// ne cambia la maniglia d'uscita.
interface BezierGesture extends GestureBase {
  readonly kind: "bezier";
  readonly to: Destination;
  mode: "add" | "close" | "last" | null;
  /// Dove è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// Il nodo che il gesto mette o prende.
  at: Point | null;
  /// Oltre la soglia del trascinamento.
  dragging: boolean;
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

/// Un passo della penna di Bézier: i nodi di prima, o di dopo per un passo
/// annullato, e che cosa ha fatto a quale nodo, per dirlo.
interface DraftStep {
  readonly nodes: readonly PenNode[];
  readonly label: DrawKey;
  readonly index: number;
}

/// Il tracciato della penna di Bézier, finché non si conclude.
interface Drafting {
  nodes: readonly PenNode[];
  readonly done: DraftStep[];
  readonly undone: DraftStep[];
  /// Il livello dell'ultimo gesto, per l'anteprima fra un gesto e l'altro.
  to: Destination;
}

/// Il tracciato di cui lo strumento Nodi modifica i nodi: uno solo, dentro
/// l'oggetto scelto o l'oggetto stesso.
interface Editing {
  readonly unit: Unit;
  /// L'elemento `path`, e il suo percorso nel modello.
  readonly leaf: LeafNode;
  readonly path: readonly number[];
  /// Il `d` letto, e i nodi che ne vengono.
  readonly d: string;
  readonly subs: readonly Subpath[];
  /// Dalle coordinate del tracciato a quelle della scena, e ritorno.
  readonly matrix: Matrix;
  readonly inverse: Matrix;
  /// Ciò che il painter disegna per lui.
  readonly paints: readonly PaintNode[];
}

/// Un gesto che non scrive: il documento non si modifica, o nessun livello
/// lo riceve.
interface RefusedGesture extends GestureBase {
  readonly kind: "refused";
}

/// Un gesto su una guida del documento: una nuova, tirata da un righello, o
/// una che c'è, presa sul foglio con lo strumento Selezione.
interface GuideGesture extends GestureBase {
  readonly kind: "guide";
  /// `x` per una guida verticale, che sta su un valore di x; `y` per una
  /// orizzontale.
  readonly axis: "x" | "y";
  /// Il posto della guida presa fra quelle del documento; `null` per una
  /// nuova.
  readonly index: number | null;
  /// Dov'è sceso il puntatore, in pixel del foglio.
  readonly from: Point;
  /// Lo scarto, nella scena, fra la guida e il punto preso: la guida non
  /// salta sotto il puntatore.
  readonly offset: number;
  /// Dove sta la guida adesso, nella scena.
  at: number;
  /// Il puntatore è sopra un righello o fuori dal foglio: rilasciata lì, una
  /// guida nuova non entra e una che c'era se ne va.
  away: boolean;
  /// Il puntatore si è mosso oltre la soglia del trascinamento: un tocco
  /// fermo non sposta niente.
  moved: boolean;
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

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((at, i) => at === b[i]);
}

/// Vero se `a` e `b` hanno gli stessi sottotracciati con gli stessi nodi:
/// le chiavi dei nodi valgono per tutti e due.
function sameNodes(a: readonly Subpath[], b: readonly Subpath[]): boolean {
  return a.length === b.length && a.every((sub, s) => sub.nodes.length === b[s]!.nodes.length && sub.closed === b[s]!.closed);
}

/// Vero se il nodo `at` ha un segmento da tutti e due i lati: solo lui ha un
/// tipo, e si spezza.
function innerNode(sub: Subpath, at: number): boolean {
  return sub.closed ? sub.nodes.length > 1 : at > 0 && at < sub.nodes.length - 1;
}

/// I nodi di `subs`, in ordine.
function allNodes(subs: readonly Subpath[]): NodeKey[] {
  return subs.flatMap((sub, s) => sub.nodes.map((_, at) => nodeKey(s, at)));
}

/// I nodi di `keys` che `subs` ha.
function presentNodes(subs: readonly Subpath[], keys: Iterable<NodeKey>): NodeKey[] {
  return [...keys].filter((key) => {
    const [s, at] = parseKey(key);
    return subs[s]?.nodes[at] !== undefined;
  });
}

/// I tipi dati ai nodi, portati dove una modifica porta i nodi.
function remapped(kinds: ReadonlyMap<NodeKey, NodeKind>, moved: ReadonlyMap<NodeKey, NodeKey>): Map<NodeKey, NodeKind> {
  const out = new Map<NodeKey, NodeKind>();
  for (const [key, kind] of kinds) {
    const to = moved.get(key);
    if (to !== undefined) out.set(to, kind);
  }
  return out;
}

/// I segmenti fra due nodi scelti: se ce n'è uno, se uno non è una linea, e
/// se uno non è una cubica.
function linksBetween(subs: readonly Subpath[], selected: ReadonlySet<NodeKey>): { readonly any: boolean; readonly toLine: boolean; readonly toCurve: boolean } {
  let any = false;
  let toLine = false;
  let toCurve = false;
  subs.forEach((sub, s) => {
    sub.links.forEach((link, i) => {
      const end = (i + 1) % sub.nodes.length;
      if (end === i || !selected.has(nodeKey(s, i)) || !selected.has(nodeKey(s, end))) return;
      any = true;
      if (link.kind !== "line") toLine = true;
      if (link.kind !== "cubic") toCurve = true;
    });
  });
  return { any, toLine, toCurve };
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

/// `next` come griglia, col passo di `before` se il suo è fuori dai limiti,
/// e i passi delle altre unità che la griglia accetta.
function checkedGrid(next: Grid, before: Grid): Grid {
  const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
  return {
    shown: next.shown,
    snap: next.snap,
    step: validStep(next.step) ? next.step : before.step,
    steps: typeof next.steps === "object" && next.steps !== null ? validSteps(next.steps) : before.steps,
    guides: flag(next.guides, before.guides),
    rulers: flag(next.rulers, before.rulers),
    rulerGuides: flag(next.rulerGuides, before.rulerGuides),
  };
}

/// Il nome di ogni unità, come lo dicono i menu.
const UNIT_NAMES: Readonly<Record<LengthUnit, DrawKey>> = {
  px: "draw.unit.px",
  mm: "draw.unit.mm",
  cm: "draw.unit.cm",
  in: "draw.unit.in",
  pt: "draw.unit.pt",
};

/// Le unità come le conosce `Intl`, che le scrive e le dice nella lingua di
/// adesso; il punto tipografico non è fra le sue.
const INTL_UNITS: Readonly<Record<LengthUnit, string | null>> = { px: null, mm: "millimeter", cm: "centimeter", in: "inch", pt: null };

/// Il tasto che mostra e nasconde i righelli: Ctrl+R, quello dei programmi di
/// disegno, ricarica la pagina nel browser.
const RULERS_BINDING = "Shift-r";

/// Ciò che si dice quando il documento cambia unità.
const UNITS_NOW: Readonly<Record<LengthUnit, DrawKey>> = {
  px: "draw.units.now.px",
  mm: "draw.units.now.mm",
  cm: "draw.units.now.cm",
  in: "draw.units.now.in",
  pt: "draw.units.now.pt",
};

/// Ciò che le guide intelligenti mostrano: le linee su cui sta ciò che si
/// muove, e le distanze uguali.
interface GuideView {
  readonly lines: readonly GuideLine[];
  readonly spacings: readonly Spacing[];
}

/// I nomi dei bordi e dei centri da dire, per asse.
const EDGE_NAMES: readonly [Readonly<Record<GuideEdge, DrawKey>>, Readonly<Record<GuideEdge, DrawKey>>] = [
  { min: "draw.guides.edge.left", mid: "draw.guides.edge.center_x", max: "draw.guides.edge.right", point: "draw.guides.edge.point" },
  { min: "draw.guides.edge.top", mid: "draw.guides.edge.center_y", max: "draw.guides.edge.bottom", point: "draw.guides.edge.point" },
];

/// Il verso di una freccia su un asse.
function sign(value: number): 1 | -1 {
  return value < 0 ? -1 : 1;
}

/// Monta l'editor dentro `host`.
export function createDrawEditor(host: HTMLElement, initial: SceneEngine, owner: Lifetime, options: DrawEditorOptions = {}): DrawEditor {
  ensureIcons();
  const life = openLifetime();
  let level: Level = options.level ?? "essential";
  /// Le parti scelte per il Personalizzato, anche mentre il livello è un
  /// altro: tornando al Personalizzato valgono di nuovo.
  let picked: readonly string[] = options.custom ?? CUSTOM_DEFAULT;
  let features = featuresFor(level, picked);
  let tools = toolsOf(features);
  /// Vero se il livello di adesso offre `feature`.
  const has = (feature: Feature): boolean => features.has(feature);
  const relabels: Array<() => void> = [];

  let engine = initial;
  let tool: ToolId = startTool(tools);
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
  /// Alt tenuto: durante un gesto del puntatore la cornice scala dal centro;
  /// senza gesto, con una selezione, le guide misurano.
  let alt = false;
  /// La cornice di più oggetti dopo che la si è ruotata, ridimensionata o
  /// spostata: resta com'è diventata finché la selezione e il disegno non
  /// cambiano per altro. Una rotazione dopo l'altra gira così sempre
  /// attorno allo stesso centro.
  let kept: { readonly index: SceneIndex; readonly keys: string; readonly frame: Frame } | null = null;
  /// Il testo che si sta scrivendo nel campo sopra il foglio.
  let typing: Typing | null = null;
  /// Il puntatore è sceso sul foglio mentre si scriveva: quel tocco chiude il
  /// testo, e lo strumento Testo non ne apre un altro.
  let closedTyping = false;
  /// L'ultimo tocco della selezione su un oggetto, per il doppio tocco.
  let lastTap: { readonly key: string; readonly time: number; readonly at: Point } | null = null;
  /// Lo strumento Nodi: il tracciato che modifica, o perché l'oggetto
  /// scelto non ne ha uno; i nodi scelti; il tipo che chi modifica ha dato
  /// a un nodo, che il file non scrive e che vale finché il tracciato ha gli
  /// stessi nodi; e la forma toccata per ultima dentro un gruppo, col suo
  /// percorso nel modello.
  let editing: Editing | null = null;
  let noEditing: DrawKey | null = null;
  let nodeSelection: ReadonlySet<NodeKey> = new Set();
  let nodeKinds: ReadonlyMap<NodeKey, NodeKind> = new Map();
  let preferredShape: readonly number[] | null = null;
  /// Ciò con cui il tracciato è stato trovato: cambiato, lo si ritrova.
  let resolvedFor: {
    readonly index: SceneIndex;
    readonly keys: string;
    readonly tool: ToolId;
    readonly features: ReadonlySet<Feature>;
    readonly editable: boolean;
    readonly preferred: readonly number[] | null;
  } | null = null;
  /// L'ultimo tocco su un segmento, per il doppio tocco che aggiunge un nodo.
  let lastSegmentTap: { readonly sub: number; readonly link: number; readonly time: number; readonly at: Point } | null = null;
  /// Il tracciato che la penna di Bézier sta disegnando: i nodi nella scena,
  /// i passi fatti e quelli annullati, che Annulla e Ripeti percorrono, gli
  /// id e il livello dell'anteprima. Si scrive quando si conclude, sul
  /// livello di allora.
  let drafting: Drafting | null = null;
  /// Il puntatore sopra il foglio, senza premere, o il cursore mentre la
  /// penna di Bézier disegna: lì va il segmento che verrebbe.
  let hover: { readonly at: Point; readonly pointer: InkPointerType } | null = null;
  /// Dov'è sceso l'ultimo puntatore, in pixel del foglio: un gesto che parte
  /// su un righello o su una guida è loro.
  let downAt: Point | null = null;
  /// La guida del documento sotto il puntatore che passa, che si accende.
  let hotGuide: number | null = null;
  /// L'ultimo tocco su una guida, per il doppio tocco che apre «Guide».
  let lastGuideTap: { readonly index: number; readonly time: number; readonly at: Point } | null = null;
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
  /// selezione, quando il livello ne ha.
  const showSurfaceHint = (): void => {
    surfaceHint.textContent = t(BAR_FEATURES.some(has) ? "draw.surface.hint.arrange" : "draw.surface.hint");
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

  // Le immagini del vault, dal livello Standard e se chi monta l'editor le
  // sa scegliere: un pulsante accanto agli strumenti, che apre la scelta.
  const insertGroup = group("draw.insert", false);
  const imageButton = button(insertGroup, "draw-button", () => t("draw.image.vault"), "draw-image", () => void vaultImage());
  imageButton.setAttribute("aria-haspopup", "dialog");
  imageButton.setAttribute("aria-keyshortcuts", ariaBinding(IMAGE_BINDING));
  relabels.push(() => {
    imageButton.title = `${t("draw.image.vault")} (${displayBinding(IMAGE_BINDING)})`;
  });

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
  /// I pulsanti della barra: se nessuno si vede, la barra non c'è.
  const arrangeButtons: HTMLButtonElement[] = [];
  /// Un pulsante della barra; il nome è una chiave, o una funzione per quelli
  /// che cambiano nome con la selezione.
  const arrangeButton = (label: DrawKey | (() => string), iconName: string, binding: string | null, run: () => void): HTMLButtonElement => {
    const text = typeof label === "function" ? label : () => t(label);
    const control = button(arrangeBar, "draw-button", text, iconName, run);
    arrangeButtons.push(control);
    // Un tasto senza modificatori, come F2, si scrive com'è.
    if (binding !== null) control.setAttribute("aria-keyshortcuts", ariaBinding(binding) || binding);
    relabels.push(() => nameArrange(control, text(), binding));
    return control;
  };
  // Un testo scelto da solo si cambia sul posto.
  const textButton = arrangeButton("draw.text.edit", "draw-text-edit", "F2", () => editSelectedText());
  const duplicateButton = arrangeButton("draw.duplicate", "draw-duplicate", "Mod-d", () => duplicateSelection());
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
  // Dal livello Esperto: ruotare, scalare e inclinare di quanto si scrive.
  const transformButton = arrangeButton("draw.transform", "draw-transform", TRANSFORM_BINDING, () => void transformDialog());
  transformButton.setAttribute("aria-haspopup", "dialog");
  // Dal livello Esperto: la trasformazione passa nella geometria.
  const applyButton = arrangeButton("draw.apply_transform", "draw-apply-transform", null, () => applySelection());
  const pathButton = arrangeButton("draw.to_path", "draw-to-path", null, () => traceSelection());
  // Dal livello Esperto: unione, differenza, intersezione, esclusione e
  // divisione, in un menu.
  const booleanButton = arrangeButton("draw.boolean", "draw-boolean", null, () => openMenu(booleanButton, booleanItems()));
  // Dal livello Esperto: tratteggio, estremi e angoli dei contorni scelti.
  const outlineButton = arrangeButton("draw.outline", "draw-outline", null, () => openMenu(outlineButton, outlineItems()));
  for (const control of [orderButton, intoButton, alignButton, booleanButton, outlineButton]) {
    control.setAttribute("aria-haspopup", "menu");
    control.setAttribute("aria-expanded", "false");
  }
  // I comandi dei nodi, dal livello Esperto: con lo strumento Nodi e un
  // tracciato da modificare prendono il posto di quelli della selezione,
  // con le scorciatoie di Inkscape.
  const nodesBar = document.createElement("div");
  nodesBar.className = "draw-arrange";
  nodesBar.setAttribute("role", "toolbar");
  nodesBar.hidden = true;
  relabels.push(() => nodesBar.setAttribute("aria-label", t("draw.nodes.bar")));
  const nodesButton = (label: DrawKey, iconName: string, binding: string, run: () => void): HTMLButtonElement => {
    const control = button(nodesBar, "draw-button", () => t(label), iconName, run);
    control.setAttribute("aria-keyshortcuts", ariaBinding(binding) || binding);
    relabels.push(() => nameArrange(control, t(label), binding));
    return control;
  };
  const insertNodesButton = nodesButton("draw.nodes.insert", "draw-node-add", "Insert", () => insertSelectedNodes());
  const deleteNodesButton = nodesButton("draw.nodes.delete", "draw-node-delete", "Delete", () => deleteSelectedNodes());
  const cornerButton = nodesButton("draw.nodes.corner", "draw-node-corner", "Shift-c", () => kindSelectedNodes("corner"));
  const smoothButton = nodesButton("draw.nodes.smooth", "draw-node-smooth", "Shift-s", () => kindSelectedNodes("smooth"));
  const symmetricButton = nodesButton("draw.nodes.symmetric", "draw-node-symmetric", "Shift-y", () => kindSelectedNodes("symmetric"));
  const linesButton = nodesButton("draw.nodes.line", "draw-segment-line", "Shift-l", () => linkSelectedNodes("line"));
  const curvesButton = nodesButton("draw.nodes.curve", "draw-segment-curve", "Shift-u", () => linkSelectedNodes("curve"));
  const breakButton = nodesButton("draw.nodes.break", "draw-node-break", "Shift-b", () => breakSelectedNodes());
  const joinButton = nodesButton("draw.nodes.join", "draw-node-join", "Shift-j", () => joinSelectedNodes());
  // Esc in una barra torna al foglio, con la selezione com'era.
  for (const bar of [arrangeBar, nodesBar]) {
    life.listen(bar, "keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      surface.focus({ preventScroll: true });
    });
  }

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
  stage.append(surface, linkLayer, textLayer, arrangeBar, nodesBar);
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
  const images = options.images;
  const painter = createSvgPainter(surface, life, images === undefined ? {} : { images: (href, owner) => images.url(href, owner) });
  const preview = document.createElementNS(SVG_NS, "svg");
  preview.setAttribute("class", "draw-preview");
  preview.setAttribute("aria-hidden", "true");
  const previewCamera = document.createElementNS(SVG_NS, "g");
  const previewLayer = document.createElementNS(SVG_NS, "g");
  previewCamera.append(previewLayer);
  preview.append(previewCamera);
  surface.append(preview);
  // Le guide del documento: sopra il disegno, sotto le maniglie.
  const guideLines = createGuideLines(surface);
  const overlay = createOverlay(surface, life);
  // Il cursore del foglio: si vede quando lo muove la tastiera.
  const cursorMark = document.createElement("div");
  cursorMark.className = "draw-cursor";
  cursorMark.setAttribute("aria-hidden", "true");
  cursorMark.hidden = true;
  surface.append(cursorMark);
  // I righelli, per ultimi: coprono i bordi in alto e a sinistra, sopra ogni
  // cosa. Le tacche hanno i numeri della lingua di adesso.
  const tickFormats = new Map<number, Intl.NumberFormat>();
  const tickText = (value: number, places: number): string => {
    let format = tickFormats.get(places);
    if (format === undefined) {
      format = new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: places, useGrouping: false });
      tickFormats.set(places, format);
    }
    return format.format(value);
  };
  const rulers = createRulers(surface, tickText, (unit) => unit);

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

  /// La griglia sullo schermo, se il livello la offre e la si vuole vedere.
  const showGrid = (): void => {
    const shown = has("grid") && grid.shown;
    gridMark.style.display = shown ? "" : "none";
    if (!shown) return;
    const lines = gridLines(camera, surface.clientWidth, surface.clientHeight, stepNow());
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
    showGuideLines();
    showZoom();
    showCursor();
    placeText();
    // Le cornici hanno un margine e le maniglie una misura sullo schermo; i
    // righelli seguono la cornice.
    showHandles();
  };
  /// Il formato delle coordinate dette a voce, nella lingua di adesso.
  let coordinates: Intl.NumberFormat | null = null;
  const numberText = (value: number): string =>
    (coordinates ??= new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: 1 })).format(Math.round(value * 10) / 10 || 0);
  relabels.push(() => {
    percent = null;
    coordinates = null;
    unitFormats = null;
    tickFormats.clear();
    showZoom(true);
    // Le tacche si riscrivono coi numeri della lingua nuova.
    if (rulersShown()) {
      rulers.show(null);
      showRulers();
    }
  });

  // --- L'unità del documento ----------------------------------------------------
  //
  // La scena misura in pixel; il documento dice in che unità si legge
  // (`fub:units`). Righelli, campi, misure e annunci la usano; il disegno, i
  // suoi spessori e i corpi del testo non cambiano.

  /// L'unità del documento di adesso.
  const docUnit = (): LengthUnit => scene.root.units;

  /// Il passo della griglia per il documento di adesso, in unità della scena:
  /// ogni unità ricorda il suo.
  const stepNow = (): number => gridStep(grid, docUnit());

  /// I formati dell'unità di adesso, nella lingua di adesso: il numero solo,
  /// e con l'unità scritta corta e per intero.
  let unitFormats: {
    readonly unit: LengthUnit;
    readonly plain: Intl.NumberFormat;
    readonly short: Intl.NumberFormat | null;
    readonly long: Intl.NumberFormat | null;
  } | null = null;
  const formatsNow = (): NonNullable<typeof unitFormats> => {
    const unit = docUnit();
    if (unitFormats?.unit !== unit) {
      const language = resolvedLanguage();
      const digits = { maximumFractionDigits: UNIT_PLACES[unit] };
      const intl = INTL_UNITS[unit];
      unitFormats = {
        unit,
        plain: new Intl.NumberFormat(language, digits),
        short: intl === null ? null : new Intl.NumberFormat(language, { ...digits, style: "unit", unit: intl, unitDisplay: "short" }),
        long: intl === null ? null : new Intl.NumberFormat(language, { ...digits, style: "unit", unit: intl, unitDisplay: "long" }),
      };
    }
    return unitFormats;
  };

  /// Una lunghezza della scena nell'unità del documento, ai decimali con cui
  /// l'unità si legge, e senza lo zero negativo.
  const inUnit = (value: number): number => {
    const unit = docUnit();
    const factor = 10 ** UNIT_PLACES[unit];
    return Math.round(toUnit(value, unit) * factor) / factor || 0;
  };

  /// Una coordinata nell'unità del documento: un numero solo, come nei campi
  /// X e Y.
  const coordText = (value: number): string => formatsNow().plain.format(inUnit(value));

  /// Una lunghezza come si legge: in pixel il numero solo, nelle altre unità
  /// con la sigla.
  const lengthText = (value: number): string => {
    const { unit, short } = formatsNow();
    if (unit === "px") return coordText(value);
    return short === null ? `${coordText(value)} ${unit}` : short.format(inUnit(value));
  };

  /// Una lunghezza come si dice: in pixel il numero solo, nelle altre unità
  /// col nome intero, che uno screen reader non deve indovinare da una sigla.
  const lengthSpoken = (value: number): string => {
    const { unit, long } = formatsNow();
    if (unit === "px") return coordText(value);
    if (long !== null) return long.format(inUnit(value));
    return plural(inUnit(value), "draw.unit.pt.one", "draw.unit.pt.other", { value: coordText(value) });
  };

  /// Un campo di una lunghezza: il nome con la sigla dell'unità, il valore
  /// in quell'unità ai decimali di un campo, e il minimo che la misura in
  /// unità della scena chiede.
  const lengthField = (id: string, label: string, value: number, min?: number): FormField => {
    const unit = docUnit();
    return {
      id,
      label: unitSuffix(label, unit),
      value: fieldText(value, unit),
      kind: "number",
      ...(min === undefined ? {} : { min: fieldMin(min, unit) }),
    };
  };

  /// Il valore di un campo di lunghezza scritto da chi lo cambia, in unità
  /// della scena, a due decimali come li scrive il file.
  const fieldValue = (text: string): number => Math.round(fromUnit(Number(text), docUnit()) * 100) / 100 || 0;

  // --- Righelli e guide del documento ---------------------------------------------

  /// I righelli si vedono: se il livello li offre e chi disegna li vuole.
  const rulersShown = (at: ReadonlySet<Feature> = features): boolean => at.has("rulers") && grid.rulers;

  /// Le guide del documento si vedono, e agganciano, se il livello offre i
  /// righelli e chi disegna le vuole.
  const guidesShown = (at: ReadonlySet<Feature> = features): boolean => at.has("rulers") && grid.rulerGuides;

  /// La parte del foglio che si vede, in pixel: i righelli coprono i bordi
  /// in alto e a sinistra, e ciò che si inquadra va accanto a loro.
  const viewArea = (): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } => {
    const inset = rulersShown() ? RULER_PX : 0;
    return { x: inset, y: inset, w: Math.max(0, surface.clientWidth - inset), h: Math.max(0, surface.clientHeight - inset) };
  };

  /// Dove sta il punto `p` del foglio rispetto ai righelli: su quello in
  /// alto, su quello a sinistra, sull'angolo fra i due, o su nessuno.
  const rulerAt = (p: Point): "top" | "left" | "corner" | null => {
    if (!rulersShown()) return null;
    const top = p[1] >= 0 && p[1] < RULER_PX;
    const left = p[0] >= 0 && p[0] < RULER_PX;
    return top && left ? "corner" : top ? "top" : left ? "left" : null;
  };

  /// Il riquadro della selezione che i righelli segnano, nella scena: lo
  /// tiene aggiornato `showHandles`, anche mentre la si sposta o la si
  /// ridimensiona.
  let selectionBand: Bounds | null = null;

  /// I righelli sullo schermo, se si vedono: la pagina, la selezione e il
  /// puntatore. Il foglio sa se ci sono, e sposta le barre che galleggiano
  /// in cima.
  const showRulers = (): void => {
    const shown = rulersShown();
    stage.toggleAttribute("data-rulers", shown);
    if (!shown) {
      rulers.show(null);
      return;
    }
    rulers.show({
      camera,
      width: surface.clientWidth,
      height: surface.clientHeight,
      unit: docUnit(),
      page: pageBox(),
      selection: selectionBand,
      pointer: pointerAt?.at ?? null,
    });
  };

  /// Le guide del documento sullo schermo, se si vedono: quella sotto il
  /// puntatore accesa, e quella che si trascina dove la porta il gesto.
  const showGuideLines = (): void => {
    const g = current?.kind === "guide" ? current : null;
    // Una guida nuova si vede mentre la si tira anche con le guide nascoste.
    const guides = guidesShown() ? (scene.root.guides ?? []) : [];
    if (guides.length === 0 && (g === null || !g.moved)) {
      guideLines.show(null);
      return;
    }
    guideLines.show({
      camera,
      width: surface.clientWidth,
      height: surface.clientHeight,
      guides,
      hot: g === null ? hotGuide : null,
      hidden: g?.index ?? null,
      moving: g === null || !g.moved ? null : { axis: g.axis, at: g.at, away: g.away },
    });
  };

  const localPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = surface.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const zoomBy = (factor: number): void => {
    const area = viewArea();
    setCamera(zoomAtPoint(camera, factor, { x: area.x + area.w / 2, y: area.y + area.h / 2 }, DRAW_SCALE_LIMITS));
  };

  /// `bounds` inquadrato in ciò che si vede del foglio, accanto ai righelli.
  const fitted = (bounds: Bounds, area: ReturnType<typeof viewArea>): Camera => {
    const world = { minX: bounds.min[0], minY: bounds.min[1], maxX: bounds.max[0], maxY: bounds.max[1] };
    const view = fitBounds(world, { w: area.w, h: area.h }, FIT_PAD, 0, DRAW_SCALE_LIMITS);
    return { ...view, tx: view.tx + area.x, ty: view.ty + area.y };
  };

  function fit(): void {
    const page = scene.root.page;
    let bounds: Bounds | null = page === null ? null : { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] };
    for (const unit of currentIndex().units) bounds = union(bounds, unit.bounds);
    const area = viewArea();
    if (area.w === 0 || area.h === 0) return;
    placed = true;
    if (bounds === null) {
      setCamera({ scale: 1, tx: area.x, ty: area.y });
      return;
    }
    setCamera(fitted(bounds, area));
  }

  // Il primo inquadramento aspetta che il foglio abbia una misura.
  if (typeof ResizeObserver !== "undefined") {
    const sizeObserver = new ResizeObserver(() => {
      if (!placed) fit();
      showGrid();
      showGuideLines();
      showRulers();
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

  // --- I nodi -------------------------------------------------------------

  /// Il tracciato di cui lo strumento Nodi modifica i nodi: con lo strumento
  /// Nodi, se il livello lo offre, col disegno che si scrive e un oggetto solo
  /// scelto. Dentro un gruppo vale la forma toccata per ultima, o quella di
  /// prima, o la prima. Una chiave dice perché non ce n'è uno; `null`, che
  /// non c'è niente da dire.
  const nodeTarget = (): Editing | DrawKey | null => {
    if (tool !== "nodes" || !has("nodes") || !editable() || selection.length === 0) return null;
    const units = selectedUnits();
    if (units.length !== 1) return "draw.nodes.many";
    const unit = units[0]!;
    // Una freccia e un tratto a penna sono tracciati scritti da una regola:
    // prima diventano tracciati qualunque, con «Oggetto in tracciato».
    const shapes = unit.shapes().filter(({ leaf }) => leaf.details?.role === "path");
    if (shapes.length === 0) return "draw.nodes.no_path";
    const at = (path: readonly number[] | null): (typeof shapes)[number] | undefined =>
      path === null ? undefined : shapes.find(({ leaf }) => samePath(pathOf(leaf), path));
    const shape = at(preferredShape) ?? at(editing?.path ?? null) ?? shapes[0]!;
    const d = plainAttributes(shape.leaf).get("d") ?? "";
    const segments = parsePath(d);
    if (segments === null) return "draw.nodes.unreadable";
    const subs = readNodes(segments);
    if (subs.length === 0) return "draw.nodes.empty";
    const inverse = invert(shape.matrix);
    if (inverse === null) return "draw.nodes.flat";
    return { unit, leaf: shape.leaf, path: pathOf(shape.leaf), d, subs, matrix: shape.matrix, inverse, paints: builder.paintsOf(shape.leaf) };
  };

  /// Ritrova il tracciato quando cambia ciò da cui dipende: la scena, la
  /// selezione, lo strumento, il livello, la scrittura, la forma toccata. I
  /// nodi scelti e i tipi dati restano finché il tracciato è lo stesso, con
  /// gli stessi nodi. Vero se l'ha ritrovato.
  const resolveNodes = (): boolean => {
    const index = currentIndex();
    const keys = selection.join("\n");
    const canEdit = editable();
    const last = resolvedFor;
    if (
      last !== null && last.index === index && last.keys === keys && last.tool === tool && last.features === features &&
      last.editable === canEdit && last.preferred === preferredShape
    ) return false;
    resolvedFor = { index, keys, tool, features, editable: canEdit, preferred: preferredShape };
    const before = editing;
    const found = nodeTarget();
    editing = found === null || typeof found === "string" ? null : found;
    noEditing = typeof found === "string" ? found : null;
    if (editing === null || before === null || !samePath(before.path, editing.path) || !sameNodes(before.subs, editing.subs)) {
      nodeSelection = new Set();
      nodeKinds = new Map();
    }
    return true;
  };

  /// Il tipo di ogni nodo di `subs`: quello dato da chi modifica, o quello
  /// che si legge. I capi di un sottotracciato aperto non ne hanno uno, e
  /// valgono come spigoli.
  const kindsOf = (subs: readonly Subpath[]): KindOf => (s, at) => {
    const sub = subs[s]!;
    return innerNode(sub, at) ? nodeKinds.get(nodeKey(s, at)) ?? kindOf(sub, at) : "corner";
  };

  /// Le maniglie che si vedono: quelle dei segmenti che toccano un nodo
  /// scelto, tranne una ritirata sul suo nodo, che il nodo copre.
  const shownHandles = (subs: readonly Subpath[]): HandleRef[] =>
    handlesFor(subs, nodeSelection).filter((handle) => {
      const point = handlePoint(subs, handle);
      const sub = subs[handle.sub]!;
      return point !== null && (handle.which === "control" || !samePlace(point, sub.nodes[handleNode(sub, handle)]!));
    });

  /// Il contorno del tracciato, le maniglie e i nodi, come li lascia il
  /// trascinamento se ce n'è uno: prima il contorno, sopra le maniglie, sopra
  /// ancora i nodi.
  const nodeHandles = (now: Editing): OverlayHandle[] => {
    const subs = (current?.kind === "nodes" ? current.draft : null) ?? now.subs;
    const m = now.matrix;
    const out: OverlayHandle[] = [{ kind: "outline", segments: writeNodes(subs), matrix: m }];
    for (const handle of shownHandles(subs)) {
      const [x, y] = apply(m, handlePoint(subs, handle)!);
      const sub = subs[handle.sub]!;
      // Il punto di una quadratica è dei suoi due nodi: una linea per
      // ciascuno.
      const owners = handle.which === "control" ? [handle.link, (handle.link + 1) % sub.nodes.length] : [handleNode(sub, handle)];
      for (const owner of owners) out.push({ kind: "control", x, y, node: apply(m, sub.nodes[owner]!) });
    }
    const kinds = kindsOf(subs);
    subs.forEach((sub, s) => {
      sub.nodes.forEach((node, at) => {
        const [x, y] = apply(m, node);
        out.push({ kind: "node", x, y, shape: NODE_SHAPES[kinds(s, at)], selected: nodeSelection.has(nodeKey(s, at)) });
      });
    });
    return out;
  };

  // --- La cornice di trasformazione ------------------------------------------

  /// La cornice di `units`: quella di un oggetto solo, che ruota con lui, o
  /// il riquadro comune di più oggetti, se non ne tengono uno loro. `null`
  /// se non disegnano niente.
  const frameOf = (units: readonly Unit[]): Frame | null => {
    if (units.length === 1) {
      const unit = units[0]!;
      const box = unit.frame();
      return box === null ? null : { matrix: unit.matrix, box, geometry: unit.shapeFrame() ?? box };
    }
    if (kept !== null && kept.index === currentIndex() && kept.keys === units.map((unit) => unit.key).join("\n")) return kept.frame;
    let box: Bounds | null = null;
    let geometry: Bounds | null = null;
    for (const unit of units) {
      box = union(box, unit.bounds);
      geometry = union(geometry, unit.geometry ?? unit.bounds);
    }
    return box === null ? null : { matrix: IDENTITY, box, geometry: geometry ?? box };
  };

  /// La cornice che si vede adesso: con lo strumento Selezione, se il
  /// disegno si scrive. Durante un gesto della cornice, com'è diventata;
  /// mentre si sposta o si sceglie col riquadro, nessuna.
  const frameNow = (): FrameView | null => {
    if (tool !== "select" || !editable() || selection.length === 0) return null;
    const g = current?.kind === "select" ? current : null;
    if (g !== null && (g.mode === "move" || g.mode === "marquee")) return null;
    if (g !== null && g.grip !== null) return frameView(g.matrix === null ? g.grip.frame : movedFrame(g.grip.frame, g.matrix), camera.scale);
    const frame = frameOf(selectedUnits());
    return frame === null ? null : frameView(frame, camera.scale);
  };

  /// Le misure e gli angoli come si leggono sulla cornice: le misure
  /// nell'unità del documento, con la sigla una volta in fondo.
  const measuresText = ([width, height]: readonly [number, number]): string => `${coordText(width)} × ${lengthText(height)}`;
  const degreesText = (degrees: number): string => `${numberText(degrees)}°`;

  /// La cornice fra le maniglie: il riquadro comune di più oggetti, le
  /// maniglie, e mentre la si tira le misure o l'angolo, sotto di lei.
  const frameHandles = (): OverlayHandle[] => {
    const view = frameNow();
    if (view === null) return [];
    const out: OverlayHandle[] = [];
    const { min, max } = view.padded;
    if (selection.length > 1) {
      out.push({ kind: "box", x: min[0], y: min[1], width: max[0] - min[0], height: max[1] - min[1], matrix: view.frame.matrix });
    }
    for (const { grip, at } of view.spots) {
      out.push(grip === "rotate" ? { kind: "rotor", x: at[0], y: at[1], stem: view.stem } : { kind: "grip", x: at[0], y: at[1] });
    }
    const g = current?.kind === "select" && (current.mode === "resize" || current.mode === "rotate") ? current : null;
    if (g !== null) {
      const corners = [min, [max[0], min[1]], max, [min[0], max[1]]].map((corner) => apply(view.frame.matrix, corner as Point));
      const x = corners.reduce((sum, corner) => sum + corner[0], 0) / 4;
      const y = Math.max(...corners.map((corner) => corner[1]));
      const text = g.mode === "rotate" ? degreesText(normalized(angleOf(g.grip!.frame.matrix) + g.angle)) : measuresText(frameSize(view.frame));
      out.push({ kind: "label", x, y, text });
    }
    return out;
  };

  /// Il cursore del foglio sopra una maniglia, o durante il suo gesto.
  const showGrip = (cursor: GripCursor | "rotating" | null): void => {
    if (cursor === null) delete surface.dataset.grip;
    else surface.dataset.grip = cursor;
  };

  /// Le cornici della selezione, i nodi del tracciato che si modifica, e il
  /// riquadro di un trascinamento sul vuoto.
  const showHandles = (): void => {
    if (resolveNodes()) syncArrange();
    const handles: OverlayHandle[] = [];
    const move = current?.kind === "select" && current.mode === "move" ? current : null;
    const delta = move === null ? null : moveDelta(move);
    const shaping = current?.kind === "select" && (current.mode === "resize" || current.mode === "rotate") ? current.matrix : null;
    let band: Bounds | null = null;
    for (const unit of selectedUnits()) {
      const frame = unit.frame();
      if (frame === null) continue;
      let matrix = unit.matrix;
      if (delta !== null) {
        const moved = movedMatrix(unit, delta[0], delta[1]);
        if (moved !== null) matrix = compose(unit.parent, moved);
      } else if (shaping !== null) {
        matrix = compose(shaping, matrix);
      }
      // I righelli segnano dove sta la selezione, anche a metà gesto.
      for (const corner of [frame.min, [frame.max[0], frame.min[1]], frame.max, [frame.min[0], frame.max[1]]] as const) {
        const [x, y] = apply(matrix, corner as Point);
        band = union(band, { min: [x, y], max: [x, y] });
      }
      // L'oggetto di cui si modificano i nodi mostra i nodi, non la cornice.
      if (editing !== null && unit.key === editing.unit.key) continue;
      // Il margine è lo stesso sullo schermo lungo i due assi, anche per un
      // oggetto scalato più in un verso che nell'altro.
      const sx = Math.hypot(matrix[0], matrix[1]) * camera.scale;
      const sy = Math.hypot(matrix[2], matrix[3]) * camera.scale;
      const padX = sx > 0 ? FRAME_PX / sx : 0;
      const padY = sy > 0 ? FRAME_PX / sy : 0;
      handles.push({
        kind: "box",
        x: frame.min[0] - padX,
        y: frame.min[1] - padY,
        width: frame.max[0] - frame.min[0] + 2 * padX,
        height: frame.max[1] - frame.min[1] + 2 * padY,
        matrix,
      });
    }
    handles.push(...frameHandles());
    if (editing !== null) handles.push(...nodeHandles(editing));
    if (drafting !== null || current?.kind === "bezier") handles.push(...bezierHandles());
    const lasso = current?.kind === "select" && current.mode === "marquee"
      ? current
      : current?.kind === "nodes" && current.dragging && current.grab?.kind === "marquee" ? current : null;
    if (lasso !== null && lasso.from !== null && lasso.end !== null) {
      const [x1, y1] = lasso.from;
      const [x2, y2] = lasso.end;
      handles.push({ kind: "lasso", points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] });
    }
    // Le guide e le misure stanno sopra a tutto.
    const guides = guideHandles();
    const measures = measureHandles();
    guiding = guides.length > 0;
    measured = measures.length > 0;
    handles.push(...guides, ...measures, ...guideLabel());
    overlay.setHandles(handles);
    selectionBand = band;
    showRulers();
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
  /// scelti, di `delta` nella scena, e i collegamenti che contengono; durante
  /// un ridimensionamento o una rotazione, la loro trasformazione. Con la
  /// Selezione il segno di un oggetto scelto si scosta, per lasciare libera
  /// la maniglia della cornice sul suo angolo.
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
    const shaping = current?.kind === "select" && (current.mode === "resize" || current.mode === "rotate") ? current.matrix : null;
    // Anche mentre si sposta, quando la cornice non si vede: il segno non salta.
    const framed = tool === "select" && editable();
    const chosen = delta !== null || shaping !== null || framed ? selectedUnits().map((unit) => unit.path) : [];
    const { scale, tx, ty } = camera;
    for (const { unit, element } of marks) {
      const inside = chosen.some((path) => path.every((at, i) => unit.path[i] === at));
      let bounds = unit.bounds!;
      if (inside && delta !== null) bounds = translated(bounds, delta[0], delta[1])!;
      else if (inside && shaping !== null) bounds = unit.boundsAfter(shaping) ?? bounds;
      const clear = framed && inside ? MARK_CLEAR_PX : 0;
      element.style.transform = `translate(${tx + scale * bounds.max[0] + clear}px, ${ty + scale * bounds.min[1] - clear}px)`;
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
    showGuideLines();
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
    const layer = has("layers") ? currentLayer() : null;
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
    if (open && !has("attributes")) return;
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

  /// Il livello in cui si disegna, quando l'interfaccia offre i livelli:
  /// quello scelto; se
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

  /// Quando l'interfaccia offre i livelli, il livello corrente segue la
  /// selezione: diventa quello degli oggetti scelti, se stanno tutti in uno.
  function followSelection(): void {
    if (!has("layers") || selection.length === 0) return;
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

  /// Il pulsante dei livelli c'è quando l'interfaccia li offre, e mostra il
  /// nome del livello corrente e il suo stato; l'albero dice qual è.
  function syncLayers(): void {
    layerGroup.hidden = !has("layers");
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
    customButton.hidden = custom === null || !has("colors");
    if (custom === null) return;
    customChip.style.setProperty("--swatch", custom);
    const label = customLabel();
    customButton.setAttribute("aria-label", label);
    customButton.title = label;
  };

  /// I pulsanti dei nodi: si spegne quello che coi nodi scelti non farebbe
  /// niente.
  const syncNodesBar = (): void => {
    const now = editing;
    if (now === null) return;
    const between = linksBetween(now.subs, nodeSelection);
    const inner = [...nodeSelection].some((key) => {
      const [s, at] = parseKey(key);
      const sub = now.subs[s];
      return sub !== undefined && innerNode(sub, at);
    });
    insertNodesButton.disabled = !between.any;
    deleteNodesButton.disabled = nodeSelection.size === 0;
    for (const control of [cornerButton, smoothButton, symmetricButton, breakButton]) control.disabled = !inner;
    linesButton.disabled = !between.toLine;
    curvesButton.disabled = !between.toCurve;
    joinButton.disabled = joinNodes(now.subs, nodeSelection) === null;
    nodesFocus.sync(null);
  };

  /// La barra della selezione: c'è con qualcosa di scelto e il disegno che
  /// si scrive, e non mentre si scrive un testo, se il livello ha un suo
  /// pulsante. Ha i pulsanti delle parti che il livello offre. Con lo
  /// strumento Nodi e un tracciato da modificare c'è al suo posto quella dei
  /// nodi. Un pulsante che non serve si spegne; se aveva il fuoco, il fuoco
  /// passa a quello che prende il Tab, o al foglio quando la barra se ne va.
  const syncArrange = (): void => {
    resolveNodes();
    const focused = arrangeBar.contains(document.activeElement) || nodesBar.contains(document.activeElement);
    const noding = typing === null && editing !== null;
    const units = !noding && typing === null && BAR_FEATURES.some(has) && editable() && selection.length > 0 ? selectedUnits() : [];
    nodesBar.hidden = !noding;
    // Canc, coi nodi, elimina i nodi: il pulsante dell'oggetto non lo dice.
    if (noding) deleteButton.removeAttribute("aria-keyshortcuts");
    else deleteButton.setAttribute("aria-keyshortcuts", "Delete");
    textButton.hidden = !has("text") || units.length !== 1 || units[0]!.look === null;
    for (const control of [duplicateButton, groupButton, ungroupButton, orderButton, alignButton]) control.hidden = !has("arrange");
    groupButton.disabled = units.length < 2;
    ungroupButton.disabled = !units.some(isGroup);
    // Un collegamento non ne contiene un altro: attorno a uno che c'è non se
    // ne crea un secondo, ma quello scelto da solo si cambia.
    const single = units.length === 1 && isLink(units[0]!) ? units[0]! : null;
    shownLink = single === null ? null : { target: linkTarget(nodeOf(engine.model!, single)) };
    linkButton.hidden = !has("links") || options.links === undefined;
    linkButton.disabled = shownLink === null && units.length > 0 && holdsLinks(engine.model!, units);
    nameArrange(linkButton, linkText(), "Mod-k");
    openLinkButton.hidden = options.links === undefined || (shownLink?.target ?? null) === null;
    nameArrange(openLinkButton, openLinkText(), "Alt-Enter");
    unlinkButton.hidden = !has("links") || !units.some(isLink);
    // Con un livello solo, che ha già tutto, non c'è dove spostare.
    const layers = currentIndex().layers;
    intoButton.hidden = !has("layers") || layers.length === 0 || (layers.length === 1 && units.every((unit) => inLayer(unit, layers[0]!)));
    transformButton.hidden = !has("transform");
    applyButton.hidden = !has("apply");
    pathButton.hidden = !has("path");
    booleanButton.hidden = !has("boolean");
    outlineButton.hidden = !has("outline");
    arrangeBar.hidden = units.length === 0 || arrangeButtons.every((control) => control.hidden);
    arrangeFocus.sync(null);
    syncNodesBar();
    if (!focused) return;
    const active = document.activeElement;
    for (const bar of [arrangeBar, nodesBar]) {
      if (!bar.hidden && active instanceof HTMLButtonElement && bar.contains(active) && !active.disabled && !active.hidden) return;
    }
    const next = !arrangeBar.hidden ? arrangeFocus.current() : !nodesBar.hidden ? nodesFocus.current() : null;
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
    moreGroup.hidden = !has("colors");
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
    undoButton.disabled = !canEdit || !undoable();
    redoButton.disabled = !canEdit || !redoable();
    deleteButton.disabled = !canEdit || selection.length === 0;
    propertiesButton.disabled = !canEdit;
    pageButton.hidden = !has("grid") && !has("guides") && !has("rulers");
    insertGroup.hidden = !insertsImages(features);
    imageButton.disabled = !canEdit;
    attributesButton.hidden = !has("attributes");
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
    // L'unità può essere cambiata, e con lei il passo della griglia.
    showGrid();
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
    if (hotGuide !== null && (scene.root.guides?.[hotGuide] === undefined || scene.root.guides[hotGuide]!.locked)) hotGuide = null;
    showGuideLines();
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
    const layer = has("layers") ? currentIndex().layers.find((other) => other.id !== null && applied.touched.includes(other.id)) : undefined;
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
    if (drafting !== null && drafting.done.length > 0) {
      replayBezier(drafting, "undo");
      return;
    }
    // Un tracciato vuoto, senza passi da annullare, lascia il posto al
    // disegno, se il disegno ne ha uno.
    if (!history.canUndo) return;
    dropBezier();
    replay(history.undo(engine), "undo");
  }

  function redo(): void {
    if (!editable()) return;
    finishText();
    cancelGesture();
    if (drafting !== null && drafting.undone.length > 0) {
      replayBezier(drafting, "redo");
      return;
    }
    if (drawing() !== null || !history.canRedo) return;
    dropBezier();
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
  /// lo riceve, e la sua chiave diventa quella. `note` dice, dopo, a che cosa
  /// lo spostamento si è agganciato.
  const moveSelection = (units: readonly Unit[], dx: number, dy: number, note = ""): void => {
    if (units.length === 0 || (dx === 0 && dy === 0)) return;
    // La cornice che più oggetti tengono si sposta con loro.
    const frame = units.length > 1 ? frameOf(units) : null;
    const moved = moveOps(units, dx, dy, newIds());
    let bounds: Bounds | null = null;
    for (const unit of units) bounds = union(bounds, translated(unit.bounds, dx, dy));
    const page = pageFor(scene.root.page, bounds);
    const ops: Op[] = [...moved.ops];
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.move", asGesture(ops)) === null) return;
    selection = inOrder(moved.keys);
    if (frame !== null && frame.matrix !== IDENTITY) kept = { index: currentIndex(), keys: selection.join("\n"), frame: movedFrame(frame, translate(dx, dy)) };
    syncControls();
    showHandles();
    announce(noted(plural(units.length, "draw.moved.one", "draw.moved.other"), note));
  };

  function select(keys: readonly string[]): void {
    selection = inOrder(keys);
    syncControls();
    showHandles();
  }

  /// Porta `bounds` in vista: resta dov'è se si vede già intero, va al
  /// centro se ci sta allo zoom di adesso, altrimenti si inquadra.
  const frameBounds = (bounds: Bounds | null): void => {
    const area = viewArea();
    if (bounds === null || area.w === 0 || area.h === 0) return;
    placed = true;
    const { scale, tx, ty } = camera;
    const left = tx + scale * bounds.min[0];
    const top = ty + scale * bounds.min[1];
    const right = tx + scale * bounds.max[0];
    const bottom = ty + scale * bounds.max[1];
    if (left >= area.x && top >= area.y && right <= area.x + area.w && bottom <= area.y + area.h) return;
    const usable = 1 - 2 * FIT_PAD;
    if (right - left <= area.w * usable && bottom - top <= area.h * usable) {
      const cx = (bounds.min[0] + bounds.max[0]) / 2;
      const cy = (bounds.min[1] + bounds.max[1]) / 2;
      setCamera({ scale, tx: area.x + area.w / 2 - scale * cx, ty: area.y + area.h / 2 - scale * cy });
      return;
    }
    setCamera(fitted(bounds, area));
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
    if (locked) {
      cancelGesture();
      dropBezier();
    }
    syncControls();
  }

  // --- Strumenti --------------------------------------------------------------

  function setLevel(next: Level, custom: readonly string[] = picked): void {
    picked = custom;
    const offered = featuresFor(next, picked);
    if (next === level && offered.size === features.size && [...offered].every((feature) => features.has(feature))) return;
    finishText();
    // Il tracciato della penna di Bézier si conclude prima che la penna se
    // ne vada.
    if (!offered.has("bezier")) {
      cancelGesture();
      finishBezier(false, true);
    }
    level = next;
    features = offered;
    tools = toolsOf(features);
    if (!tools.some((spec) => spec.id === tool)) {
      cancelGesture();
      tool = startTool(tools);
    }
    // Senza i colori a piacere la barra non ha un campione per uno di loro:
    // chi lo usava riparte dai colori di partenza, che la barra mostra.
    if (!has("colors")) {
      if (swatchOf(styles.pen.color) === null) styles.pen.color = DEFAULT_COLOR;
      if (swatchOf(styles.highlighter.color) === null) styles.highlighter.color = HIGHLIGHTER_COLOR;
    }
    showSurfaceHint();
    showGrid();
    showGuideLines();
    syncControls();
    // I righelli vanno e vengono col livello, e la cornice con loro.
    showHandles();
  }

  function setTool(id: ToolId): void {
    if (!tools.some((spec) => spec.id === id)) return;
    // Cambiare strumento conclude il tracciato della penna di Bézier, come in
    // Inkscape: ciò che ne dice la fine precede il nome dello strumento.
    let finished = "";
    if (id !== tool) {
      finishText();
      cancelGesture();
      const before = live.textContent;
      finishBezier(false, true);
      if (live.textContent !== before) finished = (live.textContent ?? "").trim();
    }
    tool = id;
    syncControls();
    // La cornice è dello strumento Selezione.
    showHandles();
    showGrip(null);
    const named = t("draw.announce.tool", { tool: t(toolSpec(id).label) });
    // Con lo strumento Nodi, anche di che cosa si modificano i nodi.
    const target = id === "nodes" ? targetText() : "";
    announce([finished, named, target].filter((part) => part !== "").join(" "));
  }

  function setColor(value: string): void {
    const code = customColor(value);
    if (code === null) return;
    if (swatchOf(code) === null) {
      if (!has("colors")) return;
      custom = code;
    }
    style().color = code;
    syncControls();
    // Un testo nuovo cambia colore mentre lo si scrive, e così il tracciato
    // della penna.
    placeText();
    if (drafting !== null) showBezier();
  }

  function setWidth(value: number): void {
    if (!widthsNow().some((option) => option.value === value)) return;
    style().width = value;
    syncControls();
    placeText();
    if (drafting !== null) showBezier();
  }

  /// «Altro colore…»: il codice, o il selettore del sistema. Un colore della
  /// tavolozza sceglie il suo campione.
  async function chooseColor(): Promise<void> {
    if (asking || !editable() || !has("colors")) return;
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

  /// Il livello che riceve: quello corrente, quando l'interfaccia offre i
  /// livelli; senza, il più alto che si vede e non è bloccato. Se non c'è o
  /// non riceve, lo si dice, e il gesto non scrive.
  const target = (ids: NewIds): Destination | null => {
    const layer = has("layers") ? currentLayer() : null;
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

  /// La griglia aggancia: se il livello la offre, con l'aggancio acceso. `at`
  /// sono le parti da guardare, di solito quelle di adesso.
  const gridOn = (at: ReadonlySet<Feature> = features): boolean => at.has("grid") && grid.snap;

  /// Un punto di un gesto: sull'incrocio più vicino quando la griglia
  /// aggancia e Ctrl o ⌘ non è tenuto.
  const snapped = (p: Point): Point => (gridOn() && !free ? snapPoint(p, stepNow()) : p);

  // --- Le guide intelligenti -------------------------------------------------

  /// Le guide intelligenti agganciano agli oggetti e alla pagina: se il
  /// livello le offre, accese. `at` sono le parti da guardare, di solito
  /// quelle di adesso.
  const smartOn = (at: ReadonlySet<Feature> = features): boolean => at.has("guides") && grid.guides;

  /// Le guide del documento agganciano: se si vedono, e ce n'è una.
  const rulerGuidesOn = (at: ReadonlySet<Feature> = features): boolean => guidesShown(at) && (scene.root.guides?.length ?? 0) > 0;

  /// Qualcosa aggancia ciò che si muove: le guide intelligenti, o quelle del
  /// documento.
  const guidesOn = (at: ReadonlySet<Feature> = features): boolean => smartOn(at) || rulerGuidesOn(at);

  /// La soglia delle guide nella scena, per il puntatore `pointer`.
  const guideReach = (pointer: InkPointerType): number => GUIDE_PX[pointer] / camera.scale;

  /// La pagina nella scena, se c'è.
  const pageBox = (): Bounds | null => {
    const page = scene.root.page;
    return page === null ? null : { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] };
  };

  /// Gli oggetti che si vedono nel disegno di adesso, anche nei livelli
  /// bloccati, ricalcolati quando la scena cambia.
  let seenCache: { readonly index: SceneIndex; readonly units: readonly Unit[] } | null = null;
  const seenUnits = (): readonly Unit[] => {
    const index = currentIndex();
    if (seenCache?.index !== index) seenCache = { index, units: engine.model === null ? [] : indexer.seen(engine.model) };
    return seenCache.units;
  };

  /// I bersagli di `owner`, un gesto o i nodi della penna di Bézier, presi la
  /// prima volta che servono e tenuti finché la scena e la vista restano
  /// quelle: con le guide intelligenti gli oggetti che si vedono nella
  /// vista, tranne quelli di chiave `skip`, la pagina, e i punti `points`;
  /// con le guide del documento, quelle, tranne la guida `skipGuide`. Ci si
  /// allinea a ciò che si guarda; un foglio non ancora disposto, senza
  /// misure, vede tutto.
  let guideCache: { readonly owner: object; readonly index: SceneIndex; readonly view: Camera; readonly guides: GuideIndex } | null = null;
  const guidesFor = (owner: object, skip: readonly string[], points: () => readonly Point[] = () => [], skipGuide: number | null = null): GuideIndex => {
    const index = currentIndex();
    if (guideCache !== null && guideCache.owner === owner && guideCache.index === index && guideCache.view === camera) return guideCache.guides;
    const targets: GuideTarget[] = [];
    if (smartOn()) {
      const skipped = new Set(skip);
      const view = surface.clientWidth > 0 && surface.clientHeight > 0 ? viewBounds() : null;
      for (const unit of seenUnits()) {
        const box = unit.geometry ?? unit.bounds;
        if (box === null || skipped.has(unit.key)) continue;
        if (view !== null && (box.max[0] < view.min[0] || box.min[0] > view.max[0] || box.max[1] < view.min[1] || box.min[1] > view.max[1])) continue;
        targets.push({ kind: "object", box, key: unit.key });
      }
      const page = pageBox();
      if (page !== null) targets.push({ kind: "page", box: page, key: "" });
      for (const p of points()) targets.push({ kind: "node", box: { min: p, max: p }, key: "" });
    }
    if (rulerGuidesOn()) {
      (scene.root.guides ?? []).forEach((guide, i) => {
        if (i === skipGuide) return;
        targets.push({ kind: "guide", box: { min: [guide.at, guide.at], max: [guide.at, guide.at] }, key: String(i), axis: guide.axis === "x" ? 0 : 1 });
      });
    }
    const guides = new GuideIndex(targets);
    guideCache = { owner, index, view: camera, guides };
    return guides;
  };

  /// Un punto di un gesto, con la griglia e con le guide di `guides`: lungo
  /// ciascun asse sulla riga o sul bersaglio più vicino, a pari distanza sul
  /// bersaglio, finché Ctrl o ⌘ non è tenuto.
  const guided = (p: Point, guides: () => GuideIndex, pointer: InkPointerType): Point => {
    if (free) return p;
    const line = gridOn() ? snapPoint(p, stepNow()) : null;
    if (!guidesOn()) return line ?? p;
    const index = guides();
    const reach = guideReach(pointer);
    const along = (axis: FrameAxis): number => nearer(p[axis], index.nearest(axis, p[axis], reach), line === null ? null : line[axis]);
    return [along(0), along(1)];
  };

  /// I nodi del tracciato `now` che restano fermi mentre si muovono quelli di
  /// `moving`, nella scena: bersagli delle guide.
  const fixedNodes = (now: Editing, moving: ReadonlySet<NodeKey>): Point[] => {
    const out: Point[] = [];
    now.subs.forEach((sub, s) => {
      sub.nodes.forEach((node, at) => {
        if (!moving.has(nodeKey(s, at))) out.push(apply(now.matrix, node));
      });
    });
    return out;
  };

  /// Dove il trascinamento `g` porta il nodo o la maniglia presi, con la
  /// griglia e con le guide: un nodo si allinea agli altri oggetti e ai nodi
  /// che restano fermi, una maniglia anche al suo nodo.
  const nodeDragTo = (g: NodesGesture, now: Editing, grab: Extract<NodeGrab, { readonly origin: Point }>): Point => {
    const p: Point = [grab.origin[0] + g.end![0] - g.from![0], grab.origin[1] + g.end![1] - g.from![1]];
    const moving: ReadonlySet<NodeKey> = grab.kind === "node" ? nodeSelection : new Set();
    return guided(p, () => guidesFor(g, [now.unit.key], () => fixedNodes(now, moving)), g.pointer);
  };

  /// I nodi della penna di Bézier, finché il tracciato non ne ha.
  const noNodes: readonly PenNode[] = [];

  /// I bersagli della penna di Bézier: gli oggetti e i nodi già posati.
  const bezierGuides = (): GuideIndex => {
    const nodes = drafting?.nodes ?? noNodes;
    return guidesFor(nodes, [], () => nodes.map((node) => node.at));
  };

  /// Ciò che le guide mostrano adesso: le linee del gesto in corso, o del
  /// punto che la penna di Bézier poserebbe; per uno spostamento anche le
  /// distanze uguali. `null` se le guide non agganciano.
  const guideView = (): GuideView | null => {
    if (free || !guidesOn()) return null;
    const point = (index: GuideIndex, p: Point): GuideView => {
      const box: Bounds = { min: p, max: p };
      return { lines: [...index.lines(0, box, [{ value: p[0], edge: "point" }]), ...index.lines(1, box, [{ value: p[1], edge: "point" }])], spacings: [] };
    };
    const g = current;
    if (g?.kind === "select" && g.mode === "move") {
      const box = geometryOf(g.units);
      if (box === null) return null;
      const moved = translated(box, ...moveDelta(g))!;
      const index = guidesFor(g, g.units.map((unit) => unit.key));
      const lines: GuideLine[] = [];
      const spacings: Spacing[] = [];
      for (const axis of [0, 1] as const) {
        lines.push(...index.lines(axis, moved, anchorsOf(moved, axis)));
        const spacing = index.spacing(axis, moved);
        if (spacing !== null) spacings.push(spacing);
      }
      return { lines, spacings };
    }
    if (g?.kind === "select" && g.mode === "resize" && g.grip !== null && g.matrix !== null) {
      const { grip, frame } = g.grip;
      if (grip === "rotate" || !upright(frame.matrix)) return null;
      // La geometria dopo il ridimensionamento, e i bordi tirati.
      const m = compose(g.matrix, frame.matrix);
      const a = apply(m, frame.geometry.min);
      const b = apply(m, frame.geometry.max);
      const box: Bounds = { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
      const index = guidesFor(g, g.units.map((unit) => unit.key));
      const lines: GuideLine[] = [];
      for (const axis of [0, 1] as const) {
        const direction = pull(grip, axis);
        if (direction === 0) continue;
        const value = (direction > 0 ? b : a)[axis];
        const edge: GuideEdge = Math.abs(value - box.min[axis]) <= Math.abs(value - box.max[axis]) ? "min" : "max";
        lines.push(...index.lines(axis, box, [{ value, edge }]));
      }
      return { lines, spacings: [] };
    }
    if (g?.kind === "shape") {
      const ends = shapeEnds(g, g.to);
      return ends === null ? null : point(guidesFor(g, []), apply(g.to.matrix, ends[1]));
    }
    if (g?.kind === "nodes" && g.dragging && g.from !== null && g.end !== null && editing !== null) {
      const grab = g.grab;
      if (grab?.kind !== "node" && grab?.kind !== "handle") return null;
      const now = editing;
      const moving: ReadonlySet<NodeKey> = grab.kind === "node" ? nodeSelection : new Set();
      return point(guidesFor(g, [now.unit.key], () => fixedNodes(now, moving)), nodeDragTo(g, now, grab));
    }
    if (g?.kind === "bezier" && g.mode !== null) {
      const p = g.dragging ? bezierHandle(g) : g.mode === "add" ? g.at : null;
      return p === null ? null : point(bezierGuides(), p);
    }
    if (g === null && tool === "bezier" && hover !== null && drawing() !== null) return point(bezierGuides(), bezierPoint(hover.at, hover.pointer));
    return null;
  };

  /// Le guide si vedono, e le misure con Alt: col gesto che finisce, o col
  /// tasto lasciato, vanno tolte.
  let guiding = false;
  let measured = false;

  /// Le linee delle guide, coi segni e le distanze, e gli spazi uguali. La
  /// distanza da un oggetto in linea si scrive una volta, sulla linea dei
  /// centri se c'è, e non se la scrivono già le distanze uguali.
  const guideHandles = (): OverlayHandle[] => {
    const view = guideView();
    if (view === null) return [];
    const out: OverlayHandle[] = [];
    const along = (line: GuideLine, value: number): Point => (line.axis === 0 ? [line.value, value] : [value, line.value]);
    for (const line of view.lines) {
      out.push({ kind: "guide", from: along(line, line.from), to: along(line, line.to), dashed: false });
      for (const mark of line.marks) {
        const [x, y] = along(line, mark);
        out.push({ kind: "cross", x, y });
      }
    }
    const written = new Set<string>();
    const spaced = (axis: FrameAxis, [from, to]: readonly [number, number]): boolean =>
      view.spacings.some((spacing) => spacing.axis === axis && spacing.gaps.some((gap) => Math.abs(gap.from - from) <= ON_GUIDE && Math.abs(gap.to - to) <= ON_GUIDE));
    const middleFirst = [...view.lines].sort((a, b) => Number(b.source === "mid") - Number(a.source === "mid"));
    for (const line of middleFirst) {
      if (line.gap === null) continue;
      const key = `${line.axis} ${line.gap[0]} ${line.gap[1]}`;
      if (written.has(key) || spaced(line.axis === 0 ? 1 : 0, line.gap)) continue;
      written.add(key);
      out.push({ kind: "measure", from: along(line, line.gap[0]), to: along(line, line.gap[1]), text: lengthText(line.gap[1] - line.gap[0]) });
    }
    for (const { axis, gap, gaps } of view.spacings) {
      for (const { from, to, across } of gaps) {
        const at = (along: number): Point => (axis === 0 ? [along, across] : [across, along]);
        out.push({ kind: "measure", from: at(from), to: at(to), text: lengthText(gap) });
      }
    }
    return out;
  };

  /// Una linea a parole: quale bordo o centro di ciò che si è mosso sta in
  /// linea con quale dell'oggetto, della pagina o del nodo.
  const lineText = ({ axis, source, target, edge }: GuideLine): string => {
    const names = EDGE_NAMES[axis];
    const from = t(names[source]);
    if (target.kind === "node") return t("draw.guides.node", { source: from });
    if (target.kind === "guide") return t("draw.guides.line", { source: from });
    const same = source === edge;
    if (target.kind === "page") return same ? t("draw.guides.page.same", { source: from }) : t("draw.guides.page", { source: from, edge: t(names[edge]) });
    const unit = seenUnits().find((each) => each.key === target.key);
    const name = unit === undefined ? target.key : labelOf(unit);
    return same ? t("draw.guides.object.same", { source: from, name }) : t("draw.guides.object", { source: from, edge: t(names[edge]), name });
  };

  /// A che cosa si è agganciato il gesto di adesso, a parole, da dire alla
  /// fine: per ciascun asse le distanze uguali, o una linea, prima con un
  /// oggetto che con la pagina. Vuoto se niente.
  const snapNote = (): string => {
    const view = guideView();
    if (view === null) return "";
    const parts: string[] = [];
    for (const axis of [0, 1] as const) {
      const spacing = view.spacings.find((each) => each.axis === axis);
      if (spacing !== undefined) {
        parts.push(t(axis === 0 ? "draw.guides.spaced.x" : "draw.guides.spaced.y", { gap: lengthSpoken(spacing.gap) }));
        continue;
      }
      // Prima un oggetto o un nodo, poi una guida, poi la pagina.
      const lines = view.lines.filter((line) => line.axis === axis);
      const line = lines.find((each) => each.target.kind !== "page" && each.target.kind !== "guide") ?? lines.find((each) => each.target.kind === "guide") ?? lines[0];
      if (line !== undefined) parts.push(lineText(line));
    }
    return parts.length === 0 ? "" : t("draw.guides.snapped", { parts: parts.join("; ") });
  };

  /// `text` e, dopo, la nota delle guide, se c'è.
  const noted = (text: string, note: string): string => (note === "" ? text : `${text} ${note}`);

  /// Dove sta il puntatore che passa sul foglio: le misure con Alt partono
  /// da lì.
  let pointerAt: { readonly at: Point; readonly pointer: InkPointerType } | null = null;

  /// Con Alt e una selezione, le distanze fra la sua geometria e quella
  /// dell'oggetto sotto il puntatore, bloccati compresi, o della pagina, se
  /// il puntatore ci sta sopra fuori dagli oggetti. Il riquadro misurato si
  /// vede tratteggiato.
  const measureHandles = (): OverlayHandle[] => {
    if (!alt || current !== null || pressed !== null || pointerAt === null || tool !== "select" || !has("guides") || selection.length === 0) return [];
    const a = geometryOf(selectedUnits());
    if (a === null) return [];
    const { at: p, pointer } = pointerAt;
    const chosen = new Set(selection);
    const tolerance = HIT_PX[pointer] / camera.scale;
    const units = seenUnits();
    let b: Bounds | null = null;
    for (let i = units.length - 1; i >= 0 && b === null; i--) {
      const unit = units[i]!;
      if (!chosen.has(unit.key) && unit.hits(p, tolerance)) b = unit.geometry ?? unit.bounds;
    }
    const page = pageBox();
    if (b === null && page !== null && p[0] >= page.min[0] && p[0] <= page.max[0] && p[1] >= page.min[1] && p[1] <= page.max[1]) b = page;
    if (b === null) return [];
    const { measures, extensions } = measureBetween(a, b);
    const corners: Point[] = [b.min, [b.max[0], b.min[1]], b.max, [b.min[0], b.max[1]]];
    return [
      ...corners.map((corner, i): OverlayHandle => ({ kind: "guide", from: corner, to: corners[(i + 1) % 4]!, dashed: true })),
      ...extensions.map(([from, to]): OverlayHandle => ({ kind: "guide", from, to, dashed: true })),
      ...measures.map(({ from, to, value }): OverlayHandle => ({ kind: "measure", from, to, text: lengthText(value) })),
    ];
  };

  // --- Il gesto delle guide del documento ----------------------------------------

  /// Le guide del documento da scrivere, o perché non si può: le guide
  /// scritte che non si leggono non si riscrivono a gesti, e lo si dice.
  const writableGuides = (): readonly RulerGuide[] | null => {
    const guides = scene.root.guides;
    if (guides === null) announce(t("draw.guides.unreadable"));
    return guides;
  };

  /// Le guide nascoste si fanno vedere per chi ne aggiunge: è ciò che vuole
  /// vedere. Lo dice l'annuncio della guida.
  const revealGuides = (): void => {
    if (grid.rulerGuides) return;
    grid = { ...grid, rulerGuides: true };
    options.onGridChange?.(grid);
  };

  /// Scrive le guide `next` in un passo di annulla `label`, e dice `text`.
  const commitGuides = (label: DrawKey, next: readonly RulerGuide[], text: string): boolean => {
    if (commit(label, { op: "set", id: ROOT, attrs: { "fub:guides": writeGuides(next) } }) === null) return false;
    announce(text);
    return true;
  };

  /// Il gesto di una guida, se il puntatore è sceso su un righello o su una
  /// guida: un righello ne tira una nuova, quello in alto un'orizzontale e
  /// quello a sinistra una verticale; con lo strumento Selezione una guida
  /// libera si sposta. Le maniglie della cornice vengono prima delle guide,
  /// le guide prima degli oggetti. `null` se il gesto non è di una guida.
  const guideStart = (base: GestureBase): GuideGesture | RefusedGesture | null => {
    const down = downAt;
    if (down === null || !has("rulers")) return null;
    const ruler = rulerAt(down);
    if (ruler === "corner") return { ...base, kind: "refused" };
    const p = screenToWorld(camera, { x: down[0], y: down[1] });
    if (ruler !== null) {
      if (!editable()) return { ...base, kind: "refused" };
      const guides = writableGuides();
      if (guides === null) return { ...base, kind: "refused" };
      if (guides.length >= MAX_GUIDES) {
        announce(t("draw.guides.full", { count: MAX_GUIDES }));
        return { ...base, kind: "refused" };
      }
      const axis = ruler === "top" ? "y" : "x";
      return { ...base, kind: "guide", axis, index: null, from: down, offset: 0, at: axis === "x" ? p.x : p.y, away: true, moved: false };
    }
    if (tool !== "select" || !editable() || !guidesShown()) return null;
    const guides = scene.root.guides;
    if (guides === null) return null;
    const view = frameNow();
    if (view !== null && gripAt(view, [p.x, p.y], camera.scale, base.pointer) !== null) return null;
    const index = guideAt(guides, camera, down, GUIDE_HIT_PX[base.pointer], true);
    if (index === null) return null;
    const guide = guides[index]!;
    const offset = guide.at - (guide.axis === "x" ? p.x : p.y);
    return { ...base, kind: "guide", axis: guide.axis, index, from: down, offset, at: guide.at, away: false, moved: false };
  };

  /// Dove va la guida del gesto `g` per il valore `value` della scena: sulla
  /// riga della griglia o sul bersaglio più vicino, a pari distanza sul
  /// bersaglio, finché Ctrl o ⌘ non è tenuto; a due decimali, come la
  /// scrive il file.
  const guideValue = (g: GuideGesture, value: number): number => {
    let at = value;
    if (!free) {
      const axis: FrameAxis = g.axis === "x" ? 0 : 1;
      const line = gridOn() ? snapValue(value, stepNow()) : null;
      const target = guidesOn() ? guidesFor(g, [], () => [], g.index).nearest(axis, value, guideReach(g.pointer)) : null;
      at = nearer(value, target, line);
    }
    return Math.round(at * 100) / 100 || 0;
  };

  /// Il gesto `g` col puntatore in `p`, nella scena: la guida lo segue, e
  /// sopra un righello o fuori dal foglio si rilascia per toglierla.
  const guideUpdate = (g: GuideGesture, p: Point): void => {
    const x = camera.tx + camera.scale * p[0];
    const y = camera.ty + camera.scale * p[1];
    if (!g.moved && Math.hypot(x - g.from[0], y - g.from[1]) <= DRAG_PX[g.pointer]) return;
    if (!g.moved) showGrip(g.axis === "x" ? "ew" : "ns");
    g.moved = true;
    g.away = x < 0 || y < 0 || x > surface.clientWidth || y > surface.clientHeight || rulerAt([x, y]) !== null;
    g.at = guideValue(g, (g.axis === "x" ? p[0] : p[1]) + g.offset);
    showGuideLines();
    showHandles();
  };

  /// Accanto al puntatore che tira una guida: dove sta, o che rilasciata se
  /// ne va. Resta nella parte del foglio che si vede, fuori dai righelli.
  const guideLabel = (): OverlayHandle[] => {
    const g = current?.kind === "guide" ? current : null;
    if (g === null || !g.moved || pointerAt === null) return [];
    const area = viewArea();
    const x = Math.min(Math.max(camera.tx + camera.scale * pointerAt.at[0], area.x + 48), area.x + area.w - 48);
    const y = Math.min(Math.max(camera.ty + camera.scale * pointerAt.at[1] + 8, area.y + 4), area.y + area.h - 24);
    const at = screenToWorld(camera, { x, y });
    return [{ kind: "label", x: at.x, y: at.y, text: g.away ? t("draw.guide.drop") : lengthText(g.at) }];
  };

  /// La fine del gesto `g`: una guida nuova entra se è sul foglio, una che
  /// c'era va dove l'ha portata o, sopra un righello, se ne va. Un tocco fermo
  /// non cambia niente; due tocchi sulla stessa guida aprono «Guide».
  const guideEnd = (g: GuideGesture, time: number): void => {
    current = null;
    showGrip(null);
    showGuideLines();
    showHandles();
    if (!g.moved) {
      if (g.index === null) return;
      const tap = lastGuideTap;
      const twice = tap !== null && tap.index === g.index && time - tap.time <= DOUBLE_TAP_MS && Math.hypot(tap.at[0] - g.from[0], tap.at[1] - g.from[1]) <= DOUBLE_TAP_PX[g.pointer];
      lastGuideTap = twice ? null : { index: g.index, time, at: g.from };
      if (twice) void editGuides(g.index);
      return;
    }
    lastGuideTap = null;
    const guides = scene.root.guides;
    if (guides === null) return;
    const vertical = g.axis === "x";
    if (g.index === null) {
      if (g.away) return;
      revealGuides();
      const text = t(vertical ? "draw.guide.added.x" : "draw.guide.added.y", { at: lengthSpoken(g.at) });
      commitGuides("draw.action.guide_add", [...guides, { axis: g.axis, at: g.at, locked: false }], text);
      return;
    }
    const before = guides[g.index];
    if (before === undefined) return;
    if (g.away) {
      commitGuides("draw.action.guide_delete", guides.filter((_, i) => i !== g.index), t(vertical ? "draw.guide.deleted.x" : "draw.guide.deleted.y"));
      return;
    }
    if (g.at === before.at) return;
    const text = t(vertical ? "draw.guide.moved.x" : "draw.guide.moved.y", { at: lengthSpoken(g.at) });
    commitGuides("draw.action.guide_move", guides.map((each, i) => (i === g.index ? { ...each, at: g.at } : each)), text);
  };

  /// Blocca o sblocca la guida `index`: bloccata, il puntatore la attraversa.
  const lockGuide = (index: number, lock: boolean): void => {
    const guides = writableGuides();
    if (guides === null || guides[index] === undefined || guides[index]!.locked === lock) return;
    const next = guides.map((each, i) => (i === index ? { ...each, locked: lock } : each));
    commitGuides(lock ? "draw.action.guide_lock" : "draw.action.guide_unlock", next, t(lock ? "draw.guide.locked" : "draw.guide.unlocked"));
  };

  /// Elimina la guida `index`.
  const deleteGuide = (index: number): void => {
    const guides = writableGuides();
    const guide = guides?.[index];
    if (guides === null || guide === undefined) return;
    commitGuides("draw.action.guide_delete", guides.filter((_, i) => i !== index), t(guide.axis === "x" ? "draw.guide.deleted.x" : "draw.guide.deleted.y"));
  };

  /// Blocca o sblocca tutte le guide.
  const lockAllGuides = (lock: boolean): void => {
    const guides = writableGuides();
    if (guides === null || guides.every((each) => each.locked === lock)) return;
    commitGuides("draw.action.guides", guides.map((each) => ({ ...each, locked: lock })), t(lock ? "draw.guides.all_locked" : "draw.guides.all_unlocked"));
  };

  /// Elimina tutte le guide, in un passo di annulla.
  const deleteAllGuides = (): void => {
    const guides = writableGuides();
    if (guides === null || guides.length === 0) return;
    commitGuides("draw.action.guides", [], plural(guides.length, "draw.guides.deleted.one", "draw.guides.deleted.other"));
  };

  /// «Guide…»: le guide coi numeri, nell'unità del documento, col fuoco
  /// sulla guida `focus`. Ciò che cambia si scrive in un passo di annulla.
  async function editGuides(focus: number | null): Promise<void> {
    if (asking || !editable() || !has("rulers")) return;
    finishText();
    cancelGesture();
    asking = true;
    try {
      const area = viewArea();
      const center = screenToWorld(camera, { x: area.x + area.w / 2, y: area.y + area.h / 2 });
      const before = scene.root.guides;
      const answer = await guideDialog({ guides: before, unit: docUnit(), center: [center.x, center.y], focus });
      if (answer === null || disposed || !editable()) return;
      // Mentre la finestra era aperta il disegno può essere cambiato: si
      // scrive ciò che la finestra mostra, se è diverso da ciò che c'è.
      const now = scene.root.guides;
      if (now !== null && writeGuides(answer) === writeGuides(now)) return;
      if (answer.length > (now?.length ?? 0)) revealGuides();
      commitGuides("draw.action.guides", answer, t("draw.guides.changed"));
    } finally {
      asking = false;
    }
  }

  const begin = (start: StrokeStart): Gesture => {
    const base = { stroke: start.id, pointer: start.pointerType };
    // Un righello o una guida sotto il puntatore prendono il gesto, con
    // qualunque strumento il righello, con la Selezione la guida.
    const guide = start.id >= 0 ? guideStart(base) : null;
    if (guide !== null) return guide;
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
      case "bezier": {
        // Il livello si guarda a ogni nodo: se non riceve più, lo si dice e
        // il nodo non entra.
        const to = target(newIds());
        if (to === null) return { ...base, kind: "refused" };
        return { ...base, kind: "bezier", to, mode: null, from: null, end: null, at: null, dragging: false };
      }
      case "eraser":
        return { ...base, kind: "erase", last: null, marked: new Map() };
      case "select":
        return {
          ...base,
          kind: "select",
          from: null,
          end: null,
          mode: "pending",
          units: [],
          base: [],
          release: null,
          source: null,
          hit: null,
          grip: null,
          matrix: null,
          angle: 0,
        };
      case "nodes":
        return { ...base, kind: "nodes", from: null, end: null, grab: null, dragging: false, nodes: new Set(nodeSelection), selection: [...selection], draft: null };
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
    const end = apply(to.inverse, guided(g.end, () => guidesFor(g, []), g.pointer));
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
    // Le guide seguono il punto che si tira.
    if (guidesOn() || guiding) showHandles();
  };

  /// Lo spostamento del gesto `g`. Con la griglia l'angolo preso va
  /// sull'incrocio; con le guide, lungo ciascun asse, un bordo o il centro
  /// della geometria scelta va sul bersaglio più vicino, o dove le distanze
  /// sono uguali; fra la griglia e le guide vince il più vicino. Ctrl o ⌘ lo
  /// lascia libero.
  const moveDelta = (g: SelectGesture): [number, number] => {
    if (g.from === null || g.end === null) return [0, 0];
    const dx = g.end[0] - g.from[0];
    const dy = g.end[1] - g.from[1];
    if (free) return [roundDelta(dx), roundDelta(dy)];
    const line = gridOn() && g.source !== null ? snapDelta(g.source, dx, dy, stepNow()) : null;
    const box = guidesOn() ? geometryOf(g.units) : null;
    if (box === null) return line ?? [roundDelta(dx), roundDelta(dy)];
    const index = guidesFor(g, g.units.map((unit) => unit.key));
    const reach = guideReach(g.pointer);
    const moved = translated(box, dx, dy)!;
    const raw = [dx, dy] as const;
    const along = (axis: FrameAxis): number => {
      // In linea vince, a pari scarto, sulle distanze uguali.
      const align = index.snap(axis, anchorsOf(moved, axis).map((anchor) => anchor.value), reach);
      const space = index.spaceSnap(axis, moved, reach);
      const offset = align !== null && (space === null || Math.abs(align) <= Math.abs(space)) ? align : space;
      const value = nearer(raw[axis], offset === null ? null : raw[axis] + offset, line === null ? null : line[axis]);
      return line !== null && value === line[axis] ? value : roundDelta(value);
    };
    return [along(0), along(1)];
  };

  /// La trasformazione della scena del ridimensionamento in corso. Gli
  /// angoli tengono le proporzioni degli oggetti che, deformati, non sono più
  /// loro, e Maiusc inverte la scelta; Alt tiene fermo il centro. Con la
  /// griglia o con le guide, a cornice dritta, si tira la geometria, senza il
  /// contorno, e il bordo tirato si ferma sulla riga o sul bersaglio più
  /// vicino.
  const resizeNow = (g: SelectGesture): Matrix | null => {
    if (g.grip === null || g.grip.grip === "rotate" || g.from === null || g.end === null) return null;
    const { grip, frame } = g.grip;
    const inverse = invert(frame.matrix);
    if (inverse === null) return null;
    const [a, b, c, d] = inverse;
    const delta = apply([a, b, c, d, 0, 0], [roundDelta(g.end[0] - g.from[0]), roundDelta(g.end[1] - g.from[1])]);
    const snap = gridOn() && !free ? gridSnap(frame.matrix, stepNow()) : null;
    const guides = guidesOn() && !free ? frameGuides(guidesFor(g, g.units.map((unit) => unit.key)), frame.matrix, GUIDE_PX[g.pointer], camera.scale) : null;
    const work = snap === null && guides === null ? frame.box : frame.geometry;
    const [m0, m1, m2, m3] = frame.matrix;
    const minimum: [number, number] = [MIN_SIZE / Math.hypot(m0, m1), MIN_SIZE / Math.hypot(m2, m3)];
    const ratio = isCorner(grip) && g.units.some((unit) => RATIO_ROLES.has(unit.role)) !== shift;
    return resizeMatrix(frame, work, resized(work, grip, delta, { ratio, fromCenter: alt, minimum, snap, guides }));
  };

  /// La trasformazione della scena della rotazione in corso, attorno al
  /// centro della cornice. Con Maiusc l'angolo va a passi di 15°; senza, si
  /// ferma da solo sugli angoli retti, se Ctrl o ⌘ non lo lascia libero.
  const rotateNow = (g: SelectGesture): Matrix | null => {
    if (g.grip === null || g.from === null || g.end === null) return null;
    const { frame } = g.grip;
    const pivot = frameCenter(frame);
    g.angle = rotation(pivot, g.from, g.end, angleOf(frame.matrix), { step: shift ? ROTATE_STEP : null, magnet: free ? 0 : MAGNET_DEGREES });
    return rotationMatrix(pivot, g.angle);
  };

  /// Scrive `m`, la trasformazione della cornice `frame`, in un passo, e lo
  /// dice: le misure di dopo, e `note`, a che cosa si è agganciato, o, per
  /// una rotazione di `turn` gradi, di quanto. Più oggetti tengono la
  /// cornice com'è diventata.
  const applyFrame = (units: readonly Unit[], frame: Frame, m: Matrix, turn: number | null, note = ""): void => {
    const transformed = numericOps(units, m, newIds());
    if (transformed === null) {
      announce(t("draw.transform.unwritable"));
      return;
    }
    if (transformed.changed === 0) return;
    if (!arrange(turn === null ? "draw.action.resize" : "draw.action.rotate", transformed, boundsAfter(units, m))) return;
    const after = movedFrame(frame, m);
    kept = units.length > 1 ? { index: currentIndex(), keys: selection.join("\n"), frame: after } : null;
    showHandles();
    if (turn === null) {
      const [width, height] = frameSize(after);
      announce(noted(t("draw.resized", { width: lengthSpoken(width), height: lengthSpoken(height) }), note));
    } else {
      announce(t(turn > 0 ? "draw.rotated.clockwise" : "draw.rotated.counter", { angle: degreesText(Math.abs(turn)) }));
    }
  };

  /// `[` e `]`: la selezione ruota di `degrees` gradi, in senso orario se
  /// positivi, attorno al centro della sua cornice.
  const rotateSelection = (degrees: number): void => {
    const units = selectedUnits();
    const frame = frameOf(units);
    if (frame === null) return;
    applyFrame(units, frame, rotationMatrix(frameCenter(frame), degrees), degrees);
  };

  /// Il primo punto di un gesto di selezione: una maniglia della cornice si
  /// potrà tirare; un oggetto sotto il puntatore si sceglie e si potrà
  /// trascinare; il vuoto comincia un riquadro.
  const selectStart = (g: SelectGesture, p: Point): void => {
    g.from = p;
    g.end = p;
    const view = frameNow();
    const grip = view === null ? null : gripAt(view, p, camera.scale, g.pointer);
    if (grip !== null) {
      g.grip = { grip, frame: view!.frame };
      g.units = selectedUnits();
      return;
    }
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
      g.mode = g.grip === null ? "move" : g.grip.grip === "rotate" ? "rotate" : "resize";
      g.release = null;
      if (g.grip !== null) showGrip(g.grip.grip === "rotate" ? "rotating" : gripCursor(g.grip.frame, g.grip.grip));
    }
    if (g.mode === "resize" || g.mode === "rotate") {
      g.matrix = g.mode === "resize" ? resizeNow(g) : rotateNow(g);
      const transforms = new Map<PaintNode, string | null>();
      for (const unit of g.matrix === null ? [] : g.units) {
        const next = transformedMatrix(unit, g.matrix!);
        if (next === null) continue;
        const value = transformValue(next);
        for (const paint of unit.paints) transforms.set(paint, value);
      }
      painter.setDraft({ transforms });
    } else if (g.mode === "move") {
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
    if (g.grip !== null) {
      // Un tocco su una maniglia, senza tirarla, non cambia niente.
      lastTap = null;
      painter.setDraft(null);
      const note = g.mode === "resize" ? snapNote() : "";
      current = null;
      showGrip(null);
      if (g.mode !== "pending" && g.matrix !== null) applyFrame(g.units, g.grip.frame, g.matrix, g.mode === "rotate" ? g.angle : null, note);
      showHandles();
      return;
    }
    if (g.mode === "move") {
      lastTap = null;
      const [dx, dy] = moveDelta(g);
      const note = snapNote();
      painter.setDraft(null);
      current = null;
      moveSelection(g.units, dx, dy, note);
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
      if (unit !== null && unit.look !== null && has("text") && editable()) {
        lastTap = null;
        editText(unit);
        return;
      }
    }
    showHandles();
    announceSelection();
  };

  // --- I gesti dei nodi --------------------------------------------------------

  /// Quanti nodi ha il tracciato.
  const nodeCount = (subs: readonly Subpath[]): number => subs.reduce((count, sub) => count + sub.nodes.length, 0);

  /// Dove sta il nodo `key`, nella scena.
  const nodePoint = (now: Editing, key: NodeKey): Point => {
    const [s, at] = parseKey(key);
    return apply(now.matrix, now.subs[s]!.nodes[at]!);
  };

  /// Il nodo `key` a parole: quale, di che tipo e dove.
  const nodeText = (now: Editing, key: NodeKey): string => {
    const [s, at] = parseKey(key);
    let index = at + 1;
    for (let i = 0; i < s; i++) index += now.subs[i]!.nodes.length;
    const sub = now.subs[s]!;
    const end = !sub.closed && (at === 0 || at === sub.nodes.length - 1);
    const [x, y] = nodePoint(now, key);
    return t("draw.nodes.walk", {
      index,
      count: nodeCount(now.subs),
      kind: t(KIND_NAMES[end ? "end" : kindsOf(now.subs)(s, at)]),
      x: coordText(x),
      y: coordText(y),
    });
  };

  /// Di che cosa si modificano i nodi, o perché di niente; vuoto se non
  /// c'è niente di scelto.
  const targetText = (): string => {
    resolveNodes();
    if (editing !== null) {
      return plural(nodeCount(editing.subs), "draw.nodes.shown.one", "draw.nodes.shown.other", { object: labelOf(editing.unit) });
    }
    return noEditing === null ? "" : t(noEditing);
  };

  /// Dice di che cosa si modificano i nodi; senza niente di scelto, la
  /// selezione.
  const announceTarget = (): void => {
    const text = targetText();
    if (text === "") announceSelection();
    else announce(text);
  };

  /// I nodi scelti a parole: quello solo, o quanti.
  const announceNodes = (): void => {
    const now = editing;
    if (now !== null && nodeSelection.size === 1) {
      announce(nodeText(now, [...nodeSelection][0]!));
      return;
    }
    announce(nodeSelection.size === 0 ? t("draw.nodes.selected.none") : plural(nodeSelection.size, "draw.nodes.selected.one", "draw.nodes.selected.other"));
  };

  /// I nodi `keys` diventano quelli scelti.
  const setNodes = (keys: Iterable<NodeKey>): void => {
    nodeSelection = new Set(editing === null ? [] : presentNodes(editing.subs, keys));
    syncNodesBar();
    showHandles();
  };

  /// Lo spostamento da `a` a `b`, due punti della scena, nelle coordinate
  /// del tracciato.
  const localDelta = (now: Editing, a: Point, b: Point): Point => {
    const p = apply(now.inverse, a);
    const q = apply(now.inverse, b);
    return [q[0] - p[0], q[1] - p[1]];
  };

  /// Il nodo o la maniglia sotto `p`: il più vicino entro il raggio del
  /// puntatore, e a pari distanza il nodo.
  const grabAt = (now: Editing, p: Point, pointer: InkPointerType): { readonly node: NodeKey } | { readonly handle: HandleRef } | null => {
    const tolerance = NODE_PX[pointer] / camera.scale;
    const node = nodeAt(now.subs, now.matrix, p, tolerance);
    const handle = handleAt(now.subs, shownHandles(now.subs), now.matrix, p, tolerance);
    if (handle === null) return node === null ? null : { node };
    if (node === null) return { handle };
    const gap = (q: Point): number => Math.hypot(q[0] - p[0], q[1] - p[1]);
    return gap(apply(now.matrix, handlePoint(now.subs, handle)!)) < gap(nodePoint(now, node)) ? { handle } : { node };
  };

  /// Il tracciato come lo lascia il trascinamento, sul foglio e nei nodi.
  const showNodeDraft = (now: Editing, subs: readonly Subpath[]): void => {
    const d = pathData(writeNodes(subs));
    painter.setDraft({ paths: new Map(now.paints.map((paint) => [paint, d])) });
    showHandles();
  };

  /// Il primo punto di un gesto dei nodi. Un nodo si sceglie e si potrà
  /// trascinare, e con Maiusc si aggiunge o si toglie; una maniglia e un
  /// segmento si trascinano. Fuori dal tracciato, un altro oggetto, o
  /// un'altra forma dello stesso, diventa quello di cui si modificano i
  /// nodi; il vuoto comincia un riquadro.
  const nodesStart = (g: NodesGesture, p: Point): void => {
    g.from = p;
    g.end = p;
    const now = editing;
    if (now !== null) {
      const hit = grabAt(now, p, g.pointer);
      if (hit !== null && "node" in hit) {
        const chosen = nodeSelection.has(hit.node);
        if (!chosen) setNodes(shift ? [...nodeSelection, hit.node] : [hit.node]);
        g.grab = { kind: "node", key: hit.node, origin: nodePoint(now, hit.node), toggle: shift && chosen, only: !shift && chosen && nodeSelection.size > 1 };
        return;
      }
      if (hit !== null) {
        g.grab = { kind: "handle", handle: hit.handle, origin: apply(now.matrix, handlePoint(now.subs, hit.handle)!) };
        return;
      }
      const link = linkAt(now.subs, now.matrix, p, HIT_PX[g.pointer] / camera.scale);
      if (link !== null) {
        g.grab = { kind: "segment", sub: link.sub, link: link.link, t: link.t };
        return;
      }
    }
    const tolerance = HIT_PX[g.pointer] / camera.scale;
    const unit = currentIndex().at(p, tolerance);
    const shape = unit?.shapeAt(p, tolerance) ?? null;
    if (unit !== null && shape !== null && (now === null || unit.key !== now.unit.key || !samePath(pathOf(shape), now.path))) {
      preferredShape = pathOf(shape);
      select([unit.key]);
      g.grab = { kind: "none" };
      return;
    }
    g.grab = { kind: "marquee", objects: now === null, additive: shift };
    if (now === null && !shift) select([]);
  };

  /// Il gesto dei nodi fino al punto di adesso. Oltre la soglia trascina: un
  /// nodo con quelli scelti, e con l'aggancio il nodo preso sulla griglia;
  /// una maniglia; o il segmento, nel punto preso. Il riquadro sceglie.
  const nodesUpdate = (g: NodesGesture): void => {
    const grab = g.grab;
    if (g.from === null || g.end === null || grab === null || grab.kind === "none") return;
    if (!g.dragging) {
      if (Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * camera.scale <= DRAG_PX[g.pointer]) return;
      g.dragging = true;
      lastSegmentTap = null;
    }
    if (grab.kind === "marquee") {
      const [x1, y1] = g.from;
      const [x2, y2] = g.end;
      const area: Bounds = { min: [Math.min(x1, x2), Math.min(y1, y2)], max: [Math.max(x1, x2), Math.max(y1, y2)] };
      if (grab.objects) {
        selection = inOrder([...(grab.additive ? g.selection : []), ...currentIndex().within(area).map((unit) => unit.key)]);
        syncControls();
      } else if (editing !== null) {
        nodeSelection = new Set([...(grab.additive ? g.nodes : []), ...nodesWithin(editing.subs, editing.matrix, area)]);
        syncNodesBar();
      }
      showHandles();
      return;
    }
    const now = editing;
    if (now === null) return;
    const kinds = kindsOf(now.subs);
    if (grab.kind === "segment") {
      g.draft = bend(now.subs, grab.sub, grab.link, grab.t, localDelta(now, g.from, g.end), kinds);
    } else {
      const to = nodeDragTo(g, now, grab);
      g.draft = grab.kind === "node"
        ? moveNodes(now.subs, nodeSelection, localDelta(now, grab.origin, to), kinds)
        : moveHandle(now.subs, grab.handle, apply(now.inverse, to), kinds);
    }
    showNodeDraft(now, g.draft);
  };

  /// Il gesto dei nodi finisce. Un trascinamento si scrive; un tocco su un
  /// nodo lo sceglie da solo, o con Maiusc lo toglie; uno su un segmento
  /// sceglie i suoi due nodi, e il doppio tocco ci aggiunge un nodo; uno sul
  /// vuoto toglie la scelta dei nodi, poi quella dell'oggetto.
  const nodesEnd = (g: NodesGesture, time: number): void => {
    const note = snapNote();
    current = null;
    const grab: NodeGrab = g.grab ?? { kind: "none" };
    if (g.dragging) {
      if (grab.kind === "marquee") {
        showHandles();
        if (grab.objects) announceTarget();
        else announceNodes();
        return;
      }
      painter.setDraft(null);
      const draft = g.draft;
      if (draft === null || editing === null) {
        showHandles();
        return;
      }
      const label: DrawKey = grab.kind === "node" ? "draw.action.nodes_move" : grab.kind === "handle" ? "draw.action.handle" : "draw.action.bend";
      if (writeEdit(label, draft, nodeSelection, nodeKinds) !== true) return;
      if (grab.kind === "node") announceMoved(note);
      else announce(noted(t(grab.kind === "handle" ? "draw.nodes.handle_moved" : "draw.nodes.bent"), note));
      return;
    }
    const now = editing;
    switch (grab.kind) {
      case "node":
        if (grab.toggle) setNodes([...nodeSelection].filter((key) => key !== grab.key));
        else if (grab.only) setNodes([grab.key]);
        announceNodes();
        return;
      case "segment": {
        if (now === null || g.from === null) return;
        const tap = { sub: grab.sub, link: grab.link, time, at: g.from };
        const previous = lastSegmentTap;
        lastSegmentTap = tap;
        const again = previous !== null && previous.sub === tap.sub && previous.link === tap.link && tap.time - previous.time <= DOUBLE_TAP_MS &&
          Math.hypot(tap.at[0] - previous.at[0], tap.at[1] - previous.at[1]) * camera.scale <= DOUBLE_TAP_PX[g.pointer];
        if (again) {
          lastSegmentTap = null;
          const edited = insertNode(now.subs, grab.sub, grab.link, grab.t);
          if (writeEdit("draw.action.nodes_insert", edited.subs, edited.selected, remapped(nodeKinds, edited.moved)) === true) {
            announce(plural(edited.changed, "draw.nodes.inserted.one", "draw.nodes.inserted.other"));
          }
          return;
        }
        const sub = now.subs[grab.sub]!;
        const ends = [nodeKey(grab.sub, grab.link), nodeKey(grab.sub, (grab.link + 1) % sub.nodes.length)];
        setNodes(shift ? [...nodeSelection, ...ends] : ends);
        announceNodes();
        return;
      }
      case "marquee":
        if (grab.additive) return;
        if (grab.objects) announceSelection();
        else if (nodeSelection.size > 0) {
          setNodes([]);
          announceNodes();
        } else {
          select([]);
          announceSelection();
        }
        return;
      case "none":
        announceTarget();
        return;
      case "handle":
        return;
    }
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

  /// La forma del gesto `g` entra nel disegno, e lo si dice, con `note`, a
  /// che cosa si è agganciata.
  const finishShape = (g: ShapeGesture, note = ""): void => {
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
    if (commit(toolSpec(g.tool).label, asGesture(ops)) !== null) announce(noted(`${t(ADDED[g.tool])} ${objects()}`, note));
  };

  // --- La penna di Bézier ------------------------------------------------------
  //
  // Il tracciato si disegna in più gesti, e vive fra un gesto e l'altro: un
  // tocco mette uno spigolo, un trascinamento un nodo simmetrico, un tocco
  // sul primo nodo chiude il tracciato, uno sull'ultimo lo conclude. Si
  // scrive quando si conclude, in un passo solo; fino ad allora Annulla e
  // Ripeti percorrono i suoi passi.

  /// Il tracciato della penna, se ha almeno un nodo.
  const drawing = (): Drafting | null => (drafting !== null && drafting.nodes.length > 0 ? drafting : null);

  /// Vero se `p` prende il nodo in `node` col puntatore `pointer`.
  const onNode = (p: Point, node: Point, pointer: InkPointerType): boolean =>
    Math.hypot(p[0] - node[0], p[1] - node[1]) * camera.scale <= NODE_PX[pointer];

  /// Che cosa prende un tocco in `p`: il primo nodo, che chiude il
  /// tracciato, l'ultimo, o il vuoto, dove va un nodo nuovo. Fra il primo e
  /// l'ultimo, vicini, vince il più vicino; a pari distanza l'ultimo, così
  /// un nodo solo, che è l'uno e l'altro, non si chiude.
  const bezierTarget = (p: Point, pointer: InkPointerType): "add" | "close" | "last" => {
    const nodes = drafting?.nodes ?? [];
    const last = nodes[nodes.length - 1];
    if (last === undefined) return "add";
    const first = nodes[0]!;
    const closes = onNode(p, first.at, pointer);
    const ends = onNode(p, last.at, pointer);
    if (closes && ends) return Math.hypot(p[0] - first.at[0], p[1] - first.at[1]) < Math.hypot(p[0] - last.at[0], p[1] - last.at[1]) ? "close" : "last";
    return closes ? "close" : ends ? "last" : "add";
  };

  /// Dove va un nodo nuovo puntato in `p` col puntatore `pointer`:
  /// sull'incrocio della griglia o in linea con gli oggetti e coi nodi già
  /// posati, e con Maiusc a passi di 15° dall'ultimo nodo, come una linea.
  const bezierPoint = (p: Point, pointer: InkPointerType): Point => {
    const point = guided(p, bezierGuides, pointer);
    const nodes = drafting?.nodes ?? [];
    const last = nodes[nodes.length - 1];
    return shift && last !== undefined ? constrainEnd("line", last.at, point) : point;
  };

  /// La maniglia che il trascinamento di `g` tira dal suo nodo: sulla
  /// griglia o in linea con gli oggetti e coi nodi, e con Maiusc a passi di
  /// 15°. `null` per un tocco, o se torna sul nodo.
  const bezierHandle = (g: BezierGesture): Point | null => {
    if (!g.dragging || g.at === null || g.end === null) return null;
    const point = guided(g.end, bezierGuides, g.pointer);
    const handle = shift ? constrainEnd("line", g.at, point) : point;
    return Math.hypot(handle[0] - g.at[0], handle[1] - g.at[1]) * camera.scale <= DRAG_PX[g.pointer] ? null : handle;
  };

  /// I nodi come li lascia il gesto `g`, e se il tracciato si chiude.
  const bezierAfter = (g: BezierGesture): { readonly nodes: readonly PenNode[]; readonly closed: boolean } => {
    const nodes = (drafting?.nodes ?? []).slice();
    const handle = bezierHandle(g);
    if (g.mode === "add") nodes.push(penNode(g.at!, handle));
    // Trascinato, il primo nodo diventa simmetrico: il tracciato vi passa
    // senza spigolo. L'ultimo cambia solo la maniglia verso il nodo dopo.
    else if (g.mode === "close" && handle !== null) nodes[0] = penNode(nodes[0]!.at, handle);
    else if (g.mode === "last" && g.dragging) nodes[nodes.length - 1] = { ...nodes[nodes.length - 1]!, out: handle };
    return { nodes, closed: g.mode === "close" };
  };

  /// Il tracciato dei nodi `nodes` come lo scrive la penna, nelle coordinate
  /// del livello `to`, col colore e lo spessore di adesso. `null` se si
  /// scriverebbe in un punto.
  const bezierElem = (id: string, nodes: readonly PenNode[], closed: boolean, to: Destination): Elem | null => {
    const sub = penPath(nodes, closed, to.inverse);
    if (collapsed(sub)) return null;
    const { color, width } = style();
    return {
      tag: "path",
      attrs: {
        id,
        d: pathData(writeNodes([sub])),
        fill: "none",
        stroke: color,
        "stroke-width": formatNumber(width, 2),
        // Un tracciato chiuso non ha capi.
        ...(closed ? {} : { "stroke-linecap": "round" }),
        "stroke-linejoin": "round",
      },
    };
  };

  /// Sopra il tracciato della penna: il segmento che verrebbe dove punta il
  /// puntatore, le maniglie del nodo che il gesto tiene o dell'ultimo, e i
  /// nodi, pieno quello che il gesto tiene o che un tocco prenderebbe.
  const bezierHandles = (): OverlayHandle[] => {
    const g = current?.kind === "bezier" && current.mode !== null ? current : null;
    const nodes = g === null ? drafting?.nodes ?? [] : bezierAfter(g).nodes;
    const last = nodes[nodes.length - 1];
    if (last === undefined) return [];
    const out: OverlayHandle[] = [];
    const aim = g === null && hover !== null ? bezierTarget(hover.at, hover.pointer) : null;
    if (aim === "add" || aim === "close") {
      const next = aim === "close" ? nodes[0]! : penNode(bezierPoint(hover!.at, hover!.pointer), null);
      const identity: Matrix = [1, 0, 0, 1, 0, 0];
      out.push({ kind: "outline", segments: writeNodes([penPath([last, next], false, identity)]), matrix: identity });
    }
    const held = g?.mode === "close" ? 0 : nodes.length - 1;
    const node = nodes[held]!;
    for (const handle of [node.in, node.out]) if (handle !== null) out.push({ kind: "control", x: handle[0], y: handle[1], node: node.at });
    const hot = g !== null ? held : aim === "close" ? 0 : aim === "last" ? nodes.length - 1 : -1;
    nodes.forEach((each, i) => out.push({ kind: "node", x: each.at[0], y: each.at[1], shape: NODE_SHAPES[penKind(each)], selected: i === hot }));
    return out;
  };

  /// Il tracciato della penna come si scriverà, col gesto che lo cambia, e
  /// sopra i suoi nodi.
  function showBezier(): void {
    const g = current?.kind === "bezier" && current.mode !== null ? current : null;
    const to = g?.to ?? drafting?.to ?? null;
    const { nodes, closed } = g === null ? { nodes: drafting?.nodes ?? [], closed: false } : bezierAfter(g);
    const elem = to === null ? null : bezierElem("preview", nodes, closed, to);
    showShape(elem, to?.matrix ?? [1, 0, 0, 1, 0, 0]);
    showHandles();
  }

  /// Il nodo `at` del tracciato della penna a parole: quale, di che tipo e
  /// dove.
  const bezierNodeText = (nodes: readonly PenNode[], at: number): string => {
    const node = nodes[at]!;
    return t("draw.bezier.node", { index: at + 1, kind: t(KIND_NAMES[penKind(node)]), x: coordText(node.at[0]), y: coordText(node.at[1]) });
  };

  /// Il primo punto di un gesto della penna: che cosa prende, e il nodo.
  const bezierStart = (g: BezierGesture, p: Point): void => {
    g.from = p;
    g.mode = bezierTarget(p, g.pointer);
    const nodes = drafting?.nodes ?? [];
    g.at = g.mode === "add" ? bezierPoint(p, g.pointer) : g.mode === "close" ? nodes[0]!.at : nodes[nodes.length - 1]!.at;
    hover = null;
  };

  const bezierUpdate = (g: BezierGesture): void => {
    if (g.from === null || g.end === null) return;
    if (!g.dragging && Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * camera.scale > DRAG_PX[g.pointer]) g.dragging = true;
    showBezier();
  };

  /// Un passo del tracciato della penna: i nodi diventano `nodes`, e
  /// Ripeti non ha più niente da rimettere.
  const bezierStep = (draft: Drafting, nodes: readonly PenNode[], label: DrawKey, index: number): void => {
    draft.done.push({ nodes: draft.nodes, label, index });
    draft.undone.length = 0;
    draft.nodes = nodes;
  };

  /// La fine di un gesto della penna: il nodo entra nel tracciato, o il
  /// tracciato si chiude o si conclude.
  const bezierEnd = (g: BezierGesture): void => {
    const note = snapNote();
    current = null;
    if (g.mode === null) return;
    if (g.mode === "last" && !g.dragging) {
      finishBezier(false);
      return;
    }
    const { nodes, closed } = bezierAfter(g);
    if (closed) {
      drafting!.nodes = nodes;
      finishBezier(true);
      return;
    }
    const draft = drafting ?? { nodes: [], done: [], undone: [], to: g.to };
    bezierStep(draft, nodes, g.mode === "add" ? "draw.bezier.step.node" : "draw.bezier.step.handle", nodes.length);
    draft.to = g.to;
    drafting = draft;
    showBezier();
    syncControls();
    announce(noted(bezierNodeText(nodes, nodes.length - 1), note));
  };

  /// Il tracciato della penna non c'è più, né la sua anteprima. `false` se
  /// non c'era.
  function dropBezier(): boolean {
    if (drafting === null) return false;
    drafting = null;
    hover = null;
    showShape(null, [1, 0, 0, 1, 0, 0]);
    showHandles();
    syncControls();
    return true;
  }

  /// Il tracciato della penna entra nel disegno, sul livello di adesso, in
  /// un passo solo che si annulla. Un nodo solo non fa un tracciato. Se il
  /// livello non riceve, lo si dice e il tracciato resta, da concludere
  /// quando riceverà; `leaving`, perché lo strumento cambia, lo butta.
  function finishBezier(closed: boolean, leaving = false): void {
    const draft = drawing();
    if (draft === null || draft.nodes.length < 2) {
      dropBezier();
      if (draft !== null) announce(t("draw.bezier.short"));
      return;
    }
    // Il livello di adesso: mentre il tracciato cresceva, il disegno può
    // essere cambiato.
    const ids = newIds();
    const to = target(ids);
    if (to === null) {
      if (leaving) dropBezier();
      return;
    }
    dropBezier();
    const elem = bezierElem(ids.next("object"), draft.nodes, closed, to);
    if (elem === null) {
      announce(t("draw.bezier.short"));
      return;
    }
    const ops: Op[] = [...to.prelude, addOp(to, elem)];
    const page = pageFor(scene.root.page, elemBounds(elem, to.matrix));
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.bezier", asGesture(ops)) !== null) announce(`${t(closed ? "draw.added.path.closed" : "draw.added.path")} ${objects()}`);
  }

  /// Canc con la penna: l'ultimo nodo se ne va, in un passo che si annulla.
  const deleteBezierNode = (draft: Drafting): void => {
    const index = draft.nodes.length;
    bezierStep(draft, draft.nodes.slice(0, -1), "draw.bezier.step.delete", index);
    showBezier();
    syncControls();
    announce(t("draw.bezier.deleted", { index }));
  };

  /// Annulla e Ripeti valgono per il tracciato della penna finché ha passi
  /// da percorrere, poi per il disegno.
  const undoable = (): boolean => (drafting !== null && drafting.done.length > 0) || history.canUndo;
  const redoable = (): boolean => (drafting !== null && drafting.undone.length > 0) || (drawing() === null && history.canRedo);

  /// Un passo del tracciato della penna, annullato o ripetuto. Senza nodi il
  /// tracciato resta, vuoto, finché Ripeti può rimetterli.
  const replayBezier = (draft: Drafting, origin: "undo" | "redo"): void => {
    const step = (origin === "undo" ? draft.done : draft.undone).pop()!;
    (origin === "undo" ? draft.undone : draft.done).push({ ...step, nodes: draft.nodes });
    draft.nodes = step.nodes;
    showBezier();
    syncControls();
    announce(t(origin === "undo" ? "draw.undone" : "draw.redone", { action: t(step.label, { index: step.index }) }));
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

  // Maiusc, Ctrl o ⌘, e Alt si leggono dall'evento del puntatore prima della
  // pipeline, che ascolta in cattura sullo stesso elemento: registrato prima
  // di lei, questo ascolto la precede, e il gesto vede lo stato dell'evento
  // in corso.
  const readModifiers = (event: PointerEvent): void => {
    shift = event.shiftKey;
    free = event.ctrlKey || event.metaKey;
    alt = event.altKey;
  };
  /// La maniglia sotto il puntatore che passa senza premere, nel cursore.
  const hoverGrip = (event: PointerEvent): void => {
    const view = event.buttons === 0 ? frameNow() : null;
    if (view === null) {
      showGrip(null);
      return;
    }
    const point = screenToWorld(camera, localPoint(event.clientX, event.clientY));
    const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
    const grip = gripAt(view, [point.x, point.y], camera.scale, pointer);
    showGrip(grip === null ? null : gripCursor(view.frame, grip));
  };
  /// La guida del documento sotto il puntatore che passa, con lo strumento
  /// Selezione: si accende, e il cursore dice dove si sposta. Sopra un
  /// righello il cursore è la freccia; una maniglia della cornice viene
  /// prima.
  const hoverGuide = (event: PointerEvent): void => {
    const local = localPoint(event.clientX, event.clientY);
    const p: Point = [local.x, local.y];
    const ruler = rulerAt(p);
    if (ruler === null) delete surface.dataset.ruler;
    else surface.dataset.ruler = ruler;
    const guides = scene.root.guides;
    let hot: number | null = null;
    if (ruler === null && event.buttons === 0 && tool === "select" && editable() && guidesShown() && guides !== null && surface.dataset.grip === undefined) {
      const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
      hot = guideAt(guides, camera, p, GUIDE_HIT_PX[pointer], true);
    }
    if (hot !== null) surface.dataset.grip = guides![hot]!.axis === "x" ? "ew" : "ns";
    if (hot === hotGuide) return;
    hotGuide = hot;
    showGuideLines();
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
      const local = localPoint(event.clientX, event.clientY);
      downAt = [local.x, local.y];
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
      const point = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
      pointerAt = { at: [point.x, point.y], pointer };
      // Sopra il foglio, la penna di Bézier mostra il segmento che verrebbe.
      if (drawing() !== null && current === null && pressed === null) {
        hover = { at: [point.x, point.y], pointer };
        showBezier();
      }
      // Sopra una maniglia della cornice o una guida, il cursore dice che
      // cosa fa.
      if (current === null && pressed === null) {
        hoverGrip(event);
        hoverGuide(event);
      }
      // Con Alt, le misure seguono il puntatore.
      if (current === null && pressed === null && (alt || measured)) showHandles();
      // I righelli segnano dov'è.
      else if (rulersShown()) showRulers();
    },
    { capture: true },
  );
  // Col tasto destro, o col tocco lungo, i righelli e le guide del
  // documento hanno il loro menu, con qualunque strumento e anche per una
  // guida bloccata, che solo da qui si sblocca col puntatore. Altrove il
  // foglio resta com'è.
  life.listen(surface, "contextmenu", (event) => {
    const local = localPoint(event.clientX, event.clientY);
    const p: Point = [local.x, local.y];
    let items: MenuItem[] | null = null;
    if (rulerAt(p) !== null) items = rulerItems();
    else if (guidesShown() && scene.root.guides !== null) {
      const touch = "pointerType" in event && (event as PointerEvent).pointerType === "touch";
      const index = guideAt(scene.root.guides, camera, p, GUIDE_HIT_PX[touch ? "touch" : "mouse"], false);
      if (index !== null) items = guideItems(index);
    }
    if (items === null || items.length === 0) return;
    // Il tocco lungo che apre il menu non tira anche una guida.
    if (current !== null && current.kind !== "guide") return;
    event.preventDefault();
    if (current !== null) cancelGesture();
    showContextMenu(event, items);
  });
  // L'angolo fra i righelli apre il loro menu: l'unità, le guide, e
  // nasconderli.
  life.listen(surface, "click", (event) => {
    const local = localPoint(event.clientX, event.clientY);
    if (rulerAt([local.x, local.y]) === "corner") showContextMenu(event, rulerItems());
  });
  life.listen(surface, "pointerleave", () => {
    if (current === null) showGrip(null);
    surface.removeAttribute("data-ruler");
    if (hotGuide !== null && current === null) {
      hotGuide = null;
      showGuideLines();
    }
    pointerAt = null;
    if (rulersShown()) showRulers();
    if (hover !== null) {
      hover = null;
      showBezier();
    } else if (measured) {
      showHandles();
    }
  });

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
          g.from ??= guided(toPoint(samples[0]!), () => guidesFor(g, []), g.pointer);
          g.end = toPoint(samples[samples.length - 1]!);
          drawShape(g);
          break;
        case "select":
          if (g.from === null) selectStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          selectUpdate(g);
          break;
        case "nodes":
          if (g.from === null) nodesStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          nodesUpdate(g);
          break;
        case "bezier":
          if (g.from === null) bezierStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          bezierUpdate(g);
          break;
        case "erase":
          for (const sample of samples) eraseAlong(g, toPoint(sample));
          showErased(g);
          break;
        case "text":
          g.from ??= toPoint(samples[0]!);
          break;
        case "guide":
          guideUpdate(g, toPoint(samples[samples.length - 1]!));
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
        case "shape": {
          const note = snapNote();
          current = null;
          finishShape(g, note);
          showShape(null, g.to.matrix);
          if (guiding) showHandles();
          return;
        }
        case "select":
          selectEnd(g, stroke.timeStamp);
          return;
        case "nodes":
          nodesEnd(g, stroke.timeStamp);
          return;
        case "bezier":
          bezierEnd(g);
          return;
        case "erase":
          current = null;
          finishErase(g);
          return;
        case "text":
          current = null;
          if (g.from !== null) openText(g.from, g.pointer);
          return;
        case "guide":
          guideEnd(g, stroke.timeStamp);
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
      if (g.kind === "select" || g.kind === "guide") showGrip(null);
      // I nodi tornano com'erano, e l'oggetto con loro.
      if (g.kind === "nodes") {
        select(g.selection);
        setNodes(g.nodes);
      }
      clearPreviews();
      // Il tracciato della penna resta com'era prima del gesto.
      if (g.kind === "bezier") showBezier();
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
    if (look === null || model === null || !editable() || !has("text")) return;
    const text = editableText(nodeOf(model, unit).details?.lines ?? []);
    startTyping({ key: unit.key, before: text, look, at: [look.x, look.y], matrix: unit.matrix }, text);
  };

  /// F2, o «Modifica il testo»: il testo scelto, se è solo.
  function editSelectedText(): void {
    if (!editable() || !has("text")) return;
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
    if (!editable() || !has("text")) return;
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
      const area = viewArea();
      const center = screenToWorld(camera, { x: area.x + area.w / 2, y: area.y + area.h / 2 });
      cursor = [center.x, center.y];
    }
    return cursor;
  };

  /// La vista segue il cursore quando arriva al bordo, o sotto i righelli.
  const keepInView = (p: Point): void => {
    const { x: left, y: top, w, h } = viewArea();
    if (w === 0 || h === 0) return;
    const margin = Math.min(CURSOR_MARGIN_PX, w / 4, h / 4);
    const x = camera.tx + camera.scale * p[0] - left;
    const y = camera.ty + camera.scale * p[1] - top;
    const dx = x < margin ? margin - x : x > w - margin ? w - margin - x : 0;
    const dy = y < margin ? margin - y : y > h - margin ? h - margin - y : 0;
    if (dx === 0 && dy === 0) return;
    placed = true;
    setCamera({ ...camera, tx: camera.tx + dx, ty: camera.ty + dy });
  };

  /// Dove è il cursore, e che cosa c'è sotto: con la penna di Bézier, il
  /// primo nodo o l'ultimo, se un tocco lì chiude o conclude il tracciato.
  const announceCursor = (): void => {
    const p = cursorPoint();
    const at = t("draw.cursor.at", { x: coordText(p[0]), y: coordText(p[1]) });
    const aim = pressed === null && drawing() !== null ? bezierTarget(p, "mouse") : "add";
    if (aim !== "add") {
      announce(`${at}: ${t(aim === "close" ? "draw.bezier.cursor.close" : "draw.bezier.cursor.last")}`);
      return;
    }
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
    if (pressed === null && drawing() !== null) {
      hover = { at: next, pointer: "mouse" };
      showBezier();
    }
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
      x === 0 ? snapValue(cx, stepNow()) : lineBeyond(cx, stepNow(), sign(x), lines),
      y === 0 ? snapValue(cy, stepNow()) : lineBeyond(cy, stepNow(), sign(y), lines),
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
  const nodesFocus = rove(nodesBar);

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
    if (placeSelection(units, from, to)) announce(t("draw.resized", { width: lengthSpoken(width), height: lengthSpoken(height) }));
  };

  /// Con l'aggancio, le frecce portano l'angolo in alto a sinistra della
  /// geometria scelta alla riga `lines` righe più in là, sull'asse della
  /// freccia.
  const moveOnGrid = (x: number, y: number, lines: number): void => {
    const units = selectedUnits();
    const from = geometryOf(units);
    if (from === null) return;
    const [left, top] = from.min;
    const dx = x === 0 ? 0 : lineBeyond(left, stepNow(), sign(x), lines) - left;
    const dy = y === 0 ? 0 : lineBeyond(top, stepNow(), sign(y), lines) - top;
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
      direction === 0 || max <= min ? max : Math.max(lineBeyond(max, stepNow(), sign(direction), lines), lineBeyond(min, stepNow(), 1, 1));
    const right = edge(from.min[0], from.max[0], x);
    const bottom = edge(from.min[1], from.max[1], y);
    if (right === from.max[0] && bottom === from.max[1]) return;
    const m = boxMatrix(from, { min: from.min, max: [right, bottom] });
    const to = mappedBounds(shown, m);
    if (transformSelection(units, m, to)) {
      announce(t("draw.resized", { width: lengthSpoken(to.max[0] - to.min[0]), height: lengthSpoken(to.max[1] - to.min[1]) }));
    }
  };

  // --- Disporre ----------------------------------------------------------------

  /// Gli oggetti su cui lavora un comando della selezione, della parte
  /// `feature`: quelli scelti, se il livello offre la parte e il disegno si
  /// scrive. `null`, e lo si dice, se non c'è niente di scelto.
  const arranging = (feature: Feature): Unit[] | null => {
    if (!has(feature) || !editable()) return null;
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
    const units = arranging("arrange");
    if (units === null) return;
    // Con l'aggancio le copie si scostano di passi interi della griglia, e
    // ciò che ci stava sopra ci resta.
    const distance = COPY_STEP_PX / camera.scale;
    const step = gridOn() ? wholeSteps(distance, stepNow()) : roundDelta(distance);
    const arranged = duplicateOps(engine.model!, units, step, step, newIds());
    if (arranged === null) {
      announce(t("draw.duplicate.foreign"));
      return;
    }
    if (!arrange("draw.action.duplicate", arranged, translated(boundsOf(units), step, step))) return;
    announce(`${plural(units.length, "draw.duplicated.one", "draw.duplicated.other")} ${objects()}`);
  }

  function orderSelection(order: Order): void {
    const units = arranging("arrange");
    if (units === null) return;
    if (arrange("draw.action.order", orderOps(engine.model!, currentIndex(), units, order, newIds()))) announce(t(ORDERED[order]));
  }

  function groupSelection(): void {
    const units = arranging("arrange");
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
    const units = arranging("arrange");
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
    const units = arranging("links");
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
    const now = arranging("links");
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
    const units = arranging("links");
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
    const units = arranging("arrange");
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
    const units = arranging("arrange");
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

  /// Dà `change` ai contorni scelti, e dice quanti ne ha cambiati col nome
  /// della scelta.
  function outlineSelection(change: OutlineChange, style: string): void {
    const units = arranging("outline");
    if (units === null) return;
    if (outlinesOf(engine.model!, units).length === 0) {
      announce(t("draw.outline.none"));
      return;
    }
    const outlined = outlineOps(engine.model!, units, change, newIds());
    const label: DrawKey = "dash" in change ? "draw.action.dash" : "cap" in change ? "draw.action.cap" : "draw.action.join";
    if (arrange(label, outlined)) announce(plural(outlined.changed, "draw.outlined.one", "draw.outlined.other", { style }));
  }

  /// Le voci del contorno: i tratteggi, gli estremi e gli angoli, ciascuno
  /// una scelta, segnata se i contorni scelti l'hanno tutti. Un tratteggio
  /// che non è del menu c'è, segnato e spento, col suo valore.
  const outlineItems = (): MenuItem[] => {
    const model = engine.model;
    const outlines = model === null ? [] : outlinesOf(model, selectedUnits());
    const look = outlineLook(outlines);
    const none = outlines.length === 0;
    const choice = (label: string, checked: boolean, separator: boolean, change: OutlineChange): MenuItem => ({
      label,
      choice: "radio",
      checked,
      separator,
      disabled: none,
      run: () => outlineSelection(change, label),
    });
    const items: MenuItem[] = DASHES.map((dash) => choice(t(DASH_LABELS[dash]), look.dash === dash, false, { dash }));
    if (none) items[0]!.description = t("draw.outline.none");
    if (look.dash === "custom" && look.custom !== null) {
      items.push({ label: t("draw.outline.custom", { value: look.custom }), choice: "radio", checked: true, disabled: true, run: () => {} });
    }
    items.push(...CAPS.map((cap, at) => choice(t(CAP_LABELS[cap]), look.cap === cap, at === 0, { cap })));
    items.push(...JOINS.map((join, at) => choice(t(JOIN_LABELS[join]), look.join === join, at === 0, { join })));
    return items;
  };

  /// Ctrl+Maiusc+M, dal livello Esperto: ruota, scala e inclina gli oggetti
  /// scelti di quanto si scrive, attorno al centro del loro riquadro, in un
  /// passo solo. Il fuoco torna dov'era, come da ogni finestra.
  async function transformDialog(): Promise<void> {
    if (asking || arranging("transform") === null) return;
    const opened = loads;
    const scale = (id: string, label: DrawKey): FormField => ({
      id, label: t(label), value: "100", kind: "number", min: -MAX_SCALE_PERCENT, max: MAX_SCALE_PERCENT, nonZero: true,
    });
    const skew = (id: string, label: DrawKey): FormField => ({ id, label: t(label), value: "0", kind: "number", min: -MAX_SKEW, max: MAX_SKEW });
    asking = true;
    let answer: Readonly<Record<string, string>> | null;
    try {
      answer = await promptForm({
        title: t("draw.transform.title"),
        message: t("draw.transform.message"),
        okLabel: t("draw.transform.title"),
        fields: [
          { id: "rotate", label: t("draw.transform.rotate"), value: "0", kind: "number" },
          scale("scaleX", "draw.transform.scale_x"),
          scale("scaleY", "draw.transform.scale_y"),
          skew("skewX", "draw.transform.skew_x"),
          skew("skewY", "draw.transform.skew_y"),
        ],
      });
    } finally {
      asking = false;
    }
    if (answer === null || disposed || loads !== opened) return;
    // Mentre la finestra era aperta il disegno, o il livello, può essere
    // cambiato: valgono gli oggetti scelti adesso, attorno al loro centro.
    const units = arranging("transform");
    const from = units === null ? null : boundsOf(units);
    if (units === null || from === null) return;
    const value = (id: string, unchanged: number): number => {
      const number = Number(answer[id]);
      return Number.isFinite(number) ? number : unchanged;
    };
    const m = numericMatrix(
      {
        rotate: value("rotate", 0),
        scaleX: value("scaleX", 100) / 100,
        scaleY: value("scaleY", 100) / 100,
        skewX: value("skewX", 0),
        skewY: value("skewY", 0),
      },
      [(from.min[0] + from.max[0]) / 2, (from.min[1] + from.max[1]) / 2],
    );
    const transformed = numericOps(units, m, newIds());
    if (transformed === null) {
      announce(t("draw.transform.unwritable"));
      return;
    }
    if (arrange("draw.action.transform", transformed, boundsAfter(units, m))) {
      announce(plural(transformed.changed, "draw.transformed.one", "draw.transformed.other"));
    }
  }

  /// Dal livello Esperto: porta la trasformazione degli oggetti scelti nella
  /// loro geometria, e dice quanti ne ha cambiati e quanti ne conservano una
  /// parte, che la loro forma non sa scrivere.
  function applySelection(): void {
    const units = arranging("apply");
    if (units === null) return;
    const applied = applyOps(engine.model!, units, newIds());
    const kept = applied.kept === 0 ? "" : ` ${plural(applied.kept, "draw.applied.kept.one", "draw.applied.kept.other")}`;
    if (applied.ops.length === 0) {
      announce(`${t("draw.unchanged")}${kept}`);
      return;
    }
    if (arrange("draw.action.apply_transform", applied)) announce(`${plural(applied.changed, "draw.applied.one", "draw.applied.other")}${kept}`);
  }

  /// «Oggetto in tracciato», dal livello Esperto: gli oggetti scelti
  /// diventano `path`, che i nodi sanno modificare.
  function traceSelection(): void {
    const units = arranging("path");
    if (units === null) return;
    const traced = pathOps(engine.model!, units, newIds());
    const refused = traced.refused === 0 ? "" : ` ${plural(traced.refused, "draw.traced.refused.one", "draw.traced.refused.other")}`;
    if (traced.ops.length === 0) {
      announce(`${t("draw.unchanged")}${refused}`);
      return;
    }
    if (arrange("draw.action.to_path", traced)) announce(`${plural(traced.changed, "draw.traced.one", "draw.traced.other")}${refused}`);
  }

  /// Perché un'operazione booleana non si fa, a parole.
  const refusal = (refused: Refused): string =>
    refused.reason === "not_shapes" ? plural(refused.count, "draw.boolean.not_shapes.one", "draw.boolean.not_shapes.other") : t(REFUSALS[refused.reason]);

  /// Un'operazione booleana, dal livello Esperto: la forma più in basso fra
  /// quelle scelte diventa il risultato, o i pezzi della divisione, e le
  /// altre se ne vanno.
  function combineSelection(kind: BooleanKind): void {
    const units = arranging("boolean");
    if (units === null) return;
    const combined = combineOps(engine.model!, units, kind, newIds());
    if ("reason" in combined) {
      announce(refusal(combined));
      return;
    }
    const { label, action } = BOOLEANS.find((entry) => entry.kind === kind)!;
    if (!arrange(action, combined)) return;
    announce(kind === "division" ? t("draw.divided", { count: combined.pieces }) : plural(units.length, "draw.combined.one", "draw.combined.other", { action: t(label) }));
  }

  /// Le voci delle operazioni booleane: spente, e dicono perché, se fra gli
  /// oggetti scelti c'è qualcosa che non è una forma, o se le forme sono
  /// poche.
  const booleanItems = (): MenuItem[] => {
    const units = selectedUnits();
    const others = units.filter((unit) => !isShape(unit)).length;
    return BOOLEANS.map(({ kind, label }) => {
      const reason = others > 0
        ? refusal({ reason: "not_shapes", count: others })
        : units.length < (kind === "union" ? 1 : 2) ? refusal({ reason: "few" }) : null;
      return { label: t(label), disabled: reason !== null, ...(reason === null ? {} : { description: reason }), run: () => combineSelection(kind) };
    });
  };

  // --- I comandi dei nodi -----------------------------------------------------

  /// Scrive i nodi `subs` nel tracciato che si modifica, col nome `label`:
  /// il `d` intero, in un passo di annulla, e la pagina cresce se il
  /// tracciato ne esce. Un tracciato rimasto senza nodi se ne va. Dopo sono
  /// scelti i nodi `selected`, coi tipi dati `kinds`. Vero se ha scritto;
  /// falso se non c'era niente da cambiare; `null` se non si scrive, o il
  /// motore ha rifiutato.
  const writeEdit = (label: DrawKey, subs: readonly Subpath[], selected: Iterable<NodeKey>, kinds: ReadonlyMap<NodeKey, NodeKind>): boolean | null => {
    const now = editing;
    const model = engine.model;
    if (now === null || model === null || !editable()) return null;
    const segments = writeNodes(subs);
    const d = pathData(segments);
    const chosen = [...selected];
    if (d === pathData(writeNodes(now.subs))) {
      nodeKinds = kinds;
      setNodes(chosen);
      return false;
    }
    const node = nodeOf(model, now);
    const plan = new Plan(model, newIds());
    // L'oggetto è il tracciato stesso, o un gruppo che lo contiene e che
    // resta scelto.
    const alone = samePath(now.unit.path, now.path);
    let keys: string[];
    let extent: Bounds | null = null;
    if (segments.length === 0) {
      plan.ops.push({ op: "remove", target: node.facts.id ?? { path: [...now.path], tag: tagName(node) } });
      keys = alone ? [] : [now.unit.key];
    } else {
      const id = plan.idOf(node);
      plan.ops.push({ op: "set", id, attrs: { d } });
      keys = alone ? [id] : [now.unit.key];
      extent = elemBounds({ tag: "path", attrs: { ...Object.fromEntries(plainAttributes(node)), d } }, now.matrix);
    }
    if (!arrange(label, plan.finish(keys), extent)) return null;
    nodeKinds = kinds;
    setNodes(chosen);
    return true;
  };

  /// Il tracciato su cui lavora un comando dei nodi, coi nodi scelti. `null`,
  /// e lo si dice, se non ce n'è uno o se nessun nodo è scelto.
  const noding = (): Editing | null => {
    if (!editable()) return null;
    resolveNodes();
    if (editing === null) {
      announceTarget();
      return null;
    }
    if (nodeSelection.size === 0) {
      announce(t("draw.nodes.selected.none"));
      return null;
    }
    cancelGesture();
    return editing;
  };

  /// Dice che i nodi scelti si sono spostati: dove, se è uno solo, e `note`,
  /// a che cosa si sono agganciati.
  const announceMoved = (note = ""): void => {
    const now = editing;
    if (now !== null && nodeSelection.size === 1) {
      const [x, y] = nodePoint(now, [...nodeSelection][0]!);
      announce(noted(t("draw.nodes.moved.at", { x: coordText(x), y: coordText(y) }), note));
      return;
    }
    announce(noted(plural(nodeSelection.size, "draw.nodes.moved.one", "draw.nodes.moved.other"), note));
  };

  /// Insert, o «Aggiungi nodi»: un nodo a metà di ogni segmento fra due nodi
  /// scelti. Dopo sono scelti i nodi nuovi.
  function insertSelectedNodes(): void {
    const now = noding();
    if (now === null) return;
    const edited = insertNodes(now.subs, nodeSelection);
    if (edited.changed === 0) {
      announce(t("draw.nodes.insert.none"));
      return;
    }
    if (writeEdit("draw.action.nodes_insert", edited.subs, edited.selected, remapped(nodeKinds, edited.moved)) === true) {
      announce(plural(edited.changed, "draw.nodes.inserted.one", "draw.nodes.inserted.other"));
    }
  }

  /// Canc, o «Elimina nodi»: i segmenti attorno si uniscono in una curva che
  /// passa vicino a dov'erano. Mai l'oggetto: senza nodi scelti non elimina
  /// niente, ma un tracciato rimasto senza nodi se ne va.
  function deleteSelectedNodes(): void {
    const now = noding();
    if (now === null) return;
    const edited = deleteNodes(now.subs, nodeSelection);
    if (writeEdit("draw.action.nodes_delete", edited.subs, edited.selected, remapped(nodeKinds, edited.moved)) !== true) return;
    if (edited.subs.length === 0) announce(`${t("draw.nodes.deleted.all")} ${objects()}`);
    else announce(plural(edited.changed, "draw.nodes.deleted.one", "draw.nodes.deleted.other"));
  }

  /// Maiusc+C, S o Y: i nodi scelti a spigolo, lisci o simmetrici. Il tipo
  /// resta ai nodi anche dove la geometria non cambia, come per lo spigolo.
  function kindSelectedNodes(kind: NodeKind): void {
    const now = noding();
    if (now === null) return;
    const edited = setKind(now.subs, nodeSelection, kind);
    if (edited.changed === 0) {
      announce(t("draw.nodes.kind.none"));
      return;
    }
    const kinds = remapped(nodeKinds, edited.moved);
    for (const key of edited.selected) {
      const [s, at] = parseKey(key);
      if (innerNode(edited.subs[s]!, at)) kinds.set(key, kind);
    }
    if (writeEdit("draw.action.nodes_kind", edited.subs, edited.selected, kinds) === null) return;
    const [one, other] = MADE[kind];
    announce(plural(edited.changed, one, other));
  }

  /// Maiusc+L o U: i segmenti fra due nodi scelti in linee o in curve.
  function linkSelectedNodes(kind: "line" | "curve"): void {
    const now = noding();
    if (now === null) return;
    const edited = setLinks(now.subs, nodeSelection, kind);
    if (edited.changed === 0) {
      announce(t(linksBetween(now.subs, nodeSelection).any ? "draw.unchanged" : "draw.nodes.links.none"));
      return;
    }
    if (writeEdit("draw.action.segments", edited.subs, edited.selected, remapped(nodeKinds, edited.moved)) === null) return;
    announce(kind === "line"
      ? plural(edited.changed, "draw.nodes.lines.one", "draw.nodes.lines.other")
      : plural(edited.changed, "draw.nodes.curves.one", "draw.nodes.curves.other"));
  }

  /// Maiusc+B: il tracciato si spezza ai nodi scelti.
  function breakSelectedNodes(): void {
    const now = noding();
    if (now === null) return;
    const edited = breakNodes(now.subs, nodeSelection);
    if (edited.changed === 0) {
      announce(t("draw.nodes.break.none"));
      return;
    }
    if (writeEdit("draw.action.nodes_break", edited.subs, edited.selected, remapped(nodeKinds, edited.moved)) === null) return;
    announce(plural(edited.changed, "draw.nodes.broken.one", "draw.nodes.broken.other"));
  }

  /// Maiusc+J: unisce i due capi scelti.
  function joinSelectedNodes(): void {
    const now = noding();
    if (now === null) return;
    const edited = joinNodes(now.subs, nodeSelection);
    if (edited === null) {
      announce(t("draw.nodes.join.none"));
      return;
    }
    const closed = edited.subs.length === now.subs.length;
    if (writeEdit("draw.action.nodes_join", edited.subs, edited.selected, remapped(nodeKinds, edited.moved)) === null) return;
    announce(t(closed ? "draw.nodes.closed" : "draw.nodes.joined"));
  }

  /// Un comando dei nodi di Maiusc e una lettera.
  const runNodeCommand = (command: NodeCommand): void => {
    if (command === "line" || command === "curve") linkSelectedNodes(command);
    else if (command === "break") breakSelectedNodes();
    else if (command === "join") joinSelectedNodes();
    else kindSelectedNodes(command);
  };

  /// Le frecce coi nodi scelti: li spostano di 1, di 10 con Maiusc, di un
  /// pixel dello schermo con Ctrl o ⌘. Con l'aggancio l'angolo in alto a
  /// sinistra del loro riquadro va di riga in riga della griglia, cinque con
  /// Maiusc, sull'asse della freccia.
  const nudgeNodes = (x: number, y: number, fine: boolean, big: boolean): void => {
    const now = noding();
    if (now === null) return;
    let delta: Point;
    if (fine) {
      delta = [x / camera.scale, y / camera.scale];
    } else if (gridOn()) {
      const [left, top] = nodesBox(now)!.min;
      const lines = big ? GRID_MAJOR : 1;
      delta = [x === 0 ? 0 : lineBeyond(left, stepNow(), sign(x), lines) - left, y === 0 ? 0 : lineBeyond(top, stepNow(), sign(y), lines) - top];
    } else {
      const step = big ? NUDGE_SHIFT : NUDGE;
      delta = [x * step, y * step];
    }
    moveSelectedNodes(now, delta);
  };

  /// Sposta i nodi scelti di `delta`, nella scena, e lo dice.
  const moveSelectedNodes = (now: Editing, delta: Point): void => {
    const subs = moveNodes(now.subs, nodeSelection, localDelta(now, [0, 0], delta), kindsOf(now.subs));
    if (writeEdit("draw.action.nodes_move", subs, nodeSelection, nodeKinds) === true) announceMoved();
  };

  /// Il riquadro dei nodi scelti, nella scena.
  const nodesBox = (now: Editing): Bounds | null => {
    const box = new BoundsBuilder();
    for (const key of presentNodes(now.subs, nodeSelection)) box.include(nodePoint(now, key));
    return box.finish();
  };

  /// Porta gli oggetti scelti in cima a `layer`, dove si vedevano.
  function moveIntoLayer(layer: LayerInfo): void {
    const units = arranging("layers");
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

  /// Il livello su cui lavora un comando dei livelli: quello corrente, se
  /// l'interfaccia offre i livelli e il disegno si scrive.
  const layering = (): LayerInfo | null => {
    if (!has("layers") || !editable()) return null;
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
    if (!has("layers")) return;
    choose(layer);
    const name = layerTitle(layer);
    const refusal = layerRefusal(layer);
    announce(refusal === null ? t("draw.layer.chosen", { name }) : `${t("draw.layer.chosen", { name })} ${t(refusal, { name })}`);
  }

  /// Un livello nuovo e vuoto sopra quello corrente, che diventa lui.
  function addLayer(): void {
    if (!has("layers") || !editable()) return;
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
    showGuideLines();
    // I righelli, e la cornice che segnano.
    showHandles();
    const unit = docUnit();
    if (grid.shown !== before.shown) announce(t(grid.shown ? "draw.grid.shown" : "draw.grid.hidden"));
    else if (grid.snap !== before.snap) announce(t(grid.snap ? "draw.grid.snap.on" : "draw.grid.snap.off"));
    else if (!sameStep(gridStep(grid, unit), gridStep(before, unit))) announce(t("draw.grid.stepped", { step: lengthSpoken(stepNow()) }));
    else if (grid.guides !== before.guides) announce(t(grid.guides ? "draw.guides.on" : "draw.guides.off"));
    else if (grid.rulers !== before.rulers) announce(t(grid.rulers ? "draw.rulers.shown" : "draw.rulers.hidden"));
    else if (grid.rulerGuides !== before.rulerGuides) announce(t(grid.rulerGuides ? "draw.rulers.guides.shown" : "draw.rulers.guides.hidden"));
    else return;
    options.onGridChange?.(grid);
  };

  /// L'unità del documento diventa `unit`: un passo di annulla, e il disegno
  /// resta com'è. I pixel non si scrivono, perché sono l'unità di serie.
  const setUnits = (unit: LengthUnit): void => {
    if (unit === docUnit() || !editable()) return;
    if (commit("draw.action.units", { op: "set", id: ROOT, attrs: { "fub:units": unit === "px" ? null : unit } }) === null) return;
    announce(t(UNITS_NOW[unit]));
  };

  /// Le unità del documento, una fra cinque.
  const unitItems = (): MenuItem[] =>
    UNITS.map((unit): MenuItem => ({
      label: t(UNIT_NAMES[unit]),
      choice: "radio",
      checked: unit === docUnit(),
      disabled: !editable(),
      run: () => setUnits(unit),
    }));

  /// Le voci di tutte le guide del documento: «Guide…», bloccarle o
  /// sbloccarle, eliminarle.
  const allGuidesItems = (): MenuItem[] => {
    const guides = scene.root.guides;
    const count = guides?.length ?? 0;
    const usable = editable() && count > 0;
    const allLocked = count > 0 && guides!.every((each) => each.locked);
    return [
      { label: t("draw.guides.dialog"), separator: true, disabled: !editable(), run: () => void editGuides(null) },
      { label: t(allLocked ? "draw.guides.unlock_all" : "draw.guides.lock_all"), disabled: !usable, run: () => lockAllGuides(!allLocked) },
      { label: t("draw.guides.delete_all"), danger: true, disabled: !usable, run: () => deleteAllGuides() },
    ];
  };

  /// Le voci di una guida, col tasto destro o col tocco lungo: bloccarla o
  /// sbloccarla, eliminarla, e quelle di tutte le guide.
  const guideItems = (index: number): MenuItem[] => {
    const guide = scene.root.guides?.[index];
    if (guide === undefined) return [];
    const canEdit = editable();
    const [dialog, ...rest] = allGuidesItems();
    return [
      { label: t(guide.locked ? "draw.guide.unlock" : "draw.guide.lock"), disabled: !canEdit, run: () => lockGuide(index, !guide.locked) },
      { label: t("draw.guide.delete"), danger: true, disabled: !canEdit, run: () => deleteGuide(index) },
      { ...dialog!, run: () => void editGuides(index) },
      ...rest,
    ];
  };

  /// Le voci dei righelli, dal loro angolo o col tasto destro: l'unità, le
  /// guide, e nasconderli.
  const rulerItems = (): MenuItem[] => [
    ...unitItems(),
    {
      label: t("draw.rulers.guides.show"),
      choice: "checkbox",
      checked: grid.rulerGuides,
      hint: "|",
      separator: true,
      run: () => changeGrid({ ...grid, rulerGuides: !grid.rulerGuides }),
    },
    ...allGuidesItems(),
    { label: t("draw.rulers.hide"), hint: displayBinding(RULERS_BINDING), separator: true, run: () => changeGrid({ ...grid, rulers: false }) },
  ];

  /// «Adatta la pagina al disegno»: la pagina va attorno a tutto il disegno,
  /// livelli bloccati e nascosti compresi, con un margine. È un passo di
  /// annulla, e gli oggetti restano dove sono.
  function fitPage(): void {
    if (!has("grid") || !editable()) return;
    cancelGesture();
    const extent = indexer.extent(engine.model!);
    const viewBox = fittedPage(scene.root.page, extent);
    if (viewBox === null) {
      announce(t(extent === null ? "draw.page.fit.empty" : "draw.page.fit.already"));
      return;
    }
    if (commit("draw.action.fit_page", { op: "page", viewBox }) === null) return;
    const page = scene.root.page;
    if (page !== null) announce(t("draw.page.fitted", { width: lengthSpoken(page.width), height: lengthSpoken(page.height) }));
  }

  /// Le voci di «Pagina e griglia»: la griglia, il suo passo nell'unità del
  /// documento, le guide intelligenti, i righelli con le loro guide e
  /// l'unità, e la pagina, ciascuna se il livello la offre. Adattare la
  /// pagina si spegne, e dice perché, quando non cambierebbe niente.
  const pageItems = (): MenuItem[] => {
    const unit = docUnit();
    const step = stepNow();
    const offered = unitSteps(unit);
    const steps = offered.some((each) => sameStep(each, step)) ? offered : [...offered, step].sort((a, b) => a - b);
    const extent = engine.model === null ? null : indexer.extent(engine.model);
    const viewBox = fittedPage(scene.root.page, extent);
    const fitItem: MenuItem = { label: t("draw.page.fit"), separator: true, disabled: !editable() || viewBox === null, run: () => fitPage() };
    if (extent === null) fitItem.description = t("draw.page.fit.empty");
    else if (viewBox === null) fitItem.description = t("draw.page.fit.already");
    const guidesItem: MenuItem = {
      label: t("draw.feature.guides"),
      choice: "checkbox",
      checked: grid.guides,
      separator: has("grid"),
      description: t("draw.guides.hint", { key: modifierName("Mod") ?? "Ctrl" }),
      run: () => changeGrid({ ...grid, guides: !grid.guides }),
    };
    const rulersItems: MenuItem[] = has("rulers")
      ? [
          {
            label: t("draw.rulers.show"),
            choice: "checkbox",
            checked: grid.rulers,
            hint: displayBinding(RULERS_BINDING),
            separator: true,
            run: () => changeGrid({ ...grid, rulers: !grid.rulers }),
          },
          {
            label: t("draw.rulers.guides.show"),
            choice: "checkbox",
            checked: grid.rulerGuides,
            hint: "|",
            description: t("draw.rulers.guides.hint"),
            run: () => changeGrid({ ...grid, rulerGuides: !grid.rulerGuides }),
          },
          { label: t("draw.guides.dialog"), disabled: !editable(), run: () => void editGuides(null) },
          {
            label: t("draw.units.item", { unit: t(UNIT_NAMES[unit]) }),
            description: t("draw.units.hint"),
            disabled: !editable(),
            run: () => openMenu(pageButton, unitItems()),
          },
        ]
      : [];
    if (!has("grid")) return [...(has("guides") ? [guidesItem] : []), ...rulersItems];
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
      ...steps.map((each, at): MenuItem => ({
        label: t("draw.grid.step", { step: lengthText(each) }),
        choice: "radio",
        checked: sameStep(each, step),
        separator: at === 0,
        run: () => changeGrid(withStep(grid, unit, each)),
      })),
      ...(has("guides") ? [guidesItem] : []),
      ...rulersItems,
      fitItem,
    ];
  };

  // --- Frecce, finestre ed elenco dei tasti -----------------------------------

  /// Alt+F10: il fuoco va alla barra della selezione, o a quella dei nodi,
  /// se c'è. Una barra dei nodi senza un pulsante che serva dice perché.
  const focusArrange = (): boolean => {
    if (!nodesBar.hidden) {
      nodesFocus.sync(null);
      const target = nodesFocus.current();
      if (target === null) announce(t("draw.nodes.selected.none"));
      else target.focus();
      return true;
    }
    if (arrangeBar.hidden) return false;
    arrangeFocus.sync(null);
    const target = arrangeFocus.current();
    if (target === null) return false;
    target.focus();
    return true;
  };

  /// Vero se i tasti valgono per i nodi: lo strumento Nodi ha un tracciato
  /// da modificare, e la tastiera non sta premendo.
  const nodeKeysOn = (): boolean => {
    if (tool !== "nodes" || pressed !== null) return false;
    resolveNodes();
    return editing !== null;
  };

  /// Le frecce sul foglio. Con una selezione la spostano, e con Ctrl o ⌘ la
  /// ridimensionano; senza, o mentre la tastiera preme, muovono il cursore.
  /// Con l'aggancio vanno di riga in riga della griglia, cinque con Maiusc.
  /// Con lo strumento Nodi spostano i nodi scelti, e senza il cursore: mai
  /// l'oggetto. Con la penna di Bézier muovono sempre il cursore, che mette
  /// i nodi.
  const arrows = (event: KeyboardEvent): boolean => {
    const direction = ARROWS[event.key];
    if (direction === undefined) return false;
    const [x, y] = direction;
    const fine = event.ctrlKey || event.metaKey;
    const lines = event.shiftKey ? GRID_MAJOR : 1;
    if (nodeKeysOn() && nodeSelection.size > 0) {
      nudgeNodes(x, y, fine, event.shiftKey);
      return true;
    }
    if (tool !== "nodes" && tool !== "bezier" && pressed === null && selection.length > 0 && editable()) {
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

  /// Sceglie da solo il nodo `at` del tracciato, in ordine, lo porta in
  /// vista e lo dice. `false` se non c'è.
  const visitNode = (at: number): boolean => {
    const now = editing;
    const key = now === null ? undefined : allNodes(now.subs)[at];
    if (now === null || key === undefined) return false;
    cancelGesture();
    setNodes([key]);
    const p = nodePoint(now, key);
    frameBounds({ min: p, max: p });
    announce(nodeText(now, key));
    return true;
  };

  /// Tab con lo strumento Nodi: il nodo dopo l'ultimo scelto, o con Maiusc
  /// quello prima del primo; senza nodi scelti, il primo o l'ultimo. Oltre
  /// le estremità, `false`.
  const walkNodes = (step: 1 | -1): boolean => {
    const keys = allNodes(editing!.subs);
    const chosen = keys.flatMap((key, i) => (nodeSelection.has(key) ? [i] : []));
    if (chosen.length === 0) return visitNode(step > 0 ? 0 : keys.length - 1);
    return visitNode(step > 0 ? chosen[chosen.length - 1]! + 1 : chosen[0]! - 1);
  };

  /// Tab con una selezione: l'oggetto dopo l'ultimo scelto, o con Maiusc
  /// quello prima del primo. Oltre le estremità il Tab esce dal foglio. Con
  /// lo strumento Nodi passa prima di nodo in nodo, e oltre l'ultimo
  /// all'oggetto dopo.
  const walk = (step: 1 | -1): boolean => {
    if (nodeKeysOn() && walkNodes(step)) return true;
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
      if (tool === "nodes" && nodeSelection.size > 0 && editing !== null) await placeNodesDialog();
      else if (selection.length > 0) await placeDialog();
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
    const fields = [
      lengthField("x", "X", before.min[0]),
      lengthField("y", "Y", before.min[1]),
      // Un lato più corto di un centesimo non ha una misura da scrivere.
      { ...lengthField("w", t("draw.field.width"), w, 0.01), disabled: w < 0.01 },
      { ...lengthField("h", t("draw.field.height"), h, 0.01), disabled: h < 0.01 },
    ];
    const shown = fields.map((field) => field.value);
    const answer = await promptForm({ title: t("draw.properties.selection"), fields });
    if (answer === null || disposed || !editable()) return;
    // Mentre la finestra era aperta il disegno può essere cambiato: valgono
    // gli oggetti scelti adesso, e i campi non toccati restano esatti.
    const units = selectedUnits();
    const from = boundsOf(units);
    if (from === null) return;
    const exact = [from.min[0], from.min[1], from.max[0] - from.min[0], from.max[1] - from.min[1]];
    const value = (id: string, at: number): number => (answer[id] === undefined || answer[id] === shown[at] ? exact[at]! : fieldValue(answer[id]));
    const [x, y, width, height] = [value("x", 0), value("y", 1), value("w", 2), value("h", 3)];
    if (width === exact[2] && height === exact[3]) {
      moveSelection(units, x - from.min[0], y - from.min[1]);
      return;
    }
    if (placeSelection(units, from, { min: [x, y], max: [x + width, y + height] })) {
      announce(t("draw.resized", { width: lengthSpoken(width), height: lengthSpoken(height) }));
    }
  };

  /// Invio coi nodi scelti: dove sta l'angolo in alto a sinistra del loro
  /// riquadro, nella scena; per un nodo solo, il nodo. Un campo non toccato
  /// resta esatto.
  const placeNodesDialog = async (): Promise<void> => {
    const before = editing === null ? null : nodesBox(editing);
    if (before === null) return;
    const fields = [lengthField("x", "X", before.min[0]), lengthField("y", "Y", before.min[1])];
    const shown = fields.map((field) => field.value);
    const answer = await promptForm({ title: t("draw.nodes.place"), fields });
    if (answer === null || disposed || !editable()) return;
    // Mentre la finestra era aperta il disegno può essere cambiato: valgono
    // i nodi scelti adesso.
    const now = editing;
    const from = now === null ? null : nodesBox(now);
    if (now === null || from === null) return;
    const value = (id: string, at: number): number => (answer[id] === undefined || answer[id] === shown[at] ? from.min[at]! : fieldValue(answer[id]));
    const delta: Point = [value("x", 0) - from.min[0], value("y", 1) - from.min[1]];
    if (delta[0] === 0 && delta[1] === 0) return;
    moveSelectedNodes(now, delta);
  };

  const documentDialog = async (): Promise<void> => {
    const title = rootText("title");
    const desc = rootText("desc");
    const page = scene.root.page;
    const fields: FormField[] = [
      { id: "title", label: t("draw.field.title"), value: title, kind: "text" },
      { id: "desc", label: t("draw.field.desc"), value: desc, kind: "multiline" },
    ];
    const sizeFields = page === null ? null : [lengthField("w", t("draw.field.page_width"), page.width, 1), lengthField("h", t("draw.field.page_height"), page.height, 1)];
    const size = sizeFields?.map((field) => field.value) ?? null;
    if (sizeFields !== null) fields.push(...sizeFields);
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
      const width = answer.w === size[0] ? now.width : fieldValue(answer.w ?? "");
      const height = answer.h === size[1] ? now.height : fieldValue(answer.h ?? "");
      ops.push({ op: "page", viewBox: [now.x, now.y, width, height].map((v) => formatNumber(v, PLACES)).join(" ") });
    }
    commit("draw.properties.document", asGesture(ops));
  };

  /// I tasti dei comandi della selezione, delle parti `at` che ne hanno.
  const arrangeKeys = (at: ReadonlySet<Feature>): KeyGroup[] => {
    if (!BAR_FEATURES.some((feature) => at.has(feature))) return [];
    const arrange = at.has("arrange");
    const links = at.has("links");
    const rows: KeyGroup["rows"] = [
      ...(arrange ? ([["Mod-d", t("draw.duplicate")], ["Mod-g", t("draw.group")], ["Mod-Shift-g", t("draw.ungroup")]] as const) : []),
      ...(links && options.links !== undefined ? [["Mod-k", t("draw.keys.link")] as const] : []),
      ...(links ? [["Mod-Shift-k", t("draw.unlink")] as const] : []),
      ...(arrange
        ? ([
            ["Mod-Shift-] Shift-PageUp", t("draw.order.front")],
            ["Mod-] PageUp", t("draw.order.forward")],
            ["Mod-[ PageDown", t("draw.order.backward")],
            ["Mod-Shift-[ Shift-PageDown", t("draw.order.back")],
          ] as const)
        : []),
      ...(at.has("transform") ? [[TRANSFORM_BINDING, t("draw.transform")] as const] : []),
      ["Alt-F10", t("draw.keys.arrange")],
    ];
    return [{ title: t("draw.arrange"), rows }];
  };

  /// I tasti della griglia, se le parti `at` la offrono.
  const gridKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("grid")
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

  /// I tasti delle guide intelligenti, se le parti `at` le offrono.
  const guidesKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("guides")
      ? [
          {
            title: t("draw.keys.guides"),
            rows: [
              ["Mod", t("draw.keys.guides.free")],
              ["Alt", t("draw.keys.guides.measure")],
            ],
          },
        ]
      : [];

  /// I tasti dei righelli, se le parti `at` li offrono.
  const rulersKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("rulers")
      ? [
          {
            title: t("draw.keys.rulers"),
            rows: [
              [RULERS_BINDING, t("draw.keys.rulers.show")],
              ["|", t("draw.keys.rulers.guides")],
              ["Mod", t("draw.keys.rulers.free")],
            ],
          },
        ]
      : [];

  /// I tasti degli attributi, se le parti `at` li offrono.
  const attributeKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("attributes")
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

  /// I tasti del testo, se le parti `at` lo offrono.
  const textKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("text")
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

  /// I tasti dello strumento Nodi, se le parti `at` lo offrono.
  const nodeToolKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("nodes")
      ? [
          {
            title: t("draw.tool.nodes"),
            rows: [
              [ARROW_KEYS, t(gridOn(at) ? "draw.keys.nodes.nudge.grid" : "draw.keys.nodes.nudge")],
              ["Tab Shift-Tab", t("draw.keys.nodes.walk")],
              ["Home End", t("draw.keys.nodes.ends")],
              ["Mod-a", t("draw.keys.nodes.all")],
              ["Enter", t("draw.nodes.place")],
              ["Insert", t("draw.nodes.insert")],
              ["Delete", t("draw.nodes.delete")],
              ["Shift-c", t("draw.nodes.corner")],
              ["Shift-s", t("draw.nodes.smooth")],
              ["Shift-y", t("draw.nodes.symmetric")],
              ["Shift-l", t("draw.nodes.line")],
              ["Shift-u", t("draw.nodes.curve")],
              ["Shift-b", t("draw.nodes.break")],
              ["Shift-j", t("draw.nodes.join")],
              ["Escape", t("draw.keys.nodes.deselect")],
              ["Alt-F10", t("draw.keys.nodes.bar")],
            ],
          },
        ]
      : [];

  /// I tasti della penna di Bézier, se le parti `at` la offrono.
  const bezierKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("bezier")
      ? [
          {
            title: t("draw.tool.bezier"),
            rows: [
              ["Space", t("draw.keys.bezier.node")],
              ["Shift", t("draw.keys.bezier.angle")],
              ["Enter Escape", t("draw.keys.bezier.finish")],
              ["Delete", t("draw.keys.bezier.delete")],
            ],
          },
        ]
      : [];

  /// L'elenco dei tasti delle parti `at`, nei gruppi in cui si usano.
  const keyGroups = (at: ReadonlySet<Feature>): KeyGroup[] => [
    { title: t("draw.keys.tools"), rows: toolsOf(at).map((spec) => [spec.shortcut, t(spec.label)] as const) },
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
        ["[ ]", t("draw.keys.rotate")],
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
    ...nodeToolKeys(at),
    ...bezierKeys(at),
    ...textKeys(at),
    ...gridKeys(at),
    ...guidesKeys(at),
    ...rulersKeys(at),
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
        ...(insertsImages(at) ? [[IMAGE_BINDING, t("draw.image.vault")] as const] : []),
        ["?", t("draw.keys")],
      ],
    },
  ];

  /// I tasti che i livelli sopra quello di adesso aggiungono, col livello da
  /// cui valgono: una riga è nuova se il suo gruppo non aveva i suoi tasti.
  /// Per il Personalizzato sono quelli delle parti che non ha, col livello
  /// pronto da cui valgono.
  const moreKeys = (): MoreKeys => {
    const seen = new Set<string>();
    const remember = (group: KeyGroup, keys: string): boolean => {
      const id = `${group.title}\u0000${keys}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    };
    for (const group of keyGroups(features)) for (const [keys] of group.rows) remember(group, keys);
    const groups: KeyGroup[] = [];
    for (const above of levelsAbove(level)) {
      for (const group of keyGroups(featuresFor(above))) {
        const rows = group.rows.filter(([keys]) => remember(group, keys));
        if (rows.length > 0) groups.push({ title: t("draw.keys.from_level", { group: group.title, level: t(LEVEL_NAMES[above]) }), rows });
      }
    }
    return { groups, note: level === "custom" ? t("draw.keys.more.custom") : t("draw.keys.more", { level: t(LEVEL_NAMES[level]) }) };
  };

  /// «?»: l'elenco dei tasti di questo livello, e con «Mostra tutto» quelli
  /// dei livelli sopra. Il livello non si cambia da qui: lo sceglie chi
  /// prepara il vault, e l'Essenziale resta tale anche in mano a un bambino.
  async function keys(): Promise<void> {
    if (asking) return;
    asking = true;
    cancelGesture();
    try {
      await showKeys(t("draw.keys"), keyGroups(features), moreKeys());
    } finally {
      asking = false;
    }
  }

  // --- Le immagini incollate --------------------------------------------------

  const codec = options.imageCodec === undefined ? browserCodec() : options.imageCodec;

  /// Un peso come si legge: KiB sotto il MiB, MiB sopra.
  const sizeText = (bytes: number): string =>
    bytes < 1024 * 1024 ? `${numberText(bytes / 1024)} KiB` : `${numberText(bytes / (1024 * 1024))} MiB`;

  /// Ciò che si vede del foglio, nella scena: fuori dai righelli.
  const viewBounds = (): Bounds => {
    const area = viewArea();
    const a = screenToWorld(camera, { x: area.x, y: area.y });
    const b = screenToWorld(camera, { x: area.x + area.w, y: area.y + area.h });
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
      placeImages(
        pictures.map((picture) => ({
          width: picture.decoded.width,
          height: picture.decoded.height,
          href: dataUri(picture.encoded.type, picture.encoded.bytes),
        })),
        at,
      );
    } finally {
      for (const picture of pictures) picture.decoded.close();
      asking = false;
    }
  }

  /// Un'immagine da mettere sul foglio: le misure in pixel e l'`href`.
  interface Placed {
    readonly width: number;
    readonly height: number;
    readonly href: string;
  }

  /// Le immagini nel livello che riceve, una sopra l'altra con uno scarto.
  const placeImages = (pictures: readonly Placed[], at: Point | null): void => {
    const ids = newIds();
    const to = target(ids);
    if (to === null) return;
    const view = viewBounds();
    const inView = at !== null && at[0] >= view.min[0] && at[0] <= view.max[0] && at[1] >= view.min[1] && at[1] <= view.max[1];
    const base: Point = inView ? at : [(view.min[0] + view.max[0]) / 2, (view.min[1] + view.max[1]) / 2];
    const distance = COPY_STEP_PX / camera.scale;
    const step = gridOn() ? wholeSteps(distance, stepNow()) : distance;
    // La scala del livello: una unità della scena vale `1 / k` unità sue.
    const k = Math.sqrt(Math.abs(to.matrix[0] * to.matrix[3] - to.matrix[1] * to.matrix[2]));
    const ops: Op[] = [...to.prelude];
    const keys: string[] = [];
    const bounds = new BoundsBuilder();
    let hrefBytes = 0;
    pictures.forEach((picture, i) => {
      let box = placeImage(picture.width, picture.height, view, [base[0] + i * step, base[1] + i * step]);
      // Con l'aggancio, l'angolo in alto a sinistra va sull'incrocio più
      // vicino.
      if (gridOn()) box = translated(box, ...snapDelta(box.min, 0, 0, stepNow()))!;
      const [cx, cy] = apply(to.inverse, [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2]);
      const w = (box.max[0] - box.min[0]) / k;
      const h = (box.max[1] - box.min[1]) / k;
      const id = ids.next("object");
      const elem = imageElem(id, picture.href, { min: [cx - w / 2, cy - h / 2], max: [cx + w / 2, cy + h / 2] });
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

  // --- Le immagini del vault --------------------------------------------------

  /// Con le parti `at` l'editor inserisce immagini del vault: se le offrono,
  /// e chi lo monta le sa scegliere.
  function insertsImages(at: ReadonlySet<Feature>): boolean {
    return at.has("images") && options.images?.choose !== undefined;
  }

  /// Ctrl+I, o «Immagine dal vault…»: l'immagine che sceglie chi monta
  /// l'editor entra per riferimento, dove entrerebbe incollata e con la sua
  /// misura in pixel, scelta e con lo strumento della selezione. I byte si
  /// leggono soltanto per misurarla.
  async function vaultImage(): Promise<void> {
    const port = options.images;
    const choose = port?.choose;
    if (port === undefined || choose === undefined || asking || disposed) return;
    if (!insertsImages(features) || !editable()) return;
    if (codec === null) {
      announce(t("draw.image.unreadable"));
      return;
    }
    finishText();
    asking = true;
    cancelGesture();
    const loaded = loads;
    // Il posto è quello del cursore di adesso: la finestra prende il fuoco.
    const at = cursor;
    let decoded: Decoded | null = null;
    try {
      let href: string | null;
      try {
        href = await choose();
      } catch {
        // Chi sceglie dice da sé perché non ha potuto.
        href = null;
      }
      const gone = (): boolean => disposed || loads !== loaded || !editable();
      if (href === null || gone()) return;
      const blob = await port.read(href).catch(() => null);
      if (gone()) return;
      if (blob === null) {
        announce(t("draw.image.gone"));
        return;
      }
      decoded = await codec.decode(blob).catch(() => null);
      if (gone()) return;
      if (decoded === null) {
        announce(t("draw.image.unreadable"));
        return;
      }
      placeImages([{ width: decoded.width, height: decoded.height, href }], at);
    } finally {
      decoded?.close();
      asking = false;
    }
  }

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

  /// Maiusc, Ctrl o ⌘, o Alt premuti o lasciati a metà gesto: la forma, lo
  /// spostamento e la cornice si ridisegnano subito.
  const onModifiers = (event: KeyboardEvent): void => {
    if (event.key === "Shift") shift = event.type === "keydown";
    else if (event.key === "Control" || event.key === "Meta") free = event.ctrlKey || event.metaKey;
    else if (event.key === "Alt") alt = event.type === "keydown";
    else return;
    if (current?.kind === "shape") drawShape(current);
    else if (current?.kind === "select" && (current.mode === "move" || current.mode === "resize" || current.mode === "rotate")) selectUpdate(current);
    else if (current?.kind === "nodes" && current.dragging) nodesUpdate(current);
    else if (current?.kind === "bezier") bezierUpdate(current);
    else if (hover !== null && drawing() !== null) showBezier();
    else if (current === null && (alt || measured)) showHandles();
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
    const inNodesBar = event.target instanceof Node && nodesBar.contains(event.target);
    if (onSurface && !event.altKey && arrows(event)) {
      event.preventDefault();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    // «#» e «%» valgono come si scrivono, anche con AltGr, che su Windows
    // arriva come Ctrl e Alt insieme.
    const altGraph = typeof event.getModifierState === "function" && event.getModifierState("AltGraph");
    // `[` e `]` ruotano la selezione, `{` e `}` di un angolo retto: come si
    // scrivono, anche con AltGr; con Ctrl o ⌘ cambiano l'ordine.
    const turn = { "[": -ROTATE_STEP, "]": ROTATE_STEP, "{": -ROTATE_STEP_SHIFT, "}": ROTATE_STEP_SHIFT }[event.key];
    if (turn !== undefined && onSurface && (altGraph || !mod) && tool !== "nodes" && tool !== "bezier") {
      if (current !== null || pressed !== null || selection.length === 0 || !editable()) return;
      rotateSelection(turn);
      event.preventDefault();
      return;
    }
    if ((event.key === "#" || event.key === "%") && (altGraph || !mod) && has("grid")) {
      if (event.key === "#") changeGrid({ ...grid, shown: !grid.shown });
      else changeGrid({ ...grid, snap: !grid.snap });
      event.preventDefault();
      return;
    }
    // Maiusc+R mostra e nasconde i righelli; «|», come si scrive, le loro
    // guide.
    if (has("rulers") && !mod && !event.altKey && event.shiftKey && event.key.toLowerCase() === "r") {
      changeGrid({ ...grid, rulers: !grid.rulers });
      event.preventDefault();
      return;
    }
    if (event.key === "|" && (altGraph || !mod) && has("rulers")) {
      changeGrid({ ...grid, rulerGuides: !grid.rulerGuides });
      event.preventDefault();
      return;
    }
    // I comandi della selezione prendono i loro tasti solo quando c'è una
    // selezione e il livello offre la loro parte: senza, Ctrl+D e gli altri
    // restano a chi li aveva.
    const arranges = (feature: Feature): boolean => has(feature) && selection.length > 0 && editable();
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
        if (nodeKeysOn()) {
          setNodes(allNodes(editing!.subs));
          announceNodes();
        } else {
          select(currentIndex().units.map((unit) => unit.key));
          announceSelection();
        }
      } else if (key === "x" && event.shiftKey && has("attributes")) {
        showAttributes(inspector.element.hidden);
      } else if (key === "m" && event.shiftKey && arranges("transform")) {
        void transformDialog();
      } else if (key === "d" && !event.shiftKey && arranges("arrange")) {
        duplicateSelection();
      } else if (key === "g" && arranges("arrange")) {
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
      } else if (key === "i" && !event.shiftKey && insertsImages(features) && editable()) {
        void vaultImage();
      } else if (key === "k" && (event.shiftKey || options.links !== undefined) && arranges("links")) {
        if (event.shiftKey) unlinkSelection();
        else void linkSelection();
      } else if (bracket !== 0 && arranges("arrange")) {
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
    } else if (onSurface && (event.key === "PageUp" || event.key === "PageDown") && arranges("arrange")) {
      if (pressed !== null) return;
      if (event.key === "PageUp") orderSelection(event.shiftKey ? "front" : "forward");
      else orderSelection(event.shiftKey ? "back" : "backward");
    } else if (onSurface && (event.key === "Home" || event.key === "End") && nodeKeysOn()) {
      visitNode(event.key === "Home" ? 0 : nodeCount(editing!.subs) - 1);
    } else if (onSurface && (event.key === "Home" || event.key === "End")) {
      if (pressed !== null || !visit(event.key === "Home" ? 0 : currentIndex().units.length - 1)) return;
    } else if (onSurface && event.key === " ") {
      if (event.repeat) {
        // Tenuto giù: un tasto, un passo.
      } else if (pressed === null && tool === "text") openText(cursorPoint(), "mouse");
      else if (pressed === null) press(event.timeStamp);
      else release();
    } else if (onSurface && event.key === "F2" && has("text")) {
      if (pressed !== null) return;
      editSelectedText();
    } else if (onSurface && event.key === "Enter") {
      if (pressed !== null) release();
      else if (drawing() !== null) {
        // A metà gesto il tracciato aspetta che il gesto finisca, come per
        // Canc.
        if (current === null) finishBezier(false);
      } else void properties();
    } else if (event.key === "?") {
      void keys();
    } else if ((event.key === "Delete" || event.key === "Backspace") && nodeKeysOn()) {
      // Con lo strumento Nodi Canc elimina i nodi, mai l'oggetto.
      deleteSelectedNodes();
    } else if ((event.key === "Delete" || event.key === "Backspace") && drawing() !== null) {
      // Con la penna di Bézier, l'ultimo nodo del tracciato.
      if (current !== null) return;
      deleteBezierNode(drawing()!);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (selection.length === 0) return;
      deleteSelection();
    } else if (event.key === "Insert" && !event.shiftKey && nodeKeysOn() && (onSurface || inNodesBar)) {
      insertSelectedNodes();
    } else if (event.shiftKey && NODE_COMMANDS[event.key.toLowerCase()] !== undefined && nodeKeysOn() && (onSurface || inNodesBar)) {
      runNodeCommand(NODE_COMMANDS[event.key.toLowerCase()]!);
    } else if (event.key === "Escape") {
      if (current !== null) cancelGesture();
      else if (drawing() !== null) {
        // Esc conclude il tracciato della penna, come conclude un testo: ciò
        // che si è disegnato non si perde, e Annulla lo toglie in un passo.
        finishBezier(false);
      } else if (tool === "nodes" && nodeSelection.size > 0) {
        setNodes([]);
        announceNodes();
      } else if (selection.length > 0) {
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
    get features() {
      return features;
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
      return undoable();
    },
    get canRedo() {
      return redoable();
    },
    get grid() {
      return grid;
    },
    setGrid(next) {
      if (disposed) return;
      grid = checkedGrid(next, grid);
      showGrid();
      showGuideLines();
      showHandles();
    },
    setEngine(next) {
      if (disposed) return;
      if (next.model === null) throw new Error("documento in sola lettura: non si monta nell'editor");
      // Chi sposta o cancella guarda oggetti che il testo nuovo può non
      // avere più: il gesto si annulla. Tratto e forma si scrivono alla fine,
      // sul livello che c'è allora.
      if (current !== null && (current.kind === "select" || current.kind === "nodes" || current.kind === "erase")) cancelGesture();
      engine = next;
      refresh();
    },
    load(next) {
      if (disposed) return;
      if (next.model === null) throw new Error("documento in sola lettura: non si monta nell'editor");
      cancelGesture();
      // Il testo in corso era del documento di prima, e così il tracciato
      // della penna.
      finishText(false);
      dropBezier();
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

/// Le operazioni booleane, nell'ordine del menu: il nome della voce e quello
/// del passo di annulla.
const BOOLEANS: ReadonlyArray<{ readonly kind: BooleanKind; readonly label: DrawKey; readonly action: DrawKey }> = [
  { kind: "union", label: "draw.boolean.union", action: "draw.action.union" },
  { kind: "difference", label: "draw.boolean.difference", action: "draw.action.difference" },
  { kind: "intersection", label: "draw.boolean.intersection", action: "draw.action.intersection" },
  { kind: "exclusion", label: "draw.boolean.exclusion", action: "draw.action.exclusion" },
  { kind: "division", label: "draw.boolean.division", action: "draw.action.division" },
];

/// Che cosa si dice quando un'operazione booleana non si fa.
const REFUSALS: Readonly<Record<Exclude<Refused["reason"], "not_shapes">, DrawKey>> = {
  few: "draw.boolean.few",
  empty: "draw.boolean.empty",
  whole: "draw.boolean.whole",
  foreign: "draw.boolean.foreign",
  failed: "draw.boolean.failed",
};

/// I nomi delle voci del contorno.
const DASH_LABELS: Readonly<Record<Dash, DrawKey>> = {
  solid: "draw.outline.solid",
  dashed: "draw.outline.dashed",
  dotted: "draw.outline.dotted",
  dashdot: "draw.outline.dashdot",
};

const CAP_LABELS: Readonly<Record<Cap, DrawKey>> = {
  butt: "draw.outline.butt",
  round: "draw.outline.round_cap",
  square: "draw.outline.square",
};

const JOIN_LABELS: Readonly<Record<Join, DrawKey>> = {
  miter: "draw.outline.miter",
  round: "draw.outline.round_join",
  bevel: "draw.outline.bevel",
};

/// I comandi dei nodi di Maiusc e una lettera, quelli di Inkscape.
type NodeCommand = NodeKind | "line" | "curve" | "break" | "join";
const NODE_COMMANDS: Readonly<Record<string, NodeCommand>> = {
  c: "corner",
  s: "smooth",
  y: "symmetric",
  l: "line",
  u: "curve",
  b: "break",
  j: "join",
};

/// Il tipo di un nodo a parole; un capo di un tracciato aperto non ne ha.
const KIND_NAMES: Readonly<Record<NodeKind | "end", DrawKey>> = {
  corner: "draw.nodes.kind.corner",
  smooth: "draw.nodes.kind.smooth",
  symmetric: "draw.nodes.kind.symmetric",
  end: "draw.nodes.kind.end",
};

/// Che cosa si annuncia quando i nodi cambiano tipo.
const MADE: Readonly<Record<NodeKind, readonly [DrawKey, DrawKey]>> = {
  corner: ["draw.nodes.made.corner.one", "draw.nodes.made.corner.other"],
  smooth: ["draw.nodes.made.smooth.one", "draw.nodes.made.smooth.other"],
  symmetric: ["draw.nodes.made.symmetric.one", "draw.nodes.made.symmetric.other"],
};

/// Che cosa si annuncia quando una forma entra nel disegno.
const ADDED: Readonly<Record<ShapeTool, DrawKey>> = {
  rect: "draw.added.rect",
  ellipse: "draw.added.ellipse",
  line: "draw.added.line",
  arrow: "draw.added.arrow",
};
