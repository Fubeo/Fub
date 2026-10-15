// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandEntry } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const world = vi.hoisted(() => ({
  commands: [] as unknown[],
  started: [] as string[],
  language: "it",
  languageListeners: new Set<() => void>(),
}));

vi.mock("../../../ui/commands", async (original) => ({
  ...(await original<typeof import("../../../ui/commands")>()),
  allCommands: () => world.commands,
}));
vi.mock("../../../ui/palette", () => ({
  startCommand: (entry: { id: string }) => world.started.push(entry.id),
}));
vi.mock("../../../state/palette-host", () => ({ paletteHost: {} }));
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

import { mountBottomBar } from "./bottom-bar";

const INSPECTOR = "shell.inspector.toggle";

function command(id: string, binding: string | null): CommandEntry {
  return { id, title: id, description: "", layer: "global", binding, declared: binding, spec: null, run: () => {} };
}

/// Gli osservatori consegnano a fine giro.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const foot = (): HTMLElement => document.getElementById("rail-foot") as HTMLElement;
const inspector = (): HTMLElement => document.getElementById("right-pane") as HTMLElement;
const button = (): HTMLButtonElement | null => foot().querySelector<HTMLButtonElement>(".rail-btn-inspector");

let lifetime: Lifetime;

beforeEach(() => {
  world.commands = [command(INSPECTOR, "Mod-Alt-i")];
  world.started = [];
  world.language = "it";
  document.body.innerHTML = `
    <div id="rail">
      <div id="rail-foot"><button id="open-settings" class="rail-btn"></button></div>
    </div>
    <section id="right-pane" hidden></section>`;
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  expect(world.languageListeners.size).toBe(0);
  document.body.replaceChildren();
});

describe("l'ispettore nella barra inferiore", () => {
  it("è un'icona del binario, la prima del piede, con la figura dell'ispettore", () => {
    mountBottomBar(lifetime);
    const el = button() as HTMLButtonElement;
    expect(foot().firstElementChild).toBe(el);
    expect(el.type).toBe("button");
    expect(el.classList.contains("rail-btn")).toBe(true);
    expect(el.querySelector("svg")?.dataset.icon).toBe("panel-right");
    expect(el.getAttribute("aria-controls")).toBe("right-pane");
  });

  it("ha il nome del comando, e lo ridice quando cambia la lingua", () => {
    mountBottomBar(lifetime);
    const el = button() as HTMLButtonElement;
    expect(el.getAttribute("aria-label")).toBe("menu.view.inspector");
    world.language = "en";
    for (const listener of [...world.languageListeners]) listener();
    expect(el.getAttribute("aria-label")).toBe("menu.view.inspector (en)");
  });

  it("dice se l'ispettore è aperto con `aria-expanded`, mai con `aria-pressed`", async () => {
    mountBottomBar(lifetime);
    const el = button() as HTMLButtonElement;
    expect(el.getAttribute("aria-expanded")).toBe("false");
    inspector().hidden = false;
    await settled();
    expect(el.getAttribute("aria-expanded")).toBe("true");
    inspector().hidden = true;
    await settled();
    expect(el.getAttribute("aria-expanded")).toBe("false");
    // La tacca del binario segue l'icona premuta: questa non sceglie un pannello.
    expect(el.hasAttribute("aria-pressed")).toBe(false);
  });

  it("premuta, esegue il comando dell'ispettore", () => {
    mountBottomBar(lifetime);
    (button() as HTMLButtonElement).click();
    expect(world.started).toEqual([INSPECTOR]);
  });

  it("smontata la shell non resta", () => {
    mountBottomBar(lifetime);
    lifetime.close();
    expect(button()).toBeNull();
    expect(foot().children).toHaveLength(1);
  });

  it("senza il piede del binario o senza l'ispettore non fa niente", () => {
    inspector().remove();
    expect(() => mountBottomBar(lifetime)).not.toThrow();
    expect(button()).toBeNull();
  });
});
