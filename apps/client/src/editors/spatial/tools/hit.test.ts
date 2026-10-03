// L'indice degli oggetti: che cosa si sceglie intero, e dove si tocca. La
// geometria è quella che il painter disegna, quindi i documenti qui sono
// scene vere, aperte dal motore.

import { describe, expect, it } from "vitest";
import { PF1_DEFAULTS } from "../ink/brush";
import { quantizeInk, type InkSample } from "../ink/sample";
import { doc } from "../scene/test-support";
import { strokeElem } from "./edit";
import { PaintBuilder } from "../painter/paint";
import { SceneEngine } from "../scene/engine";
import { elementChildren, type ContainerNode } from "../scene/model";
import { elemBounds, SceneIndexer } from "./hit";
import { LAYER, open } from "./test-support";

const SHAPES = doc(
  `<title>Prova</title><rect id="fub-paper" fub:role="paper" x="0" y="0" width="100" height="100" fill="#ffffff"/>${LAYER}`
    + '<rect id="r" x="10" y="10" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>'
    + '<circle id="c" cx="70" cy="70" r="10" fill="#000000"/>'
    + '<g id="g" transform="translate(50 0)"><rect id="gr" x="0" y="0" width="10" height="10"/></g>'
    + '<line x1="0" y1="90" x2="40" y2="90" stroke="#000000" stroke-width="2"/>'
    + '<rect id="off" x="0" y="0" width="5" height="5" display="none"/>'
    + '</g><g id="l2" fub:layer="Bloccato" fub:locked="true"><rect id="locked" x="0" y="0" width="100" height="100"/></g>'
    + '<g id="l3" fub:layer="Nascosto" display="none"><rect id="hidden" x="0" y="0" width="100" height="100"/></g>'
    + '<circle id="loose" cx="95" cy="5" r="2"/>',
);

describe("gli oggetti della scena", () => {
  it("sono i figli dei livelli visibili e sbloccati, e quelli della radice", () => {
    const { index } = open(SHAPES);
    expect(index.units.map((unit) => unit.key)).toEqual(["r", "c", "g", "@2.3", "loose"]);
    // Un oggetto senza id si nomina col percorso, che il motore sa trovare.
    expect(index.get("@2.3")?.target).toEqual({ path: [2, 3], tag: "line" });
    expect(index.get("r")?.layer).toBe("l1");
    expect(index.get("loose")?.layer).toBeNull();
  });

  it("conoscono i livelli, anche quelli che non si toccano", () => {
    const { index } = open(SHAPES);
    expect(index.layers.map((layer) => [layer.id, layer.locked, layer.hidden])).toEqual([
      ["l1", false, false],
      ["l2", true, false],
      ["l3", false, true],
    ]);
  });

  it("hanno il riquadro di ciò che si vede, contorno e trasformazioni compresi", () => {
    const { index } = open(SHAPES);
    expect(index.get("r")?.bounds).toEqual({ min: [9, 9], max: [31, 31] });
    expect(index.get("g")?.bounds).toEqual({ min: [50, 0], max: [60, 10] });
    expect(index.get("g")?.frame()).toEqual({ min: [0, 0], max: [10, 10] });
  });
});

