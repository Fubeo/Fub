import { describe, expect, it } from "vitest";
import {
  LocalHistory,
  applyOperation,
  operationFromText,
  rebaseOperation,
  type TextEdit,
  type TextOperation,
} from "./local-history";

function edit(before: string, from: number, to: number, inserted: string): TextEdit {
  return { from, to, deleted: before.slice(from, to), inserted };
}

function operation(before: string, edits: readonly TextEdit[]): TextOperation {
  const delta = edits.reduce(
    (total, item) => total + item.inserted.length - item.deleted.length,
    0,
  );
  return { beforeLength: before.length, afterLength: before.length + delta, edits };
}

function applyAndCommit(
  history: LocalHistory,
  current: string,
  direction: "undo" | "redo",
): string {
  const decision = direction === "undo" ? history.undo(current) : history.redo(current);
  expect(decision.kind).toBe("apply");
  if (decision.kind !== "apply") return current;
  const next = applyOperation(current, decision.operation);
  expect(history.commit(decision)).toBe(true);
  return next;
}

describe("rebase delle operazioni", () => {
  it("rimappa modifiche disgiunte e inserimenti ai bordi", () => {
    const base = "abcdef";
    const action = operation(base, [edit(base, 1, 2, "X")]);
    const through = operation(base, [edit(base, 5, 5, "Y")]);
    const result = rebaseOperation(action, through);

    expect(result.kind).toBe("mapped");
    if (result.kind !== "mapped") return;
    expect(applyOperation(applyOperation(base, through), result.operation)).toBe("aXcdeYf");
  });

  it("dà la precedenza deterministica all'inserimento successivo allo stesso punto", () => {
    const base = "x";
    const action = operation(base, [edit(base, 1, 1, "locale")]);
    const through = operation(base, [edit(base, 1, 1, "esterno")]);
    const result = rebaseOperation(action, through);

    expect(result.kind).toBe("mapped");
    if (result.kind !== "mapped") return;
    expect(applyOperation(applyOperation(base, through), result.operation)).toBe("xesternolocale");
  });

  it("protegge un inserimento esterno dentro una cancellazione locale", () => {
    const base = "abc";
    const action = operation(base, [edit(base, 0, 3, "")]);
    const through = operation(base, [edit(base, 1, 1, "X")]);
    const result = rebaseOperation(action, through);

    expect(result.kind).toBe("mapped");
    if (result.kind !== "mapped") return;
    expect(applyOperation(applyOperation(base, through), result.operation)).toBe("X");
  });

  it("mantiene le modifiche multi-range mentre rimappa un'operazione esterna", () => {
    const base = "012345";
    const action = operation(base, [edit(base, 0, 0, "A"), edit(base, 5, 5, "B")]);
    const through = operation(base, [edit(base, 2, 2, "X")]);
    const result = rebaseOperation(action, through);

    expect(result.kind).toBe("mapped");
    if (result.kind !== "mapped") return;
    expect(applyOperation(applyOperation(base, through), result.operation)).toBe("A01X234B5");
  });

  it("rifiuta una sovrapposizione di sostituzioni con intenti diversi", () => {
    const base = "abc";
    const action = operation(base, [edit(base, 0, 3, "locale")]);
    const through = operation(base, [edit(base, 0, 3, "esterno")]);
    const result = rebaseOperation(action, through);

    expect(result).toEqual({ kind: "conflict", reason: "sovrapposizione fra sostituzioni ambigue" });
    expect(applyOperation(base, through)).toBe("esterno");
  });

  it("rifiuta anche una sovrapposizione parziale fra sostituzioni", () => {
    const base = "abcde";
    const action = operation(base, [edit(base, 1, 3, "locale")]);
    const through = operation(base, [edit(base, 2, 4, "esterno")]);
    const result = rebaseOperation(action, through);

    expect(result.kind).toBe("conflict");
    expect(applyOperation(base, through)).toBe("abesternoe");
  });

  it("rimappa inserimenti esterni prima e dopo la modifica locale", () => {
    const base = "abc";
    const action = operation(base, [edit(base, 1, 1, "L")]);
    const before = operation(base, [edit(base, 0, 0, "B")]);
    const after = operation(base, [edit(base, 3, 3, "A")]);

    const beforeResult = rebaseOperation(action, before);
    const afterResult = rebaseOperation(action, after);
    expect(beforeResult.kind).toBe("mapped");
    expect(afterResult.kind).toBe("mapped");
    if (beforeResult.kind !== "mapped" || afterResult.kind !== "mapped") return;
    expect(applyOperation(applyOperation(base, before), beforeResult.operation)).toBe("BaLbc");
    expect(applyOperation(applyOperation(base, after), afterResult.operation)).toBe("aLbcA");
  });
});

