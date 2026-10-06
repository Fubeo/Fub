// @vitest-environment happy-dom
// Il menu radiale: otto voci in cerchio, il gesto che le sceglie con la
// direzione, la tastiera che le gira attorno.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { registerIcon } from "../../../ui/icons";
import { setReducedMotionPreference } from "../../../theme/reduced-motion";
import { closeRadial, DEAD_PX, openRadial, radialCenter, sectorOf, type RadialItem } from "./radial";

const runs: string[] = [];
const item = (label: string, extra: Partial<RadialItem> = {}): RadialItem => ({ label, icon: "draw-pen", run: () => runs.push(label), ...extra });
/// Le otto voci di prova: la quinta spenta, la sesta che manca.
const ITEMS: (RadialItem | null)[] = [
  item("Annulla", { hint: "Ctrl+Z" }),
  item("Gomma"),
  item("Penna"),
  item("Testo"),
  item("Ripeti", { disabled: true }),
  null,
  item("Colore: Blu", { icon: undefined, swatch: { color: "#0072b2", shape: "square" } }),
  item("Colore: Nero", { icon: undefined, swatch: { color: "#000000", shape: "circle" } }),
];

const layer = (): HTMLElement | null => document.querySelector<HTMLElement>(".draw-radial:not([data-shell-motion='exit'])");
const ring = (): HTMLElement => layer()!.querySelector<HTMLElement>("[role='menu']")!;
const items = (): HTMLButtonElement[] => [...ring().querySelectorAll<HTMLButtonElement>("[role='menuitem']")];
const byLabel = (label: string): HTMLButtonElement => items().find((each) => each.getAttribute("aria-label") === label)!;
const caption = (): string => ring().querySelector(".draw-radial-caption")!.textContent ?? "";
const key = (target: Element, name: string, code = ""): void => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, code, bubbles: true, cancelable: true }));
};
const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}): PointerEvent => {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y, ...extra });
  document.dispatchEvent(event);
  return event;
};

let trigger: HTMLButtonElement;
let retire = (): void => {};

beforeAll(() => {
  retire = registerIcon("draw-pen", ["M4 20l4-1 11-11-3-3L5 16z"]);
});
afterAll(() => retire());

beforeEach(() => {
  runs.length = 0;
  setReducedMotionPreference(true);
  trigger = document.createElement("button");
  trigger.textContent = "Foglio";
  document.body.append(trigger);
  trigger.focus();
});

afterEach(() => {
  closeRadial();
  for (const each of document.querySelectorAll(".draw-radial")) each.remove();
  trigger.remove();
  setReducedMotionPreference(false);
  vi.useRealTimers();
});

describe("la direzione e il posto", () => {
  it("la direzione è una delle otto, dall'alto in senso orario", () => {
    expect(sectorOf(0, -10)).toBe(0);
    expect(sectorOf(7, -7)).toBe(1);
    expect(sectorOf(10, 0)).toBe(2);
    expect(sectorOf(7, 7)).toBe(3);
    expect(sectorOf(0, 10)).toBe(4);
    expect(sectorOf(-7, 7)).toBe(5);
    expect(sectorOf(-10, 0)).toBe(6);
    expect(sectorOf(-7, -7)).toBe(7);
    // Ogni direzione vale fino a metà strada dalle vicine.
    expect(sectorOf(4, -10)).toBe(0);
    expect(sectorOf(5, -10)).toBe(1);
  });

  it("il menu sta intero nella finestra, col nome sopra", () => {
    expect(radialCenter(500, 400, 1024, 768)).toEqual([500, 400]);
    expect(radialCenter(0, 0, 1024, 768)).toEqual([112, 148]);
    expect(radialCenter(1024, 768, 1024, 768)).toEqual([912, 656]);
    // In una finestra più piccola del menu, il menu sta nel mezzo.
    expect(radialCenter(10, 10, 100, 100)).toEqual([50, 50]);
  });
});

