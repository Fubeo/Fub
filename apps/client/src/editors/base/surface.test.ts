// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import { forwardNotice } from "../../state/kernel";
import type { SurfaceMenuItem } from "../core/editor-menu";
import { mountBaseSurface } from "./surface";
import type { BaseDocumentWrites } from "./data";
import { filterProperties, parseFilter } from "./filter";
import type { NoticeAction } from "../../ui/notify";

// Gli avvisi della shell: la prova guarda che cosa la Base dice e quale gesto
// offre, senza il centro avvisi.
const notified = vi.hoisted(() => [] as { message: string; tone?: string; action?: unknown }[]);
vi.mock("../../ui/notify", () => ({
  notify: (message: string, tone?: string, action?: unknown) => { notified.push({ message, tone, action }); },
}));

const count = 20_000;
const values = Array.from({ length: count }, (_, index) => ({
  doc: `${String(index).padStart(5, "0")}.md`,
  values: { status: { kind: "text", value: "ready" } },
}));

function query(query: IndexQuery): Promise<IndexResult> {
  if (query.kind === "documents") {
    const offset = query.page?.offset ?? 0;
    return Promise.resolve({ kind: "documents", value: {
      offset, total: count,
      items: Array.from({ length: Math.min(256, count - offset) }, (_, index) => ({
        doc: values[offset + index]!.doc, properties: [],
      })),
    } });
  }
  if (query.kind !== "custom" || typeof query.query !== "object" || !query.query) throw new Error("unexpected query");
  if (!("op" in query.query) || typeof query.query.op !== "string") throw new Error("malformed Base operation");
  const request = query.query;
  if (request.op === "parse") return Promise.resolve({ kind: "custom", value: { views: ["Table"] } });
  if (request.op === "plan") return Promise.resolve({ kind: "custom", value: {
    view: "Table", view_type: "table", columns: ["status"], column_labels: {},
    required_props: [], all_properties: false, group: null, limit: null, map: null, create_defaults: {},
  } });
  if (request.op === "derive") return Promise.resolve({ kind: "custom", value: { rows: values, summaries: {} } });
  throw new Error("unexpected Base operation");
}

