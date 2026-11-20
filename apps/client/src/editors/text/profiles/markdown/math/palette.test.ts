import { describe, expect, it } from "vitest";
import { GROUP_GLYPHS, QUICK, searchSymbols, symbolsOf } from "./palette";
import { GROUPS, PIECES, SYMBOLS } from "./symbols";

// La tavolozza della formula (T62, E27): gli otto pezzi più usati, i sette
// gruppi del catalogo e la ricerca a parole, in italiano e in inglese.

const names = (query: string) => searchSymbols(query).map((symbol) => symbol.name.it);

describe("i pezzi e i gruppi", () => {
  it("la fila sotto la formula ha gli otto pezzi più usati, quelli coi loro spazi vuoti", () => {
    expect(QUICK.map((symbol) => symbol.id)).toEqual(PIECES);
  });

  it("ogni gruppo ha il suo disegno, e i gruppi insieme danno tutto il catalogo", () => {
    expect(Object.keys(GROUP_GLYPHS)).toEqual([...GROUPS]);
    expect(GROUPS.flatMap((group) => symbolsOf(group))).toEqual([...SYMBOLS]);
    for (const group of GROUPS) expect(symbolsOf(group).length).toBeGreaterThan(0);
  });
});

describe("la ricerca a parole", () => {
  it("trova per nome in italiano", () => {
    expect(names("radice")).toEqual(["Radice quadrata", "Radice ennesima"]);
    expect(names("alfa")).toEqual(["Alfa"]);
  });

  it("«freccia» dà prima le frecce, poi il vettore che ha la freccia fra le altre parole", () => {
    const found = names("freccia");
    expect(found.slice(0, 4)).toEqual(["Freccia a destra", "Freccia a sinistra", "Freccia in su", "Freccia in giù"]);
    expect(found[found.length - 1]).toBe("Vettore");
  });

  it("«minore» dà le relazioni col minore", () => {
    expect(names("minore")).toEqual(["Minore o uguale", "Molto minore"]);
  });

  it("trova per nome in inglese, per comando e per le altre parole", () => {
    expect(names("root")).toEqual(["Radice quadrata", "Radice ennesima"]);
    expect(names("arrow")[0]).toBe("Freccia a destra");
    expect(names("sqrt")).toContain("Radice quadrata");
    expect(names("\\alpha")).toEqual(["Alfa"]);
    expect(names("somma")).toEqual(["Sommatoria"]);
    expect(names("gradiente")).toEqual(["Nabla"]);
  });

  it("le parole si cercano dall'inizio, senza maiuscole né accenti, tutte insieme", () => {
    expect(names("RAD")).toEqual(["Radice quadrata", "Radice ennesima"]);
    expect(names("giu")).toEqual(["Freccia in giù"]);
    expect(names("piu")).toContain("Più o meno");
    expect(names("freccia sin")).toEqual(["Freccia a sinistra"]);
    expect(names("minore o")).toEqual(["Minore o uguale"]);
    // A metà di una parola non si trova: «dice» non è «radice».
    expect(names("dice")).toEqual([]);
  });

  it("una ricerca vuota, o senza risultati, non trova niente", () => {
    expect(searchSymbols("")).toEqual([]);
    expect(searchSymbols("   ")).toEqual([]);
    expect(searchSymbols("zzz")).toEqual([]);
  });

  it("risponde in meno di un fotogramma", () => {
    const queries = ["r", "ra", "rad", "radice", "a", "al", "alfa", "freccia", "minore", "m", "zzz", "freccia a d", "root", "arrow"];
    // Il primo giro scalda il motore; poi ogni domanda tiene il suo tempo
    // migliore su cinquanta giri, cioè il costo della ricerca e non quello di
    // una pausa del sistema sotto carico, e conta la più lenta delle domande.
    for (const query of queries) searchSymbols(query);
    const best = new Map<string, number>();
    for (let round = 0; round < 50; round++) {
      for (const query of queries) {
        const start = performance.now();
        searchSymbols(query);
        const took = performance.now() - start;
        best.set(query, Math.min(best.get(query) ?? Infinity, took));
      }
    }
    expect(Math.max(...best.values())).toBeLessThan(16);
  });
});
