import { describe, expect, it } from "vitest";
import {
  applyOperation,
  invertOperation,
  operationFromText,
  tryApplyOperation,
  validateOperation,
  type TextEdit,
  type TextOperation,
} from "./text-operation";

function operation(before: string, edits: readonly TextEdit[]): TextOperation {
  const delta = edits.reduce(
    (total, item) => total + item.inserted.length - item.deleted.length,
    0,
  );
  return { beforeLength: before.length, afterLength: before.length + delta, edits };
}

describe("TextOperation", () => {
  it("costruisce una patch prefix/suffix applicabile", () => {
    const patch = operationFromText("uno due", "uno nuovo due");
    expect(validateOperation(patch)).toBeNull();
    expect(applyOperation("uno due", patch)).toBe("uno nuovo due");
  });

  it("mantiene offset UTF-16 per emoji e caratteri composti", () => {
    const before = "🙂 café";
    const after = "🙂 ✓ café";
    const patch = operationFromText(before, after);
    expect(patch.edits[0]).toEqual({
      from: "🙂 ".length,
      to: "🙂 ".length,
      deleted: "",
      inserted: "✓ ",
    });
    expect(applyOperation(before, patch)).toBe(after);
    expect(applyOperation(after, invertOperation(patch))).toBe(before);
  });

  it("rifiuta una preimmagine stantia senza mutare il testo", () => {
    const malformed: TextOperation = {
      beforeLength: 2,
      afterLength: 1,
      edits: [{ from: 0, to: 1, deleted: "x", inserted: "" }],
    };
    expect(validateOperation(malformed)).toBeNull();
    expect(() => applyOperation("ab", malformed)).toThrow("preimmagine");
    expect(tryApplyOperation("ab", malformed)).toEqual({
      kind: "invalid",
      reason: "preimmagine non valida",
    });
    expect("ab").toBe("ab");
  });

  it("rifiuta dimensioni e intervalli non validi", () => {
    const malformed: TextOperation = {
      beforeLength: 3,
      afterLength: 4,
      edits: [
        { from: 2, to: 3, deleted: "c", inserted: "XY" },
        { from: 1, to: 1, deleted: "", inserted: "!" },
      ],
    };
    expect(validateOperation(malformed)).toContain("intervalli");
    expect(tryApplyOperation("abc", malformed).kind).toBe("invalid");
  });

  it("applica più modifiche disgiunte e la loro inversa", () => {
    const before = "012345";
    const patch = operation(before, [
      { from: 0, to: 1, deleted: "0", inserted: "A" },
      { from: 5, to: 5, deleted: "", inserted: "B" },
    ]);
    const after = applyOperation(before, patch);
    expect(after).toBe("A1234B5");
    expect(applyOperation(after, invertOperation(patch))).toBe(before);
  });
});
