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
// Un tema che eredita dalla serie (`extends`, ADR 0240) non sostituisce la
// pelle di serie: la lascia in `pelle` e mette la sua in un canale proprio,
// `pelle-tema`, subito dopo.
//
// I caratteri di un tema (`fonts` nel manifest) vanno in `caratteri-tema`,
// subito dopo quelli di serie. Il CSS di un tema non può scrivere
// `@font-face` (un `src:` scritto a mano potrebbe chiamare la rete): le regole
// le scrive questo file, coi valori del manifest e l'URL `data:` del file, e la
// pelle usa la famiglia per nome. Si sostituiscono nello stesso giro del
// foglio e delle pelli, e un tema che non ne porta svuota il canale.
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

import type { ThemeManifest, ThemeLight } from "../host/contract";
import { reportThemeTrouble, type ThemeTrouble } from "../ui/notify";
import {
  themeAssetReferences,
  themeAssetUrls,
  themeCssViolations,
  type ContentGate,
  type ThemeCssPolicy,
  type ThemeCssViolation,
  type ThemeCssVocabulary,
} from "../ui/sanitize-css";
import { contrast } from "./contrast";
import { mountMirroredOptions, mountedThemeOptions, type MirroredOptions } from "./options";
import type { ContrastPair } from "./contrast-fixture";
import { THEME_2_PROFILE } from "./scrittoio/profile";
import { t } from "../i18n/strings";
import { THEME_FONT_LIMITS, themeFontFault, type ThemeFontFault } from "../rules/mirrored";

export type Layer =
  | "caratteri"
  | "caratteri-tema"
  | "foglio"
  | "pelle"
  | "pelle-tema"
  | "preferenze"
  | "snippets";

/**
 * Il **profilo** contro cui il cancello misura un fascio: quale motore, quali
 * hook, quali ruoli, quali coppie di contrasto e quali token può ridichiarare
 * la persona.
 *
 * Fin qui erano quattro costanti importate in cima al file, cioè un solo tema
 * possibile per costruzione. Un profilo le tiene insieme perché insieme
 * cambiano: una shell con un'altra anatomia ha altri hook **e** altri ruoli,
 * e un cancello che ne aggiornasse metà accetterebbe pelli che non vestono
 * niente. Di serie è `theme-2`, quello dello Scrittoio; un banco può
 * dichiararne un altro e tornare indietro.
 */
export interface ThemeProfile {
  readonly engine: string;
  readonly hooks: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly contrastPairs: readonly ContrastPair[];
  /** Le coppie dei ruoli facoltativi: si contano solo se il tema li dichiara. */
  readonly optionalPairs?: readonly ContrastPair[];
  readonly preferenceTokens: readonly string[];
  /** Assente = il vocabolario comune, quello dei frammenti CSS. */
  readonly vocabulary?: ThemeCssVocabulary;
  /** Le classi di contenuto che una pelle veste soltanto sotto `.look-tema`:
   * valgono per i fogli, le pelli e i frammenti. */
  readonly gate?: ContentGate;
}


let profile: ThemeProfile = THEME_2_PROFILE;

/** Il profilo in vigore: uno per finestra, deciso da chi compone la shell. */
export function themeProfile(): ThemeProfile {
  return profile;
}

/**
 * Dichiara il profilo della shell. Rende il modo di tornare al precedente: un
 * banco che monta due shell di seguito non deve ereditare il profilo dell'altra.
 */
export function declareThemeProfile(next: ThemeProfile): () => void {
  const previous = profile;
  profile = next;
  return () => {
    if (profile === next) profile = previous;
  };
}

/** Forma non fidata letta dal bundle: il cancello controlla anche i literal. */
export type ThemeBundleManifest = Omit<ThemeManifest, "engine" | "lights" | "motion"> & {
  readonly engine: string;
  readonly lights: readonly string[];
  readonly motion?: readonly string[];
};

