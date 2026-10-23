// Le finestre delle celle e dei fogli: Inserisci ed Elimina celle, altezza e
// larghezza, rinomina, sposta, scopri, zoom e ridimensiona tabella.
//
// Excel parla di righe in punti e di colonne in caratteri, il modello in
// pixel: le conversioni sono quelle di GridCraft (`cmd::format`), perché il
// numero proposto sia quello che il provider rileggerebbe.
import type { DialogBuilder } from "./host";
import { formDialog } from "./form";
import { required, type Values } from "./fields";
import { columnLetters } from "./refs";
import { t } from "./strings";

/// I pixel di una riga in punti, come `rowHeight {points}` li rilegge.
export function pixelsToPoints(pixels: number): number {
  return Math.round(pixels * 0.75 * 100) / 100;
}

/// I pixel di una colonna in caratteri (`points_to_chars`).
export function pixelsToChars(pixels: number): number {
  if (pixels <= 12) return Math.round((pixels / 12) * 100) / 100;
  return Math.trunc(((pixels - 5) / 7) * 100 + 0.5) / 100;
}

/// I caratteri di una colonna in pixel (`chars_to_points`).
export function charsToPixels(chars: number): number {
  return chars >= 1 ? Math.round(chars * 7 + 5) : Math.round(chars * 12);
}

const insertCells: DialogBuilder = (context) =>
  formDialog(context, {
    title: t("grid.dialog.insert_cells.title"),
    values: { shift: "down" },
    command: "home.insertCells",
    fields: () => [
      {
        kind: "radio",
        key: "shift",
        label: t("grid.dialog.insert_cells.legend"),
        options: [
          { value: "right", label: t("grid.dialog.insert_cells.right") },
          { value: "down", label: t("grid.dialog.insert_cells.down") },
          { value: "row", label: t("grid.dialog.cells.row") },
          { value: "column", label: t("grid.dialog.cells.column") },
        ],
      },
    ],
  });

const deleteCells: DialogBuilder = (context) =>
  formDialog(context, {
    title: t("grid.dialog.delete_cells.title"),
    values: { shift: "up" },
    command: "home.deleteCells",
    fields: () => [
      {
        kind: "radio",
        key: "shift",
        label: t("grid.dialog.delete_cells.legend"),
        options: [
          { value: "left", label: t("grid.dialog.delete_cells.left") },
          { value: "up", label: t("grid.dialog.delete_cells.up") },
          { value: "row", label: t("grid.dialog.cells.row") },
          { value: "column", label: t("grid.dialog.cells.column") },
        ],
      },
    ],
  });

const rowHeight: DialogBuilder = (context) => {
  const row = context.engine.selection().focus.row;
  const pixels = context.engine.lineSize("row", row) ?? 20;
  return formDialog(context, {
    title: t("grid.dialog.row_height.title"),
    values: { points: pixelsToPoints(pixels) },
    command: "home.rowHeight",
    fields: () => [{ kind: "number", key: "points", label: t("grid.dialog.row_height.label"), min: 0, max: 409 }],
  });
};

const columnWidth: DialogBuilder = (context) => {
  const column = context.engine.selection().focus.column;
  const pixels = context.engine.lineSize("column", column) ?? 64;
  return formDialog(context, {
    title: t("grid.dialog.column_width.title"),
    values: { chars: pixelsToChars(pixels) },
    command: "home.columnWidth",
    fields: () => [{ kind: "number", key: "chars", label: t("grid.dialog.column_width.label"), min: 0, max: 255 }],
  });
};

const defaultWidth: DialogBuilder = (context) =>
  formDialog(context, {
    title: t("grid.dialog.default_width.title"),
    values: { chars: 8.43 },
    command: "home.defaultWidth",
    fields: () => [{ kind: "number", key: "chars", label: t("grid.dialog.default_width.label"), min: 0, max: 255 }],
    params: (values) => ({ width: charsToPixels(values.chars as number) }),
  });

const renameSheet: DialogBuilder = (context) => {
  const sheet = typeof context.params.sheet === "string" ? context.params.sheet : context.engine.selectionRefs().sheet;
  return formDialog(context, {
    title: t("grid.dialog.rename_sheet.title"),
    values: { name: sheet },
    command: "sheet.rename",
    fields: () => [{ kind: "text", key: "name", label: t("grid.dialog.rename_sheet.label") }],
    params: (values) => ({ sheet, name: String(values.name ?? "").trim() }),
  });
};

/// L'indice che `sheet.move` vuole per mettere il foglio `from` prima di
/// `before` (`null` è la fine). Senza copia il provider toglie il foglio prima
/// di rimetterlo: chi stava dopo scala di uno.
export function moveTarget(from: number, before: number | null, count: number, copy: boolean): number {
  if (copy) return before ?? count;
  if (before === null) return count - 1;
  return before > from ? before - 1 : before;
}

