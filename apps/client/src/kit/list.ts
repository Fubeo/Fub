// La lista: righe fra cui ci si muove con le frecce, e una sola attiva.
//
// Serve a due forme. In un `listbox` il fuoco resta di chi possiede la lista
// (un campo di ricerca) e la riga attiva si dice con `aria-activedescendant`;
// oppure il fuoco viaggia sulle righe, col `tabindex` che lo segue. La prima è
// di serie: chi scrive non deve perdere il cursore per scendere di una riga.
//
// La riga attiva la segna un rettangolo solo, `.kit-list-highlight`, che si
// sposta da una riga all'altra invece di spegnersi e riaccendersi.
import { springValue } from "../moto";
import { identifier } from "../ui/a11y";
import type { Lifetime } from "../ui/lifetime";

export type ListRole = "listbox" | "menu";
export type ListFocus = "activedescendant" | "roving";

export interface ListOptions<T> {
  /// L'elemento che ospita le righe. Diventa la lista: non deve avere altro.
  container: HTMLElement;
  role: ListRole;
  items: readonly T[];
  /// L'identità di una voce: è ciò che tiene ferma la riga attiva quando le
  /// voci cambiano. Di due voci con la stessa chiave resta la prima.
  key: (item: T) => string;
  /// Riempie la riga di una voce. La riga arriva vuota.
  render: (item: T, row: HTMLElement) => void;
  /// Invio, Spazio o un clic sulla riga attiva.
  onActivate: (item: T, event: Event) => void;
  /// La riga attiva è cambiata. Non parte alla creazione: vedi `active()`.
  onHighlight?: (item: T | null) => void;
  /// Una voce che si vede e non si sceglie: le frecce la saltano.
  disabled?: (item: T) => boolean;
  /// Le voci scelte di un `listbox`: le loro righe portano `data-selected`. Si
  /// rilegge a ogni `setItems`. Senza, è scelta la riga attiva.
  selected?: (item: T) => boolean;
  /// Dove sta il fuoco. Di serie `activedescendant`.
  focus?: ListFocus;
  /// Chi tiene il fuoco e riceve i tasti in `activedescendant`: di solito un
  /// campo. Di serie il contenitore stesso.
  owner?: HTMLElement;
  /// Il testo di una voce per la ricerca a battuta. Senza, non c'è. Non vale
  /// quando il fuoco è in un campo di testo: lì i tasti scrivono.
  typeahead?: (item: T) => string;
  /// Tiene sempre attiva una riga, la prima se serve. Di serie in un `listbox`.
  autoHighlight?: boolean;
  /// Dopo l'ultima riga si torna alla prima. Di serie in un `menu`.
  wrap?: boolean;
  lifetime: Lifetime;
}

export interface ListHandle<T> {
  /// Cambia le voci. La riga attiva resta se la sua chiave c'è ancora.
  setItems(items: readonly T[]): void;
  /// Attiva la riga con questa chiave, o nessuna.
  setActive(key: string | null): void;
  /// La voce attiva.
  active(): T | null;
  /// La riga di una voce.
  element(key: string): HTMLElement | null;
}

interface Row<T> {
  key: string;
  item: T;
  el: HTMLElement;
  disabled: boolean;
}

/// Quanto dura una parola della ricerca a battuta dopo l'ultimo tasto (ms).
export const TYPEAHEAD_MS = 500;
/// Il salto di PagSu e PagGiù dove la lista non ha ancora una misura.
const PAGE_FALLBACK = 10;

