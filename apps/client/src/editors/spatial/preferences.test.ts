// @vitest-environment happy-dom
//
// Il livello e la griglia del disegno, contro l'host finto: il livello è
// l'impostazione del vault che il bundle `fub.draw` dichiara, la griglia lo
// stato di vista che resta su questa macchina. Ogni caso riparte da moduli
// nuovi, perché `preferences.ts` ricorda l'ultima lettura.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../host/contract";
import type { FakeHost } from "../../host/fake";
import { DEFAULT_CURVE } from "../../ink/input/pressure";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
  };
});

const { createFakeHost } = await import("../../host/fake");

/// Un'altra impostazione, che il disegno non guarda.
const OTHER: SettingEntry = {
  spec: {
    key: "editor.line_numbers",
    label: "Numeri di riga",
    description: "",
    group: "Editor",
    scope: "machine",
    kind: { kind: "toggle", default: true },
    program_writable: false,
  },
  value: true,
  source: "default",
};

const GRID_KEY = "draw.grid";

/// Lascia finire ciò che è in coda: le risposte del finto sono promesse già
/// risolte, o frenate finché il banco non le libera.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/// Moduli nuovi sull'host `host`, col router del kernel acceso.
async function boot(host: FakeHost) {
  box.host = host;
  vi.resetModules();
  const preferences = await import("./preferences");
  const kernel = await import("../../state/kernel");
  const notices = await import("../../ui/notify");
  await kernel.startKernelRouter();
  return { ...preferences, ...notices };
}

/// Le domande delle impostazioni arrivate al finto.
function settingsReads(host: FakeHost): unknown[] {
  return host
    .atGate("queryIndex")
    .map((call) => call.args[0])
    .filter((query) => (query as { kind: string }).kind === "settings");
}

beforeEach(() => {
  box.host = null;
});

describe("le mie penne", () => {
  it("si leggono da draw.pens, si salvano in fila, e una chiave illeggibile non ne dà", async () => {
    const host = createFakeHost();
    const { currentSavedPens, readSavedPens, saveSavedPens } = await boot(host);
    expect(await readSavedPens(), "niente di ricordato").toEqual([]);
    const pen = { name: "Blu largo", pen: "brush", size: 12.5, color: "#0072b2", opacity: 0.8 } as const;
    saveSavedPens([pen]);
    expect(currentSavedPens()).toEqual([pen]);
    expect(await readSavedPens()).toEqual([pen]);
    expect(await host.module.api.viewState("draw.pens")).toEqual({ pens: [pen] });
    for (const broken of ["penne", { pens: "x" }, { pens: [{ name: "", pen: "brush", size: 1, color: "#000000", opacity: 1 }] }, { pens: [{ ...pen, pen: "piuma" }] }, { pens: [{ ...pen, size: 500 }] }]) {
      await host.module.api.setViewState("draw.pens", broken);
      expect(await readSavedPens(), JSON.stringify(broken)).toEqual([]);
    }
  });
});

