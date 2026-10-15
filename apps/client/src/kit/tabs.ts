// Le schede: una fila di pulsanti di cui uno è scelto, e un segno che lo dice.
//
// Nella fila Tab si ferma una volta sola, sulla scheda scelta; fra le schede ci
// si muove con le frecce. Il segno è un elemento solo, `.kit-tab-indicator`,
// che scivola da una scheda all'altra: la sua posizione cambia subito, e ciò
// che si vede muovere è la differenza (`flip`).
import { flip } from "../moto";
import { identifier } from "../ui/a11y";
import { iconEl } from "../ui/icons";
import type { Lifetime } from "../ui/lifetime";

export interface TabSpec {
  id: string;
  label: string;
  /// Un nome di `ui/icons.ts`, prima del testo.
  icon?: string;
  /// Il pannello della scheda: riceve ruolo e nome, e si vede solo se è il suo
  /// turno. Senza, mostrare il contenuto è affare di `onSelect`.
  panel?: HTMLElement;
  disabled?: boolean;
}

export interface TabsOptions {
  /// L'elemento che ospita le schede. Diventa la fila: non deve avere altro.
  tablist: HTMLElement;
  tabs: readonly TabSpec[];
  /// La scheda scelta all'inizio. Di serie la prima che si può scegliere.
  selected?: string;
  /// `automatic`: le frecce scelgono. `manual`: le frecce spostano il fuoco, e
  /// scelgono Invio o Spazio. Di serie `automatic`; `manual` è per le schede
  /// il cui contenuto costa mostrare.
  activation?: "automatic" | "manual";
  /// Di serie `horizontal`.
  orientation?: "horizontal" | "vertical";
  /// Il nome accessibile della fila.
  label?: string;
  /// L'utente ha scelto una scheda. Non parte per `select()`.
  onSelect: (id: string) => void;
  lifetime: Lifetime;
}

export interface TabsHandle {
  /// Sceglie una scheda senza chiamare `onSelect`: è il programma, non l'utente.
  select(id: string): void;
  selected(): string | null;
  /// Il pulsante di una scheda.
  tab(id: string): HTMLButtonElement | null;
}

interface Tab {
  spec: TabSpec;
  button: HTMLButtonElement;
}

export function createTabs(options: TabsOptions): TabsHandle {
  const { tablist, lifetime } = options;
  const doc = tablist.ownerDocument;
  const vertical = options.orientation === "vertical";
  const manual = options.activation === "manual";
  let selected: Tab | null = null;

  tablist.classList.add("kit-tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
  if (options.label) tablist.setAttribute("aria-label", options.label);

  const tabs: Tab[] = options.tabs.map((spec) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "kit-tab";
    button.id = identifier("kit-tab");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.tabIndex = -1;
    button.disabled = spec.disabled === true;
    button.dataset.tab = spec.id;
    const figure = spec.icon ? iconEl(spec.icon) : null;
    if (figure) button.append(figure);
    const text = doc.createElement("span");
    text.className = "kit-tab-label";
    text.textContent = spec.label;
    button.append(text);
    if (spec.panel) {
      if (!spec.panel.id) spec.panel.id = identifier("kit-tabpanel");
      spec.panel.setAttribute("role", "tabpanel");
      spec.panel.setAttribute("aria-labelledby", button.id);
      spec.panel.hidden = true;
      button.setAttribute("aria-controls", spec.panel.id);
    }
    tablist.append(button);
    return { spec, button };
  });

  const indicator = doc.createElement("span");
  indicator.className = "kit-tab-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.hidden = true;
  tablist.append(indicator);

  /// Mette il segno sotto la scheda scelta, lungo l'asse della fila.
  const place = (): void => {
    if (!selected) {
      indicator.hidden = true;
      return;
    }
    indicator.hidden = false;
    const { button } = selected;
    if (vertical) {
      indicator.style.top = `${button.offsetTop}px`;
      indicator.style.height = `${button.offsetHeight}px`;
    } else {
      indicator.style.left = `${button.offsetLeft}px`;
      indicator.style.width = `${button.offsetWidth}px`;
    }
  };

  const choose = (next: Tab, slide: boolean): boolean => {
    if (next === selected || next.spec.disabled) return false;
    const previous = selected;
    selected = next;
    if (previous) {
      previous.button.setAttribute("aria-selected", "false");
      previous.button.tabIndex = -1;
      if (previous.spec.panel) previous.spec.panel.hidden = true;
    }
    next.button.setAttribute("aria-selected", "true");
    next.button.tabIndex = 0;
    if (next.spec.panel) next.spec.panel.hidden = false;
    // La prima volta il segno compare al suo posto: non ha da dove venire.
    if (slide && previous) flip([indicator], place, { spring: "snap", lifetime });
    else place();
    return true;
  };

  const pick = (tab: Tab): void => {
    if (choose(tab, true)) options.onSelect(tab.spec.id);
  };

  const tabOf = (target: EventTarget | null): Tab | null => {
    const button = target instanceof Element ? target.closest(".kit-tab") : null;
    return tabs.find((tab) => tab.button === button) ?? null;
  };

  lifetime.listen(tablist, "click", (event) => {
    const tab = tabOf(event.target);
    if (tab) pick(tab);
  });
  lifetime.listen(tablist, "keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const current = tabOf(event.target);
    if (!current) return;
    const enabled = tabs.filter((tab) => !tab.spec.disabled);
    const at = enabled.indexOf(current);
    const last = enabled.length - 1;
    // In una pagina da destra a sinistra «avanti» è la freccia sinistra.
    const rtl = !vertical && getComputedStyle(tablist).direction === "rtl";
    const forward = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    const backward = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
    let next: Tab;
    if (event.key === forward) next = enabled[at < last ? at + 1 : 0];
    else if (event.key === backward) next = enabled[at > 0 ? at - 1 : last];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[last];
    else return;
    event.preventDefault();
    next.button.focus();
    if (!manual) pick(next);
  });

  if (typeof ResizeObserver !== "undefined") {
    // Anche le schede: un carattere che arriva tardi ne cambia la larghezza
    // senza cambiare quella della fila.
    const observer = new ResizeObserver(place);
    observer.observe(tablist);
    for (const tab of tabs) observer.observe(tab.button);
    lifetime.add(() => observer.disconnect());
  }
  lifetime.add(() => {
    for (const { spec, button } of tabs) {
      button.remove();
      spec.panel?.removeAttribute("role");
      spec.panel?.removeAttribute("aria-labelledby");
    }
    indicator.remove();
    selected = null;
    tablist.removeAttribute("role");
    tablist.removeAttribute("aria-orientation");
    if (options.label) tablist.removeAttribute("aria-label");
    tablist.classList.remove("kit-tabs");
  });

  const first =
    tabs.find((tab) => tab.spec.id === options.selected && !tab.spec.disabled) ??
    tabs.find((tab) => !tab.spec.disabled);
  if (first && !lifetime.closed) choose(first, false);

  return {
    select(id) {
      const tab = tabs.find((each) => each.spec.id === id);
      if (tab && !lifetime.closed) choose(tab, true);
    },
    selected: () => selected?.spec.id ?? null,
    tab: (id) => tabs.find((tab) => tab.spec.id === id)?.button ?? null,
  };
}
