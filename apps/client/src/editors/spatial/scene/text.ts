// Il testo della sorgente: BOM, terminatori di riga e le due coordinate degli
// span (formato della scena, §2).
//
// Una scena ha due lettori di offset. Il provider e l'indice di Fub parlano in
// byte UTF-8 sul file intero, BOM compreso; la superficie parla in unità
// UTF-16 sul testo normalizzato a LF, come la `DocumentSession`: il BOM è un
// carattere (`U+FEFF`, un'unità) e ogni `\r\n` o `\r` diventa un solo `\n`. È
// la regola di `fub-scene` (`text.rs`), e uno span porta tutte e due.
//
// Qui la sorgente è una stringa JavaScript, e il lettore la scorre per indici
// UTF-16 grezzi: [`SourceText`] li traduce nelle due coordinate. Tiene solo le
// posizioni dei caratteri non ASCII e dei `\r\n`, così un file ASCII con LF
// non costa memoria in più e una traduzione è una ricerca binaria.

import { commonPrefixLength, commonSuffixLength } from "../../core/text-operation";

/// Il BOM UTF-8 come carattere.
export const BOM = "﻿";

/// Con che terminatore va a capo un file, come `Newline` di `fub-abi`.
export type LineEnding = "lf" | "crlf" | "cr" | "mixed";

/// Un intervallo semiaperto `[from, to)` nelle due coordinate: `bytes` sono
/// byte UTF-8 sul file intero, BOM compreso; `utf16` sono unità UTF-16 sul
/// testo normalizzato a LF, BOM compreso.
export interface Span {
  readonly bytes: readonly [number, number];
  readonly utf16: readonly [number, number];
}

/// Quante unità UTF-16 occupa il BOM in testa a `source`: `1` oppure `0`.
export function bomUnits(source: string): number {
  return source.charCodeAt(0) === 0xfeff ? 1 : 0;
}

/// Quanti byte occupa `text` in UTF-8. Un surrogato isolato vale i tre byte di
/// `U+FFFD`, come lo scrive `TextEncoder`.
export function utf8Length(text: string): number {
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) {
      bytes += 1;
    } else if (c >= 0xd800 && c <= 0xdbff && isLow(text.charCodeAt(i + 1))) {
      // Quattro byte per due unità.
      bytes += 2;
      i++;
    } else {
      bytes += 2;
    }
  }
  return bytes;
}

/// Di quanti byte UTF-8 cambia `before` diventando `after`. Si misura solo
/// ciò che sta fra il prefisso e il suffisso comuni, che si trovano con un
/// confronto nativo: il conto costa quanto la modifica, non quanto il file.
/// I bordi non tagliano una coppia surrogata, così ogni parte vale da sola
/// quanto vale nel testo intero.
export function utf8Delta(before: string, after: string): number {
  if (before === after) return 0;
  const minimum = Math.min(before.length, after.length);
  let prefix = commonPrefixLength(before, after, minimum);
  let suffix = commonSuffixLength(before, after, minimum - prefix);
  if (prefix > 0 && isHigh(before.charCodeAt(prefix - 1))) prefix--;
  if (suffix > 0 && isLow(before.charCodeAt(before.length - suffix))) suffix--;
  return utf8Length(after.slice(prefix, after.length - suffix)) - utf8Length(before.slice(prefix, before.length - suffix));
}

function isHigh(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}

function isLow(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

/// Quanti `\r\n`, `\n` soli e `\r` soli contiene `source`.
function counts(source: string): [crlf: number, lf: number, cr: number] {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = source.indexOf("\r"); i >= 0; i = source.indexOf("\r", i + 1)) {
    if (source.charCodeAt(i + 1) === 0x0a) crlf++;
    else cr++;
  }
  for (let i = source.indexOf("\n"); i >= 0; i = source.indexOf("\n", i + 1)) lf++;
  return [crlf, lf - crlf, cr];
}

/// I terminatori che `source` usa davvero.
export function lineEndingOf(source: string): LineEnding {
  const [crlf, lf, cr] = counts(source);
  if (crlf > 0 && lf === 0 && cr === 0) return "crlf";
  if (crlf === 0 && lf === 0 && cr > 0) return "cr";
  if (crlf === 0 && cr === 0) return "lf";
  return "mixed";
}

/// Il terminatore di una riga nuova dentro `source`: il più frequente; a pari
/// conteggio `\r\n`, poi `\n`; `\n` se non ce n'è nessuno. Non risponde mai
/// `mixed`.
export function lineBreakOf(source: string): Exclude<LineEnding, "mixed"> {
  const [crlf, lf, cr] = counts(source);
  if (crlf === 0 && lf === 0 && cr === 0) return "lf";
  if (crlf >= lf && crlf >= cr) return "crlf";
  return lf >= cr ? "lf" : "cr";
}

/// Il testo di un terminatore.
export function newline(ending: Exclude<LineEnding, "mixed">): string {
  return ending === "crlf" ? "\r\n" : ending === "cr" ? "\r" : "\n";
}

