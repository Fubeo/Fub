// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeMotions,
  createManualDriver,
  DURATION,
  liveState,
  setMotionDriver,
  setMotionPreference,
  type ManualDriver,
} from "../../../moto";
import { emit } from "../../../state/store";
import type { CommandEntry } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const world = vi.hoisted(() => ({
  commands: [] as unknown[],
  started: [] as string[],
  language: "it",
  languageListeners: new Set<() => void>(),
  /// Il tema montato, per ciò che la scena ne chiede.
  themeId: "fub.serie",
  contrast: "normal",
  preferences: { accent: 210 } as Record<string, unknown>,
  tokens: (_light: string, _contrast: string): Record<string, string> => ({}),
  tokenCalls: [] as { preferences: unknown; light: string; contrast: string }[],
  sheet: (_light: string, _contrast: string): string => "",
  /// Ciò che l'host riceve, e come risponde.
  writes: [] as { key: string; value: unknown }[],
  setSetting: (_key: string, _value: unknown): Promise<void> => Promise.resolve(),
}));

vi.mock("../../../host/ipc", () => ({
  api: {
    setSetting: (key: string, value: unknown) => {
      world.writes.push({ key, value });
      return world.setSetting(key, value);
    },
  },
}));
// Il tema è finto per intero: la scena ne legge l'identità, le preferenze e il
// foglio, e la luce montata sta dove sta davvero, in `data-theme` sulla radice.
vi.mock("../../../theme/theme", () => ({
  SERIES_THEME_ID: "fub.serie",
  THEME_KEY: "appearance.theme",
  currentTheme: () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
  currentContrast: () => world.contrast,
  currentThemeId: () => world.themeId,
  currentPreferences: () => world.preferences,
  preferenceTokens: (preferences: unknown, light: string, contrast: string) => {
    world.tokenCalls.push({ preferences, light, contrast });
    return world.tokens(light, contrast);
  },
  themeSeries: () => ({ sheet: (light: string, contrast: string) => world.sheet(light, contrast) }),
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

import { deskColour, mountLightSwitch, switchLight, turnLight } from "./light";

const LIGHT_COMMAND = "shell.light.toggle";
const DAY = "#f6f1e7";
const NIGHT = "rgb(20, 22, 24)";

function command(id: string, binding: string | null): CommandEntry {
  return { id, title: id, description: "", layer: "global", binding, declared: binding, spec: null, run: () => {} };
}

function changeLanguage(next: string): void {
  world.language = next;
  for (const listener of [...world.languageListeners]) listener();
}

/// Le promesse e gli osservatori consegnano a fine giro; il tempo è fermo,
/// quindi qui si aspettano i giri e non un timer.
async function settled(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

const root = (): HTMLElement => document.documentElement;
const circle = (): HTMLElement | null => document.querySelector<HTMLElement>(".light-scene");

/// Il bottone della luce, al suo posto finto in fondo al binario.
function lightButton(): HTMLButtonElement {
  document.body.innerHTML = '<button id="toggle-light" type="button" class="rail-btn" aria-label="Cambia luce"></button>';
  const button = document.getElementById("toggle-light") as HTMLButtonElement;
  button.getBoundingClientRect = () => ({ left: 10, top: 700, width: 40, height: 40, right: 50, bottom: 740 }) as DOMRect;
  return button;
}

/// Lo stato di una promessa, senza aspettarla.
function watch(promise: Promise<void>): { state: "pending" | "done" | "failed"; error?: unknown } {
  const seen: { state: "pending" | "done" | "failed"; error?: unknown } = { state: "pending" };
  promise.then(
    () => (seen.state = "done"),
    (error: unknown) => {
      seen.state = "failed";
      seen.error = error;
    },
  );
  return seen;
}

let driver: ManualDriver;
let lifetime: Lifetime;

beforeEach(() => {
  vi.useFakeTimers();
  driver = createManualDriver();
  setMotionDriver(driver);
  world.commands = [command(LIGHT_COMMAND, null)];
  world.started.length = 0;
  world.language = "it";
  world.themeId = "fub.serie";
  world.contrast = "normal";
  world.preferences = { accent: 210 };
  world.tokens = (light) => ({ bg: light === "light" ? DAY : NIGHT });
  world.tokenCalls.length = 0;
  world.sheet = () => "";
  world.writes.length = 0;
  world.setSetting = () => Promise.resolve();
  root().dataset.theme = "dark";
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  expect(world.languageListeners.size).toBe(0);
  delete root().dataset.theme;
  document.body.replaceChildren();
});

describe("deskColour", () => {
  it("non lo sa se il tema montato non è la serie", () => {
    world.themeId = "comunita.altro";
    world.sheet = () => `:root{--bg: ${DAY};}`;
    expect(deskColour("light")).toBeNull();
    expect(deskColour("dark")).toBeNull();
  });

  it("è la scrivania che le preferenze danno a quella luce, col contrasto in vigore", () => {
    world.contrast = "high";
    expect(deskColour("light")).toBe(DAY);
    expect(deskColour("dark")).toBe(NIGHT);
    expect(world.tokenCalls).toEqual([
      { preferences: world.preferences, light: "light", contrast: "high" },
      { preferences: world.preferences, light: "dark", contrast: "high" },
    ]);
  });

  it("se le preferenze non la dicono, la legge dal foglio della serie per quella luce", () => {
    world.tokens = () => ({ accent: "#345" });
    world.contrast = "high";
    const asked: string[] = [];
    world.sheet = (light, contrast) => {
      asked.push(`${light}/${contrast}`);
      return `:root{--bg-soft: #111;--bg:  ${light === "light" ? DAY : NIGHT} ;--ink: #222}`;
    };
    expect(deskColour("light")).toBe(DAY);
    expect(deskColour("dark")).toBe(NIGHT);
    expect(asked).toEqual(["light/high", "dark/high"]);
  });

  it("la trova anche se è l'ultima dichiarazione, senza punto e virgola", () => {
    world.tokens = () => ({});
    world.sheet = () => `:root{--ink: #222;--bg: ${DAY}}`;
    expect(deskColour("light")).toBe(DAY);
  });

  it("un foglio che non la dichiara non dà un colore", () => {
    world.tokens = () => ({});
    world.sheet = () => ":root{--bg-soft: #111;--ink: #222}";
    expect(deskColour("light")).toBeNull();
  });
});

describe("il cambio di luce con la sua scena", () => {
  it("un cerchio del colore nuovo parte dal bottone e arriva all'angolo più lontano", async () => {
    const button = lightButton();
    const done = switchLight(button, lifetime);

    const scene = circle()!;
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("aria-hidden")).toBe("true");
    // Di notte si passa al giorno: il cerchio ha già il colore del giorno.
    expect(scene.style.background).toBe(DAY);
    // Il centro del bottone è (30, 720); l'angolo più lontano è in alto a destra.
    const radius = Math.hypot(window.innerWidth - 30, 720);
    expect(parseFloat(scene.style.width)).toBeCloseTo(radius * 2, 3);
    expect(parseFloat(scene.style.height)).toBeCloseTo(radius * 2, 3);
    expect(parseFloat(scene.style.left) + radius).toBeCloseTo(30, 3);
    expect(parseFloat(scene.style.top) + radius).toBeCloseTo(720, 3);

    expect(driver.plays).toHaveLength(1);
    expect(driver.plays[0]!.el).toBe(scene);
    const grow = driver.plays[0]!.keyframes;
    expect(grow[0]).toEqual({ transform: "scale(0.02, 0.02)" });
    expect(grow[grow.length - 1]).toEqual({ transform: "scale(1, 1)" });
    expect(driver.plays[0]!.timing.duration).toBe(DURATION.large);

    driver.advance(DURATION.large);
    await settled();
    root().dataset.theme = "light";
    await settled();
    driver.advance(DURATION.short);
    await done;
  });

  it("scrive l'impostazione a metà: a finestra coperta, non prima", async () => {
    const done = switchLight(lightButton(), lifetime);
    await settled();
    expect(world.writes).toEqual([]);

    driver.advance(DURATION.large - 20);
    await settled();
    expect(world.writes).toEqual([]);

    driver.advance(20);
    await settled();
    expect(world.writes).toEqual([{ key: "appearance.theme", value: "light" }]);

    root().dataset.theme = "light";
    await settled();
    driver.advance(DURATION.short);
    await done;
    expect(world.writes).toHaveLength(1);
  });

  it("resta a coprire finché il tema nuovo non è montato, poi svanisce e se ne va", async () => {
    const outcome = watch(switchLight(lightButton(), lifetime));
    const scene = circle()!;
    driver.advance(DURATION.large);
    await settled();
    // Scritto, ma il tema sotto è ancora quello vecchio: il cerchio non si muove.
    expect(circle()).toBe(scene);
    expect(driver.plays).toHaveLength(1);
    expect(scene.style.opacity).toBe("");

    root().dataset.theme = "light";
    await settled();
    // Lo stato finale è già scritto; ciò che si vede è la dissolvenza.
    expect(scene.style.opacity).toBe("0");
    expect(driver.plays).toHaveLength(2);
    expect(driver.plays[1]!.el).toBe(scene);
    expect(driver.plays[1]!.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(driver.plays[1]!.timing.duration).toBe(DURATION.short);
    expect(outcome.state).toBe("pending");

    driver.advance(DURATION.short);
    await settled();
    expect(circle()).toBeNull();
    expect(outcome.state).toBe("done");
    expect(activeMotions()).toBe(0);
  });

  it("se la scrittura monta già il tema, non aspetta nessuno", async () => {
    world.setSetting = (_key, value) => {
      root().dataset.theme = String(value);
      return Promise.resolve();
    };
    const outcome = watch(switchLight(lightButton(), lifetime));
    driver.advance(DURATION.large);
    await settled();
    expect(driver.plays).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    driver.advance(DURATION.short);
    await settled();
    expect(circle()).toBeNull();
    expect(outcome.state).toBe("done");
  });

  it("un tema che non si monta non tiene il cerchio sulla finestra: dopo 600 ms lo scopre comunque", async () => {
    const outcome = watch(switchLight(lightButton(), lifetime));
    driver.advance(DURATION.large);
    await settled();

    vi.advanceTimersByTime(599);
    await settled();
    expect(driver.plays).toHaveLength(1);

    vi.advanceTimersByTime(1);
    await settled();
    expect(driver.plays).toHaveLength(2);
    driver.advance(DURATION.short);
    await settled();
    expect(circle()).toBeNull();
    expect(outcome.state).toBe("done");
  });

  it("un altro attributo che cambia sulla radice non vale come tema montato", async () => {
    switchLight(lightButton(), lifetime).catch(() => {});
    driver.advance(DURATION.large);
    await settled();
    root().dataset.theme = "dark";
    root().dataset.contrast = "high";
    await settled();
    expect(driver.plays).toHaveLength(1);
    delete root().dataset.contrast;
    vi.advanceTimersByTime(600);
    await settled();
    driver.advance(DURATION.short);
    await settled();
    expect(circle()).toBeNull();
  });

  it("di giorno passa alla notte, col colore della notte", async () => {
    root().dataset.theme = "light";
    const done = switchLight(lightButton(), lifetime);
    expect(circle()!.style.background).toBe(NIGHT);
    driver.advance(DURATION.large);
    await settled();
    expect(world.writes).toEqual([{ key: "appearance.theme", value: "dark" }]);
    root().dataset.theme = "dark";
    await settled();
    driver.advance(DURATION.short);
    await done;
  });

  it("se l'host rifiuta la scrittura il cerchio se ne va e il rifiuto arriva a chi ha chiesto", async () => {
    const refusal = new Error("impostazione rifiutata");
    world.setSetting = () => Promise.reject(refusal);
    const outcome = watch(switchLight(lightButton(), lifetime));
    driver.advance(DURATION.large);
    await settled();
    expect(circle()).toBeNull();
    expect(outcome).toEqual({ state: "failed", error: refusal });
    // Niente dissolvenza, e nessuna attesa rimasta appesa.
    expect(driver.plays).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/// La scala in cui il cerchio sta, letta dal primo fotogramma di una corsa.
function scaleOf(frame: Keyframe | undefined): number {
  const match = /scale\(([\d.]+)/.exec(String(frame?.transform ?? ""));
  return match ? Number(match[1]) : Number.NaN;
}

describe("il gesto che torna indietro", () => {
  it("senza una scena in corso non c'è niente da disfare", () => {
    expect(turnLight()).toBe(false);
  });

  it("mentre il cerchio cresce lo fa rientrare da dov'è, e la luce non cambia", async () => {
    const outcome = watch(switchLight(lightButton(), lifetime));
    const scene = circle()!;
    driver.advance(DURATION.large / 2);
    const reached = liveState(scene)!.pose.scaleX!;

    expect(turnLight()).toBe(true);
    expect(driver.plays[0]!.state).toBe("canceled");
    const back = driver.plays[1]!;
    expect(back.el).toBe(scene);
    // Parte dalla scala raggiunta, non dal bottone e non dalla finestra intera.
    const from = scaleOf(back.keyframes[0]);
    expect(from).toBeGreaterThan(0.02);
    expect(from).toBeLessThan(1);
    expect(from).toBeCloseTo(reached, 3);
    expect(back.keyframes[0]!.opacity).toBe(1);
    expect(back.keyframes[back.keyframes.length - 1]).toEqual({ transform: "scale(0.02, 0.02)", opacity: 0 });
    // Spento resta: a corsa finita non torna a coprire la finestra.
    expect(scene.style.opacity).toBe("0");

    driver.advance(DURATION.short);
    await settled();
    expect(circle()).toBeNull();
    expect(world.writes).toEqual([]);
    expect(outcome.state).toBe("done");
    expect(turnLight()).toBe(false);
  });

  it("un terzo gesto lo rimanda fuori, e allora la luce cambia", async () => {
    const done = switchLight(lightButton(), lifetime);
    const scene = circle()!;
    driver.advance(DURATION.large / 2);
    expect(turnLight()).toBe(true);
    driver.advance(DURATION.short / 2);
    expect(turnLight()).toBe(true);
    expect(scene.style.opacity).toBe("");
    const again = driver.plays[2]!;
    expect(scaleOf(again.keyframes[again.keyframes.length - 1])).toBe(1);

    driver.advance(DURATION.large);
    await settled();
    expect(world.writes).toEqual([{ key: "appearance.theme", value: "light" }]);
    root().dataset.theme = "light";
    await settled();
    driver.advance(DURATION.short);
    await done;
    expect(circle()).toBeNull();
  });

  it("a luce già scritta la scena non torna indietro", async () => {
    const done = switchLight(lightButton(), lifetime);
    driver.advance(DURATION.large);
    await settled();
    expect(world.writes).toHaveLength(1);
    expect(turnLight()).toBe(false);
    root().dataset.theme = "light";
    await settled();
    driver.advance(DURATION.short);
    await done;
  });
});

describe("il cambio di luce senza scena", () => {
  /// Nessun cerchio, nessuna corsa: solo la scrittura.
  async function expectPlainWrite(origin: HTMLElement | null): Promise<void> {
    await switchLight(origin, lifetime);
    expect(circle()).toBeNull();
    expect(driver.plays).toHaveLength(0);
    expect(world.writes).toEqual([{ key: "appearance.theme", value: "light" }]);
  }

  it("col movimento ridotto la luce cambia e basta", async () => {
    setMotionPreference("reduced");
    await expectPlainWrite(lightButton());
  });

  it("anche col movimento calmo: la scena è del solo movimento pieno", async () => {
    setMotionPreference("calm");
    await expectPlainWrite(lightButton());
  });

  it("senza il bottone", async () => {
    await expectPlainWrite(null);
  });

  it("con il bottone che non si vede: a binario nascosto non ha un posto", async () => {
    const button = lightButton();
    button.getClientRects = () => [] as unknown as DOMRectList;
    await expectPlainWrite(button);
    // Senza un posto da cui partire il colore non serve: non lo si chiede.
    expect(world.tokenCalls).toEqual([]);
  });

  it("con un tema che non è la serie: il colore nuovo non si sa prima", async () => {
    world.themeId = "comunita.altro";
    await expectPlainWrite(lightButton());
  });

  it("con una serie che non dichiara la scrivania", async () => {
    world.tokens = () => ({});
    world.sheet = () => ":root{--ink: #222}";
    await expectPlainWrite(lightButton());
  });

  it("un rifiuto dell'host arriva a chi ha chiesto", async () => {
    const refusal = new Error("impostazione rifiutata");
    world.setSetting = () => Promise.reject(refusal);
    await expect(switchLight(null, lifetime)).rejects.toBe(refusal);
  });
});

describe("la scena e lo smontaggio", () => {
  it("smontata mentre il cerchio si allarga: il cerchio se ne va subito, la luce chiesta si scrive lo stesso", async () => {
    const outcome = watch(switchLight(lightButton(), lifetime));
    driver.advance(DURATION.large / 2);
    expect(circle()).not.toBeNull();

    lifetime.close();
    expect(circle()).toBeNull();
    expect(activeMotions()).toBe(0);
    await settled();
    expect(world.writes).toEqual([{ key: "appearance.theme", value: "light" }]);
    expect(outcome.state).toBe("done");
    // Nessuna dissolvenza su un cerchio che non c'è più, e nessuna attesa appesa.
    expect(driver.plays).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("smontata mentre aspetta il tema: il cerchio se ne va e l'attesa finisce", async () => {
    const outcome = watch(switchLight(lightButton(), lifetime));
    driver.advance(DURATION.large);
    await settled();
    expect(vi.getTimerCount()).toBe(1);

    lifetime.close();
    expect(circle()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await settled();
    expect(outcome.state).toBe("done");
    expect(driver.plays).toHaveLength(1);

    // Il tema che arriva dopo non trova più nessuno ad aspettarlo.
    root().dataset.theme = "light";
    await settled();
    expect(driver.plays).toHaveLength(1);
  });

  it("smontata mentre svanisce: il cerchio se ne va", async () => {
    const outcome = watch(switchLight(lightButton(), lifetime));
    driver.advance(DURATION.large);
    await settled();
    root().dataset.theme = "light";
    await settled();
    driver.advance(DURATION.short / 2);
    expect(circle()).not.toBeNull();

    lifetime.close();
    expect(circle()).toBeNull();
    expect(activeMotions()).toBe(0);
    await settled();
    expect(outcome.state).toBe("done");
  });
});

describe("il bottone della luce", () => {
  const button = (): HTMLButtonElement => document.getElementById("toggle-light") as HTMLButtonElement;
  const iconOf = (): string | undefined => button().querySelector("svg")?.dataset.icon;

  beforeEach(() => {
    lightButton();
  });

  it("di notte mostra il sole e offre il giorno", () => {
    mountLightSwitch(lifetime);
    expect(iconOf()).toBe("sun");
    expect(button().getAttribute("aria-label")).toBe("frame.light.to_light");
    expect(button().dataset.tip).toBe("frame.light.to_light");
    expect(button().hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("di giorno mostra la luna e offre la notte", () => {
    root().dataset.theme = "light";
    mountLightSwitch(lifetime);
    expect(iconOf()).toBe("moon");
    expect(button().getAttribute("aria-label")).toBe("frame.light.to_dark");
  });

  it("segue la luce montata, chiunque la cambi", async () => {
    mountLightSwitch(lifetime);
    root().dataset.theme = "light";
    await settled();
    expect(iconOf()).toBe("moon");
    expect(button().getAttribute("aria-label")).toBe("frame.light.to_dark");

    root().dataset.theme = "dark";
    await settled();
    expect(iconOf()).toBe("sun");
    expect(button().getAttribute("aria-label")).toBe("frame.light.to_light");
  });

  it("porta i tasti del comando, se glieli si dà, e li segue", () => {
    world.commands = [command(LIGHT_COMMAND, "Mod-Shift-L")];
    mountLightSwitch(lifetime);
    expect(button().dataset.tip).toBe("frame.light.to_light (Ctrl+Shift+L)");
    expect(button().getAttribute("aria-keyshortcuts")).toBe("Control+Shift+L");

    world.commands = [command(LIGHT_COMMAND, null)];
    emit("commands");
    expect(button().dataset.tip).toBe("frame.light.to_light");
    expect(button().hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("si rietichetta quando cambia la lingua", () => {
    mountLightSwitch(lifetime);
    changeLanguage("en");
    expect(button().getAttribute("aria-label")).toBe("frame.light.to_light (en)");
  });

  it("premuto esegue il comando: la scena e la scrittura non sono affar suo", async () => {
    mountLightSwitch(lifetime);
    button().click();
    await settled();
    expect(world.started).toEqual([LIGHT_COMMAND]);
    expect(world.writes).toEqual([]);
    expect(circle()).toBeNull();
  });

  it("se il comando non c'è non succede niente", () => {
    world.commands = [];
    mountLightSwitch(lifetime);
    expect(() => button().click()).not.toThrow();
    expect(world.started).toEqual([]);
    expect(world.writes).toEqual([]);
  });

  it("senza il bottone non monta niente", () => {
    document.body.replaceChildren();
    expect(() => mountLightSwitch(lifetime)).not.toThrow();
    expect(world.languageListeners.size).toBe(0);
  });

  it("smontato non preme più niente e non segue più la luce", async () => {
    mountLightSwitch(lifetime);
    lifetime.close();
    button().click();
    expect(world.started).toEqual([]);

    root().dataset.theme = "light";
    world.commands = [command(LIGHT_COMMAND, "Mod-Shift-L")];
    emit("commands");
    changeLanguage("en");
    await settled();
    expect(iconOf()).toBe("sun");
    expect(button().getAttribute("aria-label")).toBe("frame.light.to_light");
    expect(button().dataset.tip).toBe("frame.light.to_light");
  });
});
