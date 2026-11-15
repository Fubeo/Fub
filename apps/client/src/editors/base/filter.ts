// Il filtro di una vista della Base, nelle sue due forme.
//
// Sul disco il filtro è l'albero del modello (`FilterDef` di
// `fub-format-base`): `and`, `or`, `not` e le condizioni. Chi usa Fub lo
// compone in due modi, e la Base mostra tutti e due:
//
// - **a vista**: una lista di condizioni tutte vere insieme, ognuna fatta di
//   una proprietà (o della cartella), un operatore e un valore;
// - **come ricerca**: una riga nella lingua della barra di ricerca
//   (`[stato:Arrivata]`), letta dallo stesso parser (`rules/search-syntax.ts`),
//   perché le stesse parole dicano la stessa cosa nella barra e nella Base.
//
// Le due forme non dicono tutte le stesse cose. La forma a vista non sa dire
// un «oppure», un «non» attorno a un gruppo, una formula o un metadato del file
// diverso dalla cartella: quel filtro resta come ricerca, e la Base lo dice. La
// ricerca non sa dire «è» esattamente (`[k:v]` vuol dire «contiene»), né i
// confronti con l'uguale: quel filtro resta a vista. Un filtro che nessuna delle
// due sa dire si cambia dal sorgente, e la Base non lo riscrive mai da sé.
import type { QueryExpr, QueryLiteral } from "../../host/contract";
import { parseSearch, type SearchFault } from "../../rules/search-syntax";

/// Gli operatori del modello (`FilterOp`), con i nomi del disco.
export type FilterOp =
  | "is" | "is_not" | "contains" | "not_contains"
  | "greater_than" | "greater_than_or_equal" | "less_than" | "less_than_or_equal"
  | "is_empty" | "is_not_empty" | "in_folder" | "has_tag";

const OPS: readonly FilterOp[] = [
  "is", "is_not", "contains", "not_contains",
  "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal",
  "is_empty", "is_not_empty", "in_folder", "has_tag",
];

/// Una condizione: un solo campo fra `property`, `file`, `formula` e `tag`.
export interface FilterCondition {
  readonly property?: string;
  readonly file?: string;
  readonly formula?: string;
  readonly tag?: string;
  readonly op: FilterOp;
  readonly value?: string | number | boolean;
}

/// L'albero come il modello lo serializza (serde, `snake_case`).
export type FilterDef =
  | "all"
  | { readonly and: readonly FilterDef[] }
  | { readonly or: readonly FilterDef[] }
  | { readonly not: FilterDef }
  | { readonly condition: FilterCondition }
  /// Un filtro che il modello legge ma che nessuna delle due forme sa ridire
  /// (un valore lista o oggetto): la Base lo mostra come scritto nel file e
  /// non lo riscrive mai. Non esiste sul disco con questo nome.
  | { readonly opaque: unknown };

/// Gli operatori della forma a vista. «Dentro la cartella» e «fuori dalla
/// cartella» valgono solo per la cartella; gli altri per una proprietà.
export type VisualOp =
  | "is" | "is_not" | "contains" | "not_contains"
  | "greater_than" | "less_than" | "is_empty" | "is_not_empty"
  | "in_folder" | "not_in_folder";

export const PROPERTY_OPS: readonly VisualOp[] = ["is", "is_not", "contains", "not_contains", "greater_than", "less_than", "is_empty", "is_not_empty"];
export const FOLDER_OPS: readonly VisualOp[] = ["in_folder", "not_in_folder"];
/// Gli operatori che non chiedono un valore.
export const VALUELESS: ReadonlySet<VisualOp> = new Set(["is_empty", "is_not_empty"]);

/// Una condizione della forma a vista. `subject` è il nome della proprietà
/// (senza `prop.`), o `null` per la cartella della nota.
export interface VisualCondition {
  readonly subject: string | null;
  readonly op: VisualOp;
  readonly value: string;
}

/// Quanto può essere grande un albero che la Base legge dal piano: lo stesso
/// ordine del modello (64 KiB di filtro), detto in nodi.
const MAX_NODES = 4096;

