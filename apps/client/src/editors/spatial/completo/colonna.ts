// La colonna del Disegno completo (piano K6, T8; `docs/product/drawing.md`,
// «La colonna»). Sei gruppi e le caselle del prototipo
// (`PLAN-ui/disegno-completo.html`, il template `pezzo-colonna`): ogni casella
// ha gli strumenti che può mostrare, nell'ordine in cui si sceglie la tendina.
//
// Uno strumento è o uno strumento di Fub (un nome di `ToolId`, come `pen`) o
// uno strumento del motore (`motore:<id>`, la riga della mappa con posto
// `colonna/<gruppo>`). Uno strumento del motore entra nella colonna solo
// quando la sua riga è «fatto» (`pronti`): fino ad allora la casella non lo
// mostra, e una casella senza strumenti non c'è.
//
// Questo file è una regola pura: niente DOM, niente `import` del client che
// non sia un tipo. Lo porta `completo/index.ts` col suo `import()`, e il
// chrome lo chiede con `layoutCompleto`.

import type { ToolSpec } from "../tools/registry";

/// I sei gruppi della colonna, nell'ordine del prototipo. L'id è il valore di
/// `data-group` della colonna.
export type GruppoColonna = "pick" | "draw" | "shape" | "modify" | "color" | "view";

export const GRUPPI_COLONNA: readonly GruppoColonna[] = ["pick", "draw", "shape", "modify", "color", "view"];

/// Una casella del prototipo: il suo nome e i suoi strumenti, il primo
/// mostrato finché non se ne sceglie un altro.
export interface Casella {
  readonly id: string;
  readonly gruppo: GruppoColonna;
  readonly strumenti: readonly string[];
}

/// Le 14 caselle del prototipo (senza «Tutti gli strumenti», che è il cassetto).
/// Gli strumenti del motore vengono dal `data-tools` del prototipo, che è il
/// posto `colonna/<gruppo>` della mappa; i nomi di Fub (`pen`, `rect`…) sono
/// gli strumenti che Fub ha già, e stanno nella casella del loro gruppo.
export const CASELLE: readonly Casella[] = [
  { id: "selection", gruppo: "pick", strumenti: ["select", "motore:selection"] },
  { id: "directSelection", gruppo: "pick", strumenti: ["motore:directSelection", "motore:groupSelection"] },
  { id: "lasso", gruppo: "pick", strumenti: ["motore:lasso", "motore:magicWand"] },
  { id: "pen", gruppo: "draw", strumenti: ["motore:pen", "motore:smartPen", "motore:curvature", "motore:addAnchor", "motore:deleteAnchor", "motore:anchorPoint", "motore:cornerTool", "motore:slideAnchor", "motore:extendPath"] },
  { id: "pencil", gruppo: "draw", strumenti: ["motore:pencil", "pen", "highlighter", "motore:paintbrush", "motore:blobBrush", "motore:smooth", "motore:join", "motore:sharedEdge"] },
  { id: "eraser", gruppo: "draw", strumenti: ["motore:eraser", "eraser", "motore:pathEraser", "motore:anchorEraserBrush", "motore:scissors", "motore:knife", "motore:mirrorCut", "motore:lineCut", "motore:rectCut"] },
  { id: "rectangle", gruppo: "shape", strumenti: ["rect", "ellipse", "line", "arrow", "motore:rectangle", "motore:roundedRectangle", "motore:ellipse", "motore:polygon", "motore:star", "motore:flare", "motore:lineSegment", "motore:arc", "motore:spiral", "motore:rectangularGrid", "motore:polarGrid", "motore:parametricShape", "motore:shaper"] },
  { id: "type", gruppo: "shape", strumenti: ["text", "motore:type", "motore:areaType", "motore:typeOnPath", "motore:verticalType", "motore:verticalAreaType", "motore:verticalTypeOnPath", "motore:touchType"] },
  { id: "rotate", gruppo: "modify", strumenti: ["motore:rotate", "motore:reflect", "motore:scale", "motore:shear", "motore:reshape", "motore:freeTransform", "motore:puppetWarp"] },
  { id: "width", gruppo: "modify", strumenti: ["motore:width", "motore:warp", "motore:twirl", "motore:pucker", "motore:bloat", "motore:scallop", "motore:crystallize", "motore:wrinkle"] },
  { id: "shapeBuilder", gruppo: "modify", strumenti: ["motore:shapeBuilder", "motore:livePaintBucket", "motore:livePaintSelection", "motore:blend"] },
  { id: "gradient", gruppo: "color", strumenti: ["motore:gradient", "motore:mesh"] },
  { id: "eyedropper", gruppo: "color", strumenti: ["motore:eyedropper", "motore:measure"] },
  { id: "hand", gruppo: "view", strumenti: ["hand", "zoom", "motore:hand", "motore:zoom", "motore:rotateView", "motore:printTiling"] },
];

