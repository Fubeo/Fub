// «Ricalca immagine» (livello Esperto): da un'immagine, forme piene
// modificabili. Senza DOM: pixel in entrata, tracciati in uscita, nelle
// coordinate dei pixel, dove il pixel (x, y) copre il quadrato da (x, y) a
// (x + 1, y + 1). Gira nel worker del ricalco e nei test; i pixel non si
// riscrivono mai.
//
// - **Le regioni.** I pixel vicini dello stesso colore (`trace-pixels.ts`)
//   fanno una regione; l'inchiostro si tiene anche in diagonale. Una
//   regione più piccola del rumore va alla vicina che le somiglia di più e
//   con cui confina di più: un puntino sparisce, un buco minuscolo si
//   chiude. Le forme sono al più quante l'editor ne regge, e oltre spariscono
//   per prime le regioni più piccole.
// - **A pila.** Le forme si dipingono dalla più grande alla più piccola,
//   misurate col rettangolo che le contiene: ciò che sta in un buco viene
//   dopo. Una forma riempie i suoi buchi, dove altre forme le stanno sopra,
//   e si allunga di qualche pixel sotto le forme che vengono dopo: fra due
//   colori vicini non resta mai una fessura, e il bordo che si vede è uno
//   solo. Non si allunga vicino a ciò che sta sotto di lei o è trasparente,
//   così non spunta mai fuori. Un buco dove si vede attraverso resta buco.
// - **I contorni** corrono fra i pixel, e passano dove il colore è a metà
//   fra i due (`trace-pixels.ts`): un bordo con l'antialiasing dà una curva
//   al decimo di pixel. Gli spigoli sono i punti dove il contorno gira più
//   di [`CORNER_RADIANS`] fra i punti a due tolleranze prima e dopo, più di
//   ogni altro lì attorno, o, in un disegno pulito, dove girano tanto i
//   suoi lati dritti, anche se l'antialiasing ne smussa la punta; e stanno
//   dove le rette dei lati si incrociano. Fra due spigoli, cubiche entro
//   la tolleranza e, in media, entro metà (`fit.ts`): un tratto sottile non
//   ingrassa. Una linea dove i punti stanno su una retta.
// - **Il dettaglio** sceglie la tolleranza delle curve e il rumore. Il
//   rumore di una foto cresce con l'area dell'immagine, quello degli altri
//   no: in una scansione più fine i puntini restano.

