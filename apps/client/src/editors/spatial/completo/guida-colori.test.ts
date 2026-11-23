// @vitest-environment happy-dom
// La guida dei colori (K6 T14, guida): la sezione `color_guide` del Design e le finestre
// `ui.colorGuideOptions` (Opzioni) e `ui.colorGuideLimit` (Limita) con un motore finto. La guida legge
// `color.harmony` e non scrive niente; un clic su un colore dà il colore al lato attivo in un solo
// comando; senza scelta parte dal colore attivo (`paint.proxies`) e i clic sono spenti; un esito vecchio
// non sovrascrive quello nuovo; le scelte stanno nella pagina, non nel file.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingOutcome } from "../../../host/contract";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import type { DipendenzeComando } from "./esegui";
import { apriLimiteGuida, apriOpzioniGuida, GUIDA_DI_SERIE, type StatoGuida } from "./guida-colori-finestre";
import { guidaDaLettura, hexDellaVernice, registraGuidaColori, sezioneGuidaColori } from "./guida-colori-sezione";
import type { ContestoSezione, Sezioni } from "./sezioni";

type Richiesta = { id: string; selection: string[]; value: Record<string, unknown>; preview?: boolean };

function esito(reading: unknown): DrawingOutcome {
  return { revision: "1", preview: null, ops: null, selection: [], losses: [], refused: null, frame: null, reading } as DrawingOutcome;
}

/// La lettura di `color.harmony` per un colore di partenza: due righe, la prima col colore al centro.
function armonia(colore: string, passi = 4): unknown {
  const celle = Array.from({ length: 2 * passi + 1 }, () => colore);
  return { rule: "complementary", colors: [colore, "#00ffff"], grid: [celle, celle] };
}

const LIBRERIE = {
  libraries: [
    { id: "grays-neutrals", name: "Grays and Neutrals", category: "builtIn" },
    { id: "earth-tones", name: "Earth Tones", category: "builtIn" },
    { id: "il-mio", name: "Il mio", category: "user" },
  ],
  userFolder: null,
};
const SOLO_SISTEMA = { swatches: [{ name: "[None]", kind: "none" }, { name: "[Registration]", kind: "color" }] };
const CON_UN_CAMPIONE = { swatches: [{ name: "[None]", kind: "none" }, { name: "Rosso mare", kind: "color" }] };

