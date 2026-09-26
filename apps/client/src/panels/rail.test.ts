// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `sidebar.ts` cerca i suoi pannelli appena importato: la pagina c'è prima.
const { opened, PAGE } = vi.hoisted(() => {
  const page = `
  <nav id="views-ribbon"><div id="rail-shell"></div></nav>
  <div id="views-left"></div>
  <section id="files-panel"></section>
  <section id="search-panel"></section>`;
  document.body.innerHTML = page;
  return { opened: [] as Array<[string, string, unknown]>, PAGE: page };
});
vi.mock("../state/layout", () => ({
  layout: { focus: "main" },
  openViewIn: (pane: string, view: string, _layout: unknown, params: unknown) =>
    opened.push([pane, view, params]),
}));
vi.mock("../host/query", () => ({ settings: async () => [] }));
vi.mock("../host/ipc", () => ({ api: { setSetting: async () => {} } }));
vi.mock("../state/kernel", () => ({ onEvent: () => () => {} }));

import type { ParamSpec, ViewSpec } from "../host/contract";
import { setPrimaryViews } from "../ui/primary-views";
import { mountRail, syncRail } from "./rail";

function mainView(id: string, title: string, params: ParamSpec[] = []): ViewSpec {
  return {
    id,
    title,
    surface: "main",
    refresh: [],
    follows: [],
    params,
    icon: id,
    order: 0,
    open_by_default: false,
    preferred_size: null,
    closable: true,
  } as unknown as ViewSpec;
}

describe("la rail e le view principali", () => {
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    opened.length = 0;
    document.body.innerHTML = PAGE;
    unmount = mountRail();
  });

  afterEach(() => {
    unmount?.();
    setPrimaryViews([]);
  });

  function mainButtons(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>("#views-ribbon .rail-btn-main")];
  }

  it("non ha un posto riservato: il grafo c'è solo se il componente lo dichiara", () => {
    syncRail();
    expect(mainButtons()).toEqual([]);
    expect(document.getElementById("show-graph")).toBeNull();

    setPrimaryViews([
      mainView("graph", "Grafo"),
      // Una view che chiede argomenti obbligatori la apre chi glieli dà.
      mainView("links", "Collegamenti", [
        { name: "doc", title: "Documento", required: true } as unknown as ParamSpec,
      ]),
    ]);
    syncRail();
    expect(mainButtons().map((button) => button.dataset.panel)).toEqual(["graph"]);
    const graph = mainButtons()[0]!;
    expect(graph.getAttribute("aria-label")).toBe("Grafo");

    graph.click();
    expect(opened).toEqual([["main", "graph", null]]);

    // Spento il componente, il bottone se ne va al giro dopo.
    setPrimaryViews([]);
    syncRail();
    expect(mainButtons()).toEqual([]);
  });
});
