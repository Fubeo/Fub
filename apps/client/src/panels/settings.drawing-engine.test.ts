// @vitest-environment happy-dom
// La sezione «Motore del disegno» di Impostazioni › Disegni (K6 T11): c'è solo
// con il Disegno completo acceso e un vault aperto; il corpo arriva solo a
// riquadro aperto; l'elenco è `prefs.list` del motore, senza cartelle; un campo
// preso è un `prefs.set`, «Ripristina» un `prefs.reset` della categoria; un
// `draw.motore` più nuovo o rotto spegne i campi e dice perché.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../host/contract";

const fake = vi.hoisted(() => ({
  entries: [] as unknown[],
  acceso: true,
  caricamenti: 0,
  righe: [] as unknown[],
  aperture: 0,
  chiusure: [] as string[],
}));

vi.mock("../host/ipc", () => ({
  api: {
    setSetting: vi.fn(async () => undefined),
    resetSetting: vi.fn(async () => undefined),
    pendingKeybindings: async () => ({}),
    settingsProfiles: async () => ({ active: "default", names: ["default"] }),
    knownVaults: async () => [],
    frameCapabilities: async () => ({ system: true, custom: true }),
    settingRequiresReopen: async () => false,
    openDrawing: vi.fn(async () => ({ instance: `i${++fake.aperture}` })),
    closeDrawing: vi.fn(async (instance: string) => {
      fake.chiusure.push(instance);
    }),
    drawingCommand: vi.fn(async (_instance: string, request: { id: string }) => ({
      revision: "0",
      preview: null,
      ops: null,
      selection: [],
      losses: [],
      refused: null,
      frame: null,
      reading: request.id === "disegno.prefs.list" ? fake.righe : null,
    })),
  },
}));
vi.mock("../host/query", () => ({ settings: async () => fake.entries }));
vi.mock("../state/kernel", () => ({ onEvent: vi.fn() }));
vi.mock("../state/components", async (original) => ({
  ...(await original<typeof import("../state/components")>()),
  components: () => ({ on: (id: string) => id === "fub.disegno-completo" && fake.acceso }),
}));
vi.mock("../ui/commands", async (original) => ({
  ...(await original<typeof import("../ui/commands")>()),
  allCommands: () => [],
  registerComponentRow: () => () => {},
}));
vi.mock("../ui/permissions", () => ({ TRUST_LABELS: {}, isPermissionKey: () => false, rows: () => [] }));
vi.mock("../ui/a11y", async (original) => ({
  ...(await original<typeof import("../ui/a11y")>()),
  trapFocus: () => () => {},
}));
vi.mock("../ui/motion", () => ({
  enterSurface: () => {},
  exitSurface: (_el: HTMLElement, done: () => void) => done(),
}));
vi.mock("../ui/tooltip", () => ({ setTooltip: () => {}, attachTooltip: () => () => {} }));
vi.mock("../ui/notify", () => ({ notify: vi.fn() }));
vi.mock("../platform/confirm", () => ({ confirm: vi.fn(async () => true) }));
// Il corpo vero, con un contatore che dice se e quando è stato caricato.
vi.mock("./settings-motore-corpo", async () => {
  fake.caricamenti++;
  return await vi.importActual<typeof import("./settings-motore-corpo")>("./settings-motore-corpo");
});

import { api } from "../host/ipc";
import { state } from "../state/store";
import { confirm } from "../platform/confirm";
import { mountSettings } from "./settings";

function entry(key: string, value: unknown, kind: unknown): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "Disegni",
      scope: "machine",
      kind,
      program_writable: false,
    },
    value,
    source: "machine",
  } as unknown as SettingEntry;
}

const motore = (value: string) => entry("draw.motore", value, { kind: "text", default: "" });

const RIGHE = [
  { key: "showGrid", category: "Guides & Grid", section: "Grid", label: "Show grid", value: true, kind: "bool" },
  {
    key: "gridStyle",
    category: "Guides & Grid",
    section: "Grid",
    label: "Grid style",
    value: "lines",
    kind: "choice",
    options: ["lines", "dots"],
  },
  {
    key: "keyboardIncrement",
    category: "General",
    section: "",
    label: "Keyboard increment",
    value: 1,
    kind: "number",
    min: 0,
    max: 100,
    unit: "pt",
  },
];

async function openForm(): Promise<HTMLDetailsElement | null> {
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button><button data-tab="shortcuts"></button></div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-setting-key="draw.snap"]')).not.toBeNull());
  return document.querySelector<HTMLDetailsElement>('details[data-details-key="drawing-engine"]');
}

async function openSection(): Promise<HTMLDetailsElement> {
  const details = (await openForm())!;
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
  await vi.waitFor(() =>
    expect(document.querySelector('details[data-details-key="drawing-engine:General"]')).not.toBeNull(),
  );
  return document.querySelector<HTMLDetailsElement>('details[data-details-key="drawing-engine"]')!;
}

