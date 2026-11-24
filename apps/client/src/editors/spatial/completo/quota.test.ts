// @vitest-environment happy-dom
// La Quota nel client (`./quota.ts`), come VectorCraft: le opzioni intere coi valori di serie, la
// finestra che non manda niente di sbagliato, la fila dello strumento (`mode`, `style`) e la
// sezione del Design, che c'è solo con quote scelte e manda `dimension.update` e
// `dimension.applyToAll`.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingToolState } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { AzioniFila } from "./opzioni";
import { apriOpzioniQuota, daEsadecimale, esadecimale, eQuota, filaQuota, opzioniDelloStrumento, opzioniQuota, QUOTA_DI_SERIE, scalaValida, sezioneQuota, statoDelleQuote } from "./quota";

const vite: Lifetime[] = [];
afterEach(() => {
  while (vite.length > 0) vite.pop()!.close();
  document.body.replaceChildren();
});
const giro = (): Promise<void> => new Promise((risolto) => setTimeout(risolto, 0));
const vita = (): Lifetime => {
  const v = openLifetime();
  vite.push(v);
  return v;
};
const quota = (offset = 10, options: Record<string, unknown> = {}) => ({ id: 4, dimension: { mode: "linear", a: [0, 0], b: [10, 0], offset, options: { ...QUOTA_DI_SERIE, ...options } } });

describe("le opzioni", () => {
  it("ogni chiave che manca o è sbagliata torna di serie", () => {
    expect(opzioniQuota(null)).toEqual(QUOTA_DI_SERIE);
    expect(opzioniQuota({ units: "mm", precision: 9, lineColor: [255, 0, 0], arrowStyle: "x", fontFamily: "", scale: "1:10" })).toEqual({
      ...QUOTA_DI_SERIE,
      units: "mm",
      lineColor: [255, 0, 0],
      scale: "1:10",
    });
    expect(opzioniQuota({ textColor: [256, 0, 0], lineWeight: 0.05 })).toEqual(QUOTA_DI_SERIE);
  });
  it("la scala è disegno:reale coi limiti del motore", () => {
    for (const s of ["1:1", "1:10", " 2.5 : 1 ", "1:1e3"]) expect(scalaValida(s)).toBe(true);
    for (const s of ["", "1", "1:0", "0:1", "-1:2", "1:2:3", "a:b", "1:1e7", "1e10:1"]) expect(scalaValida(s)).toBe(false);
  });
  it("i colori passano da terna a #rrggbb e ritorno", () => {
    expect(esadecimale([255, 128, 0])).toBe("#ff8000");
    expect(daEsadecimale("#FF8000")).toEqual([255, 128, 0]);
    expect(daEsadecimale("rosso")).toBeNull();
  });
  it("lo strumento legge tipo e stile; raggio e diametro sono radiali", () => {
    expect(opzioniDelloStrumento({ mode: "angular", style: { units: "cm" } })).toEqual({ tipo: "angular", stile: { ...QUOTA_DI_SERIE, units: "cm" } });
    expect(opzioniDelloStrumento({ mode: "diameter" }).tipo).toBe("radial");
    expect(opzioniDelloStrumento(null).tipo).toBe("linear");
  });
});

describe("la finestra", () => {
  const ok = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.draw-dimension-dialog [data-action="ok"]')!;
  const annulla = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.draw-dimension-dialog [data-action="cancel"]')!;
  it("OK rende le opzioni intere col cambio", async () => {
    const esito = apriOpzioniQuota("Quota", QUOTA_DI_SERIE, vita());
    const casella = document.querySelector<HTMLInputElement>(".draw-dimension-dialog .kit-form-checkbox")!;
    casella.click();
    ok().click();
    expect(await esito).toEqual({ ...QUOTA_DI_SERIE, hideUnits: true });
  });
  it("Annulla rende null", async () => {
    const esito = apriOpzioniQuota("Quota", QUOTA_DI_SERIE, vita());
    annulla().click();
    expect(await esito).toBeNull();
  });
  it("una scala sbagliata spegne OK; tornata giusta lo riaccende", () => {
    void apriOpzioniQuota("Quota", QUOTA_DI_SERIE, vita());
    const scala = [...document.querySelectorAll<HTMLInputElement>(".draw-dimension-dialog input")].find((i) => i.value === "1:1")!;
    scala.value = "dieci";
    scala.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ok().disabled).toBe(true);
    scala.value = "1:10";
    scala.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ok().disabled).toBe(false);
  });
  it("chi l'ha aperta, andandosene, la chiude", async () => {
    const v = vita();
    const esito = apriOpzioniQuota("Quota", QUOTA_DI_SERIE, v);
    v.close();
    expect(await esito).toBeNull();
    expect(document.querySelector(".draw-dimension-dialog")).toBeNull();
  });
});

const stato = (options: unknown): DrawingToolState => ({ options }) as unknown as DrawingToolState;

