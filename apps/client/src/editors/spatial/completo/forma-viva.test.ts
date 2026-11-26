// @vitest-environment happy-dom
// Le proprietà della forma viva nella sezione Trasforma e la finestra «Angoli…» (`ui.corners`),
// come VectorCraft: la lettura `liveShape` di `document.inspect`; il rettangolo col raggio unico o
// uno per angolo (`singleCornerRadius`); il poligono coi lati, l'angolo, il tipo e il raggio degli
// angoli, il raggio, il lato e «Rendi i lati uguali»; l'ellisse con lo spicchio e «Inverti»; gli
// angoli di un tracciato; le lunghezze nell'unità del pannello; la finestra dalla ricerca del Completo
// vero, che manda `object.setLiveShape` col tipo e il raggio. Il motore è finto.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import { formaDa, righeForma, type FormaViva, type Lunghezza } from "./forma-viva";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const PX: Lunghezza = { unita: "px", decimali: 2, allaScena: (v) => v, dallaScena: (v) => v };
/// Un pannello in millimetri: 1 mm sono 4 della scena, con l'origine spostata (che i raggi ignorano).
const MM: Lunghezza = { unita: "mm", decimali: 2, allaScena: (v) => 4 * v + 7, dallaScena: (v) => (v - 7) / 4 };

const ANGOLI = { radius: 8, kind: "round", radii: [8, 8, 8, 8], kinds: ["round", "round", "round", "round"], relative: false };

const campo = (corpo: HTMLElement, etichetta: string): HTMLInputElement =>
  [...corpo.querySelectorAll<HTMLElement>(".kit-number")].find((el) => el.querySelector(".kit-number-label")?.textContent === etichetta)!.querySelector<HTMLInputElement>(".kit-number-input")!;
