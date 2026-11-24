// @vitest-environment happy-dom
// «Opzioni nuova tavola…» (`ui.newArtboard`, `./nuova.ts`): i campi di serie come `artboard.new {}`
// farebbe la tavola, il nome mandato solo se cambiato, il dialogo che dà i campi o niente, e
// l'Alt+clic su Nuova tavola nella sezione che lo apre, manda `artboard.new` e porta la vista sulla
// tavola nuova.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import type { TavoleDocumento } from "../../sezioni";
import { chiediNuovaTavola, nuovaTavolaDiSerie, valoriNuovaTavola } from "./nuova";
import { sezioneTavole } from "./sezione";
import { TESTI } from "./testi";

const vite: Lifetime[] = [];
afterEach(() => {
  for (const vita of vite.splice(0)) vita.close();
  document.body.replaceChildren();
});

const parola = (chiave: string): string => TESTI[chiave]?.it ?? chiave;
const attesa = () => new Promise((r) => setTimeout(r, 0));

function tavole(nomi: readonly string[], visita = vi.fn()): TavoleDocumento {
  return { elenco: nomi.map((nome, i) => ({ id: `b${i}`, nome, rect: [i * 320, 10, 300, 200] as const })), attuale: "b0", visita };
}

function pulsanteDelDialogo(id: "apply" | "cancel"): HTMLButtonElement {
  const trovato = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.dataset.action === id || b.dataset.id === id || b.id.endsWith(id));
  if (trovato !== undefined) return trovato;
  const testo = id === "apply" ? "OK" : "Annulla";
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === testo)!;
}

describe("ui.newArtboard: i campi di serie", () => {
  it("le misure dell'ultima tavola, 20 alla sua destra, col primo nome libero", () => {
    expect(nuovaTavolaDiSerie(tavole(["Tavola 1", "Tavola 2"]))).toEqual({ name: "Tavola 3", x: 640, y: 10, width: 300, height: 200 });
    expect(nuovaTavolaDiSerie(tavole(["Tavola 1", "Tavola 2", "Tavola 4"]))).toEqual({ name: "Tavola 5", x: 960, y: 10, width: 300, height: 200 });
  });

  it("senza tavole: 612 × 792 nell'origine", () => {
    expect(nuovaTavolaDiSerie(tavole([]))).toEqual({ name: "Tavola 1", x: 0, y: 0, width: 612, height: 792 });
    expect(nuovaTavolaDiSerie(undefined)).toEqual({ name: "Tavola 1", x: 0, y: 0, width: 612, height: 792 });
  });

  it("il nome va al motore solo se non è quello di serie", () => {
    const serie = { name: "Tavola 2", x: 1, y: 2, width: 3, height: 4 };
    expect(valoriNuovaTavola(serie, serie)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(valoriNuovaTavola({ ...serie, name: "Retro" }, serie)).toEqual({ ...serie, name: "Retro" });
  });
});

describe("ui.newArtboard: il dialogo", () => {
  it("OK dà i campi scritti; Annulla niente", async () => {
    const serie = { name: "Tavola 2", x: 320, y: 0, width: 300, height: 200 };
    const scelta = chiediNuovaTavola(serie, parola);
    const nome = document.querySelector<HTMLInputElement>("#draw-artboards-new-name")!;
    expect(nome.value).toBe("Tavola 2");
    nome.value = "Retro";
    pulsanteDelDialogo("apply").click();
    expect(await scelta).toEqual({ ...serie, name: "Retro" });

    const annullata = chiediNuovaTavola(serie, parola);
    pulsanteDelDialogo("cancel").click();
    expect(await annullata).toBeNull();
  });
});

describe("ui.newArtboard: Alt+clic su Nuova tavola", () => {
  it("apre le opzioni, manda artboard.new e fa attuale la tavola nuova; il clic semplice no", async () => {
    const visita = vi.fn();
    const esegui = vi.fn((_id: string, _valori?: Readonly<Record<string, unknown>>) => Promise.resolve());
    const sezione = sezioneTavole(TESTI, esegui);
    const corpo = document.createElement("div");
    document.body.append(corpo);
    const vita = openLifetime();
    vite.push(vita);
    sezione.disegna({ corpo, sel: { numero: 0, punti: [] }, motore: null, misure: {}, colori: {}, aggiorna: vi.fn(), rileggi: vi.fn(), vita, tavole: tavole(["Tavola 1", "Tavola 2"], visita) });
    const nuova = corpo.querySelector<HTMLButtonElement>('[data-action="nuova"]')!;
    nuova.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    expect(esegui).not.toHaveBeenCalled();
    pulsanteDelDialogo("apply").click();
    await attesa();
    await attesa();
    expect(esegui).toHaveBeenCalledWith("artboard.new", { x: 640, y: 10, width: 300, height: 200 });
    expect(visita).toHaveBeenCalledWith(2);

    esegui.mockClear();
    nuova.click();
    expect(esegui).toHaveBeenCalledWith("artboard.new", {});
    expect(document.querySelector("#draw-artboards-new-name")).toBeNull();
  });
});
