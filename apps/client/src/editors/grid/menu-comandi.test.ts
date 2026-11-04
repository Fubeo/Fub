// @vitest-environment happy-dom
// Il menu «Comandi» dei fogli: l'albero composto dalla barra e dal catalogo,
// le voci spente col loro perché, ciò che una voce dà, e il menu aperto, che
// cerca dappertutto e si rilegge senza chiudersi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridCommandState, GridTable } from "../../host/contract";
import { closeContextMenu, type MenuItem } from "../../ui/menu";
import { commandHint, commandMenuItems, openCommandMenu, type CommandMenuEngine, type CommandMenuHost } from "./menu-comandi";
import { CATALOG_COMMANDS, CATALOG_TABS, mountGridPalette } from "./palette/commands";
import type { RibbonView } from "./ribbon/tabs";

const VIEW: RibbonView = {
  style: undefined,
  sheet: { frozen_rows: 0, frozen_columns: 0, gridlines: true, headings: true, zoom: 100, right_to_left: false, mode: "normal", formulas: false, protected: false, print_gridlines: false, print_headings: false },
  book: { theme_colors: [], names: ["Totale"], calculation: "automatic", protected: false, font: "Calibri", font_size: 11 },
  table: null,
  object: null,
  theme: [],
  hidden: [],
  viewport: { width: 800, height: 600 },
  query: async () => null,
} as unknown as RibbonView;

const LONG = "Riepilogo_trimestrale_delle_spese_di_rappresentanza_2026";
const TABLE = { name: LONG, row: 0, column: 0, rows: 6, columns: 4, style: "TableStyleMedium2", header_row: true, total_row: false, banded_rows: true, banded_columns: false, first_column: false, last_column: false, filter_button: true } as unknown as GridTable;
const IN_TABLE = { ...VIEW, table: TABLE } as RibbonView;

const ALL_ON: GridCommandState[] = CATALOG_COMMANDS.map((command) => ({ id: command.motore, enabled: true, reason: null }));

interface Fake extends CommandMenuHost {
  readonly calls: string[];
  states: GridCommandState[];
  writable: boolean;
}

function fake(states: GridCommandState[] = ALL_ON): Fake {
  const calls: string[] = [];
  const self = { calls, states, writable: true } as Fake;
  const engine: CommandMenuEngine = {
    commands: () => self.states,
    writable: () => self.writable,
    command: (id, params) => {
      calls.push(`command ${id} ${params}`);
      return true;
    },
    openDialog: (id, params) => {
      calls.push(`dialog ${id} ${params}`);
      return true;
    },
    writeFormula: (text) => {
      calls.push(`write ${text}`);
      return true;
    },
  };
  const palette = mountGridPalette({
    ...engine,
    writable: () => self.writable,
    run: async () => ({ ok: true, result: null }),
    selectionRefs: () => ({ sheet: "Foglio1", range: "A1", active: "A1" }),
    sheetNames: () => ["Foglio1"],
    book: () => null,
    focus: () => {},
  });
  return Object.assign(self, {
    engine,
    palette: () => palette.commands(),
    contextShown: (context: string, view: RibbonView) => (context === "table" ? view.table !== null : false),
    cellStyleName: (name: string) => name,
    moreColors: (control: { id: string }) => {
      calls.push(`colors ${control.id}`);
    },
  });
}

let anchor: HTMLButtonElement;

beforeEach(() => {
  document.body.replaceChildren();
  anchor = document.createElement("button");
  anchor.id = "comandi";
  document.body.append(anchor);
});

afterEach(() => {
  closeContextMenu();
  vi.useRealTimers();
});

function at(items: readonly MenuItem[], ...path: string[]): MenuItem {
  let list = items;
  let found: MenuItem | undefined;
  for (const label of path) {
    found = list.find((item) => item.label === label);
    if (!found) throw new Error(`manca «${label}» fra ${list.map((item) => item.label).join(", ")}`);
    list = Array.isArray(found.items) ? found.items : [];
  }
  return found!;
}

const kids = (item: MenuItem): readonly MenuItem[] => (Array.isArray(item.items) ? item.items : []);
const labels = (items: readonly MenuItem[]): string[] => items.map((item) => item.label);

