// Il gestore del documento: il disegno dei riquadri (la coda, le linguette,
// i titoli, `show`), e la firma dell'albero.

import { readsSyntaxForms } from "../editors/core/bootstrap";
import { uisForFile } from "../editors/core/component-surfaces";
import { componentsReady } from "./components";
import { type EditorSurface, type SourceView, type SurfaceOverride, type SurfaceRequest } from "../editors/core/registry";
import { Queue } from "../ui/race";
import { type SyntaxForm } from "../host/contract";
import { emit, state } from "./store";
import { clearAllRemovedNotices } from "./sheet-notices";
import { syntaxForms } from "../host/query";
import { documentSessions, isDocumentDeletedDuringRead, type DocumentSurfaceSource } from "./document-session";
import {
  closeTab,
  closeOthers,
  closeUnpinned,
  activeDoc,
  layout,
  pane as paneState,
  panesWithDoc,
  panes as layoutPanes,
  sameTab,
  sameOverride,
  setTabOverride,
  tabOverride,
  activeTab,
  type Tab,
} from "./layout";
import { openVaultRoot } from "./vault";
import { mountViewInPane, unmountViewFromPane, primaryView } from "../ui/views";
import { Pane, panes, view, surfaceRegistry } from "./document-controller-state";
import { notePeek } from "./document-controller-ports";
import { linkScrolls } from "./document-controller-commands";
import {
  mountDocumentAttachments,
  refreshNoteClasses,
  handledByVault,
  applyComponentEditors,
  showFileOnly,
  forgetFailedRead,
  showSurfaceError,
  attachSurface,
  detachSurface,
  destroySurface,
  parkSurface,
  unparkSurface,
  restoreRenameCaret,
  takeParked,
  pruneParked,
  dropParked,
  destroyParked,
  readBuffer,
} from "./document-controller-surfaces";
import { takeOpeningPage, takeGesture } from "./document-controller-open";
import { theme, selectedMode, markMode, publishContext, writingModes } from "./document-controller-modes";
import { releaseTab, withdrawStateNotices, heldReadOnly } from "./document-controller-save";

/// Nome breve della tab + stato testuale: non solo colore (U21).
/// View: titolo dichiarato, mai finto file.
export function describeTab(tab: Tab): { label: string; dirty: boolean; kind: "doc" | "view" } {
  if (tab.k === "view") return { label: nameTab(tab), dirty: false, kind: "view" };
  return { label: nameTab(tab), dirty: documentSessions.isDirty(tab.doc), kind: "doc" };
}

/// La firma dell'albero disegnato adesso. Ricostruire la struttura del DOM a
/// ogni segnale sarebbe corretto e sbagliato: sposta i nodi degli editor, che
/// per CodeMirror vuol dire perdere il fuoco a ogni click su una linguetta.
let treeSignature = "";

// --- disegnare i riquadri ---------------------------------------------------

/// I disegni in coda, uno dopo l'altro.
///
/// Serve perché ci si arriva da due strade che partono insieme: chi muta il
/// layout fa scattare il segnale, e chi lo ha mutato aspetta anche il proprio
/// `sincronizza()`. Senza coda le due si sovrappongono, e la seconda torna
/// **prima** che la prima abbia finito di caricare l'editor — cioè si
/// pubblicherebbe il contesto di un buffer che non c'è ancora. Accodare invece
/// di saltare il secondo giro: chi aspetta deve aspettare il disegno che
/// comprende la sua mutazione, non uno qualunque.
const drawQueue = new Queue();
/// Il giro di `synchronize` accodato e non ancora partito, se c'è.
let waitingRender: Promise<void> | null = null;

/// Porta il DOM in accordo col layout: la struttura, le linguetta, i documenti
/// caricati, la modalità, il fuoco.
///
/// È l'unico punto che disegna, ed è il motivo per cui tutto il resto di questo
/// file può limitarsi a mutare il layout e non pensarci più — la stessa forma
/// con cui `ui/panel-host.ts` ha tolto ai pannelli il «quando ridisegnarsi».
///
/// Un giro accodato e **non ancora partito** comprende ogni mutazione arrivata
/// prima che parta: chi chiede di sincronizzare in quel tempo aspetta quello,
/// invece di accodarne un secondo identico. È il caso di ogni apertura: la
/// mutazione del layout fa scattare il segnale, e `openDocument` chiede subito
/// il proprio giro; due giri di fila rifacevano linguette, barra e
/// scorrimento della striscia sopra l'editor appena montato, con un layout
/// forzato in più a ogni cambio di nota. Un giro già partito non si fonde:
/// potrebbe aver già letto lo stato che la mutazione nuova cambia.
export function synchronize(): Promise<void> {
  if (waitingRender) return waitingRender;
  const mine: Promise<void> = drawQueue.enqueue(() => {
    if (waitingRender === mine) waitingRender = null;
    return render();
  });
  waitingRender = mine;
  return mine;
}

