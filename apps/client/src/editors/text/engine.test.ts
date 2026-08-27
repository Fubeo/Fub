// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorView, keymap } from "@codemirror/view";
import { insertNewlineAndIndent, redoDepth, undoDepth } from "@codemirror/commands";
import { EditorSelection, EditorState, StateField, Transaction, type Extension } from "@codemirror/state";
import { createTextEngine, type EditorChange, type TextEngine } from "./engine";
import { MAX_FOOTPRINTS, type FootprintState } from "./history-footprints";
interface TestEditor {
  ed: TextEngine;
  view: () => EditorView;
  parent: HTMLElement;
}

function editor(
  onChange: (change: EditorChange) => void = () => {},
  extensions?: () => Extension,
): TestEditor {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const ed = createTextEngine(parent, {
    onChange,
    onSelectionChange: () => {},
    extensions,
  });
  return {
    ed,
    parent,
    view: () => {
      const v = EditorView.findFromDOM(parent);
      if (!v) throw new Error("l'editor non è montato");
      return v;
    },
  };
}

/// Una modifica come la fa l'utente: una transazione normale, che è ciò che la
/// cronologia registra.
function writes(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: 0, insert: text } });
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function renderedChange(view: EditorView, from: number, to: number, insert: string): string {
  const { doc, lineBreak } = view.state;
  return `${doc.sliceString(0, from, lineBreak)}${insert}${doc.sliceString(to, doc.length, lineBreak)}`;
}

type TextEngineInternals = { footprints: { state: FootprintState } };

function footprintState(ed: TextEngine): FootprintState {
  // `footprints` è privato per il motore, ma il test deve presidiare il suo
  // contratto di metadata bounded senza introdurre una seconda API pubblica.
  const internals = ed as unknown as TextEngineInternals;
  return internals.footprints.state;
}

describe("setDoc", () => {
  it("non lascia annullare dentro una nota le modifiche fatte in un'altra", () => {
    const { ed, view } = editor();

    ed.setDoc("prima nota");
    writes(view(), "X ");
    expect(ed.getDoc()).toBe("X prima nota");

    // Cambio nota: da qui in poi la cronologia dell'altra non deve esistere
    // più. Con un `dispatch` al posto dello stato nuovo, qui sotto si leggerebbe
    // «prima nota» — cioè il testo di un altro documento scritto dentro questo,
    // e persistito subito dopo dal debounce del salvataggio.
    ed.setDoc("seconda nota");
    expect(ed.undo()).toBe(false);
    expect(ed.getDoc()).toBe("seconda nota");
  });

  it("il testo che mette non è annullabile nemmeno da solo", () => {
    const { ed } = editor();
    ed.setDoc("contenuto");
    expect(ed.undo()).toBe(false);
    expect(ed.getDoc()).toBe("contenuto");
  });

  it("una modifica dell'utente resta annullabile", () => {
    const { ed, view } = editor();
    ed.setDoc("base");
    writes(view(), "X");
    expect(ed.getDoc()).toBe("Xbase");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("base");
  });
});

