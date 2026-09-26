// Luce, contrasto e preferenze personali: una risoluzione, un foglio montato.
import { api } from "../host/ipc";
import { settings } from "../host/query";
import type { SettingEntry, ThemeInfo, ThemePayload } from "../host/contract";
import { asPluginError, errorText } from "../host/errors";
import { onEvent } from "../state/kernel";
import { emit, on } from "../state/store";
import type { Lifetime } from "../ui/lifetime";
import { reportThemeTrouble } from "../ui/notify";
import sheetDarkHigh from "./serie/sheet-dark-high.css?raw";
import sheetDark from "./serie/sheet-dark.css?raw";
import sheetLightHigh from "./serie/sheet-light-high.css?raw";
import sheetLight from "./serie/sheet-light.css?raw";
import fonts from "./serie/fonts.css?raw";
import skin from "./serie/skin.css?raw";
import {
  mount,
  mountPreferences,
  mountThemeBundle,
  validateThemeBundle,
  type ThemeBundleManifest,
  type ThemeMountResult,
} from "./loader";
import { accentPalette, type ContrastLevel } from "./serie/recipe";
import { mountCssSnippets } from "./snippets";
import { setReducedMotionPreference } from "./reduced-motion";
import { setFrameRatePreference } from "./frame-rate";

export type Theme = "light" | "dark";
export type Density = "compact" | "comfortable" | "relaxed";
export type ReadingFont = "literata" | "inter" | "system";

export interface ThemePreviewSelection {
  id: string;
  light: Theme;
}

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
export const THEME_ID_KEY = "appearance.theme-id";
export const MOTION_KEY = "appearance.motion";
export const FRAME_RATE_KEY = "appearance.frame-rate";
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
  motion: ["opacity", "transform"],
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
let previewSelection: ThemePreviewSelection | null = null;
let installedThemes: ThemeInfo[] = [];
let catalogLoaded = false;
let catalogRequest: Promise<ThemeInfo[]> | null = null;
let catalogEpoch = 0;
let catalogPayloads = new Map<string, ThemePayload>();
let mountedVariant = "";
let mountedPreferenceText = "";
let mountedLight: Theme | null = null;
let suppressInitialWarning = false;
let applyGeneration = 0;
let selectionGeneration = 0;
/// Quante `selectTheme` stanno scrivendo. Una selezione scrive due chiavi
/// (luce e id), e un `reread` fra le due vedrebbe metà scelta: finché
/// scrivono, la selezione in memoria è loro e `reread` non la tocca.
let selecting = 0;
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
    manifest: payload.manifest,
    sheet: payload.sheet,
    skin: payload.skin ?? undefined,
    assets: payload.assets,
  };
}

function errorDetail(error: unknown): string {
  if (error instanceof Error || asPluginError(error)) return errorText(error);
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
  const light = effectiveTheme(
    previewSelection?.light ?? themeChoice,
    mediaMatches(DARK_QUERY, true),
  );
  const contrast = effectiveContrast(contrastChoice, mediaMatches(CONTRAST_QUERY, false));
  const requestedId = previewSelection?.id ?? selectedThemeId;
  let mounted: ThemeMountResult | null = null;
  let actualId = SERIES_THEME_ID;
  const waitingForCatalog = requestedId !== SERIES_THEME_ID && !catalogLoaded;

  if (requestedId !== SERIES_THEME_ID && !waitingForCatalog) {
    const info = installedThemes.find((theme) => theme.manifest.id === requestedId);
    if (!info) {
      reportLoadFailure(requestedId, "tema assente dall'inventario");
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
          if (mounted.mounted) actualId = requestedId;
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
  }

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
    if (suppressInitialWarning) suppressInitialWarning = false;
    else warn(light);
  }
  emit("theme");
}

function valueOf(entries: Awaited<ReturnType<typeof settings>>, key: string): unknown {
  return entries.find((entry) => entry.spec.key === key)?.value;
}

