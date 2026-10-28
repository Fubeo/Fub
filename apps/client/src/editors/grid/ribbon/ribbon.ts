// La barra multifunzione dei fogli: le schede di `tabs.ts` sopra la barra
// della formula, come in GridCraft e in Excel.
//
// La barra stessa è quella del kit (`kit/ribbon/ribbon.ts`): schede, gruppi
// raccolti da destra, lettere con Alt e F10, mini-barra e controlli comuni.
// Qui sta ciò che sa soltanto la griglia: la vista che i controlli leggono
// dal motore, quando si vede una scheda contestuale, e le due specie di
// controllo sue, la tavolozza dei colori e le gallerie degli stili.
//
// Non sa scrivere niente da sé: ogni controllo dà un comando del catalogo
// della sessione (`GridEngine.command`), e lo stato che mostra (premuto,
// spento con la sua ragione, il carattere della cella) lo legge dal motore a
// ogni aggiornamento.
import { readResult } from "../dialogs/result";
import type { GridBook, GridCellStyle, GridCommandState, GridObject, GridSheetView, GridTable } from "../../../host/contract";
import { labelButton, setPressed } from "../../../kit";
import { mountRibbon as mountKitRibbon, type RibbonItem, type RibbonParts } from "../../../kit/ribbon/ribbon";
import { onLanguage } from "../../../i18n/strings";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { setTooltip } from "../../../ui/tooltip";
import { useRibbonIcons } from "./icons";
import {
  CELL_STYLE_GROUPS,
  STANDARD_COLORS,
  TABLE_FAMILIES,
  THEME_COLUMNS,
  cellLook,
  resolve,
  tableLook,
  themeColors,
  tintPercent,
  tintsFor,
  type RibbonColor,
} from "./palette";
import { t, type RibbonKey } from "./strings";
import { contextEntries, MINI_CONTROLS, type GridMenuTarget } from "./context";
import type { SurfaceMenuItem } from "../../core/editor-menu";
import {
  RIBBON_TABS,
  type ColorControl,
  type GalleryControl,
  type GridExtraControl,
  type Params,
  type RibbonControl,
  type RibbonGroup,
  type RibbonTab,
  type RibbonView,
} from "./tabs";

/// Ciò che la barra chiede al motore della griglia.
// Le finestre arrivano nello stesso pezzo della barra: si aprono soltanto da
// una cartella di Excel, come lei.
export { mountGridDialogs, type GridDialogs } from "../dialogs/host";

export interface RibbonEngine {
  ribbonHost(): HTMLElement;
  commands(): readonly GridCommandState[];
  commandable(): boolean;
  activeStyle(): GridCellStyle | undefined;
  sheetView(): GridSheetView;
  tables(): readonly GridTable[];
  book(): GridBook | null;
  hiddenSheets(): readonly { readonly id: string; readonly name: string }[];
  viewportSize(): { width: number; height: number };
  selection(): { readonly focus: { readonly row: number; readonly column: number } };
  /// L'oggetto selezionato sul foglio, o `null` se la selezione è di celle.
  selectedObject(): GridObject | null;
  /// L'esportazione in PDF della cartella, se la shell la offre adesso.
  pdfExport?(): (() => void) | null;
  command(id: string, params?: string): boolean;
  /// Apre la finestra `id` (`GridEngine.openDialog`).
  openDialog(id: string, params?: string): boolean;
  query(id: string, params?: string): Promise<string | null>;
  writeFormula(text: string): boolean;
  focus(): void;
}

export interface GridRibbon {
  readonly element: HTMLElement;
  /// Rilegge subito lo stato del motore.
  refresh(): void;
  /// Rilegge al prossimo fotogramma: per i richiami del motore, che arrivano
  /// a raffica.
  schedule(): void;
  /// Le voci del menu del tasto destro su `target` (`context.ts`): quelle
  /// che il catalogo serve adesso, vuote se non si danno comandi.
  contextMenu(target: GridMenuTarget): SurfaceMenuItem[];
  /// Monta la mini-barra in `host` e torna come toglierla. I suoi controlli
  /// sono della barra e vivono con lei: smontarla li stacca soltanto.
  mountMini(host: HTMLElement): () => void;
  destroy(): void;
}

type Item = RibbonItem<RibbonView, RibbonControl, RibbonKey>;
type Parts = RibbonParts<RibbonView, RibbonKey>;

