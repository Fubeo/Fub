// Il menu della colonna della Base: si apre col clic sull'intestazione (e col
// tasto destro, nello stesso ordine), nella lingua dei menu (E29): righe di una
// linea con l'icona, gruppi divisi da un filo, la testata con il nome della
// colonna.
//
// Le voci sono dati: ognuna dice che cosa fa, e la superficie le disegna come
// menu del clic (`showContextMenu`) o come voci del tasto destro
// (`SurfaceMenu`). Ordina, Raggruppa, Riepilogo e Nascondi scrivono una sola
// chiave della vista (`sort`, `group`, `summaries`, `order`) con le funzioni
// pure di qui e di `sort.ts`, e la superficie la scrive con `base.view.set` e
// la revisione del file. Rinomina e Tipo sono comandi del vault che esistono
// già (`property.key.rename`, `property.type.set`): cambiano le note e il
// registro dei tipi, non il `.base`.
//
// I riepiloghi li calcola il core (`derive` in `fub-features/src/base.rs`);
// qui si sceglie soltanto quale scrivere.
import type { PropertyType } from "../../host/enums.generated";
import { t } from "../../i18n/strings";
import type { MenuItem } from "../../ui/menu";
import { MENU_RULE, type SurfaceMenuEntry, type SurfaceMenuItem } from "../core/editor-menu";
import type { BaseAggregate, BaseCellValue, BasePlan, BaseRow, BaseSummaryDef, BaseViewKey } from "./data";
import { summariesValue } from "./data";
import type { FilterDef } from "./filter";
import { sameKey, sortBy, sortValue, sortedBy, toggleColumn } from "./sort";
import type { BaseLock } from "./toolbar";

/// La specie dei valori di una colonna, letta dalle celle che il core ha
/// derivato: decide quali riepiloghi hanno senso.
export type ColumnKind = "number" | "date" | "text";

/// La specie di una colonna nelle righe: numero o data quando ogni valore
/// pieno lo è, testo altrimenti (e quando non ci sono valori).
export function columnKind(rows: readonly BaseRow[], key: string): ColumnKind {
  let seen: "number" | "date" | null = null;
  for (const row of rows) {
    const value: BaseCellValue | undefined = row.values[key];
    if (!value || value.kind === "empty") continue;
    const kind = value.kind === "number" ? "number" : value.kind === "date" ? "date" : null;
    if (kind === null || (seen !== null && seen !== kind)) return "text";
    seen = kind;
  }
  return seen ?? "text";
}

/// I riepiloghi che si scelgono dal menu per una specie di colonna, nel loro
/// ordine. Una colonna di testo ha solo il conteggio, le vuote e le piene; una
/// data ha la prima e l'ultima al posto di minimo e massimo, perché il core
/// confronta le date con `earliest` e `latest`.
export function summaryChoices(kind: ColumnKind): readonly BaseAggregate[] {
  switch (kind) {
    case "number": return ["count", "sum", "average", "min", "max", "count_empty", "count_filled"];
    case "date": return ["count", "earliest", "latest", "count_empty", "count_filled"];
    case "text": return ["count", "count_empty", "count_filled"];
  }
}

/// Un riepilogo scelto dal menu: sulla colonna, senza nome e senza formula.
/// Quelli scritti a mano con un nome o una formula restano loro.
const chosen = (summary: BaseSummaryDef, column: string): boolean =>
  sameKey(summary.key, column) && summary.name === null && summary.expression === null;

/// Il riepilogo che il menu mostra scelto per la colonna, se c'è.
export function columnSummary(summaries: readonly BaseSummaryDef[], column: string): BaseAggregate | null {
  return summaries.find((summary) => chosen(summary, column))?.aggregate ?? null;
}

