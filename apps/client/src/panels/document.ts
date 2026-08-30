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
import {
  isModefulSurface,
  surfaceModeId,
  type DocumentSurfaceRegistry,
  type EditorSurface,
  type SurfaceModeId,
  type SurfaceRequest,
  type SurfaceSelectionKey,
} from "../editors/core/registry";
import { surfaceRequestForDocument } from "../editors/bootstrap";
import type {
  MarkdownEditorSurface,
  TextEditorSurface,
  TextSurfaceMountContext,
} from "../editors/text/factories";
import type { EditorChange } from "../editors/text/engine";
import type {
  GridEditorSurface,
  GridSurfaceMountContext,
} from "../editors/grid/factory";
import type { GridDocumentChange } from "../editors/grid/engine";
import type { Theme } from "../theme/theme";
import { Queue } from "../ui/race";
import { api } from "../host/ipc";
import { resolvedReference, syntaxForms, unsavedDrafts } from "../host/query";
import type { PaneMode, SelectionSet, SyntaxForm, ViewContext } from "../host/contract";
import { onEvent } from "../state/kernel";
import { emit, on, state } from "../state/store";
import { CASE_KEY, caseOf, toRecover } from "../state/drafts";
import type { DraftInfo } from "../host/contract";
import {
  documentSessions,
  isDocumentDeletedDuringRead,
  type DocumentSessionEvent,
  type DocumentSurfaceUpdate,
  type ExternalChangeResult,
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
import { allCommands, registerShellCommand } from "../ui/commands";
import { notify } from "../ui/notify";
import { clearPreview, updatePreview } from "./preview";
import { mountViewInPane, unmountViewFromPane, primaryView } from "../ui/views";
import { errorText } from "../host/errors";
import { onLanguage, t } from "../i18n/strings";
import { setTooltip } from "../ui/tooltip";

export interface DocumentDeps {
  /// Registro delle superfici composto dalla shell. Il pannello monta qui la
  /// superficie scelta per ogni documento, senza conoscere le factory concrete.
  surfaceRegistry: DocumentSurfaceRegistry;
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
  tabsEl: HTMLElement;
  editorEl: HTMLElement;
  previewEl: HTMLElement;
  /// Dove finisce una view dichiarata che questo riquadro sta ospitando (§3.3).
  /// Vuoto quasi sempre: è la terza superficie di un riquadro, accanto
  /// all'editor e alla lettura, e come loro c'è anche quando non si vede.
  viewEl: HTMLElement;
  /// La superficie selezionata dal registro per il documento mostrato.
  /// La chiave è opaca: family e profile descrivono capability, non identità.
  surface: EditorSurface | null;
  selectionKey: SurfaceSelectionKey | null;
  surfaceDocumentId: string | null;
  /// Cosa c'è **adesso** in questo riquadro. Una linguetta e non un path: dalla §3.3
  /// può essere una view, e sapere quale evita di rimontarla a ogni giro.
  shown: Tab | null;
  loadGeneration: number;
  /// Il disposer della registrazione di questo riquadro alla sessione del
  /// documento mostrato. Null finché il riquadro non mostra un documento.
  disposeSurface: (() => void) | null;
}

const panes = new Map<string, Pane>();

const SOURCE_SURFACE_MODE = surfaceModeId("source");
const LIVE_PREVIEW_SURFACE_MODE = surfaceModeId("live_preview");
const READING_SURFACE_MODE = surfaceModeId("reading");

let panesEl: HTMLElement;
let sessionEventsStop: (() => void) | undefined;
let deps: DocumentDeps;
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
export function mountDocument(d: DocumentDeps): void {
  deps = d;
  panesEl = $("#panes");
  sessionEventsStop?.();
  sessionEventsStop = documentSessions.subscribe(handleSessionEvent);

  const modeSwitch = $("#mode-switch");
  modeSwitch.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.tagName !== "BUTTON") return;
    const surface = panes.get(layout.focus)?.surface;
    const spec = isModefulSurface(surface)
      ? surface.modes.find((candidate) => candidate.id === target.dataset.mode)
      : undefined;
    if (!spec) return;
    void setMode(spec.id);
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
  on("layout", () => {
    void synchronize().catch((e) => {
      notify(t("panes.redraw_failed", { reason: errorText(e) }), "guasto");
    });
  });

  onEvent("document_changed", (e, origin) => {
    void documentSessions.handleExternalChange(e.id, origin).then((outcome) => {
      void applyExternalChange(e.id, outcome);
    });
  });

  onEvent("document_removed", (e) => {
    const outcome = documentSessions.handleExternalRemoval(e.id);
    invalidateLoads(e.id);
    if (outcome.dirty) notify(t("document.deleted_dirty", { doc: e.id }), "guasto");
    removeEverywhere(e.id);
  });

  onEvent("document_renamed", (e) => {
    const outcome = documentSessions.rename(e.from, e.to);
    if (outcome.kind !== "collision") {
      // The layout still names the old path until `rename` below runs. Keep
      // those editors read-only across that tiny migration window.
      setReadOnlyForDocument(e.from, documentSessions.isDeletionPending(e.to));
      rename(e.from, e.to);
    }
  });

  onEvent("overflow", () => {
    // Eventi persi (coda troncata): ciò che deriviamo dagli eventi va
    // riconciliato da zero, non aggiornato.
    for (const id of openDocuments()) void reloadDocument(id);
  });

  // Il testo dello stato di salvataggio non passa da `applicaStringhe` — non ha
  // un `data-i18n`, perché lo scrive chi conosce lo stato — quindi si rifà da sé
  // al cambio di lingua, come fanno i due pulsanti della barra.
  onLanguage(() => {
    drawSave();
    updateToggle();
  });

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
    run: () => void setMode(READING_SURFACE_MODE),
  });
  registerShellCommand({
    id: "shell.mode.live",
    title: "commands.mode.live",
    description: "commands.mode.live.desc",
    run: () => void setMode(LIVE_PREVIEW_SURFACE_MODE),
  });
  registerShellCommand({
    id: "shell.pane.split.right",
    title: "commands.pane.split.right",
    description: "commands.pane.split.right.desc",
    run: () => splitPane("row"),
  });
  registerShellCommand({
    id: "shell.pane.split.down",
    title: "commands.pane.split.down",
    description: "commands.pane.split.down.desc",
    run: () => splitPane("col"),
  });
  registerShellCommand({
    id: "shell.pane.close",
    title: "commands.pane.close",
    description: "commands.pane.close.desc",
    run: () => void closeCurrentPane(),
  });
  registerShellCommand({
    id: "shell.tab.close",
    title: "commands.tab.close",
    description: "commands.tab.close.desc",
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
    run: () => void resolveKeepingMine(),
  });
  registerShellCommand({
    id: "shell.doc.conflict.theirs",
    title: "commands.doc.conflict.theirs",
    description: "commands.doc.conflict.theirs.desc",
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
}

async function closeCurrentTab(): Promise<void> {
  const p = activePane();
  const tab = activeTab();
  if (p.active < 0) return;
  closeTab(layout.focus, p.active);
  await releaseTab(layout.focus, tab);
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

    r.root.classList.toggle("focus", id === layout.focus);
    await show(r, activeTab(id));
    applyPaneMode(r);
  }
  updateToggle();
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
      // smonta una superficie: i suoi osservatori e i suoi ascoltatori restano,
      // perché guardano il proprio DOM e la finestra e non sanno niente di chi
      // sta sopra.
      if (r.shown?.k === "view") unmountViewFromPane(r.shown.view, id);
      // Prima la registrazione, poi il nodo: un disposer rimasto appeso è un
      // abbonamento a una sessione che il riquadro non mostra più.
      detachSurface(r);
      destroySurface(r);
      r.root.remove();
      panes.delete(id);
    }
  }
  panesEl.replaceChildren(node(layout.tree));
}

