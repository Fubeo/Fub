// @vitest-environment happy-dom
// La sezione «Disegno completo» di Impostazioni › Scorciatoie (K6 T9c): il
// modulo del Completo arriva solo a riquadro aperto; ogni comando ha il tasto
// che vale e dice chi lo copre; un tasto si cambia e si azzera in `draw.keys`;
// un file d'insieme rotto lo dice e non cambia niente; un valore più nuovo non
// si riscrive.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../host/contract";
import type { VoceIndice } from "../editors/spatial/completo/indice";

const fake = vi.hoisted(() => ({ entries: [] as unknown[], caricamenti: 0, voci: [] as unknown[] }));

vi.mock("../host/ipc", () => ({
  api: {
    setSetting: vi.fn(async () => undefined),
    resetSetting: vi.fn(async () => undefined),
    saveArtifact: vi.fn(async () => ({ status: "saved", path: "/tmp/tasti.json" })),
    pendingKeybindings: async () => ({}),
  },
}));
vi.mock("../host/query", () => ({ settings: async () => fake.entries }));
vi.mock("../state/kernel", () => ({ onEvent: vi.fn() }));
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
// Il modulo del Completo, coi suoi pezzi veri dei tasti e un indice di prova:
// il contatore dice se e quando è stato caricato.
vi.mock("../editors/spatial/completo", async () => {
  fake.caricamenti++;
  const tasti = await vi.importActual<typeof import("../editors/spatial/completo/tasti")>("../editors/spatial/completo/tasti");
  const tastiUtente = await vi.importActual<typeof import("../editors/spatial/completo/tasti-utente")>(
    "../editors/spatial/completo/tasti-utente",
  );
  return {
    indiceDeiComandi: async () => ({ voci: fake.voci }),
    risolviTasti: tasti.risolviTasti,
    tastoFub: tasti.tastoFub,
    percorsoPosto: (posto: string) => posto,
    tastiUtente,
  };
});

import { api } from "../host/ipc";
import { notify } from "../ui/notify";
import { mountSettings } from "./settings";
import { importaFile } from "./settings-disegno";

function voce(id: string, tasto: string | null): VoceIndice {
  return {
    fonte: "motore",
    id,
    chiamata: { comando: `disegno.${id}` },
    etichetta: { it: `Comando ${id}`, en: `Command ${id}` },
    posto: "menu/oggetto",
    famiglia: "nucleo",
    tasto,
    effetto: "cambia",
    finestra: false,
  };
}

function drawKeys(value: string): SettingEntry {
  return {
    spec: {
      key: "draw.keys",
      label: "Tasti del Disegno completo",
      description: "",
      group: "",
      scope: "machine",
      kind: { kind: "text", default: "" },
      program_writable: false,
    },
    value,
    source: "machine",
  } as unknown as SettingEntry;
}

const valore = (tasti: Record<string, string | null>, v = 1) => JSON.stringify({ v, insieme: null, tasti });

async function openShortcuts(): Promise<HTMLDetailsElement> {
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button><button data-tab="shortcuts"></button></div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  document.querySelector<HTMLButtonElement>('[data-tab="shortcuts"]')!.click();
  await vi.waitFor(() => expect(document.querySelector("details.drawing-keys")).not.toBeNull());
  return document.querySelector<HTMLDetailsElement>("details.drawing-keys")!;
}

async function openSection(): Promise<void> {
  const details = await openShortcuts();
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
  await vi.waitFor(() => expect(document.querySelector(".drawing-keys-set")).not.toBeNull());
}

const rigaDi = (id: string) => document.querySelector<HTMLElement>(`.setting-row[data-setting-key="draw.keys:${id}"]`)!;

beforeEach(() => {
  fake.voci = [voce("a", "Cmd+J"), voce("b", "Cmd+Shift+L"), voce("c", "Cmd+P")];
  fake.entries = [drawKeys("")];
  vi.mocked(api.setSetting).mockClear();
  vi.mocked(api.resetSetting).mockClear();
  vi.mocked(notify).mockClear();
});

afterEach(() => {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
});

