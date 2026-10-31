// L'editor del disegno: le costanti, che più pezzi di createDrawEditor
// condividono.

import type { ScaleLimits } from "../../../../spatial/camera";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { Role } from "../../scene/analysis";
import type { LengthUnit } from "../../scene/rulers";
import type { DrawKey } from "../../strings";
import type { Axis, Edge, Order } from "../arrange";
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
export const BAR_FEATURES: readonly Feature[] = ["text", "arrange", "links", "layers", "recognize", "crop", "connector"];

/// «Immagine dal vault…», dal livello Standard: il tasto con cui Inkscape
/// importa.
export const IMAGE_BINDING = "Mod-i";

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

/// La scelta dello strumento Tavola quando è la pagina: non è l'id di una
/// tavola, perché un id XML non comincia con «#».
export const PAGE_SHEET = "#page";

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

/// Che cosa si annuncia quando una forma entra nel disegno.
export const ADDED: Readonly<Record<Exclude<ShapeTool, "polygon">, DrawKey>> = {
  rect: "draw.added.rect",
  ellipse: "draw.added.ellipse",
  line: "draw.added.line",
  arrow: "draw.added.arrow",
  cover: "draw.added.cover",
};
