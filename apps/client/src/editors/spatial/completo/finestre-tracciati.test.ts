// @vitest-environment happy-dom
// Le finestre di Oggetto › Tracciato (piano K6, T12, giro 3), dal Completo vero
// fino alla finestra di T6: le parole della famiglia `tracciati` (frase, verbo,
// scelte, unità, il massimo dello schema), l'anteprima che va sul foglio e non
// alla cronologia, una richiesta al motore per valore preso e non per tasto,
// Annulla che non manda niente e OK che manda una volta sola. Motore ed editor
// sono finti: il file non cambia se il comando non va alla cronologia.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingOutcome, DrawingPreview } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { INTERVALLO_ANTEPRIMA_MS } from "../motore/finestre";
import type { Op } from "../scene/ops";
import { TESTI } from "./famiglie/tracciati/testi";
import { apri, type OpzioniTastiCompleto } from "./index";
import { indiceDi, type VoceIndice } from "./indice";

const vite: Lifetime[] = [];
afterEach(() => {
  for (const life of vite.splice(0)) life.close();
  document.body.replaceChildren();
});
function vita(): Lifetime {
  const life = openLifetime();
  vite.push(life);
  return life;
}

/// Il comando di Sposta tracciato.
const COMANDO = "disegno.object.path.offsetPath";

/// Sposta tracciato, come lo scrive l'indice generato.
const SPOSTA: VoceIndice = {
  fonte: "motore",
  id: "object.path.offsetPath",
  chiamata: { comando: COMANDO },
  etichetta: { it: "Sposta tracciato…", en: "Offset Path…" },
  posto: "menu/oggetto/tracciato",
  famiglia: "tracciati",
  tasto: null,
  effetto: "cambia",
  finestra: true,
};

/// L'anteprima del motore: i contorni nuovi, nessuna operazione.
const ANTEPRIMA = {
  overlays: [{ kind: "path", d: "M0 0 L10 0", role: "preview", width: 1, dash: null }],
} as unknown as DrawingPreview;

const esito = (anteprima: boolean): DrawingOutcome =>
  ({
    revision: "1",
    preview: anteprima ? ANTEPRIMA : null,
    ops: anteprima ? null : "[]",
    selection: ["k1"],
    losses: [],
    refused: null,
    frame: null,
  }) as unknown as DrawingOutcome;

interface Richiesta {
  readonly id: string;
  readonly value: Readonly<Record<string, unknown>>;
  readonly preview: boolean;
}

function prepara() {
  const richieste: Richiesta[] = [];
  const comando = vi.fn((richiesta: Richiesta) => {
    richieste.push(richiesta);
    return Promise.resolve(esito(richiesta.preview));
  });
  const comandi = vi.fn(() => Promise.resolve([{ id: COMANDO, enabled: true, disabled_reason: null }]));
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  const radice = document.createElement("div");
  document.body.append(radice);
  const commit = vi.fn(() => true);
  const anteprima = vi.fn();
  const tasti: OpzioniTastiCompleto = {
    radice,
    selezione: () => ["k1"],
    anteprima,
    stato: () => ({ vuoleTesto: false, componendo: false }),
    leggi: () => [{ op: "remove", target: "k1" }] as unknown as readonly Op[],
    commit,
    annuncia: vi.fn(),
    seleziona: vi.fn(),
    piattaforma: "other",
  };
  const completo = apri(
    { motore, life: vita() },
    {
      indice: () => Promise.resolve(indiceDi({ voci: [SPOSTA] })),
      prepara: () => Promise.resolve("pronta"),
      // Le parole vere della famiglia, senza il resto del suo chunk.
      moduli: { "./famiglie/tracciati/index.ts": () => Promise.resolve({ default: { registra: () => undefined, testi: TESTI } }) },
      tasti,
    },
  );
  return { completo, richieste, commit, anteprima };
}

