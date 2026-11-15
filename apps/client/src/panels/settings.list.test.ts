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
vi.mock("../ui/commands", () => ({ allCommands: () => [], keybindingKey: (id: string) => id, newKinds: () => ["note"], registerComponentRow: () => () => {} }));
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

import { onEvent } from "../state/kernel";
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
      listEntry("sync.exclude", ["drafts"]),
    ]);

    const readonly = document.getElementById("setting-sync.exclude");
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

describe("gli strumenti della colonna nel pannello", () => {
  const TOOLBAR = "draw.toolbar";
  const toolbar = (value: string[], source: "default" | "vault" = "vault"): SettingEntry => ({
    spec: {
      key: TOOLBAR,
      label: "Strumenti della colonna",
      description: "",
      group: "Disegni",
      scope: "vault",
      kind: { kind: "list", default: [] },
      program_writable: false,
    },
    value,
    source,
  });
  const box = (tool: string): HTMLInputElement => document.getElementById(`setting-${TOOLBAR}-${tool}`) as HTMLInputElement;

  it("una casella per strumento; gli scelti si scrivono nel loro ordine, e un nome sconosciuto resta in fondo", async () => {
    await openPanel([toolbar(["highlighter", "select", "domani"])]);
    expect(box("highlighter").checked).toBe(true);
    expect(box("pen").checked).toBe(false);
    const input = box("pen");
    input.focus();
    input.click();
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalled());
    expect(fake.setSetting).toHaveBeenLastCalledWith(TOOLBAR, ["highlighter", "select", "pen", "domani"]);
  });

  it("il predefinito accanto a «Azzera» dice la colonna di serie", async () => {
    await openPanel([toolbar(["pen"])]);
    const row = document.querySelector<HTMLElement>(`[data-setting-key="${TOOLBAR}"]`)!;
    expect(row.querySelector(".setting-default")?.textContent).toBe("Predefinito: Quelli di serie");
  });
});

