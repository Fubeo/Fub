// Lo strumento del motore nell'host finto (K6 T4): un gesto con
// `{ engine: { id } }` e senza risposte del banco rende i segni e lo stato
// dello strumento finto; gli strumenti di K5 senza risposte lanciano ancora.

import { describe, expect, it } from "vitest";
import type { DrawingGesture } from "./contract";
import { createFakeHost } from "./fake";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>\n';

function gesto(over: Partial<DrawingGesture>): DrawingGesture {
  return {
    revision: "0",
    phase: "preview",
    tool: { engine: { id: "pen" } },
    layer: null,
    selection: [],
    zoom: 1,
    snap: { grid: null, free: false },
    style: null,
    text: null,
    frame: null,
    events: [],
    ...over,
  };
}

const punto = (kind: "down" | "drag", x: number, y: number) => ({ kind, x, y, pressure: 0.5, shift: false, alt: false, cmd: false });

describe("lo strumento finto del motore", () => {
  it("in anteprima rende un riquadro e un punto d'ancoraggio, occupato; alla fine niente", async () => {
    const host = createFakeHost({ drawing: {} });
    const api = host.module.api;
    const { instance } = await api.openDrawing("a.svg", SVG, null);
    const anteprima = await api.drawingGesture(instance, gesto({ events: [punto("down", 30, 40), punto("drag", 10, 50)] }));
    expect(anteprima.preview?.overlays).toEqual([
      { kind: "marquee", rect: [10, 40, 20, 10] },
      { kind: "anchor", at: [10, 50], role: "selection", filled: true, size: 7 },
    ]);
    expect(anteprima.state).toMatchObject({ busy: true, wants_text: false, composing: false, cursor: "crosshair" });
    const fine = await api.drawingGesture(instance, gesto({ phase: "commit" }));
    expect(fine).toMatchObject({ ops: null, refused: "empty", preview: null, state: { busy: false } });
    const annullato = await api.drawingGesture(instance, gesto({ phase: "cancel" }));
    expect(annullato).toMatchObject({ ops: null, refused: null });
  });

  it("uno strumento di K5 senza risposte del banco lancia ancora", async () => {
    const host = createFakeHost({ drawing: {} });
    const api = host.module.api;
    const { instance } = await api.openDrawing("a.svg", SVG, null);
    await expect(api.drawingGesture(instance, gesto({ tool: "rect" }))).rejects.toThrow(/non ha risposte per i gesti/);
  });
});
