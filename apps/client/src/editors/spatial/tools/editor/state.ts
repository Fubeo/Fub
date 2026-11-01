// L'editor del disegno: lo stato dell'editor. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { DEFAULT_PEN, type PenId, type SavedPen } from "../../../../ink/pens";
import { resolvedLanguage } from "../../../../i18n/strings";
import { ensureDrawIcons } from "../../icons";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { DrawingFonts, vaultFontsOf } from "../../fonts/vault";
import { fontSheets, type FontSheets } from "../../picture";
import type { InkSample } from "../../../../ink/sample";
import type { StrokeStart } from "../../../../ink/input/session";
import type { Point } from "../../scene/matrix";
import type { ContainerNode, DocumentModel, ElementPart, LeafNode } from "../../scene/model";
import type { Tool } from "../../scene/analysis";
import type { SceneEngine } from "../../scene/engine";
import type { Op } from "../../scene/ops";
import type { DrawKey } from "../../strings";
import { NewIds } from "../edit";
import { followRepeats } from "../repeat-ops";
import { followTips } from "../tips";
import { followConnectors } from "../connectors";
import { followEffects } from "../effects";
import { followLabels } from "../labels";
import type { Frame } from "../frame";
import { DEFAULT_GRID, type Grid } from "../grid";
import type { View } from "../../view";
import { SceneIndex } from "../hit";
import { History } from "../history";
import {
  COVER_COLOR,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  HIGHLIGHTER_COLOR,
  HIGHLIGHTER_WIDTH,
  HIGHLIGHTER_WIDTHS,
  RECENT_COLORS,
  WIDTHS,
  type Width,
} from "../palette";
import { featuresFor, startTool, toolsOf, toolSpec, type Feature, type ToolId, type ToolProfile, type ToolSpec } from "../registry";
import { browserMeasure, estimate, type Font, type Measure } from "../measure";
import { TEXT_SIZE } from "../text";
import type { DrawSheet } from "../editor";
import type { EditorContext } from "./context";
import { checkedGrid } from "./helpers";
import type { DrawStyle, Entered, Gesture } from "./types";

