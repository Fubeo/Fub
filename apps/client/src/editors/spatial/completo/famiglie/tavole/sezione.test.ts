// @vitest-environment happy-dom
// La sezione «Tavole» del Design (`./sezione.ts`, il pannello Artboards di VectorCraft): c'è solo
// senza oggetti scelti; l'elenco con la tavola attuale; un clic che porta la vista su una tavola e
// la sceglie per i campi; il nome, X e Y, larghezza e altezza che mandano un comando solo; i
// pulsanti coi loro valori e quelli spenti col perché; la casella del disegno; la famiglia che la
// registra.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { creaSezioni, type TavoleDocumento } from "../../sezioni";
import famiglia from "./index";
import { comandoDi, regoleTavole, SEZIONE_TAVOLE, sezioneTavole, tavolaScelta } from "./sezione";
import { TESTI } from "./testi";

const vite: Lifetime[] = [];
afterEach(() => {
  for (const vita of vite.splice(0)) vita.close();
  document.body.replaceChildren();
});

function tavole(n: number, attuale: string | null = "b1", visita = vi.fn()): TavoleDocumento {
  return {
    elenco: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, nome: `Tavola ${i + 1}`, rect: [i * 320, 0, 300, 200] as const })),
    attuale,
    visita,
  };
}

const attesa = () => new Promise((r) => setTimeout(r, 0));

function disegna(t: TavoleDocumento | undefined) {
  const esegui = vi.fn((_id: string, _valori?: Readonly<Record<string, unknown>>) => Promise.resolve());
  const vera = sezioneTavole(TESTI, esegui);
  const corpo = document.createElement("div");
  document.body.append(corpo);
  const vita = openLifetime();
  vite.push(vita);
  const aggiorna = vi.fn();
  vera.disegna({ corpo, sel: { numero: 0, punti: [] }, motore: null, misure: {}, colori: {}, aggiorna, rileggi: vi.fn(), vita, ...(t === undefined ? {} : { tavole: t }) });
  const pulsante = (azione: string) => corpo.querySelector<HTMLButtonElement>(`[data-action="${azione}"]`)!;
  const voci = () => [...corpo.querySelectorAll<HTMLButtonElement>(".draw-artboards-item")];
  const campo = (chiave: string) => corpo.querySelector<HTMLElement>(`[data-field="${chiave}"]`)!.querySelector("input")!;
  return { corpo, esegui, aggiorna, pulsante, voci, campo, vita };
}