const bottone = (corpo: HTMLElement, testo: string): HTMLButtonElement => [...corpo.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === testo)!;
const numero = (input: HTMLInputElement): number => Number(input.value.replace(",", "."));
function scrivi(input: HTMLInputElement, valore: string): void {
  input.value = valore;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("blur"));
}
function scegli(select: HTMLSelectElement, valore: string): void {
  select.value = valore;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/// Le righe della forma in un corpo, con i valori mandati.
function righe(forma: FormaViva, l: Lunghezza = PX, unico?: boolean) {
  const mandati: Record<string, unknown>[] = [];
  const cambi: boolean[] = [];
  const corpo = document.createElement("div");
  const blocco = righeForma(openLifetime(), forma, l, {
    esegui: (v) => mandati.push({ ...v }),
    ...(unico === undefined ? {} : { angoloUnico: { acceso: unico, cambia: (a: boolean) => cambi.push(a) } }),
  });
  if (blocco !== null) corpo.append(blocco);
  return { corpo, blocco, mandati, cambi };
}

describe("la lettura della forma (liveShape)", () => {
  it("rettangolo, poligono, ellisse e un tracciato qualunque; il resto non è una forma", () => {
    expect(formaDa({ liveShape: { shape: "rectangle", corners: ANGOLI } })).toEqual({
      forma: "rectangle",
      angoli: { raggio: 8, tipo: "round", raggi: [8, 8, 8, 8], tipi: ["round", "round", "round", "round"], relativi: false },
    });
    const poligono = formaDa({ liveShape: { shape: "polygon", sides: 6, angle: 15, radius: 50, sideLength: 50, sidesEqual: false } });
    expect(poligono).toMatchObject({ forma: "polygon", lati: 6, angolo: 15, raggio: 50, lato: 50, latiUguali: false, angoli: null });
    expect(formaDa({ liveShape: { shape: "ellipse", pie: [0, 270] } })).toMatchObject({ forma: "ellipse", spicchio: [0, 270] });
    expect(formaDa({ liveShape: { shape: null, corners: { ...ANGOLI, radius: null, kind: null } } })?.angoli).toMatchObject({ raggio: null, tipo: null });
    expect(formaDa({ liveShape: { shape: "cerchio" } })).toBeNull();
    expect(formaDa({ transformBox: {} })).toBeNull();
    expect(formaDa(null)).toBeNull();
  });
});

describe("le righe della forma", () => {
  const rettangolo = formaDa({ liveShape: { shape: "rectangle", corners: ANGOLI } })!;

  it("rettangolo col raggio unico: un campo, e il collegamento lo spegne", () => {
    const { corpo, mandati, cambi } = righe(rettangolo, PX, true);
    expect(corpo.querySelector(".draw-shape-heading")!.textContent).toBe(t("draw.forma.rettangolo"));
    expect(corpo.querySelectorAll(".kit-number-input")).toHaveLength(1);
    expect(numero(campo(corpo, t("draw.forma.raggioAngolo")))).toBe(8);
    scrivi(campo(corpo, t("draw.forma.raggioAngolo")), "12");
    expect(mandati).toEqual([{ radius: 12 }]);
    const collega = corpo.querySelector<HTMLButtonElement>(".draw-shape-link")!;
    expect(collega.getAttribute("aria-pressed")).toBe("true");
    collega.click();
    expect(cambi).toEqual([false]);
  });

  it("rettangolo senza il raggio unico: quattro campi, ognuno col suo angolo", () => {
    const { corpo, mandati } = righe(rettangolo, PX, false);
    expect(corpo.querySelectorAll(".kit-number-input")).toHaveLength(4);
    scrivi(campo(corpo, t("draw.forma.basso.destra")), "3");
    expect(mandati).toEqual([{ radius: 3, corners: [2] }]);
  });

  it("il raggio passa per l'unità del pannello senza l'origine", () => {
    const { corpo, mandati } = righe(rettangolo, MM, true);
    expect(numero(campo(corpo, t("draw.forma.raggioAngolo")))).toBe(2);
    scrivi(campo(corpo, t("draw.forma.raggioAngolo")), "5");
    expect(mandati).toEqual([{ radius: 20 }]);
  });

  it("poligono: lati, angolo, tipo, raggio degli angoli, raggio, lato e Rendi i lati uguali", () => {
    const forma = formaDa({ liveShape: { shape: "polygon", sides: 6, angle: 0, radius: 50, sideLength: 50, sidesEqual: false, corners: { ...ANGOLI, radii: [8, 8, 8, 8, 8, 8], kinds: Array(6).fill("round") } } })!;
    const { corpo, mandati } = righe(forma);
    expect(corpo.querySelector(".draw-shape-heading")!.textContent).toBe(t("draw.forma.poligono"));
    scrivi(campo(corpo, t("draw.forma.lati")), "8");
    scrivi(campo(corpo, t("draw.forma.angolo")), "30");
    scegli(corpo.querySelector<HTMLSelectElement>(".draw-shape-kind select")!, "chamfer");
    scrivi(campo(corpo, t("draw.forma.raggio")), "60");
    scrivi(campo(corpo, t("draw.forma.lato")), "40");
    bottone(corpo, t("draw.forma.latiUguali")).click();
    expect(mandati).toEqual([{ sides: 8 }, { polygonAngle: 30 }, { kind: "chamfer" }, { polygonRadius: 60 }, { sideLength: 40 }, { makeSidesEqual: true }]);
  });

  it("Rendi i lati uguali è spento quando i lati sono già uguali", () => {
    const forma = formaDa({ liveShape: { shape: "polygon", sides: 5, angle: 0, radius: 50, sideLength: 58.78, sidesEqual: true } })!;
    expect(bottone(righe(forma).corpo, t("draw.forma.latiUguali")).disabled).toBe(true);
  });

  it("ellisse: inizio e fine dello spicchio, e Inverti spicchio", () => {
    const { corpo, mandati } = righe(formaDa({ liveShape: { shape: "ellipse", pie: [0, 360] } })!);
    expect(corpo.querySelector(".draw-shape-heading")!.textContent).toBe(t("draw.forma.ellisse"));
    scrivi(campo(corpo, t("draw.forma.spicchio.inizio")), "45");
    scrivi(campo(corpo, t("draw.forma.spicchio.fine")), "270");
    bottone(corpo, t("draw.forma.spicchio.inverti")).click();
    expect(mandati).toEqual([{ pieStart: 45 }, { pieEnd: 270 }, { invertPie: true }]);
  });

  it("un tracciato con angoli: tipo e raggio; senza angoli, o una linea, niente righe", () => {
    const { corpo, mandati } = righe(formaDa({ liveShape: { shape: null, corners: { ...ANGOLI, radius: 0, kind: "round" } } })!);
    expect(corpo.querySelector(".draw-shape-heading")!.textContent).toBe(t("draw.forma.angoli"));
    scegli(corpo.querySelector<HTMLSelectElement>(".draw-shape-kind select")!, "invertedRound");
    scrivi(campo(corpo, t("draw.forma.raggioAngolo")), "4");
    expect(mandati).toEqual([{ kind: "invertedRound" }, { radius: 4 }]);
    expect(righe(formaDa({ liveShape: { shape: null } })!).blocco).toBeNull();
    expect(righe(formaDa({ liveShape: { shape: "line" } })!).blocco).toBeNull();
  });
});

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["oa1a1a1a1"], losses: [], refused: null, frame: null };

