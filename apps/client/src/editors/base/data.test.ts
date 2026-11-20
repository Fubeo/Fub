import { describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import {
  allowedBaseTileUrl, baseRowsToCsv, baseTileUrl, cellText, deriveBaseRows, expectedProperty, fetchAllDocuments, linkedNotes,
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

  it("reads the calendar and the timeline, and refuses a kind the surface does not draw", async () => {
    const planOf = (kind: string) => deps(async () => custom({ view: "Agenda", view_type: kind, columns: [], column_labels: {}, required_props: [], all_properties: false, group: null, limit: null, map: null, create_defaults: {}, date_key: "due", start_key: "from", end_key: null }));
    await expect(planBaseView(planOf("gallery"), source, "Agenda")).rejects.toThrow("tipo vista sconosciuto");
    await expect(planBaseView(planOf("calendar"), source, "Agenda")).resolves.toMatchObject({ viewType: "calendar", dateKey: "due" });
    await expect(planBaseView(planOf("timeline"), source, "Agenda")).resolves.toMatchObject({ viewType: "timeline", startKey: "from", endKey: null });
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

  it("reads the span of each note in a timeline view, and refuses a malformed one", async () => {
    const rows = [{ doc: "a.md", properties: [] }, { doc: "b.md", properties: [] }];
    const answer = (time: unknown[]) => deps(async () => custom({ rows: [{ doc: "a.md", values: {}, time: time[0] }, { doc: "b.md", values: {}, time: time[1] }], summaries: {} }));
    const derived = await deriveBaseRows(answer([{ start: "2026-11-14", end: "2026-11-10", inverted: true }, { start: "2026-11-01", end: null, inverted: false }]), source, "Lin", rows);
    expect(derived.rows.map((row) => row.span)).toEqual([{ start: "2026-11-14", end: "2026-11-10", inverted: true }, { start: "2026-11-01", end: null, inverted: false }]);
    expect(derived.rows[0]).not.toHaveProperty("day");
    await expect(deriveBaseRows(answer([{ start: "2026-11-14", end: null }, undefined]), source, "Lin", rows)).rejects.toThrow("intervallo malformato");
    await expect(deriveBaseRows(answer([{ start: "ieri", end: null, inverted: false }, undefined]), source, "Lin", rows)).rejects.toThrow("intervallo malformato");
  });

  // Un indice finto di `total` note che dà al più `cap` righe per domanda.
  const vaultOf = (total: number, cap = Infinity) => vi.fn(async (query: IndexQuery): Promise<IndexResult> => {
    if (query.kind !== "documents") throw new Error("unexpected query");
    const offset = query.page?.offset ?? 0;
    const count = Math.max(0, Math.min(query.page?.limit ?? 0, cap, total - offset));
    return { kind: "documents", value: {
      offset, total,
      items: Array.from({ length: count }, (_, i) => ({ doc: `${offset + i}.md`, properties: [] })),
    } };
  });

  it("consumes every row beyond the former 2,000-row cutoff", async () => {
    const queryIndex = vaultOf(2001);
    const result = await fetchAllDocuments(deps(queryIndex));
    expect(result.rows[result.rows.length - 1]?.doc).toBe("2000.md");
    expect(result.total).toBe(2001);
    expect(queryIndex).toHaveBeenCalledTimes(2);
  });

  // #520: ogni domanda costa all'indice un giro del vault. Con 5000 note
  // erano 20 domande da 256 righe in fila; ora la prima dice il totale e la
  // seconda chiede il resto.
  it("reads a vault of thousands of notes in two questions, not one every 256 rows", async () => {
    const queryIndex = vaultOf(5000);
    const result = await fetchAllDocuments(deps(queryIndex));
    expect(result.rows.map((row) => row.doc)).toEqual(Array.from({ length: 5000 }, (_, i) => `${i}.md`));
    expect(queryIndex.mock.calls.map(([query]) => (query as { page: unknown }).page)).toEqual([{ offset: 0, limit: 256 }, { offset: 256, limit: 4744 }]);
  });

  it("asks again for what is missing when the index answers with fewer rows than asked", async () => {
    const queryIndex = vaultOf(1000, 300);
    const result = await fetchAllDocuments(deps(queryIndex));
    expect(result.rows).toHaveLength(1000);
    expect(new Set(result.rows.map((row) => row.doc)).size).toBe(1000);
    expect(queryIndex).toHaveBeenCalledTimes(4);
  });

  it("reads a small vault in one question", async () => {
    const queryIndex = vaultOf(40);
    expect((await fetchAllDocuments(deps(queryIndex))).rows).toHaveLength(40);
    expect(queryIndex).toHaveBeenCalledTimes(1);
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

  it("una colonna prop.stato legge e scrive la proprietà stato: il comando riceve stato, mai prop.stato", async () => {
    // Il core riceve la chiave di colonna e scrive il nome del frontmatter:
    // il finto fa lo stesso. Una risposta che ripete `prop.stato` è rifiutata.
    const core = deps(async (request) => {
      const edits = (request as { query: { edits: { doc: string; key: string; expected: unknown; value?: string | null }[] } }).query.edits;
      return custom({ mutations: edits.map((edit) => ({
        doc: edit.doc, key: edit.key, command: edit.value == null ? "note.property.remove" : "note.property.set",
        args: { doc: edit.doc, key: edit.key.replace(/^prop\./, ""), expected: JSON.stringify(edit.expected), ...(edit.value == null ? {} : { value: edit.value }) },
      })) });
    });
    const row = { doc: "a.md", values: {}, properties: { stato: { kind: "text", value: "Arrivata" } } };
    const expected = expectedProperty(row, "prop.stato");
    expect(expected).toEqual({ kind: "value", value: { kind: "text", value: "Arrivata" } });
    expect(expectedProperty(row, "prop.valore")).toEqual({ kind: "absent" });
    const [set] = await prepareBaseMutations(core, source, "Board", [{ doc: "a.md", key: "prop.stato", expected, value: JSON.stringify("Confermata") }]);
    expect(set).toMatchObject({ command: "note.property.set", args: { key: "stato", value: '"Confermata"' } });
    const [clear] = await prepareBaseMutations(core, source, "Board", [{ doc: "a.md", key: "prop.stato", expected, value: null }]);
    expect(clear?.command).toBe("note.property.remove");
    expect(clear?.args).toMatchObject({ key: "stato" });
    expect(clear?.args).not.toHaveProperty("value");
    const echo = deps(async () => custom({ mutations: [{
      doc: "a.md", key: "prop.stato", command: "note.property.set",
      args: { doc: "a.md", key: "prop.stato", value: '"Confermata"', expected: JSON.stringify(expected) },
    }] }));
    await expect(prepareBaseMutations(echo, source, "Board", [{ doc: "a.md", key: "prop.stato", expected, value: JSON.stringify("Confermata") }])).rejects.toThrow("mutazione diversa");
  });

  it("le colonne container.* e file.* non sono proprietà: nessuna mutazione le scrive, neanche se il core la ripete", async () => {
    // `container.folder` è la cartella del file che ospita la Base, non una
    // proprietà della nota: il finto la ripete come `note.property.set`, e la
    // mutazione va rifiutata prima che arrivi a un comando.
    for (const key of ["container.folder", "file.mtime"]) {
      const core = deps(async () => custom({ mutations: [{
        doc: "a.md", key, command: "note.property.set",
        args: { doc: "a.md", key, expected: '{"kind":"absent"}', value: '"x"' },
      }] }));
      await expect(prepareBaseMutations(core, source, "Board", [
        { doc: "a.md", key, expected: { kind: "absent" }, value: '"x"' },
      ])).rejects.toThrow("sola lettura");
    }
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
    // Come l'host (`Host::map_tile`): niente query, che può portare una chiave.
    expect(allowedBaseTileUrl("https://tiles.example.test/{z}/{x}/{y}.png?key=x", "raster", ["tiles.example.test"], 1, 0, 0)).toBeNull();
    // Il sito del modello si legge anche senza host ammessi, per dire quale manca.
    expect(baseTileUrl(template, "raster", 1, 0, 0)?.hostname).toBe("tiles.example.test");
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

describe("le note legate dei riepiloghi di Relazione (T35)", () => {
  const wiki = (page: string) => ({ kind: "link", value: { kind: "wiki", value: { page, heading: null, block: null } } });
  const rows = [
    { doc: "Letture/2025.md", properties: [{ key: "libri", value: { kind: "list", value: [wiki("Dune"), wiki("Rotto")] } }] },
    { doc: "Letture/2026.md", properties: [{ key: "libri", value: wiki("Dune") }, { key: "altro", value: wiki("Ubik") }] },
  ];

  it("risolve ogni pagina una volta, legge le note trovate con le proprietà chieste e lascia fuori i link rotti", async () => {
    const asked: IndexQuery[] = [];
    const bridge = deps(async (query) => {
      asked.push(query);
      if (query.kind === "resolve") {
        const page = (query.target as { value: { page: string } }).value.page;
        return { kind: "resolved", value: page === "Dune" ? { doc: "Libri/Dune.md" } : null } as IndexResult;
      }
      return { kind: "documents", value: { offset: 0, total: 1, items: [{ doc: "Libri/Dune.md", properties: [{ key: "pagine", value: { kind: "number", value: 600 } }] }] } } as IndexResult;
    });
    const linked = await linkedNotes(bridge, { relations: ["libri"], linkedProps: ["pagine"] }, rows);
    expect(linked).toEqual([{ target: "Dune", folder: "Letture", doc: "Libri/Dune.md", props: { pagine: { kind: "number", value: 600 } } }]);
    expect(asked.filter((query) => query.kind === "resolve")).toHaveLength(2);
    expect(asked.find((query) => query.kind === "resolve")).toMatchObject({ from: "Letture/2025.md" });
  });

  it("lo stesso link in cartelle diverse si risolve dal punto di vista di ogni riga", async () => {
    const folders = [
      { doc: "A/Scaffale.md", properties: [{ key: "libri", value: wiki("Indice") }] },
      { doc: "A/Altro.md", properties: [{ key: "libri", value: wiki("Indice") }] },
      { doc: "B/Scaffale.md", properties: [{ key: "libri", value: wiki("Indice") }] },
    ];
    const asked: IndexQuery[] = [];
    const bridge = deps(async (query) => {
      asked.push(query);
      if (query.kind === "resolve") {
        const from = (query as { from: string }).from;
        return { kind: "resolved", value: { doc: `${from.split("/")[0]}/Indice.md` } } as IndexResult;
      }
      return { kind: "documents", value: { offset: 0, total: 2, items: [{ doc: "A/Indice.md", properties: [] }, { doc: "B/Indice.md", properties: [] }] } } as IndexResult;
    });
    const linked = await linkedNotes(bridge, { relations: ["libri"], linkedProps: ["pagine"] }, folders);
    expect(linked).toEqual([
      { target: "Indice", folder: "A", doc: "A/Indice.md", props: {} },
      { target: "Indice", folder: "B", doc: "B/Indice.md", props: {} },
    ]);
    expect(asked.filter((query) => query.kind === "resolve"), "una domanda per cartella e pagina").toHaveLength(2);
  });

  it("una vista senza riepiloghi di Relazione non chiede niente", async () => {
    const queryIndex = vi.fn(async () => custom(null));
    expect(await linkedNotes(deps(queryIndex), { relations: [], linkedProps: [] }, rows)).toEqual([]);
    expect(queryIndex).not.toHaveBeenCalled();
  });

  it("il piano porta le Relazioni e le proprietà legate; un host che non le dice vale come vuote", async () => {
    const raw = { view: "T", view_type: "table", columns: [], column_labels: {}, required_props: [], all_properties: false, group: null, limit: null, map: null, create_defaults: {} };
    await expect(planBaseView(deps(async () => custom(raw)), source, "T")).resolves.toMatchObject({ relations: [], linkedProps: [] });
    await expect(planBaseView(deps(async () => custom({ ...raw, relations: ["libri"], linked_props: ["pagine"] })), source, "T")).resolves.toMatchObject({ relations: ["libri"], linkedProps: ["pagine"] });
  });
});
