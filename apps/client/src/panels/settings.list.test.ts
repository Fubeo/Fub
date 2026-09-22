// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../host/contract";

const fake = vi.hoisted(() => ({
  entries: [] as Array<{
    spec: {
      key: string;
      label: string;
      description: string;
      group: string;
      scope: "vault";
      kind: { kind: "list"; default: string[] };
      program_writable: boolean;
    };
    value: string[];
    source: "default" | "vault";
  }>,
  setSetting: vi.fn(),
  resetSetting: vi.fn(),
}));

vi.mock("../host/ipc", () => ({
  api: {
    setSetting: fake.setSetting,
    resetSetting: fake.resetSetting,
  },
}));

vi.mock("../host/query", () => ({ settings: async () => fake.entries }));
vi.mock("../state/kernel", () => ({ onEvent: vi.fn() }));
vi.mock("../ui/commands", () => ({ allCommands: () => [], keybindingKey: (id: string) => id }));
vi.mock("../ui/permissions", () => ({
  TRUST_LABELS: {},
  isPermissionKey: () => false,
  rows: () => [],
}));
vi.mock("../ui/a11y", () => ({ trapFocus: () => () => {} }));
vi.mock("../ui/motion", () => ({
  enterSurface: () => {},
  exitSurface: (_el: HTMLElement, done: () => void) => done(),
}));
vi.mock("../ui/tooltip", () => ({ setTooltip: () => {} }));
vi.mock("../ui/notify", () => ({ notify: vi.fn() }));

import { mountSettings } from "./settings";

const EXCLUDED = "files.excluded-folders";

function listEntry(
  key: string,
  value: string[],
  source: "default" | "vault" = "default",
  defaults: string[] = ["node_modules"],
): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "File",
      scope: "vault",
      kind: { kind: "list", default: defaults },
      program_writable: false,
    },
    value,
    source,
  };
}

async function openPanel(entries: SettingEntry[]): Promise<void> {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  fake.entries = entries as typeof fake.entries;
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button></div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  mountSettings({
    openVault: async () => {},
    reloadProvider: async () => {},
  });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await vi.waitFor(() => {
    expect(document.querySelector("#settings-body .setting-row")).not.toBeNull();
  });
}

function submitFolder(value: string): void {
  const input = document.getElementById(`setting-${EXCLUDED}`) as HTMLInputElement;
  input.value = value;
  input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.setSetting.mockImplementation(async (key: string, value: string[]) => {
    const entry = fake.entries.find((candidate) => candidate.spec.key === key)!;
    entry.value = value;
    entry.source = "vault";
  });
  fake.resetSetting.mockImplementation(async (key: string) => {
    const entry = fake.entries.find((candidate) => candidate.spec.key === key)!;
    entry.value = [...entry.spec.kind.default];
    entry.source = "default";
  });
});

describe("le cartelle escluse nel pannello", () => {
  it("normalizza l'aggiunta e rimuove inviando ogni volta la lista intera", async () => {
    await openPanel([listEntry(EXCLUDED, ["node_modules"])]);

    submitFolder("  /Build/  ");
    await vi.waitFor(() => {
      expect(fake.setSetting).toHaveBeenCalledWith(EXCLUDED, ["node_modules", "Build"]);
    });

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLButtonElement>('[aria-label="Rimuovi Build dalle cartelle escluse"]')).not.toBeNull();
    });
    document
      .querySelector<HTMLButtonElement>('[aria-label="Rimuovi Build dalle cartelle escluse"]')!
      .click();
    await vi.waitFor(() => {
      expect(fake.setSetting).toHaveBeenLastCalledWith(EXCLUDED, ["node_modules"]);
    });
  });

  it("rimuovere l'ultima voce scrive la lista vuota, senza trasformarla in reset", async () => {
    await openPanel([listEntry(EXCLUDED, ["target"], "vault")]);

    document
      .querySelector<HTMLButtonElement>('[aria-label="Rimuovi target dalle cartelle escluse"]')!
      .click();

    await vi.waitFor(() => {
      expect(fake.setSetting).toHaveBeenCalledWith(EXCLUDED, []);
    });
    expect(fake.resetSetting).not.toHaveBeenCalled();
  });

  it("Azzera usa la porta di reset e ripristina il default", async () => {
    const entry = listEntry(EXCLUDED, ["target"], "vault", ["node_modules"]);
    await openPanel([entry]);

    const reset = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Azzera",
    )!;
    reset.click();

    await vi.waitFor(() => {
      expect(fake.resetSetting).toHaveBeenCalledWith(EXCLUDED);
      expect(entry.value).toEqual(["node_modules"]);
      expect(entry.source).toBe("default");
    });
  });

  it.each([
    ["   ", "Scrivi il nome di una cartella."],
    ["NODE_MODULES", "NODE_MODULES è già nell’elenco."],
    ["/.FUB/", ".FUB è una cartella strutturale e resta sempre esclusa."],
    ["progetti/privati", "Scrivi un nome di cartella, non un percorso."],
  ])("rifiuta %j con un errore accessibile", async (value, message) => {
    await openPanel([listEntry(EXCLUDED, ["node_modules"])]);

    submitFolder(value);

    const input = document.getElementById(`setting-${EXCLUDED}`) as HTMLInputElement;
    const error = document.getElementById(`setting-${EXCLUDED}-error`) as HTMLElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toBe(message);
    expect(fake.setSetting).not.toHaveBeenCalled();
  });

  it("lascia le altre liste in sola lettura", async () => {
    await openPanel([
      listEntry(EXCLUDED, ["node_modules"]),
      listEntry("plugins.disabled", ["example.plugin"]),
    ]);

    const readonly = document.getElementById("setting-plugins.disabled");
    expect(readonly).not.toBeNull();
    expect(readonly).not.toBeInstanceOf(HTMLInputElement);
    expect(document.querySelectorAll("button[type=submit]")).toHaveLength(1);
  });
});

