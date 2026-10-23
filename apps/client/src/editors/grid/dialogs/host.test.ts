// @vitest-environment happy-dom
//
// Le finestre dei fogli su un motore finto: che cosa chiedono al provider,
// che la ragione di un rifiuto resti scritta nella finestra aperta, il ritorno
// alla finestra da cui si è venuti e lo smontaggio.
import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../../__fixtures__/xlsx-grid.json";
import type { GridCommandState, GridSheetView } from "../../../host/contract";
import type { GridRun } from "../engine";
import { DIALOGS } from "./catalog";
import { mountGridDialogs, type DialogEngine, type GridDialogs } from "./host";
import { t } from "./strings";

const SHEET: GridSheetView = {
  frozen_rows: 0,
  frozen_columns: 0,
  gridlines: true,
  headings: true,
  zoom: 100,
  right_to_left: false,
  mode: "normal",
  formulas: false,
  protected: false,
  print_gridlines: false,
  print_headings: false,
};

interface Fake {
  engine: DialogEngine;
  runs: [string, unknown][];
  queries: [string, unknown][];
  answers: Record<string, unknown>;
  /// La ragione con cui il provider rifiuta il prossimo comando.
  refuse: string | null;
  focused: number;
  written: string[];
}

function fake(): Fake {
  const state: Fake = {
    engine: null as unknown as DialogEngine,
    runs: [],
    queries: [],
    answers: {},
    refuse: null,
    focused: 0,
    written: [],
  };
  const commands: GridCommandState[] = fixture.session.commands.map((command) => ({ ...command }));
  state.engine = {
    commands: () => commands,
    run: async (id, params = "{}"): Promise<GridRun> => {
      state.runs.push([id, JSON.parse(params)]);
      if (state.refuse !== null) {
        const error = state.refuse;
        state.refuse = null;
        return { ok: false, error };
      }
      return { ok: true, result: JSON.stringify(state.answers[id] ?? null) };
    },
    query: async (id, params = "{}") => {
      state.queries.push([id, JSON.parse(params)]);
      return id in state.answers ? JSON.stringify(state.answers[id]) : null;
    },
    selectionRefs: () => ({ sheet: "Foglio1", range: "B2:D10", active: "B2" }),
    selection: () => ({ focus: { row: 1, column: 1 } }),
    sheetNames: () => ["Foglio1", "Foglio2"],
    hiddenSheets: () => [],
    sheetView: () => SHEET,
    tables: () => [],
    book: () => fixture.session.book as never,
    activeStyle: () => undefined,
    viewportSize: () => ({ width: 800, height: 600 }),
    lineSize: () => 20,
    writeFormula: (text) => {
      state.written.push(text);
      return true;
    },
    focus: () => {
      state.focused += 1;
    },
  };
  return state;
}

/// Lascia girare le promesse e le microtask (le finestre si costruiscono in
/// modo asincrono).
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function press(dialogs: GridDialogs, action: string): void {
  const button = dialogs.current()?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  expect(button, `manca l'azione ${action}`).toBeTruthy();
  button!.click();
}

function control<T extends HTMLElement>(dialogs: GridDialogs, key: string): T {
  const element = dialogs.current()?.querySelector<T>(`[data-key="${key}"]`);
  expect(element, `manca il campo ${key}`).toBeTruthy();
  return element!;
}

let mounted: GridDialogs | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
});

function mount(state: Fake): GridDialogs {
  mounted = mountGridDialogs(state.engine);
  return mounted;
}

