// La porta dei temi del pannello (K6 T14, temi): ogni azione è un comando del motore col prefisso
// `disegno.`, e una lettura o un rifiuto diventano un esito. Il motore è finto: si guardano le richieste.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { creaPortaTemi, problemaDelTema, temiDi } from "./temi-porta";

/// Un motore con la sessione che risponde `risposta` a ogni comando; le richieste finiscono in `richieste`.
function motoreCon(risposta: (richiesta: { id: string; value: unknown }) => unknown) {
  const richieste: { id: string; value: unknown }[] = [];
  const comando = vi.fn((richiesta: { id: string; value: unknown }) => {
    richieste.push(richiesta);
    return Promise.resolve(risposta(richiesta));
  });
  const sessione = { comando } as unknown as SessioneMotore;
  const motore = { assente: () => null, pronta: () => Promise.resolve(sessione) } as unknown as MotoreDelDisegno;
  return { motore, richieste };
}

const CARICA = { famiglia: () => Promise.resolve({ kind: "pronta" as const }) } as never;

describe("la porta dei temi", () => {
  it("elenco: legge colorTheme.list col prefisso disegno. e dà i temi con i loro colori", async () => {
    const { motore, richieste } = motoreCon(() => ({
      refused: null,
      reading: { themes: [{ name: "Tramonto", colors: ["#ff0000", "#00ff00"] }] },
    }));
    const porta = creaPortaTemi({ motore, carica: CARICA, vita: openLifetime() });
    const esito = await porta.elenco();
    expect(richieste[0]).toMatchObject({ id: "disegno.colorTheme.list" });
    expect(esito).toEqual({ kind: "pronti", temi: [{ nome: "Tramonto", colori: ["#ff0000", "#00ff00"] }] });
  });

  it("salva: manda nome (senza spazi ai lati) e colori, e dà il nome che il motore ha scritto", async () => {
    const { motore, richieste } = motoreCon(() => ({ refused: null, reading: { name: "Tramonto", count: 1 } }));
    const porta = creaPortaTemi({ motore, carica: CARICA, vita: openLifetime() });
    const esito = await porta.salva("  Tramonto ", ["#ff0000"]);
    expect(richieste[0]).toMatchObject({ id: "disegno.colorTheme.save", value: { name: "Tramonto", colors: ["#ff0000"] } });
    expect(esito).toEqual({ kind: "fatto", nome: "Tramonto" });
  });

  it("togli: manda colorTheme.delete col nome, e dà il tema tolto", async () => {
    const { motore, richieste } = motoreCon(() => ({ refused: null, reading: { deleted: "Tramonto" } }));
    const porta = creaPortaTemi({ motore, carica: CARICA, vita: openLifetime() });
    const esito = await porta.togli("Tramonto");
    expect(richieste[0]).toMatchObject({ id: "disegno.colorTheme.delete", value: { name: "Tramonto" } });
    expect(esito).toEqual({ kind: "fatto", nome: "Tramonto" });
  });

  it("un rifiuto del motore è `rifiuto`; senza motore è `assente` e non chiede niente", async () => {
    const { motore } = motoreCon(() => ({ refused: "empty", reading: null }));
    const porta = creaPortaTemi({ motore, carica: CARICA, vita: openLifetime() });
    expect(await porta.togli("X")).toEqual({ kind: "rifiuto" });
    const senza = creaPortaTemi({ motore: null, carica: CARICA, vita: openLifetime() });
    expect(await senza.elenco()).toEqual({ kind: "assente" });
  });
});

describe("i controlli prima del motore", () => {
  it("il nome vuoto o già di un tema si riconosce senza il motore (un errore ferma la sessione)", () => {
    const temi = [{ nome: "Tramonto", colori: ["#ff0000"] }];
    expect(problemaDelTema("  ", temi)).toBe("vuoto");
    expect(problemaDelTema("tramonto", temi)).toBe("preso");
    expect(problemaDelTema("Mare", temi)).toBeNull();
  });

  it("temiDi salta le righe che non si leggono", () => {
    expect(temiDi({ themes: [{ name: "A", colors: ["#ff0000"] }, { name: "", colors: [] }, 3] })).toEqual([{ nome: "A", colori: ["#ff0000"] }]);
    expect(temiDi(null)).toEqual([]);
  });
});
