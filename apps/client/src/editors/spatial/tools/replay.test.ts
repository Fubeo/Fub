// Riproduci (P12): l'ordine dei tratti, le pause accorciate e ciò che si vede
// a un istante; il file non cambia.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { MAX_PAUSE_MS, replayFrame, replayPlan } from "./replay";
import { LAYER, open } from "./test-support";

const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";
const stroke = (id: string, at: string | null, ink: string): string =>
  `<path id="${id}" fub:tool="pen" fub:brush="${BRUSH}" fill="#000000"${at === null ? "" : ` fub:at="${at}"`} fub:ink="${ink}" d="M0 0"/>`;
// Tre campioni a 0, 100 e 2100 ms: l'ultima pausa si accorcia.
const SLOW = "1 s100 cxyt 1000,1000,0 500,0,100 500,0,2000";
const FAST = "1 s100 cxyt 3000,3000,0 500,0,50";

describe("Riproduci", () => {
  it("mette i tratti nell'ordine delle ore e accorcia le pause lunghe", () => {
    const opened = open(doc(`${LAYER}${stroke("b", "2026-10-28T10:00:05.000Z", FAST)}${stroke("a", "2026-10-28T10:00:00.000Z", SLOW)}<rect id="r" width="5" height="5"/></g>`));
    const plan = replayPlan(opened.index.units);
    expect(plan.strokes.map((each) => each.unit.key)).toEqual(["a", "b"]);
    expect(plan.strokes[0]!.times).toEqual([0, 100, 100 + MAX_PAUSE_MS]);
    // Fra la fine di «a» (2,1 s) e «b» (5 s) passano 2,9 s: si aspetta il massimo.
    expect(plan.strokes[1]!.times).toEqual([500 + MAX_PAUSE_MS, 550 + MAX_PAUSE_MS]);
    expect(plan.duration).toBe(550 + MAX_PAUSE_MS);
  });

  it("a un istante, i tratti non arrivati non si vedono e quello in corso è a metà", () => {
    const opened = open(doc(`${LAYER}${stroke("a", null, SLOW)}${stroke("b", null, FAST)}</g>`));
    const plan = replayPlan(opened.index.units);
    const [a, b] = plan.strokes.map((each) => each.unit);
    const start = replayFrame(plan, 0);
    expect(start.hidden).toEqual([b]);
    expect([...start.partial.keys()]).toEqual([a]);
    const middle = replayFrame(plan, 150);
    expect(middle.partial.get(a!)).not.toBe(start.partial.get(a!));
    const end = replayFrame(plan, plan.duration);
    expect(end).toMatchObject({ hidden: [], done: true });
    expect(end.partial.size).toBe(0);
  });

  it("senza tratti a penna non c'è niente da riprodurre", () => {
    const opened = open(doc(`${LAYER}<rect id="r" width="5" height="5"/></g>`));
    expect(replayPlan(opened.index.units)).toEqual({ strokes: [], duration: 0 });
  });
});
