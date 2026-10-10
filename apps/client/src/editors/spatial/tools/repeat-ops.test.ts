// I comandi delle ripetizioni: che il motore accetta le operazioni così come
// sono, che ciò che si vede resta dov'era quando deve, che le copie seguono
// gli originali nuovi e che un annulla riporta il testo identico.

import { describe, expect, it } from "vitest";
import type { Bounds } from "../scene/geometry";
import { apply as applyMatrix, IDENTITY, type Matrix } from "../scene/matrix";
import type { ContainerNode } from "../scene/model";
import { readRepeat, repeatMatrices, type Repeat } from "../scene/repeat";
import { doc } from "../scene/test-support";
import { applyOps } from "./apply";
import { duplicateOps, ungroupOps, type Arranged } from "./arrange";
import { gesture, NewIds, removeOps } from "./edit";
import type { SceneIndex, Unit } from "./hit";
import { editedRepeat, expandCopiesIn, expandOps, followRepeats, isRepeat, repeatOps, repeatOriginals, repeatView, rewriteOps, startRepeat, type RepeatMade, type RepeatPlace } from "./repeat-ops";
import { LAYER, open, type Opened } from "./test-support";
import { attrOf } from "./tip-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Applica `arranged` e verifica che un annulla riporti il testo di prima e
/// che rifarlo dia lo stesso testo.
function applied(opened: Opened, arranged: Arranged): SceneIndex {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(arranged.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(arranged.ops)!).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  return opened.reindex();
}

const units = (opened: Opened, ...wanted: string[]): Unit[] => opened.index.units.filter((unit) => wanted.includes(unit.key));

/// Gli originali di una ripetizione come li dà l'indice del gruppo isolato.
const originalsOf = (opened: Opened) => (container: ContainerNode): readonly Unit[] => opened.reindex(container).units;

const made = (result: RepeatMade | string): RepeatMade => {
  if (typeof result === "string") throw new Error(`rifiutato: ${result}`);
  return result;
};

const group = (opened: Opened, id: string): ContainerNode => opened.engine.holder(id) as ContainerNode;

/// Il riquadro di `box` portato da `m`.
function carried(box: Bounds, m: Matrix): Bounds {
  const corners = [box.min, [box.max[0], box.min[1]], box.max, [box.min[0], box.max[1]]].map((p) => applyMatrix(m, p as [number, number]));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

/// Il riquadro di un originale in `box` con tutte le copie di `repeat`.
function repeatedBox(box: Bounds, repeat: Repeat): Bounds {
  return [IDENTITY, ...repeatMatrices(repeat)].map((m) => carried(box, m)).reduce((a, b) => ({ min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])], max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])] }));
}

function nearBox(actual: Bounds | null | undefined, expected: Bounds): void {
  expect(actual).not.toBeNull();
  for (const [a, b] of [[actual!.min, expected.min], [actual!.max, expected.max]] as const) {
    expect(a[0]).toBeCloseTo(b[0], 6);
    expect(a[1]).toBeCloseTo(b[1], 6);
  }
}

const SHAPES = doc(`${LAYER}<rect id="oa" x="0" y="0" width="10" height="10"/><circle id="ob" cx="30" cy="5" r="5"/><rect id="oc" x="60" y="0" width="10" height="10"/></g>`);

const SQUARE: Bounds = { min: [0, 0], max: [10, 10] };

