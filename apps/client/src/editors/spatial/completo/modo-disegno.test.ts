// @vitest-environment happy-dom
// «Modalità di disegno» (`view.drawMode`, piano K6, T11): la voce di ≡ › Visualizza apre la scelta
// Normale / Dietro, col segno sul modo che il motore ha accettato; Dentro è spenta col suo perché. Il
// motore è finto: conta i comandi e risponde come il vero (un rifiuto o un motore assente non cambiano
// il segno). Il comportamento di Normale e Dietro sul disegno è in `tests/modo_di_disegno.rs` (motore).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingOutcome } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { MenuItem } from "../../../ui/menu";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import type { Op } from "../scene/ops";
import type { OpzioniTastiCompleto } from "./index";
import { apri } from "./index";
import { indiceDi, type VoceIndice } from "./indice";

const vite: Lifetime[] = [];
afterEach(() => {
  for (const life of vite.splice(0)) life.close();
  for (const finestra of document.querySelectorAll('[role="dialog"]')) finestra.remove();
});
function vita(): Lifetime {
  const life = openLifetime();
  vite.push(life);
  return life;
}

/// Una voce del motore, come la scrive l'indice (la voce di Visualizza è `view.drawMode`).
function voceMotore(id: string, etichetta: string, posto: string, famiglia: string): VoceIndice {
  return {
    fonte: "motore",
    id,
    chiamata: { comando: `disegno.${id}` },
    etichetta: { it: etichetta, en: etichetta },
    posto,
    famiglia,
    tasto: null,
    effetto: "cambia",
    finestra: false,
  } as VoceIndice;
}

const VOCI: readonly VoceIndice[] = [
  voceMotore("view.drawMode", "Modalità di disegno", "menu/visualizza", "vista"),
  voceMotore("shape.rectangle", "Voce shape.rectangle", "menu/oggetto", "forme"),
];

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["k1"], losses: [], refused: null, frame: null } as unknown as DrawingOutcome;
const RIFIUTO = { ...ESITO, refused: "unsupported" } as unknown as DrawingOutcome;

/// Il motore finto: la sessione che risponde con `esito`, o niente se `assente`.
function motoreFinto(esito: DrawingOutcome = ESITO, assente = false) {
  const comando = vi.fn((_richiesta: unknown) => Promise.resolve(esito));
  const comandi = vi.fn(() =>
    Promise.resolve([
      { id: "disegno.view.drawMode", enabled: true, disabled_reason: null },
      { id: "disegno.shape.rectangle", enabled: true, disabled_reason: null },
    ]),
  );
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = {
    adesso: () => sessione,
    pronta: () => Promise.resolve(assente ? null : sessione),
    assente: () => null,
  } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// L'editor del disegno: le sue azioni, contate.
function editorFinto(radice: HTMLElement) {
  const tasti: OpzioniTastiCompleto = {
    radice,
    selezione: () => ["k1"],
    anteprima: vi.fn(),
    stato: () => ({ vuoleTesto: false, componendo: false }),
    leggi: () => [{ op: "remove", target: "k1" }] as unknown as readonly Op[],
    commit: vi.fn(() => true),
    annuncia: vi.fn(),
    seleziona: vi.fn(),
    piattaforma: "other",
  };
  return tasti;
}

/// Il Completo con l'indice `VOCI`, e le famiglie `forme` e `vista` pronte senza il loro chunk vero.
function completoCon(motore: MotoreDelDisegno) {
  const radice = document.createElement("div");
  document.body.append(radice);
  return apri(
    { motore, life: vita() },
    {
      indice: () => Promise.resolve(indiceDi({ voci: [...VOCI] })),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/forme/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }),
        "./famiglie/vista/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }),
      },
      tasti: editorFinto(radice),
    },
  );
}

const AZIONI = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };

/// La voce con quel nome, in un gruppo del menu.
function nelMenu(menu: readonly MenuItem[], nome: string): MenuItem {
  for (const gruppo of menu) {
    const hit = (typeof gruppo.items === "object" ? gruppo.items : []).find((item) => item.label === nome);
    if (hit !== undefined) return hit;
  }
  throw new Error(`manca la voce «${nome}»`);
}

