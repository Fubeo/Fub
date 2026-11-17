// **La Base delle scene `base-*`** (`?base=1`): un file `Opere.base` con tre
// viste e le note della cartella `Opere/` che mostra, per fotografare la barra
// della Base (T15): le linguette, Filtro, Ordina, Proprietà, le etichette del
// filtro e «Nel file .base»; e (T16) «+», il menu della colonna e il piede coi
// riepiloghi. `?base=venti` ha venti viste, per le linguette che non stanno.
// `?base=calendario` (T17) apre il calendario di agosto 2026, il mese
// dell'orologio fermo del banco: cinque consegne in un giorno («+2»), una con
// l'ora, una nei giorni di settembre in fondo al mese, una senza data; e
// `note.property.set`, perché trascinare una nota ne riscrive la data.
//
// Il finto non ha `fub-format-base`: questa scenografia ne fa le veci per le
// quattro domande che la superficie fa (`parse`, `plan`, `derive`) e per i
// comandi che i gesti mandano (`base.view.set`, `base.view.add`,
// `base.view.remove`). I riepiloghi li conta qui, come `derive` nel core. Tiene le viste come dati,
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

/// Una nota dell'elenco, con le sue proprietà. La consegna si sposta col
/// calendario; vuota, la nota non ha la proprietà.
interface Work {
  readonly name: string;
  readonly stato: string;
  readonly museo: string;
  readonly valore: number;
  consegna: string;
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

/// Le opere del calendario: agosto 2026, il mese del banco (oggi è il 19).
const CALENDAR_WORKS: readonly Work[] = [
  { name: "Annunciazione", stato: "Arrivata", museo: "Uffizi", valore: 12000, consegna: "2026-07-29" },
  { name: "Ritratto di signora", stato: "In viaggio", museo: "Brera", valore: 4800, consegna: "2026-08-04" },
  { name: "Natura morta con limoni", stato: "Arrivata", museo: "Capodimonte", valore: 2600, consegna: "2026-08-12" },
  { name: "Veduta del porto", stato: "Prenotata", museo: "Correr", valore: 900, consegna: "2026-08-12" },
  { name: "La lettrice", stato: "In viaggio", museo: "Uffizi", valore: 7300, consegna: "2026-08-12" },
  { name: "Paesaggio con mulino", stato: "Arrivata", museo: "Brera", valore: 3100, consegna: "2026-08-12" },
  { name: "San Girolamo", stato: "Prenotata", museo: "Capodimonte", valore: 15500, consegna: "2026-08-12" },
  { name: "Il concerto", stato: "In viaggio", museo: "Correr", valore: 5200, consegna: "2026-08-20T10:30" },
  { name: "Madonna del cardellino", stato: "Prenotata", museo: "Uffizi", valore: 21000, consegna: "2026-08-26" },
  { name: "Giuditta", stato: "In viaggio", museo: "Capodimonte", valore: 9400, consegna: "2026-09-03" },
  { name: "Ritratto di giovane", stato: "Prenotata", museo: "Brera", valore: 3900, consegna: "" },
];

const docOf = (work: Work): string => `${FOLDER}${work.name}.md`;

/// Le chiavi di una vista, nell'ordine in cui il file le scrive.
type View = Map<string, Json>;

function view(entries: readonly (readonly [string, Json])[]): View {
  return new Map(entries);
}

/// Le viste di partenza: la tabella col suo filtro, il suo ordinamento e le
/// sue colonne; la bacheca per stato; le schede.
function initialViews(variant: BaseVariant): View[] {
  if (variant === "calendario") {
    // Il calendario nella forma che il modello scrive su disco: `type: table`
    // per chi non conosce il calendario, e la vista vera sotto `fub`.
    return [
      view([["name", "Calendario"], ["type", "table"], ["fub", { view: "calendar", date: "consegna" }]]),
      view([["name", "Tabella"], ["type", "table"], ["order", ["file.name", "stato", "museo", "valore", "consegna"]]]),
    ];
  }
  if (variant === "venti") {
    const types = ["table", "cards", "list", "kanban", "map"];
    return Array.from({ length: 20 }, (_, index) => view([
      ["name", index === 0 ? "Tabella" : `Vista ${index + 1}`],
      ["type", index === 0 ? "table" : types[index % types.length]!],
      ...(index % types.length === 3 ? [["group_by", "stato"] as const] : []),
    ]));
  }
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

/// Un riepilogo scritto nella vista, col nome con cui `derive` ne dà il
/// valore (`summary_label` in `crates/fub-features/src/base.rs`).
interface Summary { readonly key: string; readonly aggregate: string; readonly name: string | null; readonly label: string }

function summariesOf(entries: View): Summary[] {
  const raw = entries.get("summaries");
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: Json) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
    const { key, aggregate, name } = item as Record<string, Json>;
    if (typeof key !== "string" || typeof aggregate !== "string") return [];
    const named = typeof name === "string" ? name : null;
    return [{ key, aggregate, name: named, label: named ?? `${key}:${aggregate.replace(/_/g, "")}` }];
  });
}