interface Passo {
  readonly id: string;
  readonly value: Record<string, unknown>;
}

/// Il Completo vero col motore finto che legge `liveShape`.
function completo(forma: unknown, prefs: Record<string, unknown> = {}) {
  const comando = vi.fn((passo: Passo) => {
    if (passo.id === "disegno.document.inspect") return Promise.resolve({ ...ESITO, reading: { liveShape: forma } });
    if (passo.id === "disegno.prefs.get") return Promise.resolve({ ...ESITO, reading: { prefs } });
    return Promise.resolve(ESITO);
  });
  const comandi = vi.fn(() => Promise.resolve([{ id: "disegno.object.setLiveShape", enabled: true, disabled_reason: null }]));
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  const annuncia = vi.fn();
  const c = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: { "./famiglie/forme/index.ts": () => import("./famiglie/forme/index") },
      tasti: { selezione: () => ["oa1a1a1a1"], annuncia } as never,
    } as never,
  );
  const mandati = (): Passo[] =>
    comando.mock.calls.map(([passo]) => passo).filter((passo) => passo.id !== "disegno.document.inspect" && passo.id !== "disegno.prefs.get");
  return { c, motore, mandati, annuncia };
}

describe("nel Completo", () => {
  it("la sezione Trasforma mostra il rettangolo letto e il raggio manda object.setLiveShape senza finestra", async () => {
    const { c, motore, mandati } = completo({ shape: "rectangle", corners: ANGOLI }, { singleCornerRadius: true });
    const sezione = c.sezioni.di("design").find((una) => una.id === "trasforma")!;
    const corpo = document.createElement("div");
    document.body.append(corpo);
    sezione.disegna!({ corpo, sel: { numero: 1 }, motore, aggiorna: () => undefined, vita: openLifetime() } as never);
    await vi.waitFor(() => expect(corpo.querySelector(".draw-shape-properties")).not.toBeNull());
    scrivi(campo(corpo, t("draw.forma.raggioAngolo")), "10");
    await vi.waitFor(() => expect(mandati()).toHaveLength(1));
    expect(mandati()[0]).toEqual(expect.objectContaining({ id: "disegno.object.setLiveShape", value: { radius: 10 } }));
    corpo.remove();
    c.chiudi();
  });

  it("Angoli… dalla ricerca apre la finestra; OK manda tipo e raggio a tutti gli angoli", async () => {
    const { c, mandati } = completo({ shape: null, corners: { ...ANGOLI, radius: 0 } });
    const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
    const voci = await c.ricerca(() => ["oa1a1a1a1"], azioni);
    const voce = voci?.find((una) => una.label === "Angoli…");
    expect(voce, "la voce Angoli…").toBeDefined();
    voce!.run();
    const finestra = await vi.waitFor(() => {
      const f = document.querySelector<HTMLElement>(".draw-shape-corners-dialog");
      expect(f).not.toBeNull();
      return f!;
    });
    scegli(finestra.querySelector<HTMLSelectElement>(".draw-shape-kind select")!, "chamfer");
    // Chi scrive e poi preme OK esce dal campo: il valore si conferma.
    scrivi(finestra.querySelector<HTMLInputElement>(".kit-number-input")!, "6");
    bottone(finestra, t("draw.forma.finestra.ok")).click();
    await vi.waitFor(() => expect(mandati()).toHaveLength(1));
    expect(mandati()[0]).toEqual(expect.objectContaining({ id: "disegno.object.setLiveShape", value: { kind: "chamfer", radius: 6 } }));
    expect(azioni.client).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("Angoli… senza un tracciato con angoli lo dice e non apre niente", async () => {
    const { c, annuncia, mandati } = completo(null);
    const voci = await c.ricerca(() => ["oa1a1a1a1"], { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() });
    voci!.find((una) => una.label === "Angoli…")!.run();
    await vi.waitFor(() => expect(annuncia).toHaveBeenCalledWith(t("draw.forma.finestra.senzaAngoli")));
    expect(document.querySelector(".draw-shape-corners-dialog")).toBeNull();
    expect(mandati()).toHaveLength(0);
    c.chiudi();
  });
});
