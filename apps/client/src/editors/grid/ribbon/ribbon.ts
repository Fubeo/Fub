// La barra multifunzione dei fogli: le schede di `tabs.ts` sopra la barra
// della formula, come in GridCraft e in Excel.
//
// Non sa scrivere niente da sé: ogni controllo dà un comando del catalogo
// della sessione (`GridEngine.command`), e lo stato che mostra (premuto,
// spento con la sua ragione, il carattere della cella) lo legge dal motore a
// ogni aggiornamento. Un controllo il cui comando il catalogo non serve non si
// vede; un gruppo senza controlli, nemmeno; una scheda senza gruppi, nemmeno.
//
// La tastiera è quella di Excel: Alt da solo (o F10) mostra le lettere delle
// schede, una lettera sceglie la scheda e mostra quelle dei controlli, Esc
// torna indietro. Dentro una scheda i controlli sono una barra degli strumenti
// WAI-ARIA: un solo controllo nel Tab, le frecce fra gli altri, Esc torna
// alla griglia. Il puntatore non prende il fuoco ai pulsanti, così la cella
// resta quella scelta.
//
// Quando la barra è stretta i gruppi si raccolgono da destra, ciascuno in un
// pulsante che apre il suo contenuto in un riquadro.
import { readResult } from "../dialogs/result";
import type { GridBook, GridCellStyle, GridCommandState, GridObject, GridSheetView, GridTable } from "../../../host/contract";
import { createTabs, labelButton, openPopover, setPressed, type PopoverHandle, type TabsHandle } from "../../../kit";
import { onLanguage } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../../ui/menu";
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
import {
  RIBBON_TABS,
  type ButtonControl,
  type CheckControl,
  type ColorControl,
  type FieldControl,
  type GalleryControl,
  type MenuControl,
  type MenuEntry,
  type Params,
  type RibbonColumn,
  type RibbonControl,
  type RibbonGroup,
  type RibbonTab,
  type RibbonView,
  type SelectControl,
  type SplitControl,
  type Text,
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
  destroy(): void;
}

/// Un controllo montato.
interface Item {
  readonly control: RibbonControl;
  readonly group: RibbonGroup;
  readonly wrap: HTMLElement;
  /// Visibile adesso.
  shown: boolean;
  update(view: RibbonView): void;
  /// Ciò che fa la sua lettera.
  activate(): void;
  relabel(): void;
}

interface Group {
  readonly spec: RibbonGroup;
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly items: Item[];
  collapsed: boolean;
  relabel(): void;
}

interface Tab {
  readonly spec: RibbonTab;
  readonly panel: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly groups: Group[];
  /// Rimette il Tab su un controllo che c'è.
  readonly settle: (target: HTMLElement | null) => void;
}

const text = (value: Text): string => (typeof value === "string" ? t(value) : value.raw);

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

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
function contextShown(tab: RibbonTab, view: RibbonView): boolean {
  switch (tab.contextual) {
    case undefined:
      return true;
    case "table":
      return view.table !== null && view.object === null;
    case "chart":
      return view.object?.kind === "chart";
    case "object":
      return view.object !== null && (view.object.kind === "chart" || view.object.kind === "image" || view.object.kind === "shape");
  }
}

