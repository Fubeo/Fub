// @vitest-environment happy-dom
//
// La barra multifunzione su un motore finto: che cosa mostra del catalogo,
// quali comandi dà e con quali parametri, la tastiera di Excel, lo smontaggio.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fixture from "../../../__fixtures__/xlsx-grid.json";
import type { GridCellStyle, GridCommandState, GridSheetView, GridTable } from "../../../host/contract";
import { iconEl } from "../../../ui/icons";
import { closeContextMenu } from "../../../ui/menu";
import { mountRibbon, type GridRibbon, type RibbonEngine } from "./ribbon";

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
  engine: RibbonEngine;
  root: HTMLElement;
  calls: [string, unknown][];
  written: string[];
  focused: number;
  commands: GridCommandState[];
  style: Partial<GridCellStyle> | undefined;
  tables: GridTable[];
  focus: { row: number; column: number };
  on: boolean;
  queries: Record<string, unknown>;
}

function fake(): Fake {
  const root = document.createElement("div");
  const host = document.createElement("div");
  root.append(host);
  document.body.append(root);
  const state: Fake = {
    root,
    calls: [],
    written: [],
    focused: 0,
    commands: fixture.session.commands.map((command) => ({ ...command })),
    style: undefined,
    tables: [],
    focus: { row: 0, column: 0 },
    on: true,
    queries: {},
    engine: null as unknown as RibbonEngine,
  };
  state.engine = {
    ribbonHost: () => host,
    commands: () => state.commands,
    commandable: () => state.on,
    activeStyle: () => state.style as GridCellStyle | undefined,
    sheetView: () => SHEET,
    tables: () => state.tables,
    book: () => fixture.session.book as never,
    hiddenSheets: () => [],
    viewportSize: () => ({ width: 800, height: 600 }),
    selection: () => ({ focus: state.focus }),
    command: (id, params = "{}") => {
      state.calls.push([id, JSON.parse(params)]);
      return true;
    },
    query: async (id) => (id in state.queries ? JSON.stringify(state.queries[id]) : null),
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

let f: Fake;
let ribbon: GridRibbon;

beforeEach(() => {
  f = fake();
  ribbon = mountRibbon(f.engine);
});

afterEach(() => {
  closeContextMenu();
  ribbon.destroy();
  document.body.replaceChildren();
});

const last = () => f.calls[f.calls.length - 1];
const tabNames = () => [...f.root.querySelectorAll<HTMLElement>(".kit-tab")].map((tab) => tab.textContent);
const control = (label: string) => {
  const found = [...f.root.querySelectorAll<HTMLElement>("button, select, input")].find(
    (el) => el.getAttribute("aria-label") === label || el.id && f.root.querySelector(`label[for="${el.id}"]`)?.textContent === label,
  );
  if (!found) throw new Error(`nessun controllo «${label}»`);
  return found;
};
const tab = (name: string) => [...f.root.querySelectorAll<HTMLElement>(".kit-tab")].find((el) => el.textContent === name)!;
const menuItem = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("#context-menu [role^=menuitem]")].find((el) => el.textContent?.startsWith(name));
const key = (target: EventTarget, type: "keydown" | "keyup", name: string) =>
  target.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true }));

