// Dove nascono le schede portate sulla lavagna: la misura di nascita di ogni
// specie, la griglia in cui si dispongono più elementi lasciati cadere
// insieme, il gruppo che li raccoglie quando sono tanti, e la tabella
// Markdown in cui diventano le celle copiate da un foglio.
//
// Solo funzioni pure, senza DOM: la tela (T15) le chiama al rilascio e per i
// rettangoli tratteggiati mentre si trascina, i test senza montare niente.

import type { CardKind, CardSize, Rect } from "./cards";

/// Il passo a cui la tela aggancia le posizioni e le misure ridimensionate a
/// mano. È `CANVAS_SNAP` di `engine.ts`, ripetuto qui perché `engine.ts` tira
/// dentro il DOM e i testi; `drop-layout.test.ts` controlla che i due valori
/// restino uguali. Le misure di nascita non si agganciano (A-16).
export const DROP_SNAP = 8;

/// La misura più piccola di una scheda: `CANVAS_MIN_SIZE` di `engine.ts`,
/// ripetuta qui per lo stesso motivo e controllata dallo stesso test.
export const DROP_MIN_SIZE = 40;

/// Lo spazio fra le schede della griglia, e il margine del gruppo intorno.
export const DROP_GAP = 24;

/// Oltre questo numero di elementi, le schede nate stanno in un gruppo.
export const DROP_GROUP_THRESHOLD = 12;

/// Le misure di nascita (D-11, prima opzione). Non si agganciano alla griglia
/// di 8 px (A-16): solo le posizioni sì. Le specie con le proporzioni del
/// contenuto (immagine, PDF) usano queste quando la misura non si sa.
const BORN_SIZE: Readonly<Record<CardKind, CardSize>> = {
  note: { width: 320, height: 240 },
  document: { width: 320, height: 240 },
  sheet: { width: 480, height: 300 },
  // 360 di larghezza; 360×480 finché la prima pagina non si sa.
  pdf: { width: 360, height: 480 },
  // Il lato lungo è 480; senza misura, una 4:3 orizzontale.
  image: { width: 480, height: 360 },
  web: { width: 320, height: 120 },
  // Un file Craft è una scheda di file finché N7 non c'è (A-3).
  craft: { width: 320, height: 160 },
  file: { width: 320, height: 160 },
};

/// Il lato lungo di un'immagine appena nata.
const IMAGE_LONG_SIDE = 480;
/// La larghezza di una scheda PDF appena nata.
const PDF_WIDTH = 360;

/// La misura di una scheda appena nata. Non si aggancia alla griglia: si
/// arrotonda all'intero più vicino (A-16), così un'immagine tiene le sue
/// proporzioni esatte.
///
/// `image` è la misura del contenuto: dell'immagine per `image` (il lato
/// lungo diventa 480, l'altro segue le proporzioni), della prima pagina per
/// `pdf` (larghezza 360, l'altezza segue). Per le altre specie non conta.
/// Una misura mancante, nulla o non finita vale come non data. Nessun lato
/// scende sotto la misura minima della tela: se il lato corto ci finisce, la
/// proporzione non si tiene (un'immagine 1×4000 nasce 40×480).
export function bornSize(
  kind: CardKind,
  image?: { readonly width: number; readonly height: number },
): CardSize {
  const fallback = BORN_SIZE[kind];
  const known =
    image !== undefined && validSide(image.width) && validSide(image.height)
      ? image
      : null;
  if (known === null || (kind !== "image" && kind !== "pdf")) return fallback;
  if (kind === "pdf") {
    return roundSize({
      width: PDF_WIDTH,
      height: (PDF_WIDTH * known.height) / known.width,
    });
  }
  const scale = IMAGE_LONG_SIDE / Math.max(known.width, known.height);
  return roundSize({
    width: known.width * scale,
    height: known.height * scale,
  });
}

