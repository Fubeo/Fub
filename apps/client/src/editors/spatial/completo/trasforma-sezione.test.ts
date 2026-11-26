// @vitest-environment happy-dom
// La sezione «Trasforma» del Design, come il pannello Transform di VectorCraft. In una sessione del
// Completo vera: c'è nella scheda Design senza caricare la famiglia; senza selezione i comandi sono
// spenti e le opzioni no; legge il riquadro (`document.inspect`) e le preferenze (`prefs.get`) dal
// motore; X e Y sono il punto di riferimento scelto; larghezza e altezza tengono le proporzioni col
// lucchetto o con Ctrl+Invio; Alt+Invio applica a una copia; rotazione, inclinazione e riflessi
// girano attorno al punto di riferimento; gli angoli pronti; le preferenze cambiano con `prefs.set`.
// Con le sole misure della vista (senza motore) i campi le mostrano nell'unità del pannello.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import { apriFinestra } from "../motore/finestre";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import { apri } from "./index";
import { riquadroDa, sezioneTrasforma, type AzioniTrasforma } from "./trasforma-sezione";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["oa1a1a1a1", "ob2b2b2b2"], losses: [], refused: null, frame: null };

/// Il riquadro che il motore finto dà: 100 × 50 da (10, 20), girato di 30° (antiorario).
const RIQUADRO = {
  angle: 30,
  width: 100,
  height: 50,
  points: [
    [10, 20],
    [60, 20],
    [110, 20],
    [10, 45],
    [60, 45],
    [110, 45],
    [10, 70],
    [60, 70],
    [110, 70],
  ],
};

interface Passo {
  readonly id: string;
  readonly value: Record<string, unknown>;
}

function motoreFinto(prefs: Record<string, unknown>, riquadro: unknown) {
  const comando = vi.fn((passo: Passo) => {
    if (passo.id === "disegno.document.inspect") return Promise.resolve({ ...ESITO, reading: { transformBox: riquadro } });
    if (passo.id === "disegno.prefs.get") return Promise.resolve({ ...ESITO, reading: { prefs } });
    return Promise.resolve(ESITO);
  });
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero e la famiglia `trasforma` spiata: la selezione è `scelti` oggetti.
function completo(scelti: number, prefs: Record<string, unknown> = {}, riquadro: unknown = null) {
  const caricati: string[] = [];
  const { motore, comando } = motoreFinto(prefs, riquadro);
  const c = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/trasforma/index.ts": () => {
          caricati.push("trasforma");
          return import("./famiglie/trasforma/index");
        },
      },
      tasti: { selezione: () => (scelti === 0 ? [] : ["oa1a1a1a1", "ob2b2b2b2"]), annuncia: vi.fn() } as never,
    } as never,
  );
  const sezione = c.sezioni.di("design").find((una) => una.id === "trasforma")!;
  const corpo = document.createElement("div");
  document.body.append(corpo);
  sezione.disegna!({ corpo, sel: { numero: scelti }, motore, aggiorna: () => undefined, vita: openLifetime() } as never);
  // I comandi che cambiano il disegno o le preferenze, senza le due letture.
  const mandati = (): Passo[] =>
    comando.mock.calls.map(([passo]) => passo).filter((passo) => passo.id !== "disegno.document.inspect" && passo.id !== "disegno.prefs.get");
  return { c, corpo, caricati, comando, mandati };
}

/// Scrive un valore nel campo e lo conferma (come chi esce dal campo).
function scrivi(input: HTMLInputElement, valore: string): void {
  input.value = valore;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("blur"));
}

/// Scrive un valore e lo conferma con Invio, coi tasti dati.
function invio(input: HTMLInputElement, valore: string, tasti: { ctrlKey?: boolean; altKey?: boolean } = {}): void {
  input.value = valore;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...tasti }));
}

/// Il campo con questa etichetta.
const campo = (corpo: HTMLElement, etichetta: string): HTMLInputElement =>
  [...corpo.querySelectorAll<HTMLElement>(".kit-number")].find((el) => el.querySelector(".kit-number-label")?.textContent === etichetta)!.querySelector<HTMLInputElement>(".kit-number-input")!;

