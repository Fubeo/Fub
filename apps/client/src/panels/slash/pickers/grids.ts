// I passi a griglia: la tabella (6 × 8), il colore (testo e fondo), la
// galleria dei riquadri e quella dei diagrammi. Le frecce muovono la scelta,
// il puntatore la segue, Invio o il clic la mettono.
import type { SlashMenuEntry } from "../../../editors/core/editor-menu";
import { CALLOUT_TYPES } from "../../../editors/text/profiles/markdown/kinds";
import { DIAGRAM_TEMPLATES } from "../../../editors/text/profiles/markdown/diagram-templates";
import { t } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { CALLOUTS, calloutLabel } from "../quick";
import { PALETTE } from "../preview";
import type { SlashStep, StepContext } from "./index";

/// Le misure della griglia della tabella.
export const TABLE_ROWS = 6;
export const TABLE_COLS = 8;

interface GridSpec {
  readonly className: string;
  readonly label: string;
  readonly cols: number;
  readonly count: number;
  readonly initial: number;
  /// Riempie la cella `index`, una volta.
  readonly fill: (cell: HTMLElement, index: number) => void;
  /// Ridisegna lo stato delle celle per la scelta `selected`.
  readonly paint?: (cells: readonly HTMLElement[], selected: number) => void;
  /// Che cosa dice il conto per la scelta.
  readonly hint: (selected: number) => string;
  /// La scelta della cella, o null per una cella che adesso non si può
  /// scegliere (il colore predefinito dove non c'è colore da togliere).
  readonly done: (selected: number) => { entry?: SlashMenuEntry; params: Readonly<Record<string, unknown>> } | null;
  /// Un'intestazione sopra le celle (i nomi delle righe del colore).
  readonly lead?: HTMLElement;
}

/// Un passo a griglia: le celle sono opzioni di un elenco, scelte con le
/// frecce in due dimensioni.
function gridStep(context: StepContext, spec: GridSpec): SlashStep {
  const { host, life } = context;
  const dom = document.createElement("div");
  dom.className = `slash-step ${spec.className}`;
  const grid = document.createElement("div");
  grid.className = "slash-step-grid";
  grid.setAttribute("role", "listbox");
  grid.setAttribute("aria-label", spec.label);
  grid.style.setProperty("--slash-step-cols", String(spec.cols));
  const cells: HTMLElement[] = [];
  for (let index = 0; index < spec.count; index++) {
    const cell = document.createElement("div");
    cell.className = "slash-step-cell";
    cell.id = identifier("slash-step");
    cell.setAttribute("role", "option");
    cell.dataset["index"] = String(index);
    spec.fill(cell, index);
    cells.push(cell);
  }
  grid.append(...cells);
  if (spec.lead) dom.append(spec.lead);
  dom.append(grid);

  let selected = spec.initial;
  const choose = (): void => {
    const choice = spec.done(selected);
    if (choice) host.done(choice);
  };
  const paint = (): void => {
    cells.forEach((cell, index) => {
      cell.classList.toggle("is-selected", index === selected);
      cell.setAttribute("aria-selected", String(index === selected));
    });
    spec.paint?.(cells, selected);
    host.changed();
  };
  const select = (index: number): void => {
    selected = Math.max(0, Math.min(spec.count - 1, index));
    paint();
  };
  paint();

  life.listen(grid, "mouseover", (event) => {
    const cell = (event.target as Element).closest<HTMLElement>(".slash-step-cell");
    if (cell && Number(cell.dataset["index"]) !== selected) select(Number(cell.dataset["index"]));
  });
  life.listen(grid, "click", (event) => {
    const cell = (event.target as Element).closest<HTMLElement>(".slash-step-cell");
    if (!cell) return;
    selected = Number(cell.dataset["index"]);
    choose();
  });

  return {
    dom,
    hint: () => spec.hint(selected),
    active: () => cells[selected]?.id ?? null,
    key(event) {
      const col = selected % spec.cols;
      switch (event.key) {
        case "ArrowRight":
          select(col === spec.cols - 1 ? selected : selected + 1);
          return true;
        case "ArrowLeft":
          select(col === 0 ? selected : selected - 1);
          return true;
        case "ArrowDown":
          if (selected + spec.cols < spec.count) select(selected + spec.cols);
          return true;
        case "ArrowUp":
          if (selected - spec.cols >= 0) select(selected - spec.cols);
          return true;
        case "Enter":
          choose();
          return true;
      }
      return false;
    },
    typing: () => false,
    dispose: () => {},
  };
}

