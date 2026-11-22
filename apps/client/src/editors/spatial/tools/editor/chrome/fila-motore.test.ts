// @vitest-environment happy-dom
// La fila dello strumento del motore nella testata (K6 T11): assente finché la
// famiglia non è pronta, montata dopo con i controlli del kit, aggiornata dallo
// stato, e senza aggiornamenti dopo lo smontaggio. Con un contesto finto: la
// testata vera è troppo grande per un test di questa regola.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingToolState } from "../../../../../host/contract";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { costruisciFila, type Etichette, type FilaOpzioni } from "../../../completo/opzioni";
import type { EditorContext } from "../context";
import { installFilaMotore, type CompletoMotore } from "./fila-motore";

const ETICHETTE: Etichette = {
  attivo: { it: "Attivo", en: "On" },
  spessore: { it: "Spessore", en: "Width" },
};

const vite: Lifetime[] = [];
afterEach(() => {
  for (const life of vite.splice(0)) life.close();
});

function stato(options: unknown): DrawingToolState {
  return { busy: false, transforming: false, wants_text: false, composing: false, cursor: "arrow", options };
}

/// Un contesto finto con solo ciò che la fila tocca: lo strumento scelto, lo
/// stato per id, il completo che dà la fila, e gli ascolti con il loro disposer.
function contestoFinto(completo: CompletoMotore | null) {
  const life = openLifetime();
  vite.push(life);
  const statiPer: Record<string, DrawingToolState | null> = {};
  const ascoltiStati = new Set<(id: string) => void>();
  const ascoltiStrumento = new Set<() => void>();
  const setItems = vi.fn();
  const ctx = {
    life,
    disposed: false,
    motoreTool: null as string | null,
    completoMotore: () => completo,
    statoStrumento: (id: string) => statiPer[id] ?? null,
    ascoltaStati: (ascolto: (id: string) => void) => {
      ascoltiStati.add(ascolto);
      return () => {
        ascoltiStati.delete(ascolto);
      };
    },
    ascoltaStrumentoMotore: (ascolto: () => void) => {
      ascoltiStrumento.add(ascolto);
      return () => {
        ascoltiStrumento.delete(ascolto);
      };
    },
    opzioneMotore: vi.fn(),
    optionsBar: { setItems },
    toolbarGroups: [],
  };
  installFilaMotore(ctx as unknown as EditorContext);
  /// Lo strumento scelto cambia (come `sceltaMotore`): avvisa chi ascolta.
  const scegli = (id: string | null): void => {
    ctx.motoreTool = id;
    for (const ascolto of [...ascoltiStrumento]) ascolto();
  };
  /// Un esito porta lo stato dello strumento (come `registra`): avvisa chi ascolta gli stati.
  const registra = (id: string, nuovo: DrawingToolState): void => {
    statiPer[id] = nuovo;
    for (const ascolto of [...ascoltiStati]) ascolto(id);
  };
  return { ctx, life, setItems, scegli, registra, ascoltiStati, ascoltiStrumento };
}

describe("la fila dello strumento del motore nella testata", () => {
  it("non c'è finché la famiglia non è pronta, poi si monta con i controlli del kit", () => {
    let pronta = false;
    const fila: CompletoMotore = {
      preparaStrumento: () => Promise.resolve(true),
      fila: (_strumento, opzioni, cambia, vita) => (pronta ? costruisciFila(ETICHETTE, opzioni, cambia, vita) : null),
    };
    const { setItems, scegli, registra } = contestoFinto(fila);
    registra("directSelection", stato({ attivo: true, spessore: 2 }));
    scegli("directSelection");
    // La famiglia non c'è: nessuna fila nella riga.
    expect(setItems).not.toHaveBeenCalled();
    pronta = true;
    scegli("directSelection");
    expect(setItems).toHaveBeenCalledTimes(1);
    const voci = setItems.mock.calls[0]![0] as { id: string; element: HTMLElement }[];
    const voce = voci.find((one) => one.id === "motore-directSelection")!;
    expect(voce).toBeDefined();
    expect(voce.element.querySelector(".kit-form-checkbox")).not.toBeNull();
    expect(voce.element.querySelector(".kit-number-input")).not.toBeNull();
  });

  it("uno stato nuovo dello strumento aggiorna la fila montata", () => {
    const fila = costruisciFila(ETICHETTE, { attivo: false, spessore: 2 }, vi.fn(), openLifetime())!;
    const spia: FilaOpzioni = { element: fila.element, aggiorna: vi.fn((opzioni: unknown) => fila.aggiorna(opzioni)) };
    const completo: CompletoMotore = {
      preparaStrumento: () => Promise.resolve(true),
      fila: () => spia,
    };
    const { registra, scegli } = contestoFinto(completo);
    registra("directSelection", stato({ attivo: false, spessore: 2 }));
    scegli("directSelection");
    registra("directSelection", stato({ attivo: true, spessore: 9 }));
    expect(spia.aggiorna).toHaveBeenLastCalledWith({ attivo: true, spessore: 9 });
    expect(fila.element.querySelector<HTMLInputElement>(".kit-form-checkbox")!.checked).toBe(true);
    expect(fila.element.querySelector<HTMLInputElement>(".kit-number-input")!.value).toBe("9");
  });

  it("uno stato di un altro strumento non tocca la fila montata", () => {
    const spia: FilaOpzioni = { element: document.createElement("div"), aggiorna: vi.fn(() => true) };
    const { registra, scegli } = contestoFinto({ preparaStrumento: () => Promise.resolve(true), fila: () => spia });
    registra("directSelection", stato({ attivo: false }));
    scegli("directSelection");
    registra("lasso", stato({ attivo: true }));
    expect(spia.aggiorna).not.toHaveBeenCalled();
  });

  it("tolta la fila (un altro strumento senza controlli), nessun aggiornamento dopo", () => {
    const spia: FilaOpzioni = { element: document.createElement("div"), aggiorna: vi.fn(() => true) };
    const { ascoltiStati, registra, scegli, setItems } = contestoFinto({ preparaStrumento: () => Promise.resolve(true), fila: () => spia });
    registra("directSelection", stato({ attivo: false }));
    scegli("directSelection");
    expect(ascoltiStati.size).toBe(1);
    // Lo strumento scelto cambia e non ha più una fila: si toglie.
    scegli(null);
    expect(ascoltiStati.size).toBe(0);
    expect(setItems).toHaveBeenLastCalledWith([]);
    registra("directSelection", stato({ attivo: true }));
    expect(spia.aggiorna).not.toHaveBeenCalled();
  });

  it("chiusa la vita dell'editor, nessun ascolto resta", () => {
    const spia: FilaOpzioni = { element: document.createElement("div"), aggiorna: vi.fn(() => true) };
    const { life, ascoltiStati, ascoltiStrumento, registra, scegli } = contestoFinto({ preparaStrumento: () => Promise.resolve(true), fila: () => spia });
    registra("directSelection", stato({ attivo: false }));
    scegli("directSelection");
    life.close();
    expect(ascoltiStati.size).toBe(0);
    expect(ascoltiStrumento.size).toBe(0);
  });
});