describe("la griglia ricordata", () => {
  it("si legge dallo stato di vista, e ciò che non è una griglia vale quella di serie", async () => {
    const host = createFakeHost();
    const { currentGrid, readGrid } = await boot(host);
    const standard = { shown: false, snap: false, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE };
    expect(currentGrid()).toEqual(standard);
    expect(await readGrid(), "niente di ricordato").toEqual(standard);

    const chosen = { shown: true, snap: true, step: 50, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE };
    await host.module.api.setViewState(GRID_KEY, chosen);
    expect(await readGrid()).toEqual(chosen);
    expect(currentGrid()).toEqual(chosen);
    expect(host.atGate("viewState").map((call) => call.args)).toEqual([[GRID_KEY], [GRID_KEY]]);

    for (const broken of [
      "griglia",
      { shown: "sì", snap: true, step: 50 },
      { shown: true, snap: true, step: 0 },
      { shown: true, snap: true, step: 5000 },
      { shown: true, snap: true },
      { shown: true, snap: true, step: 50, steps: "mm" },
      { shown: true, snap: true, step: 50, panel: "sì" },
      { shown: true, snap: true, step: 50, bar: 1 },
      { shown: true, snap: true, step: 50, shapes: "sì" },
      { shown: true, snap: true, step: 50, closed: "look" },
      { shown: true, snap: true, step: 50, closed: [7] },
    ]) {
      await host.module.api.setViewState(GRID_KEY, broken);
      expect(await readGrid(), JSON.stringify(broken)).toEqual(standard);
    }
  });

  it("ricorda il pannello delle proprietà, la barra, le forme dal tratto e le sezioni chiuse", async () => {
    const host = createFakeHost();
    const { readGrid } = await boot(host);
    const chosen = { shown: false, snap: false, step: 20, steps: {}, panel: false, bar: false, shapes: false, closed: ["look", "look"], twist: true, taps: true, pen: DEFAULT_CURVE };
    await host.module.api.setViewState(GRID_KEY, chosen);
    expect(await readGrid()).toEqual({ ...chosen, closed: ["look"] });
  });

  it("una griglia ricordata con le sole scelte di base ha il resto di serie", async () => {
    const host = createFakeHost();
    const { readGrid } = await boot(host);
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10 });
    expect(await readGrid()).toEqual({ shown: true, snap: false, step: 10, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
  });

  it("una griglia ricordata con le guide e i righelli li lascia cadere, e dei passi delle unità tiene quelli buoni", async () => {
    const host = createFakeHost();
    const { readGrid } = await boot(host);
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10, guides: false });
    expect(await readGrid()).toEqual({ shown: true, snap: false, step: 10, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    const steps = { mm: 18.9, cm: 0, in: "24", pt: 5000, px: 40, km: 10 };
    await host.module.api.setViewState(GRID_KEY, { shown: false, snap: true, step: 20, steps, guides: true, rulers: true, rulerGuides: false });
    expect(await readGrid()).toEqual({ shown: false, snap: true, step: 20, steps: { mm: 18.9 }, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
  });

  it("lo stabilizzatore ricordato torna; uno che non si legge vale spento e non butta la griglia", async () => {
    const host = createFakeHost();
    const { readGrid } = await boot(host);
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10, steady: { amount: 0.5, string: true } });
    expect((await readGrid()).steady).toEqual({ amount: 0.5, string: true });
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10, steady: { amount: 3, string: true } });
    const grid = await readGrid();
    expect(grid.shown).toBe(true);
    expect("steady" in grid).toBe(false);
  });

  it("la gomma e la penna ricordate tornano; quelle che non si leggono valgono quelle di serie", async () => {
    const host = createFakeHost();
    const { readGrid } = await boot(host);
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10, eraser: "precise", penId: "fountain", barrel: "eraser", output: "path", fidelity: "low" });
    expect(await readGrid()).toMatchObject({ eraser: "precise", penId: "fountain", barrel: "eraser", output: "path", fidelity: "low" });
    // Il lazo se n'è andato (ADR 0231): il tasto laterale che lo faceva torna
    // al menu radiale.
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10, barrel: "lasso" });
    expect("barrel" in (await readGrid())).toBe(false);
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10, eraser: "half", penId: "quill", barrel: "jump", output: "svg", fidelity: 3 });
    const grid = await readGrid();
    expect(grid.shown).toBe(true);
    expect("eraser" in grid || "penId" in grid || "barrel" in grid || "output" in grid || "fidelity" in grid).toBe(false);
  });

  it("se lo stato di vista non si legge, resta l'ultima griglia", async () => {
    const host = createFakeHost();
    const { readGrid, saveGrid } = await boot(host);
    const chosen = { shown: true, snap: false, step: 10, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE };
    saveGrid(chosen);
    await settle();
    const heal = host.fault("viewState");
    expect(await readGrid()).toEqual(chosen);
    heal();
  });

  it("si ricorda nell'ordine delle scelte, e la lettura aspetta le scritture", async () => {
    const host = createFakeHost();
    const { currentGrid, readGrid, saveGrid } = await boot(host);
    const shown = { shown: true, snap: false, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE };
    const snapped = { shown: true, snap: true, step: 10, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE };

    const release = host.throttle("setViewState");
    saveGrid(shown);
    saveGrid(snapped);
    expect(currentGrid(), "la scelta vale subito").toEqual(snapped);
    const reading = readGrid();
    await settle();
    expect(host.atGate("viewState"), "la lettura aspetta").toHaveLength(0);

    release();
    expect(await reading).toEqual(snapped);
    expect(host.atGate("setViewState").map((call) => call.args)).toEqual([
      [GRID_KEY, shown],
      [GRID_KEY, snapped],
    ]);
    expect(await host.module.api.viewState(GRID_KEY)).toEqual(snapped);
  });

  it("una scelta fatta mentre si legge vale più di ciò che si legge", async () => {
    const host = createFakeHost();
    const { currentGrid, readGrid, saveGrid } = await boot(host);
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: true, step: 50, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });

    const release = host.throttle("viewState");
    const reading = readGrid();
    await settle();
    const chosen = { shown: false, snap: false, step: 5, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE };
    saveGrid(chosen);
    release();
    expect(await reading).toEqual(chosen);
    expect(currentGrid()).toEqual(chosen);
  });

  it("una scrittura che non riesce lo dice, e la fila va avanti", async () => {
    const host = createFakeHost();
    const { clearHistory, recentNotices, saveGrid } = await boot(host);
    clearHistory();

    const heal = host.fault("setViewState", "disco pieno");
    saveGrid({ shown: true, snap: false, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    await settle();
    expect(recentNotices().map(({ text, tone }) => ({ text, tone }))).toEqual([
      { text: "Non riesco a ricordare la griglia per i prossimi disegni: disco pieno", tone: "guasto" },
    ]);
    heal();

    const next = { shown: true, snap: true, step: 100, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE };
    saveGrid(next);
    await settle();
    expect(await host.module.api.viewState(GRID_KEY)).toEqual(next);
    expect(recentNotices()).toHaveLength(1);
  });
});

