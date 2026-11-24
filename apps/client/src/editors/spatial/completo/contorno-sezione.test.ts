// @vitest-environment happy-dom
// La sezione «Contorno» del Design, come il pannello Stroke di VectorCraft: c'è nella scheda Design del
// Completo, fra Colore e Trasparenza; i valori arrivano subito dalla vista (`misure.contorno`) e poi
// dalla lettura del motore; ogni campo confermato manda `stroke.set` (o `stroke.setAdvanced`) senza la
// finestra della voce, con le lunghezze nell'unità della scena; una selezione mista mostra «Misto»;
// senza contorno, con un oggetto bloccato o senza selezione la sezione è spenta col perché; senza la
// lettura del motore limite, allineamento, adattamento dei trattini e punte sono spenti.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import { sezioneContorno, trattiniDaiCampi, unisciLetture } from "./contorno-sezione";
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

/// Il corpo della sezione con `numero` oggetti scelti e le misure della vista date; con `nodi` la
/// sezione ha un motore che li legge.
function corpoDi(numero: number, misure: MisureSelezione, nodi?: readonly unknown[]) {
  const esegui = vi.fn();
  const elemento = document.createElement("div");
  document.body.replaceChildren(elemento);
  const leggi = nodi === undefined ? undefined : () => Promise.resolve(nodi);
  const motore = nodi === undefined ? null : ({} as never);
  sezioneContorno({ esegui, leggi }).disegna({ corpo: elemento, sel: { numero }, misure, motore, aggiorna: () => undefined, rileggi: () => undefined, vita: openLifetime() } as never);
  return { elemento, esegui };
}

/// Aspetta che la lettura del motore arrivi e la sezione si rifaccia.
const lettura = () => new Promise((fatto) => setTimeout(fatto, 0));

/// Il riassunto di un oggetto come lo dà `document.node`: spessore e opzioni in px della scena.
function nodo(opzioni: Record<string, unknown> = {}, spessore = 4) {
  return {
    strokeWidth: spessore,
    strokeOptions: {
      cap: "butt",
      join: "miter",
      miterLimit: 10,
      align: "center",
      dash: null,
      dashOffset: 0,
      alignDashes: false,
      startArrow: null,
      endArrow: null,
      arrowAlign: "extend",
      arrowScale: [100, 100],
      canAlign: true,
      ...opzioni,
    },
  };
}

/// Il campo numerico con questa etichetta.
const campo = (corpo: HTMLElement, etichetta: string): HTMLInputElement =>
  [...corpo.querySelectorAll<HTMLElement>(".kit-number")].find((el) => el.querySelector(".kit-number-label")?.textContent === etichetta)!.querySelector<HTMLInputElement>(".kit-number-input")!;