const AZIONI = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
const dialogo = (): HTMLElement | null => document.querySelector<HTMLElement>(".kit-dialog.draw-effect-dialog");
const pulsante = (azione: string): HTMLButtonElement => dialogo()!.querySelector<HTMLButtonElement>(`[data-action="${azione}"]`)!;
const numeri = (): HTMLInputElement[] => [...dialogo()!.querySelectorAll<HTMLInputElement>(".kit-number-input")];
const attendi = (ms: number): Promise<void> => new Promise((fatto) => setTimeout(fatto, ms));

/// Apre Sposta tracciato da Ctrl+/ e aspetta la prima anteprima.
async function apriSposta() {
  const prova = prepara();
  const righe = await prova.completo.ricerca(() => ["k1"], AZIONI);
  righe?.find((riga) => riga.key === SPOSTA.id)?.run();
  await vi.waitFor(() => expect(prova.richieste).toHaveLength(1));
  await vi.waitFor(() => expect(prova.anteprima).toHaveBeenCalledWith(ANTEPRIMA));
  return prova;
}

describe("le finestre dei tracciati", () => {
  it("Sposta tracciato ha le parole del prototipo, le scelte, le unità e i limiti dello schema", async () => {
    await apriSposta();
    const testo = dialogo()!.textContent ?? "";
    expect(dialogo()!.querySelector(".kit-dialog-description")?.textContent).toBe(
      "Un tracciato nuovo, parallelo a quello scelto, alla distanza che scrivi. Un numero negativo lo porta dentro.",
    );
    expect(pulsante("ok").textContent).toBe("Sposta");
    for (const parola of ["Spostamento", "Giunzioni", "Limite angolo vivo", "Angolo vivo", "Arrotondato", "Smussato", "px", "×"]) {
      expect(testo).toContain(parola);
    }
    // Nessun nome grezzo del motore.
    for (const grezzo of ["offset", "miterLimit", "joins", "miter", "bevel"]) expect(testo).not.toContain(grezzo);
    expect(numeri()[0]!.getAttribute("aria-valuemax")).toBe("100000");
    expect(numeri()[1]!.getAttribute("aria-valuemin")).toBe("1");
    expect(numeri()[1]!.getAttribute("aria-valuemax")).toBe("500");
  });

  it("l'anteprima va sul foglio con i valori di partenza, e non alla cronologia", async () => {
    const { richieste, commit } = await apriSposta();
    expect(richieste[0]).toMatchObject({ id: COMANDO, preview: true, value: { offset: 10, joins: "miter", miterLimit: 4 } });
    expect(commit).not.toHaveBeenCalled();
  });

  it("una richiesta per valore preso, non per tasto", async () => {
    const { richieste, commit } = await apriSposta();
    const campo = numeri()[0]!;
    for (const scritto of ["1", "12", "12.5"]) {
      campo.value = scritto;
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await attendi(INTERVALLO_ANTEPRIMA_MS * 2);
    expect(richieste).toHaveLength(1);
    campo.dispatchEvent(new FocusEvent("blur"));
    await vi.waitFor(() => expect(richieste).toHaveLength(2));
    await attendi(INTERVALLO_ANTEPRIMA_MS * 2);
    expect(richieste).toHaveLength(2);
    expect(richieste[1]).toMatchObject({ preview: true, value: { offset: 12.5 } });
    expect(commit).not.toHaveBeenCalled();
  });

  it("Annulla non manda il comando, non tocca la cronologia e toglie l'anteprima dal foglio", async () => {
    const { richieste, commit, anteprima } = await apriSposta();
    pulsante("cancel").click();
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    await attendi(INTERVALLO_ANTEPRIMA_MS * 2);
    expect(richieste.filter((richiesta) => !richiesta.preview)).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();
    expect(anteprima).toHaveBeenLastCalledWith(null);
  });

  it("OK manda il comando una volta sola, senza anteprima, e va alla cronologia in un passo", async () => {
    const { richieste, commit, anteprima } = await apriSposta();
    pulsante("ok").click();
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const mandati = richieste.filter((richiesta) => !richiesta.preview);
    expect(mandati).toHaveLength(1);
    expect(mandati[0]).toMatchObject({ value: { offset: 10, joins: "miter", miterLimit: 4 } });
    expect(anteprima).toHaveBeenLastCalledWith(null);
  });
});
