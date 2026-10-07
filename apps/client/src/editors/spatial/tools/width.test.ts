// Lo spessore variabile sul documento: il contorno di una forma che diventa
// una linea a spessore variabile, i profili del menu del contorno, e la
// linea negli altri comandi. Ogni comando è un passo solo, e un annulla
// riporta tutto al byte.

import { describe, expect, it } from "vitest";
import { parsePath } from "../scene/geometry";
import { pathOf } from "../scene/model";
import { readVarWidth, spineOf, type WidthPoint } from "../scene/varwidth";
import { doc } from "../scene/test-support";
import { applyOps } from "./apply";
import { Plan, type Arranged } from "./arrange";
import { gesture, NewIds } from "./edit";
import { lookOps } from "./look";
import { estimate } from "./measure";
import { nodableOf, rewrite } from "./nodable";
import { outlineOps } from "./outline";
import { outlineStrokeOps, simplifyOps } from "./paths";
import { widthAttrs, type WidthShape } from "./profile";
import { LAYER, open, type Opened } from "./test-support";
import { pathOps } from "./topath";
import { holdsWidth, profileOps, widthsOf, widthTarget, writeWidth, type ProfileChange, type WidthTarget } from "./width";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Scrive `ops`, verifica che un annulla riporti il testo di prima, e torna
/// il testo di dopo.
function written(opened: Opened, ops: Arranged["ops"]): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(ops)!).outcome).toBe("applied");
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

/// Una linea a spessore variabile col profilo `profile` lungo `spine`.
function widthLine(id: string, profile: readonly WidthPoint[], spine = "M0 0 L100 0", extra = ' fill="#336699"', cap: "butt" | "round" = "butt"): string {
  const written = widthAttrs({ cap, join: "miter", profile, spine: parsePath(spine)! })!;
  return `<path id="${id}" fub:shape="width" fub:geom="${written.geom}" d="${written.d}"${extra}/>`;
}

const TAPER: WidthPoint[] = [[0, 4, 4], [1, 0, 0]];
const LINE = '<line id="a" x1="0" y1="0" x2="100" y2="0" stroke="#336699" stroke-width="8" stroke-linecap="round"/>';

/// Il profilo scritto dell'elemento `id` di `text`.
const profileIn = (text: string, id: string): readonly WidthPoint[] | undefined => readVarWidth(element(text, id).attrs["fub:geom"]!)?.profile;

/// La linea di `node` di `body`, nel livello.
function targetIn(body: string, id: string): { opened: Opened; target: ReturnType<typeof widthTarget> } {
  const opened = open(doc(`${LAYER}${body}</g>`));
  return { opened, target: widthTarget(opened.engine.holder(id)!) };
}

describe("la linea di una forma", () => {
  it("il contorno di una linea è uniforme, col suo spessore, i suoi estremi e i suoi angoli", () => {
    const { target } = targetIn(LINE, "a");
    expect(target).toMatchObject({ converts: true, shape: { cap: "round", join: "miter", profile: [[0, 4, 4], [1, 4, 4]], spine: parsePath("M0 0 L100 0") } });
  });

  it("il contorno di un rettangolo è la sua linea chiusa", () => {
    const { target } = targetIn('<rect id="r" x="0" y="0" width="20" height="10" fill="#ff0000" stroke="#000000" stroke-width="2" stroke-linejoin="round"/>', "r");
    expect(typeof target).toBe("object");
    const { shape } = target as WidthTarget;
    expect(shape.join).toBe("round");
    expect(shape.spine.filter((segment) => segment.kind === "close")).toHaveLength(1);
  });

  it("una linea a spessore variabile è sé stessa", () => {
    const { target } = targetIn(widthLine("w", TAPER), "w");
    expect(target).toMatchObject({ converts: false, shape: { cap: "butt", join: "miter", profile: TAPER, spine: parsePath("M0 0 L100 0") } });
  });

  it("dice perché una forma non ne ha una", () => {
    const body = [
      '<rect id="n" x="0" y="0" width="5" height="5" fill="#ff0000"/>',
      '<line id="d" x1="0" y1="0" x2="10" y2="0" stroke="#000000" stroke-dasharray="4 2"/>',
      '<path id="p" d="M0 0 L10 0 M20 0 L30 0" stroke="#000000"/>',
      '<text id="t" x="0" y="10"><tspan>Ciao</tspan></text>',
      '<path id="f" style="fill:none;stroke:#000000" d="M0 0 L10 0"/>',
    ].join("");
    const opened = open(doc(`${LAYER}${body}</g>`));
    const reason = (id: string): unknown => widthTarget(opened.engine.holder(id)!);
    expect([reason("n"), reason("d"), reason("p"), reason("t"), reason("f")]).toEqual(["unstroked", "dashed", "pieces", "kind", "foreign"]);
  });
});

