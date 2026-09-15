// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { emit } from "../state/store";
import type * as Store from "../state/store";
import { customRenderer } from "../ui/custom";
import { GRAPH_NS, mountGraph } from "./graph";

interface FakeChart {
  setOpenDocuments: Mock;
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
      mount: vi.fn((host: HTMLElement) => {
        const canvas = document.createElement("canvas");
        canvas.className = "graph-main";
        host.append(canvas);
      }),
      setOpenDocuments: vi.fn(),
      setA11yLabel: vi.fn(),
      setConfig: vi.fn(),
      warm: vi.fn(),
      unpinNodes: vi.fn(),
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

afterEach(() => {
  for (const { disposer } of fakes.layoutRegistrations) disposer();
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

describe("lifecycle del renderer graph", () => {
  it("stacca il layout e tutte le risorse a ogni mount/destroy", () => {
    const button = document.createElement("button");
    button.id = "show-graph";
    document.body.append(button);
    mountGraph();

    const render = customRenderer(GRAPH_NS);
    expect(render).toBeDefined();

    for (let i = 0; i < 3; i += 1) {
      const host = document.createElement("div");
      document.body.append(host);
      const unmount = render!(host, { nodes: ["a"], edges: [] }, vi.fn());
      const chart = fakes.charts[i];
      const panel = fakes.panels[i];
      const layout = fakes.layoutRegistrations[i];
      emit("layout");
      expect(chart.setOpenDocuments).toHaveBeenCalledTimes(2);
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
});