/// Un elemento lasciato cadere: il file, la sua specie, la sua misura.
export interface DropItem {
  readonly path: string;
  readonly kind: CardKind;
  readonly size: CardSize;
}

/// Una scheda disposta: il file e il suo rettangolo sulla lavagna.
export interface DropCard {
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DropLayout {
  /// Le schede in ordine di nome, nell'ordine in cui la griglia le riempie.
  readonly cards: readonly DropCard[];
  /// Il gruppo che le contiene, oltre 12 elementi; sennò `null`.
  readonly group: Rect | null;
}

const NAME_ORDER = new Intl.Collator(undefined, { numeric: true });

/// Dispone gli elementi in griglia a partire dal punto `at`.
///
/// Ordine per nome del file (con i numeri in ordine di valore: «foto 2»
/// prima di «foto 10»); a parità di nome, per percorso intero. Le colonne
/// sono `ceil(sqrt(n))` e si riempiono per righe; ogni colonna è larga
/// quanto la sua scheda più larga, ogni riga alta quanto la più alta. La
/// colonna o la riga dopo parte al primo multiplo di 8 che lascia almeno 24
/// px dopo la precedente (`nextStart`). L'angolo in alto a sinistra della
/// prima scheda è il punto, agganciato a 8 px come la tela; le misure
/// restano intere (A-16). Oltre 12 elementi, `group` è il rettangolo che
/// contiene le schede con 24 px di margine per lato.
export function dropLayout(
  items: readonly DropItem[],
  at: { readonly x: number; readonly y: number },
): DropLayout {
  const n = items.length;
  if (n === 0) return { cards: [], group: null };

  const ordered = [...items]
    .map((item) => ({ path: item.path, size: roundSize(item.size) }))
    .sort(byName);
  const columns = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / columns);

  const columnWidth = new Array<number>(columns).fill(0);
  const rowHeight = new Array<number>(rows).fill(0);
  ordered.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidth[column] = Math.max(columnWidth[column]!, item.size.width);
    rowHeight[row] = Math.max(rowHeight[row]!, item.size.height);
  });

  const originX = snap(at.x);
  const originY = snap(at.y);
  const columnX = offsets(originX, columnWidth);
  const rowY = offsets(originY, rowHeight);

  const cards = ordered.map((item, index): DropCard => ({
    path: item.path,
    x: columnX[index % columns]!,
    y: rowY[Math.floor(index / columns)]!,
    width: item.size.width,
    height: item.size.height,
  }));

  if (n <= DROP_GROUP_THRESHOLD) return { cards, group: null };
  let right = -Infinity;
  let bottom = -Infinity;
  for (const card of cards) {
    right = Math.max(right, card.x + card.width);
    bottom = Math.max(bottom, card.y + card.height);
  }
  const group: Rect = {
    x: originX - DROP_GAP,
    y: originY - DROP_GAP,
    width: right - originX + 2 * DROP_GAP,
    height: bottom - originY + 2 * DROP_GAP,
  };
  return { cards, group };
}

/// Quante pagine per riga, in «Spargi le pagine» (T72): a capo dopo 10.
export const SPREAD_ROW = 10;

