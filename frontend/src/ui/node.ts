// Renderer del protocollo di UI dichiarativa (`UiNode`) in elementi DOM nativi,
// e il **riconciliatore** che li aggiorna invece di ricostruirli.
//
// È lo stesso percorso che useranno i plugin: il core descrive, il frontend
// disegna con i suoi componenti e il suo tema.
//
// # Perché non basta ridisegnare (§2.8)
//
// Prima della seduta 2 montare una view era `target.innerHTML = ""` più un
// albero nuovo, e con tre pannelli in sola lettura non si notava. Con i nodi di
// input del §2.1 è fatale: un campo di testo perde **focus e contenuto** a ogni
// `IndexUpdated`, cioè a ogni salvataggio — scrivere due lettere di fila
// diventa impossibile. Qui l'albero nuovo si confronta con quello vecchio e si
// aggiorna ciò che è cambiato:
//
// - i figli si accoppiano per **chiave** quando ce l'hanno, per posizione
//   quando non ce l'hanno. È la ragione per cui la chiave è nel contratto e non
//   una convenzione della shell: senza, l'identità di una riga è la sua
//   posizione, e una lista che si riordina si porta dietro focus e selezione
//   sbagliati;
// - un nodo che cambia **specie** si ricostruisce (non c'è niente da salvare);
// - un campo che ha il **focus** non si sovrascrive col valore del provider: chi
//   sta scrivendo ha ragione, e il provider vedrà il valore quando l'azione
//   scatta.
//
// # Chi raccoglie i campi (§2.7)
//
// Quando un'azione scatta, i valori dei campi «in vigore» si leggono dal DOM
// risalendo al form che la contiene (o alla radice della view, fuori da un
// form). Leggerli dal DOM e non da uno stato parallelo è deliberato: lo stato
// parallelo è la seconda verità che diverge appena il riconciliatore tocca un
// nodo, ed è esattamente ciò che questo file esiste per evitare.
//
// # Chi instrada le azioni (0118, e un piano più in su)
//
// Vale la stessa regola, applicata a due altezze: **in un riconciliatore, una
// chiusura non cattura ciò che il riconciliatore aggiorna**. L'azione di un
// nodo sta in `legami` e la si legge quando l'evento scatta; l'handler di tutto
// l'albero sta in `Montaggio.corrente` e ci si arriva attraverso la `Porta`.
// Fuori da `mountTree` un `ActionHandler` non passa: dentro gira solo la porta,
// che per un contenitore è una sola per sempre.
import type { ActionRef, FieldValue, UiKind, UiNode, UiOption, UiValue } from "../host/contract";
import { customRenderer } from "./custom";
import { setSanitizedHtml } from "./sanitize";
import { attivabile, identificatore, nonAttivabile } from "./a11y";
import { t } from "../i18n/strings";
import { errorText } from "../host/errors";
import { notify } from "./notify";

/// Cosa fa la shell quando un'azione scatta: la manda al provider con le due
/// metà — il payload che il provider aveva attaccato al nodo, e i campi che
/// l'utente ha compilato.
export type ActionHandler = (action: ActionRef, fields: FieldValue[]) => void | Promise<void>;

declare const PORTA: unique symbol;

/// **La porta di un albero montato**: ciò che gira dentro questo file al posto
/// di un `ActionHandler`.
///
/// È un handler marchiato, e il marchio è il presidio. Un `ActionHandler` nudo
/// entra da `mountTree` e non va oltre: tutto il resto — il disegno, la
/// riconciliazione, gli ascoltatori, i renderer custom — riceve una `Porta`, che
/// per un contenitore è **una sola per sempre** e a ogni chiamata inoltra
/// all'handler dell'ultimo montaggio. Chi la cattura in una chiusura cattura un
/// rinvio, non una destinazione, e non può invecchiare.
///
/// La sola fabbrica è `instrada`. Un `ActionHandler` passato a una di queste
/// funzioni **non compila**: è la stessa forma con cui la
/// [0118](../../../docs/decisions/0118-una-chiusura-non-cattura-cio-che-il-riconciliatore-aggiorna.md)
/// ha tolto a `invia` la facoltà di ricevere un `ActionRef`, un piano più in su.
export type Porta = ActionHandler & { readonly [PORTA]: true };

/// Ciò che la shell ricorda di un elemento che ha disegnato: il nodo da cui
/// viene (per il confronto al giro dopo) e, se è un campo, come si legge il suo
/// valore adesso.
interface Reso {
  node: UiNode;
  leggi?: () => UiValue;
}

const resi = new WeakMap<HTMLElement, Reso>();

/// Ciò che un contenitore ricorda fra un montaggio e l'altro: l'albero (per il
/// confronto) e **chi instrada le sue azioni adesso**.
interface Montaggio {
  radice: HTMLElement | null;
  /// L'handler dell'ultimo montaggio. Cambia; nessuno lo tiene.
  corrente: ActionHandler;
  /// Il rinvio a `corrente`. Non cambia mai identità: è ciò che tutti tengono.
  porta: Porta;
}

const montati = new WeakMap<HTMLElement, Montaggio>();

/// Dichiara chi instrada le azioni di questo contenitore **da adesso**.
///
/// È l'unico posto in cui un `ActionHandler` entra nel renderer, e l'unico in
/// cui una `Porta` nasce. Un rimontaggio non rifà la porta: aggiorna ciò a cui
/// rinvia, e con una riga sola raggiunge ogni chiusura che l'aveva già presa —
/// un ascoltatore di campo, la linguetta di una scheda, il canvas di un
/// renderer custom che è sopravvissuto alla riconciliazione.
function instrada(container: HTMLElement, onAction: ActionHandler): Montaggio {
  const gia = montati.get(container);
  if (gia) {
    gia.corrente = onAction;
    return gia;
  }
  const montaggio: Montaggio = {
    radice: null,
    corrente: onAction,
    porta: ((action, fields) => guasto(action, () => montaggio.corrente(action, fields))) as Porta,
  };
  montati.set(container, montaggio);
  return montaggio;
}

/// **Un'azione che va storta lo dice**, e lo dice qui.
///
/// Il difetto misurato nominava `viewAction` in `ui/views.ts`, cioè il posto in
/// cui si *vede*: un `throw` da lì lasciava la vista com'era, uguale a un click
/// che non aveva fatto niente, e la promessa finiva rifiutata senza che nessuno
/// la guardasse. Ma quello è il **testimone**, non l'autore: il ripiego di
/// `patch`, l'`applyIntent` di un `ViewUpdate` che naviga, la `flushPendingSave`
/// che esce prima e il prossimo `mountTree` che qualcuno scriverà passano tutti
/// **da qui**, perché la `Porta` è l'unica strada che un'azione ha per uscire da
/// un albero montato. Una regola che vale per tutti i chiamanti si scrive nel
/// posto che tutti attraversano: il secondo chiamante non deve ricordarsi di
/// niente, e non può dimenticarsene.
///
/// La porta **non è una seconda superficie d'errore**: il canale è il centro
/// notifiche di `ui/notify.ts` (§20.4, decisione 0080), lo stesso da cui passano
/// `refreshPanel` e la palette, e la frase la compone `errorText` come ovunque.
/// Ciò che si aggiunge è quale azione, perché «qualcosa non è andato» senza il
/// nome dell'azione è la metà che non aiuta.
///
/// **La vista resta com'era, ed è giusto così**: il provider non ha risposto,
/// quindi non c'è niente di nuovo da disegnare. Ciò che mancava non era il
/// ridisegno — era dirlo.
function guasto(action: ActionRef, esegui: () => void | Promise<void>): void | Promise<void> {
  const dillo = (e: unknown): void => {
    notify(t("views.action_failed", { action: action.action, reason: errorText(e) }), "guasto");
  };
  // I due modi in cui un handler va storto sono due, e nessuno dei due prende
  // l'altro: un `throw` sincrono non arriva mai a una `.catch`, e una promessa
  // rifiutata non passa da un `try` che è già uscito.
  let esito: void | Promise<void>;
  try {
    esito = esegui();
  } catch (e) {
    dillo(e);
    return;
  }
  return Promise.resolve(esito).catch(dillo);
}

