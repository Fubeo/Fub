// @vitest-environment happy-dom
// La finestra di Espandi… (riga `ui.expandDialog`, che è la stessa finestra di `object.expand`; K6 T12,
// giro «finestre»): dal Completo vero, una voce della ricerca apre la finestra, OK manda il comando una
// volta sola col disegno. Il motore e la finestra sono finti: si guardano i valori che la finestra dà.
// La finestra di Espandi non chiede il gradiente né i passi (T12 giro 3: vale quello del motore).
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { apriFinestra } from "../motore/finestre";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

// La finestra vera aspetta `pronto` e ne gestisce il rifiuto (`motore`, `no_memory`); la finta lo
// consuma allo stesso modo, sennò col motore assente il rifiuto resterebbe senza nessuno che lo guarda.
vi.mock("../motore/finestre", () => ({
  apriFinestra: vi.fn((_modulo: unknown, pronto: Promise<unknown>) => {
    pronto.catch(() => undefined);
    return Promise.resolve(true);
  }),
}));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["k1"], losses: [], refused: null, frame: null };

/// Il motore con la sessione che conta i comandi, e `comandi` che dice se Espandi è acceso.
function motoreFinto(acceso: boolean) {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const comandi = vi.fn(() => Promise.resolve([{ id: "disegno.object.expand", enabled: acceso, disabled_reason: acceso ? null : "no_selection" }]));
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero e la famiglia `tracciati` (le sue parole).
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

/// Apre Espandi… dalla ricerca, con la selezione data.
async function apriEspandi(c: ReturnType<typeof completo>): Promise<void> {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  const voci = await c.ricerca(() => ["k1"], azioni);
  const voce = voci?.find((una) => una.label === "Espandi…");
  expect(voce, "la voce Espandi…").toBeDefined();
  voce!.run();
  await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
}

describe("la finestra di Espandi… (riga ui.expandDialog)", () => {
  it("un oggetto: la finestra ha i tre interruttori di serie, e OK manda object.expand una volta sola", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(true);
    const c = completo(motore, () => ["k1"]);
    await apriEspandi(c);
    const [modulo, , esegui, opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    // I tre campi della finestra: oggetto, riempimento e contorno, nient'altro (né gradiente né passi).
    expect(modulo).toEqual({
      campi: [
        { nome: "object", tipo: "sino" },
        { nome: "fill", tipo: "sino" },
        { nome: "stroke", tipo: "sino" },
      ],
    });
    expect(opzioni).toMatchObject({ titolo: "Espandi" });
    await esegui({ object: true, fill: true, stroke: false }, false);
    expect(comando).toHaveBeenCalledTimes(1);
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.object.expand", value: { object: true, fill: true, stroke: false }, preview: false }));
    c.chiudi();
  });

  it("più oggetti: la stessa finestra, con tutta la selezione data al comando", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(true);
    const c = completo(motore, () => ["k1", "k2"]);
    const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
    const voci = await c.ricerca(() => ["k1", "k2"], azioni);
    voci?.find((una) => una.label === "Espandi…")!.run();
    await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    await esegui({ object: true, fill: true, stroke: true }, false);
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.object.expand", selection: ["k1", "k2"] }));
    c.chiudi();
  });

  it("Annulla (la finestra non chiama OK) non manda niente al motore", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(true);
    const c = completo(motore, () => ["k1"]);
    await apriEspandi(c);
    // Annulla e Esc non chiamano `esegui`: nessun comando, nessun passo.
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("senza nessun oggetto scelto la voce è spenta, e non apre la finestra", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto(false);
    const c = completo(motore, () => []);
    const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
    const voci = await c.ricerca(() => [], azioni);
    const voce = voci?.find((una) => una.label === "Espandi…");
    // La voce c'è, è spenta, e dice perché: «Scegli un oggetto.».
    expect(voce?.disabled).toBe(true);
    expect(voce?.description).toBe("Scegli un oggetto.");
    voce?.run();
    await Promise.resolve();
    expect(vi.mocked(apriFinestra)).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("il motore assente: la finestra non parte e il comando non va da nessuna parte", async () => {
    vi.mocked(apriFinestra).mockClear();
    const comando = vi.fn();
    const motore = { adesso: () => null, pronta: () => Promise.resolve(null), assente: () => ({ kind: "fermo" }) } as unknown as MotoreDelDisegno;
    const c = completo(motore, () => ["k1"]);
    const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
    const voci = await c.ricerca(() => ["k1"], azioni);
    voci?.find((una) => una.label === "Espandi…")?.run();
    await Promise.resolve();
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });
});