function node(n: LayoutNode): HTMLElement {
  if (n.k === "leaf") return renderPane(n.pane).root;
  const el = document.createElement("div");
  el.className = `pane-split ${n.dir}`;
  el.append(...n.children.map(node));
  return el;
}
function isTextSurface(
  surface: EditorSurface | null | undefined,
): surface is TextEditorSurface {
  if (!surface || surface.family !== "text") return false;
  return (
    "setDoc" in surface &&
    typeof surface.setDoc === "function" &&
    "syncDoc" in surface &&
    typeof surface.syncDoc === "function" &&
    "selections" in surface &&
    typeof surface.selections === "function" &&
    "revealByteOffset" in surface &&
    typeof surface.revealByteOffset === "function"
  );
}
function isGridSurface(
  surface: EditorSurface | null | undefined,
): surface is GridEditorSurface {
  if (!surface || surface.family !== "grid") return false;
  return (
    "setDoc" in surface &&
    typeof surface.setDoc === "function" &&
    "syncDoc" in surface &&
    typeof surface.syncDoc === "function"
  );
}

function isEditableDocumentSurface(
  surface: EditorSurface | null | undefined,
): surface is TextEditorSurface | GridEditorSurface {
  return isTextSurface(surface) || isGridSurface(surface);
}

function isMarkdownSurface(
  surface: EditorSurface | null | undefined,
): surface is MarkdownEditorSurface {
  if (!isTextSurface(surface) || surface.profile !== "markdown") return false;
  return (
    "setSyntaxForms" in surface &&
    typeof surface.setSyntaxForms === "function" &&
    "setLivePreview" in surface &&
    typeof surface.setLivePreview === "function"
  );
}

