// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "../host/fake";
import type { BundleInfo, InstalledPluginInfo, SettingEntry, SettingValue, ThemeInfo } from "../host/contract";
import { state } from "../state/store";
import { permissionKey } from "../ui/permissions";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  confirm: true,
  /// Le domande fatte alla modale di conferma, nell'ordine.
  asked: [] as string[],
  file: null as string | null,
  entries: [] as SettingEntry[],
  themes: [] as ThemeInfo[],
  themeId: "fub.serie",
  themeLight: "light" as "light" | "dark",
  preview: null as { id: string; light: "light" | "dark" } | null,
  reloadProvider: vi.fn(async () => {}),
  notify: vi.fn(),
}));

vi.mock("../host/ipc", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) => {
        if (!box.host) throw new Error("host finto non montato");
        const method = box.host.module.api[name as keyof typeof box.host.module.api] as (
          ...values: unknown[]
        ) => unknown;
        const result = method(...args);
        if (name !== "setSetting" && name !== "resetSetting") return result;
        return Promise.resolve(result).then(() => {
          const key = args[0] as string;
          const row = box.entries.find((entry) => entry.spec.key === key);
          if (!row) return;
          row.value = name === "resetSetting" ? row.spec.kind.default : (args[1] as SettingValue);
          row.source = name === "resetSetting" ? "default" : row.spec.scope;
        });
      },
    },
  ),
}));
vi.mock("../theme/theme", () => ({
  CONTRAST_KEY: "appearance.contrast",
  SERIES_THEME_ID: "fub.serie",
  THEME_KEY: "appearance.theme",
  currentThemeId: () => box.themeId,
  currentThemePreview: () => (box.preview ? { ...box.preview } : null),
  previewTheme: async (id: string, light: "light" | "dark") => {
    box.preview = { id, light };
    document.documentElement.dataset.theme = light;
  },
  cancelThemePreview: async () => {
    box.preview = null;
    document.documentElement.dataset.theme = box.themeLight;
  },
  selectTheme: async (id: string, light: "light" | "dark") => {
    box.preview = null;
    box.themeId = id;
    box.themeLight = light;
    document.documentElement.dataset.theme = light;
    const entry = box.entries.find((candidate) => candidate.spec.key === "appearance.theme");
    if (entry) entry.value = light;
  },
  themeCatalog: async () => box.themes,
}));
vi.mock("../host/dialog", () => ({
  confirm: (message: string) => {
    box.asked.push(message);
    return Promise.resolve(box.confirm);
  },
  pickFile: () => Promise.resolve(box.file),
  pickFolder: () => Promise.resolve(box.file),
}));
vi.mock("../host/query", () => ({ settings: async () => box.entries }));
vi.mock("../state/kernel", () => ({ onEvent: vi.fn() }));
vi.mock("../ui/commands", () => ({ allCommands: () => [], keybindingKey: (id: string) => id }));
vi.mock("../ui/a11y", () => ({ trapFocus: () => () => {} }));
vi.mock("../ui/motion", () => ({
  enterSurface: () => {},
  exitSurface: (_element: HTMLElement, done: () => void) => done(),
}));
vi.mock("../ui/tooltip", () => ({ setTooltip: () => {} }));
vi.mock("../ui/notify", () => ({ notify: box.notify }));

// Questi import devono seguire i mock issati: il test verifica il seam
// sostituibile e un import statico legherebbe settings all'IPC reale.
const { createFakeHost } = await import("../host/fake");
const { mountSettings } = await import("./settings");

function installed(overrides: Partial<InstalledPluginInfo> = {}): InstalledPluginInfo {
  return {
    id: "com.acme.notes",
    name: "Acme Notes",
    mounted: false,
    kind: "component",
    trust: "community",
    permissions: { "fub:read-vault": true },
    installation: "41",
    version: "1.2.3",
    enabled: false,
    consent: "undecided",
    runtime_known: false,
    revoked: false,
    ...overrides,
  };
}

function bundled(overrides: Partial<BundleInfo> = {}): BundleInfo {
  return {
    id: "fub.search",
    name: "Search",
    mounted: true,
    kind: "component",
    trust: "core",
    permissions: {},
    ...overrides,
  };
}

function grantedReadPermission(id: string): SettingEntry {
  const key = permissionKey(id, "fub:read-vault");
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "permissions",
      scope: "machine",
      kind: { kind: "toggle", default: false },
      program_writable: false,
    },
    value: true,
    source: "machine",
  };
}

