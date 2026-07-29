// La regola dell'elenco dei risultati (§21.3): una nota può portare **N punti a
// cui saltare**, non uno.
//
// È la metà che si vede provando l'app a mano solo se si ha sotto mano una nota
// che ripete la stessa parola — cioè il caso che non si prova mai per caso. Qui
// è un caso di test, e la riga che deve portare alla *seconda* occorrenza porta
// il byte della seconda.
import { describe, expect, it } from "vitest";
import type { DocumentMatch } from "../host/contract";
import { righeDaMostrare } from "../rules/risultati";

const REV = "0123456789abcdef";

function hit(doc: string, occorrenze: number[]): DocumentMatch {
  return {
    doc,
    snippet: "…il gatto…",
    highlights: [{ start: 3, end: 8 }],
    occurrences: occorrenze.map((start) => ({
      span: { start, end: start + 5 },
      revision: REV,
    })),
  };
}

describe("le righe dell'elenco dei risultati", () => {
  it("una nota senza coordinate resta una riga sola, e si apre e basta", () => {
    // È il comportamento di prima della §21.3, e resta quello di chi non ha
    // cercato del testo: `occurrences` vuoto vuol dire «nessuno le ha
    // calcolate», non «nessuna occorrenza».
    const righe = righeDaMostrare([{ doc: "a.md" }]);
    expect(righe).toHaveLength(1);
    expect(righe[0].byteOffset).toBeUndefined();
    expect(righe[0].occorrenza).toBeUndefined();
  });

  it("la seconda riga di una nota porta alla SECONDA occorrenza", () => {
    const righe = righeDaMostrare([hit("a.md", [12, 140, 300])]);
    expect(righe).toHaveLength(3);

    // La prima è la riga della nota: titolo, estratto, e il primo punto.
    expect(righe[0]).toMatchObject({ doc: "a.md", byteOffset: 12, snippet: "…il gatto…" });
    expect(righe[0].occorrenza).toBeUndefined();

    // Le altre sono occorrenze, numerate da 2 e col **proprio** byte.
    expect(righe[1]).toMatchObject({ doc: "a.md", byteOffset: 140, occorrenza: 2 });
    expect(righe[2]).toMatchObject({ doc: "a.md", byteOffset: 300, occorrenza: 3 });
    // Le occorrenze non portano l'estratto: è uno per documento, e ripeterlo
    // sotto ogni riga sarebbe il rumore che `absorb` evita da sempre.
    expect(righe[1].snippet).toBeUndefined();
  });

  it("le note restano in ordine, con le proprie occorrenze sotto", () => {
    const righe = righeDaMostrare([hit("a.md", [1, 2]), hit("b.md", [9])]);
    expect(righe.map((r) => [r.doc, r.occorrenza])).toEqual([
      ["a.md", undefined],
      ["a.md", 2],
      ["b.md", undefined],
    ]);
  });
});
