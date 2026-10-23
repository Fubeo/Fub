// Trova e sostituisci, Vai a e Vai a formato speciale.
//
// Trova resta aperta mentre si cerca, come in Excel: Invio è «Trova
// successivo», e il provider sposta la selezione sulla cella trovata. «Trova
// tutti» elenca le celle nella finestra; sceglierne una ci porta il foglio.
import { createList, createTabs, textButton } from "../../../kit";
import type { DialogBuilder } from "./host";
import { formDialog } from "./form";
import { renderFields, required, type FieldSpec, type Values } from "./fields";
import { t, type DialogKey } from "./strings";

interface Found {
  readonly sheet: string;
  readonly cell: string;
  readonly value: string;
}

/// L'ultima ricerca, per ripartire da lì quando la finestra si riapre.
let remembered: Values = {};

function foundList(result: unknown): readonly Found[] {
  const list = result && typeof result === "object" ? (result as { results?: unknown }).results : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { sheet, cell, value } = item as Record<string, unknown>;
    return typeof sheet === "string" && typeof cell === "string"
      ? [{ sheet, cell, value: typeof value === "string" ? value : String(value ?? "") }]
      : [];
  });
}

const find: DialogBuilder = (context) => {
  let mode: "find" | "replace" = context.params.replace === true ? "replace" : "find";
  const values: Values = {
    what: "",
    with: "",
    within: "sheet",
    order: "rows",
    lookIn: "formulas",
    matchCase: false,
    wholeCell: false,
    ...remembered,
  };

  const body = document.createElement("div");
  body.className = "grid-dialog-form grid-dialog-find";
  const tablist = document.createElement("div");
  tablist.className = "grid-dialog-tabs";
  const fields = document.createElement("div");
  fields.className = "grid-dialog-fields";
  const buttons = document.createElement("div");
  buttons.className = "grid-dialog-toolbar";
  const status = document.createElement("p");
  status.className = "grid-dialog-note";
  status.setAttribute("role", "status");
  const results = document.createElement("div");
  results.className = "grid-dialog-results";
  results.setAttribute("aria-label", t("grid.dialog.find.results"));
  results.hidden = true;
  body.append(tablist, fields, buttons, status, results);

  const specs = (): readonly FieldSpec[] => [
    { kind: "text", key: "what", label: t("grid.dialog.find.what") },
    ...(mode === "replace" ? [{ kind: "text" as const, key: "with", label: t("grid.dialog.find.with") }] : []),
    {
      kind: "select",
      key: "within",
      label: t("grid.dialog.find.within"),
      options: [
        { value: "sheet", label: t("grid.dialog.find.sheet") },
        { value: "workbook", label: t("grid.dialog.workbook") },
      ],
    },
    {
      kind: "select",
      key: "order",
      label: t("grid.dialog.find.order"),
      options: [
        { value: "rows", label: t("grid.dialog.find.by_rows") },
        { value: "columns", label: t("grid.dialog.find.by_columns") },
      ],
    },
    // Si sostituisce sempre nelle formule: cercare nei valori serve soltanto
    // a trovare.
    ...(mode === "find"
      ? [
          {
            kind: "select" as const,
            key: "lookIn",
            label: t("grid.dialog.find.look_in"),
            options: [
              { value: "formulas", label: t("grid.dialog.find.formulas") },
              { value: "values", label: t("grid.dialog.find.values") },
            ],
          },
        ]
      : []),
    { kind: "check", key: "matchCase", label: t("grid.dialog.find.match_case") },
    { kind: "check", key: "wholeCell", label: t("grid.dialog.find.whole") },
  ];

  const draw = (): void => {
    renderFields(fields, specs(), values, () => {
      remembered = { ...values };
    }, context.life);
    replaceAll.hidden = mode !== "replace";
    replaceOne.hidden = mode !== "replace";
  };

  const base = (): Record<string, unknown> | null => {
    const what = String(values.what ?? "");
    if (!what) {
      context.fail(required(t("grid.dialog.find.what")));
      return null;
    }
    const params: Record<string, unknown> = {
      what,
      matchCase: values.matchCase === true,
      wholeCell: values.wholeCell === true,
      within: values.within,
      byColumns: values.order === "columns",
    };
    if (mode === "find") params.lookIn = values.lookIn;
    return params;
  };

  const say = (text: string): void => {
    status.textContent = text;
  };

  const next = async (): Promise<boolean> => {
    const params = base();
    if (params) {
      say("");
      await context.give("edit.find", params);
    }
    return false;
  };

  const list = createList<Found>({
    container: results,
    role: "listbox",
    items: [],
    key: (item) => `${item.sheet}!${item.cell}`,
    render: (item, row) => {
      row.textContent = t("grid.dialog.find.result", { sheet: item.sheet, cell: item.cell, value: item.value });
    },
    onActivate: (item) => {
      void context.give("selection.set", { sheet: item.sheet, cell: item.cell });
    },
    typeahead: (item) => item.value,
    lifetime: context.life,
  });

  const findAll = textButton({
    label: t("grid.dialog.find.all"),
    lifetime: context.life,
    onPress: async () => {
      const params = base();
      if (!params) return;
      const result = await context.ask("edit.find", { ...params, all: true });
      if (result === undefined) return;
      const found = foundList(result);
      list.setItems(found);
      results.hidden = found.length === 0;
      say(t("grid.dialog.find.found", { count: found.length }));
    },
  });
  const replaceOne = textButton({
    label: t("grid.dialog.find.replace"),
    lifetime: context.life,
    onPress: async () => {
      const params = base();
      if (!params) return;
      if (await context.give("edit.replace", { ...params, with: String(values.with ?? ""), all: false })) {
        await context.give("edit.find", params);
      }
    },
  });
  const replaceAll = textButton({
    label: t("grid.dialog.find.replace_all"),
    lifetime: context.life,
    onPress: async () => {
      const params = base();
      if (!params) return;
      const result = await context.ask("edit.replace", { ...params, with: String(values.with ?? ""), all: true });
      if (result === undefined) return;
      const replaced = (result as { replaced?: unknown }).replaced;
      say(t("grid.dialog.find.replaced", { count: typeof replaced === "number" ? replaced : 0 }));
    },
  });
  buttons.append(replaceAll, replaceOne, findAll);

  createTabs({
    tablist,
    tabs: [
      { id: "find", label: t("grid.dialog.find.tab.find") },
      { id: "replace", label: t("grid.dialog.find.tab.replace") },
    ],
    selected: mode,
    onSelect: (id) => {
      mode = id === "replace" ? "replace" : "find";
      draw();
    },
    lifetime: context.life,
  });
  draw();

  return {
    title: t("grid.dialog.find.title"),
    body,
    className: "grid-dialog-wide",
    actions: [
      { id: "close", label: t("grid.dialog.close") },
      { id: "next", label: t("grid.dialog.find.next"), kind: "primary", run: next },
    ],
    submit: "next",
  };
};

