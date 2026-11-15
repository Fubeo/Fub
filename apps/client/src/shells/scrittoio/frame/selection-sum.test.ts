// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../../host/contract";
import type { SurfaceCellSelection } from "../../../editors/core/registry";
import { mountBaseSurface } from "../../../editors/base/surface";
import { TableGrid, type TableGridHost } from "../../../editors/text/profiles/markdown/table-grid";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const world = vi.hoisted(() => ({
  copied: [] as string[],
  copyFails: false,
  notices: [] as { text: string; tone: string }[],
  menu: null as null | { items: { label: string; checked?: boolean; disabled?: boolean; run?: () => void }[]; label?: string },
}));

vi.mock("../../../platform/clipboard", async (original) => ({
  ...(await original<typeof import("../../../platform/clipboard")>()),
  writeClipboardText: (text: string) => {
    if (world.copyFails) return Promise.reject(new Error("niente appunti"));
    world.copied.push(text);
    return Promise.resolve();
  },
}));
vi.mock("../../../ui/notify", async (original) => ({
  ...(await original<typeof import("../../../ui/notify")>()),
  notify: (text: string, tone = "info") => void world.notices.push({ text, tone }),
}));
vi.mock("../../../ui/menu", async (original) => ({
  ...(await original<typeof import("../../../ui/menu")>()),
  showContextMenu: (_at: unknown, items: NonNullable<typeof world.menu>["items"], options: { label?: string } = {}) => {
    world.menu = { items, label: options.label };
  },
}));

import { BandSum, formatStat, readShownNumber, resetShownStats, summarizeSelection } from "./selection-sum";

const selection = (locale: string, values: readonly (string | number)[]): SurfaceCellSelection => ({ locale, values: () => values });
const read = (text: string, locale: string) => readShownNumber(text, locale)?.value ?? null;

describe("i numeri nella lingua della tabella", () => {
  it("in italiano il punto separa le migliaia e la virgola i decimali", () => {
    expect(read("1.240,50", "it")).toBe(1240.5);
    expect(read("2.520", "it")).toBe(2520);
    expect(read("1.234.567", "it")).toBe(1234567);
    expect(read(",5", "it")).toBe(0.5);
    expect(read("840", "it-IT")).toBe(840);
  });

  it("in inglese al contrario", () => {
    expect(read("1,240.50", "en")).toBe(1240.5);
    expect(read("2,520", "en-US")).toBe(2520);
    expect(read("1.240", "en")).toBe(1.24);
    expect(read("1.240,50", "en")).toBeNull();
    expect(read("1,5", "en")).toBeNull();
  });

  it("la forma del computer vale in ogni lingua, dove non si confonde", () => {
    expect(read("3.14", "it")).toBe(3.14);
    expect(read("1240.5", "it")).toBe(1240.5);
    // In italiano «1.240» resta milleduecentoquaranta: la forma della lingua
    // si prova prima.
    expect(read("1.240", "it")).toBe(1240);
  });

  it("segno, valuta, percentuale e spazi attorno", () => {
    expect(read(" −12,5 ", "it")).toBe(-12.5);
    expect(read("-3", "en")).toBe(-3);
    expect(read("+7", "en")).toBe(7);
    expect(read("€ 1.200", "it")).toBe(1200);
    expect(read("$1,200.25", "en")).toBe(1200.25);
    expect(read("12%", "it")).toBeCloseTo(0.12);
    expect(readShownNumber("12,5%", "it")?.decimals).toBe(3);
  });

  it("lo spazio delle migliaia del francese vale ogni spazio", () => {
    expect(read("1 240,5", "fr")).toBe(1240.5);
    expect(read("1 240,5", "fr")).toBe(1240.5);
  });

  it("il testo, le date e le celle vuote non sono numeri", () => {
    for (const text of ["", "  ", "Allestimento", "2026-11-15", "12/3", "1e5", "€", "-", "12 mele", "1.2.3,4,5", "x".repeat(80)]) {
      expect(read(text, "it")).toBeNull();
    }
  });

  it("una lingua che non c'è legge come l'inglese, senza errori", () => {
    expect(read("1,240.5", "zz-QQ")).toBe(1240.5);
    expect(read("1,240.5", "non è una lingua")).toBe(1240.5);
  });
});

