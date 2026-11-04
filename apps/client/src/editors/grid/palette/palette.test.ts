// @vitest-environment happy-dom
// I comandi dei fogli nella tavolozza: le voci che la superficie dà, e il
// presidio di copertura, che ogni comando del catalogo si trovi da qualche
// parte (la barra, il tasto destro, una scorciatoia, la tavolozza).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GridCommandState } from "../../../host/contract";
import { closeContextMenu, type MenuItem } from "../../../ui/menu";
import { DIALOGS } from "../dialogs/catalog";
import { commandMenuItems, type CommandMenuHost } from "../menu-comandi";
import { contextEntries } from "../ribbon/context";
import { RIBBON_TABS, groupControls, type MenuEntry, type RibbonControl, type RibbonView } from "../ribbon/tabs";
import { shortcutCommand, shortcutDialog } from "../shortcuts";
import { CATALOG_COMMANDS, CATALOG_TABS, OWN_DIALOGS, mountGridPalette, type PaletteEngine } from "./commands";
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
    // Una scheda o un gruppo soltanto del menu non sono nella barra.
    expect(entries.find((entry) => entry.id === "fogli.pivot.list")!.description).toBe("Comando del foglio di calcolo");
    expect(entries.find((entry) => entry.id === "fogli.selection.set")!.description).toBe("Comando del foglio di calcolo");
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
    // Il perché del motore arriva in italiano (`motivi.ts`).
    expect(entries.find((entry) => entry.id === "fogli.edit.undo")!.unavailable).toBe("Non c'è niente da annullare.");
    expect(entries.find((entry) => entry.id === "fogli.edit.redo")!.unavailable).toBe("Adesso questo comando non si può usare.");
  });

  it("in sola lettura spegne soltanto i comandi che cambiano, con un motivo solo", () => {
    const entries = mountGridPalette(engineWith(ALL_ON, { writable: () => false })).commands();
    expect(entries.length).toBe(CATALOG_COMMANDS.length);
    const effect = new Map(CATALOG_COMMANDS.map((command) => [command.id, command.effetto]));
    for (const entry of entries) {
      if (effect.get(entry.id) === "cambia") expect(entry.unavailable, entry.id).toBe("La cartella è aperta in sola lettura.");
      else expect(entry.unavailable, entry.id).toBeNull();
    }
    expect(entries.some((entry) => effect.get(entry.id) === "legge")).toBe(true);
    expect(entries.some((entry) => effect.get(entry.id) === "mostra")).toBe(true);
  });

  it("in sola lettura un comando che legge, spento dal motore, dice il perché del motore", () => {
    const states = [{ id: "selection.stats", enabled: false, reason: "no workbook open" }];
    const entries = mountGridPalette(engineWith(states, { writable: () => false })).commands();
    expect(entries[0]!.unavailable).toBe("Non c'è una cartella aperta.");
  });

  it("dice al motore l'effetto di ogni comando e le finestre che in sola lettura si aprono", () => {
    let told: { effect: (id: string) => string | undefined; dialogs: string[] } | null = null;
    mountGridPalette(engineWith(ALL_ON, { setCommandEffects: (effect, dialogs) => (told = { effect, dialogs: [...dialogs] }) }));
    expect(told!.effect("home.bold")).toBe("cambia");
    expect(told!.effect("selection.stats")).toBe("legge");
    expect(told!.effect("edit.goTo")).toBe("mostra");
    expect(told!.dialogs).toEqual(expect.arrayContaining(["find", "goTo", "goToSpecial", "printPreview", "nameManager"]));
    expect(told!.dialogs).not.toContain("formatCells");
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

  it("un comando che legge apre la finestra del risultato, una sola, anche dalla barra", async () => {
    const engine = engineWith(ALL_ON, {
      run: async (id, params) => {
        engine.calls.push(`run ${id} ${params}`);
        return { ok: true, result: JSON.stringify({ count: 3, sum: 6 }) };
      },
    });
    const palette = mountGridPalette(engine);
    const entry = palette.commands().find((one) => one.id === "fogli.selection.stats")!;
    entry.run();
    expect(palette.give("selection.stats")).toBe(true);
    await vi.waitFor(() => expect(document.querySelector(".grid-result-table")).not.toBeNull());
    expect(document.querySelectorAll(".grid-result-dialog")).toHaveLength(1);
    expect(engine.calls).toEqual(["run selection.stats {}"]);
    palette.destroy();
    expect(document.querySelector(".grid-result-dialog")).toBeNull();
  });

  it("in sola lettura la barra non dà un comando che cambia, e uno che legge sì", async () => {
    const engine = engineWith(ALL_ON, { writable: () => false });
    const palette = mountGridPalette(engine);
    expect(palette.give("formulas.errorChecking")).toBe(true);
    expect(document.querySelector(".grid-result-dialog")).not.toBeNull();
    // Un comando che cambia passa al motore, che lo rifiuta da sé.
    palette.give("home.bold", "{}");
    expect(engine.calls).toContain("command home.bold {}");
    palette.destroy();
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

  it("ogni posto è una scheda e un gruppo del menu, e ogni scheda della barra ha il suo nome", () => {
    for (const command of CATALOG_COMMANDS) {
      const tab = CATALOG_TABS.find((candidate) => candidate.id === command.posto.scheda);
      expect(tab, `${command.motore}: la scheda ${command.posto.scheda} non c'è`).toBeDefined();
      expect(tab!.gruppi.some((group) => group.id === command.posto.gruppo), `${command.motore}: il gruppo ${command.posto.gruppo} non c'è`).toBe(true);
      expect(["cambia", "legge", "mostra"]).toContain(command.effetto);
    }
    for (const language of ["it", "en"]) {
      const table = fogliStrings.catalogFor(language);
      for (const tab of CATALOG_TABS.filter((candidate) => !candidate.solo)) {
        expect(table[`fogli.palette.tab.${tab.id}` as keyof typeof table], `${language}: la scheda ${tab.id}`).toBeTruthy();
      }
    }
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
  it("ogni comando del catalogo sta nel menu «Comandi», e ogni sua scheda e gruppo ha un nome", async () => {
    const engine = engineWith(ALL_ON);
    const host: CommandMenuHost = {
      engine: { ...engine, writeFormula: () => true },
      palette: () => mountGridPalette(engine).commands(),
      contextShown: () => false,
      cellStyleName: (name) => name,
    };
    const seen = new Set<string>();
    const walk = async (items: readonly MenuItem[]): Promise<void> => {
      for (const item of items) {
        if (!item.items) continue;
        await walk(typeof item.items === "function" ? await item.items() : item.items);
      }
    };
    const root = commandMenuItems(VIEW, host, document.createElement("button"), seen);
    await walk(root);
    closeContextMenu();
    const missing = CATALOG_COMMANDS.filter((command) => !seen.has(command.motore)).map((command) => command.motore);
    expect(missing, "comandi che il menu «Comandi» non ha").toEqual([]);
    for (const tab of root) {
      expect(tab.label.startsWith("fogli."), tab.label).toBe(false);
      for (const group of Array.isArray(tab.items) ? tab.items : []) expect(group.label.startsWith("fogli."), `${tab.label} › ${group.label}`).toBe(false);
    }
    for (const language of ["it", "en"]) {
      const table = fogliStrings.catalogFor(language);
      for (const tab of CATALOG_TABS) {
        const ribbon = RIBBON_TABS.find((candidate) => candidate.id === tab.id);
        if (!ribbon) expect(table[`fogli.menu.tab.${tab.id}` as keyof typeof table], `${language}: la scheda ${tab.id}`).toBeTruthy();
        for (const group of tab.gruppi) {
          if (ribbon?.groups.some((candidate) => candidate.id === group.id)) continue;
          if (!CATALOG_COMMANDS.some((command) => command.posto.scheda === tab.id && command.posto.gruppo === group.id)) continue;
          expect(table[`fogli.menu.group.${tab.id}.${group.id}` as keyof typeof table], `${language}: il gruppo ${tab.id}.${group.id}`).toBeTruthy();
        }
      }
    }
  });
});
