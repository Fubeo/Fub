// @vitest-environment happy-dom
// La sezione «Punto di ancoraggio» del Design (piano K6, T12, giro 4): spenta col
// perché senza punti scelti, accesa coi punti, un clic che manda un solo comando
// `path.convertAnchors` coi punti e poi rilegge lo stato dello strumento.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingAnchor } from "../../../../../host/contract";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { creaSezioni, type Selezione } from "../../sezioni";
import famiglia from "./index";
import { SEZIONE_PUNTO, sezionePunto } from "./sezione-punto";
import { TESTI } from "./testi";

const vite: Lifetime[] = [];
afterEach(() => {
  for (const vita of vite.splice(0)) vita.close();
  document.body.replaceChildren();
});

const PUNTO: DrawingAnchor = { element: "k1", subpath: 0, anchor: 2, at: [10, 20], end: false };

function disegna(sel: Selezione) {
  const esegui = vi.fn((_id: string, _valori?: Readonly<Record<string, unknown>>) => Promise.resolve());
  const rileggi = vi.fn();
  const corpo = document.createElement("div");
  document.body.append(corpo);
  const vita = openLifetime();
  vite.push(vita);
  const sezione = sezionePunto(TESTI, esegui);
  sezione.disegna({ corpo, sel, motore: null, misure: {}, colori: {}, aggiorna: vi.fn(), rileggi, vita });
  const pulsanti = [...corpo.querySelectorAll<HTMLButtonElement>(".draw-properties-segment")];
  return { sezione, corpo, esegui, rileggi, pulsanti, nota: corpo.querySelector<HTMLElement>(".draw-properties-note")! };
}

describe("la sezione Punto di ancoraggio", () => {
  it("c'è con un oggetto scelto o dei punti, e non senza niente", () => {
    const sezione = sezionePunto(TESTI, () => Promise.resolve());
    expect(sezione.id).toBe(SEZIONE_PUNTO);
    expect(sezione.scheda).toBe("design");
    expect(sezione.titolo).toBe("Punto di ancoraggio");
    expect(sezione.quando!({ numero: 0, punti: [] })).toBe(false);
    expect(sezione.quando!({ numero: 1, punti: [] })).toBe(true);
    expect(sezione.quando!({ numero: 0, punti: [PUNTO] })).toBe(true);
  });

  it("mostra solo Converti: niente raggio dell'angolo, che non ha un comando", () => {
    const { corpo, pulsanti } = disegna({ numero: 1, punti: [PUNTO] });
    expect(corpo.querySelector(".draw-properties-label")?.textContent).toBe("Converti");
    expect(pulsanti.map((p) => p.getAttribute("aria-label"))).toEqual(["Angolo", "Morbido"]);
    expect(corpo.querySelector("input")).toBeNull();
    expect(corpo.textContent).not.toContain("Raggio");
  });

  it("senza punti è spenta, dice perché, e il clic non manda niente", () => {
    const { pulsanti, nota, esegui } = disegna({ numero: 1, punti: [] });
    for (const p of pulsanti) {
      expect(p.getAttribute("aria-disabled")).toBe("true");
      expect(p.title).toContain("Scegli prima i punti con la Selezione diretta.");
      expect(p.getAttribute("aria-describedby")).toBe(nota.id);
    }
    expect(nota.hidden).toBe(false);
    expect(nota.textContent).toBe("Scegli prima i punti con la Selezione diretta.");
    pulsanti[0]!.click();
    pulsanti[1]!.click();
    expect(esegui).not.toHaveBeenCalled();
  });

  it("coi punti è accesa, senza nota", () => {
    const { pulsanti, nota } = disegna({ numero: 1, punti: [PUNTO] });
    for (const p of pulsanti) expect(p.hasAttribute("aria-disabled")).toBe(false);
    expect(pulsanti[0]!.title).toBe("Converti il punto: angolo");
    expect(nota.hidden).toBe(true);
  });

  it("un clic manda un solo comando coi punti, poi rilegge lo stato dello strumento", async () => {
    const { pulsanti, esegui, rileggi } = disegna({ numero: 1, punti: [PUNTO] });
    pulsanti[1]!.click();
    expect(esegui).toHaveBeenCalledTimes(1);
    expect(esegui).toHaveBeenCalledWith("path.convertAnchors", { to: "smooth", anchors: [PUNTO] });
    await vi.waitFor(() => expect(rileggi).toHaveBeenCalledTimes(1));
    pulsanti[0]!.click();
    expect(esegui).toHaveBeenCalledTimes(2);
    expect(esegui).toHaveBeenLastCalledWith("path.convertAnchors", { to: "corner", anchors: [PUNTO] });
  });

  it("le frecce passano da un pulsante all'altro, e Tab ne prende uno solo", () => {
    const { pulsanti } = disegna({ numero: 1, punti: [PUNTO] });
    expect(pulsanti.map((p) => p.tabIndex)).toEqual([0, -1]);
    pulsanti[0]!.focus();
    pulsanti[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(pulsanti[1]);
    expect(pulsanti.map((p) => p.tabIndex)).toEqual([-1, 0]);
  });

  it("la famiglia pronta la registra nella scheda Design", () => {
    const sezioni = creaSezioni();
    const vita = openLifetime();
    vite.push(vita);
    famiglia.registra({ motore: null, life: vita, sezioni, registraFila: () => undefined, esegui: () => Promise.resolve() });
    expect(sezioni.di("design").map((s) => s.id)).toEqual([SEZIONE_PUNTO]);
  });
});
