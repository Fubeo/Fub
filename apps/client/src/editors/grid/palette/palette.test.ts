// @vitest-environment happy-dom
// I comandi dei fogli nella tavolozza: le voci che la superficie dà, e il
// presidio di copertura, che ogni comando del catalogo si trovi da qualche
// parte (la barra, il tasto destro, una scorciatoia, la tavolozza).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GridCommandState } from "../../../host/contract";
import { DIALOGS } from "../dialogs/catalog";
import { contextEntries } from "../ribbon/context";
import { RIBBON_TABS, groupControls, type MenuEntry, type RibbonControl, type RibbonView } from "../ribbon/tabs";
import { shortcutCommand, shortcutDialog } from "../shortcuts";
import { CATALOG_COMMANDS, OWN_DIALOGS, mountGridPalette, type PaletteEngine } from "./commands";
import { fogliStrings } from "./strings";

const VIEW: RibbonView = {
  style: undefined,
  sheet: { frozen_rows: 0, frozen_columns: 0, gridlines: true, headings: true, zoom: 100, right_to_left: false, mode: "normal", formulas: false, protected: false, print_gridlines: false, print_headings: false },
  book: { theme_colors: [], names: ["Totale"], calculation: "automatic", protected: false, font: "Calibri", font_size: 11 },
  table: null,
  object: null,
  theme: [],
  hidden: [{ id: "s2", name: "Nascosto" }],
  viewport: { width: 800, height: 600 },
  query: async () => null,
} as unknown as RibbonView;

function flat(entries: readonly MenuEntry[]): MenuEntry[] {
  return entries.flatMap((entry) => {
    const inner = entry.submenu?.();
    return [entry, ...(inner && !(inner instanceof Promise) ? flat(inner) : [])];
  });
}

/// Per ogni comando, le finestre con cui la barra e il tasto destro lo
/// aprono, e se ci compare.
function ribbonAndMenus(): { ribbon: Set<string>; context: Set<string>; dialogs: Map<string, Set<string>> } {
  const ribbon = new Set<string>();
  const context = new Set<string>();
  const dialogs = new Map<string, Set<string>>();
  const note = (id: string | undefined, dialog: unknown, into: Set<string>): void => {
    if (!id) return;
    into.add(id);
    if (typeof dialog === "string") {
      const known = dialogs.get(id) ?? new Set<string>();
      known.add(dialog);
      dialogs.set(id, known);
    }
  };
  for (const tab of RIBBON_TABS) {
    for (const group of tab.groups) {
      for (const control of groupControls(group) as RibbonControl[]) {
        const any = control as unknown as { id?: string; dialog?: unknown; kind: string; menu?: (v: RibbonView) => unknown; items?: (v: RibbonView) => unknown };
        note(any.id, typeof any.dialog === "function" ? (any.dialog as (v: RibbonView) => string)(VIEW) : any.dialog, ribbon);
        const items = any.kind === "split" ? any.menu?.(VIEW) : any.kind === "menu" ? any.items?.(VIEW) : [];
        if (Array.isArray(items)) for (const entry of flat(items as MenuEntry[])) note(entry.id, entry.dialog, ribbon);
      }
    }
  }
  const views = [VIEW, { ...VIEW, object: { kind: "chart", id: "c1" } } as unknown as RibbonView];
  for (const target of ["cell", "row", "column", "corner", "sheet", "object"] as const) {
    for (const view of views) {
      let entries: readonly MenuEntry[] = [];
      try {
        entries = contextEntries(target, view);
      } catch {
        entries = [];
      }
      for (const entry of flat(entries)) note(entry.id, entry.dialog, context);
    }
  }
  return { ribbon, context, dialogs };
}

