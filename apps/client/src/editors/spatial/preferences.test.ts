// @vitest-environment happy-dom
//
// Il livello e la griglia del disegno, contro l'host finto: il livello è
// l'impostazione del vault che il bundle `fub.draw` dichiara, la griglia lo
// stato di vista che resta su questa macchina. Ogni caso riparte da moduli
// nuovi, perché `preferences.ts` ricorda l'ultima lettura.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../host/contract";
import type { FakeHost } from "../../host/fake";
import { DEFAULT_CURVE } from "./pen/pressure";

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

/// La riga del livello come la dichiara `fub.draw`, col valore `value`.
function levelEntry(value: string): SettingEntry {
  return {
    spec: {
      key: "draw.level",
      label: "Livello d'interfaccia",
      description: "",
      group: "Disegni",
      scope: "vault",
      kind: {
        kind: "choice",
        default: "essential",
        options: [
          { value: "essential", label: "Essenziale" },
          { value: "standard", label: "Standard" },
        ],
      },
      program_writable: false,
    },
    value,
    source: value === "essential" ? "default" : "vault",
  };
}

/// La riga delle parti del Personalizzato, col valore `value`.
function customEntry(value: unknown): SettingEntry {
  return {
    spec: {
      key: "draw.custom",
      label: "Parti del Personalizzato",
      description: "",
      group: "Disegni",
      scope: "vault",
      kind: { kind: "list", default: ["pen", "eraser", "rect", "ellipse", "line", "arrow"] },
      program_writable: false,
    },
    value,
    source: "vault",
  } as SettingEntry;
}

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

describe("il livello del disegno", () => {
  it("si legge dalle impostazioni del bundle fub.draw, e un valore sconosciuto vale l'Essenziale", async () => {
    const host = createFakeHost({ settings: [levelEntry("standard")] });
    const { currentLevel, watchLevel } = await boot(host);
    expect(currentLevel(), "prima di leggere").toBe("essential");

    const applied: string[] = [];
    const stop = watchLevel((level) => applied.push(level));
    await settle();
    expect(applied).toEqual(["standard"]);
    expect(currentLevel()).toBe("standard");
    expect(settingsReads(host)).toEqual([{ kind: "settings", plugin: "fub.draw" }]);
    stop();

    for (const settings of [[levelEntry("beginner")], [OTHER]]) {
      const other = createFakeHost({ settings });
      const fresh = await boot(other);
      const seen: string[] = [];
      fresh.watchLevel((level) => seen.push(level));
      await settle();
      expect(seen, JSON.stringify(settings.map((e) => e.value))).toEqual(["essential"]);
    }
  });

  it("segue i cambi del livello, e solo quelli, finché non si smette", async () => {
    const host = createFakeHost({ settings: [levelEntry("essential"), OTHER] });
    const { watchLevel } = await boot(host);
    const applied: string[] = [];
    const stop = watchLevel((level) => applied.push(level));
    await settle();
    expect(applied).toEqual(["essential"]);

    await host.module.api.setSetting("editor.line_numbers", false);
    await settle();
    expect(settingsReads(host), "un'altra impostazione non fa rileggere").toHaveLength(1);

    await host.module.api.setSetting("draw.level", "standard");
    await settle();
    expect(applied).toEqual(["essential", "standard"]);

    stop();
    await host.module.api.setSetting("draw.level", "essential");
    await settle();
    expect(applied, "dopo stop").toEqual(["essential", "standard"]);
    expect(settingsReads(host)).toHaveLength(2);
  });

  it("una lettura superata da una più recente non arriva, né all'editor né alla memoria", async () => {
    const host = createFakeHost({ settings: [levelEntry("essential")] });
    const { currentLevel, watchLevel } = await boot(host);
    const applied: string[] = [];
    watchLevel((level) => applied.push(level));
    await settle();

    // Due cambi, e le risposte tornano al contrario: prima la seconda.
    const first = host.throttle("queryIndex");
    await host.module.api.setSetting("draw.level", "standard");
    const second = host.throttle("queryIndex");
    await host.module.api.setSetting("draw.level", "essential");
    second();
    await settle();
    first();
    await settle();

    expect(settingsReads(host)).toHaveLength(3);
    expect(applied).toEqual(["essential", "essential"]);
    expect(currentLevel()).toBe("essential");
  });

  it("le parti del Personalizzato si leggono col livello, e un loro cambio fa rileggere", async () => {
    const host = createFakeHost({ settings: [levelEntry("custom"), customEntry(["pen", "layers", 7, "domani"])] });
    const { currentCustom, currentLevel, watchLevel } = await boot(host);
    expect(currentCustom(), "prima di leggere").toEqual(["pen", "eraser", "rect", "ellipse", "line", "arrow"]);

    const applied: [string, readonly string[]][] = [];
    const stop = watchLevel((level, custom) => applied.push([level, custom]));
    await settle();
    // Ciò che non è un nome cade; un nome sconosciuto resta, per chi lo conosce.
    expect(applied).toEqual([["custom", ["pen", "layers", "domani"]]]);
    expect(currentLevel()).toBe("custom");
    expect(currentCustom()).toEqual(["pen", "layers", "domani"]);
    expect(settingsReads(host), "una lettura per le due impostazioni").toHaveLength(1);

    await host.module.api.setSetting("draw.custom", ["text"]);
    await settle();
    expect(applied[applied.length - 1]).toEqual(["custom", ["text"]]);
    expect(currentCustom()).toEqual(["text"]);
    expect(settingsReads(host)).toHaveLength(2);

    // Senza la riga, o con un valore che non è un elenco, valgono le parti dell'Essenziale.
    for (const settings of [[levelEntry("custom")], [levelEntry("custom"), customEntry("pen")]]) {
      const other = createFakeHost({ settings });
      const fresh = await boot(other);
      const seen: (readonly string[])[] = [];
      fresh.watchLevel((_level, custom) => seen.push(custom));
      await settle();
      expect(seen, JSON.stringify(settings.map((e) => e.value))).toEqual([["pen", "eraser", "rect", "ellipse", "line", "arrow"]]);
    }
    stop();
  });

  it("se le impostazioni non si leggono, vale l'ultimo livello letto", async () => {
    const host = createFakeHost({ settings: [levelEntry("standard")] });
    const { currentLevel, watchLevel } = await boot(host);
    const stop = watchLevel(() => {});
    await settle();
    stop();

    const heal = host.fault("queryIndex", "vault chiuso");
    const applied: [string, readonly string[]][] = [];
    watchLevel((level, custom) => applied.push([level, custom]));
    await settle();
    heal();
    expect(applied).toEqual([["standard", ["pen", "eraser", "rect", "ellipse", "line", "arrow"]]]);
    expect(currentLevel()).toBe("standard");
  });
});

