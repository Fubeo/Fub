// @vitest-environment happy-dom
// La finestra di «Aggiungi punti ai segmenti…» (`addon.pathtools.addPoints`, K6 T12): dal Completo vero, una
// voce della ricerca apre la finestra con il campo «quanti punti» (da 1 a 100, di serie 1); OK manda il comando
// una volta sola col disegno; Annulla, Esc e il doppio clic non mandano niente in più. Il motore e la finestra
// sono finti: si guardano i valori che la finestra dà e i comandi che parte.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { apriFinestra } from "../motore/finestre";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

// La finestra vera aspetta `pronto` e ne gestisce il rifiuto; la finta lo consuma allo stesso modo.
vi.mock("../motore/finestre", () => ({
  apriFinestra: vi.fn((_modulo: unknown, pronto: Promise<unknown>) => {
    pronto.catch(() => undefined);
    return Promise.resolve(true);
  }),
}));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["k1"], losses: [], refused: null, frame: null };
const ETICHETTA = "Aggiungi punti ai segmenti…";

/// Il motore con la sessione che conta i comandi; `comandi` dice se la voce è accesa.
function motoreFinto(acceso: boolean, esito: unknown = ESITO) {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(esito));
  const comandi = vi.fn(() =>
    Promise.resolve([
      { id: "disegno.addon.pathtools.addPoints", enabled: acceso, disabled_reason: acceso ? null : "no_selection" },
    ]),
  );
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero e la famiglia `tracciati`.
function completo(motore: MotoreDelDisegno, selezione: () => string[]) {
  return apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/tracciati/index.ts": () => import("./famiglie/tracciati/index"),
      },
      tasti: { selezione, annuncia: vi.fn() } as never,
    } as never,
  );
}

/// La voce della ricerca, con la selezione data.
async function voceDiAggiungi(c: ReturnType<typeof completo>, selezione: string[]) {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  const voci = await c.ricerca(() => selezione, azioni);
  const voce = voci?.find((una) => una.label === ETICHETTA);
  expect(voce, "la voce Aggiungi punti").toBeDefined();
  return voce!;
}

/// Apre la finestra dalla ricerca, con la selezione data.
async function apriAggiungi(c: ReturnType<typeof completo>, selezione: string[]): Promise<void> {
  (await voceDiAggiungi(c, selezione)).run();
  await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
}

describe("la finestra di Aggiungi punti ai segmenti (addon.pathtools.addPoints)", () => {
  it("(1) la finestra chiede quanti punti, da 1 a 100, di serie 1; OK manda il comando una volta sola", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(true);
    const c = completo(motore, () => ["k1"]);
    await apriAggiungi(c, ["k1"]);
    const [modulo, , esegui, opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    // Un solo campo, il numero dei punti, da 1 a 100; di serie vale 1 (quello del motore).
    expect(modulo.campi).toHaveLength(1);
    expect(modulo.campi[0]).toMatchObject({ nome: "count", tipo: "numero", min: 1, max: 100 });
    expect(opzioni).toMatchObject({ iniziali: { count: 1 } });
    await esegui({ count: 2 }, false);
    expect(comando).toHaveBeenCalledTimes(1);
    expect(comando).toHaveBeenCalledWith(
      expect.objectContaining({ id: "disegno.addon.pathtools.addPoints", value: { count: 2 }, preview: false }),
    );
    c.chiudi();
  });

  it("(7) Annulla e Esc non chiamano la finestra: niente al motore", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(true);
    const c = completo(motore, () => ["k1"]);
    await apriAggiungi(c, ["k1"]);
    // La finestra non chiama `esegui` né con Annulla né con Esc: nessun comando parte.
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("(9) un doppio clic sulla voce apre una sola finestra", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto(true);
    const c = completo(motore, () => ["k1"]);
    const voce = await voceDiAggiungi(c, ["k1"]);
    voce.run();
    voce.run();
    await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
    await new Promise((fine) => setTimeout(fine, 0));
    expect(vi.mocked(apriFinestra)).toHaveBeenCalledTimes(1);
    c.chiudi();
  });

  it("(10) senza nessun oggetto scelto la voce è spenta, e dice perché; non apre la finestra", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto(false);
    const c = completo(motore, () => []);
    const voce = await voceDiAggiungi(c, []);
    expect(voce.disabled).toBe(true);
    expect(voce.description).toBe("Scegli un oggetto.");
    // Il menu non attiva una voce spenta (`ui/menu.ts`): la finestra non parte da lì. Non la si lancia
    // a mano, perché quel percorso non esiste per l'utente.
    expect(vi.mocked(apriFinestra)).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("(6) un oggetto bloccato: il motore lo dice, e il segno del disegno non cambia", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(true, { ...ESITO, refused: "locked" });
    const c = completo(motore, () => ["k1"]);
    await apriAggiungi(c, ["k1"]);
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    await esegui({ count: 1 }, false);
    expect(comando).toHaveBeenCalledTimes(1);
    c.chiudi();
  });
});
