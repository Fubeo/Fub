import { describe, expect, it } from "vitest";
import { polygonalAttrs } from "../scene/parametric";
import { doc } from "../scene/test-support";
import { labelable, labelledPair, labelOf, labelTarget, textBox } from "./label-hosts";
import { LAYER, open, type Opened } from "./test-support";

const node = (opened: Opened, id: string) => {
  const found = opened.engine.holder(id);
  if (found === null) throw new Error(`nessun elemento ${id}`);
  return found;
};

const RECT = '<rect id="r" x="100" y="100" width="200" height="120" fill="#e69f00"/>';

/// Un'etichetta come la scrive l'editor.
const LABEL = (text: string, inside = "r", id = "t"): string =>
  `<text id="${id}" fub:inside="${inside}" fub:wrap="188" x="0" y="0" font-size="16" text-anchor="middle" transform="matrix(1 0 0 1 0 0)"><tspan x="0" dy="0">${text}</tspan></text>`;

describe("chi può avere un'etichetta", () => {
  it("le forme chiuse sì, le linee e i testi no", () => {
    const star = polygonalAttrs({ shape: "star", cx: 50, cy: 50, r: 40, count: 5, ratio: 0.5, rotation: 0, corner: 0 })!;
    const opened = open(
      doc(
        `${LAYER}<rect id="a" x="0" y="0" width="10" height="10"/><ellipse id="b" cx="5" cy="5" rx="4" ry="2"/><circle id="c" cx="5" cy="5" r="3"/>` +
          `<polygon id="d" points="0,0 10,0 5,8"/><path id="e" d="M0 0 L10 0 L5 8 Z"/><path id="f" d="M0 0 L10 0 L5 8"/>` +
          `<path id="g" d="M0 0 L10 0 M0 5 L10 5 L10 9 L0 9 Z"/><line id="h" x1="0" y1="0" x2="5" y2="5"/>` +
          `<text id="i" x="0" y="0"><tspan x="0" dy="0">T</tspan></text><g id="j"><rect x="0" y="0" width="1" height="1"/></g>` +
          `<path id="k" fub:shape="star" fub:geom="${star["fub:geom"]}" d="${star.d}"/></g>`,
      ),
    );
    const can = (id: string): boolean => labelable(node(opened, id));
    expect(["a", "b", "c", "d", "e", "g", "k"].map(can)).toEqual([true, true, true, true, true, true, true]);
    expect(["f", "h", "i", "j"].map(can)).toEqual([false, false, false, false]);
  });

  it("l'etichetta è il primo testo del gruppo che nomina una sorella chiusa", () => {
    const opened = open(
      doc(
        `${LAYER}<g id="g">${RECT}${LABEL("Uno")}${LABEL("Due", "r", "t2")}</g>` +
          `<g id="h"><path id="p" d="M0 0 L10 0"/>${LABEL("Aperta", "p", "t3")}</g>${LABEL("Fuori", "r", "t4")}` +
          `<g id="k"><title>Nome</title><ellipse id="e" cx="5" cy="5" rx="4" ry="2"/>${LABEL("Dentro", "e", "t5")}</g></g>`,
      ),
    );
    expect(labelTarget(node(opened, "t"))).toBe(node(opened, "r"));
    expect(labelTarget(node(opened, "t2"))).toBeNull();
    expect(labelTarget(node(opened, "t3"))).toBeNull();
    expect(labelTarget(node(opened, "t4"))).toBeNull();
    expect(labelOf(node(opened, "r"))).toBe(node(opened, "t"));
    expect(labelOf(node(opened, "p"))).toBeNull();
    // Una forma, la sua etichetta e il titolo del gruppo: una coppia. Tre
    // oggetti no.
    expect(labelledPair(node(opened, "k"))?.label).toBe(node(opened, "t5"));
    expect(labelledPair(node(opened, "g"))).toBeNull();
  });

  it("un testo su tracciato o l'etichetta di un connettore non sono etichette di una forma, e non ne tolgono il posto", () => {
    const along = LABEL("Lungo", "r", "t1").replace(' fub:inside="r"', ' fub:inside="r" fub:along="c 0.5 4"');
    const path = '<text id="t2" fub:inside="r" x="0" y="0"><textPath href="#q">Sopra</textPath></text>';
    const opened = open(doc(`<defs id="fub-defs"><path id="q" d="M0 0 L100 0"/></defs>${LAYER}<g id="g">${RECT}${along}${path}${LABEL("Vera", "r", "t3")}</g></g>`));
    expect(labelTarget(node(opened, "t1"))).toBeNull();
    expect(labelTarget(node(opened, "t2"))).toBeNull();
    expect(labelTarget(node(opened, "t3"))).toBe(node(opened, "r"));
    expect(labelOf(node(opened, "r"))).toBe(node(opened, "t3"));
  });
});

