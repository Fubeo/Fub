// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Heading, IndexResult, IndexQuery } from "../../../host/contract";
import { listenerLedger, press } from "../../../kit/testing";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

/// Lo stato finto della shell: ciò che i moduli veri direbbero.
const world = vi.hoisted(() => ({
  query: null as null | ((query: { kind: string; doc?: string }) => Promise<unknown>),
  docs: new Map<string, string | null>(),
  signals: new Map<string, Set<(...args: never[]) => void>>(),
  events: new Map<string, Set<(event: never) => void>>(),
  languages: new Set<() => void>(),
  language: "it",
  log: [] as string[],
  reveal: null as null | ((doc: string, target: unknown) => Promise<void>),
  notices: [] as { message: string; tone: string }[],
}));

vi.mock("../../../host/ipc", () => ({
  api: { queryIndex: (query: { kind: string; doc?: string }) => world.query!(query) },
}));
vi.mock("../../../host/errors", () => ({
  errorText: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
vi.mock("../../../state/document-controller", () => ({
  focusEditor: () => void world.log.push("editor"),
  reveal: (doc: string, target: unknown) => world.reveal!(doc, target),
}));
vi.mock("../../../state/kernel", () => ({
  onEvent: (type: string, handler: (event: never) => void) => {
    const set = world.events.get(type) ?? new Set();
    world.events.set(type, set);
    set.add(handler);
    return () => void set.delete(handler);
  },
}));
vi.mock("../../../state/layout", () => ({
  activeDoc: (pane: string) => world.docs.get(pane) ?? null,
  focusPane: (pane: string) => void world.log.push(`focus ${pane}`),
}));
vi.mock("../../../state/store", () => ({
  on: (signal: string, listener: (...args: never[]) => void) => {
    const set = world.signals.get(signal) ?? new Set();
    world.signals.set(signal, set);
    set.add(listener);
    return () => void set.delete(listener);
  },
}));
vi.mock("../../../ui/notify", () => ({
  notify: (message: string, tone: string) => void world.notices.push({ message, tone }),
}));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, string>) =>
    `${world.language}:${key}${args ? ` ${Object.values(args).join(" | ")}` : ""}`,
  onLanguage: (listener: () => void) => {
    world.languages.add(listener);
    return () => void world.languages.delete(listener);
  },
}));

import { mountHeadingThread } from "./heading-thread";

/// L'osservatore delle misure, che happy-dom non fa scattare: lo si fa a mano.
class Resize {
  static all: Resize[] = [];
  readonly targets = new Set<Element>();
  disconnected = false;
  constructor(private readonly react: (entries: { target: Element }[]) => void) {
    Resize.all.push(this);
  }
  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.targets.clear();
    this.disconnected = true;
  }
  /// Come il browser: avvisa solo di ciò che sta guardando.
  static fire(target: Element): void {
    for (const each of Resize.all) if (each.targets.has(target)) each.react([{ target }]);
  }
  static watching(): number {
    return Resize.all.reduce((sum, each) => sum + each.targets.size, 0);
  }
}

interface Sheet {
  root: HTMLElement;
  panel: HTMLElement;
  editor: HTMLElement;
  content: HTMLElement;
  preview: HTMLElement;
}

let lifetime: Lifetime;
let panes: HTMLElement;
let asked: string[];
let outlines: Map<string, Heading[]>;

/// Le misure che happy-dom non calcola: da dove a dove va un elemento.
function box(el: HTMLElement, left: number, right: number): void {
  el.getBoundingClientRect = () =>
    ({ left, right, width: right - left, top: 0, bottom: 600, height: 600, x: left, y: 0 }) as DOMRect;
}

