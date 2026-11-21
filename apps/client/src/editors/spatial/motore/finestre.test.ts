// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingPreview } from "../../../host/contract";
import { press } from "../../../kit/testing";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import {
  apriFinestra,
  INTERVALLO_ANTEPRIMA_MS,
  type EsitoComando,
  type FinestraOpzioni,
  type ModuloFinestra,
  type ValoreCampo,
} from "./finestre";

/// Una chiamata di `esegui` che aspetta la sua risposta.
interface Chiamata {
  readonly valori: Readonly<Record<string, ValoreCampo>>;
  readonly anteprima: boolean;
  readonly risolvi: (esito: EsitoComando) => void;
}

const MODULO: ModuloFinestra = {
  campi: [
    { nome: "distanza", tipo: "numero" },
    { nome: "giunzioni", tipo: "scelta", valori: ["vivo", "arrotondato", "smussato"] },
    { nome: "limite", tipo: "numero", min: 1, max: 9 },
  ],
};

const ANTEPRIMA: DrawingPreview = { shape: null, matrix: null, marquee: null, overlays: [] };
const VUOTO: EsitoComando = { anteprima: null, rifiuto: null };

let vita: Lifetime;
let chiamate: Chiamata[];
/// Ciò che la finestra ha messo sul foglio, in ordine.
let foglio: (DrawingPreview | null)[];
let opener: HTMLButtonElement;
let numeroProva = 0;

/// Il comando finto: ogni chiamata resta in attesa finché il test non risponde.
const esegui = (valori: Readonly<Record<string, ValoreCampo>>, anteprima: boolean) =>
  new Promise<EsitoComando>((risolvi) => {
    chiamate.push({ valori, anteprima, risolvi });
  });

function opzioni(extra: Partial<FinestraOpzioni> = {}): FinestraOpzioni {
  return {
    id: `tracciato.sposta.${++numeroProva}`,
    titolo: "Sposta tracciato",
    descrizione: "Un tracciato nuovo, parallelo a quello scelto.",
    azione: "Sposta",
    campi: { distanza: "Spostamento", giunzioni: "Giunzioni", limite: "Limite angolo vivo" },
    scelte: { giunzioni: { vivo: "Angolo vivo", arrotondato: "Arrotondato", smussato: "Smussato" } },
    unita: { distanza: "px", limite: "×" },
    iniziali: { distanza: 6, giunzioni: "arrotondato", limite: 4 },
    vita,
    sulFoglio: (anteprima) => foglio.push(anteprima),
    ...extra,
  };
}

/// Lascia lavorare le promesse già risolte, senza far scorrere il tempo.
async function settle(): Promise<void> {
  for (let step = 0; step < 8; step++) await Promise.resolve();
}

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".kit-dialog.draw-effect-dialog");
const action = (id: string): HTMLButtonElement => dialog()!.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
const numberInputs = (): HTMLInputElement[] => [...dialog()!.querySelectorAll<HTMLInputElement>(".kit-number-input")];
const commits = (): Chiamata[] => chiamate.filter((call) => !call.anteprima);

/// Scrive e fa prendere il valore al campo, perdendo il fuoco: non conferma la
/// finestra, come farebbe un Invio.
function typeAndCommit(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("blur"));
}

/// Scrive e preme Invio: il campo prende il valore, e la finestra conferma.
function typeAndEnter(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  press(input, "Enter");
}

/// Il campo numerico `index` (0 la distanza, 1 il limite) e il suo errore.
const errorOf = (index: number): string | null | undefined =>
  numberInputs()[index]?.closest(".kit-number")?.querySelector(".kit-number-error")?.textContent;

/// Apre la finestra, con una famiglia già pronta, e aspetta che la forma ci sia.
async function open(extra: Partial<FinestraOpzioni> = {}, pronto: Promise<unknown> = Promise.resolve()) {
  const result = apriFinestra(MODULO, pronto, esegui, opzioni(extra));
  await settle();
  return { result };
}

beforeEach(() => {
  vi.useFakeTimers();
  vita = openLifetime();
  chiamate = [];
  foglio = [];
  opener = document.createElement("button");
  opener.textContent = "apri";
  document.body.append(opener);
});

