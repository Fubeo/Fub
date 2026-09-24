// Il modello di layout: **quali riquadri ci sono, come sono disposti, e cosa
// ognuno tiene aperto.**
//
// È la casella che restava del §1.2, ed è una feature e non un refactor: fino a
// ieri l'area principale era un editor solo, e «un editor solo» non era una
// scelta di UI — era l'assenza di questo file. Il contratto invece i riquadri
// li prevede da sempre (`ViewContext.pane` è nominato dalla 0007), quindi qui
// non si aggiunge niente al confine: si dà un corpo a un'identità che
// attraversava già.
//
// # La forma, e perché è questa
//
// Un riquadro tiene **N linguetta con una attiva**. Da quella forma sola escono insieme
// le linguetta e lo split, e il motivo per cui non si è fatto prima lo split (che è ciò
// che sbloccava la §3.3) e le linguetta dopo è che «un riquadro = una nota» andrebbe
// buttato il giorno delle linguetta: la forma con le linguetta lo *contiene*. Non è più
// lavoro di design, è lo stesso lavoro fatto una volta invece che una volta e
// mezza.
//
// «Tab» e non «documento», e la differenza è arrivata con la §3.3
// ([0079](../../../docs/decisions/0190-sessioni-documento-e-undo.md)): una linguetta
// può essere una **view dichiarata** — il grafo — e allora quel riquadro non
// mostra nessuna nota. Vedi `Tab` qui sotto per il perché sia un tipo
// discriminato e non un path con un prefisso.
//
// La disposizione è un **albero binario-generalizzato**: una foglia è un
// riquadro, un nodo è una divisione con un verso e N figli. Non una griglia con
// coordinate: una griglia sa dire dove sta un riquadro e non sa dire cosa
// succede quando lo si chiude, e «cosa succede quando lo si chiude» è metà del
// lavoro di un modello di layout.
//
// # Cosa **non** sta qui
//
// I workspace **salvati con un nome** vivono in `state/workspaces.ts`: salvano
// copie versionate di questo albero insieme alla geometria della shell. Qui
// vive invece il layout anonimo della finestra corrente, nello stato di vista
// della macchina. La stessa regola di tab, split e focus vale per entrambi.
import { MAIN_PANE } from "../host/contract";
import { emit, readState, writeState } from "./store";

/// Cosa tiene una linguetta.
///
/// **Discriminata, e non un path con un prefisso.** La tentazione era scrivere
/// `"view:graph"` dentro l'elenco di prima e lasciare tutto com'era: costa una
/// riga, e la si paga per sempre. Un path è l'identità di un documento
/// ([0043](../../../docs/decisions/0188-identita-path-e-rename.md)) — è la chiave
/// con cui si legge dal disco, quella che il rename insegue, quella che
/// attraversa il confine dentro il `ViewContext` — e sovraccaricarla vorrebbe
/// dire che ogni suo lettore deve sapere che a volte non è un path. Sono una
/// decina di posti, e basta che uno non lo sappia perché la shell chieda al
/// kernel di leggere un documento che si chiama `view:graph`.
///
/// Così invece il compilatore chiede a chi legge di dire quale dei due casi sta
/// guardando, e `docAttivo()` resta la stessa domanda di prima con la stessa
/// risposta: un path, o niente.
export type Tab =
  /// Un documento del vault, per path.
  | { k: "doc"; doc: string; pinned?: boolean; stack?: string }
  /// Una view **dichiarata** dal backend, per id di `ViewSpec` (§3.3). Il
  /// riquadro non sa cosa disegni: la monta `ui/views.ts` come le altre.
  | { k: "view"; view: string; pinned?: boolean; stack?: string };

/// Cosa tiene aperto un riquadro.
export interface PaneState {
  /// Le linguetta aperte, in ordine. Può essere vuoto: un riquadro senza niente
  /// dentro è uno stato legittimo — è la finestra appena aperta.
  tabs: Tab[];
  /// L'indice della linguetta attiva dentro `tabs`, o -1 se non ce n'è.
  ///
  /// Un indice e non un'identità: due linguetta sullo **stesso** documento nello
  /// stesso riquadro non sono vietate, e con un path non si saprebbe quale
  /// delle due è davanti.
  active: number;
  /// La modalità interna della superficie mostrata in questo riquadro.
  ///
  /// È una stringa stabile dichiarata dalla superficie, non il `PaneMode`
  /// congelato dell'ABI. La proiezione sul vecchio contesto è responsabilità
  /// della superficie attiva.
  mode: string;
  /// Cronologia avanti/indietro di questo riquadro (P06/F21): le tab visitate.
  /// Assente = nessuna navigazione (primo avvio, riquadro nuovo, layout migrato).
  /// Sono identità di tab, non testi: il buffer resta unico nella sessione.
  history?: PaneHistory;
  /// Gruppo di riquadri collegati (P06/F21): i riquadri con lo stesso `link`
  /// non nullo seguono le aperture. Assente o null = non collegato. Persistito,
  /// senza secondo buffer: le sessioni restano uniche, le superfici N.
  link?: string | null;
}