/// Un motore finto: `risposta` dà l'esito di ogni comando (anche in ritardo, con una promessa).
function motoreFinto(risposta: (richiesta: Richiesta) => DrawingOutcome | Promise<DrawingOutcome>) {
  const comando = vi.fn((richiesta: Richiesta) => Promise.resolve(risposta(richiesta)));
  const sessione = { comando } as unknown as SessioneMotore;
  const motore = { pronta: () => Promise.resolve(sessione), adesso: () => sessione, assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Le risposte di base: la guida dal colore dato, il colore attivo bianco e nero, le librerie e i campioni.
function rispostaDiBase(richiesta: Richiesta): DrawingOutcome {
  switch (richiesta.id) {
    case "disegno.color.harmony":
      return esito(armonia(String(richiesta.value.color), Number(richiesta.value.steps ?? 4)));
    case "disegno.paint.proxies":
      return esito({
        fill: { type: "solid", color: { model: "rgb", r: 1, g: 1, b: 1 } },
        stroke: { type: "solid", color: { model: "rgb", r: 0, g: 0, b: 0 } },
        fillActive: true,
        fillMixed: false,
        strokeMixed: false,
      });
    case "disegno.swatch.library.list":
      return esito(LIBRERIE);
    case "disegno.swatch.list":
      return esito(SOLO_SISTEMA);
    default:
      return esito(null);
  }
}

function dipendenze(motore: MotoreDelDisegno | null, selezione: readonly string[] = ["oa1a1a1a1"]) {
  const vita = openLifetime();
  const deps = {
    motore,
    carica: {} as never,
    vita,
    selezione: () => selezione,
    anteprima: vi.fn(),
    finestra: vi.fn(),
    leggi: () => null,
    commit: vi.fn(() => true),
    seleziona: vi.fn(),
    annuncia: vi.fn(),
  } as unknown as DipendenzeComando;
  return { deps, vita };
}

/// Il contesto che la sezione riceve dal pannello: il corpo, e i colori della scelta.
function contesto(colore: string | null): ContestoSezione {
  const corpo = document.createElement("div");
  document.body.append(corpo);
  return {
    corpo,
    colori: colore === null ? {} : { riempimento: { valore: colore }, contorno: { valore: "#0000ff" } },
  } as unknown as ContestoSezione;
}

const passi = (corpo: HTMLElement) => corpo.querySelectorAll<HTMLButtonElement>(".draw-guide-swatch");
const testo = (corpo: HTMLElement) => corpo.textContent ?? "";

afterEach(() => {
  document.body.replaceChildren();
});

describe("color_guide: le letture della guida", () => {
  it("una lettura di color.harmony si capisce solo nella sua forma; la vernice piena dà il suo colore", () => {
    expect(guidaDaLettura({ colors: ["#ff0000"], grid: [["#800000", "#ff0000"]] })).toEqual({
      colori: ["#ff0000"],
      griglia: [["#800000", "#ff0000"]],
    });
    expect(guidaDaLettura({ colors: ["#ff0000"], grid: [] })).toBeNull();
    expect(guidaDaLettura({ colors: ["rosso"], grid: [["#ff0000"]] })).toBeNull();
    expect(hexDellaVernice({ type: "solid", color: { model: "rgb", r: 1, g: 0, b: 0.5 } })).toBe("#ff0080");
    // Una sfumatura o un colore fuori dai canali non danno un colore di partenza.
    expect(hexDellaVernice({ type: "gradient" })).toBeNull();
    expect(hexDellaVernice({ type: "solid", color: { model: "rgb", r: 2, g: 0, b: 0 } })).toBeNull();
  });

  it("con la scelta la guida parte dal colore del lato attivo, e legge color.harmony senza scrivere", async () => {
    const { motore, comando } = motoreFinto(rispostaDiBase);
    const { deps, vita } = dipendenze(motore as never);
    const esegui = vi.fn();
    const sezione = sezioneGuidaColori(esegui, () => deps, vita, { lato: "fill" });
    const ctx = contesto("#ff0000");
    sezione.disegna(ctx);
    await vi.waitFor(() => expect(passi(ctx.corpo).length).toBeGreaterThan(0));
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.color.harmony", value: expect.objectContaining({ color: "#ff0000", rule: "complementary", steps: 4, variation: "tintsShades", amount: 50 }) }));
    // La guida non è una scrittura: nessun comando con anteprima falsa, nessun clic.
    expect(comando.mock.calls.every(([r]) => r.id.startsWith("disegno.")) && !esegui.mock.calls.length).toBe(true);
    expect(comando.mock.calls.some(([r]) => r.preview === false && r.id !== "disegno.color.harmony")).toBe(false);
    expect(passi(ctx.corpo)[4]?.dataset.base).toBe("");
  });

  it("un clic su un colore della guida dà il colore al lato attivo: un solo comando, paint.setFill", async () => {
    const { motore } = motoreFinto(rispostaDiBase);
    const { deps, vita } = dipendenze(motore as never);
    const esegui = vi.fn();
    const sezione = sezioneGuidaColori(esegui, () => deps, vita, { lato: "fill" });
    const ctx = contesto("#ff0000");
    sezione.disegna(ctx);
    await vi.waitFor(() => expect(passi(ctx.corpo).length).toBeGreaterThan(0));
    passi(ctx.corpo)[0]!.click();
    expect(esegui).toHaveBeenCalledTimes(1);
    expect(esegui).toHaveBeenCalledWith("paint.setFill", { color: "#ff0000" });
  });

  it("sul lato del contorno il clic dà paint.setStroke", async () => {
    const { motore } = motoreFinto(rispostaDiBase);
    const { deps, vita } = dipendenze(motore as never);
    const esegui = vi.fn();
    const sezione = sezioneGuidaColori(esegui, () => deps, vita, { lato: "stroke" });
    const ctx = contesto("#ff0000");
    sezione.disegna(ctx);
    await vi.waitFor(() => expect(passi(ctx.corpo).length).toBeGreaterThan(0));
    // Il contorno ha il suo colore di partenza (#0000ff nel contesto): la guida parte da quello.
    passi(ctx.corpo)[1]!.click();
    expect(esegui).toHaveBeenCalledWith("paint.setStroke", { color: "#0000ff" });
  });

  it("niente scelto: la guida parte dal colore attivo del motore, non si spegne; i clic sono spenti", async () => {
    const { motore, comando } = motoreFinto(rispostaDiBase);
    const { deps, vita } = dipendenze(motore as never, []);
    const esegui = vi.fn();
    const sezione = sezioneGuidaColori(esegui, () => deps, vita, { lato: "fill" });
    const ctx = contesto(null);
    sezione.disegna(ctx);
    await vi.waitFor(() => expect(passi(ctx.corpo).length).toBeGreaterThan(0));
    // Il colore di partenza è quello del riempimento attivo (bianco), letto da paint.proxies.
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.paint.proxies" }));
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.color.harmony", value: expect.objectContaining({ color: "#ffffff" }) }));
    expect(testo(ctx.corpo)).toContain(t("draw.guida.scegli.oggetto"));
    expect(passi(ctx.corpo)[0]!.disabled).toBe(true);
    passi(ctx.corpo)[0]!.click();
    expect(esegui).not.toHaveBeenCalled();
  });

  it("senza un colore attivo che sia un colore pieno la guida dice che manca, senza leggere le armonie", async () => {
    const { motore, comando } = motoreFinto((r) =>
      r.id === "disegno.paint.proxies" ? esito({ fill: { type: "gradient" }, stroke: { type: "none" }, fillActive: true }) : rispostaDiBase(r),
    );
    const { deps, vita } = dipendenze(motore as never, []);
    const sezione = sezioneGuidaColori(vi.fn(), () => deps, vita, { lato: "fill" });
    const ctx = contesto(null);
    sezione.disegna(ctx);
    await vi.waitFor(() => expect(testo(ctx.corpo)).toContain(t("draw.guida.senza.colore")));
    expect(comando.mock.calls.some(([r]) => r.id === "disegno.color.harmony")).toBe(false);
  });

  it("senza un disegno aperto la sezione lo dice e non manda nessun comando", () => {
    const { deps, vita } = dipendenze(null);
    const sezione = sezioneGuidaColori(vi.fn(), () => deps, vita, { lato: "fill" });
    const ctx = contesto("#ff0000");
    sezione.disegna(ctx);
    expect(testo(ctx.corpo)).toContain(t("draw.guida.nessun.disegno"));
  });

  it("una lettura vecchia, superata da un cambio veloce, non sovrascrive quella nuova", async () => {
    const attese: Array<(o: DrawingOutcome) => void> = [];
    const { motore } = motoreFinto((r) => {
      if (r.id !== "disegno.color.harmony") return rispostaDiBase(r);
      return new Promise<DrawingOutcome>((risolvi) => attese.push(risolvi));
    });
    const { deps, vita } = dipendenze(motore as never);
    const sezione = sezioneGuidaColori(vi.fn(), () => deps, vita, { lato: "fill" });
    const ctx = contesto("#ff0000");
    sezione.disegna(ctx);
    await vi.waitFor(() => expect(attese).toHaveLength(1));
    // Il colore cambia: parte una lettura nuova, che arriva per prima. Stesso corpo, colore nuovo.
    sezione.disegna({ ...ctx, colori: { riempimento: { valore: "#00ff00" } } } as never);
    await vi.waitFor(() => expect(attese).toHaveLength(2));
    attese[1]!(esito(armonia("#00ff00")));
    await vi.waitFor(() => expect(passi(ctx.corpo).length).toBeGreaterThan(0));
    // La lettura vecchia arriva dopo: non deve toccare il corpo, che ora è quello della nuova.
    attese[0]!(esito(armonia("#ff0000")));
    await new Promise((risolvi) => setTimeout(risolvi, 20));
    const colori = [...passi(ctx.corpo)].map((b) => b.getAttribute("aria-label"));
    expect(colori.every((hex) => hex !== "#ff0000" || colori.length === 0)).toBe(true);
    expect(colori.includes("#00ff00")).toBe(true);
  });

  it("le opzioni (regola, passi, variazione) si ridisegnano con una lettura, senza scrivere nel file", async () => {
    const { motore, comando } = motoreFinto(rispostaDiBase);
    const { deps, vita } = dipendenze(motore as never);
    const esegui = vi.fn();
    const sezione = sezioneGuidaColori(esegui, () => deps, vita, { lato: "fill" });
    const ctx = contesto("#ff0000");
    sezione.disegna(ctx);
    await vi.waitFor(() => expect(passi(ctx.corpo).length).toBeGreaterThan(0));
    const letture = () => comando.mock.calls.filter(([r]) => r.id === "disegno.color.harmony").length;
    const prima = letture();
    // Apre Opzioni, sceglie la triade, dieci passi e la variazione calda, e applica.
    const bottone = [...ctx.corpo.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === t("draw.guida.opzioni"))!;
    bottone.click();
    await vi.waitFor(() => expect(document.querySelector(".kit-dialog")).not.toBeNull());
    const select = document.querySelector<HTMLSelectElement>(".kit-dialog select")!;
    select.value = "triad";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const numeri = [...document.querySelectorAll<HTMLInputElement>(".kit-dialog input")];
    numeri[0]!.value = "10";
    numeri[0]!.dispatchEvent(new Event("input", { bubbles: true }));
    numeri[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="ok"]')!.disabled).toBe(false));
    document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="ok"]')!.click();
    await vi.waitFor(() => expect(letture()).toBeGreaterThan(prima));
    expect(comando).toHaveBeenLastCalledWith(expect.objectContaining({ id: "disegno.color.harmony", value: expect.objectContaining({ rule: "triad", steps: 10 }) }));
    // La guida si ridisegna, e non scrive niente nel file: nessun clic, nessun comando che cambi il disegno.
    expect(esegui).not.toHaveBeenCalled();
    expect(comando.mock.calls.some(([r]) => r.preview === false && r.id !== "disegno.color.harmony")).toBe(false);
  });

  it("le opzioni restano nella pagina aperta, e un disegno riaperto parte da quelle di serie", async () => {
    const { motore } = motoreFinto(rispostaDiBase);
    const { deps, vita } = dipendenze(motore as never);
    const sezione = sezioneGuidaColori(vi.fn(), () => deps, vita, { lato: "fill" });
    const ctx = contesto("#ff0000");
    sezione.disegna(ctx);
    await vi.waitFor(() => expect(passi(ctx.corpo).length).toBeGreaterThan(0));
    const bottone = [...ctx.corpo.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === t("draw.guida.opzioni"))!;
    bottone.click();
    await vi.waitFor(() => expect(document.querySelector(".kit-dialog")).not.toBeNull());
    const select = document.querySelector<HTMLSelectElement>(".kit-dialog select")!;
    select.value = "analogous";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="ok"]')!.click();
    await vi.waitFor(() => expect(testo(ctx.corpo)).toContain(t("draw.guida.regola.analogous")));
    // Il pannello si chiude e si riapre nella stessa pagina: la scelta c'è ancora.
    const riaperto = contesto("#ff0000");
    sezione.disegna(riaperto);
    expect(testo(riaperto.corpo)).toContain(t("draw.guida.regola.analogous"));
    // Un disegno riaperto è un'altra sezione: parte dalle scelte di serie.
    const riaperta = sezioneGuidaColori(vi.fn(), () => deps, openLifetime(), { lato: "fill" });
    const altro = contesto("#ff0000");
    riaperta.disegna(altro);
    expect(testo(altro.corpo)).toContain(t("draw.guida.regola.complementary"));
  });

  it("un motore che non dà la guida dice che non si calcola, e Riprova la richiede", async () => {
    const { motore } = motoreFinto((r) => (r.id === "disegno.color.harmony" ? { ...esito(null), refused: "unsupported" } as DrawingOutcome : rispostaDiBase(r)));
    const { deps, vita } = dipendenze(motore as never);
    const sezione = sezioneGuidaColori(vi.fn(), () => deps, vita, { lato: "fill" });
    const ctx = contesto("#ff0000");
    sezione.disegna(ctx);
    await vi.waitFor(() => expect(testo(ctx.corpo)).toContain(t("draw.guida.errore")));
  });

  it("la sezione si registra con id color_guide nel registro del Completo", () => {
    const registrate: Array<{ id: string; scheda: string }> = [];
    const sezioni = { registra: (s: { id: string; scheda: string }) => (registrate.push(s), true) } as unknown as Sezioni;
    const { deps, vita } = dipendenze(null);
    expect(registraGuidaColori(sezioni, vi.fn(), () => deps, vita, { lato: "fill" })).toBe(true);
    expect(registrate).toEqual([expect.objectContaining({ id: "color_guide", scheda: "design" })]);
  });
});

