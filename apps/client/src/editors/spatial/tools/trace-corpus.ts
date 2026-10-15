// Il corpus del ricalco: immagini fatte da forme note, coi bordi
// dell'antialiasing come le disegna un browser, e il modo di misurare
// quanto un ricalco somiglia all'immagine, ridisegnandolo con lo stesso
// rasterizzatore. Serve ai test (`trace.test.ts`) e alle misure contro
// altri ricalchi; l'app non lo carica.
//
// Ogni immagine si rifà sempre uguale da un seme: un logo in bianco e
// nero, linee sottili, un disegno a cinque colori piatti, uno schizzo a
// matita su carta con un'ombra e la grana, una «foto» di sfumature col
// rumore, e un disegno senza antialiasing, a scalini di pixel.

import { flatten, type Segment } from "../scene/geometry";
import { IDENTITY, type Point } from "../scene/matrix";
import type { Raster, Rgb } from "./trace-pixels";

/// Un colore pieno, o uno che cambia da punto a punto.
export type Paint = Rgb | ((x: number, y: number) => Rgb);

/// Una forma del corpus: i suoi tracciati, pieni con `nonzero`.
export interface Figure {
  readonly paint: Paint;
  readonly segments: readonly Segment[];
}

/// I campioni per lato di ogni pixel: 16 per pixel, come l'antialiasing
/// di un browser, che dà 17 livelli di copertura.
export const SAMPLES = 4;

/// Le forme disegnate su `background`, o su un fondo trasparente se è
/// `null`, con `samples` × `samples` campioni per pixel. Le coperture si
/// mescolano in sRGB, come fanno i browser.
export function rasterize(figures: readonly Figure[], width: number, height: number, background: Rgb | null, samples = SAMPLES): Raster {
  const color = new Float64Array(width * height * 3);
  const alpha = new Float64Array(width * height);
  if (background !== null) {
    for (let i = 0; i < width * height; i++) {
      color.set(background, i * 3);
      alpha[i] = 1;
    }
  }
  const coverage = new Float64Array(width * height);
  for (const figure of figures) {
    coverage.fill(0);
    cover(flatten(figure.segments, IDENTITY), width, height, samples, coverage);
    for (let i = 0; i < width * height; i++) {
      const c = coverage[i]!;
      if (c === 0) continue;
      const [r, g, b] = typeof figure.paint === "function" ? figure.paint((i % width) + 0.5, Math.floor(i / width) + 0.5) : figure.paint;
      // «Sopra» di Porter e Duff, coi colori non premoltiplicati.
      const a = alpha[i]!;
      const out = c + a * (1 - c);
      for (const [k, v] of [[0, r], [1, g], [2, b]] as const) color[i * 3 + k] = (v * c + color[i * 3 + k]! * a * (1 - c)) / out;
      alpha[i] = out;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = Math.round(color[i * 3]!);
    data[i * 4 + 1] = Math.round(color[i * 3 + 1]!);
    data[i * 4 + 2] = Math.round(color[i * 3 + 2]!);
    data[i * 4 + 3] = Math.round(alpha[i]! * 255);
  }
  return { width, height, data };
}

/// La parte di ogni pixel che i poligoni coprono con `nonzero`, a righe di
/// campioni.
function cover(polygons: readonly (readonly Point[])[], width: number, height: number, samples: number, out: Float64Array): void {
  const crossings: [number, number][] = [];
  const share = 1 / (samples * samples);
  for (let row = 0; row < height * samples; row++) {
    const y = (row + 0.5) / samples;
    crossings.length = 0;
    for (const polygon of polygons) {
      for (let i = 0; i < polygon.length; i++) {
        const [a, b] = [polygon[i]!, polygon[(i + 1) % polygon.length]!];
        if (a[1] <= y === b[1] <= y) continue;
        crossings.push([a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), b[1] > a[1] ? 1 : -1]);
      }
    }
    crossings.sort((p, q) => p[0] - q[0]);
    let winding = 0;
    for (let k = 0; k + 1 < crossings.length; k++) {
      winding += crossings[k]![1];
      if (winding === 0) continue;
      // I campioni della riga fra i due incroci.
      const from = Math.max(0, Math.ceil(crossings[k]![0] * samples - 0.5));
      const to = Math.min(width * samples - 1, Math.ceil(crossings[k + 1]![0] * samples - 0.5) - 1);
      const py = Math.floor(row / samples);
      for (let s = from; s <= to; s++) out[py * width + Math.floor(s / samples)]! += share;
    }
  }
}