afterEach(() => {
  vita.close();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("il caricamento e l'errore", () => {
  it("mentre la famiglia arriva dice che sta preparando, con OK spento", async () => {
    const pronto = new Promise<void>(() => {});
    void apriFinestra(MODULO, pronto, esegui, opzioni());
    await settle();
    expect(dialog()!.querySelector('.kit-form-note[role="status"]')?.textContent).toBe(
      "Sto preparando questa funzione: la prima volta ci vuole un momento.",
    );
    expect(dialog()!.getAttribute("aria-busy")).toBe("true");
    expect(action("ok").disabled).toBe(true);
    expect(action("retry").hidden).toBe(true);
    expect(chiamate).toHaveLength(0);
  });

  it("con NoMemory dice la memoria piena, e Riprova rifà la promessa", async () => {
    const riprova = vi.fn(() => Promise.resolve());
    void apriFinestra(MODULO, Promise.reject("no_memory"), esegui, opzioni({ riprova }));
    await settle();
    expect(dialog()!.querySelector(".kit-form-error")?.textContent).toContain("la memoria dei motori è piena");
    expect(action("retry").hidden).toBe(false);
    action("retry").click();
    await settle();
    expect(riprova).toHaveBeenCalledTimes(1);
    expect(numberInputs()).toHaveLength(2);
    expect(action("ok").disabled).toBe(false);
  });

  it("senza una promessa per rifarla, Riprova non c'è", async () => {
    void apriFinestra(MODULO, Promise.reject("altro"), esegui, opzioni());
    await settle();
    expect(dialog()!.querySelector(".kit-form-error")?.textContent).toBe("Non riesco a preparare questa funzione. Riprova.");
    expect(action("retry").hidden).toBe(true);
  });
});

describe("l'anteprima", () => {
  it("parte appena la forma è pronta, e col fuoco sul primo campo", async () => {
    await open();
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0]!.anteprima).toBe(true);
    expect(chiamate[0]!.valori).toEqual({ distanza: 6, giunzioni: "arrotondato", limite: 4 });
    expect(document.activeElement).toBe(numberInputs()[0]);
  });

  it("parte al più ogni 120 ms, col valore dell'ultimo momento", async () => {
    await open();
    expect(chiamate).toHaveLength(1);
    typeAndCommit(numberInputs()[0]!, "7");
    typeAndCommit(numberInputs()[0]!, "8");
    expect(chiamate).toHaveLength(1);
    vi.advanceTimersByTime(INTERVALLO_ANTEPRIMA_MS);
    await settle();
    expect(chiamate).toHaveLength(2);
    expect(chiamate[1]!.valori.distanza).toBe(8);
    expect(chiamate[1]!.anteprima).toBe(true);
  });

  it("un esito vecchio si butta: vale solo l'ultima anteprima mandata", async () => {
    await open();
    typeAndCommit(numberInputs()[0]!, "7");
    vi.advanceTimersByTime(INTERVALLO_ANTEPRIMA_MS);
    await settle();
    const vecchia = chiamate[1]!;
    typeAndCommit(numberInputs()[0]!, "8");
    vi.advanceTimersByTime(INTERVALLO_ANTEPRIMA_MS);
    await settle();
    expect(chiamate).toHaveLength(3);
    chiamate[2]!.risolvi({ anteprima: ANTEPRIMA, rifiuto: null });
    await settle();
    vecchia.risolvi({ anteprima: { ...ANTEPRIMA, marquee: [0, 0, 1, 1] }, rifiuto: null });
    await settle();
    expect(foglio).toEqual([ANTEPRIMA]);
  });

  it("un'anteprima che arriva dopo Annulla si butta, e il foglio si pulisce", async () => {
    const { result } = await open();
    action("cancel").click();
    expect(await result).toBe(false);
    chiamate[0]!.risolvi({ anteprima: ANTEPRIMA, rifiuto: null });
    await settle();
    expect(foglio[foglio.length - 1]).toBeNull();
    expect(foglio).not.toContain(ANTEPRIMA);
  });

  it("con la casella spenta non manda anteprime e toglie quella sul foglio", async () => {
    await open();
    const casella = dialog()!.querySelector<HTMLInputElement>('.kit-form-check input[type="checkbox"]')!;
    casella.checked = false;
    casella.dispatchEvent(new Event("change", { bubbles: true }));
    expect(foglio[foglio.length - 1]).toBeNull();
    typeAndCommit(numberInputs()[0]!, "9");
    vi.advanceTimersByTime(INTERVALLO_ANTEPRIMA_MS * 3);
    await settle();
    expect(chiamate.filter((call) => call.anteprima)).toHaveLength(1);
  });

  it("con NoPreview la casella «Anteprima» non c'è più", async () => {
    await open();
    chiamate[0]!.risolvi({ anteprima: null, rifiuto: "no_preview" });
    await settle();
    const labels = [...dialog()!.querySelectorAll(".kit-form-check")].map((label) => label.textContent);
    expect(labels).not.toContain("Anteprima");
  });
});

