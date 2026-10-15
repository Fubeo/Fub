// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference } from "../moto";
import { checkAccessibility, formatIssues } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { RESIST_LIMIT_PX, mountSplitter, resist, type SplitterOptions } from "./splitter";
import { listenerLedger, pointer, press } from "./testing";

const MIN = 160;
const MAX = 480;

let life: Lifetime;
let handle: HTMLElement;
/// La misura che il chiamante tiene: `onCommit` la scrive, `value()` la legge.
let width: number;
let inputs: number[];
let commits: number[];
let resets: number;
let time: number;

function mount(extra: Partial<SplitterOptions> = {}) {
  return mountSplitter({
    handle,
    orientation: "vertical",
    value: () => width,
    min: MIN,
    max: MAX,
    label: "Larghezza del cassetto",
    onInput: (px) => inputs.push(px),
    onCommit: (px) => {
      commits.push(px);
      width = px;
    },
    onReset: () => {
      resets += 1;
      width = 240;
    },
    lifetime: life,
    ...extra,
  });
}

/// Un evento del puntatore sul gesto: si preme sulla maniglia, il resto arriva
/// al documento. Ogni evento avanza l'orologio di un fotogramma.
function send(type: string, x: number, y = 0): void {
  time += 16;
  const event = pointer(type, { clientX: x, clientY: y });
  Object.defineProperty(event, "timeStamp", { value: time });
  (type === "pointerdown" ? handle : document).dispatchEvent(event);
}

const now = (): number => Number(handle.getAttribute("aria-valuenow"));

/// Lo spostamento di un fotogramma della maniglia, in px per asse.
function shift(frame: Keyframe): [number, number] {
  const [x, y] = (/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(frame.transform)) ?? []).slice(1).map(Number);
  return [x, y];
}

beforeEach(() => {
  life = openLifetime();
  handle = document.createElement("div");
  document.body.append(handle);
  const captured = new Set<number>();
  handle.setPointerCapture = (id) => void captured.add(id);
  handle.hasPointerCapture = (id) => captured.has(id);
  handle.releasePointerCapture = (id) => void captured.delete(id);
  width = 240;
  inputs = [];
  commits = [];
  resets = 0;
  time = 0;
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
  setMotionDriver(null);
  setMotionPreference("system");
  vi.restoreAllMocks();
});

describe("la forma", () => {
  it("è un separatore a fuoco, con orientamento, nome, misura e limiti", () => {
    mount({ controls: "cassetto" });
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-label")).toBe("Larghezza del cassetto");
    expect(handle.getAttribute("aria-controls")).toBe("cassetto");
    expect(handle.getAttribute("aria-valuemin")).toBe("160");
    expect(handle.getAttribute("aria-valuemax")).toBe("480");
    expect(handle.getAttribute("aria-valuenow")).toBe("240");
    expect(handle.tabIndex).toBe(0);
    expect(handle.classList.contains("kit-splitter")).toBe(true);
    expect(handle.hasAttribute("data-dragging")).toBe(false);
  });

  it("supera il controllo di accessibilità della shell", () => {
    mount();
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
  });

  it("sync rilegge misura e limiti, e tiene la misura dentro di loro", () => {
    let max = MAX;
    const splitter = mount({ max: () => max });
    width = 300.4;
    max = 280;
    splitter.sync();
    expect(handle.getAttribute("aria-valuemax")).toBe("280");
    expect(handle.getAttribute("aria-valuenow")).toBe("280");
    width = 20;
    splitter.sync();
    expect(handle.getAttribute("aria-valuenow")).toBe("160");
  });

  it("un massimo sotto il minimo vale il minimo", () => {
    mount({ max: 100 });
    expect(handle.getAttribute("aria-valuemax")).toBe("160");
    press(handle, "End");
    expect(commits).toEqual([160]);
  });
});

