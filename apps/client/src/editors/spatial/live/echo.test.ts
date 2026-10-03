// L'eco canonica: lo scrittore riceve gli elementi come stanno nel
// documento, col `d` che il motore ha calcolato.

import { describe, expect, it } from "vitest";
import { formatBrush, PF1_DEFAULTS } from "../ink/brush";
import { quantizeInk } from "../ink/sample";
import { SceneEngine } from "../scene/engine";
import type { AddOp, Op } from "../scene/ops";
import { strokeElem } from "../tools/edit";
import { addedIds, canonicalEcho, elemOf } from "./echo";

const HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300">';
const HOUSE =
  `${HEAD}\n  <title>Casa</title>\n  <g id="l1" fub:layer="Livello 1">\n    <rect id="o1a2b3c4d" x="60" y="60" width="80" height="60" fill="none" stroke="#000000" stroke-width="4"/>\n  </g>\n</svg>\n`;

const INK = quantizeInk([
  { x: 10, y: 10, p: 0.5, t: 0 },
  { x: 40, y: 30, p: 0.6, t: 8 },
  { x: 80, y: 35, p: 0.4, t: 16 },
]);

const stroke = (id: string): AddOp => ({
  op: "add",
  parent: "l1",
  pos: { last: true },
  elem: strokeElem(id, "#202020", PF1_DEFAULTS, INK, null),
});

function applied(op: Op): SceneEngine {
  const engine = SceneEngine.open(HOUSE);
  const outcome = engine.apply(op);
  if (outcome.outcome !== "applied") throw new Error(outcome.detail);
  return engine;
}

describe("l'eco canonica", () => {
  it("un tratto torna col d che il documento ha", () => {
    const op = stroke("o5e6f7a8b");
    expect(op.elem.attrs.d).toBeUndefined();
    const engine = applied(op);
    const echo = canonicalEcho(engine, op) as AddOp;
    expect(echo.parent).toBe("l1");
    expect(echo.elem.attrs.d).toMatch(/^M/);
    expect(engine.text).toContain(`d="${echo.elem.attrs.d}"`);
    expect(echo.elem).toEqual(elemOf(engine, "o5e6f7a8b"));
  });

  it("un set su un tratto porta il d nuovo; le altre operazioni tornano come sono", () => {
    const engine = applied(stroke("o5e6f7a8b"));
    const brush = formatBrush({ ...PF1_DEFAULTS, size: 30 });
    const set: Op = { op: "set", id: "o5e6f7a8b", attrs: { "fub:brush": brush } };
    expect(engine.apply(set).outcome).toBe("applied");
    const echo = canonicalEcho(engine, set);
    expect(echo).toMatchObject({ op: "set", id: "o5e6f7a8b", attrs: { "fub:brush": brush } });
    expect((echo as { attrs: Record<string, string> }).attrs.d).toBe(elemOf(engine, "o5e6f7a8b")!.attrs.d);
    const rect: Op = { op: "set", id: "o1a2b3c4d", attrs: { fill: "#ff0000" } };
    expect(engine.apply(rect).outcome).toBe("applied");
    expect(canonicalEcho(engine, rect)).toEqual(rect);
    const page: Op = { op: "page", viewBox: "0 0 800 600" };
    expect(canonicalEcho(engine, page)).toBe(page);
  });

  it("dentro un batch ogni operazione ha la sua eco", () => {
    const batch: Op = { op: "batch", ops: [stroke("o5e6f7a8b"), { op: "page", viewBox: "0 0 800 600" }] };
    const engine = applied(batch);
    const echo = canonicalEcho(engine, batch) as unknown as { ops: Op[] };
    expect((echo.ops[0] as AddOp).elem.attrs.d).toMatch(/^M/);
    expect(echo.ops[1]).toEqual({ op: "page", viewBox: "0 0 800 600" });
  });

  it("legge gli id aggiunti anche da una forma che il motore rifiuterebbe", () => {
    expect([...addedIds({ op: "batch", ops: [stroke("o1"), { op: "add", elem: { attrs: { id: "o2" } } }, null, 3] })]).toEqual(["o1", "o2"]);
    expect([...addedIds({ op: "add", slot: 1, elem: { attrs: { id: "o3" } } })]).toEqual([]);
    expect([...addedIds("add")]).toEqual([]);
  });
});
