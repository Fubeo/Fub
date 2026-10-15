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
import { flatten, parsePath, winding, type Segment } from "../scene/geometry";
import { IDENTITY, type Point } from "../scene/matrix";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import { nodeCount } from "./simplify";
import { dashesOf, inkPathOps, offsetOps, outlineStrokeOps, simplifyOps, type PathsDone } from "./paths";
import { LAYER, open, type Opened } from "./test-support";
import { CUSTOM, DEFS, MARKER as TIP_MARKER } from "./tip-support";
import { followTips, TIP_ENDS, TIP_SHAPES, TIP_SIZES, type TipEnd, type TipShape, type TipSize } from "./tips";

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

/// Il motore di `source` con le punte che seguono la linea, come lo
/// installa l'editor.
function following(source: string): Opened {
  const opened = open(source);
  opened.engine.follow = (model, touched) => followTips(model, touched, ids(opened), (id) => opened.engine.holder(id));
  return opened;
}

/// Il comando `run` sugli oggetti `keys` di `body`, nel livello: il testo di
/// dopo e il comando. Con `defs` le risorse del disegno, e con `follow` il
/// seguito delle punte nel motore.
function run<T extends PathsDone>(
  body: string,
  keys: readonly string[],
  command: (opened: Opened, units: ReturnType<Opened["index"]["get"]>[]) => T,
  defs = "",
  follow = false,
): { text: string; change: T } {
  const source = doc(`${defs}${LAYER}${body}</g>`);
  const opened = follow ? following(source) : open(source);
  const change = command(opened, keys.map((key) => opened.index.get(key)));
  return { text: change.ops.length === 0 ? opened.engine.text : written(opened, change), change };
}

const outline = (body: string, keys: readonly string[], defs = "", follow = false) =>
  run(body, keys, (opened, units) => outlineStrokeOps(opened.engine.model!, opened.index, units.map((unit) => unit!), ids(opened)), defs, follow);

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

// ---------------------------------------------------------------------------
// Le punte nel contorno.
// ---------------------------------------------------------------------------

/// Un marcatore della raccolta nero, come le linee di prova.
const MARKER = (id: string, shape: TipShape, size: TipSize, end: TipEnd): string => TIP_MARKER(id, shape, size, end, "#000000");

/// Un triangolo medio di fine (`mtri`) e un cerchio medio d'inizio (`mcir`),
/// neri come le linee di prova.
const TIPS = DEFS(MARKER("mtri", "triangle", "medium", "end"), MARKER("mcir", "circle", "medium", "start"));
/// Il solo triangolo, perché un marcatore che nessuno usa non se ne va.
const TRI = DEFS(MARKER("mtri", "triangle", "medium", "end"));

/// Una linea orizzontale da (0, 10) a (50, 10), nera e spessa 2, con gli
/// attributi `extra`.
const LINE = (id: string, extra = ""): string => `<line id="${id}" x1="0" y1="10" x2="50" y2="10" stroke="#000000" stroke-width="2"${extra}/>`;
const TRI_END = ' marker-end="url(#mtri)"';
const CIRCLE_START = ' marker-start="url(#mcir)"';

/// Se il tracciato `d` copre il punto `p`, con la regola non zero.
const covers = (d: string, p: Point): boolean => winding(flatten(parsePath(d)!, IDENTITY), p) !== 0;

/// Quanti marcatori restano nel testo.
const markersLeft = (text: string): number => (text.match(/<marker /g) ?? []).length;

