// @vitest-environment happy-dom
// La sezione «Trasparenza» del Design (K6 T15, giro 2): c'è nella scheda Design del Completo; i valori
// attuali vengono dalla vista (`misure.opacita`, `misure.fusione`); l'opacità e il metodo confermati
// mandano `transparency.set` col valore scritto, senza la finestra della voce; senza una selezione i
// campi sono spenti; con più metodi la voce «Più valori» si vede e non si sceglie.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { BLEND_MODES } from "../scene/values";
import { t } from "../strings";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";
import type { MisureSelezione } from "./sezioni";
import { sezioneTrasparenza } from "./trasparenza-sezione";

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["oa1a1a1a1"], losses: [], refused: null, frame: null };

function motoreFinto(): MotoreDelDisegno {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  return { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
}

/// Il corpo della sezione con `numero` oggetti scelti e le misure della vista date.
function corpoDi(numero: number, misure: MisureSelezione) {
  const esegui = vi.fn();
  const elemento = document.createElement("div");
  sezioneTrasparenza(esegui).disegna({ corpo: elemento, sel: { numero }, misure, motore: null, aggiorna: () => undefined, rileggi: () => undefined, vita: openLifetime() } as never);
  return { elemento, esegui };
}

/// Il campo numerico con questa etichetta.
const campo = (corpo: HTMLElement, etichetta: string): HTMLInputElement =>
  [...corpo.querySelectorAll<HTMLElement>(".kit-number")].find((el) => el.querySelector(".kit-number-label")?.textContent === etichetta)!.querySelector<HTMLInputElement>(".kit-number-input")!;

/// La scelta del metodo di fusione.
const fusione = (corpo: HTMLElement): HTMLSelectElement => corpo.querySelector<HTMLSelectElement>("select")!;

/// Scrive un valore nel campo e lo conferma, come chi esce dal campo.
function scrivi(input: HTMLInputElement, valore: string): void {
  input.value = valore;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("blur"));
}

const OPACITA_40 = { valore: 40, unita: "%", decimali: 0, allaScena: (valore: number) => valore };

describe("la sezione Trasparenza del Design", () => {
  it("c'è nella scheda Design del Completo", () => {
    const c = apri({ motore: motoreFinto(), life: openLifetime() } as never, {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      tasti: { selezione: () => [], annuncia: vi.fn() } as never,
    } as never);
    expect(c.sezioni.di("design").map((una) => una.id)).toContain("trasparenza");
    c.chiudi();
  });

  it("l'opacità e il metodo di fusione attuali vengono dalla vista", () => {
    const { elemento } = corpoDi(1, { opacita: OPACITA_40, fusione: { valore: "multiply", mista: false } });
    expect(campo(elemento, t("draw.trasparenza.opacita")).value).toBe("40");
    expect(fusione(elemento).value).toBe("multiply");
  });

  it("confermare l'opacità manda transparency.set col valore scritto, senza la finestra", () => {
    const { elemento, esegui } = corpoDi(1, { opacita: OPACITA_40, fusione: { valore: "normal", mista: false } });
    scrivi(campo(elemento, t("draw.trasparenza.opacita")), "30");
    expect(esegui).toHaveBeenCalledWith("transparency.set", { opacity: 30 }, { senzaFinestra: true });
  });

  it("scegliere un metodo di fusione manda transparency.set con quel metodo", () => {
    const { elemento, esegui } = corpoDi(1, { opacita: OPACITA_40, fusione: { valore: "normal", mista: false } });
    fusione(elemento).value = "screen";
    fusione(elemento).dispatchEvent(new Event("change"));
    expect(esegui).toHaveBeenCalledWith("transparency.set", { blend: "screen" }, { senzaFinestra: true });
  });

  it("con più metodi la voce «Più valori» si vede e non si sceglie", () => {
    const { elemento, esegui } = corpoDi(2, { fusione: { valore: null, mista: true } });
    expect(fusione(elemento).value).toBe("");
    expect(fusione(elemento).options[0]!.textContent).toBe(t("draw.trasparenza.fusione.vari"));
    fusione(elemento).dispatchEvent(new Event("change"));
    expect(esegui).not.toHaveBeenCalled();
  });

  it("senza una selezione i campi sono spenti", () => {
    const { elemento } = corpoDi(0, {});
    expect(campo(elemento, t("draw.trasparenza.opacita")).disabled).toBe(true);
    expect(fusione(elemento).disabled).toBe(true);
  });

  it("ogni modo di fusione ha il suo nome, non la sua sigla", () => {
    const { elemento } = corpoDi(1, { fusione: { valore: "normal", mista: false } });
    const voci = [...fusione(elemento).options];
    expect(voci.map((voce) => voce.value)).toEqual(BLEND_MODES);
    for (const voce of voci) expect(voce.textContent).not.toBe(voce.value);
  });
});
