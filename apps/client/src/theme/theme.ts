// Luce, contrasto e preferenze personali: una risoluzione, un foglio montato.
import { api } from "../host/ipc";
import { settings } from "../host/query";
import type { SettingEntry, ThemeFolderCheck, ThemeInfo, ThemeLink, ThemePayload } from "../host/contract";
import { asPluginError, errorText } from "../host/errors";
import { onEvent } from "../state/kernel";
import { emit, on } from "../state/store";
import type { Lifetime } from "../ui/lifetime";
import { notify, reportThemeTrouble } from "../ui/notify";
import {
  mount,
  mountPreferences,
  mountThemeBundle,
  validateThemeBundle,
  declareThemeProfile,
  type ThemeBundle,
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
import { setContentLookPreference } from "./content-look";
import { applyThemeOptions, resolveThemeOptions, type ThemeOption } from "./options";
import { plural, t } from "../i18n/strings";

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
export const BARS_KEY = "appearance.bars";
export const BODY_KEY = "appearance.body";
export const LINE_HEIGHT_KEY = "appearance.line-height";
export const MEASURE_KEY = "appearance.measure";
export const FONT_KEY = "appearance.font";
export const UI_FONT_KEY = "appearance.font-ui";
export const MONO_FONT_KEY = "appearance.font-mono";
export const ACCENT_KEY = "appearance.accent";
export const ZOOM_KEY = "appearance.zoom";
export const THEME_ID_KEY = "appearance.theme-id";
export const MOTION_KEY = "appearance.motion";
export const FRAME_RATE_KEY = "appearance.frame-rate";
export const DIAGRAM_STYLE_KEY = "appearance.diagram-style";
export const CONTENT_LOOK_KEY = "appearance.content-look";
export const COMPACTNESS_KEY = "chrome.compactness";
/// La modalità sviluppatore e la cartella del tema collegato
/// (`fub_host::settings::DEVELOPER_MODE`, `DEVELOPER_THEME_FOLDER`): cambiarle
/// cambia i temi che l'host elenca.
const DEVELOPER_MODE = "developer.mode";
export const DEVELOPER_THEME_FOLDER_KEY = "developer.theme-folder";
const THEME_CACHE = "fub.appearance.theme";
export const SERIES_THEME_ID = "fub.serie";
const PREFERENCES_CACHE = "fub.appearance.preferences";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const CONTRAST_QUERY = "(prefers-contrast: more)";
/** Il vassoio delle barre (`appearance.bars`): `light` è quello di serie, il
 *  tono della ricetta; `marked` lo riporta su `--sheet-2`, più staccato dalla
 *  carta (D6 C). */
export type Bars = "light" | "marked";

/** Il vassoio di un valore dell'impostazione: uno sconosciuto è il predefinito,
 *  e non spegne niente. */
export function barsOf(value: unknown): Bars {
  return value === "marked" ? "marked" : "light";
}

export interface AppearancePreferences {
  density: Density;
  body: number;
  lineHeight: number;
  measure: number;
  font: ReadingFont;
  /** `appearance.font-ui`: una voce di `uiFonts` della serie. Assente = la sua. */
  uiFont?: string;
  /** `appearance.font-mono`: una voce di `monoFonts` della serie. Assente = la sua. */
  monoFont?: string;
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
  /** Le voci di `appearance.font-ui` e `appearance.font-mono`, con la loro pila.
   *  Una serie che non le dà lascia i caratteri dei suoi fogli. */
  readonly uiFonts?: Readonly<Record<string, string>>;
  readonly monoFonts?: Readonly<Record<string, string>>;
  sheet(light: Theme, contrast: ContrastLevel): string;
  /** I token di densità, accento e cornice: ciò che è proprio della serie. */
  tokens(preferences: AppearancePreferences, light: Theme, contrast: ContrastLevel): Record<string, string>;
  /**
   * Completa il foglio di un tema installato con i ruoli facoltativi che la
   * serie sa ricavare dai suoi colori (la cartella del logo, D26). Rende il
   * foglio com'è quando non c'è niente da aggiungere. Una serie che non lo dà
   * lascia i fogli dei temi come sono.
   */
  completeSheet?(sheet: string, light: Theme, contrast: ContrastLevel): string;
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
/// `appearance.bars`, come l'ha letto l'ultimo giro (o la cache del primo fotogramma).
let barsChoice: Bars = "light";
/// `appearance.content-look`, come l'ha letto l'ultimo giro: lo risolve
/// `content-look.ts` con il contrasto in vigore.
let contentLookChoice: unknown = undefined;
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

/// La prima lettura delle impostazioni di questo montaggio è stata applicata:
/// da qui il tema montato è quello scelto (anche dal catalogo, se c'è), non più
/// quello della cache del primo fotogramma. Lo aspetta la consegna dello strato
/// d'avvio (`avvio/consegna.ts`), che ne legge i colori.
let themeSettled = false;
let settledWaiters: (() => void)[] = [];

function settleTheme(): void {
  themeSettled = true;
  const waiting = settledWaiters;
  settledWaiters = [];
  for (const resolve of waiting) resolve();
}

/// Si risolve quando il tema è quello definitivo dell'avvio: la prima lettura
/// delle impostazioni e del catalogo è applicata, comunque sia andata. Chi non
/// può aspettare a lungo la mette in gara con un tempo suo.
export function whenThemeSettled(): Promise<void> {
  if (themeSettled) return Promise.resolve();
  return new Promise((resolve) => settledWaiters.push(resolve));
}

/// Le scelte di luce e di contrasto, non il loro risultato: `""` è «come il
/// sistema». Le salva lo strato d'avvio, che le risolve da sé al prossimo
/// avvio con le regole di `effectiveTheme` ed `effectiveContrast`.
export function themeChoices(): { readonly light: Theme | ""; readonly contrast: string } {
  return { light: themeChoice, contrast: contrastChoice };
}

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
  const among = (value: unknown, fonts: Readonly<Record<string, string>> | undefined, fallback: string | undefined) =>
    typeof value === "string" && fonts !== undefined && Object.prototype.hasOwnProperty.call(fonts, value) ? value : fallback;
  return {
    density:
      raw.density === "compact" || raw.density === "relaxed" || raw.density === "comfortable"
        ? raw.density
        : defaults.density,
    body: bounded(raw.body, defaults.body, 12, 28),
    lineHeight: bounded(raw.lineHeight, defaults.lineHeight, 1.2, 2.4),
    measure: bounded(raw.measure, defaults.measure, 40, 100),
    font: known ? (raw.font as string) : defaults.font,
    uiFont: among(raw.uiFont, series.uiFonts, defaults.uiFont),
    monoFont: among(raw.monoFont, series.monoFonts, defaults.monoFont),
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
  const ui = safe.uiFont === undefined ? undefined : series.uiFonts?.[safe.uiFont];
  if (ui !== undefined) tokens["font-ui"] = ui;
  const mono = safe.monoFont === undefined ? undefined : series.monoFonts?.[safe.monoFont];
  if (mono !== undefined) tokens["font-mono"] = mono;
  tokens["text-reading"] = `${safe.body}px`;
  tokens["leading-relaxed"] = String(safe.lineHeight);
  tokens["content-width"] = `${safe.measure}ch`;
  Object.assign(tokens, series.tokens(safe, light, contrast));
  return tokens;
}

/**
 * Il fascio da montare per una luce di un tema installato. Un tema che eredita
 * dalla serie (`extends: "fub.serie"`) e non porta il foglio di questa luce
 * prende quello di serie della stessa luce e dello stesso contrasto, e porta
 * con sé la pelle di serie, che resta montata sotto la sua (ADR 0240).
 * Ereditare da altro che la serie non si sa fare: il fascio parte senza
 * eredità e il cancello lo rifiuta dicendo da chi voleva ereditare.
 *
 * Il foglio portato dal tema passa dalla serie (`completeSheet`) prima del
 * cancello: aggiunge i ruoli facoltativi che la serie sa ricavare dai colori
 * del tema, come la cartella del logo (D26).
 */
function themeBundle(payload: ThemePayload, light: Theme, contrast: ContrastLevel): ThemeBundle {
  const inherits = payload.manifest.extends === SERIES_THEME_ID;
  const own = payload.sheet;
  return {
    manifest: payload.manifest,
    sheet: own !== null && own !== undefined
      ? series.completeSheet?.(own, light, contrast) ?? own
      : inherits ? series.sheet(light, contrast) : "",
    skin: payload.skin ?? undefined,
    assets: payload.assets,
    ...(inherits ? { inherited: { skin: series.skin } } : {}),
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

/// `data-bars` sulla radice, solo per `marked`: con `light` l'attributo non c'è
/// e vale il ruolo della ricetta. Si scrive prima di ogni `await`, così il primo
/// fotogramma ha già il vassoio scelto, anche se il tema si monta dopo.
function applyBars(): void {
  if (barsChoice === "marked") document.documentElement.dataset.bars = "marked";
  else delete document.documentElement.dataset.bars;
}

async function apply(): Promise<void> {
  const generation = ++applyGeneration;
  applyBars();
  const light = effectiveTheme(
    previewSelection?.light ?? themeChoice,
    mediaMatches(DARK_QUERY, true),
  );
  const contrast = effectiveContrast(contrastChoice, mediaMatches(CONTRAST_QUERY, false));
  setContentLookPreference(contentLookChoice, contrast === "high");
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
          mounted = mountThemeBundle(themeBundle(payload, light, contrast), light);
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
  contentLookChoice = valueOf(entries, CONTENT_LOOK_KEY);
  barsChoice = barsOf(valueOf(entries, BARS_KEY));
  preferences = normalizedPreferences({
    density: valueOf(entries, DENSITY_KEY) as Density,
    body: valueOf(entries, BODY_KEY) as number,
    lineHeight: valueOf(entries, LINE_HEIGHT_KEY) as number,
    measure: valueOf(entries, MEASURE_KEY) as number,
    font: valueOf(entries, FONT_KEY) as ReadingFont,
    uiFont: valueOf(entries, UI_FONT_KEY) as string,
    monoFont: valueOf(entries, MONO_FONT_KEY) as string,
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
      JSON.stringify({ contrast: contrastChoice, preferences, bars: barsChoice }),
    );
  } catch {
    // Il valore vivo è già in memoria; la cache serve solo al primo fotogramma.
  }
  if (epoch !== catalogEpoch) return;
  await apply();
}

/**
 * Un tema installato che la shell ha lasciato fuori dal catalogo: il cancello
 * l'ha rifiutato (`validateThemeBundle`, i motivi così come sono) o il fascio
 * non si è letto. `light` è la luce controllata, `null` se il fascio non è
 * arrivato; `at` è l'ora del tentativo (`Date.now`).
 */
export interface ThemeRejection {
  readonly id: string;
  readonly name: string;
  readonly light: Theme | null;
  readonly reasons: readonly string[];
  readonly at: number;
}

/// I rifiuti dell'ultima lettura del catalogo: li mostra Aspetto come diagnosi.
let catalogRejections: readonly ThemeRejection[] = [];
/// Il giro di lettura del catalogo: una lettura superata da una rilettura non
/// scrive più niente.
let catalogRound = 0;

async function readCatalog(): Promise<ThemeInfo[]> {
  if (catalogLoaded) return installedThemes;
  if (!catalogRequest) {
    const round = ++catalogRound;
    const payloads = new Map<string, ThemePayload>();
    const rejected: ThemeRejection[] = [];
    const request: Promise<ThemeInfo[]> = api
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
                // Il foglio ereditato si misura col contrasto di adesso: è
                // quello che `apply` monterà.
                const contrast = effectiveContrast(contrastChoice, mediaMatches(CONTRAST_QUERY, false));
                const reasons = validateThemeBundle(themeBundle(payload, light, contrast), light);
                if (reasons.length > 0) {
                  if (round === catalogRound) {
                    reportThemeTrouble({ type: "theme", theme: info.manifest.name, reasons });
                  }
                  rejected.push({ id: info.manifest.id, name: info.manifest.name, light, reasons, at: Date.now() });
                  return null;
                }
                payloads.set(`${info.manifest.id}:${light}`, payload);
              }
              return info;
            } catch (error) {
              const detail = errorDetail(error);
              if (round === catalogRound) reportLoadFailure(info.manifest.id, detail);
              rejected.push({
                id: info.manifest.id,
                name: info.manifest.name,
                light: null,
                reasons: [`fascio non leggibile: ${detail}`],
                at: Date.now(),
              });
              return null;
            }
          }),
        );
        // Superata da una rilettura: il risultato è di quella.
        if (round !== catalogRound) return readCatalog();
        const accepted = verified.filter((info): info is ThemeInfo => info !== null);
        keepLastGoodLinked(themes, accepted, payloads);
        installedThemes = accepted;
        catalogPayloads = payloads;
        catalogRejections = rejected;
        catalogLoaded = true;
        return installedThemes;
      })
      .catch((error: unknown) => {
        if (round === catalogRound) catalogRequest = null;
        throw error;
      });
    catalogRequest = request;
  }
  return catalogRequest;
}