/// Accoda un lavoro di disegno che non è un giro di `synchronize`. Un giro che
/// aspettava resta davanti a lui, quindi da qui in poi non comprende più ciò
/// che arriva: chi sincronizza dopo ne accoda uno nuovo, dietro questo lavoro.
export function enqueueDraw<T>(job: () => Promise<T>): Promise<T> {
  waitingRender = null;
  return drawQueue.enqueue(job);
}

/// Smonta ogni riquadro e chiude ogni sessione prima di un vault nuovo.
///
/// Le sessioni sono indicizzate per path, e due vault hanno spesso le stesse
/// note (`Benvenuto.md`): senza questo passo il vault nuovo riusava buffer,
/// superficie e coda di salvataggio del vecchio. Chi chiama ha già svuotato
/// la coda di salvataggio; ciò che resta sporco viene restituito.
export function resetDocumentsForVault(): Promise<string[]> {
  return enqueueDraw(async () => {
    clearAllRemovedNotices();
    // La sbirciata è del vault di prima: si chiude senza domande, chi chiama
    // raccoglie ciò che resta sporco.
    notePeek?.dismiss({ quiet: true });
    for (const [id, r] of panes) {
      if (r.shown?.k === "view") unmountViewFromPane(r.shown.view, id);
      detachSurface(r);
      destroySurface(r);
      dropParked(r);
      view.removePane(r);
    }
    panes.clear();
    writingModes.clear();
    treeSignature = "";
    return documentSessions.closeAll();
  });
}

export async function render(): Promise<void> {
  // La mappa dei componenti si legge insieme al resto, non in coda: un file
  // di un componente la aspetta (`show`), una nota no.
  if (openVaultRoot() !== undefined) void componentsReady().catch((error: unknown) => console.error(error));
  const held = focusInPanes();
  buildStructure();
  const active = activeDoc();
  let failure: { error: unknown } | null = null;
  for (const id of layoutPanes()) {
    const r = panes.get(id);
    const p = paneState(id);
    if (!r || !p) continue;
    pruneParked(r, p.tabs);
    view.drawTabs(r, p.tabs, p.active);
    view.drawFocus(r, id === layout.focus);
    // Un riquadro che non riesce a mostrare la sua tab non ferma gli altri:
    // senza, un documento rotto nel primo lasciava il secondo col contenuto
    // vecchio e `currentDoc` sbagliato. L'errore si riporta a cose fatte.
    try {
      await show(r, activeTab(id));
    } catch (error) {
      failure ??= { error };
    }
    // Il cursore di una rinomina vale per il montaggio del nome nuovo e basta:
    // resta solo se questo giro non l'ha ancora visto (un giro partito prima
    // della rinomina).
    const caret = r.renameCaret;
    if (caret && !(activeDoc(id) === caret.doc && r.shown?.k === "doc" && r.shown.doc !== caret.doc)) r.renameCaret = null;
    markMode(r, selectedMode(r)?.id ?? null);
    view.drawToolbar(r);
    const shownDoc = activeDoc(id);
    // A schermo la fascia o la barra dicono il cambio da fuori: l'avviso a
    // galla, detto quando la nota non si vedeva, ha finito il suo lavoro.
    if (shownDoc) withdrawStateNotices(shownDoc, "outside");
    view.drawConflict(r, shownDoc);
  }
  view.drawSave();
  linkScrolls();
  keepFocusInPanes(held);
  if (state.currentDoc !== active) {
    state.currentDoc = active;
    emit("active-doc", active);
    // Il kernel segue la nota a fuoco. Senza, il contesto resta quello di prima
    // e le view che seguono il documento (Struttura, Collegamenti, Statistiche)
    // mostrano i dati di una nota chiusa o della precedente (IMP-107). Il giro
    // è finito e il testo della nota è già caricato (`show` aspetta il buffer),
    // come quando `openDocument` pubblica dopo il suo `synchronize`.
    void publishContext();
  }
  if (failure) throw failure.error;
}

