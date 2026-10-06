// Annulla e ripeti: una pila per gesto sopra il motore, che sopravvive a
// una modifica arrivata da fuori, perde solo il passo che non vale più e
// fonde i ritocchi di fila; i salti a un punto qualsiasi, e i segni sui
// punti.

import { describe, expect, it } from "vitest";
import { applyOperation } from "../../core/text-operation";
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

describe("i salti nella cronologia", () => {
  /// Una cronologia di `count` tratti, ciascuno un passo.
  const strokes = (count: number, limit = HISTORY_LIMIT) => {
    const opened = open(SOURCE);
    const history = new History(limit, clock().now);
    const texts = [opened.engine.text];
    for (let at = 0; at < count; at++) {
      history.record("draw.action.stroke", applied(opened.engine.apply(add(`o${at.toString(36).padStart(8, "0")}`))));
      texts.push(opened.engine.text);
    }
    return { ...opened, history, texts };
  };

  it("torna a un passo e ci ritorna con gli stessi byte, in un cambiamento solo", () => {
    const { engine, history, texts } = strokes(6);
    const [, second, , , , last] = history.steps().map((step) => step.serial);
    const back = history.goTo(engine, second!)!;
    expect(back.direction).toBe("undo");
    expect(back.steps.map((step) => step.serial)).toEqual([6, 5, 4, 3]);
    expect(engine.text).toBe(texts[2]);
    expect(applyOperation(texts[6]!, back.replayed.operation)).toBe(texts[2]);
    expect([history.position, history.done, history.canRedo]).toEqual([2, 2, true]);

    const forward = history.goTo(engine, last!)!;
    expect(forward.direction).toBe("redo");
    expect(forward.steps.map((step) => step.serial)).toEqual([3, 4, 5, 6]);
    expect(engine.text).toBe(texts[6]);
    expect(history.goTo(engine, last!)).toBeNull();

    // All'inizio, e di nuovo a metà: ogni punto ha i suoi byte.
    history.goTo(engine, history.start);
    expect(engine.text).toBe(SOURCE);
    history.goTo(engine, 4);
    expect(engine.text).toBe(texts[4]);
    history.undo(engine);
    expect(engine.text).toBe(texts[3]);
  });

  it(`attraversa ${HISTORY_LIMIT} passi avanti e indietro`, () => {
    const { engine, history, texts } = strokes(HISTORY_LIMIT);
    history.goTo(engine, history.start);
    expect(engine.text).toBe(SOURCE);
    expect(history.done).toBe(0);
    history.goTo(engine, HISTORY_LIMIT);
    expect(engine.text).toBe(texts[HISTORY_LIMIT]);
    expect(history.canRedo).toBe(false);
  });

  it("si ferma al passo che non si annulla, e lo toglie", () => {
    const { engine, history, texts } = strokes(4);
    // Da un'altra superficie qualcuno elimina il terzo tratto.
    applied(engine.apply({ op: "remove", target: "o00000002" }));
    const jump = history.goTo(engine, history.start)!;
    expect(jump.steps.map((step) => step.serial)).toEqual([4]);
    expect(jump.failed?.serial).toBe(3);
    expect(jump.replayed.rejected?.reason).toBe("missing-target");
    expect(history.steps().map((step) => step.serial)).toEqual([1, 2, 4]);
    expect(history.position).toBe(2);
    expect(engine.text).toBe(texts[2]);
  });

  it("tiene il numero di ogni passo anche se si fonde, si annulla o si ripete", () => {
    const { engine } = open(SOURCE);
    const history = new History(HISTORY_LIMIT, clock().now);
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 1))));
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 2))));
    history.record("draw.action.stroke", applied(engine.apply(add("o5e6f7g8h"))));
    expect(history.steps().map((step) => step.serial)).toEqual([1, 2]);
    history.undo(engine);
    expect(history.steps().map((step) => [step.serial, step.label])).toEqual([
      [1, "draw.action.move"],
      [2, "draw.action.stroke"],
    ]);
    expect(history.done).toBe(1);
    history.redo(engine);
    expect(history.position).toBe(2);
  });

  it("dopo i passi dimenticati parte dal più vecchio che ricorda", () => {
    const { engine, history, texts } = strokes(5, 3);
    expect(history.trimmed).toBe(true);
    expect(history.start).toBe(2);
    expect(history.steps().map((step) => step.serial)).toEqual([3, 4, 5]);
    history.goTo(engine, history.start);
    expect(engine.text).toBe(texts[2]);
    expect(history.goTo(engine, 1)).toBeNull();
  });

  it("cresce di revisione a ogni cambiamento", () => {
    const { engine, history } = strokes(2);
    let seen = history.revision;
    const changed = (): boolean => {
      const now = history.revision;
      const moved = now !== seen;
      seen = now;
      return moved;
    };
    history.undo(engine);
    expect(changed()).toBe(true);
    history.goTo(engine, 2);
    expect(changed()).toBe(true);
    expect(changed()).toBe(false);
    history.mark("Prima");
    expect(changed()).toBe(true);
  });
});