/**
 * I temi che l'ultima lettura del catalogo ha lasciato fuori, coi motivi:
 * la diagnosi di Aspetto. Vuoto finché il catalogo non è letto. Il tema
 * collegato non c'è: la sua diagnosi è in `linkedTheme()`.
 */
export function themeRejections(): readonly ThemeRejection[] {
  const id = linked?.link.id ?? null;
  return id === null ? catalogRejections : catalogRejections.filter((rejection) => rejection.id !== id);
}

// --- il tema collegato (PA T37) ---------------------------------------------
//
// Una cartella che l'host legge al suo posto e guarda: a ogni salvataggio
// arriva `fub://theme-changed` con lo stato della cartella. Se il tema è quello
// in uso o in anteprima si rilegge e si rimonta; un fascio nuovo rifiutato
// (dal cancello della shell o dalle porte dell'host) **lascia l'ultimo buono**:
// i fasci di `catalogPayloads` restano quelli, e ogni `apply` rimonta loro.
// Un rimontaggio alla volta: un evento che arriva mentre uno è in volo aspetta,
// e di quelli che aspettano vale l'ultimo.

/** Il tema collegato visto dalla shell: lo stato dell'host e la sua storia qui. */
export interface LinkedThemeStatus {
  /** Lo stato dell'ultimo campanello o dell'ultima domanda all'host. */
  readonly link: ThemeLink;
  /** Da quando questa finestra lo sa collegato. */
  readonly since: number;
  /** L'ultimo rimontaggio riuscito, coi file salvati. */
  readonly reloaded: { readonly at: number; readonly changed: readonly string[] } | null;
  /** L'ora dell'ultimo fascio buono, `null` se non ce n'è stato uno. */
  readonly goodAt: number | null;
  /** L'ora dell'ultimo tentativo non riuscito. */
  readonly attemptAt: number | null;
  /** I motivi del cancello della shell, se l'ultimo tentativo li ha avuti. */
  readonly rejection: ThemeRejection | null;
}

