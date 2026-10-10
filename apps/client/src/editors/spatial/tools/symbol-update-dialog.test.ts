// @vitest-environment happy-dom
// La frase della finestra «Aggiorna dalla libreria»: le istanze che cambiano,
// e le modifiche del disegno che si perdono, o che si perderebbero.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateMessage } from "./symbol-update-dialog";

beforeEach(() => {
  vi.stubGlobal("navigator", { language: "it-IT" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("la frase", () => {
  it("conta le istanze che cambiano", () => {
    expect(updateMessage({ library: "Impianti", uses: 0, edited: false })).toBe("Il simbolo prende il contenuto che ha nella libreria «Impianti»; nel disegno non ha istanze.");
    expect(updateMessage({ library: "Impianti", uses: 1, edited: false })).toBe(
      "Il simbolo prende il contenuto che ha nella libreria «Impianti»: cambia anche la sua istanza nel disegno, che resta dov’è.",
    );
    expect(updateMessage({ library: "Impianti", uses: 4, edited: false })).toContain("cambiano anche le sue 4 istanze nel disegno");
  });

  it("dice che le modifiche del disegno si perdono, o che si perderebbero se non si sa", () => {
    expect(updateMessage({ library: "Impianti", uses: 0, edited: true })).toMatch(/ Le modifiche fatte al simbolo in questo disegno si perdono\.$/);
    expect(updateMessage({ library: "Impianti", uses: 0, edited: null })).toMatch(/ Se il simbolo è stato modificato in questo disegno, quelle modifiche si perdono\.$/);
  });

  it("in inglese", () => {
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(updateMessage({ library: "Plant", uses: 2, edited: true })).toBe(
      "The symbol takes the content it has in the library “Plant”: its 2 instances in the drawing change too, and stay where they are. The changes made to the symbol in this drawing are lost.",
    );
  });
});
