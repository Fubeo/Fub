// Luce, contrasto e preferenze personali: una risoluzione, un foglio montato.
import { api } from "../host/ipc";
import type { SettingEntry, ThemeInfo, ThemePayload } from "../host/contract";
import { settings } from "../host/query";
import { onEvent } from "../state/kernel";
import { on } from "../state/store";
import type { Lifetime } from "../ui/lifetime";
import { reportThemeTrouble } from "../ui/notify";
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
  type ThemeMountResult,
  validateThemeBundle,
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
export const SERIES_THEME_ID = "fub.serie";
const PREFERENCES_CACHE = "fub.appearance.preferences";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const CONTRAST_QUERY = "(prefers-contrast: more)";
const SERIES_MANIFEST: ThemeBundleManifest = {
  id: SERIES_THEME_ID,
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
let themeChoice: Theme | "" = "";
let contrastChoice = "";
let preferences: AppearancePreferences = { ...DEFAULT_PREFERENCES };
let selectedThemeId = SERIES_MANIFEST.id;
let installedThemes: ThemeInfo[] = [];
let catalogLoaded = false;
let catalogRequest: Promise<ThemeInfo[]> | null = null;
let catalogEpoch = 0;
let catalogPayloads = new Map<string, ThemePayload>();
let catalogFailures = new Set<string>();
let mountedVariant = "";
let mountedPreferenceText = "";
let mountedLight: Theme | null = null;
let applyGeneration = 0;
let suppressInitialWarning = false;
let hasMountedOnce = false;
let warn: (theme: Theme) => void = () => {};

export function effectiveTheme(choice: unknown, systemDark: boolean): Theme {
  if (choice === "light" || choice === "dark") return choice;
  return systemDark ? "dark" : "light";
}

function normalizedThemeChoice(value: unknown): Theme | "" {
  return value === "light" || value === "dark" ? value : "";
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

function themeBundle(payload: ThemePayload): {
  manifest: ThemeBundleManifest;
  sheet: string;
  skin?: string;
  assets: Readonly<Record<string, unknown>>;
} {
  return {
    manifest: { ...payload.manifest, motion: THEME_MOTION },
    sheet: payload.sheet,
    skin: payload.skin ?? undefined,
    assets: payload.assets,
  };
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function reportLoadFailure(id: string, detail: string): void {
  reportThemeTrouble({
    type: "theme",
    theme: id,
    reasons: [`fascio non leggibile: ${detail}`],
  });
}

function persistSelection(): void {
  try {
    localStorage.setItem(
      THEME_CACHE,
      JSON.stringify({ id: selectedThemeId, light: themeChoice }),
    );
  } catch {
    // La selezione in memoria resta autorevole fino al prossimo avvio.
  }
}

async function apply(): Promise<void> {
  const generation = ++applyGeneration;
  const light = effectiveTheme(themeChoice, mediaMatches(DARK_QUERY, true));
  const contrast = effectiveContrast(contrastChoice, mediaMatches(CONTRAST_QUERY, false));
  const requestedId = selectedThemeId;
  let mounted: ThemeMountResult | null = null;
  const waitingForCatalog = requestedId !== SERIES_MANIFEST.id && !catalogLoaded;
  if (requestedId !== SERIES_MANIFEST.id && !waitingForCatalog) {
    const info = installedThemes.find((theme) => theme.manifest.id === requestedId);
    if (!info) {
      if (!catalogFailures.has(requestedId)) {
        reportLoadFailure(requestedId, "tema assente dall'inventario");
      }
    } else if (!info.manifest.lights.includes(light)) {
      reportLoadFailure(requestedId, `luce ${light} non offerta`);
    } else {
      try {
        const cached = catalogPayloads.get(`${requestedId}:${light}`);
        const payload = cached ?? (await api.readTheme(requestedId, light));
        if (generation !== applyGeneration) return;
        if (payload.manifest.id !== requestedId || payload.light !== light) {
          reportLoadFailure(requestedId, "risposta del canale non coerente");
        } else {
          mounted = mountThemeBundle(themeBundle(payload), light);
        }
      } catch (error) {
        if (generation !== applyGeneration) return;
        reportLoadFailure(requestedId, errorDetail(error));
      }
    }
  }

  if (generation !== applyGeneration) return;
  if (!mounted?.mounted) {
    mounted = mountThemeBundle(
      { manifest: SERIES_MANIFEST, sheet: sheetFor(light, contrast), skin, assets: {} },
      light,
    );
    if (!mounted.mounted) return;
    if (requestedId !== SERIES_MANIFEST.id && !waitingForCatalog) {
      selectedThemeId = SERIES_MANIFEST.id;
      persistSelection();
    }
  }

  const actualId =
    requestedId !== SERIES_MANIFEST.id && waitingForCatalog
      ? SERIES_MANIFEST.id
      : selectedThemeId;
  const variant = `${actualId}:${light}:${contrast}`;
  if (variant !== mountedVariant) {
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
    const suppress = suppressInitialWarning;
    suppressInitialWarning = false;
    if (!suppress) warn(light);
  }
}

function valueOf(entries: SettingEntry[], key: string): unknown {
  return entries.find((entry) => entry.spec.key === key)?.value;
}

async function preflightTheme(
  info: ThemeInfo,
  epoch: number,
  preferredLight: Theme,
): Promise<ThemeInfo | null> {
  const id =
    info && info.manifest && typeof info.manifest.id === "string"
      ? info.manifest.id
      : "<tema>";
  const reasons: string[] = [];
  const checked: string[] = [];
  try {
    const offered = info.manifest.lights;
    const light = offered.includes(preferredLight) ? preferredLight : offered[0];
    if (light === undefined) {
      reasons.push("manifest: nessuna luce offerta");
    } else if (light !== "light" && light !== "dark") {
      reasons.push(`manifest: luce ${String(light)} sconosciuta`);
    } else {
      if (epoch !== catalogEpoch) return null;
      let payload: ThemePayload | null = null;
      try {
        payload = await api.readTheme(id, light);
      } catch (error) {
        reasons.push(`luce ${light}: ${errorDetail(error)}`);
      }
      if (payload) {
        if (epoch !== catalogEpoch) return null;
        if (payload.manifest.id !== id || payload.light !== light) {
          reasons.push(`luce ${light}: risposta del canale non coerente`);
        } else {
          const validation = validateThemeBundle(themeBundle(payload), light);
          if (validation.length > 0) {
            reasons.push(`luce ${light}: ${validation.join("; ")}`);
          } else {
            checked.push(`${id}:${light}`);
            catalogPayloads.set(`${id}:${light}`, payload);
          }
        }
      }
    }
  } catch (error) {
    reasons.push(errorDetail(error));
  }
  if (epoch !== catalogEpoch) return null;
  if (reasons.length > 0 || checked.length !== 1) {
    for (const key of checked) catalogPayloads.delete(key);
    catalogFailures.add(id);
    reportLoadFailure(id, reasons.join("; ") || "tema non verificato");
    return null;
  }
  return info;
}

async function preflightCatalog(
  themes: ThemeInfo[],
  epoch: number,
  preferredLight: Theme,
): Promise<ThemeInfo[]> {
  if (epoch !== catalogEpoch) return [];
  const checked = await Promise.all(
    themes.map((theme) => preflightTheme(theme, epoch, preferredLight)),
  );
  return checked.filter((theme): theme is ThemeInfo => theme !== null);
}

async function readCatalog(): Promise<ThemeInfo[]> {
  const epoch = catalogEpoch;
  if (catalogLoaded) return installedThemes;
  if (!catalogRequest) {
    const preferredLight = effectiveTheme(themeChoice, mediaMatches(DARK_QUERY, true));
    const request = Promise.resolve()
      .then(() => api.listThemes())
      .then((themes) => preflightCatalog(themes, epoch, preferredLight))
      .then((themes) => {
        if (epoch === catalogEpoch) {
          installedThemes = themes;
          catalogLoaded = true;
        }
        return themes;
      })
      .catch((error: unknown) => {
        if (epoch === catalogEpoch) catalogRequest = null;
        throw error;
      });
    catalogRequest = request;
  }
  return catalogRequest;
}

/** I temi installati già validati dal backend, per il pannello dedicato. */
export async function themeCatalog(): Promise<ThemeInfo[]> {
  return readCatalog();
}

/** L'identità effettivamente scelta, non solo la luce che le appartiene. */
export function currentThemeId(): string {
  return selectedThemeId;
}

/** Seleziona un tema e persiste insieme il suo id e la luce esplicita. */
export async function selectTheme(id: string, light: Theme | ""): Promise<void> {
  if (id !== SERIES_MANIFEST.id) {
    const info = installedThemes.find((theme) => theme.manifest.id === id);
    if (!info || !info.manifest.lights.includes(light as Theme)) {
      throw new Error("tema non disponibile");
    }
  }
  const previousId = selectedThemeId;
  const previousChoice = themeChoice;
  selectedThemeId = id;
  themeChoice = light;
  try {
    // Aggiorna lo stato vivo prima del comando: il backend emette
    // `setting_changed` durante la scrittura e il reread concorrente deve
    // osservare questa selezione esplicita, non quella appena precedente.
    await api.setSetting(THEME_KEY, light);
    persistSelection();
    await apply();
  } catch (error) {
    selectedThemeId = previousId;
    themeChoice = previousChoice;
    persistSelection();
    await apply();
    throw error;
  }
}

async function reread(): Promise<void> {
  const epoch = catalogEpoch;
  let entries: SettingEntry[];
  try {
    [entries] = await Promise.all([settings(), readCatalog()]);
  } catch {
    if (epoch !== catalogEpoch) return;
    // Un inventario irraggiungibile non può lasciare attivo un tema che non
    // abbiamo potuto verificare: il ripiego è la serie, in modo atomico.
    selectedThemeId = SERIES_MANIFEST.id;
    persistSelection();
    await apply();
    return;
  }
  if (epoch !== catalogEpoch) return;
  const theme = valueOf(entries, THEME_KEY);
  const contrast = valueOf(entries, CONTRAST_KEY);
  const previousChoice = themeChoice;
  const previousId = selectedThemeId;
  themeChoice = normalizedThemeChoice(theme);
  // Lime non è più un fascio: chi lo aveva scelto resta sul buio che aveva.
  if (theme === "lime") themeChoice = "dark";
  contrastChoice = typeof contrast === "string" ? contrast : "";
  preferences = normalizedPreferences({
    density: valueOf(entries, DENSITY_KEY) as Density,
    body: valueOf(entries, BODY_KEY) as number,
    lineHeight: valueOf(entries, LINE_HEIGHT_KEY) as number,
    measure: valueOf(entries, MEASURE_KEY) as number,
    font: valueOf(entries, FONT_KEY) as ReadingFont,
    accent: valueOf(entries, ACCENT_KEY) as number,
  });
  if (
    previousId !== SERIES_MANIFEST.id &&
    (previousChoice !== themeChoice ||
      !installedThemes.some((installed) => installed.manifest.id === previousId))
  ) {
    selectedThemeId = SERIES_MANIFEST.id;
  }
  try {
    persistSelection();
    localStorage.setItem(
      PREFERENCES_CACHE,
      JSON.stringify({ contrast: contrastChoice, preferences }),
    );
  } catch {
    // Il valore vivo è già in memoria; la cache serve solo al primo fotogramma.
  }
  if (epoch !== catalogEpoch) return;
  await apply();
}

function loadCache(): void {
  themeChoice = "";
  selectedThemeId = SERIES_MANIFEST.id;
  contrastChoice = "";
  preferences = { ...DEFAULT_PREFERENCES };
  try {
    const cachedTheme = localStorage.getItem(THEME_CACHE) ?? "";
    try {
      const parsed = JSON.parse(cachedTheme) as { id?: unknown; light?: unknown };
      if (typeof parsed.id === "string" && typeof parsed.light === "string") {
        selectedThemeId = parsed.id;
        themeChoice = normalizedThemeChoice(parsed.light);
      } else {
        throw new Error("vecchia cache del tema");
      }
    } catch {
      // Compatibilità con la cache precedente, che conteneva solo la luce.
      if (cachedTheme === "lime") {
        themeChoice = "dark";
        localStorage.setItem(THEME_CACHE, "dark");
      } else {
        themeChoice = normalizedThemeChoice(cachedTheme);
      }
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
    selectedThemeId = SERIES_MANIFEST.id;
    contrastChoice = "";
    preferences = { ...DEFAULT_PREFERENCES };
  }
}

 
export function mountTheme(lifetime: Lifetime, onChange: (theme: Theme) => void): void {
  catalogEpoch += 1;
  suppressInitialWarning = !hasMountedOnce;
  hasMountedOnce = true;
  loadCache();
  catalogLoaded = false;
  catalogRequest = null;
  installedThemes = [];
  catalogPayloads = new Map();
  catalogFailures = new Set();
  mountedVariant = "";
  mountedPreferenceText = "";
  mountedLight = null;
  mount(fonts, "caratteri");
  void apply();
  warn = onChange;
  for (const query of [DARK_QUERY, CONTRAST_QUERY]) {
    const media = window.matchMedia?.(query);
    if (media) lifetime.listen(media, "change", () => void apply());
  }
  onEvent("setting_changed", () => void reread());
  on("vault", () => void reread());
  void reread();
}

