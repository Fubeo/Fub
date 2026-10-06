// La verifica dell'accessibilità come pannello (livello Standard): i problemi
// del disegno, ciascuno con il suo oggetto e la sua correzione, e l'ordine in
// cui uno screen reader incontra gli oggetti. Che cosa mostra lo decide
// `audit.ts`; qui c'è come.
//
// - **Due sezioni che si chiudono**, «Problemi» e «Ordine di lettura», coi
//   `details` del browser: si aprono e si chiudono anche con la tastiera, e
//   lo screen reader dice se sono aperte.
// - **Un problema è una riga con dei pulsanti.** Il nome dell'oggetto porta
//   all'oggetto: lo sceglie e lo mostra. La correzione si fa in un passo
//   solo, che si annulla, e il pulsante dice che cosa farà: il colore con il
//   suo campione e il contrasto che avrà, il corpo in pixel. Mai il solo
//   colore: la gravità è un'icona e una parola.
// - **Il fuoco resta dove si lavora.** Dopo una correzione la riga se ne va,
//   e il fuoco passa alla riga che prende il suo posto, sullo stesso genere
//   di pulsante: i problemi si correggono uno dopo l'altro con Invio.
// - **Una descrizione si scrive nella riga.** «Descrivi…» apre il campo
//   accanto all'immagine: Invio la scrive come suo titolo, ciò che lo screen
//   reader dice; Esc lascia com'era, e uscire dal campo la scrive anche lui.
//   «Decorativa» dice allo screen reader di saltarla.
// - **L'ordine di lettura è un albero ARIA piatto**, coi livelli in
//   `aria-level`. Le frecce muovono la riga attiva senza sceglierla; Invio o
//   un clic scelgono l'oggetto sul foglio. Alt+↑ e Alt+↓ lo spostano fra i
//   suoi vicini, come «Leggi prima» e «Leggi dopo» sotto l'elenco. Uno
//   spostamento che cambierebbe anche ciò che si vede sopra la prima volta lo
//   dice, e la seconda lo fa.
// - **Tanti problemi e tanti oggetti.** I problemi si mostrano cento alla
//   volta, con il pulsante per gli altri; l'ordine di lettura disegna le righe
//   che si vedono, come la cronologia.

import { resolvedLanguage } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { plural, t, type DrawKey } from "../strings";
import type { Problem, ReadingRow } from "./audit";
import { cleanName, NAME_MAX } from "./naming";
import { ROW_PX } from "./objects";

/// I problemi che si mostrano alla volta.
const PAGE = 100;

/// Le righe disegnate oltre quelle che si vedono, sopra e sotto.
const OVERSCAN = 8;

/// Le icone della gravità, col costrutto di `ui/icons.ts`: il triangolo
/// dell'avviso e il cerchio della nota.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-access-warning": ["M12 3.5L21.5 20H2.5z", "M12 9.5V14", "M12 17v.01"],
  "draw-access-info": ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 11v5.5", "M12 7.5v.01"],
};

/// Ciò che il pannello mostra.
export interface AccessView {
  readonly problems: readonly Problem[];
  readonly reading: readonly ReadingRow[];
  /// Il nome a parole dell'oggetto `key`, come nell'albero.
  nameOf(key: string): string;
  /// L'oggetto scelto da solo sul foglio: la riga attiva dell'ordine di
  /// lettura lo segue.
  readonly selected: string | null;
  /// Falso in sola lettura: i problemi si guardano soltanto.
  readonly editable: boolean;
}

export interface AccessPanelOptions {
  /// Sceglie l'oggetto `key` e lo mostra.
  onGo(key: string): void;
  /// Applica la correzione di `problem`: un colore, un corpo, il titolo.
  onFix(problem: Problem): void;
  /// Scrive la descrizione `text` dell'immagine `key`, già pulita.
  onDescribe(key: string, text: string): void;
  /// Dichiara decorativa l'immagine `key`.
  onDecorative(key: string): void;
  /// Sposta l'oggetto `key` nell'ordine di lettura, dopo il vicino seguente
  /// se `later`. Senza `confirmed`, se lo spostamento cambierebbe anche ciò
  /// che si vede sopra, non lo fa e rende l'avviso.
  onMove(key: string, later: boolean, confirmed: boolean): string | null;
  /// Esc: il fuoco torna al foglio.
  onLeave(): void;
}

