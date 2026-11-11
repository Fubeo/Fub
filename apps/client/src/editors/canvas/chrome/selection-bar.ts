// La barra della selezione della lavagna (T51, «Che cosa si riusa» di
// `lavagna.md`): sopra le schede scelte, le azioni che servono senza andare al
// menu, come la barra «Disponi» del disegno (`.draw-arrange`), con l'aspetto
// del prototipo (`PLAN-ui/lavagna-impianto.html`, la barra con una, tre e venti
// schede).
//
// - **Quando c'è.** Lo dice una regola pura, `selectionBarWanted`: delle schede
//   scelte, nessun gesto in corso (il puntatore giù, la rotella, un volo), la
//   penna su e nessuno che scrive dentro una scheda. La tela la chiede a fine
//   gesto, mai durante: durante, la barra non c'è.
// - **Dove sta.** `selectionBarPlace`: sopra il riquadro delle schede scelte,
//   centrata, dentro la vista, con lo spazio del titolo sopra la scheda (T39);
//   al bordo alto va sotto. È `bubblePlace` della bolla del testo. Con le
//   schede tutte fuori dalla vista la barra non c'è.
// - **Le azioni** le dice `selectionBarActions`: Colore (il menu di T47),
//   Collega, Raggruppa, «Allinea e distribuisci» con più schede, Apri con una
//   (se si apre), Togli dalla lavagna. Ognuna è un comando del catalogo
//   (`commands.ts`): il nome, il tasto nel suggerimento, spenta col perché
//   (`aria-disabled`, così il lettore di schermo ci arriva e lo sente); in sola
//   lettura il catalogo spegne quelle che cambiano il file.
// - **I tratti scelti col lazo** (T86) portano due pulsanti suoi: il colore
//   (gli otto di `INK_PALETTE`, come nel menu della penna) e lo spessore (il
//   cursore della penna, in pixel dello schermo). La barra non tiene la
//   scelta: la dà a chi la monta (`restyle`), una volta per gesto (un clic
//   sul colore, il cursore lasciato), così ogni cambio è un annulla solo.
// - **Sempre gli stessi elementi**, creati una volta: la barra cambia quali
//   mostra, non li rifà, così il fuoco non si perde e ogni ascoltatore sta
//   nella vita della lavagna.
// - **La tastiera.** Una `toolbar` con un solo punto di tabulazione: le frecce
//   fra i pulsanti, Inizio e Fine ai capi, Esc torna alla lavagna.

import { bubblePlace } from "../../../panels/selection-bubble";
import { resolvedLanguage, t, type Key } from "../../../i18n/strings";
import { INK_PALETTE, inkSwatchOf, type InkSwatch } from "../../../ink/palette";
import { openPopover, type PopoverHandle } from "../../../kit";
import { identifier } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { setTooltip } from "../../../ui/tooltip";
import { displayCanvasKey, type CanvasCommand } from "./commands";
import { ensureCanvasIcons } from "./icons";
import { paintColorChip, type CanvasChosenColor } from "./options";
import { INK_WIDTH_RANGES, type InkStrokeTool } from "../ink-record";

/// Il momento della lavagna che decide se la barra c'è.
export interface SelectionBarMoment {
  /// Quante schede e quanti tratti sono scelti (i fili da soli non contano).
  readonly chosen: number;
  /// Un gesto in corso: il puntatore giù, la rotella che gira, un volo.
  readonly gesture: boolean;
  /// Una penna è giù.
  readonly pen: boolean;
  /// Si scrive dentro una scheda (il campo del testo, una scheda attiva).
  readonly writing: boolean;
}

/// La barra c'è adesso?
export function selectionBarWanted(moment: SelectionBarMoment): boolean {
  return moment.chosen > 0 && !moment.gesture && !moment.pen && !moment.writing;
}

/// Il colore dei tratti scelti, nella barra.
export const STROKE_COLOR = "canvas.stroke_color";
/// Lo spessore dei tratti scelti, nella barra.
export const STROKE_WIDTH = "canvas.stroke_width";

/// I comandi della barra, nell'ordine, con `chosen` schede scelte; `open` è il
/// comando che apre la sola scheda scelta (`canvas.open`, `canvas.open_url`),
/// `null` se non si apre. Con `strokes` tratti scelti col lazo (T86) ci sono
/// anche il loro colore e il loro spessore, prima di «Togli dalla lavagna»
/// (che toglie le schede).
export function selectionBarActions(chosen: number, open: string | null, strokes = 0): string[] {
  const actions: string[] = [];
  if (chosen > 0) {
    actions.push("canvas.color_menu", "canvas.connect", "canvas.group");
    if (chosen > 1) actions.push("canvas.align_menu");
    if (chosen === 1 && open !== null) actions.push(open);
  }
  if (strokes > 0) actions.push(STROKE_COLOR, STROKE_WIDTH);
  if (chosen > 0) actions.push("canvas.delete");
  return actions;
}

