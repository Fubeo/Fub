// Inserisci funzione: si cerca per nome o descrizione, si sceglie una
// categoria, e la funzione scelta comincia la formula nella cella attiva
// (`SOMMA(`), come la galleria della scheda Formule.
//
// Il catalogo si legge una volta all'apertura; cercare e cambiare categoria
// filtrano qui, senza tornare dal provider a ogni lettera.
import { createList } from "../../../kit";
import type { DialogBuilder } from "./host";
import { renderFields, type Values } from "./fields";
import { resultList } from "./result";
import { t, type DialogKey } from "./strings";

export interface FunctionInfo {
  readonly name: string;
  readonly category: string;
  readonly signature: string;
  readonly description: string;
}

const CATEGORIES: readonly (readonly [string, DialogKey])[] = [
  ["recent", "grid.dialog.function.recent"],
  ["all", "grid.dialog.function.all"],
  ["Financial", "grid.dialog.function.financial"],
  ["DateTime", "grid.dialog.function.datetime"],
  ["MathTrig", "grid.dialog.function.mathtrig"],
  ["Statistical", "grid.dialog.function.statistical"],
  ["Lookup", "grid.dialog.function.lookup"],
  ["Database", "grid.dialog.function.database"],
  ["Text", "grid.dialog.function.text"],
  ["Logical", "grid.dialog.function.logical"],
  ["Information", "grid.dialog.function.information"],
  ["Engineering", "grid.dialog.function.engineering"],
  ["Compatibility", "grid.dialog.function.compatibility"],
  ["Web", "grid.dialog.function.web"],
  ["Cube", "grid.dialog.function.cube"],
];

/// Le funzioni del risultato di `formulas.functions`.
export function functionInfos(result: unknown): readonly FunctionInfo[] {
  return (resultList(result) ?? []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { name, category, signature, description } = item as Record<string, unknown>;
    if (typeof name !== "string" || !name) return [];
    const text = (value: unknown): string => (typeof value === "string" ? value : "");
    return [{ name, category: text(category), signature: text(signature), description: text(description) }];
  });
}

/// Le funzioni che si vedono: della categoria e con la ricerca nel nome o
/// nella descrizione. Con una ricerca la categoria non conta, come in Excel.
export function filterFunctions(
  all: readonly FunctionInfo[],
  recent: readonly string[],
  category: string,
  search: string,
): readonly FunctionInfo[] {
  const query = search.trim().toLowerCase();
  if (query) {
    return all.filter((each) => each.name.toLowerCase().includes(query) || each.description.toLowerCase().includes(query));
  }
  if (category === "recent") {
    const byName = new Map(all.map((each) => [each.name.toUpperCase(), each]));
    return recent.flatMap((name) => byName.get(name.toUpperCase()) ?? []);
  }
  return category === "all" ? all : all.filter((each) => each.category === category);
}

const insertFunction: DialogBuilder = async (context) => {
  const [all, recentResult] = await Promise.all([
    context.read("formulas.functions").then(functionInfos),
    context.read("formulas.recentlyUsed"),
  ]);
  const recent = (resultList(recentResult) ?? []).filter((name): name is string => typeof name === "string");
  const values: Values = { search: "", category: recent.length ? "recent" : "all" };

  const body = document.createElement("div");
  body.className = "grid-dialog-form grid-dialog-function";
  const fields = document.createElement("div");
  fields.className = "grid-dialog-fields";
  const rows = document.createElement("div");
  rows.className = "grid-dialog-results";
  rows.setAttribute("aria-label", t("grid.dialog.function.list"));
  const empty = document.createElement("p");
  empty.className = "grid-dialog-note";
  empty.textContent = t("grid.dialog.function.none");
  const signature = document.createElement("p");
  signature.className = "grid-dialog-signature";
  const description = document.createElement("p");
  description.className = "grid-dialog-note";
  description.setAttribute("aria-live", "polite");
  body.append(fields, rows, empty, signature, description);

  const choose = (item: FunctionInfo): void => {
    if (context.engine.writeFormula(`${item.name}(`)) context.close();
  };

  const list = createList<FunctionInfo>({
    container: rows,
    role: "listbox",
    items: [],
    key: (item) => item.name,
    render: (item, row) => {
      row.textContent = item.name;
    },
    onActivate: (item) => choose(item),
    onHighlight: (item) => show(item),
    typeahead: (item) => item.name,
    lifetime: context.life,
  });

  const show = (item: FunctionInfo | null): void => {
    signature.textContent = item?.signature ?? "";
    description.textContent = item?.description ?? "";
  };

  const refresh = (): void => {
    const shown = filterFunctions(all, recent, String(values.category), String(values.search ?? ""));
    list.setItems(shown);
    rows.hidden = shown.length === 0;
    empty.hidden = shown.length > 0;
    if (shown.length && !list.active()) list.setActive(shown[0]!.name);
    show(list.active());
  };

  renderFields(
    fields,
    [
      { kind: "text", key: "search", label: t("grid.dialog.function.search") },
      {
        kind: "select",
        key: "category",
        label: t("grid.dialog.function.category"),
        options: CATEGORIES.filter(([value]) => value !== "recent" || recent.length).map(([value, label]) => ({ value, label: t(label) })),
      },
    ],
    values,
    () => refresh(),
    context.life,
  );
  // Le frecce nel campo di ricerca scorrono l'elenco, come in Excel.
  const search = fields.querySelector<HTMLInputElement>('input[data-key="search"]');
  if (search) {
    context.life.listen(search, "keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      rows.focus();
    });
  }
  refresh();

  return {
    title: t("grid.dialog.function.title"),
    body,
    className: "grid-dialog-wide",
    actions: [
      { id: "cancel", label: t("grid.dialog.cancel") },
      {
        id: "ok",
        label: t("grid.dialog.ok"),
        kind: "primary",
        run: () => {
          const item = list.active();
          return item ? context.engine.writeFormula(`${item.name}(`) : false;
        },
      },
    ],
    submit: "ok",
  };
};

export const FUNCTION_DIALOGS: Readonly<Record<string, DialogBuilder>> = { insertFunction };