async function openComponents(): Promise<void> {
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs" role="tablist">
        <button data-tab="settings"></button>
        <button data-tab="components"></button>
        <button data-tab="shortcuts"></button>
        <button data-tab="vault"></button>
      </div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  mountSettings({ openVault: async () => {}, reloadProvider: box.reloadProvider });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  document.querySelector<HTMLButtonElement>('button[data-tab="components"]')!.click();
  await vi.waitFor(() => {
    expect(document.querySelector("#settings-body #installed-enabled-41, #settings-body button")).not.toBeNull();
  });
}

function choiceEntry(key: string, value: string, options: string[]): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "Appearance",
      scope: "vault",
      kind: {
        kind: "choice",
        default: options[0] ?? "",
        options: options.map((option) => ({ value: option, label: option })),
      },
      program_writable: false,
    },
    value,
    source: "default",
  };
}

function theme(id: string, lights: Array<"light" | "dark">): ThemeInfo {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      engine: "theme-1",
      lights,
      asset_namespace: `theme://${id}/`,
      motion: [],
    },
    trust: id === "fub.serie" ? "core" : "community",
  };
}

async function openSettings(entries: SettingEntry[], themes: ThemeInfo[] = [], host?: FakeHost): Promise<void> {
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button></div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  box.entries = entries;
  box.themes = themes;
  document.documentElement.dataset.theme = box.themeLight;
  box.host = host ?? createFakeHost({ settings: entries });
  mountSettings({ openVault: async () => {}, reloadProvider: box.reloadProvider });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await vi.waitFor(() => {
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
  });
}

beforeEach(() => {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  vi.clearAllMocks();
  box.themeId = "fub.serie";
  box.themeLight = "light";
  box.preview = null;
  box.themes = [];
  box.confirm = true;
  box.file = null;
  box.entries = [];
  box.host = createFakeHost();
  state.vaultRoot = "/vault";
});