describe("l'albero del menu «Comandi»", () => {
  it("segue le schede del catalogo, e le contestuali stanno sotto «Per ciò che hai selezionato»", () => {
    const items = commandMenuItems(VIEW, fake(), anchor);
    expect(labels(items)).toEqual([
      "File",
      "Home",
      "Inserisci",
      "Disegna",
      "Layout di pagina",
      "Formule",
      "Dati",
      "Revisione",
      "Visualizza",
      "Struttura tabella",
      "Struttura grafico",
      "Formato",
      "Tabella pivot",
    ]);
    const contextual = items.filter((item) => item.group === "Per ciò che hai selezionato");
    expect(labels(contextual)).toEqual(["Struttura tabella", "Struttura grafico", "Formato", "Tabella pivot"]);
    expect(items.slice(0, 9).every((item) => item.group === undefined)).toBe(true);
  });

  it("in un gruppo vengono prima i controlli della barra, poi gli altri comandi del gruppo", () => {
    const font = kids(at(commandMenuItems(VIEW, fake(), anchor), "Home", "Carattere"));
    const more = font.filter((item) => item.group === "Altri comandi del gruppo");
    expect(labels(font).slice(0, 3)).toEqual(["Tipo di carattere", "Dimensione carattere", "Aumenta dimensione carattere"]);
    expect(labels(more)).toEqual(expect.arrayContaining(["Doppia sottolineatura", "Pedice", "Apice"]));
    expect(font.indexOf(more[0]!)).toBe(font.length - more.length);
    // Un gruppo che la barra non ha: soltanto i comandi del catalogo, nel suo ordine.
    const undo = kids(at(commandMenuItems(VIEW, fake(), anchor), "Home", "Annulla"));
    expect(labels(undo)).toEqual(["Ripeti", "Annulla"]);
    expect(undo[1]!.hint).toBe("Ctrl+Z");
  });

  it("le varianti di un controllo stanno nel suo sottomenu: scelte, colori, parte grande", () => {
    const items = commandMenuItems(VIEW, fake(), anchor);
    const size = at(items, "Home", "Carattere", "Dimensione carattere");
    expect(kids(size).every((item) => item.choice === "radio")).toBe(true);
    const bold = at(items, "Home", "Carattere", "Grassetto");
    expect(bold).toMatchObject({ choice: "checkbox", checked: false, hint: "Ctrl+B" });
    // La sottolineatura ha già le sue varianti: niente parte grande doppia.
    expect(labels(kids(at(items, "Home", "Carattere", "Sottolineato")))).toEqual(["Sottolineato", "Doppia sottolineatura"]);
    const fill = kids(at(items, "Home", "Carattere", "Colore riempimento"));
    expect(fill[0]!.label).toBe("Nessun riempimento");
    expect(fill.slice(1, 11).map((item) => item.swatches?.[0])).toHaveLength(10);
    expect(fill[fill.length - 1]!.label).toBe("Altri colori…");
    // Il formato contabile si dà con la sua parte grande, poi le valute.
    const accounting = kids(at(items, "Home", "Numeri", "Formato numeri contabilità"));
    expect(accounting[0]!.label).toBe("Formato numeri contabilità");
  });

  it("una voce dà ciò che dà la barra", () => {
    const host = fake();
    const items = commandMenuItems(VIEW, host, anchor);
    at(items, "Home", "Carattere", "Grassetto").run!();
    at(items, "Home", "Numeri", "Formato numeri contabilità", "Formato numeri contabilità").run!();
    kids(at(items, "Home", "Carattere", "Colore riempimento"))[2]!.run!();
    at(items, "Home", "Carattere", "Colore riempimento", "Altri colori…").run!();
    at(items, "Home", "Carattere", "Sottolineato", "Doppia sottolineatura").run!();
    expect(host.calls).toEqual([
      "command home.bold {}",
      "command home.accounting {}",
      'command home.fillColor {"color":"#FF0000"}',
      "colors home.fillColor",
      'command home.underline {"style":"double"}',
    ]);
  });

  it("un comando che la barra non ha si dà come lo dà la tavolozza", () => {
    const host = fake();
    at(commandMenuItems(VIEW, host, anchor), "Home", "Carattere", "Pedice").run!();
    expect(host.calls).toEqual(["command home.subscript {}"]);
  });

  it("senza il contesto i controlli della barra sono spenti col perché, i comandi in più no", () => {
    const off = at(commandMenuItems(VIEW, fake(), anchor), "Struttura tabella");
    expect(off.description).toBe("Con una tabella selezionata");
    const name = at(commandMenuItems(VIEW, fake(), anchor), "Struttura tabella", "Proprietà", "Nome tabella…");
    expect(name).toMatchObject({ disabled: true, description: "Seleziona una cella di una tabella." });
    const on = at(commandMenuItems(IN_TABLE, fake(), anchor), "Struttura tabella");
    expect(on.description).toBe(`Tabella «${LONG}»`);
    expect(at(commandMenuItems(IN_TABLE, fake(), anchor), "Struttura tabella", "Proprietà", "Nome tabella…").disabled).toBeUndefined();
  });

  it("in sola lettura si spengono soltanto i comandi che cambiano", () => {
    const host = fake();
    host.writable = false;
    const items = commandMenuItems(VIEW, host, anchor);
    expect(at(items, "Home", "Carattere", "Grassetto")).toMatchObject({ disabled: true, description: "La cartella è aperta in sola lettura." });
    // Il sottomenu spento per lo stesso perché in ogni voce è spento anche lui.
    expect(at(items, "Home", "Carattere")).toMatchObject({ disabled: true, description: "La cartella è aperta in sola lettura." });
    const looking = CATALOG_COMMANDS.find((command) => command.effetto !== "cambia" && command.posto.scheda === "formulas")!;
    const seen = new Set<string>();
    commandMenuItems(VIEW, host, anchor, seen);
    expect(seen.has(looking.motore)).toBe(true);
    expect(at(items, "Formule").disabled).toBeUndefined();
  });

  it("la ragione del motore è la descrizione della voce spenta", () => {
    const states = ALL_ON.map((state) => (state.id === "edit.redo" ? { ...state, enabled: false, reason: "Non c'è niente da ripetere." } : state));
    const undo = kids(at(commandMenuItems(VIEW, fake(states), anchor), "Home", "Annulla"));
    expect(undo[0]).toMatchObject({ disabled: true, description: "Non c'è niente da ripetere." });
    expect(undo[1]!.disabled).toBeUndefined();
  });

  it("un comando che il catalogo non serve non c'è, e senza comandi non c'è niente", () => {
    const states = ALL_ON.filter((state) => state.id !== "home.subscript");
    expect(labels(kids(at(commandMenuItems(VIEW, fake(states), anchor), "Home", "Carattere")))).not.toContain("Pedice");
    expect(commandMenuItems(VIEW, fake([]), anchor)).toEqual([]);
  });

  it("ogni gruppo del catalogo con dei comandi ha un nome", () => {
    const items = commandMenuItems(IN_TABLE, fake(), anchor);
    for (const item of items) {
      for (const group of kids(item)) expect(group.label.startsWith("fogli."), `${item.label} › ${group.label}`).toBe(false);
    }
    expect(items).toHaveLength(CATALOG_TABS.length);
  });

  it("la scorciatoia viene da quelle che la griglia legge", () => {
    expect(commandHint("home.italic")).toBe("Ctrl+I");
    expect(commandHint("home.strikethrough")).toBe("Ctrl+5");
    expect(commandHint("home.numberFormat")).toBeUndefined();
  });
});

