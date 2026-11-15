// @vitest-environment happy-dom
//
// La riga dei suggerimenti (T14): la porta e la riga. Le voci si scrivono coi
// tasti della persona (una scorciatoia cambiata, una tolta, due comandi sullo
// stesso tasto), la riga cambia solo dopo la pausa, si spegne con
// `editor.hints`, e senza niente da dire resta al suo posto, vuota.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec, SettingEntry } from "../../../host/contract";
import { state } from "../../../state/store";
import { type CommandEntry, loadKeyOverrides, mountKeyOverrides, resetShellCommands } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const world = vi.hoisted(() => ({
  settings: [] as unknown[],
  settingListeners: new Set<(event: { key: string }) => void>(),
  languageListeners: new Set<() => void>(),
}));

vi.mock("../../../host/query", () => ({ settings: () => Promise.resolve(world.settings) }));
vi.mock("../../../state/kernel", () => ({
  onEvent: (_type: string, listener: (event: { key: string }) => void) => {
    world.settingListeners.add(listener);
    return () => world.settingListeners.delete(listener);
  },
}));
vi.mock("../../../i18n/strings", async (original) => ({
  ...(await original<typeof import("../../../i18n/strings")>()),
  onLanguage: (listener: () => void) => {
    world.languageListeners.add(listener);
    return () => world.languageListeners.delete(listener);
  },
}));

import { openHintSource, resetHintSources, type HintContext } from "../../../editors/core/hints";
import { HINTS_PAUSE_MS, mountHintsRow, resolveHints } from "./hints-row";

function entry(id: string, binding: string | null, declared: string | null = binding, layer: CommandEntry["layer"] = "global"): CommandEntry {
  return { id, title: id, description: "", layer, binding, declared, spec: null, run: () => {} };
}

function setting(key: string, value: unknown): SettingEntry {
  return {
    spec: { key, label: key, description: "", group: "", scope: "machine", kind: { kind: "text", default: "" }, program_writable: false },
    value,
    source: "machine",
  } as SettingEntry;
}

function spec(id: string, keybinding: string | null): CommandSpec {
  return {
    id,
    title: id,
    description: "",
    keybinding,
    params: [],
    scope: { reach: "global" },
    effects: [],
  } as unknown as CommandSpec;
}

