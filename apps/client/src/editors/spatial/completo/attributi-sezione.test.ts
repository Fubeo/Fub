// @vitest-environment happy-dom
// La sezione «Attributi» del Design (`completo/attributi-sezione.ts`): i due pulsanti della regola di
// riempimento, come nel pannello Attributi di VectorCraft. Premuto quello della regola letta, nessuno
// con regole diverse; accesi col comando acceso; il clic manda `path.setFillRule` e rilegge.

import { describe, expect, it, vi } from "vitest";
import type { MotoreDelDisegno } from "../motore/gesti";
import { openLifetime } from "../../../ui/lifetime";
import { creaSezioni } from "./sezioni";
import { regolaDaLettura, registraAttributi, sezioneAttributi, SEZIONE_ATTRIBUTI, type StatoAttributi } from "./attributi-sezione";

const UN_MOTORE = {} as MotoreDelDisegno;
const giro = (): Promise<void> => new Promise((risolto) => setTimeout(risolto, 0));

function disegna(stato: StatoAttributi | null, motore: MotoreDelDisegno | null = UN_MOTORE) {
  const esegui = vi.fn(() => Promise.resolve());
  const leggi = vi.fn(() => Promise.resolve(stato));
  const aggiorna = vi.fn();
  const corpo = document.createElement("div");
  document.body.append(corpo);
  const vita = openLifetime();
  sezioneAttributi({ esegui, leggi }).disegna({ corpo, sel: { numero: 1, punti: [] }, motore, aggiorna, rileggi: vi.fn(), vita } as never);
  const pulsante = (regola: string): HTMLButtonElement => corpo.querySelector<HTMLButtonElement>(`button[data-rule="${regola}"]`)!;
  return { corpo, esegui, aggiorna, vita, pulsante };
}

describe("la lettura", () => {
  it("prende la regola di attributes.info", () => {
    expect(regolaDaLettura({ fillRule: "evenOdd" })).toBe("evenOdd");
    expect(regolaDaLettura({ fillRule: "nonZero" })).toBe("nonZero");
    expect(regolaDaLettura({ fillRule: null })).toBeNull();
    expect(regolaDaLettura(null)).toBeNull();
  });
});

describe("la sezione", () => {
  it("prima della risposta è spenta, poi preme la regola letta", async () => {
    const { pulsante } = disegna({ regola: "evenOdd", acceso: true });
    expect(pulsante("nonZero").disabled).toBe(true);
    await giro();
    expect(pulsante("evenOdd").getAttribute("aria-pressed")).toBe("true");
    expect(pulsante("nonZero").getAttribute("aria-pressed")).toBe("false");
    expect(pulsante("nonZero").disabled).toBe(false);
  });

  it("con regole diverse non preme niente, e col comando spento resta spenta", async () => {
    const diverse = disegna({ regola: null, acceso: true });
    await giro();
    expect(diverse.corpo.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
    const spenta = disegna({ regola: "nonZero", acceso: false });
    await giro();
    expect(spenta.pulsante("evenOdd").disabled).toBe(true);
  });

  it("il clic manda path.setFillRule e rilegge; la regola che c'è già non manda niente", async () => {
    const { pulsante, esegui, aggiorna } = disegna({ regola: "nonZero", acceso: true });
    await giro();
    pulsante("nonZero").click();
    expect(esegui).not.toHaveBeenCalled();
    pulsante("evenOdd").click();
    expect(esegui).toHaveBeenCalledWith("path.setFillRule", { rule: "evenOdd" });
    await giro();
    expect(aggiorna).toHaveBeenCalled();
  });

  it("senza motore lo dice", () => {
    const { corpo } = disegna(null, null);
    expect(corpo.textContent).toContain("motore");
  });

  it("sta nel Design una volta sola, solo con degli oggetti scelti", () => {
    const sezioni = creaSezioni();
    const azioni = { esegui: vi.fn(() => Promise.resolve()), leggi: vi.fn(() => Promise.resolve(null)) };
    expect(registraAttributi(sezioni, azioni)).toBe(true);
    expect(registraAttributi(sezioni, azioni)).toBe(false);
    const sezione = sezioneAttributi(azioni);
    expect(sezione.id).toBe(SEZIONE_ATTRIBUTI);
    expect(sezione.scheda).toBe("design");
    expect(sezione.quando?.({ numero: 0, punti: [] } as never)).toBe(false);
    expect(sezione.quando?.({ numero: 1, punti: [] } as never)).toBe(true);
  });
});
