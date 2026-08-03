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
// Un riquadro tiene **N documenti con uno attivo**. Da quella forma sola escono
// insieme le tab e lo split, e il motivo per cui non si è fatto prima lo split
// (che è ciò che sblocca la §3.3) e le tab dopo è che «un riquadro = una nota»
// andrebbe buttato il giorno delle tab: la forma con le tab lo *contiene*. Non è
// più lavoro di design, è lo stesso lavoro fatto una volta invece che una volta
// e mezza.
//
// La disposizione è un **albero binario-generalizzato**: una foglia è un
// riquadro, un nodo è una divisione con un verso e N figli. Non una griglia con
// coordinate: una griglia sa dire dove sta un riquadro e non sa dire cosa
// succede quando lo si chiude, e «cosa succede quando lo si chiude» è metà del
// lavoro di un modello di layout.
//
// # Cosa **non** sta qui
//
// I workspace **salvati con un nome**. La casa è decisa — sarebbero nel vault,
// come le note e le scorciatoie (0076), perché li ha creati l'utente apposta —
// ma il formato aspetta di vedere assetti veri, e un formato indovinato prima
// del primo cliente è un formato da migrare. Ciò che sta qui è l'altra cosa, che
// **non ha un nome**: com'era aperta la finestra l'ultima volta. Quello è stato
// di vista (0037), va nel file della macchina e non viaggia col vault, perché
// dipende dal monitor che uno ha davanti.
//
// È la distinzione che la 0036 aveva scritto senza applicarla: *un'impostazione
// ha un valore alla volta, un layout ne ha uno per nome*. Il primo oggetto un
// nome non ce l'ha, quindi non è un layout in quel senso — ed è così che il
// «terzo stato senza contenitore» del §11.2 si scopre non essere terzo.
import type { PaneMode } from "../host/contract";
import { MAIN_PANE } from "../host/contract";
import { emit, leggiStato, scriviStato } from "./store";

/// Cosa tiene aperto un riquadro.
export interface PaneState {
  /// I documenti aperti, in ordine di tab. Può essere vuoto: un riquadro senza
  /// niente dentro è uno stato legittimo — è la finestra appena aperta.
  docs: string[];
  /// L'indice del documento attivo dentro `docs`, o -1 se non ce n'è.
  ///
  /// Un indice e non un path: due tab sullo **stesso** documento nello stesso
  /// riquadro non sono vietate, e con un path non si saprebbe quale delle due è
  /// davanti.
  active: number;
  /// La modalità di **questo** riquadro (FEATURES 4.1).
  ///
  /// Era una chiave sola di stato di vista, ed era giusto finché il riquadro era
  /// uno. Con N riquadri la modalità è di ciascuno, e per una ragione che si
  /// vede al primo uso: la disposizione che serve davvero è la nota di lato in
  /// Lettura e la nota che si scrive in Live Preview.
  mode: PaneMode;
}

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

export const MODALITA_DI_DEFAULT: PaneMode = "live_preview";

/// La finestra come nasce quando non c'è niente da ricordare: un riquadro, il
/// primo, senza niente dentro.
export function layoutDiDefault(mode: PaneMode = MODALITA_DI_DEFAULT): Layout {
  return {
    tree: { k: "leaf", pane: MAIN_PANE },
    panes: { [MAIN_PANE]: { docs: [], active: -1, mode } },
    focus: MAIN_PANE,
  };
}

/// Il layout corrente. Mutabile e condiviso come `state`, per la stessa ragione:
/// è ciò che la finestra *è* adesso, e ogni pannello che disegna lo legge.
export let layout: Layout = layoutDiDefault();

// --- leggere ----------------------------------------------------------------

export function panes(l: Layout = layout): string[] {
  const out: string[] = [];
  const cammina = (n: LayoutNode): void => {
    if (n.k === "leaf") out.push(n.pane);
    else n.children.forEach(cammina);
  };
  cammina(l.tree);
  return out;
}

export function pane(id: string, l: Layout = layout): PaneState | undefined {
  return l.panes[id];
}

/// Il riquadro col fuoco. Totale per costruzione: `focus` nomina sempre un
/// riquadro che c'è.
export function paneAttivo(l: Layout = layout): PaneState {
  return l.panes[l.focus];
}

/// Il documento attivo di un riquadro, se ce n'è uno.
export function docAttivo(id: string = layout.focus, l: Layout = layout): string | null {
  const p = l.panes[id];
  if (!p) return null;
  return p.active >= 0 && p.active < p.docs.length ? p.docs[p.active] : null;
}

