// @vitest-environment happy-dom
// La fila della Bacchetta magica (`./fila-bacchetta.ts`), come il pannello «Magic Wand» di
// VectorCraft (il pannello `magic_wand`): le opzioni lette coi valori di serie e i limiti del motore, la casella che manda
// solo la sua chiave e spegne la tolleranza, il campo che manda la tolleranza, e le opzioni
// ricordate per la corsa dell'app che tornano al motore di un altro disegno.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import type { AzioniFila } from "../../opzioni";
import { BACCHETTA_DI_SERIE, COMANDO_BACCHETTA, COMANDO_BACCHETTA_LETTURA, dimenticaLaBacchetta, filaBacchetta, opzioniBacchetta } from "./fila-bacchetta";

const vite: Lifetime[] = [];
const vita = (): Lifetime => {
  const v = openLifetime();
  vite.push(v);
  return v;
};
const giro = (): Promise<void> => new Promise((risolto) => setTimeout(risolto, 0));
beforeEach(() => dimenticaLaBacchetta());
afterEach(() => {
  while (vite.length > 0) vite.pop()!.close();
  document.body.replaceChildren();
  dimenticaLaBacchetta();
});

/// Un motore finto: tiene le opzioni come `magicWand.set` (unisce e rende tutto).
function monta(partenza: Record<string, unknown> = {}) {
  let motore: Record<string, unknown> = { ...BACCHETTA_DI_SERIE, ...partenza };
  const leggi = vi.fn((id: string, valore: unknown) => {
    if (id === COMANDO_BACCHETTA) motore = { ...motore, ...(valore as Record<string, unknown>) };
    return Promise.resolve(motore as unknown);
  });
  const azioni: AzioniFila = { esegui: vi.fn(), leggi, annuncia: vi.fn(), opzione: vi.fn() };
  const fila = filaBacchetta(azioni, vita())!;
  const tutto = document.createElement("div");
  tutto.append(...(fila.voci ?? []).map((v) => v.element));
  document.body.append(tutto);
  return { fila, leggi, tutto, motore: () => motore };
}

describe("le opzioni", () => {
  it("ogni chiave che manca o è sbagliata torna di serie; le tolleranze stanno nei limiti", () => {
    expect(opzioniBacchetta(null)).toEqual(BACCHETTA_DI_SERIE);
    expect(opzioniBacchetta({ strokeColor: true, fillTolerance: 900, weightTolerance: -3, opacityTolerance: "x", blendingMode: 1 })).toEqual({
      ...BACCHETTA_DI_SERIE,
      strokeColor: true,
      fillTolerance: 255,
      weightTolerance: 0,
    });
  });
});

describe("la fila", () => {
  it("ha le cinque voci del pannello, e legge le opzioni del motore", async () => {
    const p = monta({ strokeColor: true });
    expect(p.fila.voci ?? []).toHaveLength(5);
    expect(p.leggi).toHaveBeenCalledWith(COMANDO_BACCHETTA_LETTURA, {});
    await giro();
    const caselle = p.tutto.querySelectorAll<HTMLInputElement>(".kit-form-checkbox");
    expect([...caselle].map((c) => c.checked)).toEqual([true, true, false, false, false]);
    // Quattro tolleranze: il metodo di fusione non ne ha. Quella di una casella spenta è spenta.
    const campi = p.tutto.querySelectorAll<HTMLInputElement>(".kit-number input");
    expect(campi).toHaveLength(4);
    expect([...campi].map((c) => c.disabled)).toEqual([false, false, true, true]);
  });

  it("una casella manda solo la sua chiave e accende la sua tolleranza", async () => {
    const p = monta();
    await giro();
    const opacita = p.tutto.querySelectorAll<HTMLInputElement>(".kit-form-checkbox")[3]!;
    opacita.click();
    expect(p.leggi).toHaveBeenLastCalledWith(COMANDO_BACCHETTA, { opacity: true });
    expect(p.tutto.querySelectorAll<HTMLInputElement>(".kit-number input")[3]!.disabled).toBe(false);
  });

  it("un campo manda la tolleranza confermata, senza rifare i controlli", async () => {
    const p = monta();
    await giro();
    const campo = p.tutto.querySelector<HTMLInputElement>(".kit-number input")!;
    campo.value = "80";
    campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(p.leggi).toHaveBeenLastCalledWith(COMANDO_BACCHETTA, { fillTolerance: 80 });
    await giro();
    expect(p.tutto.querySelector(".kit-number input")).toBe(campo);
    expect(p.motore().fillTolerance).toBe(80);
  });

  it("le opzioni cambiate restano per la corsa dell'app e vanno al motore di un altro disegno", async () => {
    const primo = monta();
    await giro();
    primo.tutto.querySelectorAll<HTMLInputElement>(".kit-form-checkbox")[1]!.click();
    await giro();
    const secondo = monta();
    expect(secondo.leggi).toHaveBeenCalledWith(COMANDO_BACCHETTA, { ...BACCHETTA_DI_SERIE, strokeColor: true });
    await giro();
    expect(secondo.motore().strokeColor).toBe(true);
    expect(secondo.tutto.querySelectorAll<HTMLInputElement>(".kit-form-checkbox")[1]!.checked).toBe(true);
  });

  it("una fila già chiusa non si monta", () => {
    const v = vita();
    v.close();
    expect(filaBacchetta({ esegui: vi.fn(), leggi: vi.fn(), annuncia: vi.fn(), opzione: vi.fn() }, v)).toBeNull();
  });
});
