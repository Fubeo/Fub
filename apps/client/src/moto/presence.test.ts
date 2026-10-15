// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../ui/lifetime";
import { activeMotions } from "./animate";
import { createManualDriver, setMotionDriver, type ManualDriver } from "./driver";
import { setMotionPreference } from "./level";
import { enter, exitGhost, prepareExit } from "./presence";
import { EXIT_SAFETY_MS } from "./spring";

let driver: ManualDriver;
/// Il layout finto: happy-dom non ne ha uno. Un elemento sta dove lo si posa;
/// un'immagine `fixed` sta dove dicono i suoi stili in linea, spostata
/// dall'eventuale antenato che le fa da riferimento.
const layout = new WeakMap<Element, DOMRect>();
const containing = new WeakMap<Element, [number, number]>();

function place(el: Element, left: number, top: number, width: number, height: number): void {
  layout.set(el, new DOMRect(left, top, width, height));
}

function measured(this: Element): DOMRect {
  const placed = layout.get(this);
  if (placed) return placed;
  const style = (this as HTMLElement).style;
  if (style?.position !== "fixed") return new DOMRect();
  const [offsetX, offsetY] = (this.parentElement && containing.get(this.parentElement)) ?? [0, 0];
  return new DOMRect(
    parseFloat(style.left) + offsetX,
    parseFloat(style.top) + offsetY,
    parseFloat(style.width),
    parseFloat(style.height),
  );
}

function surface(): HTMLElement {
  const el = document.createElement("section");
  el.id = "pannello";
  el.className = "pannello";
  el.setAttribute("aria-labelledby", "titolo");
  el.innerHTML =
    '<h2 id="titolo">Titolo</h2>' +
    '<label for="campo">Nome</label><input id="campo" name="nome" aria-describedby="aiuto">' +
    '<p id="aiuto">Aiuto</p>' +
    '<button type="button" aria-controls="pannello">Chiudi</button>';
  document.body.append(el);
  place(el, 40, 60, 320, 200);
  return el;
}

const ghostOf = (parent: Element = document.body): HTMLElement | null =>
  parent.querySelector<HTMLElement>(":scope > [inert]");

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(measured);
});

