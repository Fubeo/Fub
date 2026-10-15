// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const world = vi.hoisted(() => ({
  calls: [] as string[],
  tabs: {} as Record<string, number>,
  windows: true,
}));

vi.mock("../../../state/document-controller", () => ({
  synchronize: () => {
    world.calls.push("synchronize");
    return Promise.resolve();
  },
}));
vi.mock("../../../state/layout", () => ({
  pane: (id: string) => (id in world.tabs ? { tabs: Array.from({ length: world.tabs[id]! }, (_, i) => ({ k: "doc", doc: `${i}.md` })) } : undefined),
  moveTab: (...args: unknown[]) => (world.calls.push(`moveTab ${args.join(" ")}`), true),
  moveTabToPane: (...args: unknown[]) => (world.calls.push(`moveTabToPane ${args.join(" ")}`), true),
  splitWithTab: (...args: unknown[]) => (world.calls.push(`splitWithTab ${args.join(" ")}`), "pane-9"),
}));
vi.mock("../../../platform/capabilities", () => ({ platformSupports: () => world.windows }));
vi.mock("../../../state/document-windows", () => ({
  openCurrentInNewWindow: (doc: string) => void world.calls.push(`window ${doc}`),
}));

import { mountTabDrop, zoneOf } from "./tab-drop";

const BOX = { left: 0, top: 0, width: 400, height: 200 };