/// Il gruppo dove va uno strumento di Fub che il prototipo non nomina (la
/// Selezione, la Penna, le forme, il testo): secondo la famiglia del registro.
const GRUPPO_DI_FAMIGLIA: Readonly<Record<ToolSpec["group"], GruppoColonna>> = {
  pick: "pick",
  ink: "draw",
  shape: "shape",
  text: "shape",
};

/// Gli strumenti del motore che hanno la riga «fatto» nella mappa (le voci
/// `strumento` dell'indice generato; un test lo controlla). Un id qui sblocca
/// `motore:<id>` nella colonna: il chrome lo mostra con il nome della sua
/// famiglia e l'icona di `ICONE_MOTORE`. T11: gli strumenti del nucleo; T12:
/// i ventuno di «disegnare» dei tracciati; T13 giro 1: gli strumenti di forma
/// (la famiglia `forme`); T13 giro 5: i quattro di trasformazione (la famiglia
/// `trasforma`); T16 giro 1: il Testo di punto (`type`).
export const MOTORE_PRONTO: ReadonlySet<string> = new Set([
  "selection",
  "directSelection",
  "groupSelection",
  "lasso",
  "hand",
  "zoom",
  "rotateView",
  "pen",
  "smartPen",
  "curvature",
  "addAnchor",
  "deleteAnchor",
  "anchorPoint",
  "cornerTool",
  "slideAnchor",
  "extendPath",
  "pencil",
  "smooth",
  "join",
  "sharedEdge",
  "eraser",
  "pathEraser",
  "anchorEraserBrush",
  "scissors",
  "knife",
  "mirrorCut",
  "lineCut",
  "rectCut",
  "lineSegment",
  "arc",
  "spiral",
  "rectangle",
  "roundedRectangle",
  "ellipse",
  "polygon",
  "star",
  // T13 giro 5: Ruota, Rifletti, Scala e Inclina (la casella «modificare»).
  "rotate",
  "reflect",
  "scale",
  "shear",
  // T16 giro 1: il Testo di punto.
  "type",
]);

/// L'icona di uno strumento del motore nella colonna e nel cassetto: quella
/// del prototipo (`PLAN-ui/disegno-completo.html`), dal catalogo
/// `editors/spatial/icons.ts`. Le forme usano la serie che c'è (`draw-rect`,
/// `draw-ellipse`…): il prototipo non le disegna tutte. Le icone della matita e
/// della gomma che il prototipo non disegna nella tendina sono scelte fra quelle
/// del catalogo.
export const ICONE_MOTORE: Readonly<Record<string, string>> = {
  selection: "draw-select",
  directSelection: "draw-direct-select",
  groupSelection: "draw-direct-select",
  lasso: "draw-lasso",
  hand: "draw-hand",
  zoom: "draw-zoom",
  rotateView: "draw-rotate",
  // Le trasformazioni (T13 giro 5): Inclina ha il parallelogramma del catalogo.
  rotate: "draw-rotate",
  reflect: "draw-flip-h",
  scale: "draw-scale",
  shear: "draw-shear",
  lineSegment: "draw-line",
  arc: "draw-arc",
  spiral: "draw-spiral",
  rectangle: "draw-rect",
  roundedRectangle: "draw-rounded-rect",
  ellipse: "draw-ellipse",
  polygon: "draw-polygon",
  star: "draw-star",
  // La tendina della Penna, dal prototipo (`tendina-penna`).
  pen: "draw-pen-nib",
  smartPen: "draw-pen-nib",
  curvature: "draw-point-smooth",
  addAnchor: "draw-pen-nib",
  deleteAnchor: "draw-point-delete",
  anchorPoint: "draw-point-corner",
  cornerTool: "draw-point-corner",
  slideAnchor: "draw-point-smooth",
  extendPath: "draw-point-join",
  // La Matita e la Gomma: la prima dal prototipo, le altre dal catalogo.
  pencil: "draw-pencil",
  smooth: "draw-pencil",
  join: "draw-point-join",
  sharedEdge: "draw-point-join",
  eraser: "draw-eraser",
  pathEraser: "draw-eraser",
  anchorEraserBrush: "draw-point-delete",
  scissors: "draw-scissors",
  knife: "draw-scissors",
  mirrorCut: "draw-scissors",
  lineCut: "draw-scissors",
  rectCut: "draw-scissors",
  // Il Testo del motore: l'icona del Testo di Fub, con cui sta nella casella.
  type: "draw-text",
};