describe("toccare un oggetto", () => {
  it("vuol dire toccarne ciò che si dipinge: il contorno di un rettangolo vuoto, non il suo interno", () => {
    const { index } = open(SHAPES);
    expect(index.at([20, 20], 0.5)).toBeNull();
    expect(index.at([10.5, 20], 0)?.key).toBe("r");
    expect(index.at([8.6, 20], 0.5)?.key).toBe("r");
    expect(index.at([70, 70], 0)?.key).toBe("c");
  });

  it("dà il gruppo intero, nel posto dove la trasformazione lo porta", () => {
    const { index } = open(SHAPES);
    expect(index.at([55, 5], 0)?.key).toBe("g");
    expect(index.at([5, 5], 0)).toBeNull();
  });

  it("sceglie quello che si vede sopra", () => {
    const { index } = open(doc(`${LAYER}<rect id="sotto" x="0" y="0" width="50" height="50"/><rect id="sopra" x="25" y="25" width="50" height="50"/></g>`));
    expect(index.at([30, 30], 0)?.key).toBe("sopra");
    expect(index.at([10, 10], 0)?.key).toBe("sotto");
  });

  it("col passaggio della gomma prende ciò che il segmento attraversa", () => {
    const { index } = open(SHAPES);
    expect(index.along([20, 80], [20, 100], 1).map((unit) => unit.key)).toEqual(["@2.3"]);
    expect(index.along([0, 50], [100, 50], 1)).toEqual([]);
  });

  it("col riquadro prende gli oggetti che ci stanno interi", () => {
    const { index } = open(SHAPES);
    expect(index.within({ min: [0, 0], max: [65, 35] }).map((unit) => unit.key)).toEqual(["r", "g"]);
  });

  it("dentro un tratto a penna vuol dire dentro il suo contorno pieno", () => {
    const samples: InkSample[] = [];
    for (let i = 0; i <= 25; i++) samples.push({ x: 10 + 2 * i, y: 50, p: 0.5, t: 8 * i });
    // Il `d` lo calcola il motore all'`add`, come per un tratto vero.
    const opened = open(doc(`${LAYER}</g>`));
    const brush = { ...PF1_DEFAULTS, size: 8, thinning: 0, taperStart: 0, taperEnd: 0 };
    const elem = strokeElem("o7k2m9x4q", "#000000", brush, quantizeInk(samples), null);
    expect(opened.engine.apply({ op: "add", parent: "l1", pos: { last: true }, elem }).outcome).toBe("applied");
    const index = opened.reindex();
    expect(index.at([35, 50], 0)?.key).toBe("o7k2m9x4q");
    expect(index.at([35, 52], 0)?.key).toBe("o7k2m9x4q");
    expect(index.at([35, 60], 0)).toBeNull();
    expect(index.at([35, 60], 7)?.key).toBe("o7k2m9x4q");
  });
});

describe("il riquadro di un elemento nuovo", () => {
  it("è quello che l'indice gli darà dopo l'`add`", () => {
    const elem = { tag: "rect", attrs: { id: "n", x: "10", y: "10", width: "20", height: "20", fill: "none", stroke: "#000000", "stroke-width": "4" } };
    expect(elemBounds(elem, [1, 0, 0, 1, 0, 0])).toEqual({ min: [8, 8], max: [32, 32] });
    expect(elemBounds(elem, [2, 0, 0, 2, 5, 0])).toEqual({ min: [21, 16], max: [69, 64] });
  });
});

describe("con un ambito", () => {
  it("gli oggetti sono solo quelli dei contenitori elencati, trattati come livelli", () => {
    const engine = SceneEngine.open(
      doc('<g id="p0001" fub:page="1"><rect id="a" x="0" y="0" width="5" height="5"/></g><g id="p0002" fub:page="2"><rect id="b" x="0" y="0" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></g><rect id="c" x="0" y="0" width="5" height="5"/>'),
    );
    const builder = new PaintBuilder();
    builder.build(engine);
    const pages = elementChildren(engine.model!.root).filter((child): child is ContainerNode => child.kind === "container");
    const index = new SceneIndexer(builder).index(engine.model!, [pages[1]!]);
    expect(index.units.map((unit) => [unit.key, unit.layer])).toEqual([["b", "p0002"], ["@1.1", "p0002"]]);
    expect(index.layers.map((layer) => [layer.id, layer.path, layer.locked, layer.hidden])).toEqual([["p0002", [1], false, false]]);
    expect(new SceneIndexer(builder).index(engine.model!, []).units).toEqual([]);
  });
});

describe("l'evidenziatore", () => {
  it("scrive il tratto col suo strumento e trasparente, il resto come la penna", () => {
    const samples: InkSample[] = [{ x: 10, y: 50, p: 0.5, t: 0 }, { x: 40, y: 50, p: 0.5, t: 16 }];
    const brush = { ...PF1_DEFAULTS, size: 16, thinning: 0 };
    const pen = strokeElem("o1", "#f0e442", brush, quantizeInk(samples), null);
    const marker = strokeElem("o1", "#f0e442", brush, quantizeInk(samples), null, "highlighter");
    expect(pen.attrs["fub:tool"]).toBe("pen");
    expect(pen.attrs["fill-opacity"]).toBeUndefined();
    expect(marker.attrs).toEqual({ ...pen.attrs, "fub:tool": "highlighter", "fill-opacity": "0.4" });
    expect(Object.keys(marker.attrs)).toEqual(["id", "fub:tool", "fub:brush", "fill", "fill-opacity", "fub:ink"]);
  });
});
