// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeMotions,
  createManualDriver,
  setMotionDriver,
  setMotionPreference,
  type ManualDriver,
} from "../../../moto";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { setSidePanelController, type SidePanel } from "../../../ui/side-panels";

const world = vi.hoisted(() => ({
  /// Ciò che il modulo dice a «indietro», in ordine.
  back: [] as boolean[],
  /// Ciò che «indietro» fa quando il sistema torna indietro.
  backClose: (): void => {},
}));

vi.mock("./back", () => ({
  mountBackClose: (_lifetime: unknown, close: () => void) => {
    world.backClose = close;
    return { set: (open: boolean) => world.back.push(open) };
  },
}));

import { CLOSE_FRACTION, mountBottomSheets, PHONE_BELOW } from "./bottom-sheets";

const PANEL: Record<SidePanel, string> = { sidebar: "sidebar", inspector: "right-pane" };
const OPEN: Record<SidePanel, string> = { sidebar: "drawer-sidebar-open", inspector: "drawer-inspector-open" };
/// L'altezza della finestra di happy-dom: senza impaginazione è la corsa di un foglio.
const TRAVEL = (): number => window.innerHeight;

const layout = (): HTMLElement => document.getElementById("layout") as HTMLElement;
const panel = (side: SidePanel): HTMLElement => document.getElementById(PANEL[side]) as HTMLElement;
const scrim = (side: SidePanel): HTMLElement => document.getElementById(`${side}-scrim`) as HTMLElement;
const grip = (side: SidePanel): HTMLButtonElement => panel(side).querySelector(".sheet-grip") as HTMLButtonElement;

/// La scrivania di una finestra stretta, coi due cassetti chiusi.
function frame(): void {
  document.body.innerHTML = `
    <div id="layout" class="layout-compact">
      <aside id="sidebar" hidden><input id="filter" /></aside>
      <section id="panes"></section>
      <section id="right-pane" hidden><button id="tab">scheda</button></section>
      <div id="sidebar-scrim" class="drawer-scrim" hidden></div>
      <div id="inspector-scrim" class="drawer-scrim" hidden></div>
    </div>`;
}

/// La shell comune, per ciò che qui conta: un cassetto alla volta, la classe
/// su `#layout`, `hidden` sul pannello e sul velo.
const toggles: SidePanel[] = [];
function shell(): () => void {
  const close = (side: SidePanel): void => {
    layout().classList.remove(OPEN[side]);
    panel(side).hidden = true;
    scrim(side).hidden = true;
  };
  return setSidePanelController({
    visible: (side) => !panel(side).hidden,
    reveal: () => {},
    toggle: (side) => {
      toggles.push(side);
      if (layout().classList.contains(OPEN[side])) {
        close(side);
        return;
      }
      close(side === "sidebar" ? "inspector" : "sidebar");
      layout().classList.add(OPEN[side]);
      panel(side).hidden = false;
      scrim(side).hidden = false;
    },
  });
}

function width(px: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
}

/// Un evento del puntatore con l'istante che la prova decide.
function pointer(target: EventTarget, type: string, y: number, time: number): void {
  const event = new PointerEvent(type, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 100,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "timeStamp", { value: time });
  target.dispatchEvent(event);
}

/// Trascina la maniglia verso il basso di `dy` px in `ms` millisecondi.
function pull(side: SidePanel, dy: number, ms: number, release = true): void {
  const handle = grip(side);
  pointer(handle, "pointerdown", 0, 0);
  for (let step = 1; step <= 4; step++) pointer(document, "pointermove", (dy * step) / 4, (ms * step) / 4);
  if (release) pointer(document, "pointerup", dy, ms);
}

/// Gli osservatori e le promesse consegnano a fine giro.
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

async function toggle(side: SidePanel): Promise<void> {
  const before = toggles.length;
  // Come un comando o un'icona della barra: passa dal controllore.
  (await import("../../../ui/side-panels")).toggleSidePanel(side);
  expect(toggles.length).toBe(before + 1);
  await settled();
}

/// Porta in fondo le corse vive, e consegna ciò che ne segue.
async function finishMotions(): Promise<void> {
  driver.advance(5000);
  await settled();
}

const playsOn = (el: HTMLElement): number => driver.plays.filter((play) => play.el === el).length;

