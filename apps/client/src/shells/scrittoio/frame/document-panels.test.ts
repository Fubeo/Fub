// @vitest-environment happy-dom
//
// Le schede del documento seguono il riquadro a fuoco: cambiano con lui, se
// ne vanno col documento, e ogni scheda montata si smonta una volta sola.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SurfacePanel, SurfacePanels } from "../../../editors/core/registry";
import { emit, state } from "../../../state/store";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const world = vi.hoisted(() => ({
  tab: { k: "doc" } as { k: string } | null,
  focus: "p1",
  panes: new Map<string, unknown>(),
  shown: [] as HTMLElement[][],
  covers: [] as string[][],
  selected: [] as string[],
  revealed: [] as string[],
}));

vi.mock("../../../state/document-controller", () => ({ paneOf: (id: string) => world.panes.get(id) }));
vi.mock("../../../state/layout", () => ({
  activeTab: () => world.tab,
  layout: {
    get focus() {
      return world.focus;
    },
  },
}));
vi.mock("../../../ui/views", () => ({
  showSurfacePanels: (els: readonly HTMLElement[], covers: readonly string[] = []) => {
    world.shown.push([...els]);
    world.covers.push([...covers]);
  },
  selectInspectorTab: (id: string) => world.selected.push(id),
}));
vi.mock("../../../ui/side-panels", () => ({ revealSidePanel: (side: string) => world.revealed.push(side) }));

import { mountDocumentPanels } from "./document-panels";

/// Una superficie con le sue schede; conta chi è montato e chi ascolta.
function surface(ids: readonly string[], covers?: readonly string[]) {
  const live = new Set<string>();
  const listeners = new Set<() => void>();
  const asks = new Set<(id: string) => void>();
  let list: SurfacePanel[] = ids.map((id) => ({
    id,
    icon: "comment",
    title: () => `scheda ${id}`,
    mount(host: HTMLElement) {
      live.add(id);
      host.textContent = id;
      return () => live.delete(id);
    },
  }));
  const panels: SurfacePanels = {
    list: () => list,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onShow(listener) {
      asks.add(listener);
      return () => asks.delete(listener);
    },
    ...(covers === undefined ? {} : { covers }),
  };
  return {
    pane: { surface: { panels } },
    live,
    listeners,
    tell: () => [...listeners].forEach((listener) => listener()),
    ask: (id: string) => [...asks].forEach((listener) => listener(id)),
    asks,
    drop: () => {
      list = [];
    },
  };
}

let life: Lifetime;
const last = (): HTMLElement[] => world.shown[world.shown.length - 1]!;

beforeEach(() => {
  document.body.innerHTML = `<div id="panes"></div>`;
  state.vaultRoot = "/vault";
  world.tab = { k: "doc" };
  world.focus = "p1";
  world.panes.clear();
  world.shown = [];
  world.covers = [];
  world.selected = [];
  world.revealed = [];
  life = openLifetime();
});
afterEach(() => {
  life.close();
  state.vaultRoot = "";
});

describe("le schede del documento", () => {
  it("vengono dalla superficie a fuoco, come pannelli dell'ispettore", () => {
    const one = surface(["doc.comments", "doc.revisions"]);
    world.panes.set("p1", one.pane);
    mountDocumentPanels(life);
    expect(last().map((el) => el.dataset.viewId)).toEqual(["doc.comments", "doc.revisions"]);
    const first = last()[0]!;
    expect(first.classList.contains("declared-view-panel")).toBe(true);
    expect(first.dataset.follows).toBe("document");
    expect(first.querySelector(".panel-title")?.textContent).toBe("scheda doc.comments");
    expect(first.querySelector(".declared-view")?.textContent).toBe("doc.comments");
    expect([...one.live]).toEqual(["doc.comments", "doc.revisions"]);
  });

  it("le view che il documento lascia fuori vanno all'ispettore con le sue schede, e tornano col fuoco altrove", () => {
    const drawing = surface(["draw.design"], ["outline"]);
    const note = surface([]);
    world.panes.set("p1", drawing.pane);
    world.panes.set("p2", note.pane);
    mountDocumentPanels(life);
    expect(world.covers[world.covers.length - 1]).toEqual(["outline"]);
    world.focus = "p2";
    emit("layout");
    expect(world.covers[world.covers.length - 1]).toEqual([]);
    expect(last()).toEqual([]);
  });

  it("un avviso senza schede nuove non rimonta niente", () => {
    const one = surface(["doc.comments"]);
    world.panes.set("p1", one.pane);
    mountDocumentPanels(life);
    const before = world.shown.length;
    one.tell();
    emit("layout");
    expect(world.shown).toHaveLength(before);
  });

  it("due riquadri con due documenti: le schede cambiano col fuoco, e ognuna si smonta", () => {
    const one = surface(["doc.comments"]);
    const two = surface(["doc.properties"]);
    world.panes.set("p1", one.pane);
    world.panes.set("p2", two.pane);
    mountDocumentPanels(life);
    world.focus = "p2";
    emit("layout");
    expect(last().map((el) => el.dataset.viewId)).toEqual(["doc.properties"]);
    expect(one.live.size).toBe(0);
    expect(one.listeners.size).toBe(0);
    expect(two.live.size).toBe(1);
    world.focus = "p1";
    emit("layout");
    expect(two.live.size).toBe(0);
    expect(one.live.size).toBe(1);
  });

  it("chiuso il documento, o tolte le schede, se ne vanno", () => {
    const one = surface(["doc.comments"]);
    world.panes.set("p1", one.pane);
    mountDocumentPanels(life);
    one.drop();
    one.tell();
    expect(last()).toEqual([]);
    expect(one.live.size).toBe(0);
    world.tab = null;
    emit("layout");
    expect(one.listeners.size).toBe(0);
  });

  it("la superficie chiede una sua scheda: l'ispettore si apre e la sceglie", () => {
    const one = surface(["doc.comments"]);
    world.panes.set("p1", one.pane);
    mountDocumentPanels(life);
    one.ask("doc.comments");
    expect(world.revealed).toEqual(["inspector"]);
    expect(world.selected).toEqual(["doc.comments"]);
  });

  it("montaggi e smontaggi ripetuti non lasciano schede né ascoltatori", () => {
    const one = surface(["doc.comments", "doc.revisions"]);
    world.panes.set("p1", one.pane);
    for (let round = 0; round < 5; round += 1) {
      const each = openLifetime();
      mountDocumentPanels(each);
      expect(one.live.size).toBe(2);
      each.close();
      expect(one.live.size).toBe(0);
      expect(one.listeners.size).toBe(0);
      expect(one.asks.size).toBe(0);
      expect(last()).toEqual([]);
    }
  });
});
