// L'entrata del menu aperto in un punto (il tasto destro, il tasto Menu): il
// menu cresce dal punto del clic, le sue parti arrivano dal basso una dopo
// l'altra e l'icona della testata fa il suo piccolo salto. Valori e curve sono
// quelli del prototipo della cornice (`cxin`, `cxrow`, `cxpop`); il moto passa
// da `src/moto`, e col moto ridotto il menu c'è e basta.
import { DURATION, enter } from "../moto";

/// La curva dell'entrata del menu (`cxin`), che spendono anche il sottomenu e
/// la pastiglia della scelta.
export const ENTER_EASING = "cubic-bezier(0.2, 0.85, 0.25, 1)";

/// Di quanto scivola un sottomenu che entra, da destra, o torna, da sinistra.
export const SUB_SHIFT = 12;

/// Il menu nasce dal punto del clic in 190 ms, da scala 0,94 e trasparente.
const POINT_ENTER_MS = 190;

/// Testata, appunti, voci e piede arrivano dal basso ciascuno al suo posto
/// nella fila (`cxrow`): 240 ms, 20 ms d'attesa più 15 per posto. Testata 0,
/// appunti (o campo) 1, voci da 2 fino a `last`, il piede sempre al posto 9.
const PART_ENTER = { ms: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", wait: 20, step: 15, last: 15, foot: 9 } as const;

/// Il salto dell'icona della testata (`cxpop`): da metà, girata e trasparente,
/// con un piccolo oltre.
const HEAD_ICON_POP = { ms: 340, easing: "cubic-bezier(0.3, 1.5, 0.5, 1)", wait: 40 } as const;

/// Il posto nella fila di una parte che non è una voce (testata, appunti,
/// campo, piede); `null` per una voce, che prende il posto dopo la precedente.
function fixedSlot(part: Element): number | null {
  const c = part.classList;
  if (c.contains("menu-head")) return 0;
  if (c.contains("menu-foot")) return PART_ENTER.foot;
  if (c.contains("menu-clipboard") || c.contains("menu-field")) return 1;
  return null;
}

/// L'entrata del menu aperto in un punto: cresce dal punto del clic (l'origine
/// la mette `growFrom`) mentre testata, appunti, voci e piede arrivano ognuno
/// al suo posto nella fila. Il sottomenu che col dito prende il posto del menu
/// entra invece da destra, e il menu di prima torna da sinistra. Col moto
/// ridotto c'è e basta.
///
/// Le corse delle parti non sono legate alla vita del menu: chiuderlo a metà
/// entrata le fermerebbe prima che l'uscita ne fotografi la posa, e le parti
/// salterebbero al riposo nell'immagine che sfuma. Finiscono da sole.
export function enterAtPoint(menu: HTMLElement, parts: readonly HTMLElement[], entry: "forward" | "back" | null): void {
  if (entry !== null) {
    enter(menu, { from: { x: entry === "forward" ? SUB_SHIFT : -SUB_SHIFT, opacity: 0 }, duration: DURATION.swap, easing: ENTER_EASING, whenReduced: "none" });
    return;
  }
  enter(menu, { from: { scale: 0.94, opacity: 0 }, duration: POINT_ENTER_MS, easing: ENTER_EASING, whenReduced: "none" });
  let items = 0;
  for (const part of parts) {
    // Le voci contano da 2; oltre il posto `last` arrivano insieme all'ultima.
    const slot = fixedSlot(part) ?? Math.min(2 + items++, PART_ENTER.last);
    const delay = PART_ENTER.wait + slot * PART_ENTER.step;
    enter(part, { from: { y: 5, opacity: 0 }, duration: PART_ENTER.ms, easing: PART_ENTER.easing, delay, whenReduced: "none" });
  }
  const icon = menu.querySelector(":scope > .menu-head > svg");
  if (icon !== null) {
    enter(icon, { from: { scale: 0.5, rotate: -12, opacity: 0 }, duration: HEAD_ICON_POP.ms, easing: HEAD_ICON_POP.easing, delay: HEAD_ICON_POP.wait, whenReduced: "none" });
  }
}
