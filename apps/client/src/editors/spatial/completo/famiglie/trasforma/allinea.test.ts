// @vitest-environment happy-dom
// La sezione «Allinea» (T13, giro 2): i quindici pulsanti delle voci `align.*`, la
// regola dei due oggetti (`needs_two`, e «alla tavola» che ne basta uno), il clic che
// manda il comando con il suo `to`, e la corrispondenza con l'indice generato.

import { describe, expect, it, vi } from "vitest";
import type { ContestoCompleto } from "../../carica";
import { creaSezioni } from "../../sezioni";
import { t } from "../../../strings";
import { openLifetime } from "../../../../../ui/lifetime";
import indiceGenerato from "../../indice.generated.json";
import famiglia, { oggettiMinimi, spento } from "./index";

const ALLINEA = [
  "align.horizontalLeft",
  "align.horizontalCenter",
  "align.horizontalRight",
  "align.horizontalVerticalCenter",
  "align.verticalTop",
  "align.verticalCenter",
  "align.verticalBottom",
  "align.distributeVerticalTop",
  "align.distributeVerticalCenter",
  "align.distributeVerticalBottom",
  "align.distributeHorizontalLeft",
  "align.distributeHorizontalCenter",
  "align.distributeHorizontalRight",
  "align.distributeVerticalSpace",
  "align.distributeHorizontalSpace",
];

interface VoceGenerata {
  readonly id: string;
  readonly chiamata: { readonly comando?: string; readonly valore?: Record<string, string> };
}
const VOCI = (indiceGenerato as { readonly voci: readonly VoceGenerata[] }).voci;

/// La sezione registrata dalla famiglia, disegnata in un contenitore con `numero` oggetti scelti.
function disegna(numero: number) {
  const sezioni = creaSezioni();
  const esegui = vi.fn();
  famiglia.registra({ motore: null, life: openLifetime(), sezioni, esegui, registraFila: vi.fn() } as unknown as ContestoCompleto);
  const [sezione] = sezioni.di("design");
  const corpo = document.createElement("div");
  document.body.append(corpo);
  sezione!.disegna({ corpo, sel: { numero }, motore: null, aggiorna: vi.fn(), vita: openLifetime() });
  const pulsante = (id: string): HTMLButtonElement => corpo.querySelector<HTMLButtonElement>(`button[data-id="${id}"]`)!;
  const modo = (indice: number): HTMLButtonElement => corpo.querySelectorAll<HTMLButtonElement>(".draw-align-to button")[indice]!;
  return { sezioni, corpo, esegui, pulsante, modo };
}

describe("la sezione Allinea", () => {
  it("sta nella scheda Design, con l'id allinea", () => {
    const sezioni = creaSezioni();
    famiglia.registra({ motore: null, life: openLifetime(), sezioni, esegui: vi.fn(), registraFila: vi.fn() } as unknown as ContestoCompleto);
    expect(sezioni.di("design").map((sezione) => sezione.id)).toEqual(["allinea"]);
  });

  it("ha un pulsante per ciascuna delle quindici voci align.*, con il suo id", () => {
    const { corpo } = disegna(2);
    const ids = [...corpo.querySelectorAll<HTMLButtonElement>("button[data-id]")].map((el) => el.dataset.id);
    // L'ordine è quello dei gruppi della sezione, non quello dell'elenco: contano gli insiemi.
    expect(ids).toHaveLength(15);
    expect([...ids].sort()).toEqual([...ALLINEA].sort());
  });

  it("ogni pulsante corrisponde a una voce dell'indice che manda il comando del motore con il suo valore", () => {
    for (const id of ALLINEA) {
      const voce = VOCI.find((one) => one.id === id);
      expect(voce, id).toBeDefined();
      expect(voce!.chiamata.comando, id).toMatch(/^disegno\.object\.(align|distribute|distributeSpacing)$/);
      expect(voce!.chiamata.valore, id).toBeTypeOf("object");
    }
  });

  it("la regola dei due oggetti: alla selezione servono due; alla tavola ne basta uno per allineare, mai per distribuire", () => {
    expect(oggettiMinimi("align.horizontalLeft", "selection")).toBe(2);
    expect(oggettiMinimi("align.horizontalLeft", "artboard")).toBe(1);
    expect(oggettiMinimi("align.distributeHorizontalLeft", "artboard")).toBe(2);
    expect(spento("align.verticalTop", "selection", 1)).toBe(true);
    expect(spento("align.verticalTop", "selection", 2)).toBe(false);
  });

  it("con un oggetto solo, «alla selezione» è spenta e dice perché", () => {
    const { pulsante } = disegna(1);
    expect(pulsante("align.horizontalLeft").disabled).toBe(true);
    expect(pulsante("align.horizontalLeft").title).toBe(t("draw.disabled.needs_two"));
    expect(pulsante("align.distributeVerticalTop").disabled).toBe(true);
  });

  it("con un oggetto solo, «alla tavola» allinea e non distribuisce", () => {
    const { pulsante, modo } = disegna(1);
    modo(1).click();
    expect(pulsante("align.horizontalLeft").disabled).toBe(false);
    expect(pulsante("align.distributeHorizontalLeft").disabled).toBe(true);
  });

  it("con due oggetti tutti i pulsanti sono accesi", () => {
    const { corpo } = disegna(2);
    const spenti = [...corpo.querySelectorAll<HTMLButtonElement>("button[data-id]")].filter((el) => el.disabled);
    expect(spenti).toHaveLength(0);
  });

  it("un clic manda il comando col modo scelto, e «alla tavola» cambia il valore di to", () => {
    const { pulsante, esegui, modo } = disegna(2);
    pulsante("align.horizontalLeft").click();
    expect(esegui).toHaveBeenLastCalledWith("align.horizontalLeft", { to: "selection" });
    modo(1).click();
    pulsante("align.verticalTop").click();
    expect(esegui).toHaveBeenLastCalledWith("align.verticalTop", { to: "artboard" });
    expect(esegui).toHaveBeenCalledTimes(2);
  });

  it("un pulsante spento non manda niente", () => {
    const { pulsante, esegui } = disegna(1);
    pulsante("align.horizontalLeft").click();
    expect(esegui).not.toHaveBeenCalled();
  });
});
