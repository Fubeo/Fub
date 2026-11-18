// @vitest-environment happy-dom
//
// La sbirciata (E11, T20): il pannello, la sua vita, e l'ordine dei passi che
// non perdono testo (prima l'editor porta il testo alla sessione, poi si
// smonta; prima il riquadro prende la nota, poi la sbirciata la lascia).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardEditor, CardEditorOptions, CardEditorState } from "../editors/canvas/cards";
import type { EditorSurface } from "../editors/core/registry";
import type { PeekLink } from "../editors/text/profiles/markdown/link-gesture";
import { errorText } from "../host/errors";
import "../i18n/strings";
import { createNotePeek, linkClickOf, linkName, peekPlace, type NotePeekDeps, type PeekResolution, type PeekTarget } from "./note-peek";

interface FakeEditor extends CardEditor {
  readonly host: HTMLElement;
  readonly options: CardEditorOptions;
  readonly fakeSurface: EditorSurface;
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
  const fakeSurface = {
    surfaceId: "card-1",
    selections: () => ({ primary: { start: 12, end: 15, text: "abc" }, secondary: [] }),
  } as unknown as EditorSurface;
  return {
    host,
    options,
    fakeSurface,
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
    surface: () => (destroyed ? null : fakeSurface),
    destroy: (destroyOptions) => {
      if (!destroyed) log.push(destroyOptions?.quiet ? "destroy quiet" : "destroy");
      destroyed = true;
    },
    closeSession: () => {
      closed = true;
      for (const listener of [...listeners]) listener("readonly" as CardEditorState);
    },
  };
}

const wiki = (page: string, heading: string | null = null): PeekTarget => ({ link: { kind: "wiki", page, heading, block: null }, from: "Diario/Oggi.md" });
const pageOf = (link: PeekLink): string => (link.kind === "wiki" ? link.page : link.path);

function setup(resolution: PeekResolution | ((page: string) => PeekResolution)) {
  const sheet = document.createElement("section");
  sheet.className = "pane";
  const paneEditor = document.createElement("div");
  paneEditor.className = "pane-editor";
  const before = document.createElement("button");
  before.textContent = "prima";
  paneEditor.append(before);
  sheet.append(paneEditor);
  document.body.append(sheet);
  before.focus();
  const log: string[] = [];
  const editors: FakeEditor[] = [];
  const deps: NotePeekDeps = {
    resolve: async (target) => (typeof resolution === "function" ? resolution(pageOf(target.link)) : resolution),
    editors: {
      open: async (path, host, options) => {
        log.push(`open ${path}`);
        const editor = fakeEditor(host, options, log);
        editors.push(editor);
        return editor;
      },
    },
    host: vi.fn(() => sheet),
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
    ownerChanged: vi.fn(),
    failed: vi.fn(),
  };
  const peek = createNotePeek(deps);
  const root = () => sheet.querySelector<HTMLElement>(".note-peek");
  return { sheet, before, log, editors, deps, peek, root };
}

