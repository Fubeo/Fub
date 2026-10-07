// I comandi del menu Tracciato sul documento: il contorno che diventa una
// forma, lo scostamento, la semplificazione e l'inchiostro che diventa un
// tracciato. Ogni comando è un passo solo, e un annulla riporta tutto al
// byte.

import { describe, expect, it } from "vitest";
import { formatBrush, PF1_DEFAULTS } from "../ink/brush";
import { encodeInk, inkFromSamples } from "../ink/codec";
import { pf1 } from "../ink/pf1";
import { quantizeInk, type InkSample } from "../ink/sample";
import { pointAt } from "../scene/curves";
import { parsePath, type Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import { nodeCount } from "./simplify";
import { dashesOf, inkPathOps, offsetOps, outlineStrokeOps, simplifyOps, type PathsDone } from "./paths";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Scrive `change`, verifica che un annulla riporti il testo di prima, e
/// torna il testo di dopo.
function written(opened: Opened, change: PathsDone): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  return after;
}

/// Il nome dell'elemento di id `id` nel testo `text`, e i suoi attributi.
function element(text: string, id: string): { tag: string; attrs: Record<string, string> } {
  const found = new RegExp(`<([a-z]+) id="${id}"([^>]*?)/?>`).exec(text);
  if (found === null) throw new Error(`nessun elemento ${id}`);
  const attrs: Record<string, string> = {};
  for (const [, name, value] of found[2]!.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[name!] = value!;
  return { tag: found[1]!, attrs };
}

/// Gli id degli elementi di `text`, in ordine.
const order = (text: string): string[] => [...text.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);

/// L'area con la regola nonzero di `d`, misurata su spezzate fitte.
function area(d: string): number {
  let sum = 0;
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  const add = (p: Point): void => {
    sum += current[0] * p[1] - p[0] * current[1];
    current = p;
  };
  for (const segment of parsePath(d)!) {
    if (segment.kind === "move") start = current = segment.to;
    else if (segment.kind === "close") add(start);
    else for (let k = 1; k <= 64; k++) add(pointAt(current, segment, k / 64));
  }
  return Math.abs(sum / 2);
}

/// Il riquadro di `d`.
function boundsOf(d: string): [number, number, number, number] {
  const points = (parsePath(d) as Segment[]).flatMap((s) => (s.kind === "close" ? [] : [s.to]));
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
}

const BRUSH = { ...PF1_DEFAULTS, size: 6 };

/// Un tratto dello strumento `tool` lungo gli spigoli `corners`, un punto
/// ogni tre unità.
function stroke(id: string, corners: readonly Point[], tool = "pen", extra = ""): string {
  const points: Point[] = [corners[0]!];
  for (let i = 1; i < corners.length; i++) {
    const [[ax, ay], [bx, by]] = [corners[i - 1]!, corners[i]!];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
    for (let k = 1; k <= steps; k++) points.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps]);
  }
  const samples: InkSample[] = points.map(([x, y], i) => ({ x, y, t: i * 8 }));
  const d = pf1(quantizeInk(samples), BRUSH);
  return `<path id="${id}" fub:tool="${tool}" fub:brush="${formatBrush(BRUSH)}" d="${d}" fill="#cc3300" fill-opacity="0.8" fub:ink="${encodeInk(inkFromSamples(samples, 100))}"${extra}/>`;
}

/// Il comando `run` sugli oggetti `keys` di `body`, nel livello: il testo di
/// dopo e il comando.
function run<T extends PathsDone>(body: string, keys: readonly string[], command: (opened: Opened, units: ReturnType<Opened["index"]["get"]>[]) => T): { text: string; change: T } {
  const opened = open(doc(`${LAYER}${body}</g>`));
  const change = command(opened, keys.map((key) => opened.index.get(key)));
  return { text: change.ops.length === 0 ? opened.engine.text : written(opened, change), change };
}

const outline = (body: string, keys: readonly string[]) =>
  run(body, keys, (opened, units) => outlineStrokeOps(opened.engine.model!, opened.index, units.map((unit) => unit!), ids(opened)));

