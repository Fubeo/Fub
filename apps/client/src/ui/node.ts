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
// nodo sta in `links` e la si legge quando l'evento scatta; l'handler di tutto
// l'albero sta in `Montaggio.corrente` e ci si arriva attraverso la `Porta`.
// Fuori da `mountTree` un `ActionHandler` non passa: dentro gira solo la porta,
// che per un contenitore è una sola per sempre.
import type { ActionRef, FieldValue, UiKind, UiNode, UiOption, UiValue } from "../host/contract";
import { customRenderer } from "./custom";
import { setSanitizedHtml } from "./sanitize";
import { activatable, identifier, notActivatable } from "./a11y";
import { t } from "../i18n/strings";
import { errorText } from "../host/errors";
import { notify } from "./notify";
import { setTooltip } from "./tooltip";

/// Cosa fa la shell quando un'azione scatta: la manda al provider con le due
/// metà — il payload che il provider aveva attaccato al nodo, e i campi che
/// l'utente ha compilato.
export type ActionHandler = (action: ActionRef, fields: FieldValue[]) => void | Promise<void>;

declare const PORT: unique symbol;

/// **La porta di un albero montato**: ciò che gira dentro questo file al posto
/// di un `ActionHandler`.
///
/// È un handler marchiato, e il marchio è il prendereddio. Un `ActionHandler` nudo
/// entra da `mountTree` e non va oltre: tutto il resto — il disegno, la
/// riconciliazione, gli ascoltatori, i renderer custom — riceve una `Porta`, che
/// per un contenitore è **una sola per sempre** e a ogni chiamata inoltra
/// all'handler dell'ultimo montaggio. Chi la cattura in una chiusura cattura un
/// rinvio, non una destinazione, e non può invecchiare.
///
/// La sola fabbrica è `instrada`. Un `ActionHandler` passato a una di queste
/// funzioni **non compila**: è la stessa forma con cui la
/// [0118](../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md)
/// ha tolto a `dispatchAction` la facoltà di ricevere un `ActionRef`, un piano più in su.
export type Port = ActionHandler & { readonly [PORT]: true };

/// Ciò che la shell ricorda di un elemento che ha disegnato: il nodo da cui
/// viene (per il confronto al giro dopo) e, se è un campo, come si legge il suo
/// valore adesso.
interface Rendered {
  node: UiNode;
  read?: () => UiValue;
}

const rendered = new WeakMap<HTMLElement, Rendered>();

/// Ciò che un contenitore ricorda fra un montaggio e l'altro: l'albero (per il
/// confronto) e **chi instrada le sue azioni adesso**.
interface Mount {
  root: HTMLElement | null;
  /// L'handler dell'ultimo montaggio. Cambia; nessuno lo tiene.
  current: ActionHandler;
  /// Il rinvio a `corrente`. Non cambia mai identità: è ciò che tutti tengono.
  port: Port;
}

const mounted = new WeakMap<HTMLElement, Mount>();

