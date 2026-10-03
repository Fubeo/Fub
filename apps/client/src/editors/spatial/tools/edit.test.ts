// Le operazioni degli strumenti: dove scrivono, che cosa scrivono, e che il
// motore le accetta così come sono.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { boxMatrix, destination, gesture, mappedBounds, moveOps, NewIds, pageFor, removeOps, roundDelta, transformOps, transformValue } from "./edit";
import { LAYER, open } from "./test-support";

const ids = (taken: readonly string[] = []): NewIds => new NewIds((id) => taken.includes(id));

describe("dove scrive un oggetto nuovo", () => {
  it("nel livello visibile e sbloccato più in alto", () => {
    const { index } = open(doc(`${LAYER}</g><g id="l2" fub:layer="Due"></g><g id="l3" fub:layer="Tre" fub:locked="true"></g><g id="l4" fub:layer="Quattro" display="none"></g>`));
    const to = destination(index, ids());
    expect(to?.parent).toBe("l2");
    expect(to?.prelude).toEqual([]);
  });

  it("alla radice, in un documento senza livelli", () => {
    const { index } = open(doc('<rect id="o1a2b3c4d" width="5" height="5"/>'));
    expect(destination(index, ids())?.parent).toBe("#root");
  });

  it("in un livello senza id, che lo riceve nello stesso gesto", () => {
    const opened = open(doc('<g fub:layer="Senza id"></g>'));
    const to = destination(opened.index, ids())!;
    expect(to.parent).toMatch(/^l[a-z0-9]{8}$/);
    expect(to.prelude).toEqual([{ op: "ident", path: [0], tag: "g", id: to.parent }]);
    const elem = { tag: "rect", attrs: { id: "o1a2b3c4d", width: "5", height: "5" } };
    const op = gesture([...to.prelude, { op: "add", parent: to.parent, pos: { last: true }, elem }]);
    expect(opened.engine.apply(op!).outcome).toBe("applied");
  });

  it("da nessuna parte, se ogni livello è bloccato o nascosto", () => {
    const { index } = open(doc('<g id="l1" fub:layer="Uno" fub:locked="true"></g><g id="l2" fub:layer="Due" display="none"></g>'));
    expect(destination(index, ids())).toBeNull();
  });

  it("non in un livello schiacciato su una retta, dove nessun punto torna indietro", () => {
    const { index } = open(doc('<g id="l1" fub:layer="Uno"></g><g id="l2" fub:layer="Piatto" transform="scale(1 0)"></g>'));
    expect(destination(index, ids())?.parent).toBe("l1");
  });

  it("con le coordinate del livello, anche trasformato", () => {
    const { index } = open(doc('<g id="l1" fub:layer="Uno" transform="translate(10 20) scale(2)"></g>'));
    const to = destination(index, ids())!;
    expect(to.matrix).toEqual([2, 0, 0, 2, 10, 20]);
    // `+ 0` fa di uno zero negativo uno zero: per la matrice sono lo stesso.
    expect(to.inverse.map((v) => v + 0)).toEqual([0.5, 0, 0, 0.5, -5, -10]);
  });
});

describe("gli id nuovi di un gesto", () => {
  it("non ripetono quelli del documento né quelli già dati", () => {
    const fresh = ids();
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(fresh.next("object"));
    expect(seen.size).toBe(50);
    for (const id of seen) expect(id).toMatch(/^o[a-z0-9]{8}$/);
  });
});

