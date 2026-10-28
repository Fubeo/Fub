// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenerLedger, press } from "../../../kit/testing";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference, type ManualDriver } from "../../../moto";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

type Listener = (...args: never[]) => unknown;

/// Lo stato finto della shell: ciò che i moduli veri direbbero.
const world = vi.hoisted(() => ({
  focus: "main",
  doc: "Guida/Nota.md" as string | null,
  saveState: "salvato" as string | null,
  base: { kind: "descends_from", value: "8842117" } as { kind: string; value?: string },
  commands: [] as { id: string; title: string; binding: string | null; run: (() => unknown) | null }[],
  sessions: new Set<(event: { kind: string; id: string }) => void>(),
  events: new Map<string, Set<Listener>>(),
  signals: new Map<string, Set<Listener>>(),
  languages: new Set<() => void>(),
  confirm: null as null | ((message: string, options: unknown) => Promise<boolean>),
}));

function subscribe<K>(map: Map<K, Set<Listener>>, key: K, listener: Listener): () => void {
  const list = map.get(key) ?? new Set<Listener>();
  map.set(key, list);
  list.add(listener);
  return () => void list.delete(listener);
}

vi.mock("../../../ui/commands", () => ({
  allCommands: () => world.commands,
  displayBinding: (binding: string | null) => (binding ? "Ctrl+S" : ""),
}));
vi.mock("../../../state/layout", () => ({
  layout: world,
  activeDoc: () => world.doc,
}));
vi.mock("../../../state/document-session", () => ({
  documentSessions: {
    subscribe: (listener: (event: { kind: string; id: string }) => void) => {
      world.sessions.add(listener);
      return () => void world.sessions.delete(listener);
    },
    inspect: () => ({ base: world.base }),
    saveState: () => world.saveState,
  },
}));
vi.mock("../../../state/kernel", () => ({
  onEvent: (type: string, handler: Listener) => subscribe(world.events, type, handler),
}));
vi.mock("../../../state/store", () => ({
  on: (signal: string, listener: Listener) => subscribe(world.signals, signal, listener),
}));
vi.mock("../../../host/dialog", () => ({
  confirm: (message: string, options: unknown) => world.confirm!(message, options),
}));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, string>) => (args ? `${key} ${Object.values(args).join(" ")}` : key),
  onLanguage: (listener: () => void) => {
    world.languages.add(listener);
    return () => void world.languages.delete(listener);
  },
  resolvedLanguage: () => "it",
}));
vi.mock("../../../ui/tooltip", () => ({ setTooltip: () => {}, attachTooltip: () => () => {}, dismissTooltip: () => {} }));
vi.mock("../../../ui/icons", () => ({ iconEl: () => null }));

import { mountSaveState } from "./save-state";

let driver: ManualDriver;
let lifetime: Lifetime;
let group: HTMLElement;
let live: HTMLElement;

const WORDS: Record<string, string> = {
  salvato: "Salvato",
  in_corso: "Salvataggio…",
  non_salvato: "Non salvato",
  fallito: "Salvataggio fallito",
  conflitto: "Cambiato su disco",
};

/// Ciò che fa `drawSave` della vista: una parola e un `data-state`, o niente.
function drawSave(state: string | null): void {
  world.saveState = state;
  if (state === null) {
    live.textContent = "";
    delete live.dataset.state;
    return;
  }
  live.dataset.state = state;
  live.textContent = WORDS[state]!;
}

