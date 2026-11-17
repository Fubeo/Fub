// Il tipo di una proprietà della testata (T8): quale editor apre il suo
// valore e quale figura sta davanti al nome. Vince il registro dei tipi del
// vault (`properties.types`, con le chiavi convenzionali di
// `PropertyTypes::resolve`); senza dichiarazione il tipo si legge dal valore.
// Un valore che non torna col tipo dichiarato resta testo, segnato: non si
// riscrive niente per farlo tornare.
import type { PropertyType } from "../../../../../../host/enums.generated";
import type { PropertyEntry } from "../../properties";

/// Gli editor che la testata sa aprire. `people` è un elenco di soli link a
/// note (le persone): il registro non ha un tipo suo, lo legge dal valore.
/// Selezione e Stato vengono solo dal registro: un valore non le dice da sé.
export type PropertyKind = "text" | "number" | "checkbox" | "date" | "date_time" | "list" | "tags" | "people" | "url" | "select" | "status";

/// I nove colori di un'opzione (`PropertyColor` nel core): i nomi dei colori
/// del contenuto, che il tema disegna con `--doc-color-*` e `--doc-tint-*`.
export type OptionColor = "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";

/// Il gruppo di un'opzione di Stato (`StatusGroup` nel core).
export type OptionGroup = "todo" | "doing" | "done";

/// Un'opzione di Selezione o di Stato com'è nel registro, coi valori che il
/// core dà a un colore o a un gruppo che mancano o che non conosce: grigio e
/// Da fare (`PropertyOption::color`, `PropertyOption::group`).
export interface PropertyOption {
  readonly name: string;
  readonly color: OptionColor;
  readonly group: OptionGroup;
}

/// Il registro dei tipi del vault: chiave → tipo, dichiarato a mano o dal
/// menu «Tipo». Le chiavi si confrontano esatte, come nel core. `options`
/// porta, per chiave, le opzioni di Selezione e Stato nel loro ordine.
export interface PropertyTypes extends ReadonlyMap<string, PropertyType> {
  readonly options?: ReadonlyMap<string, readonly PropertyOption[]>;
}

export const NO_TYPES: PropertyTypes = new Map();

const COLORS: ReadonlySet<string> = new Set<OptionColor>(["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);
const GROUPS: ReadonlySet<string> = new Set<OptionGroup>(["todo", "doing", "done"]);

/// Le opzioni scritte per una chiave: si tengono quelle che hanno un nome.
function readOptions(raw: unknown): PropertyOption[] {
  if (!Array.isArray(raw)) return [];
  const out: PropertyOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { name, color, group } = item as { name?: unknown; color?: unknown; group?: unknown };
    if (typeof name !== "string") continue;
    out.push({
      name,
      color: typeof color === "string" && COLORS.has(color) ? color as OptionColor : "gray",
      group: typeof group === "string" && GROUPS.has(group) ? group as OptionGroup : "todo",
    });
  }
  return out;
}

const KNOWN: ReadonlySet<string> = new Set<PropertyType>(["text", "list", "number", "checkbox", "date", "date_time", "tags", "select", "status", "url"]);

/// Legge il valore dell'impostazione `properties.types` (JSON
/// `{"version":1,"types":{…},"options":{…}}`). Un testo che non si legge, o
/// una versione che non conosce, è un registro vuoto: i tipi si leggono dai
/// valori, e niente si perde.
export function parsePropertyTypes(raw: unknown): PropertyTypes {
  if (typeof raw !== "string" || raw.trim() === "") return NO_TYPES;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return NO_TYPES;
  }
  if (!value || typeof value !== "object") return NO_TYPES;
  const { version, types, options } = value as { version?: unknown; types?: unknown; options?: unknown };
  if (version !== 1 || !types || typeof types !== "object") return NO_TYPES;
  const out = new Map<string, PropertyType>();
  for (const [key, type] of Object.entries(types as Record<string, unknown>)) {
    if (typeof type === "string" && KNOWN.has(type)) out.set(key, type as PropertyType);
  }
  const choices = new Map<string, readonly PropertyOption[]>();
  if (options && typeof options === "object") {
    for (const [key, list] of Object.entries(options as Record<string, unknown>)) {
      const read = readOptions(list);
      if (read.length > 0) choices.set(key, read);
    }
  }
  if (out.size === 0 && choices.size === 0) return NO_TYPES;
  return choices.size === 0 ? out : Object.assign(out, { options: choices as ReadonlyMap<string, readonly PropertyOption[]> });
}

/// Le opzioni di `key` nel loro ordine: nessuna, se il registro non ne ha.
export function optionsOf(types: PropertyTypes, key: string): readonly PropertyOption[] {
  return types.options?.get(key) ?? [];
}

