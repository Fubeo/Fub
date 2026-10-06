// L'indice degli oggetti: che cosa si sceglie intero, e dove si tocca. La
// geometria è quella che il painter disegna, quindi i documenti qui sono
// scene vere, aperte dal motore.

import { describe, expect, it } from "vitest";
import { PF1_DEFAULTS } from "../ink/brush";
import { quantizeInk, type InkSample } from "../ink/sample";
import { compose, IDENTITY, rotate, translate } from "../scene/matrix";
import type { ContainerNode } from "../scene/model";
import { doc } from "../scene/test-support";
import { strokeElem } from "./edit";
import { elemBounds, linesBounds } from "./hit";
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

  it("sanno dove finirebbero dopo una trasformazione della scena, anche ruotati", () => {
    const { index } = open(SHAPES);
    const rect = index.get("r")!;
    expect(rect.boundsAfter(IDENTITY)).toEqual(rect.bounds);
    // Ruotato di 45° attorno al centro: gli spigoli vanno sugli assi.
    const turned = rect.boundsAfter(compose(translate(20, 20), compose(rotate(45), translate(-20, -20))))!;
    const reach = 10 * Math.SQRT2 + 1;
    [...turned.min, ...turned.max].forEach((value, at) => expect(value).toBeCloseTo(at < 2 ? 20 - reach : 20 + reach, 6));
    // Dentro un gruppo vale la scena, non le coordinate del gruppo.
    expect(index.get("g")!.boundsAfter(translate(0, 5))).toEqual({ min: [50, 5], max: [60, 15] });
  });

  it("hanno anche il riquadro della geometria, senza contorno, per la griglia", () => {
    const { index } = open(SHAPES);
    expect(index.get("r")?.geometry).toEqual({ min: [10, 10], max: [30, 30] });
    expect(index.get("@2.3")?.geometry).toEqual({ min: [0, 90], max: [40, 90] });
    expect(index.get("g")?.geometry).toEqual({ min: [50, 0], max: [60, 10] });
  });
});

describe("il riquadro di tutto il disegno", () => {
  it("comprende i livelli bloccati e nascosti, ma non la carta e ciò che è nascosto da sé", () => {
    const opened = open(doc(
      `<title>Prova</title><rect id="fub-paper" fub:role="paper" x="0" y="0" width="100" height="100" fill="#ffffff"/>${LAYER}`
        + '<rect id="a" x="10" y="10" width="20" height="20"/>'
        + '<rect id="off" x="500" y="500" width="5" height="5" display="none"/></g>'
        + '<g id="l2" fub:layer="Bloccato" fub:locked="true"><rect id="b" x="40" y="-50" width="10" height="10"/></g>'
        + '<g id="l3" fub:layer="Nascosto" display="none"><rect id="c" x="200" y="20" width="10" height="10" stroke="#000000" stroke-width="4"/></g>',
    ));
    expect(opened.extent()).toEqual({ min: [10, -50], max: [212, 32] });
    // L'indice resta quello degli oggetti che si toccano.
    expect(opened.index.units.map((unit) => unit.key)).toEqual(["a"]);
  });

  it("non c'è in un disegno vuoto", () => {
    expect(open(doc(`${LAYER}</g>`)).extent()).toBeNull();
  });
});

