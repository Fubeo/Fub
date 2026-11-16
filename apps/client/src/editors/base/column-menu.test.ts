// Il menu della colonna: ogni voce scrive la chiave giusta della vista, col
// valore che il core legge, e niente altro; le voci spente dicono perché; il
// menu sta nel bilancio dei menu (nove voci, quattro gruppi).
import { describe, expect, it, vi } from "vitest";
import { forbiddenIn } from "../../i18n/lexicon";
import type { MenuItem } from "../../ui/menu";
import type { BasePlan, BaseRow, BaseSummaryDef } from "./data";
import {
  NOTE_COLUMN, columnKind, columnMenu, columnMenuItems, columnProperty, columnSummary, columnSurfaceItems,
  renamedInView, summariesWith, summaryChoices, type ColumnEntry, type ColumnMenuModel,
} from "./column-menu";

const summary = (key: string, aggregate: BaseSummaryDef["aggregate"], extra: Partial<BaseSummaryDef> = {}): BaseSummaryDef =>
  ({ key, aggregate, expression: null, name: null, label: `${key}:${aggregate.replace(/_/g, "")}`, ...extra });

const plan = (extra: Partial<BasePlan> = {}): BasePlan => ({
  view: "Tabella", viewType: "table", columns: ["stato", "valore", "consegna"], columnLabels: {},
  requiredProps: [], allProperties: false, group: null, limit: null, map: null, createDefaults: {},
  filters: "all", sort: [], order: ["stato", "valore", "consegna"], summaries: [], dateKey: null, startKey: null, endKey: null,
  ...extra,
});

const rows: BaseRow[] = [
  { doc: "a.md", properties: {}, values: { stato: { kind: "text", value: "Arrivata" }, valore: { kind: "number", value: 1200 }, consegna: { kind: "date", value: Date.UTC(2026, 10, 10) } } },
  { doc: "b.md", properties: {}, values: { stato: { kind: "text", value: "Prestito" }, valore: { kind: "number", value: 800.5 }, consegna: { kind: "empty" } } },
];

const model = (column: string, extra: Partial<ColumnMenuModel> = {}): ColumnMenuModel => ({
  plan: plan(), column, label: column, kind: columnKind(rows, column),
  grouping: null, regroupable: true, lock: null, busy: false, readOnly: false,
  ...extra,
});

const actions = () => ({ write: vi.fn(), rename: vi.fn(), setType: vi.fn(), copy: vi.fn() });

const find = (entries: readonly ColumnEntry[], id: string): ColumnEntry => {
  for (const entry of entries) {
    if (entry.id === id) return entry;
    if (entry.items) { const inner = entry.items.find((each) => each.id === id); if (inner) return inner; }
  }
  throw new Error(`nessuna voce ${id}`);
};