/// Ciò che lo stato dell'editor dà agli altri pezzi dell'editor.
export interface StateContext {
  life: Lifetime;
  profile: ToolProfile;
  folio: DrawSheet | undefined;
  features: ReadonlySet<Feature>;
  tools: readonly ToolSpec[];
  has: (feature: Feature) => boolean;
  relabels: Array<() => void>;
  drawingFonts: DrawingFonts;
  /// I caratteri che le misure di una scrittura trovano ancora in arrivo,
  /// mentre `withFaces` li raccoglie.
  lateFonts: Font[] | null;
  measureText: Measure;
  pictureFonts: FontSheets;
  following: (next: SceneEngine) => SceneEngine;
  engine: SceneEngine;
  tool: ToolId;
  styles: Record<Tool | "cover", DrawStyle>;
  textStyle: DrawStyle;
  style: () => DrawStyle;
  toolLabel: (id: ToolId) => DrawKey;
  toolHint: (id: ToolId) => DrawKey;
  /// L'icona dello strumento `id`.
  toolIcon: (id: ToolId) => string;
  widthsNow: () => readonly Width[];
  /// L'ultimo colore scelto a piacere: un campione in più nella barra.
  custom: string | null;
  /// Gli strumenti di prima, il più recente per primo: le voci del menu
  /// radiale.
  recentTools: ToolId[];
  /// I colori scelti di recente, il più recente per primo, quello di adesso
  /// compreso: della sezione «Colori del documento» e, senza quello di
  /// adesso, del menu radiale. Li ricorda chi monta l'editor.
  recentColors: readonly string[];
  selection: string[];
  camera: View;
  /// Il formato della percentuale di zoom, nella lingua di adesso.
  percent: Intl.NumberFormat | null;
  zoomText: () => string;
  /// Il formato dell'angolo della vista, nella lingua di adesso.
  degrees: Intl.NumberFormat | null;
  turnText: (angle: number) => string;
  placed: boolean;
  current: Gesture | null;
  shift: boolean;
  disposed: boolean;
  /// La scrittura tolta da chi monta l'editor.
  locked: boolean;
  /// La selezione dell'ultima notifica, per non ripeterla, e la tavola
  /// scelta dallo strumento Tavola che il pannello e l'elenco hanno seguito.
  noticed: string;
  noticedBoard: string | null;
  /// Il cursore del foglio, nella scena: dove disegna la tastiera. `null`
  /// finché nessuno l'ha mosso.
  cursor: Point | null;
  /// Il gesto che la tastiera tiene premuto: i campioni dati finora, l'ultimo
  /// punto e il suo tempo.
  pressed: { readonly start: StrokeStart; readonly samples: InkSample[]; at: Point; time: number } | null;
  /// Gli id dei tratti da tastiera: negativi, così non incontrano mai quelli
  /// della pipeline, che crescono da zero.
  keyStrokes: number;
  /// Una finestra dell'editor è aperta, o un'immagine sta entrando: un
  /// secondo Invio non ne apre un'altra.
  asking: boolean;
  /// Quante volte l'editor ha caricato un altro documento: un'immagine letta
  /// per il documento di prima non entra in quello nuovo.
  loads: number;
  /// Il livello corrente scelto, dal livello Standard: la sua chiave, e il
  /// suo posto fra i figli della radice per ritrovarlo quando la chiave non
  /// c'è più. `null` finché nessuno ne sceglie uno.
  chosen: { readonly key: string; readonly at: number } | null;
  /// La griglia, e se Ctrl o ⌘ è tenuto durante un gesto del puntatore: col
  /// tasto giù l'aggancio aspetta.
  grid: Grid;
  free: boolean;
  /// Alt tenuto: durante un gesto del puntatore la cornice scala dal centro;
  /// senza gesto, con una selezione, le guide misurano.
  alt: boolean;
  /// La cornice di più oggetti dopo che la si è ruotata, ridimensionata o
  /// spostata: resta com'è diventata finché la selezione e il disegno non
  /// cambiano per altro. Una rotazione dopo l'altra gira così sempre
  /// attorno allo stesso centro.
  kept: { readonly index: SceneIndex; readonly keys: string; readonly frame: Frame } | null;
  /// L'ultimo tocco della selezione su un oggetto, per il doppio tocco.
  lastTap: { readonly key: string; readonly time: number; readonly at: Point } | null;
  /// Il gruppo, il collegamento o il simbolo isolato: si sceglie solo lì
  /// dentro, e il resto si attenua. La chiave, e il posto e il tag con cui
  /// ritrovarlo quando un'operazione gli dà un id o lo rifà, e le istanze da
  /// cui si è entrati nei simboli, dalla più esterna; `null` quando si
  /// sceglie in tutto il disegno. Isolare non scrive niente nel file.
  isolation: { readonly key: string; readonly path: readonly number[]; readonly tag: string; readonly through: readonly Entered[] } | null;
  /// Il nodo isolato nel modello di adesso, e le istanze da cui ci si
  /// arriva, cercati una volta per modello.
  isolatedFor: { readonly model: DocumentModel; readonly node: ContainerNode | null; readonly through: readonly LeafNode[] } | null;
  /// La penna con cui scrive la Penna (`ink/pens.ts`); l'evidenziatore ha la
  /// sua. Vale finché l'editor vive.
  penId: PenId;
  /// Dove è finito l'ultimo tratto scritto, nella scena, e con che strumento:
  /// Maiusc+clic tira una linea dritta da lì.
  lastInk: { readonly end: Point; readonly tool: Tool } | null;
  /// Quanto coprono la Penna e l'Evidenziatore, scelto da chi disegna:
  /// moltiplica quella della penna. Vale finché l'editor vive.
  inkOpacity: Record<"pen" | "highlighter", number>;
  /// Le penne salvate da chi disegna (`draw.pens`), della macchina.
  savedPens: readonly SavedPen[];
  /// Dov'è sceso l'ultimo puntatore, in pixel del foglio: un gesto che parte
  /// su un righello o su una guida è loro.
  downAt: Point | null;
  /// La guida del documento sotto il puntatore che passa, che si accende.
  hotGuide: number | null;
  history: History;
}