/// Il testo che vede la shell: `\r\n` e `\r` diventano `\n`.
export function normalizeEol(text: string): string {
  return text.indexOf("\r") < 0 ? text : text.replace(/\r\n?/g, "\n");
}

/// L'ultimo indice di `sorted` con valore minore di `value`, più uno: quanti
/// valori stanno prima di `value`.
function countBelow(sorted: Int32Array, length: number, value: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/// Una sorgente con le sue coordinate: indici UTF-16 grezzi, byte UTF-8 e
/// unità UTF-16 sul testo a LF.
export class SourceText {
  readonly text: string;
  /// I byte UTF-8 del file intero.
  readonly byteLength: number;
  /// L'indice di ogni carattere non ASCII, in ordine.
  private readonly wide: Int32Array;
  /// I byte in più delle unità fino a quel carattere compreso.
  private readonly extra: Int32Array;
  private readonly wideCount: number;
  /// L'indice di ogni `\r` seguito da `\n`.
  private readonly crlf: Int32Array;
  private readonly crlfCount: number;
  /// L'inizio di ogni riga, calcolato alla prima richiesta di un rientro.
  private lineStarts: Int32Array | null = null;
  private lineCount = 0;

  constructor(text: string) {
    this.text = text;
    let wide = new Int32Array(16);
    let extra = new Int32Array(16);
    let count = 0;
    let total = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80) continue;
      const start = i;
      if (c < 0x800) {
        total += 1;
      } else {
        // Tre byte per un'unità, o quattro per due.
        total += 2;
        if (c >= 0xd800 && c <= 0xdbff && isLow(text.charCodeAt(i + 1))) i++;
      }
      if (count === wide.length) {
        wide = grow(wide);
        extra = grow(extra);
      }
      wide[count] = start;
      extra[count] = total;
      count++;
    }
    this.wide = wide;
    this.extra = extra;
    this.wideCount = count;
    this.byteLength = text.length + total;

    let crlf = new Int32Array(16);
    let pairs = 0;
    for (let i = text.indexOf("\r\n"); i >= 0; i = text.indexOf("\r\n", i + 2)) {
      if (pairs === crlf.length) crlf = grow(crlf);
      crlf[pairs++] = i;
    }
    this.crlf = crlf;
    this.crlfCount = pairs;
  }

  /// Il byte UTF-8 dell'indice UTF-16 grezzo `index`.
  byteOf(index: number): number {
    const k = countBelow(this.wide, this.wideCount, index);
    return index + (k === 0 ? 0 : this.extra[k - 1]!);
  }

  /// L'offset UTF-16 sul testo a LF dell'indice grezzo `index`. Un indice fra
  /// `\r` e `\n` vale quanto quello prima del `\r`: nel testo a LF la coppia è
  /// un carattere solo.
  lfOffset(index: number): number {
    return index - countBelow(this.crlf, this.crlfCount, index);
  }

  /// Lo span degli indici grezzi `[from, to)`.
  span(from: number, to: number): Span {
    return {
      bytes: [this.byteOf(from), this.byteOf(to)],
      utf16: [this.lfOffset(from), this.lfOffset(to)],
    };
  }

  /// L'indice grezzo dell'offset `offset` sul testo a LF: il contrario di
  /// [`lfOffset`], che cade sempre prima di un `\r\n`.
  rawOf(offset: number): number {
    // Fra le coppie prima dell'indice grezzo ce ne sono k quando
    // crlf[k-1] - (k-1) < offset: l'offset a LF di ogni `\r` è crescente.
    let lo = 0;
    let hi = this.crlfCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.crlf[mid]! - mid < offset) lo = mid + 1;
      else hi = mid;
    }
    return offset + lo;
  }

  /// Il rientro della riga su cui comincia l'indice `index`: gli spazi e le
  /// tabulazioni in testa alla riga, fino a `index` al più. La prima riga
  /// comincia dopo il BOM; un `\r` da solo va a capo.
  indent(index: number): string {
    const starts = this.lines();
    let lo = 0;
    let hi = this.lineCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (starts[mid]! <= index) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.min(starts[Math.max(lo - 1, 0)]!, index);
    let end = start;
    while (end < index) {
      const c = this.text.charCodeAt(end);
      if (c !== 0x20 && c !== 0x09) break;
      end++;
    }
    return this.text.slice(start, end);
  }

  private lines(): Int32Array {
    if (this.lineStarts !== null) return this.lineStarts;
    const text = this.text;
    let starts = new Int32Array(64);
    let count = 0;
    starts[count++] = bomUnits(text);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 0x0a || (c === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) {
        if (count === starts.length) starts = grow(starts);
        starts[count++] = i + 1;
      }
    }
    this.lineStarts = starts;
    this.lineCount = count;
    return starts;
  }
}

function grow(array: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
  const bigger = new Int32Array(array.length * 2);
  bigger.set(array);
  return bigger;
}
