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
// - **Selezione avanzata.** Dal livello Standard il Lazo (`q`) sceglie ciò
//   che racchiude per intero; Ctrl o ⌘ col clic sceglie dentro i gruppi, e
//   il doppio clic su un gruppo lo isola: il resto si attenua e non si
//   sceglie, una barra in fondo al foglio dice dove si è ed Esc esce, un
//   gruppo alla volta. Isolare non cambia il file. Un menu, anche col tasto
//   destro, sceglie i simili, inverte la selezione, blocca e nasconde gli
//   oggetti uno per uno, e li sblocca e li mostra tutti (`selecting.ts`).
//
// La superficie che lo monta nella shell gli passa il motore del
// documento e riceve ogni modifica con `onChange`; una sincronizzazione da
// un'altra superficie arriva con `setEngine`, e annulla e ripeti restano.

import { onLanguage, resolvedLanguage } from "../../../i18n/strings";
import { clipboardSupports, readClipboard, writeClipboardData, type ClipboardEntry } from "../../../platform/clipboard";
import { identifier } from "../../../ui/a11y";
import { ariaBinding, displayBinding, modifierName } from "../../../ui/commands";
import { promptForm, showKeys, type FormField, type KeyGroup, type MoreKeys } from "../../../ui/form-dialog";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { showContextMenu, type MenuItem } from "../../../ui/menu";
import type { ScaleLimits } from "../../../spatial/camera";
import type { TextOperation } from "../../core/text-operation";
import { countObjects, describe, keyOf, linkName, outline, polygonalKind, type OutlineNode } from "../describe";
import { brushForInput, PF1_DEFAULTS, type Pf1Brush } from "../ink/brush";
import { pf1Outline } from "../ink/pf1";
import { imageDataUri, imageRefs, READ_IMAGE_BYTES, withImages } from "../read-images";
import { appFonts, fontFaces, withStyle } from "../picture";
import type { Ink } from "../ink/codec";
import { INK_MAX_SAMPLES, quantizeInk, type InkSample } from "../ink/sample";
import { formatNumber } from "../number";
import { attachPenInput, type FinishedStroke, type InkPointerType, type PenInputOptions, type StrokeStart } from "../pen/pen-input";
import { isDefaultCurve, pressureCurve, sameCurve, validCurve, type PenCurve } from "../pen/pressure";
import type { TouchPolicy } from "../pen/roles";
import { pointAt } from "../scene/curves";
import { BoundsBuilder, type Bounds, type Segment } from "../scene/geometry";
import { apply, compose, IDENTITY, invert, translate, type Matrix, type Point } from "../scene/matrix";
import { elementChildren, pathOf, tagName, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import { MAX_IMAGE_BYTES } from "../scene/analysis";
import { auditScene, MAX_EDIT_BYTES, SVG_NS } from "../scene/read";
import { utf8Length } from "../scene/text";
import type { Applied, SceneEngine } from "../scene/engine";
import type { Role, Tool } from "../scene/analysis";
import type { ElementItem, Item } from "../scene/classify";
import { ROOT, type Op, type Reason } from "../scene/ops";
import { MAX_GUIDES, UNITS, writeGuides, type LengthUnit, type RulerGuide } from "../scene/rulers";
import { pathData, type Elem } from "../scene/serialize";
import { plural, t, type DrawKey } from "../strings";
import { createOverlay, HANDLE_REACH_PX, type NodeShape, type OverlayHandle, type RegionTone } from "../painter/overlay";
import { PaintBuilder, type HeadInfo, type PaintNode, type PaintScene } from "../painter/paint";
import { createSvgPainter, miniaturePicture, paintMiniature, shapeCount, type MiniatureBox } from "../painter/svg-dom";
import {
  addOp,
  boxMatrix,
  destination,
  destinationIn,
  destinationInto,
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
  holdsLink,
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
import { CAPS, DASHES, JOINS, lookOf as outlineLook, outlineOps, outlinesOf, type OutlineChange } from "./outline";
import { boundsAfter, MAX_SCALE_PERCENT, MAX_SKEW, numericMatrix, numericOps } from "./transform";
import { barSpot, type ScreenBox } from "./bar";
import {
  ACTION_COMMANDS,
  CAP_LABELS,
  DASH_LABELS,
  JOIN_LABELS,
  LOOK_ACTIONS,
  lookChange,
  outlineChange,
  propertiesView,
  SHAPE_ACTIONS,
  shapeChange,
  UNIT_NAMES,
  type SelectionFacts,
} from "./fields";
import { lookOf as selectionLook, lookOps, styleOf, styleOps, type LookChange, type Style } from "./look";
import { rasterize } from "./png";
import { createProperties, type ActionId, type FieldId, type SectionId, type TransformId } from "./properties";
import {
  angleOf,
  directionCursor,
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
  MIN_SIZE,
  movedFrame,
  normalized,
  pull,
  resized,
  resizeMatrix,
  rotation,
  rotationMatrix,
  scales,
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
import type { Join } from "./offset";
import { holdsShape, holdsStroke, inkPathOps, offsetOps, outlineStrokeOps, simplifyOps } from "./paths";
import type { BooleanKind } from "./boolean";
import { combineOps, isShape, type Refused } from "./combine";
import { crossings, cutAt, joinAcross, joinEnds, mapSubs, nodeSpot, type Spot } from "./cut";
import { cuttable, dsOf, holdsOpenPath, joinOps, knifePieces, piecesOf, writePieces, type JoinRefused } from "./scissors";
import { builderOf, buildOps, type Builder, type BuildRefused } from "./builder";
import {
  bend,
  breakNodes,
  curveAt,
  deleteNodes,
  handleAt,
  handleNode,
  handleSpot,
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
  openNode,
  parseKey,
  pullHandles,
  pullSide,
  readNodes,
  realizeHandle,
  samePlace,
  setKind,
  setLinks,
  writeNodes,
  type Edited,
  type HandleRef,
  type KindOf,
  type Link,
  type NodeKey,
  type NodeKind,
  type Subpath,
} from "./nodes";
import { collapsed, penKind, penNode, penPath, type PenNode } from "./bezier";
import { curved, recurve, type CurveKind, type DraftNode } from "./curvature";
import { draftOf, inkSpine, nodableOf, rewrite, rewriteOps, type Nodable, type NoNodes } from "./nodable";
import type { Spine } from "./spine";
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
  validClosed,
  validStep,
  validSteps,
  wholeSteps,
  withStep,
  type Grid,
} from "./grid";
import { guideDialog, unitSuffix } from "./guide-dialog";
import { touchDialog } from "./touch-dialog";
import { openRadial, type Radial, type RadialItem, type RadialPointer } from "./radial";
import { createGuideLines, createRulers, fieldMin, fieldText, fromUnit, GUIDE_HIT_PX, guideAt, RULER_PX, toUnit, UNIT_PLACES } from "./rulers";
import {
  fitView,
  nextTurn,
  normalTurn,
  panned,
  placedAt,
  sceneArrow,
  sceneBox,
  sceneCorners,
  screenBox,
  seenBox,
  toScene,
  toScreen,
  turnBy,
  turnTo,
  viewMatrix,
  viewTransform,
  zoomAt,
  type View,
} from "../view";
import { elemBounds, linesBounds, SceneIndex, SceneIndexer, type LayerInfo, type TextLook, type Unit } from "./hit";
import { History, HISTORY_LIMIT, type Mark, type Replay } from "./history";
import { createHistoryPanel } from "./history-panel";
import { createAccessPanel } from "./accessibility-panel";
import { overlaps, problemsOf, readingOrder, type AuditCode, type Problem } from "./audit";
import { copySvg, looksLikeSvg, pasteFrame, planPaste, readPaste, SVG_TYPE, type PasteProblem, type PasteSource } from "./clipboard";
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
  svgFiles,
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
import { cleanName, decorative, decorativeOps, NAME_MAX, nameable, nameOps } from "./naming";
import { createObjectTree, type TreeDrop, type TreeEntry, type TreeKind, type TreeThumbnail } from "./objects";
import { placeOps, type Place } from "./place";
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
  toolAfter,
  toolForKey,
  TOOLS,
  toolsOf,
  toolSpec,
  type Feature,
  type Level,
  type ToolId,
  type ToolSpec,
} from "./registry";
import { cornerAttrs, cornerCursor, cornerDrag, cornerGrip, cornerSpot, shapeFacts, shapeOps, toolFacts, toolWith, type CornerGrip } from "./reshape";
import { flagged, flagOps, hasLikeness, inverseOf, nodesOf, similarTo, type Flag, type Likeness } from "./selecting";
import { constrainEnd, polygonCount, POLYGON_TOOL, shapeElem, stepRatio, withCount, type PolygonTool, type ShapeStyle, type ShapeTool } from "./shapes";
import { centerOf, heldShape, mapped, regular, shapeOfRecognized, similar, starOf, type Recognized } from "./recognize";
import { heldShapeOps, inkShapeOps, isPenStroke } from "./inkshape";
import { keepLook, refused, type Refusal as Unkept } from "./styled";
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

/// Dove sta il disegno nel vault, per gli `href` che passano da un disegno
/// all'altro con gli appunti. Senza, un `href` incollato resta come era
/// scritto.
export interface DrawPlace {
  /// Il documento del vault a cui porta `href`, com'è scritto nel disegno;
  /// `null` se non porta a un documento del vault.
  locate(href: string): string | null;
  /// L'`href` con cui il disegno porta al documento `doc` del vault.
  refer(doc: string): string;
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
  readonly place?: DrawPlace;
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

/// Quanto resta fermo il puntatore alla fine di un tratto a penna perché il
/// tratto diventi una forma, in millisecondi.
const HOLD_MS = 500;

/// Quanto può tremare il puntatore che sta fermo, in pixel: la penna e il
/// dito non stanno mai fermi del tutto, il mouse sì.
const HOLD_PX: Readonly<Record<InkPointerType, number>> = { pen: 4, mouse: 3, touch: 8 };

/// Il Lazo tiene un punto ogni tanti pixel dello schermo, e al massimo
/// tanti punti: oltre, ne lascia uno ogni due, e il lazo resta lo stesso a
/// occhio.
const LASSO_STEP_PX = 2;
const LASSO_MAX_POINTS = 512;

/// Il Costruttore guarda il tratto del puntatore fra un campione e l'altro a
/// passi di tanti pixel dello schermo: una regione stretta non si salta.
const BUILDER_STEP_PX = 3;

/// Sotto questa misura, in pixel, una forma è un tocco e non si scrive.
const MIN_SHAPE_PX = 4;

const ZOOM_STEP = 1.25;

/// Quanto girano due dita prima che il foglio giri con loro, in gradi: un
/// pizzico per lo zoom non gira il foglio per sbaglio.
const TWIST_START_DEG = 8;

/// Rilasciato a meno di tanti gradi da un angolo retto, il foglio girato
/// dalle dita ci si posa.
const TWIST_SNAP_DEG = 5;

/// Quanto della rotella, in pixel, vale un passo della rotazione con Ctrl o
/// ⌘ e Maiusc: uno scatto del mouse ne dà cento.
const TURN_WHEEL_PX = 50;

/// Quanto dura al più un tocco di più dita che annulla o ripete, in
/// millisecondi, dal primo dito giù all'ultimo su.
const TAP_MS = 300;

/// Quanto può scorrere un dito di un tocco, in pixel: oltre è un pizzico o
/// uno scorrimento.
const TAP_SLOP_PX = 12;

/// Quanto dopo il tasto laterale della penna lasciato arriva il menu
/// contestuale che il sistema gli manda dietro, in millisecondi.
const RADIAL_ECHO_MS = 500;

/// Quanti strumenti e colori di prima l'editor ricorda per il menu radiale.
const RECENT_MAX = 6;

/// Gli strumenti che il menu radiale offre quando chi disegna ne ha usati
/// meno di tre: prima quelli che si alternano di più alla penna.
const FILL_TOOLS: readonly ToolId[] = ["pen", "eraser", "select", "highlighter", "lasso", "text", "rect", "ellipse", "line", "arrow", "polygon", "bezier", "nodes", "builder", "scissors"];

/// La lettera dei pulsanti delle dimensioni del testo, in pixel.
const SIZE_GLYPH_PX: readonly number[] = [12, 16, 22];
const FIT_PAD = 0.08;

/// Di quanto le frecce spostano o ridimensionano la selezione, in unità
/// della scena.
const NUDGE = 1;
const NUDGE_SHIFT = 10;

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
const BAR_FEATURES: readonly Feature[] = ["text", "arrange", "links", "layers", "recognize", "transform", "apply", "path", "boolean", "outline"];

/// La larghezza dell'editor, in rem, da cui il pannello delle proprietà sta
/// accanto al foglio e si apre da sé: sotto, i pannelli vanno sotto il
/// foglio (`structure.css`).
const PANEL_ROOM_REM = 36;

/// Quanto aspetta la verifica dell'accessibilità, dopo l'ultimo cambio del
/// disegno, prima di rileggerlo: rileggerlo costa quanto aprirlo.
const AUDIT_MS = 250;

/// Il tasto che mostra e nasconde gli attributi, dal livello Esperto: lo
/// stesso dell'editor XML di Inkscape.
const ATTRIBUTES_BINDING = "Mod-Shift-x";

/// «Trasforma», dal livello Esperto: lo stesso tasto della finestra di
/// Inkscape.
const TRANSFORM_BINDING = "Mod-Shift-m";

/// «Immagine dal vault…», dal livello Standard: il tasto con cui Inkscape
/// importa.
const IMAGE_BINDING = "Mod-i";

/// Lo scarto di una copia dal suo originale, e fra due immagini incollate
/// insieme, in pixel dello schermo: si vedono tutte, a ogni zoom.
const COPY_STEP_PX = 24;

/// Un incolla lavora a fette di tanti millisecondi, e fra una e l'altra la
/// pagina risponde; la sua barra si vede se dura più di tanto, o subito se
/// porta almeno tanti caratteri.
const SLICE_MS = 12;
const PROGRESS_DELAY_MS = 200;
const BIG_PASTE = 1024 * 1024;

/// Fra Ctrl+Maiusc+V e l'incolla che il browser manda dietro, al più tanti
/// millisecondi.
const IN_PLACE_MS = 1000;

/// «Copia lo stile» e «Incolla lo stile», dal livello Standard: i tasti di
/// Inkscape.
const COPY_STYLE_BINDING = "Mod-Alt-c";
const PASTE_STYLE_BINDING = "Mod-Alt-v";

/// L'ultima copia degli editor della pagina: il testo scritto negli appunti
/// e dove porta il disegno da cui viene, così un incolla in un altro disegno
/// riscrive i suoi `href` del vault dal posto nuovo. Un testo che arriva da
/// fuori resta com'è.
let lastCopy: { readonly text: string; readonly place: DrawPlace | null } | null = null;

/// Lo stile copiato, uno per la pagina come gli appunti.
let copiedStyle: Style | null = null;

/// Cresce a ogni copia nella pagina, di un editor o no: il PNG di una copia
/// che arriva dopo un'altra non la sovrascrive. `copyEvent` è l'ultima
/// copia di un editor, che per gli altri editor non è un'altra copia.
let copyRound = 0;
let copyEvent: Event | null = null;

/// Due testi degli appunti uguali, a parte i terminatori di riga, che il
/// sistema può cambiare.
const sameClip = (a: string, b: string): boolean => a === b || a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n");

/// Fa i passi di `run` a fette di [`SLICE_MS`], e fra una fetta e l'altra
/// aspetta `breathe`, che lascia respirare la pagina; `progress` riceve la
/// parte fatta. `null` se `stop` dice di smettere.
async function sliced<T>(run: Generator<number, T>, progress: (done: number) => void, stop: () => boolean, breathe: () => Promise<void>): Promise<T | null> {
  for (;;) {
    const end = performance.now() + SLICE_MS;
    for (;;) {
      const next = run.next();
      if (next.done === true) return next.value;
      progress(next.value);
      if (performance.now() >= end) break;
    }
    await breathe();
    if (stop()) return null;
  }
}

/// I byte di un file dell'app, come li scarica il browser; `null` se non
/// arrivano.
const fetchBlob = (url: string): Promise<Blob | null> =>
  fetch(url)
    .then((response) => (response.ok ? response.blob() : null))
    .catch(() => null);

/// Perché un SVG non si incolla, a parole.
const PASTE_PROBLEMS: Readonly<Record<PasteProblem, DrawKey>> = {
  "too-large": "draw.paste.too_large",
  malformed: "draw.paste.malformed",
  "not-svg": "draw.paste.not_svg",
  empty: "draw.paste.empty",
  entities: "draw.paste.entities",
};

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

/// Quanto lontani due capi possono stare sullo schermo, in pixel, e con
/// «Unisci» diventare un nodo solo: così si vedono toccarsi. Più lontani, li
/// unisce una linea.
const JOIN_PX = 2;

/// Quanto lontano dal suo nodo si mostra una maniglia ritirata, in pixel:
/// abbastanza da prenderla senza prendere il nodo.
const FOLDED_PX = 20;

/// Quanto lontano dal suo nodo deve stare sullo schermo la maniglia di una
/// linea, o una ritirata, per mostrarsi, in pixel: più vicina coprirebbe il
/// nodo. Ingrandendo il foglio, si vede.
const LATENT_PX = 8;

/// Quanto dentro il vertice sta la maniglia degli angoli oltre il centro
/// dell'arco, in pixel: lontana dalle maniglie della cornice anche quando il
/// raggio è zero.
const CORNER_INSET_PX = 16;

/// Quanto deve poter scorrere sullo schermo la maniglia degli angoli perché
/// si mostri, in pixel: su una forma più piccola coprirebbe la forma.
const CORNER_ROOM_PX = 32;

/// La forma di un nodo, per tipo, come la disegna lo strato sopra.
const NODE_SHAPES: Readonly<Record<NodeKind, NodeShape>> = { corner: "diamond", smooth: "square", symmetric: "circle" };

/// Gli angoli dello scostamento, coi loro nomi, nell'ordine della barra.
const JOIN_NAMES: ReadonlyMap<Join, DrawKey> = new Map([
  ["miter", "draw.offset.join.miter"],
  ["round", "draw.offset.join.round"],
  ["bevel", "draw.offset.join.bevel"],
]);

/// La distanza dello scostamento la prima volta, in ogni unità: un passo
/// che si vede, a numeri tondi.
const OFFSET_START: Readonly<Record<LengthUnit, number>> = { px: 4, mm: 1, cm: 0.1, in: 0.05, pt: 3 };

/// I passi del cursore di «Semplifica», e lo scarto ai due capi, in parti
/// della diagonale delle forme scelte: da quasi niente a un ventesimo. Fra
/// i capi lo scarto cresce in proporzione, e ogni passo semplifica in scala
/// quanto il precedente.
const SIMPLIFY_STEPS = 100;
const SIMPLIFY_LEAST = 1e-4;
const SIMPLIFY_MOST = 0.05;

/// I nodi che l'anteprima di «Semplifica» mostra, al più: oltre, il solo
/// contorno.
const PREVIEW_NODES = 2_000;

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
  "draw-polygon": ["M7.5 4.2h9l4.5 7.8-4.5 7.8h-9L3 12z"],
  "draw-star": ["M12 3l2.1 6.6H21l-5.5 4 2.1 6.6-5.6-4.1-5.6 4.1 2.1-6.6L3 9.6h6.9z"],
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
  "draw-to-shape": ["M3 19c2-3 3.5 0 5.5-2.5S12 16 14 13", "M13 3h8v8h-8z"],
  "draw-boolean": ["M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0", "M7 14a7 7 0 1 0 14 0a7 7 0 1 0-14 0"],
  "draw-nodes": ["M4 3v12l3.2-3.1 2.3 5.1 2-.9-2.3-5H15z", "M16 16h5v5h-5z"],
  "draw-builder": ["M3 9a6 6 0 1 0 12 0a6 6 0 1 0-12 0", "M9 9h11v11H9z", "M5 17v5", "M2.5 19.5h5"],
  // Due anelli in basso, e le lame che si incrociano verso l'alto.
  "draw-scissors": ["M3.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", "M15.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", "M7.8 16.2L17 3", "M16.2 16.2L7 3"],
  "draw-bezier": ["M12 21L7 12l3-8h4l3 8z", "M12 21v-7.5", "M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"],
  // Tre punti, e la curva che vi passa.
  "draw-curvature": ["M4 18C4 11 7.5 7 12 7s8 4 8 11", "M2.5 18a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0", "M10.5 7a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0", "M18.5 18a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"],
  "draw-node-add": ["M3 19c4-6 14-6 18 0", "M10.5 13h3v3h-3z", "M12 3v6", "M9 6h6"],
  "draw-node-delete": ["M3 19c4-6 14-6 18 0", "M10.5 13h3v3h-3z", "M9 6h6"],
  "draw-node-corner": ["M3 20l9-13 9 13", "M12 4l3 3-3 3-3-3z"],
  "draw-node-smooth": ["M3 20C3 13 7 8 12 8s9 5 9 12", "M10.5 6.5h3v3h-3z", "M7 8h3.5", "M13.5 8H20"],
  "draw-node-symmetric": ["M3 20C3 13 7 8 12 8s9 5 9 12", "M10.5 8a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0", "M5 8h5.5", "M13.5 8H19"],
  "draw-segment-line": ["M3 17h4v4H3z", "M17 3h4v4h-4z", "M7 17L17 7"],
  "draw-segment-curve": ["M3 17h4v4H3z", "M17 3h4v4h-4z", "M7 19c7 0 12-5 12-12"],
  "draw-node-break": ["M2 12h6", "M16 12h6", "M8 10h3v4H8z", "M13 10h3v4h-3z"],
  "draw-node-join": ["M2 12h4", "M18 12h4", "M10.5 10.5h3v3h-3z", "M6 9l3 3-3 3", "M18 9l-3 3 3 3"],
  "draw-lasso": ["M3.5 9.5a8.5 5.5 0 1 0 17 0a8.5 5.5 0 1 0-17 0", "M8 14.5c-2 1.5-2 4 0 4.5s3.5 0 3.5 2.5"],
  "draw-selection": ["M4 7V4h3", "M10 4h4", "M17 4h3v3", "M20 10v4", "M20 17v3h-3", "M14 20h-4", "M7 20H4v-3", "M4 14v-4"],
  "draw-back": ["M10 6l-6 6 6 6", "M4 12h16"],
  "draw-history": ["M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5", "M3.5 4v4.5H8", "M12 7.5V12l3 2"],
  "draw-access": ["M12 2.75a1.75 1.75 0 1 0 0 3.5a1.75 1.75 0 1 0 0-3.5z", "M5 8.5l7 1.5 7-1.5", "M12 10v4.5", "M8.5 21l3.5-6.5 3.5 6.5"],
};

/// Registra le icone una volta per tutte le superfici: restano finché la
/// shell vive, come quelle di serie.
function ensureIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
}

/// Il nodo di `model` al percorso `path`; `null` se lì non c'è.
function nodeAtPath(model: DocumentModel, path: readonly number[]): ElementPart | null {
  let node: ElementPart = model.root;
  for (const at of path) {
    if (node.kind !== "container") return null;
    const next: ElementPart | undefined = elementChildren(node)[at];
    if (next === undefined) return null;
    node = next;
  }
  return node;
}

/// L'ordine di documento di due percorsi: chi contiene prima di ciò che
/// contiene.
function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/// Vero se il percorso `outer` contiene `inner`, a qualunque profondità.
function holdsPath(outer: readonly number[], inner: readonly number[]): boolean {
  return inner.length > outer.length && outer.every((step, at) => inner[at] === step);
}

/// Come un comando che sposta gli elementi senza cambiarli tiene lo stile
/// che si vede (vedi `styled.ts`).
interface Styled {
  /// La frase del comando quando non si fa, col perché in `{reason}`.
  readonly key: DrawKey;
  /// Le altre parole della frase.
  readonly vars?: Readonly<Record<string, string>>;
  /// `take` se chi cambia contenitore ne prende l'opacità e la visibilità;
  /// se no tutto resta come si vedeva.
  readonly containers?: "keep" | "take";
}

/// Un collegamento che si vede, col suo segno sul foglio.
interface LinkMark {
  readonly unit: Unit;
  /// Dove porta, com'è scritto.
  readonly target: string;
  readonly element: HTMLButtonElement;
}

/// Un gesto in corso, dalla pipeline della penna.
type Gesture = InkGesture | ShapeGesture | SelectGesture | LassoGesture | NodesGesture | BuilderGesture | CutGesture | BezierGesture | EraseGesture | TextGesture | GuideGesture | RefusedGesture;

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
  /// Quando è cominciato, sull'orologio di `performance.now()`.
  readonly began: number;
  /// Il tratto può diventare una forma tenendolo fermo alla fine: è a
  /// penna, viene dal puntatore e non continua uno chiuso al limite.
  readonly holds: boolean;
  /// Dove il puntatore si è fermato, nella scena: i campioni dopo non se ne
  /// sono allontanati.
  still: Point | null;
  /// La forma che il tratto è diventato; `null` finché è inchiostro.
  held: Held | null;
}

/// Un tratto a penna diventato forma, tenuto fermo alla fine: la forma
/// riconosciuta, nelle coordinate del livello; dove il puntatore si era
/// fermato e dov'è, nella scena; e se si è mosso abbastanza da regolarla.
interface Held {
  readonly shape: Recognized;
  readonly from: Point;
  end: Point;
  moved: boolean;
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
  /// cornice o degli angoli, non diventa trascinamento.
  mode: "pending" | "move" | "marquee" | "resize" | "rotate" | "corner";
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
  /// La maniglia degli angoli presa.
  corner: CornerDrag | null;
  /// La trasformazione della scena che la cornice mostra, e i gradi della
  /// rotazione.
  matrix: Matrix | null;
  angle: number;
}

/// La maniglia degli angoli presa: l'oggetto, la sua maniglia, dove la si è
/// presa nelle coordinate dell'oggetto, e il raggio mentre la si tira.
interface CornerDrag {
  readonly unit: Unit;
  readonly grip: CornerGrip;
  readonly from: Point;
  radius: number;
}

/// Un gesto del Lazo: i punti che segue, nella scena, e la selezione di
/// partenza, che Maiusc allarga e Alt riduce.
interface LassoGesture extends GestureBase {
  readonly kind: "lasso";
  readonly points: Point[];
  readonly base: readonly string[];
  readonly mode: "replace" | "add" | "remove";
  /// Oltre la soglia del trascinamento: prima, è un tocco.
  dragging: boolean;
}

/// Un gesto del Costruttore di forme. Cominciato su una regione, senza
/// Maiusc, prende le regioni che attraversa, da unire o, con Alt, da
/// togliere; un tocco ne prende una. Altrimenti sceglie gli oggetti come la
/// Selezione: un tocco quello sotto, un riquadro quelli dentro.
interface BuilderGesture extends GestureBase {
  readonly kind: "builder";
  /// Dove è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// Che cosa fa il gesto, deciso dal primo punto.
  mode: "regions" | "objects" | null;
  /// Maiusc al primo punto: il tocco e il riquadro aggiungono alla
  /// selezione, e il tocco su un oggetto scelto lo toglie.
  additive: boolean;
  /// Le regioni attraversate, nell'ordine: la prima dà lo stile all'unione.
  readonly crossed: number[];
  /// La scia del puntatore sulle regioni, nella scena.
  readonly trail: Point[];
  /// La selezione di partenza, che un gesto annullato ripristina.
  readonly base: readonly string[];
  /// Oltre la soglia del trascinamento: prima, è un tocco.
  dragging: boolean;
}

/// Un gesto delle Forbici: un tocco taglia il contorno sotto, un
/// trascinamento è il Coltello, che taglia lungo la sua scia, o con Alt
/// dritto dal primo punto all'ultimo.
interface CutGesture extends GestureBase {
  readonly kind: "cut";
  /// Dove è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// La scia del Coltello, nella scena.
  readonly trail: Point[];
  /// Oltre la soglia del trascinamento: prima, è un tocco.
  dragging: boolean;
}

/// Dove tagliano le Forbici: la forma, il punto del suo tracciato, il nodo
/// se ci cade, e dove si vede nella scena.
interface CutSpot {
  readonly unit: Unit;
  readonly leaf: LeafNode;
  readonly nodable: Nodable;
  /// Dalle coordinate della forma a quelle della scena.
  readonly matrix: Matrix;
  readonly spot: Spot;
  readonly node: NodeKey | null;
  readonly at: Point;
}

/// I nodi scelti, per forma: la chiave è il percorso della forma nel
/// modello, coi numeri separati da un punto.
type NodePick = ReadonlyMap<string, ReadonlySet<NodeKey>>;

/// Che cosa ha preso il primo punto di un gesto dei nodi: un nodo, una
/// maniglia o un punto di un segmento della forma `shape`, il vuoto per un
/// riquadro, o niente da trascinare. `origin` è dov'era il punto preso,
/// nella scena. Un nodo preso con Maiusc fra quelli scelti si toglie con un
/// tocco (`toggle`); senza Maiusc, un tocco lascia scelti soltanto i nodi
/// `alone`. Preso con Alt, trascinarlo ne tira fuori le maniglie (`pull`).
/// Una maniglia presa con Alt si sposta da sola (`alone`), e il suo nodo
/// diventa uno spigolo; una che sta su una linea, toccata, vale come il
/// punto `segment` della linea.
type NodeGrab =
  | {
    readonly kind: "node";
    readonly shape: string;
    readonly key: NodeKey;
    readonly origin: Point;
    readonly toggle: boolean;
    readonly alone: readonly NodeKey[] | null;
    readonly pull: boolean;
  }
  | {
    readonly kind: "handle";
    readonly shape: string;
    readonly handle: HandleRef;
    readonly origin: Point;
    readonly alone: boolean;
    readonly segment: { readonly sub: number; readonly link: number; readonly t: number } | null;
  }
  | { readonly kind: "segment"; readonly shape: string; readonly sub: number; readonly link: number; readonly t: number }
  /// Un riquadro sceglie i nodi di tutte le forme che prende; con Maiusc
  /// aggiunge a quelli scelti.
  | { readonly kind: "marquee"; readonly additive: boolean }
  | { readonly kind: "none" };

/// Un gesto dello strumento Nodi.
interface NodesGesture extends GestureBase {
  readonly kind: "nodes";
  from: Point | null;
  end: Point | null;
  grab: NodeGrab | null;
  /// Oltre la soglia del trascinamento.
  dragging: boolean;
  /// I nodi scelti, le forme che si modificavano e la selezione di prima,
  /// che un gesto annullato ripristina; per il riquadro, ciò che Maiusc
  /// conserva. Se le forme cambiano, un tocco dice le nuove prima dei nodi
  /// scelti.
  readonly nodes: NodePick;
  readonly shapes: readonly (readonly number[])[];
  readonly selection: readonly string[];
  /// I nodi di ogni forma come li lascia il trascinamento, da scrivere
  /// quando si alza.
  draft: ReadonlyMap<string, readonly Subpath[]> | null;
  /// Il lato del nodo di cui si tirano le maniglie, deciso dal verso in cui
  /// il trascinamento comincia.
  side: "in" | "out" | null;
  /// La forma `shape` del trascinamento di una maniglia, o delle maniglie
  /// tirate da un nodo, come la lascia: i nodi scelti e i tipi dati, e dove
  /// è finito ogni nodo se se ne sono aggiunti.
  reshaped: Reshaped | null;
  /// Perché la forma toccata non ha nodi, o perché il trascinamento non fa
  /// niente.
  missed: DrawKey | null;
}

/// Una forma come la lascia un trascinamento che le cambia i nodi o i tipi
/// (vedi [`NodesGesture`]).
interface Reshaped {
  readonly shape: string;
  readonly chosen: ReadonlySet<NodeKey>;
  readonly kinds: ReadonlyMap<NodeKey, NodeKind>;
  readonly moved: ReadonlyMap<NodeKey, NodeKey> | null;
}

/// Ciò che la Curvatura prende di un tracciato scelto: un nodo, o il punto
/// di un segmento dove ne posa uno nuovo, e dove sta nella scena.
interface CurveGrab {
  readonly edit: Editing;
  readonly node: NodeKey | null;
  readonly segment: { readonly sub: number; readonly link: number; readonly t: number } | null;
  readonly origin: Point;
}

/// Un tracciato come lo lascia un trascinamento della Curvatura: i nodi, il
/// nodo spostato, i tipi, e dove sono finiti i nodi se se n'è posato uno.
interface CurveDraft {
  readonly subs: readonly Subpath[];
  readonly key: NodeKey;
  readonly kinds: ReadonlyMap<NodeKey, NodeKind>;
  readonly moved: ReadonlyMap<NodeKey, NodeKey> | null;
}

/// Un gesto della penna di Bézier: aggiunge un nodo, chiude il tracciato sul
/// primo nodo, o prende l'ultimo, che un tocco conclude e un trascinamento
/// ne cambia la maniglia d'uscita. Con la Curvatura il trascinamento sposta
/// il punto che prende, anche uno in mezzo (`point`), che un tocco fa
/// passare da liscio a spigolo e ritorno.
interface BezierGesture extends GestureBase {
  readonly kind: "bezier";
  readonly to: Destination;
  /// La Curvatura, quando il gesto è cominciato.
  readonly curve: boolean;
  /// `path`: la Curvatura su un tracciato che c'è già ([`CurveGrab`]).
  mode: "add" | "close" | "last" | "point" | "path" | null;
  path: CurveGrab | null;
  /// Il tracciato preso come lo lascia il trascinamento.
  reshaped: CurveDraft | null;
  /// Il nodo del tracciato che il gesto prende; -1 per uno nuovo.
  index: number;
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
  readonly nodes: readonly DraftNode[];
  readonly label: DrawKey;
  readonly index: number;
}

/// Il tracciato della penna di Bézier, finché non si conclude.
interface Drafting {
  nodes: readonly DraftNode[];
  readonly done: DraftStep[];
  readonly undone: DraftStep[];
  /// Il livello dell'ultimo gesto, per l'anteprima fra un gesto e l'altro.
  to: Destination;
}

/// Una forma di cui lo strumento Nodi modifica i nodi, dentro un oggetto
/// scelto o l'oggetto stesso.
interface Editing {
  readonly unit: Unit;
  /// L'elemento, il suo percorso nel modello, e il percorso come chiave.
  readonly leaf: LeafNode;
  readonly path: readonly number[];
  readonly key: string;
  /// Ciò che i nodi modificano, e i nodi.
  readonly nodable: Nodable;
  readonly subs: readonly Subpath[];
  /// Dalle coordinate del tracciato a quelle della scena, e ritorno.
  readonly matrix: Matrix;
  readonly inverse: Matrix;
  /// Ciò che il painter disegna per lui.
  readonly paints: readonly PaintNode[];
}

/// Una modifica dei nodi della forma `edit`: i nodi nuovi, quelli scelti
/// dopo e i tipi dati. `moved` porta i nodi che restano dove sono finiti,
/// se la modifica ne ha aggiunti o tolti; `changed` dice quanti nodi o
/// segmenti ha cambiato.
interface NodeChange {
  readonly edit: Editing;
  readonly subs: readonly Subpath[];
  readonly selected: Iterable<NodeKey>;
  readonly kinds: ReadonlyMap<NodeKey, NodeKind>;
  readonly moved?: ReadonlyMap<NodeKey, NodeKey>;
  readonly changed?: number;
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

/// Nessun nodo, e nessun tipo dato.
const NO_KEYS: ReadonlySet<NodeKey> = new Set();
const NO_KINDS: ReadonlyMap<NodeKey, NodeKind> = new Map();

/// I nodi scelti `pick` coi nodi `keys` della forma `shape` in più.
function adding(pick: NodePick, shape: string, keys: Iterable<NodeKey>): Map<string, ReadonlySet<NodeKey>> {
  const out = new Map(pick);
  out.set(shape, new Set([...(pick.get(shape) ?? []), ...keys]));
  return out;
}

/// I nodi scelti `pick` senza il nodo `key` della forma `shape`.
function removing(pick: NodePick, shape: string, key: NodeKey): Map<string, ReadonlySet<NodeKey>> {
  const out = new Map(pick);
  const keys = new Set(pick.get(shape));
  keys.delete(key);
  if (keys.size === 0) out.delete(shape);
  else out.set(shape, keys);
  return out;
}

/// Il percorso `path` quando se ne vanno gli elementi di `removed`, tutti
/// del modello di prima: ognuno tolto prima di lui fra i suoi fratelli, o
/// fra quelli di chi lo contiene, lo porta indietro di uno. `null` se se ne
/// va lui, o chi lo contiene.
function pathAfter(path: readonly number[], removed: readonly (readonly number[])[]): number[] | null {
  const out = [...path];
  for (const gone of removed) {
    const depth = gone.length - 1;
    if (depth >= path.length || !gone.every((at, i) => i === depth || at === path[i])) continue;
    if (gone[depth] === path[depth]) return null;
    if (gone[depth]! < path[depth]!) out[depth] = out[depth]! - 1;
  }
  return out;
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

/// Perché una voce dell'albero non si rinomina e non si sposta: è bloccata,
/// o lo è ciò che la contiene, o il suo livello.
type Refusal = "locked" | "container_locked" | "layer_locked";

/// Uno spostamento dall'albero, pronto: i nodi che vanno, il contenitore
/// che li riceve, il posto fra i suoi figli e se sono livelli.
interface Placing {
  readonly moving: readonly ElementPart[];
  readonly parent: ContainerNode;
  readonly at: Place;
  readonly layers: boolean;
}

/// Fino a quante forme una miniatura è viva, con le immagini del vault; fino
/// a quante è un'immagine ferma. Oltre, la riga non ne ha.
const THUMB_LIVE_SHAPES = 200;
const THUMB_PICTURE_SHAPES = 5000;

/// Il riquadro di una miniatura da quello di un oggetto.
function miniatureBox(bounds: Bounds | null): MiniatureBox | null {
  return bounds === null ? null : { x: bounds.min[0], y: bounds.min[1], width: bounds.max[0] - bounds.min[0], height: bounds.max[1] - bounds.min[1] };
}

/// Il nome di un livello come si mostra: gli spazi raccolti e, oltre `max`
/// caratteri, tagliato coi puntini. Un livello senza nome lo dice.
function layerTitle(layer: LayerInfo, max = MAX_LAYER_NAME): string {
  const name = layer.name.replace(/\s+/g, " ").trim();
  if (name === "") return t("draw.layer.unnamed");
  const chars = Array.from(name);
  return chars.length <= max ? name : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/// Il tipo di un oggetto per il filtro dell'albero: le forme, i tracciati e
/// le frecce sono «Forme».
function treeKind(role: Role): TreeKind {
  switch (role) {
    case "layer":
    case "group":
    case "link":
    case "stroke":
    case "text":
    case "image":
      return role;
    default:
      return "shape";
  }
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
    panel: next.panel === null || typeof next.panel === "boolean" ? next.panel : before.panel,
    bar: flag(next.bar, before.bar),
    closed: validClosed(next.closed) ?? before.closed,
    shapes: flag(next.shapes, before.shapes),
    twist: flag(next.twist, before.twist),
    taps: flag(next.taps, before.taps),
    pen: validCurve(next.pen) ?? before.pen,
  };
}

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
  /// Come disegna lo strumento Poligono: poligono o stella, i lati, le punte,
  /// il rapporto interno e il raggio degli angoli. Vale finché l'editor vive,
  /// come il colore; lo cambiano i tasti mentre si disegna e il pannello
  /// delle proprietà.
  let polygonTool: PolygonTool = POLYGON_TOOL;
  /// Il nome dello strumento `id`: il Poligono, quando disegna stelle, si
  /// chiama Stella.
  /// La penna di Bézier, con la Curvatura, si chiama Curvatura.
  const toolLabel = (id: ToolId): DrawKey =>
    id === "polygon" && polygonTool.shape === "star" ? "draw.tool.star" : id === "bezier" && curvature ? "draw.tool.curvature" : toolSpec(id).label;
  const toolHint = (id: ToolId): DrawKey =>
    id === "polygon" && polygonTool.shape === "star" ? "draw.tool.star.hint" : id === "bezier" && curvature ? "draw.tool.curvature.hint" : toolSpec(id).description;
  /// Gli spessori, o le dimensioni del testo, che la barra offre allo
  /// strumento di adesso.
  const widthsNow = (): readonly Width[] => (tool === "highlighter" ? HIGHLIGHTER_WIDTHS : tool === "text" ? TEXT_SIZES : WIDTHS);
  /// L'ultimo colore scelto a piacere: un campione in più nella barra.
  let custom: string | null = null;
  /// Gli strumenti e i colori di prima, il più recente per primo: le voci
  /// del menu radiale.
  let recentTools: ToolId[] = [];
  let recentColors: string[] = [];
  let selection: string[] = [];
  let camera: View = { scale: 1, angle: 0, tx: 0, ty: 0 };
  /// Il formato della percentuale di zoom, nella lingua di adesso.
  let percent: Intl.NumberFormat | null = null;
  const zoomText = (): string =>
    (percent ??= new Intl.NumberFormat(resolvedLanguage(), { style: "percent", maximumFractionDigits: 0 })).format(camera.scale);
  /// Il formato dell'angolo della vista, nella lingua di adesso.
  let degrees: Intl.NumberFormat | null = null;
  const turnText = (angle: number): string =>
    (degrees ??= new Intl.NumberFormat(resolvedLanguage(), { style: "unit", unit: "degree", maximumFractionDigits: 0 })).format(Math.round(angle) || 0);
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
  /// Il gruppo, o il collegamento, isolato: si sceglie solo lì dentro, e il
  /// resto si attenua. La chiave, e il posto e il tag con cui ritrovarlo
  /// quando un'operazione gli dà un id o lo rifà; `null` quando si sceglie in
  /// tutto il disegno. Isolare non scrive niente nel file.
  let isolation: { readonly key: string; readonly path: readonly number[]; readonly tag: string } | null = null;
  /// Il nodo isolato nel modello di adesso, cercato una volta per modello.
  let isolatedFor: { readonly model: DocumentModel; readonly node: ContainerNode | null } | null = null;
  /// Lo strumento Nodi: le forme di cui modifica i nodi, in ordine di
  /// documento, o perché gli oggetti scelti non ne hanno; i nodi scelti di
  /// ogni forma; i tipi che chi modifica ha dato ai nodi, che il file non
  /// scrive e che valgono finché la forma ha gli stessi nodi; e le forme
  /// scelte con lo strumento, coi loro percorsi nel modello.
  let edits: readonly Editing[] = [];
  let noEditing: DrawKey | null = null;
  let nodeSelection: NodePick = new Map();
  let nodeKinds: ReadonlyMap<string, ReadonlyMap<NodeKey, NodeKind>> = new Map();
  /// I tipi dati ai nodi a ogni punto della cronologia dove una modifica dei
  /// nodi li ha lasciati: il file non li scrive, e un annulla o un ripeti li
  /// riporta come erano lì.
  const kindsAt = new Map<number, ReadonlyMap<string, ReadonlyMap<NodeKey, NodeKind>>>();
  let focused: readonly (readonly number[])[] = [];
  /// Quante forme l'ultima modifica dei nodi ha fatto tracciati, e perché
  /// ne ha lasciata com'era qualcuna.
  let converted = 0;
  let skipped: DrawKey | null = null;
  /// Ciò con cui le forme sono state trovate: cambiato, le si ritrova.
  let resolvedFor: {
    readonly index: SceneIndex;
    readonly keys: string;
    readonly tool: ToolId;
    readonly curve: boolean;
    readonly features: ReadonlySet<Feature>;
    readonly editable: boolean;
    readonly focused: readonly (readonly number[])[];
  } | null = null;
  /// La forma sotto il puntatore che passa, con lo strumento Nodi: il suo
  /// contorno e i suoi nodi si vedono prima di toccarla, come con la
  /// Selezione diretta di Illustrator. Vale per la scena in cui la si è
  /// trovata.
  let nodesHover: {
    readonly index: SceneIndex;
    readonly leaf: LeafNode;
    readonly subs: readonly Subpath[] | null;
    readonly matrix: Matrix;
  } | null = null;
  /// Dove le Forbici taglierebbero sotto il puntatore che passa, o sotto il
  /// cursore della tastiera: il contorno della forma e il punto si vedono
  /// prima di tagliare. Vale per la scena in cui lo si è trovato.
  let cutHover: { readonly index: SceneIndex; readonly spot: CutSpot } | null = null;
  /// Il Costruttore di forme sugli oggetti scelti, per la scena e la
  /// selezione in cui lo si è fatto; dalla scena alle coordinate delle sue
  /// regioni. `builder` è `null` se non c'è niente di scelto o se il calcolo
  /// non riesce, e `complex` dice se è per le forme troppo complesse.
  let building: {
    readonly index: SceneIndex;
    readonly keys: string;
    readonly builder: Builder | null;
    readonly complex: boolean;
    readonly inverse: Matrix | null;
  } | null = null;
  /// La regione del Costruttore sotto il puntatore che passa, e quella a cui
  /// si è arrivati con Tab; -1 per nessuna. Le regioni scelte con Spazio,
  /// nell'ordine: la prima dà lo stile all'unione.
  let regionHover = -1;
  let regionActive = -1;
  let regionsChosen: number[] = [];
  /// L'ultimo tocco su un segmento, per il doppio tocco che aggiunge un nodo.
  let lastSegmentTap: { readonly shape: string; readonly sub: number; readonly link: number; readonly time: number; readonly at: Point } | null = null;
  /// Il tracciato che la penna di Bézier sta disegnando: i nodi nella scena,
  /// i passi fatti e quelli annullati, che Annulla e Ripeti percorrono, gli
  /// id e il livello dell'anteprima. Si scrive quando si conclude, sul
  /// livello di allora.
  let drafting: Drafting | null = null;
  /// Come posa i nodi la penna di Bézier: coi punti e le maniglie, o con la
  /// Curvatura, dove si posano solo i punti e la curva vi passa morbida.
  /// Vale finché l'editor vive, come il Poligono che fa le stelle.
  let curvature = false;
  /// L'ultimo punto che la Curvatura ha posato con un tocco: toccato di
  /// nuovo subito, nello stesso posto, diventa uno spigolo.
  let curveTap: { readonly index: number; readonly at: Point; readonly time: number } | null = null;
  /// L'ultimo nodo di un tracciato scelto che la Curvatura ha toccato: due
  /// tocchi lo fanno passare da liscio a spigolo e ritorno.
  let curveNodeTap: { readonly shape: string; readonly key: NodeKey; readonly at: Point; readonly time: number } | null = null;
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
  /// Le parole dei pulsanti che cambiano col modo dello strumento: il
  /// Poligono con la stella, la penna di Bézier con la Curvatura.
  const relabelTool = new Map<ToolId, () => void>();
  for (const spec of TOOLS) {
    const shortcut = spec.shortcut.toUpperCase();
    const control = button(toolGroup, "draw-button draw-tool", () => `${t(toolLabel(spec.id))} (${shortcut})`, spec.icon, () => pickTool(spec.id));
    control.setAttribute("role", "radio");
    control.setAttribute("aria-keyshortcuts", shortcut);
    control.dataset.tool = spec.id;
    const hint = document.createElement("span");
    hint.className = "sr-only";
    hint.id = identifier(`draw-hint-${spec.id}`);
    control.setAttribute("aria-describedby", hint.id);
    const label = (): void => {
      const text = t(toolLabel(spec.id));
      control.title = `${text} (${shortcut})`;
      control.setAttribute("aria-label", text);
      hint.textContent = t(toolHint(spec.id));
    };
    relabels.push(label);
    relabelTool.set(spec.id, label);
    control.append(hint);
    toolButtons.set(spec.id, control);
  }

  /// Il pulsante dello strumento `id` come disegna adesso: l'icona e le
  /// parole della stella o del poligono, della Curvatura o della penna.
  const showToolMode = (id: ToolId): void => {
    const control = toolButtons.get(id);
    const now = control?.querySelector("svg");
    const glyph = iconEl(toolIcon(id));
    if (now != null && glyph !== null) now.replaceWith(glyph);
    relabelTool.get(id)?.();
  };

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
  // La selezione avanzata, dal livello Standard: un menu, lo stesso del tasto
  // destro sul foglio.
  const selectionButton = button(editGroup, "draw-button", () => t("draw.selection.menu"), "draw-selection", () => openMenu(selectionButton, selectionItems()));
  selectionButton.id = identifier("draw-selection-button");
  selectionButton.setAttribute("aria-haspopup", "menu");
  selectionButton.setAttribute("aria-expanded", "false");
  // «Proprietà» apre e chiude il pannello, dal livello che lo offre; senza,
  // apre la finestra.
  const propertiesButton = button(editGroup, "draw-button", () => t("draw.properties"), "properties", () => {
    if (has("properties")) showPanel(panel.element.hidden);
    else void properties();
  });
  propertiesButton.setAttribute("aria-keyshortcuts", "Enter");

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
    onToggle: (key, what) => toggleRow(key, what === "lock" ? "locked" : "hidden"),
    canRename: (key) => canRename(key),
    onRename: (key, name) => renameRow(key, name),
    canMove: (keys, drop) => {
      const plan = placing(keys, drop);
      return plan !== null && typeof plan !== "string";
    },
    onMove: (keys, drop) => moveRows(keys, drop),
    onEdge: (key, front) => announce(t(outlineNow().byKey.get(key)?.item.role === "layer" ? (front ? "draw.layer.edge.top" : "draw.layer.edge.bottom") : front ? "draw.move.edge.front" : "draw.move.edge.back")),
  });
  tree.element.hidden = true;
  relabels.push(() => tree.relabel());

  // La cronologia, dal livello Standard: i passi del disegno, per tornare a
  // uno qualsiasi in un colpo, e i segni. Ciò che mostra: la revisione della
  // pila e se si poteva cambiare.
  let historyShown: { readonly revision: number; readonly editable: boolean } | null = null;
  const historyPanel = createHistoryPanel(life, {
    onGo: (at, mark) => goToPoint(at, mark),
    onMark: () => markHere(),
    onRename: (id, name) => renameMark(id, name),
    onUnmark: (id) => unmark(id),
    onLeave: () => surface.focus({ preventScroll: true }),
  });
  historyPanel.element.hidden = true;
  relabels.push(() => {
    historyPanel.relabel();
    historyShown = null;
    syncHistory();
  });

  // La verifica dell'accessibilità, dal livello Standard: i problemi del
  // disegno con le loro correzioni, e l'ordine di lettura. Il disegno si
  // rilegge soltanto col pannello aperto. Ciò che ha trovato nel testo
  // `text`, e ciò che il pannello mostra.
  let audited: { readonly text: string; readonly problems: readonly Problem[] } | null = null;
  let accessShown: {
    readonly problems: readonly Problem[];
    readonly items: readonly Item[];
    readonly selected: string | null;
    readonly editable: boolean;
  } | null = null;
  let auditTimer: ReturnType<typeof setTimeout> | undefined;
  life.add(() => clearTimeout(auditTimer));
  const accessPanel = createAccessPanel(life, {
    onGo: (key) => goToObject(key),
    onFix: (problem) => fixProblem(problem),
    onDescribe: (key, text) => describeImage(key, text),
    onDecorative: (key) => decorateImage(key),
    onMove: (key, later, confirmed) => moveInReading(key, later, confirmed),
    onLeave: () => surface.focus({ preventScroll: true }),
  });
  accessPanel.element.hidden = true;
  relabels.push(() => {
    accessNames.clear();
    accessShown = null;
    accessPanel.relabel();
    syncAccess();
  });

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

  // Le proprietà della selezione, o del disegno, dal livello Standard: un
  // pannello accanto al foglio, che si apre da sé se c'è posto. Al livello
  // Esperto ospita gli attributi, come una sua sezione.
  const panel = createProperties(life, {
    closed: grid.closed as readonly SectionId[],
    onChange: (id, value) => changeField(id, value),
    onAction: (id) => runAction(id),
    onTransform: (values) => transformFields(values),
    onSection: (id, open) => {
      const closed = grid.closed.filter((each) => each !== id);
      changeGrid({ ...grid, closed: open ? closed : [...closed, id] });
    },
    announce: (text) => announce(text),
    onLeave: () => surface.focus({ preventScroll: true }),
  });
  panel.element.hidden = true;
  /// Ciò che il pannello mostra: si ridisegna quando cambia il disegno, la
  /// selezione, la vista o il livello.
  let panelShown: {
    readonly index: SceneIndex;
    readonly keys: string;
    readonly unit: LengthUnit;
    readonly editable: boolean;
    readonly grid: Grid;
    readonly features: ReadonlySet<Feature>;
    readonly ratio: unknown;
    readonly kept: unknown;
    readonly polygon: PolygonTool | null;
  } | null = null;
  /// Il lucchetto delle proporzioni, come l'ha lasciato chi l'ha toccato,
  /// per la selezione di chiavi `keys`.
  let ratioLock: { readonly keys: string; readonly on: boolean } | null = null;
  relabels.push(() => {
    panel.relabel();
    panelShown = null;
    syncProperties();
  });

  const viewGroup = group("draw.view", false);
  button(viewGroup, "draw-button", () => t("draw.zoom_out"), "draw-zoom-out", () => zoomBy(1 / ZOOM_STEP));
  // Il nome contiene la percentuale che si vede (WCAG 2.5.3): chi la dice a
  // voce trova il pulsante.
  const zoomLevel = button(viewGroup, "draw-button draw-zoom-level", () => t("draw.zoom_reset", { zoom: zoomText() }), null, () => zoomBy(1 / camera.scale));
  button(viewGroup, "draw-button", () => t("draw.zoom_in"), "draw-zoom-in", () => zoomBy(ZOOM_STEP));
  const fitButton = button(viewGroup, "draw-button", () => t("draw.fit"), "draw-fit", () => fit());
  fitButton.setAttribute("aria-keyshortcuts", "Shift+1");
  // Sul foglio girato, il suo angolo: un clic lo raddrizza. Il nome contiene
  // l'angolo che si vede, come quello dello zoom.
  const turnButton = button(viewGroup, "draw-button draw-zoom-level", () => t("draw.turn.button", { angle: turnText(camera.angle) }), null, () => turnView(0));
  turnButton.dataset.turn = "";
  turnButton.setAttribute("aria-keyshortcuts", "5");
  turnButton.hidden = true;
  // La griglia e la pagina, dal livello Standard: un menu.
  const pageButton = button(viewGroup, "draw-button", () => t("draw.page_grid"), "draw-page-grid", () => openMenu(pageButton, pageItems()));
  pageButton.setAttribute("aria-haspopup", "menu");
  pageButton.setAttribute("aria-expanded", "false");
  const objectsButton = button(viewGroup, "draw-button", () => t("draw.objects"), "outline", () => showObjects(tree.element.hidden));
  objectsButton.setAttribute("aria-expanded", "false");
  objectsButton.setAttribute("aria-controls", tree.element.id);
  const historyButton = button(viewGroup, "draw-button", () => t("draw.history"), "draw-history", () => showHistory(historyPanel.element.hidden));
  historyButton.setAttribute("aria-expanded", "false");
  historyButton.setAttribute("aria-controls", historyPanel.element.id);
  const accessButton = button(viewGroup, "draw-button", () => t("draw.access"), "draw-access", () => showAccess(accessPanel.element.hidden));
  accessButton.setAttribute("aria-expanded", "false");
  accessButton.setAttribute("aria-controls", accessPanel.element.id);
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
  // Dal livello Standard: i tratti a penna scelti diventano le forme a cui
  // somigliano. C'è solo quando ce n'è uno.
  const shapeButton = arrangeButton("draw.to_shape", "draw-to-shape", null, () => shapeSelectedInk());
  // Dal livello Esperto: ruotare, scalare e inclinare di quanto si scrive.
  // Col pannello delle proprietà, porta ai campi di «Trasforma».
  const transformButton = arrangeButton("draw.transform", "draw-transform", TRANSFORM_BINDING, () => {
    if (!focusTransform()) void transformDialog();
  });
  // Dal livello Esperto: la trasformazione passa nella geometria.
  const applyButton = arrangeButton("draw.apply_transform", "draw-apply-transform", null, () => applySelection());
  // Dal livello Esperto, il menu Tracciato: gli oggetti e i contorni
  // diventano tracciati, l'inchiostro i suoi nodi; lo scostamento e la
  // semplificazione si regolano in una barra, con l'anteprima.
  const pathButton = arrangeButton("draw.path", "draw-to-path", null, () => openMenu(pathButton, pathItems()));
  // Dal livello Esperto: unione, differenza, intersezione, esclusione e
  // divisione, in un menu.
  const booleanButton = arrangeButton("draw.boolean", "draw-boolean", null, () => openMenu(booleanButton, booleanItems()));
  // Dal livello Esperto: tratteggio, estremi e angoli dei contorni scelti.
  const outlineButton = arrangeButton("draw.outline", "draw-outline", null, () => openMenu(outlineButton, outlineItems()));
  for (const control of [orderButton, intoButton, alignButton, pathButton, booleanButton, outlineButton]) {
    control.setAttribute("aria-haspopup", "menu");
    control.setAttribute("aria-expanded", "false");
  }
  // I comandi dei nodi, dal livello Esperto: con lo strumento Nodi e una
  // forma da modificare prendono il posto di quelli della selezione, con le
  // scorciatoie di Inkscape, e «Allinea» allinea i nodi scelti.
  const nodesBar = document.createElement("div");
  nodesBar.className = "draw-arrange";
  nodesBar.setAttribute("role", "toolbar");
  nodesBar.hidden = true;
  relabels.push(() => nodesBar.setAttribute("aria-label", t("draw.nodes.bar")));
  const nodesButton = (label: DrawKey, iconName: string, binding: string | null, run: () => void): HTMLButtonElement => {
    const control = button(nodesBar, "draw-button", () => t(label), iconName, run);
    if (binding !== null) control.setAttribute("aria-keyshortcuts", ariaBinding(binding) || binding);
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
  const alignNodesButton = nodesButton("draw.nodes.align", "draw-align", null, () => openMenu(alignNodesButton, nodeAlignItems()));
  alignNodesButton.setAttribute("aria-haspopup", "menu");
  alignNodesButton.setAttribute("aria-expanded", "false");
  // Il gruppo isolato: una barra in fondo al foglio dice dove si è, dal
  // livello, o dal disegno, al gruppo; il pulsante ne esce di un gruppo, e
  // un gruppo del percorso ci riporta.
  const isolationBar = document.createElement("nav");
  isolationBar.className = "draw-isolation";
  isolationBar.hidden = true;
  const isolationBack = document.createElement("button");
  isolationBack.type = "button";
  isolationBack.className = "draw-button";
  isolationBack.setAttribute("aria-keyshortcuts", "Escape");
  const backIcon = iconEl("draw-back");
  if (backIcon !== null) isolationBack.append(backIcon);
  life.listen(isolationBack, "click", () => leaveIsolation(false));
  const isolationPath = document.createElement("ol");
  isolationPath.className = "draw-isolation-path";
  isolationBar.append(isolationBack, isolationPath);
  life.listen(isolationPath, "click", (event) => {
    const crumb = event.target instanceof Element ? event.target.closest<HTMLElement>(".draw-isolation-crumb") : null;
    if (crumb instanceof HTMLButtonElement) isolateAt(Number(crumb.dataset.depth));
  });
  relabels.push(() => {
    isolationBar.setAttribute("aria-label", t("draw.isolation"));
    const text = t("draw.isolate.exit");
    isolationBack.setAttribute("aria-label", text);
    isolationBack.title = `${text} (Esc)`;
    isolationShown = null;
    showIsolation();
  });

  // Esc in una barra torna al foglio, con la selezione com'era.
  for (const bar of [arrangeBar, nodesBar, isolationBar]) {
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

  // Un incolla lungo: in alto sul foglio, che cosa sta facendo, quanto ne ha
  // fatto e il pulsante che lo interrompe, come Esc.
  const progressBar = document.createElement("div");
  progressBar.className = "draw-progress";
  progressBar.hidden = true;
  const progressLabel = document.createElement("span");
  progressLabel.className = "draw-progress-label";
  progressLabel.id = identifier("draw-progress");
  const progressMeter = document.createElement("progress");
  progressMeter.className = "draw-progress-meter";
  progressMeter.setAttribute("aria-labelledby", progressLabel.id);
  const progressStop = document.createElement("button");
  progressStop.type = "button";
  progressStop.className = "draw-progress-stop";
  progressStop.setAttribute("aria-keyshortcuts", "Escape");
  progressBar.append(progressLabel, progressMeter, progressStop);
  relabels.push(() => {
    const text = t("draw.paste.stop");
    progressStop.textContent = text;
    progressStop.title = `${text} (Esc)`;
  });

  // La descrizione delle immagini appena entrate, dallo Standard: in fondo al
  // foglio, una alla volta, col campo, «Scrivi», «Decorativa» e «Salta». Non
  // è una finestra: il disegno resta di chi lo fa, e la barra aspetta.
  const describeBar = document.createElement("div");
  describeBar.className = "draw-describe";
  describeBar.setAttribute("role", "group");
  describeBar.hidden = true;
  const describeLabel = document.createElement("label");
  describeLabel.className = "draw-describe-label";
  describeLabel.id = identifier("draw-describe");
  const describeInput = document.createElement("input");
  describeInput.type = "text";
  describeInput.className = "draw-describe-input";
  describeInput.id = identifier("draw-describe-input");
  describeInput.autocomplete = "off";
  describeInput.maxLength = NAME_MAX;
  describeLabel.htmlFor = describeInput.id;
  describeBar.setAttribute("aria-labelledby", describeLabel.id);
  const describeHint = document.createElement("span");
  describeHint.className = "sr-only";
  describeHint.id = identifier("draw-describe-hint");
  describeInput.setAttribute("aria-describedby", describeHint.id);
  const describeButton = (action: string): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-button draw-describe-action";
    control.dataset.action = action;
    return control;
  };
  const describeWrite = describeButton("write");
  const describeDecorative = describeButton("decorative");
  const describeSkip = describeButton("skip");
  describeBar.append(describeLabel, describeInput, describeHint, describeWrite, describeDecorative, describeSkip);
  relabels.push(() => {
    describeInput.placeholder = t("draw.access.describe.placeholder");
    describeHint.textContent = t("draw.describe.hint");
    describeWrite.textContent = t("draw.describe.write");
    describeDecorative.textContent = t("draw.access.fix.decorative");
    describeDecorative.setAttribute("aria-label", t("draw.access.fix.decorative.label"));
    describeSkip.textContent = t("draw.describe.skip");
    describeSkip.setAttribute("aria-label", t("draw.describe.skip.label"));
    describeLabel.textContent = t("draw.describe");
    showDescription();
  });

  // Lo scostamento e la semplificazione, dal menu Tracciato: in fondo al
  // foglio, come la descrizione delle immagini. Non è una finestra: mentre
  // si regola, il disegno si guarda da vicino e gli oggetti scelti
  // cambiano, e l'anteprima li segue.
  const pathsBar = document.createElement("div");
  pathsBar.className = "draw-paths";
  pathsBar.setAttribute("role", "group");
  pathsBar.hidden = true;
  const pathsTitle = document.createElement("span");
  pathsTitle.className = "draw-paths-title";
  pathsTitle.id = identifier("draw-paths");
  pathsBar.setAttribute("aria-labelledby", pathsTitle.id);
  /// Un campo della barra: il nome, e accanto `control`.
  const pathsField = (control: HTMLInputElement | HTMLSelectElement): { readonly field: HTMLLabelElement; readonly name: HTMLSpanElement } => {
    const field = document.createElement("label");
    field.className = "draw-paths-field";
    const name = document.createElement("span");
    field.append(name, control);
    return { field, name };
  };
  const offsetInput = document.createElement("input");
  offsetInput.type = "number";
  offsetInput.inputMode = "decimal";
  offsetInput.step = "any";
  offsetInput.autocomplete = "off";
  const offsetField = pathsField(offsetInput);
  const joinSelect = document.createElement("select");
  const joinOptions = new Map<Join, HTMLOptionElement>();
  for (const join of JOIN_NAMES.keys()) {
    const option = document.createElement("option");
    option.value = join;
    joinOptions.set(join, option);
    joinSelect.append(option);
  }
  const joinField = pathsField(joinSelect);
  const limitInput = document.createElement("input");
  limitInput.type = "number";
  limitInput.inputMode = "decimal";
  limitInput.step = "any";
  limitInput.min = "1";
  limitInput.autocomplete = "off";
  const limitField = pathsField(limitInput);
  const amountInput = document.createElement("input");
  amountInput.type = "range";
  amountInput.min = "0";
  amountInput.max = String(SIMPLIFY_STEPS);
  amountInput.step = "1";
  const amountField = pathsField(amountInput);
  const pathsStatus = document.createElement("output");
  pathsStatus.className = "draw-paths-status";
  pathsStatus.setAttribute("aria-live", "polite");
  const pathsAction = (): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-button draw-paths-action";
    return control;
  };
  const pathsApply = pathsAction();
  const pathsCancel = pathsAction();
  pathsBar.append(pathsTitle, offsetField.field, joinField.field, limitField.field, amountField.field, pathsApply, pathsCancel, pathsStatus);
  /// Il comando della barra aperta; `null` se è chiusa.
  let pathsMode: "offset" | "simplify" | null = null;
  /// L'anteprima di adesso, con la selezione e l'indice per cui vale: le
  /// regole della barra che cambiano la tolgono.
  let pathsShown: { readonly selection: readonly string[]; readonly index: SceneIndex; readonly handles: readonly OverlayHandle[] } | null = null;
  /// L'unità in cui è scritta la distanza.
  let offsetUnit: LengthUnit = "px";
  /// L'ultima distanza dello scostamento, in unità della scena, gli ultimi
  /// angoli e l'ultima semplificazione: la barra riapre con quelli.
  let offsetLast: number | null = null;
  let joinLast: Join = "miter";
  let limitLast = 4;
  let amountLast = SIMPLIFY_STEPS / 2;
  relabels.push(() => {
    joinField.name.textContent = t("draw.offset.join");
    for (const [join, label] of JOIN_NAMES) joinOptions.get(join)!.textContent = t(label);
    limitField.name.textContent = t("draw.offset.limit");
    amountField.name.textContent = t("draw.simplify.amount");
    pathsApply.textContent = t("draw.paths.apply");
    pathsCancel.textContent = t("draw.paths.cancel");
    showPaths();
  });

  // Il foglio con la sua barra e, accanto, i pannelli: l'albero degli
  // oggetti, le proprietà, gli attributi e, in fondo, la cronologia e
  // l'accessibilità.
  const stage = document.createElement("div");
  stage.className = "draw-stage";
  stage.append(surface, linkLayer, textLayer, arrangeBar, nodesBar, isolationBar, progressBar, describeBar, pathsBar);
  const dock = document.createElement("div");
  dock.className = "draw-dock";
  dock.hidden = true;
  dock.append(tree.element, panel.element, inspector.element, historyPanel.element, accessPanel.element);
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
  const painter = createSvgPainter(surface, life, {
    fonts: appFonts,
    ...(images === undefined ? {} : { images: (href: string, owner: Lifetime) => images.url(href, owner) }),
  });
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
  const indexer = new SceneIndexer(builder, (id) => engine.holder(id));
  let scene: PaintScene = builder.build(engine);
  let index: SceneIndex | null = null;
  const EMPTY = new SceneIndex([], []);

  const editable = (): boolean => !locked && engine.status === "fubdraw" && engine.model !== null;

  /// Il gruppo isolato nel disegno di adesso; `null` se non ce n'è, se non
  /// c'è più, o se dentro non si sceglie più: bloccato, nascosto, o dentro
  /// uno che lo è. Si cerca per id, poi al suo posto, dove un oggetto con un
  /// altro id non è lui.
  const isolatedNode = (): ContainerNode | null => {
    const model = engine.model;
    if (isolation === null || model === null) return null;
    if (isolatedFor?.model === model) return isolatedFor.node;
    const wanted = isolation;
    const fits = (node: ElementPart | null): node is ContainerNode =>
      node !== null && node.kind === "container" && tagName(node) === wanted.tag && indexer.opens(model, node);
    let node: ElementPart | null = wanted.key.startsWith("@") ? null : engine.holder(wanted.key);
    if (!fits(node)) {
      node = nodeAtPath(model, wanted.path);
      if (node !== null && node.facts.id !== null && node.facts.id !== wanted.key) node = null;
    }
    const found = fits(node) ? node : null;
    isolatedFor = { model, node: found };
    if (found !== null) {
      const path = pathOf(found);
      isolation = { key: keyOf({ id: found.facts.id, path }), path, tag: wanted.tag };
    }
    return found;
  };

  /// Il gruppo isolato e chi lo contiene, dal figlio della radice in giù:
  /// ciò che il painter non attenua.
  const isolationChain = (): ContainerNode[] | null => {
    const node = isolatedNode();
    if (node === null) return null;
    const chain: ContainerNode[] = [];
    for (let at: ContainerNode | null = node; at !== null && at.parent !== null; at = at.parent) chain.unshift(at);
    return chain;
  };

  /// Gli oggetti che si scelgono: quelli in cima, o i figli del gruppo
  /// isolato.
  const currentIndex = (): SceneIndex => {
    if (index === null) index = engine.model === null ? EMPTY : indexer.index(engine.model, isolatedNode());
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
    const { scale } = camera;
    const [x, y] = toScreen(camera, [page.x, page.y]);
    // Sul foglio girato la carta gira attorno al suo angolo, l'origine della
    // trasformazione.
    paper.style.transform = camera.angle === 0 ? `translate(${x}px, ${y}px)` : `translate(${x}px, ${y}px) rotate(${camera.angle}deg)`;
    paper.style.width = `${scale * page.width}px`;
    paper.style.height = `${scale * page.height}px`;
  };

  /// La griglia sullo schermo, se il livello la offre e la si vuole vedere.
  const showGrid = (): void => {
    const shown = has("grid") && grid.shown;
    gridMark.style.display = shown ? "" : "none";
    if (!shown) return;
    gridMark.toggleAttribute("data-slanted", camera.angle % 90 !== 0);
    const lines = gridLines(camera, surface.clientWidth, surface.clientHeight, stepNow());
    gridMinor.setAttribute("d", lines.minor);
    gridMajor.setAttribute("d", lines.major);
  };

  /// Il cursore del foglio sullo schermo; pieno mentre la tastiera preme.
  const showCursor = (): void => {
    cursorMark.toggleAttribute("data-pressed", pressed !== null);
    if (cursor === null) return;
    const [x, y] = toScreen(camera, cursor);
    cursorMark.style.transform = `translate(${x}px, ${y}px)`;
  };

  /// L'angolo della vista nel suo pulsante, che si vede solo sul foglio
  /// girato.
  const showTurn = (force = false): void => {
    const text = camera.angle === 0 ? "" : turnText(camera.angle);
    turnButton.hidden = text === "";
    if (!force && turnButton.textContent === text) return;
    turnButton.textContent = text;
    const label = t("draw.turn.button", { angle: text });
    turnButton.setAttribute("aria-label", label);
    turnButton.title = label;
  };

  const setCamera = (next: View): void => {
    camera = next;
    painter.setView(next);
    overlay.setView(next);
    previewCamera.setAttribute("transform", viewTransform(next));
    showPage();
    showGrid();
    showGuideLines();
    showZoom();
    showTurn();
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
  /// Il formato di un contrasto o di un corpo detti a voce, al centesimo.
  let hundredths: Intl.NumberFormat | null = null;
  const hundredthsText = (value: number): string =>
    (hundredths ??= new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: 2, useGrouping: false })).format(value);
  relabels.push(() => {
    percent = null;
    degrees = null;
    showTurn(true);
    coordinates = null;
    hundredths = null;
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

  /// Il punto della scena sotto il punto `clientX`, `clientY` del client.
  const sceneAt = (clientX: number, clientY: number): Point => {
    const local = localPoint(clientX, clientY);
    return toScene(camera, [local.x, local.y]);
  };

  /// Vero se l'asse x della scena si vede più orizzontale che verticale: sul
  /// foglio girato fino a 45°, o oltre 135°.
  const sceneLevel = (): boolean => Math.abs(camera.angle) <= 45 || Math.abs(camera.angle) >= 135;

  /// Il cursore di una guida della scena lungo `axis`, che si sposta di
  /// traverso: sul foglio girato gira con lei.
  const axisCursor = (axis: "x" | "y"): GripCursor => directionCursor(camera.angle + (axis === "x" ? 0 : 90));

  /// Il centro di ciò che si vede del foglio, sullo schermo.
  const viewCenter = (): Point => {
    const area = viewArea();
    return [area.x + area.w / 2, area.y + area.h / 2];
  };

  const zoomBy = (factor: number): void => {
    setCamera(zoomAt(camera, factor, viewCenter(), DRAW_SCALE_LIMITS));
  };

  /// `bounds` inquadrato in ciò che si vede del foglio, accanto ai righelli,
  /// all'angolo di adesso.
  const fitted = (bounds: Bounds, area: ReturnType<typeof viewArea>): View => fitView(bounds, area, FIT_PAD, camera.angle, DRAW_SCALE_LIMITS);

  /// Dice l'angolo della vista.
  const announceTurn = (): void => {
    announce(camera.angle === 0 ? t("draw.turn.straight") : t("draw.turn.at", { angle: turnText(camera.angle) }));
  };

  /// Gira la vista fino all'angolo `angle`, attorno al centro di ciò che si
  /// vede, e lo dice. Il disegno non cambia: l'angolo è solo della vista.
  function turnView(angle: number): void {
    if (!has("gestures") && angle !== 0) return;
    placed = true;
    setCamera(turnTo(camera, angle, viewCenter()));
    announceTurn();
  }

  function fit(): void {
    const page = scene.root.page;
    let bounds: Bounds | null = page === null ? null : { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] };
    // Con un gruppo isolato si inquadra lo stesso tutto il disegno.
    for (const unit of isolation === null ? currentIndex().units : seenUnits()) bounds = union(bounds, unit.bounds);
    const area = viewArea();
    if (area.w === 0 || area.h === 0) return;
    placed = true;
    if (bounds === null) {
      setCamera({ scale: 1, angle: camera.angle, tx: area.x, ty: area.y });
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
      placeBar();
      if (panelPending && root.clientWidth > 0) showPanelByDefault();
    });
    sizeObserver.observe(surface);
    life.add(() => sizeObserver.disconnect());
  }

  // --- Selezione e anteprime ----------------------------------------------

  /// Gli oggetti di `keys` che si scelgono adesso, anche dentro i gruppi,
  /// una volta sola e in ordine di documento; di un gruppo scelto non anche
  /// ciò che contiene, che si muove già con lui.
  const unitsOf = (keys: Iterable<string>): Unit[] => {
    const index = currentIndex();
    const found = new Map<string, Unit>();
    for (const key of keys) {
      const unit = index.get(key);
      if (unit !== null) found.set(unit.key, unit);
    }
    const out: Unit[] = [];
    // In ordine di documento chi contiene viene subito prima di ciò che
    // contiene: basta guardare l'ultimo tenuto.
    for (const unit of [...found.values()].sort((a, b) => comparePaths(a.path, b.path))) {
      const last = out[out.length - 1];
      if (last === undefined || !holdsPath(last.path, unit.path)) out.push(unit);
    }
    return out;
  };

  const selectedUnits = (): Unit[] => unitsOf(selection);

  /// Le chiavi di `keys` che sono oggetti adesso, come [`unitsOf`].
  const inOrder = (keys: Iterable<string>): string[] => unitsOf(keys).map((unit) => unit.key);

  // --- I nodi -------------------------------------------------------------

  /// Le spine dei tratti a penna, per inchiostro: una modifica ricorda
  /// quella che ha scritto, così i nodi restano quelli che si toccavano,
  /// anche dopo un annulla.
  const spines = new Map<string, Spine>();
  const spineOf = (text: string, ink: Ink, tolerance: number): Spine => {
    const known = spines.get(text);
    if (known !== undefined) return known;
    const spine = inkSpine(ink, tolerance);
    remember(text, spine);
    return spine;
  };
  const remember = (text: string, spine: Spine): void => {
    spines.delete(text);
    spines.set(text, spine);
    if (spines.size > SPINES) spines.delete(spines.keys().next().value!);
  };

  /// I nodi della forma `leaf`, o perché non ne ha. Si ricordano per
  /// elemento: un elemento che cambia è un altro, e il riquadro e il
  /// passaggio del puntatore li chiedono a ogni passo.
  const nodables = new WeakMap<LeafNode, Nodable | NoNodes>();
  const nodableAt = (leaf: LeafNode): Nodable | NoNodes => {
    let found = nodables.get(leaf);
    if (found === undefined) {
      found = nodableOf(leaf, spineOf);
      nodables.set(leaf, found);
    }
    return found;
  };

  /// La Curvatura su un tracciato che c'è già: con la penna di Bézier nel
  /// modo Curvatura e nessun tracciato in corso, i nodi delle forme scelte
  /// si spostano, si aggiungono e si tolgono come li disegna la Curvatura.
  const curveOn = (): boolean => tool === "bezier" && curvature && drafting === null && has("bezier");

  /// Le forme di cui lo strumento Nodi modifica i nodi: con lo strumento
  /// Nodi, se il livello lo offre, o con la Curvatura ([`curveOn`]), col
  /// disegno che si scrive. Di ogni oggetto scelto, le forme scelte con lo
  /// strumento, o se non ce n'è nessuna tutte quelle che hanno nodi. Ogni
  /// forma ne ha, anche un rettangolo, una freccia o un tratto a penna; un
  /// testo e un'immagine no. Senza nessuna forma, una chiave dice perché;
  /// `null`, che non c'è niente da dire.
  const nodeTargets = (): readonly Editing[] | DrawKey | null => {
    if (!((tool === "nodes" && has("nodes")) || curveOn()) || !editable() || selection.length === 0) return null;
    const out: Editing[] = [];
    let first: NoNodes | "flat" | null = null;
    for (const unit of selectedUnits()) {
      const found: Editing[] = [];
      const chosen: Editing[] = [];
      for (const shape of unit.shapes()) {
        const nodable = nodableAt(shape.leaf);
        if (typeof nodable === "string") {
          first ??= nodable;
          continue;
        }
        const inverse = invert(shape.matrix);
        if (inverse === null) {
          first ??= "flat";
          continue;
        }
        const path = pathOf(shape.leaf);
        const edit: Editing = {
          unit,
          leaf: shape.leaf,
          path,
          key: path.join("."),
          nodable,
          subs: nodable.subs,
          matrix: shape.matrix,
          inverse,
          paints: builder.paintsOf(shape.leaf),
        };
        found.push(edit);
        if (focused.some((each) => samePath(each, path))) chosen.push(edit);
      }
      out.push(...(chosen.length > 0 ? chosen : found));
    }
    if (out.length > 0) return out;
    return first === "flat" ? "draw.nodes.flat" : NO_NODES[first ?? "other"];
  };

  /// Ritrova le forme quando cambia ciò da cui dipendono: la scena, la
  /// selezione, lo strumento, il livello, la scrittura, le forme scelte. I
  /// nodi scelti e i tipi dati di una forma restano finché la forma è la
  /// stessa, con gli stessi nodi. Vero se le ha ritrovate.
  const resolveNodes = (): boolean => {
    const index = currentIndex();
    const keys = selection.join("\n");
    const canEdit = editable();
    const last = resolvedFor;
    if (
      last !== null && last.index === index && last.keys === keys && last.tool === tool && last.curve === curveOn() && last.features === features &&
      last.editable === canEdit && last.focused === focused
    ) return false;
    const before = new Map(edits.map((edit) => [edit.key, edit]));
    const found = nodeTargets();
    edits = found === null || typeof found === "string" ? [] : found;
    noEditing = typeof found === "string" ? found : null;
    // Una forma scelta che non si modifica più, perché il suo oggetto non è
    // più scelto o lo strumento è un altro, non lo è più.
    const still = focused.filter((path) => edits.some((edit) => samePath(edit.path, path)));
    if (still.length !== focused.length) focused = still;
    resolvedFor = { index, keys, tool, curve: curveOn(), features, editable: canEdit, focused };
    const same = new Set(edits.flatMap((edit) => {
      const was = before.get(edit.key);
      return was !== undefined && sameNodes(was.subs, edit.subs) ? [edit.key] : [];
    }));
    nodeSelection = new Map([...nodeSelection].filter(([key]) => same.has(key)));
    nodeKinds = new Map([...nodeKinds].filter(([key]) => same.has(key)));
    return true;
  };

  /// Le forme che si modificano, come chiave: cambiate, un tocco le dice.
  const shapesKey = (shapes: readonly (readonly number[])[]): string => shapes.map((path) => path.join(".")).join("\n");

  /// La forma di chiave `key`, fra quelle che si modificano.
  const editOf = (key: string): Editing | undefined => edits.find((edit) => edit.key === key);

  /// I nodi scelti della forma `edit`.
  const pickedIn = (edit: Editing): ReadonlySet<NodeKey> => nodeSelection.get(edit.key) ?? NO_KEYS;

  /// Quanti nodi sono scelti, in tutte le forme.
  const chosenCount = (): number => {
    let count = 0;
    for (const keys of nodeSelection.values()) count += keys.size;
    return count;
  };

  /// Le forme che hanno nodi scelti, in ordine di documento.
  const chosenEdits = (): Editing[] => edits.filter((edit) => pickedIn(edit).size > 0);

  /// Le chiavi degli oggetti delle forme che si modificano.
  const editedUnits = (): string[] => [...new Set(edits.map((edit) => edit.unit.key))];

  /// Il tipo di ogni nodo di `subs`, i nodi della forma `edit`: quello dato
  /// da chi modifica, `given`, o quello che si legge. I capi di un
  /// sottotracciato aperto non ne hanno uno, e valgono come spigoli.
  const kindsOf = (edit: Editing, subs = edit.subs, given = nodeKinds.get(edit.key) ?? NO_KINDS): KindOf => (s, at) => {
    const sub = subs[s]!;
    return innerNode(sub, at) ? given.get(nodeKey(s, at)) ?? kindOf(sub, at) : "corner";
  };

  /// Le maniglie che si vedono di `subs`, i nodi della forma `edit`, coi
  /// nodi `chosen` scelti: ognuna dove si vede ([`handleSpot`]), anche
  /// quella di una linea o di un arco, e quella ritirata sul suo nodo
  /// accanto a lui, lunga `FOLDED_PX` sullo schermo. Quella di una linea, o
  /// una ritirata, se sta più vicina al nodo di `LATENT_PX` non si vede.
  /// L'asta di una freccia non si piega: non ne ha.
  const shownHandles = (edit: Editing, subs = edit.subs, chosen = pickedIn(edit)): Array<{ readonly handle: HandleRef; readonly point: Point; readonly folded: boolean }> => {
    if (edit.nodable.kind === "arrow" || chosen.size === 0) return [];
    const m = edit.matrix;
    // Quanto è lungo sullo schermo un passo `direction` del tracciato.
    const onScreen = (direction: Point): number => Math.hypot(m[0] * direction[0] + m[2] * direction[1], m[1] * direction[0] + m[3] * direction[1]) * camera.scale;
    const stub = (direction: Point): number => {
      const size = onScreen(direction);
      return size > 0 ? FOLDED_PX / size : 0;
    };
    return handlesFor(subs, chosen).flatMap((handle) => {
      const spot = handleSpot(subs, handle, stub);
      if (spot === null) return [];
      const sub = subs[handle.sub]!;
      if (spot.folded || sub.links[handle.link]!.kind === "line") {
        const node = sub.nodes[handleNode(sub, handle)]!;
        if (onScreen([spot.point[0] - node[0], spot.point[1] - node[1]]) < LATENT_PX) return [];
      }
      return [{ handle, ...spot }];
    });
  };

  /// La forma `edit` come la lascia il trascinamento in corso: i nodi, e i
  /// nodi scelti e i tipi dati, che una maniglia tirata fuori può cambiare.
  const draftOfEdit = (edit: Editing): { readonly subs: readonly Subpath[]; readonly chosen: ReadonlySet<NodeKey>; readonly kinds: KindOf } => {
    const curve = current?.kind === "bezier" && current.path?.edit.key === edit.key ? current.reshaped : null;
    if (curve !== null) return { subs: curve.subs, chosen: new Set([curve.key]), kinds: kindsOf(edit, curve.subs, curve.kinds) };
    const g = current?.kind === "nodes" ? current : null;
    const subs = g?.draft?.get(edit.key) ?? edit.subs;
    const reshaped = g?.reshaped?.shape === edit.key && g.draft?.has(edit.key) === true ? g.reshaped : null;
    return { subs, chosen: reshaped?.chosen ?? pickedIn(edit), kinds: kindsOf(edit, subs, reshaped?.kinds) };
  };

  /// Il contorno della forma `edit`, le maniglie e i nodi, come li lascia il
  /// trascinamento se ce n'è uno: prima il contorno, sopra le maniglie, sopra
  /// ancora i nodi.
  const nodeHandles = (edit: Editing): OverlayHandle[] => {
    const { subs, chosen, kinds } = draftOfEdit(edit);
    const m = edit.matrix;
    const out: OverlayHandle[] = [{ kind: "outline", segments: writeNodes(subs), matrix: m }];
    // La Curvatura non mostra maniglie: vengono dai punti.
    for (const { handle, point, folded } of curveOn() ? [] : shownHandles(edit, subs, chosen)) {
      const [x, y] = apply(m, point);
      const sub = subs[handle.sub]!;
      // Il punto di una quadratica è dei suoi due nodi: una linea per
      // ciascuno.
      const owners = handle.which === "control" ? [handle.link, (handle.link + 1) % sub.nodes.length] : [handleNode(sub, handle)];
      for (const owner of owners) out.push({ kind: "control", x, y, node: apply(m, sub.nodes[owner]!), ...(folded ? { folded } : {}) });
    }
    subs.forEach((sub, s) => {
      sub.nodes.forEach((node, at) => {
        const [x, y] = apply(m, node);
        out.push({ kind: "node", x, y, shape: NODE_SHAPES[kinds(s, at)], selected: chosen.has(nodeKey(s, at)) });
      });
    });
    return out;
  };

  /// Il contorno e i nodi della forma sotto il puntatore, più tenui, se non
  /// è una di quelle che si modificano e se nessun gesto è in corso.
  const hoverHandles = (): OverlayHandle[] => {
    const hovered = nodesHover;
    if (hovered === null || hovered.subs === null || current !== null || tool !== "nodes" || hovered.index !== currentIndex()) return [];
    if (edits.some((edit) => edit.leaf === hovered.leaf)) return [];
    const m = hovered.matrix;
    const out: OverlayHandle[] = [{ kind: "outline", segments: writeNodes(hovered.subs), matrix: m, hint: true }];
    for (const sub of hovered.subs) {
      sub.nodes.forEach((node, at) => {
        const [x, y] = apply(m, node);
        out.push({ kind: "node", x, y, shape: NODE_SHAPES[innerNode(sub, at) ? kindOf(sub, at) : "corner"], selected: false, hint: true });
      });
    }
    return out;
  };

  /// Il puntatore passa sopra `p` senza premere: la forma che tocca mostra i
  /// suoi nodi, se ne ha, con lo strumento Nodi. Il dito non passa: tocca.
  const hoverNodes = (p: Point | null, pointer: InkPointerType): void => {
    let next: typeof nodesHover = null;
    if (p !== null && pointer !== "touch" && tool === "nodes" && has("nodes") && editable()) {
      const index = currentIndex();
      const tolerance = HIT_PX[pointer] / camera.scale;
      const unit = index.at(p, tolerance);
      const leaf = unit?.shapeAt(p, tolerance) ?? null;
      if (unit !== null && leaf !== null) {
        if (nodesHover !== null && nodesHover.leaf === leaf && nodesHover.index === index) return;
        const matrix = unit.shapes().find((shape) => shape.leaf === leaf)?.matrix ?? null;
        const nodable = matrix === null ? null : nodableAt(leaf);
        if (matrix !== null) next = { index, leaf, subs: nodable === null || typeof nodable === "string" ? null : nodable.subs, matrix };
      }
    }
    if (next === null && nodesHover === null) return;
    nodesHover = next;
    showHandles();
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
    const corner = cornerNow();
    if (corner !== null) {
      out.push({ kind: "corner", x: corner.spot[0], y: corner.spot[1] });
      // Mentre la si tira, il raggio sotto di lei.
      const drag = current?.kind === "select" && current.mode === "corner" ? current.corner : null;
      if (drag !== null) out.push({ kind: "label", x: corner.spot[0], y: corner.spot[1], text: lengthText(drag.radius * scaleOf(drag.unit.matrix)) });
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

  /// La maniglia degli angoli che si vede: con lo strumento Selezione e un
  /// poligono, una stella o un rettangolo scelto da solo, abbastanza grande
  /// sullo schermo perché la maniglia abbia dove scorrere; durante il suo
  /// gesto, dove la si tira. Mentre la cornice si tira, nessuna.
  const cornerNow = (): { readonly unit: Unit; readonly grip: CornerGrip; readonly spot: Point } | null => {
    const g = current?.kind === "select" ? current : null;
    const inset = (unit: Unit): number => CORNER_INSET_PX / (scaleOf(unit.matrix) * camera.scale);
    if (g !== null && g.corner !== null) {
      const { unit, grip, radius } = g.corner;
      return { unit, grip, spot: cornerSpot(grip, unit.matrix, radius, inset(unit)) };
    }
    if ((g !== null && g.mode !== "pending") || tool !== "select" || !editable() || !has("polygon") || selection.length !== 1) return null;
    const unit = selectedUnits()[0];
    const grip = unit === undefined ? null : cornerGrip(unit.node, unit.role, unit.matrix);
    if (unit === undefined || grip === null) return null;
    const k = scaleOf(unit.matrix) * camera.scale;
    if (!(k > 0) || grip.max * grip.reach * k < CORNER_ROOM_PX) return null;
    return { unit, grip, spot: cornerSpot(grip, unit.matrix, grip.radius, inset(unit)) };
  };

  /// La maniglia degli angoli sotto `p`, col puntatore `pointer`: se c'è, e
  /// se è più vicina della maniglia `grip` della cornice `view`, che `p`
  /// prende anche lei.
  const cornerAt = (p: Point, pointer: InkPointerType, view: FrameView | null, grip: Grip | null): ReturnType<typeof cornerNow> => {
    const corner = cornerNow();
    if (corner === null) return null;
    const away = Math.hypot(p[0] - corner.spot[0], p[1] - corner.spot[1]) * camera.scale;
    if (away > NODE_PX[pointer]) return null;
    const spot = grip === null ? undefined : view?.spots.find((each) => each.grip === grip);
    if (spot !== undefined && Math.hypot(p[0] - spot.at[0], p[1] - spot.at[1]) * camera.scale < away) return null;
    return corner;
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
    const edited = new Set(editedUnits());
    // Col Costruttore le forme si vedono nelle loro regioni; mentre si
    // scelgono gli oggetti, e per una forma che taglia soltanto, la cornice.
    const builder = current?.kind === "builder" && current.mode === "objects" ? null : builderNow();
    const built = new Set(builder === null ? [] : builder.shapes.filter((_, k) => !builder.cuts[k]).map((unit) => unit.key));
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
      // Un oggetto di cui si modificano i nodi mostra i nodi, non la
      // cornice.
      if (edited.has(unit.key) || built.has(unit.key)) continue;
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
    handles.push(...hoverHandles());
    handles.push(...regionHandles());
    handles.push(...cutHandles());
    handles.push(...pathsHandles());
    for (const edit of edits) handles.push(...nodeHandles(edit));
    if (drafting !== null || current?.kind === "bezier") handles.push(...bezierHandles());
    const lasso = current?.kind === "select" && current.mode === "marquee"
      ? current
      : (current?.kind === "nodes" && current.dragging && current.grab?.kind === "marquee") || (current?.kind === "builder" && current.mode === "objects" && current.dragging)
        ? current
        : null;
    if (lasso !== null && lasso.from !== null && lasso.end !== null) {
      const [x1, y1] = lasso.from;
      const [x2, y2] = lasso.end;
      const slanted = slantedMarquee(lasso.from, lasso.end);
      handles.push({ kind: "lasso", points: slanted === null ? [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] : [...slanted.corners] });
    }
    if (current?.kind === "lasso" && current.dragging) handles.push({ kind: "lasso", points: [...current.points] });
    if (current?.kind === "builder" && current.mode === "regions" && current.dragging) handles.push({ kind: "trail", points: [...current.trail] });
    // Sopra una regione, il cursore dice che il tocco e il trascinamento
    // uniscono; con Alt, che tolgono, lo dice il tratteggio.
    surface.toggleAttribute("data-region", tool === "builder" && !alt && (current?.kind === "builder" ? current.mode === "regions" : regionHover >= 0));
    // Le guide e le misure stanno sopra a tutto.
    const guides = guideHandles();
    const measures = measureHandles();
    guiding = guides.length > 0;
    measured = measures.length > 0;
    handles.push(...guides, ...measures, ...guideLabel());
    overlay.setHandles(handles);
    selectionBand = band;
    showRulers();
    placeBar();
    showLinks(delta);
    const keys = selection.join("\n");
    if (keys !== noticed) {
      noticed = keys;
      followSelection();
      syncTree();
      syncInspector();
      syncProperties();
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
    for (const { unit, element } of marks) {
      const inside = chosen.some((path) => path.every((at, i) => unit.path[i] === at));
      let bounds = unit.bounds!;
      if (inside && delta !== null) bounds = translated(bounds, delta[0], delta[1])!;
      else if (inside && shaping !== null) bounds = unit.boundsAfter(shaping) ?? bounds;
      const clear = framed && inside ? MARK_CLEAR_PX : 0;
      // In alto a destra dell'oggetto come si vede, anche sul foglio girato.
      const box = screenBox(camera, bounds);
      element.style.transform = `translate(${box.max[0] + clear}px, ${box.min[1] - clear}px)`;
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

  /// Il nome del colore di ciò che `paints` dipinge, se è uno della
  /// tavolozza: il contorno, o il riempimento se non ne ha.
  const colorOf = (paints: readonly PaintNode[]): string | null => {
    const attrs = new Map(paints[0]?.attrs ?? []);
    const stroke = attrs.get("stroke");
    const value = stroke !== undefined && stroke !== "none" ? stroke : attrs.get("fill");
    const swatch = value === undefined ? null : swatchOf(value);
    return swatch === null ? null : t(swatch.label);
  };

  /// Il nome di un oggetto col suo colore. Uno che non si sceglie, bloccato
  /// o in un livello bloccato, prende il colore da ciò che si dipinge.
  const describeNode = (node: OutlineNode, unit: Unit | undefined, state = true): string => {
    const model = engine.model;
    const paints = unit?.paints ?? (model === null ? [] : builder.paintsOf(nodeOf(model, node.item)));
    return describe(node, { parts: true, color: colorOf(paints), state });
  };

  /// Il nome a parole di un oggetto che si sceglie.
  const labelOf = (unit: Unit): string => {
    const node = outlineNow().byKey.get(unit.key);
    return node === undefined ? unit.tag : describeNode(node, unit);
  };

  /// Le voci dell'albero; il livello di chiave `current` dice che è quello
  /// corrente. Con la selezione avanzata i gruppi e i collegamenti mostrano
  /// i loro figli. I segni bloccano e nascondono, nel disegno che si scrive:
  /// un livello coi livelli, un oggetto con la selezione avanzata, se niente
  /// che lo contiene è bloccato (`under` dice che cosa). Coi livelli ogni
  /// voce si rinomina e si sposta, e ha la sua miniatura: un oggetto
  /// bloccato, o dentro qualcosa di bloccato, lascia in `refusals` il perché
  /// no.
  const entriesOf = (
    nodes: readonly OutlineNode[],
    index: SceneIndex,
    current: string | null,
    under: Refusal | null,
    refusals: Map<string, Refusal>,
  ): TreeEntry[] =>
    nodes.map((node) => {
      const unit = index.get(node.key) ?? undefined;
      const layer = node.item.role === "layer";
      const holds = node.item.role === "group" || node.item.role === "link";
      const locked = node.item.locked === true;
      const mark = layer && node.key === current ? `, ${t("draw.state.current")}` : "";
      const refusal = layer ? null : locked ? "locked" : under;
      if (refusal !== null) refusals.set(node.key, refusal);
      const inner = under ?? (!locked ? null : layer ? "layer_locked" : "container_locked");
      const title = layer ? node.name : cleanName(node.item.title ?? "");
      return {
        key: node.key,
        layer,
        selectable: unit !== undefined,
        locked,
        hidden: node.item.hidden === true,
        toggles: editable() && (layer ? has("layers") : has("selection") && under === null),
        name: title === null || title === "" ? null : title,
        renames: editable() && has("layers"),
        moves: editable() && has("layers"),
        ...(has("layers") ? { thumbnail: () => thumbnailOf(node.item) } : {}),
        kind: treeKind(node.item.role),
        children: layer || (holds && has("selection")) ? entriesOf(node.children, index, current, inner, refusals) : [],
        label: () => `${describeNode(node, unit)}${mark}`,
      };
    });

  /// Il riquadro delle miniature dei livelli, lo stesso per tutti perché si
  /// veda dove sta ciascuno: la pagina, o senza pagina tutto il disegno.
  let sheet: { readonly scene: PaintScene; readonly box: MiniatureBox | null } | null = null;
  const sheetOf = (model: DocumentModel): MiniatureBox | null => {
    if (sheet?.scene !== scene) sheet = { scene, box: scene.root.page ?? miniatureBox(indexer.extent(model)) };
    return sheet.box;
  };

  /// La miniatura di una voce dell'albero: ciò che il disegno dipinge per
  /// lei, dentro gli stili di chi la contiene; un oggetto inquadrato sul suo
  /// riquadro, un livello sul foglio. La chiave cambia quando cambia ciò che
  /// si vede: la voce, il testo dei tag di chi la contiene, che resta anche
  /// quando il contenitore si rifà, la radice e il foglio.
  const thumbnailOf = (item: ElementItem): TreeThumbnail | null => {
    const model = engine.model;
    if (model === null) return null;
    const node = nodeOf(model, item);
    const paints = builder.paintsOf(node);
    if (paints.length === 0) return null;
    const heads: HeadInfo[] = [];
    for (let at = node.parent; at !== null && at !== model.root; at = at.parent) heads.unshift(builder.headInfo(at));
    const root = scene.root;
    const layer = item.role === "layer";
    const box = layer ? sheetOf(model) : null;
    if (layer && box === null) return null;
    const frame = box === null ? "" : `|${box.x} ${box.y} ${box.width} ${box.height}`;
    return {
      key: `${builder.serialOf(root)}|${heads.map((head) => head.head + (head.tail ?? "")).join("")}|${paints.map((paint) => builder.serialOf(paint)).join(" ")}${frame}`,
      draw: (owner) => {
        const count = shapeCount(paints, THUMB_PICTURE_SHAPES);
        if (count > THUMB_PICTURE_SHAPES) return null;
        const framed = box ?? miniatureBox(indexer.frameOf(model, node));
        if (framed === null) return null;
        const live = count <= THUMB_LIVE_SHAPES;
        const resolve = live && images !== undefined ? (href: string, life: Lifetime) => images.url(href, life) : undefined;
        const svg = paintMiniature(paints, [root.attrs, ...heads.map((head) => head.attrs)], framed, owner, resolve);
        return live ? svg : miniaturePicture(svg, owner);
      },
    };
  };

  /// Le voci dell'albero per l'indice e il livello corrente di adesso, e la
  /// selezione mostrata.
  let treeShown: {
    readonly index: SceneIndex;
    readonly layer: string | null;
    readonly mode: string;
    readonly entries: TreeEntry[];
    /// Perché una voce non si rinomina e non si sposta.
    readonly refusals: ReadonlyMap<string, Refusal>;
    readonly count: number;
    keys: string;
  } | null = null;

  /// Porta l'albero, se è aperto, alla scena e alla selezione di adesso.
  function syncTree(): void {
    if (tree.element.hidden) return;
    const index = currentIndex();
    const keys = selection.join("\n");
    const layer = has("layers") ? currentLayer() : null;
    const current = layer === null ? null : keyOf(layer);
    // Le voci dipendono anche da ciò che il livello offre e dal disegno che
    // si scrive.
    const mode = `${editable()} ${has("layers")} ${has("selection")}`;
    if (treeShown?.index !== index || treeShown.layer !== current || treeShown.mode !== mode) {
      const nodes = outlineNow().nodes;
      const refusals = new Map<string, Refusal>();
      const entries = entriesOf(nodes, index, current, null, refusals);
      treeShown = { index, layer: current, mode, entries, refusals, count: countObjects(nodes), keys: "" };
    } else if (treeShown.keys === keys) {
      return;
    }
    treeShown.keys = keys;
    // Il filtro e i nomi vengono coi livelli.
    tree.setFiltering(has("layers"));
    tree.update(treeShown.entries, selection, treeShown.count);
  }

  /// Vero se la voce `key` si rinomina adesso; se no, lo dice e dice perché.
  /// Un oggetto che il disegno non sa riscrivere lo dice prima che si scriva
  /// il nome.
  function canRename(key: string): boolean {
    const model = engine.model;
    const outlined = outlineNow().byKey.get(key);
    if (model === null || outlined === undefined || !editable() || !has("layers")) return false;
    const refusal = treeShown?.refusals.get(key);
    if (refusal !== undefined) {
      announce(t(`draw.rename.${refusal}`));
      return false;
    }
    if (outlined.item.role !== "layer" && !nameable(model, outlined.item)) {
      announce(t("draw.rename.foreign"));
      return false;
    }
    return true;
  }

  /// Dà alla voce `key` il nome `name`, già ripulito: un livello il suo nome,
  /// mai vuoto; un oggetto il suo primo `title`, che un nome vuoto toglie. La
  /// chiave di dopo, che cambia se l'oggetto riceve un id.
  function renameRow(key: string, name: string): string | null {
    const model = engine.model;
    const outlined = outlineNow().byKey.get(key);
    if (model === null || outlined === undefined || !editable() || !has("layers")) return null;
    cancelGesture();
    if (outlined.item.role === "layer") {
      const layer = currentIndex().layers.find((each) => keyOf(each) === key);
      if (layer === undefined) return null;
      const next = layerName(name);
      if (next === "") {
        announce(t("draw.layer.name.required"));
        return null;
      }
      const arranged = renameLayerOps(model, layer, next, newIds());
      const now = arranged.keys[0] ?? key;
      // Il livello corrente resta lui anche se riceve un id.
      const before = currentLayer();
      const isCurrent = before !== null && keyOf(before) === key;
      if (!writeLayers("draw.action.layer_rename", arranged, isCurrent ? now : null)) return null;
      announce(t("draw.layer.renamed", { name: layerTitle({ ...layer, name: next }) }));
      return now;
    }
    const change = nameOps(model, outlined.item, name, newIds());
    if (change === "foreign") {
      announce(t("draw.rename.foreign"));
      return null;
    }
    if (change.ops.length === 0) return key;
    const now = change.keys[0] ?? key;
    const before = selection;
    if (commit("draw.action.name", asGesture(change.ops)) === null) return null;
    // Scelto prima, scelto dopo, anche con l'id nuovo.
    if (now !== key && before.includes(key)) select(before.map((each) => (each === key ? now : each)));
    const after = outlineNow().byKey.get(now);
    announce(name !== "" ? t("draw.named", { name }) : t("draw.unnamed", { name: after === undefined ? "" : describeNode(after, currentIndex().get(now) ?? undefined, false) }));
    return now;
  }

  /// Dove `drop` porta le voci `keys` dell'albero: i loro nodi, il
  /// contenitore che le riceve, il posto fra i suoi figli e se sono livelli;
  /// o perché no, a parole. `null` se non c'è niente da dire: il disegno non
  /// si scrive, o le voci non ci sono più.
  const placing = (keys: readonly string[], drop: TreeDrop): Placing | DrawKey | null => {
    const model = engine.model;
    if (model === null || !editable() || !has("layers") || keys.length === 0) return null;
    const outlined = outlineNow();
    const host = outlined.byKey.get(drop.key);
    if (host === undefined) return null;
    const items: OutlineNode[] = [];
    for (const key of keys) {
      const item = outlined.byKey.get(key);
      if (item === undefined) return null;
      const refusal = treeShown?.refusals.get(key);
      if (refusal !== undefined) return `draw.move.${refusal}`;
      items.push(item);
    }
    // Un livello va solo fra i livelli, e da solo; un oggetto non va fra i
    // livelli, ma dentro.
    const layers = items[0]!.item.role === "layer";
    const inside = drop.place === "top" || drop.place === "bottom";
    if (items.some((item) => (item.item.role === "layer") !== layers) || (host.item.role === "layer" ? inside === layers : layers)) return "draw.move.layers";
    const target = nodeOf(model, host.item);
    const parent = inside ? target : target.parent;
    if (parent === null || parent.kind !== "container") return null;
    const moving = items.map((item) => nodeOf(model, item.item));
    // Né dentro sé stesso, né dentro qualcosa di bloccato, né un
    // collegamento dentro un altro.
    let linked = false;
    for (let at: ContainerNode | null = parent; at !== null && at !== model.root; at = at.parent) {
      if (moving.includes(at)) return "draw.move.inside";
      if (at.details?.locked === true) return at.details.role === "layer" ? "draw.move.into_layer_locked" : "draw.move.into_locked";
      if (at.details?.role === "link") linked = true;
    }
    if (linked && moving.some((node) => holdsLink(node))) return "draw.move.link";
    let at: Place;
    if (drop.place === "top") at = "last";
    else if (drop.place === "bottom") at = "first";
    else if (drop.place === "before") at = { after: target };
    else {
      // Dietro a lui: dopo ciò che gli sta subito dietro.
      const siblings = elementChildren(parent);
      const behind = siblings[siblings.indexOf(target) - 1];
      at = behind === undefined ? "first" : { after: behind };
    }
    return { moving, parent, at, layers };
  };

  /// Porta le voci `keys` dell'albero in `drop`, in un passo della
  /// cronologia, e lo dice; la selezione le segue. Le chiavi di dopo, nello
  /// stesso ordine; `null` se non si sono spostate, e si dice perché.
  function moveRows(keys: readonly string[], drop: TreeDrop): readonly string[] | null {
    const model = engine.model;
    const plan = placing(keys, drop);
    if (model === null || plan === null) return null;
    if (typeof plan === "string") {
      announce(t(plan));
      return null;
    }
    cancelGesture();
    const arranged = placeOps(model, plan.moving, plan.parent, plan.at, newIds());
    if (arranged === null) {
      announce(t("draw.move.flat"));
      return null;
    }
    // Lasciato dov'era: niente da scrivere, e niente da dire.
    if (arranged.ops.length === 0) return arranged.keys;
    // Un livello si sposta con tutto ciò che ha; un oggetto prende l'opacità
    // e la visibilità del contenitore in cui entra.
    const looked = keptLook(arranged, { key: "draw.move.styled", containers: plan.layers ? "keep" : "take" });
    if (looked === null) return null;
    if (plan.layers) {
      // Il livello corrente resta lui, anche se riceve un id.
      const current = currentLayer();
      const at = current === null ? -1 : keys.indexOf(keyOf(current));
      if (!writeLayers("draw.action.layer_order", looked, at < 0 ? null : looked.keys[at] ?? null)) return null;
    } else {
      if (commit("draw.action.place", asGesture(looked.ops)) === null) return null;
      select(looked.keys);
    }
    announceMove(looked.keys, looked.kept);
    return looked.keys;
  }

  /// Dice dove sono arrivate le voci `keys`: un livello a che posto dalla
  /// cima, un oggetto dentro che cosa e a che posto dal davanti; poi
  /// `note`, se c'è, con lo spazio davanti.
  const announceMove = (keys: readonly string[], note = ""): void => {
    const outlined = outlineNow();
    const first = outlined.byKey.get(keys[0] ?? "");
    if (first === undefined) return;
    const find = (list: readonly OutlineNode[], parent: OutlineNode | null): { readonly parent: OutlineNode | null; readonly list: readonly OutlineNode[] } | null => {
      for (const node of list) {
        if (node === first) return { parent, list };
        const inner = find(node.children, node);
        if (inner !== null) return inner;
      }
      return null;
    };
    const spot = find(outlined.nodes, null);
    if (spot === null) return;
    if (first.item.role === "layer") {
      const layers = spot.list.filter((node) => node.item.role === "layer");
      const layer = currentIndex().layers.find((each) => keyOf(each) === first.key);
      const name = layer === undefined ? first.name ?? "" : layerTitle(layer);
      announce(`${t("draw.layer.placed", { name, position: layers.length - layers.indexOf(first), total: layers.length })}${note}`);
      return;
    }
    const index = currentIndex();
    const parent = spot.parent;
    const layer = parent?.item.role === "layer" ? index.layers.find((each) => keyOf(each) === parent.key) : undefined;
    const where = parent === null
      ? t("draw.where.root")
      : layer !== undefined
        ? t("draw.where.layer", { name: layerTitle(layer) })
        : t("draw.where.group", { name: describeNode(parent, index.get(parent.key) ?? undefined, false) });
    // I posti si contano dal davanti, come le righe; più oggetti stanno
    // vicini, dal più avanti.
    const total = spot.list.length;
    const front = outlined.byKey.get(keys[keys.length - 1] ?? "") ?? first;
    const from = total - spot.list.indexOf(front);
    const placed = keys.length === 1
      ? t("draw.placed", { name: describeNode(first, index.get(first.key) ?? undefined, false), where, position: from, total })
      : plural(keys.length, "draw.placed.one", "draw.placed.other", { where, from, to: from + keys.length - 1, total });
    announce(`${placed}${note}`);
  };

  /// «Rinomina», e F2 sul foglio su un oggetto che non è un testo: il campo
  /// del nome nell'albero, che si apre.
  function renameSelection(): void {
    if (!has("layers") || !editable()) return;
    const units = selectedUnits();
    if (units.length !== 1) {
      announce(t("draw.rename.none"));
      return;
    }
    if (tree.element.hidden) showObjects(true);
    tree.rename(units[0]!.key);
  }

  /// Apre o chiude la cronologia; aperta, il fuoco ci va.
  function showHistory(open: boolean): void {
    if (open && !has("history")) return;
    if (!open && historyPanel.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    historyPanel.element.hidden = !open;
    historyButton.setAttribute("aria-expanded", String(open));
    syncDock();
    if (open) {
      historyShown = null;
      syncHistory();
      historyPanel.focus();
    }
  }

  /// Porta la cronologia, se è aperta, alla pila di adesso.
  function syncHistory(): void {
    if (historyPanel.element.hidden) return;
    const canEdit = editable();
    if (historyShown !== null && historyShown.revision === history.revision && historyShown.editable === canEdit) return;
    historyShown = { revision: history.revision, editable: canEdit };
    historyPanel.update({
      steps: history.steps(),
      done: history.done,
      start: history.start,
      trimmed: history.trimmed,
      limit: HISTORY_LIMIT,
      marks: history.marks,
      editable: canEdit,
    });
  }

  /// Apre o chiude la verifica dell'accessibilità; aperta, il fuoco ci va.
  /// Chiusa, dimentica ciò che ha letto.
  function showAccess(open: boolean): void {
    if (open && !has("accessibility")) return;
    if (!open && accessPanel.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    accessPanel.element.hidden = !open;
    accessButton.setAttribute("aria-expanded", String(open));
    syncDock();
    accessShown = null;
    if (open) {
      syncAccess(true);
      accessPanel.focus();
    } else {
      clearTimeout(auditTimer);
      audited = null;
      accessNames.clear();
    }
  }

  /// I problemi del testo `text`; nessuno se non si legge.
  const auditOf = (text: string): readonly Problem[] => {
    try {
      const audit = auditScene(text);
      return problemsOf(audit.scene, audit.measures);
    } catch {
      return [];
    }
  };

  /// Il nome a parole di ogni oggetto della verifica, come nell'albero, per
  /// chiave: si rifà a ogni disegno nuovo.
  const accessNames = new Map<string, string>();
  const accessName = (key: string): string => {
    let name = accessNames.get(key);
    if (name === undefined) {
      const node = outlineNow().byKey.get(key);
      name = node === undefined ? key : describeNode(node, currentIndex().get(key) ?? undefined);
      accessNames.set(key, name);
    }
    return name;
  };

  /// Porta la verifica, se è aperta, al disegno di adesso. L'ordine di
  /// lettura segue subito; i problemi di un disegno cambiato si rileggono un
  /// momento dopo l'ultimo cambio, o subito con `now`.
  function syncAccess(now = false): void {
    if (accessPanel.element.hidden) return;
    const text = engine.text;
    if (audited === null || audited.text !== text) {
      clearTimeout(auditTimer);
      if (now || audited === null) audited = { text, problems: auditOf(text) };
      else auditTimer = setTimeout(() => syncAccess(true), AUDIT_MS);
    }
    const { items, nodes } = outlineNow();
    const selected = selection.length === 1 ? selection[0]! : null;
    const canEdit = editable();
    if (accessShown !== null && accessShown.problems === audited.problems && accessShown.items === items && accessShown.selected === selected && accessShown.editable === canEdit) return;
    if (accessShown?.items !== items) accessNames.clear();
    accessShown = { problems: audited.problems, items, selected, editable: canEdit };
    // Un oggetto che non si sceglie, bloccato o fuori dal gruppo isolato, non
    // si corregge da qui: ci si va, e si dice perché.
    const index = currentIndex();
    const problems = audited.problems.map((problem) =>
      problem.key === null || problem.fix === null || index.get(problem.key) !== null ? problem : { ...problem, fix: null },
    );
    accessPanel.update({ problems, reading: readingOrder(nodes), nameOf: accessName, selected, editable: canEdit });
  }

  /// Il problema `code` dell'oggetto `key` nel disegno di adesso, letto di
  /// nuovo se è cambiato; `null` se non c'è più.
  const problemNow = (code: AuditCode, key: string | null): Problem | null => {
    syncAccess(true);
    return audited?.problems.find((problem) => problem.code === code && problem.key === key) ?? null;
  };

  /// Sceglie l'oggetto `key` e lo mostra; uno che non si sceglie lo dice.
  function goToObject(key: string): void {
    cancelGesture();
    const unit = currentIndex().get(key);
    if (unit === null) {
      announce(t("draw.access.unreachable", { name: accessName(key) }));
      return;
    }
    select([key]);
    frameBounds(unit.bounds);
    announceSelection();
  }

  /// La selezione di prima, con l'oggetto `key` che ora si chiama `now`.
  const renamedIn = (key: string, now: string): void => {
    if (now !== key && selection.includes(key)) select(selection.map((each) => (each === key ? now : each)));
  };

  /// Corregge `stale`, com'è nel disegno di adesso, in un passo.
  function fixProblem(stale: Problem): void {
    const problem = problemNow(stale.code, stale.key);
    const fix = problem?.fix ?? null;
    if (problem === null || fix === null) return;
    if (fix.kind === "title") {
      titleInput.focus();
      titleInput.select();
      return;
    }
    const model = engine.model;
    const unit = problem.key === null ? null : currentIndex().get(problem.key);
    if (fix.kind === "describe" || model === null || unit === null || !editable()) return;
    cancelGesture();
    const change: LookChange = fix.kind === "size" ? { size: fix.size } : fix.paint === "fill" ? { fill: fix.color } : { stroke: fix.color };
    const restyled = lookOps(model, [unit], change, newIds());
    if (restyled.ops.length === 0) return;
    const name = accessName(unit.key);
    if (commit(fix.kind === "size" ? "draw.action.font_size" : fix.paint === "fill" ? "draw.action.fill" : "draw.action.outline_color", asGesture(restyled.ops)) === null) return;
    renamedIn(unit.key, restyled.keys[0] ?? unit.key);
    syncAccess(true);
    announce(
      fix.kind === "size"
        ? t("draw.access.fixed.size", { name, size: hundredthsText(fix.size) })
        : t("draw.access.fixed.color", { name, color: fix.color, ratio: hundredthsText(Math.floor(fix.ratio * 100) / 100) }),
    );
  }

  /// Dà all'immagine `key` la descrizione `text`, il suo titolo, in un
  /// passo. Vero se l'ha scritta.
  function writeDescription(key: string, text: string): boolean {
    const model = engine.model;
    const node = outlineNow().byKey.get(key);
    if (model === null || node === undefined || currentIndex().get(key) === null || !editable()) return false;
    cancelGesture();
    const change = nameOps(model, node.item, text, newIds());
    if (change === "foreign") {
      announce(t("draw.rename.foreign"));
      return false;
    }
    if (change.ops.length === 0 || commit("draw.action.describe", asGesture(change.ops)) === null) return false;
    renamedIn(key, change.keys[0] ?? key);
    announce(t("draw.access.described", { text }));
    return true;
  }

  /// Dichiara decorativa l'immagine `key`, in un passo: lo screen reader la
  /// salta. Vero se l'ha dichiarata.
  function writeDecorative(key: string): boolean {
    const model = engine.model;
    const node = outlineNow().byKey.get(key);
    if (model === null || node === undefined || currentIndex().get(key) === null || !editable()) return false;
    cancelGesture();
    const name = accessName(key);
    const change = decorativeOps(model, node.item, newIds());
    if (change.ops.length === 0 || commit("draw.action.decorative", asGesture(change.ops)) === null) return false;
    renamedIn(key, change.keys[0] ?? key);
    announce(t("draw.access.decorated", { name }));
    return true;
  }

  /// Dalla verifica: descrive l'immagine `key`, se le serve ancora.
  function describeImage(key: string, text: string): void {
    if (problemNow("S012", key) !== null && writeDescription(key, text)) syncAccess(true);
  }

  /// Dalla verifica: dichiara decorativa l'immagine `key`, se le serve
  /// ancora una descrizione.
  function decorateImage(key: string): void {
    if (problemNow("S012", key) !== null && writeDecorative(key)) syncAccess(true);
  }

  // --- La descrizione delle immagini appena entrate -------------------------------

  /// Le immagini appena entrate a cui la barra chiede una descrizione, e
  /// quella di adesso.
  let asked: { readonly keys: readonly string[]; at: number } | null = null;

  /// Vero se l'immagine `key` c'è, si sceglie e non ha né una descrizione né
  /// la dichiarazione di essere decorativa.
  const undescribed = (key: string): boolean => {
    const model = engine.model;
    const node = outlineNow().byKey.get(key);
    if (model === null || node === undefined || node.item.role !== "image" || currentIndex().get(key) === null) return false;
    return (node.item.title ?? "").trim() === "" && !decorative(model, node.item);
  };

  /// Chiede la descrizione delle immagini `keys`, appena entrate, se
  /// l'interfaccia ha la verifica dell'accessibilità; il fuoco va al campo.
  function askDescriptions(keys: readonly string[]): void {
    if (!has("accessibility") || !editable() || keys.length === 0) return;
    asked = { keys, at: -1 };
    nextDescription(true);
  }

  /// Passa alla prossima immagine che ha ancora bisogno di una descrizione,
  /// e la sceglie se sono più d'una; senza, chiude la barra.
  function nextDescription(focus: boolean): void {
    if (asked === null) return;
    let at = asked.at + 1;
    while (at < asked.keys.length && !undescribed(asked.keys[at]!)) at++;
    if (at >= asked.keys.length) {
      closeDescriptions();
      return;
    }
    asked.at = at;
    describeInput.value = "";
    showDescription();
    if (asked.keys.length > 1) select([asked.keys[at]!]);
    if (focus) describeInput.focus({ preventScroll: true });
  }

  /// Chiude la barra. Se si descrivevano più immagini e la scelta è ancora
  /// quella della barra, tornano scelte tutte quelle che restano.
  function closeDescriptions(): void {
    const was = asked;
    if (was === null) return;
    asked = null;
    const focused = describeBar.contains(document.activeElement);
    describeBar.hidden = true;
    const current = was.keys[was.at];
    if (was.keys.length > 1 && current !== undefined && selection.length === 1 && selection[0] === current) {
      select(was.keys.filter((key) => currentIndex().get(key) !== null));
    }
    if (focused) surface.focus({ preventScroll: true });
  }

  /// La barra, com'è adesso: il suo nome dice quale immagine, se sono più
  /// d'una.
  function showDescription(): void {
    if (asked === null) return;
    describeBar.hidden = false;
    describeLabel.textContent =
      asked.keys.length === 1 ? t("draw.describe") : t("draw.describe.of", { n: asked.at + 1, count: asked.keys.length });
  }

  /// Dopo ogni cambio: la barra va avanti se l'immagine di adesso non le
  /// chiede più niente (descritta altrove, tolta, annullata), e si chiude
  /// se l'interfaccia o il documento non la vogliono più.
  function syncDescriptions(): void {
    if (asked === null) return;
    if (!has("accessibility") || !editable()) {
      closeDescriptions();
      return;
    }
    const current = asked.keys[asked.at];
    if (current === undefined || !undescribed(current)) nextDescription(describeBar.contains(document.activeElement));
  }

  /// «Scrivi» e Invio: la descrizione del campo, e poi la prossima.
  function writeAsked(): void {
    const key = asked?.keys[asked.at];
    if (key === undefined) return;
    const text = cleanName(describeInput.value);
    if (text === "") {
      announce(t("draw.describe.empty"));
      describeInput.focus({ preventScroll: true });
      return;
    }
    if (!writeDescription(key, text)) {
      describeInput.focus({ preventScroll: true });
      return;
    }
    // Di solito il cambio stesso ha già portato la barra avanti.
    if (asked?.keys[asked.at] === key) nextDescription(true);
  }

  life.listen(describeWrite, "click", () => writeAsked());
  life.listen(describeDecorative, "click", () => {
    const key = asked?.keys[asked.at];
    if (key === undefined) return;
    if (!writeDecorative(key)) describeInput.focus({ preventScroll: true });
    else if (asked?.keys[asked.at] === key) nextDescription(true);
  });
  life.listen(describeSkip, "click", () => nextDescription(true));
  life.listen(describeInput, "keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    writeAsked();
  });
  // Esc chiude la barra: le immagini che restano senza descrizione le
  // elenca la verifica.
  life.listen(describeBar, "keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeDescriptions();
    surface.focus({ preventScroll: true });
  });

  /// Sposta l'oggetto `key` di un posto nell'ordine di lettura, dopo il
  /// vicino seguente se `later`: è anche l'ordine in cui si dipinge, e
  /// l'oggetto passa sopra o sotto il vicino. Se i due si sovrappongono e lo
  /// spostamento non è `confirmed`, non si fa: torna l'avviso.
  function moveInReading(key: string, later: boolean, confirmed: boolean): string | null {
    const model = engine.model;
    if (model === null || !editable()) return null;
    const index = currentIndex();
    const unit = index.get(key);
    if (unit === null) {
      announce(t("draw.access.unreachable", { name: accessName(key) }));
      return null;
    }
    const siblings = index.siblings(unit);
    const neighbor = siblings[siblings.findIndex((each) => each.key === key) + (later ? 1 : -1)];
    if (neighbor === undefined) {
      announce(t(later ? "draw.access.move.last" : "draw.access.move.first"));
      return null;
    }
    const names = { name: accessName(key), other: accessName(neighbor.key) };
    if (!confirmed && overlaps(unit.bounds, neighbor.bounds)) return t(later ? "draw.access.move.above" : "draw.access.move.below", names);
    cancelGesture();
    const kept = arrange("draw.action.reading", orderOps(model, index, [unit], later ? "forward" : "backward", newIds()), null, { key: "draw.order.styled" });
    if (kept === null) return null;
    announce(`${t(later ? "draw.access.moved.later" : "draw.access.moved.earlier", names)}${kept}`);
    return null;
  }

  /// Apre o chiude l'albero; aperto, il fuoco ci va.
  function showObjects(open: boolean): void {
    if (!open && tree.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    tree.element.hidden = !open;
    objectsButton.setAttribute("aria-expanded", String(open));
    syncDock();
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
    if (inspector.element.hidden || changing || (nestedNow() && panel.element.hidden)) return;
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
    // Nel pannello delle proprietà gli attributi sono una sua sezione.
    if (nestedNow()) {
      if (open) focusAttributes();
      return;
    }
    if (!open && inspector.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    inspector.element.hidden = !open;
    attributesButton.setAttribute("aria-expanded", String(open));
    syncDock();
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

  // --- Il pannello delle proprietà ---------------------------------------------

  /// Vero se gli attributi stanno nel pannello delle proprietà, come una sua
  /// sezione: quando il livello offre l'uno e l'altro.
  const nestedNow = (): boolean => inspector.element.parentElement === panel.attributes;

  /// Il dock c'è se c'è un pannello aperto; è largo quando ci sono gli
  /// attributi, che vogliono più spazio.
  function syncDock(): void {
    const nested = nestedNow();
    dock.hidden = tree.element.hidden && panel.element.hidden && (nested || inspector.element.hidden) && historyPanel.element.hidden && accessPanel.element.hidden;
    dock.toggleAttribute("data-wide", nested ? !panel.element.hidden : !inspector.element.hidden);
  }

  /// Mette gli attributi nel pannello delle proprietà, come una sua sezione,
  /// o li riporta nel dock, chiusi.
  function nestInspector(nested: boolean): void {
    if (nested === nestedNow()) return;
    if (inspector.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    if (nested) panel.attributes.append(inspector.element);
    else dock.insertBefore(inspector.element, historyPanel.element);
    inspector.nest(nested);
    inspector.element.hidden = !nested;
    attributesButton.setAttribute("aria-expanded", "false");
    inspectorShown = null;
    panelShown = null;
    syncDock();
  }

  /// Apre o chiude il pannello delle proprietà. Aperto, il fuoco ci va se
  /// `focus`; chiuso, un valore scritto a metà parte prima, come lasciando il
  /// campo. Se `remember`, è una scelta di chi disegna, e si ricorda.
  function showPanel(open: boolean, focus = open, remember = true): void {
    if (open && !has("properties")) return;
    if (!open && panel.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    panel.element.hidden = !open;
    propertiesButton.setAttribute("aria-expanded", String(open));
    syncDock();
    if (open) {
      panelShown = null;
      syncProperties();
      syncInspector();
      if (focus) panel.focus();
    }
    if (remember && grid.panel !== open) changeGrid({ ...grid, panel: open });
  }

  /// Vero finché il pannello aspetta che l'editor abbia una misura per
  /// sapere se aprirsi.
  let panelPending = false;

  /// Il pannello come lo vuole chi disegna: aperto o chiuso come l'ha
  /// lasciato; se non l'ha mai toccato, aperto quando l'editor è abbastanza
  /// largo da tenerlo accanto al foglio. Finché l'editor non ha una misura,
  /// la scelta aspetta la prima; senza modo di saperla, il pannello si apre.
  function showPanelByDefault(): void {
    panelPending = false;
    if (!has("properties") || !panel.element.hidden) return;
    if (grid.panel !== null) {
      if (grid.panel) showPanel(true, false, false);
      return;
    }
    const width = root.clientWidth;
    if (width === 0 && typeof ResizeObserver !== "undefined") {
      panelPending = true;
      return;
    }
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    if (width === 0 || width >= PANEL_ROOM_REM * rem) showPanel(true, false, false);
  }

  /// Il lucchetto delle proporzioni: chiuso per gli oggetti che la cornice
  /// ridimensiona dagli angoli tenendo le proporzioni, o come l'ha lasciato
  /// chi l'ha toccato, per la stessa selezione.
  const ratioOn = (units: readonly Unit[]): boolean =>
    ratioLock !== null && ratioLock.keys === selection.join("\n") ? ratioLock.on : units.some((unit) => RATIO_ROLES.has(unit.role));

  /// La selezione come la legge il pannello.
  const selectionFacts = (units: readonly Unit[]): SelectionFacts => {
    const model = engine.model!;
    const index = currentIndex();
    const outlines = outlinesOf(model, units);
    return {
      keys: selection.join("\n"),
      subject: units.length === 1 ? labelOf(units[0]!) : plural(units.length, "draw.describe.parts.one", "draw.describe.parts.other"),
      count: units.length,
      frame: frameOf(units),
      ratio: ratioOn(units),
      look: selectionLook(model, units),
      outline: outlines.length === 0 ? null : outlineLook(outlines),
      alignable: alignReference(units) !== null,
      drawn: drawn(units),
      orders: new Set(has("arrange") ? ORDERS.map(({ order }) => order).filter((order) => orderOps(model, index, units, order, newIds()).ops.length > 0) : []),
      shape: shapeFacts(model, units),
    };
  };

  /// Porta il pannello, se è aperto, al disegno e alla selezione di adesso.
  function syncProperties(): void {
    // Mentre gli attributi cambiano un oggetto, la selezione lo ritrova solo
    // dopo: il pannello aspetta lei.
    if (panel.element.hidden || changing) return;
    const index = currentIndex();
    const keys = selection.join("\n");
    const unit = docUnit();
    const canEdit = editable();
    // La forma dello strumento Poligono, quando è lui lo strumento.
    const polygonNow = tool === "polygon" ? polygonTool : null;
    const last = panelShown;
    if (
      last !== null &&
      last.index === index &&
      last.keys === keys &&
      last.unit === unit &&
      last.editable === canEdit &&
      last.grid === grid &&
      last.features === features &&
      last.ratio === ratioLock &&
      last.kept === kept &&
      last.polygon === polygonNow
    ) {
      return;
    }
    panelShown = { index, keys, unit, editable: canEdit, grid, features, ratio: ratioLock, kept, polygon: polygonNow };
    const units = selection.length === 0 || engine.model === null ? [] : selectedUnits();
    panel.update(
      propertiesView({
        features,
        unit,
        editable: canEdit,
        selection: units.length === 0 ? null : selectionFacts(units),
        document: { page: scene.root.page, desc: rootText("desc") },
        grid,
        bar: BAR_FEATURES.some(has),
        attributes: nestedNow() && units.length === 1,
        tool: polygonNow === null ? null : toolFacts(polygonNow),
      }),
    );
  }

  /// Invio e Ctrl+Maiusc+X con gli attributi nel pannello: il fuoco va alla
  /// loro sezione, se c'è un oggetto solo di cui mostrarli.
  function focusAttributes(): void {
    const count = selectedUnits().length;
    if (count !== 1) {
      announce(count === 0 ? t("draw.attributes.none") : t("draw.attributes.many", { count: String(count) }));
      return;
    }
    showPanel(true, false);
    panel.focusSection("attributes");
  }

  /// Ctrl+Maiusc+M e «Trasforma…» col pannello: il fuoco va ai campi di
  /// «Trasforma». Falso se il pannello non li ha.
  const focusTransform = (): boolean => {
    if (!has("properties")) return false;
    showPanel(true, false);
    return panel.focusSection("transform");
  };

  /// Scrive `ops`, un cambio chiesto dal pannello, col nome `label`; la
  /// selezione diventa `keys`, se ci sono, e la pagina cresce se `extent` ne
  /// esce. `null` se il disegno l'ha accettato, o se non c'era niente da
  /// cambiare; altrimenti la ragione per cui no, che il campo mostra.
  const changeFromPanel = (label: DrawKey, ops: readonly Op[], keys: readonly string[] | null, extent: Bounds | null = null): string | null => {
    if (!editable()) return t("draw.rejected", { reason: t("draw.reason.read_only") });
    if (ops.length === 0) return null;
    cancelGesture();
    const all: Op[] = [...ops];
    const page = pageFor(scene.root.page, extent);
    if (page !== null) all.push({ op: "page", viewBox: page });
    const before = selection;
    const lock = ratioLock !== null && ratioLock.keys === before.join("\n") ? ratioLock.on : null;
    // La selezione è già quella di dopo quando l'editor si rinfresca, come
    // per i comandi di «Disponi».
    if (keys !== null) selection = [...keys];
    const outcome = attempt(label, asGesture(all));
    if (outcome === null || typeof outcome === "string") {
      selection = before;
      return t("draw.rejected", { reason: outcome ?? t("draw.reason.read_only") });
    }
    if (keys !== null) select(keys);
    // Il lucchetto resta com'era anche se gli oggetti hanno appena ricevuto
    // un id.
    if (lock !== null) ratioLock = { keys: selection.join("\n"), on: lock };
    return null;
  };

  /// Più oggetti tengono la cornice `frame`, com'è diventata.
  const keepFrame = (frame: Frame): void => {
    kept = { index: currentIndex(), keys: selection.join("\n"), frame };
    showHandles();
  };

  /// La selezione si sposta lungo `axis` finché l'angolo in alto a sinistra
  /// della cornice non sta a `value`, nell'unità del documento.
  const moveFromPanel = (axis: FrameAxis, value: number): string | null => {
    const units = selectedUnits();
    const frame = frameOf(units);
    if (frame === null) return null;
    const delta = roundDelta(fromUnit(value, docUnit()) - apply(frame.matrix, frame.box.min)[axis]);
    if (delta === 0) return null;
    const dx = axis === 0 ? delta : 0;
    const dy = axis === 1 ? delta : 0;
    const moved = moveOps(units, dx, dy, newIds());
    let bounds: Bounds | null = null;
    for (const unit of units) bounds = union(bounds, translated(unit.bounds, dx, dy));
    const outcome = changeFromPanel("draw.action.move", moved.ops, moved.keys, bounds);
    // La cornice che più oggetti tengono si sposta con loro.
    if (outcome === null && units.length > 1 && frame.matrix !== IDENTITY) keepFrame(movedFrame(frame, translate(dx, dy)));
    return outcome;
  };

  /// Applica `m`, una trasformazione della cornice `frame`, dal pannello.
  const transformFromPanel = (units: readonly Unit[], frame: Frame, m: Matrix, label: DrawKey): string | null => {
    const transformed = numericOps(units, m, newIds());
    if (transformed === null) return t("draw.transform.unwritable");
    const outcome = changeFromPanel(label, transformed.ops, transformed.keys, boundsAfter(units, m));
    if (outcome === null && transformed.changed > 0) {
      if (units.length > 1) keepFrame(movedFrame(frame, m));
      else kept = null;
    }
    return outcome;
  };

  /// Il lato `axis` della cornice misura `value`, nell'unità del documento,
  /// fermo l'angolo in alto a sinistra; col lucchetto chiuso l'altro lato lo
  /// segue.
  const resizeFromPanel = (axis: FrameAxis, value: number): string | null => {
    const units = selectedUnits();
    const frame = frameOf(units);
    if (frame === null || !scales(frame, axis)) return null;
    const ratio = fromUnit(value, docUnit()) / frameSize(frame)[axis];
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    const both = ratioOn(units) && scales(frame, axis === 0 ? 1 : 0);
    const { min, max } = frame.box;
    const kx = axis === 0 || both ? ratio : 1;
    const ky = axis === 1 || both ? ratio : 1;
    const m = resizeMatrix(frame, frame.box, { min, max: [min[0] + (max[0] - min[0]) * kx, min[1] + (max[1] - min[1]) * ky] });
    if (m === null) return t("draw.transform.unwritable");
    return transformFromPanel(units, frame, m, "draw.action.resize");
  };

  /// La cornice ruota attorno al suo centro finché il suo lato in alto non
  /// ha l'angolo `value`.
  const rotateFromPanel = (value: number): string | null => {
    const units = selectedUnits();
    const frame = frameOf(units);
    if (frame === null) return null;
    const turn = normalized(value - angleOf(frame.matrix));
    if (Math.abs(turn) < 1e-9) return null;
    return transformFromPanel(units, frame, rotationMatrix(frameCenter(frame), turn), "draw.action.rotate");
  };

  /// L'aspetto o il contorno degli oggetti scelti, da un campo del pannello.
  const styleFromPanel = (id: FieldId, value: number | string | boolean): string | null => {
    const model = engine.model;
    const units = selectedUnits();
    if (model === null || units.length === 0) return null;
    const look = lookChange(id, value, docUnit());
    if (look !== null) {
      const restyled = lookOps(model, units, look, newIds());
      return changeFromPanel(LOOK_ACTIONS[id]!, restyled.ops, restyled.keys);
    }
    const change = outlineChange(id, value);
    if (change === null) return null;
    const outlined = outlineOps(model, units, change, newIds());
    return changeFromPanel("dash" in change ? "draw.action.dash" : "cap" in change ? "draw.action.cap" : "draw.action.join", outlined.ops, outlined.keys);
  };

  /// Un campo di «Forma»: cambia i poligoni, le stelle e i rettangoli
  /// scelti, o senza selezione lo strumento Poligono.
  const shapeFromPanel = (id: FieldId, value: number | string | boolean): string | null => {
    const change = shapeChange(id, value, docUnit());
    const model = engine.model;
    if (change === null || model === null) return null;
    const units = selectedUnits();
    if (units.length === 0) {
      if (tool === "polygon") setPolygonTool(toolWith(polygonTool, change));
      return null;
    }
    const reshaped = shapeOps(model, units, change, newIds(), polygonTool);
    return changeFromPanel(SHAPE_ACTIONS[id]!, reshaped.ops, reshaped.keys);
  };

  /// Un lato della pagina, nell'unità del documento.
  const pageFromPanel = (id: "pageWidth" | "pageHeight", value: number): string | null => {
    const page = scene.root.page;
    if (page === null) return null;
    const size = fromUnit(value, docUnit());
    const viewBox = (box: readonly number[]): string => box.map((each) => formatNumber(each, PLACES)).join(" ");
    const next = viewBox([page.x, page.y, id === "pageWidth" ? size : page.width, id === "pageHeight" ? size : page.height]);
    if (next === viewBox([page.x, page.y, page.width, page.height])) return null;
    return changeFromPanel("draw.action.page_size", [{ op: "page", viewBox: next }], null);
  };

  const descFromPanel = (value: string): string | null => {
    const next = value.trim();
    if (next === rootText("desc").trim()) return null;
    return changeFromPanel("draw.action.desc", [{ op: "meta", desc: next === "" ? null : next }], null);
  };

  /// L'unità del documento, dal pannello: come dal menu, si dice.
  const unitFromPanel = (value: number | string | boolean): string | null => {
    const unit = UNITS.find((each) => each === value);
    if (unit === undefined || unit === docUnit()) return null;
    const outcome = changeFromPanel("draw.action.units", [{ op: "set", id: ROOT, attrs: { "fub:units": unit === "px" ? null : unit } }], null);
    if (outcome === null) announce(t(UNITS_NOW[unit]));
    return outcome;
  };

  /// Scrive il valore di un campo del pannello: `null` se il disegno l'ha
  /// accettato, altrimenti la ragione per cui no. Dopo, il pannello mostra
  /// com'è il disegno, anche quando il valore scritto non cambiava niente.
  function changeField(id: FieldId, value: number | string | boolean): string | null {
    const on = value === true;
    const number = typeof value === "number" ? value : Number.NaN;
    let outcome: string | null = null;
    switch (id) {
      case "grid":
        changeGrid({ ...grid, shown: on });
        break;
      case "snap":
        changeGrid({ ...grid, snap: on });
        break;
      case "guides":
        changeGrid({ ...grid, guides: on });
        break;
      case "rulers":
        changeGrid({ ...grid, rulers: on });
        break;
      case "rulerGuides":
        changeGrid({ ...grid, rulerGuides: on });
        break;
      case "bar":
        changeGrid({ ...grid, bar: on });
        break;
      case "ratio":
        ratioLock = { keys: selection.join("\n"), on };
        break;
      case "unit":
        outcome = unitFromPanel(value);
        break;
      case "desc":
        outcome = descFromPanel(String(value));
        break;
      case "pageWidth":
      case "pageHeight":
        if (Number.isFinite(number)) outcome = pageFromPanel(id, number);
        break;
      case "x":
      case "y":
        if (Number.isFinite(number)) outcome = moveFromPanel(id === "x" ? 0 : 1, number);
        break;
      case "width":
      case "height":
        if (Number.isFinite(number)) outcome = resizeFromPanel(id === "width" ? 0 : 1, number);
        break;
      case "rotation":
        if (Number.isFinite(number)) outcome = rotateFromPanel(number);
        break;
      case "shape":
      case "count":
      case "inner":
      case "corner":
        outcome = shapeFromPanel(id, value);
        break;
      default:
        outcome = styleFromPanel(id, value);
    }
    panelShown = null;
    syncProperties();
    return outcome;
  }

  /// Un comando di «Disponi» del pannello, come dalla barra.
  function runAction(id: ActionId): void {
    const command = ACTION_COMMANDS[id];
    if (command.kind === "align") alignSelection(command.edge);
    else if (command.kind === "distribute") distributeSelection(command.axis);
    else orderSelection(command.order);
  }

  /// «Applica» di «Trasforma»: come la finestra, attorno al centro del
  /// riquadro degli oggetti scelti.
  function transformFields(values: Readonly<Record<TransformId, number>>): string | null {
    if (values.scaleX === 0 || values.scaleY === 0) return t("draw.properties.zero_scale");
    const units = arranging("transform");
    const from = units === null ? null : boundsOf(units);
    if (units === null || from === null) return null;
    const m = numericMatrix(
      { rotate: values.turn, scaleX: values.scaleX / 100, scaleY: values.scaleY / 100, skewX: values.skewX, skewY: values.skewY },
      [(from.min[0] + from.max[0]) / 2, (from.min[1] + from.max[1]) / 2],
    );
    const transformed = numericOps(units, m, newIds());
    if (transformed === null) return t("draw.transform.unwritable");
    if (arrange("draw.action.transform", transformed, boundsAfter(units, m)) !== null) {
      announce(plural(transformed.changed, "draw.transformed.one", "draw.transformed.other"));
    }
    return null;
  }

  // --- La barra accanto alla selezione ---------------------------------------

  /// Le misure della barra della selezione, finché non cambiano i suoi
  /// pulsanti o la lingua: leggerle costa un layout.
  let barSize: { readonly signature: string; readonly w: number; readonly h: number } | null = null;
  relabels.push(() => {
    barSize = null;
  });

  /// Il riquadro sullo schermo della selezione con la cornice e le maniglie,
  /// che la barra non copre.
  const selectionBox = (): ScreenBox | null => {
    let band = selectionBand;
    const view = frameNow();
    if (view !== null) for (const { at } of view.spots) band = union(band, { min: at, max: at });
    if (band === null) return null;
    const box = screenBox(camera, band);
    const pad = FRAME_PX + HANDLE_REACH_PX;
    return {
      x: box.min[0] - pad,
      y: box.min[1] - pad,
      w: box.max[0] - box.min[0] + 2 * pad,
      h: box.max[1] - box.min[1] + 2 * pad,
    };
  };

  /// La barra della selezione accanto alla selezione, se chi disegna la
  /// vuole lì (`bar.ts`): sotto la cornice, o sopra se sotto non c'è posto.
  /// Durante un gesto non si vede, perché non copra ciò che si muove.
  function placeBar(): void {
    const beside = grid.bar && !arrangeBar.hidden;
    arrangeBar.toggleAttribute("data-beside", beside);
    arrangeBar.toggleAttribute("data-gesture", beside && (current !== null || pressed !== null));
    if (!beside) {
      arrangeBar.style.removeProperty("transform");
      return;
    }
    const signature = arrangeButtons.map((control) => (control.hidden ? "0" : "1")).join("");
    if (barSize === null || barSize.signature !== signature || barSize.w === 0) {
      barSize = { signature, w: arrangeBar.offsetWidth, h: arrangeBar.offsetHeight };
    }
    const spot = barSpot(selectionBox(), barSize, viewArea());
    arrangeBar.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
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
  /// niente in nessuna forma.
  const syncNodesBar = (): void => {
    if (edits.length === 0) return;
    const chosen = chosenEdits();
    let between = false;
    let toLine = false;
    let toCurve = false;
    let inner = false;
    let join = false;
    for (const edit of chosen) {
      const keys = pickedIn(edit);
      const links = linksBetween(edit.subs, keys);
      between ||= links.any;
      toLine ||= links.toLine;
      toCurve ||= links.toCurve;
      inner ||= [...keys].some((key) => {
        const [s, at] = parseKey(key);
        const sub = edit.subs[s];
        return sub !== undefined && innerNode(sub, at);
      });
      join ||= joinNodes(edit.subs, keys) !== null;
    }
    insertNodesButton.disabled = !between;
    deleteNodesButton.disabled = chosen.length === 0;
    for (const control of [cornerButton, smoothButton, symmetricButton, breakButton]) control.disabled = !inner;
    linesButton.disabled = !toLine;
    curvesButton.disabled = !toCurve;
    joinButton.disabled = !join;
    alignNodesButton.disabled = nodesReference() === null;
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
    const noding = typing === null && tool === "nodes" && edits.length > 0;
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
    // Col pannello, «Trasforma…» porta ai suoi campi; senza, apre la finestra.
    if (has("properties")) transformButton.removeAttribute("aria-haspopup");
    else transformButton.setAttribute("aria-haspopup", "dialog");
    applyButton.hidden = !has("apply");
    shapeButton.hidden = !has("recognize") || !units.some(holdsPenStroke);
    pathButton.hidden = !has("path");
    booleanButton.hidden = !has("boolean");
    outlineButton.hidden = !has("outline");
    arrangeBar.hidden = units.length === 0 || arrangeButtons.every((control) => control.hidden);
    arrangeFocus.sync(null);
    syncNodesBar();
    placeBar();
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
    selectionButton.hidden = !has("selection");
    // Senza la selezione avanzata non si isola: si torna a tutto il disegno.
    if (isolation !== null && !has("selection")) {
      isolation = null;
      rescope(selection);
      return;
    }
    // Col pannello, «Proprietà» lo apre e lo chiude anche in sola lettura: il
    // pannello mostra com'è il disegno. Senza, apre una finestra per cambiare.
    const panelled = has("properties");
    propertiesButton.disabled = !panelled && !canEdit;
    if (panelled) {
      propertiesButton.removeAttribute("aria-haspopup");
      propertiesButton.setAttribute("aria-controls", panel.element.id);
      propertiesButton.setAttribute("aria-expanded", String(!panel.element.hidden));
    } else {
      propertiesButton.setAttribute("aria-haspopup", "dialog");
      propertiesButton.removeAttribute("aria-controls");
      propertiesButton.removeAttribute("aria-expanded");
      if (!panel.element.hidden) showPanel(false, false, false);
    }
    pageButton.hidden = !has("grid") && !has("guides") && !has("rulers") && !has("recognize") && !has("gestures");
    insertGroup.hidden = !insertsImages(features);
    imageButton.disabled = !canEdit;
    nestInspector(panelled && has("attributes"));
    attributesButton.hidden = !has("attributes") || nestedNow();
    if (attributesButton.hidden && !nestedNow() && !inspector.element.hidden) showAttributes(false);
    historyButton.hidden = !has("history");
    if (historyButton.hidden && !historyPanel.element.hidden) showHistory(false);
    syncHistory();
    accessButton.hidden = !has("accessibility");
    if (accessButton.hidden && !accessPanel.element.hidden) showAccess(false);
    syncAccess();
    syncDescriptions();
    syncPaths();
    syncInspector();
    syncProperties();
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
    // Il gruppo isolato si ritrova nel disegno nuovo; se non c'è più, o lì
    // dentro non si sceglie più, si sceglie di nuovo in tutto il disegno.
    if (isolation !== null && isolatedNode() === null) isolation = null;
    painter.setFocus(isolationChain());
    showIsolation();
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
    syncProperties();
  };

  // --- Operazioni -----------------------------------------------------------

  const emit = (applied: Pick<Applied, "text" | "operation" | "duplicate">, origin: DrawChange["origin"]): void => {
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

  /// La superficie dopo un annulla, un ripeti o un salto nella cronologia:
  /// la scena nuova, e la selezione che segue ciò che l'ultimo passo ha
  /// toccato e che c'è ancora, e così il livello corrente.
  const landed = (ids: readonly string[]): void => {
    refresh();
    const touched = inOrder(ids);
    if (touched.length > 0) selection = touched;
    const layer = has("layers") ? currentIndex().layers.find((other) => other.id !== null && ids.includes(other.id)) : undefined;
    if (layer !== undefined) choose(layer);
    else if (touched.length > 0) followSelection();
    syncControls();
    // I tipi dati ai nodi tornano come erano a questo punto.
    resolveNodes();
    const kinds = kindsAt.get(history.position);
    if (kinds !== undefined) nodeKinds = kinds;
    showHandles();
  };

  const replay = (step: Replay | null, origin: "undo" | "redo"): void => {
    if (step === null) return;
    const action = t(step.step.label);
    if (step.outcome.outcome === "rejected") {
      syncControls();
      announce(t(origin === "undo" ? "draw.undo.failed" : "draw.redo.failed", { action }));
      return;
    }
    landed(step.outcome.touched);
    emit(step.outcome, origin);
    announce(t(origin === "undo" ? "draw.undone" : "draw.redone", { action }));
  };

  /// Dove si è nella cronologia, a parole, per dire dove ha portato un
  /// salto: al segno `mark`, se il salto è arrivato al suo punto.
  const whereNow = (mark: Mark | null): string => {
    const at = history.position;
    if (mark !== null && mark.at === at) return t("draw.history.where.mark", { name: mark.name });
    if (at === history.start) return t(history.trimmed ? "draw.history.where.start" : "draw.history.where.opened");
    const step = history.steps()[history.done - 1]!;
    return t("draw.history.where.step", { action: t(step.label) });
  };

  /// Va al punto `at` della cronologia in un colpo, dal suo pannello: i
  /// passi in mezzo si annullano o si ripetono insieme, e il documento cambia
  /// una volta sola. Ciò che si sta scrivendo o tracciando si conclude prima,
  /// come cambiando strumento. `mark` è il segno da cui ci si va, per dirlo.
  function goToPoint(at: number, mark: Mark | null): void {
    if (!editable()) return;
    finishText();
    cancelGesture();
    finishBezier(false, true);
    const jump = history.goTo(engine, at);
    if (jump === null) {
      syncControls();
      return;
    }
    const said: string[] = [];
    const undos = jump.replayed.undos;
    if (undos.length > 0) {
      // La selezione segue l'ultimo passo, quello accanto al punto d'arrivo:
      // come un annulla o un ripeti, che ne sono il salto più corto.
      landed(undos[undos.length - 1]!.touched);
      emit({ ...jump.replayed, duplicate: false }, jump.direction);
      const back = jump.direction === "undo";
      said.push(plural(undos.length, back ? "draw.history.back.one" : "draw.history.forward.one", back ? "draw.history.back.other" : "draw.history.forward.other", { where: whereNow(mark) }));
    } else {
      syncControls();
    }
    if (jump.failed !== null) said.push(t(jump.direction === "undo" ? "draw.undo.failed" : "draw.redo.failed", { action: t(jump.failed.label) }));
    announce(said.join(" "));
  }

  /// «Segna questo punto»: un segno dove si è adesso, col nome di partenza,
  /// e il suo campo del nome aperto.
  function markHere(): void {
    if (!editable()) return;
    const sign = history.mark(t("draw.history.mark.name", { number: history.marked + 1 }));
    syncHistory();
    historyPanel.rename(sign.id);
  }

  function renameMark(id: number, name: string): void {
    if (!history.rename(id, name)) return;
    syncHistory();
    announce(t("draw.history.renamed", { name }));
  }

  function unmark(id: number): void {
    const sign = history.marks.find((each) => each.id === id);
    if (sign === undefined || !history.unmark(id)) return;
    syncHistory();
    announce(t("draw.history.unmarked", { name: sign.name }));
  }

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

  // --- Il gruppo isolato -----------------------------------------------------

  /// La chiave di un contenitore del modello, come quella della selezione.
  const keyOfNode = (node: ElementPart): string => keyOf({ id: node.facts.id, path: pathOf(node) });

  /// Il nome a parole di un contenitore del modello, come nell'albero.
  const nameOfNode = (node: ElementPart): string => {
    const outlined = outlineNow().byKey.get(keyOfNode(node));
    return outlined === undefined ? tagName(node) : describe(outlined, { parts: true });
  };

  /// Il percorso che la barra mostra adesso, per non rifarla uguale.
  let isolationShown: string | null = null;

  /// La barra del gruppo isolato: il livello, o il disegno, e i gruppi fino
  /// a quello isolato, che è dove si è. Un gruppo del percorso è un pulsante
  /// che lo isola; il primo esce del tutto. Se la barra perde il pulsante che
  /// aveva il fuoco, il fuoco torna al foglio.
  function showIsolation(): void {
    const chain = isolationChain();
    const focused = isolationBar.contains(document.activeElement);
    isolationBar.hidden = chain === null;
    if (chain === null) {
      isolationShown = null;
      isolationPath.replaceChildren();
      if (focused) surface.focus({ preventScroll: true });
      return;
    }
    const crumbs = chain.map((node, depth) => ({ depth: node.details?.role === "layer" ? -1 : depth, text: nameOfNode(node) }));
    if (chain[0]!.details?.role !== "layer") crumbs.unshift({ depth: -1, text: t("draw.isolation.drawing") });
    const shown = crumbs.map((crumb) => `${crumb.depth}\t${crumb.text}`).join("\n");
    if (shown === isolationShown) return;
    isolationShown = shown;
    isolationPath.replaceChildren(...crumbs.map((crumb, at) => {
      const item = document.createElement("li");
      if (at > 0) {
        const separator = document.createElement("span");
        separator.className = "draw-isolation-sep";
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "›";
        item.append(separator);
      }
      const last = at === crumbs.length - 1;
      const element = document.createElement(last ? "span" : "button");
      element.className = "draw-isolation-crumb";
      element.textContent = crumb.text;
      if (element instanceof HTMLButtonElement) {
        element.type = "button";
        element.dataset.depth = String(crumb.depth);
      } else {
        element.setAttribute("aria-current", "location");
      }
      item.append(element);
      return item;
    }));
    if (focused && !isolationBar.contains(document.activeElement)) surface.focus({ preventScroll: true });
  }

  /// Si sceglie in un altro posto: l'indice, l'attenuazione, la barra e
  /// l'albero lo seguono, e la selezione diventa `keys`.
  const rescope = (keys: readonly string[]): void => {
    isolatedFor = null;
    index = null;
    kept = null;
    lastTap = null;
    painter.setFocus(isolationChain());
    showIsolation();
    selection = inOrder(keys);
    syncControls();
    showHandles();
    syncTree();
  };

  /// Isola `unit`, un gruppo o un collegamento in cui si sceglie: dentro si
  /// sceglie l'oggetto sotto `at`, se c'è, o con `at` nullo il primo, e lo
  /// si dice.
  const isolate = (unit: Unit, at: Point | null, pointer: InkPointerType = "mouse"): boolean => {
    const model = engine.model;
    if (!has("selection") || model === null || unit.node.kind !== "container" || !indexer.opens(model, unit.node)) return false;
    cancelGesture();
    isolation = { key: unit.key, path: unit.path, tag: unit.tag };
    isolatedFor = null;
    index = null;
    const inside = currentIndex();
    const pick = at === null ? inside.units[0] ?? null : inside.at(at, HIT_PX[pointer] / camera.scale);
    rescope(pick === null ? [] : [pick.key]);
    const name = t("draw.isolated", { name: nameOfNode(unit.node) });
    announce(pick === null ? name : `${name} ${t("draw.walk", { object: labelOf(pick), index: inside.units.indexOf(pick) + 1, count: inside.units.length })}`);
    return true;
  };

  /// Esce dal gruppo isolato: verso il gruppo che lo contiene, se ce n'è
  /// uno, o con `all` del tutto. Resta scelto il gruppo da cui si esce.
  function leaveIsolation(all: boolean): boolean {
    const node = isolatedNode();
    if (node === null) return false;
    const parent = node.parent;
    const role = parent?.details?.role;
    isolation = !all && parent !== null && (role === "group" || role === "link")
      ? { key: keyOfNode(parent), path: pathOf(parent), tag: tagName(parent) }
      : null;
    rescope([keyOfNode(node)]);
    const now = isolatedNode();
    announce(now === null ? t("draw.isolation.left") : t("draw.isolated", { name: nameOfNode(now) }));
    return true;
  }

  /// Un gruppo del percorso della barra: isola il contenitore a profondità
  /// `depth`, o con -1 esce del tutto. Resta scelto il gruppo da cui si
  /// esce, il primo del percorso dentro quello a cui si torna.
  function isolateAt(depth: number): void {
    const chain = isolationChain();
    if (chain === null) return;
    const node = depth < 0 ? null : chain[depth];
    if (node === undefined) return;
    const left = node === null ? chain.find((each) => each.details?.role !== "layer") : chain[depth + 1];
    isolation = node === null ? null : { key: keyOfNode(node), path: pathOf(node), tag: tagName(node) };
    rescope(left === undefined ? [] : [keyOfNode(left)]);
    surface.focus({ preventScroll: true });
    const now = isolatedNode();
    announce(now === null ? t("draw.isolation.left") : t("draw.isolated", { name: nameOfNode(now) }));
  }

  /// Mod+Invio, o «Isola il gruppo»: il gruppo, o il collegamento, scelto
  /// da solo.
  const isolateSelection = (): void => {
    const units = selectedUnits();
    const unit = units.length === 1 && (units[0]!.role === "group" || units[0]!.role === "link") ? units[0]! : null;
    if (unit === null || !isolate(unit, null)) announce(t("draw.isolate.none"));
  };

  /// Porta `bounds` in vista: resta dov'è se si vede già intero, va al
  /// centro se ci sta allo zoom di adesso, altrimenti si inquadra.
  const frameBounds = (bounds: Bounds | null): void => {
    const area = viewArea();
    if (bounds === null || area.w === 0 || area.h === 0) return;
    placed = true;
    const box = screenBox(camera, bounds);
    const [left, top] = box.min;
    const [right, bottom] = box.max;
    if (left >= area.x && top >= area.y && right <= area.x + area.w && bottom <= area.y + area.h) return;
    const usable = 1 - 2 * FIT_PAD;
    if (right - left <= area.w * usable && bottom - top <= area.h * usable) {
      const cx = (bounds.min[0] + bounds.max[0]) / 2;
      const cy = (bounds.min[1] + bounds.max[1]) / 2;
      setCamera(placedAt(camera, [cx, cy], [area.x + area.w / 2, area.y + area.h / 2]));
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
    const hadPanel = has("properties");
    level = next;
    features = offered;
    // Senza la vista girata, il foglio torna dritto.
    if (!has("gestures") && camera.angle !== 0) setCamera(turnTo(camera, 0, viewCenter()));
    tools = toolsOf(features);
    if (!tools.some((spec) => spec.id === tool)) {
      cancelGesture();
      tool = toolAfter(tools, tool);
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
    // Il pannello arriva come lo vuole chi disegna.
    if (!hadPanel && has("properties")) showPanelByDefault();
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
      recentTools = [tool, ...recentTools.filter((each) => each !== tool && each !== id)].slice(0, RECENT_MAX);
      forgetBuilder();
    }
    tool = id;
    syncControls();
    // La cornice è dello strumento Selezione.
    showHandles();
    showGrip(null);
    const named = t("draw.announce.tool", { tool: t(toolLabel(id)) });
    // Con lo strumento Nodi, anche di che cosa si modificano i nodi; col
    // Costruttore, su quante regioni lavora.
    const target = id === "nodes" ? targetText() : id === "builder" ? builderText() : "";
    announce([finished, named, target].filter((part) => part !== "").join(" "));
  }

  function setColor(value: string): void {
    const code = customColor(value);
    if (code === null) return;
    if (swatchOf(code) === null) {
      if (!has("colors")) return;
      custom = code;
    }
    const before = style().color;
    if (before !== code) recentColors = [before, ...recentColors.filter((each) => each !== before && each !== code)].slice(0, RECENT_MAX);
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

  /// Lo strumento `id` scelto dalla barra o dal suo tasto. Il Poligono scelto
  /// di nuovo passa dal poligono alla stella, e ritorno; la penna di Bézier
  /// alla Curvatura, e ritorno.
  function pickTool(id: ToolId): void {
    if (id === "polygon" && tool === "polygon") togglePolygon();
    else if (id === "bezier" && tool === "bezier") toggleCurvature();
    else setTool(id);
  }

  /// Lo strumento Poligono come `next`: la forma che si sta tirando, il
  /// pulsante e il pannello lo seguono.
  function setPolygonTool(next: PolygonTool): void {
    const turned = next.shape !== polygonTool.shape;
    polygonTool = next;
    if (turned) showToolMode("polygon");
    if (current?.kind === "shape" && current.tool === "polygon") drawShape(current);
    syncProperties();
  }

  /// Dal poligono alla stella, e ritorno, anche a metà gesto.
  function togglePolygon(): void {
    setPolygonTool({ ...polygonTool, shape: polygonTool.shape === "star" ? "polygon" : "star" });
    announce(t("draw.announce.tool", { tool: t(toolLabel("polygon")) }));
  }

  /// Dalla penna alla Curvatura, e ritorno. Il tracciato in corso resta: i
  /// nodi che ha tengono il loro modo, i prossimi prendono l'altro. Il gesto
  /// in corso finisce come era cominciato.
  function toggleCurvature(): void {
    curvature = !curvature;
    curveTap = null;
    showToolMode("bezier");
    if (drafting !== null) showBezier();
    else showHandles();
    announce(t("draw.announce.tool", { tool: t(toolLabel("bezier")) }));
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
    // Con un gruppo isolato, ciò che si disegna entra lì, in cima.
    const group = isolatedUnit();
    if (group !== null) {
      const to = destinationInto(group, ids);
      if (to === null) announce(t("draw.layer.flat", { name: nameOfNode(group.node) }));
      return to;
    }
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
  /// bloccati. Del gruppo isolato e dei contenitori `open` i figli uno per
  /// uno; quelli senza `open` si tengono finché la scena non cambia.
  let seenCache: { readonly index: SceneIndex; readonly units: readonly Unit[] } | null = null;
  const seenUnits = (open: readonly ContainerNode[] = []): readonly Unit[] => {
    const index = currentIndex();
    const model = engine.model;
    if (model === null) return [];
    const opened = new Set([...(isolationChain() ?? []), ...open]);
    if (open.length > 0) return indexer.seen(model, opened);
    if (seenCache?.index !== index) seenCache = { index, units: indexer.seen(model, opened) };
    return seenCache.units;
  };

  /// I gruppi che contengono gli oggetti di chiave `keys`, fino al livello:
  /// chi si sposta da dentro un gruppo si allinea ai suoi fratelli, e non al
  /// gruppo che lo contiene.
  const openedBy = (keys: readonly string[]): ContainerNode[] => {
    const index = currentIndex();
    const out: ContainerNode[] = [];
    for (const key of keys) {
      for (let at = index.get(key)?.node.parent ?? null; at !== null && at.parent !== null && at.details?.role !== "layer"; at = at.parent) out.push(at);
    }
    return out;
  };

  /// Il gruppo isolato come oggetto, che riceve ciò che si disegna; `null`
  /// senza gruppo isolato.
  let isolatedUnitFor: { readonly model: DocumentModel; readonly unit: Unit | null } | null = null;
  const isolatedUnit = (): Unit | null => {
    const node = isolatedNode();
    const model = engine.model;
    if (node === null || model === null) return null;
    if (isolatedUnitFor?.model !== model) isolatedUnitFor = { model, unit: indexer.index(model).get(keyOfNode(node)) };
    return isolatedUnitFor.unit;
  };

  /// I bersagli di `owner`, un gesto o i nodi della penna di Bézier, presi la
  /// prima volta che servono e tenuti finché la scena e la vista restano
  /// quelle: con le guide intelligenti gli oggetti che si vedono nella
  /// vista, tranne quelli di chiave `skip`, la pagina, e i punti `points`;
  /// con le guide del documento, quelle, tranne la guida `skipGuide`. Ci si
  /// allinea a ciò che si guarda; un foglio non ancora disposto, senza
  /// misure, vede tutto.
  let guideCache: { readonly owner: object; readonly index: SceneIndex; readonly view: View; readonly guides: GuideIndex } | null = null;
  const guidesFor = (owner: object, skip: readonly string[], points: () => readonly Point[] = () => [], skipGuide: number | null = null): GuideIndex => {
    const index = currentIndex();
    if (guideCache !== null && guideCache.owner === owner && guideCache.index === index && guideCache.view === camera) return guideCache.guides;
    const targets: GuideTarget[] = [];
    if (smartOn()) {
      const skipped = new Set(skip);
      const view = surface.clientWidth > 0 && surface.clientHeight > 0 ? viewBounds() : null;
      for (const unit of seenUnits(openedBy(skip))) {
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

  /// I nodi delle forme che si modificano che restano fermi, nella scena:
  /// bersagli delle guide. Con `moving` si muovono quelli scelti; senza, si
  /// muove una maniglia, che si allinea anche al suo nodo.
  const fixedNodes = (moving: boolean): Point[] => {
    const out: Point[] = [];
    for (const edit of edits) {
      const chosen = moving ? pickedIn(edit) : NO_KEYS;
      edit.subs.forEach((sub, s) => {
        sub.nodes.forEach((node, at) => {
          if (!chosen.has(nodeKey(s, at))) out.push(apply(edit.matrix, node));
        });
      });
    }
    return out;
  };

  /// Dove il trascinamento `g` porta il nodo o la maniglia presi, con la
  /// griglia e con le guide: un nodo si allinea agli altri oggetti e ai nodi
  /// che restano fermi, una maniglia anche al suo nodo.
  const nodeDragTo = (g: NodesGesture, grab: Extract<NodeGrab, { readonly origin: Point }>): Point => {
    const p: Point = [grab.origin[0] + g.end![0] - g.from![0], grab.origin[1] + g.end![1] - g.from![1]];
    return guided(p, () => guidesFor(g, editedUnits(), () => fixedNodes(grab.kind === "node" && !grab.pull)), g.pointer);
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
    if (g?.kind === "nodes" && g.dragging && g.from !== null && g.end !== null && edits.length > 0) {
      const grab = g.grab;
      if (grab?.kind !== "node" && grab?.kind !== "handle") return null;
      return point(guidesFor(g, editedUnits(), () => fixedNodes(grab.kind === "node" && !grab.pull)), nodeDragTo(g, grab));
    }
    if (g?.kind === "bezier" && g.mode === "path") {
      if (g.reshaped === null) return null;
      const [s, at] = parseKey(g.reshaped.key);
      return point(guidesFor(g, editedUnits()), apply(g.path!.edit.matrix, g.reshaped.subs[s]!.nodes[at]!));
    }
    if (g?.kind === "bezier" && g.mode !== null && g.curve) {
      // La Curvatura sposta punti, non maniglie.
      if (g.dragging) return point(g.mode === "add" ? bezierGuides() : curveGuides(g), curveMoved(g));
      return g.mode === "add" ? point(bezierGuides(), g.at!) : null;
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
    const p = toScene(camera, down);
    if (ruler !== null) {
      if (!editable()) return { ...base, kind: "refused" };
      const guides = writableGuides();
      if (guides === null) return { ...base, kind: "refused" };
      if (guides.length >= MAX_GUIDES) {
        announce(t("draw.guides.full", { count: MAX_GUIDES }));
        return { ...base, kind: "refused" };
      }
      // Sul foglio girato il righello in alto tira la guida della scena che
      // si vede più orizzontale, quello a sinistra la più verticale.
      const level = sceneLevel();
      const axis = ruler === "top" ? (level ? "y" : "x") : level ? "x" : "y";
      return { ...base, kind: "guide", axis, index: null, from: down, offset: 0, at: axis === "x" ? p[0] : p[1], away: true, moved: false };
    }
    if (tool !== "select" || !editable() || !guidesShown()) return null;
    const guides = scene.root.guides;
    if (guides === null) return null;
    const view = frameNow();
    if (view !== null && gripAt(view, p, camera.scale, base.pointer) !== null) return null;
    const index = guideAt(guides, camera, down, GUIDE_HIT_PX[base.pointer], true);
    if (index === null) return null;
    const guide = guides[index]!;
    const offset = guide.at - (guide.axis === "x" ? p[0] : p[1]);
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
    const [x, y] = toScreen(camera, p);
    if (!g.moved && Math.hypot(x - g.from[0], y - g.from[1]) <= DRAG_PX[g.pointer]) return;
    if (!g.moved) showGrip(axisCursor(g.axis));
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
    const [px, py] = toScreen(camera, pointerAt.at);
    const x = Math.min(Math.max(px, area.x + 48), area.x + area.w - 48);
    const y = Math.min(Math.max(py + 8, area.y + 4), area.y + area.h - 24);
    const [ax, ay] = toScene(camera, [x, y]);
    return [{ kind: "label", x: ax, y: ay, text: g.away ? t("draw.guide.drop") : lengthText(g.at) }];
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
  /// «Penna e dita…»: i gesti delle dita e la curva della pressione della
  /// penna, di questo dispositivo. Valgono anche in sola lettura, come la
  /// griglia: sono della vista, non del disegno.
  async function touchSettings(): Promise<void> {
    if (asking || !has("gestures")) return;
    finishText();
    cancelGesture();
    asking = true;
    try {
      const answer = await touchDialog({ twist: grid.twist, taps: grid.taps, pen: grid.pen });
      if (answer === null || disposed) return;
      changeGrid({ ...grid, ...answer });
    } finally {
      asking = false;
    }
  }

  async function editGuides(focus: number | null): Promise<void> {
    if (asking || !editable() || !has("rulers")) return;
    finishText();
    cancelGesture();
    asking = true;
    try {
      const center = toScene(camera, viewCenter());
      const before = scene.root.guides;
      const answer = await guideDialog({ guides: before, unit: docUnit(), center, focus });
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
        return {
          ...base,
          kind: "ink",
          tool,
          color,
          brush,
          to,
          ids,
          scene: [],
          local: [],
          predicted: [],
          began: start.timeStamp,
          holds: tool === "pen" && start.id >= 0 && !start.continued,
          still: null,
          held: null,
        };
      }
      case "rect":
      case "ellipse":
      case "line":
      case "arrow":
      case "polygon": {
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
        return { ...base, kind: "bezier", to, curve: curvature, mode: null, path: null, reshaped: null, index: -1, from: null, end: null, at: null, dragging: false };
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
          corner: null,
          matrix: null,
          angle: 0,
        };
      case "lasso":
        return { ...base, kind: "lasso", points: [], base: [...selection], mode: shift ? "add" : alt ? "remove" : "replace", dragging: false };
      case "nodes":
        resolveNodes();
        return {
          ...base,
          kind: "nodes",
          from: null,
          end: null,
          grab: null,
          dragging: false,
          nodes: nodeSelection,
          shapes: edits.map((edit) => edit.path),
          selection: [...selection],
          draft: null,
          side: null,
          reshaped: null,
          missed: null,
        };
      case "builder":
        return { ...base, kind: "builder", from: null, end: null, mode: null, additive: false, crossed: [], trail: [], base: [...selection], dragging: false };
      case "scissors":
        return { ...base, kind: "cut", from: null, end: null, trail: [], dragging: false };
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

  /// L'elemento della forma di `g`, con l'id `id`, nel livello `to`: un
  /// poligono come lo vuole lo strumento, diritto con Maiusc.
  const shapeOf = (g: ShapeGesture, id: string, to: Destination): Elem | null => {
    const ends = shapeEnds(g, to);
    if (ends === null) return null;
    return shapeElem(g.tool, id, ends[0], ends[1], { color: g.color, width: g.width }, minimumFor(to), { ...polygonTool, straight: shift });
  };

  const drawShape = (g: ShapeGesture): void => {
    showShape(shapeOf(g, "preview", g.to), g.to.matrix);
    // Le guide seguono il punto che si tira.
    if (guidesOn() || guiding) showHandles();
  };

  /// Il poligono o la stella che lo strumento disegna, a parole: «Esagono»,
  /// «Stella a 5 punte».
  const polygonSaid = (): string => polygonalKind({ shape: polygonTool.shape, count: polygonCount(polygonTool) });

  /// I tasti di un poligono mentre lo si disegna: ↑ e ↓, o Pag↑ e Pag↓, un
  /// lato o una punta in più o in meno, ← e → il raggio interno di una
  /// stella. Mentre la tastiera tiene premuto le frecce muovono il cursore, e
  /// restano i tasti di pagina. Vero se il tasto era del poligono: anche ← e
  /// → di un poligono, che non spostano niente a metà gesto.
  const polygonKey = (event: KeyboardEvent): boolean => {
    const arrowsFree = pressed === null;
    const count =
      event.key === "PageUp" || (arrowsFree && event.key === "ArrowUp") ? 1 : event.key === "PageDown" || (arrowsFree && event.key === "ArrowDown") ? -1 : 0;
    const ratio = arrowsFree && event.key === "ArrowRight" ? 1 : arrowsFree && event.key === "ArrowLeft" ? -1 : 0;
    if (count !== 0) {
      setPolygonTool(withCount(polygonTool, polygonCount(polygonTool) + count));
      announce(t("draw.polygon.count.said", { kind: polygonSaid() }));
    } else if (ratio !== 0 && polygonTool.shape === "star") {
      setPolygonTool({ ...polygonTool, ratio: stepRatio(polygonTool.ratio, ratio) });
      announce(t("draw.polygon.ratio.said", { value: numberText(polygonTool.ratio * 100) }));
    }
    return count !== 0 || ratio !== 0;
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
    if (arrange(turn === null ? "draw.action.resize" : "draw.action.rotate", transformed, boundsAfter(units, m)) === null) return;
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
    const corner = cornerAt(p, g.pointer, view, grip);
    const inverse = corner === null ? null : invert(corner.unit.matrix);
    if (corner !== null && inverse !== null) {
      g.corner = { unit: corner.unit, grip: corner.grip, from: apply(inverse, p), radius: corner.grip.radius };
      g.units = [corner.unit];
      return;
    }
    if (grip !== null) {
      g.grip = { grip, frame: view!.frame };
      g.units = selectedUnits();
      return;
    }
    // Con Ctrl o ⌘ si sceglie dentro i gruppi: l'oggetto più dentro sotto il
    // puntatore.
    const index = currentIndex();
    const tolerance = HIT_PX[g.pointer] / camera.scale;
    let hit = free && has("selection") ? index.deepAt(p, tolerance) : index.at(p, tolerance);
    // Sopra un oggetto scelto dentro un gruppo, il gesto prende lui: si
    // trascina senza il gruppo, e Maiusc lo toglie.
    if (hit !== null && !selection.includes(hit.key) && has("selection")) {
      const top = hit;
      const deep = index.deepAt(p, tolerance);
      const inner = deep === null ? undefined : selectedUnits().find((unit) => holdsPath(top.path, unit.path) && (unit.key === deep.key || holdsPath(unit.path, deep.path)));
      if (inner !== undefined) hit = inner;
    }
    g.hit = hit?.key ?? null;
    if (hit === null) {
      g.mode = "marquee";
      g.base = shift ? selection : [];
      if (!shift) select([]);
      return;
    }
    const chosen = selection.includes(hit.key);
    if (shift) {
      // Aggiunto un oggetto, il gruppo scelto che lo contiene lo lascia.
      if (chosen) g.release = hit.key;
      else select([...selectedUnits().filter((unit) => !holdsPath(unit.path, hit.path)).map((unit) => unit.key), hit.key]);
    } else if (!chosen) {
      select([hit.key]);
    }
    g.units = selectedUnits();
    const geometry = geometryOf(g.units);
    g.source = geometry === null ? null : nearestCorner(geometry, p);
  };

  /// Porta in `moved` lo spostamento della scena che il `transform` `next`
  /// dà a `unit`, se è un contenitore: i suoi strati immagine lo seguono
  /// nell'anteprima.
  const followImages = (moved: Map<object, Matrix>, unit: Unit, next: Matrix): void => {
    if (unit.node.kind !== "container") return;
    const before = invert(unit.matrix);
    if (before !== null) moved.set(unit.node, compose(compose(unit.parent, next), before));
  };

  /// La maniglia degli angoli tirata in `p`, un punto della scena: il raggio
  /// nuovo, e l'oggetto che lo mostra.
  const cornerUpdate = (drag: CornerDrag, p: Point): void => {
    const inverse = invert(drag.unit.matrix);
    if (inverse === null) return;
    drag.radius = cornerDrag(drag.grip, drag.from, apply(inverse, p), drag.grip.radius);
    const attrs = cornerAttrs(drag.unit.node, drag.unit.role, drag.radius);
    if (attrs === null) {
      painter.setDraft(null);
      return;
    }
    const d = attrs.d;
    if (typeof d === "string") painter.setDraft({ paths: new Map(drag.unit.paints.map((paint) => [paint, d])) });
    else painter.setDraft({ radii: new Map(drag.unit.paints.map((paint) => [paint, attrs])) });
  };

  /// Scrive il raggio a cui si è lasciata la maniglia degli angoli, in un
  /// passo, e lo dice.
  const applyCorner = (drag: CornerDrag): void => {
    const model = engine.model;
    if (model === null) return;
    const scale = scaleOf(drag.unit.matrix);
    const reshaped = shapeOps(model, [drag.unit], { corner: drag.radius * scale }, newIds(), polygonTool);
    if (reshaped.ops.length === 0) return;
    if (arrange("draw.action.corner", reshaped) !== null) announce(t("draw.corner.said", { value: lengthText(drag.radius * scale) }));
  };

  /// Il rettangolo della scena fra i punti `a` e `b`.
  const boxAround = (a: Point, b: Point): Bounds => ({
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  });

  /// Il riquadro di selezione da `from` a `end`, due punti della scena, sul
  /// foglio girato di traverso: un rettangolo dello schermo, che nella scena
  /// ha quattro angoli qualsiasi. `null` sul foglio dritto o girato di un
  /// angolo retto, dove il rettangolo della scena fra i due punti è lui.
  const slantedMarquee = (from: Point, end: Point): { corners: readonly Point[]; screen: Bounds } | null => {
    if (camera.angle % 90 === 0) return null;
    const screen = boxAround(toScreen(camera, from), toScreen(camera, end));
    const area = { x: screen.min[0], y: screen.min[1], w: screen.max[0] - screen.min[0], h: screen.max[1] - screen.min[1] };
    return { corners: sceneCorners(camera, area), screen };
  };

  /// Gli oggetti dentro il riquadro di selezione da `from` a `end`, come si
  /// vede: sul foglio girato di traverso, con la regola del lazo.
  const marqueed = (from: Point, end: Point): Unit[] => {
    const slanted = slantedMarquee(from, end);
    return slanted === null ? currentIndex().within(boxAround(from, end)) : currentIndex().inside(slanted.corners);
  };

  const selectUpdate = (g: SelectGesture): void => {
    if (g.from === null || g.end === null) return;
    if (g.mode === "pending") {
      const distance = Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * camera.scale;
      if (distance <= DRAG_PX[g.pointer]) return;
      g.mode = g.corner !== null ? "corner" : g.grip === null ? "move" : g.grip.grip === "rotate" ? "rotate" : "resize";
      g.release = null;
      if (g.corner !== null) showGrip(cornerCursor(g.corner.grip, g.corner.unit.matrix, camera.angle));
      else if (g.grip !== null) showGrip(g.grip.grip === "rotate" ? "rotating" : gripCursor(g.grip.frame, g.grip.grip, camera.angle));
    }
    if (g.mode === "corner") {
      cornerUpdate(g.corner!, g.end);
      showHandles();
      return;
    }
    if (g.mode === "resize" || g.mode === "rotate") {
      g.matrix = g.mode === "resize" ? resizeNow(g) : rotateNow(g);
      const transforms = new Map<PaintNode, string | null>();
      const carried = new Map<object, Matrix>();
      for (const unit of g.matrix === null ? [] : g.units) {
        const next = transformedMatrix(unit, g.matrix!);
        if (next === null) continue;
        const value = transformValue(next);
        for (const paint of unit.paints) transforms.set(paint, value);
        followImages(carried, unit, next);
      }
      painter.setDraft({ transforms, carried });
    } else if (g.mode === "move") {
      const [dx, dy] = moveDelta(g);
      const transforms = new Map<PaintNode, string | null>();
      const carried = new Map<object, Matrix>();
      for (const unit of g.units) {
        const moved = movedMatrix(unit, dx, dy);
        if (moved === null) continue;
        const value = transformValue(moved);
        for (const paint of unit.paints) transforms.set(paint, value);
        followImages(carried, unit, moved);
      }
      painter.setDraft({ transforms, carried });
    } else {
      selection = inOrder([...g.base, ...marqueed(g.from, g.end).map((unit) => unit.key)]);
      syncControls();
    }
    showHandles();
  };

  const selectEnd = (g: SelectGesture, time: number): void => {
    if (g.corner !== null) {
      // Come per la cornice, un tocco sulla maniglia non cambia niente.
      lastTap = null;
      painter.setDraft(null);
      current = null;
      showGrip(null);
      if (g.mode === "corner") applyCorner(g.corner);
      showHandles();
      return;
    }
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
    // Due tocchi sullo stesso testo lo aprono, su un gruppo o un collegamento
    // lo isolano, e sul vuoto escono dal gruppo isolato.
    const still = g.from !== null && g.end !== null && Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * camera.scale <= DRAG_PX[g.pointer];
    const tap = g.mode === "pending" && g.release === null && !shift && g.hit !== null && g.from !== null
      ? { key: g.hit, time, at: g.from }
      : g.mode === "marquee" && still && !shift && isolation !== null ? { key: "", time, at: g.from! } : null;
    const previous = lastTap;
    lastTap = tap;
    if (tap !== null && previous !== null && previous.key === tap.key && tap.time - previous.time <= DOUBLE_TAP_MS) {
      const apart = Math.hypot(tap.at[0] - previous.at[0], tap.at[1] - previous.at[1]) * camera.scale;
      const near = apart <= DOUBLE_TAP_PX[g.pointer];
      if (near && tap.key === "" && leaveIsolation(false)) {
        lastTap = null;
        return;
      }
      const unit = near && tap.key !== "" ? currentIndex().get(tap.key) : null;
      if (unit !== null && unit.look !== null && has("text") && editable()) {
        lastTap = null;
        editText(unit);
        return;
      }
      if (unit !== null && (unit.role === "group" || unit.role === "link") && isolate(unit, tap.at, g.pointer)) {
        lastTap = null;
        return;
      }
    }
    showHandles();
    announceSelection();
  };

  // --- Il Lazo -----------------------------------------------------------------

  /// Il punto `p` entra nel lazo se è abbastanza lontano dall'ultimo; oltre
  /// i punti che il lazo tiene, ne resta uno ogni due.
  const lassoAdd = (g: LassoGesture, p: Point): void => {
    const last = g.points[g.points.length - 1];
    if (last !== undefined && Math.hypot(p[0] - last[0], p[1] - last[1]) * camera.scale < LASSO_STEP_PX) return;
    g.points.push(p);
    if (g.points.length > LASSO_MAX_POINTS) {
      const kept = g.points.filter((_, at) => at % 2 === 0 || at === g.points.length - 1);
      g.points.splice(0, g.points.length, ...kept);
    }
    const first = g.points[0]!;
    if (!g.dragging && Math.hypot(p[0] - first[0], p[1] - first[1]) * camera.scale > DRAG_PX[g.pointer]) g.dragging = true;
  };

  /// La selezione mentre il lazo si tira: ciò che racchiude per intero, al
  /// posto di quella di prima, o aggiunto con Maiusc, o tolto con Alt.
  const lassoUpdate = (g: LassoGesture): void => {
    if (!g.dragging) return;
    const inside = new Set(currentIndex().inside(g.points).map((unit) => unit.key));
    selection = inOrder(g.mode === "replace" ? inside : g.mode === "add" ? [...g.base, ...inside] : g.base.filter((key) => !inside.has(key)));
    syncControls();
    showHandles();
  };

  /// Il lazo si chiude: la selezione resta quella che ha fatto. Un tocco
  /// sceglie l'oggetto sotto, o con Maiusc lo aggiunge o lo toglie, o con
  /// Alt lo toglie.
  const lassoEnd = (g: LassoGesture): void => {
    current = null;
    const first = g.points[0];
    if (!g.dragging && first !== undefined) {
      const hit = currentIndex().at(first, HIT_PX[g.pointer] / camera.scale);
      const key = hit?.key ?? null;
      if (g.mode === "replace") select(key === null ? [] : [key]);
      else if (key !== null && (g.mode === "remove" || g.base.includes(key))) select(g.base.filter((each) => each !== key));
      else if (key !== null) select([...g.base, key]);
    } else {
      lassoUpdate(g);
    }
    showHandles();
    announceSelection();
  };

  // --- Il Costruttore di forme -------------------------------------------------

  /// Il Costruttore sugli oggetti scelti, rifatto quando cambiano la scena o
  /// la selezione: allora la regione sotto il puntatore, quella a cui si è
  /// arrivati e quelle scelte si perdono. `null` se lo strumento non è lui,
  /// se non c'è niente di scelto o se il calcolo non riesce.
  const builderNow = (): Builder | null => {
    const model = engine.model;
    if (tool !== "builder" || !has("builder") || !editable() || model === null) return null;
    const index = currentIndex();
    const keys = selection.join("\n");
    if (building === null || building.index !== index || building.keys !== keys) {
      const units = selectedUnits();
      const found = units.length === 0 ? null : builderOf(model, units);
      const builder = found === "complex" ? null : found;
      building = { index, keys, builder, complex: found === "complex", inverse: builder === null ? null : invert(builder.matrix) };
      regionHover = -1;
      regionActive = -1;
      regionsChosen = [];
    }
    return building.builder;
  };

  /// Il Costruttore si rifà da capo: lo strumento è cambiato.
  const forgetBuilder = (): void => {
    building = null;
    regionHover = -1;
    regionActive = -1;
    regionsChosen = [];
  };

  /// La regione del Costruttore nel punto `p` della scena, o -1.
  const regionAt = (p: Point): number => {
    const builder = builderNow();
    const inverse = building?.inverse ?? null;
    return builder === null || inverse === null ? -1 : builder.regions.at(apply(inverse, p));
  };

  /// Su che cosa lavora il Costruttore, a parole: quante regioni hanno le
  /// forme scelte, e quanti oggetti scelti non sono forme; o perché niente.
  const builderText = (): string => {
    if (!has("builder") || !editable()) return "";
    if (selection.length === 0) return t("draw.builder.none");
    const builder = builderNow();
    if (builder === null) return t(building?.complex === true ? "draw.builder.complex" : "draw.builder.failed");
    const parts: string[] = [];
    const count = builder.regions.regions.length;
    const shapes = builder.shapes.length;
    if (shapes > 0 && count === 0) parts.push(t("draw.builder.empty"));
    else if (shapes === 1) parts.push(plural(count, "draw.builder.regions.single.one", "draw.builder.regions.single.other"));
    else if (shapes > 1) parts.push(plural(count, "draw.builder.regions.one", "draw.builder.regions.other", { shapes }));
    const others = builder.selected.length - shapes;
    if (others > 0) parts.push(plural(others, "draw.builder.not_shapes.one", "draw.builder.not_shapes.other"));
    return parts.join(" ");
  };

  /// La selezione e, col Costruttore, su che cosa lavora.
  const announcePicked = (): void => {
    const picked = selection.length === 0 ? "" : plural(selection.length, "draw.selected.one", "draw.selected.other");
    announce([picked, builderText()].filter((part) => part !== "").join(" "));
  };

  /// La regione `at` di `builder` a parole: quale, di quante, e le forme che
  /// la coprono, dalla più in alto, che le dà lo stile se la si unisce.
  const regionText = (builder: Builder, at: number): string => {
    const names = [...builder.regions.regions[at]!.cover].reverse().map((k) => labelOf(builder.shapes[k]!));
    const values = {
      index: at + 1,
      total: builder.regions.regions.length,
      shapes: new Intl.ListFormat(resolvedLanguage(), { type: "conjunction" }).format(names),
    };
    return t(regionsChosen.includes(at) ? "draw.builder.region.chosen" : "draw.builder.region", values);
  };

  /// Le regioni del Costruttore, appena segnate. Quella sotto il puntatore
  /// si accende; quelle che il gesto prende e quelle scelte si riempiono, o
  /// con Alt si tratteggiano, perché si tolgono; quella a cui si è arrivati
  /// con Tab ha il bordo spesso. Mentre si scelgono gli oggetti, nessuna.
  const regionHandles = (): OverlayHandle[] => {
    const g = current?.kind === "builder" ? current : null;
    if (g?.mode === "objects") return [];
    const builder = builderNow();
    if (builder === null) return [];
    const taken = new Set(g === null ? regionsChosen : g.dragging ? g.crossed : g.crossed.slice(0, 1));
    return builder.regions.regions.map((region, r): OverlayHandle => {
      const tone: RegionTone = taken.has(r)
        ? g !== null && alt ? "erase" : "chosen"
        : g === null && r === regionHover ? (alt ? "erase" : "hover") : "plain";
      return { kind: "region", segments: region.segments, matrix: builder.matrix, tone, active: r === regionActive };
    });
  };

  /// Il puntatore passa sopra `p` senza premere: col Costruttore la regione
  /// sotto si accende. Il dito non passa: tocca.
  const hoverRegion = (p: Point | null, pointer: InkPointerType): void => {
    const next = p !== null && pointer !== "touch" ? regionAt(p) : -1;
    if (next === regionHover) return;
    regionHover = next;
    showHandles();
  };

  /// Unisce le regioni `chosen` del Costruttore in una forma, con lo stile
  /// della prima, o con `erase` le toglie, in un passo di annulla; e dice
  /// che cosa resta.
  const build = (chosen: readonly number[], erase: boolean): void => {
    const builder = builderNow();
    const model = engine.model;
    if (builder === null || model === null || chosen.length === 0) return;
    const built = buildOps(model, builder, chosen, erase, newIds());
    if ("reason" in built) {
      announce(t(BUILD_REFUSALS[built.reason]));
      return;
    }
    const label: DrawKey = erase ? "draw.action.build_erase" : chosen.length === 1 ? "draw.action.build_separate" : "draw.action.build_merge";
    if (arrange(label, built) === null) return;
    const done = erase
      ? plural(chosen.length, "draw.builder.erased.one", "draw.builder.erased.other")
      : chosen.length === 1 ? t("draw.builder.separated") : plural(chosen.length, "draw.builder.merged.one", "draw.builder.merged.other");
    const removed = built.removed === 0 ? "" : plural(built.removed, "draw.builder.removed.one", "draw.builder.removed.other");
    announce([done, removed, builderText()].filter((part) => part !== "").join(" "));
  };

  /// Il punto `p` del gesto del Costruttore. Il primo decide che cosa fa il
  /// gesto: le regioni, se cade su una senza Maiusc, o gli oggetti. Poi le
  /// regioni che il tratto attraversa si aggiungono, guardate a passi sullo
  /// schermo, e la scia lo segue.
  const builderAdd = (g: BuilderGesture, p: Point): void => {
    if (g.from === null || g.end === null) {
      g.from = p;
      g.end = p;
      g.additive = shift;
      const at = shift ? -1 : regionAt(p);
      g.mode = at >= 0 ? "regions" : "objects";
      if (at >= 0) {
        g.crossed.push(at);
        g.trail.push(p);
      }
      return;
    }
    const last = g.end;
    g.end = p;
    if (!g.dragging && Math.hypot(p[0] - g.from[0], p[1] - g.from[1]) * camera.scale > DRAG_PX[g.pointer]) g.dragging = true;
    if (g.mode !== "regions") return;
    const steps = Math.max(1, Math.ceil((Math.hypot(p[0] - last[0], p[1] - last[1]) * camera.scale) / BUILDER_STEP_PX));
    for (let i = 1; i <= steps; i++) {
      const at = regionAt([last[0] + ((p[0] - last[0]) * i) / steps, last[1] + ((p[1] - last[1]) * i) / steps]);
      if (at >= 0 && !g.crossed.includes(at)) g.crossed.push(at);
    }
    const tail = g.trail[g.trail.length - 1]!;
    if (Math.hypot(p[0] - tail[0], p[1] - tail[1]) * camera.scale < LASSO_STEP_PX) return;
    g.trail.push(p);
    if (g.trail.length > LASSO_MAX_POINTS) {
      const kept = g.trail.filter((_, at) => at % 2 === 0 || at === g.trail.length - 1);
      g.trail.splice(0, g.trail.length, ...kept);
    }
  };

  /// Il riquadro del Costruttore sceglie gli oggetti dentro, come quello
  /// della Selezione; con Maiusc li aggiunge a quelli di prima.
  const builderMarquee = (g: BuilderGesture): void => {
    if (g.from === null || g.end === null) return;
    selection = inOrder([...(g.additive ? g.base : []), ...marqueed(g.from, g.end).map((unit) => unit.key)]);
    syncControls();
  };

  const builderUpdate = (g: BuilderGesture): void => {
    if (g.mode === "objects" && g.dragging) builderMarquee(g);
    showHandles();
  };

  /// Il gesto del Costruttore finisce. Sulle regioni un trascinamento unisce
  /// quelle attraversate e un tocco separa la sua, o con Alt le toglie. Sugli
  /// oggetti il riquadro resta, e un tocco sceglie l'oggetto sotto, o il
  /// vuoto; uno già scelto tiene la selezione com'è, e con Maiusc lo si
  /// toglie.
  const builderEnd = (g: BuilderGesture): void => {
    current = null;
    if (g.mode === "regions") {
      showHandles();
      build(g.dragging ? g.crossed : g.crossed.slice(0, 1), alt);
      return;
    }
    if (g.mode === null || g.from === null) {
      showHandles();
      return;
    }
    if (g.dragging) {
      builderMarquee(g);
    } else {
      const key = currentIndex().at(g.from, HIT_PX[g.pointer] / camera.scale)?.key ?? null;
      if (g.additive) {
        if (key !== null) select(g.base.includes(key) ? g.base.filter((each) => each !== key) : [...g.base, key]);
      } else if (key === null || !g.base.includes(key)) {
        select(key === null ? [] : [key]);
      }
    }
    showHandles();
    announcePicked();
  };

  /// Vero se i tasti valgono per le regioni: il Costruttore ne ha, e la
  /// tastiera non sta premendo.
  const builderKeysOn = (): boolean => tool === "builder" && pressed === null && (builderNow()?.regions.regions.length ?? 0) > 0;

  /// Porta alla regione `at` del Costruttore: la segna col bordo spesso, la
  /// porta in vista e la dice. `false` se non c'è.
  const visitRegion = (at: number): boolean => {
    cancelGesture();
    const builder = builderNow();
    const region = builder?.regions.regions[at];
    if (builder === null || region === undefined) return false;
    regionActive = at;
    frameBounds(mappedBounds({ min: region.min, max: region.max }, builder.matrix));
    showHandles();
    announce(regionText(builder, at));
    return true;
  };

  /// Tab col Costruttore: la regione dopo quella a cui si è, o con Maiusc
  /// quella prima; da nessuna, la prima o l'ultima. Oltre le estremità,
  /// `false`: il Tab esce dal foglio.
  const walkRegions = (step: 1 | -1): boolean => {
    const total = builderNow()?.regions.regions.length ?? 0;
    return visitRegion(regionActive < 0 ? (step > 0 ? 0 : total - 1) : regionActive + step);
  };

  /// Spazio col Costruttore: sceglie la regione a cui si è arrivati, o
  /// quella sotto il cursore, o la lascia se era scelta.
  const pickRegion = (): void => {
    const builder = builderNow();
    if (builder === null) return;
    const at = regionActive >= 0 ? regionActive : regionAt(cursorPoint());
    if (at < 0) {
      announce(t("draw.builder.nowhere"));
      return;
    }
    const lead = at === regionActive ? "" : `${regionText(builder, at)} `;
    regionActive = at;
    const was = regionsChosen.includes(at);
    regionsChosen = was ? regionsChosen.filter((r) => r !== at) : [...regionsChosen, at];
    showHandles();
    announce(`${lead}${t(was ? "draw.builder.unpicked" : "draw.builder.picked", { count: regionsChosen.length })}`);
  };

  /// Invio o Canc col Costruttore: unisce le regioni scelte, o con `erase` le
  /// toglie; senza, fa lo stesso con quella a cui si è arrivati. `false` se
  /// non ce n'è nessuna.
  const buildChosen = (erase: boolean): boolean => {
    const chosen = regionsChosen.length > 0 ? [...regionsChosen] : regionActive >= 0 ? [regionActive] : [];
    if (chosen.length === 0) return false;
    build(chosen, erase);
    return true;
  };

  // --- Le Forbici e il Coltello ------------------------------------------------

  /// Perché la forma `nodable` non si taglia, a parole.
  const uncutText = (nodable: Nodable | NoNodes): DrawKey =>
    typeof nodable === "string" ? NO_NODES[nodable] : nodable.kind === "arrow" ? "draw.scissors.arrow" : "draw.nodes.stroke";

  /// Dove le Forbici tagliano vicino a `p`, un punto della scena: sul
  /// contorno della forma più in alto che vi passa, nel nodo se ci cade.
  /// Altrimenti perché no: la forma sotto non si taglia, o lì non passa un
  /// contorno.
  const cutSpotAt = (p: Point, pointer: InkPointerType): CutSpot | DrawKey => {
    const index = currentIndex();
    const near = NODE_PX[pointer] / camera.scale;
    const reach = HIT_PX[pointer] / camera.scale;
    const around = Math.max(near, reach);
    let refusal: DrawKey | null = null;
    for (let i = index.units.length - 1; i >= 0; i--) {
      const unit = index.units[i]!;
      if (!unit.hits(p, around)) continue;
      const shapes = unit.shapes();
      for (let k = shapes.length - 1; k >= 0; k--) {
        const { leaf, matrix } = shapes[k]!;
        const nodable = nodableAt(leaf);
        if (typeof nodable === "string" || !cuttable(nodable)) {
          if (unit.shapeAt(p, around) === leaf) refusal ??= uncutText(nodable);
          continue;
        }
        const node = nodeAt(nodable.subs, matrix, p, near);
        if (node !== null) {
          const [s, at] = parseKey(node);
          return { unit, leaf, nodable, matrix, spot: nodeSpot(nodable.subs, s, at), node, at: apply(matrix, nodable.subs[s]!.nodes[at]!) };
        }
        const spot = linkAt(nodable.subs, matrix, p, reach);
        if (spot !== null) {
          const { from, curve } = curveAt(nodable.subs[spot.sub]!, spot.link);
          return { unit, leaf, nodable, matrix, spot, node: null, at: apply(matrix, pointAt(from, curve, spot.t)) };
        }
      }
    }
    return refusal ?? "draw.scissors.miss";
  };

  /// Dove tagliano le Forbici, a parole: il nodo o il contorno, e di quale
  /// oggetto.
  const cutSpotText = (found: CutSpot): string => {
    const name = labelOf(found.unit);
    if (found.node === null) return t("draw.scissors.cursor.edge", { name });
    const [s, at] = parseKey(found.node);
    const before = found.nodable.subs.slice(0, s).reduce((sum, sub) => sum + sub.nodes.length, 0);
    return t("draw.scissors.cursor.node", { index: before + at + 1, name });
  };

  /// Il puntatore, o il cursore della tastiera, passa sopra `p` senza
  /// premere: con le Forbici si vede dove taglierebbero. Il dito non passa:
  /// tocca.
  const hoverCut = (p: Point | null, pointer: InkPointerType): void => {
    let next: typeof cutHover = null;
    if (p !== null && pointer !== "touch" && tool === "scissors" && has("scissors") && editable()) {
      const found = cutSpotAt(p, pointer);
      if (typeof found !== "string") next = { index: currentIndex(), spot: found };
    }
    if (next === null && cutHover === null) return;
    cutHover = next;
    showHandles();
  };

  /// Le Forbici sopra un contorno: il contorno e i nodi della forma, più
  /// tenui, e la croce dove tagliano. Il Coltello: la sua scia, o con Alt la
  /// linea dritta dal primo punto.
  const cutHandles = (): OverlayHandle[] => {
    const g = current?.kind === "cut" ? current : null;
    if (g !== null) {
      if (!g.dragging || g.from === null || g.end === null) return [];
      return [{ kind: "trail", points: alt ? [g.from, g.end] : [...g.trail, g.end] }];
    }
    const hovered = cutHover;
    if (hovered === null || tool !== "scissors" || hovered.index !== currentIndex()) return [];
    const { nodable, matrix, at } = hovered.spot;
    const out: OverlayHandle[] = [{ kind: "outline", segments: writeNodes(nodable.subs), matrix, hint: true }];
    for (const sub of nodable.subs) {
      sub.nodes.forEach((node, k) => {
        const [x, y] = apply(matrix, node);
        out.push({ kind: "node", x, y, shape: NODE_SHAPES[innerNode(sub, k) ? kindOf(sub, k) : "corner"], selected: false, hint: true });
      });
    }
    out.push({ kind: "cross", x: at[0], y: at[1] });
    return out;
  };

  /// Il punto `p` del gesto delle Forbici: oltre la soglia del trascinamento
  /// è il Coltello, e la scia lo segue.
  const cutAdd = (g: CutGesture, p: Point): void => {
    if (g.from === null) {
      g.from = p;
      g.end = p;
      g.trail.push(p);
      return;
    }
    g.end = p;
    if (!g.dragging && Math.hypot(p[0] - g.from[0], p[1] - g.from[1]) * camera.scale > DRAG_PX[g.pointer]) g.dragging = true;
    const tail = g.trail[g.trail.length - 1]!;
    if (Math.hypot(p[0] - tail[0], p[1] - tail[1]) * camera.scale < LASSO_STEP_PX) return;
    g.trail.push(p);
    if (g.trail.length > LASSO_MAX_POINTS) {
      const kept = g.trail.filter((_, at) => at % 2 === 0 || at === g.trail.length - 1);
      g.trail.splice(0, g.trail.length, ...kept);
    }
  };

  /// Il gesto delle Forbici finisce: un tocco taglia dove tocca, un
  /// trascinamento è il Coltello.
  const cutEnd = (g: CutGesture): void => {
    current = null;
    if (g.from === null || g.end === null) {
      showHandles();
      return;
    }
    if (g.dragging) {
      const tail = g.trail[g.trail.length - 1]!;
      const points = alt ? [g.from, g.end] : tail[0] === g.end[0] && tail[1] === g.end[1] ? [...g.trail] : [...g.trail, g.end];
      showHandles();
      knife(points);
      return;
    }
    const found = cutSpotAt(g.from, g.pointer);
    showHandles();
    if (typeof found === "string") announce(t(found));
    else snip(found);
  };

  /// Le Forbici tagliano in `found`, in un passo di annulla: ogni pezzo
  /// diventa un oggetto, e i pezzi sono la selezione. Di una forma in un
  /// gruppo, il gruppo.
  const snip = (found: CutSpot): void => {
    const model = engine.model;
    if (model === null) return;
    const cut = cutAt(found.nodable.subs, [found.spot]);
    if (cut === null) {
      announce(t("draw.scissors.end"));
      return;
    }
    const written = dsOf(piecesOf(cut));
    if (written === null) {
      announce(t("draw.unchanged"));
      return;
    }
    const plan = new Plan(model, newIds());
    const node = nodeOf(model, { path: pathOf(found.leaf) });
    const keys = writePieces(plan, node, written);
    if (keys === null) {
      announce(t("draw.nodes.unwritable"));
      return;
    }
    const picked = found.unit.node === found.leaf ? keys : [plan.keyOf(found.unit.node, found.unit.key)];
    if (arrange("draw.action.scissors", plan.finish(picked)) === null) return;
    announce(written.length === 1 ? t("draw.scissors.opened") : t("draw.scissors.split", { count: written.length }));
  };

  /// Il Coltello lungo `points`, una spezzata della scena, in un passo di
  /// annulla: divide le forme chiuse che attraversa da parte a parte e
  /// taglia i tracciati aperti dove li incrocia. Taglia gli oggetti scelti,
  /// o senza selezione quelli che attraversa; i pezzi sono la selezione
  /// dopo, e di una forma in un gruppo il gruppo.
  const knife = (points: readonly Point[]): void => {
    const model = engine.model;
    if (model === null || points.length < 2) return;
    const blade: Subpath[] = [{ nodes: [...points], links: points.slice(1).map((): Link => ({ kind: "line" })), closed: false }];
    const reach = new BoundsBuilder();
    for (const p of points) reach.include(p);
    const box = reach.finish()!;
    const units = selection.length > 0
      ? selectedUnits()
      : currentIndex().units.filter(({ bounds }) => bounds !== null && bounds.max[0] >= box.min[0] && bounds.min[0] <= box.max[0] && bounds.max[1] >= box.min[1] && bounds.min[1] <= box.max[1]);
    const plan = new Plan(model, newIds());
    const picked: string[] = [];
    let objects = 0;
    let pieces = 0;
    let skipped = 0;
    for (const unit of units) {
      let inside = false;
      for (const { leaf, matrix } of unit.shapes()) {
        const inverse = invert(matrix);
        if (inverse === null) continue;
        const local = mapSubs(blade, inverse);
        const nodable = nodableAt(leaf);
        if (typeof nodable === "string") {
          if (unit.node === leaf && points.some((p, k) => k > 0 && unit.touches(points[k - 1]!, p, 0))) skipped++;
          continue;
        }
        if (!cuttable(nodable)) {
          if (crossings(nodable.subs, local).length > 0) skipped++;
          continue;
        }
        const written = knifePieces(nodable.subs, local);
        if (written === null) continue;
        const node = nodeOf(model, { path: pathOf(leaf) });
        // Una forma che non si riscrive si prova prima a parte: le sue
        // operazioni a metà non entrano nel passo delle altre.
        if (writePieces(new Plan(model, newIds()), node, written) === null) {
          skipped++;
          continue;
        }
        const keys = writePieces(plan, node, written)!;
        objects++;
        pieces += written.length;
        if (unit.node === leaf) picked.push(...keys);
        else inside = true;
      }
      if (inside) picked.push(plan.keyOf(unit.node, unit.key));
    }
    const rest = skipped === 0 ? "" : ` ${plural(skipped, "draw.knife.skipped.one", "draw.knife.skipped.other")}`;
    if (objects === 0) {
      announce(`${t("draw.knife.none")}${rest}`);
      return;
    }
    if (arrange("draw.action.knife", plan.finish(picked)) === null) return;
    announce(`${plural(objects, "draw.knife.cut.one", "draw.knife.cut.other", { pieces })}${rest}`);
  };

  // --- I gesti dei nodi --------------------------------------------------------

  /// Quanti nodi ha il tracciato.
  const nodeCount = (subs: readonly Subpath[]): number => subs.reduce((count, sub) => count + sub.nodes.length, 0);

  /// Dove sta il nodo `key` della forma `edit`, nella scena.
  const nodePoint = (edit: Editing, key: NodeKey): Point => {
    const [s, at] = parseKey(key);
    return apply(edit.matrix, edit.subs[s]!.nodes[at]!);
  };

  /// Il nome a parole della forma `edit`: quello del suo oggetto, se è lui;
  /// altrimenti il suo, come nell'albero.
  const shapeLabel = (edit: Editing): string => {
    const node = samePath(edit.unit.path, edit.path) ? undefined : outlineNow().byKey.get(keyOf({ id: edit.leaf.facts.id, path: edit.path }));
    return node === undefined ? labelOf(edit.unit) : describeNode(node, undefined);
  };

  /// Il nodo `key` della forma `edit` a parole: quale, di che tipo e dove;
  /// con più forme, prima la forma.
  const nodeText = (edit: Editing, key: NodeKey): string => {
    const [s, at] = parseKey(key);
    let index = at + 1;
    for (let i = 0; i < s; i++) index += edit.subs[i]!.nodes.length;
    const sub = edit.subs[s]!;
    const end = !sub.closed && (at === 0 || at === sub.nodes.length - 1);
    const [x, y] = nodePoint(edit, key);
    const values = { index, count: nodeCount(edit.subs), kind: t(KIND_NAMES[end ? "end" : kindsOf(edit)(s, at)]), x: coordText(x), y: coordText(y) };
    return edits.length > 1 ? t("draw.nodes.walk_in", { ...values, object: shapeLabel(edit) }) : t("draw.nodes.walk", values);
  };

  /// Di che cosa si modificano i nodi, o perché di niente; vuoto se non
  /// c'è niente di scelto.
  const targetText = (): string => {
    resolveNodes();
    if (edits.length === 0) return noEditing === null ? "" : t(noEditing);
    const count = edits.reduce((sum, edit) => sum + nodeCount(edit.subs), 0);
    const objects = editedUnits().length;
    if (objects > 1) return plural(count, "draw.nodes.shown_in.one", "draw.nodes.shown_in.other", { objects });
    return plural(count, "draw.nodes.shown.one", "draw.nodes.shown.other", { object: labelOf(edits[0]!.unit) });
  };

  /// Dice di che cosa si modificano i nodi; senza niente di scelto, la
  /// selezione.
  const announceTarget = (): void => {
    const text = targetText();
    if (text === "") announceSelection();
    else announce(text);
  };

  /// I nodi scelti a parole: quello solo, o quanti, e di quanti oggetti se
  /// sono di più d'uno; con `lead` prima.
  const announceNodes = (lead = ""): void => {
    const chosen = chosenEdits();
    const count = chosenCount();
    const objects = new Set(chosen.map((edit) => edit.unit.key)).size;
    const text = count === 1
      ? nodeText(chosen[0]!, [...pickedIn(chosen[0]!)][0]!)
      : count === 0
        ? t("draw.nodes.selected.none")
        : objects > 1
          ? plural(count, "draw.nodes.selected_in.one", "draw.nodes.selected_in.other", { objects })
          : plural(count, "draw.nodes.selected.one", "draw.nodes.selected.other");
    announce(lead === "" ? text : `${lead} ${text}`);
  };

  /// Ritrova le forme, e se sono cambiate rifà le barre.
  const refreshNodes = (): void => {
    if (resolveNodes()) syncArrange();
  };

  /// I nodi di `pick`, per forma, diventano quelli scelti: di una forma che
  /// non si modifica, o che non li ha, nessuno.
  const setNodes = (pick: ReadonlyMap<string, Iterable<NodeKey>>): void => {
    refreshNodes();
    const next = new Map<string, ReadonlySet<NodeKey>>();
    for (const edit of edits) {
      const keys = pick.get(edit.key);
      const present = keys === undefined ? [] : presentNodes(edit.subs, keys);
      if (present.length > 0) next.set(edit.key, new Set(present));
    }
    nodeSelection = next;
    syncNodesBar();
    showHandles();
  };

  /// Soltanto i nodi `keys` della forma `edit`.
  const pickOf = (edit: Editing, keys: Iterable<NodeKey>): ReadonlyMap<string, Iterable<NodeKey>> => new Map([[edit.key, keys]]);

  /// Si modificano soltanto i nodi della forma `edit`, e il suo oggetto è il
  /// solo scelto, come con la Selezione diretta di Illustrator.
  const narrowTo = (edit: Editing): void => {
    if (edits.length === 1 && selection.length === 1) return;
    focused = [edit.path];
    select([edit.unit.key]);
  };

  /// La modifica `edited` dei nodi della forma `edit`, coi tipi dati portati
  /// dove vanno i nodi.
  const changeOf = (edit: Editing, edited: Edited): NodeChange => ({
    edit,
    subs: edited.subs,
    selected: edited.selected,
    kinds: remapped(nodeKinds.get(edit.key) ?? NO_KINDS, edited.moved),
    moved: edited.moved,
    changed: edited.changed,
  });

  /// Lo spostamento da `a` a `b`, due punti della scena, nelle coordinate
  /// della forma `edit`.
  const localDelta = (edit: Editing, a: Point, b: Point): Point => {
    const p = apply(edit.inverse, a);
    const q = apply(edit.inverse, b);
    return [q[0] - p[0], q[1] - p[1]];
  };

  /// Il nodo o la maniglia sotto `p`, fra le forme `among`: il più vicino
  /// entro il raggio del puntatore; a pari distanza la forma più in alto, e
  /// nella stessa forma il nodo.
  const grabAt = (
    among: readonly Editing[],
    p: Point,
    pointer: InkPointerType,
  ): { readonly edit: Editing; readonly node: NodeKey } | { readonly edit: Editing; readonly handle: HandleRef; readonly at: Point } | null => {
    const tolerance = NODE_PX[pointer] / camera.scale;
    const gap = (q: Point): number => Math.hypot(q[0] - p[0], q[1] - p[1]);
    let best: ReturnType<typeof grabAt> = null;
    let nearest = Infinity;
    for (let i = among.length - 1; i >= 0; i--) {
      const edit = among[i]!;
      const node = nodeAt(edit.subs, edit.matrix, p, tolerance);
      if (node !== null && gap(nodePoint(edit, node)) < nearest) {
        best = { edit, node };
        nearest = gap(nodePoint(edit, node));
      }
      const spot = handleAt(shownHandles(edit), edit.matrix, p, tolerance);
      const at = spot === null ? null : apply(edit.matrix, spot.point);
      if (spot !== null && gap(at!) < nearest) {
        best = { edit, handle: spot.handle, at: at! };
        nearest = gap(at!);
      }
    }
    return best;
  };

  /// Le forme come le lascia il trascinamento, sul foglio e nei nodi: la
  /// freccia con la sua punta, il tratto col contorno del pennello.
  const showNodeDraft = (draft: ReadonlyMap<string, readonly Subpath[]>): void => {
    const paths = new Map<PaintNode, string>();
    for (const [key, subs] of draft) {
      const edit = editOf(key);
      const d = edit === undefined ? null : draftOf(edit.nodable, subs);
      if (d !== null) for (const paint of edit!.paints) paths.set(paint, d);
    }
    painter.setDraft(paths.size === 0 ? null : { paths });
    showHandles();
  };

  /// Tutti i nodi della forma `edit` scelti, e presi per trascinarli
  /// insieme: con Maiusc in aggiunta; senza, al posto degli altri. Se lo
  /// sono già tutti, si trascinano con gli altri scelti, e un tocco lascia
  /// soltanto loro.
  const grabAll = (g: NodesGesture, edit: Editing): void => {
    const keys = allNodes(edit.subs);
    const all = pickedIn(edit).size === keys.length;
    if (shift) setNodes(adding(nodeSelection, edit.key, keys));
    else if (!all) {
      narrowTo(edit);
      setNodes(pickOf(edit, keys));
    }
    const alone = !shift && all && (chosenCount() > keys.length || edits.length > 1) ? keys : null;
    g.grab = { kind: "node", shape: edit.key, key: keys[0]!, origin: nodePoint(edit, keys[0]!), toggle: false, alone, pull: false };
  };

  /// Ciò che `p` prende delle forme `among`: un nodo, che si sceglie e si
  /// potrà trascinare, e con Maiusc si aggiunge o si toglie, o con Alt
  /// tirarne fuori le maniglie; una maniglia, con Alt da sola, o un
  /// segmento da trascinare. L'asta di una freccia non si piega: si porta
  /// coi suoi due capi. Falso se `p` non prende niente.
  const grabOn = (g: NodesGesture, p: Point, among: readonly Editing[] = edits): boolean => {
    const hit = grabAt(among, p, g.pointer);
    const tolerance = HIT_PX[g.pointer] / camera.scale;
    if (hit !== null && "node" in hit) {
      const { edit, node } = hit;
      const chosen = pickedIn(edit).has(node);
      if (!chosen && shift) setNodes(adding(nodeSelection, edit.key, [node]));
      else if (!chosen) {
        narrowTo(edit);
        setNodes(pickOf(edit, [node]));
      }
      const alone = !shift && chosen && (chosenCount() > 1 || edits.length > 1) ? [node] : null;
      g.grab = { kind: "node", shape: edit.key, key: node, origin: nodePoint(edit, node), toggle: shift && chosen, alone, pull: alt && !shift };
      return true;
    }
    if (hit !== null) {
      // La maniglia di una linea sta sulla linea, a un terzo da un capo:
      // toccarla è toccare la linea lì.
      const { edit, handle } = hit;
      let segment: { readonly sub: number; readonly link: number; readonly t: number } | null = null;
      if (edit.subs[handle.sub]!.links[handle.link]!.kind === "line") {
        const link = linkAt(edit.subs, edit.matrix, p, tolerance);
        segment = link !== null && link.sub === handle.sub && link.link === handle.link ? link : { sub: handle.sub, link: handle.link, t: handle.which === "c1" ? 1 / 3 : 2 / 3 };
      }
      g.grab = { kind: "handle", shape: edit.key, handle, origin: hit.at, alone: alt && handle.which !== "control", segment };
      return true;
    }
    for (let i = among.length - 1; i >= 0; i--) {
      const edit = among[i]!;
      const link = linkAt(edit.subs, edit.matrix, p, tolerance);
      if (link === null) continue;
      if (edit.nodable.kind === "arrow") grabAll(g, edit);
      else g.grab = { kind: "segment", shape: edit.key, sub: link.sub, link: link.link, t: link.t };
      return true;
    }
    return false;
  };

  /// Il primo punto di un gesto dei nodi: un nodo, una maniglia o un
  /// segmento delle forme che si modificano (vedi [`grabOn`]). Dentro una di
  /// loro, lontano da nodi e segmenti, si scelgono tutti i suoi nodi, che si
  /// trascinano insieme, come con la Selezione diretta di Illustrator.
  /// Un'altra forma prende il posto di quelle che si modificano, o con Maiusc
  /// si aggiunge, e il punto prende subito ciò che tocca dei suoi nodi, allo
  /// stesso modo; una forma senza nodi sceglie il suo oggetto, e il tocco
  /// dice perché. Il vuoto comincia un riquadro.
  const nodesStart = (g: NodesGesture, p: Point): void => {
    g.from = p;
    g.end = p;
    if (grabOn(g, p)) return;
    const tolerance = HIT_PX[g.pointer] / camera.scale;
    const unit = currentIndex().at(p, tolerance);
    const shape = unit?.shapeAt(p, tolerance) ?? null;
    if (unit === null || shape === null) {
      g.grab = { kind: "marquee", additive: shift };
      return;
    }
    const path = pathOf(shape);
    const inside = edits.find((edit) => samePath(edit.path, path));
    if (inside !== undefined) {
      grabAll(g, inside);
      return;
    }
    const nodable = nodableAt(shape);
    g.grab = { kind: "none" };
    if (typeof nodable === "string") {
      g.missed = NO_NODES[nodable];
      if (shift) select([...selection, unit.key]);
      else if (selection.length !== 1 || selection[0] !== unit.key) {
        focused = focused.filter((each) => holdsPath(unit.path, each));
        select([unit.key]);
      }
      return;
    }
    focused = shift ? [...edits.map((edit) => edit.path), path] : [path];
    select(shift ? [...selection, unit.key] : [unit.key]);
    const next = edits.find((edit) => samePath(edit.path, path));
    if (next === undefined) g.missed = "draw.nodes.flat";
    else if (!grabOn(g, p, [next])) grabAll(g, next);
  };

  /// Il riquadro dei nodi da `from` a `end`: sceglie i nodi che racchiude,
  /// di tutte le forme del disegno che ne hanno, e con loro i loro oggetti;
  /// un oggetto senza nodi, se lo racchiude tutto. Con `additive` aggiunge a
  /// ciò che era scelto prima del gesto `g`. Sul foglio girato di traverso
  /// vale ciò che si vede dentro il rettangolo dello schermo.
  const marqueeNodes = (g: NodesGesture, from: Point, end: Point, additive: boolean): void => {
    const slanted = slantedMarquee(from, end);
    let area = boxAround(from, end);
    if (slanted !== null) {
      const box = new BoundsBuilder();
      for (const corner of slanted.corners) box.include(corner);
      area = box.finish()!;
    }
    const view = viewMatrix(camera);
    const keys = additive ? [...g.selection] : [];
    const shapes = additive ? [...g.shapes] : [];
    const pick = new Map<string, Set<NodeKey>>();
    if (additive) for (const [key, chosen] of g.nodes) pick.set(key, new Set(chosen));
    for (const unit of currentIndex().units) {
      const bounds = unit.bounds;
      if (bounds === null || bounds.max[0] < area.min[0] || bounds.min[0] > area.max[0] || bounds.max[1] < area.min[1] || bounds.min[1] > area.max[1]) continue;
      for (const shape of unit.shapes()) {
        const nodable = nodableAt(shape.leaf);
        if (typeof nodable === "string") continue;
        const within = slanted === null
          ? nodesWithin(nodable.subs, shape.matrix, area)
          : nodesWithin(nodable.subs, compose(view, shape.matrix), slanted.screen);
        if (within.length === 0) continue;
        const path = pathOf(shape.leaf);
        const key = path.join(".");
        keys.push(unit.key);
        shapes.push(path);
        const chosen = pick.get(key) ?? new Set<NodeKey>();
        for (const node of within) chosen.add(node);
        pick.set(key, chosen);
      }
    }
    for (const unit of marqueed(from, end)) keys.push(unit.key);
    focused = shapes;
    selection = inOrder(keys);
    syncControls();
    setNodes(pick);
  };

  /// I nodi `keys` portati da `moved` dove sono finiti, se una modifica ne
  /// ha aggiunti.
  const movedKeys = (keys: Iterable<NodeKey>, moved: ReadonlyMap<NodeKey, NodeKey> | null): ReadonlySet<NodeKey> =>
    new Set(moved === null ? keys : [...keys].flatMap((key) => {
      const to = moved.get(key);
      return to === undefined ? [] : [to];
    }));

  /// I nodi della forma `edit` con la maniglia presa dove il trascinamento
  /// `g` la porta. Quella di una linea o di un arco diventa prima vera, e
  /// con lei l'arco dall'altra parte di un nodo liscio ([`realizeHandle`]).
  /// Con Alt la maniglia si sposta da sola, e il suo nodo diventa uno
  /// spigolo.
  const dragHandle = (g: NodesGesture, edit: Editing, grab: Extract<NodeGrab, { readonly kind: "handle" }>): Subpath[] => {
    const was = kindsOf(edit);
    const owner = handleNode(edit.subs[grab.handle.sub]!, grab.handle);
    const smooth = !grab.alone && grab.handle.which !== "control" && was(grab.handle.sub, owner) !== "corner";
    const real = realizeHandle(edit.subs, grab.handle, smooth);
    const given = nodeKinds.get(edit.key) ?? NO_KINDS;
    const kinds = real.moved === null ? new Map(given) : remapped(given, real.moved);
    if (grab.alone) {
      const s = real.handle.sub;
      const at = handleNode(real.subs[s]!, real.handle);
      if (innerNode(real.subs[s]!, at)) kinds.set(nodeKey(s, at), "corner");
    }
    g.reshaped = { shape: edit.key, chosen: movedKeys(pickedIn(edit), real.moved), kinds, moved: real.moved };
    return moveHandle(real.subs, real.handle, apply(edit.inverse, nodeDragTo(g, grab)), kindsOf(edit, real.subs, kinds));
  };

  /// I nodi della forma `edit` con le maniglie del nodo preso tirate fuori
  /// fin dove il trascinamento `g` porta il puntatore, come con lo strumento
  /// Punto di ancoraggio di Illustrator: i segmenti ai suoi lati diventano
  /// cubiche ([`openNode`]), quella dal lato verso cui il trascinamento
  /// comincia segue il puntatore e l'altra le sta opposta, e il nodo
  /// diventa simmetrico. `null` se il nodo non ha segmenti.
  const pullFrom = (g: NodesGesture, edit: Editing, grab: Extract<NodeGrab, { readonly kind: "node" }>): Subpath[] | null => {
    const opened = openNode(edit.subs, grab.key);
    const to = apply(edit.inverse, nodeDragTo(g, grab));
    const [s, at] = parseKey(opened.key);
    const node = opened.subs[s]!.nodes[at]!;
    g.side ??= pullSide(opened.subs, opened.key, [to[0] - node[0], to[1] - node[1]]);
    if (g.side === null) return null;
    const given = nodeKinds.get(edit.key) ?? NO_KINDS;
    const kinds = opened.moved === null ? new Map(given) : remapped(given, opened.moved);
    if (innerNode(opened.subs[s]!, at)) kinds.set(opened.key, "symmetric");
    g.reshaped = { shape: edit.key, chosen: movedKeys(pickedIn(edit), opened.moved), kinds, moved: opened.moved };
    return pullHandles(opened.subs, opened.key, g.side, to);
  };

  /// Il gesto dei nodi fino al punto di adesso. Oltre la soglia trascina: un
  /// nodo con quelli scelti di ogni forma, e con l'aggancio il nodo preso
  /// sulla griglia; le maniglie tirate fuori da un nodo preso con Alt; una
  /// maniglia; o il segmento, nel punto preso. Il riquadro sceglie.
  const nodesUpdate = (g: NodesGesture): void => {
    const grab = g.grab;
    if (g.from === null || g.end === null || grab === null || grab.kind === "none") return;
    if (!g.dragging) {
      if (Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * camera.scale <= DRAG_PX[g.pointer]) return;
      if (grab.kind === "node" && grab.pull && editOf(grab.shape)?.nodable.kind === "arrow") {
        // L'asta di una freccia non si piega: non ha maniglie da tirare.
        g.grab = { kind: "none" };
        g.missed = "draw.nodes.arrow";
        return;
      }
      g.dragging = true;
      lastSegmentTap = null;
    }
    if (grab.kind === "marquee") {
      marqueeNodes(g, g.from, g.end, grab.additive);
      return;
    }
    const edit = editOf(grab.shape);
    if (edit === undefined) return;
    const draft = new Map<string, readonly Subpath[]>();
    if (grab.kind === "segment") {
      draft.set(edit.key, bend(edit.subs, grab.sub, grab.link, grab.t, localDelta(edit, g.from, g.end), kindsOf(edit)));
    } else if (grab.kind === "handle") {
      draft.set(edit.key, dragHandle(g, edit, grab));
    } else if (grab.pull) {
      const pulled = pullFrom(g, edit, grab);
      if (pulled !== null) draft.set(edit.key, pulled);
    } else {
      const to = nodeDragTo(g, grab);
      for (const each of chosenEdits()) draft.set(each.key, moveNodes(each.subs, pickedIn(each), localDelta(each, grab.origin, to), kindsOf(each)));
    }
    g.draft = draft;
    showNodeDraft(draft);
  };

  /// Il gesto dei nodi finisce. Un trascinamento si scrive, in un passo
  /// solo per tutte le forme; un tocco su un nodo lo sceglie da solo, o con
  /// Maiusc lo toglie; uno su un segmento sceglie i suoi due nodi, e il
  /// doppio tocco ci aggiunge un nodo; uno sul vuoto toglie la scelta dei
  /// nodi, poi quella degli oggetti. Se le forme che si modificano sono
  /// cambiate, si dicono prima dei nodi scelti.
  const nodesEnd = (g: NodesGesture, time: number): void => {
    const note = snapNote();
    current = null;
    const grab: NodeGrab = g.grab ?? { kind: "none" };
    const lead = (): string => {
      resolveNodes();
      return shapesKey(g.shapes) === shapesKey(edits.map((edit) => edit.path)) ? "" : targetText();
    };
    if (g.dragging) {
      if (grab.kind === "marquee") {
        showHandles();
        if (edits.length === 0) announceTarget();
        else announceNodes(lead());
        return;
      }
      painter.setDraft(null);
      const changes = [...(g.draft ?? [])].flatMap(([key, subs]): NodeChange[] => {
        const edit = editOf(key);
        if (edit === undefined) return [];
        const reshaped = g.reshaped?.shape === key ? g.reshaped : null;
        if (reshaped === null) return [{ edit, subs, selected: pickedIn(edit), kinds: nodeKinds.get(key) ?? NO_KINDS }];
        return [{ edit, subs, selected: reshaped.chosen, kinds: reshaped.kinds, ...(reshaped.moved === null ? {} : { moved: reshaped.moved }) }];
      });
      if (changes.length === 0) {
        showHandles();
        return;
      }
      const pulled = grab.kind === "node" && grab.pull;
      const label: DrawKey = pulled
        ? "draw.action.handles_pull"
        : grab.kind === "node" ? "draw.action.nodes_move" : grab.kind === "handle" ? "draw.action.handle" : "draw.action.bend";
      // Ciò che si dice si legge dai nodi di prima.
      const said: DrawKey = grab.kind === "handle" ? handleText(grab) : pulled ? pullText(grab) : "draw.nodes.bent";
      if (writeEdits(label, changes)?.written !== true) return;
      if (grab.kind === "node" && !pulled) announceMoved(note);
      else announce(afterEdit(noted(t(said), note)));
      return;
    }
    switch (grab.kind) {
      case "node": {
        const edit = editOf(grab.shape);
        if (edit !== undefined && grab.toggle) setNodes(removing(nodeSelection, grab.shape, grab.key));
        else if (edit !== undefined && grab.alone !== null) {
          narrowTo(edit);
          setNodes(pickOf(edit, grab.alone));
        }
        announceNodes(lead());
        return;
      }
      case "segment":
        tapSegment(g, grab.shape, grab, time, lead);
        return;
      case "marquee":
        if (grab.additive) return;
        if (chosenCount() > 0) {
          setNodes(new Map());
          announceNodes();
        } else {
          select([]);
          announceSelection();
        }
        return;
      case "none":
        if (g.missed !== null && edits.length > 0) announce(t(g.missed));
        else announceTarget();
        return;
      case "handle":
        if (grab.segment !== null) tapSegment(g, grab.shape, grab.segment, time, lead);
        return;
    }
  };

  /// Un tocco del gesto `g` sul punto `at` di un segmento della forma
  /// `shape`: sceglie i due nodi del segmento, con Maiusc in aggiunta; il
  /// doppio tocco ci aggiunge un nodo. `lead` dice le forme, se sono
  /// cambiate.
  const tapSegment = (
    g: NodesGesture,
    shape: string,
    at: { readonly sub: number; readonly link: number; readonly t: number },
    time: number,
    lead: () => string,
  ): void => {
    const edit = editOf(shape);
    if (edit === undefined || g.from === null) return;
    const tap = { shape, sub: at.sub, link: at.link, time, at: g.from };
    const previous = lastSegmentTap;
    lastSegmentTap = tap;
    const again = previous !== null && previous.shape === tap.shape && previous.sub === tap.sub && previous.link === tap.link &&
      tap.time - previous.time <= DOUBLE_TAP_MS && Math.hypot(tap.at[0] - previous.at[0], tap.at[1] - previous.at[1]) * camera.scale <= DOUBLE_TAP_PX[g.pointer];
    if (again) {
      lastSegmentTap = null;
      const done = writeEdits("draw.action.nodes_insert", [changeOf(edit, insertNode(edit.subs, at.sub, at.link, at.t))]);
      if (done?.written === true) announce(afterEdit(plural(done.count, "draw.nodes.inserted.one", "draw.nodes.inserted.other")));
      return;
    }
    const sub = edit.subs[at.sub]!;
    const ends = [nodeKey(at.sub, at.link), nodeKey(at.sub, (at.link + 1) % sub.nodes.length)];
    if (shift) setNodes(adding(nodeSelection, edit.key, ends));
    else {
      narrowTo(edit);
      setNodes(pickOf(edit, ends));
    }
    announceNodes(lead());
  };

  /// Ciò che si dice di una maniglia trascinata, dai nodi di prima: tirata
  /// fuori da una linea o dal suo nodo, spostata da sola da un nodo che non
  /// era uno spigolo, o spostata.
  const handleText = (grab: Extract<NodeGrab, { readonly kind: "handle" }>): DrawKey => {
    const edit = editOf(grab.shape);
    if (edit === undefined || grab.handle.which === "control") return "draw.nodes.handle_moved";
    const sub = edit.subs[grab.handle.sub]!;
    const at = handleNode(sub, grab.handle);
    const link = sub.links[grab.handle.link]!;
    if (grab.alone && innerNode(sub, at) && kindsOf(edit)(grab.handle.sub, at) !== "corner") return "draw.nodes.handle_alone";
    if (link.kind === "line" || (link.kind === "cubic" && samePlace(link[grab.handle.which], sub.nodes[at]!))) return "draw.nodes.handle_out";
    return "draw.nodes.handle_moved";
  };

  /// Ciò che si dice delle maniglie tirate da un nodo: di un nodo in mezzo,
  /// che è diventato simmetrico; di un capo, che ne ha una sola.
  const pullText = (grab: Extract<NodeGrab, { readonly kind: "node" }>): DrawKey => {
    const edit = editOf(grab.shape);
    if (edit === undefined) return "draw.nodes.handle_out";
    const [s, at] = parseKey(grab.key);
    return innerNode(edit.subs[s]!, at) ? "draw.nodes.pulled" : "draw.nodes.handle_out";
  };

  const eraseAlong = (g: EraseGesture, p: Point): void => {
    const from = g.last ?? p;
    g.last = p;
    for (const unit of currentIndex().along(from, p, ERASER_PX[g.pointer] / camera.scale)) g.marked.set(unit.key, unit);
  };

  const showErased = (g: EraseGesture): void => {
    const faded = new Set<PaintNode>();
    const fadedContainers = new Set<object>();
    for (const unit of g.marked.values()) {
      for (const paint of unit.paints) faded.add(paint);
      if (unit.node.kind === "container") fadedContainers.add(unit.node);
    }
    painter.setDraft(faded.size === 0 && fadedContainers.size === 0 ? null : { faded, fadedContainers });
  };

  /// Il tratto del gesto `g` entra nel disegno, sottile alla fine se non
  /// continua in un altro. Torna il suo id e il livello che l'ha ricevuto;
  /// `null` se non è entrato.
  const writeInk = (g: InkGesture, split: boolean): { readonly id: string; readonly to: Destination } | null => {
    // Il livello di adesso: mentre il gesto durava, il disegno può essere
    // cambiato.
    const to = target(g.ids);
    if (to === null) return null;
    const local = sameDestination(to, g.to) ? g.local : g.scene.map((sample) => toLocal(sample, to.inverse));
    let brush = g.brush;
    if (split) brush = { ...brush, taperEnd: 0 };
    let ink;
    let outline;
    try {
      ink = quantizeInk(local);
      outline = pf1Outline(ink, brush);
    } catch {
      announce(t("draw.ink_failed"));
      return null;
    }
    if (outline.length === 0) return null;
    const bounds = new BoundsBuilder();
    for (const point of outline) bounds.include(apply(to.matrix, point));
    const id = g.ids.next("object");
    const at = new Date(performance.timeOrigin + g.began).toISOString();
    const ops: Op[] = [...to.prelude, addOp(to, strokeElem(id, g.color, brush, ink, at, g.tool))];
    const page = pageFor(scene.root.page, bounds.finish());
    if (page !== null) ops.push({ op: "page", viewBox: page });
    return commit(g.tool === "highlighter" ? "draw.action.highlight" : "draw.action.stroke", asGesture(ops)) === null ? null : { id, to };
  };

  const finishInk = (g: InkGesture, stroke: FinishedStroke): void => {
    if (writeInk(g, stroke.split) !== null) announce(`${t(g.tool === "highlighter" ? "draw.added.highlight" : "draw.added.stroke")} ${objects()}`);
  };

  // --- Le forme dal tratto ---------------------------------------------------
  //
  // Un tratto a penna tenuto fermo alla fine per mezzo secondo diventa la
  // forma a cui somiglia (`recognize.ts`), e lo si dice. Finché il puntatore
  // resta giù, muoverlo regola la forma: la fine di una linea lo segue, una
  // forma chiusa gira e cresce attorno al suo centro; Maiusc la tiene
  // regolare. Alzato il puntatore, il tratto entra nel disegno e la forma
  // prende il suo posto: due passi, e annulla riporta l'inchiostro. Esc
  // lascia tutto, come per ogni tratto.

  /// Il mezzo secondo della tenuta ferma: uno solo, perché il gesto è uno.
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  life.add(() => clearTimeout(holdTimer));

  /// Vero se un tratto a penna tenuto fermo diventa una forma.
  const shapesOn = (): boolean => has("recognize") && grid.shapes;

  /// Segue i campioni nuovi di `g`: ogni volta che il puntatore esce dal
  /// punto fermo, il punto fermo diventa lui, e il mezzo secondo riparte.
  const watchStill = (g: InkGesture, samples: readonly InkSample[]): void => {
    if (!g.holds || !shapesOn()) return;
    let restart = false;
    for (const sample of samples) {
      if (g.still !== null && Math.hypot(sample.x - g.still[0], sample.y - g.still[1]) * camera.scale <= HOLD_PX[g.pointer]) continue;
      g.still = [sample.x, sample.y];
      restart = true;
    }
    if (!restart) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => holdStroke(g), HOLD_MS);
  };

  /// La forma a cui somiglia il tratto `g`, nelle coordinate del suo
  /// livello: riconosciuta nella scena, com'è sullo schermo, o nel livello
  /// se il livello deforma. `null` per un tratto piccolo quanto la
  /// scrittura, o che non somiglia a una forma.
  const strokeShapeOf = (g: InkGesture): Recognized | null => {
    const still = HOLD_PX[g.pointer];
    const seen = heldShape(g.scene.map((sample): Point => [sample.x, sample.y]), camera.scale, still);
    if (seen === null) return null;
    return mapped(seen, g.to.inverse) ?? heldShape(g.local.map((sample): Point => [sample.x, sample.y]), camera.scale * scaleOf(g.to.matrix), still);
  };

  /// Il mezzo secondo fermo è passato: il tratto diventa la sua forma, se
  /// ne ha una; se no resta inchiostro, e si continua a disegnare.
  const holdStroke = (g: InkGesture): void => {
    if (current !== g || g.held !== null || g.still === null || !shapesOn()) return;
    const shape = strokeShapeOf(g);
    if (shape === null) return;
    g.held = { shape, from: g.still, end: g.still, moved: false };
    g.predicted = [];
    overlay.setInk(INK_KEY, null);
    overlay.flush();
    drawHeld(g);
    announce(t("draw.recognize.said", { kind: shapeSaid(heldNow(g)) }));
  };

  /// La forma del tratto `g` adesso: regolata dal puntatore, e regolare con
  /// Maiusc.
  const heldNow = (g: InkGesture): Recognized => {
    const held = g.held!;
    let shape = held.shape;
    if (held.moved) {
      const from = apply(g.to.inverse, held.from);
      const end = apply(g.to.inverse, held.end);
      if (shape.kind === "line" || shape.kind === "arrow") {
        shape = { ...shape, to: [shape.to[0] + end[0] - from[0], shape.to[1] + end[1] - from[1]] };
      } else {
        const c = centerOf(shape);
        const before = Math.hypot(from[0] - c[0], from[1] - c[1]);
        if (before > 0) {
          const turn = ((Math.atan2(end[1] - c[1], end[0] - c[0]) - Math.atan2(from[1] - c[1], from[0] - c[0])) * 180) / Math.PI;
          shape = similar(shape, c, Math.hypot(end[0] - c[0], end[1] - c[1]) / before, turn);
        }
      }
    }
    return shift ? regular(shape) : shape;
  };

  const heldStyle = (g: InkGesture): ShapeStyle => ({ color: g.color, width: g.brush.size });

  const drawHeld = (g: InkGesture): void => {
    showShape(shapeOfRecognized(heldNow(g), "preview", heldStyle(g)), g.to.matrix);
  };

  /// Il puntatore del tratto diventato forma è in `p`: oltre il tremito
  /// della mano ferma, la forma lo segue.
  const moveHeld = (g: InkGesture, p: Point): void => {
    const held = g.held!;
    held.end = p;
    if (!held.moved && Math.hypot(p[0] - held.from[0], p[1] - held.from[1]) * camera.scale > HOLD_PX[g.pointer]) held.moved = true;
    if (held.moved) drawHeld(g);
  };

  /// Che cosa è una forma riconosciuta, a parole: «Rettangolo», «Quadrato»,
  /// «Quadrilatero», «Esagono», «Stella a 5 punte».
  const shapeSaid = (shape: Recognized): string => {
    switch (shape.kind) {
      case "line":
        return t("draw.tool.line");
      case "arrow":
        return t("draw.tool.arrow");
      case "rect":
        return t(shape.width === shape.height ? "draw.kind.ngon.4" : "draw.tool.rect");
      case "ellipse":
        return t(shape.rx === shape.ry ? "draw.kind.circle" : "draw.tool.ellipse");
      case "regular":
        return polygonalKind({ shape: shape.ratio === null ? "polygon" : "star", count: shape.count });
      case "polygon": {
        const star = starOf(shape.points);
        if (star !== null) return polygonalKind({ shape: "star", count: star.count });
        return shape.points.length === 4 ? t("draw.kind.quad") : polygonalKind({ shape: "polygon", count: shape.points.length });
      }
    }
  };

  /// Il tratto tenuto fermo entra nel disegno, poi la sua forma ne prende il
  /// posto: due passi, così annulla riporta l'inchiostro. Una forma che non
  /// si disegna più, schiacciata dal puntatore, lascia il tratto.
  const finishHeld = (g: InkGesture): void => {
    const written = writeInk(g, false);
    if (written === null) return;
    let shape: Recognized | null = heldNow(g);
    // Il livello di adesso, se mentre il gesto durava è cambiato.
    if (!sameDestination(written.to, g.to)) shape = mapped(shape, compose(written.to.inverse, g.to.matrix));
    const unit = shape === null ? null : currentIndex().get(written.id);
    const shaped = unit === null || shape === null ? null : heldShapeOps(engine.model!, unit, shape, g.ids);
    if (shaped === null) {
      announce(`${t("draw.added.stroke")} ${objects()}`);
      return;
    }
    const ops: Op[] = [...shaped.ops];
    const page = pageFor(scene.root.page, shaped.extent);
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.to_shape", asGesture(ops)) !== null) announce(`${t("draw.shaped.held", { kind: shapeSaid(shape!) })} ${objects()}`);
  };

  /// La forma del gesto `g` entra nel disegno, e lo si dice, con `note`, a
  /// che cosa si è agganciata.
  const finishShape = (g: ShapeGesture, note = ""): void => {
    // Il livello di adesso: mentre il gesto durava, il disegno può essere
    // cambiato.
    const to = target(g.ids);
    if (to === null) return;
    if (shapeEnds(g, to) === null) return;
    const elem = shapeOf(g, g.ids.next("object"), to);
    if (elem === null) return;
    const ops: Op[] = [...to.prelude, addOp(to, elem)];
    const page = pageFor(scene.root.page, elemBounds(elem, to.matrix));
    if (page !== null) ops.push({ op: "page", viewBox: page });
    // Il poligono si dice col suo nome, la stella con le sue punte.
    const added =
      g.tool !== "polygon"
        ? t(ADDED[g.tool])
        : polygonTool.shape === "star"
          ? t("draw.added.star", { count: polygonTool.points })
          : t("draw.added.ngon", { kind: polygonSaid() });
    if (commit(toolLabel(g.tool), asGesture(ops)) !== null) announce(noted(`${added} ${objects()}`, note));
  };

  // --- La penna di Bézier ------------------------------------------------------
  //
  // Il tracciato si disegna in più gesti, e vive fra un gesto e l'altro: un
  // tocco mette uno spigolo, un trascinamento un nodo simmetrico, un tocco
  // sul primo nodo chiude il tracciato, uno sull'ultimo lo conclude. Si
  // scrive quando si conclude, in un passo solo; fino ad allora Annulla e
  // Ripeti percorrono i suoi passi.
  //
  // Con la Curvatura un tocco posa un punto liscio, e la curva passa morbida
  // per tutti; con Alt, o col doppio tocco, uno spigolo. Un trascinamento
  // sposta il punto che prende, un tocco su un punto in mezzo lo fa passare
  // da liscio a spigolo e ritorno. Le maniglie non si vedono: vengono dai
  // punti (`curvature.ts`).

  /// Il tracciato della penna, se ha almeno un nodo.
  const drawing = (): Drafting | null => (drafting !== null && drafting.nodes.length > 0 ? drafting : null);

  /// Vero se `p` prende il nodo in `node` col puntatore `pointer`.
  const onNode = (p: Point, node: Point, pointer: InkPointerType): boolean =>
    Math.hypot(p[0] - node[0], p[1] - node[1]) * camera.scale <= NODE_PX[pointer];

  /// Che cosa prende un tocco in `p`: il primo nodo, che chiude il
  /// tracciato, l'ultimo, o il vuoto, dove va un nodo nuovo. Fra il primo e
  /// l'ultimo, vicini, vince il più vicino; a pari distanza l'ultimo, così
  /// un nodo solo, che è l'uno e l'altro, non si chiude. Con la Curvatura,
  /// `curve`, anche un punto in mezzo ([`middlePoint`]).
  const bezierTarget = (p: Point, pointer: InkPointerType, curve = curvature): "add" | "close" | "last" | "point" => {
    const nodes = drafting?.nodes ?? [];
    const last = nodes[nodes.length - 1];
    if (last === undefined) return "add";
    const first = nodes[0]!;
    const closes = onNode(p, first.at, pointer);
    const ends = onNode(p, last.at, pointer);
    if (closes && ends) return Math.hypot(p[0] - first.at[0], p[1] - first.at[1]) < Math.hypot(p[0] - last.at[0], p[1] - last.at[1]) ? "close" : "last";
    if (closes || ends) return closes ? "close" : "last";
    return curve && middlePoint(p, pointer) >= 0 ? "point" : "add";
  };

  /// Il nodo in mezzo al tracciato della penna, né il primo né l'ultimo,
  /// che il puntatore `pointer` prende in `p`: il più vicino; -1 se nessuno.
  const middlePoint = (p: Point, pointer: InkPointerType): number => {
    const nodes = drafting?.nodes ?? [];
    let best = -1;
    let near = Infinity;
    for (let i = 1; i < nodes.length - 1; i++) {
      const at = nodes[i]!.at;
      const apart = Math.hypot(p[0] - at[0], p[1] - at[1]);
      if (apart < near && onNode(p, at, pointer)) {
        best = i;
        near = apart;
      }
    }
    return best;
  };

  /// Il nodo che un gesto della penna prende col bersaglio `mode` in `p`.
  const targetIndex = (mode: "add" | "close" | "last" | "point", p: Point, pointer: InkPointerType): number => {
    const nodes = drafting?.nodes ?? [];
    return mode === "close" ? 0 : mode === "last" ? nodes.length - 1 : mode === "point" ? middlePoint(p, pointer) : -1;
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
  /// 15°. `null` per un tocco, o se torna sul nodo, e con la Curvatura, che
  /// non tira maniglie.
  const bezierHandle = (g: BezierGesture): Point | null => {
    if (g.curve || !g.dragging || g.at === null || g.end === null) return null;
    const point = guided(g.end, bezierGuides, g.pointer);
    const handle = shift ? constrainEnd("line", g.at, point) : point;
    return Math.hypot(handle[0] - g.at[0], handle[1] - g.at[1]) * camera.scale <= DRAG_PX[g.pointer] ? null : handle;
  };

  /// I bersagli della Curvatura mentre `g` sposta un punto: gli oggetti e
  /// gli altri punti.
  const curveGuides = (g: BezierGesture): GuideIndex => {
    const nodes = drafting?.nodes ?? noNodes;
    return guidesFor(g, [], () => nodes.filter((_, i) => i !== g.index).map((node) => node.at));
  };

  /// Dove il trascinamento della Curvatura `g` porta il punto che prende:
  /// quello nuovo dove va il puntatore, come un tocco; uno che c'è già di
  /// quanto si è mosso il puntatore, sulla griglia o in linea con gli
  /// oggetti e con gli altri punti.
  const curveMoved = (g: BezierGesture): Point => {
    if (g.mode === "add") return bezierPoint(g.end!, g.pointer);
    const p: Point = [g.at![0] + g.end![0] - g.from![0], g.at![1] + g.end![1] - g.from![1]];
    return guided(p, () => curveGuides(g), g.pointer);
  };

  /// Il gesto della penna che cambia il suo tracciato: non uno della
  /// Curvatura su una forma scelta.
  const penGesture = (): BezierGesture | null => (current?.kind === "bezier" && current.mode !== null && current.mode !== "path" ? current : null);

  /// I nodi come li lascia il gesto `g`, e se il tracciato si chiude.
  const bezierAfter = (g: BezierGesture): { readonly nodes: readonly DraftNode[]; readonly closed: boolean } => {
    const nodes = (drafting?.nodes ?? []).slice();
    if (g.curve) {
      // La Curvatura posa un punto, liscio o con Alt uno spigolo, o sposta
      // quello che prende; un tocco sul primo chiude.
      const moved = g.dragging ? curveMoved(g) : null;
      if (g.mode === "add") nodes.push({ at: moved ?? g.at!, in: null, out: null, curve: alt ? "corner" : "smooth" });
      else if (moved !== null) nodes[g.index] = movedNode(nodes[g.index]!, moved);
      return { nodes, closed: g.mode === "close" && !g.dragging };
    }
    const handle = bezierHandle(g);
    if (g.mode === "add") nodes.push(penNode(g.at!, handle));
    // Trascinato, il primo nodo diventa simmetrico: il tracciato vi passa
    // senza spigolo. L'ultimo cambia solo la maniglia verso il nodo dopo.
    else if (g.mode === "close" && handle !== null) nodes[0] = penNode(nodes[0]!.at, handle);
    else if (g.mode === "last" && g.dragging) nodes[nodes.length - 1] = { ...nodes[nodes.length - 1]!, out: handle };
    return { nodes, closed: g.mode === "close" };
  };

  /// Il tracciato dei nodi `nodes` come lo scrive la penna, coi punti della
  /// Curvatura risolti in maniglie, nelle coordinate del livello `to`, col
  /// colore e lo spessore di adesso. `null` se si scriverebbe in un punto.
  const bezierElem = (id: string, nodes: readonly DraftNode[], closed: boolean, to: Destination): Elem | null => {
    const sub = penPath(curved(nodes, closed), closed, to.inverse);
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
  /// nodi, pieno quello che il gesto tiene o che un tocco prenderebbe. Con
  /// la Curvatura, al posto del segmento, i due che il punto nuovo farebbe,
  /// o i tre attorno alla chiusura, e niente maniglie.
  const bezierHandles = (): OverlayHandle[] => {
    const g = penGesture();
    const nodes = g === null ? drafting?.nodes ?? [] : bezierAfter(g).nodes;
    const last = nodes[nodes.length - 1];
    if (last === undefined) return [];
    const curve = g?.curve ?? curvature;
    const out: OverlayHandle[] = [];
    const aim = g === null && hover !== null ? bezierTarget(hover.at, hover.pointer) : null;
    const identity: Matrix = [1, 0, 0, 1, 0, 0];
    if ((aim === "add" || aim === "close") && curve) {
      const next = aim === "close" ? nodes : [...nodes, { at: bezierPoint(hover!.at, hover!.pointer), in: null, out: null, curve: alt ? "corner" : "smooth" } satisfies DraftNode];
      const all = curved(next, aim === "close");
      const n = all.length;
      const part = aim === "add" ? all.slice(-3) : n <= 3 ? [...all, all[0]!] : [all[n - 2]!, all[n - 1]!, all[0]!, all[1]!];
      out.push({ kind: "outline", segments: writeNodes([penPath(part, false, identity)]), matrix: identity });
    } else if (aim === "add" || aim === "close") {
      const next = aim === "close" ? nodes[0]! : penNode(bezierPoint(hover!.at, hover!.pointer), null);
      out.push({ kind: "outline", segments: writeNodes([penPath([last, next], false, identity)]), matrix: identity });
    }
    const held = g !== null ? (g.mode === "add" ? nodes.length - 1 : g.index) : nodes.length - 1;
    const node = nodes[held]!;
    if (!curve) for (const handle of [node.in, node.out]) if (handle !== null) out.push({ kind: "control", x: handle[0], y: handle[1], node: node.at });
    const hot = g !== null ? held : aim === null || aim === "add" ? -1 : targetIndex(aim, hover!.at, hover!.pointer);
    nodes.forEach((each, i) => out.push({ kind: "node", x: each.at[0], y: each.at[1], shape: NODE_SHAPES[draftKind(each)], selected: i === hot }));
    return out;
  };

  /// Il tracciato della penna come si scriverà, col gesto che lo cambia, e
  /// sopra i suoi nodi.
  function showBezier(): void {
    const g = penGesture();
    const to = g?.to ?? drafting?.to ?? null;
    const { nodes, closed } = g === null ? { nodes: drafting?.nodes ?? [], closed: false } : bezierAfter(g);
    const elem = to === null ? null : bezierElem("preview", nodes, closed, to);
    showShape(elem, to?.matrix ?? [1, 0, 0, 1, 0, 0]);
    showHandles();
  }

  /// Il nodo `at` del tracciato della penna a parole: quale, di che tipo e
  /// dove.
  const bezierNodeText = (nodes: readonly DraftNode[], at: number): string => {
    const node = nodes[at]!;
    return t("draw.bezier.node", { index: at + 1, kind: t(KIND_NAMES[draftKind(node)]), x: coordText(node.at[0]), y: coordText(node.at[1]) });
  };

  /// Il primo punto di un gesto della penna: che cosa prende, e il nodo.
  const bezierStart = (g: BezierGesture, p: Point): void => {
    g.from = p;
    hover = null;
    // La Curvatura, senza un tracciato in corso, prende prima le forme
    // scelte.
    g.path = g.curve && drafting === null ? curveGrab(p, g.pointer) : null;
    if (g.path !== null) {
      g.mode = "path";
      return;
    }
    g.mode = bezierTarget(p, g.pointer, g.curve);
    g.index = targetIndex(g.mode, p, g.pointer);
    g.at = g.mode === "add" ? bezierPoint(p, g.pointer) : (drafting?.nodes ?? [])[g.index]!.at;
    hover = null;
  };

  const bezierUpdate = (g: BezierGesture): void => {
    if (g.from === null || g.end === null) return;
    if (!g.dragging && Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * camera.scale > DRAG_PX[g.pointer]) g.dragging = true;
    if (g.mode === "path") curvePathUpdate(g);
    else showBezier();
  };

  /// Un passo del tracciato della penna: i nodi diventano `nodes`, e
  /// Ripeti non ha più niente da rimettere.
  const bezierStep = (draft: Drafting, nodes: readonly PenNode[], label: DrawKey, index: number): void => {
    draft.done.push({ nodes: draft.nodes, label, index });
    draft.undone.length = 0;
    draft.nodes = nodes;
  };

  /// La fine di un gesto della penna, alzato al tempo `time`: il nodo entra
  /// nel tracciato, o il tracciato si chiude o si conclude.
  const bezierEnd = (g: BezierGesture, time: number): void => {
    const note = snapNote();
    current = null;
    if (g.mode === null) return;
    if (g.mode === "path") {
      curvePathEnd(g, time, note);
      return;
    }
    if (g.curve) {
      curveEnd(g, time, note);
      return;
    }
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

  /// La fine di un gesto della Curvatura, con la nota `note` di ciò a cui si
  /// è agganciato: il punto entra nel tracciato o si sposta; un tocco
  /// sull'ultimo conclude il tracciato, e sul primo lo chiude, ma subito
  /// dopo averlo posato, nello stesso posto, ne fa uno spigolo; un tocco su
  /// un punto in mezzo lo fa passare da liscio a spigolo e ritorno.
  const curveEnd = (g: BezierGesture, time: number, note: string): void => {
    const tap = curveTap;
    curveTap = null;
    if (!g.dragging && g.mode === "last") {
      const draft = drawing()!;
      const twice = tap !== null && tap.index === g.index && time - tap.time <= DOUBLE_TAP_MS &&
        Math.hypot(tap.at[0] - g.from![0], tap.at[1] - g.from![1]) * camera.scale <= DOUBLE_TAP_PX[g.pointer];
      if (!twice) {
        finishBezier(false);
        return;
      }
      // Il doppio tocco posa uno spigolo in un passo solo: Annulla toglie il
      // punto, non solo il suo tipo.
      draft.nodes = withKind(draft.nodes, g.index, draftKind(draft.nodes[g.index]!) === "corner" ? "smooth" : "corner");
      showBezier();
      announce(bezierNodeText(draft.nodes, g.index));
      return;
    }
    if (!g.dragging && g.mode === "point") {
      const draft = drawing()!;
      setDraftKind(draft, g.index, draftKind(draft.nodes[g.index]!) === "corner" ? "smooth" : "corner");
      return;
    }
    const { nodes, closed } = bezierAfter(g);
    if (closed) {
      drafting!.nodes = nodes;
      finishBezier(true);
      return;
    }
    const draft = drafting ?? { nodes: [], done: [], undone: [], to: g.to };
    const index = g.mode === "add" ? nodes.length - 1 : g.index;
    bezierStep(draft, nodes, g.mode === "add" ? "draw.bezier.step.node" : "draw.bezier.step.move", index + 1);
    draft.to = g.to;
    drafting = draft;
    if (g.mode === "add" && !g.dragging) curveTap = { index, at: g.from!, time };
    showBezier();
    syncControls();
    announce(noted(bezierNodeText(nodes, index), note));
  };

  /// Il nodo `index` del tracciato della penna diventa un punto della
  /// Curvatura di tipo `kind`, in un passo che si annulla.
  const setDraftKind = (draft: Drafting, index: number, kind: CurveKind): void => {
    bezierStep(draft, withKind(draft.nodes, index, kind), "draw.bezier.step.kind", index + 1);
    showBezier();
    syncControls();
    announce(bezierNodeText(draft.nodes, index));
  };

  /// Maiusc+C e Maiusc+S con la Curvatura: il punto sotto il cursore, o
  /// l'ultimo, diventa uno spigolo o liscio.
  const curveKindKey = (kind: CurveKind): void => {
    const draft = drawing();
    if (draft === null) return;
    const p = cursorPoint();
    const aim = bezierTarget(p, "mouse", true);
    const index = aim === "add" ? draft.nodes.length - 1 : targetIndex(aim, p, "mouse");
    curveTap = null;
    if (draft.nodes[index]!.curve === kind) announce(`${t("draw.unchanged")} ${bezierNodeText(draft.nodes, index)}`);
    else setDraftKind(draft, index, kind);
  };

  // --- La Curvatura sui tracciati che ci sono già ------------------------------
  //
  // Senza un tracciato in corso, la Curvatura modifica le forme scelte come
  // le disegnerebbe: un nodo trascinato si sposta e i segmenti attorno si
  // rifanno; trascinato da un segmento, vi posa un nodo e lo sposta. Un
  // tocco su un segmento vi posa un nodo senza cambiare niente, uno su un
  // nodo lo sceglie, per Canc, e due lo fanno liscio o spigolo. Le forme si
  // mostrano coi nodi, senza maniglie, come con lo strumento Nodi.

  /// Ciò che la Curvatura prende in `p` delle forme scelte: il nodo più
  /// vicino entro il raggio del puntatore, a pari distanza della forma più
  /// in alto; se no il segmento sotto il puntatore. L'asta di una freccia
  /// non si piega. `null` se niente.
  const curveGrab = (p: Point, pointer: InkPointerType): CurveGrab | null => {
    if (!curveOn()) return null;
    refreshNodes();
    const tolerance = NODE_PX[pointer] / camera.scale;
    let best: CurveGrab | null = null;
    let nearest = Infinity;
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i]!;
      const node = nodeAt(edit.subs, edit.matrix, p, tolerance);
      if (node === null) continue;
      const origin = nodePoint(edit, node);
      const apart = Math.hypot(origin[0] - p[0], origin[1] - p[1]);
      if (apart < nearest) {
        best = { edit, node, segment: null, origin };
        nearest = apart;
      }
    }
    if (best !== null) return best;
    const reach = HIT_PX[pointer] / camera.scale;
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i]!;
      if (edit.nodable.kind === "arrow") continue;
      const segment = linkAt(edit.subs, edit.matrix, p, reach);
      if (segment !== null) return { edit, node: null, segment, origin: p };
    }
    return null;
  };

  /// Il tracciato preso da `g` come lo lascia il trascinamento: il nodo
  /// preso, o quello posato sul segmento, dove porta il puntatore, sulla
  /// griglia o in linea con gli oggetti e con gli altri nodi, e i segmenti
  /// attorno rifatti come li disegna la Curvatura ([`recurve`]).
  const curveReshape = (g: BezierGesture): CurveDraft => {
    const { edit, node, segment } = g.path!;
    const given = nodeKinds.get(edit.key) ?? NO_KINDS;
    const inserted = segment === null ? null : insertNode(edit.subs, segment.sub, segment.link, segment.t);
    const subs = inserted?.subs ?? edit.subs;
    const key = inserted?.selected[0] ?? node!;
    const kinds = inserted === null ? given : remapped(given, inserted.moved);
    const kind = kindsOf(edit, subs, kinds);
    const [s, at] = parseKey(key);
    const origin = apply(edit.matrix, subs[s]!.nodes[at]!);
    const moved = moveNodes(subs, new Set([key]), localDelta(edit, origin, curvePathTo(g, origin)), kind);
    return { subs: recurve(moved, new Set([key]), kind), key, kinds, moved: inserted?.moved ?? null };
  };

  /// Dove il trascinamento di `g` porta il nodo che sta in `origin`, nella
  /// scena: di quanto si è mosso il puntatore, sulla griglia o in linea con
  /// gli altri oggetti e con gli altri nodi delle forme scelte.
  const curvePathTo = (g: BezierGesture, origin: Point): Point => {
    const { edit, node } = g.path!;
    const p: Point = [origin[0] + g.end![0] - g.from![0], origin[1] + g.end![1] - g.from![1]];
    const others = (): Point[] =>
      edits.flatMap((each) => each.subs.flatMap((sub, s) => sub.nodes.flatMap((at, i) => (each === edit && nodeKey(s, i) === node ? [] : [apply(each.matrix, at)]))));
    return guided(p, () => guidesFor(g, editedUnits(), others), g.pointer);
  };

  /// Il trascinamento della Curvatura su un tracciato scelto, sul foglio e
  /// nei nodi.
  const curvePathUpdate = (g: BezierGesture): void => {
    if (!g.dragging) return;
    g.reshaped = curveReshape(g);
    showNodeDraft(new Map([[g.path!.edit.key, g.reshaped.subs]]));
  };

  /// La fine di un gesto della Curvatura su un tracciato scelto, alzato al
  /// tempo `time`, con la nota `note` di ciò a cui si è agganciato.
  const curvePathEnd = (g: BezierGesture, time: number, note: string): void => {
    const { edit, node, segment } = g.path!;
    const tap = curveNodeTap;
    curveNodeTap = null;
    if (g.dragging) {
      const draft = g.reshaped ?? curveReshape(g);
      painter.setDraft(null);
      const change: NodeChange = { edit, subs: draft.subs, selected: [draft.key], kinds: draft.kinds, ...(draft.moved === null ? {} : { moved: draft.moved }) };
      if (writeEdits(segment === null ? "draw.action.nodes_move" : "draw.action.nodes_insert", [change])?.written === true) announceMoved(note);
      return;
    }
    if (segment !== null) {
      // Il nodo posato non cambia il tracciato: lo divide dov'è.
      const done = writeEdits("draw.action.nodes_insert", [changeOf(edit, insertNode(edit.subs, segment.sub, segment.link, segment.t))]);
      if (done?.written === true) announce(afterEdit(plural(done.count, "draw.nodes.inserted.one", "draw.nodes.inserted.other")));
      return;
    }
    const twice = tap !== null && tap.shape === edit.key && tap.key === node && time - tap.time <= DOUBLE_TAP_MS &&
      Math.hypot(tap.at[0] - g.from![0], tap.at[1] - g.from![1]) * camera.scale <= DOUBLE_TAP_PX[g.pointer];
    if (!twice) {
      curveNodeTap = { shape: edit.key, key: node!, at: g.from!, time };
      setNodes(pickOf(edit, [node!]));
      announceNodes();
      return;
    }
    const [s, at] = parseKey(node!);
    curveKindAt(edit, node!, kindsOf(edit)(s, at) === "corner" ? "smooth" : "corner");
  };

  /// Il nodo `key` della forma `edit` diventa `kind`, e i segmenti attorno si
  /// rifanno come li disegna la Curvatura: fra due spigoli, una linea. Un
  /// capo di un tracciato aperto non ha tipo.
  const curveKindAt = (edit: Editing, key: NodeKey, kind: CurveKind): void => {
    const [s, at] = parseKey(key);
    if (!innerNode(edit.subs[s]!, at)) {
      announce(t("draw.nodes.kind.none"));
      return;
    }
    const given = new Map(nodeKinds.get(edit.key) ?? NO_KINDS);
    given.set(key, kind);
    const subs = recurve(edit.subs, new Set([key]), kindsOf(edit, edit.subs, given), new Set([key]));
    const [one, other] = MADE[kind];
    if (writeEdits("draw.action.nodes_kind", [{ edit, subs, selected: [key], kinds: given, changed: 1 }])?.written === true) announce(afterEdit(plural(1, one, other)));
  };

  /// Canc con la Curvatura: i nodi scelti se ne vanno, e i segmenti attorno
  /// si rifanno come li disegna la Curvatura: dove un nodo tolto stava fra
  /// due spigoli, una linea.
  const curveDelete = (): void => {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = chosen.map((edit): NodeChange => {
      const picked = pickedIn(edit);
      const edited = deleteNodes(edit.subs, picked);
      const given = remapped(nodeKinds.get(edit.key) ?? NO_KINDS, edited.moved);
      // I nodi che restano accanto a quelli tolti, e il primo di ogni
      // segmento che adesso passa dove erano.
      const around = new Set<NodeKey>();
      const bridges = new Set<NodeKey>();
      edit.subs.forEach((sub, s) => {
        const n = sub.nodes.length;
        const gone = (at: number): boolean => picked.has(nodeKey(s, at));
        const kept = (at: number, by: 1 | -1): number | null => {
          let i = at;
          for (let step = 0; step < n; step++) {
            i = sub.closed ? (i + by + n) % n : i + by;
            if (i < 0 || i >= n) return null;
            if (!gone(i)) return i;
          }
          return null;
        };
        for (let at = 0; at < n; at++) {
          if (!gone(at)) continue;
          const before = kept(at, -1);
          const after = kept(at, 1);
          const a = before === null ? undefined : edited.moved.get(nodeKey(s, before));
          const b = after === null ? undefined : edited.moved.get(nodeKey(s, after));
          if (a !== undefined) around.add(a);
          if (b !== undefined) around.add(b);
          if (a !== undefined && b !== undefined && a !== b) bridges.add(a);
        }
      });
      const kinds = kindsOf(edit, edited.subs, given);
      const subs = edited.subs.map((sub, s): Subpath => {
        const links = sub.links.map((link, at) => {
          const straight = bridges.has(nodeKey(s, at)) && kinds(s, at) === "corner" && kinds(s, (at + 1) % sub.nodes.length) === "corner";
          return straight ? ({ kind: "line" } as const) : link;
        });
        return { ...sub, links };
      });
      return { edit, subs: recurve(subs, around, kinds), selected: [], kinds: given, moved: edited.moved, changed: edited.changed };
    });
    const done = writeEdits("draw.action.nodes_delete", changes);
    if (done?.written !== true) return;
    const gone = changes.filter((change) => change.subs.every((sub) => sub.nodes.length < 2)).length;
    if (gone === changes.length) announce(`${plural(gone, "draw.nodes.deleted.all.one", "draw.nodes.deleted.all.other")} ${objects()}`);
    else announce(afterEdit(plural(done.count, "draw.nodes.deleted.one", "draw.nodes.deleted.other")));
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
    const point = sceneAt(event.clientX, event.clientY);
    const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
    const grip = gripAt(view, point, camera.scale, pointer);
    const corner = cornerAt(point, pointer, view, grip);
    showGrip(corner !== null ? cornerCursor(corner.grip, corner.unit.matrix, camera.angle) : grip === null ? null : gripCursor(view.frame, grip, camera.angle));
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
    if (hot !== null) surface.dataset.grip = axisCursor(guides![hot]!.axis);
    if (hot === hotGuide) return;
    hotGuide = hot;
    showGuideLines();
  };
  /// Il puntatore porta con sé il cursore del foglio, che si nasconde: la
  /// tastiera ripartirà da lì.
  const followPointer = (event: PointerEvent): void => {
    if (pressed !== null) return;
    cursor = sceneAt(event.clientX, event.clientY);
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
      const point = sceneAt(event.clientX, event.clientY);
      const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
      pointerAt = { at: point, pointer };
      // Sopra il foglio, la penna di Bézier mostra il segmento che verrebbe.
      if (drawing() !== null && current === null && pressed === null) {
        hover = { at: point, pointer };
        showBezier();
      }
      // Sopra una maniglia della cornice o una guida, il cursore dice che
      // cosa fa; con lo strumento Nodi, la forma sotto mostra i suoi nodi,
      // col Costruttore la regione sotto si accende, e con le Forbici si
      // vede dove tagliano.
      if (current === null && pressed === null) {
        hoverGrip(event);
        hoverGuide(event);
        hoverNodes(event.buttons === 0 ? point : null, pointer);
        hoverRegion(event.buttons === 0 ? point : null, pointer);
        hoverCut(event.buttons === 0 ? point : null, pointer);
      }
      // Con Alt, le misure seguono il puntatore.
      if (current === null && pressed === null && (alt || measured)) showHandles();
      // I righelli segnano dov'è.
      else if (rulersShown()) showRulers();
    },
    { capture: true },
  );
  /// Il menu dei righelli o della guida in `p`, sulla superficie, se lì ce
  /// n'è uno.
  const menuItemsAt = (p: Point, touch: boolean): MenuItem[] | null => {
    if (rulerAt(p) !== null) return rulerItems();
    if (!guidesShown() || scene.root.guides === null) return null;
    const index = guideAt(scene.root.guides, camera, p, GUIDE_HIT_PX[touch ? "touch" : "mouse"], false);
    return index === null ? null : guideItems(index);
  };

  /// Vero se lo strumento di adesso ha il menu della selezione.
  const selectingTool = (): boolean => has("selection") && (tool === "select" || tool === "lasso");

  /// Vero se il clic destro apre il menu radiale: dal livello che lo offre,
  /// a chi può modificare, con gli strumenti che non hanno il menu della
  /// selezione.
  const radialHere = (): boolean => has("gestures") && editable() && !selectingTool();

  // Col tasto destro, o col tocco lungo, i righelli e le guide del
  // documento hanno il loro menu, con qualunque strumento e anche per una
  // guida bloccata, che solo da qui si sblocca col puntatore. Altrove il
  // menu della selezione o il menu radiale.
  life.listen(surface, "contextmenu", (event) => {
    // Il menu aperto dalla tastiera non si apre una seconda volta: l'evento
    // che il tasto manda dietro si consuma, uno solo.
    if (event.timeStamp - keyedMenu < KEYED_MENU_MS) {
      keyedMenu = -Infinity;
      event.preventDefault();
      return;
    }
    // Così quello che il sistema manda dietro al tasto laterale della penna,
    // che il menu radiale ha già visto.
    if (radial !== null || event.timeStamp - radialLift < RADIAL_ECHO_MS) {
      radialLift = -Infinity;
      event.preventDefault();
      return;
    }
    const local = localPoint(event.clientX, event.clientY);
    const p: Point = [local.x, local.y];
    const kind = "pointerType" in event ? (event as PointerEvent).pointerType : "mouse";
    const touch = kind === "touch";
    const items = menuItemsAt(p, touch);
    // Con gli strumenti che disegnano, il menu radiale. Il tocco lungo che lo
    // apre non lascia un punto sul foglio; un tratto del mouse a metà resta.
    if (items === null && radialHere()) {
      if (pressed !== null || (current !== null && !(touch && current.pointer === "touch"))) return;
      event.preventDefault();
      // Se il puntatore è ancora giù, il menu lo segue.
      const held = down !== null && (down.type === kind || (kind === "" && down.type === "mouse")) ? { pointerType: down.type, pointerId: down.id } : null;
      showRadial(event.clientX, event.clientY, held);
      return;
    }
    // Altrove, con gli strumenti che scelgono, il menu della selezione: sopra
    // un oggetto che non è scelto, prima lo sceglie. Un tocco lungo che non
    // ha ancora mosso niente lo apre anche lui.
    const still = current === null || (current.kind === "select" && current.mode === "pending") || (current.kind === "lasso" && !current.dragging);
    const selecting = items === null && selectingTool() && pressed === null && still;
    if (!selecting && (items === null || items.length === 0)) return;
    // Il tocco lungo che apre il menu non tira anche una guida.
    if (!selecting && current !== null && current.kind !== "guide") return;
    event.preventDefault();
    if (current !== null) cancelGesture();
    if (!selecting) {
      showContextMenu(event, items!);
      return;
    }
    const hit = currentIndex().at(toScene(camera, p), HIT_PX[touch ? "touch" : "mouse"] / camera.scale);
    if (hit !== null && !selectedUnits().some((unit) => unit.key === hit.key || holdsPath(hit.path, unit.path))) select([hit.key]);
    showContextMenu(event, selectionItems(), { labelledBy: selectionButton.id });
  });
  // Il tasto laterale della penna apre il menu radiale dove la penna è, e la
  // penna lo guida finché il tasto è giù. Sui righelli, sulle guide e con
  // gli strumenti che scelgono resta al sistema, che ne fa un clic destro.
  life.listen(surface, "pointerdown", (event) => {
    if (event.pointerType !== "pen" || event.button !== 2 || radial !== null || current !== null || pressed !== null) return;
    const local = localPoint(event.clientX, event.clientY);
    if (menuItemsAt([local.x, local.y], false) !== null || !radialHere()) return;
    event.preventDefault();
    showRadial(event.clientX, event.clientY, { pointerType: "pen", pointerId: event.pointerId });
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
    hoverNodes(null, "mouse");
    hoverRegion(null, "mouse");
    hoverCut(null, "mouse");
    if (hover !== null) {
      hover = null;
      showBezier();
    } else if (measured) {
      showHandles();
    }
  });

  /// La curva della pressione di adesso, rifatta quando la si cambia.
  let penCurve: { readonly of: PenCurve; readonly apply: (pressure: number) => number } | null = null;
  /// La pressione della penna sulla curva di chi disegna, se il livello la
  /// offre: senza, la pressione com'è.
  const penPressure = (pressure: number): number => {
    if (isDefaultCurve(grid.pen) || !has("gestures")) return pressure;
    if (penCurve?.of !== grid.pen) penCurve = { of: grid.pen, apply: pressureCurve(grid.pen) };
    return penCurve.apply(pressure);
  };

  // I gestori della pipeline, che riceve anche il cursore del foglio.
  const handlers: PenInputOptions = {
    toScene: (clientX, clientY) => {
      const [x, y] = sceneAt(clientX, clientY);
      return { x, y };
    },
    turn: () => camera.angle,
    pressure: penPressure,
    onStart(start) {
      // Un gesto lungo che la pipeline divide al limite dei campioni
      // continua nel tratto nuovo; il tratto a penna si scrive a pezzi,
      // tranne quello diventato forma, che è ormai un gesto solo.
      if (start.continued && current !== null && current.kind !== "refused" && (current.kind !== "ink" || current.held !== null)) {
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
          if (g.held !== null) {
            moveHeld(g, toPoint(samples[samples.length - 1]!));
            break;
          }
          for (const sample of samples) {
            g.scene.push(sample);
            g.local.push(toLocal(sample, g.to.inverse));
          }
          drawInk(g);
          watchStill(g, samples);
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
        case "lasso":
          for (const sample of samples) lassoAdd(g, toPoint(sample));
          lassoUpdate(g);
          break;
        case "nodes":
          if (g.from === null) nodesStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          nodesUpdate(g);
          break;
        case "builder":
          for (const sample of samples) builderAdd(g, toPoint(sample));
          builderUpdate(g);
          break;
        case "cut":
          for (const sample of samples) cutAdd(g, toPoint(sample));
          showHandles();
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
      if (g === null || g.stroke !== id || g.kind !== "ink" || g.held !== null) return;
      g.predicted = samples.map((sample) => toLocal(sample, g.to.inverse));
      drawInk(g);
    },
    onEnd(stroke) {
      const g = current;
      if (g === null || g.stroke !== stroke.id) return;
      if (stroke.split && (g.kind !== "ink" || g.held !== null)) return;
      switch (g.kind) {
        case "ink":
          current = null;
          clearTimeout(holdTimer);
          if (g.held !== null) {
            // La forma è già a schermo al posto del tratto: la scena la
            // disegna nello stesso gestore.
            finishHeld(g);
            showShape(null, g.to.matrix);
            return;
          }
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
        case "lasso":
          lassoEnd(g);
          return;
        case "nodes":
          nodesEnd(g, stroke.timeStamp);
          return;
        case "builder":
          builderEnd(g);
          return;
        case "cut":
          cutEnd(g);
          return;
        case "bezier":
          bezierEnd(g, stroke.timeStamp);
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
      if (g.kind === "ink") clearTimeout(holdTimer);
      if ((g.kind === "select" && g.mode === "marquee") || g.kind === "lasso" || (g.kind === "builder" && g.mode === "objects")) select(g.base);
      if (g.kind === "select" || g.kind === "guide") showGrip(null);
      // I nodi tornano com'erano, e le forme e gli oggetti con loro.
      if (g.kind === "nodes") {
        focused = g.shapes;
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
    const [va, vb, vc, vd, ve, vf] = viewMatrix(camera);
    const view: Matrix = [va, vb, vc, vd, ve + surface.offsetLeft + surface.clientLeft, vf + surface.offsetTop + surface.clientTop];
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
    cursor ??= toScene(camera, viewCenter());
    return cursor;
  };

  /// La vista segue il cursore quando arriva al bordo, o sotto i righelli.
  const keepInView = (p: Point): void => {
    const { x: left, y: top, w, h } = viewArea();
    if (w === 0 || h === 0) return;
    const margin = Math.min(CURSOR_MARGIN_PX, w / 4, h / 4);
    const [sx, sy] = toScreen(camera, p);
    const x = sx - left;
    const y = sy - top;
    const dx = x < margin ? margin - x : x > w - margin ? w - margin - x : 0;
    const dy = y < margin ? margin - y : y > h - margin ? h - margin - y : 0;
    if (dx === 0 && dy === 0) return;
    placed = true;
    setCamera(panned(camera, dx, dy));
  };

  /// Dove è il cursore, e che cosa c'è sotto: con la penna di Bézier, il
  /// primo nodo o l'ultimo, se un tocco lì chiude o conclude il tracciato;
  /// con la Curvatura anche un punto in mezzo, che un tocco cambia.
  const announceCursor = (): void => {
    const p = cursorPoint();
    const at = t("draw.cursor.at", { x: coordText(p[0]), y: coordText(p[1]) });
    const aim = pressed === null && drawing() !== null ? bezierTarget(p, "mouse") : "add";
    if (aim === "point") {
      announce(`${at}: ${bezierNodeText(drawing()!.nodes, middlePoint(p, "mouse"))} ${t("draw.bezier.cursor.point")}`);
      return;
    }
    if (aim !== "add") {
      announce(`${at}: ${t(aim === "close" ? "draw.bezier.cursor.close" : "draw.bezier.cursor.last")}`);
      return;
    }
    if (pressed === null && tool === "scissors" && has("scissors")) {
      const found = cutSpotAt(p, "mouse");
      if (typeof found !== "string") {
        announce(`${at}: ${cutSpotText(found)}`);
        return;
      }
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
    if (pressed === null) hoverCut(next, "mouse");
    announceCursor();
  };

  /// Muove il cursore di (`dx`, `dy`) pixel dello schermo.
  const moveCursor = (dx: number, dy: number): void => {
    const [x, y] = cursorPoint();
    if (camera.angle === 0) {
      placeCursor([x + dx / camera.scale, y + dy / camera.scale]);
      return;
    }
    // Sul foglio girato, dove punta sullo schermo.
    const [ox, oy] = toScene(camera, [0, 0]);
    const [px, py] = toScene(camera, [dx, dy]);
    placeCursor([x + px - ox, y + py - oy]);
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
  let pinch: { key: string; center: { x: number; y: number }; distance: number; angle: number | null } | null = null;
  /// Quanto hanno girato le dita da quando si sono appoggiate, e se il
  /// foglio gira con loro: comincia oltre [`TWIST_START_DEG`].
  let twist: { total: number; turning: boolean } | null = null;

  const measure = (): typeof pinch => {
    if (navigating.size === 0) return null;
    const points = [...navigating.values()];
    const center = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    const two = points.length >= 2;
    const distance = two ? Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) : 0;
    const angle = two && distance > 0 ? (Math.atan2(points[1]!.y - points[0]!.y, points[1]!.x - points[0]!.x) * 180) / Math.PI : null;
    return { key: [...navigating.keys()].sort((a, b) => a - b).join(","), center, distance, angle };
  };

  /// Le dita che si alzano posano il foglio girato su un angolo retto
  /// vicino, e dicono l'angolo.
  const endTwist = (): void => {
    const ended = twist;
    twist = null;
    if (ended === null || !ended.turning) return;
    const square = Math.round(camera.angle / 90) * 90;
    if (Math.abs(camera.angle - square) <= TWIST_SNAP_DEG) setCamera(turnTo(camera, square, viewCenter()));
    announceTurn();
  };

  const followPinch = (): void => {
    const next = measure();
    if (next !== null && pinch !== null && next.key === pinch.key) {
      const at: Point = [pinch.center.x, pinch.center.y];
      let c = camera;
      if (next.distance > 0 && pinch.distance > 0) c = zoomAt(c, next.distance / pinch.distance, at, DRAW_SCALE_LIMITS);
      // Le dita girano il foglio come un quaderno sul tavolo, dal livello che
      // lo offre e se chi disegna non l'ha spento.
      if (next.angle !== null && pinch.angle !== null && has("gestures") && grid.twist) {
        const turned = normalTurn(next.angle - pinch.angle);
        twist ??= { total: 0, turning: false };
        twist.total += turned;
        if (twist.turning) c = turnBy(c, turned, at);
        else if (Math.abs(twist.total) >= TWIST_START_DEG) twist.turning = true;
      }
      setCamera(panned(c, next.center.x - pinch.center.x, next.center.y - pinch.center.y));
    } else {
      endTwist();
    }
    pinch = next;
  };

  /// Le dita di un tocco: dove si sono appoggiate, quante al massimo, da
  /// quando, e se è ancora un tocco. Un dito che scorre, un tocco lungo, una
  /// penna vicina o un dito tolto dal sistema non lo sono più.
  let fingers: { readonly down: Map<number, Point>; most: number; readonly start: number; spoiled: boolean } | null = null;

  const followFingers = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    const at: Point = [event.clientX, event.clientY];
    if (event.type === "pointerdown") {
      fingers ??= { down: new Map(), most: 0, start: event.timeStamp, spoiled: false };
      fingers.down.set(event.pointerId, at);
      fingers.most = Math.max(fingers.most, fingers.down.size);
      if (pen.roleOf(event.pointerId) === "ignore") fingers.spoiled = true;
      return;
    }
    const from = fingers?.down.get(event.pointerId);
    if (fingers === null || from === undefined) return;
    if (event.type === "pointermove") {
      if (Math.hypot(at[0] - from[0], at[1] - from[1]) > TAP_SLOP_PX) fingers.spoiled = true;
      return;
    }
    if (event.type === "pointercancel") fingers.spoiled = true;
    fingers.down.delete(event.pointerId);
    if (fingers.down.size > 0) return;
    const ended = fingers;
    fingers = null;
    if (ended.spoiled || ended.most < 2 || ended.most > 3 || event.timeStamp - ended.start > TAP_MS) return;
    if (!grid.taps || !has("gestures") || !editable() || pressed !== null) return;
    tapped(ended.most === 2 ? "undo" : "redo");
  };

  /// Il tocco di due dita annulla, quello di tre ripete; se non c'è niente,
  /// lo dice, perché il dito non ha visto succedere niente.
  const tapped = (command: "undo" | "redo"): void => {
    const can = command === "undo" ? history.canUndo || (drafting?.done.length ?? 0) > 0 : history.canRedo || (drafting?.undone.length ?? 0) > 0;
    if (!can) {
      announce(t(command === "undo" ? "draw.undo.none" : "draw.redo.none"));
      return;
    }
    if (command === "undo") undo();
    else redo();
  };

  // --- Il menu radiale -------------------------------------------------------

  /// Il menu radiale aperto, se c'è, e quando il puntatore che l'aveva
  /// aperto si è alzato.
  let radial: Radial | null = null;
  let radialLift = -Infinity;
  /// L'ultimo puntatore appoggiato sulla superficie, finché è giù: il menu
  /// radiale aperto dal suo clic destro lo segue.
  let down: { readonly id: number; readonly type: string } | null = null;

  /// Le tre voci di una lista del menu radiale: le recenti che valgono, poi
  /// quelle di riserva, senza quella di adesso.
  const threeOf = <T,>(recent: readonly T[], fill: readonly T[], now: T, valid: (each: T) => boolean): (T | undefined)[] => {
    const out: T[] = [];
    for (const each of [...recent, ...fill]) {
      if (out.length === 3) break;
      if (each !== now && valid(each) && !out.includes(each)) out.push(each);
    }
    return [out[0], out[1], out[2]];
  };

  /// Il nome di un colore: quello del campione, o il codice.
  const colorName = (code: string): string => {
    const swatch = swatchOf(code);
    if (swatch !== null) return t(swatch.label);
    return t(isLight(code) ? "draw.color.custom.light" : "draw.color.custom", { code });
  };

  const toolIcon = (id: ToolId): string =>
    id === "polygon" && polygonTool.shape === "star" ? "draw-star" : id === "bezier" && curvature ? "draw-curvature" : toolSpec(id).icon;

  /// Le otto voci, dall'alto in senso orario: in alto annulla e in basso
  /// ripete; a destra gli strumenti di prima, il più recente in orizzontale;
  /// a sinistra, allo stesso modo, i colori.
  const radialItems = (): (RadialItem | null)[] => {
    const toolItem = (id: ToolId | undefined): RadialItem | null =>
      id === undefined ? null : { label: t(toolLabel(id)), icon: toolIcon(id), hint: toolSpec(id).shortcut.toUpperCase(), run: () => pickTool(id) };
    const colorItem = (code: string | undefined): RadialItem | null =>
      code === undefined
        ? null
        : {
            label: t("draw.radial.color", { color: colorName(code) }),
            swatch: { color: code, shape: swatchOf(code)?.shape ?? "ring" },
            run: () => {
              setColor(code);
              announce(t("draw.announce.color", { color: colorName(code) }));
            },
          };
    const [tool1, tool2, tool3] = threeOf(recentTools, FILL_TOOLS, tool, (id) => tools.some((spec) => spec.id === id));
    const palette = PALETTE.map((swatch) => swatch.color);
    const [color1, color2, color3] = threeOf(recentColors, palette, style().color, (code) => swatchOf(code) !== null || has("colors"));
    return [
      { label: t("draw.undo"), icon: "draw-undo", hint: displayBinding("Mod-z"), disabled: !undoable(), run: () => undo() },
      toolItem(tool2),
      toolItem(tool1),
      toolItem(tool3),
      { label: t("draw.redo"), icon: "draw-redo", hint: displayBinding("Mod-Shift-z"), disabled: !redoable(), run: () => redo() },
      colorItem(color3),
      colorItem(color1),
      colorItem(color2),
    ];
  };

  /// Apre il menu radiale in `x`, `y` sullo schermo. Un gesto a metà del
  /// puntatore che lo apre si annulla.
  function showRadial(x: number, y: number, held: RadialPointer | null, keyboard = false): void {
    if (current !== null) cancelGesture();
    radial = openRadial(x, y, radialItems(), {
      label: t("draw.radial"),
      center: { icon: toolIcon(tool), color: style().color },
      held,
      keyboard,
      // Il clic destro che il sistema manda dietro al tasto della penna.
      onRelease: (at) => {
        if (held?.pointerType === "pen") radialLift = at;
      },
      onClose: () => {
        radial = null;
      },
    });
  }
  life.add(() => radial?.close());

  const onPointer = (event: PointerEvent): void => {
    if (event.type === "pointerdown") down = { id: event.pointerId, type: event.pointerType };
    followFingers(event);
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
    if (event.type !== "lostpointercapture") followFingers(event);
    if (event.type !== "lostpointercapture" && down?.id === event.pointerId) down = null;
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
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && has("gestures")) {
      // Gira la vista a passi di 15°, attorno al puntatore. Con Maiusc alcuni
      // sistemi mandano la rotella come orizzontale.
      wheelTurn += dy !== 0 ? dy : dx;
      if (Math.abs(wheelTurn) < TURN_WHEEL_PX) return;
      const direction = wheelTurn > 0 ? 1 : -1;
      wheelTurn = 0;
      const local = localPoint(event.clientX, event.clientY);
      placed = true;
      setCamera(turnTo(camera, nextTurn(camera.angle, direction), [local.x, local.y]));
      announceTurn();
    } else if (event.ctrlKey || event.metaKey) {
      // Il pizzico del trackpad arriva così, a passi piccoli; la rotella del
      // mouse a passi da 100: il limite tiene lo scatto entro il 22%.
      const step = Math.max(-50, Math.min(50, dy));
      const local = localPoint(event.clientX, event.clientY);
      setCamera(zoomAt(camera, Math.exp(-step * 0.005), [local.x, local.y], DRAW_SCALE_LIMITS));
    } else if (event.shiftKey && dx === 0) {
      setCamera(panned(camera, -dy, 0));
    } else {
      setCamera(panned(camera, -dx, -dy));
    }
  };
  /// La rotella che gira la vista, raccolta finché non fa un passo.
  let wheelTurn = 0;
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

  /// Le parole di `refusal`, il perché di un comando che non si fa.
  const unkeptText = (refusal: Unkept): string => {
    switch (refusal.kind) {
      case "selector":
        return t("draw.styled.selector", { selector: refusal.text });
      case "condition":
        return t("draw.styled.condition", { rule: refusal.text });
      case "lost":
        return t("draw.styled.lost", { property: refusal.property });
      case "new":
        return t("draw.styled.new", { property: refusal.property });
      case "object":
        return t("draw.styled.object", { property: refusal.property });
      case "copy":
        return t("draw.styled.copy");
      case "import":
        return t("draw.styled.import");
      case "unknown":
        return t("draw.styled.unknown");
    }
  };

  /// `arranged`, un comando che sposta gli elementi senza cambiarli, con lo
  /// stile che serve perché si vedano com'erano (vedi `styled.ts`), e la
  /// frase che dice su quanti elementi lo si è scritto, con lo spazio
  /// davanti; `null` se non si può, e lo si dice con la frase `styled.key`.
  const keptLook = (arranged: Arranged, styled: Styled): (Arranged & { readonly kept: string }) | null => {
    const model = engine.model;
    if (arranged.ops.length === 0 || model === null) return { ...arranged, kept: "" };
    const result = keepLook(engine.text, model, arranged.ops, { containers: styled.containers ?? "keep", taken: (id) => engine.holder(id) !== null });
    if (refused(result)) {
      announce(t(styled.key, { ...styled.vars, reason: unkeptText(result) }));
      return null;
    }
    // Un oggetto scelto che riceve un id per lo stile lo tiene come chiave.
    const named = new Map<string, string>();
    for (const op of result.ops.slice(arranged.ops.length)) if (op.op === "ident" && op.id !== null) named.set(`@${op.path.join(".")}`, op.id);
    const kept = result.written === 0 ? "" : ` ${plural(result.written, "draw.styled.kept.one", "draw.styled.kept.other")}`;
    return { ops: result.ops, keys: arranged.keys.map((key) => named.get(key) ?? key), kept };
  };

  /// Scrive `arranged` col nome `label`, e la selezione diventa la sua; la
  /// pagina cresce se `extent` ne esce. `null` se non c'era niente da
  /// cambiare, e lo si dice, o se il motore ha rifiutato; se no la frase da
  /// aggiungere a ciò che si dice, vuota o con lo spazio davanti. Con
  /// `styled`, un comando che sposta gli elementi senza cambiarli: lo stile
  /// resta com'era, o il comando non si fa e lo si dice (vedi
  /// [`keptLook`]).
  const arrange = (label: DrawKey, arranged: Arranged, extent: Bounds | null = null, styled: Styled | null = null): string | null => {
    if (arranged.ops.length === 0) {
      announce(t("draw.unchanged"));
      return null;
    }
    let kept = "";
    if (styled !== null) {
      const looked = keptLook(arranged, styled);
      if (looked === null) return null;
      arranged = looked;
      kept = looked.kept;
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
      return null;
    }
    select(arranged.keys);
    return kept;
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
    if (arrange("draw.action.duplicate", arranged, translated(boundsOf(units), step, step)) === null) return;
    announce(`${plural(units.length, "draw.duplicated.one", "draw.duplicated.other")} ${objects()}`);
  }

  function orderSelection(order: Order): void {
    const units = arranging("arrange");
    if (units === null) return;
    const kept = arrange("draw.action.order", orderOps(engine.model!, currentIndex(), units, order, newIds()), null, { key: "draw.order.styled" });
    if (kept !== null) announce(`${t(ORDERED[order])}${kept}`);
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
    const kept = arrange("draw.action.group", arranged, null, { key: "draw.group.styled" });
    if (kept !== null) announce(`${t("draw.grouped", { count: units.length })}${kept}`);
  }

  function ungroupSelection(): void {
    const units = arranging("arrange");
    if (units === null) return;
    const groups = units.filter(isGroup).length;
    if (groups === 0) {
      announce(t("draw.ungroup.none"));
      return;
    }
    const kept = arrange("draw.action.ungroup", ungroupOps(engine.model!, units, newIds()), null, { key: "draw.ungroup.styled" });
    if (kept !== null) announce(`${plural(groups, "draw.ungrouped.one", "draw.ungrouped.other")}${kept}`);
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
      if (arrange("draw.action.relink", relinkOps(engine.model!, again, href, newIds())) !== null) announce(t("draw.relinked", { note: linkName(href) }));
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
    const kept = arrange("draw.action.link", arranged, null, { key: "draw.link.styled" });
    if (kept !== null) announce(`${t("draw.linked", { note: linkName(href) })}${kept}`);
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
    const kept = arrange("draw.action.unlink", unlinkOps(engine.model!, units, newIds()), null, { key: "draw.unlink.styled" });
    if (kept !== null) announce(`${plural(count, "draw.unlinked.one", "draw.unlinked.other")}${kept}`);
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

  /// «Allinea»: gli oggetti scelti, o con lo strumento Nodi i nodi scelti.
  function alignSelection(edge: Edge): void {
    if (nodeKeysOn() && chosenCount() > 0) {
      alignNodes(edge);
      return;
    }
    const units = arranging("arrange");
    if (units === null) return;
    const reference = alignReference(units);
    if (reference === null) return;
    if (arrange("draw.action.align", alignOps(units, edge, reference, newIds())) !== null) {
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
    if (arrange("draw.action.distribute", distributeOps(units, axis, newIds())) !== null) announce(t("draw.distributed", { count }));
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

  // --- La selezione avanzata -------------------------------------------------

  /// Quando il menu della selezione si è aperto dalla tastiera.
  let keyedMenu = -Infinity;

  /// Dove si apre dalla tastiera il menu della selezione: sotto la
  /// selezione, o al cursore del foglio, dentro il foglio.
  const menuPoint = (): MouseEvent => {
    const rect = surface.getBoundingClientRect();
    const bounds = boundsOf(selectedUnits());
    // Sotto la selezione come si vede, anche sul foglio girato.
    const box = bounds === null ? null : screenBox(camera, bounds);
    const [sx, sy] = box === null ? toScreen(camera, cursorPoint()) : [box.min[0], box.max[1]];
    const x = Math.min(Math.max(sx, 0), rect.width);
    const y = Math.min(Math.max(sy, 0), rect.height);
    return new MouseEvent("contextmenu", { clientX: rect.left + x, clientY: rect.top + y });
  };

  /// Sceglie tutto ciò che si sceglie: nel gruppo isolato, o in cima.
  const selectAll = (): void => {
    cancelGesture();
    select(currentIndex().units.map((unit) => unit.key));
    announceSelection();
  };

  /// Sceglie tutto il resto: di un gruppo con un oggetto scelto, gli altri.
  const invertSelection = (): void => {
    cancelGesture();
    select(inverseOf(currentIndex(), selectedUnits()).map((unit) => unit.key));
    announceSelection();
  };

  /// Sceglie gli oggetti simili a quelli scelti per `by`, a ogni profondità.
  const selectSimilar = (by: Likeness): void => {
    const model = engine.model;
    const similar = model === null ? null : similarTo(model, currentIndex(), selectedUnits(), by);
    if (similar === null) {
      announce(t(selection.length === 0 ? "draw.selection.empty" : by === "tool" ? "draw.select.same_tool.none" : "draw.select.same.missing"));
      return;
    }
    cancelGesture();
    select(similar.map((unit) => unit.key));
    announceSelection();
  };

  /// Blocca o nasconde gli oggetti scelti, in un passo: non si scelgono più,
  /// o non si vedono più, e la selezione si svuota.
  const flagSelection = (flag: Flag): void => {
    const units = arranging("selection");
    if (units === null) return;
    const model = engine.model!;
    const arranged = flagOps(model, nodesOf(model, units), flag, true, newIds());
    if (arrange(flag === "locked" ? "draw.action.lock" : "draw.action.hide", arranged) !== null) {
      const count = arranged.keys.length;
      announce(flag === "locked" ? plural(count, "draw.locked.one", "draw.locked.other") : plural(count, "draw.hidden.one", "draw.hidden.other"));
    }
  };

  /// «Sblocca tutto» e «Mostra tutto»: gli oggetti bloccati, o nascosti, che
  /// si vedono e si cambiano, nel gruppo isolato o in tutto il disegno; poi
  /// sono loro la selezione, quelli che si scelgono.
  const unflagAll = (flag: Flag): void => {
    const model = engine.model;
    if (!has("selection") || !editable() || model === null) return;
    const nodes = flagged(model, isolatedNode(), flag);
    if (nodes.length === 0) {
      announce(t(flag === "locked" ? "draw.unlocked.none" : "draw.shown.none"));
      return;
    }
    cancelGesture();
    if (arrange(flag === "locked" ? "draw.action.unlock" : "draw.action.show", flagOps(model, nodes, flag, false, newIds())) !== null) {
      announce(flag === "locked" ? plural(nodes.length, "draw.unlocked.one", "draw.unlocked.other") : plural(nodes.length, "draw.shown.one", "draw.shown.other"));
    }
  };

  /// Un segno dell'albero, o Ctrl+Maiusc+L e H sulla sua riga attiva: blocca
  /// o sblocca, nasconde o mostra il livello o l'oggetto di chiave `key`. La
  /// selezione resta, meno ciò che non si sceglie più.
  const toggleRow = (key: string, flag: Flag): void => {
    const model = engine.model;
    const outlined = outlineNow().byKey.get(key);
    if (model === null || outlined === undefined || !editable()) return;
    if (outlined.item.role === "layer") {
      const layer = currentIndex().layers.find((each) => keyOf(each) === key);
      if (layer === undefined || !has("layers")) return;
      const on = flag === "locked" ? !layer.locked : !layer.hidden;
      cancelGesture();
      const arranged = flag === "locked" ? lockLayerOps(model, layer, on, newIds()) : hideLayerOps(model, layer, on, newIds());
      const label: DrawKey = flag === "locked" ? (on ? "draw.action.layer_lock" : "draw.action.layer_unlock") : on ? "draw.action.layer_hide" : "draw.action.layer_show";
      const said: DrawKey = flag === "locked" ? (on ? "draw.layer.locked" : "draw.layer.unlocked") : on ? "draw.layer.hidden" : "draw.layer.shown";
      if (writeLayers(label, arranged, null)) announce(t(said, { name: layerTitle(layer) }));
      return;
    }
    if (!has("selection")) return;
    const node = nodeOf(model, outlined.item);
    const on = node.details?.[flag] !== true;
    // Il nome senza lo stato di prima: lo stato nuovo lo dice l'annuncio.
    const name = describeNode(outlined, currentIndex().get(key) ?? undefined, false);
    cancelGesture();
    const label: DrawKey = flag === "locked" ? (on ? "draw.action.lock" : "draw.action.unlock") : on ? "draw.action.hide" : "draw.action.show";
    const said: DrawKey = flag === "locked" ? (on ? "draw.object.locked" : "draw.object.unlocked") : on ? "draw.object.hidden" : "draw.object.shown";
    if (commit(label, asGesture(flagOps(model, [node], flag, on, newIds()).ops)) !== null) announce(t(said, { name }));
  };

  /// Le voci della selezione avanzata: gli appunti e lo stile, scegliere
  /// tutto e il resto, i simili, bloccare e nascondere, sbloccare e mostrare
  /// tutto, isolare. Una voce che adesso non serve è spenta e dice perché.
  const selectionItems = (): MenuItem[] => {
    const model = engine.model;
    const index = currentIndex();
    const units = selectedUnits();
    const canEdit = editable();
    const none = units.length === 0;
    const empty = index.units.length === 0;
    const unselected = none ? { description: t("draw.selection.empty") } : {};
    const items: MenuItem[] = [
      { label: t("draw.cut"), hint: displayBinding("Mod-x"), disabled: !canEdit || none, ...(canEdit ? unselected : {}), run: () => clipboardCommand("cut") },
      { label: t("draw.copy"), hint: displayBinding("Mod-c"), disabled: none, ...unselected, run: () => clipboardCommand("copy") },
      { label: t("draw.paste"), hint: displayBinding("Mod-v"), disabled: !canEdit, run: () => void pasteFromMenu(false) },
      { label: t("draw.paste.in_place"), hint: displayBinding("Mod-Shift-v"), disabled: !canEdit, run: () => void pasteFromMenu(true) },
    ];
    if (has("style")) {
      const pastable = canEdit && !none && copiedStyle !== null;
      const why = copiedStyle === null ? t("draw.style.empty", { key: displayBinding(COPY_STYLE_BINDING) }) : t("draw.selection.empty");
      items.push(
        { label: t("draw.style.copy"), separator: true, hint: displayBinding(COPY_STYLE_BINDING), disabled: none, ...unselected, run: () => copyStyle() },
        { label: t("draw.style.paste"), hint: displayBinding(PASTE_STYLE_BINDING), disabled: !pastable, ...(canEdit && !pastable ? { description: why } : {}), run: () => pasteStyle() },
      );
    }
    items.push(
      { label: t("draw.select.all"), separator: true, hint: displayBinding("Mod-a"), disabled: empty, run: () => selectAll() },
      { label: t("draw.select.invert"), disabled: empty, run: () => invertSelection() },
    );
    const likenesses = LIKENESSES.filter(({ by }) => by !== "layer" || has("layers"));
    likenesses.forEach(({ by, label }, at) => {
      const usable = model !== null && !none && hasLikeness(model, index, units, by);
      const why: DrawKey = none ? "draw.selection.empty" : by === "tool" ? "draw.select.same_tool.none" : "draw.select.same.missing";
      items.push({ label: t(label), separator: at === 0, disabled: !usable, ...(usable ? {} : { description: t(why) }), run: () => selectSimilar(by) });
    });
    if (has("layers")) {
      // F2 sul foglio scrive un testo: per lui il tasto non vale.
      const lone = units.length === 1;
      const text = lone && units[0]!.look !== null && has("text");
      items.push({
        label: t("draw.rename"),
        separator: true,
        ...(lone && !text ? { hint: displayBinding("F2") } : {}),
        disabled: !canEdit || !lone,
        ...(canEdit && !lone ? { description: t("draw.rename.none") } : {}),
        run: () => renameSelection(),
      });
    }
    const unlockable = canEdit && model !== null && flagged(model, isolatedNode(), "locked").length > 0;
    const showable = canEdit && model !== null && flagged(model, isolatedNode(), "hidden").length > 0;
    items.push(
      {
        label: t("draw.lock"),
        separator: true,
        hint: displayBinding("Mod-Shift-l"),
        disabled: !canEdit || none,
        ...(canEdit && none ? { description: t("draw.selection.empty") } : {}),
        run: () => flagSelection("locked"),
      },
      {
        label: t("draw.hide"),
        hint: displayBinding("Mod-Shift-h"),
        disabled: !canEdit || none,
        ...(canEdit && none ? { description: t("draw.selection.empty") } : {}),
        run: () => flagSelection("hidden"),
      },
      { label: t("draw.unlock_all"), disabled: !unlockable, ...(canEdit && !unlockable ? { description: t("draw.unlocked.none") } : {}), run: () => unflagAll("locked") },
      { label: t("draw.show_all"), disabled: !showable, ...(canEdit && !showable ? { description: t("draw.shown.none") } : {}), run: () => unflagAll("hidden") },
    );
    const single = units.length === 1 && (units[0]!.role === "group" || units[0]!.role === "link");
    items.push({
      label: t("draw.isolate"),
      separator: true,
      hint: displayBinding("Mod-Enter"),
      disabled: !single,
      ...(single ? {} : { description: t("draw.isolate.none") }),
      run: () => isolateSelection(),
    });
    if (isolatedNode() !== null) items.push({ label: t("draw.isolate.exit"), hint: "Esc", run: () => leaveIsolation(false) });
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
    if (arrange(label, outlined) !== null) announce(plural(outlined.changed, "draw.outlined.one", "draw.outlined.other", { style }));
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
    if (arrange("draw.action.transform", transformed, boundsAfter(units, m)) !== null) {
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
    if (arrange("draw.action.apply_transform", applied) !== null) announce(`${plural(applied.changed, "draw.applied.one", "draw.applied.other")}${kept}`);
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
    if (arrange("draw.action.to_path", traced) !== null) announce(`${plural(traced.changed, "draw.traced.one", "draw.traced.other")}${refused}`);
  }

  /// Le voci del menu Tracciato: spente, e dicono perché, quando fra gli
  /// oggetti scelti non c'è niente su cui lavorano.
  const pathItems = (): MenuItem[] => {
    const units = selectedUnits();
    const index = currentIndex();
    const shapes = holdsShape(index, units);
    const when = (usable: boolean, reason: DrawKey): Pick<MenuItem, "disabled" | "description"> =>
      usable ? { disabled: false } : { disabled: true, description: t(units.length === 0 ? "draw.selected.none" : reason) };
    return [
      { label: t("draw.to_path"), ...when(units.length > 0, "draw.selected.none"), run: () => traceSelection() },
      { label: t("draw.outline_stroke"), ...when(holdsStroke(index, units), "draw.outline_stroke.none"), run: () => strokeToPath() },
      { label: t("draw.ink_path"), ...when(units.some(holdsPenStroke), "draw.ink_path.none"), run: () => inkPathSelection() },
      { label: t("draw.offset"), separator: true, ...when(shapes, "draw.paths.no_shape"), run: () => openPaths("offset") },
      { label: t("draw.simplify"), ...when(shapes, "draw.paths.no_shape"), run: () => openPaths("simplify") },
      { label: t("draw.join"), separator: true, hint: displayBinding("Mod-j"), ...when(holdsOpenPath(engine.model!, units), "draw.join.none"), run: () => joinSelection() },
    ];
  };

  /// «Unisci» (Ctrl+J), dal livello Esperto: i capi più vicini dei tracciati
  /// aperti scelti si uniscono, nel più in basso, finché sono uno solo; un
  /// tracciato solo si chiude. Due capi che sullo schermo si toccano
  /// diventano un nodo solo; altrimenti li unisce una linea.
  function joinSelection(): void {
    const units = arranging("path");
    if (units === null) return;
    const done = joinOps(engine.model!, units, JOIN_PX / camera.scale, newIds());
    if ("reason" in done) {
      announce(joinRefusal(done));
      return;
    }
    if (arrange("draw.action.join_paths", done) === null) return;
    const { closed, lines } = done.joined;
    const what = units.length === 1 && closed ? "draw.join.closed" : closed ? "draw.join.joined_closed" : "draw.join.joined";
    announce(`${t(what)}${lines === 0 ? "" : ` ${plural(lines, "draw.join.lines.one", "draw.join.lines.other")}`}`);
  }

  /// Perché «Unisci» non si fa, a parole.
  const joinRefusal = (refused: JoinRefused): string => {
    switch (refused.reason) {
      case "none":
        return t("draw.selected.none");
      case "not_paths":
        return plural(refused.count, "draw.join.not_paths.one", "draw.join.not_paths.other");
      case "closed":
        return t("draw.join.closed_path");
      case "line":
        return t("draw.join.line");
      case "foreign":
        return t("draw.nodes.unwritable");
      case "failed":
        return t("draw.join.failed");
    }
  };

  /// «Contorno in tracciato», dal livello Esperto: il contorno di ogni forma
  /// scelta diventa una forma piena del suo colore, coi trattini, gli
  /// estremi e gli angoli. Una forma che ha anche un riempimento diventa un
  /// gruppo col suo id: il riempimento sotto, il contorno sopra.
  function strokeToPath(): void {
    const units = arranging("path");
    if (units === null) return;
    const done = outlineStrokeOps(engine.model!, currentIndex(), units, newIds());
    const notes = [
      done.refused === 0 ? "" : ` ${plural(done.refused, "draw.stroked.refused.one", "draw.stroked.refused.other")}`,
      done.skipped === 0 ? "" : ` ${plural(done.skipped, "draw.stroked.skipped.one", "draw.stroked.skipped.other")}`,
    ].join("");
    if (done.ops.length === 0) {
      announce(`${t("draw.unchanged")}${notes}`);
      return;
    }
    if (arrange("draw.action.outline_stroke", done) !== null) announce(`${plural(done.changed, "draw.stroked.one", "draw.stroked.other")}${notes}`);
  }

  /// «Inchiostro in tracciato», dal livello Esperto: ogni tratto a penna
  /// scelto diventa la sua spina, un tracciato coi nodi che lo strumento
  /// Nodi mostra, col colore dell'inchiostro e lo spessore del pennello.
  function inkPathSelection(): void {
    const units = arranging("path");
    if (units === null) return;
    const done = inkPathOps(engine.model!, currentIndex(), units, newIds());
    const refused = done.refused === 0 ? "" : ` ${plural(done.refused, "draw.inked.refused.one", "draw.inked.refused.other")}`;
    if (done.ops.length === 0) {
      announce(`${t("draw.unchanged")}${refused}`);
      return;
    }
    if (arrange("draw.action.ink_path", done) !== null) announce(`${plural(done.changed, "draw.inked.one", "draw.inked.other")}${refused}`);
  }

  /// Apre la barra di `mode` sugli oggetti scelti, coi valori dell'ultima
  /// volta, e porta il fuoco al suo campo.
  function openPaths(mode: "offset" | "simplify"): void {
    if (arranging("path") === null) return;
    closeDescriptions();
    pathsMode = mode;
    pathsShown = null;
    const unit = docUnit();
    offsetUnit = unit;
    offsetInput.value = fieldText(offsetLast ?? fromUnit(OFFSET_START[unit], unit), unit);
    joinSelect.value = joinLast;
    limitInput.value = formatNumber(limitLast, 2);
    amountInput.value = String(amountLast);
    showPaths();
    showHandles();
    if (mode === "offset") {
      offsetInput.focus({ preventScroll: true });
      offsetInput.select();
    } else {
      amountInput.focus({ preventScroll: true });
    }
  }

  /// Chiude la barra e toglie l'anteprima; il fuoco, se era nella barra,
  /// torna al foglio.
  function closePaths(): void {
    if (pathsMode === null) return;
    const focused = pathsBar.contains(document.activeElement);
    pathsMode = null;
    pathsShown = null;
    pathsBar.hidden = true;
    showHandles();
    if (focused) surface.focus({ preventScroll: true });
  }

  /// La barra com'è adesso: il titolo, i campi del suo comando, e il limite
  /// solo con gli angoli vivi. Se il documento ha cambiato unità, la
  /// distanza scritta passa alla nuova.
  function showPaths(): void {
    const unit = docUnit();
    if (unit !== offsetUnit) {
      const value = Number(offsetInput.value);
      if (offsetInput.value !== "" && Number.isFinite(value)) offsetInput.value = fieldText(fromUnit(value, offsetUnit), unit);
      offsetUnit = unit;
    }
    offsetField.name.textContent = unitSuffix(t("draw.offset.distance"), unit);
    pathsBar.hidden = pathsMode === null;
    if (pathsMode === null) return;
    const offset = pathsMode === "offset";
    pathsTitle.textContent = t(offset ? "draw.offset.title" : "draw.simplify.title");
    offsetField.field.hidden = !offset;
    joinField.field.hidden = !offset;
    limitField.field.hidden = !offset || joinNow() !== "miter";
    amountField.field.hidden = offset;
  }

  /// Dopo ogni cambio: la barra si chiude se il livello o il documento non
  /// la vogliono più.
  function syncPaths(): void {
    if (pathsMode === null) return;
    if (!has("path") || !editable()) closePaths();
    else showPaths();
  }

  /// La distanza scritta, in unità della scena; 0 se non si legge.
  function offsetNow(): number {
    return fieldValue(offsetInput.value);
  }

  function joinNow(): Join {
    const value = joinSelect.value as Join;
    return JOIN_NAMES.has(value) ? value : "miter";
  }

  /// Il limite degli angoli vivi scritto: quello di SVG se non si legge.
  function limitNow(): number {
    const value = Number(limitInput.value);
    return limitInput.value !== "" && Number.isFinite(value) && value >= 1 ? value : 4;
  }

  /// Lo scarto di «Semplifica» per `units`, in unità della scena: la parte
  /// della diagonale delle loro forme che il cursore dice. `null` senza
  /// geometria.
  function toleranceFor(units: readonly Unit[]): number | null {
    const bounds = geometryOf(units);
    if (bounds === null) return null;
    const diagonal = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
    const step = Math.min(SIMPLIFY_STEPS, Math.max(0, Number(amountInput.value) || 0));
    const tolerance = diagonal * SIMPLIFY_LEAST * (SIMPLIFY_MOST / SIMPLIFY_LEAST) ** (step / SIMPLIFY_STEPS);
    return tolerance > 0 && Number.isFinite(tolerance) ? tolerance : null;
  }

  /// Uno scarto, piccolo, nell'unità del documento: due cifre significative,
  /// in pixel il numero solo.
  function deviationText(value: number): string {
    const unit = docUnit();
    const number = new Intl.NumberFormat(resolvedLanguage(), { maximumSignificantDigits: 2 }).format(toUnit(value, unit));
    return unit === "px" ? number : `${number} ${unit}`;
  }

  /// Ciò che la barra farebbe agli oggetti `units`: le operazioni, le forme
  /// di dopo nella scena, la frase che lo dice nella barra e quella da dire
  /// dopo averlo fatto. Una frase sola se non c'è niente da fare.
  function pathsPlan(units: readonly Unit[]): {
    readonly arranged: Arranged;
    readonly label: DrawKey;
    readonly preview: readonly (readonly Segment[])[];
    readonly nodes: boolean;
    readonly extent: Bounds | null;
    readonly status: string;
    readonly done: string;
  } | string {
    const model = engine.model;
    const index = currentIndex();
    if (model === null || units.length === 0) return t("draw.paths.none");
    if (!holdsShape(index, units)) return t("draw.paths.no_shape");
    const note = (count: number, one: DrawKey, other: DrawKey): string[] => (count === 0 ? [] : [plural(count, one, other)]);
    if (pathsMode === "offset") {
      const distance = offsetNow();
      if (distance === 0) return t("draw.offset.zero");
      const done = offsetOps(model, index, units, distance, { join: joinNow(), miterLimit: limitNow() }, newIds());
      const notes = [
        ...note(done.vanished, "draw.offset.vanished.one", "draw.offset.vanished.other"),
        ...note(done.refused, "draw.paths.refused.one", "draw.paths.refused.other"),
        ...note(done.skipped, "draw.paths.skipped.one", "draw.paths.skipped.other"),
      ];
      const extent = new BoundsBuilder();
      for (const segments of done.preview) extent.path(segments, IDENTITY);
      return {
        arranged: done,
        label: "draw.action.offset",
        preview: done.preview,
        nodes: false,
        extent: extent.finish(),
        status: [...(done.changed === 0 ? [] : [plural(done.changed, "draw.offset.new.one", "draw.offset.new.other")]), ...notes].join(" ") || t("draw.unchanged"),
        done: [plural(done.changed, "draw.offset.done.one", "draw.offset.done.other", { distance: lengthSpoken(distance) }), ...notes].join(" "),
      };
    }
    const tolerance = toleranceFor(units);
    if (tolerance === null) return t("draw.paths.no_shape");
    const done = simplifyOps(model, index, units, tolerance, newIds());
    const length = deviationText(tolerance);
    const notes = [
      ...note(done.refused, "draw.paths.refused.one", "draw.paths.refused.other"),
      ...(units.some(holdsPenStroke) ? [t("draw.simplify.ink")] : []),
    ];
    const counts = done.after < done.before
      ? t("draw.simplify.nodes", { before: done.before, after: done.after, length })
      : plural(done.before, "draw.simplify.same.one", "draw.simplify.same.other", { length });
    return {
      arranged: done,
      label: "draw.action.simplify",
      preview: done.preview,
      nodes: done.after <= PREVIEW_NODES,
      extent: null,
      status: [counts, ...notes].join(" "),
      done: [plural(done.changed, "draw.simplified.one", "draw.simplified.other", { before: done.before, after: done.after }), ...notes].join(" "),
    };
  }

  /// L'anteprima per la selezione e l'indice di adesso: si rifà solo se
  /// sono cambiati, o se le regole della barra l'hanno tolta. Scrive anche
  /// nella barra che cosa succederà.
  function pathsNow(): NonNullable<typeof pathsShown> {
    const index = currentIndex();
    if (pathsShown !== null && pathsShown.selection === selection && pathsShown.index === index) return pathsShown;
    const units = editable() ? selectedUnits() : [];
    const plan = pathsPlan(units);
    const handles: OverlayHandle[] = [];
    if (typeof plan !== "string") {
      for (const segments of plan.preview) handles.push({ kind: "outline", segments, matrix: IDENTITY });
      if (plan.nodes) {
        for (const segments of plan.preview) {
          for (const sub of readNodes(segments)) {
            sub.nodes.forEach(([x, y], at) => {
              handles.push({ kind: "node", x, y, shape: NODE_SHAPES[innerNode(sub, at) ? kindOf(sub, at) : "corner"], selected: false, hint: true });
            });
          }
        }
      }
    }
    pathsStatus.textContent = typeof plan === "string" ? plan : plan.status;
    if (pathsMode === "simplify") {
      const tolerance = toleranceFor(units);
      if (tolerance === null) amountInput.removeAttribute("aria-valuetext");
      else amountInput.setAttribute("aria-valuetext", t("draw.simplify.tolerance", { length: deviationText(tolerance) }));
    }
    pathsShown = { selection, index, handles };
    return pathsShown;
  }

  /// L'anteprima della barra aperta: le forme di dopo, e con «Semplifica»
  /// i loro nodi.
  function pathsHandles(): readonly OverlayHandle[] {
    return pathsMode === null ? [] : pathsNow().handles;
  }

  /// «Applica» e Invio: lo scostamento o la semplificazione si scrive, in un
  /// passo di annulla, e la barra si chiude. Senza niente da fare resta
  /// aperta, e dice perché.
  function applyPaths(): void {
    if (pathsMode === null) return;
    const units = arranging("path");
    if (units === null) return;
    const plan = pathsPlan(units);
    if (typeof plan === "string" || plan.arranged.ops.length === 0) {
      announce(typeof plan === "string" ? plan : plan.status);
      return;
    }
    if (pathsMode === "offset") {
      offsetLast = offsetNow();
      joinLast = joinNow();
      limitLast = limitNow();
    } else {
      amountLast = Number(amountInput.value);
    }
    closePaths();
    surface.focus({ preventScroll: true });
    if (arrange(plan.label, plan.arranged, plan.extent) !== null) announce(plan.done);
  }

  for (const control of [offsetInput, joinSelect, limitInput, amountInput]) {
    life.listen(control, "input", () => {
      pathsShown = null;
      showPaths();
      showHandles();
    });
  }
  life.listen(pathsApply, "click", () => applyPaths());
  life.listen(pathsCancel, "click", () => closePaths());
  // Invio in un campo applica; Esc chiude la barra senza cambiare niente.
  life.listen(pathsBar, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePaths();
      surface.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "Enter" || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    applyPaths();
  });

  /// Vero se `unit` è un tratto a penna, o ne contiene uno che non è
  /// bloccato.
  function holdsPenStroke(unit: Unit): boolean {
    if (unit.role === "group" || unit.role === "link") return currentIndex().children(unit).some(holdsPenStroke);
    return isPenStroke(unit.node);
  }

  /// «Rendi forma», dal livello Standard: ogni tratto a penna scelto diventa
  /// la forma a cui somiglia, in un passo di annulla. Quelli che non
  /// somigliano a una forma restano inchiostro, e lo si dice.
  function shapeSelectedInk(): void {
    const units = arranging("recognize");
    if (units === null) return;
    const shaped = inkShapeOps(engine.model!, currentIndex(), units, newIds());
    const refused = shaped.refused === 0 ? "" : ` ${plural(shaped.refused, "draw.shaped.refused.one", "draw.shaped.refused.other")}`;
    if (shaped.ops.length === 0) {
      announce(`${t("draw.unchanged")}${refused}`);
      return;
    }
    if (arrange("draw.action.to_shape", shaped, shaped.extent) !== null) announce(`${plural(shaped.changed, "draw.shaped.one", "draw.shaped.other")}${refused}`);
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
    if (arrange(action, combined) === null) return;
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

  /// Scrive i nodi nuovi di ogni forma di `changes` col nome `label`, in un
  /// passo di annulla solo, e la pagina cresce se una forma ne esce. Un
  /// tracciato scrive il suo `d`; una forma resta lei finché i nodi ne
  /// disegnano una come lei, altrimenti diventa un tracciato; una freccia
  /// sposta i capi e un tratto a penna il suo inchiostro. Una forma rimasta
  /// senza nodi se ne va. Una forma che non accetta la modifica resta com'è,
  /// e ciò che si dice dopo aggiunge perché ([`afterEdit`]). Dopo sono scelti
  /// i nodi `selected` di ogni forma, coi tipi `kinds`; quelli di una forma
  /// rimasta com'è non cambiano. Torna se ha scritto, e quanto ha cambiato:
  /// la somma di `changed` delle forme che hanno accettato. `null` se non
  /// scrive niente, e lo dice, o il motore ha rifiutato.
  const writeEdits = (label: DrawKey, changes: readonly NodeChange[]): { readonly written: boolean; readonly count: number } | null => {
    const model = engine.model;
    converted = 0;
    skipped = null;
    if (model === null || !editable() || changes.length === 0) return null;
    const plan = new Plan(model, newIds());
    const accepted: NodeChange[] = [];
    const removed: (readonly number[])[] = [];
    const learned: Array<readonly [string, Spine]> = [];
    let written = 0;
    let conversions = 0;
    let extent: Bounds | null = null;
    let refusal: DrawKey | null = null;
    for (const change of changes) {
      const { edit } = change;
      const rewritten = pathData(writeNodes(change.subs)) === pathData(writeNodes(edit.subs)) ? null : rewrite(edit.nodable, change.subs, change.moved ?? null);
      if (rewritten?.kind === "refused") {
        refusal ??= NODES_REFUSED[rewritten.reason];
        continue;
      }
      if (rewritten === null || rewritten.kind === "same") {
        accepted.push(change);
        continue;
      }
      if (rewritten.kind === "remove") {
        removed.push(edit.path);
      } else {
        const node = nodeOf(model, edit);
        // Una forma che non sa diventare un tracciato si prova prima a parte:
        // le sue operazioni a metà non entrano nel passo delle altre.
        if (rewritten.kind === "path" && rewriteOps(new Plan(model, newIds()), node, rewritten) === null) {
          refusal ??= "draw.nodes.unwritable";
          continue;
        }
        const after = rewriteOps(plan, node, rewritten);
        if (after === null) {
          refusal ??= "draw.nodes.unwritable";
          continue;
        }
        extent = union(extent, elemBounds(after, edit.matrix));
        if (rewritten.kind === "set" && rewritten.spine !== undefined) learned.push([rewritten.attrs["fub:ink"]!, rewritten.spine]);
        if (rewritten.kind === "path" && edit.nodable.kind !== "path") conversions++;
      }
      accepted.push(change);
      written++;
    }
    if (accepted.length === 0) {
      announce(t(refusal ?? "draw.unchanged"));
      showHandles();
      return null;
    }
    // Le forme che se ne vanno, dall'ultima: i percorsi di quelle prima
    // restano quelli del modello di adesso.
    removed.sort((a, b) => comparePaths(b, a));
    for (const path of removed) {
      const node = nodeOf(model, { path });
      plan.ops.push({ op: "remove", target: node.facts.id ?? { path: [...path], tag: tagName(node) } });
    }
    // Gli oggetti scelti restano, tranne una forma sola che se ne va. Uno
    // senza id ha la chiave del suo posto, che una forma tolta prima di lui
    // sposta.
    const keys = selectedUnits().flatMap((unit) => {
      const path = pathAfter(unit.path, removed);
      return path === null ? [] : [plan.keyOf(unit.node, keyOf({ id: unit.id, path }))];
    });
    const before = edits;
    const pick = nodeSelection;
    const given = nodeKinds;
    // Le spine si ricordano prima di scrivere: i nodi dei tratti nuovi si
    // cercano appena il disegno cambia, e una volta trovati restano quelli.
    for (const [ink, spine] of learned) remember(ink, spine);
    const point = history.position;
    if (written > 0 && arrange(label, plan.finish(keys), extent) === null) return null;
    converted = conversions;
    skipped = refusal;
    // I nodi scelti e i tipi dati, per forma, dove le forme sono finite.
    const moved = (key: string): string | null => pathAfter(key.split(".").map(Number), removed)?.join(".") ?? null;
    focused = focused.flatMap((path) => {
      const next = pathAfter(path, removed);
      return next === null ? [] : [next];
    });
    const byShape = new Map(accepted.map((change) => [change.edit.key, change]));
    const nextPick = new Map<string, Iterable<NodeKey>>();
    const nextKinds = new Map<string, ReadonlyMap<NodeKey, NodeKind>>();
    for (const edit of before) {
      const key = moved(edit.key);
      if (key === null) continue;
      const change = byShape.get(edit.key);
      const chosen = change === undefined ? pick.get(edit.key) : change.selected;
      const kinds = change === undefined ? given.get(edit.key) : change.kinds;
      if (chosen !== undefined) nextPick.set(key, chosen);
      if (kinds !== undefined && kinds.size > 0) nextKinds.set(key, kinds);
    }
    refreshNodes();
    nodeKinds = nextKinds;
    if (written > 0) kindsAt.set(point, given);
    kindsAt.set(history.position, nextKinds);
    for (const at of kindsAt.keys()) if (at < history.start) kindsAt.delete(at);
    setNodes(nextPick);
    return { written: written > 0, count: accepted.reduce((sum, change) => sum + (change.changed ?? 1), 0) };
  };

  /// `text`, e dopo l'ultima modifica dei nodi anche quante forme sono
  /// diventate tracciati, e perché qualcuna è rimasta com'era.
  const afterEdit = (text: string): string => {
    let out = text;
    if (converted > 0) out += ` ${plural(converted, "draw.nodes.converted.one", "draw.nodes.converted.other")}`;
    if (skipped !== null) out += ` ${t(skipped)}`;
    return out;
  };

  /// Le forme su cui lavora un comando dei nodi: quelle coi nodi scelti.
  /// Nessuna, e lo si dice, se non ci sono forme o nodi scelti.
  const noding = (): Editing[] => {
    if (!editable()) return [];
    refreshNodes();
    if (edits.length === 0) {
      announceTarget();
      return [];
    }
    const chosen = chosenEdits();
    if (chosen.length === 0) {
      announce(t("draw.nodes.selected.none"));
      return [];
    }
    cancelGesture();
    return chosen;
  };

  /// Dice che i nodi scelti si sono spostati: dove, se è uno solo, e `note`,
  /// a che cosa si sono agganciati.
  const announceMoved = (note = ""): void => {
    const chosen = chosenEdits();
    const count = chosenCount();
    if (count === 1) {
      const [x, y] = nodePoint(chosen[0]!, [...pickedIn(chosen[0]!)][0]!);
      announce(afterEdit(noted(t("draw.nodes.moved.at", { x: coordText(x), y: coordText(y) }), note)));
      return;
    }
    announce(afterEdit(noted(plural(count, "draw.nodes.moved.one", "draw.nodes.moved.other"), note)));
  };

  /// Le modifiche di `edit` sulle forme `chosen`, coi loro nodi scelti, che
  /// cambiano qualcosa.
  const changesOf = (chosen: readonly Editing[], edit: (each: Editing, keys: ReadonlySet<NodeKey>) => Edited): NodeChange[] =>
    chosen.flatMap((each) => {
      const edited = edit(each, pickedIn(each));
      return edited.changed === 0 ? [] : [changeOf(each, edited)];
    });

  /// Insert, o «Aggiungi nodi»: un nodo a metà di ogni segmento fra due nodi
  /// scelti. Dopo sono scelti i nodi nuovi.
  function insertSelectedNodes(): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = changesOf(chosen, (each, keys) => insertNodes(each.subs, keys));
    if (changes.length === 0) {
      announce(t("draw.nodes.insert.none"));
      return;
    }
    const done = writeEdits("draw.action.nodes_insert", changes);
    if (done?.written === true) announce(afterEdit(plural(done.count, "draw.nodes.inserted.one", "draw.nodes.inserted.other")));
  }

  /// Canc, o «Elimina nodi»: i segmenti attorno si uniscono in una curva che
  /// passa vicino a dov'erano. Mai l'oggetto: senza nodi scelti non elimina
  /// niente, ma una forma rimasta senza nodi se ne va.
  function deleteSelectedNodes(): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = changesOf(chosen, (each, keys) => deleteNodes(each.subs, keys));
    const done = writeEdits("draw.action.nodes_delete", changes);
    if (done?.written !== true) return;
    const gone = changes.filter((change) => change.subs.length === 0).length;
    if (gone === changes.length) announce(`${plural(gone, "draw.nodes.deleted.all.one", "draw.nodes.deleted.all.other")} ${objects()}`);
    else announce(afterEdit(plural(done.count, "draw.nodes.deleted.one", "draw.nodes.deleted.other")));
  }

  /// Maiusc+C, S o Y: i nodi scelti a spigolo, lisci o simmetrici. Il tipo
  /// resta ai nodi anche dove la geometria non cambia, come per lo spigolo.
  function kindSelectedNodes(kind: NodeKind): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = changesOf(chosen, (each, keys) => setKind(each.subs, keys, kind)).map((change) => {
      const kinds = new Map(change.kinds);
      for (const key of change.selected) {
        const [s, at] = parseKey(key);
        if (innerNode(change.subs[s]!, at)) kinds.set(key, kind);
      }
      return { ...change, kinds };
    });
    if (changes.length === 0) {
      announce(t("draw.nodes.kind.none"));
      return;
    }
    const done = writeEdits("draw.action.nodes_kind", changes);
    if (done === null) return;
    const [one, other] = MADE[kind];
    announce(afterEdit(plural(done.count, one, other)));
  }

  /// Maiusc+L o U: i segmenti fra due nodi scelti in linee o in curve.
  function linkSelectedNodes(kind: "line" | "curve"): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = changesOf(chosen, (each, keys) => setLinks(each.subs, keys, kind));
    if (changes.length === 0) {
      announce(t(chosen.some((each) => linksBetween(each.subs, pickedIn(each)).any) ? "draw.unchanged" : "draw.nodes.links.none"));
      return;
    }
    const done = writeEdits("draw.action.segments", changes);
    if (done === null) return;
    announce(afterEdit(kind === "line"
      ? plural(done.count, "draw.nodes.lines.one", "draw.nodes.lines.other")
      : plural(done.count, "draw.nodes.curves.one", "draw.nodes.curves.other")));
  }

  /// Maiusc+B: le forme si spezzano ai nodi scelti.
  function breakSelectedNodes(): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = changesOf(chosen, (each, keys) => breakNodes(each.subs, keys));
    if (changes.length === 0) {
      announce(t("draw.nodes.break.none"));
      return;
    }
    const done = writeEdits("draw.action.nodes_break", changes);
    if (done === null) return;
    announce(afterEdit(plural(done.count, "draw.nodes.broken.one", "draw.nodes.broken.other")));
  }

  /// Quanto lontani due capi della forma `edit` possono stare, nelle sue
  /// coordinate, e diventare un nodo solo: [`JOIN_PX`] sullo schermo.
  const joinReach = (edit: Editing): number => (JOIN_PX / camera.scale) * scaleOf(edit.inverse);

  /// Maiusc+J o Ctrl+J: unisce i due capi scelti di ogni forma; o, con un
  /// capo scelto in ognuna di due forme, le fa una: quella più in basso
  /// prende il sottotracciato dell'altra, come «Unisci». Due capi che sullo
  /// schermo si toccano diventano un nodo solo; altrimenti li unisce una
  /// linea.
  function joinSelectedNodes(): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = chosen.flatMap((each) => {
      const [a, b, ...more] = pickedIn(each);
      const edited = a === undefined || b === undefined || more.length > 0 ? null : joinEnds(each.subs, a, b, joinReach(each));
      return edited === null ? [] : [changeOf(each, edited)];
    });
    if (changes.length === 0) {
      const across = chosen.length === 2 && chosen.every((each) => pickedIn(each).size === 1) ? joinTwo(chosen) : "draw.nodes.join.none";
      if (typeof across === "string") {
        announce(t(across));
        return;
      }
      if (writeEdits("draw.action.nodes_join", across) !== null) announce(afterEdit(t("draw.nodes.joined_across")));
      return;
    }
    const closed = changes.length === 1 && changes[0]!.subs.length === changes[0]!.edit.subs.length;
    const done = writeEdits("draw.action.nodes_join", changes);
    if (done === null) return;
    announce(afterEdit(changes.length > 1
      ? plural(changes.length, "draw.nodes.joined_in.one", "draw.nodes.joined_in.other")
      : t(closed ? "draw.nodes.closed" : "draw.nodes.joined")));
  }

  /// I capi scelti di due forme, uno per forma, uniti nella più in basso,
  /// che prende il sottotracciato dell'altra; l'altra lo perde, e se era il
  /// solo se ne va. Perché no, se non si uniscono: una freccia e un tratto a
  /// penna restano soli.
  const joinTwo = (chosen: readonly Editing[]): NodeChange[] | DrawKey => {
    const [first, second] = [...chosen].sort((a, b) => comparePaths(a.path, b.path)) as [Editing, Editing];
    for (const each of [first, second]) if (!cuttable(each.nodable)) return each.nodable.kind === "arrow" ? "draw.nodes.arrow" : "draw.nodes.stroke";
    const [a] = pickedIn(first);
    const [b] = pickedIn(second);
    const joined = joinAcross(first.subs, a!, second.subs, b!, compose(first.inverse, second.matrix), joinReach(first));
    if (joined === null) return "draw.nodes.join.none";
    const { rest } = joined;
    return [
      changeOf(first, joined.kept),
      { edit: second, subs: rest.subs, selected: [], kinds: remapped(nodeKinds.get(second.key) ?? NO_KINDS, rest.moved), moved: rest.moved },
    ];
  };

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
    const chosen = noding();
    if (chosen.length === 0) return;
    let delta: Point;
    if (fine) {
      delta = [x / camera.scale, y / camera.scale];
    } else if (gridOn()) {
      const [left, top] = nodesBox(chosen)!.min;
      const lines = big ? GRID_MAJOR : 1;
      delta = [x === 0 ? 0 : lineBeyond(left, stepNow(), sign(x), lines) - left, y === 0 ? 0 : lineBeyond(top, stepNow(), sign(y), lines) - top];
    } else {
      const step = big ? NUDGE_SHIFT : NUDGE;
      delta = [x * step, y * step];
    }
    moveSelectedNodes(chosen, delta);
  };

  /// Sposta di `delta`, nella scena, i nodi scelti delle forme `chosen`, e lo
  /// dice.
  const moveSelectedNodes = (chosen: readonly Editing[], delta: Point): void => {
    const changes = chosen.map((each): NodeChange => ({
      edit: each,
      subs: moveNodes(each.subs, pickedIn(each), localDelta(each, [0, 0], delta), kindsOf(each)),
      selected: pickedIn(each),
      kinds: nodeKinds.get(each.key) ?? NO_KINDS,
    }));
    if (writeEdits("draw.action.nodes_move", changes)?.written === true) announceMoved();
  };

  /// Il riquadro dei nodi scelti delle forme `chosen`, nella scena.
  const nodesBox = (chosen: readonly Editing[]): Bounds | null => {
    const box = new BoundsBuilder();
    for (const each of chosen) for (const key of pickedIn(each)) box.include(nodePoint(each, key));
    return box.finish();
  };

  /// Il riquadro a cui si allineano i nodi scelti: il loro, o la pagina per
  /// un nodo solo. `null` senza nodi scelti, o per un nodo solo in un
  /// disegno senza pagina.
  const nodesReference = (): Bounds | null => {
    const count = chosenCount();
    if (count > 1) return nodesBox(chosenEdits());
    const page = scene.root.page;
    return count === 0 || page === null ? null : { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] };
  };

  /// «Allinea» coi nodi scelti: ognuno va sul bordo o sul centro del loro
  /// riquadro, o della pagina per un nodo solo, e porta con sé le sue
  /// maniglie. Le forme toccate si scrivono in un passo solo.
  function alignNodes(edge: Edge): void {
    const chosen = noding();
    const reference = nodesReference();
    if (chosen.length === 0 || reference === null) return;
    const axis = edge === "left" || edge === "center" || edge === "right" ? 0 : 1;
    const value = edge === "left" || edge === "top"
      ? reference.min[axis]
      : edge === "right" || edge === "bottom" ? reference.max[axis] : (reference.min[axis] + reference.max[axis]) / 2;
    const changes = chosen.flatMap((each): NodeChange[] => {
      const kinds = kindsOf(each);
      let subs = each.subs;
      for (const key of pickedIn(each)) {
        const from = nodePoint(each, key);
        if (from[axis] === value) continue;
        const to: Point = axis === 0 ? [value, from[1]] : [from[0], value];
        subs = moveNodes(subs, new Set([key]), localDelta(each, from, to), kinds);
      }
      return subs === each.subs ? [] : [{ edit: each, subs, selected: pickedIn(each), kinds: nodeKinds.get(each.key) ?? NO_KINDS }];
    });
    if (changes.length === 0) {
      announce(t("draw.unchanged"));
      return;
    }
    if (writeEdits("draw.action.nodes_align", changes)?.written === true) {
      announce(afterEdit(plural(chosenCount(), "draw.nodes.aligned.one", "draw.nodes.aligned.other")));
    }
  }

  /// «Distribuisci» coi nodi scelti, almeno tre: il primo e l'ultimo lungo
  /// l'asse restano dove sono, gli altri vanno fra loro a passi uguali, ognuno
  /// con le sue maniglie. Le forme toccate si scrivono in un passo solo.
  function distributeNodes(axis: Axis): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const a = axis === "x" ? 0 : 1;
    const spots = chosen.flatMap((each) => [...pickedIn(each)].map((key) => ({ each, key, at: nodePoint(each, key) })));
    if (spots.length < 3) {
      announce(t("draw.nodes.distribute.few"));
      return;
    }
    const sorted = [...spots].sort((p, q) => p.at[a] - q.at[a]);
    const start = sorted[0]!.at[a];
    const step = (sorted[sorted.length - 1]!.at[a] - start) / (sorted.length - 1);
    const target = new Map(sorted.map((spot, i) => [spot, start + step * i]));
    const changes = chosen.flatMap((each): NodeChange[] => {
      const kinds = kindsOf(each);
      let subs = each.subs;
      for (const spot of spots) {
        const value = target.get(spot)!;
        if (spot.each !== each || Math.abs(spot.at[a] - value) < 1e-9) continue;
        const to: Point = a === 0 ? [value, spot.at[1]] : [spot.at[0], value];
        subs = moveNodes(subs, new Set([spot.key]), localDelta(each, spot.at, to), kinds);
      }
      return subs === each.subs ? [] : [{ edit: each, subs, selected: pickedIn(each), kinds: nodeKinds.get(each.key) ?? NO_KINDS }];
    });
    if (changes.length === 0) {
      announce(t("draw.unchanged"));
      return;
    }
    if (writeEdits("draw.action.nodes_distribute", changes)?.written === true) announce(afterEdit(t("draw.nodes.distributed", { count: spots.length })));
  }

  /// Le voci di «Allinea» coi nodi scelti: per un nodo solo il riferimento
  /// è la pagina, e il nome lo dice. Poi quelle di «Distribuisci», che
  /// chiedono almeno tre nodi, e la voce spenta dice perché.
  const nodeAlignItems = (): MenuItem[] => {
    const count = chosenCount();
    const usable = nodesReference() !== null;
    const items: MenuItem[] = EDGES.map(({ edge, label }) => ({
      label: count === 1 ? t("draw.align.to_page", { action: t(label) }) : t(label),
      disabled: !usable,
      run: () => alignNodes(edge),
    }));
    const few = count < 3;
    for (const { axis, label } of AXES) {
      items.push({
        label: t(label),
        separator: axis === "x",
        disabled: few,
        ...(few ? { description: t("draw.nodes.distribute.few") } : {}),
        run: () => distributeNodes(axis),
      });
    }
    return items;
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
    // Chi entra nel livello ne prende l'opacità e la visibilità.
    const kept = arrange("draw.action.into_layer", arranged, null, { key: "draw.layer.styled", vars: { name }, containers: "take" });
    if (kept === null) return;
    // La selezione ha le stesse chiavi, ma sta nel livello nuovo.
    followSelection();
    announce(`${plural(moving, "draw.moved_to_layer.one", "draw.moved_to_layer.other", { name })}${kept}`);
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
    const looked = keptLook(shiftLayerOps(engine.model!, layers, layer, shift, newIds()), { key: "draw.order.styled" });
    if (looked === null) return;
    if (writeLayers("draw.action.layer_order", looked, looked.keys[0] ?? null) && other !== undefined) {
      announce(`${t(shift === "up" ? "draw.layer.moved_up" : "draw.layer.moved_down", { name: layerTitle(layer), other: layerTitle(other) })}${looked.kept}`);
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
    else if (grid.shapes !== before.shapes) announce(t(grid.shapes ? "draw.recognize.on" : "draw.recognize.off"));
    else if (grid.bar !== before.bar) announce(t(grid.bar ? "draw.bar.beside.on" : "draw.bar.beside.off"));
    else if (grid.twist !== before.twist || grid.taps !== before.taps || !sameCurve(grid.pen, before.pen)) announce(t("draw.touch.changed"));
    // Il pannello aperto o chiuso, e le sue sezioni, si ricordano in silenzio:
    // lo si vede, e il pulsante lo dice.
    else if (grid.panel === before.panel && grid.closed.join("\n") === before.closed.join("\n")) return;
    syncProperties();
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
  /// guide, e nasconderli. Sul foglio girato, dove i righelli aspettano,
  /// prima di tutto raddrizzarlo.
  const rulerItems = (): MenuItem[] => [
    ...(camera.angle === 0 ? [] : [{ label: t("draw.turn.straighten"), hint: "5", run: () => turnView(0) }]),
    ...unitItems().map((item, at) => (at === 0 && camera.angle !== 0 ? { ...item, separator: true } : item)),
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
  /// documento, le guide intelligenti, le forme dal tratto, i righelli con le
  /// loro guide e l'unità, dove sta la barra della selezione, la vista
  /// girata, e la pagina, ciascuna se il livello la offre. Adattare la
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
    // Accanto alle guide intelligenti: anche lei aiuta mentre si disegna.
    const recognizeItems: MenuItem[] = has("recognize")
      ? [
          {
            label: t("draw.feature.recognize"),
            choice: "checkbox",
            checked: grid.shapes,
            separator: has("grid") && !has("guides"),
            description: t("draw.recognize.hint"),
            run: () => changeGrid({ ...grid, shapes: !grid.shapes }),
          },
        ]
      : [];
    const barItems: MenuItem[] = BAR_FEATURES.some(has)
      ? [{ label: t("draw.bar.beside"), choice: "checkbox", checked: grid.bar, separator: true, run: () => changeGrid({ ...grid, bar: !grid.bar }) }]
      : [];
    const turnItems: MenuItem[] = has("gestures")
      ? [
          { label: t("draw.turn.left"), hint: "4", separator: true, run: () => turnView(nextTurn(camera.angle, -1)) },
          { label: t("draw.turn.right"), hint: "6", run: () => turnView(nextTurn(camera.angle, 1)) },
          { label: t("draw.turn.straighten"), hint: "5", disabled: camera.angle === 0, run: () => turnView(0) },
          { label: t("draw.touch.dialog"), run: () => void touchSettings() },
        ]
      : [];
    if (!has("grid")) return [...(has("guides") ? [guidesItem] : []), ...recognizeItems, ...rulersItems, ...barItems, ...turnItems];
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
      ...recognizeItems,
      ...rulersItems,
      ...barItems,
      ...turnItems,
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

  /// Vero se i tasti valgono per i nodi: lo strumento Nodi ha forme da
  /// modificare, e la tastiera non sta premendo.
  const nodeKeysOn = (): boolean => {
    if (tool !== "nodes" || pressed !== null) return false;
    refreshNodes();
    return edits.length > 0;
  };

  /// Le frecce sul foglio. Con una selezione la spostano, e con Ctrl o ⌘ la
  /// ridimensionano; senza, o mentre la tastiera preme, muovono il cursore.
  /// Con l'aggancio vanno di riga in riga della griglia, cinque con Maiusc.
  /// Con lo strumento Nodi spostano i nodi scelti, e senza il cursore: mai
  /// l'oggetto. Con la penna di Bézier muovono sempre il cursore, che mette
  /// i nodi.
  ///
  /// Sul foglio girato il cursore libero va dove la freccia punta sullo
  /// schermo, come il puntatore; il resto va lungo l'asse del disegno che si
  /// vede più vicino a lei, e Ctrl o ⌘ allarga con → e ↓ e stringe con ← e ↑
  /// la misura che si vede in quel verso.
  const arrows = (event: KeyboardEvent): boolean => {
    const direction = ARROWS[event.key];
    if (direction === undefined) return false;
    const [x, y] = sceneArrow(camera, direction);
    const grow = direction[0] + direction[1];
    const fine = event.ctrlKey || event.metaKey;
    const lines = event.shiftKey ? GRID_MAJOR : 1;
    if (nodeKeysOn() && chosenCount() > 0) {
      nudgeNodes(x, y, fine, event.shiftKey);
      return true;
    }
    if (tool !== "nodes" && tool !== "bezier" && pressed === null && selection.length > 0 && editable()) {
      const step = event.shiftKey ? NUDGE_SHIFT : NUDGE;
      const [gx, gy] = [x === 0 ? 0 : grow, y === 0 ? 0 : grow];
      if (gridOn()) {
        if (fine) resizeOnGrid(gx, gy, lines);
        else moveOnGrid(x, y, lines);
      } else if (fine) {
        resizeSelection(gx * step, gy * step);
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
    moveCursor(direction[0] * px, direction[1] * px);
    return true;
  };

  /// Sceglie l'oggetto `at` in ordine di documento, lo porta in vista e lo
  /// dice. `false` se non c'è.
  const visit = (units: readonly Unit[], at: number): boolean => {
    const unit = units[at];
    if (unit === undefined) return false;
    cancelGesture();
    select([unit.key]);
    frameBounds(unit.bounds);
    announce(t("draw.walk", { object: labelOf(unit), index: at + 1, count: units.length }));
    return true;
  };

  /// I nodi di tutte le forme che si modificano, in ordine: forma per
  /// forma, nodo per nodo.
  const nodeList = (): Array<{ readonly edit: Editing; readonly key: NodeKey }> =>
    edits.flatMap((edit) => allNodes(edit.subs).map((key) => ({ edit, key })));

  /// Sceglie da solo il nodo `at` delle forme, in ordine, lo porta in vista
  /// e lo dice. `false` se non c'è.
  const visitNode = (at: number): boolean => {
    const entry = nodeList()[at];
    if (entry === undefined) return false;
    cancelGesture();
    setNodes(pickOf(entry.edit, [entry.key]));
    const p = nodePoint(entry.edit, entry.key);
    frameBounds({ min: p, max: p });
    announce(nodeText(entry.edit, entry.key));
    return true;
  };

  /// Tab con lo strumento Nodi: il nodo dopo l'ultimo scelto, o con Maiusc
  /// quello prima del primo, anche di un'altra forma; senza nodi scelti, il
  /// primo o l'ultimo. Oltre le estremità, `false`.
  const walkNodes = (step: 1 | -1): boolean => {
    const list = nodeList();
    const chosen = list.flatMap((entry, i) => (pickedIn(entry.edit).has(entry.key) ? [i] : []));
    if (chosen.length === 0) return visitNode(step > 0 ? 0 : list.length - 1);
    return visitNode(step > 0 ? chosen[chosen.length - 1]! + 1 : chosen[0]! - 1);
  };

  /// Ctrl+A con lo strumento Nodi: tutti i nodi delle forme che si
  /// modificano; se lo sono già, o se non ce ne sono, tutti gli oggetti e
  /// tutti i nodi del disegno.
  const selectAllNodes = (): void => {
    refreshNodes();
    const total = edits.reduce((sum, edit) => sum + nodeCount(edit.subs), 0);
    if (edits.length === 0 || chosenCount() === total) {
      focused = [];
      select(currentIndex().units.map((unit) => unit.key));
      refreshNodes();
    }
    setNodes(new Map(edits.map((edit) => [edit.key, allNodes(edit.subs)])));
    if (edits.length === 0) announceTarget();
    else announceNodes();
  };

  /// Tab con una selezione: l'oggetto dopo l'ultimo scelto, o con Maiusc
  /// quello prima del primo. Oltre le estremità il Tab esce dal foglio. Con
  /// lo strumento Nodi passa prima di nodo in nodo, e oltre l'ultimo
  /// all'oggetto dopo; col Costruttore, di regione in regione.
  const walk = (step: 1 | -1): boolean => {
    if (builderKeysOn()) return walkRegions(step);
    if (nodeKeysOn() && walkNodes(step)) return true;
    if (selection.length === 0 || pressed !== null) return false;
    const anchor = currentIndex().get(step > 0 ? selection[selection.length - 1]! : selection[0]!);
    const units = walkList(anchor);
    const at = anchor === null ? -1 : units.indexOf(anchor);
    return at >= 0 && visit(units, at + step);
  };

  /// Gli oggetti fra cui passano Tab, Inizio e Fine: quelli che si scelgono
  /// o, per un oggetto scelto dentro un gruppo, i suoi fratelli.
  const walkList = (anchor: Unit | null): readonly Unit[] => {
    const index = currentIndex();
    return anchor === null || index.units.includes(anchor) ? index.units : index.siblings(anchor);
  };

  /// Invio: le proprietà della selezione, o del disegno. Col pannello, il
  /// fuoco va al pannello, che le mostra anche in sola lettura; senza, una
  /// finestra le chiede, e il fuoco torna dov'era. I nodi scelti si
  /// misurano sempre nella loro finestra.
  async function properties(): Promise<void> {
    if (asking) return;
    const nodes = nodeKeysOn() && chosenCount() > 0;
    if (has("properties") && !nodes) {
      finishText();
      cancelGesture();
      showPanel(true);
      return;
    }
    if (!editable()) return;
    finishText();
    asking = true;
    cancelGesture();
    try {
      if (nodes) await placeNodesDialog();
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
    const before = nodesBox(chosenEdits());
    if (before === null) return;
    const fields = [lengthField("x", "X", before.min[0]), lengthField("y", "Y", before.min[1])];
    const shown = fields.map((field) => field.value);
    const answer = await promptForm({ title: t("draw.nodes.place"), fields });
    if (answer === null || disposed || !editable()) return;
    // Mentre la finestra era aperta il disegno può essere cambiato: valgono
    // i nodi scelti adesso.
    refreshNodes();
    const chosen = chosenEdits();
    const from = nodesBox(chosen);
    if (from === null) return;
    const value = (id: string, at: number): number => (answer[id] === undefined || answer[id] === shown[at] ? from.min[at]! : fieldValue(answer[id]));
    const delta: Point = [value("x", 0) - from.min[0], value("y", 1) - from.min[1]];
    if (delta[0] === 0 && delta[1] === 0) return;
    moveSelectedNodes(chosen, delta);
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

  /// I tasti del pannello delle proprietà, se le parti `at` lo offrono.
  const propertiesKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("properties")
      ? [
          {
            title: t("draw.properties"),
            rows: [
              ["Enter", t("draw.keys.properties.apply")],
              ["↑↓", t("draw.keys.properties.step")],
              ["Mod-Enter", t("draw.keys.properties.text")],
              ["Escape", t("draw.keys.properties.revert")],
            ],
          },
        ]
      : [];

  /// I tasti degli attributi, se le parti `at` li offrono: col pannello
  /// delle proprietà sono una sua sezione.
  const attributeKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("attributes")
      ? [
          {
            title: t("draw.attributes"),
            rows: [
              [ATTRIBUTES_BINDING, t(at.has("properties") ? "draw.keys.attributes.focus" : "draw.keys.attributes.toggle")],
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
              ["Shift-j Mod-j", t("draw.nodes.join")],
              ["Alt", t("draw.keys.nodes.alt")],
              ["Escape", t("draw.keys.nodes.deselect")],
              ["Alt-F10", t("draw.keys.nodes.bar")],
            ],
          },
        ]
      : [];

  /// I tasti del Costruttore di forme, se le parti `at` lo offrono.
  const builderKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("builder")
      ? [
          {
            title: t("draw.tool.builder"),
            rows: [
              ["Tab Shift-Tab", t("draw.keys.builder.walk")],
              ["Home End", t("draw.keys.builder.ends")],
              ["Space", t("draw.keys.builder.pick")],
              ["Enter", t("draw.keys.builder.merge")],
              ["Delete", t("draw.keys.builder.erase")],
              ["Alt", t("draw.keys.builder.alt")],
              ["Shift", t("draw.keys.builder.shift")],
              ["Escape", t("draw.keys.builder.clear")],
            ],
          },
        ]
      : [];

  /// I tasti delle Forbici, se le parti `at` le offrono.
  const scissorsKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("scissors")
      ? [
          {
            title: t("draw.tool.scissors"),
            rows: [
              ["Space", t("draw.keys.scissors.cut")],
              ["Alt", t("draw.keys.scissors.alt")],
            ],
          },
        ]
      : [];

  /// I tasti del menu Tracciato, se le parti `at` lo offrono.
  const pathKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("path") ? [{ title: t("draw.path"), rows: [["Mod-j", t("draw.keys.join")]] }] : [];

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
          {
            title: t("draw.tool.curvature"),
            rows: [
              ["b", t("draw.keys.curvature.switch")],
              ["Space", t("draw.keys.curvature.point")],
              ["Shift-c", t("draw.keys.curvature.corner")],
              ["Shift-s", t("draw.keys.curvature.smooth")],
              ["Alt", t("draw.keys.curvature.alt")],
            ],
          },
        ]
      : [];

  /// I tasti dello strumento Poligono, se le parti `at` lo offrono.
  const polygonKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("polygon")
      ? [
          {
            title: t("draw.tool.polygon"),
            rows: [
              ["y", t("draw.keys.polygon.toggle")],
              ["ArrowUp ArrowDown PageUp PageDown", t("draw.keys.polygon.count")],
              ["ArrowLeft ArrowRight", t("draw.keys.polygon.ratio")],
              ["Shift", t("draw.keys.polygon.straight")],
            ],
          },
        ]
      : [];

  /// I tasti delle forme dal tratto, se le parti `at` le offrono.
  const recognizeKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("recognize") ? [{ title: t("draw.feature.recognize"), rows: [["Shift", t("draw.keys.recognize.regular")]] }] : [];

  /// I tasti della cronologia, se le parti `at` la offrono.
  const historyKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("history")
      ? [
          {
            title: t("draw.history"),
            rows: [
              ["Enter Space", t("draw.keys.history.go")],
              ["F2", t("draw.keys.history.rename")],
              ["Delete", t("draw.keys.history.unmark")],
              ["Escape", t("draw.keys.history.leave")],
            ],
          },
        ]
      : [];

  /// I tasti della verifica dell'accessibilità, se le parti `at` la offrono.
  const accessKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("accessibility")
      ? [
          {
            title: t("draw.access"),
            rows: [
              ["ArrowUp ArrowDown Home End", t("draw.keys.access.walk")],
              ["Enter Space", t("draw.keys.access.go")],
              ["Alt-ArrowUp Alt-ArrowDown", t("draw.keys.access.move")],
              ["Escape", t("draw.keys.access.leave")],
            ],
          },
        ]
      : [];

  /// I tasti della selezione avanzata.
  const selectionKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("selection")
      ? [
          {
            title: t("draw.selection.menu"),
            rows: [
              ["Mod", t("draw.keys.deep")],
              ["Mod-Enter", t("draw.keys.isolate")],
              ["Escape", t("draw.keys.isolate.exit")],
              ["Mod-Shift-l", t("draw.keys.lock")],
              ["Mod-Shift-h", t("draw.keys.hide")],
              ["Shift-F10", t("draw.keys.menu")],
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
        ["Enter", t(at.has("properties") ? "draw.keys.properties.panel" : "draw.properties")],
        ...(options.links === undefined ? [] : [["Alt-Enter", t("draw.keys.link.open")] as const]),
        ["Delete", t("draw.delete")],
        ["Mod-a", t("draw.keys.all")],
        ["Escape", t("draw.keys.deselect")],
        ...(at.has("layers")
          ? [["F2", t("draw.keys.rename")] as const, ["Mod-f", t("draw.keys.filter")] as const, ["Alt-ArrowUp Alt-ArrowDown", t("draw.keys.step")] as const]
          : []),
      ],
    },
    ...arrangeKeys(at),
    ...selectionKeys(at),
    ...pathKeys(at),
    ...nodeToolKeys(at),
    ...builderKeys(at),
    ...scissorsKeys(at),
    ...polygonKeys(at),
    ...recognizeKeys(at),
    ...bezierKeys(at),
    ...textKeys(at),
    ...gridKeys(at),
    ...guidesKeys(at),
    ...rulersKeys(at),
    ...propertiesKeys(at),
    ...attributeKeys(at),
    {
      title: t("draw.view"),
      rows: [
        ["+", t("draw.zoom_in")],
        ["-", t("draw.zoom_out")],
        ["0", t("draw.keys.actual")],
        ["Shift-1", t("draw.fit")],
        ...(at.has("gestures")
          ? ([["4", t("draw.turn.left")], ["6", t("draw.turn.right")], ["5", t("draw.turn.straighten")], ["Shift-F10", t("draw.keys.radial")]] as const)
          : []),
      ],
    },
    {
      title: t("draw.edit"),
      rows: [
        ["Mod-z", t("draw.undo")],
        ["Mod-Shift-z Mod-y", t("draw.redo")],
        ["Mod-x", t("draw.cut")],
        ["Mod-c", t("draw.copy")],
        ["Mod-v", t("draw.keys.paste")],
        ["Mod-Shift-v", t("draw.paste.in_place")],
        ...(at.has("style") ? ([[COPY_STYLE_BINDING, t("draw.style.copy")], [PASTE_STYLE_BINDING, t("draw.style.paste")]] as const) : []),
        ...(insertsImages(at) ? [[IMAGE_BINDING, t("draw.image.vault")] as const] : []),
        ["?", t("draw.keys")],
      ],
    },
    ...historyKeys(at),
    ...accessKeys(at),
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

  /// Ciò che si vede del foglio, nella scena: fuori dai righelli. Sul foglio
  /// girato, il riquadro della scena che lo copre.
  const viewBounds = (): Bounds => sceneBox(camera, viewArea());

  /// Vero se il punto `p` della scena si vede, fuori dai righelli.
  const inSight = (p: Point): boolean => {
    const area = viewArea();
    const [x, y] = toScreen(camera, p);
    return x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h;
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
    const inView = at !== null && inSight(at);
    const base: Point = inView ? at : toScene(camera, viewCenter());
    // Le immagini stanno in ciò che si vede tutto, anche sul foglio girato.
    const view = seenBox(camera, viewArea());
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
    askDescriptions(keys);
  };

  // --- Gli appunti --------------------------------------------------------------

  /// Il comando degli appunti che un menu ha chiesto: la copia che il browser
  /// manda col comando è la sua, anche col fuoco nel menu.
  let commanded: "copy" | "cut" | null = null;
  /// Fino a quando l'incolla dei tasti va nello stesso punto: Ctrl+Maiusc+V
  /// lo chiede, e l'evento del browser arriva subito dietro.
  let inPlaceUntil = -Infinity;
  /// L'ultimo incolla al cursore: lo stesso testo allo stesso punto si
  /// scosta di un passo in più, come le copie di Ctrl+D.
  let series: { readonly text: string; readonly at: Point; readonly count: number } | null = null;
  /// L'incolla in corso, che Esc e «Interrompi» fermano fra una fetta e
  /// l'altra.
  let pasting: { stopped: boolean } | null = null;

  /// La pausa dell'incolla fra due fette, una alla volta. Smontato l'editor
  /// finisce subito, e l'incolla vede che l'editor non c'è più.
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  let pauseFrame = 0;
  let pauseDone: (() => void) | null = null;
  const endPause = (): void => {
    clearTimeout(pauseTimer);
    cancelAnimationFrame(pauseFrame);
    const done = pauseDone;
    pauseDone = null;
    done?.();
  };
  life.add(endPause);
  /// La pagina respira: gli eventi in attesa passano; con `frame`, prima si
  /// ridisegna, e ciò che si è appena mostrato si vede.
  const pause = (frame: boolean): Promise<void> =>
    new Promise((resolve) => {
      pauseDone = resolve;
      const breathe = (): void => {
        pauseTimer = setTimeout(endPause, 0);
      };
      if (frame) pauseFrame = requestAnimationFrame(breathe);
      else breathe();
    });

  /// Un evento degli appunti è dell'editor: il fuoco è qui, o non è da
  /// nessuna parte e l'evento arriva qui; un campo tiene i suoi. Fuori dal
  /// foglio, una copia lascia al browser il testo che si è scelto.
  const ownsClipboard = (event: ClipboardEvent): boolean => {
    const active = document.activeElement;
    const focused = active !== null && active !== document.body && active !== document.documentElement;
    const node = focused ? active : event.target;
    if (!(node instanceof Element) || !root.contains(node)) return false;
    if (node.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null) return false;
    return event.type === "paste" || node === surface || document.getSelection()?.type !== "Range";
  };

  /// La selezione come SVG, nel riquadro di ciò che se ne vede; `null` se
  /// non si scrive.
  const selectionSvg = (units: readonly Unit[]): string | null => {
    const bounds = boundsOf(units);
    return bounds === null ? null : copySvg({ text: engine.text, paths: units.map((unit) => unit.path), bounds });
  };

  /// Il PNG di `svg`: le immagini del vault coi loro byte, fino al tetto
  /// della Lettura, e i caratteri dell'app che un testo nomina.
  const pngOf = async (svg: string): Promise<Blob | null> => {
    const refs = imageRefs(svg);
    const sources = new Map<string, string>();
    const port = options.images;
    if (port !== undefined) {
      let spent = 0;
      for (const path of new Set(refs.flatMap((ref) => (ref.path === null ? [] : [ref.path])))) {
        const blob = await port.read(path).catch(() => null);
        if (blob === null || blob.size > READ_IMAGE_BYTES - spent) continue;
        const uri = await imageDataUri(blob);
        if (uri === null) continue;
        sources.set(path, uri);
        spent += blob.size;
      }
    }
    const shown = withImages(svg, refs, sources);
    return rasterize(withStyle(shown, await fontFaces(shown, fetchBlob)));
  };

  /// Scrive `svg` negli appunti di `data`, come testo e come SVG; poi, dove
  /// la shell lo lascia fare, di nuovo col PNG accanto, quando è pronto.
  /// Il PNG di una copia superata, o pronto quando la pagina non ha più il
  /// fuoco, non scrive niente: resta ciò che c'è.
  const writeClipboard = (data: DataTransfer, svg: string): void => {
    data.setData("text/plain", svg);
    data.setData(SVG_TYPE, svg);
    const round = ++copyRound;
    if (!clipboardSupports("image/png")) return;
    const png = pngOf(svg).then((blob) => {
      if (blob === null || round !== copyRound || !document.hasFocus()) throw new Error("PNG superato");
      return blob;
    });
    png.catch(() => undefined);
    const content: Record<string, Blob | Promise<Blob>> = { "text/plain": new Blob([svg], { type: "text/plain" }), "image/png": png };
    if (clipboardSupports(SVG_TYPE)) content[SVG_TYPE] = new Blob([svg], { type: SVG_TYPE });
    // Se non scrive, resta ciò che la copia ha scritto subito.
    writeClipboardData(content).catch(() => undefined);
  };

  /// Copia e taglia: la selezione negli appunti, come SVG e come PNG, e
  /// tagliare poi la toglie dal disegno, in un passo. Copiare si può anche in
  /// sola lettura.
  const onCopy = (event: ClipboardEvent): void => {
    const kind = commanded ?? (event.type === "cut" ? "cut" : "copy");
    if (commanded === null && !ownsClipboard(event)) {
      if (event !== copyEvent) copyRound++;
      return;
    }
    const data = event.clipboardData;
    if (data === null) return;
    const units = selectedUnits();
    if (units.length === 0) {
      announce(t("draw.selected.none"));
      return;
    }
    if (kind === "cut" && !editable()) return;
    event.preventDefault();
    const svg = selectionSvg(units);
    if (svg === null) {
      announce(t("draw.copy.failed"));
      return;
    }
    copyEvent = event;
    writeClipboard(data, svg);
    lastCopy = { text: svg, place: options.place ?? null };
    series = null;
    if (kind === "copy") {
      announce(plural(units.length, "draw.copied.one", "draw.copied.other"));
      return;
    }
    cancelGesture();
    if (commit("draw.action.cut", asGesture(removeOps(units))) === null) return;
    selection = [];
    syncControls();
    showHandles();
    announce(`${plural(units.length, "draw.cut.one", "draw.cut.other")} ${objects()}`);
  };

  /// «Copia» e «Taglia» dal menu: la copia che il browser manda col comando.
  /// Dove non la manda, si dice di usare i tasti.
  const clipboardCommand = (kind: "copy" | "cut"): void => {
    commanded = kind;
    let sent: boolean;
    try {
      sent = document.execCommand("copy");
    } catch {
      sent = false;
    } finally {
      commanded = null;
    }
    if (!sent) announce(t("draw.copy.keys", { key: displayBinding(kind === "copy" ? "Mod-c" : "Mod-x") }));
  };

  /// Ciò che un incolla o un rilascio porta al disegno: un SVG scritto come
  /// testo, file SVG, immagini raster.
  interface Carried {
    readonly text: string | null;
    readonly svgs: readonly File[];
    readonly images: readonly File[];
  }

  /// Ciò che `data` porta al disegno; `null` se niente. Un SVG scritto come
  /// testo vince sul resto: con lui, da una copia, arriva il suo PNG.
  const carriedBy = (data: DataTransfer | null): Carried | null => {
    if (data === null) return null;
    const plain = data.getData("text/plain");
    const typed = looksLikeSvg(plain) ? plain : data.getData(SVG_TYPE);
    if (looksLikeSvg(typed)) return { text: typed, svgs: [], images: [] };
    const svgs = svgFiles(data);
    const images = imageFiles(data);
    return svgs.length === 0 && images.length === 0 ? null : { text: null, svgs, images };
  };

  /// Porta `carried` sul foglio: gli SVG in un passo, poi le immagini nel
  /// loro. Un file più grande di un disegno modificabile non si legge.
  async function pasteCarried(carried: Carried, at: Point | null, inPlace: boolean): Promise<void> {
    if (carried.text !== null) {
      await pasteSvgs([{ text: carried.text, name: null }], at, inPlace);
      return;
    }
    if (carried.svgs.length > 0) {
      const texts = await Promise.all(
        carried.svgs.map(async (file) => ({ text: file.size > MAX_EDIT_BYTES ? null : await file.text().catch(() => ""), name: file.name })),
      );
      await pasteSvgs(texts, at, inPlace);
    }
    if (carried.images.length > 0) await addImages(carried.images, at);
  }

  /// Il contenitore del modello che `to` nomina.
  const containerOf = (model: DocumentModel, to: Destination): ContainerNode | null => {
    const ident = to.prelude.find((op) => op.op === "ident");
    const node = ident?.op === "ident" ? nodeAtPath(model, ident.path) : to.parent === ROOT ? model.root : engine.holder(to.parent);
    return node?.kind === "container" ? node : null;
  };

  /// Come cambia un `href` del vault incollato da `text`: se `text` è
  /// l'ultima copia della pagina, da dove portava nel disegno da cui viene a
  /// come ci porta questo, col frammento che aveva. Un `href` dalla radice
  /// del vault, o che porta già allo stesso documento, resta.
  const rebaseFor = (text: string): ((href: string) => string | null) => {
    const from = lastCopy !== null && sameClip(lastCopy.text, text) ? lastCopy.place : null;
    const here = options.place;
    if (from === null || here === undefined) return () => null;
    return (href) => {
      if (/^[/\\]/.test(href.trim())) return null;
      const doc = from.locate(href);
      if (doc === null || here.locate(href) === doc) return null;
      const hash = href.indexOf("#");
      return here.refer(doc) + (hash < 0 ? "" : href.slice(hash));
    };
  };

  /// Gli SVG di `texts` nel livello che riceve, in un passo solo: al cursore
  /// se si vede, o al centro della vista, uno accanto all'altro, scelti e con
  /// lo strumento della selezione; con `inPlace`, dove dicono le loro
  /// coordinate. Un testo `null` è più grande di un disegno modificabile.
  /// Un incolla lungo mostra la sua barra, e Esc lo interrompe.
  async function pasteSvgs(texts: ReadonlyArray<{ readonly text: string | null; readonly name: string | null }>, at: Point | null, inPlace: boolean): Promise<void> {
    if (asking || disposed || texts.length === 0 || !editable()) return;
    finishText();
    cancelGesture();
    asking = true;
    const run = { stopped: false };
    pasting = run;
    const loaded = loads;
    const before = engine.text;
    const started = performance.now();
    let shown = false;
    /// La barra, con `label` e la parte fatta; senza, aspetta.
    const show = (label: DrawKey, value: number | null): void => {
      if (!shown) announce(t(label));
      shown = true;
      progressLabel.textContent = t(label);
      if (value === null) {
        progressMeter.removeAttribute("value");
      } else {
        progressMeter.setAttribute("max", "1");
        progressMeter.setAttribute("value", String(value));
      }
      progressBar.hidden = false;
    };
    const gone = (): boolean => disposed || run.stopped || loads !== loaded || !editable() || engine.text !== before;
    /// Smette, e dice perché se è chi disegna a saperlo.
    const quit = (): void => {
      if (disposed || loads !== loaded) return;
      if (run.stopped) announce(t("draw.paste.stopped"));
      else if (engine.text !== before) announce(t("draw.paste.changed"));
    };
    try {
      if (texts.reduce((sum, each) => sum + (each.text?.length ?? 0), 0) >= BIG_PASTE) {
        show("draw.paste.reading", null);
        await pause(true);
        if (gone()) return quit();
      }
      const sources: Array<{ readonly source: PasteSource; readonly text: string }> = [];
      let problem: PasteProblem | null = null;
      for (const { text, name } of texts) {
        const source = text === null ? "too-large" : readPaste(text, name);
        if (typeof source === "string") problem ??= source;
        else sources.push({ source, text: text! });
      }
      const said = problem === null ? "" : t(PASTE_PROBLEMS[problem], { limit: sizeText(MAX_EDIT_BYTES) });
      if (sources.length === 0) {
        announce(said);
        return;
      }
      const ids = newIds();
      const to = target(ids);
      const model = engine.model;
      const container = to === null || model === null ? null : containerOf(model, to);
      if (to === null || model === null || container === null) return;
      const inView = at !== null && inSight(at);
      const base: Point = inView ? at : toScene(camera, viewCenter());
      const distance = COPY_STEP_PX / camera.scale;
      const step = gridOn() ? wholeSteps(distance, stepNow()) : roundDelta(distance);
      const lone = !inPlace && sources.length === 1 ? sources[0]!.text : null;
      const again = lone !== null && series !== null && series.text === lone && series.at[0] === base[0] && series.at[1] === base[1];
      const first = again ? series!.count + 1 : 0;
      const ops: Op[] = [];
      const keys: string[] = [];
      let bounds: Bounds | null = null;
      for (const [i, { source, text }] of sources.entries()) {
        let delta: Point = [0, 0];
        if (!inPlace) {
          // Il centro dell'SVG va sul punto, e con l'aggancio il suo angolo
          // in alto a sinistra sull'incrocio più vicino.
          const frame = pasteFrame(source, model);
          const offset = (first + i) * step;
          delta = [roundDelta(base[0] + offset - (frame.min[0] + frame.max[0]) / 2), roundDelta(base[1] + offset - (frame.min[1] + frame.max[1]) / 2)];
          if (gridOn()) {
            const [sx, sy] = snapDelta(translated(frame, delta[0], delta[1])!.min, 0, 0, stepNow());
            delta = [delta[0] + sx, delta[1] + sy];
          }
        }
        const steps = planPaste(source, { model, container, to: i === 0 ? to : { ...to, prelude: [] }, ids, delta, href: rebaseFor(text) });
        const plan = await sliced(
          steps,
          (done) => {
            if (shown || performance.now() - started >= PROGRESS_DELAY_MS) show("draw.paste.running", (i + done) / sources.length);
          },
          gone,
          () => pause(false),
        );
        if (plan === null) return quit();
        ops.push(...plan.ops);
        keys.push(...plan.keys);
        bounds = union(bounds, plan.bounds);
      }
      if (shown) {
        show("draw.paste.writing", null);
        await pause(true);
      }
      if (gone()) return quit();
      const page = pageFor(scene.root.page, bounds);
      if (page !== null) ops.push({ op: "page", viewBox: page });
      if (commit("draw.action.paste", asGesture(ops)) === null) return;
      series = lone === null ? null : { text: lone, at: base, count: first };
      const switched = tool !== "select" && tools.some((spec) => spec.id === "select");
      if (switched) {
        tool = "select";
        syncControls();
      }
      select(keys);
      const now = switched ? ` ${t("draw.announce.tool", { tool: t(toolSpec("select").label) })}` : "";
      announce(`${plural(keys.length, "draw.pasted.one", "draw.pasted.other")}${now} ${objects()}${said === "" ? "" : ` ${said}`}`);
    } finally {
      if (pasting === run) pasting = null;
      asking = false;
      if (progressBar.contains(document.activeElement)) surface.focus({ preventScroll: true });
      progressBar.hidden = true;
    }
  }

  /// «Incolla» e «Incolla nello stesso punto» dal menu: gli appunti letti
  /// dalla shell, se lo lascia fare; altrimenti si dice di usare i tasti.
  async function pasteFromMenu(inPlace: boolean): Promise<void> {
    const at = cursor;
    let items: readonly ClipboardEntry[];
    try {
      items = await readClipboard();
    } catch {
      if (!disposed) announce(t("draw.paste.keys", { key: displayBinding(inPlace ? "Mod-Shift-v" : "Mod-v") }));
      return;
    }
    // Un tipo che non arriva, come il PNG di una copia superata, non c'è.
    const read = (item: ClipboardEntry, type: string): Promise<Blob | null> => item.getType(type).catch(() => null);
    let svg: string | null = null;
    const images: File[] = [];
    for (const item of items) {
      for (const type of ["text/plain", SVG_TYPE]) {
        if (svg !== null || !item.types.includes(type)) continue;
        const text = (await (await read(item, type))?.text().catch(() => null)) ?? "";
        if (looksLikeSvg(text)) svg = text;
      }
      const raster = item.types.find((type) => type.startsWith("image/") && type !== SVG_TYPE);
      const blob = svg === null && raster !== undefined ? await read(item, raster) : null;
      if (blob !== null) images.push(new File([blob], "image", { type: raster }));
    }
    if (disposed) return;
    if (svg === null && images.length === 0) {
      announce(t("draw.paste.nothing"));
      return;
    }
    await pasteCarried({ text: svg, svgs: [], images: svg === null ? images : [] }, at, inPlace);
  }

  life.listen(document, "copy", onCopy);
  life.listen(document, "cut", onCopy);
  // Un incolla che porta un SVG o immagini non va oltre; uno di solo testo,
  // o in un campo, segue la sua strada.
  life.listen(document, "paste", (event) => {
    const inPlace = event.timeStamp <= inPlaceUntil;
    inPlaceUntil = -Infinity;
    if (!ownsClipboard(event)) return;
    const carried = carriedBy(event.clipboardData);
    if (carried === null) {
      announce(t("draw.paste.nothing"));
      return;
    }
    event.preventDefault();
    void pasteCarried(carried, cursor, inPlace);
  });
  life.listen(progressStop, "click", () => {
    if (pasting !== null) pasting.stopped = true;
  });

  // --- Lo stile copiato -------------------------------------------------------

  /// «Copia lo stile»: quello del primo oggetto scelto, per ogni disegno
  /// della pagina. Si copia anche in sola lettura.
  function copyStyle(): void {
    if (!has("style") || engine.model === null) return;
    const units = selectedUnits();
    if (units.length === 0) {
      announce(t("draw.selected.none"));
      return;
    }
    const style = styleOf(engine.model, units[0]!);
    if (style === null) {
      announce(t("draw.style.none"));
      return;
    }
    copiedStyle = style;
    announce(t("draw.style.copied"));
  }

  /// «Incolla lo stile»: lo stile copiato sugli oggetti scelti, in un passo.
  function pasteStyle(): void {
    const units = arranging("style");
    if (units === null) return;
    if (copiedStyle === null) {
      announce(t("draw.style.empty", { key: displayBinding(COPY_STYLE_BINDING) }));
      return;
    }
    if (arrange("draw.action.paste_style", styleOps(engine.model!, units, copiedStyle, newIds())) !== null) {
      announce(plural(units.length, "draw.restyled.one", "draw.restyled.other"));
    }
  }

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
    const carried = carriedBy(event.dataTransfer);
    if (carried === null) {
      announce(t("draw.drop.unreadable"));
      return;
    }
    void pasteCarried(carried, sceneAt(event.clientX, event.clientY), false);
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
    else if (current?.kind === "ink" && current.held !== null && event.key === "Shift") drawHeld(current);
    else if (current?.kind === "select" && (current.mode === "move" || current.mode === "resize" || current.mode === "rotate")) selectUpdate(current);
    else if (current?.kind === "nodes" && current.dragging) nodesUpdate(current);
    else if (current?.kind === "bezier") bezierUpdate(current);
    else if (hover !== null && drawing() !== null) showBezier();
    else if (current?.kind === "builder" || (current === null && regionHover >= 0)) showHandles();
    else if (current === null && (alt || measured)) showHandles();
  };

  life.listen(root, "keyup", onModifiers);
  life.listen(root, "keydown", (event) => {
    onModifiers(event);
    if (event.defaultPrevented || event.target === titleInput || event.target === textInput) return;
    // Esc ferma l'incolla in corso, da ogni parte dell'editor.
    if (event.key === "Escape" && pasting !== null) {
      pasting.stopped = true;
      event.preventDefault();
      return;
    }
    // I pannelli delle proprietà, degli attributi e dell'accessibilità, e i
    // campi dell'albero (la ricerca, il tipo e il nome), tengono i loro tasti: un `?` o un Canc
    // scritti in un valore restano lì, le frecce cambiano un numero, e un Canc
    // sul pulsante che toglie un attributo non toglie l'oggetto. Passano i
    // tasti che portano agli attributi e a «Trasforma» e, fuori da un campo
    // di testo, annulla e ripeti, raggruppa e separa.
    const treeField =
      (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) &&
      (tree.element.contains(event.target) || historyPanel.element.contains(event.target));
    const inAccess = event.target instanceof Node && (accessPanel.element.contains(event.target) || describeBar.contains(event.target) || pathsBar.contains(event.target));
    if (event.target instanceof Node && (inspector.element.contains(event.target) || panel.element.contains(event.target) || treeField || inAccess)) {
      const key = event.key.toLowerCase();
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (!(mod && (((key === "x" || key === "m") && event.shiftKey) || (!field && (key === "z" || key === "g" || (key === "y" && !event.shiftKey)))))) return;
    }
    const onSurface = event.target === surface;
    const inNodesBar = event.target instanceof Node && nodesBar.contains(event.target);
    const inTree = event.target instanceof Node && tree.element.contains(event.target);
    // Mentre si disegna un poligono, le frecce e i tasti di pagina sono suoi.
    if (current?.kind === "shape" && current.tool === "polygon" && !event.ctrlKey && !event.metaKey && !event.altKey && polygonKey(event)) {
      event.preventDefault();
      return;
    }
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
    // restano a chi li aveva. Raggruppa e separa li prendono anche senza
    // selezione, e dicono che non c'è niente di scelto: fuori dal disegno
    // `Ctrl+Maiusc+G` apre il grafo, e chi voleva separare un gruppo non
    // scelto si troverebbe altrove.
    const arranges = (feature: Feature): boolean => has(feature) && selection.length > 0 && editable();
    if (mod) {
      // Lo stile si copia e si incolla con Alt, la lettera per la sua
      // posizione dove Alt ne scrive un'altra (⌥C è «ç»).
      const letter = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : event.code === "KeyC" ? "c" : event.code === "KeyV" ? "v" : "";
      if (event.altKey && !event.shiftKey && (letter === "c" || letter === "v") && has("style")) {
        if (letter === "c") copyStyle();
        else pasteStyle();
        event.preventDefault();
        return;
      }
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      // Ctrl+C, Ctrl+X e Ctrl+V sono del browser, che manda gli eventi degli
      // appunti; Ctrl+Maiusc+V chiede che l'incolla vada nello stesso punto.
      if (key === "v") inPlaceUntil = event.shiftKey ? event.timeStamp + IN_PLACE_MS : -Infinity;
      // Le parentesi quadre per posizione, dove le ha una tastiera americana:
      // su quella italiana sono «è» e «+», che si premono senza AltGr.
      const bracket = event.code === "BracketRight" || key === "]" || key === "}" ? 1 : event.code === "BracketLeft" || key === "[" || key === "{" ? -1 : 0;
      if (key === "z") {
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y" && !event.shiftKey) {
        redo();
      } else if (key === "a" && !event.shiftKey) {
        if (tool === "nodes" && pressed === null && has("nodes") && editable()) {
          selectAllNodes();
        } else {
          select(currentIndex().units.map((unit) => unit.key));
          announceSelection();
        }
      } else if (key === "x" && event.shiftKey && has("attributes")) {
        // Nel pannello, il tasto porta agli attributi e, da lì, torna al
        // foglio.
        if (!nestedNow()) showAttributes(inspector.element.hidden);
        else if (inspector.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
        else focusAttributes();
      } else if (key === "m" && event.shiftKey && arranges("transform")) {
        if (!focusTransform()) void transformDialog();
      } else if (key === "d" && !event.shiftKey && arranges("arrange")) {
        duplicateSelection();
      } else if (key === "j" && !event.shiftKey && tool === "nodes" && nodeKeysOn() && chosenCount() > 0) {
        joinSelectedNodes();
      } else if (key === "j" && !event.shiftKey && arranges("path")) {
        joinSelection();
      } else if (key === "g" && has("arrange") && editable()) {
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
      } else if (key === "enter" && !event.shiftKey && has("selection") && selection.length > 0) {
        if (pressed !== null || current !== null) return;
        isolateSelection();
      } else if ((key === "l" || key === "h") && event.shiftKey && arranges("selection") && !inTree) {
        flagSelection(key === "l" ? "locked" : "hidden");
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
    // Maiusc+F10, o il tasto del menu: ciò che apre il clic destro. Con gli
    // strumenti che disegnano e niente di scelto, il menu radiale, al
    // cursore; altrimenti il menu della selezione, sotto la selezione o al
    // cursore.
    const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
    if (onSurface && menuKey && radialHere() && selection.length === 0) {
      if (current !== null || pressed !== null) return;
      event.preventDefault();
      keyedMenu = event.timeStamp;
      const at = menuPoint();
      showRadial(at.clientX, at.clientY, null, true);
      return;
    }
    if (onSurface && menuKey && has("selection")) {
      if (current !== null || pressed !== null) return;
      event.preventDefault();
      keyedMenu = event.timeStamp;
      showContextMenu(menuPoint(), selectionItems(), { labelledBy: selectionButton.id });
      return;
    }
    if (onSurface && event.key === "Tab") {
      if (!walk(event.shiftKey ? -1 : 1)) return;
    } else if (onSurface && (event.key === "PageUp" || event.key === "PageDown") && arranges("arrange")) {
      if (pressed !== null) return;
      if (event.key === "PageUp") orderSelection(event.shiftKey ? "front" : "forward");
      else orderSelection(event.shiftKey ? "back" : "backward");
    } else if (onSurface && (event.key === "Home" || event.key === "End") && nodeKeysOn()) {
      visitNode(event.key === "Home" ? 0 : nodeList().length - 1);
    } else if (onSurface && (event.key === "Home" || event.key === "End") && builderKeysOn()) {
      visitRegion(event.key === "Home" ? 0 : builderNow()!.regions.regions.length - 1);
    } else if (onSurface && (event.key === "Home" || event.key === "End")) {
      const units = walkList(selection.length === 0 ? null : currentIndex().get(selection[0]!));
      if (pressed !== null || !visit(units, event.key === "Home" ? 0 : units.length - 1)) return;
    } else if (onSurface && event.key === " ") {
      if (event.repeat) {
        // Tenuto giù: un tasto, un passo.
      } else if (pressed === null && tool === "text") openText(cursorPoint(), "mouse");
      else if (builderKeysOn()) pickRegion();
      else if (pressed === null) press(event.timeStamp);
      else release();
    } else if (onSurface && event.key === "F2" && (has("text") || has("layers"))) {
      if (pressed !== null) return;
      // Un testo si scrive; un altro oggetto, coi livelli, si rinomina.
      const units = selectedUnits();
      const text = units.length === 1 && units[0]!.look !== null;
      if (has("layers") && editable() && !(text && has("text"))) renameSelection();
      else editSelectedText();
    } else if (onSurface && event.key === "Enter") {
      if (pressed !== null) release();
      else if (drawing() !== null) {
        // A metà gesto il tracciato aspetta che il gesto finisca, come per
        // Canc.
        if (current === null) finishBezier(false);
      } else if (builderKeysOn() && buildChosen(false)) {
        // Col Costruttore, le regioni scelte si uniscono.
      } else void properties();
    } else if (event.key === "?") {
      void keys();
    } else if ((event.key === "Delete" || event.key === "Backspace") && builderKeysOn() && buildChosen(true)) {
      // Col Costruttore Canc toglie le regioni scelte; senza, l'oggetto.
    } else if ((event.key === "Delete" || event.key === "Backspace") && nodeKeysOn()) {
      // Con lo strumento Nodi Canc elimina i nodi, mai l'oggetto.
      deleteSelectedNodes();
    } else if ((event.key === "Delete" || event.key === "Backspace") && curveOn() && pressed === null && current === null && chosenCount() > 0) {
      // Con la Curvatura, i nodi scelti, e la curva si rifà.
      curveDelete();
    } else if ((event.key === "Delete" || event.key === "Backspace") && drawing() !== null) {
      // Con la penna di Bézier, l'ultimo nodo del tracciato.
      if (current !== null) return;
      deleteBezierNode(drawing()!);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (selection.length === 0) return;
      deleteSelection();
    } else if (event.key === "Insert" && !event.shiftKey && nodeKeysOn() && (onSurface || inNodesBar)) {
      insertSelectedNodes();
    } else if (event.shiftKey && onSurface && (event.key.toLowerCase() === "c" || event.key.toLowerCase() === "s") && tool === "bezier" && curvature && drawing() !== null) {
      // Con la Curvatura, il punto sotto il cursore, o l'ultimo, a spigolo
      // o liscio: le lettere dello strumento Nodi.
      if (current !== null || pressed !== null) return;
      curveKindKey(event.key.toLowerCase() === "c" ? "corner" : "smooth");
    } else if (event.shiftKey && NODE_COMMANDS[event.key.toLowerCase()] !== undefined && nodeKeysOn() && (onSurface || inNodesBar)) {
      runNodeCommand(NODE_COMMANDS[event.key.toLowerCase()]!);
    } else if (event.key === "Escape") {
      if (current !== null) cancelGesture();
      else if (drawing() !== null) {
        // Esc conclude il tracciato della penna, come conclude un testo: ciò
        // che si è disegnato non si perde, e Annulla lo toglie in un passo.
        finishBezier(false);
      } else if ((tool === "nodes" || curveOn()) && chosenCount() > 0) {
        setNodes(new Map());
        announceNodes();
      } else if (builderNow() !== null && (regionsChosen.length > 0 || regionActive >= 0)) {
        regionsChosen = [];
        regionActive = -1;
        showHandles();
        announce(t("draw.builder.cleared"));
      } else if (leaveIsolation(false)) {
        // Fuori di un gruppo, scelto quello da cui si è usciti.
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
    } else if ((event.key === "4" || event.key === "6") && has("gestures")) {
      turnView(nextTurn(camera.angle, event.key === "6" ? 1 : -1));
    } else if (event.key === "5" && has("gestures")) {
      turnView(0);
    } else {
      const spec: ToolSpec | null = event.shiftKey ? null : toolForKey(tools, event.key);
      if (spec === null || !editable()) return;
      pickTool(spec.id);
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
  showPanelByDefault();

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
      panel.setClosed(grid.closed as readonly SectionId[]);
      if (grid.panel !== null && has("properties") && grid.panel === panel.element.hidden) showPanel(grid.panel, false, false);
      syncProperties();
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
      closeDescriptions();
      history.clear();
      selection = [];
      chosen = null;
      isolation = null;
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

/// Le voci di «Seleziona simili», nell'ordine del menu.
const LIKENESSES: ReadonlyArray<{ readonly by: Likeness; readonly label: DrawKey }> = [
  { by: "fill", label: "draw.select.same_fill" },
  { by: "stroke", label: "draw.select.same_stroke" },
  { by: "width", label: "draw.select.same_width" },
  { by: "kind", label: "draw.select.same_kind" },
  { by: "tool", label: "draw.select.same_tool" },
  { by: "layer", label: "draw.select.same_layer" },
];

/// Dopo il menu aperto dalla tastiera, per tanti millisecondi il tasto del
/// menu non ne apre un altro.
const KEYED_MENU_MS = 1000;

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

/// Che cosa si dice quando il Costruttore non fa un'operazione.
const BUILD_REFUSALS: Readonly<Record<BuildRefused["reason"], DrawKey>> = {
  whole: "draw.builder.whole",
  foreign: "draw.builder.foreign",
  failed: "draw.builder.unsolved",
};

/// Perché un oggetto non ha nodi da modificare, a parole.
const NO_NODES: Readonly<Record<NoNodes, DrawKey>> = {
  text: "draw.nodes.text",
  image: "draw.nodes.image",
  unreadable: "draw.nodes.unreadable",
  empty: "draw.nodes.empty",
  stroke: "draw.nodes.stroke_fixed",
  foreign: "draw.nodes.foreign",
  other: "draw.nodes.no_path",
};

/// Perché una modifica dei nodi non si fa, a parole.
const NODES_REFUSED: Readonly<Record<"arrow" | "stroke" | "long", DrawKey>> = {
  arrow: "draw.nodes.arrow",
  stroke: "draw.nodes.stroke",
  long: "draw.nodes.long",
};

/// Quante spine di tratti a penna l'editor ricorda.
const SPINES = 64;

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

/// Il tipo di un nodo della penna: quello che gli si è dato con la
/// Curvatura, o quello che dicono le sue maniglie.
function draftKind(node: DraftNode): NodeKind {
  return node.curve ?? penKind(node);
}

/// I nodi `nodes` col nodo `index` punto della Curvatura di tipo `kind`.
function withKind(nodes: readonly DraftNode[], index: number, kind: CurveKind): DraftNode[] {
  const next = nodes.slice();
  next[index] = { at: nodes[index]!.at, in: null, out: null, curve: kind };
  return next;
}

/// Il nodo `node` portato in `at`, con le sue maniglie.
function movedNode(node: DraftNode, at: Point): DraftNode {
  const dx = at[0] - node.at[0];
  const dy = at[1] - node.at[1];
  const by = (handle: Point | null): Point | null => (handle === null ? null : [handle[0] + dx, handle[1] + dy]);
  return { ...node, at, in: by(node.in), out: by(node.out) };
}

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
const ADDED: Readonly<Record<Exclude<ShapeTool, "polygon">, DrawKey>> = {
  rect: "draw.added.rect",
  ellipse: "draw.added.ellipse",
  line: "draw.added.line",
  arrow: "draw.added.arrow",
};
