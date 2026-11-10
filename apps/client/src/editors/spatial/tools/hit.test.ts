// L'indice degli oggetti: che cosa si sceglie intero, e dove si tocca. La
// geometria è quella che il painter disegna, quindi i documenti qui sono
// scene vere, aperte dal motore.
//
// Qui gli oggetti, i riquadri, toccare, il lazo, i gruppi e l'indice dopo una
// modifica; le punte, i testi, i blocchi estranei, i simboli e le ripetizioni
// in `hit.content.test.ts`, i ritagli in `hit.clips.test.ts`.

import { describe, expect, it, vi } from "vitest";
import { PF1_DEFAULTS } from "../../../ink/brush";
import { quantizeInk, type InkSample } from "../../../ink/sample";
import { compose, IDENTITY, rotate, translate, type Point } from "../scene/matrix";
import { doc } from "../scene/test-support";
import { strokeElem } from "./edit";
import { elemBounds, geometryBox, type SceneIndex, type Unit } from "./hit";
import { LAYER, open } from "./test-support";
import { container, SHAPES } from "./hit/test-support";

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

describe("le risorse", () => {
  it("non sono oggetti: né la defs né ciò che contiene si sceglie, si tocca o fa riquadro", () => {
    const opened = open(doc(
      '<defs id="fub-defs"><pattern id="p1" width="200" height="200" patternUnits="userSpaceOnUse">'
        + '<rect id="dentro" x="0" y="0" width="200" height="200" fill="#000000"/></pattern>'
        + '<linearGradient id="estraneo" href="#p1"/></defs>'
        + `${LAYER}<rect id="a" x="10" y="10" width="20" height="20" fill="url(#p1) #000000"/></g>`,
    ));
    expect(opened.index.units.map((unit) => unit.key)).toEqual(["a"]);
    for (const key of ["fub-defs", "p1", "dentro", "estraneo", "@0", "@0.0"]) expect(opened.index.get(key), key).toBeNull();
    expect(opened.index.at([100, 100], 0)).toBeNull();
    expect(opened.extent()).toEqual({ min: [10, 10], max: [30, 30] });
  });
});