export interface AccessPanel {
  readonly element: HTMLElement;
  update(view: AccessView): void;
  /// Il fuoco va al primo problema, o all'ordine di lettura se non ce ne
  /// sono.
  focus(): void;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

/// Il titolo breve di un problema.
function titleOf(problem: Problem): DrawKey {
  switch (problem.code) {
    case "S001":
      return "draw.access.S001";
    case "S009":
      return problem.role === "stroke" ? "draw.access.S009.stroke" : "draw.access.S009.text";
    case "S012":
      return "draw.access.S012";
    case "S013":
      return "draw.access.S013";
  }
}

export function createAccessPanel(life: Lifetime, options: AccessPanelOptions): AccessPanel {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("section");
  element.className = "draw-access";
  element.id = identifier("draw-access");
  const header = document.createElement("div");
  header.className = "draw-access-header";
  const heading = document.createElement("h2");
  heading.className = "draw-access-title";
  heading.id = identifier("draw-access-title");
  heading.tabIndex = -1;
  const counter = document.createElement("span");
  counter.className = "draw-access-count";
  header.append(heading, counter);
  element.setAttribute("aria-labelledby", heading.id);

  // I problemi.
  const problemsSection = document.createElement("details");
  problemsSection.className = "draw-access-section";
  problemsSection.open = true;
  const problemsSummary = document.createElement("summary");
  problemsSummary.className = "draw-access-summary";
  const readOnlyNote = document.createElement("p");
  readOnlyNote.className = "draw-access-note";
  const empty = document.createElement("p");
  empty.className = "draw-access-empty";
  const list = document.createElement("ul");
  list.className = "draw-access-list";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "draw-button draw-access-more";
  problemsSection.append(problemsSummary, readOnlyNote, empty, list, more);

  // L'ordine di lettura.
  const readingSection = document.createElement("details");
  readingSection.className = "draw-access-section draw-access-reading";
  readingSection.open = true;
  const readingSummary = document.createElement("summary");
  readingSummary.className = "draw-access-summary";
  const readingHint = document.createElement("p");
  readingHint.className = "draw-access-note";
  readingHint.id = identifier("draw-access-hint");
  const scroller = document.createElement("div");
  scroller.className = "draw-access-scroll";
  const tree = document.createElement("div");
  tree.className = "draw-access-tree";
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-describedby", readingHint.id);
  tree.tabIndex = 0;
  scroller.append(tree);
  const warning = document.createElement("p");
  warning.className = "draw-access-warning";
  warning.hidden = true;
  const moves = document.createElement("div");
  moves.className = "draw-access-moves";
  const earlier = document.createElement("button");
  earlier.type = "button";
  earlier.className = "draw-button";
  const later = document.createElement("button");
  later.type = "button";
  later.className = "draw-button";
  moves.append(earlier, later);
  readingSection.append(readingSummary, readingHint, scroller, warning, moves);
  element.append(header, problemsSection, readingSection);

  let view: AccessView | null = null;
  let shown = PAGE;
  /// La firma dei problemi disegnati: si ridisegnano quando cambia.
  let drawn = "";
  /// La descrizione in scrittura: l'immagine e il campo.
  let describing: { readonly key: string; readonly field: HTMLInputElement } | null = null;

  const editable = (): boolean => view?.editable ?? false;
  const nameOf = (key: string | null): string => (key === null || view === null ? (key ?? "") : view.nameOf(key));
  let numbers: { readonly language: string; readonly format: Intl.NumberFormat } | null = null;
  const number = (value: number): string => {
    const language = resolvedLanguage();
    if (numbers?.language !== language) numbers = { language, format: new Intl.NumberFormat(language, { maximumFractionDigits: 2, useGrouping: false }) };
    return numbers.format.format(value);
  };

  /// Il dettaglio di un problema, a parole.
  const detailOf = (problem: Problem): string => {
    const measured = problem.detail === null ? NaN : Number(problem.detail);
    switch (problem.code) {
      case "S001":
        return t("draw.access.S001.detail");
      case "S009":
        return t("draw.access.S009.detail", { ratio: number(measured), need: number(problem.threshold ?? 3) });
      case "S012":
        return t("draw.access.S012.detail");
      case "S013":
        return t("draw.access.S013.detail", { size: number(measured) });
    }
  };

  // --- I problemi ---------------------------------------------------------------

  const button = (text: string, action: string, label: string | null = null): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-button draw-access-action";
    control.dataset.action = action;
    control.textContent = text;
    if (label !== null) control.setAttribute("aria-label", label);
    return control;
  };

