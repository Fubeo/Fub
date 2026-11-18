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
vi.mock("../ui/commands", () => ({ allCommands: () => [], commandOfKeybindingKey: () => null, keybindingKey: (id: string) => id, registerComponentRow: () => () => {} }));
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
import { THEME_KEY } from "../theme/theme";
import { CSS_SNIPPETS_KEY } from "../theme/snippets";
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

/// L'osservatore `setting_changed` dell'ultimo pannello montato: la via del
/// backend vero.
function settingChanged(key: string): void {
  const call = [...vi.mocked(onEvent).mock.calls].reverse().find(([name]) => name === "setting_changed");
  expect(call, "il pannello ascolta setting_changed").toBeDefined();
  (call![1] as (event: { type: "setting_changed"; key: string; scope: "machine" }) => void)({
    type: "setting_changed",
    key,
    scope: "machine",
  });
}

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
    // Al valore di serie la riga non ha metadati: niente pastiglia, niente
    // predefinito, niente «Azzera».
    expect(untouched.querySelector(".setting-meta")).toBeNull();
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
    expect([field.type, field.inputMode]).toEqual(["text", "decimal"]);
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

  it("la voce scelta nell'indice resta attiva finché non si scorre di suo; in fondo vince l'ultima (B-01)", async () => {
    await openFullPanel(rows());
    const links = [...document.querySelectorAll<HTMLButtonElement>("#settings-toc-list button[data-target]")];
    const scroll = document.getElementById("settings-scroll")!;
    const current = () => links.find((link) => link.getAttribute("aria-current") === "true")?.querySelector(".settings-toc-name")?.textContent;
    // La geometria che happy-dom non calcola: un corpo di 1000 px in una
    // finestra di 600, con le due ultime sezioni nell'ultimo schermo.
    let top = 0;
    Object.defineProperty(scroll, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = v; } });
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1000 });
    const offsets = new Map([["Editor", 0], ["Privacy", 700], ["Profili", 850]]);
    for (const section of document.querySelectorAll<HTMLElement>("#settings-body .settings-section")) {
      const name = section.querySelector(".settings-section-title")?.textContent ?? "";
      section.getBoundingClientRect = () => ({ top: (offsets.get(name) ?? 0) - top } as DOMRect);
    }
    // Il clic porta in fondo (Privacy non può salire in cima): resta Privacy.
    links[1]!.click();
    top = 400;
    scroll.dispatchEvent(new Event("scroll"));
    expect(current()).toBe("Privacy");
    // Chi scorre di suo riprende la voce dalla posizione: in fondo, l'ultima.
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    expect(current()).toBe("Profili");
    scroll.dispatchEvent(new Event("scroll"));
    expect(current()).toBe("Profili");
    top = 100;
    scroll.dispatchEvent(new Event("scroll"));
    expect(current()).toBe("Editor");
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

  it("una scelta della cornice in volo resta usabile, e un ridisegno intero non la riporta indietro", async () => {
    let finish!: () => void;
    fake.setSetting.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    fake.frameCapabilities.mockResolvedValue({ system: false, custom: true });
    await openPanel([frame("custom"), toggle("editor.spellcheck", true)]);
    fake.frameCapabilities.mockResolvedValue({ system: true, custom: true });
    // Riletto con le capacità di adesso, prima della scelta.
    settingChanged("");
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('#setting-chrome\\.frame [data-choice="system"]')!.disabled).toBe(false));
    const rowBefore = document.querySelector('[data-setting-key="chrome.frame"]');
    document.querySelector<HTMLButtonElement>('#setting-chrome\\.frame [data-choice="system"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-setting-key="chrome.frame"]')?.getAttribute("aria-busy")).toBe("true"));
    // Un ridisegno intero mentre la cornice è in volo: la riga in volo passa
    // com'è, con la scelta della persona, e resta usabile.
    settingChanged("");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[data-setting-key="chrome.frame"]')).toBe(rowBefore);
    const radios = [...document.querySelectorAll<HTMLButtonElement>('#setting-chrome\\.frame [role="radio"]')];
    expect(radios.map((radio) => radio.disabled)).toEqual([false, false]);
    expect(radios.find((radio) => radio.dataset.choice === "system")!.getAttribute("aria-checked")).toBe("true");
    finish();
    await vi.waitFor(() => expect(document.querySelector('[data-setting-key="chrome.frame"]')?.getAttribute("aria-busy")).toBeNull());
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

