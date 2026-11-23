// @vitest-environment happy-dom
// La finestra «Librerie di campioni» (window.swatchLibrary, K6 T14, finestra): apertura, scelta di una
// libreria, Aggiungi tutti o scelti, i rifiuti del motore in italiano, Annulla ed Esc senza comandi,
// la risposta vecchia che non vince, le letture che falliscono, e la chiusura. Col motore finto e con
// la porta vera, per gli id `disegno.` e gli argomenti.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingCommandRequest, DrawingOutcome } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { DipendenzeComando } from "./esegui";
import { apriFinestraLibrerie, creaPortaLibrerie, type CampioneVoce, type LibreriaVoce, type PortaLibrerie } from "./librerie-finestra";
import { t, type DrawKey } from "../strings";

const LIBRERIE: LibreriaVoce[] = [
  { id: "earth-tones", name: "Earth Tones", category: "builtIn", count: 42 },
  { id: "pastels", name: "Pastels", category: "builtIn", count: 24 },
];

const CAMPIONI: Record<string, CampioneVoce[]> = {
  "earth-tones": [
    { name: "Clay 1", kind: "color", hex: "#f5c5b4" },
    { name: "Clay 2", kind: "color", hex: "#df9e87" },
  ],
  pastels: [{ name: "Rosa", kind: "color", hex: "#ffd1dc" }],
};

const lifetimes: Lifetime[] = [];
afterEach(() => {
  for (const life of lifetimes.splice(0)) life.close();
  document.body.replaceChildren();
});
function vita(): Lifetime {
  const life = openLifetime();
  lifetimes.push(life);
  return life;
}

/// Il motore finto della porta: le letture danno le librerie e i loro campioni.
function portaFinta(over: Partial<PortaLibrerie> = {}) {
  const porta = {
    elenco: vi.fn(() => Promise.resolve<LibreriaVoce[] | null>(LIBRERIE)),
    campioni: vi.fn((id: string) => Promise.resolve<CampioneVoce[] | null>(CAMPIONI[id] ?? [])),
    aggiungi: vi.fn((_id: string, _nomi: readonly string[] | null) => Promise.resolve<{ rifiuto: DrawKey | null } | null>({ rifiuto: null })),
    ...over,
  };
  return porta;
}

const attesa = () => new Promise((r) => setTimeout(r, 0));
const finestra = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');
const scelta = (): HTMLSelectElement => document.querySelector<HTMLSelectElement>(".draw-libraries-choice")!;
const caselle = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>(".draw-libraries-list input[type=checkbox]")];
const tasto = (azione: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`[data-action="${azione}"]`)!;
const testo = (): string => finestra()?.textContent ?? "";

function sceglie(id: string): void {
  scelta().value = id;
  scelta().dispatchEvent(new Event("change"));
}