// ---------------------------------------------------------------------------
// Montaggio e riconciliazione
// ---------------------------------------------------------------------------

/// Monta (o aggiorna) l'albero di una view dentro `container`.
///
/// La prima volta disegna; dalla seconda **riconcilia**. Il chiamante non deve
/// sapere quale delle due sta succedendo: è la stessa chiamata, ed è ciò che
/// impedisce che qualcuno "ottimizzi" ricostruendo.
export function mountTree(container: HTMLElement, node: UiNode, onAction: ActionHandler): void {
  const montaggio = instrada(container, onAction);
  const precedente = montaggio.radice;
  if (precedente && precedente.parentElement === container) {
    montaggio.radice = riconcilia(precedente, node, montaggio.porta);
    return;
  }
  for (const figlio of [...container.children]) smonta(figlio);
  container.replaceChildren();
  const el = renderUiNode(node, montaggio.porta);
  container.appendChild(el);
  montaggio.radice = el;
}

/// Rimpiazza il solo nodo con questa chiave (`ViewUpdate::Patch`).
///
/// Torna `false` se la chiave non c'è: **non è un errore** — è una view
/// cambiata sotto — e chi chiama ridisegna intero.
export function patchTree(container: HTMLElement, key: string, node: UiNode): boolean {
  const montaggio = montati.get(container);
  if (!montaggio?.radice) return false;
  const bersaglio = trovaPerChiave(montaggio.radice, key);
  if (!bersaglio) return false;
  // La porta del contenitore, non un handler ripescato dal sottoalbero: un
  // patch arriva senza il contesto del render, e ciò che risale dall'elemento è
  // **il primo** montaggio, non l'ultimo. Riconciliare con quello riscriverebbe
  // i legami del sottoalbero patchato con l'handler di ieri — cioè disferebbe
  // la 0118 proprio dove nessuno guarda.
  const aggiornato = riconcilia(bersaglio, node, montaggio.porta);
  if (bersaglio === montaggio.radice) montaggio.radice = aggiornato;
  return true;
}

/// Dimentica ciò che è montato qui: il prossimo giro ridisegna da zero.
///
/// La **porta** invece resta, ed è deliberato: è l'identità che dura quanto il
/// contenitore, e rifarla lascerebbe in giro rinvii che non inoltrano più a
/// nessuno.
export function unmountTree(container: HTMLElement): void {
  const montaggio = montati.get(container);
  if (montaggio) montaggio.radice = null;
  for (const figlio of [...container.children]) smonta(figlio);
  container.replaceChildren();
}

/// Come si smonta ciò che un renderer custom ha acceso su un elemento.
///
/// Serve perché un renderer può possedere qualcosa che il DOM non raccoglie da
/// sé — un ciclo di animazione, un timer, un `ResizeObserver` — e togliere
/// l'elemento non lo spegne. Nessun altro nodo ne ha bisogno: quelli sono
/// elementi e basta.
const disposizioni = new WeakMap<HTMLElement, () => void>();

/// Spegne ciò che sta per essere tolto: `el` e tutto quello che ha sotto.
///
/// Si cammina il sottoalbero e non il solo `el` perché un nodo custom sta quasi
/// sempre **dentro** ciò che viene sostituito — è una foglia dell'albero di una
/// view, e a essere rimpiazzata è la view intera.
function smonta(el: Element): void {
  disposizioni.get(el as HTMLElement)?.();
  disposizioni.delete(el as HTMLElement);
  for (const dentro of el.querySelectorAll<HTMLElement>(".ui-custom")) {
    disposizioni.get(dentro)?.();
    disposizioni.delete(dentro);
  }
}

function trovaPerChiave(radice: HTMLElement, key: string): HTMLElement | null {
  if (resi.get(radice)?.node.key === key) return radice;
  return radice.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
}

/// Aggiorna `el` perché mostri `next`, o lo sostituisce se non è possibile.
/// Restituisce l'elemento che ora rappresenta il nodo (lo stesso, o il nuovo).
function riconcilia(el: HTMLElement, next: UiNode, onAction: Porta): HTMLElement {
  const prev = resi.get(el)?.node;
  if (!prev || prev.node !== next.node) {
    const nuovo = renderUiNode(next, onAction);
    smonta(el);
    el.replaceWith(nuovo);
    return nuovo;
  }
  if (aggiorna(el, prev, next, onAction)) {
    resi.set(el, { ...resi.get(el)!, node: next });
    chiave(el, next);
    return el;
  }
  const nuovo = renderUiNode(next, onAction);
  smonta(el);
  el.replaceWith(nuovo);
  return nuovo;
}

/// Prova ad aggiornare `el` in posto. `false` = ricostruiscilo.
///
/// La divisione non è per comodità: **i campi si aggiornano** perché hanno uno
/// stato dell'utente da non buttare via (focus, cursore, ciò che si sta
/// scrivendo), i **contenitori** si aggiornano perché contengono campi, e le
/// **foglie** si ricostruiscono perché non hanno niente da conservare e il
/// confronto costerebbe più del disegno.
function aggiorna(
  el: HTMLElement,
  prev: UiNode,
  next: UiNode,
  onAction: Porta,
): boolean {
  switch (next.node) {
    case "stack": {
      if (prev.node !== "stack") return false;
      el.style.flexDirection = next.dir === "row" ? "row" : "column";
      el.style.gap = `${next.gap}px`;
      figli(el, next.children, onAction);
      return true;
    }
    case "list":
      if (prev.node !== "list") return false;
      figli(el, next.items, onAction);
      return true;
    case "tree":
      if (prev.node !== "tree") return false;
      figli(el, next.roots, onAction);
      return true;
    case "section": {
      if (prev.node !== "section") return false;
      const dettagli = el as HTMLDetailsElement;
      const titolo = dettagli.querySelector("summary");
      if (titolo) titolo.textContent = next.title;
      // `collapsed` è lo stato INIZIALE: se l'utente ha aperto la sezione, un
      // ridisegno non gliela richiude.
      figli(contenitoreFigli(el), next.children, onAction);
      return true;
    }
    case "tree_item": {
      if (prev.node !== "tree_item") return false;
      const riga = el.querySelector<HTMLElement>(":scope > .ui-tree-label");
      if (riga) {
        riga.textContent = next.label;
        collega(riga, next.action, onAction);
      }
      // Gli stati ARIA seguono il nodo anche quando l'elemento è riusato: una
      // cartella che si apre e resta `aria-expanded="false"` è una cartella
      // che, per chi la legge, non si è aperta.
      if (next.selected) el.setAttribute("aria-selected", "true");
      else el.removeAttribute("aria-selected");
      if (next.children.length > 0) el.setAttribute("aria-expanded", String(next.expanded));
      else el.removeAttribute("aria-expanded");
      figli(contenitoreFigli(el), next.children, onAction);
      return true;
    }
    case "tab":
      if (prev.node !== "tab") return false;
      figli(contenitoreFigli(el), next.children, onAction);
      return true;
    case "tabs": {
      if (prev.node !== "tabs") return false;
      // Quale scheda è aperta è stato della shell: `active` vale alla prima
      // apertura, e un ridisegno non riporta l'utente sulla scheda uno.
      figli(contenitoreFigli(el), next.tabs, onAction);
      intestazioniSchede(el, next.tabs, onAction);
      return true;
    }
    case "form": {
      if (prev.node !== "form") return false;
      figli(contenitoreFigli(el), next.children, onAction);
      const invia = el.querySelector<HTMLButtonElement>(":scope > .ui-submit");
      if (invia) {
        invia.textContent = next.submit_label;
        collega(invia, next.submit, onAction);
      }
      return true;
    }
    case "table": {
      if (prev.node !== "table") return false;
      const corpo = contenitoreFigli(el);
      figli(corpo, next.rows, onAction);
      return prev.columns.length === next.columns.length;
    }
    case "row":
      if (prev.node !== "row") return false;
      figli(el, next.cells, onAction);
      collega(el, next.action, onAction);
      return true;
    case "custom": {
      if (prev.node !== "custom" || prev.ns !== next.ns) return false;
      // **Un `ns` che questa shell conosce non si riconcilia: o è lo stesso
      // dato, o si rifà.** Dentro quell'elemento c'è un widget che il
      // riconciliatore non ha disegnato e non sa leggere — un canvas, e domani
      // una mappa o una tabella virtualizzata — quindi l'unica cosa onesta che
      // possa dire di lui è se il `payload` è cambiato. Se non lo è, lo lascia
      // in pace: è ciò che tiene in vita una simulazione mentre il resto della
      // view si ridisegna intorno.
      if (customRenderer(next.ns)) {
        return JSON.stringify(prev.payload) === JSON.stringify(next.payload);
      }
      figli(el, next.fallback, onAction);
      return true;
    }
    // **I campi non hanno un elenco da riallineare qui.** Ce l'avevano — il
    // valore, l'azione, il testo di un'etichetta che c'era già — ed era per
    // costruzione un *secondo* elenco accanto a quello che scrive il disegno:
    // due elenchi che nessuno confronta divergono, e divergevano su nove voci
    // (segnaposto, righe, estremi, `multiple`, le opzioni, il nome del campo,
    // l'etichetta che compare o sparisce, e il lettore del valore). Adesso
    // l'elenco è uno solo, e lo scrive `applicaCampo` in tutte e due le vite
    // del campo.
    case "text_input":
    case "text_area":
    case "date_picker":
    case "number":
    case "slider":
    case "checkbox":
    case "select":
    case "radio":
      return applicaCampo(el, next, onAction);
    // Le foglie: niente da conservare, il disegno costa meno del confronto.
    default:
      return false;
  }
}

