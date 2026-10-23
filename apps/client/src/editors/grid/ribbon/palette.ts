// I colori della barra multifunzione: la tavolozza del tema con le sue
// sfumature, come la mostra Excel, i colori standard, e l'aspetto degli stili
// di tabella e di cella da mostrare nelle gallerie.
//
// Il provider scrive un colore del tema come `{theme, tint}`; qui lo si
// risolve soltanto per disegnarlo, con la regola di GridCraft
// (`gridcraft_model::apply_tint`, ECMA-376): la luminanza HSL va verso il
// bianco per una sfumatura positiva, verso il nero per una negativa.

/// Un colore come lo prende il provider: esadecimale, o del tema.
export type RibbonColor = string | { readonly theme: number; readonly tint: number };

/// Le dieci colonne della tavolozza del tema, nell'ordine di Excel: sfondo e
/// testo 1, sfondo e testo 2, i sei colori principali. Sono anche gli indici
/// del tema della cartella (`GridBook.theme_colors`).
export const THEME_COLUMNS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/// I colori standard di Excel, sotto la tavolozza del tema.
export const STANDARD_COLORS: readonly string[] = [
  "#C00000",
  "#FF0000",
  "#FFC000",
  "#FFFF00",
  "#92D050",
  "#00B050",
  "#00B0F0",
  "#0070C0",
  "#002060",
  "#7030A0",
];

/// Il tema di Office, quando la cartella non ne dice uno.
export const OFFICE_THEME: readonly string[] = [
  "#FFFFFF",
  "#000000",
  "#E8E8E8",
  "#0E2841",
  "#156082",
  "#E97132",
  "#196B24",
  "#0F9ED5",
  "#A02B93",
  "#4EA72E",
  "#467886",
  "#96607D",
];

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === red ? (green - blue) / d + (green < blue ? 6 : 0) : max === green ? (blue - red) / d + 2 : (red - green) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const channel = (t: number) => Math.round(hue(t) * 255);
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/// `base` con la sfumatura `tint` (da -1 a 1), come la scrive il file.
export function tinted(base: string, tint: number): string {
  const rgb = parseHex(base);
  if (!rgb) return base;
  if (tint === 0) return hex(rgb);
  const [h, s, l] = toHsl(rgb);
  const next = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return hex(fromHsl(h, s, Math.min(1, Math.max(0, next))));
}

/// La luminanza HSL di un colore, da 0 a 1.
export function luminance(color: string): number {
  const rgb = parseHex(color);
  return rgb ? toHsl(rgb)[2] : 0;
}

/// Le cinque sfumature sotto un colore del tema, come le sceglie Excel dalla
/// sua luminanza: il nero e il bianco hanno le loro, un colore scuro va solo
/// verso il chiaro, uno chiarissimo solo verso lo scuro.
export function tintsFor(base: string): readonly number[] {
  const l = luminance(base);
  if (l < 0.01) return [0.5, 0.35, 0.25, 0.15, 0.05];
  if (l > 0.99) return [-0.05, -0.15, -0.25, -0.35, -0.5];
  if (l < 0.2) return [0.9, 0.75, 0.5, 0.25, 0.1];
  if (l > 0.8) return [-0.1, -0.25, -0.5, -0.75, -0.9];
  return [0.8, 0.6, 0.4, -0.25, -0.5];
}

/// I colori del tema della cartella, completati con quelli di Office.
export function themeColors(theme: readonly string[] | undefined): readonly string[] {
  return OFFICE_THEME.map((fallback, index) => {
    const color = theme?.[index];
    return color && parseHex(color) ? hex(parseHex(color)!) : fallback;
  });
}

/// Un colore del provider come esadecimale da disegnare.
export function resolve(color: RibbonColor, theme: readonly string[]): string {
  if (typeof color === "string") return color;
  return tinted(theme[color.theme] ?? "#000000", color.tint);
}

/// La percentuale di una sfumatura, per dirla: «più chiaro 40%».
export function tintPercent(tint: number): number {
  return Math.round(Math.abs(tint) * 100);
}

// ── Gli stili di tabella ────────────────────────────────────────────────

/// Le famiglie degli stili di tabella, quanti stili ciascuna.
export const TABLE_FAMILIES: readonly { readonly family: "Light" | "Medium" | "Dark"; readonly count: number }[] = [
  { family: "Light", count: 21 },
  { family: "Medium", count: 28 },
  { family: "Dark", count: 11 },
];

/// L'aspetto di uno stile di tabella, già nei colori del tema.
export interface TableLook {
  readonly headerFill: string | null;
  readonly headerText: string;
  readonly bandFill: string | null;
  readonly bodyFill: string | null;
  readonly line: string | null;
}

