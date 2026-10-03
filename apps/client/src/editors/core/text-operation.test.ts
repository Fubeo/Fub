import { describe, expect, it } from "vitest";
import {
  applyOperation,
  commonPrefixLength,
  commonSuffixLength,
  invertOperation,
  operationFromText,
  operationYields,
  rebaseStaleChange,
  transformPair,
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

describe("rebaseStaleChange", () => {
  // Una superficie rimasta indietro: partita da `started`, ha battuto la sua
  // modifica mentre la sessione era già andata a `authoritative`.
  function staleChange(started: string, typed: string): { text: string; operation: TextOperation } {
    return { text: typed, operation: operationFromText(started, typed) };
  }

  it("compone due modifiche disgiunte invece di scartare la battuta", () => {
    const started = "uno due tre";
    const change = staleChange(started, "uno due tre!");
    const rebased = rebaseStaleChange("UNO due tre", change);
    expect(rebased?.text).toBe("UNO due tre!");
    expect(applyOperation("UNO due tre", rebased!.operation)).toBe("UNO due tre!");
    // Il recupero porta la superficie dal suo testo al testo fuso.
    expect(applyOperation(change.text, rebased!.catchUp)).toBe("UNO due tre!");
  });

  it("restituisce null se le due modifiche toccano lo stesso punto", () => {
    const change = staleChange("uno due tre", "uno DUE tre");
    expect(rebaseStaleChange("uno 2 tre", change)).toBeNull();
    // Due inserimenti nello stesso punto non hanno un ordine stabile.
    expect(rebaseStaleChange("uno due treX", staleChange("uno due tre", "uno due treY"))).toBeNull();
  });

  it("restituisce null se l'operazione non si inverte sul testo della superficie", () => {
    const change = { text: "abc", operation: operationFromText("xyz", "xyzw") };
    expect(rebaseStaleChange("abc", change)).toBeNull();
  });

  it("conserva il separatore CRLF della superficie", () => {
    // L'operazione vive sul testo normalizzato; il testo porta il CRLF.
    const change = { text: "a\r\nb!", operation: operationFromText("a\nb", "a\nb!") };
    const rebased = rebaseStaleChange("A\r\nb", change);
    expect(rebased?.text).toBe("A\r\nb!");
    expect(applyOperation("A\nb", rebased!.operation)).toBe("A\nb!");
    expect(applyOperation("a\nb!", rebased!.catchUp)).toBe("A\nb!");
  });

  it("un inserimento in testa e uno in coda si compongono", () => {
    const change = staleChange("uno", "uno due");
    const rebased = rebaseStaleChange("zero uno", change);
    expect(rebased?.text).toBe("zero uno due");
  });
});

describe("transformPair", () => {
  it("sposta ciascuna modifica oltre l'altra quando sono disgiunte", () => {
    const base = "0123456789";
    const left = operation(base, [{ from: 1, to: 2, deleted: "1", inserted: "AA" }]);
    const right = operation(base, [{ from: 8, to: 8, deleted: "", inserted: "B" }]);
    const pair = transformPair(left, right);
    expect(pair).not.toBeNull();
    const [leftAfterRight, rightAfterLeft] = pair!;
    expect(applyOperation(applyOperation(base, right), leftAfterRight)).toBe(
      applyOperation(applyOperation(base, left), rightAfterLeft),
    );
  });

  it("rifiuta preimmagini di lunghezza diversa e intervalli sovrapposti", () => {
    const left = operation("abcd", [{ from: 1, to: 3, deleted: "bc", inserted: "" }]);
    expect(transformPair(left, operation("abc", []))).toBeNull();
    expect(transformPair(left, operation("abcd", [{ from: 2, to: 4, deleted: "cd", inserted: "x" }]))).toBeNull();
  });
});

describe("commonPrefixLength e commonSuffixLength", () => {
  const naivePrefix = (a: string, b: string, limit: number): number => {
    let n = 0;
    while (n < limit && a.charCodeAt(n) === b.charCodeAt(n)) n += 1;
    return n;
  };
  const naiveSuffix = (a: string, b: string, limit: number): number => {
    let n = 0;
    while (n < limit && a.charCodeAt(a.length - 1 - n) === b.charCodeAt(b.length - 1 - n)) n += 1;
    return n;
  };
  /// Mulberry32, perché i casi si ripetano uguali.
  const random = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
      t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    };
  };

  it("trovano la prima differenza ai bordi delle fette confrontate", () => {
    // Le fette raddoppiano da 256 unità e la ricerca scende a 64: la
    // differenza cade prima, sopra e dopo ogni bordo.
    const base = "a".repeat(5_000);
    for (const at of [0, 1, 63, 64, 65, 255, 256, 257, 767, 768, 769, 1_791, 1_792, 4_999]) {
      const changed = `${base.slice(0, at)}b${base.slice(at + 1)}`;
      expect(commonPrefixLength(base, changed, base.length)).toBe(at);
      expect(commonSuffixLength(base, changed, base.length)).toBe(base.length - 1 - at);
    }
    expect(commonPrefixLength(base, base, base.length)).toBe(base.length);
    expect(commonPrefixLength(base, base, 1_000)).toBe(1_000);
    expect(commonSuffixLength(base, `${base}x`, base.length)).toBe(0);
    expect(commonPrefixLength("", "", 0)).toBe(0);
  });

  it("danno quello che dà il confronto unità per unità", () => {
    const next = random(0x7e57);
    const alphabet = ["a", "b", "\n", "é", "✓", "🙂"];
    const word = (length: number): string => {
      let out = "";
      while (out.length < length) out += alphabet[Math.floor(next() * alphabet.length)];
      return out;
    };
    for (let i = 0; i < 300; i++) {
      const shared = word(Math.floor(next() * 3_000));
      const tail = word(Math.floor(next() * 3_000));
      const a = `${shared}${word(Math.floor(next() * 40))}${tail}`;
      const b = `${shared}${word(Math.floor(next() * 40))}${tail}`;
      const minimum = Math.min(a.length, b.length);
      const prefix = commonPrefixLength(a, b, minimum);
      expect(prefix).toBe(naivePrefix(a, b, minimum));
      expect(commonSuffixLength(a, b, minimum - prefix)).toBe(naiveSuffix(a, b, minimum - prefix));
      const patch = operationFromText(a, b);
      expect(applyOperation(a, patch)).toBe(b);
    }
  });
});

describe("operationYields", () => {
  it("risponde come applicare e confrontare, senza costruire il testo", () => {
    const before = "uno due tre";
    const patch = operation(before, [
      { from: 0, to: 3, deleted: "uno", inserted: "1" },
      { from: 8, to: 8, deleted: "", inserted: "e " },
    ]);
    const cases: Array<readonly [string, TextOperation, string]> = [
      [before, patch, applyOperation(before, patch)],
      [before, patch, "1 due e trE"],
      [before, patch, "1 due e tre!"],
      ["uno due trE", patch, "1 due e trE"],
      ["UNO due tre", patch, "1 due e tre"],
      ["uno due tre!", patch, "1 due e tre!"],
      [before, { ...patch, afterLength: patch.afterLength + 1 }, "1 due e tre"],
      [before, operation(before, []), before],
      [before, operation(before, []), "uno due trE"],
    ];
    for (const [from, op, to] of cases) {
      const applied = tryApplyOperation(from, op);
      expect(operationYields(from, op, to)).toBe(applied.kind === "applied" && applied.text === to);
    }
  });
});
