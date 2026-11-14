// @vitest-environment happy-dom
//
// La pagina «Tutti i componenti» (PA T38): si apre da Aspetto solo con la
// modalità sviluppatore, sopra le impostazioni; mostra ogni componente
// dell'anatomia in ogni suo stato e, scelto un componente, i suoi hook; prova
// l'altra luce e il contrasto alto come un'anteprima, che chiudendo torna
// com'era; aperta e chiusa due volte non lascia niente nel documento.
//
// Le impostazioni e il catalogo dei temi sono quelli veri, serviti dall'host
// finto.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../host/contract";
import type { FakeHost } from "../../host/fake";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  notify: vi.fn(),
  clipboard: vi.fn(async (_text: string) => {}),
}));

vi.mock("../../host/ipc", () => ({
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
vi.mock("../../host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFile: () => Promise.resolve(null),
  pickFolder: () => Promise.resolve(null),
}));
vi.mock("../../state/kernel", () => ({ onEvent: vi.fn() }));
vi.mock("../../ui/commands", () => ({
  allCommands: () => [],
  keybindingKey: (id: string) => id,
  newKinds: () => ["note"],
  registerComponentRow: () => () => {},
  showComponent: () => false,
}));
vi.mock("../../ui/motion", () => ({
  enterSurface: () => {},
  exitSurface: (_element: HTMLElement, done: () => void) => done(),
}));
vi.mock("../../ui/tooltip", async (real) => ({ ...(await real<typeof import("../../ui/tooltip")>()), setTooltip: vi.fn() }));
vi.mock("../../ui/notify", () => ({ notify: box.notify, reportThemeTrouble: vi.fn() }));
vi.mock("../../platform/clipboard", () => ({ writeClipboardText: box.clipboard }));

const { createFakeHost, developerModeSetting } = await import("../../host/fake");
const { mountSettings } = await import("../../panels/settings");
const { currentThemePreview, reloadThemeCatalog } = await import("../../theme/theme");
const { COMPONENTS } = await import("../../theme/scrittoio/anatomia");
const { openedCatalogPage } = await import("./pagina");

function themeEntry(): SettingEntry {
  return {
    spec: {
      key: "appearance.theme",
      label: "Tema",
      description: "",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "",
        options: [
          { value: "", label: "Come il sistema" },
          { value: "light", label: "Chiaro" },
          { value: "dark", label: "Scuro" },
        ],
      },
      program_writable: false,
    },
    value: "light",
    source: "machine",
  };
}

let teardown: (() => void) | null = null;

async function openSettings(developer: boolean): Promise<void> {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  teardown?.();
  box.host = createFakeHost({ settings: [themeEntry(), developerModeSetting(developer)] });
  await reloadThemeCatalog();
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button></div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  teardown = mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-setting-key="developer.mode"]')).not.toBeNull());
}

const catalogButton = () => document.querySelector<HTMLButtonElement>('[data-dev-action="catalog"]');
const pages = () => document.querySelectorAll(".dev-catalog-window");
const page = () => document.querySelector<HTMLElement>(".dev-catalog-window");

async function openPage(): Promise<HTMLElement> {
  catalogButton()!.click();
  // L'avviso, se c'è, dice perché la pagina non è arrivata.
  await vi.waitFor(() => expect([page() !== null, box.notify.mock.calls]).toEqual([true, []]));
  return page()!;
}

function escape(): void {
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.dataset.theme = "light";
  document.documentElement.dataset.contrast = "normal";
});

