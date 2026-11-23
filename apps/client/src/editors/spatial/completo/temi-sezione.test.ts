// @vitest-environment happy-dom
// Il pannello «Temi di colore» (K6 T14, temi): la lista, Salva e Togli, con una porta finta. Ogni stato
// ha la sua frase; i controlli del nome avvengono prima della porta; dopo un salvataggio o una rimozione
// la lista si rifà dal motore.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import { coloriDellaSelezione, sezioneTemi } from "./temi-sezione";
import type { EsitoTema, EsitoTemi, PortaTemi } from "./temi-porta";

/// Una porta finta: la lista, e le risposte di salvataggio e rimozione.
function portaFinta(temi: EsitoTemi = { kind: "pronti", temi: [] }) {
  const porta = {
    elenco: vi.fn(() => Promise.resolve(temi)),
    salva: vi.fn((nome: string, _colori: readonly string[]): Promise<EsitoTema> => {
      void nome;
      return Promise.resolve({ kind: "fatto", nome });
    }),
    togli: vi.fn((nome: string): Promise<EsitoTema> => Promise.resolve({ kind: "fatto", nome })),
  };
  return porta;
}

/// Monta il pannello: il corpo, la vita, la porta e i colori della selezione.
function monta(porta: ReturnType<typeof portaFinta>, colori: Record<string, unknown> = {}) {
  const corpo = document.createElement("div");
  const vita = openLifetime();
  const sezione = sezioneTemi(porta as unknown as PortaTemi, vita);
  const ctx = { corpo, sel: {}, motore: null, misure: {}, colori, aggiorna: () => undefined, rileggi: () => undefined, vita };
  sezione.disegna(ctx as never);
  return { corpo, vita };
}

/// Il pulsante con questo testo.
function bottone(corpo: HTMLElement, testo: string): HTMLButtonElement {
  const trovato = [...corpo.querySelectorAll("button")].find((b) => b.textContent?.includes(testo));
  if (!trovato) throw new Error(`manca il pulsante «${testo}»`);
  return trovato;
}

