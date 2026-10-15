// Il codec di `fub:ink` (formato della scena, §5): i campioni di un tratto
// come interi, il primo assoluto e gli altri in differenze dal precedente.
//
//     1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8
//
// È `ink.rs` di `fub-scene` riga per riga: stessa grammatica, stessi limiti,
// stessi errori nello stesso ordine, stesso testo in uscita. La scena letta
// da Rust e quella letta qui devono dire la stessa cosa di ogni tratto, S004
// compreso, e un tratto scritto da un lato si rilegge identico dall'altro.
//
// [`Ink`] tiene i valori assoluti, già quantizzati, in una riga sola: è la
// forma generale, che conserva anche i canali sconosciuti. `QuantizedInk` di
// `sample.ts` è la forma con i soli canali noti che usano la penna e `pf1`;
// [`inkFromQuantized`] e [`inkToQuantized`] passano dall'una all'altra.
//
// I valori sono `number` interi: ognuno, assoluto o differenza, sta entro
// ±(2⁵³ − 1), dove un `number` è esatto. Quando una somma o una differenza di
// due interi sicuri esce da quel limite il risultato arrotondato ne esce
// anch'esso, perché l'arrotondamento è monotono e 2⁵³ si rappresenta: il
// controllo sul `number` vale quanto quello di Rust sull'`i64`.

import {
  INK_MAX_INTEGER,
  INK_MAX_SAMPLES,
  InkError,
  quantizeInk,
  type InkSample,
  type InkScale,
  type QuantizedInk,
  type QuantizedSample,
} from "./sample";
import { utf8Length } from "../scene/text";

/// Quanti byte UTF-8 può avere un `fub:ink` (§5, §11).
export const INK_MAX_BYTES = 512 * 1024;

/// I canali che §5 conosce, nell'ordine in cui FubDraw li scrive. Ogni altra
/// lettera è un canale sconosciuto (S010).
export const KNOWN_CHANNELS = "xyptaz";

/// I campioni di un tratto, quantizzati e assoluti.
export interface Ink {
  readonly scale: InkScale;
  /// Le lettere dei canali, senza la `c` iniziale: `x` e `y` per prime.
  readonly channels: string;
  /// I valori assoluti, un campione dopo l'altro.
  readonly values: readonly number[];
}

const DIGITS = /^[0-9]+$/;
const LETTERS = /^[A-Za-z]+$/;

/// Un intero di `fub:ink`: `-` facoltativo, almeno una cifra ASCII, entro
/// ±(2⁵³ − 1). `null` se non è un intero, `Infinity` se è fuori dal limite.
function parseInteger(text: string): number | null {
  const digits = text.startsWith("-") ? text.slice(1) : text;
  if (!DIGITS.test(digits)) return null;
  // Gli zeri in testa non contano, e la grammatica li ammette.
  let from = 0;
  while (from < digits.length && digits.charCodeAt(from) === 0x30) from++;
  const significant = digits.slice(from);
  // Sedici cifre si leggono senza perdere l'ordine: un valore oltre il limite
  // arrotonda a un `number` oltre il limite.
  if (significant.length > 16) return Infinity;
  const magnitude = significant === "" ? 0 : Number(significant);
  if (magnitude > INK_MAX_INTEGER) return Infinity;
  // `-0` è `0`: lo stesso intero, scritto allo stesso modo.
  return text.startsWith("-") && magnitude !== 0 ? -magnitude : magnitude;
}

/// Controlla i canali: `x` e `y` per primi, lettere ASCII, nessuna ripetuta,
/// `a` e `z` insieme.
function checkChannels(channels: string): void {
  if (!channels.startsWith("xy") || !LETTERS.test(channels)) throw new InkError("channels");
  const seen = new Set<string>();
  for (const letter of channels) {
    if (seen.has(letter)) throw new InkError("channels");
    seen.add(letter);
  }
  if (seen.has("a") !== seen.has("z")) throw new InkError("tilt");
}

/// Gli intervalli dei canali noti e il `t` del primo campione.
function checkRanges(ink: Ink): void {
  const t = ink.channels.indexOf("t");
  if (t >= 0 && ink.values[t] !== 0) throw new InkError("first-time");
  const width = ink.channels.length;
  const count = ink.values.length / width;
  for (const [channel, max] of [["p", 255], ["a", 90], ["z", 359]] as const) {
    const j = ink.channels.indexOf(channel);
    if (j < 0) continue;
    for (let i = 0; i < count; i++) {
      const value = ink.values[i * width + j]!;
      if (!(value >= 0 && value <= max)) throw new InkError("range", i, channel);
    }
  }
}

