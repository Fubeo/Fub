import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { renumberLists } from "./renumber";

// La rinumerazione dopo una cancellazione o uno spostamento (D4).

const after = (doc: string, from: number, to: number, insert = "", userEvent = "delete.backward") => {
  const state = EditorState.create({ doc, extensions: renumberLists });
  return state.update({ changes: { from, to, insert }, userEvent }).state.doc.toString();
};

describe("rinumerare gli elenchi", () => {
  it("togliere una voce rinumera quelle che seguono", () => {
    const doc = "1. a\n2. b\n3. c\n4. d";
    expect(after(doc, doc.indexOf("2."), doc.indexOf("3."))).toBe("1. a\n2. c\n3. d");
  });

  it("tiene il numero d'inizio e il delimitatore", () => {
    const doc = "3) a\n4) b\n5) c";
    expect(after(doc, 0, doc.indexOf("4)"))).toBe("3) b\n4) c");
  });

  it("i sottoelenchi contano per conto loro", () => {
    const doc = "1. a\n   1. x\n   2. y\n2. b\n3. c";
    expect(after(doc, doc.indexOf("2. b"), doc.indexOf("3. c"))).toBe("1. a\n   1. x\n   2. y\n2. c");
    expect(after(doc, doc.indexOf("   1. x"), doc.indexOf("   2. y"))).toBe("1. a\n   1. y\n2. b\n3. c");
  });

  it("uno spostamento rinumera; una battuta no", () => {
    expect(after("1. b\n2. a", 0, 9, "2. a\n1. b", "move.line")).toBe("1. a\n2. b");
    expect(after("1. a\n2. b", 9, 9, "x", "input.type")).toBe("1. a\n2. bx");
  });

  it("tocca soltanto le cifre che cambiano, anche in una citazione", () => {
    const state = EditorState.create({ doc: "> 1. a\n> 2. b\n> 3. c", extensions: renumberLists });
    const tr = state.update({ changes: { from: 7, to: 14 }, userEvent: "delete.backward" });
    expect(tr.state.doc.toString()).toBe("> 1. a\n> 2. c");
  });
});
