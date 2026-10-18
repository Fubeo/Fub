// I colori di CSS come li legge un browser, per scriverli nella forma del
// formato: `#rrggbb` minuscolo, con la trasparenza a parte, nell'opacità del
// riempimento, del contorno o del punto di una sfumatura.
//
// - **Le forme:** i nomi, `transparent`, `#rgb`, `#rgba`, `#rrggbb`,
//   `#rrggbbaa`, e le funzioni `rgb()`, `rgba()`, `hsl()`, `hsla()` e `hwb()`,
//   con le virgole di CSS 3 o con gli spazi e `/ alpha` di CSS 4, coi numeri
//   o con le percentuali, e `none` per un canale che vale zero.
// - **Ciò che dipende da altro non si legge qui:** `currentColor` lo risolve
//   la cascata, e i colori di sistema, `color-mix()`, `lab()` e gli altri
//   spazi di colore restano come sono scritti.

import { NAMED_COLORS } from "../scene/values";

/// Un colore sRGB: i canali da 0 a 255, anche con decimali, e la
/// trasparenza da 0 a 1.
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/// Un numero di CSS; `null` se non lo è.
function numberOf(text: string): number | null {
  return NUMBER.test(text) ? Number(text) : null;
}

/// Un canale di `rgb()`: un numero da 0 a 255 o una percentuale.
function channel(text: string): [value: number, percent: boolean] | null {
  if (text.toLowerCase() === "none") return [0, false];
  if (text.endsWith("%")) {
    const n = numberOf(text.slice(0, -1));
    return n === null ? null : [(n * 255) / 100, true];
  }
  const n = numberOf(text);
  return n === null ? null : [n, false];
}

/// Una trasparenza: un numero da 0 a 1 o una percentuale.
function alphaOf(text: string): number | null {
  if (text.toLowerCase() === "none") return 0;
  const n = text.endsWith("%") ? numberOf(text.slice(0, -1)) : numberOf(text);
  if (n === null) return null;
  return clamp(text.endsWith("%") ? n / 100 : n, 1);
}

/// Una tinta in gradi.
function hueOf(text: string): number | null {
  const lower = text.toLowerCase();
  if (lower === "none") return 0;
  const match = /^(.*?)(deg|rad|grad|turn)?$/.exec(lower)!;
  const n = numberOf(match[1]!);
  if (n === null) return null;
  switch (match[2]) {
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    case "turn":
      return n * 360;
    default:
      return n;
  }
}

/// Una percentuale di `hsl()` o `hwb()`, da 0 a 1; CSS 4 ammette anche il
/// numero da solo.
function fractionOf(text: string, legacy: boolean): number | null {
  if (text.toLowerCase() === "none") return 0;
  if (text.endsWith("%")) {
    const n = numberOf(text.slice(0, -1));
    return n === null ? null : n / 100;
  }
  if (legacy) return null;
  const n = numberOf(text);
  return n === null ? null : n / 100;
}

const clamp = (value: number, top: number): number => Math.max(0, Math.min(top, value));

/// Gli argomenti di una funzione di colore: tre canali e la trasparenza, se
/// c'è; con le virgole o con gli spazi e `/`. `null` se non si leggono.
function argumentsOf(inner: string): { readonly parts: string[]; readonly alpha: string | null; readonly legacy: boolean } | null {
  const text = inner.trim();
  if (text.includes(",")) {
    const parts = text.split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    if (parts.some((part) => part === "" || /\s/.test(part) || part.toLowerCase() === "none")) return null;
    return { parts: parts.slice(0, 3), alpha: parts[3] ?? null, legacy: true };
  }
  const slash = text.split("/");
  if (slash.length > 2) return null;
  const parts = slash[0]!.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const alpha = slash.length === 2 ? slash[1]!.trim() : null;
  if (alpha === "" || (alpha !== null && /\s/.test(alpha))) return null;
  return { parts, alpha, legacy: false };
}

/// Il colore sRGB di una tinta, saturazione e luminosità da 0 a 1.
function hslToRgb(hue: number, s: number, l: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 30;
  const k = (n: number): number => (n + h) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255;
  return [f(0), f(8), f(4)];
}

/// Il colore di `text` scritto in CSS; `null` se non è una forma che si
/// legge qui. Maiuscole e spazi attorno non contano.
export function parseCssColor(text: string): Rgba | null {
  const value = text.trim().toLowerCase();
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    const short = (i: number): number => parseInt(hex[i]!, 16) * 17;
    const long = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
    switch (hex.length) {
      case 3:
        return { r: short(0), g: short(1), b: short(2), a: 1 };
      case 4:
        return { r: short(0), g: short(1), b: short(2), a: short(3) / 255 };
      case 6:
        return { r: long(0), g: long(2), b: long(4), a: 1 };
      case 8:
        return { r: long(0), g: long(2), b: long(4), a: long(6) / 255 };
      default:
        return null;
    }
  }
  const named = NAMED_COLORS.get(value);
  if (named !== undefined) return { r: (named >> 16) & 0xff, g: (named >> 8) & 0xff, b: named & 0xff, a: 1 };
  const call = /^(rgba?|hsla?|hwb)\((.*)\)$/s.exec(value);
  if (call === null) return null;
  const name = call[1]!;
  const args = argumentsOf(call[2]!);
  if (args === null || (name === "hwb" && args.legacy)) return null;
  const alpha = args.alpha === null ? 1 : alphaOf(args.alpha);
  if (alpha === null) return null;
  if (name === "rgb" || name === "rgba") {
    const channels = args.parts.map(channel);
    if (channels.some((each) => each === null)) return null;
    // Con le virgole i tre canali sono tutti numeri o tutti percentuali.
    if (args.legacy && new Set(channels.map((each) => each![1])).size > 1) return null;
    const [r, g, b] = channels.map((each) => clamp(each![0], 255)) as [number, number, number];
    return { r, g, b, a: alpha };
  }
  const hue = hueOf(args.parts[0]!);
  const second = fractionOf(args.parts[1]!, args.legacy);
  const third = fractionOf(args.parts[2]!, args.legacy);
  if (hue === null || second === null || third === null) return null;
  if (name === "hwb") {
    const white = clamp(second, 1);
    const black = clamp(third, 1);
    if (white + black >= 1) {
      const gray = (white / (white + black)) * 255;
      return { r: gray, g: gray, b: gray, a: alpha };
    }
    const [r, g, b] = hslToRgb(hue, 1, 0.5).map((c) => c * (1 - white - black) + white * 255) as [number, number, number];
    return { r, g, b, a: alpha };
  }
  const [r, g, b] = hslToRgb(hue, clamp(second, 1), clamp(third, 1));
  return { r, g, b, a: alpha };
}

/// Un colore come `#rrggbb` minuscolo, coi canali arrotondati; la
/// trasparenza non c'è.
export function formatHex(color: Rgba): string {
  const two = (n: number): string => Math.round(clamp(n, 255)).toString(16).padStart(2, "0");
  return `#${two(color.r)}${two(color.g)}${two(color.b)}`;
}