/// Il filtro del piano, controllato e ripulito: i campi `null` che serde
/// scrive per i campi assenti spariscono, perché riscritto sul disco il filtro
/// non porti righe `file: null` che nessuno ha scritto. Una forma che il
/// modello non produce è un errore.
export function parseFilter(raw: unknown): FilterDef {
  let nodes = 0;
  const walk = (node: unknown): FilterDef => {
    if (++nodes > MAX_NODES) throw new Error("base: filtro oltre il budget");
    if (node === "all" || node === null || node === undefined) return "all";
    if (typeof node !== "object" || Array.isArray(node)) throw new Error("base: filtro malformato");
    const entries = Object.entries(node as Record<string, unknown>);
    if (entries.length !== 1) throw new Error("base: filtro malformato");
    const [kind, inner] = entries[0]!;
    if (kind === "and" || kind === "or") {
      if (!Array.isArray(inner)) throw new Error("base: filtro malformato");
      const parts = inner.map(walk);
      return kind === "and" ? { and: parts } : { or: parts };
    }
    if (kind === "not") return { not: walk(inner) };
    if (kind === "all") return "all";
    if (kind !== "condition" || !inner || typeof inner !== "object" || Array.isArray(inner)) throw new Error("base: filtro malformato");
    const fields = inner as Record<string, unknown>;
    const op = fields.op;
    if (typeof op !== "string" || !OPS.includes(op as FilterOp)) throw new Error("base: operatore di filtro sconosciuto");
    // I campi nell'ordine in cui il modello li scrive (il soggetto, `op`,
    // `value`): riscritta, una condizione toccata da un gesto vicino resta
    // com'era anche nell'ordine delle righe.
    const condition: { -readonly [K in keyof FilterCondition]: FilterCondition[K] } = {} as FilterCondition;
    for (const field of ["property", "file", "formula", "tag"] as const) {
      const value = fields[field];
      if (value === null || value === undefined) continue;
      if (typeof value !== "string") throw new Error(`base: ${field} malformato`);
      condition[field] = value;
    }
    condition.op = op as FilterOp;
    const value = fields.value;
    if (value !== null && value !== undefined) {
      // Un valore lista o oggetto il modello lo legge, ma nessuna delle due
      // forme lo sa dire: resta un valore che si cambia dal sorgente.
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") condition.value = value;
      else throw new UnsayableValue();
    }
    return { condition };
  };
  try {
    return walk(raw);
  } catch (error) {
    if (error instanceof UnsayableValue) return { opaque: raw };
    throw error;
  }
}

class UnsayableValue extends Error {}

/// Un filtro che la Base legge ma non sa ridire (un valore lista nel YAML):
/// non si mostra a vista né come ricerca, e non si riscrive.
export function isOpaque(filter: FilterDef): filter is { readonly opaque: unknown } {
  return typeof filter === "object" && "opaque" in filter;
}

/// Le condizioni di primo livello, tutte vere insieme: quelle che la Base
/// mostra come etichette sotto la barra. `"all"` non ne ha.
export function conjuncts(filter: FilterDef): readonly FilterDef[] {
  if (filter === "all") return [];
  if ("and" in filter) return filter.and;
  return [filter];
}

/// Il filtro di più condizioni tutte vere insieme, nella forma più corta:
/// nessuna è `"all"`, una sola è sé stessa.
export function allOf(parts: readonly FilterDef[]): FilterDef {
  const kept = parts.filter((part) => part !== "all");
  if (kept.length === 0) return "all";
  if (kept.length === 1) return kept[0]!;
  return { and: kept };
}

/// Il filtro senza la condizione di primo livello `index`.
export function withoutConjunct(filter: FilterDef, index: number): FilterDef {
  return allOf(conjuncts(filter).filter((_, at) => at !== index));
}

const strip = (key: string): string => key.replace(/^prop\./, "");

/// Il valore scritto in un campo, come lo legge il modello: un numero o un
/// booleano scritti come tali diventano numero e booleano, il resto testo.
/// È la regola di `scalar` della ricerca, senza le date: il modello confronta
/// una data del filtro come testo, e scriverla come oggetto la romperebbe.
export function typedValue(text: string): string | number | boolean {
  const value = text.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}

const valueText = (value: FilterCondition["value"]): string => value === undefined ? "" : String(value);

/// Una condizione del modello nella forma a vista, o `null` se la forma a
/// vista non la sa dire.
function visualCondition(node: FilterDef): VisualCondition | null {
  if (node === "all" || isOpaque(node)) return null;
  if ("not" in node) {
    const inner = node.not;
    if (inner !== "all" && "condition" in inner && inner.condition.file === "path" && inner.condition.op === "in_folder" && inner.condition.value !== undefined) {
      return { subject: null, op: "not_in_folder", value: valueText(inner.condition.value) };
    }
    return null;
  }
  if (!("condition" in node)) return null;
  const c = node.condition;
  if (c.file === "path" && c.op === "in_folder" && c.value !== undefined) return { subject: null, op: "in_folder", value: valueText(c.value) };
  if (c.property === undefined) return null;
  const subject = strip(c.property);
  if (subject === "") return null;
  if (c.op === "is_empty" || c.op === "is_not_empty") return { subject, op: c.op, value: "" };
  if (c.value === undefined) return null;
  if (c.op === "is" || c.op === "is_not" || c.op === "contains" || c.op === "not_contains" || c.op === "greater_than" || c.op === "less_than") {
    return { subject, op: c.op, value: valueText(c.value) };
  }
  return null;
}

