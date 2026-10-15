// «Ricalca immagine» (livello Esperto), dai pixel alle etichette: a ogni
// pixel il colore che il ricalco gli dà, o nessuno, e fra due pixel vicini
// il punto dove passa il bordo. Senza DOM: gira nel worker del ricalco e
// nei test.
//
// - **L'inchiostro** (bianco e nero, schizzo) è ciò che è più scuro della
//   soglia, guardato sopra il bianco: un logo nero su un fondo trasparente
//   ha i bordi grigi come su carta. La soglia di partenza del bianco e nero
//   è a metà fra gli scuri e i chiari dell'immagine; quella dello
//   schizzo è relativa alla carta lì attorno (Bradley), così un foglio
//   fotografato con un'ombra resta carta.
// - **I colori** (pochi colori, foto) sono una tavolozza scelta con le
//   k-medie nello spazio OKLab, dove le distanze sono quelle che l'occhio
//   vede. I pixel dei bordi, mescolati dall'antialiasing, pesano poco: non
//   diventano un colore loro. Due colori che l'occhio non distingue sono
//   uno. Un pixel trasparente non ha colore.
// - **Il bordo fra due pixel** passa dove il loro colore è a metà fra i due
//   colori della tavolozza, misurato in sRGB, dove l'antialiasing mescola:
//   un bordo morbido dà un contorno al decimo di pixel, non a scalini.
// - **Un'immagine grande** si rimpicciolisce prima, con la media dei pixel
//   che ogni nuovo pixel copre; **una foto** si ammorbidisce appena, perché
//   il rumore dei suoi pixel non diventi macchie.

/// I pixel di un'immagine: RGBA, una riga dopo l'altra dall'alto, senza
/// premoltiplicare l'alfa, come li dà `getImageData`.
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/// L'etichetta di un pixel trasparente.
export const CLEAR = -1;

/// L'alfa sotto la quale un pixel è trasparente.
const OPAQUE = 128;

/// Un colore sRGB, coi canali da 0 a 255.
export type Rgb = readonly [number, number, number];

/// I pixel fatti etichette: l'indice del colore di ogni pixel nella
/// tavolozza, o [`CLEAR`].
export interface Labeled {
  readonly width: number;
  readonly height: number;
  readonly labels: Int16Array;
  /// I colori della tavolozza.
  readonly palette: readonly Rgb[];
  /// Per ogni colore, se il ricalco lo dipinge: il bianco ignorato e la
  /// carta no.
  readonly painted: readonly boolean[];
  /// Come si tengono insieme i pixel dipinti: anche in diagonale, per
  /// l'inchiostro, dove una linea sottile obliqua resta una; altrimenti
  /// solo di lato, e la diagonale va a ciò che non è dipinto.
  readonly diagonal: boolean;
  /// Dove passa il bordo fra il centro del pixel `p`, dentro, col colore
  /// `a`, e quello del pixel vicino `q`, fuori, col colore `b` o
  /// [`CLEAR`], da 0 a 1; a metà se i pixel non lo dicono. I colori sono
  /// quelli che i pixel hanno alla fine, dopo che il rumore è sparito.
  crossing(p: number, q: number, a: number, b: number): number;
}

// --- La risoluzione di lavoro ----------------------------------------------

/// I pixel su cui il ricalco lavora, al più: un foglio A4 a 170 dpi, e una
/// foto ricalcata in meno di un secondo.
export const WORK_PIXELS = 2_000_000;

/// Per ogni pixel di un lato lungo `to`, quelli del lato lungo `from` che
/// copre: il primo, e quanto pesa ciascuno.
function spans(from: number, to: number): { readonly first: Int32Array; readonly weights: Float64Array[] } {
  const ratio = from / to;
  const first = new Int32Array(to);
  const weights: Float64Array[] = [];
  for (let x = 0; x < to; x++) {
    const [s0, s1] = [x * ratio, (x + 1) * ratio];
    const [a, b] = [Math.floor(s0), Math.min(from, Math.ceil(s1))];
    const row = new Float64Array(b - a);
    for (let s = a; s < b; s++) row[s - a] = (Math.min(s1, s + 1) - Math.max(s0, s)) / ratio;
    first[x] = a;
    weights.push(row);
  }
  return { first, weights };
}