describe("syncDoc", () => {
  it("non crea una voce di undo per la modifica remota", () => {
    const changes: EditorChange[] = [];
    const { ed } = editor((change) => changes.push(change));

    ed.setDoc("prima nota");
    ed.syncDoc("seconda nota");

    expect(ed.undo()).toBe(false);
    expect(ed.getDoc()).toBe("seconda nota");
    expect(changes).toEqual([]);
  });

  it("ripiega sul testo autoritativo se la patch sorgente è stantia", () => {
    const changes: EditorChange[] = [];
    const { ed } = editor((change) => changes.push(change));

    ed.setDoc("base");
    ed.syncDoc({
      text: "server",
      operation: {
        beforeLength: 4,
        afterLength: 6,
        edits: [{ from: 0, to: 4, deleted: "xxxx", inserted: "server" }],
      },
    });

    expect(ed.getDoc()).toBe("server");
    expect(ed.undo()).toBe(false);
    expect(changes).toEqual([]);
  });

  it("conserva l'undo locale mentre applica la modifica remota", () => {
    const { ed, view } = editor();

    ed.setDoc("base");
    writes(view(), "X");
    ed.syncDoc("Xbase?");

    expect(ed.getDoc()).toBe("Xbase?");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("base?");
  });

  it("rimappa il cursore senza riportarlo all'inizio", () => {
    const { ed, view } = editor();

    ed.setDoc("uno due");
    view().dispatch({ selection: EditorSelection.single(6) });
    ed.syncDoc("uno nuovo due");

    expect(ed.selections().primary).toEqual({ start: 12, end: 12, text: "" });
  });
  it("azzera entrambi i branch prima di applicare una sostituzione sovrapposta", () => {
    const { ed, view } = editor();
    ed.setDoc("abc");
    view().dispatch({ changes: { from: 0, to: 3, insert: "local" }, userEvent: "input.type" });
    expect(ed.getDoc()).toBe("local");
    const initialView = view();
    view().dispatch({ selection: EditorSelection.single(2) });
    const selectionBeforeReset = initialView.state.selection.main.anchor;
    expect(selectionBeforeReset).toBe(2);
    ed.syncDoc("external");

    expect(ed.getDoc()).toBe("external");
    expect(view()).toBe(initialView);
    expect(initialView.state.selection.main.anchor).toBe(0);
    expect(undoDepth(initialView.state)).toBe(0);
    expect(redoDepth(initialView.state)).toBe(0);
    expect(ed.undo()).toBe(false);
    expect(ed.redo()).toBe(false);
    expect(ed.getDoc()).toBe("external");
  });
  it("invalida anche il redo branch su overlap dopo un undo", () => {
    const { ed, view } = editor();
    ed.setDoc("abc");
    view().dispatch({ changes: { from: 1, insert: "L" }, userEvent: "input.type" });
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("abc");
    expect(redoDepth(view().state)).toBe(1);

    ed.syncDoc("aXbc");

    expect(ed.getDoc()).toBe("aXbc");
    expect(redoDepth(view().state)).toBe(0);
    expect(ed.redo()).toBe(false);
  });
  it("fallisce chiuso dopo un transaction con footprint overflow", () => {
    const { ed, view } = editor();
    const base = " ".repeat(MAX_FOOTPRINTS * 2 + 1);
    ed.setDoc(base);
    const changes = Array.from({ length: MAX_FOOTPRINTS + 1 }, (_, index) => ({
      from: index * 2,
      insert: "x",
    }));
    view().dispatch({ changes, userEvent: "input.type" });
    const local = ed.getDoc();
    ed.syncDoc(`${local}?`);

    expect(ed.getDoc()).toBe(`${local}?`);
    expect(ed.undo()).toBe(false);
    expect(undoDepth(view().state)).toBe(0);
  });

  it("azzera la history quando un remote tocca l'anchor di una cancellazione", () => {
    const { ed, view } = editor();
    ed.setDoc("abc");
    view().dispatch({ changes: { from: 1, to: 2, insert: "" }, userEvent: "delete.backward" });
    expect(ed.getDoc()).toBe("ac");

    ed.syncDoc("aXc");

    expect(ed.getDoc()).toBe("aXc");
    expect(undoDepth(view().state)).toBe(0);
    expect(ed.undo()).toBe(false);
  });

  it("non cancella l'undo per un inserimento remoto al bordo destro", () => {
    const { ed, view } = editor();
    ed.setDoc("abc");
    view().dispatch({ changes: { from: 3, insert: "L" }, userEvent: "input.type" });
    ed.syncDoc("abcLB");

    expect(ed.getDoc()).toBe("abcLB");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("abcB");
  });

  it("controlla le modifiche effettive dopo un transactionFilter", () => {
    let seen = 0;
    const filter = EditorState.transactionFilter.of((transaction) => {
      if (!transaction.isUserEvent("sync")) return transaction;
      seen += 1;
      return {
        changes: {
          from: 0,
          to: transaction.startState.doc.length,
          insert: transaction.newDoc.toString(),
        },
        annotations: [
          Transaction.userEvent.of("sync"),
          Transaction.addToHistory.of(false),
          Transaction.remote.of(true),
        ],
        filter: false,
      };
    });
    const { ed, view } = editor(() => {}, () => filter);
    ed.setDoc("abc");
    const initialView = view();
    view().dispatch({ changes: { from: 1, insert: "L" }, userEvent: "input.type" });
    ed.syncDoc("aLbc?");

    expect(seen).toBe(2);
    expect(ed.getDoc()).toBe("aLbc?");
    expect(view()).toBe(initialView);
    expect(undoDepth(view().state)).toBe(0);
    expect(ed.undo()).toBe(false);
  });
});