describe("spostare", () => {
  const SOURCE = doc(
    `${LAYER}<rect id="o1a2b3c4d" x="0" y="0" width="10" height="10"/><rect x="20" y="0" width="10" height="10"/>`
      + '<rect id="o5e6f7g8h" x="0" y="20" width="10" height="10" transform="rotate(90)"/></g>'
      + '<g id="l2" fub:layer="Doppio" transform="scale(2)"><rect id="o9i0j1k2l" x="0" y="0" width="5" height="5"/></g>',
  );

  it("cambia solo `transform`, con un `matrix()` solo", () => {
    const opened = open(SOURCE);
    const moved = moveOps([opened.index.get("o1a2b3c4d")!], 5, -2.5, ids());
    expect(moved.ops).toEqual([{ op: "set", id: "o1a2b3c4d", attrs: { transform: "matrix(1 0 0 1 5 -2.5)" } }]);
    expect(moved.keys).toEqual(["o1a2b3c4d"]);
    expect(opened.engine.apply(gesture(moved.ops)!).outcome).toBe("applied");
    expect(opened.reindex().get("o1a2b3c4d")?.bounds).toEqual({ min: [5, -2.5], max: [15, 7.5] });
  });

  it("compone la traslazione con la trasformazione di prima", () => {
    const opened = open(SOURCE);
    const unit = opened.index.get("o5e6f7g8h")!;
    const before = unit.bounds!;
    const moved = moveOps([unit], 3, 4, ids());
    expect(opened.engine.apply(gesture(moved.ops)!).outcome).toBe("applied");
    const after = opened.reindex().get("o5e6f7g8h")!.bounds!;
    expect(after.min[0] - before.min[0]).toBeCloseTo(3, 9);
    expect(after.min[1] - before.min[1]).toBeCloseTo(4, 9);
  });

  it("porta lo spostamento della scena nelle coordinate del livello", () => {
    const opened = open(SOURCE);
    const moved = moveOps([opened.index.get("o9i0j1k2l")!], 10, 10, ids());
    expect(moved.ops).toEqual([{ op: "set", id: "o9i0j1k2l", attrs: { transform: "matrix(1 0 0 1 5 5)" } }]);
  });

  it("dà un id a un oggetto che non ce l'ha, e la selezione lo segue", () => {
    const opened = open(SOURCE);
    const unit = opened.index.get("@0.1")!;
    const moved = moveOps([unit], 1, 1, ids());
    const id = moved.keys[0]!;
    expect(id).toMatch(/^o[a-z0-9]{8}$/);
    expect(moved.ops[0]).toEqual({ op: "ident", path: [0, 1], tag: "rect", id });
    expect(opened.engine.apply(gesture(moved.ops)!).outcome).toBe("applied");
    expect(opened.reindex().get(id)?.bounds).toEqual({ min: [21, 1], max: [31, 11] });
  });

  it("toglie `transform` quando l'oggetto torna dov'era", () => {
    const opened = open(SOURCE);
    expect(opened.engine.apply(gesture(moveOps([opened.index.get("o1a2b3c4d")!], 5, 5, ids()).ops)!).outcome).toBe("applied");
    const back = moveOps([opened.reindex().get("o1a2b3c4d")!], -5, -5, ids());
    expect(back.ops).toEqual([{ op: "set", id: "o1a2b3c4d", attrs: { transform: null } }]);
    expect(opened.engine.apply(gesture(back.ops)!).outcome).toBe("applied");
    expect(opened.engine.text).not.toContain("transform=\"matrix");
  });

  it("arrotonda lo spostamento a due decimali, come la geometria", () => {
    expect(roundDelta(1.006)).toBe(1.01);
    expect(roundDelta(-1.006)).toBe(-1.01);
    expect(roundDelta(-0.004) + 0).toBe(0);
    expect(transformValue([1, 0, 0, 1, 0, 0])).toBeNull();
    expect(transformValue([1, 0, 0, 1, 0.00001, 0])).toBeNull();
  });
});

describe("ridimensionare e collocare", () => {
  const SOURCE = doc(
    `${LAYER}<rect id="o1a2b3c4d" x="0" y="0" width="10" height="10"/><rect id="o2b3c4d5e" x="20" y="10" width="10" height="10"/></g>`
      + '<g id="l2" fub:layer="Doppio" transform="translate(5 5) scale(2)"><rect id="o9i0j1k2l" x="0" y="0" width="5" height="5" transform="rotate(90)"/></g>',
  );

  it("porta un riquadro in un altro con una scala e una traslazione", () => {
    const m = boxMatrix({ min: [0, 0], max: [10, 20] }, { min: [5, 5], max: [25, 15] });
    expect(m).toEqual([2, 0, 0, 0.5, 5, 5]);
    expect(mappedBounds({ min: [0, 0], max: [10, 20] }, m)).toEqual({ min: [5, 5], max: [25, 15] });
    // Un lato che misura zero si sposta e basta.
    expect(boxMatrix({ min: [0, 3], max: [10, 3] }, { min: [0, 4], max: [20, 9] })).toEqual([2, 0, 0, 1, 0, 1]);
  });

  it("mette la selezione nel riquadro chiesto, anche dentro un livello trasformato", () => {
    const opened = open(SOURCE);
    for (const key of ["o1a2b3c4d", "o9i0j1k2l"]) {
      const unit = opened.reindex().get(key)!;
      const target = { min: [100, 50], max: [140, 60] } as const;
      const moved = transformOps([unit], boxMatrix(unit.bounds!, target), ids());
      expect(moved.keys).toEqual([key]);
      expect(opened.engine.apply(gesture(moved.ops)!).outcome).toBe("applied");
      const after = opened.reindex().get(key)!.bounds!;
      expect(after.min[0]).toBeCloseTo(100, 3);
      expect(after.min[1]).toBeCloseTo(50, 3);
      expect(after.max[0]).toBeCloseTo(140, 3);
      expect(after.max[1]).toBeCloseTo(60, 3);
    }
  });

  it("scala più oggetti insieme, attorno all'angolo del loro riquadro", () => {
    const opened = open(SOURCE);
    const units = [opened.index.get("o1a2b3c4d")!, opened.index.get("o2b3c4d5e")!];
    const moved = transformOps(units, boxMatrix({ min: [0, 0], max: [30, 20] }, { min: [0, 0], max: [60, 20] }), ids());
    expect(moved.ops).toEqual([
      { op: "set", id: "o1a2b3c4d", attrs: { transform: "matrix(2 0 0 1 0 0)" } },
      { op: "set", id: "o2b3c4d5e", attrs: { transform: "matrix(2 0 0 1 0 0)" } },
    ]);
    expect(opened.engine.apply(gesture(moved.ops)!).outcome).toBe("applied");
    expect(opened.reindex().get("o2b3c4d5e")!.bounds).toEqual({ min: [40, 10], max: [60, 20] });
  });
});