  /// I pulsanti della correzione di un problema: nessuno in sola lettura.
  const fixesOf = (problem: Problem): HTMLElement[] => {
    const fix = problem.fix;
    if (fix === null || !editable()) return [];
    switch (fix.kind) {
      case "title":
        return [button(t("draw.access.fix.title"), "fix")];
      case "color": {
        const ratio = number(Math.floor(fix.ratio * 100) / 100);
        const control = button("", "fix", t("draw.access.fix.color.label", { color: fix.color, ratio }));
        const swatch = document.createElement("span");
        swatch.className = "draw-access-swatch";
        swatch.style.background = fix.color;
        swatch.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.textContent = t("draw.access.fix.color", { color: fix.color, ratio });
        control.append(swatch, text);
        return [control];
      }
      case "size":
        return [button(t("draw.access.fix.size"), "fix", t("draw.access.fix.size.label", { size: number(fix.size) }))];
      case "describe":
        if (problem.key === null) return [];
        if (describing?.key === problem.key) return [describing.field];
        return [button(t("draw.access.fix.describe"), "describe"), button(t("draw.access.fix.decorative"), "decorative", t("draw.access.fix.decorative.label"))];
    }
  };

  /// I pulsanti di una riga: l'oggetto e la correzione.
  const actionsOf = (problem: Problem, at: number): HTMLElement[] => {
    const out: HTMLElement[] = [];
    if (problem.key !== null) {
      const go = button(nameOf(problem.key), "go", t("draw.access.go", { name: nameOf(problem.key) }));
      go.classList.add("draw-access-object");
      go.title = t("draw.access.go", { name: nameOf(problem.key) });
      out.push(go);
    }
    out.push(...fixesOf(problem));
    for (const each of out) each.dataset.index = String(at);
    return out;
  };

  const rowOf = (problem: Problem, at: number): HTMLLIElement => {
    const item = document.createElement("li");
    item.className = "draw-access-problem";
    item.dataset.severity = problem.severity;
    item.dataset.index = String(at);
    const glyph = iconEl(problem.severity === "info" ? "draw-access-info" : "draw-access-warning");
    const mark = document.createElement("span");
    mark.className = "draw-access-glyph";
    mark.setAttribute("aria-hidden", "true");
    if (glyph !== null) mark.append(glyph);
    const text = document.createElement("div");
    text.className = "draw-access-text";
    const what = document.createElement("span");
    what.className = "draw-access-what";
    // La gravità a parole, prima del titolo: la dice anche lo screen reader.
    const severity = document.createElement("span");
    severity.className = "draw-access-severity";
    severity.textContent = t(problem.severity === "info" ? "draw.access.severity.info" : "draw.access.severity.warning");
    what.append(severity, document.createTextNode(t(titleOf(problem))));
    const detail = document.createElement("span");
    detail.className = "draw-access-detail";
    detail.textContent = detailOf(problem);
    text.append(what, detail);
    const actions = document.createElement("div");
    actions.className = "draw-access-actions";
    actions.append(...actionsOf(problem, at));
    item.append(mark, text, actions);
    return item;
  };

