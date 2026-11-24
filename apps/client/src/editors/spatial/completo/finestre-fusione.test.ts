// @vitest-environment happy-dom
// La finestra delle Opzioni fusione… (riga `ui.blendOptions`, la stessa finestra di
// `object.blend.options`): dal Completo vero, la voce apre la finestra coi campi di VectorCraft, che
// partono dalle opzioni della fusione scelta (la lettura `object.blend.info`); OK manda il comando una
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

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["f1"], losses: [], refused: null, frame: null };

/// Il motore finto: `object.blend.info` legge le opzioni (o non risponde), gli altri cambiano.
function motoreFinto(lettura: unknown) {
  const comando = vi.fn((passo: { readonly id: string }) =>
    Promise.resolve(passo.id === "object.blend.info" ? (lettura === undefined ? null : { ...ESITO, reading: lettura }) : ESITO),
  );
  const comandi = vi.fn(() => Promise.resolve([{ id: "disegno.object.blend.options", enabled: true, disabled_reason: null }]));
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
      moduli: { "./famiglie/dinamici/index.ts": () => import("./famiglie/dinamici/index") },
      tasti: { selezione, annuncia: vi.fn() } as never,
    } as never,
  );
}

async function apriOpzioni(c: ReturnType<typeof completo>, scelti: string[]): Promise<void> {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  const voci = await c.ricerca(() => scelti, azioni);
  const voce = voci?.find((una) => una.label === "Opzioni fusione…");
  expect(voce, "la voce Opzioni fusione").toBeDefined();
  voce!.run();
  await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
}

const DELLA_FUSIONE = {
  spacing: "steps",
  steps: 7,
  distance: 10,
  orientation: "path",
  target: "blend",
  id: "f1",
  easingType: "easeOut",
  ramp: 40,
  colorShift: -25,
  keys: ["a1", "b1"],
};

describe("la finestra delle Opzioni fusione… (riga ui.blendOptions)", () => {
  it("ha i campi di VectorCraft, con le parole italiane, e parte dalle opzioni della fusione scelta", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(DELLA_FUSIONE);
    const c = completo(motore, () => ["f1"]);
    await apriOpzioni(c, ["f1"]);
    const [modulo, , , opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(modulo.campi.map((campo) => campo.nome)).toEqual(["spacing", "steps", "distance", "orientation", "easingType", "ramp", "colorShift"]);
    expect(modulo).toMatchObject({
      campi: [
        { tipo: "scelta", valori: ["smooth", "steps", "distance"] },
        { tipo: "numero", min: 1, max: 1000 },
        { tipo: "numero" },
        { tipo: "scelta", valori: ["page", "path"] },
        { tipo: "scelta", valori: ["easeIn", "easeOut", "easeInOut", "easeOutIn"] },
        { tipo: "numero", min: 0, max: 100 },
        { tipo: "numero", min: -100, max: 100 },
      ],
    });
    expect(opzioni).toMatchObject({
      titolo: "Opzioni fusione",
      campi: { spacing: "Spaziatura", ramp: "Rampa", colorShift: "Spostamento colore" },
      scelte: { spacing: { smooth: "Colore uniforme" }, orientation: { path: "Allinea al tracciato" } },
      unita: { distance: "pt", ramp: "%" },
      iniziali: { spacing: "smooth", steps: 5, distance: 10, orientation: "page", easingType: "easeIn", ramp: 0, colorShift: 0 },
      dalDisegno: { spacing: "steps", steps: 7, distance: 10, orientation: "path", easingType: "easeOut", ramp: 40, colorShift: -25 },
    });
    expect(comando).toHaveBeenCalledTimes(1);
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "object.blend.info", selection: ["f1"] }));
    c.chiudi();
  });

  it("senza una fusione scelta parte da come nascono le fusioni nuove", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto({ spacing: "distance", steps: 5, distance: 24, orientation: "page", target: "defaults" });
    const c = completo(motore, () => []);
    await apriOpzioni(c, []);
    const [, , , opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(opzioni).toMatchObject({ dalDisegno: { spacing: "distance", steps: 5, distance: 24, orientation: "page" } });
    expect((opzioni as { dalDisegno: object }).dalDisegno).not.toHaveProperty("easingType");
    c.chiudi();
  });

  it("OK manda object.blend.options una volta sola, coi valori della finestra", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(DELLA_FUSIONE);
    const c = completo(motore, () => ["f1"]);
    await apriOpzioni(c, ["f1"]);
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    const valori = { spacing: "distance", steps: 5, distance: 12, orientation: "page", easingType: "easeInOut", ramp: 10, colorShift: 30 };
    await esegui(valori, false);
    const cambi = comando.mock.calls.filter(([passo]) => passo.id.endsWith("object.blend.options"));
    expect(cambi).toHaveLength(1);
    expect(cambi[0]![0]).toMatchObject({ value: valori, selection: ["f1"], preview: false });
    c.chiudi();
  });

  it("se la lettura non risponde la finestra si apre lo stesso, coi valori di serie", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore } = motoreFinto(undefined);
    const c = completo(motore, () => ["f1"]);
    await apriOpzioni(c, ["f1"]);
    const [, , , opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(opzioni).not.toHaveProperty("dalDisegno");
    expect(opzioni).toMatchObject({ iniziali: { spacing: "smooth", orientation: "page" } });
    c.chiudi();
  });
});