describe("contorno in tracciato", () => {
  it("un contorno senza riempimento diventa la forma piena del suo colore, al suo posto", () => {
    const { text, change } = outline('<line id="a" x1="0" y1="0" x2="100" y2="0" stroke="#336699" stroke-width="10" stroke-opacity="0.5"/><rect id="b" x="0" y="0" width="1" height="1"/>', ["a"]);
    const path = element(text, "a");
    expect(path.tag).toBe("path");
    expect(path.attrs).toMatchObject({ fill: "#336699", "fill-opacity": "0.5" });
    expect(path.attrs.stroke).toBeUndefined();
    expect(path.attrs["stroke-width"]).toBeUndefined();
    expect(boundsOf(path.attrs.d!)).toEqual([0, -5, 100, 5]);
    expect(area(path.attrs.d!)).toBeCloseTo(1000, 3);
    expect(order(text)).toEqual(["l1", "a", "b"]);
    expect(change).toMatchObject({ changed: 1, skipped: 0, refused: 0, keys: ["a"] });
  });

  it("una forma piena diventa un gruppo col suo id: il riempimento sotto, il contorno sopra", () => {
    const { text, change } = outline(
      '<rect id="r" x="0" y="0" width="20" height="10" fill="#ff0000" stroke="#000000" stroke-width="2" opacity="0.5" transform="translate(5 5)"><title>Bandiera</title></rect>',
      ["r"],
    );
    const group = element(text, "r");
    expect(group).toEqual({ tag: "g", attrs: { opacity: "0.5", transform: "translate(5 5)" } });
    const [, fillId, outlineId] = order(text).slice(1);
    expect(element(text, fillId!)).toEqual({ tag: "rect", attrs: { x: "0", y: "0", width: "20", height: "10", fill: "#ff0000" } });
    const ring = element(text, outlineId!);
    expect(ring.attrs.fill).toBe("#000000");
    expect(boundsOf(ring.attrs.d!)).toEqual([-1, -1, 21, 11]);
    expect(area(ring.attrs.d!)).toBeCloseTo(22 * 12 - 18 * 8, 3);
    expect(text).toContain("<title>Bandiera</title>");
    expect(change).toMatchObject({ changed: 1, keys: ["r"] });
  });

  it("il tratteggio diventa i suoi trattini, con gli estremi", () => {
    const { text } = outline('<line id="a" x1="0" y1="0" x2="100" y2="0" stroke="#000000" stroke-width="2" stroke-dasharray="10 5"/>', ["a"]);
    const d = element(text, "a").attrs.d!;
    expect(d.match(/M/g)).toHaveLength(7);
    expect(area(d)).toBeCloseTo(70 * 2, 3);
  });

  it("il contorno ereditato da un gruppo: la forma lo dice spento", () => {
    const { text, change } = outline('<g id="g" stroke="#00ff00" stroke-width="4" fill="none"><line id="a" x1="0" y1="0" x2="10" y2="0"/></g>', ["g"]);
    expect(element(text, "a").attrs).toMatchObject({ fill: "#00ff00", stroke: "none" });
    expect(change.changed).toBe(1);
  });

  it("tratti a penna e forme senza contorno restano, e si contano", () => {
    const { text, change } = outline(`<rect id="a" x="0" y="0" width="5" height="5" fill="#ff0000"/>${stroke("s", [[10, 10], [90, 10]])}`, ["a", "s"]);
    expect(change).toMatchObject({ changed: 0, skipped: 2, refused: 0, ops: [] });
    expect(text).toContain('<rect id="a"');
  });

  it("i tratteggi come li disegna SVG", () => {
    expect(dashesOf("none")).toEqual([]);
    expect(dashesOf("5")).toEqual([5, 5]);
    expect(dashesOf("4, 2 1")).toEqual([4, 2, 1, 4, 2, 1]);
    expect(dashesOf("0 0")).toEqual([]);
    expect(dashesOf("3 -1")).toEqual([]);
  });
});

const offset = (body: string, keys: readonly string[], distance: number, join: "miter" | "round" | "bevel" = "miter") =>
  run(body, keys, (opened, units) => offsetOps(opened.engine.model!, opened.index, units.map((unit) => unit!), distance, { join, miterLimit: 4 }, ids(opened)));

