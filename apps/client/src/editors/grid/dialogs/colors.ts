// La tavolozza dei colori delle finestre: un pulsante con il colore scelto
// che apre, sotto di sé, i colori del tema con le sfumature, i colori
// standard e «Automatico» (o «Nessun colore» per uno sfondo).
//
// Il colore è quello del modello di GridCraft (`"Auto"`, `{"Rgb": n}`,
// `{"Theme": [indice, sfumatura in millesimi]}`), così che la patch dello
// stile lo scriva com'è. La tavolozza è la stessa della barra
// (`ribbon/palette.ts`); dentro la finestra si apre in linea, non in un
// popover, perché il fuoco resta nella finestra.
import { identifier } from "../../../ui/a11y";
import type { Lifetime } from "../../../ui/lifetime";
import { STANDARD_COLORS, THEME_COLUMNS, tinted, tintPercent, tintsFor } from "../ribbon/palette";
import { t as ribbonT, type RibbonKey } from "../ribbon/strings";
import type { FieldSpec, Values } from "./fields";
import { t } from "./strings";

/// Un colore del modello.
export type ModelColor = "Auto" | { readonly Rgb: number } | { readonly Theme: readonly [number, number] };

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

/// Un colore del modello letto da JSON; `"Auto"` per ciò che non si capisce.
export function modelColor(value: unknown): ModelColor {
  if (value && typeof value === "object") {
    const rgb = (value as { Rgb?: unknown }).Rgb;
    if (typeof rgb === "number") return { Rgb: rgb };
    const theme = (value as { Theme?: unknown }).Theme;
    if (Array.isArray(theme) && typeof theme[0] === "number" && typeof theme[1] === "number") return { Theme: [theme[0], theme[1]] };
  }
  return "Auto";
}

/// Il colore da disegnare, in esadecimale; `null` per Automatico.
export function colorHex(color: ModelColor, theme: readonly string[]): string | null {
  if (color === "Auto") return null;
  if ("Rgb" in color) return `#${color.Rgb.toString(16).padStart(6, "0").toUpperCase()}`;
  return tinted(theme[color.Theme[0]] ?? "#000000", color.Theme[1] / 1000);
}

export function sameColor(a: ModelColor, b: ModelColor): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/// Il nome di un colore, per dirlo.
export function colorName(color: ModelColor, auto: string): string {
  if (color === "Auto") return auto;
  if ("Rgb" in color) {
    const hex = `#${color.Rgb.toString(16).padStart(6, "0").toUpperCase()}`;
    const standard = STANDARD_COLORS.indexOf(hex);
    return standard >= 0 ? ribbonT(STANDARD_NAMES[standard]!) : hex;
  }
  const [index, tint] = color.Theme;
  const name = ribbonT(`ribbon.color.theme.${index}` as RibbonKey);
  if (tint === 0) return name;
  return ribbonT(tint > 0 ? "ribbon.color.lighter" : "ribbon.color.darker", { name, percent: tintPercent(tint / 1000) });
}

function hexColor(hex: string): ModelColor {
  return { Rgb: Number.parseInt(hex.slice(1), 16) };
}

/// Un campo colore: `key` tiene un `ModelColor`. `auto` è l'etichetta della
/// voce senza colore (Automatico per il testo, Nessun colore per lo sfondo).
export function colorField(key: string, label: string, theme: readonly string[], auto: string = t("grid.dialog.format.auto")): FieldSpec {
  return {
    kind: "custom",
    key,
    label,
    render: (values, onChange, life) => palette(key, label, auto, theme, values, onChange, life),
  };
}