const escape = (prevented = false): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  if (prevented) event.preventDefault();
  return event;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("la sbirciata", () => {
  it("apre la nota sopra il foglio con l'editor vero, il fuoco nel testo", async () => {
    const s = setup({ kind: "note", doc: "Luoghi/Biblioteca civica.md" });
    await s.peek.open(wiki("Biblioteca civica", "Orari"));
    expect(s.root()?.dataset.state).toBe("note");
    expect(s.root()?.querySelector(".note-peek-place-text")?.textContent).toBe("Luoghi");
    expect(s.root()?.getAttribute("aria-label")).toContain("Biblioteca civica");
    expect(s.editors[0]?.options).toMatchObject({ compact: false, readOnly: false, heading: "Orari" });
    expect(s.editors[0]?.host.classList.contains("pane-editor")).toBe(true);
    expect(document.activeElement?.classList.contains("fake-editor")).toBe(true);
    expect(s.peek.shown()).toEqual({ doc: "Luoghi/Biblioteca civica.md", page: "Biblioteca civica", state: "note" });
    expect(s.peek.isIn(s.sheet)).toBe(true);
  });

  it("risolve il link dalla nota che lo contiene", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    const resolve = vi.fn(async () => ({ kind: "note", doc: "Nota.md" }) as PeekResolution);
    s.deps.resolve = resolve;
    const peek = createNotePeek(s.deps);
    await peek.open({ link: { kind: "path", path: "../Nota.md" }, from: "Cartella/Sotto/Fonte.md" });
    expect(resolve).toHaveBeenCalledWith({ link: { kind: "path", path: "../Nota.md" }, from: "Cartella/Sotto/Fonte.md" });
    expect(s.log).toEqual(["open Nota.md"]);
  });

  it("Esc porta il testo alla sessione prima di smontare, e il fuoco torna dov'era", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    await s.peek.open(wiki("Nota"));
    s.root()!.querySelector(".fake-editor")!.dispatchEvent(escape());
    await vi.waitFor(() => expect(s.root()).toBeNull());
    expect(s.log).toEqual(["open Nota.md", "leave", "destroy"]);
    expect(document.activeElement).toBe(s.before);
    expect(s.peek.shown()).toBeNull();
  });

  it("un Esc che l'editor ha già usato resta suo; il secondo di fila chiude (vim)", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    await s.peek.open(wiki("Nota"));
    const text = s.root()!.querySelector(".fake-editor")!;
    // Il primo Esc porta vim al modo Normale: la sbirciata resta.
    text.dispatchEvent(escape(true));
    await Promise.resolve();
    expect(s.root()).not.toBeNull();
    expect(s.log).not.toContain("leave");
    // Un tasto in mezzo ricomincia il conto.
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    text.dispatchEvent(escape(true));
    await Promise.resolve();
    expect(s.root()).not.toBeNull();
    // Il secondo di fila chiude, anche se vim in modo Normale lo prende.
    text.dispatchEvent(escape(true));
    await vi.waitFor(() => expect(s.root()).toBeNull());
    expect(s.log).toEqual(["open Nota.md", "leave", "destroy"]);
  });

  it("«Apri qui» e «A lato»: prima il testo, poi il riquadro col cursore, poi la sbirciata si chiude", async () => {
    for (const where of ["here", "side"] as const) {
      const s = setup({ kind: "note", doc: "Nota.md" });
      await s.peek.open(wiki("Nota"));
      s.root()!.querySelector<HTMLButtonElement>(where === "here" ? ".note-peek-here" : ".note-peek-side")!.click();
      await vi.waitFor(() => expect(s.root()).toBeNull());
      expect(s.log).toEqual(["open Nota.md", "leave", `${where} Nota.md`, "destroy"]);
      expect(where === "here" ? s.deps.openHere : s.deps.openBeside).toHaveBeenCalledWith("Nota.md", { start: 12, end: 15 });
      document.body.replaceChildren();
    }
  });

  it("se il riquadro non prende la nota la sbirciata resta, e lo dice", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    s.deps.openHere = vi.fn(async () => {
      throw new Error("no");
    });
    const peek = createNotePeek(s.deps);
    await peek.open(wiki("Nota"));
    await peek.promote("here");
    expect(s.root()?.dataset.state).toBe("note");
    expect(s.deps.failed).toHaveBeenCalled();
  });

  // Le tre righe d'errore della sbirciata (aprire, creare, portare nel
  // riquadro) dicono che cosa e la specie: mai «[object Object]» davanti a un
  // errore tipizzato, mai l'id o la prosa del kernel.
  it("un errore tipizzato dell'host si legge con la specie, nelle tre righe della sbirciata", async () => {
    const refused = { kind: "internal", message: "parse failed: rich codec: invalid Zip archive" };
    const said = (s: ReturnType<typeof setup>) => String((s.deps.failed as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]);
    const expected = errorText(refused, "specie");

    const resolving = setup({ kind: "note", doc: "Nota.md" });
    resolving.deps.resolve = vi.fn(async () => { throw refused; });
    await createNotePeek(resolving.deps).open(wiki("Nota"));
    expect(said(resolving)).toContain(expected);
    document.body.replaceChildren();

    const creating = setup({ kind: "missing" });
    creating.deps.create = vi.fn(async () => { throw refused; });
    await creating.peek.open(wiki("Idea"));
    creating.root()!.querySelector<HTMLButtonElement>(".note-peek-create")!.click();
    await vi.waitFor(() => expect(creating.deps.failed).toHaveBeenCalled());
    expect(said(creating)).toContain(expected);
    expect(said(creating)).toContain("Idea");
    document.body.replaceChildren();

    const promoting = setup({ kind: "note", doc: "Nota.md" });
    promoting.deps.openHere = vi.fn(async () => { throw refused; });
    const peek = createNotePeek(promoting.deps);
    await peek.open(wiki("Nota"));
    await peek.promote("here");
    expect(said(promoting)).toContain(expected);
    for (const s of [resolving, creating, promoting]) {
      expect(said(s)).not.toContain("[object");
      expect(said(s)).not.toContain("parse failed");
    }
  });

  it("una sbirciata nuova durante un «Apri qui» che poi fallisce non lascia la vecchia orfana", async () => {
    const s = setup((page) => ({ kind: "note", doc: `${page}.md` }));
    let reject: (error: Error) => void = () => {};
    s.deps.openHere = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const peek = createNotePeek(s.deps);
    await peek.open(wiki("A"));
    const promoting = peek.promote("here");
    await vi.waitFor(() => expect(s.deps.openHere).toHaveBeenCalled());
    await peek.open(wiki("B"));
    reject(new Error("no"));
    await promoting;
    expect(s.sheet.querySelectorAll(".note-peek")).toHaveLength(1);
    expect(peek.shown()?.doc).toBe("B.md");
    // La vecchia non risponde più ai gesti.
    await peek.close();
    expect(s.sheet.querySelectorAll(".note-peek")).toHaveLength(0);
  });

  it("una nota che non c'è si crea col bersaglio scritto, cartella e punti compresi", async () => {
    for (const page of ["Progetti/Idea", "Verbale 15.11"]) {
      const s = setup({ kind: "missing" });
      await s.peek.open(wiki(page));
      expect(s.root()?.dataset.state).toBe("missing");
      expect(s.root()?.querySelector(".note-peek-message-title")?.textContent).toBe(page.split("/").pop());
      expect(s.root()?.querySelector<HTMLButtonElement>(".note-peek-here")?.disabled).toBe(true);
      expect(document.activeElement?.classList.contains("note-peek-create")).toBe(true);
      s.root()!.querySelector<HTMLButtonElement>(".note-peek-create")!.click();
      await vi.waitFor(() => expect(s.root()?.dataset.state).toBe("note"));
      expect(s.deps.create).toHaveBeenCalledWith(page, "Diario/Oggi.md");
      expect(s.log).toEqual([`open ${page}.md`]);
      document.body.replaceChildren();
    }
  });

  it("un percorso che non porta a niente non offre di creare", async () => {
    const s = setup({ kind: "missing" });
    await s.peek.open({ link: { kind: "path", path: "Carte/Manca.md" }, from: null });
    expect(s.root()?.dataset.state).toBe("missing");
    expect(s.root()?.querySelector(".note-peek-create")).toBeNull();
    expect(s.root()?.querySelector(".note-peek-message-title")?.textContent).toBe("Manca");
  });

  it("un link a un PDF o a un foglio si apre a lato, senza che un pannello compaia", async () => {
    const s = setup({ kind: "other", doc: "Carte/Pianta.pdf" });
    const added: Node[] = [];
    const watcher = new MutationObserver((records) => {
      for (const record of records) added.push(...record.addedNodes);
    });
    watcher.observe(s.sheet, { childList: true, subtree: true });
    const target: PeekTarget = { link: { kind: "wiki", page: "Pianta", heading: "page=3", block: null }, from: null };
    await s.peek.open(target);
    await Promise.resolve();
    watcher.disconnect();
    expect(s.root()).toBeNull();
    expect(added.some((node) => node instanceof Element && node.classList.contains("note-peek"))).toBe(false);
    expect(s.deps.host).not.toHaveBeenCalled();
    expect(s.deps.openOther).toHaveBeenCalledWith("Carte/Pianta.pdf", target);
  });

  it("la nota tolta sotto la sbirciata lo dice, invece di un editor che non salva", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    await s.peek.open(wiki("Nota"));
    s.editors[0]!.closeSession();
    expect(s.root()?.dataset.state).toBe("gone");
    expect(s.root()?.querySelector(".note-peek-create")).toBeNull();
    expect(s.log).toContain("destroy");
  });

  it("una seconda sbirciata chiude la prima salvandola; una risposta vecchia non la riempie", async () => {
    let release: (value: PeekResolution) => void = () => {};
    const s = setup({ kind: "note", doc: "A.md" });
    s.deps.resolve = (target) =>
      pageOf(target.link) === "Lenta" ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ kind: "note", doc: `${pageOf(target.link)}.md` });
    const peek = createNotePeek(s.deps);
    await peek.open(wiki("A"));
    const slow = peek.open(wiki("Lenta"));
    await vi.waitFor(() => expect(s.log).toContain("leave"));
    await peek.open(wiki("B"));
    release({ kind: "note", doc: "Lenta.md" });
    await slow;
    expect(s.log).not.toContain("open Lenta.md");
    expect(peek.shown()?.doc).toBe("B.md");
    expect(s.sheet.querySelectorAll(".note-peek")).toHaveLength(1);
  });

  it("dismiss chiude subito, e senza domande se è quieto; il Chiudi salva e chiude", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    await s.peek.open(wiki("Nota"));
    s.peek.dismiss();
    expect(s.root()).toBeNull();
    expect(s.log).toEqual(["open Nota.md", "destroy"]);
    await s.peek.open(wiki("Nota"));
    s.peek.dismiss({ quiet: true });
    expect(s.log.slice(-1)).toEqual(["destroy quiet"]);
    await s.peek.open(wiki("Nota"));
    s.root()!.querySelector<HTMLButtonElement>(".note-peek-close")!.click();
    await vi.waitFor(() => expect(s.root()).toBeNull());
    expect(s.log.slice(-2)).toEqual(["leave", "destroy"]);
  });

  it("ha la scrittura finché il fuoco non torna al testo del riquadro", async () => {
    const s = setup({ kind: "note", doc: "Nota.md" });
    await s.peek.open(wiki("Nota"));
    expect(s.peek.surface()).toBe(s.editors[0]!.fakeSurface);
    expect(s.deps.ownerChanged).toHaveBeenCalledTimes(1);
    // Il fuoco fuori dal riquadro (la palette, la barra) non la toglie.
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    expect(s.peek.surface()).toBe(s.editors[0]!.fakeSurface);
    s.before.focus();
    expect(s.peek.surface()).toBeNull();
    expect(s.deps.ownerChanged).toHaveBeenCalledTimes(2);
    s.editors[0]!.focus();
    expect(s.peek.surface()).not.toBeNull();
    s.peek.dismiss();
    expect(s.peek.surface()).toBeNull();
    expect(s.deps.ownerChanged).toHaveBeenCalledTimes(4);
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

  it("il nome di un link che non porta a niente tiene i punti", () => {
    expect(linkName({ kind: "wiki", page: "Verbale 15.11", heading: null, block: null })).toBe("Verbale 15.11");
    expect(linkName({ kind: "wiki", page: "Progetti/Idea", heading: null, block: null })).toBe("Idea");
    expect(linkName({ kind: "path", path: "Carte/Nota.md#Titolo" })).toBe("Nota");
  });
});