describe("le voci coi tasti della persona", () => {
  it("un comando si scrive col suo accordo, letto con displayBinding", () => {
    const parts = resolveHints([{ command: "shell.switcher", say: "cerca o esegue" }], [entry("shell.switcher", "Mod-o")], "other");
    expect(parts).toEqual([{ keys: ["Ctrl+O"], say: "cerca o esegue" }]);
    expect(resolveHints([{ command: "shell.switcher", say: "x" }], [entry("shell.switcher", "Mod-o")], "mac")[0]!.keys).toEqual(["⌘O"]);
  });

  it("segue una scorciatoia cambiata, e la preferisce all'accordo dell'editor", () => {
    const items = [{ command: "markdown.bold", chord: "Mod-b", say: "grassetto" }];
    expect(resolveHints(items, [entry("markdown.bold", null, null)], "other")[0]!.keys).toEqual(["Ctrl+B"]);
    expect(resolveHints(items, [entry("markdown.bold", "Mod-Shift-g", null)], "other")[0]!.keys).toEqual(["Ctrl+Shift+G"]);
  });

  it("una scorciatoia tolta dalla persona toglie la voce", () => {
    const items = [{ command: "shell.switcher", say: "cerca o esegue" }, { keys: ["/"], say: "inserisce un blocco" }];
    expect(resolveHints(items, [entry("shell.switcher", null, "Mod-o")], "other")).toEqual([{ keys: ["/"], say: "inserisce un blocco" }]);
  });

  it("un comando senza accordo e senza accordo dell'editor non c'è", () => {
    expect(resolveHints([{ command: "markdown.math", say: "formula" }], [entry("markdown.math", null, null)], "other")).toEqual([]);
    expect(resolveHints([{ command: "sconosciuto", say: "x" }], [], "other")).toEqual([]);
  });

  it("due comandi sullo stesso tasto: la voce resta a quello che il tasto esegue", () => {
    // `allCommands` è nell'ordine dell'arbitrato: la superficie prima del globale.
    const entries = [entry("canvas.link", "Mod-k", "Mod-k", "surface"), entry("shell.switcher", "Mod-k", "Mod-o")];
    expect(resolveHints([{ command: "shell.switcher", say: "cerca" }], entries, "other")).toEqual([]);
    expect(resolveHints([{ command: "canvas.link", say: "collega" }], entries, "other")).toEqual([{ keys: ["Ctrl+K"], say: "collega" }]);
  });

  it("un tasto si dice una volta sola per riga", () => {
    const parts = resolveHints(
      [
        { command: "markdown.wikilink", chord: "Mod-k", say: "collega" },
        { command: "markdown.link", chord: "Mod-k", say: "link" },
        { keys: ["Mod-k"], say: "ancora" },
      ],
      [],
      "other",
    );
    expect(parts).toEqual([{ keys: ["Ctrl+K"], say: "collega" }]);
  });

  it("i tasti che non sono comandi: frecce, nomi, il modificatore tenuto", () => {
    const parts = resolveHints(
      [
        { keys: ["ArrowUp", "ArrowDown"], say: "scegli" },
        { keys: ["Escape"], say: "esce" },
        { keys: ["Mod"], say: "anteprima" },
        { keys: ["Shift-ArrowUp"], say: "allarga" },
        { keys: ["@"], say: "persone" },
      ],
      [],
      "other",
    );
    expect(parts.map((part) => part.keys)).toEqual([["↑", "↓"], ["Esc"], ["Ctrl"], ["Shift+↑"], ["@"]]);
  });
});

