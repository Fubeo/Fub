// I valori degli attributi ammessi dal formato della scena (§4): numeri,
// lunghezze, colori, parole chiave, trasformazioni, punti e `href`.
//
// È la stessa lettura di `fub-scene` (`values.rs`), regola per regola: una
// scena classificata in modo diverso da Rust e da TypeScript sarebbe una
// superficie che modifica ciò che il provider dichiara estraneo. Ogni lettore
// risponde `null` quando il valore non rientra nella specifica, e un valore
// fuori specifica rende estraneo l'elemento. Si può essere più severi di un
// browser, mai più indulgenti.
//
// Le stringhe qui sono UTF-16 e quelle di Rust UTF-8, ma ogni simbolo della
// grammatica è ASCII: le due letture scorrono gli stessi caratteri. Dove Rust
// conta byte (la dimensione di un data URI) si contano byte UTF-8.

import { compose, IDENTITY, type Matrix, rotate, toRadians, translate } from "./matrix";
import { utf8Length } from "./text";

/// Il più grande `float` a 32 bit: un numero oltre non è un numero (§4).
export const F32_MAX = 3.4028234663852886e38;

/// Gli spazi che SVG e CSS tolgono intorno a un valore.
export function isWsp(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c;
}

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

/// `value` senza gli spazi SVG intorno.
export function trim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isWsp(value.charCodeAt(start))) start++;
  while (end > start && isWsp(value.charCodeAt(end - 1))) end--;
  return value.slice(start, end);
}

/// Legge un numero SVG al carattere `i` di `text`: segno facoltativo, cifre
/// con o senza decimali, esponente facoltativo. Restituisce il valore e
/// l'indice dopo il numero.
///
/// Come i browser vuole una cifra dopo il punto (`1.` non è un numero) e
/// prende l'esponente solo se è seguito da cifre, così `1em` resta un numero
/// con un'unità. Un valore che non sta in un `float` a 32 bit non è un numero.
export function scanNumber(text: string, i: number): [number, number] | null {
  const start = i;
  let c = text.charCodeAt(i);
  if (c === 0x2b || c === 0x2d) i++;
  const from = i;
  while (isDigit(text.charCodeAt(i))) i++;
  const integer = i > from;
  if (text.charCodeAt(i) === 0x2e) {
    let j = i + 1;
    const fraction = j;
    while (isDigit(text.charCodeAt(j))) j++;
    if (j === fraction) return null;
    i = j;
  } else if (!integer) {
    return null;
  }
  c = text.charCodeAt(i);
  if (c === 0x65 || c === 0x45) {
    let j = i + 1;
    const sign = text.charCodeAt(j);
    if (sign === 0x2b || sign === 0x2d) j++;
    const exponent = j;
    while (isDigit(text.charCodeAt(j))) j++;
    if (j > exponent) i = j;
  }
  // La grammatica è già controllata: `Number` arrotonda correttamente come
  // `str::parse::<f64>` di Rust.
  const value = Number(text.slice(start, i));
  return Math.abs(value) <= F32_MAX ? [value, i] : null;
}

/// Un numero SVG da solo, con gli spazi intorno.
export function number(value: string): number | null {
  const text = trim(value);
  const scanned = scanNumber(text, 0);
  return scanned !== null && scanned[1] === text.length ? scanned[0] : null;
}

/// I rapporti delle unità assolute di CSS (1in = 96px = 2,54cm = 72pt = 6pc;
/// 1Q = 0,25mm), calcolati come in Rust.
const UNITS: ReadonlyMap<string, number> = new Map([
  ["", 1],
  ["px", 1],
  ["in", 96],
  ["cm", 96 / 2.54],
  ["mm", 96 / 25.4],
  ["Q", 96 / 101.6],
  ["pt", 96 / 72],
  ["pc", 16],
]);

/// Una lunghezza in unità utente: un numero SVG con un'unità assoluta
/// facoltativa. Percentuali, unità relative e parole chiave non sono
/// lunghezze di §4.
export function length(value: string): number | null {
  const text = trim(value);
  const scanned = scanNumber(text, 0);
  if (scanned === null) return null;
  const scale = UNITS.get(text.slice(scanned[1]));
  return scale === undefined ? null : scanned[0] * scale;
}

/// Una lunghezza non negativa.
export function nonNegativeLength(value: string): number | null {
  const n = length(value);
  return n !== null && n >= 0 ? n : null;
}

