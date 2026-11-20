// La colonna degli strumenti del kit, come nei programmi di grafica: gruppi di
// caselle separati da un filo; una casella con più strumenti ha un
// triangolino e una tendina, e mostra l'ultimo strumento scelto lì.
//
// - **Tastiera.** È una `toolbar` con un solo punto di tabulazione: le
//   frecce lungo il verso passano da una casella all'altra, Home e Fine vanno
//   ai capi, Invio e Spazio scelgono (un clic, come il pulsante). La freccia
//   di lato (destra in verticale, giù in orizzontale) apre la tendina.
// - **La tendina** si apre anche tenendo premuto (`FLYOUT_HOLD_MS`), col
//   tasto destro o col triangolino; è un `menu` di `menuitemradio`, col nome
//   e il tasto di ogni strumento. Scegliere lì sceglie lo strumento e lo fa
//   ricordare alla casella: l'owner lo salva dove vuole (`onRemember`).
// - **Il suggerimento** dice nome, tasto e una riga di descrizione.
//
// Il kit non ha testo suo: i nomi arrivano con gli strumenti, il resto in
// `text`.

import { iconEl } from "../ui/icons";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { attachTooltip, setTooltip } from "../ui/tooltip";
import { createList } from "./list";
import { openPopover, type PopoverHandle } from "./popover";

/// Quanto tenere premuto perché si apra la tendina (ms).
export const FLYOUT_HOLD_MS = 300;

export interface RailTool {
  readonly id: string;
  readonly label: string;
  /// Un nome di `ui/icons.ts`.
  readonly icon: string;
  /// Il tasto, come si legge: «V», «Maiusc+P».
  readonly keys?: string;
  /// Il tasto come lo vuole `aria-keyshortcuts`: «V», «Shift+P».
  readonly ariaKeys?: string;
  readonly description?: string;
}

/// Una casella: uno strumento, o più in una tendina.
export interface RailSlot {
  readonly id: string;
  readonly tools: readonly RailTool[];
}

export interface RailGroup {
  readonly id: string;
  readonly slots: readonly RailSlot[];
}

export interface ToolRailText {
  /// Il nome della tendina di una casella: «Altri strumenti di Forme».
  readonly more: (slot: string) => string;
}

export interface ToolRailOptions {
  /// Il nome della colonna.
  label: string;
  orientation?: "vertical" | "horizontal";
  groups: readonly RailGroup[];
  /// Lo strumento scelto.
  active: string | null;
  /// Lo strumento che ogni casella mostra, per id della casella.
  remembered?: Readonly<Record<string, string>>;
  /// Caselle grandi (44 px), per il dito.
  large?: boolean;
  /// Classi in più per ogni casella, per chi la ospita.
  slotClass?: string;
  text: ToolRailText;
  onSelect: (tool: string) => void;
  onRemember?: (slot: string, tool: string) => void;
  lifetime: Lifetime;
}

export interface ToolRail {
  readonly element: HTMLElement;
  setActive(tool: string | null): void;
  setGroups(groups: readonly RailGroup[]): void;
  setOrientation(orientation: "vertical" | "horizontal"): void;
  /// Spegne le caselle (sola lettura): si vedono, non si scelgono.
  setDisabled(disabled: boolean): void;
  /// Apre la tendina della casella di `tool`.
  openFlyout(slot: string): void;
  focus(): void;
}

interface SlotView {
  readonly slot: RailSlot;
  readonly button: HTMLButtonElement;
}

/// Il suggerimento di uno strumento: nome, tasto, descrizione.
export function toolTip(tool: RailTool): string {
  const head = tool.keys ? `${tool.label} (${tool.keys})` : tool.label;
  return tool.description ? `${head} — ${tool.description}` : head;
}