/// Il nome scritto nel campo, con questo valore.
function scrivi(corpo: HTMLElement, valore: string): void {
  const campo = corpo.querySelector("input") as HTMLInputElement;
  campo.value = valore;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("il pannello dei temi (riga color_themes)", () => {
  it("con la libreria vuota dice che non ci sono temi, e Togli tema è spento", async () => {
    const porta = portaFinta({ kind: "pronti", temi: [] });
    const { corpo } = monta(porta);
    await vi.waitFor(() => expect(corpo.textContent).toContain("Non ci sono temi salvati"));
    expect(bottone(corpo, "Togli tema").disabled).toBe(true);
  });

  it("con un tema lo mostra col nome e i suoi colori; scelto, Togli tema si accende", async () => {
    const porta = portaFinta({ kind: "pronti", temi: [{ nome: "Tramonto", colori: ["#ff0000", "#00ff00"] }] });
    const { corpo } = monta(porta);
    await vi.waitFor(() => expect(corpo.textContent).toContain("Tramonto"));
    expect(corpo.textContent).toContain("2 colori");
    bottone(corpo, "Tramonto").click();
    expect(bottone(corpo, "Tramonto").getAttribute("aria-pressed")).toBe("true");
    expect(bottone(corpo, "Togli tema").disabled).toBe(false);
  });

  it("con più temi li elenca tutti", async () => {
    const porta = portaFinta({
      kind: "pronti",
      temi: [
        { nome: "Tramonto", colori: ["#ff0000"] },
        { nome: "Mare", colori: ["#0000ff", "#00ffff"] },
      ],
    });
    const { corpo } = monta(porta);
    await vi.waitFor(() => expect(corpo.textContent).toContain("Mare"));
    expect(corpo.textContent).toContain("Tramonto");
  });

  it("senza nessun colore scelto, Salva è spento e la frase dice che cosa fare", async () => {
    const porta = portaFinta();
    const { corpo } = monta(porta, {});
    await vi.waitFor(() => expect(bottone(corpo, "Salva tema").disabled).toBe(true));
    expect(corpo.textContent).toContain("Scegli prima dei colori nel disegno");
    expect(porta.salva).not.toHaveBeenCalled();
  });

  it("salva dai colori della selezione (riempimento e contorno), e poi rifà la lista dal motore", async () => {
    const porta = portaFinta();
    const { corpo } = monta(porta, { riempimento: { valore: "#FF0000" }, contorno: { valore: "#00ff00" } });
    await vi.waitFor(() => expect(porta.elenco).toHaveBeenCalled());
    scrivi(corpo, "Mare");
    bottone(corpo, "Salva tema").click();
    await vi.waitFor(() => expect(porta.salva).toHaveBeenCalledWith("Mare", ["#ff0000", "#00ff00"]));
    await vi.waitFor(() => expect(porta.elenco.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(corpo.textContent).toContain("Tema «Mare» salvato.");
  });

  it("un nome già usato (anche con maiuscole diverse) dice la frase sotto il campo e non va al motore", async () => {
    const porta = portaFinta({ kind: "pronti", temi: [{ nome: "Tramonto", colori: ["#ff0000"] }] });
    const { corpo } = monta(porta, { riempimento: { valore: "#00ff00" } });
    await vi.waitFor(() => expect(corpo.textContent).toContain("Tramonto"));
    scrivi(corpo, "tramonto");
    bottone(corpo, "Salva tema").click();
    expect(corpo.textContent).toContain("C'è già un tema con questo nome");
    expect(porta.salva).not.toHaveBeenCalled();
  });

  it("un nome vuoto dice di scriverlo sotto il campo e non va al motore", async () => {
    const porta = portaFinta();
    const { corpo } = monta(porta, { riempimento: { valore: "#00ff00" } });
    await vi.waitFor(() => expect(porta.elenco).toHaveBeenCalled());
    bottone(corpo, "Salva tema").click();
    expect(corpo.textContent).toContain("Scrivi un nome per il tema.");
    expect(porta.salva).not.toHaveBeenCalled();
  });

  it("Togli tema tiene il tema scelto, lo toglie, e rifà la lista", async () => {
    const porta = portaFinta({ kind: "pronti", temi: [{ nome: "Tramonto", colori: ["#ff0000"] }] });
    const { corpo } = monta(porta);
    await vi.waitFor(() => expect(corpo.textContent).toContain("Tramonto"));
    bottone(corpo, "Tramonto").click();
    bottone(corpo, "Togli tema").click();
    await vi.waitFor(() => expect(porta.togli).toHaveBeenCalledWith("Tramonto"));
    await vi.waitFor(() => expect(corpo.textContent).toContain("Tema «Tramonto» tolto."));
  });

  it("il motore che non risponde dice che riprovare, e non mostra temi", async () => {
    const porta = portaFinta({ kind: "assente" });
    const { corpo } = monta(porta);
    await vi.waitFor(() => expect(corpo.textContent).toContain("Il motore non risponde"));
  });

  it("chiuso e riaperto, il pannello rilegge la lista dal motore e ritrova i temi", async () => {
    const porta = portaFinta({ kind: "pronti", temi: [{ nome: "Tramonto", colori: ["#ff0000"] }] });
    const primo = monta(porta);
    await vi.waitFor(() => expect(primo.corpo.textContent).toContain("Tramonto"));
    primo.vita.close();
    const riaperto = monta(porta);
    await vi.waitFor(() => expect(riaperto.corpo.textContent).toContain("Tramonto"));
    expect(porta.elenco.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("dopo la chiusura del pannello la risposta del motore non lo tocca", async () => {
    const porta = portaFinta({ kind: "pronti", temi: [{ nome: "Tramonto", colori: ["#ff0000"] }] });
    const corpo = document.createElement("div");
    const vita = openLifetime();
    sezioneTemi(porta as unknown as PortaTemi, vita).disegna({ corpo, sel: {}, motore: null, misure: {}, colori: {}, aggiorna: () => undefined, rileggi: () => undefined, vita } as never);
    vita.close();
    await Promise.resolve();
    expect(corpo.textContent).not.toContain("Tramonto");
  });
});

describe("i colori della selezione per un tema", () => {
  it("riempimento e contorno, in minuscolo, senza doppioni e solo esadecimali", () => {
    expect(coloriDellaSelezione({ riempimento: { valore: "#FF0000" }, contorno: { valore: "#ff0000" } })).toEqual(["#ff0000"]);
    expect(coloriDellaSelezione({ riempimento: { valore: null }, contorno: { valore: "#00ff00" } })).toEqual(["#00ff00"]);
    expect(coloriDellaSelezione({ riempimento: { valore: "rgb(1,2,3)" } })).toEqual([]);
    expect(coloriDellaSelezione(undefined)).toEqual([]);
  });
});