describe("le voci del menu della colonna scrivono la chiave giusta", () => {
  it("Ordina crescente e decrescente scrivono `sort` con la colonna in testa", () => {
    const act = actions();
    const entries = columnMenu(model("valore", { plan: plan({ sort: [{ key: "stato", descending: false }] }) }), act);
    find(entries, "base.column.sort.desc").run!();
    expect(act.write).toHaveBeenLastCalledWith("sort", [{ key: "valore", descending: true }, { key: "stato", descending: false }]);
    find(entries, "base.column.sort.asc").run!();
    expect(act.write).toHaveBeenLastCalledWith("sort", [{ key: "valore", descending: false }, { key: "stato", descending: false }]);
    expect(act.write).toHaveBeenCalledTimes(2);
  });

  it("la colonna della nota ordina per `file.name` e ha solo Ordina e Copia", () => {
    const act = actions();
    const entries = columnMenu(model(NOTE_COLUMN, { kind: "text" }), act);
    expect(entries.map((entry) => entry.id)).toEqual(["base.column.sort.asc", "base.column.sort.desc", "base.column.copy"]);
    find(entries, "base.column.sort.asc").run!();
    expect(act.write).toHaveBeenCalledWith("sort", [{ key: "file.name", descending: false }]);
  });

  it("una colonna ordinata mostra il verso scelto", () => {
    const entries = columnMenu(model("valore", { plan: plan({ sort: [{ key: "prop.valore", descending: true }] }) }), actions());
    expect(find(entries, "base.column.sort.desc").checked).toBe(true);
    expect(find(entries, "base.column.sort.asc").checked).toBe(false);
  });

  it("Raggruppa scrive `group` con la chiave, e la toglie se è già quella", () => {
    const act = actions();
    columnMenu(model("stato"), act).find((entry) => entry.id === "base.column.group")!.run!();
    expect(act.write).toHaveBeenLastCalledWith("group", { key: "stato" });
    const grouped = columnMenu(model("stato", { grouping: "stato" }), act);
    expect(find(grouped, "base.column.group").checked).toBe(true);
    find(grouped, "base.column.group").run!();
    expect(act.write).toHaveBeenLastCalledWith("group", null);
  });

  it("una bacheca o una mappa non si raggruppano dal menu", () => {
    const entries = columnMenu(model("stato", { regroupable: false }), actions());
    expect(entries.some((entry) => entry.id === "base.column.group")).toBe(false);
    // Il riepilogo apre il gruppo al posto del raggruppa.
    expect(find(entries, "base.column.summary").separator).toBe(true);
  });

  it("Riepilogo scrive `summaries` col solo riepilogo della colonna cambiato", () => {
    const act = actions();
    const kept = summary("stato", "count_filled", { name: "Piene a mano" });
    const entries = columnMenu(model("valore", { plan: plan({ summaries: [kept, summary("valore", "sum")] }) }), act);
    expect(find(entries, "base.column.summary.sum").checked).toBe(true);
    find(entries, "base.column.summary.average").run!();
    expect(act.write).toHaveBeenLastCalledWith("summaries", [
      { name: "Piene a mano", key: "stato", aggregate: "count_filled" },
      { key: "valore", aggregate: "average" },
    ]);
    find(entries, "base.column.summary.none").run!();
    expect(act.write).toHaveBeenLastCalledWith("summaries", [{ name: "Piene a mano", key: "stato", aggregate: "count_filled" }]);
    // Il riepilogo già scelto non riscrive il file.
    find(entries, "base.column.summary.sum").run!();
    expect(act.write).toHaveBeenCalledTimes(2);
  });

  it("l'ultimo riepilogo tolto toglie la chiave", () => {
    const act = actions();
    find(columnMenu(model("valore", { plan: plan({ summaries: [summary("valore", "max")] }) }), act), "base.column.summary.none").run!();
    expect(act.write).toHaveBeenCalledWith("summaries", null);
  });

  it("una colonna di testo offre solo conteggio, vuote e piene; una di numeri anche somma, media, minimo e massimo", () => {
    const ids = (column: string) => find(columnMenu(model(column), actions()), "base.column.summary").items!.map((entry) => entry.id.replace("base.column.summary.", ""));
    expect(ids("stato")).toEqual(["none", "count", "count_empty", "count_filled"]);
    expect(ids("valore")).toEqual(["none", "count", "sum", "average", "min", "max", "count_empty", "count_filled"]);
    expect(ids("consegna")).toEqual(["none", "count", "earliest", "latest", "count_empty", "count_filled"]);
  });

  it("Nascondi scrive `order` senza la colonna; l'unica colonna non si nasconde", () => {
    const act = actions();
    find(columnMenu(model("valore"), act), "base.column.hide").run!();
    expect(act.write).toHaveBeenCalledWith("order", ["stato", "consegna"]);
    const only = find(columnMenu(model("stato", { plan: plan({ order: ["stato"], columns: ["stato"] }) }), act), "base.column.hide");
    expect(only.enabled).toBe(false);
    expect(only.description).toBeTruthy();
  });

  it("Rinomina e Tipo chiamano i comandi delle proprietà, non scrivono il `.base`", () => {
    const act = actions();
    const entries = columnMenu(model("prop.stato"), act);
    find(entries, "base.column.rename").run!();
    expect(act.rename).toHaveBeenCalledWith("prop.stato");
    find(entries, "base.column.type.number").run!();
    expect(act.setType).toHaveBeenCalledWith("prop.stato", "number");
    expect(act.write).not.toHaveBeenCalled();
  });

  it("le colonne `file.*` e le formule non si rinominano e non hanno un tipo", () => {
    expect(columnProperty("file.mtime")).toBeNull();
    expect(columnProperty("formula.prezzo")).toBeNull();
    expect(columnProperty("prop.stato")).toBe("stato");
    const ids = columnMenu(model("file.mtime"), actions()).map((entry) => entry.id);
    expect(ids).not.toContain("base.column.rename");
    expect(ids).not.toContain("base.column.type");
  });

  it("in sola lettura e in una Base dentro una nota le voci che scrivono sono spente col perché", () => {
    for (const lock of ["read_only", "embedded"] as const) {
      const entries = columnMenu(model("valore", { lock, readOnly: lock === "read_only" }), actions());
      for (const id of ["base.column.sort.asc", "base.column.group", "base.column.summary", "base.column.hide"]) {
        const entry = find(entries, id);
        expect(entry.enabled, id).toBe(false);
        expect(entry.description, id).toBeTruthy();
      }
      expect(find(entries, "base.column.copy").enabled).toBe(true);
      // Nemmeno Rinomina e Tipo: rinominare dal blocco di una nota lascerebbe
      // il blocco sulla chiave vecchia. Il perché lo dice.
      for (const id of ["base.column.rename", "base.column.type"]) {
        const entry = find(entries, id);
        expect(entry.enabled, `${lock} ${id}`).toBe(false);
        expect(entry.description, `${lock} ${id}`).toBeTruthy();
      }
    }
    const embedded = columnMenu(model("valore", { lock: "embedded" }), actions());
    expect(find(embedded, "base.column.rename").description).toContain("file .base");
  });
});

