// Le view che il backend **dichiara**: scoprirle, ritagliargli un contenitore,
// disegnarle e rimandare le azioni al provider.
//
// È il punto in cui questa shell smette di sapere cosa esiste: nessun id
// cablato, nessun titolo scritto qui. Una view di plugin comparirà da sola, sulla
// superficie che dichiara, col titolo che dichiara — e i quattro ViewProvider
// ufficiali passano esattamente di qui, che è il modo in cui si scopre se il
// protocollo regge.
//
// **Quando** ridisegnare non si decide qui: una view dichiarata è un `Panel`
// come gli altri (`ui/panel-host.ts`), e la sua `refresh` è la stessa maschera
// che il `ViewSpec` porta. Questo file resta l'adattatore fra le due forme — un
// `ViewSpec` del contratto e un `Panel` della shell — più le due cose che dalla
// seduta 2 sono sue soltanto: **quale istanza** sta guardando (§2.3) e
// l'**invito a ridisegnare** che arriva da un provider (§2.5).
//
// # Le superfici che questa shell ospita, e quelle che no
//
// Il contratto ne nomina dieci (§2.2). Questa shell ne ospita sei — le tre
// sidebar/basso di prima, più barra di stato, ribbon e modale — e le altre
// quattro le dichiara **non ospitate** invece di lasciarle cadere in silenzio:
// area principale, menu, menu contestuale e scheda di impostazioni vogliono
// rispettivamente il modello di layout (§1.2, che è la feature 3.3), un menu
// applicativo e un pannello di impostazioni, e nessuno dei tre esiste ancora.
// Una view che le chiede riceve un avviso che la nomina: è il minimo che il
// §20.4 chiede, in attesa della superficie vera dove dirlo.
import { api } from "../host/ipc";
import type { ActionRef, FieldValue, UiNode, ViewSpec, ViewSurface } from "../host/contract";
import { $ } from "./dom";
import { applyIntent } from "./intents";
import { mountTree, patchTree, unmountTree } from "./node";
import { onEvent } from "../state/kernel";
import { refreshPanel, registerPanel, unregisterPanel } from "./panel-host";

const viewsLeftEl = $("#views-left");
const viewsRightEl = $("#views-right");
const viewsBottomEl = $("#views-bottom");
const viewsStatusEl = $("#views-status");
const viewsRibbonEl = $("#views-ribbon");
const viewsModalEl = $("#views-modal");

/// Un esemplare montato: dove disegnarlo, e con che identità e parametri
/// chiederlo al kernel.
interface Montata {
  container: HTMLElement;
  instance: string;
  params: unknown;
}

/// Le istanze montate, per id di view: il registro dei pannelli sa **quando**
/// ridisegnarle, questo sa **dove** e **quale**.
const montate = new Map<string, Montata>();

/// La superficie di una view → il contenitore che la ospita, o `null` se questa
/// shell non ce l'ha ancora.
function surfaceContainer(surface: ViewSurface): HTMLElement | null {
  switch (surface) {
    case "left_sidebar":
      return viewsLeftEl;
    case "right_sidebar":
      return viewsRightEl;
    case "bottom":
      return viewsBottomEl;
    case "status_bar":
      return viewsStatusEl;
    case "ribbon":
      return viewsRibbonEl;
    case "modal":
      return viewsModalEl;
    case "main":
    case "menu":
    case "context_menu":
    case "settings_tab":
      return null;
  }
}

/// Perché una superficie non è ospitata. Sta scritto qui e non in un commento
/// perché è ciò che l'avviso dice a chi ha scritto la view: senza, il messaggio
/// sarebbe «non supportato», che non aiuta nessuno a capire cosa aspettare.
const NON_OSPITATE: Record<string, string> = {
  main: "l'area principale ha un editor solo: serve il modello di layout (§1.2, FEATURES 3.3)",
  menu: "questa shell non ha un menu applicativo",
  context_menu: "questa shell non ha un menu contestuale estendibile",
  settings_tab: "questa shell non ha ancora un pannello di impostazioni (§11.1)",
};

/// Scopre le view dal backend e le monta sulla superficie che dichiarano.
///
/// Si riparte da zero a ogni vault aperto: i provider registrati possono essere
/// altri, e una view rimasta nel registro sarebbe un pannello che chiede di
/// ridisegnarsi a un provider che non c'è più.
export async function mountDeclaredViews(): Promise<void> {
  for (const [id, montata] of montate) {
    unregisterPanel(id);
    unmountTree(montata.container);
  }
  montate.clear();
  for (const el of [
    viewsLeftEl,
    viewsRightEl,
    viewsBottomEl,
    viewsStatusEl,
    viewsRibbonEl,
    viewsModalEl,
  ]) {
    el.replaceChildren();
  }

  const specs = await api.listViews();
  // L'ordine fra le view di una stessa superficie lo dichiara la view (§2.6);
  // i pari merito restano nell'ordine di registrazione, che è ciò che
  // `sort` stabile garantisce.
  for (const spec of [...specs].sort((a, b) => a.order - b.order)) {
    const host = surfaceContainer(spec.surface);
    if (!host) {
      console.warn(
        `FubMD: la view «${spec.id}» chiede la superficie «${spec.surface}», che questa shell non ospita: ${
          NON_OSPITATE[spec.surface] ?? "superficie sconosciuta"
        }.`,
      );
      continue;
    }
    montaSpec(spec, host);
  }

  viewsBottomEl.hidden = viewsBottomEl.childElementCount === 0;
  viewsStatusEl.hidden = viewsStatusEl.childElementCount === 0;
  viewsRibbonEl.hidden = viewsRibbonEl.childElementCount === 0;
  viewsModalEl.hidden = viewsModalEl.childElementCount === 0;
  await Promise.all([...montate.keys()].map((id) => refreshPanel(id)));
}