/// Il contenitore dei figli di un nodo composito (quelli che hanno anche una
/// testata: sezione, scheda, form, tabella, voce d'albero).
function contenitoreFigli(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>(":scope > .ui-children") ?? el;
}

/// Cosa fare di un figlio nuovo: riusare quello che c'era (a quale posto) o
/// disegnarlo da capo.
export type Accoppiamento = { riusa: number } | { crea: true };

/// Accoppia i figli vecchi con i nuovi — **per chiave**, dove c'è.
///
/// È il cuore del §2.8, ed è una funzione pura apposta: la regola si prova
/// senza un DOM, e ciò che qui può essere sbagliato non è il disegno ma la
/// decisione. Le due righe che contano:
///
/// - un nodo **con chiave** riusa il vecchio di quella chiave, **ovunque
///   fosse**. È ciò che rende un riordino uno spostamento invece di un
///   rimescolamento di contenuti — senza, la riga 1 riceve i dati della riga 2,
///   e con essi il focus e la selezione di qualcun altro;
/// - un nodo **senza chiave** riusa il prossimo vecchio senza chiave, in
///   ordine. È il comportamento di prima della seduta, ed è giusto per ciò che
///   non si riordina: una testata, un separatore, un segnaposto.
///
/// Una chiave che compare due volte fra i fratelli è un albero malformato: la
/// prima occorrenza riusa, la seconda disegna. Non è un errore che si alza —
/// una view che sbaglia le chiavi deve restare disegnabile — ma non è nemmeno
/// silenzioso a valle: perde lo stato a ogni giro, che è il sintomo giusto.
export function accoppia(
  precedenti: readonly (string | undefined)[],
  nuovi: readonly (string | undefined)[],
): Accoppiamento[] {
  const perChiave = new Map<string, number>();
  const senzaChiave: number[] = [];
  precedenti.forEach((k, i) => {
    if (k === undefined) senzaChiave.push(i);
    else if (!perChiave.has(k)) perChiave.set(k, i);
  });

  const usati = new Set<number>();
  let prossimoSenzaChiave = 0;
  return nuovi.map((k) => {
    let candidato: number | undefined;
    if (k !== undefined) {
      candidato = perChiave.get(k);
    } else {
      candidato = senzaChiave[prossimoSenzaChiave++];
    }
    if (candidato === undefined || usati.has(candidato)) return { crea: true };
    usati.add(candidato);
    return { riusa: candidato };
  });
}

/// Applica l'accoppiamento al DOM: riconcilia ciò che si riusa, disegna il
/// resto, toglie ciò che non serve più e **sposta** invece di ricreare.
function figli(parent: HTMLElement, nodi: UiNode[], onAction: Porta): void {
  const esistenti = Array.from(parent.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && resi.has(c),
  );
  const piano = accoppia(
    esistenti.map((el) => resi.get(el)!.node.key),
    nodi.map((n) => n.key),
  );

  const usati = new Set<HTMLElement>();
  const finali = nodi.map((nodo, i) => {
    const scelta = piano[i]!;
    if ("riusa" in scelta) {
      const el = esistenti[scelta.riusa]!;
      usati.add(el);
      return riconcilia(el, nodo, onAction);
    }
    return renderUiNode(nodo, onAction);
  });

  for (const el of esistenti) {
    if (!usati.has(el)) {
      smonta(el);
      el.remove();
    }
  }
  // Rimettere in ordine: `insertBefore` di un nodo già figlio lo SPOSTA, e
  // spostarlo conserva focus, scroll e stato — che è tutto il punto.
  let riferimento: ChildNode | null = null;
  for (let i = finali.length - 1; i >= 0; i--) {
    const el = finali[i]!;
    if (el.nextSibling !== riferimento || el.parentElement !== parent) {
      parent.insertBefore(el, riferimento);
    }
    riferimento = el;
  }
}

// ---------------------------------------------------------------------------
// Disegno
// ---------------------------------------------------------------------------

function renderUiNode(node: UiNode, onAction: Porta): HTMLElement {
  const el = disegna(node, onAction);
  resi.set(el, { ...(resi.get(el) ?? {}), node });
  chiave(el, node);
  return el;
}

function chiave(el: HTMLElement, node: UiNode): void {
  if (node.key !== undefined) el.dataset.key = node.key;
  else delete el.dataset.key;
}