describe("il menu «Comandi» aperto", () => {
  const key = (name: string): void => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  };
  const type = (text: string): void => {
    for (const ch of text) key(ch);
  };
  const rows = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>("#context-menu .menu-items [role^=menuitem]")];
  const open = (host: CommandMenuHost, view = VIEW, closed = () => {}) => openCommandMenu(anchor, view, { pointer: false, closed }, host);

  it("ha il suo nome, e i ruoli dei menu", () => {
    open(fake());
    const menu = document.getElementById("context-menu")!;
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-label")).toBe("Tutti i comandi del foglio");
    expect(rows()[0]!.getAttribute("aria-haspopup")).toBe("menu");
    expect(menu.querySelector("[role=group]")!.getAttribute("aria-label")).toBe("Per ciò che hai selezionato");
  });

  it("cerca in profondità senza tetto: le accese prima, le spente dopo col perché, il piede le conta", async () => {
    vi.useFakeTimers();
    open(fake());
    type("a");
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(200));
    const foot = document.querySelector("#context-menu .menu-foot")!.textContent!;
    expect(foot).toContain(`${rows().length} voci`);
    const states = rows().map((row) => row.getAttribute("aria-disabled") === "true");
    expect(states.indexOf(true)).toBeGreaterThan(0);
    expect(states.slice(states.indexOf(true)).every(Boolean)).toBe(true);
    const off = rows().find((row) => row.getAttribute("aria-disabled") === "true")!;
    expect(off.querySelector(".menu-description")!.textContent).toBe("Seleziona una cella di una tabella.");
    // Più di duecento righe vere: da solo ci mette un secondo e mezzo, sotto
    // il carico di tutta la suite può superare i 5 s di serie.
  }, 15_000);

  it("lo stesso nome in due posti si distingue dal percorso", async () => {
    vi.useFakeTimers();
    open(fake());
    type("annulla");
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const paths = rows()
      .filter((row) => row.querySelector(".menu-label")!.textContent === "Annulla")
      .map((row) => row.querySelector(".menu-path")?.textContent);
    expect(paths).toContain("Home › Annulla ›");
  });

  it("senza risultati dice che non c'è niente", () => {
    vi.useFakeTimers();
    open(fake());
    type("zzqx");
    expect(rows()).toHaveLength(0);
    expect(document.querySelector("#context-menu .menu-empty")!.textContent).toBe("Niente qui");
  });

  it("un comando che si accende col menu aperto si accende nel menu", () => {
    const states = ALL_ON.map((state) => (state.id === "edit.redo" ? { ...state, enabled: false, reason: "Non c'è niente da ripetere." } : state));
    const host = fake(states);
    const session = open(host);
    type("ripeti");
    const before = rows().find((row) => row.querySelector(".menu-label")!.textContent === "Ripeti")!;
    expect(before.getAttribute("aria-disabled")).toBe("true");
    host.states = ALL_ON;
    session.update(VIEW);
    const after = rows().find((row) => row.querySelector(".menu-label")!.textContent === "Ripeti")!;
    expect(after.getAttribute("aria-disabled")).toBeNull();
  });

  it("la cartella che si chiude col menu aperto lo lascia rileggere senza voci", () => {
    const host = fake();
    const closed = vi.fn();
    const session = open(host, VIEW, closed);
    host.states = [];
    expect(() => session.update(VIEW)).not.toThrow();
    closeContextMenu();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(() => session.update(VIEW)).not.toThrow();
  });
});