describe("raggruppamento degli eventi utente", () => {
  it("raggruppa l'auto-pair con il carattere digitato al suo interno", () => {
    const { ed, view } = editor();
    ed.setDoc("");
    // closeBrackets emits this transaction for `[` and leaves the cursor
    // between the delimiters; the following real input transaction inserts A.
    view().dispatch({
      changes: { from: 0, insert: "[]" },
      selection: EditorSelection.single(1),
      userEvent: "input.type",
    });
    view().dispatch({
      changes: { from: 1, insert: "A" },
      selection: EditorSelection.single(2),
      userEvent: "input.type",
    });

    expect(ed.getDoc()).toBe("[A]");
    view().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.getDoc()).toBe("");
    view().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.getDoc()).toBe("[A]");
  });

  it("adotta il raggruppamento nativo della composizione", () => {
    const { ed, view } = editor();
    ed.setDoc("");
    view().dispatch({ changes: { from: 0, insert: "あ" }, userEvent: "input.type.compose" });
    view().dispatch({ changes: { from: 1, insert: "い" }, userEvent: "input.type.compose" });

    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("");
    expect(ed.undo()).toBe(false);
    expect(ed.getDoc()).toBe("");
  });

  it("mantiene separate le transazioni di incolla", () => {
    const { ed, view } = editor();
    ed.setDoc("");
    view().dispatch({ changes: { from: 0, insert: "uno" }, userEvent: "input.paste" });
    view().dispatch({ changes: { from: 3, insert: "due" }, userEvent: "input.paste" });

    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("uno");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("");
  });

  it("ripristina la selezione dopo undo e redo", () => {
    const { ed, view } = editor();
    ed.setDoc("abc");
    view().dispatch({ selection: EditorSelection.single(1) });
    view().dispatch({
      changes: { from: 1, insert: "X" },
      selection: EditorSelection.single(2),
      userEvent: "input.type",
    });

    expect(ed.selections().primary.start).toBe(2);
    expect(ed.undo()).toBe(true);
    expect(ed.selections().primary.start).toBe(1);
    expect(ed.redo()).toBe(true);
    expect(ed.selections().primary.start).toBe(2);
  });
  it("delega a native la finestra temporale e la contiguità", () => {
    const { ed, view } = editor();
    ed.setDoc("");
    view().dispatch({
      changes: { from: 0, insert: "a" },
      userEvent: "input.type",
      annotations: Transaction.time.of(100),
    });
    view().dispatch({
      changes: { from: 1, insert: "b" },
      userEvent: "input.type",
      annotations: Transaction.time.of(599),
    });
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("");

    ed.setDoc("");
    view().dispatch({
      changes: { from: 0, insert: "a" },
      userEvent: "input.type",
      annotations: Transaction.time.of(100),
    });
    view().dispatch({
      changes: { from: 1, insert: "b" },
      userEvent: "input.type",
      annotations: Transaction.time.of(600),
    });
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("a");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("");
  });

  it("raggruppa cancellazioni backward consecutive", () => {
    const { ed, view } = editor();
    ed.setDoc("abc");
    view().dispatch({ changes: { from: 2, to: 3 }, userEvent: "delete.backward" });
    view().dispatch({ changes: { from: 1, to: 2 }, userEvent: "delete.backward" });

    expect(ed.getDoc()).toBe("a");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("abc");
  });

  it("raggruppa una sostituzione dopo la selezione", () => {
    const { ed, view } = editor();
    ed.setDoc("abc");
    view().dispatch({ selection: EditorSelection.range(1, 2) });
    view().dispatch({
      changes: { from: 1, to: 2, insert: "x" },
      selection: EditorSelection.single(2),
      userEvent: "input.type",
    });
    view().dispatch({
      changes: { from: 2, insert: "y" },
      selection: EditorSelection.single(3),
      userEvent: "input.type",
    });

    expect(ed.getDoc()).toBe("axyc");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("abc");
  });
});
describe("keymap e input history nativi", () => {
  it("gestisce beforeinput historyUndo e historyRedo sulla vista reale", () => {
    const { ed, view } = editor();
    ed.setDoc("base");
    view().dispatch({ changes: { from: 4, insert: "!" }, userEvent: "input.type" });
    expect(ed.getDoc()).toBe("base!");

    view().contentDOM.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "historyUndo",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(ed.getDoc()).toBe("base");

    view().contentDOM.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "historyRedo",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(ed.getDoc()).toBe("base!");
  });

  it("monta undoSelection e redoSelection nel keymap nativo", () => {
    const { ed, view } = editor();
    ed.setDoc("abc");
    view().dispatch({ selection: EditorSelection.single(2) });
    view().dispatch({ selection: EditorSelection.single(1) });

    view().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "u", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.selections().primary.start).toBe(2);

    view().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "u", altKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.selections().primary.start).toBe(1);
  });
  it("monta ed esegue il redo Linux nativo", () => {
    const { ed, view } = editor();
    ed.setDoc("base");
    view().dispatch({ changes: { from: 4, insert: "!" }, userEvent: "input.type" });
    view().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.getDoc()).toBe("base");

    const linuxRedo = view()
      .state
      .facet(keymap)
      .flat()
      .find((binding) => binding.linux === "Ctrl-Shift-z");
    expect(linuxRedo).toBeDefined();
    expect(linuxRedo?.run?.(view())).toBe(true);
    expect(ed.getDoc()).toBe("base!");
  });
});

describe("due superfici dello stesso documento", () => {
  it("mantiene buffer condiviso, undo locali e redo senza echi", () => {
    let buffer = "base";
    let changesA = 0;
    let changesB = 0;
    let second: TestEditor | undefined;
    const first = editor((change) => {
      changesA += 1;
      buffer = change.text;
      second?.ed.syncDoc({ text: buffer, operation: change.operation });
    });
    second = editor((change) => {
      changesB += 1;
      buffer = change.text;
      first.ed.syncDoc({ text: buffer, operation: change.operation });
    });

    first.ed.setDoc(buffer);
    second.ed.setDoc(buffer);
    first.view().dispatch({
      changes: { from: first.view().state.doc.length, insert: " [A]" },
    });
    second.view().dispatch({
      changes: { from: second.view().state.doc.length, insert: " [B]" },
    });
    expect(first.ed.getDoc()).toBe("base [A] [B]");
    expect(second.ed.getDoc()).toBe("base [A] [B]");
    expect(changesA).toBe(1);
    expect(changesB).toBe(1);

    expect(first.ed.undo()).toBe(true);
    expect(first.ed.getDoc()).toBe("base [B]");
    expect(second.ed.getDoc()).toBe("base [B]");
    expect(changesA).toBe(2);
    expect(changesB).toBe(1);

    expect(second.ed.undo()).toBe(true);
    expect(first.ed.getDoc()).toBe("base");
    expect(second.ed.getDoc()).toBe("base");

    expect(second.ed.redo()).toBe(true);
    expect(first.ed.getDoc()).toBe("base [B]");
    expect(second.ed.getDoc()).toBe("base [B]");

    first.ed.destroy();
    second.ed.destroy();
  });
});

