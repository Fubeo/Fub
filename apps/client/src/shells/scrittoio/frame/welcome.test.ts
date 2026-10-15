// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeMotions,
  createManualDriver,
  setMotionDriver,
  setMotionPreference,
  type ManualDriver,
  type RecordedPlay,
} from "../../../moto";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { mountWelcome } from "./welcome";

/// Gli osservatori consegnano a fine giro.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const app = (): HTMLElement => document.getElementById("app") as HTMLElement;
const onboarding = (): HTMLElement => document.getElementById("onboarding") as HTMLElement;
const recents = (): HTMLElement => document.getElementById("onboarding-recent") as HTMLElement;

/// La finestra che il markup promette, con il benvenuto in vista o no.
function frame(visible: boolean): void {
  document.body.innerHTML = `
    <div id="app">
      <div id="onboarding"${visible ? "" : " hidden"}>
        <ul id="onboarding-recent"></ul>
      </div>
    </div>`;
  // happy-dom non impagina: l'elenco sta in un posto finto, largo 400 e alto 100.
  recents().getBoundingClientRect = () => ({ left: 100, top: 300, width: 400, height: 100, right: 500, bottom: 400 }) as DOMRect;
}

const WIDTH = 100;
const HEIGHT = 100;

/// Riscrive l'elenco come fa la shell comune: fogli nuovi, in fila da sinistra.
function populate(count: number): HTMLElement[] {
  const sheets: HTMLElement[] = [];
  for (let index = 0; index < count; index++) {
    const sheet = document.createElement("li");
    const left = 100 + index * WIDTH;
    sheet.getBoundingClientRect = () =>
      ({ left, top: 300, width: WIDTH, height: HEIGHT, right: left + WIDTH, bottom: 300 + HEIGHT }) as DOMRect;
    sheets.push(sheet);
  }
  recents().replaceChildren(...sheets);
  return sheets;
}

/// La posa del primo fotogramma: da dove parte un foglio.
function start(play: RecordedPlay): { x: number; y: number; rotate: number } {
  const transform = String(play.keyframes[0].transform);
  const move = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform);
  const turn = /rotate\((-?[\d.]+)deg\)/.exec(transform);
  if (!move) throw new Error(`nessuna traslazione in ${transform}`);
  return { x: Number(move[1]), y: Number(move[2]), rotate: turn ? Number(turn[1]) : 0 };
}

let driver: ManualDriver;
let lifetime: Lifetime;

beforeEach(() => {
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
  document.body.replaceChildren();
});

describe("la finestra senza vault", () => {
  it("dice che c'è il benvenuto finché lo si vede, e smette quando un vault si apre", async () => {
    frame(true);
    mountWelcome(lifetime);
    expect(app().dataset.welcome).toBe("");

    onboarding().hidden = true;
    await settled();
    expect(app().dataset.welcome).toBeUndefined();

    onboarding().hidden = false;
    await settled();
    expect(app().dataset.welcome).toBe("");
  });

  it("con un vault già aperto non lo dice", () => {
    frame(false);
    mountWelcome(lifetime);
    expect(app().dataset.welcome).toBeUndefined();
  });

  it("non riscrive il valore che c'è già", async () => {
    frame(true);
    let writes = 0;
    const set = app().setAttribute.bind(app());
    app().setAttribute = (name: string, value: string) => {
      if (name === "data-welcome") writes++;
      set(name, value);
    };
    mountWelcome(lifetime);
    expect(writes).toBe(1);
    // La shell comune rimette `hidden` a ogni giro, anche quando non cambia.
    onboarding().setAttribute("hidden", "");
    onboarding().removeAttribute("hidden");
    await settled();
    populate(2);
    await settled();
    expect(writes).toBe(1);
  });

  it("senza il markup che si aspetta non fa niente e non lancia", () => {
    document.body.innerHTML = '<div id="app"></div>';
    expect(() => mountWelcome(lifetime)).not.toThrow();
    expect(app().dataset.welcome).toBeUndefined();
  });

  it("chiusa la vita non segue più", async () => {
    frame(true);
    mountWelcome(lifetime);
    lifetime.close();
    onboarding().hidden = true;
    await settled();
    expect(app().dataset.welcome).toBe("");
  });
});