describe("la riga nella banda", () => {
  let life: Lifetime;
  let band: HTMLElement;
  let end: HTMLElement;
  let context: HintContext | null;
  let reads: number;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  const row = (): HTMLElement => document.getElementById("status-hints")!;
  const text = (): string => [...row().querySelectorAll(".status-hints-item")].map((item) => item.textContent).join(" | ");

  beforeEach(() => {
    vi.useFakeTimers();
    world.settings = [];
    world.settingListeners.clear();
    world.languageListeners.clear();
    document.body.innerHTML = '<footer id="status-band"><div id="status-start"></div><div id="status-end"></div></footer>';
    band = document.getElementById("status-band")!;
    end = document.getElementById("status-end")!;
    life = openLifetime();
    context = null;
    reads = 0;
  });
  afterEach(() => {
    life.close();
    resetHintSources();
    resetShellCommands();
    state.commandSpecs = [];
    vi.useRealTimers();
  });

  const source = () =>
    openHintSource(() => {
      reads += 1;
      return context;
    });

  it("sta al centro, prima del lato destro, ed è nascosta ai lettori di schermo", async () => {
    mountHintsRow(life, band, end);
    await settle();
    expect(row().nextElementSibling).toBe(end);
    expect(row().getAttribute("aria-hidden")).toBe("true");
    expect(row().hidden).toBe(false);
  });

  it("cambia dopo la pausa, non a ogni battuta, e non rilegge il contesto prima", async () => {
    mountHintsRow(life, band, end);
    await settle();
    const hints = source();
    context = { id: "text", items: [{ keys: ["/"], say: "inserisce un blocco" }] };
    reads = 0;
    for (let i = 0; i < 10; i++) {
      hints.changed(true);
      vi.advanceTimersByTime(HINTS_PAUSE_MS / 3);
    }
    // Dieci battute ravvicinate: il contesto non si è ancora letto.
    expect(reads).toBe(0);
    expect(text()).toBe("");
    // Ferme le dita, la riga si riscrive entro due pause, leggendo una volta.
    vi.advanceTimersByTime(HINTS_PAUSE_MS * 2);
    expect(reads).toBe(1);
    expect(text()).toBe("/inserisce un blocco");
    expect(row().dataset.context).toBe("text");
  });

  it("un contesto senza voci lascia la riga al suo posto, vuota", async () => {
    mountHintsRow(life, band, end);
    await settle();
    const hints = source();
    context = { id: "text", items: [{ keys: ["/"], say: "inserisce un blocco" }] };
    hints.changed(true);
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    context = { id: "vuoto", items: [] };
    hints.changed();
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(row().isConnected).toBe(true);
    expect(row().hidden).toBe(false);
    expect(row().childElementCount).toBe(0);
    hints.close();
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(row().dataset.context).toBeUndefined();
  });

  it("vince la fonte in cima che ha qualcosa da dire", async () => {
    mountHintsRow(life, band, end);
    await settle();
    let first: HintContext | null = { id: "uno", items: [{ keys: ["Escape"], say: "uno" }] };
    let second: HintContext | null = { id: "due", items: [{ keys: ["Enter"], say: "due" }] };
    const a = openHintSource(() => first);
    const b = openHintSource(() => second);
    b.changed(true);
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(row().dataset.context).toBe("due");
    // Chi perde il fuoco non dice niente: la riga passa all'altro.
    second = null;
    b.changed();
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(row().dataset.context).toBe("uno");
    second = { id: "due", items: [{ keys: ["Enter"], say: "due" }] };
    a.changed(true);
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(row().dataset.context).toBe("uno");
    first = null;
    a.changed();
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(row().dataset.context).toBe("due");
  });

  it("editor.hints spenta la toglie, riaccesa la rimette", async () => {
    world.settings = [setting("editor.hints", false)];
    mountHintsRow(life, band, end);
    await settle();
    const hints = source();
    context = { id: "text", items: [{ keys: ["/"], say: "inserisce un blocco" }] };
    hints.changed(true);
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(row().hidden).toBe(true);
    expect(reads).toBe(0);
    world.settings = [setting("editor.hints", true)];
    for (const listener of world.settingListeners) listener({ key: "editor.hints" });
    await settle();
    expect(row().hidden).toBe(false);
    expect(text()).toBe("/inserisce un blocco");
  });

  it("segue una scorciatoia cambiata nelle Preferenze", async () => {
    state.commandSpecs = [spec("demo.find", "Mod-o")];
    await loadKeyOverrides();
    // La lettura unica degli accordi, come nella finestra: la riga non ne fa
    // una sua, aspetta l'avviso di questa.
    mountKeyOverrides(life);
    mountHintsRow(life, band, end);
    await settle();
    const hints = source();
    context = { id: "text", items: [{ command: "demo.find", say: "cerca o esegue" }] };
    hints.changed(true);
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(text()).toBe("Ctrl+Ocerca o esegue");
    world.settings = [setting("keys.demo.find", "Mod-p")];
    for (const listener of world.settingListeners) listener({ key: "keys.demo.find" });
    await settle();
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(text()).toBe("Ctrl+Pcerca o esegue");
    // Tolta: la voce non c'è più.
    world.settings = [setting("keys.demo.find", "")];
    for (const listener of world.settingListeners) listener({ key: "keys.demo.find" });
    await settle();
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(text()).toBe("");
  });

  it("la lingua cambiata riscrive le frasi alla pausa dopo", async () => {
    mountHintsRow(life, band, end);
    await settle();
    let say = "scegli";
    const hints = openHintSource(() => ({ id: "x", items: [{ keys: ["ArrowUp"], say }] }));
    hints.changed(true);
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(text()).toBe("↑scegli");
    say = "choose";
    for (const listener of world.languageListeners) listener();
    vi.advanceTimersByTime(HINTS_PAUSE_MS);
    expect(text()).toBe("↑choose");
  });

  it("chiusa la banda, la riga se ne va e le fonti non costano niente", async () => {
    mountHintsRow(life, band, end);
    await settle();
    const hints = source();
    life.close();
    expect(document.getElementById("status-hints")).toBeNull();
    hints.changed(true);
    vi.advanceTimersByTime(HINTS_PAUSE_MS * 2);
    expect(reads).toBe(0);
  });
});