const goTo: DialogBuilder = (context) => {
  const names = context.engine.book()?.names ?? [];
  const values: Values = { name: "", reference: typeof context.params.reference === "string" ? context.params.reference : "" };
  let body: HTMLElement | null = null;
  const spec = formDialog(context, {
    title: t("grid.dialog.go_to.title"),
    values,
    command: "edit.goTo",
    fields: () => [
      names.length
        ? {
            kind: "select",
            key: "name",
            label: t("grid.dialog.go_to.names"),
            size: Math.min(8, Math.max(2, names.length)),
            options: names.map((name) => ({ value: name, label: name })),
          }
        : { kind: "note", text: t("grid.dialog.go_to.none") },
      { kind: "text", key: "reference", label: t("grid.dialog.go_to.reference") },
    ],
    change: (key, current) => {
      if (key !== "name") return false;
      // Scegliere un nome lo scrive nel riferimento, come in Excel.
      current.reference = current.name;
      const input = body?.querySelector<HTMLInputElement>('input[data-key="reference"]');
      if (input) input.value = String(current.name ?? "");
      return false;
    },
    params: (current) => {
      const reference = String(current.reference ?? "").trim().replace(/^=/, "");
      return reference ? { reference } : required(t("grid.dialog.go_to.reference"));
    },
    extra: [
      {
        id: "special",
        label: t("grid.dialog.go_to.special"),
        run: () => {
          context.open("goToSpecial");
          return false;
        },
      },
    ],
  });
  body = spec.body;
  return spec;
};

const SPECIAL: readonly (readonly [string, DialogKey])[] = [
  ["comments", "grid.dialog.special.comments"],
  ["constants", "grid.dialog.special.constants"],
  ["formulas", "grid.dialog.special.formulas"],
  ["numbers", "grid.dialog.special.numbers"],
  ["text", "grid.dialog.special.text"],
  ["errors", "grid.dialog.special.errors"],
  ["blanks", "grid.dialog.special.blanks"],
  ["currentRegion", "grid.dialog.special.region"],
  ["lastCell", "grid.dialog.special.last"],
  ["visible", "grid.dialog.special.visible"],
  ["conditionalFormats", "grid.dialog.special.conditional"],
  ["dataValidation", "grid.dialog.special.validation"],
];

const goToSpecial: DialogBuilder = (context) =>
  formDialog(context, {
    title: t("grid.dialog.special.title"),
    values: { kind: "comments" },
    command: "edit.goToSpecial",
    fields: () => [
      {
        kind: "radio",
        key: "kind",
        label: t("grid.dialog.special.legend"),
        options: SPECIAL.map(([value, label]) => ({ value, label: t(label) })),
      },
    ],
  });

export const FIND_DIALOGS: Readonly<Record<string, DialogBuilder>> = { find, goTo, goToSpecial };
