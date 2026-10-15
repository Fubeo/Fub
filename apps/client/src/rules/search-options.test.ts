import { describe, expect, it } from "vitest";
import { parseSearch } from "./search-syntax";
import { applyOptions, NO_OPTIONS, queryText, replaceableText, type SearchOptions } from "./search-options";

const expr = (input: string) => {
  const parsed = parseSearch(input, true);
  if ("fault" in parsed) throw new Error(parsed.fault.kind);
  return parsed.ok;
};
const on = (patch: Partial<SearchOptions>): SearchOptions => ({ ...NO_OPTIONS, ...patch });
const firstText = (e: ReturnType<typeof expr>) => {
  const predicate = e.any[0]!.all[0]!.predicate;
  if (predicate.kind !== "text") throw new Error("non è testo");
  return predicate;
};

describe("la riga della ricerca con le opzioni", () => {
  it("senza espressione regolare la riga resta com'è, senza spazi ai bordi", () => {
    expect(queryText("  gatto  ", NO_OPTIONS)).toBe("gatto");
  });
  it("con l'espressione regolare la riga è il modello, e le barre si proteggono", () => {
    expect(queryText("a/b+", on({ regex: true }))).toBe("/a\\/b+/");
    const parsed = expr(queryText("a/b+", on({ regex: true })));
    expect(parsed.any[0]!.all[0]!.predicate).toMatchObject({ kind: "regex", pattern: "a/b+" });
  });
  it("una riga vuota resta vuota anche con l'espressione regolare", () => {
    expect(queryText("   ", on({ regex: true }))).toBe("");
  });
});

describe("le opzioni sui predicati di testo", () => {
  it("senza opzioni l'espressione è la stessa", () => {
    const e = expr("gatto");
    expect(applyOptions(e, NO_OPTIONS)).toBe(e);
  });
  it("maiuscole: il predicato distingue", () => {
    expect(firstText(applyOptions(expr("Gatto"), on({ caseSensitive: true }))).case_sensitive).toBe(true);
  });
  it("tolleranza: refusi ammessi, ma non insieme alle maiuscole", () => {
    expect(firstText(applyOptions(expr("gatto"), on({ typos: true }))).tolerance).toBe("typos");
    expect(firstText(applyOptions(expr("gatto"), on({ typos: true, caseSensitive: true }))).tolerance).toBe("exact");
  });
  it("parola intera: l'ultimo termine non è più un prefisso", () => {
    expect(firstText(expr("gat")).partial_last_term).toBe(true);
    expect(firstText(applyOptions(expr("gat"), on({ wholeWord: true }))).partial_last_term).toBe(false);
  });
  it("i predicati che non sono testo restano intatti", () => {
    const e = expr("tag:idee gatto");
    const out = applyOptions(e, on({ caseSensitive: true }));
    expect(out.any[0]!.all[0]!.predicate.kind).toBe("tag");
  });
});

describe("che cosa si può sostituire", () => {
  it("un termine solo", () => {
    expect(replaceableText(expr("gatto"), NO_OPTIONS)).toBe("gatto");
  });
  it("una frase fra virgolette", () => {
    expect(replaceableText(expr('"il gatto nero"'), NO_OPTIONS)).toBe("il gatto nero");
  });
  it("più parole, operatori, negazioni e modelli no", () => {
    expect(replaceableText(expr("gatto nero"), NO_OPTIONS)).toBeNull();
    expect(replaceableText(expr("tag:idee"), NO_OPTIONS)).toBeNull();
    expect(replaceableText(expr("gatto OR cane"), NO_OPTIONS)).toBeNull();
    expect(replaceableText(expr("-gatto"), NO_OPTIONS)).toBeNull();
    expect(replaceableText(expr("gatto"), on({ regex: true }))).toBeNull();
    expect(replaceableText(expr("gatto"), on({ typos: true }))).toBeNull();
  });
});
