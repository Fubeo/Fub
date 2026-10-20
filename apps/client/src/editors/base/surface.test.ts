// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import { forwardNotice } from "../../state/kernel";
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
      const select = host.querySelector<HTMLSelectElement>(".base-group-by")!;
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
      expect(again.host.querySelector<HTMLSelectElement>(".base-group-by")!.value).toBe("");
    } finally { again.done(); }
  });

  it("l'ordine dei gruppi si sceglie per vista, il gruppo vuoto resta in fondo, e si ricorda", async () => {
    const { host, setViewState, done } = mount("table");
    try {
      await vi.waitFor(() => expect(toggles(host)).toHaveLength(3));
      const order = host.querySelector<HTMLSelectElement>(".base-group-order")!;
      expect(order.hidden).toBe(false);
      expect(order.value).toBe("rows");
      order.value = "asc";
      order.dispatchEvent(new Event("change"));
      expect(toggles(host)).toEqual(["aperto (1)", "fatto (2)", "∅ (1)"]);
      order.value = "desc";
      order.dispatchEvent(new Event("change"));
      expect(toggles(host)).toEqual(["fatto (2)", "aperto (1)", "∅ (1)"]);
      await vi.waitFor(() => expect(setViewState).toHaveBeenCalledWith("base.group-order:views/gruppi.base:Vista", "desc"));
      const select = host.querySelector<HTMLSelectElement>(".base-group-by")!;
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