describe("stress seeded F0-F3", () => {
  it("mantiene convergenza, dati e metadata in una sequenza mista", () => {
    const seed = 0xf03f03;
    const random = seededRandom(seed);
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
    const trace = [`seed=0x${seed.toString(16)}`];
    const payloads: string[] = [];
    const callbackOrigins: string[] = [];
    let clock = 0;
    let second: TestEditor | undefined;
    const first = editor((change) => {
      callbackOrigins.push(`A:${change.origin}`);
      second?.ed.syncDoc({ text: change.text, operation: change.operation });
    });
    const secondEditor = editor((change) => {
      callbackOrigins.push(`B:${change.origin}`);
      first.ed.syncDoc({ text: change.text, operation: change.operation });
    });
    second = secondEditor;
    const surfaces = [first, secondEditor] as const;

    const assertState = (label: string): void => {
      const message = `seed=0x${seed.toString(16)} trace=${trace.join(" -> ")} (${label})`;
      expect(first.ed.getDoc(), message).toBe(secondEditor.ed.getDoc());
      for (const surface of surfaces) {
        const view = surface.view();
        const length = view.state.doc.length;
        expect(
          view.state.selection.ranges.every(
            (range) =>
              Number.isInteger(range.from) &&
              Number.isInteger(range.to) &&
              range.from >= 0 &&
              range.from <= range.to &&
              range.to <= length,
          ),
          message,
        ).toBe(true);

        const bytes = new TextEncoder().encode(surface.ed.getDoc()).length;
        const selections = surface.ed.selections();
        for (const selection of [selections.primary, ...selections.secondary]) {
          expect(selection.start, message).toBeGreaterThanOrEqual(0);
          expect(selection.start, message).toBeLessThanOrEqual(bytes);
          expect(selection.end, message).toBeGreaterThanOrEqual(selection.start);
          expect(selection.end, message).toBeLessThanOrEqual(bytes);
        }

        const footprints = footprintState(surface.ed);
        expect(
          footprints.ranges.length + footprints.anchors.length,
          message,
        ).toBeLessThanOrEqual(MAX_FOOTPRINTS);
        expect(
          footprints.ranges.every(
            (range) =>
              Number.isInteger(range.from) &&
              Number.isInteger(range.to) &&
              range.from >= 0 &&
              range.from < range.to,
          ),
          message,
        ).toBe(true);
        expect(footprints.anchors.every((anchor) => Number.isInteger(anchor) && anchor >= 0), message).toBe(
          true,
        );
        expect(footprints).not.toHaveProperty("text");
        expect(footprints).not.toHaveProperty("inverse");
        expect(footprints).not.toHaveProperty("stack");
        const metadata = JSON.stringify(footprints);
        for (const payload of payloads) expect(metadata, message).not.toContain(payload);
      }
    };
    const expectCallbackDelta = (before: number, expected: readonly string[]): void => {
      expect(callbackOrigins.slice(before)).toEqual(expected);
    };
    const step = (label: string, action: () => void): void => {
      trace.push(label);
      action();
      assertState(label);
    };
    const nextTime = (): number => {
      clock += 1;
      return clock * 1_000;
    };

    const initial = "alpha\r\nbeta\r\ngamma\r\ndelta";
    step("setDoc CRLF", () => {
      const before = callbackOrigins.length;
      first.ed.setDoc(initial);
      secondEditor.ed.setDoc(initial);
      expectCallbackDelta(before, []);
    });

    const localInsert = `L${pick(["a", "b", "c"])}`;
    const localAt = 1 + Math.floor(random() * 3);
    payloads.push(localInsert);
    step(`local edit A ${JSON.stringify(localInsert)}@${localAt}`, () => {
      const before = callbackOrigins.length;
      first.view().dispatch({
        changes: { from: localAt, insert: localInsert },
        selection: EditorSelection.single(localAt + localInsert.length),
        userEvent: "input.type",
        annotations: Transaction.time.of(nextTime()),
      });
      expectCallbackDelta(before, ["A:input"]);
      expect(first.ed.getDoc()).toContain(localInsert);
      expect(undoDepth(first.view().state)).toBe(1);
      expect(undoDepth(secondEditor.view().state)).toBe(0);
    });

    const remoteOne = `remote-${pick(["a", "b", "c"])}`;
    payloads.push(remoteOne);
    const remoteOneText = `${first.ed.getDoc()}\r\n${remoteOne}`;
    step(`remote edit append ${JSON.stringify(remoteOne)}`, () => {
      const before = callbackOrigins.length;
      first.ed.syncDoc(remoteOneText);
      secondEditor.ed.syncDoc(remoteOneText);
      expectCallbackDelta(before, []);
      expect(undoDepth(first.view().state)).toBe(1);
      expect(undoDepth(secondEditor.view().state)).toBe(0);
    });

    step("undo local edit", () => {
      const before = callbackOrigins.length;
      expect(first.ed.undo()).toBe(true);
      expectCallbackDelta(before, ["A:undo"]);
      expect(first.ed.getDoc()).toBe(`${initial}\r\n${remoteOne}`);
      expect(first.ed.getDoc()).not.toContain(localInsert);
      expect(redoDepth(first.view().state)).toBe(1);
      expect(undoDepth(secondEditor.view().state)).toBe(0);
    });

    const newLocalInsert = `N${pick(["x", "y", "z"])}`;
    const newLocalAt = Math.floor(random() * 3);
    payloads.push(newLocalInsert);
    step(`new local edit A ${JSON.stringify(newLocalInsert)}@${newLocalAt}`, () => {
      const before = callbackOrigins.length;
      first.view().dispatch({
        changes: { from: newLocalAt, insert: newLocalInsert },
        selection: EditorSelection.single(newLocalAt + newLocalInsert.length),
        userEvent: "input.type",
        annotations: Transaction.time.of(nextTime()),
      });
      expectCallbackDelta(before, ["A:input"]);
      expect(redoDepth(first.view().state)).toBe(0);
      expect(undoDepth(first.view().state)).toBe(1);
      expect(undoDepth(secondEditor.view().state)).toBe(0);
    });

    step("eliminated redo", () => {
      const before = callbackOrigins.length;
      const beforeDoc = first.ed.getDoc();
      expect(first.ed.redo()).toBe(false);
      expectCallbackDelta(before, []);
      expect(first.ed.getDoc()).toBe(beforeDoc);
      expect(redoDepth(first.view().state)).toBe(0);
    });

    const remoteTwo = `remote-${pick(["d", "e", "f"])}`;
    payloads.push(remoteTwo);
    const remoteTwoText = `${first.ed.getDoc()}\r\n${remoteTwo}`;
    step(`remote edit append ${JSON.stringify(remoteTwo)}`, () => {
      const before = callbackOrigins.length;
      first.ed.syncDoc(remoteTwoText);
      secondEditor.ed.syncDoc(remoteTwoText);
      expectCallbackDelta(before, []);
      expect(undoDepth(first.view().state)).toBe(1);
      expect(undoDepth(secondEditor.view().state)).toBe(0);
    });

    const multiSource = first.view().state.doc.toString();
    let multiFrom = Math.max(1, Math.floor(multiSource.length / 3));
    while (multiFrom < multiSource.length - 2 && multiSource[multiFrom] === "\n") multiFrom += 1;
    let multiTo = Math.max(multiFrom + 2, Math.floor((multiSource.length * 2) / 3));
    while (multiTo < multiSource.length - 1 && multiSource[multiTo] === "\n") multiTo += 1;
    const multiLeft = `M${pick(["g", "h", "i"])}`;
    const multiRight = `Q${pick(["j", "k", "l"])}`;
    payloads.push(multiLeft, multiRight);
    const beforeMulti = first.ed.getDoc();
    step(`multi-range ${multiFrom},${multiTo}`, () => {
      const before = callbackOrigins.length;
      const time = nextTime();
      first.view().dispatch({
        changes: [
          { from: multiFrom, insert: multiLeft },
          { from: multiTo, insert: multiRight },
        ],
        selection: EditorSelection.create(
          [
            EditorSelection.range(multiFrom, multiFrom + multiLeft.length),
            EditorSelection.range(
              multiTo + multiLeft.length,
              multiTo + multiLeft.length + multiRight.length,
            ),
          ],
          1,
        ),
        userEvent: "input.type",
        annotations: Transaction.time.of(time),
      });
      expectCallbackDelta(before, ["A:input"]);
      expect(first.view().state.selection.ranges).toHaveLength(2);
      expect(first.view().state.selection.mainIndex).toBe(1);
      expect(undoDepth(first.view().state)).toBe(2);
      expect(undoDepth(secondEditor.view().state)).toBe(0);
    });

    step("undo multi-range", () => {
      const before = callbackOrigins.length;
      expect(first.ed.undo()).toBe(true);
      expectCallbackDelta(before, ["A:undo"]);
      expect(first.ed.getDoc()).toBe(beforeMulti);
      expect(undoDepth(first.view().state)).toBe(1);
      expect(redoDepth(first.view().state)).toBe(1);
    });

    const overwrite = `REMOTE-${pick(["m", "n", "o"])}`;
    payloads.push(overwrite);
    const ambiguousOverwrite = renderedChange(
      first.view(),
      multiFrom,
      multiFrom + 1,
      overwrite,
    );
    step(`remote ambiguous overwrite @${multiFrom}`, () => {
      const before = callbackOrigins.length;
      first.ed.syncDoc(ambiguousOverwrite);
      secondEditor.ed.syncDoc(ambiguousOverwrite);
      expectCallbackDelta(before, []);
      expect(first.ed.getDoc()).toBe(ambiguousOverwrite);
      expect(first.ed.undo()).toBe(false);
      expect(first.ed.redo()).toBe(false);
      expect(first.ed.getDoc()).toBe(ambiguousOverwrite);
      expect(secondEditor.ed.undo()).toBe(false);
      expect(secondEditor.ed.redo()).toBe(false);
    });

    const composed = ["あ", "い"] as const;
    payloads.push(...composed);
    const compositionAt = first.view().state.doc.length;
    step("composition", () => {
      const before = callbackOrigins.length;
      const time = nextTime();
      first.view().dispatch({
        changes: { from: compositionAt, insert: composed[0] },
        selection: EditorSelection.single(compositionAt + composed[0].length),
        userEvent: "input.type.compose",
        annotations: Transaction.time.of(time),
      });
      first.view().dispatch({
        changes: { from: compositionAt + composed[0].length, insert: composed[1] },
        selection: EditorSelection.single(compositionAt + composed[0].length + composed[1].length),
        userEvent: "input.type.compose",
        annotations: Transaction.time.of(time),
      });
      expectCallbackDelta(before, ["A:input", "A:input"]);
      expect(undoDepth(first.view().state)).toBe(1);
      expect(undoDepth(secondEditor.view().state)).toBe(0);
    });

    const paste = ` paste-${pick(["p", "q", "r"])}`;
    payloads.push(paste);
    const pasteAt = first.view().state.doc.length;
    step(`paste ${JSON.stringify(paste)}`, () => {
      const before = callbackOrigins.length;
      first.view().dispatch({
        changes: { from: pasteAt, insert: paste },
        selection: EditorSelection.single(pasteAt + paste.length),
        userEvent: "input.paste",
        annotations: Transaction.time.of(nextTime()),
      });
      expectCallbackDelta(before, ["A:input"]);
      expect(undoDepth(first.view().state)).toBe(2);
      expect(undoDepth(secondEditor.view().state)).toBe(0);
      expect(secondEditor.ed.undo()).toBe(false);
      expect(secondEditor.ed.redo()).toBe(false);
    });

    const crlfRemote = `\r\nremote-crlf-${pick(["s", "t", "u"])}`;
    payloads.push(crlfRemote);
    const crlfText = `${first.ed.getDoc()}${crlfRemote}`;
    step("remote CRLF edit", () => {
      const before = callbackOrigins.length;
      first.ed.syncDoc(crlfText);
      secondEditor.ed.syncDoc(crlfText);
      expectCallbackDelta(before, []);
      expect(first.ed.getDoc()).toContain("\r\n");
      expect(first.ed.getDoc().replace(/\r\n/g, "")).not.toContain("\n");
      expect(undoDepth(first.view().state)).toBe(2);
      expect(undoDepth(secondEditor.view().state)).toBe(0);
    });

    const unicode = pick([" 🎯", " café", " 日本語"]);
    payloads.push(unicode);
    const unicodeAt = first.view().state.doc.length;
    step(`Unicode edit ${JSON.stringify(unicode)}`, () => {
      const before = callbackOrigins.length;
      first.view().dispatch({
        changes: { from: unicodeAt, insert: unicode },
        selection: EditorSelection.single(unicodeAt + unicode.length),
        userEvent: "input.type",
        annotations: Transaction.time.of(nextTime()),
      });
      expectCallbackDelta(before, ["A:input"]);
      expect(first.ed.getDoc()).toContain(unicode);
      expect(undoDepth(first.view().state)).toBe(3);
      expect(undoDepth(secondEditor.view().state)).toBe(0);
      expect(secondEditor.ed.undo()).toBe(false);
      expect(secondEditor.ed.redo()).toBe(false);
    });

    first.ed.destroy();
    secondEditor.ed.destroy();
  });
});

