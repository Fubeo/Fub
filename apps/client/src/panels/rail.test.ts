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
import { enterVaultPanel, lastShownPanel, showPanel } from "./sidebar";

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

describe("la barra di ogni vault (#237 R07)", () => {
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = PAGE;
    unmount = mountRail();
  });

  afterEach(() => unmount?.());

  /// Le view della barra che un vault dichiara: `mountDeclaredViews` le
  /// rifà da zero a ogni apertura, e la rail le scopre col giro dopo.
  function mountSideViews(...ids: string[]): void {
    const left = document.getElementById("views-left")!;
    left.replaceChildren(...ids.map((id) => {
      const panel = document.createElement("section");
      panel.className = "declared-view-panel";
      panel.dataset.viewId = id;
      const title = document.createElement("h2");
      title.className = "panel-title";
      title.textContent = id;
      panel.append(title);
      return panel;
    }));
  }
  /// Il pannello acceso, come lo dice la rail.
  const pressed = () =>
    [...document.querySelectorAll<HTMLButtonElement>('#views-ribbon .rail-btn[aria-pressed="true"]')]
      .map((button) => button.dataset.panel);
  /// Ciò che fa l'apertura di un vault, nell'ordine di `vault-session.ts`.
  function openVault(root: string, ...views: string[]): void {
    enterVaultPanel(root);
    mountSideViews(...views);
    syncRail();
  }

  it("un vault non eredita la vista di un altro, e ritrova la sua tornandoci o riaprendolo", () => {
    openVault("/r07/a", "trash");
    showPanel("trash");
    // Un giro della rail sullo stesso vault (una lingua, un componente acceso)
    // non chiude la view che si stava guardando.
    syncRail();
    expect(pressed()).toEqual(["trash"]);

    // Due cambi di fila: nessuno dei due vault eredita la scelta di prima.
    openVault("/r07/b", "trash");
    expect(pressed()).toEqual(["files"]);
    showPanel("search");
    openVault("/r07/c", "trash");
    expect(pressed()).toEqual(["files"]);

    openVault("/r07/a", "trash");
    expect(pressed()).toEqual(["trash"]);
    // Riaprire lo stesso vault (il «Riapri» del watcher) non è un vault nuovo.
    openVault("/r07/a", "trash");
    expect(pressed()).toEqual(["trash"]);
    openVault("/r07/b", "trash");
    expect(pressed()).toEqual(["search"]);
  });

  it("una view che il vault non dichiara più ricade sui file", () => {
    openVault("/r07/d", "trash");
    showPanel("trash");
    openVault("/r07/e");
    openVault("/r07/d");
    expect(pressed()).toEqual(["files"]);
    expect(lastShownPanel()).toBe("files");
  });
});
