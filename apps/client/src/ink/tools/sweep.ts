// Il gesto della gomma: un tratto che segna ciò che attraversa.
//
// La gomma non scrive campioni. Il puntatore percorre un cammino a segmenti, e
// ogni segmento segna le unità del prodotto (oggetti, tratti) che passano a
// meno del raggio della gomma. Il prodotto sa quali sono e come si cancellano:
// qui c'è soltanto il cammino e il registro di ciò che ha toccato, uguale per
// chiunque cancelli. Le unità si segnano una volta sola per chiave, anche se il
// cammino le attraversa più volte.

import type { InkPointerType } from "../input/pointer";
import type { EraseTool } from "./tool";

/// Un punto, nelle coordinate in cui il prodotto cerca le unità.
export type Spot = readonly [x: number, y: number];

/// Ciò che la gomma segna: ha una chiave che lo distingue.
export interface Erasable {
  readonly key: string;
}

/// Il prodotto vede quali unità tocca il segmento da `from` a `to`, dentro
/// `radius` (nelle sue coordinate). `marked` è ciò che la gomma ha già
/// segnato: un'unità che vi sta sotto la sua chiave, lo stesso oggetto, il
/// prodotto può non provarla, perché segnarla di nuovo non cambierebbe niente.
export interface EraseSource<U extends Erasable> {
  along(from: Spot, to: Spot, radius: number, marked: ReadonlyMap<string, U>): Iterable<U>;
}

export class EraseSweep<U extends Erasable> {
  private readonly radiusPx: number;
  private last: Spot | null = null;
  private readonly seen = new Map<string, U>();

  constructor(tool: EraseTool, pointer: InkPointerType) {
    this.radiusPx = tool.radius(pointer);
  }

  /// Il puntatore arriva in `p`: segna le unità del segmento dall'ultimo punto
  /// (o da `p` stesso, la prima volta). `scale` è quanti pixel dello schermo
  /// vale un'unità del prodotto.
  along(source: EraseSource<U>, p: Spot, scale: number): void {
    const from = this.last ?? p;
    this.last = p;
    for (const unit of source.along(from, p, this.radiusPx / scale, this.seen)) this.seen.set(unit.key, unit);
  }

  /// Le unità segnate, nell'ordine in cui sono state toccate.
  marked(): readonly U[] {
    return [...this.seen.values()];
  }

  get size(): number {
    return this.seen.size;
  }

  /// Il raggio della gomma, in pixel dello schermo.
  get radius(): number {
    return this.radiusPx;
  }
}