import type { Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { AWAY_SAMPLES, cumulative, endDirection, fitCubics, straight, unit, type Fitted } from "./fit";
import { colorLabels, inkLabels, inkThreshold, lumaOf, SAME_FLAT, SAME_PHOTO, softened, working, type Labeled, type Raster, type Rgb } from "./trace-pixels";
import { MAX_COLORS, MAX_SHAPES, MIN_COLORS, type TracePreset, type TraceSettings } from "./trace-settings";

export { type Raster, type Rgb } from "./trace-pixels";
export { MAX_COLORS, MAX_SHAPES, MIN_COLORS, TRACE_PRESETS, type TracePreset, type TraceSettings } from "./trace-settings";

/// La tolleranza delle curve ai due capi del dettaglio, in pixel: fra i
/// due cresce in proporzione.
const LOOSEST = 2.5;
const TIGHTEST = 0.25;

/// Il rumore, in pixel d'area, al dettaglio di mezzo, per ogni
/// impostazione: a dettaglio zero quattro volte tanto, a cento un quarto.
const NOISE: Readonly<Record<TracePreset, number>> = { bw: 8, colors: 12, sketch: 24, photo: 16 };

/// Oltre questi pixel, il rumore di una foto cresce con l'area: le sue
/// macchie si allargano coi pixel, mentre il puntino di una «i» in una
/// scansione resta piccolo.
const PHOTO_PIXELS = 100_000;

/// La deviazione della gaussiana che ammorbidisce una foto, in pixel.
const PHOTO_SOFTEN = 1;

/// Quanto un contorno gira in uno spigolo, almeno.
export const CORNER_RADIANS = (60 * Math.PI) / 180;

/// Le tolleranze fra un punto e quelli che dicono dove va il contorno, e
/// il minimo in pixel: sotto, gli scalini dei pixel sembrerebbero spigoli.
const REACH = 2;
const REACH_MIN = 2;

/// Le impostazioni pronte di `preset`; per il bianco e nero, la soglia
/// che divide meglio i chiari dagli scuri di `raster`.
export function presetSettings(preset: TracePreset, raster: Raster | null): TraceSettings {
  switch (preset) {
    case "bw":
      return { preset, threshold: raster === null ? 128 : inkThreshold(lumaOf(working(raster))), colors: MIN_COLORS, detail: 60, ignoreWhite: true };
    case "sketch":
      return { preset, threshold: 217, colors: MIN_COLORS, detail: 50, ignoreWhite: true };
    case "colors":
      return { preset, threshold: 128, colors: 6, detail: 60, ignoreWhite: true };
    case "photo":
      return { preset, threshold: 128, colors: 24, detail: 60, ignoreWhite: false };
  }
}

/// La tolleranza delle curve per `detail`, in pixel.
export function toleranceOf(detail: number): number {
  const d = Math.min(100, Math.max(0, detail)) / 100;
  return LOOSEST * (TIGHTEST / LOOSEST) ** d;
}

/// Il rumore per `settings` in un'immagine di `pixels` pixel, in pixel
/// d'area: le regioni più piccole spariscono.
export function noiseOf({ preset, detail }: TraceSettings, pixels: number): number {
  const d = Math.min(100, Math.max(0, detail));
  const area = preset === "photo" ? Math.max(1, pixels / PHOTO_PIXELS) : 1;
  return Math.max(1, Math.round(NOISE[preset] * 4 ** ((50 - d) / 50) * area));
}

/// Una forma del ricalco: il colore e il tracciato, coi buchi nel verso
/// contrario, così che si dipinge uguale con `nonzero` ed `evenodd`.
export interface TracedShape {
  readonly color: Rgb;
  readonly segments: readonly Segment[];
}

export interface Traced {
  readonly width: number;
  readonly height: number;
  /// Dalla prima, sotto, all'ultima, sopra.
  readonly shapes: readonly TracedShape[];
  /// I nodi di tutte le forme, come li conta lo strumento Nodi.
  readonly nodes: number;
  /// I colori diversi delle forme.
  readonly colors: number;
}

/// Il ricalco di `raster` con `settings`, con al più `maxShapes` forme,
/// nei pixel di [`working`]`(raster)`.
export function trace(raster: Raster, settings: TraceSettings, maxShapes = MAX_SHAPES): Traced {
  const work = working(raster);
  const pixels = settings.preset === "photo" ? softened(work, PHOTO_SOFTEN) : work;
  const ink = settings.preset === "bw" || settings.preset === "sketch";
  const labeled = ink
    ? inkLabels(pixels, settings.threshold, settings.preset === "sketch")
    : colorLabels(pixels, Math.min(MAX_COLORS, Math.max(MIN_COLORS, Math.round(settings.colors))), settings.preset === "photo" ? SAME_PHOTO : SAME_FLAT, settings.ignoreWhite);
  const quiet = withoutNoise(labeled, noiseOf(settings, work.width * work.height), maxShapes);
  const final = ink ? quiet : withoutBlends(labeled, quiet);
  const regions = regionsOf(final, labeled);
  const tolerance = toleranceOf(settings.detail);
  const order = paintOrder(regions, labeled);
  const shapes: TracedShape[] = [];
  let nodes = 0;
  const used = new Set<number>();
  // Il disegno pulito, senza il rumore di una foto o della carta.
  const crisp = settings.preset === "bw" || settings.preset === "colors";
  const outlines = contoursOf(regions, order, labeled, final, Math.ceil(2 * tolerance) + 1);
  const holes = new HoleFinder(regions, order, labeled);
  order.forEach((region, rank) => {
    const segments: Segment[] = [];
    for (const contour of outlines[rank]!) {
      if (contour.area < 0 && !holes.seesThrough(contour.points, rank)) continue;
      const loop = fittedLoop(contour.points, work.width, work.height, tolerance, crisp);
      // Il punto di partenza è un nodo anche se l'ultima linea non c'è.
      const last = loop.segments[loop.segments.length - 1];
      nodes += loop.segments.length + (last !== undefined && last.kind !== "close" && samePoint(last.to, loop.start) ? 0 : 1);
      segments.push({ kind: "move", to: loop.start }, ...loop.segments, { kind: "close" });
    }
    if (segments.length === 0) return;
    const label = regions.label[region]!;
    used.add(label);
    const [r, g, b] = labeled.palette[label]!;
    shapes.push({ color: [Math.round(r), Math.round(g), Math.round(b)], segments });
  });
  return { width: work.width, height: work.height, shapes, nodes, colors: used.size };
}

// --- Le regioni ---------------------------------------------------------------

/// Le regioni di un'immagine di etichette: per ogni pixel la sua, e per
/// ogni regione l'etichetta, l'area, il rettangolo che la contiene e il
/// primo pixel nell'ordine delle righe.
interface Regions {
  readonly width: number;
  readonly height: number;
  readonly region: Int32Array;
  readonly count: number;
  readonly label: Int16Array;
  readonly area: Int32Array;
  /// minX, minY, maxX, maxY per ogni regione.
  readonly box: Int32Array;
  readonly first: Int32Array;
  /// Se la regione tocca il bordo dell'immagine.
  readonly border: Uint8Array;
}

/// Il capo dell'albero di `i`, accorciando la strada.
function root(parent: Int32Array, i: number): number {
  let r = i;
  while (parent[r] !== r) r = parent[r]!;
  while (parent[i] !== r) {
    const next = parent[i]!;
    parent[i] = r;
    i = next;
  }
  return r;
}

function join(parent: Int32Array, a: number, b: number): void {
  const ra = root(parent, a);
  const rb = root(parent, b);
  if (ra < rb) parent[rb] = ra;
  else if (rb < ra) parent[ra] = rb;
}

/// Se i pixel dell'etichetta `label` si tengono in diagonale.
const diagonalOf = (labeled: Labeled, label: number): boolean => labeled.diagonal && label >= 0 && labeled.painted[label] === true;

function regionsOf(labels: Int16Array, labeled: Labeled): Regions {
  const { width, height } = labeled;
  const n = width * height;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const diagonal = labeled.palette.map((_, l) => diagonalOf(labeled, l));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const l = labels[i]!;
      // Il pixel è ancora solo: prende il capo di quello prima.
      if (x > 0 && labels[i - 1] === l) parent[i] = root(parent, i - 1);
      if (y > 0 && labels[i - width] === l) join(parent, i, i - width);
      if (y > 0 && l >= 0 && diagonal[l] === true) {
        if (x > 0 && labels[i - width - 1] === l) join(parent, i, i - width - 1);
        if (x + 1 < width && labels[i - width + 1] === l) join(parent, i, i - width + 1);
      }
    }
  }
  const region = new Int32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const r = root(parent, i);
    region[i] = r === i ? count++ : region[r]!;
  }
  const label = new Int16Array(count);
  const area = new Int32Array(count);
  const box = new Int32Array(count * 4);
  const first = new Int32Array(count).fill(-1);
  const border = new Uint8Array(count);
  for (let k = 0; k < count; k++) {
    box[k * 4] = width;
    box[k * 4 + 1] = height;
    box[k * 4 + 2] = -1;
    box[k * 4 + 3] = -1;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const k = region[i]!;
      if (first[k] === -1) {
        first[k] = i;
        label[k] = labels[i]!;
        box[k * 4 + 1] = y;
      }
      area[k]!++;
      if (x < box[k * 4]!) box[k * 4] = x;
      if (x > box[k * 4 + 2]!) box[k * 4 + 2] = x;
      box[k * 4 + 3] = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border[k] = 1;
    }
  }
  return { width, height, region, count, label, area, box, first, border };
}

