// La barra della Base: le viste come linguette, poi Filtro, Ordina, Proprietà,
// Cerca, «…» e «Nuova»; sotto, le etichette del filtro e dell'ordinamento, e
// in fondo «Nel file .base», le righe che l'ultimo gesto ha scritto.
//
// La barra non scrive niente da sé: ogni gesto calcola il valore nuovo di una
// sola chiave della vista (`filters`, `sort`, `order`) con le funzioni pure di
// `filter.ts` e `sort.ts`, e lo passa a chi l'ha montata (`write`), che lo
// scrive con `base.view.set` e la revisione del file. Un gesto che non cambia
// niente non scrive. Mentre una scrittura aspetta il file nuovo la barra è
// spenta: il gesto dopo partirebbe da un piano vecchio e cancellerebbe il primo.
//
// «Cerca» filtra le righe sullo schermo e non tocca il file; «Raggruppa» è
// una scelta della superficie (sta in Ordina perché cambia l'ordine che si
// vede), ricordata per vista.
import { SearchSyntaxError } from "../../host/query";
import { t } from "../../i18n/strings";
import { openPopover, rovingToolbar, textButton, type PopoverHandle, type RovingToolbar } from "../../kit";
import { identifier } from "../../ui/a11y";
import { iconEl } from "../../ui/icons";
import { openLifetime } from "../../ui/lifetime";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../ui/menu";
import type { BasePlan, BaseViewKey, BaseWritten } from "./data";
import {
  CANONICAL, FOLDER_OPS, VALUELESS,
  conjuncts, filterOfSearch, filterOfVisual, filterProperties, filterValue, isOpaque, numberAsText, propertyOps, sameFilter, searchOf, valueProblem, visualOf, withoutConjunct,
  type FilterDef, type SearchProblem, type ValueKind, type ValueTyping, type VisualCondition, type VisualOp,
} from "./filter";
import { useBaseIcons, viewIcon } from "./icons";
import { errorKindPhrase } from "../../host/errors";
import { moveColumn, sameColumns, sameKey, sortValue, sortedBy, toggleColumn, withoutSort, type SortEntry } from "./sort";

/// Perché il file `.base` non si riscrive da qui: la superficie è in sola
/// lettura, o la Base è scritta dentro una nota (un blocco ```base```), che i
/// comandi della vista non riscrivono.
export type BaseLock = "read_only" | "embedded" | null;

export interface BaseToolbarModel {
  readonly views: readonly { readonly name: string; readonly type: string | null }[];
  readonly active: string | null;
  readonly plan: BasePlan | null;
  readonly lock: BaseLock;
  /// Si possono creare note (la superficie non è in sola lettura).
  readonly canCreate: boolean;
  /// Una scrittura aspetta il file nuovo.
  readonly busy: boolean;
  /// Le proprietà che le righe hanno, senza `prop.`: le scelte del filtro e le
  /// colonne che si possono mostrare.
  readonly properties: readonly string[];
  /// I valori che una proprietà ha nelle righe, per suggerirli nel filtro.
  readonly suggestions: (key: string) => readonly string[];
  /// La specie di una proprietà nelle righe: una data o un numero si scrivono
  /// nel filtro come tali.
  readonly kinds: (key: string) => ValueKind;
  /// Il separatore dei decimali della lingua dell'interfaccia.
  readonly decimal: "," | ".";
  /// Per una Base scritta dentro una nota: la nota che la contiene, da aprire
  /// come file. `null` se non c'è.
  readonly containerFile: string | null;
}

export interface BaseToolbarActions {
  readonly chooseView: (name: string) => void;
  /// Scrive la chiave `key` della vista attiva; `null` la toglie.
  readonly write: (key: BaseViewKey, value: unknown) => void;
  /// Il testo di «Cerca» è cambiato: filtra le righe sullo schermo.
  readonly search: () => void;
  readonly create: () => void;
  /// I modelli fra cui scegliere per «Nuova da un modello».
  readonly templates: () => Promise<readonly { readonly path: string; readonly label: string }[]>;
  readonly createFrom: (template: string) => void;
  /// Le voci di «…»: copiare ed esportare le righe.
  readonly more: () => MenuItem[];
  /// I controlli di «Raggruppa», che la superficie possiede.
  readonly grouping: HTMLElement;
  /// «Apri come file»: apre il documento che contiene la Base.
  readonly openFile: (doc: string) => void;
  /// Le voci di «+»: i tipi di vista da aggiungere al file.
  readonly newViews: () => MenuItem[];
}

export interface BaseToolbar {
  readonly bar: HTMLElement;
  readonly searchRow: HTMLElement;
  readonly search: HTMLInputElement;
  readonly strip: HTMLElement;
  readonly status: HTMLElement;
  readonly written: HTMLDetailsElement;
  update(model: BaseToolbarModel): void;
  /// Mostra le righe scritte dall'ultimo gesto; `null` le nasconde.
  showWritten(written: BaseWritten | null): void;
  /// Apre la riga di «Cerca» e ci mette il fuoco.
  openSearch(): void;
  /// Chiude il popover aperto, se c'è.
  closePopover(): void;
  /// Chiude il menu di «+» o quello delle viste che non stanno, se è aperto.
  closeMenu(): void;
  /// Apre accanto a `anchor` il campo per il nome nuovo della proprietà
  /// `name`; `submit` riceve il nome scritto.
  openRename(anchor: HTMLElement, name: string, submit: (next: string) => void): void;
  relabel(): void;
  destroy(): void;
}

