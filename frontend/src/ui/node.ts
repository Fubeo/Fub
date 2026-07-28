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
import type { ActionRef, FieldValue, UiNode, UiValue } from "../host/contract";
import { setSanitizedHtml } from "./sanitize";
import { attivabile, identificatore, nonAttivabile } from "./a11y";
import { t } from "../i18n/strings";

/// Cosa fa la shell quando un'azione scatta: la manda al provider con le due
/// metà — il payload che il provider aveva attaccato al nodo, e i campi che
/// l'utente ha compilato.
export type ActionHandler = (action: ActionRef, fields: FieldValue[]) => void | Promise<void>;

/// Ciò che la shell ricorda di un elemento che ha disegnato: il nodo da cui
/// viene (per il confronto al giro dopo) e, se è un campo, come si legge il suo
/// valore adesso.
interface Reso {
  node: UiNode;
  leggi?: () => UiValue;
}

const resi = new WeakMap<HTMLElement, Reso>();

/// L'albero attualmente montato in un contenitore, per il confronto.
const montati = new WeakMap<HTMLElement, HTMLElement>();

// ---------------------------------------------------------------------------
// Montaggio e riconciliazione
// ---------------------------------------------------------------------------

/// Monta (o aggiorna) l'albero di una view dentro `container`.
///
/// La prima volta disegna; dalla seconda **riconcilia**. Il chiamante non deve
/// sapere quale delle due sta succedendo: è la stessa chiamata, ed è ciò che
/// impedisce che qualcuno "ottimizzi" ricostruendo.
export function mountTree(container: HTMLElement, node: UiNode, onAction: ActionHandler): void {
  const precedente = montati.get(container);
  if (precedente && precedente.parentElement === container) {
    const aggiornato = riconcilia(precedente, node, onAction);
    montati.set(container, aggiornato);
    return;
  }
  container.replaceChildren();
  const el = renderUiNode(node, onAction);
  container.appendChild(el);
  montati.set(container, el);
}

/// Rimpiazza il solo nodo con questa chiave (`ViewUpdate::Patch`).
///
/// Torna `false` se la chiave non c'è: **non è un errore** — è una view
/// cambiata sotto — e chi chiama ridisegna intero.
export function patchTree(container: HTMLElement, key: string, node: UiNode): boolean {
  const radice = montati.get(container);
  if (!radice) return false;
  const bersaglio = trovaPerChiave(radice, key);
  if (!bersaglio) return false;
  const onAction = handlerDi(bersaglio);
  if (!onAction) return false;
  const aggiornato = riconcilia(bersaglio, node, onAction);
  if (bersaglio === radice) montati.set(container, aggiornato);
  return true;
}

/// Dimentica ciò che è montato qui: il prossimo giro ridisegna da zero.
export function unmountTree(container: HTMLElement): void {
  montati.delete(container);
  container.replaceChildren();
}

/// L'handler di un sottoalbero, per il patch: sta sull'elemento perché un patch
/// arriva senza il contesto del render che lo ha creato.
const handlers = new WeakMap<HTMLElement, ActionHandler>();

function handlerDi(el: HTMLElement): ActionHandler | undefined {
  let corrente: HTMLElement | null = el;
  while (corrente) {
    const h = handlers.get(corrente);
    if (h) return h;
    corrente = corrente.parentElement;
  }
  return undefined;
}

function trovaPerChiave(radice: HTMLElement, key: string): HTMLElement | null {
  if (resi.get(radice)?.node.key === key) return radice;
  return radice.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
}

