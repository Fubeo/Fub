// L'albero dei riquadri: fra molti riquadri che non cambiano, quelli che ne
// incontrano uno, senza guardarli tutti.
//
// È un R-tree impacchettato una volta sola, alla costruzione, col metodo
// Sort-Tile-Recursive: i riquadri si dividono per il centro in x in fette
// verticali, ogni fetta si divide per il centro in y in nodi di `NODE`
// riquadri, poi si fa lo stesso coi nodi, finché ne resta uno. Le divisioni
// scelgono soltanto i confini (`group`), senza ordinare tutto: dentro una
// fetta o un nodo l'ordine non conta. Il riquadro di un nodo è fatto dei
// minimi e dei massimi dei figli, che non arrotondano: un riquadro che
// incontra la ricerca ha ogni antenato che la incontra, e la ricerca non lo
// perde. Dà quindi esattamente i riquadri che il confronto diretto darebbe, e
// chi rifà sui candidati la prova della scansione ha il risultato della
// scansione.

import type { Bounds } from "../scene/geometry";

/// Quanti figli ha un nodo.
const NODE = 16;

export class BoxTree {
  /// I riquadri dei nodi, quattro numeri per nodo (minimo x, minimo y,
  /// massimo x, massimo y): prima le foglie, che sono i riquadri dati
  /// nell'ordine dell'albero, poi un livello dopo l'altro fino alla radice.
  private readonly boxes: Float64Array;
  /// Per una foglia, la posizione del suo riquadro fra quelli dati; per un
  /// nodo, dove comincia il primo dei figli, nel livello sotto.
  private readonly refs: Uint32Array;
  /// Dove comincia ogni livello, dalle foglie, e alla fine quanti nodi ci
  /// sono in tutto.
  private readonly starts: number[] = [0];

  /// L'albero di `boxes`. Un riquadro `null`, o con una coordinata che non è
  /// un numero, non c'è: nessun confronto lo incontrerebbe.
  constructor(boxes: readonly (Bounds | null)[]) {
    const kept: number[] = [];
    for (let i = 0; i < boxes.length; i++) if (measured(boxes[i]!)) kept.push(i);
    const sizes = [kept.length];
    while (sizes[sizes.length - 1]! > 1) sizes.push(Math.ceil(sizes[sizes.length - 1]! / NODE));
    for (const size of sizes) this.starts.push(this.starts[this.starts.length - 1]! + size);
    const total = this.starts[this.starts.length - 1]!;
    this.boxes = new Float64Array(4 * total);
    this.refs = new Uint32Array(total);

    // Un livello alla volta: i suoi nodi, raccolti in `level`, si mettono
    // nell'ordine delle fette, e a `NODE` a `NODE` fanno i nodi di sopra.
    let level = new Float64Array(4 * kept.length);
    let refs = Uint32Array.from(kept);
    for (let k = 0; k < kept.length; k++) {
      const box = boxes[kept[k]!]!;
      level[4 * k] = box.min[0];
      level[4 * k + 1] = box.min[1];
      level[4 * k + 2] = box.max[0];
      level[4 * k + 3] = box.max[1];
    }
    for (let depth = 0; depth < sizes.length; depth++) {
      const count = sizes[depth]!;
      const at = this.starts[depth]!;
      const order = tiled(level, count);
      for (let pos = 0; pos < count; pos++) {
        const from = 4 * order[pos]!;
        const to = 4 * (at + pos);
        this.boxes[to] = level[from]!;
        this.boxes[to + 1] = level[from + 1]!;
        this.boxes[to + 2] = level[from + 2]!;
        this.boxes[to + 3] = level[from + 3]!;
        this.refs[at + pos] = refs[order[pos]!]!;
      }
      if (depth + 1 === sizes.length) break;
      const parents = sizes[depth + 1]!;
      level = new Float64Array(4 * parents);
      refs = new Uint32Array(parents);
      for (let j = 0; j < parents; j++) {
        const first = at + j * NODE;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let child = first, end = Math.min(first + NODE, at + count); child < end; child++) {
          minX = Math.min(minX, this.boxes[4 * child]!);
          minY = Math.min(minY, this.boxes[4 * child + 1]!);
          maxX = Math.max(maxX, this.boxes[4 * child + 2]!);
          maxY = Math.max(maxY, this.boxes[4 * child + 3]!);
        }
        level[4 * j] = minX;
        level[4 * j + 1] = minY;
        level[4 * j + 2] = maxX;
        level[4 * j + 3] = maxY;
        refs[j] = first;
      }
    }
  }

  /// Le posizioni fra i riquadri dati, in ordine crescente, di quelli che
  /// incontrano il riquadro da (`minX`, `minY`) a (`maxX`, `maxY`): quelli per
  /// cui `maxX` non sta sotto il loro minimo in x e `minX` non sta sopra il
  /// loro massimo, e lo stesso in y. Sono i confronti di chi li guarda a uno a
  /// uno, anche per una ricerca rovesciata; una coordinata che non è un numero
  /// non incontra niente.
  search(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const found: number[] = [];
    if (this.refs.length === 0) return found;
    const boxes = this.boxes;
    const top = this.starts.length - 2;
    const stack = [this.starts[top]!, top];
    while (stack.length > 0) {
      const depth = stack.pop()!;
      const node = stack.pop()!;
      const k = 4 * node;
      if (!(maxX >= boxes[k]! && minX <= boxes[k + 2]! && maxY >= boxes[k + 1]! && minY <= boxes[k + 3]!)) continue;
      if (depth === 0) {
        found.push(this.refs[node]!);
        continue;
      }
      for (let child = this.refs[node]!, end = Math.min(child + NODE, this.starts[depth]!); child < end; child++) stack.push(child, depth - 1);
    }
    return found.sort((a, b) => a - b);
  }
}