/// Quanto un ricalco somiglia all'immagine: lo scarto medio dei canali, da
/// 0 a 255, e la parte dei pixel dove un canale scarta di più di un quarto.
export interface Fidelity {
  readonly meanError: number;
  readonly wrong: number;
}

/// `a` e `b` messi tutti e due sul bianco, confrontati pixel per pixel.
export function fidelity(a: Raster, b: Raster): Fidelity {
  let sum = 0;
  let wrong = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      const [x, y] = [onWhite(a.data, i, k), onWhite(b.data, i, k)];
      const d = Math.abs(x - y);
      sum += d;
      worst = Math.max(worst, d);
    }
    if (worst > 64) wrong++;
  }
  return { meanError: sum / (n * 3), wrong: wrong / n };
}

const onWhite = (data: Uint8ClampedArray, i: number, k: number): number => {
  const a = data[i * 4 + 3]! / 255;
  return data[i * 4 + k]! * a + 255 * (1 - a);
};

// --- Le forme ---------------------------------------------------------------

const KAPPA = 0.5522847498;

/// Un cerchio di quattro cubiche, in verso orario sullo schermo, o
/// antiorario con `reverse`.
export function circle([cx, cy]: Point, r: number, reverse = false): Segment[] {
  const k = r * KAPPA;
  const s = reverse ? -1 : 1;
  return [
    { kind: "move", to: [cx + r, cy] },
    { kind: "cubic", c1: [cx + r, cy + s * k], c2: [cx + k, cy + s * r], to: [cx, cy + s * r] },
    { kind: "cubic", c1: [cx - k, cy + s * r], c2: [cx - r, cy + s * k], to: [cx - r, cy] },
    { kind: "cubic", c1: [cx - r, cy - s * k], c2: [cx - k, cy - s * r], to: [cx, cy - s * r] },
    { kind: "cubic", c1: [cx + k, cy - s * r], c2: [cx + r, cy - s * k], to: [cx + r, cy] },
    { kind: "close" },
  ];
}

/// Un poligono chiuso.
export function polygon(points: readonly Point[]): Segment[] {
  return [{ kind: "move", to: points[0]! }, ...points.slice(1).map((to): Segment => ({ kind: "line", to })), { kind: "close" }];
}

/// Un poligono regolare di `sides` lati, o una stella se `inner` è dato,
/// con una punta in alto, girato di `turn` radianti.
export function star([cx, cy]: Point, outer: number, sides: number, inner: number | null = null, turn = 0): Segment[] {
  const points: Point[] = [];
  const n = inner === null ? sides : sides * 2;
  for (let k = 0; k < n; k++) {
    const r = inner !== null && k % 2 === 1 ? inner : outer;
    const a = -Math.PI / 2 + turn + (2 * Math.PI * k) / n;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return polygon(points);
}

/// Un tratto largo `width` lungo la spezzata `points`, coi capi e gli
/// angoli tondi: un rettangolo per lato e un cerchio per vertice, tutti
/// nello stesso verso, che con `nonzero` si sommano.
export function stroke(points: readonly Point[], width: number): Segment[] {
  const h = width / 2;
  const out: Segment[] = [];
  points.forEach((p, i) => {
    out.push(...circle(p, h));
    const q = points[i + 1];
    if (q === undefined) return;
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l === 0) return;
    // La normale a destra di chi va da p a q, sullo schermo: il rettangolo
    // gira come i cerchi.
    const [nx, ny] = [((p[1] - q[1]) / l) * h, ((q[0] - p[0]) / l) * h];
    out.push(...polygon([[p[0] - nx, p[1] - ny], [q[0] - nx, q[1] - ny], [q[0] + nx, q[1] + ny], [p[0] + nx, p[1] + ny]]));
  });
  return out;
}