describe("i conti di una selezione", () => {
  it("somma, media, conteggio, minimo e massimo delle sole celle numeriche", () => {
    const summary = summarizeSelection(selection("it", ["1.800", "Trasporti", "", "1.200", 600, "—"]))!;
    expect(summary).toMatchObject({ sum: 3600, count: 3, min: 600, max: 1800, average: 1200 });
    expect(formatStat(summary, "sum")).toBe("3.600");
    expect(formatStat(summary, "average")).toBe("1.200");
    expect(formatStat(summary, "count")).toBe("3");
    expect(formatStat(summary, "min")).toBe("600");
    expect(formatStat(summary, "max")).toBe("1.800");
  });

  it("come nel prototipo: «Somma 2.520 · Media 840 · Conteggio 3»", () => {
    const summary = summarizeSelection(selection("it", ["1.240", "860", "420"]))!;
    expect([formatStat(summary, "sum"), formatStat(summary, "average"), formatStat(summary, "count")]).toEqual(["2.520", "840", "3"]);
  });

  it("i risultati si scrivono nella lingua delle celle, coi loro decimali e senza rumore", () => {
    const english = summarizeSelection(selection("en", ["0.1", "0.2", "1,000"]))!;
    expect(formatStat(english, "sum")).toBe("1,000.3");
    expect(formatStat(english, "average")).toBe("333.43");
    const italian = summarizeSelection(selection("it", ["1", "2"]))!;
    expect(formatStat(italian, "average")).toBe("1,5");
  });

  it("con meno di due celle numeriche non c'è somma: resta il conto delle parole", () => {
    expect(summarizeSelection(selection("it", []))).toBeNull();
    expect(summarizeSelection(selection("it", ["12"]))).toBeNull();
    expect(summarizeSelection(selection("it", ["12", "Nota", ""]))).toBeNull();
    expect(summarizeSelection(selection("it", [Number.NaN, 4]))).toBeNull();
  });

  it("diecimila celle in un giro solo, senza copiarle", () => {
    let reads = 0;
    const many: SurfaceCellSelection = {
      locale: "it",
      *values() {
        reads++;
        for (let index = 1; index <= 10_000; index++) yield index % 10 === 0 ? "testo" : `${index},5`;
      },
    };
    const started = performance.now();
    const summary = summarizeSelection(many)!;
    expect(performance.now() - started).toBeLessThan(500);
    expect(reads).toBe(1);
    expect(summary.count).toBe(9_000);
    expect(summary.min).toBe(1.5);
    expect(summary.max).toBe(9_999.5);
  });
});