/// L'ordine dei gruppi dello Stato: Da fare, In corso, Fatto.
export const OPTION_GROUPS: readonly OptionGroup[] = ["todo", "doing", "done"];

/// I colori che un'opzione nuova prende, nell'ordine: il primo che nessuna
/// opzione della chiave ha già. Il grigio resta di chi non ne dice uno.
const FREE_COLORS: readonly OptionColor[] = ["blue", "green", "orange", "purple", "pink", "yellow", "red", "brown"];

/// Il colore libero per un'opzione nuova fra `options`: il primo non usato;
/// se ci sono tutti, il giro ricomincia.
export function freeColor(options: readonly PropertyOption[]): OptionColor {
  const used = new Set(options.map((option) => option.color));
  return FREE_COLORS.find((color) => !used.has(color)) ?? FREE_COLORS[options.length % FREE_COLORS.length]!;
}

/// L'opzione di `key` che si chiama `value`, carattere per carattere (la
/// prima, se due hanno lo stesso nome), come `PropertyTypes::option` del
/// core. `null` se il valore è fuori dalle opzioni: resta testo.
export function optionOf(types: PropertyTypes, key: string, value: string): PropertyOption | null {
  return types.options?.get(key)?.find((option) => option.name === value) ?? null;
}

function sameOptions(a: PropertyTypes, b: PropertyTypes): boolean {
  const left = a.options ?? new Map<string, readonly PropertyOption[]>();
  const right = b.options ?? new Map<string, readonly PropertyOption[]>();
  if (left.size !== right.size) return false;
  for (const [key, list] of left) {
    const other = right.get(key);
    if (!other || other.length !== list.length) return false;
    if (list.some((option, i) => option.name !== other[i]!.name || option.color !== other[i]!.color || option.group !== other[i]!.group)) return false;
  }
  return true;
}

/// Due registri che dicono la stessa cosa.
export function sameTypes(a: PropertyTypes, b: PropertyTypes): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, type] of a) if (b.get(key) !== type) return false;
  return sameOptions(a, b);
}