/// I comandi e le finestre che le scorciatoie danno, provando i tasti.
function shortcuts(): { commands: Set<string>; dialogs: Set<string> } {
  const commands = new Set<string>();
  const dialogs = new Set<string>();
  const codes = [
    ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
    ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
    ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
    "Equal", "Minus", "NumpadAdd", "NumpadSubtract", "Semicolon", "Quote", "Backquote", "Space", "Period", "Comma", "Slash",
    "Backslash", "BracketLeft", "BracketRight", "PageUp", "PageDown", "Home", "End", "Delete", "Backspace", "Enter", "Tab",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  ];
  const contexts = [
    { wholeRows: false, wholeColumns: false, currency: "€" },
    { wholeRows: true, wholeColumns: false, currency: "€" },
    { wholeRows: false, wholeColumns: true, currency: "€" },
  ];
  for (const code of codes) {
    for (let mask = 0; mask < 8; mask++) {
      const event = new KeyboardEvent("keydown", { code, ctrlKey: (mask & 1) !== 0, shiftKey: (mask & 2) !== 0, altKey: (mask & 4) !== 0 });
      for (const context of contexts) {
        const command = shortcutCommand(event, context);
        if (command) commands.add(command.id);
        const dialog = shortcutDialog(event, context);
        if (dialog) dialogs.add(dialog.dialog);
      }
    }
  }
  return { commands, dialogs };
}

function engineWith(states: GridCommandState[], overrides: Partial<PaletteEngine> = {}): PaletteEngine & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    commands: () => states,
    writable: () => true,
    command: (id, params) => {
      calls.push(`command ${id} ${params}`);
      return true;
    },
    run: async (id, params) => {
      calls.push(`run ${id} ${params}`);
      return { ok: true, result: null };
    },
    openDialog: (id, params) => {
      calls.push(`dialog ${id} ${params}`);
      return true;
    },
    selectionRefs: () => ({ sheet: "Foglio1", range: "B2:C4", active: "B2" }),
    sheetNames: () => ["Foglio1", "Foglio2"],
    book: () => null,
    focus: () => {},
    ...overrides,
  };
}

const ALL_ON: GridCommandState[] = CATALOG_COMMANDS.map((command) => ({ id: command.motore, enabled: true, reason: null }));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("le voci dei fogli nella tavolozza", () => {
  it("dà ogni comando servito, col titolo tradotto e il gruppo «Foglio»", () => {
    const palette = mountGridPalette(engineWith(ALL_ON));
    const entries = palette.commands();
    expect(entries).toHaveLength(CATALOG_COMMANDS.length);
    const bold = entries.find((entry) => entry.id === "fogli.home.bold")!;
    expect(bold).toMatchObject({ title: "Grassetto", group: "Foglio", description: "Scheda Home della barra", unavailable: null });
    expect(entries.find((entry) => entry.id === "fogli.cell.get")!.description).toBe("Comando del foglio di calcolo");
    palette.destroy();
  });

  it("parla inglese quando l'interfaccia lo parla", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
    const entries = mountGridPalette(engineWith(ALL_ON)).commands();
    expect(entries.find((entry) => entry.id === "fogli.home.bold")).toMatchObject({ title: "Bold", group: "Sheet" });
    expect(entries.find((entry) => entry.id === "fogli.view.zoom100")!.title).toBe("Zoom to 100%");
  });

  it("tiene un comando spento, col motivo del motore o uno suo", () => {
    const states = [
      { id: "edit.undo", enabled: false, reason: "nothing to undo" },
      { id: "edit.redo", enabled: false, reason: null },
      { id: "home.bold", enabled: true, reason: null },
    ];
    const entries = mountGridPalette(engineWith(states)).commands();
    expect(entries.map((entry) => entry.id)).toEqual(["fogli.edit.redo", "fogli.edit.undo", "fogli.home.bold"]);
    expect(entries.find((entry) => entry.id === "fogli.edit.undo")!.unavailable).toBe("nothing to undo");
    expect(entries.find((entry) => entry.id === "fogli.edit.redo")!.unavailable).toBe("Adesso questo comando non si può usare.");
  });

  it("in sola lettura li dà tutti spenti, con un motivo solo", () => {
    const entries = mountGridPalette(engineWith(ALL_ON, { writable: () => false })).commands();
    expect(entries.length).toBe(CATALOG_COMMANDS.length);
    expect(new Set(entries.map((entry) => entry.unavailable))).toEqual(new Set(["La cartella è aperta in sola lettura."]));
  });

  it("senza una cartella che serve i comandi non dà niente", () => {
    expect(mountGridPalette(engineWith([])).commands()).toEqual([]);
    const palette = mountGridPalette(engineWith(ALL_ON));
    palette.destroy();
    expect(palette.commands()).toEqual([]);
  });

  it("lascia fuori un comando che il catalogo non conosce", () => {
    const entries = mountGridPalette(engineWith([{ id: "nuovo.comando", enabled: true, reason: null }])).commands();
    expect(entries).toEqual([]);
  });

  it("apre la finestra scritta a mano, come la barra", () => {
    const engine = engineWith(ALL_ON);
    const entries = mountGridPalette(engine).commands();
    entries.find((entry) => entry.id === "fogli.home.formatCells")!.run();
    entries.find((entry) => entry.id === "fogli.edit.replace")!.run();
    entries.find((entry) => entry.id === "fogli.review.protectWorkbook")!.run();
    expect(engine.calls).toEqual(["dialog formatCells {}", "dialog find {\"replace\":true}", "dialog protectWorkbook {}"]);
  });

  it("dà subito sulla selezione un comando senza parametri obbligatori", () => {
    const engine = engineWith(ALL_ON);
    mountGridPalette(engine).commands().find((entry) => entry.id === "fogli.home.bold")!.run();
    expect(engine.calls).toEqual(["command home.bold {}"]);
    expect(document.querySelector(".grid-command-dialog")).toBeNull();
  });

  it("apre la finestra costruita per un comando che chiede un parametro", () => {
    const engine = engineWith(ALL_ON);
    const palette = mountGridPalette(engine);
    palette.commands().find((entry) => entry.id === "fogli.sheet.tabColor")!.run();
    expect(palette.current()).not.toBeNull();
    expect(palette.current()!.querySelector(".kit-dialog-title")!.textContent).toBe("Colore scheda");
    palette.destroy();
    expect(document.querySelector(".grid-command-dialog")).toBeNull();
  });
});