export function createList<T>(options: ListOptions<T>): ListHandle<T> {
  const { container, lifetime } = options;
  const doc = container.ownerDocument;
  const view = doc.defaultView ?? window;
  const roving = options.focus === "roving";
  const owner = roving ? container : (options.owner ?? container);
  const textual =
    owner instanceof HTMLInputElement ||
    owner instanceof HTMLTextAreaElement ||
    owner.isContentEditable === true;
  const listbox = options.role === "listbox";
  const autoHighlight = options.autoHighlight ?? listbox;
  const wrap = options.wrap ?? !listbox;

  let rows: Row<T>[] = [];
  const byElement = new Map<Element, Row<T>>();
  let active: Row<T> | null = null;
  /// Falsa finché la lista si costruisce: intanto `onHighlight` tace.
  let ready = false;
  let buffer = "";
  let bufferTimer: number | undefined;

  container.classList.add("kit-list");
  container.setAttribute("role", options.role);
  const ownId = !container.id;
  if (ownId) container.id = identifier("kit-list");
  // Senza un posto dove fermarsi il contenitore non riceverebbe i tasti.
  const ownTabStop = !roving && owner === container && container.tabIndex < 0;
  if (ownTabStop) container.tabIndex = 0;
  const ownControls = owner !== container && !owner.hasAttribute("aria-controls");
  if (ownControls) owner.setAttribute("aria-controls", container.id);

  const highlight = doc.createElement("div");
  highlight.className = "kit-list-highlight";
  highlight.setAttribute("aria-hidden", "true");
  highlight.hidden = true;
  container.prepend(highlight);
  const paint = (): void => {
    highlight.style.setProperty("translate", `${x.get()}px ${y.get()}px`);
  };
  const x = springValue({ spring: "snap", initial: 0, onUpdate: paint, lifetime });
  const y = springValue({ spring: "snap", initial: 0, onUpdate: paint, lifetime });

  /// Posa il rettangolo sulla riga attiva. Scivola solo se era già su una riga.
  const place = (slide: boolean): void => {
    if (!active) {
      highlight.hidden = true;
      return;
    }
    const el = active.el;
    highlight.style.width = `${el.offsetWidth}px`;
    highlight.style.height = `${el.offsetHeight}px`;
    if (slide && !highlight.hidden) {
      x.set(el.offsetLeft);
      y.set(el.offsetTop);
    } else {
      highlight.hidden = false;
      x.jump(el.offsetLeft);
      y.jump(el.offsetTop);
    }
  };

  const mark = (row: Row<T>, on: boolean): void => {
    if (on) row.el.dataset.active = "";
    else delete row.el.dataset.active;
    if (listbox && !options.selected) row.el.setAttribute("aria-selected", String(on));
  };

  /// Scrive chi è attivo dove lo legge chi non guarda: sul padrone del fuoco,
  /// o nel `tabindex` delle righe.
  const announce = (): void => {
    if (roving) {
      const stop = active ?? rows.find((row) => !row.disabled) ?? null;
      for (const row of rows) row.el.tabIndex = row === stop ? 0 : -1;
    } else if (active) {
      owner.setAttribute("aria-activedescendant", active.el.id);
    } else {
      owner.removeAttribute("aria-activedescendant");
    }
  };

  const activate = (next: Row<T> | null, by: "keys" | "pointer"): void => {
    if (next === active || lifetime.closed) return;
    if (active) mark(active, false);
    active = next;
    if (next) mark(next, true);
    announce();
    place(true);
    if (next && by === "keys") next.el.scrollIntoView({ block: "nearest" });
    // Il fuoco segue solo se era già nella lista: non lo si ruba a nessuno.
    if (roving && next && container.contains(doc.activeElement)) {
      next.el.focus({ preventScroll: by === "pointer" });
    }
    if (ready) options.onHighlight?.(next?.item ?? null);
  };

  const draw = (row: Row<T>): void => {
    row.el.replaceChildren();
    options.render(row.item, row.el);
  };

  const setItems = (items: readonly T[]): void => {
    // Una lista smontata non si riempie: le sue righe non avrebbero un padrone.
    if (lifetime.closed) return;
    const previous = new Map(rows.map((row) => [row.key, row]));
    const seen = new Set<string>();
    const next: Row<T>[] = [];
    for (const item of items) {
      const key = options.key(item);
      if (seen.has(key)) continue;
      seen.add(key);
      let row = previous.get(key);
      if (!row) {
        const el = doc.createElement("div");
        el.className = "kit-list-item";
        el.id = identifier("kit-item");
        el.setAttribute("role", listbox ? "option" : "menuitem");
        if (roving) el.tabIndex = -1;
        row = { key, item, el, disabled: false };
        byElement.set(el, row);
        draw(row);
        if (listbox && !options.selected) el.setAttribute("aria-selected", "false");
      } else if (row.item !== item) {
        row.item = item;
        draw(row);
      }
      row.disabled = options.disabled?.(item) ?? false;
      if (row.disabled) row.el.setAttribute("aria-disabled", "true");
      else row.el.removeAttribute("aria-disabled");
      if (listbox && options.selected) {
        const chosen = options.selected(item);
        row.el.setAttribute("aria-selected", String(chosen));
        // La scelta dichiarata non è la riga attiva: la pelle la segna per
        // conto suo, e il segno non si muove mentre le frecce passano.
        if (chosen) row.el.dataset.selected = "";
        else delete row.el.dataset.selected;
      }
      next.push(row);
    }
    for (const row of rows) {
      if (seen.has(row.key)) continue;
      row.el.remove();
      byElement.delete(row.el);
    }
    // Le righe si rimettono in ordine dove sono: ciò che non si è mosso non
    // si stacca, e non perde lo scorrimento né il fuoco.
    let before: Element = highlight;
    for (const row of next) {
      if (before.nextElementSibling !== row.el) before.after(row.el);
      before = row.el;
    }
    rows = next;

    if (active && seen.has(active.key) && !active.disabled) {
      announce();
      place(false);
      return;
    }
    const fallback = autoHighlight ? (rows.find((row) => !row.disabled) ?? null) : null;
    if (active) {
      // La riga di prima non c'è più, o non si può più scegliere.
      mark(active, false);
      active = null;
      if (!fallback) {
        announce();
        place(false);
        if (ready) options.onHighlight?.(null);
        return;
      }
    }
    if (fallback) activate(fallback, "keys");
    else announce();
    place(false);
  };

  const page = (): number => {
    const height = active?.el.offsetHeight || rows[0]?.el.offsetHeight || 0;
    const room = container.clientHeight;
    return height > 0 && room > 0 ? Math.max(1, Math.floor(room / height) - 1) : PAGE_FALLBACK;
  };

  /// Cerca la voce che comincia con ciò che si sta battendo. Una lettera
  /// ripetuta scorre fra le voci che cominciano con lei.
  const search = (character: string): void => {
    const text = options.typeahead;
    if (!text) return;
    buffer += character.toLocaleLowerCase();
    view.clearTimeout(bufferTimer);
    bufferTimer = view.setTimeout(() => {
      buffer = "";
    }, TYPEAHEAD_MS);
    const enabled = rows.filter((row) => !row.disabled);
    const repeated = [...buffer].every((each) => each === buffer[0]);
    const query = repeated ? buffer[0] : buffer;
    const at = active ? enabled.indexOf(active) : -1;
    const from = repeated ? at + 1 : Math.max(at, 0);
    for (let offset = 0; offset < enabled.length; offset++) {
      const row = enabled[(from + offset) % enabled.length];
      if (text(row.item).toLocaleLowerCase().startsWith(query)) {
        activate(row, "keys");
        return;
      }
    }
  };

  lifetime.listen(owner, "keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      if (!active) return;
      event.preventDefault();
      options.onActivate(active.item, event);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const enabled = rows.filter((row) => !row.disabled);
    if (enabled.length === 0) return;
    const last = enabled.length - 1;
    const at = active ? enabled.indexOf(active) : -1;
    let next: Row<T>;
    switch (event.key) {
      case "ArrowDown":
        if (event.shiftKey) return;
        next = enabled[at < 0 ? 0 : at < last ? at + 1 : wrap ? 0 : last];
        break;
      case "ArrowUp":
        if (event.shiftKey) return;
        next = enabled[at < 0 ? last : at > 0 ? at - 1 : wrap ? last : 0];
        break;
      case "PageDown":
        next = enabled[Math.min(last, Math.max(at, 0) + page())];
        break;
      case "PageUp":
        next = enabled[Math.max(0, Math.max(at, 0) - page())];
        break;
      case "Home":
        // In un campo Inizio e Fine sono del cursore.
        if (textual || event.shiftKey) return;
        next = enabled[0];
        break;
      case "End":
        if (textual || event.shiftKey) return;
        next = enabled[last];
        break;
      default:
        if (textual) return;
        if (event.key === " " && buffer === "") {
          if (!active) return;
          event.preventDefault();
          options.onActivate(active.item, event);
        } else if (event.key.length === 1 && options.typeahead) {
          event.preventDefault();
          search(event.key);
        }
        return;
    }
    event.preventDefault();
    activate(next, "keys");
  });

  const rowOf = (target: EventTarget | null): Row<T> | null => {
    let el = target instanceof Element ? target : null;
    while (el && el.parentElement !== container) el = el.parentElement;
    const row = el ? byElement.get(el) : undefined;
    return row && !row.disabled ? row : null;
  };
  // `pointermove` e non `pointerover`: una lista che scorre sotto un puntatore
  // fermo non deve togliere la riga a chi sta usando le frecce.
  lifetime.listen(container, "pointermove", (event) => {
    const row = rowOf(event.target);
    if (row) activate(row, "pointer");
  });
  lifetime.listen(container, "click", (event) => {
    const row = rowOf(event.target);
    if (!row) return;
    activate(row, "pointer");
    options.onActivate(row.item, event);
  });
  lifetime.listen(container, "mousedown", (event) => {
    // Il fuoco è di un campo: premere una riga non deve toglierglielo.
    if (owner !== container && rowOf(event.target)) event.preventDefault();
  });
  if (roving) {
    lifetime.listen(container, "focusin", (event) => {
      const row = rowOf(event.target);
      if (row) activate(row, "keys");
    });
  }

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => place(false));
    observer.observe(container);
    lifetime.add(() => observer.disconnect());
  }
  lifetime.add(() => {
    view.clearTimeout(bufferTimer);
    for (const row of rows) row.el.remove();
    rows = [];
    byElement.clear();
    active = null;
    highlight.remove();
    owner.removeAttribute("aria-activedescendant");
    if (ownControls) owner.removeAttribute("aria-controls");
    if (ownTabStop) container.removeAttribute("tabindex");
    if (ownId) container.removeAttribute("id");
    container.removeAttribute("role");
    container.classList.remove("kit-list");
  });

  setItems(options.items);
  ready = true;

  return {
    setItems,
    setActive(key) {
      const row = key === null ? null : rows.find((each) => each.key === key);
      if (row === undefined || row?.disabled) return;
      activate(row, "keys");
    },
    active: () => active?.item ?? null,
    element: (key) => rows.find((row) => row.key === key)?.el ?? null,
  };
}
