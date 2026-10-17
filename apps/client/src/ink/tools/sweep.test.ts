import { describe, expect, it } from "vitest";
import { ERASER } from "./eraser";
import { EraseSweep, type Erasable, type EraseSource, type Spot } from "./sweep";

interface Unit extends Erasable {
  readonly key: string;
  readonly at: Spot;
}

/// Un indice di prova: le unità a meno di `radius` dal segmento.
function index(units: readonly Unit[], seen: { from: Spot; to: Spot; radius: number }[] = []): EraseSource<Unit> {
  return {
    along(from, to, radius) {
      seen.push({ from, to, radius });
      return units.filter((unit) => distance(unit.at, from, to) <= radius);
    },
  };
}

function distance(p: Spot, a: Spot, b: Spot): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const k = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + k * dx), p[1] - (a[1] + k * dy));
}

const unit = (key: string, x: number, y: number): Unit => ({ key, at: [x, y] });

describe("il gesto della gomma", () => {
  it("la prima volta il segmento è il punto stesso, poi va dall'ultimo punto al nuovo", () => {
    const seen: { from: Spot; to: Spot; radius: number }[] = [];
    const source = index([], seen);
    const sweep = new EraseSweep<Unit>(ERASER, "mouse");
    sweep.along(source, [10, 10], 1);
    sweep.along(source, [20, 10], 1);
    expect(seen.map(({ from, to }) => [from, to])).toEqual([
      [[10, 10], [10, 10]],
      [[10, 10], [20, 10]],
    ]);
  });

  it("il raggio è quello della gomma per il dispositivo, in unità del prodotto", () => {
    const seen: { from: Spot; to: Spot; radius: number }[] = [];
    new EraseSweep<Unit>(ERASER, "touch").along(index([], seen), [0, 0], 2);
    new EraseSweep<Unit>(ERASER, "pen").along(index([], seen), [0, 0], 0.5);
    expect(seen.map(({ radius }) => radius)).toEqual([8, 16]);
  });

  it("segna ciò che il cammino attraversa e ciò che sfiora, nell'ordine in cui lo tocca", () => {
    const units = [unit("a", 15, 0), unit("b", 100, 100), unit("c", 40, 3)];
    const sweep = new EraseSweep<Unit>(ERASER, "mouse");
    const source = index(units);
    sweep.along(source, [0, 0], 1);
    sweep.along(source, [20, 0], 1);
    sweep.along(source, [60, 0], 1);
    expect(sweep.marked().map((each) => each.key)).toEqual(["a", "c"]);
    expect(sweep.size).toBe(2);
  });

  it("un'unità attraversata più volte si segna una volta sola", () => {
    const sweep = new EraseSweep<Unit>(ERASER, "mouse");
    const source = index([unit("a", 10, 0)]);
    for (const x of [0, 20, 0, 20, 0]) sweep.along(source, [x, 0], 1);
    expect(sweep.marked()).toHaveLength(1);
  });

  it("un cammino che non incontra niente non segna niente", () => {
    const sweep = new EraseSweep<Unit>(ERASER, "mouse");
    sweep.along(index([unit("a", 50, 50)]), [0, 0], 1);
    sweep.along(index([unit("a", 50, 50)]), [10, 0], 1);
    expect(sweep.marked()).toEqual([]);
    expect(sweep.size).toBe(0);
  });

  it("l'elenco che si legge non cambia ciò che la gomma ha segnato", () => {
    const sweep = new EraseSweep<Unit>(ERASER, "mouse");
    sweep.along(index([unit("a", 0, 0)]), [0, 0], 1);
    const marked = sweep.marked() as Unit[];
    marked.length = 0;
    expect(sweep.size).toBe(1);
  });
});
