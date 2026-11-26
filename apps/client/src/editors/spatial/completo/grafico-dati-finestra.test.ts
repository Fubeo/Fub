// @vitest-environment happy-dom
// La finestra «Dati del grafico» (`./grafico-dati-finestra.ts`, riga `graph.setData`): la lettura dei
// dati, il CSV con le etichette fra virgolette che il motore rilegge uguale, i numeri con la virgola,
// la cella che non è un numero, le righe e colonne aggiunte e tolte, Applica che resta aperta,
// Scambia insieme ai dati, Scambia x e y solo per la dispersione, la risposta vecchia che non vince,
// la chiusura col Completo, e la porta vera sul grafico scelto all'apertura.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingCommandRequest, DrawingOutcome } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { DipendenzeComando } from "./esegui";
import { apriFinestraDatiGrafico, creaPortaDatiGrafico, csvDi, datiDi, numeroDi, type DatiGrafico, type PortaDatiGrafico } from "./grafico-dati-finestra";

const DATI: DatiGrafico = { serie: ["Mele", "Pere"], categorie: ["2024", "2025"], righe: [[3, 2], [null, 5.5]] };

const lifetimes: Lifetime[] = [];
afterEach(() => {
  for (const life of lifetimes.splice(0)) life.close();
  document.body.replaceChildren();
});
function vita(): Lifetime {
  const life = openLifetime();
  lifetimes.push(life);
  return life;
}

const parola = (chiave: string, valori: Readonly<Record<string, string>> = {}): string =>
  Object.entries(valori).reduce((testo, [nome, valore]) => `${testo} ${nome}=${valore}`, chiave);

function portaFinta(over: Partial<PortaDatiGrafico> = {}, tipo: string | null = "column") {
  return {
    leggi: vi.fn(() => Promise.resolve<{ dati: DatiGrafico; tipo: string | null } | null>({ dati: DATI, tipo })),
    manda: vi.fn((_valore: { csv: string; transpose?: true; switchXY?: true }) => Promise.resolve<{ rifiuto: string | null } | null>({ rifiuto: null })),
    ...over,
  };
}

