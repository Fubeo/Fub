// I riquadri dell'area principale: editor, linguette, modalità e contesto.
//
// La sessione di un documento non è una superficie. `state/document-session.ts`
// possiede il testo autorevole, la base della scrittura, il dirty, la coda, i
// debounce e il lifecycle; questo modulo possiede soltanto ciò che è a schermo.
// Due riquadri possono quindi mostrare la stessa sessione senza duplicare testo
// o salvataggi, mentre ciascun editor conserva la propria history.
//
// Qui restano:
//   - layout, tab, focus, modalità e struttura DOM;
//   - il collegamento tra editor e sessione, inclusa la validazione delle
//     operazioni stantie;
//   - il disegno delle superfici e la pubblicazione del contesto.
//
// Il documento vive nella sessione finché il servizio lo tiene aperto. Quando
// l'ultima linguetta lo lascia, il servizio esegue il flush e chiude la sessione.
//
// La superficie pubblica di questo modulo continua a rispondere alle domande
// della shell — «apri», «è aperto», «chiudi», «metti in salvo» — senza esporre
// lo stato mutabile della sessione ai suoi clienti.
import type { EditorChange } from "../editors/text/engine";
import {
  createDocumentSurfaceRegistry,
  isMarkdownSurface,
} from "../editors/core/bootstrap";
import type {
  DocumentSurfaceRegistry,
  EditorSurface,
  SurfaceMode,
} from "../editors/core/registry";
import { Queue } from "../ui/race";
import type { Theme } from "../theme/theme";
import { api } from "../host/ipc";
import { WITHOUT_PAGE, notesByName, resolvedReference, vaultTags } from "../host/query";
import type { PaneMode, SelectionSet, SyntaxForm, ViewContext } from "../host/contract";
import { existingRecentNotes } from "../state/recent";
import { onEvent } from "../state/kernel";
import { emit, on, state } from "../state/store";
import { CASE_KEY, caseOf, toRecover } from "../state/drafts";
import { syntaxForms, unsavedDrafts } from "../host/query";
import type { DraftInfo } from "../host/contract";
import {
  documentSessions,
  isDocumentDeletedDuringRead,
  type DocumentSessionEvent,
  type DocumentSurfaceUpdate,
  type ExternalChangeResult,
  type DocumentSurfaceSource,
} from "../state/document-session";
import {
  openIn,
  activateTab,
  closePane,
  closeTab,
  split,
  activeDoc,
  documents,
  focusPane,
  setMode as setPaneMode,
  layout,
  pane as paneState,
  activePane,
  panesWithDoc,
  panes as layoutPanes,
  rename,
  sameTab,
  activeTab,
  removeEverywhere,
  type LayoutNode,
  type Tab,
} from "../state/layout";
import { createNote } from "../state/vault";
import { $ } from "../ui/dom";
import { showContextMenu } from "../ui/menu";
import { confirm } from "../host/dialog";
import { allCommands, registerShellCommand } from "../ui/commands";
import { notify } from "../ui/notify";
import { clearPreview, markReadingVersion, sourceBlockAt, updatePreview } from "./preview";
import { mountViewInPane, unmountViewFromPane, primaryView } from "../ui/views";
import { errorText } from "../host/errors";
import { onLanguage, t } from "../i18n/strings";
import type { Lifetime } from "../ui/lifetime";
import { setTooltip } from "../ui/tooltip";

export interface DocumentDeps {
  /// Click su un `#tag` nella vivi preview. Iniettato invece che importato:
  /// il pannello della ricerca apre i documenti, e questo li possiede — se si
  /// importassero a vicenda sarebbe un ciclo.
  searchTag(tag: string): void;
}

/// Un riquadro **a schermo**: la sua parte di DOM, il suo editor, e quale
/// documento l'editor sta effettivamente mostrando.
///
/// `mostrato` non è ridondante con lo stato del layout: è ciò che c'è *adesso*
/// nell'editor, e serve a sapere quando caricare — senza, ogni giro di disegno
/// riscriverebbe il documento nell'editor e porterebbe via cursore e
/// cronologia.
interface Pane {
  id: string;
  root: HTMLElement;
  tabsShell: HTMLElement;
  tabsEl: HTMLElement;
  contentEl: HTMLElement;
  tabMenuEl: HTMLButtonElement;
  toolbarEl: HTMLElement;
  conflictEl: HTMLElement;
  editorEl: HTMLElement;
  previewEl: HTMLElement;
  /// Dove finisce una view dichiarata che questo riquadro sta ospitando (§3.3).
  /// Vuoto quasi sempre: è la terza superficie di un riquadro, accanto
  /// all'editor e alla lettura, e come loro c'è anche quando non si vede.
  viewEl: HTMLElement;
  surface: EditorSurface | null;
  /// Cosa c'è **adesso** in questo riquadro. Una linguetta e non un path: dalla §3.3
  /// può essere una view, e sapere quale evita di rimontarla a ogni giro.
  shown: Tab | null;
  loadGeneration: number;
  /// Firma dell'ultima striscia disegnata: un cambio di riquadro non deve
  /// ricreare tab identiche e togliere il fuoco al loro nodo DOM.
  tabsSignature: string | null;
  /// Il disposer della registrazione di questo riquadro alla sessione del
  /// documento mostrato. Null finché il documento mostrato non c'è.
  disposeSurface: (() => void) | null;
}
/// Nome breve della tab + stato testuale: non solo colore (U21).
/// View: titolo dichiarato, mai finto file.
export function describeTab(tab: Tab): { label: string; dirty: boolean; kind: "doc" | "view" } {
  if (tab.k === "view") return { label: nameTab(tab), dirty: false, kind: "view" };
  return { label: nameTab(tab), dirty: documentSessions.isDirty(tab.doc), kind: "doc" };
}
const panes = new Map<string, Pane>();
let panesEl: HTMLElement;
let sessionEventsStop: (() => void) | undefined;
let deps: DocumentDeps;
let surfaceRegistry: DocumentSurfaceRegistry;
let theme: Theme | null = null;

/// La firma dell'albero disegnato adesso. Ricostruire la struttura del DOM a
/// ogni segnale sarebbe corretto e sbagliato: sposta i nodi degli editor, che
/// per CodeMirror vuol dire perdere il fuoco a ogni click su una linguetta.
let treeSignature = "";

/// Pubblicazione del contesto: la selezione si muove a ogni tasto, il kernel
/// non deve saperlo a ogni tasto.
let contextTimer: number | undefined;

// --- montaggio --------------------------------------------------------------