function montaSpec(spec: ViewSpec, host: HTMLElement): void {
  const pannello = document.createElement("div");
  pannello.className = "declared-view-panel";
  // `open_by_default` decide come nasce; da lì in poi decide chi clicca — e
  // solo se la view si lascia chiudere.
  pannello.classList.toggle("collapsed", !spec.open_by_default);

  const title = document.createElement("div");
  title.className = "panel-title";
  if (spec.icon) title.dataset.icon = spec.icon;
  title.textContent = spec.title;
  if (spec.closable) {
    title.classList.add("clickable");
    title.addEventListener("click", () => pannello.classList.toggle("collapsed"));
  }

  const container = document.createElement("div");
  container.className = "declared-view";
  container.dataset.viewId = spec.id;
  // La dimensione preferita vale alla prima apertura: da lì in poi comanda ciò
  // che l'utente ha trascinato — quando ci sarà qualcosa da trascinare.
  if (spec.preferred_size !== null) {
    const asse = spec.surface === "bottom" ? "height" : "width";
    container.style[asse] = `${spec.preferred_size}px`;
  }

  pannello.append(title, container);
  host.appendChild(pannello);
  // L'istanza che la shell monta da sé è l'esemplare unico: si chiama come la
  // sua specie e non ha parametri (§2.3). Le istanze multiple arrivano con chi
  // le apre — `CommandEffect::OpenView` — e con il modello di layout che dà
  // loro dove stare.
  montate.set(spec.id, { container, instance: spec.id, params: null });

  registerPanel({
    id: spec.id,
    title: spec.title,
    placement: spec.surface,
    refresh: spec.refresh,
    // `follows` non si traduce in `followsDoc`: chi legge il `ViewSpec` e
    // decide quali view sono invecchiate è il **kernel**, che risponde col
    // segnale `stale-views` — la shell non rifà quel conto per conto suo.
    render: () => renderDeclaredView(spec.id),
  });
}

async function renderDeclaredView(id: string): Promise<void> {
  const montata = montate.get(id);
  if (!montata) return;
  const albero = await api.renderView(id, montata.instance, montata.params);
  disegna(id, montata, albero);
}

/// Disegna un albero nel contenitore della sua istanza e chiude il giro
/// azione→`ViewUpdate`: un click torna al provider via `view_action` con le sue
/// due metà, e la risposta si interpreta qui.
function disegna(id: string, montata: Montata, albero: UiNode): void {
  mountTree(montata.container, albero, async (action: ActionRef, fields: FieldValue[]) => {
    const update = await api.viewAction(
      id,
      montata.instance,
      montata.params,
      action.action,
      action.payload,
      fields,
    );
    if (update.kind === "replace") {
      disegna(id, montata, update.root);
      return;
    }
    if (update.kind === "patch") {
      // Una chiave che non c'è più non è un errore: è una view cambiata sotto,
      // e la si ridisegna intera invece di lasciarla stantia.
      if (!patchTree(montata.container, update.key, update.node)) {
        await renderDeclaredView(id);
      }
      return;
    }
    await applyIntent(update);
  });
}

/// Attacca l'invito a ridisegnare che arriva da un provider (§2.5).
///
/// Il freno è qui e non nel kernel per la ragione scritta accanto a
/// `Event::ViewInvalidated`: **venti inviti in un giro sono un ridisegno**, e a
/// saperlo è chi disegna. La finestra è un microtask — cioè "quando questo giro
/// di eventi è finito" — che è la grana giusta: un job che chiude e un evento
/// del vault che arrivano insieme non producono due giri di query.
export function mountViewInvalidation(): void {
  const invecchiate = new Set<string>();
  let programmato = false;
  onEvent("view_invalidated", (event) => {
    // `instance` assente = tutte le istanze di quella view. Con una sola
    // istanza per view le due cose coincidono, e la distinzione conta il giorno
    // che le istanze saranno N: chi ne ha invecchiata una non deve pagare il
    // ridisegno delle sorelle.
    const montata = montate.get(event.view);
    if (!montata) return;
    if (event.instance !== null && event.instance !== montata.instance) return;
    invecchiate.add(event.view);
    if (programmato) return;
    programmato = true;
    queueMicrotask(() => {
      programmato = false;
      const da = [...invecchiate];
      invecchiate.clear();
      for (const id of da) void refreshPanel(id);
    });
  });
}