/// Un'opacità: un numero da 0 a 1, senza percentuale.
export function opacity(value: string): number | null {
  const n = number(value);
  return n !== null && n >= 0 && n <= 1 ? n : null;
}

/// Un colore sRGB, tre interi da 0 a 255.
export type Rgb = readonly [number, number, number];

/// Il valore di `fill` o `stroke`: `none` o un colore.
export type Paint = "none" | Rgb;

const HEX = /^[0-9a-fA-F]*$/;

/// Un colore di §4: `none`, `#rgb`, `#rrggbb` o un nome CSS, nelle forme
/// elencate. `currentColor`, `transparent`, le funzioni e le maiuscole nei
/// nomi non lo sono.
export function paint(value: string): Paint | null {
  const text = trim(value);
  if (text === "none") return "none";
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    if (!HEX.test(hex)) return null;
    const digit = (i: number): number => parseInt(hex.slice(i, i + 1), 16);
    const byte = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
    if (hex.length === 3) return [digit(0) * 17, digit(1) * 17, digit(2) * 17];
    if (hex.length === 6) return [byte(0), byte(2), byte(4)];
    return null;
  }
  const rgb = NAMED_COLORS.get(text);
  return rgb === undefined ? null : [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
}

/// Spezza sugli spazi SVG, come `split(is_wsp)` di Rust: le parti vuote
/// restano.
function splitWsp(text: string): string[] {
  return text.split(/[ \t\n\r\f]/);
}

/// `stroke-dasharray`: `none` oppure lunghezze non negative separate da spazi
/// o virgole.
export function dasharray(value: string): boolean {
  const text = trim(value);
  if (text === "none") return true;
  let items = 0;
  for (const raw of text.split(",")) {
    const item = trim(raw);
    if (item === "") return false;
    for (const part of splitWsp(item)) {
      if (part === "") continue;
      if (nonNegativeLength(part) === null) return false;
      items++;
    }
  }
  return items > 0;
}

const KEYWORDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["display", ["none", "inline"]],
  ["stroke-linecap", ["butt", "round", "square"]],
  ["stroke-linejoin", ["miter", "round", "bevel"]],
  ["font-weight", ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"]],
  ["text-anchor", ["start", "middle", "end"]],
]);

/// Una parola chiave fra quelle elencate per `name`.
export function keyword(name: string, value: string): boolean {
  return KEYWORDS.get(name)?.includes(trim(value)) ?? false;
}

/// Le parole chiave di `name`, nell'ordine di §4; vuote se `name` non ne ha.
export function keywords(name: string): readonly string[] {
  return KEYWORDS.get(name) ?? [];
}

const ALIGN = [
  "none", "xMinYMin", "xMidYMin", "xMaxYMin", "xMinYMid", "xMidYMid", "xMaxYMid", "xMinYMax",
  "xMidYMax", "xMaxYMax",
];

/// `preserveAspectRatio`: un allineamento, `none` compreso, seguito
/// facoltativamente da `meet` o `slice`.
export function preserveAspectRatio(value: string): boolean {
  const parts = splitWsp(trim(value)).filter((part) => part !== "");
  const align = parts[0] !== undefined && ALIGN.includes(parts[0]);
  const meet = parts[1] === undefined || parts[1] === "meet" || parts[1] === "slice";
  return align && meet && parts.length <= 2;
}

/// Salta un separatore `comma-wsp` facoltativo a partire da `i`: restituisce
/// il nuovo indice e se ha trovato una virgola.
function skipSeparator(text: string, i: number): [number, boolean] {
  while (i < text.length && isWsp(text.charCodeAt(i))) i++;
  const comma = text.charCodeAt(i) === 0x2c;
  if (comma) {
    i++;
    while (i < text.length && isWsp(text.charCodeAt(i))) i++;
  }
  return [i, comma];
}

function skipWsp(text: string, i: number): number {
  while (i < text.length && isWsp(text.charCodeAt(i))) i++;
  return i;
}

/// Una lista di numeri separati da spazi o virgole, senza virgole in testa o
/// in coda. Fra due numeri il separatore può mancare quando il secondo
/// comincia con un segno o un punto (`10-20`, `1.5.5`), come nei path.
export function numberList(value: string): number[] | null {
  let i = skipWsp(value, 0);
  const numbers: number[] = [];
  while (i < value.length) {
    const scanned = scanNumber(value, i);
    if (scanned === null) return null;
    numbers.push(scanned[0]);
    const [next, comma] = skipSeparator(value, scanned[1]);
    i = next;
    if (comma && i === value.length) return null;
  }
  return numbers;
}

