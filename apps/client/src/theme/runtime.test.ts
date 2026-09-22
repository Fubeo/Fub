// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry, ThemeInfo, ThemeManifest, ThemePayload } from "../host/contract";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import sheetLight from "./serie/sheet-light.css?raw";
import skin from "./serie/skin.css?raw";
const thirdPartySheet = sheetLight.replace(
  "  color-scheme: light;",
  "  color-scheme: normal;",
);

const box = vi.hoisted(() => ({
  listThemes: vi.fn<() => Promise<ThemeInfo[]>>(),
  readTheme: vi.fn<(id: string, light: "light" | "dark") => Promise<ThemePayload>>(),
  setSetting: vi.fn<(key: string, value: string) => Promise<void>>(),
  settings: vi.fn<() => Promise<SettingEntry[]>>(),
  report: vi.fn(),
}));

vi.mock("../host/ipc", () => ({
  api: {
    listThemes: box.listThemes,
    readTheme: box.readTheme,
    setSetting: box.setSetting,
  },
}));
vi.mock("../host/query", () => ({ settings: box.settings }));
vi.mock("../state/kernel", () => ({ onEvent: vi.fn(() => () => {}) }));
vi.mock("../state/store", () => ({ on: vi.fn(() => () => {}) }));
vi.mock("../ui/notify", () => ({ reportThemeTrouble: box.report }));

const manifest: ThemeManifest = {
  id: "acme.paper",
  name: "Acme Paper",
  version: "1.0.0",
  engine: "theme-1",
  lights: ["light"],
  asset_namespace: "theme://acme.paper/",
  motion: ["opacity", "transform"],
};
const info: ThemeInfo = { manifest };
const payload: ThemePayload = {
  manifest,
  light: "light",
  sheet: thirdPartySheet,
  skin,
  assets: {},
};

function settingsRows(value = "light"): SettingEntry[] {
  return [
    {
      spec: {
        key: "appearance.theme",
        label: "Tema",
        description: "",
        group: "Aspetto",
        scope: "machine",
        kind: { kind: "choice", default: "", options: [] },
        program_writable: false,
      },
      value,
      source: "machine",
    },
  ];
}

let lifetime: Lifetime | undefined;
afterEach(() => lifetime?.close());

async function mountFromCache(id: string, light = "light" as const) {
  lifetime?.close();
  lifetime = openLifetime();
  vi.resetModules();
  localStorage.setItem("fub.appearance.theme", JSON.stringify({ id, light }));
  box.settings.mockResolvedValue(settingsRows(light));
  // Dynamic import is intentional: each case models a fresh webview module and
  // exercises cache loading rather than retaining the prior catalog singleton.
  const theme = await import("./theme");
  theme.mountTheme(lifetime, vi.fn());
  return theme;
}

beforeEach(() => {
  document.head.innerHTML = "";
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.contrast;
  localStorage.clear();
  vi.clearAllMocks();
  box.listThemes.mockResolvedValue([]);
  box.readTheme.mockRejectedValue(new Error("missing"));
  box.setSetting.mockResolvedValue();
  box.settings.mockResolvedValue(settingsRows());
});

describe("tema runtime installato", () => {
  it("carica il bundle valido e persiste id e luce", async () => {
    box.listThemes.mockResolvedValue([info]);
    box.readTheme.mockResolvedValue(payload);
    await mountFromCache(info.manifest.id);
    await vi.waitFor(() =>
      expect(document.querySelector('style[data-fub="foglio"]')?.textContent).toBe(thirdPartySheet),
    );
    expect(JSON.parse(localStorage.getItem("fub.appearance.theme")!)).toEqual({
      id: "acme.paper",
      light: "light",
    });
  });

  it("keeps a readable theme available when another bundle cannot be loaded", async () => {
    box.listThemes.mockResolvedValue([
      { manifest: { ...manifest, id: "acme.broken" } },
      info,
    ]);
    box.readTheme.mockImplementation(async (id) => {
      if (id === "acme.broken") throw new Error("unreadable bundle");
      return payload;
    });
    const theme = await mountFromCache(info.manifest.id);
    await vi.waitFor(() =>
      expect(document.querySelector('style[data-fub="foglio"]')?.textContent).toBe(thirdPartySheet),
    );
    expect((await theme.themeCatalog()).map((entry) => entry.manifest.id)).toEqual([manifest.id]);
  });

  it.each([
    ["absent", [], "missing"],
    ["load failure", [info], "missing"],
  ])("falls back atomically when the bundle is %s", async (_reason, themes, _detail) => {
    box.listThemes.mockResolvedValue(themes);
    await mountFromCache(info.manifest.id);
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem("fub.appearance.theme")!).id).toBe("fub.serie"),
    );
    expect(document.querySelector('style[data-fub="foglio"]')?.textContent).toBe(sheetLight);
    expect(JSON.parse(localStorage.getItem("fub.appearance.theme")!)).toEqual({
      id: "fub.serie",
      light: "light",
    });
  });

  it("falls back when the payload fails the shell loader", async () => {
    box.listThemes.mockResolvedValue([info]);
    box.readTheme.mockResolvedValue({ ...payload, sheet: "body { display: grid; }" });
    await mountFromCache(info.manifest.id);
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem("fub.appearance.theme")!).id).toBe("fub.serie"),
    );

    expect(document.querySelector('style[data-fub="foglio"]')?.textContent).not.toBe(
      "body { display: grid; }",
    );
  });

  it("does not reactivate a removed theme after a restart", async () => {
    box.listThemes.mockResolvedValue([info]);
    box.readTheme.mockResolvedValue(payload);
    await mountFromCache(info.manifest.id);
    await vi.waitFor(() =>
      expect(document.querySelector('style[data-fub="foglio"]')?.textContent).toBe(thirdPartySheet),
    );

    box.listThemes.mockResolvedValue([]);
    const theme = await mountFromCache(info.manifest.id);
    await vi.waitFor(() => expect(theme.currentThemeId()).toBe("fub.serie"));
    expect(JSON.parse(localStorage.getItem("fub.appearance.theme")!)).toEqual({
      id: "fub.serie",
      light: "light",
    });
  });
});