export interface ThemeBundle {
  readonly manifest: ThemeBundleManifest;
  /** Per un tema che eredita e non porta il foglio di questa luce, chi compone
   * il fascio ci mette quello di serie della stessa luce e dello stesso
   * contrasto: il cancello lo misura come ogni altro foglio. */
  readonly sheet: string;
  readonly skin?: string;
  /** Asset names are validated before mount; their bytes stay behind the host boundary. */
  readonly assets: Readonly<Record<string, unknown>>;
  /**
   * Ciò che un tema con `extends` eredita e che resta montato sotto di lui: la
   * pelle di serie, nel canale `pelle`. La sua pelle va in `pelle-tema`, dopo.
   * Lo dà chi conosce la serie (`theme.ts`); un fascio che dichiara `extends`
   * senza portarlo è rifiutato, perché non si saprebbe cosa resta sotto.
   */
  readonly inherited?: { readonly skin: string };
}

export type ThemeMountResult =
  | { readonly mounted: true }
  | { readonly mounted: false; readonly trouble: ThemeTrouble };

export type ThemeTroubleReporter = (trouble: ThemeTrouble) => void;

/**
 * L'ordine dichiarato della cascata. I canali `-tema` stanno subito dopo il
 * loro gemello di serie: un tema che eredita lascia montata la serie e vince
 * su di lei a parità di specificità, perché viene dopo. Le preferenze vengono
 * dopo ogni pelle, i frammenti della persona per ultimi.
 */
const ORDER: readonly Layer[] = [
  "caratteri",
  "caratteri-tema",
  "foglio",
  "pelle",
  "pelle-tema",
  "preferenze",
  "snippets",
];

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

function style(text: string, layer: (typeof THEME_LAYERS)[number]): HTMLStyleElement {
  const element = document.createElement("style");
  element.dataset.fub = layer;
  element.textContent = text;
  return element;
}

/** I canali che un fascio di tema possiede: si sostituiscono tutti insieme. */
const THEME_LAYERS = ["caratteri-tema", "foglio", "pelle", "pelle-tema"] as const;

/** Il primo elemento montato che nella cascata viene dopo `layer`, o `null`. */
function mountedAfter(layer: Layer): HTMLStyleElement | null {
  const position = ORDER.indexOf(layer);
  return [...document.head.querySelectorAll<HTMLStyleElement>("style[data-fub]")].find(
    (existing) => ORDER.indexOf(existing.dataset.fub as Layer) > position,
  ) ?? null;
}

/**
 * Sostituisce caratteri, foglio e pelli del tema in una sola commit, dopo che
 * ogni cancello è verde. Senza eredità monta foglio e pelle come sempre, e
 * `pelle-tema` si toglie; con l'eredità la pelle di serie va in `pelle` e
 * quella del tema, se c'è, in `pelle-tema`. Le regole `@font-face` del tema
 * vanno in `caratteri-tema`; un tema senza caratteri lo lascia vuoto.
 */
function replaceTheme(
  fonts: string | undefined,
  sheet: string,
  skin: string | undefined,
  inherited: string | undefined,
): void {
  const head = document.head;
  const previous = [...head.querySelectorAll<HTMLStyleElement>(
    THEME_LAYERS.map((layer) => `style[data-fub="${layer}"]`).join(", "),
  )];
  const faces = fonts === undefined ? [] : [style(fonts, "caratteri-tema")];
  const next = inherited === undefined
    ? [style(sheet, "foglio"), ...(skin === undefined ? [] : [style(skin, "pelle")])]
    : [style(sheet, "foglio"), style(inherited, "pelle"), ...(skin === undefined ? [] : [style(skin, "pelle-tema")])];
  // I caratteri prima del primo canale che viene dopo di loro (di solito il
  // foglio di prima, che se ne va subito sotto); foglio e pelli prima del primo
  // canale che viene dopo i canali del tema: di solito le preferenze, ma anche
  // i frammenti quando le preferenze non ci sono ancora.
  const facesAnchor = mountedAfter("caratteri-tema");
  const anchor = mountedAfter("pelle-tema");
  try {
    for (const element of faces) head.insertBefore(element, facesAnchor);
    for (const element of next) head.insertBefore(element, anchor);
  } catch (error) {
    for (const element of [...faces, ...next]) element.remove();
    throw error;
  }
  for (const element of previous) element.remove();
}