describe("i valori di partenza", () => {
  it("radiale: otto volte, col centro sotto l'originale e le copie che non si toccano", () => {
    expect(startRepeat("radial", SQUARE)).toEqual({ kind: "radial", count: 8, center: [5, 20] });
    // Un originale alto e stretto tiene il centro fuori da sé.
    expect(startRepeat("radial", { min: [0, 0], max: [4, 50] })).toEqual({ kind: "radial", count: 8, center: [2, 75] });
  });

  it("griglia: tre per tre, coi passi di un quarto più larghi, e un lato zero prende l'altro", () => {
    expect(startRepeat("grid", { min: [0, 0], max: [10, 20] })).toEqual({ kind: "grid", columns: 3, rows: 3, step: [13, 25] });
    expect(startRepeat("grid", { min: [0, 0], max: [0, 8] })).toEqual({ kind: "grid", columns: 3, rows: 3, step: [10, 10] });
  });

  it("specchio: l'asse verticale sul bordo destro", () => {
    expect(startRepeat("mirror", { min: [1, 2], max: [11.004, 7] })).toEqual({ kind: "mirror", axis: [[11, 2], [11, 7]] });
    // Senza altezza l'asse ha comunque due punti.
    expect(startRepeat("mirror", { min: [0, 3], max: [5, 3] })).toEqual({ kind: "mirror", axis: [[5, 3], [5, 4]] });
  });
});

describe("Ripeti", () => {
  it("mette l'oggetto in una ripetizione al suo posto, con le copie dopo di lui, e il disegno si vede ripetuto", () => {
    const opened = open(SHAPES);
    const result = made(repeatOps(opened.engine.model!, units(opened, "oa"), "radial", ids(opened), originalsOf(opened)));
    expect(result.repeat).toEqual({ kind: "radial", count: 8, center: [5, 20] });
    const index = applied(opened, result);
    const key = result.keys[0]!;
    expect(index.units.map((unit) => unit.key)).toEqual([key, "ob", "oc"]);
    const unit = index.get(key)!;
    expect(isRepeat(unit)).toBe(true);
    nearBox(unit.bounds, repeatedBox(SQUARE, result.repeat));
    const text = opened.engine.text;
    expect(text).toMatch(new RegExp(`<g id="${key}" fub:repeat="radial 8 5 20">\\s*<rect id="oa"`));
    expect(text).toContain('transform="matrix(0 1 -1 0 25 15)" href="#oa"/>');
    const [original] = repeatOriginals(group(opened, key));
    expect(original!.node.facts.id).toBe("oa");
    expect(original!.copies).toHaveLength(7);
  });

  it("più oggetti diventano un gruppo, che è l'originale", () => {
    const opened = open(SHAPES);
    const result = made(repeatOps(opened.engine.model!, units(opened, "oa", "ob"), "grid", ids(opened), originalsOf(opened)));
    expect(result.repeat).toEqual({ kind: "grid", columns: 3, rows: 3, step: [44, 13] });
    const index = applied(opened, result);
    const repeat = group(opened, result.keys[0]!);
    const [original] = repeatOriginals(repeat);
    expect(original!.node.kind).toBe("container");
    expect(original!.copies).toHaveLength(8);
    expect(index.children(index.get(result.keys[0]!)!).map((unit) => unit.key)).toEqual([original!.node.facts.id]);
    nearBox(index.get(result.keys[0]!)!.bounds, repeatedBox({ min: [0, 0], max: [35, 10] }, result.repeat));
  });

  it("lo specchio riflette sul bordo destro", () => {
    const opened = open(SHAPES);
    const result = made(repeatOps(opened.engine.model!, units(opened, "oc"), "mirror", ids(opened), originalsOf(opened)));
    const index = applied(opened, result);
    expect(opened.engine.text).toContain('<use id="');
    expect(opened.engine.text).toContain('transform="matrix(-1 0 0 1 140 0)" href="#oc"/>');
    nearBox(index.get(result.keys[0]!)!.bounds, { min: [60, 0], max: [80, 10] });
  });

  it("su una ripetizione, o sui suoi originali, cambia il tipo", () => {
    const opened = open(SHAPES);
    const first = made(repeatOps(opened.engine.model!, units(opened, "oa"), "radial", ids(opened), originalsOf(opened)));
    let index = applied(opened, first);
    const key = first.keys[0]!;
    const grid = made(repeatOps(opened.engine.model!, [index.get(key)!], "grid", ids(opened), originalsOf(opened)));
    expect(grid.keys).toEqual([key]);
    index = applied(opened, grid);
    expect(attrOf(opened, key, "fub:repeat")).toBe("grid 3 3 13 13");
    expect(repeatOriginals(group(opened, key))[0]!.copies).toHaveLength(8);
    // Dal gruppo isolato, con l'originale scelto: la selezione resta lui.
    const inside = opened.reindex(group(opened, key));
    const mirror = made(repeatOps(opened.engine.model!, inside.units, "mirror", ids(opened), originalsOf(opened)));
    expect(mirror.keys).toEqual(["oa"]);
    applied(opened, mirror);
    expect(attrOf(opened, key, "fub:repeat")).toBe("mirror 10 0 10 10");
    expect(repeatOriginals(group(opened, key))[0]!.copies).toHaveLength(1);
  });

  it("un originale insieme ad altro non esce dalla sua ripetizione", () => {
    const opened = open(SHAPES);
    const first = made(repeatOps(opened.engine.model!, units(opened, "oa"), "radial", ids(opened), originalsOf(opened)));
    const index = applied(opened, first);
    const inside = opened.reindex(group(opened, first.keys[0]!));
    expect(repeatOps(opened.engine.model!, [...inside.units, index.get("ob")!], "grid", ids(opened), originalsOf(opened))).toBe("inside");
  });
});