/// I riepiloghi con `aggregate` scelto per la colonna (`null`: nessuno). Il
/// riepilogo nuovo prende il posto del primo che sostituisce, così il file
/// cambia nella sua riga; senza, va in fondo. Quelli con un nome o una
/// formula, e quelli delle altre colonne, restano dove sono.
export function summariesWith(summaries: readonly BaseSummaryDef[], column: string, aggregate: BaseAggregate | null): BaseSummaryDef[] {
  const at = summaries.findIndex((summary) => chosen(summary, column));
  const key = at >= 0 ? summaries[at]!.key : column;
  const kept = summaries.filter((summary) => !chosen(summary, column));
  if (aggregate === null) return kept;
  const next: BaseSummaryDef = { key, aggregate, expression: null, name: null, label: `${key}:${aggregate.replace(/_/g, "")}` };
  if (at < 0) return [...kept, next];
  const before = summaries.slice(0, at).filter((summary) => !chosen(summary, column)).length;
  return [...kept.slice(0, before), next, ...kept.slice(before)];
}

/// I tipi di proprietà che il menu propone, nell'ordine dell'editor del tipo.
export const PROPERTY_TYPES: readonly PropertyType[] = ["text", "number", "checkbox", "date", "date_time", "list", "tags", "select", "status", "url"];

/// La colonna della nota (il nome del file), che non è una proprietà.
export const NOTE_COLUMN = "\u0000file";
/// La chiave con cui si ordina per la colonna della nota.
const NOTE_SORT_KEY = "file.name";

/// Una voce del menu della colonna, prima che diventi una riga.
export interface ColumnEntry {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  /// Una scelta fra alternative, col suo stato.
  readonly radio?: boolean;
  readonly checked?: boolean;
  /// Spenta, col perché in `description`.
  readonly enabled: boolean;
  readonly description?: string;
  /// La voce apre un gruppo nuovo.
  readonly separator?: boolean;
  readonly items?: readonly ColumnEntry[];
  readonly run?: () => void;
}

export interface ColumnMenuModel {
  readonly plan: BasePlan;
  /// La chiave della colonna come sta nel piano, o `NOTE_COLUMN`.
  readonly column: string;
  readonly label: string;
  readonly kind: ColumnKind;
  /// Il raggruppamento che si vede adesso.
  readonly grouping: string | null;
  /// La vista si raggruppa (tabella, schede, elenco).
  readonly regroupable: boolean;
  /// Perché il `.base` non si scrive da qui, se non si scrive.
  readonly lock: BaseLock;
  /// Una scrittura aspetta il file nuovo.
  readonly busy: boolean;
  /// La superficie è in sola lettura: nemmeno le note si cambiano.
  readonly readOnly: boolean;
}

export interface ColumnMenuActions {
  /// Scrive la chiave `key` della vista attiva; `null` la toglie.
  readonly write: (key: BaseViewKey, value: unknown) => void;
  /// Apre il campo per il nome nuovo della proprietà.
  readonly rename: (column: string) => void;
  readonly setType: (column: string, type: PropertyType) => void;
  readonly copy: (column: string) => void;
}

/// La proprietà di una colonna, se è una proprietà: `file.*` e le formule
/// non si rinominano e non hanno un tipo.
export function columnProperty(column: string): string | null {
  if (column === NOTE_COLUMN || column.startsWith("file.") || column.startsWith("formula.")) return null;
  return column.replace(/^prop\./, "");
}

/// Le colonne che la vista mostra: quelle scritte, o quelle dedotte.
const shownColumns = (plan: BasePlan): readonly string[] => (plan.order.length ? plan.order : plan.columns);

