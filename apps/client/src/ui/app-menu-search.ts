// La ricerca nel menu dell'applicazione: un campo che filtra tutte le voci dei
// cinque menu e ne esegue una senza sapere in quale menu stia.
//
// È una combobox ARIA con un elenco di opzioni: il fuoco resta sul campo e la
// voce evidenziata si dice con `aria-activedescendant`, come in ogni ricerca
// che si scrive mentre si sceglie. Le voci sono quelle che `app-menu.ts` già
// costruisce dal registro dei comandi — una per riga, col nome del menu davanti
// — e scegliere vuol dire chiamare la stessa `run`: nessun comando nuovo.
import { t } from "../i18n/strings";
import { openLifetime } from "./lifetime";
import type { MenuItem } from "./menu";

export interface SearchableEntry {
  /// Il nome del menu che la contiene, già tradotto.
  readonly group: string;
  readonly item: MenuItem;
}

/// Il testo in cui si cerca: minuscolo e senza accenti, così «impostazioni»
/// trova «Impostazioni» e «pagina» trova «pàgina».
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/// Le voci che rispondono alla ricerca, nell'ordine dei menu. Ogni parola
/// scritta deve comparire, in qualunque ordine, nel nome della voce o in quello
/// del suo menu. Le voci disabilitate non si scelgono e non si offrono.
export function matching(entries: readonly SearchableEntry[], query: string): SearchableEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return entries.filter(({ group, item }) => {
    if (item.disabled) return false;
    const haystack = fold(`${group} ${item.label}`);
    return words.every((word) => haystack.includes(word));
  });
}

let serial = 0;

/// Apre il pannello sotto `anchor` e torna come chiuderlo. `onClose` scatta una
/// volta sola, qualunque sia il modo in cui il pannello si chiude.
export function openMenuSearch(options: {
  anchor: HTMLElement;
  entries: readonly SearchableEntry[];
  onClose: () => void;
}): () => void {
  const { anchor, entries } = options;
  const lifetime = openLifetime();
  const id = `app-menu-search-${++serial}`;

  const panel = document.createElement("div");
  panel.className = "app-menu-search-panel";
  panel.id = id;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "app-menu-search-input";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", t("menu.search.label"));
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", `${id}-list`);
  input.setAttribute("aria-expanded", "true");
  input.placeholder = t("menu.search.placeholder");
  input.autocomplete = "off";
  const list = document.createElement("ul");
  list.className = "app-menu-search-list";
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("menu.search.label"));
  const status = document.createElement("div");
  status.className = "app-menu-search-status";
  status.setAttribute("role", "status");
  panel.append(input, list, status);

  let shown: SearchableEntry[] = [];
  let active = 0;
  let closed = false;

  const setActive = (index: number): void => {
    active = shown.length === 0 ? 0 : (index + shown.length) % shown.length;
    list.querySelectorAll<HTMLElement>('[role="option"]').forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === active));
    });
    const current = list.children[active];
    if (current) {
      input.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView?.({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const choose = (entry: SearchableEntry | undefined): void => {
    if (!entry) return;
    close();
    entry.item.run();
  };

  const render = (): void => {
    shown = matching(entries, input.value);
    list.replaceChildren(
      ...shown.map((entry, index) => {
        const option = document.createElement("li");
        option.id = `${id}-option-${index}`;
        option.className = "app-menu-search-option";
        option.setAttribute("role", "option");
        const group = document.createElement("span");
        group.className = "app-menu-search-group";
        group.textContent = entry.group;
        const label = document.createElement("span");
        label.className = "app-menu-search-label";
        label.textContent = entry.item.label;
        option.append(group, label);
        if (entry.item.hint) {
          const hint = document.createElement("kbd");
          hint.className = "app-menu-search-hint";
          hint.textContent = entry.item.hint;
          option.append(hint);
        }
        lifetime.listen(option, "click", () => choose(entry));
        lifetime.listen(option, "mousemove", () => {
          if (active !== index) setActive(index);
        });
        return option;
      }),
    );
    status.textContent = shown.length === 0 ? t("menu.search.none") : "";
    setActive(0);
  };

  function close(): void {
    if (closed) return;
    closed = true;
    lifetime.close();
    panel.remove();
    options.onClose();
  }

  lifetime.listen(input, "input", render);
  lifetime.listen(input, "keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive(active + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive(active - 1);
        break;
      case "Enter":
        event.preventDefault();
        choose(shown[active]);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        anchor.focus();
        break;
      case "Tab":
        close();
        break;
    }
  });
  // Un clic fuori dal pannello e dal suo pulsante lo chiude.
  lifetime.listen(document, "pointerdown", (event) => {
    const target = event.target instanceof Node ? event.target : null;
    if (target && (panel.contains(target) || anchor.contains(target))) return;
    close();
  });
  lifetime.add(() => panel.remove());

  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${Math.max(0, rect.left)}px`;
  panel.style.top = `${rect.bottom}px`;
  document.body.append(panel);
  render();
  input.focus();
  return close;
}