describe("la linea scritta", () => {
  /// Scrive `profile` sulla linea di `id` in `body`: il testo di dopo, e il
  /// percorso della linea.
  function write(body: string, id: string, profile: readonly WidthPoint[]): { text: string; path: number[]; opened: Opened } {
    const opened = open(doc(`${LAYER}${body}</g>`));
    const target = widthTarget(opened.engine.holder(id)!) as WidthTarget;
    const plan = new Plan(opened.engine.model!, ids(opened));
    const shape: WidthShape = { ...target.shape, profile };
    const path = writeWidth(plan, target, shape)!;
    return { text: written(opened, plan.finish([]).ops), path, opened };
  }

  it("un contorno senza riempimento diventa la linea, al posto della forma e col suo id", () => {
    const { text, path, opened } = write(LINE, "a", TAPER);
    const line = element(text, "a");
    expect(line.tag).toBe("path");
    expect(line.attrs).toMatchObject({ "fub:shape": "width", fill: "#336699" });
    expect(Object.keys(line.attrs).filter((name) => name.startsWith("stroke"))).toEqual([]);
    expect(readVarWidth(line.attrs["fub:geom"]!)).toMatchObject({ cap: "round", profile: TAPER, spine: "M0 0 L100 0" });
    expect(pathOf(opened.engine.holder("a")!)).toEqual(path);
  });

  it("una forma piena diventa un gruppo: il riempimento sotto, la linea sopra, e il percorso è il suo", () => {
    const { text, path, opened } = write('<rect id="r" x="0" y="0" width="20" height="10" fill="#ff0000" stroke="#000000" stroke-width="2"/>', "r", [[0, 1, 1], [0.5, 3, 0], [1, 1, 1]]);
    expect(element(text, "r").tag).toBe("g");
    const [, fill, line] = order(text).slice(1);
    expect(element(text, fill!)).toEqual({ tag: "rect", attrs: { x: "0", y: "0", width: "20", height: "10", fill: "#ff0000" } });
    expect(element(text, line!).attrs).toMatchObject({ "fub:shape": "width", fill: "#000000" });
    expect(path).toEqual([0, 0, 1]);
    expect(pathOf(opened.engine.holder(line!)!)).toEqual(path);
  });

  it("una linea a spessore variabile cambia soltanto la geometria", () => {
    const { text } = write(widthLine("w", TAPER, "M0 0 L100 0", ' fill="#336699" opacity="0.5"'), "w", [[0, 0, 0], [1, 6, 2]]);
    const line = element(text, "w");
    expect(line.attrs).toMatchObject({ fill: "#336699", opacity: "0.5" });
    expect(profileIn(text, "w")).toEqual([[0, 0, 0], [1, 6, 2]]);
  });
});

