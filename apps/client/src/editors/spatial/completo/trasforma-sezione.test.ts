// @vitest-environment happy-dom
// La sezione «Trasforma» del Design (K6 T13, giro 3) in una sessione del Completo vera: c'è
// nella scheda Design senza caricare la famiglia; i sei campi sono spenti senza selezione; ogni
// campo confermato manda il suo comando al motore col valore scritto, e la rotazione e
// l'inclinazione vanno senza la finestra della voce.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import { apriFinestra } from "../motore/finestre";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["oa1a1a1a1", "ob2b2b2b2"], losses: [], refused: null, frame: null };

function motoreFinto() {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero e la famiglia `trasforma` spiata: la selezione è `scelti` oggetti.
function completo(scelti: number) {
  const caricati: string[] = [];
  const { motore, comando } = motoreFinto();
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
  sezione.disegna!({ corpo, sel: { numero: scelti }, motore, aggiorna: () => undefined, vita: openLifetime() } as never);
  return { c, corpo, caricati, comando };
}

/// Scrive un valore nel campo e lo conferma (come chi esce dal campo).
function scrivi(input: HTMLInputElement, valore: string): void {
  input.value = valore;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("blur"));
}

/// Il campo con questa etichetta.
const campo = (corpo: HTMLElement, etichetta: string): HTMLInputElement =>
  [...corpo.querySelectorAll<HTMLElement>(".kit-number")].find((el) => el.querySelector(".kit-number-label")?.textContent === etichetta)!.querySelector<HTMLInputElement>(".kit-number-input")!;

describe("la sezione Trasforma del Design", () => {
  it("c'è nella scheda Design, con sei campi e il riquadro, senza caricare la famiglia", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c, corpo, caricati } = completo(2);
    await new Promise((risolto) => setTimeout(risolto, 0));
    expect(caricati).toEqual([]);
    expect(corpo.querySelectorAll(".kit-number-input")).toHaveLength(6);
    expect(corpo.querySelector(".kit-button")?.textContent).toBe(t("draw.trasforma.reset"));
    expect(c.sezioni.di("design").map((una) => una.id)).toContain("trasforma");
    c.chiudi();
  });

  it("senza una selezione i campi e il riquadro sono spenti", () => {
    const { c, corpo } = completo(0);
    expect(campo(corpo, t("draw.trasforma.x")).disabled).toBe(true);
    expect(corpo.querySelector<HTMLButtonElement>(".kit-button")!.disabled).toBe(true);
    c.chiudi();
  });

  it("la X confermata manda setBounds con la X scritta, e la famiglia si porta al primo invio", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c, corpo, caricati, comando } = completo(2);
    scrivi(campo(corpo, t("draw.trasforma.x")), "10");
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(caricati).toEqual(["trasforma"]);
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.object.setBounds", value: { x: 10 }, preview: false }));
    c.chiudi();
  });

  it("la rotazione va senza la finestra della voce: assoluta, con l'angolo scritto", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c, corpo, comando } = completo(2);
    scrivi(campo(corpo, t("draw.trasforma.rotation")), "45");
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.object.rotate", value: { angle: 45, absolute: true } }));
    expect(apriFinestra).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("Reimposta riquadro manda il comando senza parametri", async () => {
    const { c, corpo, comando } = completo(2);
    corpo.querySelector<HTMLButtonElement>(".kit-button")!.click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.object.resetBoundingBox", value: {} }));
    c.chiudi();
  });
});