describe("LocalHistory", () => {
  it("valida la preimmagine senza mutare il testo", () => {
    const malformed: TextOperation = {
      beforeLength: 2,
      afterLength: 1,
      edits: [{ from: 0, to: 1, deleted: "x", inserted: "" }],
    };
    expect(() => applyOperation("ab", malformed)).toThrow("preimmagine");
    expect(() => applyOperation("ab", malformed)).toThrow();
    expect("ab").toBe("ab");
  });

  it("annulla e rifà una modifica locale", () => {
    const history = new LocalHistory();
    const base = "base";
    const local = operation(base, [edit(base, 4, 4, "!")]);
    const changed = applyOperation(base, local);
    history.acceptLocal(local, "input");

    const undone = applyAndCommit(history, changed, "undo");
    expect(undone).toBe(base);
    const redone = applyAndCommit(history, undone, "redo");
    expect(redone).toBe("base!");
  });

  it("raggruppa input consecutivi e mantiene undo/redo atomici", () => {
    const history = new LocalHistory();
    const first = operation("", [edit("", 0, 0, "a")]);
    const second = operation("a", [edit("a", 1, 1, "b")]);
    history.acceptLocal(first, "input");
    history.acceptLocal(second, "input");

    expect(history.undoDepth).toBe(1);
    const changed = applyOperation(applyOperation("", first), second);
    const undone = applyAndCommit(history, changed, "undo");
    expect(undone).toBe("");
    expect(applyAndCommit(history, undone, "redo")).toBe("ab");
  });

  it("limita il payload UTF-8 di journal e frame con un tetto aggregato", () => {
    const history = new LocalHistory({
      maxFrames: 1,
      maxJournalOperations: 8,
      maxJournalBytes: 8,
      maxRetainedBytes: 16,
    });
    let current = "";
    for (const value of ["abcd", "efgh", "ijkl"]) {
      const next = current + value;
      history.acceptLocal(operationFromText(current, next), "command");
      current = next;
    }

    expect(history.journalBytes).toBeLessThanOrEqual(8);
    expect(history.retainedPayloadBytes).toBeLessThanOrEqual(16);
    expect(history.undoDepth).toBe(1);

    const unicode = new LocalHistory({ maxJournalBytes: 4, maxRetainedBytes: 8 });
    const emoji = operation("", [edit("", 0, 0, "🙂")]);
    unicode.acceptLocal(emoji, "command");
    expect(unicode.journalBytes).toBe(new TextEncoder().encode("🙂").byteLength);
    expect(unicode.retainedPayloadBytes).toBeLessThanOrEqual(8);
  });

  it("conserva l'undo dopo la compattazione con operazioni intervenute", () => {
    const history = new LocalHistory({
      maxFrames: 8,
      maxJournalOperations: 2,
      maxJournalBytes: 100,
      maxRetainedBytes: 1_000,
    });
    let current = "";

    const first = operationFromText(current, "a");
    current = applyOperation(current, first);
    history.acceptLocal(first, "command");

    const second = operationFromText(current, "ab");
    current = applyOperation(current, second);
    history.acceptLocal(second, "command");

    const external = operationFromText(current, "abc");
    current = applyOperation(current, external);
    history.acceptExternal(external);
    expect(history.journalSize).toBeLessThanOrEqual(2);

    current = applyAndCommit(history, current, "undo");
    expect(current).toBe("ac");
    current = applyAndCommit(history, current, "undo");
    expect(current).toBe("c");
  });

  it("quarantena come no-op un residuo già cancellato dall'esterno", () => {
    const history = new LocalHistory();
    const base = "base";
    const local = operation(base, [edit(base, 4, 4, "!")]);
    const changed = applyOperation(base, local);
    history.acceptLocal(local, "input");
    const external = operation(changed, [edit(changed, 4, 5, "")]);
    const current = applyOperation(changed, external);
    history.acceptExternal(external);

    const decision = history.undo(current);
    expect(decision.kind).toBe("noop");
    expect(current).toBe("base");
    expect(history.undoDepth).toBe(0);
  });

  it("protegge il residuo locale dal diff ambiguo con parentesi ripetute", () => {
    const history = new LocalHistory();
    const initial = "Il primo documento di questo vault.\n";
    const withA = `${initial} [A]`;
    const before = `${withA} [B]`;
    const withAOperation = operationFromText(initial, withA);
    const localB = operationFromText(withA, before);
    history.acceptExternal(withAOperation);
    history.acceptLocal(localB, "command");

    const target = `${initial} [B]`;
    const plan = history.planExternalText(before, target);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.policy).toBe("preserve");
    expect(plan.operation.edits).toEqual([
      { from: initial.length, to: withA.length, deleted: " [A]", inserted: "" },
    ]);
    expect(applyOperation(before, plan.operation)).toBe(target);

    expect(history.acceptExternal(plan.operation, plan.policy)).toBe(true);
    const undo = history.undo(target);
    expect(undo.kind).toBe("apply");
    if (undo.kind !== "apply") return;
    expect(applyOperation(target, undo.operation)).toBe(initial);
  });

  it("ripiega sul target e cancella la history quando due ancoraggi sono equivalenti", () => {
    const history = new LocalHistory();
    const base = "aax";
    const local = operationFromText(base, "xaax");
    history.acceptLocal(local, "command");

    const plan = history.planExternalText("xaax", "axax");
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.policy).toBe("authoritative");
    expect(plan.reason).toBeTruthy();
    expect(applyOperation("xaax", plan.operation)).toBe("axax");
    expect(history.acceptExternal(plan.operation, plan.policy)).toBe(true);
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(0);
    expect(history.journalSize).toBe(0);
  });

  it("rifiuta la reintroduzione vicina dell'inverso di una sostituzione", () => {
    const history = new LocalHistory();
    const local = operationFromText("abc", "aXc");
    history.acceptLocal(local, "command");

    const plan = history.planExternalText("aXc", "aXbc");
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.policy).toBe("authoritative");
    expect(applyOperation("aXc", plan.operation)).toBe("aXbc");
    expect(history.acceptExternal(plan.operation, plan.policy)).toBe(true);
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(0);
  });

  it("non sceglie un'occorrenza solo perché è più vicina all'ancoraggio", () => {
    const history = new LocalHistory();
    const other = new LocalHistory();
    const local = operationFromText("aa", "aaa");
    history.acceptLocal(local, "command");
    other.acceptLocal(operationFromText("", "altro"), "command");

    const plan = history.planExternalText("aaa", "aaaa");
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.policy).toBe("authoritative");
    expect(applyOperation("aaa", plan.operation)).toBe("aaaa");
    expect(history.acceptExternal(plan.operation, plan.policy)).toBe(true);
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(0);
    expect(other.undoDepth).toBe(1);
  });

  it("ripiega se più residui hanno assegnazioni monotone possibili", () => {
    const history = new LocalHistory();
    const base = "abcd";
    const local = operation(base, [edit(base, 1, 1, "x"), edit(base, 3, 3, "x")]);
    const current = applyOperation(base, local);
    const target = `x${current}x`;
    history.acceptLocal(local, "command");

    const plan = history.planExternalText(current, target);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.policy).toBe("authoritative");
    expect(applyOperation(current, plan.operation)).toBe(target);
  });

  it("separa gli aggiornamenti esterni da un confine locale assente", () => {
    const history = new LocalHistory();
    const other = new LocalHistory();
    const base = "abcd";
    const current = applyOperation(base, operation(base, [edit(base, 1, 3, "")]));
    expect(current).toBe("ad");
    history.acceptLocal(operationFromText(base, current), "command");
    other.acceptLocal(operationFromText("", "other"), "command");

    const target = "QadR";
    const plan = history.planExternalText(current, target);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.policy).toBe("preserve");
    expect(plan.operation.edits).toEqual([
      { from: 0, to: 0, deleted: "", inserted: "Q" },
      { from: 2, to: 2, deleted: "", inserted: "R" },
    ]);
    expect(applyOperation(current, plan.operation)).toBe(target);
    expect(history.acceptExternal(plan.operation, plan.policy)).toBe(true);
    expect(other.undoDepth).toBe(1);

    const undo = history.undo(target);
    expect(undo.kind).toBe("apply");
    if (undo.kind !== "apply") return;
    expect(applyOperation(target, undo.operation)).toBe("QabcdR");
  });

  it("ripiega quando un confine assente ha contesto ripetuto", () => {
    const history = new LocalHistory();
    const base = "aXa";
    const current = applyOperation(base, operation(base, [edit(base, 1, 2, "")]));
    history.acceptLocal(operation(base, [edit(base, 1, 2, "")]), "command");

    const plan = history.planExternalText(current, "aaaa");
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.policy).toBe("authoritative");
    expect(applyOperation(current, plan.operation)).toBe("aaaa");
    expect(history.acceptExternal(plan.operation, plan.policy)).toBe(true);
    expect(history.undoDepth).toBe(0);
  });

  it("mantiene separati più confini assenti monotoni", () => {
    const history = new LocalHistory();
    const base = "abcdef";
    const local = operation(base, [edit(base, 1, 2, ""), edit(base, 4, 5, "")]);
    const current = applyOperation(base, local);
    history.acceptLocal(local, "command");

    const target = "QacdfR";
    const plan = history.planExternalText(current, target);
    if (plan.kind !== "apply") return;
    expect(plan.policy).toBe("preserve");
    expect(plan.operation.edits).toEqual([
      { from: 0, to: 0, deleted: "", inserted: "Q" },
      { from: 4, to: 4, deleted: "", inserted: "R" },
    ]);
    expect(applyOperation(current, plan.operation)).toBe(target);
    expect(history.acceptExternal(plan.operation, plan.policy)).toBe(true);
    const undo = history.undo(target);
    expect(undo.kind).toBe("apply");
    if (undo.kind !== "apply") return;
    expect(applyOperation(target, undo.operation)).toBe("QabcdefR");
  });

  it("resetta stack e journal e dispone in modo idempotente", () => {
    const history = new LocalHistory({ maxFrames: 2, maxJournalOperations: 2 });
    let current = "";
    for (const value of ["a", "b", "c", "d"]) {
      const next = current + value;
      const action = operationFromText(current, next);
      history.acceptLocal(action, "input");
      current = next;
    }

    expect(history.undoDepth).toBeLessThanOrEqual(2);
    expect(history.journalSize).toBeLessThanOrEqual(2);
    history.reset();
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(0);
    expect(history.journalSize).toBe(0);
    history.dispose();
    history.dispose();
    expect(history.acceptExternal(operationFromText("", "x"))).toBe(false);
    expect(history.undo("d").kind).toBe("conflict");
  });
});
