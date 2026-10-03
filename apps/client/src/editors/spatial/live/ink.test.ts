// @vitest-environment happy-dom
//
// L'inchiostro del tablet sull'overlay del PC: un disegno per fotogramma,
// la stessa forma che il commit scriverà, e nessun tratto che resta appeso.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatBrush, parseBrush, PF1_DEFAULTS } from "../ink/brush";
import { pf1Outline } from "../ink/pf1";
import { INK_MAX_SAMPLES, quantizeInk } from "../ink/sample";
import { ROOT } from "../scene/ops";
import { createLiveInk, INK_COMMIT_MS, type LiveInk } from "./ink";
import { fakeStage, type FakeStage } from "./test-support";

const BRUSH = formatBrush({ ...PF1_DEFAULTS, size: 6 });

let frames: FrameRequestCallback[] = [];
let stages: FakeStage[] = [];
let latencies: number[] = [];
let lost = 0;
let ink: LiveInk;

/// Il prossimo fotogramma, all'istante `time` del documento.
function frame(time = 0): void {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(time);
}

beforeEach(() => {
  frames = [];
  latencies = [];
  lost = 0;
  stages = [fakeStage()];
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  ink = createLiveInk({
    stages: () => stages,
    latency: (ms) => latencies.push(ms),
    lost: (count) => {
      lost += count;
    },
  });
});

