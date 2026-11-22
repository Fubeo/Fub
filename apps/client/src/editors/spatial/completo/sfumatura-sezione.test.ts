// @vitest-environment happy-dom
// La sezione «Sfumatura» del Design (K6 T15, giro 5): c'è nella scheda Design del Completo, dopo
// Contorno; i valori vengono dalla vista (`misure.sfumature`); tipo, angolo, inverti e ogni punto
// mandano `paint.editGradient` senza la finestra, i punti tutti insieme e in ordine; l'angolo è quello
// del motore (antiorario), la scena lo scrive orario; scegliere un punto manda `gradient.selectStop`;
// senza selezione, con un oggetto bloccato, con soli testi la sezione è spenta col perché; punti
// diversi mostrano «Misto».
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";
import type { MisureSelezione, SfumaturaSelezione, SfumatureSelezione } from "./sezioni";
import { conUnPuntoInPiu, sezioneSfumatura } from "./sfumatura-sezione";
import type { PortaPreimpostate, Preimpostata } from "./sfumature-preimpostate";

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["oa1a1a1a1"], losses: [], refused: null, frame: null };

function motoreFinto(): MotoreDelDisegno {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  return { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
}

const TRE = [
  { offset: 0, color: "#ff0000", opacity: 1 },
  { offset: 0.5, color: "#00ff00", opacity: 0.5 },
  { offset: 1, color: "#0000ff", opacity: 1 },
];

function sfumatura(parti: Partial<SfumaturaSelezione> = {}): SfumaturaSelezione {
  return { parti: 1, conSfumatura: 1, tipo: "linear", punti: TRE, angolo: -30, ...parti };
}

function sfumature(parti: Partial<SfumatureSelezione> = {}): SfumatureSelezione {
  return { riempimento: sfumatura(), contorno: sfumatura({ conSfumatura: 0, tipo: null, punti: null, angolo: null }), bloccato: false, soloTesto: false, ...parti };
}

/// Il corpo della sezione con `numero` oggetti scelti e le misure della vista date.
function corpoDi(numero: number, misure: MisureSelezione) {
  const esegui = vi.fn();
  const elemento = document.createElement("div");
  const aggiorna = vi.fn();
  const sezione = sezioneSfumatura(esegui, openLifetime());
  const disegna = () => {
    elemento.replaceChildren();
    sezione.disegna({ corpo: elemento, sel: { numero }, misure, motore: null, aggiorna, rileggi: () => undefined, vita: openLifetime() } as never);
  };
  aggiorna.mockImplementation(disegna);
  disegna();
  return { elemento, esegui };
}

const campi = (corpo: HTMLElement, etichetta: string): HTMLInputElement[] =>
  [...corpo.querySelectorAll<HTMLElement>(".kit-number")]
    .filter((el) => el.querySelector(".kit-number-label")?.textContent === etichetta)
    .map((el) => el.querySelector<HTMLInputElement>(".kit-number-input")!);
const scelta = (corpo: HTMLElement, classe: string): HTMLSelectElement => corpo.querySelector<HTMLSelectElement>(`select.${classe}`)!;
const note = (corpo: HTMLElement): string[] => [...corpo.querySelectorAll(".draw-gradient-note")].map((p) => p.textContent ?? "");
const pulsante = (corpo: HTMLElement, testo: string): HTMLButtonElement =>
  [...corpo.querySelectorAll<HTMLButtonElement>("button.kit-button")].find((b) => b.textContent === testo)!;
const righe = (corpo: HTMLElement): HTMLElement[] => [...corpo.querySelectorAll<HTMLElement>(".draw-gradient-stop")];

function scrivi(input: HTMLInputElement, valore: string): void {
  input.value = valore;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("blur"));
}

