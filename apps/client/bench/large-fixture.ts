// Il disegno del banco delle scene grandi (`large.mjs`): una lavagna larga,
// come la riempie chi ci prende appunti per mesi, con un numero di elementi
// esatto, da poche centinaia fino al limite di una scena modificabile.
//
// La lavagna è una griglia di riquadri, uno accanto all'altro. Ogni riquadro
// ha il suo fondo nel livello «Fondo»; nel «Livello 1» un titolo, un gruppo
// di tre forme e una trentina di forme sparse, rettangoli, ellissi, linee,
// tracciati e spezzate; nel livello «Inchiostro» qualche tratto a penna,
// onde e ricci con la pressione, che il pennello disegna come li disegnerebbe
// la penna vera (`fub:ink`, `fub:brush` e il loro `d`).
//
// Il disegno è sempre lo stesso per lo stesso numero di elementi, e resta
// modificabile: sotto il limite degli elementi (formato della scena, §11) e
// sotto quello dei byte. Chi lo apre ci può ancora disegnare: il banco lascia
// il posto ai suoi tratti.

import { formatBrush, PF1_DEFAULTS, brushForInput } from "../src/ink/brush";
import { encodeInk, inkFromQuantized } from "../src/editors/spatial/ink/codec";
import { pf1 } from "../src/ink/pf1";
import { quantizeInk, type InkSample } from "../src/ink/sample";
import { MAX_EDIT_BYTES, MAX_ELEMENTS } from "../src/editors/spatial/scene/read";

/// Dove sta il disegno nel vault del banco.
export const LARGE_DOC = "Lavagna.svg";

/// Quanti elementi ha il disegno, da quanti a quanti: al più il limite,
/// meno il posto per i tratti che il banco disegna.
export const LARGE_LIMITS = [200, MAX_ELEMENTS - 100] as const;

/// Le misure di un riquadro, in unità utente, e lo spazio fra due riquadri.
const CELL = [640, 420] as const;
const GAP = 40;

/// Quante forme sparse e quanti tratti ha un riquadro, da tanti a tanti.
const SHAPES = [24, 36] as const;
const STROKES = [1, 3] as const;

/// Quanti campioni ha un tratto, da tanti a tanti, e ogni quanti
/// millisecondi ne arriva uno.
const SAMPLES = [10, 26] as const;
const SAMPLE_MS = 8;

const TITLES = ["Idee", "Da fare", "Riunione", "Schema", "Bozza", "Appunti", "Domande", "Prove", "Lista", "Piano"];
const INKS = ["#2b6cb0", "#c53030", "#2f855a", "#d69e2e", "#6b46c1", "#1a202c", "#dd6b20", "#319795"];
const TINTS = ["#fef3c7", "#e0f2fe", "#ecfccb", "#fce7f3", "#f7fafc"];
const PENS = ["#1a202c", "#1a202c", "#2b6cb0", "#c53030"];

export interface LargeFixture {
  /// Il testo del file.
  readonly text: string;
  /// Gli elementi del file, tutti: è il numero chiesto.
  readonly elements: number;
  /// Gli oggetti dei livelli, senza contare i figli dei gruppi e dei testi.
  readonly objects: number;
  /// Quanti di quegli oggetti sono tratti a penna.
  readonly strokes: number;
  /// Il rettangolo della lavagna.
  readonly size: readonly [number, number];
  /// I riquadri, in righe: il primo in alto a sinistra.
  readonly cells: number;
  readonly columns: number;
  /// Un oggetto scelto dal banco: un rettangolo che sta nel primo riquadro,
  /// col suo id, il suo centro e il rettangolo `[x, y, larghezza, altezza]`
  /// che il pannello delle proprietà mostra quando è scelto.
  readonly target: { readonly id: string; readonly center: readonly [number, number]; readonly box: readonly [number, number, number, number] };
  /// FNV-1a del testo, in esadecimale: dice quale disegno si è misurato.
  readonly digest: string;
}

/// Un generatore pseudocasuale con il suo seme (mulberry32): lo stesso seme,
/// gli stessi numeri.
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/// Un numero al centesimo, e come lo scrive FubDraw: senza zeri in coda.
const round = (value: number): number => Math.round(value * 100) / 100 || 0;
const num = (value: number): string => String(round(value));