function disegna(node: UiNode, onAction: Porta): HTMLElement {
  switch (node.node) {
    case "stack": {
      const el = div("ui-stack");
      el.style.display = "flex";
      el.style.flexDirection = node.dir === "row" ? "row" : "column";
      el.style.gap = `${node.gap}px`;
      for (const child of node.children) el.appendChild(renderUiNode(child, onAction));
      return el;
    }
    case "text": {
      const el = div("ui-text");
      el.textContent = node.content;
      return el;
    }
    case "heading": {
      const el = document.createElement(`h${Math.min(Math.max(node.level, 1), 6)}`);
      el.className = "ui-heading";
      el.textContent = node.content;
      return el;
    }
    case "list": {
      const el = div("ui-list");
      // Un `div` pieno di `div` non è una lista per nessuno tranne che per chi
      // la guarda: il ruolo è ciò che permette a un lettore di schermo di dire
      // «lista, sei elementi» e di saltarla, invece di leggerla tutta.
      el.setAttribute("role", "list");
      for (const item of node.items) el.appendChild(renderUiNode(item, onAction));
      return el;
    }
    case "list_item": {
      const el = div("ui-list-item");
      el.setAttribute("role", "listitem");
      // `selected` è uno stato del nodo (§2.1), e va detto anche a chi non
      // vede lo sfondo cambiato. `aria-current` e non `aria-selected`: il
      // secondo vale dentro un widget di selezione (una listbox), e questa è
      // una lista — dichiarare uno stato in un contesto che non lo prevede è
      // il modo di farlo ignorare in silenzio.
      if (node.selected) el.setAttribute("aria-current", "true");
      else el.removeAttribute("aria-current");
      collega(el, node.action, onAction);
      const title = div("ui-list-item-title");
      title.textContent = node.title;
      el.appendChild(title);
      if (node.subtitle) {
        const sub = div("ui-list-item-subtitle");
        sub.textContent = node.subtitle;
        el.appendChild(sub);
      }
      return el;
    }
    case "button": {
      const el = document.createElement("button");
      el.className = `ui-button intent-${node.intent}`;
      el.textContent = node.label;
      collega(el, node.action, onAction);
      return el;
    }
    case "html": {
      const el = div("ui-html");
      // Riservato al codice fidato: il kernel rifiuta questa variante da un
      // provider non fidato (`UiNode::validate_untrusted`), in un punto solo.
      //
      // E passa comunque dal sanitizer (§3.6): i due presidi rispondono a due
      // domande diverse — il kernel dice *chi* può mandare markup, questo dice
      // *quale* markup entra nella webview. Il codice fidato non è codice
      // infallibile, e la fonte di un frammento «già escapato lato Rust» può
      // essere un embed o un tema.
      setSanitizedHtml(el, node.html);
      return el;
    }
    case "web_view": {
      const el = document.createElement("iframe");
      el.className = "ui-webview";
      el.src = node.url;
      el.style.height = `${node.height}px`;
      el.setAttribute("sandbox", "allow-scripts");
      // Un `<iframe>` senza `title` è, per chi lo incontra navigando, «frame»
      // e basta — e non c'è modo di sapere se valga la pena entrarci. Il
      // contratto non porta un titolo per questo nodo, quindi il meglio che si
      // possa dire è l'indirizzo: è poco, ed è comunque l'unica cosa vera che
      // la shell sappia. Un titolo vero è roba del contratto, non di qui.
      el.title = node.url;
      return el;
    }
    case "section": {
      const el = document.createElement("details");
      el.className = "ui-section";
      el.open = !node.collapsed;
      const summary = document.createElement("summary");
      summary.textContent = node.title;
      el.appendChild(summary);
      const corpo = div("ui-children");
      for (const child of node.children) corpo.appendChild(renderUiNode(child, onAction));
      el.appendChild(corpo);
      return el;
    }
    case "table": {
      const el = document.createElement("table");
      el.className = "ui-table";
      const head = document.createElement("thead");
      const hr = document.createElement("tr");
      for (const col of node.columns) {
        const th = document.createElement("th");
        th.textContent = col.title;
        th.style.textAlign = col.align === "start" ? "left" : col.align === "end" ? "right" : "center";
        hr.appendChild(th);
      }
      head.appendChild(hr);
      el.appendChild(head);
      const body = document.createElement("tbody");
      body.className = "ui-children";
      for (const row of node.rows) body.appendChild(renderUiNode(row, onAction));
      el.appendChild(body);
      return el;
    }
    case "row": {
      const el = document.createElement("tr");
      el.className = "ui-row";
      collega(el, node.action, onAction);
      for (const cell of node.cells) {
        const td = document.createElement("td");
        td.appendChild(renderUiNode(cell, onAction));
        el.appendChild(td);
      }
      return el;
    }
    case "tree": {
      const el = div("ui-tree");
      el.setAttribute("role", "tree");
      for (const root of node.roots) el.appendChild(renderUiNode(root, onAction));
      return el;
    }
    case "tree_item": {
      const el = div("ui-tree-item");
      const riga = div("ui-tree-label");
      riga.textContent = node.label;
      collega(riga, node.action, onAction);
      // Il ruolo sta sul **contenitore** e non sull'etichetta, perché è il
      // contenitore ad avere i figli: un `treeitem` che non contiene il proprio
      // gruppo è un albero piatto per chi lo legge. Il nome però viene
      // dall'etichetta e non dal contenitore, o sarebbe l'etichetta *più tutto
      // il sottoalbero* — che su una cartella con cento note è un nome lungo
      // cento note.
      const idEtichetta = identificatore("albero");
      riga.id = idEtichetta;
      el.setAttribute("role", "treeitem");
      el.setAttribute("aria-labelledby", idEtichetta);
      if (node.selected) el.setAttribute("aria-selected", "true");
      el.appendChild(riga);
      const figli = div("ui-children");
      figli.hidden = !node.expanded;
      // `aria-expanded` solo su chi ha davvero dei figli: dichiararlo su una
      // foglia annuncia «compresso» a chi non ha niente da espandere.
      if (node.children.length > 0) {
        el.setAttribute("aria-expanded", String(node.expanded));
        figli.setAttribute("role", "group");
      }
      for (const child of node.children) figli.appendChild(renderUiNode(child, onAction));
      el.appendChild(figli);
      return el;
    }
    case "tabs": {
      const el = div("ui-tabs");
      const barra = div("ui-tab-bar");
      el.appendChild(barra);
      const corpo = div("ui-children");
      for (const tab of node.tabs) corpo.appendChild(renderUiNode(tab, onAction));
      el.appendChild(corpo);
      mostraScheda(el, Math.min(node.active, Math.max(node.tabs.length - 1, 0)));
      intestazioniSchede(el, node.tabs, onAction);
      return el;
    }
    case "tab": {
      const el = div("ui-tab");
      // Il pannello di una scheda. L'`aria-labelledby` che lo lega alla sua
      // linguetta lo mette `intestazioniSchede`, perché è là che le linguette
      // nascono e solo là si sa quale appartiene a quale.
      el.setAttribute("role", "tabpanel");
      el.id = identificatore("scheda");
      const corpo = div("ui-children");
      for (const child of node.children) corpo.appendChild(renderUiNode(child, onAction));
      el.appendChild(corpo);
      return el;
    }
    case "badge": {
      const el = document.createElement("span");
      el.className = `ui-badge intent-${node.intent}`;
      el.textContent = node.label;
      return el;
    }
    case "icon": {
      // Un nome che questa shell non conosce non disegna niente: un'icona
      // mancante non deve rompere un pannello.
      const el = document.createElement("span");
      el.className = "ui-icon";
      el.dataset.icon = node.name;
      el.title = node.name;
      return el;
    }
    case "progress": {
      const el = div("ui-progress");
      const barra = document.createElement("progress");
      if (node.value !== null) {
        barra.max = 1;
        barra.value = node.value;
      }
      el.appendChild(barra);
      if (node.label) {
        const testo = div("ui-progress-label");
        testo.textContent = node.label;
        // La `<progress>` prende il nome dall'etichetta che le sta accanto.
        // Senza, un lettore di schermo annuncia «barra di avanzamento, 40%» —
        // e il 40% *di cosa* è precisamente l'informazione che serve.
        const id = identificatore("avanzamento");
        testo.id = id;
        barra.setAttribute("aria-labelledby", id);
        el.appendChild(testo);
      }
      return el;
    }
    case "separator":
      return document.createElement("hr");
    case "empty_state": {
      const el = div("ui-empty-state");
      const titolo = div("ui-empty-title");
      titolo.textContent = node.title;
      el.appendChild(titolo);
      if (node.detail) {
        const dettaglio = div("ui-empty-detail");
        dettaglio.textContent = node.detail;
        el.appendChild(dettaglio);
      }
      if (node.action) {
        const bottone = document.createElement("button");
        bottone.className = "ui-button intent-primary";
        bottone.textContent = node.detail ?? node.title;
        collega(bottone, node.action, onAction);
        el.appendChild(bottone);
      }
      return el;
    }
    case "key_value": {
      const el = document.createElement("dl");
      el.className = "ui-key-value";
      for (const entry of node.entries) {
        const dt = document.createElement("dt");
        dt.textContent = entry.label;
        const dd = document.createElement("dd");
        dd.textContent = entry.value;
        el.append(dt, dd);
      }
      return el;
    }
    // Un campo si disegna come si riconcilia: lo scheletro, e poi lo stesso
    // `applicaCampo` che gli riscriverà addosso ogni nodo successivo.
    case "text_input":
    case "date_picker":
    case "text_area":
    case "number":
    case "slider":
    case "checkbox":
    case "select":
    case "radio": {
      const el = scheletroCampo(node);
      applicaCampo(el, node, onAction);
      return el;
    }
    case "form": {
      const el = document.createElement("form");
      el.className = "ui-form";
      const corpo = div("ui-children");
      for (const child of node.children) corpo.appendChild(renderUiNode(child, onAction));
      el.appendChild(corpo);
      const invia = document.createElement("button");
      invia.type = "submit";
      invia.className = "ui-button ui-submit intent-primary";
      invia.textContent = node.submit_label;
      collega(invia, node.submit, onAction);
      el.appendChild(invia);
      // Un form nella pagina naviga, se qualcuno lo lascia fare.
      el.addEventListener("submit", (e) => e.preventDefault());
      return el;
    }
    case "custom": {
      // **Il ramo che aspettava il suo primo cliente**, e il cliente è
      // arrivato: dalla §3.3 il grafo è un `ViewProvider` che manda i suoi nodi
      // e i suoi archi dentro un `Custom`, e questa shell sa disegnarlo.
      //
      // Quali `ns` conosca non è scritto qui: sta in `ui/custom.ts`, e chi ne
      // registra uno non tocca questo file. Un `ns` sconosciuto continua a
      // ricevere il **fallback**, che è ciò che il contratto chiede a chi non
      // lo conosce — ed è la condizione normale per un plugin di terzi fino a
      // M5, non un caso d'errore.
      const el = div("ui-custom");
      el.dataset.ns = node.ns;
      const disegna = customRenderer(node.ns);
      if (disegna) {
        // Lo smontaggio torna dal renderer e si mette da parte: un canvas con
        // un `requestAnimationFrame` in volo su un elemento che nessuno guarda
        // più è un ciclo che continua a girare per sempre, e a saperlo è solo
        // chi lo ha acceso.
        // Quello che il renderer riceve è la **porta**, e conta perché lui è
        // l'unico a cui il riconciliatore non ridà niente: se il payload non
        // cambia, l'elemento resta e il widget dentro pure, per quanti
        // ridisegni faccia la view intorno. Un handler nudo qui invecchierebbe
        // e ci resterebbe.
        const smonta = disegna(el, node.payload, onAction);
        if (smonta) disposizioni.set(el, smonta);
      } else {
        for (const child of node.fallback) el.appendChild(renderUiNode(child, onAction));
      }
      return el;
    }
    case "pending": {
      const el = div("ui-pending");
      // I due stati del §2.5 sono le uniche cose che compaiono **da sole**,
      // dopo che l'utente ha smesso di guardare: chi non vede lo schermo non
      // ha modo di accorgersene se nessuno glielo dice. `status` e non
      // `alert`: «sto caricando» non interrompe ciò che si sta leggendo.
      el.setAttribute("role", "status");
      el.textContent = node.label ?? "…";
      return el;
    }
    case "failed": {
      const el = div("ui-failed");
      // Qui invece sì: un guasto è la cosa che va detta subito, o l'utente
      // resta ad aspettare un pannello che ha già smesso di provarci.
      el.setAttribute("role", "alert");
      const messaggio = div("ui-failed-message");
      messaggio.textContent = node.message;
      el.appendChild(messaggio);
      if (node.retry) {
        const bottone = document.createElement("button");
        bottone.className = "ui-button";
        bottone.textContent = t("app.retry");
        collega(bottone, node.retry, onAction);
        el.appendChild(bottone);
      }
      return el;
    }
  }
}