/// Un mucchio binario di regioni per area, dalla più piccola, che ne
/// tiene al più `capacity`.
class AreaHeap {
  private readonly items: Int32Array;
  private readonly keys: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(capacity);
    this.keys = new Int32Array(capacity);
  }

  push(item: number, key: number): void {
    let i = this.size++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.keys[up]! <= key) break;
      this.items[i] = this.items[up]!;
      this.keys[i] = this.keys[up]!;
      i = up;
    }
    this.items[i] = item;
    this.keys[i] = key;
  }

  topKey(): number {
    return this.keys[0]!;
  }

  pop(): number {
    const top = this.items[0]!;
    const n = --this.size;
    const item = this.items[n]!;
    const key = this.keys[n]!;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const c = l + 1 < n && this.keys[l + 1]! < this.keys[l]! ? l + 1 : l;
        if (this.keys[c]! >= key) break;
        this.items[i] = this.items[c]!;
        this.keys[i] = this.keys[c]!;
        i = c;
      }
      this.items[i] = item;
      this.keys[i] = key;
    }
    return top;
  }
}

/// Quanto conta il colore in [`withoutNoise`]: una vicina lontana di
/// colore quanto questa distanza OKLab conta la metà di una dello stesso
/// colore, a parità di confine.
const COLOR_WEIGHT = 0.05;

const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/// Le etichette di `labeled` senza le regioni più piccole di `noise`
/// pixel, e con al più `maxShapes` regioni dipinte: ciascuna, dalla più
/// piccola, va alla vicina col confine più lungo, pesato da quanto i colori
/// si somigliano.
function withoutNoise(labeled: Labeled, noise: number, maxShapes: number): Int16Array {
  const { width, height, painted, palette } = labeled;
  const labels = labeled.labels.slice();
  const regions = regionsOf(labels, labeled);
  const parent = new Int32Array(regions.count);
  for (let k = 0; k < regions.count; k++) parent[k] = k;
  const area = regions.area.slice();
  const label = regions.label.slice();
  const isPainted = (l: number): boolean => l >= 0 && painted[l] === true;
  let shapes = 0;
  // Ogni passo toglie una regione prima di rimetterne una.
  const heap = new AreaHeap(regions.count);
  for (let k = 0; k < regions.count; k++) {
    if (isPainted(label[k]!)) shapes++;
    heap.push(k, area[k]!);
  }
  const apart = apartOf(palette);
  const colors = palette.length + 1;
  const stamp = new Int32Array(width * height);
  let pass = 0;
  const queue = new Int32Array(width * height);
  const pixelRegion = regions.region;
  // Il confine con ogni vicina, contato per la regione di adesso: vale
  // dove il timbro è quello della passata.
  const border = new Int32Array(regions.count);
  const borderStamp = new Int32Array(regions.count);
  const touched: number[] = [];
  while (heap.size > 0 && (heap.topKey() < noise || shapes > maxShapes)) {
    const key = heap.topKey();
    const k = heap.pop();
    // Una regione cresciuta ha già un'altra voce, con l'area di adesso.
    if (parent[k] !== k || area[k] !== key) continue;
    // I pixel della regione, e il confine con ogni vicina.
    pass++;
    touched.length = 0;
    let size = 0;
    queue[size++] = regions.first[k]!;
    stamp[regions.first[k]!] = pass;
    const diagonal = diagonalOf(labeled, label[k]!);
    for (let head = 0; head < size; head++) {
      const i = queue[head]!;
      const x = i % width;
      const y = (i - x) / width;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        const other = root(parent, pixelRegion[j]!);
        if (other === k) {
          if (stamp[j] !== pass) {
            stamp[j] = pass;
            queue[size++] = j;
          }
        } else {
          if (borderStamp[other] !== pass) {
            borderStamp[other] = pass;
            border[other] = 0;
            touched.push(other);
          }
          border[other]!++;
        }
      }
      // L'inchiostro si tiene anche in diagonale; le vicine in diagonale
      // contano solo per unirsi, senza confine.
      if (labeled.diagonal) {
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d]! + DX[(d + 1) % 4]!;
          const ny = y + DY[d]! + DY[(d + 1) % 4]!;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          const other = root(parent, pixelRegion[j]!);
          if (other === k) {
            if (diagonal && stamp[j] !== pass) {
              stamp[j] = pass;
              queue[size++] = j;
            }
          } else if (borderStamp[other] !== pass) {
            borderStamp[other] = pass;
            border[other] = 0;
            touched.push(other);
          }
        }
      }
    }
    let best = -1;
    let bestScore = -Infinity;
    const row = (label[k]! + 1) * colors + 1;
    for (const other of touched) {
      const score = border[other]! / (COLOR_WEIGHT + apart[row + label[other]!]!);
      if (score > bestScore || (score === bestScore && other < best)) {
        bestScore = score;
        best = other;
      }
    }
    if (best < 0) continue;
    for (let q = 0; q < size; q++) labels[queue[q]!] = label[best]!;
    parent[k] = best;
    area[best]! += area[k]!;
    if (isPainted(label[k]!)) shapes--;
    // Le vicine del colore di `best` ora la toccano, e sono lei.
    const joins = diagonalOf(labeled, label[best]!);
    for (const other of touched) {
      if (other === best || label[other] !== label[best] || (border[other] === 0 && !joins)) continue;
      parent[other] = best;
      area[best]! += area[other]!;
      if (isPainted(label[other]!)) shapes--;
    }
    heap.push(best, area[best]!);
  }
  return labels;
}

