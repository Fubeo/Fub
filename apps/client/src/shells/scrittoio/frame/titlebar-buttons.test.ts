// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneHistory, Tab } from "../../../state/layout";
import { emit } from "../../../state/store";
import type { CommandEntry } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const world = vi.hoisted(() => ({
  commands: [] as unknown[],
  started: [] as string[],
  language: "it",
  languageListeners: new Set<() => void>(),
  /// Il foglio a fuoco, per ciò che la cornice ne legge: la sua cronologia.
  pane: {} as { history?: unknown },
}));

vi.mock("../../../ui/commands", async (original) => ({
  ...(await original<typeof import("../../../ui/commands")>()),
  allCommands: () => world.commands,
}));
vi.mock("../../../ui/palette", () => ({
  startCommand: (entry: { id: string }) => world.started.push(entry.id),
}));
vi.mock("../../../state/palette-host", () => ({ paletteHost: {} }));
vi.mock("../../../state/layout", () => ({ activePane: () => world.pane }));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string) => (world.language === "it" ? key : `${key} (${world.language})`),
  onLanguage: (listener: () => void) => {
    world.languageListeners.add(listener);
    return () => world.languageListeners.delete(listener);
  },
}));
vi.mock("../../../ui/tooltip", () => ({
  setTooltip: (el: HTMLElement, text: string) => {
    el.dataset.tip = text;
  },
}));
vi.mock("../../../ui/icons", () => ({ icon: (name: string) => `<svg data-icon="${name}"></svg>` }));

import { mountFrameNav, mountInspectorToggle } from "./titlebar-buttons";

const BACK = "shell.pane.back";
const FORWARD = "shell.pane.forward";
const INSPECTOR = "shell.inspector.toggle";

function command(id: string, binding: string | null): CommandEntry {
  return { id, title: id, description: "", layer: "global", binding, declared: binding, spec: null, run: () => {} };
}

function changeLanguage(next: string): void {
  world.language = next;
  for (const listener of [...world.languageListeners]) listener();
}

const doc = (name: string): Tab => ({ k: "doc", doc: name });

function history(past: string[], future: string[]): void {
  const next: PaneHistory = { past: past.map(doc), future: future.map(doc) };
  world.pane = { history: next };
}

/// Gli osservatori consegnano a fine giro.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const button = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;
const iconOf = (el: HTMLElement): string | undefined => el.querySelector("svg")?.dataset.icon;

let lifetime: Lifetime;

beforeEach(() => {
  world.commands = [command(BACK, "Alt-ArrowLeft"), command(FORWARD, "Alt-ArrowRight"), command(INSPECTOR, "Mod-Alt-I")];
  world.started.length = 0;
  world.language = "it";
  world.pane = {};
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  expect(world.languageListeners.size).toBe(0);
  document.body.replaceChildren();
});

