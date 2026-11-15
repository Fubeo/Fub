// @vitest-environment happy-dom
//
// La sbirciata (E11, T20): il pannello, la sua vita, e l'ordine dei passi che
// non perdono testo (prima l'editor porta il testo alla sessione, poi si
// smonta; prima il riquadro prende la nota, poi la sbirciata la lascia).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardEditor, CardEditorOptions, CardEditorState } from "../editors/canvas/cards";
import { createNotePeek, linkClickOf, peekPlace, type NotePeekDeps, type PeekResolution } from "./note-peek";

interface FakeEditor extends CardEditor {
  readonly host: HTMLElement;
  readonly options: CardEditorOptions;
  closeSession(): void;
}

function fakeEditor(host: HTMLElement, options: CardEditorOptions, log: string[]): FakeEditor {
  const listeners = new Set<(state: CardEditorState) => void>();
  let closed = false;
  let destroyed = false;
  host.append(Object.assign(document.createElement("div"), { className: "fake-editor", tabIndex: 0 }));
  options.lifetime.add(() => {
    if (!destroyed) log.push("destroy");
    destroyed = true;
  });
  return {
    host,
    options,
    focus: () => host.querySelector<HTMLElement>(".fake-editor")?.focus(),
    leave: async () => {
      log.push("leave");
    },
    state: () => "editing" as CardEditorState,
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    closed: () => closed,
    destroy: () => {
      if (!destroyed) log.push("destroy");
      destroyed = true;
    },
    closeSession: () => {
      closed = true;
      for (const listener of [...listeners]) listener("readonly" as CardEditorState);
    },
  };
}

