// Il menu della penna della lavagna (N4 T21, `PLAN-ui/lavagna-penne.html`).
//
// Nella riga delle opzioni (T50, `chrome/options.ts`) un pulsante col tondo
// del colore e il nome della penna di adesso; apre un rialzo del kit
// (`openPopover`) con le sezioni del prototipo: Strumento (Penna,
// Evidenziatore, Gomma), Tipo di penna (le sei penne della Penna di
// `ink/pens.ts`, con l'anteprima disegnata da `inkPath` col pennello di
// `penBrush`, come `penPreview` dei disegni), Colore (gli otto
// di `INK_PALETTE` e «Altro colore…» col selettore del kit), Spessore (un
// cursore in pixel dello schermo, col valore accanto e il tratto vero sotto),
// «La gomma cancella» e la nota sui tratti già scritti.
//
// Il menu non tiene la scelta: la legge da chi lo monta (`choice`) e gli dà
// ogni scelta nuova (`choose`); chi lo monta la applica, la ricorda e chiama
// `sync`. Il pulsante resta lo stesso elemento per tutta la vita del menu,
// così la riga si può rifare con il rialzo aperto.
//
// La tastiera come il prototipo: Invio o Spazio sul pulsante apre, le frecce
// si muovono e scelgono dentro un gruppo, Tab passa al gruppo dopo, Esc chiude
// e rende il fuoco al pulsante (lo fa il rialzo del kit). Ogni ascoltatore sta
// nella vita di chi lo monta, o in quella del rialzo aperto.

import { resolvedLanguage, t, type Key } from "../../i18n/strings";
import { inkPath } from "../../ink/outline";
import { INK_PALETTE, inkSwatchOf, type InkSwatch } from "../../ink/palette";
import { penBrush, penLook, type PenId } from "../../ink/pens";
import { quantizeInk } from "../../ink/sample";
import { createColorPicker, openPopover, type ColorPickerText, type PopoverHandle } from "../../kit";
import { identifier } from "../../ui/a11y";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { InkEraserMode } from "./ink-erase";
import {
  INK_WIDTH_RANGES,
  inkPenOf,
  inkStrokeTool,
  inkWidthOf,
  type InkMenuTool,
  type InkPenChoice,
  type InkPenKind,
} from "./ink-record";

const SVG_NS = "http://www.w3.org/2000/svg";

/// Gli strumenti del menu, nell'ordine.
export const PEN_MENU_TOOLS: readonly InkMenuTool[] = ["pen", "highlighter", "eraser"];

/// Le penne della Penna, nell'ordine della galleria.
export const PEN_MENU_KINDS: readonly InkPenKind[] = ["ballpoint", "fountain", "brush", "marker", "pencil", "calligraphy"];

const ERASER_MODES: readonly InkEraserMode[] = ["stroke", "piece"];

const TOOL_LABELS: Readonly<Record<InkMenuTool, Key>> = {
  pen: "canvas.ink.tool.pen",
  highlighter: "canvas.ink.tool.highlighter",
  eraser: "canvas.ink.tool.eraser",
};

const KIND_LABELS: Readonly<Record<InkPenKind, Key>> = {
  ballpoint: "canvas.ink.kind.ballpoint",
  fountain: "canvas.ink.kind.fountain",
  brush: "canvas.ink.kind.brush",
  marker: "canvas.ink.kind.marker",
  pencil: "canvas.ink.kind.pencil",
  calligraphy: "canvas.ink.kind.calligraphy",
};

const COLOR_LABELS: Readonly<Record<InkSwatch["id"], Key>> = {
  black: "canvas.ink.color.black",
  blue: "canvas.ink.color.blue",
  vermilion: "canvas.ink.color.vermilion",
  green: "canvas.ink.color.green",
  purple: "canvas.ink.color.purple",
  orange: "canvas.ink.color.orange",
  sky: "canvas.ink.color.sky",
  yellow: "canvas.ink.color.yellow",
};

const ERASER_LABELS: Readonly<Record<InkEraserMode, Key>> = {
  stroke: "canvas.ink.eraser.stroke",
  piece: "canvas.ink.eraser.piece",
};

/// Il valore del radio «Altro colore…».
const CUSTOM = "custom";

const HEX6 = /^#[0-9a-f]{6}$/i;

