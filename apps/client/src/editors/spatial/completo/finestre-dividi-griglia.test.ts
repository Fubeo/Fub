// @vitest-environment happy-dom
// La finestra di Dividi in griglia… (`object.path.splitIntoGrid`, K6 T12): dal Completo vero, una voce
// della ricerca apre la finestra con righe, colonne e spaziatura; OK manda il comando una volta sola col
// disegno; Annulla e Esc non mandano niente. Il motore e la finestra sono finti: si guardano i valori
// che la finestra dà. La cornice che il motore disegna e gli errori stanno in `tracciati.json` (Rust).
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { apriFinestra } from "../motore/finestre";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";
import schemaTracciati from "./famiglie/tracciati/schema.generated.json";

// La finestra vera aspetta `pronto` e ne gestisce il rifiuto: la finta lo consuma allo stesso modo,
// così col motore assente il rifiuto non resta senza nessuno che lo guarda.
vi.mock("../motore/finestre", () => ({
  apriFinestra: vi.fn((_modulo: unknown, pronto: Promise<unknown>) => {
    pronto.catch(() => undefined);
    return Promise.resolve(true);
  }),
}));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["k1"], losses: [], refused: null, frame: null };

/// Il motore con la sessione che conta i comandi, e `comandi` che dice se la divisione è accesa.
function motoreFinto(acceso: boolean) {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const comandi = vi.fn(() =>
    Promise.resolve([{ id: "disegno.object.path.splitIntoGrid", enabled: acceso, disabled_reason: acceso ? null : "no_selection" }]),
  );
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

/// Apre Dividi in griglia… dalla ricerca, con la selezione data.
async function apriGriglia(c: ReturnType<typeof completo>, selezione: string[]): Promise<void> {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  const voci = await c.ricerca(() => selezione, azioni);
  const voce = voci?.find((una) => una.label === "Dividi in griglia…");
  expect(voce, "la voce Dividi in griglia…").toBeDefined();
  voce!.run();
  await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
}

describe("la finestra di Dividi in griglia… (object.path.splitIntoGrid)", () => {
  it("un oggetto: la finestra ha righe, colonne e spaziatura con i loro limiti, e OK manda il comando una volta sola", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(true);
    const c = completo(motore, () => ["k1"]);
    await apriGriglia(c, ["k1"]);
    const [modulo, , esegui, opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    // Solo i tre campi della griglia, numeri: nessuna guida, nessun'altra opzione.
    expect(modulo).toEqual({
      campi: [
        { nome: "rows", tipo: "numero", min: 1, max: 500 },
        { nome: "columns", tipo: "numero", min: 1, max: 500 },
        { nome: "gutter", tipo: "numero", min: 0, max: 1000000 },
      ],
    });
    // Limiti e predefiniti stanno nello schema generato dal catalogo (come per Dividi in trattini).
    const finestra = (schemaTracciati as { finestre: { id: string; campi: Array<Record<string, unknown>> }[] }).finestre.find(
      (f) => f.id === "object.path.splitIntoGrid",
    );
    expect(finestra?.campi).toEqual([
      expect.objectContaining({ nome: "rows", minimo: 1, massimo: 500, predefinito: 2 }),
      expect.objectContaining({ nome: "columns", minimo: 1, massimo: 500, predefinito: 2 }),
      expect.objectContaining({ nome: "gutter", minimo: 0, massimo: 1000000, predefinito: 12 }),
    ]);
    expect(opzioni).toMatchObject({ titolo: "Dividi in griglia" });
    await esegui({ rows: 2, columns: 3, gutter: 0 }, false);
    expect(comando).toHaveBeenCalledTimes(1);
    expect(comando).toHaveBeenCalledWith(
      expect.objectContaining({ id: "disegno.object.path.splitIntoGrid", value: { rows: 2, columns: 3, gutter: 0 }, preview: false }),
    );
    c.chiudi();
  });

  it("più oggetti: la stessa finestra, con tutta la selezione data al comando", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(true);
    const c = completo(motore, () => ["k1", "k2"]);
    await apriGriglia(c, ["k1", "k2"]);
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    await esegui({ rows: 2, columns: 2, gutter: 12 }, false);
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.object.path.splitIntoGrid", selection: ["k1", "k2"] }));
    c.chiudi();
  });

  it("i valori fuori misura li dice la finestra: il limite è quello del motore", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(true);
    const c = completo(motore, () => ["k1"]);
    await apriGriglia(c, ["k1"]);
    // Zero righe, colonne negative o una spaziatura negativa sono fuori dai limiti dello schema: la
    // finestra non le manda, e il motore non è toccato.
    const finestra = (schemaTracciati as { finestre: { id: string; campi: Array<Record<string, unknown>> }[] }).finestre.find(
      (f) => f.id === "object.path.splitIntoGrid",
    );
    expect(finestra?.campi.find((campo) => campo.nome === "rows")).toMatchObject({ minimo: 1 });
    expect(finestra?.campi.find((campo) => campo.nome === "columns")).toMatchObject({ minimo: 1 });
    expect(finestra?.campi.find((campo) => campo.nome === "gutter")).toMatchObject({ minimo: 0 });
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("Annulla (la finestra non chiama OK) non manda niente al motore", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(true);
    const c = completo(motore, () => ["k1"]);
    await apriGriglia(c, ["k1"]);
    // Annulla e Esc non chiamano `esegui`: nessun comando, nessun passo.
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("un doppio clic sulla voce apre una finestra sola", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto(true);
    const c = completo(motore, () => ["k1"]);
    const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
    const voci = await c.ricerca(() => ["k1"], azioni);
    const voce = voci?.find((una) => una.label === "Dividi in griglia…");
    voce?.run();
    voce?.run();
    await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
    await Promise.resolve();
    expect(vi.mocked(apriFinestra)).toHaveBeenCalledTimes(1);
    c.chiudi();
  });

  it("senza nessun oggetto scelto la voce è spenta, con «Scegli un oggetto.», e non apre la finestra", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto(false);
    const c = completo(motore, () => []);
    const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
    const voci = await c.ricerca(() => [], azioni);
    const voce = voci?.find((una) => una.label === "Dividi in griglia…");
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
    voci?.find((una) => una.label === "Dividi in griglia…")?.run();
    await Promise.resolve();
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });
});
