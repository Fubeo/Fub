// Le impostazioni del tema: le voci che il tema montato dichiara, in una
// schermata sua accanto alla scelta del tema.
//
// Questa shell non sa da dove vengono le voci né dove si scrivono: lo sa una
// **sorgente** (`ThemeSettingsSource`), che chi compone la shell dichiara con
// `setThemeSettingsSource`. Di serie non ce n'è nessuna, e la schermata non
// c'è: un tema che non dichiara voci non lascia un riquadro vuoto.
//
// La schermata è un blocco solo, sempre lo stesso nodo, rimesso al suo posto a
// ogni riscrittura della vista. Le righe dentro sono sue: le ridisegna quando
// cambia ciò che la sorgente dice, non quando la vista ridisegna il resto.
import "./preferences.css";
import { errorText } from "../../../host/errors";
import { t } from "../../../i18n/strings";
import { isShortChoice, matchesTerms, normalizeSearch, searchTerms } from "../../../panels/settings-model";
import { THEME_KEY } from "../../../theme/theme";
import { openLifetime, type Lifetime, type Teardown } from "../../../ui/lifetime";
import { Race } from "../../../ui/race";
import { setTooltip } from "../../../ui/tooltip";
import { byId, follow } from "../frame/dom";
import { radioGroup } from "./radios";
import { rowFor, type Piece } from "./rows";

export type ThemeSettingKind =
  | { kind: "toggle"; default: boolean }
  | { kind: "choice"; default: string; options: { value: string; label: string }[] }
  | { kind: "number"; default: number; min: number; max: number; step?: number };

export interface ThemeSettingSpec {
  key: string;
  label: string;
  description?: string;
  kind: ThemeSettingKind;
}

export type ThemeSettingValue = boolean | string | number;

export interface ThemeSettings {
  themeId: string;
  themeName: string;
  entries: { spec: ThemeSettingSpec; value: ThemeSettingValue }[];
  /// Perché le voci adesso non si possono scrivere, in una frase già
  /// tradotta. Le voci si vedono col loro valore, e niente si scrive.
  locked?: string;
}

export interface ThemeSettingsSource {
  /// Le voci del tema montato, col valore corrente. Nessuna voce: la schermata non c'è.
  read(): Promise<ThemeSettings>;
  write(key: string, value: ThemeSettingValue): Promise<void>;
  reset(key: string): Promise<void>;
  /// Avvisa quando cambia il tema montato o un valore.
  subscribe(listener: () => void): Teardown;
}

/// Di serie: nessuna voce.
const NO_SOURCE: ThemeSettingsSource = {
  read: () => Promise.resolve({ themeId: "", themeName: "", entries: [] }),
  write: () => Promise.resolve(),
  reset: () => Promise.resolve(),
  subscribe: () => () => {},
};

let source: ThemeSettingsSource = NO_SOURCE;
const swapped = new Set<() => void>();

/**
 * Dichiara da dove vengono le voci del tema. Rende il modo di tornare alla
 * sorgente di prima, che vale solo finché questa è ancora quella in vigore.
 */
export function setThemeSettingsSource(next: ThemeSettingsSource): Teardown {
  const previous = source;
  source = next;
  for (const listener of [...swapped]) listener();
  return () => {
    if (source !== next) return;
    source = previous;
    for (const listener of [...swapped]) listener();
  };
}

interface Failure {
  message: string;
  /// Ciò che si era provato a scrivere: il controllo torna al valore di prima.
  input: string;
}

type Entry = ThemeSettings["entries"][number];