/// Il dialogo della scelta aperto adesso, o `null`.
function scelta(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

/// Apre la voce dal menu e aspetta la scelta.
async function apriDalMenu(completo: ReturnType<typeof completoCon>): Promise<void> {
  const menu = await completo.menu(() => ["k1"], AZIONI);
  nelMenu(menu, "Modalità di disegno").run?.();
  await vi.waitFor(() => expect(scelta()).not.toBeNull());
}

/// Il pulsante della scelta con quella azione.
function pulsante(azione: "normal" | "behind" | "cancel"): HTMLButtonElement {
  const bottone = scelta()?.querySelector<HTMLButtonElement>(`[data-action="${azione}"]`);
  if (bottone === null || bottone === undefined) throw new Error(`manca il pulsante ${azione}`);
  return bottone;
}

/// Un giro di eventi: il comando e la sua risposta sono finiti.
const giro = () => new Promise((fine) => setTimeout(fine, 0));

describe("Modalità di disegno nel menu Visualizza (K6 T11)", () => {
  it("la voce apre la scelta con Normale attiva; Dentro è spenta col suo perché", async () => {
    const { motore } = motoreFinto();
    const completo = completoCon(motore);
    await apriDalMenu(completo);
    expect(pulsante("normal").textContent).toContain("(attiva)");
    expect(pulsante("behind").textContent).not.toContain("(attiva)");
    const dentro = scelta()?.querySelector<HTMLButtonElement>('[data-action="inside"]');
    expect(dentro?.disabled).toBe(true);
    expect(scelta()?.textContent).toContain("gruppo di ritaglio");
  });

  it("dalla ricerca e dal menu la voce «Modalità di disegno» c'è ed è accesa", async () => {
    const { motore } = motoreFinto();
    const completo = completoCon(motore);
    const righe = await completo.ricerca(() => ["k1"], AZIONI);
    const riga = righe?.find((one) => one.label === "Modalità di disegno");
    expect(riga, "la ricerca offre la voce").toBeDefined();
    expect(riga?.disabled).toBe(false);
    const menu = await completo.menu(() => ["k1"], AZIONI);
    expect(nelMenu(menu, "Modalità di disegno").disabled).toBeFalsy();
  });

  it("(1) Normale è il modo di partenza: scegliere Normale quando è attivo non manda niente", async () => {
    const { motore, comando } = motoreFinto();
    const completo = completoCon(motore);
    await apriDalMenu(completo);
    pulsante("normal").click();
    await giro();
    expect(comando).not.toHaveBeenCalled();
  });

  it("(2) Dietro manda {mode: \"behind\"} una volta, e la scelta dopo segna Dietro", async () => {
    const { motore, comando } = motoreFinto();
    const completo = completoCon(motore);
    await apriDalMenu(completo);
    pulsante("behind").click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(comando.mock.calls[0][0]).toMatchObject({ id: "disegno.view.drawMode", value: { mode: "behind" } });
    await giro();
    await apriDalMenu(completo);
    expect(pulsante("behind").textContent).toContain("(attiva)");
    expect(pulsante("normal").textContent).not.toContain("(attiva)");
  });

  it("(1) dopo Dietro, Normale torna a mandare il suo modo, e un rettangolo arriva al motore senza un argomento di modo", async () => {
    const { motore, comando } = motoreFinto();
    const completo = completoCon(motore);
    await apriDalMenu(completo);
    pulsante("behind").click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    await giro();
    await apriDalMenu(completo);
    pulsante("normal").click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(2));
    expect(comando.mock.calls[1][0]).toMatchObject({ value: { mode: "normal" } });
    await giro();
    const menu = await completo.menu(() => ["k1"], AZIONI);
    nelMenu(menu, "Voce shape.rectangle").run?.();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(3));
    const rettangolo = comando.mock.calls[2][0] as { readonly id: string; readonly value: Record<string, unknown> };
    expect(rettangolo.id).toBe("disegno.shape.rectangle");
    expect(rettangolo.value).not.toHaveProperty("mode");
  });

  it("(6) Annulla e Esc non cambiano niente: nessun comando, e il segno resta", async () => {
    const { motore, comando } = motoreFinto();
    const completo = completoCon(motore);
    await apriDalMenu(completo);
    pulsante("cancel").click();
    await giro();
    await apriDalMenu(completo);
    scelta()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await giro();
    expect(comando).not.toHaveBeenCalled();
  });

  it("(7) un doppio clic su Dietro manda un solo passo", async () => {
    const { motore, comando } = motoreFinto();
    const completo = completoCon(motore);
    await apriDalMenu(completo);
    const dietro = pulsante("behind");
    dietro.click();
    dietro.click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    await giro();
    expect(comando).toHaveBeenCalledTimes(1);
  });

  it("un rifiuto del motore non cambia il segno", async () => {
    const { motore, comando } = motoreFinto(RIFIUTO);
    const completo = completoCon(motore);
    await apriDalMenu(completo);
    pulsante("behind").click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    await giro();
    await apriDalMenu(completo);
    expect(pulsante("normal").textContent).toContain("(attiva)");
  });

  it("con il motore assente il segno non cambia", async () => {
    const { motore, comando } = motoreFinto(ESITO, true);
    const completo = completoCon(motore);
    await apriDalMenu(completo);
    pulsante("behind").click();
    await giro();
    expect(comando).not.toHaveBeenCalled();
    await apriDalMenu(completo);
    expect(pulsante("normal").textContent).toContain("(attiva)");
  });

  it("(5) riaprendo il Completo il segno torna su Normale, anche se il motore era su Dietro", async () => {
    const { motore, comando } = motoreFinto();
    const prima = completoCon(motore);
    await apriDalMenu(prima);
    pulsante("behind").click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    await giro();
    const dopo = completoCon(motore);
    await apriDalMenu(dopo);
    expect(pulsante("normal").textContent).toContain("(attiva)");
  });
});