/// Un inchiostro dai suoi valori assoluti, come `Ink::new`. Controlla i
/// canali, il numero dei campioni, gli intervalli dei canali noti e che ogni
/// valore e ogni differenza stia entro ±(2⁵³ − 1), cioè che il testo scritto
/// si possa rileggere. Un valore che non è un intero, che in Rust non si
/// potrebbe nemmeno scrivere, lancia `integer`; un infinito `overflow`.
export function createInk(scale: InkScale, channels: string, values: readonly number[]): Ink {
  checkChannels(channels);
  const width = channels.length;
  if (values.length === 0) throw new InkError("no-samples");
  if (values.length % width !== 0) throw new InkError("arity", Math.floor(values.length / width));
  const count = values.length / width;
  if (count > INK_MAX_SAMPLES) throw new InkError("too-many-samples");
  const copy = new Array<number>(values.length);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < width; j++) {
      const value = values[i * width + j]!;
      if (!Number.isInteger(value)) throw new InkError(Math.abs(value) === Infinity ? "overflow" : "integer", i);
      if (Math.abs(value) > INK_MAX_INTEGER) throw new InkError("overflow", i);
      if (i > 0 && !(Math.abs(value - values[(i - 1) * width + j]!) <= INK_MAX_INTEGER)) {
        throw new InkError("overflow", i);
      }
      copy[i * width + j] = value === 0 ? 0 : value;
    }
  }
  const ink: Ink = { scale, channels, values: copy };
  checkRanges(ink);
  return ink;
}

/// Legge un `fub:ink`. Lancia `InkError`.
export function decodeInk(text: string): Ink {
  // Il limite è in byte, come in Rust: si misura solo quando le unità UTF-16
  // potrebbero già superarlo, perché un byte non è mai meno di un'unità.
  if (text.length > INK_MAX_BYTES / 3 && utf8Length(text) > INK_MAX_BYTES) throw new InkError("too-large");
  const parts = text.split(" ");
  const [version, scaleToken, channelToken] = parts;
  if (version === undefined || scaleToken === undefined || channelToken === undefined) {
    throw new InkError("syntax");
  }
  if (version === "" || scaleToken === "" || channelToken === "") throw new InkError("syntax");
  if (version !== "1") throw new InkError("version");
  let scale: InkScale;
  if (scaleToken === "s10") scale = 10;
  else if (scaleToken === "s100") scale = 100;
  else throw new InkError("scale");
  if (!channelToken.startsWith("c")) throw new InkError("channels");
  const channels = channelToken.slice(1);
  checkChannels(channels);
  const width = channels.length;
  const values: number[] = [];
  for (let i = 0; i + 3 < parts.length; i++) {
    if (i === INK_MAX_SAMPLES) throw new InkError("too-many-samples");
    const sample = parts[i + 3]!;
    if (sample === "") throw new InkError("syntax");
    const fields = sample.split(",");
    for (let j = 0; j < fields.length; j++) {
      if (j === width) throw new InkError("arity", i);
      const value = parseInteger(fields[j]!);
      if (value === null) throw new InkError("integer", i);
      if (value === Infinity) throw new InkError("overflow", i);
      const absolute = i === 0 ? value : values[(i - 1) * width + j]! + value;
      if (Math.abs(absolute) > INK_MAX_INTEGER) throw new InkError("overflow", i);
      values.push(absolute === 0 ? 0 : absolute);
    }
    if (fields.length !== width) throw new InkError("arity", i);
  }
  if (values.length === 0) throw new InkError("no-samples");
  const ink: Ink = { scale, channels, values };
  checkRanges(ink);
  return ink;
}

/// Scrive il `fub:ink` canonico: il primo campione assoluto, gli altri in
/// differenze. Il testo può superare [`INK_MAX_BYTES`]: chi scrive divide il
/// tratto prima (§5).
export function encodeInk(ink: Ink): string {
  const { channels, values } = ink;
  const width = channels.length;
  const parts: string[] = [`1 s${ink.scale} c${channels}`];
  for (let i = 0; i * width < values.length; i++) {
    const fields = new Array<string>(width);
    for (let j = 0; j < width; j++) {
      const value = values[i * width + j]!;
      const delta = i === 0 ? value : value - values[(i - 1) * width + j]!;
      // Un intero sicuro si scrive in cifre, senza esponente; `-0` come `0`.
      fields[j] = String(delta === 0 ? 0 : delta);
    }
    parts.push(fields.join(","));
  }
  return parts.join(" ");
}

