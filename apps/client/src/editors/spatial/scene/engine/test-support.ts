// I documenti di prova e gli aiuti dei test del motore delle operazioni
// (`engine*.test.ts`): applicare un'operazione controllando le invarianti
// di §6, e controllare un rifiuto.

import { expect } from "vitest";
import { tryApplyOperation } from "../../../core/text-operation";
import { SceneEngine, type Applied, type Outcome } from "../engine";
import type { Op, Reason } from "../ops";
import { readScene } from "../read";
import type { Elem } from "../serialize";
import { normalizeEol } from "../text";

export const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1"';
export const FUB_NS = "https://fubeo.github.io/ns/scene/1";
export const ROOT = `<svg ${NS} fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">`;
export const TITLE = "  <title>Prova</title>";
export const PAPER = '  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>';
export const L1 = '  <g id="l3f8a0c2d" fub:layer="Livello 1">';
export const L1_LOCKED = '  <g id="l3f8a0c2d" fub:layer="Livello 1" fub:locked="true">';
export const L2 = '  <g id="l9k8j7h6g" fub:layer="Livello 2">';
export const L2_LOCKED = '  <g id="l9k8j7h6g" fub:layer="Livello 2" fub:locked="true">';
export const END_G = "  </g>";
export const END = "</svg>";
export const E1 = '    <ellipse id="o1a2b3c4d" cx="300" cy="200" rx="120" ry="60" fill="none" stroke="#0072b2" stroke-width="4"/>';
export const R2 = '    <rect id="o2b3c4d5e" x="500" y="100" width="200" height="120" fill="#e69f00"/>';
export const R3 = '    <rect id="o3c4d5e6f" x="800" y="100" width="200" height="120" fill="#009e73"/>';
export const R4 = '    <rect id="o4d5e6f7g" x="10" y="20" width="30" height="40"/>';
export const R4_ELEM: Elem = { tag: "rect", attrs: { id: "o4d5e6f7g", x: "10", y: "20", width: "30", height: "40" } };

export const INK = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
export const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

export const lf = (...lines: string[]): string => `${lines.join("\n")}\n`;
export const BASE = lf(ROOT, TITLE, PAPER, L1, E1, R2, R3, END_G, END);
export const TWO_LAYERS = lf(ROOT, TITLE, PAPER, L1, E1, R2, END_G, L2, R3, END_G, END);

export function applied(outcome: Outcome): Applied {
  if (outcome.outcome !== "applied") throw new Error(`rifiutata: ${outcome.reason} (${outcome.detail})`);
  return outcome;
}

/// Applica `op` e controlla le invarianti di §6 sul risultato.
export function apply(engine: SceneEngine, op: Op): Applied {
  const before = engine.normalized;
  const out = applied(engine.apply(op));
  expect(tryApplyOperation(before, out.operation)).toEqual({ kind: "applied", text: normalizeEol(out.text) });
  expect(engine.scene()).toEqual(readScene(out.text).items);
  return out;
}

export function rejects(source: string, op: unknown, reason: Reason): void {
  const engine = SceneEngine.open(source);
  const outcome = engine.apply(op as Op);
  expect(outcome, JSON.stringify(op).slice(0, 200)).toMatchObject({ outcome: "rejected", reason });
  expect(engine.text).toBe(source);
  expect(engine.scene()).toEqual(readScene(source).items);
}