let linked: LinkedThemeStatus | null = null;
/// Cambia a ogni collegamento e scollegamento: un rimontaggio cominciato prima
/// non scrive più niente.
let linkGeneration = 0;
let linkInFlight = false;
let linkWaiting: ThemeLink | null = null;
/// La cartella collegata secondo l'ultima risposta dell'host: `undefined`
/// finché non l'ha detto, `null` dopo «Scollega». Un campanello per un'altra
/// cartella (partito prima dello scollegamento) non rimonta niente.
let knownLinkFolder: string | null | undefined = undefined;

/** Il tema collegato com'è adesso per la shell, `null` se non ce n'è uno. */
export function linkedTheme(): LinkedThemeStatus | null {
  return linked;
}

function updateLinked(link: ThemeLink, patch: Partial<Omit<LinkedThemeStatus, "link">> = {}): void {
  const same = linked !== null && linked.link.folder === link.folder;
  const base: LinkedThemeStatus = same
    ? linked!
    : { link, since: Date.now(), reloaded: null, goodAt: null, attemptAt: null, rejection: null };
  linked = { ...base, ...patch, link };
}

/// I temi in sviluppo che una lettura del catalogo ha rifiutato tornano con
/// l'ultimo fascio buono, se c'era: un salvataggio a metà non toglie il tema.
function keepLastGoodLinked(listed: ThemeInfo[], accepted: ThemeInfo[], payloads: Map<string, ThemePayload>): void {
  for (const info of listed) {
    if (info.trust !== "development" || accepted.some((theme) => theme.manifest.id === info.manifest.id)) continue;
    const good = installedThemes.find((theme) => theme.manifest.id === info.manifest.id && theme.trust === "development");
    if (!good) continue;
    const lights = good.manifest.lights.map((light) => catalogPayloads.get(`${good.manifest.id}:${light}`));
    if (lights.some((payload) => payload === undefined)) continue;
    accepted.push(good);
    for (const payload of lights) payloads.set(`${good.manifest.id}:${payload!.light}`, payload!);
  }
}