/// Il bottone con questo testo.
const bottone = (corpo: HTMLElement, testo: string): HTMLButtonElement => [...corpo.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === testo)!;

/// Il valore di un campo numerico, letto col separatore decimale di chi scrive.
const numero = (input: HTMLInputElement): number => Number(input.value.replace(",", "."));

/// Aspetta che le letture del motore siano arrivate e la sezione rifatta.
const letto = (corpo: HTMLElement): Promise<void> => vi.waitFor(() => expect(numero(campo(corpo, t("draw.trasforma.rotation")))).toBe(30));

describe("la sezione Trasforma del Design", () => {
  it("c'è nella scheda Design, con sei campi, il punto di riferimento, i riflessi e le opzioni, senza caricare la famiglia", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c, corpo, caricati } = completo(2);
    await new Promise((risolto) => setTimeout(risolto, 0));
    expect(caricati).toEqual([]);
    expect(corpo.querySelectorAll(".kit-number-input")).toHaveLength(6);
    expect(corpo.querySelectorAll(".kit-reference-point-cell")).toHaveLength(9);
    for (const chiave of ["draw.trasforma.reset", "draw.trasforma.rifletti.orizzontale", "draw.trasforma.rifletti.verticale"] as const) expect(bottone(corpo, t(chiave))).toBeDefined();
    expect(corpo.querySelectorAll(".kit-form-checkbox")).toHaveLength(2);
    expect(c.sezioni.di("design").map((una) => una.id)).toContain("trasforma");
    c.chiudi();
  });

  it("senza una selezione i comandi sono spenti; il lucchetto e le opzioni no", () => {
    const { c, corpo } = completo(0);
    expect(campo(corpo, t("draw.trasforma.x")).disabled).toBe(true);
    expect(bottone(corpo, t("draw.trasforma.reset")).disabled).toBe(true);
    expect(bottone(corpo, t("draw.trasforma.rifletti.orizzontale")).disabled).toBe(true);
    expect(corpo.querySelector<HTMLButtonElement>(".draw-transform-link")!.disabled).toBe(false);
    for (const casella of corpo.querySelectorAll<HTMLInputElement>(".kit-form-checkbox")) expect(casella.disabled).toBe(false);
    c.chiudi();
  });

  it("la X confermata manda setBounds col punto di riferimento (il centro), e la famiglia si porta al primo invio", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c, corpo, caricati, mandati } = completo(2);
    scrivi(campo(corpo, t("draw.trasforma.x")), "10");
    await vi.waitFor(() => expect(mandati()).toHaveLength(1));
    expect(caricati).toEqual(["trasforma"]);
    expect(mandati()[0]).toEqual(expect.objectContaining({ id: "disegno.object.setBounds", value: { x: 10, reference: 4, copy: false }, preview: false }));
    c.chiudi();
  });

  it("la rotazione va senza la finestra della voce: assoluta, con l'angolo scritto", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c, corpo, mandati } = completo(2);
    scrivi(campo(corpo, t("draw.trasforma.rotation")), "45");
    await vi.waitFor(() => expect(mandati()).toHaveLength(1));
    expect(mandati()[0]).toEqual(expect.objectContaining({ id: "disegno.object.rotate", value: { angle: 45, absolute: true, copy: false } }));
    expect(apriFinestra).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("Reimposta riquadro manda il comando senza parametri", async () => {
    const { c, corpo, mandati } = completo(2);
    bottone(corpo, t("draw.trasforma.reset")).click();
    await vi.waitFor(() => expect(mandati()).toHaveLength(1));
    expect(mandati()[0]).toEqual(expect.objectContaining({ id: "disegno.object.resetBoundingBox", value: {} }));
    c.chiudi();
  });

  it("legge il riquadro dal motore: X e Y del centro, i lati, l'angolo, e il lucchetto acceso", async () => {
    const { c, corpo } = completo(2, { constrainProportions: true, scaleStrokes: true }, RIQUADRO);
    await letto(corpo);
    expect(numero(campo(corpo, t("draw.trasforma.x")))).toBe(60);
    expect(numero(campo(corpo, t("draw.trasforma.y")))).toBe(45);
    expect(numero(campo(corpo, t("draw.trasforma.width")))).toBe(100);
    expect(numero(campo(corpo, t("draw.trasforma.height")))).toBe(50);
    expect(numero(campo(corpo, t("draw.trasforma.skew")))).toBe(0);
    expect(corpo.querySelector(".draw-transform-link")!.getAttribute("aria-pressed")).toBe("true");
    const [angoli, tratti] = corpo.querySelectorAll<HTMLInputElement>(".kit-form-checkbox");
    expect(angoli!.checked).toBe(false);
    expect(tratti!.checked).toBe(true);
    c.chiudi();
  });

  it("un altro punto di riferimento cambia X e Y, e i comandi lo mandano", async () => {
    const { c, corpo, mandati } = completo(2, {}, RIQUADRO);
    await letto(corpo);
    corpo.querySelectorAll<HTMLElement>(".kit-reference-point-cell")[8]!.click();
    expect(numero(campo(corpo, t("draw.trasforma.x")))).toBe(110);
    expect(numero(campo(corpo, t("draw.trasforma.y")))).toBe(70);
    scrivi(campo(corpo, t("draw.trasforma.y")), "90");
    await vi.waitFor(() => expect(mandati()).toHaveLength(1));
    expect(mandati()[0]!.value).toEqual({ y: 90, reference: 8, copy: false });
    c.chiudi();
  });

  it("col lucchetto la larghezza tiene le proporzioni; senza, solo con Ctrl+Invio", async () => {
    const acceso = completo(2, { constrainProportions: true }, RIQUADRO);
    await letto(acceso.corpo);
    scrivi(campo(acceso.corpo, t("draw.trasforma.width")), "200");
    await vi.waitFor(() => expect(acceso.mandati()).toHaveLength(1));
    expect(acceso.mandati()[0]!.value).toEqual({ width: 200, reference: 4, proportional: true, copy: false });
    acceso.c.chiudi();

    const spento = completo(2, {}, RIQUADRO);
    await letto(spento.corpo);
    scrivi(campo(spento.corpo, t("draw.trasforma.height")), "80");
    invio(campo(spento.corpo, t("draw.trasforma.width")), "120", { ctrlKey: true });
    await vi.waitFor(() => expect(spento.mandati()).toHaveLength(2));
    expect(spento.mandati()[0]!.value).toEqual({ height: 80, reference: 4, proportional: false, copy: false });
    expect(spento.mandati()[1]!.value).toEqual({ width: 120, reference: 4, proportional: true, copy: false });
    spento.c.chiudi();
  });

  it("Alt+Invio applica a una copia", async () => {
    const { c, corpo, mandati } = completo(2, {}, RIQUADRO);
    await letto(corpo);
    invio(campo(corpo, t("draw.trasforma.x")), "15", { altKey: true });
    await vi.waitFor(() => expect(mandati()).toHaveLength(1));
    expect(mandati()[0]!.value).toEqual({ x: 15, reference: 4, copy: true });
    c.chiudi();
  });

  it("rotazione, inclinazione e riflessi girano attorno al punto di riferimento; lo stesso angolo non manda niente", async () => {
    const { c, corpo, mandati } = completo(2, {}, RIQUADRO);
    await letto(corpo);
    scrivi(campo(corpo, t("draw.trasforma.rotation")), "30");
    scrivi(campo(corpo, t("draw.trasforma.rotation")), "-15");
    scrivi(campo(corpo, t("draw.trasforma.skew")), "20");
    bottone(corpo, t("draw.trasforma.rifletti.orizzontale")).click();
    bottone(corpo, t("draw.trasforma.rifletti.verticale")).click();
    await vi.waitFor(() => expect(mandati()).toHaveLength(4));
    expect(mandati().map((m) => [m.id, m.value])).toEqual([
      ["disegno.object.rotate", { angle: -15, absolute: true, origin: [60, 45], copy: false }],
      ["disegno.object.shear", { angle: 20, axis: "horizontal", origin: [60, 45], copy: false }],
      ["disegno.object.reflect", { axis: "vertical", origin: [60, 45] }],
      ["disegno.object.reflect", { axis: "horizontal", origin: [60, 45] }],
    ]);
    c.chiudi();
  });

  it("l'inclinazione non manda niente a 0 né da 90° in su", async () => {
    const { c, corpo, mandati } = completo(2, {}, RIQUADRO);
    await letto(corpo);
    scrivi(campo(corpo, t("draw.trasforma.skew")), "95");
    scrivi(campo(corpo, t("draw.trasforma.skew")), "0");
    bottone(corpo, t("draw.trasforma.reset")).click();
    await vi.waitFor(() => expect(mandati()).toHaveLength(1));
    expect(mandati()[0]!.id).toBe("disegno.object.resetBoundingBox");
    c.chiudi();
  });

  it("gli angoli pronti valgono come un angolo scritto", async () => {
    const { c, corpo, mandati } = completo(2, {}, RIQUADRO);
    await letto(corpo);
    const [rotazione, inclinazione] = corpo.querySelectorAll<HTMLSelectElement>(".draw-transform-presets");
    expect([...rotazione!.options].map((o) => o.value).slice(1)).toEqual(["-180", "-135", "-90", "-45", "0", "45", "90", "135", "180"]);
    expect([...inclinazione!.options].map((o) => o.value).slice(1)).toEqual(["-60", "-45", "-30", "-15", "0", "15", "30", "45", "60"]);
    rotazione!.value = "90";
    rotazione!.dispatchEvent(new Event("change"));
    inclinazione!.value = "-45";
    inclinazione!.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(mandati()).toHaveLength(2));
    expect(mandati()[0]!.value).toEqual({ angle: 90, absolute: true, origin: [60, 45], copy: false });
    expect(mandati()[1]!.value).toEqual({ angle: -45, axis: "horizontal", origin: [60, 45], copy: false });
    expect(rotazione!.value).toBe("");
    c.chiudi();
  });

  it("il lucchetto e le caselle cambiano le preferenze del motore", async () => {
    const { c, corpo, mandati } = completo(2, { constrainProportions: true }, RIQUADRO);
    await letto(corpo);
    const lucchetto = corpo.querySelector<HTMLButtonElement>(".draw-transform-link")!;
    lucchetto.click();
    expect(lucchetto.getAttribute("aria-pressed")).toBe("false");
    const [angoli, tratti] = corpo.querySelectorAll<HTMLInputElement>(".kit-form-checkbox");
    angoli!.click();
    tratti!.click();
    await vi.waitFor(() => expect(mandati()).toHaveLength(3));
    expect(mandati().map((m) => [m.id, m.value])).toEqual([
      ["disegno.prefs.set", { key: "constrainProportions", value: false }],
      ["disegno.prefs.set", { key: "scaleCorners", value: true }],
      ["disegno.prefs.set", { key: "scaleStrokes", value: true }],
    ]);
    // Spento, la larghezza va senza proporzioni.
    scrivi(campo(corpo, t("draw.trasforma.width")), "70");
    await vi.waitFor(() => expect(mandati()).toHaveLength(4));
    expect(mandati()[3]!.value).toEqual({ width: 70, reference: 4, proportional: false, copy: false });
    c.chiudi();
  });
});