function palette(
  key: string,
  label: string,
  auto: string,
  theme: readonly string[],
  values: Values,
  onChange: (key: string) => void,
  life: Lifetime,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "grid-dialog-field grid-dialog-color";
  const name = document.createElement("span");
  name.className = "grid-dialog-label";
  name.id = identifier("grid-dialog-label");
  name.textContent = label;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "grid-dialog-color-button";
  button.dataset.key = key;
  button.setAttribute("aria-expanded", "false");
  const chip = document.createElement("span");
  chip.className = "grid-dialog-color-chip";
  chip.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  button.append(chip, text);
  const grid = document.createElement("div");
  grid.className = "grid-dialog-palette";
  grid.id = identifier("grid-dialog-palette");
  grid.hidden = true;
  button.setAttribute("aria-controls", grid.id);

  const show = (): void => {
    const color = modelColor(values[key]);
    const hex = colorHex(color, theme);
    chip.style.background = hex ?? "transparent";
    chip.classList.toggle("grid-dialog-color-chip--auto", hex === null);
    text.textContent = colorName(color, auto);
    button.setAttribute("aria-label", `${label.replace(/:$/, "")}: ${text.textContent}`);
  };

  const cells: HTMLButtonElement[] = [];
  const swatch = (color: ModelColor, title: string, hex: string | null): HTMLButtonElement => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = hex === null ? "grid-dialog-palette-auto" : "grid-dialog-swatch";
    cell.tabIndex = -1;
    cell.setAttribute("aria-label", title);
    cell.title = title;
    if (hex !== null) cell.style.background = hex;
    else cell.textContent = title;
    cell.setAttribute("aria-pressed", String(sameColor(modelColor(values[key]), color)));
    life.listen(cell, "click", () => {
      values[key] = color;
      for (const other of cells) other.setAttribute("aria-pressed", String(other === cell));
      show();
      close(true);
      onChange(key);
    });
    cells.push(cell);
    return cell;
  };

  const none = swatch("Auto", auto, null);
  const themeGrid = document.createElement("div");
  themeGrid.className = "grid-dialog-palette-grid";
  for (let line = 0; line < 6; line += 1) {
    for (const index of THEME_COLUMNS) {
      const base = theme[index] ?? "#000000";
      const tint = line === 0 ? 0 : tintsFor(base)[line - 1]!;
      const color: ModelColor = { Theme: [index, Math.round(tint * 1000)] };
      themeGrid.append(swatch(color, colorName(color, auto), tinted(base, tint)));
    }
  }
  const standardGrid = document.createElement("div");
  standardGrid.className = "grid-dialog-palette-grid";
  standardGrid.append(...STANDARD_COLORS.map((hex) => swatch(hexColor(hex), colorName(hexColor(hex), auto), hex)));
  const title = (key: "grid.dialog.color.theme" | "grid.dialog.color.standard"): HTMLElement => {
    const element = document.createElement("p");
    element.className = "grid-dialog-palette-title";
    element.textContent = t(key);
    return element;
  };
  grid.append(none, title("grid.dialog.color.theme"), themeGrid, title("grid.dialog.color.standard"), standardGrid);

  const open = (): void => {
    grid.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const chosen = cells.find((cell) => cell.getAttribute("aria-pressed") === "true") ?? cells[0]!;
    for (const cell of cells) cell.tabIndex = cell === chosen ? 0 : -1;
    chosen.focus();
  };
  const close = (refocus: boolean): void => {
    grid.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  };
  life.listen(button, "click", () => (grid.hidden ? open() : close(false)));
  // Le frecce si muovono fra i colori: dieci per riga, come in Excel. Esc
  // è della finestra (la trappola del fuoco lo prende per prima) e la chiude.
  life.listen(grid, "keydown", (event) => {
    const at = cells.indexOf(event.target as HTMLButtonElement);
    if (at < 0) return;
    // La prima voce (Automatico) sta da sola sulla sua riga.
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? (at === 0 ? 1 : 10) : event.key === "ArrowUp" ? (at <= 10 ? -at : -10) : 0;
    if (!step) return;
    event.preventDefault();
    const next = cells[Math.min(cells.length - 1, Math.max(0, at + step))]!;
    for (const cell of cells) cell.tabIndex = cell === next ? 0 : -1;
    next.focus();
  });
  show();
  row.append(name, button, grid);
  return row;
}