/// Aggiorna `el` perché mostri `next`, o lo sostituisce se non è possibile.
/// Restituisce l'elemento che ora rappresenta il nodo (lo stesso, o il nuovo).
function riconcilia(el: HTMLElement, next: UiNode, onAction: ActionHandler): HTMLElement {
  const prev = resi.get(el)?.node;
  if (!prev || prev.node !== next.node) {
    const nuovo = renderUiNode(next, onAction);
    el.replaceWith(nuovo);
    return nuovo;
  }
  if (aggiorna(el, prev, next, onAction)) {
    resi.set(el, { ...resi.get(el)!, node: next });
    chiave(el, next);
    return el;
  }
  const nuovo = renderUiNode(next, onAction);
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
  onAction: ActionHandler,
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
        riga.classList.toggle("selected", next.selected);
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
    case "custom":
      if (prev.node !== "custom" || prev.ns !== next.ns) return false;
      figli(el, next.fallback, onAction);
      return true;
    case "text_input":
    case "text_area":
    case "date_picker":
    case "number":
    case "slider": {
      const campo = el.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
      if (!campo) return false;
      const valore =
        next.node === "number" || next.node === "slider"
          ? next.value === null
            ? ""
            : String(next.value)
          : (next.value ?? "");
      // Chi sta scrivendo ha ragione: il valore del provider non gli si
      // sovrascrive sotto le dita. Lo vedrà al prossimo giro, quando avrà
      // smesso — e intanto l'azione gli manda ciò che c'è davvero.
      if (document.activeElement !== campo && campo.value !== valore) campo.value = valore;
      etichetta(el, "label" in next ? next.label : null);
      return true;
    }
    case "checkbox": {
      if (prev.node !== "checkbox") return false;
      const campo = el.querySelector<HTMLInputElement>("input");
      if (!campo) return false;
      if (document.activeElement !== campo) campo.checked = next.value;
      const testo = el.querySelector<HTMLElement>(".ui-field-label");
      if (testo) testo.textContent = next.label;
      return true;
    }
    case "select": {
      if (prev.node !== "select") return false;
      const campo = el.querySelector<HTMLSelectElement>("select");
      if (!campo || prev.options.length !== next.options.length) return false;
      if (prev.options.some((o, i) => o.value !== next.options[i]!.value)) return false;
      if (document.activeElement !== campo) {
        for (const opt of Array.from(campo.options)) {
          opt.selected = next.value.includes(opt.value);
        }
      }
      etichetta(el, next.label);
      return true;
    }
    case "radio": {
      if (prev.node !== "radio") return false;
      if (prev.options.length !== next.options.length) return false;
      const scelte = el.querySelectorAll<HTMLInputElement>("input[type=radio]");
      if (scelte.length !== next.options.length) return false;
      scelte.forEach((input, i) => {
        input.checked = next.options[i]!.value === next.value;
      });
      etichetta(el, next.label);
      return true;
    }
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
function figli(parent: HTMLElement, nodi: UiNode[], onAction: ActionHandler): void {
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
    if (!usati.has(el)) el.remove();
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

export function renderUiNode(node: UiNode, onAction: ActionHandler): HTMLElement {
  const el = disegna(node, onAction);
  resi.set(el, { ...(resi.get(el) ?? {}), node });
  handlers.set(el, onAction);
  chiave(el, node);
  return el;
}

function chiave(el: HTMLElement, node: UiNode): void {
  if (node.key !== undefined) el.dataset.key = node.key;
  else delete el.dataset.key;
}

function disegna(node: UiNode, onAction: ActionHandler): HTMLElement {
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
      el.classList.toggle("selected", node.selected);
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
      riga.classList.toggle("selected", node.selected);
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
    case "text_input":
      return campoTestuale(node.field, node.label, node.value, node.placeholder, "text", node.action, onAction);
    case "date_picker":
      return campoTestuale(node.field, node.label, node.value ?? "", null, "date", node.action, onAction);
    case "text_area": {
      const el = campo("ui-text-area", node.label);
      const area = document.createElement("textarea");
      area.dataset.field = node.field;
      area.rows = node.rows;
      area.value = node.value;
      valore(el, () => ({ type: "text", value: area.value }));
      scatta(area, node.action, onAction, "change");
      el.appendChild(area);
      return campoConNome(el, node.field);
    }
    case "number":
    case "slider": {
      const el = campo(node.node === "slider" ? "ui-slider" : "ui-number", node.label);
      const input = document.createElement("input");
      input.type = node.node === "slider" ? "range" : "number";
      input.dataset.field = node.field;
      if (node.min !== null) input.min = String(node.min);
      if (node.max !== null) input.max = String(node.max);
      if (node.step !== null) input.step = String(node.step);
      if (node.value !== null) input.value = String(node.value);
      valore(el, () => ({ type: "number", value: Number(input.value) }));
      scatta(input, node.action, onAction, "change");
      el.appendChild(input);
      return campoConNome(el, node.field);
    }
    case "checkbox": {
      const el = document.createElement("label");
      el.className = "ui-checkbox";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.field = node.field;
      input.checked = node.value;
      const testo = document.createElement("span");
      testo.className = "ui-field-label";
      testo.textContent = node.label;
      el.append(input, testo);
      valore(el, () => ({ type: "bool", value: input.checked }));
      scatta(input, node.action, onAction, "change");
      return campoConNome(el, node.field);
    }
    case "select": {
      const el = campo("ui-select", node.label);
      const select = document.createElement("select");
      select.dataset.field = node.field;
      select.multiple = node.multiple;
      for (const opzione of node.options) {
        const opt = document.createElement("option");
        opt.value = opzione.value;
        opt.textContent = opzione.label;
        opt.selected = node.value.includes(opzione.value);
        select.appendChild(opt);
      }
      valore(el, () => {
        const scelte = Array.from(select.selectedOptions).map((o) => o.value);
        return node.multiple
          ? { type: "choices", value: scelte }
          : { type: "text", value: scelte[0] ?? "" };
      });
      scatta(select, node.action, onAction, "change");
      el.appendChild(select);
      return campoConNome(el, node.field);
    }
    case "radio": {
      const el = campo("ui-radio", node.label);
      // Il nome del gruppo rende esclusive le scelte anche quando due `radio`
      // dello stesso campo finiscono in due punti dell'albero.
      const gruppo = `radio-${node.field}`;
      let scelto = node.value ?? "";
      for (const opzione of node.options) {
        const riga = document.createElement("label");
        riga.className = "ui-radio-option";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = gruppo;
        input.value = opzione.value;
        input.checked = opzione.value === node.value;
        input.addEventListener("change", () => {
          scelto = input.value;
        });
        const testo = document.createElement("span");
        testo.textContent = opzione.label;
        riga.append(input, testo);
        scatta(input, node.action, onAction, "change");
        el.appendChild(riga);
      }
      valore(el, () => ({
        type: "text",
        value:
          el.querySelector<HTMLInputElement>("input[type=radio]:checked")?.value ?? scelto,
      }));
      return campoConNome(el, node.field);
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
      // Questa shell non conosce nessun `ns`, quindi disegna il fallback — che
      // è ciò che il contratto chiede a chi non lo conosce. Il ramo che manca
      // non è una svista: arriverà col suo primo cliente, cioè il giorno che il
      // grafo smetterà di essere un pannello nativo e diventerà un provider
      // sulla superficie principale.
      const el = div("ui-custom");
      el.dataset.ns = node.ns;
      for (const child of node.fallback) el.appendChild(renderUiNode(child, onAction));
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

/// Il contenitore di un campo, con la sua etichetta.
///
/// L'etichetta era un `<div>`, e questa è la riga più costosa di tutta la
/// passata: un `<div>` accanto a un `<input>` è testo che *sembra* un'etichetta
/// ma non lo è per nessuno tranne che per chi guarda. Un lettore di schermo che
/// arriva su quel campo annuncia «casella di testo», e basta — il nome del
/// campo lo ha letto un attimo prima, come frase sciolta, senza modo di
/// collegarlo. Adesso è un `<label>` vero, e `campoConNome` lo lega al
/// controllo che gli sta dentro.
function campo(className: string, label: string | null): HTMLElement {
  const el = div(className);
  if (label) {
    const testo = document.createElement("label");
    testo.className = "ui-field-label";
    testo.textContent = label;
    el.appendChild(testo);
  }
  return el;
}

function etichetta(el: HTMLElement, label: string | null): void {
  const esistente = el.querySelector<HTMLElement>(":scope > .ui-field-label");
  if (label && esistente) esistente.textContent = label;
}

function campoTestuale(
  field: string,
  label: string | null,
  value: string,
  placeholder: string | null,
  type: "text" | "date",
  action: ActionRef | null,
  onAction: ActionHandler,
): HTMLElement {
  const el = campo(type === "date" ? "ui-date-picker" : "ui-text-input", label);
  const input = document.createElement("input");
  input.type = type;
  input.dataset.field = field;
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  valore(el, () => ({ type: "text", value: input.value }));
  scatta(input, action, onAction, "change");
  // Invio = «ho finito»: senza, un campo di ricerca costringerebbe a uscirne
  // per essere ascoltato.
  if (action) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void invia(input, action, onAction);
      }
    });
  }
  el.appendChild(input);
  return campoConNome(el, field);
}