/// Il passato e il futuro di un riquadro: chi c'era prima di quella attiva,
/// e chi c'era prima di tornare indietro. Tetto in `HISTORY_LIMIT`: una
/// cronologia illimitata è una perdita di memoria travestita da funzionalità.
export interface PaneHistory {
  past: Tab[];
  future: Tab[];
}

/// Quante tappe si ricordano per riquadro. Cinquanta coprono una sessione di
/// lavoro e stanno in un file di stato senza pesare: oltre si butta la più vecchia.
export const HISTORY_LIMIT = 50;

/// Come sono disposti i riquadri.
export type LayoutNode =
  | { k: "leaf"; pane: string }
  | { k: "split"; dir: "row" | "col"; children: LayoutNode[] };

export interface Layout {
  tree: LayoutNode;
  panes: Record<string, PaneState>;
  /// Quale riquadro ha il fuoco. È **sempre** un riquadro che esiste: è
  /// l'invariante che rende `paneAttivo()` una funzione totale, e ogni
  /// operazione qui dentro la ristabilisce prima di tornare.
  focus: string;
}

export const DEFAULT_MODE = "live_preview";

/// La finestra come nasce quando non c'è niente da ricordare: un riquadro, il
/// primo, senza niente dentro.
export function defaultLayout(mode: string = DEFAULT_MODE): Layout {
  return {
    tree: { k: "leaf", pane: MAIN_PANE },
    panes: { [MAIN_PANE]: { tabs: [], active: -1, mode } },
    focus: MAIN_PANE,
  };
}

/// Il layout corrente. Mutabile e condiviso come `state`, per la stessa ragione:
/// è ciò che la finestra *è* adesso, e ogni pannello che disegna lo legge.
export let layout: Layout = defaultLayout();

/// Sostituisce l’assetto live con uno validato (ripristino workspace, F22):
/// un annuncio solo e una scrittura sola, come `removeEverywhere`. La forma
/// è già validata da `parseLayout` a monte: qui si clona e si pubblica.
export function setLayout(next: Layout): void {
  layout = JSON.parse(JSON.stringify(next)) as Layout;
  changed();
}

// --- leggere ----------------------------------------------------------------

export function panes(l: Layout = layout): string[] {
  const out: string[] = [];
  const walk = (n: LayoutNode): void => {
    if (n.k === "leaf") out.push(n.pane);
    else n.children.forEach(walk);
  };
  walk(l.tree);
  return out;
}

export function pane(id: string, l: Layout = layout): PaneState | undefined {
  return l.panes[id];
}

/// Il riquadro col fuoco. Totale per costruzione: `focus` nomina sempre un
/// riquadro che c'è.
export function activePane(l: Layout = layout): PaneState {
  return l.panes[l.focus];
}

/// La linguetta attiva di un riquadro, se ce n'è una.
export function activeTab(id: string = layout.focus, l: Layout = layout): Tab | null {
  const p = l.panes[id];
  if (!p) return null;
  return p.active >= 0 && p.active < p.tabs.length ? p.tabs[p.active] : null;
}

/// Il documento attivo di un riquadro, se ne ha uno.
///
/// `null` adesso ha **due** significati — nessuna linguetta, o una linguetta che non è un
/// documento — e non ne servono due valori distinti: chi la chiama vuole sapere
/// quale nota mostrare, e «nessuna» è la stessa risposta in entrambi i casi. È
/// anche il motivo per cui il `ViewContext` non ha avuto bisogno di niente di
/// nuovo: `doc: null` è uno stato che il contratto esprimeva già.
export function activeDoc(id: string = layout.focus, l: Layout = layout): string | null {
  const t = activeTab(id, l);
  return t?.k === "doc" ? t.doc : null;
}

/// I documenti che un riquadro tiene aperti, in ordine di linguetta.
export function documents(p: PaneState): string[] {
  const out: string[] = [];
  for (const tab of p.tabs) {
    if (tab.k === "doc") out.push(tab.doc);
  }
  return out;
}

/// In quali riquadri è aperto un documento. Serve a chi deve chiuderlo
/// dappertutto — cancellato, spostato nel cestino — e a chi deve capire se una
/// modifica riguarda qualche superficie a schermo.
export function panesWithDoc(doc: string, l: Layout = layout): string[] {
  return panes(l).filter((id) =>
    l.panes[id].tabs.some((tab) => tab.k === "doc" && tab.doc === doc),
  );
}

// --- scrivere ---------------------------------------------------------------

