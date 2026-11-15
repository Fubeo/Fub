// **La Base delle scene `base-*`** (`?base=1`): un file `Opere.base` con tre
// viste e le note della cartella `Opere/` che mostra, per fotografare la barra
// della Base (T15): le linguette, Filtro, Ordina, Proprietà, le etichette del
// filtro e «Nel file .base».
//
// Il finto non ha `fub-format-base`: questa scenografia ne fa le veci per le
// quattro domande che la superficie fa (`parse`, `plan`, `derive`) e per il
// comando che i gesti mandano (`base.view.set`). Tiene le viste come dati,
// le riscrive come YAML nella forma che il modello scrive davvero (vedi
// `crates/fub-features/tests/base_commands_e2e.rs`) e posa il testo nuovo come
// la scrittura di un comando (un evento dell'utente), così la superficie lo
// rilegge come col kernel e la sessione lo ricarica in silenzio. Non
// è il modello: un filtro che qui passa non dimostra nulla del core, che ha i
// suoi test. Solo le scene `base-*` hanno questi file: l'albero e i conteggi
// delle altre restano quelli delle loro baseline.

/// Il file `.base` delle scene.
export const BASE_DOC = "Opere.base";

/// La cartella delle note che la Base mostra.
const FOLDER = "Opere/";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/// Una nota dell'elenco, con le sue proprietà.
interface Work {
  readonly name: string;
  readonly stato: string;
  readonly museo: string;
  readonly valore: number;
  readonly consegna: string;
}

const WORKS: readonly Work[] = [
  { name: "Annunciazione", stato: "Arrivata", museo: "Uffizi", valore: 12000, consegna: "2026-03-02" },
  { name: "Ritratto di signora", stato: "In viaggio", museo: "Brera", valore: 4800, consegna: "2026-03-09" },
  { name: "Natura morta con limoni", stato: "Arrivata", museo: "Capodimonte", valore: 2600, consegna: "2026-02-24" },
  { name: "Veduta del porto", stato: "Prenotata", museo: "Correr", valore: 900, consegna: "2026-04-15" },
  { name: "La lettrice", stato: "In viaggio", museo: "Uffizi", valore: 7300, consegna: "2026-03-18" },
  { name: "Paesaggio con mulino", stato: "Arrivata", museo: "Brera", valore: 3100, consegna: "2026-02-27" },
  { name: "San Girolamo", stato: "Prenotata", museo: "Capodimonte", valore: 15500, consegna: "2026-04-02" },
  { name: "Il concerto", stato: "In viaggio", museo: "Correr", valore: 5200, consegna: "2026-03-23" },
];

const docOf = (work: Work): string => `${FOLDER}${work.name}.md`;

/// Le chiavi di una vista, nell'ordine in cui il file le scrive.
type View = Map<string, Json>;

function view(entries: readonly (readonly [string, Json])[]): View {
  return new Map(entries);
}

/// Le viste di partenza: la tabella col suo filtro, il suo ordinamento e le
/// sue colonne; la bacheca per stato; le schede.
function initialViews(): View[] {
  return [
    view([
      ["name", "Tabella"],
      ["type", "table"],
      ["filters", { and: [{ condition: { property: "valore", op: "greater_than", value: 1000 } }] }],
      ["sort", [{ key: "consegna", descending: false }]],
      ["order", ["file.name", "stato", "museo", "valore", "consegna"]],
    ]),
    view([["name", "Bacheca"], ["type", "kanban"], ["group_by", "stato"]]),
    view([["name", "Schede"], ["type", "cards"]]),
  ];
}

// Il filtro di tutta la Base nella forma che il modello legge e scrive
// (`FilterDef` di `fub-format-base`): l'albero, non l'espressione di Obsidian.
const HEADER = "# Opere in prestito per la mostra di primavera.\nfilters:\n  condition:\n    file: path\n    op: in_folder\n    value: Opere\n";

function scalar(value: Json): string {
  if (typeof value === "string") return /^[\w .-]+$/u.test(value) && !/^\d/.test(value) && value.trim() === value ? value : JSON.stringify(value);
  return String(value);
}

/// Un valore JSON come blocco YAML, rientrato di `indent` spazi.
function yaml(value: Json, indent: number): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item: Json) => {
      if (item !== null && typeof item === "object") {
        const inner = yaml(item, indent + 2);
        return `${pad}- ${inner.slice(indent + 2)}`;
      }
      return `${pad}- ${scalar(item)}\n`;
    }).join("");
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, Json>).map(([key, item]) =>
      item !== null && typeof item === "object" ? `${pad}${key}:\n${yaml(item, indent + 2)}` : `${pad}${key}: ${scalar(item)}\n`,
    ).join("");
  }
  return `${pad}${scalar(value)}\n`;
}

