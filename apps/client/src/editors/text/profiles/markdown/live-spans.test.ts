// Gli indici della Live rispondono come il giro lineare che sostituiscono, su
// intervalli a caso: vuoti, sovrapposti, uguali, in disordine.
import { describe, expect, it } from "vitest";
import { Coverage, grownSpan, RowSweep, SpanIndex, type Span } from "./live-spans";

/// Un generatore ripetibile (mulberry32): la stessa prova a ogni giro.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spans(next: () => number, count: number, extent: number, empty = true): Span[] {
  return Array.from({ length: count }, () => {
    const from = Math.floor(next() * extent);
    const length = Math.floor(next() * (next() < 0.2 ? extent / 2 : 8)) + (empty ? 0 : 1);
    return { from, to: from + length };
  });
}

describe("SpanIndex", () => {
  it("overlaps e covers come il giro lineare, anche aggiungendo in disordine", () => {
    const next = random(7);
    for (let round = 0; round < 200; round++) {
      const first = spans(next, Math.floor(next() * 30), 80);
      const later = spans(next, Math.floor(next() * 10), 80);
      const index = new SpanIndex(first);
      const all = [...first];
      const check = () => {
        for (let a = -2; a < 92; a += 3) {
          for (const b of [a - 1, a, a + 1, a + 5, a + 20]) {
            expect(index.overlaps(a, b)).toBe(all.some((r) => !(b <= r.from || a >= r.to)));
          }
          expect(index.covers(a)).toBe(all.some((r) => r.from <= a && a < r.to));
        }
      };
      check();
      for (const span of later) {
        index.add(span);
        all.push(span);
        check();
      }
      expect(index.size).toBe(all.length);
    }
  });
});

describe("RowSweep", () => {
  it("dà gli intervalli di ogni riga nell'ordine della lista, saltando righe", () => {
    const next = random(11);
    for (let round = 0; round < 200; round++) {
      const list = spans(next, Math.floor(next() * 40), 200);
      const sweep = new RowSweep(list);
      for (let from = 0; from < 210; ) {
        const to = from + Math.floor(next() * 12);
        if (next() < 0.7) expect(sweep.at(from, to)).toEqual(list.filter((s) => s.from < to && from < s.to));
        from = to + 1;
      }
    }
  });
});

describe("Coverage", () => {
  it("covers come lo sguardo carattere per carattere", () => {
    const next = random(13);
    for (let round = 0; round < 200; round++) {
      const list = spans(next, Math.floor(next() * 12), 60);
      const coverage = new Coverage(list);
      for (let a = -1; a < 64; a++) {
        for (let b = a - 1; b < a + 12; b++) {
          let hidden = true;
          for (let at = a; at < b; at++) if (!list.some((d) => d.from <= at && at < d.to)) hidden = false;
          expect(coverage.covers(a, b)).toBe(hidden);
        }
      }
    }
  });
});

/// Il punto fisso di prima: ogni segno che passa un bordo allarga il tratto,
/// finché un giro intero non allarga più niente.
function naiveGrow(from: number, to: number, marks: readonly Span[]): Span {
  for (let grown = true; grown; ) {
    grown = false;
    for (const other of marks) {
      const inside = other.from <= from && to <= other.to;
      const around = from <= other.from && other.to <= to;
      if (other.to <= from || to <= other.from || inside || around) continue;
      from = Math.min(from, other.from);
      to = Math.max(to, other.to);
      grown = true;
    }
  }
  return { from, to };
}

describe("grownSpan", () => {
  it("allarga come il punto fisso, in qualunque ordine siano i segni", () => {
    const next = random(17);
    for (let round = 0; round < 3000; round++) {
      const marks = spans(next, Math.floor(next() * 14), 60, false);
      const from = Math.floor(next() * 60);
      const to = from + 1 + Math.floor(next() * 6);
      expect(grownSpan(from, to, marks)).toEqual(naiveGrow(from, to, marks));
      expect(grownSpan(from, to, [...marks].reverse())).toEqual(naiveGrow(from, to, marks));
    }
  });

  it("una catena di segni accavallati si prende per intero", () => {
    const marks = [{ from: 10, to: 14 }, { from: 2, to: 6 }, { from: 12, to: 20 }, { from: 4, to: 11 }, { from: 0, to: 30 }];
    expect(grownSpan(5, 7, marks)).toEqual({ from: 2, to: 20 });
  });
});