/// Toglie dal catalogo i temi in sviluppo (ce n'è al più uno) e i loro fasci.
function dropLinkedFromCatalog(): void {
  for (const info of installedThemes.filter((theme) => theme.trust === "development")) {
    for (const light of info.manifest.lights) catalogPayloads.delete(`${info.manifest.id}:${light}`);
  }
  installedThemes = installedThemes.filter((theme) => theme.trust !== "development");
}

function linkSettled(): void {
  emit("theme-link");
}

/**
 * Chiede all'host com'è il tema collegato (Aspetto, l'avvio). `null` se
 * nessuna cartella è collegata o la modalità sviluppatore è spenta.
 */
export async function refreshThemeLink(): Promise<LinkedThemeStatus | null> {
  const generation = linkGeneration;
  const link = await api.themeLink();
  if (generation !== linkGeneration) return linked;
  knownLinkFolder = link?.folder ?? null;
  if (link === null) {
    linked = null;
    return null;
  }
  updateLinked(link);
  adoptCatalogVerdict(link);
  return linked;
}

/// Ciò che l'ultima lettura del catalogo ha deciso del tema collegato, se la
/// storia di questa finestra non lo sa ancora: preso (l'ultimo buono è di
/// adesso) o rifiutato coi motivi del cancello.
function adoptCatalogVerdict(link: ThemeLink): void {
  if (linked === null || linked.goodAt !== null || linked.attemptAt !== null || link.id === null) return;
  const accepted = installedThemes.some((theme) => theme.manifest.id === link.id && theme.trust === "development");
  if (accepted) {
    updateLinked(link, { goodAt: Date.now() });
    return;
  }
  const rejection = catalogRejections.find((old) => old.id === link.id) ?? null;
  if (rejection !== null) updateLinked(link, { attemptAt: rejection.at, rejection });
}