/// La tabella: righe (intestazione compresa) per colonne, fino a 6 × 8.
export function tableStep(context: StepContext): SlashStep {
  const at = (index: number) => ({ rows: Math.floor(index / TABLE_COLS) + 1, cols: (index % TABLE_COLS) + 1 });
  return gridStep(context, {
    className: "is-table",
    label: t("slash.step.table.label"),
    cols: TABLE_COLS,
    count: TABLE_ROWS * TABLE_COLS,
    // 3 × 3, come la tabella senza passo.
    initial: 2 * TABLE_COLS + 2,
    fill: (cell, index) => {
      const { rows, cols } = at(index);
      cell.setAttribute("aria-label", t("slash.step.table", { rows, cols }));
    },
    paint: (cells, selected) => {
      const chosen = at(selected);
      cells.forEach((cell, index) => {
        const { rows, cols } = at(index);
        cell.classList.toggle("is-on", rows <= chosen.rows && cols <= chosen.cols);
      });
    },
    hint: (selected) => `${t("slash.step.table", at(selected))} · ${t("slash.step.table.quick")}`,
    done: (selected) => ({ params: at(selected) }),
  });
}

/// Il colore: una riga per il testo, una per il fondo, dieci colori.
export function colorStep(context: StepContext): SlashStep {
  const { text, fill } = context.deps.colors();
  const byName = (entries: readonly SlashMenuEntry[], name: string) => entries.find((entry) => entry.id.endsWith(`.${name}`)) ?? null;
  const rows = [text, fill];
  const nameOf = (index: number) => PALETTE[index % PALETTE.length]!;
  const entryOf = (index: number) => byName(rows[Math.floor(index / PALETTE.length)]!, nameOf(index));
  // Una cella senza voce: il predefinito dove non c'è niente da togliere, o
  // un colore nascosto dal menu.
  const unavailable = (index: number) => nameOf(index) !== "default" ? nameOf(index)
    : t(index < PALETTE.length ? "slash.step.color.text_none" : "slash.step.color.fill_none");
  const lead = document.createElement("div");
  lead.className = "slash-step-lead";
  lead.setAttribute("aria-hidden", "true");
  lead.append(...[t("slash.step.color.text"), t("slash.step.color.fill")].map((name) => {
    const span = document.createElement("span");
    span.textContent = name;
    return span;
  }));
  return gridStep(context, {
    className: "is-color",
    label: t("slash.color"),
    cols: PALETTE.length,
    count: PALETTE.length * 2,
    // La prima cella che si può scegliere: il predefinito manca dove non c'è
    // un colore da togliere.
    initial: Math.max(0, Array.from({ length: PALETTE.length * 2 }, (_, index) => entryOf(index) !== null).indexOf(true)),
    lead,
    fill: (cell, index) => {
      const row = index < PALETTE.length ? "color" : "fill";
      cell.dataset[row] = nameOf(index);
      if (row === "color") cell.textContent = "A";
      const entry = entryOf(index);
      cell.setAttribute("aria-label", entry?.label ?? unavailable(index));
      if (!entry) cell.setAttribute("aria-disabled", "true");
    },
    hint: (selected) => entryOf(selected)?.label ?? unavailable(selected),
    done: (selected) => {
      const entry = entryOf(selected);
      return entry ? { entry, params: {} } : null;
    },
  });
}

/// La galleria dei riquadri, con le loro icone.
export function calloutStep(context: StepContext): SlashStep {
  // Soltanto i tipi che la resa conosce.
  const types = CALLOUTS.filter((callout) => (CALLOUT_TYPES as readonly string[]).includes(callout.type));
  return gridStep(context, {
    className: "is-gallery",
    label: context.entry.label,
    cols: 3,
    count: types.length,
    initial: 0,
    fill: (cell, index) => {
      const callout = types[index]!;
      cell.dataset["type"] = callout.type;
      const icon = document.createElement("i");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = callout.emoji;
      cell.append(icon, calloutLabel(callout.type));
    },
    hint: () => t("slash.step.keys"),
    done: (selected) => ({ params: { type: types[selected]!.type } }),
  });
}

/// La galleria dei diagrammi: un modello per tipo.
export function diagramStep(context: StepContext): SlashStep {
  return gridStep(context, {
    className: "is-gallery is-diagram",
    label: context.entry.label,
    cols: 2,
    count: DIAGRAM_TEMPLATES.length,
    initial: 0,
    fill: (cell, index) => {
      const template = DIAGRAM_TEMPLATES[index]!;
      const name = document.createElement("b");
      name.textContent = t(template.name);
      const description = document.createElement("span");
      description.textContent = t(template.description);
      cell.append(name, description);
    },
    hint: () => t("slash.step.keys"),
    done: (selected) => ({ params: { template: DIAGRAM_TEMPLATES[selected]!.id } }),
  });
}
