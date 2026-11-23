// @vitest-environment happy-dom
// La sezione «Contorno» del Design (K6 T15, giro 5): c'è nella scheda Design del Completo, fra Colore e
// Trasparenza; i valori attuali vengono dalla vista (`misure.contorno`); ogni campo confermato manda
// `stroke.set` senza la finestra della voce, con le lunghezze nell'unità della scena; una selezione
// mista mostra «Misto»; senza contorno, con un oggetto bloccato o senza selezione la sezione è spenta
// col perché; il limite dell'angolo e l'allineamento sono sempre spenti, col perché.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import { sezioneContorno } from "./contorno-sezione";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";
import type { ContornoSelezione, MisureSelezione } from "./sezioni";

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
  sezioneContorno(esegui).disegna({ corpo: elemento, sel: { numero }, misure, motore: null, aggiorna: () => undefined, rileggi: () => undefined, vita: openLifetime() } as never);
  return { elemento, esegui };
}

/// Il campo numerico con questa etichetta.
const campo = (corpo: HTMLElement, etichetta: string): HTMLInputElement =>
  [...corpo.querySelectorAll<HTMLElement>(".kit-number")].find((el) => el.querySelector(".kit-number-label")?.textContent === etichetta)!.querySelector<HTMLInputElement>(".kit-number-input")!;

const scelta = (corpo: HTMLElement, classe: string): HTMLSelectElement => corpo.querySelector<HTMLSelectElement>(`select.${classe}`)!;
const interruttore = (corpo: HTMLElement): HTMLInputElement => corpo.querySelector<HTMLInputElement>("input.draw-outline-dashed")!;
const note = (corpo: HTMLElement): string[] => [...corpo.querySelectorAll(".draw-outline-note")].map((p) => p.textContent ?? "");

/// Scrive un valore nel campo e lo conferma, come chi esce dal campo.
function scrivi(input: HTMLInputElement, valore: string): void {
  input.value = valore;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("blur"));
}

function cambia(select: HTMLSelectElement | HTMLInputElement): void {
  select.dispatchEvent(new Event("change"));
}

/// Lo spessore in pt: la scena lavora in px (1 pt = 4/3 px).
const IN_PT = { unita: "pt", decimali: 2, allaScena: (v: number) => (v * 4) / 3 };

function contorno(parti: Partial<ContornoSelezione> = {}): ContornoSelezione {
  return { spessore: { valore: 3, ...IN_PT }, estremi: "butt", angoli: "miter", trattini: [], bloccato: false, ...parti };
}