describe("la sezione Sfumatura del Design", () => {
  it("c'è nella scheda Design del Completo, dopo Contorno e prima di Trasparenza", () => {
    const c = apri({ motore: motoreFinto(), life: openLifetime() } as never, {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      tasti: { selezione: () => [], annuncia: vi.fn() } as never,
    } as never);
    const ids = c.sezioni.di("design").map((una) => una.id);
    expect(ids.indexOf("sfumatura")).toBeGreaterThan(ids.indexOf("contorno"));
    expect(ids.indexOf("contorno")).toBeGreaterThan(-1);
    expect(ids.indexOf("sfumatura")).toBeLessThan(ids.indexOf("trasparenza"));
    c.chiudi();
  });

  it("mostra tipo, angolo del motore e punti, e cambiare il tipo manda paint.editGradient", () => {
    const { elemento, esegui } = corpoDi(1, { sfumature: sfumature() });
    expect(scelta(elemento, "draw-gradient-side").value).toBe("fill");
    expect(scelta(elemento, "draw-gradient-kind").value).toBe("linear");
    // La scena scrive -30° in senso orario: il motore lo dice 30° in senso antiorario.
    expect(campi(elemento, t("draw.sfumatura.angolo"))[0]!.value).toBe("30");
    expect(righe(elemento)).toHaveLength(3);
    expect(campi(elemento, t("draw.sfumatura.posizione")).map((c) => c.value)).toEqual(["0", "50", "100"]);
    expect(campi(elemento, t("draw.sfumatura.opacita")).map((c) => c.value)).toEqual(["100", "50", "100"]);
    const tipo = scelta(elemento, "draw-gradient-kind");
    tipo.value = "radial";
    tipo.dispatchEvent(new Event("change"));
    expect(esegui).toHaveBeenLastCalledWith("paint.editGradient", { stroke: false, kind: "radial" });
  });

  it("l'angolo scritto va al motore normalizzato", () => {
    const { elemento, esegui } = corpoDi(1, { sfumature: sfumature() });
    scrivi(campi(elemento, t("draw.sfumatura.angolo"))[0]!, "270");
    expect(esegui).toHaveBeenLastCalledWith("paint.editGradient", { stroke: false, angle: -90 });
  });

  it("ogni punto si sposta, cambia opacità e si toglie mandando tutti i punti in ordine", () => {
    const { elemento, esegui } = corpoDi(1, { sfumature: sfumature() });
    scrivi(campi(elemento, t("draw.sfumatura.posizione"))[1]!, "90");
    expect(esegui).toHaveBeenLastCalledWith("paint.editGradient", {
      stroke: false,
      stops: [TRE[0], { ...TRE[1], offset: 0.9 }, TRE[2]],
    });
    scrivi(campi(elemento, t("draw.sfumatura.posizione"))[0]!, "100");
    // Il primo punto va dopo l'ultimo a pari posizione: l'ordine resta quello scritto.
    expect(esegui.mock.lastCall![1].stops.map((p: { color: string }) => p.color)).toEqual(["#00ff00", "#ff0000", "#0000ff"]);
    scrivi(campi(elemento, t("draw.sfumatura.opacita"))[2]!, "25");
    expect(esegui).toHaveBeenLastCalledWith("paint.editGradient", { stroke: false, stops: [TRE[0], TRE[1], { ...TRE[2], opacity: 0.25 }] });
    righe(elemento)[1]!.querySelector<HTMLButtonElement>(".draw-gradient-remove")!.click();
    expect(esegui).toHaveBeenLastCalledWith("paint.editGradient", { stroke: false, stops: [TRE[0], TRE[2]] });
  });

  it("con due punti «Togli» è spento col perché", () => {
    const { elemento } = corpoDi(1, { sfumature: sfumature({ riempimento: sfumatura({ punti: [TRE[0]!, TRE[2]!] }) }) });
    const togli = [...elemento.querySelectorAll<HTMLButtonElement>(".draw-gradient-remove")];
    expect(togli.every((b) => b.disabled)).toBe(true);
    expect(togli[0]!.title).toBe(t("draw.sfumatura.minimo"));
  });

  it("aggiungi mette un punto a metà del tratto più lungo, inverti manda reverse", () => {
    const { elemento, esegui } = corpoDi(1, { sfumature: sfumature() });
    pulsante(elemento, t("draw.sfumatura.aggiungi")).click();
    expect(esegui.mock.lastCall![1].stops).toHaveLength(4);
    pulsante(elemento, t("draw.sfumatura.inverti")).click();
    expect(esegui).toHaveBeenLastCalledWith("paint.editGradient", { stroke: false, reverse: true });
  });

  it("scegliere un punto lo dice al motore e lo segna", () => {
    const { elemento, esegui } = corpoDi(1, { sfumature: sfumature() });
    const riga = righe(elemento)[2]!;
    riga.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(esegui).toHaveBeenLastCalledWith("gradient.selectStop", { index: 2 });
    expect(riga.classList.contains("draw-gradient-stop-chosen")).toBe(true);
  });

  it("sul contorno pieno offre di crearla, e il lato scelto resta", () => {
    const { elemento, esegui } = corpoDi(1, { sfumature: sfumature() });
    const lato = scelta(elemento, "draw-gradient-side");
    lato.value = "stroke";
    lato.dispatchEvent(new Event("change"));
    expect(scelta(elemento, "draw-gradient-side").value).toBe("stroke");
    expect(righe(elemento)).toHaveLength(0);
    expect(note(elemento)[0]).toContain(t("draw.properties.stroke"));
    pulsante(elemento, t("draw.sfumatura.crea")).click();
    expect(esegui).toHaveBeenLastCalledWith("paint.editGradient", { stroke: true, kind: "linear" });
  });

  it("punti diversi e tipi diversi mostrano «Misto» e non mandano niente da soli", () => {
    const { elemento, esegui } = corpoDi(2, { sfumature: sfumature({ riempimento: sfumatura({ parti: 2, conSfumatura: 2, tipo: null, punti: null, angolo: null }) }) });
    expect(scelta(elemento, "draw-gradient-kind").value).toBe("");
    expect(scelta(elemento, "draw-gradient-kind").options[0]!.textContent).toBe(t("draw.properties.mixed"));
    expect(campi(elemento, t("draw.sfumatura.angolo"))[0]!.value).toBe("");
    expect(note(elemento)).toContain(t("draw.sfumatura.diverse"));
    expect(righe(elemento)).toHaveLength(0);
    expect(esegui).not.toHaveBeenCalled();
  });

  it("senza selezione, con un oggetto bloccato o con soli testi è spenta col perché", () => {
    for (const [numero, misure, perche] of [
      [0, {}, t("draw.sfumatura.vuota")],
      [1, { sfumature: sfumature({ bloccato: true }) }, t("draw.sfumatura.bloccato")],
      [1, { sfumature: { bloccato: false, soloTesto: true } }, t("draw.sfumatura.testo")],
    ] as const) {
      const { elemento, esegui } = corpoDi(numero, misure);
      expect(note(elemento)).toContain(perche);
      for (const b of elemento.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select:not(.draw-gradient-side)")) {
        expect(b.disabled).toBe(true);
      }
      elemento.querySelector<HTMLButtonElement>("button.kit-button")?.click();
      expect(esegui).not.toHaveBeenCalled();
    }
  });
});