describe("revealByteOffset", () => {
  it("porta un offset UTF-8 alla posizione giusta tra caratteri multibyte", () => {
    const { ed, view } = editor();
    const text = "prima 🎯 seconda";
    const before = "prima 🎯 ";

    ed.setDoc(text);
    ed.revealByteOffset(new TextEncoder().encode(before).length);

    expect(view().state.selection.main.anchor).toBe(before.length);
  });

  it("combina UTF-8 e CRLF nel ponte verso la posizione dell'editor", () => {
    const { ed, view } = editor();
    const text = "inizio\r\n🙂 café\r\nfine";
    const before = "inizio\r\n🙂 café\r\n";

    ed.setDoc(text);
    ed.revealByteOffset(new TextEncoder().encode(before).length);

    expect(view().state.selection.main.anchor).toBe("inizio\n🙂 café\n".length);
  });
});

describe("cambio di tema", () => {
  it("non distrugge la history locale", () => {
    const { ed, view } = editor();

    ed.setDoc("base");
    writes(view(), "X");
    ed.setTheme("light");

    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("base");
  });
});

describe("sola lettura", () => {
  it("blocca l'input utente e riabilita l'editing senza perdere stato", () => {
    const { ed, view } = editor();
    ed.setDoc("base");
    const initialView = view();
    initialView.dispatch({ selection: EditorSelection.single(2) });
    initialView.dispatch({
      changes: { from: 2, insert: "X" },
      selection: EditorSelection.single(3),
      userEvent: "input.type",
    });
    const selectionBefore = ed.selections();
    const textBefore = ed.getDoc();
    const undoBeforeReadOnly = undoDepth(initialView.state);
    const redoBeforeReadOnly = redoDepth(initialView.state);

    ed.setReadOnly(true);
    expect(view()).toBe(initialView);
    expect(initialView.state.readOnly).toBe(true);
    expect(ed.selections()).toEqual(selectionBefore);

    initialView.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(ed.getDoc()).toBe(textBefore);
    initialView.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    initialView.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.getDoc()).toBe(textBefore);
    expect(ed.undo()).toBe(false);
    expect(ed.getDoc()).toBe(textBefore);
    expect(ed.redo()).toBe(false);
    expect(ed.getDoc()).toBe(textBefore);
    expect(undoDepth(initialView.state)).toBe(undoBeforeReadOnly);
    expect(redoDepth(initialView.state)).toBe(redoBeforeReadOnly);

    ed.setReadOnly(false);
    expect(view()).toBe(initialView);
    expect(initialView.state.readOnly).toBe(false);
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("base");
    expect(ed.redo()).toBe(true);
    expect(ed.getDoc()).toBe(textBefore);

    initialView.dispatch({ selection: EditorSelection.single(2) });
    initialView.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(ed.getDoc()).toBe("ba\nXse");
  });

  it("consente aggiornamenti programmatici mentre è in sola lettura", () => {
    const { ed, view } = editor();
    ed.setDoc("prima");
    const initialView = view();

    ed.setReadOnly(true);
    ed.syncDoc("seconda");
    expect(ed.getDoc()).toBe("seconda");
    expect(view()).toBe(initialView);
    expect(initialView.state.readOnly).toBe(true);

    ed.setDoc("terza");
    expect(ed.getDoc()).toBe("terza");
    expect(view()).toBe(initialView);
    expect(initialView.state.readOnly).toBe(true);
  });
});

