import { describe, expect, it } from "vitest";
import { diffLines } from "./compare";

describe("il confronto per righe", () => {
  it("allinea le righe comuni e segna quelle di una parte sola", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "theirs", text: "b" },
      { kind: "mine", text: "B" },
      { kind: "same", text: "c" },
      { kind: "mine", text: "d" },
    ]);
  });

  it("due testi uguali non hanno differenze", () => {
    expect(diffLines("x\ny", "x\ny").every((line) => line.kind === "same")).toBe(true);
  });
});
