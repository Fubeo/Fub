import { describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import {
  allowedBaseTileUrl, baseRowsToCsv, cellText, deriveBaseRows, expectedProperty, fetchAllDocuments,
  parseBaseEmbed, parseBaseViews, planBaseView, prepareBaseMutations,
  persistBaseView, restoreBaseView, setBaseViewKey, writtenLines, type BaseSurfaceDeps,
} from "./data";

function deps(queryIndex: (query: IndexQuery) => Promise<IndexResult>): BaseSurfaceDeps {
  const state = new Map<string, unknown>();
  return {
    queryIndex,
    invokeCommand: vi.fn(async () => ({ notify: null })),
    viewState: async <T>(key: string) => (state.get(key) ?? null) as T | null,
    setViewState: async (key, value) => { state.set(key, value); },
  };
}
const custom = (value: unknown): IndexResult => ({ kind: "custom", value });
const source = "views:\n  - {name: Board, type: kanban, order: [status]}\n";

describe("Base contract", () => {
  it("rejects malformed and future definitions instead of inventing empty views", async () => {
    const bridge = deps(async () => custom({ views: ["A", 12] }));
    await expect(parseBaseViews(bridge, source)).rejects.toThrow("viste");
    const future = deps(async () => { throw { kind: "bad_args", message: "unsupported version" }; });
    await expect(parseBaseViews(future, "version: 999\n")).rejects.toMatchObject({ kind: "bad_args" });
  });

  // T34 toglie `timeline` da qui quando la superficie la disegna.
  it("reads the calendar and refuses the timeline until the surface draws it, as an unknown kind", async () => {
    const planOf = (kind: string) => deps(async () => custom({ view: "Agenda", view_type: kind, columns: [], column_labels: {}, required_props: [], all_properties: false, group: null, limit: null, map: null, create_defaults: {}, date_key: "due", start_key: null, end_key: null }));
    for (const kind of ["timeline", "gallery"]) {
      await expect(planBaseView(planOf(kind), source, "Agenda")).rejects.toThrow("tipo vista sconosciuto");
    }
    await expect(planBaseView(planOf("calendar"), source, "Agenda")).resolves.toMatchObject({ viewType: "calendar", dateKey: "due" });
    const drawn = deps(async () => custom({ view: "Board", view_type: "kanban", columns: [], column_labels: {}, required_props: [], all_properties: false, group: null, limit: null, map: null, create_defaults: {} }));
    await expect(planBaseView(drawn, source, "Board")).resolves.toMatchObject({ viewType: "kanban" });
  });

  it("reads the day of each note in a calendar view, and refuses a malformed one", async () => {
    const rows = [{ doc: "a.md", properties: [] }, { doc: "b.md", properties: [] }];
    const answer = (time: unknown[]) => deps(async () => custom({ rows: [{ doc: "a.md", values: {}, time: time[0] }, { doc: "b.md", values: {}, time: time[1] }], summaries: {} }));
    const derived = await deriveBaseRows(answer([{ day: "2026-11-14" }, { day: null }]), source, "Cal", rows);
    expect(derived.rows.map((row) => row.day)).toEqual(["2026-11-14", null]);
    const plain = await deriveBaseRows(answer([undefined, undefined]), source, "Cal", rows);
    expect(plain.rows[0]).not.toHaveProperty("day");
    await expect(deriveBaseRows(answer([{ day: "14/11/2026" }, { day: null }]), source, "Cal", rows)).rejects.toThrow("giorno malformato");
  });

  it("consumes every page beyond the former 2,000-row cutoff", async () => {
    const queryIndex = vi.fn(async (query: IndexQuery): Promise<IndexResult> => {
      if (query.kind !== "documents") throw new Error("unexpected query");
      const offset = query.page?.offset ?? 0;
      const count = Math.min(query.page?.limit ?? 0, 2001 - offset);
      return { kind: "documents", value: {
        offset, total: 2001,
        items: Array.from({ length: count }, (_, i) => ({ doc: `${offset + i}.md`, properties: [] })),
      } };
    });
    const result = await fetchAllDocuments(deps(queryIndex));
    expect(result.rows[result.rows.length - 1]?.doc).toBe("2000.md");
    expect(result.total).toBe(2001);
    expect(queryIndex).toHaveBeenCalledTimes(8);
  });

  it("rejects an oversized result instead of silently presenting its first page as complete", async () => {
    const queryIndex = vi.fn(async (): Promise<IndexResult> => ({
      kind: "documents", value: { offset: 0, total: 20_001, items: [{ doc: "a.md", properties: [] }] },
    }));
    await expect(fetchAllDocuments(deps(queryIndex))).rejects.toThrow("nessun risultato parziale");
    expect(queryIndex).toHaveBeenCalledTimes(1);
  });

  it("preserves missing, present-null and boolean false as distinct CAS observations", () => {
    const row = { doc: "a.md", values: {}, properties: { nullable: { kind: "empty" }, flag: { kind: "bool", value: false } } };
    expect(expectedProperty(row, "absent")).toEqual({ kind: "absent" });
    expect(expectedProperty(row, "nullable")).toEqual({ kind: "value", value: { kind: "empty" } });
    expect(expectedProperty(row, "flag")).toEqual({ kind: "value", value: { kind: "bool", value: false } });
  });

  it("rejects a mutation that loses the present-false CAS observation", async () => {
    const bridge = deps(async () => custom({ mutations: [{
      doc: "a.md", key: "flag", command: "note.property.set",
      args: { doc: "a.md", key: "flag", value: "true", expected: '{"kind":"absent"}' },
    }] }));
    await expect(prepareBaseMutations(bridge, source, "Board", [
      { doc: "a.md", key: "flag", expected: { kind: "value", value: { kind: "bool", value: false } }, value: "true" },
    ])).rejects.toThrow("mutazione diversa");
  });

  it("rejects a malformed derived cell rather than dropping the row", async () => {
    const bridge = deps(async () => custom({ rows: [{ doc: "a.md", values: { flag: { kind: "bool", value: 0 } } }], summaries: {} }));
    await expect(deriveBaseRows(bridge, source, "Board", [{ doc: "a.md" }])).rejects.toThrow("cella malformata");
  });

  it("accepts a tagged CAS value serialized with a different JSON object-key order", async () => {
    const bridge = deps(async () => custom({ mutations: [{
      doc: "a.md", key: "flag", command: "note.property.set",
      args: { doc: "a.md", key: "flag", value: "true", expected: '{"kind":"value","value":{"value":false,"kind":"bool"}}' },
    }] }));
    const mutations = await prepareBaseMutations(bridge, source, "Board", [
      { doc: "a.md", key: "flag", expected: { kind: "value", value: { kind: "bool", value: false } }, value: "true" },
    ]);
    expect(mutations[0]?.args.expected).toBe('{"kind":"value","value":{"value":false,"kind":"bool"}}');
  });

  it("restores independent document view choices and quotes CSV content", async () => {
    const bridge = deps(async () => { throw new Error("no query"); });
    await persistBaseView(bridge, "a.base", "Cards");
    await persistBaseView(bridge, "b.base", "Board");
    expect(await restoreBaseView(bridge, "a.base")).toBe("Cards");
    expect(await restoreBaseView(bridge, "b.base")).toBe("Board");
    expect(baseRowsToCsv([{ doc: "a.md", values: { text: { kind: "text", value: 'one,"two"\nthree' } }, properties: {} }], ["text"]))
      .toBe('text\r\n"one,""two""\nthree"\r\n');
  });

  it("recognizes source embeds without misreading them as vault file IDs", () => {
    expect(parseBaseEmbed({ node: "custom", ns: "fub:base", payload: { source, view: "Board" }, fallback: [] }))
      .toEqual({ source, view: "Board", container: null });
    expect(cellText({ kind: "file", value: { path: "a.png", label: null } })).toBe("a.png");
  });
  it("threads the containing document through derivation without confusing it with a member", async () => {
    const seen: unknown[] = [];
    const bridge = deps(async (query) => {
      if (query.kind !== "custom") throw new Error("unexpected");
      seen.push(query.query);
      return custom({ rows: [{ doc: "member.md", values: { owner: { kind: "text", value: "Project" } } }], summaries: {} });
    });
    const result = await deriveBaseRows(bridge, source, "Board", [{ doc: "member.md" }], 0, "Project/host.md");
    expect(result.rows[0]?.values.owner).toEqual({ kind: "text", value: "Project" });
    expect(seen[0]).toMatchObject({ container: "Project/host.md", rows: [{ doc: "member.md" }] });
  });

  it("never makes tile URLs available from YAML consent alone or a redirecting host", () => {
    const template = "https://tiles.example.test/{z}/{x}/{y}.png";
    expect(allowedBaseTileUrl(template, "raster", [], 1, 0, 0)).toBeNull();
    expect(allowedBaseTileUrl("http://tiles.example.test/{z}/{x}/{y}.png", "raster", ["tiles.example.test"], 1, 0, 0)).toBeNull();
    expect(allowedBaseTileUrl("https://tiles.example.test.evil/{z}/{x}/{y}.png", "raster", ["tiles.example.test"], 1, 0, 0)).toBeNull();
    expect(allowedBaseTileUrl(template, "vector", ["tiles.example.test"], 1, 0, 0)).toBeNull();
    expect(allowedBaseTileUrl(template, "raster", ["tiles.example.test"], 1, 0, 0)).toBe("https://tiles.example.test/1/0/0.png");
    expect(allowedBaseTileUrl("https://tiles.example.test/{z}/{x}/{y}.svg", "vector", ["tiles.example.test"], 1, 1, 1)).toBe("https://tiles.example.test/1/1/1.svg");
  });
});

describe("i gesti della barra con base.view.set", () => {
  it("manda una sola chiave, il valore come JSON e la revisione; null toglie la chiave", async () => {
    const invokeCommand = vi.fn(async () => ({ notify: "Ordine scritto", effect: { kind: "custom", ns: "fub.base", payload: { revision: "r2" } }, undo: { label: "Annulla l'ordine" } }));
    expect(await setBaseViewKey({ invokeCommand }, "Opere.base", "Tabella", "sort", [{ key: "stato", descending: false }], "r1"))
      .toEqual({ revision: "r2", notify: "Ordine scritto", undo: { label: "Annulla l'ordine" } });
    expect(invokeCommand).toHaveBeenLastCalledWith("base.view.set", { doc: "Opere.base", view: "Tabella", key: "sort", value: '[{"key":"stato","descending":false}]', base: "r1" });
    await setBaseViewKey({ invokeCommand }, "Opere.base", "Tabella", "filters", null, null);
    expect(invokeCommand).toHaveBeenLastCalledWith("base.view.set", { doc: "Opere.base", view: "Tabella", key: "filters" });
    // Niente da cambiare: nessuna revisione, nessun «Annulla».
    invokeCommand.mockResolvedValueOnce({ notify: "Niente da cambiare", effect: { kind: "none" } as never, undo: null as never });
    expect(await setBaseViewKey({ invokeCommand }, "Opere.base", "Tabella", "filters", null, null)).toEqual({ revision: null, notify: "Niente da cambiare", undo: null });
  });

  it("«Nel file .base» sono le righe fra quelle uguali in testa e in coda", () => {
    const before = "views:\n  - name: Tabella\n    type: table\n  - name: Bacheca\n";
    expect(writtenLines(before, before)).toBeNull();
    expect(writtenLines(before, before.replace("    type: table\n", "    type: table\n    sort:\n      - key: stato\n"))).toEqual({
      removed: [], added: ["    sort:", "      - key: stato"], line: 4,
    });
    expect(writtenLines("a\nb\nc\n", "a\nB\nc\n")).toEqual({ removed: ["b"], added: ["B"], line: 2 });
  });
});