describe("le finestre dei fogli", () => {
  it("serve soltanto comandi del catalogo del provider", () => {
    const ids = new Set(fixture.session.commands.map((command) => command.id));
    // Ogni finestra che dà un comando lo dà fra quelli che il provider conosce:
    // qui basta che il catalogo non sia vuoto e che le chiavi siano id semplici.
    expect(Object.keys(DIALOGS).length).toBeGreaterThan(30);
    for (const id of Object.keys(DIALOGS)) expect(id).toMatch(/^[a-z][A-Za-z0-9]*$/);
    expect(ids.has("home.formatCells")).toBe(true);
  });

  it("non apre una finestra che non conosce", () => {
    const state = fake();
    const dialogs = mount(state);
    expect(dialogs.open({ id: "pageSetup", params: "{}" })).toBe(false);
    expect(dialogs.current()).toBeNull();
  });

  it("rinomina il foglio e si chiude quando il provider prende il comando", async () => {
    const state = fake();
    const dialogs = mount(state);
    expect(dialogs.open({ id: "renameSheet", params: '{"sheet":"Foglio2"}' })).toBe(true);
    await settle();
    const input = control<HTMLInputElement>(dialogs, "name");
    input.value = "  Riepilogo ";
    input.dispatchEvent(new Event("input"));
    press(dialogs, "ok");
    await settle();
    expect(state.runs).toEqual([["sheet.rename", { sheet: "Foglio2", name: "Riepilogo" }]]);
    expect(dialogs.current()).toBeNull();
    expect(state.focused).toBe(1);
  });

  it("tiene aperta la finestra con la ragione del rifiuto", async () => {
    const state = fake();
    const dialogs = mount(state);
    dialogs.open({ id: "renameSheet", params: "{}" });
    await settle();
    const input = control<HTMLInputElement>(dialogs, "name");
    input.value = "Foglio1";
    input.dispatchEvent(new Event("input"));
    state.refuse = "Il nome è già usato.";
    press(dialogs, "ok");
    await settle();
    const error = dialogs.current()?.querySelector<HTMLElement>(".grid-dialog-error");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe("Il nome è già usato.");
    // Al secondo tentativo la ragione se ne va con la finestra.
    press(dialogs, "ok");
    await settle();
    expect(dialogs.current()).toBeNull();
  });

  it("Formato celle dà soltanto ciò che è cambiato", async () => {
    const state = fake();
    state.answers["cell.get"] = {
      value: 3.5,
      style: {
        num_fmt: "General",
        font: { name: "Calibri", size: 11, bold: false, italic: false, color: "Auto", underline: "None", strike: false, vert: "Baseline" },
        align: { h: "General", v: "Bottom", wrap: false, shrink: false, indent: 0, rotation: 0 },
        borders: {},
        fill: { pattern: "None", fg: "Auto", bg: "Auto" },
        protection: { locked: true, hidden: false },
      },
    };
    state.answers["formulas.evaluate"] = "3,50";
    const dialogs = mount(state);
    dialogs.open({ id: "formatCells", params: '{"tab":"font"}' });
    await settle();
    // Parte dalla scheda chiesta.
    const selected = dialogs.current()?.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.getAttribute("data-tab")).toBe("font");
    const bold = control<HTMLSelectElement>(dialogs, "fontStyle");
    bold.value = "bold";
    bold.dispatchEvent(new Event("change"));
    const wrap = control<HTMLInputElement>(dialogs, "wrap");
    wrap.checked = true;
    wrap.dispatchEvent(new Event("change"));
    press(dialogs, "ok");
    await settle();
    expect(state.runs).toEqual([["home.formatCells", { style: { font: { bold: true, italic: false }, align: { wrap: true } } }]]);
  });

  it("Formato celle mostra l'esempio calcolato dal provider", async () => {
    const state = fake();
    state.answers["cell.get"] = { value: 3.5, style: { num_fmt: "0.00" } };
    state.answers["formulas.evaluate"] = "3,50";
    const dialogs = mount(state);
    dialogs.open({ id: "formatCells", params: "{}" });
    await settle();
    expect(dialogs.current()?.querySelector(".grid-dialog-sample-text")?.textContent).toBe("3,50");
    expect(state.queries.find(([id]) => id === "formulas.evaluate")?.[1]).toEqual({ formula: '=TEXT(B2,"0.00")' });
  });

  it("torna a Gestione nomi quando Definisci nome si chiude", async () => {
    const state = fake();
    state.answers["formulas.nameManager"] = { value: [{ name: "Tasso", value: 0.05, refersTo: "=Foglio1!$B$1", scope: "Workbook" }] };
    const dialogs = mount(state);
    dialogs.open({ id: "nameManager", params: "{}" });
    await settle();
    const manager = dialogs.current();
    expect(manager?.textContent).toContain("Tasso");
    const create = [...manager!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === t("grid.dialog.names.new"));
    create!.click();
    await settle();
    expect(dialogs.current()).not.toBe(manager);
    expect(dialogs.current()?.querySelector('[data-key="name"]')).toBeTruthy();
    press(dialogs, "cancel");
    await settle();
    // La gestione si riapre, riletta.
    expect(dialogs.current()?.textContent).toContain("Tasso");
    expect(state.queries.filter(([id]) => id === "formulas.nameManager").length).toBe(2);
    expect(state.focused).toBe(0);
  });

  it("Inserisci funzione comincia la formula nella cella", async () => {
    const state = fake();
    state.answers["formulas.functions"] = { value: [{ name: "SUM", category: "MathTrig", signature: "SUM(number1, …)", description: "" }] };
    state.answers["formulas.recentlyUsed"] = { value: [] };
    const dialogs = mount(state);
    dialogs.open({ id: "insertFunction", params: "{}" });
    await settle();
    press(dialogs, "ok");
    await settle();
    expect(state.written).toEqual(["SUM("]);
    expect(dialogs.current()).toBeNull();
  });

  it("non mostra una finestra che si costruisce dopo un'altra chiesta più tardi", async () => {
    const state = fake();
    state.answers["formulas.nameManager"] = { value: [] };
    const dialogs = mount(state);
    dialogs.open({ id: "nameManager", params: "{}" });
    dialogs.open({ id: "renameSheet", params: "{}" });
    await settle();
    expect(dialogs.current()?.querySelector('[data-key="name"]')).toBeTruthy();
    expect(document.querySelectorAll(".kit-dialog").length).toBe(1);
  });

  it("si smonta senza lasciare finestre", async () => {
    const state = fake();
    const dialogs = mount(state);
    dialogs.open({ id: "renameSheet", params: "{}" });
    await settle();
    expect(document.querySelectorAll(".kit-dialog").length).toBe(1);
    dialogs.destroy();
    mounted = null;
    await settle();
    expect(document.querySelectorAll(".kit-dialog").length).toBe(0);
    expect(dialogs.open({ id: "renameSheet", params: "{}" })).toBe(false);
  });
});
