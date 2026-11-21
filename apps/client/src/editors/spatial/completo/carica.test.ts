// Le famiglie del Completo, una alla volta (piano K6, T5): la macchina a
// stati di `carica.ts`, con chunk e motore finti, e la preparazione vera sulla
// sessione del motore.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAWING_COMMAND_FAMILY_PREPARE, DRAWING_FAMILIES, type DrawingOutcome } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { ComandoMotore, MotoreAssente, SessioneMotore } from "../motore/sessione";
import { caricatore, preparaNelMotore, type ContestoCompleto, type EsitoPrepara, type ModuloFamiglia } from "./carica";

/// Una promessa che il test risolve quando vuole.
function rinviata<T>(): { promessa: Promise<T>; risolvi: (v: T) => void; rifiuta: (e: unknown) => void } {
  let risolvi!: (v: T) => void;
  let rifiuta!: (e: unknown) => void;
  const promessa = new Promise<T>((ok, ko) => {
    risolvi = ok;
    rifiuta = ko;
  });
  return { promessa, risolvi, rifiuta };
}

const lifetimes: Lifetime[] = [];
afterEach(() => {
  for (const life of lifetimes.splice(0)) life.close();
});

function contesto(motore: MotoreDelDisegno | null = null): ContestoCompleto {
  const life = openLifetime();
  lifetimes.push(life);
  return { motore, life };
}

/// I chunk finti: un modulo per famiglia, con `registra` spiato.
function moduli(registra = vi.fn<(ctx: ContestoCompleto) => void>()) {
  const carichi = vi.fn((id: string) => Promise.resolve({ default: { registra } satisfies ModuloFamiglia, id }));
  const tutti = Object.fromEntries(DRAWING_FAMILIES.map((id) => [`./famiglie/${id}/index.ts`, () => carichi(id)]));
  return { tutti, carichi, registra };
}

describe("famiglia(id)", () => {
  it("assente → in arrivo → pronta, e registra una volta sola", async () => {
    const { tutti, registra } = moduli();
    const prepara = vi.fn(() => Promise.resolve<EsitoPrepara>("pronta"));
    const ctx = contesto();
    const carica = caricatore({ ctx, moduli: tutti, prepara });
    const visti: string[] = [];
    carica.quandoCambia((id) => visti.push(`${id}:${carica.stato(id).kind}`));
    expect(carica.stato("nucleo")).toEqual({ kind: "assente" });
    const attesa = carica.famiglia("nucleo");
    expect(carica.stato("nucleo").kind).toBe("in-arrivo");
    expect(await attesa).toEqual({ kind: "pronta" });
    expect(visti).toEqual(["nucleo:in-arrivo", "nucleo:pronta"]);
    expect(prepara).toHaveBeenCalledWith("nucleo");
    expect(registra).toHaveBeenCalledTimes(1);
    expect(registra).toHaveBeenCalledWith(ctx);
    // Già pronta: nessun giro nuovo, nessun'altra registrazione.
    expect(await carica.famiglia("nucleo")).toEqual({ kind: "pronta" });
    expect(await carica.riprova("nucleo")).toEqual({ kind: "pronta" });
    expect(prepara).toHaveBeenCalledTimes(1);
    expect(registra).toHaveBeenCalledTimes(1);
  });

  it("due chiamate insieme fanno un giro solo", async () => {
    const { tutti, carichi } = moduli();
    const motore = rinviata<EsitoPrepara>();
    const prepara = vi.fn(() => motore.promessa);
    const carica = caricatore({ ctx: contesto(), moduli: tutti, prepara });
    const a = carica.famiglia("testo");
    const b = carica.famiglia("testo");
    expect(b).toBe(a);
    motore.risolvi("pronta");
    expect(await a).toEqual({ kind: "pronta" });
    expect(carichi).toHaveBeenCalledTimes(1);
    expect(prepara).toHaveBeenCalledTimes(1);
  });

  it("NoMemory è un errore, e «Riprova» torna in arrivo e poi pronta", async () => {
    const { tutti, registra } = moduli();
    const prepara = vi.fn<(f: string) => Promise<EsitoPrepara>>()
      .mockResolvedValueOnce({ errore: "no-memory" })
      .mockResolvedValue("pronta");
    const carica = caricatore({ ctx: contesto(), moduli: tutti, prepara });
    expect(await carica.famiglia("livelli")).toEqual({ kind: "errore", perche: "no-memory" });
    expect(registra).not.toHaveBeenCalled();
    // In errore, `famiglia` non riprova da sola: lo fa «Riprova».
    expect(await carica.famiglia("livelli")).toEqual({ kind: "errore", perche: "no-memory" });
    expect(prepara).toHaveBeenCalledTimes(1);
    const giro = carica.riprova("livelli");
    expect(carica.stato("livelli").kind).toBe("in-arrivo");
    expect(await giro).toEqual({ kind: "pronta" });
    expect(registra).toHaveBeenCalledTimes(1);
  });

  it("un chunk che non arriva è un errore «chunk», e «Riprova» lo richiede", async () => {
    const { tutti, carichi } = moduli();
    carichi.mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"));
    const carica = caricatore({ ctx: contesto(), moduli: tutti, prepara: () => Promise.resolve("pronta") });
    expect(await carica.famiglia("forme")).toEqual({ kind: "errore", perche: "chunk" });
    expect(await carica.riprova("forme")).toEqual({ kind: "pronta" });
    expect(carichi).toHaveBeenCalledTimes(2);
  });

  it("l'esito di un giro vecchio si butta: vale quello del giro nuovo", async () => {
    const { tutti, registra } = moduli();
    const primo = rinviata<EsitoPrepara>();
    const secondo = rinviata<EsitoPrepara>();
    const prepara = vi.fn<(f: string) => Promise<EsitoPrepara>>()
      .mockReturnValueOnce(primo.promessa)
      .mockReturnValueOnce(secondo.promessa);
    const carica = caricatore({ ctx: contesto(), moduli: tutti, prepara });
    const vecchio = carica.famiglia("colore");
    const giroVecchio = carica.stato("colore");
    const nuovo = carica.riprova("colore");
    const giroNuovo = carica.stato("colore");
    expect(giroVecchio.kind === "in-arrivo" && giroNuovo.kind === "in-arrivo" && giroNuovo.giro > giroVecchio.giro).toBe(true);
    // Il giro vecchio risponde per primo, e con un errore: non conta.
    primo.risolvi({ errore: "motore" });
    await Promise.resolve();
    await Promise.resolve();
    expect(carica.stato("colore")).toEqual(giroNuovo);
    secondo.risolvi("pronta");
    expect(await nuovo).toEqual({ kind: "pronta" });
    // Chi aspettava il giro vecchio riceve l'esito di quello nuovo.
    expect(await vecchio).toEqual({ kind: "pronta" });
    expect(registra).toHaveBeenCalledTimes(1);
  });

  it("il disegno chiuso durante il giro: l'esito si butta e niente si registra", async () => {
    const { tutti, registra } = moduli();
    const motore = rinviata<EsitoPrepara>();
    const carica = caricatore({ ctx: contesto(), moduli: tutti, prepara: () => motore.promessa });
    const ascolto = vi.fn();
    carica.quandoCambia(ascolto);
    const attesa = carica.famiglia("trasforma");
    expect(ascolto).toHaveBeenCalledTimes(1);
    carica.chiudi();
    motore.risolvi("pronta");
    expect(await attesa).toEqual({ kind: "assente" });
    expect(registra).not.toHaveBeenCalled();
    expect(ascolto).toHaveBeenCalledTimes(1);
    // Chiuso, nessuna famiglia si prepara più.
    expect(await carica.famiglia("nucleo")).toEqual({ kind: "assente" });
  });

  it("una famiglia che non c'è è un errore, senza chiedere niente", async () => {
    const { tutti, carichi } = moduli();
    const prepara = vi.fn(() => Promise.resolve<EsitoPrepara>("pronta"));
    const carica = caricatore({ ctx: contesto(), moduli: tutti, prepara });
    expect(await carica.famiglia("../nucleo")).toEqual({ kind: "errore", perche: "chunk" });
    expect(carichi).not.toHaveBeenCalled();
    expect(prepara).not.toHaveBeenCalled();
  });

  it("ogni famiglia della mappa ha il suo chunk, con `registra`", async () => {
    const veri = import.meta.glob("./famiglie/*/index.ts");
    expect(Object.keys(veri).sort()).toEqual(DRAWING_FAMILIES.map((id) => `./famiglie/${id}/index.ts`).sort());
    const carica = caricatore({ ctx: contesto(), prepara: () => Promise.resolve("pronta") });
    const stati = await Promise.all(DRAWING_FAMILIES.map((id) => carica.famiglia(id)));
    expect(stati.every((s) => s.kind === "pronta")).toBe(true);
  });
});

