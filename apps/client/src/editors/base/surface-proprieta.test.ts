// @vitest-environment happy-dom
//
// Una Base nuova su una cartella di note con il frontmatter (IMP-147,
// IMP-413, IMP-616): le proprietà delle note devono arrivare a Proprietà,
// Filtro, Bacheca e Calendario anche quando la vista non ne chiede ancora
// nessuna. Il core finto si comporta come quello vero dove conta: l'indice
// rispetta la selezione delle proprietà (`select`), il piano chiede solo le
// proprietà che la vista nomina (`required_props` di `fub-features`, senza
// `all_properties`), e `derive` vede solo le proprietà che riceve.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import { closeContextMenu } from "../../ui/menu";
import { mountBaseSurface } from "./surface";

vi.mock("../../ui/notify", () => ({ notify: () => {} }));

type Value = { kind: string; value?: unknown };
interface Note { doc: string; properties: { key: string; value: Value }[] }
interface View { name: string; type: string; keys: Record<string, unknown> }

const text = (value: string): Value => ({ kind: "text", value });
const day = (iso: string): Value => {
  const [year, month, date] = iso.split("-").map(Number);
  return { kind: "date", value: { year, month, day: date, time: null } };
};
const note = (doc: string, stato: string, parole: number, uscita: string, pubblicato: boolean, categorie: string[]): Note => ({
  doc,
  properties: [
    { key: "stato", value: text(stato) },
    { key: "parole", value: { kind: "number", value: parole } },
    { key: "uscita", value: day(uscita) },
    { key: "pubblicato", value: { kind: "bool", value: pubblicato } },
    { key: "categorie", value: { kind: "list", value: categorie.map(text) } },
  ],
});
// Le note della cartella della Base, come le scrive l'ispettore: testo,
// numero, data ISO, casella ed elenco. Fuori dalla cartella, una nota con
// un'altra proprietà.
const NOTES: Note[] = [
  note("Redazione/Il pane della nonna.md", "Bozza", 820, "2026-11-28", false, ["Pane", "Forno"]),
  note("Redazione/Il brodo lungo.md", "Pubblicato", 1200, "2026-12-12", true, ["Brodi"]),
  note("Redazione/Le zucchine di Giulia.md", "Bozza", 640, "2026-11-05", false, ["Orto"]),
  { doc: "Spesa/Mercato.md", properties: [{ key: "luogo", value: text("Piazza") }] },
];
const IN_FOLDER = (doc: string) => doc.startsWith("Redazione/");
const REGISTRY = JSON.stringify({
  version: 1,
  types: { stato: "status", uscita: "date", parole: "number" },
  options: { stato: [{ name: "Bozza", color: "gray", group: "todo" }, { name: "Pubblicato", color: "green", group: "done" }] },
});

