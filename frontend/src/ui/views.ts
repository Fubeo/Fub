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
// Il contratto ne nomina dieci (§2.2). Questa shell ne ospita **nove** — le tre
// sidebar/basso di prima, più barra di stato, ribbon, modale, la scheda di
// impostazioni (§11.1), l'**area principale** e, dalla scocca custom, il
// **menu applicativo** — e l'unica che dichiara **non ospitata** è il menu
// contestuale estendibile. Una view che lo chiede riceve un avviso che lo
// nomina, e dal §20.4 quell'avviso arriva a chi guarda lo schermo invece che a
// una console che nessuno apre.
//
// # `main` è ospitata, e in un modo diverso da tutte le altre
//
// Le altre otto hanno un contenitore in `index.html`: c'è, è uno, e una view
// che le dichiara ci finisce dentro da sola all'avvio. L'area principale no —
// di riquadri ce ne sono N, si dividono e si chiudono, e un riquadro non è un
// posto che si riempie da solo: è un posto in cui **qualcuno mette qualcosa**.
//
// Quindi una view di `main` non si monta all'avvio. Si dichiara e aspetta, e
// quando un riquadro apre la sua linguetta è `panels/document.ts` a chiedere che venga
// montata **lì**, con l'esemplare che è l'id del riquadro. È il punto in cui i
// due registri del §1.2 si incontrano, che `ui/panel-host.ts` diceva sarebbe
// arrivato con questa voce e non prima.
import { api } from "../host/ipc";
import { Race } from "./race";
import type { ActionRef, FieldValue, UiNode, ViewSpec, ViewSurface } from "../host/contract";
import { $ } from "./dom";
import { activatable, trapFocus } from "./a11y";
import { applyIntent } from "./intents";
import { mountTree, patchTree, unmountTree } from "./node";
import { onEvent } from "../state/kernel";
import { flushPendingSave } from "../panels/document";
import { refreshPanel, registerPanel, unregisterPanel } from "./panel-host";
import { notify } from "./notify";
import { t } from "../i18n/strings";
import { iconEl } from "./icons";

const viewsLeftEl = $("#views-left");
const viewsRightEl = $("#views-right");
const viewsBottomEl = $("#views-bottom");
const viewsStatusEl = $("#views-status");
const viewsRibbonEl = $("#views-ribbon");
const viewsModalEl = $("#views-modal");
const viewsSettingsEl = $("#views-settings");
const viewsMenuExtraEl = $("#app-menu-extra");

/// Un esemplare montato: dove disegnarlo, e con che identità e parametri
/// chiederlo al kernel.
interface Mounted {
  /// Quale view è, cioè l'id della `ViewSpec`. Non coincide più con la chiave
  /// della mappa: dalla §3.3 la stessa view può essere montata in due riquadri,
  /// e allora gli esemplari sono due e la view una.
  view: string;
  container: HTMLElement;
  instance: string;
  params: unknown;
  /// I ridisegni di questo pannello, di cui conta solo l'ultimo (0134). Sta
  /// dentro la `Montata` e non in una mappa accanto perché è **della stessa
  /// cosa**: quando la montata se ne va, i suoi giri in volo se ne vanno con
  /// lei, e non c'è una seconda mappa da ricordarsi di ripulire.
  race: Race;
}

/// Le istanze montate, per **id di pannello**: il registro dei pannelli sa
/// **quando** ridisegnarle, questo sa **dove** e **quale**.
///
/// La chiave era l'id della view, ed era la stessa cosa finché di esemplari ce
/// n'era uno per view. Con l'area principale non lo è più — il grafo aperto in
/// due riquadri è un pannello per riquadro — quindi la chiave è quella del
/// pannello, e chi cerca «tutte le istanze di questa view» filtra su `view`.
const mounted = new Map<string, Mounted>();

/// Le view che dichiarano la superficie principale, per id.
///
/// Non sono montate: sono **disponibili**. Chi apre una linguetta di view le cerca
/// qui, e il titolo che ne legge è quello che finisce sulla linguetta.
const primarySpecs = new Map<string, ViewSpec>();

/// Le view che un riquadro può ospitare, in ordine di dichiarazione.
export function primaryViews(): ViewSpec[] {
  return [...primarySpecs.values()];
}

