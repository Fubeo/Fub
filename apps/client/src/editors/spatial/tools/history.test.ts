// Annulla e ripeti: una pila per gesto sopra il motore, che sopravvive a
// una modifica arrivata da fuori e perde solo il passo che non vale più.

import { describe, expect, it } from "vitest";
import type { Applied, Outcome } from "../scene/engine";
import type { Op } from "../scene/ops";
import { doc } from "../scene/test-support";
import { History } from "./history";
import { LAYER, open } from "./test-support";

const SOURCE = doc(`${LAYER}<rect id="o1a2b3c4d" width="10" height="10"/></g>`);

const add = (id: string): Op => ({ op: "add", parent: "l1", pos: { last: true }, elem: { tag: "rect", attrs: { id, width: "5", height: "5" } } });

const applied = (outcome: Outcome): Applied => {
  if (outcome.outcome !== "applied") throw new Error(`rifiutata: ${outcome.detail}`);
  return outcome;
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
