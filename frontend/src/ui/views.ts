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
// Il contratto ne nomina dieci (§2.2). Questa shell ne ospita **otto** — le tre
// sidebar/basso di prima, più barra di stato, ribbon, modale, la scheda di
// impostazioni (§11.1) e, dalla §3.3, l'**area principale** — e le altre due le
// dichiara **non ospitate** invece di lasciarle cadere in silenzio. Una view che
// le chiede riceve un avviso che la nomina, e dal §20.4 quell'avviso arriva a
// chi guarda lo schermo invece che a una console che nessuno apre.
//
// # `main` è ospitata, e in un modo diverso da tutte le altre
//
// Le altre sette hanno un contenitore in `index.html`: c'è, è uno, e una view
// che le dichiara ci finisce dentro da sola all'avvio. L'area principale no —
// di riquadri ce ne sono N, si dividono e si chiudono, e un riquadro non è un
// posto che si riempie da solo: è un posto in cui **qualcuno mette qualcosa**.
//
// Quindi una view di `main` non si monta all'avvio. Si dichiara e aspetta, e
// quando un riquadro apre la sua tab è `panels/document.ts` a chiedere che venga
// montata **lì**, con l'esemplare che è l'id del riquadro. È il punto in cui i
// due registri del §1.2 si incontrano, che `ui/panel-host.ts` diceva sarebbe
// arrivato con questa voce e non prima.
import { api } from "../host/ipc";
import { Corsa } from "./corsa";
import type { ActionRef, FieldValue, UiNode, ViewSpec, ViewSurface } from "../host/contract";
import { $ } from "./dom";
import { attivabile, intrappolaFuoco } from "./a11y";
import { applyIntent } from "./intents";
import { mountTree, patchTree, unmountTree } from "./node";
import { onEvent } from "../state/kernel";
import { flushPendingSave } from "../panels/document";
import { refreshPanel, registerPanel, unregisterPanel } from "./panel-host";
import { notify } from "./notify";
import { t } from "../i18n/strings";

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
  corsa: Corsa;
}

/// Le istanze montate, per **id di pannello**: il registro dei pannelli sa
/// **quando** ridisegnarle, questo sa **dove** e **quale**.
///
/// La chiave era l'id della view, ed era la stessa cosa finché di esemplari ce
/// n'era uno per view. Con l'area principale non lo è più — il grafo aperto in
/// due riquadri è un pannello per riquadro — quindi la chiave è quella del
/// pannello, e chi cerca «tutte le istanze di questa view» filtra su `view`.
const montate = new Map<string, Montata>();

/// Le view che dichiarano la superficie principale, per id.
///
/// Non sono montate: sono **disponibili**. Chi apre una tab di view le cerca
/// qui, e il titolo che ne legge è quello che finisce sulla tab.
const principali = new Map<string, ViewSpec>();

/// Le view che un riquadro può ospitare, in ordine di dichiarazione.
export function viewPrincipali(): ViewSpec[] {
  return [...principali.values()];
}

export function viewPrincipale(id: string): ViewSpec | undefined {
  return principali.get(id);
}

/// L'id del pannello di una view montata in un riquadro.
///
/// Composto, e non l'id della view: due riquadri sullo stesso grafo sono due
/// pannelli, che invecchiano e si ridisegnano ognuno per conto suo.
function pannelloDiRiquadro(view: string, pane: string): string {
  return `${view}@${pane}`;
}