/// Quanto sono lontani due colori della tavolozza in OKLab, per etichetta
/// più uno: il trasparente, da tutti 1.
function apartOf(palette: readonly Rgb[]): Float64Array {
  const lab = palette.map(([r, g, b]) => labOf(r, g, b));
  const colors = palette.length + 1;
  const apart = new Float64Array(colors * colors);
  for (let a = -1; a < palette.length; a++) {
    for (let b = -1; b < palette.length; b++) {
      apart[(a + 1) * colors + b + 1] = a < 0 || b < 0 ? (a === b ? 0 : 1) : Math.hypot(lab[a]![0] - lab[b]![0], lab[a]![1] - lab[b]![1], lab[a]![2] - lab[b]![2]);
    }
  }
  return apart;
}

/// La larghezza media, in pixel, sotto la quale una regione del colore di
/// mezzo fra due vicine è il passaggio dall'una all'altra.
const BLEND_WIDTH = 2;

/// Quanto un colore di passaggio può scostarsi dalla strada fra i due: la
/// somma delle distanze dai due, in parti della distanza fra loro.
const BLEND_DETOUR = 1.2;

/// Quanto del confine di un passaggio è con le due vicine, almeno.
const BLEND_BORDER = 0.75;

/// Le passate che tolgono i passaggi: un bordo morbido fra due colori
/// lontani ne fa anche due, uno accanto all'altro.
const BLEND_PASSES = 3;

/// `labels` senza i colori di passaggio: una regione sottile, del colore
/// di mezzo fra i due colori delle vicine con cui confina quasi tutta, è
/// il bordo morbido fra loro, e prende quello più simile e con cui confina
/// di più. Il bordo fra i due passa poi dove il colore è a metà, al decimo
/// di pixel.
function withoutBlends(labeled: Labeled, labels: Int16Array): Int16Array {
  const { width, height, palette } = labeled;
  const out = labels.slice();
  const apart = apartOf(palette);
  const colors = palette.length + 1;
  const far = (a: number, b: number): number => apart[(a + 1) * colors + b + 1]!;
  for (let pass = 0; pass < BLEND_PASSES; pass++) {
    const regions = regionsOf(out, labeled);
    const { region, count, label, area } = regions;
    // Il perimetro di ogni regione, e il confine con ogni colore delle
    // vicine.
    const perimeter = new Int32Array(count);
    const borders = new Map<number, number>();
    const meet = (a: number, b: number): void => {
      const key = a * colors + label[b]! + 1;
      borders.set(key, (borders.get(key) ?? 0) + 1);
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = region[y * width + x]!;
        if (x === 0) perimeter[a]!++;
        if (y === 0) perimeter[a]!++;
        for (const [nx, ny] of [[x + 1, y], [x, y + 1]] as const) {
          if (nx >= width || ny >= height) {
            perimeter[a]!++;
            continue;
          }
          const b = region[ny * width + nx]!;
          if (a === b) continue;
          perimeter[a]!++;
          perimeter[b]!++;
          meet(a, b);
          meet(b, a);
        }
      }
    }
    // I due colori delle vicine col confine più lungo.
    const first = new Int32Array(count).fill(-2);
    const second = new Int32Array(count).fill(-2);
    const firstBorder = new Int32Array(count);
    const secondBorder = new Int32Array(count);
    for (const [key, border] of borders) {
      const a = Math.floor(key / colors);
      const b = key - a * colors - 1;
      if (border > firstBorder[a]! || (border === firstBorder[a] && b < first[a]!)) {
        [second[a], secondBorder[a]] = [first[a]!, firstBorder[a]!];
        [first[a], firstBorder[a]] = [b, border];
      } else if (border > secondBorder[a]! || (border === secondBorder[a] && b < second[a]!)) {
        [second[a], secondBorder[a]] = [b, border];
      }
    }
    const into = new Int32Array(count).fill(-1);
    let merged = 0;
    for (let k = 0; k < count; k++) {
      const [lk, la, lb] = [label[k]!, first[k]!, second[k]!];
      if (lk < 0 || la < 0 || lb < 0) continue;
      if ((2 * area[k]!) / perimeter[k]! > BLEND_WIDTH) continue;
      if (firstBorder[k]! + secondBorder[k]! < BLEND_BORDER * perimeter[k]!) continue;
      if (far(lk, la) + far(lk, lb) > BLEND_DETOUR * far(la, lb)) continue;
      const [sa, sb] = [firstBorder[k]! / (COLOR_WEIGHT + far(lk, la)), secondBorder[k]! / (COLOR_WEIGHT + far(lk, lb))];
      into[k] = sa >= sb ? la : lb;
      merged++;
    }
    if (merged === 0) break;
    for (let i = 0; i < out.length; i++) {
      const to = into[region[i]!]!;
      if (to >= 0) out[i] = to;
    }
  }
  return out;
}

/// Un colore sRGB in OKLab, per [`withoutNoise`].
function labOf(r: number, g: number, b: number): [number, number, number] {
  const linear = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// --- La pila --------------------------------------------------------------------

/// Le regioni dipinte nell'ordine in cui si dipingono: dalla più grande,
/// misurata col rettangolo che la contiene, poi con l'area, poi dall'alto.
function paintOrder(regions: Regions, labeled: Labeled): number[] {
  const order: number[] = [];
  const boxArea = new Float64Array(regions.count);
  for (let k = 0; k < regions.count; k++) {
    const l = regions.label[k]!;
    if (l < 0 || labeled.painted[l] !== true) continue;
    order.push(k);
    const b = regions.box;
    boxArea[k] = (b[k * 4 + 2]! - b[k * 4]! + 1) * (b[k * 4 + 3]! - b[k * 4 + 1]! + 1);
  }
  return order.sort((a, b) => boxArea[b]! - boxArea[a]! || regions.area[b]! - regions.area[a]! || regions.first[a]! - regions.first[b]!);
}

/// Per ogni pixel il posto più basso della pila entro `reach` pixel, in
/// un quadrato: -1 se lì attorno c'è qualcosa di trasparente o di non
/// dipinto. Prima per righe, poi per colonne.
function lowestAround(rank: Int32Array, width: number, height: number, reach: number): Int32Array {
  const rows = new Int32Array(rank.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let low = Infinity;
      for (let k = Math.max(0, x - reach); k <= Math.min(width - 1, x + reach); k++) low = Math.min(low, rank[y * width + k]!);
      rows[y * width + x] = low;
    }
  }
  const out = new Int32Array(rank.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let low = Infinity;
      for (let k = Math.max(0, y - reach); k <= Math.min(height - 1, y + reach); k++) low = Math.min(low, rows[k * width + x]!);
      out[y * width + x] = low;
    }
  }
  return out;
}