describe("i segni", () => {
  const steps = (history: History, engine: ReturnType<typeof open>["engine"], ids: readonly string[]) => {
    for (const id of ids) history.record("draw.action.stroke", applied(engine.apply(add(id))));
  };

  it("restano sul loro punto mentre si annulla e si ripete, e ci si torna", () => {
    const { engine } = open(SOURCE);
    const history = new History(HISTORY_LIMIT, clock().now);
    const opening = history.mark("Apertura");
    steps(history, engine, ["o5e6f7g8h", "o9i0j1k2l"]);
    const marked = engine.text;
    const sign = history.mark("Due tratti");
    expect([opening.at, sign.at]).toEqual([0, 2]);
    steps(history, engine, ["o3m4n5p6q"]);
    history.undo(engine);
    history.undo(engine);
    expect(history.marks.map((each) => each.name)).toEqual(["Apertura", "Due tratti"]);
    history.goTo(engine, sign.at);
    expect(engine.text).toBe(marked);
    history.goTo(engine, opening.at);
    expect(engine.text).toBe(SOURCE);
  });

  it("chiudono il passo in cima: il ritocco dopo il segno è un passo suo", () => {
    const { engine } = open(SOURCE);
    const history = new History(HISTORY_LIMIT, clock().now);
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 1))));
    const one = engine.text;
    history.mark("Spostato");
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 2))));
    history.undo(engine);
    expect(engine.text).toBe(one);
  });

  it("se ne vanno coi passi da ripetere, quando arriva un gesto nuovo", () => {
    const { engine } = open(SOURCE);
    const history = new History(HISTORY_LIMIT, clock().now);
    steps(history, engine, ["o5e6f7g8h"]);
    history.mark("Uno");
    steps(history, engine, ["o9i0j1k2l"]);
    history.mark("Due");
    history.undo(engine);
    history.mark("Ancora uno");
    expect(history.marks.map((each) => each.name)).toEqual(["Uno", "Ancora uno", "Due"]);
    steps(history, engine, ["o3m4n5p6q"]);
    expect(history.marks.map((each) => each.name)).toEqual(["Uno", "Ancora uno"]);
  });

  it("se ne vanno coi passi dimenticati, tranne quelli del nuovo inizio", () => {
    const { engine } = open(SOURCE);
    const history = new History(2, clock().now);
    history.mark("Apertura");
    steps(history, engine, ["o5e6f7g8h"]);
    history.mark("Uno");
    steps(history, engine, ["o9i0j1k2l", "o3m4n5p6q"]);
    expect(history.start).toBe(1);
    expect(history.marks.map((each) => [each.name, each.at])).toEqual([["Uno", 1]]);
  });

  it("passano al punto prima quando il loro passo non si annulla", () => {
    const { engine } = open(SOURCE);
    const history = new History(HISTORY_LIMIT, clock().now);
    steps(history, engine, ["o5e6f7g8h"]);
    history.record("draw.action.move", applied(engine.apply(move("o1a2b3c4d", 4))));
    history.mark("Spostato");
    applied(engine.apply({ op: "remove", target: "o1a2b3c4d" }));
    expect(history.undo(engine)?.outcome.outcome).toBe("rejected");
    expect(history.marks.map((each) => [each.name, each.at])).toEqual([["Spostato", 1]]);
  });

  it("cambiano nome, si tolgono, e ripartono da capo con un altro disegno", () => {
    const { engine } = open(SOURCE);
    const history = new History(HISTORY_LIMIT, clock().now);
    const sign = history.mark("Segno 1");
    expect(history.rename(sign.id, "Prima del colore")).toBe(true);
    expect(history.marks[0]?.name).toBe("Prima del colore");
    expect(history.unmark(sign.id)).toBe(true);
    expect([history.unmark(sign.id), history.rename(sign.id, "x")]).toEqual([false, false]);
    history.mark("Segno 2");
    expect(history.marked).toBe(2);
    steps(history, engine, ["o5e6f7g8h"]);
    history.clear();
    expect([history.marks.length, history.marked, history.canUndo, history.trimmed]).toEqual([0, 0, false, false]);
    expect(history.position).toBe(history.start);
  });
});
