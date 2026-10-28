// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { completionStatus, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTextEngine, type TextEngine } from "../engine";
import {
  createFormulaProfile,
  cycleReference,
  formulaReferences,
  operandSlot,
  referenceAt,
  tokenizeFormula,
  type FormulaProfile,
} from "./formula";

function mounted(profile: FormulaProfile): { engine: TextEngine; view: () => EditorView } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const engine = createTextEngine(parent, {
    onChange: () => {},
    onSelectionChange: () => {},
    extensions: () => profile.extensions(),
  });
  return {
    engine,
    view: () => {
      const view = EditorView.findFromDOM(parent);
      if (!view) throw new Error("l'editor non è montato");
      return view;
    },
  };
}

function keydown(view: EditorView, key: string, init: KeyboardEventInit = {}): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
}

async function openPopup(view: EditorView): Promise<void> {
  expect(startCompletion(view)).toBe(true);
  await vi.waitFor(() => {
    expect(completionStatus(view.state)).toBe("active");
    expect(view.dom.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
  });
}

describe("FormulaProfile", () => {
  it("tokenizza operatori, numeri, stringhe, riferimenti A1 e funzioni", () => {
    const tokens = tokenizeFormula('=SUM($A$1:B2)+12.5*"testo"');

    expect(tokens.map((item) => item.kind)).toEqual([
      "operator",
      "function",
      "punctuation",
      "reference",
      "punctuation",
      "operator",
      "number",
      "operator",
      "string",
    ]);
    expect(tokens.filter((item) => item.kind === "reference").map((item) => item.text)).toEqual([
      "$A$1:B2",
    ]);
  });

  it("monta il lessico sul vero TextEngine e conserva la view durante la riconfigurazione", () => {
    const profile = createFormulaProfile();
    const { engine, view } = mounted(profile);
    const initial = view();
    engine.setDoc("=SUM(A1)+12");

    const nodes: string[] = [];
    syntaxTree(initial.state).iterate({
      enter(node) {
        nodes.push(node.name);
      },
    });
    expect(nodes).toEqual(
      expect.arrayContaining(["formulaOperator", "formulaFunction", "formulaReference", "formulaNumber"]),
    );

    const documentBefore = initial.state.doc;
    engine.reconfigure();
    expect(view()).toBe(initial);
    expect(initial.state.doc).toBe(documentBefore);
    engine.destroy();
  });

  it("colora soltanto una formula: un valore semplice resta testo", () => {
    const profile = createFormulaProfile();
    const { engine, view } = mounted(profile);
    const names = (text: string): string[] => {
      engine.setDoc(text);
      const nodes: string[] = [];
      syntaxTree(view().state).iterate({
        enter(node) {
          if (node.name.startsWith("formula")) nodes.push(node.name);
        },
      });
      return nodes;
    };
    expect(names("Voce")).toEqual([]);
    expect(names("12500")).toEqual([]);
    expect(names(" =A1")).toEqual([]);
    expect(names("=A1+Voce")).toEqual(["formulaOperator", "formulaReference", "formulaOperator", "formulaIdentifier"]);
    engine.destroy();
  });

  it("offre completamenti locali e iniettati senza chiamare il callback mentre si digita", async () => {
    const functions = vi.fn(() => ["SUM", "AVERAGE"]);
    const sheets = vi.fn(() => ["Budget 2026"]);
    const names = vi.fn(() => ["taxRate"]);
    const profile = createFormulaProfile({ completions: { functions, sheets, names } });
    const { engine, view } = mounted(profile);
    const initial = view();

    engine.setDoc("=");
    initial.dispatch({ selection: EditorSelection.cursor(initial.state.doc.length) });
    expect(functions).not.toHaveBeenCalled();
    expect(sheets).not.toHaveBeenCalled();
    expect(names).not.toHaveBeenCalled();

    expect(startCompletion(initial)).toBe(true);
    await vi.waitFor(() => {
      expect(functions).toHaveBeenCalledWith("");
      expect(sheets).toHaveBeenCalledWith("");
      expect(names).toHaveBeenCalledWith("");
      expect(currentCompletions(initial.state).map((option) => option.label)).toEqual(
        expect.arrayContaining(["SUM", "AVERAGE", "Budget 2026", "taxRate"]),
      );
    });
    engine.destroy();
  });

  it("non crea una seconda riga e tratta Enter/Escape come decisioni esplicite", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    const profile = createFormulaProfile({ callbacks: { commit, cancel } });
    const { engine, view } = mounted(profile);
    const initial = view();

    engine.setDoc("=A1");
    initial.dispatch({ selection: EditorSelection.cursor(initial.state.doc.length) });
    initial.dispatch({
      changes: { from: initial.state.doc.length, insert: "\n+B2" },
      userEvent: "input.type",
    });
    expect(engine.getDoc()).toBe("=A1+B2");
    expect(engine.getDoc().includes("\n")).toBe(false);

    initial.focus();
    keydown(initial, "Escape");
    expect(cancel).toHaveBeenCalledWith("=A1+B2");

    keydown(initial, "Enter");
    expect(commit).toHaveBeenCalledWith("=A1+B2", "down");
    expect(engine.getDoc()).toBe("=A1+B2");
    engine.destroy();
  });

  it("conserva la single-line per input, paste e composition", () => {
    const profile = createFormulaProfile();
    const { engine, view } = mounted(profile);
    const editor = view();
    engine.setDoc("=A1");
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: "\n+B2" },
      userEvent: "input.type",
    });
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: "\n+C3" },
      userEvent: "input.paste",
    });
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: "\n+D4" },
      userEvent: "input.type.compose",
    });
    expect(engine.getDoc()).toBe("=A1+B2+C3+D4");
    expect(engine.getDoc()).not.toContain("\n");
    engine.destroy();
  });

  it("non riscrive il buffer autorevole durante il sync del profilo single-line", () => {
    const { engine, view } = mounted(createFormulaProfile());
    try {
      engine.setDoc("=A1");
      view().dispatch({ changes: { from: 3, insert: "+B2" }, userEvent: "input.type" });
      engine.syncDoc("=A1+B2\n+C3");
      expect(engine.getDoc()).toBe("=A1+B2\n+C3");
      expect(engine.undo()).toBe(true);
      expect(engine.getDoc()).toBe("=A1\n+C3");
      expect(engine.redo()).toBe(true);
      expect(engine.getDoc()).toBe("=A1+B2\n+C3");
    } finally {
      engine.destroy();
    }
  });

  it("può disabilitare la politica single-line senza cambiare il completamento o le decisioni", () => {
    const commit = vi.fn();
    const profile = createFormulaProfile({ singleLine: false, onCommit: commit });
    const { engine, view } = mounted(profile);
    const initial = view();
    engine.setDoc("=A1");
    initial.dispatch({
      changes: { from: initial.state.doc.length, insert: "\n+B2" },
      userEvent: "input.type",
    });
    expect(engine.getDoc()).toBe("=A1\n+B2");

    initial.focus();
    keydown(initial, "Enter");
    expect(commit).toHaveBeenCalledWith("=A1\n+B2", "down");
    engine.destroy();
  });

  it("usa Enter per accettare un completamento dal popup prima del commit", async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const profile = createFormulaProfile({ completions: { functions: ["SUM"] }, onCommit: commit });
    const { engine, view } = mounted(profile);
    const editor = view();
    try {
      engine.setDoc("=SU");
      editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });
      editor.focus();

      await openPopup(editor);
      vi.advanceTimersByTime(76);
      keydown(editor, "Enter");
      expect(engine.getDoc()).toBe("=SUM");
      expect(commit).not.toHaveBeenCalled();
      expect(completionStatus(editor.state)).toBeNull();
      expect(editor.dom.querySelector(".cm-tooltip-autocomplete")).toBeNull();
      keydown(editor, "Enter");
      expect(commit).toHaveBeenCalledWith("=SUM", "down");
    } finally {
      engine.destroy();
      vi.useRealTimers();
    }
  });

  it("non committa un completamento ancora nel ritardo di interazione", async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const profile = createFormulaProfile({ completions: { functions: ["SUM"] }, onCommit: commit });
    const { engine, view } = mounted(profile);
    const editor = view();
    try {
      engine.setDoc("=SU");
      editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });
      editor.focus();

      await openPopup(editor);
      keydown(editor, "Enter");
      expect(engine.getDoc()).toBe("=SU");
      expect(commit).not.toHaveBeenCalled();
      expect(completionStatus(editor.state)).toBe("active");
      expect(editor.dom.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
    } finally {
      engine.destroy();
      vi.useRealTimers();
    }
  });

  it("Escape chiude il popup prima di eseguire cancel", async () => {
    let editor: EditorView | null = null;
    const cancel = vi.fn((value: string) => {
      expect(value).toBe("=SU");
      expect(editor && completionStatus(editor.state)).toBeNull();
    });
    const profile = createFormulaProfile({ completions: { functions: ["SUM"] }, onCancel: cancel });
    const { engine, view } = mounted(profile);
    editor = view();
    engine.setDoc("=SU");
    editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });
    editor.focus();
    await openPopup(editor);

    keydown(editor, "Escape");
    expect(completionStatus(editor.state)).toBeNull();
    expect(editor.dom.querySelector(".cm-tooltip-autocomplete")).toBeNull();
    expect(cancel).toHaveBeenCalledWith("=SU");
    engine.destroy();
  });

  it("Shift-Enter chiude il popup senza lasciare una completion stantia", async () => {
    let editor: EditorView | null = null;
    const commit = vi.fn((value: string) => {
      expect(value).toBe("=SU");
      expect(editor && completionStatus(editor.state)).toBeNull();
    });
    const profile = createFormulaProfile({ completions: { functions: ["SUM"] }, onCommit: commit });
    const { engine, view } = mounted(profile);
    editor = view();
    engine.setDoc("=SU");
    editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });
    editor.focus();
    await openPopup(editor);

    keydown(editor, "Enter", { shiftKey: true });
    expect(engine.getDoc()).toBe("=SU");
    expect(completionStatus(editor.state)).toBeNull();
    expect(editor.dom.querySelector(".cm-tooltip-autocomplete")).toBeNull();
    expect(commit).toHaveBeenCalledWith("=SU", "up");
    engine.destroy();
  });

  it("Tab arbitra il popup e non indenta il testo formula", async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const profile = createFormulaProfile({ completions: { functions: ["SUM"] }, onCommit: commit });
    const { engine, view } = mounted(profile);
    const editor = view();
    try {
      engine.setDoc("=SU");
      editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });
      editor.focus();
      await openPopup(editor);

      keydown(editor, "Tab");
      expect(engine.getDoc()).toBe("=SU");
      expect(engine.getDoc()).not.toContain("\t");
      expect(completionStatus(editor.state)).toBe("active");

      vi.advanceTimersByTime(76);
      keydown(editor, "Tab");
      expect(engine.getDoc()).toBe("=SUM");
      expect(engine.getDoc()).not.toContain("\t");
      expect(completionStatus(editor.state)).toBeNull();
      expect(editor.dom.querySelector(".cm-tooltip-autocomplete")).toBeNull();
      expect(commit).not.toHaveBeenCalled();
    } finally {
      engine.destroy();
      vi.useRealTimers();
    }
  });

  it("Tab e Maiusc+Tab confermano di lato, Ctrl+Invio riempie, Alt+Invio va a capo", () => {
    const commit = vi.fn();
    const profile = createFormulaProfile({ singleLine: false, onCommit: commit });
    const { engine, view } = mounted(profile);
    const editor = view();
    try {
      engine.setDoc("riga");
      editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });
      editor.focus();
      keydown(editor, "Tab");
      expect(commit).toHaveBeenLastCalledWith("riga", "right");
      keydown(editor, "Tab", { shiftKey: true });
      expect(commit).toHaveBeenLastCalledWith("riga", "left");
      keydown(editor, "Enter", { ctrlKey: true });
      expect(commit).toHaveBeenLastCalledWith("riga", "fill");
      expect(engine.getDoc()).not.toContain("\t");
      keydown(editor, "Enter", { altKey: true });
      expect(engine.getDoc()).toBe("riga\n");
      expect(commit).toHaveBeenCalledTimes(3);
    } finally {
      engine.destroy();
    }
  });

  it("le frecce confermano soltanto in «Inserisci», e F2 alterna il modo", () => {
    const commit = vi.fn();
    let insert = true;
    const toggleMode = vi.fn(() => {
      insert = !insert;
    });
    const profile = createFormulaProfile({
      callbacks: { commit, cancel: () => {}, arrowsCommit: () => insert, toggleMode },
    });
    const { engine, view } = mounted(profile);
    const editor = view();
    try {
      engine.setDoc("7");
      editor.dispatch({ selection: EditorSelection.cursor(1) });
      editor.focus();
      keydown(editor, "ArrowDown");
      expect(commit).toHaveBeenLastCalledWith("7", "down", true);
      keydown(editor, "F2");
      expect(toggleMode).toHaveBeenCalledTimes(1);
      keydown(editor, "ArrowLeft");
      expect(commit).toHaveBeenCalledTimes(1);
      expect(editor.state.selection.main.head).toBe(0);
    } finally {
      engine.destroy();
    }
  });
});