describe("preparaNelMotore", () => {
  const esito = (over: Partial<DrawingOutcome>): DrawingOutcome => ({
    revision: "1", preview: null, ops: null, selection: [], losses: [], refused: null, frame: null, ...over,
  });

  /// Un motore con una sessione che risponde `risposta` a ogni comando.
  function motoreCon(risposta: DrawingOutcome | MotoreAssente | null, aperta = true) {
    const comando = vi.fn((_r: ComandoMotore) => Promise.resolve(risposta));
    const sessione = { kind: "sessione", comando } as unknown as SessioneMotore;
    const pronta = vi.fn(() => Promise.resolve(aperta ? sessione : null));
    return { motore: { pronta } as unknown as MotoreDelDisegno, comando, pronta };
  }

  it("chiede disegno.famiglia.prepara; pronta e in-corso valgono pronta", async () => {
    const { motore, comando } = motoreCon(esito({ reading: { famiglia: "testo", stato: "pronta" } }));
    expect(await preparaNelMotore(motore, "testo")).toBe("pronta");
    expect(comando).toHaveBeenCalledWith({ id: DRAWING_COMMAND_FAMILY_PREPARE, selection: [], value: { famiglia: "testo" } });
    const inCorso = motoreCon(esito({ reading: { famiglia: "testo", stato: "in-corso" } }));
    expect(await preparaNelMotore(inCorso.motore, "testo")).toBe("pronta");
  });

  it("no_memory, un altro rifiuto, il motore assente o senza sessione", async () => {
    expect(await preparaNelMotore(motoreCon(esito({ refused: "no_memory" })).motore, "raster")).toEqual({ errore: "no-memory" });
    expect(await preparaNelMotore(motoreCon(esito({ refused: "closed" })).motore, "raster")).toEqual({ errore: "motore" });
    expect(await preparaNelMotore(motoreCon(esito({ reading: null })).motore, "raster")).toEqual({ errore: "motore" });
    expect(await preparaNelMotore(motoreCon({ kind: "assente", perche: "spento" }).motore, "raster")).toEqual({ errore: "motore" });
    expect(await preparaNelMotore(motoreCon(null, false).motore, "raster")).toEqual({ errore: "motore" });
    expect(await preparaNelMotore(null, "raster")).toEqual({ errore: "motore" });
  });

  it("una sessione chiusa col disegno: la risposta non conta", async () => {
    expect(await preparaNelMotore(motoreCon(null).motore, "raster")).toBeNull();
  });
});
