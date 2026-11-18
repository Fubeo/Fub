// @vitest-environment happy-dom
//
// La pagina «Tutti i componenti» (PA T38): si apre da Aspetto solo con la
// modalità sviluppatore, sopra le impostazioni; mostra ogni componente
// dell'anatomia in ogni suo stato e, scelto un componente, i suoi hook; prova
// l'altra luce e il contrasto alto come un'anteprima, che chiudendo torna
// com'era; aperta e chiusa due volte non lascia niente nel documento, e il
// fuoco torna al bottone. Un tema rifiutato a pagina aperta mette la diagnosi
// in testa; una pagina che arriva tardi non si apre su un pannello che non è
// più quello del clic; una costruzione che si ferma non lascia gemelli nei
// fogli; la lingua cambia anche la pagina.
//
// Le impostazioni e il catalogo dei temi sono quelli veri, serviti dall'host
// finto.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../host/contract";
import type { FakeHost } from "../../host/fake";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  /// Porte dell'host rifatte da una prova: un tema rifiutato installato dopo.
  overrides: {} as Record<string, (...args: unknown[]) => unknown>,
  /// Finché c'è, la pagina arriva solo quando la promessa si risolve.
  slow: null as Promise<void> | null,
  /// Il renderer dei `UiNode` si ferma: la costruzione della pagina lancia.
  failMount: false,
  /// Gli ascoltatori del kernel, per tipo: la lingua passa da `setting_changed`.
  events: new Map<string, Array<(event: unknown) => void>>(),
  notify: vi.fn(),
  clipboard: vi.fn(async (_text: string) => {}),
}));

vi.mock("../../host/ipc", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) => {
        const override = box.overrides[name];
        if (override) return override(...args);
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
vi.mock("../../state/kernel", () => ({
  onEvent: (type: string, handler: (event: unknown) => void) => {
    const list = box.events.get(type) ?? [];
    list.push(handler);
    box.events.set(type, list);
    return () => {
      const at = list.indexOf(handler);
      if (at >= 0) list.splice(at, 1);
    };
  },
}));
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
vi.mock("../../ui/node", async (real) => {
  const node = await real<typeof import("../../ui/node")>();
  return {
    ...node,
    mountTree: (...args: Parameters<typeof node.mountTree>) => {
      if (box.failMount) throw new Error("il renderer si è fermato");
      return node.mountTree(...args);
    },
  };
});
vi.mock("./carica", async (real) => {
  const loader = await real<typeof import("./carica")>();
  return {
    loadCatalogPage: () => (box.slow ? box.slow.then(() => loader.loadCatalogPage()) : loader.loadCatalogPage()),
  };
});

const { createFakeHost, developerModeSetting, rejectedTheme } = await import("../../host/fake");
const { mountSettings } = await import("../../panels/settings");
const { currentThemePreview, reloadThemeCatalog } = await import("../../theme/theme");
const { COMPONENTS } = await import("../../theme/scrittoio/anatomia");
const { mountStrings } = await import("../../i18n/strings");
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

function languageEntry(value: string): SettingEntry {
  return {
    spec: {
      key: "locale.language",
      label: "Lingua",
      description: "",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "text", default: "" },
      program_writable: false,
    },
    value,
    source: "machine",
  };
}

let teardown: (() => void) | null = null;

