// La coda della Gomma dei punti (`gomma-punti.ts`) con una sessione finta: un
// tratto è un comando, un clic non chiama niente, niente selezione o motore
// assente si dicono e non chiamano, un rifiuto arriva all'esito, due tratti
// partono in fila, e dopo `chiudi` non si applica più niente.

import { describe, expect, it } from "vitest";
import type { DrawingOutcome } from "../../../host/contract";
import { CodaGommaPunti, COMANDO_GOMMA_PUNTI, segnoDelTratto, tratto, valoreGomma, type FraseGomma } from "./gomma-punti";
import type { SessioneMotore } from "./sessione";

const esitoVuoto = (selection: string[], refused: DrawingOutcome["refused"] = null): DrawingOutcome => ({
  revision: "1",
  preview: null,
  ops: refused === null ? "[]" : null,
  selection,
  losses: [],
  refused,
  frame: null,
});

/// Una sessione che registra i comandi; `attesa` ritarda la risposta del primo.
function sessioneFinta(risposte: Array<DrawingOutcome | null> = [], attesa: Promise<void> = Promise.resolve()) {
  const chiamate: Array<{ id: string; selection: string[]; value: unknown; preview: boolean }> = [];
  let n = 0;
  const sessione = {
    comando: async (request: { id: string; selection: string[]; value: unknown; preview: boolean }) => {
      chiamate.push(request);
      if (n++ === 0) await attesa;
      return risposte.shift() ?? esitoVuoto(request.selection);
    },
  } as unknown as SessioneMotore;
  return { sessione, chiamate };
}

function coda(opzioni: { sessione?: SessioneMotore | null; selezione?: string[]; accettaFrasi?: boolean } = {}) {
  const esiti: DrawingOutcome[] = [];
  const frasi: FraseGomma[] = [];
  let selezione = opzioni.selezione ?? ["oc1c1c1c1"];
  const c = new CodaGommaPunti({
    sessione: async () => (opzioni.sessione === undefined ? null : opzioni.sessione),
    selezione: () => selezione,
    esito: (e) => esiti.push(e),
    dici: (f) => frasi.push(f),
  });
  return { c, esiti, frasi, scegli: (s: string[]) => (selezione = s) };
}

const tuttiMarcati = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const TRATTO: Array<[number, number]> = [
  [10, 10],
  [20, 12],
  [30, 15],
];

describe("tratto e valore", () => {
  it("un clic senza movimento non è un tratto", () => {
    expect(tratto([[10, 10]])).toBeNull();
    expect(tratto([[10, 10], [10, 10]])).toBeNull();
  });

  it("i punti ripetuti e quelli non finiti si tolgono", () => {
    expect(tratto([[10, 10], [10, 10], [Number.NaN, 3], [20, 12]])).toEqual([[10, 10], [20, 12]]);
  });

  it("il valore porta i punti arrotondati e non porta il diametro", () => {
    expect(valoreGomma([[1.23456, 2], [3, 4]])).toEqual({ points: [[1.235, 2], [3, 4]] });
    expect(valoreGomma([[1, 2], [3, 4]])).not.toHaveProperty("diameter");
  });

  it("il segno del tratto è una linea tratteggiata nella scena", () => {
    const segno = segnoDelTratto(TRATTO);
    expect(segno.tag).toBe("path");
    expect(segno.attrs.d).toBe("M10 10 L20 12 L30 15");
  });
});

describe("la coda", () => {
  it("un trascinamento è un comando, con i punti e la selezione", async () => {
    const { sessione, chiamate } = sessioneFinta([esitoVuoto(["oc1c1c1c1"])]);
    const { c, esiti } = coda({ sessione });
    c.lancia(TRATTO);
    await tuttiMarcati();
    expect(chiamate).toEqual([
      { id: COMANDO_GOMMA_PUNTI, selection: ["oc1c1c1c1"], value: valoreGomma(TRATTO), preview: false },
    ]);
    expect(esiti).toHaveLength(1);
  });

  it("un clic senza movimento non chiama il motore e non dice niente", async () => {
    const { sessione, chiamate } = sessioneFinta();
    const { c, frasi } = coda({ sessione });
    c.lancia([[10, 10]]);
    await tuttiMarcati();
    expect(chiamate).toEqual([]);
    expect(frasi).toEqual([]);
  });

  it("senza nulla di scelto dice «Scegli un tracciato.» e non chiama", async () => {
    const { sessione, chiamate } = sessioneFinta();
    const { c, frasi } = coda({ sessione, selezione: [] });
    c.lancia(TRATTO);
    await tuttiMarcati();
    expect(chiamate).toEqual([]);
    expect(frasi).toEqual(["draw.gomma_punti.scegli"]);
  });

  it("con il motore assente lo dice e non chiama", async () => {
    const { c, frasi } = coda({ sessione: null });
    c.lancia(TRATTO);
    await tuttiMarcati();
    expect(frasi).toEqual(["draw.gomma_punti.assente"]);
  });

  it("un rifiuto del motore arriva all'esito, senza passi", async () => {
    const { sessione } = sessioneFinta([esitoVuoto(["oc1c1c1c1"], "empty")]);
    const { c, esiti, frasi } = coda({ sessione });
    c.lancia(TRATTO);
    await tuttiMarcati();
    expect(esiti.map((e) => e.refused)).toEqual(["empty"]);
    expect(frasi).toEqual([]);
  });

  it("due tratti di fila sono due comandi in ordine: il secondo parte quando il primo è applicato", async () => {
    const primo = deferred<void>();
    const chiamate: Array<{ value: unknown }> = [];
    const sessione = {
      comando: async (request: { value: unknown; selection: string[] }) => {
        chiamate.push({ value: request.value });
        if (chiamate.length === 1) await primo.promise;
        return esitoVuoto(request.selection);
      },
    } as unknown as SessioneMotore;
    const { c, esiti } = coda({ sessione, selezione: ["oc1c1c1c1"] });
    c.lancia(TRATTO);
    c.lancia([[50, 50], [60, 60]]);
    await tuttiMarcati();
    expect(chiamate).toHaveLength(1);
    primo.resolve();
    await tuttiMarcati();
    expect(chiamate.map((r) => r.value)).toEqual([valoreGomma(TRATTO), valoreGomma([[50, 50], [60, 60]])]);
    expect(esiti).toHaveLength(2);
  });

  it("chiusa a metà, la risposta in volo non si applica", async () => {
    const risposta = deferred<void>();
    const sessione = {
      comando: async (request: { selection: string[] }) => {
        await risposta.promise;
        return esitoVuoto(request.selection);
      },
    } as unknown as SessioneMotore;
    const { c, esiti } = coda({ sessione });
    c.lancia(TRATTO);
    await tuttiMarcati();
    c.chiudi();
    risposta.resolve();
    await tuttiMarcati();
    expect(esiti).toEqual([]);
  });

  it("chiusa prima di partire, non chiama affatto", async () => {
    const { sessione, chiamate } = sessioneFinta();
    const { c } = coda({ sessione });
    c.lancia(TRATTO);
    c.chiudi();
    await tuttiMarcati();
    expect(chiamate).toEqual([]);
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}
