// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { completionStatus, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTextEngine, type TextEngine } from "../engine";
import {
  createFormulaProfile,
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
    expect(commit).toHaveBeenCalledWith("=A1+B2");
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
    expect(commit).toHaveBeenCalledWith("=A1\n+B2");
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
      expect(commit).toHaveBeenCalledWith("=SUM");
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
    expect(commit).toHaveBeenCalledWith("=SU");
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
});