/// Il nome del prossimo riquadro.
///
/// `main` resta il primo **per sempre**, e non è nostalgia: è l'id che finisce
/// nel `ViewContext` pubblicato e, di riflesso, nell'esemplare delle view
/// (0037) — cioè è già scritto in file di stato di macchina esistenti.
/// Cambiarlo vorrebbe dire buttare lo stato di vista di chiunque abbia già
/// aperto questa shell, per un nome più simmetrico.
///
/// Gli altri li conia la shell, perché è la shell a sapere quanti riquadri ci
/// sono: il kernel non tiene una mappa di riquadri e **non deve** — la domanda a
/// cui risponde («cosa sta guardando l'utente adesso») è una sola per
/// definizione, quanti che siano i riquadri.
///
/// Si prende il primo libero e non un contatore che sale: un contatore andrebbe
/// persistito insieme all'albero, e un contatore persistito che si disallinea
/// dall'albero conia un id che esiste già.
export function mintPaneId(l: Layout = layout): string {
  for (let n = 2; ; n++) {
    const id = `pane-${n}`;
    if (!l.panes[id]) return id;
  }
}

/// Divide un riquadro in due e restituisce l'id del riquadro nuovo (o `null` se
/// quel riquadro non c'è).
///
/// Il riquadro nuovo nasce **vuoto e col fuoco**: chi divide lo fa per metterci
/// qualcosa, e la modalità la eredita da chi lo ha generato perché è l'unico
/// indizio che abbiamo su cosa stia per farci.
///
/// Se il genitore è già una divisione nello stesso verso, il riquadro nuovo si
/// infila lì accanto invece di annidare una divisione dentro l'altra: tre
/// riquadri in fila sono tre figli di un nodo, non due nodi con due figli
/// ciascuno — e la differenza si vede quando se ne chiude uno.
export function split(id: string, dir: "row" | "col", l: Layout = layout): string | null {
  if (!l.panes[id]) return null;
  const newItem = mintPaneId(l);
  const inserted = replace(l.tree, id, (leaf) => ({
    k: "split",
    dir,
    children: [leaf, { k: "leaf", pane: newItem }],
  }));
  if (!inserted) return null;
  l.tree = flatten(inserted);
  l.panes[newItem] = { tabs: [], active: -1, mode: l.panes[id].mode };
  l.focus = newItem;
  changed();
  return newItem;
}

/// Chiude un riquadro. L'ultimo non si chiude: una finestra senza riquadri non è
/// uno stato che si possa disegnare, e «chiudi l'ultimo» vorrebbe dire «chiudi
/// la finestra», che è un altro comando e di un altro modulo.
export function closePane(id: string, l: Layout = layout): boolean {
  if (!l.panes[id]) return false;
  const orderedPanes = panes(l);
  if (orderedPanes.length <= 1) return false;
  const potato = removeNode(l.tree, id);
  if (!potato) return false;
  l.tree = flatten(potato);
  delete l.panes[id];
  if (l.focus === id) l.focus = orderedPanes.find((pane) => pane !== id)!;
  changed();
  return true;
}

/// Sposta il fuoco. Chiamarla su un riquadro che non c'è non fa niente: è la
/// forma tollerante che serve a chi reagisce a un click su del DOM che potrebbe
/// essere stantio.
export function focusPane(id: string, l: Layout = layout): void {
  if (!l.panes[id] || l.focus === id) return;
  l.focus = id;
  changed();
}

/// Mette un documento in un riquadro e lo rende attivo.
///
/// Se il documento è già una tab di quel riquadro **non se ne apre una seconda**:
/// ci si sposta sopra. È la risposta ovvia per il gesto che la produce quasi
/// sempre — un click nell'esploratore su una nota che è già lì — e chi vuole
/// davvero due tab sulla stessa nota nello stesso riquadro lo chiederà con un
/// gesto suo, il giorno che quel gesto esista.
export function openIn(id: string, doc: string, l: Layout = layout): void {
  openTabIn(id, { k: "doc", doc }, l);
}

/// Mette una **view dichiarata** in un riquadro e la rende attiva (§3.3).
///
/// Stessa regola del documento — se c'è già ci si sposta sopra — e per una
/// ragione più forte: due tab sullo stesso grafo sarebbero due simulazioni che
/// girano insieme sullo stesso vault, cioè il doppio del lavoro per due disegni
/// che convergono allo stesso posto.
export function openViewIn(id: string, view: string, l: Layout = layout): void {
  openTabIn(id, { k: "view", view }, l);
}

function openTabIn(id: string, tab: Tab, l: Layout): void {
  const p = l.panes[id];
  if (!p) return;
  pushHistory(p, p.active >= 0 && p.active < p.tabs.length ? p.tabs[p.active]! : null);
  const already = p.tabs.findIndex((t) => sameTab(t, tab));
  p.active = already >= 0 ? already : p.tabs.push(tab) - 1;
  l.focus = id;
  changed();
  propagateToLinked(id, tab, l);
}

