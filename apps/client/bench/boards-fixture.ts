// Il disegno del banco delle tavole (`boards.mjs`): `count` tavole in righe,
// come le mette chi le aggiunge una accanto all'altra, con 80 unità in mezzo
// e i formati di tutti i giorni, A4 nei due versi, 16:9, quadrato, telefono,
// icona. Quasi tutte hanno la carta bianca, qualcuna colorata, qualcuna
// nessuna. Su ogni tavola ci sono da 40 a 80 oggetti: una fascia in alto, nel
// livello «Fondo», e nel «Livello 1» il nome della tavola in un testo, un
// gruppo, e rettangoli, ellissi, linee, spezzate e tracciati.
//
// Il disegno è sempre lo stesso per lo stesso `count`, e resta modificabile:
// sotto i 50 000 elementi (formato della scena, §11) con un margine. Per
// starci, a mille tavole gli oggetti scendono a 40 per tavola.

import { MAX_BOARDS, MAX_ELEMENTS } from "../src/editors/spatial/scene/read";

/// Dove sta il disegno nel vault del banco.
export const BOARDS_DOC = "Tavole.svg";

/// Quanti elementi può avere il disegno, al più: il margine sotto il limite
/// è per chi, guardandolo, ci disegna ancora qualcosa.
const ELEMENT_BUDGET = MAX_ELEMENTS - 2_000;

/// Gli oggetti di una tavola, da tanti a tanti, e quelli che ci sono sempre:
/// la fascia, il testo e il gruppo.
const OBJECTS = [40, 80] as const;
const FIXED_OBJECTS = 3;

/// Lo spazio fra una tavola e l'altra, quello che FubDraw lascia.
const GAP = 80;

/// I formati delle tavole, in unità utente.
const FORMATS: readonly (readonly [number, number])[] = [
  [1122.52, 793.7],
  [793.7, 1122.52],
  [1920, 1080],
  [1080, 1080],
  [390, 844],
  [512, 512],
];

const NAMES = ["Copertina", "Indice", "Schizzo", "Pianta", "Sezione", "Dettaglio", "Prospetto", "Schema", "Appunti", "Bozza"];
const INKS = ["#2b6cb0", "#c53030", "#2f855a", "#d69e2e", "#6b46c1", "#1a202c", "#dd6b20", "#319795"];
const TINTS = ["#fef3c7", "#e0f2fe", "#ecfccb", "#fce7f3"];

/// Una tavola del disegno, come la leggerà l'editor.
export interface FixtureBoard {
  readonly id: string;
  readonly name: string;
  /// Il rettangolo del suo `viewBox`.
  readonly rect: readonly [number, number, number, number];
  /// Il colore della sua carta; `null` se non ne ha.
  readonly paper: string | null;
}

export interface BoardsFixture {
  /// Il testo del file.
  readonly text: string;
  /// Le tavole, nel loro ordine.
  readonly boards: readonly FixtureBoard[];
  /// Gli oggetti sulle tavole: forme, testi e gruppi, senza contare i figli
  /// dei gruppi.
  readonly objects: number;
  /// Gli elementi del file, tutti.
  readonly elements: number;
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

const xml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/// FNV-1a a 32 bit di `text`.
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/// Il disegno con `count` tavole, da 1 a [`MAX_BOARDS`].
export function boardsFixture(count: number): BoardsFixture {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BOARDS) {
    throw new RangeError(`il disegno del banco ha da 1 a ${MAX_BOARDS} tavole`);
  }
  const random = generator(0x7a7015);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const between = (low: number, high: number): number => low + random() * (high - low);
  let serial = 0;
  const id = (prefix: string): string => `${prefix}${(++serial).toString(36).padStart(8, "0")}`;

  // Quanti oggetti stanno su una tavola senza passare il budget: ogni tavola
  // ha il suo `view` col suo `title`, la carta, e gli oggetti, coi figli del
  // gruppo e il `tspan` del testo; il file ha la radice, il suo `title` e i
  // due livelli.
  const most = Math.min(OBJECTS[1], Math.floor((ELEMENT_BUDGET - 4) / count) - 7);