describe("contorno in tracciato con le punte", () => {
  it("le punte entrano nel contorno, dove le disegna lo schermo: un triangolo in fondo, un cerchio all'inizio", () => {
    const { text, change } = outline(LINE("a", CIRCLE_START + TRI_END), ["a"], TIPS, true);
    expect(change).toMatchObject({ changed: 1, skipped: 0, refused: 0, keys: ["a"] });
    const path = element(text, "a");
    expect(path.tag).toBe("path");
    expect(path.attrs).toMatchObject({ fill: "#000000" });
    expect(path.attrs.stroke).toBeUndefined();
    // Nessuna punta resta: né sul tracciato né fra le risorse.
    expect(text).not.toContain("marker");
    const d = path.attrs.d!;
    // Il corpo della linea.
    expect(covers(d, [25, 10])).toBe(true);
    expect(covers(d, [25, 10.9])).toBe(true);
    expect(covers(d, [25, 11.1])).toBe(false);
    // Il triangolo: la punta a 50 + 1,4 × 2, la base a 50 - 2,93 × 2 e alta 10.
    expect(covers(d, [52.5, 10])).toBe(true);
    expect(covers(d, [53.1, 10])).toBe(false);
    expect(covers(d, [44.5, 6])).toBe(true);
    expect(covers(d, [44.5, 14])).toBe(true);
    expect(covers(d, [44.5, 4.5])).toBe(false);
    expect(covers(d, [44.5, 15.5])).toBe(false);
    expect(covers(d, [48, 14])).toBe(false);
    // Il cerchio: centrato nell'inizio, di raggio 2 × 2.
    expect(covers(d, [-3.8, 10])).toBe(true);
    expect(covers(d, [0, 13.5])).toBe(true);
    expect(covers(d, [0, 6.5])).toBe(true);
    expect(covers(d, [-4.3, 10])).toBe(false);
    expect(covers(d, [0, 14.5])).toBe(false);
    expect(covers(d, [-3, 13])).toBe(false);
    // L'area è quella delle tre forme meno ciò che si sovrappone: il corpo
    // 100, il triangolo fuori dal corpo 31,6 e il cerchio fuori dal corpo
    // 42,4.
    expect(area(d)).toBeCloseTo(174, 0);
  });

  it("la punta cresce con lo spessore del contorno", () => {
    const { text } = outline(LINE("a", TRI_END).replace('stroke-width="2"', 'stroke-width="4"'), ["a"], TIPS, true);
    const d = element(text, "a").attrs.d!;
    // La punta a 50 + 1,4 × 4, la base a 50 - 2,93 × 4, alta 20.
    expect(covers(d, [55.3, 10])).toBe(true);
    expect(covers(d, [55.9, 10])).toBe(false);
    expect(covers(d, [38.6, 1])).toBe(true);
    expect(covers(d, [38, 5])).toBe(false);
    expect(covers(d, [45, 19])).toBe(false);
  });

  it("il verso della punta è quello del tracciato dove finisce, anche su una curva", () => {
    const { text } = outline('<path id="a" d="M0 0 C20 0 30 10 30 30" fill="none" stroke="#000000" stroke-width="2" marker-end="url(#mtri)"/>', ["a"], TIPS, true);
    const d = element(text, "a").attrs.d!;
    // Il tracciato arriva da sopra: la punta guarda in basso.
    expect(covers(d, [30, 32.5])).toBe(true);
    expect(covers(d, [30, 33.1])).toBe(false);
    expect(covers(d, [33, 26])).toBe(true);
    expect(covers(d, [36, 26])).toBe(false);
    expect(covers(d, [32.5, 30])).toBe(false);
  });

  it("la punta di una linea in una forma ruotata e ingrandita resta nelle coordinate della forma", () => {
    const plain = outline(LINE("a", TRI_END), ["a"], TIPS, true).text;
    const { text } = outline(LINE("a", `${TRI_END} transform="scale(2)"`), ["a"], TIPS, true);
    expect(element(text, "a").attrs.d).toBe(element(plain, "a").attrs.d);
    expect(element(text, "a").attrs.transform).toBe("scale(2)");
  });

  it("una forma piena aperta diventa il gruppo di sempre, con le punte nel contorno sopra il riempimento", () => {
    const { text, change } = outline(
      '<path id="a" d="M0 0 L50 0 L50 40" fill="#ff0000" stroke="#000000" stroke-width="2" marker-end="url(#mtri)"/>',
      ["a"],
      TRI,
      true,
    );
    expect(change).toMatchObject({ changed: 1, refused: 0 });
    expect(element(text, "a")).toEqual({ tag: "g", attrs: {} });
    const [fillId, outlineId] = order(text).slice(order(text).indexOf("a") + 1);
    const fill = element(text, fillId!);
    expect(fill.tag).toBe("path");
    expect(fill.attrs).toMatchObject({ d: "M0 0 L50 0 L50 40", fill: "#ff0000" });
    const ring = element(text, outlineId!);
    expect(ring.attrs.fill).toBe("#000000");
    // La punta guarda in basso, a 40 + 1,4 × 2.
    expect(covers(ring.attrs.d!, [50, 42.5])).toBe(true);
    expect(covers(ring.attrs.d!, [50, 43.1])).toBe(false);
    expect(text).not.toContain("marker");
  });

  // Più di un milione di clic: su una macchina carica supera i 5 secondi.
  it("ogni forma di punta, di ogni misura e a ogni capo, copre ciò che il clic trova sulla linea", { timeout: 60_000 }, () => {
    // Una linea orizzontale e una obliqua, con spessori diversi.
    const lines = [
      { geometry: 'x1="10" y1="30" x2="60" y2="30"', width: 2, ends: { start: [10, 30], end: [60, 30] } },
      { geometry: 'x1="20" y1="60" x2="55" y2="20"', width: 3, ends: { start: [20, 60], end: [55, 20] } },
    ] as const;
    for (const line of lines) {
      for (const shape of TIP_SHAPES) {
        for (const size of TIP_SIZES) {
          for (const end of TIP_ENDS) {
            const label = `${shape} ${size} ${end} su ${line.geometry}`;
            const body = `<line id="a" ${line.geometry} stroke="#000000" stroke-width="${line.width}" marker-${end}="url(#m)"/>`;
            const defs = DEFS(MARKER("m", shape, size, end));
            const before = open(doc(`${defs}${LAYER}${body}</g>`));
            const unit = before.seen()[0]!;
            const hit = (p: Point): boolean => unit.sampleAt(p, 0) !== null;
            const d = element(outline(body, ["a"], defs, true).text, "a").attrs.d!;
            const [cx, cy] = line.ends[end];
            const half = line.width / 2 + 0.3;
            const mismatched: string[] = [];
            for (let x = cx - 14.03; x <= cx + 14; x += 0.5) {
              for (let y = cy - 14.02; y <= cy + 14; y += 0.5) {
                // Il capo della linea, tondo per il clic e piatto nella
                // forma, non si confronta.
                if (Math.hypot(x - cx, y - cy) <= half) continue;
                const here = hit([x, y]);
                // Un punto vicino a un bordo cade da una parte o dall'altra
                // per il modo di appiattire le curve: si confronta soltanto
                // dove il clic non cambia di poco.
                const steady = ([[0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]] as const).every(([dx, dy]) => hit([x + dx, y + dy]) === here);
                if (!steady) continue;
                const inside = covers(d, [x, y]);
                // Il clic tratta i capi di una stanghetta come tondi, il
                // disegno li taglia piatti: per lei si chiede soltanto che
                // il contorno non copra ciò che il clic non trova.
                if (shape === "bar" ? inside && !here : inside !== here) mismatched.push(`(${x}, ${y})`);
              }
            }
            expect(mismatched, label).toEqual([]);
          }
        }
      }
    }
  });

  it("una linea lunga zero con una punta diventa la sola punta, e senza la punta resta com'è", () => {
    const zero = '<line id="a" x1="20" y1="20" x2="20" y2="20" stroke="#000000" stroke-width="2"';
    const { text, change } = outline(`${zero} marker-end="url(#mtri)"/>`, ["a"], TRI, true);
    expect(change).toMatchObject({ changed: 1, skipped: 0, refused: 0 });
    // Senza verso la punta guarda lungo l'asse x.
    const d = element(text, "a").attrs.d!;
    expect(covers(d, [22.5, 20])).toBe(true);
    expect(covers(d, [23.2, 20])).toBe(false);
    expect(text).not.toContain("marker");
    expect(outline(`${zero}/>`, ["a"], TRI, true).change).toMatchObject({ changed: 0, skipped: 1, refused: 0, ops: [] });
  });

  it("un tratteggio con una punta: i trattini, e la punta intera", () => {
    const { text, change } = outline(LINE("a", ` stroke-dasharray="10 5"${TRI_END}`), ["a"], TRI, true);
    expect(change.changed).toBe(1);
    const d = element(text, "a").attrs.d!;
    expect(covers(d, [5, 10])).toBe(true);
    expect(covers(d, [12.5, 10])).toBe(false);
    expect(covers(d, [17, 10])).toBe(true);
    expect(covers(d, [52.5, 10])).toBe(true);
    expect(covers(d, [53.1, 10])).toBe(false);
  });

  it("una punta che non è della raccolta o un marcatore a metà lasciano la forma com'è, e si contano", () => {
    const defs = DEFS(MARKER("mtri", "triangle", "medium", "end"), CUSTOM("mx"));
    for (const marker of [' marker-end="url(#mx)"', ' marker-start="url(#mx)"', ' marker-mid="url(#mtri)"', `${TRI_END} marker-start="url(#mx)"`]) {
      const { text, change } = outline(LINE("a", marker), ["a"], defs, true);
      expect(change, marker).toMatchObject({ changed: 0, skipped: 0, refused: 1, ops: [] });
      expect(element(text, "a").tag, marker).toBe("line");
      expect(text, marker).toContain(marker.trim().split(" ")[0]!);
    }
  });

  it("fra molte forme, quella che si rifiuta non ferma le altre", () => {
    const defs = DEFS(MARKER("mtri", "triangle", "medium", "end"), CUSTOM("mx"));
    const body = LINE("a", TRI_END) + LINE("b", ' marker-end="url(#mx)"').replace('y1="10"', 'y1="30"').replace('y2="10"', 'y2="30"') + LINE("c").replace('y1="10"', 'y1="50"').replace('y2="10"', 'y2="50"');
    const { text, change } = outline(body, ["a", "b", "c"], defs, true);
    expect(change).toMatchObject({ changed: 2, skipped: 0, refused: 1 });
    expect(element(text, "a").tag).toBe("path");
    expect(element(text, "b").tag).toBe("line");
    expect(element(text, "c").tag).toBe("path");
    // La punta di un'altra forma resta dov'è; quella della forma rifiutata pure.
    expect(text).toContain('<marker id="mx"');
    expect(text).not.toContain('<marker id="mtri"');
  });

  it("un marcatore usato anche da un'altra linea resta, e torna tutto con un annulla", () => {
    const body = LINE("a", TRI_END) + LINE("b", TRI_END).replace('y1="10"', 'y1="30"').replace('y2="10"', 'y2="30"');
    const { text } = outline(body, ["a"], TRI, true);
    expect(element(text, "a").tag).toBe("path");
    expect(markersLeft(text)).toBe(1);
    expect(text).toContain('<line id="b"');
    expect(text).toContain('marker-end="url(#mtri)"');
    // `run` ha già verificato che un annulla riporti il testo di prima.
    expect(outline(body, ["a", "b"], TRI, true).text).not.toContain("marker");
  });

  it("senza il seguito delle punte nel motore le cose vanno allo stesso modo", () => {
    const { text } = outline(LINE("a", CIRCLE_START + TRI_END), ["a"], TIPS);
    expect(text).not.toContain("marker");
    expect(element(text, "a").tag).toBe("path");
  });
});