describe("un punto in più", () => {
  it("va a metà del tratto più lungo, col colore e l'opacità a metà", () => {
    const punti = conUnPuntoInPiu([
      { offset: 0, color: "#000000", opacity: 1 },
      { offset: 0.2, color: "#ffffff", opacity: 1 },
      { offset: 1, color: "#000000", opacity: 0 },
    ]);
    expect(punti).toHaveLength(4);
    expect(punti[2]).toEqual({ offset: 0.6, color: "#808080", opacity: 0.5 });
  });
});

/// Una porta delle preimpostate finta: l'elenco cambia con quello che si salva e si toglie.
function portaFinta(elencoIniziale: readonly Preimpostata[], comeVa: "bene" | "assente" = "bene") {
  let elenco = [...elencoIniziale];
  const porta = {
    elenco: vi.fn(() => Promise.resolve(comeVa === "assente" ? ({ kind: "assente" } as const) : ({ kind: "pronte", preimpostate: elenco } as const))),
    salva: vi.fn((nome: string) => {
      elenco = [...elenco, { nome, tema: null, delMotore: false, tipo: "linear" as const, punti: TRE }];
      return Promise.resolve({ kind: "fatto" as const, nome });
    }),
    togli: vi.fn((nome: string) => {
      elenco = elenco.filter((p) => p.nome !== nome);
      return Promise.resolve({ kind: "fatto" as const, nome });
    }),
  } satisfies PortaPreimpostate;
  return porta;
}

const PREIMPOSTATE: readonly Preimpostata[] = [
  { nome: "Dawn", tema: "Sky Gradients", delMotore: true, tipo: "linear", punti: TRE },
  { nome: "Red Glow", tema: "Radial Glows", delMotore: true, tipo: "radial", punti: TRE },
  { nome: "Mare", tema: null, delMotore: false, tipo: "linear", punti: TRE },
];