/**
 * Un collegamento nuovo (`link_theme_folder`) o uno scollegamento: la storia
 * di prima non vale più, il catalogo si rilegge e chi è in uso si rimonta.
 */
export async function themeLinkChanged(link: ThemeLink | null): Promise<void> {
  linkGeneration += 1;
  linkWaiting = null;
  linked = null;
  knownLinkFolder = link?.folder ?? null;
  if (link !== null) updateLinked(link);
  await reloadThemeCatalog().catch(() => []);
  if (link !== null) adoptCatalogVerdict(link);
  linkSettled();
}

/** Il campanello `fub://theme-changed`: un rimontaggio in volo, al più uno che aspetta. */
export function themeFolderChanged(link: ThemeLink): Promise<void> {
  if (knownLinkFolder !== undefined && knownLinkFolder !== link.folder) return Promise.resolve();
  if (linkInFlight) {
    linkWaiting = link;
    return Promise.resolve();
  }
  return runLinked(link);
}

async function runLinked(link: ThemeLink): Promise<void> {
  linkInFlight = true;
  const epoch = catalogEpoch;
  try {
    await remountLinked(link, epoch, linkGeneration);
  } finally {
    linkInFlight = false;
    const next = linkWaiting;
    linkWaiting = null;
    if (next !== null && epoch === catalogEpoch) await runLinked(next);
  }
}

/// Il tema mostrato adesso: quello in anteprima, o quello scelto.
function shownThemeId(): string {
  return previewSelection?.id ?? selectedThemeId;
}

