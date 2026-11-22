// @vitest-environment happy-dom
// Un solo percorso per i comandi del Disegno completo (piano K6, T9a e T9b): la
// stessa voce, lanciata dal menu ≡, da Ctrl+/ e da un tasto, passa per
// `eseguiVoce` e registra un solo passo con la sua etichetta. E il tasto che il
// menu e la tavolozza mostrano è quello che fa partire il comando: un tasto
// coperto da Fub non si mostra, e nemmeno parte.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingOutcome } from "../../../host/contract";
import { displayBinding } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { MenuItem } from "../../../ui/menu";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import type { Op } from "../scene/ops";
import type { VoceRicerca } from "./comandi";
import { apri, type OpzioniTastiCompleto } from "./index";
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

/// Una voce del motore con il suo tasto come lo scrive l'indice.
function voce(id: string, tasto: string | null): VoceIndice {
  return {
    fonte: "motore",
    id,
    chiamata: { comando: `disegno.${id}` },
    etichetta: { it: `Voce ${id}`, en: `Item ${id}` },
    posto: "menu/oggetto",
    famiglia: "forme",
    tasto,
    effetto: "cambia",
    finestra: false,
  };
}

/// Un esito con un'operazione: il comando cambia il disegno.
const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["k1"], losses: [], refused: null, frame: null } as unknown as DrawingOutcome;

/// Il motore del disegno: la sessione con i comandi che valgono, e il comando
/// contato.
function motoreFinto() {
  const comando = vi.fn(() => Promise.resolve(ESITO));
  const comandi = vi.fn(() =>
    Promise.resolve([
      { id: "disegno.a", enabled: true, disabled_reason: null },
      { id: "disegno.b", enabled: true, disabled_reason: null },
    ]),
  );
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
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

/// Il Completo con l'indice `voci`, e la famiglia pronta senza il suo chunk vero.
function completoCon(voci: readonly VoceIndice[], tasti: OpzioniTastiCompleto, motore: MotoreDelDisegno) {
  return apri(
    { motore, life: vita() },
    {
      indice: () => Promise.resolve(indiceDi({ voci: [...voci] })),
      prepara: () => Promise.resolve("pronta"),
      // Il modulo della famiglia come lo carica `carica.ts`: con il suo `default`.
      moduli: { "./famiglie/forme/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }) },
      tasti,
    },
  );
}

const AZIONI = { strumento: vi.fn(), riprova: vi.fn() };

/// La voce con quel nome, in un sottomenu del menu.
function nelMenu(menu: readonly MenuItem[], nome: string): MenuItem {
  for (const gruppo of menu) {
    const hit = (typeof gruppo.items === "object" ? gruppo.items : []).find((item) => item.label === nome);
    if (hit !== undefined) return hit;
  }
  throw new Error(`manca la voce «${nome}»`);
}

/// La riga della ricerca con quella chiave.
function riga(righe: readonly VoceRicerca[] | null, chiave: string): VoceRicerca {
  const hit = righe?.find((one) => one.key === chiave);
  if (hit === undefined) throw new Error(`manca la riga «${chiave}»`);
  return hit;
}

describe("un solo percorso per i comandi del Completo", () => {
  it("la stessa voce, dal menu, da Ctrl+/ e da un tasto, passa per eseguiVoce e registra un solo passo", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { motore, comando } = motoreFinto();
    const editor = editorFinto(radice);
    const completo = completoCon([voce("a", "Cmd+Alt+j")], editor.tasti, motore);
    // La spia sulle dipendenze: ogni ingresso chiede la famiglia, come fa eseguiVoce.
    const famiglia = vi.spyOn(completo.carica, "famiglia");

    const menu = await completo.menu(() => ["k1"], AZIONI);
    nelMenu(menu, "Voce a").run?.();
    await vi.waitFor(() => expect(editor.commit).toHaveBeenCalledTimes(1));

    const righe = await completo.ricerca(() => ["k1"], AZIONI);
    riga(righe, "a").run();
    await vi.waitFor(() => expect(editor.commit).toHaveBeenCalledTimes(2));

    radice.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true, altKey: true, bubbles: true }));
    await vi.waitFor(() => expect(editor.commit).toHaveBeenCalledTimes(3));

    expect(famiglia).toHaveBeenCalledTimes(3);
    expect(comando).toHaveBeenCalledTimes(3);
    // Ogni lancio dice una volta, con il nome della voce, che il comando è fatto.
    // Il primo lancio dice anche che la parte del disegno sta arrivando.
    const fatti = editor.annuncia.mock.calls.filter((chiamata) => String(chiamata[0]).includes("Voce a"));
    expect(fatti).toHaveLength(3);
  });

  it("un comando il cui tasto è coperto da Fub non mostra tasto, e uno con un tasto valido mostra quello che lo fa partire", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { motore, comando } = motoreFinto();
    const editor = editorFinto(radice);
    // «b» ha Ctrl+K, che è di Fub (Mod-k): il comando perde il suo tasto.
    const completo = completoCon([voce("a", "Cmd+Alt+j"), voce("b", "Cmd+k")], editor.tasti, motore);

    const menu = await completo.menu(() => ["k1"], AZIONI);
    expect(nelMenu(menu, "Voce a").hint).toBe(displayBinding("Mod-Alt-j"));
    expect(nelMenu(menu, "Voce b").hint).toBeUndefined();
    const righe = await completo.ricerca(() => ["k1"], AZIONI);
    expect(riga(righe, "a").hint).toBe(displayBinding("Mod-Alt-j"));
    expect(riga(righe, "b").hint).toBeUndefined();

    // Il tasto mostrato parte: Ctrl+Alt+J fa partire «a».
    const valido = new KeyboardEvent("keydown", { key: "j", ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
    radice.dispatchEvent(valido);
    await vi.waitFor(() => expect(editor.commit).toHaveBeenCalledTimes(1));
    expect(valido.defaultPrevented).toBe(true);
    expect(comando).toHaveBeenCalledTimes(1);

    // Il tasto coperto non parte: Ctrl+K resta a Fub, e il disegno non cambia.
    const coperto = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    radice.dispatchEvent(coperto);
    expect(coperto.defaultPrevented).toBe(false);
    expect(editor.commit).toHaveBeenCalledTimes(1);
  });
});