/// Un riquadro sullo schermo, in pixel della vista.
export interface SelectionBarBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/// Lo spazio del titolo sopra la scheda (T39): la barra sta sopra anche lui,
/// a 26 px dalla scheda come nel prototipo (`bubblePlace` ne mette 8).
export const SELECTION_BAR_TITLE_ROOM = 18;
/// Sotto, a 10 px dalla scheda come nel prototipo.
const BELOW_ROOM = 2;

/// Dove va una barra larga e alta `size` sopra le schede scelte `box`, dentro
/// la vista `view`: `null` se le schede sono tutte fuori dalla vista.
export function selectionBarPlace(
  box: SelectionBarBox,
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } | null {
  if (![box.left, box.top, box.right, box.bottom].every(Number.isFinite)) return null;
  if (box.right <= 0 || box.bottom <= 0 || box.left >= view.width || box.top >= view.height) return null;
  return bubblePlace(
    { left: box.left, top: box.top - SELECTION_BAR_TITLE_ROOM, right: box.right, bottom: box.bottom + BELOW_ROOM },
    size,
    view,
  );
}

/// I tratti scelti col lazo, come li mostra la barra.
export interface SelectionBarStrokes {
  /// Quanti sono.
  readonly count: number;
  /// Il loro colore (`#rrggbb`), o `null` se non è lo stesso per tutti.
  readonly color: string | null;
  /// Il loro spessore in pixel dello schermo, o `null` se non è lo stesso.
  readonly width: number | null;
  /// Lo strumento del cursore: l'evidenziatore se sono tutti suoi.
  readonly tool: InkStrokeTool;
  /// Perché non si cambiano (la sola lettura), o `null`.
  readonly off: string | null;
}

/// Un cambio dei tratti scelti: il colore, o lo spessore in pixel dello schermo.
export type SelectionBarRestyle = { readonly color: string } | { readonly width: number };

/// Che cosa la barra mostra: le schede scelte, sullo schermo.
export interface SelectionBarShow {
  /// Quante schede sono scelte.
  readonly chosen: number;
  /// Il comando che apre la sola scheda scelta, o `null`.
  readonly open: string | null;
  /// I tratti scelti col lazo (T86), se ce ne sono.
  readonly strokes?: SelectionBarStrokes | null;
  /// Il riquadro delle schede e dei tratti scelti, in pixel della vista.
  readonly box: SelectionBarBox;
  /// La misura della vista.
  readonly view: { width: number; height: number };
  /// Lo scarto della vista nel contenitore della barra.
  readonly offset?: { left: number; top: number };
}

export interface CanvasSelectionBarContext {
  readonly lifetime: Lifetime;
  /// I comandi della lavagna adesso (il catalogo con ciò che fanno).
  readonly commands: () => readonly CanvasCommand[];
  /// Esegue il comando `id`, se si può; `trigger` è il pulsante della barra
  /// che l'ha chiesto (i menu ci si aprono sotto).
  readonly run: (id: string, trigger: HTMLButtonElement) => void;
  /// Il colore delle schede scelte.
  readonly color: () => CanvasChosenColor;
  /// Esc nella barra: il fuoco torna alla lavagna.
  readonly back: () => void;
  /// Cambia i tratti scelti (T86): una volta per gesto.
  readonly restyle?: (change: SelectionBarRestyle) => void;
}

export interface CanvasSelectionBar {
  /// La barra, `.canvas-selection-bar`.
  readonly element: HTMLElement;
  /// La barra si vede.
  readonly shown: boolean;
  /// Mostra la barra per queste schede, al suo posto; se le schede sono fuori
  /// dalla vista la nasconde.
  show(what: SelectionBarShow): void;
  /// Nasconde la barra.
  hide(): void;
  /// Ridice nomi, perché e colore (la lingua, la sola lettura, il colore).
  relabel(): void;
}

/// L'icona di ogni comando della barra.
const ICON: Readonly<Record<string, string>> = {
  "canvas.connect": "canvas-connect",
  "canvas.group": "draw-group",
  "canvas.align_menu": "draw-align",
  "canvas.open": "draw-open-link",
  "canvas.open_url": "draw-open-link",
  "canvas.delete": "trash",
};

/// I comandi che aprono un menu sotto il pulsante.
const MENUS = new Set(["canvas.color_menu", "canvas.align_menu"]);

