import { describe, expect, it } from "vitest";
import { selectionSetOf } from "./registry";

describe("le selezioni pubblicate da un riquadro", () => {
  const text = {
    selections: () => ({
      primary: { start: 4, end: 9, text: "testo" },
      secondary: [{ start: 0, end: 0, text: "" }],
    }),
  };

  it("un testo pubblica intervalli, ancorati solo a buffer pulito", () => {
    expect(selectionSetOf(text, false)).toEqual({
      kind: "anchored",
      value: {
        primary: { span: { start: 4, end: 9 }, text: "testo" },
        secondary: [{ span: { start: 0, end: 0 }, text: "" }],
      },
    });
    expect(selectionSetOf(text, true)).toEqual({
      kind: "floating",
      value: { primary: { text: "testo" }, secondary: [{ text: "" }] },
    });
  });

  it("una superficie strutturata pubblica il testo degli elementi, sempre senza coordinate", () => {
    const cards = { selectedText: () => ({ primary: "Carta due", secondary: ["Carta uno"] }) };
    const floating = {
      kind: "floating",
      value: { primary: { text: "Carta due" }, secondary: [{ text: "Carta uno" }] },
    };
    expect(selectionSetOf(cards, false)).toEqual(floating);
    expect(selectionSetOf(cards, true)).toEqual(floating);
    expect(selectionSetOf({ selectedText: () => null }, false)).toBeNull();
    expect(selectionSetOf({}, false)).toBeNull();
    expect(selectionSetOf(undefined, false)).toBeNull();
  });
});
