// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference, type ManualDriver } from "../../../moto";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const run = vi.fn();
const focusPane = vi.fn();

vi.mock("../../../ui/commands", () => ({
  allCommands: () => [{ id: "shell.note.new", binding: "Mod-N", run }],
  displayBinding: (binding: string | null) => (binding ? "Ctrl+N" : ""),
  ariaBinding: (binding: string | null) => (binding ? "Control+N" : ""),
}));
vi.mock("../../../state/layout", () => ({ focusPane: (id: string) => focusPane(id) }));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string) => key,
  onLanguage: () => () => {},
}));
vi.mock("../../../ui/tooltip", () => ({
  setTooltip: (el: HTMLElement, text: string) => {
    el.dataset.tip = text;
  },
}));
vi.mock("../../../ui/icons", () => ({ iconEl: () => null }));

import { mountTabStrips } from "./tab-strip";

const WIDTH = 120;
let driver: ManualDriver;
let lifetime: Lifetime;
let panes: HTMLElement;

/// Una linguetta com'è scritta dalla vista, con un posto finto nella striscia.
function entry(name: string, index: number, selected: boolean, extra: Record<string, unknown> = {}): HTMLElement {
  const item = document.createElement("div");
  item.className = "tab-entry";
  const tab = document.createElement("button");
  tab.className = "tab";
  tab.setAttribute("role", "tab");
  tab.dataset.key = JSON.stringify({ k: "doc", doc: name, ...extra });
  tab.dataset.index = String(index);
  tab.setAttribute("aria-selected", String(selected));
  item.append(tab);
  Object.defineProperty(item, "offsetLeft", { get: () => Number(tab.dataset.index) * WIDTH });
  Object.defineProperty(item, "offsetWidth", { get: () => WIDTH });
  return item;
}

/// Un riquadro con la sua striscia, il suo elenco e il suo pannello.
function pane(id: string, names: string[], active: number): { strip: HTMLElement; menu: HTMLElement; panel: HTMLElement } {
  const root = document.createElement("section");
  root.className = "pane";
  root.dataset.pane = id;
  const strip = document.createElement("div");
  strip.className = "pane-tabs";
  const list = document.createElement("div");
  list.setAttribute("role", "tablist");
  const menu = document.createElement("button");
  menu.dataset.tabMenu = "";
  strip.append(list, ...names.map((name, index) => entry(name, index, index === active)), menu);
  const panel = document.createElement("div");
  panel.setAttribute("role", "tabpanel");
  root.append(strip, panel);
  panes.append(root);
  return { strip, menu, panel };
}

function select(strip: HTMLElement, index: number): void {
  strip.querySelectorAll(".tab").forEach((tab, position) => {
    tab.setAttribute("aria-selected", String(position === index));
  });
}

/// Gli osservatori consegnano a fine giro.
/// La striscia si guarda al fotogramma dopo il cambio: si aspetta quello.
const settled = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

function xOf(frame: Keyframe): number {
  const match = /translate\((-?[\d.]+)px/.exec(String(frame.transform));
  if (!match) throw new Error(`nessuna traslazione in ${String(frame.transform)}`);
  return Number(match[1]);
}

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  panes = document.createElement("div");
  panes.id = "panes";
  document.body.append(panes);
  lifetime = openLifetime();
  run.mockClear();
  focusPane.mockClear();
});

afterEach(() => {
  lifetime.close();
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  document.body.replaceChildren();
});

