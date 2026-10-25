// @vitest-environment happy-dom
//
// Il presidio della coreografia di shell: le superfici passano da `moto`, lo
// stato cambia subito, l'uscita è un'immagine breve, riaprire durante l'uscita
// riparte da lì, e nessuna View Transition. Il tempo è quello del motore a
// mano: le corse sono quelle che il motore riceve.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DURATION, createManualDriver, setMotionDriver, setMotionPreference, type ManualDriver } from "../moto";
import { enterSurface, exitSurface } from "./motion";

let driver: ManualDriver;

function surface(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  // happy-dom non impagina: un'uscita ha bisogno di un riquadro da fotografare.
  el.getBoundingClientRect = () => new DOMRect(10, 10, 200, 100);
  document.body.append(el);
  return el;
}

const lengths = (from: number) => driver.plays.slice(from).map((play) => play.timing.delay + play.timing.duration);

describe("la coreografia delle superfici", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    setMotionPreference("system");
    driver = createManualDriver();
    setMotionDriver(driver);
  });

  afterEach(() => {
    setMotionDriver(null);
    setMotionPreference("system");
  });

  it("entra con una corsa di moto e non lascia attributi di stato", () => {
    const menu = surface("context-menu");
    enterSurface(menu);
    expect(driver.plays).toHaveLength(1);
    expect(driver.plays[0]!.el).toBe(menu);
    expect(menu.dataset.shellMotion).toBeUndefined();
    driver.advance(1000);
    expect(driver.plays[0]!.state).toBe("finished");
  });

  it("esce subito, e ne resta un'immagine che se ne va entro `swap`", () => {
    const panel = surface("settings-panel");
    let concealed = 0;
    exitSurface(panel, () => {
      concealed++;
      panel.hidden = true;
    });
    expect(concealed).toBe(1);
    const ghost = driver.plays[0]!.el;
    expect(ghost).not.toBe(panel);
    expect(ghost.isConnected).toBe(true);
    expect(Math.max(...lengths(0))).toBeLessThanOrEqual(DURATION.swap);
    driver.advance(DURATION.swap + 20);
    expect(ghost.isConnected).toBe(false);
  });

  it("una superficie già nascosta non lascia immagini, e la chiusura arriva lo stesso", () => {
    const panel = surface("settings-panel");
    panel.hidden = true;
    let concealed = 0;
    exitSurface(panel, () => concealed++);
    expect(concealed).toBe(1);
    expect(driver.plays).toHaveLength(0);
  });

  it("riaprire durante l'uscita toglie l'immagine e riparte da dove era", () => {
    const panel = surface("settings-panel");
    exitSurface(panel, () => {
      panel.hidden = true;
    });
    const ghost = driver.plays[0]!.el;
    driver.advance(50);
    panel.hidden = false;
    enterSurface(panel);
    expect(ghost.isConnected).toBe(false);
    const run = driver.plays[driver.plays.length - 1]!;
    expect(run.el).toBe(panel);
    // Parte dall'opacità che l'immagine aveva, non da zero.
    expect(Number(run.keyframes[0]!.opacity)).toBeGreaterThan(0);
  });

  it("la modale fa scendere la sua scatola, insieme al velo", () => {
    const overlay = surface("modale");
    const box = document.createElement("div");
    box.className = "palette-box";
    overlay.append(box);
    enterSurface(overlay);
    expect(driver.plays.map((play) => play.el)).toEqual([overlay, box]);
  });

  it("non avvia mai una View Transition, anche dove il motore le ha", () => {
    const start = vi.fn();
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
    const panel = surface("settings-panel");
    enterSurface(panel);
    exitSurface(panel, () => panel.remove());
    expect(start).not.toHaveBeenCalled();
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: undefined });
  });

  it("col moto ridotto resta la sola dissolvenza d'entrata, e l'uscita è immediata", () => {
    setMotionPreference("reduced");
    const panel = surface("settings-panel");
    let concealed = 0;
    enterSurface(panel);
    expect(driver.plays).toHaveLength(1);
    expect(Object.keys(driver.plays[0]!.keyframes[0]!).filter((key) => key !== "offset")).toEqual(["opacity"]);
    exitSurface(panel, () => concealed++);
    expect(concealed).toBe(1);
    expect(driver.plays).toHaveLength(1);
  });
});