/// Il corpo della sezione con la porta delle preimpostate.
function corpoConPreimpostate(numero: number, misure: MisureSelezione, porta: PortaPreimpostate) {
  const esegui = vi.fn();
  const elemento = document.createElement("div");
  const aggiorna = vi.fn();
  const sezione = sezioneSfumatura(esegui, openLifetime(), { lato: "fill" }, porta);
  const disegna = () => {
    elemento.replaceChildren();
    sezione.disegna({ corpo: elemento, sel: { numero }, misure, motore: null, aggiorna, rileggi: () => undefined, vita: openLifetime() } as never);
  };
  aggiorna.mockImplementation(disegna);
  disegna();
  return { elemento, esegui };
}

/// Apre le preimpostate e aspetta l'elenco.
async function apriPreimpostate(elemento: HTMLElement): Promise<void> {
  const blocco = elemento.querySelector<HTMLDetailsElement>("details.draw-gradient-presets")!;
  blocco.open = true;
  blocco.dispatchEvent(new Event("toggle"));
  await vi.waitFor(() => expect(elemento.querySelector("select.draw-gradient-preset, .draw-gradient-presets-error")).not.toBeNull());
}

describe("le preimpostate della sezione Sfumatura (gradient presets)", () => {
  it("sono chiuse finché non si aprono, poi mostrano i temi e i nomi nella lingua, le salvate per ultime", async () => {
    const porta = portaFinta(PREIMPOSTATE);
    const { elemento } = corpoConPreimpostate(1, { sfumature: sfumature() }, porta);
    expect(porta.elenco).not.toHaveBeenCalled();
    expect(elemento.querySelector(".draw-gradient-presets-title")?.textContent).toBe(t("draw.sfumatura.preimpostate"));
    await apriPreimpostate(elemento);
    expect(porta.elenco).toHaveBeenCalledTimes(1);
    const select = scelta(elemento, "draw-gradient-preset");
    expect([...select.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Cielo", "Bagliori radiali", "Salvate"]);
    expect([...select.options].map((o) => o.textContent)).toEqual(["Alba", "Bagliore rosso", "Mare"]);
    // Un giro nuovo della sezione non rilegge l'elenco e le lascia aperte.
    pulsante(elemento, t("draw.sfumatura.inverti")).click();
    expect(elemento.querySelector<HTMLDetailsElement>("details.draw-gradient-presets")!.open).toBe(true);
    expect(porta.elenco).toHaveBeenCalledTimes(1);
  });

  it("Applica manda gradient.presets.apply col nome del motore e il lato mostrato; Elimina c'è solo per una salvata", async () => {
    const porta = portaFinta(PREIMPOSTATE);
    const { elemento, esegui } = corpoConPreimpostate(1, { sfumature: sfumature() }, porta);
    await apriPreimpostate(elemento);
    expect(elemento.querySelector(".draw-gradient-delete")).toBeNull();
    pulsante(elemento, t("draw.sfumatura.applica")).click();
    expect(esegui).toHaveBeenLastCalledWith("gradient.presets.apply", { name: "Dawn", stroke: false });
    const select = scelta(elemento, "draw-gradient-preset");
    select.value = "Mare";
    select.dispatchEvent(new Event("change"));
    pulsante(elemento, t("draw.sfumatura.elimina")).click();
    await vi.waitFor(() => expect(porta.togli).toHaveBeenCalledWith("Mare"));
    await vi.waitFor(() => expect([...scelta(elemento, "draw-gradient-preset").options].map((o) => o.value)).toEqual(["Dawn", "Red Glow"]));
    expect(elemento.textContent).toContain(t("draw.sfumatura.elimina.fatto", { nome: "Mare" }));
  });

  it("salvare controlla il nome prima del motore: vuoto o già preso non parte", async () => {
    const porta = portaFinta(PREIMPOSTATE);
    const { elemento } = corpoConPreimpostate(1, { sfumature: sfumature() }, porta);
    await apriPreimpostate(elemento);
    const nome = (): HTMLInputElement => elemento.querySelector<HTMLInputElement>("input.draw-gradient-save-name")!;
    pulsante(elemento, t("draw.sfumatura.salva")).click();
    expect(elemento.textContent).toContain(t("draw.sfumatura.salva.vuoto"));
    nome().value = "alba";
    nome().dispatchEvent(new Event("input"));
    pulsante(elemento, t("draw.sfumatura.salva")).click();
    expect(elemento.textContent).toContain(t("draw.sfumatura.salva.preso", { nome: "alba" }));
    expect(porta.salva).not.toHaveBeenCalled();
    nome().value = " Lago ";
    nome().dispatchEvent(new Event("input"));
    nome().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(porta.salva).toHaveBeenCalledWith("Lago", "fill", "fill"));
    await vi.waitFor(() => expect(scelta(elemento, "draw-gradient-preset").value).toBe("Lago"));
    expect(elemento.textContent).toContain(t("draw.sfumatura.salva.fatto", { nome: "Lago" }));
    expect(nome().value).toBe("");
  });

  it("senza sfumatura si applica ma non si salva; spenta non si applica; un elenco che non arriva offre Riprova", async () => {
    const porta = portaFinta(PREIMPOSTATE);
    const piena = corpoConPreimpostate(1, { sfumature: sfumature({ riempimento: sfumatura({ conSfumatura: 0, tipo: null, punti: null, angolo: null }) }) }, porta);
    await apriPreimpostate(piena.elemento);
    expect(pulsante(piena.elemento, t("draw.sfumatura.applica")).disabled).toBe(false);
    expect(piena.elemento.querySelector(".draw-gradient-save")).toBeNull();
    const spenta = corpoConPreimpostate(1, { sfumature: sfumature({ bloccato: true }) }, porta);
    await apriPreimpostate(spenta.elemento);
    expect(pulsante(spenta.elemento, t("draw.sfumatura.applica")).disabled).toBe(true);
    expect(spenta.elemento.querySelector(".draw-gradient-save")).toBeNull();

    const guasta = portaFinta(PREIMPOSTATE, "assente");
    const { elemento } = corpoConPreimpostate(1, { sfumature: sfumature() }, guasta);
    await apriPreimpostate(elemento);
    expect(elemento.textContent).toContain(t("draw.sfumatura.preimpostate.errore"));
    pulsante(elemento, t("draw.sfumatura.preimpostate.riprova")).click();
    await vi.waitFor(() => expect(guasta.elenco).toHaveBeenCalledTimes(2));
  });

  it("con le preferenze del motore più nuove o rotte Salva ed Elimina dicono il perché e la sezione resta usabile", async () => {
    for (const [perche, chiave] of [["nuove", "draw.sfumatura.preimpostate.nuove"], ["rotte", "draw.sfumatura.preimpostate.rotte"]] as const) {
      const porta = {
        ...portaFinta(PREIMPOSTATE),
        salva: vi.fn(() => Promise.resolve({ kind: "bloccato" as const, perche })),
        togli: vi.fn(() => Promise.resolve({ kind: "bloccato" as const, perche })),
      } satisfies PortaPreimpostate;
      const { elemento } = corpoConPreimpostate(1, { sfumature: sfumature() }, porta);
      await apriPreimpostate(elemento);
      const nome = elemento.querySelector<HTMLInputElement>("input.draw-gradient-save-name")!;
      nome.value = "Lago";
      nome.dispatchEvent(new Event("input"));
      pulsante(elemento, t("draw.sfumatura.salva")).click();
      await vi.waitFor(() => expect(elemento.textContent).toContain(t(chiave)));
      expect([...scelta(elemento, "draw-gradient-preset").options].map((o) => o.value)).toEqual(["Dawn", "Red Glow", "Mare"]);
      const select = scelta(elemento, "draw-gradient-preset");
      select.value = "Mare";
      select.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(pulsante(elemento, t("draw.sfumatura.elimina")).disabled).toBe(false));
      pulsante(elemento, t("draw.sfumatura.elimina")).click();
      await vi.waitFor(() => expect(porta.togli).toHaveBeenCalledWith("Mare"));
      await vi.waitFor(() => expect(elemento.textContent).toContain(t(chiave)));
      // Mare resta scelta e c'è ancora; Applica e Salva tornano accesi.
      expect(scelta(elemento, "draw-gradient-preset").value).toBe("Mare");
      expect(pulsante(elemento, t("draw.sfumatura.applica")).disabled).toBe(false);
      expect(pulsante(elemento, t("draw.sfumatura.salva")).disabled).toBe(false);
    }
  });
});
