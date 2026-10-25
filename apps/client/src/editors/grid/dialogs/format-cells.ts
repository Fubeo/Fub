// Formato celle: Numero, Allineamento, Carattere, Bordo, Riempimento e
// Protezione, come in Excel (Ctrl+1).
//
// La finestra parte dallo stile della cella attiva (`cell.get`) e all'OK dà
// soltanto ciò che si è cambiato: `home.formatCells` fonde la patch nello
// stile di ogni cella della selezione, così una selezione con caratteri
// diversi tiene i suoi se si cambia soltanto il colore di sfondo.
//
// L'esempio della scheda Numero lo calcola il provider (`TEXT` sulla cella
// attiva), perché il formato si legga come lo leggerà la griglia.
import { FONT_SIZES, FONTS, numberFormatOf } from "../ribbon/tabs";
import { themeColors } from "../ribbon/palette";
import type { DialogBuilder, DialogContext } from "./host";
import { formDialog } from "./form";
import type { Choice, FieldSpec, Values } from "./fields";
import { colorField, colorHex, modelColor } from "./colors";
import { t, type DialogKey } from "./strings";

type Json = Record<string, unknown>;

const object = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const choices = (list: readonly (readonly [string, DialogKey])[]): Choice[] => list.map(([value, label]) => ({ value, label: t(label) }));

// ── Numero ──────────────────────────────────────────────────────────────

const CATEGORIES: readonly (readonly [string, DialogKey])[] = [
  ["general", "grid.dialog.format.general"],
  ["number", "grid.dialog.format.number"],
  ["currency", "grid.dialog.format.currency"],
  ["accounting", "grid.dialog.format.accounting"],
  ["date", "grid.dialog.format.date"],
  ["time", "grid.dialog.format.time"],
  ["percentage", "grid.dialog.format.percentage"],
  ["fraction", "grid.dialog.format.fraction"],
  ["scientific", "grid.dialog.format.scientific"],
  ["text", "grid.dialog.format.text"],
  ["custom", "grid.dialog.format.custom"],
];

const NEGATIVES: readonly (readonly [string, DialogKey])[] = [
  ["minus", "grid.dialog.format.negative.minus"],
  ["red", "grid.dialog.format.negative.red"],
  ["parentheses", "grid.dialog.format.negative.parentheses"],
  ["redParentheses", "grid.dialog.format.negative.red_parentheses"],
];

/// I simboli di valuta, con il codice che Excel scrive per ciascuno.
const SYMBOLS: readonly { readonly value: string; readonly label: string; readonly before: string; readonly after: string }[] = [
  { value: "eur", label: "€", before: "", after: " [$€-410]" },
  { value: "usd", label: "$", before: "[$$-409]", after: "" },
  { value: "gbp", label: "£", before: "[$£-809]", after: "" },
  { value: "jpy", label: "¥", before: "[$¥-411]", after: "" },
  { value: "chf", label: "CHF", before: "", after: " [$CHF-807]" },
];

const DATES = ["dd/mm/yyyy", "d/m/yy", "d mmm yyyy", "dddd d mmmm yyyy", "d-mmm", "mmm-yy", "mmmm yyyy", "yyyy-mm-dd", "dd/mm/yyyy hh:mm"];
const TIMES = ["h:mm", "h:mm:ss", "h:mm AM/PM", "h:mm:ss AM/PM", "[h]:mm:ss", "mm:ss.0"];
const FRACTIONS = ["# ?/?", "# ??/??", "# ???/???", "# ?/2", "# ?/4", "# ?/8", "# ??/16", "# ?/10", "# ??/100"];

/// I decimali di un codice: le cifre dopo il primo punto della prima sezione.
export function decimalsOf(code: string): number {
  const first = (code.split(";")[0] ?? "").replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  const match = /\.(0+)/.exec(first);
  return match ? match[1]!.length : 0;
}

const digits = (decimals: number): string => (decimals > 0 ? `.${"0".repeat(decimals)}` : "");