/// Registra la tab che si sta lasciando nella cronologia del riquadro:
/// indietro ci si torna, avanti si azzera — una strada nuova cancella il
/// futuro, come in ogni browser. Tetto in `HISTORY_LIMIT`: oltre cade la più vecchia.
function pushHistory(p: PaneState, current: Tab | null): void {
  if (!current) return;
  if (!p.history) p.history = { past: [], future: [] };
  const past = p.history.past;
  const last = past.length > 0 ? past[past.length - 1]! : null;
  if (!last || !sameTab(last, current)) {
    past.push(current);
    if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  }
  p.history.future = [];
}

/// Le aperture seguono i riquadri collegati (P06/F21): chi apre in un riquadro
/// con un `link` apre la stessa tab negli altri riquadri con lo stesso nome,
/// senza spostare il fuoco e senza rimbalzi. Sessioni uniche, superfici N:
/// la sessione resta una, gli editor mostrano lo stesso testo.
function propagateToLinked(source: string, tab: Tab, l: Layout): void {
  const name = l.panes[source]?.link ?? null;
  if (!name) return;
  for (const id of panes(l)) {
    if (id === source) continue;
    const p = l.panes[id];
    if ((p.link ?? null) !== name) continue;
    const already = p.tabs.findIndex((t) => sameTab(t, tab));
    if (already >= 0) {
      p.active = already;
    } else {
      p.tabs.push(tab);
      p.active = p.tabs.length - 1;
    }
  }
}

/// Due tab sono la stessa cosa aperta? Serve a non aprirne una seconda, ed è
/// l'unico posto in cui le due specie si confrontano fra loro. Pin e stack
/// non fanno parte dell'identità: una nota appuntata resta quella nota.
export function sameTab(a: Tab, b: Tab): boolean {
  if (a.k === "doc" && b.k === "doc") return a.doc === b.doc;
  if (a.k === "view" && b.k === "view") return a.view === b.view;
  return false;
}

/// Ordina una tab dentro il suo riquadro: la toglie da dove sta e la rimette
/// a `to`, senza cambiare l'attiva oltre il ricalcolo. Torna `false` se gli
/// indici non reggono.
export function moveTab(id: string, from: number, to: number, l: Layout = layout): boolean {
  const p = l.panes[id];
  if (!p || from < 0 || to < 0 || from >= p.tabs.length || to >= p.tabs.length || from === to) {
    return false;
  }
  const [tab] = p.tabs.splice(from, 1);
  p.tabs.splice(to, 0, tab!);
  if (p.active === from) p.active = to;
  else if (p.active > from && p.active <= to) p.active -= 1;
  else if (p.active < from && p.active >= to) p.active += 1;
  changed();
  return true;
}

/// Sposta una tab da un riquadro a un altro (drag fra gruppi, P06/F21): la
/// toglie dalla sorgente e la mette in coda alla destinazione, rendendola
/// attiva. Le appuntate non si spostano per sbaglio: restano dov'erano.
/// Torna `false` se la tab è appuntata o gli id non reggono.
export function moveTabToPane(from: string, index: number, to: string, l: Layout = layout): boolean {
  const src = l.panes[from];
  const dst = l.panes[to];
  if (!src || !dst || from === to) return false;
  if (index < 0 || index >= src.tabs.length) return false;
  const tab = src.tabs[index]!;
  if (tab.pinned) return false;
  if (!removeTab(from, index, l)) return false;
  dst.tabs.push(tab);
  dst.active = dst.tabs.length - 1;
  l.focus = to;
  changed();
  return true;
}

/// Appunta o spunta una tab (P06/F21): le appuntate restano a sinistra e non
/// si chiudono con «chiudi le altre». Il pin non cambia l'identità.
export function setPinnedTab(id: string, index: number, pinned: boolean, l: Layout = layout): void {
  const p = l.panes[id];
  if (!p || index < 0 || index >= p.tabs.length) return;
  const tab = p.tabs[index]!;
  if ((tab.pinned === true) === pinned) return;
  p.tabs[index] = tab.k === "doc"
    ? { k: "doc", doc: tab.doc, ...(pinned ? { pinned: true } : {}), ...(tab.stack ? { stack: tab.stack } : {}) }
    : { k: "view", view: tab.view, ...(pinned ? { pinned: true } : {}), ...(tab.stack ? { stack: tab.stack } : {}) };
  changed();
}

/// Mette una tab in un gruppo (stack, P06/F21): le tab con lo stesso `stack`
/// non nullo si disegnano insieme. Nome vuoto o spazi = fuori dal gruppo.
export function setTabStack(id: string, index: number, stack: string | null, l: Layout = layout): void {
  const p = l.panes[id];
  if (!p || index < 0 || index >= p.tabs.length) return;
  const name = (stack ?? "").trim();
  const tab = p.tabs[index]!;
  const next = name === "" ? null : name;
  if ((tab.stack ?? null) === next) return;
  const base = tab.k === "doc" ? { k: "doc" as const, doc: tab.doc } : { k: "view" as const, view: tab.view };
  p.tabs[index] = {
    ...base,
    ...(tab.pinned ? { pinned: true } : {}),
    ...(next ? { stack: next } : {}),
  } as Tab;
  changed();
}