describe("seam del profilo testuale", () => {
  it("monta, sostituisce e rimuove estensioni senza ricostruire la superficie", () => {
    const first = StateField.define({
      create: () => "primo",
      update: (value) => value,
    });
    const second = StateField.define({
      create: () => "secondo",
      update: (value) => value,
    });
    let active: Extension = [];
    const { ed, view } = editor(() => {}, () => active);
    const initialView = view();

    ed.setDoc("prima");
    initialView.dispatch({ selection: EditorSelection.single(2) });
    initialView.dispatch({
      changes: { from: 2, insert: "X" },
      selection: EditorSelection.single(3),
      userEvent: "input.type",
    });
    ed.setTheme("dark");

    const documentBefore = initialView.state.doc;
    const selectionBefore = ed.selections();
    const themeBefore = initialView.state.facet(EditorView.darkTheme);
    expect(themeBefore).toBe(true);

    active = first;
    ed.reconfigure();
    expect(view()).toBe(initialView);
    expect(initialView.state.field(first, false)).toBe("primo");
    expect(ed.getDoc()).toBe("prXima");
    expect(initialView.state.doc).toBe(documentBefore);
    expect(ed.selections()).toEqual(selectionBefore);
    expect(initialView.state.facet(EditorView.darkTheme)).toBe(themeBefore);

    active = second;
    ed.reconfigure();
    expect(view()).toBe(initialView);
    expect(initialView.state.field(first, false)).toBeUndefined();
    expect(initialView.state.field(second, false)).toBe("secondo");
    expect(initialView.state.doc).toBe(documentBefore);
    expect(ed.selections()).toEqual(selectionBefore);

    active = [];
    ed.reconfigure();
    expect(view()).toBe(initialView);
    expect(initialView.state.field(second, false)).toBeUndefined();
    expect(initialView.state.doc).toBe(documentBefore);
    expect(ed.selections()).toEqual(selectionBefore);
    expect(initialView.state.facet(EditorView.darkTheme)).toBe(themeBefore);

    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("prima");
    expect(ed.selections().primary).toEqual({ start: 2, end: 2, text: "" });
    ed.destroy();
  });
});

