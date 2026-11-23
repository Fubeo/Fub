// @vitest-environment happy-dom
// Il modo di disegno nel menu Visualizza (piano K6, T11): «Disegna normale» e «Disegna dietro» mandano
// `view.drawMode` col loro modo, e il segno è il modo che il motore ha accettato; «Disegna dentro» è
// spenta con la sua frase. Il motore è finto: conta i comandi e risponde come il motore vero (un rifiuto
// non cambia il segno, e un motore assente lascia il segno dov'è). Le voci sono `view.drawNormal`,
// `view.drawBehind` e `view.drawInside` (le righe `interfaccia` della mappa).
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
});
function vita(): Lifetime {
  const life = openLifetime();
  vite.push(life);
  return life;
}

/// Una voce del motore, come la scrive l'indice.
function voceMotore(id: string, posto: string, famiglia: string): VoceIndice {
  return {
    fonte: "motore",
    id,
    chiamata: { comando: `disegno.${id}` },
    etichetta: { it: `Voce ${id}`, en: `Item ${id}` },
    posto,
    famiglia,
    tasto: null,
    effetto: "cambia",
    finestra: false,
  } as VoceIndice;
}

/// Una voce del client dell'editor (`interfaccia`): il menu la mostra, e la chiama il Completo.
function voceClient(id: string, it: string): VoceIndice {
  return {
    fonte: "interfaccia",
    id,
    chiamata: { client: id },
    etichetta: { it, en: it },
    posto: "menu/visualizza",
    famiglia: "vista",
    tasto: null,
    effetto: "mostra",
    finestra: false,
  } as VoceIndice;
}

/// Le voci del modo di disegno, come l'indice le dà al Completo.
const VOCI: readonly VoceIndice[] = [
  voceMotore("view.drawMode", "interno", "vista"),
  voceClient("view.drawNormal", "Disegna normale"),
  voceClient("view.drawBehind", "Disegna dietro"),
  voceClient("view.drawInside", "Disegna dentro"),
  voceMotore("shape.rectangle", "menu/oggetto", "forme"),
];

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["k1"], losses: [], refused: null, frame: null } as unknown as DrawingOutcome;
const RIFIUTO = { ...ESITO, refused: "unsupported" } as unknown as DrawingOutcome;

/// Il motore finto: la sessione che risponde con `esito` (o niente, se `assente`).
function motoreFinto(esito: DrawingOutcome = ESITO, assente = false) {
  const comando = vi.fn((_richiesta: unknown) => Promise.resolve(esito));
  const comandi = vi.fn(() => Promise.resolve([]));
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
  const commit = vi.fn(() => true);
  const annuncia = vi.fn();
  const tasti: OpzioniTastiCompleto = {
    radice,
    selezione: () => ["k1"],
    anteprima: vi.fn(),
    stato: () => ({ vuoleTesto: false, componendo: false }),
    leggi: () => [{ op: "remove", target: "k1" }] as unknown as readonly Op[],
    commit,
    annuncia,
    seleziona: vi.fn(),
    piattaforma: "other",
  };
  return { tasti, commit, annuncia };
}

/// Il Completo con l'indice `VOCI`, la famiglia pronta senza il suo chunk vero.
function completoCon(motore: MotoreDelDisegno, tasti: OpzioniTastiCompleto) {
  return apri(
    { motore, life: vita() },
    {
      indice: () => Promise.resolve(indiceDi({ voci: [...VOCI] })),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/forme/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }),
        "./famiglie/vista/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }),
      },
      tasti,
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

/// Il menu come lo vede adesso l'utente (il segno si rilegge a ogni apertura).
async function menuAdesso(completo: ReturnType<typeof completoCon>): Promise<readonly MenuItem[]> {
  return completo.menu(() => ["k1"], AZIONI);
}

