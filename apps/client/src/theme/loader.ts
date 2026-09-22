// Il caricatore del foglio, della pelle e dei caratteri (§29.1, §31.3).
//
// Montare un CSS qui vuol dire **sostituire**: prima si toglie quello che c'è,
// poi si appende il nuovo. Il vecchio modo — impilare fogli con `disabled` o
// con un `id` da sovrascrivere in cascata — metteva in gara la specificità di
// due temi e vinceva l'ultimo per una ragione che nessuno aveva scritto; qui
// il banco resta com'è: **un elemento montato per canale, mai due**. È la
// stessa promessa del loader della logica di presentazione (§2.2), fatta per
// il CSS: ciò che non è montato non vale, quindi non può nemmeno interferire.
//
// I tre strati viaggiano su canali separati (`data-fub="caratteri"`,
// `data-fub="foglio"`, `data-fub="pelle"`), perché crescono separatamente: la
// pelle di un tema di terzi sarà un file suo, il foglio un altro, e i
// caratteri un terzo ancora (§31.3). La struttura, che non si tematizza, non
// passa da qui: è importata da `main.ts` e resta sempre montata.
//
// **L'ordine è dichiarato, non una conseguenza di quando si monta.** Finché i
// canali erano due, appendere in coda bastava — l'ordine di montaggio era
// sempre lo stesso ordine di lettura. Con un terzo canale (e presto un quarto,
// lo strato delle preferenze della persona, §31.6) non è più vero: chi monta
// prima o dopo dipende dall'ordine di avvio di `theme.ts`, e la cascata non
// deve dipendere da quello. `ORDINE` dice come i canali si susseguono nel
// documento — i caratteri per primi, perché non dipendono da nessun altro
// strato e ogni cosa dopo di loro può ridichiarare `font-family` a parità di
// specificità; la pelle per ultima, perché veste i componenti sopra ai token
// che il foglio dichiara — e `monta()` inserisce ogni nuovo elemento al posto
// giusto anche se i canali si montano in un ordine diverso.
//
// Il testo arriva come stringa (`?raw`), non come CSS bundlato: il bundle
// saprebbe solo *aggiungere* fogli al documento, e il punto è sostituirli. I
// test del banco (`theme/loader.test.ts`) guardano qui dentro.

import { THEME_ENGINE, type ThemeManifest, type ThemeLight } from "../host/contract";
import { reportThemeTrouble, type ThemeTrouble } from "../ui/notify";
import {
  themeAssetReferences,
  themeAssetUrls,
  themeCssViolations,
  type ThemeAssetReference,
} from "../ui/sanitize-css";
import { contrast } from "./contrast";
import { REQUIRED_THEME_ROLES, THEME_CONTRAST_PAIRS } from "./contrast-fixture";
import { HOOKS } from "./serie/anatomia";

export type Layer = "caratteri" | "foglio" | "pelle" | "preferenze";

/** I soli token che le preferenze della persona possono ridichiarare. */
export const PREFERENCE_TOKENS = [
  "space-1",
  "space-2",
  "space-3",
  "space-4",
  "space-5",
  "space-6",
  "space-7",
  "space-8",
  "space-9",
  "space-10",
  "font-reading",
  "text-reading",
  "leading-relaxed",
  "content-width",
  "accent",
  "accent-soft",
  "accent-contrast",
  "focus-ring",
  "graph-node-active",
] as const;

export type PreferenceToken = (typeof PREFERENCE_TOKENS)[number];

export const THEME_MOTION = ["opacity", "transform"] as const;

/** Forma non fidata letta dal bundle: il cancello controlla anche i literal. */
export type ThemeBundleManifest = Omit<ThemeManifest, "engine" | "lights"> & {
  readonly engine: string;
  readonly lights: readonly string[];
  readonly motion: readonly string[];
};

export interface ThemeBundle {
  readonly manifest: ThemeBundleManifest;
  readonly sheet: string;
  readonly skin?: string;
  /** Asset names are validated before mount; their bytes stay behind the host boundary. */
  readonly assets: Readonly<Record<string, unknown>>;
}

export type ThemeMountResult =
  | { readonly mounted: true }
  | { readonly mounted: false; readonly trouble: ThemeTrouble };

export type ThemeTroubleReporter = (trouble: ThemeTrouble) => void;

