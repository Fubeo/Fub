// @vitest-environment happy-dom
//
// Il piede della Base: i riepiloghi del core sotto le loro colonne, coi
// numeri nel formato della lingua. Il piede legge i valori per nome e non
// ricalcola niente.
import { describe, expect, it } from "vitest";
import type { BaseCellValue, BaseSummaryDef } from "./data";
import { countText, listFooter, placeSummaries, summaryText, tableFooter, type BaseFooterInput } from "./footer";

const summary = (key: string, aggregate: BaseSummaryDef["aggregate"], extra: Partial<BaseSummaryDef> = {}): BaseSummaryDef =>
  ({ key, aggregate, expression: null, name: null, label: `${key}:${aggregate.replace(/_/g, "")}`, ...extra });

const input = (extra: Partial<BaseFooterInput> = {}): BaseFooterInput => ({
  columns: ["stato", "valore", "consegna"],
  summaries: [summary("valore", "sum"), summary("consegna", "latest"), summary("stato", "count_filled")],
  values: {
    "valore:sum": { kind: "number", value: 12345.678 },
    "consegna:latest": { kind: "date", value: Date.UTC(2026, 10, 20) },
    "stato:countfilled": { kind: "number", value: 7 },
  },
  count: 12,
  locale: "it",
  labelOf: (key) => key === "museo" ? "Museo" : key,
  ...extra,
});

describe("il piede della tabella", () => {
  it("mette ogni riepilogo sotto la sua colonna, col numero nel formato della lingua", () => {
    const table = document.createElement("table");
    table.append(tableFooter(input()));
    const foot = table.querySelector("tfoot.base-foot")!;
    const cells = [...foot.querySelectorAll("td")];
    // La prima cella sta sotto la nota: il conteggio.
    expect(cells).toHaveLength(4);
    expect(cells[0]!.querySelector(".base-foot-count")!.textContent).toBe("12 note");
    expect(cells[1]!.dataset.column).toBe("stato");
    expect(cells[1]!.textContent).toBe("Piene7");
    expect(cells[2]!.querySelector(".base-foot-name")!.textContent).toBe("Somma");
    expect(cells[2]!.querySelector(".base-foot-value")!.textContent).toBe("12.345,68");
    expect(cells[3]!.querySelector(".base-foot-value")!.textContent).toMatch(/^20 nov/);
  });

  it("in inglese i separatori sono quelli inglesi", () => {
    const table = document.createElement("table");
    table.append(tableFooter(input({ locale: "en" })));
    expect(table.querySelector('[data-summary="valore:sum"] .base-foot-value')!.textContent).toBe("12,345.68");
  });

  it("un riepilogo con nome o formula, o di una colonna nascosta, sta accanto al conteggio col nome della colonna", () => {
    const loose = [summary("museo", "count", { name: "Musei" }), summary("valore", "sum", { expression: "valore * 2", label: "doppio" })];
    const table = document.createElement("table");
    table.append(tableFooter(input({ summaries: loose, values: { "museo:count": { kind: "number", value: 3 }, doppio: { kind: "number", value: 4 } } })));
    const first = table.querySelector("td")!;
    expect([...first.querySelectorAll(".base-foot-name")].map((name) => name.textContent)).toEqual(["Museo · Musei", "valore · Somma"]);
    expect([...table.querySelectorAll("td")].slice(1).every((cell) => cell.textContent === "")).toBe(true);
  });

  it("un riepilogo in errore dice «errore» e il perché nel titolo", () => {
    const table = document.createElement("table");
    table.append(tableFooter(input({ values: { "valore:sum": { kind: "error", value: "tipo sbagliato" } } as Record<string, BaseCellValue> })));
    const value = table.querySelector('[data-summary="valore:sum"] .base-foot-value') as HTMLElement;
    expect(value.textContent).toBe("errore");
    expect(value.title).toBe("tipo sbagliato");
    expect(value.classList.contains("base-foot-error")).toBe(true);
    // Un valore che il core non ha dato resta una lineetta.
    expect(table.querySelector('[data-summary="stato:countfilled"] .base-foot-value')!.textContent).toBe("—");
  });

  it("senza riepiloghi il piede dice solo quante note", () => {
    const table = document.createElement("table");
    table.append(tableFooter(input({ summaries: [], values: {}, count: 1 })));
    expect(table.querySelector("tfoot")!.textContent).toBe("1 nota");
  });
});

describe("il piede delle altre viste", () => {
  it("mette il conteggio e i riepiloghi in fila, col nome della colonna", () => {
    const foot = listFooter(input());
    expect(foot.className).toBe("base-summaries");
    expect([...foot.children].map((each) => each.textContent)).toEqual(["12 note", "valore · Somma12.345,68", expect.stringMatching(/^consegna · L'ultima20 nov/), "stato · Piene7"]);
  });
});

describe("i testi del piede", () => {
  it("formatta numeri, date e conteggi nella lingua", () => {
    expect(summaryText({ kind: "number", value: 0.5 }, "it")).toBe("0,5");
    expect(summaryText({ kind: "date", value: Date.UTC(2024, 2, 2) }, "it", new Date("2026-11-15"))).toBe("2 mar 2024");
    expect(summaryText(undefined, "it")).toBe("—");
    expect(countText(1500, "it")).toBe("1500 note");
    expect(countText(12000, "it")).toBe("12.000 note");
  });

  it("divide i riepiloghi fra le colonne mostrate", () => {
    const { byColumn, loose } = placeSummaries(["prop.valore"], [summary("valore", "sum"), summary("altro", "count")]);
    expect([...byColumn.keys()]).toEqual(["prop.valore"]);
    expect(loose.map((each) => each.key)).toEqual(["altro"]);
  });
});