describe("un setting_changed con il pannello aperto rifà solo la riga che cambia", () => {
  const rowOf = (key: string) => document.querySelector<HTMLElement>(`#settings-body [data-setting-key="${key}"]`)!;
  const stored = (key: string) => fake.entries.find((candidate) => candidate.spec.key === key)!;
  const rows = () => [
    toggle("editor.spellcheck", true, "default", "Editor"),
    toggle("editor.vim", false, "machine", "Editor"),
    toggle("history.enabled", true, "default", "Privacy"),
  ];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  /// Quante volte la riga di `key` è stata ridisegnata da quando la si guarda:
  /// sostituita intera, o aggiornata sul posto (il suo testo rifatto).
  function countReplacements(key: string): () => number {
    let count = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const whole = node.dataset.settingKey === key || node.querySelector(`[data-setting-key="${key}"]`) !== null;
          const text = node.classList.contains("setting-text") &&
            (record.target as HTMLElement).dataset?.settingKey === key;
          if (whole || text) count++;
        }
      }
    });
    observer.observe(document.getElementById("settings-body")!, { childList: true, subtree: true });
    return () => {
      observer.takeRecords();
      return count;
    };
  }

  it("cambia solo la riga della chiave: le altre righe, le sezioni e l'indice restano gli stessi nodi", async () => {
    await openFullPanel(rows());
    const before = rowOf("editor.spellcheck");
    const control = document.getElementById("setting-editor.spellcheck");
    const vim = rowOf("editor.vim");
    const history = rowOf("history.enabled");
    const sections = [...document.querySelectorAll("#settings-body > .settings-section")];
    const links = [...document.querySelectorAll("#settings-toc-list li")];
    stored("editor.spellcheck").value = false;
    stored("editor.spellcheck").source = "machine";
    settingChanged("editor.spellcheck");
    await vi.waitFor(() => expect(document.getElementById("setting-editor.spellcheck")).not.toBe(control));
    expect((document.getElementById("setting-editor.spellcheck") as HTMLInputElement).checked).toBe(false);
    // La riga si aggiorna sul posto: è lo stesso nodo, col campo nuovo.
    expect(rowOf("editor.spellcheck")).toBe(before);
    expect(before.dataset.modified).toBe("true");
    expect(rowOf("editor.vim")).toBe(vim);
    expect(rowOf("history.enabled")).toBe(history);
    expect([...document.querySelectorAll("#settings-body > .settings-section")]).toEqual(sections);
    // Solo la voce dell'indice della sezione toccata si rifà.
    const linksAfter = [...document.querySelectorAll("#settings-toc-list li")];
    expect(linksAfter[1]).toBe(links[1]);
    expect(linksAfter[2]).toBe(links[2]);
  });

  it("una chiave che non cambia niente di ciò che si vede non tocca il corpo", async () => {
    await openFullPanel(rows());
    const replaced = countReplacements("editor.vim");
    const reads = fake.readSettings.mock.calls.length;
    settingChanged("editor.vim");
    await vi.waitFor(() => expect(fake.readSettings.mock.calls.length).toBe(reads + 1));
    await settle();
    expect(replaced()).toBe(0);
  });

  it("un evento senza chiave ridisegna tutto", async () => {
    await openFullPanel(rows());
    const vim = rowOf("editor.vim");
    settingChanged("");
    await vi.waitFor(() => expect(rowOf("editor.vim")).not.toBe(vim));
  });

  it("uno schema cambiato (una riga comparsa) ridisegna tutto", async () => {
    await openFullPanel(rows());
    const vim = rowOf("editor.vim");
    fake.entries = [...fake.entries, toggle("editor.minimap", true, "default", "Editor")];
    stored("editor.spellcheck").value = false;
    settingChanged("editor.spellcheck");
    await vi.waitFor(() => expect(rowOf("editor.minimap")).not.toBeNull());
    expect(rowOf("editor.vim")).not.toBe(vim);
  });

  for (const key of [THEME_KEY, CSS_SNIPPETS_KEY, "chrome.frame"]) {
    it(`${key} ridisegna tutto`, async () => {
      await openFullPanel(rows());
      const vim = rowOf("editor.vim");
      settingChanged(key);
      await vi.waitFor(() => expect(rowOf("editor.vim")).not.toBe(vim));
    });
  }

  it("la cornice cambiata da fuori ridisegna tutto anche quando l'evento è di un'altra chiave", async () => {
    const frame = entry(
      "chrome.frame",
      { kind: "choice", default: "custom", options: [{ value: "system", label: "Del sistema" }, { value: "custom", label: "Personalizzata" }] },
      "custom",
      "default",
      "Interfaccia",
    );
    await openFullPanel([...rows(), frame]);
    const vim = rowOf("editor.vim");
    stored("chrome.frame").value = "system";
    stored("editor.spellcheck").value = false;
    settingChanged("editor.spellcheck");
    await vi.waitFor(() => expect(rowOf("editor.vim")).not.toBe(vim));
  });

  it("il conto delle modificate, «Ripristina gruppo» e il numero dell'indice seguono la riga", async () => {
    await openFullPanel(rows());
    const editor = document.querySelector<HTMLElement>("#settings-body > .settings-section")!;
    const head = editor.querySelector(".settings-section-head")!;
    const badge = () => document.querySelector("#settings-toc-list button[data-target] .settings-toc-badge")?.textContent ?? null;
    expect(head.querySelector(".settings-section-meta")?.textContent).toBe("1 modificata");
    expect(badge()).toBe("1");

    stored("editor.spellcheck").value = false;
    stored("editor.spellcheck").source = "machine";
    settingChanged("editor.spellcheck");
    await vi.waitFor(() => expect(head.querySelector(".settings-section-meta")?.textContent).toBe("2 modificate"));
    expect(editor.dataset.modifiedCount).toBe("2");
    expect(badge()).toBe("2");
    expect(head.querySelectorAll(".settings-section-reset")).toHaveLength(1);
    // Il ripristino del gruppo azzera le righe modificate di adesso, non quelle
    // del disegno di prima.
    head.querySelector<HTMLButtonElement>(".settings-section-reset")!.click();
    await vi.waitFor(() => expect(fake.resetSetting).toHaveBeenCalledTimes(2));
    expect(fake.resetSetting.mock.calls.map(([key]) => key)).toEqual(["editor.spellcheck", "editor.vim"]);
    await vi.waitFor(() => expect(document.querySelector("#settings-body .settings-section-reset")).toBeNull());

    // Di nuovo una riga diversa dal predefinito, e poi nessuna: conto, pulsante
    // e numero spariscono con l'ultima.
    stored("editor.vim").value = true;
    stored("editor.vim").source = "machine";
    settingChanged("editor.vim");
    const section = () => document.querySelector<HTMLElement>("#settings-body > .settings-section")!;
    await vi.waitFor(() => expect(section().querySelector(".settings-section-meta")?.textContent).toBe("1 modificata"));
    expect(badge()).toBe("1");
    stored("editor.vim").value = false;
    stored("editor.vim").source = "default";
    settingChanged("editor.vim");
    await vi.waitFor(() => expect(section().querySelector(".settings-section-meta")).toBeNull());
    expect(section().dataset.modifiedCount).toBeUndefined();
    expect(section().querySelector(".settings-section-reset")).toBeNull();
    expect(badge()).toBeNull();
  });

  it("una scrittura da riga produce un solo aggiornamento, anche col suo setting_changed in mezzo", async () => {
    await openFullPanel(rows());
    // Come l'host vero: la scrittura emette l'evento della sua chiave.
    fake.setSetting.mockImplementation(async (key: string, value: unknown) => {
      stored(key).value = value as SettingEntry["value"];
      stored(key).source = "machine";
      settingChanged(key);
    });
    const replaced = countReplacements("editor.spellcheck");
    const vim = rowOf("editor.vim");
    const reads = fake.readSettings.mock.calls.length;
    const input = document.getElementById("setting-editor.spellcheck") as HTMLInputElement;
    input.checked = false;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(rowOf("editor.spellcheck").getAttribute("aria-busy")).toBeNull());
    await vi.waitFor(() => expect((document.getElementById("setting-editor.spellcheck") as HTMLInputElement).checked).toBe(false));
    await settle();
    expect(fake.readSettings.mock.calls.length).toBe(reads + 1);
    expect(replaced()).toBe(1);
    expect(rowOf("editor.vim")).toBe(vim);
    // L'evento che arriva dopo l'esito (l'ordine non è garantito) rilegge, ma
    // non trova niente da rifare.
    settingChanged("editor.spellcheck");
    await vi.waitFor(() => expect(fake.readSettings.mock.calls.length).toBe(reads + 2));
    await settle();
    expect(replaced()).toBe(1);
  });
});