describe("la sezione Contorno del Design", () => {
  it("c'è nella scheda Design del Completo, dopo Colore e prima di Trasparenza", () => {
    const c = apri({ motore: motoreFinto(), life: openLifetime() } as never, {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      tasti: { selezione: () => [], annuncia: vi.fn() } as never,
    } as never);
    const ids = c.sezioni.di("design").map((una) => una.id);
    expect(ids).toContain("contorno");
    expect(ids.indexOf("contorno")).toBeGreaterThan(ids.indexOf("colore"));
    expect(ids.indexOf("contorno")).toBeLessThan(ids.indexOf("trasparenza"));
    c.chiudi();
  });

  it("mostra i valori della vista e manda stroke.set con lo spessore nell'unità della scena", () => {
    const { elemento, esegui } = corpoDi(1, { contorno: contorno({ estremi: "round", angoli: "bevel" }) });
    const spessore = campo(elemento, t("draw.contorno.spessore"));
    expect(spessore.value).toBe("3");
    expect(spessore.disabled).toBe(false);
    expect(scelta(elemento, "draw-outline-cap").value).toBe("round");
    expect(scelta(elemento, "draw-outline-join").value).toBe("bevel");
    expect(interruttore(elemento).checked).toBe(false);
    scrivi(spessore, "6");
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { weight: 8 }, { senzaFinestra: true });
  });

  it("lo stesso spessore che c'è già non manda niente; uno fuori dai limiti è portato al limite", () => {
    const { elemento, esegui } = corpoDi(1, { contorno: contorno() });
    const spessore = campo(elemento, t("draw.contorno.spessore"));
    scrivi(spessore, "3");
    expect(esegui).not.toHaveBeenCalled();
    // Il campo porta -1 a 0 e 1001 a 1000 (pt), come il motore porta lo spessore in 0..1000.
    scrivi(spessore, "-1");
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { weight: 0 }, { senzaFinestra: true });
    scrivi(spessore, "1001");
    const ultimo = esegui.mock.calls[esegui.mock.calls.length - 1]!;
    expect(ultimo[0]).toBe("stroke.set");
    expect((ultimo[1] as { weight: number }).weight).toBeCloseTo(1000 * 4 / 3, 6);
  });

  it("gli estremi e gli angoli scelti vanno al motore", () => {
    const { elemento, esegui } = corpoDi(1, { contorno: contorno() });
    const estremi = scelta(elemento, "draw-outline-cap");
    estremi.value = "square";
    cambia(estremi);
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { cap: "square" }, { senzaFinestra: true });
    const angoli = scelta(elemento, "draw-outline-join");
    angoli.value = "round";
    cambia(angoli);
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { join: "round" }, { senzaFinestra: true });
  });

  it("il tratteggio si accende, si cambia e si spegne", () => {
    const pieno = corpoDi(1, { contorno: contorno() });
    const acceso = interruttore(pieno.elemento);
    acceso.checked = true;
    cambia(acceso);
    // 4 e 3 volte lo spessore di 3 pt, in px.
    expect(pieno.esegui).toHaveBeenLastCalledWith("stroke.set", { dash: [16, 12] }, { senzaFinestra: true });

    const tratteggiato = corpoDi(1, { contorno: contorno({ trattini: [6, 3] }) });
    expect(interruttore(tratteggiato.elemento).checked).toBe(true);
    const trattino = campo(tratteggiato.elemento, t("draw.contorno.trattino"));
    expect(trattino.value).toBe("6");
    scrivi(campo(tratteggiato.elemento, t("draw.contorno.spazio")), "1.5");
    expect(tratteggiato.esegui).toHaveBeenLastCalledWith("stroke.set", { dash: [8, 2] }, { senzaFinestra: true });
    const spento = interruttore(tratteggiato.elemento);
    spento.checked = false;
    cambia(spento);
    expect(tratteggiato.esegui).toHaveBeenLastCalledWith("stroke.set", { dash: [] }, { senzaFinestra: true });
  });

  it("un tratteggio su misura lo dice, e scrivere lo sostituisce con trattino e spazio", () => {
    const { elemento, esegui } = corpoDi(1, { contorno: contorno({ trattini: [3, 1.5, 0.75, 1.5] }) });
    expect(note(elemento).some((n) => n.includes("3 1.5 0.75 1.5"))).toBe(true);
    scrivi(campo(elemento, t("draw.contorno.trattino")), "6");
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { dash: [8, 2] }, { senzaFinestra: true });
  });

  it("una selezione mista mostra «Misto» e non manda niente da sola", () => {
    const { elemento, esegui } = corpoDi(2, { contorno: contorno({ spessore: { valore: null, ...IN_PT }, estremi: null, angoli: null, trattini: null }) });
    expect(campo(elemento, t("draw.contorno.spessore")).placeholder).toBe(t("draw.properties.mixed"));
    const estremi = scelta(elemento, "draw-outline-cap");
    expect(estremi.value).toBe("");
    expect(estremi.selectedOptions[0]!.textContent).toBe(t("draw.properties.mixed"));
    expect(scelta(elemento, "draw-outline-join").value).toBe("");
    expect(interruttore(elemento).indeterminate).toBe(true);
    expect(campo(elemento, t("draw.contorno.trattino")).placeholder).toBe(t("draw.properties.mixed"));
    expect(esegui).not.toHaveBeenCalled();
  });

  it("senza contorno, con un oggetto bloccato o senza selezione è spenta col perché", () => {
    const casi: Array<[number, MisureSelezione, string]> = [
      [1, {}, t("draw.contorno.nessuno")],
      [1, { contorno: contorno({ bloccato: true }) }, t("draw.contorno.bloccato")],
      [0, {}, t("draw.contorno.vuota")],
    ];
    for (const [numero, misure, perche] of casi) {
      const { elemento, esegui } = corpoDi(numero, misure);
      expect(note(elemento)).toContain(perche);
      expect(campo(elemento, t("draw.contorno.spessore")).disabled).toBe(true);
      expect(scelta(elemento, "draw-outline-cap").disabled).toBe(true);
      expect(scelta(elemento, "draw-outline-join").disabled).toBe(true);
      expect(interruttore(elemento).disabled).toBe(true);
      expect(esegui).not.toHaveBeenCalled();
    }
  });

  it("il limite dell'angolo e l'allineamento sono spenti col perché", () => {
    const { elemento } = corpoDi(1, { contorno: contorno() });
    const limite = campo(elemento, t("draw.contorno.limite"));
    expect(limite.disabled).toBe(true);
    expect(limite.value).toBe("4");
    expect(scelta(elemento, "draw-outline-align").disabled).toBe(true);
    expect(note(elemento)).toContain(t("draw.contorno.nonScritto"));
  });
});
