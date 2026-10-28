// @vitest-environment happy-dom
//
// Il cancello della serie Scrittoio: i suoi quattro fogli e la sua pelle
// passano dalla stessa porta di un tema di terzi, col profilo `theme-2`. È
// anche la prova che il vocabolario largo viene dal profilo: senza, la stessa
// pelle cade sul vocabolario comune dei frammenti CSS.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { THEME_ENGINE } from "../../host/contract";
import { count, mountPreferences, mountThemeBundle, themeProfile, validateThemeBundle } from "../loader";
import { declareThemeSeries, preferenceTokens, themeSeries, type ThemeSeries } from "../theme";
import { THEME_2_ENGINE, THEME_2_PREFERENCE_TOKENS, THEME_2_PROFILE } from "./profile";
import { SCRITTOIO_SERIES } from "./series";

const VARIANTS = [
  ["light", "normal"],
  ["light", "high"],
  ["dark", "normal"],
  ["dark", "high"],
] as const;

let restore: () => void = () => {};

beforeEach(() => {
  document.head.innerHTML = "";
  restore = declareThemeSeries(SCRITTOIO_SERIES);
});

afterEach(() => restore());

describe("la serie Scrittoio passa dal cancello", () => {
  it("in tutte e quattro le varianti, senza un motivo", () => {
    for (const [light, contrast] of VARIANTS) {
      const reasons = validateThemeBundle(
        { manifest: SCRITTOIO_SERIES.manifest, sheet: SCRITTOIO_SERIES.sheet(light, contrast), skin: SCRITTOIO_SERIES.skin, assets: {} },
        light,
      );
      expect(reasons, `${light} ${contrast}`).toEqual([]);
    }
  });

  it("monta foglio e pelle in una sola commit", () => {
    const sheet = SCRITTOIO_SERIES.sheet("light", "normal");
    const result = mountThemeBundle({ manifest: SCRITTOIO_SERIES.manifest, sheet, skin: SCRITTOIO_SERIES.skin, assets: {} }, "light");
    expect(result.mounted).toBe(true);
    expect(count("foglio")).toBe(1);
    expect(count("pelle")).toBe(1);
    expect(document.head.querySelector('style[data-fub="pelle"]')?.textContent).toBe(SCRITTOIO_SERIES.skin);
  });

  it("è la serie di partenza; un'altra porta il suo profilo, e ritirarla lo ritira", () => {
    restore();
    expect(themeSeries()).toBe(SCRITTOIO_SERIES);
    expect(themeProfile().engine).toBe(THEME_2_ENGINE);
    const other: ThemeSeries = { ...SCRITTOIO_SERIES, profile: { ...THEME_2_PROFILE, engine: "banco-1" } };
    const back = declareThemeSeries(other);
    expect(themeSeries()).toBe(other);
    expect(themeProfile().engine).toBe("banco-1");
    back();
    expect(themeSeries()).toBe(SCRITTOIO_SERIES);
    expect(themeProfile().engine).toBe(THEME_2_ENGINE);
    restore = declareThemeSeries(SCRITTOIO_SERIES);
  });

  it("un tema theme-1 non si monta su questa shell, e lo dice", () => {
    // Un tema scritto per la shell di prima dichiara `theme-1`: i suoi hook
    // non vestono questa anatomia, e il cancello lo rifiuta nominando il
    // motore che servirebbe.
    const reasons = validateThemeBundle(
      {
        manifest: { ...SCRITTOIO_SERIES.manifest, id: "terzi.vecchio", engine: THEME_ENGINE },
        sheet: SCRITTOIO_SERIES.sheet("light", "normal"),
        skin: "",
        assets: {},
      },
      "light",
    );
    expect(reasons.some((reason) => reason.includes("engine") && reason.includes(THEME_2_ENGINE))).toBe(true);
  });

  it("un tema senza i ruoli facoltativi passa; se li dichiara, le loro coppie contano", () => {
    // Un tema `theme-2` scritto prima dei segni sulle due carte non dichiara
    // `--doc-find` né `--paper-*`, e deve restare valido.
    const bundle = (sheet: string) => ({ manifest: SCRITTOIO_SERIES.manifest, sheet, skin: SCRITTOIO_SERIES.skin, assets: {} });
    const full = SCRITTOIO_SERIES.sheet("light", "normal");
    const without = full.replace(/^\s*--(paper-[a-z0-9-]+|doc-(ins|del|proof-spell|proof-gram|find|find-now|comment|author-[1-6])):[^;]*;\n/gm, "");
    expect(without).not.toContain("--paper-");
    expect(without).not.toContain("--doc-find");
    expect(without).not.toContain("--doc-author-");
    expect(validateThemeBundle(bundle(without), "light")).toEqual([]);
    const faint = full.replace(/--paper-link:[^;]*;/, "--paper-link: #c8d4f0;");
    expect(validateThemeBundle(bundle(faint), "light")).toEqual([
      expect.stringContaining("--paper-link su --paper-bg"),
    ]);
  });

  it("la pelle Scrittoio non passa dal vocabolario comune", () => {
    const back = declareThemeSeries({ ...SCRITTOIO_SERIES, profile: { ...THEME_2_PROFILE, vocabulary: undefined } });
    const reasons = validateThemeBundle(
      { manifest: SCRITTOIO_SERIES.manifest, sheet: SCRITTOIO_SERIES.sheet("light", "normal"), skin: SCRITTOIO_SERIES.skin, assets: {} },
      "light",
    );
    back();
    expect(reasons.length).toBeGreaterThan(0);
  });
});

describe("il canale delle preferenze", () => {
  it("scrive solo token che il profilo ammette, a ogni passo e in ogni variante", () => {
    const allowed = new Set(THEME_2_PREFERENCE_TOKENS);
    for (const [light, contrast] of VARIANTS) {
      for (const compactness of [0, 1, 2, 3, 4]) {
        for (const density of ["compact", "comfortable", "relaxed"] as const) {
          const tokens = preferenceTokens({ ...SCRITTOIO_SERIES.defaults, compactness, density, accent: 30 }, light, contrast);
          for (const token of Object.keys(tokens)) expect(allowed.has(token), token).toBe(true);
        }
      }
    }
  });

  it("monta ciò che le preferenze dichiarano", () => {
    const tokens = preferenceTokens({ ...SCRITTOIO_SERIES.defaults, compactness: 4 }, "light", "normal");
    mountPreferences(tokens);
    const text = document.head.querySelector('style[data-fub="preferenze"]')?.textContent ?? "";
    expect(text).toContain("--rail-w: 28px");
    expect(text).toContain("--titlebar-h: 28px");
    expect(text).not.toContain("--tab-h");
  });
});