describe("la tastiera", () => {
  it("le frecce spostano di un passo, con Maiusc di cinque", () => {
    mount();
    expect(press(handle, "ArrowRight").defaultPrevented).toBe(true);
    expect(commits).toEqual([256]);
    press(handle, "ArrowLeft", { shiftKey: true });
    expect(commits).toEqual([256, 176]);
    // Ogni scelta arriva anche come proposta, con lo stesso valore.
    expect(inputs).toEqual([256, 176]);
    expect(now()).toBe(176);
  });

  it("il passo è quello chiesto", () => {
    mount({ step: 10 });
    press(handle, "ArrowRight");
    press(handle, "ArrowRight", { shiftKey: true });
    expect(commits).toEqual([250, 300]);
  });

  it("le frecce si fermano ai limiti", () => {
    mount();
    width = 470;
    press(handle, "ArrowRight");
    expect(commits).toEqual([480]);
    width = 165;
    press(handle, "ArrowLeft", { shiftKey: true });
    expect(commits).toEqual([480, 160]);
  });

  it("Inizio e Fine vanno ai limiti", () => {
    mount();
    press(handle, "End");
    press(handle, "Home");
    expect(commits).toEqual([480, 160]);
    expect(now()).toBe(160);
  });

  it("le frecce dell'altro asse e quelle con Ctrl non sono sue", () => {
    mount();
    expect(press(handle, "ArrowDown").defaultPrevented).toBe(false);
    expect(press(handle, "ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(commits).toEqual([]);
  });

  it("una maniglia orizzontale si sposta con su e giù", () => {
    mount({ orientation: "horizontal" });
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
    expect(press(handle, "ArrowRight").defaultPrevented).toBe(false);
    press(handle, "ArrowDown");
    press(handle, "ArrowUp");
    press(handle, "ArrowUp");
    expect(commits).toEqual([256, 240, 224]);
  });

  it("col riquadro dopo la maniglia andare avanti lo restringe", () => {
    mount({ reverse: true });
    press(handle, "ArrowRight");
    press(handle, "ArrowLeft");
    press(handle, "ArrowLeft");
    expect(commits).toEqual([224, 240, 256]);
    // Inizio e Fine restano minimo e massimo della misura.
    press(handle, "Home");
    expect(commits[3]).toBe(160);
  });

  it("Invio e il doppio clic tornano alla misura di serie", () => {
    mount();
    width = 400;
    expect(press(handle, "Enter").defaultPrevented).toBe(true);
    expect(resets).toBe(1);
    expect(now()).toBe(240);
    width = 400;
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(resets).toBe(2);
    expect(now()).toBe(240);
    expect(commits).toEqual([]);
  });

  it("senza una misura di serie Invio passa oltre", () => {
    mount({ onReset: undefined });
    expect(press(handle, "Enter").defaultPrevented).toBe(false);
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(resets).toBe(0);
  });
});

describe("il gesto", () => {
  it("sotto la soglia non comincia: un clic resta un clic", () => {
    mount();
    send("pointerdown", 500);
    send("pointermove", 502);
    send("pointerup", 502);
    expect(inputs).toEqual([]);
    expect(commits).toEqual([]);
    expect(handle.hasAttribute("data-dragging")).toBe(false);
  });

  it("propone la misura mentre dura, la segna sulla maniglia e la consegna alla fine", () => {
    mount();
    send("pointerdown", 500);
    send("pointermove", 520);
    expect(handle.hasAttribute("data-dragging")).toBe(true);
    expect(inputs).toEqual([260]);
    expect(now()).toBe(260);
    send("pointermove", 560);
    expect(inputs).toEqual([260, 300]);
    expect(commits).toEqual([]);
    send("pointerup", 560);
    expect(commits).toEqual([300]);
    expect(handle.hasAttribute("data-dragging")).toBe(false);
    expect(now()).toBe(300);
  });

  it("una maniglia orizzontale segue l'altro asse, e una rovesciata va al contrario", () => {
    mount({ orientation: "horizontal" });
    send("pointerdown", 0, 300);
    send("pointermove", 80, 330);
    send("pointerup", 80, 330);
    expect(commits).toEqual([270]);
    life.close();

    life = openLifetime();
    width = 240;
    commits = [];
    mount({ reverse: true });
    send("pointerdown", 500);
    send("pointermove", 540);
    send("pointerup", 540);
    expect(commits).toEqual([200]);
  });

  it("Esc annulla: la misura torna quella di partenza e niente è consegnato", () => {
    mount();
    send("pointerdown", 500);
    send("pointermove", 560);
    const escape = press(handle, "Escape");
    // Il gesto consuma il tasto: non deve chiudere anche la superficie sotto.
    expect(escape.defaultPrevented).toBe(true);
    expect(inputs).toEqual([300, 240]);
    expect(commits).toEqual([]);
    expect(handle.hasAttribute("data-dragging")).toBe(false);
    expect(now()).toBe(240);
    // Il rilascio che arriva dopo non conta più.
    send("pointerup", 560);
    expect(commits).toEqual([]);
  });
});

describe("oltre i limiti", () => {
  it("la resistenza cede sempre meno e non passa il suo tetto", () => {
    expect(resist(0)).toBe(0);
    expect(resist(10)).toBeGreaterThan(0);
    expect(resist(10)).toBeLessThan(10);
    expect(resist(-10)).toBeCloseTo(-resist(10), 10);
    let previous = 0;
    let gain = Infinity;
    for (let over = 10; over <= 400; over += 10) {
      const moved = resist(over);
      expect(moved).toBeGreaterThan(previous);
      expect(moved).toBeLessThan(RESIST_LIMIT_PX);
      // Ogni dieci pixel in più rendono meno dei dieci prima.
      expect(moved - previous).toBeLessThan(gain);
      gain = moved - previous;
      previous = moved;
    }
    expect(resist(100000)).toBeLessThan(RESIST_LIMIT_PX);
  });

  it("il gesto propone poco oltre il limite, ma consegna il limite", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    mount();
    send("pointerdown", 500);
    send("pointermove", 800);
    // Il puntatore chiede 540, sessanta oltre il massimo.
    const [proposed] = inputs;
    expect(proposed).toBeCloseTo(MAX + resist(60), 6);
    expect(proposed).toBeGreaterThan(MAX);
    expect(proposed).toBeLessThan(MAX + RESIST_LIMIT_PX);
    // Per chi ascolta la misura non esce mai dai limiti.
    expect(now()).toBe(MAX);

    send("pointerup", 800);
    // La consegna è immediata, e la misura con lei: niente si riscrive dopo.
    expect(commits).toEqual([MAX]);
    expect(inputs[inputs.length - 1]).toBe(MAX);
    const settled = inputs.length;
    // Ciò che si vede è la maniglia che torna sul limite, da dov'era rimasta:
    // una trasformazione, con la molla elastica.
    expect(driver.plays).toHaveLength(1);
    const [back] = driver.plays;
    expect(back.el).toBe(handle);
    expect(shift(back.keyframes[0])[0]).toBeCloseTo(resist(60), 1);
    expect(shift(back.keyframes[0])[1]).toBe(0);
    expect(shift(back.keyframes[back.keyframes.length - 1])).toEqual([0, 0]);
    expect(Object.keys(back.keyframes[0])).toEqual(["transform"]);
    driver.advance(3000);
    expect(activeMotions()).toBe(0);
    expect(inputs).toHaveLength(settled);
    expect(commits).toEqual([MAX]);
  });

  it("vale anche sotto il minimo", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    mount();
    send("pointerdown", 500);
    send("pointermove", 300);
    expect(inputs[0]).toBeCloseTo(MIN - resist(120), 6);
    expect(inputs[0]).toBeGreaterThan(MIN - RESIST_LIMIT_PX);
    send("pointerup", 300);
    expect(commits).toEqual([MIN]);
    expect(inputs[inputs.length - 1]).toBe(MIN);
    // Sotto il minimo la maniglia era rimasta a sinistra del limite.
    expect(shift(driver.plays[0].keyframes[0])[0]).toBeCloseTo(-resist(120), 1);
    driver.advance(3000);
  });

  it("una maniglia orizzontale torna in verticale, e una rovesciata dall'altra parte", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    mount({ orientation: "horizontal", reverse: true });
    send("pointerdown", 0, 500);
    // Il riquadro sta sotto: salire lo allarga, oltre il massimo.
    send("pointermove", 0, 200);
    send("pointerup", 0, 200);
    expect(commits).toEqual([MAX]);
    const [x, y] = shift(driver.plays[0].keyframes[0]);
    expect(x).toBe(0);
    expect(y).toBeCloseTo(-resist(60), 1);
    driver.advance(3000);
  });

  it("un gesto nuovo ferma il ritorno di quello prima", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    mount();
    send("pointerdown", 500);
    send("pointermove", 800);
    send("pointerup", 800);
    expect(activeMotions()).toBeGreaterThan(0);
    send("pointerdown", 500);
    send("pointermove", 480);
    expect(activeMotions()).toBe(0);
    expect(inputs[inputs.length - 1]).toBe(MAX - 20);
    send("pointerup", 480);
    expect(commits).toEqual([MAX, MAX - 20]);
  });

  it("nel livello ridotto si ferma sul limite", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("reduced");
    mount();
    send("pointerdown", 500);
    send("pointermove", 800);
    expect(inputs).toEqual([MAX]);
    send("pointerup", 800);
    expect(commits).toEqual([MAX]);
    expect(activeMotions()).toBe(0);
    expect(inputs.every((px) => px === MAX)).toBe(true);
  });
});