export function mountRibbon(engine: RibbonEngine): GridRibbon {
  const life = openLifetime();
  life.add(useRibbonIcons());
  const host = engine.ribbonHost();
  const root = host.parentElement ?? host;

  const element = document.createElement("div");
  element.className = "grid-ribbon";
  const head = document.createElement("div");
  head.className = "grid-ribbon-head";
  const tablist = document.createElement("div");
  tablist.className = "grid-ribbon-tabs";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "grid-ribbon-toggle";
  toggle.tabIndex = -1;
  head.append(tablist, toggle);
  const panels = document.createElement("div");
  panels.className = "grid-ribbon-panels";
  element.append(head, panels);
  host.append(element);

  let states = new Map<string, GridCommandState>();
  const served = (id: string): boolean => states.has(id);
  const stateOf = (id: string): GridCommandState | undefined => states.get(id);
  let collapsed = false;
  let popover: PopoverHandle | null = null;
  let menuOpen = false;
  let menuTicket = 0;
  const relabels: (() => void)[] = [];

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

  function give(id: string, params: Params | null | undefined): void {
    closePopover();
    engine.command(id, JSON.stringify(params ?? {}));
  }

  function ask(dialog: string, params: Params | null | undefined): void {
    closePopover();
    engine.openDialog(dialog, JSON.stringify(params ?? {}));
  }

  // ── I menu ────────────────────────────────────────────────────────────
  const entryServed = (entry: MenuEntry): boolean =>
    (entry.id === undefined || served(entry.id)) && (entry.requires ?? []).every(served);

  /// Le voci che il catalogo serve, come le vuole il menu della shell. Il
  /// separatore di una voce che non c'è passa alla prossima che c'è.
  function menuItems(entries: readonly MenuEntry[], anchor: HTMLElement, chosen?: (entry: MenuEntry) => void): MenuItem[] {
    const items: MenuItem[] = [];
    let separate = false;
    for (const entry of entries) {
      separate ||= entry.separator === true;
      if (!entryServed(entry)) continue;
      const state = entry.id ? stateOf(entry.id) : undefined;
      const disabled = state !== undefined && !state.enabled;
      items.push({
        label: text(entry.label),
        separator: separate && items.length > 0,
        disabled,
        icon: entry.icon,
        swatches: entry.swatches,
        description: disabled && state?.reason ? state.reason : entry.description,
        choice: entry.choice,
        checked: entry.checked,
        submenu: entry.submenu !== undefined,
        run: () => runEntry(entry, anchor, chosen),
      });
      separate = false;
    }
    return items;
  }

  function runEntry(entry: MenuEntry, anchor: HTMLElement, chosen?: (entry: MenuEntry) => void): void {
    if (entry.submenu) {
      openMenu(anchor, entry.submenu(), chosen);
      return;
    }
    if (entry.write !== undefined) {
      engine.writeFormula(entry.write);
      return;
    }
    if (!entry.id) return;
    chosen?.(entry);
    if (entry.dialog) ask(entry.dialog, entry.params);
    else give(entry.id, entry.params);
  }

  /// Apre il menu `source` sotto `anchor`. Le voci che arrivano dopo (le
  /// funzioni di una categoria) aprono il menu quando arrivano, se nel
  /// frattempo non se n'è chiesto un altro.
  function openMenu(
    anchor: HTMLElement,
    source: readonly MenuEntry[] | Promise<readonly MenuEntry[]>,
    chosen?: (entry: MenuEntry) => void,
  ): void {
    const ticket = ++menuTicket;
    const show = (entries: readonly MenuEntry[]) => {
      if (life.closed || ticket !== menuTicket || !anchor.isConnected) return;
      closePopover();
      const items = menuItems(entries, anchor, chosen);
      anchor.setAttribute("aria-expanded", "true");
      menuOpen = true;
      showContextMenu(anchor, items.length ? items : [{ label: t("ribbon.menu.empty"), disabled: true, run: () => {} }], {
        labelledBy: anchor.id,
        onClose: () => {
          menuOpen = false;
          anchor.setAttribute("aria-expanded", "false");
        },
      });
    };
    if (source instanceof Promise) source.then(show, () => show([]));
    else show(source);
  }

  function closePopover(): void {
    popover?.close();
    popover = null;
  }

  // ── I pezzi dei controlli ─────────────────────────────────────────────
  function figure(control: { icon?: string; glyph?: string; className?: string }): Element | null {
    if (control.icon) return iconEl(control.icon);
    if (!control.glyph) return null;
    const glyph = document.createElement("span");
    glyph.className = "grid-ribbon-glyph";
    if (control.className) glyph.classList.add(control.className);
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = control.glyph;
    return glyph;
  }

  function chevron(): Element {
    const svg = iconEl("gr-chevron-down");
    const holder = document.createElement("span");
    holder.className = "grid-ribbon-chevron";
    holder.setAttribute("aria-hidden", "true");
    if (svg) holder.append(svg);
    return holder;
  }

  /// Un pulsante della barra: grande (figura sopra il nome) o piccolo.
  function button(control: RibbonControl, label: () => string, onPress: (button: HTMLButtonElement) => void): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.id = identifier("grid-ribbon");
    el.className = `grid-ribbon-button ${control.size === "large" ? "grid-ribbon-large" : "grid-ribbon-small"}`;
    el.tabIndex = -1;
    const shape = figure(control);
    if (shape) el.append(shape);
    const caption = document.createElement("span");
    caption.className = "grid-ribbon-label";
    caption.hidden = control.size !== "large" && control.labelled !== true;
    el.append(caption);
    const name = () => {
      caption.textContent = label();
      labelButton(el, label());
    };
    name();
    relabels.push(name);
    life.listen(el, "click", () => onPress(el));
    return el;
  }

  /// Spento con la ragione del provider nel suggerimento, o acceso.
  function availability(el: HTMLElement, state: GridCommandState | undefined, label: string): void {
    const off = state !== undefined && !state.enabled;
    if (off) el.setAttribute("aria-disabled", "true");
    else el.removeAttribute("aria-disabled");
    setTooltip(el, off && state?.reason ? t("ribbon.unavailable", { label, reason: state.reason }) : label);
  }

  function wrap(control: RibbonControl): HTMLElement {
    const el = document.createElement("span");
    el.className = "grid-ribbon-item";
    el.dataset.keytip = control.keytip;
    return el;
  }

  // ── I controlli ───────────────────────────────────────────────────────
  function buttonItem(control: ButtonControl, group: RibbonGroup): Item {
    const el = wrap(control);
    let view: RibbonView | null = null;
    const press = button(control, () => t(control.label), () => {
      const params = typeof control.params === "function" ? control.params(view ?? readView()) : control.params;
      if (control.dialog) ask(control.dialog, params);
      else give(control.id, params);
    });
    el.append(press);
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        if (control.pressed) setPressed(press, control.pressed(next));
        availability(press, stateOf(control.id), t(control.label));
      },
      activate: () => press.click(),
      relabel: () => {},
    };
  }

  function splitItem(control: SplitControl, group: RibbonGroup): Item {
    const el = wrap(control);
    el.classList.add("grid-ribbon-split");
    let last: Params | undefined = control.params;
    let view: RibbonView | null = null;
    const main = button(control, () => t(control.label), () => give(control.id, last));
    const arrow = document.createElement("button");
    arrow.type = "button";
    arrow.id = identifier("grid-ribbon");
    arrow.className = "grid-ribbon-button grid-ribbon-arrow";
    arrow.tabIndex = -1;
    arrow.setAttribute("aria-haspopup", "menu");
    arrow.setAttribute("aria-expanded", "false");
    arrow.append(chevron());
    const name = () => labelButton(arrow, t(control.menuLabel));
    name();
    relabels.push(name);
    const remember = (entry: MenuEntry) => {
      if (!control.remember || entry.id !== control.id) return;
      last = entry.params;
      const shape = entry.icon ? iconEl(entry.icon) : null;
      const old = main.querySelector("svg");
      if (shape && old) old.replaceWith(shape);
    };
    const open = () => openMenu(arrow, control.menu(view ?? readView()), remember);
    life.listen(arrow, "click", open);
    el.append(main, arrow);
    if (control.size === "large") el.classList.add("grid-ribbon-split-large");
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        if (control.pressed) setPressed(main, control.pressed(next));
        availability(main, stateOf(control.id), t(control.label));
      },
      // Bordi ripete l'ultimo, ma dalla tastiera si vuole sceglierlo.
      activate: () => (control.remember ? open() : main.click()),
      relabel: () => {},
    };
  }

  function menuItem(control: MenuControl, group: RibbonGroup): Item {
    const el = wrap(control);
    let view: RibbonView | null = null;
    const press = button(control, () => t(control.label), (anchor) => openMenu(anchor, control.items(view ?? readView())));
    press.setAttribute("aria-haspopup", "menu");
    press.setAttribute("aria-expanded", "false");
    press.append(chevron());
    el.append(press);
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        availability(press, undefined, t(control.label));
      },
      activate: () => press.click(),
      relabel: () => {},
    };
  }

  function colorItem(control: ColorControl, group: RibbonGroup): Item {
    const el = wrap(control);
    el.classList.add("grid-ribbon-split");
    let last: RibbonColor = control.initial;
    let view: RibbonView | null = null;
    const paramsOf = (color: RibbonColor | "auto" | "none"): Params => {
      const current = view ?? readView();
      const value = control.hex && typeof color !== "string" ? resolve(color, current.theme) : color;
      return { ...control.params?.(current), color: value };
    };
    const main = button(control, () => t(control.label), () => give(control.id, paramsOf(last)));
    const bar = document.createElement("span");
    bar.className = "grid-ribbon-color-bar";
    bar.setAttribute("aria-hidden", "true");
    main.append(bar);
    const arrow = document.createElement("button");
    arrow.type = "button";
    arrow.id = identifier("grid-ribbon");
    arrow.className = "grid-ribbon-button grid-ribbon-arrow";
    arrow.tabIndex = -1;
    arrow.setAttribute("aria-haspopup", "dialog");
    arrow.setAttribute("aria-expanded", "false");
    arrow.append(chevron());
    const name = () => labelButton(arrow, t("ribbon.color.choose", { label: t(control.label) }));
    name();
    relabels.push(name);
    const paint = () => {
      bar.style.backgroundColor = resolve(last, (view ?? readView()).theme);
    };
    const choose = (color: RibbonColor | "auto" | "none") => {
      if (color !== "auto" && color !== "none") last = color;
      paint();
      give(control.id, paramsOf(color));
    };
    const open = () => openPalette(arrow, control, (view ?? readView()).theme, choose);
    life.listen(arrow, "click", open);
    el.append(main, arrow);
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        paint();
        availability(main, stateOf(control.id), t(control.label));
      },
      activate: open,
      relabel: () => {},
    };
  }

  function selectItem(control: SelectControl, group: RibbonGroup): Item {
    const el = wrap(control);
    el.classList.add("grid-ribbon-field");
    const select = document.createElement("select");
    select.className = "grid-ribbon-select";
    select.id = identifier("grid-ribbon");
    select.tabIndex = -1;
    select.style.width = `${control.width}px`;
    const caption = document.createElement("label");
    caption.className = "sr-only";
    caption.htmlFor = select.id;
    const name = () => {
      caption.textContent = t(control.label);
    };
    name();
    relabels.push(name);
    let view: RibbonView | null = null;
    life.listen(select, "change", () => {
      const params = control.params(select.value);
      if (params) give(control.id, params);
    });
    el.append(caption, select);
    const fill = (next: RibbonView) => {
      const options = control.options(next);
      const value = control.value(next);
      const wanted = value === null || !options.some((option) => option.value === value) ? [{ value: "", label: { raw: "" } }, ...options] : options;
      const same = select.options.length === wanted.length && wanted.every((option, at) => select.options[at]!.value === option.value);
      if (!same) {
        select.replaceChildren(
          ...wanted.map((option) => {
            const el = document.createElement("option");
            el.value = option.value;
            el.textContent = text(option.label);
            return el;
          }),
        );
      }
      select.value = value !== null && wanted.some((option) => option.value === value) ? value : "";
    };
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        fill(next);
        availability(select, stateOf(control.id), t(control.label));
        select.disabled = stateOf(control.id)?.enabled === false;
      },
      activate: () => select.focus(),
      // Le voci tradotte (i formati dei numeri) si riscrivono.
      relabel: () => {
        if (!view) return;
        select.replaceChildren();
        fill(view);
      },
    };
  }

  function checkItem(control: CheckControl, group: RibbonGroup): Item {
    const el = wrap(control);
    const label = document.createElement("label");
    label.className = "grid-ribbon-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.tabIndex = -1;
    box.id = identifier("grid-ribbon");
    label.htmlFor = box.id;
    const caption = document.createElement("span");
    label.append(box, caption);
    const name = () => {
      caption.textContent = t(control.label);
    };
    name();
    relabels.push(name);
    let view: RibbonView | null = null;
    life.listen(box, "change", () => give(control.id, control.params(box.checked, view ?? readView())));
    // Invio come Spazio: per la tastiera una casella è un comando.
    life.listen(box, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      box.click();
    });
    el.append(label);
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        box.checked = control.checked(next);
        const state = stateOf(control.id);
        box.disabled = state?.enabled === false;
        setTooltip(label, state?.enabled === false && state.reason ? t("ribbon.unavailable", { label: t(control.label), reason: state.reason }) : "");
      },
      activate: () => box.click(),
      relabel: () => {},
    };
  }

  function fieldItem(control: FieldControl, group: RibbonGroup): Item {
    const el = wrap(control);
    el.classList.add("grid-ribbon-field");
    const caption = document.createElement("label");
    caption.className = "grid-ribbon-field-label";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "grid-ribbon-input";
    input.id = identifier("grid-ribbon");
    input.tabIndex = -1;
    input.style.width = `${control.width}px`;
    caption.htmlFor = input.id;
    const name = () => {
      caption.textContent = t(control.label);
    };
    name();
    relabels.push(name);
    let view: RibbonView | null = null;
    let shown = "";
    const commit = () => {
      const value = input.value.trim();
      if (value === "" || value === shown) {
        input.value = shown;
        return;
      }
      shown = value;
      give(control.id, control.params(value, view ?? readView()));
    };
    life.listen(input, "change", commit);
    life.listen(input, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
        engine.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        input.value = shown;
        engine.focus();
      }
    });
    el.append(caption, input);
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        shown = control.value(next);
        if (document.activeElement !== input) input.value = shown;
        input.disabled = stateOf(control.id)?.enabled === false;
      },
      activate: () => {
        input.focus();
        input.select();
      },
      relabel: () => {},
    };
  }

  function galleryItem(control: GalleryControl, group: RibbonGroup): Item {
    const el = wrap(control);
    let view: RibbonView | null = null;
    const press = button(control, () => t(control.label), (anchor) => openGallery(anchor, control, view ?? readView()));
    press.setAttribute("aria-haspopup", "dialog");
    press.setAttribute("aria-expanded", "false");
    press.append(chevron());
    el.append(press);
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        availability(press, stateOf(control.id), t(control.label));
      },
      activate: () => press.click(),
      relabel: () => {},
    };
  }

  function item(control: RibbonControl, group: RibbonGroup): Item {
    switch (control.kind) {
      case "button":
        return buttonItem(control, group);
      case "split":
        return splitItem(control, group);
      case "menu":
        return menuItem(control, group);
      case "color":
        return colorItem(control, group);
      case "select":
        return selectItem(control, group);
      case "check":
        return checkItem(control, group);
      case "field":
        return fieldItem(control, group);
      case "gallery":
        return galleryItem(control, group);
    }
  }

  /// Se il catalogo serve il controllo.
  function visible(control: RibbonControl, view: RibbonView): boolean {
    if (control.when && !control.when(view)) return false;
    if (control.kind !== "menu") return served(control.id);
    if (control.requires) return control.requires.every(served);
    const items = control.items(view);
    return !(items instanceof Promise) && items.some(entryServed);
  }

  // ── La tavolozza ──────────────────────────────────────────────────────
  /// Le frecce fra le caselle di una griglia di `columns` colonne.
  function gridKeys(lifetime: Lifetime, container: HTMLElement, cells: readonly HTMLButtonElement[], columns: number): void {
    lifetime.listen(container, "keydown", (event) => {
      const at = cells.indexOf(event.target as HTMLButtonElement);
      if (at < 0) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
      const next =
        event.key === "Home" ? 0 : event.key === "End" ? cells.length - 1 : step === undefined ? null : at + step;
      if (next === null) return;
      event.preventDefault();
      const target = cells[next];
      if (!target) return;
      cells[at]!.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    });
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
    anchor: HTMLButtonElement,
    control: ColorControl,
    theme: readonly string[],
    choose: (color: RibbonColor | "auto" | "none") => void,
  ): void {
    closePopover();
    closeContextMenu();
    const local = openLifetime();
    const box = document.createElement("div");
    box.className = "grid-ribbon-palette";
    const pick = (color: RibbonColor | "auto" | "none") => () => {
      closePopover();
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
    gridKeys(local, box, cells, THEME_COLUMNS.length);
    box.append(empty, title("ribbon.color.theme"), grid, title("ribbon.color.standard"), standard);
    showPopover(anchor, box, t(control.label), local);
  }

  function showPopover(anchor: HTMLElement, content: HTMLElement, label: string, local: Lifetime, className = "grid-ribbon-popover"): void {
    anchor.setAttribute("aria-expanded", "true");
    const handle = openPopover({
      anchor,
      content,
      label,
      className,
      lifetime: life,
      onClose: () => {
        local.close();
        anchor.setAttribute("aria-expanded", "false");
        if (popover === handle) popover = null;
      },
    });
    popover = handle;
  }

  // ── Le gallerie ───────────────────────────────────────────────────────
  function openGallery(anchor: HTMLButtonElement, control: GalleryControl, view: RibbonView): void {
    closePopover();
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
      local.listen(el, "click", () => give(control.id, control.params(name, view)));
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
      gridKeys(local, box, cells, 7);
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
      gridKeys(local, box, cells, 4);
    }
    const start = cells.find((cell) => cell.getAttribute("aria-pressed") === "true") ?? cells[0];
    if (start) start.tabIndex = 0;
    showPopover(anchor, box, t(control.label), local, "grid-ribbon-popover grid-ribbon-popover-gallery");
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

  // ── Gruppi e schede ───────────────────────────────────────────────────
  function mountColumn(column: RibbonColumn, group: RibbonGroup, into: HTMLElement, items: Item[]): void {
    if (!("rows" in column)) {
      const one = item(column, group);
      items.push(one);
      into.append(one.wrap);
      return;
    }
    const stack = document.createElement("div");
    stack.className = "grid-ribbon-stack";
    for (const controls of column.rows) {
      const row = document.createElement("div");
      row.className = "grid-ribbon-row";
      for (const control of controls) {
        const one = item(control, group);
        items.push(one);
        row.append(one.wrap);
      }
      stack.append(row);
    }
    into.append(stack);
  }

  function mountGroup(spec: RibbonGroup, toolbar: HTMLElement): Group {
    const element = document.createElement("div");
    element.className = "grid-ribbon-group";
    element.setAttribute("role", "group");
    element.dataset.group = spec.id;
    const body = document.createElement("div");
    body.className = "grid-ribbon-group-body";
    const items: Item[] = [];
    for (const column of spec.columns) mountColumn(column, spec, body, items);
    const caption = document.createElement("div");
    caption.className = "grid-ribbon-group-label";
    caption.setAttribute("aria-hidden", "true");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "grid-ribbon-button grid-ribbon-large grid-ribbon-group-toggle";
    toggle.tabIndex = -1;
    toggle.hidden = true;
    toggle.setAttribute("aria-haspopup", "dialog");
    toggle.setAttribute("aria-expanded", "false");
    const shape = iconEl(spec.icon);
    if (shape) toggle.append(shape);
    const toggleLabel = document.createElement("span");
    toggleLabel.className = "grid-ribbon-label";
    toggle.append(toggleLabel, chevron());
    element.append(body, caption, toggle);
    toolbar.append(element);
    const group: Group = {
      spec,
      element,
      body,
      toggle,
      items,
      collapsed: false,
      relabel: () => {
        element.setAttribute("aria-label", t(spec.label));
        caption.textContent = t(spec.label);
        toggleLabel.textContent = t(spec.label);
        labelButton(toggle, t(spec.label));
      },
    };
    group.relabel();
    relabels.push(group.relabel);
    life.listen(toggle, "click", () => openGroup(group));
    return group;
  }

  /// Il contenuto di un gruppo raccolto, in un riquadro sotto il suo pulsante.
  function openGroup(group: Group): void {
    closePopover();
    closeContextMenu();
    const local = openLifetime();
    const box = document.createElement("div");
    box.className = "grid-ribbon-popup-group";
    box.setAttribute("role", "toolbar");
    box.append(group.body);
    local.add(() => {
      group.element.prepend(group.body);
    });
    roving(local, box);
    showPopover(group.toggle, box, t(group.spec.label), local);
  }

  function collapseGroup(group: Group, on: boolean): void {
    group.collapsed = on;
    group.element.dataset.collapsed = String(on);
    group.toggle.hidden = !on;
  }

  const tabs: Tab[] = RIBBON_TABS.map((spec) => {
    const panel = document.createElement("div");
    panel.className = "grid-ribbon-panel";
    panel.dataset.tab = spec.id;
    panel.hidden = true;
    const toolbar = document.createElement("div");
    toolbar.className = "grid-ribbon-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-orientation", "horizontal");
    panel.append(toolbar);
    panels.append(panel);
    const groups = spec.groups.map((group) => mountGroup(group, toolbar));
    relabels.push(() => toolbar.setAttribute("aria-label", t(spec.label)));
    const settle = roving(life, toolbar);
    return { spec, panel, toolbar, groups, settle };
  });

  // ── La barra degli strumenti di una scheda ────────────────────────────
  /// Nascosto da qualcosa dentro `container`: il pannello di una scheda non
  /// scelta è nascosto, ma i suoi controlli restano in ordine.
  function hiddenWithin(control: HTMLElement, container: HTMLElement): boolean {
    for (let at: HTMLElement | null = control; at && at !== container; at = at.parentElement) if (at.hidden) return true;
    return false;
  }

  function focusables(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>("button, select, input")].filter(
      (control) =>
        !(control as HTMLButtonElement).disabled &&
        !hiddenWithin(control, container) &&
        control.closest('[data-collapsed="true"] > .grid-ribbon-group-body') === null,
    );
  }

  /// Il controllo che sta nel Tab, e le frecce fra gli altri. Restituisce
  /// chi rimette il Tab a posto quando i controlli cambiano.
  function roving(lifetime: Lifetime, container: HTMLElement): (target: HTMLElement | null) => void {
    let current: HTMLElement | null = null;
    const settle = (target: HTMLElement | null) => {
      const all = focusables(container);
      const wanted = target ?? current;
      current = wanted && all.includes(wanted) ? wanted : all[0] ?? null;
      for (const control of container.querySelectorAll<HTMLElement>("button, select, input")) {
        control.tabIndex = control === current ? 0 : -1;
      }
    };
    lifetime.listen(container, "mousedown", (event) => {
      if ((event.target as Element | null)?.closest("button")) event.preventDefault();
    });
    lifetime.listen(container, "focusin", (event) => {
      if (event.target instanceof HTMLElement) settle(event.target);
    });
    lifetime.listen(container, "keydown", (event) => {
      const target = event.target as HTMLElement;
      if (event.key === "Escape") {
        if (container.classList.contains("grid-ribbon-popup-group")) return;
        event.preventDefault();
        engine.focus();
        return;
      }
      if (target instanceof HTMLInputElement && target.type === "text") return;
      if (event.key === "ArrowDown" && target.getAttribute("aria-haspopup")) {
        event.preventDefault();
        target.click();
        return;
      }
      const all = focusables(container);
      const at = all.indexOf(target);
      if (at < 0) return;
      let next: number | null = null;
      if (event.key === "ArrowRight") next = (at + 1) % all.length;
      else if (event.key === "ArrowLeft") next = (at - 1 + all.length) % all.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = all.length - 1;
      if (next === null) return;
      event.preventDefault();
      settle(all[next]!);
      all[next]!.focus();
    });
    settle(null);
    return settle;
  }

  // ── Le schede visibili ────────────────────────────────────────────────
  let tabsLife: Lifetime | null = null;
  let tabsHandle: TabsHandle | null = null;
  let shownTabs = "";
  let selected = "home";

  function mountTabs(visible: readonly Tab[], force: boolean): void {
    const signature = visible.map((tab) => tab.spec.id).join(" ");
    if (signature === shownTabs && !force) return;
    shownTabs = signature;
    tabsLife?.close();
    const local = openLifetime();
    tabsLife = local;
    for (const tab of tabs) tab.panel.hidden = true;
    if (!visible.some((tab) => tab.spec.id === selected)) selected = visible[0]?.spec.id ?? "home";
    tabsHandle = createTabs({
      tablist,
      tabs: visible.map((tab) => ({ id: tab.spec.id, label: t(tab.spec.label), panel: tab.panel })),
      selected,
      label: t("ribbon.label"),
      lifetime: local,
      onSelect: (id) => {
        selected = id;
        scheduleFit();
      },
    });
    for (const tab of visible) {
      const button = tabsHandle.tab(tab.spec.id);
      if (!button) continue;
      button.dataset.keytip = tab.spec.keytip;
      if (tab.spec.contextual) button.classList.add("grid-ribbon-contextual");
    }
    // Una scheda scelta mentre la barra è raccolta la riapre; due click la
    // raccolgono, come in Excel.
    local.listen(tablist, "click", (event) => {
      if ((event.target as Element | null)?.closest(".kit-tab") && collapsed) setCollapsed(false);
    });
    local.listen(tablist, "dblclick", (event) => {
      if ((event.target as Element | null)?.closest(".kit-tab")) setCollapsed(!collapsed);
    });
    local.listen(tablist, "mousedown", (event) => {
      if ((event.target as Element | null)?.closest(".kit-tab")) event.preventDefault();
    });
  }

  function chooseTab(id: string): void {
    if (!tabsHandle) return;
    tabsHandle.select(id);
    selected = tabsHandle.selected() ?? selected;
    scheduleFit();
  }

  function setCollapsed(on: boolean): void {
    collapsed = on;
    element.dataset.collapsed = String(on);
    panels.hidden = on;
    toggle.setAttribute("aria-expanded", String(!on));
    labelButton(toggle, t(on ? "ribbon.expand" : "ribbon.collapse"));
    toggle.replaceChildren(iconEl(on ? "gr-chevron-down" : "gr-chevron-up") ?? "");
    if (on) closePopover();
    else scheduleFit();
  }
  life.listen(toggle, "click", () => setCollapsed(!collapsed));
  life.listen(toggle, "mousedown", (event) => event.preventDefault());

  // ── Quando la barra è stretta ─────────────────────────────────────────
  let fitFrame: number | null = null;
  function scheduleFit(): void {
    if (fitFrame !== null || life.closed) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = null;
      fit();
    });
  }
  life.add(() => {
    if (fitFrame !== null) cancelAnimationFrame(fitFrame);
    fitFrame = null;
  });

  /// Raccoglie i gruppi da destra finché la scheda non sta nella barra:
  /// prima i pulsanti piccoli perdono il nome, poi i gruppi si chiudono.
  function fit(): void {
    const tab = tabs.find((each) => each.spec.id === selected);
    if (!tab || collapsed || element.hidden) return;
    if (popover && tab.groups.some((group) => group.toggle.getAttribute("aria-expanded") === "true")) return;
    const toolbar = tab.toolbar;
    const overflows = () => toolbar.scrollWidth > toolbar.clientWidth + 1;
    tab.panel.dataset.compact = "false";
    for (const group of tab.groups) collapseGroup(group, false);
    if (!overflows()) return;
    tab.panel.dataset.compact = "true";
    const open = tab.groups.filter((group) => !group.element.hidden);
    for (let at = open.length - 1; at >= 0 && overflows(); at -= 1) collapseGroup(open[at]!, true);
    // Dentro i gruppi raccolti il fuoco non ha più dove stare.
    const focus = document.activeElement as HTMLElement | null;
    if (focus && toolbar.contains(focus) && !focusables(toolbar).includes(focus)) engine.focus();
    tab.settle(null);
  }

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => scheduleFit());
    observer.observe(element);
    life.add(() => observer.disconnect());
  }

  // ── Le lettere ────────────────────────────────────────────────────────
  interface Tip {
    readonly keytip: string;
    readonly anchor: HTMLElement;
    readonly run: () => void;
  }
  let tipsLife: Lifetime | null = null;
  let armed = false;

  function editing(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(EDITABLE) !== null && !host.contains(target);
  }

  function tabTips(): Tip[] {
    return tabs
      .filter((tab) => shownTabs.split(" ").includes(tab.spec.id))
      .map((tab) => ({
        keytip: tab.spec.keytip,
        anchor: tabsHandle?.tab(tab.spec.id) ?? tab.panel,
        run: () => {
          if (collapsed) setCollapsed(false);
          chooseTab(tab.spec.id);
          // La scheda si è appena mostrata: i gruppi si raccolgono prima che
          // si contino le lettere.
          fit();
          showTips(controlTips(tab), () => showTips(tabTips(), null));
        },
      }));
  }

  function controlTips(tab: Tab): Tip[] {
    const tips: Tip[] = [];
    for (const group of tab.groups) {
      if (group.element.hidden) continue;
      if (group.collapsed) {
        tips.push({ keytip: group.spec.keytip, anchor: group.toggle, run: () => openGroup(group) });
        continue;
      }
      for (const one of group.items) {
        if (one.shown) tips.push({ keytip: one.control.keytip, anchor: one.wrap, run: () => one.activate() });
      }
    }
    return tips;
  }

  function hideTips(): void {
    tipsLife?.close();
    tipsLife = null;
  }

  /// Mostra le lettere `tips`; Esc torna a `back`, o chiude.
  function showTips(tips: readonly Tip[], back: (() => void) | null): void {
    hideTips();
    if (tips.length === 0) return;
    const local = openLifetime();
    tipsLife = local;
    element.dataset.keytips = "true";
    local.add(() => delete element.dataset.keytips);
    let typed = "";
    const badges = tips.map((tip) => {
      const badge = document.createElement("span");
      badge.className = "grid-ribbon-keytip";
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = tip.keytip;
      tip.anchor.append(badge);
      local.add(() => badge.remove());
      return badge;
    });
    const narrow = () => {
      tips.forEach((tip, at) => {
        badges[at]!.hidden = !tip.keytip.startsWith(typed);
      });
    };
    local.listen(
      document,
      "keydown",
      (event) => {
        if (event.key === "Shift" || event.key === "Control" || event.key === "Meta") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
          if (typed !== "") {
            typed = "";
            narrow();
          } else if (back) {
            back();
          } else {
            hideTips();
          }
          return;
        }
        if (event.key === "Alt" || event.key === "F10" || event.key === "Tab") {
          hideTips();
          return;
        }
        if (event.key === "Backspace") {
          typed = typed.slice(0, -1);
          narrow();
          return;
        }
        if (event.key.length !== 1) return;
        typed += event.key.toUpperCase();
        const exact = tips.find((tip) => tip.keytip === typed);
        if (exact) {
          hideTips();
          exact.run();
          return;
        }
        if (!tips.some((tip) => tip.keytip.startsWith(typed))) {
          hideTips();
          return;
        }
        narrow();
      },
      { capture: true },
    );
    local.listen(document, "mousedown", hideTips, { capture: true });
    local.listen(window, "blur", hideTips);
  }

  life.add(hideTips);
  life.listen(root, "keydown", (event) => {
    if (tipsLife || element.hidden) return;
    if (event.key === "F10" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (editing(event.target)) return;
      event.preventDefault();
      showTips(tabTips(), null);
      return;
    }
    armed = event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey && !editing(event.target);
  });
  life.listen(root, "keyup", (event) => {
    if (event.key !== "Alt" || !armed) return;
    armed = false;
    if (tipsLife || element.hidden) return;
    event.preventDefault();
    showTips(tabTips(), null);
  });
  life.listen(root, "mousedown", () => {
    armed = false;
  });

  // ── L'aggiornamento ───────────────────────────────────────────────────
  function refresh(): void {
    if (life.closed) return;
    states = new Map(engine.commands().map((state) => [state.id, state]));
    const on = engine.commandable();
    element.hidden = !on;
    if (!on) {
      closePopover();
      if (menuOpen) closeContextMenu();
      hideTips();
      return;
    }
    const view = readView();
    const shown: Tab[] = [];
    for (const tab of tabs) {
      let any = false;
      for (const group of tab.groups) {
        let groupAny = false;
        for (const one of group.items) {
          one.shown = visible(one.control, view);
          one.wrap.hidden = !one.shown;
          if (one.shown) {
            one.update(view);
            groupAny = true;
          }
        }
        group.element.hidden = !groupAny;
        any ||= groupAny;
      }
      if (any && contextShown(tab.spec, view)) shown.push(tab);
    }
    mountTabs(shown, false);
    for (const tab of tabs) tab.settle(null);
    scheduleFit();
  }

  let frame: number | null = null;
  function schedule(): void {
    if (frame !== null || life.closed) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      refresh();
    });
  }
  life.add(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  });

  function relabel(): void {
    for (const name of relabels) name();
    for (const tab of tabs) for (const group of tab.groups) for (const one of group.items) one.relabel();
    labelButton(toggle, t(collapsed ? "ribbon.expand" : "ribbon.collapse"));
  }

  relabel();
  setCollapsed(false);
  life.add(
    onLanguage(() => {
      relabel();
      refresh();
      mountTabs(tabs.filter((tab) => shownTabs.split(" ").includes(tab.spec.id)), true);
    }),
  );
  refresh();

  return {
    element,
    refresh,
    schedule,
    destroy() {
      closePopover();
      if (menuOpen) closeContextMenu();
      tabsLife?.close();
      tabsLife = null;
      life.close();
      element.remove();
    },
  };
}