export function primaryView(id: string): ViewSpec | undefined {
  return primarySpecs.get(id);
}

/// L'id del pannello di una view montata in un riquadro.
///
/// Composto, e non l'id della view: due riquadri sullo stesso grafo sono due
/// pannelli, che invecchiano e si ridisegnano ognuno per conto suo.
function panePanel(view: string, pane: string): string {
  return `${view}@${pane}`;
}

/// Monta (o rimonta) una view dichiarata dentro il riquadro `pane`.
///
/// **Idempotente**: chiamarla di nuovo sullo stesso contenitore ridisegna e
/// basta. È ciò che permette a chi disegna i riquadri di chiamarla a ogni giro
/// senza tenere il conto di cosa ha già montato — e ciò che rimette in piedi le
/// view dei riquadri dopo un cambio di vault, quando `mountDeclaredViews`
/// azzera tutto.
export async function mountViewInPane(
  view: string,
  pane: string,
  container: HTMLElement,
): Promise<void> {
  const spec = primarySpecs.get(view);
  if (!spec) return;
  const id = panePanel(view, pane);
  const already = mounted.get(id);
  if (!already || already.container !== container) {
    if (already) unmountTree(already.container);
    // L'esemplare **è il riquadro**: è la stessa identità che il `ViewContext`
    // porta di là dal confine (`pane`), quindi lo stato di vista di una view
    // aperta in due riquadri si separa esattamente dove l'utente vede due cose.
    mounted.set(id, { view, container, instance: pane, params: null, race: new Race() });
    registerPanel({
      id,
      title: spec.title,
      placement: spec.surface,
      refresh: spec.refresh,
      // Chi il kernel dichiara invecchiato è la **view**; questo pannello è uno
      // dei suoi esemplari, e senza questa riga `stale-views` non lo troverebbe.
      view,
      render: () => renderDeclaredView(id),
    });
  }
  await refreshPanel(id);
}

/// Il riquadro ha smesso di mostrare questa view.
export function unmountViewFromPane(view: string, pane: string): void {
  const id = panePanel(view, pane);
  const mountedView = mounted.get(id);
  if (!mountedView) return;
  unregisterPanel(id);
  unmountTree(mountedView.container);
  mounted.delete(id);
}

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
    // L'area principale è ospitata, ma non da qui: il suo contenitore è un
    // riquadro, e quale riquadro lo decide chi apre la tab. Vedi
    // `primaryViews` più sotto — `null` qui significa «non all'avvio», non
    // «non si può».
    case "main":
      return null;
    case "menu":
      return viewsMenuExtraEl;
    case "context_menu":
      return null;
  }
}

/// Perché una superficie non è ospitata. Sta scritto qui e non in un commento
/// perché è ciò che l'avviso dice a chi ha scritto la view: senza, il messaggio
/// sarebbe «non supportato», che non aiuta nessuno a capire cosa aspettare.
const NON_OSPITATE: Record<string, string> = {
  context_menu: "questa shell non ha un menu contestuale estendibile",
};

/// Scopre le view dal backend e le monta sulla superficie che dichiarano.
///
/// Si riparte da zero a ogni vault aperto: i provider registrati possono essere
/// altri, e una view rimasta nel registro sarebbe un pannello che chiede di
/// ridisegnarsi a un provider che non c'è più.
/// I rimontaggi, di cui conta solo l'ultimo: due aperture di vault ravvicinate
/// smontano e rimontano tutto due volte, e senza un padrone la prima
/// finirebbe di montare dentro un mondo che la seconda ha appena svuotato.
const mountRun = new Race();