afterEach(() => {
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  expect(document.querySelector("[inert]")).toBeNull();
  setMotionDriver(null);
  setMotionPreference("system");
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("exitGhost", () => {
  it("posa un clone inerte e senza identità sul rettangolo dell'elemento", () => {
    const el = surface();
    const before = el.outerHTML;
    const motion = exitGhost(el);
    expect(motion.running).toBe(true);

    const ghost = ghostOf();
    expect(ghost).not.toBeNull();
    if (!ghost) return;
    expect(ghost).not.toBe(el);
    expect(ghost.className).toBe("pannello");
    expect(ghost.textContent).toBe(el.textContent);
    expect(ghost.hasAttribute("inert")).toBe(true);
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    for (const name of ["id", "for", "name", "aria-labelledby", "aria-describedby", "aria-controls"]) {
      expect(ghost.hasAttribute(name), name).toBe(false);
      expect(ghost.querySelector(`[${name}]`), name).toBeNull();
    }
    expect(document.querySelectorAll("#pannello, #titolo, #campo, #aiuto")).toHaveLength(4);

    expect(ghost.style.position).toBe("fixed");
    expect(ghost.style.pointerEvents).toBe("none");
    expect(ghost.style.margin).toBe("0px");
    expect([ghost.style.left, ghost.style.top, ghost.style.width, ghost.style.height]).toEqual([
      "40px",
      "60px",
      "320px",
      "200px",
    ]);

    // L'elemento vero non è stato toccato: né stile, né attributi, né corsa.
    expect(el.outerHTML).toBe(before);
    expect(driver.plays.map((play) => play.el)).toEqual([ghost]);
    // Di serie è la sola dissolvenza.
    const frames = driver.plays[0].keyframes;
    expect(frames[0]).toEqual({ opacity: 1 });
    expect(frames[frames.length - 1]).toEqual({ opacity: 0 });
  });

  it("toglie l'immagine quando la corsa finisce", async () => {
    const el = surface();
    const motion = exitGhost(el, { to: { opacity: 0, scale: 0.98 }, spring: "snap" });
    el.remove();
    expect(ghostOf()).not.toBeNull();
    driver.advance(driver.plays[0].timing.duration - 1);
    expect(ghostOf()).not.toBeNull();
    driver.advance(2);
    expect(ghostOf()).toBeNull();
    expect(motion.running).toBe(false);
    await expect(motion.finished).resolves.toBeUndefined();
  });

  it("una molla più lunga del tetto di sicurezza è troncata lì", () => {
    const el = surface();
    exitGhost(el, { to: { y: 600, opacity: 0 }, spring: "jelly" });
    const { timing, keyframes } = driver.plays[0];
    expect(timing.duration).toBeLessThanOrEqual(EXIT_SAFETY_MS);
    expect(timing.duration).toBeGreaterThan(EXIT_SAFETY_MS - 20);
    // Troncata, non compressa: i campioni sono quelli della molla intera.
    expect(keyframes[keyframes.length - 1]).not.toEqual({ transform: "translate(0px, 600px)", opacity: 0 });

    driver.advance(EXIT_SAFETY_MS - 20);
    expect(ghostOf()).not.toBeNull();
    driver.advance(21);
    expect(ghostOf()).toBeNull();
  });

  it("il tetto conta anche il ritardo, e una curva a tempo ci sta dentro", () => {
    const el = surface();
    exitGhost(el, { duration: 900, delay: 200 });
    expect(driver.plays[0].timing).toMatchObject({ delay: 200, duration: EXIT_SAFETY_MS - 200 });
    driver.advance(EXIT_SAFETY_MS + 1);
    expect(ghostOf()).toBeNull();

    // Un ritardo che da solo passa il tetto non lascia un'immagine appesa.
    const late = exitGhost(el, { delay: 5000 });
    expect(late.running).toBe(false);
    expect(ghostOf()).toBeNull();
    expect(driver.plays).toHaveLength(1);
  });

  it("annullata, o chiusa la vita, l'immagine sparisce subito", () => {
    const el = surface();
    exitGhost(el).cancel();
    expect(ghostOf()).toBeNull();

    const life = openLifetime();
    const motion = exitGhost(el, { lifetime: life });
    expect(ghostOf()).not.toBeNull();
    life.close();
    expect(ghostOf()).toBeNull();
    expect(motion.running).toBe(false);
  });

  it("nel livello «ridotto» non crea niente, nemmeno con la dissolvenza", () => {
    const el = surface();
    setMotionPreference("reduced");
    const motion = exitGhost(el, { whenReduced: "fade" });
    expect(motion.running).toBe(false);
    expect(document.body.children).toHaveLength(1);
    expect(driver.plays).toHaveLength(0);
  });

  it("col motore istantaneo, fuori dal documento o senza riquadro non crea niente", () => {
    const el = surface();
    place(el, 0, 0, 0, 0);
    expect(exitGhost(el).running).toBe(false);

    const detached = document.createElement("div");
    place(detached, 0, 0, 100, 100);
    expect(exitGhost(detached).running).toBe(false);

    setMotionDriver(null);
    place(el, 40, 60, 320, 200);
    expect(exitGhost(el).running).toBe(false);
    expect(document.body.children).toHaveLength(1);
    expect(driver.plays).toHaveLength(0);
  });

  it("posa l'immagine nello strato chiesto e corregge un riferimento spostato", () => {
    const el = surface();
    const layer = document.createElement("div");
    document.body.append(layer);
    // Lo strato ha un antenato trasformato: `fixed` si riferisce a lui.
    containing.set(layer, [30, -12]);
    exitGhost(el, { layer });
    const ghost = ghostOf(layer);
    expect(ghostOf()).toBeNull();
    expect([ghost?.style.left, ghost?.style.top]).toEqual(["10px", "72px"]);
    expect(ghost?.getBoundingClientRect()).toMatchObject({ left: 40, top: 60 });
  });

  it("porta con sé ciò che il clone non copia: scorrimento e voce scelta", () => {
    const el = surface();
    const list = document.createElement("div");
    const select = document.createElement("select");
    select.innerHTML = "<option>a</option><option>b</option><option>c</option>";
    el.append(list, select);
    list.scrollTop = 120;
    select.selectedIndex = 2;

    exitGhost(el);
    const ghost = ghostOf();
    expect(ghost?.querySelector("div")?.scrollTop).toBe(120);
    expect(ghost?.querySelector("select")?.selectedIndex).toBe(2);
  });
});

describe("prepareExit", () => {
  it("misura subito e parte dopo: l'elemento può essere già stato tolto", () => {
    const el = surface();
    const ghost = prepareExit(el);
    expect(ghostOf()).toBeNull();
    el.remove();
    layout.delete(el);

    const motion = ghost.play({ to: { y: 8, opacity: 0 } });
    expect(motion.running).toBe(true);
    expect([ghostOf()?.style.left, ghostOf()?.style.top]).toEqual(["40px", "60px"]);
    // Vale una volta.
    expect(ghost.play().running).toBe(false);
    expect(document.querySelectorAll("[inert]")).toHaveLength(1);
  });

  it("se l'elemento stava entrando, l'immagine esce dalla posa in cui era", () => {
    const el = surface();
    enter(el, { from: { y: 12, opacity: 0 } });
    driver.advance(50);
    exitGhost(el);

    expect(driver.plays[0].state).toBe("canceled");
    expect(driver.plays[1].el).toBe(ghostOf());
    const first = driver.plays[1].keyframes[0];
    const y = Number(/translate\(0px, (-?[\d.]+)px\)/.exec(String(first.transform))?.[1]);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(12);
    expect(Number(first.opacity)).toBeGreaterThan(0);
    expect(Number(first.opacity)).toBeLessThan(1);
  });
});

describe("ciò che dentro l'elemento era in corsa", () => {
  it("nell'immagine prosegue da dov'era, e finisce con lei", () => {
    const el = surface();
    const inner = el.querySelector("h2")!;
    enter(inner, { from: { y: 12, opacity: 0 } });
    driver.advance(50);
    exitGhost(el, { to: { opacity: 0 } });

    const copy = ghostOf()!.querySelector("h2")!;
    const carried = driver.plays.find((play) => play.el === copy);
    expect(carried).toBeDefined();
    const first = carried!.keyframes[0];
    const y = Number(/translate\(0px, (-?[\d.]+)px\)/.exec(String(first.transform))?.[1]);
    // Né dal punto di partenza né dal riposo: da dov'era.
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(12);
    expect(Number(first.opacity)).toBeGreaterThan(0);
    expect(Number(first.opacity)).toBeLessThan(1);
    expect(carried!.keyframes[carried!.keyframes.length - 1]).toMatchObject({ opacity: 1 });

    // L'immagine se ne va, e con lei ciò che portava.
    driver.advance(EXIT_SAFETY_MS);
    expect(ghostOf()).toBeNull();
    expect(carried!.state).not.toBe("running");
  });

  it("ciò che era fermo resta un'immagine ferma", () => {
    const el = surface();
    exitGhost(el);
    expect(driver.plays.map((play) => play.el)).toEqual([ghostOf()]);
  });
});

describe("enter", () => {
  it("anima dalla posa data verso il riposo", () => {
    const el = surface();
    const motion = enter(el, { from: { y: 6, opacity: 0 }, spring: "snap" });
    const frames = driver.plays[0].keyframes;
    expect(frames[0]).toEqual({ transform: "translate(0px, 6px)", opacity: 0 });
    expect(frames[frames.length - 1]).toEqual({ transform: "translate(0px, 0px)", opacity: 1 });
    driver.advance(2000);
    expect(motion.running).toBe(false);
    expect(el.getAttribute("style")).toBeNull();
  });

  it("riaprire durante l'uscita inverte: via l'immagine, si riparte dalla sua posa", () => {
    const el = surface();
    const exit = exitGhost(el, { to: { y: 20, opacity: 0 } });
    driver.advance(50);
    expect(ghostOf()).not.toBeNull();

    enter(el, { from: { y: 20, opacity: 0 } });
    expect(exit.running).toBe(false);
    expect(ghostOf()).toBeNull();
    expect(driver.plays[1].el).toBe(el);
    const first = driver.plays[1].keyframes[0];
    const y = Number(/translate\(0px, (-?[\d.]+)px\)/.exec(String(first.transform))?.[1]);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(20);
    expect(Number(first.opacity)).toBeGreaterThan(0);
    expect(Number(first.opacity)).toBeLessThan(1);

    // Finita l'uscita non c'è più niente da ereditare.
    driver.advance(2000);
    exitGhost(el);
    driver.advance(2000);
    enter(el, { from: { y: 20, opacity: 0 } });
    expect(driver.plays[driver.plays.length - 1].keyframes[0]).toEqual({
      transform: "translate(0px, 20px)",
      opacity: 0,
    });
  });
});