async function reread(): Promise<void> {
  const epoch = catalogEpoch;
  let entries: SettingEntry[];
  try {
    [entries] = await Promise.all([settings(), readCatalog()]);
  } catch {
    if (epoch !== catalogEpoch) return;
    await apply();
    return;
  }
  if (epoch !== catalogEpoch) return;
  const theme = valueOf(entries, THEME_KEY);
  const contrast = valueOf(entries, CONTRAST_KEY);
  const previousChoice = themeChoice;
  const previousId = selectedThemeId;
  if (selecting === 0) {
    themeChoice = normalizedThemeChoice(theme);
    if (theme === "lime") themeChoice = "dark";
  }
  contrastChoice = typeof contrast === "string" ? contrast : "";
  setReducedMotionPreference(valueOf(entries, MOTION_KEY) === "reduced");
  setFrameRatePreference(valueOf(entries, FRAME_RATE_KEY));
  preferences = normalizedPreferences({
    density: valueOf(entries, DENSITY_KEY) as Density,
    body: valueOf(entries, BODY_KEY) as number,
    lineHeight: valueOf(entries, LINE_HEIGHT_KEY) as number,
    measure: valueOf(entries, MEASURE_KEY) as number,
    font: valueOf(entries, FONT_KEY) as ReadingFont,
    accent: valueOf(entries, ACCENT_KEY) as number,
  });
  // L'id scritto nelle impostazioni della macchina è autorevole. Se non è mai
  // stato scritto (una shell precedente lo teneva solo nella cache), vale la
  // regola di prima: un tema installato resta finché la luce non cambia.
  const idEntry = entries.find((entry) => entry.spec.key === THEME_ID_KEY);
  const storedId = idEntry && idEntry.source !== "default" && typeof idEntry.value === "string" && idEntry.value !== ""
    ? idEntry.value
    : null;
  if (selecting > 0) {
    // La selezione in volo decide da sé.
  } else if (storedId !== null) {
    const usable = storedId === SERIES_THEME_ID || installedThemes.some((installed) =>
      installed.manifest.id === storedId && installed.manifest.lights.includes(themeChoice as Theme));
    const next = usable ? storedId : SERIES_THEME_ID;
    if (next !== selectedThemeId) {
      selectionGeneration++;
      selectedThemeId = next;
    }
  } else if (
    previousId !== SERIES_THEME_ID &&
    (previousChoice !== themeChoice ||
      !installedThemes.some((installed) => installed.manifest.id === previousId))
  ) {
    selectionGeneration++;
    selectedThemeId = SERIES_THEME_ID;
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

async function readCatalog(): Promise<ThemeInfo[]> {
  if (catalogLoaded) return installedThemes;
  if (!catalogRequest) {
    catalogRequest = api
      .listThemes()
      .then(async (themes) => {
        const verified = await Promise.all(
          themes.map(async (info) => {
            try {
              for (const light of info.manifest.lights) {
                const payload = await api.readTheme(info.manifest.id, light);
                if (
                  payload.manifest.id !== info.manifest.id ||
                  payload.light !== light ||
                  validateThemeBundle(themeBundle(payload), light).length > 0
                ) {
                  return null;
                }
                catalogPayloads.set(`${info.manifest.id}:${light}`, payload);
              }
              return info;
            } catch (error) {
              reportLoadFailure(info.manifest.id, errorDetail(error));
              return null;
            }
          }),
        );
        installedThemes = verified.filter((info): info is ThemeInfo => info !== null);
        catalogLoaded = true;
        return installedThemes;
      })
      .catch((error: unknown) => {
        catalogRequest = null;
        throw error;
      });
  }
  return catalogRequest;
}

/** I temi installati già validati dal backend, per il pannello dedicato. */
export async function themeCatalog(): Promise<ThemeInfo[]> {
  return readCatalog();
}

/** Core is bundled with the host. Installed themes are not executable code,
 * but remain community-owned CSS subject to the theme-1 trust gate. */
export function themeTrust(id: string): "core" | "community" {
  return id === SERIES_THEME_ID ? "core" : "community";
}

/** L'identità effettivamente scelta, non solo la luce che le appartiene. */
export function currentThemeId(): string {
  return selectedThemeId;
}

/** L'anteprima temporanea corrente, che non modifica impostazioni o cache. */
export function currentThemePreview(): ThemePreviewSelection | null {
  return previewSelection ? { ...previewSelection } : null;
}

/**
 * Monta temporaneamente un tema senza persisterlo.
 *
 * La selezione autorevole resta invariata: chiude o annulla il pannello e
 * cancelThemePreview rimonta il tema precedente. Più richieste rapide sono
 * serializzate dalla stessa generazione usata dalla selezione persistente.
 */
export async function previewTheme(id: string, light: Theme): Promise<void> {
  if (id !== SERIES_THEME_ID) {
    const info = installedThemes.find((theme) => theme.manifest.id === id);
    if (!info || !info.manifest.lights.includes(light)) {
      throw new Error("tema non disponibile");
    }
  }
  const generation = ++selectionGeneration;
  previewSelection = { id, light };
  await apply();
  if (generation !== selectionGeneration) return;
  if (!mountedVariant.startsWith(id + ":" + light + ":")) {
    previewSelection = null;
    await apply();
    throw new Error("anteprima tema non disponibile");
  }
}


/** Seleziona un tema e persiste insieme il suo id e la luce esplicita. */
export async function selectTheme(id: string, light: Theme | ""): Promise<void> {
  if (id !== SERIES_THEME_ID) {
    const info = installedThemes.find((theme) => theme.manifest.id === id);
    if (!info || !info.manifest.lights.includes(light as Theme)) {
      throw new Error("tema non disponibile");
    }
  }
  const generation = ++selectionGeneration;
  const previousId = selectedThemeId;
  const previousChoice = themeChoice;
  previewSelection = null;
  selectedThemeId = id;
  themeChoice = light;
  selecting++;
  try {
    // Aggiorna lo stato vivo prima del comando: il backend emette
    // `setting_changed` durante la scrittura e il reread concorrente deve
    // osservare questa selezione esplicita, non quella appena precedente.
    await api.setSetting(THEME_KEY, light);
    // L'id segue la luce nelle impostazioni della macchina. Se l'host non lo
    // dichiara (uno precedente), resta la cache: la luce è già scritta.
    await api.setSetting(THEME_ID_KEY, id).catch(() => {});
    if (generation !== selectionGeneration) return;
    persistSelection();
    await apply();
  } catch (error) {
    if (generation === selectionGeneration) {
      selectedThemeId = previousId;
      themeChoice = previousChoice;
      persistSelection();
      await apply();
    }
    throw error;
  } finally {
    selecting--;
  }
}


/** Annulla l'anteprima e rimonta la selezione autorevole precedente. */
export async function cancelThemePreview(): Promise<void> {
  if (!previewSelection) return;
  ++selectionGeneration;
  previewSelection = null;
  await apply();
}

function loadCache(): void {
  themeChoice = "";
  selectedThemeId = SERIES_THEME_ID;
  previewSelection = null;
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
      themeChoice = cachedTheme === "lime" ? "dark" : normalizedThemeChoice(cachedTheme);
      persistSelection();
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
    selectedThemeId = SERIES_THEME_ID;
    contrastChoice = "";
    preferences = { ...DEFAULT_PREFERENCES };
  }
}

export function mountTheme(lifetime: Lifetime, onChange: (theme: Theme) => void): void {
  if (lifetime.closed) return;
  const hadMountedTheme =
    document.head.querySelector<HTMLStyleElement>('style[data-fub="foglio"]') !== null;
  lifetime.add(() => {
    applyGeneration++;
    selectionGeneration++;
    previewSelection = null;
  });
  selectionGeneration++;
  loadCache();
  catalogEpoch += 1;
  catalogLoaded = false;
  catalogRequest = null;
  installedThemes = [];
  catalogPayloads = new Map<string, ThemePayload>();
  mountedVariant = "";
  mountedPreferenceText = "";
  mountedLight = hadMountedTheme ? mountedLight : null;
  suppressInitialWarning = !hadMountedTheme;
  warn = onChange;
  mount(fonts, "caratteri");
  mountCssSnippets(lifetime);
  void apply();
  for (const query of [DARK_QUERY, CONTRAST_QUERY]) {
    const media = window.matchMedia?.(query);
    if (media) lifetime.listen(media, "change", () => void apply());
  }
  lifetime.add(onEvent("setting_changed", () => void reread()));
  lifetime.add(on("vault", () => void reread()));
  void reread();
}
