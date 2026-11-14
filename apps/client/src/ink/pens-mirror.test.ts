import { describe, expect, it } from "vitest";
import { formatInkBrush, isNib1 } from "./brush";
import { INK_PALETTE } from "./palette";
import { DEFAULT_PEN, MAX_PEN_SIZE, MIN_PEN_SIZE, PEN_IDS, PENS, isPenId, penBrush } from "./pens";
// La fixture è generata dalle penne in Rust: vedi `crates/fub-ink-codec/tests/pens_mirror.rs`.
import mirror from "../__fixtures__/ink-pens.json";

// L'altra metà dello specchio delle penne. `pens.ts` e `palette.ts` fanno
// fede, e `crates/fub-ink-codec/src/pens.rs` li copia perché un tratto scritto
// in codice abbia lo stesso pennello di quello scritto con la GUI. La fixture
// porta, per ogni penna alle misure 0,25, 1, quella di serie e 200, con e senza
// pressione, il pennello che scrive Rust; qui `penBrush` deve dare lo stesso
// testo. Una cifra cambiata in `pens.ts` fa rosso questo test; una cambiata in
// Rust fa rosso `pens_mirror.rs`, finché non si rigenera con
// `UPDATE_MIRROR=1 cargo test -p fub-ink-codec --test pens_mirror`.

interface MirrorPen {
  id: string;
  tool: string;
  size: number;
  opacity: number;
  blend: string;
  pressure: boolean;
  algorithm: string;
}

interface MirrorBrush {
  pen: string;
  size: number;
  pressure: boolean;
  brush: string;
}

interface Mirror {
  min_size: number;
  max_size: number;
  default_pen: string;
  pens: MirrorPen[];
  brushes: MirrorBrush[];
  palette: { id: string; color: string }[];
}

const fixture = mirror as Mirror;

describe("lo specchio delle penne", () => {
  it("ha le stesse penne, nello stesso ordine, con gli stessi numeri", () => {
    expect(fixture.pens.map((pen) => pen.id)).toEqual([...PEN_IDS]);
    for (const pen of fixture.pens) {
      if (!isPenId(pen.id)) throw new Error(`non è una penna: ${pen.id}`);
      const spec = PENS[pen.id];
      expect({
        id: spec.id,
        tool: spec.tool,
        size: spec.size,
        opacity: spec.opacity,
        blend: spec.blend,
        pressure: spec.pressure,
        algorithm: isNib1(spec.recipe(spec.size)) ? "nib1" : "pf1",
      }).toEqual(pen);
    }
    expect(fixture.default_pen).toBe(DEFAULT_PEN);
    expect(fixture.min_size).toBe(MIN_PEN_SIZE);
    expect(fixture.max_size).toBe(MAX_PEN_SIZE);
  });

  it("dà lo stesso pennello per ogni penna, misura e pressione", () => {
    expect(fixture.brushes).toHaveLength(PEN_IDS.length * 4 * 2);
    for (const { pen, size, pressure, brush } of fixture.brushes) {
      if (!isPenId(pen)) throw new Error(`non è una penna: ${pen}`);
      expect(formatInkBrush(penBrush(pen, size, pressure)), `${pen} ${size} ${pressure}`).toBe(brush);
    }
  });

  it("copre le misure del piano per ogni penna", () => {
    for (const id of PEN_IDS) {
      const sizes = new Set(fixture.brushes.filter((each) => each.pen === id).map((each) => each.size));
      expect([...sizes].sort((a, b) => a - b)).toEqual([...new Set([MIN_PEN_SIZE, 1, PENS[id].size, MAX_PEN_SIZE])].sort((a, b) => a - b));
    }
  });

  it("ha la stessa tavolozza, nello stesso ordine", () => {
    expect(fixture.palette).toEqual(INK_PALETTE.map(({ id, color }) => ({ id, color })));
  });
});