/// L'elemento col fuoco, se sta dentro un riquadro.
function focusInPanes(): HTMLElement | null {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) return null;
  for (const r of panes.values()) if (r.root.contains(focused)) return focused;
  return null;
}

/// Un giro di disegno non lascia il fuoco sul `body` (IMP-011, Ctrl+\).
///
/// Il giro toglie o sposta ciò che aveva il fuoco: la superficie della scheda
/// chiusa con la ×, l'editor che una divisione riappende in un contenitore
/// nuovo (staccare un nodo dal documento gli toglie il fuoco anche se torna
/// subito). Se il fuoco era in un riquadro e il giro lo ha fatto cadere, torna
/// nel riquadro col fuoco: all'elemento di prima se è ancora lì e si vede,
/// altrimenti all'editor (alla linguetta attiva in Lettura e nelle viste, al
/// riquadro se è vuoto). Un fuoco che intanto è andato altrove (il lanciatore,
/// un dialogo, l'albero) non si tocca. Il divisore mosso con le frecce lo
/// tiene la vista (`layoutTree`).
function keepFocusInPanes(held: HTMLElement | null): void {
  if (!held) return;
  const now = document.activeElement;
  if (now instanceof HTMLElement && now !== document.body && now.isConnected && !now.closest("[hidden]")) return;
  const r = panes.get(layout.focus);
  if (!r) return;
  if (held.isConnected && r.root.contains(held) && !held.closest("[hidden]")) {
    held.focus({ preventScroll: true });
    return;
  }
  focusPaneSurface(r);
}

/// Il fuoco nella superficie che il riquadro mostra: il testo col suo cursore,
/// il foglio di un disegno, la pagina in Lettura — ciò che la superficie
/// chiama il suo `focus`. Se la superficie non lo prende (non ne ha, si sta
/// ancora caricando, lo mette in una parte che non si vede) va sulla linguetta
/// attiva, e in un riquadro vuoto sul riquadro: mai sul `body`.
function focusPaneSurface(r: Pane): void {
  if (r.surface?.focus) {
    r.surface.focus();
    if (focusedVisiblyIn(r.root)) return;
  }
  const active = paneState(r.id)?.active ?? -1;
  if (active >= 0) view.focusTab(r, active);
  else r.root.focus({ preventScroll: true });
}

/// Il fuoco è in `root`, su un elemento che si vede.
export function focusedVisiblyIn(root: HTMLElement): boolean {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && root.contains(focused) && focused.closest("[hidden]") === null;
}

/// Un cambio di scheda chiesto con un comando — un tasto globale, la palette,
/// il menu — porta il fuoco nella superficie della scheda che diventa attiva,
/// a giro di disegno finito (IMP-048…051, Ctrl+\). È la regola di tutti i
/// comandi che cambiano la scheda attiva, e sta qui e non in ognuno.
///
/// Un clic su una linguetta non passa di qui: lascia il fuoco sulla linguetta,
/// da cui le frecce della striscia continuano. Un fuoco che intanto è andato
/// altrove fuori dai riquadri (un dialogo, il lanciatore) non si tocca; quello
/// rimasto dov'era quando il comando è partito (l'albero, una linguetta), o
/// caduto sul `body`, sì: chi ha cambiato scheda con un tasto scrive lì.
export function focusShownAfter(drawn: Promise<void>, origin: Element | null = document.activeElement): Promise<void> {
  return drawn.finally(() => {
    const now = document.activeElement;
    const fallen = !(now instanceof HTMLElement) || now === document.body || !now.isConnected
      || now.closest("[hidden]") !== null;
    const inPanes = now instanceof HTMLElement && [...panes.values()].some((r) => r.root.contains(now));
    if (!fallen && !inPanes && now !== origin) return;
    const r = panes.get(layout.focus);
    if (r) focusPaneSurface(r);
  });
}

