import { describe, expect, it } from "vitest";
import {
  applyOperation,
  commonEnds,
  invertOperation,
  operationFromText,
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

/** Common ends unit by unit, the definition `commonEnds` must match. */
function naiveEnds(a: string, b: string): [number, number] {
  const minimum = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < minimum && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < minimum - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  return [prefix, suffix];
}

describe("commonEnds", () => {
  it("trova gli stessi bordi comuni dello scorrere unità per unità, attraverso i blocchi", () => {
    let seed = 0x2545f491;
    const next = (bound: number): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % bound;
    };
    // Testi lunghi qualche blocco, ripetitivi perché i bordi si possano
    // sovrapporre, con una modifica in un punto qualunque.
    const alphabet = ["a", "b", "\n", "é", "🙂"];
    for (let round = 0; round < 300; round++) {
      let base = "";
      const length = next(5000);
      while (base.length < length) base += alphabet[next(round % 3 === 0 ? 1 : alphabet.length)]!;
      const at = next(base.length + 1);
      const cut = Math.min(base.length, at + next(40));
      const inserted = round % 4 === 0 ? "" : alphabet[next(alphabet.length)]!.repeat(next(3000));
      const other = base.slice(0, at) + inserted + base.slice(cut);
      expect(commonEnds(base, other), `giro ${round}`).toEqual(naiveEnds(base, other));
      expect(commonEnds(other, base), `giro ${round}`).toEqual(naiveEnds(other, base));
    }
    expect(commonEnds("", "")).toEqual([0, 0]);
    expect(commonEnds("a".repeat(3000), "a".repeat(5000))).toEqual([3000, 0]);
    expect(commonEnds("x" + "a".repeat(3000), "a".repeat(3000))).toEqual([0, 3000]);
  });
});

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