const SVG_NS = "http://www.w3.org/2000/svg";

/// Il nome di un colore della tavolozza dell'inchiostro.
function swatchKey(swatch: InkSwatch): Key {
  return `canvas.ink.color.${swatch.id}` as Key;
}

/// Il nome del colore dei tratti scelti: della tavolozza, il codice, o
/// «Diversi».
function strokeColorName(color: string | null): string {
  if (color === null) return t("canvas.ink.chosen_mixed");
  const swatch = inkSwatchOf(color);
  return swatch ? t(swatchKey(swatch)) : color;
}

/// Un pixel scritto nella lingua di adesso: «4», «0,5».
function pixels(value: number): string {
  return new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: 1 }).format(value);
}

/// Monta la barra della selezione, nascosta.
export function createCanvasSelectionBar(ctx: CanvasSelectionBarContext): CanvasSelectionBar {
  ensureCanvasIcons();
  const { lifetime } = ctx;
  const element = document.createElement("div");
  element.className = "canvas-selection-bar";
  element.setAttribute("role", "toolbar");
  element.hidden = true;

  const buttons = new Map<string, HTMLButtonElement>();
  /// I comandi mostrati adesso, nell'ordine.
  let actions: string[] = [];

  const button = (command: string, press?: (control: HTMLButtonElement) => void): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "canvas-button";
    control.tabIndex = -1;
    control.dataset.command = command;
    control.hidden = true;
    if (MENUS.has(command)) {
      control.id = identifier("canvas-selection-menu");
      control.setAttribute("aria-haspopup", "menu");
      control.setAttribute("aria-expanded", "false");
    }
    lifetime.listen(control, "click", (event) => {
      event.preventDefault();
      if (control.getAttribute("aria-disabled") === "true") return;
      if (press) press(control);
      else ctx.run(command, control);
    });
    buttons.set(command, control);
    element.append(control);
    return control;
  };

  // Il colore: il pallino come lo dipinge la lavagna (T47).
  const colorButton = button("canvas.color_menu");
  const chip = document.createElement("span");
  chip.className = "kit-color-chip canvas-selection-chip";
  chip.setAttribute("aria-hidden", "true");
  colorButton.append(chip);
  const iconButton = (command: string): void => {
    const control = button(command);
    const svg = iconEl(ICON[command]!);
    if (svg) {
      svg.setAttribute("aria-hidden", "true");
      control.append(svg);
    }
  };
  for (const command of ["canvas.connect", "canvas.group", "canvas.align_menu", "canvas.open", "canvas.open_url"]) iconButton(command);

  // I tratti scelti col lazo (T86): il colore e lo spessore, ognuno col suo
  // rialzo. La barra non tiene la scelta: la legge da `show`.
  let strokes: SelectionBarStrokes | null = null;
  let popover: PopoverHandle | null = null;
  const dialogButton = (command: string, open: (control: HTMLButtonElement) => void): HTMLButtonElement => {
    const control = button(command, (from) => {
      if (popover) popover.close();
      else open(from);
    });
    control.setAttribute("aria-haspopup", "dialog");
    control.setAttribute("aria-expanded", "false");
    return control;
  };
  /// Apre il rialzo `root` sotto il pulsante `control`, col fuoco su `focus`.
  const openFrom = (control: HTMLButtonElement, root: HTMLElement, label: string, focus: HTMLElement | null): void => {
    const handle = openPopover({
      anchor: control,
      content: root,
      label,
      className: "canvas-pen-popover canvas-stroke-popover",
      lifetime,
      autoFocus: false,
      onClose: () => {
        if (popover === handle) popover = null;
        control.setAttribute("aria-expanded", "false");
      },
    });
    if (handle.closed) return;
    popover = handle;
    control.setAttribute("aria-expanded", "true");
    focus?.focus();
  };
  const strokeSection = (root: HTMLElement): HTMLElement => {
    const section = document.createElement("div");
    section.className = "canvas-pen-section";
    root.append(section);
    return section;
  };

  const strokeColorButton = dialogButton(STROKE_COLOR, (control) => {
    const restyle = ctx.restyle;
    if (!strokes || !restyle) return;
    const root = document.createElement("div");
    root.className = "canvas-pen-menu canvas-stroke-menu";
    const section = strokeSection(root);
    const heading = document.createElement("h2");
    heading.className = "canvas-pen-heading";
    heading.id = identifier("canvas-stroke-heading");
    heading.textContent = t("canvas.ink.color");
    const group = document.createElement("div");
    group.className = "canvas-pen-swatches";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", heading.id);
    section.append(heading, group);
    const current = strokes.color;
    const items = INK_PALETTE.map((swatch) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "canvas-pen-swatch";
      item.setAttribute("role", "radio");
      item.dataset.value = swatch.color;
      const checked = current !== null && swatch.color === current.toLowerCase();
      item.setAttribute("aria-checked", String(checked));
      item.tabIndex = checked ? 0 : -1;
      item.setAttribute("aria-label", t(swatchKey(swatch)));
      setTooltip(item, t(swatchKey(swatch)));
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 20 20");
      svg.setAttribute("aria-hidden", "true");
      const ring = document.createElementNS(SVG_NS, "circle");
      ring.setAttribute("cx", "10");
      ring.setAttribute("cy", "10");
      ring.setAttribute("r", "8");
      ring.setAttribute("fill", swatch.color);
      ring.setAttribute("stroke", "currentColor");
      ring.setAttribute("stroke-opacity", "0.25");
      svg.append(ring);
      item.append(svg);
      group.append(item);
      return item;
    });
    if (!items.some((item) => item.tabIndex === 0)) items[0]!.tabIndex = 0;
    lifetime.listen(group, "click", (event) => {
      const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".canvas-pen-swatch") : null;
      if (!item || !group.contains(item)) return;
      popover?.close();
      restyle({ color: item.dataset.value! });
    });
    lifetime.listen(group, "keydown", (event) => {
      const at = items.indexOf(event.target as HTMLButtonElement);
      const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
      if (at < 0 || !step) return;
      event.preventDefault();
      const next = items[(at + step + items.length) % items.length]!;
      for (const item of items) item.tabIndex = item === next ? 0 : -1;
      next.focus();
    });
    openFrom(control, root, t("canvas.ink.chosen_color", { name: strokeColorName(current) }), items.find((item) => item.tabIndex === 0) ?? null);
  });
  const strokeChip = document.createElement("span");
  strokeChip.className = "kit-color-chip canvas-selection-chip";
  strokeChip.setAttribute("aria-hidden", "true");
  strokeColorButton.append(strokeChip);

  const strokeWidthButton = dialogButton(STROKE_WIDTH, (control) => {
    const restyle = ctx.restyle;
    if (!strokes || !restyle) return;
    const root = document.createElement("div");
    root.className = "canvas-pen-menu canvas-stroke-menu";
    const section = strokeSection(root);
    const head = document.createElement("div");
    head.className = "canvas-pen-width-head";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "canvas-pen-width";
    slider.id = identifier("canvas-stroke-width");
    const range = INK_WIDTH_RANGES[strokes.tool];
    slider.min = String(range.min);
    slider.max = String(range.max);
    slider.step = String(range.step);
    const start = strokes.width ?? range.min;
    slider.value = String(Math.min(range.max, Math.max(range.min, start)));
    const label = document.createElement("label");
    label.className = "canvas-pen-heading";
    label.htmlFor = slider.id;
    label.textContent = t("canvas.ink.width");
    const output = document.createElement("output");
    output.className = "canvas-pen-width-value";
    output.setAttribute("for", slider.id);
    const say = (): void => {
      const value = t("canvas.ink.chosen_px", { px: pixels(Number(slider.value)) });
      output.textContent = value;
      slider.setAttribute("aria-valuetext", value);
    };
    say();
    head.append(label, output);
    section.append(head, slider);
    lifetime.listen(slider, "input", say);
    // Il cursore lasciato: un cambio solo, un annulla solo.
    lifetime.listen(slider, "change", () => {
      const width = Number(slider.value);
      if (Number.isFinite(width) && width > 0) restyle({ width });
    });
    openFrom(control, root, t("canvas.ink.chosen_width"), slider);
  });
  const widthSvg = document.createElementNS(SVG_NS, "svg");
  widthSvg.setAttribute("class", "canvas-stroke-width-icon");
  widthSvg.setAttribute("viewBox", "0 0 24 24");
  widthSvg.setAttribute("aria-hidden", "true");
  const widthLine = document.createElementNS(SVG_NS, "path");
  widthLine.setAttribute("d", "M5 12h14");
  widthLine.setAttribute("stroke", "currentColor");
  widthLine.setAttribute("stroke-linecap", "round");
  widthSvg.append(widthLine);
  strokeWidthButton.append(widthSvg);

  iconButton("canvas.delete");

  /// I pulsanti che si vedono, nell'ordine.
  const reachable = (): HTMLButtonElement[] =>
    [...element.querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.hidden);

  /// Un solo punto di tabulazione: quello che aveva il fuoco, o il primo.
  const rove = (focus?: HTMLButtonElement): void => {
    const all = reachable();
    if (all.length === 0) return;
    const keep = focus ?? all.find((control) => control.tabIndex === 0) ?? all[0]!;
    for (const control of buttons.values()) control.tabIndex = control === keep ? 0 : -1;
  };
  lifetime.listen(element, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      ctx.back();
      return;
    }
    const all = reachable();
    const at = all.indexOf(event.target as HTMLButtonElement);
    if (at < 0) return;
    const next = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = all[(next + all.length) % all.length]!;
    rove(target);
    target.focus();
  });

  /// Nome, suggerimento, tasto e perché di un pulsante.
  const paint = (control: HTMLButtonElement, command: CanvasCommand | undefined, name?: string): void => {
    if (!command) {
      control.hidden = true;
      return;
    }
    const label = name ?? command.label;
    const first = command.keys[0];
    const keys = first === undefined ? "" : displayCanvasKey(first);
    const why = command.disabled();
    const said = why === null ? label : t("canvas.options.off", { name: label, why });
    if (control.getAttribute("aria-label") !== said) control.setAttribute("aria-label", said);
    setTooltip(control, keys && why === null ? `${label} (${keys})` : said);
    if (first === undefined) control.removeAttribute("aria-keyshortcuts");
    else control.setAttribute("aria-keyshortcuts", displayCanvasKey(first, "other"));
    if (why === null) control.removeAttribute("aria-disabled");
    else control.setAttribute("aria-disabled", "true");
  };

  /// Nome, suggerimento e perché di un pulsante dei tratti.
  const paintStroke = (control: HTMLButtonElement, label: string, why: string | null): void => {
    const said = why === null ? label : t("canvas.options.off", { name: label, why });
    if (control.getAttribute("aria-label") !== said) control.setAttribute("aria-label", said);
    setTooltip(control, said);
    if (why === null) control.removeAttribute("aria-disabled");
    else control.setAttribute("aria-disabled", "true");
  };

  const relabel = (): void => {
    if (lifetime.closed) return;
    element.setAttribute("aria-label", t("canvas.selection_bar"));
    if (element.hidden) return;
    const catalog = new Map(ctx.commands().map((command) => [command.id, command]));
    const color = ctx.color();
    const colorName = paintColorChip(chip, color);
    for (const [id, control] of buttons) {
      if (!actions.includes(id)) {
        control.hidden = true;
        continue;
      }
      control.hidden = false;
      if (id === STROKE_COLOR || id === STROKE_WIDTH) continue;
      paint(control, catalog.get(id), id === "canvas.color_menu" ? t("canvas.options.color_value", { name: colorName }) : undefined);
    }
    if (strokes) {
      paintColorChip(strokeChip, strokes.color);
      paintStroke(strokeColorButton, t("canvas.ink.chosen_color", { name: strokeColorName(strokes.color) }), strokes.off);
      const width = strokes.width;
      paintStroke(
        strokeWidthButton,
        width === null ? t("canvas.ink.chosen_width") : t("canvas.ink.chosen_width_value", { px: pixels(width) }),
        strokes.off,
      );
      // La linea dell'icona: più spessa coi tratti più spessi, entro la casella.
      const shown = width === null ? 2 : Math.min(8, Math.max(1, width / 2));
      widthLine.setAttribute("stroke-width", String(Math.round(shown * 2) / 2));
    }
    rove();
  };

  let shown = false;
  const hide = (): void => {
    if (!shown && element.hidden) return;
    shown = false;
    popover?.close();
    // Il fuoco che era nella barra (Togli, un tasto) torna alla lavagna.
    const focused = element.contains(document.activeElement);
    element.hidden = true;
    if (focused) ctx.back();
  };

  const show = (what: SelectionBarShow): void => {
    if (lifetime.closed) return;
    strokes = what.strokes && what.strokes.count > 0 ? what.strokes : null;
    const next = selectionBarActions(what.chosen, what.open, strokes?.count ?? 0);
    if (next.length === 0) {
      hide();
      return;
    }
    actions = next;
    // Nascosta non ha misura: si mostra prima, poi si misura e si mette.
    element.hidden = false;
    relabel();
    const size = { width: element.offsetWidth, height: element.offsetHeight };
    const at = selectionBarPlace(what.box, size, what.view);
    if (!at) {
      hide();
      return;
    }
    shown = true;
    const offset = what.offset ?? { left: 0, top: 0 };
    element.style.left = `${at.left + offset.left}px`;
    element.style.top = `${at.top + offset.top}px`;
  };

  relabel();
  return {
    element,
    get shown() {
      return shown;
    },
    show,
    hide,
    relabel,
  };
}