  // Le tavole, in righe.
  const columns = Math.ceil(Math.sqrt(count));
  const boards: FixtureBoard[] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  let width = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0 && i % columns === 0) {
      x = 0;
      y = round(y + row + GAP);
      row = 0;
    }
    const [w, h] = pick(FORMATS);
    const paper = i % 7 === 6 ? null : i % 5 === 2 ? pick(TINTS) : "#ffffff";
    boards.push({ id: id("b"), name: `${NAMES[i % NAMES.length]} ${i + 1}`, rect: [x, y, w, h], paper });
    x = round(x + w + GAP);
    width = Math.max(width, x - GAP);
    row = Math.max(row, h);
  }
  const height = y + row;

  // Gli oggetti di ogni tavola, nei due livelli.
  const back: string[] = [];
  const front: string[] = [];
  let objects = 0;
  let elements = 4;
  for (const board of boards) {
    const [bx, by, bw, bh] = board.rect;
    const side = Math.min(bw, bh);
    const margin = side * 0.04;
    const band = bh * 0.18;
    const wanted = Math.min(most, Math.floor(between(OBJECTS[0], OBJECTS[1] + 1)));
    elements += 2 + (board.paper === null ? 0 : 1);
    objects += wanted;
    elements += wanted + 4;

    back.push(`<rect id="${id("o")}" x="${num(bx)}" y="${num(by)}" width="${num(bw)}" height="${num(band)}" fill="${pick(TINTS)}" opacity="0.8"/>`);
    const size = Math.max(14, Math.round(side * 0.06));
    front.push(`<text id="${id("o")}" x="${num(bx + margin)}" y="${num(by + band / 2 + size * 0.35)}" font-family="Inter" font-size="${size}" font-weight="700" fill="#1a202c">`
      + `<tspan x="${num(bx + margin)}" dy="0">${xml(board.name)}</tspan></text>`);

    // Ciò che sta sotto la fascia.
    const left = bx + margin;
    const top = by + band + margin;
    const right = bx + bw - margin;
    const bottom = by + bh - margin;
    const at = (low: number, high: number, size: number): number => between(low, Math.max(low, high - size));

    const icon = side * 0.16;
    const ix = at(left, right, icon);
    const iy = at(top, bottom, icon);
    front.push(`<g id="${id("o")}">`
      + `<rect id="${id("o")}" x="${num(ix)}" y="${num(iy)}" width="${num(icon)}" height="${num(icon)}" rx="${num(icon * 0.18)}" fill="${pick(INKS)}"/>`
      + `<ellipse id="${id("o")}" cx="${num(ix + icon / 2)}" cy="${num(iy + icon / 2)}" rx="${num(icon * 0.3)}" ry="${num(icon * 0.22)}" fill="#ffffff"/>`
      + `<path id="${id("o")}" d="M ${num(ix + icon * 0.2)} ${num(iy + icon * 0.8)} L ${num(ix + icon * 0.8)} ${num(iy + icon * 0.2)}" fill="none" stroke="#1a202c" stroke-width="${num(icon * 0.05)}" stroke-linecap="round"/></g>`);

    // Le altre forme, ognuna nel suo riquadro, che sta tutto sulla tavola:
    // anche le curve, che non escono dai loro punti di controllo.
    for (let n = FIXED_OBJECTS; n < wanted; n++) {
      const w = side * between(0.08, 0.32);
      const h = side * between(0.06, 0.28);
      const x0 = at(left, right, w);
      const y0 = at(top, bottom, h);
      const p = (): string => `${num(x0 + random() * w)} ${num(y0 + random() * h)}`;
      const ink = pick(INKS);
      const kind = random();
      const object = id("o");
      if (kind < 0.3) {
        const round = random() < 0.3 ? ` rx="${num(side * 0.02)}"` : "";
        const stroke = random() < 0.5 ? ` stroke="#1a202c" stroke-width="2"` : "";
        front.push(`<rect id="${object}" x="${num(x0)}" y="${num(y0)}" width="${num(w)}" height="${num(h)}"${round} fill="${ink}" fill-opacity="${num(between(0.4, 1))}"${stroke}/>`);
      } else if (kind < 0.5) {
        const filled = random() < 0.6;
        front.push(`<ellipse id="${object}" cx="${num(x0 + w / 2)}" cy="${num(y0 + h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}"`
          + (filled ? ` fill="${ink}"/>` : ` fill="none" stroke="${ink}" stroke-width="3"/>`));
      } else if (kind < 0.65) {
        const dash = random() < 0.3 ? ` stroke-dasharray="8 4"` : "";
        const [x1, x2] = random() < 0.5 ? [x0, x0 + w] : [x0 + w, x0];
        front.push(`<line id="${object}" x1="${num(x1)}" y1="${num(y0)}" x2="${num(x2)}" y2="${num(y0 + h)}"`
          + ` stroke="${ink}" stroke-width="${num(between(2, 6))}" stroke-linecap="round"${dash}/>`);
      } else if (kind < 0.9) {
        const closed = random() < 0.4;
        front.push(`<path id="${object}" d="M ${p()} C ${p()} ${p()} ${p()} C ${p()} ${p()} ${p()}${closed ? " Z" : ""}"`
          + (closed ? ` fill="${ink}" fill-opacity="0.6"/>` : ` fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`));
      } else {
        const points = Array.from({ length: 4 + Math.floor(random() * 3) }, () => p().replace(" ", ","));
        front.push(`<polyline id="${object}" points="${points.join(" ")}" fill="none" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`);
      }
    }
  }
  if (elements > ELEMENT_BUDGET) throw new RangeError(`il disegno del banco avrebbe ${elements} elementi`);

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}">`,
    "  <title>Tavole del banco</title>",
    ...boards.flatMap((board) => board.paper === null ? [] : [
      `  <rect id="${id("c")}" fub:role="paper" fub:board="${board.id}" x="${num(board.rect[0])}" y="${num(board.rect[1])}" width="${num(board.rect[2])}" height="${num(board.rect[3])}" fill="${board.paper}"/>`,
    ]),
    ...boards.flatMap((board) => [
      `  <view id="${board.id}" fub:role="board" viewBox="${board.rect.map(num).join(" ")}">`,
      `    <title>${xml(board.name)}</title>`,
      "  </view>",
    ]),
    `  <g id="${id("l")}" fub:layer="Fondo">`,
    ...back.map((line) => `    ${line}`),
    "  </g>",
    `  <g id="${id("l")}" fub:layer="Livello 1">`,
    ...front.map((line) => `    ${line}`),
    "  </g>",
    "</svg>",
    "",
  ];
  const text = lines.join("\n");
  return { text, boards, objects, elements, digest: fnv(text) };
}
