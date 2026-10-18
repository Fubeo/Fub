// Luce, contrasto e preferenze personali: una risoluzione, un foglio montato.
import { api } from "../host/ipc";
import { settings } from "../host/query";
import type { SettingEntry, ThemeInfo, ThemePayload } from "../host/contract";
import { asPluginError, errorText } from "../host/errors";
import { onEvent } from "../state/kernel";
import { emit, on } from "../state/store";
import type { Lifetime } from "../ui/lifetime";
import { reportThemeTrouble } from "../ui/notify";
import {
  mount,
  mountPreferences,
  mountThemeBundle,
  validateThemeBundle,
  declareThemeProfile,
  type ThemeBundleManifest,
  type ThemeMountResult,
  type ThemeProfile,
} from "./loader";
import type { ContrastLevel } from "./scrittoio/recipe";
import { SCRITTOIO_SERIES } from "./scrittoio/series";
import { mountCssSnippets } from "./snippets";
import { setMotionPreference } from "../moto/level";
import { setFrameRatePreference } from "./frame-rate";
import { setDiagramStylePreference } from "./diagram-style";
import { applyThemeOptions, resolveThemeOptions, type ThemeOption } from "./options";

export type Theme = "light" | "dark";
export type Density = "compact" | "comfortable" | "relaxed";
/** Una voce di `appearance.font`: quali esistono lo dice la serie in vigore. */
export type ReadingFont = string;

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
export const DIAGRAM_STYLE_KEY = "appearance.diagram-style";
export const COMPACTNESS_KEY = "chrome.compactness";
const THEME_CACHE = "fub.appearance.theme";
export const SERIES_THEME_ID = "fub.serie";
const PREFERENCES_CACHE = "fub.appearance.preferences";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const CONTRAST_QUERY = "(prefers-contrast: more)";
export interface AppearancePreferences {
  density: Density;
  body: number;
  lineHeight: number;
  measure: number;
  font: ReadingFont;
  accent: number;
  /** `chrome.compactness`: lo spazio dell'interfaccia, da 0 a 4. Assente = 0. */
  compactness?: number;
}

/**
 * Una **serie**: ciò che la shell monta quando nessun tema installato è
 * scelto, e ciò su cui ricade quando quello scelto non regge.
 *
 * Tiene insieme le cose che cambiano insieme passando da una shell all'altra:
 * il profilo del cancello, i fogli, la pelle, i caratteri, i predefiniti e il
 * modo in cui le preferenze della persona diventano token. Di serie è lo
 * Scrittoio; chi compone la shell può dichiararla all'avvio
 * (`declareThemeSeries`), e un banco può dichiararne un'altra e tornare
 * indietro.
 */
export interface ThemeSeries {
  readonly manifest: ThemeBundleManifest;
  readonly profile: ThemeProfile;
  readonly fonts: string;
  readonly skin: string;
  /** Ciò che vale finché la persona non ha scelto. */
  readonly defaults: AppearancePreferences;
  /** Le voci di `appearance.font` che la serie sa rendere, con la loro pila. */
  readonly readingFonts: Readonly<Record<string, string>>;
  sheet(light: Theme, contrast: ContrastLevel): string;
  /** I token di densità, accento e cornice: ciò che è proprio della serie. */
  tokens(preferences: AppearancePreferences, light: Theme, contrast: ContrastLevel): Record<string, string>;
}

let series: ThemeSeries = SCRITTOIO_SERIES;

/** La serie in vigore in questa finestra. */
export function themeSeries(): ThemeSeries {
  return series;
}

/**
 * Dichiara la serie della shell, e con lei il profilo del cancello. Va
 * chiamata prima di `mountTheme`. Rende il modo di tornare alla precedente.
 */
export function declareThemeSeries(next: ThemeSeries): () => void {
  const previous = series;
  series = next;
  const restoreProfile = declareThemeProfile(next.profile);
  preferences = { ...next.defaults };
  return () => {
    restoreProfile();
    if (series !== next) return;
    series = previous;
    preferences = { ...previous.defaults };
  };
}

let themeChoice: Theme | "" = "";
let contrastChoice = "";
let preferences: AppearancePreferences = { ...series.defaults };
let selectedThemeId = SERIES_THEME_ID;
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
/// L'ultima lettura delle impostazioni: da lì vengono i valori delle scelte
/// che il tema montato dichiara.
let settingEntries: readonly SettingEntry[] = [];
let mountedOptions: ThemeOptions = { themeId: SERIES_THEME_ID, themeName: "", options: [] };

/** Le scelte del tema montato, col valore che vale adesso. */
export interface ThemeOptions {
  readonly themeId: string;
  readonly themeName: string;
  readonly options: readonly ThemeOption[];
}
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