/// Ricostruisce l'albero di contenitori, ma **solo se è cambiato**.
///
/// I nodi dei riquadri si riusano e si riappendono: un editor CodeMirror
/// ricostruito a ogni click perderebbe cronologia, cursore e fuoco, e la
/// perdita si vedrebbe solo usando l'app — che è il modo più caro per accorgersi
/// di una cosa.
function buildStructure(): void {
  const signature = JSON.stringify(layout.tree);
  if (signature === treeSignature) return;
  treeSignature = signature;
  const live = new Set(layoutPanes());
  for (const [id, r] of panes) {
    if (!live.has(id)) {
      // **Prima** la vista, poi il nodo. Staccare la radice dal documento non
      // smonta un `EditorView`: i suoi osservatori e i suoi ascoltatori restano,
      // perché guardano il proprio DOM e la finestra e non sanno niente di chi
      // sta sopra. Finché qui c'era il solo `remove()`, ogni divisione chiusa ne
      // lasciava indietro uno vivo — e la mappa era l'unico riferimento che lo
      // teneva, quindi spariva anche il modo di accorgersene.
      if (r.shown?.k === "view") unmountViewFromPane(r.shown.view, id);
      // Prima la registrazione, poi il nodo: un disposer rimasto appeso è un
      // abbonamento a una sessione che il riquadro non mostra più.
      detachSurface(r);
      destroySurface(r);
      dropParked(r);
      // La sbirciata sopra questo riquadro se ne va con lui.
      if (notePeek?.isIn(r.root)) notePeek.dismiss();
      view.releaseFrame(r);
      view.removePane(r);
      panes.delete(id);
      writingModes.delete(id);
    }
  }
  view.layoutTree(layout.tree);
}

/// Il riquadro con questo id, creandolo se è nuovo.
export function renderPane(id: string): Pane {
  const already = panes.get(id);
  if (already) return already;

  const { root, editorEl, viewEl } = view.createPane(id);
  const r: Pane = {
    id,
    root,
    editorEl,
    viewEl,
    disposeAttachments: null,
    disposeRecorder: null,
    disposeSlides: null,
    disposePrint: null,
    noteClassGeneration: 0,
    surface: null,
    shown: null,
    loadGeneration: 0,
    disposeSurface: null,
    sourceView: null,
    bytes: false,
    parked: [],
    renameCaret: null,
  };
  panes.set(id, r);
  return r;
}

/// Chiude una tab per indice, come la ×: rilascia ciò che teneva.
export async function closeTabAt(paneId: string, index: number): Promise<void> {
  const tab = paneState(paneId)?.tabs[index] ?? null;
  closeTab(paneId, index);
  await releaseTab(paneId, tab);
  await synchronize();
}

/// Chiude le tab a destra di `index` (le appuntate restano).
export async function closeRightAndRelease(paneId: string, index: number): Promise<void> {
  const tabs = paneState(paneId)?.tabs ?? [];
  const victims: Tab[] = [];
  for (let i = tabs.length - 1; i > index; i--) {
    if (tabs[i]!.pinned) continue;
    victims.push(tabs[i]!);
    closeTab(paneId, i);
  }
  for (const tab of victims) await releaseTab(paneId, tab);
  await synchronize();
}

/// Chiude le altre tab tenendo quella a `keep` e le appuntate, rilasciando
/// sessioni e view come `closeCurrentTab`: un flush per documento, mai un
/// buffer perso — la sessione chiude solo quando nessuno la guarda più.
export async function closeOthersAndRelease(paneId: string, keep: number): Promise<void> {
  const tabs = paneState(paneId)?.tabs ?? [];
  const victims = tabs.filter((tab, index) => index !== keep && !tab.pinned);
  closeOthers(paneId, keep);
  for (const tab of victims) await releaseTab(paneId, tab);
  await synchronize();
}

/// Chiude le non appuntate di un riquadro, rilasciando come sopra.
export async function closeUnpinnedAndRelease(paneId: string): Promise<void> {
  const tabs = paneState(paneId)?.tabs ?? [];
  const victims = tabs.filter((tab) => !tab.pinned);
  closeUnpinned(paneId);
  for (const tab of victims) await releaseTab(paneId, tab);
  await synchronize();
}

/// Chiude tutte le tab di un riquadro, anche le appuntate: chi lo chiede dal
/// menu della scheda le ha nominate tutte.
export async function closeAllAndRelease(paneId: string): Promise<void> {
  const tabs = paneState(paneId)?.tabs ?? [];
  const victims = [...tabs];
  for (let i = tabs.length - 1; i >= 0; i--) closeTab(paneId, i);
  for (const tab of victims) await releaseTab(paneId, tab);
  await synchronize();
}

