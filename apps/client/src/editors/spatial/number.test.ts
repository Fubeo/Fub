import { describe, expect, it } from "vitest";
import { decimalFactor, formatNumber, formatScaled, formatShortest, MAX_DECIMALS, roundHalfUp } from "./number";

describe("numeri dei disegni (§7)", () => {
  it("arrotonda con floor(v × 10ⁿ + 0,5): i mezzi vanno verso l'alto, anche sotto zero", () => {
    expect(roundHalfUp(1.5, 1)).toBe(2);
    expect(roundHalfUp(2.5, 1)).toBe(3);
    expect(roundHalfUp(-1.5, 1)).toBe(-1);
    expect(roundHalfUp(-2.5, 1)).toBe(-2);
    expect(roundHalfUp(-2.51, 1)).toBe(-3);
    expect(roundHalfUp(120.5, 100)).toBe(12050);
    expect(roundHalfUp(0.125, 100)).toBe(13);
    expect(roundHalfUp(-0.125, 100)).toBe(-12);
  });

  it("non restituisce mai -0", () => {
    expect(Object.is(roundHalfUp(-0.004, 100), 0)).toBe(true);
    expect(Object.is(roundHalfUp(-0, 100), 0)).toBe(true);
    expect(formatNumber(-0.004, 2)).toBe("0");
    expect(formatNumber(-0, 2)).toBe("0");
  });

  it("scrive senza zeri finali, senza esponente e con lo zero prima del punto", () => {
    expect(formatScaled(12050, 2)).toBe("120.5");
    expect(formatScaled(12000, 2)).toBe("120");
    expect(formatScaled(-3, 2)).toBe("-0.03");
    expect(formatScaled(5, 4)).toBe("0.0005");
    expect(formatScaled(0, 2)).toBe("0");
    expect(formatScaled(7, 0)).toBe("7");
    expect(formatNumber(1e-7, 4)).toBe("0");
    expect(formatNumber(0.00005, 4)).toBe("0.0001");
    expect(formatNumber(1.005, 2)).toBe("1");
    expect(formatNumber(-12.345, 2)).toBe("-12.34");
    expect(formatNumber(1 / 3, 4)).toBe("0.3333");
  });

  it("scrive tutte le cifre anche oltre 10²¹, dove String passa all'esponente", () => {
    expect(formatScaled(1e21, 0)).toBe("1000000000000000000000");
    expect(formatScaled(-1e21, 2)).toBe("-10000000000000000000");
    // 1e22 × 100 non è un double esatto: le cifre sono quelle del double
    // più vicino, le stesse in ogni motore e in Rust.
    expect(formatNumber(1e22, 2)).toBe("9999999999999999832227.84");
    expect(formatScaled(Number.MAX_SAFE_INTEGER, 2)).toBe("90071992547409.91");
  });

  it("rifiuta i non interi, i non finiti e i decimali fuori da 0…4", () => {
    expect(MAX_DECIMALS).toBe(4);
    expect(decimalFactor(4)).toBe(10_000);
    expect(() => decimalFactor(5)).toThrow(RangeError);
    expect(() => decimalFactor(-1)).toThrow(RangeError);
    expect(() => decimalFactor(1.5)).toThrow(RangeError);
    expect(() => formatScaled(1.5, 2)).toThrow(RangeError);
    expect(() => formatScaled(Number.NaN, 2)).toThrow(RangeError);
    expect(() => formatNumber(Number.POSITIVE_INFINITY, 2)).toThrow(RangeError);
  });

  it("formatShortest scrive il numero più corto che si rilegge identico, senza esponente", () => {
    expect(formatShortest(0.5)).toBe("0.5");
    expect(formatShortest(-0)).toBe("0");
    expect(formatShortest(16)).toBe("16");
    expect(formatShortest(1e-7)).toBe("0.0000001");
    expect(formatShortest(-1.5e-7)).toBe("-0.00000015");
    expect(formatShortest(1e21)).toBe("1000000000000000000000");
    expect(formatShortest(1.25e22)).toBe("12500000000000000000000");
    expect(formatShortest(0.1 + 0.2)).toBe("0.30000000000000004");
    for (const value of [1e-7, 2.5e-10, 1.2345e25, -3e-9, 0.1 + 0.2, 123.456, 5e-324, Number.MAX_VALUE]) {
      const text = formatShortest(value);
      expect(text).not.toMatch(/e/i);
      expect(Number(text)).toBe(value);
    }
    expect(() => formatShortest(Number.NaN)).toThrow(RangeError);
  });
});
