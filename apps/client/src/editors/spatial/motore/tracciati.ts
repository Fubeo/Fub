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

import type { DrawingOverlay, DrawingPoint } from "../../../host/contract";
import type { Elem } from "../scene/serialize";
import { t, type DrawKey } from "../strings";

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
  "blobBrush",
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

/// Gli strumenti la cui ultima misura resta sul foglio fino alla misura dopo (la tiene il client):
/// la Misura e Misura e ispeziona, come in VectorCraft.
const TENGONO_LA_MISURA: ReadonlySet<string> = new Set(["measure", "measureInspect"]);

export function tieneLaMisura(id: string | null): boolean {
  return id !== null && TENGONO_LA_MISURA.has(id);
}

// Il colore dei segni sta nella pelle (`skin/draw.css`), non sull'elemento:
// ogni ruolo (selezione, anteprima, guida, misura, prospettiva) ha l'accento,
// come le maniglie di Fub. Qui solo le classi.

const punto = (p: DrawingPoint): string => `${p[0]} ${p[1]}`;

/// I segni geometrici del motore (contorni, linee, punti, maniglie) come un
/// gruppo dello strato dell'anteprima, in coordinate di scena: gli spessori
/// e le misure sono pixel dello schermo, quindi si dividono per lo zoom
/// `scala`. Anche le scritte del motore: le etichette delle guide, le misure
/// accanto al puntatore, le distanze fra due punti (con la loro linea), le
/// righe evidenziate del testo e i campioni di colore. Il riquadro no: lo
/// disegna il gesto (`gesti.ts`). `null` se non c'è niente da disegnare.
/// Le parole delle guide intelligenti del motore (`guides.rs`), e la frase del
/// Pupazzo fuori dal disegno, nella lingua dell'interfaccia.
const PAROLE: Readonly<Record<string, DrawKey>> = {
  anchor: "draw.engine.label.anchor",
  center: "draw.engine.label.center",
  path: "draw.engine.label.path",
  artboard: "draw.engine.label.artboard",
  bleed: "draw.engine.label.bleed",
  guide: "draw.engine.label.guide",
  glyph: "draw.engine.label.glyph",
  intersect: "draw.engine.label.intersect",
  align: "draw.engine.label.align",
  perpendicular: "draw.engine.label.perpendicular",
  tangent: "draw.engine.label.tangent",
  "Pins go on the artwork": "draw.engine.label.offMesh",
};

/// I nomi delle misure del motore (`context.rs`: «W: …», «Angle: …»), prima dei due punti.
const MISURE: Readonly<Record<string, DrawKey>> = {
  W: "draw.engine.measure.W",
  H: "draw.engine.measure.H",
  L: "draw.engine.measure.L",
  D: "draw.engine.measure.D",
  Angle: "draw.engine.measure.Angle",
  Radius: "draw.engine.measure.Radius",
  R1: "draw.engine.measure.R1",
  R2: "draw.engine.measure.R2",
  dX: "draw.engine.measure.dX",
  dY: "draw.engine.measure.dY",
};

const proprio = (tabella: object, chiave: string): boolean => Object.prototype.hasOwnProperty.call(tabella, chiave);

/// Una scritta del motore tradotta riga per riga: una parola conosciuta diventa la
/// sua, il nome di una misura prima dei due punti il suo; il resto (numeri, nomi
/// delle tavole) resta com'è.
export function scrittaDelMotore(testo: string): string {
  return testo
    .split("\n")
    .map((riga) => {
      if (proprio(PAROLE, riga)) return t(PAROLE[riga]!);
      const due = riga.indexOf(": ");
      const nome = due > 0 ? riga.slice(0, due) : "";
      return nome !== "" && proprio(MISURE, nome) ? `${t(MISURE[nome]!)}${riga.slice(due)}` : riga;
    })
    .join("\n");
}

