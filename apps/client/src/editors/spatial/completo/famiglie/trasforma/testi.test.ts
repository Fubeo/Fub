// Le parole della famiglia «trasforma» (K6 T13): ogni campo delle finestre di Disponi ha la
// sua parola in italiano e in inglese, come lo schema generato le dà. Senza, la finestra
// mostrerebbe il nome tecnico del campo (`width`, `seed`) al posto della parola.
import { describe, expect, it } from "vitest";
import schema from "./schema.generated.json";
import { TESTI } from "./testi";

describe("le parole della famiglia trasforma", () => {
  const disponi = schema.finestre.filter((finestra) => finestra.id.startsWith("addon.arrange."));

  it("le finestre di Disponi sono quelle dello schema: la misura di ciascuno e l'opacità casuale", () => {
    expect(disponi.map((finestra) => finestra.id)).toEqual(["addon.arrange.randomizeOpacity", "addon.arrange.size"]);
  });

  it("ogni campo delle finestre di Disponi ha la sua parola, in italiano e in inglese", () => {
    for (const finestra of disponi) {
      for (const campo of finestra.campi) {
        const parola = TESTI[`campo:${campo.nome}`];
        expect(parola, `campo:${campo.nome} di ${finestra.id}`).toBeDefined();
        expect(parola!.it, `campo:${campo.nome} in italiano`).not.toBe(campo.nome);
        expect(parola!.en, `campo:${campo.nome} in inglese`).not.toBe(campo.nome);
      }
    }
  });

  it("le azioni delle finestre di Disponi hanno il loro verbo", () => {
    for (const finestra of disponi) {
      expect(TESTI[`azione:${finestra.id}`], `azione:${finestra.id}`).toBeDefined();
    }
  });
});