/// FNV-1a a 32 bit di `text`.
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/// Il disegno con `elements` elementi, fra i due [`LARGE_LIMITS`].
export function largeFixture(elements: number): LargeFixture {
  if (!Number.isInteger(elements) || elements < LARGE_LIMITS[0] || elements > LARGE_LIMITS[1]) {
    throw new RangeError(`il disegno del banco ha da ${LARGE_LIMITS[0]} a ${LARGE_LIMITS[1]} elementi`);
  }
  const random = generator(0x1a7a9e);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const between = (low: number, high: number): number => low + random() * (high - low);
  const count = (range: readonly [number, number]): number => Math.floor(between(range[0], range[1] + 1));
  let serial = 0;
  const id = (prefix: string): string => `${prefix}${(++serial).toString(36).padStart(8, "0")}`;

  // La radice, il suo titolo, la carta e i tre livelli.
  const FIXED = 6;
  // Un riquadro intero ha il fondo, il titolo col suo `tspan`, il gruppo con
  // le sue tre forme, le forme sparse e i tratti: in media tanti elementi.
  const perCell = 1 + 2 + 4 + (SHAPES[0] + SHAPES[1]) / 2 + (STROKES[0] + STROKES[1]) / 2;
  const cells = Math.max(1, Math.ceil((elements - FIXED) / perCell));
  const columns = Math.ceil(Math.sqrt(cells * (CELL[1] + GAP) / (CELL[0] + GAP)));
  const rows = Math.ceil(cells / columns);
  const width = columns * (CELL[0] + GAP) + GAP;
  const height = rows * (CELL[1] + GAP) + GAP;

  const back: string[] = [];
  const front: string[] = [];
  const ink: string[] = [];
  let left = elements - FIXED;
  let objects = 0;
  let strokes = 0;
  let target: LargeFixture["target"] | null = null;
  const at = new Date(Date.UTC(2026, 9, 1, 9, 0, 0)).getTime();

  /// Un tratto a penna che parte da (`x`, `y`): un'onda che va avanti, o un
  /// riccio, con la pressione che sale e scende.
  const stroke = (x: number, y: number, w: number, h: number): string => {
    const n = count(SAMPLES);
    const curl = random() < 0.35;
    const turns = between(1, 3);
    const samples: InkSample[] = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const p = 0.35 + 0.5 * Math.sin(Math.PI * u) + (random() - 0.5) * 0.1;
      const point = curl
        ? [x + w / 2 + (w / 2) * (0.4 + 0.6 * u) * Math.cos(2 * Math.PI * turns * u), y + h / 2 + (h / 2) * (0.4 + 0.6 * u) * Math.sin(2 * Math.PI * turns * u)]
        : [x + w * u, y + h / 2 + (h / 2) * Math.sin(2 * Math.PI * turns * u) + (random() - 0.5) * 2];
      samples.push({ x: point[0]!, y: point[1]!, p: Math.min(1, Math.max(0.05, p)), t: i * SAMPLE_MS });
    }
    const brush = brushForInput({ ...PF1_DEFAULTS, size: Math.round(between(3, 7)), sim: false }, true);
    const quantized = quantizeInk(samples);
    const when = new Date(at + (strokes + 1) * 61_000).toISOString();
    return `<path id="${id("o")}" fub:tool="pen" fub:at="${when}" fub:brush="${formatBrush(brush)}" d="${pf1(quantized, brush)}" fill="${pick(PENS)}" fub:ink="${encodeInk(inkFromQuantized(quantized))}"/>`;
  };

  /// Una forma sparsa nel riquadro (`x0`, `y0`, `w`, `h`): un elemento solo.
  const shape = (x0: number, y0: number, w: number, h: number): string => {
    const object = id("o");
    const ink = pick(INKS);
    const p = (): string => `${num(x0 + random() * w)} ${num(y0 + random() * h)}`;
    const kind = random();
    if (kind < 0.32) {
      const corner = random() < 0.3 ? ` rx="${num(Math.min(w, h) * 0.15)}"` : "";
      const outline = random() < 0.5 ? ` stroke="#1a202c" stroke-width="2"` : "";
      return `<rect id="${object}" x="${num(x0)}" y="${num(y0)}" width="${num(w)}" height="${num(h)}"${corner} fill="${ink}" fill-opacity="${num(between(0.4, 1))}"${outline}/>`;
    }
    if (kind < 0.52) {
      const filled = random() < 0.6;
      return `<ellipse id="${object}" cx="${num(x0 + w / 2)}" cy="${num(y0 + h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}"`
        + (filled ? ` fill="${ink}"/>` : ` fill="none" stroke="${ink}" stroke-width="3"/>`);
    }
    if (kind < 0.67) {
      const dash = random() < 0.3 ? ` stroke-dasharray="8 4"` : "";
      return `<line id="${object}" x1="${num(x0)}" y1="${num(y0)}" x2="${num(x0 + w)}" y2="${num(y0 + h)}" stroke="${ink}" stroke-width="${num(between(2, 5))}" stroke-linecap="round"${dash}/>`;
    }
    if (kind < 0.9) {
      const closed = random() < 0.4;
      return `<path id="${object}" d="M ${p()} C ${p()} ${p()} ${p()} C ${p()} ${p()} ${p()}${closed ? " Z" : ""}"`
        + (closed ? ` fill="${ink}" fill-opacity="0.6"/>` : ` fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`);
    }
    const points = Array.from({ length: 4 + Math.floor(random() * 3) }, () => p().replace(" ", ","));
    return `<polyline id="${object}" points="${points.join(" ")}" fill="none" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`;
  };

  for (let cell = 0; cell < cells && left > 0; cell++) {
    const cx = GAP + (cell % columns) * (CELL[0] + GAP);
    const cy = GAP + Math.floor(cell / columns) * (CELL[1] + GAP);
    const pad = 16;
    const band = 56;
    const inner = [cx + pad, cy + band, CELL[0] - 2 * pad, CELL[1] - band - pad] as const;
    const spot = (w: number, h: number): readonly [number, number] => [between(inner[0], inner[0] + inner[2] - w), between(inner[1], inner[1] + inner[3] - h)];

    // Il fondo del riquadro.
    back.push(`<rect id="${id("o")}" x="${num(cx)}" y="${num(cy)}" width="${CELL[0]}" height="${CELL[1]}" rx="12" fill="${pick(TINTS)}" stroke="#cbd5e0" stroke-width="1.5"/>`);
    left -= 1;
    objects += 1;

    // Il titolo, se c'è posto per un testo.
    if (left >= 2) {
      const name = `${TITLES[cell % TITLES.length]} ${cell + 1}`;
      front.push(`<text id="${id("o")}" x="${num(cx + pad)}" y="${num(cy + 38)}" font-family="Inter" font-size="24" font-weight="700" fill="#1a202c"><tspan x="${num(cx + pad)}" dy="0">${name}</tspan></text>`);
      left -= 2;
      objects += 1;
    }

    // Il gruppo di tre forme.
    if (left >= 4) {
      const icon = 64;
      const [ix, iy] = spot(icon, icon);
      front.push(`<g id="${id("o")}">`
        + `<rect id="${id("o")}" x="${num(ix)}" y="${num(iy)}" width="${icon}" height="${icon}" rx="10" fill="${pick(INKS)}"/>`
        + `<ellipse id="${id("o")}" cx="${num(ix + icon / 2)}" cy="${num(iy + icon / 2)}" rx="20" ry="14" fill="#ffffff"/>`
        + `<path id="${id("o")}" d="M ${num(ix + 12)} ${num(iy + 52)} L ${num(ix + 52)} ${num(iy + 12)}" fill="none" stroke="#1a202c" stroke-width="3" stroke-linecap="round"/></g>`);
      left -= 4;
      objects += 1;
    }

    // Il rettangolo che il banco sceglie: il primo del disegno, in un posto
    // noto del primo riquadro, sopra le altre forme del riquadro.
    const wanted = count(SHAPES);
    const marks: string[] = [];
    for (let n = 0; n < wanted && left > 0; n++) {
      const w = between(24, 150);
      const h = between(18, 110);
      const [x0, y0] = spot(w, h);
      marks.push(shape(x0, y0, w, h));
      left -= 1;
      objects += 1;
    }
    if (target === null && left > 0) {
      const object = id("o");
      const [x0, y0, w, h] = [cx + CELL[0] - pad - 120, cy + 12, 120, 34];
      marks.push(`<rect id="${object}" x="${num(x0)}" y="${num(y0)}" width="${w}" height="${h}" rx="6" fill="#2b6cb0"/>`);
      target = { id: object, center: [round(x0 + w / 2), round(y0 + h / 2)], box: [round(x0), round(y0), w, h] };
      left -= 1;
      objects += 1;
    }
    front.push(...marks);

    // I tratti a penna.
    const many = count(STROKES);
    for (let n = 0; n < many && left > 0; n++) {
      const w = between(60, 260);
      const h = between(16, 70);
      const [x0, y0] = spot(w, h);
      ink.push(stroke(x0, y0, w, h));
      left -= 1;
      objects += 1;
      strokes += 1;
    }
  }
  // Ciò che manca al numero chiesto, se i riquadri finiscono prima: forme
  // sparse nell'ultimo.
  while (left > 0) {
    front.push(shape(GAP + between(0, CELL[0] - 80), GAP + between(0, CELL[1] - 60), 60, 40));
    left -= 1;
    objects += 1;
  }
  if (target === null) throw new RangeError("il disegno del banco non ha il rettangolo da scegliere");

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    "  <title>Lavagna del banco</title>",
    `  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    `  <g id="${id("l")}" fub:layer="Fondo">`,
    ...back.map((line) => `    ${line}`),
    "  </g>",
    `  <g id="${id("l")}" fub:layer="Livello 1">`,
    ...front.map((line) => `    ${line}`),
    "  </g>",
    `  <g id="${id("l")}" fub:layer="Inchiostro">`,
    ...ink.map((line) => `    ${line}`),
    "  </g>",
    "</svg>",
    "",
  ];
  const text = lines.join("\n");
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_EDIT_BYTES) throw new RangeError(`il disegno del banco avrebbe ${bytes} byte`);
  return { text, elements, objects, strokes, size: [width, height], cells, columns, target, digest: fnv(text) };
}