describe("l'esito vicino al campo", () => {
  it("su errore conserva il valore autorevole e mostra l'input provato vicino alla riga", async () => {
    await openPanel([listEntry(EXCLUDED, ["node_modules"])]);
    fake.setSetting.mockRejectedValueOnce(new Error("disco non scrivibile"));

    submitFolder("Build");

    await vi.waitFor(() => {
      expect(fake.setSetting).toHaveBeenCalledWith(EXCLUDED, ["node_modules", "Build"]);
    });
    await vi.waitFor(() => {
      const row = document.querySelector('[data-setting-key="files.excluded-folders"] .setting-error');
      expect(row).not.toBeNull();
      expect(row!.textContent).toContain("Impostazione non cambiata");
      expect(row!.textContent).toContain("Build");
      expect(row!.getAttribute("role")).toBe("alert");
    });
    // Il valore autorevole resta: la lista non mostra la voce non scritta.
    expect(document.querySelector("#settings-body")!.textContent).not.toContain("Rimuovi Build");
    // Lo scope resta visibile accanto all'esito.
    expect(document.querySelector("#settings-body")!.textContent).toContain("valore predefinito");
  });

  it("il giro di pending non blocca le altre righe", async () => {
    await openPanel([
      listEntry(EXCLUDED, ["node_modules"]),
      listEntry("files.other-folders", ["a"]),
    ]);
    let release!: () => void;
    fake.setSetting.mockImplementationOnce(
      () => new Promise<string[]>((resolve) => { release = () => resolve(["node_modules"]); }),
    );

    submitFolder("Build");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-setting-key="files.excluded-folders"]')?.getAttribute("aria-busy")).toBe("true");
    });
    // La riga in volo è disabilitata, l'altra no: il blocco è minimo.
    const row = document.querySelector('[data-setting-key="files.excluded-folders"]')!;
    for (const control of row.querySelectorAll("input, select, button")) {
      expect((control as HTMLButtonElement).disabled).toBe(true);
    }
    const other = document.querySelector('[data-setting-key="files.other-folders"]')!;
    expect(other.getAttribute("aria-busy")).toBeNull();
    release();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-setting-key="files.excluded-folders"]')?.getAttribute("aria-busy")).toBeNull();
    });
  });
});

describe("il focus resta sulla riga (A03)", () => {
  function toggleEntry(key: string, value: boolean): SettingEntry {
    return {
      spec: {
        key,
        label: key,
        description: "",
        group: "File",
        scope: "vault",
        kind: { kind: "toggle", default: false },
        program_writable: false,
      },
      value,
      source: "default",
    };
  }

  it("checkbox: resta dopo la scrittura", async () => {
    fake.setSetting.mockImplementation(async (key: string, value: boolean) => {
      const entry = fake.entries.find((candidate) => candidate.spec.key === key)!;
      (entry as unknown as SettingEntry).value = value;
    });
    await openPanel([toggleEntry("a.first", false), toggleEntry("b.second", false)]);

    const first = document.getElementById("setting-a.first") as HTMLInputElement;
    first.focus();
    first.checked = true;
    first.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.activeElement?.id).toBe("setting-a.first");
    });
    expect(document.activeElement).not.toBe(document.body);
  });
});
