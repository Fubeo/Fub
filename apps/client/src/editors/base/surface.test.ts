// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import { forwardNotice } from "../../state/kernel";
import type { SurfaceMenuItem } from "../core/editor-menu";
import { mountBaseSurface } from "./surface";

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
      viewport.scrollTop = 10_000 * 36;
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
      expect(column.target).toEqual({ kind: "column", ref: "status" });
      expect((column.context as readonly SurfaceMenuItem[]).map((item) => item.id)).toEqual(["base.group.column", "base.column.copy"]);

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
  const mount = (initial: Keys = {}, options: { sourceInNote?: boolean } = {}) => {
    const keys: Keys = { ...initial };
    let revision = 1;
    let fail: Fail = null;
    const host = document.createElement("div");
    document.body.append(host);
    const queryIndex = async (request: IndexQuery): Promise<IndexResult> => {
      if (request.kind === "documents") return { kind: "documents", value: { offset: 0, total: notes.length, items: notes } };
      if (request.kind !== "custom" || typeof request.query !== "object" || !request.query || !("op" in request.query)) throw new Error("unexpected query");
      const query = request.query as { op: string; view?: string | null };
      if (query.op === "parse") return { kind: "custom", value: { views: ["Tabella", "Bacheca"], types: ["table", "kanban"] } };
      if (query.op === "plan") {
        const board = query.view === "Bacheca";
        return { kind: "custom", value: {
          view: board ? "Bacheca" : "Tabella", view_type: board ? "kanban" : "table",
          columns: (keys.order as string[] | undefined) ?? ["stato", "artista"], column_labels: {},
          required_props: [], all_properties: true, group: board ? "stato" : null, limit: null, map: null, create_defaults: {},
          filters: board ? "all" : keys.filters ?? "all", sort: board ? [] : keys.sort ?? [], order: board ? [] : keys.order ?? [],
        } };
      }
      if (query.op === "derive") {
        return { kind: "custom", value: { summaries: {}, rows: notes.map(({ doc, properties }) => ({
          doc, values: Object.fromEntries(properties.map(({ key, value }) => [key, { kind: "text", value }])),
        })) } };
      }
      throw new Error("unexpected Base operation");
    };
    const invokeCommand = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== "base.view.set") return {};
      if (fail) throw fail;
      const key = args!.key as keyof Keys;
      if (args!.value === undefined) delete keys[key];
      else keys[key] = JSON.parse(args!.value as string);
      revision++;
      return { notify: null, effect: { kind: "custom", ns: "fub.base", payload: { revision: `r${revision}` } } };
    });
    const surface = mountBaseSurface("base", { paneId: "base-gesti", documentId: "Opere.base", parent: host }, {
      queryIndex, invokeCommand, viewState: async () => null, setViewState: async () => {}, onOpenDocument: () => {},
      revision: () => `r${revision}`,
    }, options);
    surface.buffer.setDoc(text(keys));
    return {
      host, surface, invokeCommand,
      failNext: (next: Fail) => { fail = next; },
      // L'host rimanda il testo del file dopo il comando, come la sessione.
      deliver: () => surface.buffer.syncDoc(text(keys)),
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
      expect([...popover("base-columns-popover").querySelectorAll<HTMLInputElement>("input")].every((box) => box.disabled)).toBe(true);
      expect(invokeCommand).not.toHaveBeenCalled();
    } finally { done(); }
  });

  it("una Base scritta dentro una nota si guarda con la stessa barra, ma non si riscrive", async () => {
    const { host, invokeCommand, done } = mount({ sort: [{ key: "stato", descending: false }] }, { sourceInNote: true });
    try {
      await ready(host);
      expect(host.querySelector(".base-note")!.textContent).toContain("scritta dentro la nota");
      expect(host.querySelector(".base-chip button")).toBeNull();
      host.querySelector<HTMLButtonElement>(".base-tool-sort")!.click();
      expect(popover("base-sort-popover").querySelector<HTMLSelectElement>(".base-sort-add")!.disabled).toBe(true);
      expect(invokeCommand).not.toHaveBeenCalled();
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
      const tabs = () => [...host.querySelectorAll<HTMLButtonElement>(".base-tab")];
      expect(tabs().map((tab) => [tab.textContent, tab.getAttribute("aria-pressed"), tab.querySelector("svg")?.dataset.icon])).toEqual([
        ["Tabella", "true", "base-table"], ["Bacheca", "false", "base-board"],
      ]);
      tabs()[1]!.click();
      await vi.waitFor(() => expect(host.querySelector(".base-kanban")).not.toBeNull());
      expect(tabs().map((tab) => tab.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    } finally { done(); }
  });
});