/// La stessa tabella in una nota e in una Base: le stesse celle scelte danno
/// lo stesso numero (il «Fatto quando» di T55).
describe("la tabella Markdown e la Base danno lo stesso numero", () => {
  const BUDGET = [
    ["Voce", "Previsto", "Speso"],
    ["Allestimento", "1.800", "1.240"],
    ["Trasporti", "1.200", "860"],
    ["Assicurazione", "600", "420"],
    ["Stampa", "700", "zero"],
  ];

  function markdownGrid(): TableGrid {
    let grid: TableGrid | null = null;
    const host: TableGridHost = {
      write: (next) => {
        grid?.update(next);
        return true;
      },
      readOnly: () => false,
      undo: () => {},
      redo: () => {},
      leave: () => {},
      cellHtml: () => null,
      activate: () => false,
      focused: () => {},
      changed: () => {},
    };
    grid = new TableGrid(host, { rows: BUDGET, aligns: BUDGET[0]!.map(() => null) });
    document.body.append(grid.element);
    return grid;
  }

  /// Le righe della Base: i numeri come numeri, come li tipizza l'indice, e
  /// la cella «zero» come testo.
  function baseQuery(request: IndexQuery): Promise<IndexResult> {
    const rows = BUDGET.slice(1).map(([voce, previsto, speso]) => ({
      doc: `${voce}.md`,
      values: {
        previsto: { kind: "number", value: Number(previsto!.replace(".", "")) },
        speso: Number.isNaN(Number(speso!.replace(".", ""))) ? { kind: "text", value: speso } : { kind: "number", value: Number(speso!.replace(".", "")) },
      },
      properties: {},
    }));
    if (request.kind === "documents") {
      return Promise.resolve({ kind: "documents", value: { offset: 0, total: rows.length, items: rows.map((row) => ({ doc: row.doc, properties: [] })) } });
    }
    const op = (request.kind === "custom" && typeof request.query === "object" && request.query && "op" in request.query) ? request.query.op : null;
    if (op === "parse") return Promise.resolve({ kind: "custom", value: { views: ["Tabella"] } });
    if (op === "plan") return Promise.resolve({ kind: "custom", value: {
      view: "Tabella", view_type: "table", columns: ["previsto", "speso"], column_labels: {},
      required_props: [], all_properties: false, group: null, limit: null, map: null, create_defaults: {},
    } });
    if (op === "derive") return Promise.resolve({ kind: "custom", value: { rows, summaries: {} } });
    throw new Error("domanda inattesa");
  }

  const press = (target: Element, type: string, init: PointerEventInit = {}) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));

  afterEach(() => document.body.replaceChildren());

  it("Previsto e Speso dalla seconda riga in giù: stessa somma, media e conteggio", async () => {
    const grid = markdownGrid();
    // Dalla testata di «Previsto» all'ultima riga di «Speso»: l'intestazione
    // non conta, «zero» è testo.
    grid.restore({ anchor: { row: 0, col: 1 }, focus: { row: 4, col: 2 } }, true);
    const note = summarizeSelection({ locale: "it", values: () => grid.selectedValues()! })!;

    const host = document.createElement("div");
    document.body.append(host);
    const surface = mountBaseSurface("base", { paneId: "base-somma", documentId: "budget.base", parent: host }, {
      queryIndex: baseQuery,
      invokeCommand: async () => ({}),
      viewState: async () => null,
      setViewState: async () => {},
      onOpenDocument: () => {},
    });
    try {
      surface.buffer.setDoc("views:\n  - {name: Tabella, type: table}\n");
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(4));
      const cell = (row: number, column: number) => host.querySelector(`tr[data-index="${row}"] > td[data-cell="${column}"]`)!;
      let told = 0;
      const stop = surface.cellSelection!.subscribe(() => told++);
      press(cell(0, 1), "pointerdown");
      press(cell(0, 1), "pointerup");
      // Una cella sola non si somma.
      expect(surface.cellSelection!.read()).toBeNull();
      press(cell(3, 2), "pointerdown", { shiftKey: true });
      expect(told).toBe(2);
      expect(host.querySelectorAll("td[data-picked]").length).toBe(8);
      const base = summarizeSelection(surface.cellSelection!.read()!)!;
      expect([base.sum, base.average, base.count, base.min, base.max]).toEqual([note.sum, note.average, note.count, note.min, note.max]);
      expect([note.sum, note.count]).toEqual([6820, 7]);
      // Esc torna alla cella; la tabella ridisegnata toglie la selezione.
      host.querySelector(".base-table-viewport")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(surface.cellSelection!.read()).toBeNull();
      expect(host.querySelectorAll("td[data-picked]").length).toBe(0);
      stop();
    } finally {
      surface.destroy();
      grid.destroy();
    }
  });

  it("nella Base Maiusc con le frecce scende riga per riga, e la ricerca toglie la selezione", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const surface = mountBaseSurface("base", { paneId: "base-frecce", documentId: "budget.base", parent: host }, {
      queryIndex: baseQuery,
      invokeCommand: async () => ({}),
      viewState: async () => null,
      setViewState: async () => {},
      onOpenDocument: () => {},
    });
    try {
      surface.buffer.setDoc("views:\n  - {name: Tabella, type: table}\n");
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(4));
      const input = host.querySelector<HTMLInputElement>('tr[data-index="0"] > td[data-cell="1"] input')!;
      input.focus();
      for (let step = 0; step < 3; step++) input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true }));
      const viewport = host.querySelector<HTMLElement>(".base-table-viewport")!;
      expect(document.activeElement).toBe(viewport);
      expect(summarizeSelection(surface.cellSelection!.read()!)?.sum).toBe(4300);
      const search = host.querySelector<HTMLInputElement>(".base-search")!;
      search.value = "Stampa";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(1));
      expect(surface.cellSelection!.read()).toBeNull();
    } finally {
      surface.destroy();
    }
  });
});

