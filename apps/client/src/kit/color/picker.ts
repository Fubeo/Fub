// Il selettore del colore del kit: in cima i colori consigliati (tondi, col
// nome), poi quelli del documento, i recenti e, se c'è, il tema; sotto il
// quadrato saturazione × valore, la striscia della tinta, quella dell'alfa, il
// codice in uno dei quattro modi e il contagocce.
//
// - **Il nome prima della tinta.** Ogni campione dice il suo nome nel
//   suggerimento e a chi ascolta, e quello scelto porta la spunta: un colore
//   non si riconosce soltanto dalla tinta (WCAG 1.4.1).
// - **Cursori veri.** Il quadrato e le strisce sono `role="slider"`, con le
//   frecce (Maiuscolo: dieci alla volta), Home e Fine; il quadrato dice i due
//   valori nel suo `aria-valuetext`.
// - **Due tempi.** Mentre si tira, `onInput` vede ogni colore; al rilascio, a
//   un campione, a Invio nel codice o a una freccia, `onChange` riceve quello
//   scelto. Chi disegna mostra il primo e scrive il secondo.
// - **Il contagocce** è quello del browser (`EyeDropper`) se c'è, altrimenti
//   quello che chi chiama offre; senza nessuno dei due non si mostra.
//
// I colori entrano ed escono come `#rrggbb` (o `#rrggbbaa`), `none` per
// nessun colore, `null` per una selezione mista. Il kit non ha testo suo: le
// parole arrivano in `text`.

import { identifier } from "../../ui/a11y";
import { icon, iconEl, registerIcon } from "../../ui/icons";
import type { Lifetime } from "../../ui/lifetime";
import { COLOR_FORMATS, formatColor, hsvToRgb, parseColor, parseHex, rgbToHsv, toHexText, type ColorFormat, type Hsva } from "./model";

/// Un colore da scegliere con un clic, col suo nome.
export interface ColorChoice {
  readonly color: string;
  readonly name: string;
}

export interface ColorPickerText {
  /// Il quadrato, e come dice i suoi due valori (in percentuale).
  readonly area: string;
  readonly areaValue: (saturation: number, value: number) => string;
  readonly hue: string;
  readonly alpha: string;
  readonly format: string;
  readonly formats: Readonly<Record<ColorFormat, string>>;
  /// Il campo del codice, e che cosa dice quando non si legge.
  readonly code: string;
  readonly invalid: string;
  readonly eyedropper: string;
  readonly recommended: string;
  readonly documentColors: string;
  readonly recent: string;
  readonly theme: string;
  readonly none: string;
}

export interface ColorPickerOptions {
  value: string | null;
  text: ColorPickerText;
  recommended?: readonly ColorChoice[];
  documentColors?: readonly ColorChoice[];
  recent?: readonly ColorChoice[];
  theme?: readonly ColorChoice[];
  /// La striscia dell'alfa. Di serie no: i file del disegno scrivono
  /// l'opacità a parte.
  alpha?: boolean;
  /// «Nessuno» fra i campioni.
  allowNone?: boolean;
  /// Il quadrato, le strisce e il codice: un colore qualunque. Di serie sì;
  /// senza, si sceglie soltanto fra i campioni.
  free?: boolean;
  /// Il contagocce di chi chiama, quando il browser non ne ha uno.
  eyedropper?: () => Promise<string | null>;
  onInput?: (color: string) => void;
  onChange: (color: string) => void;
  lifetime: Lifetime;
}

export interface ColorPicker {
  readonly element: HTMLElement;
  value(): string | null;
  /// Scrive il colore senza chiamare nessuno: è il programma.
  setValue(color: string | null): void;
  /// Il fuoco va al campione scelto, o al primo.
  focus(): void;
}

interface BrowserEyeDropper {
  open(): Promise<{ sRGBHex: string }>;
}

