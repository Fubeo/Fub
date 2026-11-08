// @vitest-environment happy-dom
// La finestra costruita dal catalogo: le regole dei parametri e la finestra
// usata da tastiera, come la usa chi non tocca il mouse.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { GridRun } from "../engine";
import { CATALOG_COMMANDS } from "./commands";
import { formParams, formSpecs, needsForm, openCommandForm, startValues, type CatalogCommand, type CatalogField, type FormEngine } from "./form";

const field = (nome: string, tipo: CatalogField["tipo"], facoltativo = false, extra: Partial<CatalogField> = {}): CatalogField => ({ nome, tipo, facoltativo, ...extra });

const COMMAND: CatalogCommand = {
  motore: "prova.comando",
  id: "fogli.prova.comando",
  titolo: "fogli.cmd.prova.comando",
  etichetta: "Prova",
  posto: { scheda: "home", gruppo: "cells" },
  effetto: "cambia",
  campi: [
    field("range", "intervallo"),
    field("cell", "cella", true),
    field("count", "numero", true),
    field("on", "sino", true),
    field("rule", "json", true),
    field("sheet", "foglio", true),
    field("kind", "scelta", false, { valori: ["chart", "image"] }),
    field("end", "testo", true, { unoFra: 0 }),
    field("periods", "numero", true, { unoFra: 0 }),
  ],
};

