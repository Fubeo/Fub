// Ripennare (P10): i tratti scelti si ridisegnano dai loro campioni con
// un'altra penna, misura, colore o opacità, o levigati; un annulla torna al
// byte, e un tratto già in tracciato resta com'è.

import { describe, expect, it } from "vitest";
import { parseBrush, penOf } from "../../../ink/brush";
import { pf1 } from "../../../ink/pf1";
import { NO_STABILIZER } from "../../../ink/input/stabilizer";
import { decodeInk, inkToQuantized } from "../ink/codec";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import { repenOps, type Repen, type Repenned } from "./repen";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const INK = "1 s100 cxypt 12050,3020,128,0 2500,-300,2,8 3100,-500,0,8 2900,700,0,8 -1500,2000,0,8";
const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

const stroke = (id: string, extra = "", tool = "pen"): string =>
  `<path id="${id}" fub:tool="${tool}" fub:brush="${BRUSH}" fill="#000000"${extra} fub:ink="${INK}" d="${pf1(inkToQuantized(decodeInk(INK)), parseBrush(BRUSH))}"/>`;

/// Scrive il comando, prova che un annulla torna al byte, e lo riscrive.
function written(opened: Opened, change: Repenned): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  return after;
}

const repen = (opened: Opened, change: Repen): Repenned => repenOps(opened.engine.model!, opened.index.units, change, ids(opened));
const attr = (text: string, id: string, name: string): string | null => {
  const element = new RegExp(`<path id="${id}"[^>]*>`).exec(text)![0];
  return new RegExp(` ${name}="([^"]*)"`).exec(element)?.[1] ?? null;
};

describe("ripennare i tratti scelti", () => {
  it("un'altra penna e un'altra misura ridisegnano dai campioni, e il motore ricalcola il tratto", () => {
    const opened = open(doc(`${LAYER}${stroke("s")}</g>`));
    const d = attr(opened.engine.text, "s", "d");
    const change = repen(opened, { pen: "marker", size: 10 });
    expect(change).toMatchObject({ changed: 1, kept: 0, keys: ["s"] });
    const text = written(opened, change);
    const brush = parseBrush(attr(text, "s", "fub:brush")!);
    expect(penOf(brush)).toBe("marker");
    expect(brush.size).toBe(10);
    // L'inchiostro resta, il tratto si ridisegna; il pennarello copre al 92 %.
    expect(attr(text, "s", "fub:ink")).toBe(INK);
    expect(attr(text, "s", "d")).not.toBe(d);
    expect(attr(text, "s", "fill-opacity")).toBe("0.92");
  });

  it("colore e opacità cambiano soltanto quelli; l'opacità di chi disegna resta con un'altra penna", () => {
    const opened = open(doc(`${LAYER}${stroke("s")}</g>`));
    const text = written(opened, repen(opened, { color: "#0072b2", opacity: 0.5 }));
    expect(attr(text, "s", "fill")).toBe("#0072b2");
    expect(attr(text, "s", "fill-opacity")).toBe("0.5");
    expect(attr(text, "s", "fub:brush")).toBe(BRUSH);
    const again = written(opened, repenOps(opened.engine.model!, opened.reindex().units, { pen: "marker" }, ids(opened)));
    expect(attr(again, "s", "fill-opacity")).toBe("0.46");
  });

  it("un tratto dell'evidenziatore tiene la sua penna e la sua fusione", () => {
    const opened = open(doc(`${LAYER}${stroke("h", ' fill-opacity="0.5" style="mix-blend-mode: multiply"', "highlighter")}</g>`));
    const text = written(opened, repen(opened, { pen: "marker", size: 20 }));
    const brush = parseBrush(attr(text, "h", "fub:brush")!);
    expect(penOf(brush)).toBe("highlighter");
    expect(brush.size).toBe(20);
    expect(attr(text, "h", "style")).toBe("mix-blend-mode: multiply");
  });

  it("«Leviga» ripassa i campioni dallo stabilizzatore, in un passo", () => {
    const opened = open(doc(`${LAYER}${stroke("s")}</g>`));
    const text = written(opened, repen(opened, { smooth: { config: { ...NO_STABILIZER, amount: 0.6 }, zoom: 1 } }));
    const ink = attr(text, "s", "fub:ink")!;
    expect(ink).not.toBe(INK);
    // Il primo e l'ultimo campione restano: il tratto comincia e finisce dov'era.
    const before = inkToQuantized(decodeInk(INK)).samples;
    const after = inkToQuantized(decodeInk(ink)).samples;
    expect([after[0]!.x, after[0]!.y]).toEqual([before[0]!.x, before[0]!.y]);
    expect([after[after.length - 1]!.x, after[after.length - 1]!.y]).toEqual([before[before.length - 1]!.x, before[before.length - 1]!.y]);
  });

  it("un tratto già in tracciato, o un oggetto qualunque, resta com'è e si conta", () => {
    const opened = open(doc(`${LAYER}${stroke("s")}<path id="p" d="M0 0 L10 10" fill="#000000"/><rect id="r" width="5" height="5"/></g>`));
    const change = repen(opened, { size: 8 });
    expect(change).toMatchObject({ changed: 1, kept: 2 });
    written(opened, change);
  });

  it("niente da cambiare, niente operazioni", () => {
    const opened = open(doc(`${LAYER}${stroke("s")}</g>`));
    expect(repen(opened, { color: "#000000" })).toEqual({ ops: [], keys: ["s"], changed: 0, kept: 0 });
  });
});