/// Costruisce l'area principale e attacca i riquadri agli eventi che li
/// riguardano.
export function mountDocument(lifetime: Lifetime, d: DocumentDeps): void {
  deps = d;
  surfaceRegistry = createDocumentSurfaceRegistry({
    onChange: written,
    onSelectionChange: (paneId) => {
      if (layout.focus === paneId) scheduleContext();
    },
    onOpenWikilink: (page, heading, block) =>
      void openWikilink(page, heading ?? undefined, block ?? undefined),
    onSearchTag: (tag) => deps.searchTag(tag),
    completions: {
      searchNotes: (prefix: string) =>
        (prefix.trim() ? notesByName(prefix) : existingRecentNotes()).catch(() => []),
      listTags: () => vaultTags(WITHOUT_PAGE).catch(() => []),
    },
    gridHost: api,
  });
  panesEl = $("#panes");
  sessionEventsStop?.();
  const stopSessionEvents = documentSessions.subscribe(handleSessionEvent);
  sessionEventsStop = stopSessionEvents;
  lifetime.add(() => {
    stopSessionEvents();
    if (sessionEventsStop === stopSessionEvents) sessionEventsStop = undefined;
  });


  // Il layout è cambiato — qualcuno ha diviso, chiuso, cambiato linguetta — e il DOM
  // lo insegue. Il verso passa dal bus e non da una chiamata perché chi muta il
  // layout è anche il pannello delle impostazioni, la palette, un comando: tutti
  // punti che non devono conoscere questo modulo.
  // Un disegno che va storto si **dice**, e non alla console: dei riquadri che
  // non si ridisegnano l'utente si accorge comunque — sono metà della finestra —
  // e non avere dove leggerne la causa è l'esito buttato via del §20.3. Il
  // centro notifiche è la superficie che il §20.4 chiedeva e che dal §10.3 c'è.
  // La coda intanto si riprende al giro dopo (la coda dei disegni).
  lifetime.add(
    on("layout", () => {
      void synchronize().catch((e) => {
        notify(t("panes.redraw_failed", { reason: errorText(e) }), "guasto");
      });
    }),
  );

  lifetime.add(
    onEvent("document_changed", (e, origin) => {
      void documentSessions.handleExternalChange(e.id, origin).then((outcome) => {
        void applyExternalChange(e.id, outcome);
      });
    }),
  );

  lifetime.add(
    onEvent("document_removed", (e) => {
      const outcome = documentSessions.handleExternalRemoval(e.id);
      invalidateLoads(e.id);
      if (outcome.dirty) notify(t("document.deleted_dirty", { doc: e.id }), "guasto");
      removeEverywhere(e.id);
    }),
  );

  lifetime.add(
    onEvent("document_renamed", (e) => {
      const outcome = documentSessions.rename(e.from, e.to);
      if (outcome.kind !== "collision") {
        // The layout still names the old path until `rename` below runs. Keep
        // those editors read-only across that tiny migration window.
        setReadOnlyForDocument(e.from, documentSessions.isDeletionPending(e.to));
        rename(e.from, e.to);
      }
    }),
  );

  lifetime.add(
    onEvent("overflow", () => {
      // Eventi persi (coda troncata): ciò che deriviamo dagli eventi va
      // riconciliato da zero, non aggiornato.
      for (const id of openDocuments()) void reloadDocument(id);
    }),
  );

  // Lo stato di salvataggio e le etichette delle modalità sono disegnati da
  // questo modulo, quindi seguono esplicitamente il cambio di lingua.
  lifetime.add(
    onLanguage(() => {
      drawSave();
      for (const pane of panes.values()) drawToolbar(pane);
      for (const id of layoutPanes()) {
        const pane = panes.get(id);
        const current = paneState(id);
        if (pane && current) drawTab(pane, current.tabs, current.active);
      }
    }),
  );

  registerCommands();
}

/// I documenti aperti in un riquadro qualunque, senza ripetizioni.
function openDocuments(): string[] {
  const p = layoutPanes().flatMap((id) => {
    const state = paneState(id);
    return state ? documents(state) : [];
  });
  return [...new Set(p)];
}

function invalidateLoads(doc: string): void {
  for (const paneId of panesWithDoc(doc)) {
    const pane = panes.get(paneId);
    if (pane) pane.loadGeneration++;
  }
}

// --- i comandi dei riquadri (§18.2) -----------------------------------------
//
// Dividere, chiudere un riquadro, chiudere una linguetta sono **comandi** e non solo
// gesti del mouse, per la ragione della 0077: un gesto che vive solo in un
// listener è un gesto che non compare in nessun elenco e che nessuno può
// riconfigurare. Passano dalla stessa porta del click, così il cablaggio sta in
// un punto solo.

function registerCommands(): void {
  // Le due modalità come comandi (§18.2): erano due bottoni nel commutatore,
  // cioè raggiungibili col mouse e con nient'altro. Passano dalla stessa porta
  // del click (`setMode`), che è dove sta il cablaggio — classe attiva, resa
  // inline, superficie di lettura, contesto pubblicato — e non da una seconda
  // via che deve restare d'accordo con la prima.
  //
  // La terza modalità («sorgente») non è qui, e non è una dimenticanza: chi
  // passa da Lettura a Modifica lo fa cento volte al giorno, chi guarda il
  // sorgente nudo lo fa per capire cosa ha scritto un plugin. Dichiarare tre
  // comandi perché le modalità sono tre vorrebbe dire tre scorciatoie da
  // trovare per un caso che non le chiede.
  registerShellCommand({
    id: "shell.mode.reading",
    title: "commands.mode.reading",
    description: "commands.mode.reading.desc",
    layer: "surface",
    available: () => supportsMode("reading"),
    run: () => void setMode("reading"),
  });
  registerShellCommand({
    id: "shell.mode.live",
    title: "commands.mode.live",
    description: "commands.mode.live.desc",
    layer: "profile",
    available: () => supportsMode("live_preview"),
    run: () => void setMode("live_preview"),
  });
  registerShellCommand({
    id: "shell.pane.split.right",
    title: "commands.pane.split.right",
    description: "commands.pane.split.right.desc",
    layer: "pane",
    run: () => splitPane("row"),
  });
  registerShellCommand({
    id: "shell.pane.split.down",
    title: "commands.pane.split.down",
    description: "commands.pane.split.down.desc",
    layer: "pane",
    run: () => splitPane("col"),
  });
  registerShellCommand({
    id: "shell.pane.close",
    title: "commands.pane.close",
    description: "commands.pane.close.desc",
    layer: "pane",
    run: () => void closeCurrentPane(),
  });
  registerShellCommand({
    id: "shell.tab.close",
    title: "commands.tab.close",
    description: "commands.tab.close.desc",
    layer: "document",
    run: () => void closeCurrentTab(),
  });
  // Le due vie d'uscita da un conflitto (§18.1), e sono comandi e non un
  // dialogo per la ragione della 0088: la decisione è dell'utente, e un modale
  // che scatta durante un autosave con debounce la chiede in un momento che
  // l'utente non ha scelto. Il buffer sporco resta lì e aspetta, come una bozza
  // recuperata — e chi ha deciso lo dice quando ha deciso.
  registerShellCommand({
    id: "shell.doc.conflict.mine",
    title: "commands.doc.conflict.mine",
    description: "commands.doc.conflict.mine.desc",
    layer: "document",
    run: () => void resolveKeepingMine(),
  });
  registerShellCommand({
    id: "shell.doc.conflict.theirs",
    title: "commands.doc.conflict.theirs",
    description: "commands.doc.conflict.theirs.desc",
    layer: "document",
    run: () => void resolveDiscardingMine(),
  });
}

/// «Vince il mio testo»: la sessione esegue la decisione, questa funzione
/// aggiorna soltanto ciò che la shell disegna.
async function resolveKeepingMine(): Promise<void> {
  const doc = activeDoc();
  if (!doc) {
    notify(t("document.conflict_none"), "info");
    return;
  }
  const outcome = await documentSessions.resolveConflict(doc, "mine");
  if (outcome.kind === "none") notify(t("document.conflict_none"), "info");
}

/// «Vince il testo sul disco»: la sessione scarta il buffer e rilegge il
/// documento. Gli editor seguono perché la sessione ha diffuso il testo
/// autorevole alle superfici sottoscritte; qui restano il ridisegno della
/// lettura e delle scritte di stato.
async function resolveDiscardingMine(): Promise<void> {
  const doc = activeDoc();
  if (!doc) {
    notify(t("document.conflict_none"), "info");
    return;
  }
  const outcome = await documentSessions.resolveConflict(doc, "theirs");
  if (outcome.kind === "none") {
    notify(t("document.conflict_none"), "info");
    return;
  }
  await redrawReading(doc);
  drawSave();
  redrawTabs(doc);
}

/// Divide il riquadro col fuoco e ci porta dentro **lo stesso documento**.
///
/// È ciò che serve nove volte su dieci — la stessa nota di lato, in Lettura,
/// mentre si scrive — ed è anche il primo cliente vero della regola del buffer
/// unico: le due superfici mostrano lo stesso testo perché *è* lo stesso testo.
/// Un riquadro nuovo e vuoto lo si ottiene chiudendo la linguetta, che è un gesto in
/// meno di quello che servirebbe per il contrario.
function splitPane(dir: "row" | "col"): void {
  const toSplit = layout.focus;
  const current = activeDoc(toSplit);
  const newItem = split(toSplit, dir);
  if (newItem && current) openIn(newItem, current);
}

async function closeCurrentPane(): Promise<void> {
  const id = layout.focus;
  const tabs = paneState(id)?.tabs ?? [];
  if (!closePane(id)) return;
  // Il riquadro non c'è più: le sue linguette possono essere rimaste senza
  // nessuno che le guardi, e allora si smonta una view o si mette in salvo un buffer.
  for (const tab of tabs) {
    if (tab.k === "view") unmountViewFromPane(tab.view, id);
    else await dismissIfUnwatched(tab.doc);
  }
  await synchronize();
  const pane = panes.get(layout.focus);
  if (!pane) return;
  const nextActive = paneState(layout.focus)?.active ?? -1;
  if (nextActive >= 0) focusPaneTab(pane, nextActive);
  else pane.root.focus();
}