/// Il tratto d'esempio delle anteprime delle penne: un'onda con la pressione
/// che cresce e cala, nelle unità di `viewBox="0 0 60 28"`.
const KIND_SAMPLE = wave(4, 56, 14, 7, 24);
/// La misura del tratto d'esempio: le penne si confrontano alla stessa misura.
const KIND_SAMPLE_SIZE = 3;
/// L'anteprima dello spessore: `viewBox="0 0 256 44"`; oltre 40 pixel il
/// tratto si mostra a 40.
const WIDTH_PREVIEW_MAX = 40;

/// Un'onda di `n` campioni da `x0` a `x1`, alta `amp` attorno a `y`, con la
/// pressione che cresce e cala.
function wave(x0: number, x1: number, y: number, amp: number, n: number): readonly { x: number; y: number; p: number; t: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const k = i / (n - 1);
    return { x: x0 + k * (x1 - x0), y: y - Math.sin(k * Math.PI * 2) * amp, p: Math.sin(k * Math.PI), t: i * 16 };
  });
}

/// Il contorno del tratto `samples` con la penna `pen` di misura `size`.
function previewPath(samples: readonly { x: number; y: number; p: number; t: number }[], pen: PenId, size: number): string {
  try {
    return inkPath(quantizeInk(samples, 100), penBrush(pen, size, true));
  } catch {
    return "";
  }
}

/// Un pixel scritto nella lingua di adesso: «4», «0,5».
function pixels(value: number): string {
  return new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: 1 }).format(value);
}

/// I testi del selettore dei colori: quelli dell'inchiostro dei documenti.
/// Li usa anche «Altro…» del colore delle schede (T47).
export function pickerText(): ColorPickerText {
  return {
    area: t("rich.ink.picker.area"),
    areaValue: (saturation, value) => t("rich.ink.picker.area.value", { s: String(saturation), v: String(value) }),
    hue: t("rich.ink.picker.hue"),
    alpha: t("rich.ink.picker.alpha"),
    format: t("rich.ink.picker.format"),
    formats: { hex: "HEX", rgb: "RGB", hsl: "HSL", oklch: "OKLCH" },
    code: t("rich.ink.picker.code"),
    invalid: t("rich.ink.picker.invalid"),
    eyedropper: t("rich.ink.picker.eyedropper"),
    recommended: t("rich.ink.picker.recommended"),
    documentColors: t("rich.ink.picker.document"),
    recent: t("rich.ink.picker.recent"),
    theme: t("rich.ink.picker.theme"),
    none: t("rich.ink.picker.none"),
  };
}

/// Il nome del colore `color`: quello del campione, o il codice.
export function inkColorName(color: string): string {
  const swatch = inkSwatchOf(color);
  return swatch ? t(COLOR_LABELS[swatch.id]) : color.toLowerCase();
}

/// Il nome della scelta `choice` sul pulsante: la penna, l'evidenziatore o la
/// gomma.
export function penMenuName(choice: InkPenChoice): string {
  return choice.tool === "pen" ? t(KIND_LABELS[choice.pen]) : t(TOOL_LABELS[choice.tool]);
}

/// Il nome del pulsante per la scelta `choice`: «Penna: Sfera, Blu, 4 px», o
/// «Penna: Gomma, il tratto intero».
export function penMenuLabel(choice: InkPenChoice): string {
  if (choice.tool === "eraser") {
    return t(choice.eraser === "piece" ? "canvas.ink.pen.eraser_piece" : "canvas.ink.pen.eraser_stroke");
  }
  const tool = inkStrokeTool(choice);
  return t("canvas.ink.pen.label", {
    name: penMenuName(choice),
    color: inkColorName(choice.color[tool]),
    width: t("canvas.ink.width.value", { n: pixels(choice.width[tool]) }),
  });
}

export interface PenMenuOptions {
  /// La vita di chi monta il menu: i suoi ascoltatori e il rialzo aperto.
  readonly lifetime: Lifetime;
  /// La scelta di adesso.
  readonly choice: () => InkPenChoice;
  /// Una scelta nuova: `settled` è falso mentre il cursore si tira, vero
  /// quando la scelta è fatta (da ricordare).
  readonly choose: (next: InkPenChoice, settled: boolean) => void;
  /// Si può scrivere: in sola lettura il pulsante è spento e il menu chiuso.
  readonly editable: () => boolean;
  /// Il tema di adesso: i campioni che si leggono poco lo dicono nel nome.
  readonly theme: () => "light" | "dark";
}

