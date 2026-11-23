// @vitest-environment happy-dom
//
// La fila della Trasformazione libera (K6 T13): Vincola sopra i tre modi, come il riquadro di
// VectorCraft (`free_transform.rs`). Ogni cambio manda l'opzione dello strumento (`mode`,
// `constrain`); Vincola è spenta fuori dal modo libero; un valore uguale del motore non rifà
// i controlli.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingToolState } from "../../../../../host/contract";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import type { AzioniFila } from "../../opzioni";
import { filaLibera, opzioniLibera } from "./opzioni-libera";
import { TESTI } from "./testi";

const vite: Lifetime[] = [];
afterEach(() => {
  while (vite.length > 0) vite.pop()!.close();
  document.body.replaceChildren();
});

const stato = (options: unknown): DrawingToolState => ({ options }) as unknown as DrawingToolState;

function monta(options: unknown) {
  const vita = openLifetime();
  vite.push(vita);
  const opzione = vi.fn<AzioniFila["opzione"]>();
  const azioni: AzioniFila = { esegui: vi.fn(), leggi: vi.fn(() => Promise.resolve(null)), annuncia: vi.fn(), opzione };
  const fila = filaLibera(TESTI, stato(options), azioni, vita)!;
  document.body.append(fila.element);
  const casella = () => fila.element.querySelector<HTMLInputElement>("input[type=checkbox]")!;
  const modi = () => [...fila.element.querySelectorAll<HTMLButtonElement>("[role=radiogroup] button")];
  return { fila, opzione, casella, modi };
}

describe("la fila della Trasformazione libera", () => {
  it("legge il modo e Vincola come il motore: un modo sconosciuto vale libero", () => {
    expect(opzioniLibera({ mode: "perspective", constrain: true })).toEqual({ modo: "perspective", vincola: true });
    expect(opzioniLibera({ mode: "altro" })).toEqual({ modo: "free", vincola: false });
    expect(opzioniLibera(null)).toEqual({ modo: "free", vincola: false });
  });

  it("ha Vincola e i tre modi di VectorCraft, nel loro ordine", () => {
    const { fila, modi, casella } = monta({ mode: "free", constrain: false });
    expect(fila.voci).toHaveLength(2);
    expect(modi().map((b) => b.textContent)).toEqual(["Trasformazione libera", "Distorsione prospettica", "Distorsione libera"]);
    expect(modi()[0]!.getAttribute("aria-checked")).toBe("true");
    expect(casella().checked).toBe(false);
    expect(casella().disabled).toBe(false);
  });

  it("un modo scelto manda `mode` e spegne Vincola; Vincola manda `constrain`", () => {
    const { opzione, casella, modi } = monta({ mode: "free", constrain: false });
    casella().click();
    expect(opzione).toHaveBeenLastCalledWith("constrain", true);
    modi()[2]!.click();
    expect(opzione).toHaveBeenLastCalledWith("mode", "distort");
    expect(casella().disabled).toBe(true);
    // Lo stesso modo di nuovo non manda niente.
    opzione.mockClear();
    modi()[2]!.click();
    expect(opzione).not.toHaveBeenCalled();
  });

  it("il motore che ripete il valore mostrato non rifà i controlli; uno diverso sì", () => {
    const { fila, modi, casella } = monta({ mode: "free", constrain: false });
    const primo = modi()[0];
    expect(fila.aggiorna({ mode: "free", constrain: false })).toBe(true);
    expect(modi()[0]).toBe(primo);
    expect(fila.aggiorna({ mode: "perspective", constrain: false })).toBe(true);
    expect(modi()[0]).not.toBe(primo);
    expect(modi()[1]!.getAttribute("aria-checked")).toBe("true");
    expect(casella().disabled).toBe(true);
  });
});