const attesa = () => new Promise((r) => setTimeout(r, 0));
const finestra = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');
const tasto = (azione: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`[data-action="${azione}"]`)!;
const celle = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>(".draw-graph-data-cell")];
const righe = (): string[][] => [...document.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("input")].map((i) => i.value));
function scrivi(campo: HTMLInputElement, valore: string): void {
  campo.value = valore;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("le regole", () => {
  it("la lettura del motore diventa dati; una lettura storta no", () => {
    expect(datiDi({ csv: "", series: ["A"], categories: ["x"], rows: [[1, null, "z"]] })).toEqual({ serie: ["A"], categorie: ["x"], righe: [[1, null, null]] });
    expect(datiDi(null)).toBeNull();
    expect(datiDi({ series: [] })).toBeNull();
  });

  it("il CSV ha le etichette fra virgolette, le celle vuote e le colonne della riga più larga", () => {
    expect(csvDi(DATI)).toBe(',"Mele","Pere"\n"2024",3,2\n"2025",,5.5');
    expect(csvDi({ serie: [], categorie: ['a "b"'], righe: [[1, 2]] })).toBe(',"",""\n"a ""b""",1,2');
  });

  it("un numero si scrive col punto o con la virgola; vuoto è un valore che manca", () => {
    expect(numeroDi(" 3,5 ")).toBe(3.5);
    expect(numeroDi("-2e3")).toBe(-2000);
    expect(numeroDi("")).toBeNull();
    expect(numeroDi("tre")).toBeUndefined();
    expect(numeroDi("1,2,3")).toBeUndefined();
  });
});

describe("la finestra Dati del grafico", () => {
  it("mostra i dati letti: le serie in alto, le categorie a sinistra", async () => {
    apriFinestraDatiGrafico(portaFinta(), parola, vita());
    await attesa();
    expect(finestra()).not.toBeNull();
    expect(righe()).toEqual([
      ["Mele", "Pere"],
      ["2024", "3", "2"],
      ["2025", "", "5.5"],
    ]);
  });

  it("Applica manda il CSV della tabella e resta aperta; poi rilegge", async () => {
    const porta = portaFinta();
    apriFinestraDatiGrafico(porta, parola, vita());
    await attesa();
    scrivi(celle()[3]!, "4,25");
    tasto("apply").click();
    await attesa();
    expect(porta.manda).toHaveBeenCalledWith({ csv: ',"Mele","Pere"\n"2024",4.25,2\n"2025",,5.5' });
    expect(finestra()).not.toBeNull();
    expect(porta.leggi).toHaveBeenCalledTimes(2);
  });

  it("una cella che non è un numero non parte e dice dove", async () => {
    const porta = portaFinta();
    apriFinestraDatiGrafico(porta, parola, vita());
    await attesa();
    scrivi(celle()[6]!, "molti");
    tasto("apply").click();
    await attesa();
    expect(porta.manda).not.toHaveBeenCalled();
    expect(finestra()!.textContent).toContain("dati:nonNumero riga=2 colonna=1");
  });

  it("righe e colonne si aggiungono e si tolgono in fondo, mai sotto una", async () => {
    apriFinestraDatiGrafico(portaFinta(), parola, vita());
    await attesa();
    tasto("addRow").click();
    tasto("addColumn").click();
    expect(righe()).toEqual([
      ["Mele", "Pere", ""],
      ["2024", "3", "2", ""],
      ["2025", "", "5.5", ""],
      ["", "", "", ""],
    ]);
    tasto("removeRow").click();
    tasto("removeRow").click();
    tasto("removeColumn").click();
    tasto("removeColumn").click();
    expect(righe()).toEqual([["Mele"], ["2024", "3"]]);
    expect(tasto("removeRow").disabled).toBe(true);
    expect(tasto("removeColumn").disabled).toBe(true);
  });

  it("Scambia righe e colonne parte coi dati scritti; Scambia x e y solo per la dispersione", async () => {
    const porta = portaFinta();
    apriFinestraDatiGrafico(porta, parola, vita());
    await attesa();
    expect(tasto("switchXY").disabled).toBe(true);
    scrivi(celle()[0]!, "Arance");
    tasto("transpose").click();
    await attesa();
    expect(porta.manda).toHaveBeenLastCalledWith({ csv: ',"Arance","Pere"\n"2024",3,2\n"2025",,5.5', transpose: true });

    document.body.replaceChildren();
    const dispersione = portaFinta({}, "scatter");
    apriFinestraDatiGrafico(dispersione, parola, vita());
    await attesa();
    expect(tasto("switchXY").disabled).toBe(false);
    tasto("switchXY").click();
    await attesa();
    expect(vi.mocked(dispersione.manda).mock.calls[0]![0]).toMatchObject({ switchXY: true });
  });

  it("un rifiuto del motore resta scritto, e la tabella non cambia", async () => {
    const porta = portaFinta({ manda: vi.fn(() => Promise.resolve({ rifiuto: "troppe serie" })) });
    apriFinestraDatiGrafico(porta, parola, vita());
    await attesa();
    tasto("transpose").click();
    await attesa();
    expect(finestra()!.textContent).toContain("dati:errore motivo=troppe serie");
    expect(porta.leggi).toHaveBeenCalledTimes(1);
  });

  it("senza un grafico scelto lo dice; Ripristina rilegge e la risposta vecchia non vince", async () => {
    let risolvi: ((v: { dati: DatiGrafico; tipo: string | null } | null) => void)[] = [];
    const porta = portaFinta({ leggi: vi.fn(() => new Promise<{ dati: DatiGrafico; tipo: string | null } | null>((r) => risolvi.push(r))) });
    apriFinestraDatiGrafico(porta, parola, vita());
    tasto("revert").click();
    const [vecchia, nuova] = risolvi;
    risolvi = [];
    nuova!({ dati: { serie: ["Nuova"], categorie: ["c"], righe: [[1]] }, tipo: "line" });
    await attesa();
    vecchia!({ dati: DATI, tipo: "column" });
    await attesa();
    expect(righe()[0]).toEqual(["Nuova"]);

    document.body.replaceChildren();
    apriFinestraDatiGrafico(portaFinta({ leggi: vi.fn(() => Promise.resolve(null)) }), parola, vita());
    await attesa();
    expect(finestra()!.textContent).toContain("dati:nessunGrafico");
  });

  it("Chiudi ed Esc non mandano niente; chiuso il Completo, la finestra si chiude", async () => {
    const porta = portaFinta();
    apriFinestraDatiGrafico(porta, parola, vita());
    await attesa();
    scrivi(celle()[3]!, "9");
    tasto("close").click();
    await attesa();
    expect(finestra()).toBeNull();
    expect(porta.manda).not.toHaveBeenCalled();

    const dalCompleto = vita();
    apriFinestraDatiGrafico(portaFinta(), parola, dalCompleto);
    await attesa();
    dalCompleto.close();
    await attesa();
    expect(finestra()).toBeNull();
  });

  it("la porta vera legge e manda sul grafico scelto all'apertura, poi sulla selezione che il motore rende", async () => {
    const comandi: DrawingCommandRequest[] = [];
    const risposta = (reading: unknown, selection: string[] = []): DrawingOutcome =>
      ({ revision: "1", preview: null, ops: null, selection, losses: [], refused: null, frame: null, reading }) as unknown as DrawingOutcome;
    const sessione = {
      comando: vi.fn((richiesta: Omit<DrawingCommandRequest, "revision">) => {
        comandi.push(richiesta as DrawingCommandRequest);
        const valore = richiesta.value as Record<string, unknown>;
        if (richiesta.id === "disegno.graph.setData" && Object.keys(valore).length === 0)
          return Promise.resolve(risposta({ csv: "", series: ["A"], categories: ["x"], rows: [[1]] }));
        if (richiesta.id === "disegno.graph.setType") return Promise.resolve(risposta({ type: "scatter" }));
        return Promise.resolve(risposta(null, ["g2"]));
      }),
    };
    let selezione = ["g1"];
    const dipendenze = {
      motore: { pronta: () => Promise.resolve(sessione), assente: () => null },
      selezione: () => selezione,
      vita: vita(),
      leggi: () => null,
      commit: () => true,
      seleziona: () => undefined,
      annuncia: () => undefined,
    } as unknown as DipendenzeComando;
    const porta = creaPortaDatiGrafico(dipendenze, "Dati del grafico");
    selezione = ["altro"];
    expect(await porta.leggi()).toEqual({ dati: { serie: ["A"], categorie: ["x"], righe: [[1]] }, tipo: "scatter" });
    await porta.manda({ csv: ',"A"\n"x",2', transpose: true });
    await porta.leggi();
    expect(comandi.map((c) => [c.id, c.selection])).toEqual([
      ["disegno.graph.setData", ["g1"]],
      ["disegno.graph.setType", ["g1"]],
      ["disegno.graph.setData", ["g1"]],
      ["disegno.graph.setData", ["g2"]],
      ["disegno.graph.setType", ["g2"]],
    ]);
    expect(comandi[2]!.value).toEqual({ csv: ',"A"\n"x",2', transpose: true });
  });
});
