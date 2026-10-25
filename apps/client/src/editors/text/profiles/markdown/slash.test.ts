import { describe, expect, it } from "vitest";
import { calloutTypeContext, codeLanguageContext, cursorIsLiteral, slashContext, SLASH_QUERY_MAX } from "./slash";

describe("dove si apre il «/» nel testo", () => {
  it("a inizio riga o dopo uno spazio, con ciò che si scrive dopo", () => {
    expect(slashContext("/")).toEqual({ from: 0, query: "" });
    expect(slashContext("/tit")).toEqual({ from: 0, query: "tit" });
    expect(slashContext("Una riga /h2")).toEqual({ from: 9, query: "h2" });
    expect(slashContext("/titolo 2")).toEqual({ from: 0, query: "titolo 2" });
  });

  it("dentro una parola, in un URL o in una data resta testo", () => {
    expect(slashContext("e/o")).toBeNull();
    expect(slashContext("24/09")).toBeNull();
    expect(slashContext("https://fub.app/")).toBeNull();
    expect(slashContext("km/h")).toBeNull();
  });

  it("si chiude con uno spazio subito dopo, con due spazi, con un altro «/» o oltre il tetto", () => {
    expect(slashContext("/ ")).toBeNull();
    expect(slashContext("/titolo  ")).toBeNull();
    expect(slashContext("/a/b")).toBeNull();
    expect(slashContext(`/${"a".repeat(SLASH_QUERY_MAX)}`)).not.toBeNull();
    expect(slashContext(`/${"a".repeat(SLASH_QUERY_MAX + 1)}`)).toBeNull();
  });

  it("nel codice, nei link e in un wikilink aperto è letterale", () => {
    expect(cursorIsLiteral({ nodes: ["InlineCode", "Paragraph"], lineBefore: "`a " })).toBe(true);
    expect(cursorIsLiteral({ nodes: ["Paragraph"], lineBefore: "vedi [[Nota " })).toBe(true);
    expect(cursorIsLiteral({ nodes: ["Paragraph"], lineBefore: "vedi [[Nota]] " })).toBe(false);
  });
});

describe("i completamenti che una voce riapre", () => {
  it("il tipo di un callout, fra `[!` e `]`", () => {
    expect(calloutTypeContext("> [!", "]")).toEqual({ from: 4, query: "" });
    expect(calloutTypeContext("> [!war", "]")).toEqual({ from: 4, query: "war" });
    expect(calloutTypeContext("Testo [!", "]")).toBeNull();
  });

  it("il linguaggio sulla riga d'apertura di un recinto, con niente dopo", () => {
    expect(codeLanguageContext("```", "")).toEqual({ from: 3, query: "" });
    expect(codeLanguageContext("> ~~~py", "")).toEqual({ from: 5, query: "py" });
    expect(codeLanguageContext("```js", " x")).toBeNull();
    expect(codeLanguageContext("``", "")).toBeNull();
  });
});
