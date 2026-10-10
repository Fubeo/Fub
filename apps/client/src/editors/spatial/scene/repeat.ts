// Le ripetizioni (formato della scena, ripetizioni): un gruppo con
// `fub:repeat` mostra più volte un oggetto, l'originale, intorno a un
// centro, su una griglia o allo specchio. Le copie sono `use` fratelli
// dell'originale, ciascuno con la sua `transform`; cambiare l'originale
// cambia ogni copia, perché un `use` mostra ciò a cui rimanda com'è.
//
// - **Ciò che è scritto è ciò che si vede.** Ogni copia porta la sua
//   trasformazione, e un altro programma disegna le copie senza sapere
//   niente di `fub:repeat`, che serve a FubDraw per rifarle quando la
//   ripetizione cambia.
// - **Le copie non dipendono dall'originale:** il centro, i passi e l'asse
//   stanno nelle coordinate del gruppo, e le trasformazioni delle copie
//   vengono soltanto da loro. L'originale si modifica, si sposta e cresce, e
//   le copie lo seguono senza che il file cambi altrove.
// - **La lettura vuole la grammatica intera:** un tipo sconosciuto, un
//   numero di valori sbagliato, un conto fuori dai limiti o un valore che
//   non è un numero lasciano un gruppo qualunque, e le sue copie restano
//   `use` estranei.
//
// È `repeat.rs` di `fub-scene`, regola per regola: i casi scritti a mano in
// `apps/client/src/__fixtures__/scene-repeat/cases.json` valgono per tutte e
// due.

import { formatNumber } from "../number";
import type { Matrix, Point } from "./matrix";
import { number } from "./values";

/// Quante volte al più una ripetizione radiale mostra l'originale, lui
/// compreso.
export const MAX_RADIAL = 100;

/// Quante colonne, e quante righe, ha al più una griglia.
export const MAX_GRID_SIDE = 100;

/// Quante volte al più una griglia mostra l'originale, lui compreso.
export const MAX_GRID = 1000;

/// Una ripetizione letta.
///
/// - **radiale:** l'originale `count` volte, ruotato intorno a `center` di
///   un giro diviso in parti uguali;
/// - **griglia:** `columns` × `rows` volte, spostato di `step` per colonna
///   e per riga;
/// - **specchio:** l'originale e la sua immagine riflessa sulla retta per i
///   due punti di `axis`.
export type Repeat =
  | { readonly kind: "radial"; readonly count: number; readonly center: Point }
  | { readonly kind: "grid"; readonly columns: number; readonly rows: number; readonly step: Point }
  | { readonly kind: "mirror"; readonly axis: readonly [Point, Point] };

/// Gli spazi di SVG, che separano le parole.
const SPACES = /[ \t\n\r\f]+/;

/// Un conto: cifre e basta, fra `least` e `most`.
function count(word: string, least: number, most: number): number | null {
  if (!/^[0-9]+$/.test(word)) return null;
  const value = Number(word);
  return value >= least && value <= most ? value : null;
}

/// Un numero finito, la parola intera.
function coordinate(word: string): number | null {
  const value = number(word);
  return value !== null && Number.isFinite(value) ? value : null;
}

/// La forma di `fub:repeat`; `null` fuori dalla grammatica: il tipo scritto
/// esatto, minuscolo, e dopo, separati da spazi,
///
/// - `radial <volte> <cx> <cy>`, con le volte da 2 a [`MAX_RADIAL`];
/// - `grid <colonne> <righe> <dx> <dy>`, con colonne e righe da 1 a
///   [`MAX_GRID_SIDE`] e il loro prodotto da 2 a [`MAX_GRID`];
/// - `mirror <x1> <y1> <x2> <y2>`, con i due punti diversi.
///
/// I conti sono cifre, i numeri quelli di SVG.
export function readRepeat(value: string): Repeat | null {
  const words = value.split(SPACES).filter((word) => word !== "");
  const [kind, ...rest] = words;
  switch (kind) {
    case "radial": {
      if (rest.length !== 3) return null;
      const times = count(rest[0]!, 2, MAX_RADIAL);
      const cx = coordinate(rest[1]!);
      const cy = coordinate(rest[2]!);
      return times === null || cx === null || cy === null ? null : { kind, count: times, center: [cx, cy] };
    }
    case "grid": {
      if (rest.length !== 4) return null;
      const columns = count(rest[0]!, 1, MAX_GRID_SIDE);
      const rows = count(rest[1]!, 1, MAX_GRID_SIDE);
      const dx = coordinate(rest[2]!);
      const dy = coordinate(rest[3]!);
      if (columns === null || rows === null || dx === null || dy === null) return null;
      const total = columns * rows;
      return total < 2 || total > MAX_GRID ? null : { kind, columns, rows, step: [dx, dy] };
    }
    case "mirror": {
      if (rest.length !== 4) return null;
      const [x1, y1, x2, y2] = rest.map(coordinate);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
      if (x1 === x2 && y1 === y2) return null;
      return { kind, axis: [[x1!, y1!], [x2!, y2!]] };
    }
    default:
      return null;
  }
}