describe("la griglia ricordata", () => {
  it("si legge dallo stato di vista, e ciò che non è una griglia vale quella di serie", async () => {
    const host = createFakeHost();
    const { currentGrid, readGrid } = await boot(host);
    const standard = { shown: false, snap: false, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE };
    expect(currentGrid()).toEqual(standard);
    expect(await readGrid(), "niente di ricordato").toEqual(standard);

    const chosen = { shown: true, snap: true, step: 50, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE };
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
      { shown: true, snap: true, step: 50, guides: "sì" },
      { shown: true, snap: true, step: 50, rulers: 1 },
      { shown: true, snap: true, step: 50, rulerGuides: null },
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
    const chosen = { shown: false, snap: false, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: false, bar: false, shapes: false, closed: ["look", "look"], twist: true, taps: true, pen: DEFAULT_CURVE };
    await host.module.api.setViewState(GRID_KEY, chosen);
    expect(await readGrid()).toEqual({ ...chosen, closed: ["look"] });
  });

  it("una griglia ricordata prima delle guide intelligenti le ha accese", async () => {
    const host = createFakeHost();
    const { readGrid } = await boot(host);
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10 });
    expect(await readGrid()).toEqual({ shown: true, snap: false, step: 10, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
  });

  it("una griglia ricordata prima dei righelli li ha spenti, e dei passi delle unità tiene quelli buoni", async () => {
    const host = createFakeHost();
    const { readGrid } = await boot(host);
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10, guides: false });
    expect(await readGrid()).toEqual({ shown: true, snap: false, step: 10, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
    const steps = { mm: 18.9, cm: 0, in: "24", pt: 5000, px: 40, km: 10 };
    await host.module.api.setViewState(GRID_KEY, { shown: false, snap: true, step: 20, steps, guides: true, rulers: true, rulerGuides: false });
    expect(await readGrid()).toEqual({ shown: false, snap: true, step: 20, steps: { mm: 18.9 }, guides: true, rulers: true, rulerGuides: false, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
  });

  it("se lo stato di vista non si legge, resta l'ultima griglia", async () => {
    const host = createFakeHost();
    const { readGrid, saveGrid } = await boot(host);
    const chosen = { shown: true, snap: false, step: 10, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE };
    saveGrid(chosen);
    await settle();
    const heal = host.fault("viewState");
    expect(await readGrid()).toEqual(chosen);
    heal();
  });

  it("si ricorda nell'ordine delle scelte, e la lettura aspetta le scritture", async () => {
    const host = createFakeHost();
    const { currentGrid, readGrid, saveGrid } = await boot(host);
    const shown = { shown: true, snap: false, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE };
    const snapped = { shown: true, snap: true, step: 10, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE };

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
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: true, step: 50, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });

    const release = host.throttle("viewState");
    const reading = readGrid();
    await settle();
    const chosen = { shown: false, snap: false, step: 5, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE };
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
    saveGrid({ shown: true, snap: false, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
    await settle();
    expect(recentNotices().map(({ text, tone }) => ({ text, tone }))).toEqual([
      { text: "Non riesco a ricordare la griglia per i prossimi disegni: disco pieno", tone: "guasto" },
    ]);
    heal();

    const next = { shown: true, snap: true, step: 100, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE };
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
  const PNG = { what: "boards", off: ["b2"], format: "png", size: { scale: 3 }, background: "paper" } as const;
  const PDF = { what: "drawing", off: [], format: "pdf", size: { scale: 2 }, background: "none" } as const;

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