const offset = (body: string, keys: readonly string[], distance: number, join: "miter" | "round" | "bevel" = "miter", defs = "", follow = false) =>
  run(body, keys, (opened, units) => offsetOps(opened.engine.model!, opened.index, units.map((unit) => unit!), distance, { join, miterLimit: 4 }, ids(opened)), defs, follow);

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

describe("scostamento di una forma con le punte", () => {
  /// Gli attributi di marcatore che `attrs` porta.
  const markers = (attrs: Record<string, string>): string[] => Object.keys(attrs).filter((name) => name.startsWith("marker"));

  it("il tracciato nuovo non ha le punte, e la linea tiene le sue", () => {
    const { text, change } = offset(LINE("a", CIRCLE_START + TRI_END), ["a"], 5, "miter", TIPS, true);
    expect(change).toMatchObject({ changed: 1, vanished: 0 });
    const added = element(text, change.keys[0]!);
    expect(added.tag).toBe("path");
    expect(markers(added.attrs)).toEqual([]);
    expect(boundsOf(added.attrs.d!)).toEqual([-5, 5, 55, 15]);
    // La linea resta con le sue punte, che restano le stesse: nessun
    // marcatore in più, e nessuno in meno.
    expect(markers(element(text, "a").attrs)).toEqual(["marker-start", "marker-end"]);
    expect(text.match(/marker-end=/g)).toHaveLength(1);
    expect(markersLeft(text)).toBe(2);
  });

  it("una forma piena aperta, e le forme dentro un gruppo, si scostano senza le punte", () => {
    const filled = '<path id="a" d="M0 0 L50 0 L50 40" fill="#ff0000" stroke="#000000" stroke-width="2" marker-end="url(#mtri)"/>';
    for (const body of [filled, `<g id="g">${filled}</g>`]) {
      const { text, change } = offset(body, [body === filled ? "a" : "g"], 3, "round", TRI, true);
      expect(change.changed, body).toBe(1);
      const added = element(text, change.keys[0]!);
      expect(added.attrs).toMatchObject({ fill: "#ff0000", stroke: "#000000" });
      expect(markers(added.attrs), body).toEqual([]);
      expect(markers(element(text, "a").attrs), body).toEqual(["marker-end"]);
      expect(markersLeft(text), body).toBe(1);
    }
  });

  it("senza il seguito delle punte nel motore è lo stesso", () => {
    const { text, change } = offset(LINE("a", TRI_END), ["a"], 2, "miter", TRI);
    expect(markers(element(text, change.keys[0]!).attrs)).toEqual([]);
    expect(markersLeft(text)).toBe(1);
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

describe("semplifica le linee con le punte", () => {
  it("una spezzata fitta diventa un tracciato con le stesse punte, ai suoi capi", () => {
    const points = Array.from({ length: 41 }, (_, i) => `${i * 2},${(10 * Math.sin(i / 4)).toFixed(2)}`).join(" ");
    const body = `<polyline id="a" points="${points}" fill="none" stroke="#000000" stroke-width="2" marker-start="url(#mcir)" marker-end="url(#mtri)"/>`;
    const { text, change } = run(body, ["a"], (opened, units) => simplifyOps(opened.engine.model!, opened.index, units.map((unit) => unit!), 0.5, ids(opened)), TIPS, true);
    expect(change.changed).toBe(1);
    const path = element(text, "a");
    expect(path.tag).toBe("path");
    expect(path.attrs).toMatchObject({ "marker-start": "url(#mcir)", "marker-end": "url(#mtri)" });
    expect(markersLeft(text)).toBe(2);
  });
});