export interface PenMenu {
  /// Il pulsante della riga: sempre lo stesso elemento.
  readonly button: HTMLButtonElement;
  /// Il rialzo è aperto.
  readonly isOpen: boolean;
  /// Ridice la scelta sul pulsante e nel rialzo aperto, nella lingua di
  /// adesso; in sola lettura chiude il rialzo.
  sync(): void;
  /// Apre il rialzo, se si può scrivere e non è già aperto: lo stesso del
  /// clic sul pulsante (il comando `canvas.pen_menu` della riga delle opzioni).
  open(): void;
  /// Chiude il rialzo, se è aperto.
  close(): void;
}

/// Le parti del rialzo aperto che cambiano con la scelta.
interface OpenMenu {
  readonly handle: PopoverHandle;
  readonly root: HTMLElement;
  readonly texts: ReadonlyArray<readonly [Element, Key]>;
  readonly kindSection: HTMLElement;
  readonly colorSection: HTMLElement;
  readonly widthSection: HTMLElement;
  readonly kindItems: ReadonlyArray<{ readonly item: HTMLButtonElement; readonly path: SVGPathElement; readonly name: HTMLElement }>;
  readonly swatches: readonly HTMLButtonElement[];
  readonly more: HTMLButtonElement;
  readonly slider: HTMLInputElement;
  readonly output: HTMLOutputElement;
  readonly widthPath: SVGPathElement;
  /// Il selettore di «Altro colore…», se è aperto.
  picker: PopoverHandle | null;
}