describe("i profili", () => {
  /// Il profilo `change` sugli oggetti `keys` di `body`: il testo di dopo e
  /// il comando.
  function profiled(body: string, keys: readonly string[], change: ProfileChange) {
    const opened = open(doc(`${LAYER}${body}</g>`));
    const units = keys.map((key) => opened.index.get(key)!);
    const done = profileOps(opened.engine.model!, opened.index, units, change, ids(opened));
    return { text: done.ops.length === 0 ? opened.engine.text : written(opened, done.ops), done };
  }

  it("affusolato: il contorno diventa una linea larga quanto lui all'inizio e a punta alla fine", () => {
    const { text, done } = profiled(LINE, ["a"], { preset: "taper" });
    expect(profileIn(text, "a")).toEqual(TAPER);
    expect(done).toMatchObject({ changed: 1, skipped: 0, refused: 0, keys: ["a"] });
  });

  it("a goccia e a fuso, alla larghezza più grande; la goccia finisce tonda", () => {
    const line = widthLine("w", [[0, 1, 5], [1, 0, 0]]);
    const drop = profiled(line, ["w"], { preset: "drop" }).text;
    expect(profileIn(drop, "w")).toEqual([[0, 0, 0], [0.5, 2.25, 2.25], [1, 3, 3]]);
    expect(readVarWidth(element(drop, "w").attrs["fub:geom"]!)!.cap).toBe("round");
    expect(profileIn(profiled(line, ["w"], { preset: "spindle" }).text, "w")).toEqual([[0, 0, 0], [0.5, 3, 3], [1, 0, 0]]);
  });

  it("uniforme riporta il contorno, spesso quanto il punto più largo, con i suoi estremi", () => {
    const { text, done } = profiled(widthLine("w", [[0, 1, 5], [1, 0, 0]], "M0 0 L100 0", ' fill="#336699" fill-opacity="0.5"', "round"), ["w"], { preset: "uniform" });
    expect(element(text, "w")).toEqual({
      tag: "path",
      attrs: { d: "M0 0 L100 0", fill: "none", stroke: "#336699", "stroke-opacity": "0.5", "stroke-width": "6", "stroke-linecap": "round" },
    });
    expect(done.changed).toBe(1);
    // Un contorno che è già uniforme resta com'è.
    expect(profiled(LINE, ["a"], { preset: "uniform" }).done.ops).toEqual([]);
  });

  it("rovescia lungo la linea e scambia i lati; un contorno uniforme non cambia", () => {
    const line = widthLine("w", [[0, 4, 1], [0.25, 2, 2], [1, 0, 0]]);
    expect(profileIn(profiled(line, ["w"], { flip: "along" }).text, "w")).toEqual([[0, 0, 0], [0.75, 2, 2], [1, 4, 1]]);
    expect(profileIn(profiled(line, ["w"], { flip: "across" }).text, "w")).toEqual([[0, 1, 4], [0.25, 2, 2], [1, 0, 0]]);
    expect(profiled(LINE, ["a"], { flip: "along" }).done.ops).toEqual([]);
  });

  it("lo stesso profilo non è un cambio", () => {
    expect(profiled(widthLine("w", TAPER), ["w"], { preset: "taper" }).done).toMatchObject({ ops: [], changed: 0 });
  });

  it("entra nei gruppi, e conta ciò che resta com'è", () => {
    const body = `<g id="g">${LINE}<line id="d" x1="0" y1="10" x2="10" y2="10" stroke="#000000" stroke-dasharray="4 2"/></g><text id="t" x="0" y="10"><tspan>Ciao</tspan></text>`;
    const { text, done } = profiled(body, ["g", "t"], { preset: "spindle" });
    expect(profileIn(text, "a")).toEqual([[0, 0, 0], [0.5, 4, 4], [1, 0, 0]]);
    expect(done).toMatchObject({ changed: 1, skipped: 2, refused: 0, keys: ["g", "t"] });
    const opened = open(doc(`${LAYER}${body}</g>`));
    expect(holdsWidth(opened.index, [opened.index.get("g")!])).toBe(true);
    expect(holdsWidth(opened.index, [opened.index.get("t")!])).toBe(false);
    expect(widthsOf(opened.index, [opened.index.get("g")!, opened.index.get("t")!]).map((shape) => shape.profile)).toEqual([[[0, 4, 4], [1, 4, 4]]]);
  });
});