/// Dichiara chi instrada le azioni di questo contenitore **da adesso**.
///
/// È l'unico posto in cui un `ActionHandler` entra nel renderer, e l'unico in
/// cui una `Porta` nasce. Un rimontaggio non rifà la porta: aggiorna ciò a cui
/// rdispatchAction, e con una riga sola raggiunge ogni chiusura che l'aveva già presa —
/// un ascoltatore di campo, la linguetta di una scheda, il canvas di un
/// renderer custom che è sopravvissuto alla riconciliazione.
function route(container: HTMLElement, onAction: ActionHandler): Mount {
  const existing = mounted.get(container);
  if (existing) {
    existing.current = onAction;
    return existing;
  }
  const mount: Mount = {
    root: null,
    current: onAction,
    port: ((action, fields) => failure(action, () => mount.current(action, fields))) as Port,
  };
  mounted.set(container, mount);
  return mount;
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
function failure(action: ActionRef, execute: () => void | Promise<void>): void | Promise<void> {
  const tell = (e: unknown): void => {
    notify(t("views.action_failed", { action: action.action, reason: errorText(e) }), "guasto");
  };
  // I due modi in cui un handler va storto sono due, e nessuno dei due prende
  // l'altro: un `throw` sincrono non arriva mai a una `.catch`, e una promessa
  // rifiutata non passa da un `try` che è già uscito.
  let result: void | Promise<void>;
  try {
    result = execute();
  } catch (e) {
    tell(e);
    return;
  }
  return Promise.resolve(result).catch(tell);
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
  const mount = route(container, onAction);
  const previous = mount.root;
  if (previous && previous.parentElement === container) {
    mount.root = reconcile(previous, node, mount.port);
    return;
  }
  for (const child of [...container.children]) unmount(child);
  container.replaceChildren();
  const el = renderUiNode(node, mount.port);
  container.appendChild(el);
  mount.root = el;
}

/// Rimpiazza il solo nodo con questa chiave (`ViewUpdate::Patch`).
///
/// Torna `false` se la chiave non c'è: **non è un errore** — è una view
/// cambiata sotto — e chi chiama ridisegna intero.
export function patchTree(container: HTMLElement, key: string, node: UiNode): boolean {
  const mount = mounted.get(container);
  if (!mount?.root) return false;
  const target = findByKey(mount.root, key);
  if (!target) return false;
  // La porta del contenitore, non un handler ripescato dal sottoalbero: un
  // patch arriva senza il contesto del render, e ciò che risale dall'elemento è
  // **il primo** montaggio, non l'ultimo. Riconciliare con quello riscriverebbe
  // i legami del sottoalbero patchato con l'handler di ieri — cioè disferebbe
  // la 0118 proprio dove nessuno guarda.
  const updated = reconcile(target, node, mount.port);
  if (target === mount.root) mount.root = updated;
  return true;
}

/// Dimentica ciò che è montato qui: il prossimo giro ridisegna da zero.
///
/// La **porta** invece resta, ed è deliberato: è l'identità che dura quanto il
/// contenitore, e rifarla lascerebbe in giro rinvii che non inoltrano più a
/// nessuno.
export function unmountTree(container: HTMLElement): void {
  const mount = mounted.get(container);
  if (mount) mount.root = null;
  for (const child of [...container.children]) unmount(child);
  container.replaceChildren();
}

/// Come si smonta ciò che un renderer custom ha acceso su un elemento.
///
/// Serve perché un renderer può possedere qualcosa che il DOM non raccoglie da
/// sé — un ciclo di animazione, un timer, un `ResizeObserver` — e togliere
/// l'elemento non lo spegne. Nessun altro nodo ne ha bisogno: quelli sono
/// elementi e basta.
const disposers = new WeakMap<HTMLElement, () => void>();

/// Spegne ciò che sta per essere tolto: `el` e tutto quello che ha sotto.
///
/// Si cammina il sottoalbero e non il solo `el` perché un nodo custom sta quasi
/// sempre **dentro** ciò che viene sostituito — è una foglia dell'albero di una
/// view, e a essere rimpiazzata è la view intera.
function unmount(el: Element): void {
  disposers.get(el as HTMLElement)?.();
  disposers.delete(el as HTMLElement);
  for (const inside of el.querySelectorAll<HTMLElement>(".ui-custom")) {
    disposers.get(inside)?.();
    disposers.delete(inside);
  }
}

function findByKey(root: HTMLElement, key: string): HTMLElement | null {
  const matches: HTMLElement[] = [];
  if (rendered.get(root)?.node.key === key) matches.push(root);
  matches.push(...root.querySelectorAll<HTMLElement>(`[data-key="${CSS.escape(key)}"]`));
  // Una patch identifica un nodo per chiave, quindi una chiave ambigua non è
  // un bersaglio: scegliere il primo trasformerebbe un albero malformato in
  // una mutazione deterministica ma sbagliata. Chi chiama farà il full render.
  return matches.length === 1 ? matches[0] : null;
}

/// Aggiorna `el` perché mostri `next`, o lo sostituisce se non è possibile.
/// Restituisce l'elemento che ora rappresenta il nodo (lo stesso, o il nuovo).
function reconcile(el: HTMLElement, next: UiNode, onAction: Port): HTMLElement {
  const prev = rendered.get(el)?.node;
  if (!prev || prev.node !== next.node) {
    const newItem = renderUiNode(next, onAction);
    unmount(el);
    el.replaceWith(newItem);
    return newItem;
  }
  if (update(el, prev, next, onAction)) {
    rendered.set(el, { ...rendered.get(el)!, node: next });
    key(el, next);
    return el;
  }
  const newItem = renderUiNode(next, onAction);
  unmount(el);
  el.replaceWith(newItem);
  return newItem;
}

/// Prova ad aggiornare `el` in posto. `false` = ricostruiscilo.
///
/// La divisione non è per comodità: **i campi si aggiornano** perché hanno uno
/// stato dell'utente da non buttare via (focus, cursore, ciò che si sta
/// scrivendo), i **contenitori** si aggiornano perché contengono campi, e le
/// **foglie** si ricostruiscono perché non hanno niente da conservare e il
/// confronto costerebbe più del disegno.
function update(
  el: HTMLElement,
  prev: UiNode,
  next: UiNode,
  onAction: Port,
): boolean {
  switch (next.node) {
    case "stack": {
      if (prev.node !== "stack") return false;
      el.style.flexDirection = next.dir === "row" ? "row" : "column";
      el.style.gap = `${next.gap}px`;
      children(el, next.children, onAction);
      return true;
    }
    case "list":
      if (prev.node !== "list") return false;
      children(el, next.items, onAction);
      return true;
    case "tree":
      if (prev.node !== "tree") return false;
      children(el, next.roots, onAction);
      return true;
    case "section": {
      if (prev.node !== "section") return false;
      const details = el as HTMLDetailsElement;
      const title = details.querySelector("summary");
      if (title) title.textContent = next.title;
      // `collapsed` è lo stato INIZIALE: se l'utente ha aperto la sezione, un
      // ridisegno non gliela richiude.
      children(childrenContainer(el), next.children, onAction);
      return true;
    }
    case "tree_item": {
      if (prev.node !== "tree_item") return false;
      const row = el.querySelector<HTMLElement>(":scope > .ui-tree-label");
      if (row) {
        row.textContent = next.label;
        connect(row, next.action, onAction);
      }
      // Gli stati ARIA seguono il nodo anche quando l'elemento è reuseto: una
      // cartella che si apre e resta `aria-expanded="false"` è una cartella
      // che, per chi la legge, non si è aperta.
      if (next.selected) el.setAttribute("aria-selected", "true");
      else el.removeAttribute("aria-selected");
      if (next.children.length > 0) el.setAttribute("aria-expanded", String(next.expanded));
      else el.removeAttribute("aria-expanded");
      childrenContainer(el).hidden = !next.expanded;
      children(childrenContainer(el), next.children, onAction);
      return true;
    }
    case "tab":
      if (prev.node !== "tab") return false;
      children(childrenContainer(el), next.children, onAction);
      return true;
    case "tabs": {
      if (prev.node !== "tabs") return false;
      // Quale scheda è aperta è stato della shell: `active` vale alla prima
      // apertura, e un ridisegno non riporta l'utente sulla scheda uno.
      children(childrenContainer(el), next.tabs, onAction);
      tabHeaders(el, next.tabs, onAction);
      return true;
    }
    case "form": {
      if (prev.node !== "form") return false;
      children(childrenContainer(el), next.children, onAction);
      const dispatchAction = el.querySelector<HTMLButtonElement>(":scope > .ui-submit");
      if (dispatchAction) {
        dispatchAction.textContent = next.submit_label;
        connect(dispatchAction, next.submit, onAction);
      }
      return true;
    }
    case "table": {
      if (prev.node !== "table") return false;
      const sameColumns = prev.columns.length === next.columns.length;
      if (sameColumns) {
        const headers = el.querySelectorAll<HTMLTableCellElement>(":scope > thead > tr > th");
        next.columns.forEach((col, i) => {
          const th = headers[i];
          if (!th) return;
          th.textContent = col.title;
          th.style.textAlign = col.align === "start" ? "left" : col.align === "end" ? "right" : "center";
        });
      }
      const body = childrenContainer(el);
      children(body, next.rows, onAction);
      return sameColumns;
    }
    case "row":
      if (prev.node !== "row") return false;
      children(el, next.cells, onAction);
      ensureRowCell(el as HTMLTableRowElement);
      connect(el, next.action, onAction);
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
      children(el, next.fallback, onAction);
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
      return applyField(el, next, onAction);
    // Le foglie: niente da conservare, il disegno costa meno del confronto.
    default:
      return false;
  }
}

/// Il contenitore dei figli di un nodo composito (quelli che hanno anche una
/// testata: sezione, scheda, form, tabella, voce d'albero).
function childrenContainer(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>(":scope > .ui-children") ?? el;
}

/// Cosa fare di un figlio nuovo: reusere quello che c'era (a quale posto) o
/// disegnarlo da capo.
export type Pairing = { reuse: number } | { create: true };

/// Accoppia i figli vecchi con i nuovi — **per chiave**, dove c'è.
///
/// È il cuore del §2.8, ed è una funzione pura apposta: la regola si prova
/// senza un DOM, e ciò che qui può essere sbagliato non è il disegno ma la
/// decisione. Le due righe che contano:
///
/// - un nodo **con chiave** reuse il vecchio di quella chiave, **ovunque
///   fosse**. È ciò che rende un riordino uno spostamento invece di un
///   rimescolamento di contenuti — senza, la riga 1 riceve i dati della riga 2,
///   e con essi il focus e la selezione di qualcun altro;
/// - un nodo **senza chiave** reuse il prossimo vecchio senza chiave, in
///   ordine. È il comportamento di prima della seduta, ed è giusto per ciò che
///   non si riordina: una testata, un separatore, un segnaposto.
///
/// Una chiave che compare due volte fra i fratelli è un albero malformato: la
/// prima occorrenza reuse, la seconda disegna. Non è un errore che si alza —
/// una view che sbaglia le chiavi deve restare disegnabile — ma non è nemmeno
/// silenzioso a valle: perde lo stato a ogni giro, che è il sintomo giusto.
export function pair(
  previous: readonly (string | undefined)[],
  newItems: readonly (string | undefined)[],
): Pairing[] {
  const forKey = new Map<string, number>();
  const withoutKey: number[] = [];
  previous.forEach((k, i) => {
    if (k === undefined) withoutKey.push(i);
    else if (!forKey.has(k)) forKey.set(k, i);
  });

  const used = new Set<number>();
  let nextWithoutKey = 0;
  return newItems.map((k) => {
    let candidate: number | undefined;
    if (k !== undefined) {
      candidate = forKey.get(k);
    } else {
      candidate = withoutKey[nextWithoutKey++];
    }
    if (candidate === undefined || used.has(candidate)) return { create: true };
    used.add(candidate);
    return { reuse: candidate };
  });
}

/// Applica l'accoppiamento al DOM: riconcilia ciò che si reuse, disegna il
/// resto, toglie ciò che non serve più e **sposta** invece di ricreare.
function children(parent: HTMLElement, nodes: UiNode[], onAction: Port): void {
  const existing = Array.from(parent.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && rendered.has(c),
  );
  const plan = pair(
    existing.map((el) => rendered.get(el)!.node.key),
    nodes.map((n) => n.key),
  );

  const used = new Set<HTMLElement>();
  const finalNodes = nodes.map((node, i) => {
    const choice = plan[i]!;
    if ("reuse" in choice) {
      const el = existing[choice.reuse]!;
      used.add(el);
      return reconcile(el, node, onAction);
    }
    return renderUiNode(node, onAction);
  });

  for (const el of existing) {
    if (!used.has(el)) {
      unmount(el);
      el.remove();
    }
  }
  // Rimettere in ordine: `insertBefore` di un nodo già figlio lo SPOSTA, e
  // spostarlo conserva focus, scroll e stato — che è tutto il punto.
  let reference: ChildNode | null = null;
  for (let i = finalNodes.length - 1; i >= 0; i--) {
    const el = finalNodes[i]!;
    if (el.nextSibling !== reference || el.parentElement !== parent) {
      parent.insertBefore(el, reference);
    }
    reference = el;
  }
}

// ---------------------------------------------------------------------------
// Disegno
// ---------------------------------------------------------------------------

function renderUiNode(node: UiNode, onAction: Port): HTMLElement {
  const el = draw(node, onAction);
  rendered.set(el, { ...(rendered.get(el) ?? {}), node });
  key(el, node);
  return el;
}

function key(el: HTMLElement, node: UiNode): void {
  if (node.key !== undefined) el.dataset.key = node.key;
  else delete el.dataset.key;
}

function ensureRowCell(row: HTMLTableRowElement): void {
  if (row.cells.length > 0) return;
  const td = document.createElement("td");
  td.className = "ui-empty-cell";
  row.appendChild(td);
}

function draw(node: UiNode, onAction: Port): HTMLElement {
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
      connect(el, node.action, onAction);
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
      connect(el, node.action, onAction);
      return el;
    }
    case "html": {
      const el = div("ui-html");
      // Riservato al codice fidato: il kernel rifiuta questa variante da un
      // provider non fidato (`UiNode::validate_untrusted`), in un punto solo.
      //
      // E passa comunque dal sanitizer (§3.6): i due prendereddi rispondono a due
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
      // e basta — e non c'è modo di sapere se valga la pena entrarci. Per un
      // frame il nome accessibile è il `title`, e solo lui: un `aria-label`
      // l'audit non lo legge. Il contratto non porta un titolo per questo nodo,
      // quindi il meglio che si possa dire è l'indirizzo: è poco, ed è comunque
      // l'unica cosa vera che la shell sappia. Un titolo vero è roba del
      // contratto, non di qui.
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
      const body = div("ui-children");
      for (const child of node.children) body.appendChild(renderUiNode(child, onAction));
      el.appendChild(body);
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
      connect(el, node.action, onAction);
      for (const cell of node.cells) {
        const td = document.createElement("td");
        td.appendChild(renderUiNode(cell, onAction));
        el.appendChild(td);
      }
      ensureRowCell(el);
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
      const row = div("ui-tree-label");
      row.textContent = node.label;
      connect(row, node.action, onAction);
      // Il ruolo sta sul **contenitore** e non sull'etichetta, perché è il
      // contenitore ad avere i figli: un `treeitem` che non contiene il proprio
      // gruppo è un albero piatto per chi lo legge. Il nome però viene
      // dall'etichetta e non dal contenitore, o sarebbe l'etichetta *più tutto
      // il sottoalbero* — che su una cartella con cento note è un nome lungo
      // cento note.
      const labelId = identifier("albero");
      row.id = labelId;
      el.setAttribute("role", "treeitem");
      el.setAttribute("aria-labelledby", labelId);
      if (node.selected) el.setAttribute("aria-selected", "true");
      el.appendChild(row);
      const children = div("ui-children");
      children.hidden = !node.expanded;
      // `aria-expanded` solo su chi ha davvero dei figli: dichiararlo su una
      // foglia annuncia «compresso» a chi non ha niente da espandere.
      if (node.children.length > 0) {
        el.setAttribute("aria-expanded", String(node.expanded));
        children.setAttribute("role", "group");
      }
      for (const child of node.children) children.appendChild(renderUiNode(child, onAction));
      el.appendChild(children);
      return el;
    }
    case "tabs": {
      const el = div("ui-tabs");
      const bar = div("ui-tab-bar");
      el.appendChild(bar);
      const body = div("ui-children");
      for (const tab of node.tabs) body.appendChild(renderUiNode(tab, onAction));
      el.appendChild(body);
      showTab(el, Math.min(node.active, Math.max(node.tabs.length - 1, 0)));
      tabHeaders(el, node.tabs, onAction);
      return el;
    }
    case "tab": {
      const el = div("ui-tab");
      // Il pannello di una scheda. L'`aria-labelledby` che lo lega alla sua
      // linguetta lo mette `intestazioniSchede`, perché è là che le linguette
      // nascono e solo là si sa quale appartiene a quale.
      el.setAttribute("role", "tabpanel");
      el.id = identifier("scheda");
      const body = div("ui-children");
      for (const child of node.children) body.appendChild(renderUiNode(child, onAction));
      el.appendChild(body);
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
      setTooltip(el, node.name);
      return el;
    }
    case "progress": {
      const el = div("ui-progress");
      const bar = document.createElement("progress");
      if (node.value !== null) {
        bar.max = 1;
        bar.value = node.value;
      }
      el.appendChild(bar);
      if (node.label) {
        const text = div("ui-progress-label");
        text.textContent = node.label;
        // La `<progress>` prende il nome dall'etichetta che le sta accanto.
        // Senza, un lettore di schermo annuncia «barra di avanzamento, 40%» —
        // e il 40% *di cosa* è precisamente l'informazione che serve.
        const id = identifier("avanzamento");
        text.id = id;
        bar.setAttribute("aria-labelledby", id);
        el.appendChild(text);
      }
      return el;
    }
    case "separator":
      return document.createElement("hr");
    case "empty_state": {
      const el = div("ui-empty-state");
      const title = div("ui-empty-title");
      title.textContent = node.title;
      el.appendChild(title);
      if (node.detail) {
        const detail = div("ui-empty-detail");
        detail.textContent = node.detail;
        el.appendChild(detail);
      }
      if (node.action) {
        const button = document.createElement("button");
        button.className = "ui-button intent-primary";
        button.textContent = node.detail ?? node.title;
        connect(button, node.action, onAction);
        el.appendChild(button);
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
      const el = fieldSkeleton(node);
      applyField(el, node, onAction);
      return el;
    }
    case "form": {
      const el = document.createElement("form");
      el.className = "ui-form";
      const body = div("ui-children");
      for (const child of node.children) body.appendChild(renderUiNode(child, onAction));
      el.appendChild(body);
      const dispatchAction = document.createElement("button");
      dispatchAction.type = "submit";
      dispatchAction.className = "ui-button ui-submit intent-primary";
      dispatchAction.textContent = node.submit_label;
      connect(dispatchAction, node.submit, onAction);
      el.appendChild(dispatchAction);
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
      const draw = customRenderer(node.ns);
      if (draw) {
        // Lo smontaggio torna dal renderer e si mette da parte: un canvas con
        // un `requestAnimationFrame` in volo su un elemento che nessuno guarda
        // più è un ciclo che continua a girare per sempre, e a saperlo è solo
        // chi lo ha acceso.
        // Quello che il renderer riceve è la **porta**, e conta perché lui è
        // l'unico a cui il riconciliatore non ridà niente: se il payload non
        // cambia, l'elemento resta e il widget dentro pure, per quanti
        // ridisegni faccia la view intorno. Un handler nudo qui invecchierebbe
        // e ci resterebbe.
        const unmount = draw(el, node.payload, onAction);
        if (unmount) disposers.set(el, unmount);
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
      const messageElement = div("ui-failed-message");
      messageElement.textContent = node.message;
      el.appendChild(messageElement);
      if (node.retry) {
        const button = document.createElement("button");
        button.className = "ui-button";
        button.textContent = t("app.retry");
        connect(button, node.retry, onAction);
        el.appendChild(button);
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
// divergono: divergevano su nove voci, e ogni voce era un campo reuseto che
// mostrava o mandava la forma di ieri funzionando. È la stessa regola della
// [0118](../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md)
// spostata dagli ascoltatori agli attributi: chi ne aggiunge uno lo scrive qui
// dentro e ce l'ha in tutte e due le vite senza saperlo.

/// I nodi che sono un **campo**: portano un `field`, un valore che l'utente
/// cambia, un'etichetta e un'azione.
type Field = Extract<UiKind, { field: string }>;

/// Lo scheletro di un campo: gli elementi che vivono quanto il campo.
///
/// Non scrive **niente** che venga dal nodo se non la sua specie — che è
/// l'unica cosa che il riconciliatore non può cambiare senza ricostruire.
function fieldSkeleton(node: Field): HTMLElement {
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
      const text = document.createElement("span");
      text.className = "ui-field-label";
      el.append(input, text);
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
function applyField(el: HTMLElement, node: Field, onAction: Port): boolean {
  switch (node.node) {
    case "text_input":
    case "date_picker": {
      const input = el.querySelector("input");
      if (!input) return false;
      input.type = node.node === "date_picker" ? "date" : "text";
      attribute(input, "placeholder", node.node === "text_input" ? node.placeholder : null);
      writeValue(input, node.value ?? "");
      value(el, () => ({ type: "text", value: input.value }));
      staticControl(input, node.action);
      actionsOfField(input, node.action, onAction);
      break;
    }
    case "text_area": {
      const area = el.querySelector("textarea");
      if (!area) return false;
      area.rows = node.rows;
      writeValue(area, node.value);
      value(el, () => ({ type: "text", value: area.value }));
      staticControl(area, node.action);
      actionsOfField(area, node.action, onAction);
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
      attribute(input, "min", node.min === null ? null : String(node.min));
      attribute(input, "max", node.max === null ? null : String(node.max));
      attribute(input, "step", node.step === null ? null : String(node.step));
      writeValue(input, node.value === null ? "" : String(node.value));
      value(el, () => ({ type: "number", value: Number(input.value) }));
      staticControl(input, node.action);
      actionsOfField(input, node.action, onAction);
      break;
    }
    case "checkbox": {
      const input = el.querySelector("input");
      if (!input) return false;
      if (document.activeElement !== input) input.checked = node.value;
      value(el, () => ({ type: "bool", value: input.checked }));
      staticControl(input, node.action);
      actionsOfField(input, node.action, onAction);
      break;
    }
    case "select": {
      const select = el.querySelector("select");
      if (!select) return false;
      select.multiple = node.multiple;
      options(select, node.options, node.value);
      value(el, () => {
        const choices = Array.from(select.selectedOptions).map((o) => o.value);
        // `multiple` si legge **dal DOM**, non dal nodo di questo giro: quel
        // nodo è vecchio al giro dopo, e un select diventato multiplo
        // continuerebbe a riportare un `text` — la 0118 applicata al valore.
        return select.multiple
          ? { type: "choices", value: choices }
          : { type: "text", value: choices[0] ?? "" };
      });
      staticControl(select, node.action);
      actionsOfField(select, node.action, onAction);
      break;
    }
    case "radio": {
      radioButtons(el, node, onAction);
      // Il valore di un gruppo di radio è ciò che è spuntato adesso, e basta:
      // niente variabile catturata a fare da memoria: sarebbe la «seconda
      // verità» che la testata di questo file esiste per non avere.
      value(el, () => ({
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
  el.dataset.field = node.field;
  label(el, node.label);
  bindLabel(el, node.field);
  return true;
}

/// Un attributo che c'è o non c'è: `null` lo toglie.
///
/// La differenza si vede solo al riuso — un campo che perde il segnaposto e se
/// lo tiene scritto sotto suggerisce quello di un altro nodo — ed è la ragione
/// per cui non basta assegnare la proprietà quando c'è.
function attribute(el: HTMLElement, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/// Il valore del provider, senza sovrascrivere chi sta scrivendo.
///
/// Chi ha le dita sul campo ha ragione: il valore nuovo lo vedrà al prossimo
/// giro, quando avrà smesso — e intanto l'azione manda ciò che c'è davvero.
function writeValue(control: HTMLInputElement | HTMLTextAreaElement, v: string): void {
  if (document.activeElement !== control && control.value !== v) control.value = v;
}

/// Le opzioni di un `select`, riconciliate invece che rifatte.
///
/// Un'opzione in più o in meno non ricostruisce il campo: prima lo faceva —
/// `update` tornava `false` appena l'elenco cambiava — e un `select` che
/// perdeva il fuoco a ogni cambio di opzioni è la stessa cosa che il §2.8
/// esiste per non fare.
function options(select: HTMLSelectElement, options: UiOption[], value: string[]): void {
  while (select.options.length > options.length) select.remove(select.options.length - 1);
  options.forEach((option, i) => {
    const opt = select.options[i] ?? select.appendChild(document.createElement("option"));
    opt.value = option.value;
    opt.textContent = option.label;
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
function radioButtons(el: HTMLElement, node: Field & { node: "radio" }, onAction: Port): void {
  if (!el.id) el.id = identifier("gruppo-radio");
  const rows = Array.from(el.querySelectorAll<HTMLElement>(":scope > .ui-radio-option"));
  for (const row of rows.slice(node.options.length)) row.remove();
  node.options.forEach((option, i) => {
    const row = rows[i] ?? newItemOption(el);
    const input = row.querySelector<HTMLInputElement>("input")!;
    input.name = el.id;
    input.value = option.value;
    input.checked = option.value === node.value;
    input.disabled = node.action === null;
    row.querySelector<HTMLElement>("span")!.textContent = option.label;
    actionsOfField(input, node.action, onAction);
  });
}

function newItemOption(el: HTMLElement): HTMLElement {
  const row = document.createElement("label");
  row.className = "ui-radio-option";
  const input = document.createElement("input");
  input.type = "radio";
  row.append(input, document.createElement("span"));
  el.appendChild(row);
  return row;
}

/// L'etichetta di un campo — **anche quando compare o sparisce**.
///
/// Riallineava solo il testo di un'etichetta che c'era già, e sono i due versi
/// dello stesso difetto: un campo reuseto che perdeva l'etichetta se la teneva
/// addosso, e uno che la guadagnava restava anonimo. Non si vedono finché non è
/// lo stesso elemento a fare due nodi diversi.
function label(el: HTMLElement, label: string | null): void {
  const existing = el.querySelector<HTMLElement>(":scope > .ui-field-label");
  if (label === null) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.textContent = label;
    return;
  }
  // Un `<div>` accanto a un `<input>` è testo che *sembra* un'etichetta e non
  // lo è per nessuno tranne che per chi guarda: un lettore di schermo su quel
  // campo annuncia «casella di testo», e il nome lo ha letto un attimo prima
  // come frase sciolta, senza modo di connectrlo.
  const text = document.createElement("label");
  text.className = "ui-field-label";
  text.textContent = label;
  el.prepend(text);
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
/// di testo» e deve compilarla a indovinare. È il difetto che il prendereddio di
/// questa voce ha trovato per primo.
///
/// Il ripiego è il **nome del campo**, ed è brutto apposta: `tags` non è prosa,
/// è un identificatore, e si nota. È lo stesso gradino ultimo della scala della
/// [decisione 0040](../../../docs/decisions/0192-impostazioni-locale-e-temi.md) — «brutto,
/// onesto e soprattutto cercabile» —, per la stessa ragione: un ripiego che
/// inventasse un'etichetta plausibile («Testo») renderebbe un campo senza nome
/// indistinguibile da uno nominato male.
function bindLabel(el: HTMLElement, field: string): void {
  // Un gruppo di radio si nomina **in blocco** anche qui: mettere il nome del
  // campo su ogni bottone coprirebbe l'etichetta della singola opzione, che è
  // l'unica cosa buona che quel bottone abbia già.
  const radio = el.querySelector("input[type=radio]") !== null;
  // Per decidere se un nome *esiste* vale ogni `.ui-field-label` — anche lo
  // `<span>` della casella di spunta, che nomina per avvolgimento. Per
  // decidere se **legarlo** vale solo la `<label>`, che è l'unica ad avere un
  // `for`.
  const visible = el.querySelector<HTMLElement>(":scope > .ui-field-label");
  const control = el.querySelector<HTMLElement>("input, textarea, select");
  if (!visible) {
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
    control?.setAttribute("aria-label", field);
    return;
  }

  // E il verso opposto: un campo che *guadagna* un'etichetta non tiene il
  // ripiego, o si ritroverebbe nominato due volte e la seconda col nome brutto.
  el.removeAttribute("aria-label");
  control?.removeAttribute("aria-label");
  const label = el.querySelector<HTMLLabelElement>(":scope > label.ui-field-label");
  if (!label || !control) return;
  // Il nome va al **gruppo**, che è ciò che `radiogroup` esiste per rendere
  // nominabile.
  if (radio) {
    if (!label.id) label.id = identifier("gruppo");
    el.setAttribute("role", "radiogroup");
    el.setAttribute("aria-labelledby", label.id);
    return;
  }
  if (label.htmlFor) return;
  if (!control.id) control.id = identifier("campo");
  label.htmlFor = control.id;
}

/// Registra come si legge il valore di questo campo, adesso.
function value(el: HTMLElement, read: () => UiValue): void {
  rendered.set(el, { ...(rendered.get(el) ?? { node: { node: "separator" } as UiNode }), read });
}

/// Cosa manda un elemento quando un suo evento scatta, **adesso**.
///
/// # Perché una mappa e non una chiusura
///
/// Un ascoltatore registrato una volta sola con l'`ActionRef` catturato dentro
/// la chiusura è giusto finché l'elemento è nuovo, e diventa **silenziosamente
/// sbagliato** il primo giro che il riconciliatore (§2.8) lo reuse: il campo
/// mostra il valore nuovo, ha il focus giusto, e manda l'azione di ieri. Non
/// smette di funzionare — fa la cosa sbagliata funzionando, che è peggio.
///
/// La riparazione non è togliere e rimettere l'ascoltatore a ogni
/// riconciliazione (funziona, e va ripetuta a mano dal prossimo che ne aggiunge
/// uno): è che la chiusura **non abbia niente da invecchiare**. Qui dentro
/// l'ascoltatore cattura solo l'elemento e il nome dell'evento — due cose che
/// non cambiano mai — e legge l'azione da questa mappa quando l'evento scatta.
/// Un ascoltatore nuovo registrato da `ascolta` eredita la proprietà gratis.
interface Link {
  action: ActionRef;
  onAction: Port;
  when?: (e: Event) => boolean;
}

/// L'azione in vigore per ogni evento di ogni elemento. `null` = l'elemento ha
/// l'ascoltatore ma il nodo che rappresenta adesso non ha azione.
const links = new WeakMap<HTMLElement, Map<string, Link | null>>();

/// **L'unica porta da cui si registra un ascoltatore d'azione.**
///
/// Chiamarla due volte sullo stesso elemento e sullo stesso evento non
/// accumula: la seconda aggiorna l'azione e il predicato. È ciò che rende
/// sicuro richiamarla dal riconciliatore con la stessa disinvoltura con cui la
/// chiama il disegno.
function listen(
  el: HTMLElement,
  event: string,
  action: ActionRef | null,
  onAction: Port,
  when?: (e: Event) => boolean,
): void {
  let bindings = links.get(el);
  if (!bindings) {
    bindings = new Map();
    links.set(el, bindings);
  }
  const registered = bindings.has(event);
  bindings.set(event, action ? { action, onAction, when } : null);
  if (registered) return;
  el.addEventListener(event, (e) => {
    const link = links.get(el)?.get(event);
    if (!link) return;
    if (link.when && !link.when(e)) return;
    e.preventDefault();
    void dispatchAction(el, event);
  });
}

/// Un'azione su un elemento cliccabile.
function connect(el: HTMLElement, action: ActionRef | null, onAction: Port): void {
  if (!action) {
    el.classList.remove("clickable");
    // Non basta togliere il click: se questo elemento era attivabile e viene
    // reuseto dal riconciliatore (§2.8) per un nodo senza azione, resterebbe
    // nel giro del tab senza fare niente.
    notActivatable(el);
  } else {
    el.classList.add("clickable");
    // Cliccabile e attivabile sono la stessa cosa, e da qui in poi lo sono per
    // costruzione: passa di qui **ogni** azione di **ogni** nodo dichiarativo,
    // quindi anche quelli dei pannelli che non sono ancora stati scritti.
    activatable(el);
  }
  listen(el, "click", action, onAction);
}

/// **Tutti** gli ascoltatori d'azione di un campo, in un posto solo.
///
/// La chiamano il disegno e la riconciliazione, con le stesse due righe: chi
/// aggiungerà un terzo ascoltatore a un campo lo scrive qui, e lo ha in
/// entrambe le vite del campo senza ricordarsene.
function staticControl(
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  action: ActionRef | null,
): void {
  // Un campo senza azione è dato da leggere, non un editor senza salvataggio.
  // Lasciarlo modificabile produce uno stato che sembra accettato e sparisce al
  // primo ridisegno. Il browser espone già la semantica corretta: `disabled`.
  control.disabled = action === null;
}

function actionsOfField(
  control: HTMLElement,
  action: ActionRef | null,
  onAction: Port,
): void {
  listen(control, "change", action, onAction);
  // Invio = «ho finito»: senza, un campo di ricerca costringerebbe a uscirne
  // per essere ascoltato. Solo dove Invio non vuol già dire altro — in un
  // `<textarea>` è un a capo, su una casella di spunta è la spunta.
  if (acceptEnter(control)) {
    listen(control, "keydown", action, onAction, (e) => (e as KeyboardEvent).key === "Enter");
  }
}

function acceptEnter(control: HTMLElement): boolean {
  if (!(control instanceof HTMLInputElement)) return false;
  return control.type === "text" || control.type === "date";
}

/// Manda l'azione **in vigore** per questo evento, col suo payload e coi campi
/// in vigore: quelli del form che la contiene, o quelli dell'albero intero
/// fuori da un form.
///
/// Non prende un `ActionRef`, e la mancanza è il prendereddio: un'azione qui non si
/// può passare, quindi non si può catturare in una chiusura e non può
/// invecchiare. Chi ci riprovasse non compila.
async function dispatchAction(from: HTMLElement, event: string): Promise<void> {
  const link = links.get(from)?.get(event);
  if (!link) return;
  await link.onAction(link.action, activeFields(from));
}

export function activeFields(from: HTMLElement): FieldValue[] {
  const scope = from.closest<HTMLElement>(".ui-form") ?? rootOf(from);
  if (!scope) return [];
  const found = new Map<string, UiValue>();
  const candidates = [scope, ...Array.from(scope.querySelectorAll<HTMLElement>("[data-field]"))];
  for (const el of candidates) {
    const field = el.dataset.field;
    const read = rendered.get(el)?.read;
    if (!field || !read) continue;
    // Un campo dichiarato due volte compare una volta sola, con l'ultimo
    // valore: è la regola scritta accanto a `UiAction::fields`.
    found.set(field, read());
  }
  return [...found].map(([field, value]) => ({ field, value }));
}

/// La radice dell'albero disegnato che contiene `el`.
///
/// Si sale **prima** fino al primo elemento che il renderer ha disegnato, e poi
/// fino alla cima: chi manda un'azione può stare su un pezzo di scocca che
/// questo file ha messo lì senza che sia un nodo — la linguetta di una scheda è
/// il caso —, e partire da lui dava «nessuna radice», cioè nessun campo.
function rootOf(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = el;
  while (current && !rendered.has(current)) current = current.parentElement;
  let last: HTMLElement | null = null;
  while (current && rendered.has(current)) {
    last = current;
    current = current.parentElement;
  }
  return last;
}

/// Le linguette di un gruppo di schede: le disegna la shell, perché cambiare
/// scheda è una piega — non serve un giro dal provider (§2.1).
///
/// **Si reuseno, non si rifanno.** Erano l'ultimo pezzo d'albero che non
/// passava da `children`: un `barra.replaceChildren()` a ogni riconciliazione, cioè
/// esattamente ciò che il §2.8 esiste per non fare. Chi ci stava sopra col tab
/// perdeva il fuoco a ogni ridisegno della view attorno — e siccome un ridisegno
/// arriva anche da un `IndexUpdated`, bastava salvare per far saltare via il
/// fuoco di chi stava navigando le schede.
///
/// I due pezzi della riparazione non si separano. La posizione della linguetta
/// vive nel `data-index` del bottone e si aggiorna quando il bottone viene
/// riusato; **l'azione no**, e passa da `ascolta` per la ragione della 0118:
/// una chiusura che cattura `tab` manderebbe l'azione del giro in cui è nata, e
/// finché i bottoni si ricostruivano quella chiusura era fresca per caso.
function tabHeaders(el: HTMLElement, tabs: UiNode[], onAction: Port): void {
  const bar = el.querySelector<HTMLElement>(":scope > .ui-tab-bar");
  if (!bar) return;
  bar.setAttribute("role", "tablist");
  // I pannelli, nell'ordine in cui stanno: servono a legare ogni linguetta al
  // suo (`aria-controls`) e viceversa (`aria-labelledby`). È la coppia che
  // permette a un lettore di schermo di dire «scheda 2 di 3, selezionata» e di
  // saltare direttamente al contenuto invece di leggere anche le altre.
  const panels = Array.from(
    el.querySelectorAll<HTMLElement>(":scope > .ui-children > .ui-tab"),
  );
  const existing = Array.from(bar.querySelectorAll<HTMLElement>(":scope > .ui-tab-button"));
  const usedElements = new Set<HTMLElement>();
  tabs.forEach((tab, i) => {
    if (tab.node !== "tab") return;
    const button = existing[i] ?? newItemTab(bar, el, i);
    usedElements.add(button);
    button.dataset.index = String(i);
    button.textContent = tab.label;
    const panel = panels[i];
    if (panel) {
      if (!button.id) button.id = identifier("linguetta");
      button.setAttribute("aria-controls", panel.id);
      panel.setAttribute("aria-labelledby", button.id);
    }
    // Chi ha chiesto di saperlo lo sa; chi non ha dichiarato un'azione non
    // viene disturbato per una piega — e se smette di dichiararla, `ascolta`
    // spegne la sua senza togliere l'ascoltatore.
    listen(button, "click", tab.action, onAction);
  });
  for (const button of existing) if (!usedElements.has(button)) button.remove();
  arrowsBetweenTabs(bar, el);
  markActiveTab(el);
}

/// Una linguetta nuova, con l'indice iniziale della scheda che mostra; il
/// `data-index` viene poi aggiornato se il bottone viene riusato.
function newItemTab(bar: HTMLElement, group: HTMLElement, index: number): HTMLElement {
  const button = document.createElement("button");
  button.className = "ui-tab-button";
  button.setAttribute("role", "tab");
  button.dataset.index = String(index);
  button.addEventListener("click", () => showTab(group, Number(button.dataset.index ?? "0")));
  bar.appendChild(button);
  return button;
}

/// Le frecce dentro una barra di schede: ← → per spostarsi, Home/Fine per
/// andare agli estremi.
///
/// L'ascoltatore sta sulla **barra** e non sulle linguette, e si registra una
/// volta sola: `intestazioniSchede` ridisegna i figli a ogni giro, e un
/// ascoltatore per linguetta sarebbe un ascoltatore in più a ogni ridisegno su
/// un elemento che nel frattempo è stato buttato.
function arrowsBetweenTabs(bar: HTMLElement, group: HTMLElement): void {
  if (bar.dataset.frecce === "sì") return;
  bar.dataset.frecce = "sì";
  bar.addEventListener("keydown", (e) => {
    const step =
      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? 0 : e.key === "End" ? 0 : null;
    if (step === null) return;
    const buttons = Array.from(
      bar.querySelectorAll<HTMLElement>(":scope > .ui-tab-button"),
    );
    if (buttons.length === 0) return;
    const active = Number(group.dataset.active ?? "0");
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : // Il giro si chiude: dall'ultima si torna alla prima. È ciò che
            // fa un tab widget nativo, e chi ci arriva col tasto se lo aspetta.
            (active + step + buttons.length) % buttons.length;
    e.preventDefault();
    buttons[next]?.click();
    buttons[next]?.focus();
  });
}

function showTab(el: HTMLElement, index: number): void {
  el.dataset.active = String(index);
  markActiveTab(el);
}

function markActiveTab(el: HTMLElement): void {
  const active = Number(el.dataset.active ?? "0");
  const body = el.querySelector<HTMLElement>(":scope > .ui-children");
  const buttons = el.querySelectorAll<HTMLElement>(":scope > .ui-tab-bar > .ui-tab-button");
  buttons.forEach((b, i) => {
    b.setAttribute("aria-selected", String(i === active));
    // Il tab visita **il gruppo**, non ogni linguetta: dentro ci si muove con
    // le frecce. È la convenzione dei tab widget, ed è ciò che evita che una
    // barra da otto schede diventi otto fermate prima del contenuto.
    b.tabIndex = i === active ? 0 : -1;
  });
  if (!body) return;
  Array.from(body.children).forEach((c, i) => {
    if (c instanceof HTMLElement) c.hidden = i !== active;
  });
}
