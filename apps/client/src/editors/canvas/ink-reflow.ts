// L'avviso dei tratti sul testo che rifluisce. Su una scheda di testo, o su
// una nota Markdown, l'inchiostro attaccato alla scheda (ancora `card`)
// resta fermo dove è stato scritto (`ink-fit.ts`, modo `fixed`), mentre il
// testo va a capo con la larghezza della scheda: allargata o ristretta, le
// sottolineature e i disegni sul testo possono non stare più sulle parole.
// Il file non cambia: l'ancora dice già la larghezza di allora (`width`), e
// l'avviso resta finché la scheda è larga diversamente. Il suo pulsante
// rimette quella larghezza, con un passo d'annulla (lo fa la tela).
//
// L'altezza non conta: allungare la scheda non rimanda a capo il testo.

import { t } from "../../i18n/strings";
import type { DryStroke } from "./ink-paint";
import type { CanvasNode } from "./model";

/** Lo scarto di larghezza, in unità della lavagna, sotto il quale la scheda è com'era. */
const SAME_WIDTH = 0.5;

/** La scheda va a capo con la sua larghezza: una scheda di testo o una nota Markdown. */
export function reflowsText(node: Pick<CanvasNode, "type" | "file">): boolean {
  if (node.type === "text") return true;
  return node.type === "file" && typeof node.file === "string" && /\.md$/i.test(node.file);
}

/**
 * La larghezza in cui sono stati scritti i tratti della scheda `node` che non
 * stanno più sul testo, o `null` se non ce ne sono. Contano i tratti con
 * l'ancora `card` (non le pagine né le celle); se hanno larghezze diverse,
 * quella dell'ultimo, il più recente. `null` anche quando la scheda è larga
 * come allora, o non va a capo.
 */
export function inkReflowWidth(node: Pick<CanvasNode, "type" | "file" | "width">, drys: readonly DryStroke[]): number | null {
  if (!reflowsText(node)) return null;
  for (let at = drys.length - 1; at >= 0; at--) {
    const dry = drys[at]!;
    if (dry.ref === null || dry.page !== undefined || dry.cell !== undefined) continue;
    const width = dry.ref.width;
    if (!Number.isFinite(width) || width <= 0) return null;
    return Math.abs(width - node.width) > SAME_WIDTH ? width : null;
  }
  return null;
}

/**
 * Mette, aggiorna o toglie l'avviso nella scheda `article`. `width` è la
 * larghezza dei tratti (`inkReflowWidth`), `null` per nessun avviso; il
 * pulsante che la rimette c'è solo se `writable`. Il pulsante porta
 * `data-ink-reflow` con la larghezza: il suo clic lo prende la tela.
 */
export function syncInkReflow(article: HTMLElement, width: number | null, writable: boolean): void {
  let note = article.querySelector<HTMLElement>(":scope > .canvas-ink-reflow");
  if (width === null) {
    note?.remove();
    if (article.hasAttribute("data-ink-reflowed")) article.removeAttribute("data-ink-reflowed");
    return;
  }
  // La scheda sta sopra le vicine: l'avviso, sotto di lei, non si copre.
  if (!article.hasAttribute("data-ink-reflowed")) article.setAttribute("data-ink-reflowed", "");
  if (!note) {
    note = document.createElement("div");
    note.className = "canvas-ink-reflow";
    note.setAttribute("role", "status");
    const text = document.createElement("p");
    text.className = "canvas-ink-reflow-text";
    note.append(text);
    article.append(note);
  }
  const text = note.querySelector<HTMLElement>(".canvas-ink-reflow-text")!;
  const message = t("canvas.ink.reflow");
  if (text.textContent !== message) text.textContent = message;
  let back = note.querySelector<HTMLButtonElement>(".canvas-ink-reflow-back");
  if (!writable) {
    back?.remove();
    return;
  }
  if (!back) {
    back = document.createElement("button");
    back.type = "button";
    back.className = "canvas-ink-reflow-back";
    note.append(back);
  }
  const px = String(Math.round(width));
  if (back.dataset.inkReflow !== px) back.dataset.inkReflow = px;
  const label = t("canvas.ink.reflow_back", { px });
  if (back.textContent !== label) back.textContent = label;
  const name = t("canvas.ink.reflow_back_label", { px });
  if (back.getAttribute("aria-label") !== name) back.setAttribute("aria-label", name);
}
