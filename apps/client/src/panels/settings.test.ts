// @vitest-environment happy-dom
// Le due regole del pannello delle impostazioni (§11.1), provate senza DOM:
// **come si raggruppano le righe** e **cosa si dice della provenienza di un
// valore**. Il resto del modulo è DOM e IPC; queste due sono decisioni, e una
// decisione che si prova solo aprendo l'app non la prova nessuno.
//
// In fondo `revealSetting`, provata sul pannello vero con un host finto: è il
// gesto con cui un'altra parte della finestra («Cambia cartella» della
// lavagna) porta a una voce.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry, SettingSource, SettingScope } from "../host/contract";

const fake = vi.hoisted(() => ({ entries: [] as unknown[] }));

vi.mock("../host/ipc", () => ({
  api: {
    setSetting: vi.fn(),
    resetSetting: vi.fn(),
    settingsProfiles: async () => ({ active: "default", names: ["default"] }),
    knownVaults: async () => [],
    frameCapabilities: async () => ({ system: true, custom: true }),
    settingRequiresReopen: async () => false,
  },
}));
vi.mock("../host/dialog", () => ({ confirm: vi.fn(async () => true), pickFile: vi.fn(), pickFolder: vi.fn() }));
vi.mock("../platform/confirm", () => ({ confirm: vi.fn(async () => true) }));
vi.mock("../host/query", () => ({ settings: async () => fake.entries }));
vi.mock("../state/kernel", () => ({ onEvent: () => () => {} }));
vi.mock("../ui/commands", () => ({ allCommands: () => [], keybindingKey: (id: string) => id }));
vi.mock("../ui/permissions", () => ({ TRUST_LABELS: {}, isPermissionKey: () => false, rows: () => [] }));
vi.mock("../ui/a11y", () => ({ trapFocus: () => () => {} }));
vi.mock("../ui/motion", () => ({
  enterSurface: () => {},
  exitSurface: (_el: HTMLElement, done: () => void) => done(),
}));
vi.mock("../ui/notify", () => ({ notify: vi.fn() }));

import { mountSettings, revealSetting, sourceLabel, groupEntries } from "./settings";

function entry(
  key: string,
  group: string,
  source: SettingSource = "default",
  scope: SettingScope = "vault",
): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group,
      scope,
      kind: { kind: "toggle", default: false },
      program_writable: false,
    },
    value: false,
    source,
  };
}