/// Quantizza i campioni del dispositivo e ne fa un inchiostro, come
/// `Ink::quantize`: la regola è quella di [`quantizeInk`].
export function inkFromSamples(samples: readonly InkSample[], scale: InkScale): Ink {
  return inkFromQuantized(quantizeInk(samples, scale));
}

/// L'inchiostro di un tratto quantizzato: i canali sono quelli del primo
/// campione, nell'ordine `x y p t a z`.
export function inkFromQuantized(ink: QuantizedInk): Ink {
  const first = ink.samples[0];
  if (first === undefined) throw new InkError("no-samples");
  const pressure = first.p !== undefined;
  const tilt = first.a !== undefined;
  const channels = `xy${pressure ? "p" : ""}t${tilt ? "az" : ""}`;
  const values: number[] = [];
  for (let i = 0; i < ink.samples.length; i++) {
    const sample = ink.samples[i]!;
    if ((sample.p !== undefined) !== pressure || (sample.a !== undefined) !== tilt) {
      throw new InkError("mixed-channels", i);
    }
    values.push(sample.x, sample.y);
    if (sample.p !== undefined) values.push(sample.p);
    values.push(sample.t);
    if (sample.a !== undefined) values.push(sample.a, sample.z);
  }
  return createInk(ink.scale, channels, values);
}

/// I campioni noti di un inchiostro, nella forma che usano la penna e `pf1`.
/// I canali sconosciuti restano fuori: chi ridisegna controlla prima
/// [`unknownChannels`] (S010). Senza il canale `t`, che la grammatica non
/// rende obbligatorio, ogni campione ha `t = 0`: `pf1` non legge il tempo.
export function inkToQuantized(ink: Ink): QuantizedInk {
  const column = (letter: string): number => ink.channels.indexOf(letter);
  const [p, t, a, z] = [column("p"), column("t"), column("a"), column("z")];
  const width = ink.channels.length;
  const samples: QuantizedSample[] = [];
  for (let i = 0; i * width < ink.values.length; i++) {
    const row = i * width;
    const x = ink.values[row]!;
    const y = ink.values[row + 1]!;
    const time = t < 0 ? 0 : ink.values[row + t]!;
    const pressure = p < 0 ? undefined : ink.values[row + p]!;
    if (a < 0) {
      samples.push(pressure === undefined ? { x, y, t: time } : { x, y, p: pressure, t: time });
    } else {
      const tilt = { a: ink.values[row + a]!, z: ink.values[row + z]! };
      samples.push(pressure === undefined ? { x, y, t: time, ...tilt } : { x, y, p: pressure, t: time, ...tilt });
    }
  }
  return { scale: ink.scale, samples };
}

/// Il numero di campioni.
export function inkLength(ink: Ink): number {
  return ink.values.length / ink.channels.length;
}

/// I valori assoluti del campione `i`, nell'ordine dei canali.
export function inkSample(ink: Ink, i: number): readonly number[] {
  const width = ink.channels.length;
  return ink.values.slice(i * width, (i + 1) * width);
}

/// La colonna del canale `letter`, o `null` se manca.
export function inkChannel(ink: Ink, letter: string): number | null {
  const column = ink.channels.indexOf(letter);
  return column < 0 ? null : column;
}

/// Il punto del campione `i` in unità locali: gli interi divisi per la scala.
export function inkPoint(ink: Ink, i: number): readonly [number, number] {
  const row = i * ink.channels.length;
  return [ink.values[row]! / ink.scale, ink.values[row + 1]! / ink.scale];
}

/// I canali che §5 non conosce, nell'ordine in cui compaiono: un tratto che
/// ne ha non si ridisegna (S010).
export function unknownChannels(ink: Ink): string {
  let unknown = "";
  for (const letter of ink.channels) if (!KNOWN_CHANNELS.includes(letter)) unknown += letter;
  return unknown;
}

/// La durata in millisecondi: il `t` dell'ultimo campione, o `null` senza il
/// canale `t`.
export function inkDuration(ink: Ink): number | null {
  const t = ink.channels.indexOf("t");
  if (t < 0) return null;
  return ink.values[ink.values.length - ink.channels.length + t]!;
}
