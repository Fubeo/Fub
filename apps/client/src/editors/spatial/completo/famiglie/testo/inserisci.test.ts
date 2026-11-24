// Inserisci carattere (menu Testo di VectorCraft, `type.insert`): la finestra scritta da Fub chiede
// solo il carattere, fra quelli del motore, e ognuno ha il suo nome in italiano e in inglese.

import { describe, expect, it } from "vitest";
import schema from "./schema.generated.json";
import { TESTI } from "./testi";

const finestra = (schema as unknown as { readonly finestre: readonly { id: string; campi: readonly { nome: string; tipo: string; valori?: readonly string[]; predefinito?: unknown }[] }[] }).finestre.find(
  (una) => una.id === "type.insert",
)!;

describe("Inserisci carattere", () => {
  it("la finestra chiede solo il carattere, il punto elenco di partenza", () => {
    expect(finestra.campi.map((campo) => campo.nome)).toEqual(["char"]);
    const [carattere] = finestra.campi;
    expect(carattere!.tipo).toBe("scelta");
    expect(carattere!.predefinito).toBe("bullet");
    expect(carattere!.valori).toContain("emDash");
    expect(carattere!.valori).toContain("paragraphReturn");
  });

  it("ogni carattere ha il suo nome nelle due lingue, come il campo, la frase e il verbo", () => {
    for (const valore of finestra.campi[0]!.valori!) {
      const nome = TESTI[`scelta:char:${valore}`];
      expect(nome, valore).toBeDefined();
      expect(nome!.it.length, valore).toBeGreaterThan(0);
      expect(nome!.en.length, valore).toBeGreaterThan(0);
    }
    for (const chiave of ["campo:char", "descrizione:type.insert", "azione:type.insert"]) expect(TESTI[chiave], chiave).toBeDefined();
  });
});