/// I pixel con l'alfa moltiplicato nei colori: le medie fatte così non
/// prendono il colore dei pixel trasparenti.
function premultiplied({ data }: Raster): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    out[i] = data[i]! * a;
    out[i + 1] = data[i + 1]! * a;
    out[i + 2] = data[i + 2]! * a;
    out[i + 3] = data[i + 3]!;
  }
  return out;
}

function unpremultiplied(pixels: Float32Array, width: number, height: number): Raster {
  const data = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]!;
    if (a <= 0) continue;
    const f = 255 / a;
    data[i] = pixels[i]! * f;
    data[i + 1] = pixels[i + 1]! * f;
    data[i + 2] = pixels[i + 2]! * f;
    data[i + 3] = a;
  }
  return { width, height, data };
}

/// `pixels`, di `width` per `height`, con ogni riga fatta di `columns`
/// pixel: per ognuno la media pesata da `spans`.
function across(pixels: Float32Array, width: number, height: number, { first, weights }: ReturnType<typeof spans>): Float32Array {
  const columns = first.length;
  const out = new Float32Array(columns * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < columns; x++) {
      const row = weights[x]!;
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let k = 0, at = (y * width + first[x]!) * 4; k < row.length; k++, at += 4) {
        const w = row[k]!;
        r += w * pixels[at]!;
        g += w * pixels[at + 1]!;
        b += w * pixels[at + 2]!;
        a += w * pixels[at + 3]!;
      }
      const o = (y * columns + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return out;
}

/// `pixels`, di `width` per `height`, con `rows` righe: ognuna la media
/// delle righe pesate da `spans`.
function down(pixels: Float32Array, width: number, { first, weights }: ReturnType<typeof spans>): Float32Array {
  const stride = width * 4;
  const out = new Float32Array(first.length * stride);
  for (let y = 0; y < first.length; y++) {
    const row = weights[y]!;
    for (let k = 0; k < row.length; k++) {
      const w = row[k]!;
      const from = (first[y]! + k) * stride;
      for (let i = 0; i < stride; i++) out[y * stride + i]! += w * pixels[from + i]!;
    }
  }
  return out;
}

/// Gli ultimi pixel rimpiccioliti di ogni immagine, col limite: l'anteprima
/// ricalca molte volte la stessa.
const workingCache = new WeakMap<Raster, { readonly limit: number; readonly raster: Raster }>();

/// `raster` rimpicciolito a non più di [`WORK_PIXELS`] pixel, con le sue
/// proporzioni; `raster` stesso se ci sta già.
export function working(raster: Raster, maxPixels = WORK_PIXELS): Raster {
  const { width, height } = raster;
  if (width * height <= maxPixels) return raster;
  const cached = workingCache.get(raster);
  if (cached?.limit === maxPixels) return cached.raster;
  const f = Math.sqrt(maxPixels / (width * height));
  const [w, h] = [Math.max(1, Math.floor(width * f)), Math.max(1, Math.floor(height * f))];
  const pixels = down(across(premultiplied(raster), width, height, spans(width, w)), w, spans(height, h));
  const out = unpremultiplied(pixels, w, h);
  workingCache.set(raster, { limit: maxPixels, raster: out });
  return out;
}

const softCache = new WeakMap<Raster, { readonly sigma: number; readonly raster: Raster }>();

/// `raster` sfocato con una gaussiana di deviazione `sigma` pixel; ai
/// bordi i pixel di fuori sono quelli del bordo.
export function softened(raster: Raster, sigma: number): Raster {
  const cached = softCache.get(raster);
  if (cached?.sigma === sigma) return cached.raster;
  const { width, height } = raster;
  const radius = Math.ceil(3 * sigma);
  const kernel = Float64Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const total = kernel.reduce((a, b) => a + b, 0);
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= total;
  const pre = premultiplied(raster);
  const mid = new Float32Array(pre.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let k = -radius; k <= radius; k++) {
        const w = kernel[k + radius]!;
        const at = (y * width + Math.min(width - 1, Math.max(0, x + k))) * 4;
        mid[o]! += w * pre[at]!;
        mid[o + 1]! += w * pre[at + 1]!;
        mid[o + 2]! += w * pre[at + 2]!;
        mid[o + 3]! += w * pre[at + 3]!;
      }
    }
  }
  const out = new Float32Array(pre.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    for (let k = -radius; k <= radius; k++) {
      const w = kernel[k + radius]!;
      const from = Math.min(height - 1, Math.max(0, y + k)) * stride;
      for (let i = 0; i < stride; i++) out[y * stride + i]! += w * mid[from + i]!;
    }
  }
  const soft = unpremultiplied(out, width, height);
  softCache.set(raster, { sigma, raster: soft });
  return soft;
}

