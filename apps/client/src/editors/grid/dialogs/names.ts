// Gestione nomi e Definisci nome.
//
// Gestione nomi elenca i nomi della cartella con valore, riferimento e
// ambito. «Nuovo…» e «Modifica…» aprono Definisci nome sopra di lei, e
// chiudendola si torna all'elenco riletto. L'ambito della cartella si chiama
// `Workbook` nel provider, qualunque sia la lingua.
import { createList, textButton } from "../../../kit";
import type { DialogBuilder, DialogContext } from "./host";
import { resultList } from "./host";
import { formDialog } from "./form";
import { required } from "./fields";
import { absolute, parseArea, quoteSheet } from "./refs";
import { t } from "./strings";

const WORKBOOK = "Workbook";

export interface DefinedName {
  readonly name: string;
  readonly value: string;
  readonly refersTo: string;
  readonly scope: string;
  readonly comment: string;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // Un valore di errore o un elenco: il provider lo dice con un oggetto.
    const shown = (value as { text?: unknown; error?: unknown }).text ?? (value as { error?: unknown }).error;
    return shown === undefined ? JSON.stringify(value) : String(shown);
  }
  return String(value);
}

/// I nomi del risultato di `formulas.nameManager`.
export function definedNames(result: unknown): readonly DefinedName[] {
  return (resultList(result) ?? []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.name !== "string") return [];
    return [
      {
        name: entry.name,
        value: text(entry.value),
        refersTo: text(entry.refersTo),
        scope: typeof entry.scope === "string" ? entry.scope : WORKBOOK,
        comment: text(entry.comment),
      },
    ];
  });
}

function scopeLabel(scope: string): string {
  return scope === WORKBOOK ? t("grid.dialog.workbook") : scope;
}

async function readNames(context: DialogContext): Promise<readonly DefinedName[]> {
  return definedNames(await context.read("formulas.nameManager"));
}

const nameManager: DialogBuilder = async (context) => {
  let names = await readNames(context);
  const body = document.createElement("div");
  body.className = "grid-dialog-form grid-dialog-names";
  const toolbar = document.createElement("div");
  toolbar.className = "grid-dialog-toolbar";
  const head = document.createElement("div");
  head.className = "grid-dialog-names-head";
  head.setAttribute("aria-hidden", "true");
  for (const key of ["name", "value", "refers", "scope"] as const) {
    const cell = document.createElement("span");
    cell.textContent = t(`grid.dialog.names.column.${key}`);
    head.append(cell);
  }
  const rows = document.createElement("div");
  rows.className = "grid-dialog-results grid-dialog-names-list";
  rows.setAttribute("aria-label", t("grid.dialog.names.list"));
  const empty = document.createElement("p");
  empty.className = "grid-dialog-note";
  empty.textContent = t("grid.dialog.names.none");
  body.append(toolbar, head, rows, empty);

  const list = createList<DefinedName>({
    container: rows,
    role: "listbox",
    items: names,
    key: (item) => `${item.scope}\u0000${item.name}`,
    render: (item, row) => {
      row.classList.add("grid-dialog-names-row");
      for (const part of [item.name, item.value, item.refersTo, scopeLabel(item.scope)]) {
        const cell = document.createElement("span");
        cell.textContent = part;
        row.append(cell);
      }
      // Il nome accessibile dice tutte e quattro le colonne, con i titoli.
      row.setAttribute(
        "aria-label",
        `${item.name}, ${t("grid.dialog.names.column.value")} ${item.value}, ${t("grid.dialog.names.column.refers")} ${item.refersTo}, ${t("grid.dialog.names.column.scope")} ${scopeLabel(item.scope)}`,
      );
    },
    onActivate: (item) => editName(item),
    onHighlight: () => refresh(),
    typeahead: (item) => item.name,
    lifetime: context.life,
  });

  const editName = (item: DefinedName): void => {
    context.open(
      "defineName",
      { name: item.name, scope: item.scope, refersTo: item.refersTo, comment: item.comment, oldName: item.name, oldScope: item.scope },
      true,
    );
  };

  const create = textButton({
    label: t("grid.dialog.names.new"),
    lifetime: context.life,
    onPress: () => context.open("defineName", {}, true),
  });
  const edit = textButton({
    label: t("grid.dialog.names.edit"),
    lifetime: context.life,
    onPress: () => {
      const item = list.active();
      if (item) editName(item);
    },
  });
  const remove = textButton({
    label: t("grid.dialog.names.delete"),
    kind: "danger",
    lifetime: context.life,
    onPress: async () => {
      const item = list.active();
      if (!item || !(await context.give("formulas.deleteName", { name: item.name, scope: item.scope }))) return;
      names = await readNames(context);
      list.setItems(names);
      refresh();
      rows.focus();
    },
  });
  toolbar.append(create, edit, remove);

  const refresh = (): void => {
    const some = names.length > 0;
    rows.hidden = !some;
    head.hidden = !some;
    empty.hidden = some;
    edit.disabled = !list.active();
    remove.disabled = !list.active();
  };
  refresh();

  return {
    title: t("grid.dialog.names.title"),
    body,
    className: "grid-dialog-wide",
    actions: [{ id: "close", label: t("grid.dialog.close"), kind: "primary" }],
    submit: "close",
  };
};

const defineName: DialogBuilder = (context) => {
  const { sheet, range } = context.engine.selectionRefs();
  const area = parseArea(range);
  const string = (key: string): string | undefined =>
    typeof context.params[key] === "string" ? (context.params[key] as string) : undefined;
  const editing = string("oldName") !== undefined;
  const sheets = context.engine.sheetNames();
  return formDialog(context, {
    title: t(editing ? "grid.dialog.name.edit" : "grid.dialog.name.new"),
    values: {
      name: string("name") ?? "",
      scope: string("scope") ?? WORKBOOK,
      comment: string("comment") ?? "",
      refersTo: string("refersTo") ?? (area ? `=${quoteSheet(sheet)}!${absolute(area)}` : `=${quoteSheet(sheet)}!$A$1`),
    },
    command: "formulas.defineName",
    fields: () => [
      { kind: "text", key: "name", label: t("grid.dialog.name.name") },
      {
        kind: "select",
        key: "scope",
        label: t("grid.dialog.name.scope"),
        // Si cambia l'ambito di un nome soltanto rifacendolo, come in Excel.
        disabled: editing,
        options: [{ value: WORKBOOK, label: t("grid.dialog.workbook") }, ...sheets.map((name) => ({ value: name, label: name }))],
      },
      { kind: "area", key: "comment", label: t("grid.dialog.name.comment"), rows: 3 },
      { kind: "text", key: "refersTo", label: t("grid.dialog.name.refers") },
    ],
    params: (values) => {
      const name = String(values.name ?? "").trim();
      if (!name) return required(t("grid.dialog.name.name"));
      const refersTo = String(values.refersTo ?? "").trim();
      if (!refersTo || refersTo === "=") return required(t("grid.dialog.name.refers"));
      const params: Record<string, unknown> = {
        name,
        scope: editing ? (string("scope") ?? WORKBOOK) : values.scope,
        comment: String(values.comment ?? ""),
        refersTo,
      };
      const oldName = string("oldName");
      if (oldName !== undefined) {
        params.oldName = oldName;
        params.oldScope = string("oldScope") ?? WORKBOOK;
      }
      return params;
    },
  });
};

export const NAME_DIALOGS: Readonly<Record<string, DialogBuilder>> = { nameManager, defineName };
