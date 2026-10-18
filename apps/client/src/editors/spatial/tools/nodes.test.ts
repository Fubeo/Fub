// I nodi di un tracciato: lettura e scrittura del `d`, il tipo di ogni nodo,
// e le modifiche dello strumento «Nodi», che tengono ciò che si vede dove
// promettono di tenerlo.

import { describe, expect, it } from "vitest";
import { pointAt } from "../scene/curves";
import { parsePath } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { pathData } from "../scene/serialize";
import {
  bend,
  breakNodes,
  curveAt,
  deleteNodes,
  handlesFor,
  handleAt,
  handleSpot,
  inferred,
  insertNode,
  insertNodes,
  joinNodes,
  kindOf,
  linkAt,
  moveHandle,
  moveNodes,
  nodeAt,
  nodesWithin,
  openNode,
  pullHandles,
  pullSide,
  readNodes,
  realizeHandle,
  setKind,
  setLinks,
  writeNodes,
  type KindOf,
  type NodeKind,
  type Subpath,
} from "./nodes";

const read = (d: string): Subpath[] => readNodes(parsePath(d)!);
const write = (subs: readonly Subpath[]): string => pathData(writeNodes(subs));
const keys = (...list: string[]): Set<string> => new Set(list);

function near(a: Point, b: Point, within = 1e-9): void {
  expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${JSON.stringify(a)} invece di ${JSON.stringify(b)}`).toBeLessThanOrEqual(within);
}

/// I punti di un tracciato, campionati segmento per segmento.
function samples(subs: readonly Subpath[], per = 24): Point[] {
  const out: Point[] = [];
  for (const sub of subs) {
    out.push(sub.nodes[0]!);
    sub.links.forEach((_, i) => {
      const { from, curve } = curveAt(sub, i);
      for (let k = 1; k <= per; k++) out.push(pointAt(from, curve, k / per));
    });
  }
  return out;
}

/// La distanza più grande da un punto di `a` al punto più vicino di `b`.
function apart(a: readonly Point[], b: readonly Point[]): number {
  let worst = 0;
  for (const p of a) {
    let best = Infinity;
    for (let i = 0; i < b.length - 1; i++) {
      const [x1, y1] = b[i]!;
      const [x2, y2] = b[i + 1]!;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/// Vero se `a` e `b` si vedono uguali, entro `within`. Le spezzate che li
/// campionano stanno dentro le curve per meno di un decimillesimo, qui.
function sameLook(a: readonly Subpath[], b: readonly Subpath[], within: number): void {
  const pa = samples(a, 512);
  const pb = samples(b, 512);
  expect(apart(pa, pb)).toBeLessThanOrEqual(within);
  expect(apart(pb, pa)).toBeLessThanOrEqual(within);
}

const with_ = (subs: readonly Subpath[], overrides: Record<string, NodeKind>): KindOf => (sub, at) => overrides[`${sub}:${at}`] ?? inferred(subs)(sub, at);

describe("i nodi, letti e scritti", () => {
  it("legge nodi e segmenti, e riscrive lo stesso tracciato", () => {
    for (const d of [
      "M0 0 L10 0 L10 10 Z",
      "M0 0 Q5 5 10 0 A5 5 0 0 1 20 0 C25 0 30 5 30 10",
      "M0 0 C5 -5 10 -5 10 0 C10 5 5 10 0 0 Z",
      "M0 0 L10 0 Z M20 20 L30 30",
    ]) {
      expect(write(read(d))).toBe(d);
    }
    const square = read("M0 0 L10 0 L10 10 L0 10 Z");
    expect(square).toEqual([{ nodes: [[0, 0], [10, 0], [10, 10], [0, 10]], links: [{ kind: "line" }, { kind: "line" }, { kind: "line" }, { kind: "line" }], closed: true }]);
  });

  it("fa del ritorno al punto di partenza il segmento che chiude", () => {
    const subs = read("M0 0 L10 0 L10 10 L0 0 Z");
    expect(subs[0]!.nodes).toHaveLength(3);
    expect(write(subs)).toBe("M0 0 L10 0 L10 10 Z");
    const curved = read("M0 0 L10 0 C10 10 0 10 0.001 0 Z");
    expect(curved[0]!.nodes).toHaveLength(2);
    expect(write(curved)).toBe("M0 0 L10 0 C10 10 0 10 0 0 Z");
  });

  it("legge comandi relativi, un segmento dopo Z senza M, e un M da solo", () => {
    expect(write(read("m5 5 h10 z l5 5"))).toBe("M5 5 L15 5 Z M5 5 L10 10");
    // Una seconda chiusura è un sottotracciato fermo, che con le
    // terminazioni tonde si vede: resta.
    expect(write(read("M5 5 L10 5 Z Z"))).toBe("M5 5 L10 5 Z M5 5 Z");
    const subs = read("M1 1 M2 2 L3 3");
    expect(subs.map((sub) => sub.nodes.length)).toEqual([1, 2]);
    expect(write(subs)).toBe("M1 1 M2 2 L3 3");
    expect(write(read("M5 5 Z"))).toBe("M5 5 Z");
  });
});

describe("il tipo di un nodo, letto dalle direzioni", () => {
  const kinds = (d: string): NodeKind[] => {
    const sub = read(d)[0]!;
    return sub.nodes.map((_, at) => kindOf(sub, at));
  };

  it("distingue spigoli, nodi lisci e simmetrici", () => {
    expect(kinds("M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0")).toEqual(["corner", "symmetric", "corner"]);
    expect(kinds("M0 0 C0 10 10 10 10 0 C10 -5 20 -10 20 0")).toEqual(["corner", "smooth", "corner"]);
    expect(kinds("M0 0 C0 10 10 10 10 0 C12 -10 20 -10 20 0")).toEqual(["corner", "corner", "corner"]);
    // Una linea e una cubica che riparte nel suo verso.
    expect(kinds("M0 0 L10 0 C15 0 20 5 20 10")).toEqual(["corner", "smooth", "corner"]);
    expect(kinds("M0 0 L10 0 L20 0")).toEqual(["corner", "smooth", "corner"]);
    expect(kinds("M0 0 L10 0 L0 0")).toEqual(["corner", "corner", "corner"]);
  });

  it("perdona il centesimo con cui si scrive, non di più", () => {
    expect(kinds("M0 0 C0 10 10 10 10 0 C10.01 -10 20 -10 20 0")[1]).toBe("symmetric");
    expect(kinds("M0 0 C0 10 10 10 10 0 C10.05 -10 20 -10 20 0")[1]).toBe("corner");
  });

  it("fa uno spigolo di una maniglia ritirata sul nodo", () => {
    expect(kinds("M0 0 C0 10 10 0 10 0 C10 -10 20 -10 20 0")[1]).toBe("corner");
  });

  it("legge un sottotracciato chiuso tutto intorno", () => {
    const circle = read("M10 0 C10 5.52 5.52 10 0 10 C-5.52 10 -10 5.52 -10 0 C-10 -5.52 -5.52 -10 0 -10 C5.52 -10 10 -5.52 10 0 Z")[0]!;
    expect(circle.nodes.map((_, at) => kindOf(circle, at))).toEqual(["symmetric", "symmetric", "symmetric", "symmetric"]);
  });
});

describe("spostare nodi e maniglie", () => {
  it("sposta coi nodi le maniglie delle cubiche, e lascia ad archi e quadratiche le loro", () => {
    const subs = read("M0 0 C0 10 10 10 10 0 Q15 -5 20 0 A5 5 0 0 1 30 0");
    const moved = moveNodes(subs, keys("0:1", "0:2"), [1, 2], inferred(subs));
    expect(write(moved)).toBe("M0 0 C0 10 11 12 11 2 Q16 -3 21 2 A5 5 0 0 1 30 0");
    // Un capo solo della quadratica: il suo punto resta.
    expect(write(moveNodes(subs, keys("0:2"), [1, 0], inferred(subs)))).toBe("M0 0 C0 10 10 10 10 0 Q15 -5 21 0 A5 5 0 0 1 30 0");
  });

  it("gira la maniglia di un nodo liscio quando la linea accanto gira", () => {
    const subs = read("M0 0 L10 0 C15 0 20 5 20 10");
    const moved = moveNodes(subs, keys("0:0"), [0, -10], inferred(subs));
    const c1 = moved[0]!.links[1]!.kind === "cubic" ? moved[0]!.links[1]!.c1 : null;
    near(c1!, [10 + 5 * Math.SQRT1_2, 5 * Math.SQRT1_2], 1e-9);
    expect(kindOf(moved[0]!, 1)).toBe("smooth");
    // Lo stesso spostando il nodo liscio, che porta con sé la sua maniglia.
    const self = moveNodes(subs, keys("0:1"), [0, 10], inferred(subs));
    expect(kindOf(self[0]!, 1)).toBe("smooth");
    // Uno spigolo scelto resta com'è.
    expect(write(moveNodes(subs, keys("0:0"), [0, -10], with_(subs, { "0:1": "corner" })))).toBe("M0 -10 L10 0 C15 0 20 5 20 10");
  });

  it("trascina una maniglia: il nodo simmetrico specchia l'altra, il liscio la gira, lo spigolo la lascia", () => {
    const subs = read("M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0");
    const handle = { sub: 0, link: 1, which: "c1" } as const;
    expect(write(moveHandle(subs, handle, [16, 0], inferred(subs)))).toBe("M0 0 C0 10 4 0 10 0 C16 0 20 -10 20 0");
    expect(write(moveHandle(subs, handle, [16, 0], with_(subs, { "0:1": "smooth" })))).toBe("M0 0 C0 10 0 0 10 0 C16 0 20 -10 20 0");
    expect(write(moveHandle(subs, handle, [16, 0], with_(subs, { "0:1": "corner" })))).toBe("M0 0 C0 10 10 10 10 0 C16 0 20 -10 20 0");
    // Un cappio di un segmento solo non ha due lati da allineare.
    const loop = read("M0 0 C10 10 -10 10 0 0 Z");
    expect(write(moveHandle(loop, { sub: 0, link: 0, which: "c1" }, [10, 5], with_(loop, { "0:0": "smooth" })))).toBe("M0 0 C10 5 -10 10 0 0 Z");
  });

  it("mostra le maniglie dei segmenti che toccano un nodo scelto", () => {
    const subs = read("M0 0 C0 10 10 10 10 0 Q15 -5 20 0 L30 0 C30 5 40 5 40 0");
    expect(handlesFor(subs, keys("0:1"))).toEqual([
      { sub: 0, link: 0, which: "c1" },
      { sub: 0, link: 0, which: "c2" },
      { sub: 0, link: 1, which: "control" },
    ]);
    // La linea che arriva al nodo ha la maniglia sua, sulla linea.
    expect(handlesFor(subs, keys("0:3"))).toEqual([
      { sub: 0, link: 2, which: "c2" },
      { sub: 0, link: 3, which: "c1" },
      { sub: 0, link: 3, which: "c2" },
    ]);
  });

  it("tiene sulla retta di una linea la maniglia di un nodo liscio, mai dietro il nodo", () => {
    const subs = read("M0 0 L10 0 C15 0 20 5 20 10");
    const handle = { sub: 0, link: 1, which: "c1" } as const;
    expect(write(moveHandle(subs, handle, [18, 3], inferred(subs)))).toBe("M0 0 L10 0 C18 0 20 5 20 10");
    expect(write(moveHandle(subs, handle, [4, 3], inferred(subs)))).toBe("M0 0 L10 0 C10 0 20 5 20 10");
    // Lo stesso per la maniglia che arriva al nodo, con la linea dopo.
    const before = read("M0 10 C0 5 5 0 10 0 L20 0");
    const incoming = { sub: 0, link: 0, which: "c2" } as const;
    expect(write(moveHandle(before, incoming, [3, 4], inferred(before)))).toBe("M0 10 C0 5 3 0 10 0 L20 0");
    expect(write(moveHandle(before, incoming, [14, 3], inferred(before)))).toBe("M0 10 C0 5 10 0 10 0 L20 0");
  });

  it("muove il punto di una quadratica, e la cubica accanto a un nodo liscio lo segue", () => {
    const subs = read("M0 0 Q5 0 10 0 C15 0 20 5 20 10");
    const moved = moveHandle(subs, { sub: 0, link: 0, which: "control" }, [5, 5], inferred(subs));
    expect(moved[0]!.links[0]).toEqual({ kind: "quad", control: [5, 5] });
    expect(kindOf(moved[0]!, 1)).toBe("smooth");
  });
});

describe("le maniglie di ogni nodo", () => {
  // Una linea, mezzo giro d'arco, una cubica con la prima maniglia ritirata
  // sul suo nodo, e una quadratica.
  const subs = read("M0 0 L30 0 A15 15 0 0 1 60 0 C60 0 90 30 90 0 Q100 10 110 0");
  const kappa = (4 / 3) * Math.tan(Math.PI / 8);
  const stub = (size: number) => (): number => size;

  it("mostra le maniglie di ogni nodo scelto: della linea e della maniglia ritirata solo le sue", () => {
    expect(handlesFor(subs, keys("0:0"))).toEqual([{ sub: 0, link: 0, which: "c1" }]);
    expect(handlesFor(subs, keys("0:1"))).toEqual([
      { sub: 0, link: 0, which: "c2" },
      { sub: 0, link: 1, which: "c1" },
      { sub: 0, link: 1, which: "c2" },
    ]);
    expect(handlesFor(subs, keys("0:2"))).toEqual([
      { sub: 0, link: 1, which: "c1" },
      { sub: 0, link: 1, which: "c2" },
      { sub: 0, link: 2, which: "c1" },
      { sub: 0, link: 2, which: "c2" },
    ]);
    // La maniglia ritirata è del nodo prima, che non è scelto.
    expect(handlesFor(subs, keys("0:3"))).toEqual([{ sub: 0, link: 2, which: "c2" }, { sub: 0, link: 3, which: "control" }]);
  });

  it("le mostra dove il segmento le vuole: sulla linea a un terzo, sull'arco come sulle cubiche che lo approssimano", () => {
    expect(handleSpot(subs, { sub: 0, link: 0, which: "c1" }, stub(5))).toEqual({ point: [10, 0], folded: false });
    expect(handleSpot(subs, { sub: 0, link: 0, which: "c2" }, stub(5))).toEqual({ point: [20, 0], folded: false });
    const first = handleSpot(subs, { sub: 0, link: 1, which: "c1" }, stub(5))!;
    near(first.point, [30, -15 * kappa], 1e-9);
    expect(first.folded).toBe(false);
    near(handleSpot(subs, { sub: 0, link: 1, which: "c2" }, stub(5))!.point, [60, -15 * kappa], 1e-9);
    expect(handleSpot(subs, { sub: 0, link: 2, which: "c2" }, stub(5))).toEqual({ point: [90, 30], folded: false });
    expect(handleSpot(subs, { sub: 0, link: 3, which: "control" }, stub(5))).toEqual({ point: [100, 10], folded: false });
    expect(handleSpot(subs, { sub: 0, link: 3, which: "c1" }, stub(5))).toBeNull();
    // Una linea che non va da nessuna parte non ha maniglie.
    expect(handleSpot(read("M5 5 L5 5"), { sub: 0, link: 0, which: "c1" }, stub(5))).toBeNull();
  });

  it("mostra accanto al nodo la maniglia ritirata, sul verso del segmento e mai oltre un terzo", () => {
    const folded = handleSpot(subs, { sub: 0, link: 2, which: "c1" }, stub(5))!;
    expect(folded.folded).toBe(true);
    near(folded.point, [60 + 5 * Math.SQRT1_2, 5 * Math.SQRT1_2], 1e-9);
    near(handleSpot(subs, { sub: 0, link: 2, which: "c1" }, stub(50))!.point, [60 + 10 * Math.SQRT1_2, 10 * Math.SQRT1_2], 1e-9);
    // Ritirata all'arrivo: verso il segmento, all'indietro.
    const back = read("M0 0 C0 30 30 0 30 0");
    near(handleSpot(back, { sub: 0, link: 0, which: "c2" }, stub(5))!.point, [30 - 5 * Math.SQRT1_2, 5 * Math.SQRT1_2], 1e-9);
  });

  it("fa vera la maniglia di una linea, una cubica dritta che si vede uguale", () => {
    const line = read("M0 0 L30 0 L30 30");
    const real = realizeHandle(line, { sub: 0, link: 0, which: "c2" }, true);
    expect(write(real.subs)).toBe("M0 0 C10 0 20 0 30 0 L30 30");
    expect(real.handle).toEqual({ sub: 0, link: 0, which: "c2" });
    expect(real.moved).toBeNull();
    // Una cubica resta com'è.
    const curve = realizeHandle(subs, { sub: 0, link: 2, which: "c2" }, true);
    expect(write(curve.subs)).toBe(write(subs));
    expect(curve.moved).toBeNull();
  });

  it("fa vera la maniglia di un arco con le cubiche che lo approssimano, e porta i nodi dove vanno", () => {
    const real = realizeHandle(subs, { sub: 0, link: 1, which: "c2" }, false);
    expect(real.subs[0]!.nodes).toHaveLength(subs[0]!.nodes.length + 1);
    expect(real.handle).toEqual({ sub: 0, link: 2, which: "c2" });
    expect(real.moved!.get("0:1")).toBe("0:1");
    expect(real.moved!.get("0:2")).toBe("0:3");
    expect(real.moved!.get("0:4")).toBe("0:5");
    sameLook(subs, real.subs, 15 * 3e-4 + 1e-4);
    // La maniglia sta dove si vedeva.
    const link = real.subs[0]!.links[2]!;
    near(link.kind === "cubic" ? link.c2 : [NaN, NaN], [60, -15 * kappa], 1e-9);
  });

  it("fa cubiche anche l'arco dall'altra parte del nodo, se la sua maniglia deve girare", () => {
    const after = read("M0 0 A15 15 0 0 1 30 0 C40 0 50 10 60 0");
    const handle = { sub: 0, link: 1, which: "c1" } as const;
    expect(realizeHandle(after, handle, false).subs[0]!.links.map((link) => link.kind)).toEqual(["arc", "cubic"]);
    const turned = realizeHandle(after, handle, true);
    expect(turned.subs[0]!.links.map((link) => link.kind)).toEqual(["cubic", "cubic", "cubic"]);
    expect(turned.handle).toEqual({ sub: 0, link: 2, which: "c1" });
    expect(turned.moved!.get("0:1")).toBe("0:2");
    sameLook(after, turned.subs, 15 * 3e-4 + 1e-4);
  });

  it("apre un nodo: i segmenti ai suoi lati diventano cubiche che si vedono uguali", () => {
    const corner = read("M0 0 L100 0 L100 100");
    const opened = openNode(corner, "0:1");
    expect(write(opened.subs)).toBe("M0 0 C33.33 0 66.67 0 100 0 C100 33.33 100 66.67 100 100");
    expect(opened.key).toBe("0:1");
    expect(opened.moved).toBeNull();
    const arc = openNode(read("M0 0 A15 15 0 0 1 30 0 L60 0"), "0:1");
    expect(arc.key).toBe("0:2");
    expect(arc.moved!.get("0:2")).toBe("0:3");
  });

  it("tira le maniglie dal lato verso cui si trascina, e fa il nodo simmetrico", () => {
    const corner = read("M0 0 L100 0 L100 100");
    expect(pullSide(corner, "0:1", [0.2, 1])).toBe("out");
    expect(pullSide(corner, "0:1", [-1, 0.2])).toBe("in");
    expect(pullSide(corner, "0:0", [-1, 0])).toBe("out");
    expect(pullSide(corner, "0:2", [1, 0])).toBe("in");
    expect(pullSide(read("M0 0"), "0:0", [1, 0])).toBeNull();
    const opened = openNode(corner, "0:1");
    const pulled = pullHandles(opened.subs, opened.key, "out", [130, 20]);
    expect(write(pulled)).toBe("M0 0 C33.33 0 70 -20 100 0 C130 20 100 66.67 100 100");
    expect(kindOf(pulled[0]!, 1)).toBe("symmetric");
    const inward = pullHandles(opened.subs, opened.key, "in", [70, -20]);
    expect(write(inward)).toBe(write(pulled));
    // Un capo ha una maniglia sola.
    const end = openNode(corner, "0:0");
    expect(write(pullHandles(end.subs, end.key, "out", [10, 10]))).toBe("M0 0 C10 10 66.67 0 100 0 L100 100");
  });
});

describe("piegare un segmento", () => {
  /// Il punto al parametro `t` del segmento `link`.
  const at = (subs: readonly Subpath[], link: number, t: number): Point => {
    const { from, curve } = curveAt(subs[0]!, link);
    return pointAt(from, curve, t);
  };

  it("porta dove va il puntatore il punto preso di una cubica, di una linea e di una quadratica, coi nodi fermi", () => {
    for (const [d, t] of [["M0 0 C0 10 10 10 10 0", 0.5], ["M0 0 C0 10 10 10 10 0", 0.1], ["M0 0 C0 10 10 10 10 0", 0.7], ["M0 0 L10 0", 0.25], ["M0 0 Q5 0 10 0", 0.5]] as const) {
      const subs = read(d);
      const bent = bend(subs, 0, 0, t, [1, 4], inferred(subs));
      const before = at(subs, 0, t);
      near(at(bent, 0, t), [before[0] + 1, before[1] + 4], 1e-9);
      expect(bent[0]!.nodes).toEqual(subs[0]!.nodes);
    }
    // Una linea diventa cubica, una quadratica resta quadratica.
    const line = read("M0 0 L10 0");
    expect(bend(line, 0, 0, 0.25, [0, 4], inferred(line))[0]!.links[0]!.kind).toBe("cubic");
    const quad = read("M0 0 Q5 0 10 0");
    expect(write(bend(quad, 0, 0, 0.5, [0, 2], inferred(quad)))).toBe("M0 0 Q5 4 10 0");
    // Vicino a un nodo si muove la maniglia di quel nodo soltanto.
    const cubic = read("M0 0 C0 10 10 10 10 0");
    expect(bend(cubic, 0, 0, 0.1, [0, 1], inferred(cubic))[0]!.links[0]).toMatchObject({ c2: [10, 10] });
    expect(bend(cubic, 0, 0, 0.9, [0, 1], inferred(cubic))[0]!.links[0]).toMatchObject({ c1: [0, 10] });
    // In mezzo le maniglie si dividono lo spostamento con le equazioni di
    // Inkscape: a un terzo, quella vicina ne prende i quindici sedicesimi.
    const straight = read("M0 0 C10 0 20 0 30 0");
    const third = bend(straight, 0, 0, 1 / 3, [0, 9], inferred(straight))[0]!.links[0]!;
    expect(third.kind).toBe("cubic");
    if (third.kind === "cubic") {
      near(third.c1, [10, 18.984375], 1e-9);
      near(third.c2, [20, 2.53125], 1e-9);
    }
    const twoThirds = bend(straight, 0, 0, 2 / 3, [0, 9], inferred(straight))[0]!.links[0]!;
    expect(twoThirds).toMatchObject({ kind: "cubic" });
    if (twoThirds.kind === "cubic") {
      near(twoThirds.c1, [10, 2.53125], 1e-9);
      near(twoThirds.c2, [20, 18.984375], 1e-9);
    }
    // Un arco che SVG disegna come una linea si piega come lei.
    const flat = read("M0 0 A0 5 0 0 1 10 0");
    const unbent = bend(flat, 0, 0, 0.25, [0, 4], inferred(flat));
    expect(unbent[0]!.links[0]!.kind).toBe("cubic");
    near(at(unbent, 0, 0.25), [2.5, 4], 1e-9);
    // Sul nodo stesso il parametro si ferma un passo prima: niente infiniti.
    expect(write(bend(cubic, 0, 0, 0, [0, 1], inferred(cubic)))).not.toMatch(/Infinity|NaN/);
    expect(write(bend(cubic, 0, 0, 1, [0, 1], inferred(cubic)))).not.toMatch(/Infinity|NaN/);
  });

  it("tiene un arco un arco, che passa per il punto spostato", () => {
    const half = read("M0 0 A5 5 0 0 1 10 0");
    const kinds = inferred(half);
    expect(write(bend(half, 0, 0, 0.5, [0, -5], kinds))).toBe("M0 0 A6.25 6.25 0 1 1 10 0");
    expect(write(bend(half, 0, 0, 0.5, [0, 4], kinds))).toBe("M0 0 A13 13 0 0 1 10 0");
    // Dall'altra parte della corda gira nell'altro verso, e sulla corda è una
    // linea.
    expect(write(bend(half, 0, 0, 0.5, [0, 10], kinds))).toBe("M0 0 A5 5 0 0 0 10 0");
    expect(write(bend(half, 0, 0, 0.5, [0, 5], kinds))).toBe("M0 0 L10 0");
    // Anche a un centesimo dalla corda, che è come si scrive.
    expect(write(bend(half, 0, 0, 0.5, [0, 4.99], kinds))).toBe("M0 0 L10 0");
    // Un'ellisse girata tiene proporzioni e rotazione.
    const tilted = read("M0 0 A10 5 30 0 1 20 0");
    const target = at(tilted, 0, 0.4);
    const bent = bend(tilted, 0, 0, 0.4, [2, -3], inferred(tilted));
    const link = bent[0]!.links[0]!;
    expect(link.kind).toBe("arc");
    if (link.kind !== "arc") return;
    expect(link.radii[0] / link.radii[1]).toBeCloseTo(2, 9);
    expect(link.rotation).toBe(30);
    expect(apart([[target[0] + 2, target[1] - 3]], samples(bent, 4096))).toBeLessThan(1e-3);
  });

  it("tiene lisci i nodi lisci accanto, e lascia gli spigoli", () => {
    const subs = read("M0 0 C5 0 10 5 10 10 C10 15 15 20 20 20");
    expect(kindOf(subs[0]!, 1)).toBe("symmetric");
    const bent = bend(subs, 0, 0, 0.6, [-3, 2], inferred(subs));
    expect(kindOf(bent[0]!, 1)).toBe("symmetric");
    expect(kindOf(bend(subs, 0, 0, 0.6, [-3, 2], with_(subs, { "0:1": "corner" }))[0]!, 1)).toBe("corner");
    // La cubica dopo un arco segue il verso nuovo dell'arco.
    const arc = read("M0 0 A5 5 0 0 1 10 0 C10 5 15 10 20 10");
    expect(kindOf(arc[0]!, 1)).toBe("smooth");
    const after = bend(arc, 0, 0, 0.5, [0, -3], inferred(arc));
    expect(after[0]!.links[0]!.kind).toBe("arc");
    expect(kindOf(after[0]!, 1)).toBe("smooth");
    // E quella prima, all'altro capo.
    const before = read("M-10 10 C-5 10 0 5 0 0 A5 5 0 0 1 10 0");
    expect(kindOf(before[0]!, 1)).toBe("smooth");
    expect(kindOf(bend(before, 0, 1, 0.5, [0, -3], inferred(before))[0]!, 1)).toBe("smooth");
  });
});

describe("il tipo dei nodi e dei segmenti", () => {
  it("fa liscio e simmetrico un nodo fra due linee, che diventano curve dritte ai capi", () => {
    const subs = read("M0 0 L10 0 L20 10");
    for (const kind of ["smooth", "symmetric"] as const) {
      const edited = setKind(subs, keys("0:1"), kind);
      const sub = edited.subs[0]!;
      expect(edited.changed).toBe(1);
      expect(sub.nodes).toEqual(subs[0]!.nodes);
      expect(kindOf(sub, 1)).toBe(kind);
      // Ai capi le maniglie restano sulle linee di prima, a un terzo.
      const [first, second] = sub.links;
      near(first!.kind === "cubic" ? first!.c1 : [NaN, NaN], [10 / 3, 0]);
      near(second!.kind === "cubic" ? second!.c2 : [NaN, NaN], [20 - 10 / 3, 10 - 10 / 3]);
    }
  });

  it("allinea a una linea la maniglia dell'altro lato, e la linea resta dritta", () => {
    const subs = read("M0 0 L10 0 C10 5 20 5 20 10");
    const edited = setKind(subs, keys("0:1"), "smooth");
    expect(write(edited.subs)).toBe("M0 0 L10 0 C15 0 20 5 20 10");
    // Simmetrico fa della linea una cubica, con le maniglie lunghe uguali.
    const symmetric = setKind(subs, keys("0:1"), "symmetric");
    expect(symmetric.subs[0]!.links[0]!.kind).toBe("cubic");
    expect(kindOf(symmetric.subs[0]!, 1)).toBe("symmetric");
  });

  it("fa uscire una maniglia ritirata, e uno spigolo non cambia niente", () => {
    const subs = read("M0 0 C0 10 10 0 10 0 C10 -10 20 -10 20 0");
    expect(kindOf(setKind(subs, keys("0:1"), "smooth").subs[0]!, 1)).toBe("smooth");
    const after = read("M0 0 C0 10 10 10 10 0 C10 0 20 -10 20 0");
    expect(kindOf(setKind(after, keys("0:1"), "smooth").subs[0]!, 1)).toBe("smooth");
    const corner = setKind(subs, keys("0:1", "0:0"), "corner");
    expect(corner.subs).toEqual(subs);
    // Un capo di un aperto non ha due lati: non conta.
    expect(corner.changed).toBe(1);
    // Due lati che tornano l'uno sull'altro: le maniglie di traverso.
    expect(write(setKind(read("M0 0 L10 0 L0 0"), keys("0:1"), "smooth").subs)).toBe("M0 0 C3.33 0 10 -3.33 10 0 C10 3.33 3.33 0 0 0");
  });

  it("rimappa i nodi quando un arco accanto diventa più cubiche", () => {
    const subs = read("M0 0 A10 10 0 0 1 20 0 L30 0 M0 50 L10 50");
    const edited = setKind(subs, keys("0:1", "1:0"), "symmetric");
    expect(edited.subs[0]!.nodes).toHaveLength(4);
    expect(edited.selected).toEqual(["0:2", "1:0"]);
    expect(edited.moved.get("1:1")).toBe("1:1");
    expect(edited.moved.get("0:2")).toBe("0:3");
    expect(kindOf(edited.subs[0]!, 2)).toBe("symmetric");
  });

  it("fa linee e curve dei segmenti fra due nodi scelti", () => {
    const subs = read("M0 0 C0 10 10 10 10 0 L20 0 Q25 5 30 0 A10 10 0 0 1 50 0");
    const lines = setLinks(subs, keys("0:0", "0:1", "0:2"), "line");
    expect(write(lines.subs)).toBe("M0 0 L10 0 L20 0 Q25 5 30 0 A10 10 0 0 1 50 0");
    expect(lines.changed).toBe(1);
    const curves = setLinks(subs, keys("0:1", "0:2", "0:3", "0:4"), "curve");
    expect(curves.changed).toBe(3);
    expect(curves.subs[0]!.links.map((link) => link.kind)).toEqual(["cubic", "cubic", "cubic", "cubic", "cubic"]);
    // L'arco di mezzo giro diventa due quarti, col nodo fra loro scelto.
    expect(curves.selected).toEqual(["0:1", "0:2", "0:3", "0:4", "0:5"]);
    sameLook(subs, curves.subs, 10 * 3e-4 + 1e-4);
    expect(setLinks(subs, keys("0:0", "0:2"), "curve").changed).toBe(0);
    // Un arco che non va da nessuna parte diventa una cubica ferma, e i
    // nodi restano quelli.
    expect(write(setLinks(read("M0 0 L10 0 A5 5 0 0 1 10 0 L20 0"), keys("0:1", "0:2"), "curve").subs)).toBe("M0 0 L10 0 C10 0 10 0 10 0 L20 0");
  });
});

describe("aggiungere e togliere nodi", () => {
  it("mette un nodo a metà di ogni segmento fra due nodi scelti, e sceglie quelli", () => {
    const subs = read("M0 0 C0 10 10 10 10 0 L20 0 A5 5 0 0 1 30 0 Z");
    const edited = insertNodes(subs, keys("0:0", "0:1", "0:2", "0:3"));
    expect(edited.subs[0]!.nodes).toHaveLength(8);
    expect(edited.selected).toEqual(["0:1", "0:3", "0:5", "0:7"]);
    near(edited.subs[0]!.nodes[1]!, [5, 7.5]);
    near(edited.subs[0]!.nodes[5]!, [25, -5]);
    sameLook(subs, edited.subs, 1e-4);
  });

  it("mette un nodo dove si tocca un segmento", () => {
    const subs = read("M0 0 L10 0 L20 0 M0 10 L10 10 L20 10");
    const edited = insertNode(subs, 0, 1, 0.25);
    expect(write(edited.subs)).toBe("M0 0 L10 0 L12.5 0 L20 0 M0 10 L10 10 L20 10");
    expect(edited.selected).toEqual(["0:2"]);
  });

  it("toglie un nodo e unisce i segmenti: due linee in una linea, due curve in una curva vicina", () => {
    expect(write(deleteNodes(read("M0 0 L10 5 L20 0"), keys("0:1")).subs)).toBe("M0 0 L20 0");
    // Un nodo messo a metà di una cubica e poi tolto ridà la cubica.
    const cubic = read("M0 0 C0 20 30 20 30 0");
    const split = insertNode(cubic, 0, 0, 0.5);
    const back = deleteNodes(split.subs, keys("0:1"));
    expect(back.changed).toBe(1);
    sameLook(cubic, back.subs, 1e-4);
    // Fra un arco e una linea: una curva sola, vicina a tutti e due.
    const mixed = read("M0 0 A10 10 0 0 1 20 0 L30 10");
    const joined = deleteNodes(mixed, keys("0:1")).subs;
    expect(joined[0]!.links).toHaveLength(1);
    expect(joined[0]!.links[0]!.kind).toBe("cubic");
  });

  it("lascia libera la curva quando i versi ai capi non la fanno passare vicino", () => {
    const away = (d: string): number => {
      const subs = read(d);
      return apart(samples(subs, 64), samples(deleteNodes(subs, keys("0:1")).subs, 512));
    };
    // Una maniglia che parte all'insù, e la curva che poi scende: la curva
    // nuova scende subito, senza un ricciolo al nodo.
    const hook = deleteNodes(read("M0 0 C0 -1 0 10 10 10 C20 10 20 -1 20 0"), keys("0:1")).subs[0]!.links[0]!;
    expect(hook.kind === "cubic" && hook.c1[1] > 0 && hook.c2[1] > 0).toBe(true);
    expect(away("M0 0 C0 -1 0 10 10 10 C20 10 20 -1 20 0")).toBeLessThan(0.1);
    // Un cappio che parte e arriva lungo la stessa retta non diventa piatto.
    expect(away("M0 0 C10 0 10 10 0 10 C-10 10 -10 0 0 0")).toBeLessThan(1.2);
    expect(away("M0 0 C-1 0 5 5 10 5 C15 5 21 0 20 0")).toBeLessThan(0.2);
  });

  it("toglie i capi di un aperto coi loro segmenti, e i sottotracciati che restano senza", () => {
    const subs = read("M0 0 L10 0 L20 0 L30 0 M0 10 L10 10 M0 20 L10 20");
    const edited = deleteNodes(subs, keys("0:0", "0:3", "1:1"));
    expect(write(edited.subs)).toBe("M10 0 L20 0 M0 20 L10 20");
    expect(edited.moved.get("2:0")).toBe("1:0");
    expect(edited.changed).toBe(3);
    expect(deleteNodes(read("M0 0 L10 0"), keys("0:0", "0:1")).subs).toEqual([]);
  });

  it("toglie un nodo di un chiuso, che resta chiuso, e i segmenti fra nodi che restano non cambiano", () => {
    const edited = deleteNodes(read("M0 0 L10 0 L10 10 L0 10 Z"), keys("0:2"));
    expect(write(edited.subs)).toBe("M0 0 L10 0 L0 10 Z");
    expect(write(deleteNodes(read("M0 0 A10 10 0 0 1 20 0 Q25 5 30 0 L30 10 Z"), keys("0:3")).subs)).toBe("M0 0 A10 10 0 0 1 20 0 Q25 5 30 0 Z");
  });
});

describe("spezzare e unire", () => {
  it("apre un chiuso al nodo spezzato, che diventa i due capi", () => {
    const edited = breakNodes(read("M0 0 L10 0 L10 10 L0 10 Z"), keys("0:2"));
    expect(write(edited.subs)).toBe("M10 10 L0 10 L0 0 L10 0 L10 10");
    expect(edited.selected).toEqual(["0:0", "0:4"]);
    expect(edited.moved.get("0:2")).toBe("0:0");
    expect(edited.moved.get("0:0")).toBe("0:2");
    expect(edited.changed).toBe(1);
  });

  it("divide un aperto in due ai nodi spezzati, e lascia i capi", () => {
    const edited = breakNodes(read("M0 0 L10 0 L20 0 L30 0"), keys("0:0", "0:1", "0:2"));
    expect(write(edited.subs)).toBe("M0 0 L10 0 M10 0 L20 0 M20 0 L30 0");
    expect(edited.selected).toEqual(["0:1", "1:0", "1:1", "2:0"]);
    expect(edited.moved.get("0:1")).toBe("0:1");
    expect(edited.moved.get("0:3")).toBe("2:1");
    expect(edited.changed).toBe(2);
    expect(breakNodes(read("M0 0 L10 0"), keys("0:0")).changed).toBe(0);
  });

  it("chiude un aperto unendo i suoi capi: in un nodo se si toccano, con una linea se no", () => {
    expect(write(joinNodes(read("M0 0 L10 0 L10 10"), keys("0:0", "0:2"))!.subs)).toBe("M0 0 L10 0 L10 10 Z");
    const touching = joinNodes(read("M0 0 L10 0 L10 10 L0 0"), keys("0:0", "0:3"))!;
    expect(write(touching.subs)).toBe("M0 0 L10 0 L10 10 Z");
    expect(touching.selected).toEqual(["0:0"]);
  });

  it("fa un sottotracciato solo di due, girandoli perché i capi scelti si incontrino", () => {
    const subs = read("M0 0 L10 0 M40 0 L30 0 C30 5 20 5 20 0 M0 50 L5 50");
    const edited = joinNodes(subs, keys("0:1", "1:2"))!;
    expect(write(edited.subs)).toBe("M0 0 L10 0 L20 0 C20 5 30 5 30 0 L40 0 M0 50 L5 50");
    expect(edited.selected).toEqual(["0:1", "0:2"]);
    expect(edited.moved.get("1:0")).toBe("0:4");
    expect(edited.moved.get("2:1")).toBe("1:1");
    const meeting = joinNodes(read("M10 0 L0 0 M10 0 L20 0"), keys("0:0", "1:0"))!;
    expect(write(meeting.subs)).toBe("M0 0 L10 0 L20 0");
    expect(meeting.selected).toEqual(["0:1"]);
  });

  it("non unisce nodi che non sono capi, né più di due", () => {
    expect(joinNodes(read("M0 0 L10 0 L20 0"), keys("0:1", "0:2"))).toBeNull();
    expect(joinNodes(read("M0 0 L10 0 Z M20 0 L30 0"), keys("0:0", "1:0"))).toBeNull();
    expect(joinNodes(read("M0 0 L10 0 M20 0 L30 0"), keys("0:0", "1:0", "1:1"))).toBeNull();
  });
});

describe("che cosa sta sotto il puntatore", () => {
  const subs = read("M0 0 C0 10 10 10 10 0 L20 0");
  const m = [2, 0, 0, 2, 100, 0] as const;

  it("trova il nodo e la maniglia più vicini, nella scena", () => {
    expect(nodeAt(subs, m, [120, 1], 3)).toBe("0:1");
    expect(nodeAt(subs, m, [120, 5], 3)).toBeNull();
    const spots = [
      { handle: { sub: 0, link: 0, which: "c1" }, point: [0, 10] },
      { handle: { sub: 0, link: 0, which: "c2" }, point: [10, 10] },
    ] as const;
    expect(handleAt(spots, m, [119, 21], 3)).toBe(spots[1]);
    expect(handleAt(spots, m, [119, 30], 3)).toBeNull();
    expect(nodesWithin(subs, m, { min: [110, -1], max: [150, 1] })).toEqual(["0:1", "0:2"]);
    expect(nodesWithin(subs, m, { min: [90, 1], max: [150, 30] })).toEqual([]);
  });

  it("trova il segmento e il parametro del punto più vicino", () => {
    const hit = linkAt(subs, m, [126, 1], 2)!;
    expect(hit).toMatchObject({ sub: 0, link: 1 });
    expect(hit.t).toBeCloseTo(0.3, 6);
    expect(linkAt(subs, m, [130, 10], 2)).toBeNull();
  });
});