describe("OK, Annulla, Esc e Invio", () => {
  it("OK manda il comando una volta sola, chiude con true e ricorda i valori", async () => {
    const id = "tracciato.sposta.memoria";
    const { result } = await open({ id });
    typeAndCommit(numberInputs()[0]!, "5");
    action("ok").click();
    action("ok").click();
    await settle();
    expect(commits()).toHaveLength(1);
    expect(commits()[0]!.valori.distanza).toBe(5);
    commits()[0]!.risolvi(VUOTO);
    expect(await result).toBe(true);
    expect(dialog()).toBeNull();

    // La volta dopo, nella stessa sessione, la finestra riprende i valori di prima.
    chiamate = [];
    await open({ id });
    expect(numberInputs()[0]!.value).toBe("5");
  });

  it("Annulla chiude con false senza mandare il comando", async () => {
    const { result } = await open();
    action("cancel").click();
    expect(await result).toBe(false);
    expect(commits()).toHaveLength(0);
  });

  it("Esc è Annulla", async () => {
    const { result } = await open();
    press(dialog()!, "Escape");
    expect(await result).toBe(false);
    expect(commits()).toHaveLength(0);
  });

  it("Invio in un campo conferma, come OK", async () => {
    const { result } = await open();
    typeAndEnter(numberInputs()[0]!, "4");
    await settle();
    expect(commits()).toHaveLength(1);
    commits()[0]!.risolvi(VUOTO);
    expect(await result).toBe(true);
  });

  it("il fuoco torna dove era quando la finestra si chiude", async () => {
    opener.focus();
    const { result } = await open();
    expect(document.activeElement).not.toBe(opener);
    action("cancel").click();
    await result;
    expect(document.activeElement).toBe(opener);
  });

  it("un comando rifiutato con NoMemory lo dice con Riprova, e Riprova lo rimanda", async () => {
    const { result } = await open();
    action("ok").click();
    await settle();
    commits()[0]!.risolvi({ anteprima: null, rifiuto: "no_memory" });
    await settle();
    expect(dialog()!.querySelector(".kit-form-error")?.textContent).toContain("la memoria dei motori è piena");
    expect(action("retry").hidden).toBe(false);
    action("retry").click();
    await settle();
    expect(commits()).toHaveLength(2);
    commits()[1]!.risolvi(VUOTO);
    expect(await result).toBe(true);
  });
});

describe("i limiti e la chiusura", () => {
  it("un numero fuori dai limiti non si prende, dice il limite, e OK è spento", async () => {
    await open();
    const limite = numberInputs()[1]!;
    typeAndCommit(limite, "12");
    await settle();
    expect(errorOf(1)).toBe("Scrivi un numero fra 1 e 9.");
    expect(errorOf(0)).toBe("");
    expect(action("ok").disabled).toBe(true);
    typeAndCommit(limite, "3");
    await settle();
    expect(action("ok").disabled).toBe(false);
  });

  it("il disegno chiuso chiude la finestra, senza mandare il comando", async () => {
    const { result } = await open();
    vita.close();
    expect(await result).toBe(false);
    expect(dialog()).toBeNull();
    expect(commits()).toHaveLength(0);
    expect(foglio[foglio.length - 1]).toBeNull();
  });

  it("la finestra porta il nome del comando e la sua azione, ed è un dialogo con l'anteprima", async () => {
    await open();
    expect(dialog()!.getAttribute("role")).toBe("dialog");
    expect(dialog()!.querySelector(".kit-dialog-title")?.textContent).toBe("Sposta tracciato");
    expect(action("ok").textContent).toBe("Sposta");
    expect(document.querySelector(".kit-dialog-scrim")?.hasAttribute("data-preview")).toBe(true);
  });
});