/// Il filtro nella forma a vista, o `null` se non la sa dire tutto.
export function visualOf(filter: FilterDef): VisualCondition[] | null {
  if (isOpaque(filter)) return null;
  const out: VisualCondition[] = [];
  for (const part of conjuncts(filter)) {
    const condition = visualCondition(part);
    if (!condition) return null;
    out.push(condition);
  }
  return out;
}

/// Una condizione completa? Una proprietà con un nome, e un valore se
/// l'operatore lo chiede.
export function completeCondition(condition: VisualCondition): boolean {
  if (condition.subject !== null && condition.subject.trim() === "") return false;
  if (condition.subject === null && !FOLDER_OPS.includes(condition.op)) return false;
  if (condition.subject !== null && FOLDER_OPS.includes(condition.op)) return false;
  return VALUELESS.has(condition.op) || condition.value.trim() !== "";
}

/// Una condizione a vista nel modello.
export function conditionDef(condition: VisualCondition): FilterDef {
  if (condition.subject === null) {
    const inFolder: FilterDef = { condition: { file: "path", op: "in_folder", value: folderPath(condition.value) } };
    return condition.op === "not_in_folder" ? { not: inFolder } : inFolder;
  }
  const property = condition.subject.trim();
  if (VALUELESS.has(condition.op)) return { condition: { property, op: condition.op as FilterOp } };
  return { condition: { property, op: condition.op as FilterOp, value: typedValue(condition.value) } };
}

/// Le condizioni a vista nel modello; quelle incomplete non contano.
export function filterOfVisual(conditions: readonly VisualCondition[]): FilterDef {
  return allOf(conditions.filter(completeCondition).map(conditionDef));
}

const folderPath = (value: string): string => value.trim().replace(/^\/+|\/+$/g, "");

// ---------------------------------------------------------------------------
// La forma di ricerca.
// ---------------------------------------------------------------------------

