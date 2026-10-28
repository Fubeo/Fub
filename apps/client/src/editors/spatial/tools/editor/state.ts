// L'editor del disegno: lo stato dell'editor. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { DEFAULT_PEN, type PenId, type SavedPen } from "../../../../ink/pens";
import { resolvedLanguage } from "../../../../i18n/strings";
import { ensureDrawIcons } from "../../icons";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { DrawingFonts, vaultFontsOf } from "../../fonts/vault";
import { DEFAULT_SYMMETRY, type PenSymmetry } from "../symmetry";
import { fontSheets, type FontSheets } from "../../picture";
import type { InkSample } from "../../../../ink/sample";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { StrokeStart } from "../../../../ink/input/session";
import type { Matrix, Point } from "../../scene/matrix";
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
import type { Builder } from "../builder";
import type { NodeKey, NodeKind, Subpath } from "../nodes";
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
import { CUSTOM_DEFAULT, featuresFor, startTool, toolsOf, toolSpec, workspaceLevel, workspaceOfLevel, type Feature, type Level, type ToolId, type ToolProfile, type ToolSpec } from "../registry";
import { POLYGON_TOOL, type PolygonTool } from "../shapes";
import { browserMeasure, estimate, type Font, type Measure } from "../measure";
import { TEXT_SIZE, TEXT_SIZES } from "../text";
import type { DrawSheet } from "../editor";
import type { EditorContext } from "./context";
import { checkedGrid } from "./helpers";
import type { CutSpot, Drafting, DrawStyle, DropperHover, Editing, Entered, Gesture, NodePick, Typing, WidthSpot } from "./types";

