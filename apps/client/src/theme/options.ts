// Le scelte che un tema lascia a chi lo usa (da `theme-2`).
//
// Il tema le dichiara nel manifest; l'host le dichiara al registro delle
// impostazioni con la chiave `<id>:<nome>`, e da lì si leggono e si scrivono
// come tutte le altre. Qui c'è l'ultimo tratto: il valore che vale adesso
// finisce sulla radice del documento, dove la pelle lo ritrova.
//
//   interruttore  data-opt-<nome>="true" | "false"
//   scelta        data-opt-<nome>="<valore>"
//   numero        data-opt-<nome>="<n>"  e  --opt-<nome>: <n>
//
// Il numero è nudo: l'unità la mette la pelle (`calc(var(--opt-raggio) * 1px)`).
import type { SettingEntry, SettingKind, SettingValue, ThemeSetting } from "../host/contract";

export interface ThemeOption {
  readonly setting: ThemeSetting;
  /** La chiave nel registro delle impostazioni. */
  readonly key: string;
  readonly value: SettingValue;
  /** Il registro la conosce. Senza un vault aperto no: vale il default, e
   * scriverla non si può. */
  readonly declared: boolean;
  /** Qualcuno ha scelto: il valore non è il default. */
  readonly chosen: boolean;
}

const ATTRIBUTE = "data-opt-";
const PROPERTY = "--opt-";
/// La forma che l'host impone ai nomi e ai valori delle scelte. Ripetuta qui
/// perché ciò che finisce in un attributo della radice si controlla dove lo si
/// scrive, da qualunque parte arrivi il manifest.
const TOKEN = /^[a-z][a-z0-9-]{0,47}$/;

export function themeOptionKey(themeId: string, name: string): string {
  return `${themeId}:${name}`;
}

/// Il valore regge lo schema dichiarato? Stessa regola dell'host, per non
/// portare sulla radice un valore che il tema non ha previsto.
function admits(kind: SettingKind, value: SettingValue | undefined): boolean {
  if (kind.kind === "toggle") return typeof value === "boolean";
  if (kind.kind === "number") {
    return typeof value === "number" && Number.isFinite(value) &&
      (kind.min === null || kind.min === undefined || value >= kind.min) &&
      (kind.max === null || kind.max === undefined || value <= kind.max);
  }
  if (kind.kind === "choice") {
    return typeof value === "string" && kind.options.some((option) => option.value === value);
  }
  return false;
}

/// Le impostazioni dichiarate dal tema con il valore che vale adesso: quello
/// del registro se c'è e regge lo schema, altrimenti il default dichiarato.
/// Una specie che un tema non può usare, o un nome fuori forma, non entra.
export function resolveThemeOptions(
  themeId: string,
  settings: readonly ThemeSetting[] | undefined,
  entries: readonly SettingEntry[],
): ThemeOption[] {
  const options: ThemeOption[] = [];
  const seen = new Set<string>();
  for (const setting of settings ?? []) {
    const kind = setting.kind;
    if (!TOKEN.test(setting.name) || seen.has(setting.name)) continue;
    if (kind.kind !== "toggle" && kind.kind !== "number" && kind.kind !== "choice") continue;
    // Un numero ha i due estremi: l'host rifiuta un tema che ne dichiara uno
    // aperto, e chi lo regola lo fa con un cursore.
    if (kind.kind === "number" && (typeof kind.min !== "number" || typeof kind.max !== "number")) continue;
    if (!admits(kind, kind.default)) continue;
    seen.add(setting.name);
    const key = themeOptionKey(themeId, setting.name);
    const entry = entries.find((candidate) => candidate.spec.key === key);
    const stored = entry !== undefined && admits(kind, entry.value);
    options.push({
      setting,
      key,
      value: stored ? entry.value : kind.default,
      declared: entry !== undefined,
      chosen: stored && entry.source !== "default",
    });
  }
  return options;
}

/// Le proprietà scritte in linea sulla radice, per nome.
function inlineProperties(root: HTMLElement): string[] {
  const names: string[] = [];
  for (let index = 0; index < root.style.length; index++) names.push(root.style.item(index));
  return names;
}

function written(option: ThemeOption): string | null {
  const text = String(option.value);
  if (option.setting.kind.kind === "choice") return TOKEN.test(text) ? text : null;
  return text;
}

/// Scrive le scelte sulla radice e toglie quelle che non valgono più: cambiato
/// tema, non resta niente del precedente. Scrive solo ciò che cambia.
export function applyThemeOptions(root: HTMLElement, options: readonly ThemeOption[]): void {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  for (const option of options) {
    const value = written(option);
    if (value === null) continue;
    attributes.set(ATTRIBUTE + option.setting.name, value);
    if (option.setting.kind.kind === "number") properties.set(PROPERTY + option.setting.name, value);
  }
  for (const name of root.getAttributeNames()) {
    if (name.startsWith(ATTRIBUTE) && !attributes.has(name)) root.removeAttribute(name);
  }
  for (const name of inlineProperties(root)) {
    if (name.startsWith(PROPERTY) && !properties.has(name)) root.style.removeProperty(name);
  }
  for (const [name, value] of attributes) {
    if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }
  for (const [name, value] of properties) {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
}

/// Le scelte come stanno scritte sulla radice: ciò che un'altra finestra della
/// stessa app rispecchia senza rileggere le impostazioni.
export interface MirroredOptions {
  readonly attributes: Readonly<Record<string, string>>;
  readonly properties: Readonly<Record<string, string>>;
}

export function mountedThemeOptions(root: HTMLElement): MirroredOptions {
  const attributes: Record<string, string> = {};
  const properties: Record<string, string> = {};
  for (const name of root.getAttributeNames()) {
    if (name.startsWith(ATTRIBUTE)) attributes[name.slice(ATTRIBUTE.length)] = root.getAttribute(name) ?? "";
  }
  for (const name of inlineProperties(root)) {
    if (name.startsWith(PROPERTY)) properties[name.slice(PROPERTY.length)] = root.style.getPropertyValue(name);
  }
  return { attributes, properties };
}

/// Rispecchia le scelte di un'altra finestra. Ciò che arriva si controlla come
/// ciò che si legge dal manifest: nomi e valori nella forma ammessa, numeri
/// che sono numeri.
export function mountMirroredOptions(root: HTMLElement, mirrored: MirroredOptions | undefined): void {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  for (const [name, value] of Object.entries(mirrored?.attributes ?? {})) {
    if (!TOKEN.test(name) || typeof value !== "string") continue;
    if (TOKEN.test(value) || value === "true" || value === "false" || Number.isFinite(Number(value))) {
      attributes.set(ATTRIBUTE + name, value);
    }
  }
  for (const [name, value] of Object.entries(mirrored?.properties ?? {})) {
    if (TOKEN.test(name) && typeof value === "string" && value !== "" && Number.isFinite(Number(value))) {
      properties.set(PROPERTY + name, value);
    }
  }
  for (const name of root.getAttributeNames()) {
    if (name.startsWith(ATTRIBUTE) && !attributes.has(name)) root.removeAttribute(name);
  }
  for (const name of inlineProperties(root)) {
    if (name.startsWith(PROPERTY) && !properties.has(name)) root.style.removeProperty(name);
  }
  for (const [name, value] of attributes) {
    if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }
  for (const [name, value] of properties) {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
}