/// Un disegno con una ripetizione radiale di quattro di un quadrato.
const RADIAL = doc(
  `${LAYER}<g id="or" fub:repeat="radial 4 5 25"><rect id="oa" x="0" y="0" width="10" height="10"/>`
    + '<use id="o1" transform="matrix(0 1 -1 0 30 20)" href="#oa"/><use id="o2" transform="matrix(-1 0 0 -1 10 50)" href="#oa"/><use id="o3" transform="matrix(0 -1 1 0 -20 30)" href="#oa"/>'
    + '</g><rect id="ob" x="100" y="0" width="10" height="10"/></g>',
);

describe("cambiare una ripetizione", () => {
  it("più volte aggiunge le copie dopo le altre, meno volte toglie quelle in fondo", () => {
    const opened = open(RADIAL);
    const repeat = group(opened, "or");
    const more = rewriteOps(opened.engine.model!, repeat, { kind: "radial", count: 6, center: [5, 25] }, ids(opened));
    applied(opened, more);
    const [grown] = repeatOriginals(group(opened, "or"));
    expect(grown!.copies.map((copy) => copy.facts.id).slice(0, 3)).toEqual(["o1", "o2", "o3"]);
    expect(grown!.copies).toHaveLength(5);
    const fewer = rewriteOps(opened.engine.model!, group(opened, "or"), { kind: "radial", count: 2, center: [5, 25] }, ids(opened));
    applied(opened, fewer);
    const [shrunk] = repeatOriginals(group(opened, "or"));
    expect(shrunk!.copies.map((copy) => copy.facts.id)).toEqual(["o1"]);
    expect(attrOf(opened, "o1", "transform")).toBe("matrix(-1 0 0 -1 10 50)");
  });

  it("le copie che restano uguali non si riscrivono, e lo spostamento va agli originali", () => {
    const opened = open(RADIAL);
    const same = rewriteOps(opened.engine.model!, group(opened, "or"), { kind: "radial", count: 4, center: [5, 25] }, ids(opened));
    expect(same.ops).toEqual([]);
    const moved = rewriteOps(opened.engine.model!, group(opened, "or"), { kind: "radial", count: 4, center: [5, 25] }, ids(opened), [0, -5]);
    expect(moved.ops).toEqual([{ op: "set", id: "oa", attrs: { transform: "matrix(1 0 0 1 0 -5)" } }]);
  });

  it("il pannello legge e cambia i valori nella scena", () => {
    const repeat = readRepeat("radial 4 5 25")!;
    // La ripetizione è spostata e ingrandita due volte nella scena.
    const place: RepeatPlace = { matrix: [2, 0, 0, 2, 100, 0], box: SQUARE };
    expect(repeatView(repeat, place)).toEqual({ kind: "radial", count: 4, center: [110, 50], radius: 40 });
    expect(editedRepeat(repeat, place, { field: "count", value: 12 })).toEqual({ repeat: { kind: "radial", count: 12, center: [5, 25] }, move: null });
    expect(editedRepeat(repeat, place, { field: "count", value: 1 })).toBeNull();
    expect(editedRepeat(repeat, place, { field: "count", value: 4 })).toBeNull();
    expect(editedRepeat(repeat, place, { field: "center-x", value: 120 })).toEqual({ repeat: { kind: "radial", count: 4, center: [10, 25] }, move: null });
    // Il raggio da 40 a 60 nella scena sposta l'originale di 10 in su nelle
    // coordinate della ripetizione.
    expect(editedRepeat(repeat, place, { field: "radius", value: 60 })).toEqual({ repeat, move: [0, -10] });
    expect(editedRepeat(repeat, place, { field: "radius", value: -1 })).toBeNull();
  });

  it("griglia e specchio nel pannello", () => {
    const grid = readRepeat("grid 3 2 13 20")!;
    const place: RepeatPlace = { matrix: [2, 0, 0, 1, 0, 0], box: SQUARE };
    expect(repeatView(grid, place)).toEqual({ kind: "grid", columns: 3, rows: 2, step: [26, 20] });
    expect(editedRepeat(grid, place, { field: "step-x", value: 30 })?.repeat).toEqual({ kind: "grid", columns: 3, rows: 2, step: [15, 20] });
    expect(editedRepeat(grid, place, { field: "columns", value: 600 })).toBeNull();
    expect(editedRepeat(grid, place, { field: "rows", value: 1 })?.repeat).toEqual({ kind: "grid", columns: 3, rows: 1, step: [13, 20] });
    const mirror = readRepeat("mirror 10 0 10 10")!;
    const flat: RepeatPlace = { matrix: IDENTITY, box: SQUARE };
    const view = repeatView(mirror, flat);
    expect(view.kind).toBe("mirror");
    if (view.kind !== "mirror") return;
    expect(view.angle).toBeCloseTo(90, 9);
    expect(view.distance).toBeCloseTo(5, 9);
    // Orizzontale, sopra il centro di 10.
    const turned = editedRepeat(mirror, flat, { field: "angle", value: 0 })!.repeat;
    expect(turned.kind).toBe("mirror");
    const again = repeatView(turned, flat);
    if (again.kind !== "mirror") throw new Error("non è uno specchio");
    expect(again.angle).toBeCloseTo(0, 9);
    expect(again.distance).toBeCloseTo(5, 9);
    const far = repeatView(editedRepeat(mirror, flat, { field: "distance", value: 20 })!.repeat, flat);
    if (far.kind !== "mirror") throw new Error("non è uno specchio");
    expect(far.distance).toBeCloseTo(20, 9);
    expect(far.angle).toBeCloseTo(90, 9);
  });
});