  /// Ridisegna i problemi. Il fuoco che stava su un pulsante di una riga va
  /// sulla riga che ora ha il suo posto, sullo stesso genere di pulsante.
  const renderProblems = (force: boolean): void => {
    const problems = view?.problems ?? [];
    const signature = `${editable()}|${shown}|${describing?.key ?? ""}|${problems
      .slice(0, shown)
      .map((problem) => `${problem.code}:${problem.key}:${problem.detail}:${problem.fix === null ? "" : JSON.stringify(problem.fix)}:${nameOf(problem.key)}`)
      .join("\n")}`;
    counter.textContent = problems.length === 0 ? t("draw.access.count.none") : plural(problems.length, "draw.access.count.one", "draw.access.count.other");
    empty.hidden = problems.length > 0;
    readOnlyNote.hidden = view === null || editable() || problems.length === 0;
    more.hidden = problems.length <= shown;
    // Anche nascosto ha il suo nome: un pulsante senza nome non c'è mai.
    more.textContent = t("draw.access.more", { count: Math.max(0, Math.min(PAGE, problems.length - shown)), total: problems.length });
    if (!force && signature === drawn) return;
    drawn = signature;
    const active = document.activeElement;
    const had = active instanceof HTMLElement && list.contains(active) && active !== describing?.field ? { index: Number(active.dataset.index), action: active.dataset.action ?? "go" } : null;
    list.replaceChildren(...problems.slice(0, shown).map((problem, at) => rowOf(problem, at)));
    if (had === null) return;
    const rows = list.children;
    if (rows.length === 0) {
      heading.focus({ preventScroll: true });
      return;
    }
    // Lo stesso pulsante; se la riga non l'ha, chi correggeva trova la sua
    // correzione, qualunque sia.
    const row = rows[Math.min(had.index, rows.length - 1)]!;
    const target =
      row.querySelector<HTMLElement>(`[data-action="${had.action}"]`) ??
      (had.action === "go" ? null : row.querySelector<HTMLElement>('[data-action]:not([data-action="go"])')) ??
      row.querySelector<HTMLElement>("button, input");
    target?.focus({ preventScroll: true });
  };

