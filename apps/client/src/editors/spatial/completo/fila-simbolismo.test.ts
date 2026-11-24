// @vitest-environment happy-dom
// La fila degli strumenti dei simboli (`./fila-simbolismo.ts`): le opzioni lette nei limiti del
// motore, lo Spruzzo col simbolo corrente (lo stesso della sezione «Simboli», nei due versi), il
// primo simbolo quando non ce n'è uno corrente, e gli altri strumenti col diametro e l'intensità.

import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { COMANDO_LISTA_SIMBOLI, filaSimbolismo, opzioniSimbolismo, SIMBOLISMO_DI_SERIE } from "./fila-simbolismo";
import { poniSimbolo, simboloCorrente } from "./simboli-sezione";

const vite: Lifetime[] = [];
afterEach(() => {
  while (vite.length > 0) vite.pop()!.close();
  document.body.replaceChildren();
});

function monta(strumento: string, simboli: readonly string[] = ["Presa", "Vite"], opzioni: Record<string, unknown> = {}) {
  const leggi = vi.fn((id: string) => Promise.resolve(id === COMANDO_LISTA_SIMBOLI ? { symbols: simboli.map((name) => ({ name })) } : null));
  const opzione = vi.fn();
  const corrente = simboloCorrente();
  const vita = openLifetime();
  vite.push(vita);
  const stato = { options: { ...opzioni } } as never;
  const fila = filaSimbolismo(strumento, corrente, stato, { esegui: vi.fn(), leggi, annuncia: vi.fn(), opzione }, vita)!;
  document.body.append(fila.element);
  return { fila, leggi, opzione, corrente, vita };
}

const etichette = (el: HTMLElement): string[] => [...el.querySelectorAll("[role=group]")].map((g) => g.getAttribute("aria-label") ?? "");

describe("le opzioni", () => {
  it("una chiave che manca o è sbagliata torna di serie, i numeri stanno nei limiti", () => {
    expect(opzioniSimbolismo(null)).toEqual(SIMBOLISMO_DI_SERIE);
    expect(opzioniSimbolismo({ diameter: 5000, intensity: 0, density: "x", symbol: "Vite" })).toEqual({ diametro: 2000, intensita: 1, densita: 5, simbolo: "Vite" });
  });
});

describe("la fila", () => {
  it("lo Spruzzo ha simbolo, diametro e densità; senza simbolo corrente prende il primo", async () => {
    const p = monta("symbolSprayer");
    expect(etichette(p.fila.element)).toEqual(["Simbolo", "Diametro", "Densità"]);
    await vi.waitFor(() => expect(p.opzione).toHaveBeenCalledWith("symbol", "Presa"));
    expect(p.corrente.nome).toBe("Presa");
  });

  it("il simbolo scelto nella fila e quello scelto nella sezione vanno insieme", async () => {
    const p = monta("symbolSprayer");
    const scelta = p.fila.element.querySelector("select")!;
    await vi.waitFor(() => expect(scelta.disabled).toBe(false));
    scelta.value = "Vite";
    scelta.dispatchEvent(new Event("change"));
    expect(p.corrente.nome).toBe("Vite");
    expect(p.opzione).toHaveBeenLastCalledWith("symbol", "Vite");
    poniSimbolo(p.corrente, "Presa");
    expect(scelta.value).toBe("Presa");
    expect(p.opzione).toHaveBeenLastCalledWith("symbol", "Presa");
    // Chiusa la fila, non ascolta più.
    p.vita.close();
    expect(p.corrente.ascolti?.size).toBe(0);
  });

  it("un disegno senza simboli spegne la scelta e dice perché", async () => {
    const p = monta("symbolSprayer", []);
    await vi.waitFor(() => expect(p.fila.element.textContent).toContain("Nessun simbolo"));
    const scelta = p.fila.element.querySelector("select")!;
    expect(scelta.disabled).toBe(true);
    expect(scelta.title).toContain("Risorse");
    expect(p.opzione).not.toHaveBeenCalled();
  });

  it("gli altri strumenti hanno diametro e intensità, e un campo confermato va al motore", () => {
    const p = monta("symbolSizer", [], { diameter: 120, intensity: 7 });
    expect(etichette(p.fila.element)).toEqual(["Diametro", "Intensità"]);
    expect(p.leggi).not.toHaveBeenCalled();
    const campi = p.fila.element.querySelectorAll<HTMLInputElement>(".kit-number input");
    expect(campi[1]!.value).toBe("7");
    campi[1]!.value = "9";
    campi[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(p.opzione).toHaveBeenLastCalledWith("intensity", 9);
  });
});
