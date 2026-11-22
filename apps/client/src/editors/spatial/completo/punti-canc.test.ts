// @vitest-environment happy-dom
// Canc sui punti scelti (piano K6, T12, punti): con dei punti scelti con la
// Selezione diretta, Canc toglie quei punti (`path.deleteAnchors`, coi punti
// nel `value`), non l'oggetto intero, e lo stato dello strumento si rilegge;
// senza punti `cancellaPunti` dice di no, e Canc resta quello dell'editor.
import { describe, expect, it, vi } from "vitest";
import type { DrawingAnchor } from "../../../host/contract";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { openLifetime } from "../../../ui/lifetime";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["p1"], losses: [], refused: null, frame: null };
const PUNTO: DrawingAnchor = { element: "p1", subpath: 0, anchor: 2, at: [330, 260], end: false };

function completoCon(punti: () => readonly DrawingAnchor[]) {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const comandi = vi.fn(() => Promise.resolve([{ id: "disegno.path.deleteAnchors", enabled: true, disabled_reason: null }]));
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  const rileggiStato = vi.fn();
  const commit = vi.fn(() => true);
  const completo = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: { "./famiglie/tracciati/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }) },
      tasti: {
        radice: document.createElement("div"),
        selezione: () => ["p1"],
        punti,
        rileggiStato,
        stato: () => ({ vuoleTesto: false, componendo: false }),
        leggi: () => [{ op: "set", target: "p1" }],
        commit,
        seleziona: () => undefined,
        annuncia: vi.fn(),
        anteprima: () => undefined,
        modifiche: () => ({}),
        piattaforma: "other",
      } as never,
    } as never,
  );
  return { completo, comando, rileggiStato, commit };
}

describe("Canc coi punti scelti", () => {
  it("toglie i punti scelti, non l'oggetto, in un passo, e rilegge lo stato dello strumento", async () => {
    const { completo, comando, rileggiStato, commit } = completoCon(() => [PUNTO]);
    expect(completo.cancellaPunti()).toBe(true);
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(comando.mock.calls[0]?.[0]).toMatchObject({ id: "disegno.path.deleteAnchors", value: { anchors: [PUNTO] } });
    await vi.waitFor(() => expect(rileggiStato).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledTimes(1);
    completo.chiudi();
  });

  it("senza punti scelti non fa niente, e Canc resta quello dell'editor", async () => {
    const { completo, comando } = completoCon(() => []);
    expect(completo.cancellaPunti()).toBe(false);
    await new Promise((risolto) => setTimeout(risolto, 0));
    expect(comando).not.toHaveBeenCalled();
    completo.chiudi();
    // Chiuso il Completo, nemmeno coi punti.
    const altro = completoCon(() => [PUNTO]);
    altro.completo.chiudi();
    expect(altro.completo.cancellaPunti()).toBe(false);
  });
});
