// L'editor del livello Essenziale (piano §6): una barra e il foglio, nessun
// pannello. Tiene insieme ciò che i pacchetti precedenti hanno costruito — il
// motore delle operazioni, il painter e lo strato sopra, la pipeline della
// penna, la camera condivisa — e ci mette sopra gli strumenti.
//
// Le regole:
//
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
//   cambio di strumento e ciò che non si è potuto fare (piano §7).
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
// - **Immagini incollate.** Un'immagine incollata o trascinata sul foglio
//   entra nel file come data URI (`images.ts`): il disegno resta un file
//   solo. Oltre il peso massimo l'editor propone di ridurla.
//
// La superficie che lo monta nella shell (FD-206) gli passa il motore del
// documento e riceve ogni modifica con `onChange`; una sincronizzazione da
// un'altra superficie arriva con `setEngine`, e annulla e ripeti restano.

import { onLanguage, plural, resolvedLanguage, t, type Key } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { promptForm, showKeys, type FormField, type KeyGroup } from "../../../ui/form-dialog";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { fit as fitBounds, screenToWorld, zoomAtPoint, type Camera, type ScaleLimits } from "../../../spatial/camera";
import type { TextOperation } from "../../core/text-operation";
import { countObjects, describe, outline, type OutlineNode } from "../describe";
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
import type { Item } from "../scene/classify";
import type { Op, Reason } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { createOverlay, type OverlayHandle } from "../painter/overlay";
import { PaintBuilder, type PaintNode, type PaintScene } from "../painter/paint";
import { createSvgPainter, type PainterOptions } from "../painter/svg-dom";
import {
  addOp,
  boxMatrix,
  destination,
  gesture as asGesture,
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
import { elemBounds, SceneIndex, SceneIndexer, type Unit } from "./hit";
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
import { createObjectTree, type TreeEntry } from "./objects";
import { DEFAULT_COLOR, DEFAULT_WIDTH, PALETTE, swatchOf, WIDTHS } from "./palette";
import { DEFAULT_TOOL, toolForKey, toolsFor, toolSpec, type Level, type ToolId, type ToolSpec } from "./registry";
import { constrainEnd, shapeElem, type ShapeTool } from "./shapes";

/// Una modifica del testo fatta da questa superficie, nella forma di
/// `EditorChange` (`operazioni.md` §6).
export interface DrawChange {
  /// Il testo grezzo di dopo, coi terminatori del file.
  readonly text: string;
  /// Le modifiche sul testo a LF di prima.
  readonly operation: TextOperation;
  readonly origin: "input" | "undo" | "redo";
}

export interface DrawEditorOptions {
  /// Il livello degli strumenti (default `essential`).
  readonly level?: Level;
  readonly images?: PainterOptions["images"];
  /// Che cosa fa un dito quando nessuna penna è vicina (default `auto`).
  readonly touch?: TouchPolicy;
  /// Chi legge e ricodifica le immagini incollate: quello del browser, se
  /// non è dato; `null` le rifiuta.
  readonly imageCodec?: ImageCodec | null;
  readonly onChange?: (change: DrawChange) => void;
  /// La selezione è cambiata: altri oggetti, o gli stessi con chiavi nuove.
  readonly onSelectionChange?: () => void;
}

export interface DrawEditor {
  readonly element: HTMLElement;
  readonly engine: SceneEngine;
  readonly tool: ToolId;
  readonly color: string;
  readonly width: number;
  /// Le chiavi degli oggetti selezionati in ordine di documento: l'id, o
  /// `@` e il percorso per un oggetto che non ne ha.
  readonly selection: readonly string[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /// Il documento ricostruito dal testo autorevole: la cronologia
  /// resta, la selezione tiene gli oggetti che ci sono ancora. Il motore ha
  /// un modello: un documento in sola lettura non si monta nell'editor.
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
  setTool(id: ToolId): void;
  setColor(color: string): void;
  setWidth(width: number): void;
  select(keys: readonly string[]): void;
  deleteSelection(): void;
  undo(): void;
  redo(): void;
  /// Inquadra la pagina e tutto ciò che ne esce.
  fit(): void;
  focus(): void;
  dispose(): void;
}

/// I limiti della camera del disegno (FD-205).
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

/// Lo scarto fra due immagini incollate insieme, in pixel: si vedono tutte.
const PASTE_STEP_PX = 24;

const INK_KEY = "pen";

/// Le icone della barra, col costrutto di `ui/icons.ts`.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-select": ["M6 3v15.5l4.2-4.1 2.9 6.6 2.6-1.1-2.9-6.5H19z"],
  "draw-pen": ["M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z", "M14 6.5l3 3"],
  "draw-eraser": ["M9 20h11", "M5.5 15.5l9.6-9.6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12.5 18.5 9 20l-3.5-1.5a2 2 0 0 1 0-3z", "M10 11l5 5"],
  "draw-rect": ["M4 6h16v12H4z"],
  "draw-ellipse": ["M3 12a9 6.5 0 1 0 18 0a9 6.5 0 1 0-18 0"],
  "draw-line": ["M5 19L19 5"],
  "draw-arrow": ["M5 19L19 5", "M10 5h9v9"],
  "draw-undo": ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  "draw-redo": ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  "draw-zoom-in": ["M12 5v14", "M5 12h14"],
  "draw-zoom-out": ["M5 12h14"],
  "draw-fit": ["M4 9V4h5", "M15 4h5v5", "M20 15v5h-5", "M9 20H4v-5"],
};

/// Registra le icone una volta per tutte le superfici: restano finché la
/// shell vive, come quelle di serie.
function ensureIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
}