/// Ciò che lo stato dell'editor dà agli altri pezzi dell'editor.
export interface StateContext {
  life: Lifetime;
  profile: ToolProfile;
  folio: DrawSheet | undefined;
  level: Level;
  /// Le parti scelte per il Personalizzato, anche mentre il livello è un
  /// altro: tornando al Personalizzato valgono di nuovo.
  picked: readonly string[];
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
  /// Come disegna lo strumento Poligono: poligono o stella, i lati, le punte,
  /// il rapporto interno e il raggio degli angoli. Vale finché l'editor vive,
  /// come il colore; lo cambiano i tasti mentre si disegna e il pannello
  /// delle proprietà.
  polygonTool: PolygonTool;
  /// La simmetria della penna e dell'evidenziatore: il tipo, gli spicchi e
  /// il centro. Vale finché l'editor vive, come lo strumento Poligono; il
  /// centro torna al suo posto con un altro disegno.
  symmetry: PenSymmetry;
  toolLabel: (id: ToolId) => DrawKey;
  toolHint: (id: ToolId) => DrawKey;
  /// L'icona dello strumento `id` come disegna adesso: la stella, la
  /// Curvatura.
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
  /// Il testo che si sta scrivendo nel campo sopra il foglio.
  typing: Typing | null;
  /// Il puntatore è sceso sul foglio mentre si scriveva: quel tocco chiude il
  /// testo, e lo strumento Testo non ne apre un altro.
  closedTyping: boolean;
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
  /// Lo strumento Nodi: le forme di cui modifica i nodi, in ordine di
  /// documento, o perché gli oggetti scelti non ne hanno; i nodi scelti di
  /// ogni forma; i tipi che chi modifica ha dato ai nodi, che il file non
  /// scrive e che valgono finché la forma ha gli stessi nodi; e le forme
  /// scelte con lo strumento, coi loro percorsi nel modello.
  edits: readonly Editing[];
  noEditing: DrawKey | null;
  nodeSelection: NodePick;
  nodeKinds: ReadonlyMap<string, ReadonlyMap<NodeKey, NodeKind>>;
  kindsAt: Map<number, ReadonlyMap<string, ReadonlyMap<string, NodeKind>>>;
  focused: readonly (readonly number[])[];
  /// Quante forme l'ultima modifica dei nodi ha fatto tracciati, e perché
  /// ne ha lasciata com'era qualcuna.
  converted: number;
  skipped: DrawKey | null;
  /// Ciò con cui le forme sono state trovate: cambiato, le si ritrova.
  resolvedFor: {
    readonly index: SceneIndex;
    readonly keys: string;
    readonly tool: ToolId;
    readonly curve: boolean;
    readonly features: ReadonlySet<Feature>;
    readonly editable: boolean;
    readonly focused: readonly (readonly number[])[];
  } | null;
  /// La forma sotto il puntatore che passa, con lo strumento Nodi: il suo
  /// contorno e i suoi nodi si vedono prima di toccarla, come con la
  /// Selezione diretta di Illustrator. Vale per la scena in cui la si è
  /// trovata.
  nodesHover: {
    readonly index: SceneIndex;
    readonly leaf: LeafNode;
    readonly subs: readonly Subpath[] | null;
    readonly matrix: Matrix;
  } | null;
  /// Dove le Forbici taglierebbero sotto il puntatore che passa, o sotto il
  /// cursore della tastiera: il contorno della forma e il punto si vedono
  /// prima di tagliare. Vale per la scena in cui lo si è trovato.
  cutHover: { readonly index: SceneIndex; readonly spot: CutSpot } | null;
  /// Dove lavorerebbe lo Spessore sotto il puntatore che passa, o sotto il
  /// cursore della tastiera: la linea della forma e i suoi punti si vedono
  /// prima di toccarla. Vale per la scena in cui lo si è trovato.
  widthHover: { readonly index: SceneIndex; readonly spot: WidthSpot } | null;
  /// Ciò che il contagocce vede sotto il puntatore che passa, o sotto il
  /// cursore della tastiera: l'anteprima di ciò che prenderebbe.
  dropperHover: DropperHover | null;
  /// Il punto del profilo scelto con lo Spessore: il percorso della sua
  /// linea nel modello, e il suo indice. Canc lo toglie, Invio ne apre le
  /// misure.
  widthPicked: { readonly path: readonly number[]; readonly point: number } | null;
  /// L'ultimo tocco su un punto dello Spessore, per il doppio tocco.
  widthTap: { readonly path: readonly number[]; readonly point: number; readonly at: Point; readonly time: number } | null;
  /// Il Costruttore di forme sugli oggetti scelti, per la scena e la
  /// selezione in cui lo si è fatto; dalla scena alle coordinate delle sue
  /// regioni. `builder` è `null` se non c'è niente di scelto o se il calcolo
  /// non riesce, e `complex` dice se è per le forme troppo complesse.
  building: {
    readonly index: SceneIndex;
    readonly keys: string;
    readonly builder: Builder | null;
    readonly complex: boolean;
    readonly inverse: Matrix | null;
  } | null;
  /// La regione del Costruttore sotto il puntatore che passa, e quella a cui
  /// si è arrivati con Tab; -1 per nessuna. Le regioni scelte con Spazio,
  /// nell'ordine: la prima dà lo stile all'unione.
  regionHover: number;
  regionActive: number;
  regionsChosen: number[];
  /// L'ultimo tocco su un segmento, per il doppio tocco che aggiunge un nodo.
  lastSegmentTap: { readonly shape: string; readonly sub: number; readonly link: number; readonly time: number; readonly at: Point } | null;
  /// Il tracciato che la penna di Bézier sta disegnando: i nodi nella scena,
  /// i passi fatti e quelli annullati, che Annulla e Ripeti percorrono, gli
  /// id e il livello dell'anteprima. Si scrive quando si conclude, sul
  /// livello di allora.
  drafting: Drafting | null;
  /// Come posa i nodi la penna di Bézier: coi punti e le maniglie, o con la
  /// Curvatura, dove si posano solo i punti e la curva vi passa morbida.
  /// Vale finché l'editor vive, come il Poligono che fa le stelle.
  curvature: boolean;
  /// La penna con cui scrive la Penna (`ink/pens.ts`); l'evidenziatore ha la
  /// sua. Vale finché l'editor vive, come la Curvatura.
  penId: PenId;
  /// Dove è finito l'ultimo tratto scritto, nella scena, e con che strumento:
  /// Maiusc+clic tira una linea dritta da lì.
  lastInk: { readonly end: Point; readonly tool: Tool } | null;
  /// Quanto coprono la Penna e l'Evidenziatore, scelto da chi disegna:
  /// moltiplica quella della penna. Vale finché l'editor vive.
  inkOpacity: Record<"pen" | "highlighter", number>;
  /// Le penne salvate da chi disegna (`draw.pens`), della macchina.
  savedPens: readonly SavedPen[];
  /// L'ultimo punto che la Curvatura ha posato con un tocco: toccato di
  /// nuovo subito, nello stesso posto, diventa uno spigolo.
  curveTap: { readonly index: number; readonly at: Point; readonly time: number } | null;
  /// L'ultimo nodo di un tracciato scelto che la Curvatura ha toccato: due
  /// tocchi lo fanno passare da liscio a spigolo e ritorno.
  curveNodeTap: { readonly shape: string; readonly key: NodeKey; readonly at: Point; readonly time: number } | null;
  /// Il puntatore sopra il foglio, senza premere, o il cursore mentre la
  /// penna di Bézier disegna: lì va il segmento che verrebbe.
  hover: { readonly at: Point; readonly pointer: InkPointerType } | null;
  /// Dov'è sceso l'ultimo puntatore, in pixel del foglio: un gesto che parte
  /// su un righello o su una guida è loro.
  downAt: Point | null;
  /// La guida del documento sotto il puntatore che passa, che si accende.
  hotGuide: number | null;
  /// L'ultimo tocco su una guida, per il doppio tocco che apre «Guide».
  lastGuideTap: { readonly index: number; readonly time: number; readonly at: Point } | null;
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
  // Lo spazio di lavoro, se c'è, sceglie il livello; senza, lo dice il
  // livello.
  const offered = options.workspace === undefined ? null : workspaceLevel(options.workspace, profile);
  ctx.level = offered?.level ?? options.level ?? "essential";
  ctx.picked = offered?.custom ?? options.custom ?? CUSTOM_DEFAULT;
  ctx.workspace = options.workspace ?? workspaceOfLevel(ctx.level);
  ctx.byWorkspace = options.workspace !== undefined;
  ctx.column = options.toolbar ?? [];
  ctx.features = featuresFor(ctx.level, ctx.picked, profile);
  ctx.tools = toolsOf(ctx.features);
  /// Vero se il livello di adesso offre `feature`.
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
    pen: { color: DEFAULT_COLOR, width: DEFAULT_WIDTH, swatch: null },
    highlighter: { color: HIGHLIGHTER_COLOR, width: HIGHLIGHTER_WIDTH, swatch: null },
    cover: { color: COVER_COLOR, width: DEFAULT_WIDTH, swatch: null },
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
    get swatch(): string | null {
      return styles.pen.swatch;
    },
    set swatch(value: string | null) {
      styles.pen.swatch = value;
    },
    width: TEXT_SIZE,
  };
  ctx.textStyle = textStyle;
  const style = (): DrawStyle => (ctx.tool === "text" ? textStyle : styles[ctx.tool === "highlighter" || ctx.tool === "cover" ? ctx.tool : "pen"]);
  ctx.style = style;
  ctx.polygonTool = POLYGON_TOOL;
  ctx.symmetry = DEFAULT_SYMMETRY;
  /// Il nome dello strumento `id`: il Poligono, quando disegna stelle, si
  /// chiama Stella.
  /// La penna di Bézier, con la Curvatura, si chiama Curvatura.
  const toolLabel = (id: ToolId): DrawKey =>
    id === "polygon" && ctx.polygonTool.shape === "star" ? "draw.tool.star" : id === "bezier" && ctx.curvature ? "draw.tool.curvature" : toolSpec(id).label;
  ctx.toolLabel = toolLabel;
  const toolHint = (id: ToolId): DrawKey =>
    id === "polygon" && ctx.polygonTool.shape === "star" ? "draw.tool.star.hint" : id === "bezier" && ctx.curvature ? "draw.tool.curvature.hint" : toolSpec(id).description;
  ctx.toolHint = toolHint;
  ctx.toolIcon = (id) =>
    id === "polygon" && ctx.polygonTool.shape === "star" ? "draw-star" : id === "bezier" && ctx.curvature ? "draw-curvature" : toolSpec(id).icon;
  /// Gli spessori, o le dimensioni del testo, che la barra offre allo
  /// strumento di adesso.
  const widthsNow = (): readonly Width[] => (ctx.tool === "highlighter" ? HIGHLIGHTER_WIDTHS : ctx.tool === "text" ? TEXT_SIZES : WIDTHS);
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
  ctx.typing = null;
  ctx.closedTyping = false;
  ctx.lastTap = null;
  ctx.isolation = null;
  ctx.isolatedFor = null;
  ctx.edits = [];
  ctx.noEditing = null;
  ctx.nodeSelection = new Map();
  ctx.nodeKinds = new Map();
  /// I tipi dati ai nodi a ogni punto della cronologia dove una modifica dei
  /// nodi li ha lasciati: il file non li scrive, e un annulla o un ripeti li
  /// riporta come erano lì.
  const kindsAt = new Map<number, ReadonlyMap<string, ReadonlyMap<NodeKey, NodeKind>>>();
  ctx.kindsAt = kindsAt;
  ctx.focused = [];
  ctx.converted = 0;
  ctx.skipped = null;
  ctx.resolvedFor = null;
  ctx.nodesHover = null;
  ctx.cutHover = null;
  ctx.widthHover = null;
  ctx.dropperHover = null;
  ctx.widthPicked = null;
  ctx.widthTap = null;
  ctx.building = null;
  ctx.regionHover = -1;
  ctx.regionActive = -1;
  ctx.regionsChosen = [];
  ctx.lastSegmentTap = null;
  ctx.drafting = null;
  ctx.curvature = false;
  ctx.penId = DEFAULT_PEN;
  ctx.lastInk = null;
  ctx.inkOpacity = { pen: 1, highlighter: 1 };
  ctx.savedPens = options.pens ?? [];
  ctx.curveTap = null;
  ctx.curveNodeTap = null;
  ctx.hover = null;
  ctx.downAt = null;
  ctx.hotGuide = null;
  ctx.lastGuideTap = null;
  const history = new History();
  ctx.history = history;
}
