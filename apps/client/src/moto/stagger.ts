// Lo sfalsamento: le voci di un elenco partono una dopo l'altra.
import { delayed, group, type Motion } from "./animate";
import { STAGGER_MAX, STAGGER_MS } from "./spring";

export interface StaggerOptions {
  /// Il ritardo fra una voce e la successiva (ms). Di serie `STAGGER_MS`.
  each?: number;
  /// Quante voci si sfalsano. Di serie `STAGGER_MAX`.
  max?: number;
}

/// Avvia una corsa per voce con un ritardo crescente. Oltre `max` voci le
/// successive partono insieme all'ultima sfalsata: un elenco lungo non fa
/// aspettare la coda.
///
/// Il ritardo si somma a ogni corsa che `start` avvia mentre è chiamata
/// (`animate`, `enter`, `flip`, un'uscita): non c'è niente da passare a mano.
/// Nel livello «ridotto» non c'è sfalsamento.
export function stagger<T>(
  items: Iterable<T>,
  start: (item: T, index: number) => Motion,
  options: StaggerOptions = {},
): Motion {
  const each = options.each ?? STAGGER_MS;
  const max = Math.max(1, options.max ?? STAGGER_MAX);
  const motions: Motion[] = [];
  let index = 0;
  for (const item of items) {
    const position = index++;
    motions.push(delayed(Math.min(position, max - 1) * each, () => start(item, position)));
  }
  return group(motions);
}