function campoConNome(el: HTMLElement, field: string): HTMLElement {
  el.dataset.campo = field;
  legaEtichetta(el, field);
  return el;
}

/// Lega l'etichetta di un campo al controllo che nomina.
///
/// Passa da qui **ogni** campo del protocollo, che è il motivo per cui sta qui
/// e non in sei posti: `campoConNome` è l'ultima cosa che ogni ramo dei campi
/// chiama prima di restituire, quindi è l'unico punto in cui il controllo
/// esiste già e l'etichetta pure.
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
  if (!visibile) {
    if (radio) {
      el.setAttribute("role", "radiogroup");
      el.setAttribute("aria-label", field);
      return;
    }
    el.querySelector<HTMLElement>("input, textarea, select")?.setAttribute("aria-label", field);
    return;
  }

  const etichetta = el.querySelector<HTMLLabelElement>(":scope > label.ui-field-label");
  if (!etichetta || etichetta.htmlFor) return;
  const controllo = el.querySelector<HTMLElement>("input, textarea, select");
  if (!controllo) return;
  // Il nome va al **gruppo**, che è ciò che `radiogroup` esiste per rendere
  // nominabile.
  if (radio) {
    if (!etichetta.id) etichetta.id = identificatore("gruppo");
    el.setAttribute("role", "radiogroup");
    el.setAttribute("aria-labelledby", etichetta.id);
    return;
  }
  if (!controllo.id) controllo.id = identificatore("campo");
  etichetta.htmlFor = controllo.id;
}

