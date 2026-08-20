import { describe, expect, it } from "vitest";

import { caseOf, toRecover } from "./drafts";
import type { DraftInfo } from "../host/contract";

function draft(p: Partial<DraftInfo> = {}): DraftInfo {
  return {
    doc: "Idea.md",
    at: 1,
    base: null,
    exists: true,
    current: null,
    text: "qualcosa",
    ...p,
  };
}

describe("che domanda fare su una bozza", () => {
  it("offre la bozza se il file è rimasto intatto", () => {
    // `base` e `current` sono entrambe impronte del file, non del testo della
    // bozza. Uguali significa che il file non si è mosso mentre il buffer era
    // sporco: proprio per questo il testo della bozza è l'unica copia nuova.
    const d = draft({ base: "abc", current: "abc" });
    expect(caseOf(d)).toBe("intatta");
    expect(toRecover([d])).toEqual([d]);
  });

  it("distingue una nota mai salvata da una cancellata sotto il buffer", () => {
    // Sono le due facce di `exists: false`, e non sono la stessa domanda: la
    // prima non ha una storia, la seconda sì — qualcuno aveva buttato quella
    // nota, e ridargliela in silenzio sarebbe resuscitarla.
    expect(caseOf(draft({ exists: false, base: null }))).toBe("nuova");
    expect(caseOf(draft({ exists: false, base: "abc" }))).toBe("orfana");
  });

  it("vede il file cambiato sotto il buffer", () => {
    expect(caseOf(draft({ base: "prima", current: "dopo" }))).toBe("divergente");
  });

  it("non spaccia un'incertezza per un conflitto", () => {
    // `base` assente vuol dire «non lo so», non «è cambiato». Trattare ogni
    // incertezza come il caso peggiore insegna a cliccare senza leggere, che è
    // il modo di perdere il testo il giorno in cui il conflitto è vero.
    expect(caseOf(draft({ base: null, current: "abc" }))).toBe("incerta");
  });

  it("non offre di recuperare il nulla", () => {
    // Chi seleziona tutto, cancella e chiude ha lasciato un buffer vuoto e
    // sporco: «recupera» qui rimetterebbe il nulla.
    expect(toRecover([draft({ text: "   ", exists: false })])).toEqual([]);
  });

  it("mette per prima la più recente", () => {
    const old = draft({ doc: "a.md", at: 1, exists: false });
    const newItem = draft({ doc: "b.md", at: 99, exists: false });
    expect(toRecover([old, newItem]).map((d) => d.doc)).toEqual(["b.md", "a.md"]);
  });
});