/** L'ordine dichiarato della cascata. Le preferenze vengono dopo ogni pelle. */
const ORDER: readonly Layer[] = ["caratteri", "foglio", "pelle", "preferenze"];
const PREFERENCE_ALLOWLIST = new Set<string>(PREFERENCE_TOKENS);

/** Sostituisce uno strato e lo inserisce nel punto dichiarato della cascata. */
function replace(text: string, layer: Layer): void {
  const head = document.head;
  for (const el of head.querySelectorAll<HTMLStyleElement>(
    `style[data-fub="${layer}"]`,
  )) {
    el.remove();
  }
  const el = document.createElement("style");
  el.dataset.fub = layer;
  el.textContent = text;

  const position = ORDER.indexOf(layer);
  const mounted = head.querySelectorAll<HTMLStyleElement>("style[data-fub]");
  const next = [...mounted].find(
    (existing) => ORDER.indexOf(existing.dataset.fub as Layer) > position,
  );
  if (next) head.insertBefore(el, next);
  else head.append(el);
}

function style(text: string, layer: "foglio" | "pelle"): HTMLStyleElement {
  const element = document.createElement("style");
  element.dataset.fub = layer;
  element.textContent = text;
  return element;
}
export class ThemeAssetMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeAssetMaterializationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  if (typeof globalThis.btoa === "function") return globalThis.btoa(binary);

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    encoded += second === undefined ? "=" : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    encoded += third === undefined ? "=" : alphabet[third & 63];
  }
  return encoded;
}

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return new Uint8Array(value);
  }
  return null;
}