/// I punti di una cubica, fitti abbastanza per un tratto.
export function curvePoints(a: Point, b: Point, c: Point, d: Point, steps = 48): Point[] {
  const out: Point[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    out.push([
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    ]);
  }
  return out;
}

// --- Le immagini --------------------------------------------------------------

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/// Un'immagine del corpus, con le forme da cui viene e l'impostazione
/// pronta che le si addice.
export interface Sample {
  readonly name: string;
  readonly preset: "bw" | "colors" | "sketch" | "photo";
  readonly raster: Raster;
  /// Le forme, in coordinate dei pixel; il fondo è bianco.
  readonly figures: readonly Figure[];
}

/// mulberry32, per la grana e il rumore.
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

/// Un numero della normale, con Box e Muller.
function gaussian(next: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
}

/// `raster` col rumore di deviazione `sigma` su ogni canale.
function noisy(raster: Raster, sigma: number, seed: number): Raster {
  const next = random(seed);
  const data = raster.data.slice();
  for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = data[i]! + gaussian(next) * sigma;
  return { ...raster, data };
}

/// Il logo: un anello, una stella, un rettangolo con un buco, una S grossa
/// e quattro puntini, in nero su bianco.
export function logo(scale = 1): Sample {
  const s = (p: Point): Point => [p[0] * scale, p[1] * scale];
  const figures: Figure[] = [
    { paint: BLACK, segments: [...circle(s([70, 70]), 50 * scale), ...circle(s([70, 70]), 30 * scale, true)] },
    { paint: BLACK, segments: star(s([200, 72]), 55 * scale, 5, 22 * scale) },
    { paint: BLACK, segments: [...polygon([s([270, 25]), s([380, 25]), s([380, 120]), s([270, 120])]), ...polygon([s([300, 55]), s([300, 90]), s([350, 90]), s([350, 55])])] },
    { paint: BLACK, segments: stroke(curvePoints(s([60, 160]), s([160, 130]), s([20, 260]), s([150, 250])), 22 * scale) },
    ...[3, 4, 6, 9].map((r, k): Figure => ({ paint: BLACK, segments: circle(s([220 + k * 40, 200]), r * scale) })),
  ];
  const [width, height] = [Math.round(400 * scale), Math.round(280 * scale)];
  return { name: "logo", preset: "bw", raster: rasterize(figures, width, height, WHITE), figures };
}

/// Le linee: tratti sottili, da uno e mezzo a tre pixel, dritti, obliqui e
/// curvi, in nero su bianco.
function lineFigures(paint: Rgb, scale: number): Figure[] {
  const s = (p: Point): Point => [p[0] * scale, p[1] * scale];
  return [
    { paint, segments: stroke([s([20, 20]), s([380, 30])], 1.5 * scale) },
    { paint, segments: stroke([s([20, 50]), s([200, 140]), s([380, 60])], 2 * scale) },
    { paint, segments: stroke(curvePoints(s([20, 260]), s([120, 120]), s([260, 300]), s([380, 160])), 3 * scale) },
    { paint, segments: stroke([s([40, 160]), s([110, 230]), s([40, 230]), s([110, 160])], 2.5 * scale) },
    { paint, segments: stroke(curvePoints(s([200, 200]), s([260, 160]), s([330, 260]), s([300, 200])), 2 * scale) },
  ];
}

export function lines(scale = 1): Sample {
  const figures = lineFigures(BLACK, scale);
  return { name: "linee", preset: "bw", raster: rasterize(figures, Math.round(400 * scale), Math.round(280 * scale), WHITE), figures };
}

