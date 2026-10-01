// @vitest-environment happy-dom
// La vista che ingrandisce: prima la matematica, pura — adattare senza mai
// ingrandire, zoomare tenendo fermo il punto sotto il puntatore, tenere il
// contenuto dentro il palco — poi i gesti su un palco di misura nota, e il
// teardown che li ritira tutti.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_SCALE,
  MIN_SCALE,
  VECTOR_FIT_LIMIT,
  clampPan,
  fitScale,
  fitted,
  mountZoomView,
  panBy,
  rotated,
  transformOf,
  turned,
  zoomAt,
  type ZoomState,
} from "./zoom-view";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { setReducedMotionPreference } from "../../theme/reduced-motion";

const viewport = { width: 800, height: 600 };

describe("la matematica dello zoom", () => {
  it("adatta con un margine e non ingrandisce mai oltre il vero", () => {
    expect(fitScale({ width: 100, height: 50 }, viewport, 0)).toBe(1);
    expect(fitScale({ width: 1536, height: 100 }, viewport, 0)).toBeCloseTo(0.5);
    expect(fitScale({ width: 100, height: 2272 }, viewport, 0)).toBeCloseTo(0.25);
    // Ruotato di un quarto, conta l'altra dimensione.
    expect(fitScale({ width: 100, height: 1536 }, viewport, 90)).toBeCloseTo(0.5);
    expect(turned({ width: 3, height: 4 }, 270)).toEqual({ width: 4, height: 3 });
    expect(turned({ width: 3, height: 4 }, 180)).toEqual({ width: 3, height: 4 });
    // Un contenuto senza misure non divide per zero.
    expect(fitScale({ width: 0, height: 0 }, viewport, 0)).toBe(1);
    expect(fitted({ width: 1536, height: 100 }, viewport)).toEqual({ scale: 0.5, x: 0, y: 0, rotation: 0 });
  });

  it("zooma tenendo fermo il punto sotto il puntatore", () => {
    const content = { width: 4000, height: 3000 };
    const start: ZoomState = { scale: 0.5, x: 0, y: 0, rotation: 0 };
    const at = { x: 120, y: -80 };
    const next = zoomAt(start, 2, at, content, viewport);
    expect(next.scale).toBe(1);
    // Il punto del contenuto sotto `at` è lo stesso prima e dopo.
    const under = (s: ZoomState) => ({ x: (at.x - s.x) / s.scale, y: (at.y - s.y) / s.scale });
    expect(under(next).x).toBeCloseTo(under(start).x);
    expect(under(next).y).toBeCloseTo(under(start).y);
  });

  it("tiene la scala fra i limiti", () => {
    const content = { width: 100, height: 100 };
    const start: ZoomState = { scale: 1, x: 0, y: 0, rotation: 0 };
    expect(zoomAt(start, 1e6, { x: 0, y: 0 }, content, viewport).scale).toBe(MAX_SCALE);
    expect(zoomAt(start, 1e-6, { x: 0, y: 0 }, content, viewport).scale).toBe(MIN_SCALE);
  });

  it("un contenuto più piccolo del palco resta al centro, uno più grande non lascia vuoti", () => {
    const small = { width: 200, height: 100 };
    expect(clampPan({ scale: 1, x: 300, y: -200, rotation: 0 }, small, viewport)).toMatchObject({ x: 0, y: 0 });
    const large = { width: 1000, height: 1000 };
    // A scala 1 avanzano 100 px in orizzontale e 200 in verticale per lato.
    expect(clampPan({ scale: 1, x: 900, y: -900, rotation: 0 }, large, viewport)).toMatchObject({ x: 100, y: -200 });
    expect(panBy({ scale: 1, x: 0, y: 0, rotation: 0 }, 50, 50, large, viewport)).toMatchObject({ x: 50, y: 50 });
  });

  it("ruota di un quarto per volta e scrive una sola trasformazione", () => {
    let state: ZoomState = { scale: 1, x: 0, y: 0, rotation: 0 };
    const turns: number[] = [];
    for (let i = 0; i < 4; i++) {
      state = { ...state, rotation: rotated(state) };
      turns.push(state.rotation);
    }
    expect(turns).toEqual([90, 180, 270, 0]);
    expect(transformOf({ scale: 0.123456, x: 10.456, y: -3, rotation: 90 }))
      .toBe("translate(-50%, -50%) translate(10.46px, -3px) rotate(90deg) scale(0.1235)");
  });
});

