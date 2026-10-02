// Il pennello `pf1` e la sua scrittura in `fub:brush` (formato della scena, §5).
//
// `pf1` è `getStroke` di perfect-freehand 1.2.3 con le opzioni scritte nel
// pennello: `pf1 size=4 thinning=0.5 … sim=0`. La grammatica, gli intervalli e
// i valori di chi manca stanno qui, una volta: li usano il calcolo di `d`, la
// validazione delle operazioni e la diagnostica S004.
//
// Lettura. Dopo `pf1` vengono coppie `chiave=valore` separate da spazi; la
// prima `=` separa la chiave dal valore. Una chiave nota ripetuta, una voce
// senza `=`, un numero fuori dalla grammatica dei numeri SVG o fuori
// dall'intervallo rendono il pennello non valido (S004). Una chiave nota che
// manca vale quanto l'opzione omessa di `getStroke`, perché `pf1` è quella
// funzione con quelle opzioni. Le chiavi sconosciute si conservano, nell'ordine,
// e non cambiano il disegno.
//
// Scrittura. Le chiavi note nell'ordine della specifica, tutte, poi le
// sconosciute. I numeri si scrivono con `formatShortest`, senza arrotondare:
// `d` si calcola dal pennello, e il pennello riletto dal file deve essere lo
// stesso numero per numero.

import { formatShortest } from "../number";

/// Le opzioni di `pf1`, già lette e validate.
export interface Pf1Brush {
  /// Spessore di base in unità (il diametro di perfect-freehand), > 0.
  readonly size: number;
  /// Effetto della pressione sullo spessore, −1…1.
  readonly thinning: number;
  /// Morbidezza del contorno, 0…1.
  readonly smoothing: number;
  /// Quanto il tratto insegue la penna in ritardo, 0…1.
  readonly streamline: number;
  /// Assottigliamento all'inizio e alla fine, in unità; 0 = nessuno.
  readonly taperStart: number;
  readonly taperEnd: number;
  /// Estremità arrotondate.
  readonly capStart: boolean;
  readonly capEnd: boolean;
  /// Pressione simulata dalla velocità invece di quella del campione.
  readonly sim: boolean;
  /// Le coppie che `pf1` non conosce, conservate nell'ordine in cui erano.
  readonly unknown: readonly BrushEntry[];
}

export type BrushEntry = readonly [key: string, value: string];

/// Il nome dell'algoritmo, prima parola di ogni `fub:brush` che FubDraw ridisegna.
export const PF1 = "pf1";

/// Le chiavi note, nell'ordine in cui si scrivono.
export const PF1_KEYS = [
  "size",
  "thinning",
  "smoothing",
  "streamline",
  "taperStart",
  "taperEnd",
  "capStart",
  "capEnd",
  "sim",
] as const;

export type Pf1Key = (typeof PF1_KEYS)[number];

/// I valori di una chiave che manca: quelli di `getStroke` di perfect-freehand
/// 1.2.3 quando l'opzione non c'è (dal sorgente, non dal README, che per
/// `size` dice 8 mentre il codice usa 16).
export const PF1_DEFAULTS: Pf1Brush = {
  size: 16,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  taperStart: 0,
  taperEnd: 0,
  capStart: true,
  capEnd: true,
  sim: true,
  unknown: [],
};

const KNOWN = new Set<string>(PF1_KEYS);
/// Un numero SVG senza unità: segno, cifre con o senza decimali, esponente.
const SVG_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/// Gli spazi di XML: dentro un attributo li separano tutti allo stesso modo.
const SEPARATOR = /[ \t\n\r]+/;
const ENTRY_KEY = /^[^ \t\n\r=]+$/;
const ENTRY_VALUE = /^[^ \t\n\r]+$/;

function inRange(key: Pf1Key, value: number, min: number, max: number): void {
  if (!(value >= min && value <= max)) {
    throw new RangeError(`fub:brush: ${key} fuori dall'intervallo ${min}…${max}: ${value}`);
  }
}

function flag(key: Pf1Key, value: boolean): void {
  if (typeof value !== "boolean") throw new RangeError(`fub:brush: ${key} vale 0 o 1`);
}

/// Lancia `RangeError` se il pennello esce dagli intervalli di §5 o se una
/// chiave sconosciuta non si potrebbe rileggere.
export function checkBrush(brush: Pf1Brush): void {
  if (!(Number.isFinite(brush.size) && brush.size > 0)) {
    throw new RangeError(`fub:brush: size deve essere un numero maggiore di 0: ${brush.size}`);
  }
  inRange("thinning", brush.thinning, -1, 1);
  inRange("smoothing", brush.smoothing, 0, 1);
  inRange("streamline", brush.streamline, 0, 1);
  inRange("taperStart", brush.taperStart, 0, Number.MAX_VALUE);
  inRange("taperEnd", brush.taperEnd, 0, Number.MAX_VALUE);
  flag("capStart", brush.capStart);
  flag("capEnd", brush.capEnd);
  flag("sim", brush.sim);
  // Una sconosciuta ripetuta si conserva com'è: non è di `pf1` decidere quale
  // delle due conti.
  for (const [key, value] of brush.unknown) {
    if (!ENTRY_KEY.test(key) || KNOWN.has(key)) {
      throw new RangeError(`fub:brush: chiave sconosciuta non scrivibile: ${JSON.stringify(key)}`);
    }
    if (!ENTRY_VALUE.test(value)) {
      throw new RangeError(`fub:brush: valore non scrivibile per ${key}: ${JSON.stringify(value)}`);
    }
  }
}

