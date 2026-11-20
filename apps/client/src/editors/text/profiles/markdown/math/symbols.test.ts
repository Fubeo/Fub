import katex from "katex";
import { describe, expect, it } from "vitest";
import { readOptions } from "../math";
import { insertSymbol, type MathState, type Outcome } from "./edit";
import { holesOf, mapFormula } from "./points";
import { commandName, GROUPS, nearest, PIECES, propose, proposalsAddNothing, SYMBOLS, symbolName } from "./symbols";

// Il catalogo dei simboli e le proposte dopo `\` (T61, E27), senza DOM. Il
// cursore si scrive `|` nel TeX, come in `edit.test.ts`.

const s = (marked: string): MathState => ({ tex: marked.replace("|", ""), caret: marked.indexOf("|") });
const show = (state: MathState) => state.tex.slice(0, state.caret) + "|" + state.tex.slice(state.caret);
function result(before: MathState, outcome: Outcome): string {
  if (outcome.kind === "edit") return show(outcome.state);
  if (outcome.kind === "move") return show({ tex: before.tex, caret: outcome.caret });
  return outcome.kind;
}
const renders = (tex: string) => {
  try {
    katex.renderToString(tex, readOptions(false));
    return true;
  } catch {
    return false;
  }
};
const byId = (id: string) => SYMBOLS.find((symbol) => symbol.id === id)!;
const ids = (query: string) => propose(query).map((symbol) => symbol.id);

describe("il catalogo", () => {
  it("ogni simbolo ha un id solo, un gruppo, il nome in italiano e in inglese", () => {
    expect(new Set(SYMBOLS.map((symbol) => symbol.id)).size).toBe(SYMBOLS.length);
    for (const symbol of SYMBOLS) {
      expect(GROUPS, symbol.id).toContain(symbol.group);
      expect(symbol.name.it.trim(), symbol.id).not.toBe("");
      expect(symbol.name.en.trim(), symbol.id).not.toBe("");
      expect(symbol.id, symbol.id).toMatch(/^[A-Za-z0-9-]+$/);
    }
    // Ogni gruppo della tavolozza ha i suoi simboli.
    for (const group of GROUPS) expect(SYMBOLS.some((symbol) => symbol.group === group), group).toBe(true);
  });

  it("ogni disegno e ogni modello si leggono con le regole della lettura", () => {
    for (const symbol of SYMBOLS) {
      expect(renders(symbol.glyph), symbol.glyph).toBe(true);
      expect(renders(symbol.template.replace("§", "")), symbol.template).toBe(true);
      // Nessun modello finisce con uno spazio: `$\alpha $` non sarebbe più
      // una formula per gli altri programmi.
      expect(symbol.template, symbol.id).toBe(symbol.template.trim());
    }
  });

  it("la scrittura veloce c'è dove il prototipo la dà, e non si ripete", () => {
    const quick = SYMBOLS.map((symbol) => symbol.quick).filter(Boolean);
    expect(new Set(quick).size).toBe(quick.length);
    expect(byId("frac").quick).toBe("a/b");
    expect(byId("to").quick).toBe("->");
    expect(byId("alpha").quick).toBe("alpha");
  });

  it("i nomi seguono la lingua", () => {
    expect(symbolName(byId("alpha"), "it-IT")).toBe("Alfa");
    expect(symbolName(byId("alpha"), "en")).toBe("Alpha");
    expect(symbolName(byId("le"), "en-GB")).toBe("Less than or equal");
    expect(symbolName(byId("le"), "de")).toBe("Minore o uguale");
  });

  it("i primi otto sono i pezzi, nell'ordine di E27", () => {
    expect(SYMBOLS.slice(0, 8).map((symbol) => symbol.id)).toEqual([...PIECES]);
  });
});