function node(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function shown(spec: ThemeSettingSpec, value: ThemeSettingValue): string {
  if (spec.kind.kind === "toggle") return t(value === true ? "settings.on" : "settings.off");
  if (spec.kind.kind === "choice") {
    return spec.kind.options.find((option) => option.value === value)?.label ?? String(value);
  }
  return String(value);
}

/**
 * Monta la schermata. Torna il gesto da ripetere a ogni riscrittura del corpo:
 * rimette il blocco accanto alla scelta del tema e gli applica il filtro in
 * vigore, senza ridisegnarlo.
 */
export function themeSettings(lifetime: Lifetime, panel: HTMLElement, body: HTMLElement): Piece {
  const block = node("div", "setting-row setting-block prefs-theme");
  block.setAttribute("role", "group");
  block.setAttribute("aria-labelledby", "prefs-theme-title");
  const head = node("div", "setting-text");
  const title = node("div", "setting-label");
  title.id = "prefs-theme-title";
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "4");
  const hint = node("div", "muted");
  // Uno stato, non un guasto: testo come il resto, e nessun annuncio.
  const lock = node("div", "muted");
  lock.id = "prefs-theme-locked";
  lock.hidden = true;
  head.append(title, hint, lock);
  const trouble = node("div", "setting-error");
  trouble.setAttribute("role", "alert");
  trouble.hidden = true;
  const list = node("div", "prefs-theme-entries");
  block.append(head, trouble, list);
  lifetime.add(() => block.remove());

  let current: ThemeSettings | null = null;
  let readFailure: string | null = null;
  const pending = new Set<string>();
  const failures = new Map<string, Failure>();
  const reads = new Race();
  lifetime.add(() => reads.cancel());

  const controlId = (key: string): string => `prefs-theme-${key}`;
  const locked = (): boolean => (current?.locked ?? "") !== "";

  /// Scrive o azzera una voce, e rilegge: il valore che si vede dopo è quello
  /// che la sorgente tiene, non quello che si è provato a scrivere.
  const commit = async (key: string, attempted: string, focus: string, action: () => Promise<void>): Promise<void> => {
    if (pending.has(key) || locked()) return;
    pending.add(key);
    failures.delete(key);
    draw();
    let failure: Failure | null = null;
    try {
      await action();
    } catch (error) {
      failure = { message: t("prefs.theme.not_changed", { reason: errorText(error) }), input: attempted };
    }
    if (lifetime.closed) return;
    pending.delete(key);
    if (failure) failures.set(key, failure);
    // Il controllo era spento durante l'attesa, e il fuoco è caduto: glielo
    // ridà il prossimo disegno, che è quello col valore riletto.
    refocus = { id: focus, key };
    await load();
  };

  /// Un controllo di una voce, detto in modo che sopravviva a un disegno: il
  /// suo id se ne ha uno, e la voce a cui appartiene.
  interface Stop {
    id: string;
    key: string;
  }

  /// Il nodo che adesso sta al posto di quel controllo: lo stesso id; se non
  /// c'è più (l'«azzera» di una voce tornata al predefinito) o non ne aveva
  /// (l'opzione di un gruppo), il controllo della voce. Di un gruppo, la
  /// scelta in vigore: è la sua sola fermata.
  const standIn = (stop: Stop): HTMLElement | null => {
    const same = stop.id === "" ? null : document.getElementById(stop.id);
    const target = (same !== null && list.contains(same) ? same : null) ?? document.getElementById(controlId(stop.key));
    if (target?.getAttribute("role") !== "radiogroup") return target;
    return target.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? target.querySelector<HTMLElement>('[role="radio"]');
  };

  /// Il fuoco da ridare dopo una scrittura: al controllo che l'ha chiesta.
  /// Solo se nel frattempo la persona non è andata altrove.
  let refocus: Stop | null = null;
  const giveFocusBack = (): void => {
    if (refocus === null || pending.has(refocus.key)) return;
    const stop = refocus;
    refocus = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    standIn(stop)?.focus({ preventScroll: true });
  };

  const toggle = (entry: Entry, id: string): HTMLElement => {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "setting-switch";
    input.setAttribute("role", "switch");
    input.id = id;
    input.checked = entry.value === true;
    // Un interruttore si commuta anche con Invio, non solo con lo Spazio.
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || input.disabled) return;
      event.preventDefault();
      input.click();
    });
    input.addEventListener("change", () => {
      const next = input.checked;
      void commit(entry.spec.key, shown(entry.spec, next), id, () => source.write(entry.spec.key, next));
    });
    return input;
  };

  const choice = (entry: Entry, id: string, kind: Extract<ThemeSettingKind, { kind: "choice" }>): HTMLElement => {
    const value = String(entry.value);
    const write = (next: string, label: string): void => {
      void commit(entry.spec.key, label, id, () => source.write(entry.spec.key, next));
    };
    // Un valore fuori dalle scelte resta visibile solo in una tendina: in un
    // gruppo nessun bottone risulterebbe acceso.
    if (isShortChoice(kind.options) && kind.options.some((option) => option.value === value)) {
      const group = node("div", "segmented segmented--wide setting-segmented");
      group.id = id;
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-labelledby", `${id}-label`);
      for (const option of kind.options) {
        const radio = document.createElement("button");
        radio.type = "button";
        radio.className = "segmented-option";
        radio.setAttribute("role", "radio");
        radio.setAttribute("aria-checked", String(option.value === value));
        radio.dataset.choice = option.value;
        radio.textContent = option.label || option.value;
        group.append(radio);
      }
      // Il gruppo muore col prossimo disegno: i suoi ascolti con lui.
      const own = openLifetime();
      owned.push(own);
      radioGroup(own, group, (radio) => write(radio.dataset.choice ?? "", radio.textContent ?? "")).settle();
      return group;
    }
    const select = document.createElement("select");
    select.className = "setting-select";
    select.id = id;
    const options = kind.options.some((option) => option.value === value)
      ? kind.options
      : [{ value, label: value }, ...kind.options];
    for (const option of options) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label || option.value;
      select.append(item);
    }
    select.value = value;
    select.addEventListener("change", () => {
      write(select.value, select.selectedOptions[0]?.textContent ?? select.value);
    });
    return select;
  };

  const number = (entry: Entry, id: string, kind: Extract<ThemeSettingKind, { kind: "number" }>): HTMLElement => {
    const wrap = node("div", "setting-range");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "setting-slider";
    slider.id = `${id}-range`;
    const field = document.createElement("input");
    field.type = "number";
    field.className = "setting-number";
    field.id = id;
    for (const input of [slider, field]) {
      input.min = String(kind.min);
      input.max = String(kind.max);
      input.value = String(entry.value);
    }
    slider.step = String(kind.step ?? 1);
    field.step = "any";
    const name = node("label", "sr-only", entry.spec.label) as HTMLLabelElement;
    name.htmlFor = slider.id;
    const write = (raw: string, from: string): void => {
      if (raw.trim() === "" || !Number.isFinite(Number(raw))) return;
      void commit(entry.spec.key, raw, from, () => source.write(entry.spec.key, Number(raw)));
    };
    // Il cursore scrive al rilascio; mentre si trascina, il campo dice dove si è.
    slider.addEventListener("input", () => {
      field.value = slider.value;
    });
    slider.addEventListener("change", () => write(slider.value, slider.id));
    field.addEventListener("change", () => write(field.value, field.id));
    wrap.append(name, slider, field);
    return wrap;
  };

  // I gruppi di scelta disegnati adesso: si chiudono al prossimo disegno.
  let owned: Lifetime[] = [];

  const entryRow = (entry: Entry, themeName: string): HTMLElement => {
    const { spec } = entry;
    const id = controlId(spec.key);
    const busy = pending.has(spec.key);
    const failure = failures.get(spec.key);
    const modified = entry.value !== spec.kind.default;

    const row = node("div", "setting-row prefs-theme-entry");
    row.dataset.themeSetting = spec.key;
    row.dataset.search = normalizeSearch(`${spec.label} ${spec.description ?? ""} ${spec.key} ${themeName}`);
    if (modified) row.dataset.modified = "true";
    if (busy) row.setAttribute("aria-busy", "true");

    const text = node("div", "setting-text");
    const label = node("label", "", spec.label) as HTMLLabelElement;
    label.removeAttribute("class");
    label.htmlFor = id;
    label.id = `${id}-label`;
    text.append(label);
    const described: string[] = [];
    if (spec.description) {
      const description = node("div", "muted setting-description", spec.description);
      description.id = `${id}-desc`;
      described.push(description.id);
      text.append(description);
    }
    if (modified) {
      const meta = node("div", "setting-meta");
      meta.append(node("div", "setting-default", t("settings.default", { value: shown(spec, spec.kind.default) })));
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "link-button setting-reset";
      reset.id = `${id}-reset`;
      reset.textContent = t("settings.reset");
      setTooltip(reset, t("settings.reset.hint"));
      reset.addEventListener("click", () => {
        void commit(spec.key, "", reset.id, () => source.reset(spec.key));
      });
      meta.append(reset);
      text.append(meta);
    }
    if (busy) {
      const waiting = node("div", "setting-pending", t("save.saving"));
      waiting.setAttribute("role", "status");
      text.append(waiting);
    }

    const control = node("div", "setting-control");
    const kind = spec.kind;
    control.append(
      kind.kind === "toggle" ? toggle(entry, id) : kind.kind === "choice" ? choice(entry, id, kind) : number(entry, id, kind),
    );
    // L'esito di una scrittura rifiutata sta sotto il controllo che l'ha chiesta.
    if (failure && !busy) {
      const box = node("div", "setting-error");
      box.id = `${id}-error`;
      box.setAttribute("role", "alert");
      box.append(node("div", "setting-error-message", failure.message));
      if (failure.input !== "") box.append(node("div", "setting-attempted", failure.input));
      control.append(box);
      described.push(box.id);
    }
    row.append(text, control);
    // Chi arriva su un controllo spento sente perché lo è.
    if (locked()) described.push(lock.id);
    for (const focusable of row.querySelectorAll<HTMLElement>("input, select, [role=radiogroup], .setting-reset")) {
      if (described.length > 0) focusable.setAttribute("aria-describedby", described.join(" "));
    }
    if (busy || locked()) {
      for (const field of row.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) {
        field.disabled = true;
      }
      for (const group of row.querySelectorAll('[role="radiogroup"]')) group.setAttribute("aria-disabled", "true");
    }
    return row;
  };

  /// Il filtro della vista, applicato alle voci appena disegnate: la vista lo
  /// applica da sé a ogni battuta nella ricerca (le voci portano `data-search`
  /// come le sue righe), ma ha già finito quando questo blocco torna al suo
  /// posto.
  const filter = (): void => {
    if (!block.isConnected) return;
    const terms = searchTerms(byId<HTMLInputElement>("settings-search")?.value ?? "");
    const modifiedOnly = byId("settings-modified")?.getAttribute("aria-pressed") === "true";
    let visible = 0;
    for (const row of list.querySelectorAll<HTMLElement>(":scope > [data-search]")) {
      const matches = (!modifiedOnly || row.dataset.modified === "true") && matchesTerms(row.dataset.search ?? "", terms);
      if (row.hidden === matches) row.hidden = !matches;
      if (matches) visible += 1;
    }
    settle(visible);
  };

  /// Senza una voce in vista il blocco non lascia il suo titolo da solo; con
  /// una in vista, la sezione che lo contiene si vede anche se nessuna riga
  /// della vista passa il filtro.
  const settle = (visible: number): void => {
    const empty = visible === 0 && readFailure === null;
    if (block.hidden !== empty) block.hidden = empty;
    if (empty) return;
    const section = block.closest<HTMLElement>(".settings-section");
    if (section?.hidden) section.hidden = false;
    body.querySelector(":scope > .settings-empty")?.remove();
  };

  function draw(): void {
    // Le voci si riscrivono tutte: chi aveva il fuoco lo ritrova sul nodo che
    // prende il suo posto. Una rilettura arriva anche da sola, a ogni segnale
    // della sorgente, e non deve togliere il fuoco a chi sta scegliendo.
    const active = document.activeElement;
    const held: Stop | null = active instanceof HTMLElement && list.contains(active)
      ? { id: active.id, key: active.closest<HTMLElement>("[data-theme-setting]")?.dataset.themeSetting ?? "" }
      : null;
    for (const own of owned) own.close();
    owned = [];
    const entries = current?.entries ?? [];
    const name = current?.themeName ?? "";
    title.textContent = t("prefs.theme.title", { theme: name });
    title.hidden = name === "";
    hint.textContent = t("prefs.theme.hint");
    hint.hidden = entries.length === 0;
    lock.textContent = current?.locked ?? "";
    lock.hidden = !locked();
    trouble.textContent = readFailure === null ? "" : t("prefs.theme.read_failed", { reason: readFailure });
    trouble.hidden = readFailure === null;
    list.replaceChildren(...entries.map((entry) => entryRow(entry, name)));
    place();
    // Su un controllo spento per l'attesa il fuoco non si posa: lo riprende il
    // disegno dopo l'esito.
    if (held !== null) standIn(held)?.focus({ preventScroll: true });
    giveFocusBack();
  }

  /// Accanto alla scelta del tema: dopo il catalogo dei temi quando c'è, sennò
  /// dopo la riga della luce.
  function place(): boolean {
    const anchor = body.querySelector("[data-theme-id]")?.closest<HTMLElement>(".setting-block") ?? rowFor(body, THEME_KEY);
    const wanted = (current?.entries.length ?? 0) > 0 || readFailure !== null;
    if (!anchor || !wanted) {
      if (block.isConnected) block.remove();
      return false;
    }
    const placed = block.previousElementSibling !== anchor;
    if (placed) anchor.after(block);
    filter();
    return placed;
  }

  async function load(): Promise<void> {
    await reads.last(async (expected) => {
      // Il guasto diventa un valore prima del cancello: una lettura scaduta
      // non scrive, né riuscita né fallita.
      const outcome = await expected(
        (async () => source.read())().then(
          (settings) => ({ settings, failure: null }),
          (error: unknown) => ({ settings: null, failure: errorText(error) }),
        ),
      );
      if (lifetime.closed) return;
      if (outcome.settings === null) {
        readFailure = outcome.failure;
      } else {
        // Un altro tema: gli esiti di prima parlavano di voci che non ci sono più.
        if (outcome.settings.themeId !== current?.themeId) failures.clear();
        current = outcome.settings;
        readFailure = null;
      }
      draw();
    });
  }

  let unsubscribe: Teardown = () => {};
  const listen = (): void => {
    unsubscribe();
    current = null;
    readFailure = null;
    failures.clear();
    pending.clear();
    unsubscribe = source.subscribe(() => void load());
    void load();
  };
  swapped.add(listen);
  lifetime.add(() => {
    swapped.delete(listen);
    unsubscribe();
    for (const own of owned) own.close();
  });
  listen();

  // La vista nasconde le voci a ogni battuta nella ricerca: il blocco le segue.
  if (typeof MutationObserver !== "undefined") {
    const hidden = new MutationObserver(() => {
      settle(list.querySelectorAll(":scope > [data-search]:not([hidden])").length);
    });
    hidden.observe(list, { attributes: true, attributeFilter: ["hidden"], subtree: true });
    lifetime.add(() => hidden.disconnect());
  }
  // Riaperte le preferenze, si rilegge: il tema può essere cambiato da fuori.
  follow(lifetime, panel, () => {
    if (!panel.hidden) void load();
  }, { attributes: ["hidden"] });

  return place;
}
