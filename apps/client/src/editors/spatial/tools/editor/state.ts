// L'editor del disegno: lo stato dell'editor. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { resolvedLanguage } from "../../../../i18n/strings";
import { icon, registerIcon } from "../../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { DrawingFonts, vaultFontsOf } from "../../fonts/vault";
import { DEFAULT_SYMMETRY, type PenSymmetry } from "../symmetry";
import { fontSheets, type FontSheets } from "../../picture";
import type { InkSample } from "../../../../ink/sample";
import type { InkPointerType, StrokeStart } from "../../../../ink/dom/pen-input";
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
import { CUSTOM_DEFAULT, featuresFor, startTool, toolsOf, toolSpec, type Feature, type Level, type ToolId, type ToolProfile, type ToolSpec } from "../registry";
import { POLYGON_TOOL, type PolygonTool } from "../shapes";
import { browserMeasure, estimate, type Font, type Measure } from "../measure";
import { TEXT_SIZE, TEXT_SIZES } from "../text";
import type { DrawSheet } from "../editor";
import type { EditorContext } from "./context";
import { checkedGrid } from "./helpers";
import type { CutSpot, Drafting, DrawStyle, DropperHover, Editing, Entered, Gesture, NodePick, Typing, WidthSpot } from "./types";

/// Le icone della barra, col costrutto di `ui/icons.ts`.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-select": ["M6 3v15.5l4.2-4.1 2.9 6.6 2.6-1.1-2.9-6.5H19z"],
  "draw-pen": ["M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z", "M14 6.5l3 3"],
  "draw-eraser": ["M9 20h11", "M5.5 15.5l9.6-9.6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12.5 18.5 9 20l-3.5-1.5a2 2 0 0 1 0-3z", "M10 11l5 5"],
  "draw-rect": ["M4 6h16v12H4z"],
  "draw-ellipse": ["M3 12a9 6.5 0 1 0 18 0a9 6.5 0 1 0-18 0"],
  "draw-line": ["M5 19L19 5"],
  "draw-arrow": ["M5 19L19 5", "M10 5h9v9"],
  // Due quadratini, uno in alto a sinistra e uno in basso a destra, e il
  // gomito che li unisce con la freccia.
  "draw-connector": ["M3 3h6v6H3z", "M15 15h6v6h-6z", "M9 6h3v12h3", "M13 16l2 2-2 2"],
  "draw-polygon": ["M7.5 4.2h9l4.5 7.8-4.5 7.8h-9L3 12z"],
  "draw-star": ["M12 3l2.1 6.6H21l-5.5 4 2.1 6.6-5.6-4.1-5.6 4.1 2.1-6.6L3 9.6h6.9z"],
  "draw-highlighter": ["M13.5 3.5l7 7-7 7-7-7z", "M6.5 10.5L3 18l3 3 7.5-3.5", "M15 21h6"],
  // Un foglietto con l'angolo piegato, e due righe.
  "draw-note": ["M5 4h14v10l-5 6H5z", "M14 20v-6h5", "M8 8.5h8", "M8 11.5h4"],
  // Un rettangolo pieno, a tratteggio.
  "draw-cover": ["M4 6h16v12H4z", "M4 11l5-5", "M4 17l11-11", "M10 18l10-10", "M16 18l4-4"],
  "draw-color-more": ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 8v8", "M8 12h8"],
  "draw-undo": ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  "draw-redo": ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  "draw-zoom-in": ["M12 5v14", "M5 12h14"],
  "draw-zoom-out": ["M5 12h14"],
  "draw-fit": ["M4 9V4h5", "M15 4h5v5", "M20 15v5h-5", "M9 20H4v-5"],
  "draw-duplicate": ["M9 9h11v11H9z", "M15 9V4H4v11h5"],
  "draw-group": ["M3 7V3h4", "M17 3h4v4", "M21 17v4h-4", "M7 21H3v-4", "M7 7h6v6H7z", "M11 11h6v6h-6z"],
  "draw-ungroup": ["M3 3h8v8H3z", "M13 13h8v8h-8z"],
  "draw-symbol": ["M12 2l3 3-3 3-3-3z", "M12 16l3 3-3 3-3-3z", "M5 9l3 3-3 3-3-3z", "M19 9l3 3-3 3-3-3z"],
  "draw-detach": ["M7 3l3 3-3 3-3-3z", "M17 15l3 3-3 3-3-3z", "M4 20L20 4"],
  // Tre petali uguali intorno a un centro: un originale e le sue copie.
  "draw-repeat": ["M12 14C10 10.7 10 7.3 12 4C14 7.3 14 10.7 12 14z", "M12 14C15.9 13.9 18.8 15.6 20.7 19C16.8 19.1 13.9 17.4 12 14z", "M12 14C10.1 17.4 7.2 19.1 3.3 19C5.2 15.6 8.1 13.9 12 14z"],
  "draw-order": ["M10 14H4V4h10v6", "M10 10h10v10H10z"],
  "draw-align": ["M4 3v18", "M8 6h12v5H8z", "M8 14h7v5H8z"],
  "draw-layers": ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5", "M3 17.5l9 5 9-5"],
  "draw-into-layer": ["M12 11l9 5-9 5-9-5z", "M12 2v7", "M9 6l3 3 3-3"],
  "draw-page-grid": ["M3 3h18v18H3z", "M9 3v18", "M15 3v18", "M3 9h18", "M3 15h18"],
  // Un foglio coi suoi segni di taglio: i bordi che continuano oltre gli
  // angoli.
  "draw-board": ["M2 6h20", "M2 18h20", "M6 2v20", "M18 2v20"],
  // Una pipetta: la punta in basso a sinistra, il bulbo in alto a destra.
  "draw-eyedropper": ["M13 9L5.5 16.5 4 20l3.5-1.5L15 11", "M11.5 7.5l5 5", "M12.5 8.5l4-4a2.1 2.1 0 0 1 3 3l-4 4"],
  // Un riquadro che scurisce verso destra, con righe sempre più fitte.
  "draw-gradient": ["M3 5h18v14H3z", "M11 5v14", "M15 5v14", "M18 5v14"],
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
  // Un'immagine coi suoi monti, e sotto il tracciato che se ne ricava.
  "draw-trace-image": ["M3 3h11v9H3z", "M3 10l3-3 3 3 2-2 3 3", "M6 21c3 0 4-5 7.5-5s4 3 6.5 3", "M19.5 17.5h3v3h-3z"],
  "draw-text-path": ["M3 20C6 12 18 12 21 20", "M7 4h10", "M12 4v9"],
  // Le due squadre della taglierina, che si incrociano.
  "draw-crop": ["M6 2v16h16", "M2 6h16v16"],
  // Le stesse, barrate.
  "draw-uncrop": ["M6 2v16h16", "M2 6h16v16", "M3 3l18 18"],
  // Un cerchio pieno in un quadrato a tratti: fuori dalla forma non si vede.
  "draw-mask": ["M3 6V3h3", "M10 3h4", "M18 3h3v3", "M21 10v4", "M21 18v3h-3", "M14 21h-4", "M6 21H3v-3", "M3 14v-4", "M6 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0"],
  "draw-nodes": ["M4 3v12l3.2-3.1 2.3 5.1 2-.9-2.3-5H15z", "M16 16h5v5h-5z"],
  "draw-builder": ["M3 9a6 6 0 1 0 12 0a6 6 0 1 0-12 0", "M9 9h11v11H9z", "M5 17v5", "M2.5 19.5h5"],
  // Due anelli in basso, e le lame che si incrociano verso l'alto.
  "draw-scissors": ["M3.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", "M15.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", "M7.8 16.2L17 3", "M16.2 16.2L7 3"],
  // Una linea che si gonfia in mezzo, e il punto che la allarga.
  "draw-width": ["M2 12C6 7.5 18 7.5 22 12C18 16.5 6 16.5 2 12z", "M12 3v18", "M10 5l2-2 2 2", "M10 19l2 2 2-2"],
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
  // L'elenco delle tavole: due fogli affiancati, ognuno col suo nome sopra.
  "draw-boards": ["M3 8.5h8v11H3z", "M14 8.5h7v7h-7z", "M3 5h5", "M14 5h4"],
  // Le forme: un quadrato, un cerchio e un triangolo.
  "draw-library": ["M3 3h8v8H3z", "M13 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0", "M12 14l5 7H7z"],
  // I simboli: un rombo, come «Crea simbolo», sopra una pila di fogli.
  "draw-symbols": ["M12 2.5l4.5 4.5-4.5 4.5L7.5 7z", "M4.5 14l7.5 4 7.5-4", "M4.5 18l7.5 4 7.5-4"],
};

/// Registra le icone una volta per tutte le superfici: restano finché la
/// shell vive, come quelle di serie.
function ensureIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
}

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
  ensureIcons();
  const life = openLifetime();
  ctx.life = life;
  /// Il profilo sceglie gli strumenti; il foglio, se c'è, è quello delle
  /// annotazioni di un PDF.
  const profile = options.profile ?? "vector";
  ctx.profile = profile;
  const folio = options.sheet;
  ctx.folio = folio;
  ctx.level = options.level ?? "essential";
  ctx.picked = options.custom ?? CUSTOM_DEFAULT;
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
  ctx.curveTap = null;
  ctx.curveNodeTap = null;
  ctx.hover = null;
  ctx.downAt = null;
  ctx.hotGuide = null;
  ctx.lastGuideTap = null;
  const history = new History();
  ctx.history = history;
}