describe("i collegamenti che si vedono", () => {
  it("ci sono a ogni profondità e anche nei livelli bloccati, ma non in ciò che è nascosto", () => {
    const opened = open(doc(
      `${LAYER}<a id="a1" href="uno.md"><rect x="10" y="10" width="10" height="10"/></a>`
        + '<g id="g" transform="translate(50 0)"><a id="a2" href="due.md"><rect x="0" y="0" width="10" height="10"/></a></g>'
        + '<g id="off" display="none"><a id="a3" href="tre.md"><rect x="0" y="0" width="10" height="10"/></a></g>'
        + '<a id="a4" href="quattro.md" display="none"><rect x="0" y="0" width="10" height="10"/></a></g>'
        + '<g id="l2" fub:layer="Bloccato" fub:locked="true"><a id="a5" href="cinque.md"><rect x="0" y="40" width="10" height="10"/></a></g>'
        + '<g id="l3" fub:layer="Nascosto" display="none"><a id="a6" href="sei.md"><rect x="0" y="0" width="10" height="10"/></a></g>',
    ));
    expect(opened.links().map((unit) => [unit.key, unit.layer, unit.bounds])).toEqual([
      ["a1", "l1", { min: [10, 10], max: [20, 20] }],
      ["a2", "l1", { min: [50, 0], max: [60, 10] }],
      ["a5", "l2", { min: [0, 40], max: [10, 50] }],
    ]);
    // Quello dentro un gruppo non si sceglie da solo: si sceglie il gruppo,
    // che è sulla sua strada.
    expect(opened.index.units.map((unit) => unit.key)).toEqual(["a1", "g"]);
    expect(opened.links()[1]!.path).toEqual([...opened.index.get("g")!.path, 0]);
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

  it("sa quale forma di un gruppo sta sotto il punto, e con quale matrice si disegna", () => {
    const { index } = open(doc(
      `${LAYER}<g id="g" transform="translate(50 0)"><rect id="a" x="0" y="0" width="10" height="10"/>`
        + '<path id="b" transform="scale(2)" d="M2 2 L8 2"/></g></g>',
    ));
    const group = index.get("g")!;
    expect(group.shapes().map(({ leaf, matrix }) => [leaf.facts.id, matrix])).toEqual([
      ["a", [1, 0, 0, 1, 50, 0]],
      ["b", [2, 0, 0, 2, 50, 0]],
    ]);
    // La più in alto vince; dove nessuna disegna, niente.
    expect(group.shapeAt([58, 4], 0.5)?.facts.id).toBe("b");
    expect(group.shapeAt([55, 8], 0)?.facts.id).toBe("a");
    expect(group.shapeAt([65, 15], 0.5)).toBeNull();
    expect(group.shapeAt([200, 200], 0.5)).toBeNull();
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

describe("il lazo", () => {
  it("prende gli oggetti che stanno interi dentro il poligono, anche se è concavo", () => {
    const { index } = open(SHAPES);
    const corner: Array<[number, number]> = [[-5, -5], [100, -5], [100, 40], [45, 40], [45, 100], [-5, 100]];
    // Il cerchio sta nel riquadro del lazo, ma nell'angolo che resta fuori.
    expect(index.inside(corner).map((unit) => unit.key)).toEqual(["r", "g", "@2.3", "loose"]);
    // Un lato che attraversa un oggetto lo lascia fuori.
    expect(index.inside([[0, 0], [20, 0], [20, 40], [0, 40]])).toEqual([]);
    expect(index.inside([[0, 0], [65, 0]])).toEqual([]);
  });

  it("guarda la forma, non il suo riquadro, e conta il contorno", () => {
    const { index } = open(doc(`${LAYER}<circle id="c" cx="70" cy="70" r="10"/><circle id="s" cx="20" cy="20" r="10" stroke="#000000" stroke-width="2"/></g>`));
    // Un rombo attorno al cerchio: gli angoli del riquadro restano fuori.
    const diamond = (cx: number, cy: number, half: number): Array<[number, number]> => [[cx + half, cy], [cx, cy + half], [cx - half, cy], [cx, cy - half]];
    expect(index.inside(diamond(70, 70, 14.5)).map((unit) => unit.key)).toEqual(["c"]);
    expect(index.inside(diamond(70, 70, 14))).toEqual([]);
    // Il contorno largo 2 deve starci anche lui.
    expect(index.inside(diamond(20, 20, 14.5))).toEqual([]);
    expect(index.inside(diamond(20, 20, 16)).map((unit) => unit.key)).toEqual(["s"]);
  });

  it("chiuso ripassando sull'inizio non lascia buchi", () => {
    const { index } = open(SHAPES);
    const square: Array<[number, number]> = [[-5, -5], [65, -5], [65, 35], [-5, 35]];
    expect(index.inside([...square, ...square]).map((unit) => unit.key)).toEqual(["r", "g"]);
  });
});

describe("dentro i gruppi", () => {
  const NEST = doc(
    `${LAYER}<g id="g" transform="translate(50 0)"><rect id="a" x="0" y="0" width="10" height="10"/>`
      + '<g id="inner" transform="translate(0 20)"><circle id="b" cx="5" cy="5" r="5"/><rect x="20" y="0" width="5" height="5"/></g>'
      + '<rect id="la" x="20" y="0" width="10" height="10" fub:locked="true"/><rect id="hid" x="0" y="0" width="1" height="1" display="none"/></g>'
      + '<g id="lg" fub:locked="true"><rect id="in-locked" x="0" y="50" width="10" height="10"/></g>'
      + '<rect id="lr" x="80" y="80" width="10" height="10" fub:locked="true"/></g>'
      + '<g id="l2" fub:layer="Bloccato" fub:locked="true"><g id="lgg"><rect id="deep" x="0" y="0" width="5" height="5"/></g></g>',
  );
  const container = (opened: ReturnType<typeof open>, id: string): ContainerNode => opened.engine.holder(id) as ContainerNode;

  it("in cima ci sono solo gli oggetti che si scelgono: niente di bloccato", () => {
    const { index } = open(NEST);
    expect(index.units.map((unit) => unit.key)).toEqual(["g"]);
  });

  it("si trovano a ogni profondità, nel posto dove le trasformazioni li portano", () => {
    const { index } = open(NEST);
    expect(index.get("a")?.bounds).toEqual({ min: [50, 0], max: [60, 10] });
    expect(index.get("b")?.bounds).toEqual({ min: [50, 20], max: [60, 30] });
    expect(index.get("b")?.path).toEqual([0, 0, 1, 0]);
    expect(index.get("b")?.layer).toBe("l1");
    expect(index.get("@0.0.1.1")?.bounds).toEqual({ min: [70, 20], max: [75, 25] });
    // La stessa chiave dà lo stesso oggetto.
    expect(index.children(index.get("g")!)[0]).toBe(index.get("a"));
  });

  it("non si trova ciò che è bloccato, nascosto, dentro qualcosa di bloccato, o che non è un oggetto", () => {
    const { index } = open(NEST);
    for (const key of ["la", "hid", "lg", "in-locked", "lr", "lgg", "deep", "l1", "@0", "@0.0.0", "@9.9", "@x", "nessuno"]) expect(index.get(key), key).toBeNull();
  });

  it("conoscono figli e fratelli che si scelgono", () => {
    const { index } = open(NEST);
    expect(index.children(index.get("g")!).map((unit) => unit.key)).toEqual(["a", "inner"]);
    expect(index.children(index.get("a")!)).toEqual([]);
    expect(index.siblings(index.get("b")!).map((unit) => unit.key)).toEqual(["b", "@0.0.1.1"]);
    expect(index.siblings(index.get("g")!).map((unit) => unit.key)).toEqual(["g"]);
  });

  it("col clic più dentro si prende l'oggetto più dentro sotto il punto", () => {
    const { index } = open(NEST);
    expect(index.at([55, 25], 0)?.key).toBe("g");
    expect(index.deepAt([55, 25], 0)?.key).toBe("b");
    expect(index.deepAt([72, 22], 0)?.key).toBe("@0.0.1.1");
    expect(index.deepAt([55, 5], 0)?.key).toBe("a");
    // Sotto un figlio bloccato resta il gruppo.
    expect(index.deepAt([75, 5], 0)?.key).toBe("g");
    expect(index.deepAt([5, 55], 0)).toBeNull();
  });

  it("isolato un gruppo, si sceglie solo dentro", () => {
    const opened = open(NEST);
    const index = opened.reindex(container(opened, "g"));
    expect(index.units.map((unit) => unit.key)).toEqual(["a", "inner"]);
    expect(index.layers.map((layer) => layer.id)).toEqual(["l1", "l2"]);
    expect(index.get("b")?.key).toBe("b");
    expect(index.get("g")).toBeNull();
    expect(index.at([55, 25], 0)?.key).toBe("inner");
    expect(index.siblings(index.get("a")!).map((unit) => unit.key)).toEqual(["a", "inner"]);
    expect(opened.reindex(container(opened, "inner")).units.map((unit) => unit.key)).toEqual(["b", "@0.0.1.1"]);
  });

  it("si entra in un gruppo solo se né lui né chi lo contiene è bloccato o nascosto", () => {
    const opened = open(NEST);
    const g = container(opened, "g");
    expect(opened.opens(g)).toBe(true);
    expect(opened.opens(container(opened, "inner"))).toBe(true);
    expect(opened.opens(container(opened, "lg"))).toBe(false);
    expect(opened.opens(container(opened, "lgg"))).toBe(false);
    expect(opened.engine.apply({ op: "set", id: "g", attrs: { display: "none" } }).outcome).toBe("applied");
    expect(opened.opens(g)).toBe(false);
    expect(opened.opens(container(opened, "inner"))).toBe(false);
    expect(opened.engine.apply({ op: "set", id: "g", attrs: { display: null } }).outcome).toBe("applied");
    expect(opened.opens(g)).toBe(true);
    expect(opened.engine.apply({ op: "remove", target: "g" }).outcome).toBe("applied");
    expect(opened.opens(g)).toBe(false);
  });

  it("le guide vedono anche ciò che è bloccato, e i figli dei gruppi aperti", () => {
    const opened = open(NEST);
    expect(opened.seen().map((unit) => unit.key)).toEqual(["g", "lg", "lr", "lgg"]);
    expect(opened.seen(new Set([container(opened, "g")])).map((unit) => unit.key)).toEqual(["a", "inner", "la", "lg", "lr", "lgg"]);
  });
});

describe("il riquadro di un elemento nuovo", () => {
  it("è quello che l'indice gli darà dopo l'`add`", () => {
    const elem = { tag: "rect", attrs: { id: "n", x: "10", y: "10", width: "20", height: "20", fill: "none", stroke: "#000000", "stroke-width": "4" } };
    expect(elemBounds(elem, [1, 0, 0, 1, 0, 0])).toEqual({ min: [8, 8], max: [32, 32] });
    expect(elemBounds(elem, [2, 0, 0, 2, 5, 0])).toEqual({ min: [21, 16], max: [69, 64] });
  });
});

describe("come si vede un testo", () => {
  const TEXTS = doc(
    `${LAYER}<text id="t" x="10" y="40" fill="#0072b2" font-family="Inter, sans-serif" font-size="20"><tspan x="10" dy="0">Ciao</tspan><tspan x="10" dy="30">a te</tspan></text>`
      + '<g id="g"><text id="dentro" x="0" y="0"><tspan x="0" dy="0">no</tspan></text></g></g>'
      + '<g id="l2" fub:layer="Stile" font-size="12" font-weight="700" fill="#d55e00" text-anchor="middle">'
      + '<text id="n" x="50" y="80" transform="rotate(90 50 80)"><tspan x="50" dy="0">x</tspan></text></g>',
  );

  it("sa dove comincia la prima riga, il corpo, il passo e lo stile che eredita", () => {
    const { index } = open(TEXTS);
    expect(index.get("t")?.look).toEqual({ x: 10, y: 40, size: 20, leading: 30, anchor: "start", family: "Inter, sans-serif", weight: null, color: "#0072b2" });
    // Con una riga sola, il passo è quello che l'operazione `text` darà alla
    // seconda.
    expect(index.get("n")?.look).toEqual({ x: 50, y: 80, size: 12, leading: 15, anchor: "middle", family: null, weight: "700", color: "#d55e00" });
    // Un gruppo si sceglie intero: il testo dentro non si cambia sul posto.
    expect(index.get("g")?.look).toBeNull();
  });

  it("le righe che si scriveranno hanno il riquadro che l'indice darà loro", () => {
    const opened = open(TEXTS);
    const lines = ["Ciao", "a te", "e a voi"];
    const expected = ["t", "n"].map((id) => {
      const unit = opened.index.get(id)!;
      return linesBounds(unit.look!, lines, unit.matrix);
    });
    for (const id of ["t", "n"]) expect(opened.engine.apply({ op: "text", id, lines }).outcome).toBe("applied");
    const index = opened.reindex();
    expect([index.get("t")?.bounds, index.get("n")?.bounds]).toEqual(expected);
    // Il testo girato va giù, come la sua prima riga.
    expect(expected[1]!.max[0]).toBeLessThanOrEqual(50 + 12 * 0.8 + 1e-9);
    const t = opened.index.get("t")!;
    expect(linesBounds(t.look!, [" ", ""], t.matrix)).toBeNull();
  });
});