export function redrawTabs(doc: string): void {
  for (const paneId of panesWithDoc(doc)) {
    const r = panes.get(paneId);
    const p = paneState(paneId);
    if (r && p) view.drawTabs(r, p.tabs, p.active);
  }
}

/// Come si chiama una tab.
///
/// Per un documento è il nome della nota; per una view è il **titolo che la view
/// dichiara**, già risolto nella lingua dell'utente dal kernel (0040). Se quella
/// view non è (più) dichiarata — un bundle spento fra due avvii, con la tab
/// rimasta nel file della macchina — resta il suo id: è brutto e non mente, che
/// è l'ordine giusto delle due cose.
export function nameTab(tab: Tab): string {
  if (tab.k !== "doc") return primaryView(tab.view)?.title ?? tab.view;
  const title = docTitle(tab.doc);
  // Due note omonime aperte in due cartelle: la tab dice anche la cartella,
  // o le due tab si leggono uguali.
  const twin = layoutPanes().some((id) => paneState(id)?.tabs.some((other) =>
    other.k === "doc" && other.doc !== tab.doc && docTitle(other.doc) === title));
  if (!twin) return title;
  const folder = tab.doc.includes("/") ? tab.doc.slice(0, tab.doc.lastIndexOf("/")).split("/").pop()! : "/";
  return `${title} · ${folder}`;
}

/// Il nome di una nota come si legge su una tab: l'ultimo pezzo del path, senza
/// estensione. Il path intero resta nel `title`, perché due note omonime in due
/// cartelle sono il caso in cui la tab da sola non basta.
export function docTitle(doc: string): string {
  const base = doc.split("/").pop() ?? doc;
  const point = base.lastIndexOf(".");
  return point > 0 ? base.slice(0, point) : base;
}