async function closeCurrentTab(): Promise<void> {
  const id = layout.focus;
  const p = activePane();
  const tab = activeTab(id);
  if (p.active < 0) return;
  closeTab(id, p.active);
  const nextActive = paneState(id)?.active ?? -1;
  await releaseTab(id, tab);
  await synchronize();
  const pane = panes.get(id);
  if (!pane) return;
  if (nextActive >= 0) focusPaneTab(pane, nextActive);
  else pane.root.focus();
}

/// Una linguetta è stata chiusa: si lascia andare ciò che teneva in vita.
///
/// Le due specie di linguetta hanno due cose diverse da rilasciare, e nessuna delle
/// due si raccoglie da sé: un documento ha un buffer che va **salvato** prima di
/// dimenticarlo, una view ha un pannello registrato e un albero montato. Che
/// stiano nella stessa funzione è ciò che tiene chi chiude una linguetta dal doversi
/// ricordare quale delle due aveva sotto le dita.
async function releaseTab(paneId: string, tab: Tab | null): Promise<void> {
  if (!tab) return;
  if (tab.k === "doc") await dismissIfUnwatched(tab.doc);
  else unmountViewFromPane(tab.view, paneId);
}

/// Un documento che nessun riquadro mostra più viene rilasciato dalla sessione:
/// il flush, la bozza e la chiusura sono una sola decisione del suo owner.
async function dismissIfUnwatched(doc: string): Promise<void> {
  if (panesWithDoc(doc).length > 0) return;
  await documentSessions.release(doc);
}

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

/// Le aperture, in fila (difetto 0033).
///
/// `openDocument` non ha niente da datare: l'`id` è il suo parametro e non
/// scade — il difetto era descritto come una identità da ricontrollare dopo
/// l'`await`, e quell'identità non esiste. Ciò che manca è **l'ordine**: due
/// aperture ravvicinate (un doppio click nell'esploratore, due Invio nel quick
/// switcher) aspettano tutte e due `flushPendingSave`, e chi finisce di aspettare
/// per primo apre per primo. Se è quella chiesta per prima a finire per seconda,
/// il documento che resta col fuoco è quello che l'utente aveva chiesto **prima**.
///
/// Buttare la vecchia sarebbe sbagliato: sono due note che l'utente ha chiesto
/// di aprire, e le vuole aperte tutte e due. Vanno in fila.
const openQueue = new Queue();

/// Porta il DOM in accordo col layout: la struttura, le linguetta, i documenti
/// caricati, la modalità, il fuoco.
///
/// È l'unico punto che disegna, ed è il motivo per cui tutto il resto di questo
/// file può limitarsi a mutare il layout e non pensarci più — la stessa forma
/// con cui `ui/panel-host.ts` ha tolto ai pannelli il «quando ridisegnarsi».
export function synchronize(): Promise<void> {
  return drawQueue.enqueue(render);
}

async function render(): Promise<void> {
  buildStructure();
  const active = activeDoc();
  for (const id of layoutPanes()) {
    const r = panes.get(id);
    const p = paneState(id);
    if (!r || !p) continue;
    drawTab(r, p.tabs, p.active);
    r.root.dataset.mode = p.mode;
    r.root.classList.toggle("focus", id === layout.focus);
    await show(r, activeTab(id));
    r.root.dataset.mode = selectedMode(r)?.id ?? p.mode;
    drawToolbar(r);
    drawConflict(r, activeDoc(id));
  }
  drawSave();
  if (state.currentDoc !== active) {
    state.currentDoc = active;
    emit("active-doc", active);
  }
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
      r.root.remove();
      panes.delete(id);
    }
  }
  const onboarding = document.getElementById("onboarding");
  panesEl.replaceChildren(node(layout.tree));
  // La schermata senza vault vive nell'HTML statico dentro #panes: il layout
  // la spazzerebbe via a ogni synchronize, quindi la si rimette in fondo —
  // `hidden` resta padrone della visibilità (A01, syncOnboarding in shell).
  if (onboarding) panesEl.append(onboarding);
}

function node(n: LayoutNode): HTMLElement {
  if (n.k === "leaf") return renderPane(n.pane).root;
  const el = document.createElement("div");
  el.className = `pane-split ${n.dir}`;
  el.append(...n.children.map(node));
  return el;
}

/// Il riquadro con questo id, creandolo se è nuovo.
function renderPane(id: string): Pane {
  const already = panes.get(id);
  if (already) return already;

  const root = document.createElement("section");
  root.className = "pane";
  root.dataset.pane = id;
  // Ogni riquadro è una regione con un nome: senza, un lettore di schermo
  // annuncia N sezioni identiche e non c'è modo di sapere in quale si è
  // finiti. Il nome è il numero, che è l'unica cosa che li distingua finché
  // non hanno un titolo — e col documento aperto lo aggiorna `disegnaTab`.
  root.setAttribute("role", "region");
  root.tabIndex = -1;

  const tabsShell = document.createElement("div");
  tabsShell.className = "pane-tabs";
  const tabsEl = document.createElement("div");
  tabsEl.setAttribute("role", "tablist");
  // Le tab sono possedute dal tablist con `aria-owns`, ma il loro bottone di
  // chiusura resta nel flusso visivo accanto senza diventare un figlio vietato
  // della tablist. `display: contents` lascia la striscia un'unica fila.
  tabsEl.style.display = "contents";
  tabsShell.append(tabsEl);
  const tabMenuEl = document.createElement("button");
  tabMenuEl.type = "button";
  tabMenuEl.dataset.tabMenu = "";
  tabMenuEl.setAttribute("aria-haspopup", "menu");
  tabMenuEl.textContent = "▾";
  tabMenuEl.addEventListener("click", (event) => {
    const current = paneState(id);
    if (!current) return;
    showContextMenu(event, current.tabs.map((tab, index) => ({
      label: (tab.k === "doc" && documentSessions.isDirty(tab.doc) ? "• " : "") + nameTab(tab),
      run: () => activateTab(id, index),
    })));
  });
  tabsShell.append(tabMenuEl);

  const contentEl = document.createElement("div");
  contentEl.setAttribute("role", "tabpanel");
  contentEl.style.display = "flex";
  contentEl.style.flex = "1";
  contentEl.style.minHeight = "0";
  contentEl.style.flexDirection = "column";
  contentEl.id = panePanelId(id);

  const editorEl = document.createElement("div");
  editorEl.className = "pane-editor";

  const previewEl = document.createElement("div");
  previewEl.className = "pane-preview markdown-preview";
  previewEl.tabIndex = 0;
  previewEl.setAttribute("role", "document");

  // La terza superficie del riquadro (§3.3). Non è `declared-view` come nella
  // sidebar e non deve esserlo: là una view è un pannello con un titolo che si
  // apre e si chiude, qui **è** il contenuto del riquadro, e il titolo è già
  // sulla tab.
  const viewEl = document.createElement("div");
  viewEl.className = "pane-view";

  const toolbarEl = document.createElement("div");
  toolbarEl.className = "pane-toolbar";
  toolbarEl.setAttribute("role", "toolbar");

  const conflictEl = document.createElement("div");
  conflictEl.hidden = true;

  contentEl.append(editorEl, previewEl, viewEl);
  root.append(tabsShell, toolbarEl, conflictEl, contentEl);
  // Toccare un riquadro gli dà il fuoco. `mousedown` e non `click` perché il
  // fuoco deve essere già di questo riquadro quando l'editor riceve l'evento:
  // altrimenti il contesto pubblicato subito dopo sarebbe quello di prima.
  root.addEventListener("mousedown", () => focusPane(id));
  root.addEventListener("focusin", () => focusPane(id));


  const r: Pane = {
    id,
    root,
    tabsShell,
    tabsEl,
    contentEl,
    tabMenuEl,
    toolbarEl,
    conflictEl,
    editorEl,
    previewEl,
    viewEl,
    surface: null,
    shown: null,
    loadGeneration: 0,
    tabsSignature: null,
    disposeSurface: null,
  };
  panes.set(id, r);
  return r;
}

