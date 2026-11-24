// @vitest-environment happy-dom
// Gli Oggetti sul tracciato nel client: la sezione del Design (`../../oggetti-sul-tracciato-sezione.ts`)
// e la fila dello strumento (`./opzioni-oggetti-sul-tracciato.ts`), come VectorCraft. La sezione
// c'è solo se ogni oggetto scelto è un gruppo; perno e rotazione vuoti dove i gruppi differiscono;
// ogni cambio manda `object.objectsOnPath.options` a tutti i gruppi. La fila cambia le opzioni
// dello strumento (`pivot`, `rotate`).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingToolState } from "../../../../../host/contract";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import type { MotoreDelDisegno } from "../../../motore/gesti";
import type { AzioniFila } from "../../opzioni";
import { COMANDO_OPZIONI_OGGETTI_SUL_TRACCIATO, eGruppoSulTracciato, sezioneOggettiSulTracciato, statoDaiNodi } from "../../oggetti-sul-tracciato-sezione";
import { filaOggettiSulTracciato, opzioniOggettiSulTracciato } from "./opzioni-oggetti-sul-tracciato";

const vite: Lifetime[] = [];
afterEach(() => {
  while (vite.length > 0) vite.pop()!.close();
  document.body.replaceChildren();
});
const giro = (): Promise<void> => new Promise((risolto) => setTimeout(risolto, 0));
const gruppo = (pivot?: number, rotate?: number) => ({ id: 3, kind: { Group: {} }, objects_on_path: { path: 8, members: [], ...(pivot === undefined ? {} : { pivot }), ...(rotate === undefined ? {} : { rotate }) } });

describe("la lettura dei gruppi", () => {
  it("vale solo se ogni oggetto scelto è un gruppo; i valori di serie dove mancano", () => {
    expect(eGruppoSulTracciato(gruppo())).toBe(true);
    expect(eGruppoSulTracciato({ id: 2, kind: "Path" })).toBe(false);
    expect(statoDaiNodi(["a"], [gruppo()])).toEqual({ ids: ["a"], perno: 4, rotazione: 0 });
    expect(statoDaiNodi(["a", "b"], [gruppo(1, 45), { id: 2 }])).toBeNull();
    expect(statoDaiNodi([], [])).toBeNull();
  });
  it("perno e rotazione vuoti dove i gruppi differiscono", () => {
    expect(statoDaiNodi(["a", "b"], [gruppo(1, 45), gruppo(1, 30)])).toEqual({ ids: ["a", "b"], perno: 1, rotazione: null });
    expect(statoDaiNodi(["a", "b"], [gruppo(0, 45), gruppo(2, 45)])).toEqual({ ids: ["a", "b"], perno: null, rotazione: 45 });
  });
});

function disegna(letto: { ids: string[]; nodi: unknown[] } | null, motore: MotoreDelDisegno | null = {} as MotoreDelDisegno) {
  const esegui = vi.fn(() => Promise.resolve());
  const leggi = vi.fn(() => Promise.resolve(letto));
  const mostra = vi.fn();
  const corpo = document.createElement("div");
  document.body.append(corpo);
  const vita = openLifetime();
  vite.push(vita);
  const sezione = sezioneOggettiSulTracciato({ esegui, leggi });
  sezione.disegna({ corpo, sel: { numero: letto?.ids.length ?? 0, punti: [] }, motore, aggiorna: vi.fn(), rileggi: vi.fn(), vita, mostra } as never);
  return { sezione, corpo, esegui, leggi, mostra, vita };
}