/** Le preferenze d'aspetto in vigore: una copia, non la cosa viva. */
export function currentPreferences(): AppearancePreferences {
  return { ...preferences };
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function normalizedPreferences(raw: Partial<AppearancePreferences>): AppearancePreferences {
  const defaults = series.defaults;
  const known = typeof raw.font === "string" && Object.prototype.hasOwnProperty.call(series.readingFonts, raw.font);
  return {
    density:
      raw.density === "compact" || raw.density === "relaxed" || raw.density === "comfortable"
        ? raw.density
        : defaults.density,
    body: bounded(raw.body, defaults.body, 12, 28),
    lineHeight: bounded(raw.lineHeight, defaults.lineHeight, 1.2, 2.4),
    measure: bounded(raw.measure, defaults.measure, 40, 100),
    font: known ? (raw.font as string) : defaults.font,
    accent: bounded(raw.accent, defaults.accent, 0, 360),
    compactness: Math.round(bounded(raw.compactness, defaults.compactness ?? 0, 0, 4)),
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
  tokens["font-reading"] = series.readingFonts[safe.font] ?? series.readingFonts[series.defaults.font]!;
  tokens["text-reading"] = `${safe.body}px`;
  tokens["leading-relaxed"] = String(safe.lineHeight);
  tokens["content-width"] = `${safe.measure}ch`;
  Object.assign(tokens, series.tokens(safe, light, contrast));
  return tokens;
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
      { manifest: series.manifest, sheet: series.sheet(light, contrast), skin: series.skin, assets: {} },
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

  // Le scelte che il tema montato lascia a chi lo usa: sono sue, e cambiato
  // tema non ne resta nessuna del precedente.
  const owner = actualId === SERIES_THEME_ID
    ? series.manifest
    : installedThemes.find((theme) => theme.manifest.id === actualId)?.manifest ?? series.manifest;
  mountedOptions = {
    themeId: actualId,
    themeName: owner.name,
    options: resolveThemeOptions(actualId, owner.settings, settingEntries),
  };
  applyThemeOptions(document.documentElement, mountedOptions.options);

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
  settingEntries = entries;
  const theme = valueOf(entries, THEME_KEY);
  const contrast = valueOf(entries, CONTRAST_KEY);
  const previousChoice = themeChoice;
  const previousId = selectedThemeId;
  if (selecting === 0) {
    themeChoice = normalizedThemeChoice(theme);
    if (theme === "lime") themeChoice = "dark";
  }
  contrastChoice = typeof contrast === "string" ? contrast : "";
  // Dal canale dei tre livelli, non da quello del moto ridotto: scrivono lo
  // stesso attributo, e il secondo cancellerebbe «calmo».
  const motion = valueOf(entries, MOTION_KEY);
  setMotionPreference(motion === "reduced" ? "reduced" : motion === "calm" ? "calm" : "system");
  setFrameRatePreference(valueOf(entries, FRAME_RATE_KEY));
  setDiagramStylePreference(valueOf(entries, DIAGRAM_STYLE_KEY));
  preferences = normalizedPreferences({
    density: valueOf(entries, DENSITY_KEY) as Density,
    body: valueOf(entries, BODY_KEY) as number,
    lineHeight: valueOf(entries, LINE_HEIGHT_KEY) as number,
    measure: valueOf(entries, MEASURE_KEY) as number,
    font: valueOf(entries, FONT_KEY) as ReadingFont,
    accent: valueOf(entries, ACCENT_KEY) as number,
    compactness: valueOf(entries, COMPACTNESS_KEY) as number,
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
                if (payload.manifest.id !== info.manifest.id || payload.light !== light) return null;
                // Un fascio che il cancello rifiuta resta installato ma fuori
                // dal catalogo, e la persona sa perché: è anche il caso di un
                // tema `theme-1`, scritto per la shell di prima.
                const reasons = validateThemeBundle(themeBundle(payload), light);
                if (reasons.length > 0) {
                  reportThemeTrouble({ type: "theme", theme: info.manifest.name, reasons });
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

/** Le scelte del tema montato adesso (anche in anteprima). Cambiano con il
 * segnale `theme`, come tutto ciò che il tema scrive sulla radice. */
export function currentThemeOptions(): ThemeOptions {
  return mountedOptions;
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
  preferences = { ...series.defaults };
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
    preferences = { ...series.defaults };
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
  settingEntries = [];
  mountedLight = hadMountedTheme ? mountedLight : null;
  suppressInitialWarning = !hadMountedTheme;
  warn = onChange;
  mount(series.fonts, "caratteri");
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