export function segniComeForma(segni: readonly DrawingOverlay[], scala: number): Elem | null {
  const k = scala > 0 && Number.isFinite(scala) ? 1 / scala : 1;
  const tratto = (width: number, dashed: boolean): Record<string, string> => ({
    class: "draw-engine-line",
    "stroke-width": String(width),
    "vector-effect": "non-scaling-stroke",
    ...(dashed ? { "stroke-dasharray": `${4 * k} ${3 * k}` } : {}),
  });
  const punti: Elem[] = [];
  const linee: Elem[] = [];
  const fondi: Elem[] = [];
  const scritte: Elem[] = [];
  // Una scritta in pixel dello schermo, col primo carattere su `at`. Il motore
  // va a capo con `\n` («W: …» sopra «H: …»): ogni riga è un `tspan` sotto
  // l'altra, perché un `text` SVG non va a capo da solo.
  const scritta = (at: DrawingPoint, testo: string, classe: string): Elem => ({
    tag: "text",
    attrs: { x: String(at[0]), y: String(at[1]), "font-size": String(11 * k), class: classe },
    children: scrittaDelMotore(testo).split("\n").map((riga, i) => ({
      tag: "tspan",
      attrs: { x: String(at[0]), dy: i === 0 ? "0" : String(13 * k) },
      text: riga,
    })),
  });
  for (const segno of segni) {
    switch (segno.kind) {
      case "path":
        linee.push({ tag: "path", attrs: { d: segno.d, ...tratto(segno.width, segno.dashed) } });
        break;
      case "line":
        linee.push({ tag: "path", attrs: { d: `M${punto(segno.a)} L${punto(segno.b)}`, ...tratto(1, segno.dashed) } });
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
            class: segno.filled ? "draw-engine-point draw-engine-point-pieno" : "draw-engine-point",
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
            class: segno.filled ? "draw-engine-point draw-engine-point-pieno" : "draw-engine-point",
            "stroke-width": "1",
            "vector-effect": "non-scaling-stroke",
          },
        });
        break;
      case "handle":
        punti.push({
          tag: "circle",
          attrs: { cx: String(segno.at[0]), cy: String(segno.at[1]), r: String(3 * k), class: "draw-engine-handle" },
        });
        break;
      case "label":
        scritte.push(scritta(segno.at, segno.text, "draw-engine-text draw-engine-label"));
        break;
      case "measure":
        scritte.push(scritta(segno.at, segno.text, "draw-engine-text"));
        break;
      case "distance":
        linee.push({ tag: "path", attrs: { d: `M${punto(segno.a)} L${punto(segno.b)}`, ...tratto(1, false) } });
        scritte.push(scritta([(segno.a[0] + segno.b[0]) / 2, (segno.a[1] + segno.b[1]) / 2], segno.text, "draw-engine-text draw-engine-label"));
        break;
      case "highlight":
        fondi.push({ tag: "path", attrs: { d: `M${segno.quad.map(punto).join(" L")} Z`, class: "draw-engine-highlight" } });
        break;
      case "swatch": {
        const lato = (segno.selected ? 12 : 10) * k;
        punti.push({
          tag: "rect",
          attrs: {
            x: String(segno.at[0] - lato / 2),
            y: String(segno.at[1] - lato / 2),
            width: String(lato),
            height: String(lato),
            // Il colore è il dato del campione, non del tema.
            fill: segno.color,
            class: segno.selected ? "draw-engine-swatch draw-engine-swatch-scelto" : "draw-engine-swatch",
            "stroke-width": segno.selected ? "2" : "1",
            "vector-effect": "non-scaling-stroke",
          },
        });
        break;
      }
      default:
        break;
    }
  }
  if (fondi.length === 0 && linee.length === 0 && punti.length === 0 && scritte.length === 0) return null;
  // Le evidenziazioni sotto, poi le linee, i punti e sopra tutto le scritte.
  return { tag: "g", attrs: { class: "draw-engine-marks" }, children: [...fondi, ...linee, ...punti, ...scritte] };
}
