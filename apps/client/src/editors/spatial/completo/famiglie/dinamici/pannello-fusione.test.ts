// @vitest-environment happy-dom
// Il pannello Fusione (K6 T17): la prova del pannello `blend` di
// `crates/fub-disegno/tests/famiglie/dinamici.json`. La sezione «Fusione» del Design
// (`completo/fusione-sezione.ts`) è il pannello di VectorCraft: Crea con due oggetti o più, le
// opzioni lette dal motore (spaziatura, passi o distanza, orientamento, andamento e rampa con un
// dorso, spostamento colore con una fusione), e i pulsanti accesi quando il loro comando lo è.
// Ogni cambio manda `object.blend.options` col solo valore cambiato.

import { describe, expect, it, vi } from "vitest";
import type { MotoreDelDisegno } from "../../../motore/gesti";
import { openLifetime } from "../../../../../ui/lifetime";
import { creaSezioni } from "../../sezioni";
import {
  infoDaLettura,
  registraFusione,
  sezioneFusione,
  valoriSpaziatura,
  COMANDI_FUSIONE,
  SEZIONE_FUSIONE,
  type StatoFusione,
} from "../../fusione-sezione";

const UN_MOTORE = {} as MotoreDelDisegno;
const giro = (): Promise<void> => new Promise((risolto) => setTimeout(risolto, 0));

const FUSIONE = {
  target: "blend",
  id: "f1",
  spacing: "steps",
  steps: 7,
  distance: 10,
  orientation: "page",
  easingType: "easeOut",
  ramp: 30,
  colorShift: -20,
  spine: { explicit: false },
};

function disegna(numero: number, stato: StatoFusione | null, motore: MotoreDelDisegno | null = UN_MOTORE) {
  const esegui = vi.fn(() => Promise.resolve());
  const leggi = vi.fn(() => Promise.resolve(stato));
  const aggiorna = vi.fn();
  const corpo = document.createElement("div");
  document.body.append(corpo);
  const vita = openLifetime();
  sezioneFusione({ esegui, leggi }).disegna({ corpo, sel: { numero, punti: [] }, motore, aggiorna, rileggi: vi.fn(), vita } as never);
  const pulsante = (id: string): HTMLButtonElement => corpo.querySelector<HTMLButtonElement>(`button[data-id="${id}"]`)!;
  const select = (classe: string): HTMLSelectElement => corpo.querySelector<HTMLSelectElement>(`select.${classe}`)!;
  const campo = (nome: string): HTMLInputElement =>
    [...corpo.querySelectorAll<HTMLElement>(".kit-number")].find((c) => c.querySelector("label")?.textContent === nome)!.querySelector("input")!;
  return { corpo, esegui, leggi, aggiorna, vita, pulsante, select, campo };
}

const tutti = (): ReadonlySet<string> => new Set(COMANDI_FUSIONE);

describe("la lettura", () => {
  it("prende le opzioni della fusione e mette quelle di VectorCraft dove mancano", () => {
    expect(infoDaLettura(FUSIONE)).toEqual({
      bersaglio: "blend",
      spaziatura: "steps",
      passi: 7,
      distanza: 10,
      orientamento: "page",
      andamento: "easeOut",
      rampa: 30,
      spostamento: -20,
      dorsoProprio: false,
    });
    expect(infoDaLettura({ target: "defaults", spacing: "boh" })).toMatchObject({ bersaglio: "defaults", spaziatura: "smooth", passi: 5, andamento: "easeIn" });
    expect(infoDaLettura(null)).toBeNull();
  });

  it("la spaziatura manda solo il suo valore, come VectorCraft", () => {
    expect(valoriSpaziatura("steps", 4, 9)).toEqual({ spacing: "steps", steps: 4 });
    expect(valoriSpaziatura("distance", 4, 9)).toEqual({ spacing: "distance", distance: 9 });
    expect(valoriSpaziatura("smooth", 4, 9)).toEqual({ spacing: "smooth" });
  });
});

