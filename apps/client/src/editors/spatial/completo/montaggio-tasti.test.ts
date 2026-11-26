// @vitest-environment happy-dom

// Il montaggio dei tasti del motore sulla radice dell'editor (K6 T9b), con un
// host finto: un tasto del motore fa partire la sua voce; un tasto di Fub, un
// campo di testo, un IME, lo strumento che vuole il testo e un editor chiuso no.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { indiceDi, type Indice, type VoceIndice } from "./indice";
import { montaTasti } from "./montaggio-tasti";
import type { ModificheTasti } from "./tasti";

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

function voce(id: string, tasto: string | null, over: Partial<VoceIndice> = {}): VoceIndice {
  return {
    fonte: "motore",
    id,
    chiamata: { comando: id },
    etichetta: { it: id, en: id },
    posto: "menu/oggetto",
    famiglia: "forme",
    tasto,
    effetto: "cambia",
    finestra: false,
    ...over,
  };
}

const INDICE: Indice = indiceDi({
  voci: [
    voce("shape.round", "Cmd+Alt+L"),
    voce("edit.undo", "Cmd+Z"), // Annulla di Fub: il tasto è di Fub, il comando non parte
    voce("shift.m", "Shift+M"), // una lettera con Maiusc: si scrive
    voce("tool.pen", "Cmd+Alt+T", { fonte: "strumento", chiamata: { strumento: "pen" } }),
    // Voci del client col tasto di VectorCraft (tasti-interfaccia.tsv): Applica ultimo effetto
    // parte; Adatta tavola (Ctrl+0) resta dell'editor, che la fa da sé; senza tasto niente.
    voce("effect.applyLast", "Cmd+Shift+E", { fonte: "interfaccia", chiamata: { client: "effect.applyLast" } }),
    voce("view.fitArtboard", "Cmd+0", { fonte: "interfaccia", chiamata: { client: "view.fitArtboard" } }),
    voce("view.pixelPreview", null, { fonte: "interfaccia", chiamata: { client: "view.pixelPreview" } }),
  ],
});

/// Il root dell'editor, con un campo di testo dentro.
function radice(): { root: HTMLElement; campo: HTMLInputElement } {
  const root = document.createElement("div");
  const campo = document.createElement("input");
  campo.type = "text";
  root.append(campo);
  document.body.append(root);
  return { root, campo };
}

/// Un tasto premuto sul root, con il suo esito.
function premi(bersaglio: EventTarget, init: KeyboardEventInit & { isComposing?: boolean }): KeyboardEvent {
  const { isComposing, ...rest } = init;
  const evento = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...rest });
  if (isComposing !== undefined) Object.defineProperty(evento, "isComposing", { value: isComposing });
  bersaglio.dispatchEvent(evento);
  return evento;
}

const TASTO_ROUND = { key: "l", ctrlKey: true, altKey: true };

/// Il montaggio con l'indice che arriva, e le opzioni finte. Il root, se non si
/// dà, è un editor vuoto con un campo.
async function monta(over: { root?: HTMLElement; life?: Lifetime } = {}) {
  const root = over.root ?? radice().root;
  const life = over.life ?? vita();
  const esegui = vi.fn((_voce: VoceIndice) => undefined);
  const stato = vi.fn(() => ({ vuoleTesto: false, componendo: false }));
  const modifiche = { current: {} as ModificheTasti };
  const montaggio = montaTasti({
    radice: root,
    vita: life,
    indice: () => Promise.resolve(INDICE),
    modifiche: () => modifiche.current,
    stato,
    piattaforma: "other",
    esegui,
  });
  // L'indice arriva in un giro di promesse.
  await new Promise((r) => setTimeout(r, 0));
  return { root, esegui, stato, montaggio, life, modifiche };
}