/** La firma con cui comincia ogni file WOFF2: un controllo sui byte, locale. */
const WOFF2_SIGNATURE = [0x77, 0x4f, 0x46, 0x32];

/** La frase del cancello per un guasto della regola dei caratteri. */
const FONT_FAULT_REASON: Readonly<Record<ThemeFontFault, string>> = {
  family: `la famiglia vuole lettere e cifre ASCII, - e spazi singoli, al massimo ${THEME_FONT_LIMITS.family_chars}`,
  series_family: "è una famiglia di serie",
  reserved_family: "è una parola chiave del CSS, non una famiglia",
  file: "il file non è fonts/<nome>.woff2 fra gli asset",
  weight: `il peso dev'essere un intero fra ${THEME_FONT_LIMITS.weights[0]} e ${THEME_FONT_LIMITS.weights[1]}`,
  style: "lo stile dev'essere normal o italic",
};

/** Una voce di `fonts` come arriva dal fascio: ogni campo va controllato. */
interface UntrustedFont {
  readonly family?: unknown;
  readonly file?: unknown;
  readonly weight?: unknown;
  readonly style?: unknown;
}

function declaredFonts(manifest: ThemeBundleManifest): readonly UntrustedFont[] | null {
  const fonts: unknown = (manifest as { fonts?: unknown }).fonts;
  if (fonts === undefined) return [];
  return Array.isArray(fonts) ? fonts as UntrustedFont[] : null;
}

/**
 * Tutti i motivi per cui i caratteri del fascio non si possono montare. La
 * forma di ogni voce la decide la regola rispecchiata (`themeFontFault`, la
 * stessa dell'host per fixture); qui restano la faccia ripetuta e i byte.
 */
function fontReasons(
  manifest: ThemeBundleManifest,
  assets: Readonly<Record<string, unknown>>,
): string[] {
  const fonts = declaredFonts(manifest);
  if (fonts === null) return ["caratteri: l'elenco non è una lista"];
  const limits = THEME_FONT_LIMITS;
  const reasons: string[] = [];
  if (fonts.length > limits.fonts) {
    reasons.push(`caratteri: ${fonts.length} dichiarati, al massimo ${limits.fonts}`);
  }
  const faces = new Set<string>();
  const sizes = new Map<string, number>();
  for (const font of fonts) {
    const family = typeof font?.family === "string" ? font.family : "";
    const where = `caratteri: ${family || "<senza famiglia>"}`;
    const fault = themeFontFault(font?.family, font?.file, font?.weight, font?.style);
    if (fault !== null) {
      reasons.push(`${where}: ${FONT_FAULT_REASON[fault]}`);
      continue;
    }
    const face = `${family.toLowerCase()}|${String(font.weight)}|${String(font.style)}`;
    if (faces.has(face)) reasons.push(`${where}: la stessa faccia è dichiarata due volte`);
    faces.add(face);
    const file = String(font.file);
    const asset = `${manifest.asset_namespace}${file}`;
    const bytes = Object.prototype.hasOwnProperty.call(assets, asset) ? bytesOf(assets[asset]) : null;
    if (bytes === null) {
      reasons.push(`${where}: il file ${file} manca dal fascio`);
      continue;
    }
    if (!WOFF2_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
      reasons.push(`${where}: il file ${file} non è WOFF2`);
    }
    if (bytes.length > limits.font_bytes) {
      reasons.push(`${where}: il file ${file} supera ${limits.font_bytes} byte`);
    }
    sizes.set(file, bytes.length);
  }
  const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  if (total > limits.font_total_bytes) {
    reasons.push(`caratteri: insieme superano ${limits.font_total_bytes} byte`);
  }
  return reasons;
}

