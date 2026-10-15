// I tratti a penna che diventano forme: lo stesso id, lo stesso posto fra i
// fratelli, il colore e lo spessore del tratto, e la forma com'è sullo
// schermo anche dentro un gruppo girato. Le operazioni il motore le accetta
// così come sono, e un annulla riporta l'inchiostro al byte.

import { describe, expect, it } from "vitest";
import { formatBrush, PF1_DEFAULTS } from "../ink/brush";
import { encodeInk, inkFromSamples } from "../ink/codec";
import { pf1 } from "../ink/pf1";
import { quantizeInk, type InkSample } from "../ink/sample";
import type { Bounds } from "../scene/geometry";
import { apply, rotate, type Point } from "../scene/matrix";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import { heldShapeOps, inkShapeOps, isPenStroke, strokeShape, type InkShaped } from "./inkshape";
import { LAYER, open, type Opened } from "./test-support";

const BRUSH = { ...PF1_DEFAULTS, size: 6 };

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// I punti di una mano senza tremito lungo gli spigoli `corners`, uno ogni
/// tre unità.
function trace(corners: readonly Point[]): Point[] {
  const out: Point[] = [corners[0]!];
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1]!;
    const [bx, by] = corners[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
    for (let k = 1; k <= steps; k++) out.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps]);
  }
  return out;
}

/// Un rettangolo da (100, 100) a (300, 220), chiuso con un poco di più.
const RECT = trace([[100, 100], [300, 100], [300, 220], [100, 220], [100, 100], [130, 100]]);

/// Un tratto dello strumento `tool` per i punti `points`, con gli attributi
/// `extra` e il contenuto `inner`.
function stroke(id: string, points: readonly Point[], extra = "", inner = "", tool = "pen"): string {
  const samples: InkSample[] = points.map(([x, y], i) => ({ x, y, t: i * 8 }));
  const d = pf1(quantizeInk(samples), BRUSH);
  const open = `<path id="${id}" fub:tool="${tool}" fub:brush="${formatBrush(BRUSH)}" d="${d}" fill="#cc3300"${extra} fub:ink="${encodeInk(inkFromSamples(samples, 100))}"`;
  return inner === "" ? `${open}/>` : `${open}>${inner}</path>`;
}

/// Scrive `change`, verifica che un annulla riporti il testo di prima, e
/// torna il testo di dopo.
function written(opened: Opened, change: InkShaped): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  return after;
}

