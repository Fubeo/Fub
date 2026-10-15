// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit } from "../../../state/store";
import type { CommandEntry } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

/// Il mondo finto attorno alla cornice: il registro dei comandi, chi li
/// esegue, e chi avvisa che la lingua è cambiata.
const world = vi.hoisted(() => ({
  commands: [] as unknown[],
  started: [] as { entry: unknown; host: unknown }[],
  host: { name: "palette-host" },
  languageListeners: new Set<() => void>(),
}));

// Il registro è finto, la scrittura degli accordi è quella vera: è lei che
// decide come si legge `Mod-K`.
vi.mock("../../../ui/commands", async (original) => ({
  ...(await original<typeof import("../../../ui/commands")>()),
  allCommands: () => world.commands,
}));
vi.mock("../../../ui/palette", () => ({
  startCommand: (entry: unknown, host: unknown) => world.started.push({ entry, host }),
}));
vi.mock("../../../state/palette-host", () => ({ paletteHost: world.host }));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string) => key,
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

import { chordOf, keepLabelled, labelCommandButton, run } from "./commands";

function command(id: string, binding: string | null): CommandEntry {
  return { id, title: id, description: "", layer: "global", binding, declared: binding, spec: null, run: () => {} };
}

function changeLanguage(): void {
  for (const listener of [...world.languageListeners]) listener();
}

let lifetime: Lifetime;

beforeEach(() => {
  world.commands = [command("shell.switcher", "Mod-O"), command("shell.palette", null)];
  world.started.length = 0;
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  expect(world.languageListeners.size).toBe(0);
  document.body.replaceChildren();
});

describe("run", () => {
  it("avvia il comando del registro con quell'id, per conto della palette", () => {
    run("shell.palette");
    expect(world.started).toEqual([{ entry: world.commands[1], host: world.host }]);
  });

  it("un id che non c'è non fa niente", () => {
    expect(() => run("shell.che.non.esiste")).not.toThrow();
    expect(world.started).toEqual([]);
  });
});

describe("chordOf", () => {
  it("dà l'accordo come lo si preme", () => {
    expect(chordOf("shell.switcher")).toBe("Ctrl+O");
  });

  it("è vuoto per un comando senza accordo e per uno che non c'è", () => {
    expect(chordOf("shell.palette")).toBe("");
    expect(chordOf("shell.che.non.esiste")).toBe("");
  });

  it("legge l'accordo in vigore, non quello di quando è stato chiesto la prima volta", () => {
    expect(chordOf("shell.switcher")).toBe("Ctrl+O");
    world.commands = [command("shell.switcher", "Mod-Shift-P")];
    expect(chordOf("shell.switcher")).toBe("Ctrl+Shift+P");
  });
});

describe("labelCommandButton", () => {
  it("dà al bottone il nome, il suggerimento con i tasti e la scorciatoia annunciata", () => {
    const button = document.createElement("button");
    labelCommandButton(button, "Apri una nota", "shell.switcher");
    expect(button.getAttribute("aria-label")).toBe("Apri una nota");
    expect(button.dataset.tip).toBe("Apri una nota (Ctrl+O)");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+O");
  });

  it("senza accordo il suggerimento è il solo nome e la scorciatoia non si dichiara", () => {
    const button = document.createElement("button");
    labelCommandButton(button, "Comandi", "shell.palette");
    expect(button.getAttribute("aria-label")).toBe("Comandi");
    expect(button.dataset.tip).toBe("Comandi");
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("un comando che non c'è si etichetta come uno senza accordo", () => {
    const button = document.createElement("button");
    labelCommandButton(button, "Fantasma", "shell.che.non.esiste");
    expect(button.getAttribute("aria-label")).toBe("Fantasma");
    expect(button.dataset.tip).toBe("Fantasma");
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("ritira la scorciatoia annunciata quando l'accordo sparisce", () => {
    const button = document.createElement("button");
    labelCommandButton(button, "Apri una nota", "shell.switcher");
    world.commands = [command("shell.switcher", null)];
    labelCommandButton(button, "Apri una nota", "shell.switcher");
    expect(button.dataset.tip).toBe("Apri una nota");
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("una sequenza si legge nel suggerimento ma non ha una forma da annunciare", () => {
    world.commands = [command("shell.switcher", "Mod-K Mod-S")];
    const button = document.createElement("button");
    button.setAttribute("aria-keyshortcuts", "Control+O");
    labelCommandButton(button, "Apri una nota", "shell.switcher");
    expect(button.dataset.tip).toBe("Apri una nota (Ctrl+K Ctrl+S)");
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
  });
});

describe("keepLabelled", () => {
  it("disegna subito, una volta", () => {
    const draw = vi.fn();
    keepLabelled(lifetime, draw);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("ridisegna quando cambia la lingua e quando cambiano gli accordi", () => {
    const draw = vi.fn();
    keepLabelled(lifetime, draw);
    changeLanguage();
    expect(draw).toHaveBeenCalledTimes(2);
    emit("commands");
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it("gli altri segnali della shell non lo riguardano", () => {
    const draw = vi.fn();
    keepLabelled(lifetime, draw);
    emit("layout");
    emit("documents");
    emit("theme");
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("chiusa la vita non ridisegna più", () => {
    const draw = vi.fn();
    keepLabelled(lifetime, draw);
    lifetime.close();
    changeLanguage();
    emit("commands");
    expect(draw).toHaveBeenCalledTimes(1);
  });
});