describe("eliminare", () => {
  it("toglie gli oggetti dall'ultimo al primo, così ogni percorso vale fino al suo turno", () => {
    const opened = open(doc(`${LAYER}<rect width="1" height="1"/><rect width="2" height="2"/><rect id="o1a2b3c4d" width="3" height="3"/></g>`));
    const units = [opened.index.get("@0.0")!, opened.index.get("o1a2b3c4d")!, opened.index.get("@0.1")!];
    const ops = removeOps(units);
    expect(ops).toEqual([
      { op: "remove", target: "o1a2b3c4d" },
      { op: "remove", target: { path: [0, 1], tag: "rect" } },
      { op: "remove", target: { path: [0, 0], tag: "rect" } },
    ]);
    expect(opened.engine.apply(gesture(ops)!).outcome).toBe("applied");
    expect(opened.reindex().units).toEqual([]);
  });
});

describe("la pagina", () => {
  const PAGE = { x: 0, y: 0, width: 100, height: 100 };

  it("resta com'è se l'oggetto ci sta", () => {
    expect(pageFor(PAGE, { min: [0, 0], max: [100, 100] })).toBeNull();
    expect(pageFor(null, { min: [-50, 0], max: [10, 10] })).toBeNull();
    expect(pageFor(PAGE, null)).toBeNull();
  });

  it("si allarga di 256 unità per lato, quante volte serve, solo dove l'oggetto esce", () => {
    expect(pageFor(PAGE, { min: [-1, 10], max: [20, 20] })).toBe("-256 0 356 100");
    expect(pageFor(PAGE, { min: [10, 10], max: [101, 400] })).toBe("0 0 356 612");
  });

  it("arrotonda i bordi verso l'esterno, senza perdere un centesimo", () => {
    expect(pageFor({ x: 0.333, y: 0, width: 100, height: 100 }, { min: [0, 0], max: [10, 10] })).toBe("-255.67 0 356.01 100");
    expect(pageFor({ x: 0.1, y: 0.2, width: 100, height: 100 }, { min: [0, 0], max: [10, 10] })).toBe("-255.9 -255.8 356 356");
  });

  it("e il motore la accetta nello stesso gesto", () => {
    const opened = open(doc(`${LAYER}<rect id="o1a2b3c4d" x="90" y="0" width="10" height="10"/></g>`));
    const unit = opened.index.get("o1a2b3c4d")!;
    const moved = moveOps([unit], 20, 0, ids());
    const viewBox = pageFor(PAGE, { min: [110, 0], max: [120, 10] })!;
    expect(opened.engine.apply(gesture([...moved.ops, { op: "page", viewBox }])!).outcome).toBe("applied");
    expect(opened.engine.text).toContain('viewBox="0 0 356 100"');
  });
});

describe("un gesto", () => {
  it("è un'operazione sola, o un `batch` di tutte, o niente", () => {
    const remove = { op: "remove", target: "o1a2b3c4d" } as const;
    expect(gesture([])).toBeNull();
    expect(gesture([remove])).toBe(remove);
    expect(gesture([remove, remove])).toEqual({ op: "batch", ops: [remove, remove] });
  });
});
