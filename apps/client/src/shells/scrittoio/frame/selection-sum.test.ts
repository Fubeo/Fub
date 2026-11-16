// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../../host/contract";
import type { SurfaceCellSelection } from "../../../editors/core/registry";
import { mountBaseSurface } from "../../../editors/base/surface";
import { TableGrid, type TableGridHost } from "../../../editors/text/profiles/markdown/table-grid";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { forwardNotice } from "../../../state/kernel";

const world = vi.hoisted(() => ({
  copied: [] as string[],
  copyFails: false,
  notices: [] as { text: string; tone: string }[],
  menu: null as null | { at: unknown; items: { label: string; checked?: boolean; disabled?: boolean; run?: () => void }[]; label?: string },
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
  showContextMenu: (at: unknown, items: NonNullable<typeof world.menu>["items"], options: { label?: string } = {}) => {
    world.menu = { at, items, label: options.label };
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

  it("la forma del computer vale dove il punto non separa le migliaia", () => {
    expect(read("1240.5", "fr")).toBe(1240.5);
    expect(read("3.14", "fr")).toBe(3.14);
    // In italiano il punto separa le migliaia: «1.240» è milleduecentoquaranta,
    // e un punto che non lo fa non è un numero (una data, un'ora).
    expect(read("1.240", "it")).toBe(1240);
    expect(read("1240.5", "it")).toBeNull();
    expect(read("3.14", "it")).toBeNull();
  });

  it("le date e le ore col punto non sono numeri dove il punto separa le migliaia", () => {
    expect(read("15.11", "it")).toBeNull();
    expect(read("12.30", "it")).toBeNull();
    expect(read("15.11", "de")).toBeNull();
    expect(read("1.240", "it")).toBe(1240);
    // In inglese il punto è la virgola dei decimali: quelli sono numeri.
    expect(read("15.11", "en")).toBe(15.11);
    expect(read("12.30", "en")).toBe(12.3);
    expect(read("1.240", "en")).toBe(1.24);
    expect(read("1240.5", "en")).toBe(1240.5);
  });

  it("un numero tra parentesi è negativo, come nei conti", () => {
    expect(read("(1.234)", "it")).toBe(-1234);
    expect(read("(€ 1.240,50)", "it")).toBe(-1240.5);
    expect(read("€ (1.240,50)", "it")).toBe(-1240.5);
    expect(read("(1,234.5)", "en")).toBe(-1234.5);
    expect(read("(-5)", "en")).toBeNull();
    expect(read("()", "en")).toBeNull();
    expect(read("(5", "en")).toBeNull();
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

  it("percentuali sole: somma, media, minimo e massimo si scrivono in percento", () => {
    const summary = summarizeSelection(selection("it", ["10%", "20%"]))!;
    expect(summary.percent).toBe(true);
    expect(formatStat(summary, "sum")).toBe("30%");
    expect(formatStat(summary, "average")).toBe("15%");
    expect(formatStat(summary, "min")).toBe("10%");
    expect(formatStat(summary, "max")).toBe("20%");
    expect(formatStat(summary, "count")).toBe("2");
    const fine = summarizeSelection(selection("en", ["12.5%", "10%"]))!;
    expect(formatStat(fine, "sum")).toBe("22.5%");
    expect(formatStat(fine, "average")).toBe("11.25%");
  });

  it("percentuali e numeri insieme: il percento vale la sua frazione, e i risultati sono numeri", () => {
    const summary = summarizeSelection(selection("it", ["50%", "2"]))!;
    expect(summary.percent).toBe(false);
    expect(formatStat(summary, "sum")).toBe("2,5");
    expect(formatStat(summary, "max")).toBe("2");
  });

  it("i risultati tolgono gli zeri in fondo, come il prototipo", () => {
    const summary = summarizeSelection(selection("it", ["1,50", "1,00"]))!;
    expect(formatStat(summary, "sum")).toBe("2,5");
    expect(formatStat(summary, "average")).toBe("1,25");
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

  it("nella Base Maiusc con le frecce scende riga per riga dalla cella, e la ricerca toglie la selezione", async () => {
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
      const viewport = host.querySelector<HTMLElement>(".base-table-viewport")!;
      const key = (target: Element, name: string, shiftKey = false) => {
        const event = new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
      };
      input.focus();
      // Nel campo aperto Maiusc con le frecce resta al campo: sceglie il testo.
      expect(key(input, "ArrowDown", true).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(input);
      expect(surface.cellSelection!.read()).toBeNull();
      // Esc lascia il campo (senza scriverlo) e porta alla cella: da lì Maiusc
      // con le frecce sceglie le celle.
      input.value = "9999";
      expect(key(input, "Escape").defaultPrevented).toBe(true);
      // Lasciato il campo, il numero torna a leggersi nel formato della lingua.
      expect(input.value).toBe("1.800");
      expect(document.activeElement).toBe(viewport);
      expect(host.querySelector('tr[data-index="0"] > td[data-cell="1"]')!.hasAttribute("data-picked")).toBe(true);
      for (let step = 0; step < 3; step++) key(viewport, "ArrowDown", true);
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

  it("nella Base la scelta resta quando il vault cambia altrove, e se ne va con le sue celle", async () => {
    // Le righe che l'indice dà adesso: il test le cambia fra una ricarica e
    // l'altra.
    let shown = [["Allestimento", 1800], ["Trasporti", 1200], ["Assicurazione", 600]] as [string, number][];
    const queryIndex = (request: IndexQuery): Promise<IndexResult> => {
      const rows = shown.map(([voce, previsto]) => ({ doc: `${voce}.md`, values: { previsto: { kind: "number", value: previsto } }, properties: {} }));
      if (request.kind === "documents") {
        return Promise.resolve({ kind: "documents", value: { offset: 0, total: rows.length, items: rows.map((row) => ({ doc: row.doc, properties: [] })) } });
      }
      const op = (request.kind === "custom" && typeof request.query === "object" && request.query && "op" in request.query) ? request.query.op : null;
      if (op === "parse") return Promise.resolve({ kind: "custom", value: { views: ["Tabella"] } });
      if (op === "plan") return Promise.resolve({ kind: "custom", value: {
        view: "Tabella", view_type: "table", columns: ["previsto"], column_labels: {},
        required_props: [], all_properties: false, group: null, limit: null, map: null, create_defaults: {},
      } });
      return Promise.resolve({ kind: "custom", value: { rows, summaries: {} } });
    };
    const host = document.createElement("div");
    document.body.append(host);
    const surface = mountBaseSurface("base", { paneId: "base-resta", documentId: "budget.base", parent: host }, {
      queryIndex,
      invokeCommand: async () => ({}),
      viewState: async () => null,
      setViewState: async () => {},
      onOpenDocument: () => {},
    });
    const otherNoteSaved = () => forwardNotice({
      event: { type: "document_changed", id: "altra.md", changes: { aspects: ["frontmatter"], properties: ["status"], tags_added: [], tags_removed: [] } },
      origin: { actor: { kind: "kernel" }, batch: null },
    });
    try {
      surface.buffer.setDoc("views:\n  - {name: Tabella, type: table}\n");
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(3));
      const cell = (row: number) => host.querySelector(`tr[data-index="${row}"] > td[data-cell="1"]`)!;
      press(cell(0), "pointerdown");
      press(cell(0), "pointerup");
      press(cell(1), "pointerdown", { shiftKey: true });
      expect(summarizeSelection(surface.cellSelection!.read()!)?.sum).toBe(3000);
      const heard = vi.fn();
      const stop = surface.cellSelection!.subscribe(heard);
      // Un'altra nota si salva, e una riga nuova arriva in cima: le stesse
      // celle (stessa nota, stessa colonna) restano scelte, col valore nuovo.
      shown = [["Cornici", 50], ["Allestimento", 1900], ["Trasporti", 1200], ["Assicurazione", 600]];
      otherNoteSaved();
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(4));
      expect(summarizeSelection(surface.cellSelection!.read()!)?.sum).toBe(3100);
      expect(heard).toHaveBeenCalled();
      expect([...host.querySelectorAll("tr[data-doc]")].filter((row) => row.querySelector("td[data-picked]")).map((row) => row.getAttribute("data-doc"))).toEqual(["Allestimento.md", "Trasporti.md"]);
      // Una delle due celle non c'è più: la scelta se ne va.
      shown = [["Cornici", 50], ["Trasporti", 1200], ["Assicurazione", 600]];
      otherNoteSaved();
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(3));
      expect(surface.cellSelection!.read()).toBeNull();
      expect(host.querySelectorAll("td[data-picked]").length).toBe(0);
      stop();
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

  it("a voce dice gli stessi conti, una volta per cambio", () => {
    const sum = new BandSum(life);
    document.body.append(sum.element, sum.voice);
    sum.show(summarizeSelection(selection("it", ["1.240", "860", "420"])));
    expect(sum.voice.textContent).toBe("Somma 2.520, Media 840, Conteggio 3");
    sum.show(null);
    expect(sum.voice.textContent).toBe("");
  });

  it("dalla tastiera (tasto Menu, Maiusc+F10) il menu si apre sul numero a fuoco, non in un angolo", () => {
    const sum = new BandSum(life);
    document.body.append(sum.element);
    sum.show(summarizeSelection(selection("it", ["1.240", "860", "420"])));
    const second = parts(sum)[1]!;
    second.focus();
    // Il tasto Menu: nessun tasto destro e nessun punto.
    second.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 }));
    expect(world.menu?.at).toBe(second);
    // Col puntatore, il punto del clic.
    const pointer = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 30 });
    second.dispatchEvent(pointer);
    expect(world.menu?.at).toBe(pointer);
  });

  it("smontata, se ne va dalla banda", () => {
    const sum = new BandSum(life);
    document.body.append(sum.element);
    life.close();
    expect(sum.element.isConnected).toBe(false);
  });
});