describe("il menu della colonna sta nel bilancio dei menu", () => {
  const NAVIGATION = /\b(?:frecc(?:ia|e)|invio|enter|return|esc|escape|arrows?)\b|[↑↓←→⏎↵⎋]/iu;
  const flatten = (items: readonly MenuItem[]): MenuItem[] => items.flatMap((item) => [item, ...(item.items ? flatten(item.items as MenuItem[]) : [])]);
  for (const [name, extra] of [["libera", {}], ["sola lettura", { lock: "read_only", readOnly: true }], ["in volo", { busy: true }]] as const) {
    it(`nove voci e quattro gruppi al più, nessuna grigia senza un perché (${name})`, () => {
      const items = columnMenuItems(columnMenu(model("prop.valore", extra), actions()));
      expect(items.length).toBeLessThanOrEqual(9);
      expect(items.filter((item, index) => index === 0 || item.separator).length).toBeLessThanOrEqual(4);
      for (const item of flatten(items)) {
        if (item.disabled) expect(item.description, item.label).toBeTruthy();
        expect(forbiddenIn(item.label), item.label).toBeNull();
        expect(NAVIGATION.test(item.label), item.label).toBe(false);
      }
    });
  }

  it("il tasto destro ha le stesse voci, coi gruppi divisi", () => {
    const entries = columnMenu(model("prop.valore"), actions());
    const items = columnSurfaceItems(entries);
    expect(items.filter((item) => item === "—")).toHaveLength(3);
    expect(items.filter((item) => item !== "—").map((item) => typeof item === "string" ? item : item.id)).toEqual(entries.map((entry) => entry.id));
  });
});

describe("i conti puri del menu", () => {
  it("la specie di una colonna viene dalle celle piene", () => {
    expect(columnKind(rows, "valore")).toBe("number");
    expect(columnKind(rows, "consegna")).toBe("date");
    expect(columnKind(rows, "stato")).toBe("text");
    expect(columnKind(rows, "assente")).toBe("text");
    expect(summaryChoices("text")).toEqual(["count", "count_empty", "count_filled"]);
  });

  it("un riepilogo con un nome o una formula non è quello della colonna", () => {
    const named = summary("valore", "sum", { name: "Totale" });
    expect(columnSummary([named], "valore")).toBeNull();
    expect(summariesWith([named], "valore", "max").map((each) => each.name ?? each.aggregate)).toEqual(["Totale", "max"]);
  });

  it("il riepilogo cambiato resta al suo posto nel file", () => {
    const next = summariesWith([summary("valore", "sum"), summary("stato", "count")], "valore", "min");
    expect(next.map((each) => `${each.key}:${each.aggregate}`)).toEqual(["valore:min", "stato:count"]);
  });

  it("una proprietà rinominata riscrive le chiavi della vista che la nominano, scritte come prima", () => {
    const view = plan({
      filters: { and: [{ condition: { property: "stato", op: "is", value: "Arrivata" } }, { condition: { property: "valore", op: "greater_than", value: 10 } }] },
      sort: [{ key: "prop.stato", descending: true }],
      order: ["stato", "valore"],
      group: "stato",
      summaries: [summary("stato", "count"), summary("valore", "sum")],
    });
    expect(renamedInView(view, "stato", "fase")).toEqual([
      ["filters", { and: [{ condition: { property: "fase", op: "is", value: "Arrivata" } }, { condition: { property: "valore", op: "greater_than", value: 10 } }] }],
      ["sort", [{ key: "prop.fase", descending: true }]],
      ["order", ["fase", "valore"]],
      ["group", { key: "fase" }],
      ["summaries", [{ key: "fase", aggregate: "count" }, { key: "valore", aggregate: "sum" }]],
    ]);
    expect(renamedInView(view, "assente", "altro")).toEqual([]);
  });

  it("la rinomina riscrive anche le chiavi della mappa e delle date, e lascia le chiavi in più della mappa", () => {
    const map = plan({
      viewType: "map", order: [],
      map: { lat_key: "lat", lon_key: "lon", label_key: "stato", color_key: null, provider: null, raw: { lat_key: "lat", lon_key: "lon", label_key: "stato", zoom: 7 } },
    });
    expect(renamedInView(map, "stato", "fase")).toEqual([
      ["map", { lat_key: "lat", lon_key: "lon", label_key: "fase", color_key: null, zoom: 7 }],
    ]);
    const timeline = plan({ order: [], startKey: "inizio", endKey: "fine" });
    expect(renamedInView(timeline, "fine", "termine")).toEqual([["end", "termine"]]);
    const calendar = plan({ order: [], dateKey: "consegna" });
    expect(renamedInView(calendar, "consegna", "scadenza")).toEqual([["date", "scadenza"]]);
  });
});