beforeEach(() => {
  state.vaultRoot = "/vault";
  fake.acceso = true;
  fake.righe = RIGHE;
  fake.entries = [entry("draw.snap", true, { kind: "toggle", default: true }), motore("")];
  vi.mocked(api.drawingCommand).mockClear();
  vi.mocked(api.openDrawing).mockClear();
  vi.mocked(api.resetSetting).mockClear();
  vi.mocked(confirm).mockClear();
});

afterEach(() => {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  state.vaultRoot = "";
});

describe("la sezione Motore del disegno", () => {
  it("carica il corpo solo quando la si apre, nel gruppo dei disegni", async () => {
    const prima = fake.caricamenti;
    const details = await openForm();
    expect(details).not.toBeNull();
    expect(details!.closest(".settings-section")?.querySelector('[data-setting-key="draw.snap"]')).not.toBeNull();
    expect(fake.caricamenti).toBe(prima);
    expect(api.openDrawing).not.toHaveBeenCalled();
    await openSection();
    expect(fake.caricamenti).toBeGreaterThan(prima);
    expect(api.drawingCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: "disegno.prefs.list" }),
      "/vault",
    );
  });

  it("non c'è con il Disegno completo spento né senza un vault", async () => {
    fake.acceso = false;
    expect(await openForm()).toBeNull();
    document.querySelector<HTMLButtonElement>("#settings-close")?.click();
    fake.acceso = true;
    state.vaultRoot = "";
    expect(await openForm()).toBeNull();
  });

  it("mostra le categorie e le parole del glossario, e un campo preso è un prefs.set", async () => {
    await openSection();
    const griglia = document.querySelector<HTMLDetailsElement>('details[data-details-key="drawing-engine:Guides & Grid"]')!;
    expect(griglia.querySelector("summary")!.textContent).not.toBe("Guides & Grid");
    const casella = griglia.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(casella.checked).toBe(true);
    casella.click();
    await vi.waitFor(() =>
      expect(api.drawingCommand).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ id: "disegno.prefs.set", value: { key: "showGrid", value: false } }),
        "/vault",
      ),
    );
  });

  it("Ripristina chiama prefs.reset della sua categoria", async () => {
    await openSection();
    const generale = document.querySelector<HTMLElement>('details[data-details-key="drawing-engine:General"]')!;
    const ripristina = [...generale.querySelectorAll<HTMLButtonElement>("button.settings-btn")].pop()!;
    ripristina.click();
    await vi.waitFor(() =>
      expect(api.drawingCommand).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ id: "disegno.prefs.reset", value: { category: "General" } }),
        "/vault",
      ),
    );
  });

  it("un draw.motore più nuovo spegne i campi, dice perché e si azzera chiedendo", async () => {
    fake.entries = [entry("draw.snap", true, { kind: "toggle", default: true }), motore('{"v":99,"prefs":{}}')];
    const details = await openSection();
    const stato = details.querySelector('[role="status"]')!;
    expect(stato.textContent).toContain("99");
    for (const fieldset of details.querySelectorAll("fieldset")) expect(fieldset.disabled).toBe(true);
    const azzera = details.querySelector<HTMLButtonElement>(".settings-actions button")!;
    azzera.click();
    await vi.waitFor(() => expect(api.resetSetting).toHaveBeenCalledWith("draw.motore"));
    expect(confirm).toHaveBeenCalled();
    expect(api.drawingCommand).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: "disegno.prefs.reset" }),
      expect.anything(),
    );
  });

  it("un draw.motore rotto è in sola lettura come quello più nuovo", async () => {
    fake.entries = [entry("draw.snap", true, { kind: "toggle", default: true }), motore("{non json")];
    const details = await openSection();
    expect(details.querySelector('[role="status"]')).not.toBeNull();
    for (const fieldset of details.querySelectorAll("fieldset")) expect(fieldset.disabled).toBe(true);
  });

  it("chiude il disegno vuoto quando le Impostazioni si chiudono", async () => {
    await openSection();
    const aperte = fake.aperture;
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    await vi.waitFor(() => expect(fake.chiusure).toContain(`i${aperte}`));
  });
});

describe("la lettura di draw.motore", () => {
  it("segue la regola dell'host", async () => {
    const { leggiValore } = await import("./settings-motore-corpo");
    expect(leggiValore("")).toEqual({ stato: "ok" });
    expect(leggiValore('{"v":1,"prefs":{}}')).toEqual({ stato: "ok" });
    expect(leggiValore('{"v":2,"prefs":{}}')).toEqual({ stato: "nuovo", versione: 2 });
    expect(leggiValore('{"v":1}')).toEqual({ stato: "rotto" });
    expect(leggiValore("[1]")).toEqual({ stato: "rotto" });
  });

  it("le parole generate non hanno le cartelle", async () => {
    const parole = (await import("./settings-motore.generated.json")).default;
    expect(Object.keys(parole.testi)).not.toContain("Fonts folder");
    expect(JSON.stringify(parole)).not.toMatch(/Folder"/);
  });
});
