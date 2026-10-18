// @vitest-environment happy-dom

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

vi.mock("../../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, unknown>) => (args ? `${key} ${JSON.stringify(args)}` : key),
  onLanguage: () => () => {},
}));
vi.mock("../../../ui/tooltip", () => ({ setTooltip: () => {} }));

import {
  setThemeSettingsSource,
  themeSettings,
  type ThemeSettings,
  type ThemeSettingsSource,
  type ThemeSettingValue,
} from "./theme-settings";

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
let panel: HTMLElement;
let body: HTMLElement;
let place: () => boolean;
let restore: (() => void) | null = null;

/// Una sorgente finta: una voce per specie, i valori in una mappa.
function fakeSource(initial: { locked?: string; empty?: boolean } = {}) {
  const values = new Map<string, ThemeSettingValue>([
    ["paper.grain", true],
    ["paper.tone", "warm"],
    ["paper.margin", 24],
  ]);
  const listeners = new Set<() => void>();
  const state = {
    themeId: "carta",
    themeName: "Carta",
    locked: undefined as string | undefined,
    empty: false,
    ...initial,
  };
  const source: ThemeSettingsSource & {
    values: Map<string, ThemeSettingValue>;
    state: typeof state;
    notify(): void;
    write: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
  } = {
    values,
    state,
    notify: () => {
      for (const listener of [...listeners]) listener();
    },
    read: vi.fn(async (): Promise<ThemeSettings> => ({
      themeId: state.themeId,
      themeName: state.themeName,
      ...(state.locked === undefined ? {} : { locked: state.locked }),
      entries: state.empty
        ? []
        : [
            {
              spec: { key: "paper.grain", label: "Grana", description: "La grana della carta.", kind: { kind: "toggle", default: false } },
              value: values.get("paper.grain")!,
            },
            {
              spec: {
                key: "paper.tone",
                label: "Tono",
                kind: {
                  kind: "choice",
                  default: "cool",
                  options: [
                    { value: "cool", label: "Freddo" },
                    { value: "warm", label: "Caldo" },
                  ],
                },
              },
              value: values.get("paper.tone")!,
            },
            {
              spec: { key: "paper.margin", label: "Margine", kind: { kind: "number", default: 24, min: 0, max: 64, step: 4 } },
              value: values.get("paper.margin")!,
            },
          ],
    })),
    write: vi.fn(async (key: string, value: ThemeSettingValue): Promise<void> => {
      values.set(key, value);
    }),
    reset: vi.fn(async (key: string): Promise<void> => {
      values.set(key, key === "paper.grain" ? false : key === "paper.tone" ? "cool" : 24);
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return source;
}

/// Il corpo come lo scrive la vista: una sezione con la riga della luce.
function writeBody(extra = ""): void {
  body.innerHTML = `
    <section class="settings-section">
      <div class="settings-card">
        <div class="setting-row" data-setting-key="appearance.theme" data-search="tema"></div>
        ${extra}
        <div class="setting-row" data-setting-key="appearance.accent" data-search="accento"></div>
      </div>
    </section>`;
}

const block = (): HTMLElement | null => body.querySelector<HTMLElement>(".prefs-theme");
const entryRow = (key: string): HTMLElement =>
  [...body.querySelectorAll<HTMLElement>(".prefs-theme-entry")].find((row) => row.dataset.themeSetting === key)!;
const control = <T extends HTMLElement>(key: string): T => document.getElementById(`prefs-theme-${key}`) as T;

async function settled(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(source?: ThemeSettingsSource): Promise<void> {
  if (source) restore = setThemeSettingsSource(source);
  place = themeSettings(lifetime, panel, body);
  await settled();
}

beforeEach(() => {
  lifetime = openLifetime();
  document.body.innerHTML = `
    <input id="settings-search" />
    <button id="settings-modified" aria-pressed="false"></button>
    <section id="settings-panel"><div id="settings-body"></div></section>`;
  panel = document.getElementById("settings-panel")!;
  body = document.getElementById("settings-body")!;
  writeBody();
});

afterEach(() => {
  lifetime.close();
  restore?.();
  restore = null;
});

describe("le impostazioni del tema", () => {
  it("di serie non c'è nessuna sorgente, e la schermata non c'è", async () => {
    await mount();
    expect(place()).toBe(false);
    expect(block()).toBeNull();
  });

  it("un tema che non dichiara voci non lascia un riquadro vuoto", async () => {
    await mount(fakeSource({ empty: true }));
    expect(block()).toBeNull();
  });

  it("mostra un controllo per voce, accanto alla scelta del tema e col nome del tema", async () => {
    await mount(fakeSource());
    const shown = block()!;
    expect(shown.previousElementSibling?.getAttribute("data-setting-key")).toBe("appearance.theme");
    expect(shown.querySelector("#prefs-theme-title")?.textContent).toBe('prefs.theme.title {"theme":"Carta"}');
    expect(shown.getAttribute("aria-labelledby")).toBe("prefs-theme-title");

    const grain = control<HTMLInputElement>("paper.grain");
    expect(grain.type).toBe("checkbox");
    expect(grain.getAttribute("role")).toBe("switch");
    expect(grain.checked).toBe(true);
    expect(entryRow("paper.grain").querySelector("label")?.htmlFor).toBe(grain.id);
    expect(grain.getAttribute("aria-describedby")).toBe("prefs-theme-paper.grain-desc");

    const tone = control("paper.tone");
    expect(tone.getAttribute("role")).toBe("radiogroup");
    expect(tone.getAttribute("aria-labelledby")).toBe("prefs-theme-paper.tone-label");
    expect([...tone.querySelectorAll("[role=radio]")].map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true"]);

    const margin = control<HTMLInputElement>("paper.margin");
    expect(margin.type).toBe("number");
    expect(margin.value).toBe("24");
    const slider = document.getElementById("prefs-theme-paper.margin-range") as HTMLInputElement;
    expect([slider.min, slider.max, slider.step]).toEqual(["0", "64", "4"]);
  });

  it("dopo il catalogo dei temi, quando la vista lo disegna", async () => {
    writeBody('<div class="setting-row setting-block"><button data-theme-id="fub.serie"></button></div>');
    await mount(fakeSource());
    expect(block()!.previousElementSibling?.querySelector("[data-theme-id]")).not.toBeNull();
  });

  it("una voce diversa dal predefinito lo dice, e ha il suo «azzera»", async () => {
    await mount(fakeSource());
    expect(entryRow("paper.grain").dataset.modified).toBe("true");
    expect(entryRow("paper.grain").querySelector(".setting-default")?.textContent).toBe('settings.default {"value":"settings.off"}');
    expect(entryRow("paper.tone").querySelector(".setting-default")?.textContent).toBe('settings.default {"value":"Freddo"}');
    expect(entryRow("paper.margin").dataset.modified).toBeUndefined();
    expect(entryRow("paper.margin").querySelector(".setting-reset")).toBeNull();
  });

  it("ogni specie scrive il suo valore, e rilegge", async () => {
    const source = fakeSource();
    await mount(source);

    control<HTMLInputElement>("paper.grain").click();
    await settled();
    expect(source.write).toHaveBeenLastCalledWith("paper.grain", false);
    expect(control<HTMLInputElement>("paper.grain").checked).toBe(false);
    expect(entryRow("paper.grain").dataset.modified).toBeUndefined();

    control("paper.tone").querySelector<HTMLButtonElement>('[data-choice="cool"]')!.click();
    await settled();
    expect(source.write).toHaveBeenLastCalledWith("paper.tone", "cool");

    const margin = control<HTMLInputElement>("paper.margin");
    margin.value = "32";
    margin.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    expect(source.write).toHaveBeenLastCalledWith("paper.margin", 32);
    expect(control<HTMLInputElement>("paper.margin").value).toBe("32");
    expect(entryRow("paper.margin").dataset.modified).toBe("true");

    const slider = document.getElementById("prefs-theme-paper.margin-range") as HTMLInputElement;
    slider.value = "8";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(control<HTMLInputElement>("paper.margin").value).toBe("8");
    expect(source.write).toHaveBeenCalledTimes(3);
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    expect(source.write).toHaveBeenLastCalledWith("paper.margin", 8);
  });

  it("l'interruttore si commuta anche con Invio, una volta sola", async () => {
    const source = fakeSource();
    await mount(source);
    const grain = control<HTMLInputElement>("paper.grain");
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    grain.dispatchEvent(event);
    await settled();
    expect(event.defaultPrevented).toBe(true);
    expect(source.write).toHaveBeenCalledTimes(1);
    expect(source.write).toHaveBeenCalledWith("paper.grain", false);
  });

  it("un numero vuoto o non numerico non parte", async () => {
    const source = fakeSource();
    await mount(source);
    const margin = control<HTMLInputElement>("paper.margin");
    margin.value = "";
    margin.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    expect(source.write).not.toHaveBeenCalled();
  });

  it("«azzera» azzera quella voce, e il fuoco passa al suo controllo", async () => {
    const source = fakeSource();
    await mount(source);
    const reset = entryRow("paper.grain").querySelector<HTMLButtonElement>(".setting-reset")!;
    reset.focus();
    reset.click();
    await settled();
    expect(source.reset).toHaveBeenCalledWith("paper.grain");
    expect(source.write).not.toHaveBeenCalled();
    expect(control<HTMLInputElement>("paper.grain").checked).toBe(false);
    expect(entryRow("paper.grain").querySelector(".setting-reset")).toBeNull();
    expect(document.activeElement).toBe(control("paper.grain"));
  });

  it("una rilettura arrivata da sé non toglie il fuoco a chi sta scegliendo", async () => {
    const source = fakeSource();
    await mount(source);
    const option = (): HTMLElement => control("paper.tone").querySelector<HTMLElement>('[aria-checked="true"]')!;
    const before = option();
    before.focus();
    source.notify();
    await settled();
    // Il gruppo è un altro nodo, e le sue opzioni non hanno un id.
    expect(option()).not.toBe(before);
    expect(document.activeElement).toBe(option());

    control<HTMLInputElement>("paper.margin").focus();
    source.notify();
    await settled();
    expect(document.activeElement).toBe(control("paper.margin"));
  });

  it("dopo una scelta il fuoco resta sull'opzione, anche se la sorgente avvisa durante e dopo", async () => {
    const source = fakeSource();
    // Come la sorgente vera: il segnale arriva a ogni scrittura, non solo
    // quando la schermata rilegge da sé.
    source.write.mockImplementation(async (key: string, value: ThemeSettingValue) => {
      source.values.set(key, value);
      source.notify();
    });
    await mount(source);
    const cool = control("paper.tone").querySelector<HTMLElement>('[data-choice="cool"]')!;
    cool.focus();
    cool.click();
    await settled();
    source.notify();
    await settled();
    const chosen = control("paper.tone").querySelector<HTMLElement>('[aria-checked="true"]')!;
    expect(chosen.dataset.choice).toBe("cool");
    expect(document.activeElement).toBe(chosen);
  });

  it("se durante la scrittura la persona è andata altrove, il fuoco resta dov'è andata", async () => {
    const source = fakeSource();
    let release: () => void = () => {};
    source.write.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    await mount(source);
    const grain = control<HTMLInputElement>("paper.grain");
    grain.focus();
    grain.click();
    await Promise.resolve();
    const search = document.getElementById("settings-search")!;
    search.focus();
    release();
    await settled();
    expect(source.write).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(search);
  });

  it("durante la scrittura la voce è occupata e i suoi controlli spenti; le altre no", async () => {
    const source = fakeSource();
    let release: () => void = () => {};
    source.write.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    await mount(source);
    control<HTMLInputElement>("paper.grain").click();
    await Promise.resolve();
    expect(entryRow("paper.grain").getAttribute("aria-busy")).toBe("true");
    expect(entryRow("paper.grain").querySelector(".setting-pending")?.getAttribute("role")).toBe("status");
    expect(control<HTMLInputElement>("paper.grain").disabled).toBe(true);
    expect(entryRow("paper.grain").querySelector<HTMLButtonElement>(".setting-reset")!.disabled).toBe(true);
    expect(control<HTMLInputElement>("paper.margin").disabled).toBe(false);
    // Un secondo gesto sulla stessa voce non parte finché il primo è in volo.
    control<HTMLInputElement>("paper.grain").click();
    expect(source.write).toHaveBeenCalledTimes(1);
    release();
    await settled();
    expect(entryRow("paper.grain").hasAttribute("aria-busy")).toBe(false);
    expect(control<HTMLInputElement>("paper.grain").disabled).toBe(false);
  });

  it("una scrittura rifiutata lo dice sotto il controllo, e il valore torna quello di prima", async () => {
    const source = fakeSource();
    source.write.mockRejectedValueOnce(new Error("disco pieno"));
    await mount(source);
    const margin = control<HTMLInputElement>("paper.margin");
    margin.focus();
    margin.value = "40";
    margin.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();

    const again = control<HTMLInputElement>("paper.margin");
    expect(again.value).toBe("24");
    const error = entryRow("paper.margin").querySelector<HTMLElement>(".setting-control > .setting-error")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.querySelector(".setting-error-message")?.textContent).toBe('prefs.theme.not_changed {"reason":"disco pieno"}');
    expect(error.querySelector(".setting-attempted")?.textContent).toBe("40");
    expect(again.getAttribute("aria-describedby")).toContain(error.id);
    expect(document.activeElement).toBe(again);
    // Le altre voci non portano l'esito di questa.
    expect(entryRow("paper.grain").querySelector(".setting-error")).toBeNull();

    // La prossima scrittura riuscita toglie l'esito.
    again.value = "12";
    again.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    expect(entryRow("paper.margin").querySelector(".setting-error")).toBeNull();
    expect(control<HTMLInputElement>("paper.margin").value).toBe("12");
  });

  it("una scelta rifiutata torna sull'opzione di prima", async () => {
    const source = fakeSource();
    source.write.mockRejectedValueOnce(new Error("no"));
    await mount(source);
    control("paper.tone").querySelector<HTMLButtonElement>('[data-choice="cool"]')!.click();
    await settled();
    const radios = [...control("paper.tone").querySelectorAll("[role=radio]")];
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(entryRow("paper.tone").querySelector(".setting-attempted")?.textContent).toBe("Freddo");
  });

  it("bloccata: le voci si vedono, niente si scrive, e la frase è una sola", async () => {
    const source = fakeSource({ locked: "Apri un vault per cambiare queste voci." });
    await mount(source);
    const note = document.getElementById("prefs-theme-locked")!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe("Apri un vault per cambiare queste voci.");
    expect(note.hasAttribute("role")).toBe(false);
    expect(body.querySelectorAll("#prefs-theme-locked")).toHaveLength(1);

    expect(control<HTMLInputElement>("paper.grain").checked).toBe(true);
    const fields = [...block()!.querySelectorAll<HTMLInputElement | HTMLButtonElement>(".prefs-theme-entry input, .prefs-theme-entry select, .prefs-theme-entry button")];
    expect(fields.length).toBeGreaterThan(5);
    expect(fields.every((field) => field.disabled)).toBe(true);
    expect(control("paper.grain").getAttribute("aria-describedby")).toContain("prefs-theme-locked");
    expect(control("paper.tone").getAttribute("aria-describedby")).toContain("prefs-theme-locked");
    expect(control("paper.tone").getAttribute("aria-disabled")).toBe("true");
    expect(entryRow("paper.grain").querySelector(".setting-reset")?.getAttribute("aria-describedby")).toContain("prefs-theme-locked");

    // Anche un gesto che arrivasse lo stesso (un `change` sintetico) non scrive.
    control<HTMLInputElement>("paper.grain").dispatchEvent(new Event("change", { bubbles: true }));
    control<HTMLInputElement>("paper.margin").dispatchEvent(new Event("change", { bubbles: true }));
    control("paper.tone").querySelector<HTMLButtonElement>('[data-choice="cool"]')!.click();
    entryRow("paper.grain").querySelector<HTMLButtonElement>(".setting-reset")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settled();
    expect(source.write).not.toHaveBeenCalled();
    expect(source.reset).not.toHaveBeenCalled();
  });

  it("sbloccata alla lettura dopo: tutto torna scrivibile", async () => {
    const source = fakeSource({ locked: "Apri un vault." });
    await mount(source);
    source.state.locked = undefined;
    source.notify();
    await settled();
    expect(document.getElementById("prefs-theme-locked")!.hidden).toBe(true);
    expect(control<HTMLInputElement>("paper.grain").disabled).toBe(false);
    expect(control("paper.grain").getAttribute("aria-describedby")).not.toContain("prefs-theme-locked");
    control<HTMLInputElement>("paper.grain").click();
    await settled();
    expect(source.write).toHaveBeenCalledWith("paper.grain", false);
  });

  it("segue la sorgente: un valore cambiato da fuori, un altro tema, nessuna voce", async () => {
    const source = fakeSource();
    await mount(source);
    source.values.set("paper.margin", 48);
    source.notify();
    await settled();
    expect(control<HTMLInputElement>("paper.margin").value).toBe("48");

    source.state.themeName = "Lavagna";
    source.state.themeId = "lavagna";
    source.notify();
    await settled();
    expect(block()!.querySelector("#prefs-theme-title")?.textContent).toBe('prefs.theme.title {"theme":"Lavagna"}');

    source.state.empty = true;
    source.notify();
    await settled();
    expect(block()).toBeNull();
  });

  it("l'esito di una voce non sopravvive al cambio di tema", async () => {
    const source = fakeSource();
    source.write.mockRejectedValueOnce(new Error("no"));
    await mount(source);
    control<HTMLInputElement>("paper.grain").click();
    await settled();
    expect(entryRow("paper.grain").querySelector(".setting-error")).not.toBeNull();
    source.state.themeId = "lavagna";
    source.notify();
    await settled();
    expect(entryRow("paper.grain").querySelector(".setting-error")).toBeNull();
  });

  it("una lettura vecchia non scrive sopra una nuova", async () => {
    const source = fakeSource();
    await mount(source);
    let releaseOld: (value: ThemeSettings) => void = () => {};
    const fresh = await source.read();
    source.read.mockClear();
    source.read.mockImplementationOnce(() => new Promise<ThemeSettings>((resolve) => {
      releaseOld = resolve;
    }));
    source.notify();
    source.state.themeName = "Nuovo";
    source.notify();
    await settled();
    expect(block()!.querySelector("#prefs-theme-title")?.textContent).toBe('prefs.theme.title {"theme":"Nuovo"}');
    releaseOld({ ...fresh, themeName: "Vecchio" });
    await settled();
    expect(block()!.querySelector("#prefs-theme-title")?.textContent).toBe('prefs.theme.title {"theme":"Nuovo"}');
  });

  it("una lettura che fallisce lo dice nel blocco, e tiene le voci di prima", async () => {
    const source = fakeSource();
    await mount(source);
    source.read.mockRejectedValueOnce(new Error("host muto"));
    source.notify();
    await settled();
    const trouble = block()!.querySelector<HTMLElement>(":scope > .setting-error")!;
    expect(trouble.hidden).toBe(false);
    expect(trouble.textContent).toBe('prefs.theme.read_failed {"reason":"host muto"}');
    expect(body.querySelectorAll(".prefs-theme-entry")).toHaveLength(3);
    source.notify();
    await settled();
    expect(block()!.querySelector<HTMLElement>(":scope > .setting-error")!.hidden).toBe(true);
  });

  it("sopravvive alla riscrittura del corpo: stesso nodo, rimesso al suo posto", async () => {
    await mount(fakeSource());
    const before = block()!;
    const grain = control("paper.grain");
    writeBody();
    expect(block()).toBeNull();
    expect(place()).toBe(true);
    expect(block()).toBe(before);
    expect(control("paper.grain")).toBe(grain);
    // Ripetuto senza che niente sia cambiato, non muove niente.
    expect(place()).toBe(false);
  });

  it("senza la riga del tema (un'altra scheda) la schermata non c'è", async () => {
    await mount(fakeSource());
    body.innerHTML = '<div class="setting-row" data-setting-key="keys.x"></div>';
    expect(place()).toBe(false);
    expect(block()).toBeNull();
  });

  it("il filtro della vista vale anche per le voci, e il blocco non resta col solo titolo", async () => {
    await mount(fakeSource());
    const search = document.getElementById("settings-search") as HTMLInputElement;
    search.value = "margine";
    place();
    expect(entryRow("paper.margin").hidden).toBe(false);
    expect(entryRow("paper.grain").hidden).toBe(true);
    expect(block()!.hidden).toBe(false);

    search.value = "niente di simile";
    place();
    expect(block()!.hidden).toBe(true);

    search.value = "";
    document.getElementById("settings-modified")!.setAttribute("aria-pressed", "true");
    place();
    expect(block()!.hidden).toBe(false);
    expect(entryRow("paper.grain").hidden).toBe(false);
    expect(entryRow("paper.margin").hidden).toBe(true);
  });

  it("una voce in vista riapre la sezione che la vista aveva nascosto", async () => {
    await mount(fakeSource());
    const section = body.querySelector<HTMLElement>(".settings-section")!;
    section.hidden = true;
    const empty = document.createElement("div");
    empty.className = "settings-empty";
    body.append(empty);
    (document.getElementById("settings-search") as HTMLInputElement).value = "grana";
    place();
    expect(section.hidden).toBe(false);
    expect(body.querySelector(".settings-empty")).toBeNull();
  });

  it("quando la vista nasconde le voci da sé, il blocco le segue", async () => {
    await mount(fakeSource());
    for (const row of body.querySelectorAll<HTMLElement>(".prefs-theme-entry")) row.hidden = true;
    await settled();
    expect(block()!.hidden).toBe(true);
    entryRow("paper.tone").hidden = false;
    await settled();
    expect(block()!.hidden).toBe(false);
  });

  it("cambiare sorgente rilegge; tornare indietro toglie la schermata", async () => {
    await mount();
    expect(block()).toBeNull();
    const source = fakeSource();
    const back = setThemeSettingsSource(source);
    await settled();
    expect(body.querySelectorAll(".prefs-theme-entry")).toHaveLength(3);
    back();
    await settled();
    expect(block()).toBeNull();
    // La sorgente tolta non ha più nessuno in ascolto.
    source.read.mockClear();
    source.notify();
    await settled();
    expect(source.read).not.toHaveBeenCalled();
  });

  it("riaperte le preferenze, rilegge", async () => {
    const source = fakeSource();
    await mount(source);
    panel.hidden = true;
    await settled();
    source.read.mockClear();
    source.values.set("paper.margin", 4);
    panel.hidden = false;
    await settled();
    expect(source.read).toHaveBeenCalledTimes(1);
    expect(control<HTMLInputElement>("paper.margin").value).toBe("4");
  });

  it("chiusa la vita: il blocco se ne va e la sorgente non ha più ascolti", async () => {
    const source = fakeSource();
    await mount(source);
    lifetime.close();
    expect(block()).toBeNull();
    source.read.mockClear();
    source.notify();
    await settled();
    expect(source.read).not.toHaveBeenCalled();
  });
});