describe("i vault recenti si aprono a ventaglio", () => {
  it("la prima volta che si vedono partono dal mazzo, uno dopo l'altro", async () => {
    frame(true);
    mountWelcome(lifetime);
    expect(driver.plays).toHaveLength(0);

    const sheets = populate(3);
    await settled();
    expect(driver.plays.map((play) => play.el)).toEqual(sheets);
    // Il mazzo sta al centro dell'elenco (x = 300): chi sta a sinistra parte
    // spostato a destra, chi sta a destra a sinistra, quello di mezzo no.
    const poses = driver.plays.map(start);
    expect(poses.map((pose) => pose.x)).toEqual([150, 50, -50]);
    // Tutti partono dallo stesso punto, un poco sotto il loro posto.
    expect(new Set(poses.map((pose) => pose.y)).size).toBe(1);
    expect(poses[0].y).toBeGreaterThan(0);
    // Il ventaglio: ruotati in versi opposti attorno a quello di mezzo.
    expect(poses[0].rotate).toBeLessThan(0);
    expect(poses[1].rotate).toBe(0);
    expect(poses[2].rotate).toBe(-poses[0].rotate);
    // Sfalsati: ognuno aspetta più del precedente.
    const delays = driver.plays.map((play) => play.timing.delay);
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
    // In fondo alla corsa c'è il riposo del CSS, e non resta niente.
    // Un canale che non si muove non compare: il foglio di mezzo non ruota.
    const rest = driver.plays.map((play) => String(play.keyframes[play.keyframes.length - 1].transform));
    expect(rest).toEqual([
      "translate(0px, 0px) rotate(0deg) scale(1, 1)",
      "translate(0px, 0px) scale(1, 1)",
      "translate(0px, 0px) rotate(0deg) scale(1, 1)",
    ]);
    driver.advance(5000);
    expect(activeMotions()).toBe(0);
  });

  it("una volta sola: l'elenco riscritto dopo non riparte", async () => {
    frame(true);
    mountWelcome(lifetime);
    populate(2);
    await settled();
    expect(driver.plays).toHaveLength(2);
    driver.advance(5000);

    populate(3);
    await settled();
    onboarding().hidden = true;
    await settled();
    onboarding().hidden = false;
    await settled();
    expect(driver.plays).toHaveLength(2);
  });

  it("un elenco riempito mentre il benvenuto è nascosto aspetta che lo si veda", async () => {
    frame(false);
    mountWelcome(lifetime);
    const sheets = populate(2);
    await settled();
    expect(driver.plays).toHaveLength(0);

    onboarding().hidden = false;
    await settled();
    expect(driver.plays.map((play) => play.el)).toEqual(sheets);
  });

  it("i fogli già in elenco al montaggio partono subito", () => {
    frame(true);
    const sheets = populate(2);
    mountWelcome(lifetime);
    expect(driver.plays.map((play) => play.el)).toEqual(sheets);
  });

  it("un elenco vuoto non consuma la volta", async () => {
    frame(true);
    mountWelcome(lifetime);
    populate(0);
    await settled();
    expect(driver.plays).toHaveLength(0);
    populate(1);
    await settled();
    expect(driver.plays).toHaveLength(1);
  });

  it("un mazzo alto non ruota i fogli oltre il limite", async () => {
    frame(true);
    mountWelcome(lifetime);
    populate(8);
    await settled();
    const turns = driver.plays.map((play) => start(play).rotate);
    expect(Math.min(...turns)).toBe(-14);
    expect(Math.max(...turns)).toBe(14);
  });

  it.each(["calm", "reduced"] as const)("nel livello «%s» i fogli stanno fermi, e la volta è spesa", async (level) => {
    setMotionPreference(level);
    frame(true);
    mountWelcome(lifetime);
    populate(3);
    await settled();
    expect(driver.plays).toHaveLength(0);

    setMotionPreference("system");
    populate(3);
    await settled();
    expect(driver.plays).toHaveLength(0);
  });

  it("chiusa la vita a metà corsa i fogli tornano al loro posto", async () => {
    frame(true);
    mountWelcome(lifetime);
    populate(3);
    await settled();
    driver.advance(40);
    expect(activeMotions()).toBeGreaterThan(0);
    lifetime.close();
    expect(activeMotions()).toBe(0);
  });
});