/// `fub:repeat` di `repeat`, coi numeri del formato: due decimali.
export function writeRepeat(repeat: Repeat): string {
  const n = (value: number): string => formatNumber(value, 2);
  switch (repeat.kind) {
    case "radial":
      return `radial ${repeat.count} ${n(repeat.center[0])} ${n(repeat.center[1])}`;
    case "grid":
      return `grid ${repeat.columns} ${repeat.rows} ${n(repeat.step[0])} ${n(repeat.step[1])}`;
    case "mirror": {
      const [[x1, y1], [x2, y2]] = repeat.axis;
      return `mirror ${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)}`;
    }
  }
}

/// Quante copie ha `repeat`, l'originale escluso.
export function copyCount(repeat: Repeat): number {
  switch (repeat.kind) {
    case "radial":
      return repeat.count - 1;
    case "grid":
      return repeat.columns * repeat.rows - 1;
    case "mirror":
      return 1;
  }
}

/// Le trasformazioni delle copie di `repeat`, nelle coordinate del gruppo e
/// nell'ordine in cui si scrivono dopo l'originale:
///
/// - **radiale:** la copia `k` ruota di `k` parti del giro intorno al
///   centro, in senso orario sullo schermo;
/// - **griglia:** per righe, poi per colonne, salvo la prima cella, che è
///   l'originale;
/// - **specchio:** la riflessione sull'asse.
///
/// Nessun valore è `-0`.
export function repeatMatrices(repeat: Repeat): Matrix[] {
  return matrices(repeat).map((m) => m.map((value) => value + 0) as unknown as Matrix);
}

/// Le trasformazioni di [`repeatMatrices`], con gli zeri come vengono.
function matrices(repeat: Repeat): Matrix[] {
  switch (repeat.kind) {
    case "radial": {
      const [cx, cy] = repeat.center;
      const out: Matrix[] = [];
      for (let k = 1; k < repeat.count; k++) {
        const [cos, sin] = turn(k, repeat.count);
        out.push([cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy]);
      }
      return out;
    }
    case "grid": {
      const out: Matrix[] = [];
      for (let row = 0; row < repeat.rows; row++) {
        for (let column = 0; column < repeat.columns; column++) {
          if (row !== 0 || column !== 0) out.push([1, 0, 0, 1, column * repeat.step[0], row * repeat.step[1]]);
        }
      }
      return out;
    }
    case "mirror": {
      const [[x1, y1], [x2, y2]] = repeat.axis;
      const length = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / length;
      const uy = (y2 - y1) / length;
      const a = 2 * ux * ux - 1;
      const b = 2 * ux * uy;
      const d = 2 * uy * uy - 1;
      return [[a, b, b, d, x1 - (a * x1 + b * y1), y1 - (b * x1 + d * y1)]];
    }
  }
}

/// Coseno e seno di `k` parti di un giro diviso in `n`, esatti sui quarti
/// di giro: `Math.cos(Math.PI / 2)` non è zero, e una copia girata di un
/// quarto non deve avere un millesimo di scarto.
function turn(k: number, n: number): [number, number] {
  if ((4 * k) % n === 0) {
    const quarter = ((4 * k) / n) % 4;
    return ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const)[quarter]!.slice() as [number, number];
  }
  const angle = (2 * Math.PI * k) / n;
  return [Math.cos(angle), Math.sin(angle)];
}