describe("Espandi e Separa", () => {
  const SHADED = doc(
    '<defs id="fub-defs"><linearGradient id="rgggggggg" fub:role="private"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>'
      + `${LAYER}<g id="or" fub:repeat="mirror 20 0 20 10" transform="translate(5 0)" opacity="0.5"><use id="o1" transform="matrix(-1 0 0 1 40 0)" href="#oa"/>`
      + '<rect id="oa" x="0" y="0" width="10" height="10" transform="translate(2 0)" fill="url(#rgggggggg)"/><path d="M0 0" fub:bogus="x"/></g></g>',
  );

  it("Espandi mette un duplicato al posto di ogni copia e resta un gruppo qualunque, che si vede uguale", () => {
    const opened = open(RADIAL);
    const before = opened.index.get("or")!.bounds!;
    const expanded = expandOps(opened.engine.model!, units(opened, "or"), ids(opened));
    if (typeof expanded === "string") throw new Error(expanded);
    expect(expanded.keys).toEqual(["or"]);
    const index = applied(opened, expanded);
    expect(attrOf(opened, "or", "fub:repeat")).toBeNull();
    expect(opened.engine.text).not.toContain("<use");
    expect(index.children(index.get("or")!)).toHaveLength(4);
    nearBox(index.get("or")!.bounds, before);
  });

  it("i duplicati hanno la trasformazione della copia sopra quella dell'originale, e le risorse private copiate", () => {
    const opened = open(SHADED);
    const expanded = expandOps(opened.engine.model!, units(opened, "or"), ids(opened));
    if (typeof expanded === "string") throw new Error(expanded);
    applied(opened, expanded);
    const text = opened.engine.text;
    expect(text).toContain('transform="matrix(-1 0 0 1 38 0)"');
    expect(text.match(/<linearGradient/g)).toHaveLength(2);
    // Il duplicato sta dove stava la copia, prima dell'originale.
    expect(text.indexOf('matrix(-1 0 0 1 38 0)')).toBeLessThan(text.indexOf('id="oa"'));
  });

  it("niente da espandere fuori dalle ripetizioni", () => {
    const opened = open(SHAPES);
    expect(expandOps(opened.engine.model!, units(opened, "oa"), ids(opened))).toBe("none");
  });

  it("Separa porta fuori originali e duplicati, con la trasformazione, lo stile e l'opacità della ripetizione", () => {
    const opened = open(SHADED);
    const before = opened.index.get("or")!.bounds!;
    const separated = ungroupOps(opened.engine.model!, units(opened, "or"), ids(opened), expandCopiesIn);
    const index = applied(opened, separated);
    expect(opened.engine.holder("or")).toBeNull();
    expect(opened.engine.text).not.toContain("<use");
    expect(attrOf(opened, "oa", "transform")).toBe("matrix(1 0 0 1 7 0)");
    expect(attrOf(opened, "oa", "opacity")).toBe("0.5");
    const shown = index.units.flatMap((unit) => (unit.bounds === null ? [] : [unit.bounds]));
    nearBox(shown.reduce((a, b) => ({ min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])], max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])] })), before);
    // L'ordine resta quello del disegno: il duplicato della copia, poi
    // l'originale.
    expect(index.units.map((unit) => unit.key).indexOf("oa")).toBe(1);
  });

  it("una copia prima del suo originale e una parte estranea senza id escono al loro posto", () => {
    const opened = open(doc(
      `${LAYER}<g id="or" fub:repeat="grid 2 1 20 0"><use id="o1" transform="matrix(1 0 0 1 20 0)" href="#oa"/><use href="#oa" x="3"/>`
        + '<rect id="oa" x="0" y="0" width="10" height="10"/></g></g>',
    ));
    applied(opened, ungroupOps(opened.engine.model!, units(opened, "or"), ids(opened), expandCopiesIn));
    expect(opened.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="0" y="0" width="10" height="10" transform="matrix\(1 0 0 1 20 0\)"\/>\s*<use href="#oa" x="3"\/>\s*<rect id="oa"/);
  });

  it("senza chi espande, una ripetizione non si separa", () => {
    const opened = open(RADIAL);
    expect(ungroupOps(opened.engine.model!, units(opened, "or"), ids(opened)).ops).toEqual([]);
  });
});