describe("montaTasti", () => {
  it("un tasto del motore fa partire il suo comando, e l'evento non va avanti", async () => {
    const { root, esegui } = await monta();
    const evento = premi(root, TASTO_ROUND);
    expect(esegui).toHaveBeenCalledTimes(1);
    expect(esegui.mock.calls[0]![0]).toMatchObject({ id: "shape.round" });
    expect(evento.defaultPrevented).toBe(true);
  });

  it("una voce del client parte dal suo tasto; una col tasto dell'editor no", async () => {
    const { root, esegui } = await monta();
    const evento = premi(root, { key: "E", code: "KeyE", ctrlKey: true, shiftKey: true });
    expect(esegui).toHaveBeenCalledTimes(1);
    expect(esegui.mock.calls[0]![0]).toMatchObject({ id: "effect.applyLast" });
    expect(evento.defaultPrevented).toBe(true);
    const zero = premi(root, { key: "0", code: "Digit0", ctrlKey: true });
    expect(esegui).toHaveBeenCalledTimes(1);
    expect(zero.defaultPrevented).toBe(false);
  });

  it("un tasto che non è di nessun comando non fa niente", async () => {
    const { root, esegui } = await monta();
    const evento = premi(root, { key: "q", ctrlKey: true, altKey: true });
    expect(esegui).not.toHaveBeenCalled();
    expect(evento.defaultPrevented).toBe(false);
  });

  it("prima che l'indice arrivi non parte niente", () => {
    const root = radice().root;
    const esegui = vi.fn();
    montaTasti({ radice: root, vita: vita(), indice: () => new Promise(() => undefined), modifiche: () => ({}), stato: () => ({ vuoleTesto: false, componendo: false }), piattaforma: "other", esegui });
    premi(root, TASTO_ROUND);
    expect(esegui).not.toHaveBeenCalled();
  });

  it("un tasto di Fub non è mai un tasto del motore: il comando resta senza tasto", async () => {
    const { root, esegui } = await monta();
    const evento = premi(root, { key: "z", ctrlKey: true });
    expect(esegui).not.toHaveBeenCalled();
    expect(evento.defaultPrevented).toBe(false);
  });

  it("in un campo di testo il tasto non parte", async () => {
    const editor = radice();
    const { esegui } = await monta({ root: editor.root });
    const evento = premi(editor.campo, TASTO_ROUND);
    expect(esegui).not.toHaveBeenCalled();
    expect(evento.defaultPrevented).toBe(false);
  });

  it("mentre un IME compone il tasto non parte, anche se la tastiera lo dà come composizione", async () => {
    const { root, esegui } = await monta();
    premi(root, { ...TASTO_ROUND, isComposing: true });
    expect(esegui).not.toHaveBeenCalled();
  });

  it("con lo strumento che vuole il testo, una lettera con Maiusc si scrive e non parte", async () => {
    const { root, esegui, stato } = await monta();
    stato.mockReturnValue({ vuoleTesto: true, componendo: false });
    const evento = premi(root, { key: "M", shiftKey: true });
    expect(esegui).not.toHaveBeenCalled();
    expect(evento.defaultPrevented).toBe(false);
  });

  it("senza testo da scrivere, la stessa lettera con Maiusc parte", async () => {
    const { root, esegui } = await monta();
    premi(root, { key: "M", shiftKey: true });
    expect(esegui).toHaveBeenCalledWith(expect.objectContaining({ id: "shift.m" }));
  });

  it("con lo strumento che vuole il testo, un comando con Ctrl e Alt parte lo stesso", async () => {
    const { root, esegui, stato } = await monta();
    stato.mockReturnValue({ vuoleTesto: true, componendo: false });
    premi(root, TASTO_ROUND);
    expect(esegui).toHaveBeenCalledWith(expect.objectContaining({ id: "shape.round" }));
  });

  it("un evento già preso (defaultPrevented) prima del montaggio non parte", async () => {
    const root = radice().root;
    // Un ascoltatore sullo stesso root, montato prima: ha già preso il tasto
    // (come i tasti del Semplice in `vault-images.ts`).
    root.addEventListener("keydown", (e: Event) => e.preventDefault());
    const { esegui } = await monta({ root });
    premi(root, TASTO_ROUND);
    expect(esegui).not.toHaveBeenCalled();
  });

  it("una modifica dell'utente vale dopo `aggiorna`, e il tasto di prima non vale più", async () => {
    const { root, esegui, montaggio, modifiche } = await monta();
    modifiche.current = { "shape.round": "Mod-Alt-R" };
    montaggio.aggiorna();
    premi(root, TASTO_ROUND);
    expect(esegui).not.toHaveBeenCalled();
    premi(root, { key: "r", ctrlKey: true, altKey: true });
    expect(esegui).toHaveBeenCalledWith(expect.objectContaining({ id: "shape.round" }));
  });

  it("la regola si legge dal montaggio: il tasto del motore c'è, e quello di Fub no", async () => {
    const { montaggio } = await monta();
    expect(montaggio.regola()?.tasti.get("shape.round")).toBe("Mod-Alt-L");
    expect(montaggio.regola()?.tasti.has("edit.undo")).toBe(false);
  });

  it("uno strumento del motore non parte dai tasti del Completo", async () => {
    const { root, esegui } = await monta();
    premi(root, { key: "t", ctrlKey: true, altKey: true });
    expect(esegui).not.toHaveBeenCalled();
  });

  it("chiuso il disegno, il tasto non parte più", async () => {
    const life = vita();
    const { root, esegui } = await monta({ life });
    life.close();
    premi(root, TASTO_ROUND);
    expect(esegui).not.toHaveBeenCalled();
  });

  it("un indice che non arriva non blocca il Semplice: nessun tasto del motore, nessun errore", async () => {
    const root = radice().root;
    const esegui = vi.fn();
    montaTasti({ radice: root, vita: vita(), indice: () => Promise.reject(new Error("niente")), modifiche: () => ({}), stato: () => ({ vuoleTesto: false, componendo: false }), piattaforma: "other", esegui });
    await new Promise((r) => setTimeout(r, 0));
    premi(root, TASTO_ROUND);
    expect(esegui).not.toHaveBeenCalled();
  });

  it("il primo indice rifiuta: il tasto dopo lo chiede di nuovo, e poi un tasto del motore parte", async () => {
    const root = radice().root;
    let tentativi = 0;
    const indice = vi.fn((): Promise<Indice> => {
      tentativi++;
      return tentativi === 1 ? Promise.reject(new Error("niente")) : Promise.resolve(INDICE);
    });
    const esegui = vi.fn((_voce: VoceIndice) => undefined);
    montaTasti({ radice: root, vita: vita(), indice, modifiche: () => ({}), stato: () => ({ vuoleTesto: false, componendo: false }), piattaforma: "other", esegui });
    await new Promise((r) => setTimeout(r, 0));
    expect(indice).toHaveBeenCalledTimes(1);
    // Il tasto dopo il rifiuto chiede l'indice di nuovo, e non parte ancora.
    premi(root, TASTO_ROUND);
    expect(indice).toHaveBeenCalledTimes(2);
    expect(esegui).not.toHaveBeenCalled();
    // Arrivato l'indice, il tasto parte, e l'indice non si chiede più.
    await new Promise((r) => setTimeout(r, 0));
    premi(root, TASTO_ROUND);
    expect(esegui).toHaveBeenCalledWith(expect.objectContaining({ id: "shape.round" }));
    expect(indice).toHaveBeenCalledTimes(2);
  });

  it("mentre l'indice si chiede, un tasto non ne chiede un altro", () => {
    const root = radice().root;
    const indice = vi.fn((): Promise<Indice> => new Promise(() => undefined));
    montaTasti({ radice: root, vita: vita(), indice, modifiche: () => ({}), stato: () => ({ vuoleTesto: false, componendo: false }), piattaforma: "other", esegui: vi.fn() });
    premi(root, TASTO_ROUND);
    premi(root, TASTO_ROUND);
    expect(indice).toHaveBeenCalledTimes(1);
  });
});

