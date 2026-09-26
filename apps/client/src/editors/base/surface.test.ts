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