// ---------------------------------------------------------------------------
// Pezzi comuni
// ---------------------------------------------------------------------------

function div(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

// ---------------------------------------------------------------------------
// I campi (§2.1)
// ---------------------------------------------------------------------------
//
// **Un campo ha un elenco solo di attributi, e lo attraversano tutte e due le
// sue vite.** Prima ne aveva due — quello che il disegno scriveva e quello che
// la riconciliazione riscriveva — e due elenchi che nessuno confronta
// divergono: divergevano su nove voci, e ogni voce era un campo riusato che
// mostrava o mandava la forma di ieri funzionando. È la stessa regola della
// [0118](../../../docs/decisions/0118-una-chiusura-non-cattura-cio-che-il-riconciliatore-aggiorna.md)
// spostata dagli ascoltatori agli attributi: chi ne aggiunge uno lo scrive qui
// dentro e ce l'ha in tutte e due le vite senza saperlo.

/// I nodi che sono un **campo**: portano un `field`, un valore che l'utente
/// cambia, un'etichetta e un'azione.
type Campo = Extract<UiKind, { field: string }>;

/// Lo scheletro di un campo: gli elementi che vivono quanto il campo.
///
/// Non scrive **niente** che venga dal nodo se non la sua specie — che è
/// l'unica cosa che il riconciliatore non può cambiare senza ricostruire.
function scheletroCampo(node: Campo): HTMLElement {
  switch (node.node) {
    case "text_input":
    case "date_picker": {
      const el = div(node.node === "date_picker" ? "ui-date-picker" : "ui-text-input");
      el.appendChild(document.createElement("input"));
      return el;
    }
    case "text_area": {
      const el = div("ui-text-area");
      el.appendChild(document.createElement("textarea"));
      return el;
    }
    case "number":
    case "slider": {
      const el = div(node.node === "slider" ? "ui-slider" : "ui-number");
      el.appendChild(document.createElement("input"));
      return el;
    }
    case "checkbox": {
      // Il contenitore **è** la `<label>`: la spunta la nomina l'avvolgimento,
      // che vale quanto un `for` e non ha bisogno di un id.
      const el = document.createElement("label");
      el.className = "ui-checkbox";
      const input = document.createElement("input");
      input.type = "checkbox";
      const testo = document.createElement("span");
      testo.className = "ui-field-label";
      el.append(input, testo);
      return el;
    }
    case "select": {
      const el = div("ui-select");
      el.appendChild(document.createElement("select"));
      return el;
    }
    case "radio":
      return div("ui-radio");
  }
}

/// **Tutto ciò che di un campo dipende dal nodo, in un posto solo.**
///
/// La chiamano il disegno e la riconciliazione con la stessa riga. `false` =
/// lo scheletro non è quello di questa specie, cioè ricostruiscilo.
function applicaCampo(el: HTMLElement, node: Campo, onAction: Porta): boolean {
  switch (node.node) {
    case "text_input":
    case "date_picker": {
      const input = el.querySelector("input");
      if (!input) return false;
      input.type = node.node === "date_picker" ? "date" : "text";
      attributo(input, "placeholder", node.node === "text_input" ? node.placeholder : null);
      scriviValore(input, node.value ?? "");
      valore(el, () => ({ type: "text", value: input.value }));
      azioniDelCampo(input, node.action, onAction);
      break;
    }
    case "text_area": {
      const area = el.querySelector("textarea");
      if (!area) return false;
      area.rows = node.rows;
      scriviValore(area, node.value);
      valore(el, () => ({ type: "text", value: area.value }));
      azioniDelCampo(area, node.action, onAction);
      break;
    }
    case "number":
    case "slider": {
      const input = el.querySelector("input");
      if (!input) return false;
      input.type = node.node === "slider" ? "range" : "number";
      // Gli estremi **prima** del valore: un `range` con i suoi limiti ancora
      // da scrivere ritaglia il valore che gli si dà, e il ritaglio non si
      // disfa quando i limiti arrivano.
      attributo(input, "min", node.min === null ? null : String(node.min));
      attributo(input, "max", node.max === null ? null : String(node.max));
      attributo(input, "step", node.step === null ? null : String(node.step));
      scriviValore(input, node.value === null ? "" : String(node.value));
      valore(el, () => ({ type: "number", value: Number(input.value) }));
      azioniDelCampo(input, node.action, onAction);
      break;
    }
    case "checkbox": {
      const input = el.querySelector("input");
      if (!input) return false;
      if (document.activeElement !== input) input.checked = node.value;
      valore(el, () => ({ type: "bool", value: input.checked }));
      azioniDelCampo(input, node.action, onAction);
      break;
    }
    case "select": {
      const select = el.querySelector("select");
      if (!select) return false;
      select.multiple = node.multiple;
      opzioni(select, node.options, node.value);
      valore(el, () => {
        const scelte = Array.from(select.selectedOptions).map((o) => o.value);
        // `multiple` si legge **dal DOM**, non dal nodo di questo giro: quel
        // nodo è vecchio al giro dopo, e un select diventato multiplo
        // continuerebbe a riportare un `text` — la 0118 applicata al valore.
        return select.multiple
          ? { type: "choices", value: scelte }
          : { type: "text", value: scelte[0] ?? "" };
      });
      azioniDelCampo(select, node.action, onAction);
      break;
    }
    case "radio": {
      bottoniRadio(el, node, onAction);
      // Il valore di un gruppo di radio è ciò che è spuntato adesso, e basta:
      // niente variabile catturata a fare da memoria: sarebbe la «seconda
      // verità» che la testata di questo file esiste per non avere.
      valore(el, () => ({
        type: "text",
        value: el.querySelector<HTMLInputElement>("input[type=radio]:checked")?.value ?? "",
      }));
      break;
    }
  }
  // Ciò che vale per ogni campo, e in fondo perché il controllo e l'etichetta
  // devono esistere già.
  //
  // Il nome del campo sta **sul contenitore** e in nessun altro posto: c'era
  // anche un `data-field` su ogni controllo, e non lo leggeva nessuno — un
  // secondo posto dove scrivere la stessa cosa è la prima metà di due cose che
  // divergono, che è il difetto di cui questa sezione è la cura.
  el.dataset.campo = node.field;
  etichetta(el, node.label);
  legaEtichetta(el, node.field);
  return true;
}

/// Un attributo che c'è o non c'è: `null` lo toglie.
///
/// La differenza si vede solo al riuso — un campo che perde il segnaposto e se
/// lo tiene scritto sotto suggerisce quello di un altro nodo — ed è la ragione
/// per cui non basta assegnare la proprietà quando c'è.
function attributo(el: HTMLElement, nome: string, valore: string | null): void {
  if (valore === null) el.removeAttribute(nome);
  else el.setAttribute(nome, valore);
}

/// Il valore del provider, senza sovrascrivere chi sta scrivendo.
///
/// Chi ha le dita sul campo ha ragione: il valore nuovo lo vedrà al prossimo
/// giro, quando avrà smesso — e intanto l'azione manda ciò che c'è davvero.
function scriviValore(controllo: HTMLInputElement | HTMLTextAreaElement, v: string): void {
  if (document.activeElement !== controllo && controllo.value !== v) controllo.value = v;
}

/// Le opzioni di un `select`, riconciliate invece che rifatte.
///
/// Un'opzione in più o in meno non ricostruisce il campo: prima lo faceva —
/// `aggiorna` tornava `false` appena l'elenco cambiava — e un `select` che
/// perdeva il fuoco a ogni cambio di opzioni è la stessa cosa che il §2.8
/// esiste per non fare.
function opzioni(select: HTMLSelectElement, options: UiOption[], value: string[]): void {
  while (select.options.length > options.length) select.remove(select.options.length - 1);
  options.forEach((opzione, i) => {
    const opt = select.options[i] ?? select.appendChild(document.createElement("option"));
    opt.value = opzione.value;
    opt.textContent = opzione.label;
  });
  if (document.activeElement === select) return;
  for (const opt of Array.from(select.options)) opt.selected = value.includes(opt.value);
}

/// I bottoni di un gruppo di radio, riconciliati.
///
/// **Il nome del gruppo è l'identità di questo gruppo**, non il nome del campo.
/// Era `radio-${field}`, cioè una stringa sola per tutto il documento: due view
/// che mostrano lo stesso campo — due pannelli, che è la forma normale di una
/// view — erano per il browser un gruppo solo, e scegliere di qua deselezionava
/// di là. Dentro un `<form>` non succedeva, e non per merito di questo codice:
/// il browser scopa già un gruppo al suo form, per specifica.
///
/// Il nome è l'id del contenitore, che è **lo stesso elemento** che porta
/// `role="radiogroup"`: l'esclusività nativa e quella dichiarata sono lo stesso
/// gruppo, o sono due gruppi che dicono due cose diverse allo stesso utente.
function bottoniRadio(el: HTMLElement, node: Campo & { node: "radio" }, onAction: Porta): void {
  if (!el.id) el.id = identificatore("gruppo-radio");
  const righe = Array.from(el.querySelectorAll<HTMLElement>(":scope > .ui-radio-option"));
  for (const riga of righe.slice(node.options.length)) riga.remove();
  node.options.forEach((opzione, i) => {
    const riga = righe[i] ?? nuovaOpzione(el);
    const input = riga.querySelector<HTMLInputElement>("input")!;
    input.name = el.id;
    input.value = opzione.value;
    input.checked = opzione.value === node.value;
    riga.querySelector<HTMLElement>("span")!.textContent = opzione.label;
    azioniDelCampo(input, node.action, onAction);
  });
}

function nuovaOpzione(el: HTMLElement): HTMLElement {
  const riga = document.createElement("label");
  riga.className = "ui-radio-option";
  const input = document.createElement("input");
  input.type = "radio";
  riga.append(input, document.createElement("span"));
  el.appendChild(riga);
  return riga;
}

/// L'etichetta di un campo — **anche quando compare o sparisce**.
///
/// Riallineava solo il testo di un'etichetta che c'era già, e sono i due versi
/// dello stesso difetto: un campo riusato che perdeva l'etichetta se la teneva
/// addosso, e uno che la guadagnava restava anonimo. Non si vedono finché non è
/// lo stesso elemento a fare due nodi diversi.
function etichetta(el: HTMLElement, label: string | null): void {
  const esistente = el.querySelector<HTMLElement>(":scope > .ui-field-label");
  if (label === null) {
    esistente?.remove();
    return;
  }
  if (esistente) {
    esistente.textContent = label;
    return;
  }
  // Un `<div>` accanto a un `<input>` è testo che *sembra* un'etichetta e non
  // lo è per nessuno tranne che per chi guarda: un lettore di schermo su quel
  // campo annuncia «casella di testo», e il nome lo ha letto un attimo prima
  // come frase sciolta, senza modo di collegarlo.
  const testo = document.createElement("label");
  testo.className = "ui-field-label";
  testo.textContent = label;
  el.prepend(testo);
}

/// Lega l'etichetta di un campo al controllo che nomina.
///
/// Passa da qui **ogni** campo del protocollo, che è il motivo per cui sta qui
/// e non in sei posti: è l'ultima cosa che `applicaCampo` fa, quindi è l'unico
/// punto in cui il controllo esiste già e l'etichetta pure.
///
/// I due casi che non lega, e vanno bene entrambi:
///
/// - **Il gruppo di radio.** Non c'è un controllo solo da nominare, ce ne sono
///   N, e ognuno ha già la propria `<label>` che lo avvolge. L'etichetta del
///   gruppo diventa allora una didascalia — che un `for` verso un solo bottone
///   renderebbe peggio, non meglio, perché nominerebbe la prima opzione col
///   nome del gruppo.
/// - **La casella di spunta.** Il suo contenitore *è* la `<label>`, e
///   l'avvolgimento è già un legame — quello implicito, che vale quanto il
///   `for` e non ha bisogno di un id.
///
/// # Quando l'etichetta non c'è affatto
///
/// `label` è `Option<Text>` per cinque campi su sette (`text_area`, `number`,
/// `select`, `slider`, `date_picker`), e chi la lascia vuota non sta chiedendo
/// un campo anonimo: sta dicendo che il contesto attorno lo spiega già. Solo
/// che il contesto lo vede chi guarda lo schermo — chi ascolta sente «casella
/// di testo» e deve compilarla a indovinare. È il difetto che il presidio di
/// questa voce ha trovato per primo.
///
/// Il ripiego è il **nome del campo**, ed è brutto apposta: `tags` non è prosa,
/// è un identificatore, e si nota. È lo stesso gradino ultimo della scala della
/// [decisione 0040](../../../docs/decisions/0040-chi-localizza.md) — «brutto,
/// onesto e soprattutto cercabile» —, per la stessa ragione: un ripiego che
/// inventasse un'etichetta plausibile («Testo») renderebbe un campo senza nome
/// indistinguibile da uno nominato male.
function legaEtichetta(el: HTMLElement, field: string): void {
  // Un gruppo di radio si nomina **in blocco** anche qui: mettere il nome del
  // campo su ogni bottone coprirebbe l'etichetta della singola opzione, che è
  // l'unica cosa buona che quel bottone abbia già.
  const radio = el.querySelector("input[type=radio]") !== null;
  // Per decidere se un nome *esiste* vale ogni `.ui-field-label` — anche lo
  // `<span>` della casella di spunta, che nomina per avvolgimento. Per
  // decidere se **legarlo** vale solo la `<label>`, che è l'unica ad avere un
  // `for`.
  const visibile = el.querySelector<HTMLElement>(":scope > .ui-field-label");
  const controllo = el.querySelector<HTMLElement>("input, textarea, select");
  if (!visibile) {
    // Un'etichetta che se ne va si porta via il proprio legame: un
    // `aria-labelledby` verso un elemento che non c'è più è un nome che nessuno
    // legge, ed è il difetto che `verificaAccessibilita` chiama «riferimento
    // nel vuoto».
    el.removeAttribute("aria-labelledby");
    if (radio) {
      el.setAttribute("role", "radiogroup");
      el.setAttribute("aria-label", field);
      return;
    }
    controllo?.setAttribute("aria-label", field);
    return;
  }

  // E il verso opposto: un campo che *guadagna* un'etichetta non tiene il
  // ripiego, o si ritroverebbe nominato due volte e la seconda col nome brutto.
  el.removeAttribute("aria-label");
  controllo?.removeAttribute("aria-label");
  const etichetta = el.querySelector<HTMLLabelElement>(":scope > label.ui-field-label");
  if (!etichetta || !controllo) return;
  // Il nome va al **gruppo**, che è ciò che `radiogroup` esiste per rendere
  // nominabile.
  if (radio) {
    if (!etichetta.id) etichetta.id = identificatore("gruppo");
    el.setAttribute("role", "radiogroup");
    el.setAttribute("aria-labelledby", etichetta.id);
    return;
  }
  if (etichetta.htmlFor) return;
  if (!controllo.id) controllo.id = identificatore("campo");
  etichetta.htmlFor = controllo.id;
}

/// Registra come si legge il valore di questo campo, adesso.
function valore(el: HTMLElement, leggi: () => UiValue): void {
  resi.set(el, { ...(resi.get(el) ?? { node: { node: "separator" } as UiNode }), leggi });
}

/// Cosa manda un elemento quando un suo evento scatta, **adesso**.
///
/// # Perché una mappa e non una chiusura
///
/// Un ascoltatore registrato una volta sola con l'`ActionRef` catturato dentro
/// la chiusura è giusto finché l'elemento è nuovo, e diventa **silenziosamente
/// sbagliato** il primo giro che il riconciliatore (§2.8) lo riusa: il campo
/// mostra il valore nuovo, ha il focus giusto, e manda l'azione di ieri. Non
/// smette di funzionare — fa la cosa sbagliata funzionando, che è peggio.
///
/// La riparazione non è togliere e rimettere l'ascoltatore a ogni
/// riconciliazione (funziona, e va ripetuta a mano dal prossimo che ne aggiunge
/// uno): è che la chiusura **non abbia niente da invecchiare**. Qui dentro
/// l'ascoltatore cattura solo l'elemento e il nome dell'evento — due cose che
/// non cambiano mai — e legge l'azione da questa mappa quando l'evento scatta.
/// Un ascoltatore nuovo registrato da `ascolta` eredita la proprietà gratis.
interface Legame {
  action: ActionRef;
  onAction: Porta;
}

/// L'azione in vigore per ogni evento di ogni elemento. `null` = l'elemento ha
/// l'ascoltatore ma il nodo che rappresenta adesso non ha azione.
const legami = new WeakMap<HTMLElement, Map<string, Legame | null>>();

/// **L'unica porta da cui si registra un ascoltatore d'azione.**
///
/// Chiamarla due volte sullo stesso elemento e sullo stesso evento non
/// accumula: la seconda aggiorna l'azione e basta. È ciò che rende sicuro
/// richiamarla dal riconciliatore con la stessa disinvoltura con cui la chiama
/// il disegno.
function ascolta(
  el: HTMLElement,
  evento: string,
  action: ActionRef | null,
  onAction: Porta,
  quando?: (e: Event) => boolean,
): void {
  let per = legami.get(el);
  if (!per) {
    per = new Map();
    legami.set(el, per);
  }
  const registrato = per.has(evento);
  per.set(evento, action ? { action, onAction } : null);
  if (registrato) return;
  el.addEventListener(evento, (e) => {
    if (!legami.get(el)?.get(evento)) return;
    if (quando && !quando(e)) return;
    e.preventDefault();
    void invia(el, evento);
  });
}

/// Un'azione su un elemento cliccabile.
function collega(el: HTMLElement, action: ActionRef | null, onAction: Porta): void {
  if (!action) {
    el.classList.remove("clickable");
    // Non basta togliere il click: se questo elemento era attivabile e viene
    // riusato dal riconciliatore (§2.8) per un nodo senza azione, resterebbe
    // nel giro del tab senza fare niente.
    nonAttivabile(el);
  } else {
    el.classList.add("clickable");
    // Cliccabile e attivabile sono la stessa cosa, e da qui in poi lo sono per
    // costruzione: passa di qui **ogni** azione di **ogni** nodo dichiarativo,
    // quindi anche quelli dei pannelli che non sono ancora stati scritti.
    attivabile(el);
  }
  ascolta(el, "click", action, onAction);
}

/// **Tutti** gli ascoltatori d'azione di un campo, in un posto solo.
///
/// La chiamano il disegno e la riconciliazione, con le stesse due righe: chi
/// aggiungerà un terzo ascoltatore a un campo lo scrive qui, e lo ha in
/// entrambe le vite del campo senza ricordarsene.
function azioniDelCampo(
  controllo: HTMLElement,
  action: ActionRef | null,
  onAction: Porta,
): void {
  ascolta(controllo, "change", action, onAction);
  // Invio = «ho finito»: senza, un campo di ricerca costringerebbe a uscirne
  // per essere ascoltato. Solo dove Invio non vuol già dire altro — in un
  // `<textarea>` è un a capo, su una casella di spunta è la spunta.
  if (accettaInvio(controllo)) {
    ascolta(controllo, "keydown", action, onAction, (e) => (e as KeyboardEvent).key === "Enter");
  }
}

function accettaInvio(controllo: HTMLElement): boolean {
  if (!(controllo instanceof HTMLInputElement)) return false;
  return controllo.type === "text" || controllo.type === "date";
}

/// Manda l'azione **in vigore** per questo evento, col suo payload e coi campi
/// in vigore: quelli del form che la contiene, o quelli dell'albero intero
/// fuori da un form.
///
/// Non prende un `ActionRef`, e la mancanza è il presidio: un'azione qui non si
/// può passare, quindi non si può catturare in una chiusura e non può
/// invecchiare. Chi ci riprovasse non compila.
async function invia(da: HTMLElement, evento: string): Promise<void> {
  const legame = legami.get(da)?.get(evento);
  if (!legame) return;
  await legame.onAction(legame.action, campiInVigore(da));
}

export function campiInVigore(da: HTMLElement): FieldValue[] {
  const ambito = da.closest<HTMLElement>(".ui-form") ?? radiceDi(da);
  if (!ambito) return [];
  const trovati = new Map<string, UiValue>();
  const candidati = [ambito, ...Array.from(ambito.querySelectorAll<HTMLElement>("[data-campo]"))];
  for (const el of candidati) {
    const campo = el.dataset.campo;
    const leggi = resi.get(el)?.leggi;
    if (!campo || !leggi) continue;
    // Un campo dichiarato due volte compare una volta sola, con l'ultimo
    // valore: è la regola scritta accanto a `UiAction::fields`.
    trovati.set(campo, leggi());
  }
  return [...trovati].map(([field, value]) => ({ field, value }));
}

/// La radice dell'albero disegnato che contiene `el`.
///
/// Si sale **prima** fino al primo elemento che il renderer ha disegnato, e poi
/// fino alla cima: chi manda un'azione può stare su un pezzo di scocca che
/// questo file ha messo lì senza che sia un nodo — la linguetta di una scheda è
/// il caso —, e partire da lui dava «nessuna radice», cioè nessun campo.
function radiceDi(el: HTMLElement): HTMLElement | null {
  let corrente: HTMLElement | null = el;
  while (corrente && !resi.has(corrente)) corrente = corrente.parentElement;
  let ultimo: HTMLElement | null = null;
  while (corrente && resi.has(corrente)) {
    ultimo = corrente;
    corrente = corrente.parentElement;
  }
  return ultimo;
}

/// Le linguette di un gruppo di schede: le disegna la shell, perché cambiare
/// scheda è una piega — non serve un giro dal provider (§2.1).
///
/// **Si riusano, non si rifanno.** Erano l'ultimo pezzo d'albero che non
/// passava da `figli`: un `barra.replaceChildren()` a ogni riconciliazione, cioè
/// esattamente ciò che il §2.8 esiste per non fare. Chi ci stava sopra col tab
/// perdeva il fuoco a ogni ridisegno della view attorno — e siccome un ridisegno
/// arriva anche da un `IndexUpdated`, bastava salvare per far saltare via il
/// fuoco di chi stava navigando le schede.
///
/// I due pezzi della riparazione non si separano. La posizione della linguetta
/// vive quanto il bottone e si può catturare; **l'azione no**, e passa da
/// `ascolta` per la ragione della 0118: una chiusura che cattura `tab`
/// manderebbe l'azione del giro in cui è nata, e finché i bottoni si
/// ricostruivano quella chiusura era fresca per caso.
function intestazioniSchede(el: HTMLElement, tabs: UiNode[], onAction: Porta): void {
  const barra = el.querySelector<HTMLElement>(":scope > .ui-tab-bar");
  if (!barra) return;
  barra.setAttribute("role", "tablist");
  // I pannelli, nell'ordine in cui stanno: servono a legare ogni linguetta al
  // suo (`aria-controls`) e viceversa (`aria-labelledby`). È la coppia che
  // permette a un lettore di schermo di dire «scheda 2 di 3, selezionata» e di
  // saltare direttamente al contenuto invece di leggere anche le altre.
  const pannelli = Array.from(
    el.querySelectorAll<HTMLElement>(":scope > .ui-children > .ui-tab"),
  );
  const esistenti = Array.from(barra.querySelectorAll<HTMLElement>(":scope > .ui-tab-button"));
  const usate = new Set<HTMLElement>();
  tabs.forEach((tab, i) => {
    if (tab.node !== "tab") return;
    const bottone = esistenti[i] ?? nuovaLinguetta(barra, el, i);
    usate.add(bottone);
    bottone.textContent = tab.label;
    const pannello = pannelli[i];
    if (pannello) {
      if (!bottone.id) bottone.id = identificatore("linguetta");
      bottone.setAttribute("aria-controls", pannello.id);
      pannello.setAttribute("aria-labelledby", bottone.id);
    }
    // Chi ha chiesto di saperlo lo sa; chi non ha dichiarato un'azione non
    // viene disturbato per una piega — e se smette di dichiararla, `ascolta`
    // spegne la sua senza togliere l'ascoltatore.
    ascolta(bottone, "click", tab.action, onAction);
  });
  for (const bottone of esistenti) if (!usate.has(bottone)) bottone.remove();
  frecceFraSchede(barra, el);
  segnaSchedaAttiva(el);
}

/// Una linguetta nuova, con l'unica cosa che è sua per sempre: **quale scheda
/// mostra**, cioè la sua posizione, che non cambia per la vita del bottone.
function nuovaLinguetta(barra: HTMLElement, gruppo: HTMLElement, indice: number): HTMLElement {
  const bottone = document.createElement("button");
  bottone.className = "ui-tab-button";
  bottone.setAttribute("role", "tab");
  bottone.addEventListener("click", () => mostraScheda(gruppo, indice));
  barra.appendChild(bottone);
  return bottone;
}

/// Le frecce dentro una barra di schede: ← → per spostarsi, Home/Fine per
/// andare agli estremi.
///
/// L'ascoltatore sta sulla **barra** e non sulle linguette, e si registra una
/// volta sola: `intestazioniSchede` ridisegna i figli a ogni giro, e un
/// ascoltatore per linguetta sarebbe un ascoltatore in più a ogni ridisegno su
/// un elemento che nel frattempo è stato buttato.
function frecceFraSchede(barra: HTMLElement, gruppo: HTMLElement): void {
  if (barra.dataset.frecce === "sì") return;
  barra.dataset.frecce = "sì";
  barra.addEventListener("keydown", (e) => {
    const passo =
      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? 0 : e.key === "End" ? 0 : null;
    if (passo === null) return;
    const bottoni = Array.from(
      barra.querySelectorAll<HTMLElement>(":scope > .ui-tab-button"),
    );
    if (bottoni.length === 0) return;
    const attiva = Number(gruppo.dataset.attiva ?? "0");
    const prossima =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? bottoni.length - 1
          : // Il giro si chiude: dall'ultima si torna alla prima. È ciò che
            // fa un tab widget nativo, e chi ci arriva col tasto se lo aspetta.
            (attiva + passo + bottoni.length) % bottoni.length;
    e.preventDefault();
    bottoni[prossima]?.click();
    bottoni[prossima]?.focus();
  });
}

function mostraScheda(el: HTMLElement, indice: number): void {
  el.dataset.attiva = String(indice);
  segnaSchedaAttiva(el);
}

function segnaSchedaAttiva(el: HTMLElement): void {
  const attiva = Number(el.dataset.attiva ?? "0");
  const corpo = el.querySelector<HTMLElement>(":scope > .ui-children");
  const bottoni = el.querySelectorAll<HTMLElement>(":scope > .ui-tab-bar > .ui-tab-button");
  bottoni.forEach((b, i) => {
    b.setAttribute("aria-selected", String(i === attiva));
    // Il tab visita **il gruppo**, non ogni linguetta: dentro ci si muove con
    // le frecce. È la convenzione dei tab widget, ed è ciò che evita che una
    // barra da otto schede diventi otto fermate prima del contenuto.
    b.tabIndex = i === attiva ? 0 : -1;
  });
  if (!corpo) return;
  Array.from(corpo.children).forEach((c, i) => {
    if (c instanceof HTMLElement) c.hidden = i !== attiva;
  });
}