function effectiveMode(surface: EditorSurface | null | undefined): SurfaceModeId {
  if (!isModefulSurface(surface)) return SOURCE_SURFACE_MODE;
  const mode = surface.mode();
  return surface.modes.some((spec) => spec.id === mode) ? mode : surface.defaultMode;
}

function initialSurfaceMode(surface: EditorSurface, paneMode: PaneMode): SurfaceModeId {
  if (!isModefulSurface(surface)) return SOURCE_SURFACE_MODE;
  const persisted = surfaceModeId(paneMode);
  return surface.modes.find((spec) => spec.id === persisted)?.id ?? surface.defaultMode;
}

function projectSurfaceMode(mode: SurfaceModeId): PaneMode {
  if (mode === "live_preview") return "live_preview";
  if (mode === "reading") return "reading";
  return "source";
}

function isMarkdownReadingSurface(
  surface: EditorSurface | null | undefined,
): surface is MarkdownEditorSurface {
  return isMarkdownSurface(surface) && effectiveMode(surface) === READING_SURFACE_MODE;
}

function applyPaneMode(r: Pane): SurfaceModeId {
  const mode = effectiveMode(r.surface);
  r.root.dataset.mode = mode;
  r.root.classList.toggle("markdown-reading", isMarkdownReadingSurface(r.surface));
  return mode;
}

function surfaceMountContext(
  r: Pane,
  doc: string,
): TextSurfaceMountContext & GridSurfaceMountContext {
  return {
    paneId: r.id,
    documentId: doc,
    parent: r.editorEl,
    onChange: (change: EditorChange | GridDocumentChange) =>
      written(r.id, "edit" in change ? change.edit : change),
    onSelectionChange: () => {
      // Solo il riquadro col fuoco pubblica: il contesto di sessione è «cosa
      // sta guardando l'utente adesso», e con N riquadri la risposta resta una.
      if (layout.focus === r.id) scheduleContext();
    },
    theme: theme ?? undefined,
  };
}

function destroySurface(r: Pane): void {
  const surface = r.surface;
  r.surface = null;
  r.selectionKey = null;
  r.surfaceDocumentId = null;
  try {
    surface?.destroy();
  } finally {
    r.editorEl.removeAttribute("data-document-surface");
    r.editorEl.replaceChildren();
  }
}

