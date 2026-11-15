import { describe, expect, it } from "vitest";
import vectors from "../../__fixtures__/ink-cut.json";
import { formatInkBrush, parseInkBrush } from "../brush";
import type { InkSample } from "../sample";
import { cutBrush, splitInk, type InkPiece } from "./split";
import type { Spot } from "./sweep";

// I casi della gomma che taglia, scritti a mano in `ink-cut.json`, contro
// `split.ts`, che fa fede. Gli stessi casi girano in Rust contro `cut.rs` di
// `fub-ink-codec` (`tests/cut_vectors.rs`): così il taglio del nucleo
// (`erase_along`) e quello della tela danno gli stessi pezzi.

interface PieceCase {
  readonly cutStart: boolean;
  readonly cutEnd: boolean;
  readonly offset: number;
  readonly samples: readonly InkSample[];
}

interface SplitCase {
  readonly name: string;
  readonly samples: readonly InkSample[];
  readonly path: readonly Spot[];
  readonly radius: number;
  readonly expect: readonly PieceCase[] | null;
}

interface BrushCase {
  readonly name: string;
  readonly brush: string;
  readonly cutStart: boolean;
  readonly cutEnd: boolean;
  readonly expect: string;
}

const tolerance: number = vectors.tolerance;
const splits = vectors.split as unknown as readonly SplitCase[];
const brushes = vectors.brush as readonly BrushCase[];

function close(got: number | undefined, want: number | undefined): boolean {
  if (got === undefined || want === undefined) return got === want;
  return Math.abs(got - want) <= tolerance;
}

function sameSample(got: InkSample, want: InkSample): boolean {
  return close(got.x, want.x) && close(got.y, want.y) && close(got.t, want.t)
    && close(got.p, want.p) && close(got.a, want.a) && close(got.z, want.z);
}

function checkPieces(name: string, got: readonly InkPiece[], want: readonly PieceCase[]): void {
  expect(got.length, `${name}: quanti pezzi`).toBe(want.length);
  got.forEach((piece, at) => {
    const expected = want[at]!;
    const what = `${name}, pezzo ${at}`;
    expect([piece.cutStart, piece.cutEnd], `${what}: i tagli`).toEqual([expected.cutStart, expected.cutEnd]);
    expect(close(piece.offset, expected.offset), `${what}: offset ${piece.offset}`).toBe(true);
    expect(piece.samples.length, `${what}: quanti campioni`).toBe(expected.samples.length);
    piece.samples.forEach((sample, i) => {
      const wanted = expected.samples[i]!;
      expect(sameSample(sample, wanted), `${what}, campione ${i}: ${JSON.stringify(sample)} invece di ${JSON.stringify(wanted)}`).toBe(true);
    });
  });
}

describe("ink-cut.json contro split.ts", () => {
  it("ci sono i sei casi del piano", () => {
    const names = splits.map((each) => each.name);
    for (const name of ["meta", "inizio", "fine", "intero", "nessun-tocco", "tocco-cancellato"]) {
      expect(names).toContain(name);
    }
  });

  for (const each of splits) {
    it(`splitInk: ${each.name}`, () => {
      const pieces = splitInk(each.samples, each.path, each.radius);
      if (each.expect === null) {
        expect(pieces).toBeNull();
        return;
      }
      expect(pieces).not.toBeNull();
      checkPieces(each.name, pieces!, each.expect);
    });
  }

  for (const each of brushes) {
    it(`cutBrush: ${each.name}`, () => {
      const cut = cutBrush(parseInkBrush(each.brush), { cutStart: each.cutStart, cutEnd: each.cutEnd });
      expect(formatInkBrush(cut)).toBe(each.expect);
    });
  }
});
