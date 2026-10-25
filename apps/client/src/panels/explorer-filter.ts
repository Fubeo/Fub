// Filtrare l'esplora per percorso.
//
// Il campo sta sopra l'albero, sempre: è l'unico campo del pannello File, e
// il comando `shell.explorer.filter` gli dà il fuoco. Con del testo scritto l'albero cede il posto a un elenco piatto: ogni voce
// e cartella dello spazio il cui percorso intero contiene tutte le parole.
// Una parola col meno davanti (`-bozze`) toglie le voci che hanno un pezzo di
// percorso che la contiene: una cartella che corrisponde sparisce con tutto il
// suo contenuto. Fra virgolette una frase vale come una parola sola. La regola
// è in `state/path-filter.ts`, la stessa del pannello dei segnalibri.
//
// L'elenco viene dall'anagrafe del kernel, chiesto una volta per filtro e
// richiesto quando i documenti cambiano. Se ne disegna una finestra, e ciò che
// resta fuori si dice.
import { errorText } from "../host/errors";
import { emptyFilter, matchesPath, parsePathFilter, type PathFilter } from "../state/path-filter";
import { pageName } from "../rules/mirrored";
import { plural, t } from "../i18n/strings";
import { textField } from "../kit";
import type { Lifetime } from "../ui/lifetime";
import { Race } from "../ui/race";
import { setTooltip } from "../ui/tooltip";

export interface FilterEntry {
  path: string;
  kind: "folder" | "document" | "file";
}

/// Le voci che passano, in ordine di percorso.
export function filtered(filter: PathFilter, entries: readonly FilterEntry[]): FilterEntry[] {
  return entries
    .filter((entry) => matchesPath(filter, entry.path))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
}

const WINDOW = 200;

export interface ExplorerFilterOptions {
  lifetime: Lifetime;
  /// Il campo e l'elenco si mettono prima di questo elemento.
  before: HTMLElement;
  /// L'elenco prende il posto dell'albero (`true`) o glielo rende (`false`):
  /// chi possiede l'albero nasconde ciò che l'elenco copre.
  covering: (on: boolean) => void;
  /// Tutte le voci dello spazio corrente.
  entries: () => Promise<FilterEntry[]>;
  open: (entry: FilterEntry) => void;
}

export interface ExplorerFilter {
  /// Dà il fuoco al campo.
  show(): void;
  /// Toglie il testo e rende l'albero; il campo resta.
  hide(): void;
  /// I documenti sono cambiati: l'elenco si richiede alla prossima lettura.
  stale(): void;
  /// Se l'elenco filtrato è al posto dell'albero.
  active(): boolean;
}

export function mountExplorerFilter(options: ExplorerFilterOptions): ExplorerFilter {
  const { lifetime } = options;
  const box = document.createElement("div");
  box.className = "explorer-filter";
  const field = textField({
    label: t("explorer.filter"),
    labelHidden: true,
    placeholder: t("explorer.filter"),
    lifetime,
  });
  field.input.type = "search";
  box.append(field.element);
  const list = document.createElement("ul");
  list.className = "plain-list search-results";
  list.setAttribute("role", "list");
  list.hidden = true;
  options.before.before(box, list);

  const reads = new Race();
  let cached: Promise<FilterEntry[]> | null = null;
  let shown = WINDOW;
  let covering = false;

  const cover = (on: boolean): void => {
    if (covering === on) return;
    covering = on;
    options.covering(on);
  };

  const row = (entry: FilterEntry): HTMLLIElement => {
    const li = document.createElement("li");
    setTooltip(li, entry.path);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.dataset.path = entry.path;
    const title = document.createElement("span");
    title.className = "hit-title";
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    title.textContent = entry.kind === "document" ? pageName(entry.path) : entry.kind === "folder" ? `${name}/` : name;
    const path = document.createElement("span");
    path.className = "hit-path";
    path.textContent = entry.path;
    button.append(title, path);
    button.addEventListener("click", () => options.open(entry));
    li.append(button);
    return li;
  };

  const draw = (): Promise<void> =>
    reads.last(async (expected) => {
      const filter = parsePathFilter(field.input.value);
      if (emptyFilter(filter)) {
        list.hidden = true;
        list.replaceChildren();
        cover(false);
        return;
      }
      cached ??= options.entries();
      // L'errore diventa un valore prima del cancello: scaduto o no, lo decide
      // `expected`, e un rifiuto si dice nell'elenco invece di sparire.
      const read = await expected(
        cached.then(
          (entries) => ({ entries }),
          (error: unknown) => ({ error }),
        ),
      );
      if ("error" in read) {
        cached = null;
        const li = document.createElement("li");
        li.className = "hit-path";
        li.textContent = t("explorer.filter.failed", { reason: errorText(read.error) });
        list.replaceChildren(li);
        list.hidden = false;
        cover(true);
        return;
      }
      const hits = filtered(filter, read.entries);
      const items: HTMLElement[] = hits.slice(0, shown).map(row);
      if (hits.length === 0) {
        const li = document.createElement("li");
        li.className = "hit-path";
        li.textContent = t("explorer.filter.none");
        items.push(li);
      } else if (hits.length > shown) {
        const li = document.createElement("li");
        const more = document.createElement("button");
        more.type = "button";
        more.className = "search-result";
        more.textContent = plural(hits.length - shown, "explorer.filter.more.one", "explorer.filter.more");
        more.addEventListener("click", () => {
          shown += WINDOW;
          void draw();
        });
        li.append(more);
        items.push(li);
      }
      list.replaceChildren(...items);
      list.hidden = false;
      cover(true);
    });

  const buttons = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>("button.search-result")];

  lifetime.listen(field.input, "input", () => {
    shown = WINDOW;
    void draw();
  });
  lifetime.listen(field.input, "keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      // Vuoto, il campo non ha niente da togliere: Esc va a chi sta sopra
      // (il cassetto sul telefono, per esempio).
      if (field.input.value === "") return;
      event.preventDefault();
      event.stopPropagation();
      hide();
    } else if (event.key === "Enter") {
      event.preventDefault();
      buttons()[0]?.click();
    } else if (event.key === "ArrowDown") {
      const first = buttons()[0];
      if (!first) return;
      event.preventDefault();
      first.focus();
    }
  });
  // Fra i risultati le frecce passano da uno all'altro; dal primo si torna su,
  // al campo. Esc chiude il filtro anche da qui.
  lifetime.listen(list, "keydown", (event) => {
    const all = buttons();
    const at = all.indexOf(event.target as HTMLButtonElement);
    if (at === -1) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = at + (event.key === "ArrowDown" ? 1 : -1);
      if (next < 0) field.input.focus();
      else all[Math.min(next, all.length - 1)].focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  });

  const hide = (): void => {
    reads.cancel();
    field.input.value = "";
    shown = WINDOW;
    cached = null;
    list.hidden = true;
    list.replaceChildren();
    cover(false);
  };

  // Smontato col filtro aperto, l'albero torna visibile per il montaggio dopo.
  lifetime.add(() => {
    reads.cancel();
    box.remove();
    list.remove();
    cover(false);
  });

  return {
    show() {
      field.input.focus({ preventScroll: true });
      field.input.select();
    },
    hide,
    stale() {
      cached = null;
      if (!list.hidden) void draw();
    },
    active: () => covering,
  };
}