export function createToolRail(options: ToolRailOptions): ToolRail {
  const { lifetime } = options;
  let orientation = options.orientation ?? "vertical";
  let active = options.active;
  const remembered = new Map(Object.entries(options.remembered ?? {}));
  let views: SlotView[] = [];
  let focusIndex = 0;
  let flyout: PopoverHandle | null = null;
  let disabled = false;
  // Gli ascolti delle caselle: si rifanno con `setGroups`.
  let slots = openLifetime();
  lifetime.add(() => slots.close());

  const element = document.createElement("div");
  element.className = "kit-rail";
  element.dataset.size = options.large ? "large" : "normal";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-label", options.label);

  const shownTool = (slot: RailSlot): RailTool => {
    const inSlot = slot.tools.find((tool) => tool.id === active);
    if (inSlot) return inSlot;
    const wanted = remembered.get(slot.id);
    return slot.tools.find((tool) => tool.id === wanted) ?? slot.tools[0]!;
  };

  const paintSlot = (view: SlotView): void => {
    const tool = shownTool(view.slot);
    const { button } = view;
    button.dataset.tool = tool.id;
    button.querySelector(".kit-rail-icon")?.remove();
    const figure = iconEl(tool.icon);
    const holder = document.createElement("span");
    holder.className = "kit-rail-icon";
    if (figure) holder.append(figure);
    button.prepend(holder);
    button.setAttribute("aria-label", tool.label);
    if (tool.ariaKeys) button.setAttribute("aria-keyshortcuts", tool.ariaKeys);
    else button.removeAttribute("aria-keyshortcuts");
    // Il suggerimento porta anche la descrizione.
    setTooltip(button, toolTip(tool));
    button.setAttribute("aria-pressed", String(view.slot.tools.some((each) => each.id === active)));
  };

  const paintFocus = (): void => {
    views.forEach((view, index) => (view.button.tabIndex = index === focusIndex ? 0 : -1));
  };

  const select = (view: SlotView, tool: RailTool): void => {
    if (view.slot.tools.length > 1) {
      remembered.set(view.slot.id, tool.id);
      options.onRemember?.(view.slot.id, tool.id);
    }
    options.onSelect(tool.id);
  };

  const openFlyoutOf = (view: SlotView, focusMenu: boolean): void => {
    if (view.slot.tools.length < 2) return;
    flyout?.close();
    const menu = document.createElement("div");
    menu.className = "kit-rail-flyout";
    const name = options.text.more(shownTool(view.slot).label);
    menu.setAttribute("aria-label", name);
    view.button.setAttribute("aria-expanded", "true");
    // Una vita per tendina: la lista e il popover vanno via con lei.
    const own = openLifetime();
    slots.add(() => own.close());
    const handle = createList<RailTool>({
      container: menu,
      role: "menu",
      items: view.slot.tools,
      key: (tool) => tool.id,
      focus: "roving",
      render: (tool, row) => {
        row.setAttribute("role", "menuitemradio");
        row.setAttribute("aria-checked", String(tool.id === shownTool(view.slot).id));
        row.classList.add("kit-rail-flyout-item");
        const figure = iconEl(tool.icon);
        const holder = document.createElement("span");
        holder.className = "kit-rail-icon";
        holder.setAttribute("aria-hidden", "true");
        if (figure) holder.append(figure);
        const label = document.createElement("span");
        label.className = "kit-rail-flyout-label";
        label.textContent = tool.label;
        row.append(holder, label);
        if (tool.keys) {
          const keys = document.createElement("span");
          keys.className = "kit-rail-flyout-keys";
          keys.textContent = tool.keys;
          if (tool.ariaKeys) row.setAttribute("aria-keyshortcuts", tool.ariaKeys);
          row.append(keys);
        }
      },
      onActivate: (tool) => {
        flyout?.close();
        select(view, tool);
        paintSlot(view);
        view.button.focus();
      },
      lifetime: own,
    });
    flyout = openPopover({
      anchor: view.button,
      content: menu,
      role: "menu",
      label: name,
      placement: orientation === "vertical" ? "right" : "top",
      align: "start",
      className: "kit-rail-popover",
      autoFocus: focusMenu,
      lifetime: own,
      onClose: () => {
        view.button.setAttribute("aria-expanded", "false");
        flyout = null;
        queueMicrotask(() => own.close());
      },
    });
    handle.setActive(shownTool(view.slot).id);
    if (focusMenu) handle.element(shownTool(view.slot).id)?.focus();
  };

  const build = (groups: readonly RailGroup[]): void => {
    flyout?.close();
    slots.close();
    slots = openLifetime();
    element.replaceChildren();
    views = [];
    groups.forEach((group, groupIndex) => {
      if (group.slots.length === 0) return;
      if (groupIndex > 0 && views.length > 0) {
        const rule = document.createElement("div");
        rule.className = "kit-rail-rule";
        rule.setAttribute("role", "separator");
        element.append(rule);
      }
      const box = document.createElement("div");
      box.className = "kit-rail-group";
      box.dataset.group = group.id;
      for (const slot of group.slots) {
        if (slot.tools.length === 0) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = options.slotClass ? `kit-rail-slot ${options.slotClass}` : "kit-rail-slot";
        button.disabled = disabled;
        button.dataset.slot = slot.id;
        // Tutti gli strumenti della casella, per chi la ispeziona.
        button.dataset.tools = slot.tools.map((tool) => tool.id).join(" ");
        const view: SlotView = { slot, button };
        if (slot.tools.length > 1) {
          button.setAttribute("aria-haspopup", "menu");
          button.setAttribute("aria-expanded", "false");
          const corner = document.createElement("span");
          corner.className = "kit-rail-corner";
          corner.setAttribute("aria-hidden", "true");
          button.append(corner);
        }
        slots.add(attachTooltip(button, ""));
        wireSlot(view);
        views.push(view);
        box.append(button);
        paintSlot(view);
      }
      element.append(box);
    });
    focusIndex = Math.max(0, views.findIndex((view) => view.slot.tools.some((tool) => tool.id === active)));
    paintFocus();
  };

  const wireSlot = (view: SlotView): void => {
    const { button } = view;
    let hold: ReturnType<typeof setTimeout> | null = null;
    let held = false;
    const stopHold = (): void => {
      if (hold !== null) clearTimeout(hold);
      hold = null;
    };
    slots.add(stopHold);
    slots.listen(button, "pointerdown", (event) => {
      if (event.button > 0 || view.slot.tools.length < 2) return;
      held = false;
      // Il triangolino apre subito.
      if (event.target instanceof Element && event.target.closest(".kit-rail-corner")) {
        held = true;
        openFlyoutOf(view, false);
        return;
      }
      hold = setTimeout(() => {
        hold = null;
        held = true;
        openFlyoutOf(view, false);
      }, FLYOUT_HOLD_MS);
    });
    slots.listen(button, "pointerup", stopHold);
    slots.listen(button, "pointerleave", stopHold);
    slots.listen(button, "pointercancel", stopHold);
    slots.listen(button, "contextmenu", (event) => {
      if (view.slot.tools.length < 2) return;
      event.preventDefault();
      openFlyoutOf(view, false);
    });
    slots.listen(button, "click", () => {
      // Il clic che chiude una pressione lunga non sceglie.
      if (held) {
        held = false;
        return;
      }
      focusIndex = views.indexOf(view);
      paintFocus();
      select(view, shownTool(view.slot));
    });
  };

  lifetime.listen(element, "keydown", (event) => {
    const at = views.findIndex((view) => view.button === event.target);
    if (at < 0) return;
    const forward = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    const back = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    const side = orientation === "vertical" ? "ArrowRight" : "ArrowUp";
    let next = -1;
    if (event.key === forward) next = (at + 1) % views.length;
    else if (event.key === back) next = (at - 1 + views.length) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else if (event.key === side && views[at]!.slot.tools.length > 1) {
      event.preventDefault();
      openFlyoutOf(views[at]!, true);
      return;
    }
    if (next < 0) return;
    event.preventDefault();
    focusIndex = next;
    paintFocus();
    views[next]!.button.focus();
  });

  const setOrientation = (next: "vertical" | "horizontal"): void => {
    orientation = next;
    element.setAttribute("aria-orientation", next);
    element.dataset.orientation = next;
  };
  setOrientation(orientation);
  build(options.groups);

  return {
    element,
    setActive(tool) {
      active = tool;
      for (const view of views) {
        if (tool !== null && view.slot.tools.length > 1 && view.slot.tools.some((each) => each.id === tool)) remembered.set(view.slot.id, tool);
        paintSlot(view);
      }
    },
    setGroups: build,
    setOrientation,
    setDisabled(next) {
      disabled = next;
      if (next) flyout?.close();
      for (const view of views) view.button.disabled = next;
    },
    openFlyout(slot) {
      const view = views.find((each) => each.slot.id === slot);
      if (view) openFlyoutOf(view, true);
    },
    focus: () => views[focusIndex]?.button.focus(),
  };
}