describe("i colori recenti ricordati", () => {
  const COLORS_KEY = "draw.colors";

  it("si leggono dallo stato di vista: codici minuscoli, una volta sola, al più otto", async () => {
    const host = createFakeHost();
    const { readRecentColors, recentColorsOf, RECENT_COLORS } = { ...(await boot(host)), ...(await import("./tools/palette")) };
    expect(await readRecentColors(), "niente di ricordato").toEqual([]);
    await host.module.api.setViewState(COLORS_KEY, { colors: ["#D55E00", "red", "#d55e00", 7, null, "#0072b2", "#fff", "#00723"] });
    expect(await readRecentColors()).toEqual(["#d55e00", "#0072b2"]);
    const many = Array.from({ length: 12 }, (_, at) => `#0000${at.toString(16).padStart(2, "0")}`);
    expect(RECENT_COLORS).toBe(8);
    expect(recentColorsOf({ colors: many })).toEqual(many.slice(0, 8));
    for (const broken of [null, "rotto", [], { colors: "#d55e00" }, { colori: ["#d55e00"] }]) {
      expect(recentColorsOf(broken), JSON.stringify(broken)).toEqual([]);
    }
    await host.module.api.setViewState(COLORS_KEY, "rotto");
    expect(await readRecentColors()).toEqual([]);
  });

  it("si ricordano nell'ordine delle scelte, la lettura le aspetta, e una scelta fatta mentre si legge vale di più", async () => {
    const host = createFakeHost();
    const { currentRecentColors, readRecentColors, saveRecentColors } = await boot(host);
    const release = host.throttle("setViewState");
    saveRecentColors(["#d55e00"]);
    saveRecentColors(["#0072b2", "#d55e00"]);
    expect(currentRecentColors(), "la scelta vale subito").toEqual(["#0072b2", "#d55e00"]);
    const reading = readRecentColors();
    await settle();
    expect(host.atGate("viewState"), "la lettura aspetta").toHaveLength(0);
    release();
    expect(await reading).toEqual(["#0072b2", "#d55e00"]);
    expect(host.atGate("setViewState").map((call) => call.args)).toEqual([
      [COLORS_KEY, { colors: ["#d55e00"] }],
      [COLORS_KEY, { colors: ["#0072b2", "#d55e00"] }],
    ]);

    const slow = host.throttle("viewState");
    const again = readRecentColors();
    await settle();
    saveRecentColors(["#009e73", "#0072b2", "#d55e00"]);
    slow();
    expect(await again).toEqual(["#009e73", "#0072b2", "#d55e00"]);
    expect(currentRecentColors()).toEqual(["#009e73", "#0072b2", "#d55e00"]);
  });

  it("una scrittura che non riesce non dice niente, e la fila va avanti; una lettura che non riesce lascia gli ultimi", async () => {
    const host = createFakeHost();
    const { clearHistory, readRecentColors, recentNotices, saveRecentColors } = await boot(host);
    clearHistory();
    const heal = host.fault("setViewState", "disco pieno");
    saveRecentColors(["#d55e00"]);
    await settle();
    expect(recentNotices()).toEqual([]);
    heal();
    saveRecentColors(["#0072b2", "#d55e00"]);
    await settle();
    expect(await host.module.api.viewState(COLORS_KEY)).toEqual({ colors: ["#0072b2", "#d55e00"] });
    const broken = host.fault("viewState");
    expect(await readRecentColors()).toEqual(["#0072b2", "#d55e00"]);
    broken();
  });
});