describe("Base table windows", () => {
  it("scrolls twenty thousand derived notes with bounded DOM and invalidates on member changes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const queries = vi.fn(query);
    const surface = mountBaseSurface("base", { paneId: "base-test", documentId: "views/all.base", parent: host }, {
      queryIndex: queries,
      invokeCommand: vi.fn(async () => ({})),
      viewState: async () => null,
      setViewState: async () => {},
      onOpenDocument: () => {},
    });
    try {
      surface.buffer.setDoc("views:\n  - {name: Table, type: table}\n");
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBeGreaterThan(0));
      expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBeLessThan(50);
      const viewport = host.querySelector<HTMLElement>(".base-table-viewport")!;
      viewport.scrollTop = 10_000 * 38;
      viewport.dispatchEvent(new Event("scroll"));
      expect(host.querySelector('[data-doc="10000.md"]')).not.toBeNull();
      expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBeLessThan(50);
      const before = queries.mock.calls.filter(([q]) => q.kind === "documents").length;
      forwardNotice({ event: { type: "document_changed", id: "member.md", changes: { aspects: ["frontmatter"], properties: ["status"], tags_added: [], tags_removed: [] } }, origin: { actor: { kind: "kernel" }, batch: null } });
      await vi.waitFor(() => expect(queries.mock.calls.filter(([q]) => q.kind === "documents").length).toBeGreaterThan(before));
    } finally {
      surface.destroy();
      host.remove();
    }
  });

  it("al primo disegno mostra le righe che stanno nel tetto, anche se la finestra vuota è bassa", async () => {
    // Una finestra con l'altezza del contenuto: vuota, è alta quanto
    // l'intestazione. Prima la Base disegnava allora tre righe su otto.
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("base-table-viewport") ? 36 : 0;
    });
    const host = document.createElement("div");
    document.body.append(host);
    const surface = mountBaseSurface("base", { paneId: "base-first", documentId: "views/all.base", parent: host }, {
      queryIndex: query,
      invokeCommand: vi.fn(async () => ({})),
      viewState: async () => null,
      setViewState: async () => {},
      onOpenDocument: () => {},
    });
    try {
      surface.buffer.setDoc("views:\n  - {name: Table, type: table}\n");
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBeGreaterThan(0));
      // Il tetto è 560 px a righe di 36: almeno quindici righe.
      expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBeGreaterThanOrEqual(15);
    } finally {
      surface.destroy();
      host.remove();
      height.mockRestore();
    }
  });

  it("never fetches configured tiles before a gesture and reports blocked requests", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const fetchTile = vi.fn(async (_url: string) => { throw new Error("blocked"); });
    vi.stubGlobal("fetch", fetchTile);
    const queryIndex = async (request: IndexQuery): Promise<IndexResult> => {
      if (request.kind === "documents") return { kind: "documents", value: { total: 1, offset: 0, items: [{ doc: "pin.md", properties: [] }] } };
      if (request.kind !== "custom" || typeof request.query !== "object" || !request.query) throw new Error("unexpected");
      if (!("op" in request.query) || typeof request.query.op !== "string") throw new Error("malformed operation");
      const op = request.query.op;
      if (op === "parse") return { kind: "custom", value: { views: ["Map"] } };
      if (op === "plan") return { kind: "custom", value: {
        view: "Map", view_type: "map", columns: [], column_labels: {}, required_props: [], all_properties: false,
        group: null, limit: null, create_defaults: {},
        map: { lat_key: "lat", lon_key: "lon", label_key: null, color_key: null,
          provider: { kind: "raster", network: true, url_template: "https://tiles.example.test/{z}/{x}/{y}.png", attribution: "Tiles" } },
      } };
      return { kind: "custom", value: { rows: [{ doc: "pin.md", values: { lat: { kind: "number", value: 0 }, lon: { kind: "number", value: 0 } } }], summaries: {} } };
    };
    const surface = mountBaseSurface("base", { paneId: "base-map", documentId: "views/map.base", parent: host }, {
      queryIndex, invokeCommand: vi.fn(async () => ({})), viewState: async () => null,
      setViewState: async () => {}, onOpenDocument: () => {}, mapTileHosts: ["tiles.example.test"],
    });
    try {
      surface.buffer.setDoc("views:\n  - {name: Map, type: map}\n");
      await vi.waitFor(() => expect(host.querySelector(".base-map")).not.toBeNull());
      expect(fetchTile).not.toHaveBeenCalled();
      host.querySelector<HTMLButtonElement>(".base-map button")!.click();
      await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledTimes(1));
      expect(fetchTile.mock.calls[0]?.[0]).toBe("https://tiles.example.test/1/0/0.png");
    } finally {
      surface.destroy();
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe("Base raggruppata", () => {
  const rows = [
    { doc: "a.md", values: { status: { kind: "text", value: "fatto" } } },
    { doc: "b.md", values: { status: { kind: "text", value: "aperto" } } },
    { doc: "c.md", values: { status: { kind: "text", value: "fatto" } } },
    { doc: "d.md", values: { status: { kind: "empty" } } },
  ];
  const grouped = (viewType: string) => (request: IndexQuery): Promise<IndexResult> => {
    if (request.kind === "documents") {
      return Promise.resolve({ kind: "documents", value: { offset: 0, total: rows.length, items: rows.map(({ doc }) => ({ doc, properties: [] })) } });
    }
    if (request.kind !== "custom" || typeof request.query !== "object" || !request.query || !("op" in request.query)) throw new Error("unexpected query");
    const op = request.query.op;
    if (op === "parse") return Promise.resolve({ kind: "custom", value: { views: ["Vista"] } });
    if (op === "plan") return Promise.resolve({ kind: "custom", value: {
      view: "Vista", view_type: viewType, columns: ["status"], column_labels: {},
      required_props: [], all_properties: false, group: "status", limit: null, map: null, create_defaults: {},
    } });
    if (op === "derive") return Promise.resolve({ kind: "custom", value: { rows, summaries: {} } });
    throw new Error("unexpected Base operation");
  };
  const mount = (viewType: string, saved: Record<string, unknown> = {}) => {
    const host = document.createElement("div");
    document.body.append(host);
    const setViewState = vi.fn(async () => {});
    const surface = mountBaseSurface("base", { paneId: `base-${viewType}`, documentId: "views/gruppi.base", parent: host }, {
      queryIndex: grouped(viewType),
      invokeCommand: vi.fn(async () => ({})),
      viewState: async <T,>(key: string) => (saved[key] ?? null) as T | null,
      setViewState,
      onOpenDocument: () => {},
    });
    surface.buffer.setDoc(`views:\n  - {name: Vista, type: ${viewType}, group: {key: status}}\n`);
    return { host, setViewState, done: () => { surface.destroy(); host.remove(); } };
  };
  const toggles = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLButtonElement>(".base-group-toggle")].map((toggle) => toggle.textContent);
  // «Raggruppa» sta in «Ordina»: il popover lo porta nel documento.
  const grouping = (host: HTMLElement, selector: string): HTMLSelectElement => {
    if (!document.querySelector(selector)) host.querySelector<HTMLButtonElement>(".base-tool-sort")!.click();
    return document.querySelector<HTMLSelectElement>(selector)!;
  };

  it("la tabella intercala un'intestazione per gruppo, nell'ordine della vista, e un gruppo si chiude", async () => {
    const { host, done } = mount("table");
    try {
      await vi.waitFor(() => expect(toggles(host)).toEqual(["fatto (2)", "aperto (1)", "∅ (1)"]));
      const docs = () => [...host.querySelectorAll<HTMLElement>(".base-table tbody tr[data-doc]")].map((tr) => tr.dataset.doc);
      expect(docs()).toEqual(["a.md", "c.md", "b.md", "d.md"]);
      const first = host.querySelector<HTMLButtonElement>(".base-group-toggle")!;
      expect(first.getAttribute("aria-expanded")).toBe("true");
      first.click();
      expect(docs()).toEqual(["b.md", "d.md"]);
      expect(host.querySelector(".base-group-toggle")!.getAttribute("aria-expanded")).toBe("false");
      host.querySelector<HTMLButtonElement>(".base-group-toggle")!.click();
      expect(docs()).toEqual(["a.md", "c.md", "b.md", "d.md"]);
    } finally { done(); }
  });

  it("«Raggruppa» nella barra toglie i gruppi e lo ricorda per vista, senza riscrivere il file", async () => {
    const { host, setViewState, done } = mount("table");
    try {
      await vi.waitFor(() => expect(toggles(host)).toHaveLength(3));
      const select = grouping(host, ".base-group-by");
      expect(select.hidden).toBe(false);
      expect(select.value).toBe("status");
      select.value = "";
      select.dispatchEvent(new Event("change"));
      expect(toggles(host)).toEqual([]);
      await vi.waitFor(() => expect(setViewState).toHaveBeenCalledWith("base.group:views/gruppi.base:Vista", ""));
    } finally { done(); }
    const again = mount("table", { "base.group:views/gruppi.base:Vista": "" });
    try {
      await vi.waitFor(() => expect(again.host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(4));
      expect(toggles(again.host)).toEqual([]);
      expect(grouping(again.host, ".base-group-by").value).toBe("");
    } finally { again.done(); }
  });

  it("l'ordine dei gruppi si sceglie per vista, il gruppo vuoto resta in fondo, e si ricorda", async () => {
    const { host, setViewState, done } = mount("table");
    try {
      await vi.waitFor(() => expect(toggles(host)).toHaveLength(3));
      const order = grouping(host, ".base-group-order");
      expect(order.hidden).toBe(false);
      expect(order.value).toBe("rows");
      order.value = "asc";
      order.dispatchEvent(new Event("change"));
      expect(toggles(host)).toEqual(["aperto (1)", "fatto (2)", "∅ (1)"]);
      order.value = "desc";
      order.dispatchEvent(new Event("change"));
      expect(toggles(host)).toEqual(["fatto (2)", "aperto (1)", "∅ (1)"]);
      await vi.waitFor(() => expect(setViewState).toHaveBeenCalledWith("base.group-order:views/gruppi.base:Vista", "desc"));
      const select = grouping(host, ".base-group-by");
      select.value = "";
      select.dispatchEvent(new Event("change"));
      expect(order.hidden).toBe(true);
    } finally { done(); }
    const again = mount("cards", { "base.group-order:views/gruppi.base:Vista": "asc" });
    try {
      await vi.waitFor(() => expect(again.host.querySelectorAll("section.base-group").length).toBe(3));
      expect([...again.host.querySelectorAll<HTMLElement>("section.base-group")].map((s) => s.dataset.group)).toEqual(["aperto", "fatto", ""]);
    } finally { again.done(); }
  });

  it("schede ed elenco mettono ogni gruppo nella sua sezione", async () => {
    for (const viewType of ["cards", "list"]) {
      const { host, done } = mount(viewType);
      try {
        await vi.waitFor(() => expect(host.querySelectorAll("section.base-group").length).toBe(3));
        const section = host.querySelector<HTMLElement>('section.base-group[data-group="fatto"]')!;
        expect([...section.querySelectorAll<HTMLElement>(".base-card")].map((card) => card.dataset.doc)).toEqual(["a.md", "c.md"]);
        section.querySelector<HTMLButtonElement>(".base-group-toggle")!.click();
        expect(host.querySelector('section.base-group[data-group="fatto"] .base-card')).toBeNull();
      } finally { done(); }
    }
  });
});

describe("il tasto destro nella base", () => {
  it("su una cella offre il valore e la nota della riga; sull'intestazione la colonna", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const opened: string[] = [];
    const invokeCommand = vi.fn(async () => ({}));
    const surface = mountBaseSurface("base", { paneId: "base-menu", documentId: "views/all.base", parent: host }, {
      queryIndex: query,
      invokeCommand,
      viewState: async () => null,
      setViewState: async () => {},
      onOpenDocument: (doc) => void opened.push(doc),
    });
    const pointing = vi.spyOn(document, "elementFromPoint");
    try {
      surface.buffer.setDoc("views:\n  - {name: Table, type: table}\n");
      await vi.waitFor(() => expect(host.querySelector('[data-doc="00000.md"] .base-cell')).not.toBeNull());
      pointing.mockReturnValue(host.querySelector('[data-doc="00000.md"] .base-cell input'));
      const menu = surface.contextMenu!({ x: 1, y: 1 })!;
      expect(menu.target).toEqual({ kind: "cell", ref: "status" });
      expect(menu.note).toEqual({ kind: "note", id: "00000.md" });
      const items = menu.context as readonly SurfaceMenuItem[];
      expect(items.map((item) => item.id)).toEqual(["base.cell.copy", "base.cell.search", "base.cell.clear", "base.row.open", "base.row.copy_link", "base.row.copy"]);
      items.find((item) => item.id === "base.row.open")!.run!();
      expect(opened).toEqual(["00000.md"]);
      items.find((item) => item.id === "base.cell.search")!.run!();
      expect(host.querySelector<HTMLInputElement>(".base-search")!.value).toBe("ready");

      pointing.mockReturnValue(host.querySelector('th[data-column="status"]'));
      const column = surface.contextMenu!({ x: 1, y: 1 })!;
      expect(column.target).toEqual({ kind: "column", ref: "status", name: "status" });
      // Le voci del clic sull'intestazione, negli stessi gruppi.
      expect(column.context!.map((item) => typeof item === "string" ? item : item.id)).toEqual([
        "base.column.sort.asc", "base.column.sort.desc", "—", "base.column.group", "base.column.summary",
        "—", "base.column.rename", "base.column.type", "—", "base.column.copy", "base.column.hide",
      ]);

      surface.setReadOnly!(true);
      pointing.mockReturnValue(host.querySelector('[data-doc="00000.md"] .base-cell'));
      const locked = surface.contextMenu!({ x: 1, y: 1 })!;
      expect((locked.context as readonly SurfaceMenuItem[]).find((item) => item.id === "base.cell.clear")!.enabled).toBe(false);
      expect(invokeCommand).not.toHaveBeenCalled();
    } finally {
      pointing.mockRestore();
      surface.destroy();
      host.remove();
    }
  });
});

