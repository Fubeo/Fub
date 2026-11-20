// Il caricatore del foglio, della pelle e dei caratteri (§29.1, §31.3).
//
// Montare un CSS qui vuol dire **sostituire**: prima si toglie quello che c'è,
// poi si appende il nuovo. Il vecchio modo — impilare fogli con `disabled` o
// con un `id` da sovrascrivere in cascata — metteva in gara la specificità di
// due temi e vinceva l'ultimo per una ragione che nessuno aveva scritto; qui
// il banco resta com'è: **un foglio montato per canale, mai due**. È la
// stessa promessa del loader della logica di presentazione (§2.2), fatta per
// il CSS: ciò che non è montato non vale, quindi non può nemmeno interferire.
//
// Un canale è un **foglio costruito** (`new CSSStyleSheet()`) in
// `document.adoptedStyleSheets`, non un elemento `<style>`: la CSP dell'app
// non ammette stili in linea (`style-src 'self'`), e un `<style>` creato qui
// la WebView lo rifiuterebbe in silenzio, lasciando l'app senza tema. Un
// foglio costruito non è markup e la CSP non lo guarda (`ui/stylesheets.ts`
// dice le altre strade). I fogli del tema stanno davanti agli altri fogli
// costruiti della pagina (la stampa, i caratteri di pdf.js, la vista dei
// contorni), che restano dove sono e nell'ordine in cui sono.
//
// I tre strati viaggiano su canali separati (`caratteri`, `foglio`,
// `pelle`), perché crescono separatamente: la
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
// foglio e delle pelli, e un tema che non ne porta svuota il canale. Le
// `@font-face` dei due canali dei caratteri non restano nel foglio: diventano
// `FontFace` in `document.fonts` (il perché sta su `liftFontFaces`).
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
// che il foglio dichiara — e ogni montaggio rimette i fogli in quell'ordine
// anche se i canali si montano in un ordine diverso.
//
// Il testo arriva come stringa (`?raw`), non come CSS bundlato: il bundle
// saprebbe solo *aggiungere* fogli al documento, e il punto è sostituirli. I
// test del banco (`theme/loader.test.ts`) guardano qui dentro.

import type { ThemeManifest, ThemeLight } from "../host/contract";
import { errorText } from "../host/errors";
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
import {
  THEME_FONT_LIMITS,
  THEME_ICON_LIMITS,
  themeFontFault,
  themeIconFault,
  themeIconsFileHolds,
  type ThemeFontFault,
  type ThemeIconFault,
} from "../rules/mirrored";
import { replaceThemeIcons, themeIcons } from "../ui/icons";

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

/**
 * Il canale e il testo di ogni foglio che questo file ha costruito. Lo stato
 * montato **è** `document.adoptedStyleSheets`: la mappa dice soltanto quali di
 * quei fogli sono del tema, di che canale e con che testo (quello scritto,
 * non la sua rilettura dal CSSOM, che il browser normalizza). Un foglio che
 * non c'è è di qualcun altro, e resta dov'è.
 *
 * La mappa sta sul registro globale (`Symbol.for`), non nel modulo: un modulo
 * ricaricato (l'HMR di Vite, `vi.resetModules` nei test) deve riconoscere i
 * fogli montati dal precedente e sostituirli, non lasciarli lì come estranei
 * e accatastare un secondo tema.
 */
const OWNED = Symbol.for("fub.theme.sheets");
const owned: WeakMap<CSSStyleSheet, { readonly layer: Layer; readonly text: string }> =
  ((globalThis as { [OWNED]?: WeakMap<CSSStyleSheet, { readonly layer: Layer; readonly text: string }> })[OWNED] ??=
    new WeakMap());

function sheetOf(layer: Layer, text: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  owned.set(sheet, { layer, text });
  if (FONT_LAYERS.has(layer)) liftFontFaces(sheet);
  return sheet;
}

