// Le schede del documento nell'ispettore: Commenti, Revisioni, Proprietà,
// accanto alle view dichiarate. Le porta la superficie a fuoco
// (`EditorSurface.panels`); questo modulo le segue.
//
// Il riquadro cambia, e le schede cambiano con lui; il documento si chiude, e
// se ne vanno. Ogni scheda montata ha il suo disposer, e lo chiama chi la
// toglie: un pannello rimontato non lascia ascoltatori del giro di prima.
import type { SurfacePanel, SurfacePanels } from "../../../editors/core/registry";
import { onLanguage } from "../../../i18n/strings";
import { paneOf } from "../../../state/document-controller";
import { activeTab, layout } from "../../../state/layout";
import { on, state } from "../../../state/store";
import type { Lifetime } from "../../../ui/lifetime";
import { revealSidePanel } from "../../../ui/side-panels";
import { selectInspectorTab, showSurfacePanels } from "../../../ui/views";
import { byId, follow } from "./dom";

interface Shown {
  readonly panel: SurfacePanel;
  readonly el: HTMLElement;
  readonly title: HTMLElement;
  readonly unmount: () => void;
}

/// Il pannello di una scheda, vestito come quelli delle view dichiarate
/// (`mountSpec` in `ui/views.ts`): l'ispettore li tratta allo stesso modo.
function frame(panel: SurfacePanel): Omit<Shown, "unmount"> & { body: HTMLElement } {
  const el = document.createElement("div");
  el.className = "declared-view-panel surface-panel";
  el.dataset.viewId = panel.id;
  el.dataset.follows = "document";
  el.id = `surface-panel-${panel.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const title = document.createElement("div");
  title.className = "panel-title";
  title.dataset.icon = panel.icon;
  title.textContent = panel.title();
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "2");
  const body = document.createElement("div");
  body.className = "declared-view surface-panel-body";
  el.append(title, body);
  return { panel, el, title, body };
}

export function mountDocumentPanels(lifetime: Lifetime): void {
  let watched: SurfacePanels | null = null;
  let stopWatching: (() => void) | null = null;
  let shown: Shown[] = [];
  /// Le view dichiarate che il documento lascia fuori, com'erano all'ultimo giro.
  let covered = "";

  const clear = () => {
    for (const each of shown) each.unmount();
    shown = [];
  };
  lifetime.add(() => {
    stopWatching?.();
    stopWatching = null;
    watched = null;
    clear();
    covered = "";
    showSurfacePanels([]);
  });

  const panelsOf = (): SurfacePanels | null => {
    const tab = state.vaultRoot ? activeTab() : null;
    return tab?.k === "doc" ? (paneOf(layout.focus)?.surface?.panels ?? null) : null;
  };

  const draw = (): void => {
    if (lifetime.closed) return;
    const panels = panelsOf();
    if (panels !== watched) {
      stopWatching?.();
      watched = panels;
      const stopList = panels?.subscribe(draw);
      // La superficie chiede una sua scheda: l'ispettore si apre su quella.
      const offShow = panels?.onShow((id) => {
        draw();
        revealSidePanel("inspector");
        selectInspectorTab(id);
      });
      stopWatching = panels
        ? () => {
            stopList?.();
            offShow?.();
          }
        : null;
    }
    const list = panels?.list() ?? [];
    const covers = panels?.covers ?? [];
    // La stessa superficie avvisa a ogni battuta: le schede si rifanno
    // soltanto quando cambia quali sono.
    if (list.length === shown.length && list.every((panel, i) => shown[i]!.panel === panel) && covers.join("\n") === covered) return;
    clear();
    covered = covers.join("\n");
    shown = list.map((panel) => {
      const { el, title, body } = frame(panel);
      return { panel, el, title, unmount: panel.mount(body) };
    });
    showSurfacePanels(shown.map((each) => each.el), covers);
  };

  draw();
  lifetime.add(on("layout", draw));
  lifetime.add(on("active-doc", draw));
  lifetime.add(on("vault", draw));
  // La superficie si monta dopo il layout: il controllore scrive la modalità
  // sul riquadro quando c'è, come legge la banda di stato.
  const panes = byId("panes");
  if (panes) follow(lifetime, panes, draw, { attributes: ["data-mode"], subtree: true });
  lifetime.add(
    onLanguage(() => {
      for (const each of shown) each.title.textContent = each.panel.title();
      if (shown.length > 0 || covered !== "") showSurfacePanels(shown.map((each) => each.el), covered === "" ? [] : covered.split("\n"));
    }),
  );
}