describe("il riquadro del testo", () => {
  const boxOf = (shape: string) => textBox(node(open(doc(`${LAYER}${shape}</g>`)), "s"));

  it("un rettangolo intero, uno arrotondato senza gli angoli, un'ellisse √2 volte i semiassi", () => {
    expect(boxOf('<rect id="s" x="10" y="20" width="100" height="50"/>')).toEqual({ min: [10, 20], max: [110, 70] });
    const rounded = boxOf('<rect id="s" x="0" y="0" width="100" height="40" rx="20"/>')!;
    const k = 20 * (1 - Math.SQRT1_2);
    expect(rounded.min[0]).toBeCloseTo(k, 9);
    expect(rounded.min[1]).toBeCloseTo(k, 9);
    expect(rounded.max[0]).toBeCloseTo(100 - k, 9);
    const ellipse = boxOf('<ellipse id="s" cx="50" cy="30" rx="40" ry="20"/>')!;
    expect(ellipse.min[0]).toBeCloseTo(50 - 40 * Math.SQRT1_2, 9);
    expect(ellipse.max[1]).toBeCloseTo(30 + 20 * Math.SQRT1_2, 9);
  });

  it("in un rombo, il rettangolo più grande, coi vertici sui lati e proprio al centro", () => {
    const box = boxOf('<path id="s" d="M70 0 L140 45 L70 90 L0 45 Z"/>')!;
    const a = (box.max[0] - box.min[0]) / 2;
    const b = (box.max[1] - box.min[1]) / 2;
    expect(a / 70 + b / 45).toBeCloseTo(1, 6);
    // Il più grande ha i lati a metà di quelli del rombo; la griglia lo
    // trova a meno di una cella.
    expect(4 * a * b).toBeGreaterThan(0.99 * 70 * 45);
    expect((box.min[0] + box.max[0]) / 2).toBeCloseTo(70, 6);
    expect((box.min[1] + box.max[1]) / 2).toBeCloseTo(45, 6);
  });

  it("in un triangolo, la metà di sotto; fra le linee di un processo predefinito, il mezzo", () => {
    const triangle = boxOf('<path id="s" d="M50 0 L100 100 L0 100 Z"/>')!;
    expect((triangle.min[1] + triangle.max[1]) / 2).toBeGreaterThan(60);
    expect((triangle.min[0] + triangle.max[0]) / 2).toBeCloseTo(50, 6);
    expect(triangle.max[1]).toBeCloseTo(100, 6);
    const predefined = boxOf('<path id="s" d="M0 0 L160 0 L160 100 L0 100 Z M16 0 L16 100 M144 0 L144 100"/>')!;
    expect(predefined.min[0]).toBeCloseTo(16, 6);
    expect(predefined.max[0]).toBeCloseTo(144, 6);
    expect(predefined.min[1]).toBeCloseTo(0, 6);
    expect(predefined.max[1]).toBeCloseTo(100, 6);
  });

  it("si calcola una volta per lo stesso testo della forma", () => {
    const opened = open(doc(`${LAYER}<path id="s" d="M50 0 L100 100 L0 100 Z"/></g>`));
    expect(textBox(node(opened, "s"))).toBe(textBox(node(opened, "s")));
  });
});
