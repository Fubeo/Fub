// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  setSetting: vi.fn(async () => {}),
}));

vi.mock("../host/ipc", () => ({
  api: {
    setSetting: host.setSetting,
  },
}));

const {
  SERIES_THEME_ID,
  THEME_KEY,
  cancelThemePreview,
  currentThemeId,
  currentThemePreview,
  previewTheme,
  selectTheme,
} = await import("./theme");

function systemLight(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(prefers-contrast: more)" ? false : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
}

beforeEach(async () => {
  host.setSetting.mockClear();
  document.head.innerHTML = "";
  document.documentElement.dataset.theme = "light";
  document.documentElement.dataset.contrast = "normal";
  localStorage.clear();
  systemLight();
  await cancelThemePreview();
  await selectTheme(SERIES_THEME_ID, "light");
  host.setSetting.mockClear();
});

describe("anteprima tema effimera", () => {
  it("monta senza persistere e annulla tornando alla selezione autorevole", async () => {
    expect(currentThemeId()).toBe(SERIES_THEME_ID);

    await previewTheme(SERIES_THEME_ID, "dark");

    expect(currentThemePreview()).toEqual({ id: SERIES_THEME_ID, light: "dark" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(host.setSetting).not.toHaveBeenCalled();

    await cancelThemePreview();

    expect(currentThemePreview()).toBeNull();
    expect(currentThemeId()).toBe(SERIES_THEME_ID);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(host.setSetting).not.toHaveBeenCalled();
  });

  it("persiste soltanto quando la preview viene applicata esplicitamente", async () => {
    await previewTheme(SERIES_THEME_ID, "dark");
    expect(host.setSetting).not.toHaveBeenCalled();

    await selectTheme(SERIES_THEME_ID, "dark");

    expect(currentThemePreview()).toBeNull();
    expect(currentThemeId()).toBe(SERIES_THEME_ID);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(host.setSetting).toHaveBeenCalledTimes(1);
    expect(host.setSetting).toHaveBeenCalledWith(THEME_KEY, "dark");
  });
});
