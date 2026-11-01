// I comandi delle ripetizioni: che il motore accetta le operazioni così come
// sono, che ciò che si vede resta dov'era quando deve, che le copie seguono
// gli originali nuovi e che un annulla riporta il testo identico.

import { describe, expect, it } from "vitest";
import type { Bounds } from "../scene/geometry";
import type { ContainerNode } from "../scene/model";
import { doc } from "../scene/test-support";
import { duplicateOps, ungroupOps, type Arranged } from "./arrange";
import { gesture, NewIds, removeOps } from "./edit";
import type { SceneIndex, Unit } from "./hit";
import { expandCopiesIn, followRepeats, repeatOriginals, startRepeat } from "./repeat-ops";
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

const group = (opened: Opened, id: string): ContainerNode => opened.engine.holder(id) as ContainerNode;

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
/// Un disegno con una ripetizione radiale di quattro di un quadrato.
const RADIAL = doc(
  `${LAYER}<g id="or" fub:repeat="radial 4 5 25"><rect id="oa" x="0" y="0" width="10" height="10"/>`
    + '<use id="o1" transform="matrix(0 1 -1 0 30 20)" href="#oa"/><use id="o2" transform="matrix(-1 0 0 -1 10 50)" href="#oa"/><use id="o3" transform="matrix(0 -1 1 0 -20 30)" href="#oa"/>'
    + '</g><rect id="ob" x="100" y="0" width="10" height="10"/></g>',
);
describe("Espandi e Separa", () => {
  const SHADED = doc(
    '<defs id="fub-defs"><linearGradient id="rgggggggg" fub:role="private"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>'
      + `${LAYER}<g id="or" fub:repeat="mirror 20 0 20 10" transform="translate(5 0)" opacity="0.5"><use id="o1" transform="matrix(-1 0 0 1 40 0)" href="#oa"/>`
      + '<rect id="oa" x="0" y="0" width="10" height="10" transform="translate(2 0)" fill="url(#rgggggggg)"/><path d="M0 0" fub:bogus="x"/></g></g>',
  );

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

});
