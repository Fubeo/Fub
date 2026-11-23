// @vitest-environment happy-dom
// I comandi di trasformazione che il giro T13 porta a «fatto» (`object.nudge`, Sposta leggermente, e
// `object.distort`, Distorsione libera): ogni voce dell'indice dice il comando del motore col prefisso
// `disegno.`, sta nel posto dell'ispettore Design, e quando la si sceglie dalla ricerca manda al motore
// quell'id e non un altro. Il percorso è quello vero: `ricerca()` del Completo, con lo stato del motore.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { apri } from "./index";
import { indiceDi, type VoceIndice } from "./indice";
import indiceGenerato from "./indice.generated.json";

/// I comandi di T13 (sposta e distorci), con l'etichetta italiana che l'indice porta.
const NUOVI = [
  { id: "object.nudge", etichetta: "Sposta leggermente" },
  { id: "object.distort", etichetta: "Distorsione libera" },
] as const;

/// La voce dell'indice di questo comando.
function voceDi(id: string): VoceIndice {
  const voce = (indiceGenerato as { voci: VoceIndice[] }).voci.find((v) => v.id === id);
  if (voce === undefined) throw new Error(`manca la voce ${id} nell'indice`);
  return voce;
}

/// Il motore: la preparazione della famiglia risponde «pronta»; gli altri comandi non rispondono (il
/// test guarda solo l'id mandato). Le chiamate restano nella spia.
function motoreFinto() {
  const comando = vi.fn((richiesta: { id: string }) =>
    Promise.resolve(
      richiesta.id === "disegno.famiglia.prepara"
        ? { refused: null, ops: null, reading: null, selection: [], preview: null, revision: 1 }
        : null,
    ),
  );
  const sessione = { comando, comandi: vi.fn(() => Promise.resolve([])) } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

const AZIONI = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };

describe("i comandi di trasformazione del giro T13 (sposta e distorci)", () => {
  for (const { id, etichetta } of NUOVI) {
    it(`${id} è nell'indice con il comando disegno.${id}, nel posto dell'ispettore Design e con l'etichetta italiana`, () => {
      const voce = voceDi(id);
      expect(voce.chiamata).toEqual({ comando: `disegno.${id}` });
      expect(voce.posto).toBe("ispettore/design");
      expect(voce.famiglia).toBe("trasforma");
      expect(voce.etichetta.it).toBe(etichetta);
      expect(voce.finestra).toBe(false);
    });

    it(`scegliere ${id} dalla ricerca manda al motore disegno.${id}, e nessun altro comando di questo giro`, async () => {
      const { motore, comando } = motoreFinto();
      const c = apri(
        { motore, life: openLifetime() } as never,
        {
          indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
          prepara: () => Promise.resolve("pronta"),
          moduli: { "./famiglie/trasforma/index.ts": () => import("./famiglie/trasforma/index") },
        } as never,
      );
      const righe = await c.ricerca(() => ["oa1a1a1a1", "ob2b2b2b2"], AZIONI);
      const riga = righe?.find((r) => r.key === id);
      expect(riga, `la ricerca trova ${id}`).toBeDefined();
      riga!.run();
      await vi.waitFor(() => expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: `disegno.${id}` })));
      const comandiDelGiro = comando.mock.calls
        .map(([richiesta]) => richiesta.id)
        .filter((x) => NUOVI.some((n) => x === `disegno.${n.id}`));
      expect(comandiDelGiro).toEqual([`disegno.${id}`]);
      c.chiudi();
    });
  }
});