/// Vero se `box` c'è e ha tutte le coordinate: un numero che non è un numero
/// fa fallire ogni confronto, e nell'albero guasterebbe i riquadri dei nodi.
function measured(box: Bounds | null): box is Bounds {
  return box !== null && !Number.isNaN(box.min[0]) && !Number.isNaN(box.min[1]) && !Number.isNaN(box.max[0]) && !Number.isNaN(box.max[1]);
}

/// L'ordine dei primi `count` riquadri di `boxes` che li raccoglie a `NODE` a
/// `NODE` in nodi vicini: per il centro in x, in fette di nodi interi, e
/// dentro ogni fetta per il centro in y.
function tiled(boxes: Float64Array, count: number): Uint32Array {
  const order = new Uint32Array(count);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    order[k] = k;
    xs[k] = centre(boxes[4 * k]!, boxes[4 * k + 2]!);
    ys[k] = centre(boxes[4 * k + 1]!, boxes[4 * k + 3]!);
  }
  const slice = Math.max(1, Math.ceil(Math.sqrt(Math.ceil(count / NODE)))) * NODE;
  group(order, xs, 0, count, slice);
  for (let from = 0; from < count; from += slice) group(order, ys, from, Math.min(from + slice, count), NODE);
  return order;
}

/// Il centro dell'intervallo da `min` a `max`, senza traboccare; 0 se non è
/// un numero, come fra -∞ e +∞. Serve soltanto all'ordine.
function centre(min: number, max: number): number {
  const centre = min / 2 + max / 2;
  return Number.isNaN(centre) ? 0 : centre;
}

/// Divide `order` da `from` a `to` in blocchi di `size`, contati da `from`,
/// in ordine di `keys`: ogni chiave di un blocco non supera quelle dei
/// blocchi dopo. Dentro un blocco l'ordine resta qualunque, e così costa
/// meno di un ordine intero. Si esporta per le prove: è ciò che fa l'albero
/// veloce, non giusto.
export function group(order: Uint32Array, keys: Float64Array, from: number, to: number, size: number): void {
  const pending = [from, to];
  while (pending.length > 0) {
    const end = pending.pop()!;
    const start = pending.pop()!;
    if (end - start <= size) continue;
    const cut = start + size * (Math.ceil((end - start) / size) >> 1);
    select(order, keys, start, end - 1, cut);
    pending.push(start, cut, cut, end);
  }
}

/// Mette in `order[nth]` la posizione con la chiave che le spetta fra
/// `left` e `right` compresi: prima nessuna chiave più grande, dopo nessuna
/// più piccola (la selezione di Hoare).
function select(order: Uint32Array, keys: Float64Array, left: number, right: number, nth: number): void {
  while (left < right) {
    const pivot = keys[order[(left + right) >> 1]!]!;
    let i = left;
    let j = right;
    while (i <= j) {
      while (keys[order[i]!]! < pivot) i++;
      while (keys[order[j]!]! > pivot) j--;
      if (i <= j) {
        const swap = order[i]!;
        order[i] = order[j]!;
        order[j] = swap;
        i++;
        j--;
      }
    }
    // Da `left` a `j` nessuna chiave supera la soglia, da `i` a `right`
    // nessuna sta sotto, e fra i due ci sono soltanto chiavi uguali.
    if (nth <= j) right = j;
    else if (nth >= i) left = i;
    else return;
  }
}
