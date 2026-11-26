// @vitest-environment happy-dom
// La sezione «Aspetto» del Design (pila degli effetti, come il pannello Aspetto di VectorCraft): la
// lettura di `effect.list` diventa righe nell'ordine della pila; l'occhio, Su, Giù, Duplica e Togli
// mandano i comandi della pila col posto dell'effetto (`item` `null` per gli effetti dell'oggetto);
// il nome apre le opzioni; più oggetti con pile diverse mostrano solo gli effetti comuni, con
// `aligned` e senza spostamenti; la sezione c'è nella scheda Design.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { allinea, pileDaLettura, postoDel3D, sezioneAspetto, statoDallePile, stessoEffetto, type AzioniAspetto, type EffettoApplicato } from "./aspetto-sezione";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

const IRRUVIDISCI = { id: "distort.roughen", params: { size: 5, relative: true, detail: 10, points: "smooth", seed: 1 }, visible: true };
const GONFIA = { id: "distort.puckerBloat", params: { amount: 30 }, visible: true };

/// La lettura di `effect.list` del motore sul quadrato nero di `effetti/pila.svg`, più un tratto con
/// un effetto suo.
const LETTURA = {
  catalog: [],
  applied: [
    {
      id: 2,
      effects: [IRRUVIDISCI, GONFIA],
      items: [
        { index: 0, kind: "fill", effects: [] },
        { index: 1, kind: "stroke", effects: [{ id: "stylize.roundCorners", params: { radius: 10 }, visible: false }] },
      ],
    },
  ],
  activeItem: null,
};

function effetto(id: string, params: Record<string, unknown> = {}, visibile = true): EffettoApplicato {
  return { id, params, visibile };
}

function motoreFinto(): MotoreDelDisegno {
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando: vi.fn() } as unknown as SessioneMotore;
  return { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
}

async function corpoDi(lettura: unknown) {
  const azioni = {
    esegui: vi.fn(() => Promise.resolve()),
    leggi: vi.fn(() => Promise.resolve(lettura)),
    nome: (id: string) => `nome:${id}`,
    haOpzioni: (id: string) => id !== "distort.puckerBloat",
    opzioni: vi.fn(),
  } satisfies AzioniAspetto;
  const corpo = document.createElement("div");
  const mostra = vi.fn();
  sezioneAspetto(azioni).disegna({ corpo, sel: { numero: 1 }, misure: {}, motore: {}, aggiorna: () => undefined, rileggi: () => undefined, vita: openLifetime(), mostra } as never);
  await vi.waitFor(() => expect(mostra).toHaveBeenCalled());
  return { corpo, azioni, mostra };
}

