// @vitest-environment happy-dom
// La scheda Risorse (piano K6, T10): i campioni del documento, le sezioni del
// registro del Completo, l'errore con «Riprova», il giro per fotogramma e i
// disposer che si chiamano a ogni giro e allo smontaggio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { creaSezioni, type ContestoSezione, type Sezione, type Sezioni } from "../completo/sezioni";
import { doc } from "../scene/test-support";
import { SceneEngine } from "../scene/engine";
import { campioniDel, createResourcesPanel } from "./resources-panel";

const SWATCH = '<linearGradient id="r3" fub:role="swatch" fub:name="Blu"><stop stop-color="#0072b2"/></linearGradient>';
const SWATCH_DUE = '<linearGradient id="r4" fub:role="swatch" fub:name="Rosso"><stop stop-color="#cc0000"/></linearGradient>';

/// I fotogrammi finti: `requestAnimationFrame` mette il giro in coda, e il
/// test lo fa partire quando vuole.
let coda: FrameRequestCallback[] = [];
const fotogramma = (): void => {
  const attesa = coda;
  coda = [];
  for (const cb of attesa) cb(0);
};

let vita: Lifetime;

beforeEach(() => {
  coda = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    coda.push(cb);
    return coda.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vita = openLifetime();
});

afterEach(() => {
  vita.close();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/// Il modello di un disegno con i campioni dati.
function modello(...campioni: string[]) {
  const engine = SceneEngine.open(doc(`<defs>${campioni.join("")}</defs>`));
  return engine.model!;
}

/// Un pannello montato con `modello`, e la sua selezione vuota.
function pannello(documento = modello()) {
  const panel = createResourcesPanel(vita, { modello: () => documento, selezione: () => ({ numero: 0 }) });
  document.body.append(panel.element);
  fotogramma();
  return panel;
}

const sezione = (id: string, extra: Partial<Sezione> = {}): Sezione => ({
  id,
  scheda: "risorse",
  titolo: `Titolo ${id}`,
  disegna: ({ corpo }) => {
    const p = document.createElement("p");
    p.textContent = `corpo ${id}`;
    corpo.append(p);
  },
  ...extra,
});

/// Gli id delle sezioni montate, nell'ordine in cui stanno nella scheda.
const idMontati = (el: HTMLElement): string[] => [...el.querySelectorAll<HTMLElement>(".draw-properties-section")].map((each) => each.dataset.section ?? "");

describe("i campioni del documento", () => {
  it("li legge dalle risorse con un nome e un colore", () => {
    expect(campioniDel(modello(SWATCH, SWATCH_DUE))).toEqual([
      { id: "r3", name: "Blu", color: "#0072b2" },
      { id: "r4", name: "Rosso", color: "#cc0000" },
    ]);
  });

  it("li mostra in un gruppo, col conto", () => {
    const panel = pannello(modello(SWATCH, SWATCH_DUE));
    expect(panel.element.textContent).toContain("Campioni del documento: 2");
    expect(panel.element.querySelectorAll(".kit-color-swatch")).toHaveLength(2);
    expect(panel.element.querySelector('[aria-label="Blu"]')).not.toBeNull();
  });

  it("senza campioni dice che il disegno non ne ha, e non fa gruppi", () => {
    const panel = pannello(modello());
    expect(panel.element.textContent).toContain("Il disegno non ha campioni.");
    expect(panel.element.querySelector(".kit-color-group")).toBeNull();
  });
});

describe("le sezioni del registro", () => {
  it("compaiono dopo i campioni, nell'ordine della mappa", () => {
    const sezioni: Sezioni = creaSezioni();
    sezioni.registra(sezione("pennelli", { ordine: 20 }));
    sezioni.registra(sezione("simboli", { ordine: 30 }));
    sezioni.registra(sezione("stili", { ordine: 10 }));
    const panel = pannello();
    panel.collega(sezioni, null);
    fotogramma();
    expect(idMontati(panel.element)).toEqual(["documento", "stili", "pennelli", "simboli"]);
  });

  it("una sezione che la selezione non vuole non si vede", () => {
    const sezioni = creaSezioni();
    sezioni.registra(sezione("solo-con-scelta", { quando: (sel) => sel.numero > 0 }));
    const panel = pannello();
    panel.collega(sezioni, null);
    fotogramma();
    expect(idMontati(panel.element)).toEqual(["documento"]);
  });

  it("un id di famiglia uguale a quello dei campioni resta una sezione in più", () => {
    const sezioni = creaSezioni();
    sezioni.registra(sezione("documento"));
    const panel = pannello();
    panel.collega(sezioni, null);
    fotogramma();
    expect(idMontati(panel.element)).toEqual(["documento", "documento"]);
  });

  it("una sezione nuova che arriva si monta al giro dopo", () => {
    const sezioni = creaSezioni();
    const panel = pannello();
    panel.collega(sezioni, null);
    fotogramma();
    expect(idMontati(panel.element)).toEqual(["documento"]);
    sezioni.registra(sezione("pennelli"));
    fotogramma();
    expect(idMontati(panel.element)).toEqual(["documento", "pennelli"]);
  });

  it("staccato il Completo, le sue sezioni si smontano e i loro disposer si chiamano", () => {
    const sezioni = creaSezioni();
    const fine = vi.fn();
    sezioni.registra(sezione("pennelli", { disegna: () => fine }));
    const panel = pannello();
    panel.collega(sezioni, null);
    fotogramma();
    expect(fine).not.toHaveBeenCalled();
    panel.collega(null, null);
    fotogramma();
    expect(idMontati(panel.element)).toEqual(["documento"]);
    expect(fine).toHaveBeenCalledTimes(1);
  });
});

describe("il giro di una sezione", () => {
  it("un errore dice che la parte non si è aperta, con «Riprova», e le altre restano", () => {
    const sezioni = creaSezioni();
    let tentativi = 0;
    sezioni.registra(sezione("rotta", {
      disegna: () => {
        tentativi += 1;
        if (tentativi === 1) throw new Error("boom");
        return undefined;
      },
    }));
    sezioni.registra(sezione("sana"));
    const panel = pannello();
    panel.collega(sezioni, null);
    fotogramma();
    const rotta = panel.element.querySelector<HTMLElement>('[data-section="rotta"]')!;
    expect(rotta.querySelector(".draw-properties-error")?.textContent).toContain("«Riprova»");
    expect(panel.element.querySelector('[data-section="sana"]')!.textContent).toContain("Titolo sana");
    const riprova = rotta.querySelector<HTMLButtonElement>(".draw-resources-retry")!;
    expect(riprova.hidden).toBe(false);
    riprova.click();
    expect(tentativi).toBe(2);
    expect(rotta.querySelector<HTMLElement>(".draw-properties-error")!.hidden).toBe(true);
  });

  it("ogni giro chiude il disposer e la vita del giro precedente", () => {
    const sezioni = creaSezioni();
    const fine = vi.fn();
    const vite: Lifetime[] = [];
    sezioni.registra(sezione("pennelli", {
      disegna: (ctx: ContestoSezione) => {
        vite.push(ctx.vita);
        return fine;
      },
    }));
    const panel = pannello();
    panel.collega(sezioni, null);
    fotogramma();
    expect(vite).toHaveLength(1);
    expect(vite[0]!.closed).toBe(false);
    panel.aggiorna();
    fotogramma();
    expect(vite).toHaveLength(2);
    expect(vite[0]!.closed).toBe(true);
    expect(fine).toHaveBeenCalledTimes(1);
  });

  it("più richieste nello stesso fotogramma fanno un giro solo", () => {
    const sezioni = creaSezioni();
    const disegna = vi.fn();
    sezioni.registra(sezione("pennelli", { disegna }));
    const panel = pannello();
    panel.collega(sezioni, null);
    fotogramma();
    const prima = disegna.mock.calls.length;
    panel.aggiorna();
    panel.aggiorna();
    panel.aggiorna();
    expect(coda).toHaveLength(1);
    fotogramma();
    expect(disegna.mock.calls.length).toBe(prima + 1);
  });

  it("il pulsante di apertura chiude e riapre il corpo", () => {
    const panel = pannello();
    const toggle = panel.element.querySelector<HTMLButtonElement>(".draw-properties-toggle")!;
    const body = toggle.getAttribute("aria-controls") ? document.getElementById(toggle.getAttribute("aria-controls")!)! : null;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(body?.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body?.hidden).toBe(false);
  });
});

describe("il ciclo di vita", () => {
  it("chiudere la scheda smonta le sezioni e chiama i disposer", () => {
    const sezioni = creaSezioni();
    const fine = vi.fn();
    sezioni.registra(sezione("pennelli", { disegna: () => fine }));
    const panel = pannello();
    panel.collega(sezioni, null);
    fotogramma();
    panel.dispose();
    expect(fine).toHaveBeenCalledTimes(1);
    expect(panel.element.querySelectorAll(".draw-properties-section")).toHaveLength(0);
  });

  it("dopo la chiusura del registro il pannello non si rifà più", () => {
    const sezioni = creaSezioni();
    const panel = pannello();
    panel.collega(sezioni, null);
    fotogramma();
    sezioni.chiudi();
    sezioni.registra(sezione("tardiva"));
    fotogramma();
    expect(idMontati(panel.element)).toEqual(["documento"]);
  });
});