function panePanelId(id: string): string {
  return `pane-${id}-tabpanel`;
}

function paneTabId(id: string, index: number): string {
  return `pane-${id}-tab-${index}`;
}

function focusPaneTab(r: Pane, index: number): void {
  const tabs = r.tabsShell.querySelectorAll<HTMLElement>(".tab");
  tabs.forEach((tab, position) => {
    tab.tabIndex = position === index ? 0 : -1;
    const close = tab.parentElement?.querySelector<HTMLElement>(".tab-close");
    if (close) close.tabIndex = tab.tabIndex;
  });
  tabs[index]?.focus();
}

function movePaneTab(current: number, key: string, count: number): number | null {
  if (count < 1) return null;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/// Disegna la striscia delle tab di un riquadro.
function drawTab(r: Pane, tabs: Tab[], active: number): void {
  // Solo l'identità modifica la struttura: dirty, lingua e selezione
  // ridipingono gli stessi controlli senza sottrarre il focus.
  const signature = JSON.stringify(tabs);
  const focused = document.activeElement;
  const focusedTab = focused instanceof HTMLElement && r.tabsShell.contains(focused)
    ? focused.closest(".tab-entry")?.querySelector<HTMLElement>(".tab")
    : null;
  const focusedKey = focusedTab?.dataset.key;
  const focusedIndex = focusedTab ? Number(focusedTab.dataset.index) : -1;
  const onClose = focused instanceof HTMLElement && focused.matches(".tab-close");
  if (r.tabsSignature !== signature) {
    const children = tabs.map((tab, index) => buildTab(r, tab, index));
    const tabIds = children.map((entry) => entry.querySelector<HTMLElement>(".tab")!.id);
    r.tabsShell.replaceChildren(r.tabsEl, ...children, r.tabMenuEl);
    r.tabsSignature = signature;
    // Una tab con un comando di chiusura non può contenere il suo secondo
    // controllo: un `<button>` dentro una tab interattiva è HTML invalido e
    // axe lo segnala come `nested-interactive`. La tab è posseduta dalla
    // tablist tramite `aria-owns`; il bottone di chiusura resta il suo fratello
    // nel flusso visivo (`.tab-entry` li tiene in una fila).
    if (tabIds.length > 0) r.tabsEl.setAttribute("aria-owns", tabIds.join(" "));
    else r.tabsEl.removeAttribute("aria-owns");
  }
  const buttons = [...r.tabsShell.querySelectorAll<HTMLElement>(".tab")];
  const retained = focusedKey === undefined
    ? -1
    : buttons.findIndex((tab) => tab.dataset.key === focusedKey);
  const roving = retained >= 0
    ? retained
    : focusedIndex >= 0 ? Math.min(focusedIndex, tabs.length - 1) : active;
  tabs.forEach((tab, index) => paintTab(buttons[index]!, tab, index === active, index === roving));
  r.tabsShell.hidden = tabs.length === 0;
  r.contentEl.hidden = tabs.length === 0;
  const selected =
    active >= 0
      ? r.tabsShell.querySelector<HTMLElement>(`[role="tab"][data-index="${active}"]`)
      : null;
  if (selected) r.contentEl.setAttribute("aria-labelledby", selected.id);
  else r.contentEl.removeAttribute("aria-labelledby");
  r.tabsEl.setAttribute("aria-label", t("document.tab.list"));
  const activeName = tabs[active] ? nameTab(tabs[active]!) : "";
  r.root.setAttribute(
    "aria-label",
    activeName
      ? `${t("pane.named", { name: activeName })} (${r.id})`
      : `${t("pane.empty")} (${r.id})`,
  );
  if (focusedTab && focused && !focused.isConnected) {
    const replacement = buttons[roving];
    const control = onClose
      ? replacement?.parentElement?.querySelector<HTMLElement>(".tab-close")
      : replacement;
    (control ?? r.toolbarEl.querySelector<HTMLElement>('button[aria-haspopup="menu"]'))
      ?.focus({ preventScroll: true });
  }
  drawTabOverflow(r, tabs, active);
}

/// Costruisce una tab accessibile (U21): nome breve + dirty testuale oltre
/// colore (`aria-label` "nome · Non salvato"), close "Chiudi nome" come
/// bottone vero (non span), attiva distinguibile via aria-selected, view con
/// titolo dichiarato senza fingere file.
function buildTab(r: Pane, target: Tab, index: number): HTMLElement {
  const item = document.createElement("div");
  item.className = "tab-entry";
  const tab = document.createElement("button");
  tab.className = "tab";
  tab.type = "button";
  tab.id = paneTabId(r.id, index);
  tab.dataset.key = JSON.stringify(target);
  tab.dataset.index = String(index);
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", panePanelId(r.id));
  tab.setAttribute("aria-keyshortcuts", "Delete");
  const name = document.createElement("span");
  name.className = "tab-name";
  tab.append(name);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "tab-close";
  close.dataset.tabId = tab.id;
  const remove = (): void => {
    if (!tab.isConnected) return;
    closeTab(r.id, index);
    void releaseTab(r.id, target);
  };
  close.addEventListener("mousedown", (event) => {
    // Chiudere una tab in secondo piano non deve prima attivarla, né
    // attivare quella che si sta chiudendo un istante prima di toglierla.
    event.stopPropagation();
    event.preventDefault();
    remove();
  });
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    remove();
  });
  // Invio/Spazio sul Chiudi non devono anche attivare la tab: l'attivazione
  // resta esplicita e resta testabile senza sintesi nativa dei tasti.
  close.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
      event.preventDefault();
      close.click();
      return;
    }
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.stopPropagation();
    }
  });
  tab.addEventListener("click", () => activateTab(r.id, index));
  tab.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Delete") {
      event.preventDefault();
      remove();
      return;
    }
    const next = movePaneTab(index, event.key, r.tabsShell.querySelectorAll(".tab").length);
    if (next !== null) {
      event.preventDefault();
      focusPaneTab(r, next);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      tab.click();
    }
  });
  item.append(tab, close);
  return item;
}

/// Ridipinge etichette e selezione senza ricreare i controlli. Il nome
/// accessibile porta anche lo stato non salvato, non soltanto il colore.
function paintTab(tab: HTMLElement, target: Tab, selected: boolean, tabStop: boolean): void {
  const described = describeTab(target);
  tab.classList.toggle("dirty", described.dirty);
  tab.classList.toggle("tab-view", described.kind === "view");
  tab.setAttribute("aria-selected", String(selected));
  tab.tabIndex = tabStop ? 0 : -1;
  tab.querySelector<HTMLElement>(".tab-name")!.textContent = described.label;
  setTooltip(tab, target.k === "doc" ? target.doc : described.label);
  tab.setAttribute(
    "aria-label",
    described.dirty ? `${described.label} · ${t("save.unsaved")}` : described.label,
  );
  const close = tab.parentElement!.querySelector<HTMLElement>(".tab-close")!;
  close.tabIndex = tab.tabIndex;
  const closeLabel = t("document.tab.close", { doc: described.label });
  close.setAttribute("aria-label", closeLabel);
  setTooltip(close, closeLabel);
}