export async function mountDeclaredViews(): Promise<void> {
  // **Si chiede prima, si smonta dopo**, ed è il difetto 0088: l'ordine di
  // prima buttava giù tutto — pannelli, alberi, le due mappe, i sette
  // contenitori, il nome della superficie modale — e *poi* chiedeva l'elenco.
  // Se la domanda falliva, e basta un vault che si apre male o un kernel che si
  // sta riavviando, non c'era nessun `catch` da nessuna parte: la shell restava
  // vuota, `primaryViews()` tornava una lista vuota, e quindi nemmeno un
  // riquadro poteva più riaprire una view principale. Nessuna concorrenza,
  // nessun token: un solo rigetto, e non c'era niente da cui tornare indietro.
  //
  // Chiedere prima toglie il caso alla radice invece di ripararlo: se la
  // domanda non risponde, ciò che c'è sullo schermo è vecchio ma **vivo**, che
  // è la peggiore delle due cose che si possono avere e la migliore delle due
  // che si possono scegliere.
  const specs = await mountRun.last(async (expected) => await expected(api.listViews()));
  // Il giro è scaduto: un rimontaggio più nuovo sta già lavorando, e questo non
  // deve smontare ciò che quello ha montato.
  if (!specs) return;

  for (const [id, mountedView] of mounted) {
    unregisterPanel(id);
    unmountTree(mountedView.container);
  }
  mounted.clear();
  primarySpecs.clear();
  for (const el of [
    viewsLeftEl,
    viewsRightEl,
    viewsBottomEl,
    viewsStatusEl,
    viewsModalEl,
    viewsSettingsEl,
    viewsMenuExtraEl,
  ]) {
    el.replaceChildren();
  }
  // La rail non si svuota tutta: `#rail-shell` (le icone della shell) resta,
  // e si tolgono solo le view dichiarate che il giro precedente aveva
  // appoggiato dopo di lui.
  for (const viewBtn of viewsRibbonEl.querySelectorAll(".rail-btn-view")) {
    viewBtn.remove();
  }
  // Il nome della superficie modale se ne va coi titoli che lo componevano: un
  // `aria-labelledby` che sopravvive a ciò a cui punta è la regola *riferimento
  // nel vuoto* del presidio, ed è il modo più silenzioso di perdere un nome —
  // l'attributo c'è, sembra a posto, e non nomina nessuno. Tolto lui, resta
  // l'`aria-label` di ripiego che `index.html` porta di suo.
  viewsModalEl.removeAttribute("aria-labelledby");

  // L'ordine fra le view di una stessa superficie lo dichiara la view (§2.6);
  // i pari merito restano nell'ordine di registrazione, che è ciò che
  // `sort` stabile garantisce.
  for (const spec of [...specs].sort((a, b) => a.order - b.order)) {
    // L'area principale si dichiara e aspetta un riquadro: non è un avviso, è
    // il suo modo di essere ospitata.
    if (spec.surface === "main") {
      primarySpecs.set(spec.id, spec);
      continue;
    }
    const host = surfaceContainer(spec.surface);
    if (!host) {
      notify(
        t("views.surface_missing", {
          view: spec.id,
          surface: spec.surface,
          reason: NON_OSPITATE[spec.surface] ?? "superficie sconosciuta",
        }),
        "info",
      );
      continue;
    }
    mountSpec(spec, host);
  }

  viewsBottomEl.hidden = viewsBottomEl.childElementCount === 0;
  viewsStatusEl.hidden = viewsStatusEl.childElementCount === 0;
  viewsModalEl.hidden = viewsModalEl.childElementCount === 0;
  // L'inspector a tab: per le view `right_sidebar` costruisce un tablist in
  // cima. Va dopo il montaggio, perché legge i pannelli già nati.
  buildInspector();
  modalTrap();
  await Promise.all([...mounted.keys()].map((id) => refreshPanel(id)));
}

/// Come si scioglie la trappola del fuoco della superficie modale.
let releaseModal: (() => void) | null = null;

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
function modalTrap(): void {
  releaseModal?.();
  releaseModal = null;
  if (viewsModalEl.hidden) return;
  releaseModal = trapFocus(viewsModalEl, () => {
    viewsModalEl.hidden = true;
    releaseModal?.();
    releaseModal = null;
  });
}

