// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference, type ManualDriver } from "../../../moto";
import type { CommandEntry } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";

const world = vi.hoisted(() => ({
  commands: [] as unknown[],
  started: [] as string[],
  language: "it",
  languageListeners: new Set<() => void>(),
  lightMounts: [] as unknown[],
}));

vi.mock("../../../ui/commands", async (original) => ({
  ...(await original<typeof import("../../../ui/commands")>()),
  allCommands: () => world.commands,
}));
vi.mock("../../../ui/palette", () => ({
  startCommand: (entry: { id: string }) => world.started.push(entry.id),
}));
vi.mock("../../../state/palette-host", () => ({ paletteHost: {} }));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string) => (world.language === "it" ? key : `${key} (${world.language})`),
  onLanguage: (listener: () => void) => {
    world.languageListeners.add(listener);
    return () => world.languageListeners.delete(listener);
  },
}));
vi.mock("../../../ui/tooltip", () => ({
  setTooltip: (el: HTMLElement, text: string) => {
    el.dataset.tip = text;
  },
}));
vi.mock("../../../ui/icons", () => ({ icon: (name: string) => `<svg data-icon="${name}"></svg>` }));
// Il cambio di luce ha il suo banco (`light.test.ts`): qui conta solo che il
// piede lo monti, con la stessa vita.
vi.mock("./light", () => ({ mountLightSwitch: (lifetime: unknown) => world.lightMounts.push(lifetime) }));

import { mountRailFoot, mountRailNotch } from "./rail";

const FRAME = 1000 / 60;

function command(id: string, binding: string | null): CommandEntry {
  return { id, title: id, description: "", layer: "global", binding, declared: binding, spec: null, run: () => {} };
}

function changeLanguage(next: string): void {
  world.language = next;
  for (const listener of [...world.languageListeners]) listener();
}