describe("le scelte di «Esporta» ricordate", () => {
  const EXPORT_KEY = "draw.export";
  const PLAIN = { paper: "fit", custom: [210, 297], orientation: "auto", margin: 10, fit: "shrink", bleed: 0, crop: false, registration: false } as const;
  const PRINTED = { paper: "a4", custom: [210, 297], orientation: "landscape", margin: 5, fit: "page", bleed: 3, crop: true, registration: true } as const;
  const PNG = { what: "boards", off: ["b2"], format: "png", size: { scale: 3 }, background: "paper", print: PLAIN } as const;
  const PDF = { what: "drawing", off: [], format: "pdf", size: { scale: 2 }, background: "none", print: PRINTED } as const;

  it("si ricordano per disegno, l'ultimo davanti", async () => {
    const host = createFakeHost();
    const { readExportMemory, saveExportMemory } = await boot(host);
    expect(await readExportMemory("a.svg")).toBeNull();
    await saveExportMemory("a.svg", PNG);
    await saveExportMemory("b.svg", PDF);
    expect(await readExportMemory("a.svg")).toEqual(PNG);
    expect(await readExportMemory("b.svg")).toEqual(PDF);
    await saveExportMemory("a.svg", PDF);
    expect(await host.module.api.viewState(EXPORT_KEY)).toEqual({
      drawings: [
        { doc: "a.svg", memory: PDF },
        { doc: "b.svg", memory: PDF },
      ],
    });
  });

  it("tiene gli ultimi cento disegni", async () => {
    const host = createFakeHost();
    const { EXPORT_MEMORIES, readExportMemory, saveExportMemory } = await boot(host);
    expect(EXPORT_MEMORIES).toBe(100);
    await host.module.api.setViewState(EXPORT_KEY, { drawings: Array.from({ length: 100 }, (_, index) => ({ doc: `${index}.svg`, memory: PNG })) });
    await saveExportMemory("nuovo.svg", PDF);
    const { drawings } = (await host.module.api.viewState(EXPORT_KEY)) as { drawings: { doc: string }[] };
    expect(drawings).toHaveLength(100);
    expect(drawings[0]!.doc).toBe("nuovo.svg");
    expect(await readExportMemory("99.svg"), "il più vecchio si dimentica").toBeNull();
    expect(await readExportMemory("98.svg")).toEqual(PNG);
  });

  it("ciò che non si legge come scelte non conta, e di un disegno conta il primo", async () => {
    const host = createFakeHost();
    const { readExportMemory, saveExportMemory } = await boot(host);
    await host.module.api.setViewState(EXPORT_KEY, {
      drawings: [null, { doc: "a.svg", memory: { ...PNG, format: "gif" } }, { doc: 7, memory: PNG }, { doc: "a.svg", memory: PDF }, { doc: "a.svg", memory: PNG }],
    });
    expect(await readExportMemory("a.svg")).toEqual(PDF);
    await host.module.api.setViewState(EXPORT_KEY, "rotto");
    expect(await readExportMemory("a.svg")).toBeNull();
    await saveExportMemory("b.svg", PNG);
    expect(await host.module.api.viewState(EXPORT_KEY)).toEqual({ drawings: [{ doc: "b.svg", memory: PNG }] });
  });

  it("la lettura aspetta le scritture; una che non riesce non dice niente, e la fila va avanti", async () => {
    const host = createFakeHost();
    const { clearHistory, readExportMemory, recentNotices, saveExportMemory } = await boot(host);
    clearHistory();
    const release = host.throttle("setViewState");
    const saving = saveExportMemory("a.svg", PNG);
    const reading = readExportMemory("a.svg");
    await settle();
    expect(host.atGate("viewState").filter((call) => call.args[0] === EXPORT_KEY), "letto soltanto dalla scrittura").toHaveLength(1);
    release();
    await saving;
    expect(await reading).toEqual(PNG);

    const heal = host.fault("setViewState", "disco pieno");
    await saveExportMemory("b.svg", PDF);
    heal();
    expect(recentNotices()).toEqual([]);
    await saveExportMemory("c.svg", PDF);
    expect(await readExportMemory("c.svg")).toEqual(PDF);

    const broken = host.fault("viewState");
    expect(await readExportMemory("c.svg"), "uno stato che non si legge").toBeNull();
    broken();
  });
});