/// Mette in un riquadro ciò che la sua tab attiva dice, se non c'è già.
///
/// Le due specie di tab accendono due superfici diverse dello stesso riquadro, e
/// il ramo che le distingue sta **qui e basta**: da `render` in giù nessuno sa
/// che esistano due specie, e chi cambia tab non deve dire quale.
///
/// Lo stesso documento con un'altra superficie scelta (la vista sorgente
/// aperta o chiusa) è un cambio come un altro, e passa dalla stessa via: si
/// smonta la superficie e se ne monta un'altra sulla stessa sessione, che
/// tiene testo, modifiche non salvate e bozza; la lettura non torna al disco.
export async function show(r: Pane, tab: Tab | null): Promise<void> {
  const generation = ++r.loadGeneration;
  const changed = !r.shown || !tab || !sameTab(r.shown, tab)
    || !sameOverride(tabOverride(r.shown), tabOverride(tab));
  // Una view che se ne va porta con sé il suo pannello: senza, resterebbe
  // registrata a ridisegnarsi dentro un elemento che nessuno guarda.
  if (changed && r.shown?.k === "view") unmountViewFromPane(r.shown.view, r.id);
  // Sessione e superficie hanno ownership separate, ma terminano nello stesso
  // cambio di tab: prima si interrompe il flusso, poi si smonta l'istanza. Una
  // superficie di testo di una scheda che resta aperta va invece da parte
  // (`parkSurface`), staccata allo stesso modo.
  if (changed && !parkSurface(r)) {
    detachSurface(r);
    destroySurface(r);
  }
  if (changed) {
    r.sourceView = null;
    r.bytes = false;
  }
  r.shown = tab;
  view.drawViewSurface(r, tab?.k === "view");
  // La linguetta è già della scheda nuova (`render` l'ha disegnata prima di
  // chiamare qui): la testata la segue subito, senza aspettare che l'editor
  // si carichi. Il ridisegno dopo `show` aggiunge ciò che dipende da lui.
  if (changed) view.drawToolbar(r);

  if (tab?.k === "view") {
    await mountViewInPane(tab.view, r.id, r.viewEl, tab.params ?? null);
    return;
  }
  if (!changed) return;
  if (!tab) {
    return;
  }
  const gesture = takeGesture(r.id, tab.doc);
  const page = takeOpeningPage(r.id, tab.doc);
  // La scheda era già aperta: la sua superficie torna com'era. Un'apertura con
  // un gesto o una pagina chiede invece il montaggio che nasce da lei, e la
  // superficie da parte si smonta.
  const parked = takeParked(r, tab);
  if (parked && (gesture || page !== null)) destroyParked(parked);
  else if (parked && unparkSurface(r, tab, parked)) return;

  // Un file di un componente (una lavagna, un PDF, un documento di Word)
  // aspetta di sapere se il componente è acceso, invece di indovinare. Spento,
  // il file si mostra «solo come file»: i file non si toccano.
  const needs = uisForFile(tab.doc);
  if (needs.length) {
    const current = await componentsReady();
    if (generation !== r.loadGeneration || r.shown !== tab) return;
    const off = current ? needs.find((ui) => !current.uiOn(ui)) : undefined;
    if (current && off !== undefined) {
      showFileOnly(r, tab.doc, current, off);
      return;
    }
    applyComponentEditors(current);
  }

  // Un file che nessun formato del vault gestisce e che il registro sa
  // mostrare dai byte (un'immagine, un PDF) non ha una sorgente UTF-8: la
  // superficie dei byte possiede soltanto il suo prestito della risorsa, e la
  // sessione di testo resta dei documenti di testo. Un formato del vault per
  // la stessa estensione passa invece dal descrittore, come ogni documento.
  if (showsFromBytes(tab.doc)) {
    r.bytes = true;
    // Dai byte non c'è un testo da guardare come sorgente: una scelta rimasta
    // sulla scheda (uno stato scritto a mano, un file cambiato di natura) si
    // scarta, e il visualizzatore si monta come sempre.
    tab = forgetOverride(r, tab);
    const bytes = { formatId: null, sourceKind: "bytes", documentId: tab.doc } as const;
    if (!surfaceRegistry.isLoaded(bytes)) {
      try {
        await surfaceRegistry.load(bytes);
      } catch (error) {
        if (generation !== r.loadGeneration || r.shown !== tab) return;
        showSurfaceError(r, tab.doc, error);
        forgetFailedRead(r);
        return;
      }
      if (generation !== r.loadGeneration || r.shown !== tab) return;
    }
    const surface = surfaceRegistry.mount(bytes, {
      paneId: r.id,
      documentId: tab.doc,
      parent: r.editorEl,
      ...(gesture ? { gesture } : {}),
      ...(page !== null ? { page } : {}),
    });
    r.surface = surface;
    surface.setMode("view");
    markMode(r, "view");
    if (theme) surface.setTheme?.(theme);
    restoreRenameCaret(r, tab.doc);
    return;
  }

  let source: DocumentSurfaceSource;
  let forms: SyntaxForm[];
  try {
    // Le forme sintattiche servono soltanto a un editor che le legge: per un
    // foglio di Excel la domanda al kernel non parte (`readsSyntaxForms`).
    // Una scelta di superficie (la vista sorgente) le chiede comunque.
    [source, forms] = await Promise.all([
      readBuffer(tab.doc),
      tab.override || readsSyntaxForms(tab.doc) ? syntaxForms(tab.doc) : Promise.resolve([]),
    ]);
  } catch (error) {
    if (isDocumentDeletedDuringRead(error)) return;
    if (generation !== r.loadGeneration || r.shown !== tab) return;
    showSurfaceError(r, tab.doc, error);
    forgetFailedRead(r);
    return;
  }
  if (generation !== r.loadGeneration || r.shown !== tab) return;

  const request = { formatId: source.formatId, sourceKind: source.sourceKind, documentId: tab.doc };
  // La vista sorgente si conosce da qui, e resta anche se la superficie poi
  // non si monta: davanti a una tela rotta, aprirne il testo è la riparazione.
  r.sourceView = surfaceRegistry.sourceView(request);
  // Una scelta vale finché la superficie del documento la offre e il registro
  // la risolve a quella stessa vista. Altrimenti — il profilo che la offriva
  // non c'è più, il documento rinominato è di un'altra specie, il file di
  // stato dice altro — si scarta e il documento si apre come senza: mai la
  // superficie d'errore per una preferenza di vista.
  if (tab.override && !resolvesToSourceView(request, tab.override, r.sourceView)) {
    tab = forgetOverride(r, tab);
  }
  const chosen = { ...request, ...(tab.override ? { override: tab.override } : {}) };
  // Il codice di un editor di un componente arriva adesso, la prima volta.
  if (!surfaceRegistry.isLoaded(chosen)) {
    try {
      await surfaceRegistry.load(chosen);
    } catch (error) {
      if (generation !== r.loadGeneration || r.shown !== tab) return;
      showSurfaceError(r, tab.doc, error);
      forgetFailedRead(r);
      return;
    }
    if (generation !== r.loadGeneration || r.shown !== tab) return;
  }
  // Durante le attese un altro riquadro può aver cambiato la sessione, e
  // la sottoscrizione non riporta ciò che è passato prima di lei: il testo da
  // montare si prende adesso, senza attese fino a `attachSurface`.
  const text = documentSessions.text(tab.doc) ?? source.text;

  let surface: EditorSurface;
  try {
    surface = surfaceRegistry.mount(
      chosen,
      {
        paneId: r.id,
        documentId: tab.doc,
        parent: r.editorEl,
        formatId: source.formatId,
        revision: source.revision,
        ...(gesture ? { gesture } : {}),
        ...(page !== null ? { page } : {}),
      },
    );
  } catch (error) {
    r.editorEl.replaceChildren();
    showSurfaceError(r, tab.doc, error);
    return;
  }
  r.surface = surface;
  const mode = selectedMode(r);
  if (!mode) {
    destroySurface(r);
    showSurfaceError(r, tab.doc, new Error(`surface ${surface.surfaceId} declares no modes`));
    return;
  }
  surface.setMode(mode.id);
  markMode(r, mode.id);
  if (theme) surface.setTheme?.(theme);
  surface.setSyntaxForms?.(forms);
  try {
    surface.buffer?.setDoc(text);
  } catch (error) {
    destroySurface(r);
    showSurfaceError(r, tab.doc, error);
    return;
  }
  surface.setReadOnly?.(heldReadOnly(tab.doc));
  // Il contenuto è a posto: da qui la sessione può raggiungere questo
  // riquadro come superficie, finché non mostra altro.
  attachSurface(r, tab.doc);
  refreshNoteClasses(r, tab.doc);
  mountDocumentAttachments(r, tab.doc);
  restoreRenameCaret(r, tab.doc);
}