/// Gli osservatori consegnano a fine giro; il tempo è fermo, quindi qui si
/// aspettano i giri e non un timer.
async function settled(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

const el = (id: string): HTMLElement => document.getElementById(id)!;

let driver: ManualDriver;
let lifetime: Lifetime;

beforeEach(() => {
  vi.useFakeTimers();
  driver = createManualDriver();
  setMotionDriver(driver);
  world.commands = [
    command("shell.palette", "Mod-Shift-P"),
    command("shell.switcher", "Mod-O"),
    command("shell.settings", null),
  ];
  world.started.length = 0;
  world.language = "it";
  world.lightMounts.length = 0;
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  closeContextMenu();
  vi.runAllTimers();
  vi.useRealTimers();
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  vi.unstubAllGlobals();
  expect(world.languageListeners.size).toBe(0);
  document.body.replaceChildren();
});

describe("il piede del binario", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="rail-foot" role="group">
        <button id="open-help" type="button" class="rail-btn" aria-haspopup="menu" aria-expanded="false"></button>
        <button id="open-settings" type="button" class="rail-btn"></button>
        <button id="toggle-light" type="button" class="rail-btn"></button>
      </div>`;
    help().getBoundingClientRect = () => ({ left: 4, top: 600, right: 44, bottom: 640, width: 40, height: 40 }) as DOMRect;
  });

  const help = (): HTMLButtonElement => el("open-help") as HTMLButtonElement;

  /// Il menu aperto adesso: uno che sta uscendo non conta.
  function menu(): HTMLElement | null {
    const shown = document.getElementById("context-menu");
    return shown && shown.dataset.shellMotion !== "exit" ? shown : null;
  }

  function entries(): { label: string; hint: string | null }[] {
    return [...menu()!.querySelectorAll("button")].map((item) => ({
      label: item.querySelector(".menu-label")?.textContent ?? "",
      hint: item.querySelector(".menu-hint")?.textContent ?? null,
    }));
  }

  function choose(label: string): void {
    const item = [...menu()!.querySelectorAll("button")].find(
      (candidate) => candidate.querySelector(".menu-label")?.textContent === label,
    );
    if (!item) throw new Error(`nessuna voce «${label}»`);
    item.click();
  }

  it("disegna le figure di aiuto e preferenze, e dà all'aiuto il suo suggerimento", () => {
    mountRailFoot(lifetime);
    expect(help().querySelector("svg")?.dataset.icon).toBe("help");
    expect(el("open-settings").querySelector("svg")?.dataset.icon).toBe("settings");
    expect(help().dataset.tip).toBe("frame.help");
  });

  it("monta il cambio di luce con la stessa vita", () => {
    mountRailFoot(lifetime);
    expect(world.lightMounts).toEqual([lifetime]);
  });

  it("il suggerimento dell'aiuto segue la lingua", () => {
    mountRailFoot(lifetime);
    changeLanguage("en");
    expect(help().dataset.tip).toBe("frame.help (en)");
  });

  it("l'aiuto premuto apre le sue tre voci, ognuna con i tasti veri del suo comando", () => {
    mountRailFoot(lifetime);
    help().click();
    expect(entries()).toEqual([
      { label: "commands.palette", hint: "Ctrl+Shift+P" },
      { label: "frame.help.switcher", hint: "Ctrl+O" },
      // Un comando senza accordo non mostra tasti.
      { label: "app.settings", hint: null },
    ]);
  });

  it("si dichiara aperto, e il menu è il suo: legato al bottone e a fianco di lui", () => {
    mountRailFoot(lifetime);
    help().click();
    expect(help().getAttribute("aria-expanded")).toBe("true");
    expect(menu()!.getAttribute("aria-labelledby")).toBe("open-help");
    expect(menu()!.style.left).toBe("50px");
    expect(menu()!.style.top).toBe("600px");
  });

  it.each([
    ["commands.palette", "shell.palette"],
    ["frame.help.switcher", "shell.switcher"],
    ["app.settings", "shell.settings"],
  ])("la voce «%s» esegue %s, e il bottone torna chiuso", (label, id) => {
    mountRailFoot(lifetime);
    help().click();
    choose(label);
    expect(world.started).toEqual([id]);
    expect(help().getAttribute("aria-expanded")).toBe("false");
    expect(menu()).toBeNull();
  });

  it("una voce il cui comando non c'è resta in elenco, e sceglierla non fa niente", () => {
    world.commands = [];
    mountRailFoot(lifetime);
    help().click();
    expect(entries()).toEqual([
      { label: "commands.palette", hint: null },
      { label: "frame.help.switcher", hint: null },
      { label: "app.settings", hint: null },
    ]);
    expect(() => choose("commands.palette")).not.toThrow();
    expect(world.started).toEqual([]);
    expect(help().getAttribute("aria-expanded")).toBe("false");
  });

  it("legge gli accordi a ogni apertura", () => {
    mountRailFoot(lifetime);
    help().click();
    closeContextMenu();
    world.commands = [command("shell.palette", "Mod-K")];
    help().click();
    expect(entries()[0]).toEqual({ label: "commands.palette", hint: "Ctrl+K" });
  });

  it("Escape richiude il menu, e il bottone lo sa", () => {
    mountRailFoot(lifetime);
    help().click();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(menu()).toBeNull();
    expect(help().getAttribute("aria-expanded")).toBe("false");
    expect(world.started).toEqual([]);
  });

  it("il clic resta suo: non arriva a chi ascolta il documento", () => {
    const witness = openLifetime();
    const outside = vi.fn();
    witness.listen(document, "click", outside);
    mountRailFoot(lifetime);
    help().click();
    witness.close();
    expect(outside).not.toHaveBeenCalled();
  });

  // DIFETTO (rail.ts:39-43). `aria-expanded="true"` è scritto prima di
  // `showContextMenu`, che per prima cosa chiude il menu precedente e ne chiama
  // `onClose`: quello riscrive `"false"`. Un secondo clic a menu aperto lascia
  // quindi un menu aperto dichiarato chiuso. `ui/app-menu.ts` si protegge con
  // una generazione nel suo `onClose`; qui non c'è. La prova chiede solo che
  // ciò che il bottone dichiara sia ciò che si vede: vale sia che il secondo
  // clic riapra il menu, sia che lo chiuda.
  it("premuto di nuovo a menu aperto, dichiara ancora ciò che si vede", () => {
    mountRailFoot(lifetime);
    help().click();
    // Il menu ha già il suo ascolto sul documento: il secondo clic non lo
    // raggiunge, perché il bottone lo ferma.
    vi.advanceTimersByTime(0);
    help().click();
    expect(help().getAttribute("aria-expanded")).toBe(String(menu() !== null));
  });

  it("senza il bottone dell'aiuto restano le preferenze e la luce", () => {
    help().remove();
    expect(() => mountRailFoot(lifetime)).not.toThrow();
    expect(el("open-settings").querySelector("svg")?.dataset.icon).toBe("settings");
    expect(world.lightMounts).toEqual([lifetime]);
    expect(world.languageListeners.size).toBe(0);
  });

  it("senza il bottone delle preferenze resta l'aiuto", () => {
    el("open-settings").remove();
    expect(() => mountRailFoot(lifetime)).not.toThrow();
    help().click();
    expect(entries()).toHaveLength(3);
  });

  it("smontato, l'aiuto non apre più niente e non segue più la lingua", () => {
    mountRailFoot(lifetime);
    lifetime.close();
    help().click();
    expect(menu()).toBeNull();
    expect(help().getAttribute("aria-expanded")).toBe("false");
    changeLanguage("en");
    expect(help().dataset.tip).toBe("frame.help");
  });
});

describe("la tacca del binario", () => {
  const RAIL_TOP = 40;
  const BUTTON = 32;
  const STEP = 36;
  const NOTCH = 16;

  /// Un `ResizeObserver` che scatta a comando: happy-dom non impagina, quindi
  /// il suo non scatta mai.
  class FakeResizeObserver {
    static live = new Set<FakeResizeObserver>();
    readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
    }
    observe(): void {
      FakeResizeObserver.live.add(this);
    }
    unobserve(): void {}
    disconnect(): void {
      FakeResizeObserver.live.delete(this);
    }
  }
  const resize = (): void => {
    for (const observer of [...FakeResizeObserver.live]) observer.callback();
  };

  /// Un'icona del binario come le monta `panels/rail.ts`, al suo posto finto.
  function railButton(id: string, slot: number, pressed: boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "rail-btn";
    button.dataset.slot = String(slot);
    button.setAttribute("aria-pressed", String(pressed));
    button.getBoundingClientRect = () => ({ top: RAIL_TOP + 8 + Number(button.dataset.slot) * STEP }) as DOMRect;
    Object.defineProperty(button, "offsetHeight", { get: () => BUTTON });
    return button;
  }

  /// Dove deve stare la tacca per l'icona al posto `slot`: centrata su di lei.
  const at = (slot: number): string => `0 ${8 + slot * STEP + (BUTTON - NOTCH) / 2}px`;

  function markup(pressed: number | null, count = 3): void {
    document.body.innerHTML = `
      <div id="rail">
        <div id="views-ribbon"></div>
        <span id="rail-notch" aria-hidden="true" hidden></span>
      </div>`;
    el("rail").getBoundingClientRect = () => ({ top: RAIL_TOP }) as DOMRect;
    Object.defineProperty(el("rail-notch"), "offsetHeight", { get: () => NOTCH });
    for (let slot = 0; slot < count; slot++) el("views-ribbon").append(railButton(`b${slot}`, slot, slot === pressed));
  }

  const notch = (): HTMLElement => el("rail-notch");
  const y = (): number => Number(/^0 (-?[\d.]+)px$/.exec(notch().style.translate)![1]);

  function light(slot: number | null): void {
    document.querySelectorAll(".rail-btn").forEach((button, index) => {
      button.setAttribute("aria-pressed", String(index === slot));
    });
  }

  beforeEach(() => {
    FakeResizeObserver.live.clear();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  it("senza un'icona accesa non si vede", () => {
    markup(null);
    mountRailNotch(lifetime);
    expect(notch().hidden).toBe(true);
  });

  it("compare già al suo posto accanto all'icona accesa, senza scivolarci", () => {
    markup(1);
    mountRailNotch(lifetime);
    expect(notch().hidden).toBe(false);
    expect(notch().style.translate).toBe(at(1));
    expect(activeMotions()).toBe(0);
  });

  it("scrive la posizione al centesimo di pixel", () => {
    markup(0);
    el("b0").getBoundingClientRect = () => ({ top: RAIL_TOP + 8 + 1 / 3 }) as DOMRect;
    mountRailNotch(lifetime);
    expect(notch().style.translate).toBe("0 16.33px");
  });

  it("da un'icona all'altra scivola, e si ferma esattamente sulla nuova", async () => {
    markup(0);
    mountRailNotch(lifetime);
    light(2);
    await settled();
    // Lo stato è già quello nuovo; ciò che si muove è la tacca.
    expect(notch().hidden).toBe(false);
    expect(notch().style.translate).toBe(at(0));

    driver.advance(FRAME * 2);
    expect(y()).toBeGreaterThan(16);
    expect(y()).toBeLessThan(88);

    driver.advance(3000);
    expect(notch().style.translate).toBe(at(2));
    expect(activeMotions()).toBe(0);
  });

  it("spenta l'icona sparisce; riaccesa ricompare al suo posto, senza scivolare", async () => {
    markup(0);
    mountRailNotch(lifetime);
    light(null);
    await settled();
    expect(notch().hidden).toBe(true);

    light(2);
    await settled();
    expect(notch().hidden).toBe(false);
    expect(notch().style.translate).toBe(at(2));
    expect(activeMotions()).toBe(0);
  });

  it("un'icona accesa ma nascosta non conta", async () => {
    markup(1);
    el("b1").hidden = true;
    mountRailNotch(lifetime);
    expect(notch().hidden).toBe(true);

    el("b1").hidden = false;
    await settled();
    expect(notch().hidden).toBe(false);
    expect(notch().style.translate).toBe(at(1));
  });

  it("a binario nascosto non si vede, e quando torna ricompare al suo posto", async () => {
    markup(1);
    mountRailNotch(lifetime);
    el("rail").hidden = true;
    await settled();
    expect(notch().hidden).toBe(true);

    light(2);
    el("rail").hidden = false;
    await settled();
    expect(notch().hidden).toBe(false);
    expect(notch().style.translate).toBe(at(2));
    expect(activeMotions()).toBe(0);
  });

  it("a cassetto chiuso non si vede e il binario lo dice; riaperto, torna al suo posto", async () => {
    markup(1);
    const drawer = document.createElement("aside");
    drawer.id = "sidebar";
    drawer.hidden = true;
    document.body.append(drawer);
    mountRailNotch(lifetime);
    expect(notch().hidden).toBe(true);
    expect(el("rail").dataset.drawer).toBe("closed");

    drawer.hidden = false;
    await settled();
    expect(notch().hidden).toBe(false);
    expect(notch().style.translate).toBe(at(1));
    expect(el("rail").dataset.drawer).toBeUndefined();
    expect(activeMotions()).toBe(0);

    drawer.hidden = true;
    await settled();
    expect(notch().hidden).toBe(true);
    expect(el("rail").dataset.drawer).toBe("closed");
  });

  it("non riscrive la propria visibilità al valore che ha già: seguirebbe se stessa senza fine", async () => {
    markup(1);
    const drawer = document.createElement("aside");
    drawer.id = "sidebar";
    document.body.append(drawer);
    // La tacca nasce visibile, così chiuderla è una scrittura vera.
    notch().hidden = false;
    let writes = 0;
    const target = notch();
    Object.defineProperty(target, "hidden", {
      configurable: true,
      get: () => target.hasAttribute("hidden"),
      set: (value: boolean) => {
        // Il tetto ferma il giro se torna: un test che si pianta non dice niente.
        if (++writes > 20) throw new Error("la tacca si riscrive da sola");
        if (value) target.setAttribute("hidden", "");
        else target.removeAttribute("hidden");
      },
    });
    mountRailNotch(lifetime);
    await settled();
    writes = 0;

    drawer.hidden = true;
    await settled();
    await settled();
    expect(target.hidden).toBe(true);
    expect(writes).toBe(1);
  });

  it("un'icona montata dopo, già accesa, la fa comparire", async () => {
    markup(null, 1);
    mountRailNotch(lifetime);
    expect(notch().hidden).toBe(true);
    el("views-ribbon").append(railButton("tardi", 1, true));
    await settled();
    expect(notch().hidden).toBe(false);
    expect(notch().style.translate).toBe(at(1));
  });

  it("quando il binario cambia misura si riposa dov'è l'icona, senza scivolare", () => {
    markup(1);
    mountRailNotch(lifetime);
    // La stessa icona, più in basso: è l'impaginazione che è cambiata.
    el("b1").dataset.slot = "4";
    resize();
    expect(notch().style.translate).toBe(at(4));
    expect(activeMotions()).toBe(0);
  });

  it("col movimento ridotto salta da un'icona all'altra", async () => {
    setMotionPreference("reduced");
    markup(0);
    mountRailNotch(lifetime);
    light(2);
    await settled();
    expect(notch().style.translate).toBe(at(2));
    expect(activeMotions()).toBe(0);
  });

  it("senza il binario o senza la tacca non monta niente", () => {
    markup(1);
    notch().remove();
    expect(() => mountRailNotch(lifetime)).not.toThrow();
    expect(FakeResizeObserver.live.size).toBe(0);

    markup(1);
    const orphan = notch();
    document.body.append(orphan);
    el("rail").remove();
    expect(() => mountRailNotch(lifetime)).not.toThrow();
    expect(orphan.hidden).toBe(true);
    expect(FakeResizeObserver.live.size).toBe(0);
  });

  it("smontata non segue più niente", async () => {
    markup(0);
    mountRailNotch(lifetime);
    expect(FakeResizeObserver.live.size).toBe(1);
    lifetime.close();
    expect(FakeResizeObserver.live.size).toBe(0);

    light(2);
    el("views-ribbon").append(railButton("tardi", 3, true));
    await settled();
    driver.advance(3000);
    expect(notch().style.translate).toBe(at(0));
    expect(notch().hidden).toBe(false);
  });

  it("smontata a metà scivolata si ferma dov'è", async () => {
    markup(0);
    mountRailNotch(lifetime);
    light(2);
    await settled();
    driver.advance(FRAME * 2);
    const stopped = notch().style.translate;
    expect(stopped).not.toBe(at(0));
    expect(stopped).not.toBe(at(2));

    lifetime.close();
    expect(activeMotions()).toBe(0);
    driver.advance(3000);
    expect(notch().style.translate).toBe(stopped);
  });
});
