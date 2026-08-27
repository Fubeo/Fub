// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTextEngine, type TextEngine } from "../engine";
import {
  createFormulaProfile,
  formulaKeyBindings,
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
    const bindings = formulaKeyBindings({ callbacks: { commit, cancel } });
    const escape = bindings.find((binding) => binding.key === "Escape");
    const enter = bindings.find((binding) => binding.key === "Enter");
    if (!escape?.run || !enter?.run) throw new Error("i comandi formula non sono montati");
    expect(escape.run(initial)).toBe(true);
    expect(cancel).toHaveBeenCalledWith("=A1+B2");

    expect(enter.run(initial)).toBe(true);
    expect(commit).toHaveBeenCalledWith("=A1+B2");
    expect(engine.getDoc()).toBe("=A1+B2");
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
    const enter = formulaKeyBindings({ onCommit: commit }).find((binding) => binding.key === "Enter");
    if (!enter?.run) throw new Error("il comando Enter non è montato");
    expect(enter.run(initial)).toBe(true);
    expect(commit).toHaveBeenCalledWith("=A1\n+B2");
    engine.destroy();
  });
});