/// Un foglio com'è scritto dalla vista. `width` è la sua larghezza, `margin` lo
/// spazio fra il testo e il bordo destro, in ogni modalità.
function sheet(id: string, doc: string | null, options: { mode?: string; width?: number; margin?: number } = {}): Sheet {
  const width = options.width ?? 672;
  const margin = options.margin ?? 32;
  const root = document.createElement("section");
  root.className = "pane";
  root.dataset.pane = id;
  const toolbar = document.createElement("div");
  toolbar.className = "pane-toolbar";
  const panel = document.createElement("div");
  panel.setAttribute("role", "tabpanel");
  const editor = document.createElement("div");
  editor.className = "pane-editor";
  editor.dataset.markdownMode = options.mode ?? "live_preview";
  const cm = document.createElement("div");
  cm.className = "cm-editor";
  const content = document.createElement("div");
  content.className = "cm-content";
  content.tabIndex = 0;
  cm.append(content);
  const preview = document.createElement("div");
  preview.className = "pane-preview markdown-preview";
  editor.append(cm, preview);
  panel.append(editor);
  root.append(toolbar, panel);
  panes.append(root);
  world.docs.set(id, doc);
  const made = { root, panel, editor, content, preview };
  measure(made, width, margin);
  return made;
}

/// Il foglio largo `width`, col testo che finisce `margin` prima del bordo.
function measure(made: Sheet, width: number, margin: number, surface: "both" | "content" | "preview" = "both"): void {
  box(made.panel, 100, 100 + width);
  for (const each of [made.content, made.preview]) {
    if (surface !== "both" && each !== made[surface]) continue;
    box(each, 100, 100 + width);
    each.style.paddingRight = `${margin}px`;
  }
}

const heading = (level: number, text: string, start: number): Heading =>
  ({ level, text, slug: text.toLowerCase(), span: { start, end: start + text.length }, explicit_anchor: null }) as Heading;

const navOf = (made: Sheet): HTMLElement | null => made.panel.querySelector<HTMLElement>(":scope > .sheet-thread");
const itemsOf = (made: Sheet): HTMLButtonElement[] => [
  ...made.panel.querySelectorAll<HTMLButtonElement>(".sheet-thread-item"),
];
const namesOf = (made: Sheet): string[] => itemsOf(made).map((item) => item.getAttribute("aria-label") ?? "");
const shown = (made: Sheet): boolean => navOf(made)?.hidden === false;

function emit(signal: string): void {
  for (const listener of [...(world.signals.get(signal) ?? [])]) (listener as () => void)();
}
function kernel(type: string, event: Record<string, unknown> = {}): void {
  for (const handler of [...(world.events.get(type) ?? [])]) (handler as (event: unknown) => void)({ type, ...event });
}

/// Gli osservatori consegnano a fine giro; le promesse pure.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const answer = (value: Heading[]): IndexResult => ({ kind: "outline", value }) as IndexResult;