/// Collega o scollega un riquadro a un gruppo di riquadri collegati
/// (P06/F21): stesso nome = stesse aperture. Nome vuoto = scollegato.
export function setPaneLink(id: string, link: string | null, l: Layout = layout): void {
  const p = l.panes[id];
  if (!p) return;
  const trimmed = (link ?? "").trim();
  const next = trimmed === "" ? null : trimmed;
  if ((p.link ?? null) === next) return;
  p.link = next;
  changed();
}

/// Toglie una tab da un riquadro.
///
/// Quale tab prende il posto di quella chiusa: **quella a sinistra**, com'è in
/// ogni editor a schede. Chiudere l'ultima tab non chiude il riquadro — un
/// riquadro vuoto è uno stato legittimo, ed è dove si finisce anche dividendone
/// uno.
export function closeTab(id: string, index: number, l: Layout = layout): void {
  if (removeTab(id, index, l)) changed();
}

/// Toglie la tab e basta: **niente annuncio, niente scrittura**. Torna `false`
/// se non c'era niente da togliere.
///
/// Sta separata da `closeTab` per la stessa ragione per cui `rename` chiama
/// `changed()` una volta sola in fondo: chi ne chiude N di fila non deve
/// pagare N scritture su disco. La mutazione è di qui, l'annuncio è di chi ha
/// finito.
function removeTab(id: string, index: number, l: Layout): boolean {
  const p = l.panes[id];
  if (!p || index < 0 || index >= p.tabs.length) return false;
  p.tabs.splice(index, 1);
  if (p.tabs.length === 0) p.active = -1;
  else if (p.active > index) p.active -= 1;
  else if (p.active === index) p.active = Math.max(0, index - 1);
  return true;
}

/// Chiude le tab non appuntate di un riquadro (P06/F21): le appuntate restano.
/// Torna quante ne ha chiuse. Un annuncio solo, come `removeEverywhere`.
export function closeUnpinned(id: string, l: Layout = layout): number {
  const p = l.panes[id];
  if (!p) return 0;
  let closed = 0;
  for (let i = p.tabs.length - 1; i >= 0; i--) {
    if (p.tabs[i]!.pinned) continue;
    if (removeTab(id, i, l)) closed += 1;
  }
  if (closed > 0) changed();
  return closed;
}

/// Chiude le altre tab di un riquadro (P06/F21): tiene quella a `keep` e le
/// appuntate. Torna quante ne ha chiuse. Un annuncio solo.
export function closeOthers(id: string, keep: number, l: Layout = layout): number {
  const p = l.panes[id];
  if (!p || keep < 0 || keep >= p.tabs.length) return 0;
  let closed = 0;
  for (let i = p.tabs.length - 1; i >= 0; i--) {
    if (i === keep || p.tabs[i]!.pinned) continue;
    if (removeTab(id, i, l)) closed += 1;
  }
  if (closed > 0) changed();
  return closed;
}

/// Rende attiva una tab per indice. Anche il cambio tab è navigazione: la tab
/// che si lascia entra nella cronologia del riquadro, e il futuro si azzera.
export function activateTab(id: string, index: number, l: Layout = layout): void {
  const p = l.panes[id];
  if (!p || index < 0 || index >= p.tabs.length) return;
  if (p.active >= 0 && p.active < p.tabs.length && p.active !== index) {
    pushHistory(p, p.tabs[p.active]!);
  }
  p.active = index;
  l.focus = id;
  changed();
}

/// Torna indietro nella cronologia del riquadro (P06/F21): la tab attiva va
/// nel futuro, e si mostra l'ultima del passato. Torna `false` se non c'è
/// un passato — niente da fare, niente scritto.
export function goBack(id: string, l: Layout = layout): boolean {
  const p = l.panes[id];
  if (!p || !p.history || p.history.past.length === 0) return false;
  const current = p.active >= 0 && p.active < p.tabs.length ? p.tabs[p.active]! : null;
  const prev = p.history.past.pop()!;
  if (current) p.history.future.push(current);
  const at = p.tabs.findIndex((t) => sameTab(t, prev));
  if (at >= 0) {
    p.active = at;
  } else {
    p.tabs.push(prev);
    p.active = p.tabs.length - 1;
  }
  l.focus = id;
  changed();
  return true;
}

/// Va avanti nella cronologia del riquadro (P06/F21): speculare a `goBack`.
/// Torna `false` se non c'è un futuro.
export function goForward(id: string, l: Layout = layout): boolean {
  const p = l.panes[id];
  if (!p || !p.history || p.history.future.length === 0) return false;
  const current = p.active >= 0 && p.active < p.tabs.length ? p.tabs[p.active]! : null;
  const next = p.history.future.pop()!;
  if (current) {
    if (!p.history) p.history = { past: [], future: [] };
    p.history.past.push(current);
  }
  const at = p.tabs.findIndex((t) => sameTab(t, next));
  if (at >= 0) {
    p.active = at;
  } else {
    p.tabs.push(next);
    p.active = p.tabs.length - 1;
  }
  l.focus = id;
  changed();
  return true;
}