describe("ui.colorGuideOptions: Opzioni guida colori", () => {
  it("offre le ventuno armonie e passi da 1 a 20: 0 e 21 non si applicano", async () => {
    const aperta = apriOpzioniGuida(GUIDA_DI_SERIE, openLifetime());
    await vi.waitFor(() => expect(document.querySelector(".kit-dialog")).not.toBeNull());
    expect(document.querySelectorAll(".kit-dialog select option")).toHaveLength(21);
    const numeri = [...document.querySelectorAll<HTMLInputElement>(".kit-dialog input")];
    const ok = document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="ok"]')!;
    // Un numero si legge quando lo si conferma (change), e la sua validità arriva dopo.
    for (const [valore, atteso] of [["0", true], ["21", true], ["20", false], ["1", false]] as const) {
      numeri[0]!.value = valore;
      numeri[0]!.dispatchEvent(new Event("input", { bubbles: true }));
      numeri[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await vi.waitFor(() => expect(ok.disabled, valore).toBe(atteso));
    }
    document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="cancel"]')!.click();
    expect(await aperta).toBeNull();
  });

  it("applicare dà lo stato nuovo, con la variazione e l'ampiezza scelte", async () => {
    const aperta = apriOpzioniGuida(GUIDA_DI_SERIE, openLifetime());
    await vi.waitFor(() => expect(document.querySelector(".kit-dialog")).not.toBeNull());
    const numeri = [...document.querySelectorAll<HTMLInputElement>(".kit-dialog input")];
    numeri[1]!.value = "0";
    numeri[1]!.dispatchEvent(new Event("input", { bubbles: true }));
    numeri[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="ok"]')!.disabled).toBe(false));
    const variazione = [...document.querySelectorAll<HTMLButtonElement>(".kit-dialog [role='radio'], .kit-dialog button")].find((b) => b.textContent === t("draw.guida.variazione.warmCool"));
    variazione?.click();
    document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="ok"]')!.click();
    const stato = (await aperta) as StatoGuida;
    expect(stato).toMatchObject({ regola: "complementary", passi: 4, variazione: "warmCool", ampiezza: 0, limite: null });
  });
});