describe("eliminare", () => {
  it("l'ultimo originale porta via la ripetizione", () => {
    const opened = open(RADIAL);
    const inside = opened.reindex(group(opened, "or"));
    const ops = removeOps(inside.units);
    expect(ops).toEqual([{ op: "remove", target: "or" }]);
    applied(opened, { ops, keys: [] });
  });

  it("un originale fra altri porta via prima le sue copie, anche quelle prima di lui", () => {
    const opened = open(doc(
      `${LAYER}<g id="or" fub:repeat="grid 2 1 20 0"><use id="o1" transform="matrix(1 0 0 1 20 0)" href="#oa"/><rect id="oa" x="0" y="0" width="10" height="10"/>`
        + '<circle id="ob" cx="5" cy="25" r="5"/><use id="o2" transform="matrix(1 0 0 1 20 0)" href="#ob"/></g></g>',
    ));
    const inside = opened.reindex(group(opened, "or"));
    const ops = removeOps(inside.units.filter((unit) => unit.key === "oa"));
    expect(ops).toEqual([{ op: "remove", target: "o1" }, { op: "remove", target: "oa" }]);
    applied(opened, { ops, keys: [] });
    expect(repeatOriginals(group(opened, "or")).map((original) => original.node.facts.id)).toEqual(["ob"]);
  });

  it("gli oggetti qualunque si tolgono come prima", () => {
    const opened = open(SHAPES);
    expect(removeOps(units(opened, "oa", "oc"))).toEqual([{ op: "remove", target: "oc" }, { op: "remove", target: "oa" }]);
  });
});