/// Il nome dell'elemento di id `id` nel testo `text`, e gli attributi dopo l'id.
function element(text: string, id: string): { tag: string; attrs: Record<string, string> } {
  const found = new RegExp(`<([a-z]+) id="${id}"([^>]*?)/?>`).exec(text);
  if (found === null) throw new Error(`nessun elemento ${id}`);
  const attrs: Record<string, string> = {};
  for (const [, name, value] of found[2]!.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[name!] = value!;
  return { tag: found[1]!, attrs };
}

const near = (a: number, b: number, within = 0.5): void => expect(Math.abs(a - b), `${a} ≉ ${b}`).toBeLessThanOrEqual(within);

function nearBounds(a: Bounds | null, b: Bounds, within: number): void {
  expect(a).not.toBeNull();
  [...a!.min, ...a!.max].forEach((value, at) => near(value, [...b.min, ...b.max][at]!, within));
}

describe("«Rendi forma»", () => {
  it("fa di un tratto rettangolare un rettangolo col colore e lo spessore del tratto, allo stesso posto", () => {
    const opened = open(doc(`${LAYER}\n<rect id="a" x="0" y="0" width="5" height="5"/>\n${stroke("s", RECT)}\n<rect id="b" x="0" y="0" width="5" height="5"/>\n</g>`));
    const change = inkShapeOps(opened.engine.model!, opened.index, [opened.index.get("s")!], ids(opened));
    expect(change).toMatchObject({ changed: 1, refused: 0, keys: ["s"] });
    const text = written(opened, change);
    const { tag, attrs } = element(text, "s");
    expect(tag).toBe("rect");
    near(Number(attrs.x), 100);
    near(Number(attrs.y), 100);
    near(Number(attrs.width), 200);
    near(Number(attrs.height), 120);
    expect(attrs).toMatchObject({ fill: "none", stroke: "#cc3300", "stroke-width": "6" });
    expect(text).not.toContain("fub:ink");
    expect(text).not.toContain("fub:tool");
    // Fra i due rettangoli di prima, dove stava il tratto.
    expect(text.indexOf('id="a"')).toBeLessThan(text.indexOf('id="s"'));
    expect(text.indexOf('id="s"')).toBeLessThan(text.indexOf('id="b"'));
    nearBounds(change.extent, { min: [97, 97], max: [303, 223] }, 0.6);
  });

  it("tiene il titolo, la trasformazione e gli attributi che non sono inchiostro", () => {
    const opened = open(doc(`${LAYER}${stroke("s", RECT, ' opacity="0.5" transform="translate(10 20)"', "<title>Porta</title>")}</g>`));
    const text = written(opened, inkShapeOps(opened.engine.model!, opened.index, [opened.index.get("s")!], ids(opened)));
    expect(text).toMatch(/<rect id="s" [^>]*opacity="0.5"[^>]*>\s*<title>Porta<\/title>\s*<\/rect>/);
    expect(element(text, "s").attrs.transform).toBe("matrix(1 0 0 1 10 20)");
    nearBounds(opened.reindex().get("s")!.bounds, { min: [107, 117], max: [313, 243] }, 0.6);
  });

  it("riconosce il tratto com'è sullo schermo, anche dentro un gruppo girato", () => {
    // Un rettangolo dritto sullo schermo, disegnato in un gruppo girato di
    // 30°: nelle coordinate del gruppo è girato di -30°.
    const back = rotate(-30);
    const local = RECT.map((p) => apply(back, p));
    const opened = open(doc(`${LAYER}<g id="g" transform="rotate(30)">${stroke("s", local)}</g></g>`));
    const unit = opened.index.children(opened.index.get("g")!)[0]!;
    const shape = strokeShape(unit);
    expect(shape?.kind).toBe("rect");
    if (shape?.kind === "rect") near(shape.angle, -30, 0.5);
    const text = written(opened, inkShapeOps(opened.engine.model!, opened.index, [opened.index.get("g")!], ids(opened)));
    expect(element(text, "s").tag).toBe("rect");
    // Sullo schermo, il rettangolo è dritto dov'era il tratto.
    nearBounds(opened.reindex().get("s")!.bounds, { min: [97, 97], max: [303, 223] }, 1.5);
  });

  it("dentro un gruppo che deforma, riconosce il tratto nelle sue coordinate", () => {
    // Un cerchio nelle coordinate del gruppo, che sullo schermo diventa
    // un'ellisse larga il doppio.
    const circle = Array.from({ length: 140 }, (_, k): Point => [200 + 80 * Math.cos((k / 128) * 2 * Math.PI), 200 + 80 * Math.sin((k / 128) * 2 * Math.PI)]);
    const opened = open(doc(`${LAYER}<g id="g" transform="scale(2 1)">${stroke("s", circle)}</g></g>`));
    const unit = opened.index.children(opened.index.get("g")!)[0]!;
    // Sullo schermo è un'ellisse, che nel gruppo torna un cerchio.
    const shape = strokeShape(unit);
    expect(shape?.kind).toBe("ellipse");
    if (shape?.kind === "ellipse") {
      near(shape.rx, 80, 1);
      near(shape.ry, 80, 1);
    }
  });

  it("lascia l'evidenziatore, le forme e i testi, e conta i tratti a penna che non somigliano a una forma", () => {
    const zigzag = trace([[100, 100], [140, 160], [180, 100], [220, 160], [260, 100], [300, 160]]);
    const opened = open(
      doc(`${LAYER}${stroke("h", RECT, "", "", "highlighter")}<rect id="r" x="0" y="0" width="5" height="5"/>${stroke("z", zigzag)}<text id="t" x="0" y="0">Ciao</text></g>`),
    );
    const change = inkShapeOps(opened.engine.model!, opened.index, opened.index.units, ids(opened));
    expect(change).toMatchObject({ changed: 0, refused: 1, extent: null, ops: [] });
  });

  it("entra nei gruppi, tranne nelle parti bloccate, e la selezione resta il gruppo", () => {
    const below = RECT.map(([x, y]): Point => [x, y + 300]);
    const opened = open(doc(`${LAYER}<g id="g">${stroke("s", RECT)}${stroke("k", below, ' fub:locked="true"')}</g></g>`));
    const change = inkShapeOps(opened.engine.model!, opened.index, [opened.index.get("g")!], ids(opened));
    expect(change).toMatchObject({ changed: 1, refused: 0, keys: ["g"] });
    const text = written(opened, change);
    expect(element(text, "s").tag).toBe("rect");
    expect(element(text, "k").tag).toBe("path");
  });
});

describe("la forma tenuta", () => {
  it("prende il posto del tratto appena scritto con la forma regolata, nelle coordinate del livello", () => {
    const opened = open(doc(`${LAYER}${stroke("s", RECT)}</g>`));
    const unit = opened.index.get("s")!;
    expect(isPenStroke(unit.node)).toBe(true);
    const change = heldShapeOps(opened.engine.model!, unit, { kind: "ellipse", center: [200, 160], rx: 90, ry: 90, angle: 0 }, ids(opened));
    expect(change).not.toBeNull();
    // Come la scrive lo strumento Ellisse.
    const text = written(opened, change!);
    expect(element(text, "s")).toEqual({ tag: "ellipse", attrs: { cx: "200", cy: "160", rx: "90", ry: "90", fill: "none", stroke: "#cc3300", "stroke-width": "6" } });
    nearBounds(change!.extent, { min: [107, 67], max: [293, 253] }, 0.01);
  });

  it("non tocca l'evidenziatore, e non scrive una forma che non si disegna", () => {
    const opened = open(doc(`${LAYER}${stroke("h", RECT, "", "", "highlighter")}${stroke("s", RECT)}</g>`));
    expect(isPenStroke(opened.index.get("h")!.node)).toBe(false);
    expect(heldShapeOps(opened.engine.model!, opened.index.get("s")!, { kind: "polygon", points: [[0, 0], [10, 10], [20, 20]] }, ids(opened))).toBeNull();
  });
});