describe("il pannello", () => {
  it("sta nel Design una volta sola, solo con degli oggetti scelti", () => {
    const sezioni = creaSezioni();
    const azioni = { esegui: vi.fn(() => Promise.resolve()), leggi: vi.fn(() => Promise.resolve(null)) };
    expect(registraFusione(sezioni, azioni)).toBe(true);
    expect(registraFusione(sezioni, azioni)).toBe(false);
    const sezione = sezioneFusione(azioni);
    expect(sezione.id).toBe(SEZIONE_FUSIONE);
    expect(sezione.scheda).toBe("design");
    expect(sezione.quando?.({ numero: 0, punti: [] } as never)).toBe(false);
    expect(sezione.quando?.({ numero: 1, punti: [] } as never)).toBe(true);
  });

  it("prima della risposta del motore è tutto spento; senza motore lo dice", async () => {
    const lento = disegna(2, { info: infoDaLettura(FUSIONE)!, accesi: tutti() });
    expect(lento.pulsante("object.blend.make").disabled).toBe(true);
    expect(lento.select("draw-blend-spacing").disabled).toBe(true);
    await giro();
    expect(lento.pulsante("object.blend.make").disabled).toBe(false);
    const senza = disegna(2, null, null);
    expect(senza.leggi).not.toHaveBeenCalled();
    expect(senza.corpo.querySelector("button")).toBeNull();
    expect(senza.corpo.textContent).not.toBe("");
  });

  it("con una fusione scelta mostra i suoi valori e accende i pulsanti del motore", async () => {
    const p = disegna(1, { info: infoDaLettura(FUSIONE)!, accesi: new Set(["object.blend.release", "object.blend.expand", "object.blend.make"]) });
    await giro();
    expect(p.select("draw-blend-spacing").value).toBe("steps");
    expect(p.select("draw-blend-spacing").disabled).toBe(false);
    expect(p.campo("Passi").value).toBe("7");
    expect(p.campo("Passi").disabled).toBe(false);
    // Crea vuole due oggetti scelti, anche se il motore lo dice acceso.
    expect(p.pulsante("object.blend.make").disabled).toBe(true);
    expect(p.pulsante("object.blend.release").disabled).toBe(false);
    expect(p.pulsante("object.blend.expand").disabled).toBe(false);
    expect(p.pulsante("object.blend.reverseSpine").disabled).toBe(true);
    // Senza un dorso suo e allineata alla pagina, andamento e rampa sono spenti; lo spostamento no.
    expect(p.select("draw-blend-easing").disabled).toBe(true);
    expect(p.campo("Rampa").disabled).toBe(true);
    expect(p.campo("Spostamento colore").disabled).toBe(false);
    expect(p.corpo.querySelector('[data-orientation="page"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("con un dorso suo, o allineata al tracciato, andamento e rampa si accendono", async () => {
    const dorso = disegna(1, { info: infoDaLettura({ ...FUSIONE, spine: { explicit: true } })!, accesi: tutti() });
    const tracciato = disegna(1, { info: infoDaLettura({ ...FUSIONE, orientation: "path" })!, accesi: tutti() });
    await giro();
    for (const p of [dorso, tracciato]) {
      expect(p.select("draw-blend-easing").disabled).toBe(false);
      expect(p.select("draw-blend-easing").value).toBe("easeOut");
      expect(p.campo("Rampa").disabled).toBe(false);
    }
  });

  it("ogni cambio manda object.blend.options col solo valore cambiato, e i pulsanti il loro comando", async () => {
    const p = disegna(2, { info: infoDaLettura({ ...FUSIONE, orientation: "path" })!, accesi: tutti() });
    await giro();
    const spaziatura = p.select("draw-blend-spacing");
    spaziatura.value = "distance";
    spaziatura.dispatchEvent(new Event("change"));
    expect(p.esegui).toHaveBeenLastCalledWith("object.blend.options", { spacing: "distance", distance: 10 });
    (p.corpo.querySelector('[data-orientation="page"]') as HTMLButtonElement).click();
    expect(p.esegui).toHaveBeenLastCalledWith("object.blend.options", { orientation: "page" });
    const andamento = p.select("draw-blend-easing");
    andamento.value = "easeInOut";
    andamento.dispatchEvent(new Event("change"));
    expect(p.esegui).toHaveBeenLastCalledWith("object.blend.options", { easingType: "easeInOut" });
    const passi = p.campo("Passi");
    passi.value = "12";
    passi.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(p.esegui).toHaveBeenLastCalledWith("object.blend.options", { spacing: "steps", steps: 12 });
    for (const id of COMANDI_FUSIONE) {
      p.pulsante(id).click();
      expect(p.esegui).toHaveBeenLastCalledWith(id, {});
    }
    await giro();
    expect(p.aggiorna).toHaveBeenCalled();
  });

  it("senza una fusione scelta, con due oggetti, le opzioni sono quelle delle fusioni nuove", async () => {
    const p = disegna(2, { info: infoDaLettura({ target: "defaults", spacing: "smooth", steps: 5, distance: 10, orientation: "page" })!, accesi: new Set(["object.blend.make"]) });
    await giro();
    expect(p.pulsante("object.blend.make").disabled).toBe(false);
    expect(p.select("draw-blend-spacing").disabled).toBe(false);
    // Colore uniforme sceglie i passi da sé.
    expect(p.campo("Passi").disabled).toBe(true);
    expect(p.select("draw-blend-easing").disabled).toBe(true);
    expect(p.campo("Spostamento colore").disabled).toBe(true);
    expect(p.pulsante("object.blend.release").disabled).toBe(true);
    expect(p.corpo.querySelector(".draw-properties-note")).not.toBeNull();
  });

  it("con un oggetto solo e nessuna fusione le opzioni sono spente", async () => {
    const p = disegna(1, { info: infoDaLettura({ target: "defaults" })!, accesi: new Set() });
    await giro();
    expect(p.select("draw-blend-spacing").disabled).toBe(true);
    expect(p.corpo.querySelector('[data-orientation="page"]')!.hasAttribute("disabled")).toBe(true);
  });

  it("la risposta di un giro passato si butta", async () => {
    const p = disegna(2, { info: infoDaLettura(FUSIONE)!, accesi: tutti() });
    p.vita.close();
    await giro();
    expect(p.pulsante("object.blend.make").disabled).toBe(true);
  });
});