/// Gli osservatori consegnano a fine giro.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const button = (): HTMLButtonElement => group.querySelector<HTMLButtonElement>("button.sheet-save")!;
const panel = (): HTMLElement | null => document.querySelector<HTMLElement>(".kit-popover .sheet-save-panel");
const actions = (): HTMLButtonElement[] => [...(panel()?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
const facts = (): string[] => [...(panel()?.querySelectorAll("dt, dd") ?? [])].map((el) => el.textContent ?? "");

function emit(map: Map<string, Set<Listener>>, key: string, ...args: unknown[]): void {
  for (const listener of [...(map.get(key) ?? [])]) (listener as (...a: unknown[]) => unknown)(...args);
}

function commandsOf(...ids: string[]): Record<string, ReturnType<typeof vi.fn<() => void>>> {
  const runs: Record<string, ReturnType<typeof vi.fn<() => void>>> = {};
  world.commands = ids.map((id) => {
    const run = vi.fn<() => void>();
    runs[id] = run;
    return { id, title: `titolo ${id}`, binding: id === "shell.doc.save" ? "Mod-s" : null, run: () => run() };
  });
  return runs;
}

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  world.focus = "main";
  world.doc = "Guida/Nota.md";
  world.base = { kind: "descends_from", value: "8842117" };
  world.confirm = null;
  commandsOf("shell.doc.save", "shell.doc.conflict.mine", "shell.doc.conflict.theirs");
  document.body.innerHTML =
    '<div id="panes"><section class="pane" data-pane="main"><div class="pane-toolbar"><span class="pane-status-slot">' +
    '<div id="pane-status" class="pane-status"><span id="save-state" class="save-state" role="status"></span></div>' +
    "</span></div></section></div>";
  group = document.getElementById("pane-status")!;
  live = document.getElementById("save-state")!;
  drawSave("salvato");
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("lo stato di salvataggio come bottone", () => {
  it("ripete la parola della vista e la lascia come regione viva, fuori dalla vista", () => {
    mountSaveState(lifetime);
    expect(button().textContent).toBe("Salvato");
    expect(button().dataset.state).toBe("salvato");
    expect(button().getAttribute("aria-label")).toBe("sheet.save.button Salvato");
    expect(button().getAttribute("aria-haspopup")).toBe("dialog");
    expect(button().type).toBe("button");
    expect(live.nextElementSibling).toBe(button());
    expect(live.getAttribute("role")).toBe("status");
    expect(live.classList.contains("sr-only")).toBe(true);
  });

  it("segue la vista quando ridisegna lo stato: parola, stato e nome accessibile", async () => {
    mountSaveState(lifetime);
    drawSave("non_salvato");
    await settled();
    expect(button().textContent).toBe("Non salvato");
    expect(button().dataset.state).toBe("non_salvato");
    expect(button().getAttribute("aria-label")).toBe("sheet.save.button Non salvato");
    drawSave("fallito");
    await settled();
    expect(button().dataset.state).toBe("fallito");
    expect(button().getAttribute("aria-label")).toBe("sheet.save.button Salvataggio fallito");
  });

  it("senza stato non c'è bottone da premere", async () => {
    mountSaveState(lifetime);
    drawSave(null);
    await settled();
    expect(button().hidden).toBe(true);
    expect(button().hasAttribute("aria-label")).toBe(false);
    button().click();
    expect(panel()).toBeNull();
    drawSave("salvato");
    await settled();
    expect(button().hidden).toBe(false);
  });

  it("non riscrive ciò che non è cambiato", async () => {
    mountSaveState(lifetime);
    const seen: MutationRecord[] = [];
    const watch = new MutationObserver((records) => seen.push(...records));
    watch.observe(button(), { attributes: true, childList: true, characterData: true, subtree: true });
    // La vista riscrive la stessa parola a ogni ridisegno.
    drawSave("salvato");
    await settled();
    await settled();
    watch.disconnect();
    expect(seen).toEqual([]);
  });

  it("torna al suo posto se la vista riscrive il gruppo", async () => {
    mountSaveState(lifetime);
    const mine = button();
    group.replaceChildren(live);
    await settled();
    expect(live.nextElementSibling).toBe(mine);
  });

  it("rinomina il bottone quando cambia la lingua", () => {
    mountSaveState(lifetime);
    button().setAttribute("aria-label", "vecchio");
    for (const listener of [...world.languages]) listener();
    expect(button().getAttribute("aria-label")).toBe("sheet.save.button Salvato");
  });
});

describe("il popover dello stato", () => {
  it("dice lo stato in parole, il documento e la revisione; senza azioni quando è tutto salvato", () => {
    mountSaveState(lifetime);
    button().click();
    const surface = document.querySelector<HTMLElement>(".kit-popover")!;
    expect(surface.getAttribute("role")).toBe("dialog");
    expect(surface.getAttribute("aria-label")).toBe("sheet.save.title");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(panel()!.querySelector(".sheet-save-headline")!.textContent).toBe("Salvato");
    expect(panel()!.querySelector(".sheet-save-detail")!.textContent).toBe("sheet.save.detail.saved");
    expect(facts()).toEqual(["sheet.save.document", "Guida/Nota.md", "sheet.save.revision", "8842117"]);
    expect(actions()).toEqual([]);
  });

  it("tace la revisione quando la scrittura è dettata", () => {
    world.base = { kind: "dictated" };
    mountSaveState(lifetime);
    button().click();
    expect(facts()).toEqual(["sheet.save.document", "Guida/Nota.md"]);
  });

  it("si chiude con un secondo clic e con Esc, e il fuoco torna al bottone", () => {
    mountSaveState(lifetime);
    button().focus();
    button().click();
    expect(panel()).not.toBeNull();
    button().click();
    expect(panel()).toBeNull();
    expect(button().getAttribute("aria-expanded")).toBe("false");
    button().click();
    press(window, "Escape");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("dice l'ora dell'ultimo salvataggio solo dopo averne visto uno", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 19, 9, 30));
    mountSaveState(lifetime);
    button().click();
    expect(facts()).not.toContain("sheet.save.last");
    for (const listener of [...world.sessions]) listener({ kind: "saved", id: "Altra.md" });
    expect(facts()).not.toContain("sheet.save.last");
    for (const listener of [...world.sessions]) listener({ kind: "saved", id: "Guida/Nota.md" });
    expect(facts().slice(-2)).toEqual(["sheet.save.last", "09:30"]);
  });

  it("porta l'ora ricordata dietro al documento rinominato, e la dimentica con lui", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 19, 9, 30));
    mountSaveState(lifetime);
    for (const listener of [...world.sessions]) listener({ kind: "saved", id: "Guida/Nota.md" });
    emit(world.events, "document_renamed", { type: "document_renamed", from: "Guida/Nota.md", to: "Guida/Nuova.md" });
    world.doc = "Guida/Nuova.md";
    button().click();
    expect(facts().slice(-2)).toEqual(["sheet.save.last", "09:30"]);
    button().click();
    emit(world.events, "document_removed", { type: "document_removed", id: "Guida/Nuova.md" });
    button().click();
    expect(facts()).not.toContain("sheet.save.last");
  });

  it("offre «salva» quando c'è da salvare, ed esegue il comando che c'è già", async () => {
    const runs = commandsOf("shell.doc.save");
    drawSave("non_salvato");
    mountSaveState(lifetime);
    button().click();
    expect(actions().map((b) => b.textContent)).toEqual(["titolo shell.doc.save (Ctrl+S)"]);
    expect(document.activeElement).toBe(actions()[0]);
    actions()[0]!.click();
    await settled();
    expect(runs["shell.doc.save"]).toHaveBeenCalledTimes(1);
  });

  it("non offre un'azione il cui comando non è disponibile", () => {
    world.commands = [];
    drawSave("fallito");
    mountSaveState(lifetime);
    button().click();
    expect(actions()).toEqual([]);
    expect(panel()!.querySelector(".sheet-save-actions")).toBeNull();
  });

  it("segue lo stato mentre è aperto, e il fuoco non cade fuori quando l'azione sparisce", async () => {
    commandsOf("shell.doc.save");
    drawSave("non_salvato");
    mountSaveState(lifetime);
    button().click();
    expect(document.activeElement).toBe(actions()[0]);
    drawSave("in_corso");
    await settled();
    expect(panel()!.querySelector(".sheet-save-headline")!.textContent).toBe("Salvataggio…");
    expect(actions()).toEqual([]);
    const surface = document.querySelector<HTMLElement>(".kit-popover")!;
    expect(surface.contains(document.activeElement)).toBe(true);
    drawSave("fallito");
    await settled();
    expect(panel()!.querySelector<HTMLElement>(".sheet-save-headline")!.dataset.state).toBe("fallito");
    expect(actions()).toHaveLength(1);
  });

  it("in conflitto offre i due lati, chiede prima di buttarne uno, e un no non tocca niente", async () => {
    const runs = commandsOf("shell.doc.conflict.mine", "shell.doc.conflict.theirs");
    const asked: { message: string; options: { danger?: boolean } }[] = [];
    world.confirm = (message, options) => {
      asked.push({ message, options: options as { danger?: boolean } });
      return Promise.resolve(false);
    };
    drawSave("conflitto");
    mountSaveState(lifetime);
    button().click();
    expect(panel()!.querySelector(".sheet-save-detail")!.textContent).toBe("document.conflict.body");
    expect(actions().map((b) => b.dataset.command)).toEqual(["shell.doc.conflict.mine", "shell.doc.conflict.theirs"]);
    expect(actions().map((b) => b.textContent)).toEqual(["document.conflict.keep_mine", "document.conflict.use_disk"]);
    expect(actions()[1]!.dataset.kind).toBe("danger");
    actions()[1]!.click();
    await settled();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.message).toContain("Guida/Nota.md");
    expect(asked[0]!.options.danger).toBe(true);
    expect(panel()).toBeNull();
    expect(runs["shell.doc.conflict.theirs"]).not.toHaveBeenCalled();
  });

  it("dopo un sì esegue il comando del lato scelto, una volta", async () => {
    const runs = commandsOf("shell.doc.conflict.mine", "shell.doc.conflict.theirs");
    world.confirm = () => Promise.resolve(true);
    drawSave("conflitto");
    mountSaveState(lifetime);
    button().click();
    actions()[0]!.click();
    await settled();
    expect(runs["shell.doc.conflict.mine"]).toHaveBeenCalledTimes(1);
    expect(runs["shell.doc.conflict.theirs"]).not.toHaveBeenCalled();
  });
});

