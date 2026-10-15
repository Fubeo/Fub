// Il fuoco da un foglio a quello che gli sta accanto, per direzione.
//
// L'albero del layout sa come i fogli sono divisi, non dove stanno: «a destra»
// è una domanda di geometria, e la risposta la dà ciò che si vede. La scelta è
// una funzione pura sulle caselle dei fogli; il DOM serve solo a misurarle.
import { focusEditor } from "../../state/document-controller";
import { focusPane, layout } from "../../state/layout";

export type Direction = "left" | "right" | "up" | "down";

/** Dove sta un foglio nella finestra. */
export interface PaneBox {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Di quanto due fogli possono toccarsi o sormontarsi restando «accanto». */
const SLACK = 1;

/**
 * Il foglio accanto a `from` in una direzione, o `null` se da quella parte non
 * ce n'è. «Accanto» vuol dire oltre il bordo da quel lato **e** affacciato: un
 * foglio in diagonale non conta. Fra più candidati vince il più vicino, poi
 * quello che si affaccia di più, poi il primo dall'alto o da sinistra.
 */
export function neighbour(boxes: readonly PaneBox[], from: string, direction: Direction): string | null {
  const here = boxes.find((box) => box.id === from);
  if (!here) return null;
  const sideways = direction === "left" || direction === "right";
  let best: { id: string; gap: number; facing: number; start: number } | null = null;
  for (const box of boxes) {
    if (box.id === from) continue;
    const gap =
      direction === "left"
        ? here.left - box.right
        : direction === "right"
          ? box.left - here.right
          : direction === "up"
            ? here.top - box.bottom
            : box.top - here.bottom;
    if (gap < -SLACK) continue;
    const facing = sideways
      ? Math.min(here.bottom, box.bottom) - Math.max(here.top, box.top)
      : Math.min(here.right, box.right) - Math.max(here.left, box.left);
    if (facing <= SLACK) continue;
    const start = sideways ? box.top : box.left;
    const closer = best === null || gap < best.gap - SLACK;
    const level = best !== null && Math.abs(gap - best.gap) <= SLACK;
    if (closer || (level && (facing > best!.facing || (facing === best!.facing && start < best!.start)))) {
      best = { id: box.id, gap, facing, start };
    }
  }
  return best?.id ?? null;
}

function paneElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".pane[data-pane]")];
}

/** Le caselle dei fogli che si vedono adesso. */
export function paneBoxes(): PaneBox[] {
  const boxes: PaneBox[] = [];
  for (const el of paneElements()) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    boxes.push({ id: el.dataset.pane ?? "", left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }
  return boxes;
}

/**
 * Porta il fuoco al foglio accanto. Dice se c'era: da quella parte può non
 * esserci niente, e allora non succede niente.
 */
export function focusNeighbour(direction: Direction): boolean {
  const next = neighbour(paneBoxes(), layout.focus, direction);
  if (!next) return false;
  focusPane(next);
  focusEditor();
  // Un foglio senza superficie che prenda il fuoco (vuoto, o una vista) lo
  // lascerebbe nel foglio di prima: i tasti andrebbero a un foglio e il fuoco
  // dichiarato a un altro. Lo si posa sulla sua linguetta, o su ciò che ha.
  const el = paneElements().find((pane) => pane.dataset.pane === next);
  if (el && !el.contains(document.activeElement)) {
    const landing =
      el.querySelector<HTMLElement>('.tab[aria-selected="true"]') ?? el.querySelector<HTMLElement>("button, [tabindex]");
    landing?.focus();
  }
  return true;
}
