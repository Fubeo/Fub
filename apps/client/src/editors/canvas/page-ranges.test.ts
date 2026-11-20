import { describe, expect, it } from "vitest";
import { parsePageRanges } from "./page-ranges";

describe("parsePageRanges (T72)", () => {
  it("il campo vuoto vuol dire tutte le pagine", () => {
    expect(parsePageRanges("", 4)).toEqual({ ok: true, pages: [1, 2, 3, 4], cut: false });
    expect(parsePageRanges("   ", 1)).toEqual({ ok: true, pages: [1], cut: false });
  });

  it("legge pagine singole e intervalli, in ordine e senza doppi", () => {
    expect(parsePageRanges("3-7, 9", 24)).toEqual({ ok: true, pages: [3, 4, 5, 6, 7, 9], cut: false });
    expect(parsePageRanges("9, 3-5, 4", 24)).toEqual({ ok: true, pages: [3, 4, 5, 9], cut: false });
    expect(parsePageRanges("5-5", 24)).toEqual({ ok: true, pages: [5], cut: false });
  });

  it("il trattino può essere un «–», e gli spazi non contano", () => {
    expect(parsePageRanges("3–5 ,  8 - 9", 24)).toEqual({ ok: true, pages: [3, 4, 5, 8, 9], cut: false });
  });

  it("«20-» arriva fino all'ultima pagina, senza dire che è un taglio", () => {
    expect(parsePageRanges("20-", 24)).toEqual({ ok: true, pages: [20, 21, 22, 23, 24], cut: false });
  });

  it("un intervallo oltre l'ultima pagina si taglia, e si dice", () => {
    expect(parsePageRanges("20-40", 24)).toEqual({ ok: true, pages: [20, 21, 22, 23, 24], cut: true });
    expect(parsePageRanges("2, 30", 24)).toEqual({ ok: true, pages: [2], cut: true });
  });

  it("una pagina che non c'è, da sola, dà nessuna pagina", () => {
    expect(parsePageRanges("30", 24)).toEqual({ ok: false, bad: null });
    expect(parsePageRanges("30-40", 24)).toEqual({ ok: false, bad: null });
  });

  it("un pezzo che non si legge dice quale è", () => {
    expect(parsePageRanges("3-7, x", 24)).toEqual({ ok: false, bad: "x" });
    expect(parsePageRanges("0", 24)).toEqual({ ok: false, bad: "0" });
    expect(parsePageRanges("7-3", 24)).toEqual({ ok: false, bad: "7-3" });
    expect(parsePageRanges("-5", 24)).toEqual({ ok: false, bad: "-5" });
    expect(parsePageRanges("1 2", 24)).toEqual({ ok: false, bad: "1 2" });
  });

  it("un numero enorme si tratta come oltre la fine, senza scorrere le pagine", () => {
    expect(parsePageRanges("1-99999999999999999999", 3)).toEqual({ ok: true, pages: [1, 2, 3], cut: true });
  });

  it("senza pagine (count non valido) non dà niente", () => {
    expect(parsePageRanges("1", 0)).toEqual({ ok: false, bad: null });
  });
});
