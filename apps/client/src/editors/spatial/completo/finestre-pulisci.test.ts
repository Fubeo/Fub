// @vitest-environment happy-dom
// La finestra di Pulisci… (K6 T12, `object.path.cleanUp`): dal Completo vero, una voce della ricerca apre la
// finestra. Il comando vale su tutto il disegno: la voce è accesa anche senza selezione. OK lo manda una volta
// sola coi tre interruttori; Annulla e Esc non mandano niente; un doppio clic apre una finestra sola, e
// chiusa la finestra la voce torna libera; un disegno senza niente da pulire non mette un passo nella
// cronologia. Il motore e la finestra sono finti: si guardano i valori che la finestra dà.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { apriFinestra } from "../motore/finestre";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

// Le finestre finte restano aperte finché il test non le chiude, come quelle vere: `chiudi` risolve la
// più vecchia con il valore dato (false: Annulla). Il pronto si consuma con `.catch`, come nella finestra vera.
const finestre = vi.hoisted(() => ({ chiudi: [] as Array<(valore: boolean) => void> }));

vi.mock("../motore/finestre", () => ({
  apriFinestra: vi.fn((_modulo: unknown, pronto: Promise<unknown>) => {
    pronto.catch(() => undefined);
    return new Promise<boolean>((chiudi) => {
      finestre.chiudi.push(chiudi);
    });
  }),
}));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: [], losses: [], refused: null, frame: null };
const VUOTO = { ...ESITO, ops: null, refused: "empty" as const };

/// Il motore con la sessione che conta i comandi; `comandi` dice che Pulisci è acceso, senza selezione.
function motoreFinto(risposta: typeof ESITO | typeof VUOTO = ESITO) {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(risposta));
  const comandi = vi.fn(() => Promise.resolve([{ id: "disegno.object.path.cleanUp", enabled: true, disabled_reason: null }]));
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero e la famiglia `tracciati` (le sue parole).
function completo(motore: MotoreDelDisegno, selezione: () => string[], commit = vi.fn(() => true), annuncia = vi.fn()) {
  return apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/tracciati/index.ts": () => import("./famiglie/tracciati/index"),
      },
      tasti: { selezione, annuncia, commit } as never,
    } as never,
  );
}

/// La voce «Pulisci…» della ricerca, con la selezione data.
async function voceDiPulisci(c: ReturnType<typeof completo>, selezione: () => string[]) {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  const voci = await c.ricerca(selezione, azioni);
  const voce = voci?.find((una) => una.label === "Pulisci…");
  expect(voce, "la voce Pulisci…").toBeDefined();
  return voce!;
}

describe("la finestra di Pulisci… (riga object.path.cleanUp)", () => {
  it("vale su tutto il disegno: la voce è accesa anche senza selezione, e la finestra ha i tre interruttori di serie", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto();
    const c = completo(motore, () => []);
    const voce = await voceDiPulisci(c, () => []);
    expect(voce.disabled).toBe(false);
    voce.run();
    await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
    const [modulo, , , opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(modulo).toEqual({
      campi: [
        { nome: "strayPoints", tipo: "sino" },
        { nome: "unpaintedObjects", tipo: "sino" },
        { nome: "emptyTextPaths", tipo: "sino" },
      ],
    });
    expect(opzioni).toMatchObject({
      titolo: "Pulisci",
      campi: {
        strayPoints: "Punti isolati",
        unpaintedObjects: "Tracciati senza riempimento né contorno",
        emptyTextPaths: "Testi vuoti",
      },
      iniziali: { strayPoints: true, unpaintedObjects: true, emptyTextPaths: true },
    });
    expect(opzioni.descrizione).toContain("tutto il disegno");
    finestre.chiudi.splice(0).forEach((chiudi) => chiudi(false));
    c.chiudi();
  });

  it("OK manda object.path.cleanUp una volta sola, senza selezione, coi tre interruttori", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto();
    const c = completo(motore, () => []);
    const voce = await voceDiPulisci(c, () => []);
    voce.run();
    await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    await esegui({ strayPoints: true, unpaintedObjects: false, emptyTextPaths: true }, false);
    expect(comando).toHaveBeenCalledTimes(1);
    expect(comando).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "disegno.object.path.cleanUp",
        selection: [],
        value: { strayPoints: true, unpaintedObjects: false, emptyTextPaths: true },
        preview: false,
      }),
    );
    finestre.chiudi.splice(0).forEach((chiudi) => chiudi(true));
    c.chiudi();
  });

  it("Annulla e Esc, che non chiamano OK, non mandano niente al motore", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto();
    const c = completo(motore, () => []);
    const voce = await voceDiPulisci(c, () => []);
    voce.run();
    await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
    // La finestra si chiude senza OK: nessun comando, nessun passo.
    finestre.chiudi.splice(0).forEach((chiudi) => chiudi(false));
    await Promise.resolve();
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("un doppio clic sulla voce apre una finestra sola; chiusa, la voce torna libera", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto();
    const c = completo(motore, () => []);
    const voce = await voceDiPulisci(c, () => []);
    voce.run();
    voce.run();
    await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
    await Promise.resolve();
    expect(vi.mocked(apriFinestra)).toHaveBeenCalledTimes(1);
    // Chiusa la finestra, la voce si riapre: una finestra per volta, non una per sempre. La
    // liberazione arriva con la chiusura, un passo dopo: la voce si riprova finché si riapre.
    finestre.chiudi.splice(0).forEach((chiudi) => chiudi(false));
    await vi.waitFor(() => {
      voce.run();
      expect(vi.mocked(apriFinestra)).toHaveBeenCalledTimes(2);
    });
    finestre.chiudi.splice(0).forEach((chiudi) => chiudi(false));
    c.chiudi();
  });

  it("niente da pulire: il motore risponde `empty`, la frase dice che non c'era niente da cambiare, e nessun passo va nella cronologia", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto(VUOTO);
    const commit = vi.fn(() => true);
    const annuncia = vi.fn();
    const c = completo(motore, () => [], commit, annuncia);
    const voce = await voceDiPulisci(c, () => []);
    voce.run();
    await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    const esito = await esegui({ strayPoints: true, unpaintedObjects: true, emptyTextPaths: true }, false);
    expect(esito.rifiuto).toBe("empty");
    expect(commit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(annuncia).toHaveBeenCalledWith("Pulisci…: non c’era niente da cambiare."));
    finestre.chiudi.splice(0).forEach((chiudi) => chiudi(false));
    c.chiudi();
  });
});