const righe = (corpo: HTMLElement) => [...corpo.querySelectorAll<HTMLElement>(".draw-appearance-row")];
const pulsante = (riga: HTMLElement, etichetta: string) => [...riga.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label")?.startsWith(etichetta))!;

describe("allinea, come VectorCraft", () => {
  it("trova la sottosequenza comune più lunga", () => {
    expect(allinea(["a", "b", "c"], ["b", "c"], (x, y) => x === y)).toEqual([null, 0, 1]);
    expect(allinea(["a", "b"], ["b", "a"], (x, y) => x === y)).toEqual([null, 0]);
    expect(allinea([], ["a"], (x, y) => x === y)).toEqual([]);
    expect(allinea(["a"], [], (x, y) => x === y)).toEqual([null]);
  });

  it("due effetti sono uguali con lo stesso id, gli stessi valori e la stessa visibilità", () => {
    expect(stessoEffetto(effetto("a", { x: 1 }), effetto("a", { x: 1 }))).toBe(true);
    expect(stessoEffetto(effetto("a", { x: 1 }), effetto("a", { x: 2 }))).toBe(false);
    expect(stessoEffetto(effetto("a"), effetto("a", {}, false))).toBe(false);
  });
});

describe("lo stato della sezione dalle pile", () => {
  it("un oggetto: gli effetti dell'oggetto, poi quelli dei tratti e riempimenti che ne hanno", () => {
    const stato = statoDallePile(pileDaLettura(LETTURA)!)!;
    expect(stato.allineati).toBe(false);
    expect(stato.espandibile).toBe(true);
    expect(stato.gruppi.map((g) => [g.elemento, g.tipo, g.righe.map((r) => [r.effetto.id, r.posto, r.su, r.giu])])).toEqual([
      [null, "", [["distort.roughen", 0, false, true], ["distort.puckerBloat", 1, true, false]]],
      [1, "stroke", [["stylize.roundCorners", 0, false, false]]],
    ]);
  });

  it("senza oggetti non c'è; senza effetti non c'è niente da espandere", () => {
    expect(statoDallePile([])).toBeNull();
    expect(statoDallePile([{ effetti: [], elementi: [] }])).toEqual({ gruppi: [], allineati: false, espandibile: false });
  });

  it("pile diverse: solo gli effetti dell'oggetto comuni, allineati e fermi", () => {
    const a = effetto("a");
    const b = effetto("b");
    const stato = statoDallePile([
      { effetti: [a, b], elementi: [] },
      { effetti: [b], elementi: [] },
    ])!;
    expect(stato.allineati).toBe(true);
    expect(stato.gruppi).toHaveLength(1);
    expect(stato.gruppi[0]!.righe.map((r) => [r.effetto.id, r.posto, r.su, r.giu])).toEqual([["b", 1, false, false]]);
  });

  it("pile uguali: la pila intera, senza aligned", () => {
    const pila = { effetti: [effetto("a"), effetto("b")], elementi: [] };
    const stato = statoDallePile([pila, pila])!;
    expect(stato.allineati).toBe(false);
    expect(stato.gruppi[0]!.righe).toHaveLength(2);
  });

  it("una lettura che non è della pila non dà niente", () => {
    expect(pileDaLettura(null)).toBeNull();
    expect(pileDaLettura({ applied: "no" })).toBeNull();
  });
});

describe("la sezione Aspetto del Design", () => {
  it("elenca gli effetti e manda i comandi della pila col loro posto", async () => {
    const { corpo, azioni, mostra } = await corpoDi(LETTURA);
    expect(mostra).toHaveBeenLastCalledWith(true);
    const [primo, secondo, terzo] = righe(corpo);
    expect(righe(corpo).map((r) => r.dataset.effect)).toEqual(["distort.roughen", "distort.puckerBloat", "stylize.roundCorners"]);
    expect(pulsante(primo!, "Sposta «nome:distort.roughen» su").disabled).toBe(true);

    const occhio = secondo!.querySelector<HTMLInputElement>(".draw-appearance-eye")!;
    expect(occhio.checked).toBe(true);
    occhio.checked = false;
    occhio.dispatchEvent(new Event("change"));
    expect(azioni.esegui).toHaveBeenLastCalledWith("effect.setParams", { index: 1, item: null, visible: false });

    pulsante(secondo!, "Sposta «nome:distort.puckerBloat» su").click();
    expect(azioni.esegui).toHaveBeenLastCalledWith("effect.move", { from: 1, to: 0, fromItem: null, toItem: null });
    pulsante(primo!, "Sposta «nome:distort.roughen» giù").click();
    expect(azioni.esegui).toHaveBeenLastCalledWith("effect.move", { from: 0, to: 1, fromItem: null, toItem: null });
    pulsante(terzo!, "Duplica").click();
    expect(azioni.esegui).toHaveBeenLastCalledWith("effect.duplicate", { index: 0, item: 1 });
    pulsante(primo!, "Togli").click();
    expect(azioni.esegui).toHaveBeenLastCalledWith("effect.remove", { index: 0, item: null });

    // Il nome di un effetto con valori apre le sue opzioni; uno senza non è un pulsante.
    primo!.querySelector<HTMLButtonElement>("button.draw-appearance-name")!.click();
    expect(azioni.opzioni).toHaveBeenCalledWith("distort.roughen", { index: 0, item: null }, IRRUVIDISCI.params);
    expect(secondo!.querySelector("button.draw-appearance-name")).toBeNull();
    // Un effetto nascosto si vede come tale.
    expect(terzo!.querySelector<HTMLInputElement>(".draw-appearance-eye")!.checked).toBe(false);

    const espandi = corpo.querySelector<HTMLButtonElement>(".draw-appearance-expand")!;
    expect(espandi.disabled).toBe(false);
    espandi.click();
    expect(azioni.esegui).toHaveBeenLastCalledWith("effect.expandAppearance", {});
  });

  it("con pile diverse ogni comando porta aligned", async () => {
    const { corpo, azioni } = await corpoDi({ applied: [{ effects: [IRRUVIDISCI, GONFIA], items: [] }, { effects: [GONFIA], items: [] }] });
    const [riga] = righe(corpo);
    expect(righe(corpo)).toHaveLength(1);
    pulsante(riga!, "Togli").click();
    expect(azioni.esegui).toHaveBeenLastCalledWith("effect.remove", { index: 1, item: null, aligned: true });
  });

  it("senza effetti lo dice ed Espandi aspetto è spento", async () => {
    const { corpo } = await corpoDi({ applied: [{ effects: [], items: [] }] });
    expect(righe(corpo)).toHaveLength(0);
    expect(corpo.querySelector(".draw-properties-note")).not.toBeNull();
    expect(corpo.querySelector<HTMLButtonElement>(".draw-appearance-expand")!.disabled).toBe(true);
  });

  it("senza una lettura non c'è", async () => {
    const { mostra } = await corpoDi(null);
    expect(mostra).toHaveBeenLastCalledWith(false);
  });

  it("c'è nella scheda Design del Completo", () => {
    const c = apri({ motore: motoreFinto(), life: openLifetime() } as never, {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      tasti: { selezione: () => [], annuncia: vi.fn() } as never,
    } as never);
    expect(c.sezioni.di("design").map((una) => una.id)).toContain("aspetto");
    c.chiudi();
  });
});

describe("Predefinito illuminazione 3D: il posto dell'effetto 3D", () => {
  const effetto = (id: string): EffettoApplicato => ({ id, params: {}, visibile: true });
  const pila = (effetti: string[], elementi: { posto: number; effetti: string[] }[] = []) => ({
    effetti: effetti.map(effetto),
    elementi: elementi.map((e) => ({ posto: e.posto, tipo: "fill", effetti: e.effetti.map(effetto) })),
  });

  it("il primo effetto 3D dell'oggetto, se no quello di un suo elemento", () => {
    expect(postoDel3D([pila(["distort.roughen", "threeD.extrude", "threeD.rotate"])])).toEqual({ item: null, index: 1 });
    expect(postoDel3D([pila(["distort.roughen"], [{ posto: 0, effetti: [] }, { posto: 2, effetti: ["threeD.inflate"] }])])).toEqual({ item: 2, index: 0 });
  });

  it("lo stesso posto per tutti; un oggetto senza 3D o posti diversi no", () => {
    expect(postoDel3D([pila(["threeD.extrude"]), pila(["threeD.revolve"])])).toEqual({ item: null, index: 0 });
    expect(postoDel3D([pila(["threeD.extrude"]), pila(["distort.roughen"])])).toBe("nessuno");
    expect(postoDel3D([pila(["threeD.extrude"]), pila(["distort.roughen", "threeD.extrude"])])).toBe("diversi");
    expect(postoDel3D([])).toBe("nessuno");
  });
});
