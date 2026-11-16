import { describe, expect, it } from "vitest";
import { distinctiveTails } from "./tab-names";

/// La coda che resta a vista, o `null`.
function tails(names: string[]): (string | null)[] {
  return distinctiveTails(names).map((start, index) => (start === null ? null : names[index]!.slice(start)));
}

describe("la parte che distingue il nome di una linguetta (#411 B-03)", () => {
  it("due note del diario tengono a vista mese e giorno, non l'anno che hanno in comune", () => {
    expect(tails(["Benvenuto", "2026-08-18", "2026-08-19", "Il banco che vede"])).toEqual([
      null,
      "08-18",
      "08-19",
      null,
    ]);
  });

  it("due omonime tengono a vista la cartella che la tab aggiunge in coda", () => {
    expect(tails(["Prima idea · Archivio", "Prima idea · /"])).toEqual(["Archivio", "idea · /"]);
  });

  it("la stessa nota in vista sorgente tiene a vista ciò che la distingue", () => {
    expect(tails(["Nota", "Nota · Sorgente"])).toEqual([null, " · Sorgente"]);
  });

  it("nomi che cominciano diversi, o con poche lettere in comune, si tagliano alla fine", () => {
    expect(tails(["Sintassi di Fub", "Frammenti di codice", "Nota lunga"])).toEqual([null, null, null]);
    expect(tails(["Idea uno", "Idee due"])).toEqual([null, null]);
    // Due schede dello stesso documento non hanno niente che le distingua.
    expect(tails(["Benvenuto", "Benvenuto"])).toEqual([null, null]);
    expect(tails([])).toEqual([]);
  });

  it("la coda comincia all'inizio della parola in cui i nomi si separano", () => {
    expect(tails(["Progetto Alfa riunione", "Progetto Alfa budget"])).toEqual(["riunione", "budget"]);
    expect(tails(["Verbale marzo", "Verbale maggio"])).toEqual(["marzo", "maggio"]);
  });
});