describe("lo smontaggio", () => {
  it("toglie ciò che aveva scritto sulla maniglia", () => {
    mount({ controls: "cassetto" });
    life.close();
    for (const name of [
      "role",
      "aria-orientation",
      "aria-label",
      "aria-controls",
      "aria-valuemin",
      "aria-valuemax",
      "aria-valuenow",
      "tabindex",
    ]) {
      expect(handle.hasAttribute(name)).toBe(false);
    }
    expect(handle.classList.contains("kit-splitter")).toBe(false);
  });

  it("a gesto in corso lo annulla senza consegnare, e non riscrive la maniglia", () => {
    mount();
    send("pointerdown", 500);
    send("pointermove", 560);
    life.close();
    expect(inputs).toEqual([300, 240]);
    expect(commits).toEqual([]);
    expect(handle.hasAttribute("data-dragging")).toBe(false);
    expect(handle.hasAttribute("aria-valuenow")).toBe(false);
  });

  it("a ritorno in corso ferma la molla", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    mount();
    send("pointerdown", 500);
    send("pointermove", 800);
    send("pointerup", 800);
    expect(activeMotions()).toBeGreaterThan(0);
    life.close();
    expect(activeMotions()).toBe(0);
    expect(driver.plays[0].state).toBe("canceled");
  });

  it("smontato, non risponde più; rimontato molte volte non lascia ascolti sul documento", () => {
    const live = listenerLedger(window, document);
    for (let round = 0; round < 5; round++) {
      const each = openLifetime();
      mount({ lifetime: each });
      send("pointerdown", 500);
      send("pointermove", 540);
      expect(live()).toBeGreaterThan(0);
      if (round % 2 === 0) send("pointerup", 540);
      each.close();
      expect(live()).toBe(0);
    }
    inputs = [];
    commits = [];
    press(handle, "ArrowRight");
    send("pointerdown", 500);
    send("pointermove", 560);
    send("pointerup", 560);
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(inputs).toEqual([]);
    expect(commits).toEqual([]);
  });
});