/// In quali riquadri è aperto un documento. Serve a chi deve chiuderlo
/// dappertutto — cancellato, spostato nel cestino — e a chi deve capire se una
/// modifica riguarda qualche superficie a schermo.
export function paneConDoc(doc: string, l: Layout = layout): string[] {
  return panes(l).filter((id) => l.panes[id].docs.includes(doc));
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
export function coniaPaneId(l: Layout = layout): string {
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
export function dividi(id: string, dir: "row" | "col", l: Layout = layout): string | null {
  if (!l.panes[id]) return null;
  const nuovo = coniaPaneId(l);
  const inserito = sostituisci(l.tree, id, (foglia) => ({
    k: "split",
    dir,
    children: [foglia, { k: "leaf", pane: nuovo }],
  }));
  if (!inserito) return null;
  l.tree = appiattisci(inserito);
  l.panes[nuovo] = { docs: [], active: -1, mode: l.panes[id].mode };
  l.focus = nuovo;
  cambiato();
  return nuovo;
}

/// Chiude un riquadro. L'ultimo non si chiude: una finestra senza riquadri non è
/// uno stato che si possa disegnare, e «chiudi l'ultimo» vorrebbe dire «chiudi
/// la finestra», che è un altro comando e di un altro modulo.
export function chiudiPane(id: string, l: Layout = layout): boolean {
  if (!l.panes[id] || panes(l).length <= 1) return false;
  const potato = rimuovi(l.tree, id);
  if (!potato) return false;
  l.tree = appiattisci(potato);
  delete l.panes[id];
  if (l.focus === id) l.focus = panes(l)[0];
  cambiato();
  return true;
}

/// Sposta il fuoco. Chiamarla su un riquadro che non c'è non fa niente: è la
/// forma tollerante che serve a chi reagisce a un click su del DOM che potrebbe
/// essere stantio.
export function fuocoSu(id: string, l: Layout = layout): void {
  if (!l.panes[id] || l.focus === id) return;
  l.focus = id;
  cambiato();
}

/// Mette un documento in un riquadro e lo rende attivo.
///
/// Se il documento è già una tab di quel riquadro **non se ne apre una seconda**:
/// ci si sposta sopra. È la risposta ovvia per il gesto che la produce quasi
/// sempre — un click nell'esploratore su una nota che è già lì — e chi vuole
/// davvero due tab sulla stessa nota nello stesso riquadro lo chiederà con un
/// gesto suo, il giorno che quel gesto esista.
export function apriIn(id: string, doc: string, l: Layout = layout): void {
  const p = l.panes[id];
  if (!p) return;
  const gia = p.docs.indexOf(doc);
  p.active = gia >= 0 ? gia : p.docs.push(doc) - 1;
  l.focus = id;
  cambiato();
}

/// Toglie una tab da un riquadro.
///
/// Quale tab prende il posto di quella chiusa: **quella a sinistra**, com'è in
/// ogni editor a schede. Chiudere l'ultima tab non chiude il riquadro — un
/// riquadro vuoto è uno stato legittimo, ed è dove si finisce anche dividendone
/// uno.
export function chiudiTab(id: string, indice: number, l: Layout = layout): void {
  const p = l.panes[id];
  if (!p || indice < 0 || indice >= p.docs.length) return;
  p.docs.splice(indice, 1);
  if (p.docs.length === 0) p.active = -1;
  else if (p.active > indice) p.active -= 1;
  else if (p.active === indice) p.active = Math.max(0, indice - 1);
  cambiato();
}

/// Rende attiva una tab per indice.
export function attivaTab(id: string, indice: number, l: Layout = layout): void {
  const p = l.panes[id];
  if (!p || indice < 0 || indice >= p.docs.length) return;
  p.active = indice;
  l.focus = id;
  cambiato();
}

/// Il documento è stato rinominato: l'identità è il path (0043), quindi le tab
/// che lo mostravano seguono. Vale in **tutti** i riquadri, non solo in quello
/// col fuoco: un rename non guarda chi sta guardando.
export function rinomina(da: string, a: string, l: Layout = layout): void {
  let toccato = false;
  for (const id of panes(l)) {
    const p = l.panes[id];
    p.docs = p.docs.map((d) => {
      if (d !== da) return d;
      toccato = true;
      return a;
    });
  }
  if (toccato) cambiato();
}

/// Il documento non c'è più: via da ogni riquadro che lo teneva.
export function togliDappertutto(doc: string, l: Layout = layout): void {
  for (const id of paneConDoc(doc, l)) {
    for (let i = l.panes[id].docs.length - 1; i >= 0; i--) {
      if (l.panes[id].docs[i] === doc) chiudiTab(id, i, l);
    }
  }
}

/// Cambia la modalità di un riquadro.
export function impostaModalita(id: string, mode: PaneMode, l: Layout = layout): void {
  const p = l.panes[id];
  if (!p || p.mode === mode) return;
  p.mode = mode;
  cambiato();
}

// --- l'albero, in privato ---------------------------------------------------

/// Sostituisce la foglia di `pane` con ciò che `f` ne fa. Torna `null` se quella
/// foglia non c'è.
function sostituisci(
  n: LayoutNode,
  pane: string,
  f: (foglia: LayoutNode) => LayoutNode,
): LayoutNode | null {
  if (n.k === "leaf") return n.pane === pane ? f(n) : null;
  for (let i = 0; i < n.children.length; i++) {
    const sotto = sostituisci(n.children[i], pane, f);
    if (sotto) {
      const children = [...n.children];
      children[i] = sotto;
      return { ...n, children };
    }
  }
  return null;
}

/// Toglie la foglia di `pane`. Torna `null` se non c'è (o se è la radice, caso
/// che il chiamante ha già escluso contando i riquadri).
function rimuovi(n: LayoutNode, pane: string): LayoutNode | null {
  if (n.k === "leaf") return null;
  const children: LayoutNode[] = [];
  let trovato = false;
  for (const c of n.children) {
    if (c.k === "leaf" && c.pane === pane) {
      trovato = true;
      continue;
    }
    const sotto = rimuovi(c, pane);
    if (sotto) {
      trovato = true;
      children.push(sotto);
    } else {
      children.push(c);
    }
  }
  return trovato ? { ...n, children } : null;
}

/// Toglie dall'albero i nodi che non dividono più niente.
///
/// Una divisione con un figlio solo **non è** una divisione: è quel figlio, con
/// un livello di indirezione in mezzo che nessuno vede e che al prossimo split
/// deciderebbe il verso sbagliato. Chiudere un riquadro ne produce una ogni
/// volta, quindi si pota subito invece di insegnare a tutti i lettori a
/// ignorarla. Stessa cosa per una divisione dentro una divisione dello stesso
/// verso: sono la stessa fila.
function appiattisci(n: LayoutNode): LayoutNode {
  if (n.k === "leaf") return n;
  const children = n.children.flatMap((c) => {
    const p = appiattisci(c);
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
/// stava leggendo — e non si riscrive più. Vedi `caricaLayout`.
const MODE_KEY_LEGACY = "mode";

/// Annuncia che il layout è cambiato e lo mette da parte.
///
/// Le due cose insieme perché sono la stessa: ogni mutazione qui dentro passa da
/// un punto solo, e così «ricordarsi di salvare» non è una riga che qualcuno
/// può dimenticare in una funzione nuova. Il salvataggio non si aspetta —
/// vale la regola di `store.ts`: chi divide un riquadro non deve fermarsi per
/// una scrittura su disco.
function cambiato(): void {
  emit("layout");
  scriviStato(LAYOUT_KEY, layout);
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
export async function caricaLayout(): Promise<void> {
  const salvato = await leggiStato<unknown>(LAYOUT_KEY);
  const eredita = await leggiStato<string>(MODE_KEY_LEGACY);
  layout = parseLayout(salvato) ?? layoutDiDefault(modalitaValida(eredita));
}

function modalitaValida(v: unknown): PaneMode {
  return v === "source" || v === "reading" || v === "live_preview" ? v : MODALITA_DI_DEFAULT;
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
  const tree = parseNodo(o.tree);
  if (!tree) return null;
  const ids = new Set<string>();
  const cammina = (n: LayoutNode): boolean => {
    if (n.k === "leaf") {
      if (ids.has(n.pane)) return false; // due foglie sullo stesso riquadro
      ids.add(n.pane);
      return true;
    }
    return n.children.every(cammina);
  };
  if (!cammina(tree)) return null;
  if (typeof o.panes !== "object" || o.panes === null) return null;
  const panes: Record<string, PaneState> = {};
  for (const [id, p] of Object.entries(o.panes as Record<string, unknown>)) {
    if (!ids.has(id)) return null;
    const stato = parsePane(p);
    if (!stato) return null;
    panes[id] = stato;
  }
  if (Object.keys(panes).length !== ids.size) return null;
  const focus = typeof o.focus === "string" && ids.has(o.focus) ? o.focus : null;
  if (!focus) return null;
  return { tree, panes, focus };
}

function parseNodo(v: unknown): LayoutNode | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.k === "leaf") return typeof o.pane === "string" && o.pane ? { k: "leaf", pane: o.pane } : null;
  if (o.k !== "split") return null;
  if (o.dir !== "row" && o.dir !== "col") return null;
  if (!Array.isArray(o.children) || o.children.length < 2) return null;
  const children: LayoutNode[] = [];
  for (const c of o.children) {
    const n = parseNodo(c);
    if (!n) return null;
    children.push(n);
  }
  return { k: "split", dir: o.dir, children };
}

function parsePane(v: unknown): PaneState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.docs) || !o.docs.every((d) => typeof d === "string")) return null;
  const docs = o.docs as string[];
  const active = typeof o.active === "number" ? o.active : -1;
  return {
    docs,
    // Un indice fuori dalle tab è la forma più probabile di file rovinato a
    // mano, ed è anche l'unica che si può riparare invece di buttare tutto:
    // il riquadro c'è, le tab ci sono, non si sa quale era davanti.
    active: Number.isInteger(active) && active >= 0 && active < docs.length ? active : docs.length > 0 ? 0 : -1,
    mode: modalitaValida(o.mode),
  };
}