/// Registra come si legge il valore di questo campo, adesso.
function valore(el: HTMLElement, leggi: () => UiValue): void {
  resi.set(el, { ...(resi.get(el) ?? { node: { node: "separator" } as UiNode }), leggi });
}

/// Un'azione su un elemento cliccabile.
function collega(el: HTMLElement, action: ActionRef | null, onAction: ActionHandler): void {
  const precedente = azioni.get(el);
  if (precedente) el.removeEventListener("click", precedente);
  if (!action) {
    el.classList.remove("clickable");
    // Non basta togliere il click: se questo elemento era attivabile e viene
    // riusato dal riconciliatore (§2.8) per un nodo senza azione, resterebbe
    // nel giro del tab senza fare niente.
    nonAttivabile(el);
    azioni.delete(el);
    return;
  }
  el.classList.add("clickable");
  // Cliccabile e attivabile sono la stessa cosa, e da qui in poi lo sono per
  // costruzione: passa di qui **ogni** azione di **ogni** nodo dichiarativo,
  // quindi anche quelli dei pannelli che non sono ancora stati scritti.
  attivabile(el);
  const handler = (e: Event) => {
    e.preventDefault();
    void invia(el, action, onAction);
  };
  el.addEventListener("click", handler);
  azioni.set(el, handler);
}

const azioni = new WeakMap<HTMLElement, EventListener>();

/// Un'azione che scatta al cambio di un campo (`change`), invece che al click.
function scatta(
  el: HTMLElement,
  action: ActionRef | null,
  onAction: ActionHandler,
  evento: string,
): void {
  if (!action) return;
  el.addEventListener(evento, () => void invia(el, action, onAction));
}

/// Manda l'azione col suo payload e con i campi **in vigore**: quelli del form
/// che la contiene, o quelli dell'albero intero fuori da un form.
async function invia(da: HTMLElement, action: ActionRef, onAction: ActionHandler): Promise<void> {
  await onAction(action, campiInVigore(da));
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

function radiceDi(el: HTMLElement): HTMLElement | null {
  let corrente: HTMLElement | null = el;
  let ultimo: HTMLElement | null = null;
  while (corrente && resi.has(corrente)) {
    ultimo = corrente;
    corrente = corrente.parentElement;
  }
  return ultimo;
}

/// Le linguette di un gruppo di schede: le disegna la shell, perché cambiare
/// scheda è una piega — non serve un giro dal provider (§2.1).
function intestazioniSchede(el: HTMLElement, tabs: UiNode[], onAction: ActionHandler): void {
  const barra = el.querySelector<HTMLElement>(":scope > .ui-tab-bar");
  if (!barra) return;
  barra.replaceChildren();
  barra.setAttribute("role", "tablist");
  // I pannelli, nell'ordine in cui stanno: servono a legare ogni linguetta al
  // suo (`aria-controls`) e viceversa (`aria-labelledby`). È la coppia che
  // permette a un lettore di schermo di dire «scheda 2 di 3, selezionata» e di
  // saltare direttamente al contenuto invece di leggere anche le altre.
  const pannelli = Array.from(
    el.querySelectorAll<HTMLElement>(":scope > .ui-children > .ui-tab"),
  );
  tabs.forEach((tab, i) => {
    if (tab.node !== "tab") return;
    const bottone = document.createElement("button");
    bottone.className = "ui-tab-button";
    bottone.textContent = tab.label;
    bottone.setAttribute("role", "tab");
    const pannello = pannelli[i];
    if (pannello) {
      const idLinguetta = identificatore("linguetta");
      bottone.id = idLinguetta;
      bottone.setAttribute("aria-controls", pannello.id);
      pannello.setAttribute("aria-labelledby", idLinguetta);
    }
    bottone.addEventListener("click", () => {
      mostraScheda(el, i);
      // Chi ha chiesto di saperlo lo sa; chi non ha dichiarato un'azione non
      // viene disturbato per una piega.
      if (tab.action) void onAction(tab.action, campiInVigore(el));
    });
    barra.appendChild(bottone);
  });
  frecceFraSchede(barra, el);
  segnaSchedaAttiva(el);
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
    b.classList.toggle("selected", i === attiva);
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