/// Il tipo dichiarato di `key`: il registro, poi le chiavi convenzionali
/// (`PropertyTypes::resolve` nel core).
export function declaredType(types: PropertyTypes, key: string): PropertyType | null {
  const declared = types.get(key);
  if (declared) return declared;
  if (key === "tags") return "tags";
  if (key === "aliases" || key === "alias" || key === "cssclasses" || key === "cssclass") return "list";
  return null;
}

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const BOOLEAN = /^(?:true|false|True|False|TRUE|FALSE)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const URL_VALUE = /^https?:\/\/\S+$/i;
const LINK = /^\[\[[^[\]|#]+(?:#[^[\]|]*)?(?:\|[^[\]]*)?\]\]$/;

/// Un valore vuoto: la chiave sola, `""`, un elenco senza voci.
export function emptyValue(entry: PropertyEntry): boolean {
  return entry.items ? entry.items.length === 0 : entry.value.trim() === "";
}

/// Il tipo che il valore dice da sé, senza registro.
function inferred(entry: PropertyEntry): PropertyKind {
  if (entry.items) {
    if (entry.items.length > 0 && entry.items.every((item) => LINK.test(item))) return "people";
    return "list";
  }
  const value = entry.value.trim();
  if (!entry.quoted && BOOLEAN.test(value)) return "checkbox";
  if (!entry.quoted && NUMBER.test(value)) return "number";
  if (DATE.test(value) && validDate(value)) return "date";
  if (DATE_TIME.test(value) && validDate(value.slice(0, 10))) return "date_time";
  if (URL_VALUE.test(value)) return "url";
  return "text";
}

/// Il valore torna col tipo dichiarato? Vuoto torna sempre.
function fits(entry: PropertyEntry, type: PropertyType): boolean {
  if (emptyValue(entry)) return true;
  const value = entry.value.trim();
  switch (type) {
    case "number": return !entry.items && NUMBER.test(value);
    case "checkbox": return !entry.items && !entry.quoted && BOOLEAN.test(value);
    case "date": return !entry.items && DATE.test(value) && validDate(value);
    case "date_time": return !entry.items && (DATE_TIME.test(value) || DATE.test(value)) && validDate(value.slice(0, 10));
    // Un testo solo è un elenco di una voce, come lo legge il core.
    case "list":
    case "tags":
    // Una Relazione è un link o un elenco di link (T35a).
    case "relation": return true;
    default: return !entry.items;
  }
}

/// Il tipo di una riga: quello dichiarato, se il valore torna; altrimenti
/// testo, e `mismatch` dice quale tipo il valore non rispetta. Un valore di
/// Selezione o di Stato fuori dalle opzioni torna lo stesso (è un testo): la
/// riga lo segna (`outsideOptions`) e il suo editor resta quello delle
/// opzioni.
export interface RowKind {
  readonly kind: PropertyKind;
  readonly declared: PropertyType | null;
  readonly mismatch: PropertyType | null;
}

export function rowKind(entry: PropertyEntry, types: PropertyTypes): RowKind {
  const declared = declaredType(types, entry.key);
  if (!declared) return { kind: inferred(entry), declared: null, mismatch: null };
  if (!fits(entry, declared)) return { kind: "text", declared, mismatch: declared };
  if (declared === "list") return { kind: entry.items && entry.items.length > 0 && inferred(entry) === "people" ? "people" : "list", declared, mismatch: null };
  // La Relazione ha il suo editor con T35: intanto i suoi link si scrivono
  // come un elenco.
  if (declared === "relation") return { kind: "list", declared, mismatch: null };
  return { kind: declared, declared, mismatch: null };
}

/// La figura davanti al nome, per tipo (i nomi del set di icone): quelle di
/// `.pk` nel prototipo.
export const KIND_ICONS: Readonly<Record<PropertyKind, string>> = {
  text: "prop-text",
  number: "prop-number",
  checkbox: "prop-checkbox",
  date: "prop-date",
  date_time: "clock",
  list: "prop-list",
  tags: "prop-tags",
  people: "prop-people",
  url: "prop-url",
  select: "prop-select",
  status: "prop-status",
};

/// La figura di un tipo del registro.
export function typeIcon(type: PropertyType): string {
  if (type === "relation") return "backlink";
  return KIND_ICONS[type];
}

/// La figura davanti al nome di una riga: quella del tipo dichiarato, se
/// c'è (anche quando il valore non torna), se no quella letta dal valore.
export function rowIcon(kind: RowKind): string {
  return kind.declared ? typeIcon(kind.declared) : KIND_ICONS[kind.kind];
}

/// I tipi che il menu «Tipo» offre, nell'ordine del prototipo (`TYPES`):
/// Selezione e Stato dopo il numero. Persone è un elenco di link.
export const MENU_TYPES: readonly PropertyType[] = ["text", "number", "select", "status", "checkbox", "date", "date_time", "list", "tags", "url"];

/// Un valore di Selezione o di Stato che non è il nome di un'opzione: resta
/// testo, segnato. Vuoto non lo è.
export function outsideOptions(entry: PropertyEntry, kind: RowKind, types: PropertyTypes): boolean {
  if (kind.kind !== "select" && kind.kind !== "status") return false;
  if (emptyValue(entry)) return false;
  return optionOf(types, entry.key, entry.value) === null;
}

/// Una data `aaaa-mm-gg` che esiste nel calendario.
export function validDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/// Il nome di un link `[[Nome]]` o `[[Nome|Alias]]`, come lo si legge.
export function linkName(item: string): string {
  const inner = item.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const bar = inner.indexOf("|");
  const shown = bar >= 0 ? inner.slice(bar + 1) : inner.replace(/#.*$/, "");
  return shown.split("/").pop()!.trim();
}

/// Il link a una nota per nome: `[[Nome]]`.
export function linkTo(name: string): string {
  return `[[${name.trim()}]]`;
}

/// Le iniziali di un nome, per il tondo della persona.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words;
  return letters.map((word) => [...word][0]!.toLocaleUpperCase()).join("") || "?";
}

/// Uno dei quattro colori del tondo, sempre lo stesso per lo stesso nome.
export function avatarTone(name: string): "a" | "b" | "c" | "d" {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return (["a", "b", "c", "d"] as const)[hash % 4]!;
}

/// Il numero scritto da chi usa Fub: `12`, `-3.5`, `1.234,5` all'italiana,
/// `1,234.5`. `null` se non è un numero.
export function parseNumber(text: string): number | null {
  const value = text.trim().replace(/\s/g, "");
  if (value === "") return null;
  let plain = value;
  if (value.includes(",") && value.includes(".")) {
    // L'ultimo dei due separa i decimali, l'altro le migliaia.
    plain = value.lastIndexOf(",") > value.lastIndexOf(".") ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  } else if (value.includes(",")) {
    // La virgola sola separa i decimali, all'italiana: `1,5` è uno e mezzo.
    plain = value.replace(",", ".");
  }
  if (!NUMBER.test(plain)) return null;
  const number = Number(plain);
  return Number.isFinite(number) ? number : null;
}
