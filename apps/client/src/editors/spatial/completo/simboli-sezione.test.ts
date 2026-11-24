// @vitest-environment happy-dom
// La sezione «Simboli» di Risorse (`./simboli-sezione.ts`): la lista letta dal motore, la scelta che è
// anche il simbolo corrente, i pulsanti spenti finché manca ciò che serve, ogni pulsante col suo
// comando e i suoi valori, i non usati scelti nella lista e le librerie.

import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { librerieDi, nomiDi, problemaDelNome, sezioneSimboli, simboliDi, type SimboloCorrente } from "./simboli-sezione";

const vite: Lifetime[] = [];
afterEach(() => {
  while (vite.length > 0) vite.pop()!.close();
});

/// Un motore finto: la lista, i non usati, le librerie; i comandi si registrano.
function monta(numero = 0, simboli = [{ name: "Stella", instances: 2 }, { name: "Foglia", instances: 0 }]) {
  const leggi = vi.fn((id: string, valore: Readonly<Record<string, unknown>>): Promise<unknown> => {
    if (id === "symbol.list") return Promise.resolve({ symbols: simboli, current: null });
    if (id === "symbol.unused") return Promise.resolve({ names: ["Foglia"] });
    if (id === "symbol.libraries") return Promise.resolve({ libraries: [{ id: "frecce", name: "Frecce", category: "builtIn", count: 1 }] });
    if (id === "symbol.library") return Promise.resolve({ id: valore.library, name: "Frecce", symbols: [{ name: "Freccia 1" }] });
    return Promise.resolve(null);
  });
  const esegui = vi.fn((_id: string, _valori: Readonly<Record<string, unknown>>) => Promise.resolve());
  const corrente: SimboloCorrente = { nome: null };
  const corpo = document.createElement("div");
  document.body.append(corpo);
  const vita = openLifetime();
  vite.push(vita);
  sezioneSimboli({ leggi, esegui }, corrente).disegna({ corpo, sel: { numero, punti: [] }, vita, rileggi: () => undefined } as never);
  return { corpo, leggi, esegui, corrente };
}

function bottone(corpo: HTMLElement, testo: string): HTMLButtonElement {
  const trovato = [...corpo.querySelectorAll("button")].find((b) => b.textContent?.startsWith(testo));
  if (!trovato) throw new Error(`manca il pulsante «${testo}»`);
  return trovato;
}

