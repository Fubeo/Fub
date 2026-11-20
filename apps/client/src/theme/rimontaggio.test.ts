// @vitest-environment happy-dom
// Il fascio del tema si rivalida e si rimonta solo quando cambia il suo
// contenuto. Prima ogni preferenza (il cursore dell'accento, la densità, la
// misura) rivalidava e rimaterializzava il fascio intero: ~50–130 ms di thread
// principale per passo. Il cancello si vede dal sanitizzatore: ogni
// validazione passa il foglio da `themeCssViolations`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry, ThemeInfo, ThemeManifest, ThemePayload } from "../host/contract";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import sheetLight from "./scrittoio/sheet-light.css?raw";
import sheetDark from "./scrittoio/sheet-dark.css?raw";
import skin from "./scrittoio/skin.css?raw";

vi.setConfig({ testTimeout: 20_000 });

type Handler = (event: { type: "setting_changed"; key?: string; scope: "machine" }) => void;

const box = vi.hoisted(() => ({
  listThemes: vi.fn<() => Promise<ThemeInfo[]>>(),
  readTheme: vi.fn<(id: string, light: "light" | "dark") => Promise<ThemePayload>>(),
  settings: vi.fn<() => Promise<SettingEntry[]>>(),
  handlers: [] as Handler[],
  violations: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock("../ui/sanitize-css", async (original) => {
  const actual = await original<typeof import("../ui/sanitize-css")>();
  box.violations = vi.fn(actual.themeCssViolations);
  return { ...actual, themeCssViolations: box.violations };
});
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
vi.mock("../state/store", () => ({ on: vi.fn(() => () => {}), emit: vi.fn() }));
vi.mock("../ui/notify", () => ({ reportThemeTrouble: vi.fn() }));

const manifest: ThemeManifest = {
  id: "acme.paper",
  name: "Acme Paper",
  version: "1.0.0",
  engine: "theme-2",
  lights: ["light"],
  asset_namespace: "theme://acme.paper/",
  motion: ["opacity", "transform"],
};
const paperSheet = sheetLight.replace("  color-scheme: light;", "  color-scheme: normal;");

function row(key: string, value: unknown, kind: SettingEntry["spec"]["kind"]): SettingEntry {
  return {
    spec: { key, label: key, description: "", group: "Aspetto", scope: "machine", kind, program_writable: false },
    value: value as SettingEntry["value"],
    source: "machine",
  };
}

const state = { light: "light", accent: 200, themeId: "fub.serie" };
function rows(): SettingEntry[] {
  return [
    row("appearance.theme", state.light, { kind: "choice", default: "", options: [] }),
    row("appearance.accent", state.accent, { kind: "number", default: 0, min: 0, max: 360 }),
    row("appearance.theme-id", state.themeId, { kind: "text", default: "" }),
  ];
}

let lifetime: Lifetime | undefined;
afterEach(() => lifetime?.close());

beforeEach(() => {
  document.head.innerHTML = "";
  document.adoptedStyleSheets = [];
  localStorage.clear();
  vi.clearAllMocks();
  box.handlers.length = 0;
  Object.assign(state, { light: "light", accent: 200, themeId: "fub.serie" });
  box.listThemes.mockResolvedValue([]);
  box.readTheme.mockRejectedValue(new Error("missing"));
  box.settings.mockImplementation(async () => rows());
});

async function idle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mountOn(theme: typeof import("./theme")): Promise<void> {
  lifetime?.close();
  box.handlers.length = 0;
  lifetime = openLifetime();
  theme.mountTheme(lifetime, vi.fn());
  await theme.whenThemeSettled();
  await idle();
}

async function fresh(): Promise<typeof import("./theme")> {
  vi.resetModules();
  const theme = await import("./theme");
  await mountOn(theme);
  return theme;
}

function fire(key: string): void {
  for (const handler of box.handlers) handler({ type: "setting_changed", key, scope: "machine" });
}

/// Il foglio costruito di un canale del tema e il testo che ci ha montato il
/// caricatore: lo dice la mappa dei fogli del tema, che `loader.ts` tiene sul
/// registro globale perché sopravviva a `vi.resetModules`.
const owned = () =>
  (globalThis as { [key: symbol]: WeakMap<CSSStyleSheet, { layer: string; text: string }> | undefined })[
    Symbol.for("fub.theme.sheets")
  ];
const layer = (name: string) =>
  document.adoptedStyleSheets.find((sheet) => owned()?.get(sheet)?.layer === name) ?? null;
const text = (name: string) => {
  const sheet = layer(name);
  return sheet === null ? null : owned()!.get(sheet)!.text;
};

describe("il fascio del tema si rimonta solo se cambia", () => {
  it("cambiare `appearance.accent` non rivalida il fascio, e l'accento arriva lo stesso", async () => {
    await fresh();
    const foglio = layer("foglio");
    expect(foglio).not.toBeNull();
    const pelle = layer("pelle");
    expect(pelle).not.toBeNull();
    const before = text("preferenze");
    box.violations.mockClear();
    state.accent = 30;
    fire("appearance.accent");
    await idle();
    expect(box.violations).not.toHaveBeenCalled();
    expect(layer("foglio")).toBe(foglio);
    expect(layer("pelle")).toBe(pelle);
    expect(text("preferenze")).not.toBe(before);
  });

  it("cambiare la luce sì: è un altro foglio", async () => {
    await fresh();
    const foglio = layer("foglio");
    expect(foglio).not.toBeNull();
    box.violations.mockClear();
    state.light = "dark";
    fire("appearance.theme");
    await idle();
    expect(box.violations).toHaveBeenCalled();
    expect(layer("foglio")).not.toBe(foglio);
    expect(text("foglio")).toBe(sheetDark);
  });

  it("lo stesso id con un contenuto diverso sì: il confronto è sul contenuto, non sul nome", async () => {
    const info: ThemeInfo = { manifest, trust: "community" };
    let sheet = paperSheet;
    box.listThemes.mockResolvedValue([info]);
    box.readTheme.mockImplementation(async () => ({ manifest, light: "light", sheet, skin, assets: {} }));
    state.themeId = "acme.paper";
    const theme = await fresh();
    expect(text("foglio")).toBe(paperSheet);

    // Il file è cambiato su disco, l'id e la versione no: lo stesso modulo
    // (quindi lo stesso ricordo del fascio montato) rilegge e rivalida.
    sheet = paperSheet.replace("color-scheme: normal;", "color-scheme: normal;\n  --tinta-prova: 1px;");
    box.violations.mockClear();
    await mountOn(theme);
    expect(box.violations.mock.calls.some(([css]) => String(css).includes("--tinta-prova"))).toBe(true);
    expect(text("foglio")).toContain("--tinta-prova");

    // Poi l'accento non lo rifà: il fascio nuovo è quello ricordato.
    box.violations.mockClear();
    const foglio = layer("foglio");
    expect(foglio).not.toBeNull();
    state.accent = 90;
    fire("appearance.accent");
    await idle();
    expect(box.violations).not.toHaveBeenCalled();
    expect(layer("foglio")).toBe(foglio);
  });
});

describe("mountThemeBundle tiene il contenuto, non il nome", () => {
  async function loader() {
    vi.resetModules();
    return import("./loader");
  }
  const bundle = (over: Partial<import("./loader").ThemeBundle> = {}): import("./loader").ThemeBundle => ({
    manifest, sheet: paperSheet, skin, assets: {}, ...over,
  });

  it("un fascio uguale non ripassa dal cancello e lascia gli stessi elementi", async () => {
    const { mountThemeBundle } = await loader();
    expect(mountThemeBundle(bundle(), "light")).toEqual({ mounted: true });
    const foglio = layer("foglio");
    expect(foglio).not.toBeNull();
    box.violations.mockClear();
    // Un oggetto nuovo con lo stesso contenuto: vale il contenuto.
    expect(mountThemeBundle(bundle({ manifest: { ...manifest } }), "light")).toEqual({ mounted: true });
    expect(box.violations).not.toHaveBeenCalled();
    expect(layer("foglio")).toBe(foglio);
  });

  it("un asset con byte diversi, un manifest diverso o un foglio tolto da fuori lo rifanno", async () => {
    const { mountThemeBundle, mount } = await loader();
    const asset = "theme://acme.paper/carta.png";
    const bytes = [1, 2, 3];
    mountThemeBundle(bundle({ assets: { [asset]: bytes } }), "light");

    box.violations.mockClear();
    bytes[2] = 4; // lo stesso oggetto, cambiato sul posto: conta il contenuto
    mountThemeBundle(bundle({ assets: { [asset]: bytes } }), "light");
    expect(box.violations).toHaveBeenCalled();

    box.violations.mockClear();
    mountThemeBundle(bundle({ assets: { [asset]: bytes }, manifest: { ...manifest, version: "1.0.1" } }), "light");
    expect(box.violations).toHaveBeenCalled();

    box.violations.mockClear();
    mount("/* altro */", "foglio");
    mountThemeBundle(bundle({ assets: { [asset]: bytes }, manifest: { ...manifest, version: "1.0.1" } }), "light");
    expect(box.violations).toHaveBeenCalled();
    expect(text("foglio")).toBe(paperSheet);
  });

  it("un fascio rifiutato non tocca il ricordo di quello montato", async () => {
    const { mountThemeBundle } = await loader();
    mountThemeBundle(bundle(), "light");
    const foglio = layer("foglio");
    expect(foglio).not.toBeNull();
    const rejected = mountThemeBundle(bundle({ sheet: "" }), "light", () => {});
    expect(rejected.mounted).toBe(false);
    box.violations.mockClear();
    mountThemeBundle(bundle(), "light");
    expect(box.violations).not.toHaveBeenCalled();
    expect(layer("foglio")).toBe(foglio);
  });
});
