// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../state/store";
import type { SettingEntry } from "../host/contract";
import {
  loadKeyOverrides,
  registerShellCommand,
  resetShellCommands,
} from "./commands";
import { cancelSequence, mountKeyboard } from "./keyboard";
import { trapFocus } from "./a11y";
import { openLifetime, type Lifetime } from "./lifetime";
import keyboardSource from "./keyboard.ts?raw";

const fromBackend = vi.fn(async (): Promise<SettingEntry[]> => []);
vi.mock("../host/query", () => ({ settings: () => fromBackend() }));

function ctrlKeydown(target: EventTarget, key: string, ctrlKey = true): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey,
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
    const pending = document.createElement("span");
    pending.id = "key-pending";
    pending.hidden = true;
    root.append(pending);
    document.body.append(root);

    resetShellCommands();
    state.commandSpecs = [];
    fromBackend.mockReset();
    fromBackend.mockResolvedValue([]);
    await loadKeyOverrides();
  });

  afterEach(() => {
    cancelSequence();
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

  function pending(): HTMLElement {
    const element = document.getElementById("key-pending");
    if (!element) throw new Error("manca lo stato della sequenza");
    return element;
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

  it("un consumo locale su una superficie documento non-CodeMirror lascia il comando alla superficie e non alla shell", () => {
    registerDocumentSearch();
    const executed = mountDispatcher();
    const surface = document.createElement("section");
    surface.setAttribute("data-document-surface", "");
    const localTarget = document.createElement("button");
    const unconsumedTarget = document.createElement("button");
    surface.append(localTarget, unconsumedTarget);
    const outsideTarget = document.createElement("button");
    root.append(surface, outsideTarget);
    let local = 0;
    localTarget.addEventListener("keydown", (event) => {
      local += 1;
      event.preventDefault();
    });
    outsideTarget.addEventListener("keydown", (event) => event.preventDefault());

    const inside = ctrlKeydown(localTarget, "f");
    expect(inside.defaultPrevented).toBe(true);
    expect(local, "la superficie locale ha consumato il gesto").toBe(1);
    expect(executed, "il comando shell non attraversa il consumo locale").toEqual([]);

    const unconsumedInside = ctrlKeydown(unconsumedTarget, "f");
    const outside = ctrlKeydown(outsideTarget, "f");

    expect(
      executed,
      "la shell resta attiva per un gesto non consumato nella superficie e per un consumo fuori dalla superficie",
    ).toEqual(["shell.doc.search", "shell.doc.search"]);
    expect(unconsumedInside.defaultPrevented).toBe(true);
    expect(outside.defaultPrevented, "fuori dalla superficie resta il comando shell").toBe(true);
  });

  it("l'apertura e chiusura programmatica di una trappola annulla subito una sequenza shell", async () => {
    registerDocumentSearch();
    const executed = mountDispatcher();
    fromBackend.mockResolvedValue([
      {
        spec: {
          key: "keys.shell.doc.search",
          label: "keys.shell.doc.search",
          description: "",
          group: "",
          scope: "machine",
          kind: { kind: "text", default: "" },
          program_writable: false,
        },
        value: "Mod-k d",
        source: "machine",
      } as SettingEntry,
    ]);
    await loadKeyOverrides();

    const first = ctrlKeydown(root, "k");
    expect(first.defaultPrevented).toBe(true);
    expect(pending().hidden).toBe(false);

    const overlay = document.createElement("section");
    overlay.tabIndex = -1;
    overlay.append(document.createElement("button"));
    root.append(overlay);
    const releaseTrap = trapFocus(overlay, () => {});
    try {
      expect(pending().hidden, "l'acquisizione della trappola cancella l'attesa senza un altro tasto").toBe(
        true,
      );

      releaseTrap();
      const second = ctrlKeydown(root, "d", false);
      expect(second.defaultPrevented).toBe(false);
      expect(executed, "la seconda corda non completa più la sequenza annullata").toEqual([]);
    } finally {
      releaseTrap();
    }
  });

  it("non mantiene un inventario di ID delle superfici transitorie nel dispatcher", () => {
    expect(keyboardSource).toContain("focusTrapOwnsKeyboard()");
    expect(keyboardSource).not.toMatch(/\b(?:TRANSITORY_OVERLAY_IDS|transientOverlayOpen)\b/);
    expect(keyboardSource).not.toMatch(/\b(?:command-palette|quick-switcher|context-menu|icon-picker)\b/);
    expect(keyboardSource.match(/document\.getElementById\(/g)).toHaveLength(1);
    expect(keyboardSource).not.toMatch(/document\.querySelector(?:All)?\(/);
  });
});
