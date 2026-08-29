// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../state/store";
import {
  loadKeyOverrides,
  registerShellCommand,
  resetShellCommands,
} from "./commands";
import { mountKeyboard } from "./keyboard";
import { trapFocus } from "./a11y";
import { openLifetime, type Lifetime } from "./lifetime";
import keyboardSource from "./keyboard.ts?raw";

const fromBackend = vi.fn(async () => []);
vi.mock("../host/query", () => ({ settings: () => fromBackend() }));

function ctrlKeydown(target: EventTarget, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("la tastiera della shell", () => {
  const lifetimes: Lifetime[] = [];
  let root: HTMLDivElement;

  beforeEach(async () => {
    root = document.createElement("div");
    root.className = "keyboard-causality-test";
    document.body.append(root);

    resetShellCommands();
    state.commandSpecs = [];
    fromBackend.mockReset();
    fromBackend.mockResolvedValue([]);
    await loadKeyOverrides();
  });

  afterEach(() => {
    for (const lifetime of lifetimes.splice(0)) lifetime.close();
    resetShellCommands();
    state.commandSpecs = [];
    root.remove();
  });

  function mountDispatcher(): string[] {
    const executed: string[] = [];
    const lifetime = openLifetime();
    lifetimes.push(lifetime);
    mountKeyboard(lifetime, (entry) => executed.push(entry.id));
    return executed;
  }

  function registerDocumentSearch(): void {
    registerShellCommand({
      id: "shell.doc.search",
      title: "commands.doc.search",
      description: "commands.doc.search.desc",
      run: () => {},
    });
  }


  it("la trappola #settings-panel omessa dal vecchio elenco blocca il comando anche dopo la chiusura della cima", () => {
    registerDocumentSearch();
    const executed = mountDispatcher();

    const settings = document.createElement("section");
    settings.id = "settings-panel";
    settings.tabIndex = -1;
    const settingsButton = document.createElement("button");
    settingsButton.textContent = "Impostazioni";
    settings.append(settingsButton);

    const iconPicker = document.createElement("section");
    iconPicker.id = "icon-picker";
    iconPicker.tabIndex = -1;
    const iconButton = document.createElement("button");
    iconButton.textContent = "Icona";
    iconPicker.append(iconButton);
    root.append(settings, iconPicker);

    const releaseSettings = trapFocus(settings, () => {});
    let topClosed = 0;
    let releaseIconPicker: () => void = () => {};
    releaseIconPicker = trapFocus(iconPicker, () => {
      topClosed += 1;
      iconPicker.hidden = true;
      releaseIconPicker();
    });

    const whileTopIsOpen = ctrlKeydown(iconButton, "f");
    expect(whileTopIsOpen.defaultPrevented).toBe(false);
    expect(executed).toEqual([]);

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    iconButton.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(topClosed, "Escape deve chiudere solo la trappola in cima").toBe(1);

    const whileSettingsIsStillOpen = ctrlKeydown(settingsButton, "f");
    expect(whileSettingsIsStillOpen.defaultPrevented).toBe(false);
    expect(
      executed,
      "#settings-panel non era nell'elenco di quattro ID: la trappola sotto deve ancora sopprimere il comando",
    ).toEqual([]);

    settings.hidden = true;
    releaseSettings();
    const afterAllTrapsClose = ctrlKeydown(root, "f");
    expect(afterAllTrapsClose.defaultPrevented).toBe(true);
    expect(executed, "chiusa anche l'ultima trappola torna lo stesso comando").toEqual([
      "shell.doc.search",
    ]);
  });

  it("non mantiene un inventario di ID delle superfici transitorie nel dispatcher", () => {
    expect(keyboardSource).toContain("focusTrapOwnsKeyboard()");
    expect(keyboardSource).not.toMatch(/\b(?:TRANSITORY_OVERLAY_IDS|transientOverlayOpen)\b/);
    expect(keyboardSource).not.toMatch(/\b(?:command-palette|quick-switcher|context-menu|icon-picker)\b/);
    expect(keyboardSource.match(/document\.getElementById\(/g)).toHaveLength(1);
    expect(keyboardSource).not.toMatch(/document\.querySelector(?:All)?\(/);
  });
});