describe("le formule col puntatore", () => {
  it("trova dove va un operando", () => {
    expect(operandSlot("=", 1)).toEqual({ from: 1, to: 1 });
    expect(operandSlot("=1+", 3)).toEqual({ from: 3, to: 3 });
    expect(operandSlot("=SUM(", 5)).toEqual({ from: 5, to: 5 });
    expect(operandSlot("=SUM(A1;", 8)).toEqual({ from: 8, to: 8 });
    expect(operandSlot("=SUM()", 5)).toEqual({ from: 5, to: 5 });
    expect(operandSlot("=1+*2", 3)).toEqual({ from: 3, to: 3 });
    // Dopo un operando, dentro un token, in un testo o fuori da una formula no.
    expect(operandSlot("=1", 2)).toBeNull();
    expect(operandSlot("=A1", 3)).toBeNull();
    expect(operandSlot("=A1+B2", 2)).toBeNull();
    expect(operandSlot("=1+2", 3)).toBeNull();
    expect(operandSlot('="a+', 4)).toBeNull();
    expect(operandSlot("1+", 2)).toBeNull();
    expect(operandSlot("=", 0)).toBeNull();
  });

  it("F4 alterna i $ di ogni capo, col foglio davanti", () => {
    expect(cycleReference("A1")).toBe("$A$1");
    expect(cycleReference("$A$1")).toBe("A$1");
    expect(cycleReference("A$1")).toBe("$A1");
    expect(cycleReference("$A1")).toBe("A1");
    expect(cycleReference("B2:C3")).toBe("$B$2:$C$3");
    expect(cycleReference("'Il foglio'!B2")).toBe("'Il foglio'!$B$2");
    expect(referenceAt("=1+B2*3", 5)?.text).toBe("B2");
    expect(referenceAt("=1+B2*3", 6)).toBeNull();
  });

  it("dà a ogni riferimento il suo colore, lo stesso allo stesso", () => {
    const references = formulaReferences("=A1+$B$2*a1+C3:D4");
    expect(references.map((reference) => [reference.text, reference.color])).toEqual([
      ["A1", 0],
      ["$B$2", 1],
      ["a1", 0],
      ["C3:D4", 2],
    ]);
    expect(formulaReferences("A1")).toEqual([]);
  });

  it("F4 nell'editor cambia il riferimento al cursore, e le frecce puntano dove serve", () => {
    const pointed: string[] = [];
    const { engine, view } = mounted(createFormulaProfile({
      callbacks: {
        arrowsCommit: () => true,
        point: (move, extend) => {
          pointed.push(`${move}${extend ? "+" : ""}`);
          return true;
        },
        commit: () => pointed.push("commit"),
      },
    }));
    engine.setDoc("=1+B2");
    const editor = view();
    editor.dispatch({ selection: { anchor: 5 } });
    keydown(editor, "F4");
    expect(editor.state.doc.toString()).toBe("=1+$B$2");
    expect(editor.state.selection.main.head).toBe(7);
    expect(editor.dom.querySelectorAll(".cm-formula-ref-1")).toHaveLength(1);
    keydown(editor, "ArrowDown");
    keydown(editor, "ArrowRight", { shiftKey: true });
    expect(pointed).toEqual(["down", "right+"]);
    engine.destroy();
  });
});