describe("la zona di un foglio sotto il puntatore", () => {
  it("il bordo più vicino, dentro un quarto; altrimenti il centro", () => {
    expect(zoneOf(BOX, 20, 100)).toBe("left");
    expect(zoneOf(BOX, 390, 100)).toBe("right");
    expect(zoneOf(BOX, 200, 10)).toBe("top");
    expect(zoneOf(BOX, 200, 190)).toBe("bottom");
    expect(zoneOf(BOX, 200, 100)).toBe("center");
  });

  it("in un angolo vince il bordo più vicino", () => {
    expect(zoneOf(BOX, 5, 60)).toBe("left");
    expect(zoneOf(BOX, 60, 5)).toBe("top");
  });

  it("un foglio senza misura è il centro", () => {
    expect(zoneOf({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBe("center");
  });
});

let lifetime: Lifetime;

function mountPanes(): { strip: HTMLElement; tab: HTMLElement; body: HTMLElement; frame: HTMLElement } {
  document.body.innerHTML = `
    <div id="panes">
      <section class="pane" data-pane="main">
        <div class="pane-tabs"><div draggable="true" class="tab-entry"></div></div>
        <div class="pane-editor"></div>
      </section>
      <section class="pane" data-pane="other"><div class="pane-tabs"></div><div class="pane-editor"></div></section>
    </div>`;
  const frame = document.querySelector<HTMLElement>('[data-pane="main"]')!;
  // Come un `DOMRect` vero: le misure sono accessori, non proprietà proprie.
  frame.getBoundingClientRect = () =>
    Object.create({
      get left() { return BOX.left; },
      get top() { return BOX.top; },
      get width() { return BOX.width; },
      get height() { return BOX.height; },
    }) as DOMRect;
  return {
    frame,
    strip: frame.querySelector<HTMLElement>(".pane-tabs")!,
    tab: frame.querySelector<HTMLElement>("[draggable]")!,
    body: frame.querySelector<HTMLElement>(".pane-editor")!,
  };
}

function drag(type: string, target: Element, at: { x?: number; y?: number } = {}, extra: Record<string, unknown> = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const store = new Map<string, string>();
  Object.assign(event, {
    clientX: at.x ?? 0,
    clientY: at.y ?? 0,
    dataTransfer: {
      dropEffect: "move",
      setData: (key: string, value: string) => store.set(key, value),
      getData: (key: string) => store.get(key) ?? (extra.payload as string | undefined) ?? "",
    },
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
}

/// La partenza del trascinamento, come la scrive la vista.
function start(tab: HTMLElement, payload: { pane: string; index: number }): void {
  const event = new Event("dragstart", { bubbles: true });
  Object.assign(event, { dataTransfer: { getData: () => JSON.stringify(payload), setData: () => {} } });
  tab.dispatchEvent(event);
}

beforeEach(() => {
  world.calls = [];
  world.tabs = { main: 3, other: 1 };
  world.windows = true;
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  document.body.innerHTML = "";
});

describe("rilasciare una linguetta sul foglio", () => {
  it("sul bordo del foglio mostra dove finirà e al rilascio divide", () => {
    const { tab, body } = mountPanes();
    mountTabDrop(lifetime);
    start(tab, { pane: "main", index: 1 });

    const over = drag("dragover", body, { x: 10, y: 100 });
    expect(over.defaultPrevented).toBe(true);
    const preview = document.querySelector<HTMLElement>(".tab-drop-preview")!;
    expect(preview.dataset.zone).toBe("left");
    expect(preview.style.width).toBe("200px");
    expect(preview.style.height).toBe("200px");

    drag("drop", body, { x: 10, y: 100 });
    expect(world.calls).toEqual(["splitWithTab main 1 main left", "synchronize"]);
    expect(document.querySelector(".tab-drop-preview")).toBeNull();
  });

  it("al centro di un altro foglio porta la linguetta in quel riquadro", () => {
    const { tab } = mountPanes();
    const other = document.querySelector<HTMLElement>('[data-pane="other"] .pane-editor')!;
    other.closest<HTMLElement>(".pane")!.getBoundingClientRect = () =>
      ({ ...BOX, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    mountTabDrop(lifetime);
    start(tab, { pane: "main", index: 0 });
    drag("drop", other, { x: 200, y: 100 });
    expect(world.calls).toEqual(["moveTabToPane main 0 other", "synchronize"]);
  });

  it("il centro del proprio foglio non è una destinazione", () => {
    const { tab, body } = mountPanes();
    mountTabDrop(lifetime);
    start(tab, { pane: "main", index: 0 });
    const over = drag("dragover", body, { x: 200, y: 100 });
    expect(over.defaultPrevented).toBe(false);
    expect(document.querySelector(".tab-drop-preview")).toBeNull();
    drag("drop", body, { x: 200, y: 100 });
    expect(world.calls).toEqual([]);
  });

  it("la striscia, fuori dalle linguette, mette la linguetta in coda", () => {
    const { tab, strip } = mountPanes();
    mountTabDrop(lifetime);
    start(tab, { pane: "main", index: 0 });
    drag("drop", strip);
    expect(world.calls).toEqual(["moveTab main 0 2", "synchronize"]);
    world.calls = [];
    const otherStrip = document.querySelector<HTMLElement>('[data-pane="other"] .pane-tabs')!;
    start(tab, { pane: "main", index: 1 });
    drag("drop", otherStrip);
    expect(world.calls).toEqual(["moveTabToPane main 1 other", "synchronize"]);
  });

  it("sopra una linguetta lascia fare al riordino della vista", () => {
    const { tab } = mountPanes();
    mountTabDrop(lifetime);
    start(tab, { pane: "main", index: 0 });
    const over = drag("dragover", tab);
    expect(over.defaultPrevented).toBe(false);
    drag("drop", tab);
    expect(world.calls).toEqual([]);
  });

  it("un trascinamento che non parte da una linguetta non è nostro", () => {
    const { body } = mountPanes();
    mountTabDrop(lifetime);
    const over = drag("dragover", body, { x: 10, y: 100 });
    expect(over.defaultPrevented).toBe(false);
    drag("drop", body, { x: 10, y: 100 });
    expect(world.calls).toEqual([]);
  });

  it("l'unica linguetta di un foglio non si separa sul suo stesso bordo", () => {
    const { tab, body } = mountPanes();
    world.tabs = { main: 1, other: 1 };
    mountTabDrop(lifetime);
    start(tab, { pane: "main", index: 0 });
    expect(drag("dragover", body, { x: 10, y: 100 }).defaultPrevented).toBe(false);
  });

  it("l'anteprima se ne va quando il puntatore esce dai fogli, e a rilascio finito", () => {
    const { tab, body } = mountPanes();
    mountTabDrop(lifetime);
    start(tab, { pane: "main", index: 1 });
    drag("dragover", body, { x: 10, y: 100 });
    expect(document.querySelector(".tab-drop-preview")).not.toBeNull();
    drag("dragleave", body, {}, { relatedTarget: null });
    expect(document.querySelector(".tab-drop-preview")).toBeNull();
  });

  it("fuori dalla finestra una linguetta di nota diventa una finestra, ma non per un annullo", () => {
    const { tab } = mountPanes();
    mountTabDrop(lifetime);
    start(tab, { pane: "main", index: 1 });
    // Annullato dentro la finestra: nessuna finestra.
    drag("dragend", tab, { x: 0, y: 0 }, { dataTransfer: { dropEffect: "none" } });
    expect(world.calls).toEqual([]);

    start(tab, { pane: "main", index: 1 });
    drag("dragend", tab, { x: -40, y: 300 }, { dataTransfer: { dropEffect: "none" } });
    return vi.waitFor(() => expect(world.calls).toEqual(["window 1.md"]));
  });

  it("senza finestre multiple non si stacca niente", () => {
    const { tab } = mountPanes();
    world.windows = false;
    mountTabDrop(lifetime);
    start(tab, { pane: "main", index: 1 });
    drag("dragend", tab, { x: -40, y: 300 }, { dataTransfer: { dropEffect: "none" } });
    expect(world.calls).toEqual([]);
  });

  it("alla chiusura toglie l'anteprima e smette di ascoltare", () => {
    const { tab, body } = mountPanes();
    mountTabDrop(lifetime);
    start(tab, { pane: "main", index: 1 });
    drag("dragover", body, { x: 10, y: 100 });
    lifetime.close();
    expect(document.querySelector(".tab-drop-preview")).toBeNull();
    drag("drop", body, { x: 10, y: 100 });
    expect(world.calls).toEqual([]);
  });
});
