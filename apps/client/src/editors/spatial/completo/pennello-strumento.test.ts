// @vitest-environment happy-dom
// Il Pennello tondo come strumento del Completo (K6 T12, giro 2): la riga `blobBrush` è nella colonna, con
// Maiusc+B; la voce `path.blob` della ricerca Ctrl+/ sceglie lo strumento e non dà un errore; Maiusc+B non
// ha conflitti con i tasti di Fub e dentro un campo di testo non cambia niente. Il comportamento del colpo
// è in `motore/pennello-tondo*.test.ts`. Tabella scenario → test: in fondo al file.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { TOOLS, type ToolSpec } from "../tools/registry";
import { MOTORE_PRONTO, layoutCompleto } from "./colonna";
import { apri } from "./index";
import { indiceDi, type Indice, type VoceIndice } from "./indice";
import indiceGenerato from "./indice.generated.json";
import { montaTasti } from "./montaggio-tasti";
import { SHELL_KEYS } from "../../../ui/shell-keys.generated";
import type { ModificheTasti } from "./tasti";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { COMANDO_PENNELLO, STRUMENTO_PENNELLO } from "../motore/pennello-tondo";

const lifetimes: Lifetime[] = [];
afterEach(() => {
  for (const life of lifetimes.splice(0)) life.close();
  document.body.innerHTML = "";
});
function vita(): Lifetime {
  const life = openLifetime();
  lifetimes.push(life);
  return life;
}

const INDICE: Indice = indiceDi(indiceGenerato as never);
const voceDi = (id: string): VoceIndice => {
  const voce = INDICE.voci.find((v) => v.id === id);
  if (voce === undefined) throw new Error(`manca ${id} nell'indice`);
  return voce;
};

describe("il Pennello tondo nella colonna e nell'indice", () => {
  it("la riga blobBrush è pronta, nella casella della Matita, con la sua icona", () => {
    expect(MOTORE_PRONTO.has("blobBrush")).toBe(true);
    const VECTOR: readonly ToolSpec[] = TOOLS.filter((spec) => spec.spaces.vector !== undefined);
    const layout = layoutCompleto(VECTOR, MOTORE_PRONTO);
    const matita = layout.flatMap((gruppo) => gruppo.caselle).find((casella) => casella.includes("motore:pencil"))!;
    expect(matita).toContain("motore:blobBrush");
  });

  it("la voce dello strumento è nel suo posto e ha Maiusc+B, e nessun'altra voce ha quel tasto", () => {
    const voce = voceDi("blobBrush");
    expect(voce.chiamata).toEqual({ strumento: STRUMENTO_PENNELLO });
    expect(voce.posto).toBe("colonna/disegna");
    expect(voce.tasto).toBe("Shift+B");
    expect(INDICE.voci.filter((v) => v.tasto === "Shift+B").map((v) => v.id)).toEqual(["blobBrush"]);
  });

  it("Maiusc+B non è un tasto della shell: la shell ha solo Mod-Shift-b", () => {
    const tasti: ReadonlyArray<string | null> = Object.values(SHELL_KEYS);
    expect(tasti).toContain("Mod-Shift-b");
    expect(tasti.some((t) => t === "Shift-b" || t === "Shift+B")).toBe(false);
  });
});

describe("Maiusc+B nel Completo", () => {
  async function monta(root: HTMLElement) {
    const esegui = vi.fn((_voce: VoceIndice) => undefined);
    const stato = vi.fn(() => ({ vuoleTesto: false, componendo: false }));
    const modifiche = { current: {} as ModificheTasti };
    montaTasti({ radice: root, vita: vita(), indice: () => Promise.resolve(INDICE), modifiche: () => modifiche.current, stato, piattaforma: "other", esegui });
    await new Promise((r) => setTimeout(r, 0));
    return { esegui, stato };
  }

  it("Maiusc+B fuori da un campo fa partire lo strumento Pennello tondo", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { esegui } = await monta(root);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "B", shiftKey: true, bubbles: true, cancelable: true }));
    expect(esegui).toHaveBeenCalledTimes(1);
    expect(esegui.mock.calls[0]![0]).toMatchObject({ id: "blobBrush", chiamata: { strumento: STRUMENTO_PENNELLO } });
  });

  it("Maiusc+B dentro un campo di testo scrive la lettera e non cambia strumento", async () => {
    const root = document.createElement("div");
    const campo = document.createElement("input");
    campo.type = "text";
    root.append(campo);
    document.body.append(root);
    const { esegui, stato } = await monta(root);
    stato.mockReturnValue({ vuoleTesto: true, componendo: false });
    campo.dispatchEvent(new KeyboardEvent("keydown", { key: "B", shiftKey: true, bubbles: true, cancelable: true }));
    expect(esegui).not.toHaveBeenCalled();
  });
});

describe("la voce path.blob in Ctrl+/", () => {
  it("scegliere «Pennello tondo» dalla ricerca sceglie lo strumento, senza mandare il comando né dare errori", async () => {
    const comando = vi.fn((richiesta: { id: string }) => Promise.resolve(richiesta.id === "disegno.famiglia.prepara" ? { refused: null, ops: null, reading: null, selection: [], preview: null, revision: 1 } : null));
    const sessione = { comando, comandi: vi.fn(() => Promise.resolve([])) } as unknown as SessioneMotore;
    const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
    const strumento = vi.fn();
    const azioni = { strumento, client: vi.fn(), riprova: vi.fn() };
    const errori = vi.fn();
    window.addEventListener("unhandledrejection", errori);
    const c = apri({ motore, life: openLifetime() } as never, {
      indice: () => Promise.resolve(INDICE),
      prepara: () => Promise.resolve("pronta"),
      moduli: { "./famiglie/tracciati/index.ts": () => Promise.resolve({ registra: () => {} }) },
    } as never);
    const righe = await c.ricerca(() => [], azioni);
    const riga = righe?.find((r) => r.key === "path.blob");
    expect(riga, "la ricerca trova la voce").toBeDefined();
    riga!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(strumento).toHaveBeenCalledWith(STRUMENTO_PENNELLO);
    expect(comando.mock.calls.some(([r]) => r.id === `disegno.${COMANDO_PENNELLO}`)).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    window.removeEventListener("unhandledrejection", errori);
    expect(errori).not.toHaveBeenCalled();
    c.chiudi();
  });
});

/*
 * Tabella scenario → test (questo file e `motore/pennello-tondo-editor.test.ts`):
 *
 * | scenario                                              | test                                                       |
 * |-------------------------------------------------------|------------------------------------------------------------|
 * | (1) clic sullo strumento in barra → attivo, dipinge   | «la riga blobBrush è pronta, nella casella della Matita»   |
 * |     (il clic sul popup della Matita non è provato a schermo: la scelta è sceltaMotore, come le altre caselle) |  |
 * | (2) Maiusc+B → stesso effetto                         | «Maiusc+B fuori da un campo fa partire lo strumento…»      |
 * | (2) Maiusc+B in un campo di testo non cambia strumento | «Maiusc+B dentro un campo di testo scrive la lettera…»    |
 * | (3) Esc o cambio strumento → selezione                | pennello-tondo-editor: «Esc dopo lo strumento…», «cambiare strumento…» |
 * | (4) voce in Ctrl+/ → nessun errore, nessun rifiuto    | «scegliere «Pennello tondo» dalla ricerca…»                |
 * | (5) Maiusc+B non presa da altri                       | «la voce dello strumento è nel suo posto…», «Maiusc+B non è un tasto della shell…» |
 */