function mountSpec(spec: ViewSpec, host: HTMLElement): void {
  const panel = document.createElement("div");
  panel.className = "declared-view-panel";
  // L'id sta sul pannello, non solo sul contenitore interno: la rail e
  // l'inspector a tab lo cercano da qui (`dataset.viewId`). Senza, i bottoni
  // della rail non nascevano e i tab persistivano `view-0` invece dell'id vero.
  panel.dataset.viewId = spec.id;
  panel.id = `view-panel-${spec.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const title = document.createElement("div");
  title.className = "panel-title";
  if (spec.icon) title.dataset.icon = spec.icon;
  title.textContent = spec.title;
  // Il titolo di un pannello è un titolo: darglielo mette le view dichiarate
  // nell'indice che un lettore di schermo costruisce per saltare da una
  // sezione all'altra. Senza, un pannello si trova solo scorrendolo tutto.
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "2");
  const container = document.createElement("div");
  container.className = "declared-view";
  container.dataset.viewId = spec.id;
  // `open_by_default` decide come nasce; da lì in poi decide chi clicca — e
  // solo se la view si lascia chiudere.
  //
  // Chiuso è `hidden` sul contenuto, e non più una classe `collapsed` sul
  // pannello con una regola della pelle che la traduce in `display: none`.
  // Erano due scritture della stessa cosa e **divergevano**: aprire un
  // pannello dalla rail (`panels/sidebar.ts`) toglieva la classe e lasciava
  // `aria-expanded="false"` sul titolo, cioè la pelle lo mostrava aperto
  // mentre chi lo ascoltava lo sentiva ancora chiuso. `hidden` è già il modo
  // con cui questa shell nasconde le cose, ed è già accessibile: la pelle non
  // ha più niente da dire in proposito.
  container.hidden = !spec.open_by_default;

  if (spec.closable) {
    title.classList.add("clickable");
    title.addEventListener("click", () => {
      container.hidden = !container.hidden;
      title.setAttribute("aria-expanded", String(!container.hidden));
    });
    // Un titolo cliccabile è un titolo **e** un comando. `aria-expanded` sta
    // sul titolo e non sul pannello perché è il titolo che si preme, ed è di
    // ciò che si preme che serve sapere in che stato mette le cose.
    activatable(title);
    // `activatable` metterebbe `role="button"` a chi non ha ruolo; qui il ruolo
    // c'è già ed è quello giusto, quindi resta titolo. Il tabindex sì.
    title.setAttribute("aria-expanded", String(spec.open_by_default));
  }
  // La dimensione preferita vale alla prima apertura: da lì in poi comanda ciò
  // che l'utente ha trascinato — quando ci sarà qualcosa da trascinare.
  if (spec.preferred_size !== null) {
    const dimension = spec.surface === "bottom" ? "height" : "width";
    container.style[dimension] = `${spec.preferred_size}px`;
  }

  // La superficie modale è un `role="dialog"`, e un dialogo senza nome si
  // annuncia «finestra di dialogo» e nient'altro: chi ci finisce dentro deve
  // leggerselo per sapere dove è finito. Il nome è il titolo della view che lo
  // occupa — l'unica cosa che questa shell sappia di lui, visto che il
  // contenuto lo decide un provider. Se ne occupano due, il nome sono
  // entrambi, in ordine: `aria-labelledby` prende una lista apposta, e
  // sceglierne uno a caso sarebbe peggio che dirli tutti e due.
  if (host === viewsModalEl) {
    title.id = `views-modal-title-${spec.id}`;
    const names = host.getAttribute("aria-labelledby");
    host.setAttribute("aria-labelledby", names ? `${names} ${title.id}` : title.id);
  }

  panel.append(title, container);
  host.appendChild(panel);
  // L'istanza che la shell monta da sé è l'esemplare unico: si chiama come la
  // sua specie e non ha parametri (§2.3). Le istanze multiple arrivano con chi
  // le apre — `CommandEffect::OpenView` — e con il modello di layout che dà
  // loro dove stare.
  mounted.set(spec.id, {
    view: spec.id,
    container,
    instance: spec.id,
    params: null,
    race: new Race(),
  });

  registerPanel({
    id: spec.id,
    view: spec.id,
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

/// `id` è quello del **pannello**, che per una view di riquadro non è quello
/// della view: al kernel si chiede `montata.view`.
///
/// La distinzione è nata con la §3.3 e va detta perché è invisibile finché i due
/// coincidono — cioè per le sette superfici di prima, dove un pannello *è* una
/// view. Chiedere al kernel di disegnare «graph@main» significa nominare una
/// view che non esiste, e la risposta è un errore che `refreshPanel` scrive in
/// console: un riquadro vuoto, e niente che dica perché.
async function renderDeclaredView(id: string): Promise<void> {
  const mountedView = mounted.get(id);
  if (!mountedView) return;
  // La corsa è **del pannello montato**, non del modulo: le view dichiarate si
  // ridisegnano tutte insieme (un `stale-views`, un `batch_ended`), e un
  // contatore unico le farebbe annullare a vicenda lasciando disegnata solo
  // l'ultima che risponde.
  //
  // Il difetto misurato nominava il ripiego da `patch` — `patchTree` fallisce e
  // si ridisegna l'albero intero — ma la finestra non è là: è **qui**, in
  // `renderDeclaredView` e basta, e il ripiego è solo il chiamante più
  // evidentemente concorrente. Riparandola al posto nominato sarebbero rimasti
  // scoperti il ramo `replace` e ogni ridisegno che arriva da un evento, che
  // sono i più frequenti.
  await mountedView.race.last(async (expected) => {
    const tree = await expected(api.renderView(mountedView.view, mountedView.instance, mountedView.params));
    draw(id, mountedView, tree);
  });
}

/// Disegna un albero nel contenitore della sua istanza e chiude il giro
/// azione→`ViewUpdate`: un click torna al provider via `view_action` con le sue
/// due metà, e la risposta si interpreta qui.
function draw(id: string, mounted: Mounted, tree: UiNode): void {
  mountTree(mounted.container, tree, async (action: ActionRef, fields: FieldValue[]) => {
    // **Il buffer esce prima.** Un'azione di view può finire in una scrittura
    // del vault — la cronologia che ripristina una versione, il cestino che
    // ripristina una nota — e la riscrittura del kernel finirebbe altrimenti
    // sotto la copia più vecchia che l'autosave ha ancora in coda. La shell non
    // sa quali azioni scrivono e quali no, quindi mette in salvo prima di tutte:
    // costa zero quando il buffer è pulito, che è il caso di ogni battuta di
    // tasto in un filtro.
    //
    // Non è **la** riparazione: quella è la revisione nella firma di
    // `write_document` (§18.1), che toglie la corsa invece di ordinarla. Questa
    // toglie l'unico caso in cui la corsa la perdeva sempre lo stesso.
    await flushPendingSave();
    // **Qui non c'è un `try`, ed è deliberato.** Un'azione che va storta la dice
    // la `Port` di `ui/node.ts` — l'unica strada che un'azione ha per uscire da
    // un albero montato — e scriverne uno anche qui vorrebbe dire due frasi per
    // lo stesso guasto, o una qui e nessuna per il prossimo `mountTree`. Il
    // difetto misurato nominava questa riga: era il testimone, non l'autore.
    const update = await api.viewAction(
      // La view, non il pannello: vedi la nota su `renderDeclaredView`.
      mounted.view,
      mounted.instance,
      mounted.params,
      action.action,
      action.payload,
      fields,
    );
    if (update.kind === "replace") {
      draw(id, mounted, update.root);
      return;
    }
    if (update.kind === "patch") {
      // Una chiave che non c'è più non è un errore: è una view cambiata sotto,
      // e la si ridisegna intera invece di lasciarla stantia.
      if (!patchTree(mounted.container, update.key, update.node)) {
        await renderDeclaredView(id);
      }
      return;
    }
    await applyIntent(update);
  });
}


/// L'inspector a tab: per le view `right_sidebar`, una tab per view.
///
/// Le view dichiarate con `right_sidebar` si montano in `#views-right` come
/// pannelli (`.declared-view-panel`), tutti visibili insieme fin qui. La
/// shell vuole invece un inspector a tab — uno alla volta, come Obsidian —
/// e questa funzione lo costruisce: un tablist in cima, un tab per view, e
/// tutti i pannelli nascosti tranne quello attivo.
///
/// La scelta si persiste con `api.setViewState("inspector.tab", id)` e si
/// ripristina al rimontaggio: chi aveva aperto Backlink ritrova Backlink.
/// Il default è la prima view `open_by_default`, o la prima in assoluto.
function buildInspector(): void {
  const panels = [...viewsRightEl.querySelectorAll<HTMLElement>(".declared-view-panel")];
  // Rimuove il tablist del giro precedente, se c'è.
  viewsRightEl.querySelector(".inspector-tabs")?.remove();
  if (panels.length === 0) return;

  // Il tablist: un bottone per view, con ruolo `tab`. L'aria-selected segue
  // quale è attivo, e le frecce lo spostano — la navigazione da tastiera
  // che un tablist ARIA richiede.
  const tablist = document.createElement("div");
  tablist.className = "inspector-tabs";
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", t("inspector.region"));

  // Quale tab è attivo? La scelta persistita, o la prima open_by_default,
  // o la prima in assoluto. La si scopre dopo aver costruito i tab, perché
  // la persistenza è async e il default è sincrono.
  let active = 0;
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i]!;
    const viewId = panel.dataset.viewId ?? `view-${i}`;
    const title = panel.querySelector<HTMLElement>(".panel-title");
    const name = title?.textContent ?? viewId;
    const icon = title?.dataset.icon ?? "outline";

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "inspector-tab";
    tab.setAttribute("role", "tab");
    tab.dataset.viewId = viewId;
    tab.setAttribute("aria-selected", "false");
    tab.setAttribute("aria-controls", panel.id || viewId);
    tab.title = name;
    // L'icona: se la view ne dichiara una la si usa, altrimenti il fallback.
    const svg = iconEl(icon) ?? iconEl("outline");
    if (svg) tab.append(svg);
    // Il nome come tooltip e aria-label; il testo visibile è l'icona sola,
    // per tenere l'inspector compatto come una barra laterale deve essere.
    tab.setAttribute("aria-label", name);

    tab.addEventListener("click", () => activateTab(i));
    // Frecce sinistra/destra: navigazione del tablist, come ARIA chiede.
    tab.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = (i + 1) % panels.length;
        activateTab(next);
        (tablist.children[next] as HTMLElement)?.focus();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const previous = (i - 1 + panels.length) % panels.length;
        activateTab(previous);
        (tablist.children[previous] as HTMLElement)?.focus();
      }
    });

    tablist.append(tab);
  }

  // Mostra solo il pannello attivo, nasconde gli altri. `aria-selected` e
  // `hidden` seguono la stessa scelta, ed è ciò che li tiene coerenti.
  function activateTab(index: number): void {
    active = index;
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i]!;
      const tab = tablist.children[i] as HTMLElement;
      const on = i === index;
      panel.hidden = !on;
      tab?.setAttribute("aria-selected", String(on));
    }
    const viewId = panels[index]?.dataset.viewId;
    if (viewId) void api.setViewState("inspector.tab", viewId);
  }

  // Il tablist va in cima, prima dei pannelli.
  viewsRightEl.prepend(tablist);

  // Ripristina la scelta persistita, o il default. La persistenza è async
  // — arriva dal backend — e il default è la prima `open_by_default` o la
  // prima in assoluto: la si sceglie ora, e se la persistenza arriva dopo
  // la si applica sovrascrivendo.
  // «Quella che nasce aperta» si legge dal contenuto che non è nascosto: era
  // una classe `collapsed` sul pannello, ed era la stessa cosa scritta due
  // volte (§31.4).
  const defaultIndex = panels.findIndex(
    (p) => !p.querySelector<HTMLElement>(":scope > .declared-view")?.hidden,
  );
  activateTab(defaultIndex >= 0 ? defaultIndex : 0);
  void api.viewState<string>("inspector.tab").then((saved) => {
    if (!saved) return;
    const idx = panels.findIndex((p) => p.dataset.viewId === saved);
    if (idx >= 0 && idx !== active) activateTab(idx);
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
  const staleViews = new Set<string>();
  let scheduled = false;
  onEvent("view_invalidated", (event) => {
    // `instance` assente = tutte le istanze di quella view. Con una sola
    // istanza per view le due cose coincidono, e la distinzione conta il giorno
    // che le istanze saranno N: chi ne ha invecchiata una non deve pagare il
    // ridisegno delle sorelle.
    // Tutti gli esemplari di quella view, che dalla §3.3 possono essere N: uno
    // per sidebar e uno per riquadro che la tiene aperta.
    const matched = [...mounted].filter(
      ([, m]) => m.view === event.view && (event.instance === null || event.instance === m.instance),
    );
    if (matched.length === 0) return;
    for (const [id] of matched) staleViews.add(id);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const from = [...staleViews];
      staleViews.clear();
      for (const id of from) void refreshPanel(id);
    });
  });
}