const moveSheet: DialogBuilder = (context) => {
  const names = context.engine.sheetNames();
  const sheet = typeof context.params.sheet === "string" ? context.params.sheet : context.engine.selectionRefs().sheet;
  const from = Math.max(0, names.indexOf(sheet));
  return formDialog(context, {
    title: t("grid.dialog.move_sheet.title"),
    values: { before: names[from + 1] !== undefined ? String(from + 1) : "end", copy: false },
    command: "sheet.move",
    fields: () => [
      {
        kind: "select",
        key: "before",
        label: t("grid.dialog.move_sheet.before"),
        size: Math.min(8, names.length + 1),
        options: [
          ...names.map((name, index) => ({ value: String(index), label: name })),
          { value: "end", label: t("grid.dialog.move_sheet.end") },
        ],
      },
      { kind: "check", key: "copy", label: t("grid.dialog.move_sheet.copy") },
    ],
    params: (values) => {
      const before = values.before === "end" ? null : Number(values.before);
      const copy = values.copy === true;
      return { sheet, to: moveTarget(from, before, names.length, copy), copy };
    },
  });
};

const unhideSheet: DialogBuilder = (context) => {
  const asked = Array.isArray(context.params.sheets)
    ? context.params.sheets.filter((name): name is string => typeof name === "string")
    : context.engine.hiddenSheets().map((sheet) => sheet.name);
  return formDialog(context, {
    title: t("grid.dialog.unhide_sheet.title"),
    values: { sheet: asked[0] ?? "" },
    command: "sheet.unhide",
    fields: () =>
      asked.length
        ? [
            {
              kind: "select",
              key: "sheet",
              label: t("grid.dialog.unhide_sheet.legend"),
              size: Math.min(8, Math.max(2, asked.length)),
              options: asked.map((name) => ({ value: name, label: name })),
            },
          ]
        : [{ kind: "note", text: t("grid.dialog.unhide_sheet.none") }],
    params: (values) => (asked.length ? { sheet: values.sheet } : t("grid.dialog.unhide_sheet.none")),
  });
};

/// Gli ingrandimenti dell'elenco di Excel.
const ZOOMS = ["200", "100", "75", "50", "25"];

const zoom: DialogBuilder = (context) => {
  const percent = context.engine.sheetView().zoom;
  const preset = (value: unknown): string => (ZOOMS.includes(String(value)) ? String(value) : "custom");
  const values: Values = { preset: preset(percent), percent };
  let body: HTMLElement | null = null;
  const spec = formDialog(context, {
    title: t("grid.dialog.zoom.title"),
    values,
    command: (current) => (current.preset === "fit" ? "view.zoomToSelection" : "view.zoom"),
    fields: () => [
      {
        kind: "radio",
        key: "preset",
        label: t("grid.dialog.zoom.legend"),
        options: [
          ...ZOOMS.map((value) => ({ value, label: `${value}%` })),
          { value: "fit", label: t("grid.dialog.zoom.fit") },
          { value: "custom", label: t("grid.dialog.zoom.custom") },
        ],
      },
      { kind: "number", key: "percent", label: t("grid.dialog.zoom.percent"), min: 10, max: 400, step: 1 },
    ],
    change: (key, current) => {
      if (key === "preset" && ZOOMS.includes(String(current.preset))) {
        current.percent = Number(current.preset);
        return true;
      }
      if (key === "percent") {
        // Scrivere una percentuale sceglie «Personalizzato», o la voce che
        // la dice, senza ridisegnare il campo in cui si scrive.
        current.preset = preset(current.percent);
        for (const radio of body?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []) {
          radio.checked = radio.value === current.preset;
        }
      }
      return false;
    },
    params: (current) => {
      if (current.preset === "fit") {
        const view = context.engine.viewportSize();
        return { viewWidth: view.width, viewHeight: view.height };
      }
      return { percent: Math.round(current.percent as number) };
    },
  });
  body = spec.body;
  return spec;
};

const tableResize: DialogBuilder = (context) => {
  const { row, column } = context.engine.selection().focus;
  const table = context.engine
    .tables()
    .find((each) => row >= each.row && row < each.row + each.rows && column >= each.column && column < each.column + each.columns);
  if (!table) return null;
  const range = `${columnLetters(table.column)}${table.row + 1}:${columnLetters(table.column + table.columns - 1)}${table.row + table.rows}`;
  return formDialog(context, {
    title: t("grid.dialog.table_resize.title"),
    values: { range },
    command: "table.resize",
    fields: () => [{ kind: "text", key: "range", label: t("grid.dialog.table_resize.range") }],
    params: (values) => {
      const text = String(values.range ?? "").trim().replace(/^=/, "");
      return text ? { table: table.name, range: text } : required(t("grid.dialog.table_resize.range"));
    },
  });
};

export const CELL_DIALOGS: Readonly<Record<string, DialogBuilder>> = {
  insertCells,
  deleteCells,
  rowHeight,
  columnWidth,
  defaultWidth,
  renameSheet,
  moveSheet,
  unhideSheet,
  zoom,
  tableResize,
};
