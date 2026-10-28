// L'editor del disegno: le costanti, che più pezzi di createDrawEditor
// condividono.

import type { ScaleLimits } from "../../../../spatial/camera";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { Role } from "../../scene/analysis";
import type { LengthUnit } from "../../scene/rulers";
import type { DrawKey } from "../../strings";
import type { NodeShape } from "../../painter/overlay";
import type { Axis, Edge, Order } from "../arrange";
import type { Join } from "../offset";
import type { NodeKey, NodeKind } from "../nodes";
import type { NoNodes } from "../nodable";
import type { Feature } from "../registry";
import type { ShapeTool } from "../shapes";

/// I limiti della camera del disegno.
export const DRAW_SCALE_LIMITS: ScaleLimits = { min: 0.1, max: 32 };

/// Quanto lontano dal tratto un tocco prende ancora l'oggetto, in pixel: il
/// dito copre più della penna.
export const HIT_PX: Readonly<Record<InkPointerType, number>> = { pen: 6, mouse: 4, touch: 12 };

/// Oltre questo spostamento, in pixel, un tocco su un oggetto diventa un
/// trascinamento.
export const DRAG_PX: Readonly<Record<InkPointerType, number>> = { pen: 3, mouse: 3, touch: 8 };

/// Il Lazo tiene un punto ogni tanti pixel dello schermo, e al massimo
/// tanti punti: oltre, ne lascia uno ogni due, e il lazo resta lo stesso a
/// occhio.
export const LASSO_STEP_PX = 2;

export const LASSO_MAX_POINTS = 512;

/// Sotto questa misura, in pixel, una forma è un tocco e non si scrive.
export const MIN_SHAPE_PX = 4;

export const ZOOM_STEP = 1.25;
/// Le azioni che la barra accanto alla selezione mostra; le altre vanno nel
/// suo «…» (B7).
export const ARRANGE_SHOWN = 6;
/// Quanto la rotella deve tacere perché lo zoom sia finito, in ms.
export const ZOOM_SETTLE_MS = 160;

export const FIT_PAD = 0.08;

/// Il margine dell'inquadratura d'apertura, in pixel dello schermo.
export const OPEN_MARGIN_PX = 48;

/// Di quanto le frecce spostano o ridimensionano la selezione, in unità
/// della scena.
export const NUDGE = 1;

export const NUDGE_SHIFT = 10;

/// Il passo di `[` e `]`, e della rotazione con Maiusc, in gradi; con Maiusc
/// i tasti girano di un angolo retto.
export const ROTATE_STEP = 15;

/// Gli oggetti che la cornice ridimensiona dagli angoli tenendo le
/// proporzioni, se Maiusc non dice il contrario: deformati, non sono più
/// loro.
export const RATIO_ROLES: ReadonlySet<Role> = new Set<Role>(["group", "link", "stroke", "text", "image"]);

/// Le parti che hanno un pulsante nella barra della selezione.
export const BAR_FEATURES: readonly Feature[] = ["text", "arrange", "links", "layers", "recognize", "transform", "apply", "path", "boolean", "outline", "crop", "trace", "masks", "motifs", "typeset", "connector", "symbols", "repeat"];

/// Il tasto che mostra e nasconde gli attributi, dal livello Esperto: lo
/// stesso dell'editor XML di Inkscape.
export const ATTRIBUTES_BINDING = "Mod-Shift-x";

/// «Trasforma», dal livello Esperto: lo stesso tasto della finestra di
/// Inkscape.
export const TRANSFORM_BINDING = "Mod-Shift-m";

/// «Immagine dal vault…», dal livello Standard: il tasto con cui Inkscape
/// importa.
export const IMAGE_BINDING = "Mod-i";

/// «Crea maschera di ritaglio» e «Rilascia maschera», dal livello Esperto:
/// i tasti di Illustrator, con il 7 per posizione.
export const CLIP_MASK_BINDING = "Mod-7";

export const RELEASE_MASK_BINDING = "Mod-Alt-7";

/// Lo scarto di una copia dal suo originale, e fra due immagini incollate
/// insieme, in pixel dello schermo: si vedono tutte, a ogni zoom.
export const COPY_STEP_PX = 24;

/// «Copia lo stile» e «Incolla lo stile», dal livello Standard: i tasti di
/// Inkscape.
export const COPY_STYLE_BINDING = "Mod-Alt-c";

export const PASTE_STYLE_BINDING = "Mod-Alt-v";

export const INK_KEY = "pen";

/// La chiave dell'anteprima della copia `k` in simmetria del tratto in
/// corso, da 0.
export const inkCopyKey = (k: number): string => `${INK_KEY}:${k}`;

/// Due tocchi sullo stesso testo entro questo tempo, in millisecondi, e
/// questa distanza, in pixel, lo aprono: un doppio tocco come quello di un
/// mouse, che vale anche per la penna e il dito.
export const DOUBLE_TAP_MS = 500;

export const DOUBLE_TAP_PX: Readonly<Record<InkPointerType, number>> = { pen: 8, mouse: 6, touch: 16 };

/// Quanto lontano da un nodo o da una maniglia un tocco li prende ancora, in
/// pixel: un bersaglio largo almeno 24 pixel (WCAG 2.5.8), di più per il
/// dito. Fra due vicini vince il più vicino.
export const NODE_PX: Readonly<Record<InkPointerType, number>> = { pen: 12, mouse: 12, touch: 20 };