describe("gli strumenti della colonna della lavagna nel pannello", () => {
  const CANVAS_TOOLBAR = "canvas.toolbar";
  const ALL_TOOLS = ["select", "hand", "pen", "highlighter", "eraser", "text", "connect"];
  const toolbar = (value: string[]): SettingEntry => ({
    spec: {
      key: CANVAS_TOOLBAR,
      label: "Strumenti della colonna",
      description: "",
      group: "Lavagna",
      scope: "vault",
      kind: { kind: "list", default: [] },
      program_writable: false,
    },
    value,
    source: value.length === 0 ? "default" : "vault",
  });
  const box = (tool: string): HTMLInputElement => document.getElementById(`setting-${CANVAS_TOOLBAR}-${tool}`) as HTMLInputElement;

  it("una casella per strumento della lavagna; cambiata una, la lista si scrive nel suo ordine", async () => {
    await openPanel([toolbar(["pen", "select"])]);
    expect(box("pen").checked).toBe(true);
    expect(box("hand").checked).toBe(false);
    const input = box("hand");
    input.focus();
    input.click();
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalled());
    expect(fake.setSetting).toHaveBeenLastCalledWith(CANVAS_TOOLBAR, ["pen", "select", "hand"]);
  });

  it("vuota, la colonna di serie: tutte le caselle accese", async () => {
    await openPanel([toolbar([])]);
    for (const tool of ALL_TOOLS) expect(box(tool).checked, tool).toBe(true);
  });

  it("il predefinito accanto a «Azzera» dice quelli di serie", async () => {
    await openPanel([toolbar(["pen"])]);
    const row = document.querySelector<HTMLElement>(`[data-setting-key="${CANVAS_TOOLBAR}"]`)!;
    expect(row.querySelector(".setting-default")?.textContent).toBe("Predefinito: Quelli di serie");
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

  const FIRST = "a.first";
  const SECOND = "b.second";
  const control = (key: string) => document.getElementById(`setting-${key}`) as HTMLInputElement;
  const stored = (key: string) =>
    fake.entries.find((candidate) => candidate.spec.key === key) as unknown as SettingEntry;
  const settled = (key: string) => control(key).closest(".setting-row")?.getAttribute("aria-busy") === null;

  /// L'osservatore `setting_changed` dell'ultimo pannello montato: è la stessa
  /// via del backend vero, che emette l'evento dopo ogni scrittura e per ogni
  /// cambio da fuori (un comando, un'altra finestra); il pannello rilegge e
  /// ricostruisce tutte le righe.
  function settingChanged(key: string): void {
    const call = [...vi.mocked(onEvent).mock.calls].reverse().find(([name]) => name === "setting_changed");
    expect(call, "il pannello ascolta setting_changed").toBeDefined();
    (call![1] as (event: { type: "setting_changed"; key: string; scope: "vault" }) => void)({
      type: "setting_changed",
      key,
      scope: "vault",
    });
  }

  async function openToggles(): Promise<HTMLInputElement> {
    fake.setSetting.mockImplementation(async (key: string, value: boolean) => {
      stored(key).value = value;
      stored(key).source = "vault";
    });
    await openPanel([toggleEntry(FIRST, false), toggleEntry(SECOND, false)]);
    const first = control(FIRST);
    expect(first.getAttribute("role")).toBe("switch");
    first.focus();
    expect(document.activeElement).toBe(first);
    return first;
  }

  it("Spazio (il click nativo della casella): il valore cambia e il fuoco resta", async () => {
    const first = await openToggles();
    first.click();
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith(FIRST, true));
    await vi.waitFor(() => expect(control(FIRST)).not.toBe(first));
    await vi.waitFor(() => expect(settled(FIRST)).toBe(true));
    expect(control(FIRST).checked).toBe(true);
    expect(document.activeElement).toBe(control(FIRST));
  });

  it("Invio sull'interruttore: lo commuta e il fuoco resta", async () => {
    const first = await openToggles();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith(FIRST, true));
    await vi.waitFor(() => expect(control(FIRST)).not.toBe(first));
    await vi.waitFor(() => expect(settled(FIRST)).toBe(true));
    expect(control(FIRST).checked).toBe(true);
    expect(document.activeElement).toBe(control(FIRST));
  });

  it("il valore salvato che torna dall'host con setting_changed ridisegna la riga e il fuoco resta", async () => {
    const first = await openToggles();
    stored(FIRST).value = true;
    stored(FIRST).source = "vault";
    settingChanged(FIRST);
    await vi.waitFor(() => expect(control(FIRST)).not.toBe(first));
    expect(control(FIRST).checked).toBe(true);
    expect(document.activeElement).toBe(control(FIRST));
  });

  it("un setting_changed per un'altra chiave ridisegna l'elenco e il fuoco resta", async () => {
    const first = await openToggles();
    stored(SECOND).value = true;
    settingChanged(SECOND);
    await vi.waitFor(() => expect(control(SECOND).checked).toBe(true));
    expect(control(FIRST)).not.toBe(first);
    expect(document.activeElement).toBe(control(FIRST));
  });

  it("Spazio e subito dopo il setting_changed della scrittura: il fuoco resta", async () => {
    const first = await openToggles();
    first.click();
    settingChanged(FIRST);
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith(FIRST, true));
    await vi.waitFor(() => expect(control(FIRST)).not.toBe(first));
    await vi.waitFor(() => expect(settled(FIRST)).toBe(true));
    expect(control(FIRST).checked).toBe(true);
    expect(document.activeElement).toBe(control(FIRST));
  });

  it("una scrittura rifiutata: l'esito sotto la riga, il valore autorevole e il fuoco sulla casella", async () => {
    const first = await openToggles();
    fake.setSetting.mockImplementation(async () => {
      throw new Error("disco pieno");
    });
    first.click();
    await vi.waitFor(() =>
      expect(control(FIRST).closest(".setting-row")?.querySelector(".setting-error")).not.toBeNull(),
    );
    expect(control(FIRST).checked).toBe(false);
    expect(document.activeElement).toBe(control(FIRST));
  });

  it("il fuoco fuori dal corpo non si sposta al ridisegno", async () => {
    await openToggles();
    const close = document.querySelector<HTMLButtonElement>("#settings-close")!;
    close.focus();
    settingChanged(SECOND);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(close);
  });
});