describe("scostamento", () => {
  const RECT = '<rect id="a" x="0" y="0" width="20" height="10" fill="#ff0000" stroke="#000000"/>';

  it("più grande: un tracciato nuovo sotto la forma, coi suoi colori, ed è scelto", () => {
    const { text, change } = offset(RECT, ["a"], 2);
    const added = change.keys[0]!;
    expect(order(text)).toEqual(["l1", added, "a"]);
    const path = element(text, added);
    expect(path.attrs).toMatchObject({ fill: "#ff0000", stroke: "#000000" });
    // Quattro nodi, come il rettangolo: le fasce del calcolo non lasciano
    // nodi sui lati dritti.
    expect(path.attrs.d).toBe("M22 -2 L22 12 L-2 12 L-2 -2 Z");
    expect(change).toMatchObject({ changed: 1, vanished: 0 });
    expect(change.preview).toHaveLength(1);
  });

  it("più piccolo: sopra la forma; troppo piccolo, sparisce", () => {
    const { text, change } = offset(RECT, ["a"], -2);
    expect(order(text)).toEqual(["l1", "a", change.keys[0]!]);
    expect(boundsOf(element(text, change.keys[0]!).attrs.d!)).toEqual([2, 2, 18, 8]);
    expect(offset(RECT, ["a"], -6).change).toMatchObject({ changed: 0, vanished: 1, ops: [], keys: ["a"] });
  });

  it("la distanza è nella scena: una forma ingrandita si scosta nelle sue coordinate di meno", () => {
    const { text, change } = offset('<rect id="a" x="0" y="0" width="20" height="10" fill="#ff0000" transform="scale(2)"/>', ["a"], 2);
    const path = element(text, change.keys[0]!);
    expect(path.attrs.transform).toBe("scale(2)");
    expect(boundsOf(path.attrs.d!)).toEqual([-1, -1, 21, 11]);
  });

  it("una linea, piena o no, diventa la striscia attorno a lei", () => {
    for (const fill of ["", ' fill="none"']) {
      const { text, change } = offset(`<line id="a" x1="0" y1="0" x2="100" y2="0" stroke="#000000"${fill}/>`, ["a"], 5);
      expect(boundsOf(element(text, change.keys[0]!).attrs.d!)).toEqual([-5, -5, 105, 5]);
    }
    expect(offset('<line id="a" x1="0" y1="0" x2="100" y2="0" stroke="#000000"/>', ["a"], -5).change).toMatchObject({ vanished: 1, ops: [] });
  });

  it("un tratto a penna si scosta come la forma che si vede, e il tracciato nuovo non è inchiostro", () => {
    const { text, change } = offset(stroke("s", [[10, 10], [90, 10]]), ["s"], 2);
    const path = element(text, change.keys[0]!);
    expect(path.attrs).toEqual({ d: path.attrs.d, fill: "#cc3300", "fill-opacity": "0.8" });
    const [x0, y0, x1, y1] = boundsOf(path.attrs.d!);
    expect(x0).toBeLessThan(10 - 4);
    expect(x1).toBeGreaterThan(90 + 4);
    expect(y1 - y0).toBeGreaterThan(6 + 3);
  });

  it("dentro un gruppo, ogni forma si scosta per conto suo", () => {
    const { text, change } = offset(`<g id="g" transform="translate(100 0)">${RECT}<circle id="c" cx="50" cy="50" r="10"/></g>`, ["g"], 1);
    expect(change).toMatchObject({ changed: 2 });
    expect(order(text)).toEqual(["l1", "g", change.keys[0]!, "a", change.keys[1]!, "c"]);
  });
});

const simplify = (body: string, keys: readonly string[], tolerance: number) =>
  run(body, keys, (opened, units) => simplifyOps(opened.engine.model!, opened.index, units.map((unit) => unit!), tolerance, ids(opened)));

/// I punti di un poligono regolare di `n` lati, scritti.
const polygonPoints = (n: number, r: number): string =>
  Array.from({ length: n }, (_, i) => `${(50 + r * Math.cos((2 * Math.PI * i) / n)).toFixed(2)},${(50 + r * Math.sin((2 * Math.PI * i) / n)).toFixed(2)}`).join(" ");