/// Il menu della colonna `model.column`: Ordina, Raggruppa e Riepilogo,
/// Rinomina e Tipo, Copia e Nascondi. Quattro gruppi, al più otto voci.
export function columnMenu(model: ColumnMenuModel, actions: ColumnMenuActions): ColumnEntry[] {
  const { plan, column } = model;
  const note = column === NOTE_COLUMN;
  const sortKey = note ? NOTE_SORT_KEY : column;
  // Perché il `.base` non si scrive: sola lettura, Base dentro una nota, o un
  // gesto in volo.
  const fileReason = model.lock === "read_only" ? t("base.lock.read_only")
    : model.lock === "embedded" ? t("base.lock.embedded")
      : model.busy ? t("base.column.busy") : null;
  const writes = fileReason === null;
  const off = (enabled: boolean, reason: string | null) => (enabled ? { enabled: true } : { enabled: false, description: reason ?? "" });
  const primary = plan.sort[0];
  const sortedHere = primary !== undefined && sameKey(primary.key, sortKey);
  const sort = (descending: boolean) => () => {
    const next = sortBy(plan.sort, sortedBy(plan.sort, sortKey)?.key ?? sortKey, descending);
    actions.write("sort", sortValue(next));
  };
  const entries: ColumnEntry[] = [
    { id: "base.column.sort.asc", label: t("base.column.sort_asc"), icon: "base-sort-asc", radio: true, checked: sortedHere && !primary!.descending, ...off(writes, fileReason), run: sort(false) },
    { id: "base.column.sort.desc", label: t("base.column.sort_desc"), icon: "base-sort-desc", radio: true, checked: sortedHere && primary!.descending, ...off(writes, fileReason), run: sort(true) },
  ];
  if (note) {
    entries.push({ id: "base.column.copy", label: t("base_menu.column.copy"), icon: "copy", enabled: true, separator: true, run: () => actions.copy(column) });
    return entries;
  }
  const grouped = model.grouping !== null && sameKey(model.grouping, column);
  const groupGroup: ColumnEntry[] = [];
  if (model.regroupable) {
    groupGroup.push({
      id: "base.column.group", label: t("base.column.group"), icon: "base-group", checked: grouped,
      ...off(writes, fileReason),
      run: () => actions.write("group", grouped ? null : { key: column }),
    });
  }
  const current = columnSummary(plan.summaries, column);
  const choices = summaryChoices(model.kind);
  const summary = (aggregate: BaseAggregate | null): ColumnEntry => ({
    id: `base.column.summary.${aggregate ?? "none"}`,
    label: aggregate === null ? t("base.summary.none") : t(`base.summary.${aggregate}`),
    radio: true, checked: current === aggregate, enabled: true,
    run: () => { if (current !== aggregate) actions.write("summaries", summariesValue(summariesWith(plan.summaries, column, aggregate))); },
  });
  groupGroup.push({
    id: "base.column.summary", label: t("base.column.summary"), icon: "base-sigma",
    ...off(writes, fileReason),
    // Un riepilogo scritto a mano che la specie di adesso non propone resta
    // fra le scelte: il file l'ha scritto così.
    items: [summary(null), ...(current !== null && !choices.includes(current) ? [...choices, current] : choices).map(summary)],
  });
  groupGroup[0] = { ...groupGroup[0]!, separator: true };
  entries.push(...groupGroup);
  const property = columnProperty(column);
  if (property !== null) {
    const noteReason = model.readOnly ? t("base.lock.read_only") : null;
    entries.push(
      { id: "base.column.rename", label: t("base.column.rename"), icon: "pen", separator: true, ...off(!model.readOnly, noteReason), run: () => actions.rename(column) },
      {
        id: "base.column.type", label: t("base.column.type"), icon: "properties", ...off(!model.readOnly, noteReason),
        items: PROPERTY_TYPES.map((type) => ({ id: `base.column.type.${type}`, label: t(`base.type.${type}`), enabled: true, run: () => actions.setType(column, type) })),
      },
    );
  }
  const shown = shownColumns(plan);
  const only = shown.length <= 1 && shown.some((each) => sameKey(each, column));
  entries.push(
    { id: "base.column.copy", label: t("base_menu.column.copy"), icon: "copy", enabled: true, separator: true, run: () => actions.copy(column) },
    {
      id: "base.column.hide", label: t("base.column.hide"), icon: "base-eye-off",
      ...off(writes && !only, fileReason ?? t("base.column.only")),
      run: () => {
        const next = toggleColumn(shown, column, false);
        if (next.length) actions.write("order", next);
      },
    },
  );
  return entries;
}