describe("inventario dei componenti installati", () => {
  it("mostra un'installazione negata senza nascondere il bundle ufficiale omonimo", async () => {
    box.host = createFakeHost({
      bundles: [bundled({ id: "com.acme.notes", name: "Official Notes" })],
      installedPlugins: [installed({ consent: "denied", runtime_known: false })],
    });

    await openComponents();

    const text = document.querySelector("#settings-body")!.textContent ?? "";
    expect(text).toContain("Official Notes");
    expect(text).toContain("Acme Notes");
    expect(document.querySelector<HTMLSelectElement>("#installed-consent-41")!.value).toBe("denied");
    expect(text).toContain("non in esecuzione");
  });

  it("mantiene visibili i metadata senza un vault o un inventario runtime leggibile", async () => {
    state.vaultRoot = "";
    box.host = createFakeHost({
      installedPlugins: [installed({ enabled: false, consent: "denied", mounted: true, runtime_known: true })],
    });
    box.host.fault("listBundles", "nessun vault aperto");

    await openComponents();

    expect(document.querySelector("#settings-body")!.textContent).toContain("Acme Notes");
    expect(document.querySelector<HTMLSelectElement>("#installed-consent-41")!.value).toBe("denied");
    expect(document.querySelector("#settings-body")!.textContent).toContain("non in esecuzione");
  });

  it("un inventario installato illeggibile non nasconde i controlli nativi", async () => {
    box.host = createFakeHost({ bundles: [bundled()] });
    box.host.fault("listInstalledPlugins", "inventario illeggibile");
    await openComponents();

    const native = document.getElementById("bundle-fub.search") as HTMLInputElement | null;
    expect(native?.checked).toBe(true);
    expect(native?.disabled).toBe(false);
    expect(document.getElementById("installed-enabled-41")).toBeNull();
  });

  it("conserva il grant granulare di un'installazione montata con claim corrispondente", async () => {
    const plugin = installed({ enabled: true, consent: "granted", mounted: true, runtime_known: true });
    box.entries = [grantedReadPermission(plugin.id)];
    box.host = createFakeHost({ bundles: [plugin], installedPlugins: [plugin] });
    await openComponents();

    const permission = document.getElementById(`permission-${box.entries[0].spec.key}`) as HTMLInputElement | null;
    expect(permission?.checked).toBe(true);
    expect(permission?.disabled).toBe(false);
    expect(document.getElementById(`bundle-${plugin.id}`)).toBeNull();
  });

  it("un'installazione in collisione non prende i controlli permission dell'official", async () => {
    const plugin = installed();
    const official = bundled({ id: plugin.id, permissions: plugin.permissions });
    box.entries = [grantedReadPermission(plugin.id)];
    box.host = createFakeHost({ bundles: [official], installedPlugins: [plugin] });
    await openComponents();

    const permissionId = `permission-${box.entries[0].spec.key}`;
    const controls = [...document.querySelectorAll<HTMLInputElement>("input")].filter((input) => input.id === permissionId);
    expect(controls).toHaveLength(1);
    expect(controls[0].checked).toBe(true);
    expect(document.getElementById(`bundle-${plugin.id}`)).not.toBeNull();
    expect(document.getElementById("installed-enabled-41")).not.toBeNull();
  });

  it("a signed revocation displays provenance and cannot enable or mount", async () => {
    const revoked = installed({
      revoked: true, enabled: true, mounted: true,
      catalog: { key_id: "release-key", generation: "9007199254740993",
        publisher: "Acme", url: "https://acme.test/plugin", license: "MIT", compatible: ">=0.1" },
      revocation: { key_id: "revocation-key", generation: "9007199254740994",
        publisher: "Acme", url: "https://acme.test/feed", license: "MIT", compatible: ">=0.1" },
    });
    box.host = createFakeHost({ installedPlugins: [revoked] });
    await openComponents();
    const enabled = document.querySelector<HTMLInputElement>("#installed-enabled-41")!;
    expect(enabled.disabled).toBe(true);
    expect(enabled.checked).toBe(false);
    expect(document.querySelector("#settings-body")?.textContent).toContain("revocation-key");
    expect(document.querySelector("#settings-body")?.textContent).toContain("9007199254740994");
    await expect(box.host.module.api.setInstalledPluginEnabled("41", true))
      .rejects.toMatchObject({ kind: "permission_denied" });
    const [plugin] = await box.host.module.api.listInstalledPlugins("/vault");
    expect(plugin.mounted).toBe(false);
  });

  it("abilitazione e consenso restano scelte distinte e solo insieme montano il runtime", async () => {
    box.host = createFakeHost({ installedPlugins: [installed()] });
    await openComponents();

    const enabled = document.querySelector<HTMLInputElement>("#installed-enabled-41")!;
    enabled.checked = true;
    enabled.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(async () => {
      const [plugin] = await box.host!.module.api.listInstalledPlugins("/vault");
      expect(plugin).toMatchObject({ enabled: true, consent: "undecided", mounted: false });
    });

    const consent = document.querySelector<HTMLSelectElement>("#installed-consent-41")!;
    consent.value = "granted";
    consent.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(async () => {
      const [plugin] = await box.host!.module.api.listInstalledPlugins("/vault");
      expect(plugin).toMatchObject({ enabled: true, consent: "granted", mounted: true });
    });
  });
  it("concedere il consenso chiede prima, elencando i permessi; un no non concede niente", async () => {
    box.host = createFakeHost({ installedPlugins: [installed()] });
    box.asked = [];
    box.confirm = false;
    await openComponents();

    const consent = document.querySelector<HTMLSelectElement>("#installed-consent-41")!;
    consent.value = "granted";
    consent.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(box.asked.length).toBe(1));
    expect(box.asked[0]).toContain("•");
    await vi.waitFor(() => expect(consent.value).toBe("undecided"));
    const [plugin] = await box.host.module.api.listInstalledPlugins("/vault");
    expect(plugin).toMatchObject({ consent: "undecided", mounted: false });
    box.confirm = true;
  });

  it("dopo una mutazione fallita rilegge la scelta autorevole senza lasciare il controllo ottimista", async () => {
    box.host = createFakeHost({ installedPlugins: [installed({ consent: "denied" })] });
    const repair = box.host.fault("setInstalledPluginConsent", "disco non scrivibile");
    await openComponents();

    const consent = document.querySelector<HTMLSelectElement>("#installed-consent-41")!;
    consent.value = "granted";
    consent.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      expect(box.notify).toHaveBeenCalled();
      expect(document.querySelector<HTMLSelectElement>("#installed-consent-41")!.value).toBe("denied");
    });
    const [plugin] = await box.host.module.api.listInstalledPlugins("/vault");
    expect(plugin.consent).toBe("denied");
    expect(box.reloadProvider).toHaveBeenCalled();
    repair();
  });

  it("installa soltanto il file scelto e lascia il nuovo componente spento e senza consenso", async () => {
    const candidate = installed({ installation: "41", enabled: true, consent: "granted", mounted: true });
    box.host = createFakeHost({ installablePlugins: { "/tmp/acme.wasm": candidate } });
    await openComponents();

    let install = [...document.querySelectorAll<HTMLButtonElement>("#settings-body button")].find(
      (button) => button.textContent?.includes("Scegli file"),
    )!;
    install.click();
    await vi.waitFor(() => expect(install.isConnected).toBe(false));
    expect(box.host.atGate("installPlugin")).toHaveLength(0);

    box.file = "/tmp/acme.wasm";
    install = [...document.querySelectorAll<HTMLButtonElement>("#settings-body button")].find(
      (button) => button.textContent?.includes("Scegli file"),
    )!;
    install.click();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLInputElement>("#installed-enabled-41")?.checked).toBe(false);
      expect(document.querySelector<HTMLSelectElement>("#installed-consent-41")?.value).toBe("undecided");
    });
    const [plugin] = await box.host.module.api.listInstalledPlugins("/vault");
    expect(plugin).toMatchObject({ enabled: false, consent: "undecided", mounted: false });
  });

  it("rimuove solo dopo conferma, dichiara la conservazione dati e non ridisegna una superficie chiusa", async () => {
    box.host = createFakeHost({ installedPlugins: [installed()] });
    await openComponents();

    let remove = [...document.querySelectorAll<HTMLButtonElement>("#settings-body button")].find(
      (button) => button.textContent === "Rimuovi",
    )!;
    box.confirm = false;
    remove.click();
    await vi.waitFor(() => expect(remove.isConnected).toBe(false));
    expect(box.host.atGate("removeInstalledPlugin")).toHaveLength(0);

    box.confirm = true;
    remove = [...document.querySelectorAll<HTMLButtonElement>("#settings-body button")].find(
      (button) => button.textContent === "Rimuovi",
    )!;
    remove.click();
    await vi.waitFor(() => expect(box.host!.atGate("removeInstalledPlugin")).toHaveLength(1));
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    await vi.waitFor(async () => {
      expect(await box.host!.module.api.listInstalledPlugins("/vault")).toEqual([]);
      expect(document.querySelector<HTMLElement>("#settings-panel")!.hidden).toBe(true);
    });
  });
  it("lascia scadere il ridisegno di una mutazione ancora in volo quando il pannello chiude", async () => {
    box.host = createFakeHost({ installedPlugins: [installed()] });
    const releaseMutation = box.host.throttle("setInstalledPluginEnabled");
    await openComponents();

    const enabled = document.querySelector<HTMLInputElement>("#installed-enabled-41")!;
    enabled.checked = true;
    enabled.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(box.host!.atGate("setInstalledPluginEnabled")).toHaveLength(1));
    expect(enabled.disabled).toBe(true);

    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    releaseMutation();
    await vi.waitFor(async () => {
      const [plugin] = await box.host!.module.api.listInstalledPlugins("/vault");
      expect(plugin.enabled).toBe(true);
      expect(document.querySelector<HTMLElement>("#settings-panel")!.hidden).toBe(true);
    });
  });

});