/// Il nome di uno stile di cella come lo dice Excel nella lingua della shell:
/// il provider lo conosce col nome inglese del file.
function cellStyleName(name: string): string {
  const accent = /^(?:(\d+)% - )?Accent([1-6])$/.exec(name);
  if (accent) {
    return accent[1]
      ? t("ribbon.cell_style.accent_percent", { percent: accent[1], n: accent[2]! })
      : t("ribbon.cell_style.accent", { n: accent[2]! });
  }
  const key = `ribbon.cell_style.${name.toLowerCase().replace(" [0]", "_0").replace(/ /g, "_")}`;
  return key in CELL_STYLE_KEYS ? t(key as RibbonKey) : name;
}

const CELL_STYLE_KEYS: Readonly<Record<string, true>> = Object.fromEntries(
  CELL_STYLE_GROUPS.flatMap(({ names }) => names).map((name) => [
    `ribbon.cell_style.${name.toLowerCase().replace(" [0]", "_0").replace(/ /g, "_")}`,
    true,
  ]),
);

/// La tabella che contiene la cella attiva.
function tableAt(tables: readonly GridTable[], at: { readonly row: number; readonly column: number }): GridTable | null {
  return (
    tables.find(
      (table) => at.row >= table.row && at.row < table.row + table.rows && at.column >= table.column && at.column < table.column + table.columns,
    ) ?? null
  );
}

/// Se una scheda contestuale ha il suo contesto: la tabella quando la
/// selezione è di celle, il grafico o l'oggetto quando è selezionato.
function contextShown(context: NonNullable<RibbonTab["contextual"]>, view: RibbonView): boolean {
  switch (context) {
    case "table":
      return view.table !== null && view.object === null;
    case "chart":
      return view.object?.kind === "chart";
    case "object":
      return view.object !== null && (view.object.kind === "chart" || view.object.kind === "image" || view.object.kind === "shape");
  }
}

export function mountRibbon(engine: RibbonEngine): GridRibbon {
  const releaseIcons = useRibbonIcons();

  // ── La vista che i controlli leggono ──────────────────────────────────
  function readView(): RibbonView {
    const book = engine.book();
    return {
      style: engine.activeStyle(),
      sheet: engine.sheetView(),
      book,
      table: tableAt(engine.tables(), engine.selection().focus),
      object: engine.selectedObject(),
      theme: themeColors(book?.theme_colors),
      hidden: engine.hiddenSheets(),
      get viewport() {
        return engine.viewportSize();
      },
      query: async (id, params) => readResult(await engine.query(id, JSON.stringify(params))),
    };
  }

  const ribbon = mountKitRibbon<RibbonView, RibbonKey, GridExtraControl>({
    host: engine.ribbonHost(),
    prefix: "grid-ribbon",
    menuPrefix: "grid.menu.",
    tabs: RIBBON_TABS,
    mini: MINI_CONTROLS,
    chevrons: { down: "gr-chevron-down", up: "gr-chevron-up" },
    strings: {
      label: () => t("ribbon.label"),
      collapse: () => t("ribbon.collapse"),
      expand: () => t("ribbon.expand"),
      unavailable: (label, reason) => t("ribbon.unavailable", { label, reason }),
      empty: () => t("ribbon.menu.empty"),
      mini: () => t("ribbon.context.mini"),
    },
    t: (key) => t(key),
    commands: () => engine.commands(),
    commandable: () => engine.commandable(),
    view: readView,
    contextShown: (context, view) => contextShown(context as NonNullable<RibbonTab["contextual"]>, view),
    command: (id, params) => engine.command(id, params),
    openDialog: (id, params) => engine.openDialog(id, params),
    write: (text) => engine.writeFormula(text),
    shell: (action) => (action === "exportPdf" ? (engine.pdfExport?.() ?? null) : null),
    focus: () => engine.focus(),
    languages: onLanguage,
    extra: (control, group, parts) => (control.kind === "color" ? colorItem(control, group, parts) : galleryItem(control, group, parts)),
  });

  return {
    element: ribbon.element,
    refresh: ribbon.refresh,
    schedule: ribbon.schedule,
    contextMenu: (target) => ribbon.contextMenu((view) => contextEntries(target, view)),
    mountMini: ribbon.mountMini,
    destroy() {
      ribbon.destroy();
      releaseIcons();
    },
  };
}

// ── La tavolozza ────────────────────────────────────────────────────────