describe("i suggerimenti ricordati", () => {
  const SUGGESTED_KEY = "draw.suggested";

  /// L'interruttore della macchina come lo dichiara `fub.draw`, col valore
  /// `value`.
  function suggestionsEntry(value: boolean): SettingEntry {
    return {
      spec: {
        key: "draw.suggestions",
        label: "Suggerimenti brevi",
        description: "",
        group: "Disegni",
        scope: "machine",
        kind: { kind: "toggle", default: true },
        program_writable: false,
      },
      value,
      source: value ? "default" : "machine",
    } as SettingEntry;
  }

  it("si leggono dall'impostazione e dallo stato di vista: nomi una volta sola, e senza impostazione accesi", async () => {
    const host = createFakeHost({ settings: [suggestionsEntry(false)] });
    const { currentSuggested, suggestedOf, watchSuggested } = await boot(host);
    expect(currentSuggested(), "prima di leggere").toBeNull();
    await host.module.api.setViewState(SUGGESTED_KEY, { seen: ["two-fingers", 7, "two-fingers", "domani"] });
    const applied: unknown[] = [];
    const stop = watchSuggested((suggested) => applied.push(suggested));
    await settle();
    expect(applied).toEqual([{ on: false, seen: ["two-fingers", "domani"] }]);
    expect(currentSuggested()).toEqual({ on: false, seen: ["two-fingers", "domani"] });
    stop();
    for (const broken of [null, "rotto", [], { seen: "two-fingers" }, { visti: ["two-fingers"] }]) {
      expect(suggestedOf(broken), JSON.stringify(broken)).toEqual([]);
    }

    const bare = await boot(createFakeHost({ settings: [OTHER] }));
    const fresh: unknown[] = [];
    bare.watchSuggested((suggested) => fresh.push(suggested));
    await settle();
    expect(fresh).toEqual([{ on: true, seen: [] }]);
  });

  it("uno stato di vista che non si legge, la prima volta, non dà memoria: i suggerimenti non tornerebbero a ogni disegno", async () => {
    const host = createFakeHost({ settings: [suggestionsEntry(true)] });
    const { watchSuggested } = await boot(host);
    const broken = host.fault("viewState");
    const applied: unknown[] = [];
    watchSuggested((suggested) => applied.push(suggested));
    await settle();
    expect(applied).toEqual([null]);
    broken();
  });

  it("segue l'interruttore, e ciò che un'altra superficie ha visto le arriva subito", async () => {
    const host = createFakeHost({ settings: [suggestionsEntry(true), OTHER] });
    const { saveSuggested, watchSuggested } = await boot(host);
    const one: unknown[] = [];
    const two: unknown[] = [];
    const stopOne = watchSuggested((suggested) => one.push(suggested));
    watchSuggested((suggested) => two.push(suggested));
    await settle();
    expect(one).toEqual([{ on: true, seen: [] }]);

    await host.module.api.setSetting("editor.line_numbers", false);
    await settle();
    expect(settingsReads(host), "un'altra impostazione non fa rileggere").toHaveLength(2);

    saveSuggested(["hold-shape"]);
    expect(one[one.length - 1]).toEqual({ on: true, seen: ["hold-shape"] });
    expect(two[two.length - 1]).toEqual({ on: true, seen: ["hold-shape"] });
    await settle();
    expect(await host.module.api.viewState(SUGGESTED_KEY)).toEqual({ seen: ["hold-shape"] });

    await host.module.api.setSetting("draw.suggestions", false);
    await settle();
    expect(one[one.length - 1]).toEqual({ on: false, seen: ["hold-shape"] });
    expect(two[two.length - 1]).toEqual({ on: false, seen: ["hold-shape"] });

    stopOne();
    const count = one.length;
    saveSuggested(["hold-shape", "label-shape"]);
    await host.module.api.setSetting("draw.suggestions", true);
    await settle();
    expect(one, "dopo stop").toHaveLength(count);
    expect(two[two.length - 1]).toEqual({ on: true, seen: ["hold-shape", "label-shape"] });
  });

  it("uno visto mentre si legge vale più di ciò che si è letto, e la lettura aspetta le scritture", async () => {
    const host = createFakeHost({ settings: [suggestionsEntry(true)] });
    const { saveSuggested, watchSuggested } = await boot(host);
    const applied: unknown[] = [];
    watchSuggested((suggested) => applied.push(suggested));
    await settle();

    const release = host.throttle("setViewState");
    saveSuggested(["two-fingers"]);
    await host.module.api.setSetting("draw.suggestions", true);
    await settle();
    expect(host.atGate("viewState"), "la lettura aspetta la scrittura").toHaveLength(1);
    release();
    await settle();
    expect(applied[applied.length - 1]).toEqual({ on: true, seen: ["two-fingers"] });

    const slow = host.throttle("viewState");
    await host.module.api.setSetting("draw.suggestions", true);
    await settle();
    saveSuggested(["two-fingers", "label-shape"]);
    slow();
    await settle();
    expect(applied[applied.length - 1]).toEqual({ on: true, seen: ["two-fingers", "label-shape"] });
  });

  it("la casella scrive l'interruttore; una scrittura che non riesce lo dice e torna com'era", async () => {
    const host = createFakeHost({ settings: [suggestionsEntry(true)] });
    const { currentSuggested, switchSuggestions, watchSuggested } = await boot(host);
    const applied: unknown[] = [];
    watchSuggested((suggested) => applied.push(suggested));
    await settle();

    switchSuggestions(false);
    expect(currentSuggested()).toEqual({ on: false, seen: [] });
    await settle();
    expect(host.atGate("setSetting").map((call) => call.args)).toEqual([["draw.suggestions", false]]);
    expect(applied[applied.length - 1]).toEqual({ on: false, seen: [] });

    // Un host che non la conosce rifiuta la scrittura.
    const bare = await boot(createFakeHost({ settings: [OTHER] }));
    bare.clearHistory();
    const back: unknown[] = [];
    bare.watchSuggested((suggested) => back.push(suggested));
    await settle();
    bare.switchSuggestions(false);
    expect(bare.currentSuggested()).toEqual({ on: false, seen: [] });
    await settle();
    expect(bare.recentNotices().map((notice) => notice.text)).toEqual([expect.stringMatching(/^Non riesco a cambiare i suggerimenti dei disegni: .+/)]);
    expect(back[back.length - 1], "la casella torna accesa").toEqual({ on: true, seen: [] });
    expect(bare.currentSuggested()).toEqual({ on: true, seen: [] });
  });
});