const plain = (key: string) => key.replace(/^prop\./, "");
// Le proprietà che un filtro nomina, come `collect_filter` del core.
const filterKeys = (filter: unknown): string[] => {
  if (!filter || typeof filter !== "object") return [];
  const node = filter as { condition?: { property?: string }; and?: unknown[]; or?: unknown[]; not?: unknown };
  if (node.condition?.property) return [plain(node.condition.property)];
  return [...(node.and ?? []), ...(node.or ?? []), ...(node.not ? [node.not] : [])].flatMap(filterKeys);
};
const isoOf = (value: Value | undefined): string | null => {
  if (value?.kind !== "date") return null;
  const { year, month, day } = value.value as { year: number; month: number; day: number };
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
// Una condizione come la valuta il core, per le forme che la prova scrive.
const keeps = (filter: unknown, props: Map<string, Value>): boolean => {
  if (!filter || filter === "all" || typeof filter !== "object") return true;
  const node = filter as { condition?: { property?: string; op: string; value?: unknown }; and?: unknown[] };
  if (node.and) return node.and.every((each) => keeps(each, props));
  const condition = node.condition;
  if (!condition?.property) return true;
  const found = props.get(plain(condition.property));
  if (found === undefined) return false;
  const iso = isoOf(found);
  if (condition.op === "less_than") return iso !== null && iso < String(condition.value);
  if (condition.op === "is") return String(found.value) === String(condition.value);
  throw new Error(`operatore non previsto ${condition.op}`);
};
const cell = (value: Value): unknown => {
  const iso = isoOf(value);
  if (iso !== null) return { kind: "date", value: Date.parse(`${iso}T00:00:00Z`) };
  if (value.kind === "list") return { kind: "list", value: (value.value as Value[]).map(cell) };
  return value;
};

const mount = (views: View[]) => {
  let revision = 1;
  const host = document.createElement("div");
  document.body.append(host);
  const source = () => [
    "filters:", "  condition:", "    file: path", "    op: in_folder", '    value: "Redazione"', "views:",
    ...views.flatMap((view) => [`  - name: ${view.name}`, `    type: ${view.type}`, ...Object.entries(view.keys).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)]), "",
  ].join("\n");
  const viewOf = (name: unknown) => views.find((view) => view.name === name) ?? views[0]!;
  const required = (view: View): string[] => [...new Set([
    ...((view.keys.order as string[] | undefined) ?? []).map(plain),
    ...filterKeys(view.keys.filters),
    ...(view.keys.group ? [plain((view.keys.group as { key: string }).key)] : []),
    ...(typeof view.keys.date === "string" ? [plain(view.keys.date)] : []),
  ])];
  const derivedProps: string[][] = [];
  const queryIndex = async (request: IndexQuery): Promise<IndexResult> => {
    if (request.kind === "documents") {
      const select = request.select;
      const items = NOTES.map(({ doc, properties }) => ({
        doc,
        properties: select?.kind === "none" ? [] : select?.kind === "keys" ? properties.filter(({ key }) => select.keys.includes(key)) : properties,
      }));
      return { kind: "documents", value: { offset: 0, total: items.length, items } } as IndexResult;
    }
    const query = request.kind === "custom" ? request.query as { op: string; view?: string | null; rows?: { doc: string; props: Record<string, Value> }[] } : null;
    if (!query) throw new Error("unexpected query");
    if (query.op === "parse") return { kind: "custom", value: { views: views.map((view) => view.name), types: views.map((view) => view.type) } };
    const view = viewOf(query.view);
    if (query.op === "plan") {
      return { kind: "custom", value: {
        view: view.name, view_type: view.type, columns: (view.keys.order as string[] | undefined) ?? [], column_labels: {},
        required_props: required(view), all_properties: false,
        group: (view.keys.group as { key: string } | undefined)?.key ?? null, limit: null, map: null, create_defaults: {},
        filters: view.keys.filters ?? "all", sort: [], order: view.keys.order ?? [], summaries: [],
        date_key: (view.keys.date as string | undefined) ?? null, start_key: null, end_key: null,
      } };
    }
    if (query.op === "derive") {
      const input = query.rows ?? [];
      derivedProps.push([...new Set(input.flatMap((row) => Object.keys(row.props)))].sort());
      const wanted = [...((view.keys.order as string[] | undefined) ?? []).map(plain), ...(view.keys.group ? [plain((view.keys.group as { key: string }).key)] : [])];
      const rows = input
        .filter((row) => IN_FOLDER(row.doc))
        .filter((row) => keeps(view.keys.filters, new Map(Object.entries(row.props))))
        .map((row) => ({
          doc: row.doc,
          values: Object.fromEntries(wanted.filter((key) => row.props[key] !== undefined).map((key) => [key, cell(row.props[key]!)])),
        }));
      return { kind: "custom", value: { rows, summaries: {} } };
    }
    throw new Error("unexpected Base operation");
  };
  const written = () => {
    revision++;
    setTimeout(() => surface.buffer.syncDoc(source()), 0);
    return { effect: { kind: "custom", ns: "fub.base", payload: { revision: `r${revision}` } }, undo: { label: "Rimetti" } };
  };
  const invokeCommand = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "base.view.set") {
      const view = viewOf(args.view);
      if (args.value === undefined) delete view.keys[args.key as string];
      else view.keys[args.key as string] = JSON.parse(args.value as string);
      return { notify: `${String(args.key)} scritto`, ...written() };
    }
    if (command === "base.view.add") { views.push({ name: args.name as string, type: args.type as string, keys: {} }); return { notify: "Vista aggiunta", ...written() }; }
    return {};
  });
  const surface = mountBaseSurface("base", { paneId: "base-proprieta", documentId: "Redazione/Articoli.base", parent: host }, {
    queryIndex, invokeCommand,
    viewState: async () => null as never, setViewState: async () => {},
    onOpenDocument: () => {}, revision: () => `r${revision}`,
    propertyTypes: async () => REGISTRY,
  });
  surface.buffer.setDoc(source());
  return { host, invokeCommand, views, derivedProps, done: () => { surface.destroy(); host.remove(); } };
};

const rowsShown = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".base-table tbody tr[data-doc]")].map((row) => row.dataset.doc);
const settled = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelector(".base-bar")!.getAttribute("aria-busy")).toBe("false"));
const popover = (className: string) => document.querySelector<HTMLElement>(`.${className}`)!;
const press = (root: ParentNode, label: string): void => {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === label);
  if (!button) throw new Error(`nessun pulsante «${label}»`);
  button.click();
};
const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")].find((each) => each.querySelector(".menu-label")?.textContent === label);

afterEach(() => { closeContextMenu(); document.querySelectorAll(".base-filter-popover, .base-columns-popover").forEach((each) => each.remove()); });