/// L'elenco resta fuori dalla tablist e non viene ricreato a ogni ridisegno.
function drawTabOverflow(r: Pane, tabs: Tab[], active: number): void {
  r.tabMenuEl.hidden = tabs.length <= 1;
  r.tabMenuEl.setAttribute("aria-label", t("document.tab.list"));
  setTooltip(r.tabMenuEl, t("document.tab.list"));
  const focused = document.activeElement;
  const selected = focused instanceof HTMLElement && r.tabsShell.contains(focused)
    ? focused
    : r.tabsShell.querySelectorAll<HTMLElement>(".tab")[active];
  selected?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

function redrawTabs(doc: string): void {
  for (const paneId of panesWithDoc(doc)) {
    const r = panes.get(paneId);
    const p = paneState(paneId);
    if (r && p) drawTab(r, p.tabs, p.active);
  }
}

function handleSessionEvent(event: DocumentSessionEvent): void | Promise<void> {
  if (event.kind === "deletion-changed") {
    setReadOnlyForDocument(event.id, event.pending);
    drawSave();
    redrawTabs(event.id);
    drawPaneConflict(event.id);
    return;
  }
  if (event.kind === "changed") {
    drawSave();
    redrawTabs(event.id);
    drawPaneConflict(event.id);
    return;
  }
  if (event.kind === "draft-blind") {
    notify(t("draft.blind"), "guasto");
    return;
  }
  if (event.kind === "save-failed") {
    if (event.outcome === "conflitto") {
      notify(t("document.save_conflict", { doc: event.id }), "guasto");
    } else {
      notify(t("document.save_failed", { doc: event.id, reason: errorText(event.error) }), "guasto");
    }
    drawSave();
    redrawTabs(event.id);
    drawPaneConflict(event.id);
    return;
  }
  drawSave();
  redrawTabs(event.id);
  drawPaneConflict(event.id);
  return publishContext().then(() => redrawReading(event.id));
}

/// Ridisegna il banner conflitto dei riquadri che mostrano questo documento.
/// Solo ridisegno + comandi esistenti; mai semantica sessione (R01-R04 intatti).
function drawPaneConflict(doc: string): void {
  for (const paneId of panesWithDoc(doc)) {
    const r = panes.get(paneId);
    if (r && activeDoc(paneId) === doc) drawConflict(r, doc);
  }
}

function setReadOnlyForDocument(doc: string, readOnly: boolean): void {
  for (const paneId of panesWithDoc(doc)) {
    panes.get(paneId)?.surface?.setReadOnly?.(readOnly);
  }
}

/// Come si chiama una tab.
///
/// Per un documento è il nome della nota; per una view è il **titolo che la view
/// dichiara**, già risolto nella lingua dell'utente dal kernel (0040). Se quella
/// view non è (più) dichiarata — un bundle spento fra due avvii, con la tab
/// rimasta nel file della macchina — resta il suo id: è brutto e non mente, che
/// è l'ordine giusto delle due cose.
function nameTab(tab: Tab): string {
  return tab.k === "doc" ? docTitle(tab.doc) : (primaryView(tab.view)?.title ?? tab.view);
}

/// Il nome di una nota come si legge su una tab: l'ultimo pezzo del path, senza
/// estensione. Il path intero resta nel `title`, perché due note omonime in due
/// cartelle sono il caso in cui la tab da sola non basta.
function docTitle(doc: string): string {
  const base = doc.split("/").pop() ?? doc;
  const point = base.lastIndexOf(".");
  return point > 0 ? base.slice(0, point) : base;
}

/// Mette in un riquadro ciò che la sua tab attiva dice, se non c'è già.
///
/// Le due specie di tab accendono due superfici diverse dello stesso riquadro, e
/// il ramo che le distingue sta **qui e basta**: da `render` in giù nessuno sa
/// che esistano due specie, e chi cambia tab non deve dire quale.
async function show(r: Pane, tab: Tab | null): Promise<void> {
  const generation = ++r.loadGeneration;
  const changed = !r.shown || !tab || !sameTab(r.shown, tab);
  // Una view che se ne va porta con sé il suo pannello: senza, resterebbe
  // registrata a ridisegnarsi dentro un elemento che nessuno guarda.
  if (changed && r.shown?.k === "view") unmountViewFromPane(r.shown.view, r.id);
  // Sessione e superficie hanno ownership separate, ma terminano nello stesso
  // cambio di tab: prima si interrompe il flusso, poi si smonta l'istanza.
  if (changed) {
    detachSurface(r);
    destroySurface(r);
  }
  r.shown = tab;
  r.root.classList.toggle("con-vista", tab?.k === "view");

  if (tab?.k === "view") {
    clearPreview(r.previewEl);
    await mountViewInPane(tab.view, r.id, r.viewEl);
    return;
  }
  if (!changed) return;
  if (!tab) {
    clearPreview(r.previewEl);
    return;
  }

  let source: DocumentSurfaceSource;
  let forms: SyntaxForm[];
  try {
    [source, forms] = await Promise.all([
      readBuffer(tab.doc),
      syntaxForms(tab.doc),
    ]);
  } catch (error) {
    if (isDocumentDeletedDuringRead(error)) return;
    throw error;
  }
  if (generation !== r.loadGeneration || r.shown !== tab) return;

  const surface = surfaceRegistry.mount(
    { formatId: source.formatId, sourceKind: source.sourceKind },
    {
      paneId: r.id,
      documentId: tab.doc,
      parent: r.editorEl,
      formatId: source.formatId,
      revision: source.revision,
    },
  );
  r.surface = surface;
  const mode = selectedMode(r);
  if (!mode) {
    destroySurface(r);
    throw new Error(`surface ${surface.surfaceId} declares no modes`);
  }
  surface.setMode(mode.id);
  r.root.dataset.mode = mode.id;
  if (theme) surface.setTheme?.(theme);
  if (isMarkdownSurface(surface)) surface.setSyntaxForms(forms);
  surface.setDoc(source.text);
  surface.setReadOnly?.(documentSessions.isDeletionPending(tab.doc));
  // Il contenuto è a posto: da qui la sessione può raggiungere questo
  // riquadro come superficie, finché non mostra altro.
  attachSurface(r, tab.doc);
  if (mode.presentation === "rendered") await updatePreview(r.previewEl, tab.doc);
  markReadingVersion(r.previewEl, documentSessions.isDirty(tab.doc));
}

/// La sottoscrizione di un riquadro alla sessione del documento mostrato.
/// L'identità di registrazione è l'id del riquadro: stabile per quanto il
/// riquadro vive, opaco per la sessione. Attacare due volte con lo stesso id
/// è la stessa superficie rimontata, non due superfici.
function attachSurface(r: Pane, doc: string): void {
  const surface = r.surface;
  if (!surface) return;
  r.disposeSurface = documentSessions.attachSurface(doc, {
    id: surface.surfaceId,
    sync: (update) => applySurfaceUpdate(r, doc, update),
  });
  surface.setReadOnly?.(documentSessions.isDeletionPending(doc));
}

function detachSurface(r: Pane): void {
  r.disposeSurface?.();
  r.disposeSurface = null;
}

function destroySurface(r: Pane): void {
  clearPreview(r.previewEl);
  r.surface?.destroy();
  r.surface = null;
  r.editorEl.replaceChildren();
}

/// Applica alla superficie di questo riquadro il dato che la sessione ha
/// diffuso. `syncDoc` e non `setDoc`: il documento è lo stesso, è cambiato il
/// testo sotto — e chi lo sta guardando non perde il punto in cui era. Il
/// cambio non entra nella history locale: un aggiornamento arrivato da un
/// altro riquadro non diventa un undo di questo.
function applySurfaceUpdate(r: Pane, doc: string, update: DocumentSurfaceUpdate): void {
  if (r.shown?.k !== "doc" || r.shown.doc !== doc) return;
  r.surface?.syncDoc(
    update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text,
  );
}

/// Il testo di un documento: dal buffer se qualcuno lo tiene già aperto, dal
/// disco altrimenti.
///
/// È qui che la regola del buffer unico si vede: aprire in un secondo riquadro
/// una nota con modifiche non salvate mostra **quelle modifiche**, non il file
/// su disco. L'alternativa — rileggere sempre dal disco — darebbe due riquadri
/// che mostrano due testi diversi dello stesso documento.
async function readBuffer(doc: string): Promise<DocumentSurfaceSource> {
  return documentSessions.readForSurface(doc);
}

/// Ridisegna ogni presentazione resa che mostra questo documento.
/// Dopo il render: dichiara la versione col dirty di sessione (U32),
/// mai seconda verità locale.
async function redrawReading(doc: string): Promise<void> {
  await Promise.all(
    panesWithDoc(doc).map(async (id) => {
      const r = panes.get(id);
      if (
        !r ||
        selectedMode(r)?.presentation !== "rendered" ||
        activeDoc(id) !== doc
      ) return;
      await updatePreview(r.previewEl, doc);
      markReadingVersion(r.previewEl, documentSessions.isDirty(doc));
    }),
  );
}

/// Il modo effettivo è quello persistito quando la superficie lo dichiara,
/// altrimenti il primo che essa supporta. Il fallback non riscrive il layout:
/// tornando alla superficie precedente, il riquadro ritrova la sua modalità.
function selectedMode(r: Pane | undefined): SurfaceMode | undefined {
  if (!r?.surface) return undefined;
  const requested = paneState(r.id)?.mode;
  return r.surface.modes.find((mode) => mode.id === requested) ?? r.surface.modes[0];
}

function supportsMode(id: string): boolean {
  return panes.get(layout.focus)?.surface?.modes.some((mode) => mode.id === id) ?? false;
}

/// Toolbar per-riquadro (U23-U26): percorso contestuale + modi dichiarati
/// dalla superficie + menu con azioni esistenti. Usa percorso focus/mode
/// esistente, mai seconda verità; una sola modalità = nessun segmentato (U24);
/// mai ricreare EditorView (solo chrome, superficie intatta).
function drawToolbar(r: Pane): void {
  const bar = r.toolbarEl;
  if (!bar.firstElementChild) {
    const crumbs = document.createElement("span");
    crumbs.className = "muted";
    const group = document.createElement("span");
    group.className = "segmented";
    group.setAttribute("role", "group");
    const menu = document.createElement("button");
    menu.type = "button";
    menu.textContent = "…";
    menu.setAttribute("aria-haspopup", "menu");
    menu.addEventListener("click", (event) => openPaneMenu(r, event));
    const version = document.createElement("span");
    version.className = "muted";
    bar.append(crumbs, group, menu, version);
  }
  const crumbs = bar.children[0] as HTMLElement;
  const group = bar.children[1] as HTMLElement;
  const menu = bar.children[2] as HTMLElement;
  const version = bar.children[3] as HTMLElement;
  const tab = activeTab(r.id);
  const path = tab?.k === "doc" ? tab.doc : tab?.k === "view" ? nameTab(tab) : "";
  crumbs.textContent = path;
  setTooltip(crumbs, path);
  group.setAttribute("aria-label", t("document.toolbar.modes"));
  menu.setAttribute("aria-label", t("document.pane.menu"));
  const modes = r.surface && r.surface.modes.length > 1 ? r.surface.modes : [];
  const active = selectedMode(r);
  group.hidden = modes.length <= 1;
  while (group.children.length > modes.length) group.lastElementChild!.remove();
  modes.forEach((mode, index) => {
    let button = group.children[index] as HTMLButtonElement | undefined;
    if (!button) {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "segmented-option";
      control.addEventListener("click", () => {
        focusPane(r.id);
        void setMode(control.dataset.mode!);
      });
      group.append(control);
      button = control;
    }
    button.dataset.mode = mode.id;
    button.textContent = mode.label();
    button.setAttribute("aria-pressed", String(active?.id === mode.id));
  });
  const dirty = tab?.k === "doc" && documentSessions.isDirty(tab.doc);
  const rendered = tab?.k === "doc" && active?.presentation === "rendered";
  version.textContent = rendered
    ? dirty ? t("document.reading.stale") : t("document.reading.current")
    : "";
  if (rendered && dirty) version.dataset.readingDirty = "true";
  else delete version.dataset.readingDirty;
}

/// Menu riquadro con sole azioni esistenti (U25): split/close via comandi
/// registrati, focus/mode dal percorso esistente.
function openPaneMenu(r: Pane, event: MouseEvent): void {
  const entries = allCommands().filter((entry) =>
    ["shell.pane.split.right", "shell.pane.split.down", "shell.pane.close", "shell.tab.close"].includes(entry.id),
  );
  showContextMenu(event, entries.map((entry) => ({
    label: entry.title,
    run: () => {
      focusPane(r.id);
      void entry.run?.();
    },
  })));
}

/// Presidio locale: nessun mode con id ignoto persiste oltre il riquadro (U24).
/// Ritorna true se il mode persistito era sconosciuto (conservato, non cancellato).
export function hasUnknownPersistedMode(paneId: string): boolean {
  const r = panes.get(paneId);
  const modes = r?.surface?.modes ?? [];
  if (modes.length === 0) return false;
  const requested = paneState(paneId)?.mode;
  return requested !== undefined && !modes.some((mode) => mode.id === requested);
}

/// Banner conflitto persistente nel riquadro coinvolto (U59-U60): documento,
/// spiegazione, Mantieni mio / Usa disco, conferma esplicita con conseguenza,
/// comandi shell.doc.conflict.* esistenti. Mai merge finto, mai risoluzione
/// automatica; buffer recuperabile finché irrisolto (solo ridisegno + comandi).
function drawConflict(r: Pane, doc: string | null): void {
  const box = r.conflictEl;
  box.replaceChildren();
  if (!doc || documentSessions.saveState(doc) !== "conflitto") {
    box.hidden = true;
    box.removeAttribute("role");
    return;
  }
  box.hidden = false;
  box.setAttribute("role", "alert");
  box.setAttribute("data-banner", "document.conflict.body");
  const title = document.createElement("strong");
  title.textContent = t("document.conflict.title", { doc });
  const body = document.createElement("p");
  body.textContent = t("document.conflict.body");
  body.setAttribute("data-doc", doc);
  const actions = document.createElement("div");
  const mine = document.createElement("button");
  mine.type = "button";
  mine.className = "primary";
  mine.textContent = t("document.conflict.keep_mine");
  const theirs = document.createElement("button");
  theirs.type = "button";
  theirs.textContent = t("document.conflict.use_disk");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("document.conflict.cancel");
  const current = doc;
  const ask = async (choice: "mine" | "theirs"): Promise<void> => {
    const detail = choice === "mine"
      ? t("commands.doc.conflict.mine.desc")
      : t("commands.doc.conflict.theirs.desc");
    const ok = await confirm(
      `${t(choice === "mine" ? "commands.doc.conflict.mine" : "commands.doc.conflict.theirs")}\n${current}\n${detail}`,
      {
        title: t("document.conflict.title", { doc: current }),
        okLabel: t(choice === "mine" ? "commands.doc.conflict.mine" : "commands.doc.conflict.theirs"),
        danger: choice === "theirs",
      },
    );
    if (!ok) {
      notify(t("document.conflict.cancel"), "info");
      return;
    }
    if (choice === "mine") await resolveKeepingMine();
    else await resolveDiscardingMine();
  };
  mine.addEventListener("click", () => void ask("mine"));
  theirs.addEventListener("click", () => void ask("theirs"));
  cancel.addEventListener("click", () => {
    notify(t("document.conflict.cancel"), "info");
  });
  actions.append(mine, theirs, cancel);
  box.append(title, body, actions);
}

/// **Ritrova ciò che era rimasto non salvato** (§15.2), all'apertura del vault.
///
/// Il recupero è un buffer **precaricato e sporco**, e non un file riscritto:
/// è la scelta che tiene la decisione all'utente. Il disco resta com'è finché
/// qualcuno non salva, e la nota recuperata si comporta esattamente come una
/// che si stava scrivendo — pallino sulla tab, «Non salvato» nella barra di
/// stato, e i gesti di sempre per tenerla o buttarla. Non serve una superficie
/// nuova per una cosa che la shell sa già disegnare.
///
/// Che sia un buffer e non un dialogo modale ha anche una conseguenza che vale
/// più dell'economia di codice: chi apre il vault e vuole solo leggere qualcosa
/// non viene fermato da una domanda. Il testo c'è, lo trova quando apre quella
/// nota, e nel frattempo la notifica gli dice che c'è.
///
/// Le bozze **superate** — il disco contiene già quel testo, cioè il caso
/// normale dopo una chiusura ordinata — non arrivano fin qui: le toglie
/// `toRecover`.
///
/// Il ricongiungimento ha una condizione di **identità**: la bozza torna nel
/// suo documento solo se il buffer che c'è già non è sporco. Quando `recoverDrafts`
/// corre, `synchronize` ha appena letto dal disco le tab ripristinate dal layout —
/// buffer **puliti**, cioè la copia più *vecchia* fra le due — e la bozza deve
/// rientrare sopra di loro. Un buffer sporco invece è un testo battuto dopo, in
/// questa sessione: un'identità diversa, e la bozza resta orfana sul disco.
///
/// Il rientro non si ferma al buffer: chi arrivava già a schermo leggeva il
/// disco — la tab ripristinata dal layout, che `synchronize` ha appena
/// disegnato — e la bozza è più nuova di lui. L'editor, il pallino sulla tab,
/// la barra di stato e la lettura si portano con lei, o la prima battuta,
/// riscritta sopra il testo vecchio che si vede, coprirebbe il recupero senza
/// che nessuno l'abbia mai visto.
export async function recoverDrafts(): Promise<number> {
  let drafts: DraftInfo[];
  try {
    drafts = toRecover(await unsavedDrafts());
  } catch {
    // Un recupero che non parte non deve impedire di aprire il vault: è una
    // rete di sicurezza, e una rete che blocca la porta è peggio di nessuna
    // rete. Ciò che non si è letto lo dice il rapporto diagnostico.
    return 0;
  }
  const rejoined = documentSessions.rejoin(drafts);
  // Editor, pallino sulla tab e barra di stato vengono portati dal recupero
  // stesso: `restoreDraft` sostituisce il testo autorevole e la sessione lo
  // diffonde alle superfici sottoscritte — una volta, senza un giro di sync
  // in più qui. Restano le due cose che sono del pannello: le notifiche e la
  // lettura, che mostrava il disco e ora mostra il testo rientrato.
  for (const b of rejoined) {
    notify(`${b.doc}: ${t(CASE_KEY[caseOf(b)])}`, "info");
  }
  drawSave();
  await Promise.all(rejoined.map((b) => redrawReading(b.doc)));
  // Il conto dice quante sono **rientrate davvero**, non quante erano in fila:
  // la notifica dice «è stato ritrovato, aprile per decidere», e una bozza
  // saltata — il buffer sporco che la precede — non è ritrovata e non ha
  // nessun documento da aprire.
  return rejoined.length;
}

// --- aprire e chiudere ------------------------------------------------------

/// Apre un documento nel riquadro col fuoco.
export async function openDocument(id: string): Promise<void> {
  // Reserve the target before entering the shared flush queue. Otherwise the
  // last-tab release can close the owner while this opening is still waiting
  // for that same queue.
  const releaseIntent = documentSessions.retain(id);
  try {
    await openQueue.enqueue(async () => {
      // Cambio documento: prima si mette in salvo ciò che è appeso al debounce, così
      // nessuna modifica resta indietro. Tutti i buffer e non solo quello che si sta
      // lasciando: costa zero quando sono puliti, ed è la regola già scritta per le
      // azioni di view.
      await documentSessions.flushPendingSave();
      openIn(layout.focus, id);
      await synchronize();
      // Il contesto si pubblica DOPO aver caricato il buffer: prima, lo span della
      // selezione sarebbe quello del documento precedente.
      await publishContext();
      if (activePane().mode !== "reading") focusEditor();
    });
  } finally {
    releaseIntent();
    // A failed or superseded opening must not leave the owner retained solely
    // by its reservation. A tab already present still counts as a watcher.
    if (!isOpen(id)) await documentSessions.release(id);
  }
}

/// Chiude il documento aperto **in ogni riquadro**, senza salvarlo: lo si usa
/// quando il documento non c'è più (cancellato qui o da fuori), cioè quando
/// salvarlo lo resusciterebbe.
///
/// Senza argomento chiude quello attivo, che è la forma con cui la chiamava chi
/// aveva un riquadro solo.
export function closeDocument(id: string | null = state.currentDoc): void {
  if (!id) return;
  documentSessions.close(id);
  invalidateLoads(id);
  removeEverywhere(id);
  // Il kernel svuota già il documento del contesto in `remove_document`: qui
  // si ripubblica per allineare i due stati **e** per farsi dire quali view
  // ridisegnare, che è cosa che il kernel non fa da sé.
  void publishContext();
}

/// Il documento è aperto in **qualche** riquadro?
export function isOpen(id: string): boolean {
  return panesWithDoc(id).length > 0;
}

/// Risolve un wikilink e lo apre; se non risolve, crea la nota che manca col
/// nome scritto nel link (come in Obsidian). Il backlink c'è già prima ancora
/// che l'utente abbia scritto la prima riga — è il grafo a ricucirlo.
///
/// `heading` e `block` sono il **punto** che il link nomina, quando lo nomina.
/// Fino alla [0049](../../../docs/decisions/0181-modello-documento-e-arene.md)
/// arrivavano fin qui e si fermavano: la risposta di `resolve` sapeva dire
/// *quale documento* e non *dove dentro*, quindi `[[Nota#^blocco]]` apriva la
/// nota in cima e niente lo diceva. Adesso la posizione torna dal kernel e la
/// si porta a schermo con lo stesso `revealByteOffset` dell'outline — byte
/// UTF-8 → posizione editor, come per ogni altro span del modello.
///
/// **Da dove si sta guardando** è la seconda metà, ed era il buco: un
/// `[[#Sezione]]` non nomina una pagina, nomina *questa*, e chi arrivava qui
/// usciva su un `if (!page) return` — cioè un click che non faceva niente e non
/// diceva perché. Il documento corrente non si rilegge dallo stato: lo dice
/// `activeDoc()`, che è il proprietario di quella domanda (il riquadro col
/// fuoco, la sua tab attiva). A saperne fare qualcosa è il kernel, dove la
/// regola vale anche per chi non è questa shell.
export async function openWikilink(
  page: string,
  heading?: string,
  block?: string,
): Promise<void> {
  const target = await resolvedReference(
    { kind: "wiki", value: { page, heading: heading ?? null, block: block ?? null } },
    activeDoc() ?? undefined,
  );
  if (target) {
    await openDocument(target.doc);
    // Il punto può non esserci — un heading rinominato, un `^abc` cancellato —
    // e allora resta la nota aperta in cima: è il degrado dichiarato di
    // `ResolvedRef.at`, non un caso da nascondere.
    if (target.at) revealByteOffset(target.at.span.start);
    return;
  }
  // Un link senza pagina che non ha risolto non crea niente: non c'è un nome da
  // dare alla nota che si creerebbe, e crearla col nome vuoto sarebbe la
  // risposta peggiore di tutte.
  if (!page) return;
  const created = await createNote(page);
  if (created) await openDocument(created);
}

// --- salvataggio ------------------------------------------------------------
//
// Del **documento**, non del riquadro: due riquadri sulla stessa nota hanno un
// debounce solo, o due salvataggi in corsa scriverebbero due volte lo stesso
// testo e la seconda scrittura arriverebbe dopo un evento che dice che il file
// è cambiato.

/// Qualcuno ha scritto in un riquadro. Il pannello non valida niente e non
/// sincronizza nessuno: porta l'operazione tipizzata alla sessione, che la
/// misura sul testo autorevole, aggiorna una volta, programma il salvataggio
/// e diffonde l'esito ai pari. Se l'operazione non regge — una superficie
/// rimasta indietro — la sessione risponde col testo autorevole e questo
/// riquadro si riallinea, senza coprire la battuta arrivata altrove.
function written(paneId: string, change: EditorChange): void {
  const doc = activeDoc(paneId);
  if (!doc) return;
  const outcome = documentSessions.acceptSurfaceChange(doc, paneId, change);
  if (outcome.kind !== "realigned") return;
  const source = panes.get(paneId);
  if (source?.shown?.k === "doc" && source.shown.doc === doc) {
    source.surface?.syncDoc(outcome.text);
  }
}


/// Lo stato del salvataggio **del documento che si sta guardando**, nella barra
/// di stato.
///
/// Lì e non sulla tab, perché la tab ha già il pallino del non salvato e ha
/// spazio per una parola sola: il pallino dice *quale* nota ha qualcosa da
/// scrivere, questa riga dice *cosa le è successo*. E lì e non in un pannello,
/// perché è l'unica superficie della shell che c'è sempre e che non chiede di
/// essere aperta.
///
/// Se la shell non ha quell'elemento — un test, un host che monta un pezzo solo
/// — non succede niente: come per `notify`, il fatto non dipende dal suo disegno.
function drawSave(): void {
  const el = document.getElementById("save-state");
  if (!el) return;
  const doc = activeDoc();
  const state = doc ? documentSessions.saveState(doc) : null;
  if (!state) {
    el.textContent = "";
    delete el.dataset.state;
    return;
  }
  el.dataset.state = state;
  el.textContent = t(STATE_KEY[state]);
}

const STATE_KEY = {
  "salvato": "save.saved",
  "in_corso": "save.saving",
  "non_salvato": "save.unsaved",
  "fallito": "save.failed",
  "conflitto": "save.conflitto",
} as const;

async function applyExternalChange(id: string, outcome: ExternalChangeResult): Promise<void> {
  if (outcome.kind === "warning") {
    if (outcome.cause === "altra_app") {
      notify(t("document.overwritten", { doc: id }), "guasto");
    } else {
      notify(t("document.changed_on_disk", { doc: id }), "info");
    }
  } else if (outcome.kind === "echo" || outcome.kind === "untracked") {
    return;
  }
  // L'editor, quando il testo autorevole è cambiato, è già stato allineato
  // dalla sessione, che lo ha diffuso alle sue superfici. Qui resta la
  // lettura, che è del pannello.
  await redrawReading(id);
}

async function reloadDocument(id: string): Promise<void> {
  await documentSessions.reloadIfClean(id);
  await redrawReading(id);
}

/// Rilegge dal disco il documento attivo (usato dopo un ripristino di versione,
/// che riscrive il file sotto al buffer).
export async function reloadCurrent(): Promise<void> {
  const doc = state.currentDoc;
  if (!doc) return;
  await documentSessions.forceReload(doc);
  await redrawReading(doc);
  drawSave();
  redrawTabs(doc);
}

// --- contesto di sessione (decisione 0007) ----------------------------------
//
// La shell è l'unica a sapere quale riquadro ha il focus, che nota mostra, cosa
// c'è selezionato e in che modalità; il kernel lo custodisce e lo serve alle
// view via `HostApi::active_context`. Qui si decide solo *quando* pubblicarlo:
// **chi** ridisegnare lo dice il kernel, che conosce le `follows` di ogni view.
//
// Con N riquadri niente cambia di là dal confine, e questa è metà della
// decisione 0078: `ViewContext` porta un `pane` **dal primo giorno**, e il
// kernel custodisce «il contesto del riquadro col fuoco, e nient'altro». La
// domanda a cui risponde — cosa sta guardando l'utente adesso — è una sola per
// definizione, quanti che siano i riquadri.

/// Il contesto del riquadro col fuoco così com'è adesso.
///
/// Lo `span` della selezione c'è solo a buffer pulito: a buffer sporco gli
/// offset dell'editor sono di un testo che il kernel non ha, e uno span
/// mentitore farebbe tagliare i byte sbagliati a chiunque lo usi. Il testo
/// invece è sempre quello vero — ed è ciò che serve a contare le parole
/// selezionate o a mandarle a un comando.
function paneContext(): ViewContext {
  const p = activePane();
  const doc = activeDoc();
  const r = panes.get(layout.focus);
  const mode = selectedMode(r);
  const contextMode: PaneMode =
    mode?.contextMode ??
    (p.mode === "source" || p.mode === "live_preview" || p.mode === "reading"
      ? p.mode
      : "source");
  const sel = r?.surface?.selections?.();
  const inEditing = doc !== null && mode?.presentation !== "rendered" && sel !== undefined;
  const dirty = doc ? documentSessions.isDirty(doc) : false;
  if (!inEditing || !sel) {
    return { pane: layout.focus, doc, selections: null, mode: contextMode };
  }
  // Il buffer è UNO, e il suo stato decide per tutte le selezioni insieme: è
  // la ragione per cui il caso si sceglie qui, una volta, e non dentro ogni
  // selezione (decisione 0093). Prima di allora questa funzione pubblicava la
  // sola primaria: l'editor i cursori li faceva già, il contratto sapeva dirne
  // uno, e gli altri morivano qui.
  const selections: SelectionSet = dirty
    ? {
        kind: "floating",
        value: {
          primary: { text: sel.primary.text },
          secondary: sel.secondary.map((s) => ({ text: s.text })),
        },
      }
    : {
        kind: "anchored",
        value: {
          primary: { span: { start: sel.primary.start, end: sel.primary.end }, text: sel.primary.text },
          secondary: sel.secondary.map((s) => ({
            span: { start: s.start, end: s.end },
            text: s.text,
          })),
        },
      };
  return { pane: layout.focus, doc, selections, mode: contextMode };
}

/// Pubblica il contesto e annuncia **quali** view il kernel ha dichiarato
/// invecchiate. Chi le ridisegna è l'host dei pannelli (`ui/panel-host.ts`): il
/// verso passa dal bus e non da una chiamata, perché la catena che le monta
/// dipende già da questo modulo.
export async function publishContext(): Promise<void> {
  window.clearTimeout(contextTimer);
  try {
    emit("stale-views", await api.setActiveContext(paneContext()));
  } catch (e) {
    // Un vault non ancora aperto non ha un workspace: il contesto non ha dove
    // andare, e non è un errore da mostrare.
    console.debug(`Fub: contesto non pubblicato: ${errorText(e)}`);
  }
}

/// Il cursore si muove a ogni tasto; il kernel non deve saperlo a ogni tasto.
function scheduleContext(): void {
  window.clearTimeout(contextTimer);
  contextTimer = window.setTimeout(() => void publishContext(), 150);
}

/// Cambia la modalità del riquadro col fuoco (FEATURES 4.1) e la pubblica.
///
/// In lettura l'editor lascia il posto al documento **reso**: è la stessa cosa
/// che l'anteprima mostrava di lato, ma non è più un pannello sempre acceso
/// accanto all'editor — le tre modalità sono esclusive, e due superfici sullo
/// stesso documento sono due verità da tenere allineate.
///
/// Che sia **del riquadro** e non della finestra è la parte nuova, ed è ciò che
/// rende utile la divisione: la nota di lato in Lettura mentre si scrive è la
/// disposizione per cui si divide, e con una modalità globale non esisterebbe.
export async function setMode(next: string): Promise<void> {
  const r = panes.get(layout.focus);
  const mode = r?.surface?.modes.find((candidate) => candidate.id === next);
  if (!r?.surface || !mode) return;
  const doc = activeDoc();
  // Una presentazione resa nasce dal sorgente salvato: prima si svuota il
  // debounce, qualunque nome le abbia dato la superficie.
  if (mode.presentation === "rendered" && doc) await documentSessions.flush(doc);
  setPaneMode(layout.focus, mode.id);
  r.root.dataset.mode = mode.id;
  r.surface.setMode(mode.id);
  if (mode.presentation === "rendered") {
    if (doc) await updatePreview(r.previewEl, doc);
    if (doc) markReadingVersion(r.previewEl, documentSessions.isDirty(doc));
  } else {
    clearPreview(r.previewEl);
    r.surface.focus?.();
  }
  drawToolbar(r);
  drawConflict(r, doc);
  await publishContext();
}

/// Porta la vista su un offset in byte UTF-8 del documento attivo.
export function revealByteOffset(byteOffset: number): void {
  const pane = panes.get(layout.focus);
  if (!pane) return;
  if (selectedMode(pane)?.presentation !== "rendered") {
    pane.surface?.revealByteOffset?.(byteOffset);
    return;
  }
  sourceBlockAt(pane.previewEl, byteOffset)?.scrollIntoView({ block: "start" });
}

export function focusEditor(): void {
  panes.get(layout.focus)?.surface?.focus?.();
}

/// Porta gli editor nell'altra luce (§12.4).
///
/// Passa da qui e non da `theme/theme.ts` perché gli editor sono di questo
/// modulo: il modulo del tema non li conosce, e non deve — sa solo che
/// *qualcuno* vuole essere avvisato. La luce si ricorda anche per i riquadri che
/// non esistono ancora: uno nato dopo il cambio deve nascere già nella luce
/// giusta, non correggersi al prossimo.
export function setEditorTheme(t: Theme): void {
  theme = t;
  // U26: solo `setTheme` sulla superficie viva, mai `setDoc`/rimonto:
  // selezione, scroll e history restano dove sono.
  for (const r of panes.values()) r.surface?.setTheme?.(t);
}