/// Il documento è stato rinominato: l'identità è il path (0043), quindi le tab
/// che lo mostravano seguono. Vale in **tutti** i riquadri, non solo in quello
/// col fuoco: un rename non guarda chi sta guardando. Pin, stack e cronologia
/// seguono l'identità: una tab appuntata rinominata resta appuntata.
export function rename(from: string, a: string, l: Layout = layout): void {
  let wasTouched = false;
  const renamed = (t: Tab): Tab =>
    t.k === "doc" && t.doc === from
      ? { k: "doc", doc: a, ...(t.pinned ? { pinned: true } : {}), ...(t.stack ? { stack: t.stack } : {}) }
      : t;
  for (const id of panes(l)) {
    const p = l.panes[id];
    p.tabs = p.tabs.map((t) => {
      const next = renamed(t);
      if (next !== t) wasTouched = true;
      return next;
    });
    if (p.history) {
      p.history = {
        past: p.history.past.map(renamed),
        future: p.history.future.map(renamed),
      };
    }
  }
  if (wasTouched) changed();
}

/// Il documento non c'è più: via da ogni riquadro che lo teneva.
///
/// **Un annuncio solo, e quindi una scrittura sola.** Ogni `changed()` è un
/// `set_view_state`, cioè un `fsync` dall'altra parte dell'IPC: chiudere una
/// nota aperta in cinque riquadri ne costava cinque, per cinque stati
/// intermedi che nessuno ha chiesto di vedere e che nessuno può leggere —
/// `writeState` non si aspetta, quindi non è nemmeno vero che le cinque
/// scritture lascino cinque stati coerenti sul disco: partono tutte insieme e
/// vince l'ultima. È la stessa forma di `rename`, qui sopra.
export function removeEverywhere(doc: string, l: Layout = layout): void {
  let wasTouched = false;
  for (const id of panesWithDoc(doc, l)) {
    const tabs = l.panes[id].tabs;
    for (let i = tabs.length - 1; i >= 0; i--) {
      const t = tabs[i];
      if (t.k === "doc" && t.doc === doc) wasTouched = removeTab(id, i, l) || wasTouched;
    }
  }
  for (const id of panes(l)) {
    const p = l.panes[id];
    if (!p.history) continue;
    const past = p.history.past.filter((t) => !(t.k === "doc" && t.doc === doc));
    const future = p.history.future.filter((t) => !(t.k === "doc" && t.doc === doc));
    if (past.length !== p.history.past.length || future.length !== p.history.future.length) {
      p.history = { past, future };
    }
  }
  if (wasTouched) changed();
}

/// Cambia la modalità di un riquadro.
export function setMode(id: string, mode: string, l: Layout = layout): void {
  const p = l.panes[id];
  if (!p || p.mode === mode) return;
  p.mode = mode;
  changed();
}

// --- l'albero, in privato ---------------------------------------------------

/// Sostituisce la foglia di `pane` con ciò che `f` ne fa. Torna `null` se quella
/// foglia non c'è.
function replace(
  n: LayoutNode,
  pane: string,
  f: (leaf: LayoutNode) => LayoutNode,
): LayoutNode | null {
  if (n.k === "leaf") return n.pane === pane ? f(n) : null;
  for (let i = 0; i < n.children.length; i++) {
    const below = replace(n.children[i], pane, f);
    if (below) {
      const children = [...n.children];
      children[i] = below;
      return { ...n, children };
    }
  }
  return null;
}

/// Toglie la foglia di `pane`. Torna `null` se non c'è (o se è la radice, caso
/// che il chiamante ha già escluso contando i riquadri).
function removeNode(n: LayoutNode, pane: string): LayoutNode | null {
  if (n.k === "leaf") return null;
  const children: LayoutNode[] = [];
  let found = false;
  for (const c of n.children) {
    if (c.k === "leaf" && c.pane === pane) {
      found = true;
      continue;
    }
    const below = removeNode(c, pane);
    if (below) {
      found = true;
      children.push(below);
    } else {
      children.push(c);
    }
  }
  return found ? { ...n, children } : null;
}

/// Toglie dall'albero i nodi che non dividono più niente.
///
/// Una divisione con un figlio solo **non è** una divisione: è quel figlio, con
/// un livello di indirezione in mezzo che nessuno vede e che al prossimo split
/// deciderebbe il verso sbagliato. Chiudere un riquadro ne produce una ogni
/// volta, quindi si pota subito invece di insegnare a tutti i lettori a
/// ignorarla. Stessa cosa per una divisione dentro una divisione dello stesso
/// verso: sono la stessa fila.
function flatten(n: LayoutNode): LayoutNode {
  if (n.k === "leaf") return n;
  const children = n.children.flatMap((c) => {
    const p = flatten(c);
    return p.k === "split" && p.dir === n.dir ? p.children : [p];
  });
  return children.length === 1 ? children[0] : { ...n, children };
}