function numberOf(key: Pf1Key, text: string): number {
  // `Number` accetterebbe anche `0x10`, `Infinity` e lo spazio vuoto: la
  // grammatica la decide la specifica, non il motore.
  if (!SVG_NUMBER.test(text)) throw new TypeError(`fub:brush: ${key} non è un numero: ${JSON.stringify(text)}`);
  const value = Number(text);
  if (!Number.isFinite(value)) throw new RangeError(`fub:brush: ${key} non è finito: ${text}`);
  return value;
}

function flagOf(key: Pf1Key, text: string): boolean {
  const value = numberOf(key, text);
  if (value !== 0 && value !== 1) throw new RangeError(`fub:brush: ${key} vale 0 o 1, non ${text}`);
  return value === 1;
}

/// Legge un `fub:brush`. Lancia `TypeError` sulla grammatica e `RangeError`
/// sugli intervalli: in tutti e due i casi il tratto non si ridisegna (S004).
export function parseBrush(text: string): Pf1Brush {
  const tokens = text.split(SEPARATOR).filter((token) => token !== "");
  if (tokens[0] !== PF1) throw new TypeError("fub:brush non comincia con pf1");
  const known = new Map<Pf1Key, string>();
  const unknown: BrushEntry[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    const equals = token.indexOf("=");
    if (equals <= 0 || equals === token.length - 1) {
      throw new TypeError(`fub:brush: voce senza chiave=valore: ${JSON.stringify(token)}`);
    }
    const key = token.slice(0, equals);
    const value = token.slice(equals + 1);
    if (KNOWN.has(key)) {
      const name = key as Pf1Key;
      if (known.has(name)) throw new TypeError(`fub:brush: ${key} ripetuta`);
      known.set(name, value);
    } else {
      unknown.push([key, value]);
    }
  }
  const read = (key: Pf1Key, fallback: number): number => {
    const value = known.get(key);
    return value === undefined ? fallback : numberOf(key, value);
  };
  const readFlag = (key: Pf1Key, fallback: boolean): boolean => {
    const value = known.get(key);
    return value === undefined ? fallback : flagOf(key, value);
  };
  const brush: Pf1Brush = {
    size: read("size", PF1_DEFAULTS.size),
    thinning: read("thinning", PF1_DEFAULTS.thinning),
    smoothing: read("smoothing", PF1_DEFAULTS.smoothing),
    streamline: read("streamline", PF1_DEFAULTS.streamline),
    taperStart: read("taperStart", PF1_DEFAULTS.taperStart),
    taperEnd: read("taperEnd", PF1_DEFAULTS.taperEnd),
    capStart: readFlag("capStart", PF1_DEFAULTS.capStart),
    capEnd: readFlag("capEnd", PF1_DEFAULTS.capEnd),
    sim: readFlag("sim", PF1_DEFAULTS.sim),
    unknown,
  };
  checkBrush(brush);
  return brush;
}

/// Scrive un `fub:brush` canonico. Lancia `RangeError` su un pennello fuori
/// dagli intervalli: non si scrive ciò che poi non si potrebbe ridisegnare.
export function formatBrush(brush: Pf1Brush): string {
  checkBrush(brush);
  const bit = (value: boolean): string => (value ? "1" : "0");
  let text = `${PF1} size=${formatShortest(brush.size)}`
    + ` thinning=${formatShortest(brush.thinning)}`
    + ` smoothing=${formatShortest(brush.smoothing)}`
    + ` streamline=${formatShortest(brush.streamline)}`
    + ` taperStart=${formatShortest(brush.taperStart)}`
    + ` taperEnd=${formatShortest(brush.taperEnd)}`
    + ` capStart=${bit(brush.capStart)} capEnd=${bit(brush.capEnd)} sim=${bit(brush.sim)}`;
  for (const [key, value] of brush.unknown) text += ` ${key}=${value}`;
  return text;
}

/// Il pennello di un tratto: senza il canale `p` (mouse, tocco) la pressione
/// è simulata, e `fub:brush` lo dice con `sim=1` (§5).
export function brushForInput(brush: Pf1Brush, pressure: boolean): Pf1Brush {
  return pressure || brush.sim ? brush : { ...brush, sim: true };
}