// --- I contorni -------------------------------------------------------------

/// Un contorno chiuso, coi punti dove passa il bordo; l'area, con il
/// segno, è positiva per un contorno esterno e negativa per un buco.
interface Contour {
  readonly points: Point[];
  readonly area: number;
}

/// I contorni di ogni regione della pila, nello stesso ordine di `order`.
/// Un contorno corre lungo i lati dei pixel, con la regione a destra di
/// chi va, e ha un punto per lato.
///
/// Ogni regione si allunga sotto tutte le regioni che vengono dopo, per
/// `2 * reach + 2` passi di lato, ma solo dove entro `reach` pixel non
/// c'è niente che le stia sotto, di trasparente o di non dipinto: così non
/// spunta mai fuori, e dove non può allungarsi la copre per intero, con
/// `reach + 2` passi di margine, chi le sta sotto. Fra due regioni il bordo
/// che si vede è allora quello della seconda, e sotto c'è sempre la prima.
function contoursOf(regions: Regions, order: readonly number[], labeled: Labeled, labels: Int16Array, reach: number): Contour[][] {
  const { width, height, region, count } = regions;
  const n = width * height;
  const rankOf = new Int32Array(count).fill(-1);
  order.forEach((k, rank) => (rankOf[k] = rank));
  const rank = new Int32Array(n);
  for (let i = 0; i < n; i++) rank[i] = rankOf[region[i]!]!;
  const low = lowestAround(rank, width, height, reach);
  // I pixel di ogni regione, in ordine di riga.
  const startOf = new Int32Array(count + 1);
  for (let i = 0; i < n; i++) startOf[region[i]! + 1]!++;
  for (let k = 0; k < count; k++) startOf[k + 1]! += startOf[k]!;
  const pixels = new Int32Array(n);
  const filled = startOf.slice(0, count);
  for (let i = 0; i < n; i++) pixels[filled[region[i]!]!++] = i;
  // La regione che si allunga sotto il pixel, per quella di adesso.
  const under = new Int32Array(n).fill(-1);
  // I lati già percorsi dalla regione di adesso: valgono dove il timbro è
  // il suo posto.
  const seen = new Uint8Array(n);
  const seenStamp = new Int32Array(n).fill(-1);
  const steps = 2 * reach + 2;
  const out: Contour[][] = [];
  for (let r = 0; r < order.length; r++) {
    const m = order[r]!;
    const inside = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const i = y * width + x;
      return region[i] === m || under[i] === m;
    };
    // L'allungamento, passo dopo passo dai pixel della regione.
    const grown: number[] = [];
    let front: number[] = [];
    for (let p = startOf[m]!; p < startOf[m + 1]!; p++) front.push(pixels[p]!);
    for (let step = 0; step < steps && front.length > 0; step++) {
      const next: number[] = [];
      for (const i of front) {
        const x = i % width;
        const y = (i - x) / width;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d]!;
          const ny = y + DY[d]!;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (region[j] === m || under[j] === m || rank[j]! <= r || low[j]! < r) continue;
          under[j] = m;
          next.push(j);
          grown.push(j);
        }
      }
      front = next;
    }
    const diagonal = diagonalOf(labeled, regions.label[m]!);
    const follow = (x0: number, y0: number, d0: number): Contour => {
      const points: Point[] = [];
      let [x, y, d] = [x0, y0, d0];
      do {
        const i = y * width + x;
        if (seenStamp[i] !== r) {
          seenStamp[i] = r;
          seen[i] = 0;
        }
        seen[i]! |= 1 << d;
        const [qx, qy] = [x + DX[d]!, y + DY[d]!];
        let s = 0.5;
        if (region[i] === m && qx >= 0 && qy >= 0 && qx < width && qy < height) {
          const q = qy * width + qx;
          s = labeled.crossing(i, q, labels[i]!, labels[q]!);
        }
        points.push([x + 0.5 + s * DX[d]!, y + 0.5 + s * DY[d]!]);
        const w = (d + 1) & 3;
        const [ax, ay] = [x + DX[w]!, y + DY[w]!];
        const [bx, by] = [ax + DX[d]!, ay + DY[d]!];
        const aIn = inside(ax, ay);
        if (inside(bx, by) && (aIn || diagonal)) {
          [x, y, d] = [bx, by, (d + 3) & 3];
        } else if (aIn) {
          [x, y] = [ax, ay];
        } else {
          d = w;
        }
      } while (x !== x0 || y !== y0 || d !== d0);
      let area = 0;
      for (let k = 0; k < points.length; k++) {
        const [a, b] = [points[k]!, points[(k + 1) % points.length]!];
        area += a[0] * b[1] - b[0] * a[1];
      }
      return { points, area: area / 2 };
    };
    const contours: Contour[] = [];
    const start = (i: number): void => {
      const x = i % width;
      const y = (i - x) / width;
      for (let d = 0; d < 4; d++) {
        if ((seenStamp[i] === r && (seen[i]! & (1 << d)) !== 0) || inside(x + DX[d]!, y + DY[d]!)) continue;
        contours.push(follow(x, y, d));
      }
    };
    for (let p = startOf[m]!; p < startOf[m + 1]!; p++) start(pixels[p]!);
    for (const i of grown) start(i);
    out.push(contours);
  }
  return out;
}