describe("le corse", () => {
  it("un sì arrivato dopo che il foglio ha cambiato documento non sceglie per l'altro", async () => {
    const runs = commandsOf("shell.doc.conflict.mine", "shell.doc.conflict.theirs");
    let answer!: (ok: boolean) => void;
    world.confirm = () => new Promise<boolean>((resolve) => (answer = resolve));
    drawSave("conflitto");
    mountSaveState(lifetime);
    button().click();
    actions()[1]!.click();
    await settled();
    world.doc = "Altra.md";
    answer(true);
    await settled();
    expect(runs["shell.doc.conflict.theirs"]).not.toHaveBeenCalled();
  });

  it("un sì arrivato dopo che il conflitto si è risolto altrove non fa niente", async () => {
    const runs = commandsOf("shell.doc.conflict.mine", "shell.doc.conflict.theirs");
    let answer!: (ok: boolean) => void;
    world.confirm = () => new Promise<boolean>((resolve) => (answer = resolve));
    drawSave("conflitto");
    mountSaveState(lifetime);
    button().click();
    actions()[0]!.click();
    await settled();
    drawSave("salvato");
    answer(true);
    await settled();
    expect(runs["shell.doc.conflict.mine"]).not.toHaveBeenCalled();
  });

  it("«salva» premuto su un documento che non è più quello attivo non salva l'altro", async () => {
    const runs = commandsOf("shell.doc.save");
    drawSave("non_salvato");
    mountSaveState(lifetime);
    button().click();
    const save = actions()[0]!;
    world.doc = "Altra.md";
    save.click();
    await settled();
    expect(runs["shell.doc.save"]).not.toHaveBeenCalled();
  });

  it("si chiude quando il foglio col fuoco o il suo documento cambiano", () => {
    mountSaveState(lifetime);
    button().click();
    world.doc = "Altra.md";
    emit(world.signals, "active-doc", "Altra.md");
    expect(panel()).toBeNull();
    button().click();
    expect(facts()[1]).toBe("Altra.md");
    world.focus = "altro";
    emit(world.signals, "layout");
    expect(panel()).toBeNull();
  });

  it("resta aperto se la disposizione cambia senza toccare il suo foglio", () => {
    mountSaveState(lifetime);
    button().click();
    emit(world.signals, "layout");
    expect(panel()).not.toBeNull();
  });
});

describe("lo smontaggio", () => {
  it("toglie bottone, popover, ascolti e osservatori, e rende la parola alla vista", async () => {
    const listening = listenerLedger(document, window, group, live);
    mountSaveState(lifetime);
    button().click();
    expect(panel()).not.toBeNull();
    lifetime.close();
    driver.advance(5000);
    expect(group.querySelector("button")).toBeNull();
    expect(panel()).toBeNull();
    expect(live.classList.contains("sr-only")).toBe(false);
    expect(listening()).toBe(0);
    expect(world.sessions.size).toBe(0);
    expect(world.languages.size).toBe(0);
    expect([...world.events.values()].every((set) => set.size === 0)).toBe(true);
    expect([...world.signals.values()].every((set) => set.size === 0)).toBe(true);
    vi.restoreAllMocks();
    // Dopo lo smontaggio la vista ridisegna e nessuno risponde più.
    drawSave("fallito");
    await settled();
    expect(group.querySelector("button")).toBeNull();
  });

  it("senza il gruppo della vista non monta niente", () => {
    document.body.innerHTML = "";
    mountSaveState(lifetime);
    expect(document.querySelector(".sheet-save")).toBeNull();
    expect(world.sessions.size).toBe(0);
  });
});