describe("una Base nuova vede le proprietà delle note della sua cartella", () => {
  it("Proprietà le elenca, e una spuntata diventa una colonna coi valori", async () => {
    const { host, invokeCommand, derivedProps, done } = mount([{ name: "Tabella", type: "table", keys: {} }]);
    try {
      await vi.waitFor(() => expect(rowsShown(host)).toHaveLength(3));
      await settled(host);
      host.querySelector<HTMLButtonElement>(".base-tool-columns")!.click();
      const listed = () => [...popover("base-columns-popover").querySelectorAll<HTMLLIElement>(".base-column:not(.base-column-fixed)")].map((item) => item.dataset.column);
      // Tutte le proprietà delle note; quella della nota fuori cartella dopo.
      expect(listed()).toEqual(expect.arrayContaining(["stato", "parole", "uscita", "pubblicato", "categorie"]));
      expect(popover("base-columns-popover").textContent).not.toContain("non hanno ancora proprietà");
      popover("base-columns-popover").querySelector<HTMLInputElement>('.base-column[data-column="stato"] input')!.click();
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("base.view.set", expect.objectContaining({ key: "order", value: JSON.stringify(["stato"]) })));
      await vi.waitFor(() => expect(host.querySelector('.base-table th[data-column="stato"]')).not.toBeNull());
      const cellOf = (doc: string) => host.querySelector<HTMLInputElement>(`.base-table tr[data-doc="${doc}"] .base-cell[data-column="stato"] input`);
      await vi.waitFor(() => expect(cellOf("Redazione/Il brodo lungo.md")?.value).toBe("Pubblicato"));
      expect(cellOf("Redazione/Il pane della nonna.md")!.value).toBe("Bozza");
      // A `derive` vanno solo le proprietà che il piano chiede.
      expect(derivedProps[0]).toEqual([]);
      expect(derivedProps[derivedProps.length - 1]).toEqual(["stato"]);
    } finally { done(); }
  });

  it("il filtro propone la data e «minore di» una data tiene le note giuste", async () => {
    const { host, invokeCommand, views, done } = mount([{ name: "Tabella", type: "table", keys: {} }]);
    try {
      await vi.waitFor(() => expect(rowsShown(host)).toHaveLength(3));
      await settled(host);
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      const pop = popover("base-filter-popover");
      press(pop, "Aggiungi una condizione");
      const subject = pop.querySelector<HTMLSelectElement>(".base-filter-subject")!;
      expect([...subject.options].map((option) => option.value)).toEqual(expect.arrayContaining(["stato", "parole", "uscita", "pubblicato", "categorie"]));
      subject.value = "uscita";
      subject.dispatchEvent(new Event("change"));
      const op = popover("base-filter-popover").querySelector<HTMLSelectElement>(".base-filter-op")!;
      // Una data non si filtra con «contiene».
      expect([...op.options].map((option) => option.value)).not.toContain("contains");
      op.value = "less_than";
      op.dispatchEvent(new Event("change"));
      const value = popover("base-filter-popover").querySelector<HTMLInputElement>(".base-filter-value")!;
      value.value = "2026-12-01";
      value.dispatchEvent(new Event("input"));
      press(popover("base-filter-popover"), "Applica");
      const filter = { condition: { property: "uscita", op: "less_than", value: "2026-12-01" } };
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("base.view.set", expect.objectContaining({ key: "filters", value: JSON.stringify(filter) })));
      expect(views[0]!.keys.filters).toEqual(filter);
      await vi.waitFor(() => expect(rowsShown(host).sort()).toEqual(["Redazione/Il pane della nonna.md", "Redazione/Le zucchine di Giulia.md"]));
    } finally { done(); }
  });

  it("Bacheca e Calendario si accendono senza colonne, e la bacheca raggruppa per stato", async () => {
    const { host, invokeCommand, views, done } = mount([{ name: "Tabella", type: "table", keys: {} }]);
    try {
      await vi.waitFor(() => expect(rowsShown(host)).toHaveLength(3));
      await settled(host);
      host.querySelector<HTMLButtonElement>(".base-tool-new-view")!.click();
      await vi.waitFor(() => expect(menuItem("Bacheca")).toBeDefined());
      expect(menuItem("Calendario")!.disabled).toBe(false);
      expect(menuItem("Bacheca")!.disabled).toBe(false);
      menuItem("Bacheca")!.click();
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("base.view.set", expect.objectContaining({ view: "Bacheca", key: "group", value: JSON.stringify({ key: "stato" }) })));
      expect(views.map((view) => view.name)).toEqual(["Tabella", "Bacheca"]);
      await vi.waitFor(() => expect(host.querySelectorAll(".base-kanban-card")).toHaveLength(3));
      const lane = (name: string) => [...host.querySelectorAll<HTMLElement>(`.base-kanban-column[data-group="${name}"] .base-kanban-card`)].map((card) => card.dataset.doc).sort();
      expect(lane("Bozza")).toEqual(["Redazione/Il pane della nonna.md", "Redazione/Le zucchine di Giulia.md"]);
      expect(lane("Pubblicato")).toEqual(["Redazione/Il brodo lungo.md"]);
    } finally { done(); }
  });
});
