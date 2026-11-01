// Il tratto a penna che diventa un tracciato: la spina col colore come
// contorno, i capi del pennello, la pressione come profilo di spessore e la
// fedeltà che decide quanti nodi.

import { describe, expect, it } from "vitest";
import { formatBrush, PF1_DEFAULTS } from "../../../ink/brush";
import { encodeInk, inkFromSamples } from "../ink/codec";
import { pf1 } from "../../../ink/pf1";
import { quantizeInk, type InkSample } from "../../../ink/sample";
import { parsePath, type Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import type { Elem } from "../scene/serialize";
import type { Fidelity } from "./grid";
import { inkAsPath } from "./ink-path";

/// I nodi di un tracciato aperto `segments`: uno per segmento.
const nodeCount = (segments: readonly Segment[]): number => segments.filter((segment) => segment.kind !== "close").length;

const BRUSH = { ...PF1_DEFAULTS, size: 6 };

/// Un tratto dello strumento `tool` lungo gli spigoli `corners`, un punto
/// ogni tre unità.
function stroke(corners: readonly Point[], pressure?: (k: number) => number, brush = BRUSH): Elem {
  const points: Point[] = [corners[0]!];
  for (let i = 1; i < corners.length; i++) {
    const [[ax, ay], [bx, by]] = [corners[i - 1]!, corners[i]!];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
    for (let k = 1; k <= steps; k++) points.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps]);
  }
  const samples: InkSample[] = points.map(([x, y], i) => (pressure === undefined ? { x, y, t: i * 8 } : { x, y, p: pressure(i / (points.length - 1)), t: i * 8 }));
  return {
    tag: "path",
    attrs: {
      id: "a",
      "fub:tool": "pen",
      "fub:brush": formatBrush(brush),
      d: pf1(quantizeInk(samples), brush),
      fill: "#cc3300",
      "fill-opacity": "0.8",
      "fub:ink": encodeInk(inkFromSamples(samples, 100)),
    },
  };
}

describe("il tratto a penna in tracciato", () => {
  it("diventa la sua spina, col colore come contorno e lo spessore del pennello, senza id", () => {
    const path = inkAsPath(stroke([[10, 10], [90, 10], [90, 60]]))!;
    expect(path.tag).toBe("path");
    expect(path.attrs).toMatchObject({ fill: "none", stroke: "#cc3300", "stroke-opacity": "0.8", "stroke-width": "6", "stroke-linecap": "round", "stroke-linejoin": "round" });
    expect(path.attrs.id).toBeUndefined();
    expect(Object.keys(path.attrs).some((name) => name.startsWith("fub:"))).toBe(false);
    // Due lati, uno spigolo: tre nodi.
    const segments = parsePath(path.attrs.d!)!;
    expect(nodeCount(segments)).toBe(3);
    expect(segments[0]!.kind === "move" && segments[0]!.to).toEqual([10, 10]);
  });

  it("tiene la trasformazione e i figli del tratto", () => {
    const elem = stroke([[0, 0], [60, 0]]);
    const path = inkAsPath({ ...elem, attrs: { ...elem.attrs, transform: "rotate(30)" }, children: [{ tag: "title", attrs: {}, text: "Firma" }] })!;
    expect(path.attrs.transform).toBe("rotate(30)");
    expect(path.children).toEqual([{ tag: "title", attrs: {}, text: "Firma" }]);
  });

  it("un punto è una linea lunga zero coi capi tondi", () => {
    expect(inkAsPath(stroke([[40, 40]]))!.attrs).toMatchObject({ d: "M40 40 L40 40", "stroke-linecap": "round" });
  });

  it("senza gli estremi del pennello il tratto finisce piatto, il punto resta tondo", () => {
    const flat = { ...BRUSH, capStart: false, capEnd: false };
    expect(inkAsPath(stroke([[0, 0], [60, 0]], undefined, flat))!.attrs["stroke-linecap"]).toBeUndefined();
    expect(inkAsPath(stroke([[40, 40]], undefined, flat))!.attrs["stroke-linecap"]).toBe("round");
  });

  it("la pressione diventa una linea a spessore variabile, piena del colore", () => {
    const path = inkAsPath(stroke([[10, 10], [90, 10]], (k) => 0.2 + 0.8 * k))!;
    expect(path.attrs).toMatchObject({ "fub:shape": "width", fill: "#cc3300", "fill-opacity": "0.8" });
    expect(path.attrs.stroke).toBeUndefined();
    expect(path.attrs["fub:geom"]).toBeDefined();
    expect(parsePath(path.attrs.d!)).not.toBeNull();
  });

  it("la fedeltà bassa mette meno nodi dell'alta", () => {
    // Un'onda lenta e un tremolio più stretto della tolleranza bassa.
    const wave: Point[] = Array.from({ length: 40 }, (_, i) => [i * 4, 30 + 20 * Math.sin(i / 4) + (i % 2 === 0 ? 2 : -2)]);
    const nodes = (fidelity: Fidelity): number => nodeCount(parsePath(inkAsPath(stroke(wave), fidelity)!.attrs.d!)!);
    expect(nodes("low")).toBeLessThanOrEqual(nodes("medium"));
    expect(nodes("medium")).toBeLessThanOrEqual(nodes("high"));
    expect(nodes("low")).toBeLessThan(nodes("high"));
  });

  it("un pennello che non si legge dà null", () => {
    const elem = stroke([[0, 0], [60, 0]]);
    expect(inkAsPath({ ...elem, attrs: { ...elem.attrs, "fub:brush": "pf9;x" } })).toBeNull();
  });
});