function setup(resolution: PeekResolution | ((page: string) => PeekResolution)) {
  const sheet = document.createElement("section");
  sheet.className = "pane";
  const before = document.createElement("button");
  before.textContent = "prima";
  sheet.append(before);
  document.body.append(sheet);
  before.focus();
  const log: string[] = [];
  const editors: FakeEditor[] = [];
  const deps: NotePeekDeps = {
    resolve: async (target) => (typeof resolution === "function" ? resolution(target.page) : resolution),
    editors: {
      open: async (path, host, options) => {
        log.push(`open ${path}`);
        const editor = fakeEditor(host, options, log);
        editors.push(editor);
        return editor;
      },
    },
    host: () => sheet,
    openHere: vi.fn(async (doc: string) => {
      log.push(`here ${doc}`);
    }),
    openBeside: vi.fn(async (doc: string) => {
      log.push(`side ${doc}`);
    }),
    openOther: vi.fn(async (doc: string) => {
      log.push(`other ${doc}`);
    }),
    create: vi.fn(async (page: string) => `${page}.md`),
    failed: vi.fn(),
  };
  const peek = createNotePeek(deps);
  const root = () => sheet.querySelector<HTMLElement>(".note-peek");
  return { sheet, before, log, editors, deps, peek, root };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("la sbirciata", () => {
  it("apre la nota sopra il foglio con l'editor vero, il fuoco sul Chiudi", async () => {
    const s = setup({ kind: "note", doc: "Luoghi/Biblioteca civica.md" });
    await s.peek.open({ page: "Biblioteca civica", heading: "Orari", block: null });
    expect(s.root()?.dataset.state).toBe("note");
    expect(s.root()?.querySelector(".note-peek-place-text")?.textContent).toBe("Luoghi");
    expect(s.root()?.getAttribute("aria-label")).toContain("Biblioteca civica");
    expect(s.editors[0]?.options).toMatchObject({ compact: false, readOnly: false, heading: "Orari" });
    expect(s.editors[0]?.host.classList.contains("pane-editor")).toBe(true);
    expect(document.activeElement?.classList.contains("note-peek-close")).toBe(true);
    expect(s.peek.shown()).toEqual({ doc: "Luoghi/Biblioteca civica.md", page: "Biblioteca civica", state: "note" });
    expect(s.peek.isIn(s.sheet)).toBe(true);
  });

  it("Esc porta il testo alla sessione prima di smontare, e il fuoco torna dov'era", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    await s.peek.open({ page: "Nota", heading: null, block: null });
    s.editors[0]!.focus();
    s.root()!.querySelector(".fake-editor")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(s.root()).toBeNull());
    expect(s.log).toEqual(["open Nota.md", "leave", "destroy"]);
    expect(document.activeElement).toBe(s.before);
    expect(s.peek.shown()).toBeNull();
  });

  it("un Esc che l'editor ha già usato resta suo", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    await s.peek.open({ page: "Nota", heading: null, block: null });
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    s.root()!.querySelector(".fake-editor")!.dispatchEvent(event);
    await Promise.resolve();
    expect(s.root()).not.toBeNull();
    expect(s.log).not.toContain("leave");
  });

  it("«Apri qui» e «A lato»: prima il testo, poi il riquadro, poi la sbirciata si chiude", async () => {
    for (const where of ["here", "side"] as const) {
      const s = setup({ kind: "note", doc: "Nota.md" });
      await s.peek.open({ page: "Nota", heading: null, block: null });
      s.root()!.querySelector<HTMLButtonElement>(where === "here" ? ".note-peek-here" : ".note-peek-side")!.click();
      await vi.waitFor(() => expect(s.root()).toBeNull());
      expect(s.log).toEqual(["open Nota.md", "leave", `${where} Nota.md`, "destroy"]);
      document.body.replaceChildren();
    }
  });

  it("se il riquadro non prende la nota la sbirciata resta, e lo dice", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    s.deps.openHere = vi.fn(async () => {
      throw new Error("no");
    });
    const peek = createNotePeek(s.deps);
    await peek.open({ page: "Nota", heading: null, block: null });
    await peek.promote("here");
    expect(s.root()?.dataset.state).toBe("note");
    expect(s.deps.failed).toHaveBeenCalled();
  });

  it("una nota che non c'è si può creare, e la sbirciata la apre", async () => {
    const s = setup({ kind: "missing", page: "Nuova" });
    await s.peek.open({ page: "Nuova", heading: null, block: null });
    expect(s.root()?.dataset.state).toBe("missing");
    expect(s.root()?.querySelector(".note-peek-message-title")?.textContent).toBe("Nuova");
    expect(s.root()?.querySelector<HTMLButtonElement>(".note-peek-here")?.disabled).toBe(true);
    s.root()!.querySelector<HTMLButtonElement>(".note-peek-create")!.click();
    await vi.waitFor(() => expect(s.root()?.dataset.state).toBe("note"));
    expect(s.deps.create).toHaveBeenCalledWith("Nuova");
    expect(s.log).toEqual(["open Nuova.md"]);
  });

  it("un link a un PDF o a un foglio si apre a lato, senza sbirciata", async () => {
    const s = setup({ kind: "other", doc: "Carte/Pianta.pdf" });
    await s.peek.open({ page: "Pianta", heading: "page=3", block: null });
    expect(s.root()).toBeNull();
    expect(s.deps.openOther).toHaveBeenCalledWith("Carte/Pianta.pdf", { page: "Pianta", heading: "page=3", block: null });
  });

  it("la nota tolta sotto la sbirciata lo dice, invece di un editor che non salva", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    await s.peek.open({ page: "Nota", heading: null, block: null });
    s.editors[0]!.closeSession();
    expect(s.root()?.dataset.state).toBe("gone");
    expect(s.root()?.querySelector(".note-peek-create")).toBeNull();
    expect(s.log).toContain("destroy");
  });

  it("una seconda sbirciata chiude la prima salvandola; una risposta vecchia non la riempie", async () => {
    let release: (value: PeekResolution) => void = () => {};
    const s = setup({ kind: "note", doc: "A.md" });
    s.deps.resolve = (target) =>
      target.page === "Lenta" ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ kind: "note", doc: `${target.page}.md` });
    const peek = createNotePeek(s.deps);
    await peek.open({ page: "A", heading: null, block: null });
    const slow = peek.open({ page: "Lenta", heading: null, block: null });
    await vi.waitFor(() => expect(s.log).toContain("leave"));
    await peek.open({ page: "B", heading: null, block: null });
    release({ kind: "note", doc: "Lenta.md" });
    await slow;
    expect(s.log).not.toContain("open Lenta.md");
    expect(peek.shown()?.doc).toBe("B.md");
    expect(s.sheet.querySelectorAll(".note-peek")).toHaveLength(1);
  });

  it("dismiss chiude subito; il Chiudi salva e chiude", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    await s.peek.open({ page: "Nota", heading: null, block: null });
    s.peek.dismiss();
    expect(s.root()).toBeNull();
    expect(s.log).toEqual(["open Nota.md", "destroy"]);
    await s.peek.open({ page: "Nota", heading: null, block: null });
    s.root()!.querySelector<HTMLButtonElement>(".note-peek-close")!.click();
    await vi.waitFor(() => expect(s.root()).toBeNull());
    expect(s.log.slice(-2)).toEqual(["leave", "destroy"]);
  });
});

describe("le regole piccole", () => {
  it("legge editor.link-click: ciò che non conosce è il valore di serie", () => {
    expect(linkClickOf("sbircia")).toBe("sbircia");
    expect(linkClickOf("apri")).toBe("apri");
    expect(linkClickOf("altro")).toBe("apri");
    expect(linkClickOf(undefined)).toBe("apri");
  });

  it("la testata dice la cartella, o il nome se la nota sta alla radice", () => {
    expect(peekPlace("Luoghi/Città/Biblioteca.md")).toBe("Luoghi / Città");
    expect(peekPlace("Biblioteca.md")).toBe("Biblioteca");
  });
});
