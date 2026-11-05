// @vitest-environment happy-dom
// Ciò che lo Scrittoio aggiunge alle preferenze, provato sopra la vista vera
// (`panels/settings.ts`): è lei che riscrive il corpo, scrive i valori e
// rimette il fuoco, ed è con lei che questi pezzi devono reggere.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../../host/contract";

const fake = vi.hoisted(() => {
  const box = {
    entries: [] as SettingEntry[],
    setSetting: vi.fn(),
    resetSetting: vi.fn(),
    // Come il kernel vero: più ascoltatori per lo stesso evento (il pannello e
    // la sua pagina «Componenti» ascoltano entrambi `setting_changed`).
    listeners: new Map<string, Set<(event: { key?: string }) => void>>(),
  };
  return box;
});

vi.mock("../../../host/ipc", () => ({
  api: {
    setSetting: fake.setSetting,
    resetSetting: fake.resetSetting,
    settingsProfiles: async () => ({ active: "default", names: ["default"] }),
    knownVaults: async () => [],
    frameCapabilities: async () => ({ system: true, custom: true }),
    settingRequiresReopen: async () => false,
  },
}));
vi.mock("../../../host/dialog", () => ({ confirm: vi.fn(async () => true), pickFile: vi.fn(), pickFolder: vi.fn() }));
vi.mock("../../../platform/confirm", () => ({ confirm: vi.fn(async () => true) }));
vi.mock("../../../host/query", () => ({ settings: async () => fake.entries }));
vi.mock("../../../state/kernel", () => ({
  onEvent: (type: string, listener: (event: { key?: string }) => void) => {
    const set = fake.listeners.get(type) ?? new Set();
    set.add(listener);
    fake.listeners.set(type, set);
    return () => {
      set.delete(listener);
    };
  },
}));
vi.mock("../../../ui/commands", () => ({ allCommands: () => [], keybindingKey: (id: string) => id }));
vi.mock("../../../ui/permissions", () => ({ TRUST_LABELS: {}, isPermissionKey: () => false, rows: () => [] }));
vi.mock("../../../ui/a11y", () => ({ trapFocus: () => () => {} }));
vi.mock("../../../ui/motion", () => ({
  enterSurface: () => {},
  exitSurface: (_el: HTMLElement, done: () => void) => done(),
}));
vi.mock("../../../ui/tooltip", () => ({
  setTooltip: (el: HTMLElement, text: string) => {
    el.dataset.tip = text;
  },
}));
vi.mock("../../../ui/notify", () => ({ notify: vi.fn() }));

import { mountSettings } from "../../../panels/settings";
import { SCRITTOIO_SERIES } from "../../../theme/scrittoio/series";
import { declareThemeSeries } from "../../../theme/theme";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { mountPreferences } from "./index";

const SPACE = "chrome.compactness";
const ACCENT = "appearance.accent";

function entry(
  key: string,
  kind: SettingEntry["spec"]["kind"],
  value: SettingEntry["value"],
  source: SettingEntry["source"] = "default",
): SettingEntry {
  return {
    spec: { key, label: `etichetta ${key}`, description: `prosa ${key}`, group: "Aspetto", scope: "machine", kind, program_writable: false },
    value,
    source,
  };
}

function entries(): SettingEntry[] {
  return [
    entry("appearance.theme", { kind: "choice", default: "", options: [{ value: "", label: "Sistema" }, { value: "light", label: "Chiaro" }] }, ""),
    entry(ACCENT, { kind: "number", default: 265, min: 0, max: 360 }, 265),
    entry(SPACE, { kind: "number", default: 0, min: 0, max: 4 }, 0),
    entry("appearance.body", { kind: "number", default: 16, min: 12, max: 28 }, 16),
  ];
}