function serialize(views: readonly View[]): string {
  return HEADER + "views:\n" + views.map((entries) => {
    const body = [...entries].map(([key, value]) =>
      value !== null && typeof value === "object" ? `    ${key}:\n${yaml(value, 6)}` : `    ${key}: ${scalar(value)}\n`,
    ).join("");
    return `  - ${body.slice(4)}`;
  }).join("");
}

const LABELS: Readonly<Record<string, string>> = { "file.name": "Nome" };

function columnsOf(entries: View): string[] {
  const order = entries.get("order");
  return Array.isArray(order) ? order.filter((key): key is string => typeof key === "string") : ["file.name", "stato", "museo", "valore", "consegna"];
}

function valueOf(work: Work, key: string): string | number | null {
  if (key === "file.name") return work.name;
  if (key === "file.folder") return FOLDER.slice(0, -1);
  const value = (work as unknown as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? value : null;
}

/// Il valore scritto nel filtro allineato alla specie del valore della nota,
/// come `aligned` in `crates/fub-features/src/base.rs`: una data ISO contro
/// una data, un numero canonico contro un numero; il resto resta com'è.
function aligned(key: string, actual: string | number | null, wanted: Json | undefined): Json | undefined {
  if (typeof wanted !== "string") return wanted;
  if (key === "consegna" && /^\d{4}-\d{2}-\d{2}$/.test(wanted)) return Date.parse(`${wanted}T00:00:00Z`);
  if (typeof actual === "number" && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(wanted)) return Number(wanted);
  return wanted;
}

/// Una condizione del filtro sulle proprietà di una nota: gli operatori della
/// forma a vista, con le regole del modello (`matches_filter` in
/// `crates/fub-features/src/base.rs`): una data contro una data, un numero
/// contro un numero («contiene» su un numero è l'uguaglianza), il testo
/// senza maiuscole.
function holds(filter: Json, work: Work): boolean {
  if (filter === null || filter === "all") return true;
  if (typeof filter !== "object" || Array.isArray(filter)) return true;
  const node = filter as Record<string, Json>;
  if (Array.isArray(node.and)) return node.and.every((part: Json) => holds(part, work));
  if (Array.isArray(node.or)) return node.or.some((part: Json) => holds(part, work));
  if (node.not !== undefined) return !holds(node.not, work);
  const condition = node.condition as Record<string, Json> | undefined;
  if (!condition) return true;
  const op = condition.op;
  if (typeof condition.file === "string") {
    const inside = typeof condition.value === "string" && docOf(work).startsWith(`${condition.value}/`);
    return op === "in_folder" ? inside : true;
  }
  const key = typeof condition.property === "string" ? condition.property.replace(/^prop\./, "") : "";
  const raw = valueOf(work, key);
  // Una data della nota vale come istante, come la cella che la mostra.
  const actual = key === "consegna" && typeof raw === "string" ? Date.parse(`${raw}T00:00:00Z`) : raw;
  const wanted = aligned(key, actual, condition.value);
  const text = (value: Json | string | number | null) => String(value ?? "").toLowerCase();
  const numbers = typeof actual === "number" && typeof wanted === "number";
  const same = numbers ? actual === wanted : text(actual) === text(wanted ?? null);
  const contains = numbers ? actual === wanted : text(actual).includes(text(wanted ?? null));
  switch (op) {
    case "is": return same;
    case "is_not": return !same;
    case "contains": return contains;
    case "not_contains": return !contains;
    case "greater_than": return numbers ? actual > wanted : text(actual) > text(wanted ?? null);
    case "less_than": return numbers ? actual < wanted : text(actual) < text(wanted ?? null);
    case "is_empty": return actual === null || actual === "";
    case "is_not_empty": return actual !== null && actual !== "";
    default: return true;
  }
}

function cell(work: Work, key: string): Json {
  const value = valueOf(work, key);
  if (value === null) return { kind: "empty" };
  if (key === "consegna") return { kind: "date", value: Date.parse(`${value}T00:00:00Z`) };
  return typeof value === "number" ? { kind: "number", value } : { kind: "text", value };
}

/// Ciò che il finto deve sapere per servire la scenografia.
export interface BaseFixture {
  /// I file da mettere nel vault.
  readonly files: Readonly<Record<string, string>>;
  /// Le proprietà di una nota, come l'indice le dà in `documents`: valori
  /// `PropertyValue` del contratto (`{ kind, value }`).
  properties(doc: string): { key: string; value: Json }[] | null;
  /// La query custom `fub.base`.
  query(query: unknown): unknown;
  /// `base.view.set`, o `null` se il comando non è suo.
  invoke(id: string, args: unknown): Promise<unknown> | null;
}

/// Gli attrezzi del finto con cui la scenografia legge e posa il file.
export interface BaseFixtureHost {
  readonly revision: (doc: string) => Promise<string>;
  /// Scrive il file come un comando del kernel: i byte nuovi e un evento
  /// dell'utente, non del watcher, come `base.view.set` nel vault vero.
  readonly writeByCommand: (doc: string, text: string) => Promise<void>;
}

export function baseFixture(host: () => BaseFixtureHost): BaseFixture {
  const views = initialViews();
  const files: Record<string, string> = { [BASE_DOC]: serialize(views) };
  for (const work of WORKS) {
    files[docOf(work)] = `---\nstato: ${work.stato}\nmuseo: ${work.museo}\nvalore: ${work.valore}\nconsegna: ${work.consegna}\n---\n# ${work.name}\n`;
  }
  const named = (name: unknown): View | undefined =>
    typeof name === "string" ? views.find((entries) => entries.get("name") === name) : views[0];
  const works = new Map(WORKS.map((work) => [docOf(work), work]));
  return {
    files,
    properties: (doc) => {
      const work = works.get(doc);
      if (!work) return null;
      const [year, month, day] = work.consegna.split("-").map(Number);
      return [
        { key: "stato", value: { kind: "text", value: work.stato } },
        { key: "museo", value: { kind: "text", value: work.museo } },
        { key: "valore", value: { kind: "number", value: work.valore } },
        { key: "consegna", value: { kind: "date", value: { year: year!, month: month!, day: day!, time: null } } },
      ];
    },
    query: (raw) => {
      const query = raw as { op?: unknown; view?: unknown; rows?: unknown };
      switch (query.op) {
        case "parse":
          return { views: views.map((entries) => entries.get("name")), types: views.map((entries) => entries.get("type")) };
        case "plan": {
          const entries = named(query.view) ?? views[0]!;
          const columns = columnsOf(entries);
          const type = entries.get("type");
          return {
            view: entries.get("name"), view_type: type, columns,
            column_labels: Object.fromEntries(columns.filter((key) => key in LABELS).map((key) => [key, LABELS[key]!])),
            required_props: ["stato", "museo", "valore", "consegna"], all_properties: false,
            group: type === "kanban" ? entries.get("group_by") ?? null : null, limit: null, map: null, create_defaults: {},
            filters: entries.get("filters") ?? "all", sort: entries.get("sort") ?? [], order: entries.get("order") ?? [],
          };
        }
        case "derive": {
          const entries = named(query.view) ?? views[0]!;
          const asked = new Set((Array.isArray(query.rows) ? query.rows : []).map((row: { doc?: unknown }) => row.doc));
          const filter = entries.get("filters") ?? "all";
          const sort = (entries.get("sort") ?? []) as readonly { key: string; descending?: boolean }[];
          const keys = ["file.name", "stato", "museo", "valore", "consegna"];
          const chosen = WORKS.filter((work) => asked.has(docOf(work)) && holds(filter, work));
          chosen.sort((a, b) => {
            for (const { key, descending } of sort) {
              const left = valueOf(a, key), right = valueOf(b, key);
              const order = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""));
              if (order !== 0) return descending ? -order : order;
            }
            return a.name.localeCompare(b.name);
          });
          return {
            rows: chosen.map((work) => ({ doc: docOf(work), values: Object.fromEntries(keys.map((key) => [key, cell(work, key)])) })),
            summaries: {},
          };
        }
        default:
          throw { kind: "bad_args", message: `base finta: «${String(query.op)}» non c'è` };
      }
    },
    invoke: (id, raw) => {
      if (id !== "base.view.set") return null;
      return (async () => {
        const args = raw as { doc?: unknown; view?: unknown; key?: unknown; value?: unknown; base?: unknown };
        const entries = named(args.view);
        if (args.doc !== BASE_DOC || !entries || typeof args.key !== "string") throw { kind: "bad_args", message: "base finta: gesto sconosciuto" };
        const now = await host().revision(BASE_DOC);
        if (typeof args.base === "string" && args.base !== now) throw { kind: "conflict", message: `conflict: «${BASE_DOC}» è cambiato sotto` };
        if (typeof args.value === "string") entries.set(args.key, JSON.parse(args.value) as Json);
        else entries.delete(args.key);
        await host().writeByCommand(BASE_DOC, serialize(views));
        return { notify: null, effect: { kind: "custom", ns: "fub.base", payload: { revision: await host().revision(BASE_DOC) } }, undo: null, partial: null };
      })();
    },
  };
}
