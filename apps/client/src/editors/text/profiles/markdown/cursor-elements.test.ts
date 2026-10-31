import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { cursorElements, mainElements } from "./cursor-elements";

function state(doc: string, ranges: readonly [number, number?][], main = ranges.length - 1) {
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([anchor, head]) => EditorSelection.range(anchor, head ?? anchor)), main),
    extensions: [markdown({ base: markdownGrammar }), EditorState.allowMultipleSelections.of(true), cursorElements],
  });
}
const names = (set: ReadonlySet<string>) => [...set].sort();

describe("gli elementi del cursore", () => {
  it("dentro un corsivo in un grassetto sono premuti tutti e due", () => {
    expect(names(mainElements(state("a **b *c* d** e", [[7]])))).toEqual(["em", "strong"]);
  });

  it("le due fermate al bordo: prima dei segni dentro, dopo fuori", () => {
    const doc = "a **treno** b";
    expect(names(mainElements(state(doc, [[9]])))).toEqual(["strong"]);
    expect(names(mainElements(state(doc, [[11]])))).toEqual([]);
    expect(names(mainElements(state(doc, [[4]])))).toEqual(["strong"]);
    expect(names(mainElements(state(doc, [[2]])))).toEqual([]);
  });

  it("una selezione è in grassetto soltanto se lo è tutta", () => {
    const doc = "a **treno** b";
    expect(names(mainElements(state(doc, [[4, 9]])))).toEqual(["strong"]);
    expect(names(mainElements(state(doc, [[0, 9]])))).toEqual([]);
  });

  it("apice, pedice, codice, evidenziato, formula e wikilink", () => {
    expect(names(mainElements(state("mc^22^ x", [[4]])))).toEqual(["sup"]);
    expect(names(mainElements(state("H~22~O", [[3]])))).toEqual(["sub"]);
    expect(names(mainElements(state("a `cc` b", [[4]])))).toEqual(["code"]);
    expect(names(mainElements(state("a ==hh== b", [[5]])))).toEqual(["highlight"]);
    expect(names(mainElements(state("a $x+y$ b", [[4]])))).toEqual(["math"]);
    expect(names(mainElements(state("a [[Nota]] b", [[5]])))).toEqual(["wikilink"]);
  });

  it("ogni cursore ha il suo stato, e il principale è quello della barra", () => {
    const current = state("**a** e *b*", [[2], [9]]);
    expect(current.field(cursorElements).map(names)).toEqual([["strong"], ["em"]]);
    expect(names(mainElements(current))).toEqual(["em"]);
  });
});
