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
// Il contratto ne nomina dieci (§2.2). Questa shell ne ospita **sette** — le
// tre sidebar/basso di prima, più barra di stato, ribbon, modale e, dal §11.1,
// la scheda di impostazioni — e le altre tre le dichiara **non ospitate**
// invece di lasciarle cadere in silenzio: area principale, menu e menu
// contestuale vogliono il modello di layout (§1.2, che è la feature 3.3) e un
// menu applicativo, che non esistono ancora. Una view che le chiede riceve un
// avviso che la nomina: è il minimo che il §20.4 chiede, in attesa della
// superficie vera dove dirlo.
import { api } from "../host/ipc";
import type { ActionRef, FieldValue, UiNode, ViewSpec, ViewSurface } from "../host/contract";
import { $ } from "./dom";
import { attivabile, intrappolaFuoco } from "./a11y";
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
const viewsSettingsEl = $("#views-settings");

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
    // La scheda di impostazioni (§11.1): il pannello adesso c'è, e questa è la
    // sua area per le view dichiarate. Non è una scheda **per view** — quello
    // vuole il modello di layout (§1.2) — è la superficie che il contratto
    // nomina, ospitata dove ha senso.
    case "settings_tab":
      return viewsSettingsEl;
    case "main":
    case "menu":
    case "context_menu":
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
    viewsSettingsEl,
  ]) {
    el.replaceChildren();
  }
  // Il nome della superficie modale se ne va coi titoli che lo componevano: un
  // `aria-labelledby` che sopravvive a ciò a cui punta è la regola *riferimento
  // nel vuoto* del presidio, ed è il modo più silenzioso di perdere un nome —
  // l'attributo c'è, sembra a posto, e non nomina nessuno. Tolto lui, resta
  // l'`aria-label` di ripiego che `index.html` porta di suo.
  viewsModalEl.removeAttribute("aria-labelledby");

  const specs = await api.listViews();
  // L'ordine fra le view di una stessa superficie lo dichiara la view (§2.6);
  // i pari merito restano nell'ordine di registrazione, che è ciò che
  // `sort` stabile garantisce.
  for (const spec of [...specs].sort((a, b) => a.order - b.order)) {
    const host = surfaceContainer(spec.surface);
    if (!host) {
      console.warn(
        `Fub: la view «${spec.id}» chiede la superficie «${spec.surface}», che questa shell non ospita: ${
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
  trappolaModale();
  await Promise.all([...montate.keys()].map((id) => refreshPanel(id)));
}

/// Come si scioglie la trappola del fuoco della superficie modale.
let sciogliModale: (() => void) | null = null;

/// Tiene il fuoco dentro `#views-modal` finché ci sta dentro qualcosa (§12.4).
///
/// La superficie modale non si «apre» e non si «chiude» come le altre modali
/// della shell: **esiste** finché una view dichiarata la occupa, e sparisce
/// quando nessuno la chiede più. Quindi la trappola segue lo stesso segnale che
/// decide se è visibile — `hidden` — invece di un `apri()`/`chiudi()` che qui
/// non esistono.
///
/// Escape la chiude togliendole ciò che contiene: è l'unica cosa che questa
/// shell possa fare senza inventarsi un modo per dire a un provider «l'utente
/// ha rinunciato», che è roba del contratto e non di questa voce. La view
/// ricompare al prossimo `mountDeclaredViews`, che è quanto basta perché
/// Escape non sia una via d'uscita definitiva da qualcosa che serviva.
function trappolaModale(): void {
  sciogliModale?.();
  sciogliModale = null;
  if (viewsModalEl.hidden) return;
  sciogliModale = intrappolaFuoco(viewsModalEl, () => {
    viewsModalEl.hidden = true;
    sciogliModale?.();
    sciogliModale = null;
  });
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
  // Il titolo di un pannello è un titolo: darglielo mette le view dichiarate
  // nell'indice che un lettore di schermo costruisce per saltare da una
  // sezione all'altra. Senza, un pannello si trova solo scorrendolo tutto.
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "2");
  if (spec.closable) {
    title.classList.add("clickable");
    title.addEventListener("click", () => {
      const chiuso = pannello.classList.toggle("collapsed");
      title.setAttribute("aria-expanded", String(!chiuso));
    });
    // Un titolo cliccabile è un titolo **e** un comando. `aria-expanded` sta
    // sul titolo e non sul pannello perché è il titolo che si preme, ed è di
    // ciò che si preme che serve sapere in che stato mette le cose.
    attivabile(title);
    // `attivabile` metterebbe `role="button"` a chi non ha ruolo; qui il ruolo
    // c'è già ed è quello giusto, quindi resta titolo. Il tabindex sì.
    title.setAttribute("aria-expanded", String(spec.open_by_default));
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

  // La superficie modale è un `role="dialog"`, e un dialogo senza nome si
  // annuncia «finestra di dialogo» e nient'altro: chi ci finisce dentro deve
  // leggerselo per sapere dove è finito. Il nome è il titolo della view che lo
  // occupa — l'unica cosa che questa shell sappia di lui, visto che il
  // contenuto lo decide un provider. Se ne occupano due, il nome sono
  // entrambi, in ordine: `aria-labelledby` prende una lista apposta, e
  // sceglierne uno a caso sarebbe peggio che dirli tutti e due.
  if (host === viewsModalEl) {
    title.id = `views-modal-titolo-${spec.id}`;
    const nomi = host.getAttribute("aria-labelledby");
    host.setAttribute("aria-labelledby", nomi ? `${nomi} ${title.id}` : title.id);
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
    // Dal §22.3 questa maschera è quella dell'**esemplare**, non della specie:
    // il kernel la risolve chiedendola al provider prima di mettere la spec
    // nell'elenco, per l'esemplare che la shell monta da sé. La shell non fa un
    // secondo giro per riaverla — la domanda ha già una risposta qui dentro.
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