describe("la barra della Base scrive solo la chiave toccata", () => {
  interface Keys { filters?: unknown; sort?: unknown; order?: unknown }
  const notes = [
    { doc: "Opere/Nebbia.md", properties: [{ key: "stato", value: "Arrivata" }, { key: "artista", value: "Elena Sala" }, { key: "consegna", value: "2026-11-10" }] },
    { doc: "Opere/Campo.md", properties: [{ key: "stato", value: "In prestito" }, { key: "artista", value: "Pietro Neri" }, { key: "consegna", value: "2026-11-20" }] },
  ];
  const KEYS = ["filters", "sort", "order"] as const;
  // Il file come lo riscriverebbe il core: una riga per chiave, perché la
  // prova guardi quali righe «Nel file .base» mostra.
  const text = (keys: Keys) => [
    "views:", "  - name: Tabella", "    type: table",
    ...KEYS.filter((key) => keys[key] !== undefined).map((key) => `    ${key}: ${JSON.stringify(keys[key])}`),
    "  - name: Bacheca", "    type: kanban", "",
  ].join("\n");
  type Fail = { kind: string; message: string } | null;
  interface MountOptions {
    sourceInNote?: boolean;
    container?: string | null;
    documentWrites?: BaseDocumentWrites;
    onOpenDocument?: (doc: string) => void;
    /// Le note al posto di quelle della prova: valori nella forma del contratto.
    rows?: { doc: string; properties: { key: string; value: unknown }[] }[];
    /// `base.view.set` risponde «niente da cambiare», senza revisione.
    unchanged?: boolean;
    /// Come il core: il piano chiede solo le proprietà delle colonne e del
    /// filtro, le righe arrivano con quelle, e il filtro toglie le righe.
    narrow?: boolean;
    /// Anche la seconda vista è una tabella.
    twoTables?: boolean;
  }
  // Un filtro della prova come lo applicherebbe il core, per le sole forme
  // che le prove scrivono: una condizione «contiene» o «è» su una proprietà.
  const keeps = (filter: unknown, properties: { key: string; value: unknown }[]): boolean => {
    const condition = (filter as { condition?: { property?: string; op: string; value?: unknown } }).condition;
    if (!condition?.property) return true;
    const found = properties.find(({ key }) => key === condition.property);
    if (!found) return false;
    const text = String((found.value as { value?: unknown })?.value ?? found.value).toLowerCase();
    const wanted = String(condition.value).toLowerCase();
    return condition.op === "is" ? text === wanted : text.includes(wanted);
  };
  const mount = (initial: Keys = {}, { documentWrites, onOpenDocument, rows: ownRows, unchanged, narrow, twoTables, ...options }: MountOptions = {}) => {
    const keys: Keys = { ...initial };
    const rows = ownRows ?? notes;
    let revision = 1;
    let fail: Fail = null;
    const host = document.createElement("div");
    document.body.append(host);
    const queryIndex = async (request: IndexQuery): Promise<IndexResult> => {
      if (request.kind === "documents") {
        const select = request.select;
        const items = select?.kind === "keys" ? rows.map(({ doc, properties }) => ({ doc, properties: properties.filter(({ key }) => select.keys.includes(key)) })) : rows;
        return { kind: "documents", value: { offset: 0, total: rows.length, items } };
      }
      if (request.kind !== "custom" || typeof request.query !== "object" || !request.query || !("op" in request.query)) throw new Error("unexpected query");
      const query = request.query as { op: string; view?: string | null };
      if (query.op === "parse") return { kind: "custom", value: { views: ["Tabella", "Bacheca"], types: ["table", twoTables ? "table" : "kanban"] } };
      if (query.op === "plan") {
        const board = query.view === "Bacheca";
        const columns = (keys.order as string[] | undefined) ?? ["stato", "artista"];
        const required = [...new Set([...columns, ...(board ? [] : filterProperties(parseFilter(keys.filters ?? "all")))])];
        return { kind: "custom", value: {
          view: board ? "Bacheca" : "Tabella", view_type: board && !twoTables ? "kanban" : "table",
          columns, column_labels: {},
          required_props: narrow ? required : [], all_properties: !narrow, group: board && !twoTables ? "stato" : null, limit: null, map: null, create_defaults: {},
          filters: board ? "all" : keys.filters ?? "all", sort: board ? [] : keys.sort ?? [], order: board ? [] : keys.order ?? [],
        } };
      }
      if (query.op === "derive") {
        const shown = narrow && query.view !== "Bacheca" ? rows.filter(({ properties }) => keeps(keys.filters ?? "all", properties)) : rows;
        return { kind: "custom", value: { summaries: {}, rows: shown.map(({ doc, properties }) => ({
          doc, values: Object.fromEntries(properties.map(({ key, value }) => [key, { kind: "text", value: String(value) }])),
        })) } };
      }
      throw new Error("unexpected Base operation");
    };
    const invokeCommand = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== "base.view.set") return {};
      if (fail) throw fail;
      if (unchanged) return { notify: "Niente da cambiare", effect: { kind: "none" }, undo: null };
      const key = args!.key as keyof Keys;
      if (args!.value === undefined) delete keys[key];
      else keys[key] = JSON.parse(args!.value as string);
      revision++;
      return { notify: `${key} scritto`, effect: { kind: "custom", ns: "fub.base", payload: { revision: `r${revision}` } }, undo: { label: `Rimetti ${key}` } };
    });
    const surface = mountBaseSurface("base", { paneId: "base-gesti", documentId: "Opere.base", parent: host }, {
      queryIndex, invokeCommand, viewState: async () => null, setViewState: async () => {}, onOpenDocument: onOpenDocument ?? (() => {}),
      revision: () => `r${revision}`, documentWrites,
    }, options);
    surface.buffer.setDoc(text(keys));
    return {
      host, surface, invokeCommand,
      failNext: (next: Fail) => { fail = next; },
      // L'host rimanda il testo del file dopo il comando, come la sessione.
      deliver: () => surface.buffer.syncDoc(text(keys)),
      // Il file cambiato da un'altra parte: un'altra finestra, il sorgente.
      changeElsewhere: (change: (keys: Keys) => void) => { change(keys); revision++; surface.buffer.syncDoc(text(keys)); },
      done: () => { surface.destroy(); host.remove(); },
    };
  };
  const ready = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(2));
  const press = (root: ParentNode, label: string): void => {
    const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === label);
    if (!button) throw new Error(`nessun pulsante «${label}»`);
    button.click();
  };
  const popover = (className: string) => document.querySelector<HTMLElement>(`.${className}`)!;
  const chips = (host: HTMLElement) => [...host.querySelectorAll(".base-chip-text")].map((chip) => chip.textContent);
  const lastSet = (invokeCommand: ReturnType<typeof vi.fn>) => {
    const sets = invokeCommand.mock.calls.filter(([command]) => command === "base.view.set");
    return sets[sets.length - 1]?.[1] as Record<string, unknown> | undefined;
  };
  const settled = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelector(".base-bar")!.getAttribute("aria-busy")).toBe("false"));

  it("il filtro composto a vista scrive `filters` con la revisione, e «Nel file .base» mostra la riga", async () => {
    const { host, invokeCommand, deliver, done } = mount();
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      const pop = popover("base-filter-popover");
      expect(pop.querySelector(".base-pop-title")!.textContent).toBe("Filtro della vista Tabella");
      press(pop, "Aggiungi una condizione");
      const value = pop.querySelector<HTMLInputElement>(".base-filter-value")!;
      value.value = "Arrivata";
      value.dispatchEvent(new Event("input"));
      // La ricerca sa dire solo «contiene», e lo dice.
      expect(pop.querySelector<HTMLInputElement>(".base-filter-search")!.value).toBe("[stato:Arrivata]");
      expect(pop.textContent).toContain("Come ricerca «è» diventa «contiene»");
      press(pop, "Applica");
      const filter = { condition: { property: "stato", op: "is", value: "Arrivata" } };
      expect(lastSet(invokeCommand)).toEqual({ doc: "Opere.base", view: "Tabella", key: "filters", value: JSON.stringify(filter), base: "r1" });
      deliver();
      await vi.waitFor(() => expect(host.querySelector<HTMLDetailsElement>(".base-written")!.hidden).toBe(false));
      expect([...host.querySelectorAll(".base-written-lines > span")].map((line) => line.textContent)).toEqual([
        "Dalla riga 4", `+     filters: ${JSON.stringify(filter)}`,
      ]);
      await vi.waitFor(() => expect(chips(host)).toEqual(["stato è Arrivata"]));
      await settled(host);
    } finally { done(); }
  });

  it("lo stesso filtro si scrive come ricerca: un «oppure» resta ricerca e la forma a vista lo dice", async () => {
    const { host, invokeCommand, done } = mount();
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      const pop = popover("base-filter-popover");
      const search = pop.querySelector<HTMLInputElement>(".base-filter-search")!;
      search.value = "[stato:Arrivata]";
      search.dispatchEvent(new Event("input"));
      // Una ricerca che la forma a vista sa dire ricompare a vista.
      expect(pop.querySelector<HTMLInputElement>(".base-filter-value")!.value).toBe("Arrivata");
      expect(pop.querySelector<HTMLSelectElement>(".base-filter-op")!.value).toBe("contains");
      search.value = '[stato:Arrivata] OR [stato:"In prestito"]';
      search.dispatchEvent(new Event("input"));
      expect(pop.querySelector(".base-filter-row")).toBeNull();
      expect(pop.textContent).toContain("la forma a vista non lo sa dire: resta come ricerca");
      press(pop, "Applica");
      expect(JSON.parse(lastSet(invokeCommand)!.value as string)).toEqual({ or: [
        { condition: { property: "stato", op: "contains", value: "Arrivata" } },
        { condition: { property: "stato", op: "contains", value: "In prestito" } },
      ] });
    } finally { done(); }
  });

  it("una ricerca che la Base non sa filtrare non si applica, e dice perché", async () => {
    const { host, invokeCommand, done } = mount();
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      const pop = popover("base-filter-popover");
      const search = pop.querySelector<HTMLInputElement>(".base-filter-search")!;
      search.value = "tela";
      search.dispatchEvent(new Event("input"));
      expect(pop.textContent).toContain("«tela» la Base non lo sa filtrare");
      const apply = [...pop.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === "Applica")!;
      expect(apply.disabled).toBe(true);
      search.value = "[stato:Arrivata";
      search.dispatchEvent(new Event("input"));
      expect(apply.disabled).toBe(true);
      expect(lastSet(invokeCommand)).toBeUndefined();
    } finally { done(); }
  });

  it("la × di un'etichetta toglie quella condizione o quell'ordinamento, e basta", async () => {
    const stato = { condition: { property: "stato", op: "contains", value: "Arrivata" } };
    const artista = { condition: { property: "artista", op: "is", value: "Elena Sala" } };
    const { host, invokeCommand, deliver, done } = mount({ filters: { and: [stato, artista] }, sort: [{ key: "consegna", descending: true }] });
    try {
      await ready(host);
      await vi.waitFor(() => expect(chips(host)).toEqual(["stato contiene Arrivata", "artista è Elena Sala", "consegna ↓"]));
      host.querySelector<HTMLButtonElement>('.base-chip button[aria-label="Togli il filtro stato contiene Arrivata"]')!.click();
      expect(lastSet(invokeCommand)).toEqual({ doc: "Opere.base", view: "Tabella", key: "filters", value: JSON.stringify(artista), base: "r1" });
      // Finché il file nuovo non torna, un secondo gesto partirebbe da un piano
      // vecchio: la barra è spenta.
      host.querySelector<HTMLButtonElement>('.base-chip button[aria-label="Togli l\'ordinamento per consegna"]')!.click();
      expect(invokeCommand.mock.calls.filter(([command]) => command === "base.view.set")).toHaveLength(1);
      deliver();
      await settled(host);
      host.querySelector<HTMLButtonElement>('.base-chip button[aria-label="Togli l\'ordinamento per consegna"]')!.click();
      expect(lastSet(invokeCommand)).toEqual({ doc: "Opere.base", view: "Tabella", key: "sort", base: "r2" });
    } finally { done(); }
  });

  it("Ordina aggiunge una chiave e ne cambia il verso, scrivendo soltanto `sort`", async () => {
    const { host, invokeCommand, deliver, done } = mount();
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-sort")!.click();
      const pop = popover("base-sort-popover");
      expect(pop.textContent).toContain("Nessun ordinamento");
      const add = pop.querySelector<HTMLSelectElement>(".base-sort-add")!;
      expect([...add.options].map((option) => option.value)).toEqual(["", "stato", "artista", "consegna"]);
      add.value = "consegna";
      add.dispatchEvent(new Event("change"));
      expect(lastSet(invokeCommand)).toEqual({ doc: "Opere.base", view: "Tabella", key: "sort", value: JSON.stringify([{ key: "consegna", descending: false }]), base: "r1" });
      deliver();
      await settled(host);
      // Il popover resta aperto e mostra il file nuovo.
      const direction = popover("base-sort-popover").querySelector<HTMLSelectElement>(".base-sort-direction")!;
      direction.value = "desc";
      direction.dispatchEvent(new Event("change"));
      expect(JSON.parse(lastSet(invokeCommand)!.value as string)).toEqual([{ key: "consegna", descending: true }]);
    } finally { done(); }
  });

  it("Proprietà mostra, nasconde e riordina le colonne (spunta, Alt+freccia, trascinamento) scrivendo `order`", async () => {
    const { host, invokeCommand, deliver, done } = mount();
    const order = () => JSON.parse(lastSet(invokeCommand)!.value as string);
    const column = (key: string) => popover("base-columns-popover").querySelector<HTMLLIElement>(`.base-column[data-column="${key}"]`)!;
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-columns")!.click();
      expect([...popover("base-columns-popover").querySelectorAll<HTMLInputElement>(".base-column input")].map((box) => box.checked)).toEqual([true, true, false]);
      column("consegna").querySelector("input")!.click();
      expect(order()).toEqual(["stato", "artista", "consegna"]);
      deliver();
      await settled(host);
      column("consegna").querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
      expect(order()).toEqual(["stato", "consegna", "artista"]);
      deliver();
      await settled(host);
      column("artista").dispatchEvent(new Event("dragstart"));
      const drop = new Event("drop", { cancelable: true });
      column("stato").dispatchEvent(new Event("dragover", { cancelable: true }));
      column("stato").dispatchEvent(drop);
      expect(order()).toEqual(["artista", "stato", "consegna"]);
      deliver();
      await settled(host);
      column("stato").querySelector("input")!.click();
      expect(order()).toEqual(["artista", "consegna"]);
      expect(invokeCommand.mock.calls.every(([command, args]) => command !== "base.view.set" || (args as { key: string }).key === "order")).toBe(true);
    } finally { done(); }
  });

  it("un patch rifiutato o un file cambiato altrove non scrivono, e la Base lo dice", async () => {
    const { host, invokeCommand, failNext, done } = mount();
    try {
      await ready(host);
      failNext({ kind: "bad_args", message: "La chiave è scritta in YAML di flusso" });
      host.querySelector<HTMLButtonElement>(".base-tool-sort")!.click();
      const add = popover("base-sort-popover").querySelector<HTMLSelectElement>(".base-sort-add")!;
      add.value = "stato";
      add.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(host.querySelector(".base-status")!.textContent).toBe("Niente è stato scritto nel file .base: La chiave è scritta in YAML di flusso"));
      expect(host.querySelector<HTMLDetailsElement>(".base-written")!.hidden).toBe(true);
      await settled(host);
      failNext({ kind: "conflict", message: "revisione diversa" });
      const again = popover("base-sort-popover").querySelector<HTMLSelectElement>(".base-sort-add")!;
      again.value = "stato";
      again.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(host.querySelector(".base-status")!.textContent).toContain("Il file .base è cambiato altrove: niente è stato scritto"));
      expect(invokeCommand).toHaveBeenCalledTimes(2);
    } finally { done(); }
  });

  it("in sola lettura i gesti si vedono ma non scrivono, e la barra dice perché", async () => {
    const stato = { condition: { property: "stato", op: "contains", value: "Arrivata" } };
    const { host, surface, invokeCommand, done } = mount({ filters: stato });
    try {
      await ready(host);
      surface.setReadOnly!(true);
      expect(host.querySelector<HTMLElement>(".base-note")!.hidden).toBe(false);
      expect(host.querySelector(".base-note")!.textContent).toContain("Sola lettura");
      expect(chips(host)).toEqual(["stato contiene Arrivata"]);
      expect(host.querySelector(".base-chip button")).toBeNull();
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      const apply = [...popover("base-filter-popover").querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === "Applica")!;
      expect(apply.disabled).toBe(true);
      host.querySelector<HTMLButtonElement>(".base-tool-columns")!.click();
      // Le caselle restano raggiungibili col fuoco, ma inerti.
      const boxes = [...popover("base-columns-popover").querySelectorAll<HTMLInputElement>("input")];
      expect(boxes.every((box) => box.getAttribute("aria-disabled") === "true" && !box.disabled)).toBe(true);
      boxes[0]!.click();
      expect(boxes[0]!.checked).toBe(true);
      expect(invokeCommand).not.toHaveBeenCalled();
    } finally { done(); }
  });

  it("una Base scritta dentro una nota si guarda con la stessa barra, non si riscrive, e si apre la sua nota", async () => {
    const onOpenDocument = vi.fn();
    const { host, invokeCommand, done } = mount({ sort: [{ key: "stato", descending: false }] }, { sourceInNote: true, container: "Mostra.md", onOpenDocument });
    try {
      await ready(host);
      expect(host.querySelector(".base-note")!.textContent).toContain("un blocco dentro la nota");
      expect(host.querySelector(".base-chip button")).toBeNull();
      host.querySelector<HTMLButtonElement>(".base-tool-sort")!.click();
      expect(popover("base-sort-popover").querySelector<HTMLSelectElement>(".base-sort-add")!.disabled).toBe(true);
      expect(invokeCommand).not.toHaveBeenCalled();
      const openFile = host.querySelector<HTMLButtonElement>(".base-open-file")!;
      expect(openFile.hidden).toBe(false);
      expect(openFile.textContent).toBe("Apri come file");
      openFile.click();
      expect(onOpenDocument).toHaveBeenCalledWith("Mostra.md");
    } finally { done(); }
  });

  it("un gesto salva prima il .base, annuncia la sua scrittura e offre Annulla", async () => {
    const order: string[] = [];
    const withdraw = vi.fn();
    const documentWrites: BaseDocumentWrites = {
      flush: vi.fn(async () => { order.push("flush"); return []; }),
      expect: vi.fn((doc: string) => { order.push(`expect ${doc}`); return withdraw; }),
    };
    const { host, invokeCommand, deliver, done } = mount({}, { documentWrites });
    notified.length = 0;
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-sort")!.click();
      const add = popover("base-sort-popover").querySelector<HTMLSelectElement>(".base-sort-add")!;
      add.value = "stato";
      add.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(notified.map((each) => each.message)).toEqual(["sort scritto"]));
      expect(order).toEqual(["flush", "expect Opere.base"]);
      // Annunciata prima del comando: il suo evento arriva mentre scrive.
      expect(vi.mocked(documentWrites.expect).mock.invocationCallOrder[0]!).toBeLessThan(invokeCommand.mock.invocationCallOrder[0]!);
      // Il comando ha scritto: l'annuncio lo consuma l'evento, non si ritira.
      expect(withdraw).not.toHaveBeenCalled();
      const action = notified[0]!.action as NoticeAction;
      expect(action.label).toBe("Annulla");
      expect(action.hint).toBe("Rimetti sort");
      deliver();
      await settled(host);
      await action.run();
      expect(invokeCommand).toHaveBeenLastCalledWith("vault.undo");
      expect(documentWrites.expect).toHaveBeenCalledTimes(2);
    } finally { done(); }
  });

  it("Ctrl+Z fuori da un campo chiede l'Annulla del vault; dentro un campo resta al campo; Ctrl+Y e la sola lettura non chiedono nulla", async () => {
    const { host, surface, invokeCommand, done } = mount({});
    try {
      await ready(host);
      const press = (target: Element, init: KeyboardEventInit): KeyboardEvent => {
        const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
        target.dispatchEvent(event);
        return event;
      };
      const viewport = host.querySelector<HTMLElement>(".base-table-viewport")!;
      // Fuori da un campo il tasto è della Base, anche senza niente da disfare.
      expect(press(viewport, { key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("vault.undo"));
      invokeCommand.mockClear();
      // Dentro il campo di ricerca Ctrl+Z è del campo: il vault non si tocca.
      expect(press(host.querySelector<HTMLInputElement>(".base-search")!, { key: "z", ctrlKey: true }).defaultPrevented).toBe(false);
      // Nessun «rifai» nel vault: Ctrl+Y e Ctrl+Maiusc+Z non si prendono.
      expect(press(viewport, { key: "y", ctrlKey: true }).defaultPrevented).toBe(false);
      expect(press(viewport, { key: "z", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
      expect(invokeCommand).not.toHaveBeenCalled();
      // In sola lettura la Base non annulla il vault per conto suo.
      surface.setReadOnly!(true);
      expect(press(viewport, { key: "z", ctrlKey: true }).defaultPrevented).toBe(false);
      expect(invokeCommand).not.toHaveBeenCalled();
    } finally { done(); }
  });

  it("un gesto che non scrive ritira l'annuncio, e uno col .base non salvato non parte", async () => {
    const withdraw = vi.fn();
    let unsaved: string[] = [];
    const documentWrites: BaseDocumentWrites = { flush: async () => unsaved, expect: () => withdraw };
    const { host, invokeCommand, done } = mount({}, { documentWrites, unchanged: true });
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-sort")!.click();
      const add = popover("base-sort-popover").querySelector<HTMLSelectElement>(".base-sort-add")!;
      add.value = "stato";
      add.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(withdraw).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(host.querySelector<HTMLSelectElement>(".base-sort-add")?.disabled ?? false).toBe(false));
      unsaved = ["Opere.base"];
      const sets = invokeCommand.mock.calls.length;
      host.querySelector<HTMLButtonElement>(".base-tool-sort")!.click();
      const again = popover("base-sort-popover").querySelector<HTMLSelectElement>(".base-sort-add")!;
      again.value = "artista";
      again.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(host.querySelector(".base-status")!.textContent).toContain("modifiche che non si sono potute salvare"));
      expect(invokeCommand.mock.calls.length).toBe(sets);
    } finally { done(); }
  });

  it("il filtro su una data si scrive in ISO; una data sbagliata lo dice e non si applica", async () => {
    const date = (day: number) => ({ kind: "date", value: { year: 2026, month: 11, day, time: null } });
    const rows = [
      { doc: "Opere/Nebbia.md", properties: [{ key: "stato", value: { kind: "text", value: "Arrivata" } }, { key: "consegna", value: date(10) }] },
      { doc: "Opere/Campo.md", properties: [{ key: "stato", value: { kind: "text", value: "In prestito" } }, { key: "consegna", value: date(20) }] },
    ];
    const { host, invokeCommand, done } = mount({}, { rows });
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      const pop = popover("base-filter-popover");
      press(pop, "Aggiungi una condizione");
      const subject = pop.querySelector<HTMLSelectElement>(".base-filter-subject")!;
      subject.value = "consegna";
      subject.dispatchEvent(new Event("change"));
      const op = pop.querySelector<HTMLSelectElement>(".base-filter-op")!;
      // Una data non si «contiene».
      expect([...op.options].map((each) => each.value)).not.toContain("contains");
      op.value = "less_than";
      op.dispatchEvent(new Event("change"));
      // Il suggerimento è la data come si scrive.
      const value = pop.querySelector<HTMLInputElement>(".base-filter-value")!;
      expect([...pop.querySelectorAll("datalist option")].map((each) => (each as HTMLOptionElement).value)).toEqual(["2026-11-10", "2026-11-20"]);
      value.value = "15/11/2026";
      value.dispatchEvent(new Event("input"));
      expect(pop.textContent).toContain("«15/11/2026» non è una data: scrivila come 2026-03-18.");
      const apply = [...pop.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === "Applica")!;
      expect(apply.disabled).toBe(true);
      value.value = "2026-11-15";
      value.dispatchEvent(new Event("input"));
      expect(apply.disabled).toBe(false);
      apply.click();
      expect(JSON.parse(lastSet(invokeCommand)!.value as string)).toEqual({ condition: { property: "consegna", op: "less_than", value: "2026-11-15" } });
    } finally { done(); }
  });

  it("il filtro cambiato nel file mentre si compone non si scrive sopra: Ricarica mostra quello nuovo", async () => {
    const { host, invokeCommand, changeElsewhere, done } = mount({ filters: { condition: { property: "stato", op: "contains", value: "Arrivata" } } });
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      let pop = popover("base-filter-popover");
      const value = pop.querySelector<HTMLInputElement>(".base-filter-value")!;
      value.value = "In prestito";
      value.dispatchEvent(new Event("input"));
      changeElsewhere((keys) => { keys.filters = { condition: { property: "artista", op: "is", value: "Elena Sala" } }; });
      await vi.waitFor(() => expect(pop.querySelector<HTMLElement>(".base-filter-stale")!.hidden).toBe(false));
      const apply = [...pop.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === "Applica")!;
      expect(apply.disabled).toBe(true);
      press(pop, "Ricarica");
      pop = popover("base-filter-popover");
      expect(pop.querySelector<HTMLSelectElement>(".base-filter-subject")!.value).toBe("artista");
      expect(pop.querySelector<HTMLInputElement>(".base-filter-value")!.value).toBe("Elena Sala");
      expect(lastSet(invokeCommand)).toBeUndefined();
    } finally { done(); }
  });

  it("in Proprietà il fuoco resta sulla casella dopo che il file è tornato; Alt+↓ sposta, Esc chiude", async () => {
    const { host, invokeCommand, deliver, done } = mount({ order: ["stato", "artista"] });
    try {
      await ready(host);
      const button = host.querySelector<HTMLButtonElement>(".base-tool-columns")!;
      button.click();
      const box = () => popover("base-columns-popover").querySelector<HTMLInputElement>('.base-column[data-column="stato"] input')!;
      box().focus();
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
      expect(JSON.parse(lastSet(invokeCommand)!.value as string)).toEqual(["artista", "stato"]);
      // Mentre la scrittura aspetta il file la casella non perde il fuoco.
      expect(document.activeElement).toBe(box());
      deliver();
      await settled(host);
      await vi.waitFor(() => expect(document.activeElement).toBe(box()));
      expect(box().getAttribute("aria-disabled")).toBe("false");
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await vi.waitFor(() => expect(document.querySelector(".base-columns-popover")).toBeNull());
      expect(document.activeElement).toBe(button);
    } finally { done(); }
  });

  it("il testo nuovo seguito dall'evento dello stesso file aggiorna la barra col piano nuovo", async () => {
    const { host, deliver, done } = mount({ sort: [{ key: "stato", descending: false }] });
    try {
      await ready(host);
      await vi.waitFor(() => expect(chips(host)).toEqual(["stato ↑"]));
      host.querySelector<HTMLButtonElement>('.base-chip button[aria-label="Togli l\'ordinamento per stato"]')!.click();
      await Promise.resolve();
      // Il testo arriva e, nello stesso giro, l'evento del file: la ricarica
      // delle righe che ne viene non deve lasciare la barra sul piano vecchio.
      deliver();
      forwardNotice({ event: { type: "document_changed", id: "Opere.base" }, origin: { actor: { kind: "user" }, batch: "b1" } });
      await settled(host);
      await vi.waitFor(() => expect(chips(host)).toEqual([]));
    } finally { done(); }
  });

  it("un gesto lascia la tabella dove era scorsa", async () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({ doc: `Opere/${String(index).padStart(2, "0")}.md`, properties: [{ key: "stato", value: "Arrivata" }] }));
    const { host, deliver, done } = mount({}, { rows });
    try {
      await vi.waitFor(() => expect(host.querySelector(".base-table tbody tr[data-doc]")).not.toBeNull());
      const viewport = host.querySelector<HTMLElement>(".base-table-viewport")!;
      viewport.scrollTop = 900;
      viewport.dispatchEvent(new Event("scroll"));
      host.querySelector<HTMLButtonElement>(".base-tool-sort")!.click();
      const add = popover("base-sort-popover").querySelector<HTMLSelectElement>(".base-sort-add")!;
      add.value = "stato";
      add.dispatchEvent(new Event("change"));
      deliver();
      await settled(host);
      const redrawn = host.querySelector<HTMLElement>(".base-table-viewport")!;
      expect(redrawn).not.toBe(viewport);
      expect(redrawn.scrollTop).toBe(900);
    } finally { done(); }
  });

  it("un filtro che nessuna forma sa dire resta com'è scritto: niente ×, niente Applica", async () => {
    const { host, invokeCommand, done } = mount({ filters: { condition: { property: "tags", op: "contains", value: ["a", "b"] } } });
    try {
      await ready(host);
      expect(chips(host)).toEqual(["Filtro scritto nel file"]);
      expect(host.querySelector(".base-chip button")).toBeNull();
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      const pop = popover("base-filter-popover");
      expect(pop.textContent).toContain("si cambia dal file .base");
      expect(pop.querySelector<HTMLInputElement>(".base-filter-search")!.disabled).toBe(true);
      expect([...pop.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === "Applica")!.disabled).toBe(true);
      expect(invokeCommand).not.toHaveBeenCalled();
    } finally { done(); }
  });

  it("le viste sono linguette: la scelta passa alla vista e la figura dice il tipo", async () => {
    const { host, done } = mount();
    try {
      await ready(host);
      const tabs = () => [...host.querySelectorAll<HTMLButtonElement>(".base-tab[data-view]")];
      expect(tabs().map((tab) => [tab.textContent, tab.getAttribute("aria-pressed"), tab.querySelector("svg")?.dataset.icon])).toEqual([
        ["Tabella", "true", "base-table"], ["Bacheca", "false", "base-board"],
      ]);
      tabs()[1]!.click();
      await vi.waitFor(() => expect(host.querySelector(".base-kanban")).not.toBeNull());
      expect(tabs().map((tab) => tab.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    } finally { done(); }
  });

  // Le righe con una proprietà che non è una colonna: il piano non la chiede,
  // e le righe lette non la portano.
  const works = [
    { doc: "Opere/Nebbia.md", properties: [{ key: "stato", value: "Arrivata" }, { key: "artista", value: "Elena Sala" }, { key: "tecnica", value: "Olio" }] },
    { doc: "Opere/Campo.md", properties: [{ key: "stato", value: "In prestito" }, { key: "artista", value: "Pietro Neri" }, { key: "tecnica", value: "Tempera" }] },
  ];
  const applyButton = (pop: HTMLElement) => [...pop.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === "Applica")!;

  it("una proprietà che le righe lette non portano si filtra lo stesso: la barra avverte, Applica resta", async () => {
    const { host, invokeCommand, deliver, done } = mount({}, { rows: works, narrow: true });
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      let pop = popover("base-filter-popover");
      const search = pop.querySelector<HTMLInputElement>(".base-filter-search")!;
      search.value = "[tecnica:olio]";
      search.dispatchEvent(new Event("input"));
      expect(pop.textContent).toContain("«tecnica» non è fra le proprietà delle righe lette: controlla il nome prima di applicare.");
      expect(applyButton(pop).disabled).toBe(false);
      applyButton(pop).click();
      expect(JSON.parse(lastSet(invokeCommand)!.value as string)).toEqual({ condition: { property: "tecnica", op: "contains", value: "olio" } });
      deliver();
      await settled(host);
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(1));
      // Ora il piano la chiede: è fra le proprietà, e non c'è più niente da dire.
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      pop = popover("base-filter-popover");
      expect([...pop.querySelectorAll<HTMLSelectElement>(".base-filter-subject option")].map((each) => each.value)).toContain("tecnica");
      const again = pop.querySelector<HTMLInputElement>(".base-filter-search")!;
      again.value = "[tecnica:tempera]";
      again.dispatchEvent(new Event("input"));
      expect(pop.textContent).not.toContain("non è fra le proprietà");
    } finally { done(); }
  });

  it("un filtro che non trova niente si corregge: le scelte e i valori vengono dalle righe lette", async () => {
    const { host, deliver, done } = mount({ filters: { condition: { property: "stato", op: "is", value: "Arivata" } } }, { rows: works, narrow: true });
    try {
      await vi.waitFor(() => expect(host.querySelector(".base-table")).not.toBeNull());
      expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(0);
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      const pop = popover("base-filter-popover");
      expect(pop.querySelector<HTMLSelectElement>(".base-filter-subject")!.value).toBe("stato");
      expect([...pop.querySelectorAll("datalist option")].map((each) => (each as HTMLOptionElement).value)).toEqual(["Arrivata", "In prestito"]);
      const value = pop.querySelector<HTMLInputElement>(".base-filter-value")!;
      value.value = "Arrivata";
      value.dispatchEvent(new Event("input"));
      expect(pop.textContent).not.toContain("non è fra le proprietà");
      applyButton(pop).click();
      deliver();
      await settled(host);
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(1));
    } finally { done(); }
  });

  it("un numero scritto nella lingua per una proprietà mista si cerca come testo, e la barra lo dice", async () => {
    const rows = [
      { doc: "Opere/Nebbia.md", properties: [{ key: "stato", value: { kind: "text", value: "Arrivata" } }, { key: "valore", value: { kind: "number", value: 2600 } }] },
      { doc: "Opere/Campo.md", properties: [{ key: "stato", value: { kind: "text", value: "In prestito" } }, { key: "valore", value: { kind: "text", value: "da stimare" } }] },
    ];
    const { host, done } = mount({}, { rows });
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-filter")!.click();
      const pop = popover("base-filter-popover");
      press(pop, "Aggiungi una condizione");
      const subject = pop.querySelector<HTMLSelectElement>(".base-filter-subject")!;
      subject.value = "valore";
      subject.dispatchEvent(new Event("change"));
      const value = pop.querySelector<HTMLInputElement>(".base-filter-value")!;
      value.value = "3000,5";
      value.dispatchEvent(new Event("input"));
      expect(pop.textContent).toContain("«3000,5» si cerca come testo, perché questa proprietà non ha solo numeri. Per cercare il numero scrivi 3000.5.");
      expect(applyButton(pop).disabled).toBe(false);
    } finally { done(); }
  });

  it("cambiare vista riporta la tabella in cima", async () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({ doc: `Opere/${String(index).padStart(2, "0")}.md`, properties: [{ key: "stato", value: "Arrivata" }] }));
    const { host, done } = mount({}, { rows, twoTables: true });
    try {
      await vi.waitFor(() => expect(host.querySelector(".base-table tbody tr[data-doc]")).not.toBeNull());
      const viewport = host.querySelector<HTMLElement>(".base-table-viewport")!;
      viewport.scrollTop = 900;
      viewport.dispatchEvent(new Event("scroll"));
      host.querySelectorAll<HTMLButtonElement>(".base-tab")[1]!.click();
      await vi.waitFor(() => expect(host.querySelector<HTMLElement>(".base-table-viewport")).not.toBe(viewport));
      await settled(host);
      expect(host.querySelector<HTMLElement>(".base-table-viewport")!.scrollTop).toBe(0);
    } finally { done(); }
  });

  it("Annulla ritira il suo annuncio se l'evento del .base non arriva, e subito se la Base si chiude", async () => {
    const withdraws: ReturnType<typeof vi.fn>[] = [];
    const documentWrites: BaseDocumentWrites = {
      flush: async () => [],
      expect: () => { const withdraw = vi.fn(); withdraws.push(withdraw); return withdraw; },
    };
    const { host, deliver, done } = mount({}, { documentWrites });
    notified.length = 0;
    let closed = false;
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-sort")!.click();
      const add = popover("base-sort-popover").querySelector<HTMLSelectElement>(".base-sort-add")!;
      add.value = "stato";
      add.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(notified.length).toBe(1));
      deliver();
      await settled(host);
      const action = notified[0]!.action as NoticeAction;
      // «Annulla» ha annullato un'altra cosa (o niente): nessun evento del
      // .base, e l'annuncio non resta a zittire un cambio vero.
      await action.run();
      expect(withdraws).toHaveLength(2);
      expect(withdraws[1]).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(withdraws[1]).toHaveBeenCalledTimes(1), { timeout: 4000 });
      expect(withdraws[0]).not.toHaveBeenCalled();
      // Chiusa la Base, l'attesa non resta appesa.
      await action.run();
      done();
      closed = true;
      expect(withdraws[2]).toHaveBeenCalledTimes(1);
    } finally { if (!closed) done(); }
  });
});