/**
 * Le regole `@font-face` dei caratteri del tema, o `undefined` se non ne
 * porta. Si chiama solo su un fascio che ha passato il cancello: la famiglia
 * sta fra virgolette senza fughe perché il cancello ne ha già fissato
 * l'alfabeto, e l'unico `src` è l'URL `data:` dei byte del file.
 */
export function themeFontFaces(
  manifest: ThemeBundleManifest,
  assets: Readonly<Record<string, unknown>>,
): string | undefined {
  const fonts = declaredFonts(manifest);
  if (fonts === null || fonts.length === 0) return undefined;
  return fonts.map((font) => {
    const bytes = bytesOf(assets[`${manifest.asset_namespace}${String(font.file)}`]) ?? [];
    return [
      "@font-face {",
      `  font-family: "${String(font.family)}";`,
      `  font-style: ${String(font.style)};`,
      `  font-weight: ${String(font.weight)};`,
      "  font-display: swap;",
      `  src: url("data:font/woff2;base64,${base64(bytes)}") format("woff2");`,
      "}",
      "",
    ].join("\n");
  }).join("\n");
}

function mimeType(asset: string): string {
  const extension = asset.slice(asset.lastIndexOf(".") + 1).toLowerCase();
  return ({
    css: "text/css",
    gif: "image/gif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
    otf: "font/otf",
    ttf: "font/ttf",
    woff: "font/woff",
    woff2: "font/woff2",
  } as Readonly<Record<string, string>>)[extension] ?? "application/octet-stream";
}

function bytesOf(value: unknown): number[] | null {
  if (value instanceof Uint8Array) return [...value];
  if (!Array.isArray(value)) return null;
  return value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ? value as number[]
    : null;
}

function base64(bytes: readonly number[]): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i]!;
    const second = bytes[i + 1];
    const third = bytes[i + 2];
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    encoded += second === undefined
      ? "=="
      : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)] + (third === undefined ? "=" : alphabet[third & 63]);
  }
  return encoded;
}

function materializeAssets(
  text: string,
  assets: Readonly<Record<string, unknown>>,
  namespace: string,
): string {
  let output = "";
  let copiedThrough = 0;
  for (const { value, start, end } of themeAssetReferences(text)) {
    const bytes = value.startsWith(namespace) ? bytesOf(assets[value]) : null;
    if (bytes === null || start < copiedThrough || end < start) continue;
    output += text.slice(copiedThrough, start);
    output += `data:${mimeType(value)};base64,${base64(bytes)}`;
    copiedThrough = end;
  }
  return output + text.slice(copiedThrough);
}