/// Un valore nella riga di ricerca: fra virgolette se ha spazi, parentesi
/// quadre o virgolette, perché si rilegga uguale.
function searchValue(value: string): string {
  return /[\s"\]\[()]/.test(value) || value === "" ? `"${value.replace(/"/g, '\\"')}"` : value;
}
function searchKey(key: string): string | null {
  // Il parser taglia la chiave al primo `:` e alla prima `]`.
  return key === "" || /[:\]\[]/.test(key) || key.trim() !== key ? null : key;
}

/// Una condizione nella riga di ricerca, o `null` se la ricerca non la sa dire.
function searchCondition(node: FilterDef, negated = false): string | null {
  if (node === "all" || isOpaque(node)) return null;
  if ("not" in node) return negated ? null : searchCondition(node.not, true);
  if ("and" in node || "or" in node) return null;
  const c = node.condition;
  const dash = negated ? "-" : "";
  if (c.file === "path" && c.op === "in_folder" && c.value !== undefined) {
    const path = folderPath(String(c.value));
    return path === "" || /[\s()"]/.test(path) ? null : `${dash}folder:${path}`;
  }
  if (c.property === undefined) return null;
  const key = searchKey(strip(c.property));
  if (key === null) return null;
  const value = c.value === undefined ? null : String(c.value);
  // `>` e `<` davanti al valore li legge il parser come confronto: un valore
  // che comincia così non si dice come «contiene».
  const plain = (text: string) => !/^[<>]/.test(text) && text.trim() === text && text !== "";
  switch (c.op) {
    case "contains": return value !== null && plain(value) ? `${dash}[${key}:${searchValue(value)}]` : null;
    case "not_contains": return value !== null && plain(value) && !negated ? `-[${key}:${searchValue(value)}]` : null;
    case "is_not_empty": return negated ? `-[${key}]` : `[${key}]`;
    case "is_empty": return negated ? `[${key}]` : `-[${key}]`;
    case "greater_than": return value !== null && value.trim() !== "" ? `${dash}[${key}:>${searchValue(value)}]` : null;
    case "less_than": return value !== null && value.trim() !== "" ? `${dash}[${key}:<${searchValue(value)}]` : null;
    default: return null;
  }
}

/// Il filtro come riga di ricerca, o `null` se la ricerca non lo sa dire.
export function searchOf(filter: FilterDef): string | null {
  if (filter === "all") return "";
  if (isOpaque(filter)) return null;
  const clause = (node: FilterDef): string | null => {
    const parts = conjuncts(node).map((part) => searchCondition(part));
    return parts.some((part) => part === null) ? null : parts.join(" ");
  };
  if (typeof filter === "object" && "or" in filter) {
    if (filter.or.length === 0) return null;
    const clauses = filter.or.map((part) => {
      const text = clause(part);
      if (text === null || text === "") return null;
      return conjuncts(part).length > 1 ? `(${text})` : text;
    });
    return clauses.some((text) => text === null) ? null : clauses.join(" OR ");
  }
  return clause(filter);
}

/// Perché una riga di ricerca non diventa un filtro.
export type SearchProblem =
  /// La riga non si legge: la specie e il punto, come nella barra.
  | { readonly kind: "syntax"; readonly fault: SearchFault }
  /// La riga dice qualcosa che il filtro della Base non sa fare: cercare nel
  /// testo, nei titoli, nei compiti. `term` è il pezzo della riga.
  | { readonly kind: "unsupported"; readonly term: string };

export type SearchFilter = { readonly ok: FilterDef } | { readonly problem: SearchProblem };

function scalarValue(test: Record<string, unknown>): string | number | boolean | null {
  const value = test.value;
  if (test.kind === "date" && value && typeof value === "object") {
    const date = value as { year?: unknown; month?: unknown; day?: unknown };
    if (typeof date.year !== "number" || typeof date.month !== "number" || typeof date.day !== "number") return null;
    return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

/// Un letterale della ricerca nel modello, o il pezzo che non ci sta.
function literalDef(literal: QueryLiteral): FilterDef | string {
  const predicate = literal.predicate;
  const negate = (def: FilterDef): FilterDef => literal.negated ? { not: def } : def;
  if (predicate.kind === "folder") {
    return negate({ condition: { file: "path", op: "in_folder", value: predicate.path } });
  }
  if (predicate.kind === "property") {
    const key = predicate.filter.key;
    const test = predicate.filter.test as Record<string, unknown> | null;
    if (!test || typeof test !== "object") return `[${key}]`;
    if (test.op === "exists") return { condition: { property: key, op: literal.negated ? "is_empty" : "is_not_empty" } };
    const value = scalarValue(test);
    if (value === null) return `[${key}]`;
    if (test.op === "contains") return { condition: { property: key, op: literal.negated ? "not_contains" : "contains", value } };
    if (test.op === "greater_than") return negate({ condition: { property: key, op: "greater_than", value } });
    if (test.op === "less_than") return negate({ condition: { property: key, op: "less_than", value } });
    return `[${key}]`;
  }
  if (predicate.kind === "tag") return `${literal.negated ? "-" : ""}tag:${predicate.name}`;
  if (predicate.kind === "text") return `${literal.negated ? "-" : ""}${predicate.text}`.trim() || predicate.kind;
  return predicate.kind;
}

/// La riga di ricerca come filtro della Base. Una riga vuota è nessun filtro.
export function filterOfSearch(text: string): SearchFilter {
  const parsed = parseSearch(text, false);
  if ("fault" in parsed) return { problem: { kind: "syntax", fault: parsed.fault } };
  return filterOfQuery(parsed.ok);
}

function filterOfQuery(query: QueryExpr): SearchFilter {
  const clauses: FilterDef[] = [];
  for (const clause of query.any) {
    const parts: FilterDef[] = [];
    for (const literal of clause.all) {
      const def = literalDef(literal);
      if (typeof def === "string") return { problem: { kind: "unsupported", term: def } };
      parts.push(def);
    }
    clauses.push(allOf(parts));
  }
  if (clauses.length === 0) return { ok: "all" };
  if (clauses.length === 1) return { ok: clauses[0]! };
  return { ok: { or: clauses } };
}

/// Due filtri sono lo stesso albero? Per non scrivere un gesto che non cambia
/// niente.
export function sameFilter(left: FilterDef, right: FilterDef): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/// Il valore da scrivere con `base.view.set` per la chiave `filters`: `null`
/// toglie la chiave, perché «nessun filtro» non lasci un `filters: all` che
/// nessuno ha scritto.
export function filterValue(filter: FilterDef): FilterDef | null {
  return filter === "all" ? null : filter;
}