const FOLDER = "\u0000folder";

const plain = (key: string): string => key.replace(/^prop\./, "");
const labelOf = (plan: BasePlan, key: string): string =>
  plan.columnLabels[key] ?? plan.columnLabels[`prop.${plain(key)}`] ?? plain(key);
const opLabel = (op: VisualOp): string => t(`base.filter.op.${op}`);

function icon(name: string): SVGElement | Text {
  return iconEl(name) ?? document.createTextNode("");
}
function toolButton(className: string, iconName: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `base-tool ${className}`;
  button.append(icon(iconName));
  return button;
}
/// Una voce di un elenco a tendina, scelta se `selected`.
function option(text: string, value = text, selected = false): HTMLOptionElement {
  const each = document.createElement("option");
  each.value = value;
  each.textContent = text;
  each.selected = selected;
  return each;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/// Il testo di una condizione di primo livello, per la sua etichetta.
export function conjunctText(plan: BasePlan, part: FilterDef, typing: ValueTyping = CANONICAL): string {
  const visual = visualOf(part, typing);
  if (visual && visual.length === 1) {
    const condition = visual[0]!;
    const subject = condition.subject === null ? t("base.filter.folder") : labelOf(plan, condition.subject);
    return VALUELESS.has(condition.op) ? `${subject} ${opLabel(condition.op)}` : `${subject} ${opLabel(condition.op)} ${condition.value}`;
  }
  return searchOf(part) ?? t("base.chip.manual");
}

/// La ricerca più vicina a una forma a vista che ha «è» o «non è»: la ricerca
/// sa dire soltanto «contiene».
function nearestSearch(conditions: readonly VisualCondition[], typing: ValueTyping): string | null {
  const near = conditions.map((condition): VisualCondition => condition.op === "is"
    ? { ...condition, op: "contains" }
    : condition.op === "is_not" ? { ...condition, op: "not_contains" } : condition);
  return searchOf(filterOfVisual(near, typing));
}

function problemText(problem: SearchProblem): string {
  if (problem.kind === "syntax") return new SearchSyntaxError(problem.fault).message;
  return t("base.filter.unsupported", { term: problem.term });
}

export function mountBaseToolbar(actions: BaseToolbarActions): BaseToolbar {
  const lifetime = openLifetime();
  lifetime.add(useBaseIcons());
  const bar = element("div", "base-bar");
  bar.setAttribute("role", "toolbar");
  const tabs = element("div", "base-tabs");
  tabs.setAttribute("role", "group");
  // «+»: una vista nuova, accanto alle linguette, fuori dal loro scorrere.
  const newViewButton = toolButton("base-tool-new-view", "base-plus");
  newViewButton.setAttribute("aria-haspopup", "menu");
  const space = element("span", "base-bar-space");
  const filterButton = toolButton("base-tool-filter", "base-filter");
  const filterCount = element("span", "base-tool-count");
  filterButton.append(filterCount);
  const sortButton = toolButton("base-tool-sort", "base-sort");
  const columnsButton = toolButton("base-tool-columns", "base-sliders");
  const searchButton = toolButton("base-tool-search", "search");
  const moreButton = toolButton("base-tool-more", "more");
  const newGroup = element("span", "base-new");
  const newButton = element("button", "base-new-note");
  newButton.type = "button";
  const templateButton = element("button", "base-new-template");
  templateButton.type = "button";
  templateButton.append(icon("base-chevron-down"));
  newGroup.append(newButton, templateButton);
  bar.append(tabs, newViewButton, space, filterButton, sortButton, columnsButton, searchButton, moreButton, newGroup);

  const searchRow = element("div", "base-search-row");
  searchRow.hidden = true;
  const search = document.createElement("input");
  search.type = "search";
  search.className = "base-search";
  searchRow.append(icon("search"), search);

  const strip = element("div", "base-strip");
  const chips = element("div", "base-chips");
  const note = element("p", "base-note");
  note.hidden = true;
  // «Apri come file»: per una Base scritta dentro una nota, apre la nota, dove
  // il blocco si cambia.
  const openFileButton = textButton({ label: t("base.lock.open_file"), onPress: () => { if (model.containerFile) actions.openFile(model.containerFile); } });
  openFileButton.classList.add("base-open-file");
  openFileButton.hidden = true;
  const status = element("div", "base-status");
  status.setAttribute("role", "status");
  strip.append(chips, note, openFileButton, status);

  const written = document.createElement("details");
  written.className = "base-written";
  written.hidden = true;
  const writtenSummary = document.createElement("summary");
  const writtenLines = element("pre", "base-written-lines");
  written.append(writtenSummary, writtenLines);

  let model: BaseToolbarModel = { views: [], active: null, plan: null, lock: null, canCreate: false, busy: false, properties: [], suggestions: () => [], kinds: () => "other", decimal: ".", containerFile: null };
  const typing = (): ValueTyping => ({ kind: model.kinds, decimal: model.decimal });
  let popover: PopoverHandle | null = null;
  let refreshPopover: (() => void) | null = null;
  const roving: RovingToolbar = rovingToolbar(bar, { controls: () => [...bar.querySelectorAll<HTMLElement>("button")] }, lifetime);

  const writable = () => model.lock === null && model.plan !== null && !model.busy;

  const closePopover = (): void => {
    popover?.close();
    popover = null;
    refreshPopover = null;
  };
  const open = (anchor: HTMLElement, label: string, className: string, content: HTMLElement, refresh: (() => void) | null): void => {
    closePopover();
    anchor.setAttribute("aria-expanded", "true");
    const handle = openPopover({
      anchor, content, label, lifetime, className: `base-popover ${className}`, align: "end",
      onClose: () => {
        anchor.setAttribute("aria-expanded", "false");
        if (popover === handle) { popover = null; refreshPopover = null; }
      },
    });
    popover = handle;
    refreshPopover = refresh;
  };

  // ---- Filtro -------------------------------------------------------------
  // `forFilter`: il filtro non offre `container.*`, la cartella della Base, che
  // non è una proprietà della nota. «Proprietà» la tiene fra le nascoste, e la
  // condizione che la nomina già resta nel suo menu (`extra`).
  const subjects = (plan: BasePlan, extra: readonly (string | null)[], forFilter = false): string[] => {
    const keys: string[] = [];
    const add = (key: string, kept = false) => {
      const name = plain(key);
      if (name && !name.startsWith("file.") && !name.startsWith("formula.") && (kept || !forFilter || !name.startsWith("container.")) && !keys.includes(name)) keys.push(name);
    };
    for (const column of plan.columns) add(column);
    for (const key of [...model.properties].sort((a, b) => a.localeCompare(b))) add(key);
    for (const key of extra) if (key !== null) add(key, true);
    return keys;
  };
  const openFilter = (): void => {
    const plan = model.plan;
    if (!plan) return;
    const content = element("div", "base-filter");
    const titleId = identifier("base-filter-title");
    const title = element("p", "base-pop-title", t("base.filter.title", { name: plan.view }));
    title.id = titleId;
    const rowsBox = element("div", "base-filter-rows");
    const visualNote = element("p", "base-pop-note");
    const addButton = textButton({ label: t("base.filter.add"), onPress: () => { mode = "visual"; draft = [...(draft ?? []), { subject: subjects(plan, [], true)[0] ?? "", op: "is", value: "" }]; drawRows(); syncSearch(); } });
    addButton.classList.add("base-filter-add");
    const searchTitle = element("label", "base-pop-title", t("base.filter.search"));
    const searchField = document.createElement("input");
    searchField.type = "text";
    searchField.className = "base-filter-search";
    searchField.spellcheck = false;
    searchField.id = identifier("base-filter-search");
    searchTitle.htmlFor = searchField.id;
    const searchNote = element("p", "base-pop-note");
    // Il file è cambiato altrove mentre il filtro si componeva: la bozza non
    // si scrive sopra il filtro nuovo, e «Ricarica» lo mostra.
    const staleNote = element("p", "base-pop-note base-filter-stale");
    staleNote.setAttribute("role", "status");
    staleNote.hidden = true;
    const reloadButton = textButton({ label: t("base.filter.reload"), onPress: () => openFilter() });
    reloadButton.hidden = true;
    const foot = element("div", "base-pop-foot");
    const cancel = textButton({ label: t("base.filter.cancel"), onPress: () => closePopover() });
    const apply = textButton({ label: t("base.filter.apply"), kind: "primary", onPress: () => applyFilter() });
    foot.append(cancel, reloadButton, apply);
    content.append(title, rowsBox, visualNote, addButton, searchTitle, searchField, searchNote, staleNote, foot);

    // La forma a vista legge i numeri nella lingua e le date in ISO, secondo
    // la specie che la proprietà ha nelle righe.
    const typed = typing();
    // Le proprietà che la Base conosce: le colonne e quelle delle righe lette.
    // Un nome che non c'è non ferma «Applica» (le righe lette non hanno tutte
    // le proprietà del vault): la nota avverte, perché un nome sbagliato non
    // diventi in silenzio un filtro che non trova niente.
    const known = (key: string): boolean => subjects(plan, [], true).includes(plain(key));
    // Le due bozze. `mode` dice quale ha toccato per ultima chi usa la Base:
    // è quella che «Applica» scrive.
    let draft: VisualCondition[] | null = visualOf(plan.filters, typed);
    const initialSearch = searchOf(plan.filters);
    let mode: "visual" | "search" = draft !== null ? "visual" : "search";
    let parsed: FilterDef | null = plan.filters;
    let problem: SearchProblem | null = null;
    // Chi usa la Base ha cambiato qualcosa nel popover, e se il file è
    // cambiato da fuori dopo l'apertura.
    let touched = false;
    let stale = false;
    const opaque = isOpaque(plan.filters) || (draft === null && initialSearch === null);
    searchField.value = initialSearch ?? (draft ? nearestSearch(draft, typed) ?? "" : "");
    const datalists: HTMLDataListElement[] = [];

    const conditionRow = (condition: VisualCondition, index: number): HTMLElement => {
      const row = element("div", "base-filter-row");
      const subject = element("select", "base-filter-subject");
      subject.setAttribute("aria-label", t("base.filter.subject"));
      for (const key of subjects(plan, [condition.subject], true)) {
        subject.append(option(labelOf(plan, key), key, condition.subject === key));
      }
      subject.append(option(t("base.filter.folder"), FOLDER, condition.subject === null));
      subject.value = condition.subject ?? FOLDER;
      const op = element("select", "base-filter-op");
      op.setAttribute("aria-label", t("base.filter.op"));
      const opsFor = (key: string | null): readonly VisualOp[] => key === null ? FOLDER_OPS : propertyOps(typed.kind(key));
      // L'operatore che la condizione ha resta fra le scelte anche se la
      // specie non lo propone: il file l'ha scritto così.
      const ops = opsFor(condition.subject);
      for (const each of ops.includes(condition.op) ? ops : [...ops, condition.op]) op.append(option(opLabel(each), each, each === condition.op));
      op.value = condition.op;
      const value = document.createElement("input");
      value.type = "text";
      value.className = "base-filter-value";
      value.value = condition.value;
      value.hidden = VALUELESS.has(condition.op);
      value.setAttribute("aria-label", t("base.filter.value"));
      const suggestions = condition.subject === null ? [] : model.suggestions(condition.subject);
      if (suggestions.length) {
        const list = document.createElement("datalist");
        list.id = identifier("base-filter-values");
        for (const each of suggestions) list.append(option(each));
        datalists.push(list);
        value.setAttribute("list", list.id);
        row.append(list);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "base-filter-remove";
      remove.setAttribute("aria-label", t("base.filter.remove"));
      remove.append(icon("close"));
      const edit = (next: VisualCondition, redraw: boolean) => {
        mode = "visual";
        touched = true;
        draft = (draft ?? []).map((each, at) => at === index ? next : each);
        if (redraw) drawRows();
        syncSearch();
      };
      subject.addEventListener("change", () => {
        const folder = subject.value === FOLDER;
        const was = draft?.[index] ?? condition;
        const next = opsFor(folder ? null : subject.value);
        edit({ subject: folder ? null : subject.value, op: next.includes(was.op) ? was.op : next[0]!, value: was.value }, true);
      });
      op.addEventListener("change", () => {
        const was = draft?.[index] ?? condition;
        edit({ ...was, op: op.value as VisualOp }, VALUELESS.has(op.value as VisualOp) !== VALUELESS.has(was.op));
      });
      value.addEventListener("input", () => { edit({ ...(draft?.[index] ?? condition), value: value.value }, false); showValueProblem(); });
      remove.addEventListener("click", () => {
        mode = "visual";
        touched = true;
        draft = (draft ?? []).filter((_, at) => at !== index);
        drawRows();
        syncSearch();
      });
      row.append(subject, op, value, remove);
      return row;
    };
    const drawRows = (): void => {
      datalists.length = 0;
      rowsBox.replaceChildren(...(draft ?? []).map(conditionRow));
      addButton.hidden = opaque;
      showValueProblem();
    };
    // Che cosa dice la nota sotto le condizioni quando nessun valore è
    // sbagliato: perché la forma a vista manca, o che non c'è niente.
    const defaultNote = (): string =>
      opaque ? t("base.filter.only_source")
        : draft === null ? t("base.filter.only_search")
          : draft.length === 0 ? t("base.filter.empty") : "";
    // Un valore che non si legge nella specie della sua proprietà: la nota lo
    // dice, e «Applica» aspetta.
    const showValueProblem = (): void => {
      const wrong = mode === "visual" ? (draft ?? []).map((condition) => [condition, valueProblem(condition, typed)] as const).find(([, kind]) => kind !== null) : undefined;
      // Un numero scritto nella lingua per una proprietà che non ha solo
      // numeri si cerca come testo: la nota lo dice, «Applica» resta.
      const asText = wrong || mode !== "visual" ? undefined : (draft ?? []).map((condition) => [condition, numberAsText(condition, typed)] as const).find(([, number]) => number !== null);
      visualNote.textContent = wrong
        ? t(wrong[1] === "number" ? "base.filter.not_number" : "base.filter.not_date", { value: wrong[0].value.trim(), example: typed.decimal === "," ? "3,5" : "3.5" })
        : asText ? t("base.filter.number_as_text", { value: asText[0].value.trim(), number: asText[1]! })
          : defaultNote();
      visualNote.hidden = visualNote.textContent === "";
      updateApply();
    };
    // La forma a vista è cambiata: la ricerca la ridice, o dice la più vicina.
    const syncSearch = (): void => {
      const current = draft ?? [];
      const exact = searchOf(filterOfVisual(current, typed));
      problem = null;
      parsed = filterOfVisual(current, typed);
      if (exact !== null) {
        searchField.value = exact;
        searchNote.textContent = "";
      } else {
        searchField.value = nearestSearch(current, typed) ?? "";
        searchNote.textContent = t("base.filter.search_contains");
      }
      searchNote.hidden = searchNote.textContent === "";
      updateApply();
    };
    // La ricerca è cambiata: la forma a vista la ridice, se sa.
    const syncVisual = (): void => {
      mode = "search";
      touched = true;
      const result = filterOfSearch(searchField.value);
      if ("problem" in result) {
        problem = result.problem;
        parsed = null;
        searchNote.textContent = problemText(result.problem);
        searchNote.hidden = false;
        updateApply();
        return;
      }
      problem = null;
      parsed = result.ok;
      const unknown = filterProperties(result.ok).find((key) => !known(key));
      searchNote.textContent = unknown === undefined ? "" : t("base.filter.unknown_property", { key: plain(unknown) });
      searchNote.hidden = unknown === undefined;
      draft = visualOf(result.ok, typed);
      drawRows();
    };
    const finalFilter = (): FilterDef | null => mode === "visual" ? filterOfVisual(draft ?? [], typed) : parsed;
    const blocked = (): boolean => mode === "visual" && (draft ?? []).some((condition) => valueProblem(condition, typed) !== null);
    const updateApply = (): void => {
      const next = finalFilter();
      apply.disabled = stale || opaque || !writable() || next === null || problem !== null || blocked() || sameFilter(next, plan.filters);
    };
    const applyFilter = (): void => {
      const next = finalFilter();
      if (stale || opaque || !writable() || next === null || problem !== null || blocked()) return;
      closePopover();
      if (!sameFilter(next, plan.filters)) actions.write("filters", filterValue(next));
    };
    searchField.addEventListener("input", syncVisual);
    searchField.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); applyFilter(); } });
    searchField.disabled = opaque;
    searchNote.hidden = true;
    if (draft !== null && initialSearch === null) { searchNote.textContent = t("base.filter.search_contains"); searchNote.hidden = false; }
    drawRows();
    // Il piano è cambiato col popover aperto. Se il filtro nel file è lo
    // stesso, la bozza resta buona: si scrive con la revisione nuova. Se è
    // cambiato, una bozza intatta si rifà sul filtro nuovo; una toccata non
    // si scrive sopra, e la nota lo dice con «Ricarica».
    const refresh = (): void => {
      const now = model.plan;
      if (!now || stale) { updateApply(); return; }
      if (sameFilter(now.filters, plan.filters)) { updateApply(); return; }
      if (!touched) { openFilter(); return; }
      stale = true;
      staleNote.textContent = t("base.filter.stale");
      staleNote.hidden = false;
      reloadButton.hidden = false;
      updateApply();
      popover?.reposition();
    };
    open(filterButton, t("base.filter.title", { name: plan.view }), "base-filter-popover", content, refresh);
  };

  // ---- Ordina -------------------------------------------------------------
  const sortContent = (): HTMLElement => {
    const plan = model.plan!;
    const content = element("div", "base-sort");
    content.append(element("p", "base-pop-title", t("base.sort.title", { name: plan.view })));
    const list = element("div", "base-sort-rows");
    const write = (next: SortEntry[]) => { if (writable()) actions.write("sort", sortValue(next)); };
    for (const entry of plan.sort) {
      const row = element("div", "base-sort-row");
      const name = element("span", "base-sort-name", labelOf(plan, entry.key));
      const direction = element("select", "base-sort-direction");
      direction.setAttribute("aria-label", t("base.sort.direction", { name: labelOf(plan, entry.key) }));
      direction.append(option(t("base.sort.asc"), "asc", !entry.descending), option(t("base.sort.desc"), "desc", entry.descending));
      direction.value = entry.descending ? "desc" : "asc";
      direction.disabled = !writable();
      direction.addEventListener("change", () => write(plan.sort.map((each) => sameKey(each.key, entry.key) ? { key: each.key, descending: direction.value === "desc" } : each)));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "base-sort-remove";
      remove.setAttribute("aria-label", t("base.sort.remove", { name: labelOf(plan, entry.key) }));
      remove.append(icon("close"));
      remove.disabled = !writable();
      remove.addEventListener("click", () => write(withoutSort(plan.sort, entry.key)));
      row.append(name, direction, remove);
      list.append(row);
    }
    if (plan.sort.length === 0) list.append(element("p", "base-pop-note", t("base.sort.none")));
    const add = element("select", "base-sort-add");
    add.setAttribute("aria-label", t("base.sort.add"));
    add.append(option(t("base.sort.add"), "", true));
    const candidates = [...plan.columns.filter((key) => !key.startsWith("formula.")), ...subjects(plan, []).filter((key) => !plan.columns.some((column) => sameKey(column, key)))];
    for (const key of candidates) if (!sortedBy(plan.sort, key)) add.append(option(labelOf(plan, key), key));
    add.disabled = !writable() || add.options.length === 1;
    add.addEventListener("change", () => { if (add.value) write([...plan.sort, { key: add.value, descending: false }]); });
    content.append(list, add);
    if (!actions.grouping.hidden) {
      content.append(element("p", "base-pop-title", t("base.group.by")), actions.grouping);
    }
    return content;
  };
  const openSort = (): void => {
    const plan = model.plan;
    if (!plan) return;
    const box = element("div", "base-pop-box");
    box.append(sortContent());
    open(sortButton, t("base.sort.title", { name: plan.view }), "base-sort-popover", box, () => {
      if (model.plan) box.replaceChildren(sortContent());
      popover?.reposition();
    });
  };

  // ---- Proprietà ----------------------------------------------------------
  const columnsContent = (): HTMLElement => {
    const plan = model.plan!;
    const content = element("div", "base-columns");
    content.append(element("p", "base-pop-title", t("base.columns.title", { name: plan.view })));
    const shown = plan.order.length ? plan.order : plan.columns;
    const hidden = subjects(plan, []).filter((key) => !shown.some((column) => sameKey(column, key)));
    const list = element("ul", "base-column-list");
    const write = (next: string[]) => { if (writable() && !sameColumns(next, shown)) actions.write("order", next.length ? next : null); };
    let dragged: number | null = null;
    const row = (key: string, index: number | null): HTMLLIElement => {
      const item = element("li", "base-column");
      item.dataset.column = key;
      const grip = element("span", "base-column-grip");
      grip.append(icon("base-grip"));
      grip.setAttribute("aria-hidden", "true");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = index !== null;
      box.id = identifier("base-column");
      // Mai `disabled`: una casella spenta perde il fuoco, che finirebbe sul
      // corpo della pagina a ogni gesto (la barra è occupata finché il file
      // nuovo non arriva). Inerte invece: lo dice `aria-disabled`, e il clic
      // e i tasti non fanno niente.
      box.setAttribute("aria-disabled", String(!writable()));
      const label = element("label", "base-column-label", labelOf(plan, key));
      label.htmlFor = box.id;
      box.addEventListener("click", (event) => { if (!writable()) event.preventDefault(); });
      box.addEventListener("change", () => write(toggleColumn(shown, key, box.checked)));
      // Una casella si spunta anche con Invio, come Spazio: la tastiera non
      // deve sapere quale dei due tasti la casella ascolta.
      box.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); box.click(); return; }
        if (index === null || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        write(moveColumn(shown, index, index + (event.key === "ArrowUp" ? -1 : 1)));
      });
      box.addEventListener("focus", () => { focusedColumn = key; });
      if (index !== null) {
        item.draggable = writable();
        grip.title = t("base.columns.move", { name: labelOf(plan, key) });
        item.addEventListener("dragstart", (event) => {
          dragged = index;
          event.dataTransfer?.setData("text/plain", key);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          item.classList.add("dragging");
        });
        item.addEventListener("dragend", () => { dragged = null; item.classList.remove("dragging"); });
        item.addEventListener("dragover", (event) => { if (dragged !== null) event.preventDefault(); });
        item.addEventListener("drop", (event) => {
          event.preventDefault();
          if (dragged !== null && dragged !== index) write(moveColumn(shown, dragged, index));
          dragged = null;
        });
      } else item.classList.add("base-column-hidden");
      item.append(grip, box, label);
      return item;
    };
    list.append(...shown.map((key, index) => row(key, index)), ...hidden.map((key) => row(key, null)));
    content.append(list, element("p", "base-pop-note", t("base.columns.hint")));
    return content;
  };
  // La colonna su cui stava il fuoco nel popover di Proprietà: ci torna
  // dopo che il file è cambiato e le caselle si sono rifatte.
  let focusedColumn: string | null = null;
  const openColumns = (): void => {
    const plan = model.plan;
    if (!plan) return;
    const box = element("div", "base-pop-box");
    focusedColumn = null;
    box.append(columnsContent());
    open(columnsButton, t("base.columns.title", { name: plan.view }), "base-columns-popover", box, () => {
      if (!model.plan) return;
      // Il fuoco resta sulla stessa colonna dopo che il file è cambiato, se
      // stava nel popover (o se le caselle rifatte l'hanno lasciato cadere).
      const active = document.activeElement;
      const inside = active instanceof Node && box.contains(active);
      const lost = active === null || active === document.body;
      const focused = inside ? (active as HTMLElement).closest<HTMLElement>(".base-column")?.dataset.column ?? focusedColumn : focusedColumn;
      box.replaceChildren(columnsContent());
      if ((inside || lost) && focused !== null) box.querySelector<HTMLInputElement>(`.base-column[data-column="${CSS.escape(focused)}"] input`)?.focus();
      popover?.reposition();
    });
  };

  // ---- Nuova --------------------------------------------------------------
  const openTemplates = async (): Promise<void> => {
    let items: MenuItem[];
    try {
      const templates = await actions.templates();
      items = templates.length
        ? templates.map((each) => ({ label: each.label, icon: "template", run: () => actions.createFrom(each.path) }))
        : [{ label: t("base.new.no_templates"), disabled: true }];
    } catch (failure) {
      items = [{ label: errorKindPhrase(failure), disabled: true }];
    }
    if (!lifetime.closed && templateButton.isConnected) showContextMenu(templateButton, items, { label: t("base.new.template") });
  };

  lifetime.listen(filterButton, "click", openFilter);
  lifetime.listen(sortButton, "click", openSort);
  lifetime.listen(columnsButton, "click", openColumns);
  lifetime.listen(searchButton, "click", () => {
    if (searchRow.hidden) { openSearch(); return; }
    // Chiudere la ricerca la svuota: righe nascoste da un campo che non si
    // vede sarebbero un filtro che nessuno ricorda.
    searchRow.hidden = true;
    searchButton.setAttribute("aria-pressed", "false");
    if (search.value) { search.value = ""; actions.search(); }
  });
  lifetime.listen(search, "input", () => actions.search());
  lifetime.listen(search, "keydown", (event) => {
    if (event.key !== "Escape" || search.value === "") return;
    event.stopPropagation();
    search.value = "";
    actions.search();
  });
  lifetime.listen(moreButton, "click", () => showContextMenu(moreButton, actions.more(), { label: t("base.tool.more") }));
  // Il menu aperto da un pulsante della barra, se c'è: la superficie lo
  // chiude quando la vista cambia.
  let menuOpen = false;
  const closeMenu = (): void => {
    if (!menuOpen) return;
    menuOpen = false;
    closeContextMenu();
  };
  lifetime.add(closeMenu);
  const openMenu = (anchor: HTMLButtonElement, items: MenuItem[], label: string, header?: { icon: string; kind: string }): void => {
    anchor.setAttribute("aria-expanded", "true");
    menuOpen = true;
    showContextMenu(anchor, items, {
      label, ...(header ? { header } : {}),
      onClose: () => { menuOpen = false; anchor.setAttribute("aria-expanded", "false"); },
    });
  };
  lifetime.listen(newViewButton, "click", () => {
    if (!writable()) return;
    openMenu(newViewButton, actions.newViews(), t("base.view.new"), { icon: "base-plus", kind: t("base.view.new") });
  });
  lifetime.listen(newButton, "click", () => actions.create());
  lifetime.listen(templateButton, "click", () => void openTemplates());

  function openSearch(): void {
    searchRow.hidden = false;
    searchButton.setAttribute("aria-pressed", "true");
    search.focus();
  }

  // Le linguette che non stanno nella barra: prima le viste non scelte
  // restano la sola figura (come sotto i 700 px); se ancora non stanno, le
  // ultime vanno in «Altre N viste», l'ultima cosa delle linguette, che le
  // elenca in un menu. La vista scelta resta sempre nella barra. Si misura
  // quando le viste cambiano e quando la barra cambia larghezza.
  const moreTabs = element("button", "base-tab base-tab-more");
  moreTabs.type = "button";
  moreTabs.setAttribute("aria-haspopup", "menu");
  moreTabs.setAttribute("aria-expanded", "false");
  const moreCount = element("span", "base-tab-more-count");
  moreTabs.append(icon("base-chevron-down"), moreCount);
  let hiddenViews: string[] = [];
  const labelMore = (): void => {
    moreCount.textContent = String(hiddenViews.length);
    const label = t("base.view.more", { count: hiddenViews.length });
    moreTabs.setAttribute("aria-label", label);
    moreTabs.title = label;
  };
  const overflowing = (): boolean => tabs.scrollWidth > tabs.clientWidth + 1;
  const fitTabs = (): void => {
    const all = [...tabs.querySelectorAll<HTMLElement>(".base-tab[data-view]")];
    for (const tab of all) tab.hidden = false;
    hiddenViews = [];
    moreTabs.hidden = true;
    tabs.classList.remove("compact");
    if (!overflowing()) return;
    tabs.classList.add("compact");
    if (!overflowing()) return;
    moreTabs.hidden = false;
    labelMore();
    for (const tab of all.reverse()) {
      if (!overflowing()) break;
      if (tab.getAttribute("aria-pressed") === "true") continue;
      tab.hidden = true;
      hiddenViews.unshift(tab.dataset.view!);
      labelMore();
    }
  };
  lifetime.listen(moreTabs, "click", () => {
    const items = hiddenViews.map((name): MenuItem => {
      const type = model.views.find((view) => view.name === name)?.type ?? null;
      return {
        label: name, icon: viewIcon(type), choice: "radio", checked: name === model.active,
        run: () => { if (name !== model.active) actions.chooseView(name); },
      };
    });
    openMenu(moreTabs, items, t("base.view.more", { count: hiddenViews.length }));
  });
  if (typeof ResizeObserver === "function") {
    const watcher = new ResizeObserver(() => fitTabs());
    watcher.observe(bar);
    lifetime.add(() => watcher.disconnect());
  }
  const drawTabs = (): void => {
    const keep = document.activeElement instanceof HTMLElement && tabs.contains(document.activeElement) ? document.activeElement.dataset.view : undefined;
    tabs.replaceChildren(...model.views.map(({ name, type }) => {
      const tab = element("button", "base-tab");
      tab.type = "button";
      tab.dataset.view = name;
      tab.title = name;
      tab.setAttribute("aria-pressed", String(name === model.active));
      tab.append(icon(viewIcon(type)), element("span", "base-tab-label", name));
      tab.addEventListener("click", () => { if (name !== model.active) actions.chooseView(name); });
      return tab;
    }), moreTabs);
    tabs.hidden = model.views.length === 0;
    if (keep !== undefined) tabs.querySelector<HTMLElement>(`[data-view="${CSS.escape(keep)}"]`)?.focus();
    fitTabs();
  };
  const chip = (text: string, iconName: string, removeLabel: string, remove: (() => void) | null): HTMLElement => {
    const each = element("span", "base-chip");
    each.append(icon(iconName), element("span", "base-chip-text", text));
    if (remove) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", removeLabel);
      button.append(icon("close"));
      button.disabled = model.busy;
      button.addEventListener("click", remove);
      each.append(button);
    }
    return each;
  };
  const drawChips = (): void => {
    const plan = model.plan;
    const items: HTMLElement[] = [];
    if (plan) {
      const removable = model.lock === null;
      if (isOpaque(plan.filters)) items.push(chip(t("base.chip.manual"), "base-filter", "", null));
      else conjuncts(plan.filters).forEach((part, index) => {
        const text = conjunctText(plan, part, typing());
        items.push(chip(text, "base-filter", t("base.chip.remove_filter", { name: text }), removable ? () => { if (writable()) actions.write("filters", filterValue(withoutConjunct(plan.filters, index))); } : null));
      });
      for (const entry of plan.sort) {
        const text = `${labelOf(plan, entry.key)} ${entry.descending ? "↓" : "↑"}`;
        items.push(chip(text, "base-sort", t("base.chip.remove_sort", { name: labelOf(plan, entry.key) }), removable ? () => { if (writable()) actions.write("sort", sortValue(withoutSort(plan.sort, entry.key))); } : null));
      }
    }
    chips.replaceChildren(...items);
    chips.hidden = items.length === 0;
  };
  const drawTools = (): void => {
    const plan = model.plan;
    const count = plan && !isOpaque(plan.filters) ? conjuncts(plan.filters).length : plan && isOpaque(plan.filters) ? 1 : 0;
    filterCount.textContent = count ? String(count) : "";
    filterButton.classList.toggle("on", count > 0);
    sortButton.classList.toggle("on", (plan?.sort.length ?? 0) > 0);
    columnsButton.classList.toggle("on", (plan?.order.length ?? 0) > 0);
    for (const button of [filterButton, sortButton, columnsButton]) button.disabled = plan === null;
    // «+» scrive il file: spento dove il file non si scrive, col perché nel
    // titolo.
    // «+» scrive il file: spento come gli attrezzi che scrivono, anche
    // mentre un gesto è in volo.
    newViewButton.disabled = !writable();
    newViewButton.title = model.lock !== null ? t(model.lock === "read_only" ? "base.lock.read_only" : "base.lock.embedded")
      : model.busy ? t("base.column.busy") : t("base.view.new");
    filterButton.setAttribute("aria-label", count ? t("base.tool.filter_count", { count }) : t("base.tool.filter"));
    newButton.disabled = !model.canCreate;
    templateButton.disabled = !model.canCreate;
    newGroup.hidden = !model.canCreate && model.lock === "read_only";
    note.hidden = model.lock === null;
    note.textContent = model.lock === null ? "" : t(model.lock === "read_only" ? "base.lock.read_only" : "base.lock.embedded");
    openFileButton.hidden = model.lock !== "embedded" || model.containerFile === null;
    bar.setAttribute("aria-busy", String(model.busy));
  };

  const relabel = (): void => {
    bar.setAttribute("aria-label", t("base.bar"));
    tabs.setAttribute("aria-label", t("base.views"));
    sortButton.setAttribute("aria-label", t("base.tool.sort"));
    sortButton.title = t("base.tool.sort");
    filterButton.title = t("base.tool.filter");
    columnsButton.setAttribute("aria-label", t("base.tool.properties"));
    columnsButton.title = t("base.tool.properties");
    searchButton.setAttribute("aria-label", t("base.tool.search"));
    searchButton.title = t("base.tool.search");
    newViewButton.setAttribute("aria-label", t("base.view.new"));
    moreButton.setAttribute("aria-label", t("base.tool.more"));
    moreButton.title = t("base.tool.more");
    newButton.textContent = t("base.new");
    openFileButton.textContent = t("base.lock.open_file");
    templateButton.setAttribute("aria-label", t("base.new.template"));
    templateButton.title = t("base.new.template");
    search.setAttribute("aria-label", t("base.tool.search"));
    search.placeholder = t("base.search.placeholder");
    writtenSummary.textContent = t("base.written");
    for (const button of [filterButton, sortButton, columnsButton]) button.setAttribute("aria-haspopup", "dialog");
    for (const button of [moreButton, templateButton]) button.setAttribute("aria-haspopup", "menu");
    if (!searchButton.hasAttribute("aria-pressed")) searchButton.setAttribute("aria-pressed", "false");
    drawTools();
    drawChips();
  };

  return {
    bar, searchRow, search, strip, status, written,
    update(next) {
      const viewChanged = next.plan?.view !== model.plan?.view;
      model = next;
      drawTabs();
      drawTools();
      drawChips();
      if (viewChanged) closePopover();
      else refreshPopover?.();
      roving.refresh();
    },
    showWritten(lines) {
      written.hidden = lines === null;
      if (lines === null) { writtenLines.replaceChildren(); return; }
      // Una riga per elemento, col segno davanti: chi legge vede che cosa è
      // uscito e che cosa è entrato, e da quale riga del file.
      const line = (text: string, kind: "removed" | "added") =>
        element("span", `base-written-${kind}`, `${kind === "removed" ? "−" : "+"} ${text}`);
      writtenLines.replaceChildren(
        element("span", "base-written-where", t("base.written.line", { line: lines.line })),
        ...lines.removed.map((text) => line(text, "removed")),
        ...lines.added.map((text) => line(text, "added")),
      );
    },
    openSearch,
    closePopover,
    closeMenu,
    openRename(anchor, name, submit) {
      const content = element("form", "base-rename");
      const title = element("label", "base-pop-title", t("base.rename.title", { name }));
      const field = document.createElement("input");
      field.type = "text";
      field.className = "base-rename-field";
      field.spellcheck = false;
      field.value = name;
      field.id = identifier("base-rename-field");
      title.htmlFor = field.id;
      const hint = element("p", "base-pop-note", t("base.rename.hint"));
      const foot = element("div", "base-pop-foot");
      const cancel = textButton({ label: t("base.filter.cancel"), onPress: () => closePopover() });
      const confirm = textButton({ label: t("base.rename.apply"), kind: "primary", onPress: () => send() });
      // Un nome nuovo, non vuoto e su una riga sola.
      const usable = (): boolean => { const next = field.value.trim(); return next !== "" && next !== name && !/[\r\n]/.test(next); };
      const send = (): void => {
        if (!usable()) return;
        const next = field.value.trim();
        closePopover();
        submit(next);
      };
      confirm.disabled = true;
      field.addEventListener("input", () => { confirm.disabled = !usable(); });
      content.addEventListener("submit", (event) => { event.preventDefault(); send(); });
      foot.append(cancel, confirm);
      content.append(title, field, hint, foot);
      open(anchor, t("base.rename.title", { name }), "base-rename-popover", content, null);
      field.select();
    },
    relabel,
    destroy() { closePopover(); lifetime.close(); },
  };
}