// Ogni prova monta le impostazioni vere e centinaia di campioni: sotto carico
// supera i 5 s di serie, e il tempo non è ciò che si misura qui.
describe("la pagina «Tutti i componenti»", { timeout: 30_000 }, () => {
  it("il bottone c'è solo con la modalità sviluppatore accesa", async () => {
    await openSettings(false);
    expect(catalogButton()).toBeNull();

    await openSettings(true);
    expect(catalogButton()?.textContent).toBe("Tutti i componenti");
  });

  it("mostra ogni componente in ogni suo stato, e gli hook di quello scelto", async () => {
    await openSettings(true);
    const root = await openPage();

    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.querySelector(".dev-catalog-title")!.textContent).toBe("Tutti i componenti");
    const panel = root.querySelector<HTMLElement>('[data-panel="componenti"]')!;
    const items = [...panel.querySelectorAll<HTMLElement>(".dev-catalog-item")];
    // Ogni componente dell'anatomia, e dopo le viste dei componenti.
    expect(items.length).toBeGreaterThan(COMPONENTS.length);
    COMPONENTS.forEach((component, index) => {
      const item = items[index]!;
      expect(item.querySelector(".dev-catalog-pick")!.textContent).toBe(component.name);
      expect(item.querySelectorAll(".dev-catalog-state")).toHaveLength(component.states.length);
    });
    // Il primo è già scelto; un clic su un altro ne mostra il nome e gli hook.
    const info = root.querySelector<HTMLElement>(".dev-catalog-info")!;
    expect(items[0]!.getAttribute("aria-current")).toBe("true");
    const other = COMPONENTS.findIndex((component) => component.states.length >= 3 && component.hooks.length > 0);
    items[other]!.querySelector<HTMLButtonElement>(".dev-catalog-pick")!.click();
    expect(items[0]!.hasAttribute("aria-current")).toBe(false);
    expect(items[other]!.getAttribute("aria-current")).toBe("true");
    expect(info.querySelector(".dev-catalog-info-title")!.textContent).toBe(COMPONENTS[other]!.name);
    expect([...info.querySelectorAll(".dev-catalog-hooks code")].map((code) => code.textContent)).toEqual(
      COMPONENTS[other]!.hooks.map((hook) => `.${hook}`),
    );

    info.querySelector<HTMLButtonElement>(".settings-btn")!.click();
    await vi.waitFor(() => expect(box.clipboard).toHaveBeenCalledTimes(1));
    expect(box.clipboard).toHaveBeenCalledWith(COMPONENTS[other]!.hooks.map((hook) => `.${hook}`).join("\n"));

    openedCatalogPage()!.close();
  });

  it("le altre schede si disegnano quando si aprono", async () => {
    await openSettings(true);
    const root = await openPage();
    expect(root.querySelector('[data-panel="tavolozza"]')!.childElementCount).toBe(0);

    root.querySelector<HTMLButtonElement>("#dev-tab-tavolozza")!.click();
    expect(root.querySelectorAll('[data-panel="tavolozza"] .dev-swatch-chip[data-token]').length).toBe(12);
    root.querySelector<HTMLButtonElement>("#dev-tab-caratteri")!.click();
    expect(root.querySelectorAll('[data-panel="caratteri"] .dev-font[data-font]')).toHaveLength(3);
    root.querySelector<HTMLButtonElement>("#dev-tab-kit")!.click();
    expect(root.querySelector('[data-panel="kit"] .dev-catalog-kit .sezione')).not.toBeNull();

    openedCatalogPage()!.close();
  });

  it("l'altra luce e il contrasto alto sono un'anteprima, che chiudendo torna com'era", async () => {
    await openSettings(true);
    const root = await openPage();

    root.querySelector<HTMLButtonElement>('[data-light="dark"]')!.click();
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    const contrast = root.querySelector<HTMLInputElement>(".setting-switch")!;
    contrast.click();
    await vi.waitFor(() => expect(document.documentElement.dataset.contrast).toBe("high"));
    expect(currentThemePreview()).toMatchObject({ light: "dark", contrast: "high" });
    expect(box.host!.calls.filter((call) => call.gate === "setSetting")).toEqual([]);

    openedCatalogPage()!.close();
    await vi.waitFor(() => expect(currentThemePreview()).toBeNull());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.contrast).toBe("normal");
    // Le impostazioni restano aperte sotto.
    expect(document.querySelector("#settings-panel")!.hasAttribute("hidden")).toBe(false);
  });

  it("aperta e chiusa due volte non lascia niente, e ce n'è una sola", async () => {
    await openSettings(true);
    const before = document.body.innerHTML;
    const settingsBefore = document.querySelectorAll("[data-setting-key]").length;

    for (const closeBy of ["escape", "button"] as const) {
      await openPage();
      catalogButton()!.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(pages()).toHaveLength(1);

      if (closeBy === "escape") escape();
      else page()!.querySelector<HTMLButtonElement>(".dev-catalog-close")!.click();

      expect(pages()).toHaveLength(0);
      expect(openedCatalogPage()).toBeNull();
      // Escape chiude la pagina, non le impostazioni sotto.
      expect(document.querySelector("#settings-panel")!.hasAttribute("hidden")).toBe(false);
      expect(document.querySelectorAll("[data-setting-key]")).toHaveLength(settingsBefore);
    }
    // Niente gemelli forzati, niente fogli o nodi rimasti nel documento.
    expect(document.querySelectorAll("[data-force]")).toHaveLength(0);
    expect(document.body.innerHTML).toBe(before);
  });

  it("chiudere le impostazioni chiude anche la pagina", async () => {
    await openSettings(true);
    await openPage();
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    await vi.waitFor(() => expect(pages()).toHaveLength(0));
    expect(openedCatalogPage()).toBeNull();
  });
});
