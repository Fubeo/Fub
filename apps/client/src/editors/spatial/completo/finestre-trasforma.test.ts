// @vitest-environment happy-dom
// Le finestre con anteprima delle trasformazioni (K6 T13, giro 3) dal percorso vero del
// Completo: una voce della ricerca (Ctrl+/) apre la sua finestra, con il titolo, il verbo del
// pulsante, le scelte, le unità e i limiti che vengono dall'indice e dalla famiglia; OK manda il
// comando al motore con i valori della finestra, una volta sola. La famiglia non si carica prima.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import { apriFinestra } from "../motore/finestre";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["oa1a1a1a1"], losses: [], refused: null, frame: null };

/// Il motore con la sessione che conta i comandi: `comando` riceve `{ id, selection, value, preview }`.
function motoreFinto() {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero, la famiglia `trasforma` vera (con le sue parole) spiata, e la
/// ricerca che porta alle voci dei comandi. La selezione è un rettangolo.
function completo() {
  const caricati: string[] = [];
  const { motore, comando } = motoreFinto();
  const annuncia = vi.fn();
  const c = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/trasforma/index.ts": () => {
          caricati.push("trasforma");
          return import("./famiglie/trasforma/index.ts");
        },
      },
      tasti: { selezione: () => ["oa1a1a1a1"], annuncia } as never,
    } as never,
  );
  return { c, caricati, comando };
}

/// La voce della ricerca con questa etichetta, eseguita: la finestra si apre.
async function apriVoce(c: ReturnType<typeof completo>["c"], etichetta: string): Promise<void> {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  const voci = await c.ricerca(() => ["oa1a1a1a1"], azioni);
  const voce = voci?.find((una) => una.label === etichetta);
  expect(voce, etichetta).toBeDefined();
  voce!.run();
  await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
}

describe("le finestre di trasformazione dal Completo", () => {
  it("Scala: il titolo, il verbo, l'unità e il limite vengono dal catalogo; OK manda il valore una volta sola", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c, caricati, comando } = completo();
    expect(caricati).toEqual([]);
    await apriVoce(c, "Scala…");
    expect(caricati).toEqual(["trasforma"]);
    const [modulo, , esegui, opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(modulo).toEqual({ campi: [{ nome: "sx", tipo: "numero", min: 0.01, max: 10000 }] });
    expect(opzioni).toMatchObject({ titolo: "Scala", azione: "Scala", unita: { sx: "%" }, campi: { sx: "Scala" }, iniziali: { sx: 100 } });
    // OK: il motore riceve il valore della finestra, una volta sola.
    await esegui({ sx: 50 }, false);
    expect(comando).toHaveBeenCalledTimes(1);
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.object.scale", value: { sx: 50 }, preview: false }));
    c.chiudi();
  });

  it("Rifletti: l'asse è una scelta, con le sue parole; Sposta: due misure in pt, con il suo verbo", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c } = completo();
    await apriVoce(c, "Rifletti…");
    const [modulo, , , opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(modulo).toEqual({ campi: [{ nome: "axis", tipo: "scelta", valori: ["vertical", "horizontal"] }] });
    expect(opzioni).toMatchObject({ titolo: "Rifletti", azione: "Rifletti", scelte: { axis: { vertical: "Verticale", horizontal: "Orizzontale" } } });
    vi.mocked(apriFinestra).mockClear();
    await apriVoce(c, "Sposta…");
    const [spostaModulo, , , spostaOpzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(spostaModulo).toEqual({ campi: [{ nome: "dx", tipo: "numero" }, { nome: "dy", tipo: "numero" }] });
    expect(spostaOpzioni).toMatchObject({ titolo: "Sposta", azione: "Sposta", unita: { dx: "pt", dy: "pt" }, campi: { dx: "Orizzontale", dy: "Verticale" } });
    c.chiudi();
  });
});
