// @vitest-environment happy-dom
//
// La fila delle opzioni del Contagocce (K6 T14, giro 7): le regole pure (campione, copia e i
// comandi `disegno.eyedropper.setOptions` che mandano) e la fila montata, che legge le
// preferenze del motore e manda un comando per ogni cambio.

import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import type { AzioniFila } from "../../opzioni";
import { campioneDi, comandoDellaCopia, comandoDelCampione, COMANDO_OPZIONI_CONTAGOCCE, COMANDO_PREFERENZE_LETTURA, copiaDi, filaContagocce } from "./opzioni-contagocce";
import famiglia from "./index";

const vite: Lifetime[] = [];
afterEach(() => {
  while (vite.length > 0) vite.pop()!.close();
  document.body.replaceChildren();
});

/// Una vita che si chiude a fine test, e le azioni della fila che registrano ciò che mandano.
function azioniFinte(letto: unknown = null) {
  const vita = openLifetime();
  vite.push(vita);
  const esegui = vi.fn<AzioniFila["esegui"]>();
  const leggi = vi.fn<AzioniFila["leggi"]>(() => Promise.resolve(letto));
  const annuncia = vi.fn<AzioniFila["annuncia"]>();
  return { vita, azioni: { esegui, leggi, annuncia } satisfies AzioniFila, esegui, leggi };
}

/// Il pulsante del campione con questa parola, e la casella con questa frase.
const scelta = (el: HTMLElement, testo: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === testo)!;
const casella = (el: HTMLElement, testo: string) =>
  [...el.querySelectorAll<HTMLLabelElement>("label")].find((l) => l.textContent?.trim() === testo)!.querySelector<HTMLInputElement>("input")!;

describe("le regole della fila del Contagocce", () => {
  it("il campione è 1 di serie, e 3 o 5 se il motore lo dice", () => {
    expect(campioneDi(null)).toBe("1");
    expect(campioneDi({ sampleSize: 1 })).toBe("1");
    expect(campioneDi({ sampleSize: 3 })).toBe("3");
    expect(campioneDi({ sampleSize: 5 })).toBe("5");
    expect(campioneDi({ sampleSize: 4 })).toBe("1");
  });

  it("copia tutto di serie, e spegne solo ciò che il motore dice spento", () => {
    expect(copiaDi(null)).toEqual({ riempimento: true, contorno: true, opacita: true, testo: true });
    const prefs = { pickUp: { appearance: { fill: { color: false, transparency: true, overprint: true }, transparency: false }, character: false } };
    expect(copiaDi(prefs)).toEqual({ riempimento: false, contorno: true, opacita: false, testo: false });
  });

  it("il comando del campione dice il numero di punti, e quello della copia lo stesso ramo in raccogli e in applica", () => {
    expect(comandoDelCampione(3)).toEqual({ sampleSize: 3 });
    expect(comandoDellaCopia("riempimento", false)).toEqual({
      pickUp: { appearance: { fill: false } },
      apply: { appearance: { fill: false } },
    });
    expect(comandoDellaCopia("opacita", true)).toEqual({
      pickUp: { appearance: { transparency: true } },
      apply: { appearance: { transparency: true } },
    });
    expect(comandoDellaCopia("testo", false)).toEqual({
      pickUp: { character: false, paragraph: false },
      apply: { character: false, paragraph: false },
    });
  });

  it("la famiglia registra la fila per il Contagocce, e solo per lui", () => {
    const registrate: string[] = [];
    famiglia.registra({ registraFila: (strumento: string) => registrate.push(strumento) } as never);
    expect(registrate).toEqual(["eyedropper"]);
  });
});

describe("la fila montata", () => {
  it("cambiare il campione manda il comando con il numero di punti scelto", () => {
    const { vita, azioni, esegui } = azioniFinte();
    const fila = filaContagocce(azioni, vita)!;
    for (const voce of fila.voci!) document.body.append(voce.element);
    scelta(document.body, "3 punti").click();
    expect(esegui).toHaveBeenCalledTimes(1);
    expect(esegui).toHaveBeenCalledWith(COMANDO_OPZIONI_CONTAGOCCE, { sampleSize: 3 }, "Opzioni contagocce: Campione");
  });

  it("spegnere «Testo» manda il comando di raccogli e di applica", () => {
    const { vita, azioni, esegui } = azioniFinte();
    const fila = filaContagocce(azioni, vita)!;
    for (const voce of fila.voci!) document.body.append(voce.element);
    const testo = casella(document.body, "Testo");
    testo.checked = false;
    testo.dispatchEvent(new Event("change"));
    expect(esegui).toHaveBeenCalledWith(
      COMANDO_OPZIONI_CONTAGOCCE,
      { pickUp: { character: false, paragraph: false }, apply: { character: false, paragraph: false } },
      "Opzioni contagocce: Testo",
    );
  });

  it("le opzioni salvate nel motore vengono lette una volta e messe nei controlli", async () => {
    const { vita, azioni, leggi } = azioniFinte({ sampleSize: 5, pickUp: { appearance: { stroke: { color: false } } } });
    const fila = filaContagocce(azioni, vita)!;
    for (const voce of fila.voci!) document.body.append(voce.element);
    expect(leggi).toHaveBeenCalledWith(COMANDO_PREFERENZE_LETTURA, { key: "eyedropper" });
    await Promise.resolve();
    await Promise.resolve();
    expect(scelta(document.body, "5 punti").getAttribute("aria-checked")).toBe("true");
    expect(casella(document.body, "Contorno").checked).toBe(false);
    expect(casella(document.body, "Riempimento").checked).toBe(true);
  });

  it("una lettura che non arriva lascia le opzioni di serie, senza errori", async () => {
    const { vita, azioni } = azioniFinte(null);
    const fila = filaContagocce(azioni, vita)!;
    for (const voce of fila.voci!) document.body.append(voce.element);
    await Promise.resolve();
    expect(scelta(document.body, "1 punto").getAttribute("aria-checked")).toBe("true");
  });
});
