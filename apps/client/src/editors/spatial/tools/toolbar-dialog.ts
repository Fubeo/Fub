// «Personalizza la barra…» (G3): una riga per strumento offerto, con la
// casella, il nome e le frecce; le righe si trascinano. La Selezione non si
// toglie. Chi apre la finestra riceve la colonna a ogni cambio, per
// l'anteprima, e alla fine quella salvata, o `null` se si annulla: che cosa
// significhi la decide lui (`editor/chrome/workspace.ts`). La finestra non
// conosce l'editor, e sta coi pannelli.

import { openDialog } from "../../../kit";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { t } from "../strings";

export interface ToolbarRow {
  readonly id: string;
  readonly name: string;
  on: boolean;
}

export interface ToolbarDialogOptions {
  /// Le righe di partenza: prima la colonna nel suo ordine, poi gli altri.
  readonly rows: readonly ToolbarRow[];
  /// La colonna di serie, che «Ripristina» rimette.
  readonly standard: readonly string[];
  /// Lo strumento che resta sempre.
  readonly fixed: string;
  /// La colonna di adesso, a ogni cambio.
  readonly preview: (column: string[]) => void;
  readonly announce: (text: string) => void;
  readonly lifetime: Lifetime;
}

/// Apre la finestra; torna la colonna scelta, o `null` se si annulla.
export function openToolbarDialog(options: ToolbarDialogOptions): Promise<string[] | null> {
  const { fixed, preview, announce } = options;
  const own = openLifetime();
  options.lifetime.add(() => own.close());
  let rows: ToolbarRow[] = options.rows.map((row) => ({ ...row }));
  const names = new Map(rows.map((row) => [row.id, row.name]));
  const column = (): string[] => rows.filter((row) => row.on).map((row) => row.id);

  const body = document.createElement("div");
  body.className = "draw-toolbar-custom";
  const list = document.createElement("ol");
  list.className = "draw-toolbar-list";
  list.setAttribute("aria-label", t("draw.toolbar.list"));
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "kit-button draw-toolbar-reset";
  reset.dataset.kind = "normal";
  reset.textContent = t("draw.toolbar.reset");
  body.append(list, reset);

  /// La riga presa col puntatore, mentre si trascina.
  let dragged: string | null = null;
  const move = (id: string, by: number): void => {
    const at = rows.findIndex((row) => row.id === id);
    const to = Math.max(0, Math.min(rows.length - 1, at + by));
    if (at < 0 || to === at) return;
    const [row] = rows.splice(at, 1);
    rows.splice(to, 0, row!);
    render(id, by < 0 ? "up" : "down");
    announce(t("draw.toolbar.moved", { tool: names.get(id) ?? id, at: to + 1, count: rows.length }));
  };
  const button = (text: string, label: string, disabled: boolean, run: () => void): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "kit-button draw-toolbar-move";
    control.dataset.kind = "normal";
    control.textContent = text;
    control.setAttribute("aria-label", label);
    control.disabled = disabled;
    own.listen(control, "click", run);
    return control;
  };
  /// Rifà le righe; con `focus`, il fuoco va sulla riga di quello strumento,
  /// sulla freccia appena usata se c'è ancora.
  const render = (focus: string | null = null, which: "up" | "down" | "check" = "check"): void => {
    list.replaceChildren();
    let target: HTMLElement | null = null;
    rows.forEach((row, at) => {
      const item = document.createElement("li");
      item.className = "draw-toolbar-row";
      item.draggable = true;
      item.dataset.tool = row.id;
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = row.on;
      box.disabled = row.id === fixed;
      own.listen(box, "change", () => {
        row.on = box.checked;
        preview(column());
      });
      const name = document.createElement("span");
      name.textContent = row.name;
      label.append(box, name);
      const up = button("↑", t("draw.toolbar.up", { tool: row.name }), at === 0, () => move(row.id, -1));
      const down = button("↓", t("draw.toolbar.down", { tool: row.name }), at === rows.length - 1, () => move(row.id, 1));
      own.listen(item, "dragstart", (event: DragEvent) => {
        dragged = row.id;
        event.dataTransfer?.setData("text/plain", row.id);
      });
      own.listen(item, "dragover", (event: DragEvent) => {
        if (dragged !== null && dragged !== row.id) event.preventDefault();
      });
      own.listen(item, "drop", (event: DragEvent) => {
        event.preventDefault();
        const from = rows.findIndex((each) => each.id === dragged);
        if (dragged === null || from < 0) return;
        move(dragged, rows.findIndex((each) => each.id === row.id) - from);
        dragged = null;
      });
      own.listen(item, "dragend", () => (dragged = null));
      item.append(label, up, down);
      list.append(item);
      if (focus === row.id) target = which === "up" ? (up.disabled ? down : up) : which === "down" ? (down.disabled ? up : down) : box;
    });
    (target as HTMLElement | null)?.focus();
    preview(column());
  };
  own.listen(reset, "click", () => {
    const standard = new Set(options.standard);
    rows = [
      ...options.standard.flatMap((id) => rows.find((row) => row.id === id) ?? []).map((row) => ({ ...row, on: true })),
      ...rows.filter((row) => !standard.has(row.id)).map((row) => ({ ...row, on: false })),
    ];
    render();
  });
  render();

  const dialog = openDialog<boolean>({
    title: t("draw.toolbar.title"),
    description: t("draw.toolbar.hint"),
    body,
    actions: [
      { id: "cancel", label: t("draw.toolbar.cancel"), value: false },
      { id: "save", label: t("draw.toolbar.save"), kind: "primary", value: true, autofocus: true },
    ],
    dismissValue: false,
    lifetime: own,
    className: "draw-toolbar-dialog",
  });
  return dialog.result.then((saved) => {
    own.close();
    return saved ? column() : null;
  });
}
