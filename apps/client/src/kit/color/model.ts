// I conti del selettore del colore, senza DOM: un colore è sRGB con l'alfa, e
// si legge e si scrive in esadecimale, RGB, HSL e OKLCH. Il selettore lavora
// in HSV (il quadrato è saturazione × valore, la striscia è la tinta), che si
// tiene a parte: un grigio non ha tinta, e il quadrato non deve perderla quando
// ci si passa sopra.

import { fromHex, toHex } from "../../theme/oklch";

/// Un colore: canali 0–255 e alfa 0–1.
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/// Tinta in gradi (0–360), saturazione e valore 0–1, alfa 0–1.
export interface Hsva {
  readonly h: number;
  readonly s: number;
  readonly v: number;
  readonly a: number;
}

/// I modi in cui il selettore scrive il colore.
export type ColorFormat = "hex" | "rgb" | "hsl" | "oklch";
export const COLOR_FORMATS: readonly ColorFormat[] = ["hex", "rgb", "hsl", "oklch"];

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const round = (value: number, places = 0): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor + 0;
};

/// `#rgb`, `#rgba`, `#rrggbb` o `#rrggbbaa`, maiuscolo o minuscolo, col
/// cancelletto o senza; `null` se non lo è.
export function parseHex(text: string): Rgba | null {
  const digits = text.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(digits)) return null;
  const long = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
  const channel = (at: number): number => parseInt(long.slice(at, at + 2), 16);
  return { r: channel(0), g: channel(2), b: channel(4), a: long.length === 8 ? round(channel(6) / 255, 3) : 1 };
}

/// `#rrggbb` minuscolo, o `#rrggbbaa` se il colore non è pieno: come lo
/// scrivono i file.
export function toHexText(color: Rgba): string {
  const byte = (value: number): string => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  const alpha = color.a < 1 ? byte(color.a * 255) : "";
  return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}${alpha}`;
}

export function rgbToHsv(color: Rgba, hue = 0): Hsva {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = hue;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max, a: color.a };
}

export function hsvToRgb(color: Hsva): Rgba {
  const h = ((color.h % 360) + 360) % 360;
  const c = color.v * color.s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = color.v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255), a: color.a };
}

/// Tinta in gradi, saturazione e luminosità in percentuale.
export function rgbToHsl(color: Rgba): { readonly h: number; readonly s: number; readonly l: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  const { h } = rgbToHsv(color);
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb(h: number, s: number, l: number, a = 1): Rgba {
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const v = light + sat * Math.min(light, 1 - light);
  return hsvToRgb({ h, s: v === 0 ? 0 : 2 * (1 - light / v), v, a });
}

/// Il colore scritto nel modo `format`.
export function formatColor(color: Rgba, format: ColorFormat): string {
  const alpha = color.a < 1 ? ` / ${round(color.a * 100)}%` : "";
  switch (format) {
    case "hex":
      return toHexText(color);
    case "rgb":
      return `rgb(${color.r} ${color.g} ${color.b}${alpha})`;
    case "hsl": {
      const { h, s, l } = rgbToHsl(color);
      return `hsl(${round(h)} ${round(s)}% ${round(l)}%${alpha})`;
    }
    case "oklch": {
      const { l, c, h } = fromHex(toHexText({ ...color, a: 1 }));
      return `oklch(${round(l * 100, 2)}% ${round(c, 4)} ${round(c < 0.0005 ? 0 : h, 2)}${alpha})`;
    }
  }
}

/// Un numero di un colore scritto, con la percentuale se c'è.
function amount(text: string): { readonly value: number; readonly percent: boolean } | null {
  const found = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))(%|deg)?$/i.exec(text.trim());
  if (!found) return null;
  return { value: Number(found[1]!.replace(",", ".")), percent: found[2] === "%" };
}

/// Un colore scritto in uno dei quattro modi, con o senza alfa, con spazi o
/// virgole; `null` se non si legge.
export function parseColor(text: string): Rgba | null {
  const trimmed = text.trim().toLowerCase();
  const hex = parseHex(trimmed);
  if (hex) return hex;
  const call = /^(rgba?|hsla?|oklch)\(\s*(.*?)\s*\)$/.exec(trimmed);
  if (!call) return null;
  const [main, slash] = call[2]!.split("/");
  const parts = main!.split(/[\s,]+/).filter(Boolean);
  if (slash === undefined && parts.length === 4) {
    // `rgba(0, 0, 0, 0.5)`: l'alfa dopo una virgola.
    const last = parts.pop()!;
    return parseColor(`${call[1]}(${parts.join(" ")} / ${last})`);
  }
  if (parts.length !== 3) return null;
  const values = parts.map(amount);
  if (values.some((value) => value === null)) return null;
  const [x, y, z] = values as { value: number; percent: boolean }[];
  let a = 1;
  if (slash !== undefined) {
    const alpha = amount(slash);
    if (!alpha) return null;
    a = clamp(alpha.percent ? alpha.value / 100 : alpha.value, 0, 1);
  }
  const kind = call[1]!.replace(/a$/, "");
  if (kind === "rgb") {
    const channel = (part: { value: number; percent: boolean }): number => clamp(Math.round(part.percent ? (part.value * 255) / 100 : part.value), 0, 255);
    return { r: channel(x!), g: channel(y!), b: channel(z!), a };
  }
  if (kind === "hsl") return hslToRgb(x!.value, y!.value, z!.value, a);
  const l = x!.percent ? x!.value / 100 : x!.value;
  const c = y!.percent ? (y!.value * 0.4) / 100 : y!.value;
  const parsed = parseHex(toHex({ l: clamp(l, 0, 1), c: Math.max(0, c), h: z!.value }))!;
  return { ...parsed, a };
}

/// Il contrasto WCAG fra due colori pieni.
export function contrastRatio(one: Rgba, two: Rgba): number {
  const luminance = (color: Rgba): number => {
    const linear = (value: number): number => {
      const v = value / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
  };
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
