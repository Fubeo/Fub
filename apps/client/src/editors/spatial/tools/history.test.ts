// Annulla e ripeti: una pila per gesto sopra il motore, che sopravvive a
// una modifica arrivata da fuori, perde solo il passo che non vale più e
// fonde i ritocchi di fila.

import { describe, expect, it } from "vitest";
import type { Applied, Outcome } from "../scene/engine";
import type { Op } from "../scene/ops";
import { doc } from "../scene/test-support";
import { History, HISTORY_LIMIT, MERGE_MS } from "./history";
import { LAYER, open } from "./test-support";

const SOURCE = doc(`${LAYER}<rect id="o1a2b3c4d" width="10" height="10"/></g>`);

const add = (id: string): Op => ({ op: "add", parent: "l1", pos: { last: true }, elem: { tag: "rect", attrs: { id, width: "5", height: "5" } } });

const move = (id: string, x: number): Op => ({ op: "set", id, attrs: { transform: `matrix(1 0 0 1 ${x} 0)` } });

const applied = (outcome: Outcome): Applied => {
  if (outcome.outcome !== "applied") throw new Error(`rifiutata: ${outcome.detail}`);
  return outcome;
};

/// Un orologio che avanza solo quando lo dice il test.
const clock = (): { now: () => number; tick: (ms: number) => void } => {
  let time = 0;
  return { now: () => time, tick: (ms) => (time += ms) };
};

describe("la cronologia", () => {
  it("annulla e ripete un gesto alla volta", () => {
    const { engine } = open(SOURCE);
    const history = new History();
    const start = engine.text;
    history.record("draw.action.stroke", applied(engine.apply(add("o5e6f7g8h"))));
    const one = engine.text;
    history.record("draw.action.stroke", applied(engine.apply(add("o9i0j1k2l"))));
    const two = engine.text;
    expect([history.canUndo, history.canRedo]).toEqual([true, false]);

    expect(history.undo(engine)?.outcome.outcome).toBe("applied");
    expect(engine.text).toBe(one);
    expect(history.undo(engine)?.step.label).toBe("draw.action.stroke");
    expect(engine.text).toBe(start);
    expect([history.canUndo, history.canRedo]).toEqual([false, true]);
    expect(history.undo(engine)).toBeNull();

    history.redo(engine);
    history.redo(engine);
    expect(engine.text).toBe(two);
    expect(history.redo(engine)).toBeNull();
  });

  it("dimentica i passi da ripetere quando arriva un gesto nuovo", () => {
    const { engine } = open(SOURCE);
    const history = new History();
    history.record("draw.action.stroke", applied(engine.apply(add("o5e6f7g8h"))));
    history.undo(engine);
    history.record("draw.action.delete", applied(engine.apply({ op: "remove", target: "o1a2b3c4d" })));
    expect(history.canRedo).toBe(false);
  });

  it("non ricorda un doppione, che non ha cambiato niente", () => {
    const { engine } = open(SOURCE);
    const history = new History();
    history.record("draw.action.stroke", applied(engine.apply(add("o5e6f7g8h"))));
    const again = applied(engine.apply(add("o5e6f7g8h")));
    expect(again.duplicate).toBe(true);
    history.record("draw.action.stroke", again);
    history.undo(engine);
    expect(history.canUndo).toBe(false);
  });

  it("tiene al più il limite, perdendo i passi più vecchi", () => {
    const { engine } = open(SOURCE);
    const history = new History(2);
    for (const id of ["o5e6f7g8h", "o9i0j1k2l", "o3m4n5p6q"]) history.record("draw.action.stroke", applied(engine.apply(add(id))));
    expect(history.undo(engine)).not.toBeNull();
    expect(history.undo(engine)).not.toBeNull();
    expect(history.undo(engine)).toBeNull();
    expect(engine.text).toContain('id="o5e6f7g8h"');
  });

  it("perde solo il passo che non si annulla più, e tiene gli altri", () => {
    const { engine } = open(SOURCE);
    const history = new History();
    history.record("draw.action.stroke", applied(engine.apply(add("o5e6f7g8h"))));
    history.record("draw.action.move", applied(engine.apply({ op: "set", id: "o1a2b3c4d", attrs: { transform: "matrix(1 0 0 1 5 5)" } })));
    // Da un'altra superficie qualcuno elimina il rettangolo spostato.
    applied(engine.apply({ op: "remove", target: "o1a2b3c4d" }));

    const failed = history.undo(engine);
    expect(failed?.step.label).toBe("draw.action.move");
    expect(failed?.outcome.outcome).toBe("rejected");
    expect(history.canRedo).toBe(false);

    expect(history.undo(engine)?.outcome.outcome).toBe("applied");
    expect(engine.text).not.toContain("o5e6f7g8h");
  });

  it("vale anche per il motore ricostruito dal testo", () => {
    const first = open(SOURCE);
    const history = new History();
    history.record("draw.action.stroke", applied(first.engine.apply(add("o5e6f7g8h"))));
    const second = open(first.engine.text);
    expect(history.undo(second.engine)?.outcome.outcome).toBe("applied");
    expect(second.engine.text).toBe(SOURCE);
  });
});