describe("la copertura dei comandi del catalogo", () => {
  it("le finestre scritte a mano sono quelle che apre la barra", () => {
    const { dialogs } = ribbonAndMenus();
    for (const [id, own] of Object.entries(OWN_DIALOGS)) {
      const name = typeof own === "function" ? own(engineWith(ALL_ON)) : typeof own === "string" ? own : own[0];
      expect(DIALOGS[name], `${id}: la finestra ${name} non c'è`).toBeDefined();
      expect(CATALOG_COMMANDS.some((command) => command.motore === id), `${id} non è nel catalogo`).toBe(true);
    }
    for (const [id, names] of dialogs) {
      if (!CATALOG_COMMANDS.some((command) => command.motore === id)) continue;
      const own = OWN_DIALOGS[id];
      expect(own, `${id} apre ${[...names].join(", ")} dalla barra ma non dalla tavolozza`).toBeDefined();
    }
  });

  it("ogni comando si trova nella barra, nel tasto destro, in una scorciatoia o nella tavolozza", () => {
    const { ribbon, context } = ribbonAndMenus();
    const keys = shortcuts();
    const byDialog = new Map<string, string[]>();
    for (const [id, own] of Object.entries(OWN_DIALOGS)) {
      const name = typeof own === "function" ? own(engineWith(ALL_ON)) : typeof own === "string" ? own : own[0];
      byDialog.set(name, [...(byDialog.get(name) ?? []), id]);
    }
    const viaKeys = new Set([...keys.commands, ...[...keys.dialogs].flatMap((name) => byDialog.get(name) ?? [])]);
    const inPalette = new Set(mountGridPalette(engineWith(ALL_ON)).commands().map((entry) => entry.id));
    const onlyPalette: string[] = [];
    for (const command of CATALOG_COMMANDS) {
      const elsewhere = ribbon.has(command.motore) || context.has(command.motore) || viaKeys.has(command.motore);
      expect(elsewhere || inPalette.has(command.id), `${command.motore} non si trova da nessuna parte`).toBe(true);
      if (!elsewhere) onlyPalette.push(command.motore);
    }
    console.info(`Comandi dei fogli: ${CATALOG_COMMANDS.length}, di cui ${onlyPalette.length} solo nella tavolozza.`);
    expect(onlyPalette.length).toBeGreaterThan(0);
  });

  it("ogni titolo e ogni campo hanno un testo in ogni lingua", () => {
    for (const language of ["it", "en"]) {
      const table = fogliStrings.catalogFor(language);
      for (const command of CATALOG_COMMANDS) {
        expect(table[command.titolo]?.trim(), `${command.titolo} in ${language}`).toBeTruthy();
        for (const field of command.campi) expect(table[`fogli.campo.${field.nome}`]?.trim(), `campo ${field.nome} in ${language}`).toBeTruthy();
      }
    }
  });
});

