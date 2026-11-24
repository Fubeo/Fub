// @vitest-environment happy-dom
// La finestra delle Opzioni spazi vuoti… (riga `ui.livePaintGapOptions`, la stessa finestra di
// `livePaint.gapOptions`): dal Completo vero, la voce apre la finestra coi campi di VectorCraft, che
// partono dalle opzioni del gruppo scelto (la lettura `livePaint.info`); OK manda il comando una
// volta sola. Il motore e la finestra sono finti: si guardano i valori che la finestra riceve e dà.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { apriFinestra } from "../motore/finestre";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

vi.mock("../motore/finestre", () => ({
  apriFinestra: vi.fn((_modulo: unknown, pronto: Promise<unknown>) => {
    pronto.catch(() => undefined);
    return Promise.resolve(true);
  }),
}));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["g1"], losses: [], refused: null, frame: null };

/// Il motore finto: `livePaint.info` legge le opzioni del gruppo (o non risponde), gli altri cambiano.
function motoreFinto(opzioni: unknown, acceso = true) {
  const comando = vi.fn((passo: { readonly id: string }) =>
    Promise.resolve(passo.id === "livePaint.info" ? (opzioni === undefined ? null : { ...ESITO, reading: { gapOptions: opzioni, gaps: [] } }) : ESITO),
  );
  const comandi = vi.fn(() => Promise.resolve([{ id: "disegno.livePaint.gapOptions", enabled: acceso, disabled_reason: acceso ? null : "needs_group" }]));
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

function completo(motore: MotoreDelDisegno, selezione: () => string[]) {
  return apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: { "./famiglie/trame/index.ts": () => import("./famiglie/trame/index") },
      tasti: { selezione, annuncia: vi.fn() } as never,
    } as never,
  );
}

async function apriSpazi(c: ReturnType<typeof completo>): Promise<void> {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  const voci = await c.ricerca(() => ["g1"], azioni);
  const voce = voci?.find((una) => una.label === "Opzioni spazi vuoti");
  expect(voce, "la voce Opzioni spazi vuoti").toBeDefined();
  voce!.run();
  await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
}

describe("la finestra delle Opzioni spazi vuoti… (riga ui.livePaintGapOptions)", () => {
  it("ha i campi di VectorCraft, con le parole italiane, e parte dalle opzioni del gruppo scelto", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto({ detect: true, size: 9, points: 9, color: "#00ff00" });
    const c = completo(motore, () => ["g1"]);
    await apriSpazi(c);
    const [modulo, , , opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(modulo.campi.map((campo) => campo.nome)).toEqual(["detect", "size", "points", "color", "closeGaps"]);
    expect(modulo).toMatchObject({ campi: [{ tipo: "sino" }, { tipo: "scelta", valori: ["small", "medium", "large", "custom"] }, { tipo: "numero" }, { tipo: "testo" }, { tipo: "sino" }] });
    expect(opzioni).toMatchObject({
      titolo: "Opzioni spazi vuoti",
      campi: { detect: "Rileva gli spazi vuoti", closeGaps: "Chiudi gli spazi con tracciati" },
      scelte: { size: { small: "Piccoli (3 pt)", custom: "Personalizzati" } },
      unita: { points: "pt" },
      iniziali: { detect: false, size: "small", points: 3, color: "#ff4f4f", closeGaps: false },
      // Una misura in punti è «personalizzata»; chiudere gli spazi è un'azione, sempre spenta.
      dalDisegno: { detect: true, size: "custom", points: 9, color: "#00ff00", closeGaps: false },
    });
    // La lettura è andata sul gruppo scelto, e nessun comando ha cambiato niente.
    expect(comando).toHaveBeenCalledTimes(1);
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "livePaint.info", selection: ["g1"] }));
    c.chiudi();
  });

  it("OK manda livePaint.gapOptions una volta sola, coi valori della finestra", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto({ detect: false, size: "small", points: 3, color: "#ff4f4f" });
    const c = completo(motore, () => ["g1"]);
    await apriSpazi(c);
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    const valori = { detect: true, size: "large", points: 3, color: "#0000ff", closeGaps: true };
    await esegui(valori, false);
    const cambi = comando.mock.calls.filter(([passo]) => passo.id.endsWith("livePaint.gapOptions"));
    expect(cambi).toHaveLength(1);
    expect(cambi[0]![0]).toMatchObject({ value: valori, selection: ["g1"], preview: false });
    c.chiudi();
  });

  it("se la lettura non risponde la finestra si apre lo stesso, coi valori di serie", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto(undefined);
    const c = completo(motore, () => ["g1"]);
    await apriSpazi(c);
    const [, , , opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(opzioni).not.toHaveProperty("dalDisegno");
    expect(opzioni).toMatchObject({ iniziali: { size: "small", closeGaps: false } });
    c.chiudi();
  });

  it("senza un gruppo della pittura dinamica la voce è spenta e non apre la finestra", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto(undefined, false);
    const c = completo(motore, () => ["k1"]);
    const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
    const voce = (await c.ricerca(() => ["k1"], azioni))?.find((una) => una.label === "Opzioni spazi vuoti");
    expect(voce?.disabled).toBe(true);
    voce?.run();
    await Promise.resolve();
    expect(vi.mocked(apriFinestra)).not.toHaveBeenCalled();
    c.chiudi();
  });
});