// --- ricordare --------------------------------------------------------------
//
// La chiave dello stato di vista in cui la finestra si ricorda com'era. Il
// vault non entra nella chiave: lo mette lo store da sé (0037).

const LAYOUT_KEY = "layout";
/// La chiave di prima, quando la modalità era una sola per tutto il vault.
/// Si legge ancora — una volta, per non far ripartire in Live Preview chi
/// stava leggendo — e non si riscrive più. Vedi `loadLayout`.
const MODE_KEY_LEGACY = "mode";

/// Annuncia che il layout è cambiato e lo mette da parte.
///
/// Le due cose insieme perché sono la stessa: ogni mutazione qui dentro passa da
/// un punto solo, e così «ricordarsi di salvare» non è una riga che qualcuno
/// può dimenticare in una funzione nuova. Il salvataggio non si aspetta —
/// vale la regola di `store.ts`: chi divide un riquadro non deve fermarsi per
/// una scrittura su disco.
function changed(): void {
  emit("layout");
  writeState(LAYOUT_KEY, layout);
}

/// Rilegge la finestra com'era, e **la migrazione della modalità**.
///
/// Assente non è un errore: è il primo avvio, e si riparte dal default. Un
/// valore che non regge la forma vale come nessun valore, per la stessa ragione
/// per cui `loadMode` rifiutava una modalità inventata: il file lo si apre con
/// un editor di testo, e una shell che parte in uno stato che non esiste è
/// peggio di una shell che parte pulita.
///
/// La migrazione è piccola ma vera, e va detta: fino a ieri la modalità era la
/// chiave `mode`, una per vault. Adesso è dentro ogni riquadro. Chi apre la
/// prima volta dopo l'aggiornamento non ha un `layout` da leggere ma ha un
/// `mode`, e quello diventa la modalità del primo riquadro. Da lì in poi `mode`
/// non si riscrive più e resta lì finché non se ne va da sé: **non lo
/// cancelliamo**, perché una versione precedente della shell riaperta sullo
/// stesso vault lo ritroverebbe, e una migrazione che rompe il ritorno indietro
/// costa più di una chiave morta in un file di cache.
/// Le due chiavi si chiedono **insieme**: la vecchia non dipende dalla nuova, e
/// in fila costavano due andate e ritorno sull'IPC a ogni apertura di vault per
/// leggere due valori che nessuno lega. Le domande restano due — la vecchia
/// chiave si chiedeva già sempre, anche quando il layout c'era — ma l'attesa
/// diventa una.
export async function loadLayout(): Promise<void> {
  const [saved, inheritedMode] = await Promise.all([
    readState<unknown>(LAYOUT_KEY),
    readState<string>(MODE_KEY_LEGACY),
  ]);
  layout = parseLayout(saved) ?? defaultLayout(validMode(inheritedMode));
}

function validMode(v: unknown): string {
  return typeof v === "string" && v.trim() !== "" ? v : DEFAULT_MODE;
}

/// Da JSON a `Layout`, o `null` se ciò che c'è scritto non è un layout.
///
/// Severa apposta, e su tutto: un albero che nomina un riquadro che non sta
/// nella mappa, o una mappa con un riquadro che non sta nell'albero, o un fuoco
/// che nomina il nulla, sono tutte finestre che non si possono disegnare. Il
/// controllo sta qui, in un punto solo, così le funzioni sopra possono
/// permettersi di dare per buone le loro invarianti.
export function parseLayout(v: unknown): Layout | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const tree = parseNode(o.tree);
  if (!tree) return null;
  const ids = new Set<string>();
  const walk = (n: LayoutNode): boolean => {
    if (n.k === "leaf") {
      if (ids.has(n.pane)) return false; // due foglie sullo stesso riquadro
      ids.add(n.pane);
      return true;
    }
    return n.children.every(walk);
  };
  if (!walk(tree)) return null;
  if (typeof o.panes !== "object" || o.panes === null) return null;
  const panes: Record<string, PaneState> = {};
  for (const [id, p] of Object.entries(o.panes as Record<string, unknown>)) {
    if (!ids.has(id)) return null;
    const state = parsePane(p);
    if (!state) return null;
    panes[id] = state;
  }
  if (Object.keys(panes).length !== ids.size) return null;
  const focus = typeof o.focus === "string" && ids.has(o.focus) ? o.focus : null;
  if (!focus) return null;
  return { tree, panes, focus };
}

function parseNode(v: unknown): LayoutNode | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.k === "leaf") return typeof o.pane === "string" && o.pane ? { k: "leaf", pane: o.pane } : null;
  if (o.k !== "split") return null;
  if (o.dir !== "row" && o.dir !== "col") return null;
  if (!Array.isArray(o.children) || o.children.length < 2) return null;
  const children: LayoutNode[] = [];
  for (const c of o.children) {
    const n = parseNode(c);
    if (!n) return null;
    children.push(n);
  }
  return { k: "split", dir: o.dir, children };
}