let driver: ManualDriver;
let lifetime: Lifetime;
let unregister: () => void;
let innerWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  innerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
  width(390);
  driver = createManualDriver();
  setMotionDriver(driver);
  setMotionPreference("system");
  world.back = [];
  toggles.length = 0;
  frame();
  // La cattura di happy-dom non interessa: basta che ci sia.
  const captured = new Set<number>();
  HTMLElement.prototype.setPointerCapture = (id: number) => void captured.add(id);
  HTMLElement.prototype.hasPointerCapture = (id: number) => captured.has(id);
  HTMLElement.prototype.releasePointerCapture = (id: number) => void captured.delete(id);
  unregister = shell();
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  unregister();
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  document.body.replaceChildren();
  if (innerWidth) Object.defineProperty(window, "innerWidth", innerWidth);
  else delete (window as { innerWidth?: number }).innerWidth;
});

describe("la maniglia", () => {
  it("sta in testa a ogni cassetto, è un bottone col suo nome e dice che cosa governa", () => {
    mountBottomSheets(lifetime);
    for (const side of ["sidebar", "inspector"] as const) {
      expect(panel(side).firstElementChild).toBe(grip(side));
      expect(grip(side).type).toBe("button");
      expect(grip(side).getAttribute("aria-label")).toBe("Chiudi il pannello");
      expect(grip(side).getAttribute("aria-controls")).toBe(PANEL[side]);
    }
  });

  it("toccata, chiude il foglio", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    grip("sidebar").click();
    expect(toggles).toEqual(["sidebar", "sidebar"]);
    expect(panel("sidebar").hidden).toBe(true);
    await finishMotions();
  });

  it("smontata la shell non resta, e con lei ciò che teneva a vista un foglio chiuso", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await toggle("sidebar");
    expect(layout().classList.contains("sheet-leaving-sidebar")).toBe(true);
    lifetime.close();
    expect(document.querySelector(".sheet-grip")).toBeNull();
    expect(layout().className).toBe("layout-compact");
    expect(panel("sidebar").hasAttribute("inert")).toBe(false);
  });

  it("senza `#layout` non fa niente e non lancia", () => {
    document.body.innerHTML = "<div></div>";
    expect(() => mountBottomSheets(lifetime)).not.toThrow();
  });
});

describe("salire e scendere", () => {
  it("aperto, il foglio sale e il velo compare; «indietro» lo sa", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    expect(playsOn(panel("sidebar"))).toBe(1);
    expect(playsOn(scrim("sidebar"))).toBe(1);
    expect(world.back).toEqual([true]);
    await finishMotions();
    expect(activeMotions()).toBe(0);
  });

  it("chiuso, resta a vista e inerte finché scende; poi non lascia niente", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    await toggle("sidebar");
    // Lo stato è già quello vero: la shell l'ha chiuso.
    expect(panel("sidebar").hidden).toBe(true);
    expect(layout().classList.contains("sheet-leaving-sidebar")).toBe(true);
    expect(layout().classList.contains("veil-leaving-sidebar")).toBe(true);
    expect(panel("sidebar").hasAttribute("inert")).toBe(true);
    expect(world.back).toEqual([true, false]);
    await finishMotions();
    expect(layout().className).toBe("layout-compact");
    expect(panel("sidebar").hasAttribute("inert")).toBe(false);
  });

  it("il velo ha una corsa sua, più corta: finita, non resta a vista col foglio che scende", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    pull("sidebar", TRAVEL() * 0.9, 2000);
    await settled();
    // Il foglio rilasciato scende con una molla lenta; il velo ha finito prima.
    driver.advance(370);
    await settled();
    expect(layout().classList.contains("sheet-leaving-sidebar")).toBe(true);
    expect(layout().classList.contains("veil-leaving-sidebar")).toBe(false);
    await finishMotions();
    expect(layout().className).toBe("layout-compact");
  });

  it("da un foglio all'altro: uno scende, l'altro sale, e il velo resta", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    const before = driver.plays.length;
    await toggle("inspector");
    expect(layout().classList.contains("sheet-leaving-sidebar")).toBe(true);
    expect(layout().classList.contains("veil-leaving-sidebar")).toBe(false);
    const plays = driver.plays.slice(before).map((play) => play.el);
    expect(plays).toEqual([panel("sidebar"), panel("inspector")]);
    // Un pannello è rimasto aperto: per «indietro» non è cambiato niente.
    expect(world.back).toEqual([true]);
    await finishMotions();
    expect(layout().className).toBe("layout-compact drawer-inspector-open");
  });

  it("riaperto mentre scende, risale da dov'è e torna vivo", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    await toggle("sidebar");
    driver.advance(60);
    await toggle("sidebar");
    expect(layout().classList.contains("sheet-leaving-sidebar")).toBe(false);
    expect(layout().classList.contains("veil-leaving-sidebar")).toBe(false);
    expect(panel("sidebar").hasAttribute("inert")).toBe(false);
    await finishMotions();
    expect(layout().className).toBe("layout-compact drawer-sidebar-open");
  });

  it("col moto ridotto il foglio chiuso sparisce subito", async () => {
    setMotionPreference("reduced");
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await toggle("sidebar");
    expect(layout().className).toBe("layout-compact");
    expect(panel("sidebar").hasAttribute("inert")).toBe(false);
    expect(world.back).toEqual([true, false]);
  });

  it("«indietro» chiude il foglio aperto, passando dalla shell", async () => {
    mountBottomSheets(lifetime);
    await toggle("inspector");
    world.backClose();
    await settled();
    expect(toggles).toEqual(["inspector", "inspector"]);
    expect(panel("inspector").hidden).toBe(true);
    await finishMotions();
  });

  it(`da ${PHONE_BELOW} px in su i cassetti sono di lato: niente corse, niente passi`, async () => {
    width(PHONE_BELOW);
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await toggle("sidebar");
    expect(driver.plays).toHaveLength(0);
    expect(layout().className).toBe("layout-compact");
    expect(world.back).toEqual([]);
  });

  it("allargata la finestra con un foglio aperto, «indietro» lo dimentica", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    width(PHONE_BELOW + 200);
    window.dispatchEvent(new Event("resize"));
    expect(world.back).toEqual([true, false]);
    // Il cassetto è ancora aperto, di lato: nessuna uscita da mostrare.
    expect(layout().className).toBe("layout-compact drawer-sidebar-open");
    await finishMotions();
  });
});

