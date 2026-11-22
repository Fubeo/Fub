// La famiglia «colore» (K6 T14, giro 1): ogni finestra che il motore le dà (lo schema generato)
// ha le sue parole nelle due lingue, il verbo del pulsante e la descrizione; ogni campo ha il suo
// nome, e i campi in percentuale la loro unità. Una finestra senza parole mostrerebbe i nomi
// interni dei campi (`intensity`, `r`) a chi la usa.
import { describe, expect, it } from "vitest";
import famiglia from "./index";
import schema from "./schema.generated.json";

interface Campo {
  readonly nome: string;
  readonly tipo: string;
  readonly minimo?: number;
  readonly massimo?: number;
}

/// Le finestre del motore: le righe `ui.*` dell'interfaccia (`ui.saturateDialog`,
/// `ui.colorBalanceDialog`) sono le stesse finestre aperte dalla mappa, senza campi loro.
const tutte = schema.finestre as readonly { readonly fonte: string; readonly id: string; readonly campi: readonly Campo[] }[];
const finestre = tutte.filter((f) => f.fonte === "motore");

describe("le parole della famiglia colore", () => {
  it("il modulo porta le sue parole e non registra altro", () => {
    expect(famiglia.testi).toBeDefined();
    expect(typeof famiglia.registra).toBe("function");
  });

  it("le finestre sono Satura, Regola bilanciamento colore e Sovrastampa nero", () => {
    expect(finestre.map((f) => f.id).sort()).toEqual(["edit.colors.adjustBalance", "edit.colors.overprintBlack", "edit.colors.saturate"]);
    expect(tutte.filter((f) => f.fonte === "interfaccia").map((f) => f.id).sort()).toEqual(["ui.colorBalanceDialog", "ui.saturateDialog"]);
  });

  it.each(finestre.map((f) => [f.id, f] as const))("%s ha il verbo, la descrizione e il nome di ogni campo, in italiano e in inglese", (id, finestra) => {
    for (const chiave of [`azione:${id}`, `descrizione:${id}`, ...finestra.campi.map((c) => `campo:${c.nome}`)]) {
      const parola = famiglia.testi[chiave];
      expect(parola, chiave).toBeDefined();
      expect(parola!.it.length, chiave).toBeGreaterThan(0);
      expect(parola!.en.length, chiave).toBeGreaterThan(0);
    }
    // Un numero con limiti in percentuale dice la sua unità.
    for (const campo of finestra.campi.filter((c) => c.tipo === "numero" && c.massimo === 100)) {
      expect(famiglia.testi[`unita:${campo.nome}`], campo.nome).toEqual({ it: "%", en: "%" });
    }
  });
});
