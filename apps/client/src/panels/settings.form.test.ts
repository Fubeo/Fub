// @vitest-environment happy-dom
// Il form generico delle impostazioni: cosa mostra, come lo dice a chi non
// guarda lo schermo, e i due gesti che non sono una riga sola (la lingua e il
// ripristino di un gruppo).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../host/contract";

const fake = vi.hoisted(() => {
  const box = {
    entries: [] as SettingEntry[],
    setSetting: vi.fn(),
    resetSetting: vi.fn(),
    confirm: vi.fn(async () => true),
    readSettings: vi.fn(async (): Promise<SettingEntry[]> => []),
    frameCapabilities: vi.fn(async () => ({ system: true, custom: true })),
    settingRequiresReopen: vi.fn(async () => false),
  };
  box.readSettings.mockImplementation(async () => box.entries);
  return box;
});

vi.mock("../host/ipc", () => ({
  api: {
    setSetting: fake.setSetting,
    resetSetting: fake.resetSetting,
    settingsProfiles: async () => ({ active: "default", names: ["default"] }),
    knownVaults: async () => [],
    frameCapabilities: () => fake.frameCapabilities(),
    settingRequiresReopen: () => fake.settingRequiresReopen(),
  },
}));
vi.mock("../host/dialog", () => ({ confirm: fake.confirm, pickFile: vi.fn(), pickFolder: vi.fn() }));
vi.mock("../host/query", () => ({ settings: () => fake.readSettings() }));
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

function entry(
  key: string,
  kind: SettingEntry["spec"]["kind"],
  value: SettingEntry["value"],
  source: SettingEntry["source"] = "default",
  group = "Editor",
): SettingEntry {
  return {
    spec: {
      key,
      label: `etichetta ${key}`,
      description: `prosa ${key}`,
      group,
      scope: "machine",
      kind,
      program_writable: false,
    },
    value,
    source,
  };
}

const toggle = (key: string, value: boolean, source: SettingEntry["source"] = "default", group?: string) =>
  entry(key, { kind: "toggle", default: true }, value, source, group);

async function openPanel(entries: SettingEntry[]): Promise<void> {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  fake.entries = entries;
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button></div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await vi.waitFor(() => {
    expect(document.querySelector("#settings-body .setting-row")).not.toBeNull();
  });
}

