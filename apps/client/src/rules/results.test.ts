// La regola dell'elenco dei risultati (§21.3): una nota può portare **N punti a
// cui saltare**, non uno.
//
// È la metà che si vede provando l'app a mano solo se si ha sotto mano una nota
// che ripete la stessa parola — cioè il caso che non si prova mai per caso. Qui
// è un caso di test, e la riga che deve portare alla *seconda* occorrenza porta
// il byte della seconda.
import { describe, expect, it } from "vitest";
import type { DocumentMatch } from "../host/contract";
import { rowsToShow } from "../rules/results";

const REV = "0123456789abcdef";

function hit(doc: string, occurrences: number[]): DocumentMatch {
  return {
    doc,
    snippet: "…il gatto…",
    highlights: [{ start: 3, end: 8 }],
    occurrences: occurrences.map((start) => ({
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
    const rows = rowsToShow([{ doc: "a.md" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].byteOffset).toBeUndefined();
    expect(rows[0].occurrence).toBeUndefined();
  });

  it("la seconda riga di una nota porta alla SECONDA occorrenza", () => {
    const rows = rowsToShow([hit("a.md", [12, 140, 300])]);
    expect(rows).toHaveLength(3);

    // La prima è la riga della nota: titolo, estratto, e il primo punto.
    expect(rows[0]).toMatchObject({ doc: "a.md", byteOffset: 12, snippet: "…il gatto…" });
    expect(rows[0].occurrence).toBeUndefined();

    // Le occorrenze sono numerate da 2 e col **proprio** byte.
    expect(rows[1]).toMatchObject({ doc: "a.md", byteOffset: 140, occurrence: 2 });
    expect(rows[2]).toMatchObject({ doc: "a.md", byteOffset: 300, occurrence: 3 });
    // Le occorrenze non portano l'estratto: è uno per documento, e ripeterlo
    // sotto ogni riga sarebbe il rumore che `absorb` evita da sempre.
    expect(rows[1].snippet).toBeUndefined();
  });

  it("le note restano in ordine, con le proprie occurrences sotto", () => {
    const rows = rowsToShow([hit("a.md", [1, 2]), hit("b.md", [9])]);
    expect(rows.map((r) => [r.doc, r.occurrence])).toEqual([
      ["a.md", undefined],
      ["a.md", 2],
      ["b.md", undefined],
    ]);
  });
});