describe("il «+» della striscia", () => {
  it("sta prima dell'elenco, ha un nome e porta l'accordo del comando", () => {
    const { strip, menu } = pane("p1", ["a", "b"], 0);
    mountTabStrips(lifetime);
    const plus = strip.querySelector<HTMLButtonElement>(".tab-new")!;
    expect(plus.nextElementSibling).toBe(menu);
    expect(plus.type).toBe("button");
    expect(plus.getAttribute("aria-label")).toBe("commands.note.new");
    expect(plus.dataset.tip).toBe("commands.note.new (Ctrl+N)");
    expect(plus.getAttribute("aria-keyshortcuts")).toBe("Control+N");
  });

  it("torna al suo posto quando la vista rifà i figli, ed è sempre lo stesso nodo", async () => {
    const { strip, menu } = pane("p1", ["a", "b"], 0);
    mountTabStrips(lifetime);
    const plus = strip.querySelector(".tab-new")!;
    const list = strip.firstElementChild!;
    strip.replaceChildren(list, entry("a", 0, true), entry("c", 1, false), menu);
    expect(strip.querySelector(".tab-new")).toBeNull();
    await settled();
    expect(strip.querySelector(".tab-new")).toBe(plus);
    expect(plus.nextElementSibling).toBe(menu);
    expect(strip.querySelectorAll(".tab-new")).toHaveLength(1);
  });

  it("crea la nota nel foglio della striscia: prima il fuoco, poi il comando", () => {
    pane("p1", ["a"], 0);
    const second = pane("p2", ["b"], 0);
    mountTabStrips(lifetime);
    second.strip.querySelector<HTMLElement>(".tab-new")!.click();
    expect(focusPane).toHaveBeenCalledWith("p2");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("il doppio clic sul vuoto della striscia fa lo stesso, quello su una linguetta no", () => {
    const { strip } = pane("p1", ["a"], 0);
    mountTabStrips(lifetime);
    strip.querySelector(".tab")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(run).not.toHaveBeenCalled();
    strip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(focusPane).toHaveBeenCalledWith("p1");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("smontata la shell il «+» se ne va e niente risponde più", async () => {
    const { strip, menu } = pane("p1", ["a", "b"], 0);
    mountTabStrips(lifetime);
    lifetime.close();
    expect(strip.querySelector(".tab-new")).toBeNull();
    strip.replaceChildren(strip.firstElementChild!, entry("a", 0, false), entry("b", 1, true), menu);
    select(strip, 0);
    strip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settled();
    expect(strip.querySelector(".tab-new")).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(driver.plays).toHaveLength(0);
  });
});

describe("il raccordo che scorre", () => {
  it("alla prima occhiata non c'è un «da dove»: niente movimento", () => {
    pane("p1", ["a", "b", "c"], 1);
    mountTabStrips(lifetime);
    expect(driver.plays).toHaveLength(0);
  });

  it("la sagoma della nuova attiva parte dal posto della vecchia", async () => {
    const { strip } = pane("p1", ["a", "b", "c"], 0);
    mountTabStrips(lifetime);
    select(strip, 2);
    await settled();
    const shape = driver.plays.find((play) => play.timing.pseudo === "::before")!;
    expect(shape.el).toBe(strip.querySelectorAll(".tab-entry")[2]);
    // Due linguette più a sinistra: la differenza è tutta nella posa di partenza.
    expect(xOf(shape.keyframes[0])).toBe(-2 * WIDTH);
    expect(xOf(shape.keyframes[shape.keyframes.length - 1])).toBe(0);
  });

  it("il contenuto arriva dal verso dello spostamento, e solo se cambia scheda", async () => {
    const { strip, panel } = pane("p1", ["a", "b", "c"], 0);
    mountTabStrips(lifetime);
    select(strip, 2);
    await settled();
    const forward = driver.plays.find((play) => play.el === panel)!;
    expect(forward.keyframes[0]).toMatchObject({ opacity: 0 });
    expect(xOf(forward.keyframes[0])).toBeGreaterThan(0);

    driver.advance(2000);
    select(strip, 1);
    await settled();
    const back = driver.plays.filter((play) => play.el === panel)[1];
    expect(xOf(back.keyframes[0])).toBeLessThan(0);
  });

  it("la stessa scheda che cambia posto scorre con la sua sagoma, ma il contenuto no", async () => {
    const { strip, menu, panel } = pane("p1", ["a", "b", "c"], 2);
    mountTabStrips(lifetime);
    // Fissata, «c» passa in testa: la chiave cambia, il documento no.
    strip.replaceChildren(
      strip.firstElementChild!,
      entry("c", 0, true, { pinned: true }),
      entry("a", 1, false),
      entry("b", 2, false),
      menu,
    );
    await settled();
    const [c, a, b] = strip.querySelectorAll(".tab-entry");
    // La linguetta parte da dov'era e la sagoma, sua figlia, viaggia con lei:
    // una corsa sola, niente in più sullo pseudo-elemento.
    const own = driver.plays.find((play) => play.el === c && !play.timing.pseudo)!;
    expect(xOf(own.keyframes[0])).toBe(2 * WIDTH);
    expect(driver.plays.some((play) => play.timing.pseudo === "::before")).toBe(false);
    expect(xOf(driver.plays.find((play) => play.el === a)!.keyframes[0])).toBe(-WIDTH);
    expect(xOf(driver.plays.find((play) => play.el === b)!.keyframes[0])).toBe(-WIDTH);
    expect(driver.plays.some((play) => play.el === panel)).toBe(false);
  });

  it("un cambio a metà corsa riparte da dove la sagoma si vedeva", async () => {
    const { strip } = pane("p1", ["a", "b", "c"], 0);
    mountTabStrips(lifetime);
    select(strip, 2);
    await settled();
    driver.advance(64);
    select(strip, 1);
    await settled();
    const shapes = driver.plays.filter((play) => play.timing.pseudo === "::before");
    expect(shapes).toHaveLength(2);
    // Da ferma partirebbe da +120 (il posto della terza); in volo è più indietro.
    const start = xOf(shapes[1].keyframes[0]);
    expect(start).toBeLessThan(WIDTH);
    expect(start).toBeGreaterThan(-WIDTH);
    expect(start).not.toBe(WIDTH);
  });

  it("guarda la striscia al fotogramma dopo, una volta sola per più cambi", async () => {
    const { strip } = pane("p1", ["a", "b", "c"], 0);
    mountTabStrips(lifetime);
    select(strip, 1);
    select(strip, 2);
    // L'osservatore ha già scattato, ma posti e scorrimento non si leggono a
    // metà di un cambio di scheda: niente si muove prima del fotogramma.
    await Promise.resolve();
    await Promise.resolve();
    expect(driver.plays).toHaveLength(0);
    await settled();
    const shapes = driver.plays.filter((play) => play.timing.pseudo === "::before");
    expect(shapes).toHaveLength(1);
    expect(xOf(shapes[0].keyframes[0])).toBe(-2 * WIDTH);
  });

  it("un riquadro nato dopo viene seguito anche lui", async () => {
    pane("p1", ["a"], 0);
    mountTabStrips(lifetime);
    const late = pane("p2", ["x", "y"], 0);
    await settled();
    expect(late.strip.querySelector(".tab-new")).not.toBeNull();
    select(late.strip, 1);
    await settled();
    expect(driver.plays.some((play) => play.el === late.strip.querySelectorAll(".tab-entry")[1])).toBe(true);
  });

  it("col movimento ridotto la sagoma non scorre e il contenuto sfuma soltanto", async () => {
    setMotionPreference("reduced");
    const { strip, panel } = pane("p1", ["a", "b"], 0);
    mountTabStrips(lifetime);
    select(strip, 1);
    await settled();
    expect(driver.plays.some((play) => play.timing.pseudo === "::before")).toBe(false);
    const fade = driver.plays.find((play) => play.el === panel)!;
    expect(fade.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });
});

describe("una linguetta che si chiude (#411 B-04)", () => {
  it("il «+» torna prima che il motore disegni: nessun fotogramma senza", async () => {
    const { strip, menu } = pane("p1", ["a", "b", "c"], 0);
    mountTabStrips(lifetime);
    const plus = strip.querySelector(".tab-new")!;
    strip.replaceChildren(strip.firstElementChild!, entry("a", 0, true), entry("c", 1, false), menu);
    // L'osservatore consegna a fine giro, prima di qualunque fotogramma.
    await Promise.resolve();
    expect(strip.querySelector(".tab-new")).toBe(plus);
    expect(plus.nextElementSibling).toBe(menu);
  });

  it("chi sta a destra scorre al posto nuovo in una corsa sola, chi sta a sinistra resta", async () => {
    const { strip, menu } = pane("p1", ["a", "b", "c", "d"], 0);
    mountTabStrips(lifetime);
    // Si chiude «b»: la vista rifà i figli con gli indici nuovi.
    strip.replaceChildren(strip.firstElementChild!, entry("a", 0, true), entry("c", 1, false), entry("d", 2, false), menu);
    await settled();
    const [a, c, d] = strip.querySelectorAll(".tab-entry");
    expect(driver.plays.some((play) => play.el === a)).toBe(false);
    for (const moved of [c, d]) {
      const plays = driver.plays.filter((play) => play.el === moved);
      expect(plays).toHaveLength(1);
      // Parte da un posto più a destra e arriva al suo, senza tornare indietro.
      const xs = plays[0]!.keyframes.map(xOf);
      expect(xs[0]).toBe(WIDTH);
      expect(xs[xs.length - 1]).toBe(0);
      for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeLessThanOrEqual(xs[i - 1]! + 0.5);
    }
    // La sagoma non ha un viaggio suo: l'attiva è rimasta dov'era.
    expect(driver.plays.some((play) => play.timing.pseudo === "::before")).toBe(false);
  });

  it("chiusa l'attiva, la sagoma della nuova somma il suo viaggio a quello della linguetta", async () => {
    const { strip, menu } = pane("p1", ["a", "b", "c"], 1);
    mountTabStrips(lifetime);
    // Si chiude «b», l'attiva: lo diventa «c», che scivola da 240 a 120.
    strip.replaceChildren(strip.firstElementChild!, entry("a", 0, false), entry("c", 1, true), menu);
    await settled();
    const c = strip.querySelectorAll(".tab-entry")[1]!;
    const own = driver.plays.find((play) => play.el === c && !play.timing.pseudo)!;
    expect(xOf(own.keyframes[0])).toBe(WIDTH);
    // La sagoma era su «b», a 120: la linguetta la porta già da 240, e lei
    // aggiunge solo i -120 che mancano. Insieme partono da 120, dov'era.
    const shape = driver.plays.find((play) => play.el === c && play.timing.pseudo === "::before")!;
    expect(xOf(shape.keyframes[0]) + xOf(own.keyframes[0])).toBe(0);
  });

  it("col movimento ridotto il passo è uno scatto unico, senza corse", async () => {
    setMotionPreference("reduced");
    const { strip, menu } = pane("p1", ["a", "b", "c"], 0);
    mountTabStrips(lifetime);
    strip.replaceChildren(strip.firstElementChild!, entry("a", 0, true), entry("c", 1, false), menu);
    await settled();
    expect(driver.plays).toHaveLength(0);
  });

  it("finita la corsa, sulle linguette e sul «+» non resta niente: né trasformazioni in linea, né corse", async () => {
    const { strip, menu } = pane("p1", ["a", "b", "c"], 0);
    mountTabStrips(lifetime);
    const plus = strip.querySelector<HTMLElement>(".tab-new")!;
    placeAfterTabs(strip, plus);
    strip.replaceChildren(strip.firstElementChild!, entry("a", 0, true), entry("c", 1, false), menu);
    await settled();
    // Il «+» c'era e scorre con le altre: la prova non è vuota.
    expect(driver.plays.some((play) => play.el === plus)).toBe(true);
    driver.advance(5000);
    expect(activeMotions()).toBe(0);
    for (const each of [...strip.querySelectorAll<HTMLElement>(".tab-entry"), plus]) {
      expect(each.style.transform).toBe("");
      expect(each.style.translate).toBe("");
    }
  });
});

/// Il «+» sta dopo l'ultima linguetta, come lo mette il motore.
function placeAfterTabs(strip: HTMLElement, plus: HTMLElement): void {
  Object.defineProperty(plus, "offsetLeft", { get: () => strip.querySelectorAll(".tab-entry").length * WIDTH });
}

describe("un foglio nuovo (#423 stage-split)", () => {
  it("le prime schede arrivano col foglio: il «+» non scorre dal posto vuoto in testa", async () => {
    // Il foglio nasce con la striscia vuota, e la vista ci scrive la scheda subito dopo.
    const { strip, menu } = pane("p2", [], -1);
    mountTabStrips(lifetime);
    const plus = strip.querySelector<HTMLElement>(".tab-new")!;
    placeAfterTabs(strip, plus);
    strip.replaceChildren(strip.firstElementChild!, entry("a", 0, true), menu);
    await settled();
    expect(strip.querySelector(".tab-new")).toBe(plus);
    // Una corsa del «+» dentro l'entrata del foglio salterebbe quando il
    // foglio si richiude a metà: è il salto che il banco del movimento vede.
    expect(driver.plays.some((play) => play.el === plus)).toBe(false);
    expect(activeMotions()).toBe(0);
  });
});

describe("la striscia che scorre", () => {
  it("dice da che parte continua", () => {
    const { strip } = pane("p1", ["a", "b"], 0);
    Object.defineProperty(strip, "clientWidth", { get: () => 200 });
    Object.defineProperty(strip, "scrollWidth", { get: () => 500 });
    mountTabStrips(lifetime);
    expect(strip.dataset.scrolled).toBe("end");
    strip.scrollLeft = 120;
    strip.dispatchEvent(new Event("scroll"));
    expect(strip.dataset.scrolled).toBe("both");
    strip.scrollLeft = 300;
    strip.dispatchEvent(new Event("scroll"));
    expect(strip.dataset.scrolled).toBe("start");
  });

  it("la rotella verticale la muove di lato, e solo se c'è dove andare", () => {
    const { strip } = pane("p1", ["a", "b"], 0);
    let width = 200;
    Object.defineProperty(strip, "clientWidth", { get: () => 200 });
    Object.defineProperty(strip, "scrollWidth", { get: () => width });
    mountTabStrips(lifetime);
    const still = new WheelEvent("wheel", { deltaY: 60, bubbles: true, cancelable: true });
    strip.dispatchEvent(still);
    expect(still.defaultPrevented).toBe(false);

    width = 500;
    const moved = new WheelEvent("wheel", { deltaY: 60, bubbles: true, cancelable: true });
    strip.dispatchEvent(moved);
    expect(moved.defaultPrevented).toBe(true);
    expect(strip.scrollLeft).toBe(60);
  });
});