function scrivi(corpo: HTMLElement, valore: string): void {
  const campo = corpo.querySelector("input") as HTMLInputElement;
  campo.value = valore;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("le letture", () => {
  it("prendono solo le righe che si leggono", () => {
    expect(simboliDi({ symbols: [{ name: "A", instances: 3 }, { name: "" }, { instances: 1 }, { name: "B" }] })).toEqual([
      { nome: "A", istanze: 3 },
      { nome: "B", istanze: 0 },
    ]);
    expect(simboliDi(null)).toEqual([]);
    expect(nomiDi({ names: ["A", 3, ""] }, "names")).toEqual(["A"]);
    expect(nomiDi({ symbols: [{ name: "X" }, {}] }, "symbols")).toEqual(["X"]);
    expect(librerieDi({ libraries: [{ id: "a", name: "A", count: 4 }, { id: 3 }] })).toEqual([{ id: "a", nome: "A", quanti: 4 }]);
  });

  it("un nome vuoto o già di un altro simbolo non va; il suo stesso sì", () => {
    expect(problemaDelNome("  ", "A", [])).toBe("vuoto");
    expect(problemaDelNome("B", "A", [{ nome: "B", istanze: 0 }])).toBe("preso");
    expect(problemaDelNome("A", "A", [{ nome: "A", istanze: 0 }])).toBeNull();
  });
});

describe("la sezione", () => {
  it("mostra i simboli con le istanze; senza scelta i pulsanti di un simbolo sono spenti", async () => {
    const p = monta();
    await vi.waitFor(() => expect(p.corpo.textContent).toContain("Stella"));
    expect(p.corpo.textContent).toContain("istanze: 2");
    expect(bottone(p.corpo, "Inserisci istanza").disabled).toBe(true);
    expect(bottone(p.corpo, "Elimina").disabled).toBe(true);
    // Senza oggetti scelti, Nuovo simbolo è spento e dice perché.
    expect(bottone(p.corpo, "Nuovo simbolo").disabled).toBe(true);
    expect(bottone(p.corpo, "Nuovo simbolo").title).toContain("oggetti");
  });

  it("scegliere un simbolo lo fa corrente, e i comandi partono col suo nome", async () => {
    const p = monta(1);
    await vi.waitFor(() => expect(p.corpo.textContent).toContain("Stella"));
    bottone(p.corpo, "Stella").click();
    expect(p.corrente.nome).toBe("Stella");
    expect(bottone(p.corpo, "Stella").getAttribute("aria-pressed")).toBe("true");
    bottone(p.corpo, "Inserisci istanza").click();
    expect(p.esegui).toHaveBeenLastCalledWith("symbol.place", { name: "Stella" });
    bottone(p.corpo, "Ridefinisci").click();
    expect(p.esegui).toHaveBeenLastCalledWith("symbol.update", { name: "Stella" });
    bottone(p.corpo, "Sostituisci").click();
    expect(p.esegui).toHaveBeenLastCalledWith("symbol.replace", { name: "Stella" });
    bottone(p.corpo, "Seleziona le istanze").click();
    expect(p.esegui).toHaveBeenLastCalledWith("symbol.selectInstances", { name: "Stella" });
    bottone(p.corpo, "Duplica").click();
    expect(p.esegui).toHaveBeenLastCalledWith("symbol.duplicate", { name: "Stella" });
    bottone(p.corpo, "Elimina").click();
    expect(p.esegui).toHaveBeenLastCalledWith("symbol.delete", { name: "Stella" });
  });

  it("Nuovo simbolo manda il nome scritto; un nome già preso resta un errore sotto il campo", async () => {
    const p = monta(2);
    await vi.waitFor(() => expect(p.corpo.textContent).toContain("Stella"));
    scrivi(p.corpo, "Stella");
    bottone(p.corpo, "Nuovo simbolo").click();
    expect(p.esegui).not.toHaveBeenCalled();
    expect(p.corpo.textContent).toContain("C'è già un simbolo");
    scrivi(p.corpo, "Nuvola");
    bottone(p.corpo, "Nuovo simbolo").click();
    expect(p.esegui).toHaveBeenLastCalledWith("symbol.new", { name: "Nuvola" });
  });

  it("Rinomina manda options con il nome nuovo; vuoto non parte", async () => {
    const p = monta();
    await vi.waitFor(() => expect(p.corpo.textContent).toContain("Stella"));
    bottone(p.corpo, "Stella").click();
    bottone(p.corpo, "Rinomina").click();
    expect(p.esegui).not.toHaveBeenCalled();
    scrivi(p.corpo, "Stella grande");
    bottone(p.corpo, "Rinomina").click();
    expect(p.esegui).toHaveBeenLastCalledWith("symbol.options", { name: "Stella", newName: "Stella grande" });
  });

  it("Seleziona non usati sceglie quei simboli, ed Elimina li manda tutti", async () => {
    const p = monta();
    await vi.waitFor(() => expect(p.corpo.textContent).toContain("Stella"));
    bottone(p.corpo, "Stella").click();
    bottone(p.corpo, "Foglia").dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true }));
    bottone(p.corpo, "Elimina").click();
    expect(p.esegui).toHaveBeenLastCalledWith("symbol.delete", { names: ["Stella", "Foglia"] });
    await vi.waitFor(() => expect(bottone(p.corpo, "Seleziona non usati").disabled).toBe(false));
    bottone(p.corpo, "Seleziona non usati").click();
    await vi.waitFor(() => expect(bottone(p.corpo, "Foglia").getAttribute("aria-pressed")).toBe("true"));
    expect(bottone(p.corpo, "Stella").getAttribute("aria-pressed")).toBe("false");
  });

  it("le librerie: la lista, una libreria, e un clic aggiunge il simbolo", async () => {
    const p = monta();
    await vi.waitFor(() => expect(p.corpo.textContent).toContain("Stella"));
    bottone(p.corpo, "Librerie di simboli").click();
    await vi.waitFor(() => expect(p.corpo.textContent).toContain("Frecce"));
    bottone(p.corpo, "Frecce").click();
    await vi.waitFor(() => expect(p.corpo.textContent).toContain("Freccia 1"));
    expect(p.leggi).toHaveBeenCalledWith("symbol.library", { library: "frecce" });
    bottone(p.corpo, "Freccia 1").click();
    expect(p.esegui).toHaveBeenLastCalledWith("symbol.addFromLibrary", { library: "frecce", name: "Freccia 1" });
  });

  it("un disegno senza simboli lo dice", async () => {
    const p = monta(0, []);
    await vi.waitFor(() => expect(p.corpo.textContent).toContain("non ha simboli"));
    expect(bottone(p.corpo, "Seleziona non usati").disabled).toBe(true);
  });
});
