// Luce, contrasto e preferenze personali: una risoluzione, un foglio montato.
import { settings } from "../host/query";
import { onEvent } from "../state/kernel";
import { on } from "../state/store";
import type { Lifetime } from "../ui/lifetime";
import sheetDarkHigh from "./serie/sheet-dark-high.css?raw";
import sheetDark from "./serie/sheet-dark.css?raw";
import sheetLightHigh from "./serie/sheet-light-high.css?raw";
import sheetLight from "./serie/sheet-light.css?raw";
import skin from "./serie/skin.css?raw";
import fonts from "./serie/fonts.css?raw";
import {
  mount,
  mountPreferences,
  mountThemeBundle,
  THEME_MOTION,
  type ThemeBundleManifest,
} from "./loader";
import { accentPalette, type ContrastLevel } from "./serie/recipe";

export type Theme = "light" | "dark";
export type Density = "compact" | "comfortable" | "relaxed";
export type ReadingFont = "literata" | "inter" | "system";

// Gemelle delle chiavi dichiarate in fub-host/src/settings.rs.
export const THEME_KEY = "appearance.theme";
export const CONTRAST_KEY = "appearance.contrast";
export const DENSITY_KEY = "appearance.density";
export const BODY_KEY = "appearance.body";
export const LINE_HEIGHT_KEY = "appearance.line-height";
export const MEASURE_KEY = "appearance.measure";
export const FONT_KEY = "appearance.font";
export const ACCENT_KEY = "appearance.accent";
export const ZOOM_KEY = "appearance.zoom";

const THEME_CACHE = "fub.appearance.theme";
const PREFERENCES_CACHE = "fub.appearance.preferences";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const CONTRAST_QUERY = "(prefers-contrast: more)";

const SERIES_MANIFEST: ThemeBundleManifest = {
  id: "fub.serie",
  name: "Fub di serie",
  version: "1.0.0",
  engine: "theme-1",
  lights: ["dark", "light"],
  asset_namespace: "theme://fub.serie/",
  motion: THEME_MOTION,
};

export interface AppearancePreferences {
  density: Density;
  body: number;
  lineHeight: number;
  measure: number;
  font: ReadingFont;
  accent: number;
}

const DEFAULT_PREFERENCES: AppearancePreferences = {
  density: "comfortable",
  body: 16,
  lineHeight: 1.7,
  measure: 70,
  font: "literata",
  accent: 130,
};

const DENSITY_SPACES: Readonly<Record<Density, readonly number[]>> = {
  compact: [2, 4, 4, 6, 8, 10, 12, 18, 24, 36],
  comfortable: [2, 4, 6, 8, 10, 12, 16, 24, 32, 48],
  relaxed: [2, 4, 8, 10, 12, 16, 20, 28, 36, 52],
};

