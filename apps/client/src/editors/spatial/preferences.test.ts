// @vitest-environment happy-dom
//
// Il livello e la griglia del disegno, contro l'host finto: il livello è
// l'impostazione del vault che il bundle `fub.draw` dichiara, la griglia lo
// stato di vista che resta su questa macchina. Ogni caso riparte da moduli
// nuovi, perché `preferences.ts` ricorda l'ultima lettura.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../host/contract";
import type { FakeHost } from "../../host/fake";

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
    const standard = { shown: false, snap: false, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true };
    expect(currentGrid()).toEqual(standard);
    expect(await readGrid(), "niente di ricordato").toEqual(standard);

    const chosen = { shown: true, snap: true, step: 50, guides: false, steps: {}, rulers: false, rulerGuides: true };
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
    ]) {
      await host.module.api.setViewState(GRID_KEY, broken);
      expect(await readGrid(), JSON.stringify(broken)).toEqual(standard);
    }
  });

  it("una griglia ricordata prima delle guide intelligenti le ha accese", async () => {
    const host = createFakeHost();
    const { readGrid } = await boot(host);
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10 });
    expect(await readGrid()).toEqual({ shown: true, snap: false, step: 10, guides: true, steps: {}, rulers: false, rulerGuides: true });
  });

  it("una griglia ricordata prima dei righelli li ha spenti, e dei passi delle unità tiene quelli buoni", async () => {
    const host = createFakeHost();
    const { readGrid } = await boot(host);
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: false, step: 10, guides: false });
    expect(await readGrid()).toEqual({ shown: true, snap: false, step: 10, guides: false, steps: {}, rulers: false, rulerGuides: true });
    const steps = { mm: 18.9, cm: 0, in: "24", pt: 5000, px: 40, km: 10 };
    await host.module.api.setViewState(GRID_KEY, { shown: false, snap: true, step: 20, steps, guides: true, rulers: true, rulerGuides: false });
    expect(await readGrid()).toEqual({ shown: false, snap: true, step: 20, steps: { mm: 18.9 }, guides: true, rulers: true, rulerGuides: false });
  });

  it("se lo stato di vista non si legge, resta l'ultima griglia", async () => {
    const host = createFakeHost();
    const { readGrid, saveGrid } = await boot(host);
    const chosen = { shown: true, snap: false, step: 10, guides: true, steps: {}, rulers: false, rulerGuides: true };
    saveGrid(chosen);
    await settle();
    const heal = host.fault("viewState");
    expect(await readGrid()).toEqual(chosen);
    heal();
  });

  it("si ricorda nell'ordine delle scelte, e la lettura aspetta le scritture", async () => {
    const host = createFakeHost();
    const { currentGrid, readGrid, saveGrid } = await boot(host);
    const shown = { shown: true, snap: false, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true };
    const snapped = { shown: true, snap: true, step: 10, guides: false, steps: {}, rulers: false, rulerGuides: true };

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
    await host.module.api.setViewState(GRID_KEY, { shown: true, snap: true, step: 50, guides: true, steps: {}, rulers: false, rulerGuides: true });

    const release = host.throttle("viewState");
    const reading = readGrid();
    await settle();
    const chosen = { shown: false, snap: false, step: 5, guides: false, steps: {}, rulers: false, rulerGuides: true };
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
    saveGrid({ shown: true, snap: false, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true });
    await settle();
    expect(recentNotices().map(({ text, tone }) => ({ text, tone }))).toEqual([
      { text: "Non riesco a ricordare la griglia per i prossimi disegni: disco pieno", tone: "guasto" },
    ]);
    heal();

    const next = { shown: true, snap: true, step: 100, guides: true, steps: {}, rulers: false, rulerGuides: true };
    saveGrid(next);
    await settle();
    expect(await host.module.api.viewState(GRID_KEY)).toEqual(next);
    expect(recentNotices()).toHaveLength(1);
  });
});