/// Il valore di un riepilogo sulle note della vista, con le regole del core:
/// somma, media, minimo e massimo sui numeri, prima e ultima sulle date.
function aggregate(summary: Summary, works: readonly Work[]): Json {
  const key = summary.key.replace(/^prop\./, "");
  const values = works.map((work) => valueOf(work, key));
  const filled = values.filter((value) => value !== null && value !== "");
  const numbers = filled.filter((value): value is number => typeof value === "number");
  const dates = key === "consegna" ? filled.map((value) => instant(String(value))) : [];
  const number = (value: number | undefined): Json => (value === undefined || !Number.isFinite(value) ? { kind: "empty" } : { kind: "number", value });
  const date = (value: number | undefined): Json => (value === undefined ? { kind: "empty" } : { kind: "date", value });
  switch (summary.aggregate) {
    case "count": return number(values.length);
    case "count_filled": return number(filled.length);
    case "count_empty": return number(values.length - filled.length);
    case "count_unique": return number(new Set(filled).size);
    case "sum": return number(numbers.reduce((total, value) => total + value, 0));
    case "average": return number(numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : undefined);
    case "min": return number(numbers.length ? Math.min(...numbers) : undefined);
    case "max": return number(numbers.length ? Math.max(...numbers) : undefined);
    case "earliest": return date(dates.length ? Math.min(...dates) : undefined);
    case "latest": return date(dates.length ? Math.max(...dates) : undefined);
    default: return { kind: "error", value: `aggregato ${summary.aggregate} non adatto` };
  }
}

/// Il raggruppamento della vista: `group` come lo scrive il menu della
/// colonna, o `group_by` scritto a mano.
function groupOf(entries: View): Json {
  const group = entries.get("group");
  if (group !== null && typeof group === "object" && !Array.isArray(group) && typeof (group as Record<string, Json>).key === "string") return (group as Record<string, Json>).key!;
  return entries.get("group_by") ?? null;
}

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
  const actual = key === "consegna" && typeof raw === "string" && raw !== "" ? instant(raw) : raw;
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

/// Una consegna come istante, con o senza l'ora.
function instant(value: string): number {
  return Date.parse(value.length > 10 ? `${value}:00Z` : `${value}T00:00:00Z`);
}

/// Il tipo di vista che la superficie disegna: quello sotto `fub` (il
/// calendario), o `type`.
function viewTypeOf(entries: View): Json {
  const fub = entries.get("fub");
  return fub !== null && typeof fub === "object" && !Array.isArray(fub) && typeof (fub as Record<string, Json>).view === "string" ? (fub as Record<string, Json>).view! : entries.get("type") ?? null;
}

/// La proprietà data del calendario (`fub.date`).
function dateKeyOf(entries: View): string | null {
  const fub = entries.get("fub");
  const date = fub !== null && typeof fub === "object" && !Array.isArray(fub) ? (fub as Record<string, Json>).date : undefined;
  return typeof date === "string" ? date.replace(/^prop\./, "") : null;
}