describe("il riquadro di una miniatura", () => {
  const FRAMED = doc(
    '<g id="l1" fub:layer="Nascosto" transform="translate(100 0)" display="none">'
      + '<g id="g" transform="scale(2)" stroke="#000000" stroke-width="2" display="none">'
      + '<rect id="r" x="0" y="0" width="10" height="10"/><rect id="off" x="50" y="50" width="5" height="5" display="none"/></g>'
      + '<g id="odd" visibility="hidden"><rect id="inner" x="0" y="0" width="5" height="5"/></g></g>',
  );

  it("è ciò che l'oggetto disegna nella scena, contorno compreso, anche se lui o chi lo contiene è nascosto", () => {
    const opened = open(FRAMED);
    expect(opened.frame("r")).toEqual({ min: [98, -2], max: [122, 22] });
    expect(opened.frame("off")).toEqual({ min: [198, 98], max: [212, 112] });
  });

  it("non conta ciò che è nascosto dentro di lui", () => {
    const opened = open(FRAMED);
    expect(opened.frame("g")).toEqual({ min: [98, -2], max: [122, 22] });
    // Il livello ha dentro solo il gruppo nascosto, e ciò che non sa leggere.
    expect(opened.frame("l1")).toBeNull();
  });

  it("non c'è per ciò che il disegno non sa leggere", () => {
    expect(open(FRAMED).frame("inner")).toBeNull();
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

  it("la gomma non riprova ciò che ha già segnato", () => {
    const { index } = open(SHAPES);
    const line = index.get("@2.3")!;
    const touches = vi.spyOn(line, "touches");
    expect(index.along([20, 80], [20, 100], 1, new Map([[line.key, line]]))).toEqual([]);
    expect(touches).not.toHaveBeenCalled();
    // Sotto la chiave c'è un altro oggetto: si prova.
    expect(index.along([20, 80], [20, 100], 1, new Map([[line.key, index.get("r")!]]))).toEqual([line]);
  });

  it("con molti oggetti la gomma prende ciò che prenderebbe guardandoli tutti", () => {
    // Un generatore con seme (mulberry32): la prova si ripete.
    let state = 5;
    const next = (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const shapes = Array.from({ length: 700 }, (_, i) => {
      const x = (i % 30) * 20 + next() * 10;
      const y = Math.floor(i / 30) * 20 + next() * 10;
      switch (i % 6) {
        case 0:
          return `<rect x="${x}" y="${y}" width="${4 + next() * 20}" height="${4 + next() * 8}" fill="none" stroke="#000" stroke-width="2"/>`;
        case 1:
          return `<circle cx="${x}" cy="${y}" r="${1 + next() * 6}"/>`;
        case 2:
          return `<path d="M${x} ${y} Q${x + 8} ${y + 12} ${x + 15} ${y + 3}" fill="none" stroke="#000" stroke-width="${next() * 4}"/>`;
        case 3:
          return `<g id="g${i}" transform="translate(${x} ${y}) rotate(${next() * 90})"><rect x="0" y="0" width="8" height="3"/></g>`;
        case 4:
          return `<line x1="${x}" y1="${y}" x2="${x + next() * 60}" y2="${y + next() * 30}" stroke="#000"/>`;
        default:
          return `<polyline points="${x},${y} ${x + 5},${y + 9} ${x + 11},${y}" fill="none" stroke="#000" stroke-width="3"/>`;
      }
    });
    const { index } = open(doc(
      `<defs id="fub-defs"><clipPath id="via" fub:role="private"><rect x="5000" y="5000" width="1" height="1"/></clipPath></defs>${LAYER}`
        + '<rect id="sotto" x="-5" y="-5" width="620" height="500" fill="none" stroke="#000"/><g id="vuoto"/>'
        + `${shapes.join("")}<rect id="nascosto" x="40" y="40" width="30" height="30" clip-path="url(#via)"/></g>`,
    ));
    expect(index.units.length).toBeGreaterThan(700);
    expect(index.units.some((unit) => unit.bounds === null)).toBe(true);
    let found = 0;
    for (let k = 0; k < 600; k++) {
      const a: Point = [next() * 640 - 20, next() * 520 - 20];
      const reach = k % 10 === 0 ? 300 : 6;
      const b: Point = [a[0] + (next() - 0.5) * reach, a[1] + (next() - 0.5) * reach];
      const tolerance = [0, 0.5, 2, 10][k % 4]!;
      const expected = index.units.filter((unit) => unit.touches(a, b, tolerance)).map((unit) => unit.key);
      expect(index.along(a, b, tolerance).map((unit) => unit.key), `segmento ${k}`).toEqual(expected);
      found += expected.length;
    }
    expect(found).toBeGreaterThan(600);
    // Anche le domande strane danno ciò che darebbe la scansione.
    const strange: Array<[Point, Point, number]> = [
      [[Number.NaN, 0], [10, 10], 1],
      [[0, 0], [10, 10], Number.NaN],
      [[300, 200], [300, 200], Infinity],
      [[-1e300, 0], [1e300, 0], 1],
    ];
    for (const [a, b, tolerance] of strange) {
      expect(index.along(a, b, tolerance)).toEqual(index.units.filter((unit) => unit.touches(a, b, tolerance)));
    }
    // Ciò che la gomma ha già segnato non torna; il resto sì, nello stesso
    // ordine.
    const across = index.along([0, 0], [600, 480], 2);
    expect(across.length).toBeGreaterThan(20);
    const half = across.length >> 1;
    const marked = new Map(across.slice(0, half).map((unit) => [unit.key, unit] as const));
    expect(index.along([0, 0], [600, 480], 2, marked)).toEqual(across.slice(half));
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

  it("senza contorno né trasformazione è quello della geometria", () => {
    const elem = { tag: "rect", attrs: { x: "10", y: "10", width: "20", height: "20", stroke: "#000000", "stroke-width": "4", transform: "scale(3)" } };
    expect(geometryBox(elem)).toEqual({ min: [10, 10], max: [30, 30] });
    expect(geometryBox({ tag: "rect", attrs: { width: "0", height: "5" } })).toBeNull();
  });
});

describe("che cosa si vede in un punto", () => {
  const SEEN = doc(
    `${LAYER}<rect id="r" x="0" y="0" width="40" height="40" fill="#0072b2" stroke="#000000" stroke-width="4"/>` +
      // Il buco gira al contrario: con `nonzero` non si riempie.
      '<path id="o" d="M50 0 H90 V40 H50 Z M60 10 V30 H80 V10 Z" fill="#d55e00"/>' +
      '<g id="g" transform="translate(0 50)"><path id="n" d="M0 0 H40 V40 H0 Z"/><polyline id="p" points="50 0 90 0 90 40" fill="none" stroke="#000000" stroke-width="2"/></g></g>',
  );
  const at = (key: string, p: [number, number], tolerance = 0): [string | null, string] | null => {
    const sampled = open(SEEN).index.get(key)!.sampleAt(p, tolerance);
    return sampled === null ? null : [sampled.leaf.facts.id, sampled.on];
  };

  it("il contorno sta sopra il riempimento", () => {
    expect(at("r", [20, 20])).toEqual(["r", "fill"]);
    expect(at("r", [1, 20])).toEqual(["r", "stroke"]);
    expect(at("r", [-1.5, 20])).toEqual(["r", "stroke"]);
    expect(at("r", [-3, 20])).toBeNull();
    expect(at("r", [-3, 20], 2)).toEqual(["r", "stroke"]);
  });

  it("un buco lascia vedere sotto; vicino al suo bordo, con la tolleranza, si vede il riempimento", () => {
    expect(at("o", [55, 20])).toEqual(["o", "fill"]);
    expect(at("o", [70, 20])).toBeNull();
    expect(at("o", [61, 20], 2)).toEqual(["o", "fill"]);
    expect(at("g", [20, 70])).toEqual(["n", "fill"]);
  });

  it("il contorno di una spezzata aperta non ha il lato che la chiude, e dà la sua geometria", () => {
    const { index } = open(SEEN);
    const sampled = index.get("g")!.sampleAt([90, 70], 0)!;
    expect([sampled.leaf.facts.id, sampled.on, sampled.matrix]).toEqual(["p", "stroke", [1, 0, 0, 1, 0, 50]]);
    expect(sampled.segments.length).toBeGreaterThan(0);
    expect(at("g", [70, 70])).toBeNull();
  });
});

describe("l'indice dopo una modifica", () => {
  const SCENE = doc(
    '<defs id="fub-defs"><marker id="m" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 L10 5 L0 10 Z"/></marker>'
      + '<clipPath id="k" fub:role="private"><rect x="0" y="0" width="0.5" height="1"/></clipPath>'
      + '<mask id="q" fub:role="private" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200"><rect x="0" y="0" width="200" height="200" fill="#ffffff"/></mask>'
      + '<path id="t1" fub:role="private" d="M 0 100 L 200 100"/>'
      + '<symbol id="s" overflow="visible"><rect id="sr" x="0" y="0" width="10" height="10"/></symbol></defs>'
      + `${LAYER}<rect id="r" x="10" y="10" width="20" height="20" stroke="#000000"/>`
      + '<line x1="0" y1="90" x2="40" y2="90" stroke="#000000" stroke-width="2" marker-end="url(#m)"/>'
      + '<rect id="k1" x="0" y="0" width="30" height="30" clip-path="url(#k)"/>'
      + '<rect id="q1" x="20" y="20" width="60" height="60" mask="url(#q)"/>'
      + '<text id="tx" x="0" y="50"><tspan x="0" dy="0">Titolo</tspan></text>'
      + '<text id="tp" font-size="10"><textPath href="#t1">abc</textPath></text>'
      + '<use id="i" href="#s" transform="translate(100 0)"/>'
      + '<g id="g" stroke="#000000" stroke-width="4" font-size="20"><rect id="gr" x="0" y="0" width="10" height="10"/><text id="gt" x="0" y="0"><tspan x="0" dy="0">Dentro</tspan></text></g>'
      + '<g id="g2" clip-path="url(#k)"><rect id="g2r" x="40" y="40" width="30" height="30"/></g>'
      + "</g>",
  );

  const project = (unit: Unit) => ({
    key: unit.key,
    path: unit.path,
    layer: unit.layer,
    parent: unit.parent,
    transform: unit.transform,
    bounds: unit.bounds,
    geometry: unit.geometry,
    frame: unit.frame(),
    inner: unit.inner,
    look: unit.look,
  });
  const read = (index: SceneIndex) => ({
    units: index.units.map(project),
    children: index.units.map((unit) => index.children(unit).map(project)),
    hits: Array.from({ length: 121 }, (_, k) => index.at([(k % 11) * 12, Math.floor(k / 11) * 12], 2)?.key ?? null),
  });

  it("dà gli stessi oggetti di un indice nuovo, anche quando cambia solo ciò a cui rimandano", () => {
    const opened = open(SCENE);
    const first = opened.reindex();
    expect(first.units.map((unit) => unit.key)).toEqual(["r", "@1.1", "k1", "q1", "tx", "tp", "i", "g", "g2"]);
    const edits = [
      { op: "set", id: "m", attrs: { markerWidth: "8" } },
      { op: "set", id: "k", attrs: { clipPathUnits: "objectBoundingBox" } },
      { op: "set", id: "q", attrs: { width: "40", height: "40" } },
      { op: "set", id: "t1", attrs: { d: "M 100 0 L 100 200" } },
      { op: "set", id: "sr", attrs: { width: "30" } },
      { op: "set", id: "g", attrs: { "stroke-width": "8", "font-size": "30" } },
      { op: "set", id: "l1", attrs: { transform: "translate(5 5)", "font-size": "12" } },
      { op: "add", parent: "l1", pos: { first: true }, elem: { tag: "rect", attrs: { id: "o7k2m9x4q", x: "60", y: "60", width: "5", height: "5" } } },
    ] as const;
    for (const edit of edits) {
      const result = opened.engine.apply(edit);
      expect(result.outcome, JSON.stringify([edit, result])).toBe("applied");
      expect(read(opened.reindex())).toEqual(read(open(opened.engine.text).index));
    }
    expect(opened.reindex().get("r")).not.toBe(first.get("r"));
  });

  it("ritrova gli oggetti che non cambiano, e misura di nuovo quello cambiato", () => {
    const opened = open(SCENE);
    const before = opened.reindex();
    expect(opened.engine.apply({ op: "set", id: "tx", attrs: { y: "60" } }).outcome).toBe("applied");
    const after = opened.reindex();
    expect(after.get("r")).toBe(before.get("r"));
    expect(after.get("gr")).toBe(before.get("gr"));
    // La punta della linea può cambiare senza di lei: si misura sempre.
    expect(after.get("@1.1")).not.toBe(before.get("@1.1"));
    expect(project(after.get("@1.1")!)).toEqual(project(before.get("@1.1")!));
    expect(after.get("tx")).not.toBe(before.get("tx"));
    expect(after.get("tx")?.bounds?.min[1]).toBe((before.get("tx")?.bounds?.min[1] ?? 0) + 10);
  });
});
