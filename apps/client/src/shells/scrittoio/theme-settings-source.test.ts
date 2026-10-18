// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingKind, SettingValue } from "../../host/contract";
import type { ThemeOption } from "../../theme/options";
import type { ThemeOptions } from "../../theme/theme";

const host = vi.hoisted(() => ({
  setSetting: vi.fn<(key: string, value: unknown) => Promise<void>>(() => Promise.resolve()),
  resetSetting: vi.fn<(key: string) => Promise<void>>(() => Promise.resolve()),
}));
const theme = vi.hoisted(() => ({
  mounted: { themeId: "fub.serie", themeName: "Serie", options: [] } as unknown,
}));

vi.mock("../../host/ipc", () => ({ api: host }));
vi.mock("../../theme/theme", () => ({ currentThemeOptions: () => theme.mounted }));
vi.mock("../../i18n/strings", () => ({ t: (key: string) => key }));
// La schermata non serve qui: della giuntura si prova solo la dichiarazione.
vi.mock("./preferences/theme-settings", () => ({ setThemeSettingsSource: vi.fn(() => () => {}) }));

import { emit, state } from "../../state/store";
import { openLifetime } from "../../ui/lifetime";
import { setThemeSettingsSource } from "./preferences/theme-settings";
import { mountThemeSettingsSource, readThemeSettings, themeSettingsSource } from "./theme-settings-source";

const THEME = "com.acme.notte";

function option(name: string, kind: SettingKind, value: SettingValue, declared = true): ThemeOption {
  return {
    setting: { name, label: `Etichetta ${name}`, description: name === "bordi" ? "" : `Che cos'è ${name}`, kind },
    key: `${THEME}:${name}`,
    value,
    declared,
    chosen: false,
  };
}

function mount(options: ThemeOption[]): void {
  theme.mounted = { themeId: THEME, themeName: "Notte", options } satisfies ThemeOptions;
}

const BORDERS: SettingKind = { kind: "toggle", default: true };
const RADIUS: SettingKind = { kind: "number", default: 8, min: 0, max: 16 };
const VEIL: SettingKind = { kind: "number", default: 0.35, min: 0, max: 1 };
const GRAIN: SettingKind = {
  kind: "choice",
  default: "fine",
  options: [{ value: "fine", label: "Fine" }, { value: "grossa", label: "Grossa" }],
};

beforeEach(() => {
  host.setSetting.mockClear();
  host.resetSetting.mockClear();
  state.vaultRoot = "/vault";
  mount([]);
});

describe("la sorgente delle voci del tema", () => {
  it("rende le voci del tema montato con chiave, testi, specie e valore", () => {
    mount([option("bordi", BORDERS, false), option("raggio", RADIUS, 12), option("trama", GRAIN, "grossa")]);
    expect(readThemeSettings()).toEqual({
      themeId: THEME,
      themeName: "Notte",
      entries: [
        { spec: { key: `${THEME}:bordi`, label: "Etichetta bordi", kind: { kind: "toggle", default: true } }, value: false },
        {
          spec: {
            key: `${THEME}:raggio`,
            label: "Etichetta raggio",
            description: "Che cos'è raggio",
            kind: { kind: "number", default: 8, min: 0, max: 16, step: 1 },
          },
          value: 12,
        },
        {
          spec: {
            key: `${THEME}:trama`,
            label: "Etichetta trama",
            description: "Che cos'è trama",
            kind: GRAIN,
          },
          value: "grossa",
        },
      ],
    });
  });

  it("un intervallo che non è di interi si divide in cento passi", () => {
    mount([option("velo", VEIL, 0.35)]);
    const kind = readThemeSettings().entries[0]!.spec.kind;
    expect(kind).toMatchObject({ kind: "number", min: 0, max: 1 });
    expect(kind.kind === "number" ? kind.step : null).toBeCloseTo(0.01);
  });

  it("un numero senza i due estremi non è una voce", () => {
    mount([option("aperto", { kind: "number", default: 4, min: 0, max: null }, 4), option("bordi", BORDERS, true)]);
    expect(readThemeSettings().entries.map((entry) => entry.spec.key)).toEqual([`${THEME}:bordi`]);
  });

  it("un tema senza voci non ne rende, e non è bloccato", () => {
    expect(readThemeSettings()).toEqual({ themeId: THEME, themeName: "Notte", entries: [] });
  });

  it("senza un vault le voci si leggono ma sono bloccate, e dice perché", () => {
    state.vaultRoot = "";
    mount([option("bordi", BORDERS, true, false)]);
    const read = readThemeSettings();
    expect(read.entries).toHaveLength(1);
    expect(read.locked).toBe("prefs.theme.locked.no_vault");
  });

  it("con un vault aperto e il registro che non le conosce, dice quello", () => {
    mount([option("bordi", BORDERS, true, false)]);
    expect(readThemeSettings().locked).toBe("prefs.theme.locked.undeclared");
  });

  it("scrive e azzera con la chiave del registro", async () => {
    mount([option("raggio", RADIUS, 8)]);
    await themeSettingsSource.write(`${THEME}:raggio`, 12);
    await themeSettingsSource.reset(`${THEME}:raggio`);
    expect(host.setSetting).toHaveBeenCalledExactlyOnceWith(`${THEME}:raggio`, 12);
    expect(host.resetSetting).toHaveBeenCalledExactlyOnceWith(`${THEME}:raggio`);
  });

  it("il rifiuto dell'host arriva a chi ha scritto", async () => {
    mount([option("raggio", RADIUS, 8)]);
    host.setSetting.mockRejectedValueOnce(new Error("fuori intervallo"));
    await expect(themeSettingsSource.write(`${THEME}:raggio`, 40)).rejects.toThrow("fuori intervallo");
  });

  it("non scrive una voce che il registro non conosce, né una che non è del tema montato", async () => {
    mount([option("bordi", BORDERS, true, false)]);
    await expect(themeSettingsSource.write(`${THEME}:bordi`, false)).rejects.toThrow("prefs.theme.locked.gone");
    await expect(themeSettingsSource.reset(`${THEME}:bordi`)).rejects.toThrow("prefs.theme.locked.gone");
    await expect(themeSettingsSource.write("appearance.theme-id", "x")).rejects.toThrow("prefs.theme.locked.gone");
    expect(host.setSetting).not.toHaveBeenCalled();
    expect(host.resetSetting).not.toHaveBeenCalled();
  });

  it("avvisa quando il tema montato cambia, finché non si ritira", () => {
    const listener = vi.fn();
    const stop = themeSettingsSource.subscribe(listener);
    emit("theme");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    emit("theme");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("si dichiara alla schermata e si ritira con la shell", () => {
    const withdraw = vi.fn();
    vi.mocked(setThemeSettingsSource).mockReturnValueOnce(withdraw);
    const lifetime = openLifetime();
    mountThemeSettingsSource(lifetime);
    expect(setThemeSettingsSource).toHaveBeenCalledWith(themeSettingsSource);
    expect(withdraw).not.toHaveBeenCalled();
    lifetime.close();
    expect(withdraw).toHaveBeenCalledTimes(1);
  });
});
