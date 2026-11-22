// @vitest-environment happy-dom
// Le finestre di Modifica › Modifica colori (K6 T14, giro 1) dal percorso vero del Completo:
// `ui.saturateDialog` (Satura…) e `ui.colorBalanceDialog` (Regola bilanciamento colore…) aprono
// la finestra con anteprima del kit, con il titolo, il verbo, i campi, le unità e i limiti che
// vengono dall'indice e dalla famiglia; l'anteprima manda il comando con `preview`, OK una volta
// sola. Sovrastampa nero ha la sua finestra scritta, senza campi grezzi. Con un oggetto bloccato
// o un tratto dell'Inchiostro scelto le voci sono spente e dicono perché.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import { apriFinestra } from "../motore/finestre";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { statoVoce, testoPerche, type StatoComandi } from "./comandi";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["oa1a1a1a1"], losses: [], refused: null, frame: null };

function motoreFinto() {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero e la famiglia `colore` vera (con le sue parole) spiata.
function completo() {
  const caricati: string[] = [];
  const { motore, comando } = motoreFinto();
  const c = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/colore/index.ts": () => {
          caricati.push("colore");
          return import("./famiglie/colore/index");
        },
      },
      tasti: { selezione: () => ["oa1a1a1a1"], annuncia: vi.fn() } as never,
    } as never,
  );
  return { c, caricati, comando };
}

async function apriVoce(c: ReturnType<typeof completo>["c"], etichetta: string): Promise<void> {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  const voci = await c.ricerca(() => ["oa1a1a1a1"], azioni);
  const voce = voci?.find((una) => una.label === etichetta);
  expect(voce, etichetta).toBeDefined();
  voce!.run();
  await vi.waitFor(() => expect(vi.mocked(apriFinestra)).toHaveBeenCalled());
}

describe("le finestre di Modifica colori dal Completo", () => {
  it("ui.saturateDialog: Satura… ha l'intensità in %, da -100 a 100; l'anteprima e OK mandano il valore", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c, caricati, comando } = completo();
    expect(caricati).toEqual([]);
    await apriVoce(c, "Satura…");
    expect(caricati).toEqual(["colore"]);
    const [modulo, , esegui, opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(modulo).toEqual({ campi: [{ nome: "intensity", tipo: "numero", min: -100, max: 100 }] });
    expect(opzioni).toMatchObject({ titolo: "Satura", azione: "Satura", unita: { intensity: "%" }, campi: { intensity: "Intensità" }, iniziali: { intensity: 0 } });
    expect(opzioni.descrizione).toContain("grigio");
    // L'anteprima: il comando va con `preview`, e non è un passo della cronologia.
    await esegui({ intensity: 40 }, true);
    expect(comando).toHaveBeenLastCalledWith(expect.objectContaining({ id: "disegno.edit.colors.saturate", value: { intensity: 40 }, preview: true }));
    await esegui({ intensity: 40 }, false);
    expect(comando).toHaveBeenCalledTimes(2);
    expect(comando).toHaveBeenLastCalledWith(expect.objectContaining({ id: "disegno.edit.colors.saturate", value: { intensity: 40 }, preview: false }));
    c.chiudi();
  });

  it("ui.colorBalanceDialog: Regola bilanciamento colore… ha rosso, verde e blu in %, e riempimento e contorno", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c, comando } = completo();
    await apriVoce(c, "Regola bilanciamento colore…");
    const [modulo, , esegui, opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(modulo).toEqual({
      campi: [
        { nome: "r", tipo: "numero", min: -100, max: 100 },
        { nome: "g", tipo: "numero", min: -100, max: 100 },
        { nome: "b", tipo: "numero", min: -100, max: 100 },
        { nome: "fill", tipo: "sino" },
        { nome: "stroke", tipo: "sino" },
      ],
    });
    expect(opzioni).toMatchObject({
      titolo: "Regola bilanciamento colore",
      azione: "Regola",
      unita: { r: "%", g: "%", b: "%" },
      campi: { r: "Rosso", g: "Verde", b: "Blu", fill: "Riempimento", stroke: "Contorno" },
      iniziali: { r: 0, g: 0, b: 0, fill: true, stroke: true },
    });
    await esegui({ r: 20, g: 0, b: -10, fill: true, stroke: false }, false);
    expect(comando).toHaveBeenCalledTimes(1);
    expect(comando).toHaveBeenCalledWith(
      expect.objectContaining({ id: "disegno.edit.colors.adjustBalance", value: { r: 20, g: 0, b: -10, fill: true, stroke: false }, preview: false }),
    );
    c.chiudi();
  });

  it("Sovrastampa nero… ha la sua finestra scritta, con le parole della famiglia", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { c } = completo();
    await apriVoce(c, "Sovrastampa nero…");
    const [modulo, , , opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(modulo.campi.map((campo) => campo.nome)).toEqual([
      "remove",
      "percentage",
      "fill",
      "stroke",
      "includeCmyBlacks",
      "includeSpotBlacks",
    ]);
    expect(opzioni).toMatchObject({ azione: "Applica", unita: { percentage: "%" }, iniziali: { percentage: 100, remove: false } });
    c.chiudi();
  });

  it("con un oggetto bloccato o un tratto dell'Inchiostro le voci di Modifica colori sono spente e dicono perché", () => {
    const indice = indiceDi(indiceGenerato as never);
    const voci = indice.voci.filter((voce) => voce.posto === "menu/modifica/colori");
    expect(voci).toHaveLength(10);
    for (const motivo of ["read_only", "fub_ink"] as const) {
      const stato: StatoComandi = {
        per: new Map(voci.map((voce) => {
          const id = (voce.chiamata as { comando: string }).comando;
          return [id, { id, enabled: false, disabled_reason: motivo }] as const;
        })) as never,
        assente: null,
      };
      for (const voce of voci) expect(statoVoce(voce, stato), voce.id).toEqual({ disabled: true, perche: testoPerche(motivo) });
    }
    expect(testoPerche("fub_ink")).toBe("Un tratto dell'Inchiostro di Fub non si cambia da qui.");
  });
});