// Un vault non è fatto solo di note nate qui: ci si sincronizza una cartella
// scritto su Windows, ci si clona un repo, ci si copia dentro l'esportazione di
// un altro programma. CodeMirror spezza su `\r\n` e ricompone su `\n`, quindi
// aprire una di quelle note e battere **un carattere** la riscriveva tutta: un
// diff che tocca ogni riga, cioè una cronologia che non si legge più e un
// conflitto di sync che non ha niente da conflittare (difetto 0207).
describe("un file che va a capo come Windows", () => {
  it("resta com'era anche dopo che lo si è toccato", () => {
    const { ed, view } = editor();
    ed.setDoc("uno\r\ndue\r\ntre\r\n");
    writes(view(), "X");
    expect(
      ed.getDoc(),
      "il file è tornato indietro tutto LF: chi ha cambiato una lettera si \\nritrova un diff che tocca ogni riga",
    ).toBe("Xuno\r\ndue\r\ntre\r\n");
  });

  it("va a capo come lui anche sotto le dita di adesso", () => {
    // La metà che un `replace` all'uscita non avrebbe: dichiarare la forma allo
    // stato vuol dire che il documento **è** fatto di quelle righe, e quindi
    // anche l'a capo che si batte adesso è quello.
    const { ed, view } = editor();
    ed.setDoc("uno\r\ndue\r\n");
    view().dispatch({ selection: EditorSelection.single(3) });
    insertNewlineAndIndent(view());
    expect(
      ed.getDoc(),
      "la riga nuova è nata LF in mezzo a un file CRLF: il file torna misto \\nper mano nostra",
    ).toBe("uno\r\n\r\ndue\r\n");
  });

  it("un file già misto non ne ha una da conservare", () => {
    // E prenderne una lo peggiorerebbe: sotto un separatore CRLF i suoi `\n`
    // solitari smettono di essere righe, cioè cambia come il documento **si
    // legge**, non solo come si riscrive. Meglio la normalizzazione di prima.
    const { ed, view } = editor();
    ed.setDoc("uno\r\ndue\ntre\r\n");
    writes(view(), "X");
    expect(
      ed.getDoc(),
      "un file senza una forma sola se n'è vista imporre una: le sue righe \\nnon sono più quelle che erano",
    ).toBe("Xuno\ndue\ntre\n");
  });

  it("annulla e rifà testo UTF-8 mantenendo CRLF", () => {
    const { ed, view } = editor();
    const initial = "inizio\r\n🙂 café\r\nfine";
    ed.setDoc(initial);
    const at = "inizio\n🙂".length;
    view().dispatch({
      changes: { from: at, insert: " ✓" },
      userEvent: "input.type",
    });

    expect(ed.getDoc()).toBe("inizio\r\n🙂 ✓ café\r\nfine");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe(initial);
    expect(ed.redo()).toBe(true);
    expect(ed.getDoc()).toBe("inizio\r\n🙂 ✓ café\r\nfine");
  });
});