/// Le voci come righe del menu del clic.
export function columnMenuItems(entries: readonly ColumnEntry[]): MenuItem[] {
  return entries.map((entry): MenuItem => {
    const item: MenuItem = { label: entry.label };
    if (entry.icon) item.icon = entry.icon;
    if (entry.separator) item.separator = true;
    if (!entry.enabled) { item.disabled = true; if (entry.description) item.description = entry.description; }
    if (entry.radio) { item.choice = "radio"; item.checked = entry.checked === true; }
    else if (entry.checked !== undefined) { item.choice = "checkbox"; item.checked = entry.checked; }
    if (entry.items) { item.submenu = true; item.items = columnMenuItems(entry.items); }
    else if (entry.run) item.run = entry.run;
    return item;
  });
}

/// Le voci come parte del menu del tasto destro, coi gruppi divisi da
/// `MENU_RULE`.
export function columnSurfaceItems(entries: readonly ColumnEntry[]): SurfaceMenuEntry[] {
  const out: SurfaceMenuEntry[] = [];
  const item = (entry: ColumnEntry): SurfaceMenuItem => ({
    id: entry.id,
    label: entry.label,
    ...(entry.icon ? { icon: entry.icon } : {}),
    ...(entry.enabled ? {} : { enabled: false, description: entry.description }),
    ...(entry.checked !== undefined ? { checked: entry.checked } : {}),
    ...(entry.radio ? { radio: true } : {}),
    ...(entry.items ? { items: entry.items.map(item) } : entry.run ? { run: entry.run } : {}),
  });
  for (const entry of entries) {
    if (entry.separator && out.length) out.push(MENU_RULE);
    out.push(item(entry));
  }
  return out;
}

/// `key` con la proprietà `from` chiamata `to`, scritta come prima (`prop.x`
/// resta `prop.x`); le altre chiavi restano com'erano.
function renamedKey(key: string, from: string, to: string): string {
  if (!sameKey(key, from)) return key;
  return key.startsWith("prop.") ? `prop.${to}` : to;
}

/// Il filtro con le condizioni sulla proprietà `from` portate su `to`; `null`
/// se nessuna la nomina. Un filtro che la Base non sa ridire non si tocca.
function renamedFilter(filter: FilterDef, from: string, to: string): FilterDef | null {
  if (filter === "all" || "opaque" in filter) return null;
  if ("condition" in filter) {
    const property = filter.condition.property;
    if (property === undefined || !sameKey(property, from)) return null;
    return { condition: { ...filter.condition, property: renamedKey(property, from, to) } };
  }
  if ("not" in filter) {
    const inner = renamedFilter(filter.not, from, to);
    return inner === null ? null : { not: inner };
  }
  const parts = "and" in filter ? filter.and : filter.or;
  let changed = false;
  const next = parts.map((part) => { const moved = renamedFilter(part, from, to); if (moved !== null) changed = true; return moved ?? part; });
  if (!changed) return null;
  return "and" in filter ? { and: next } : { or: next };
}

/// Le chiavi di una vista da riscrivere quando la proprietà `from` si chiama
/// `to`: le colonne, l'ordinamento, il gruppo, i riepiloghi e il filtro che la
/// nominano, ognuna col suo valore nuovo. Vuota se la vista non la nomina.
export function renamedInView(plan: BasePlan, from: string, to: string): [BaseViewKey, unknown][] {
  const out: [BaseViewKey, unknown][] = [];
  const filters = renamedFilter(plan.filters, from, to);
  if (filters !== null) out.push(["filters", filters]);
  if (plan.sort.some((entry) => sameKey(entry.key, from))) {
    out.push(["sort", sortValue(plan.sort.map((entry) => ({ key: renamedKey(entry.key, from, to), descending: entry.descending })))]);
  }
  if (plan.order.some((key) => sameKey(key, from))) out.push(["order", plan.order.map((key) => renamedKey(key, from, to))]);
  if (plan.group !== null && sameKey(plan.group, from)) out.push(["group", { key: renamedKey(plan.group, from, to) }]);
  if (plan.summaries.some((summary) => summary.expression === null && sameKey(summary.key, from))) {
    out.push(["summaries", summariesValue(plan.summaries.map((summary) => summary.expression === null ? { ...summary, key: renamedKey(summary.key, from, to) } : summary))]);
  }
  return out;
}
