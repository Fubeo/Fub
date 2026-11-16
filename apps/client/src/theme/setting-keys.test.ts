// @vitest-environment happy-dom
// Il tema ascolta `setting_changed` solo per le sue chiavi (C4 delle
// prestazioni): aprire la barra laterale scrive `chrome.sidebar.visible`, e
// prima ogni scrittura rileggeva impostazioni e catalogo e rimontava il tema,
// ~130 ms di thread principale per gesto.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../host/contract";
import { openLifetime, type Lifetime } from "../ui/lifetime";

vi.setConfig({ testTimeout: 20_000 });

type Handler = (event: { type: "setting_changed"; key?: string; scope: "machine" }) => void;

const box = vi.hoisted(() => ({
  listThemes: vi.fn(),
  readTheme: vi.fn(),
  settings: vi.fn(),
  emit: vi.fn(),
  handlers: [] as Handler[],
}));

vi.mock("../host/ipc", () => ({
  api: { listThemes: box.listThemes, readTheme: box.readTheme, setSetting: vi.fn(async () => {}) },
}));
vi.mock("../host/query", () => ({ settings: box.settings }));
vi.mock("../state/kernel", () => ({
  onEvent: vi.fn((type: string, handler: Handler) => {
    if (type === "setting_changed") box.handlers.push(handler);
    return () => {};
  }),
}));
vi.mock("../state/store", () => ({ on: vi.fn(() => () => {}), emit: box.emit }));
vi.mock("../ui/notify", () => ({ reportThemeTrouble: vi.fn() }));

function rows(): SettingEntry[] {
  return [{
    spec: {
      key: "appearance.theme", label: "Tema", description: "", group: "Aspetto", scope: "machine",
      kind: { kind: "choice", default: "", options: [] }, program_writable: false,
    },
    value: "light",
    source: "machine",
  }];
}

let lifetime: Lifetime | undefined;
afterEach(() => lifetime?.close());

beforeEach(() => {
  document.head.innerHTML = "";
  localStorage.clear();
  vi.clearAllMocks();
  box.handlers.length = 0;
  // Un catalogo che non risponde non resta in memoria: ogni rilettura lo
  // richiede, e il conto di `listThemes` è il conto delle chiamate a
  // `readCatalog`.
  box.listThemes.mockRejectedValue(new Error("catalogo assente"));
  box.readTheme.mockRejectedValue(new Error("missing"));
  box.settings.mockImplementation(async () => rows());
});

async function mounted(): Promise<void> {
  lifetime = openLifetime();
  vi.resetModules();
  const theme = await import("./theme");
  theme.mountTheme(lifetime, vi.fn());
  await theme.whenThemeSettled();
  await idle();
  vi.clearAllMocks();
}

/// Lascia finire ogni lavoro asincrono già partito.
async function idle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function fire(key?: string): void {
  for (const handler of box.handlers) handler({ type: "setting_changed", key, scope: "machine" });
}

const foglio = () => document.head.querySelector('style[data-fub="foglio"]');
const themeSignals = () => box.emit.mock.calls.filter(([name]) => name === "theme").length;

describe("il tema e `setting_changed`", () => {
  it("scrivere `chrome.sidebar.visible` non chiama `readCatalog` né riapplica il tema", async () => {
    await mounted();
    const before = foglio();
    expect(before).not.toBeNull();
    fire("chrome.sidebar.visible");
    fire("appearance.zoom");
    await idle();
    expect(box.listThemes).not.toHaveBeenCalled();
    expect(box.settings).not.toHaveBeenCalled();
    expect(themeSignals()).toBe(0);
    expect(foglio()).toBe(before);
  });

  it.each(["appearance.theme", "appearance.accent", "chrome.compactness", "fub.serie:raggio"])(
    "una chiave del tema (%s) rilegge catalogo e impostazioni e lo riapplica",
    async (key) => {
      await mounted();
      const before = foglio();
      fire(key);
      await idle();
      expect(box.listThemes).toHaveBeenCalledTimes(1);
      expect(box.settings).toHaveBeenCalledTimes(1);
      expect(themeSignals()).toBe(1);
      expect(foglio()).not.toBe(before);
    },
  );

  it.each([undefined, ""])("un evento senza chiave (%j) rilegge tutto", async (key) => {
    await mounted();
    fire(key);
    await idle();
    expect(box.listThemes).toHaveBeenCalledTimes(1);
    expect(box.settings).toHaveBeenCalledTimes(1);
    expect(themeSignals()).toBe(1);
  });

  it("una raffica di chiavi del tema rilegge al più due volte, e l'ultima dopo l'ultimo evento", async () => {
    box.listThemes.mockResolvedValue([]);
    await mounted();
    const pending: (() => void)[] = [];
    let accent = 0;
    box.settings.mockImplementation(() => new Promise<SettingEntry[]>((resolve) => {
      const seen = accent;
      pending.push(() => resolve([...rows(), {
        spec: {
          key: "appearance.accent", label: "", description: "", group: "Aspetto", scope: "machine",
          kind: { kind: "number", default: 0, min: 0, max: 360 }, program_writable: false,
        },
        value: seen,
        source: "machine",
      }]));
    }));
    accent = 10;
    fire("appearance.accent");
    for (const value of [20, 30, 40]) {
      accent = value;
      fire("appearance.accent");
    }
    expect(box.settings).toHaveBeenCalledTimes(1);
    pending.shift()!();
    await idle();
    expect(box.settings).toHaveBeenCalledTimes(2);
    pending.shift()!();
    await idle();
    expect(box.settings).toHaveBeenCalledTimes(2);
    // L'ultima lettura è partita dopo l'ultimo evento: il valore che vale è 40.
    const cache = JSON.parse(localStorage.getItem("fub.appearance.preferences")!) as { preferences: { accent: number } };
    expect(cache.preferences.accent).toBe(40);
  });
});
