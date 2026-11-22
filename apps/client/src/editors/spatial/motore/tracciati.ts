// Gli strumenti dei tracciati visti dall'editor (piano K6, T12; `docs/product/
// drawing-pen.md`). Qui stanno le regole che l'editor ne ricava, senza DOM e
// senza motore:
//
// - **Quali sono.** I ventuno strumenti di «disegnare» della famiglia
//   `tracciati` (`STRUMENTI_DEI_TRACCIATI`): la colonna li sblocca, e con uno
//   di loro un Esc senza niente da chiudere torna alla Selezione.
// - **A più clic.** La penna, la penna intelligente e la curvatura fanno un
//   tracciato clic dopo clic (`A_PIU_CLIC`): al rilascio il gesto manda
//   un'anteprima, e finché il motore dice `busy` il tracciato resta aperto per
//   il clic dopo. Lo chiudono Invio, Esc, o lo strumento cambiato: un passo
//   solo nella cronologia.
// - **I segni.** Fra un clic e l'altro il motore manda i segni del tracciato
//   aperto (`DrawingPreview.overlays`); `segniComeForma` li fa diventare una
//   forma dello strato dell'anteprima, colorata coi token del tema.

import type { DrawingOverlay, DrawingOverlayRole, DrawingPoint } from "../../../host/contract";
import type { Elem } from "../scene/serialize";

/// I ventuno strumenti di «disegnare» della famiglia `tracciati`, con l'id
/// del motore.
export const STRUMENTI_DEI_TRACCIATI: ReadonlySet<string> = new Set([
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
]);

/// Gli strumenti che fanno un tracciato clic dopo clic: il tracciato resta
/// aperto fra un gesto e l'altro finché il motore dice `busy`.
export const A_PIU_CLIC: ReadonlySet<string> = new Set(["pen", "smartPen", "curvature"]);

/// Il colore di un ruolo, dai token del tema: i segni della selezione e
/// dell'anteprima hanno l'accento, come le maniglie di Fub.
function colore(role: DrawingOverlayRole): string {
  switch (role) {
    case "selection":
    case "preview":
    case "guide":
    case "measure":
    case "perspective":
      return "var(--accent)";
  }
}

const punto = (p: DrawingPoint): string => `${p[0]} ${p[1]}`;

/// I segni geometrici del motore (contorni, linee, punti, maniglie) come un
/// gruppo dello strato dell'anteprima, in coordinate di scena: gli spessori
/// e le misure sono pixel dello schermo, quindi si dividono per lo zoom
/// `scala`. Le etichette e le misure scritte non si disegnano qui. `null` se
/// non c'è niente da disegnare.
export function segniComeForma(segni: readonly DrawingOverlay[], scala: number): Elem | null {
  const k = scala > 0 && Number.isFinite(scala) ? 1 / scala : 1;
  const tratto = (role: DrawingOverlayRole, width: number, dashed: boolean): Record<string, string> => ({
    fill: "none",
    style: `stroke: ${colore(role)}`,
    "stroke-width": String(width),
    "vector-effect": "non-scaling-stroke",
    ...(dashed ? { "stroke-dasharray": `${4 * k} ${3 * k}` } : {}),
  });
  const punti: Elem[] = [];
  const linee: Elem[] = [];
  for (const segno of segni) {
    switch (segno.kind) {
      case "path":
        linee.push({ tag: "path", attrs: { d: segno.d, ...tratto(segno.role, segno.width, segno.dashed) } });
        break;
      case "line":
        linee.push({ tag: "path", attrs: { d: `M${punto(segno.a)} L${punto(segno.b)}`, ...tratto(segno.role, 1, segno.dashed) } });
        break;
      case "anchor": {
        const lato = segno.size * k;
        punti.push({
          tag: "rect",
          attrs: {
            x: String(segno.at[0] - lato / 2),
            y: String(segno.at[1] - lato / 2),
            width: String(lato),
            height: String(lato),
            style: `stroke: ${colore(segno.role)}; fill: ${segno.filled ? colore(segno.role) : "var(--bg)"}`,
            "stroke-width": "1",
            "vector-effect": "non-scaling-stroke",
          },
        });
        break;
      }
      case "curve_point":
        punti.push({
          tag: "circle",
          attrs: {
            cx: String(segno.at[0]),
            cy: String(segno.at[1]),
            r: String((segno.size * k) / 2),
            style: `stroke: ${colore(segno.role)}; fill: ${segno.filled ? colore(segno.role) : "var(--bg)"}`,
            "stroke-width": "1",
            "vector-effect": "non-scaling-stroke",
          },
        });
        break;
      case "handle":
        punti.push({
          tag: "circle",
          attrs: { cx: String(segno.at[0]), cy: String(segno.at[1]), r: String(3 * k), style: `fill: ${colore(segno.role)}` },
        });
        break;
      default:
        break;
    }
  }
  if (linee.length === 0 && punti.length === 0) return null;
  // I punti sopra le linee, come li disegna il motore.
  return { tag: "g", attrs: { class: "draw-engine-marks" }, children: [...linee, ...punti] };
}
