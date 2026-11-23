// @vitest-environment happy-dom
// Un comando che il motore rifiuta per gli argomenti (`bad_args`), dal Completo vero: la sua frase
// arriva alla persona, la cronologia non prende niente e il disegno resta modificabile (il comando
// dopo va). Il motore e la finestra sono finti; la sessione che trasforma il `bad_args` dell'host
// nella risposta tipizzata è in `motore/sessione.test.ts`.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { ArgomentiRifiutati, SessioneMotore } from "../motore/sessione";
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

const ESITO = { revision: "1", preview: null, ops: '[{"op":"meta","title":"x"}]', selection: ["k1"], losses: [], refused: null, frame: null };
const FRASE = "Il tracciato «k1» non ha il punto 99.";
const RIFIUTO: ArgomentiRifiutati = { kind: "argomenti", message: FRASE };

/// Il Completo con l'indice vero, la famiglia `tracciati` e un motore che risponde `ESITO`.
function completo() {
  const comando = vi.fn((_passo: unknown): Promise<unknown> => Promise.resolve(ESITO));
  const comandi = vi.fn(() => Promise.resolve([]));
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  const tasti = {
    selezione: () => ["k1"],
    annuncia: vi.fn((_frase: string) => undefined),
    leggi: vi.fn((ops: string | null): unknown => (ops === null ? null : JSON.parse(ops))),
    commit: vi.fn((_ops: unknown, _nome: string) => true),
    seleziona: vi.fn(),
  };
  const c = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: { "./famiglie/tracciati/index.ts": () => import("./famiglie/tracciati/index") },
      tasti,
    } as never,
  );
  return { c, comando, tasti };
}

/// Lancia la voce `etichetta` dalla ricerca, con `k1` scelto.
async function lancia(c: ReturnType<typeof completo>["c"], etichetta: string): Promise<void> {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  const voci = await c.ricerca(() => ["k1"], azioni);
  const voce = voci?.find((una) => una.label === etichetta);
  expect(voce, etichetta).toBeDefined();
  voce!.run();
}

describe("argomenti rifiutati dal motore, dal Completo", () => {
  it("un comando senza finestra: si sente la frase italiana del motore, niente alla cronologia, e il comando dopo va", async () => {
    const { c, comando, tasti } = completo();
    comando.mockResolvedValueOnce(RIFIUTO);
    await lancia(c, "Chiudi tracciato");
    await vi.waitFor(() => expect(tasti.annuncia).toHaveBeenCalledWith(FRASE));
    expect(tasti.commit).not.toHaveBeenCalled();
    await lancia(c, "Chiudi tracciato");
    await vi.waitFor(() => expect(tasti.commit).toHaveBeenCalledTimes(1));
    expect(comando).toHaveBeenCalledTimes(2);
    c.chiudi();
  });

  it("dalla finestra di Espandi…: la frase torna alla finestra, niente alla cronologia, e OK dopo va", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c, comando, tasti } = completo();
    await lancia(c, "Espandi…");
    await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
    const esegui = vi.mocked(apriFinestra).mock.calls[0]![2];
    comando.mockResolvedValueOnce(RIFIUTO);
    expect(await esegui({ object: true, fill: true, stroke: true }, false)).toEqual({ anteprima: null, rifiuto: null, argomenti: FRASE });
    expect(tasti.commit).not.toHaveBeenCalled();
    expect(await esegui({ object: true, fill: true, stroke: true }, false)).toEqual({ anteprima: null, rifiuto: null });
    expect(tasti.commit).toHaveBeenCalledTimes(1);
    c.chiudi();
  });
});