function ensureSurface(r: Pane, doc: string, request: SurfaceRequest): boolean {
  const selected = deps.surfaceRegistry.select(request);
  if (
    r.surface !== null &&
    r.selectionKey === selected.key &&
    r.surfaceDocumentId === doc
  ) {
    return false;
  }

  if (r.surface !== null) {
    detachSurface(r);
    destroySurface(r);
  }
  let mounted: { key: SurfaceSelectionKey; surface: EditorSurface };
  try {
    mounted = deps.surfaceRegistry.mount(request, surfaceMountContext(r, doc));
  } catch (error) {
    r.surface = null;
    r.selectionKey = null;
    r.surfaceDocumentId = null;
    r.editorEl.removeAttribute("data-document-surface");
    r.editorEl.replaceChildren();
    throw error;
  }
  r.surface = mounted.surface;
  r.selectionKey = mounted.key;
  r.surfaceDocumentId = doc;
  r.editorEl.dataset.documentSurface = "";
  if (theme) r.surface.setTheme(theme);
  return true;
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

  const tabsEl = document.createElement("div");
  tabsEl.className = "pane-tabs";
  tabsEl.setAttribute("role", "tablist");

  const editorEl = document.createElement("div");
  editorEl.className = "pane-editor";

  const previewEl = document.createElement("div");
  previewEl.className = "pane-preview markdown-preview";
  previewEl.tabIndex = 0;

  // La terza superficie del riquadro (§3.3). Non è `declared-view` come nella
  // sidebar e non deve esserlo: là una view è un pannello con un titolo che si
  // apre e si chiude, qui **è** il contenuto del riquadro, e il titolo è già
  // sulla tab.
  const viewEl = document.createElement("div");
  viewEl.className = "pane-view";

  root.append(tabsEl, editorEl, previewEl, viewEl);
  // Toccare un riquadro gli dà il fuoco. `mousedown` e non `click` perché il
  // fuoco deve essere già di questo riquadro quando l'editor riceve l'evento:
  // altrimenti il contesto pubblicato subito dopo sarebbe quello di prima.
  root.addEventListener("mousedown", () => focusPane(id));
  root.addEventListener("focusin", () => focusPane(id));

  // Il chrome prepara solo il contenitore: la superficie concreta si conosce
  // quando `show` ha ricevuto il documento e passa dal registro.

  const r: Pane = {
    id,
    root,
    tabsEl,
    editorEl,
    previewEl,
    viewEl,
    surface: null,
    selectionKey: null,
    surfaceDocumentId: null,
    shown: null,
    loadGeneration: 0,
    disposeSurface: null,
  };
  panes.set(id, r);
  return r;
}