/// Un numero con le sue cifre e i negativi come li si è scelti.
export function numberCode(decimals: number, thousands: boolean, negative: string, before = "", after = ""): string {
  const base = `${before}${thousands ? "#,##0" : "0"}${digits(decimals)}${after}`;
  switch (negative) {
    case "red":
      return `${base};[Red]${base}`;
    case "parentheses":
      return `${base}_);(${base})`;
    case "redParentheses":
      return `${base}_);[Red](${base})`;
    default:
      return base;
  }
}

/// Il codice di formato dei valori della scheda Numero.
export function formatCode(values: Values): string {
  const decimals = typeof values.decimals === "number" ? Math.max(0, Math.min(30, Math.round(values.decimals))) : 2;
  const symbol = SYMBOLS.find((each) => each.value === values.symbol);
  switch (values.category) {
    case "general":
      return "General";
    case "number":
      return numberCode(decimals, values.thousands === true, String(values.negative));
    case "currency":
      return numberCode(decimals, true, String(values.negative), symbol?.before ?? "", symbol?.after ?? "");
    case "accounting": {
      const amount = `#,##0${digits(decimals)}`;
      const zero = `"-"${"?".repeat(decimals)}`;
      if (!symbol) return `_-* ${amount}_-;-* ${amount}_-;_-* ${zero}_-;_-@_-`;
      const mark = symbol.before || `${symbol.after.trim()}`;
      return `_-${mark}* ${amount}_-;-${mark}* ${amount}_-;_-${mark}* ${zero}_-;_-@_-`;
    }
    case "percentage":
      return `0${digits(decimals)}%`;
    case "scientific":
      return `0${digits(decimals)}E+00`;
    case "text":
      return "@";
    case "date":
    case "time":
    case "fraction":
      return String(values.type);
    default:
      return String(values.code ?? "General");
  }
}