/// `points`: coppie di numeri. Un numero dispari di valori non è una lista di
/// punti.
export function points(value: string): Array<[number, number]> | null {
  const numbers = numberList(value);
  if (numbers === null || numbers.length % 2 !== 0) return null;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < numbers.length; i += 2) pairs.push([numbers[i]!, numbers[i + 1]!]);
  return pairs;
}

const TRANSFORMS = ["matrix", "translate", "scale", "rotate", "skewX", "skewY"] as const;

/// Una funzione di trasformazione con i suoi argomenti, o `null` se l'arità
/// non è fra quelle ammesse.
function transformStep(name: (typeof TRANSFORMS)[number], args: readonly number[]): Matrix | null {
  const [p, q, r, s, t, u] = args;
  switch (`${name}/${args.length}`) {
    case "matrix/6": return [p!, q!, r!, s!, t!, u!];
    case "translate/1": return translate(p!, 0);
    case "translate/2": return translate(p!, q!);
    case "scale/1": return [p!, 0, 0, p!, 0, 0];
    case "scale/2": return [p!, 0, 0, q!, 0, 0];
    case "rotate/1": return rotate(p!);
    case "rotate/3": return compose(compose(translate(q!, r!), rotate(p!)), translate(-q!, -r!));
    case "skewX/1": return [1, 0, Math.tan(toRadians(p!)), 1, 0, 0];
    case "skewY/1": return [1, Math.tan(toRadians(p!)), 0, 1, 0, 0];
    default: return null;
  }
}

/// Una lista di funzioni di trasformazione SVG, composta in una matrice.
///
/// Le funzioni si separano con spazi o con una virgola, e il separatore può
/// mancare (`translate(1)scale(2)`), come nei browser. I nomi sono sensibili
/// alle maiuscole e gli argomenti sono numeri senza unità.
export function transform(value: string): Matrix | null {
  let matrix = IDENTITY;
  let i = skipWsp(value, 0);
  while (i < value.length) {
    const name = TRANSFORMS.find((n) => value.startsWith(n, i));
    if (name === undefined) return null;
    i = skipWsp(value, i + name.length);
    if (value.charCodeAt(i) !== 0x28) return null;
    i = skipWsp(value, i + 1);
    const args: number[] = [];
    while (value.charCodeAt(i) !== 0x29) {
      if (args.length === 6) return null;
      const scanned = scanNumber(value, i);
      if (scanned === null) return null;
      args.push(scanned[0]);
      const [next, comma] = skipSeparator(value, scanned[1]);
      i = next;
      if (comma && value.charCodeAt(i) === 0x29) return null;
    }
    i++;
    const step = transformStep(name, args);
    if (step === null) return null;
    matrix = compose(matrix, step);
    const [next, comma] = skipSeparator(value, i);
    i = next;
    if (comma && i === value.length) return null;
  }
  return matrix;
}