describe("una riga in volo resta usabile, e l'ultima scrittura vince (A03)", () => {
  const SIZE = "editor.size";
  const size = (value: number) => entry(SIZE, { kind: "number", default: 16, min: 10, max: 30 }, value);
  const field = () => document.getElementById(`setting-${SIZE}`) as HTMLInputElement;
  const rowOf = (key: string) => document.querySelector<HTMLElement>(`#settings-body [data-setting-key="${key}"]`)!;
  const stored = (key: string) => fake.entries.find((candidate) => candidate.spec.key === key)!;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  function writeNumber(value: number): void {
    const input = field();
    input.value = String(value);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /// Le scritture che l'host riceve, ciascuna da sbloccare a mano.
  function heldWrites(): { calls: unknown[]; release: (index: number, error?: Error) => void } {
    const pending: { resolve: () => void; reject: (e: Error) => void }[] = [];
    const calls: unknown[] = [];
    fake.setSetting.mockImplementation((key: string, value: unknown) => {
      calls.push(value);
      return new Promise<void>((resolve, reject) => {
        pending.push({
          resolve: () => {
            stored(key).value = value as SettingEntry["value"];
            stored(key).source = "machine";
            resolve();
          },
          reject,
        });
      });
    });
    return {
      calls,
      release: (index, error) => (error ? pending[index]!.reject(error) : pending[index]!.resolve()),
    };
  }

  it("il controllo col fuoco resta acceso e col fuoco mentre la scrittura è in volo", async () => {
    await openPanel([toggle("editor.spellcheck", true)]);
    const writes = heldWrites();
    const input = document.getElementById("setting-editor.spellcheck") as HTMLInputElement;
    input.focus();
    input.click();
    await vi.waitFor(() => expect(rowOf("editor.spellcheck").getAttribute("aria-busy")).toBe("true"));
    expect(rowOf("editor.spellcheck").querySelector('[role="status"]')?.textContent).toBeTruthy();
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    writes.release(0);
    await vi.waitFor(() => expect(rowOf("editor.spellcheck").getAttribute("aria-busy")).toBeNull());
    expect((document.getElementById("setting-editor.spellcheck") as HTMLInputElement).checked).toBe(false);
    expect(document.activeElement).toBe(document.getElementById("setting-editor.spellcheck"));
  });

  it("due scritture rapide mentre una è in volo: parte solo l'ultima, dopo, e vince", async () => {
    await openPanel([size(16)]);
    const writes = heldWrites();
    writeNumber(20);
    await vi.waitFor(() => expect(writes.calls).toEqual([20]));
    writeNumber(21);
    writeNumber(22);
    await settle();
    // In fila, non insieme: la seconda aspetta la prima.
    expect(writes.calls).toEqual([20]);
    writes.release(0);
    await vi.waitFor(() => expect(writes.calls).toEqual([20, 22]));
    expect(rowOf(SIZE).getAttribute("aria-busy")).toBe("true");
    writes.release(1);
    await vi.waitFor(() => expect(rowOf(SIZE).getAttribute("aria-busy")).toBeNull());
    expect(stored(SIZE).value).toBe(22);
    expect(field().value).toBe("22");
    expect(rowOf(SIZE).querySelector(".setting-error")).toBeNull();
  });

  it("se l'ultima della fila non va, torna il valore salvato e la riga lo dice", async () => {
    await openPanel([size(16)]);
    const writes = heldWrites();
    writeNumber(20);
    await vi.waitFor(() => expect(writes.calls).toEqual([20]));
    writeNumber(22);
    await settle();
    // La seconda aspetta la prima: non c'è una scrittura vecchia che arrivi
    // dopo quella nuova.
    expect(writes.calls).toEqual([20]);
    writes.release(0);
    await vi.waitFor(() => expect(writes.calls).toEqual([20, 22]));
    writes.release(1, new Error("disco pieno"));
    await vi.waitFor(() => expect(rowOf(SIZE).querySelector(".setting-error")).not.toBeNull());
    const error = rowOf(SIZE).querySelector(".setting-error")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("disco pieno");
    expect(error.querySelector(".setting-attempted")?.textContent).toBe("22");
    // Il valore autorevole: quello della scrittura che è andata.
    expect(field().value).toBe("20");
    expect(rowOf(SIZE).getAttribute("aria-busy")).toBeNull();
  });

  it("una scrittura superata che non va non conta: vale l'esito dell'ultima", async () => {
    await openPanel([size(16)]);
    const writes = heldWrites();
    writeNumber(20);
    await vi.waitFor(() => expect(writes.calls).toEqual([20]));
    writeNumber(22);
    writes.release(0, new Error("disco pieno"));
    await vi.waitFor(() => expect(writes.calls).toEqual([20, 22]));
    writes.release(1);
    await vi.waitFor(() => expect(rowOf(SIZE).getAttribute("aria-busy")).toBeNull());
    expect(rowOf(SIZE).querySelector(".setting-error")).toBeNull();
    expect(field().value).toBe("22");
  });
});

describe("il perché delle animazioni ridotte di partenza", () => {
  const motion = (byDefault: string, value: string, source: SettingEntry["source"] = "default") => entry(
    "appearance.motion",
    {
      kind: "choice",
      default: byDefault,
      options: [
        { value: "", label: "Come il sistema" },
        { value: "calm", label: "Calme" },
        { value: "reduced", label: "Ridotte" },
      ],
    },
    value,
    source,
    "Aspetto",
  );
  const rowOf = () => document.querySelector('[data-setting-key="appearance.motion"]')!;
  const why = "Su questo sistema partono ridotte";

  it("dove l'host parte da «ridotte» la riga dice perché, e il campo lo annuncia", async () => {
    await openPanel([motion("reduced", "reduced")]);
    const note = document.getElementById("setting-appearance.motion-default-why")!;
    expect(note.textContent).toContain(why);
    expect(note.textContent).toContain("WebKitGTK");
    expect(rowOf().contains(note)).toBe(true);
    const control = document.getElementById("setting-appearance.motion")!;
    expect(control.getAttribute("aria-describedby")!.split(" ")).toContain(note.id);
  });

  it("la nota resta anche dopo una scelta, perché spiega il valore di partenza", async () => {
    await openPanel([motion("reduced", "", "machine")]);
    expect(rowOf().textContent).toContain(why);
  });

  it("la nota resta quando la riga si aggiorna sul posto a un setting_changed", async () => {
    await openFullPanel([motion("reduced", "reduced"), toggle("editor.vim", false, "default", "Editor")]);
    const before = rowOf();
    const control = document.getElementById("setting-appearance.motion");
    const stored = fake.entries.find((candidate) => candidate.spec.key === "appearance.motion")!;
    stored.value = "calm";
    stored.source = "machine";
    settingChanged("appearance.motion");
    await vi.waitFor(() => expect(document.getElementById("setting-appearance.motion")).not.toBe(control));
    // La via per riga, non il ridisegno intero: la riga è lo stesso nodo.
    expect(rowOf()).toBe(before);
    const note = document.getElementById("setting-appearance.motion-default-why")!;
    expect(note.textContent).toContain(why);
    expect(rowOf().contains(note)).toBe(true);
    const fresh = document.getElementById("setting-appearance.motion")!;
    expect(fresh.getAttribute("aria-describedby")!.split(" ")).toContain(note.id);
  });

  it("dove si parte dal sistema la nota non c'è", async () => {
    await openPanel([motion("", "")]);
    expect(rowOf().textContent).not.toContain(why);
    expect(document.getElementById("setting-appearance.motion-default-why")).toBeNull();
  });
});

describe("un numero si scrive com'è, o la riga dice perché no (IMP-019…022)", () => {
  const KEEP = "backup.keep";
  const keep = (value: number) => entry(KEEP, { kind: "number", default: 10, min: 0, max: null }, value, "machine");
  const field = () => document.getElementById(`setting-${KEEP}`) as HTMLInputElement;
  const rowOf = () => document.querySelector<HTMLElement>(`#settings-body [data-setting-key="${KEEP}"]`)!;

  function typeAndConfirm(text: string): void {
    const input = field();
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("«1,5» è uno e mezzo, come «1.5»: mai quindici", async () => {
    await openPanel([keep(5)]);
    typeAndConfirm("1,5");
    await vi.waitFor(() => expect(fake.setSetting).toHaveBeenCalledWith(KEEP, 1.5));
    expect(fake.setSetting).not.toHaveBeenCalledWith(KEEP, 15);
    await vi.waitFor(() => expect(field().value).toBe("1.5"));
    expect(rowOf().querySelector(".setting-error")).toBeNull();
  });

  it.each([
    ["", "scrivi un numero"],
    ["abc", "non è un numero"],
    ["1e400", "troppo grande"],
    ["99999999999999999999", "troppe cifre"],
    ["1.500", "migliaia"],
    ["-7", "il valore più piccolo ammesso è 0"],
  ])("«%s» non si scrive: il campo torna al salvato e la riga dice perché", async (typed, why) => {
    await openPanel([keep(5)]);
    typeAndConfirm(typed);
    await vi.waitFor(() => expect(rowOf().querySelector(".setting-error")).not.toBeNull());
    expect(fake.setSetting).not.toHaveBeenCalled();
    const error = rowOf().querySelector(".setting-error")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.querySelector(".setting-error-message")?.textContent).toContain(why);
    if (typed !== "") expect(error.querySelector(".setting-attempted")?.textContent).toBe(typed);
    // Il valore che vale, non un campo vuoto che sembra non avere valore.
    expect(field().value).toBe("5");
    expect(fake.entries[0]!.value).toBe(5);
  });

  it("tornare a scrivere toglie il motivo del tentativo di prima (IMP-022)", async () => {
    await openPanel([keep(5)]);
    typeAndConfirm("-7");
    await vi.waitFor(() => expect(rowOf().querySelector(".setting-error")).not.toBeNull());
    const input = field();
    input.value = "abc";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(rowOf().querySelector(".setting-error")).toBeNull();
    // E «abc» confermato ha il suo motivo, non quello di -7.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(rowOf().querySelector(".setting-error")).not.toBeNull());
    expect(rowOf().querySelector(".setting-error-message")?.textContent).toContain("non è un numero");
    expect(rowOf().querySelector(".setting-error-message")?.textContent).not.toContain("più piccolo");
  });
});