/// Chi dice se un buco va lasciato: se dentro c'è un pixel trasparente,
/// non dipinto, o di una forma che sta sotto. Basta guardarne uno per
/// regione, perché una regione che la forma non copre sta tutta dentro un
/// buco o tutta fuori.
class HoleFinder {
  /// Un punto per ogni regione che non tocca il bordo, per y, e il suo
  /// posto nella pila: -1 se non è dipinta.
  private readonly ys: Float64Array;
  private readonly xs: Float64Array;
  private readonly ranks: Int32Array;

  constructor(regions: Regions, order: readonly number[], labeled: Labeled) {
    const rankOf = new Int32Array(regions.count).fill(-1);
    order.forEach((k, rank) => (rankOf[k] = rank));
    const points: [number, number, number][] = [];
    for (let k = 0; k < regions.count; k++) {
      if (regions.border[k] === 1) continue;
      const i = regions.first[k]!;
      const l = regions.label[k]!;
      points.push([(i % regions.width) + 0.5, Math.floor(i / regions.width) + 0.5, l >= 0 && labeled.painted[l] === true ? rankOf[k]! : -1]);
    }
    points.sort((a, b) => a[1] - b[1]);
    this.ys = Float64Array.from(points, (p) => p[1]);
    this.xs = Float64Array.from(points, (p) => p[0]);
    this.ranks = Int32Array.from(points, (p) => p[2]);
  }

  /// Se il buco `polygon` della forma al posto `rank` della pila va lasciato.
  seesThrough(polygon: readonly Point[], rank: number): boolean {
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of polygon) {
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
    let lo = 0;
    let hi = this.ys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ys[mid]! < minY) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < this.ys.length && this.ys[k]! <= maxY; k++) {
      const x = this.xs[k]!;
      if (this.ranks[k]! < rank && x >= minX && x <= maxX && inPolygon(polygon, x, this.ys[k]!)) return true;
    }
    return false;
  }
}

/// Pari e dispari: se il punto sta dentro il poligono.
function inPolygon(polygon: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i]!, polygon[j]!];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// --- Le curve -----------------------------------------------------------------

const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

const samePoint = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];

/// Il primo punto dopo `i` nel verso `step`, girando attorno al contorno
/// chiuso, lontano almeno `reach` da lui; `null` se non c'è.
function around(points: readonly Point[], i: number, step: 1 | -1, reach: number): number | null {
  const n = points.length;
  let k = i;
  for (let count = 0; count < Math.min(AWAY_SAMPLES, n - 1); count++) {
    k = (k + step + n) % n;
    if (distance(points[k]!, points[i]!) >= reach) return k;
  }
  return null;
}

/// Quanto vicino a uno spigolo stanno i punti che non dicono dove vanno i
/// suoi lati, in pixel: l'angolo di un pixel e l'antialiasing lo smussano.
const CORNER_BLUR = 1.25;

/// L'angolo, almeno, fra i due lati di uno spigolo che si porta dove si
/// incrociano: più stretti, l'incrocio è troppo incerto.
const CORNER_SNAP_RADIANS = (20 * Math.PI) / 180;

/// Un lato di uno spigolo: il punto medio, il verso in cui il contorno lo
/// percorre, e quanto i punti si scostano dalla retta, al più.
interface Side {
  readonly at: Point;
  readonly along: Point;
  readonly off: number;
}

/// La retta che passa meglio per i punti da `i` nel verso `step`, oltre
/// `blur` da lui e fino a `reach`, ai minimi quadrati totali. `null` se i
/// punti non bastano.
function sideLine(points: readonly Point[], i: number, step: 1 | -1, reach: number, blur = CORNER_BLUR): Side | null {
  const n = points.length;
  const picked: Point[] = [];
  for (let k = (i + step + n) % n, count = 0; count < Math.min(AWAY_SAMPLES, n - 1); k = (k + step + n) % n, count++) {
    const d = distance(points[k]!, points[i]!);
    if (d > reach) break;
    if (d > blur) picked.push(points[k]!);
  }
  if (picked.length < 2) return null;
  const mx = picked.reduce((s, p) => s + p[0], 0) / picked.length;
  const my = picked.reduce((s, p) => s + p[1], 0) / picked.length;
  let [xx, xy, yy] = [0, 0, 0];
  for (const [x, y] of picked) {
    xx += (x - mx) * (x - mx);
    xy += (x - mx) * (y - my);
    yy += (y - my) * (y - my);
  }
  const theta = Math.atan2(2 * xy, xx - yy) / 2;
  let along: Point = [Math.cos(theta), Math.sin(theta)];
  // Nel verso del contorno: dal lato allo spigolo prima, dallo spigolo al
  // lato dopo.
  const [ex, ey] = [points[i]![0] - mx, points[i]![1] - my];
  if ((ex * along[0] + ey * along[1]) * step > 0) along = [-along[0], -along[1]];
  let off = 0;
  for (const [x, y] of picked) off = Math.max(off, Math.abs((x - mx) * along[1] - (y - my) * along[0]));
  return { at: [mx, my], along, off };
}

/// La svolta, almeno, di uno spigolo coi lati dritti: l'antialiasing
/// smussa i punti vicini all'angolo, e la svolta misurata fra loro è più
/// piccola di quella fra i lati.
const STRAIGHT_CORNER_RADIANS = (45 * Math.PI) / 180;

/// Quanto i punti di un lato dritto si scostano dalla sua retta, al più,
/// in pixel.
const SIDE_STRAIGHT = 0.15;

/// L'angolo fra i lati di `i`, se sono dritti; `null` altrimenti.
function straightTurn(points: readonly Point[], i: number, reach: number): number | null {
  const a = sideLine(points, i, -1, 2 * reach);
  const b = sideLine(points, i, 1, 2 * reach);
  if (a === null || b === null || a.off > SIDE_STRAIGHT || b.off > SIDE_STRAIGHT) return null;
  return Math.acos(Math.min(1, Math.max(-1, a.along[0] * b.along[0] + a.along[1] * b.along[1])));
}