/// Disegna la striscia delle tab di un riquadro.
function drawTab(r: Pane, tabs: Tab[], active: number): void {
  r.tabsEl.replaceChildren(
    ...tabs.map((t0, i) => {
      const tab = document.createElement("button");
      tab.className = "tab";
      tab.setAttribute("role", "tab");
      // Quale tab è davanti lo dice **solo** `aria-selected`: la pelle lo
      // legge da qui. Finché c'era anche una classe `.active`, la stessa
      // cosa era scritta due volte e la seconda poteva restare indietro.
      tab.setAttribute("aria-selected", String(i === active));
      // Il `title` di una tab di documento è il **path intero**, perché due note
      // omonime in cartelle diverse sono il caso in cui il nome non basta. Una
      // view non ha un path: il suo titolo è già tutto ciò che c'è da sapere.
      setTooltip(tab, t0.k === "doc" ? t0.doc : nameTab(t0));

      const name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = nameTab(t0);
      // Il pallino del non salvato: è l'unica cosa che dica, guardando una tab
      // che non è quella davanti, che lì dentro c'è del lavoro in coda. Una view
      // non ha un buffer, quindi non si sporca.
      if (t0.k === "doc" && documentSessions.isDirty(t0.doc)) tab.classList.add("dirty");
      if (t0.k === "view") tab.classList.add("tab-view");

      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      setTooltip(close, t("app.close"));
      close.addEventListener("mousedown", (e) => {
        // `stopPropagation` o il click attiverebbe la tab che si sta chiudendo,
        // caricando un documento un istante prima di toglierlo.
        e.stopPropagation();
        e.preventDefault();
        closeTab(r.id, i);
        void releaseTab(r.id, t0);
      });

      tab.append(name, close);
      tab.addEventListener("click", () => activateTab(r.id, i));
      return tab;
    }),
  );
  r.tabsEl.hidden = tabs.length === 0;
  const open = active >= 0 ? nameTab(tabs[active]) : null;
  r.root.setAttribute(
    "aria-label",
    open ? t("pane.named", { name: open }) : t("pane.empty"),
  );
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
    return;
  }
  if (event.kind === "changed") {
    drawSave();
    redrawTabs(event.id);
    return;
  }
  if (event.kind === "draft-blind") {
    notify(t("draft.blind"), "guasto");
    return;
  }
  if (event.kind === "draft-discard-failed") {
    notify(
      t("draft.discard_failed", { doc: event.id, reason: errorText(event.error) }),
      "guasto",
    );
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
    return;
  }
  drawSave();
  redrawTabs(event.id);
  return publishContext().then(() => redrawReading(event.id));
}

