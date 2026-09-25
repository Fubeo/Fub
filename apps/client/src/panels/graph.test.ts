// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { emit } from "../state/store";
import type * as Store from "../state/store";
import { customRenderer } from "../ui/custom";
import { GRAPH_NS, mountGraph } from "./graph";
import { openLifetime, type Lifetime } from "../ui/lifetime";

interface FakeChart {
  onFocusChange: ((index: number) => void) | undefined;
  focusNode: Mock;
  focusedNode: Mock;
  nodeId: Mock;
  nodeCount: Mock;
  setOpenDocuments: Mock;
  setVisibleNodes: Mock;
  unmount: Mock;
}

interface FakePanel {
  updateLanguage: Mock;
  destroy: Mock;
  element: HTMLElement;
}

const fakes = vi.hoisted(() => ({
  charts: [] as FakeChart[],
  panels: [] as FakePanel[],
  languageListeners: [] as Array<() => void>,
  lifetimes: [] as Lifetime[],
  layoutRegistrations: [] as Array<{
    listener: Mock;
    disposer: () => void;
  }>,
}));
vi.mock("../state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof Store>();
  const register = actual.on as (
    signal: keyof Store.Signals,
    listener: (...args: never[]) => unknown,
  ) => () => void;
  return {
    ...actual,
    on: (signal: keyof Store.Signals, listener: (...args: never[]) => unknown) => {
      if (signal !== "layout") return register(signal, listener);
      const wrapped = vi.fn((...args: never[]) => listener(...args));
      const disposer = register(signal, wrapped);
      fakes.layoutRegistrations.push({ listener: wrapped, disposer });
      return disposer;
    },
  };
});

vi.mock("../graph/chart", () => ({
  createChart: () => {
    const chart = {
      open: undefined as ((id: string) => void) | undefined,
      onFocusChange: undefined as ((index: number) => void) | undefined,
      mount: vi.fn((host: HTMLElement) => {
        const canvas = document.createElement("canvas");
        canvas.className = "graph-main";
        host.append(canvas);
      }),
      focusNode: vi.fn(),
      focusedNode: vi.fn(() => -1),
      nodeId: vi.fn(() => null),
      nodeCount: vi.fn(() => 0),
      setVisibleNodes: vi.fn(),
      setGroups: vi.fn(() => [] as string[]),
      setOpenDocuments: vi.fn(),
      setA11yLabel: vi.fn(),
      setConfig: vi.fn(),
      warm: vi.fn(),
      unpinNodes: vi.fn(),
      snapshot: vi.fn(() => null),
      unmount: vi.fn(),
    };
    fakes.charts.push(chart);
    return chart;
  },
}));

vi.mock("../graph/physics-panel", () => ({
  createPhysicsPanel: () => {
    const panel = {
      element: document.createElement("div"),
      updateLanguage: vi.fn(),
      destroy: vi.fn(),
    };
    fakes.panels.push(panel);
    return panel;
  },
}));

vi.mock("../graph/config", () => ({
  loadConfig: () => ({
    preset: "organica",
    physics: {},
    graphics: {},
  }),
  saveConfig: vi.fn(),
}));

vi.mock("../i18n/strings", () => ({
  t: (key: string) => key,
  resolvedLanguage: () => "it",
  onLanguage: (listener: () => void) => {
    fakes.languageListeners.push(listener);
    return () => {
      const index = fakes.languageListeners.indexOf(listener);
      if (index >= 0) fakes.languageListeners.splice(index, 1);
    };
  },
}));

vi.mock("../state/layout", () => ({
  layout: { focus: "main" },
  panes: () => [],
  pane: () => undefined,
  openViewIn: vi.fn(),
}));

afterEach(async () => {
  await vi.dynamicImportSettled();
  for (const { disposer } of fakes.layoutRegistrations) disposer();
  for (const lifetime of fakes.lifetimes.splice(0)) lifetime.close();
  fakes.layoutRegistrations.length = 0;
  document.body.replaceChildren();
});

beforeEach(() => {
  document.body.replaceChildren();
  fakes.charts.length = 0;
  fakes.panels.length = 0;
  fakes.languageListeners.length = 0;
  fakes.layoutRegistrations.length = 0;
});

function mountTestGraph(): void {
  const lifetime = openLifetime();
  fakes.lifetimes.push(lifetime);
  mountGraph(lifetime);
}