/// Monta lo stato dell'editor.
export function installState(ctx: EditorContext): void {
  const {
    initial, options
  } = ctx;
  ensureDrawIcons();
  const life = openLifetime();
  ctx.life = life;
  /// Il profilo sceglie gli strumenti; il foglio, se c'è, è quello delle
  /// annotazioni di un PDF.
  const profile = options.profile ?? "vector";
  ctx.profile = profile;
  const folio = options.sheet;
  ctx.folio = folio;
  // Lo spazio di lavoro sceglie le parti; senza, è il Completo.
  ctx.workspace = options.workspace ?? "full";
  ctx.column = options.toolbar ?? [];
  ctx.features = featuresFor(ctx.workspace, profile);
  ctx.tools = toolsOf(ctx.features);
  /// Vero se lo spazio di adesso offre `feature`.
  const has = (feature: Feature): boolean => ctx.features.has(feature);
  ctx.has = has;
  const relabels: Array<() => void> = [];
  ctx.relabels = relabels;

  /// I caratteri del disegno: le famiglie di Fub e, fuori dal foglio delle
  /// annotazioni, quelle del vault.
  const drawingFonts = new DrawingFonts(options.vaultFonts === undefined || folio !== undefined ? null : vaultFontsOf(options.vaultFonts));
  ctx.drawingFonts = drawingFonts;
  life.add(() => drawingFonts.dispose());
  const onFontNotes = options.onFontNotes;
  if (onFontNotes !== undefined) life.add(drawingFonts.watch(() => onFontNotes(drawingFonts.fontNotes())));

  /// Le larghezze del testo coi caratteri del disegno, dove il browser li sa
  /// misurare.
  const widths: Measure = browserMeasure(true, drawingFonts) ?? estimate;
  ctx.lateFonts = null;
  /// Le larghezze del testo, come `widths`; dentro `withFaces` si annota se
  /// una faccia del vault sta ancora arrivando.
  const measureText: Measure = (text, font) => {
    if (ctx.lateFonts !== null && !drawingFonts.settled(font)) ctx.lateFonts.push(font);
    return widths(text, font);
  };
  ctx.measureText = measureText;
  /// I caratteri del disegno per le sue immagini: gli strati estranei e il
  /// PNG copiato.
  const pictureFonts = fontSheets(drawingFonts);
  ctx.pictureFonts = pictureFonts;

  /// `next`, con le etichette al centro delle loro forme, i connettori che
  /// seguono gli oggetti a cui sono agganciati, le punte delle linee che
  /// tengono il colore del contorno, i filtri degli effetti la regione
  /// dell'oggetto e un originale nuovo di una ripetizione le sue copie: il
  /// motore li segue a ogni operazione, nello stesso passo
  /// d'annulla, e trova ciò che ha toccato col suo indice invece di scorrere
  /// il disegno. Le etichette vengono prima: un'etichetta che va a capo
  /// diversamente si riscrive al suo posto, prima che le punte aggiungano
  /// una `defs`.
  const following = (next: SceneEngine): SceneEngine => {
    const find = (id: string): ElementPart | null => next.holder(id);
    next.follow = (model, touched, op) => {
      const labels = followLabels(model, touched, find, measureText, op);
      const lines = followConnectors(model, touched, find, measureText, op);
      const tips = followTips(model, touched, new NewIds((id) => find(id) !== null), find);
      const regions = followEffects(model, touched, find, measureText);
      const copies = followRepeats(model, touched, find, new NewIds((id) => find(id) !== null));
      const ops = [labels, lines, tips, regions, copies].filter((each): each is Op => each !== null);
      return ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { op: "batch", ops };
    };
    return next;
  };
  ctx.following = following;
  ctx.engine = following(initial);
  ctx.tool = startTool(ctx.tools, profile);
  /// Il colore e lo spessore di chi scrive: la penna, le forme e le note li
  /// condividono, l'evidenziatore e la copertura hanno i loro.
  const styles: Record<Tool | "cover", DrawStyle> = {
    pen: { color: DEFAULT_COLOR, width: DEFAULT_WIDTH },
    highlighter: { color: HIGHLIGHTER_COLOR, width: HIGHLIGHTER_WIDTH },
    cover: { color: COVER_COLOR, width: DEFAULT_WIDTH },
  };
  ctx.styles = styles;
  /// Il testo ha il colore della penna, col suo campione, e il corpo suo,
  /// che la barra mostra al posto dello spessore.
  const textStyle: DrawStyle = {
    get color(): string {
      return styles.pen.color;
    },
    set color(value: string) {
      styles.pen.color = value;
    },
    width: TEXT_SIZE,
  };
  ctx.textStyle = textStyle;
  const style = (): DrawStyle => (styles[ctx.tool === "highlighter" || ctx.tool === "cover" ? ctx.tool : "pen"]);
  ctx.style = style;
  /// Il nome dello strumento `id`.
  const toolLabel = (id: ToolId): DrawKey => toolSpec(id).label;
  ctx.toolLabel = toolLabel;
  const toolHint = (id: ToolId): DrawKey => toolSpec(id).description;
  ctx.toolHint = toolHint;
  ctx.toolIcon = (id) => toolSpec(id).icon;
  /// Gli spessori, o le dimensioni del testo, che la barra offre allo
  /// strumento di adesso.
  const widthsNow = (): readonly Width[] => (ctx.tool === "highlighter" ? HIGHLIGHTER_WIDTHS : WIDTHS);
  ctx.widthsNow = widthsNow;
  ctx.custom = null;
  ctx.recentTools = [];
  ctx.recentColors = (options.colors ?? []).slice(0, RECENT_COLORS);
  ctx.selection = [];
  ctx.camera = { scale: 1, angle: 0, tx: 0, ty: 0 };
  ctx.percent = null;
  const zoomText = (): string =>
    (ctx.percent ??= new Intl.NumberFormat(resolvedLanguage(), { style: "percent", maximumFractionDigits: 0 })).format(ctx.camera.scale);
  ctx.zoomText = zoomText;
  ctx.degrees = null;
  const turnText = (angle: number): string =>
    (ctx.degrees ??= new Intl.NumberFormat(resolvedLanguage(), { style: "unit", unit: "degree", maximumFractionDigits: 0 })).format(Math.round(angle) || 0);
  ctx.turnText = turnText;
  ctx.placed = false;
  ctx.current = null;
  ctx.shift = false;
  ctx.disposed = false;
  ctx.locked = false;
  ctx.noticed = "";
  ctx.noticedBoard = null;
  ctx.cursor = null;
  ctx.pressed = null;
  ctx.keyStrokes = 0;
  ctx.asking = false;
  ctx.loads = 0;
  ctx.chosen = null;
  ctx.grid = options.grid === undefined ? DEFAULT_GRID : checkedGrid(options.grid, DEFAULT_GRID);
  ctx.free = false;
  ctx.alt = false;
  ctx.kept = null;
  ctx.lastTap = null;
  ctx.isolation = null;
  ctx.isolatedFor = null;
  ctx.penId = DEFAULT_PEN;
  ctx.lastInk = null;
  ctx.inkOpacity = { pen: 1, highlighter: 1 };
  ctx.savedPens = options.pens ?? [];
  ctx.downAt = null;
  ctx.hotGuide = null;
  const history = new History();
  ctx.history = history;
}