/**
 * **Le facce dei caratteri stanno in `document.fonts`, non nei fogli
 * adottati.** Una regola `@font-face` in un foglio costruito, in Chromium, si
 * ricrea ogni volta che il documento riceve un altro foglio con un suo
 * `@font-face` (il `<style>` o il `<link>` di KaTeX, quando la prima formula
 * lo carica): la faccia nuova riparte da `unloaded` e, per qualche
 * fotogramma, il testo che la usa si misura col carattere di riserva. Con
 * `<style>` non succedeva; con i fogli costruiti la Live si spostava di 2 px
 * sotto la formula (PR #420, scena `live-07-html-attivo`). Una `FontFace`
 * aggiunta a mano resta la stessa finché qualcuno non la toglie.
 *
 * Il foglio del canale resta montato, vuoto delle sue `@font-face`: tiene il
 * posto nella cascata e il testo nella mappa, così chi legge i canali
 * (`mountedCss`, lo specchio delle altre finestre) non vede differenze. Dove
 * l'API non c'è (happy-dom) le regole restano nel foglio, come prima.
 */
const FONT_LAYERS: ReadonlySet<Layer> = new Set<Layer>(["caratteri", "caratteri-tema"]);
const FACES = Symbol.for("fub.theme.faces");
const faces: Map<CSSStyleSheet, readonly FontFace[]> =
  ((globalThis as { [FACES]?: Map<CSSStyleSheet, readonly FontFace[]> })[FACES] ??= new Map());

/** I descrittori di `@font-face` che `FontFace` accetta, col loro nome lì. */
const FACE_DESCRIPTORS: readonly (readonly [string, keyof FontFaceDescriptors])[] = [
  ["font-style", "style"],
  ["font-weight", "weight"],
  ["font-stretch", "stretch"],
  ["unicode-range", "unicodeRange"],
  ["font-feature-settings", "featureSettings"],
  ["font-display", "display"],
  ["ascent-override", "ascentOverride"],
  ["descent-override", "descentOverride"],
  ["line-gap-override", "lineGapOverride"],
];

function fontFacesAvailable(): boolean {
  return typeof FontFace === "function" && typeof document.fonts?.add === "function";
}