describe("montaTasti, i tasti di un carattere di VectorCraft", () => {
  const NUDI: Indice = indiceDi({
    voci: [
      voce("paint.default", "D"),
      voce("paint.swap", "Shift+X"),
      voce("paint.toggleActive", "X"),
      voce("paint.none", "/"),
      voce("edit.clear", "Delete"),
      voce("lasso", "Q", { fonte: "strumento", chiamata: { strumento: "lasso" } }),
    ],
  });

  async function montaNudi(over: { vuoleTesto?: boolean; attivo?: () => boolean } = {}) {
    const { root, campo } = radice();
    const esegui = vi.fn((_voce: VoceIndice) => undefined);
    montaTasti({
      radice: root,
      ...(over.attivo !== undefined ? { attivo: over.attivo } : {}),
      vita: vita(),
      indice: () => Promise.resolve(NUDI),
      modifiche: () => ({}),
      stato: () => ({ vuoleTesto: over.vuoleTesto === true, componendo: false }),
      piattaforma: "other",
      esegui,
    });
    await new Promise((r) => setTimeout(r, 0));
    const partito = (init: KeyboardEventInit, bersaglio: EventTarget = root): string | null => {
      esegui.mockClear();
      const evento = premi(bersaglio, init);
      const id = esegui.mock.calls[0]?.[0].id ?? null;
      expect(evento.defaultPrevented).toBe(id !== null);
      return id;
    };
    return { partito, campo };
  }

  it("la lettera, la lettera con Maiusc e il segno fanno partire il loro comando", async () => {
    const { partito } = await montaNudi();
    expect(partito({ key: "d" })).toBe("paint.default");
    expect(partito({ key: "x" })).toBe("paint.toggleActive");
    expect(partito({ key: "X", shiftKey: true })).toBe("paint.swap");
    // `/` con Maiusc, come sulla tastiera italiana.
    expect(partito({ key: "/", shiftKey: true })).toBe("paint.none");
  });

  it("Canc e Backspace cancellano, come `nudge_and_clear`", async () => {
    const { partito } = await montaNudi();
    expect(partito({ key: "Delete" })).toBe("edit.clear");
    expect(partito({ key: "Backspace" })).toBe("edit.clear");
  });

  it("con Ctrl o Alt, in un campo, col testo che si scrive o col Completo spento non parte niente", async () => {
    const { partito, campo } = await montaNudi();
    expect(partito({ key: "d", ctrlKey: true })).toBeNull();
    expect(partito({ key: "d", altKey: true })).toBeNull();
    expect(partito({ key: "d" }, campo)).toBeNull();
    expect((await montaNudi({ vuoleTesto: true })).partito({ key: "d" })).toBeNull();
    expect((await montaNudi({ attivo: () => false })).partito({ key: "d" })).toBeNull();
  });

  it("un tasto di uno strumento non è un comando", async () => {
    const { partito } = await montaNudi();
    expect(partito({ key: "q" })).toBeNull();
  });
});