describe("la sezione del Design", () => {
  it("nasce nascosta e si mostra coi gruppi scelti", async () => {
    const p = disegna({ ids: ["g1", "g2"], nodi: [gruppo(4, 15), gruppo(4, 15)] });
    expect(p.sezione.nascostaAllInizio).toBe(true);
    await giro();
    expect(p.mostra).toHaveBeenLastCalledWith(true);
    expect(p.corpo.querySelector("[role=radio][aria-checked=true]")?.getAttribute("data-point")).toBe("4");
    expect(p.corpo.querySelector<HTMLInputElement>(".kit-number input")!.value).toBe("15");
  });
  it("resta nascosta senza gruppi, senza lettura o senza motore", async () => {
    const senza = disegna(null);
    await giro();
    expect(senza.mostra).toHaveBeenLastCalledWith(false);
    const misti = disegna({ ids: ["g1", "p"], nodi: [gruppo(), { id: 2 }] });
    await giro();
    expect(misti.mostra).toHaveBeenLastCalledWith(false);
    expect(misti.corpo.childElementCount).toBe(0);
    const spento = disegna({ ids: ["g1"], nodi: [gruppo()] }, null);
    expect(spento.mostra).toHaveBeenCalledWith(false);
    expect(spento.leggi).not.toHaveBeenCalled();
  });
  it("il perno e la rotazione vanno a tutti i gruppi scelti, col solo valore cambiato", async () => {
    const p = disegna({ ids: ["g1", "g2"], nodi: [gruppo(0, 10), gruppo(2, 20)] });
    await giro();
    expect(p.corpo.querySelector("[role=radio][aria-checked=true]")).toBeNull();
    p.corpo.querySelector<HTMLButtonElement>("[data-point='8']")!.click();
    expect(p.esegui).toHaveBeenLastCalledWith(COMANDO_OPZIONI_OGGETTI_SUL_TRACCIATO, { ids: ["g1", "g2"], pivot: 8 });
    const rotazione = p.corpo.querySelector<HTMLInputElement>(".kit-number input")!;
    expect(rotazione.value).toBe("");
    rotazione.value = "-45";
    rotazione.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(p.esegui).toHaveBeenLastCalledWith(COMANDO_OPZIONI_OGGETTI_SUL_TRACCIATO, { ids: ["g1", "g2"], rotate: -45 });
  });
  it("una lettura che arriva dopo la fine del giro si butta", async () => {
    const p = disegna({ ids: ["g1"], nodi: [gruppo()] });
    p.vita.close();
    await giro();
    expect(p.mostra).not.toHaveBeenCalled();
    expect(p.corpo.childElementCount).toBe(0);
  });
});

const stato = (options: unknown): DrawingToolState => ({ options }) as unknown as DrawingToolState;

function monta(options: unknown) {
  const vita = openLifetime();
  vite.push(vita);
  const opzione = vi.fn<AzioniFila["opzione"]>();
  const azioni: AzioniFila = { esegui: vi.fn(), leggi: vi.fn(() => Promise.resolve(null)), annuncia: vi.fn(), opzione };
  const fila = filaOggettiSulTracciato(stato(options), azioni, vita)!;
  document.body.append(fila.element);
  return { fila, opzione, vita };
}

describe("la fila dello strumento", () => {
  it("legge perno e rotazione, coi valori di serie di VectorCraft", () => {
    expect(opzioniOggettiSulTracciato({ pivot: 2, rotate: 30.5 })).toEqual({ perno: 2, rotazione: 30.5 });
    expect(opzioniOggettiSulTracciato({ pivot: 12, rotate: "x" })).toEqual({ perno: 4, rotazione: 0 });
    expect(opzioniOggettiSulTracciato(null)).toEqual({ perno: 4, rotazione: 0 });
  });
  it("il perno e la rotazione cambiano le opzioni dello strumento", () => {
    const { fila, opzione } = monta({ pivot: 4, rotate: 0 });
    expect(fila.element.querySelector("[role=radio][aria-checked=true]")?.getAttribute("data-point")).toBe("4");
    fila.element.querySelector<HTMLButtonElement>("[data-point='0']")!.click();
    expect(opzione).toHaveBeenLastCalledWith("pivot", 0);
    const campo = fila.element.querySelector<HTMLInputElement>(".kit-number input")!;
    campo.value = "90";
    campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(opzione).toHaveBeenLastCalledWith("rotate", 90);
  });
  it("un valore uguale del motore non rifà i controlli; uno diverso sì", () => {
    const { fila } = monta({ pivot: 4, rotate: 0 });
    const prima = fila.element.querySelector(".kit-reference-point");
    expect(fila.aggiorna({ pivot: 4, rotate: 0 })).toBe(true);
    expect(fila.element.querySelector(".kit-reference-point")).toBe(prima);
    fila.aggiorna({ pivot: 6, rotate: 0 });
    expect(fila.element.querySelector(".kit-reference-point")).not.toBe(prima);
    expect(fila.element.querySelector("[role=radio][aria-checked=true]")?.getAttribute("data-point")).toBe("6");
  });
});