async function openSettings(developer: boolean, extra: SettingEntry[] = []): Promise<void> {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  teardown?.();
  box.overrides = {};
  box.host = createFakeHost({ settings: [themeEntry(), developerModeSetting(developer), ...extra] });
  await reloadThemeCatalog();
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button><button data-tab="about"></button></div>
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

/// Una promessa che la prova risolve quando vuole.
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/// Lascia finire le catene di promesse già risolte (il caricamento, il `then`).
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/// Una regola con `:hover` in un foglio della finestra: la pagina la gemella.
/// happy-dom non sa riscrivere `selectorText`, quindi il foglio è finto: una
/// regola vera di forma (`instanceof CSSStyleRule`) con un selettore che si
/// scrive, in un foglio che sta nel documento. Il gemellaggio vero lo provano i
/// provini del banco nel browser.
function hoverRule(): CSSStyleRule {
  const sheet = { ownerNode: document.head } as unknown as CSSStyleSheet;
  const rule = Object.create(CSSStyleRule.prototype, {
    selectorText: { value: ".prova-forza:hover", writable: true },
    cssRules: { value: undefined },
    parentStyleSheet: { value: sheet },
  }) as CSSStyleRule;
  Object.defineProperty(sheet, "cssRules", { value: [rule] });
  vi.spyOn(document, "styleSheets", "get").mockReturnValue([sheet] as unknown as StyleSheetList);
  return rule;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  box.slow = null;
  box.failMount = false;
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
    expect(root.getAttribute("aria-labelledby")).toBe("dev-catalog-title");
    // Il nome è del dialogo soltanto: la sezione dentro non lo ripete.
    expect(root.querySelector(".dev-catalog")!.hasAttribute("aria-labelledby")).toBe(false);
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

  it("le altre schede si disegnano quando si aprono, e il kit ha anche popover, dialogo e scheda", async () => {
    await openSettings(true);
    const root = await openPage();
    expect(root.querySelector('[data-panel="tavolozza"]')!.childElementCount).toBe(0);

    root.querySelector<HTMLButtonElement>("#dev-tab-tavolozza")!.click();
    expect(root.querySelectorAll('[data-panel="tavolozza"] .dev-swatch-chip[data-token]').length).toBe(12);
    root.querySelector<HTMLButtonElement>("#dev-tab-caratteri")!.click();
    expect(root.querySelectorAll('[data-panel="caratteri"] .dev-font[data-font]')).toHaveLength(3);
    root.querySelector<HTMLButtonElement>("#dev-tab-kit")!.click();
    expect(root.querySelector('[data-panel="kit"] .dev-catalog-kit .sezione')).not.toBeNull();
    for (const id of ["sample-menu", "sample-panel", "sample-dialog", "sample-card"]) {
      expect(root.querySelector(`#${id}`), id).not.toBeNull();
    }
    // Un popover aperto da qui va sul piano delle modali, sopra la pagina.
    root.querySelector<HTMLButtonElement>("#sample-menu")!.click();
    await vi.waitFor(() => expect(document.querySelector("body > .kit-popover")).not.toBeNull());
    expect(document.querySelector<HTMLElement>("body > .kit-popover")!.dataset.layer).toBe("modal");

    openedCatalogPage()!.close();
    // I popover se ne vanno con la pagina.
    expect(document.querySelector("body > .kit-popover")).toBeNull();
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

  it("due clic prima che la pagina arrivi aprono una pagina sola", async () => {
    await openSettings(true);
    const late = gate();
    box.slow = late.promise;
    // La pagina copre il bottone: il solo modo di chiederla due volte è un
    // doppio clic mentre il suo codice sta ancora arrivando.
    catalogButton()!.click();
    catalogButton()!.click();
    late.open();
    await vi.waitFor(() => expect(pages()).toHaveLength(1));
    await settle();
    expect(pages()).toHaveLength(1);
    openedCatalogPage()!.close();
  });

  it("aperta e chiusa due volte non lascia niente, e il fuoco torna al bottone", async () => {
    await openSettings(true);
    const rule = hoverRule();
    const selector = rule.selectorText;
    const before = document.body.innerHTML;
    const settingsBefore = document.querySelectorAll("[data-setting-key]").length;

    for (const closeBy of ["escape", "button"] as const) {
      const button = catalogButton()!;
      button.focus();
      await openPage();
      // Aperta, la regola ha il suo gemello forzato.
      expect(rule.selectorText).toContain('[data-force~="hover"]');
      expect(document.activeElement).not.toBe(button);

      if (closeBy === "escape") escape();
      else page()!.querySelector<HTMLButtonElement>(".dev-catalog-close")!.click();

      expect(pages()).toHaveLength(0);
      expect(openedCatalogPage()).toBeNull();
      expect(document.activeElement, closeBy).toBe(button);
      expect(rule.selectorText).toBe(selector);
      // Escape chiude la pagina, non le impostazioni sotto.
      expect(document.querySelector("#settings-panel")!.hasAttribute("hidden")).toBe(false);
      expect(document.querySelectorAll("[data-setting-key]")).toHaveLength(settingsBefore);
    }
    // Niente gemelli forzati, niente fogli o nodi rimasti nel documento.
    expect(document.querySelectorAll("[data-force]")).toHaveLength(0);
    expect(document.body.innerHTML).toBe(before);
  });

  it("una costruzione che si ferma non lascia gemelli nei fogli né pezzi di pagina", async () => {
    await openSettings(true);
    const rule = hoverRule();
    const selector = rule.selectorText;
    box.failMount = true;

    catalogButton()!.click();
    await vi.waitFor(() => expect(box.notify).toHaveBeenCalledTimes(1));
    expect(box.notify.mock.calls[0]![0]).toMatch(/^«Tutti i componenti» non è riuscito: /);
    expect(box.notify.mock.calls[0]![1]).toBe("guasto");
    expect(pages()).toHaveLength(0);
    expect(openedCatalogPage()).toBeNull();
    expect(rule.selectorText).toBe(selector);
    expect(document.querySelectorAll("[data-force]")).toHaveLength(0);

    // Il guasto non resta: al clic dopo, la pagina si apre.
    box.failMount = false;
    box.notify.mockClear();
    await openPage();
    openedCatalogPage()!.close();
  });

  it("una pagina che arriva dopo un cambio di scheda non si apre", async () => {
    await openSettings(true);
    const late = gate();
    box.slow = late.promise;
    const clicked = catalogButton()!;
    clicked.click();
    // Un'altra scheda e di nuovo Aspetto: il bottone del clic non c'è più.
    document.querySelector<HTMLButtonElement>('#settings-tabs [data-tab="about"]')!.click();
    document.querySelector<HTMLButtonElement>('#settings-tabs [data-tab="settings"]')!.click();
    await vi.waitFor(() => expect([clicked.isConnected, catalogButton() !== null]).toEqual([false, true]));
    late.open();
    await settle();
    expect(pages()).toHaveLength(0);
    expect(box.notify).not.toHaveBeenCalled();
  });

  it("una pagina che arriva a Impostazioni chiuse e riaperte non si apre", async () => {
    await openSettings(true);
    const late = gate();
    box.slow = late.promise;
    catalogButton()!.click();
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    document.querySelector<HTMLButtonElement>("#open-settings")!.click();
    await vi.waitFor(() => expect(catalogButton()).not.toBeNull());
    late.open();
    await settle();
    expect(pages()).toHaveLength(0);
  });

  it("un tema rifiutato a pagina aperta: la pagina resta, con la diagnosi in testa", async () => {
    await openSettings(true);
    const root = await openPage();
    expect(root.querySelector(".dev-catalog-diagnoses")!.childElementCount).toBe(0);

    // Un tema installato mentre la pagina è aperta, che il loader rifiuta.
    const rotto = rejectedTheme();
    box.overrides = {
      listThemes: () => Promise.resolve([rotto.info]),
      readTheme: (id, light) => Promise.resolve(rotto.payloads[`${String(id)}:${String(light)}`]),
    };
    await reloadThemeCatalog();

    await vi.waitFor(() => expect(root.querySelector(".dev-catalog-diagnoses .tema-diagnosi")).not.toBeNull());
    expect(root.querySelector(".dev-catalog-diagnoses")!.textContent).toContain("«Rotto» è rifiutato");
    // In testa: prima delle schede.
    const children = [...root.querySelector(".dev-catalog")!.children];
    expect(children.indexOf(root.querySelector(".dev-catalog-diagnoses")!)).toBeLessThan(
      children.indexOf(root.querySelector(".dev-catalog-tabs")!),
    );
    expect(pages()).toHaveLength(1);

    openedCatalogPage()!.close();
    box.overrides = {};
    await reloadThemeCatalog();
  });

  it("chiudere le impostazioni chiude anche la pagina", async () => {
    await openSettings(true);
    await openPage();
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    await vi.waitFor(() => expect(pages()).toHaveLength(0));
    expect(openedCatalogPage()).toBeNull();
  });

  // Ultima: la lingua scelta resta nel modulo delle stringhe.
  it("cambiata la lingua, la pagina si riscrive in inglese", async () => {
    await openSettings(true, [languageEntry("it")]);
    const stopStrings = mountStrings(() => {});
    try {
      const root = await openPage();
      expect(root.querySelector(".dev-catalog-title")!.textContent).toBe("Tutti i componenti");

      await box.host!.module.api.setSetting("locale.language", "en");
      const changed = { type: "setting_changed", key: "locale.language" };
      for (const handler of [...(box.events.get("setting_changed") ?? [])]) handler(changed);

      await vi.waitFor(() => expect(root.querySelector(".dev-catalog-title")!.textContent).toBe("All components"));
      expect(root.querySelector("#dev-tab-componenti")!.textContent).toBe("Components");
      expect(root.querySelector(".dev-catalog-switch span")!.textContent).toBe("High contrast");
      expect(root.querySelector(".dev-catalog-close")!.getAttribute("aria-label")).toBe("Close “All components”");
      expect(root.querySelector(".dev-catalog-info .settings-btn")!.textContent).toBe("Copy the hooks");
      // Le schede già disegnate si rifanno con le parole nuove.
      const captions = [...root.querySelectorAll('[data-panel="componenti"] figcaption')].map((c) => c.textContent);
      expect(captions).toContain("rest");
      expect(captions).not.toContain("riposo");
      expect(root.querySelector(".dev-catalog-info .muted")!.textContent).toMatch(/^Part /);
      expect(pages()).toHaveLength(1);
      openedCatalogPage()!.close();
    } finally {
      stopStrings();
      localStorage.clear();
    }
  });
});