function setReadOnlyForDocument(doc: string, readOnly: boolean): void {
  for (const paneId of panesWithDoc(doc)) {
    panes.get(paneId)?.surface?.setReadOnly(readOnly);
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
  // Cambia ciò che il riquadro mostra: la registrazione precedente alla
  // sessione precedente si toglie, chi attacca dopo lo farà con la nuova.
  if (changed) detachSurface(r);
  r.shown = tab;
  r.root.classList.toggle("con-vista", tab?.k === "view");

  if (tab?.k === "view") {
    // **Non condizionata a `cambiata`**, ed è voluto: `mountViewInPane` è
    // idempotente, e chiamarla a ogni giro è ciò che rimette in piedi le view
    // dei riquadri quando `mountDeclaredViews` azzera tutto per un vault nuovo.
    destroySurface(r);
    clearPreview(r.previewEl);
    await mountViewInPane(tab.view, r.id, r.viewEl);
    return;
  }
  if (!tab) {
    destroySurface(r);
    clearPreview(r.previewEl);
    return;
  }

  const request = surfaceRequestForDocument(tab.doc);
  const remounted = ensureSurface(r, tab.doc, request);
  r.surface?.setReadOnly(documentSessions.isDeletionPending(tab.doc));
  const pane = paneState(r.id);
  if (remounted && pane && isModefulSurface(r.surface)) {
    r.surface.setMode(initialSurfaceMode(r.surface, pane.mode));
  }
  if (!changed && !remounted) return;

  const documentSurface = isEditableDocumentSurface(r.surface) ? r.surface : null;
  const markdownSurface = isMarkdownSurface(r.surface) ? r.surface : null;
  if (!documentSurface) {
    // Fallback, viewer and error surfaces render their own visible state and
    // deliberately do not pretend to edit the document.
    clearPreview(r.previewEl);
    attachSurface(r, tab.doc);
    await redrawReading(tab.doc);
    return;
  }

  let text: string;
  let forms: SyntaxForm[];
  try {
    const formsPromise: Promise<SyntaxForm[]> = markdownSurface
      ? syntaxForms(tab.doc)
      : Promise.resolve([]);
    [text, forms] = await Promise.all([readBuffer(tab.doc), formsPromise]);
  } catch (error) {
    if (isDocumentDeletedDuringRead(error)) return;
    throw error;
  }
  if (generation !== r.loadGeneration || r.shown !== tab) return;
  markdownSurface?.setSyntaxForms(forms);
  documentSurface.setDoc(text);
  documentSurface.setReadOnly(documentSessions.isDeletionPending(tab.doc));
  // Il contenuto è a posto: da qui la sessione può raggiungere questo
  // riquadro come superficie, finché non mostra altro.
  attachSurface(r, tab.doc);
  await redrawReading(tab.doc);
}

/// La sottoscrizione di un riquadro alla sessione del documento mostrato.
/// L'identità di registrazione è l'id del riquadro: stabile per quanto il
/// riquadro vive, opaco per la sessione. Attacare due volte con lo stesso id
/// è la stessa superficie rimontata, non due superfici.
function attachSurface(r: Pane, doc: string): void {
  r.disposeSurface = documentSessions.attachSurface(doc, {
    id: r.id,
    sync: (update) => applySurfaceUpdate(r, doc, update),
  });
  r.surface?.setReadOnly(documentSessions.isDeletionPending(doc));
}

function detachSurface(r: Pane): void {
  r.disposeSurface?.();
  r.disposeSurface = null;
}

/// Applica alla superficie di questo riquadro il dato che la sessione ha
/// diffuso. `syncDoc` e non `setDoc`: il documento è lo stesso, è cambiato
/// il testo sotto — e chi lo sta guardando non perde il punto in cui era.
function applySurfaceUpdate(r: Pane, doc: string, update: DocumentSurfaceUpdate): void {
  if (r.shown?.k !== "doc" || r.shown.doc !== doc) return;
  const surface = isEditableDocumentSurface(r.surface) ? r.surface : null;
  if (isGridSurface(surface)) {
    surface.syncDoc(update.text);
  } else {
    surface?.syncDoc(
      update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text,
    );
  }
}


/// Il testo di un documento: dal buffer se qualcuno lo tiene già aperto, dal
/// disco altrimenti.
///
/// È qui che la regola del buffer unico si vede: aprire in un secondo riquadro
/// una nota con modifiche non salvate mostra **quelle modifiche**, non il file
/// su disco. L'alternativa — rileggere sempre dal disco — darebbe due riquadri
/// che mostrano due testi diversi dello stesso documento, che è esattamente ciò
/// che questa decisione esiste per non avere.
async function readBuffer(doc: string): Promise<string> {
  return documentSessions.read(doc);
}

/// Ridisegna la superficie di lettura di ogni riquadro che mostra questo
/// documento **ed è in Lettura**.
async function redrawReading(doc: string): Promise<void> {
  await Promise.all(
    panesWithDoc(doc).map(async (id) => {
      const r = panes.get(id);
      if (
        !r ||
        !isMarkdownReadingSurface(r.surface) ||
        activeDoc(id) !== doc
      )
        return;
      await updatePreview(r.previewEl, doc);
    }),
  );
}

/// Il commutatore in testata riflette il riquadro col **fuoco**: è di lui che si
/// sta parlando, ed è di lui che si cambia la modalità.
function updateToggle(): void {
  const switcher = $("#mode-switch");
  const surface = panes.get(layout.focus)?.surface;
  const modes = isModefulSurface(surface) ? surface.modes : [];
  const mode = effectiveMode(surface);
  const bindings = new Map(
    allCommands().map((entry) => [entry.id, entry.binding] as const),
  );
  const shortcuts: Record<string, readonly [string, string]> = {
    live_preview: ["shell.mode.live", "mode-live-key"],
    reading: ["shell.mode.reading", "mode-reading-key"],
  };
  const children: HTMLElement[] = [];

  for (const spec of modes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segmented-option";
    button.dataset.mode = spec.id;
    button.dataset.i18n = spec.labelKey;
    if (spec.hintKey) button.dataset.i18nTitle = spec.hintKey;
    button.setAttribute("aria-pressed", String(spec.id === mode));
    button.textContent = t(spec.labelKey as never);
    if (spec.hintKey) setTooltip(button, t(spec.hintKey as never));
    children.push(button);

    const shortcut = shortcuts[spec.id];
    if (!shortcut) continue;
    const key = document.createElement("kbd");
    key.id = shortcut[1];
    key.className = "titlebar-shortcut";
    key.setAttribute("aria-hidden", "true");
    const binding = bindings.get(shortcut[0]) ?? null;
    key.textContent = binding ?? "";
    key.hidden = binding === null;
    children.push(key);
  }

  switcher.replaceChildren(...children);
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
      if (effectiveMode(panes.get(layout.focus)?.surface) !== READING_SURFACE_MODE)
        focusEditor();
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
    const surface = isEditableDocumentSurface(source.surface) ? source.surface : null;
    surface?.syncDoc(outcome.text);
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
  const doc = activeDoc();
  const r = panes.get(layout.focus);
  const surface = isTextSurface(r?.surface) ? r.surface : null;
  const surfaceMode = effectiveMode(r?.surface);
  const mode = projectSurfaceMode(surfaceMode);
  const sel = surface?.selections();
  const inEditing = doc !== null && surfaceMode !== READING_SURFACE_MODE && sel !== undefined;
  const dirty = doc ? documentSessions.isDirty(doc) : false;
  if (!inEditing || !sel) {
    return { pane: layout.focus, doc, selections: null, mode };
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
  return { pane: layout.focus, doc, selections, mode };
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

/// Cambia la modalità della superficie nel riquadro col fuoco (FEATURES 4.1) e
/// pubblica la sua proiezione compatibile col contratto.
///
/// In lettura l'editor lascia il posto al documento **reso**: è la stessa cosa
/// che l'anteprima mostrava di lato, ma non è più un pannello sempre acceso
/// accanto all'editor — le tre modalità sono esclusive, e due superfici sullo
/// stesso documento sono due verità da tenere allineate.
///
/// Che sia **del riquadro** e non della finestra è la parte nuova, ed è ciò che
/// rende utile la divisione: la nota di lato in Lettura mentre si scrive è la
/// disposizione per cui si divide, e con una modalità globale non esisterebbe.
export async function setMode(next: SurfaceModeId): Promise<void> {
  const doc = activeDoc();
  const r = panes.get(layout.focus);
  const surface = r?.surface;
  if (
    !r ||
    !isModefulSurface(surface) ||
    !surface.modes.some((spec) => spec.id === next)
  ) {
    return;
  }

  surface.setMode(next);
  const mode = effectiveMode(surface);
  setPaneMode(layout.focus, projectSurfaceMode(mode));
  applyPaneMode(r);
  updateToggle();
  if (isMarkdownReadingSurface(surface)) {
    if (doc) {
      await documentSessions.flush(doc);
      await updatePreview(r.previewEl, doc);
    }
  } else {
    surface.focus();
  }
  await publishContext();
}

/// Porta la vista su un offset in byte UTF-8 del documento attivo.
export function revealByteOffset(byteOffset: number): void {
  const pane = panes.get(layout.focus);
  if (!pane) return;
  if (!isMarkdownReadingSurface(pane.surface)) {
    const surface = isTextSurface(pane.surface) ? pane.surface : null;
    surface?.revealByteOffset(byteOffset);
    return;
  }

  const encoder = new TextEncoder();
  const walker = document.createTreeWalker(pane.previewEl, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const text = current.textContent ?? "";
    const end = offset + encoder.encode(text).length;
    if (byteOffset <= end) {
      const element = current.parentElement?.closest<HTMLElement>(
        "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,section,div",
      );
      element?.scrollIntoView({ block: "start" });
      return;
    }
    offset = end;
  }
  pane.previewEl.lastElementChild?.scrollIntoView({ block: "start" });
}
export function focusEditor(): void {
  panes.get(layout.focus)?.surface?.focus();
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
  for (const r of panes.values()) r.surface?.setTheme(t);
}