describe("la bozza di un campo sopravvive al ridisegno (#401)", () => {
  const DIARY = "journal.folder";
  const OTHER = "z.other";
  const SIZE = "editor.size";
  const control = (key: string) => document.getElementById(`setting-${key}`) as HTMLInputElement;
  const stored = (key: string) =>
    fake.entries.find((candidate) => candidate.spec.key === key) as unknown as SettingEntry;

  function entry(key: string, kind: SettingEntry["spec"]["kind"], value: SettingEntry["value"]): SettingEntry {
    return {
      spec: { key, label: key, description: "", group: "File", scope: "vault", kind, program_writable: false },
      value,
      source: "default",
    };
  }

  /// Come `settingChanged` qui sopra: la via del backend vero.
  function settingChanged(key: string): void {
    const call = [...vi.mocked(onEvent).mock.calls].reverse().find(([name]) => name === "setting_changed");
    expect(call, "il pannello ascolta setting_changed").toBeDefined();
    (call![1] as (event: { type: "setting_changed"; key: string; scope: "vault" }) => void)({
      type: "setting_changed",
      key,
      scope: "vault",
    });
  }

  /// Scrive come una persona: il valore cambia e parte `input`, ma niente
  /// `change` — il campo non è ancora uscito né ha avuto Invio.
  function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function openText(): Promise<HTMLInputElement> {
    fake.setSetting.mockImplementation(async (key: string, value: SettingEntry["value"]) => {
      stored(key).value = value;
      stored(key).source = "vault";
    });
    await openPanel([
      entry(DIARY, { kind: "text", default: "Diario" }, "Diario"),
      entry(OTHER, { kind: "toggle", default: false }, false),
    ]);
    const input = control(DIARY);
    input.focus();
    type(input, "Diario/2026");
    input.setSelectionRange(3, 5);
    return input;
  }

  it("un setting_changed di un'altra chiave non cancella il testo non salvato, e fuoco e selezione restano", async () => {
    const before = await openText();
    stored(OTHER).value = true;
    settingChanged(OTHER);
    await vi.waitFor(() => expect(control(OTHER).checked).toBe(true));
    const after = control(DIARY);
    expect(after).not.toBe(before);
    expect(after.value).toBe("Diario/2026");
    expect(document.activeElement).toBe(after);
    expect([after.selectionStart, after.selectionEnd]).toEqual([3, 5]);
    // La bozza resta bozza: nessuna scrittura partita da sola.
    expect(fake.setSetting).not.toHaveBeenCalled();
    expect(document.getElementById(`setting-${DIARY}-changed`)).toBeNull();
  });

  it("il change che Chromium manda al campo tolto col fuoco non salva la bozza da solo", async () => {
    const before = await openText();
    // Chromium, togliendo il campo che ha il fuoco, gli dà `blur` e `change`
    // mentre è ancora nel documento; happy-dom no, e qui lo si rifà.
    const body = document.getElementById("settings-body")!;
    const replace = body.replaceChildren.bind(body);
    body.replaceChildren = (...nodes: (Node | string)[]) => {
      // Una volta sola, al primo ridisegno: quello per l'altra chiave.
      body.replaceChildren = replace;
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement && body.contains(focused)) {
        focused.dispatchEvent(new Event("change", { bubbles: true }));
      }
      replace(...nodes);
    };
    settingChanged(OTHER);
    await vi.waitFor(() => expect(control(DIARY)).not.toBe(before));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.setSetting).not.toHaveBeenCalled();
    expect(control(DIARY).value).toBe("Diario/2026");
  });

  it("la bozza ripristinata si salva ancora uscendo dal campo, come prima del ridisegno", async () => {
    const before = await openText();
    settingChanged(OTHER);
    await vi.waitFor(() => expect(control(DIARY)).not.toBe(before));
    expect(document.activeElement).toBe(control(DIARY));
    control(DIARY).blur();
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith(DIARY, "Diario/2026"));
    expect(fake.setSetting).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(control(DIARY).closest(".setting-row")?.getAttribute("aria-busy")).toBeNull());
    expect(control(DIARY).value).toBe("Diario/2026");
  });

  it("la bozza ripristinata si salva con Invio", async () => {
    const before = await openText();
    settingChanged(OTHER);
    await vi.waitFor(() => expect(control(DIARY)).not.toBe(before));
    control(DIARY).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    control(DIARY).dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith(DIARY, "Diario/2026"));
    expect(fake.setSetting).toHaveBeenCalledTimes(1);
  });

  it("il valore salvato della sua chiave cambia da fuori: la bozza resta e una riga lo dice", async () => {
    const before = await openText();
    stored(DIARY).value = "Quaderno";
    stored(DIARY).source = "vault";
    settingChanged(DIARY);
    await vi.waitFor(() => expect(control(DIARY)).not.toBe(before));
    const after = control(DIARY);
    expect(after.value).toBe("Diario/2026");
    const note = document.getElementById(`setting-${DIARY}-changed`);
    expect(note?.textContent).toContain("cambiato altrove");
    expect(after.getAttribute("aria-describedby")?.split(" ")).toContain(note!.id);
    // Un ridisegno per un'altra chiave non fa sparire l'avviso: il salvato è
    // ancora diverso da quello da cui si era partiti.
    settingChanged(OTHER);
    await vi.waitFor(() => expect(control(DIARY)).not.toBe(after));
    expect(control(DIARY).value).toBe("Diario/2026");
    expect(document.getElementById(`setting-${DIARY}-changed`)).not.toBeNull();
    expect(fake.setSetting).not.toHaveBeenCalled();
  });

  it("una scrittura della riga rifiutata: torna il valore autorevole e l'input provato sta sotto", async () => {
    const before = await openText();
    fake.setSetting.mockImplementation(async () => {
      throw new Error("disco pieno");
    });
    before.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(control(DIARY).closest(".setting-row")?.querySelector(".setting-error")).not.toBeNull(),
    );
    expect(control(DIARY).value).toBe("Diario");
    expect(control(DIARY).closest(".setting-row")?.querySelector(".setting-attempted")?.textContent).toBe("Diario/2026");
  });

  it("il campo numerico accanto al cursore: la bozza resta e il cursore la segue", async () => {
    await openPanel([
      entry(SIZE, { kind: "number", default: 16, min: 10, max: 30 }, 16),
      entry(OTHER, { kind: "toggle", default: false }, false),
    ]);
    const number = control(SIZE);
    expect(number.type).toBe("number");
    number.focus();
    type(number, "22");
    settingChanged(OTHER);
    await vi.waitFor(() => expect(control(SIZE)).not.toBe(number));
    expect(control(SIZE).value).toBe("22");
    expect((document.getElementById(`setting-${SIZE}-range`) as HTMLInputElement).value).toBe("22");
    expect(document.activeElement).toBe(control(SIZE));
    expect(fake.setSetting).not.toHaveBeenCalled();
  });

  it("la cartella esclusa ancora da aggiungere resta nel campo anche senza fuoco", async () => {
    await openPanel([listEntry(EXCLUDED, ["node_modules"]), entry(OTHER, { kind: "toggle", default: false }, false)]);
    const input = control(EXCLUDED);
    type(input, "Bozze");
    settingChanged(OTHER);
    await vi.waitFor(() => expect(control(EXCLUDED)).not.toBe(input));
    expect(control(EXCLUDED).value).toBe("Bozze");
  });

  it("cambiando scheda la bozza non torna: la pagina di prima non c'è più", async () => {
    await openPanel([listEntry(EXCLUDED, ["node_modules"])]);
    type(control(EXCLUDED), "Bozze");
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    document.querySelector<HTMLButtonElement>("#open-settings")!.click();
    await vi.waitFor(() => expect(control(EXCLUDED)?.value).toBe(""));
  });
});