// --- Luminosità e soglie -----------------------------------------------------

/// La luminosità di ogni pixel guardato sopra il bianco, da 0 a 255, coi
/// pesi di Rec. 709 sui valori sRGB: lineare nei canali, come
/// l'antialiasing li mescola.
export function lumaOf({ width, height, data }: Raster): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const a = data[i * 4 + 3]! / 255;
    const y = 0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!;
    out[i] = y * a + 255 * (1 - a);
  }
  return out;
}

/// Quanti valori attorno a ciascuno contano per dire il livello più
/// comune, da una parte e dall'altra: il rumore di una scansione allarga i
/// picchi.
const LEVEL_SPREAD = 3;

/// La soglia fra i chiari e gli scuri, che stanno sotto: a metà fra il
/// livello più comune degli scuri e quello dei chiari, divisi dove le medie
/// delle due parti, pesate per quanti pixel hanno, sono più diverse
/// (Otsu). Lì passa il bordo di un tratto con l'antialiasing, e di un
/// inchiostro grigio su una carta grigia: i grigi dei bordi spostano le
/// medie, e la soglia di Otsu, non i livelli. 128 per un'immagine di un
/// colore solo.
export function inkThreshold(luma: Float32Array): number {
  const histogram = new Float64Array(256);
  for (const value of luma) histogram[Math.min(255, Math.max(0, Math.round(value)))]!++;
  let total = 0;
  let sum = 0;
  for (let v = 0; v < 256; v++) {
    total += histogram[v]!;
    sum += v * histogram[v]!;
  }
  let split = -1;
  let best = -1;
  let below = 0;
  let belowSum = 0;
  for (let t = 1; t < 256; t++) {
    below += histogram[t - 1]!;
    belowSum += (t - 1) * histogram[t - 1]!;
    const above = total - below;
    if (below === 0 || above === 0) continue;
    const between = below * above * (belowSum / below - (sum - belowSum) / above) ** 2;
    if (between > best) [best, split] = [between, t];
  }
  if (split < 0) return 128;
  // Il livello più comune fra `from` e `to`, escluso: la media dei valori
  // nella finestra che ne ha di più.
  const level = (from: number, to: number): number => {
    let [top, mean] = [-1, from];
    for (let v = from; v < to; v++) {
      let [count, weighted] = [0, 0];
      for (let k = Math.max(from, v - LEVEL_SPREAD); k <= Math.min(to - 1, v + LEVEL_SPREAD); k++) {
        count += histogram[k]!;
        weighted += k * histogram[k]!;
      }
      if (count > top) [top, mean] = [count, weighted / count];
    }
    return mean;
  };
  return Math.round((level(0, split) + level(split, 256)) / 2);
}

