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

const world = vi.hoisted(() => ({ focused: 0 }));

// Il controllore dei documenti cerca i suoi nodi all'import: qui serve solo
// sapere che il fuoco è stato rimandato al foglio.
vi.mock("../../../state/document-controller", () => ({
  focusEditor: () => {
    world.focused++;
  },
}));

import { mountDrawerPeek, PEEK_DWELL_MS, PEEK_LEAVE_MS } from "./peek";

const layout = (): HTMLElement => document.getElementById("layout") as HTMLElement;
const sidebar = (): HTMLElement => document.getElementById("sidebar") as HTMLElement;
const inspector = (): HTMLElement => document.getElementById("right-pane") as HTMLElement;
const edge = (side: string): HTMLElement => layout().querySelector(`.drawer-edge[data-edge="${side}"]`) as HTMLElement;

/// La scrivania con i due cassetti, chiusi o no.
function frame(closed: { sidebar?: boolean; inspector?: boolean } = { sidebar: true, inspector: true }): void {
  document.body.innerHTML = `
    <div id="layout">
      <aside id="sidebar"${closed.sidebar ? " hidden" : ""}><input id="filter" /></aside>
      <section id="panes"><button id="sheet">foglio</button></section>
      <section id="right-pane"${closed.inspector ? " hidden" : ""}><button id="tab">scheda</button></section>
    </div>`;
}

function pointer(target: HTMLElement, type: string, init: { pointerType?: string; buttons?: number } = {}): void {
  const event = new Event(type) as Event & { pointerType: string; buttons: number };
  event.pointerType = init.pointerType ?? "mouse";
  event.buttons = init.buttons ?? 0;
  target.dispatchEvent(event);
}

/// Gli osservatori e le promesse consegnano a fine giro; il tempo è finto.
async function settled(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

/// Sfiora il bordo e aspetta la sosta.
function brush(side: string): void {
  pointer(edge(side), "pointerenter");
  vi.advanceTimersByTime(PEEK_DWELL_MS);
}

/// Porta in fondo le corse vive, e consegna ciò che ne segue.
async function finishMotions(): Promise<void> {
  driver.advance(5000);
  await settled();
}

let driver: ManualDriver;
let lifetime: Lifetime;

beforeEach(() => {
  vi.useFakeTimers();
  driver = createManualDriver();
  setMotionDriver(driver);
  setMotionPreference("system");
  world.focused = 0;
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
  document.body.replaceChildren();
});

describe("il bordo", () => {
  it("c'è solo dalla parte di un cassetto chiuso, e segue chi lo apre e lo chiude", async () => {
    frame({ sidebar: true, inspector: false });
    mountDrawerPeek(lifetime);
    expect(edge("sidebar").hidden).toBe(false);
    expect(edge("inspector").hidden).toBe(true);
    expect(edge("sidebar").getAttribute("aria-hidden")).toBe("true");

    sidebar().hidden = false;
    inspector().hidden = true;
    await settled();
    expect(edge("sidebar").hidden).toBe(true);
    expect(edge("inspector").hidden).toBe(false);
  });

  it("senza `#layout` non fa niente e non lancia", () => {
    document.body.innerHTML = "<div></div>";
    expect(() => mountDrawerPeek(lifetime)).not.toThrow();
  });

  it("chiusa la vita i bordi se ne vanno", () => {
    frame();
    mountDrawerPeek(lifetime);
    lifetime.close();
    expect(layout().querySelector(".drawer-edge")).toBeNull();
  });
});

describe("affacciarsi", () => {
  it("serve una sosta sul bordo: chi lo attraversa non sveglia il cassetto", () => {
    frame();
    mountDrawerPeek(lifetime);
    pointer(edge("sidebar"), "pointerenter");
    vi.advanceTimersByTime(PEEK_DWELL_MS - 1);
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
    pointer(edge("sidebar"), "pointerleave");
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
    expect(driver.plays).toHaveLength(0);
  });

  it("dopo la sosta il cassetto compare, senza toccare `hidden` né il fuoco", () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    expect(layout().classList.contains("peek-sidebar")).toBe(true);
    expect(sidebar().hidden).toBe(true);
    expect(document.activeElement).toBe(document.body);
    // Arriva dal suo bordo: da sinistra il cassetto, da destra l'ispettore.
    expect(driver.plays).toHaveLength(1);
    expect(driver.plays[0].el).toBe(sidebar());
    expect(String(driver.plays[0].keyframes[0].transform)).toMatch(/translate\(-\d+px, 0px\)/);
    expect(driver.plays[0].keyframes[0].opacity).toBe(0);
  });

  it("l'ispettore arriva da destra, e chiude l'altro senza aspettare", () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(edge("sidebar"), "pointerleave");
    brush("inspector");
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
    expect(layout().classList.contains("peek-inspector")).toBe(true);
    const arrival = driver.plays[driver.plays.length - 1];
    expect(arrival.el).toBe(inspector());
    expect(String(arrival.keyframes[0].transform)).toMatch(/translate\(\d+px, 0px\)/);
  });

  it("il tocco e un trascinamento di passaggio non lo svegliano", () => {
    frame();
    mountDrawerPeek(lifetime);
    pointer(edge("sidebar"), "pointerenter", { pointerType: "touch" });
    pointer(edge("sidebar"), "pointerenter", { buttons: 1 });
    vi.advanceTimersByTime(PEEK_DWELL_MS * 2);
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
  });

  it("nel livello ridotto compare lo stesso, con la sola dissolvenza", () => {
    setMotionPreference("reduced");
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    expect(layout().classList.contains("peek-sidebar")).toBe(true);
    for (const play of driver.plays) expect(play.keyframes[0].transform).toBeUndefined();
  });
});