/// Da JSON a `PaneState`, **leggendo anche la forma di prima**.
///
/// Fino alla §3.3 un riquadro teneva `docs: string[]`, cioè solo documenti. La
/// forma nuova è `tabs`, e la vecchia si legge ancora: una stringa nell'elenco
/// **è** una tab di documento, quindi la conversione è totale e nessuno perde le
/// note che aveva aperte. Non si riscrive `docs` accanto a `tabs`, ed è la
/// differenza con la migrazione della modalità qui sopra: `mode` restava
/// leggibile perché il suo valore restava vero, mentre un `docs` scritto accanto
/// a una tab di grafo sarebbe una bugia — l'elenco non conterrebbe quella tab, e
/// una shell precedente riaprirebbe la finestra senza dire che le manca
/// qualcosa. Chi torna indietro riparte dal default, che è rumoroso quanto basta
/// e non mente.
function parsePane(v: unknown): PaneState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const rawTabs = Array.isArray(o.tabs) ? o.tabs : Array.isArray(o.docs) ? o.docs : null;
  if (!rawTabs) return null;
  const tabs: Tab[] = [];
  for (const t of rawTabs) {
    const tab = parseTab(t);
    if (!tab) return null;
    tabs.push(tab);
  }
  const active = typeof o.active === "number" ? o.active : -1;
  const history = parseHistory(o.history);
  if (o.history !== undefined && !history) return null;
  // Assente o nullo = non collegato (la forma che si scrive); un nome non
  // vuoto = gruppo collegato; qualunque altra cosa è file rovinato, come
  // una tab rotta. Una stringa di soli spazi vale come assente.
  let link: string | undefined;
  if (o.link === undefined || o.link === null) link = undefined;
  else if (typeof o.link === "string" && o.link.trim() !== "") link = o.link.trim();
  else if (typeof o.link === "string") return null;
  else return null;
  return {
    tabs,
    // Un indice fuori dalle tab è la forma più probabile di file rovinato a
    // mano, ed è anche l'unica che si può riparare invece di buttare tutto:
    // il riquadro c'è, le tab ci sono, non si sa quale era davanti.
    active: Number.isInteger(active) && active >= 0 && active < tabs.length ? active : tabs.length > 0 ? 0 : -1,
    mode: validMode(o.mode),
    ...(history ? { history } : {}),
    ...(typeof link === "string" ? { link } : {}),
  };
}

/// Da JSON a cronologia di riquadro: due elenchi di tab, o niente. Severa
/// come il resto del parser — una tappa rotta vale come file rovinato —
/// con una sola clemenza: assente non è un errore, è un layout scritto
/// prima della cronologia. Liste troppo lunghe si potano al tetto invece
/// di buttare tutto: il riquadro c'è, le tab ci sono, la memoria è troppa.
function parseHistory(v: unknown): PaneHistory | null {
  if (v === undefined) return null;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.past) || !Array.isArray(o.future)) return null;
  const past: Tab[] = [];
  for (const t of o.past) {
    const tab = parseTab(t);
    if (!tab) return null;
    past.push(tab);
  }
  const future: Tab[] = [];
  for (const t of o.future) {
    const tab = parseTab(t);
    if (!tab) return null;
    future.push(tab);
  }
  return {
    past: past.slice(-HISTORY_LIMIT),
    future: future.slice(-HISTORY_LIMIT),
  };
}

/// Una tab, nella forma nuova o in quella di prima.
///
/// Severa come tutto il resto di questo parser, e con due clemenze: una
/// **stringa** è un documento, che è ciò che c'era scritto fino a ieri; un
/// oggetto senza pin/stack è una tab non appuntata fuori dai gruppi, che è
/// ciò che c'era scritto prima del pin. Pin e stack rotti — non booleani,
/// non stringhe — valgono come file rovinato, non come «non appuntata».
function parseTab(v: unknown): Tab | null {
  if (typeof v === "string") return v ? { k: "doc", doc: v } : null;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const pinned = o.pinned === undefined
    ? {}
    : o.pinned === true
      ? { pinned: true }
      : o.pinned === false
        ? {}
        : null;
  if (!pinned) return null;
  const stack = o.stack === undefined
    ? {}
    : typeof o.stack === "string" && o.stack.trim() !== ""
      ? { stack: o.stack.trim() }
      : null;
  if (!stack) return null;
  if (o.k === "doc") {
    return typeof o.doc === "string" && o.doc ? { k: "doc", doc: o.doc, ...pinned, ...stack } : null;
  }
  if (o.k === "view") {
    return typeof o.view === "string" && o.view ? { k: "view", view: o.view, ...pinned, ...stack } : null;
  }
  return null;
}