/// La scocca intera, come in `index.html`: barra di ricerca, indice e corpo
/// dentro il contenitore che scorre.
async function openFullPanel(entries: SettingEntry[]): Promise<void> {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  fake.entries = entries;
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <button id="settings-close"></button>
      <div id="settings-tabs"><button data-tab="settings"></button><button data-tab="vault"></button></div>
      <nav id="settings-toc" hidden><ul id="settings-toc-list"></ul></nav>
      <div id="settings-toolbar" hidden>
        <span id="settings-search-icon"></span>
        <input id="settings-search" type="search" />
        <button id="settings-modified" type="button" aria-pressed="false"></button>
        <span id="settings-count" role="status"></span>
      </div>
      <div id="settings-scroll"><div id="settings-body"></div></div>
    </section>`;
  mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await vi.waitFor(() => {
    expect(document.querySelector("#settings-body .setting-row")).not.toBeNull();
  });
}

function search(text: string): void {
  const field = document.getElementById("settings-search") as HTMLInputElement;
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function visibleKeys(): string[] {
  return [...document.querySelectorAll<HTMLElement>("#settings-body [data-setting-key]")]
    .filter((row) => !row.hidden && !row.closest(".settings-section")?.hasAttribute("hidden"))
    .map((row) => row.dataset.settingKey!);
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.confirm.mockResolvedValue(true);
  fake.setSetting.mockImplementation(async (key: string, value: unknown) => {
    const found = fake.entries.find((candidate) => candidate.spec.key === key)!;
    found.value = value as SettingEntry["value"];
    found.source = "machine";
  });
  fake.resetSetting.mockImplementation(async (key: string) => {
    const found = fake.entries.find((candidate) => candidate.spec.key === key)!;
    found.value = (found.spec.kind as { default: SettingEntry["value"] }).default;
    found.source = "default";
  });
});

describe("il form generico", () => {
  it("non mostra le chiavi che hanno un gesto loro altrove", async () => {
    await openPanel([
      toggle("editor.spellcheck", true),
      entry("chrome.schema", { kind: "number", default: 1, min: 1, max: 1 }, 1),
      entry("plugins.disabled", { kind: "list", default: [] }, []),
      entry("properties.types", { kind: "text", default: "{}" }, "{}"),
      entry("appearance.theme-id", { kind: "text", default: "fub.serie" }, "fub.serie"),
    ]);
    const keys = [...document.querySelectorAll<HTMLElement>("[data-setting-key]")].map((el) => el.dataset.settingKey);
    expect(keys).toEqual(["editor.spellcheck"]);
  });

  it("il campo annuncia prosa e provenienza, non solo l'etichetta", async () => {
    await openPanel([toggle("editor.spellcheck", true)]);
    const input = document.getElementById("setting-editor.spellcheck")!;
    const ids = input.getAttribute("aria-describedby")!.split(" ");
    const texts = ids.map((id) => document.getElementById(id)?.textContent);
    expect(texts[0]).toBe("prosa editor.spellcheck");
    expect(texts[1]).toBeTruthy();
  });

  it("la lingua è una scelta fra le lingue della shell, e tiene visibile un valore scritto altrove", async () => {
    await openPanel([entry("locale.language", { kind: "text", default: "" }, "it-CH", "vault", "Lingua")]);
    const select = document.getElementById("setting-locale.language") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    const values = [...select.options].map((option) => option.value);
    expect(values).toEqual(["", "it", "en", "it-CH"]);
    expect(select.value).toBe("it-CH");
    select.value = "en";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith("locale.language", "en"));
  });

  it("«Ripristina gruppo» compare solo dove c'è qualcosa da ripristinare, e azzera solo quelle righe", async () => {
    await openPanel([
      toggle("editor.spellcheck", false, "machine"),
      toggle("editor.vim", true, "machine"),
      toggle("editor.line-wrap", true),
      toggle("history.enabled", true, "default", "Privacy"),
    ]);
    const titles = [...document.querySelectorAll<HTMLElement>("#settings-body > .settings-section > .settings-section-head")];
    // I profili chiudono la scheda come sezione loro, senza un ripristino di gruppo.
    expect(titles.map((title) => title.querySelector("h3")?.textContent)).toEqual(["Editor", "Privacy", "Profili"]);
    expect(titles[2]!.querySelector("button")).toBeNull();
    expect(titles[1]!.querySelector("button")).toBeNull();
    titles[0]!.querySelector("button")!.click();
    await vi.waitFor(() => expect(fake.resetSetting).toHaveBeenCalledTimes(2));
    expect(fake.resetSetting.mock.calls.map(([key]) => key)).toEqual(["editor.spellcheck", "editor.vim"]);
    await vi.waitFor(() => expect(document.querySelector("#settings-body .settings-section-head button")).toBeNull());
  });

  it("se l'utente ci ripensa, il gruppo resta com'era", async () => {
    fake.confirm.mockResolvedValue(false);
    await openPanel([toggle("editor.spellcheck", false, "machine")]);
    document.querySelector<HTMLButtonElement>("#settings-body .settings-section-head button")!.click();
    await vi.waitFor(() => expect(fake.confirm).toHaveBeenCalled());
    await Promise.resolve();
    expect(fake.resetSetting).not.toHaveBeenCalled();
  });
});

describe("la riga dice dove vale il valore, e a cosa riporta «Azzera»", () => {
  const density = (value: string, source: SettingEntry["source"]) => entry(
    "appearance.density",
    {
      kind: "choice",
      default: "comfortable",
      options: [
        { value: "compact", label: "Compatta" },
        { value: "comfortable", label: "Comoda" },
        { value: "relaxed", label: "Rilassata" },
      ],
    },
    value,
    source,
    "Aspetto",
  );

  it("una riga scelta porta il segno, il predefinito leggibile e «Azzera»", async () => {
    await openPanel([density("compact", "machine"), toggle("editor.spellcheck", true)]);
    const changed = document.querySelector<HTMLElement>('[data-setting-key="appearance.density"]')!;
    expect(changed.dataset.modified).toBe("true");
    expect(changed.querySelector(".setting-scope")?.getAttribute("data-scope")).toBe("machine");
    expect(changed.querySelector(".setting-default")?.textContent).toBe("Predefinito: Comoda");
    expect(changed.querySelector(".setting-reset")?.textContent).toBe("Azzera");
    const untouched = document.querySelector<HTMLElement>('[data-setting-key="editor.spellcheck"]')!;
    expect(untouched.dataset.modified).toBeUndefined();
    expect(untouched.querySelector(".setting-default")).toBeNull();
    expect(untouched.querySelector(".setting-reset")).toBeNull();
  });

  it("la pastiglia è per gli occhi; chi ascolta sente la frase intera dal campo", async () => {
    await openPanel([density("compact", "machine")]);
    const group = document.getElementById("setting-appearance.density")!;
    expect(document.querySelector(".setting-scope")?.getAttribute("aria-hidden")).toBe("true");
    const ids = group.getAttribute("aria-describedby")!.split(" ");
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain("scelto per questa macchina");
  });
});

describe("il controllo nasce dalla forma del dato", () => {
  it("un interruttore è uno switch, e si commuta anche con Invio", async () => {
    await openPanel([toggle("editor.spellcheck", true)]);
    const input = document.getElementById("setting-editor.spellcheck") as HTMLInputElement;
    expect(input.getAttribute("role")).toBe("switch");
    expect(input.checked).toBe(true);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith("editor.spellcheck", false));
  });

  it("il cursore ha un nome suo, lo stesso dell'etichetta della riga", async () => {
    await openPanel([entry("appearance.zoom", { kind: "number", default: 1, min: 0.5, max: 2 }, 1)]);
    const label = document.querySelector<HTMLLabelElement>('label[for="setting-appearance.zoom-range"]');
    expect(label?.textContent).toBe("etichetta appearance.zoom");
    expect((document.getElementById("setting-appearance.zoom-range") as HTMLInputElement).step).toBe("0.1");
  });

  it("una scelta breve è un segmentato nominato dall'etichetta, una lunga resta una tendina", async () => {
    const options = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `Voce ${i}` }));
    await openPanel([
      entry("editor.indent", { kind: "choice", default: "v0", options: options(3) }, "v1"),
      entry("appearance.frame-rate", { kind: "choice", default: "v0", options: options(6) }, "v0"),
    ]);
    const short = document.getElementById("setting-editor.indent")!;
    expect(short.getAttribute("role")).toBe("radiogroup");
    expect(document.getElementById(short.getAttribute("aria-labelledby")!)?.textContent).toBe("etichetta editor.indent");
    const radios = [...short.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    radios[2]!.click();
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith("editor.indent", "v2"));
    expect(document.getElementById("setting-appearance.frame-rate")?.tagName).toBe("SELECT");
  });

  it("dopo una scelta segmentata il fuoco resta sull'opzione, non su «Azzera»", async () => {
    const options = [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }];
    await openPanel([entry("editor.indent", { kind: "choice", default: "a", options }, "a")]);
    const b = document.querySelector<HTMLButtonElement>('#setting-editor\\.indent [data-choice="b"]')!;
    b.click();
    await vi.waitFor(() => expect(document.querySelector(".setting-reset")).not.toBeNull());
    await vi.waitFor(() => {
      const focused = document.activeElement as HTMLElement | null;
      expect(focused?.dataset.choice).toBe("b");
      expect(focused?.isConnected).toBe(true);
    });
  });

  it("un numero con un intervallo ha cursore e campo, e il cursore scrive solo al rilascio", async () => {
    await openPanel([entry("appearance.body", { kind: "number", default: 16, min: 12, max: 28 }, 16)]);
    const slider = document.getElementById("setting-appearance.body-range") as HTMLInputElement;
    const field = document.getElementById("setting-appearance.body") as HTMLInputElement;
    expect([slider.type, slider.min, slider.max, slider.step]).toEqual(["range", "12", "28", "1"]);
    expect(field.type).toBe("number");
    slider.value = "20";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(field.value).toBe("20");
    expect(fake.setSetting).not.toHaveBeenCalled();
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith("appearance.body", 20));
  });
});

describe("ricerca, filtro e indice", () => {
  const rows = () => [
    toggle("editor.spellcheck", true, "default", "Editor"),
    toggle("editor.vim", false, "machine", "Editor"),
    toggle("history.enabled", true, "default", "Privacy"),
  ];

  it("la ricerca nasconde righe e sezioni senza rileggere, e dice quante restano", async () => {
    await openFullPanel(rows());
    const reads = fake.readSettings.mock.calls.length;
    expect(document.getElementById("settings-toolbar")!.hidden).toBe(false);
    search("prosa editor.spell");
    expect(visibleKeys()).toEqual(["editor.spellcheck"]);
    expect(document.querySelector<HTMLElement>(".settings-section:nth-of-type(2)")!.hidden).toBe(true);
    expect(document.getElementById("settings-count")!.textContent).toBe("1 impostazione");
    expect(fake.readSettings.mock.calls.length).toBe(reads);
    search("");
    expect(visibleKeys()).toEqual(["editor.spellcheck", "editor.vim", "history.enabled"]);
    expect(document.getElementById("settings-count")!.textContent).toBe("");
  });

  it("senza risultati lo dice, e «Azzera ricerca» riporta tutto", async () => {
    await openFullPanel(rows());
    search("nessuna di queste");
    const empty = document.querySelector<HTMLElement>(".settings-empty")!;
    expect(empty.textContent).toContain("«nessuna di queste»");
    expect(document.getElementById("settings-toc")!.hidden).toBe(true);
    empty.querySelector("button")!.click();
    expect((document.getElementById("settings-search") as HTMLInputElement).value).toBe("");
    expect(document.querySelector(".settings-empty")).toBeNull();
    expect(visibleKeys()).toHaveLength(3);
  });

  it("«Solo modificate» lascia le righe con un valore scelto", async () => {
    await openFullPanel(rows());
    const filter = document.getElementById("settings-modified")!;
    filter.click();
    expect(filter.getAttribute("aria-pressed")).toBe("true");
    expect(visibleKeys()).toEqual(["editor.vim"]);
    filter.click();
    expect(visibleKeys()).toHaveLength(3);
  });

  it("la ricerca sopravvive a un ridisegno dopo una scrittura", async () => {
    await openFullPanel(rows());
    search("vim");
    const vim = document.getElementById("setting-editor.vim") as HTMLInputElement;
    vim.checked = true;
    vim.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith("editor.vim", true));
    await vi.waitFor(() => expect((document.getElementById("setting-editor.vim") as HTMLInputElement).checked).toBe(true));
    expect((document.getElementById("settings-search") as HTMLInputElement).value).toBe("vim");
    expect(visibleKeys()).toEqual(["editor.vim"]);
  });

  it("l'indice ha una voce per sezione, conta le modificate e porta il fuoco alla sezione", async () => {
    await openFullPanel(rows());
    const links = [...document.querySelectorAll<HTMLButtonElement>("#settings-toc-list button[data-target]")];
    expect(document.getElementById("settings-toc")!.hidden).toBe(false);
    expect(links.map((link) => link.querySelector(".settings-toc-name")?.textContent)).toEqual(["Editor", "Privacy", "Profili"]);
    expect(links[0]!.querySelector(".settings-toc-badge")?.textContent).toBe("1");
    expect(links[1]!.querySelector(".settings-toc-badge")).toBeNull();
    links[1]!.click();
    expect(document.activeElement?.textContent).toBe("Privacy");
    expect(links[1]!.getAttribute("aria-current")).toBe("true");
    expect(links[0]!.hasAttribute("aria-current")).toBe(false);
  });

  it("Mod+F dentro il pannello porta alla ricerca, senza lasciar passare il tasto", async () => {
    await openFullPanel(rows());
    const key = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    document.getElementById("setting-editor.vim")!.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("settings-search");
  });

  it("una riga azzerata sotto «Solo modificate» resta in vista finché il filtro non cambia", async () => {
    await openFullPanel(rows());
    document.getElementById("settings-modified")!.click();
    expect(visibleKeys()).toEqual(["editor.vim"]);
    document.querySelector<HTMLButtonElement>('[data-setting-key="editor.vim"] .setting-reset')!.click();
    await vi.waitFor(() => expect(fake.resetSetting).toHaveBeenCalledWith("editor.vim"));
    await vi.waitFor(() => expect(document.querySelector('[data-setting-key="editor.vim"] .setting-reset')).toBeNull());
    expect(visibleKeys()).toEqual(["editor.vim"]);
    document.getElementById("settings-modified")!.click();
    document.getElementById("settings-modified")!.click();
    expect(visibleKeys()).toEqual([]);
  });

  it("la barra sparisce dove non c'è niente da cercare", async () => {
    await openFullPanel(rows());
    document.querySelector<HTMLButtonElement>('button[data-tab="vault"]')!.click();
    await vi.waitFor(() => expect(document.getElementById("settings-toolbar")!.hidden).toBe(true));
  });
});

describe("la cornice della finestra", () => {
  const frame = (value: string) => entry(
    "chrome.frame",
    {
      kind: "choice",
      default: "custom",
      options: [{ value: "system", label: "Del sistema" }, { value: "custom", label: "Personalizzata" }],
    },
    value,
    "default",
    "Interfaccia",
  );

  it("una cornice che il sistema non offre non si sceglie, e le frecce la saltano", async () => {
    fake.frameCapabilities.mockResolvedValueOnce({ system: false, custom: true });
    fake.settingRequiresReopen.mockResolvedValueOnce(true);
    await openPanel([frame("custom")]);
    const radios = [...document.querySelectorAll<HTMLButtonElement>('#setting-chrome\\.frame [role="radio"]')];
    expect(radios.map((radio) => radio.disabled)).toEqual([true, false]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0]);
    const right = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    radios[1]!.dispatchEvent(right);
    expect(radios[1]!.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('[data-setting-key="chrome.frame"]')!.textContent).toContain("prossima apertura");
  });

  it("un ridisegno a scrittura in volo non riaccende le scelte della cornice", async () => {
    let finish!: () => void;
    fake.setSetting.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await openPanel([frame("custom"), toggle("editor.spellcheck", true)]);
    document.querySelector<HTMLButtonElement>('#setting-chrome\\.frame [data-choice="system"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-setting-key="chrome.frame"]')?.getAttribute("aria-busy")).toBe("true"));
    // Un'altra riga scrive e ridisegna tutto mentre la cornice è in volo.
    const other = document.getElementById("setting-editor.spellcheck") as HTMLInputElement;
    other.checked = false;
    other.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith("editor.spellcheck", false));
    await vi.waitFor(() => expect((document.getElementById("setting-editor.spellcheck") as HTMLInputElement).checked).toBe(false));
    const radios = [...document.querySelectorAll<HTMLButtonElement>('#setting-chrome\\.frame [role="radio"]')];
    expect(radios.map((radio) => radio.disabled)).toEqual([true, true]);
    finish();
  });

  it("se le capacità non si leggono, la scelta si ferma e lo dice", async () => {
    fake.frameCapabilities.mockRejectedValueOnce(new Error("finestra senza cornice nativa"));
    await openPanel([frame("custom")]);
    const group = document.getElementById("setting-chrome.frame")!;
    expect(group.getAttribute("aria-disabled")).toBe("true");
    expect([...group.querySelectorAll("button")].every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(document.querySelector('[data-setting-key="chrome.frame"]')!.textContent).toContain("finestra senza cornice nativa");
  });
});
