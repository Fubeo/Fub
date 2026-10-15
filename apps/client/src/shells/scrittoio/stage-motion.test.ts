// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeMotions,
  createManualDriver,
  setMotionDriver,
  setMotionPreference,
  type ManualDriver,
  type RecordedPlay,
} from "../../moto";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { mountStageMotion } from "./stage-motion";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/// happy-dom non impagina: i riquadri li decide il test, elemento per elemento.
const boxes = new WeakMap<Element, Rect>();

function place(el: Element, rect: Rect | null): void {
  if (rect) boxes.set(el, rect);
  else boxes.delete(el);
}

function measured(this: Element): DOMRect {
  const rect = boxes.get(this);
  const hidden = this instanceof HTMLElement && this.hidden;
  const { left, top, width, height } = rect && !hidden ? rect : { left: 0, top: 0, width: 0, height: 0 };
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

const panes = (): HTMLElement => document.getElementById("panes") as HTMLElement;

function sheet(id: string, rect: Rect): HTMLElement {
  const el = document.createElement("section");
  el.className = "pane";
  el.dataset.pane = id;
  place(el, rect);
  return el;
}

/// La scrivania con i suoi fogli e le parti della cornice, accese o spente.
function desk(sheets: HTMLElement[], hidden: { sidebar?: boolean } = {}): void {
  document.body.innerHTML = `
    <div id="app">
      <nav id="rail"></nav>
      <aside id="sidebar"${hidden.sidebar ? " hidden" : ""}></aside>
      <section id="panes"></section>
      <aside id="right-pane" hidden></aside>
      <footer id="status-band"></footer>
    </div>`;
  place(document.getElementById("rail")!, { left: 0, top: 40, width: 44, height: 734 });
  place(document.getElementById("sidebar")!, { left: 44, top: 40, width: 264, height: 734 });
  place(document.getElementById("right-pane")!, { left: 980, top: 40, width: 300, height: 734 });
  place(document.getElementById("status-band")!, { left: 0, top: 774, width: 1280, height: 26 });
  panes().append(...sheets);
}

/// Il layout rifà i figli di `#panes`: qui come fa `layoutTree`.
function relayout(...children: HTMLElement[]): void {
  const split = document.createElement("div");
  split.className = "pane-split row";
  split.append(...children);
  panes().replaceChildren(children.length === 1 ? children[0] : split);
}

/// Gli osservatori consegnano a fine giro.
async function delivered(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

const playsOn = (el: Element, pseudo?: string): RecordedPlay[] =>
  driver.plays.filter((play) => play.el === el && play.timing.pseudo === pseudo);

const numbers = (value: unknown): number[] => (String(value).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

let driver: ManualDriver;
let lifetime: Lifetime;

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(measured);
  driver = createManualDriver();
  setMotionDriver(driver);
  setMotionPreference("system");
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const WHOLE: Rect = { left: 316, top: 40, width: 956, height: 726 };
const LEFT: Rect = { left: 316, top: 40, width: 474, height: 726 };
const RIGHT: Rect = { left: 798, top: 40, width: 474, height: 726 };

describe("dividere", () => {
  it("la carta del foglio rimasto va dal rettangolo intero alla sua metà; il contenuto non si muove", async () => {
    const a = sheet("a", WHOLE);
    desk([a]);
    mountStageMotion(lifetime);

    place(a, LEFT);
    const b = sheet("b", RIGHT);
    relayout(a, b);
    await delivered();

    const [paper] = playsOn(a, "::before");
    expect(paper).toBeDefined();
    // Parte dove stava la carta intera: più a destra, e più larga.
    const [x, y, scaleX, scaleY] = numbers(paper.keyframes[0].transform);
    expect(x).toBeCloseTo(WHOLE.left + WHOLE.width / 2 - (LEFT.left + LEFT.width / 2), 1);
    expect(y).toBe(0);
    expect(scaleX).toBeCloseTo(WHOLE.width / LEFT.width, 3);
    expect(scaleY).toBe(1);
    // L'elemento — testata, testo — non ha corse sue.
    expect(playsOn(a)).toHaveLength(0);
  });

  it("il foglio nuovo esce dal bordo di quello da cui è nato, e appare", async () => {
    const a = sheet("a", WHOLE);
    desk([a]);
    mountStageMotion(lifetime);

    place(a, LEFT);
    const b = sheet("b", RIGHT);
    relayout(a, b);
    await delivered();

    const [arrival] = playsOn(b);
    expect(arrival).toBeDefined();
    const [x, y] = numbers(arrival.keyframes[0].transform);
    // Nasce a destra del vecchio: arriva da sinistra, di poco.
    expect(x).toBeLessThan(0);
    expect(x).toBeGreaterThanOrEqual(-64);
    expect(y).toBe(0);
    expect(arrival.keyframes[0].opacity).toBe(0);
  });

  it("dividere in basso fa uscire il foglio dal bordo inferiore", async () => {
    const a = sheet("a", WHOLE);
    desk([a]);
    mountStageMotion(lifetime);

    place(a, { left: 316, top: 40, width: 956, height: 359 });
    const b = sheet("b", { left: 316, top: 407, width: 956, height: 359 });
    relayout(a, b);
    await delivered();

    const [x, y] = numbers(playsOn(b)[0].keyframes[0].transform);
    expect(x).toBe(0);
    expect(y).toBeLessThan(0);
  });
});

describe("chiudere", () => {
  it("del foglio chiuso resta una sagoma ferma che si dissolve, e poi se ne va", async () => {
    const a = sheet("a", LEFT);
    const b = sheet("b", RIGHT);
    desk([]);
    relayout(a, b);
    mountStageMotion(lifetime);

    place(a, WHOLE);
    relayout(a);
    await delivered();

    const ghost = document.body.querySelector<HTMLElement>(":scope > .sheet-ghost");
    expect(ghost).not.toBeNull();
    expect(ghost!.getAttribute("aria-hidden")).toBe("true");
    expect(ghost!.style.left).toBe(`${RIGHT.left}px`);
    expect(ghost!.style.top).toBe(`${RIGHT.top}px`);
    expect(ghost!.style.width).toBe(`${RIGHT.width}px`);
    expect(ghost!.style.height).toBe(`${RIGHT.height}px`);
    // A riposo non si vede: la corsa la porta a zero, e zero resta.
    expect(ghost!.style.opacity).toBe("0");
    const [fade] = playsOn(ghost!);
    expect(fade.keyframes[0].opacity).toBe(1);
    expect(fade.keyframes[fade.keyframes.length - 1].opacity).toBe(0);

    // Il vicino si allarga sopra il suo posto.
    const [x, , scaleX] = numbers(playsOn(a, "::before")[0].keyframes[0].transform);
    expect(x).toBeLessThan(0);
    expect(scaleX).toBeCloseTo(LEFT.width / WHOLE.width, 3);

    driver.advance(5000);
    await delivered();
    expect(document.querySelector(".sheet-ghost")).toBeNull();
  });

  it("chiuso mentre entrava, la sagoma prosegue da dove il foglio si vedeva", async () => {
    const a = sheet("a", WHOLE);
    desk([a]);
    mountStageMotion(lifetime);

    place(a, LEFT);
    const b = sheet("b", RIGHT);
    relayout(a, b);
    await delivered();
    driver.advance(50);

    place(a, WHOLE);
    relayout(a);
    await delivered();

    const ghost = document.querySelector<HTMLElement>(".sheet-ghost")!;
    const [fade] = playsOn(ghost);
    const opacity = Number(fade.keyframes[0].opacity);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    // Ancora un po' a sinistra del suo posto, come lo si vedeva.
    expect(Number.parseFloat(ghost.style.left)).toBeLessThan(RIGHT.left);
    // La corsa d'entrata non resta appesa a un foglio che non c'è più.
    expect(playsOn(b)[0].state).toBe("canceled");
  });

  it("nel livello ridotto non resta niente: né sagoma né carta in viaggio", async () => {
    setMotionPreference("reduced");
    const a = sheet("a", LEFT);
    const b = sheet("b", RIGHT);
    desk([]);
    relayout(a, b);
    mountStageMotion(lifetime);

    place(a, WHOLE);
    relayout(a);
    await delivered();
    expect(document.querySelector(".sheet-ghost")).toBeNull();
    expect(playsOn(a, "::before")).toHaveLength(0);
  });
});

describe("che cosa non è un cambio di disposizione", () => {
  it("un altro gruppo di fogli — un'area di lavoro, un vault — non si anima", async () => {
    const a = sheet("a", WHOLE);
    desk([a]);
    mountStageMotion(lifetime);

    relayout(sheet("c", LEFT), sheet("d", RIGHT));
    await delivered();
    expect(driver.plays).toHaveLength(0);
    expect(document.querySelector(".sheet-ghost")).toBeNull();
  });

  it("un foglio che non cambia riquadro non ha corse", async () => {
    const a = sheet("a", LEFT);
    const b = sheet("b", RIGHT);
    desk([]);
    relayout(a, b);
    mountStageMotion(lifetime);

    relayout(a, b);
    await delivered();
    expect(driver.plays).toHaveLength(0);
  });

  it("chiusa la vita, il palco non guarda più", async () => {
    const a = sheet("a", WHOLE);
    desk([a]);
    mountStageMotion(lifetime);
    lifetime.close();

    place(a, LEFT);
    relayout(a, sheet("b", RIGHT));
    await delivered();
    expect(driver.plays).toHaveLength(0);
  });
});

describe("la cornice", () => {
  it("un cassetto che ricompare entra dal suo bordo", async () => {
    desk([sheet("a", WHOLE)], { sidebar: true });
    mountStageMotion(lifetime);

    const sidebar = document.getElementById("sidebar")!;
    sidebar.hidden = false;
    await delivered();
    const [entry] = playsOn(sidebar);
    expect(entry).toBeDefined();
    expect(String(entry.keyframes[0].transform)).toMatch(/translate\(-28px, 0px\)/);
    expect(entry.keyframes[0].opacity).toBe(0);
  });

  it("uno che sparisce non ha corse: lo racconta la carta che prende il suo posto", async () => {
    const a = sheet("a", WHOLE);
    desk([a]);
    mountStageMotion(lifetime);

    const sidebar = document.getElementById("sidebar")!;
    sidebar.hidden = true;
    place(a, { left: 52, top: 40, width: 1220, height: 726 });
    await delivered();
    expect(playsOn(sidebar)).toHaveLength(0);
    expect(playsOn(a, "::before")).toHaveLength(1);
  });

  it("la concentrazione rimette in moto i fogli senza toccare il loro contenuto", async () => {
    const a = sheet("a", WHOLE);
    desk([a]);
    mountStageMotion(lifetime);

    place(a, { left: 212, top: 40, width: 856, height: 752 });
    document.getElementById("app")!.dataset.focusMode = "";
    await delivered();
    expect(playsOn(a, "::before")).toHaveLength(1);
    expect(playsOn(a)).toHaveLength(0);
  });
});