/// La luminosità media attorno a ogni pixel, in un quadrato di lato
/// `side`, con l'immagine integrale.
function localMean(luma: Float32Array, width: number, height: number, side: number): Float32Array {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += luma[y * width + x]!;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + row;
    }
  }
  const half = Math.floor(side / 2);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const sum = integral[y1 * stride + x1]! - integral[y0 * stride + x1]! - integral[y1 * stride + x0]! + integral[y0 * stride + x0]!;
      out[y * width + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/// La parte dell'immagine, nel lato corto, che fa il quadrato in cui lo
/// schizzo misura la carta: più largo dei tratti, più stretto delle ombre.
const SKETCH_WINDOW = 1 / 8;

/// Il quadrato più piccolo in cui lo schizzo misura la carta, in pixel.
const SKETCH_WINDOW_MIN = 15;

/// L'inchiostro di `raster`: ciò che è più scuro della soglia. Con
/// `relative`, come per lo schizzo, la soglia è una parte della carta lì
/// attorno: a 255 tutto ciò che è più scuro della carta, a 217 il quindici
/// per cento più scuro; altrimenti è una luminosità.
export function inkLabels(raster: Raster, threshold: number, relative: boolean): Labeled {
  const { width, height } = raster;
  const luma = lumaOf(raster);
  const side = Math.max(SKETCH_WINDOW_MIN, Math.round(Math.min(width, height) * SKETCH_WINDOW)) | 1;
  const mean = relative ? localMean(luma, width, height, side) : null;
  // Quanto il pixel è più scuro della sua soglia: positivo nell'inchiostro.
  const field = new Float32Array(width * height);
  const labels = new Int16Array(width * height);
  for (let i = 0; i < field.length; i++) {
    const limit = mean === null ? threshold : (mean[i]! * threshold) / 255;
    field[i] = limit - luma[i]!;
    labels[i] = field[i]! > 0 ? 0 : 1;
  }
  return {
    width,
    height,
    labels,
    palette: [[0, 0, 0], [255, 255, 255]],
    painted: [true, false],
    diagonal: true,
    crossing(p, q) {
      const [fp, fq] = [field[p]!, field[q]!];
      return fp > 0 && fq <= 0 ? clampCrossing(fp / (fp - fq)) : 0.5;
    },
  };
}

// --- OKLab ------------------------------------------------------------------

/// sRGB lineare di ogni valore da 0 a 255.
const LINEAR = Float64Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/// Il colore in OKLab (Björn Ottosson, 2020), in `out` da `at`.
function oklab(r: number, g: number, b: number, out: Float64Array, at: number): void {
  const [lr, lg, lb] = [LINEAR[r]!, LINEAR[g]!, LINEAR[b]!];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  out[at] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[at + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[at + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

// --- La tavolozza ------------------------------------------------------------

/// I pixel che la tavolozza guarda, al più: oltre, uno ogni tanti, a
/// griglia. Bastano per i colori di qualunque immagine, e le k-medie
/// restano rapide anche quando il rumore fa ogni pixel di un colore suo.
const PALETTE_SAMPLES = 1 << 15;

/// Il peso di un pixel di bordo, dove i canali cambiano di più di
/// [`FLAT`] verso destra o verso il basso, contro 1 di un pixel piatto.
const EDGE_WEIGHT = 0.05;
const FLAT = 6;

/// Le passate delle k-medie, al più, e la parte dei campioni che cambia
/// centro sotto la quale si fermano.
const ROUNDS = 32;
const SETTLED = 1e-3;

/// La distanza OKLab sotto la quale due colori della tavolozza sono uno,
/// per un disegno a colori piatti: poco più di quanto l'occhio distingue,
/// così un colore non si divide nei suoi bordi. Una foto, dove i colori
/// sfumano, tiene quelli a metà di questa distanza, che non fanno gradini.
export const SAME_FLAT = 0.03;
export const SAME_PHOTO = 0.012;

/// Il bianco che «Ignora il bianco» lascia: chiaro almeno così in OKLab, e
/// con un colore così poco acceso. La carta di una scansione ci sta.
const WHITE_LIGHTNESS = 0.93;
const WHITE_CHROMA = 0.03;

/// mulberry32: la tavolozza di un'immagine è sempre la stessa.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// I colori distinti dei pixel guardati, col peso che hanno.
interface Samples {
  readonly rgb: Uint8Array;
  readonly lab: Float64Array;
  readonly weight: Float64Array;
}

function samplesOf({ width, height, data }: Raster): Samples {
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / PALETTE_SAMPLES)));
  const index = new Map<number, number>();
  const rgb: number[] = [];
  const weight: number[] = [];
  const at = (x: number, y: number): number => (y * width + x) * 4;
  const differs = (i: number, j: number): boolean =>
    Math.abs(data[i]! - data[j]!) > FLAT || Math.abs(data[i + 1]! - data[j + 1]!) > FLAT || Math.abs(data[i + 2]! - data[j + 2]!) > FLAT;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = at(x, y);
      if (data[i + 3]! < OPAQUE) continue;
      const edge = (x + 1 < width && differs(i, at(x + 1, y))) || (y + 1 < height && differs(i, at(x, y + 1)));
      const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      let k = index.get(key);
      if (k === undefined) {
        k = weight.length;
        index.set(key, k);
        rgb.push(data[i]!, data[i + 1]!, data[i + 2]!);
        weight.push(0);
      }
      weight[k]! += edge ? EDGE_WEIGHT : 1;
    }
  }
  const lab = new Float64Array(weight.length * 3);
  for (let k = 0; k < weight.length; k++) oklab(rgb[k * 3]!, rgb[k * 3 + 1]!, rgb[k * 3 + 2]!, lab, k * 3);
  return { rgb: Uint8Array.from(rgb), lab, weight: Float64Array.from(weight) };
}

const distance2 = (a: Float64Array, i: number, b: Float64Array, j: number): number => {
  const [d0, d1, d2] = [a[i]! - b[j]!, a[i + 1]! - b[j + 1]!, a[i + 2]! - b[j + 2]!];
  return d0 * d0 + d1 * d1 + d2 * d2;
};