describe("ritirarsi", () => {
  it("uscito il puntatore aspetta, poi esce: intanto non riceve niente, e alla fine non resta niente", async () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(edge("sidebar"), "pointerleave");
    pointer(sidebar(), "pointerenter");
    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS - 1);
    expect(sidebar().hasAttribute("inert")).toBe(false);

    vi.advanceTimersByTime(1);
    // In uscita si vede ancora, ma è già chiuso per chi lo usa.
    expect(sidebar().hasAttribute("inert")).toBe(true);
    expect(layout().classList.contains("peek-sidebar")).toBe(true);

    await finishMotions();
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
    expect(sidebar().hasAttribute("inert")).toBe(false);
    expect(sidebar().hidden).toBe(true);
  });

  it("il puntatore che rientra durante l'attesa lo tiene", () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(sidebar(), "pointerenter");
    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS - 1);
    pointer(sidebar(), "pointerenter");
    vi.advanceTimersByTime(PEEK_LEAVE_MS * 2);
    expect(layout().classList.contains("peek-sidebar")).toBe(true);
    expect(sidebar().hasAttribute("inert")).toBe(false);
    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS);
  });

  it("il puntatore che rientra durante l'uscita lo riporta indietro", async () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(sidebar(), "pointerenter");
    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS);
    driver.advance(40);
    expect(sidebar().hasAttribute("inert")).toBe(true);

    pointer(sidebar(), "pointerenter");
    expect(sidebar().hasAttribute("inert")).toBe(false);
    await finishMotions();
    expect(layout().classList.contains("peek-sidebar")).toBe(true);

    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS);
    await finishMotions();
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
  });

  it("il fuoco dentro lo trattiene; uscito il fuoco, si ritira", async () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(sidebar(), "pointerenter");
    // Mostrato dalla struttura, il campo si può usare; happy-dom non lo sa.
    sidebar().hidden = false;
    document.getElementById("filter")?.focus();
    sidebar().hidden = true;
    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS * 3);
    expect(layout().classList.contains("peek-sidebar")).toBe(true);
    // Non è nemmeno in uscita: chi lo sta usando lo trova vivo.
    expect(sidebar().hasAttribute("inert")).toBe(false);

    document.getElementById("sheet")?.focus();
    vi.advanceTimersByTime(PEEK_LEAVE_MS * 2);
    await finishMotions();
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
    // Il fuoco era già altrove: nessuno lo ha spostato.
    expect(world.focused).toBe(0);
  });

  it("un menu contestuale aperto lo trattiene", async () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(sidebar(), "pointerenter");
    const menu = document.createElement("div");
    menu.id = "context-menu";
    document.body.append(menu);
    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS * 3);
    expect(layout().classList.contains("peek-sidebar")).toBe(true);
    // Non è nemmeno in uscita: chi lo sta usando lo trova vivo.
    expect(sidebar().hasAttribute("inert")).toBe(false);

    menu.remove();
    vi.advanceTimersByTime(PEEK_LEAVE_MS);
    await finishMotions();
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
  });

  it("un trascinamento partito dal cassetto lo trattiene fino al rilascio", async () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(sidebar(), "pointerenter");
    sidebar().dispatchEvent(new Event("dragstart", { bubbles: true }));
    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS * 3);
    expect(layout().classList.contains("peek-sidebar")).toBe(true);
    // Non è nemmeno in uscita: chi lo sta usando lo trova vivo.
    expect(sidebar().hasAttribute("inert")).toBe(false);

    sidebar().dispatchEvent(new Event("dragend", { bubbles: true }));
    vi.advanceTimersByTime(PEEK_LEAVE_MS * 2);
    await finishMotions();
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
  });

  it("Esc lo chiude subito e rimanda il fuoco al foglio", async () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(sidebar(), "pointerenter");
    sidebar().hidden = false;
    const filter = document.getElementById("filter") as HTMLElement;
    filter.focus();
    sidebar().hidden = true;
    await settled();
    expect(layout().classList.contains("peek-sidebar")).toBe(true);

    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(world.focused).toBe(1);
    expect(sidebar().hasAttribute("inert")).toBe(true);
    await finishMotions();
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
  });

  it("un Esc che qualcuno dentro ha già usato non lo chiude", () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(sidebar(), "pointerenter");
    const filter = document.getElementById("filter") as HTMLElement;
    filter.addEventListener("keydown", (event) => event.preventDefault());
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(sidebar().hasAttribute("inert")).toBe(false);
    expect(layout().classList.contains("peek-sidebar")).toBe(true);
  });

  it("aperto davvero mentre è affacciato, l'affaccio sparisce senza uscita", async () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    sidebar().hidden = false;
    await settled();
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
    expect(sidebar().hasAttribute("inert")).toBe(false);
    expect(edge("sidebar").hidden).toBe(true);
  });

  it("aperto davvero mentre si ritira, non resta inerte", async () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(sidebar(), "pointerenter");
    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS);
    expect(sidebar().hasAttribute("inert")).toBe(true);
    sidebar().hidden = false;
    await settled();
    expect(sidebar().hasAttribute("inert")).toBe(false);
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
  });

  it("nel livello ridotto si ritira senza corsa", async () => {
    setMotionPreference("reduced");
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(sidebar(), "pointerenter");
    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS);
    await settled();
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
    expect(sidebar().hasAttribute("inert")).toBe(false);
  });

  it("chiusa la vita a metà non lascia né classe né cassetto inerte", () => {
    frame();
    mountDrawerPeek(lifetime);
    brush("sidebar");
    pointer(sidebar(), "pointerenter");
    pointer(sidebar(), "pointerleave");
    vi.advanceTimersByTime(PEEK_LEAVE_MS);
    lifetime.close();
    expect(layout().classList.contains("peek-sidebar")).toBe(false);
    expect(sidebar().hasAttribute("inert")).toBe(false);
  });
});