/// Il menu della penna: il pulsante si mette nella riga da chi lo monta.
export function createPenMenu(options: PenMenuOptions): PenMenu {
  const { lifetime } = options;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "canvas-ink-pen";
  button.dataset.canvasAction = "ink-pen";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  const chipSvg = document.createElementNS(SVG_NS, "svg");
  chipSvg.setAttribute("class", "canvas-ink-pen-chip");
  chipSvg.setAttribute("viewBox", "0 0 12 12");
  chipSvg.setAttribute("aria-hidden", "true");
  const chip = document.createElementNS(SVG_NS, "circle");
  chip.setAttribute("cx", "6");
  chip.setAttribute("cy", "6");
  chip.setAttribute("r", "5");
  chipSvg.append(chip);
  const name = document.createElement("span");
  name.className = "canvas-ink-pen-name";
  button.append(chipSvg, name);

  let menu: OpenMenu | null = null;

  const setAttr = (element: Element, attr: string, value: string | null): void => {
    if (value === null) element.removeAttribute(attr);
    else if (element.getAttribute(attr) !== value) element.setAttribute(attr, value);
  };

  const paintButton = (): void => {
    const choice = options.choice();
    const shown = penMenuName(choice);
    if (name.textContent !== shown) name.textContent = shown;
    const label = penMenuLabel(choice);
    setAttr(button, "aria-label", label);
    if (button.title !== label) button.title = label;
    if (choice.tool === "eraser") {
      setAttr(chip, "fill", "none");
      setAttr(chip, "stroke-width", "1.5");
      setAttr(chip, "stroke-opacity", null);
    } else {
      setAttr(chip, "fill", choice.color[inkStrokeTool(choice)]);
      setAttr(chip, "stroke-width", "0.75");
      setAttr(chip, "stroke-opacity", "0.35");
    }
    setAttr(chip, "stroke", "currentColor");
    button.disabled = !options.editable();
    setAttr(button, "aria-expanded", String(menu !== null));
  };

  /// Segna la voce `value` del gruppo `items` e le dà il posto nel Tab.
  const check = (items: readonly HTMLElement[], value: string | null): void => {
    let any = false;
    for (const item of items) {
      const on = item.dataset.value === value;
      setAttr(item, "aria-checked", String(on));
      item.tabIndex = on ? 0 : -1;
      any ||= on;
    }
    if (!any && items[0]) items[0].tabIndex = 0;
  };

  const paintMenu = (open: OpenMenu): void => {
    const choice = options.choice();
    const tool = inkStrokeTool(choice);
    const color = choice.color[tool];
    const width = choice.width[tool];
    for (const [element, key] of open.texts) {
      const text = t(key);
      if (element.textContent !== text) element.textContent = text;
    }
    open.kindSection.hidden = choice.tool !== "pen";
    open.colorSection.hidden = choice.tool === "eraser";
    open.widthSection.hidden = choice.tool === "eraser";
    check([...open.root.querySelectorAll<HTMLElement>('[data-group="tool"] [role="radio"]')], choice.tool);
    check(open.kindItems.map((each) => each.item), choice.pen);
    const swatch = inkSwatchOf(color);
    check([...open.swatches, open.more], swatch ? swatch.color : CUSTOM);
    check([...open.root.querySelectorAll<HTMLElement>('[data-group="eraser"] [role="radio"]')], choice.eraser);
    // Le anteprime delle penne col colore della Penna, coprenti come la penna.
    for (const each of open.kindItems) {
      setAttr(each.path, "fill", choice.color.pen);
      const kind = each.item.dataset.value as InkPenKind;
      const text = t(KIND_LABELS[kind]);
      if (each.name.textContent !== text) each.name.textContent = text;
    }
    // I campioni: il nome, e quando si legge poco sul tema di adesso (A23).
    const dark = options.theme() === "dark";
    for (const item of open.swatches) {
      const found = inkSwatchOf(item.dataset.value ?? "");
      if (!found) continue;
      const plain = t(COLOR_LABELS[found.id]);
      const faint = dark ? found.id === "black" : found.light;
      const said = faint ? t(dark ? "canvas.ink.color.faint_dark" : "canvas.ink.color.faint_light", { name: plain }) : plain;
      setAttr(item, "aria-label", said);
      if (item.title !== said) item.title = said;
    }
    const moreText = swatch ? t("canvas.ink.color.more") : t("canvas.ink.color.custom", { code: color.toLowerCase() });
    if (open.more.textContent !== moreText) open.more.textContent = moreText;
    // Il cursore: l'intervallo dello strumento, il valore, il tratto vero.
    const range = INK_WIDTH_RANGES[tool];
    setAttr(open.slider, "min", String(range.min));
    setAttr(open.slider, "max", String(range.max));
    setAttr(open.slider, "step", String(range.step));
    if (open.slider.value !== String(width)) open.slider.value = String(width);
    setAttr(open.slider, "aria-valuetext", t("canvas.ink.width.spoken", { n: pixels(width) }));
    const value = t("canvas.ink.width.value", { n: pixels(width) });
    if (open.output.textContent !== value) open.output.textContent = value;
    const pen = inkPenOf(choice);
    const samples = wave(14, 242, 22, tool === "highlighter" ? 0 : 5, 50);
    setAttr(open.widthPath, "d", previewPath(samples, pen, Math.min(width, WIDTH_PREVIEW_MAX)));
    setAttr(open.widthPath, "fill", color);
    const covers = penLook(penBrush(pen, width, true), tool).opacity;
    setAttr(open.widthPath, "fill-opacity", covers < 1 ? String(covers) : null);
  };

  /// Applica una scelta del gruppo `group`.
  const choose = (group: string, value: string): void => {
    const choice = options.choice();
    const tool = inkStrokeTool(choice);
    let next: InkPenChoice | null = null;
    if (group === "tool" && (PEN_MENU_TOOLS as readonly string[]).includes(value)) next = { ...choice, tool: value as InkMenuTool };
    if (group === "kind" && (PEN_MENU_KINDS as readonly string[]).includes(value)) next = { ...choice, pen: value as InkPenKind };
    if (group === "color" && HEX6.test(value)) next = { ...choice, color: { ...choice.color, [tool]: value.toLowerCase() } };
    if (group === "eraser" && (ERASER_MODES as readonly string[]).includes(value)) next = { ...choice, eraser: value as InkEraserMode };
    if (next) options.choose(next, true);
  };

  const chooseWidth = (raw: string, settled: boolean): void => {
    const choice = options.choice();
    const tool = inkStrokeTool(choice);
    const width = inkWidthOf(tool, Number(raw));
    if (width === null) return;
    if (width === choice.width[tool] && !settled) return;
    options.choose({ ...choice, width: { ...choice.width, [tool]: width } }, settled);
  };

  /// «Altro colore…»: il selettore del kit, sopra il menu.
  const openPicker = (open: OpenMenu): void => {
    if (open.picker && !open.picker.closed) return;
    const own = openLifetime();
    const choice = options.choice();
    const current = choice.color[inkStrokeTool(choice)];
    const picker = createColorPicker({
      value: current,
      text: pickerText(),
      recommended: INK_PALETTE.map((swatch) => ({ color: swatch.color, name: t(COLOR_LABELS[swatch.id]) })),
      onChange: (color) => choose("color", color),
      lifetime: own,
    });
    // «Altro colore…» è un radio: `aria-expanded` non gli è permesso, e il
    // kit lo mette a ogni bottone che apre un rialzo. Si toglie all'apertura
    // e alla chiusura; `aria-haspopup` e `aria-controls` restano.
    open.picker = openPopover({
      anchor: open.more,
      content: picker.element,
      label: t("canvas.ink.color.more"),
      className: "kit-color-popover",
      placement: "right",
      lifetime: own,
      autoFocus: false,
      onClose: () => {
        open.more.removeAttribute("aria-expanded");
        open.picker = null;
        own.close();
      },
    });
    open.more.removeAttribute("aria-expanded");
    picker.focus();
  };

  const radio = (className: string, group: string, value: string): HTMLButtonElement => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = className;
    item.setAttribute("role", "radio");
    item.dataset.group = group;
    item.dataset.value = value;
    return item;
  };

  const open = (): void => {
    if (menu || !options.editable()) return;
    const texts: Array<readonly [Element, Key]> = [];
    const text = <E extends Element>(element: E, key: Key): E => {
      texts.push([element, key]);
      return element;
    };
    const root = document.createElement("div");
    root.className = "canvas-pen-menu";
    const section = (): HTMLElement => {
      const element = document.createElement("div");
      element.className = "canvas-pen-section";
      root.append(element);
      return element;
    };
    const heading = (parent: HTMLElement, key: Key): string => {
      const title = text(document.createElement("h2"), key);
      title.className = "canvas-pen-heading";
      title.id = identifier("canvas-pen-heading");
      parent.append(title);
      return title.id;
    };
    const group = (parent: HTMLElement, className: string, labelledBy: string, name: string): HTMLElement => {
      const element = document.createElement("div");
      element.className = className;
      element.setAttribute("role", "radiogroup");
      element.setAttribute("aria-labelledby", labelledBy);
      element.dataset.group = name;
      parent.append(element);
      return element;
    };

    // Strumento.
    const toolSection = section();
    const tools = group(toolSection, "segmented", heading(toolSection, "canvas.ink.tool"), "tool");
    for (const tool of PEN_MENU_TOOLS) tools.append(text(radio("segmented-option", "tool", tool), TOOL_LABELS[tool]));

    // Tipo di penna.
    const kindSection = section();
    const kinds = group(kindSection, "canvas-pen-list", heading(kindSection, "canvas.ink.kind"), "kind");
    const kindItems = PEN_MENU_KINDS.map((kind) => {
      const item = radio("canvas-pen-item", "kind", kind);
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "canvas-pen-preview");
      svg.setAttribute("viewBox", "0 0 60 28");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", previewPath(KIND_SAMPLE, kind, KIND_SAMPLE_SIZE));
      const covers = penLook(penBrush(kind, KIND_SAMPLE_SIZE, true), "pen").opacity;
      if (covers < 1) path.setAttribute("fill-opacity", String(covers));
      svg.append(path);
      const label = document.createElement("span");
      item.append(svg, label);
      kinds.append(item);
      return { item, path, name: label };
    });

    // Colore.
    const colorSection = section();
    const colors = group(colorSection, "canvas-pen-swatches", heading(colorSection, "canvas.ink.color"), "color");
    const swatches = INK_PALETTE.map((swatch) => {
      const item = radio("canvas-pen-swatch", "color", swatch.color);
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
      colors.append(item);
      return item;
    });
    const more = radio("canvas-pen-more", "color", CUSTOM);
    more.setAttribute("aria-haspopup", "dialog");
    colors.append(more);

    // Spessore.
    const widthSection = section();
    const head = document.createElement("div");
    head.className = "canvas-pen-width-head";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "canvas-pen-width";
    slider.id = identifier("canvas-pen-width");
    const label = text(document.createElement("label"), "canvas.ink.width");
    label.className = "canvas-pen-heading";
    label.htmlFor = slider.id;
    const output = document.createElement("output");
    output.className = "canvas-pen-width-value";
    output.setAttribute("for", slider.id);
    head.append(label, output);
    const previewSvg = document.createElementNS(SVG_NS, "svg");
    previewSvg.setAttribute("class", "canvas-pen-width-preview");
    previewSvg.setAttribute("viewBox", "0 0 256 44");
    previewSvg.setAttribute("preserveAspectRatio", "none");
    previewSvg.setAttribute("aria-hidden", "true");
    const widthPath = document.createElementNS(SVG_NS, "path");
    previewSvg.append(widthPath);
    widthSection.append(head, slider, previewSvg);

    // La gomma cancella.
    const eraserSection = section();
    const erasers = group(eraserSection, "segmented", heading(eraserSection, "canvas.ink.eraser"), "eraser");
    for (const mode of ERASER_MODES) erasers.append(text(radio("segmented-option", "eraser", mode), ERASER_LABELS[mode]));
    const eraserNote = text(document.createElement("p"), "canvas.ink.eraser.note");
    eraserNote.className = "canvas-pen-note";
    eraserSection.append(eraserNote);

    const note = text(document.createElement("p"), "canvas.ink.pen.note");
    note.className = "canvas-pen-note";
    root.append(note);

    // Il fuoco al pulsante prima di aprire: Esc ce lo rende anche dopo un clic
    // che non l'aveva dato (Safari).
    if (document.activeElement !== button) button.focus();
    const own = openLifetime();
    const handle = openPopover({
      anchor: button,
      content: root,
      label: t("canvas.ink.pen"),
      className: "canvas-pen-popover",
      lifetime,
      autoFocus: false,
      onClose: () => {
        own.close();
        menu = null;
        paintButton();
      },
    });
    if (handle.closed) return;
    const opened: OpenMenu = {
      handle,
      root,
      texts,
      kindSection,
      colorSection,
      widthSection,
      kindItems,
      swatches,
      more,
      slider,
      output,
      widthPath,
      picker: null,
    };
    menu = opened;

    own.listen(root, "click", (event) => {
      const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="radio"]') : null;
      if (!item || !root.contains(item)) return;
      const value = item.dataset.value ?? "";
      if (value === CUSTOM) openPicker(opened);
      else choose(item.dataset.group ?? "", value);
      if (menu === opened && !opened.picker) item.focus();
    });
    own.listen(root, "keydown", (event) => {
      const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="radio"]') : null;
      if (!item || !root.contains(item)) return;
      const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
      if (!step) return;
      event.preventDefault();
      const all = [...root.querySelectorAll<HTMLElement>(`[role="radio"][data-group="${item.dataset.group ?? ""}"]`)];
      const next = all[(all.indexOf(item) + step + all.length) % all.length];
      if (!next) return;
      // «Altro colore…» si raggiunge con le frecce e si apre con Invio o Spazio.
      if (next.dataset.value !== CUSTOM) choose(next.dataset.group ?? "", next.dataset.value ?? "");
      next.tabIndex = 0;
      for (const other of all) if (other !== next && other.getAttribute("aria-checked") !== "true") other.tabIndex = -1;
      next.focus();
    });
    own.listen(slider, "input", () => chooseWidth(slider.value, false));
    own.listen(slider, "change", () => chooseWidth(slider.value, true));

    paintMenu(opened);
    paintButton();
    const chosen = root.querySelector<HTMLElement>('[data-group="tool"][aria-checked="true"]');
    (chosen ?? root.querySelector<HTMLElement>('[role="radio"]'))?.focus();
  };

  const close = (): void => {
    menu?.handle.close();
  };

  lifetime.listen(button, "click", (event) => {
    event.preventDefault();
    if (menu) close();
    else open();
  });

  paintButton();

  return {
    button,
    get isOpen() {
      return menu !== null;
    },
    sync() {
      if (menu && !options.editable()) close();
      paintButton();
      if (menu) paintMenu(menu);
    },
    open,
    close,
  };
}