describe("la sezione Disegno completo delle scorciatoie", () => {
  it("carica il modulo del Completo solo quando la si apre", async () => {
    const prima = fake.caricamenti;
    await openShortcuts();
    expect(fake.caricamenti).toBe(prima);
    expect(document.querySelector(".drawing-keys-set")).toBeNull();
    await openSection();
    expect(fake.caricamenti).toBeGreaterThan(0);
  });

  it("mostra il tasto che vale, e un tasto di Fub che lo copre", async () => {
    await openSection();
    expect(rigaDi("a").querySelector<HTMLInputElement>("input")!.value).toBe("Mod-J");
    expect(rigaDi("a").hasAttribute("data-issue")).toBe(false);
    // Ctrl+P è di Fub: vince Fub.
    expect(rigaDi("c").querySelector<HTMLInputElement>("input")!.value).toBe("Mod-P");
    expect(rigaDi("c").hasAttribute("data-issue")).toBe(true);
    expect(rigaDi("c").querySelector(".setting-diagnostic")!.textContent).toContain("Fub");
  });

  it("dice il conflitto fra due comandi, e vince l'ultimo assegnato", async () => {
    fake.entries = [drawKeys(valore({ b: "Mod-j" }))];
    await openSection();
    expect(rigaDi("a").querySelector(".setting-diagnostic")!.textContent).toContain("Comando b");
    expect(rigaDi("b").querySelector(".setting-diagnostic")!.textContent).toContain("Comando a");
    expect(rigaDi("b").dataset.modified).toBe("true");
  });

  it("un tasto cambiato si scrive in draw.keys; uno sbagliato no", async () => {
    await openSection();
    const input = rigaDi("a").querySelector<HTMLInputElement>("input")!;
    input.value = "k";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(api.setSetting).not.toHaveBeenCalled();

    input.value = "Mod-Alt-u";
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalled());
    expect(vi.mocked(api.setSetting).mock.calls[0]![0]).toBe("draw.keys");
    expect(JSON.parse(String(vi.mocked(api.setSetting).mock.calls[0]![1]))).toEqual({ v: 1, insieme: null, tasti: { a: "Mod-Alt-u" } });
  });

  it("«Azzera» toglie la modifica, e l'ultima torna al valore di serie", async () => {
    fake.entries = [drawKeys(valore({ a: "Mod-Alt-u" }))];
    await openSection();
    rigaDi("a").querySelector<HTMLButtonElement>(".setting-reset")!.click();
    await vi.waitFor(() => expect(api.resetSetting).toHaveBeenCalledWith("draw.keys"));
    expect(api.setSetting).not.toHaveBeenCalled();
  });

  it("un valore di una versione più nuova non si riscrive: resta solo Azzera", async () => {
    fake.entries = [drawKeys(valore({ a: "Mod-Alt-u" }, 2))];
    await openSection();
    expect(rigaDi("a").querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    expect(document.querySelector<HTMLSelectElement>("#setting-draw-keys-set")!.disabled).toBe(true);
    expect(document.querySelector(".drawing-keys")!.textContent).toContain("versione 2");
  });

  it("un file d'insieme rotto lo dice e non cambia niente", async () => {
    await openSection();
    const salva = vi.fn(async () => undefined);
    await importaFile(new Blob(["{rotto"]), { insieme: null, tasti: {} }, salva, new Set(["a", "b"]));
    expect(salva).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Non è cambiato niente"), "guasto");

    const tastoSbagliato = JSON.stringify({ format: "vectorcraft-shortcuts", version: 1, overrides: { a: "Cmd+Shift+1" } });
    await importaFile(new Blob([tastoSbagliato]), { insieme: null, tasti: {} }, salva, new Set(["a"]));
    expect(salva).not.toHaveBeenCalled();
    expect(vi.mocked(notify).mock.lastCall![0]).toContain("Comando a");
  });

  it("un file d'insieme buono prende il posto dei tasti", async () => {
    await openSection();
    const salva = vi.fn(async () => undefined);
    const buono = JSON.stringify({ format: "vectorcraft-shortcuts", version: 1, set: "Custom", overrides: { a: "Cmd+Alt+U", z: "Cmd+9" } });
    await importaFile(new Blob([buono]), { insieme: null, tasti: {} }, salva, new Set(["a", "b"]));
    expect(salva).toHaveBeenCalledWith({ insieme: null, tasti: { a: "Mod-Alt-U" } });
  });

  it("esporta l'insieme con la finestra di salvataggio dell'host", async () => {
    fake.entries = [drawKeys(valore({ a: "Mod-Alt-u" }))];
    await openSection();
    const esporta = [...document.querySelectorAll<HTMLButtonElement>(".drawing-keys-set button")].find((b) =>
      b.textContent?.startsWith("Esporta"),
    )!;
    esporta.click();
    await vi.waitFor(() => expect(api.saveArtifact).toHaveBeenCalled());
    const [nome, tipo, bytes] = vi.mocked(api.saveArtifact).mock.calls[0]!;
    expect(nome).toBe("tasti-disegno-completo.json");
    expect(tipo).toBe("application/json");
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(bytes as number[]))).overrides).toEqual({ a: "Cmd+Alt+U" });
  });
});