async function remountLinked(link: ThemeLink, epoch: number, generation: number): Promise<void> {
  const current = (): boolean => epoch === catalogEpoch && generation === linkGeneration;
  const at = Date.now();
  const id = link.id;
  const name = link.name ?? link.id ?? "";
  if (link.state === "missing") {
    const wasShown = id !== null && shownThemeId() === id;
    updateLinked(link, { attemptAt: at, rejection: null });
    dropLinkedFromCatalog();
    if (previewSelection?.id === id) previewSelection = null;
    if (wasShown) notify(t("theme.linked.missing", { series: series.manifest.name }), "guasto");
    await reread();
    if (current()) linkSettled();
    return;
  }
  if (link.state === "collision") {
    updateLinked(link, { attemptAt: at, rejection: null });
    if (previewSelection?.id === id) previewSelection = null;
    await reloadThemeCatalog().catch(() => []);
    if (current()) linkSettled();
    return;
  }
  if (link.state !== "ready" || id === null) {
    // Le porte dell'host hanno rifiutato il salvataggio (un manifest a metà),
    // o il disco non legge: resta l'ultimo buono, e la diagnosi lo dice.
    updateLinked(link, { attemptAt: at, rejection: null });
    notify(plural(1, "theme.linked.rejected.one", "theme.linked.rejected", { name }), "guasto");
    linkSettled();
    return;
  }

  let info: ThemeInfo | undefined;
  const payloads: ThemePayload[] = [];
  let rejection: ThemeRejection | null = null;
  try {
    const listed = await api.listThemes();
    if (!current()) return;
    info = listed.find((theme) => theme.manifest.id === id && theme.trust === "development");
    if (info === undefined) throw new Error("tema assente dall'inventario");
    const contrast = effectiveContrast(contrastChoice, mediaMatches(CONTRAST_QUERY, false));
    for (const light of info.manifest.lights) {
      const payload = await api.readTheme(id, light);
      if (!current()) return;
      if (payload.manifest.id !== id || payload.light !== light) throw new Error("risposta del canale non coerente");
      const reasons = validateThemeBundle(themeBundle(payload, light, contrast), light);
      if (reasons.length > 0) {
        rejection = { id, name: info.manifest.name, light, reasons, at };
        break;
      }
      payloads.push(payload);
    }
  } catch (error) {
    if (!current()) return;
    rejection = { id, name, light: null, reasons: [`fascio non leggibile: ${errorDetail(error)}`], at };
  }
  if (!current()) return;
  if (rejection !== null || info === undefined) {
    const reasons = rejection?.reasons ?? [];
    updateLinked(link, { attemptAt: at, rejection });
    notify(
      plural(Math.max(1, reasons.length), "theme.linked.rejected.one", "theme.linked.rejected", {
        name: rejection?.name ?? name,
      }),
      "guasto",
    );
    linkSettled();
    return;
  }
  // Il fascio nuovo è buono: prende il posto del vecchio, e chi lo mostra lo
  // rimonta (`reread` rifà anche la scelta: un tema che all'avvio non reggeva
  // e ora regge torna quello scelto).
  dropLinkedFromCatalog();
  installedThemes = [...installedThemes, info];
  for (const payload of payloads) catalogPayloads.set(`${id}:${payload.light}`, payload);
  catalogRejections = catalogRejections.filter((old) => old.id !== id);
  updateLinked(link, { goodAt: at, reloaded: { at, changed: link.changed }, attemptAt: null, rejection: null });
  await reread();
  if (current()) linkSettled();
}

/// All'avvio, con la modalità sviluppatore accesa: se la cartella collegata
/// non c'è più lo si dice, una volta, e l'avvio non si ferma.
async function checkLinkAtStart(epoch: number): Promise<void> {
  const developer = settingEntries.some((entry) => entry.spec.key === DEVELOPER_MODE && entry.value === true);
  if (!developer) return;
  const status = await refreshThemeLink().catch(() => null);
  if (epoch !== catalogEpoch || status === null) return;
  if (status.link.state === "missing") {
    notify(t("theme.linked.missing_at_start", { folder: status.link.folder, series: series.manifest.name }), "guasto");
  }
  linkSettled();
}

/**
 * Il cancello del catalogo sulla cartella di un tema **prima** di installarla
 * (`check_theme_folder`): gli stessi controlli di `readCatalog`, sullo stesso
 * fascio e col contrasto di adesso, così un tema che il catalogo lascerebbe
 * fuori non arriva mai nella cartella dei temi. Una voce per luce rifiutata,
 * coi motivi così come sono; vuoto vuol dire che il catalogo lo prenderebbe.
 *
 * La pelle e i byte degli asset che il cancello legge (i caratteri e il set di
 * icone) arrivano una volta per tutte le luci; gli altri asset arrivano per
 * nome, luce per luce, e il cancello ne controlla solo la presenza: qui stanno
 * nel fascio senza byte. Il fascio serve solo al cancello, non si monta.
 */
export function vetThemeFolder(
  check: Extract<ThemeFolderCheck, { outcome: "ready" }>,
): { light: Theme; reasons: string[] }[] {
  const contrast = effectiveContrast(contrastChoice, mediaMatches(CONTRAST_QUERY, false));
  const rejected: { light: Theme; reasons: string[] }[] = [];
  for (const light of check.manifest.lights) {
    const read = check.lights.find((candidate) => candidate.light === light);
    if (read === undefined) {
      rejected.push({ light, reasons: [`fascio non leggibile: ${check.manifest.id}:${light}`] });
      continue;
    }
    const assets: Record<string, readonly number[]> = {};
    for (const name of read.named) assets[name] = [];
    Object.assign(assets, check.assets);
    const payload: ThemePayload = { manifest: check.manifest, light, sheet: read.sheet, skin: check.skin, assets };
    const reasons = validateThemeBundle(themeBundle(payload, light, contrast), light);
    if (reasons.length > 0) rejected.push({ light, reasons });
  }
  return rejected;
}