/// La finestra che un clic senza trascinare apre per uno strumento del motore (T13,
/// giro 2 e 5): il comando del motore della sua finestra. Le forme (giro 2) portano i
/// due campi del punto del clic (`x`, `y` o `cx`, `cy`…), che il comando prende dal
/// disegno e la finestra non chiede; il Rettangolo arrotondato non ce l'ha, perché
/// `shape.rectangle` non porta il raggio d'angolo. Le trasformazioni (giro 5) non
/// hanno un campo del punto (`object.rotate` gira attorno al centro della selezione),
/// e lavorano sulla selezione di adesso: senza selezione la finestra non si apre.
export interface ComandoDelClic {
  readonly comando: string;
  readonly x?: string;
  readonly y?: string;
  readonly sullaSelezione?: true;
}

export const COMANDO_DEL_CLIC: Readonly<Record<string, ComandoDelClic>> = {
  rectangle: { comando: "shape.rectangle", x: "x", y: "y" },
  ellipse: { comando: "shape.ellipse", x: "x", y: "y" },
  polygon: { comando: "shape.polygon", x: "cx", y: "cy" },
  star: { comando: "shape.star", x: "cx", y: "cy" },
  lineSegment: { comando: "shape.line", x: "x1", y: "y1" },
  arc: { comando: "shape.arc", x: "x1", y: "y1" },
  spiral: { comando: "shape.spiral", x: "cx", y: "cy" },
  rotate: { comando: "object.rotate", sullaSelezione: true },
  reflect: { comando: "object.reflect", sullaSelezione: true },
  scale: { comando: "object.scale", sullaSelezione: true },
  shear: { comando: "object.shear", sullaSelezione: true },
};

/// L'icona di Fub per uno strumento del motore che il prototipo non disegna.
export const ICONA_MOTORE_GENERICA = "draw-all-tools";

/// L'icona dello strumento del motore `id`.
export function iconaMotore(id: string): string {
  return Object.prototype.hasOwnProperty.call(ICONE_MOTORE, id) ? ICONE_MOTORE[id]! : ICONA_MOTORE_GENERICA;
}

/// Un gruppo della colonna con le sue caselle; ogni casella è la lista dei
/// suoi strumenti, già filtrati.
export interface GruppoLayout {
  readonly id: GruppoColonna;
  readonly caselle: readonly (readonly string[])[];
}

/// La colonna del Completo per gli strumenti `offerti` (il registro, già
/// filtrato per spazio e profilo) e gli strumenti del motore `pronti`.
///
/// Uno strumento di Fub è offerto se sta in `offerti`; uno del motore se la
/// sua riga è «fatto». Una casella senza strumenti non c'è, e un gruppo senza
/// caselle non c'è. Uno strumento offerto che il prototipo non nomina va in
/// fondo al gruppo della sua famiglia, da solo, come nella colonna di Fub.
export function layoutCompleto(offerti: readonly ToolSpec[], pronti: ReadonlySet<string> = new Set()): GruppoLayout[] {
  const offerto = new Set(offerti.map((spec) => spec.id as string));
  const visibile = (strumento: string): boolean => (strumento.startsWith("motore:") ? pronti.has(strumento.slice("motore:".length)) : offerto.has(strumento));
  const scelti = new Set<string>();
  const gruppi = new Map<GruppoColonna, string[][]>(GRUPPI_COLONNA.map((id) => [id, []]));
  for (const casella of CASELLE) {
    const strumenti = casella.strumenti.filter(visibile);
    if (strumenti.length === 0) continue;
    for (const strumento of strumenti) if (!strumento.startsWith("motore:")) scelti.add(strumento);
    gruppi.get(casella.gruppo)!.push(strumenti);
  }
  for (const spec of offerti) {
    if (scelti.has(spec.id)) continue;
    gruppi.get(GRUPPO_DI_FAMIGLIA[spec.group])!.push([spec.id]);
  }
  return GRUPPI_COLONNA.map((id) => ({ id, caselle: gruppi.get(id)! })).filter((gruppo) => gruppo.caselle.length > 0);
}
