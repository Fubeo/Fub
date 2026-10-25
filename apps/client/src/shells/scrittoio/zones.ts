// F6 e Maiusc+F6: il fuoco da una zona della finestra alla seguente, come in
// Office. Le zone sono il pannello dei file, il foglio col fuoco, l'ispettore
// e la banda di stato; una zona chiusa non si conta. Il foglio può averne di
// sue (la barra e la pagina di un documento): le gira lui, poi si va avanti.
import { focusEditor, stepSurfaceZone } from "../../state/document-controller";
import { layout } from "../../state/layout";
import { focusZone } from "../../ui/a11y";

interface Zone {
  readonly element: HTMLElement;
  /** Il foglio col fuoco, che può avere zone sue. */
  readonly pane: boolean;
}

/** Le zone aperte adesso, nell'ordine di F6. */
export function zones(): Zone[] {
  const ring: Zone[] = [];
  const add = (element: HTMLElement | null, pane = false): void => {
    if (element && !element.closest("[hidden]")) ring.push({ element, pane });
  };
  add(document.getElementById("sidebar"));
  add(document.querySelector<HTMLElement>(`.pane[data-pane="${CSS.escape(layout.focus)}"]`), true);
  add(document.getElementById("right-pane"));
  add(document.getElementById("status-band"));
  return ring;
}

/** Porta il fuoco alla zona seguente (`1`) o a quella prima (`-1`). */
export function stepZone(step: 1 | -1): void {
  const ring = zones();
  if (ring.length === 0) return;
  const at = ring.findIndex((zone) => zone.element.contains(document.activeElement));
  if (at >= 0 && ring[at]!.pane && stepSurfaceZone(step) === true) return;
  const from = at < 0 ? (step > 0 ? -1 : 0) : at;
  enter(ring[(from + step + ring.length) % ring.length]!, step);
}

function enter(zone: Zone, step: 1 | -1): void {
  if (!zone.pane) {
    focusZone(zone.element);
    return;
  }
  // Da fuori, la superficie entra dalla sua prima zona (o dall'ultima, tornando
  // indietro); senza zone sue prende il fuoco come sempre.
  if (stepSurfaceZone(step) === true) return;
  focusEditor();
  if (!zone.element.contains(document.activeElement)) focusZone(zone.element);
}