describe("il form generato dallo schema", () => {
  it("i gruppi escono nell'ordine di prima apparizione, non in ordine alfabetico", () => {
    // Chi dichiara le proprie impostazioni le scrive nell'ordine in cui vanno
    // lette: ordinarle per nome metterebbe «Avanzate» prima di «Generali».
    const groups = groupEntries([
      entry("z", "Vault"),
      entry("a", "Componenti"),
      entry("b", "Vault"),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Vault", "Componenti"]);
    expect(groups[0].rows.map((r) => r.spec.key)).toEqual(["z", "b"]);
  });

  it("le righe senza gruppo vanno in fondo, sotto un'intestazione loro", () => {
    // In mezzo sembrerebbero del gruppo precedente, che è il modo più facile di
    // far credere a un utente che un'impostazione riguardi un'altra cosa.
    const groups = groupEntries([entry("sciolta", ""), entry("a", "Vault")]);
    expect(groups.map((g) => g.title)).toEqual(["Vault", "Altro"]);
    expect(groups[1].rows.map((r) => r.spec.key)).toEqual(["sciolta"]);
  });

  it("senza righe non ci sono gruppi, nemmeno quello di scarto", () => {
    expect(groupEntries([])).toEqual([]);
  });

  it("la provenienza dice se il valore viaggia col vault", () => {
    // È l'informazione che un utente non può dedurre: due righe identiche si
    // toccano allo stesso modo e si comportano diversamente su un'altra
    // macchina.
    expect(sourceLabel(entry("a", "", "default", "machine"))).toContain("questa macchina");
    expect(sourceLabel(entry("a", "", "default", "vault"))).toContain("questo vault");
    expect(sourceLabel(entry("a", "", "vault"))).toBe("scelto per questo vault");
    expect(sourceLabel(entry("a", "", "machine"))).toBe("scelto per questa macchina");
  });
});

describe("revealSetting", () => {
  const FOLDER = "files.attachment-folder";
  let teardown: () => void = () => {};

  function text(key: string, group: string): SettingEntry {
    return {
      spec: { key, label: `etichetta ${key}`, description: "", group, scope: "vault", kind: { kind: "text", default: "" }, program_writable: false },
      value: "",
      source: "default",
    };
  }

  function mount(): void {
    fake.entries = [text("editor.font", "Scrittura"), text(FOLDER, "File")];
    document.body.innerHTML = `
      <button id="open-settings"></button>
      <section id="settings-panel" hidden>
        <button id="settings-close"></button>
        <div id="settings-tabs"><button data-tab="settings"></button><button data-tab="vault"></button></div>
        <div id="settings-toolbar" hidden>
          <input id="settings-search" type="search" />
          <button id="settings-modified" type="button" aria-pressed="false"></button>
          <span id="settings-count"></span>
        </div>
        <div id="settings-scroll"><div id="settings-body"></div></div>
      </section>`;
    teardown = mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
  }

  const panel = () => document.querySelector<HTMLElement>("#settings-panel")!;
  const row = (key: string) => document.querySelector<HTMLElement>(`.setting-row[data-setting-key="${key}"]`);
  const selected = () => document.querySelector<HTMLElement>('#settings-tabs [aria-selected="true"]')?.dataset.tab;

  afterEach(() => {
    teardown();
    document.body.innerHTML = "";
  });

  it("dalle Impostazioni aperte su un'altra scheda, porta alla voce e le dà il fuoco", async () => {
    mount();
    document.querySelector<HTMLButtonElement>("#open-settings")!.click();
    await vi.waitFor(() => expect(row("editor.font")).not.toBeNull());
    document.querySelector<HTMLButtonElement>('#settings-tabs [data-tab="vault"]')!.click();
    await vi.waitFor(() => expect(row("editor.font")).toBeNull());
    expect(selected()).toBe("vault");

    await revealSetting(FOLDER);

    expect(panel().hidden).toBe(false);
    expect(selected()).toBe("settings");
    expect(row(FOLDER)!.hidden).toBe(false);
    expect(row(FOLDER)!.contains(document.activeElement)).toBe(true);
  });

  it("a Impostazioni chiuse le apre già sulla voce, che resta in vista sotto un filtro", async () => {
    mount();
    expect(panel().hidden).toBe(true);
    const search = document.querySelector<HTMLInputElement>("#settings-search")!;

    await revealSetting(FOLDER);

    expect(panel().hidden).toBe(false);
    expect(row(FOLDER)!.contains(document.activeElement)).toBe(true);
    search.value = "font";
    search.dispatchEvent(new Event("input"));
    // Scrivere nel filtro lascia la riga: la tiene solo il gesto che ci ha portati.
    expect(row(FOLDER)!.hidden).toBe(true);
    await revealSetting(FOLDER);
    expect(row(FOLDER)!.hidden).toBe(false);
    expect(row("editor.font")!.hidden).toBe(false);
  });

  it("una chiave che il vault non ha apre le Impostazioni e basta", async () => {
    mount();
    document.querySelector<HTMLButtonElement>("#open-settings")!.click();
    await vi.waitFor(() => expect(row("editor.font")).not.toBeNull());
    document.querySelector<HTMLButtonElement>('#settings-tabs [data-tab="vault"]')!.click();
    await vi.waitFor(() => expect(row("editor.font")).toBeNull());

    await revealSetting("non.esiste");

    expect(panel().hidden).toBe(false);
    expect(selected()).toBe("vault");
  });
});