describe("le copie seguono gli originali nuovi", () => {
  const following = (opened: Opened): void => {
    opened.engine.follow = (model, touched) => followRepeats(model, touched, (id) => opened.engine.holder(id), ids(opened));
  };

  it("un oggetto che entra in una ripetizione riceve le sue copie nello stesso passo", () => {
    const opened = open(RADIAL);
    following(opened);
    const before = opened.engine.text;
    const outcome = opened.engine.apply({ op: "add", parent: "or", pos: { after: "o3" }, elem: { tag: "circle", attrs: { id: "occcccccc", cx: "5", cy: "-10", r: "2" } } });
    expect(outcome.outcome).toBe("applied");
    const originals = repeatOriginals(group(opened, "or"));
    expect(originals.map((original) => [original.node.facts.id, original.copies.length])).toEqual([["oa", 3], ["occcccccc", 3]]);
    if (outcome.outcome !== "applied") return;
    expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
    expect(opened.engine.text).toBe(before);
  });

  it("un originale spostato dentro arriva con le copie, e una ripetizione bloccata resta com'è", () => {
    const opened = open(RADIAL);
    following(opened);
    expect(opened.engine.apply({ op: "move", target: "ob", parent: "or", pos: { last: true } }).outcome).toBe("applied");
    expect(repeatOriginals(group(opened, "or")).map((original) => original.copies.length)).toEqual([3, 3]);
    const locked = open(RADIAL.replace('fub:repeat="radial 4 5 25"', 'fub:repeat="radial 4 5 25" fub:locked="true"'));
    expect(followRepeats(locked.engine.model!, new Set(["oa"]), (id) => locked.engine.holder(id), ids(locked))).toBeNull();
  });

  it("niente da fare quando ogni originale ha le sue copie", () => {
    const opened = open(RADIAL);
    expect(followRepeats(opened.engine.model!, new Set(["oa", "or", "ob"]), (id) => opened.engine.holder(id), ids(opened))).toBeNull();
  });
});

describe("gli altri comandi", () => {
  it("il duplicato di una ripetizione è una ripetizione, con le copie rivolte al suo originale", () => {
    const opened = open(RADIAL);
    const copied = duplicateOps(opened.engine.model!, units(opened, "or"), 10, 10, ids(opened));
    const index = applied(opened, copied!);
    const twin = group(opened, copied!.keys[0]!);
    const [original] = repeatOriginals(twin);
    expect(original!.node.facts.id).not.toBe("oa");
    expect(original!.copies).toHaveLength(3);
    expect(index.get(twin.facts.id!)!.bounds).toEqual({ min: [index.get("or")!.bounds!.min[0] + 10, index.get("or")!.bounds!.min[1] + 10], max: [index.get("or")!.bounds!.max[0] + 10, index.get("or")!.bounds!.max[1] + 10] });
  });

  it("«Applica trasformazione» lascia alla ripetizione la sua, e le copie vedono la geometria nuova dell'originale", () => {
    const opened = open(RADIAL.replace('<g id="or"', '<g id="or" transform="translate(10 0)"').replace('<rect id="oa"', '<rect id="oa" transform="translate(0 5)"'));
    const before = opened.index.get("or")!.bounds!;
    const baked = applyOps(opened.engine.model!, units(opened, "or"), ids(opened));
    const index = applied(opened, baked);
    expect(attrOf(opened, "or", "transform")).toBe("translate(10 0)");
    expect(attrOf(opened, "oa", "transform")).toBeNull();
    expect(attrOf(opened, "oa", "y")).toBe("5");
    nearBox(index.get("or")!.bounds, before);
  });
});