function manifestReasons(manifest: ThemeBundleManifest, light: ThemeLight): string[] {
  const reasons: string[] = [];
  if (manifest.id.trim() === "") reasons.push("manifest: id mancante");
  if (manifest.name.trim() === "") reasons.push("manifest: nome mancante");
  if (manifest.version.trim() === "") reasons.push("manifest: versione mancante");
  if (manifest.engine !== profile.engine) {
    reasons.push(`manifest: engine ${manifest.engine || "<vuoto>"} incompatibile, serve ${profile.engine}`);
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

  const hasMotion = Object.prototype.hasOwnProperty.call(manifest, "motion");
  const motionValues = !hasMotion && manifest.engine === profile.engine
    ? ["opacity", "transform"]
    : Array.isArray(manifest.motion) ? manifest.motion : [];
  const motion = new Set(motionValues);
  if (motionValues.length !== 2 ||
      !motion.has("opacity") ||
      !motion.has("transform")) {
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
  // Una coppia con un ruolo che il foglio non dichiara non si conta: per le
  // obbligatorie lo dice già il cancello dei ruoli, le facoltative valgono
  // solo per chi le dichiara.
  for (const [ink, background, threshold, where] of [...profile.contrastPairs, ...(profile.optionalPairs ?? [])]) {
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

/**
 * Le ultime pelli controllate, con il profilo e lo spazio degli asset con cui
 * si sono controllate. La pelle di serie è lunga (circa 18 mila righe) e ogni
 * cambio di luce, contrasto o tema la ripassava da capo, un centinaio di
 * millisecondi ogni volta. Il controllo è una funzione pura del testo e della
 * politica: a parità dei tre il risultato è lo stesso. Due voci bastano alla
 * serie e al tema installato; un profilo nuovo le fa rifare.
 */
const SKIN_CHECKS_KEPT = 2;
const skinChecks: {
  readonly css: string;
  readonly profile: ThemeProfile;
  readonly assetNamespace: string;
  readonly violations: readonly ThemeCssViolation[];
}[] = [];

function skinViolations(css: string, policy: ThemeCssPolicy): readonly ThemeCssViolation[] {
  const at = skinChecks.findIndex((entry) =>
    entry.profile === profile && entry.assetNamespace === policy.assetNamespace && entry.css === css);
  if (at >= 0) {
    const [entry] = skinChecks.splice(at, 1);
    skinChecks.unshift(entry!);
    return entry!.violations;
  }
  const violations = themeCssViolations(css, { ...policy, kind: "skin" });
  skinChecks.unshift({ css, profile, assetNamespace: policy.assetNamespace, violations });
  skinChecks.length = Math.min(skinChecks.length, SKIN_CHECKS_KEPT);
  return violations;
}

/** Tutti i motivi di rifiuto; nessun cancello accorcia il report del successivo. */
export function validateThemeBundle(bundle: ThemeBundle, light: ThemeLight): string[] {
  const reasons = manifestReasons(bundle.manifest, light);
  if (typeof bundle.sheet !== "string" || bundle.sheet.trim() === "") {
    reasons.push("fascio: foglio mancante");
  }
  // Per un tema che eredita una pelle assente è il caso normale: lo veste la
  // serie. Chi non eredita e porta una pelle vuota ha perso un file.
  const inherits = bundle.manifest.extends !== undefined;
  if (bundle.skin !== undefined && bundle.skin.trim() === "" && !inherits) {
    reasons.push("fascio: pelle vuota");
  }
  if (inherits && bundle.inherited === undefined) {
    reasons.push(`fascio: eredita da ${bundle.manifest.extends || "<vuoto>"}, che qui non c'è`);
  }
  if (!inherits && bundle.inherited !== undefined) {
    reasons.push("fascio: porta una pelle ereditata ma non dichiara extends");
  }

  const policy: ThemeCssPolicy = {
    assetNamespace: bundle.manifest.asset_namespace,
    allowedHooks: profile.hooks,
    requiredRoles: profile.requiredRoles,
    vocabulary: profile.vocabulary,
    gate: profile.gate,
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
    for (const violation of skinViolations(bundle.skin, policy)) {
      reasons.push(
        `pelle: ${violation.code} (${violation.line}:${violation.column}): ${violation.detail}`,
      );
    }
  }

  const assets = bundle.assets && typeof bundle.assets === "object" ? bundle.assets : {};
  if (assets !== bundle.assets) reasons.push("fascio: inventario asset mancante");
  for (const [asset, value] of Object.entries(assets)) {
    if (!asset.startsWith(bundle.manifest.asset_namespace)) {
      reasons.push(`asset: ${asset} fuori da ${bundle.manifest.asset_namespace || "<namespace vuoto>"}`);
    }
    if (bytesOf(value) === null) reasons.push(`asset: ${asset} non contiene byte validi`);
  }
  reasons.push(...fontReasons(bundle.manifest, assets));
  const referenced = themeAssetUrls(`${bundle.sheet}\n${bundle.skin ?? ""}`);
  for (const asset of referenced) {
    if (asset.startsWith(bundle.manifest.asset_namespace) &&
        !Object.prototype.hasOwnProperty.call(assets, asset)) {
      reasons.push(`asset: ${asset} nominato dal CSS ma assente dal fascio`);
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
/** Valida l'intero fascio e solo allora sostituisce gli strati del tema. */
export function mountThemeBundle(
  bundle: ThemeBundle,
  light: ThemeLight,
  report: ThemeTroubleReporter = reportThemeTrouble,
): ThemeMountResult {
  const reasons = validateThemeBundle(bundle, light);
  if (reasons.length > 0) return rejectTheme(bundle.manifest.name, reasons, report);
  try {
    // Una pelle vuota di un tema che eredita non occupa `pelle-tema`.
    const skin = bundle.skin === undefined || (bundle.inherited !== undefined && bundle.skin.trim() === "")
      ? undefined
      : materializeAssets(bundle.skin, bundle.assets, bundle.manifest.asset_namespace);
    replaceTheme(
      themeFontFaces(bundle.manifest, bundle.assets),
      materializeAssets(bundle.sheet, bundle.assets, bundle.manifest.asset_namespace),
      skin,
      bundle.inherited?.skin,
    );
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
  const allowed = new Set<string>(profile.preferenceTokens);
  for (const [token, value] of Object.entries(tokens)) {
    if (!allowed.has(token)) {
      throw new Error(t("errors.theme.token_not_allowed", { token }));
    }
    if (value.trim() === "" || /[;{}\n\r]/.test(value)) {
      throw new Error(t("errors.theme.token_unsafe", { token }));
    }
  }

  const declarations = profile.preferenceTokens
    .filter((token) => Object.prototype.hasOwnProperty.call(tokens, token))
    .map((token) => `  --${token}: ${tokens[token]};`);
  replace([":root {", ...declarations, "}", ""].join("\n"), "preferenze");
}

/** Only the user-CSS owner calls this after validating every enabled snippet. */
export function mountUserSnippets(css: string): void {
  replace(css, "snippets");
}

/** Quanti elementi di uno strato sono montati. Nel banco dev'essere sempre 1
 *  dopo ogni `monta`; 0 significa «nessun tema», 2 significa che qualcuno ha
 *  ripreso ad accatastare. */
export function count(layer: Layer): number {
  return document.head.querySelectorAll(`style[data-fub="${layer}"]`).length;
}

/** Il tema come questa finestra lo ha montato, strato per strato: ciò che
 * un'altra finestra della stessa app rispecchia senza rimontarlo da sé. */
export interface MirroredTheme {
  readonly light: string;
  readonly contrast: string;
  readonly layers: readonly { readonly layer: Layer; readonly text: string }[];
  /** Le scelte del tema scritte sulla radice (`data-opt-*`, `--opt-*`). */
  readonly options?: MirroredOptions;
}

export function mountedTheme(): MirroredTheme {
  const layers: { layer: Layer; text: string }[] = [];
  for (const el of document.head.querySelectorAll<HTMLStyleElement>("style[data-fub]")) {
    const layer = el.dataset.fub as Layer;
    if (ORDER.includes(layer)) layers.push({ layer, text: el.textContent ?? "" });
  }
  return {
    light: document.documentElement.dataset.theme ?? "",
    contrast: document.documentElement.dataset.contrast ?? "",
    layers,
    options: mountedThemeOptions(document.documentElement),
  };
}

/** Rispecchia il tema di un'altra finestra: ogni strato che porta sostituisce
 * il proprio, ogni strato che non porta si toglie. */
export function mountMirroredTheme(theme: MirroredTheme): void {
  const carried = new Set<Layer>();
  for (const { layer, text } of theme.layers) {
    if (!ORDER.includes(layer)) continue;
    carried.add(layer);
    replace(text, layer);
  }
  for (const layer of ORDER) {
    if (carried.has(layer)) continue;
    for (const el of document.head.querySelectorAll<HTMLStyleElement>(`style[data-fub="${layer}"]`)) el.remove();
  }
  document.documentElement.dataset.theme = theme.light;
  document.documentElement.dataset.contrast = theme.contrast;
  mountMirroredOptions(document.documentElement, theme.options);
}
