// I campioni dell'inchiostro e la loro quantizzazione (formato della scena, §5).
//
// Un tratto vive in due forme. Mentre nasce è una lista di `InkSample`: numeri
// del dispositivo, già in unità locali dell'elemento. Quando si conclude
// diventa `QuantizedInk`: gli interi che `fub:ink` conserva, cioè coordinate
// moltiplicate per la scala, pressione in 0…255, millisecondi e gradi. Il
// passaggio fra le due è qui e solo qui: il codec di `fub:ink` scrive e legge
// questi interi (con i delta calcolati sui valori già quantizzati), e `pf1`
// calcola il contorno dagli stessi interi, così chi ricalcola `d` dal file
// ottiene la stessa stringa di chi l'ha scritto.

import { roundHalfUp } from "../number";

/// Le scale di `fub:ink`: `s100` tiene l'errore entro 0,005 unità.
export type InkScale = 10 | 100;

/// La scala dei tratti nuovi.
export const DEFAULT_INK_SCALE: InkScale = 100;

/// Il massimo di campioni in un tratto; oltre, il tratto si divide (§5, §11).
export const INK_MAX_SAMPLES = 10_000;

/// Il fattore della pressione: `p = round(pressione × 255)`.
export const PRESSURE_STEPS = 255;

/// Inclinazione della penna, in gradi: altitudine `a` (0 = parallela al
/// foglio, 90 = perpendicolare) e azimut `z` (0…360, in senso orario
/// dall'asse x come in Pointer Events). Ci sono tutti e due o nessuno.
export type InkTilt =
  | { readonly a: number; readonly z: number }
  | { readonly a?: undefined; readonly z?: undefined };

/// Un campione come arriva dal dispositivo.
export type InkSample = {
  /// Coordinate locali dell'elemento, prima del suo `transform`.
  readonly x: number;
  readonly y: number;
  /// Pressione 0…1; assente per mouse e tocco, e allora il pennello la simula.
  readonly p?: number;
  /// Millisecondi dal primo campione del tratto, che vale 0.
  readonly t: number;
} & InkTilt;

/// Un campione come lo conserva `fub:ink`: tutti interi. `x` e `y` sono
/// moltiplicati per la scala, `p` sta in 0…255, `t` in millisecondi, `a` in
/// 0…90 e `z` in 0…359.
export type QuantizedSample = InkSample;

/// Un tratto quantizzato: ciò che il codec scrive in `fub:ink` e ciò da cui
/// `pf1` calcola `d`.
export interface QuantizedInk {
  readonly scale: InkScale;
  readonly samples: readonly QuantizedSample[];
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/// Il più grande valore di `fub:ink`, assoluto o differenza: oltre, un intero
/// non è più esatto in un `number` (formato della scena, §5).
export const INK_MAX_INTEGER = Number.MAX_SAFE_INTEGER;

function exact(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`campione d'inchiostro con ${what} oltre 2^53 - 1: ${value}`);
  return value;
}

/// `floor(v × scala + 0,5)`: una coordinata di `fub:ink`.
export function quantizeCoordinate(value: number, scale: InkScale): number {
  return exact(roundHalfUp(value, scale), "una coordinata");
}

/// La pressione in 0…255; un valore fuori da 0…1 si porta al bordo.
export function quantizePressure(pressure: number): number {
  return roundHalfUp(clamp(pressure, 0, 1), PRESSURE_STEPS);
}

/// I millisecondi interi.
export function quantizeTime(ms: number): number {
  return exact(roundHalfUp(ms, 1), "t");
}

/// L'altitudine in gradi interi, 0…90.
export function quantizeAltitude(degrees: number): number {
  return roundHalfUp(clamp(degrees, 0, 90), 1);
}

/// L'azimut in gradi interi, 0…359: 359,5 arrotonda a 360, che è 0.
export function quantizeAzimuth(degrees: number): number {
  // Il secondo modulo porta i negativi in 0…359 e non lascia mai un `-0`.
  return ((roundHalfUp(degrees, 1) % 360) + 360) % 360;
}

function finite(value: number, what: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`campione d'inchiostro con ${what} non finito: ${value}`);
  return value;
}

/// Un campione quantizzato. Lancia `RangeError` su un valore non finito: un
/// tratto con un buco non si scrive.
export function quantizeSample(sample: InkSample, scale: InkScale): QuantizedSample {
  const x = quantizeCoordinate(finite(sample.x, "x"), scale);
  const y = quantizeCoordinate(finite(sample.y, "y"), scale);
  const t = quantizeTime(finite(sample.t, "t"));
  const p = sample.p === undefined ? undefined : quantizePressure(finite(sample.p, "p"));
  if (sample.a === undefined) return p === undefined ? { x, y, t } : { x, y, p, t };
  const a = quantizeAltitude(finite(sample.a, "a"));
  const z = quantizeAzimuth(finite(sample.z, "z"));
  return p === undefined ? { x, y, t, a, z } : { x, y, p, t, a, z };
}

/// Il campione che un intero di `fub:ink` rappresenta, nelle unità del
/// dispositivo: la strada inversa, per ridisegnare e riprodurre.
export function dequantizeSample(sample: QuantizedSample, scale: InkScale): InkSample {
  const x = sample.x / scale;
  const y = sample.y / scale;
  const p = sample.p === undefined ? undefined : sample.p / PRESSURE_STEPS;
  const { t } = sample;
  if (sample.a === undefined) return p === undefined ? { x, y, t } : { x, y, p, t };
  return p === undefined ? { x, y, t, a: sample.a, z: sample.z } : { x, y, p, t, a: sample.a, z: sample.z };
}

/// Quantizza un tratto intero. I canali sono del tratto, non del campione:
/// `p` e l'inclinazione ci sono in ogni campione o in nessuno, il primo
/// campione ha `t = 0` e i campioni sono da 1 a `INK_MAX_SAMPLES`. Un tratto
/// che non rispetta queste regole lancia `RangeError` invece di diventare un
/// `fub:ink` che il formato rifiuterebbe.
export function quantizeInk(samples: readonly InkSample[], scale: InkScale = DEFAULT_INK_SCALE): QuantizedInk {
  if (samples.length === 0) throw new RangeError("un tratto ha almeno un campione");
  if (samples.length > INK_MAX_SAMPLES) {
    throw new RangeError(`un tratto ha al massimo ${INK_MAX_SAMPLES} campioni: ${samples.length}`);
  }
  const first = samples[0]!;
  if (first.t !== 0) throw new RangeError(`il primo campione ha t = 0, non ${first.t}`);
  const pressure = first.p !== undefined;
  const tilt = first.a !== undefined;
  const quantized: QuantizedSample[] = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    if ((sample.p !== undefined) !== pressure || (sample.a !== undefined) !== tilt) {
      throw new RangeError(`il campione ${i} ha canali diversi dal primo`);
    }
    const q = quantizeSample(sample, scale);
    // `fub:ink` scrive le differenze: anche quelle devono restare esatte.
    const previous = quantized[i - 1];
    if (previous !== undefined) {
      exact(q.x - previous.x, "una differenza di x");
      exact(q.y - previous.y, "una differenza di y");
      exact(q.t - previous.t, "una differenza di t");
    }
    quantized[i] = q;
  }
  return { scale, samples: quantized };
}
