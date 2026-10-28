// La barra delle opzioni del kit: una riga di controlli che cambia con lo
// strumento e la selezione. Quando non c'è posto, i controlli meno importanti
// vanno in «…», un popover che li tiene tali e quali: sono gli stessi
// elementi, spostati, così ascolti e stato restano dove sono.
//
// - **Chi esce prima.** La priorità più bassa; a pari priorità, il più a
//   destra. La regola pura è `overflowing`, che il banco prova senza DOM.
// - **La misura.** Un `ResizeObserver` con owner, sulla barra e su ogni
//   controllo, rifà il conto al più una volta per fotogramma; anche
//   `setItems` lo rifà. Un controllo che il suo owner nasconde va in un
//   involucro: la barra mostra e nasconde l'involucro, non lui.
// - **La tastiera.** È una `toolbar` orizzontale: Tab entra e esce, i
//   controlli tengono i loro tasti.
//
// Il kit non ha testo suo: il nome della barra e quello di «…» arrivano da
// chi la crea.

import type { Lifetime } from "../ui/lifetime";
import { attachTooltip } from "../ui/tooltip";
import { openPopover, type PopoverHandle } from "./popover";

export interface OptionItem {
  readonly id: string;
  readonly element: HTMLElement;
  /// Chi ha di più resta di più. Di serie 0.
  readonly priority?: number;
}

export interface OptionsBarOptions {
  label: string;
  /// Il nome di «…»: «Altre opzioni».
  moreLabel: string;
  items?: readonly OptionItem[];
  lifetime: Lifetime;
}

export interface OptionsBar {
  readonly element: HTMLElement;
  setItems(items: readonly OptionItem[]): void;
  /// Gli id dei controlli che stanno in «…».
  overflow(): readonly string[];
  /// Rifà il conto subito.
  fit(): void;
}

/// Gli indici che escono perché `widths` stia in `available`, contando che
/// «…» prende `more` quando serve.
export function overflowing(
  widths: readonly number[],
  priorities: readonly number[],
  available: number,
  more: number,
): Set<number> {
  const out = new Set<number>();
  let total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return out;
  const order = widths.map((_, index) => index).sort((a, b) => (priorities[a] ?? 0) - (priorities[b] ?? 0) || b - a);
  for (const index of order) {
    if (total + more <= available) break;
    out.add(index);
    total -= widths[index]!;
  }
  return out;
}

export function createOptionsBar(options: OptionsBarOptions): OptionsBar {
  const { lifetime } = options;
  let items: readonly OptionItem[] = [];
  let hidden = new Set<number>();
  let popover: PopoverHandle | null = null;
  let frame: number | null = null;

  const element = document.createElement("div");
  element.className = "kit-options";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-orientation", "horizontal");
  element.setAttribute("aria-label", options.label);
  const row = document.createElement("div");
  row.className = "kit-options-row";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "kit-options-more";
  more.textContent = "…";
  more.hidden = true;
  more.setAttribute("aria-label", options.moreLabel);
  more.setAttribute("aria-haspopup", "dialog");
  more.setAttribute("aria-expanded", "false");
  lifetime.add(attachTooltip(more, options.moreLabel));
  element.append(row, more);

  const box = document.createElement("div");
  box.className = "kit-options-overflow";

  const close = (): void => popover?.close();

  /// Rimette ogni controllo nella riga, al suo posto.
  const restore = (): void => {
    row.replaceChildren(...items.map((item) => item.element));
    for (const item of items) item.element.hidden = false;
  };

  const fit = (): void => {
    if (popover) return;
    restore();
    more.hidden = true;
    const widths = items.map((item) => item.element.getBoundingClientRect().width);
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const spaced = widths.map((width, index) => width + (index > 0 ? gap : 0));
    more.hidden = false;
    const moreWidth = more.getBoundingClientRect().width + gap;
    more.hidden = true;
    hidden = overflowing(
      spaced,
      items.map((item) => item.priority ?? 0),
      element.clientWidth,
      moreWidth,
    );
    items.forEach((item, index) => (item.element.hidden = hidden.has(index)));
    more.hidden = hidden.size === 0;
    // Il fuoco non resta su un controllo che non si vede.
    const focus = document.activeElement;
    if (focus instanceof HTMLElement && focus.closest("[hidden]") && row.contains(focus)) more.focus();
  };

  const schedule = (): void => {
    if (frame !== null || lifetime.closed) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      fit();
    });
  };
  lifetime.add(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  });

  const open = (): void => {
    if (popover || hidden.size === 0) return;
    const moved = items.filter((_, index) => hidden.has(index));
    for (const item of moved) item.element.hidden = false;
    box.replaceChildren(...moved.map((item) => item.element));
    more.setAttribute("aria-expanded", "true");
    popover = openPopover({
      anchor: more,
      content: box,
      label: options.moreLabel,
      placement: "bottom",
      align: "end",
      className: "kit-options-popover",
      lifetime,
      onClose: () => {
        more.setAttribute("aria-expanded", "false");
        popover = null;
        fit();
      },
    });
  };
  lifetime.listen(more, "click", () => (popover ? close() : open()));

  // La barra e ogni controllo: un controllo che il suo owner nasconde o
  // allarga rifà il conto come la barra che cambia misura.
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") observer = new ResizeObserver(schedule);
  observer?.observe(element);
  lifetime.add(() => observer?.disconnect());

  const setItems = (next: readonly OptionItem[]): void => {
    close();
    for (const item of items) observer?.unobserve(item.element);
    for (const item of next) observer?.observe(item.element);
    items = next;
    hidden = new Set();
    restore();
    fit();
  };
  setItems(options.items ?? []);

  return {
    element,
    setItems,
    overflow: () => items.filter((_, index) => hidden.has(index)).map((item) => item.id),
    fit,
  };
}