/** Il nome della famiglia senza le virgolette CSS: `FontFace` lo vuole nudo. */
function bareFamily(value: string): string {
  const quoted = /^\s*(["'])(.*)\1\s*$/s.exec(value);
  return quoted === null ? value.trim() : quoted[2].replace(/\\(.)/gs, "$1");
}

/** Toglie dal foglio le sue `@font-face` e ne fa altrettante `FontFace`. */
function liftFontFaces(sheet: CSSStyleSheet): void {
  if (!fontFacesAvailable()) return;
  const lifted: FontFace[] = [];
  for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
    const rule = sheet.cssRules[index];
    if (!(rule instanceof CSSFontFaceRule)) continue;
    const family = rule.style.getPropertyValue("font-family");
    const source = rule.style.getPropertyValue("src");
    const descriptors: FontFaceDescriptors = {};
    for (const [property, key] of FACE_DESCRIPTORS) {
      const value = rule.style.getPropertyValue(property);
      if (value !== "") (descriptors as Record<string, string>)[key] = value;
    }
    sheet.deleteRule(index);
    if (family === "" || source === "") continue;
    lifted.unshift(new FontFace(bareFamily(family), source, descriptors));
  }
  faces.set(sheet, lifted);
}

/**
 * Allinea `document.fonts` ai fogli dei caratteri montati: toglie le facce dei
 * fogli usciti e rimette le altre nell'ordine della cascata (`caratteri-tema`
 * dopo `caratteri`, perché a parità di descrittori vince l'ultima). Le stesse
 * `FontFace` tornano dentro già caricate: rimetterle non le ricarica.
 */
function syncFontFaces(mounted: readonly CSSStyleSheet[]): void {
  if (!fontFacesAvailable()) return;
  for (const [sheet, list] of [...faces]) {
    if (mounted.includes(sheet)) continue;
    for (const face of list) document.fonts.delete(face);
    faces.delete(sheet);
  }
  const wanted = mounted.flatMap((sheet) => faces.get(sheet) ?? []);
  const there = [...document.fonts].filter((face) => wanted.includes(face));
  if (there.length === wanted.length && there.every((face, index) => face === wanted[index])) return;
  for (const face of wanted) document.fonts.delete(face);
  for (const face of wanted) document.fonts.add(face);
}

/** I fogli del tema montati, uno per canale, e gli altri nel loro ordine. */
function mountedSheets(): { layers: Map<Layer, CSSStyleSheet>; others: CSSStyleSheet[] } {
  const layers = new Map<Layer, CSSStyleSheet>();
  const others: CSSStyleSheet[] = [];
  for (const sheet of document.adoptedStyleSheets) {
    const entry = owned.get(sheet);
    if (entry === undefined) others.push(sheet);
    else if (!layers.has(entry.layer)) layers.set(entry.layer, sheet);
  }
  return { layers, others };
}

/**
 * Sostituisce i canali di `changes` (`null` toglie il canale) con **una sola
 * assegnazione** di `adoptedStyleSheets`: i fogli nuovi si costruiscono prima,
 * e se uno non si costruisce il documento resta com'era. I canali del tema
 * escono nell'ordine dichiarato, davanti agli altri fogli costruiti.
 */
function commit(changes: ReadonlyMap<Layer, string | null>): readonly CSSStyleSheet[] {
  const { layers, others } = mountedSheets();
  const built = new Map<Layer, CSSStyleSheet | null>();
  for (const [layer, text] of changes) {
    // Un canale dei caratteri che riceve lo stesso testo tiene il suo foglio:
    // un foglio nuovo vorrebbe dire facce nuove, da ricaricare.
    const current = layers.get(layer);
    const same = text !== null && FONT_LAYERS.has(layer) && current !== undefined && owned.get(current)?.text === text;
    built.set(layer, same ? current : text === null ? null : sheetOf(layer, text));
  }
  for (const [layer, sheet] of built) {
    if (sheet === null) layers.delete(layer);
    else layers.set(layer, sheet);
  }
  const mounted = [...ORDER.flatMap((layer) => layers.get(layer) ?? []), ...others];
  document.adoptedStyleSheets = mounted;
  syncFontFaces(mounted);
  return [...built.values()].filter((sheet) => sheet !== null);
}

/** Sostituisce uno strato, al suo posto nella cascata. */
function replace(text: string, layer: Layer): void {
  commit(new Map([[layer, text]]));
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
): readonly CSSStyleSheet[] {
  return commit(new Map<Layer, string | null>([
    ["caratteri-tema", fonts ?? null],
    ["foglio", sheet],
    ["pelle", inherited ?? skin ?? null],
    ["pelle-tema", inherited === undefined ? null : skin ?? null],
  ]));
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

/** La frase del cancello per un guasto della regola delle icone. */
const ICON_FAULT_REASON: Readonly<Record<ThemeIconFault, string>> = {
  name: `il nome vuole lettere minuscole, cifre e -, al massimo ${THEME_ICON_LIMITS.name_chars}`,
  paths: `servono da 1 a ${THEME_ICON_LIMITS.paths} tracciati`,
  path_data: "un tracciato porta altro che comandi e numeri di un tracciato SVG",
  bytes: `i tracciati superano ${THEME_ICON_LIMITS.icon_bytes} byte`,
};

/** Il set di icone letto dal fascio, o perché non si legge. */
type IconSetReading =
  | { readonly set: Readonly<Record<string, unknown>> | null; readonly reasons: readonly [] }
  | { readonly set: null; readonly reasons: readonly string[] };

/**
 * Legge il set di icone del fascio (`icons` nel manifest): il nome del file,
 * i byte fra gli asset, il peso, UTF-8 e un oggetto JSON. `set: null` quando
 * il tema non ne porta. La forma di ogni voce la decide `iconReasons`.
 */
function readIconSet(
  manifest: ThemeBundleManifest,
  assets: Readonly<Record<string, unknown>>,
): IconSetReading {
  const file: unknown = (manifest as { icons?: unknown }).icons;
  if (file === undefined) return { set: null, reasons: [] };
  if (!themeIconsFileHolds(file)) {
    return { set: null, reasons: ["icone: il file non è <nome>.json accanto al manifest"] };
  }
  const asset = `${manifest.asset_namespace}${String(file)}`;
  const bytes = Object.prototype.hasOwnProperty.call(assets, asset) ? bytesOf(assets[asset]) : null;
  if (bytes === null) return { set: null, reasons: [`icone: il file ${String(file)} manca dal fascio`] };
  if (bytes.length > THEME_ICON_LIMITS.set_bytes) {
    return { set: null, reasons: [`icone: il file ${String(file)} supera ${THEME_ICON_LIMITS.set_bytes} byte`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)));
  } catch {
    return { set: null, reasons: [`icone: il file ${String(file)} non è JSON in UTF-8`] };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { set: null, reasons: [`icone: il file ${String(file)} non è un oggetto { nome: [tracciati] }`] };
  }
  return { set: parsed as Record<string, unknown>, reasons: [] };
}

/**
 * Tutti i motivi per cui il set di icone del fascio non si può montare. Ogni
 * voce la decide la regola rispecchiata (`themeIconFault`, la stessa dell'host
 * per fixture). Un nome che oggi nessuno disegna non è un motivo: i moduli
 * registrano le loro icone quando si caricano.
 */
function iconReasons(manifest: ThemeBundleManifest, assets: Readonly<Record<string, unknown>>): string[] {
  const reading = readIconSet(manifest, assets);
  if (reading.set === null) return [...reading.reasons];
  const entries = Object.entries(reading.set);
  const reasons: string[] = [];
  if (entries.length > THEME_ICON_LIMITS.icons) {
    reasons.push(`icone: ${entries.length} ridisegnate, al massimo ${THEME_ICON_LIMITS.icons}`);
  }
  for (const [name, paths] of entries) {
    const fault = themeIconFault(name, paths);
    if (fault !== null) reasons.push(`icone: ${name || "<senza nome>"}: ${ICON_FAULT_REASON[fault]}`);
  }
  return reasons;
}

/**
 * Il set di icone del tema, o `null` se non ne porta. Si chiama solo su un
 * fascio che ha passato il cancello; `replaceThemeIcons` ripassa comunque
 * ogni voce dalla regola prima di disegnarla.
 */
export function themeIconSet(
  manifest: ThemeBundleManifest,
  assets: Readonly<Record<string, unknown>>,
): Readonly<Record<string, readonly string[]>> | null {
  const { set } = readIconSet(manifest, assets);
  return set as Readonly<Record<string, readonly string[]>> | null;
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
      const detail = errorText(error);
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
  reasons.push(...iconReasons(bundle.manifest, assets));
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
/**
 * L'ultimo fascio montato, **per contenuto**: il profilo con cui è passato dal
 * cancello, la luce, il manifest serializzato, i testi, una copia dei byte di
 * ogni asset, e i fogli costruiti che ha adottato.
 *
 * Una preferenza (accento, densità, corpo, misura…) non cambia il fascio: va
 * nel canale chiuso delle preferenze. Prima ogni sua scrittura rivalidava e
 * rimaterializzava il fascio intero, decine di millisecondi di thread
 * principale per passo del cursore. Il confronto è sul contenuto e mai sul
 * nome, così un tema con lo stesso id e un file diverso ripassa dal cancello;
 * e vale solo finché i suoi fogli sono ancora adottati, così chi ha
 * sostituito uno strato del tema (un `mount` su quello strato) lo fa
 * rimontare.
 */
interface MountedBundle {
  readonly profile: ThemeProfile;
  readonly light: ThemeLight;
  readonly manifest: string;
  readonly sheet: string;
  readonly skin: string | undefined;
  readonly inherited: string | undefined;
  readonly assets: ReadonlyMap<string, readonly number[] | null>;
  readonly sheets: readonly CSSStyleSheet[];
}
let mountedBundle: MountedBundle | null = null;

function assetSnapshot(assets: Readonly<Record<string, unknown>>): Map<string, readonly number[] | null> {
  const copy = new Map<string, readonly number[] | null>();
  for (const [asset, value] of Object.entries(assets)) {
    const bytes = bytesOf(value);
    copy.set(asset, bytes === null ? null : [...bytes]);
  }
  return copy;
}

function sameAssets(
  kept: ReadonlyMap<string, readonly number[] | null>,
  assets: Readonly<Record<string, unknown>>,
): boolean {
  const entries = Object.entries(assets);
  if (entries.length !== kept.size) return false;
  for (const [asset, value] of entries) {
    if (!kept.has(asset)) return false;
    const before = kept.get(asset)!;
    const now = bytesOf(value);
    if (before === null || now === null) {
      if (before !== now) return false;
      continue;
    }
    if (before.length !== now.length) return false;
    for (let i = 0; i < now.length; i++) if (before[i] !== now[i]) return false;
  }
  return true;
}

function alreadyMounted(bundle: ThemeBundle, light: ThemeLight): boolean {
  const kept = mountedBundle;
  if (kept === null || kept.profile !== profile || kept.light !== light) return false;
  const adopted = document.adoptedStyleSheets;
  if (!kept.sheets.every((sheet) => adopted.includes(sheet))) return false;
  if (kept.sheet !== bundle.sheet || kept.skin !== bundle.skin || kept.inherited !== bundle.inherited?.skin) return false;
  if (kept.manifest !== JSON.stringify(bundle.manifest)) return false;
  const assets = bundle.assets && typeof bundle.assets === "object" ? bundle.assets : null;
  return assets !== null && sameAssets(kept.assets, assets);
}

/**
 * Valida l'intero fascio e solo allora sostituisce gli strati del tema. Un
 * fascio uguale, byte per byte, a quello già montato e ancora al suo posto non
 * si rivalida né si rimonta (`MountedBundle`).
 */
export function mountThemeBundle(
  bundle: ThemeBundle,
  light: ThemeLight,
  report: ThemeTroubleReporter = reportThemeTrouble,
): ThemeMountResult {
  if (alreadyMounted(bundle, light)) return { mounted: true };
  const reasons = validateThemeBundle(bundle, light);
  if (reasons.length > 0) return rejectTheme(bundle.manifest.name, reasons, report);
  // Le icone cambiano nello stesso giro dei canali: un tema senza set torna
  // alla serie, e se i canali non si montano torna il set di prima.
  const previousIcons = themeIcons();
  try {
    // Una pelle vuota di un tema che eredita non occupa `pelle-tema`.
    const skin = bundle.skin === undefined || (bundle.inherited !== undefined && bundle.skin.trim() === "")
      ? undefined
      : materializeAssets(bundle.skin, bundle.assets, bundle.manifest.asset_namespace);
    replaceThemeIcons(themeIconSet(bundle.manifest, bundle.assets));
    const sheets = replaceTheme(
      themeFontFaces(bundle.manifest, bundle.assets),
      materializeAssets(bundle.sheet, bundle.assets, bundle.manifest.asset_namespace),
      skin,
      bundle.inherited?.skin,
    );
    mountedBundle = {
      profile,
      light,
      manifest: JSON.stringify(bundle.manifest),
      sheet: bundle.sheet,
      skin: bundle.skin,
      inherited: bundle.inherited?.skin,
      assets: assetSnapshot(bundle.assets),
      sheets,
    };
    return { mounted: true };
  } catch (error) {
    mountedBundle = null;
    replaceThemeIcons(previousIcons);
    const detail = errorText(error);
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

/** Toglie uno strato. Le preferenze e il tema hanno i loro montaggi. */
export function unmount(layer: "snippets"): void {
  commit(new Map([[layer, null]]));
}

/** Quanti fogli di uno strato sono montati. Nel banco dev'essere sempre 1
 *  dopo ogni `monta`; 0 significa «nessun tema», 2 significa che qualcuno ha
 *  ripreso ad accatastare. */
export function count(layer: Layer): number {
  return document.adoptedStyleSheets.filter((sheet) => owned.get(sheet)?.layer === layer).length;
}

/** Il testo montato di uno strato, o `null` se il canale è vuoto. */
export function mountedCss(layer: Layer): string | null {
  for (const sheet of document.adoptedStyleSheets) {
    const entry = owned.get(sheet);
    if (entry?.layer === layer) return entry.text;
  }
  return null;
}

/** I canali montati, nell'ordine in cui la cascata li legge. */
export function mountedLayers(): Layer[] {
  return document.adoptedStyleSheets.flatMap((sheet) => {
    const entry = owned.get(sheet);
    return entry === undefined ? [] : [entry.layer];
  });
}

/** Il tema come questa finestra lo ha montato, strato per strato: ciò che
 * un'altra finestra della stessa app rispecchia senza rimontarlo da sé. */
export interface MirroredTheme {
  readonly light: string;
  readonly contrast: string;
  readonly layers: readonly { readonly layer: Layer; readonly text: string }[];
  /** Le scelte del tema scritte sulla radice (`data-opt-*`, `--opt-*`). */
  readonly options?: MirroredOptions;
  /** Il set di icone del tema montato, già validato. Assente senza set. */
  readonly icons?: Readonly<Record<string, readonly string[]>>;
  /** `appearance.bars` «marcate» (`data-bars`). Assente vuol dire `light`. */
  readonly bars?: "marked";
}

export function mountedTheme(): MirroredTheme {
  const layers: { layer: Layer; text: string }[] = [];
  for (const sheet of document.adoptedStyleSheets) {
    const entry = owned.get(sheet);
    if (entry !== undefined) layers.push({ layer: entry.layer, text: entry.text });
  }
  const icons = themeIcons();
  const marked = document.documentElement.dataset.bars === "marked";
  return {
    light: document.documentElement.dataset.theme ?? "",
    contrast: document.documentElement.dataset.contrast ?? "",
    layers,
    options: mountedThemeOptions(document.documentElement),
    ...(Object.keys(icons).length > 0 ? { icons } : {}),
    ...(marked ? { bars: "marked" as const } : {}),
  };
}

/** Rispecchia il tema di un'altra finestra: ogni strato che porta sostituisce
 * il proprio, ogni strato che non porta si toglie. */
export function mountMirroredTheme(theme: MirroredTheme): void {
  // Tutti i canali in una commit: un canale portato sostituisce il proprio,
  // uno che non arriva si toglie.
  const changes = new Map<Layer, string | null>(ORDER.map((layer) => [layer, null]));
  for (const { layer, text } of theme.layers) {
    if (ORDER.includes(layer)) changes.set(layer, text);
  }
  commit(changes);
  document.documentElement.dataset.theme = theme.light;
  document.documentElement.dataset.contrast = theme.contrast;
  if (theme.bars === "marked") document.documentElement.dataset.bars = "marked";
  else delete document.documentElement.dataset.bars;
  mountMirroredOptions(document.documentElement, theme.options);
  // Il set arriva da un'altra finestra: `replaceThemeIcons` lo ripassa dalla
  // regola, e uno che non regge lascia la serie.
  const icons = theme.icons !== null && typeof theme.icons === "object" && !Array.isArray(theme.icons)
    ? theme.icons
    : null;
  try {
    replaceThemeIcons(icons);
  } catch {
    replaceThemeIcons(null);
  }
}