/// Gli spigoli di un contorno chiuso: i punti dove gira almeno
/// [`CORNER_RADIANS`] fra i punti lontani `reach` prima e dopo, o, se
/// l'immagine è `crisp`, fra i due lati, se sono dritti; più di ogni altro
/// più vicino di `reach`, e a pari giro il primo. Nel rumore di una foto o
/// della grana della carta i lati dritti sono un caso.
function cornersOf(points: readonly Point[], reach: number, crisp: boolean): number[] {
  const n = points.length;
  const turns = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = around(points, i, -1, reach);
    const l = around(points, i, 1, reach);
    if (j === null || l === null) continue;
    const u = unit([points[i]![0] - points[j]![0], points[i]![1] - points[j]![1]]);
    const v = unit([points[l]![0] - points[i]![0], points[l]![1] - points[i]![1]]);
    if (u !== null && v !== null) turns[i] = Math.acos(Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1])));
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turns[i]! < (crisp ? STRAIGHT_CORNER_RADIANS : CORNER_RADIANS)) continue;
    if (turns[i]! < CORNER_RADIANS && (straightTurn(points, i, reach) ?? 0) < CORNER_RADIANS) continue;
    let top = true;
    for (const step of [1, -1] as const) {
      for (let k = (i + step + n) % n, count = 0; count < n - 1 && distance(points[k]!, points[i]!) < reach; k = (k + step + n) % n, count++) {
        if (turns[k]! > turns[i]! || (turns[k] === turns[i] && k < i)) top = false;
      }
    }
    if (top) out.push(i);
  }
  return out;
}

/// La svolta oltre la quale uno spigolo è una punta: i due lati vicini
/// alla punta distano meno di un paio di pixel, e i loro punti si sporcano
/// a vicenda.
const SPIKE_RADIANS = (120 * Math.PI) / 180;

/// Quanto più lontano si leggono, al più, i lati di una punta.
const SPIKE_WIDEN = 3;

/// I lati dello spigolo `i`, prima e dopo, fra [`CORNER_BLUR`] e due volte
/// `reach`; per una punta più lontano, tanto più quanto è stretta, e
/// quanto si è allontanato, `widen`. `null` se i punti non bastano.
function cornerSides(points: readonly Point[], i: number, reach: number): { readonly before: Side; readonly after: Side; readonly widen: number } | null {
  const before = sideLine(points, i, -1, 2 * reach);
  const after = sideLine(points, i, 1, 2 * reach);
  if (before === null || after === null) return null;
  const turn = Math.acos(Math.min(1, Math.max(-1, before.along[0] * after.along[0] + before.along[1] * after.along[1])));
  // Una svolta quasi piena è la fine di una linea sottile, non una punta.
  if (turn <= SPIKE_RADIANS || turn >= Math.PI - CORNER_SNAP_RADIANS) return { before, after, widen: 1 };
  const widen = Math.min(SPIKE_WIDEN, 1 / Math.sin((Math.PI - turn) / 2));
  const [far, blur] = [2 * reach * widen, CORNER_BLUR * widen];
  const wideBefore = sideLine(points, i, -1, far, blur);
  const wideAfter = sideLine(points, i, 1, far, blur);
  // Più lontano dalla punta si può finire su un'altra forma, come dove due
  // linee si incrociano: i lati valgono solo se restano dritti.
  if (wideBefore === null || wideAfter === null || wideBefore.off > SIDE_STRAIGHT || wideAfter.off > SIDE_STRAIGHT) return { before, after, widen: 1 };
  return { before: wideBefore, after: wideAfter, widen };
}

/// Lo spigolo `i` dove si incrociano le rette dei due lati, se sono
/// abbastanza diverse e l'incrocio sta entro `reach`, o più lontano per
/// una punta; altrimenti dov'è.
function snappedCorner(points: readonly Point[], i: number, reach: number): Point {
  const sides = cornerSides(points, i, reach);
  const p = points[i]!;
  if (sides === null) return p;
  const { before: a, after: b, widen } = sides;
  const cross = a.along[0] * b.along[1] - a.along[1] * b.along[0];
  if (Math.abs(cross) < Math.sin(CORNER_SNAP_RADIANS)) return p;
  const t = ((b.at[0] - a.at[0]) * b.along[1] - (b.at[1] - a.at[1]) * b.along[0]) / cross;
  const meet: Point = [a.at[0] + t * a.along[0], a.at[1] + t * a.along[1]];
  return distance(meet, p) <= reach * widen ? meet : p;
}

/// Quanto lontano dalla corda possono stare le maniglie di una cubica, in
/// tolleranze, perché diventi una linea.
const STRAIGHTEN = 0.25;

/// Il segmento di un pezzo adattato: una linea se la cubica non si scosta
/// dalla sua corda.
function segmentOf(from: Point, piece: Fitted, tolerance: number): Segment {
  const curve = piece.curve;
  if (curve.kind !== "cubic") return { kind: "line", to: curve.to };
  const along = unit([curve.to[0] - from[0], curve.to[1] - from[1]]);
  if (along !== null) {
    const off = (p: Point): number => Math.abs((p[0] - from[0]) * along[1] - (p[1] - from[1]) * along[0]);
    const on = (p: Point): number => (p[0] - from[0]) * along[0] + (p[1] - from[1]) * along[1];
    const length = distance(from, curve.to);
    const inside = (p: Point): boolean => on(p) >= 0 && on(p) <= length;
    if (off(curve.c1) <= STRAIGHTEN * tolerance && off(curve.c2) <= STRAIGHTEN * tolerance && inside(curve.c1) && inside(curve.c2)) {
      return { kind: "line", to: curve.to };
    }
  }
  return { kind: "cubic", c1: curve.c1, c2: curve.c2, to: curve.to };
}

/// Le passate della lisciatura: con tre, gli scalini di un bordo senza
/// antialiasing spariscono, e un bordo morbido resta dov'è.
const SMOOTH_PASSES = 3;