describe("il gesto", () => {
  it("il foglio segue il dito verso il basso, e il velo si dirada", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    pull("sidebar", 100, 400, false);
    expect(panel("sidebar").style.getPropertyValue("translate")).toBe("0 100px");
    expect(Number(scrim("sidebar").style.opacity)).toBeCloseTo(1 - 100 / TRAVEL(), 5);
    pointer(document, "pointerup", 100, 400);
    await finishMotions();
  });

  it("verso l'alto non si muove: è già tutto fuori", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    pull("sidebar", -80, 400, false);
    expect(panel("sidebar").style.getPropertyValue("translate")).toBe("0 0px");
    pointer(document, "pointerup", -80, 400);
    expect(toggles).toEqual(["sidebar"]);
    await finishMotions();
  });

  it("rilasciato prima di un terzo, torna a posto e resta aperto", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    pull("sidebar", TRAVEL() * CLOSE_FRACTION - 20, 2000);
    expect(toggles).toEqual(["sidebar"]);
    expect(panel("sidebar").style.getPropertyValue("translate")).toBe("");
    expect(scrim("sidebar").style.opacity).toBe("");
    expect(panel("sidebar").hidden).toBe(false);
    await finishMotions();
    expect(layout().className).toBe("layout-compact drawer-sidebar-open");
  });

  it("rilasciato oltre un terzo, si chiude e scende da dov'era", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    pull("sidebar", TRAVEL() * CLOSE_FRACTION + 20, 2000);
    expect(toggles).toEqual(["sidebar", "sidebar"]);
    expect(panel("sidebar").hidden).toBe(true);
    // L'uscita parte al rilascio, senza aspettare l'osservatore.
    expect(layout().classList.contains("sheet-leaving-sidebar")).toBe(true);
    expect(panel("sidebar").style.getPropertyValue("translate")).toBe("");
    await finishMotions();
    expect(layout().className).toBe("layout-compact");
    expect(world.back).toEqual([true, false]);
  });

  it("uno slancio verso il basso lo chiude anche da vicino", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    pull("sidebar", 60, 40);
    expect(toggles).toEqual(["sidebar", "sidebar"]);
    await finishMotions();
  });

  it("il clic che segue un trascinamento non è un tocco", async () => {
    mountBottomSheets(lifetime);
    await toggle("sidebar");
    await finishMotions();
    pull("sidebar", 40, 2000);
    grip("sidebar").click();
    expect(toggles).toEqual(["sidebar"]);
    // Il tocco dopo vale di nuovo.
    pointer(grip("sidebar"), "pointerdown", 0, 3000);
    pointer(document, "pointerup", 0, 3050);
    grip("sidebar").click();
    expect(toggles).toEqual(["sidebar", "sidebar"]);
    await finishMotions();
  });
});