function engine(results: GridRun[] = []): FormEngine & { runs: [string, string][]; focused: number } {
  const state = {
    runs: [] as [string, string][],
    focused: 0,
    run: async (id: string, params = "{}") => {
      state.runs.push([id, params]);
      return results.shift() ?? { ok: true as const, result: null };
    },
    selectionRefs: () => ({ sheet: "Foglio1", range: "B2:C4", active: "B2" }),
    sheetNames: () => ["Foglio1", "Foglio2"],
    focus: () => {
      state.focused += 1;
    },
  };
  return state;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function key(target: Element, name: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

function type(control: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  control.value = text;
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("i parametri della finestra costruita", () => {
  it("parte dalla selezione per i campi obbligatori, e lascia vuoti i facoltativi", () => {
    expect(startValues(COMMAND.campi, engine())).toEqual({ range: "B2:C4", kind: "chart" });
  });

  it("non manda un facoltativo vuoto, né una casella che non si è toccata", () => {
    const read = formParams(COMMAND.campi, { range: "A1:A3", kind: "image", cell: "  ", count: "", on: false, end: "2027" }, new Set());
    expect(read).toEqual({ ok: true, params: { range: "A1:A3", kind: "image", end: "2027" } });
  });

  it("manda la casella facoltativa toccata, anche spenta", () => {
    const read = formParams(COMMAND.campi, { range: "A1", kind: "chart", on: false, periods: 3 }, new Set(["on"]));
    expect(read).toEqual({ ok: true, params: { range: "A1", kind: "chart", on: false, periods: 3 } });
  });

  it("dice il campo obbligatorio vuoto, il numero sbagliato e il JSON che non si legge", () => {
    expect(formParams(COMMAND.campi, { kind: "chart" }, new Set())).toEqual({ ok: false, error: "«Intervallo» non può restare vuoto." });
    expect(formParams(COMMAND.campi, { range: "A1", kind: "chart", count: "tre" }, new Set())).toEqual({ ok: false, error: "«Quantità» vuole un numero." });
    const json = formParams(COMMAND.campi, { range: "A1", kind: "chart", rule: "[1, 2" }, new Set());
    expect(json.ok).toBe(false);
    expect(formParams(COMMAND.campi, { range: "A1", kind: "chart", rule: "[1, 2]" }, new Set())).toEqual({ ok: true, params: { range: "A1", kind: "chart", rule: [1, 2] } });
  });

  it("legge il numero con la virgola", () => {
    expect(formParams(COMMAND.campi, { range: "A1", kind: "chart", count: "2,5" }, new Set())).toEqual({ ok: true, params: { range: "A1", kind: "chart", count: 2.5 } });
  });

  it("del gruppo «uno fra» manda quello compilato, e non due", () => {
    expect(formParams(COMMAND.campi, { range: "A1", kind: "chart", end: "2027", periods: 3 }, new Set())).toEqual({
      ok: false,
      error: "Compila uno solo fra «Fine», «Periodi».",
    });
    const required = [field("palette", "scelta", false, { valori: ["a"], unoFra: 0 }), field("colors", "json", false, { unoFra: 0 })];
    expect(formParams(required, {}, new Set())).toEqual({ ok: false, error: "Compila uno fra «Tavolozza», «Colori»." });
    expect(formParams(required, { colors: "[\"#fff\"]" }, new Set())).toEqual({ ok: true, params: { colors: ["#fff"] } });
  });

  it("mette il gruppo «uno fra» in una sezione sua", () => {
    const specs = formSpecs(COMMAND.campi, ["Foglio1"]);
    expect(specs.map((spec) => spec.kind)).toEqual(["text", "text", "number", "check", "custom", "select", "select", "section"]);
  });

  it("apre la finestra solo per un comando con un parametro obbligatorio", () => {
    const bold = CATALOG_COMMANDS.find((command) => command.motore === "home.bold")!;
    const tab = CATALOG_COMMANDS.find((command) => command.motore === "sheet.tabColor")!;
    expect(needsForm(bold)).toBe(false);
    expect(needsForm(tab)).toBe(true);
  });

  it("sa costruire la finestra di ogni comando del catalogo", () => {
    for (const command of CATALOG_COMMANDS) {
      expect(() => formSpecs(command.campi, ["Foglio1"])).not.toThrow();
    }
  });
});

describe("la finestra costruita, da tastiera", () => {
  it("si compila e si applica con Invio, e il fuoco torna alla griglia", async () => {
    const grid = engine();
    const life = openLifetime();
    const form = openCommandForm(COMMAND, "Prova", grid, life);
    expect(form.element.getAttribute("role")).toBe("dialog");
    const range = form.element.querySelector<HTMLInputElement>('[data-key="range"]')!;
    expect(range.value).toBe("B2:C4");
    const labels = [...form.element.querySelectorAll(".grid-dialog-label")].map((label) => label.textContent);
    expect(labels).toContain("Cella (facoltativo)");
    type(form.element.querySelector<HTMLInputElement>('[data-key="periods"]')!, "4");
    range.focus();
    key(range, "Enter");
    await form.closed;
    expect(grid.runs).toEqual([["prova.comando", JSON.stringify({ range: "B2:C4", kind: "chart", periods: 4 })]]);
    expect(grid.focused).toBe(1);
    expect(document.querySelector(".grid-command-dialog")).toBeNull();
    life.close();
  });

  it("scrive dentro il rifiuto del motore e resta aperta", async () => {
    const grid = engine([{ ok: false, error: "Il riferimento non è valido." }]);
    const life = openLifetime();
    const form = openCommandForm(COMMAND, "Prova", grid, life);
    const range = form.element.querySelector<HTMLInputElement>('[data-key="range"]')!;
    key(range, "Enter");
    await flush();
    await flush();
    const alert = form.element.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toBe("Il riferimento non è valido.");
    expect(document.querySelector(".grid-command-dialog")).not.toBeNull();
    type(range, "");
    expect(alert.hidden).toBe(true);
    key(range, "Enter");
    await flush();
    expect(alert.textContent).toBe("«Intervallo» non può restare vuoto.");
    expect(grid.runs).toHaveLength(1);
    life.close();
  });

  it("si chiude con Esc senza dare il comando", async () => {
    const grid = engine();
    const life = openLifetime();
    const form = openCommandForm(COMMAND, "Prova", grid, life);
    key(form.element, "Escape");
    await form.closed;
    expect(grid.runs).toEqual([]);
    expect(grid.focused).toBe(1);
    life.close();
  });
});