describe("openRadial", () => {
  it("è un menu di voci in cerchio, ciascuna con la sua cifra, e il fuoco sulla prima che vale", () => {
    openRadial(500, 400, ITEMS, { label: "Menu radiale", center: { icon: "draw-pen", color: "#d55e00" } });
    expect(ring().getAttribute("aria-label")).toBe("Menu radiale");
    expect(ring().style.left).toBe("500px");
    expect(items().map((each) => [each.getAttribute("aria-label"), each.dataset.direction, each.getAttribute("aria-keyshortcuts")])).toEqual([
      ["Annulla", "n", "8"],
      ["Gomma", "ne", "9"],
      ["Penna", "e", "6"],
      ["Testo", "se", "3"],
      ["Ripeti", "s", "2"],
      ["Colore: Blu", "w", "4"],
      ["Colore: Nero", "nw", "7"],
    ]);
    expect(byLabel("Ripeti").getAttribute("aria-disabled")).toBe("true");
    expect(byLabel("Penna").style.left).toBe("80px");
    expect(byLabel("Annulla").style.top).toBe("-80px");
    expect(byLabel("Colore: Blu").querySelector(".draw-swatch-frame")!.getAttribute("data-shape")).toBe("square");
    const center = ring().querySelector<HTMLElement>(".draw-radial-center")!;
    expect(center.style.getPropertyValue("--radial-color")).toBe("#d55e00");
    expect(center.querySelector("svg")).not.toBeNull();
    expect(document.activeElement).toBe(byLabel("Annulla"));
    expect(items().map((each) => each.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1]);
    // Aperto col puntatore, il nome sopra il menu aspetta il puntatore.
    expect(caption()).toBe("");
    expect(layer()!.dataset.shellMotion).toBe("rest");
    expect(formatIssues(checkAccessibility(layer()!))).toBe("");
  });

  it("le frecce girano attorno alle voci che valgono, e il nome sopra segue il fuoco", () => {
    openRadial(500, 400, ITEMS, { label: "Menu radiale", keyboard: true });
    expect(caption()).toBe("Annulla · Ctrl+Z");
    key(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(byLabel("Gomma"));
    expect(caption()).toBe("Gomma");
    key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "ArrowDown");
    // Ripeti è spenta e il posto in basso a sinistra è vuoto.
    key(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(byLabel("Colore: Blu"));
    key(document.activeElement!, "ArrowRight");
    key(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(byLabel("Annulla"));
    key(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(byLabel("Colore: Nero"));
    key(document.activeElement!, "Home");
    expect(document.activeElement).toBe(byLabel("Annulla"));
    key(document.activeElement!, "End");
    expect(document.activeElement).toBe(byLabel("Colore: Nero"));
    expect(items().filter((each) => each.tabIndex === 0)).toEqual([byLabel("Colore: Nero")]);
  });

  it("Invio sceglie: il menu si chiude, il fuoco torna, poi la voce parte", () => {
    let focusAtRun: Element | null = null;
    const items8 = ITEMS.map((each) => (each === null ? null : { ...each, run: () => (focusAtRun = document.activeElement) }));
    let closed = 0;
    openRadial(500, 400, items8, { label: "Menu radiale", onClose: () => closed++ });
    byLabel("Annulla").click();
    expect(layer()).toBeNull();
    expect(closed).toBe(1);
    expect(focusAtRun).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it("le cifre del tastierino scelgono la direzione; il 5 e Esc chiudono", () => {
    openRadial(500, 400, ITEMS, { label: "Menu radiale" });
    key(ring(), "6");
    expect(runs).toEqual(["Penna"]);
    expect(layer()).toBeNull();
    openRadial(500, 400, ITEMS, { label: "Menu radiale" });
    // Il tastierino senza Bloc Num manda le frecce: vale il tasto.
    key(ring(), "ArrowLeft", "Numpad4");
    expect(runs).toEqual(["Penna", "Colore: Blu"]);
    openRadial(500, 400, ITEMS, { label: "Menu radiale" });
    // Una voce spenta prende il fuoco e non parte.
    key(ring(), "2");
    expect(document.activeElement).toBe(byLabel("Ripeti"));
    expect(caption()).toBe("Ripeti");
    key(ring(), "1");
    expect(layer()).not.toBeNull();
    key(ring(), "5");
    expect(layer()).toBeNull();
    openRadial(500, 400, ITEMS, { label: "Menu radiale" });
    key(document.activeElement!, "Escape");
    expect(layer()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(runs).toEqual(["Penna", "Colore: Blu"]);
  });

  it("premi, trascina, lascia: vale la direzione oltre il cerchio di mezzo", () => {
    let released = -1;
    openRadial(500, 400, ITEMS, { label: "Menu radiale", held: { pointerType: "mouse", pointerId: 1 }, onRelease: (at) => (released = at) });
    pointer("pointermove", 500 + DEAD_PX - 2, 400, { buttons: 2 });
    expect(items().some((each) => each.hasAttribute("data-hot"))).toBe(false);
    // Lontano dalle voci vale lo stesso la direzione.
    pointer("pointermove", 760, 405, { buttons: 2 });
    expect(byLabel("Penna").hasAttribute("data-hot")).toBe(true);
    expect(caption()).toBe("Penna");
    const center = ring().querySelector<HTMLElement>(".draw-radial-center")!;
    expect(center.dataset.pointing).toBe("e");
    // Un altro puntatore non lo guida.
    pointer("pointermove", 500, 200, { pointerId: 2, buttons: 1 });
    expect(byLabel("Penna").hasAttribute("data-hot")).toBe(true);
    const up = pointer("pointerup", 440, 340, { button: 2 });
    expect(runs).toEqual(["Colore: Nero"]);
    expect(released).toBe(up.timeStamp);
    expect(layer()).toBeNull();
  });

  it("alzato nel mezzo, o su una voce spenta, il menu resta aperto e si usa col tocco", () => {
    openRadial(500, 400, ITEMS, { label: "Menu radiale", held: { pointerType: "touch", pointerId: 7 } });
    pointer("pointermove", 500, 520, { pointerType: "touch", pointerId: 7 });
    expect(byLabel("Ripeti").hasAttribute("data-hot")).toBe(true);
    pointer("pointerup", 500, 520, { pointerType: "touch", pointerId: 7 });
    expect(layer()).not.toBeNull();
    expect(items().some((each) => each.hasAttribute("data-hot"))).toBe(false);
    // Aperto, il puntatore non lo guida più: si tocca una voce.
    pointer("pointermove", 760, 400, { pointerType: "touch", pointerId: 7 });
    expect(items().some((each) => each.hasAttribute("data-hot"))).toBe(false);
    byLabel("Ripeti").click();
    expect(layer()).not.toBeNull();
    byLabel("Testo").click();
    expect(runs).toEqual(["Testo"]);
  });

  it("un tocco fuori dalle voci chiude e non arriva sotto; il clic destro di nuovo chiude", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const under = vi.fn();
    document.body.addEventListener("pointerdown", under);
    openRadial(500, 400, ITEMS, { label: "Menu radiale" });
    const outside = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 3, pointerType: "pen", clientX: 20, clientY: 20 });
    layer()!.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    expect(layer()).toBeNull();
    document.body.removeEventListener("pointerdown", under);

    openRadial(500, 400, ITEMS, { label: "Menu radiale", keyboard: true });
    // Il menu contestuale che il tasto del menu manda dietro non lo chiude.
    const echo = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    ring().dispatchEvent(echo);
    expect(echo.defaultPrevented).toBe(true);
    expect(layer()).not.toBeNull();
    vi.advanceTimersByTime(600);
    ring().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(layer()).toBeNull();
    expect(runs).toEqual([]);
  });

  it("il tasto della penna appena lasciato non chiude il menu rimasto aperto", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    openRadial(500, 400, ITEMS, { label: "Menu radiale", held: { pointerType: "pen", pointerId: 4 } });
    vi.advanceTimersByTime(800);
    pointer("pointerup", 505, 400, { pointerType: "pen", pointerId: 4, button: 2 });
    layer()!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(layer()).not.toBeNull();
  });

  it("uno alla volta: aprirne un altro chiude il primo", () => {
    let closed = 0;
    openRadial(500, 400, ITEMS, { label: "Primo", onClose: () => closed++ });
    openRadial(300, 300, ITEMS, { label: "Secondo" });
    expect(closed).toBe(1);
    expect(document.querySelectorAll(".draw-radial")).toHaveLength(1);
    expect(ring().getAttribute("aria-label")).toBe("Secondo");
  });

  it("col moto, lo strato entra e se ne va animato", () => {
    setReducedMotionPreference(false);
    const radial = openRadial(500, 400, ITEMS, { label: "Menu radiale" });
    expect(radial.element.dataset.shellMotion).toBe("enter");
    radial.close();
    expect(radial.element.dataset.shellMotion).toBe("exit");
    expect(radial.element.isConnected).toBe(true);
  });
});