/// Un gesto in corso, dalla pipeline della penna.
type Gesture = InkGesture | ShapeGesture | SelectGesture | EraseGesture | RefusedGesture;

interface GestureBase {
  /// Il tratto della pipeline: cambia quando un gesto lungo continua in un
  /// tratto nuovo al limite dei campioni.
  stroke: number;
  readonly pointer: InkPointerType;
}

interface InkGesture extends GestureBase {
  readonly kind: "ink";
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
}

interface EraseGesture extends GestureBase {
  readonly kind: "erase";
  last: Point | null;
  readonly marked: Map<string, Unit>;
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

/// Monta l'editor dentro `host`.
export function createDrawEditor(host: HTMLElement, initial: SceneEngine, owner: Lifetime, options: DrawEditorOptions = {}): DrawEditor {
  ensureIcons();
  const life = openLifetime();
  const tools = toolsFor(options.level ?? "essential");
  const relabels: Array<() => void> = [];

  let engine = initial;
  let tool: ToolId = tools.some((spec) => spec.id === DEFAULT_TOOL) ? DEFAULT_TOOL : tools[0]!.id;
  let color = DEFAULT_COLOR;
  let width = DEFAULT_WIDTH;
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
  relabels.push(() => {
    toolbar.setAttribute("aria-label", t("draw.toolbar"));
    surface.setAttribute("aria-label", t("draw.surface"));
    surfaceHint.textContent = t("draw.surface.hint");
  });

  const group = (label: Key, radio: boolean): HTMLElement => {
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

  const toolButtons = new Map<ToolId, HTMLButtonElement>();
  const toolGroup = group("draw.tools", true);
  for (const spec of tools) {
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

  const widthButtons = new Map<number, HTMLButtonElement>();
  const widthGroup = group("draw.widths", true);
  for (const option of WIDTHS) {
    const control = button(widthGroup, "draw-button draw-width", () => t(option.label), null, () => setWidth(option.value));
    control.setAttribute("role", "radio");
    const bar = document.createElement("span");
    bar.className = "draw-width-bar";
    bar.style.setProperty("--draw-width", `${option.value}px`);
    control.append(bar);
    widthButtons.set(option.value, control);
  }

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

  const viewGroup = group("draw.view", false);
  button(viewGroup, "draw-button", () => t("draw.zoom_out"), "draw-zoom-out", () => zoomBy(1 / ZOOM_STEP));
  // Il nome contiene la percentuale che si vede (WCAG 2.5.3): chi la dice a
  // voce trova il pulsante.
  const zoomLevel = button(viewGroup, "draw-button draw-zoom-level", () => t("draw.zoom_reset", { zoom: zoomText() }), null, () => zoomBy(1 / camera.scale));
  button(viewGroup, "draw-button", () => t("draw.zoom_in"), "draw-zoom-in", () => zoomBy(ZOOM_STEP));
  const fitButton = button(viewGroup, "draw-button", () => t("draw.fit"), "draw-fit", () => fit());
  fitButton.setAttribute("aria-keyshortcuts", "Shift+1");
  const objectsButton = button(viewGroup, "draw-button", () => t("draw.objects"), "outline", () => showObjects(tree.element.hidden));
  objectsButton.setAttribute("aria-expanded", "false");
  objectsButton.setAttribute("aria-controls", tree.element.id);
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

  // Il foglio e, accanto, l'albero degli oggetti.
  const body = document.createElement("div");
  body.className = "draw-body";
  body.append(surface, tree.element);
  header.append(toolbar, titleField);
  root.append(header, body, surfaceHint, live);
  host.append(root);

  // La carta, il painter, poi l'anteprima delle forme, poi lo strato sopra:
  // l'ordine in cui si vedono. La carta è bianca in ogni tema: è il fondo su
  // cui il disegno si legge anche fuori dall'editor, e su cui S009 misura il
  // contrasto del tratto.
  const paper = document.createElement("div");
  paper.className = "draw-page";
  paper.setAttribute("aria-hidden", "true");
  surface.append(paper);
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
    showZoom();
    showCursor();
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
    const keys = selection.join("\n");
    if (keys !== noticed) {
      noticed = keys;
      syncTree();
      options.onSelectionChange?.();
    }
  };

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
      const nodes = outline(items);
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

  const entriesOf = (nodes: readonly OutlineNode[], index: SceneIndex): TreeEntry[] =>
    nodes.map((node) => {
      const unit = index.get(node.key) ?? undefined;
      const layer = node.item.role === "layer";
      return {
        key: node.key,
        layer,
        selectable: unit !== undefined,
        children: layer ? entriesOf(node.children, index) : [],
        label: () => describeNode(node, unit),
      };
    });

  /// Le voci dell'albero per l'indice di adesso, e la selezione mostrata.
  let treeShown: { readonly index: SceneIndex; readonly entries: TreeEntry[]; readonly count: number; keys: string } | null = null;

  /// Porta l'albero, se è aperto, alla scena e alla selezione di adesso.
  function syncTree(): void {
    if (tree.element.hidden) return;
    const index = currentIndex();
    const keys = selection.join("\n");
    if (treeShown?.index !== index) {
      const nodes = outlineNow().nodes;
      treeShown = { index, entries: entriesOf(nodes, index), count: countObjects(nodes), keys: "" };
    } else if (treeShown.keys === keys) {
      return;
    }
    treeShown.keys = keys;
    tree.update(treeShown.entries, selection, treeShown.count);
  }

  /// Apre o chiude l'albero; aperto, il fuoco ci va.
  function showObjects(open: boolean): void {
    tree.element.hidden = !open;
    objectsButton.setAttribute("aria-expanded", String(open));
    if (open) {
      treeShown = null;
      syncTree();
      tree.focus();
    } else if (tree.element.contains(document.activeElement)) {
      surface.focus({ preventScroll: true });
    }
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

  const syncControls = (): void => {
    const canEdit = editable();
    root.toggleAttribute("data-readonly", !canEdit);
    surface.dataset.tool = tool;
    for (const [id, control] of toolButtons) {
      control.setAttribute("aria-checked", String(id === tool));
      control.disabled = !canEdit;
    }
    for (const [value, control] of colorButtons) {
      control.setAttribute("aria-checked", String(value === color));
      control.disabled = !canEdit;
    }
    for (const [value, control] of widthButtons) {
      control.setAttribute("aria-checked", String(value === width));
      control.disabled = !canEdit;
    }
    undoButton.disabled = !canEdit || !history.canUndo;
    redoButton.disabled = !canEdit || !history.canRedo;
    deleteButton.disabled = !canEdit || selection.length === 0;
    propertiesButton.disabled = !canEdit;
    titleInput.disabled = !canEdit;
    if (document.activeElement !== titleInput) titleInput.value = currentTitle();
    roving(null);
  };

  /// Porta la superficie alla scena del motore.
  const refresh = (): void => {
    scene = builder.build(engine);
    painter.setDraft(null);
    painter.update(scene);
    showPage();
    index = null;
    selection = inOrder(selection);
    syncControls();
    showHandles();
    syncTree();
  };

  // --- Operazioni -----------------------------------------------------------

  const emit = (applied: Applied, origin: DrawChange["origin"]): void => {
    if (applied.duplicate) return;
    options.onChange?.({ text: applied.text, operation: applied.operation, origin });
  };

  /// Applica il gesto `op` e lo mette nella cronologia col nome `label`.
  const commit = (label: Key, op: Op | null): Applied | null => {
    if (op === null || !editable()) return null;
    const outcome = engine.apply(op);
    if (outcome.outcome === "rejected") {
      announce(t("draw.rejected", { reason: t(REASONS[outcome.reason]) }));
      clearPreviews();
      return null;
    }
    history.record(label, outcome);
    refresh();
    emit(outcome, "input");
    return outcome;
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
    // La selezione segue ciò che il passo ha toccato e che c'è ancora.
    const touched = inOrder(applied.touched);
    if (touched.length > 0) selection = touched;
    syncControls();
    showHandles();
    emit(applied, origin);
    announce(t(origin === "undo" ? "draw.undone" : "draw.redone", { action }));
  };

  function undo(): void {
    if (!editable()) return;
    cancelGesture();
    replay(history.undo(engine), "undo");
  }

  function redo(): void {
    if (!editable()) return;
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
    locked = readOnly;
    if (locked) cancelGesture();
    syncControls();
  }

  // --- Strumenti --------------------------------------------------------------

  function setTool(id: ToolId): void {
    if (!tools.some((spec) => spec.id === id)) return;
    if (id !== tool) cancelGesture();
    tool = id;
    syncControls();
    announce(t("draw.announce.tool", { tool: t(toolSpec(id).label) }));
  }

  function setColor(value: string): void {
    color = value;
    syncControls();
  }

  function setWidth(value: number): void {
    width = value;
    syncControls();
  }

  function cancelGesture(): void {
    if (pressed !== null) cancelPress();
    else if (current !== null) pen.cancel();
  }

  // --- La pipeline della penna ------------------------------------------------

  /// Il livello che riceve: se non c'è lo si dice, e il gesto non scrive.
  const target = (ids: NewIds): Destination | null => {
    const to = destination(currentIndex(), ids);
    if (to === null) announce(t("draw.no_layer"));
    return to;
  };

  const begin = (start: StrokeStart): Gesture => {
    const base = { stroke: start.id, pointer: start.pointerType };
    if (!editable()) return { ...base, kind: "refused" };
    switch (tool) {
      case "pen": {
        const ids = newIds();
        const to = target(ids);
        if (to === null) return { ...base, kind: "refused" };
        let brush = brushForInput({ ...PF1_DEFAULTS, size: width, sim: false }, start.pressure);
        // Il seguito di un tratto chiuso al limite non si assottiglia alla
        // giunzione.
        if (start.continued) brush = { ...brush, taperStart: 0 };
        return { ...base, kind: "ink", color, brush, to, ids, scene: [], local: [], predicted: [] };
      }
      case "rect":
      case "ellipse":
      case "line":
      case "arrow": {
        const ids = newIds();
        const to = target(ids);
        if (to === null) return { ...base, kind: "refused" };
        return { ...base, kind: "shape", tool, color, width, to, ids, from: null, end: null };
      }
      case "eraser":
        return { ...base, kind: "erase", last: null, marked: new Map() };
      case "select":
        return { ...base, kind: "select", from: null, end: null, mode: "pending", units: [], base: [], release: null };
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
    overlay.setInk(INK_KEY, outline.length === 0 ? null : { outline, matrix: g.to.matrix, color: g.color, opacity: 1 });
    overlay.flush();
  };

  /// Gli estremi di una forma nelle coordinate del suo livello, con Maiusc
  /// applicato lì: un quadrato resta un quadrato nel livello.
  const shapeEnds = (g: ShapeGesture, to: Destination): [Point, Point] | null => {
    if (g.from === null || g.end === null) return null;
    const from = apply(to.inverse, g.from);
    const end = apply(to.inverse, g.end);
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
    return [roundDelta(g.end[0] - g.from[0]), roundDelta(g.end[1] - g.from[1])];
  };

  /// Il primo punto di un gesto di selezione: un oggetto sotto il puntatore
  /// si sceglie e si potrà trascinare; il vuoto comincia un riquadro.
  const selectStart = (g: SelectGesture, p: Point): void => {
    g.from = p;
    g.end = p;
    const hit = currentIndex().at(p, HIT_PX[g.pointer] / camera.scale);
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

  const selectEnd = (g: SelectGesture): void => {
    if (g.mode === "move") {
      const [dx, dy] = moveDelta(g);
      painter.setDraft(null);
      current = null;
      moveSelection(g.units, dx, dy);
      showHandles();
      return;
    }
    current = null;
    if (g.mode === "pending" && g.release !== null) select(selection.filter((key) => key !== g.release));
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
    const to = destination(currentIndex(), g.ids);
    if (to === null) {
      announce(t("draw.no_layer"));
      return;
    }
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
    const ops: Op[] = [...to.prelude, addOp(to, strokeElem(id, g.color, brush, ink, at))];
    const page = pageFor(scene.root.page, bounds.finish());
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.stroke", asGesture(ops)) !== null) announce(`${t("draw.added.stroke")} ${objects()}`);
  };

  const finishShape = (g: ShapeGesture): void => {
    const to = destination(currentIndex(), g.ids);
    if (to === null) {
      announce(t("draw.no_layer"));
      return;
    }
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

  // Maiusc si legge dall'evento del puntatore prima della pipeline, che
  // ascolta in cattura sullo stesso elemento: registrato prima di lei, questo
  // ascolto la precede, e il gesto vede lo stato dell'evento in corso.
  const readModifiers = (event: PointerEvent): void => {
    shift = event.shiftKey;
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
          g.from ??= toPoint(samples[0]!);
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
          selectEnd(g);
          return;
        case "erase":
          current = null;
          finishErase(g);
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

  /// Muove il cursore di (`dx`, `dy`) pixel dello schermo.
  const moveCursor = (dx: number, dy: number): void => {
    const [x, y] = cursorPoint();
    const next: Point = [x + dx / camera.scale, y + dy / camera.scale];
    cursor = next;
    cursorMark.hidden = false;
    keepInView(next);
    showCursor();
    trace(next);
    announceCursor();
  };

  /// Spazio: il gesto comincia dove è il cursore.
  const press = (timeStamp: number): void => {
    if (pressed !== null || !editable()) return;
    cancelGesture();
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

  life.listen(
    surface,
    "wheel",
    (event) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      if (event.ctrlKey || event.metaKey) {
        // Il pizzico del trackpad arriva così, a passi piccoli; la rotella
        // del mouse a passi da 100: il limite tiene lo scatto entro il 22%.
        const step = Math.max(-50, Math.min(50, dy));
        setCamera(zoomAtPoint(camera, Math.exp(-step * 0.005), localPoint(event.clientX, event.clientY), DRAW_SCALE_LIMITS));
      } else if (event.shiftKey && dx === 0) {
        setCamera({ ...camera, tx: camera.tx - dy });
      } else {
        setCamera({ ...camera, tx: camera.tx - dx, ty: camera.ty - dy });
      }
    },
    { passive: false },
  );

  // --- Tastiera --------------------------------------------------------------

  /// I controlli della barra raggiungibili adesso: uno solo prende il Tab,
  /// le frecce passano agli altri.
  let rovingCurrent: HTMLButtonElement | null = null;
  const focusable = (): HTMLButtonElement[] => [...toolbar.querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.disabled);

  function roving(target: HTMLButtonElement | null): void {
    const controls = focusable();
    const keep = target ?? rovingCurrent;
    rovingCurrent = keep !== null && controls.includes(keep) ? keep : controls[0] ?? null;
    for (const control of toolbar.querySelectorAll<HTMLButtonElement>("button")) control.tabIndex = control === rovingCurrent ? 0 : -1;
  }

  life.listen(toolbar, "keydown", (event) => {
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
    roving(controls[next]!);
    controls[next]!.focus();
  });
  life.listen(toolbar, "focusin", (event) => {
    if (event.target instanceof HTMLButtonElement) roving(event.target);
  });
  // Il puntatore non prende il fuoco: resta al foglio, con le scorciatoie.
  life.listen(toolbar, "mousedown", (event) => {
    if ((event.target as Element | null)?.closest("button")) event.preventDefault();
  });

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

  /// Porta il riquadro `from` della selezione in `to`, e la tiene scelta: la
  /// pagina cresce se serve, come per ogni oggetto che ne esce.
  const placeSelection = (units: readonly Unit[], from: Bounds, to: Bounds): boolean => {
    // Il riquadro va da `from` a `to` scalando sugli assi: ogni oggetto, il
    // suo contorno compreso, finisce dentro `to`.
    const moved = transformOps(units, boxMatrix(from, to), newIds());
    const ops: Op[] = [...moved.ops];
    const page = pageFor(scene.root.page, to);
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

  /// Le frecce sul foglio. Con una selezione la spostano, e con Ctrl o ⌘ la
  /// ridimensionano; senza, o mentre la tastiera preme, muovono il cursore.
  const arrows = (event: KeyboardEvent): boolean => {
    const direction = ARROWS[event.key];
    if (direction === undefined) return false;
    const [x, y] = direction;
    const fine = event.ctrlKey || event.metaKey;
    if (pressed === null && selection.length > 0 && editable()) {
      const step = event.shiftKey ? NUDGE_SHIFT : NUDGE;
      if (fine) resizeSelection(x * step, y * step);
      else moveSelection(selectedUnits(), x * step, y * step);
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

  /// L'elenco dei tasti, nei gruppi in cui si usano.
  const keyGroups = (): KeyGroup[] => [
    { title: t("draw.keys.tools"), rows: tools.map((spec) => [spec.shortcut, t(spec.label)] as const) },
    {
      title: t("draw.keys.cursor"),
      rows: [
        [ARROW_KEYS, t("draw.keys.cursor.move")],
        ["Space Enter", t("draw.keys.cursor.press")],
        ["Escape", t("draw.keys.cancel")],
      ],
    },
    {
      title: t("draw.objects"),
      rows: [
        [ARROW_KEYS, t("draw.keys.nudge")],
        [`Mod-${ARROW_KEYS}`, t("draw.keys.resize")],
        ["Tab Shift-Tab", t("draw.keys.walk")],
        ["Home End", t("draw.keys.ends")],
        ["Enter", t("draw.properties")],
        ["Delete", t("draw.delete")],
        ["Mod-a", t("draw.keys.all")],
        ["Escape", t("draw.keys.deselect")],
      ],
    },
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

  /// «?»: l'elenco dei tasti.
  async function keys(): Promise<void> {
    if (asking) return;
    asking = true;
    cancelGesture();
    try {
      await showKeys(t("draw.keys"), keyGroups());
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
    const step = PASTE_STEP_PX / camera.scale;
    // La scala del livello: una unità della scena vale `1 / k` unità sue.
    const k = Math.sqrt(Math.abs(to.matrix[0] * to.matrix[3] - to.matrix[1] * to.matrix[2]));
    const ops: Op[] = [...to.prelude];
    const keys: string[] = [];
    const bounds = new BoundsBuilder();
    let hrefBytes = 0;
    pictures.forEach((picture, i) => {
      const box = placeImage(picture.decoded.width, picture.decoded.height, view, [base[0] + i * step, base[1] + i * step]);
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
  life.listen(surface, "dragover", (event) => {
    if (!editable() || !carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
  });
  life.listen(surface, "drop", (event) => {
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
  });

  const onShift = (event: KeyboardEvent): void => {
    if (event.key !== "Shift") return;
    shift = event.type === "keydown";
    if (current?.kind === "shape") drawShape(current);
  };

  life.listen(root, "keyup", onShift);
  life.listen(root, "keydown", (event) => {
    onShift(event);
    if (event.defaultPrevented || event.target === titleInput) return;
    const onSurface = event.target === surface;
    if (onSurface && !event.altKey && arrows(event)) {
      event.preventDefault();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod) {
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y" && !event.shiftKey) {
        redo();
      } else if (key === "a" && !event.shiftKey) {
        select(currentIndex().units.map((unit) => unit.key));
        announceSelection();
      } else {
        return;
      }
      event.preventDefault();
      return;
    }
    if (event.altKey) return;
    if (onSurface && event.key === "Tab") {
      if (!walk(event.shiftKey ? -1 : 1)) return;
    } else if (onSurface && (event.key === "Home" || event.key === "End")) {
      if (pressed !== null || !visit(event.key === "Home" ? 0 : currentIndex().units.length - 1)) return;
    } else if (onSurface && event.key === " ") {
      if (event.repeat) {
        // Tenuto giù: un tasto, un passo.
      } else if (pressed === null) press(event.timeStamp);
      else release();
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
    get tool() {
      return tool;
    },
    get color() {
      return color;
    },
    get width() {
      return width;
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
      engine = next;
      loads++;
      history.clear();
      selection = [];
      cursor = null;
      cursorMark.hidden = true;
      refresh();
      placed = false;
      fit();
    },
    setReadOnly,
    reveal,
    adopt,
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
const REASONS: Readonly<Record<Reason, Key>> = {
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

/// Che cosa si annuncia quando una forma entra nel disegno.
const ADDED: Readonly<Record<ShapeTool, Key>> = {
  rect: "draw.added.rect",
  ellipse: "draw.added.ellipse",
  line: "draw.added.line",
  arrow: "draw.added.arrow",
};