describe("la fusione dei passi", () => {
  it("fonde i ritocchi di fila in un passo che si annulla esatto", () => {
    const { engine } = open(SOURCE);
    const time = clock();
    const history = new History(HISTORY_LIMIT, time.now);
    for (const x of [1, 2, 3]) {
      history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", x))));
      time.tick(MERGE_MS);
    }
    const moved = engine.text;

    expect(history.undo(engine)?.outcome.outcome).toBe("applied");
    expect(engine.text).toBe(SOURCE);
    expect(history.canUndo).toBe(false);
    history.redo(engine);
    expect(engine.text).toBe(moved);
  });

  it("non fonde passi più lontani dell'intervallo", () => {
    const { engine } = open(SOURCE);
    const time = clock();
    const history = new History(HISTORY_LIMIT, time.now);
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 1))));
    const one = engine.text;
    time.tick(MERGE_MS + 1);
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 2))));

    history.undo(engine);
    expect(engine.text).toBe(one);
  });

  it("non fonde gesti diversi, né chiavi o oggetti diversi", () => {
    const { engine } = open(doc(`${LAYER}<rect id="o1a2b3c4d" width="10" height="10"/><rect id="o5e6f7g8h" width="5" height="5"/></g>`));
    const time = clock();
    const history = new History(HISTORY_LIMIT, time.now);
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 1))));
    history.record("draw.action.title", applied(engine.apply(move("o1a2b3c4d", 2))));
    history.record("draw.action.title", applied(engine.apply({ op: "set", id: "o1a2b3c4d", attrs: { fill: "#ff0000" } })));
    history.record("draw.action.title", applied(engine.apply({ op: "set", id: "o5e6f7g8h", attrs: { fill: "#ff0000" } })));

    let steps = 0;
    while (history.undo(engine) !== null) steps++;
    expect(steps).toBe(4);
  });

  it("dopo un ripeti, il ritocco dopo apre un passo nuovo", () => {
    const { engine } = open(SOURCE);
    const history = new History(HISTORY_LIMIT, clock().now);
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 1))));
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 2))));
    history.undo(engine);
    expect(engine.text).toBe(SOURCE);
    history.redo(engine);
    const two = engine.text;
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 3))));

    history.undo(engine);
    expect(engine.text).toBe(two);
  });

  it("dopo un annulla, il ritocco dopo apre un passo nuovo anche se la scena è tornata quella di prima", () => {
    const { engine } = open(doc(`${LAYER}<rect id="o1a2b3c4d" width="10" height="10"/><rect id="o5e6f7g8h" width="5" height="5"/></g>`));
    const history = new History(HISTORY_LIMIT, clock().now);
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 1))));
    const one = engine.text;
    history.record("draw.action.move", applied(engine.apply(move("o5e6f7g8h", 1))));
    history.undo(engine);
    expect(engine.text).toBe(one);
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 2))));

    history.undo(engine);
    expect(engine.text).toBe(one);
  });

  it("non fonde un passo con una modifica arrivata da fuori in mezzo", () => {
    const { engine } = open(SOURCE);
    const time = clock();
    const history = new History(HISTORY_LIMIT, time.now);
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 1))));
    // Da un'altra superficie qualcuno colora il rettangolo.
    applied(engine.apply({ op: "set", id: "o1a2b3c4d", attrs: { fill: "#00ff00" } }));
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 2))));

    history.undo(engine);
    expect(engine.text).toContain('fill="#00ff00"');
    expect(engine.text).toContain("matrix(1 0 0 1 1 0)");
    history.undo(engine);
    expect(engine.text).not.toContain("transform");
    expect(engine.text).toContain('fill="#00ff00"');
  });
});