describe("la finestra Librerie di campioni", () => {
  it("apertura: l'elenco delle librerie, nessuna scelta, Aggiungi spento", async () => {
    const porta = portaFinta();
    apriFinestraLibrerie(porta, vita());
    await attesa();
    expect(porta.elenco).toHaveBeenCalledTimes(1);
    expect(porta.campioni).not.toHaveBeenCalled();
    expect([...scelta().options].map((o) => o.value)).toEqual(["", "earth-tones", "pastels"]);
    expect(scelta().value).toBe("");
    expect(caselle()).toHaveLength(0);
    expect(tasto("all").disabled).toBe(true);
    expect(tasto("selected").disabled).toBe(true);
  });

  it("scegliere una libreria mostra i suoi campioni, con il nome e il colore; cambiarla rimpiazza l'elenco", async () => {
    const porta = portaFinta();
    apriFinestraLibrerie(porta, vita());
    await attesa();
    sceglie("earth-tones");
    await attesa();
    expect(porta.campioni).toHaveBeenLastCalledWith("earth-tones");
    expect(caselle().map((c) => c.closest("label")?.textContent)).toEqual(["Clay 1 #f5c5b4", "Clay 2 #df9e87"]);
    expect(tasto("all").disabled).toBe(false);
    sceglie("pastels");
    await attesa();
    expect(caselle().map((c) => c.closest("label")?.textContent)).toEqual(["Rosa #ffd1dc"]);
    expect(testo()).not.toContain("Clay 1");
  });

  it("Aggiungi tutti manda la libreria senza nomi, e la finestra si chiude", async () => {
    const porta = portaFinta();
    apriFinestraLibrerie(porta, vita());
    await attesa();
    sceglie("earth-tones");
    await attesa();
    tasto("all").click();
    await attesa();
    expect(porta.aggiungi).toHaveBeenCalledWith("earth-tones", null);
    expect(finestra()).toBeNull();
  });

  it("Aggiungi con solo i campioni spuntati manda quei nomi, nell'ordine della libreria", async () => {
    const porta = portaFinta();
    apriFinestraLibrerie(porta, vita());
    await attesa();
    sceglie("earth-tones");
    await attesa();
    caselle()[1]!.click();
    await attesa();
    expect(tasto("selected").disabled).toBe(false);
    tasto("selected").click();
    await attesa();
    expect(porta.aggiungi).toHaveBeenCalledWith("earth-tones", ["Clay 2"]);
    expect(finestra()).toBeNull();
  });

  it("il motore rifiuta: la frase in italiano, la finestra resta aperta, e nessun passo", async () => {
    const porta = portaFinta({ aggiungi: vi.fn(() => Promise.resolve({ rifiuto: "draw.disabled.unmapped" as DrawKey })) });
    apriFinestraLibrerie(porta, vita());
    await attesa();
    sceglie("earth-tones");
    await attesa();
    tasto("all").click();
    await attesa();
    expect(finestra()).not.toBeNull();
    expect(testo()).toContain(t("draw.disabled.unmapped"));
    expect(tasto("all").disabled).toBe(false);
  });

  it("una libreria con sfumature: lo dice prima di mandare, e Aggiungi è spento", async () => {
    const porta = portaFinta({
      campioni: vi.fn(() => Promise.resolve<CampioneVoce[] | null>([{ name: "Gold", kind: "gradient", hex: null }])),
    });
    apriFinestraLibrerie(porta, vita());
    await attesa();
    sceglie("earth-tones");
    await attesa();
    expect(testo()).toContain(t("draw.libraries.gradients"));
    expect(tasto("all").disabled).toBe(true);
    expect(porta.aggiungi).not.toHaveBeenCalled();
  });

  it("Annulla e Esc non mandano nessun comando e non fanno passi", async () => {
    const porta = portaFinta();
    apriFinestraLibrerie(porta, vita());
    await attesa();
    sceglie("earth-tones");
    await attesa();
    tasto("cancel").click();
    await attesa();
    expect(finestra()).toBeNull();
    apriFinestraLibrerie(porta, vita());
    await attesa();
    sceglie("earth-tones");
    await attesa();
    finestra()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await attesa();
    expect(porta.aggiungi).not.toHaveBeenCalled();
  });

  it("una risposta vecchia che arriva dopo il cambio di libreria non sovrascrive l'elenco nuovo", async () => {
    let risposta: (c: CampioneVoce[]) => void = () => {};
    const porta = portaFinta({
      campioni: vi.fn((id: string) =>
        id === "earth-tones" ? new Promise<CampioneVoce[] | null>((r) => (risposta = r)) : Promise.resolve<CampioneVoce[] | null>(CAMPIONI.pastels!),
      ),
    });
    apriFinestraLibrerie(porta, vita());
    await attesa();
    sceglie("earth-tones");
    sceglie("pastels");
    await attesa();
    risposta(CAMPIONI["earth-tones"]!);
    await attesa();
    expect(caselle().map((c) => c.closest("label")?.textContent)).toEqual(["Rosa #ffd1dc"]);
  });

  it("l'elenco che non arriva lo dice, e la finestra resta usabile (si chiude)", async () => {
    const porta = portaFinta({ elenco: vi.fn(() => Promise.resolve(null)) });
    apriFinestraLibrerie(porta, vita());
    await attesa();
    expect(testo()).toContain(t("draw.libraries.list_failed"));
    tasto("cancel").click();
    await attesa();
    expect(finestra()).toBeNull();
  });

  it("i campioni che non arrivano lo dicono, e Aggiungi resta spento", async () => {
    const porta = portaFinta({ campioni: vi.fn(() => Promise.resolve(null)) });
    apriFinestraLibrerie(porta, vita());
    await attesa();
    sceglie("earth-tones");
    await attesa();
    expect(testo()).toContain(t("draw.libraries.get_failed"));
    expect(tasto("all").disabled).toBe(true);
    sceglie("pastels");
    await attesa();
    expect(porta.campioni).toHaveBeenCalledTimes(2);
  });

  it("chiusa e riaperta: una finestra sola, e il Completo che si chiude la chiude", async () => {
    const porta = portaFinta();
    apriFinestraLibrerie(porta, vita());
    await attesa();
    tasto("cancel").click();
    await attesa();
    apriFinestraLibrerie(porta, vita());
    await attesa();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    tasto("cancel").click();
    await attesa();
    const dalCompleto = vita();
    apriFinestraLibrerie(porta, dalCompleto);
    await attesa();
    dalCompleto.close();
    await attesa();
    expect(finestra()).toBeNull();
  });

  it("la porta vera manda i tre comandi col prefisso disegno. e gli argomenti giusti", async () => {
    const comandi: DrawingCommandRequest[] = [];
    const risposta = (reading: unknown): DrawingOutcome =>
      ({ revision: "1", preview: null, ops: null, selection: [], losses: [], refused: null, frame: null, reading }) as unknown as DrawingOutcome;
    const sessione = {
      comando: vi.fn((richiesta: Omit<DrawingCommandRequest, "revision">) => {
        comandi.push(richiesta as DrawingCommandRequest);
        if (richiesta.id === "disegno.swatch.library.list") return Promise.resolve(risposta({ libraries: LIBRERIE, userFolder: null }));
        if (richiesta.id === "disegno.swatch.library.get") return Promise.resolve(risposta({ id: "earth-tones", swatches: CAMPIONI["earth-tones"] }));
        return Promise.resolve(risposta(null));
      }),
    };
    const dipendenze = {
      motore: { pronta: () => Promise.resolve(sessione), assente: () => null },
      selezione: () => [],
      vita: vita(),
      leggi: () => null,
      commit: () => true,
      seleziona: () => undefined,
      annuncia: () => undefined,
    } as unknown as DipendenzeComando;
    const porta = creaPortaLibrerie(dipendenze, "Aggiungi campioni di libreria");
    expect((await porta.elenco())?.map((l) => l.id)).toEqual(["earth-tones", "pastels"]);
    expect((await porta.campioni("earth-tones"))?.map((c) => c.name)).toEqual(["Clay 1", "Clay 2"]);
    await porta.aggiungi("earth-tones", ["Clay 2"]);
    await porta.aggiungi("earth-tones", null);
    expect(comandi.map((c) => c.id)).toEqual([
      "disegno.swatch.library.list",
      "disegno.swatch.library.get",
      "disegno.swatch.library.add",
      "disegno.swatch.library.add",
    ]);
    expect(comandi[1]!.value).toEqual({ library: "earth-tones" });
    expect(comandi[2]!.value).toEqual({ library: "earth-tones", names: ["Clay 2"] });
    expect(comandi[3]!.value).toEqual({ library: "earth-tones" });
  });
});
