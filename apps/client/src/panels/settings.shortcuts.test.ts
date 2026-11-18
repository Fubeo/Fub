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

import { api } from "../host/ipc";
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

describe("un comando senza scorciatoia (IMP-140)", () => {
  it("ha la riga vuota e neutra; un valore scritto male la fa ancora parlare", async () => {
    // A stato pulito il campo di un comando senza scorciatoia vale "": è
    // «nessuna scorciatoia», non una scorciatoia scritta male.
    fake.commands = [command("uno", "Mod-Shift-y"), { ...command("muto", ""), binding: null, declared: null }];
    fake.entries = [keyEntry("uno", "Mod-Shift-y"), keyEntry("muto", "")];
    await openShortcuts();
    const row = document.querySelector<HTMLElement>('.setting-row[data-setting-key="keys.muto"]')!;
    const diagnostic = row.querySelector<HTMLElement>(".setting-diagnostic")!;
    const input = row.querySelector<HTMLInputElement>("input[type=text]")!;
    expect(input.value).toBe("");
    expect(diagnostic.textContent).toBe("");
    expect(row.hasAttribute("data-issue")).toBe(false);
    expect(input.hasAttribute("aria-invalid")).toBe(false);

    input.value = "xx";
    input.dispatchEvent(new Event("input"));
    expect(diagnostic.textContent).not.toBe("");
    expect(row.hasAttribute("data-issue")).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");

    // Svuotarlo di nuovo torna a «nessuna scorciatoia», anche con soli spazi.
    input.value = "  ";
    input.dispatchEvent(new Event("input"));
    expect(diagnostic.textContent).toBe("");
    expect(row.hasAttribute("data-issue")).toBe(false);
  });
});

describe("una scorciatoia fra le righe sciolte (IMP-026)", () => {
  it("«xx» non si salva: la riga dice perché, come la scheda delle scorciatoie", async () => {
    // Nessun comando la porta, quindi la riga sta nella configurazione, fra le
    // sciolte: è la chiave a dire che è una scorciatoia.
    fake.commands = [];
    fake.entries = [keyEntry("shell.pane.focus.left", "Mod-Alt-ArrowLeft")];
    document.body.innerHTML = `
      <button id="open-settings"></button>
      <section id="settings-panel" hidden>
        <div id="settings-tabs"><button data-tab="settings"></button><button data-tab="shortcuts"></button></div>
        <button id="settings-close"></button>
        <div id="settings-body"></div>
      </section>`;
    mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
    document.querySelector<HTMLButtonElement>("#open-settings")!.click();
    const selector = '#settings-body .setting-row[data-setting-key="keys.shell.pane.focus.left"]';
    await vi.waitFor(() => expect(document.querySelector(selector)).not.toBeNull());
    const input = document.querySelector<HTMLInputElement>(`${selector} input[type=text]`)!;
    input.value = "xx";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector(`${selector} .setting-error`)).not.toBeNull());
    expect(vi.mocked(api.setSetting)).not.toHaveBeenCalled();
    expect(document.querySelector(`${selector} .setting-error-message`)?.textContent).toContain("combinazione non riconosciuta");
    expect(document.querySelector(`${selector} .setting-attempted`)?.textContent).toBe("xx");
    expect(document.querySelector<HTMLInputElement>(`${selector} input[type=text]`)!.value).toBe("Mod-Alt-ArrowLeft");
  });
});