function colorItem(control: ColorControl, group: RibbonGroup, parts: Parts): Item {
  const el = parts.wrap(control);
  el.classList.add("grid-ribbon-split");
  let last: RibbonColor = control.initial;
  let view: RibbonView | null = null;
  const paramsOf = (color: RibbonColor | "auto" | "none"): Params => {
    const current = view ?? parts.view();
    const value = control.hex && typeof color !== "string" ? resolve(color, current.theme) : color;
    return { ...control.params?.(current), color: value };
  };
  const main = parts.button(control, () => t(control.label), () => parts.give(control.id, paramsOf(last)));
  const bar = document.createElement("span");
  bar.className = "grid-ribbon-color-bar";
  bar.setAttribute("aria-hidden", "true");
  main.append(bar);
  const arrow = document.createElement("button");
  arrow.type = "button";
  arrow.id = parts.id();
  arrow.className = "grid-ribbon-button grid-ribbon-arrow";
  arrow.tabIndex = -1;
  arrow.setAttribute("aria-haspopup", "dialog");
  arrow.setAttribute("aria-expanded", "false");
  arrow.append(parts.chevron());
  const name = () => labelButton(arrow, t("ribbon.color.choose", { label: t(control.label) }));
  name();
  parts.relabel(name);
  const paint = () => {
    bar.style.backgroundColor = resolve(last, (view ?? parts.view()).theme);
  };
  const choose = (color: RibbonColor | "auto" | "none") => {
    if (color !== "auto" && color !== "none") last = color;
    paint();
    parts.give(control.id, paramsOf(color));
  };
  const open = () => openPalette(parts, arrow, control, (view ?? parts.view()).theme, choose);
  parts.life.listen(arrow, "click", open);
  el.append(main, arrow);
  return {
    control,
    group,
    wrap: el,
    shown: true,
    update(next) {
      view = next;
      paint();
      parts.availability(main, control.id, t(control.label));
    },
    activate: open,
    relabel: () => {},
  };
}

function galleryItem(control: GalleryControl, group: RibbonGroup, parts: Parts): Item {
  const el = parts.wrap(control);
  let view: RibbonView | null = null;
  const press = parts.button(control, () => t(control.label), (anchor) => openGallery(parts, anchor, control, view ?? parts.view()));
  press.setAttribute("aria-haspopup", "dialog");
  press.setAttribute("aria-expanded", "false");
  press.append(parts.chevron());
  el.append(press);
  return {
    control,
    group,
    wrap: el,
    shown: true,
    update(next) {
      view = next;
      parts.availability(press, control.id, t(control.label));
    },
    activate: () => press.click(),
    relabel: () => {},
  };
}

function swatch(color: string, label: string, onPick: () => void, lifetime: Lifetime): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "grid-ribbon-swatch";
  el.tabIndex = -1;
  el.style.backgroundColor = color;
  el.setAttribute("aria-label", label);
  lifetime.add(() => setTooltip(el, ""));
  setTooltip(el, label);
  lifetime.listen(el, "click", onPick);
  return el;
}

function openPalette(
  parts: Parts,
  anchor: HTMLButtonElement,
  control: ColorControl,
  theme: readonly string[],
  choose: (color: RibbonColor | "auto" | "none") => void,
): void {
  parts.closePopover();
  closeContextMenu();
  const local = openLifetime();
  const box = document.createElement("div");
  box.className = "grid-ribbon-palette";
  const pick = (color: RibbonColor | "auto" | "none") => () => {
    parts.closePopover();
    choose(color);
  };
  const empty = document.createElement("button");
  empty.type = "button";
  empty.className = "grid-ribbon-palette-empty";
  empty.textContent = t(control.empty.label);
  local.listen(empty, "click", pick(control.empty.value));
  const title = (key: RibbonKey) => {
    const el = document.createElement("p");
    el.className = "grid-ribbon-palette-title";
    el.textContent = t(key);
    return el;
  };
  const grid = document.createElement("div");
  grid.className = "grid-ribbon-palette-grid";
  const cells: HTMLButtonElement[] = [];
  for (let row = 0; row < 6; row += 1) {
    for (const index of THEME_COLUMNS) {
      const base = theme[index] ?? "#000000";
      const tint = row === 0 ? 0 : tintsFor(base)[row - 1]!;
      const name = t(`ribbon.color.theme.${index}` as RibbonKey);
      const label =
        tint === 0
          ? name
          : t(tint > 0 ? "ribbon.color.lighter" : "ribbon.color.darker", { name, percent: tintPercent(tint) });
      const value = { theme: index, tint };
      const cell = swatch(resolve(value, theme), label, pick(value), local);
      if (row === 0) cell.classList.add("grid-ribbon-swatch-base");
      cells.push(cell);
    }
  }
  grid.append(...cells);
  const standard = document.createElement("div");
  standard.className = "grid-ribbon-palette-grid";
  const STANDARD_NAMES: readonly RibbonKey[] = [
    "ribbon.color.dark_red",
    "ribbon.color.red",
    "ribbon.color.orange",
    "ribbon.color.yellow",
    "ribbon.color.light_green",
    "ribbon.color.green",
    "ribbon.color.light_blue",
    "ribbon.color.blue",
    "ribbon.color.dark_blue",
    "ribbon.color.purple",
  ];
  const extra = STANDARD_COLORS.map((hex, at) => swatch(hex, t(STANDARD_NAMES[at]!), pick(hex), local));
  standard.append(...extra);
  cells.push(...extra);
  cells[0]!.tabIndex = 0;
  parts.gridKeys(local, box, cells, THEME_COLUMNS.length);
  box.append(empty, title("ribbon.color.theme"), grid, title("ribbon.color.standard"), standard);
  parts.showPopover(anchor, box, t(control.label), local);
}

