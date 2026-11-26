// I righelli di bordo del foglio (K6 T11, giro E): la riga in alto e la colonna a
// sinistra, con le tacche e i numeri nell'unità del documento. `rulers.ts` calcola
// le tacche; qui stanno sul bordo del foglio, sopra il disegno, e non lo spostano:
// il puntatore li attraversa. Sono della vista, non del file. Li accende solo
// ≡ › Visualizza del Disegno completo: il Semplice non li crea mai.
//
// Con la vista girata non c'è una scala che si legga: le tacche spariscono, e la
// riga in alto lo dice.

import { resolvedLanguage } from "../../../../i18n/strings";
import { t } from "../../strings";
import { rulerTicks, type Ticks } from "../rulers";
import type { EditorContext } from "./context";

const SVG_NS = "http://www.w3.org/2000/svg";
/// Lo spessore delle due righe, in pixel: la stessa misura del CSS (`draw-ruler-x`,
/// `draw-ruler-y`). La colonna è più larga, perché i numeri vanno di lato.
const RIGA_ALTEZZA = 20;
const COLONNA_LARGHEZZA = 28;
/// La lunghezza di una tacca, per il suo livello: quella col numero è la più lunga.
const LUNGHEZZA = [12, 8, 4] as const;

const VUOTI: Ticks = { ticks: [], places: 0 };

/// Disegna le tacche di una riga, o la sola nota se la vista è girata. `orizzontale`
/// dice se la riga va da sinistra a destra (in alto) o dall'alto in basso (a sinistra).
function disegnaTacche(svg: SVGSVGElement, ticks: Ticks, orizzontale: boolean, spessore: number, nota: string | null): void {
  svg.replaceChildren();
  if (nota !== null) {
    const testo = document.createElementNS(SVG_NS, "text");
    testo.setAttribute("class", "draw-ruler-label");
    testo.setAttribute("x", "4");
    testo.setAttribute("y", "13");
    testo.textContent = nota;
    svg.append(testo);
    return;
  }
  const formato = new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: ticks.places });
  for (const tacca of ticks.ticks) {
    const lunghezza = LUNGHEZZA[tacca.level];
    const linea = document.createElementNS(SVG_NS, "line");
    linea.setAttribute("class", "draw-ruler-tick");
    if (orizzontale) {
      linea.setAttribute("x1", String(tacca.at));
      linea.setAttribute("x2", String(tacca.at));
      linea.setAttribute("y1", String(spessore));
      linea.setAttribute("y2", String(spessore - lunghezza));
    } else {
      linea.setAttribute("y1", String(tacca.at));
      linea.setAttribute("y2", String(tacca.at));
      linea.setAttribute("x1", String(spessore));
      linea.setAttribute("x2", String(spessore - lunghezza));
    }
    svg.append(linea);
    if (tacca.level !== 0) continue;
    const testo = document.createElementNS(SVG_NS, "text");
    testo.setAttribute("class", "draw-ruler-label");
    if (orizzontale) {
      testo.setAttribute("x", String(tacca.at + 3));
      testo.setAttribute("y", "12");
    } else {
      testo.setAttribute("x", "3");
      testo.setAttribute("y", String(tacca.at + 11));
    }
    testo.textContent = formato.format(tacca.value);
    svg.append(testo);
  }
}

/// I righelli di bordo: `ctx.edgeRulers` dice se si vedono, `ctx.setEdgeRulers` li
/// accende e spegne. Le righe nascono alla prima accensione, e muoiono con il disegno.
export function installEdgeRulers(ctx: EditorContext): void {
  ctx.edgeRulers = false;
  let righe: { readonly x: SVGSVGElement; readonly y: SVGSVGElement } | null = null;
  /// Ciò che è disegnato adesso: si rifà solo se qualcosa dello sfondo è cambiato.
  let disegnato = "";

  const disegna = (): void => {
    if (righe === null || !ctx.edgeRulers || ctx.disposed) return;
    const { w, h } = ctx.surfaceSize();
    const unit = ctx.docUnit();
    const { tx, ty, scale, angle } = ctx.camera;
    const chiave = [tx, ty, scale, angle, w, h, unit, resolvedLanguage()].join("|");
    if (chiave === disegnato) return;
    disegnato = chiave;
    if (angle !== 0) {
      disegnaTacche(righe.x, VUOTI, true, RIGA_ALTEZZA, t("draw.rulers.turned"));
      disegnaTacche(righe.y, VUOTI, false, COLONNA_LARGHEZZA, null);
      return;
    }
    // Lo zero è l'origine della scena: sta dove la vista lo mette, dentro il foglio.
    disegnaTacche(righe.x, rulerTicks(tx, scale, w, unit), true, RIGA_ALTEZZA, null);
    disegnaTacche(righe.y, rulerTicks(ty, scale, h, unit), false, COLONNA_LARGHEZZA, null);
  };

  ctx.setEdgeRulers = (on) => {
    if (ctx.disposed || ctx.edgeRulers === on) return;
    if (on && righe === null) {
      const x = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
      x.setAttribute("class", "draw-ruler-x");
      x.setAttribute("aria-hidden", "true");
      const y = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
      y.setAttribute("class", "draw-ruler-y");
      y.setAttribute("aria-hidden", "true");
      ctx.surface.append(x, y);
      righe = { x, y };
      ctx.life.add(ctx.status.subscribe(disegna));
      ctx.life.add(() => {
        x.remove();
        y.remove();
        righe = null;
      });
    }
    ctx.edgeRulers = on;
    if (righe !== null) {
      righe.x.toggleAttribute("hidden", !on);
      righe.y.toggleAttribute("hidden", !on);
    }
    disegnato = "";
    disegna();
    ctx.announce(t(on ? "draw.rulers.on" : "draw.rulers.off"));
  };
}