/// Il centro più vicino a un colore OKLab.
function nearest(centers: Float64Array, count: number, lab: Float64Array, at: number): number {
  const [l, a, b] = [lab[at]!, lab[at + 1]!, lab[at + 2]!];
  let best = 0;
  let bestDistance = Infinity;
  // Coi numeri uno per uno: è il ciclo che costa.
  for (let c = 0; c < count; c++) {
    const d0 = l - centers[c * 3]!;
    const d1 = a - centers[c * 3 + 1]!;
    const d2 = b - centers[c * 3 + 2]!;
    const d = d0 * d0 + d1 * d1 + d2 * d2;
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

/// Al più `colors` centri OKLab per i campioni: k-medie, coi primi centri
/// scelti come k-means++ da un seme fisso, e il primo il colore che pesa
/// di più.
function kMeans(samples: Samples, colors: number): Float64Array {
  const n = samples.weight.length;
  const k = Math.min(colors, n);
  const centers = new Float64Array(k * 3);
  if (k === 0) return centers;
  const next = random(0x20261007);
  let first = 0;
  for (let i = 1; i < n; i++) if (samples.weight[i]! > samples.weight[first]!) first = i;
  centers.set(samples.lab.subarray(first * 3, first * 3 + 3), 0);
  const closest = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      closest[i] = Math.min(closest[i]!, distance2(samples.lab, i * 3, centers, (c - 1) * 3));
      total += closest[i]! * samples.weight[i]!;
    }
    if (total === 0) return centers.slice(0, c * 3);
    let pick = next() * total;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      pick -= closest[i]! * samples.weight[i]!;
      if (pick <= 0 && closest[i]! > 0) {
        chosen = i;
        break;
      }
    }
    centers.set(samples.lab.subarray(chosen * 3, chosen * 3 + 3), c * 3);
  }
  const assigned = new Int32Array(n).fill(-1);
  for (let round = 0; round < ROUNDS; round++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const c = nearest(centers, k, samples.lab, i * 3);
      if (c !== assigned[i]) {
        assigned[i] = c;
        moved++;
      }
    }
    if (moved === 0 || (round > 0 && moved < n * SETTLED)) break;
    const sums = new Float64Array(k * 4);
    for (let i = 0; i < n; i++) {
      const [c, w] = [assigned[i]!, samples.weight[i]!];
      for (let j = 0; j < 3; j++) sums[c * 4 + j]! += samples.lab[i * 3 + j]! * w;
      sums[c * 4 + 3]! += w;
    }
    for (let c = 0; c < k; c++) {
      const w = sums[c * 4 + 3]!;
      if (w > 0) for (let j = 0; j < 3; j++) centers[c * 3 + j] = sums[c * 4 + j]! / w;
    }
  }
  return centers;
}

/// I centri senza quelli che non prendono nessun campione, e con due
/// centri più vicini di `same` fatti uno, il più pesante.
function distinct(samples: Samples, centers: Float64Array, same: number): Float64Array {
  let count = centers.length / 3;
  for (;;) {
    const weight = new Float64Array(count);
    for (let i = 0; i < samples.weight.length; i++) weight[nearest(centers, count, samples.lab, i * 3)]! += samples.weight[i]!;
    let drop = -1;
    for (let c = 0; c < count && drop < 0; c++) if (weight[c] === 0) drop = c;
    for (let a = 0; a < count && drop < 0; a++) {
      for (let b = a + 1; b < count && drop < 0; b++) {
        if (distance2(centers, a * 3, centers, b * 3) < same * same) drop = weight[a]! < weight[b]! ? a : b;
      }
    }
    if (drop < 0) return centers.slice(0, count * 3);
    centers.copyWithin(drop * 3, (drop + 1) * 3, count * 3);
    count--;
  }
}