// ── Le gallerie ───────────────────────────────────────────────────────
function openGallery(parts: Parts, anchor: HTMLButtonElement, control: GalleryControl, view: RibbonView): void {
  parts.closePopover();
  closeContextMenu();
  const local = openLifetime();
  const box = document.createElement("div");
  box.className = `grid-ribbon-gallery grid-ribbon-gallery-${control.gallery}`;
  const current = control.current?.(view) ?? null;
  const cells: HTMLButtonElement[] = [];
  const choice = (name: string, label: string): HTMLButtonElement => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "grid-ribbon-gallery-item";
    el.tabIndex = -1;
    el.setAttribute("aria-label", label);
    if (current !== null) setPressed(el, name === current);
    local.listen(el, "click", () => parts.give(control.id, control.params(name, view)));
    cells.push(el);
    return el;
  };
  const section = (title: string, items: HTMLElement[]) => {
    const heading = document.createElement("p");
    heading.className = "grid-ribbon-palette-title";
    heading.textContent = title;
    const grid = document.createElement("div");
    grid.className = "grid-ribbon-gallery-grid";
    grid.append(...items);
    box.append(heading, grid);
  };
  if (control.gallery === "table") {
    for (const { family, count } of TABLE_FAMILIES) {
      const familyName = t(`ribbon.gallery.${family.toLowerCase()}` as RibbonKey);
      const items = Array.from({ length: count }, (_, at) => {
        const name = `TableStyle${family}${at + 1}`;
        const el = choice(name, t("ribbon.gallery.table_style", { family: familyName, n: at + 1 }));
        el.append(tablePreview(tableLook(name, view.theme)));
        setTooltip(el, el.getAttribute("aria-label")!);
        local.add(() => setTooltip(el, ""));
        return el;
      });
      section(familyName, items);
    }
    parts.gridKeys(local, box, cells, 7);
  } else {
    for (const { group, names } of CELL_STYLE_GROUPS) {
      const items = names.map((name) => {
        const label = cellStyleName(name);
        const el = choice(name, label);
        const sample = document.createElement("span");
        sample.className = "grid-ribbon-cell-sample";
        sample.setAttribute("aria-hidden", "true");
        sample.textContent = label;
        for (const [property, value] of Object.entries(cellLook(name, view.theme))) sample.style.setProperty(property, value);
        el.append(sample);
        return el;
      });
      section(t(`ribbon.cell_group.${group}` as RibbonKey), items);
    }
    parts.gridKeys(local, box, cells, 4);
  }
  const start = cells.find((cell) => cell.getAttribute("aria-pressed") === "true") ?? cells[0];
  if (start) start.tabIndex = 0;
  parts.showPopover(anchor, box, t(control.label), local, "grid-ribbon-popover grid-ribbon-popover-gallery");
}

/// Una tabellina di quattro righe e tre colonne nei colori dello stile.
function tablePreview(look: ReturnType<typeof tableLook>): HTMLElement {
  const preview = document.createElement("span");
  preview.className = "grid-ribbon-table-preview";
  preview.setAttribute("aria-hidden", "true");
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const cell = document.createElement("span");
      const fill = row === 0 ? look.headerFill : row % 2 === 1 ? look.bandFill : look.bodyFill;
      if (fill) cell.style.backgroundColor = fill;
      if (look.line) cell.style.borderBottom = `1px solid ${look.line}`;
      if (row === 0) cell.style.borderBottom = `2px solid ${look.headerFill ?? look.line ?? look.headerText}`;
      preview.append(cell);
    }
  }
  return preview;
}
