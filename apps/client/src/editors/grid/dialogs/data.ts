// Le finestre dei dati: Serie, Testo in colonne, Rimuovi duplicati, Filtro
// avanzato, Subtotali e Ricerca obiettivo.
//
// Partono dalla selezione, come in Excel. Le colonne si scelgono per nome
// quando la selezione è un'area che si legge; altrimenti si scrivono a lettere
// («A,C»), e il provider rifiuta con la sua ragione quelle fuori dall'area.
import type { DialogBuilder, DialogContext, Params } from "./host";
import { formDialog } from "./form";
import { readNumber, required, type FieldSpec, type Values } from "./fields";
import { cellName, columnIndex, columnLetters, parseArea, type Area } from "./refs";
import { t } from "./strings";

/// Le colonne scritte a lettere («A, C»): l'elenco, o la ragione per cui non
/// si leggono.
export function columnList(text: string, label: string): readonly string[] | string {
  const parts = text
    .split(/[,;\s]+/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  for (const part of parts) {
    if (columnIndex(part) === null) return t("grid.dialog.error.required", { label: label.replace(/:$/, "") });
  }
  return parts;
}

function selectedArea(context: DialogContext): Area | null {
  return parseArea(context.engine.selectionRefs().range);
}

/// Il testo della prima riga di un'area, colonna per colonna: i nomi delle
/// intestazioni. Non più di 64 colonne, perché ognuna è una lettura.
async function headerNames(context: DialogContext, area: Area): Promise<readonly string[]> {
  const columns = Math.min(64, area.lastColumn - area.column + 1);
  return Promise.all(
    Array.from({ length: columns }, async (_, offset) => {
      const info = await context.read("cell.get", { cell: cellName(area.row, area.column + offset) });
      const text = info && typeof info === "object" ? (info as { text?: unknown }).text : undefined;
      return typeof text === "string" ? text : "";
    }),
  );
}

function columnLabel(column: number, name: string): string {
  const letters = columnLetters(column);
  return name ? t("grid.dialog.column.named", { column: letters, name }) : t("grid.dialog.column", { column: letters });
}

const series: DialogBuilder = (context) => {
  const area = selectedArea(context);
  // Excel riempie lungo il lato lungo della selezione.
  const rows = area !== null && area.lastColumn - area.column > area.lastRow - area.row;
  return formDialog(context, {
    title: t("grid.dialog.series.title"),
    values: { direction: rows ? "rows" : "columns", type: "linear", dateUnit: "day", step: 1, stop: "" },
    command: "edit.fillSeries",
    fields: (values) => [
      {
        kind: "radio",
        key: "direction",
        label: t("grid.dialog.series.direction"),
        options: [
          { value: "rows", label: t("grid.dialog.series.rows") },
          { value: "columns", label: t("grid.dialog.series.columns") },
        ],
      },
      {
        kind: "radio",
        key: "type",
        label: t("grid.dialog.series.type"),
        options: [
          { value: "linear", label: t("grid.dialog.series.linear") },
          { value: "growth", label: t("grid.dialog.series.growth") },
          { value: "date", label: t("grid.dialog.series.date") },
          { value: "autofill", label: t("grid.dialog.series.autofill") },
        ],
      },
      {
        kind: "radio",
        key: "dateUnit",
        label: t("grid.dialog.series.unit"),
        disabled: values.type !== "date",
        options: [
          { value: "day", label: t("grid.dialog.series.day") },
          { value: "weekday", label: t("grid.dialog.series.weekday") },
          { value: "month", label: t("grid.dialog.series.month") },
          { value: "year", label: t("grid.dialog.series.year") },
        ],
      },
      { kind: "number", key: "step", label: t("grid.dialog.series.step"), disabled: values.type === "autofill" },
      { kind: "text", key: "stop", label: t("grid.dialog.series.stop"), disabled: values.type === "autofill" },
    ],
    change: (key) => key === "type",
    params: (values) => {
      const params: Record<string, unknown> = { direction: values.direction, type: values.type };
      if (values.type === "autofill") return params;
      if (values.type === "date") params.dateUnit = values.dateUnit;
      params.step = values.step;
      const stop = readNumber(String(values.stop ?? ""));
      if (typeof stop === "number") params.stop = stop;
      else if (stop !== "") return t("grid.dialog.error.number", { label: t("grid.dialog.series.stop").replace(/:$/, "") });
      return params;
    },
  });
};

const DELIMITERS: readonly (readonly ["tab" | "semicolon" | "comma" | "space", string])[] = [
  ["tab", "\t"],
  ["semicolon", ";"],
  ["comma", ","],
  ["space", " "],
];

const textToColumns: DialogBuilder = (context) =>
  formDialog(context, {
    title: t("grid.dialog.text_columns.title"),
    values: {
      tab: true,
      semicolon: false,
      comma: false,
      space: false,
      other: "",
      treatConsecutive: false,
      textQualifier: '"',
      destination: context.engine.selectionRefs().active,
    },
    command: "data.textToColumns",
    fields: () => [
      {
        kind: "section",
        label: t("grid.dialog.text_columns.delimiters"),
        fields: [
          ...DELIMITERS.map(([key]) => ({ kind: "check" as const, key, label: t(`grid.dialog.text_columns.${key}`) })),
          { kind: "text", key: "other", label: t("grid.dialog.text_columns.other") },
        ],
      },
      { kind: "check", key: "treatConsecutive", label: t("grid.dialog.text_columns.consecutive") },
      {
        kind: "select",
        key: "textQualifier",
        label: t("grid.dialog.text_columns.qualifier"),
        options: [
          { value: '"', label: '"' },
          { value: "'", label: "'" },
          { value: "", label: t("grid.dialog.text_columns.qualifier.none") },
        ],
      },
      { kind: "text", key: "destination", label: t("grid.dialog.text_columns.destination") },
    ],
    params: (values) => {
      const params: Record<string, unknown> = {
        delimiters: DELIMITERS.filter(([key]) => values[key] === true).map(([, mark]) => mark),
        treatConsecutive: values.treatConsecutive === true,
        textQualifier: values.textQualifier,
      };
      const other = String(values.other ?? "");
      if (other) params.other = other.slice(0, 1);
      const destination = String(values.destination ?? "").trim();
      if (destination) params.destination = destination;
      return params;
    },
  });

const removeDuplicates: DialogBuilder = async (context) => {
  const area = selectedArea(context);
  const many = area !== null && area.lastColumn > area.column && area.lastRow > area.row;
  const names = many ? await headerNames(context, area) : [];
  const keys = names.map((_, offset) => `column${offset}`);
  const values: Values = { header: true, columnsText: "" };
  for (const key of keys) values[key] = true;

  const columnFields = (current: Values): readonly FieldSpec[] =>
    names.map((name, offset) => ({
      kind: "check" as const,
      key: keys[offset]!,
      label: current.header === true ? columnLabel(area!.column + offset, name) : columnLabel(area!.column + offset, ""),
    }));

  const spec = formDialog(context, {
    title: t("grid.dialog.duplicates.title"),
    values,
    command: "data.removeDuplicates",
    fields: (current) => [
      { kind: "check", key: "header", label: t("grid.dialog.duplicates.header") },
      names.length
        ? { kind: "section", label: t("grid.dialog.duplicates.columns"), fields: columnFields(current) }
        : { kind: "text", key: "columnsText", label: t("grid.dialog.duplicates.columns_text") },
    ],
    change: (key) => key === "header",
    extra: names.length
      ? [
          {
            id: "all",
            label: t("grid.dialog.duplicates.select_all"),
            run: () => toggle(true),
          },
          {
            id: "none",
            label: t("grid.dialog.duplicates.unselect_all"),
            run: () => toggle(false),
          },
        ]
      : [],
    params: (current) => {
      const params: Record<string, unknown> = { header: current.header === true };
      if (names.length) {
        const columns = keys.flatMap((key, offset) => (current[key] === true ? [columnLetters(area!.column + offset)] : []));
        if (!columns.length) return t("grid.dialog.error.columns");
        params.columns = columns;
      } else {
        const columns = columnList(String(current.columnsText ?? ""), t("grid.dialog.duplicates.columns_text"));
        if (typeof columns === "string") return columns;
        if (columns.length) params.columns = columns;
      }
      return params;
    },
    done: (result) => {
      const counts = result as { removed?: unknown; remaining?: unknown };
      if (typeof counts.removed === "number") {
        context.open("message", {
          title: t("grid.dialog.duplicates.title"),
          text: t("grid.dialog.duplicates.done", { removed: counts.removed, kept: String(counts.remaining ?? "") }),
        });
      }
    },
  });
  return spec;

  // Seleziona tutto e Deseleziona tutto cambiano le caselle senza chiudere.
  function toggle(on: boolean): boolean {
    for (const key of keys) {
      values[key] = on;
      const input = spec.body.querySelector<HTMLInputElement>(`input[data-key="${key}"]`);
      if (input) input.checked = on;
    }
    return false;
  }
};

const advancedFilter: DialogBuilder = (context) => {
  const range = context.engine.selectionRefs().range;
  const string = (key: string, fallback: string): string =>
    typeof context.params[key] === "string" ? (context.params[key] as string) : fallback;
  return formDialog(context, {
    title: t("grid.dialog.advanced_filter.title"),
    values: {
      action: string("action", "inPlace"),
      range: string("range", parseArea(range) && range.includes(":") ? range : ""),
      criteria: string("criteria", ""),
      copyTo: string("copyTo", ""),
      unique: context.params.unique === true,
    },
    command: "data.advancedFilter",
    fields: (values) => [
      {
        kind: "radio",
        key: "action",
        label: t("grid.dialog.advanced_filter.action"),
        options: [
          { value: "inPlace", label: t("grid.dialog.advanced_filter.in_place") },
          { value: "copy", label: t("grid.dialog.advanced_filter.copy") },
        ],
      },
      { kind: "text", key: "range", label: t("grid.dialog.advanced_filter.range") },
      { kind: "text", key: "criteria", label: t("grid.dialog.advanced_filter.criteria") },
      { kind: "text", key: "copyTo", label: t("grid.dialog.advanced_filter.copy_to"), disabled: values.action !== "copy" },
      { kind: "check", key: "unique", label: t("grid.dialog.advanced_filter.unique") },
    ],
    change: (key) => key === "action",
    params: (values) => {
      const params: Record<string, unknown> = { unique: values.unique === true };
      for (const key of ["range", "criteria"] as const) {
        const text = String(values[key] ?? "").trim();
        if (text) params[key] = text;
      }
      if (values.action === "copy") {
        const copyTo = String(values.copyTo ?? "").trim();
        if (!copyTo) return required(t("grid.dialog.advanced_filter.copy_to"));
        params.copyTo = copyTo;
      }
      return params;
    },
  });
};

const FUNCTIONS = ["sum", "count", "average", "max", "min", "product"] as const;

const subtotal: DialogBuilder = async (context) => {
  const area = selectedArea(context);
  const many = area !== null && area.lastColumn > area.column;
  const names = many ? await headerNames(context, area) : [];
  const options = names.map((name, offset) => ({
    value: columnLetters(area!.column + offset),
    label: columnLabel(area!.column + offset, name),
  }));
  const first = area ? columnLetters(area.column) : "A";
  const last = area ? columnLetters(area.lastColumn) : "A";
  return formDialog(context, {
    title: t("grid.dialog.subtotal.title"),
    values: { groupBy: first, function: "sum", columnsText: last, header: true },
    command: "data.subtotal",
    fields: () => [
      options.length
        ? { kind: "select", key: "groupBy", label: t("grid.dialog.subtotal.group_by"), options }
        : { kind: "text", key: "groupBy", label: t("grid.dialog.subtotal.group_by") },
      {
        kind: "select",
        key: "function",
        label: t("grid.dialog.subtotal.function"),
        options: FUNCTIONS.map((value) => ({ value, label: t(`grid.dialog.subtotal.${value}`) })),
      },
      { kind: "text", key: "columnsText", label: t("grid.dialog.subtotal.columns") },
      { kind: "check", key: "header", label: t("grid.dialog.subtotal.header") },
    ],
    params: (values) => {
      const groupBy = String(values.groupBy ?? "").trim().toUpperCase();
      if (columnIndex(groupBy) === null) return required(t("grid.dialog.subtotal.group_by"));
      const columns = columnList(String(values.columnsText ?? ""), t("grid.dialog.subtotal.columns"));
      if (typeof columns === "string") return columns;
      if (!columns.length) return t("grid.dialog.error.columns");
      return { groupBy, function: values.function, columns, header: values.header === true };
    },
  });
};

const goalSeek: DialogBuilder = (context) => {
  const values: Values = { set: context.engine.selectionRefs().active, to: 0, changing: "" };
  return formDialog(context, {
    title: t("grid.dialog.goal_seek.title"),
    values,
    command: "data.goalSeek",
    fields: () => [
      { kind: "text", key: "set", label: t("grid.dialog.goal_seek.set") },
      { kind: "number", key: "to", label: t("grid.dialog.goal_seek.to") },
      { kind: "text", key: "changing", label: t("grid.dialog.goal_seek.changing") },
    ],
    params: (current) => {
      const set = String(current.set ?? "").trim().replace(/^=/, "");
      const changing = String(current.changing ?? "").trim().replace(/^=/, "");
      if (!set) return required(t("grid.dialog.goal_seek.set"));
      if (!changing) return required(t("grid.dialog.goal_seek.changing"));
      return { set, to: current.to, changing };
    },
    done: (result) => {
      const found = result && typeof result === "object" ? (result as Params) : {};
      context.open("goalSeekStatus", {
        ...found,
        cell: String(values.set ?? "").trim().replace(/^=/, ""),
        to: values.to,
        changing: String(values.changing ?? "").trim().replace(/^=/, ""),
      });
    },
  });
};

/// Lo stato della ricerca: trovata o no, il valore voluto e quello raggiunto.
/// Il valore trovato è già scritto: Ctrl+Z lo toglie, come dopo ogni comando.
const goalSeekStatus: DialogBuilder = (context) => {
  const { converged, result, cell, to, changing } = context.params as Record<string, unknown>;
  const body = document.createElement("div");
  body.className = "grid-dialog-form";
  const line = (text: string): HTMLParagraphElement => {
    const element = document.createElement("p");
    element.className = "grid-dialog-note";
    element.textContent = text;
    return element;
  };
  const where = String(cell ?? "");
  body.append(
    line(t(converged === true ? "grid.dialog.goal_seek.found" : "grid.dialog.goal_seek.missed", { cell: where })),
    line(t("grid.dialog.goal_seek.target", { value: String(to ?? "") })),
    line(t("grid.dialog.goal_seek.current", { value: String(result ?? "") })),
  );
  if (changing) body.append(line(t("grid.dialog.goal_seek.undo", { cell: String(changing) })));
  return {
    title: t("grid.dialog.goal_seek.status"),
    body,
    actions: [{ id: "ok", label: t("grid.dialog.ok"), kind: "primary" }],
    submit: "ok",
  };
};

/// Un messaggio con il solo OK, per dire com'è andato un comando.
const message: DialogBuilder = (context) => {
  const body = document.createElement("div");
  body.className = "grid-dialog-form";
  const text = document.createElement("p");
  text.className = "grid-dialog-note";
  text.textContent = String(context.params.text ?? "");
  body.append(text);
  return {
    title: String(context.params.title ?? ""),
    body,
    actions: [{ id: "ok", label: t("grid.dialog.ok"), kind: "primary" }],
    submit: "ok",
  };
};

export const DATA_DIALOGS: Readonly<Record<string, DialogBuilder>> = {
  series,
  textToColumns,
  removeDuplicates,
  advancedFilter,
  subtotal,
  goalSeek,
  goalSeekStatus,
  message,
};