function conferma(input: HTMLInputElement, valore: string): void {
  input.focus();
  input.value = valore;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("le regole", () => {
  it("la tavola dei campi: la scelta se c'è ancora, poi l'attuale, poi la prima", () => {
    expect(tavolaScelta(tavole(3), "b2")).toBe(2);
    expect(tavolaScelta(tavole(3), "via")).toBe(1);
    expect(tavolaScelta(tavole(3, null), null)).toBe(0);
    expect(tavolaScelta(tavole(0), null)).toBeNull();
    expect(tavolaScelta(undefined, null)).toBeNull();
  });

  it("una tavola resta sempre; su e giù si fermano ai capi", () => {
    expect(regoleTavole(tavole(1), 0)).toMatchObject({ elimina: "tavole.ultima", taglia: "tavole.ultima", su: "", giu: "", duplica: null, copia: null });
    expect(regoleTavole(tavole(3), 1)).toMatchObject({ elimina: null, su: null, giu: null });
    expect(regoleTavole(tavole(0), null)).toMatchObject({ nuova: null, duplica: "tavole.nessuna", eliminaVuote: "tavole.nessuna" });
  });

  it("ogni pulsante manda il suo comando coi valori di VectorCraft", () => {
    expect(comandoDi("nuova", 2, true)).toEqual({ id: "artboard.new", valori: {} });
    expect(comandoDi("duplica", 2, false)).toEqual({ id: "artboard.duplicate", valori: { index: 2, art: false } });
    expect(comandoDi("elimina", 2, true)).toEqual({ id: "artboard.delete", valori: { index: 2 } });
    expect(comandoDi("eliminaVuote", 2, true)).toEqual({ id: "artboard.deleteEmpty", valori: {} });
    expect(comandoDi("su", 2, true)).toEqual({ id: "artboard.reorder", valori: { index: 2, to: 1 } });
    expect(comandoDi("giu", 2, true)).toEqual({ id: "artboard.reorder", valori: { index: 2, to: 3 } });
    expect(comandoDi("copia", 2, true)).toEqual({ id: "artboard.copy", valori: { index: 2, art: true } });
    expect(comandoDi("taglia", 2, true)).toEqual({ id: "artboard.cut", valori: { index: 2, art: true } });
  });
});

describe("la sezione Tavole", () => {
  it("c'è nel Design solo senza oggetti scelti", () => {
    const sezione = sezioneTavole(TESTI, () => Promise.resolve());
    expect(sezione.id).toBe(SEZIONE_TAVOLE);
    expect(sezione.scheda).toBe("design");
    expect(sezione.titolo).toBe("Tavole");
    expect(sezione.quando!({ numero: 0, punti: [] })).toBe(true);
    expect(sezione.quando!({ numero: 1, punti: [] })).toBe(false);
  });

  it("l'elenco ha le tavole nell'ordine, l'attuale segnata e scelta per i campi", () => {
    const { voci, campo, corpo } = disegna(tavole(3));
    expect(voci().map((v) => v.querySelector(".draw-artboards-name")!.textContent)).toEqual(["Tavola 1", "Tavola 2", "Tavola 3"]);
    expect(voci().map((v) => v.getAttribute("aria-current"))).toEqual([null, "true", null]);
    expect(voci().map((v) => v.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    expect(corpo.querySelector<HTMLInputElement>(".draw-artboards-name-input")!.value).toBe("Tavola 2");
    expect(Number(campo("tavole.x").value.replace(",", "."))).toBe(320);
  });

  it("un clic porta la vista sulla tavola e la sceglie anche al giro dopo", () => {
    const visita = vi.fn();
    const esegui = vi.fn(() => Promise.resolve());
    const sezione = sezioneTavole(TESTI, esegui);
    const corpo = document.createElement("div");
    const vita = openLifetime();
    vite.push(vita);
    const t = tavole(3, "b0", visita);
    const ctx = { corpo, sel: { numero: 0, punti: [] }, motore: null, misure: {}, colori: {}, aggiorna: vi.fn(), rileggi: vi.fn(), vita, tavole: t };
    sezione.disegna(ctx);
    corpo.querySelectorAll<HTMLButtonElement>(".draw-artboards-item")[2]!.click();
    expect(visita).toHaveBeenCalledWith(2);
    expect(ctx.aggiorna).toHaveBeenCalled();
    corpo.replaceChildren();
    sezione.disegna({ ...ctx, vita: openLifetime() });
    expect(corpo.querySelector<HTMLInputElement>(".draw-artboards-name-input")!.value).toBe("Tavola 3");
  });

  it("il nome cambiato manda Opzioni tavola; vuoto o uguale non manda niente", async () => {
    const { corpo, esegui, aggiorna } = disegna(tavole(2));
    const nome = corpo.querySelector<HTMLInputElement>(".draw-artboards-name-input")!;
    conferma(nome, "  ");
    conferma(nome, "Tavola 2");
    expect(esegui).not.toHaveBeenCalled();
    conferma(nome, "Retro");
    await attesa();
    expect(esegui).toHaveBeenCalledWith("artboard.setProps", { index: 1, name: "Retro" });
    expect(aggiorna).toHaveBeenCalled();
  });

  it("X e Y spostano la tavola col disegno; larghezza e altezza la misurano", () => {
    const { campo, esegui, corpo } = disegna(tavole(2));
    conferma(campo("tavole.x"), "400");
    expect(esegui).toHaveBeenLastCalledWith("artboard.move", { index: 1, dx: 80, dy: 0, moveArt: true });
    corpo.querySelector<HTMLInputElement>(".draw-artboards-art input")!.click();
    conferma(campo("tavole.y"), "-10");
    expect(esegui).toHaveBeenLastCalledWith("artboard.move", { index: 1, dx: 0, dy: -10, moveArt: false });
    conferma(campo("tavole.larghezza"), "500");
    expect(esegui).toHaveBeenLastCalledWith("artboard.setProps", { index: 1, width: 500 });
    conferma(campo("tavole.altezza"), "250");
    expect(esegui).toHaveBeenLastCalledWith("artboard.setProps", { index: 1, height: 250 });
  });

  it("i pulsanti mandano il comando sulla tavola scelta; spenti dicono perché e non mandano", () => {
    const molte = disegna(tavole(3));
    molte.pulsante("giu").click();
    expect(molte.esegui).toHaveBeenLastCalledWith("artboard.reorder", { index: 1, to: 2 });
    molte.pulsante("duplica").click();
    expect(molte.esegui).toHaveBeenLastCalledWith("artboard.duplicate", { index: 1, art: true });

    document.body.replaceChildren();
    const una = disegna(tavole(1, "b0"));
    for (const azione of ["elimina", "taglia"]) {
      expect(una.pulsante(azione).getAttribute("aria-disabled")).toBe("true");
      expect(una.pulsante(azione).title).toContain("Una tavola resta sempre.");
      una.pulsante(azione).click();
    }
    expect(una.pulsante("su").getAttribute("aria-disabled")).toBe("true");
    una.pulsante("su").click();
    expect(una.esegui).not.toHaveBeenCalled();
    una.pulsante("nuova").click();
    expect(una.esegui).toHaveBeenCalledWith("artboard.new", {});
  });

  it("senza tavole lo dice e mostra solo Nuova accesa", () => {
    const { corpo, pulsante } = disegna(tavole(0, null));
    expect(corpo.textContent).toContain("Il disegno non ha tavole");
    expect(corpo.querySelector<HTMLElement>(".draw-artboards-fields")!.hidden).toBe(true);
    expect(pulsante("nuova").getAttribute("aria-disabled")).toBeNull();
    expect(pulsante("duplica").getAttribute("aria-disabled")).toBe("true");
  });

  it("la famiglia pronta la registra nella scheda Design", () => {
    const sezioni = creaSezioni();
    const vita = openLifetime();
    vite.push(vita);
    famiglia.registra({ motore: null, life: vita, sezioni, registraFila: () => undefined, esegui: () => Promise.resolve() });
    expect(sezioni.di("design").map((s) => s.id)).toEqual([SEZIONE_TAVOLE]);
  });
});