describe("la linea negli altri comandi", () => {
  const LINE_W = widthLine("w", [[0, 1, 3], [1, 0, 0]], "M0 0 L100 0", ' fill="#336699"');

  /// `command` sugli oggetti `keys` di `body`: il testo di dopo.
  function after(body: string, keys: readonly string[], command: (opened: Opened, units: ReturnType<Opened["index"]["get"]>[]) => Arranged): string {
    const opened = open(doc(`${LAYER}${body}</g>`));
    const done = command(opened, keys.map((key) => opened.index.get(key)));
    expect(done.ops.length).toBeGreaterThan(0);
    return written(opened, done.ops);
  }

  it("«Contorno in tracciato» e «Oggetto in tracciato» la lasciano un tracciato pieno qualunque", () => {
    const outlined = after(LINE_W, ["w"], (o, units) => outlineStrokeOps(o.engine.model!, o.index, units.map((unit) => unit!), ids(o)));
    const traced = after(LINE_W, ["w"], (o, units) => pathOps(o.engine.model!, units.map((unit) => unit!), ids(o)));
    for (const text of [outlined, traced]) {
      const { attrs } = element(text, "w");
      expect(attrs["fub:shape"]).toBeUndefined();
      expect(attrs["fub:geom"]).toBeUndefined();
      expect(attrs.d).toBe(element(doc(LINE_W), "w").attrs.d);
    }
  });

  it("«Applica trasformazione» scala la linea e le larghezze, e una riflessione scambia i lati", () => {
    const scaled = after(widthLine("w", [[0, 1, 3], [1, 0, 0]], "M0 0 L100 0", ' fill="#336699" transform="scale(2)"'), ["w"], (o, units) => applyOps(o.engine.model!, units.map((unit) => unit!), ids(o)));
    expect(element(scaled, "w").attrs.transform).toBeUndefined();
    expect(readVarWidth(element(scaled, "w").attrs["fub:geom"]!)).toMatchObject({ profile: [[0, 2, 6], [1, 0, 0]], spine: "M0 0 L200 0" });
    const mirrored = after(widthLine("w", [[0, 1, 3], [1, 0, 0]], "M0 0 L100 0", ' fill="#336699" transform="scale(1 -1)"'), ["w"], (o, units) => applyOps(o.engine.model!, units.map((unit) => unit!), ids(o)));
    expect(profileIn(mirrored, "w")).toEqual([[0, 3, 1], [1, 0, 0]]);
  });

  it("il menu del contorno ne cambia gli estremi e gli angoli, e non il tratteggio", () => {
    const capped = after(LINE_W, ["w"], (o, units) => outlineOps(o.engine.model!, units.map((unit) => unit!), { cap: "round" }, ids(o)));
    expect(readVarWidth(element(capped, "w").attrs["fub:geom"]!)).toMatchObject({ cap: "round", join: "miter" });
    const opened = open(doc(`${LAYER}${LINE_W}</g>`));
    expect(outlineOps(opened.engine.model!, [opened.index.get("w")!], { dash: "dashed" }, ids(opened)).ops).toEqual([]);
  });

  it("l'aspetto: il colore del contorno è il suo riempimento, e lo spessore allarga tutto il profilo", () => {
    const coloured = after(LINE_W, ["w"], (o, units) => lookOps(o.engine.model!, units.map((unit) => unit!), { stroke: "#ff0000" }, estimate, ids(o)));
    expect(element(coloured, "w").attrs.fill).toBe("#ff0000");
    const wider = after(LINE_W, ["w"], (o, units) => lookOps(o.engine.model!, units.map((unit) => unit!), { width: 8 }, estimate, ids(o)));
    expect(profileIn(wider, "w")).toEqual([[0, 2, 6], [1, 0, 0]]);
  });

  it("«Semplifica» semplifica la linea, e il profilo la segue", () => {
    const dense = `M0 0 ${Array.from({ length: 40 }, (_, k) => `L${(k + 1) * 2.5} ${Math.sin(((k + 1) * Math.PI) / 40) * 20}`).join(" ")}`;
    const text = after(widthLine("w", TAPER, dense), ["w"], (o, units) => simplifyOps(o.engine.model!, o.index, units.map((unit) => unit!), 0.5, ids(o)));
    const line = readVarWidth(element(text, "w").attrs["fub:geom"]!)!;
    expect(line.profile).toEqual(TAPER);
    expect(spineOf(line).length).toBeLessThan(10);
  });

  it("i nodi ne muovono la linea, e non la spezzano", () => {
    const opened = open(doc(`${LAYER}${LINE_W}</g>`));
    const nodable = nodableOf(opened.engine.holder("w")!);
    if (typeof nodable === "string" || nodable.kind !== "width") throw new Error("nessun nodo");
    expect(nodable.subs).toHaveLength(1);
    const moved = [{ ...nodable.subs[0]!, nodes: [[0, 0], [100, 50]] as [number, number][] }];
    const change = rewrite(nodable, moved, null);
    expect(change.kind).toBe("set");
    const attrs = (change as { attrs: Record<string, string> }).attrs;
    expect(readVarWidth(attrs["fub:geom"]!)).toMatchObject({ profile: [[0, 1, 3], [1, 0, 0]], spine: "M0 0 L100 50" });
    const split = [moved[0]!, { ...moved[0]! }];
    expect(rewrite(nodable, split, null)).toEqual({ kind: "refused", reason: "width" });
  });
});