  /// Apre il campo della descrizione dell'immagine `key`.
  const startDescribing = (key: string): void => {
    const field = document.createElement("input");
    field.type = "text";
    field.className = "draw-access-describe";
    field.autocomplete = "off";
    field.maxLength = NAME_MAX;
    field.placeholder = t("draw.access.describe.placeholder");
    field.setAttribute("aria-label", t("draw.access.describe.label", { name: nameOf(key) }));
    describing = { key, field };
    life.listen(field, "keydown", (event) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finishDescribing(event.key === "Enter");
    });
    // Uscire dal campo scrive la descrizione; passare a un'altra finestra
    // no, e al ritorno il campo è ancora lì.
    life.listen(field, "blur", () => {
      if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
      finishDescribing(true, false);
    });
    renderProblems(true);
    field.focus({ preventScroll: true });
  };

  /// Chiude il campo della descrizione; se `write`, la descrizione scritta
  /// vale. Con `refocus` il fuoco torna sulla riga.
  const finishDescribing = (write: boolean, refocus = true): void => {
    if (describing === null) return;
    const { key, field } = describing;
    describing = null;
    const text = cleanName(field.value);
    const index = [...list.children].findIndex((row) => row.contains(field));
    renderProblems(true);
    if (refocus) {
      const row = list.children[index];
      row?.querySelector<HTMLElement>('[data-action="describe"]')?.focus({ preventScroll: true });
    }
    if (write && text !== "") options.onDescribe(key, text);
  };

  life.listen(list, "click", (event) => {
    const control = event.target instanceof Element ? event.target.closest<HTMLElement>("button[data-action]") : null;
    const problem = control === null ? undefined : view?.problems[Number(control.dataset.index)];
    if (control === null || problem === undefined) return;
    switch (control.dataset.action) {
      case "go":
        if (problem.key !== null) options.onGo(problem.key);
        break;
      case "fix":
        options.onFix(problem);
        break;
      case "describe":
        if (problem.key !== null) startDescribing(problem.key);
        break;
      case "decorative":
        if (problem.key !== null) options.onDecorative(problem.key);
        break;
    }
  });
  life.listen(more, "click", () => {
    const first = shown;
    shown += PAGE;
    renderProblems(true);
    list.children[first]?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  });

  // --- L'ordine di lettura -------------------------------------------------------

  const prefix = identifier("draw-access-row");
  let rendered = new Map<string, HTMLElement>();
  let active: string | null = null;
  /// L'oggetto scelto all'ultimo `update`: quando cambia, la riga attiva lo
  /// segue.
  let followed: string | null = null;
  /// Lo spostamento che ha appena avvisato: ripetuto, si fa.
  let pending: { readonly key: string; readonly later: boolean } | null = null;

  const rows = (): readonly ReadingRow[] => view?.reading ?? [];
  const indexOf = (key: string | null): number => (key === null ? -1 : rows().findIndex((row) => row.node.key === key));
  const rowId = (key: string): string => `${prefix}-${encodeURIComponent(key).replace(/%/g, "_")}`;
  const movable = (row: ReadingRow | undefined, toLater: boolean): boolean =>
    row !== undefined && editable() && row.node.item.role !== "layer" && !(toLater ? row.last : row.first);

  const paintRow = (item: HTMLElement, row: ReadingRow, index: number): void => {
    const key = row.node.key;
    item.className = "draw-access-row";
    item.setAttribute("role", "treeitem");
    item.id = rowId(key);
    item.dataset.index = String(index);
    item.setAttribute("aria-level", String(row.depth + 1));
    item.setAttribute("aria-selected", String(key === active));
    if (row.node.children.length > 0) item.setAttribute("aria-expanded", "true");
    else item.removeAttribute("aria-expanded");
    item.toggleAttribute("data-active", key === active);
    item.style.top = `${index * ROW_PX}px`;
    item.style.height = `${ROW_PX}px`;
    item.style.paddingInlineStart = `calc(var(--space-3) + ${row.depth} * 1em)`;
    const text = nameOf(key);
    if (item.textContent !== text) item.textContent = text;
    if (item.title !== text) item.title = text;
  };

  const windowOf = (): number[] => {
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_PX) - OVERSCAN);
    const visible = Math.ceil((scroller.clientHeight || ROW_PX * 8) / ROW_PX);
    const last = Math.min(rows().length - 1, first + visible + 2 * OVERSCAN);
    const indices: number[] = [];
    for (let index = first; index <= last; index++) indices.push(index);
    const at = indexOf(active);
    if (at >= 0 && (at < first || at > last)) indices.push(at);
    return indices;
  };

  const renderTree = (): void => {
    const all = rows();
    tree.style.height = `${all.length * ROW_PX}px`;
    const next = new Map<string, HTMLElement>();
    const nodes = windowOf().map((index) => {
      const row = all[index]!;
      const item = rendered.get(row.node.key) ?? document.createElement("div");
      paintRow(item, row, index);
      next.set(row.node.key, item);
      return item;
    });
    for (const [key, item] of rendered) if (!next.has(key)) item.remove();
    rendered = next;
    let cursor = tree.firstElementChild;
    for (const node of nodes) {
      if (cursor === node) {
        cursor = node.nextElementSibling;
        continue;
      }
      tree.insertBefore(node, cursor);
    }
    if (active === null || !next.has(active)) tree.removeAttribute("aria-activedescendant");
    else tree.setAttribute("aria-activedescendant", rowId(active));
    const row = all[indexOf(active)];
    earlier.disabled = !movable(row, false);
    later.disabled = !movable(row, true);
  };

  const reveal = (): void => {
    const index = indexOf(active);
    if (index < 0) return;
    const top = index * ROW_PX;
    const height = scroller.clientHeight;
    const before = scroller.scrollTop;
    if (top < before) scroller.scrollTop = top;
    else if (height > 0 && top + ROW_PX > before + height) scroller.scrollTop = top + ROW_PX - height;
    if (scroller.scrollTop !== before) renderTree();
  };

  const setWarning = (text: string | null): void => {
    warning.hidden = text === null;
    warning.textContent = text ?? "";
  };

  const moveTo = (index: number): void => {
    const all = rows();
    if (all.length === 0) return;
    active = all[Math.max(0, Math.min(all.length - 1, index))]!.node.key;
    pending = null;
    setWarning(null);
    renderTree();
    reveal();
  };

  /// Sposta l'oggetto della riga attiva nell'ordine di lettura.
  const move = (toLater: boolean): void => {
    const row = rows()[indexOf(active)];
    if (row === undefined || !movable(row, toLater)) return;
    const key = row.node.key;
    const confirmed = pending !== null && pending.key === key && pending.later === toLater;
    const said = options.onMove(key, toLater, confirmed);
    pending = said === null ? null : { key, later: toLater };
    setWarning(said);
  };

  const page = (): number => Math.max(1, Math.floor((scroller.clientHeight || ROW_PX * 8) / ROW_PX) - 1);

  life.listen(tree, "keydown", (event) => {
    if (event.target !== tree || event.ctrlKey || event.metaKey) return;
    const at = indexOf(active);
    if (event.altKey) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      move(event.key === "ArrowDown");
    } else {
      switch (event.key) {
        case "ArrowDown":
          moveTo(at + 1);
          break;
        case "ArrowUp":
          moveTo(at - 1);
          break;
        case "PageDown":
          moveTo(at + page());
          break;
        case "PageUp":
          moveTo(at - page());
          break;
        case "Home":
          moveTo(0);
          break;
        case "End":
          moveTo(rows().length - 1);
          break;
        case "Enter":
        case " ":
          if (active !== null) options.onGo(active);
          break;
        case "Escape":
          options.onLeave();
          break;
        default:
          return;
      }
    }
    event.preventDefault();
    // L'editor non deve vedere il tasto: le frecce, qui, non spostano il
    // foglio.
    event.stopPropagation();
  });
  life.listen(tree, "click", (event) => {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>(".draw-access-row") : null;
    const row = item === null ? undefined : rows()[Number(item.dataset.index)];
    if (row === undefined) return;
    tree.focus({ preventScroll: true });
    active = row.node.key;
    pending = null;
    setWarning(null);
    renderTree();
    options.onGo(row.node.key);
  });
  life.listen(scroller, "scroll", () => renderTree());
  life.listen(earlier, "click", () => move(false));
  life.listen(later, "click", () => move(true));
  // Esc fuori da un campo riporta al foglio, come negli altri pannelli.
  life.listen(element, "keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.target === tree) return;
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    event.stopPropagation();
    options.onLeave();
  });

  const relabel = (): void => {
    heading.textContent = t("draw.access");
    problemsSummary.textContent = t("draw.access.problems");
    readOnlyNote.textContent = t("draw.access.read_only");
    empty.textContent = t("draw.access.empty");
    readingSummary.textContent = t("draw.access.reading");
    readingHint.textContent = t("draw.access.reading.hint");
    tree.setAttribute("aria-label", t("draw.access.reading"));
    earlier.textContent = t("draw.access.earlier");
    earlier.setAttribute("aria-keyshortcuts", "Alt+ArrowUp");
    later.textContent = t("draw.access.later");
    later.setAttribute("aria-keyshortcuts", "Alt+ArrowDown");
    if (describing !== null) {
      describing.field.placeholder = t("draw.access.describe.placeholder");
      describing.field.setAttribute("aria-label", t("draw.access.describe.label", { name: nameOf(describing.key) }));
    }
    for (const item of rendered.values()) item.removeAttribute("title");
    renderProblems(true);
    renderTree();
  };
  relabel();

  return {
    element,
    update(next) {
      const before = view;
      view = next;
      // La descrizione in scrittura resta finché la sua immagine ha il
      // problema; il resto si ridisegna.
      if (describing !== null && !next.problems.some((problem) => problem.code === "S012" && problem.key === describing!.key)) {
        const { field } = describing;
        describing = null;
        if (document.activeElement === field) heading.focus({ preventScroll: true });
      }
      if (before?.problems !== next.problems && next.problems.length <= PAGE) shown = PAGE;
      renderProblems(false);
      if (next.selected !== followed) {
        followed = next.selected;
        if (next.selected !== null && indexOf(next.selected) >= 0) active = next.selected;
      }
      if (indexOf(active) < 0) active = next.reading[0]?.node.key ?? null;
      if (pending !== null && indexOf(pending.key) < 0) {
        pending = null;
        setWarning(null);
      }
      renderTree();
      reveal();
    },
    focus() {
      const first = list.querySelector<HTMLElement>("button");
      if (problemsSection.open && first !== null) first.focus({ preventScroll: true });
      else if (readingSection.open && rows().length > 0) tree.focus({ preventScroll: true });
      else heading.focus({ preventScroll: true });
    },
    relabel,
  };
}