/// Una consegna come `PropertyValue` del contratto.
function dateValue(value: string): Json {
  const [day, time] = value.split("T");
  const [year, month, date] = day!.split("-").map(Number);
  const [hour, minute] = time === undefined ? [] : time.split(":").map(Number);
  return { kind: "date", value: { year: year!, month: month!, day: date!, time: time === undefined ? null : { hour: hour!, minute: minute!, second: 0, offset_minutes: null } } };
}

function cell(work: Work, key: string): Json {
  const value = valueOf(work, key);
  if (value === null || value === "") return { kind: "empty" };
  if (key === "consegna") return { kind: "date", value: instant(String(value)) };
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

/// Quale Base: le tre viste delle scene (`1`), venti viste (`venti`), o il
/// calendario di agosto (`calendario`).
export type BaseVariant = "1" | "venti" | "calendario";

export function baseFixture(host: () => BaseFixtureHost, variant: BaseVariant = "1"): BaseFixture {
  const views = initialViews(variant);
  const files: Record<string, string> = { [BASE_DOC]: serialize(views) };
  // Copie: il calendario sposta le consegne.
  const list: Work[] = (variant === "calendario" ? CALENDAR_WORKS : WORKS).map((work) => ({ ...work }));
  const noteText = (work: Work): string =>
    `---\nstato: ${work.stato}\nmuseo: ${work.museo}\nvalore: ${work.valore}\n${work.consegna === "" ? "" : `consegna: ${work.consegna}\n`}---\n# ${work.name}\n`;
  for (const work of list) files[docOf(work)] = noteText(work);
  const named = (name: unknown): View | undefined =>
    typeof name === "string" ? views.find((entries) => entries.get("name") === name) : views[0];
  const works = new Map(list.map((work) => [docOf(work), work]));
  const propertiesOf = (work: Work): { key: string; value: Json }[] => [
    { key: "stato", value: { kind: "text", value: work.stato } },
    { key: "museo", value: { kind: "text", value: work.museo } },
    { key: "valore", value: { kind: "number", value: work.valore } },
    ...(work.consegna === "" ? [] : [{ key: "consegna", value: dateValue(work.consegna) }]),
  ];
  return {
    files,
    properties: (doc) => {
      const work = works.get(doc);
      return work ? propertiesOf(work) : null;
    },
    query: (raw) => {
      const query = raw as { op?: unknown; view?: unknown; rows?: unknown };
      switch (query.op) {
        case "parse":
          return { views: views.map((entries) => entries.get("name")), types: views.map(viewTypeOf) };
        case "plan": {
          const entries = named(query.view) ?? views[0]!;
          const columns = columnsOf(entries);
          const type = viewTypeOf(entries);
          return {
            view: entries.get("name"), view_type: type, columns, date_key: dateKeyOf(entries), start_key: null, end_key: null,
            column_labels: Object.fromEntries(columns.filter((key) => key in LABELS).map((key) => [key, LABELS[key]!])),
            required_props: ["stato", "museo", "valore", "consegna"], all_properties: false,
            group: groupOf(entries), limit: null, map: null, create_defaults: {},
            filters: entries.get("filters") ?? "all", sort: entries.get("sort") ?? [], order: entries.get("order") ?? [],
            summaries: summariesOf(entries).map((summary) => ({ key: summary.key, aggregate: summary.aggregate, expression: null, name: summary.name, label: summary.label })),
          };
        }
        case "derive": {
          const entries = named(query.view) ?? views[0]!;
          const asked = new Set((Array.isArray(query.rows) ? query.rows : []).map((row: { doc?: unknown }) => row.doc));
          const filter = entries.get("filters") ?? "all";
          const sort = (entries.get("sort") ?? []) as readonly { key: string; descending?: boolean }[];
          const keys = ["file.name", "stato", "museo", "valore", "consegna"];
          const chosen = list.filter((work) => asked.has(docOf(work)) && holds(filter, work));
          chosen.sort((a, b) => {
            for (const { key, descending } of sort) {
              const left = valueOf(a, key), right = valueOf(b, key);
              const order = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""));
              if (order !== 0) return descending ? -order : order;
            }
            return a.name.localeCompare(b.name);
          });
          return {
            rows: chosen.map((work) => ({
              doc: docOf(work), values: Object.fromEntries(keys.map((key) => [key, cell(work, key)])),
              // Il giorno civile della data del calendario: l'ora non lo sposta.
              ...(viewTypeOf(entries) === "calendar" ? { time: { day: dateKeyOf(entries) === "consegna" && work.consegna !== "" ? work.consegna.slice(0, 10) : null } } : {}),
            })),
            summaries: Object.fromEntries(summariesOf(entries).map((summary) => [summary.label, aggregate(summary, chosen)])),
          };
        }
        case "mutate": {
          // La mutazione di una cella o di una data: il comando che la
          // superficie poi manda, con il valore letto come confronto.
          const edits = (query as { edits?: { doc: string; key: string; expected: Json; value?: string | null }[] }).edits ?? [];
          return { mutations: edits.map((edit) => ({
            doc: edit.doc, key: edit.key, command: edit.value == null ? "note.property.remove" : "note.property.set",
            args: { doc: edit.doc, key: edit.key, expected: JSON.stringify(edit.expected), ...(edit.value == null ? {} : { value: edit.value }) },
          })) };
        }
        default:
          throw { kind: "bad_args", message: `base finta: «${String(query.op)}» non c'è` };
      }
    },
    invoke: (id, raw) => {
      if (id === "note.property.set" && variant === "calendario") return (async () => {
        // La consegna spostata dal calendario: il valore letto deve essere
        // quello della nota, come il confronto del core.
        const args = raw as { doc?: unknown; key?: unknown; expected?: unknown; value?: unknown };
        const work = typeof args.doc === "string" ? works.get(args.doc) : undefined;
        if (!work || args.key !== "consegna" || typeof args.value !== "string" || typeof args.expected !== "string") throw { kind: "bad_args", message: "base finta: proprietà sconosciuta" };
        const now = JSON.stringify(work.consegna === "" ? { kind: "absent" } : { kind: "value", value: dateValue(work.consegna) });
        if (JSON.stringify(JSON.parse(args.expected)) !== now) throw { kind: "conflict", message: `conflict: «${args.doc as string}» è cambiata sotto` };
        work.consegna = String(JSON.parse(args.value));
        await host().writeByCommand(docOf(work), noteText(work));
        return { notify: null, effect: { kind: "none" }, undo: null, partial: null };
      })();
      if (id !== "base.view.set" && id !== "base.view.add" && id !== "base.view.remove") return null;
      return (async () => {
        const args = raw as { doc?: unknown; view?: unknown; key?: unknown; value?: unknown; name?: unknown; type?: unknown; base?: unknown };
        if (args.doc !== BASE_DOC) throw { kind: "bad_args", message: "base finta: gesto sconosciuto" };
        const now = await host().revision(BASE_DOC);
        if (typeof args.base === "string" && args.base !== now) throw { kind: "conflict", message: `conflict: «${BASE_DOC}» è cambiato sotto` };
        if (id === "base.view.add") {
          if (typeof args.name !== "string" || typeof args.type !== "string" || views.some((entries) => entries.get("name") === args.name)) throw { kind: "bad_args", message: "base finta: vista già presente" };
          views.push(view([["name", args.name], ["type", args.type]]));
        } else if (id === "base.view.remove") {
          const at = views.findIndex((entries) => entries.get("name") === args.view);
          if (at < 0) throw { kind: "not_found", message: "base finta: vista assente" };
          views.splice(at, 1);
        } else {
          const entries = named(args.view);
          if (!entries || typeof args.key !== "string") throw { kind: "bad_args", message: "base finta: gesto sconosciuto" };
          if (typeof args.value === "string") entries.set(args.key, JSON.parse(args.value) as Json);
          else entries.delete(args.key);
        }
        await host().writeByCommand(BASE_DOC, serialize(views));
        return { notify: null, effect: { kind: "custom", ns: "fub.base", payload: { revision: await host().revision(BASE_DOC) } }, undo: null, partial: null };
      })();
    },
  };
}