// happy-dom tiene la callback di un MutationObserver soltanto con un `WeakRef`:
// alla prima raccolta l'osservatore tace, senza errori, e i pezzi smettono di
// seguire la vista a metà del file. Per questo file un riferimento debole è
// forte: l'osservatore vive finché lo si scollega, come in un browser.
const realWeakRef = globalThis.WeakRef;
beforeAll(() => {
  class Held<T extends object> {
    readonly #value: T;
    constructor(value: T) {
      this.#value = value;
    }
    deref(): T {
      return this.#value;
    }
  }
  (globalThis as { WeakRef: unknown }).WeakRef = Held;
});
afterAll(() => {
  globalThis.WeakRef = realWeakRef;
});

let lifetime: Lifetime;
let teardownView: () => void = () => {};
let restoreSeries: () => void = () => {};

async function settled(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function openPanel(list: SettingEntry[] = entries()): Promise<void> {
  fake.entries = list;
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" class="settings-panel" hidden>
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
  teardownView = mountSettings({ openVault: async () => {}, reloadProvider: async () => {} }) ?? (() => {});
  lifetime = openLifetime();
  mountPreferences(lifetime);
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await vi.waitFor(() => {
    expect(document.querySelector("#settings-body .setting-row")).not.toBeNull();
  });
  await settled();
}

const row = (key: string): HTMLElement => document.querySelector<HTMLElement>(`.setting-row[data-setting-key="${key}"]`)!;
const native = (key: string): HTMLInputElement => document.getElementById(`setting-${key}`) as HTMLInputElement;
const step = (n: number): HTMLButtonElement => document.getElementById(`prefs-space-step-${n}`) as HTMLButtonElement;
const swatch = (id: string): HTMLButtonElement => document.getElementById(`prefs-accent-${id}`) as HTMLButtonElement;
const checkedIn = (selector: string): string[] =>
  [...document.querySelectorAll(`${selector} [role="radio"][aria-checked="true"]`)].map((radio) => radio.id);

function press(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

/// Un valore cambiato da fuori (il menu Vista, il lanciatore, un'altra finestra).
async function changedOutside(key: string, value: SettingEntry["value"]): Promise<void> {
  const found = fake.entries.find((candidate) => candidate.spec.key === key)!;
  found.value = value;
  found.source = "machine";
  for (const listener of fake.listeners.get("setting_changed") ?? []) listener({ key });
  await settled();
}

beforeEach(() => {
  vi.clearAllMocks();
  restoreSeries = declareThemeSeries(SCRITTOIO_SERIES);
  document.documentElement.dataset.theme = "light";
  fake.setSetting.mockImplementation(async (key: string, value: unknown) => {
    const found = fake.entries.find((candidate) => candidate.spec.key === key)!;
    found.value = value as SettingEntry["value"];
    found.source = "machine";
  });
  fake.resetSetting.mockImplementation(async (key: string) => {
    const found = fake.entries.find((candidate) => candidate.spec.key === key)!;
    if (found.spec.kind.kind === "number") found.value = found.spec.kind.default;
    found.source = "default";
  });
});

afterEach(() => {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  lifetime.close();
  teardownView();
  restoreSeries();
});

describe("lo spazio dell'interfaccia", () => {
  it("prende il posto del controllo generico: cinque passi in un gruppo di scelta", async () => {
    await openPanel();
    const group = row(SPACE).querySelector<HTMLElement>(".prefs-space-steps")!;
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(group.getAttribute("aria-label")).toBe(`etichetta ${SPACE}`);
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(5);
    expect(checkedIn(".prefs-space")).toEqual(["prefs-space-step-0"]);
    // Una sola fermata nel Tab.
    expect([0, 1, 2, 3, 4].map((n) => step(n).tabIndex)).toEqual([0, -1, -1, -1, -1]);
    // Il controllo generico resta nella riga, nascosto: è la strada per scrivere.
    expect(native(SPACE).closest<HTMLElement>(".setting-range")!.hidden).toBe(true);
    expect(row(SPACE).querySelector(".prefs-space")!.previousElementSibling).toBe(native(SPACE).closest(".setting-range"));
    // Le altre righe numeriche tengono il loro.
    expect(native("appearance.body").closest<HTMLElement>(".setting-range")!.hidden).toBe(false);
  });

  it("ogni passo ha un nome che dice anche dov'è, e gli estremi sono detti", async () => {
    await openPanel();
    expect(step(0).getAttribute("aria-label")).toBe("Ampia, passo 1 di 5");
    expect(step(4).getAttribute("aria-label")).toBe("Minima, passo 5 di 5");
    expect(step(2).dataset.tip).toBe("Media");
    expect([...row(SPACE).querySelectorAll(".prefs-space-end")].map((end) => end.textContent)).toEqual(["Più interfaccia", "Più foglio"]);
    // Ogni passo ha la sua figura, e il foglio dentro è lo stesso nodo per tutti.
    expect(row(SPACE).querySelectorAll(".prefs-space-figure .prefs-space-sheet")).toHaveLength(5);
  });

  it("un clic scrive il passo dalla strada della riga, e la scelta resta dov'è", async () => {
    await openPanel();
    const control = row(SPACE).querySelector(".prefs-space")!;
    step(3).click();
    await settled();
    expect(fake.setSetting).toHaveBeenCalledTimes(1);
    expect(fake.setSetting).toHaveBeenCalledWith(SPACE, 3);
    expect(checkedIn(".prefs-space")).toEqual(["prefs-space-step-3"]);
    // La vista ha riscritto la riga: il controllo è lo stesso nodo, in quella nuova.
    expect(row(SPACE).querySelector(".prefs-space")).toBe(control);
    expect(row(SPACE).dataset.modified).toBe("true");
    expect(document.activeElement).toBe(step(3));
  });

  it("le frecce spostano la scelta e scrivono, col fuoco che resta sul passo", async () => {
    await openPanel();
    step(0).focus();
    press(step(0), "ArrowRight");
    await settled();
    expect(fake.setSetting).toHaveBeenLastCalledWith(SPACE, 1);
    expect(document.activeElement).toBe(step(1));
    press(step(1), "End");
    await settled();
    expect(fake.setSetting).toHaveBeenLastCalledWith(SPACE, 4);
    expect(document.activeElement).toBe(step(4));
    expect([0, 1, 2, 3, 4].map((n) => step(n).tabIndex)).toEqual([-1, -1, -1, -1, 0]);
  });

  it("segue un valore cambiato da fuori", async () => {
    await openPanel();
    await changedOutside(SPACE, 2);
    expect(checkedIn(".prefs-space")).toEqual(["prefs-space-step-2"]);
    expect(fake.setSetting).not.toHaveBeenCalled();
  });

  it("il predefinito è detto col nome del passo, e «azzera» è quello della vista", async () => {
    await openPanel();
    step(2).click();
    await settled();
    expect(row(SPACE).querySelector(".setting-default")?.textContent).toBe("Predefinito: Ampia");
    row(SPACE).querySelector<HTMLButtonElement>(".setting-reset")!.click();
    await settled();
    expect(fake.resetSetting).toHaveBeenCalledWith(SPACE);
    expect(checkedIn(".prefs-space")).toEqual(["prefs-space-step-0"]);
  });

  it("una scrittura rifiutata lo dice sotto il controllo, e la scelta torna al valore vero", async () => {
    await openPanel();
    fake.setSetting.mockRejectedValueOnce(new Error("disco pieno"));
    step(4).click();
    await settled();
    const error = row(SPACE).querySelector<HTMLElement>(".setting-error")!;
    expect(error.parentElement?.className).toBe("setting-control");
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("disco pieno");
    expect(checkedIn(".prefs-space")).toEqual(["prefs-space-step-0"]);
    expect(step(0).disabled).toBe(false);
  });

  it("mentre la scrittura è in volo i passi sono spenti, e poi tornano", async () => {
    await openPanel();
    let release: () => void = () => {};
    fake.setSetting.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    step(1).click();
    await settled();
    expect(row(SPACE).getAttribute("aria-busy")).toBe("true");
    expect([0, 1, 2, 3, 4].every((n) => step(n).disabled)).toBe(true);
    release();
    await settled();
    expect([0, 1, 2, 3, 4].some((n) => step(n).disabled)).toBe(false);
  });

  it("un clic sul nome della riga porta al passo scelto", async () => {
    await openPanel();
    await changedOutside(SPACE, 3);
    row(SPACE).querySelector<HTMLLabelElement>(".setting-text > label")!.click();
    expect(document.activeElement).toBe(step(3));
  });

  it("non riscrive niente quando niente è cambiato", async () => {
    await openPanel();
    const seen: MutationRecord[] = [];
    const observer = new MutationObserver((records) => seen.push(...records));
    observer.observe(document.getElementById("settings-panel")!, { childList: true, characterData: true, attributes: true, subtree: true });
    // Un colpo a vuoto: l'osservatore del corpo si sveglia e ogni pezzo ripassa.
    document.getElementById("settings-body")!.append(document.createComment("x"));
    await settled();
    observer.disconnect();
    expect(seen.filter((record) => record.addedNodes[0]?.nodeType !== Node.COMMENT_NODE)).toEqual([]);
  });
});

describe("l'accento", () => {
  it("sette campioni e la tinta su misura, in un gruppo di scelta", async () => {
    await openPanel();
    const group = row(ACCENT).querySelector<HTMLElement>(".prefs-accent-swatches")!;
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect([...group.querySelectorAll<HTMLElement>('[role="radio"]')].map((radio) => radio.dataset.accent)).toEqual([
      "matita-blu", "viola", "prugna", "terracotta", "ocra", "salvia", "petrolio", "custom",
    ]);
    expect(swatch("ocra").getAttribute("aria-label")).toBe("Ocra");
    expect(swatch("custom").getAttribute("aria-label")).toBe("Su misura");
    // Ogni campione porta il colore che l'accento avrebbe, e un segno per la scelta.
    expect(swatch("ocra").style.getPropertyValue("--prefs-swatch")).toMatch(/^#[0-9a-f]{6}$/);
    expect(swatch("ocra").style.getPropertyValue("--prefs-swatch")).not.toBe(swatch("viola").style.getPropertyValue("--prefs-swatch"));
    expect(swatch("ocra").querySelector(".prefs-swatch-mark")).not.toBeNull();
    expect(native(ACCENT).closest<HTMLElement>(".setting-range")!.hidden).toBe(true);
  });

  it("mai scelto: vale il predefinito, che l'host e la serie dichiarano uguale", async () => {
    await openPanel();
    expect(native(ACCENT).value).toBe("265");
    expect(checkedIn(".prefs-accent")).toEqual(["prefs-accent-matita-blu"]);
  });

  it("scelto: il campione con quella tinta", async () => {
    const list = entries();
    list[1] = entry(ACCENT, { kind: "number", default: 265, min: 0, max: 360 }, 130, "machine");
    await openPanel(list);
    expect(checkedIn(".prefs-accent")).toEqual(["prefs-accent-salvia"]);
    expect(row(ACCENT).querySelector(".setting-default")?.textContent).toBe("Predefinito: Matita blu");
  });

  it("un campione scrive la sua tinta nella stessa chiave, come numero", async () => {
    await openPanel();
    swatch("terracotta").click();
    await settled();
    expect(fake.setSetting).toHaveBeenCalledTimes(1);
    expect(fake.setSetting).toHaveBeenCalledWith(ACCENT, 55);
    expect(checkedIn(".prefs-accent")).toEqual(["prefs-accent-terracotta"]);
    expect(document.activeElement).toBe(swatch("terracotta"));
    expect(row(ACCENT).querySelector<HTMLElement>(".prefs-accent-custom")!.hidden).toBe(true);
  });

  it("le frecce passano da un campione all'altro", async () => {
    await openPanel();
    swatch("matita-blu").focus();
    press(swatch("matita-blu"), "ArrowRight");
    await settled();
    expect(fake.setSetting).toHaveBeenLastCalledWith(ACCENT, 300);
    expect(document.activeElement).toBe(swatch("viola"));
  });

  it("una tinta che non è di nessun campione è «su misura», col cursore sulla tinta", async () => {
    const list = entries();
    list[1] = entry(ACCENT, { kind: "number", default: 265, min: 0, max: 360 }, 172, "machine");
    await openPanel(list);
    expect(checkedIn(".prefs-accent")).toEqual(["prefs-accent-custom"]);
    const custom = row(ACCENT).querySelector<HTMLElement>(".prefs-accent-custom")!;
    expect(custom.hidden).toBe(false);
    const slider = document.getElementById("prefs-accent-hue") as HTMLInputElement;
    expect(slider.value).toBe("172");
    expect(custom.querySelector(".prefs-hue-value")?.textContent).toBe("172°");
    expect(document.querySelector<HTMLLabelElement>('label[for="prefs-accent-hue"]')?.textContent).toBe("Tinta su misura");
  });

  it("«su misura» apre il cursore senza scrivere; il cursore scrive al rilascio", async () => {
    await openPanel();
    swatch("custom").click();
    await settled();
    expect(fake.setSetting).not.toHaveBeenCalled();
    expect(checkedIn(".prefs-accent")).toEqual(["prefs-accent-custom"]);
    const slider = document.getElementById("prefs-accent-hue") as HTMLInputElement;
    expect(row(ACCENT).querySelector<HTMLElement>(".prefs-accent-custom")!.hidden).toBe(false);
    expect(slider.value).toBe("265");

    // Trascinare non è scrivere, e il cursore resta dove lo porta la mano.
    slider.focus();
    slider.value = "200";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await settled();
    expect(fake.setSetting).not.toHaveBeenCalled();
    expect(slider.value).toBe("200");
    expect(row(ACCENT).querySelector(".prefs-hue-value")?.textContent).toBe("200°");

    slider.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    expect(fake.setSetting).toHaveBeenCalledWith(ACCENT, 200);
    expect(checkedIn(".prefs-accent")).toEqual(["prefs-accent-custom"]);
    expect(document.activeElement).toBe(slider);
  });

  it("su misura resta tale anche sulla tinta di un campione, finché le preferenze restano aperte", async () => {
    await openPanel();
    swatch("custom").click();
    const slider = document.getElementById("prefs-accent-hue") as HTMLInputElement;
    slider.value = "300";
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    expect(checkedIn(".prefs-accent")).toEqual(["prefs-accent-custom"]);

    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    await settled();
    document.querySelector<HTMLButtonElement>("#open-settings")!.click();
    await settled();
    expect(checkedIn(".prefs-accent")).toEqual(["prefs-accent-viola"]);
  });

  it("segue la luce: i campioni si ricolorano", async () => {
    await openPanel();
    const day = swatch("ocra").style.getPropertyValue("--prefs-swatch");
    document.documentElement.dataset.theme = "dark";
    await settled();
    expect(swatch("ocra").style.getPropertyValue("--prefs-swatch")).not.toBe(day);
  });

  it("una scrittura rifiutata riporta il cursore sulla tinta vera", async () => {
    const list = entries();
    list[1] = entry(ACCENT, { kind: "number", default: 265, min: 0, max: 360 }, 172, "machine");
    await openPanel(list);
    fake.setSetting.mockRejectedValueOnce(new Error("no"));
    const slider = document.getElementById("prefs-accent-hue") as HTMLInputElement;
    slider.value = "10";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    expect(slider.value).toBe("172");
    expect(row(ACCENT).querySelector(".setting-control > .setting-error")).not.toBeNull();
  });
});

describe("la finestra delle preferenze", () => {
  it("ha un velo che c'è quando c'è lei", async () => {
    await openPanel();
    const scrim = document.querySelector<HTMLElement>(".settings-scrim")!;
    expect(scrim.nextElementSibling?.id).toBe("settings-panel");
    expect(scrim.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    await settled();
    expect(scrim.hidden).toBe(true);
  });

  it("un gesto cominciato e finito sul velo chiude; uno cominciato nella finestra no", async () => {
    await openPanel();
    const scrim = document.querySelector<HTMLElement>(".settings-scrim")!;
    const panel = document.getElementById("settings-panel")!;
    scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settled();
    expect(panel.hidden).toBe(false);

    scrim.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settled();
    expect(panel.hidden).toBe(true);
  });

  it("l'anteprima sta in testa alla sezione dell'aspetto, ed è un'immagine con un nome", async () => {
    await openPanel();
    const preview = document.querySelector<HTMLElement>(".prefs-preview")!;
    expect(preview.parentElement).toBe(row("appearance.theme").closest(".settings-card"));
    expect(preview.parentElement!.firstElementChild).toBe(preview);
    expect(preview.getAttribute("role")).toBe("img");
    expect(preview.getAttribute("aria-label")).toBe("Anteprima dell'aspetto");
    // Sopravvive a una riscrittura: stesso nodo.
    await changedOutside("appearance.body", 18);
    expect(document.querySelector(".prefs-preview")).toBe(preview);
  });

  it("sotto un filtro l'anteprima si toglie, e le righe vestite si trovano ancora", async () => {
    await openPanel();
    const search = document.getElementById("settings-search") as HTMLInputElement;
    search.value = SPACE;
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settled();
    expect(document.querySelector<HTMLElement>(".prefs-preview")!.hidden).toBe(true);
    expect(row(SPACE).hidden).toBe(false);
    expect(row(ACCENT).hidden).toBe(true);
    expect(row(SPACE).querySelector(".prefs-space")).not.toBeNull();
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settled();
    expect(document.querySelector<HTMLElement>(".prefs-preview")!.hidden).toBe(false);
  });

  it("in un'altra scheda i pezzi si tolgono, e tornano con la configurazione", async () => {
    await openPanel();
    document.querySelector<HTMLButtonElement>('#settings-tabs [data-tab="vault"]')!.click();
    await settled();
    expect(document.querySelector("#settings-body .prefs-space")).toBeNull();
    expect(document.querySelector("#settings-body .prefs-preview")).toBeNull();
    document.querySelector<HTMLButtonElement>('#settings-tabs [data-tab="settings"]')!.click();
    await settled();
    expect(row(SPACE).querySelector(".prefs-space")).not.toBeNull();
    expect(document.querySelector("#settings-body .prefs-preview")).not.toBeNull();
  });

  it("chiusa la vita non resta niente di suo, e la riga torna quella della vista", async () => {
    await openPanel();
    lifetime.close();
    expect(document.querySelector(".prefs-space, .prefs-accent, .prefs-preview, .settings-scrim")).toBeNull();
    await changedOutside(SPACE, 1);
    expect(native(SPACE).closest<HTMLElement>(".setting-range")!.hidden).toBe(false);
    expect(document.querySelector(".prefs-space")).toBeNull();
  });
});

describe("lo zoom dell'interfaccia", () => {
  const ZOOM = "appearance.zoom";
  const withZoom = (): SettingEntry[] => [...entries(), entry(ZOOM, { kind: "number", default: 1, min: 0.5, max: 2 }, 1)];
  const slider = (): HTMLInputElement => document.getElementById("prefs-zoom-range") as HTMLInputElement;
  const readout = (): string => row(ZOOM).querySelector(".prefs-zoom-value")!.textContent ?? "";

  it("si legge in percento, e si scrive come fattore dalla strada della riga", async () => {
    await openPanel(withZoom());
    expect(native(ZOOM).closest<HTMLElement>(".setting-range")!.hidden).toBe(true);
    expect(slider().value).toBe("100");
    expect(readout()).toBe("100%");
    expect(slider().getAttribute("aria-valuetext")).toBe("100%");
    expect(row(ZOOM).querySelector(".setting-default")?.textContent ?? "").not.toContain(" 1");
    slider().value = "150";
    slider().dispatchEvent(new Event("input", { bubbles: true }));
    expect(readout()).toBe("150%");
    slider().dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    expect(fake.setSetting).toHaveBeenCalledWith(ZOOM, 1.5);
    expect(readout()).toBe("150%");
  });

  it("segue un valore cambiato da fuori", async () => {
    await openPanel(withZoom());
    await changedOutside(ZOOM, 0.8);
    expect(slider().value).toBe("80");
    expect(readout()).toBe("80%");
  });
});

describe("i caratteri", () => {
  const FONT = "appearance.font";
  const withFont = (value = "newsreader"): SettingEntry[] => [
    ...entries(),
    entry(FONT, {
      kind: "choice",
      default: "newsreader",
      options: [
        { value: "newsreader", label: "Newsreader" },
        { value: "hanken", label: "Hanken Grotesk" },
        { value: "literata", label: "Literata" },
        { value: "inter", label: "Inter" },
        { value: "system", label: "Del sistema" },
      ],
    }, value),
    entry("appearance.font-mono", {
      kind: "choice",
      default: "plex",
      options: [{ value: "plex", label: "IBM Plex Mono" }, { value: "jetbrains", label: "JetBrains Mono" }],
    }, "plex"),
  ];
  const voices = (): HTMLButtonElement[] => [...row(FONT).querySelectorAll<HTMLButtonElement>(".prefs-font")];

  it("ogni voce è scritta col carattere che nomina, in un gruppo di scelta", async () => {
    await openPanel(withFont());
    const group = row(FONT).querySelector<HTMLElement>(".prefs-fonts")!;
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(group.getAttribute("aria-label")).toBe(`etichetta ${FONT}`);
    expect(voices().map((voice) => voice.textContent)).toEqual(["Newsreader", "Hanken Grotesk", "Literata", "Inter", "Del sistema"]);
    expect(voices()[0]!.style.fontFamily).toContain("Newsreader");
    expect(voices()[3]!.style.fontFamily).toContain("Inter");
    expect(checkedIn(".prefs-fonts")).toEqual([voices()[0]!.id]);
    expect(voices().map((voice) => voice.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    // La tendina resta nella riga, nascosta: è la strada per scrivere.
    expect(native(FONT).hidden).toBe(true);
  });

  it("scegliere scrive dalla strada della riga, e le frecce spostano la scelta", async () => {
    await openPanel(withFont());
    voices()[3]!.click();
    await settled();
    expect(fake.setSetting).toHaveBeenCalledWith(FONT, "inter");
    expect(checkedIn(".prefs-fonts")).toEqual([voices()[3]!.id]);
    press(voices()[3]!, "ArrowRight");
    await settled();
    expect(fake.setSetting).toHaveBeenLastCalledWith(FONT, "system");
    expect(document.activeElement).toBe(voices()[4]);
  });

  it("segue un valore cambiato da fuori", async () => {
    await openPanel(withFont());
    await changedOutside(FONT, "system");
    expect(checkedIn(".prefs-fonts")).toEqual([voices()[4]!.id]);
  });

  it("nel segmentato di poche voci ogni bottone è scritto col suo carattere", async () => {
    await openPanel(withFont());
    const options = [...row("appearance.font-mono").querySelectorAll<HTMLElement>(".segmented-option")];
    expect(options.map((option) => option.style.fontFamily.split(",")[0])).toEqual(['"IBM Plex Mono"', '"JetBrains Mono Variable"']);
  });
});