describe("ui.colorGuideLimit: Limita guida colori", () => {
  it("con una libreria di base e campioni nel documento: le librerie di base, e i campioni del documento", async () => {
    const { motore } = motoreFinto((r) => (r.id === "disegno.swatch.list" ? esito(CON_UN_CAMPIONE) : rispostaDiBase(r)));
    const { deps } = dipendenze(motore as never);
    const aperta = apriLimiteGuida(GUIDA_DI_SERIE, openLifetime(), deps);
    await vi.waitFor(() => expect(document.querySelectorAll(".kit-dialog select option").length).toBeGreaterThan(2));
    const voci = [...document.querySelectorAll<HTMLOptionElement>(".kit-dialog select option")];
    // Nessun limite, le librerie di base (quella dell'utente no), i campioni del documento.
    expect(voci.map((v) => v.value)).toEqual(["", "grays-neutrals", "earth-tones", LIMITE]);
    expect(voci[3]!.disabled).toBe(false);
    const scelta = document.querySelector<HTMLSelectElement>(".kit-dialog select")!;
    scelta.value = "grays-neutrals";
    scelta.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="ok"]')!.click();
    expect(await aperta).toMatchObject({ limite: "grays-neutrals" });
  });

  it("con il disegno senza campioni i campioni del documento sono spenti, e la frase lo dice in italiano", async () => {
    const { motore } = motoreFinto(rispostaDiBase);
    const { deps } = dipendenze(motore as never);
    const aperta = apriLimiteGuida(GUIDA_DI_SERIE, openLifetime(), deps);
    await vi.waitFor(() => expect(document.querySelectorAll(".kit-dialog select option").length).toBeGreaterThan(2));
    const documento = [...document.querySelectorAll<HTMLOptionElement>(".kit-dialog select option")].find((v) => v.value === LIMITE)!;
    expect(documento.disabled).toBe(true);
    expect(document.body.textContent).toContain(t("draw.guida.limite.senza.campioni"));
    document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="cancel"]')!.click();
    expect(await aperta).toBeNull();
  });

  it("con il limite ai campioni la sezione non legge la guida senza campioni: lo dice, con la stessa frase", async () => {
    const { motore, comando } = motoreFinto(rispostaDiBase);
    const { deps, vita } = dipendenze(motore as never);
    const sezione = sezioneGuidaColori(vi.fn(), () => deps, vita, { lato: "fill" });
    const ctx = contesto("#ff0000");
    sezione.disegna(ctx);
    await vi.waitFor(() => expect(passi(ctx.corpo).length).toBeGreaterThan(0));
    // Il limite ai campioni, con un documento senza campioni.
    const sceltaLimite = [...ctx.corpo.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(t("draw.guida.limite.titolo")))!;
    sceltaLimite.click();
    await vi.waitFor(() => expect(document.querySelector(".kit-dialog select option")).not.toBeNull());
    const scelta = document.querySelector<HTMLSelectElement>(".kit-dialog select")!;
    await vi.waitFor(() => expect(scelta.options.length).toBeGreaterThan(2));
    scelta.value = LIMITE;
    scelta.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="ok"]')!.click();
    await vi.waitFor(() => expect(testo(ctx.corpo)).toContain(t("draw.guida.limite.senza.campioni")));
    expect(comando.mock.calls.some(([r]) => r.id === "disegno.color.harmony" && (r.value as { limitTo?: string }).limitTo === LIMITE)).toBe(false);
  });
});

const LIMITE = "document";