describe("la barra multifunzione", () => {
  it("mostra le schede che il catalogo serve, senza quella della tabella", () => {
    expect(tabNames()).toEqual(["Home", "Inserisci", "Layout di pagina", "Formule", "Dati", "Revisione", "Visualizza"]);
    expect(f.root.querySelector(".grid-ribbon")!.hasAttribute("hidden")).toBe(false);
  });

  it("dà il comando di un pulsante e ne mostra lo stato", () => {
    const bold = control("Grassetto");
    bold.click();
    expect(f.calls).toEqual([["home.bold", {}]]);
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    f.style = { bold: true };
    ribbon.refresh();
    expect(bold.getAttribute("aria-pressed")).toBe("true");
  });

  it("spegne un comando spento e toglie quello che il catalogo non serve", () => {
    f.commands = f.commands
      .filter((command) => command.id !== "home.italic")
      .map((command) => (command.id === "home.bold" ? { ...command, enabled: false, reason: "il foglio è protetto" } : command));
    ribbon.refresh();
    expect(control("Grassetto").getAttribute("aria-disabled")).toBe("true");
    const italic = [...f.root.querySelectorAll(".grid-ribbon-item")].find((el) => el.querySelector('[aria-label="Corsivo"]'));
    expect((italic as HTMLElement).hidden).toBe(true);
  });

  it("si nasconde quando i comandi non si possono dare", () => {
    f.on = false;
    ribbon.refresh();
    expect((f.root.querySelector(".grid-ribbon") as HTMLElement).hidden).toBe(true);
  });

  it("mostra la scheda della tabella con la selezione dentro", () => {
    f.tables = [
      {
        name: "Vendite",
        row: 2,
        column: 1,
        rows: 5,
        columns: 3,
        header_row: true,
        totals_row: false,
        banded_rows: true,
        banded_columns: false,
        first_column: false,
        last_column: false,
        filter_button: true,
        style: "TableStyleMedium2",
      },
    ];
    f.focus = { row: 3, column: 2 };
    ribbon.refresh();
    expect(tabNames()).toContain("Struttura tabella");
    tab("Struttura tabella").click();
    const total = control("Riga totale") as HTMLInputElement;
    expect(total.checked).toBe(false);
    total.click();
    expect(last()).toEqual(["table.totalRow", { table: "Vendite", on: true }]);
    expect((control("Nome tabella") as HTMLInputElement).value).toBe("Vendite");
  });

  it("ripete l'ultimo bordo scelto", () => {
    control("Tipi di bordo").click();
    menuItem("Tutti i bordi")!.click();
    expect(last()).toEqual(["home.borders", { preset: "all" }]);
    control("Bordi").click();
    expect(last()).toEqual(["home.borders", { preset: "all" }]);
  });

  it("sceglie un colore del tema dalla tavolozza", () => {
    control("Altri colori: Colore riempimento").click();
    const swatches = [...document.querySelectorAll<HTMLButtonElement>(".grid-ribbon-swatch")];
    expect(swatches).toHaveLength(70);
    swatches.find((el) => el.getAttribute("aria-label") === "Colore 1, più chiaro 40%")!.click();
    expect(last()).toEqual(["home.fillColor", { color: { theme: 4, tint: 0.4 } }]);
    control("Colore riempimento").click();
    expect(last()).toEqual(["home.fillColor", { color: { theme: 4, tint: 0.4 } }]);
  });

  it("cambia il carattere dall'elenco", () => {
    const font = control("Tipo di carattere") as HTMLSelectElement;
    // Lo stile della cella tace il carattere: è quello dello stile Normale.
    expect(font.value).toBe("Calibri");
    expect((control("Dimensione carattere") as HTMLSelectElement).value).toBe("11");
    font.value = "Arial";
    font.dispatchEvent(new Event("change"));
    expect(last()).toEqual(["home.fontName", { name: "Arial" }]);
  });

  it("spunta la griglia nella scheda Visualizza", () => {
    tab("Visualizza").click();
    const gridlines = [...f.root.querySelectorAll<HTMLInputElement>('.grid-ribbon-panel[data-tab="view"] input[type=checkbox]')][0]!;
    expect(gridlines.checked).toBe(true);
    gridlines.click();
    expect(last()).toEqual(["view.gridlines", { on: false }]);
  });

  it("comincia la formula di una funzione scelta dal menu", async () => {
    f.queries["formulas.functions"] = [{ name: "IF", category: "Logical", signature: "IF(test, then, else)", description: "" }];
    tab("Formule").click();
    control("Logiche").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const item = menuItem("IF")!;
    expect(item.textContent).toContain("IF(test, then, else)");
    item.click();
    expect(f.written).toEqual(["IF("]);
  });

  it("dà un comando con le lettere di Excel", () => {
    key(f.root, "keydown", "Alt");
    key(f.root, "keyup", "Alt");
    expect([...f.root.querySelectorAll(".grid-ribbon-keytip")].map((el) => el.textContent)).toContain("H");
    key(document, "keydown", "h");
    expect([...f.root.querySelectorAll(".grid-ribbon-keytip")].map((el) => el.textContent)).toContain("FF");
    key(document, "keydown", "1");
    expect(last()).toEqual(["home.bold", {}]);
    expect(f.root.querySelectorAll(".grid-ribbon-keytip")).toHaveLength(0);
  });

  it("torna indietro con Esc e chiude le lettere", () => {
    key(f.root, "keydown", "Alt");
    key(f.root, "keyup", "Alt");
    key(document, "keydown", "w");
    expect(tab("Visualizza").getAttribute("aria-selected")).toBe("true");
    key(document, "keydown", "Escape");
    expect([...f.root.querySelectorAll(".grid-ribbon-keytip")].map((el) => el.textContent)).toContain("W");
    key(document, "keydown", "Escape");
    expect(f.root.querySelectorAll(".grid-ribbon-keytip")).toHaveLength(0);
  });

  it("si raccoglie e si riapre", () => {
    const toggle = f.root.querySelector<HTMLButtonElement>(".grid-ribbon-toggle")!;
    toggle.click();
    expect((f.root.querySelector(".grid-ribbon-panels") as HTMLElement).hidden).toBe(true);
    tab("Dati").click();
    expect((f.root.querySelector(".grid-ribbon-panels") as HTMLElement).hidden).toBe(false);
  });

  it("si muove con le frecce e torna alla griglia con Esc", () => {
    const toolbar = f.root.querySelector<HTMLElement>('.grid-ribbon-panel[data-tab="home"] [role=toolbar]')!;
    const first = toolbar.querySelector<HTMLElement>('[tabindex="0"]')!;
    first.focus();
    key(first, "keydown", "ArrowRight");
    expect(document.activeElement).not.toBe(first);
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
    key(document.activeElement!, "keydown", "Escape");
    expect(f.focused).toBe(1);
  });

  it("si smonta del tutto", () => {
    expect(iconEl("gr-sum")).not.toBeNull();
    ribbon.destroy();
    expect(f.root.querySelector(".grid-ribbon")).toBeNull();
    expect(iconEl("gr-sum")).toBeNull();
    ribbon = mountRibbon(f.engine);
  });
});
