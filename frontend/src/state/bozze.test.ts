import { describe, expect, it } from "vitest";

import { casoDi, daRecuperare } from "./bozze";
import type { DraftInfo } from "../host/contract";

function bozza(p: Partial<DraftInfo> = {}): DraftInfo {
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
  it("non chiede niente se il disco ha già quel testo", () => {
    // Il caso più comune di tutti: chiusura ordinata, il salvataggio è passato.
    const d = bozza({ base: "abc", current: "abc" });
    expect(casoDi(d)).toBe("superata");
    expect(daRecuperare([d])).toEqual([]);
  });

  it("distingue una nota mai salvata da una cancellata sotto il buffer", () => {
    // Sono le due facce di `exists: false`, e non sono la stessa domanda: la
    // prima non ha una storia, la seconda sì — qualcuno aveva buttato quella
    // nota, e ridargliela in silenzio sarebbe resuscitarla.
    expect(casoDi(bozza({ exists: false, base: null }))).toBe("nuova");
    expect(casoDi(bozza({ exists: false, base: "abc" }))).toBe("orfana");
  });

  it("vede il file cambiato sotto il buffer", () => {
    expect(casoDi(bozza({ base: "prima", current: "dopo" }))).toBe("divergente");
  });

  it("non spaccia un'incertezza per un conflitto", () => {
    // `base` assente vuol dire «non lo so», non «è cambiato». Trattare ogni
    // incertezza come il caso peggiore insegna a cliccare senza leggere, che è
    // il modo di perdere il testo il giorno in cui il conflitto è vero.
    expect(casoDi(bozza({ base: null, current: "abc" }))).toBe("incerta");
  });

  it("non offre di recuperare il nulla", () => {
    // Chi seleziona tutto, cancella e chiude ha lasciato un buffer vuoto e
    // sporco: «recupera» qui rimetterebbe il nulla.
    expect(daRecuperare([bozza({ text: "   ", exists: false })])).toEqual([]);
  });

  it("mette per prima la più recente", () => {
    const vecchia = bozza({ doc: "a.md", at: 1, exists: false });
    const nuova = bozza({ doc: "b.md", at: 99, exists: false });
    expect(daRecuperare([vecchia, nuova]).map((d) => d.doc)).toEqual(["b.md", "a.md"]);
  });
});