/// Come GridCraft disegna lo stile `name` (`gridcraft_engine::tables::look`):
/// lo stesso calcolo, perché l'anteprima mostri ciò che la cartella mostrerà.
export function tableLook(name: string, theme: readonly string[]): TableLook {
  const match = /^(?:TableStyle)?(Light|Medium|Dark)(\d+)$/.exec(name);
  const family = match?.[1] ?? "Medium";
  const n = Math.max(1, Number(match?.[2] ?? 2));
  const k = (n - 1) % 7;
  const accent = k === 0 ? null : 3 + k;
  const color = (index: number, tint: number) => tinted(theme[index] ?? "#000000", tint / 1000);
  const base = (tint: number) => (accent !== null ? color(accent, tint) : color(1, tint));
  const neutralLight = (tint: number) =>
    accent !== null ? color(accent, tint) : color(0, -Math.trunc(Math.min(1000, Math.max(0, 1000 - tint)) / 6));
  const auto = theme[1] ?? "#000000";
  if (family === "Light") {
    const group = Math.trunc((n - 1) / 7);
    return { headerFill: null, headerText: group === 0 ? base(-250) : auto, bandFill: neutralLight(800), bodyFill: null, line: base(0) };
  }
  if (family === "Dark") {
    return { headerFill: color(1, 0), headerText: color(0, 0), bandFill: base(-250), bodyFill: base(0), line: null };
  }
  return {
    headerFill: base(0),
    headerText: color(0, 0),
    bandFill: neutralLight(800),
    bodyFill: null,
    line: Math.trunc((n - 1) / 7) === 0 ? null : base(400),
  };
}

// ── Gli stili di cella ──────────────────────────────────────────────────

/// L'aspetto di uno stile di cella da mostrare: le proprietà CSS del campione.
export type CellLook = Readonly<Record<string, string>>;

/// I gruppi della galleria degli stili di cella, con i nomi che il provider
/// conosce (`gridcraft_engine::cmd::format::CELL_STYLE_NAMES`).
export const CELL_STYLE_GROUPS: readonly { readonly group: string; readonly names: readonly string[] }[] = [
  { group: "good", names: ["Normal", "Bad", "Good", "Neutral"] },
  {
    group: "data",
    names: ["Calculation", "Check Cell", "Explanatory Text", "Input", "Linked Cell", "Note", "Output", "Warning Text"],
  },
  { group: "titles", names: ["Heading 1", "Heading 2", "Heading 3", "Heading 4", "Title", "Total"] },
  {
    group: "themed",
    names: [20, 40, 60, 0].flatMap((percent) =>
      [1, 2, 3, 4, 5, 6].map((accent) => (percent ? `${percent}% - Accent${accent}` : `Accent${accent}`)),
    ),
  },
  { group: "number", names: ["Comma", "Comma [0]", "Currency", "Currency [0]", "Percent"] },
];

/// Come GridCraft disegna lo stile di cella `name` (`builtin_cell_style`).
export function cellLook(name: string, theme: readonly string[]): CellLook {
  const t = (index: number, tint = 0) => tinted(theme[index] ?? "#000000", tint / 1000);
  const box = (color: string, style = "solid") => ({ border: `1px ${style} ${color}` });
  switch (name) {
    case "Good":
      return { background: "#C6EFCE", color: "#006100" };
    case "Bad":
      return { background: "#FFC7CE", color: "#9C0006" };
    case "Neutral":
      return { background: "#FFEB9C", color: "#9C5700" };
    case "Calculation":
      return { background: "#F2F2F2", color: "#FA7D00", "font-weight": "700", ...box("#7F7F7F") };
    case "Check Cell":
      return { background: "#A5A5A5", color: "#FFFFFF", "font-weight": "700", border: "3px double #3F3F3F" };
    case "Explanatory Text":
      return { color: "#7F7F7F", "font-style": "italic" };
    case "Input":
      return { background: "#FFCC99", color: "#3F3F76", ...box("#7F7F7F") };
    case "Linked Cell":
      return { color: "#FA7D00", "border-bottom": "3px double #FF8001" };
    case "Note":
      return { background: "#FFFFCC", color: t(1), ...box("#B2B2B2") };
    case "Output":
      return { background: "#F2F2F2", color: "#3F3F3F", "font-weight": "700", ...box("#3F3F3F") };
    case "Warning Text":
      return { color: "#FF0000" };
    case "Title":
      return { color: t(3), "font-size": "15px" };
    case "Heading 1":
      return { color: t(3), "font-weight": "700", "font-size": "13px", "border-bottom": `3px solid ${t(4)}` };
    case "Heading 2":
      return { color: t(3), "font-weight": "700", "font-size": "12px", "border-bottom": `3px solid ${t(4, 500)}` };
    case "Heading 3":
      return { color: t(3), "font-weight": "700", "border-bottom": `2px solid ${t(4, 400)}` };
    case "Heading 4":
      return { color: t(3), "font-weight": "700" };
    case "Total":
      return { "font-weight": "700", "border-top": `1px solid ${t(4)}`, "border-bottom": `3px double ${t(4)}` };
  }
  const themed = /^(?:(\d+)% - )?Accent([1-6])$/.exec(name);
  if (themed) {
    const percent = themed[1] ? Number(themed[1]) : null;
    const accent = 3 + Number(themed[2]);
    if (percent === null) return { background: t(accent), color: t(0) };
    return { background: t(accent, Math.min(1000, Math.max(0, 1000 - percent * 10))), color: percent >= 60 ? t(0) : t(1) };
  }
  return { color: t(1) };
}
