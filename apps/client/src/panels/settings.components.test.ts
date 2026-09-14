// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "../host/fake";
import type { BundleInfo, InstalledPluginInfo, SettingEntry } from "../host/contract";
import { state } from "../state/store";
import { permissionKey } from "../ui/permissions";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  confirm: true,
  file: null as string | null,
  entries: [] as SettingEntry[],
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
        return method(...args);
      },
    },
  ),
}));
vi.mock("../host/dialog", () => ({
  confirm: () => Promise.resolve(box.confirm),
  pickFile: () => Promise.resolve(box.file),
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

beforeEach(() => {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  vi.clearAllMocks();
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
