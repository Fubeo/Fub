// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../host/contract";
import type { CommandEntry } from "../ui/commands";

// La riga di una scorciatoia che non torna porta `data-issue`: la pelle la
// veste da quello (fondo del pericolo, bordo della riga dopo), non da un
// `:has(.setting-diagnostic:not(:empty))`, che in WebKit costava ogni testo
// cambiato nella finestra (`docs/product/performance-webview.md`).

const fake = vi.hoisted(() => ({ entries: [] as unknown[], commands: [] as unknown[] }));

vi.mock("../host/ipc", () => ({
  api: {
    setSetting: vi.fn(),
    resetSetting: vi.fn(),
    pendingKeybindings: async () => ({}),
  },
}));
vi.mock("../host/query", () => ({ settings: async () => fake.entries }));
vi.mock("../state/kernel", () => ({ onEvent: vi.fn() }));
vi.mock("../ui/commands", async (original) => ({
  ...(await original<typeof import("../ui/commands")>()),
  allCommands: () => fake.commands,
  registerComponentRow: () => () => {},
}));
vi.mock("../ui/permissions", () => ({ TRUST_LABELS: {}, isPermissionKey: () => false, rows: () => [] }));
vi.mock("../ui/a11y", async (original) => ({
  ...(await original<typeof import("../ui/a11y")>()),
  trapFocus: () => () => {},
}));
vi.mock("../ui/motion", () => ({
  enterSurface: () => {},
  exitSurface: (_el: HTMLElement, done: () => void) => done(),
}));
vi.mock("../ui/tooltip", () => ({ setTooltip: () => {}, attachTooltip: () => () => {} }));
vi.mock("../ui/notify", () => ({ notify: vi.fn() }));

import { mountSettings } from "./settings";

function command(id: string, binding: string): CommandEntry {
  return { id, title: id, description: "", layer: "global", binding, declared: binding, spec: null, run: () => {} } as CommandEntry;
}

function keyEntry(id: string, value: string): SettingEntry {
  return {
    spec: {
      key: `keys.${id}`,
      label: id,
      description: "",
      group: "",
      scope: "machine",
      kind: { kind: "text", default: "" },
      program_writable: false,
    },
    value,
    source: "machine",
  } as unknown as SettingEntry;
}

async function openShortcuts(): Promise<void> {
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button><button data-tab="shortcuts"></button></div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  document.querySelector<HTMLButtonElement>('[data-tab="shortcuts"]')!.click();
  await vi.waitFor(() => {
    expect(document.querySelector('#settings-body .setting-row[data-setting-key="keys.uno"]')).not.toBeNull();
  });
}

describe("la riga di una scorciatoia che non torna", () => {
  it("porta `data-issue` finché la diagnosi dice qualcosa, e lo perde quando torna", async () => {
    fake.commands = [command("uno", "Mod-Shift-y"), command("due", "Mod-Shift-y")];
    fake.entries = [keyEntry("uno", "Mod-Shift-y"), keyEntry("due", "Mod-Shift-y")];
    await openShortcuts();
    const row = document.querySelector<HTMLElement>('.setting-row[data-setting-key="keys.uno"]')!;
    const diagnostic = row.querySelector<HTMLElement>(".setting-diagnostic")!;
    // Due comandi sullo stesso accordo: la diagnosi parla, la riga lo dice.
    expect(diagnostic.textContent).not.toBe("");
    expect(row.hasAttribute("data-issue")).toBe(true);

    const input = row.querySelector<HTMLInputElement>("input[type=text]")!;
    input.value = "Mod-Shift-u";
    input.dispatchEvent(new Event("input"));
    expect(diagnostic.textContent).toBe("");
    expect(row.hasAttribute("data-issue")).toBe(false);
  });
});