/// Dove nascono le pagine sparse da una scheda PDF (T72): in riga accanto alla
/// scheda `beside`, a destra di lei, e a capo ogni `SPREAD_ROW` pagine. Ogni
/// riga ricomincia dove comincia la prima; in riga e fra le righe la scheda
/// dopo parte al primo multiplo di 8 che lascia `DROP_GAP`, come `dropLayout`.
/// Oltre `DROP_GROUP_THRESHOLD` pagine, `group` le raccoglie con 24 px di
/// margine per lato. `sizes` sono le misure di nascita, nell'ordine di pagina.
export function spreadLayout(
  sizes: readonly CardSize[],
  beside: Rect,
): { readonly rects: readonly Rect[]; readonly group: Rect | null } {
  if (sizes.length === 0) return { rects: [], group: null };
  const originX = nextStart(beside.x + beside.width);
  const originY = snap(beside.y);
  const rects: Rect[] = [];
  let rowY = originY;
  for (let first = 0; first < sizes.length; first += SPREAD_ROW) {
    let x = originX;
    let rowHeight = 0;
    for (const size of sizes.slice(first, first + SPREAD_ROW).map(roundSize)) {
      rects.push({ x, y: rowY, width: size.width, height: size.height });
      x = nextStart(x + size.width);
      rowHeight = Math.max(rowHeight, size.height);
    }
    rowY = nextStart(rowY + rowHeight);
  }
  if (sizes.length <= DROP_GROUP_THRESHOLD) return { rects, group: null };
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return {
    rects,
    group: {
      x: originX - DROP_GAP,
      y: originY - DROP_GAP,
      width: right - originX + 2 * DROP_GAP,
      height: bottom - originY + 2 * DROP_GAP,
    },
  };
}

/// Le celle come tabella Markdown. La prima riga è l'intestazione; ogni riga
/// ha tante celle quante la più lunga (le corte si allungano con celle
/// vuote). Nelle celle la barra verticale si scrive `\|` e gli a capo
/// diventano spazi, perché una riga di tabella sta su una riga. Nessuna riga,
/// o righe tutte vuote: la stringa vuota.
export function markdownTable(rows: readonly (readonly string[])[]): string {
  const width = rows.reduce((most, row) => Math.max(most, row.length), 0);
  if (width === 0) return "";
  const line = (cells: readonly string[]): string =>
    `| ${Array.from({ length: width }, (_, index) => tableCell(cells[index] ?? "")).join(" | ")} |`;
  const [header, ...body] = rows;
  return [
    line(header!),
    line(new Array<string>(width).fill("---")),
    ...body.map(line),
  ].join("\n");
}

function tableCell(text: string): string {
  return text.replace(/\r\n|\r|\n/g, " ").replace(/\|/g, "\\|");
}

function byName(
  a: { readonly path: string },
  b: { readonly path: string },
): number {
  return (
    NAME_ORDER.compare(fileName(a.path), fileName(b.path)) ||
    NAME_ORDER.compare(a.path, b.path) ||
    compareCodeUnits(a.path, b.path)
  );
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/// L'ultimo segmento del percorso, senza `subpath`.
function fileName(path: string): string {
  const hash = path.indexOf("#");
  const file = hash < 0 ? path : path.slice(0, hash);
  return file.slice(file.lastIndexOf("/") + 1);
}

/// Le posizioni di partenza di colonne (o righe) di misure date: ognuna parte
/// dove finisce la precedente, con lo spazio dovuto.
function offsets(origin: number, sizes: readonly number[]): number[] {
  const starts: number[] = [];
  let at = origin;
  for (const size of sizes) {
    starts.push(at);
    at = nextStart(at + size);
  }
  return starts;
}

/// Il primo multiplo di 8 che lascia almeno `DROP_GAP` dopo `end`, il bordo
/// della colonna o della riga che precede.
function nextStart(end: number): number {
  // `+ 0` toglie lo zero negativo, come in `snap`.
  return Math.ceil((end + DROP_GAP) / DROP_SNAP) * DROP_SNAP + 0;
}

/// Le misure intere, mai sotto la misura minima della tela.
function roundSize(size: CardSize): CardSize {
  return { width: roundSide(size.width), height: roundSide(size.height) };
}

function roundSide(value: number): number {
  return Math.max(DROP_MIN_SIZE, validSide(value) ? Math.round(value) : 0);
}

function snap(value: number): number {
  // `+ 0` toglie lo zero negativo (`Math.round(-0.4)` è `-0`).
  return Number.isFinite(value)
    ? Math.round(value / DROP_SNAP) * DROP_SNAP + 0
    : 0;
}

function validSide(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