describe("settings profile boundary", () => {
  it("exports and reimports opaque profile JSON without parsing it in the shell", async () => {
    const entries = [choiceEntry("appearance.theme", "light", ["light", "dark"])];
    const host = createFakeHost({ settings: entries });
    const payload = '{ "schema": 1, "name": "Default", "values": { "future.key": { "nested": [1, "opaque"] } } }';
    vi.spyOn(host.module.api, "settingsProfiles").mockResolvedValue({ active: "Default", names: ["Default"] });
    vi.spyOn(host.module.api, "exportSettingsProfile").mockResolvedValue(payload);
    const imported = vi.spyOn(host.module.api, "importSettingsProfile").mockResolvedValue(undefined);
    await openSettings(entries, [theme("fub.serie", ["light", "dark"])], host);

    const machine = [...document.querySelectorAll<HTMLElement>("section.settings-banner")].find(
      (section) => section.querySelector(".panel-title")?.textContent === "Profili delle impostazioni della macchina",
    )!;
    const action = (label: string) => [...machine.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === label,
    )!;
    action("Esporta il profilo scelto come JSON").click();
    const json = machine.querySelector<HTMLTextAreaElement>('textarea[aria-label="JSON del profilo"]')!;
    await vi.waitFor(() => expect(json.value).toBe(payload));
    expect(machine.querySelector('[role="status"]')?.textContent).toContain("pronto da copiare");
    action("Importa il JSON incollato").click();
    await vi.waitFor(() => expect(imported).toHaveBeenCalledWith("machine", payload, undefined));
  });
});

