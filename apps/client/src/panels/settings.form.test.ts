// @vitest-environment happy-dom
// Il form generico delle impostazioni: cosa mostra, come lo dice a chi non
// guarda lo schermo, e i due gesti che non sono una riga sola (la lingua e il
// ripristino di un gruppo).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../host/contract";

const fake = vi.hoisted(() => ({
  entries: [] as SettingEntry[],
  setSetting: vi.fn(),
  resetSetting: vi.fn(),
  confirm: vi.fn(async () => true),
}));

vi.mock("../host/ipc", () => ({
  api: {
    setSetting: fake.setSetting,
    resetSetting: fake.resetSetting,
    settingsProfiles: async () => ({ active: "default", names: ["default"] }),
  },
}));
vi.mock("../host/dialog", () => ({ confirm: fake.confirm, pickFile: vi.fn(), pickFolder: vi.fn() }));
vi.mock("../host/query", () => ({ settings: async () => fake.entries }));
vi.mock("../state/kernel", () => ({ onEvent: vi.fn() }));
vi.mock("../ui/commands", () => ({ allCommands: () => [], keybindingKey: (id: string) => id }));
vi.mock("../ui/permissions", () => ({
  TRUST_LABELS: {},
  isPermissionKey: () => false,
  rows: () => [],
}));
vi.mock("../ui/a11y", () => ({ trapFocus: () => () => {} }));
vi.mock("../ui/motion", () => ({
  enterSurface: () => {},
  exitSurface: (_el: HTMLElement, done: () => void) => done(),
}));
vi.mock("../ui/tooltip", () => ({ setTooltip: () => {} }));
vi.mock("../ui/notify", () => ({ notify: vi.fn() }));

import { mountSettings } from "./settings";

function entry(
  key: string,
  kind: SettingEntry["spec"]["kind"],
  value: SettingEntry["value"],
  source: SettingEntry["source"] = "default",
  group = "Editor",
): SettingEntry {
  return {
    spec: {
      key,
      label: `etichetta ${key}`,
      description: `prosa ${key}`,
      group,
      scope: "machine",
      kind,
      program_writable: false,
    },
    value,
    source,
  };
}

const toggle = (key: string, value: boolean, source: SettingEntry["source"] = "default", group?: string) =>
  entry(key, { kind: "toggle", default: true }, value, source, group);

async function openPanel(entries: SettingEntry[]): Promise<void> {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  fake.entries = entries;
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button></div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await vi.waitFor(() => {
    expect(document.querySelector("#settings-body .setting-row")).not.toBeNull();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.confirm.mockResolvedValue(true);
  fake.setSetting.mockImplementation(async (key: string, value: unknown) => {
    const found = fake.entries.find((candidate) => candidate.spec.key === key)!;
    found.value = value as SettingEntry["value"];
    found.source = "machine";
  });
  fake.resetSetting.mockImplementation(async (key: string) => {
    const found = fake.entries.find((candidate) => candidate.spec.key === key)!;
    found.value = (found.spec.kind as { default: SettingEntry["value"] }).default;
    found.source = "default";
  });
});

describe("il form generico", () => {
  it("non mostra le chiavi che hanno un gesto loro altrove", async () => {
    await openPanel([
      toggle("editor.spellcheck", true),
      entry("chrome.schema", { kind: "number", default: 1, min: 1, max: 1 }, 1),
      entry("plugins.disabled", { kind: "list", default: [] }, []),
      entry("properties.types", { kind: "text", default: "{}" }, "{}"),
      entry("appearance.theme-id", { kind: "text", default: "fub.serie" }, "fub.serie"),
    ]);
    const keys = [...document.querySelectorAll<HTMLElement>("[data-setting-key]")].map((el) => el.dataset.settingKey);
    expect(keys).toEqual(["editor.spellcheck"]);
  });

  it("il campo annuncia prosa e provenienza, non solo l'etichetta", async () => {
    await openPanel([toggle("editor.spellcheck", true)]);
    const input = document.getElementById("setting-editor.spellcheck")!;
    const ids = input.getAttribute("aria-describedby")!.split(" ");
    const texts = ids.map((id) => document.getElementById(id)?.textContent);
    expect(texts[0]).toBe("prosa editor.spellcheck");
    expect(texts[1]).toBeTruthy();
  });

  it("la lingua è una scelta fra le lingue della shell, e tiene visibile un valore scritto altrove", async () => {
    await openPanel([entry("locale.language", { kind: "text", default: "" }, "it-CH", "vault", "Lingua")]);
    const select = document.getElementById("setting-locale.language") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    const values = [...select.options].map((option) => option.value);
    expect(values).toEqual(["", "it", "en", "it-CH"]);
    expect(select.value).toBe("it-CH");
    select.value = "en";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith("locale.language", "en"));
  });

  it("«Ripristina gruppo» compare solo dove c'è qualcosa da ripristinare, e azzera solo quelle righe", async () => {
    await openPanel([
      toggle("editor.spellcheck", false, "machine"),
      toggle("editor.vim", true, "machine"),
      toggle("editor.line-wrap", true),
      toggle("history.enabled", true, "default", "Privacy"),
    ]);
    const titles = [...document.querySelectorAll<HTMLElement>("#settings-body > .panel-title")];
    expect(titles.map((title) => title.querySelector("[role=heading]")?.textContent)).toEqual(["Editor", "Privacy"]);
    expect(titles[1]!.querySelector("button")).toBeNull();
    titles[0]!.querySelector("button")!.click();
    await vi.waitFor(() => expect(fake.resetSetting).toHaveBeenCalledTimes(2));
    expect(fake.resetSetting.mock.calls.map(([key]) => key)).toEqual(["editor.spellcheck", "editor.vim"]);
    await vi.waitFor(() => expect(document.querySelector("#settings-body > .panel-title button")).toBeNull());
  });

  it("se l'utente ci ripensa, il gruppo resta com'era", async () => {
    fake.confirm.mockResolvedValue(false);
    await openPanel([toggle("editor.spellcheck", false, "machine")]);
    document.querySelector<HTMLButtonElement>("#settings-body > .panel-title button")!.click();
    await vi.waitFor(() => expect(fake.confirm).toHaveBeenCalled());
    await Promise.resolve();
    expect(fake.resetSetting).not.toHaveBeenCalled();
  });
});