describe("la vista montata", () => {
  let life: Lifetime;

  beforeEach(() => {
    setReducedMotionPreference(true);
    life = openLifetime();
  });

  afterEach(() => {
    life.close();
    document.body.replaceChildren();
    setReducedMotionPreference(false);
  });

  function mount(size = { width: 2000, height: 1000 }, backdrop: "checker" | null = "checker") {
    const errors: string[] = [];
    const view = mountZoomView("blob:immagine", {
      label: "Schema",
      size,
      backdrop,
      info: "PNG · 2000 × 1000 px · 12 KiB",
      onError: () => errors.push("errore"),
    }, life);
    document.body.append(view.element);
    Object.defineProperty(view.stage, "clientWidth", { configurable: true, value: viewport.width });
    Object.defineProperty(view.stage, "clientHeight", { configurable: true, value: viewport.height });
    view.image.dispatchEvent(new Event("load"));
    return { view, errors };
  }

  function key(target: HTMLElement, name: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  const level = (view: { element: HTMLElement }) => view.element.querySelector(".zoom-level")!.textContent;

  it("si presenta come un'immagine con la sua barra", () => {
    const { view } = mount();
    expect(view.stage.getAttribute("role")).toBe("img");
    expect(view.stage.getAttribute("aria-label")).toBe("Schema");
    expect(view.stage.tabIndex).toBe(0);
    expect(view.element.querySelector("[role=toolbar]")).not.toBeNull();
    expect(view.element.querySelector(".zoom-info")!.textContent).toBe("PNG · 2000 × 1000 px · 12 KiB");
    // Caricata, si adatta: 768 / 2000.
    expect(view.state().scale).toBeCloseTo(0.384);
    expect(level(view)).toBe("38%");
    expect(view.image.style.visibility).toBe("");
    expect(view.stage.dataset.zoomed).toBe("false");
  });

  it("risponde ai tasti sul palco e lascia passare gli altri", () => {
    const { view } = mount();
    expect(key(view.stage, "1").defaultPrevented).toBe(true);
    expect(level(view)).toBe("100%");
    expect(view.stage.dataset.zoomed).toBe("true");
    key(view.stage, "+");
    expect(level(view)).toBe("125%");
    key(view.stage, "-");
    expect(level(view)).toBe("100%");
    key(view.stage, "ArrowLeft");
    expect(view.state().x).toBe(48);
    key(view.stage, "0");
    expect(view.state()).toMatchObject({ x: 0, y: 0 });
    expect(level(view)).toBe("38%");
    key(view.stage, "r");
    expect(view.state().rotation).toBe(90);
    // Ruotata, si riadatta sull'altra forma: 568 / 2000.
    expect(view.state().scale).toBeCloseTo(0.284);
    expect(key(view.stage, "x").defaultPrevented).toBe(false);
    // Le scorciatoie con modificatori sono di qualcun altro.
    const withCtrl = new KeyboardEvent("keydown", { key: "+", ctrlKey: true, bubbles: true, cancelable: true });
    view.stage.dispatchEvent(withCtrl);
    expect(withCtrl.defaultPrevented).toBe(false);
  });

  it("i bottoni fanno ciò che dicono, e il fondo gira fra tre", () => {
    const { view } = mount();
    const button = (action: string) => view.element.querySelector<HTMLButtonElement>(`[data-zoom-action="${action}"]`)!;
    button("actual").click();
    expect(level(view)).toBe("100%");
    button("in").click();
    expect(level(view)).toBe("125%");
    button("fit").click();
    expect(level(view)).toBe("38%");
    button("rotate").click();
    expect(view.state().rotation).toBe(90);
    const backdrop = button("backdrop");
    expect(view.element.dataset.backdrop).toBe("checker");
    expect(backdrop.getAttribute("aria-label")).toBe("Sfondo: scacchiera");
    backdrop.click();
    expect(view.element.dataset.backdrop).toBe("light");
    backdrop.click();
    expect(view.element.dataset.backdrop).toBe("dark");
    expect(backdrop.getAttribute("aria-label")).toBe("Sfondo: scuro");
    backdrop.click();
    expect(view.element.dataset.backdrop).toBe("checker");
  });

  it("senza fondo dichiarato non offre il bottone del fondo", () => {
    const { view } = mount(undefined, null);
    expect(view.element.dataset.backdrop).toBeUndefined();
    expect(view.element.querySelector('[data-zoom-action="backdrop"]')).toBeNull();
  });

  it("le caselle della scacchiera restano della stessa misura a ogni scala", () => {
    const { view } = mount({ width: 400, height: 200 });
    expect(view.image.style.backgroundSize).toBe("16px 16px");
    view.zoom(2);
    expect(view.image.style.backgroundSize).toBe("8px 8px");
  });

  it("la rotella ingrandisce e trattiene la pagina", () => {
    const { view } = mount();
    const before = view.state().scale;
    const wheel = new WheelEvent("wheel", { deltaY: -200, bubbles: true, cancelable: true });
    view.stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(view.state().scale).toBeGreaterThan(before);
  });

  it("il doppio clic alterna le dimensioni reali e l'adattamento", () => {
    const { view } = mount();
    view.stage.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(level(view)).toBe("100%");
    view.stage.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(level(view)).toBe("38%");
  });

  it("un errore di decodifica arriva a chi ha montato la vista", () => {
    const { view, errors } = mount();
    view.image.dispatchEvent(new Event("error"));
    expect(errors).toEqual(["errore"]);
  });

  it("chiusa la vita, nessun gesto la muove più", () => {
    const { view } = mount();
    life.close();
    key(view.stage, "1");
    view.element.querySelector<HTMLButtonElement>('[data-zoom-action="in"]')!.click();
    expect(level(view)).toBe("38%");
  });
});

describe("i contenuti vettoriali", () => {
  it("si adattano anche ingrandendo, fino al limite", () => {
    expect(fitScale({ width: 200, height: 100 }, viewport, 0, VECTOR_FIT_LIMIT)).toBe(VECTOR_FIT_LIMIT);
    expect(fitScale({ width: 512, height: 100 }, viewport, 0, VECTOR_FIT_LIMIT)).toBeCloseTo(1.5);
    expect(fitted({ width: 200, height: 100 }, viewport, 0, VECTOR_FIT_LIMIT).scale).toBe(2);
  });

  it("la vista montata li adatta ingrandendo", () => {
    const life = openLifetime();
    setReducedMotionPreference(true);
    try {
      const view = mountZoomView("blob:diagramma", { label: "Flusso", size: { width: 256, height: 100 }, vector: true }, life);
      document.body.append(view.element);
      Object.defineProperty(view.stage, "clientWidth", { configurable: true, value: viewport.width });
      Object.defineProperty(view.stage, "clientHeight", { configurable: true, value: viewport.height });
      view.image.dispatchEvent(new Event("load"));
      expect(view.state().scale).toBe(2);
      expect(view.stage.dataset.zoomed).toBe("false");
    } finally {
      life.close();
      setReducedMotionPreference(false);
      document.body.replaceChildren();
    }
  });
});