describe("i pezzi entrano coi loro spazi vuoti", () => {
  const expected: Record<string, [string, number]> = {
    frac: ["\\frac{|}{}", 2],
    power: ["x^{|}", 1],
    subscript: ["x_{|}", 1],
    sqrt: ["\\sqrt{|}", 1],
    sum: ["\\sum_{|}^{}", 2],
    int: ["\\int_{|}^{}", 2],
    lim: ["\\lim_{|}", 1],
    text: ["\\text{|}", 1],
  };
  for (const id of PIECES) {
    it(id, () => {
      const [want, holes] = expected[id]!;
      const before = id === "power" || id === "subscript" ? s("x|") : s("|");
      const outcome = insertSymbol(before, byId(id).template, before.caret, renders);
      expect(result(before, outcome)).toBe(want);
      if (outcome.kind !== "edit") throw new Error(id);
      expect(holesOf(mapFormula(outcome.state.tex))).toHaveLength(holes);
    });
  }

  it("al posto del nome scritto dopo la barra, con ciò che segue intatto", () => {
    const state = s("a+\\fr|b");
    expect(result(state, insertSymbol(state, byId("frac").template, 2, renders))).toBe("a+\\frac{|}{}b");
    const greek = s("\\alp|b");
    expect(result(greek, insertSymbol(greek, byId("alpha").template, 0, renders))).toBe("\\alpha |b");
    const end = s("x+\\alp|");
    expect(result(end, insertSymbol(end, byId("alpha").template, 2, renders))).toBe("x+\\alpha|");
  });

  it("le parentesi mettono il cursore dentro; in una tabella `|` non chiude la cella", () => {
    const state = s("|");
    expect(result(state, insertSymbol(state, byId("growing-parentheses").template, 0, renders))).toBe("\\left(|\\right)");
    const abs = insertSymbol(state, byId("absolute-value").template, 0, renders, { inTable: true });
    if (abs.kind !== "edit") throw new Error("abs");
    expect(abs.state.tex).not.toContain("|");
    expect(renders(abs.state.tex)).toBe(true);
  });

  it("un esponente su un pezzo che ne ha già uno ci entra; i gradi prendono una base vuota", () => {
    expect(result(s("x^{2}|"), insertSymbol(s("x^{2}|"), "^{}", 5, renders))).toBe("x^{2|}");
    const degrees = insertSymbol(s("x^{2}|"), byId("degrees").template, 5, renders);
    expect(result(s("x^{2}|"), degrees)).toBe("x^{2}{}^\\circ|");
  });

  it("nel testo non entra niente", () => {
    expect(insertSymbol(s("\\text{a|}"), byId("alpha").template, 7, renders).kind).toBe("none");
  });

  it("ogni simbolo, messo in ogni punto buono di una formula, la lascia leggibile", () => {
    const formula = "a+\\frac{b}{c}-x^{2}";
    for (const point of mapFormula(formula).points) {
      if (point.place.role === "text") continue;
      for (const symbol of SYMBOLS) {
        const outcome = insertSymbol({ tex: formula, caret: point.at }, symbol.template, point.at, renders);
        if (outcome.kind !== "edit") continue;
        expect(renders(outcome.state.tex), `${symbol.id} in ${point.at}`).toBe(true);
        expect(mapFormula(outcome.state.tex).points.some((p) => p.at === outcome.state.caret), `${symbol.id} in ${point.at}`).toBe(true);
      }
    }
  });
});

describe("le proposte", () => {
  it("il comando uguale prima, con le stesse maiuscole", () => {
    expect(ids("alp")).toEqual(["alpha"]);
    expect(ids("Delta")[0]).toBe("Delta");
    expect(ids("delta")[0]).toBe("delta");
    expect(ids("sqrt")).toEqual(["sqrt", "sqrt-nth-root"]);
    expect(ids("fr").slice(0, 3)).toEqual(["frac", "frac-derivative", "frac-partial-derivative"]);
  });

  it("si trovano col nome italiano e inglese e con le altre parole", () => {
    expect(ids("radice")).toContain("sqrt");
    expect(ids("somma")[0]).toBe("sum");
    expect(ids("freccia")).toContain("to");
    expect(ids("minore")).toContain("le");
    expect(ids("arrow")).toContain("to");
    expect(ids("piu")).toContain("pm");
  });

  it("un nome che non esiste trova il più vicino", () => {
    expect(ids("alfa")).toEqual(["alpha"]);
    expect(ids("alpah")).toEqual(["alpha"]);
    expect(nearest("lamda")?.id).toBe("lambda");
    expect(ids("zzzz")).toEqual([]);
    expect(nearest("ab")).toBeNull();
  });

  it("al più cinque, solo coi simboli che hanno un comando", () => {
    expect(propose("e").length).toBeLessThanOrEqual(5);
    // La potenza si fa con `^`: col nome non si propone.
    expect(ids("potenza")).toEqual([]);
    for (const symbol of propose("m")) expect(commandName(symbol)).not.toBe("");
  });

  it("si nascondono quando non aggiungono niente", () => {
    expect(proposalsAddNothing("alpha", propose("alpha"))).toBe(true);
    // `\sum` entra coi suoi spazi vuoti: la proposta dice qualcosa.
    expect(proposalsAddNothing("sum", propose("sum"))).toBe(false);
  });

  it("si scelgono in memoria, in fretta", () => {
    const start = performance.now();
    for (let i = 0; i < 1_000; i++) propose(["a", "al", "alp", "fr", "sum", "freccia", "xyzw"][i % 7]!);
    expect((performance.now() - start) / 1_000).toBeLessThan(0.5);
  });
});
