// La coda del Pennello tondo (`pennello-tondo.ts`) con una sessione finta: un colpo è un comando col colore,
// un clic fermo è un punto, senza punti non si chiama, il motore assente si dice, un rifiuto arriva
// all'esito, due colpi partono in fila, e dopo `chiudi` non si chiama né si applica più niente.

import { describe, expect, it } from "vitest";
import type { DrawingOutcome } from "../../../host/contract";
import { COMANDO_PENNELLO, CodaPennello, colpo, segnoDelColpo, valorePennello } from "./pennello-tondo";
import type { SessioneMotore } from "./sessione";

const esito = (refused: DrawingOutcome["refused"] = null): DrawingOutcome => ({
  revision: "1",
  preview: null,
  ops: refused === null ? "[]" : null,
  selection: [],
  losses: [],
  refused,
  frame: null,
});

function sessioneFinta(risposta: () => Promise<DrawingOutcome | null> = async () => esito()) {
  const chiamate: Array<{ id: string; selection: string[]; value: unknown; preview: boolean }> = [];
  const sessione = {
    comando: async (request: { id: string; selection: string[]; value: unknown; preview: boolean }) => {
      chiamate.push(request);
      return risposta();
    },
  } as unknown as SessioneMotore;
  return { sessione, chiamate };
}

function coda(opzioni: { sessione?: SessioneMotore | null } = {}) {
  const esiti: DrawingOutcome[] = [];
  const frasi: string[] = [];
  const c = new CodaPennello({
    sessione: async () => (opzioni.sessione === undefined ? null : opzioni.sessione),
    esito: (e) => esiti.push(e),
    dici: (f) => frasi.push(f),
    rifiutati: (r) => frasi.push(r.message),
  });
  return { c, esiti, frasi };
}

const tuttiMarcati = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("colpo e valore", () => {
  it("senza punti non c'è colpo, con un punto solo c'è un tondo", () => {
    expect(colpo([])).toBeNull();
    expect(colpo([[10, 10]])).toEqual([[10, 10]]);
  });

  it("i punti ripetuti e quelli non finiti si tolgono", () => {
    expect(colpo([[10, 10], [10, 10], [Number.NaN, 3], [20, 12]])).toEqual([[10, 10], [20, 12]]);
  });

  it("il valore porta i punti arrotondati e il colore, senza diametro", () => {
    expect(valorePennello([[1.23456, 2]], "#ff0000")).toEqual({ points: [[1.235, 2]], color: "#ff0000" });
    expect(valorePennello([[1, 2]], "#ff0000")).not.toHaveProperty("size");
  });

  it("il segno del colpo è tratteggiato col suo colore, nella scena", () => {
    const segno = segnoDelColpo([[10, 10], [20, 12]], "#00ff00");
    expect(segno.attrs.d).toBe("M10 10 L20 12");
    expect(segno.attrs.stroke).toBe("#00ff00");
  });
});

describe("la coda", () => {
  it("un colpo è un comando col colore e i punti, senza selezione", async () => {
    const { sessione, chiamate } = sessioneFinta();
    const { c, esiti } = coda({ sessione });
    c.lancia([[10, 10], [40, 20]], "#ff0000");
    await tuttiMarcati();
    expect(chiamate).toEqual([{ id: COMANDO_PENNELLO, selection: [], value: valorePennello([[10, 10], [40, 20]], "#ff0000"), preview: false }]);
    expect(esiti).toHaveLength(1);
  });

  it("un clic fermo manda un punto solo", async () => {
    const { sessione, chiamate } = sessioneFinta();
    const { c } = coda({ sessione });
    c.lancia([[10, 10]], "#ff0000");
    await tuttiMarcati();
    expect(chiamate).toHaveLength(1);
    expect((chiamate[0]!.value as { points: unknown[] }).points).toEqual([[10, 10]]);
  });

  it("senza punti non chiama e non dice niente", async () => {
    const { sessione, chiamate } = sessioneFinta();
    const { c, frasi } = coda({ sessione });
    c.lancia([], "#ff0000");
    await tuttiMarcati();
    expect(chiamate).toEqual([]);
    expect(frasi).toEqual([]);
  });

  it("con il motore assente lo dice e non chiama", async () => {
    const { c, frasi } = coda({ sessione: null });
    c.lancia([[10, 10], [20, 20]], "#ff0000");
    await tuttiMarcati();
    expect(frasi).toEqual(["draw.pennello.assente"]);
  });

  it("un rifiuto del motore arriva all'esito, senza passi", async () => {
    const { sessione } = sessioneFinta(async () => esito("locked"));
    const { c, esiti, frasi } = coda({ sessione });
    c.lancia([[10, 10], [20, 20]], "#ff0000");
    await tuttiMarcati();
    expect(esiti.map((e) => e.refused)).toEqual(["locked"]);
    expect(frasi).toEqual([]);
  });

  it("due colpi di fila sono due comandi in ordine: il secondo parte quando il primo è applicato", async () => {
    let libera: () => void = () => {};
    const primo = new Promise<void>((ok) => {
      libera = ok;
    });
    const chiamate: unknown[] = [];
    const sessione = {
      comando: async (request: { value: unknown }) => {
        chiamate.push(request.value);
        if (chiamate.length === 1) await primo;
        return esito();
      },
    } as unknown as SessioneMotore;
    const { c, esiti } = coda({ sessione });
    c.lancia([[10, 10], [20, 20]], "#ff0000");
    c.lancia([[50, 50], [60, 60]], "#0000ff");
    await tuttiMarcati();
    expect(chiamate).toHaveLength(1);
    libera();
    await tuttiMarcati();
    expect(chiamate).toEqual([valorePennello([[10, 10], [20, 20]], "#ff0000"), valorePennello([[50, 50], [60, 60]], "#0000ff")]);
    expect(esiti).toHaveLength(2);
  });

  it("chiusa prima di partire non chiama; chiusa a metà non applica l'esito in volo", async () => {
    const { sessione, chiamate } = sessioneFinta();
    const { c } = coda({ sessione });
    c.lancia([[10, 10], [20, 20]], "#ff0000");
    c.chiudi();
    await tuttiMarcati();
    expect(chiamate).toEqual([]);

    let libera: () => void = () => {};
    const attesa = new Promise<void>((ok) => {
      libera = ok;
    });
    const lenta = {
      comando: async () => {
        await attesa;
        return esito();
      },
    } as unknown as SessioneMotore;
    const { c: c2, esiti } = coda({ sessione: lenta });
    c2.lancia([[10, 10], [20, 20]], "#ff0000");
    await tuttiMarcati();
    c2.chiudi();
    libera();
    await tuttiMarcati();
    expect(esiti).toEqual([]);
  });
});
