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
  { id: "pen", gruppo: "draw", strumenti: ["motore:pen", "motore:smart_pen", "motore:curvature", "motore:addAnchor", "motore:deleteAnchor", "motore:anchorPoint", "motore:corner_tool", "motore:slide_anchor", "motore:extend_path"] },
  { id: "pencil", gruppo: "draw", strumenti: ["pen", "highlighter", "motore:pencil", "motore:paintbrush", "motore:blobBrush", "motore:smooth", "motore:join", "motore:shared_edge"] },
  { id: "eraser", gruppo: "draw", strumenti: ["eraser", "motore:eraser", "motore:pathEraser", "motore:anchor_eraser", "motore:scissors", "motore:knife", "motore:mirrorCut", "motore:lineCut", "motore:rectCut"] },
  { id: "rectangle", gruppo: "shape", strumenti: ["rect", "ellipse", "line", "arrow", "motore:rectangle", "motore:roundedRectangle", "motore:ellipse", "motore:polygon", "motore:star", "motore:flare", "motore:lineSegment", "motore:arc", "motore:spiral", "motore:rectangularGrid", "motore:polarGrid", "motore:parametric_shape", "motore:shaper"] },
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