describe("semplifica", () => {
  it("un poligono fitto diventa un tracciato di poche curve", () => {
    const { text, change } = simplify(`<polygon id="a" points="${polygonPoints(64, 40)}" fill="#ff0000"/>`, ["a"], 0.5);
    const path = element(text, "a");
    expect(path.tag).toBe("path");
    expect(path.attrs.fill).toBe("#ff0000");
    expect(nodeCount(parsePath(path.attrs.d!)!)).toBe(change.after);
    expect(change).toMatchObject({ changed: 1, before: 64, keys: ["a"] });
    expect(change.after).toBeLessThanOrEqual(8);
  });

  it("le forme che non perdono nodi restano, e contano coi loro nodi", () => {
    const { change } = simplify('<rect id="a" x="0" y="0" width="20" height="10"/><circle id="b" cx="50" cy="50" r="40"/>', ["a", "b"], 0.5);
    expect(change).toMatchObject({ changed: 0, before: 8, after: 8, ops: [] });
  });

  it("un cerchio piccolo con una tolleranza larga si fa di due curve", () => {
    const { text, change } = simplify('<circle id="a" cx="5" cy="5" r="5"/>', ["a"], 1);
    expect(change).toMatchObject({ changed: 1, before: 4, after: 2 });
    expect(element(text, "a").tag).toBe("path");
  });

  it("la tolleranza è nella scena", () => {
    // Ingrandito dieci volte, mezzo punto nella scena è un ventesimo nel
    // poligono: troppo poco per togliere i suoi nodi.
    const body = `<polygon id="a" points="${polygonPoints(24, 4)}" transform="scale(10)"/>`;
    expect(simplify(body, ["a"], 0.05).change.changed).toBe(0);
    expect(simplify(body, ["a"], 5).change.changed).toBe(1);
  });
});

const ink = (body: string, keys: readonly string[]) =>
  run(body, keys, (opened, units) => inkPathOps(opened.engine.model!, opened.index, units.map((unit) => unit!), ids(opened)));

describe("inchiostro in tracciato", () => {
  it("un tratto a penna diventa la sua spina, col colore come contorno e lo spessore del pennello", () => {
    const { text, change } = ink(`${stroke("a", [[10, 10], [90, 10], [90, 60]])}<rect id="b" x="0" y="0" width="1" height="1"/>`, ["a", "b"]);
    const path = element(text, "a");
    expect(path.tag).toBe("path");
    expect(path.attrs).toMatchObject({ fill: "none", stroke: "#cc3300", "stroke-opacity": "0.8", "stroke-width": "6", "stroke-linecap": "round", "stroke-linejoin": "round" });
    expect(Object.keys(path.attrs).some((name) => name.startsWith("fub:"))).toBe(false);
    // Due lati, uno spigolo: tre nodi.
    const segments = parsePath(path.attrs.d!)!;
    expect(nodeCount(segments)).toBe(3);
    expect(segments[0]!.kind === "move" && segments[0]!.to).toEqual([10, 10]);
    expect(change).toMatchObject({ changed: 1, refused: 0, keys: ["a", "b"] });
  });

  it("l'evidenziatore e gli altri oggetti restano", () => {
    const { change } = ink(`${stroke("a", [[10, 10], [90, 10]], "highlighter")}<rect id="b" x="0" y="0" width="1" height="1"/>`, ["a", "b"]);
    expect(change).toMatchObject({ changed: 0, refused: 0, ops: [] });
  });

  it("dentro un gruppo, con la sua trasformazione e il suo titolo", () => {
    const body = `<g id="g">${stroke("a", [[0, 0], [60, 0]], "pen", ' transform="rotate(30)"')}</g>`.replace("/></g>", "><title>Firma</title></path></g>");
    const { text, change } = ink(body, ["g"]);
    const path = element(text, "a");
    expect(path.attrs.transform).toBe("rotate(30)");
    expect(nodeCount(parsePath(path.attrs.d!)!)).toBe(2);
    expect(text).toContain("<title>Firma</title>");
    expect(change).toMatchObject({ changed: 1, keys: ["g"] });
  });

  it("un punto è una linea lunga zero coi capi tondi", () => {
    const { text } = ink(stroke("a", [[40, 40]]), ["a"]);
    expect(element(text, "a").attrs).toMatchObject({ d: "M40 40 L40 40", "stroke-linecap": "round" });
  });

  it("senza gli estremi del pennello il tratto finisce piatto, il punto resta tondo", () => {
    const flat = (body: string): string => body.replace(/fub:brush="[^"]*"/, `fub:brush="${formatBrush({ ...BRUSH, capStart: false, capEnd: false })}"`);
    const { text } = ink(flat(stroke("a", [[0, 0], [60, 0]])) + flat(stroke("b", [[40, 40]])), ["a", "b"]);
    expect(element(text, "a").attrs["stroke-linecap"]).toBeUndefined();
    expect(element(text, "b").attrs["stroke-linecap"]).toBe("round");
  });

  it("un pennello che non si legge non si tocca", () => {
    const { change } = ink(stroke("a", [[0, 0], [60, 0]]).replace(/fub:brush="[^"]*"/, 'fub:brush="pf9;x"'), ["a"]);
    expect(change).toMatchObject({ changed: 0, refused: 1, ops: [] });
  });
});