afterEach(() => {
  ink.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const begin = (s: string, extra: Partial<{ layer: string; fill: string; fillOpacity: number; brush: string }> = {}, pressure = true) =>
  ink.begin({ t: "inkBegin", s, layer: ROOT, tool: "pen", fill: "#112233", fillOpacity: 1, brush: BRUSH, ...extra }, pressure);

const points = (s: string, pts: [number, number, number, number][]) => ink.points({ t: "inkPoints", s, pts });

describe("l'inchiostro live", () => {
  it("raccoglie i messaggi di un fotogramma in un solo disegno", () => {
    begin("o1");
    points("o1", [[10, 10, 0.5, 1000]]);
    points("o1", [[12, 11, 0.6, 1008], [14, 12, 0.7, 1016]]);
    expect(frames).toHaveLength(1);
    expect(stages[0]!.log).toEqual([]);
    frame();
    expect(stages[0]!.log).toEqual(["set live:o1", "flush"]);
    expect(stages[0]!.inks.get("live:o1")).toMatchObject({ color: "#112233", opacity: 1 });
  });

  it("disegna la stessa forma che il commit scriverà", () => {
    begin("o1");
    const pts: [number, number, number, number][] = [[10, 10, 0.25, 500], [20, 14, 0.5, 508], [30, 22, 0.75, 516]];
    points("o1", pts);
    ink.end("o1");
    frame();
    const expected = pf1Outline(
      quantizeInk(pts.map(([x, y, p, t]) => ({ x, y, p, t: t - 500 }))),
      parseBrush(BRUSH),
      { last: true },
    );
    expect(stages[0]!.inks.get("live:o1")!.outline).toEqual(expected);
  });

  it("porta i campioni nelle coordinate del livello, e senza pressione non la inventa", () => {
    stages = [fakeStage({ layers: { l1: [2, 0, 0, 2, 100, 0] } })];
    begin("o1", { layer: "l1" }, false);
    points("o1", [[110, 10, 0.9, 0], [130, 30, 0.9, 10]]);
    ink.end("o1");
    frame();
    const shown = stages[0]!.inks.get("live:o1")!;
    expect(shown.matrix).toEqual([2, 0, 0, 2, 100, 0]);
    const expected = pf1Outline(quantizeInk([{ x: 5, y: 5, t: 0 }, { x: 15, y: 15, t: 10 }]), parseBrush(BRUSH), { last: true });
    expect(shown.outline).toEqual(expected);
  });

  it("toglie il tratto quando il commit risponde, nello stesso giro e con un flush", () => {
    begin("o1");
    points("o1", [[10, 10, 0.5, 0]]);
    ink.end("o1");
    frame();
    stages[0]!.log.length = 0;
    ink.settle(new Set(["o1", "altro"]));
    expect(stages[0]!.log).toEqual(["clear live:o1", "flush"]);
    expect(frames).toHaveLength(0);
  });

  it("toglie un tratto finito senza commit dopo tre secondi, e lo conta perso", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    begin("o1");
    points("o1", [[10, 10, 0.5, 0]]);
    ink.end("o1");
    frame();
    vi.advanceTimersByTime(INK_COMMIT_MS - 1);
    expect(stages[0]!.inks.has("live:o1")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(stages[0]!.inks.has("live:o1")).toBe(false);
    expect(lost).toBe(1);
  });

  it("un buco dell'host toglie i tratti e ignora i loro punti successivi", () => {
    begin("o1");
    points("o1", [[10, 10, 0.5, 0]]);
    frame();
    ink.gap(["o1", "o2"]);
    expect(stages[0]!.inks.size).toBe(0);
    expect(lost).toBe(2);
    points("o1", [[11, 11, 0.5, 8]]);
    expect(frames).toHaveLength(0);
  });

  it("annullato, o lo scrittore uscito, il tratto in corso sparisce", () => {
    begin("o1");
    begin("o2");
    points("o1", [[10, 10, 0.5, 0]]);
    points("o2", [[50, 50, 0.5, 0]]);
    ink.end("o2");
    frame();
    ink.cancel("o1");
    expect([...stages[0]!.inks.keys()]).toEqual(["live:o2"]);
    begin("o3");
    points("o3", [[70, 70, 0.5, 0]]);
    frame();
    ink.abandon();
    // Il tratto finito aspetta ancora il suo commit, che può arrivare con la
    // ripresa.
    expect([...stages[0]!.inks.keys()]).toEqual(["live:o2"]);
  });

  it("senza fogli non chiede fotogrammi, e un foglio nuovo riceve tutto", () => {
    stages = [];
    begin("o1");
    points("o1", [[10, 10, 0.5, 0]]);
    expect(frames).toHaveLength(0);
    stages = [fakeStage(), fakeStage()];
    ink.redraw();
    frame();
    for (const stage of stages) expect(stage.inks.has("live:o1")).toBe(true);
  });

  it("misura la latenza solo con l'orologio noto e un foglio a vista", () => {
    const now = performance.timeOrigin;
    begin("o1");
    points("o1", [[10, 10, 0.5, 1000]]);
    frame(50);
    expect(latencies).toEqual([]);
    // Il PC è avanti di `offset` sul tablet: il campione delle 1000 del
    // tablet è delle `now + 20` del PC, e il fotogramma è alle `now + 50`.
    ink.setClock(now + 20 - 1000);
    points("o1", [[11, 11, 0.5, 1000]]);
    frame(50);
    expect(latencies).toHaveLength(1);
    expect(latencies[0]).toBeCloseTo(30, 3);
    stages[0]!.shown = false;
    points("o1", [[12, 12, 0.5, 1000]]);
    frame(60);
    expect(latencies).toHaveLength(1);
  });

  it("un pennello illeggibile non apre il tratto, e un tratto non supera i campioni di fub:ink", () => {
    begin("rotto", { brush: "nonpf1" });
    points("rotto", [[1, 1, 0.5, 0]]);
    expect(frames).toHaveLength(0);
    begin("lungo");
    const many = Array.from({ length: INK_MAX_SAMPLES + 5 }, (_, i): [number, number, number, number] => [i, i, 0.5, i]);
    points("lungo", many);
    frame();
    expect(stages[0]!.inks.has("live:lungo")).toBe(true);
  });

  it("smontato, toglie tutto e non disegna più", () => {
    begin("o1");
    points("o1", [[10, 10, 0.5, 0]]);
    frame();
    ink.dispose();
    expect(stages[0]!.inks.size).toBe(0);
    begin("o2");
    points("o2", [[10, 10, 0.5, 0]]);
    expect(frames).toHaveLength(0);
  });
});