/// Il contagocce del browser, se c'è.
function browserEyeDropper(): (() => Promise<string | null>) | null {
  const Constructor = (globalThis as { EyeDropper?: new () => BrowserEyeDropper }).EyeDropper;
  if (typeof Constructor !== "function") return null;
  return async () => {
    try {
      return (await new Constructor().open()).sRGBHex;
    } catch {
      // Esc o un rifiuto: nessun colore.
      return null;
    }
  };
}

const NONE = "none";

/// Il contagocce, registrato una volta come le icone delle superfici.
const DROPPER_ICON = "kit-eyedropper";
function ensureDropperIcon(): void {
  if (icon(DROPPER_ICON) !== "") return;
  registerIcon(DROPPER_ICON, ["M14.5 5.5 18.5 9.5", "M16 4a2.1 2.1 0 0 1 3 3l-2 2-3-3z", "M14 8 6 16l-1 4 4-1 8-8"]);
}
const sameColor = (one: string | null, two: string | null): boolean =>
  one !== null && two !== null && one.toLowerCase() === two.toLowerCase();

export function createColorPicker(options: ColorPickerOptions): ColorPicker {
  const { text, lifetime } = options;
  let current = options.value;
  let hsv: Hsva = { h: 0, s: 0, v: 0, a: 1 };
  let format: ColorFormat = "hex";
  const swatches: HTMLButtonElement[] = [];

  const element = document.createElement("div");
  element.className = "kit-color";

  // --- I campioni -----------------------------------------------------------

  const group = (title: string, choices: readonly ColorChoice[], none: boolean): void => {
    if (choices.length === 0 && !none) return;
    const section = document.createElement("div");
    section.className = "kit-color-group";
    const heading = document.createElement("div");
    heading.className = "kit-color-group-title";
    heading.id = identifier("kit-color-group");
    heading.textContent = title;
    const row = document.createElement("div");
    row.className = "kit-color-swatches";
    row.setAttribute("role", "group");
    row.setAttribute("aria-labelledby", heading.id);
    const add = (color: string, name: string): void => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = color === NONE ? "kit-color-swatch none" : "kit-color-swatch";
      swatch.dataset.color = color;
      swatch.title = name;
      swatch.setAttribute("aria-label", name);
      swatch.setAttribute("aria-pressed", "false");
      const chip = document.createElement("span");
      chip.className = "kit-color-chip";
      if (color !== NONE) chip.style.backgroundColor = color;
      const check = document.createElement("span");
      check.className = "kit-color-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      swatch.append(chip, check);
      lifetime.listen(swatch, "click", () => choose(color));
      swatches.push(swatch);
      row.append(swatch);
    };
    if (none) add(NONE, text.none);
    for (const choice of choices) add(choice.color.toLowerCase(), choice.name);
    section.append(heading, row);
    element.append(section);
  };
  group(text.recommended, options.recommended ?? [], options.allowNone === true);
  group(text.documentColors, options.documentColors ?? [], false);
  group(text.recent, options.recent ?? [], false);
  group(text.theme, options.theme ?? [], false);

  // --- Il quadrato e le strisce ---------------------------------------------

  const slider = (className: string, label: string): { readonly track: HTMLElement; readonly thumb: HTMLElement } => {
    const track = document.createElement("div");
    track.className = className;
    track.tabIndex = 0;
    track.setAttribute("role", "slider");
    track.setAttribute("aria-label", label);
    const thumb = document.createElement("span");
    thumb.className = "kit-color-thumb";
    thumb.setAttribute("aria-hidden", "true");
    track.append(thumb);
    return { track, thumb };
  };
  const area = slider("kit-color-area", text.area);
  area.track.setAttribute("aria-valuemin", "0");
  area.track.setAttribute("aria-valuemax", "100");
  const hue = slider("kit-color-hue", text.hue);
  hue.track.setAttribute("aria-valuemin", "0");
  hue.track.setAttribute("aria-valuemax", "360");
  hue.track.setAttribute("aria-orientation", "horizontal");
  const alpha = options.alpha ? slider("kit-color-alpha", text.alpha) : null;
  alpha?.track.setAttribute("aria-valuemin", "0");
  alpha?.track.setAttribute("aria-valuemax", "100");
  const free = options.free !== false;
  if (free) element.append(area.track, hue.track);
  if (free && alpha) element.append(alpha.track);

  // --- Il codice e il contagocce --------------------------------------------

  const row = document.createElement("div");
  row.className = "kit-color-code";
  const select = document.createElement("select");
  select.className = "kit-color-format";
  select.id = identifier("kit-color-format");
  for (const each of COLOR_FORMATS) {
    const option = document.createElement("option");
    option.value = each;
    option.textContent = text.formats[each];
    select.append(option);
  }
  const selectLabel = document.createElement("label");
  selectLabel.className = "sr-only";
  selectLabel.htmlFor = select.id;
  selectLabel.textContent = text.format;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "kit-color-input";
  input.id = identifier("kit-color-code");
  input.autocomplete = "off";
  input.spellcheck = false;
  const inputLabel = document.createElement("label");
  inputLabel.className = "sr-only";
  inputLabel.htmlFor = input.id;
  inputLabel.textContent = text.code;
  row.append(selectLabel, select, inputLabel, input);
  const dropper = browserEyeDropper() ?? options.eyedropper ?? null;
  if (dropper) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kit-color-dropper";
    button.title = text.eyedropper;
    button.setAttribute("aria-label", text.eyedropper);
    ensureDropperIcon();
    const figure = iconEl(DROPPER_ICON);
    if (figure) button.append(figure);
    lifetime.listen(button, "click", () => {
      void dropper().then((picked) => {
        if (picked && parseColor(picked)) choose(toHexText({ ...parseColor(picked)!, a: hsv.a }));
      });
    });
    row.append(button);
  }
  if (free) element.append(row);

  // --- Lo stato --------------------------------------------------------------

  const colorText = (): string => toHexText(hsvToRgb(hsv));

  const paint = (): void => {
    const filled = current !== null && current !== NONE;
    const base = hsvToRgb({ h: hsv.h, s: 1, v: 1, a: 1 });
    area.track.style.backgroundColor = toHexText(base);
    area.thumb.style.left = `${hsv.s * 100}%`;
    area.thumb.style.top = `${(1 - hsv.v) * 100}%`;
    area.track.setAttribute("aria-valuenow", String(Math.round(hsv.s * 100)));
    area.track.setAttribute("aria-valuetext", text.areaValue(Math.round(hsv.s * 100), Math.round(hsv.v * 100)));
    hue.thumb.style.left = `${(hsv.h / 360) * 100}%`;
    hue.track.setAttribute("aria-valuenow", String(Math.round(hsv.h)));
    if (alpha) {
      alpha.track.style.setProperty("--kit-color-solid", toHexText({ ...hsvToRgb(hsv), a: 1 }));
      alpha.thumb.style.left = `${hsv.a * 100}%`;
      alpha.track.setAttribute("aria-valuenow", String(Math.round(hsv.a * 100)));
      alpha.track.setAttribute("aria-valuetext", `${Math.round(hsv.a * 100)}%`);
    }
    if (document.activeElement !== input || !filled) {
      input.value = filled ? formatColor(hsvToRgb(hsv), format) : "";
      input.removeAttribute("aria-invalid");
    }
    input.placeholder = current === null ? "—" : current === NONE ? text.none : "";
    for (const swatch of swatches) {
      const on = sameColor(swatch.dataset.color ?? null, current);
      swatch.setAttribute("aria-pressed", String(on));
      swatch.classList.toggle("selected", on);
    }
  };

  const load = (color: string | null): void => {
    current = color === null ? null : color.toLowerCase();
    const parsed = current && current !== NONE ? parseHex(current) : null;
    if (parsed) hsv = rgbToHsv(parsed, hsv.h);
    paint();
  };

  /// Un colore scelto, che parte.
  const choose = (color: string): void => {
    load(color);
    options.onChange(current!);
  };

  /// Un colore mentre si tira: si mostra, e parte al rilascio.
  const preview = (next: Hsva): void => {
    hsv = next;
    current = colorText();
    paint();
    options.onInput?.(current);
  };

  // --- I gesti ---------------------------------------------------------------

  const drag = (track: HTMLElement, at: (x: number, y: number) => Hsva): void => {
    let pointer: number | null = null;
    const move = (event: PointerEvent): void => {
      const box = track.getBoundingClientRect();
      const x = box.width > 0 ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0;
      const y = box.height > 0 ? Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) : 0;
      preview(at(x, y));
    };
    lifetime.listen(track, "pointerdown", (event) => {
      if (event.button > 0) return;
      event.preventDefault();
      pointer = event.pointerId;
      track.setPointerCapture?.(event.pointerId);
      track.focus();
      move(event);
    });
    lifetime.listen(track, "pointermove", (event) => {
      if (pointer === event.pointerId) move(event);
    });
    const end = (event: PointerEvent): void => {
      if (pointer !== event.pointerId) return;
      pointer = null;
      track.releasePointerCapture?.(event.pointerId);
      options.onChange(colorText());
    };
    lifetime.listen(track, "pointerup", end);
    lifetime.listen(track, "pointercancel", end);
  };
  drag(area.track, (x, y) => ({ ...hsv, s: x, v: 1 - y }));
  drag(hue.track, (x) => ({ ...hsv, h: x * 360 }));
  if (alpha) drag(alpha.track, (x) => ({ ...hsv, a: Math.round(x * 100) / 100 }));

  /// Le frecce di un cursore: `step` sposta di una unità (dieci con
  /// Maiuscolo), `edge` va al minimo o al massimo.
  const keys = (track: HTMLElement, step: (dx: number, dy: number) => Hsva, edge: (end: 0 | 1) => Hsva): void => {
    lifetime.listen(track, "keydown", (event) => {
      const times = event.shiftKey ? 10 : 1;
      let next: Hsva | null = null;
      if (event.key === "ArrowRight") next = step(times, 0);
      else if (event.key === "ArrowLeft") next = step(-times, 0);
      else if (event.key === "ArrowUp") next = step(0, times);
      else if (event.key === "ArrowDown") next = step(0, -times);
      else if (event.key === "Home") next = edge(0);
      else if (event.key === "End") next = edge(1);
      if (!next) return;
      event.preventDefault();
      preview(next);
      options.onChange(colorText());
    });
  };
  const unit = (value: number, delta: number, scale: number): number => Math.min(1, Math.max(0, value + delta / scale));
  keys(area.track, (dx, dy) => ({ ...hsv, s: unit(hsv.s, dx, 100), v: unit(hsv.v, dy, 100) }), (end) => ({ ...hsv, s: end, v: end }));
  keys(hue.track, (dx, dy) => ({ ...hsv, h: Math.min(360, Math.max(0, hsv.h + dx + dy)) }), (end) => ({ ...hsv, h: end * 360 }));
  if (alpha) keys(alpha.track, (dx, dy) => ({ ...hsv, a: Math.round(unit(hsv.a, dx + dy, 100) * 100) / 100 }), (end) => ({ ...hsv, a: end }));

  lifetime.listen(select, "change", () => {
    format = select.value as ColorFormat;
    paint();
  });
  const commitInput = (): void => {
    const parsed = parseColor(input.value);
    if (!parsed) {
      input.setAttribute("aria-invalid", "true");
      input.title = text.invalid;
      return;
    }
    input.removeAttribute("aria-invalid");
    input.removeAttribute("title");
    const color = toHexText(options.alpha ? parsed : { ...parsed, a: 1 });
    if (sameColor(color, current)) {
      paint();
      return;
    }
    choose(color);
  };
  lifetime.listen(input, "keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    commitInput();
  });
  lifetime.listen(input, "change", () => commitInput());

  load(current);

  return {
    element,
    value: () => current,
    setValue: load,
    focus() {
      const target = swatches.find((swatch) => swatch.classList.contains("selected")) ?? swatches[0] ?? area.track;
      target.focus();
    },
  };
}
