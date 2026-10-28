// Il riempimento di serie, come la maniglia dei fogli di calcolo: dai valori
// di partenza, quelli che seguono. Numeri in progressione (col passo degli
// ultimi due), un testo che finisce con un numero che cresce («Voce 1»,
// «Voce 2»), il resto ripetuto in ciclo.

import { cellNumber } from "./sort";

/// I `count` valori dopo `source`, nell'ordine in cui la maniglia li scrive.
/// `backward` riempie all'indietro (in su o a sinistra): la serie scende.
export function fillSeries(source: readonly string[], count: number, backward = false): string[] {
  if (count <= 0 || source.length === 0) return [];
  const seed = backward ? [...source].reverse() : [...source];
  const numbers = seed.map(cellNumber);
  if (numbers.every((value): value is number => value !== null)) {
    const step = seed.length > 1 ? numbers[numbers.length - 1]! - numbers[numbers.length - 2]! : 1;
    const signed = backward && seed.length === 1 ? -step : step;
    const comma = seed.some((text) => text.includes(","));
    const places = Math.max(...seed.map((text) => (/[.,](\d+)$/.exec(text.trim())?.[1]?.length ?? 0)));
    const last = numbers[numbers.length - 1]!;
    return Array.from({ length: count }, (_, i) => format(last + signed * (i + 1), places, comma));
  }
  const tail = seed.map((text) => /^(.*?)(\d+)$/u.exec(text));
  if (tail.every((match) => match !== null) && tail.every((match) => match![1] === tail[0]![1])) {
    const values = tail.map((match) => Number(match![2]));
    const step = values.length > 1 ? values[values.length - 1]! - values[values.length - 2]! : backward ? -1 : 1;
    const width = tail[tail.length - 1]![2]!.length;
    const prefix = tail[0]![1]!;
    const last = values[values.length - 1]!;
    return Array.from({ length: count }, (_, i) => {
      const value = last + step * (i + 1);
      if (value < 0) return seed[i % seed.length]!;
      return `${prefix}${String(value).padStart(width, "0")}`;
    });
  }
  return Array.from({ length: count }, (_, i) => seed[i % seed.length]!);
}

function format(value: number, places: number, comma: boolean): string {
  const text = places > 0 ? value.toFixed(places) : String(Math.round(value * 1e9) / 1e9);
  return comma ? text.replace(".", ",") : text;
}
