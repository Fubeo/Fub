// Ordinamento personalizzato: i livelli «Ordina per», «Poi per», ognuno con
// la colonna, su che cosa e l'ordine.
//
// Come in Excel i pulsanti dei livelli stanno sopra l'elenco e lavorano sul
// livello in cui si trova il fuoco: Elimina, Sposta su e Sposta giù sanno
// sempre di quale si parla senza una selezione in più da tenere.
import { textButton } from "../../../kit";
import type { DialogBuilder } from "./host";
import { formHandle } from "./form";
import type { Choice, FieldSpec, Values } from "./fields";
import { cellName, columnIndex, columnLetters, parseArea } from "./refs";
import { t } from "./strings";

interface Level {
  column: string;
  by: string;
  order: string;
}

/// I campi di un livello hanno la chiave `column3`, `by3`, `order3`.
const LEVEL_KEY = /^(column|by|order)(\d+)$/;

const sort: DialogBuilder = async (context) => {
  const asked = typeof context.params.range === "string" ? context.params.range : context.engine.selectionRefs().range;
  const area = parseArea(asked.replace(/^.*!/, ""));
  const columns: Choice[] = [];
  if (area) {
    const count = Math.min(64, area.lastColumn - area.column + 1);
    const names = await Promise.all(
      Array.from({ length: count }, async (_, offset) => {
        const info = await context.read("cell.get", { cell: cellName(area.row, area.column + offset) });
        const text = info && typeof info === "object" ? (info as { text?: unknown }).text : undefined;
        return typeof text === "string" ? text.slice(0, 24) : "";
      }),
    );
    names.forEach((name, offset) => {
      const column = columnLetters(area.column + offset);
      columns.push({
        value: column,
        label: name ? t("grid.dialog.column.named", { column, name }) : t("grid.dialog.column", { column }),
      });
    });
  }
  const first = columns[0]?.value ?? columnLetters(context.engine.selection().focus.column);
  const levels: Level[] = [{ column: first, by: "values", order: "asc" }];
  let current = 0;
  const values: Values = { header: context.params.header !== false };

  // I valori dei campi stanno nei livelli; `values` ne tiene una copia per
  // i campi, rifatta a ogni ridisegno.
  const sync = (): void => {
    for (const key of Object.keys(values)) if (LEVEL_KEY.test(key)) delete values[key];
    levels.forEach((level, index) => {
      values[`column${index}`] = level.column;
      values[`by${index}`] = level.by;
      values[`order${index}`] = level.order;
    });
  };
  sync();

  const levelFields = (index: number): FieldSpec => ({
    kind: "section",
    label: t(index === 0 ? "grid.dialog.sort.sort_by" : "grid.dialog.sort.then_by"),
    fields: [
      columns.length
        ? { kind: "select", key: `column${index}`, label: t("grid.dialog.sort.column"), options: columns }
        : { kind: "text", key: `column${index}`, label: t("grid.dialog.sort.column") },
      {
        kind: "select",
        key: `by${index}`,
        label: t("grid.dialog.sort.on"),
        options: [
          { value: "values", label: t("grid.dialog.sort.values") },
          { value: "cellColor", label: t("grid.dialog.sort.cell_color") },
          { value: "fontColor", label: t("grid.dialog.sort.font_color") },
        ],
      },
      {
        kind: "select",
        key: `order${index}`,
        label: t("grid.dialog.sort.order"),
        options: [
          { value: "asc", label: t("grid.dialog.sort.asc") },
          { value: "desc", label: t("grid.dialog.sort.desc") },
        ],
      },
    ],
  });

  const handle = formHandle(context, {
    title: t("grid.dialog.sort.title"),
    values,
    command: "data.sort",
    className: "grid-dialog-wide",
    fields: () => [{ kind: "check", key: "header", label: t("grid.dialog.sort.header") }, ...levels.map((_, index) => levelFields(index))],
    change: (key, changed) => {
      const match = LEVEL_KEY.exec(key);
      if (!match) return false;
      const level = levels[Number(match[2])];
      if (level) level[match[1] as keyof Level] = String(changed[key] ?? "");
      return false;
    },
    params: () => {
      const keys: Record<string, unknown>[] = [];
      for (const level of levels) {
        const column = level.column.trim().toUpperCase();
        if (columnIndex(column) === null) return t("grid.dialog.error.required", { label: t("grid.dialog.sort.column").replace(/:$/, "") });
        keys.push(level.by === "values" ? { column, order: level.order } : { column, order: level.order, by: level.by });
      }
      const params: Record<string, unknown> = { header: values.header === true, keys };
      if (typeof context.params.range === "string") params.range = context.params.range;
      return params;
    },
  });

  const redraw = (focus: string): void => {
    sync();
    handle.redraw();
    handle.spec.body.querySelector<HTMLElement>(`[data-key="${focus}${current}"]`)?.focus();
    refresh();
  };

  const toolbar = document.createElement("div");
  toolbar.className = "grid-dialog-toolbar";
  const add = textButton({
    label: t("grid.dialog.sort.add"),
    lifetime: context.life,
    onPress: () => {
      const used = new Set(levels.map((level) => level.column));
      const column = columns.find((choice) => !used.has(choice.value))?.value ?? columns[columns.length - 1]?.value ?? first;
      levels.splice(current + 1, 0, { column, by: "values", order: "asc" });
      current += 1;
      redraw("column");
    },
  });
  const remove = textButton({
    label: t("grid.dialog.sort.delete"),
    lifetime: context.life,
    onPress: () => {
      if (levels.length < 2) return;
      levels.splice(current, 1);
      current = Math.min(current, levels.length - 1);
      redraw("column");
    },
  });
  const move = (step: -1 | 1) => () => {
    const target = current + step;
    if (target < 0 || target >= levels.length) return;
    const [level] = levels.splice(current, 1);
    levels.splice(target, 0, level!);
    current = target;
    redraw("column");
  };
  const up = textButton({ label: t("grid.dialog.sort.up"), lifetime: context.life, onPress: move(-1) });
  const down = textButton({ label: t("grid.dialog.sort.down"), lifetime: context.life, onPress: move(1) });
  toolbar.append(add, remove, up, down);
  handle.spec.body.prepend(toolbar);

  const refresh = (): void => {
    remove.disabled = levels.length < 2;
    up.disabled = current === 0;
    down.disabled = current === levels.length - 1;
    handle.spec.body.querySelectorAll(".grid-dialog-section").forEach((section, index) => {
      section.toggleAttribute("data-current", index === current);
    });
  };
  context.life.listen(handle.spec.body, "focusin", (event) => {
    const key = event.target instanceof HTMLElement ? event.target.dataset.key : undefined;
    const match = key ? LEVEL_KEY.exec(key) : null;
    if (!match) return;
    current = Number(match[2]);
    refresh();
  });
  refresh();
  return handle.spec;
};

export const SORT_DIALOGS: Readonly<Record<string, DialogBuilder>> = { sort };