/// I punti di un contorno lisciati, tranne gli spigoli: ognuno va verso la
/// media dei due vicini, [`SMOOTH_PASSES`] volte, e di meno di metà
/// `tolerance` in tutto, così una forma piccola non si restringe.
function smoothed(points: readonly Point[], corners: ReadonlySet<number>, tolerance: number): Point[] {
  const n = points.length;
  if (n < 5) return [...points];
  let now = [...points];
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const before = now;
    now = before.map((p, i) => {
      if (corners.has(i)) return p;
      const [a, b] = [before[(i - 1 + n) % n]!, before[(i + 1) % n]!];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
  }
  const most = tolerance / 2;
  return now.map((p, i) => {
    const o = points[i]!;
    const d = distance(p, o);
    return d <= most ? p : [o[0] + ((p[0] - o[0]) * most) / d, o[1] + ((p[1] - o[1]) * most) / d];
  });
}

/// I punti di `points` dove il contorno arriva sul bordo di un'immagine
/// di `width` per `height`, o lo lascia: lungo il bordo il contorno resta
/// sul bordo.
function edgeEnds(points: readonly Point[], width: number, height: number): number[] {
  const n = points.length;
  const onEdge = points.map(([x, y]) => x === 0 || y === 0 || x === width || y === height);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (onEdge[i] && !(onEdge[(i - 1 + n) % n] && onEdge[(i + 1) % n])) out.push(i);
  }
  return out;
}

/// Il contorno chiuso `points`, in un'immagine di `width` per `height`,
/// come segmenti entro `tolerance`, dal punto `start` fino a lui di nuovo:
/// dal primo spigolo, o tutto di un pezzo, liscio nel primo punto, se non
/// ne ha. Se l'immagine è `crisp`, anche gli spigoli dei lati dritti.
function fittedLoop(points: readonly Point[], width: number, height: number, tolerance: number, crisp: boolean): { readonly start: Point; readonly segments: Segment[] } {
  const reach = Math.max(REACH_MIN, REACH * tolerance);
  const found = cornersOf(points, reach, crisp);
  const ends = edgeEnds(points, width, height);
  const corners = [...new Set([...found, ...ends])].sort((a, b) => a - b);
  const sharp = [...points];
  for (const c of found) {
    const [x, y] = snappedCorner(points, c, reach);
    sharp[c] = [Math.min(width, Math.max(0, x)), Math.min(height, Math.max(0, y))];
  }
  const soft = smoothed(sharp, new Set(corners), tolerance);
  const n = soft.length;
  const start = corners.length > 0 ? corners[0]! : 0;
  // Girato dal primo spigolo, e chiuso: l'ultimo punto è il primo.
  const ring = [...soft.slice(start), ...soft.slice(0, start), soft[start]!];
  const marks = corners.length > 0 ? [...corners.map((c) => (c - start + n) % n), n] : [0, n];
  const lengths = cumulative(ring);
  const out: Segment[] = [];
  for (let m = 0; m + 1 < marks.length; m++) {
    const [first, last] = [marks[m]!, marks[m + 1]!];
    if (last - first < 1) continue;
    if (straight(ring, first, last, tolerance / 2) && distance(ring[first]!, ring[last]!) > 0) {
      out.push({ kind: "line", to: ring[last]! });
      continue;
    }
    let t1: Point;
    let t2: Point;
    if (corners.length === 0) {
      // Senza spigoli il contorno passa liscio dal primo punto.
      const a = around(soft, start, -1, tolerance) ?? n - 1;
      const b = around(soft, start, 1, tolerance) ?? 1;
      t1 = t2 = unit([soft[b]![0] - soft[a]![0], soft[b]![1] - soft[a]![1]]) ?? [1, 0];
    } else {
      // Il verso dei punti lisciati appena dopo lo spigolo.
      t1 = endDirection(ring, first, last, tolerance);
      t2 = endDirection(ring, last, first, tolerance);
    }
    const pieces: Fitted[] = [];
    fitCubics(ring, lengths, first, last, t1, t2, tolerance, pieces, true);
    let from = ring[first]!;
    for (const piece of pieces) {
      out.push(segmentOf(from, piece, tolerance));
      from = piece.curve.to;
    }
  }
  const loop = withoutStraightNodes(ring[0]!, out);
  // L'ultima linea, che torna al primo punto, la disegna la chiusura.
  if (loop.segments.length > 1 && loop.segments[loop.segments.length - 1]!.kind === "line") loop.segments.pop();
  return loop;
}

/// Quanto può stare fuori dalla retta un nodo fra due linee che si
/// uniscono, in pixel.
const STRAIGHT_NODE = 0.01;

/// Il contorno chiuso che parte da `start`, coi `segments` che tornano lì,
/// senza i nodi fra due linee sulla stessa retta: non cambiano niente. Ne
/// resta uno, per esempio, dove una forma tocca il bordo dell'immagine.
function withoutStraightNodes(start: Point, segments: readonly Segment[]): { readonly start: Point; readonly segments: Segment[] } {
  /// Vero se `b` sta sulla retta da `a` a `c`, fra i due.
  const between = (a: Point, b: Point, c: Point): boolean => {
    const ac = distance(a, c);
    if (!(ac > 0)) return false;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const along = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    return Math.abs(cross) / ac <= STRAIGHT_NODE && along > 0;
  };
  const out: Segment[] = [];
  /// Dove arriva `out[i]`; prima del primo, `start`.
  const end = (i: number): Point => {
    const segment = out[i];
    return segment !== undefined && "to" in segment ? segment.to : start;
  };
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (segment.kind === "line" && last?.kind === "line" && between(end(out.length - 2), last.to, segment.to)) out[out.length - 1] = segment;
    else out.push(segment);
  }
  // Il primo punto, fra l'ultima linea e la prima: si parte dal nodo dopo.
  const [first, last] = [out[0], out[out.length - 1]];
  if (out.length > 2 && first?.kind === "line" && last?.kind === "line" && between(end(out.length - 2), start, first.to)) {
    return { start: first.to, segments: [...out.slice(1, -1), { kind: "line", to: first.to }] };
  }
  return { start, segments: out };
}