/// Una riga di `fub.draw` con la chiave `key`: scelta (`vault`) o di serie.
function drawEntry(key: string, value: unknown, chosen = true): SettingEntry {
  const list = Array.isArray(value);
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "Disegni",
      scope: "vault",
      kind: list
        ? { kind: "list", default: [] }
        : { kind: "choice", default: key === "draw.workspace" ? "full" : "essential", options: [{ value: String(value), label: String(value) }] },
      program_writable: false,
    },
    value,
    source: chosen ? "vault" : "default",
  } as SettingEntry;
}

describe("lo spazio di lavoro del disegno", () => {
  it("la chiave scelta vale; il livello di prima non si legge più", async () => {
    const { workspaceOf } = await boot(createFakeHost({ settings: [] }));
    // Niente scelto: Completo, colonna di serie.
    expect(workspaceOf([])).toEqual({ workspace: "full", toolbar: [] });
    // `draw.level` e `draw.custom` restano nel file, ma non contano più.
    expect(workspaceOf([drawEntry("draw.level", "essential"), drawEntry("draw.custom", ["pen"])])).toEqual({ workspace: "full", toolbar: [] });
    expect(workspaceOf([drawEntry("draw.workspace", "simple")])).toEqual({ workspace: "simple", toolbar: [] });
    // Uno strumento che non c'è, o non c'è più come il Testo, non conta.
    expect(workspaceOf([drawEntry("draw.workspace", "full"), drawEntry("draw.toolbar", ["select", "text", "domani"])])).toEqual({ workspace: "full", toolbar: ["select"] });
    // Uno spazio sconosciuto vale Completo.
    expect(workspaceOf([drawEntry("draw.workspace", "tablet")]).workspace).toBe("full");
  });

  it("una lettura superata da una più recente non arriva, né all'editor né alla memoria", async () => {
    const host = createFakeHost({ settings: [drawEntry("draw.workspace", "full", false)] });
    const { currentWorkspace, watchWorkspace } = await boot(host);
    const applied: string[] = [];
    watchWorkspace((choice) => applied.push(choice.workspace));
    await settle();

    // Due cambi, e le risposte tornano al contrario: prima la seconda.
    const first = host.throttle("queryIndex");
    await host.module.api.setSetting("draw.workspace", "simple");
    const second = host.throttle("queryIndex");
    await host.module.api.setSetting("draw.workspace", "full");
    second();
    await settle();
    first();
    await settle();

    expect(settingsReads(host)).toHaveLength(3);
    expect(applied).toEqual(["full", "full"]);
    expect(currentWorkspace().workspace).toBe("full");
  });

  it("se le impostazioni non si leggono, vale l'ultimo spazio letto", async () => {
    const host = createFakeHost({ settings: [drawEntry("draw.workspace", "simple")] });
    const { currentWorkspace, watchWorkspace } = await boot(host);
    const stop = watchWorkspace(() => {});
    await settle();
    stop();

    const heal = host.fault("queryIndex", "vault chiuso");
    const applied: string[] = [];
    watchWorkspace((choice) => applied.push(choice.workspace));
    await settle();
    heal();
    expect(applied).toEqual(["simple"]);
    expect(currentWorkspace().workspace).toBe("simple");
  });

  it("segue le due chiavi, e scrive le scelte dell'editor", async () => {
    const host = createFakeHost({
      settings: [drawEntry("draw.workspace", "simple"), drawEntry("draw.toolbar", [], false), OTHER],
    });
    const { currentWorkspace, saveToolbar, saveWorkspace, watchWorkspace } = await boot(host);
    const applied: unknown[] = [];
    const stop = watchWorkspace((choice) => applied.push(choice));
    await settle();
    expect(applied).toEqual([{ workspace: "simple", toolbar: [] }]);

    await host.module.api.setSetting("editor.line_numbers", false);
    await settle();
    expect(settingsReads(host), "un'altra impostazione non fa rileggere").toHaveLength(1);

    saveWorkspace("full");
    expect(currentWorkspace().workspace, "subito, per chi apre un altro disegno").toBe("full");
    await settle();
    saveToolbar(["select", "pen"]);
    await settle();
    expect(host.atGate("setSetting").map((call) => call.args).slice(1)).toEqual([
      ["draw.workspace", "full"],
      ["draw.toolbar", ["select", "pen"]],
    ]);
    expect(applied[applied.length - 1]).toEqual({ workspace: "full", toolbar: ["select", "pen"] });
    expect(host.atGate("resetSetting")).toEqual([]);

    stop();
    await host.module.api.setSetting("draw.workspace", "simple");
    await settle();
    expect(applied[applied.length - 1], "dopo stop").toEqual({ workspace: "full", toolbar: ["select", "pen"] });
  });

  it("una scrittura che non riesce lo dice", async () => {
    const host = createFakeHost({ settings: [drawEntry("draw.workspace", "full", false)] });
    const bare = await boot(host);
    host.fault("setSetting", "disco pieno");
    bare.saveWorkspace("simple");
    await settle();
    expect(bare.recentNotices().map((notice) => notice.text)).toEqual([expect.stringMatching(/disco pieno/)]);
  });
});