/// Un `href` letto come lo legge il parser di URL: senza spazi e controlli
/// intorno, senza tabulazioni e a capo dentro.
function urlText(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  return value.slice(start, end).replace(/[\t\n\r]/g, "");
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;

/// Lo schema di un URL, in minuscolo, se ce n'è uno.
function scheme(url: string): string | null {
  const colon = url.indexOf(":");
  if (colon < 0) return null;
  const name = url.slice(0, colon);
  return SCHEME.test(name) ? name.toLowerCase() : null;
}

/// Vero se un URL usa lo schema `javascript:`, letto come lo legge il parser
/// di URL: `" java\tscript:"` lo è.
export function isJavascript(value: string): boolean {
  return scheme(urlText(value)) === "javascript";
}

/// Che cosa indica un `href`.
export type Href =
  /// Un percorso del vault, relativo al disegno o dalla radice del vault se
  /// comincia con `/`, col testo ripulito come lo legge un URL.
  | { readonly kind: "vault"; readonly url: string }
  /// Un data URI: `raster` dice se è PNG, JPEG, WebP o GIF; `bytes` è la
  /// dimensione dei dati decodificati.
  | { readonly kind: "data"; readonly raster: boolean; readonly bytes: number }
  /// Un URL `http` o `https`.
  | { readonly kind: "remote" }
  /// Tutto il resto: altri schemi, frammenti, `//host`, valore vuoto.
  | { readonly kind: "other" };

const OTHER: Href = { kind: "other" };

/// Classifica un `href`.
export function href(value: string): Href {
  const url = urlText(value);
  if (url === "" || url.startsWith("#")) return OTHER;
  const slash = (c: string | undefined): boolean => c === "/" || c === "\\";
  if (slash(url[0]) && slash(url[1])) return OTHER;
  switch (scheme(url)) {
    case null: return { kind: "vault", url };
    case "data": return dataUri(url.slice(5));
    case "http":
    case "https": return { kind: "remote" };
    default: return OTHER;
  }
}

/// Lo spazio di Unicode (`White_Space`), quello che toglie `str::trim` di
/// Rust: non coincide con `String.prototype.trim`, che toglie anche U+FEFF e
/// lascia U+0085.
const UNICODE_SPACE = "[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const RUST_TRIM = new RegExp(`^${UNICODE_SPACE}+|${UNICODE_SPACE}+$`, "g");

/// `str::trim` di Rust.
export function rustTrim(text: string): string {
  return text.replace(RUST_TRIM, "");
}

/// `to_ascii_lowercase` di Rust: solo le lettere ASCII cambiano.
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

const RASTER = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/// Legge un data URI dopo `data:`.
function dataUri(rest: string): Href {
  const comma = rest.indexOf(",");
  if (comma < 0) return OTHER;
  const header = rest.slice(0, comma);
  const payload = rest.slice(comma + 1);
  const params = header.split(";");
  const mime = asciiLower(rustTrim(params[0]!));
  const base64 = asciiLower(rustTrim(params[params.length - 1]!)) === "base64" && header.includes(";");
  let bytes: number;
  if (base64) {
    const symbols = payload.match(/[A-Za-z0-9+/]/g)?.length ?? 0;
    bytes = Math.floor((symbols * 3) / 4);
  } else {
    // Ogni `%XX` vale un byte.
    const length = utf8Length(payload);
    const percents = payload.split("%").length - 1;
    bytes = length - 2 * Math.min(percents, Math.floor(length / 3));
  }
  return { kind: "data", raster: RASTER.has(mime), bytes };
}

/// I colori con nome di CSS Color 4 (`transparent` e `currentcolor` esclusi:
/// §4 li rifiuta).
export const NAMED_COLORS: ReadonlyMap<string, number> = new Map([
  ["aliceblue", 0xf0f8ff],
  ["antiquewhite", 0xfaebd7],
  ["aqua", 0x00ffff],
  ["aquamarine", 0x7fffd4],
  ["azure", 0xf0ffff],
  ["beige", 0xf5f5dc],
  ["bisque", 0xffe4c4],
  ["black", 0x000000],
  ["blanchedalmond", 0xffebcd],
  ["blue", 0x0000ff],
  ["blueviolet", 0x8a2be2],
  ["brown", 0xa52a2a],
  ["burlywood", 0xdeb887],
  ["cadetblue", 0x5f9ea0],
  ["chartreuse", 0x7fff00],
  ["chocolate", 0xd2691e],
  ["coral", 0xff7f50],
  ["cornflowerblue", 0x6495ed],
  ["cornsilk", 0xfff8dc],
  ["crimson", 0xdc143c],
  ["cyan", 0x00ffff],
  ["darkblue", 0x00008b],
  ["darkcyan", 0x008b8b],
  ["darkgoldenrod", 0xb8860b],
  ["darkgray", 0xa9a9a9],
  ["darkgreen", 0x006400],
  ["darkgrey", 0xa9a9a9],
  ["darkkhaki", 0xbdb76b],
  ["darkmagenta", 0x8b008b],
  ["darkolivegreen", 0x556b2f],
  ["darkorange", 0xff8c00],
  ["darkorchid", 0x9932cc],
  ["darkred", 0x8b0000],
  ["darksalmon", 0xe9967a],
  ["darkseagreen", 0x8fbc8f],
  ["darkslateblue", 0x483d8b],
  ["darkslategray", 0x2f4f4f],
  ["darkslategrey", 0x2f4f4f],
  ["darkturquoise", 0x00ced1],
  ["darkviolet", 0x9400d3],
  ["deeppink", 0xff1493],
  ["deepskyblue", 0x00bfff],
  ["dimgray", 0x696969],
  ["dimgrey", 0x696969],
  ["dodgerblue", 0x1e90ff],
  ["firebrick", 0xb22222],
  ["floralwhite", 0xfffaf0],
  ["forestgreen", 0x228b22],
  ["fuchsia", 0xff00ff],
  ["gainsboro", 0xdcdcdc],
  ["ghostwhite", 0xf8f8ff],
  ["gold", 0xffd700],
  ["goldenrod", 0xdaa520],
  ["gray", 0x808080],
  ["green", 0x008000],
  ["greenyellow", 0xadff2f],
  ["grey", 0x808080],
  ["honeydew", 0xf0fff0],
  ["hotpink", 0xff69b4],
  ["indianred", 0xcd5c5c],
  ["indigo", 0x4b0082],
  ["ivory", 0xfffff0],
  ["khaki", 0xf0e68c],
  ["lavender", 0xe6e6fa],
  ["lavenderblush", 0xfff0f5],
  ["lawngreen", 0x7cfc00],
  ["lemonchiffon", 0xfffacd],
  ["lightblue", 0xadd8e6],
  ["lightcoral", 0xf08080],
  ["lightcyan", 0xe0ffff],
  ["lightgoldenrodyellow", 0xfafad2],
  ["lightgray", 0xd3d3d3],
  ["lightgreen", 0x90ee90],
  ["lightgrey", 0xd3d3d3],
  ["lightpink", 0xffb6c1],
  ["lightsalmon", 0xffa07a],
  ["lightseagreen", 0x20b2aa],
  ["lightskyblue", 0x87cefa],
  ["lightslategray", 0x778899],
  ["lightslategrey", 0x778899],
  ["lightsteelblue", 0xb0c4de],
  ["lightyellow", 0xffffe0],
  ["lime", 0x00ff00],
  ["limegreen", 0x32cd32],
  ["linen", 0xfaf0e6],
  ["magenta", 0xff00ff],
  ["maroon", 0x800000],
  ["mediumaquamarine", 0x66cdaa],
  ["mediumblue", 0x0000cd],
  ["mediumorchid", 0xba55d3],
  ["mediumpurple", 0x9370db],
  ["mediumseagreen", 0x3cb371],
  ["mediumslateblue", 0x7b68ee],
  ["mediumspringgreen", 0x00fa9a],
  ["mediumturquoise", 0x48d1cc],
  ["mediumvioletred", 0xc71585],
  ["midnightblue", 0x191970],
  ["mintcream", 0xf5fffa],
  ["mistyrose", 0xffe4e1],
  ["moccasin", 0xffe4b5],
  ["navajowhite", 0xffdead],
  ["navy", 0x000080],
  ["oldlace", 0xfdf5e6],
  ["olive", 0x808000],
  ["olivedrab", 0x6b8e23],
  ["orange", 0xffa500],
  ["orangered", 0xff4500],
  ["orchid", 0xda70d6],
  ["palegoldenrod", 0xeee8aa],
  ["palegreen", 0x98fb98],
  ["paleturquoise", 0xafeeee],
  ["palevioletred", 0xdb7093],
  ["papayawhip", 0xffefd5],
  ["peachpuff", 0xffdab9],
  ["peru", 0xcd853f],
  ["pink", 0xffc0cb],
  ["plum", 0xdda0dd],
  ["powderblue", 0xb0e0e6],
  ["purple", 0x800080],
  ["rebeccapurple", 0x663399],
  ["red", 0xff0000],
  ["rosybrown", 0xbc8f8f],
  ["royalblue", 0x4169e1],
  ["saddlebrown", 0x8b4513],
  ["salmon", 0xfa8072],
  ["sandybrown", 0xf4a460],
  ["seagreen", 0x2e8b57],
  ["seashell", 0xfff5ee],
  ["sienna", 0xa0522d],
  ["silver", 0xc0c0c0],
  ["skyblue", 0x87ceeb],
  ["slateblue", 0x6a5acd],
  ["slategray", 0x708090],
  ["slategrey", 0x708090],
  ["snow", 0xfffafa],
  ["springgreen", 0x00ff7f],
  ["steelblue", 0x4682b4],
  ["tan", 0xd2b48c],
  ["teal", 0x008080],
  ["thistle", 0xd8bfd8],
  ["tomato", 0xff6347],
  ["turquoise", 0x40e0d0],
  ["violet", 0xee82ee],
  ["wheat", 0xf5deb3],
  ["white", 0xffffff],
  ["whitesmoke", 0xf5f5f5],
  ["yellow", 0xffff00],
  ["yellowgreen", 0x9acd32],
]);
