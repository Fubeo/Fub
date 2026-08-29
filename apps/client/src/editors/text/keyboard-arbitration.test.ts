// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import type { SettingEntry } from "../../host/contract";
import { state } from "../../state/store";
import {
  loadKeyOverrides,
  registerShellCommand,
  resetShellCommands,
} from "../../ui/commands";
import { cancelSequence, mountKeyboard } from "../../ui/keyboard";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { createTextEngine, type TextEngine } from "./engine";
import { createMarkdownProfile } from "./profiles/markdown/profile";

// La tastiera chiede gli override alla stessa porta di produzione. Il banco ne
// cambia la risposta per verificare che il dispatcher la rilegga senza reload.
const fromBackend = vi.fn(async (): Promise<SettingEntry[]> => []);
vi.mock("../../host/query", () => ({ settings: () => fromBackend() }));

function settingEntry(key: string, value: string): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "",
      scope: "machine",
      kind: { kind: "text", default: "" },
      program_writable: false,
    },
    value,
    source: "machine",
  } as SettingEntry;
}

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

describe("la precedenza causale fra TextEngine e scorciatoie shell", () => {
  const lifetimes: Lifetime[] = [];
  const engines: TextEngine[] = [];
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
    for (const engine of engines.splice(0)) engine.destroy();
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

  function mountTextEditor(markdown = false): EditorView {
    const parent = document.createElement("div");
    root.append(parent);
    const profile = markdown
      ? createMarkdownProfile({
          callbacks: {
            openWikilink: () => {},
            searchTag: () => {},
          },
          completions: {
            searchNotes: async () => [],
            listTags: async () => [],
          },
        })
      : null;
    const engine = createTextEngine(parent, {
      onChange: () => {},
      onSelectionChange: () => {},
      ...(profile ? { extensions: () => profile.extensions() } : {}),
      theme: "light",
    });
    engines.push(engine);
    const view = EditorView.findFromDOM(parent);
    if (!view) throw new Error("la vera EditorView non è montata");
    view.focus();
    return view;
  }

  function registerDocumentSearch(): void {
    registerShellCommand({
      id: "shell.doc.search",
      title: "commands.doc.search",
      description: "commands.doc.search.desc",
      run: () => {},
    });
  }

  function registerPalette(): void {
    registerShellCommand({
      id: "shell.palette",
      title: "commands.palette",
      description: "commands.palette.desc",
      run: () => {},
    });
  }

  async function rebind(key: string, value: string): Promise<void> {
    fromBackend.mockResolvedValue([settingEntry(key, value)]);
    await loadKeyOverrides();
  }

  function pending(): HTMLElement {
    const element = document.getElementById("key-pending");
    if (!element) throw new Error("manca lo stato della sequenza");
    return element;
  }

  it("osserva il vero Ctrl-f di CodeMirror prima dell'esecutore shell", () => {
    registerDocumentSearch();
    const executed = mountDispatcher();
    const view = mountTextEditor();

    const event = ctrlKeydown(view.contentDOM, "f");

    // Su Linux Mod è Ctrl. CodeMirror consuma l'evento sul contentDOM, poi il
    // listener document della shell ne osserva il defaultPrevented già vero.
    expect(event.ctrlKey).toBe(true);
    expect(event.metaKey).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(executed).toEqual([]);
  });

  it("esegue subito Mod-q rebinding di search, ma conserva Ctrl-f a CodeMirror", async () => {
    registerDocumentSearch();
    const executed = mountDispatcher();
    const view = mountTextEditor();
    await rebind("keys.shell.doc.search", "Mod-q");

    const rebound = ctrlKeydown(view.contentDOM, "q");
    const codeMirror = ctrlKeydown(view.contentDOM, "f");

    expect(rebound.defaultPrevented).toBe(true);
    expect(executed).toEqual(["shell.doc.search"]);
    expect(codeMirror.defaultPrevented).toBe(true);
    expect(executed).toEqual(["shell.doc.search"]);
  });

  it("lascia Mod-f al vero editor dentro e al comando rebind fuori", async () => {
    registerPalette();
    const executed = mountDispatcher();
    const view = mountTextEditor();
    await rebind("keys.shell.palette", "Mod-f");

    const inside = ctrlKeydown(view.contentDOM, "f");
    expect(inside.defaultPrevented).toBe(true);
    expect(executed).toEqual([]);

    const outside = ctrlKeydown(root, "f");
    expect(outside.defaultPrevented).toBe(true);
    expect(executed).toEqual(["shell.palette"]);
  });

  it("non apre una sequenza se il suo primo accordo è consumato dal profilo Markdown", async () => {
    registerDocumentSearch();
    const executed = mountDispatcher();
    const view = mountTextEditor(true);
    await rebind("keys.shell.doc.search", "Mod-k d");

    const first = ctrlKeydown(view.contentDOM, "k");
    const following = ctrlKeydown(view.contentDOM, "d", false);

    expect(first.defaultPrevented).toBe(true);
    expect(pending().hidden).toBe(true);
    expect(following.defaultPrevented).toBe(false);
    expect(executed).toEqual([]);
  });

  it("esegue una sequenza shell non consumata", async () => {
    registerDocumentSearch();
    const executed = mountDispatcher();
    await rebind("keys.shell.doc.search", "Mod-k d");

    const first = ctrlKeydown(root, "k");
    expect(first.defaultPrevented).toBe(true);
    expect(pending().hidden).toBe(false);

    const second = ctrlKeydown(root, "d", false);
    expect(second.defaultPrevented).toBe(true);
    expect(pending().hidden).toBe(true);
    expect(executed).toEqual(["shell.doc.search"]);
  });

  it("cancella attesa e timer se CodeMirror consuma l'interruzione", async () => {
    registerDocumentSearch();
    const executed = mountDispatcher();
    const view = mountTextEditor();
    await rebind("keys.shell.doc.search", "Mod-k d");

    ctrlKeydown(root, "k");
    expect(pending().hidden).toBe(false);

    const interruption = ctrlKeydown(view.contentDOM, "f");
    expect(interruption.defaultPrevented).toBe(true);
    expect(pending().hidden).toBe(true);

    const following = ctrlKeydown(root, "d", false);
    expect(following.defaultPrevented).toBe(false);
    expect(executed).toEqual([]);
  });
});