describe("lifecycle del renderer graph", () => {
  it("stacca il layout e tutte le risorse a ogni mount/destroy", async () => {
    const button = document.createElement("button");
    button.id = "show-graph";
    document.body.append(button);
    mountTestGraph();

    const render = customRenderer(GRAPH_NS, null);
    expect(render).toBeDefined();

    for (let i = 0; i < 3; i += 1) {
      const host = document.createElement("div");
      document.body.append(host);
      const unmount = render!(host, { nodes: ["a"], edges: [] }, vi.fn());
      await vi.dynamicImportSettled();
      const chart = fakes.charts[i];
      const panel = fakes.panels[i];
      const layout = fakes.layoutRegistrations[i];
      emit("layout");
      expect(layout.listener).toHaveBeenCalledTimes(1);
      expect(fakes.languageListeners).toHaveLength(1);
      unmount!();
      expect(chart.unmount).toHaveBeenCalledTimes(1);
      expect(panel.destroy).toHaveBeenCalledTimes(1);
      expect(fakes.languageListeners).toHaveLength(0);
      emit("layout");
      expect(layout.listener).toHaveBeenCalledTimes(1);
    }
  });


  it("U46/U48: elenco accessibile paginato dagli stessi dati, apre con la stessa azione", async () => {
    const button = document.createElement("button");
    button.id = "show-graph";
    document.body.append(button);
    mountTestGraph();
    const render = customRenderer(GRAPH_NS, null)!;
    const opened: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const ids = Array.from({ length: 60 }, (_, i) => `n${i}`);
    const unmount = render(
      host,
      { nodes: ids, edges: [] },
      ((action: { action: string; payload: unknown }) => {
        if (action.action === "open") opened.push((action.payload as { doc: string }).doc);
      }) as never,
    );
    await vi.dynamicImportSettled();
    const chart = fakes.charts[fakes.charts.length - 1];
    chart.nodeCount.mockReturnValue(ids.length);
    chart.nodeId.mockImplementation((i: number) => ids[i] ?? null);
    chart.focusedNode.mockReturnValue(-1);
    // Ridisegna la lista coi dati veri dopo aver insegnato al mock il conto.
    fakes.languageListeners[fakes.languageListeners.length - 1]!();
    const list = host.querySelector<HTMLElement>("details.graph-list");
    const listBox = host.querySelector<HTMLElement>("ul.graph-list-items");
    expect(list).not.toBeNull();
    expect(listBox!.getAttribute("role")).toBe("list");
    // Pagina da 50: 50 righe + pager + riga "altre", mai 60 nodi in DOM.
    expect(listBox!.querySelectorAll(".graph-list-open")).toHaveLength(50);
    expect(listBox!.querySelector(".graph-list-more")).not.toBeNull();
    expect(listBox!.querySelector(".graph-list-page")).not.toBeNull();
    // Click sulla prima riga: seleziona e apre con la stessa azione del canvas.
    const first = listBox!.querySelector<HTMLButtonElement>(".graph-list-open")!;
    first.click();
    expect(chart.focusNode).toHaveBeenCalledWith(0);
    expect(opened).toEqual(["n0"]);
    // Seconda pagina via "altre": mostra n50 senza ricreare la simulazione.
    listBox!.querySelector<HTMLButtonElement>(".graph-list-more button")!.click();
    const second = listBox!.querySelector<HTMLButtonElement>(".graph-list-open")!;
    second.click();
    expect(chart.focusNode).toHaveBeenCalledWith(50);
    expect(opened).toEqual(["n0", "n50"]);
    unmount!();
  });

  it("filtra nodi e archi per data indicizzata senza ricostruire il layout", async () => {
    const button = document.createElement("button");
    button.id = "show-graph";
    document.body.append(button);
    mountTestGraph();
    const render = customRenderer(GRAPH_NS, null)!;
    const host = document.createElement("div");
    document.body.append(host);
    const stop = render(host, {
      nodes: ["a.md", "b.md"],
      edges: [{ from: "a.md", to: "b.md" }],
      // Due giorni diversi: la timeline avanza per giorno, non per istante.
      modified: { "a.md": "1700000000000", "b.md": "1700200000000" },
    }, vi.fn())!;
    await vi.dynamicImportSettled();
    const chart = fakes.charts[fakes.charts.length - 1];
    chart.nodeCount.mockReturnValue(2);
    chart.nodeId.mockImplementation((i: number) => ["a.md", "b.md"][i] ?? null);
    const slider = host.querySelector<HTMLInputElement>(".graph-timeline input")!;
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));
    expect(chart.setVisibleNodes).toHaveBeenLastCalledWith(new Set(["a.md"]));
    expect(host.querySelectorAll(".graph-list-open")).toHaveLength(1);
    slider.value = "2";
    slider.dispatchEvent(new Event("input"));
    expect(chart.setVisibleNodes).toHaveBeenLastCalledWith(null);
    expect(host.querySelectorAll(".graph-list-open")).toHaveLength(2);
    stop();
  });

  it("non monta un motore arrivato dopo lo smontaggio della superficie", async () => {
    const button = document.createElement("button");
    button.id = "show-graph";
    document.body.append(button);
    mountTestGraph();
    const host = document.createElement("div");
    document.body.append(host);
    const render = customRenderer(GRAPH_NS, null)!;
    const stop = render(host, { nodes: ["a"], edges: [] }, vi.fn())!;
    stop();
    await vi.dynamicImportSettled();
    expect(host.querySelector("canvas")).toBeNull();
    expect(fakes.charts).toHaveLength(0);
    expect(fakes.languageListeners).toHaveLength(0);
    const subscription = fakes.layoutRegistrations[0]!;
    emit("layout");
    expect(subscription.listener).not.toHaveBeenCalled();
  });
});