// Il multi-cursore non è una funzione nuova dell'editor: `basicSetup` porta
// `allowMultipleSelections`, il click con Alt e `Mod-d`, quindi l'utente tre
// cursori li ha sempre potuti fare. Ciò che mancava era la facoltà di **dirlo**
// al di là del confine: `selection()` leggeva `state.selection.main` e le altre
// due morivano lì (decisione 0093).
describe("selections", () => {
  it("porta tutte le selezioni, e la primaria non è la prima della lista", () => {
    const { ed, view } = editor();
    ed.setDoc("Kant, Hegel e Fichte");
    // Tre intervalli; la primaria è la terza — come quando la si aggiunge per
    // ultima con Alt-click, che è il caso normale in CodeMirror.
    view().dispatch({
      selection: EditorSelection.create(
        [
          EditorSelection.range(0, 4),
          EditorSelection.range(6, 11),
          EditorSelection.range(14, 20),
        ],
        2,
      ),
    });

    const sel = ed.selections();
    expect(sel.primary.text).toBe("Fichte");
    expect(sel.secondary.map((s) => s.text)).toEqual(["Kant", "Hegel"]);
    expect(sel.primary.start).toBe(14);
    expect(sel.secondary[0].start).toBe(0);
  });

  it("converte in byte UTF-8 ogni estremità, anche quando il testo non è ASCII", () => {
    const { ed, view } = editor();
    // «però» sta in cinque caratteri e sei byte: una conversione fatta a
    // occhio sposterebbe di uno tutte le selezioni dopo la prima.
    ed.setDoc("però e così");
    view().dispatch({
      selection: EditorSelection.create(
        [EditorSelection.range(0, 4), EditorSelection.range(7, 11)],
        0,
      ),
    });

    const sel = ed.selections();
    expect(sel.primary).toEqual({ start: 0, end: 5, text: "però" });
    expect(sel.secondary[0]).toEqual({ start: 8, end: 13, text: "così" });
  });

  it("un cursore solo resta un insieme senza secondarie", () => {
    const { ed, view } = editor();
    ed.setDoc("una nota");
    view().dispatch({ selection: { anchor: 4 } });
    const sel = ed.selections();
    expect(sel.primary).toEqual({ start: 4, end: 4, text: "" });
    expect(sel.secondary).toEqual([]);
  });
  it("mantiene multi-selezione e indice principale in undo/redo", () => {
    const { ed, view } = editor();
    ed.setDoc("abcdef");
    view().dispatch({
      selection: EditorSelection.create(
        [EditorSelection.range(1, 2), EditorSelection.range(4, 5)],
        1,
      ),
    });
    view().dispatch({
      changes: [
        { from: 1, to: 2, insert: "X" },
        { from: 4, to: 5, insert: "Y" },
      ],
      selection: EditorSelection.create(
        [EditorSelection.range(1, 2), EditorSelection.range(4, 5)],
        1,
      ),
      userEvent: "input.type",
    });

    expect(ed.getDoc()).toBe("aXcdYf");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("abcdef");
    expect(view().state.selection.mainIndex).toBe(1);
    expect(view().state.selection.ranges.map((range) => [range.from, range.to])).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(ed.redo()).toBe(true);
    expect(ed.getDoc()).toBe("aXcdYf");
    expect(view().state.selection.mainIndex).toBe(1);
    expect(view().state.selection.ranges.map((range) => [range.from, range.to])).toEqual([
      [1, 2],
      [4, 5],
    ]);
  });
});

describe("smontare un editor", () => {
  // Un riquadro si chiude e gli stacca la radice dal documento. Staccare un
  // nodo non smonta un `EditorView`: i suoi osservatori guardano il **proprio**
  // DOM e la finestra, e non sanno niente di chi sta sopra. Finché il wrapper
  // non esponeva `destroy`, ogni divisione chiusa ne lasciava dietro uno vivo.
  it("porta via la vista dal contenitore", () => {
    const { ed, parent } = editor();
    expect(EditorView.findFromDOM(parent)).not.toBeNull();
    expect(parent.children.length).toBeGreaterThan(0);

    ed.destroy();

    expect(EditorView.findFromDOM(parent)).toBeNull();
    expect(parent.children.length).toBe(0);
  });

  it("e la vista è smontata, non solo staccata", () => {
    // La riga sopra da sola non distingue le due cose, ed è stato **misurato**:
    // un `destroy` scritto come `view.dom.remove()` la fa passare identica. È la
    // differenza che conta — un nodo staccato porta con sé osservatori e
    // ascoltatori ancora vivi — quindi la si guarda per il verso in cui si vede.
    //
    // Una vista smontata non aggiorna più il suo DOM: `update` esce prima di
    // toccarlo. Quindi la si riattacca a mano e le si manda una modifica; se
    // fosse stata solo staccata, il testo comparirebbe.
    const { ed, parent, view } = editor();
    const v = view();
    ed.destroy();

    parent.appendChild(v.dom);
    v.dispatch({ changes: { from: 0, insert: "questo non deve comparire" } });
    expect(v.dom.textContent).not.toContain("questo non deve comparire");
  });

  it("e chi resta non se ne accorge", () => {
    // Due editor come due riquadri sulla stessa nota: chiuderne uno non deve
    // toccare l'altro. È la metà che un `destroy` scritto sul contenitore
    // sbagliato romperebbe, e che nessun'altra prova qui guarda.
    const firstEditor = editor();
    const secondEditor = editor();
    secondEditor.ed.setDoc("resto io");

    firstEditor.ed.destroy();

    expect(secondEditor.ed.getDoc()).toBe("resto io");
    expect(EditorView.findFromDOM(secondEditor.parent)).not.toBeNull();
  });

  it("non emette modifiche dopo la distruzione", () => {
    let emitted = 0;
    const surface = editor(() => {
      emitted += 1;
    });
    surface.ed.setDoc("resto");
    surface.ed.destroy();
    surface.ed.syncDoc("cambiato");
    expect(surface.ed.undo()).toBe(false);
    expect(surface.ed.redo()).toBe(false);
    expect(emitted).toBe(0);
    surface.ed.destroy();
  });
});