/// La scelta di una scheda porta davvero alla vista sorgente che la superficie
/// del documento dichiara: confrontata **risolta**, così una scelta senza
/// profilo vale quanto quella col profilo predefinito scritto per esteso.
function resolvesToSourceView(
  request: SurfaceRequest,
  override: SurfaceOverride,
  view: SourceView | null,
): boolean {
  if (!view) return false;
  const resolved = surfaceRegistry.resolve({ ...request, override });
  return resolved?.family === view.family && resolved.profile === view.profile;
}

/// Toglie da una scheda una scelta di superficie che non vale più, e torna la
/// scheda che il riquadro mostra adesso. La prende come mostrata: il giro di
/// disegno che l'annuncio del layout provoca la trova già a posto e non
/// rimonta niente. Se il layout ha già sostituito la scheda durante la lettura
/// (un pin, un rename), questo giro monta senza scelta e il prossimo ritrova
/// la scheda nuova, la confronta e la pulisce lui.
function forgetOverride(r: Pane, tab: Extract<Tab, { k: "doc" }>): Extract<Tab, { k: "doc" }> {
  if (!tab.override) return tab;
  const p = paneState(r.id);
  const index = p ? p.tabs.indexOf(tab) : -1;
  if (index >= 0) setTabOverride(r.id, index, null);
  const current = index >= 0 ? p?.tabs[index] : undefined;
  const next: Extract<Tab, { k: "doc" }> = current?.k === "doc" && !current.override
    ? current
    : { k: "doc", doc: tab.doc, ...(tab.pinned ? { pinned: true } : {}), ...(tab.stack ? { stack: tab.stack } : {}) };
  r.shown = next;
  return next;
}

/// Il documento si monta dai byte: nessun formato del vault lo gestisce, e il
/// registro sa mostrarlo così. Per un RAW la risposta dipende dall'elenco dei
/// comandi (`craft.preview`), che può cambiare con il riquadro già montato.
export function showsFromBytes(doc: string): boolean {
  return !handledByVault(doc) && surfaceRegistry.showsBytes(doc);
}
