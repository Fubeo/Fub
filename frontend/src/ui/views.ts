// Il view host: monta le view che il backend **dichiara**, le ridisegna quando
// dichiarano di essere invecchiate, e rimanda le azioni al provider.
//
// È il punto in cui questa shell smette di sapere cosa esiste: nessun id
// cablato, nessun titolo scritto qui. Una view di plugin comparirà da sola, nel
// contenitore del `placement` che dichiara, col titolo che dichiara — e i tre
// (ora quattro) ViewProvider ufficiali passano esattamente di qui, che è il
// modo in cui si scopre se il protocollo regge.
//
// Il §1.2 chiede che **tutti** i pannelli passino da qui: cestino, cronologia,
// ricerca e grafo oggi non lo fanno, e ciascuno ha la sua ragione (il grafo è
// una superficie privilegiata fuori da `UiNode` per decisione di M2; gli altri
// aspettano i nodi di input del §2.1). Finché convivono due modi di montare un
// pannello, il secondo vince per pigrizia: la ragione va tenuta scritta, o fra
// sei mesi è solo un'incoerenza.
import { api } from "../host/ipc";
import type { UiNode, ViewSpec } from "../host/contract";
import { onAnyEvent, onEvent } from "../state/kernel";
import { on } from "../state/store";
import { $ } from "./dom";
import { applyIntent } from "./intents";
import { renderUiNode } from "./node";

const viewsLeftEl = $("#views-left");
const viewsRightEl = $("#views-right");
const viewsBottomEl = $("#views-bottom");

/// Le view montate, per id: la spec (per sapere QUANDO ridisegnare) e il
/// contenitore (per sapere DOVE).
const mountedViews = new Map<string, { spec: ViewSpec; container: HTMLElement }>();

export function mountViewHost(): void {
  // Le view dichiarative si ridisegnano secondo la loro maschera `refresh`,
  // qualunque sia l'evento: vale per le feature ufficiali come per una futura
  // view di plugin. È l'unico ascoltatore "di tutto" legittimo — decide per
  // dato, non per conoscenza privata di chi c'è.
  onAnyEvent((n) => {
    for (const { spec } of mountedViews.values()) {
      if (spec.refresh.includes(n.event.type)) void renderDeclaredView(spec.id);
    }
  });
  // Eventi persi (coda troncata): ciò che deriva dagli eventi si riconcilia da
  // zero, non si aggiorna.
  onEvent("overflow", () => void refreshAllViews());
  // Il contesto di sessione è stato pubblicato e il kernel ha detto **quali**
  // view seguono ciò che è cambiato (`ViewSpec.follows`).
  on("stale-views", (ids) => void Promise.all(ids.map(renderDeclaredView)));
}

function placementContainer(placement: ViewSpec["placement"]): HTMLElement {
  switch (placement) {
    case "left_sidebar":
      return viewsLeftEl;
    case "right_sidebar":
      return viewsRightEl;
    case "bottom":
      return viewsBottomEl;
  }
}

/// Scopre le view dal backend e le monta nel contenitore del loro placement.
export async function mountDeclaredViews(): Promise<void> {
  mountedViews.clear();
  viewsLeftEl.innerHTML = "";
  viewsRightEl.innerHTML = "";
  viewsBottomEl.innerHTML = "";
  const specs = await api.listViews();
  for (const spec of specs) {
    const host = placementContainer(spec.placement);
    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = spec.title;
    const container = document.createElement("div");
    container.className = "declared-view";
    container.dataset.viewId = spec.id;
    host.append(title, container);
    mountedViews.set(spec.id, { spec, container });
  }
  viewsBottomEl.hidden = viewsBottomEl.childElementCount === 0;
  await refreshAllViews();
}

async function renderDeclaredView(id: string): Promise<void> {
  const mounted = mountedViews.get(id);
  if (!mounted) return;
  try {
    await mountView(id, mounted.container, await api.renderView(id));
  } catch (e) {
    console.error(`FubMD: la view «${id}» non si è ridisegnata: ${e}`);
  }
}

async function refreshAllViews(): Promise<void> {
  await Promise.all([...mountedViews.keys()].map(renderDeclaredView));
}

// Disegna una view in un contenitore e chiude il giro azione→ViewUpdate: un
// click torna al provider via `view_action` e la risposta si interpreta qui.
async function mountView(view: string, target: HTMLElement, node: UiNode): Promise<void> {
  target.innerHTML = "";
  target.appendChild(
    renderUiNode(node, async (action) => {
      const update = await api.viewAction(view, action);
      if (update.kind === "replace") {
        await mountView(view, target, update.root);
        return;
      }
      await applyIntent(update);
    }),
  );
}