/// I valori della scheda Numero per un codice: la famiglia che lo riconosce,
/// o Personalizzato.
export function numberValues(code: string): Values {
  const family = numberFormatOf(code);
  const decimals = decimalsOf(code);
  const negative = /\[Red\]\(/.test(code) ? "redParentheses" : /\[Red\]/.test(code) ? "red" : /_\);\(/.test(code) ? "parentheses" : "minus";
  const symbol = SYMBOLS.find((each) => code.includes(each.before || each.after.trim()) && (each.before || each.after))?.value ?? "none";
  const values: Values = {
    category: "custom",
    decimals,
    thousands: code.includes("#,##0"),
    negative,
    symbol,
    type: "",
    code,
  };
  switch (family) {
    case "General":
      values.category = "general";
      break;
    case "Text":
      values.category = "text";
      break;
    case "Percentage":
      values.category = "percentage";
      break;
    case "Scientific":
      values.category = "scientific";
      break;
    case "Accounting":
      values.category = "accounting";
      break;
    case "Currency":
      values.category = "currency";
      break;
    case "Number":
      values.category = "number";
      break;
    case "Fraction":
      values.category = FRACTIONS.includes(code) ? "fraction" : "custom";
      break;
    case "Time":
      values.category = TIMES.includes(code) ? "time" : "custom";
      break;
    case "Short Date":
    case "Long Date":
      values.category = DATES.includes(code) ? "date" : "custom";
      break;
  }
  // Un codice che la famiglia non rifà uguale resta Personalizzato: OK senza
  // cambiare niente non deve riscriverlo diverso.
  if (values.category !== "custom" && formatCode({ ...values, type: code }) !== code) values.category = "custom";
  if (values.category === "date" || values.category === "time" || values.category === "fraction") values.type = code;
  return values;
}

function numberFields(values: Values): readonly FieldSpec[] {
  const fields: FieldSpec[] = [
    { kind: "select", key: "category", label: t("grid.dialog.format.category"), size: CATEGORIES.length, options: choices(CATEGORIES) },
  ];
  const decimals: FieldSpec = { kind: "number", key: "decimals", label: t("grid.dialog.format.decimals"), min: 0, max: 30 };
  const symbol: FieldSpec = {
    kind: "select",
    key: "symbol",
    label: t("grid.dialog.format.symbol"),
    options: [{ value: "none", label: t("grid.dialog.format.symbol.none") }, ...SYMBOLS.map(({ value, label }) => ({ value, label }))],
  };
  const negative: FieldSpec = { kind: "select", key: "negative", label: t("grid.dialog.format.negative"), size: NEGATIVES.length, options: choices(NEGATIVES) };
  const list = (codes: readonly string[]): FieldSpec => ({
    kind: "select",
    key: "type",
    label: t("grid.dialog.format.type"),
    size: Math.min(9, codes.length),
    options: codes.map((code) => ({ value: code, label: code })),
  });
  switch (values.category) {
    case "general":
      fields.push({ kind: "note", text: t("grid.dialog.format.general.note") });
      break;
    case "number":
      fields.push(decimals, { kind: "check", key: "thousands", label: t("grid.dialog.format.thousands") }, negative);
      break;
    case "currency":
      fields.push(decimals, symbol, negative);
      break;
    case "accounting":
      fields.push(decimals, symbol);
      break;
    case "percentage":
    case "scientific":
      fields.push(decimals);
      break;
    case "date":
      fields.push(list(DATES));
      break;
    case "time":
      fields.push(list(TIMES));
      break;
    case "fraction":
      fields.push(list(FRACTIONS));
      break;
    case "text":
      fields.push({ kind: "note", text: t("grid.dialog.format.text.note") });
      break;
    default:
      fields.push({ kind: "text", key: "code", label: t("grid.dialog.format.code") });
  }
  return fields;
}

// ── Allineamento ────────────────────────────────────────────────────────

const H_ALIGN: readonly (readonly [string, DialogKey])[] = [
  ["General", "grid.dialog.format.h.general"],
  ["Left", "grid.dialog.format.h.left"],
  ["Center", "grid.dialog.format.h.center"],
  ["Right", "grid.dialog.format.h.right"],
  ["Fill", "grid.dialog.format.h.fill"],
  ["Justify", "grid.dialog.format.h.justify"],
  ["CenterAcross", "grid.dialog.format.h.across"],
  ["Distributed", "grid.dialog.format.h.distributed"],
];

const V_ALIGN: readonly (readonly [string, DialogKey])[] = [
  ["Top", "grid.dialog.format.v.top"],
  ["Center", "grid.dialog.format.v.center"],
  ["Bottom", "grid.dialog.format.v.bottom"],
  ["Justify", "grid.dialog.format.v.justify"],
  ["Distributed", "grid.dialog.format.v.distributed"],
];

/// Il testo in verticale, impilato, ha la rotazione 255.
const STACKED = 255;

// ── Carattere ───────────────────────────────────────────────────────────

const FONT_STYLES: readonly (readonly [string, DialogKey])[] = [
  ["regular", "grid.dialog.format.style.regular"],
  ["italic", "grid.dialog.format.style.italic"],
  ["bold", "grid.dialog.format.style.bold"],
  ["boldItalic", "grid.dialog.format.style.bold_italic"],
];

const UNDERLINES: readonly (readonly [string, DialogKey])[] = [
  ["None", "grid.dialog.format.underline.none"],
  ["Single", "grid.dialog.format.underline.single"],
  ["Double", "grid.dialog.format.underline.double"],
  ["SingleAccounting", "grid.dialog.format.underline.single_accounting"],
  ["DoubleAccounting", "grid.dialog.format.underline.double_accounting"],
];

// ── Bordo ───────────────────────────────────────────────────────────────

const LINES: readonly (readonly [string, DialogKey])[] = [
  ["Hair", "grid.dialog.format.line.hair"],
  ["Thin", "grid.dialog.format.line.thin"],
  ["Medium", "grid.dialog.format.line.medium"],
  ["Thick", "grid.dialog.format.line.thick"],
  ["Dotted", "grid.dialog.format.line.dotted"],
  ["Dashed", "grid.dialog.format.line.dashed"],
  ["DashDot", "grid.dialog.format.line.dash_dot"],
  ["DashDotDot", "grid.dialog.format.line.dash_dot_dot"],
  ["MediumDashed", "grid.dialog.format.line.medium_dashed"],
  ["MediumDashDot", "grid.dialog.format.line.medium_dash_dot"],
  ["MediumDashDotDot", "grid.dialog.format.line.medium_dash_dot_dot"],
  ["SlantDashDot", "grid.dialog.format.line.slant_dash_dot"],
  ["Double", "grid.dialog.format.line.double"],
];

const EDGES: readonly (readonly [string, string, DialogKey])[] = [
  ["top", "top", "grid.dialog.format.edge.top"],
  ["bottom", "bottom", "grid.dialog.format.edge.bottom"],
  ["left", "left", "grid.dialog.format.edge.left"],
  ["right", "right", "grid.dialog.format.edge.right"],
  ["diagDown", "diag_down", "grid.dialog.format.edge.diag_down"],
  ["diagUp", "diag_up", "grid.dialog.format.edge.diag_up"],
];

/// Come un tratto del modello si disegna in CSS, nell'anteprima.
function cssLine(style: string): string {
  if (style === "None") return "none";
  const width = /Medium|SlantDash/.test(style) ? 2 : style === "Thick" ? 3 : style === "Double" ? 3 : 1;
  const kind = style === "Double" ? "double" : /Dot/.test(style) && !/Dash/.test(style) ? "dotted" : /Dash|Hair/.test(style) ? "dashed" : "solid";
  return `${width}px ${kind}`;
}

// ── Riempimento ─────────────────────────────────────────────────────────

const PATTERNS: readonly (readonly [string, DialogKey])[] = [
  ["None", "grid.dialog.format.pattern.none"],
  ["Solid", "grid.dialog.format.pattern.solid"],
  ["Gray75", "grid.dialog.format.pattern.gray75"],
  ["Gray50", "grid.dialog.format.pattern.gray50"],
  ["Gray25", "grid.dialog.format.pattern.gray25"],
  ["Gray125", "grid.dialog.format.pattern.gray125"],
  ["Gray0625", "grid.dialog.format.pattern.gray0625"],
  ["DarkHorizontal", "grid.dialog.format.pattern.dark_horizontal"],
  ["DarkVertical", "grid.dialog.format.pattern.dark_vertical"],
  ["DarkDown", "grid.dialog.format.pattern.dark_down"],
  ["DarkUp", "grid.dialog.format.pattern.dark_up"],
  ["DarkGrid", "grid.dialog.format.pattern.dark_grid"],
  ["DarkTrellis", "grid.dialog.format.pattern.dark_trellis"],
  ["LightHorizontal", "grid.dialog.format.pattern.light_horizontal"],
  ["LightVertical", "grid.dialog.format.pattern.light_vertical"],
  ["LightDown", "grid.dialog.format.pattern.light_down"],
  ["LightUp", "grid.dialog.format.pattern.light_up"],
  ["LightGrid", "grid.dialog.format.pattern.light_grid"],
  ["LightTrellis", "grid.dialog.format.pattern.light_trellis"],
];

/// Lo sfondo, il motivo e il suo colore dal riempimento del modello.
export function fillValues(fill: Json): Values {
  const pattern = typeof fill.pattern === "string" ? fill.pattern : "None";
  const fg = modelColor(fill.fg);
  const bg = modelColor(fill.bg);
  if (pattern === "None") return { background: "Auto", pattern: "None", patternColor: "Auto" };
  if (pattern === "Solid") return { background: fg, pattern: "None", patternColor: "Auto" };
  return { background: bg, pattern, patternColor: fg };
}

/// Il riempimento del modello dai valori della scheda.
export function fillOf(values: Values): Json {
  const background = modelColor(values.background);
  const pattern = String(values.pattern ?? "None");
  if (pattern !== "None" && pattern !== "Solid") return { pattern, fg: modelColor(values.patternColor), bg: background };
  if (pattern === "Solid") {
    const color = modelColor(values.patternColor);
    return { pattern: "Solid", fg: color === "Auto" ? background : color, bg: "Auto" };
  }
  return background === "Auto" ? { pattern: "None", fg: "Auto", bg: "Auto" } : { pattern: "Solid", fg: background, bg: "Auto" };
}

// ── La finestra ─────────────────────────────────────────────────────────

/// I valori di partenza di tutte le schede, dallo stile del modello.
export function styleValues(style: Json): Values {
  const font = object(style.font);
  const align = object(style.align);
  const borders = object(style.borders);
  const protection = object(style.protection);
  const rotation = typeof align.rotation === "number" ? align.rotation : 0;
  const values: Values = {
    ...numberValues(typeof style.num_fmt === "string" ? style.num_fmt : "General"),
    h: typeof align.h === "string" ? align.h : "General",
    v: typeof align.v === "string" ? align.v : "Bottom",
    indent: typeof align.indent === "number" ? align.indent : 0,
    rotation: rotation === STACKED ? 0 : rotation,
    stacked: rotation === STACKED,
    wrap: align.wrap === true,
    shrink: align.shrink === true,
    fontName: typeof font.name === "string" ? font.name : "Aptos",
    fontStyle: font.bold === true ? (font.italic === true ? "boldItalic" : "bold") : font.italic === true ? "italic" : "regular",
    size: typeof font.size === "number" ? Math.round(font.size * 2) / 2 : 11,
    underline: typeof font.underline === "string" ? font.underline : "None",
    fontColor: modelColor(font.color),
    strike: font.strike === true,
    superscript: font.vert === "Superscript",
    subscript: font.vert === "Subscript",
    line: "Thin",
    lineColor: "Auto",
    ...fillValues(object(style.fill)),
    locked: protection.locked !== false,
    hidden: protection.hidden === true,
  };
  for (const [key, field] of EDGES) {
    const edge = object(borders[field]);
    values[key] = typeof edge.style === "string" && edge.style !== "None";
  }
  return values;
}

/// La patch dello stile: soltanto ciò che è cambiato da `start`.
export function stylePatch(start: Values, values: Values): Json {
  const changed = (key: string): boolean => JSON.stringify(start[key]) !== JSON.stringify(values[key]);
  const patch: Json = {};
  const numberKeys = ["category", "decimals", "thousands", "negative", "symbol", "type", "code"];
  if (numberKeys.some(changed)) patch.numFmt = formatCode(values);

  const align: Json = {};
  if (changed("h")) align.h = values.h;
  if (changed("v")) align.v = values.v;
  if (changed("indent")) align.indent = values.indent;
  if (changed("rotation") || changed("stacked")) align.rotation = values.stacked === true ? STACKED : values.rotation;
  if (changed("wrap")) align.wrap = values.wrap === true;
  if (changed("shrink")) align.shrink = values.shrink === true;
  if (Object.keys(align).length) patch.align = align;

  const font: Json = {};
  if (changed("fontName")) font.name = values.fontName;
  if (changed("fontStyle")) {
    font.bold = values.fontStyle === "bold" || values.fontStyle === "boldItalic";
    font.italic = values.fontStyle === "italic" || values.fontStyle === "boldItalic";
  }
  if (changed("size")) font.size = values.size;
  if (changed("underline")) font.underline = values.underline;
  if (changed("fontColor")) font.color = values.fontColor;
  if (changed("strike")) font.strike = values.strike === true;
  if (changed("superscript") || changed("subscript")) {
    font.vert = values.superscript === true ? "Superscript" : values.subscript === true ? "Subscript" : "Baseline";
  }
  if (Object.keys(font).length) patch.font = font;

  // Un bordo toccato prende lo stile e il colore della linea scelti adesso;
  // uno tolto diventa nessuno. Cambiare soltanto la linea ridisegna i bordi
  // accesi, come quando in Excel la si sceglie e poi si clicca il bordo.
  const borders: Json = {};
  const lineChanged = changed("line") || changed("lineColor");
  for (const [key] of EDGES) {
    if (!changed(key) && !(lineChanged && values[key] === true)) continue;
    borders[key] = values[key] === true ? { style: values.line, color: values.lineColor } : { style: "None", color: "Auto" };
  }
  if (Object.keys(borders).length) patch.borders = borders;

  if (changed("background") || changed("pattern") || changed("patternColor")) patch.fill = fillOf(values);

  const protection: Json = {};
  if (changed("locked")) protection.locked = values.locked === true;
  if (changed("hidden")) protection.hidden = values.hidden === true;
  if (Object.keys(protection).length) patch.protection = protection;
  return patch;
}

/// I campi in cui si scrive.
const TYPED = ["code", "decimals", "indent", "rotation"];

const TABS = ["number", "alignment", "font", "border", "fill", "protection"] as const;

/// Il campione della scheda Numero: il valore della cella attiva nel formato
/// scelto, calcolato dal provider. `refresh` lo ricalcola senza ridisegnare i
/// campi, mentre si scrive il codice o i decimali.
function sample(context: DialogContext, cell: string, empty: boolean): { readonly field: FieldSpec; refresh(values: Values): void } {
  let text: HTMLOutputElement | null = null;
  let turn = 0;
  const refresh = (values: Values): void => {
    const target = text;
    turn += 1;
    const mine = turn;
    if (!target || empty) return;
    const code = formatCode(values).replace(/"/g, '""');
    void context.read("formulas.evaluate", { formula: `=TEXT(${cell},"${code}")` }).then((result) => {
      // Un risultato vecchio non copre quello di un codice scritto dopo.
      if (context.life.closed || mine !== turn) return;
      target.textContent = typeof result === "string" ? result : "";
    });
  };
  const field: FieldSpec = {
    kind: "custom",
    key: "sample",
    label: t("grid.dialog.format.sample"),
    render: (values) => {
      const box = document.createElement("div");
      box.className = "grid-dialog-field grid-dialog-sample";
      const label = document.createElement("span");
      label.className = "grid-dialog-label";
      label.textContent = t("grid.dialog.format.sample");
      text = document.createElement("output");
      text.className = "grid-dialog-sample-text";
      box.append(label, text);
      refresh(values);
      return box;
    },
  };
  return { field, refresh };
}

/// I predefiniti del bordo: Nessuno spegne tutti i lati, Bordato accende i
/// quattro del contorno, come in Excel.
function borderPresets(): FieldSpec {
  return {
    kind: "custom",
    key: "presets",
    label: t("grid.dialog.format.presets"),
    render: (values, onChange, life) => {
      const presets = document.createElement("div");
      presets.className = "grid-dialog-toolbar";
      presets.setAttribute("role", "group");
      presets.setAttribute("aria-label", t("grid.dialog.format.presets"));
      const preset = (label: DialogKey, on: boolean): HTMLButtonElement => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "kit-button";
        button.dataset.kind = "normal";
        button.dataset.key = on ? "presetOutline" : "presetNone";
        button.textContent = t(label);
        life.listen(button, "click", () => {
          for (const [key] of EDGES) values[key] = on && !key.startsWith("diag");
          onChange("top");
        });
        return button;
      };
      presets.append(preset("grid.dialog.format.border.none", false), preset("grid.dialog.format.border.outline", true));
      return presets;
    },
  };
}

/// L'anteprima del carattere.
function fontPreview(theme: readonly string[]): FieldSpec {
  return {
    kind: "custom",
    key: "fontPreview",
    label: t("grid.dialog.format.preview"),
    render: (values) => {
      const box = document.createElement("div");
      box.className = "grid-dialog-field grid-dialog-preview";
      const label = document.createElement("span");
      label.className = "grid-dialog-label";
      label.textContent = t("grid.dialog.format.preview");
      const text = document.createElement("span");
      text.className = "grid-dialog-preview-text";
      text.textContent = t("grid.dialog.format.preview.text");
      text.style.fontFamily = `"${String(values.fontName)}", sans-serif`;
      text.style.fontSize = `${Math.min(36, Number(values.size) || 11)}pt`;
      text.style.fontWeight = values.fontStyle === "bold" || values.fontStyle === "boldItalic" ? "700" : "400";
      text.style.fontStyle = values.fontStyle === "italic" || values.fontStyle === "boldItalic" ? "italic" : "normal";
      const lines = [values.underline !== "None" ? "underline" : "", values.strike === true ? "line-through" : ""].filter(Boolean);
      text.style.textDecoration = lines.join(" ") || "none";
      if (String(values.underline).startsWith("Double")) text.style.textDecorationStyle = "double";
      text.style.verticalAlign = values.superscript === true ? "super" : values.subscript === true ? "sub" : "baseline";
      const color = colorHex(modelColor(values.fontColor), theme);
      if (color) text.style.color = color;
      box.append(label, text);
      return box;
    },
  };
}

/// L'anteprima dei bordi: un riquadro con i bordi accesi.
function borderPreview(theme: readonly string[]): FieldSpec {
  return {
    kind: "custom",
    key: "borderPreview",
    label: t("grid.dialog.format.preview"),
    render: (values) => {
      const box = document.createElement("div");
      box.className = "grid-dialog-border-preview";
      box.setAttribute("aria-hidden", "true");
      const cell = document.createElement("div");
      cell.className = "grid-dialog-border-cell";
      cell.textContent = t("grid.dialog.format.preview.text");
      const color = colorHex(modelColor(values.lineColor), theme) ?? "currentColor";
      const line = `${cssLine(String(values.line))} ${color}`;
      for (const side of ["top", "bottom", "left", "right"] as const) {
        cell.style.setProperty(`border-${side}`, values[side] === true ? line : "1px dotted transparent");
      }
      cell.classList.toggle("grid-dialog-border-cell--down", values.diagDown === true);
      cell.classList.toggle("grid-dialog-border-cell--up", values.diagUp === true);
      cell.style.setProperty("--grid-dialog-diagonal", color);
      box.append(cell);
      return box;
    },
  };
}

const formatCells: DialogBuilder = async (context) => {
  const info = object(await context.read("cell.get"));
  const style = object(info.style);
  const start = styleValues(style);
  const values: Values = { ...start };
  const theme = themeColors(context.engine.book()?.theme_colors);
  const cell = context.engine.selectionRefs().active;
  const empty = info.value === null || info.value === undefined || info.value === "";
  const asked = typeof context.params.tab === "string" ? context.params.tab.toLowerCase() : "number";
  const fonts = FONTS.includes(String(values.fontName)) ? FONTS : [String(values.fontName), ...FONTS];
  const sizes = FONT_SIZES.includes(Number(values.size)) ? FONT_SIZES : [...FONT_SIZES, Number(values.size)].sort((a, b) => a - b);

  const shown = sample(context, cell, empty);
  let category = String(values.category);

  return formDialog(context, {
    title: t("grid.dialog.format.title"),
    values,
    className: "grid-dialog-wide grid-dialog-format",
    page: TABS.includes(asked as (typeof TABS)[number]) ? asked : "number",
    command: "home.formatCells",
    pages: [
      {
        id: "number",
        label: t("grid.dialog.format.tab.number"),
        fields: (current) => [...numberFields(current), shown.field],
      },
      {
        id: "alignment",
        label: t("grid.dialog.format.tab.alignment"),
        fields: (current) => [
          { kind: "select", key: "h", label: t("grid.dialog.format.horizontal"), options: choices(H_ALIGN) },
          { kind: "number", key: "indent", label: t("grid.dialog.format.indent"), min: 0, max: 250 },
          { kind: "select", key: "v", label: t("grid.dialog.format.vertical"), options: choices(V_ALIGN) },
          { kind: "number", key: "rotation", label: t("grid.dialog.format.rotation"), min: -90, max: 90, disabled: current.stacked === true },
          { kind: "check", key: "stacked", label: t("grid.dialog.format.stacked") },
          {
            kind: "section",
            label: t("grid.dialog.format.control"),
            fields: [
              { kind: "check", key: "wrap", label: t("grid.dialog.format.wrap") },
              { kind: "check", key: "shrink", label: t("grid.dialog.format.shrink"), disabled: current.wrap === true },
            ],
          },
        ],
      },
      {
        id: "font",
        label: t("grid.dialog.format.tab.font"),
        fields: () => [
          { kind: "select", key: "fontName", label: t("grid.dialog.format.font"), size: 6, options: fonts.map((name) => ({ value: name, label: name })) },
          { kind: "select", key: "fontStyle", label: t("grid.dialog.format.font_style"), options: choices(FONT_STYLES) },
          { kind: "select", key: "size", label: t("grid.dialog.format.size"), options: sizes.map((size) => ({ value: String(size), label: String(size) })) },
          { kind: "select", key: "underline", label: t("grid.dialog.format.underline"), options: choices(UNDERLINES) },
          colorField("fontColor", t("grid.dialog.format.color"), theme),
          {
            kind: "section",
            label: t("grid.dialog.format.effects"),
            fields: [
              { kind: "check", key: "strike", label: t("grid.dialog.format.strike") },
              { kind: "check", key: "superscript", label: t("grid.dialog.format.superscript") },
              { kind: "check", key: "subscript", label: t("grid.dialog.format.subscript") },
            ],
          },
          fontPreview(theme),
        ],
      },
      {
        id: "border",
        label: t("grid.dialog.format.tab.border"),
        fields: () => [
          borderPresets(),
          { kind: "select", key: "line", label: t("grid.dialog.format.line"), size: 7, options: choices(LINES) },
          colorField("lineColor", t("grid.dialog.format.line_color"), theme),
          {
            kind: "section",
            label: t("grid.dialog.format.edges"),
            fields: EDGES.map(([key, , label]) => ({ kind: "check" as const, key, label: t(label) })),
          },
          borderPreview(theme),
        ],
      },
      {
        id: "fill",
        label: t("grid.dialog.format.tab.fill"),
        fields: () => [
          colorField("background", t("grid.dialog.format.background"), theme, t("grid.dialog.format.no_color")),
          colorField("patternColor", t("grid.dialog.format.pattern_color"), theme),
          { kind: "select", key: "pattern", label: t("grid.dialog.format.pattern"), options: choices(PATTERNS) },
        ],
      },
      {
        id: "protection",
        label: t("grid.dialog.format.tab.protection"),
        fields: () => [
          { kind: "check", key: "locked", label: t("grid.dialog.format.locked") },
          { kind: "check", key: "hidden", label: t("grid.dialog.format.hidden") },
          { kind: "note", text: t("grid.dialog.format.protection.note") },
        ],
      },
    ],
    change: (key, current) => {
      if (key === "size") current.size = Number(current.size);
      // Apice e pedice si escludono, come in Excel.
      if (key === "superscript" && current.superscript === true) current.subscript = false;
      if (key === "subscript" && current.subscript === true) current.superscript = false;
      if (key === "category") {
        if (current.category === "date" && !DATES.includes(String(current.type))) current.type = DATES[0];
        if (current.category === "time" && !TIMES.includes(String(current.type))) current.type = TIMES[0];
        if (current.category === "fraction" && !FRACTIONS.includes(String(current.type))) current.type = FRACTIONS[0];
        // Personalizzato parte dal codice della categoria lasciata.
        if (current.category === "custom") current.code = formatCode({ ...current, category });
        category = String(current.category);
      }
      // Ciò che si scrive non ridisegna i campi, che perderebbero il cursore:
      // cambia soltanto il campione. Il resto ridisegna categorie, anteprime
      // e campi spenti.
      if (TYPED.includes(key)) {
        shown.refresh(current);
        return false;
      }
      return true;
    },
    params: (current) => {
      const patch = stylePatch(start, current);
      return Object.keys(patch).length ? { style: patch } : { style: {} };
    },
  });
};

export const FORMAT_DIALOGS: Readonly<Record<string, DialogBuilder>> = { formatCells };