/**
 * Rilegge il catalogo dei temi dopo un'installazione: un tema nuovo entra (o
 * resta fuori coi suoi motivi), e se quello sostituito è in uso si rimonta
 * col fascio nuovo. Una lettura in volo è superata: risponde questa.
 */
export async function reloadThemeCatalog(): Promise<ThemeInfo[]> {
  catalogRound += 1;
  catalogLoaded = false;
  catalogRequest = null;
  await reread();
  return readCatalog();
}

/** I temi installati già validati dal backend, per il pannello dedicato. */
export async function themeCatalog(): Promise<ThemeInfo[]> {
  return readCatalog();
}

/** Core is bundled with the host. Installed themes are not executable code,
 * but remain community-owned CSS subject to the theme-1 trust gate. */
export function themeTrust(id: string): "core" | "community" | "development" {
  if (id === SERIES_THEME_ID) return "core";
  const info = installedThemes.find((theme) => theme.manifest.id === id);
  return info?.trust === "development" ? "development" : "community";
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
      throw new Error(t("errors.theme.unavailable"));
    }
  }
  const generation = ++selectionGeneration;
  previewSelection = { id, light };
  await apply();
  if (generation !== selectionGeneration) return;
  if (!mountedVariant.startsWith(id + ":" + light + ":")) {
    previewSelection = null;
    await apply();
    throw new Error(t("errors.theme.preview_unavailable"));
  }
}


/** Seleziona un tema e persiste insieme il suo id e la luce esplicita. */
export async function selectTheme(id: string, light: Theme | ""): Promise<void> {
  if (id !== SERIES_THEME_ID) {
    const info = installedThemes.find((theme) => theme.manifest.id === id);
    if (!info || !info.manifest.lights.includes(light as Theme)) {
      throw new Error(t("errors.theme.unavailable"));
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
  barsChoice = "light";
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
        bars?: unknown;
      };
      contrastChoice = typeof parsed.contrast === "string" ? parsed.contrast : "";
      preferences = normalizedPreferences(parsed.preferences ?? {});
      barsChoice = barsOf(parsed.bars);
    }
  } catch {
    themeChoice = "";
    selectedThemeId = SERIES_THEME_ID;
    contrastChoice = "";
    barsChoice = "light";
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
  catalogRound += 1;
  catalogLoaded = false;
  catalogRequest = null;
  installedThemes = [];
  catalogPayloads = new Map<string, ThemePayload>();
  catalogRejections = [];
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
  lifetime.add(
    onEvent("setting_changed", (event) => {
      // La modalità sviluppatore e la cartella collegata cambiano i temi che
      // l'host elenca: il catalogo si rilegge.
      if (event.key === DEVELOPER_MODE || event.key === DEVELOPER_THEME_FOLDER_KEY) {
        // La cartella può essere cambiata da un'altra finestra: si richiede.
        knownLinkFolder = undefined;
        if (event.key === DEVELOPER_MODE) {
          linkGeneration += 1;
          linked = null;
        }
        void reloadThemeCatalog().catch(() => []).finally(linkSettled);
      } else void reread();
    }),
  );
  lifetime.add(on("vault", () => void reread()));
  linked = null;
  knownLinkFolder = undefined;
  linkGeneration += 1;
  linkWaiting = null;
  listenThemeFolder(lifetime);
  themeSettled = false;
  const epoch = catalogEpoch;
  void reread().finally(() => {
    if (epoch === catalogEpoch) settleTheme();
    void checkLinkAtStart(epoch);
  });
}

/// Il campanello del tema collegato vive quanto il montaggio del tema. Un host
/// che non lo serve (un banco senza la porta) non ferma niente.
function listenThemeFolder(lifetime: Lifetime): void {
  let stop: (() => void) | null = null;
  lifetime.add(() => {
    stop?.();
    stop = null;
  });
  void Promise.resolve()
    .then(() => api.onThemeChanged((link) => void themeFolderChanged(link)))
    .then((unlisten) => {
      if (lifetime.closed) unlisten();
      else stop = unlisten;
    })
    .catch(() => undefined);
}
