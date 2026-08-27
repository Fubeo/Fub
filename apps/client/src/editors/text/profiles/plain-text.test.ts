// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTextEngine, TextEngine, type EditorChange } from "../engine";
import { createPlainTextProfile, type PlainTextProfile } from "./plain-text";

interface MountedPlainText {
  engine: TextEngine;
  parent: HTMLElement;
  profile: PlainTextProfile;
  changes: EditorChange[];
  view: () => EditorView;
}

function mounted(): MountedPlainText {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const profile = createPlainTextProfile();
  const changes: EditorChange[] = [];
  const engine = createTextEngine(parent, {
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    extensions: () => profile.extensions(),
    theme: "light",
  });
  return {
    engine,
    parent,
    profile,
    changes,
    view: () => {
      const view = EditorView.findFromDOM(parent);
      if (!view) throw new Error("l'editor non è montato");
      return view;
    },
  };
}

describe("PlainTextProfile", () => {
  it("monta il vero TextEngine e conserva i segni sintattici come testo", () => {
    const { engine, profile, view } = mounted();
    const literal = "[[Nota]] #tag **x**";

    expect(engine).toBeInstanceOf(TextEngine);
    expect(profile.extensions()).toEqual([]);

    engine.setDoc(literal);

    expect(engine.getDoc()).toBe(literal);
    expect(view().state.doc.toString()).toBe(literal);
    expect(view().dom.querySelector("[class*='cm-fub-']")).toBeNull();

    engine.destroy();
  });

  it("lascia all'engine editing, selezione, undo, sync, tema e destroy", () => {
    const { engine, parent, changes, view } = mounted();
    const initialView = view();

    engine.setDoc("base");
    initialView.dispatch({ selection: EditorSelection.range(1, 3) });
    expect(engine.selections().primary).toEqual({ start: 1, end: 3, text: "as" });

    initialView.dispatch({
      changes: { from: 3, insert: "X" },
      selection: EditorSelection.single(4),
      userEvent: "input.type",
    });
    expect(engine.getDoc()).toBe("basXe");
    expect(changes).toHaveLength(1);

    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe("base");
    expect(changes).toHaveLength(2);

    engine.syncDoc("remoto");
    expect(engine.getDoc()).toBe("remoto");
    expect(changes).toHaveLength(2);
    expect(engine.undo()).toBe(false);

    engine.setTheme("dark");
    expect(view()).toBe(initialView);
    expect(initialView.state.facet(EditorView.darkTheme)).toBe(true);
    engine.setTheme("light");
    expect(initialView.state.facet(EditorView.darkTheme)).toBe(false);

    engine.destroy();
    expect(EditorView.findFromDOM(parent)).toBeNull();
    engine.destroy();
  });
});
