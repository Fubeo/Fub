// La bolla di selezione: i gesti di formattazione accanto al testo scelto,
// quando la barra del foglio è spenta (`chrome.formatbar.visible`).
//
// È la stessa barra, ristretta ai gruppi che si fanno su un testo scelto
// (corsivo, grassetto, collegamento): nessun comando nuovo, nessuna scorciatoia
// in più, e la tastiera resta quella della barra — un solo punto di tabulazione,
// le frecce, Escape che riporta al testo. Con la barra accesa la bolla non
// esiste: due copie degli stessi pulsanti sullo stesso foglio sarebbero rumore.
//
// Dove sta il testo lo dice la superficie (`selectionBox`), mai l'editor: qui
// passano soltanto quattro numeri.
import type { CommandSpec } from "../host/contract";
import { createFormatBar, type FormatBar, type FormatBarHost, type GroupId } from "./format-bar";
import { openLifetime } from "../ui/lifetime";

/// I gruppi che la bolla offre: il carattere e i collegamenti. Il resto — gli
/// stili di paragrafo, le liste, i blocchi — si fa su una riga, non su una
/// selezione.
const BUBBLE_GROUPS: readonly GroupId[] = ["inline", "links"];

/// Lo spazio fra la bolla e il testo.
const GAP = 8;

/// L'evento con cui la shell dice che la barra si è accesa o spenta.
export const FORMATBAR_EVENT = "shell:formatbar";

export interface SelectionBubble {
  readonly element: HTMLElement;
  /// Ridisegna: comandi, superficie o modalità cambiati.
  update(specs: readonly CommandSpec[]): void;
  destroy(): void;
}

export interface BubbleHost extends Omit<FormatBarHost, "only"> {
  /// La barra del foglio è spenta: solo allora c'è la bolla.
  barOff(): boolean;
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

export function createSelectionBubble(host: BubbleHost): SelectionBubble {
  const element = document.createElement("div");
  element.className = "selection-bubble";
  element.hidden = true;
  const bar: FormatBar = createFormatBar({ ...host, only: BUBBLE_GROUPS });
  element.append(bar.element);
  document.body.append(element);
  const life = openLifetime();
  let unsubscribe: (() => void) | null = null;
  let observed: unknown = null;
  let frame: number | null = null;

  const place = (): void => {
    frame = null;
    const surface = host.surface();
    const box = !host.barOff() || !host.active() ? null : surface?.editorActions?.selectionBox?.() ?? null;
    if (!box || !host.writing() || bar.element.hidden) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    const at = bubblePlace(
      box,
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    element.style.left = `${at.left}px`;
    element.style.top = `${at.top}px`;
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
