// La bolla di selezione: la mini-barra (`mini-bar.ts`) accanto al testo
// scelto. Con `editor.minibar` = `auto` c'è sempre tranne con la barra del
// foglio `completa` (`editor.toolbar`), che ha già tutti i pulsanti: due copie
// sullo stesso foglio sarebbero rumore; `always` la vuole comunque, `menu` e
// `off` mai (`bubbleWanted`). La tastiera resta quella della barra:
// un solo punto di tabulazione, le frecce, Escape che riporta al testo.
//
// Dove sta il testo lo dice la superficie (`selectionBox`), mai l'editor: qui
// passano soltanto quattro numeri. La bolla si posa al più una volta per
// fotogramma, e la sua misura la tiene un `ResizeObserver`: seguire la
// selezione non chiede al motore un'impaginazione per evento. Mentre un suo
// menu è aperto (Trasforma, Colore) resta ferma dov'è; il menu del tasto
// destro, che le finirebbe sopra, la prende in testa (E29): lì la bolla si
// toglie, perché il fuoco è nel menu.
import type { CommandSpec } from "../host/contract";
import { FORMATBAR_EVENT } from "./format-bar";
import { createMiniBar, type MiniBar, type MiniBarHost } from "./mini-bar";
import { openLifetime } from "../ui/lifetime";

/// Lo spazio fra la bolla e il testo.
const GAP = 8;

/// L'evento con cui la shell dice che la barra ha cambiato forma (nasce con
/// la barra, `format-bar.ts`).
export { FORMATBAR_EVENT };

export interface SelectionBubble {
  readonly element: HTMLElement;
  /// Ridisegna: comandi, superficie o modalità cambiati.
  update(specs: readonly CommandSpec[]): void;
  destroy(): void;
}

export interface BubbleHost extends MiniBarHost {
  /// La bolla è voluta adesso, secondo `editor.minibar` e la forma della
  /// barra del foglio (`bubbleWanted`).
  wanted(): boolean;
  /// Il riquadro ha il fuoco (o la bolla ce l'ha): un riquadro che non si sta
  /// usando non mostra una bolla per una selezione di prima.
  active(): boolean;
}

/// Dove va una bolla alta `height` e larga `width` rispetto a un testo scelto,
/// dentro una finestra `view`: sopra il testo se c'è posto, sotto altrimenti,
/// centrata e mai fuori dai bordi. Pura: è tutta la geometria della bolla.
export function bubblePlace(
  box: { left: number; top: number; right: number; bottom: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  const above = box.top - GAP - size.height;
  const top = above >= GAP ? above : Math.min(box.bottom + GAP, Math.max(GAP, view.height - size.height - GAP));
  const centred = (box.left + box.right) / 2 - size.width / 2;
  const left = Math.min(Math.max(GAP, centred), Math.max(GAP, view.width - size.width - GAP));
  return { left: Math.round(left), top: Math.round(top) };
}

/// La misura del bordo della bolla, coi decimali. La bolla non ha trasformazioni,
/// quindi il rettangolo è la stessa misura che dà il `ResizeObserver`.
function measure(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

export function createSelectionBubble(host: BubbleHost): SelectionBubble {
  const element = document.createElement("div");
  element.className = "selection-bubble";
  element.hidden = true;
  const bar: MiniBar = createMiniBar(host);
  element.append(bar.element);
  // Dove sta il menu del tasto destro: dentro la regione del lavoro, che chi
  // usa un lettore di schermo trova fra i punti di riferimento.
  (document.getElementById("workspace") ?? document.body).append(element);
  const life = openLifetime();
  let unsubscribe: (() => void) | null = null;
  let observed: unknown = null;
  let frame: number | null = null;
  /// La misura della bolla, tenuta dal `ResizeObserver`; `null` finché non
  /// si è vista (nascosta non ne ha una).
  let size: { width: number; height: number } | null = null;
  /// La misura con cui la bolla si è posata l'ultima volta.
  let placedWith: { width: number; height: number } | null = null;
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.borderBoxSize?.[0];
      size = box && box.inlineSize > 0 ? { width: box.inlineSize, height: box.blockSize } : null;
      // Una bolla che ha cambiato misura (i pulsanti riletti, il «…» deciso)
      // si riposa: centrata con la misura vera, non con quella di prima.
      if (size && !element.hidden && (size.width !== placedWith?.width || size.height !== placedWith?.height)) schedule();
    });
    observer.observe(element);
    life.add(() => observer.disconnect());
  }

  const place = (): void => {
    frame = null;
    const holding = bar.holding();
    // Un suo menu aperto la tiene ferma: il fuoco è nel menu, la selezione
    // nell'editor è quella di prima.
    if (holding && !element.hidden) return;
    const surface = host.surface();
    const box = !host.wanted() || !host.active() ? null : surface?.editorActions?.selectionBox?.() ?? null;
    // Ciò che resta uguale non si riscrive: il posto si ricalcola a ogni
    // battuta, e in WebKit un attributo riscritto uguale fa ridipingere (C6).
    if (!box || !host.writing() || bar.element.hidden) {
      if (!element.hidden) element.hidden = true;
      return;
    }
    bar.refresh();
    if (element.hidden) {
      element.hidden = false;
      size = null;
    }
    // La prima volta la misura si prende dal motore, frazionaria come quella
    // del `ResizeObserver`: con `offsetWidth`, arrotondato, il centro cadeva
    // mezzo pixel più in là e la bolla stava un pixel più a sinistra o più a
    // destra secondo chi aveva misurato per ultimo.
    const measured = size ?? measure(element);
    placedWith = measured;
    const at = bubblePlace(box, measured, { width: window.innerWidth, height: window.innerHeight });
    const left = `${at.left}px`;
    const top = `${at.top}px`;
    if (element.style.left !== left) element.style.left = left;
    if (element.style.top !== top) element.style.top = top;
  };
  const schedule = (): void => {
    if (frame !== null || life.closed) return;
    frame = requestAnimationFrame(place);
  };
  life.add(() => {
    if (frame !== null) cancelAnimationFrame(frame);
  });
  // La bolla segue il testo mentre si scorre e mentre la finestra cambia.
  life.listen(window, "scroll", schedule, { capture: true, passive: true });
  life.listen(window, "resize", schedule);
  life.listen(window, FORMATBAR_EVENT, schedule);
  life.listen(document, "focusin", schedule);
  life.listen(document, "focusout", schedule);

  return {
    element,
    update(specs) {
      if (life.closed) return;
      bar.update(specs);
      const actions = host.surface()?.editorActions ?? null;
      if (actions !== observed) {
        unsubscribe?.();
        unsubscribe = actions ? actions.subscribe(schedule) : null;
        observed = actions;
      }
      schedule();
    },
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      bar.destroy();
      life.close();
      element.remove();
    },
  };
}
