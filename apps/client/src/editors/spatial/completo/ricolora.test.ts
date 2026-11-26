// @vitest-environment happy-dom
// La finestra Ricolora grafica (K6 T14, giro 3) con un motore finto: legge i colori della scelta, una
// proposta di Riduci colori dà l'anteprima sul foglio, OK la scrive con `disegno.recolor.apply` una
// volta sola, e Annulla non lascia niente. Un rifiuto del motore resta nella finestra con il perché.
import type { DrawingOutcome } from "../../../host/contract";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { apriRicolora, motivoRicolora } from "./ricolora";
import type { DipendenzeComando } from "./esegui";
import { afterEach, describe, expect, it, vi } from "vitest";

type Richiesta = { id: string; selection: string[]; value: unknown; preview?: boolean };

function esito(campi: Partial<DrawingOutcome>): DrawingOutcome {
  return { revision: "1", preview: null, ops: null, selection: ["oa1a1a1a1"], losses: [], refused: null, frame: null, ...campi } as DrawingOutcome;
}

const COLORI = {
  colors: [
    { key: "rgb 255 0 0", hex: "#ff0000", count: 2 },
    { key: "rgb 0 0 255", hex: "#0000ff", count: 1 },
  ],
};

/// Un motore finto: `risposta` decide l'esito di ogni comando, dal suo id e dalle sue opzioni.
function motoreFinto(risposta: (richiesta: Richiesta) => DrawingOutcome) {
  const comando = vi.fn((richiesta: Richiesta) => Promise.resolve(risposta(richiesta)));
  const sessione = { comando } as unknown as SessioneMotore;
  const motore = { pronta: () => Promise.resolve(sessione), adesso: () => sessione, assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

function dipendenze(motore: MotoreDelDisegno | null, selezione: readonly string[] = ["oa1a1a1a1"]) {
  const anteprima = vi.fn();
  const commit = vi.fn(() => true);
  const vita = openLifetime();
  const deps = {
    motore,
    carica: {} as never,
    vita,
    selezione: () => selezione,
    anteprima,
    finestra: vi.fn(),
    leggi: (ops: string | null) => (ops === null ? null : (JSON.parse(ops) as never)),
    commit,
    seleziona: vi.fn(),
    annuncia: vi.fn(),
  } as unknown as DipendenzeComando;
  return { deps, anteprima, commit, vita };
}

/// Il pulsante della finestra con questa scritta.
function pulsante(scritta: string): HTMLButtonElement {
  const trovato = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === scritta);
  if (trovato === undefined) throw new Error(`manca il pulsante «${scritta}»`);
  return trovato;
}

/// Una scrittura è `recolor.apply` non di anteprima: le letture hanno lo stesso `preview: false`.
const scrittura = (richiesta: Richiesta): boolean => richiesta.id === "disegno.recolor.apply" && richiesta.preview === false;

const OK = () => document.querySelector<HTMLButtonElement>('[data-action="ok"]')!;
const ANNULLA = () => document.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;

afterEach(() => {
  document.body.replaceChildren();
});

describe("ui.recolorDialog: la voce di menu spenta come il comando che scrive", () => {
  it("la voce dice perché è spenta, se il motore dice che il comando non si fa", () => {
    const stato = (info: unknown) => ({ per: new Map(info === null ? [] : [["disegno.recolor.apply", info]]), assente: null }) as never;
    expect(motivoRicolora(stato({ id: "disegno.recolor.apply", enabled: false, disabled_reason: "no_selection" }))).toBe("Scegli un oggetto.");
    expect(motivoRicolora(stato({ id: "disegno.recolor.apply", enabled: false, disabled_reason: "fub_ink" }))).toBe(
      "Un tratto dell'Inchiostro di Fub non si cambia da qui.",
    );
    expect(motivoRicolora(stato({ id: "disegno.recolor.apply", enabled: true, disabled_reason: null }))).toBeNull();
    // Il motore non ha detto niente della voce: non la si spegne da sé.
    expect(motivoRicolora(stato(null))).toBeNull();
  });
});

describe("ui.recolorDialog: la finestra Ricolora grafica dal Completo", () => {
  it("legge i colori della scelta con disegno.recolor.colors e mostra una riga per colore", async () => {
    const { motore, comando } = motoreFinto((r) => (r.id === "disegno.recolor.colors" ? esito({ reading: COLORI }) : esito({})));
    const { deps } = dipendenze(motore as never);
    const aperta = apriRicolora(deps);
    await vi.waitFor(() => expect(document.querySelectorAll(".draw-recolor-row")).toHaveLength(2));
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.recolor.colors", selection: ["oa1a1a1a1"] }));
    // OK è spento finché non c'è un colore cambiato.
    expect(OK().disabled).toBe(true);
    ANNULLA().click();
    expect(await aperta).toBe(false);
  });

  it("Riduci colori mostra l'anteprima della proposta; OK la scrive una volta sola, con disegno.", async () => {
    const proposta = { map: [{ from: ["rgb 255 0 0", "rgb 0 0 255"], to: "rgb 255 0 0" }], preserved: [], method: "scaleTints" };
    const anteprimaDelMotore = { frame: 1 } as never;
    const ops = JSON.stringify([{ op: "set", id: "oa1a1a1a1", attrs: { fill: "#ff0000" } }]);
    const { motore, comando } = motoreFinto((r) => {
      if (r.id === "disegno.recolor.colors") return esito({ reading: COLORI });
      if (r.id === "disegno.recolor.reduce") return esito({ reading: proposta });
      if (r.id === "disegno.recolor.apply" && r.preview === true) return esito({ preview: anteprimaDelMotore });
      return esito({ ops });
    });
    const { deps, anteprima, commit } = dipendenze(motore as never);
    const aperta = apriRicolora(deps);
    await vi.waitFor(() => expect(document.querySelectorAll(".draw-recolor-row")).toHaveLength(2));

    pulsante("Riduci colori").click();
    await vi.waitFor(() => expect(document.querySelectorAll(".draw-recolor-row")).toHaveLength(2));
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.recolor.reduce" }));

    // L'anteprima parte dopo una breve attesa e va sul foglio.
    await vi.waitFor(() => expect(anteprima).toHaveBeenCalledWith(anteprimaDelMotore));
    expect(comando).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "disegno.recolor.apply",
        preview: true,
        value: { map: [{ from: ["rgb 255 0 0", "rgb 0 0 255"], to: "#ff0000" }], method: "scaleTints" },
      }),
    );

    expect(OK().disabled).toBe(false);
    OK().click();
    expect(await aperta).toBe(true);
    // La scrittura: un solo comando non di anteprima, con la mappa e il metodo della proposta.
    const scritture = comando.mock.calls.map(([r]) => r).filter(scrittura);
    expect(scritture).toEqual([expect.objectContaining({ id: "disegno.recolor.apply", value: { map: [{ from: ["rgb 255 0 0", "rgb 0 0 255"], to: "#ff0000" }], method: "scaleTints" } })]);
    expect(commit).toHaveBeenCalledWith(JSON.parse(ops), "Ricolora grafica");
    expect(anteprima).toHaveBeenLastCalledWith(null);
    // Ogni comando del motore passa dal prefisso del Completo.
    expect(comando.mock.calls.every(([r]) => r.id.startsWith("disegno."))).toBe(true);
  });

  it("un rifiuto del motore resta nella finestra con il perché, e non scrive niente", async () => {
    const { motore, comando } = motoreFinto((r) => {
      if (r.id === "disegno.recolor.colors") return esito({ reading: COLORI });
      if (r.id === "disegno.recolor.reduce") return esito({ reading: { map: [{ from: ["rgb 255 0 0", "rgb 0 0 255"], to: "rgb 255 0 0" }], method: "scaleTints" } });
      if (r.id === "disegno.recolor.apply" && r.preview === false) return esito({ refused: "locked" });
      return esito({ preview: null });
    });
    const { deps, commit } = dipendenze(motore as never);
    const aperta = apriRicolora(deps);
    await vi.waitFor(() => expect(document.querySelectorAll(".draw-recolor-row")).toHaveLength(2));
    pulsante("Riduci colori").click();
    await vi.waitFor(() => expect(OK().disabled).toBe(false));
    OK().click();
    await vi.waitFor(() => expect(document.querySelector(".kit-dialog")).not.toBeNull());
    await vi.waitFor(() => {
      const errore = [...document.querySelectorAll<HTMLElement>("p")].find((p) => p.textContent && !p.hidden && p.textContent.includes("Modifica non applicata"));
      expect(errore).toBeDefined();
    });
    expect(commit).not.toHaveBeenCalled();
    ANNULLA().click();
    expect(await aperta).toBe(false);
    expect(comando.mock.calls.filter(([r]) => scrittura(r))).toHaveLength(1);
  });

  it("Annulla toglie l'anteprima dal foglio e non manda la scrittura", async () => {
    const { motore, comando } = motoreFinto((r) => {
      if (r.id === "disegno.recolor.colors") return esito({ reading: COLORI });
      if (r.id === "disegno.recolor.reduce") return esito({ reading: { map: [{ from: ["rgb 255 0 0", "rgb 0 0 255"], to: "rgb 255 0 0" }], method: "scaleTints" } });
      return esito({ preview: { frame: 2 } as never });
    });
    const { deps, anteprima, commit } = dipendenze(motore as never);
    const aperta = apriRicolora(deps);
    await vi.waitFor(() => expect(document.querySelectorAll(".draw-recolor-row")).toHaveLength(2));
    pulsante("Riduci colori").click();
    await vi.waitFor(() => expect(anteprima).toHaveBeenCalledWith({ frame: 2 }));
    ANNULLA().click();
    expect(await aperta).toBe(false);
    expect(anteprima).toHaveBeenLastCalledWith(null);
    expect(commit).not.toHaveBeenCalled();
    expect(comando.mock.calls.some(([r]) => scrittura(r))).toBe(false);
  });

  it("una scelta senza colori lo dice, e OK resta spento", async () => {
    const { motore } = motoreFinto((r) => (r.id === "disegno.recolor.colors" ? esito({ reading: { colors: [] } }) : esito({})));
    const { deps } = dipendenze(motore as never);
    const aperta = apriRicolora(deps);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Nella scelta non ci sono colori da cambiare."));
    expect(OK().disabled).toBe(true);
    ANNULLA().click();
    await aperta;
  });

  it("una lettura che non si capisce dà l'errore, e Riprova rilegge i colori", async () => {
    let letture = 0;
    const { motore, comando } = motoreFinto((r) => {
      if (r.id !== "disegno.recolor.colors") return esito({});
      letture += 1;
      return esito({ reading: letture === 1 ? { colors: "rotto" } : COLORI });
    });
    const { deps } = dipendenze(motore as never);
    const aperta = apriRicolora(deps);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Non riesco a leggere i colori della scelta."));
    pulsante("Riprova").click();
    await vi.waitFor(() => expect(document.querySelectorAll(".draw-recolor-row")).toHaveLength(2));
    expect(comando.mock.calls.filter(([r]) => r.id === "disegno.recolor.colors")).toHaveLength(2);
    ANNULLA().click();
    await aperta;
  });

  it("senza un disegno aperto dice che il motore non risponde", async () => {
    const { deps } = dipendenze(null);
    const aperta = apriRicolora(deps);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Non riesco a leggere i colori della scelta."));
    ANNULLA().click();
    expect(await aperta).toBe(false);
  });

  it("senza una scelta dice di sceglierla, non legge niente e non manda niente", async () => {
    const { motore, comando } = motoreFinto(() => esito({ reading: COLORI }));
    const { deps } = dipendenze(motore as never, []);
    const aperta = apriRicolora(deps);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Scegli un oggetto."));
    expect(OK().disabled).toBe(true);
    expect(comando).not.toHaveBeenCalled();
    ANNULLA().click();
    expect(await aperta).toBe(false);
  });

  it("senza cambiamenti OK è spento: non manda la scrittura e non fa nessun passo", async () => {
    const { motore, comando } = motoreFinto((r) => (r.id === "disegno.recolor.colors" ? esito({ reading: COLORI }) : esito({})));
    const { deps, commit, anteprima } = dipendenze(motore as never);
    const aperta = apriRicolora(deps);
    await vi.waitFor(() => expect(document.querySelectorAll(".draw-recolor-row")).toHaveLength(2));
    expect(OK().disabled).toBe(true);
    OK().click();
    expect(comando.mock.calls.some(([r]) => scrittura(r))).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(anteprima).not.toHaveBeenCalled();
    ANNULLA().click();
    expect(await aperta).toBe(false);
  });

  it("Colori casuali manda il seme e le due opzioni al motore, e la proposta riempie le righe", async () => {
    const proposta = { map: [{ from: ["rgb 255 0 0"], to: "rgb 81.1 131.55 182" }, { from: ["rgb 0 0 255"], to: "rgb 212.74 181.05 149.36" }] };
    const { motore, comando } = motoreFinto((r) => {
      if (r.id === "disegno.recolor.colors") return esito({ reading: COLORI });
      if (r.id === "disegno.recolor.randomize") return esito({ reading: proposta });
      return esito({ preview: { frame: 3 } as never });
    });
    const { deps } = dipendenze(motore as never);
    const aperta = apriRicolora(deps);
    await vi.waitFor(() => expect(document.querySelectorAll(".draw-recolor-row")).toHaveLength(2));
    pulsante("Colori casuali").click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.recolor.randomize" })));
    const casuali = comando.mock.calls.find(([r]) => r.id === "disegno.recolor.randomize")![0];
    expect(casuali.value).toEqual({
      map: [
        { from: ["rgb 255 0 0"], to: "#ff0000" },
        { from: ["rgb 0 0 255"], to: "#0000ff" },
      ],
      order: true,
      saturationBrightness: false,
      seed: 0,
    });
    // Le righe prendono i colori della proposta: l'anteprima ora ne manda due cambiati.
    await vi.waitFor(() => expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.recolor.apply", preview: true })));
    const anteprima = comando.mock.calls.find(([r]) => r.id === "disegno.recolor.apply" && r.preview === true)![0];
    expect(anteprima.value).toEqual({
      map: [
        { from: ["rgb 255 0 0"], to: "#5184b6" },
        { from: ["rgb 0 0 255"], to: "#d5b595" },
      ],
      method: "exact",
    });
    ANNULLA().click();
    expect(await aperta).toBe(false);
  });
});