const scelta = (corpo: HTMLElement, classe: string): HTMLSelectElement => corpo.querySelector<HTMLSelectElement>(`select.${classe}`)!;
const interruttore = (corpo: HTMLElement): HTMLInputElement => corpo.querySelector<HTMLInputElement>("input.draw-outline-dashed")!;
const bottone = (corpo: HTMLElement, classe: string): HTMLButtonElement => corpo.querySelector<HTMLButtonElement>(`button.${classe}`)!;
const trattino = (corpo: HTMLElement, n: number) => campo(corpo, t("draw.contorno.trattinoN", { n: String(n) }));
const spazio = (corpo: HTMLElement, n: number) => campo(corpo, t("draw.contorno.spazioN", { n: String(n) }));
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

  it("il tratteggio si accende coi trattini di serie (12 pt), si cambia e si spegne", () => {
    const pieno = corpoDi(1, { contorno: contorno() });
    // Col contorno pieno i campi mostrano ciò che il tratteggio riprenderebbe, spenti.
    expect(trattino(pieno.elemento, 1).value).toBe("12");
    expect(trattino(pieno.elemento, 1).disabled).toBe(true);
    const acceso = interruttore(pieno.elemento);
    acceso.checked = true;
    cambia(acceso);
    expect(pieno.esegui).toHaveBeenLastCalledWith("stroke.set", { dash: [16, 16] }, { senzaFinestra: true });

    const tratteggiato = corpoDi(1, { contorno: contorno({ trattini: [6, 3] }) });
    expect(interruttore(tratteggiato.elemento).checked).toBe(true);
    expect(trattino(tratteggiato.elemento, 1).value).toBe("6");
    expect(trattino(tratteggiato.elemento, 2).value).toBe("");
    scrivi(spazio(tratteggiato.elemento, 1), "1.5");
    expect(tratteggiato.esegui).toHaveBeenLastCalledWith("stroke.set", { dash: [8, 2] }, { senzaFinestra: true });
    // La seconda coppia allunga la serie; uno spazio vuoto vale quanto il suo trattino.
    scrivi(trattino(tratteggiato.elemento, 2), "3");
    expect(tratteggiato.esegui).toHaveBeenLastCalledWith("stroke.set", { dash: [8, 4, 4, 4] }, { senzaFinestra: true });
    const spento = interruttore(tratteggiato.elemento);
    spento.checked = false;
    cambia(spento);
    expect(tratteggiato.esegui).toHaveBeenLastCalledWith("stroke.set", { dash: [] }, { senzaFinestra: true });
    // Riacceso, il tratteggio torna com'era.
    const dopo = corpoDi(1, { contorno: contorno() });
    expect(trattino(dopo.elemento, 1).value).toBe("6");
  });

  it("svuotare un trattino chiude la serie lì", () => {
    const { elemento, esegui } = corpoDi(1, { contorno: contorno({ trattini: [6, 3, 1.5, 3] }) });
    scrivi(trattino(elemento, 2), "");
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { dash: [8, 4] }, { senzaFinestra: true });
  });

  it("i trattini dai sei campi, come edited_dash_pattern di VectorCraft", () => {
    expect(trattiniDaiCampi([6, null, null, null, null, null], [])).toEqual([6, 6]);
    expect(trattiniDaiCampi([6, 2, null, 4, 1, 1], [])).toEqual([6, 2]);
    expect(trattiniDaiCampi([0, 0, null, null, null, null], [])).toEqual([]);
    expect(trattiniDaiCampi([-1, 2, null, null, null, null], [])).toEqual([0, 2]);
    expect(trattiniDaiCampi([1, 2, 3, 4, 5, 6], [9, 9, 9, 9, 9, 9, 7, 8])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(trattiniDaiCampi([1, 2, 3, null, null, null], [9, 9, 9, 9, 9, 9, 7, 8])).toEqual([1, 2, 3, 3]);
  });

  it("una selezione mista mostra «Misto» e non manda niente da sola", () => {
    const { elemento, esegui } = corpoDi(2, { contorno: contorno({ spessore: { valore: null, ...IN_PT }, estremi: null, angoli: null, trattini: null }) });
    expect(campo(elemento, t("draw.contorno.spessore")).placeholder).toBe(t("draw.properties.mixed"));
    const estremi = scelta(elemento, "draw-outline-cap");
    expect(estremi.value).toBe("");
    expect(estremi.selectedOptions[0]!.textContent).toBe(t("draw.properties.mixed"));
    expect(scelta(elemento, "draw-outline-join").value).toBe("");
    expect(interruttore(elemento).indeterminate).toBe(true);
    expect(trattino(elemento, 1).placeholder).toBe(t("draw.properties.mixed"));
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

  it("senza la lettura del motore limite, allineamento, adattamento e punte sono spenti", () => {
    const { elemento } = corpoDi(1, { contorno: contorno() });
    expect(campo(elemento, t("draw.contorno.limite")).disabled).toBe(true);
    expect(scelta(elemento, "draw-outline-align").disabled).toBe(true);
    expect(bottone(elemento, "draw-outline-dash-fit").disabled).toBe(true);
    expect(scelta(elemento, "draw-outline-start-arrow").disabled).toBe(true);
    expect(bottone(elemento, "draw-outline-arrow-swap").disabled).toBe(true);
  });

  it("con la lettura del motore: limite, allineamento, spessore vero e tratteggio adattato", async () => {
    // Un contorno dentro la forma: la vista vede lo spessore raddoppiato, il motore quello vero.
    const { elemento, esegui } = corpoDi(1, { contorno: contorno({ spessore: { valore: 6, ...IN_PT } }) }, [
      nodo({ miterLimit: 7, align: "inside", dash: [8, 4], alignDashes: true }, 4),
    ]);
    await lettura();
    expect(campo(elemento, t("draw.contorno.spessore")).value).toBe("3");
    const limite = campo(elemento, t("draw.contorno.limite"));
    expect(limite.disabled).toBe(false);
    expect(limite.value).toBe("7");
    scrivi(limite, "600");
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { miterLimit: 500 }, { senzaFinestra: true });
    const allinea = scelta(elemento, "draw-outline-align");
    expect(allinea.value).toBe("inside");
    allinea.value = "outside";
    cambia(allinea);
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { align: "outside" }, { senzaFinestra: true });
    expect(trattino(elemento, 1).value).toBe("6");
    expect(bottone(elemento, "draw-outline-dash-fit").getAttribute("aria-pressed")).toBe("true");
    bottone(elemento, "draw-outline-dash-exact").click();
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { alignDashes: false }, { senzaFinestra: true });
  });

  it("il limite è spento con gli angoli arrotondati; dentro e fuori solo su forme chiuse", async () => {
    const { elemento } = corpoDi(2, { contorno: contorno({ angoli: "round" }) }, [nodo({ canAlign: false }), nodo()]);
    await lettura();
    expect(campo(elemento, t("draw.contorno.limite")).disabled).toBe(true);
    const voci = [...scelta(elemento, "draw-outline-align").options];
    expect(voci.filter((v) => v.disabled).map((v) => v.value)).toEqual(["inside", "outside"]);
  });

  it("le punte: inizio, fine, scambio, scala col lucchetto e allineamento", async () => {
    const { elemento, esegui } = corpoDi(1, { contorno: contorno() }, [nodo({ endArrow: "Triangle", arrowScale: [100, 250], arrowAlign: "tip" })]);
    await lettura();
    expect(scelta(elemento, "draw-outline-start-arrow").value).toBe("none");
    expect(scelta(elemento, "draw-outline-end-arrow").value).toBe("Triangle");
    expect(scelta(elemento, "draw-outline-end-arrow").options).toHaveLength(41);
    const inizio = scelta(elemento, "draw-outline-start-arrow");
    inizio.value = "Swallowtail";
    cambia(inizio);
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { startArrow: "Swallowtail" }, { senzaFinestra: true });
    bottone(elemento, "draw-outline-arrow-swap").click();
    expect(esegui).toHaveBeenLastCalledWith("stroke.setAdvanced", { swapArrows: true }, { senzaFinestra: true });
    const scalaFine = campo(elemento, t("draw.contorno.frecce.scalaFine"));
    expect(scalaFine.value).toBe("250");
    scrivi(scalaFine, "300");
    expect(esegui).toHaveBeenLastCalledWith("stroke.setAdvanced", { arrowScale: [100, 300] }, { senzaFinestra: true });
    const lucchetto = bottone(elemento, "draw-outline-arrow-link");
    lucchetto.click();
    expect(lucchetto.getAttribute("aria-pressed")).toBe("true");
    scrivi(campo(elemento, t("draw.contorno.frecce.scalaInizio")), "50");
    expect(esegui).toHaveBeenLastCalledWith("stroke.setAdvanced", { arrowScale: [50, 50] }, { senzaFinestra: true });
    lucchetto.click();
    expect(bottone(elemento, "draw-outline-arrow-tip").getAttribute("aria-pressed")).toBe("true");
    bottone(elemento, "draw-outline-arrow-extend").click();
    expect(esegui).toHaveBeenLastCalledWith("stroke.set", { arrowAlign: "extend" }, { senzaFinestra: true });
  });

  it("senza punte la scala e l'allineamento delle punte sono spenti", async () => {
    const { elemento } = corpoDi(1, { contorno: contorno() }, [nodo()]);
    await lettura();
    expect(campo(elemento, t("draw.contorno.frecce.scalaInizio")).disabled).toBe(true);
    expect(bottone(elemento, "draw-outline-arrow-tip").disabled).toBe(true);
    expect(scelta(elemento, "draw-outline-start-arrow").disabled).toBe(false);
  });

  it("le letture di più oggetti si uniscono: ciò che differisce è misto", () => {
    const unita = unisciLetture([nodo({ miterLimit: 4, startArrow: "Arrow" }), nodo({ miterLimit: 6, startArrow: "Arrow" }), null, { strokeWidth: 1 }]);
    expect(unita?.limite).toBeNull();
    expect(unita?.inizio).toBe("Arrow");
    expect(unita?.conPunta).toBe(true);
    expect(unisciLetture([null, {}])).toBeNull();
  });

  it("una lettura che arriva mentre si scrive aspetta che il fuoco esca", async () => {
    const { elemento } = corpoDi(1, { contorno: contorno() }, [nodo({ miterLimit: 7 })]);
    const spessore = campo(elemento, t("draw.contorno.spessore"));
    spessore.focus();
    await lettura();
    expect(campo(elemento, t("draw.contorno.limite")).disabled).toBe(true);
    spessore.blur();
    expect(campo(elemento, t("draw.contorno.limite")).value).toBe("7");
  });
});