describe("il riquadro letto dal motore", () => {
  it("vuole l'angolo, i lati e nove punti numerici", () => {
    expect(riquadroDa({ transformBox: RIQUADRO })?.punti[4]).toEqual([60, 45]);
    expect(riquadroDa({ transformBox: null })).toBeNull();
    expect(riquadroDa({ transformBox: { ...RIQUADRO, points: RIQUADRO.points.slice(1) } })).toBeNull();
    expect(riquadroDa({ transformBox: { ...RIQUADRO, angle: "30" } })).toBeNull();
    expect(riquadroDa(null)).toBeNull();
  });
});

/// La sezione disegnata con le sole misure della vista (senza motore), e il comando spiato.
function disegnaCon(misure: Record<string, unknown>, indice = 0, esegui = vi.fn()) {
  const corpo = document.createElement("div");
  const azioni: AzioniTrasforma = { esegui, riferimento: { indice } };
  sezioneTrasforma(azioni).disegna!({ corpo, sel: { numero: 1 }, motore: null, aggiorna: () => undefined, vita: openLifetime(), misure } as never);
  return { corpo, esegui };
}

/// Una misura del pannello nell'unità `unita`, con il passaggio alla scena dato.
const misura = (valore: number | null, unita: string, allaScena = (v: number) => v) => ({ valore, unita, decimali: 2, allaScena });