function assetMime(name: string): string {
  const path = name.split(/[?#]/, 1)[0]!.toLowerCase();
  const extension = path.slice(path.lastIndexOf(".") + 1);
  const known: Readonly<Record<string, string>> = {
    avif: "image/avif",
    bmp: "image/bmp",
    css: "text/css",
    gif: "image/gif",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    otf: "font/otf",
    svg: "image/svg+xml",
    ttf: "font/ttf",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  return known[extension] ?? "application/octet-stream";
}

function dataUrl(name: string, value: unknown): string | null {
  if (typeof value === "string") {
    if (/^data:/i.test(value)) return value;
    const bytes = new TextEncoder().encode(value);
    return `data:${assetMime(name)};base64,${base64(bytes)}`;
  }

  const directBytes = bytesOf(value);
  if (directBytes) return `data:${assetMime(name)};base64,${base64(directBytes)}`;
  if (!isRecord(value)) return null;

  for (const key of ["url", "dataUrl", "data_url"]) {
    if (typeof value[key] === "string" && /^data:/i.test(value[key] as string)) {
      return value[key] as string;
    }
  }

  const mime =
    (typeof value.mime === "string" && value.mime) ||
    (typeof value.mediaType === "string" && value.mediaType) ||
    (typeof value.media_type === "string" && value.media_type) ||
    (typeof value.contentType === "string" && value.contentType) ||
    (typeof value.content_type === "string" && value.content_type) ||
    assetMime(name);
  const encoded = value.encoding === "base64" || value.base64 === true;

  if (typeof value.base64 === "string") return `data:${mime};base64,${value.base64}`;
  if (typeof value.data === "string") {
    if (/^data:/i.test(value.data)) return value.data;
    return encoded
      ? `data:${mime};base64,${value.data}`
      : `data:${mime};base64,${base64(new TextEncoder().encode(value.data))}`;
  }

  const bytes = bytesOf(value.bytes ?? value.content ?? value.value);
  return bytes ? `data:${mime};base64,${base64(bytes)}` : null;
}

function materializationRange(reference: ThemeAssetReference, css: string): [number, number] {
  const start = Math.max(0, Math.min(css.length, reference.start));
  const end = Math.max(start, Math.min(css.length, reference.end));
  return [start, end];
}

/** Replaces only URL payload ranges already accepted by the sanitizer. */
export function materializeThemeCss(
  css: string,
  assets: Readonly<Record<string, unknown>>,
  assetNamespace?: string,
): string {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const reference of themeAssetReferences(css)) {
    if (reference.value.startsWith("#")) continue;
    if (assetNamespace && !reference.value.startsWith(assetNamespace)) continue;
    if (!Object.prototype.hasOwnProperty.call(assets, reference.value)) {
      throw new ThemeAssetMaterializationError(`asset ${reference.value} non presente nel fascio`);
    }
    const materialized = dataUrl(reference.value, assets[reference.value]);
    if (!materialized) {
      throw new ThemeAssetMaterializationError(`asset ${reference.value} non materializzabile`);
    }
    const [start, end] = materializationRange(reference, css);
    replacements.push({ start, end, value: materialized });
  }
  if (replacements.length === 0) return css;

  replacements.sort((left, right) => right.start - left.start || right.end - left.end);
  let output = css;
  let lowerBound = css.length + 1;
  for (const replacement of replacements) {
    if (replacement.end > lowerBound) continue;
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
    lowerBound = replacement.start;
  }
  return output;
}

/** Sostituisce foglio e pelle in una sola commit, dopo che ogni cancello è verde. */
function replaceTheme(sheet: string, skin: string | undefined): void {
  const head = document.head;
  const previous = [...head.querySelectorAll<HTMLStyleElement>(
    'style[data-fub="foglio"], style[data-fub="pelle"]',
  )];
  const next = [style(sheet, "foglio"), ...(skin === undefined ? [] : [style(skin, "pelle")])];
  const preference = head.querySelector<HTMLStyleElement>('style[data-fub="preferenze"]');
  try {
    for (const element of next) head.insertBefore(element, preference);
  } catch (error) {
    for (const element of next) element.remove();
    throw error;
  }
  for (const element of previous) element.remove();
}

function manifestReasons(manifest: ThemeBundleManifest, light: ThemeLight): string[] {
  const reasons: string[] = [];
  if (manifest.id.trim() === "") reasons.push("manifest: id mancante");
  if (manifest.name.trim() === "") reasons.push("manifest: nome mancante");
  if (manifest.version.trim() === "") reasons.push("manifest: versione mancante");
  if (manifest.engine !== THEME_ENGINE) {
    reasons.push(`manifest: engine ${manifest.engine || "<vuoto>"} incompatibile, serve ${THEME_ENGINE}`);
  }

  const validLights = manifest.lights.filter((value) => value === "dark" || value === "light");
  if (manifest.lights.length === 0) reasons.push("manifest: nessuna luce offerta");
  for (const value of manifest.lights) {
    if (value !== "dark" && value !== "light") reasons.push(`manifest: luce ${value} sconosciuta`);
  }
  if (new Set(validLights).size !== validLights.length) reasons.push("manifest: luci duplicate");
  if (!validLights.includes(light)) reasons.push(`manifest: luce ${light} non offerta`);

  const expectedNamespace = `theme://${manifest.id}/`;
  if (manifest.asset_namespace !== expectedNamespace) {
    reasons.push(
      `manifest: namespace asset ${manifest.asset_namespace || "<vuoto>"} non coincide con ${expectedNamespace}`,
    );
  }

  const motion = new Set(manifest.motion);
  if (manifest.motion.length !== THEME_MOTION.length ||
      THEME_MOTION.some((property) => !motion.has(property))) {
    reasons.push("manifest: il moto deve dichiarare soltanto opacity e transform");
  }
  return reasons;
}

function tokensOf(css: string): Record<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return Object.fromEntries(
    [...withoutComments.matchAll(/--([_a-zA-Z][_a-zA-Z0-9-]*)\s*:\s*([^;{}]+);/g)].map(
      (match) => [match[1], match[2].trim()],
    ),
  );
}

function contrastReasons(sheet: string): string[] {
  const tokens = tokensOf(sheet);
  const reasons: string[] = [];
  for (const [ink, background, threshold, where] of THEME_CONTRAST_PAIRS) {
    const foreground = tokens[ink];
    const surface = tokens[background];
    if (foreground === undefined || surface === undefined) continue;
    try {
      const ratio = contrast(foreground, surface);
      if (ratio < threshold) {
        reasons.push(
          `contrasto: --${ink} su --${background} è ${ratio.toFixed(2)}:1, sotto ${threshold}:1 (${where})`,
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reasons.push(`contrasto: --${ink} su --${background} non misurabile: ${detail}`);
    }
  }
  return reasons;
}

/** Tutti i motivi di rifiuto; nessun cancello accorcia il report del successivo. */
export function validateThemeBundle(bundle: ThemeBundle, light: ThemeLight): string[] {
  const reasons = manifestReasons(bundle.manifest, light);
  if (typeof bundle.sheet !== "string" || bundle.sheet.trim() === "") {
    reasons.push("fascio: foglio mancante");
  }
  if (bundle.skin !== undefined && bundle.skin.trim() === "") {
    reasons.push("fascio: pelle vuota");
  }

  const policy = {
    assetNamespace: bundle.manifest.asset_namespace,
    allowedHooks: HOOKS,
    requiredRoles: REQUIRED_THEME_ROLES,
  };
  if (typeof bundle.sheet === "string") {
    for (const violation of themeCssViolations(bundle.sheet, policy)) {
      reasons.push(
        `foglio: ${violation.code} (${violation.line}:${violation.column}): ${violation.detail}`,
      );
    }
    reasons.push(...contrastReasons(bundle.sheet));
  }
  if (bundle.skin !== undefined) {
    for (const violation of themeCssViolations(bundle.skin, { ...policy, kind: "skin" })) {
      reasons.push(
        `pelle: ${violation.code} (${violation.line}:${violation.column}): ${violation.detail}`,
      );
    }
  }

  const assets = bundle.assets && typeof bundle.assets === "object" ? bundle.assets : {};
  if (assets !== bundle.assets) reasons.push("fascio: inventario asset mancante");
  for (const asset of Object.keys(assets)) {
    if (!asset.startsWith(bundle.manifest.asset_namespace)) {
      reasons.push(`asset: ${asset} fuori da ${bundle.manifest.asset_namespace || "<namespace vuoto>"}`);
    }
  }
  const referenced = themeAssetUrls(`${bundle.sheet}\n${bundle.skin ?? ""}`);
  for (const asset of referenced) {
    if (!asset.startsWith(bundle.manifest.asset_namespace)) continue;
    if (!Object.prototype.hasOwnProperty.call(assets, asset)) {
      reasons.push(`asset: ${asset} nominato dal CSS ma assente dal fascio`);
      continue;
    }
    if (!dataUrl(asset, assets[asset])) {
      reasons.push(`asset: ${asset} non materializzabile`);
    }
  }
  return reasons;
}

function rejectTheme(
  name: string,
  reasons: readonly string[],
  report: ThemeTroubleReporter,
): ThemeMountResult {
  const trouble: ThemeTrouble = { type: "theme", theme: name || "<senza nome>", reasons };
  report(trouble);
  return { mounted: false, trouble };
}

/** Valida l'intero fascio, materializza gli asset e solo allora sostituisce i due strati. */
export function mountThemeBundle(
  bundle: ThemeBundle,
  light: ThemeLight,
  report: ThemeTroubleReporter = reportThemeTrouble,
): ThemeMountResult {
  const reasons = validateThemeBundle(bundle, light);
  if (reasons.length > 0) return rejectTheme(bundle.manifest.name, reasons, report);
  try {
    const sheet = materializeThemeCss(bundle.sheet, bundle.assets, bundle.manifest.asset_namespace);
    const skin = bundle.skin === undefined
      ? undefined
      : materializeThemeCss(bundle.skin, bundle.assets, bundle.manifest.asset_namespace);
    replaceTheme(sheet, skin);
    return { mounted: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return rejectTheme(bundle.manifest.name, [`montaggio atomico fallito: ${detail}`], report);
  }
}

/** Monta uno strato del tema. Le preferenze non accettano CSS libero. */
export function mount(text: string, layer: Exclude<Layer, "preferenze">): void {
  replace(text, layer);
}

/** Serializza e monta il canale chiuso delle preferenze. */
export function mountPreferences(tokens: Readonly<Record<string, string>>): void {
  for (const [token, value] of Object.entries(tokens)) {
    if (!PREFERENCE_ALLOWLIST.has(token)) {
      throw new Error(`il token --${token} non è una preferenza ammessa`);
    }
    if (value.trim() === "" || /[;{}\n\r]/.test(value)) {
      throw new Error(`il valore di --${token} non è una dichiarazione CSS sicura`);
    }
  }

  const declarations = PREFERENCE_TOKENS
    .filter((token) => Object.prototype.hasOwnProperty.call(tokens, token))
    .map((token) => `  --${token}: ${tokens[token]};`);
  replace([":root {", ...declarations, "}", ""].join("\n"), "preferenze");
}

/** Quanti elementi di uno strato sono montati. Nel banco dev'essere sempre 1
 *  dopo ogni `monta`; 0 significa «nessun tema», 2 significa che qualcuno ha
 *  ripreso ad accatastare. */
export function count(layer: Layer): number {
  return document.head.querySelectorAll(`style[data-fub="${layer}"]`).length;
}