describe("il modo di disegno del menu Visualizza (K6 T11)", () => {
  it("all'apertura il segno è su «Disegna normale», e «Disegna dentro» è spenta con la sua frase", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { motore } = motoreFinto();
    const completo = completoCon(motore, editorFinto(radice).tasti);
    const menu = await menuAdesso(completo);
    expect(nelMenu(menu, "Disegna normale").checked).toBe(true);
    expect(nelMenu(menu, "Disegna dietro").checked).toBe(false);
    const dentro = nelMenu(menu, "Disegna dentro");
    expect(dentro.disabled).toBe(true);
    expect(dentro.description).toContain("gruppo di ritaglio");
  });

  it("«Disegna dietro» manda il modo al motore, e il segno passa su di lei", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { motore, comando } = motoreFinto();
    const editor = editorFinto(radice);
    const completo = completoCon(motore, editor.tasti);
    const menu = await menuAdesso(completo);
    nelMenu(menu, "Disegna dietro").run?.();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(comando.mock.calls[0][0]).toMatchObject({ id: "disegno.view.drawMode", value: { mode: "behind" } });
    const dopo = await menuAdesso(completo);
    expect(nelMenu(dopo, "Disegna dietro").checked).toBe(true);
    expect(nelMenu(dopo, "Disegna normale").checked).toBe(false);
  });

  it("dopo «Disegna dietro», un rettangolo arriva al motore senza un argomento di modo: il modo è del motore", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { motore, comando } = motoreFinto();
    const editor = editorFinto(radice);
    const completo = completoCon(motore, editor.tasti);
    nelMenu(await menuAdesso(completo), "Disegna dietro").run?.();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    nelMenu(await menuAdesso(completo), "Voce shape.rectangle").run?.();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(2));
    const rettangolo = comando.mock.calls[1][0] as { readonly id: string; readonly value: Record<string, unknown> };
    expect(rettangolo.id).toBe("disegno.shape.rectangle");
    expect(rettangolo.value).not.toHaveProperty("mode");
  });

  it("«Disegna dentro» è spenta: non parte, e dice perché", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { motore, comando } = motoreFinto();
    const completo = completoCon(motore, editorFinto(radice).tasti);
    const dentro = nelMenu(await menuAdesso(completo), "Disegna dentro");
    expect(dentro.disabled).toBe(true);
    dentro.run?.();
    await new Promise((fine) => setTimeout(fine, 0));
    expect(comando).not.toHaveBeenCalled();
  });

  it("un rifiuto del motore non cambia il segno", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { motore, comando } = motoreFinto(RIFIUTO);
    const completo = completoCon(motore, editorFinto(radice).tasti);
    nelMenu(await menuAdesso(completo), "Disegna dietro").run?.();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    await new Promise((fine) => setTimeout(fine, 0));
    const dopo = await menuAdesso(completo);
    expect(nelMenu(dopo, "Disegna normale").checked).toBe(true);
    expect(nelMenu(dopo, "Disegna dietro").checked).toBe(false);
  });

  it("con il motore assente il segno non cambia", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { motore } = motoreFinto(ESITO, true);
    const completo = completoCon(motore, editorFinto(radice).tasti);
    nelMenu(await menuAdesso(completo), "Disegna dietro").run?.();
    await new Promise((fine) => setTimeout(fine, 0));
    const dopo = await menuAdesso(completo);
    expect(nelMenu(dopo, "Disegna normale").checked).toBe(true);
    expect(nelMenu(dopo, "Disegna dietro").checked).toBe(false);
  });

  it("riaprendo il Completo il segno torna su «Disegna normale»", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { motore, comando } = motoreFinto();
    const prima = completoCon(motore, editorFinto(radice).tasti);
    nelMenu(await menuAdesso(prima), "Disegna dietro").run?.();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    const dopo = completoCon(motore, editorFinto(radice).tasti);
    const menu = await menuAdesso(dopo);
    expect(nelMenu(menu, "Disegna normale").checked).toBe(true);
    expect(nelMenu(menu, "Disegna dietro").checked).toBe(false);
  });
});