describe("la fila dello strumento", () => {
  function monta(options: unknown) {
    const opzione = vi.fn<AzioniFila["opzione"]>();
    const azioni: AzioniFila = { esegui: vi.fn(), leggi: vi.fn(() => Promise.resolve(null)), annuncia: vi.fn(), opzione };
    const fila = filaQuota(stato(options), azioni, vita())!;
    document.body.append(fila.element);
    return { fila, opzione };
  }
  it("il tipo cambia l'opzione `mode`", () => {
    const { fila, opzione } = monta({ mode: "linear", style: QUOTA_DI_SERIE });
    const angolare = [...fila.element.querySelectorAll<HTMLButtonElement>(".kit-form-option")][1]!;
    angolare.click();
    expect(opzione).toHaveBeenLastCalledWith("mode", "angular");
  });
  it("«Opzioni quota…» manda lo stile intero con OK", async () => {
    const { fila, opzione } = monta({ mode: "linear", style: { ...QUOTA_DI_SERIE, units: "mm" } });
    fila.element.querySelector<HTMLButtonElement>('[data-action="dimension-options"]')!.click();
    document.querySelector<HTMLButtonElement>('.draw-dimension-dialog [data-action="ok"]')!.click();
    await giro();
    expect(opzione).toHaveBeenLastCalledWith("style", { ...QUOTA_DI_SERIE, units: "mm" });
  });
  it("un tipo uguale del motore non rifà la scelta; uno diverso sì", () => {
    const { fila } = monta({ mode: "linear" });
    const prima = fila.element.querySelector(".kit-form-choice");
    fila.aggiorna({ mode: "linear" });
    expect(fila.element.querySelector(".kit-form-choice")).toBe(prima);
    fila.aggiorna({ mode: "radial" });
    expect(fila.element.querySelector(".kit-form-choice")).not.toBe(prima);
  });
});

describe("la sezione del Design", () => {
  it("lo stato vale solo se ogni oggetto scelto è una quota; la distanza vuota se differisce", () => {
    expect(eQuota(quota())).toBe(true);
    expect(eQuota({ id: 2 })).toBe(false);
    expect(statoDelleQuote(["a", "b"], [quota(10), quota(10)])?.distanza).toBe(10);
    expect(statoDelleQuote(["a", "b"], [quota(10), quota(20)])?.distanza).toBeNull();
    expect(statoDelleQuote(["a", "b"], [quota(), { id: 2 }])).toBeNull();
    expect(statoDelleQuote([], [])).toBeNull();
  });

  function disegna(letto: { ids: string[]; nodi: unknown[] } | null, motore: MotoreDelDisegno | null = {} as MotoreDelDisegno) {
    const esegui = vi.fn(() => Promise.resolve());
    const leggi = vi.fn(() => Promise.resolve(letto));
    const mostra = vi.fn();
    const corpo = document.createElement("div");
    document.body.append(corpo);
    const v = vita();
    const sezione = sezioneQuota({ esegui, leggi });
    sezione.disegna({ corpo, sel: { numero: letto?.ids.length ?? 0, punti: [] }, motore, aggiorna: vi.fn(), rileggi: vi.fn(), vita: v, mostra } as never);
    return { sezione, corpo, esegui, leggi, mostra, vita: v };
  }

  it("nasce nascosta e si mostra con le quote scelte", async () => {
    const p = disegna({ ids: ["q1"], nodi: [quota(12)] });
    expect(p.sezione.nascostaAllInizio).toBe(true);
    await giro();
    expect(p.mostra).toHaveBeenLastCalledWith(true);
    expect(p.corpo.querySelector<HTMLInputElement>(".kit-number input")!.value).toBe("12");
  });
  it("resta nascosta senza quote o senza motore", async () => {
    const altro = disegna({ ids: ["q1", "r"], nodi: [quota(), { id: 2 }] });
    await giro();
    expect(altro.mostra).toHaveBeenLastCalledWith(false);
    const spento = disegna({ ids: ["q1"], nodi: [quota()] }, null);
    expect(spento.mostra).toHaveBeenCalledWith(false);
    expect(spento.leggi).not.toHaveBeenCalled();
  });
  it("la distanza, le opzioni e Applica a tutti mandano i comandi della Quota", async () => {
    const p = disegna({ ids: ["q1", "q2"], nodi: [quota(10, { units: "cm" }), quota(20)] });
    await giro();
    const distanza = p.corpo.querySelector<HTMLInputElement>(".kit-number input")!;
    expect(distanza.value).toBe("");
    distanza.value = "-8";
    distanza.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(p.esegui).toHaveBeenLastCalledWith("dimension.update", { ids: ["q1", "q2"], offset: -8 });
    p.corpo.querySelector<HTMLButtonElement>('[data-action="dimension-options"]')!.click();
    document.querySelector<HTMLButtonElement>('.draw-dimension-dialog [data-action="ok"]')!.click();
    await giro();
    expect(p.esegui).toHaveBeenLastCalledWith("dimension.update", { ids: ["q1", "q2"], options: { ...QUOTA_DI_SERIE, units: "cm" } });
    p.corpo.querySelector<HTMLButtonElement>('[data-action="dimension-apply-to-all"]')!.click();
    expect(p.esegui).toHaveBeenLastCalledWith("dimension.applyToAll", { id: "q1" });
  });
});