/// Monta (o rimonta) una view dichiarata dentro il riquadro `pane`.
///
/// **Idempotente**: chiamarla di nuovo sullo stesso contenitore ridisegna e
/// basta. È ciò che permette a chi disegna i riquadri di chiamarla a ogni giro
/// senza tenere il conto di cosa ha già montato — e ciò che rimette in piedi le
/// view dei riquadri dopo un cambio di vault, quando `mountDeclaredViews`
/// azzera tutto.
export async function montaVistaInRiquadro(
  view: string,
  pane: string,
  container: HTMLElement,
): Promise<void> {
  const spec = principali.get(view);
  if (!spec) return;
  const id = pannelloDiRiquadro(view, pane);
  const gia = montate.get(id);
  if (!gia || gia.container !== container) {
    if (gia) unmountTree(gia.container);
    // L'esemplare **è il riquadro**: è la stessa identità che il `ViewContext`
    // porta di là dal confine (`pane`), quindi lo stato di vista di una view
    // aperta in due riquadri si separa esattamente dove l'utente vede due cose.
    montate.set(id, { view, container, instance: pane, params: null, corsa: new Corsa() });
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
export function smontaVistaDalRiquadro(view: string, pane: string): void {
  const id = pannelloDiRiquadro(view, pane);
  const montata = montate.get(id);
  if (!montata) return;
  unregisterPanel(id);
  unmountTree(montata.container);
  montate.delete(id);
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
    // `viewPrincipali` più sotto — `null` qui significa «non all'avvio», non
    // «non si può».
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
  menu: "questa shell non ha un menu applicativo",
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
const corsaDelMontaggio = new Corsa();

export async function mountDeclaredViews(): Promise<void> {
  // **Si chiede prima, si smonta dopo**, ed è il difetto 0088: l'ordine di
  // prima buttava giù tutto — pannelli, alberi, le due mappe, i sette
  // contenitori, il nome della superficie modale — e *poi* chiedeva l'elenco.
  // Se la domanda falliva, e basta un vault che si apre male o un kernel che si
  // sta riavviando, non c'era nessun `catch` da nessuna parte: la shell restava
  // vuota, `viewPrincipali()` tornava una lista vuota, e quindi nemmeno un
  // riquadro poteva più riaprire una view principale. Nessuna concorrenza,
  // nessun token: un solo rigetto, e non c'era niente da cui tornare indietro.
  //
  // Chiedere prima toglie il caso alla radice invece di ripararlo: se la
  // domanda non risponde, ciò che c'è sullo schermo è vecchio ma **vivo**, che
  // è la peggiore delle due cose che si possono avere e la migliore delle due
  // che si possono scegliere.
  const specs = await corsaDelMontaggio.ultimo(async (atteso) => await atteso(api.listViews()));
  // Il giro è scaduto: un rimontaggio più nuovo sta già lavorando, e questo non
  // deve smontare ciò che quello ha montato.
  if (!specs) return;

  for (const [id, montata] of montate) {
    unregisterPanel(id);
    unmountTree(montata.container);
  }
  montate.clear();
  principali.clear();
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

  // L'ordine fra le view di una stessa superficie lo dichiara la view (§2.6);
  // i pari merito restano nell'ordine di registrazione, che è ciò che
  // `sort` stabile garantisce.
  for (const spec of [...specs].sort((a, b) => a.order - b.order)) {
    // L'area principale si dichiara e aspetta un riquadro: non è un avviso, è
    // il suo modo di essere ospitata.
    if (spec.surface === "main") {
      principali.set(spec.id, spec);
      continue;
    }
    const host = surfaceContainer(spec.surface);
    if (!host) {
      notify(
        t("views.surface_missing", {
          view: spec.id,
          surface: spec.surface,
          motivo: NON_OSPITATE[spec.surface] ?? "superficie sconosciuta",
        }),
        "info",
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
  montate.set(spec.id, {
    view: spec.id,
    container,
    instance: spec.id,
    params: null,
    corsa: new Corsa(),
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
  const montata = montate.get(id);
  if (!montata) return;
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
  await montata.corsa.ultimo(async (atteso) => {
    const albero = await atteso(api.renderView(montata.view, montata.instance, montata.params));
    disegna(id, montata, albero);
  });
}

/// Disegna un albero nel contenitore della sua istanza e chiude il giro
/// azione→`ViewUpdate`: un click torna al provider via `view_action` con le sue
/// due metà, e la risposta si interpreta qui.
function disegna(id: string, montata: Montata, albero: UiNode): void {
  mountTree(montata.container, albero, async (action: ActionRef, fields: FieldValue[]) => {
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
    const update = await api.viewAction(
      // La view, non il pannello: vedi la nota su `renderDeclaredView`.
      montata.view,
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
    // Tutti gli esemplari di quella view, che dalla §3.3 possono essere N: uno
    // per sidebar e uno per riquadro che la tiene aperta.
    const colpiti = [...montate].filter(
      ([, m]) => m.view === event.view && (event.instance === null || event.instance === m.instance),
    );
    if (colpiti.length === 0) return;
    for (const [id] of colpiti) invecchiate.add(id);
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