/// Quanto lontani due capi possono stare sullo schermo, in pixel, e con
/// «Unisci» diventare un nodo solo: così si vedono toccarsi. Più lontani, li
/// unisce una linea.
export const JOIN_PX = 2;

/// La forma di un nodo, per tipo, come la disegna lo strato sopra.
export const NODE_SHAPES: Readonly<Record<NodeKind, NodeShape>> = { corner: "diamond", smooth: "square", symmetric: "circle" };

/// Gli angoli dello scostamento, coi loro nomi, nell'ordine della barra.
export const JOIN_NAMES: ReadonlyMap<Join, DrawKey> = new Map([
  ["miter", "draw.offset.join.miter"],
  ["round", "draw.offset.join.round"],
  ["bevel", "draw.offset.join.bevel"],
]);

/// I passi del cursore di «Semplifica», e lo scarto ai due capi, in parti
/// della diagonale delle forme scelte: da quasi niente a un ventesimo. Fra
/// i capi lo scarto cresce in proporzione, e ogni passo semplifica in scala
/// quanto il precedente.
export const SIMPLIFY_STEPS = 100;

/// La scelta dello strumento Tavola quando è la pagina: non è l'id di una
/// tavola, perché un id XML non comincia con «#».
export const PAGE_SHEET = "#page";

/// Nessun nodo, e nessun tipo dato.
export const NO_KEYS: ReadonlySet<NodeKey> = new Set();

export const NO_KINDS: ReadonlyMap<NodeKey, NodeKind> = new Map();

/// Il tasto che mostra e nasconde i righelli: Ctrl+R, quello dei programmi di
/// disegno, ricarica la pagina nel browser.
export const RULERS_BINDING = "Shift-r";

/// Ciò che si dice quando il documento cambia unità.
export const UNITS_NOW: Readonly<Record<LengthUnit, DrawKey>> = {
  px: "draw.units.now.px",
  mm: "draw.units.now.mm",
  cm: "draw.units.now.cm",
  in: "draw.units.now.in",
  pt: "draw.units.now.pt",
};

/// Le voci dell'ordine, dalla cima al fondo, con le loro scorciatoie.
export const ORDERS: ReadonlyArray<{ readonly order: Order; readonly label: DrawKey; readonly binding: string }> = [
  { order: "front", label: "draw.order.front", binding: "Mod-Shift-]" },
  { order: "forward", label: "draw.order.forward", binding: "Mod-]" },
  { order: "backward", label: "draw.order.backward", binding: "Mod-[" },
  { order: "back", label: "draw.order.back", binding: "Mod-Shift-[" },
];

/// Le voci dell'allineamento: prima i bordi e il centro in orizzontale, poi
/// in verticale.
export const EDGES: ReadonlyArray<{ readonly edge: Edge; readonly label: DrawKey }> = [
  { edge: "left", label: "draw.align.left" },
  { edge: "center", label: "draw.align.center" },
  { edge: "right", label: "draw.align.right" },
  { edge: "top", label: "draw.align.top" },
  { edge: "middle", label: "draw.align.middle" },
  { edge: "bottom", label: "draw.align.bottom" },
];

export const AXES: ReadonlyArray<{ readonly axis: Axis; readonly label: DrawKey }> = [
  { axis: "x", label: "draw.distribute.x" },
  { axis: "y", label: "draw.distribute.y" },
];

export const NO_NODES: Readonly<Record<NoNodes, DrawKey>> = {
  text: "draw.nodes.text",
  image: "draw.nodes.image",
  connector: "draw.nodes.connector",
  unreadable: "draw.nodes.unreadable",
  empty: "draw.nodes.empty",
  stroke: "draw.nodes.stroke_fixed",
  instance: "draw.nodes.instance",
  copy: "draw.nodes.copy",
  foreign: "draw.nodes.foreign",
  other: "draw.nodes.no_path",
};

/// Il tipo di un nodo a parole; un capo di un tracciato aperto non ne ha.
export const KIND_NAMES: Readonly<Record<NodeKind | "end", DrawKey>> = {
  corner: "draw.nodes.kind.corner",
  smooth: "draw.nodes.kind.smooth",
  symmetric: "draw.nodes.kind.symmetric",
  end: "draw.nodes.kind.end",
};

/// Che cosa si annuncia quando i nodi cambiano tipo.
export const MADE: Readonly<Record<NodeKind, readonly [DrawKey, DrawKey]>> = {
  corner: ["draw.nodes.made.corner.one", "draw.nodes.made.corner.other"],
  smooth: ["draw.nodes.made.smooth.one", "draw.nodes.made.smooth.other"],
  symmetric: ["draw.nodes.made.symmetric.one", "draw.nodes.made.symmetric.other"],
};

/// Che cosa si annuncia quando una forma entra nel disegno.
export const ADDED: Readonly<Record<Exclude<ShapeTool, "polygon">, DrawKey>> = {
  rect: "draw.added.rect",
  ellipse: "draw.added.ellipse",
  line: "draw.added.line",
  arrow: "draw.added.arrow",
  cover: "draw.added.cover",
};