describe("radiogroup del tema e della luce", () => {
  it("mantiene il roving e attiva frecce, Home e End nel catalogo", async () => {
    const entries = [choiceEntry("appearance.theme", "light", ["light", "dark"])];
    await openSettings(entries, [theme("fub.serie", ["light", "dark"])]);

    const groups = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"]')];
    const catalog = groups[1]!;
    const radios = [...catalog.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);

    radios[0]!.focus();
    const right = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    radios[0]!.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(radios[1]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0]);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true"]);

    const end = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    radios[1]!.dispatchEvent(end);
    expect(document.activeElement).toBe(radios[1]);
    const home = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    radios[1]!.dispatchEvent(home);
    expect(document.activeElement).toBe(radios[0]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);

    await vi.waitFor(() => {
      const current = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"]')][1]!;
      const currentRadios = [...current.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
      expect(currentRadios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
      expect(currentRadios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(1);
    });
  });

  it("prova senza persistere, annulla al tema precedente e applica solo su richiesta", async () => {
    const entries = [choiceEntry("appearance.theme", "light", ["light", "dark"])];
    await openSettings(entries, [
      theme("fub.serie", ["light", "dark"]),
      theme("org.fub.paper", ["light", "dark"]),
    ]);

    const catalog = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"]')][1]!;
    const radios = [...catalog.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const paperDark = radios.find(
      (radio) =>
        radio.dataset.themeId === "org.fub.paper" && radio.dataset.themeLight === "dark",
    )!;
    paperDark.click();

    await vi.waitFor(() => {
      expect(box.preview).toEqual({ id: "org.fub.paper", light: "dark" });
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
    expect(box.themeId).toBe("fub.serie");
    expect(box.themeLight).toBe("light");
    expect(entries[0]!.value).toBe("light");

    const cancel = [...document.querySelectorAll<HTMLButtonElement>("#settings-body button")].find(
      (button) => button.textContent === "Annulla anteprima",
    )!;
    cancel.click();
    await vi.waitFor(() => {
      expect(box.preview).toBeNull();
      expect(document.documentElement.dataset.theme).toBe("light");
    });
    expect(box.themeId).toBe("fub.serie");
    expect(entries[0]!.value).toBe("light");

    const currentCatalog = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"]')][1]!;
    const currentPaperDark = [...currentCatalog.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (radio) =>
        radio.dataset.themeId === "org.fub.paper" && radio.dataset.themeLight === "dark",
    )!;
    currentPaperDark.click();
    await vi.waitFor(() =>
      expect(box.preview).toEqual({ id: "org.fub.paper", light: "dark" }),
    );

    const apply = [...document.querySelectorAll<HTMLButtonElement>("#settings-body button")].find(
      (button) => button.textContent === "Applica tema",
    )!;
    apply.click();
    await vi.waitFor(() => {
      expect(box.preview).toBeNull();
      expect(box.themeId).toBe("org.fub.paper");
      expect(box.themeLight).toBe("dark");
      expect(entries[0]!.value).toBe("dark");
    });
  });

  it("annulla una preview quando il pannello viene chiuso", async () => {
    const entries = [choiceEntry("appearance.theme", "light", ["light", "dark"])];
    await openSettings(entries, [theme("fub.serie", ["light", "dark"])]);

    const catalog = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"]')][1]!;
    const dark = [...catalog.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (radio) => radio.dataset.themeLight === "dark",
    )!;
    dark.click();
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));

    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    await vi.waitFor(() => {
      expect(box.preview).toBeNull();
      expect(document.documentElement.dataset.theme).toBe("light");
    });
    expect(entries[0]!.value).toBe("light");
  });

  it("mantiene un solo radio tabbabile e seleziona circolarmente la luce", async () => {
    await openSettings([
      choiceEntry("appearance.theme", "light", ["light", "dark"]),
      choiceEntry("appearance.contrast", "normal", ["normal", "high"]),
    ]);

    const groups = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"]')];
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
      expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);
      radios[0]!.focus();
      const left = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
      radios[0]!.dispatchEvent(left);
      expect(left.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(radios[1]);
      expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0]);
      expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true"]);
      radios[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      expect(document.activeElement).toBe(radios[0]);
      expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);
      expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);
      radios[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
      expect(document.activeElement).toBe(radios[1]);
      expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0]);
      expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    }

    await vi.waitFor(() => {
      const currentGroups = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"]')];
      expect(currentGroups).toHaveLength(2);
      for (const group of currentGroups) {
        const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
        expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
        expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(1);
      }
    });
  });
});