describe("indietro e avanti del foglio a fuoco", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <span id="frame-nav" role="group">
        <button id="nav-back" type="button" aria-label="Indietro"></button>
        <button id="nav-forward" type="button" aria-label="Avanti"></button>
      </span>`;
  });

  const back = (): HTMLButtonElement => button("nav-back");
  const forward = (): HTMLButtonElement => button("nav-forward");

  it("hanno la freccia, il nome, i tasti nel suggerimento e la scorciatoia annunciata", () => {
    mountFrameNav(lifetime);
    expect(iconOf(back())).toBe("arrow-left");
    expect(iconOf(forward())).toBe("arrow-right");
    expect(back().getAttribute("aria-label")).toBe("menu.go.back");
    expect(back().dataset.tip).toBe("menu.go.back (Alt+←)");
    expect(back().getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowLeft");
    expect(forward().getAttribute("aria-label")).toBe("menu.go.forward");
    expect(forward().dataset.tip).toBe("menu.go.forward (Alt+→)");
    expect(forward().getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowRight");
  });

  it("un foglio senza cronologia le spegne tutte e due", () => {
    mountFrameNav(lifetime);
    expect(back().disabled).toBe(true);
    expect(forward().disabled).toBe(true);
  });

  it("una cronologia vuota vale come nessuna", () => {
    history([], []);
    mountFrameNav(lifetime);
    expect(back().disabled).toBe(true);
    expect(forward().disabled).toBe(true);
  });

  it("ognuna si accende solo se da quella parte c'è dove andare", () => {
    history(["a"], []);
    mountFrameNav(lifetime);
    expect(back().disabled).toBe(false);
    expect(forward().disabled).toBe(true);

    history([], ["b"]);
    emit("layout");
    expect(back().disabled).toBe(true);
    expect(forward().disabled).toBe(false);
  });

  it.each([
    ["la disposizione che cambia", () => emit("layout")],
    ["il documento a fuoco che cambia", () => emit("active-doc", "a.md")],
    ["il vault che si apre", () => emit("vault", "/vault")],
  ])("rileggono la cronologia con %s", (_name, announce) => {
    mountFrameNav(lifetime);
    history(["a"], ["b"]);
    expect(back().disabled).toBe(true);
    announce();
    expect(back().disabled).toBe(false);
    expect(forward().disabled).toBe(false);
  });

  it("premute eseguono ciascuna il suo comando", () => {
    history(["a"], ["b"]);
    mountFrameNav(lifetime);
    back().click();
    forward().click();
    expect(world.started).toEqual([BACK, FORWARD]);
  });

  it("se il comando non c'è non succede niente", () => {
    world.commands = [];
    history(["a"], ["b"]);
    mountFrameNav(lifetime);
    expect(() => back().click()).not.toThrow();
    forward().click();
    expect(world.started).toEqual([]);
    // Senza comando non c'è nemmeno un accordo da mostrare.
    expect(back().dataset.tip).toBe("menu.go.back");
    expect(back().hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("si rietichettano quando cambiano gli accordi o la lingua", () => {
    mountFrameNav(lifetime);
    world.commands = [command(BACK, "Mod-["), command(FORWARD, null)];
    emit("commands");
    expect(back().dataset.tip).toBe("menu.go.back (Ctrl+[)");
    expect(back().getAttribute("aria-keyshortcuts")).toBe("Control+[");
    expect(forward().dataset.tip).toBe("menu.go.forward");
    expect(forward().hasAttribute("aria-keyshortcuts")).toBe(false);

    changeLanguage("en");
    expect(back().getAttribute("aria-label")).toBe("menu.go.back (en)");
    expect(forward().getAttribute("aria-label")).toBe("menu.go.forward (en)");
  });

  it("se manca una delle due non monta niente", () => {
    forward().remove();
    mountFrameNav(lifetime);
    expect(back().innerHTML).toBe("");
    expect(back().getAttribute("aria-label")).toBe("Indietro");
    back().click();
    expect(world.started).toEqual([]);
    expect(world.languageListeners.size).toBe(0);
  });

  it("smontate non premono più niente e non seguono più nessuno", () => {
    history(["a"], []);
    mountFrameNav(lifetime);
    lifetime.close();

    back().click();
    expect(world.started).toEqual([]);

    history([], ["b"]);
    world.commands = [command(BACK, "Mod-[")];
    emit("layout");
    emit("active-doc", "b.md");
    emit("vault", "/altro");
    emit("commands");
    changeLanguage("en");
    expect(back().disabled).toBe(false);
    expect(forward().disabled).toBe(true);
    expect(back().getAttribute("aria-label")).toBe("menu.go.back");
    expect(back().dataset.tip).toBe("menu.go.back (Alt+←)");
  });
});

describe("il bottone dell'ispettore", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="toggle-inspector" type="button"></button>
      <section id="right-pane"></section>`;
  });

  const toggle = (): HTMLButtonElement => button("toggle-inspector");
  const inspector = (): HTMLElement => document.getElementById("right-pane")!;

  it("ha la sua figura, il nome, i tasti e la scorciatoia annunciata", () => {
    mountInspectorToggle(lifetime);
    expect(iconOf(toggle())).toBe("panel-right");
    expect(toggle().getAttribute("aria-label")).toBe("menu.view.inspector");
    expect(toggle().dataset.tip).toBe("menu.view.inspector (Ctrl+Alt+I)");
    expect(toggle().getAttribute("aria-keyshortcuts")).toBe("Control+Alt+I");
  });

  it("è premuto quando il cassetto si vede", () => {
    mountInspectorToggle(lifetime);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("montato a cassetto nascosto lo dice subito", () => {
    inspector().hidden = true;
    mountInspectorToggle(lifetime);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("lo stato è del cassetto: chiunque lo apra o lo chiuda, il bottone lo segue", async () => {
    mountInspectorToggle(lifetime);
    inspector().hidden = true;
    await settled();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    inspector().hidden = false;
    await settled();
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("premuto esegue il comando, e non cambia stato da sé", () => {
    mountInspectorToggle(lifetime);
    toggle().click();
    expect(world.started).toEqual([INSPECTOR]);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(inspector().hidden).toBe(false);
  });

  it("se il comando non c'è non succede niente", () => {
    world.commands = [];
    mountInspectorToggle(lifetime);
    expect(() => toggle().click()).not.toThrow();
    expect(world.started).toEqual([]);
  });

  it("si rietichetta quando cambiano gli accordi o la lingua", () => {
    mountInspectorToggle(lifetime);
    world.commands = [command(INSPECTOR, null)];
    emit("commands");
    expect(toggle().dataset.tip).toBe("menu.view.inspector");
    expect(toggle().hasAttribute("aria-keyshortcuts")).toBe(false);
    changeLanguage("en");
    expect(toggle().getAttribute("aria-label")).toBe("menu.view.inspector (en)");
  });

  it("senza il cassetto non monta niente", () => {
    inspector().remove();
    mountInspectorToggle(lifetime);
    expect(toggle().innerHTML).toBe("");
    expect(toggle().hasAttribute("aria-pressed")).toBe(false);
    toggle().click();
    expect(world.started).toEqual([]);
  });

  it("smontato non preme più niente e non segue più il cassetto", async () => {
    mountInspectorToggle(lifetime);
    lifetime.close();
    toggle().click();
    expect(world.started).toEqual([]);

    inspector().hidden = true;
    world.commands = [command(INSPECTOR, null)];
    emit("commands");
    changeLanguage("en");
    await settled();
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("menu.view.inspector");
    expect(toggle().dataset.tip).toBe("menu.view.inspector (Ctrl+Alt+I)");
  });
});