describe("la sezione Trasforma con le misure della vista", () => {
  it("X, larghezza e rotazione mostrano il valore del pannello, nella sua unità; Y, senza misura, resta vuota", () => {
    const { corpo } = disegnaCon({ x: misura(143.17, "px"), larghezza: misura(649.81, "px"), rotazione: misura(0, "°") });
    expect(numero(campo(corpo, t("draw.trasforma.x")))).toBeCloseTo(143.17, 2);
    expect(numero(campo(corpo, t("draw.trasforma.width")))).toBeCloseTo(649.81, 2);
    expect(numero(campo(corpo, t("draw.trasforma.rotation")))).toBe(0);
    expect(campo(corpo, t("draw.trasforma.y")).value).toBe("");
    expect(campo(corpo, t("draw.trasforma.x")).closest(".kit-number")!.querySelector(".kit-number-unit")?.textContent).toBe("px");
  });

  it("X e Y sono il punto di riferimento scelto, a metà o in fondo ai lati; con un riquadro girato aspettano il motore", () => {
    const dritto = disegnaCon({ x: misura(10, "px"), y: misura(20, "px"), larghezza: misura(100, "px"), altezza: misura(50, "px"), rotazione: misura(0, "°") }, 5);
    expect(numero(campo(dritto.corpo, t("draw.trasforma.x")))).toBe(110);
    expect(numero(campo(dritto.corpo, t("draw.trasforma.y")))).toBe(45);
    const girato = disegnaCon({ x: misura(10, "px"), y: misura(20, "px"), larghezza: misura(100, "px"), altezza: misura(50, "px"), rotazione: misura(30, "°") }, 4);
    expect(campo(girato.corpo, t("draw.trasforma.x")).value).toBe("");
    // La vista conta in senso orario, il pannello (come il motore) in senso antiorario.
    expect(numero(campo(girato.corpo, t("draw.trasforma.rotation")))).toBe(-30);
  });

  it("una misura che la selezione non ha in un valore solo resta vuota", () => {
    const { corpo } = disegnaCon({ x: misura(null, "px"), rotazione: misura(null, "°") });
    expect(campo(corpo, t("draw.trasforma.x")).value).toBe("");
    expect(campo(corpo, t("draw.trasforma.rotation")).value).toBe("");
  });

  it("un valore scritto nell'unità del pannello va alle unità della scena prima del comando", () => {
    const { corpo, esegui } = disegnaCon({ x: misura(10, "mm", (v) => (v * 96) / 25.4), larghezza: misura(10, "mm", (v) => (v * 96) / 25.4) });
    scrivi(campo(corpo, t("draw.trasforma.x")), "20");
    scrivi(campo(corpo, t("draw.trasforma.width")), "30");
    expect(esegui).toHaveBeenCalledTimes(2);
    const [id, valori] = esegui.mock.calls[0]!;
    expect(id).toBe("object.setBounds");
    expect((valori as { x: number }).x).toBeCloseTo((20 * 96) / 25.4, 6);
    expect((esegui.mock.calls[1]![1] as { width: number }).width).toBeCloseTo((30 * 96) / 25.4, 6);
  });

  it("senza misure del pannello l'unità è il px, come nella scena", () => {
    const { corpo } = disegnaCon({});
    expect(campo(corpo, t("draw.trasforma.height")).closest(".kit-number")!.querySelector(".kit-number-unit")?.textContent).toBe("px");
  });
});