const READING_FONTS: Readonly<Record<ReadingFont, string>> = {
  literata: '"Literata Variable", Georgia, "Times New Roman", serif',
  inter: '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

let themeChoice = "";
let contrastChoice = "";
let preferences: AppearancePreferences = { ...DEFAULT_PREFERENCES };
let mountedVariant = "";
let mountedPreferenceText = "";
let mountedLight: Theme | null = null;
let warn: (theme: Theme) => void = () => {};

export function effectiveTheme(choice: unknown, systemDark: boolean): Theme {
  if (choice === "light" || choice === "dark") return choice;
  return systemDark ? "dark" : "light";
}

export function effectiveContrast(choice: unknown, systemHigh: boolean): ContrastLevel {
  if (choice === "normal" || choice === "high") return choice;
  return systemHigh ? "high" : "normal";
}

function mediaMatches(query: string, fallback: boolean): boolean {
  return window.matchMedia?.(query).matches ?? fallback;
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function currentContrast(): ContrastLevel {
  return document.documentElement.dataset.contrast === "high" ? "high" : "normal";
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function normalizedPreferences(raw: Partial<AppearancePreferences>): AppearancePreferences {
  return {
    density:
      raw.density === "compact" || raw.density === "relaxed"
        ? raw.density
        : "comfortable",
    body: bounded(raw.body, DEFAULT_PREFERENCES.body, 12, 28),
    lineHeight: bounded(raw.lineHeight, DEFAULT_PREFERENCES.lineHeight, 1.2, 2.4),
    measure: bounded(raw.measure, DEFAULT_PREFERENCES.measure, 40, 100),
    font: raw.font === "inter" || raw.font === "system" ? raw.font : "literata",
    accent: bounded(raw.accent, DEFAULT_PREFERENCES.accent, 0, 360),
  };
}

/** Traduce le preferenze in soli token ammessi dal canale del loader. */
export function preferenceTokens(
  value: AppearancePreferences,
  light: Theme,
  contrast: ContrastLevel,
): Record<string, string> {
  const safe = normalizedPreferences(value);
  const tokens: Record<string, string> = {};
  DENSITY_SPACES[safe.density].forEach((space, index) => {
    tokens[`space-${index + 1}`] = `${space}px`;
  });
  tokens["font-reading"] = READING_FONTS[safe.font];
  tokens["text-reading"] = `${safe.body}px`;
  tokens["leading-relaxed"] = String(safe.lineHeight);
  tokens["content-width"] = `${safe.measure}ch`;
  Object.assign(tokens, accentPalette(light, contrast, safe.accent));
  return tokens;
}

function sheetFor(light: Theme, contrast: ContrastLevel): string {
  if (light === "dark") return contrast === "high" ? sheetDarkHigh : sheetDark;
  return contrast === "high" ? sheetLightHigh : sheetLight;
}

function apply(): void {
  const light = effectiveTheme(themeChoice, mediaMatches(DARK_QUERY, true));
  const contrast = effectiveContrast(contrastChoice, mediaMatches(CONTRAST_QUERY, false));
  const variant = `${light}:${contrast}`;
  if (variant !== mountedVariant) {
    const result = mountThemeBundle(
      { manifest: SERIES_MANIFEST, sheet: sheetFor(light, contrast), skin, assets: {} },
      light,
    );
    if (!result.mounted) return;
    mountedVariant = variant;
    document.documentElement.dataset.theme = light;
    document.documentElement.dataset.contrast = contrast;
  }

  const tokens = preferenceTokens(preferences, light, contrast);
  const serialized = JSON.stringify(tokens);
  if (serialized !== mountedPreferenceText) {
    mountPreferences(tokens);
    mountedPreferenceText = serialized;
  }

  if (light !== mountedLight) {
    mountedLight = light;
    warn(light);
  }
}

function valueOf(entries: Awaited<ReturnType<typeof settings>>, key: string): unknown {
  return entries.find((entry) => entry.spec.key === key)?.value;
}

async function reread(): Promise<void> {
  try {
    const entries = await settings();
    const theme = valueOf(entries, THEME_KEY);
    const contrast = valueOf(entries, CONTRAST_KEY);
       themeChoice = typeof theme === "string" ? theme : "";
    // Lime non è più un fascio: chi lo aveva scelto resta sul buio che aveva.
    // La migrazione vale prima di persistere, così la cache non riscrive un
    // valore che `effectiveTheme` non conosce.
    if (themeChoice === "lime") themeChoice = "dark";
    contrastChoice = typeof contrast === "string" ? contrast : "";
    preferences = normalizedPreferences({
      density: valueOf(entries, DENSITY_KEY) as Density,
      body: valueOf(entries, BODY_KEY) as number,
      lineHeight: valueOf(entries, LINE_HEIGHT_KEY) as number,
      measure: valueOf(entries, MEASURE_KEY) as number,
      font: valueOf(entries, FONT_KEY) as ReadingFont,
      accent: valueOf(entries, ACCENT_KEY) as number,
    });
    try {
      localStorage.setItem(THEME_CACHE, themeChoice);
      localStorage.setItem(
        PREFERENCES_CACHE,
        JSON.stringify({ contrast: contrastChoice, preferences }),
      );
    } catch {
      // Il valore vivo è già in memoria; la cache serve solo al primo fotogramma.
    }
    apply();
  } catch {
    // Se il canale dati non risponde resta valida l'ultima cache leggibile.
  }
}

function loadCache(): void {
  themeChoice = "";
  contrastChoice = "";
  preferences = { ...DEFAULT_PREFERENCES };
  try {
    themeChoice = localStorage.getItem(THEME_CACHE) ?? "";
        // Lime non è più un fascio: chi lo aveva scelto resta sul buio che aveva,
    // e la cache si riscrive subito, perché al prossimo avvio la migrazione
    // deve essere già avvenuta (e non di nuovo).
    if (themeChoice === "lime") {
      themeChoice = "dark";
      localStorage.setItem(THEME_CACHE, "dark");
    }
    const cached = localStorage.getItem(PREFERENCES_CACHE);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        contrast?: unknown;
        preferences?: Partial<AppearancePreferences>;
      };
      contrastChoice = typeof parsed.contrast === "string" ? parsed.contrast : "";
      preferences = normalizedPreferences(parsed.preferences ?? {});
    }
  } catch {
    themeChoice = "";
    contrastChoice = "";
    preferences = { ...DEFAULT_PREFERENCES };
  }
}

export function mountTheme(lifetime: Lifetime, onChange: (theme: Theme) => void): void {
  loadCache();
  mountedVariant = "";
  mountedPreferenceText = "";
  mountedLight = null;
  mount(fonts, "caratteri");
  apply();
  warn = onChange;

  for (const query of [DARK_QUERY, CONTRAST_QUERY]) {
    const media = window.matchMedia?.(query);
    if (media) lifetime.listen(media, "change", apply);
  }
  onEvent("setting_changed", () => void reread());
  on("vault", () => void reread());
  void reread();
}