beforeEach(() => {
  Resize.all = [];
  vi.stubGlobal("ResizeObserver", Resize);
  asked = [];
  outlines = new Map([
    [
      "Guida/Sintassi.md",
      [heading(1, "Sintassi", 0), heading(2, "Titoli", 20), heading(3, "Riferimenti", 60), heading(2, "Tabella", 90)],
    ],
  ]);
  world.query = async (query) => {
    const { kind, doc } = query as IndexQuery & { doc?: string };
    asked.push(`${kind} ${doc ?? ""}`);
    return answer(outlines.get(doc ?? "") ?? []);
  };
  world.docs = new Map();
  world.signals = new Map();
  world.events = new Map();
  world.languages = new Set();
  world.language = "it";
  world.log = [];
  world.reveal = async (doc, target) => void world.log.push(`reveal ${doc} ${JSON.stringify(target)}`);
  world.notices = [];
  document.body.innerHTML = '<div id="panes"></div>';
  panes = document.getElementById("panes")!;
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("il filo dei titoli: ciò che mostra", () => {
  it("mette una tacca per ogni titolo, nell'ordine del documento e col suo livello", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    expect(asked).toEqual(["outline Guida/Sintassi.md"]);
    expect(shown(made)).toBe(true);
    expect(namesOf(made)).toEqual(["Sintassi", "Titoli", "Riferimenti", "Tabella"]);
    expect(itemsOf(made).map((item) => item.dataset.level)).toEqual(["1", "2", "3", "2"]);
    expect(itemsOf(made).every((item) => item.type === "button")).toBe(true);
  });

  it("è una regione col nome del documento, e viene prima del testo nell'ordine del Tab", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    const nav = navOf(made)!;
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe("it:sheet.thread.label Sintassi");
    expect(made.panel.firstElementChild).toBe(nav);
    // Una fermata sola: dentro ci si muove con le frecce.
    expect(itemsOf(made).map((item) => item.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it("dà a ogni voce il nome del titolo anche quando il testo non si vede", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    const first = itemsOf(made)[0]!;
    expect(first.getAttribute("aria-label")).toBe("Sintassi");
    expect(first.querySelector(".sheet-thread-notch")!.getAttribute("aria-hidden")).toBe("true");
    const text = first.querySelector(".sheet-thread-text")!;
    expect(text.textContent).toBe("Sintassi");
    expect(text.getAttribute("aria-hidden")).toBe("true");
  });

  it("tiene i livelli fra uno e sei, qualunque cosa dica l'indice", async () => {
    outlines.set("Strano.md", [heading(0, "Zero", 0), heading(9, "Nove", 10), heading(2.7, "Rotto", 20)]);
    const made = sheet("p1", "Strano.md");
    mountHeadingThread(lifetime);
    await settled();

    expect(itemsOf(made).map((item) => item.dataset.level)).toEqual(["1", "6", "2"]);
  });

  it("non c'è per un documento senza titoli", async () => {
    const made = sheet("p1", "Piatto.md");
    mountHeadingThread(lifetime);
    await settled();

    expect(asked).toEqual(["outline Piatto.md"]);
    expect(shown(made)).toBe(false);
    expect(itemsOf(made)).toEqual([]);
  });

  it("non c'è, e non chiede niente, in un foglio senza documento", async () => {
    const made = sheet("p1", null);
    mountHeadingThread(lifetime);
    await settled();

    expect(asked).toEqual([]);
    expect(shown(made)).toBe(false);
  });

  it("non c'è quando l'indice non risponde, e non avvisa nessuno", async () => {
    world.query = async (query) => {
      asked.push(`${query.kind} ${query.doc ?? ""}`);
      throw new Error("indice spento");
    };
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    expect(asked).toHaveLength(1);
    expect(shown(made)).toBe(false);
    expect(world.notices).toEqual([]);
  });

  it("non c'è quando l'indice risponde un'altra cosa", async () => {
    world.query = async () => ({ kind: "backlinks", value: [] });
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    expect(shown(made)).toBe(false);
    expect(itemsOf(made)).toEqual([]);
  });

  it("ogni foglio ha il suo filo, col suo documento", async () => {
    outlines.set("Altra.md", [heading(1, "Altra", 0)]);
    const first = sheet("p1", "Guida/Sintassi.md");
    const second = sheet("p2", "Altra.md");
    mountHeadingThread(lifetime);
    await settled();

    expect(asked.sort()).toEqual(["outline Altra.md", "outline Guida/Sintassi.md"]);
    expect(namesOf(first)).toHaveLength(4);
    expect(namesOf(second)).toEqual(["Altra"]);
  });
});

describe("il filo dei titoli: lo spazio", () => {
  it("sparisce quando il margine a destra del testo non basta", async () => {
    const made = sheet("p1", "Guida/Sintassi.md", { margin: 29 });
    mountHeadingThread(lifetime);
    await settled();

    expect(itemsOf(made)).toHaveLength(4);
    expect(shown(made)).toBe(false);
  });

  it("resta quando il margine è appena quello che serve", async () => {
    const made = sheet("p1", "Guida/Sintassi.md", { margin: 30 });
    mountHeadingThread(lifetime);
    await settled();

    expect(shown(made)).toBe(true);
  });

  it("sparisce nei fogli troppo stretti per un indice, anche col margine", async () => {
    const made = sheet("p1", "Guida/Sintassi.md", { width: 439, margin: 32 });
    mountHeadingThread(lifetime);
    await settled();

    expect(shown(made)).toBe(false);
  });

  it("segue la larghezza del foglio senza richiedere i titoli", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    expect(shown(made)).toBe(true);

    measure(made, 300, 32);
    Resize.fire(made.panel);
    expect(shown(made)).toBe(false);

    measure(made, 700, 32);
    Resize.fire(made.panel);
    expect(shown(made)).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("in Lettura misura l'anteprima, non l'editor", async () => {
    const made = sheet("p1", "Guida/Sintassi.md", { mode: "reading" });
    measure(made, 672, 8, "content");
    mountHeadingThread(lifetime);
    await settled();
    expect(shown(made)).toBe(true);

    measure(made, 672, 8, "preview");
    Resize.fire(made.panel);
    expect(shown(made)).toBe(false);
  });

  it("misura di nuovo quando cambia la modalità, senza richiedere i titoli", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    // L'editor ha il margine, l'anteprima no.
    measure(made, 672, 8, "preview");
    mountHeadingThread(lifetime);
    await settled();
    expect(shown(made)).toBe(true);

    made.editor.dataset.markdownMode = "reading";
    await settled();
    expect(shown(made)).toBe(false);

    made.editor.dataset.markdownMode = "source";
    await settled();
    expect(shown(made)).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("conta il margine della colonna quando il testo è più stretto del foglio", async () => {
    const made = sheet("p1", "Guida/Sintassi.md", { width: 1000, margin: 0 });
    // La colonna finisce 120px prima del bordo: il margine c'è, senza padding.
    box(made.content, 220, 980);
    mountHeadingThread(lifetime);
    await settled();

    expect(shown(made)).toBe(true);
  });

  it("senza una superficie da misurare non c'è", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    made.content.remove();
    mountHeadingThread(lifetime);
    await settled();

    expect(shown(made)).toBe(false);
  });
});

describe("il filo dei titoli: i gesti", () => {
  it("scegliere una voce porta il fuoco sul foglio e poi il testo su quel titolo", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    itemsOf(made)[2]!.click();

    expect(world.log).toEqual(["focus p1", 'reveal Guida/Sintassi.md {"span":{"start":60,"end":71}}']);
  });

  it("il clic vale anche sul testo dentro la voce", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    itemsOf(made)[1]!.querySelector<HTMLElement>(".sheet-thread-text")!.click();

    expect(world.log).toEqual(["focus p1", 'reveal Guida/Sintassi.md {"span":{"start":20,"end":26}}']);
  });

  it("con la stessa nota in due fogli, salta in quello del filo che si è usato", async () => {
    sheet("p1", "Guida/Sintassi.md");
    const second = sheet("p2", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    itemsOf(second)[0]!.click();

    expect(world.log[0]).toBe("focus p2");
  });

  it("un salto che fallisce lo dice, con la ragione", async () => {
    world.reveal = async () => {
      throw new Error("sparita");
    };
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    itemsOf(made)[0]!.click();
    await settled();

    expect(world.notices).toEqual([{ message: "it:preview.open_failed Guida/Sintassi.md | sparita", tone: "guasto" }]);
  });

  it("le frecce, Inizio e Fine spostano il fuoco fra le voci, e la fermata del Tab con lui", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    const all = itemsOf(made);
    all[0]!.focus();

    expect(press(all[0]!, "ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(all[1]);
    expect(all.map((item) => item.tabIndex)).toEqual([-1, 0, -1, -1]);

    press(all[1]!, "End");
    expect(document.activeElement).toBe(all[3]);
    press(all[3]!, "ArrowUp");
    expect(document.activeElement).toBe(all[2]);
    press(all[2]!, "Home");
    expect(document.activeElement).toBe(all[0]);
    expect(all.map((item) => item.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it("agli estremi le frecce non girano e non consumano il tasto", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    const all = itemsOf(made);
    all[0]!.focus();

    expect(press(all[0]!, "ArrowUp").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(all[0]);
    all[3]!.focus();
    expect(press(all[3]!, "ArrowDown").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(all[3]);
  });

  it("coi modificatori i tasti restano di chi li aspetta", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    const all = itemsOf(made);
    all[0]!.focus();

    expect(press(all[0]!, "ArrowDown", { altKey: true }).defaultPrevented).toBe(false);
    expect(press(all[0]!, "End", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(all[0]!, "Escape", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(all[0]);
    expect(world.log).toEqual([]);
  });

  it("Esc torna al testo del foglio, e non arriva a chi sta sopra", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    const above = vi.fn();
    made.root.addEventListener("keydown", above);
    const first = itemsOf(made)[0]!;
    first.focus();

    const event = press(first, "Escape");

    expect(event.defaultPrevented).toBe(true);
    expect(above).not.toHaveBeenCalled();
    expect(world.log).toEqual(["focus p1", "editor"]);
  });
});

describe("il filo dei titoli: i dati che cambiano", () => {
  it("si aggiorna quando il kernel dice che il documento è cambiato", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    outlines.set("Guida/Sintassi.md", [heading(1, "Sintassi", 0), heading(2, "Nuovo", 20)]);
    kernel("document_changed", { id: "Guida/Sintassi.md" });
    await settled();

    expect(asked).toHaveLength(2);
    expect(namesOf(made)).toEqual(["Sintassi", "Nuovo"]);
  });

  it("non chiede niente per il cambio di un altro documento", async () => {
    sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    kernel("document_changed", { id: "Altra.md" });
    kernel("batch_ended", { changed: ["Altra.md", "Terza.md"] });
    await settled();

    expect(asked).toHaveLength(1);
  });

  it("si aggiorna alla fine di un lotto che tocca il suo documento", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    outlines.set("Guida/Sintassi.md", [heading(1, "Dopo il lotto", 0)]);
    kernel("batch_ended", { changed: ["Altra.md", "Guida/Sintassi.md"] });
    await settled();

    expect(asked).toHaveLength(2);
    expect(namesOf(made)).toEqual(["Dopo il lotto"]);
  });

  it("si aggiorna quando l'indice è stato rifatto, in ogni foglio", async () => {
    outlines.set("Altra.md", [heading(1, "Altra", 0)]);
    sheet("p1", "Guida/Sintassi.md");
    sheet("p2", "Altra.md");
    mountHeadingThread(lifetime);
    await settled();
    asked.length = 0;

    kernel("index_updated");
    await settled();

    expect(asked.sort()).toEqual(["outline Altra.md", "outline Guida/Sintassi.md"]);
  });

  it("più segnali nello stesso giro fanno una domanda sola", async () => {
    sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    kernel("document_changed", { id: "Guida/Sintassi.md" });
    kernel("batch_ended", { changed: ["Guida/Sintassi.md"] });
    kernel("index_updated");
    await settled();

    expect(asked).toHaveLength(2);
  });

  it("non chiede niente mentre si scrive: le battute non sono fatti del kernel", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    for (const key of ["#", " ", "T", "i", "t", "o", "l", "o"]) {
      press(made.content, key);
      made.content.dispatchEvent(new Event("input", { bubbles: true }));
      made.content.append(document.createTextNode(key));
    }
    emit("layout");
    await settled();

    expect(asked).toHaveLength(1);
  });

  it("non riscrive ciò che non è cambiato", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    const before = itemsOf(made);

    kernel("document_changed", { id: "Guida/Sintassi.md" });
    await settled();

    expect(asked).toHaveLength(2);
    expect(itemsOf(made)).toEqual(before);
    expect(itemsOf(made)[0]).toBe(before[0]);
  });

  it("chi era dentro con la tastiera resta sulla voce allo stesso posto", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    const all = itemsOf(made);
    all[0]!.focus();
    press(all[0]!, "ArrowDown");
    press(all[1]!, "ArrowDown");

    outlines.set("Guida/Sintassi.md", [heading(1, "Sintassi", 0), heading(2, "Uno", 20), heading(2, "Due", 40)]);
    kernel("document_changed", { id: "Guida/Sintassi.md" });
    await settled();

    const next = itemsOf(made);
    expect(document.activeElement).toBe(next[2]);
    expect(next.map((item) => item.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("se i titoli diminuiscono, il fuoco resta sull'ultimo che c'è", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    const all = itemsOf(made);
    all[0]!.focus();
    press(all[0]!, "End");

    outlines.set("Guida/Sintassi.md", [heading(1, "Sintassi", 0), heading(2, "Solo", 20)]);
    kernel("document_changed", { id: "Guida/Sintassi.md" });
    await settled();

    expect(document.activeElement).toBe(itemsOf(made)[1]);
  });

  it("quando il foglio passa a un'altra nota toglie subito i titoli di prima", async () => {
    outlines.set("Altra.md", [heading(1, "Altra", 0)]);
    const slow = deferred<IndexResult>();
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    world.query = (query) => {
      asked.push(`${query.kind} ${query.doc ?? ""}`);
      return slow.promise;
    };
    world.docs.set("p1", "Altra.md");
    emit("active-doc");

    expect(itemsOf(made)).toEqual([]);
    expect(shown(made)).toBe(false);

    slow.resolve(answer(outlines.get("Altra.md")!));
    await settled();
    expect(asked).toEqual(["outline Guida/Sintassi.md", "outline Altra.md"]);
    expect(namesOf(made)).toEqual(["Altra"]);
    expect(navOf(made)!.getAttribute("aria-label")).toBe("it:sheet.thread.label Altra");
    expect(shown(made)).toBe(true);
  });

  it("quando il foglio resta senza documento il filo sparisce", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    world.docs.set("p1", null);
    emit("layout");
    await settled();

    expect(shown(made)).toBe(false);
    expect(itemsOf(made)).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it("un cambio del layout che non tocca il documento non chiede niente", async () => {
    sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    emit("layout");
    emit("active-doc");
    await settled();

    expect(asked).toHaveLength(1);
  });

  it("col cambio di lingua ridice il nome della regione, senza richiedere i titoli", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    world.language = "en";
    for (const listener of [...world.languages]) listener();

    expect(navOf(made)!.getAttribute("aria-label")).toBe("en:sheet.thread.label Sintassi");
    expect(namesOf(made)).toHaveLength(4);
    expect(asked).toHaveLength(1);
  });

  it("un foglio aggiunto dopo ha il suo filo", async () => {
    sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    outlines.set("Altra.md", [heading(1, "Altra", 0)]);

    const second = sheet("p2", "Altra.md");
    await settled();

    expect(namesOf(second)).toEqual(["Altra"]);
    expect(shown(second)).toBe(true);
  });

  it("se la vista toglie il filo dal pannello, al prossimo giro torna al suo posto", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    const nav = navOf(made)!;

    nav.remove();
    emit("layout");

    expect(made.panel.firstElementChild).toBe(nav);
    expect(asked).toHaveLength(1);
  });
});

describe("il filo dei titoli: le corse", () => {
  it("la risposta di una nota che il foglio non mostra più non disegna niente", async () => {
    outlines.set("Altra.md", [heading(1, "Altra", 0)]);
    const slow = deferred<IndexResult>();
    world.query = (query) => {
      asked.push(`${query.kind} ${query.doc ?? ""}`);
      return query.doc === "Guida/Sintassi.md" ? slow.promise : Promise.resolve(answer(outlines.get(query.doc ?? "") ?? []));
    };
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    world.docs.set("p1", "Altra.md");
    emit("active-doc");
    await settled();
    expect(namesOf(made)).toEqual(["Altra"]);

    slow.resolve(answer(outlines.get("Guida/Sintassi.md")!));
    await settled();

    expect(namesOf(made)).toEqual(["Altra"]);
  });

  it("di due risposte per la stessa nota vale quella della domanda più recente", async () => {
    const first = deferred<IndexResult>();
    const second = deferred<IndexResult>();
    const queue = [first, second];
    world.query = (query) => {
      asked.push(`${query.kind} ${query.doc ?? ""}`);
      return queue.shift()!.promise;
    };
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    kernel("document_changed", { id: "Guida/Sintassi.md" });
    await settled();
    expect(asked).toHaveLength(2);

    second.resolve(answer([heading(1, "Recente", 0)]));
    await settled();
    first.resolve(answer([heading(1, "Vecchia", 0)]));
    await settled();

    expect(namesOf(made)).toEqual(["Recente"]);
  });

  it("una risposta arrivata dopo lo smontaggio non disegna niente", async () => {
    const slow = deferred<IndexResult>();
    world.query = () => slow.promise;
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    lifetime.close();
    slow.resolve(answer(outlines.get("Guida/Sintassi.md")!));
    await settled();

    expect(navOf(made)).toBeNull();
    expect(made.panel.querySelector(".sheet-thread-item")).toBeNull();
  });

  it("una risposta arrivata dopo che il foglio è stato tolto non disegna niente", async () => {
    const slow = deferred<IndexResult>();
    world.query = (query) => {
      asked.push(`${query.kind} ${query.doc ?? ""}`);
      return query.doc === "Lenta.md" ? slow.promise : Promise.resolve(answer([]));
    };
    sheet("p1", "Piatto.md");
    const gone = sheet("p2", "Lenta.md");
    mountHeadingThread(lifetime);
    await settled();

    gone.root.remove();
    await settled();
    slow.resolve(answer([heading(1, "Tardi", 0)]));
    await settled();

    expect(navOf(gone)).toBeNull();
    expect(gone.panel.querySelector(".sheet-thread-item")).toBeNull();
  });

  it("un foglio tolto non viene più guardato, né richiesto", async () => {
    const stay = sheet("p1", "Guida/Sintassi.md");
    const gone = sheet("p2", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    expect(Resize.watching()).toBe(2);
    asked.length = 0;

    gone.root.remove();
    await settled();
    kernel("document_changed", { id: "Guida/Sintassi.md" });
    await settled();

    expect(Resize.watching()).toBe(1);
    expect(asked).toEqual(["outline Guida/Sintassi.md"]);
    expect(navOf(gone)).toBeNull();
    expect(shown(stay)).toBe(true);
  });

  it("tolto l'ultimo foglio, il prossimo cambio del layout lascia andare il suo filo", async () => {
    const gone = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    asked.length = 0;

    gone.root.remove();
    emit("layout");
    kernel("index_updated");
    await settled();

    expect(Resize.watching()).toBe(0);
    expect(asked).toEqual([]);
  });

  it("un salto che fallisce dopo lo smontaggio non avvisa nessuno", async () => {
    const slow = deferred<void>();
    world.reveal = () => slow.promise;
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();
    itemsOf(made)[0]!.click();

    lifetime.close();
    slow.reject(new Error("tardi"));
    await settled();

    expect(world.notices).toEqual([]);
  });
});

describe("il filo dei titoli: lo smontaggio", () => {
  it("non lascia niente: né nodi, né ascolti, né iscrizioni, né misure", async () => {
    const made = sheet("p1", "Guida/Sintassi.md");
    const listening = listenerLedger(document, window, panes, made.panel, made.editor);
    mountHeadingThread(lifetime);
    await settled();
    const nav = navOf(made)!;
    expect(Resize.watching()).toBe(1);

    lifetime.close();

    expect(navOf(made)).toBeNull();
    expect(nav.isConnected).toBe(false);
    expect(listening()).toBe(0);
    expect([...world.signals.values()].every((set) => set.size === 0)).toBe(true);
    expect([...world.events.values()].every((set) => set.size === 0)).toBe(true);
    expect(world.languages.size).toBe(0);
    expect(Resize.watching()).toBe(0);
    expect(Resize.all.every((each) => each.disconnected)).toBe(true);
    asked.length = 0;

    // Il mondo continua a muoversi: nessuno rimette il filo, nessuno chiede.
    made.editor.dataset.markdownMode = "reading";
    sheet("p2", "Guida/Sintassi.md");
    await settled();
    expect(document.querySelector(".sheet-thread")).toBeNull();
    expect(asked).toEqual([]);
  });

  it("senza i fogli non monta niente", () => {
    document.body.innerHTML = "";
    mountHeadingThread(lifetime);

    expect(world.signals.size).toBe(0);
    expect(world.events.size).toBe(0);
    expect(world.languages.size).toBe(0);
  });

  it("dove nessuno misura le larghezze funziona lo stesso", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const made = sheet("p1", "Guida/Sintassi.md");
    mountHeadingThread(lifetime);
    await settled();

    expect(shown(made)).toBe(true);
    lifetime.close();
    expect(navOf(made)).toBeNull();
  });
});