/// Cinque colori piatti su bianco: un cerchio, un quadrato girato, un
/// triangolo che lo copre in parte, una fascia che tocca il cerchio, e un
/// anello nero attorno a un disco giallo.
export function flat(scale = 1): Sample {
  const s = (p: Point): Point => [p[0] * scale, p[1] * scale];
  const figures: Figure[] = [
    { paint: [0, 114, 178], segments: circle(s([90, 100]), 70 * scale) },
    { paint: [213, 94, 0], segments: star(s([230, 110]), 75 * scale, 4, null, Math.PI / 6) },
    { paint: [0, 158, 115], segments: polygon([s([200, 40]), s([330, 180]), s([170, 200])]) },
    { paint: [240, 228, 66], segments: polygon([s([20, 200]), s([380, 200]), s([380, 240]), s([20, 240])]) },
    { paint: [0, 0, 0], segments: [...circle(s([330, 70]), 45 * scale), ...circle(s([330, 70]), 38 * scale, true)] },
    { paint: [240, 228, 66], segments: circle(s([330, 70]), 38 * scale) },
  ];
  return { name: "piatto", preset: "colors", raster: rasterize(figures, Math.round(400 * scale), Math.round(280 * scale), WHITE), figures };
}

/// Lo schizzo: le linee in grafite su una carta che scurisce verso destra,
/// con la grana.
export function sketch(scale = 1): Sample {
  const width = Math.round(400 * scale);
  const paper: Figure = {
    paint: (x) => {
      const v = 250 - (80 * x) / width;
      return [v, v * 0.98, v * 0.93];
    },
    segments: polygon([[0, 0], [width, 0], [width, 280 * scale], [0, 280 * scale]]),
  };
  const ink = lineFigures([70, 70, 75], scale);
  const raster = noisy(rasterize([paper, ...ink], width, Math.round(280 * scale), WHITE), 7, 0x5c4e7c);
  return { name: "schizzo", preset: "sketch", raster, figures: ink.map((f) => ({ ...f, paint: BLACK })) };
}

/// La «foto»: un cielo sfumato, un sole con l'alone, due colline sfumate,
/// col rumore di un sensore.
export function photo(scale = 1): Sample {
  const [width, height] = [Math.round(400 * scale), Math.round(280 * scale)];
  const s = (p: Point): Point => [p[0] * scale, p[1] * scale];
  const figures: Figure[] = [
    { paint: (_, y) => [90 + (120 * y) / height, 150 + (80 * y) / height, 230], segments: polygon([[0, 0], [width, 0], [width, height], [0, height]]) },
    {
      paint: (x, y) => {
        const d = Math.hypot(x - 300 * scale, y - 70 * scale) / (40 * scale);
        return [255, 230 - 60 * d, 120 - 80 * d];
      },
      segments: circle(s([300, 70]), 40 * scale),
    },
    {
      paint: (_, y) => [60, 140 - (60 * y) / height, 50],
      segments: [{ kind: "move", to: s([0, 200]) }, { kind: "cubic", c1: s([120, 120]), c2: s([220, 260]), to: s([400, 170]) }, { kind: "line", to: s([400, 280]) }, { kind: "line", to: s([0, 280]) }, { kind: "close" }],
    },
    {
      paint: (x) => [110 - (40 * x) / width, 90, 40],
      segments: [{ kind: "move", to: s([0, 250]) }, { kind: "cubic", c1: s([150, 200]), c2: s([250, 300]), to: s([400, 240]) }, { kind: "line", to: s([400, 280]) }, { kind: "line", to: s([0, 280]) }, { kind: "close" }],
    },
  ];
  return { name: "foto", preset: "photo", raster: noisy(rasterize(figures, width, height, WHITE), 5, 0xf070), figures };
}

/// Senza antialiasing: un cerchio, un quadrato girato e una linea obliqua
/// a scalini di pixel.
export function pixels(scale = 1): Sample {
  const s = (p: Point): Point => [p[0] * scale, p[1] * scale];
  const figures: Figure[] = [
    { paint: BLACK, segments: circle(s([90, 100]), 60 * scale) },
    { paint: BLACK, segments: star(s([250, 100]), 70 * scale, 4, null, Math.PI / 9) },
    { paint: BLACK, segments: stroke([s([20, 250]), s([380, 200])], 5 * scale) },
  ];
  return { name: "scalini", preset: "bw", raster: rasterize(figures, Math.round(400 * scale), Math.round(280 * scale), WHITE, 1), figures };
}

/// Tutto il corpus, alla scala `scale`.
export function corpus(scale = 1): Sample[] {
  return [logo(scale), lines(scale), flat(scale), sketch(scale), photo(scale), pixels(scale)];
}