/// La tavolozza di `raster`: al più `colors` colori, due più vicini di
/// `same` fatti uno, ciascuno la media sRGB dei suoi pixel piatti, o di
/// tutti se non ne ha; e i centri OKLab da cui i pixel prendono il colore
/// più vicino.
export function paletteOf(raster: Raster, colors: number, same: number): { readonly palette: Rgb[]; readonly centers: Float64Array } {
  const samples = samplesOf(raster);
  const centers = distinct(samples, kMeans(samples, Math.max(1, Math.round(colors))), same);
  const count = centers.length / 3;
  const sums = new Float64Array(count * 4);
  const all = new Float64Array(count * 4);
  for (let i = 0; i < samples.weight.length; i++) {
    const c = nearest(centers, count, samples.lab, i * 3);
    const w = samples.weight[i]!;
    for (let j = 0; j < 3; j++) {
      all[c * 4 + j]! += samples.rgb[i * 3 + j]! * w;
      if (w >= 1) sums[c * 4 + j]! += samples.rgb[i * 3 + j]! * w;
    }
    all[c * 4 + 3]! += w;
    if (w >= 1) sums[c * 4 + 3]! += w;
  }
  const palette: Rgb[] = [];
  for (let c = 0; c < count; c++) {
    const from = sums[c * 4 + 3]! > 0 ? sums : all;
    const w = from[c * 4 + 3]!;
    palette.push([from[c * 4]! / w, from[c * 4 + 1]! / w, from[c * 4 + 2]! / w]);
  }
  return { palette, centers };
}

/// Vero se il colore è un bianco che «Ignora il bianco» lascia.
export function whiteish([r, g, b]: Rgb): boolean {
  const lab = new Float64Array(3);
  oklab(Math.round(r), Math.round(g), Math.round(b), lab, 0);
  return lab[0]! >= WHITE_LIGHTNESS && Math.hypot(lab[1]!, lab[2]!) <= WHITE_CHROMA;
}

/// Le posizioni in una cache dei colori già visti: per un disegno piatto
/// quasi ogni pixel ne ha uno.
const CACHE_BITS = 16;

/// I colori di `raster` come etichette: al più `colors` colori, due più
/// vicini di `same` fatti uno, e senza dipingere i bianchi con
/// `ignoreWhite`.
export function colorLabels(raster: Raster, colors: number, same: number, ignoreWhite: boolean): Labeled {
  const { width, height, data } = raster;
  const { palette, centers } = paletteOf(raster, colors, same);
  const count = palette.length;
  const labels = new Int16Array(width * height);
  const cacheKeys = new Int32Array(1 << CACHE_BITS).fill(-1);
  const cacheLabels = new Int16Array(1 << CACHE_BITS);
  const lab = new Float64Array(3);
  for (let i = 0; i < labels.length; i++) {
    if (data[i * 4 + 3]! < OPAQUE) {
      labels[i] = CLEAR;
      continue;
    }
    const key = (data[i * 4]! << 16) | (data[i * 4 + 1]! << 8) | data[i * 4 + 2]!;
    const slot = Math.imul(key, 0x9e3779b1) >>> (32 - CACHE_BITS);
    if (cacheKeys[slot] === key) {
      labels[i] = cacheLabels[slot]!;
      continue;
    }
    oklab(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, lab, 0);
    const label = count === 0 ? CLEAR : nearest(centers, count, lab, 0);
    cacheKeys[slot] = key;
    cacheLabels[slot] = label;
    labels[i] = label;
  }
  const painted = palette.map((color) => !(ignoreWhite && whiteish(color)));
  return {
    width,
    height,
    labels,
    palette,
    painted,
    diagonal: false,
    crossing(p, q, a, b) {
      if (a < 0) return 0.5;
      if (b < 0) {
        // Verso un pixel trasparente il bordo passa dove l'alfa è a metà.
        const [ap, aq] = [data[p * 4 + 3]!, data[q * 4 + 3]!];
        return ap > aq ? clampCrossing((ap - OPAQUE + 0.5) / (ap - aq)) : 0.5;
      }
      // La parte del colore B in un pixel: la sua proiezione sul segmento
      // da A a B, in sRGB.
      const [pa, pb] = [palette[a]!, palette[b]!];
      const d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const length = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
      if (length === 0) return 0.5;
      const share = (k: number): number =>
        ((data[k * 4]! - pa[0]) * d[0]! + (data[k * 4 + 1]! - pa[1]) * d[1]! + (data[k * 4 + 2]! - pa[2]) * d[2]!) / length;
      const [tp, tq] = [share(p), share(q)];
      return tp < 0.5 && tq > 0.5 ? clampCrossing((0.5 - tp) / (tq - tp)) : 0.5;
    },
  };
}

/// Un punto di bordo mai proprio su un centro: due punti di fila uguali
/// non dicono un verso.
function clampCrossing(s: number): number {
  return Math.min(0.99, Math.max(0.01, s));
}