describe("la voce della banda", () => {
  let life: Lifetime;
  beforeEach(() => {
    life = openLifetime();
    world.copied = [];
    world.copyFails = false;
    world.notices = [];
    world.menu = null;
    resetShownStats();
  });
  afterEach(() => {
    life.close();
    document.body.replaceChildren();
  });

  const parts = (sum: BandSum) => [...sum.element.querySelectorAll<HTMLButtonElement>("button[data-stat]:not([hidden])")];
  const said = (sum: BandSum) => parts(sum).map((button) => button.textContent);

  it("dice Somma, Media e Conteggio; il primo numero è in inchiostro; senza conti si nasconde", () => {
    const sum = new BandSum(life);
    document.body.append(sum.element);
    expect(sum.element.hidden).toBe(true);
    sum.show(summarizeSelection(selection("it", ["1.240", "860", "420"])));
    expect(sum.element.hidden).toBe(false);
    expect(said(sum)).toEqual(["Somma2.520", "Media840", "Conteggio3"]);
    expect(parts(sum).map((button) => button.hasAttribute("data-lead"))).toEqual([true, false, false]);
    expect(parts(sum)[0]!.getAttribute("aria-label")).toBe("Somma 2.520: copia");
    expect(sum.element.getAttribute("role")).toBe("group");
    // I punti fra i conti: uno meno dei conti, e nessuno davanti.
    expect([...sum.element.querySelectorAll(".status-sum-dot:not([hidden])")].length).toBe(2);
    sum.show(null);
    expect(sum.element.hidden).toBe(true);
  });

  it("un clic su un numero lo copia, come lo mostra, e lo dice", async () => {
    const sum = new BandSum(life);
    document.body.append(sum.element);
    sum.show(summarizeSelection(selection("it", ["1.240", "860", "420"])));
    parts(sum)[0]!.click();
    await vi.waitFor(() => expect(world.copied).toEqual(["2.520"]));
    expect(world.notices[world.notices.length - 1]).toEqual({ text: "Copiato: Somma 2.520", tone: "info" });
    world.copyFails = true;
    parts(sum)[1]!.click();
    await vi.waitFor(() => expect(world.notices[world.notices.length - 1]?.tone).toBe("guasto"));
  });

  it("il tasto destro sceglie che cosa mostrare, anche minimo e massimo, e l'ultimo resta", () => {
    const sum = new BandSum(life);
    document.body.append(sum.element);
    sum.show(summarizeSelection(selection("it", ["1.240", "860", "420"])));
    sum.element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(world.menu?.label).toBe("Che cosa mostra la banda");
    expect(world.menu?.items.map((item) => [item.label, item.checked])).toEqual([
      ["Somma", true], ["Media", true], ["Conteggio", true], ["Minimo", false], ["Massimo", false],
    ]);
    world.menu!.items[3]!.run!();
    world.menu!.items[4]!.run!();
    world.menu!.items[1]!.run!();
    expect(said(sum)).toEqual(["Somma2.520", "Conteggio3", "Minimo420", "Massimo1.240"]);
    // Spenti tutti tranne uno, quello non si spegne.
    for (const stat of [0, 2, 3]) {
      sum.element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      world.menu!.items[stat]!.run!();
    }
    sum.element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(world.menu!.items[4]).toMatchObject({ checked: true, disabled: true });
    expect(said(sum)).toEqual(["Massimo1.240"]);
    expect(parts(sum)[0]!.hasAttribute("data-lead")).toBe(true);
    expect([...sum.element.querySelectorAll(".status-sum-dot:not([hidden])")].length).toBe(0);
  });

  it("smontata, se ne va dalla banda", () => {
    const sum = new BandSum(life);
    document.body.append(sum.element);
    life.close();
    expect(sum.element.isConnected).toBe(false);
  });
});
