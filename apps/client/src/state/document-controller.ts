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
//
// Da quando le shell sono due, questo file è il **controller** dei riquadri:
// non crea e non disegna la loro cornice. Linguette, barre, banner e l'albero
// dei contenitori li disegna una vista, che arriva al montaggio e a cui si
// parla soltanto attraverso `PaneView`, dichiarata qui sotto. Della cornice
// restano qui i tre elementi che la vista consegna quando un riquadro nasce —
// la radice, il contenitore dell'editor e quello delle view — e nessuna classe,
// nessun selettore. La vista della shell di oggi è `panels/document.ts`.
import { pickFromList } from "../ui/dialogs";
import { rebaseStaleChange, type EditorChange } from "../editors/core/text-operation";
import { createDocumentSurfaceRegistry } from "../editors/core/bootstrap";
import {
  selectionSetOf,
  type DocumentSurfaceRegistry,
  type EditorSurface,
  type SourceView,
  type SurfaceExport,
  type SurfaceExportWindow,
  type SurfaceLocation,
  type SurfaceMode,
  type SurfaceOverride,
  type SurfaceAnchor,
  type SurfaceReference,
  type SurfaceRequest,
  type SurfaceScrollLink,
} from "../editors/core/registry";
import { modeForContext, offersContext, offersReadingToggle, readingToggleTarget } from "../editors/core/surface-modes";
import { draggedEntries, ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE } from "../ui/drag-types";
import { pageName } from "../rules/organizer";
import { folderForNote } from "../rules/mirrored";
import { looksLikeWebShortcut, webShortcut } from "../rules/web-shortcut";
import { declaredFences } from "../rules/syntax";
import { pdfIdWithoutFragment } from "../editors/media/pdf-view";
import { mediaKindOfId, mimeOfId } from "../editors/media/media-types";
import { openResourcePort, type ResourceTransport } from "../editors/media/resource-port";
import { vaultImageSource } from "../editors/text/profiles/markdown/media";
import { renderMarkdown } from "../editors/text/profiles/markdown/render";
import { blockIds, type BlockOption } from "../editors/text/profiles/markdown/completions";
import { depositAttachment, depositFiles, DEFAULT_ATTACHMENT_FOLDER, relativeUrl, type AttachmentDeposit } from "../editors/media/attachment-target";
import { createViewStateCrashDeposit } from "../editors/media/recorder-store";
import { mountRecorderSurface } from "../editors/media/recorder-surface";
import { printDocument } from "../editors/media/print-view";
import { mountSlidePresentation } from "../ui/slides";
import { mountMarkdown, mountRenderedDocument } from "../editors/text/profiles/markdown/mount";
import { applyNoteCssClasses } from "../theme/snippets";
import { Queue } from "../ui/race";
import { openWebPage } from "../ui/web-viewer";
import { invalidateDocumentCaches, renameInDocumentCaches } from "./document-caches";
import type { Theme } from "../theme/theme";
import { api } from "../host/ipc";
import { WITHOUT_PAGE, documentOutline, matchingDocuments, notesByName, renderPrint, resolvedReference, searchExpression, settings, vaultEntries, vaultTags } from "../host/query";
import { theseDocuments, type PaneMode, type SyntaxForm, type VaultEntry, type ViewContext } from "../host/contract";
import { existingRecentNotes } from "./recent";
import { linkPreference, markdownDestination, wikiPathCandidates, type LinkFormat, type LinkPreference } from "./note-links";
import { onEvent } from "./kernel";
import { drawingFonts } from "./drawing-fonts";
import { drawingSymbols } from "./drawing-symbols";
import { emit, on, state } from "./store";
import { CASE_KEY, caseOf, toRecover } from "./drafts";
import { addSheetNotice, clearAllRemovedNotices, clearSheetNotices, dismissSheetNotice, moveSheetNotices, setLimitedMode, setRemovedNotice } from "./sheet-notices";
import { syntaxForms, unsavedDrafts } from "../host/query";
import type { DraftInfo, Origin } from "../host/contract";
import {
  documentSessions,
  flushPendingSave,
  isDocumentDeletedDuringRead,
  type DocumentSessionEvent,
  type DocumentSurfaceDescriptor,
  type DocumentSurfaceUpdate,
  type ExternalChangeResult,
  type DocumentSurfaceSource,
} from "./document-session";
import { setDocumentWindowNavigation, type NavigateTarget } from "./document-bridge";
import {
  openIn,
  closePane,
  closeTab,
  closeOthers,
  closeUnpinned,
  goBack,
  goForward,
  moveTab,
  moveTabToPane,
  setPinnedTab,
  reopenClosedTab,
  cycleTab,
  goToTab,
  setPaneLink,
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
  activateTab,
  recentTabs,
  sameOverride,
  setTabOverride,
  tabOverride,
  activeTab,
  removeEverywhere,
  type LayoutNode,
  type Tab,
} from "./layout";
import { createNote, loadCommandSpecs, openVaultRoot, vaultArg } from "./vault";
import { confirm } from "../platform/confirm";
import { registerShellCommand } from "../ui/commands";
import { registerLiveCommands } from "../editors/spatial/live/commands";
import { VECTOR_PROFILE } from "../editors/spatial/modes";
import { EXPORT_COMMAND } from "../ui/shell-ids.generated";
import { showActivity } from "../panels/activity";
import { notify } from "../ui/notify";
import { applyIntent } from "../ui/intents";
import { slashContextDoc } from "./slash";
import { openSlashPalette, recentCommands, rememberCommand } from "../ui/palette";
import { slashMenuEntries } from "../panels/slash-menu";
import type { SelectionBox } from "../editors/core/editor-actions";
import { mountViewInPane, unmountViewFromPane, primaryView } from "../ui/views";
import { errorText } from "../host/errors";
import { onLanguage, t } from "../i18n/strings";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { writeClipboardText } from "../platform/clipboard";

export interface DocumentDeps {
  /// Click su un `#tag` nella vivi preview. Iniettato invece che importato:
  /// il pannello della ricerca apre i documenti, e questo li possiede — se si
  /// importassero a vicenda sarebbe un ciclo.
  searchTag(tag: string): void;
  /// Esegue un comando come la tastiera e la palette: per i pulsanti della
  /// barra di formattazione che non sono azioni dell'editor.
  runCommand(id: string): void;
}

/// I tre elementi di un riquadro che il controller tiene. Glieli dà la vista
/// quando il riquadro nasce, e restano della vista: il controller ci monta
/// dentro, non li ricrea e non li toglie dalla pagina.
export interface PaneElements {
  /// La radice del riquadro. Il controller ci scrive `data-mode` — la modalità
  /// della superficie montata —, ci applica le classi che la nota dichiara in
  /// `cssclasses` e le dà il fuoco quando il riquadro resta senza linguette.
  root: HTMLElement;
  /// Dove si monta la superficie del documento. Il controller lo svuota quando
  /// la superficie se ne va, e ci ascolta trascinamenti, rilasci e incolla.
  editorEl: HTMLElement;
  /// Dove si monta una view dichiarata che il riquadro ospita (§3.3).
  viewEl: HTMLElement;
}

/// Ciò che il controller chiede a chi disegna la cornice dei riquadri.
///
/// È la sola strada dal controller alla vista. Ogni chiamata arriva nel punto
/// in cui prima c'era il disegno, in sincrono, e nessuna restituisce una
/// promessa: la vista non fa aspettare la sequenza. Il verso opposto è libero —
/// la vista importa dal controller ciò che i suoi gesti chiedono
/// (`synchronize`, `releaseTab`, `closeTabAt`, `setMode`, …) e legge lo stato
/// di un riquadro da `paneOf`, senza scriverlo.
export interface PaneView {
  /// La vista trova il suo posto nella pagina. Una volta per montaggio, dopo
  /// il registro delle superfici e prima dell'iscrizione agli eventi di
  /// sessione; se il posto non c'è lancia, e il montaggio si ferma lì.
  attach(): void;
  /// La cornice di un riquadro nuovo, non ancora nella pagina. Una volta per
  /// id, da `renderPane`, finché `removePane` non la dimentica.
  createPane(id: string): PaneElements;
  /// Scioglie ciò che la cornice possiede oltre ai nodi — ascoltatori,
  /// iscrizioni, barre — senza toglierla dalla pagina.
  releaseFrame(pane: Pane): void;
  /// Toglie la radice dalla pagina e dimentica la cornice. Non scioglie ciò
  /// che scioglie `releaseFrame`: chi vuole le due cose le chiama in fila.
  removePane(pane: Pane): void;
  /// Dispone l'albero dei riquadri nella pagina. La radice di ogni foglia si
  /// chiede a `renderPane(id).root`, che crea il riquadro se è nuovo. Arriva
  /// soltanto quando la struttura è cambiata, dopo che i riquadri usciti
  /// dall'albero sono stati smontati.
  layoutTree(tree: LayoutNode): void;
  /// La striscia delle linguette di un riquadro, e il nome del riquadro.
  drawTabs(pane: Pane, tabs: Tab[], active: number): void;
  /// Il riquadro ha, o non ha, il fuoco del layout.
  drawFocus(pane: Pane, focused: boolean): void;
  /// Il riquadro mostra una view dichiarata al posto dell'editor, o l'editor.
  /// Arriva a ogni giro di disegno, prima che la superficie sia montata.
  drawViewSurface(pane: Pane, shown: boolean): void;
  /// La barra del riquadro: percorso, cronologia e modalità della superficie
  /// montata adesso (`pane.surface`, `selectedMode(pane)`).
  drawToolbar(pane: Pane): void;
  /// Il banner del conflitto per il documento attivo del riquadro, o niente.
  drawConflict(pane: Pane, doc: string | null): void;
  /// Lo stato del salvataggio del documento col fuoco. Senza un posto dove
  /// scriverlo non fa niente.
  drawSave(): void;
  /// Porta il fuoco della tastiera sulla linguetta a quell'indice.
  focusTab(pane: Pane, index: number): void;
  /// La linguetta col fuoco della tastiera, se il fuoco è su una linguetta: è
  /// quella su cui agiscono i comandi di tab.
  focusedTab(): { pane: string; index: number } | null;
  /// Dove si monta il registratore del riquadro.
  recorderHost(pane: Pane): HTMLElement;
}

/// Un riquadro **a schermo**: la sua parte di DOM, il suo editor, e quale
/// documento l'editor sta effettivamente mostrando.
///
/// `mostrato` non è ridondante con lo stato del layout: è ciò che c'è *adesso*
/// nell'editor, e serve a sapere quando caricare — senza, ogni giro di disegno
/// riscriverebbe il documento nell'editor e porterebbe via cursore e
/// cronologia.
export interface Pane {
  id: string;
  root: HTMLElement;
  editorEl: HTMLElement;
  /// Dove finisce una view dichiarata che questo riquadro sta ospitando (§3.3).
  /// Vuoto quasi sempre: è la seconda superficie di un riquadro, accanto
  /// all'editor, e come lui c'è anche quando non si vede.
  viewEl: HTMLElement;
  disposeAttachments: (() => void) | null;
  disposeRecorder: (() => void) | null;
  disposeSlides: (() => void) | null;
  disposePrint: (() => void) | null;
  noteClassGeneration: number;
  surface: EditorSurface | null;
  /// Cosa c'è **adesso** in questo riquadro. Una linguetta e non un path: dalla §3.3
  /// può essere una view, e sapere quale evita di rimontarla a ogni giro.
  shown: Tab | null;
  loadGeneration: number;
  /// Il disposer della registrazione di questo riquadro alla sessione del
  /// documento mostrato. Null finché il documento mostrato non c'è.
  disposeSurface: (() => void) | null;
  /// La vista sorgente che la superficie del documento mostrato dichiara
  /// (ADR 0203), risolta quando il documento si è letto: è ciò che «Apri come
  /// sorgente» apre, e ciò contro cui si controlla una scelta già fatta.
  /// Null senza documento, prima della lettura, o se non ce n'è una.
  sourceView: SourceView | null;
}
/// Nome breve della tab + stato testuale: non solo colore (U21).
/// View: titolo dichiarato, mai finto file.
export function describeTab(tab: Tab): { label: string; dirty: boolean; kind: "doc" | "view" } {
  if (tab.k === "view") return { label: nameTab(tab), dirty: false, kind: "view" };
  return { label: nameTab(tab), dirty: documentSessions.isDirty(tab.doc), kind: "doc" };
}
const panes = new Map<string, Pane>();
let sessionEventsStop: (() => void) | undefined;
let deps: DocumentDeps;
/// La vista arriva al montaggio. Prima c'è questa, che non disegna: lo stato
/// del salvataggio non ha dove scriversi — capita a un recupero di bozze
/// chiesto mentre la shell sta ancora nascendo, e lo disegna il primo giro di
/// `render` — e nessuna linguetta ha il fuoco. Il resto riguarda riquadri che
/// senza una vista non esistono: chi ci arriva ha saltato il montaggio.
let view: PaneView = {
  attach: unmounted,
  createPane: unmounted,
  releaseFrame: unmounted,
  removePane: unmounted,
  layoutTree: unmounted,
  drawTabs: unmounted,
  drawFocus: unmounted,
  drawViewSurface: unmounted,
  drawToolbar: unmounted,
  drawConflict: unmounted,
  drawSave: () => {},
  focusTab: unmounted,
  focusedTab: () => null,
  recorderHost: unmounted,
};
let surfaceRegistry: DocumentSurfaceRegistry;
let theme: Theme | null = null;
let closeDraining = false;

/// La firma dell'albero disegnato adesso. Ricostruire la struttura del DOM a
/// ogni segnale sarebbe corretto e sbagliato: sposta i nodi degli editor, che
/// per CodeMirror vuol dire perdere il fuoco a ogni click su una linguetta.
let treeSignature = "";

/// Pubblicazione del contesto: la selezione si muove a ogni tasto, il kernel
/// non deve saperlo a ogni tasto.
let contextTimer: number | undefined;

function unmounted(): never {
  throw new Error("The pane view is not mounted");
}

/// Il riquadro a schermo con questo id, per chi lo disegna: lo si legge, non
/// lo si scrive.
export function paneOf(id: string): Pane | undefined {
  return panes.get(id);
}

// --- montaggio --------------------------------------------------------------
async function createCanvasNote(text: string): Promise<string> {
  // Creazione, lettura e scrittura sono un gesto solo: stanno tutte nel vault
  // in cui il gesto è partito, anche se `createNote` aspetta e ne viene aperto
  // un altro (FUB-001).
  const vault = openVaultRoot();
  const doc = await createNote();
  if (!doc) throw new Error("note.create did not return a created document");
  const source = await api.readDocument(doc, vault);
  await api.writeDocument(doc, text, { kind: "descends_from", value: source.revision }, vault);
  return doc;
}

/// Quanti file del vault propone la scelta di una card file: gli altri si
/// contano in fondo all'elenco, e il path resta scrivibile nella card.
const CANVAS_FILE_CHOICES = 500;

/// Il file a cui punta una nuova card file del canvas: uno che c'è, scelto
/// dall'utente, non un segnaposto.
async function pickCanvasFile(): Promise<string | null> {
  const page = await vaultEntries({ offset: 0, limit: CANVAS_FILE_CHOICES });
  return pickFromList<string>({
    title: t("canvas.pick_file"),
    placeholder: t("canvas.pick_file_filter"),
    items: page.items.map((entry) => ({ label: pageName(entry.id), detail: entry.id, value: entry.id })),
    more: Math.max(0, page.total - page.offset - page.items.length),
  });
}

/// Il documento a cui porta un collegamento del disegno `from`: uno che c'è,
/// scelto dall'utente fra i file del vault, come il file di una card. Il
/// disegno stesso non c'è; quello a cui porta adesso il collegamento `current`,
/// se si trova, è già scelto, e c'è anche oltre le voci elencate.
async function pickDrawingLink(from: string, current: string | null): Promise<string | null> {
  const [page, now] = await Promise.all([
    vaultEntries({ offset: 0, limit: CANVAS_FILE_CHOICES }),
    current === null ? null : resolvedReference({ kind: "path", value: current }, from).catch(() => null),
  ]);
  const ids = page.items.map((entry) => entry.id).filter((id) => id !== from);
  const known = now?.doc ?? null;
  if (known !== null && known !== from && !ids.includes(known)) ids.unshift(known);
  return pickFromList<string>({
    title: t(current === null ? "vector.link.pick" : "vector.link.change"),
    placeholder: t("vector.link.filter"),
    items: ids.map((id) => ({ label: pageName(id), detail: id, value: id })),
    more: Math.max(0, page.total - page.offset - page.items.length),
    current: known ?? undefined,
  });
}

/// I byte dei file del vault, per chi li legge interi.
const mediaTransport: ResourceTransport = {
  open: (id, vault) => api.resourceOpen(id, vault ?? null),
  read_chunk: api.resourceReadChunk,
  close: api.resourceClose,
};

/// Un'immagine del vault che un disegno mostra per nome. Gli SVG non si
/// propongono: nel vault sono disegni, e a un disegno si porta un
/// collegamento.
function drawingImageChoice(id: string): boolean {
  return mediaKindOfId(id) === "image" && mimeOfId(id) !== "image/svg+xml";
}

/// Le immagini del vault, dalla più recente: l'anagrafe degli allegati letta a
/// pagine, tutta, perché l'elenco dica quante ne lascia fuori.
async function drawingImageEntries(): Promise<VaultEntry[]> {
  const found: VaultEntry[] = [];
  for (let offset = 0; ;) {
    const page = await vaultEntries({ offset, limit: CANVAS_FILE_CHOICES }, "asset");
    for (const entry of page.items) if (drawingImageChoice(entry.id)) found.push(entry);
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return found.sort((a, b) => b.mtime - a.mtime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/// L'immagine del vault da mettere in un disegno: una che c'è, scelta con la
/// sua miniatura fra le immagini del vault, le più recenti prima.
async function pickDrawingImage(): Promise<string | null> {
  const images = await drawingImageEntries();
  if (images.length === 0) {
    notify(t("vector.image.none"));
    return null;
  }
  const shown = images.slice(0, CANVAS_FILE_CHOICES);
  return pickFromList<string>({
    title: t("vector.image.pick"),
    placeholder: t("vector.image.filter"),
    items: shown.map((entry) => ({ label: pageName(entry.id), detail: entry.id, value: entry.id, thumbnail: vaultImageSource(entry.id) })),
    more: images.length - shown.length,
  });
}

/// L'immagine a cui porta l'`href` `path` del disegno `from`: il documento,
/// se c'è ed è un'immagine.
async function drawingImageId(path: string, from: string): Promise<string | null> {
  const id = (await resolvedReference({ kind: "path", value: path }, from).catch(() => null))?.doc ?? null;
  return id !== null && mediaKindOfId(id) === "image" ? id : null;
}

async function attachmentDeposit(doc: string): Promise<AttachmentDeposit> {
  // Il vault del documento che riceve gli allegati, preso prima di aspettare.
  const vault = openVaultRoot();
  const configured = (await settings()).find((entry) => entry.spec.key === "files.attachment-folder")?.value;
  const folder = typeof configured === "string" ? configured : DEFAULT_ATTACHMENT_FOLDER;
  return {
    folder,
    fromDocument: doc,
    write: (id, bytes) => api.resourceWrite(id, bytes, null, vault),
  };
}

/// Un'immagine remota di `doc` scaricata fra i suoi allegati, dopo il «sì»
/// dell'utente: la chiede l'host, che accetta soltanto `https` e il sito che
/// la domanda nomina, e il link che torna è relativo alla nota (L04). La
/// webview non la chiede mai alla rete.
async function importRemoteImage(url: string, doc: string): Promise<string | null> {
  let site: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(url);
    site = parsed.hostname;
  } catch {
    throw new Error(t("markdown.image_remote_not_https", { url }));
  }
  const vault = openVaultRoot();
  const deposit = await attachmentDeposit(doc);
  const folder = folderForNote(deposit.folder, doc);
  if (folder === "") throw new Error(t("markdown.image_remote_root"));
  const yes = await confirm(t("markdown.image_remote_confirm", { site, url }), {
    title: t("markdown.image_remote_title"),
    okLabel: t("markdown.image_remote_load"),
  });
  if (!yes) return null;
  const receipt = await api.viewerSave(url, "", [site], folder, vault);
  return relativeUrl(doc, receipt.id);
}

/** File/folder entries are expanded before the first asynchronous deposit. */
async function droppedFiles(data: DataTransfer): Promise<readonly File[]> {
  const entries = Array.from(data.items, (item) => item.kind === "file" ? item.webkitGetAsEntry?.() : null)
    .filter((entry): entry is FileSystemEntry => entry !== null && entry !== undefined);
  if (!entries.length) return Array.from(data.files);
  const files: File[] = [];
  async function visit(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!children.length) break;
      for (const child of children) await visit(child);
    }
  }
  for (const entry of entries) await visit(entry);
  return files;
}

/// I titoli della nota che un link nomina, risolta dalla nota corrente come la
/// risolverebbe il link; `page` vuota è la nota stessa.
async function noteHeadings(page: string): Promise<{ text: string; level: number }[]> {
  const from = slashContextDoc();
  const doc = page.trim() === ""
    ? from
    : (await resolvedReference({ kind: "wiki", value: { page, heading: null, block: null } }, from ?? undefined))?.doc;
  if (!doc) return [];
  return (await documentOutline(doc)).map(({ text, level }) => ({ text, level }));
}

/// I blocchi con un id della nota che `page` nomina: dal testo della sessione
/// aperta, che ha anche gli id non ancora salvati, o dal file.
async function noteBlocks(page: string): Promise<BlockOption[]> {
  const from = slashContextDoc();
  const doc = page.trim() === ""
    ? from
    : (await resolvedReference({ kind: "wiki", value: { page, heading: null, block: null } }, from ?? undefined))?.doc;
  if (!doc || !doc.toLowerCase().endsWith(".md")) return [];
  return blockIds(documentSessions.text(doc) ?? (await api.readDocument(doc)).text);
}

/// I titoli del vault che contengono `text`: le note che la ricerca trova per
/// quelle parole, e di ciascuna i titoli che le contengono davvero. Una finestra
/// di note, non il vault intero: si chiede a ogni battuta.
const HEADING_NOTES = 20;
async function vaultHeadings(text: string): Promise<{ doc: string; text: string; level: number }[]> {
  const wanted = text.trim().toLocaleLowerCase();
  if (wanted === "") return [];
  const found = await matchingDocuments(searchExpression(text), { offset: 0, limit: HEADING_NOTES }, "omit");
  const outlines = await Promise.all(found.items.map(async ({ doc }) =>
    (await documentOutline(doc).catch(() => []))
      .filter((heading) => heading.text.toLocaleLowerCase().includes(wanted))
      .map(({ text: title, level }) => ({ doc, text: title, level }))));
  return outlines.flat();
}

/// La superficie del riquadro col fuoco che sa dire il punto sotto il cursore,
/// col documento che mostra.
function focusedAnchorSurface(): { doc: string; anchorHere: () => SurfaceAnchor | null } | null {
  const r = panes.get(layout.focus);
  if (r?.shown?.k !== "doc" || !r.surface?.anchorHere) return null;
  const surface = r.surface;
  return { doc: r.shown.doc, anchorHere: () => surface.anchorHere?.() ?? null };
}

/// Ctrl+F fuori dal testo apre la stessa barra che apre dentro: quella della
/// superficie del riquadro col fuoco, se ne ha una nella modalità attuale.
export function findInFocusedSurface(): boolean {
  const r = panes.get(layout.focus);
  if (r?.shown?.k !== "doc") return false;
  return r.surface?.find?.() ?? false;
}

/// «Copia il link a questo punto»: `[[Nota#Titolo]]` o `[[Nota#^id]]` negli
/// appunti, scritto come vuole il vault, come per una nota trascinata; a un
/// blocco senza id la superficie ne scrive uno. Negli appunti un link Markdown
/// non sa ancora dove andrà, quindi parte dalla radice del vault.
async function copyAnchorLink(): Promise<void> {
  const focused = focusedAnchorSurface();
  if (!focused) return;
  const anchor = focused.anchorHere();
  if (!anchor) {
    notify(t("document.anchor_none"), "info");
    return;
  }
  const preference = await linkPreference();
  let link: string;
  if (preference.style === "markdown") {
    const point = anchor.kind === "block" ? `^${anchor.id}` : encodeURIComponent(anchor.text);
    const title = anchor.kind === "heading" ? anchor.text : pageName(focused.doc);
    link = `[${title.replace(/[[\]\\]/g, "\\$&")}](${markdownDestination("", focused.doc, "absolute")}#${point})`;
  } else {
    // I caratteri che un wikilink usa per sé non possono stare in un titolo
    // citato: chiuderebbero il link o ne aprirebbero un altro campo.
    const fragment = anchor.kind === "block" ? `^${anchor.id}` : anchor.text.replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim();
    link = `[[${await wikiTarget(focused.doc, preference.format)}#${fragment}]]`;
  }
  await writeClipboardText(link).then(
    () => notify(t("document.anchor_copied", { link }), "info"),
    () => notify(t("tabmenu.copy_failed"), "guasto"),
  );
}

/// Il riferimento più corto che porta davvero alla nota: il nome, poi il nome
/// con l'estensione, poi il percorso senza estensione, poi il percorso intero.
/// Lo decide la risoluzione del vault, non una regola copiata qui.
async function wikiReference(doc: string): Promise<string> {
  const fileName = doc.slice(doc.lastIndexOf("/") + 1);
  const withoutExtension = doc.replace(/\.[^./]+$/, "");
  return firstResolving(doc, [pageName(doc), fileName, withoutExtension]);
}

/// Il primo candidato che il vault risolve davvero a `doc`; altrimenti il
/// percorso intero, che è sempre una risposta.
async function firstResolving(doc: string, candidates: readonly string[]): Promise<string> {
  for (const candidate of candidates) {
    const resolved = await resolvedReference(
      { kind: "wiki", value: { page: candidate, heading: null, block: null } },
    ).catch(() => null);
    if (resolved?.doc === doc) return candidate;
  }
  return doc;
}

/// Il bersaglio di un wikilink secondo `files.link-format`: il nome più corto,
/// o il percorso dalla radice (un wikilink non ha forma relativa).
function wikiTarget(doc: string, format: LinkFormat): Promise<string> {
  return format === "shortest" ? wikiReference(doc) : firstResolving(doc, wikiPathCandidates(doc));
}

/// Il rimando a una nota scritto da dentro `from` come vuole il vault.
async function noteReference(from: string, doc: string, preference: LinkPreference): Promise<SurfaceReference> {
  if (preference.style === "markdown") {
    return { kind: "note", name: pageName(doc), link: markdownDestination(from, doc, preference.format) };
  }
  return { kind: "note", name: await wikiTarget(doc, preference.format) };
}

/// Gli allegati depositati entrano nel documento come rimandi: come si
/// scrivono lo decide la superficie, nella sintassi del suo formato.
function insertAttachmentLinks(r: Pane, doc: string, links: readonly string[]): void {
  if (r.shown?.k !== "doc" || r.shown.doc !== doc || !r.surface?.insertReferences ||
      closeDraining || documentSessions.isDeletionPending(doc)) return;
  const references = links.map((link): SurfaceReference => ({ kind: "attachment", link }));
  if (!r.surface.insertReferences(references)) {
    throw new Error(t("errors.document.no_editor"));
  }
}

/// Trascinare, rilasciare e incollare file o note: soltanto su una superficie
/// che sa scrivere un rimando nel suo documento.
function mountDocumentAttachments(r: Pane, doc: string): void {
  const surface = r.surface;
  if (!surface?.insertReferences) return;
  const life = openLifetime();
  r.disposeAttachments = () => life.close();
  const insert = (links: readonly string[]) => {
    if (!life.closed) insertAttachmentLinks(r, doc, links);
  };
  const fail = (error: unknown) => {
    if (!life.closed) notify(t("document.attachment_failed", { reason: errorText(error) }), "guasto");
  };
  const accept = (files: readonly File[]) => {
    if (life.closed || r.surface !== surface || closeDraining || documentSessions.isDeletionPending(doc)) {
      fail(new Error("The document is read-only or no longer open"));
      return;
    }
    void attachmentDeposit(doc).then((target) => {
      if (!life.closed && r.surface === surface && !closeDraining && !documentSessions.isDeletionPending(doc)) {
        return depositFiles(files, target, insert);
      }
    }).catch(fail);
  };
  life.listen(r.editorEl, "dragover", (event) => {
    const types = event.dataTransfer?.types ?? [];
    if (!types.includes("Files") && !types.includes(NOTE_DRAG_TYPE) && !types.includes(ENTRIES_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer!.dropEffect = "copy";
  }, { capture: true });
  life.listen(r.editorEl, "drop", (event) => {
    // Una nota dall'albero diventa un collegamento dove cade, non il suo
    // percorso scritto in chiaro.
    const note = event.dataTransfer?.getData(NOTE_DRAG_TYPE);
    if (note) {
      event.preventDefault();
      event.stopPropagation();
      const { clientX: x, clientY: y } = event;
      void linkPreference().then((preference) => noteReference(doc, note, preference)).then((reference) => {
        if (life.closed || r.surface !== surface) return;
        surface.insertReferences?.([reference], { x, y });
      });
      return;
    }
    // Più voci, o un file del vault: ogni nota un collegamento, ogni file un
    // rimando relativo al documento che lo riceve, nell'ordine dell'albero.
    const entries = draggedEntries(event.dataTransfer?.getData(ENTRIES_DRAG_TYPE));
    if (entries.length) {
      event.preventDefault();
      event.stopPropagation();
      const { clientX: x, clientY: y } = event;
      // Senza un punto vero (un rilascio sintetico) si scrive al cursore.
      const at = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
      void linkPreference().then((preference) => Promise.all(entries.map(async (each): Promise<SurfaceReference> =>
        each.note ? noteReference(doc, each.id, preference) : { kind: "attachment", link: relativeUrl(doc, each.id) },
      ))).then((references) => {
        if (life.closed || r.surface !== surface) return;
        surface.insertReferences?.(references, at);
      });
      return;
    }
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    const shortcuts = files.filter((file) => looksLikeWebShortcut(file.name, file.size));
    if (!shortcuts.length) {
      accept(files);
      return;
    }
    // Un `.webloc` o un `.url` diventa un link alla pagina dove cade; uno che
    // non si legge entra come gli altri file, allegato.
    const { clientX: x, clientY: y } = event;
    const at = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
    void Promise.all(shortcuts.map(async (file) => ({ file, link: webShortcut(file.name, await file.text()) }))).then((read) => {
      if (life.closed || r.surface !== surface) return;
      const links = read.flatMap(({ link }): SurfaceReference[] => (link ? [{ kind: "web", ...link }] : []));
      if (links.length) surface.insertReferences?.(links, at);
      const rest = files.filter((file) => !read.some((each) => each.file === file && each.link));
      if (rest.length) accept(rest);
    }).catch(fail);
  }, { capture: true });
  life.listen(r.editorEl, "paste", (event) => {
    if (!event.clipboardData?.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    accept(Array.from(event.clipboardData.files));
  }, { capture: true });
}

function refreshNoteClasses(r: Pane, doc: string): void {
  const generation = ++r.noteClassGeneration;
  void api.queryIndex({
    kind: "documents", matching: theseDocuments([doc]), sort: null,
    select: { kind: "keys", keys: ["cssclasses", "cssclass"] },
    page: { offset: 0, limit: 1 }, excerpts: "omit",
  }, ...vaultArg(openVaultRoot())).then((result) => {
    if (r.noteClassGeneration !== generation || r.shown?.k !== "doc" || r.shown.doc !== doc) return;
    if (result.kind !== "documents") throw new Error(`expected document properties, got ${result.kind}`);
    const properties = result.value.items[0]?.properties;
    const classes = properties?.find((item) => item.key === "cssclasses")?.value
      ?? properties?.find((item) => item.key === "cssclass")?.value;
    applyNoteCssClasses(r.root, classes);
  }).catch((error: unknown) => {
    if (r.noteClassGeneration === generation) notify(t("document.properties_unavailable", { reason: errorText(error) }), "guasto");
  });
}


/// Costruisce l'area principale e attacca i riquadri agli eventi che li
/// riguardano.
export function mountDocumentController(lifetime: Lifetime, d: DocumentDeps, paneView: PaneView): void {
  deps = d;
  view = paneView;
  // Una finestra documento a parte non apre niente da sé: i link e i tag che
  // vi si cliccano tornano qui, dove ci sono i riquadri e la ricerca.
  setDocumentWindowNavigation({ navigate: followRemote });
  lifetime.add(() => setDocumentWindowNavigation(null));
  lifetime.add(() => scrollLinks.close());
  // Il giro di Ctrl+Tab finisce quando si lascia il modificatore.
  lifetime.listen(document, "keyup", (event) => {
    if (event.key === "Control" || event.key === "Meta") recentRound = null;
  });
  lifetime.add(() => {
    recentRound = null;
  });
  surfaceRegistry = createDocumentSurfaceRegistry({
    onChange: written,
    onSelectionChange: (paneId) => {
      if (layout.focus === paneId) scheduleContext();
    },
    onOpenWikilink: (page, heading, block) =>
      openWikilink(page, heading ?? undefined, block ?? undefined),
    onOpenDocument: (doc) => openDocument(doc),
    onOpenPath: async (path, from) => {
      const target = await resolvedReference({ kind: "path", value: path }, from ?? activeDoc() ?? undefined);
      if (!target) throw new Error(t("preview.target_missing"));
      await openDocument(target.doc);
      if (target.at) await reveal(target.doc, { span: target.at.span });
    },
    onImportRemoteImage: importRemoteImage,
    onCreateCanvasNote: createCanvasNote,
    onPickCanvasFile: pickCanvasFile,
    onPickDrawingLink: pickDrawingLink,
    drawingImages: {
      url: async (path, from, owner) => {
        const id = await drawingImageId(path, from);
        return id === null ? null : vaultImageSource(id)(owner);
      },
      read: async (path, from, limit) => {
        const id = await drawingImageId(path, from);
        if (id === null) return null;
        const port = await openResourcePort(mediaTransport, id);
        try {
          if (limit !== undefined && port.descriptor.len > limit) return null;
          return new Blob([(await port.readAll()) as BlobPart], { type: port.descriptor.mime });
        } finally {
          await port.close();
        }
      },
      pick: () => pickDrawingImage(),
    },
    drawingFonts,
    drawingSymbols,
    renderCanvasMarkdown: (_nodeId, text, host, documentId, forms) => mountMarkdown(host, renderMarkdown(text, forms).html, {
      documentId,
      openWikilink: (page, heading, block) => openWikilink(page, heading, block),
      openPath: async (path, from) => {
        const target = await resolvedReference({ kind: "path", value: path }, from ?? documentId);
        if (!target) throw new Error(t("preview.target_missing"));
        await openDocument(target.doc);
        if (target.at) await reveal(target.doc, { span: target.at.span });
      },
      searchTag: (tag) => deps.searchTag(tag),
    }),
    canvasMedia: {
      openExternal: async () => { throw new Error(t("errors.document.no_external")); },
      // Il consenso, la barra e gli errori sono del visore della finestra.
      openViewer: async (url) => { await openWebPage(url); },
    },
    canvasAttachments: {
      expandFiles: droppedFiles,
      deposit: async (files, documentId) => {
        const deposit = await attachmentDeposit(documentId);
        const paths: string[] = [];
        for (const file of files) {
          if (file.size > 64 * 1024 * 1024) throw new Error(t("errors.attachment.too_large", { name: file.name }));
          const saved = await depositAttachment(deposit, file.name, new Uint8Array(await file.arrayBuffer()));
          paths.push(saved.receipt.id);
        }
        return paths;
      },
    },
    onSearchTag: (tag) => deps.searchTag(tag),
    slash: {
      currentDoc: slashContextDoc,
      onEffect: applyIntent,
      notify,
      flushPendingSave,
      publishContext,
      menu: {
        enabled: () => document.getElementById("app")?.dataset["slash"] !== "off",
        entries: (query, has) => slashMenuEntries(state.commandSpecs, query, has, recentCommands()),
        chosen: (entry, owner, anchor) => {
          rememberCommand(entry.id);
          if (!entry.action) runSlashCommand(owner, entry.id, "", anchor);
        },
      },
    },
    completions: {
      searchNotes: (prefix: string) =>
        (prefix.trim() ? notesByName(prefix) : existingRecentNotes()).catch(() => []),
      listTags: () => vaultTags(WITHOUT_PAGE).catch(() => []),
      headingsOf: (page: string) => noteHeadings(page).catch(() => []),
      searchHeadings: (text: string) => vaultHeadings(text).catch(() => []),
      blocksOf: (page: string) => noteBlocks(page).catch(() => []),
    },
    gridHost: api,
    exportDocument: {
      available: () => state.commandSpecs.some((spec) => spec.id === EXPORT_COMMAND),
      run: (doc, chosen) => void runExport(doc, chosen),
    },
    documentBase: (doc) => {
      const base = documentSessions.inspect(doc)?.base;
      return base?.kind === "descends_from" ? base.value : null;
    },
    media: {
      transport: mediaTransport,
      assetUrl: api.assetUrl,
      copyText: writeClipboardText,
      // Il comando del kernel, come dalla palette: crea le annotazioni accanto
      // al PDF, o apre quelle che ci sono.
      annotate: {
        available: () => state.commandSpecs.some((spec) => spec.id === "pdf.annotate"),
        run: async (pdf) => {
          try {
            const outcome = await api.invokeCommand("pdf.annotate", { pdf }, "apply");
            if (outcome.notify) notify(outcome.notify, outcome.partial ? "guasto" : "info");
            await applyIntent(outcome.effect);
          } catch (error) {
            notify(errorText(error), "guasto");
          }
        },
      },
    },
  });
  view.attach();
  sessionEventsStop?.();
  paintedSessions.clear();
  const stopSessionEvents = documentSessions.subscribe(handleSessionEvent);
  sessionEventsStop = stopSessionEvents;
  lifetime.add(() => {
    closeDraining = false;
    stopSessionEvents();
    paintedSessions.clear();
    if (sessionEventsStop === stopSessionEvents) sessionEventsStop = undefined;
    for (const r of panes.values()) {
      if (r.shown?.k === "view") unmountViewFromPane(r.shown.view, r.id);
      detachSurface(r);
      destroySurface(r);
      view.releaseFrame(r);
    }
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
  for (const event of ["index_updated", "batch_ended"] as const) {
    lifetime.add(onEvent(event, () => {
      for (const r of panes.values()) {
        if (r.shown?.k === "doc") refreshNoteClasses(r, r.shown.doc);
      }
    }));
  }

  // Un file che nessun formato serve — un `.svg`, un `.txt` aperto come
  // testo — non manda `document_*` ma `entry_*` (vedi `KernelEvent`): per chi
  // lo tiene aperto sono gli stessi tre fatti, e passano dalla stessa via. Per
  // un'immagine aperta nel visualizzatore la sessione non c'è, e resta il
  // riquadro: segue la rinomina e si chiude se il file sparisce.
  const changed = (id: string, origin: Origin): void => {
    void documentSessions.handleExternalChange(id, origin).then((outcome) => {
      void applyExternalChange(id, outcome);
    });
  };
  // `recreate` riceve il vault **in cui la rimozione è stata vista**: l'utente
  // può cliccare «ricrea» dopo aver aperto un altro vault, e la nota deve
  // tornare dove è sparita, non in un omonimo del vault nuovo (FUB-001).
  const removed = (id: string, recreate: (text: string, vault: string | undefined) => Promise<unknown>): void => {
    const vault = openVaultRoot();
    const shownIn = panesWithDoc(id);
    const outcome = documentSessions.handleExternalRemoval(id);
    clearSheetNotices(id);
    invalidateDocumentCaches(id);
    invalidateLoads(id);
    if (outcome.dirty && outcome.text !== undefined) {
      const text = outcome.text;
      notify(t("document.deleted_dirty", { doc: id }), "guasto", {
        label: t("document.recreate"),
        run: async () => {
          await recreate(text, vault);
          // Se nel frattempo si è aperto un altro vault, la nota è tornata nel
          // suo: aprire `id` qui aprirebbe un documento omonimo.
          if (openVaultRoot() === vault) await openDocument(id);
        },
      });
    }
    removeEverywhere(id);
    // La linguetta se n'è andata: l'avviso resta sul riquadro che la mostrava.
    const text = outcome.dirty ? outcome.text : undefined;
    for (const paneId of shownIn) {
      setRemovedNotice(paneId, text === undefined ? { doc: id } : { doc: id, recreate: async () => void (await recreate(text, vault)) });
      const r = panes.get(paneId);
      if (r) view.drawConflict(r, activeDoc(paneId));
    }
  };
  const renamed = (from: string, to: string): void => {
    const outcome = documentSessions.rename(from, to);
    if (outcome.kind !== "collision") {
      moveSheetNotices(from, to);
      renameInDocumentCaches(from, to);
      // The layout still names the old path until `rename` below runs. Keep
      // those editors read-only across that tiny migration window.
      setReadOnlyForDocument(from, documentSessions.isDeletionPending(to));
      rename(from, to);
    }
  };

  lifetime.add(onEvent("document_changed", (e, origin) => changed(e.id, origin)));
  lifetime.add(onEvent("entry_changed", (e, origin) => changed(e.id, origin)));
  lifetime.add(
    onEvent("document_removed", (e) =>
      removed(e.id, (text, vault) => api.writeDocument(e.id, text, { kind: "dictated" }, vault))),
  );
  // Ricreare un file senza formato è una creazione esclusiva a byte: se nel
  // frattempo qualcuno l'ha rifatto, la scrittura lo dice invece di coprirlo.
  lifetime.add(
    onEvent("entry_removed", (e) =>
      removed(e.id, (text, vault) => api.resourceWrite(e.id, new TextEncoder().encode(text), null, vault))),
  );
  lifetime.add(onEvent("document_renamed", (e) => renamed(e.from, e.to)));
  lifetime.add(onEvent("entry_renamed", (e) => renamed(e.from, e.to)));

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
      view.drawSave();
      // I titoli dei comandi (e dei pulsanti della barra) li traduce il kernel
      // quando li elenca: si richiedono nella lingua nuova.
      void loadCommandSpecs().catch((error: unknown) => {
        notify(t("commands.list_failed", { reason: errorText(error) }), "guasto");
      });
      for (const pane of panes.values()) view.drawToolbar(pane);
      for (const id of layoutPanes()) {
        const pane = panes.get(id);
        const current = paneState(id);
        if (pane && current) view.drawTabs(pane, current.tabs, current.active);
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

/// Il giro di `Ctrl+Tab`: l'ordine d'uso preso alla prima pressione e il punto
/// raggiunto. Finché il modificatore resta giù le pressioni scendono in quello
/// stesso ordine; lasciato, il giro finisce e la scheda scelta è la più recente.
let recentRound: { pane: string; order: Tab[]; at: number } | null = null;

function stepRecentTab(step: 1 | -1): void {
  const id = layout.focus;
  const p = layout.panes[id];
  if (!p || p.tabs.length < 2) return;
  const current = p.tabs[p.active];
  const round = recentRound;
  const going = round && round.pane === id && current && sameTab(current, round.order[round.at]!) ? round : null;
  const next = going ?? { pane: id, order: recentTabs(id).map((index) => p.tabs[index]!), at: 0 };
  next.at = (next.at + step + next.order.length) % next.order.length;
  recentRound = next;
  const index = p.tabs.findIndex((each) => sameTab(each, next.order[next.at]!));
  if (index < 0) return;
  activateTab(id, index);
  void synchronize();
}

function registerCommands(): void {
  // Le modalità come comandi (§18.2): erano bottoni nel commutatore, cioè
  // raggiungibili col mouse e con nient'altro. Passano dalla stessa porta del
  // click (`setMode`), che è dove sta il cablaggio — classe attiva, resa
  // inline, superficie di lettura, contesto pubblicato — e non da una seconda
  // via che deve restare d'accordo con la prima.
  //
  // Un comando nomina un ruolo e non un id: la superficie dichiara il ruolo di
  // ogni sua modalità (`contextMode`), e il comando raggiunge la modalità che
  // ce l'ha — la «canvas» della tela per Live, la «read» di un profilo che
  // chiama così la sua lettura. C'è soltanto dove porterebbe a qualcosa: una
  // superficie con una modalità sola non ne offre nessuno (`surface-modes.ts`).
  // Solo `Mod-e` ha un accordo: chi passa da Lettura a scrittura lo fa cento
  // volte al giorno, chi guarda il sorgente nudo lo fa per capire cosa c'è
  // scritto. Dalla scrittura porta in Lettura, dalla Lettura torna alla
  // modalità di scrittura da cui si era partiti.
  registerShellCommand({
    id: "shell.mode.reading",
    title: "commands.mode.reading",
    description: "commands.mode.reading.desc",
    layer: "surface",
    available: () => offersReadingToggle(focusedModes()),
    run: () => void toggleReading(),
  });
  registerShellCommand({
    id: "shell.mode.live",
    title: "commands.mode.live",
    description: "commands.mode.live.desc",
    layer: "profile",
    available: () => offersContext(focusedModes(), "live_preview"),
    run: () => void setContextMode("live_preview"),
  });
  registerShellCommand({
    id: "shell.mode.source",
    title: "commands.mode.source",
    description: "commands.mode.source.desc",
    layer: "profile",
    available: () => offersContext(focusedModes(), "source"),
    run: () => void setContextMode("source"),
  });
  // La vista sorgente di una scheda (ADR 0203): lo stesso documento, sulla
  // stessa sessione, nella superficie che la sua dichiara come sorgente — un
  // disegno come testo SVG. Aprirla, lì o accanto, si può dove la superficie
  // la offre e la scheda non la mostra già; tornare indietro, dove la scheda
  // la mostra: mai le due cose insieme.
  registerShellCommand({
    id: "shell.doc.source.open",
    title: "commands.doc.source.open",
    description: "commands.doc.source.open.desc",
    layer: "document",
    available: () => offeredSourceView(panes.get(layout.focus)) !== null,
    run: () => void openSourceView(),
  });
  registerShellCommand({
    id: "shell.doc.source.side",
    title: "commands.doc.source.side",
    description: "commands.doc.source.side.desc",
    layer: "document",
    available: () => offeredSourceView(panes.get(layout.focus)) !== null,
    run: () => void openSourceViewBeside(layout.focus),
  });
  registerShellCommand({
    id: "shell.doc.source.close",
    title: "commands.doc.source.close",
    description: "commands.doc.source.close.desc",
    layer: "document",
    available: () => tabOverride(activeTab()) !== null,
    run: () => void closeSourceView(),
  });
  // Gli export che la superficie del documento dichiara (`exports`): la sua
  // finestra, se ne ha una; se no, con uno solo il comando lo esegue, con più
  // d'uno chiede quale. Nel menu del riquadro sono una voce ciascuno, dopo
  // quella della finestra.
  registerShellCommand({
    id: "shell.doc.export",
    title: "commands.doc.export",
    description: "commands.doc.export.desc",
    layer: "document",
    available: () => offeredExports(panes.get(layout.focus)).length > 0,
    run: () => void chooseExport(layout.focus),
  });
  registerShellCommand({
    id: "shell.doc.copy_anchor_link",
    title: "commands.doc.copy_anchor_link",
    description: "commands.doc.copy_anchor_link.desc",
    layer: "document",
    available: () => focusedAnchorSurface() !== null,
    run: () => void copyAnchorLink(),
  });
  registerShellCommand({
    id: "shell.doc.save",
    title: "commands.doc.save",
    description: "commands.doc.save.desc",
    layer: "document",
    run: () => void saveNow(),
  });
  registerShellCommand({
    id: "shell.tab.reopen",
    title: "commands.tab.reopen",
    description: "commands.tab.reopen.desc",
    layer: "global",
    run: () => {
      if (reopenClosedTab()) void synchronize();
    },
  });
  registerShellCommand({
    id: "shell.tab.next",
    title: "commands.tab.next",
    description: "commands.tab.next.desc",
    layer: "global",
    run: () => {
      if (cycleTab(layout.focus, 1)) void synchronize();
    },
  });
  registerShellCommand({
    id: "shell.tab.previous",
    title: "commands.tab.previous",
    description: "commands.tab.previous.desc",
    layer: "global",
    run: () => {
      if (cycleTab(layout.focus, -1)) void synchronize();
    },
  });
  for (const [id, step] of [["shell.tab.recent", 1], ["shell.tab.recent.back", -1]] as const) {
    registerShellCommand({
      id,
      title: step === 1 ? "commands.tab.recent" : "commands.tab.recent.back",
      description: step === 1 ? "commands.tab.recent.desc" : "commands.tab.recent.back.desc",
      layer: "global",
      run: () => stepRecentTab(step),
    });
  }
  for (const [id, action, title, description] of [
    ["shell.fold.all", "text.fold.all", "commands.fold.all", "commands.fold.all.desc"],
    ["shell.unfold.all", "text.unfold.all", "commands.unfold.all", "commands.unfold.all.desc"],
    ["shell.fold.more", "text.fold.more", "commands.fold.more", "commands.fold.more.desc"],
    ["shell.fold.less", "text.fold.less", "commands.fold.less", "commands.fold.less.desc"],
    ["shell.fold.properties", "text.fold.properties", "commands.fold.properties", "commands.fold.properties.desc"],
  ] as const) {
    registerShellCommand({
      id,
      title,
      description,
      layer: "global",
      available: () => editorActionReady(action),
      run: () => void runEditorAction(action),
    });
  }
  for (const position of [1, 2, 3, 4, 5, 6, 7, 8, "last"] as const) {
    registerShellCommand({
      id: `shell.tab.go.${position}`,
      title: `commands.tab.go.${position}`,
      description: `commands.tab.go.${position}.desc`,
      layer: "global",
      run: () => {
        if (goToTab(layout.focus, position === "last" ? "last" : position - 1)) void synchronize();
      },
    });
  }
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
    run: () => void resolveKeepingMine(activeDoc()),
  });
  registerShellCommand({
    id: "shell.doc.conflict.theirs",
    title: "commands.doc.conflict.theirs",
    description: "commands.doc.conflict.theirs.desc",
    layer: "document",
    run: () => void resolveDiscardingMine(activeDoc()),
  });
  // La sessione live di un disegno (ADR 0205): i comandi pesano poco, la
  // sessione arriva quando si avvia.
  registerLiveCommands({
    focusedDoc: () => activeDoc(),
    focusedDrawing: () => {
      const pane = panes.get(layout.focus);
      return pane?.surface?.profile === VECTOR_PROFILE && pane.shown?.k === "doc" ? pane.shown.doc : null;
    },
  });
}

/// «Vince il mio testo»: la sessione esegue la decisione, questa funzione
/// aggiorna soltanto ciò che la shell disegna.
///
/// Il documento arriva da chi ha chiesto la decisione, non si rilegge qui: fra
/// la conferma e la risoluzione il riquadro attivo può essere cambiato, e la
/// scelta vale per la nota che il dialogo nominava.
export async function resolveKeepingMine(doc: string | null): Promise<void> {
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
export async function resolveDiscardingMine(doc: string | null): Promise<void> {
  if (!doc) {
    notify(t("document.conflict_none"), "info");
    return;
  }
  const outcome = await documentSessions.resolveConflict(doc, "theirs");
  if (outcome.kind === "none") {
    notify(t("document.conflict_none"), "info");
    return;
  }
  // La lettura mancata lascia il conflitto aperto: la scelta si può ripetere.
  if (outcome.kind === "discarded" && outcome.reload.kind === "unavailable") {
    notify(t("document.reload_failed", { doc }), "guasto");
  }
  redrawReading(doc);
  view.drawSave();
  redrawTabs(doc);
}

/// Divide il riquadro col fuoco e ci porta dentro **lo stesso documento**.
///
/// È ciò che serve nove volte su dieci — la stessa nota di lato, in Lettura,
/// mentre si scrive — ed è anche il primo cliente vero della regola del buffer
/// unico: le due superfici mostrano lo stesso testo perché *è* lo stesso testo.
/// Un riquadro nuovo e vuoto lo si ottiene chiudendo la linguetta, che è un gesto in
/// meno di quello che servirebbe per il contrario. Il documento ci arriva sulla
/// sua superficie, senza la vista sorgente della scheda di partenza: il disegno
/// da una parte e il suo testo dall'altra è proprio la disposizione per cui si
/// divide.
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
  if (nextActive >= 0) view.focusTab(pane, nextActive);
  else pane.root.focus();
}

export async function closeCurrentTab(): Promise<void> {
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
  if (nextActive >= 0) view.focusTab(pane, nextActive);
  else pane.root.focus();
}

/// Appunta o stacca la tab corrente (shell.tab.pin/unpin): stesso `run` di
/// contestuale, tastiera e palette, per la regola del §18.2.
export function pinCurrentTab(pinned: boolean): void {
  const id = layout.focus;
  const p = paneState(id);
  if (!p || p.active < 0) return;
  setPinnedTab(id, p.active, pinned);
  void synchronize();
}

/// La tab su cui agisce un comando di tab: quella col fuoco della tastiera, se
/// il fuoco è su una linguetta — le frecce della striscia la raggiungono senza
/// attivarla —, altrimenti l'attiva del riquadro col fuoco.
function commandTab(): { pane: string; index: number } | null {
  const focused = view.focusedTab();
  if (focused) return focused;
  const p = paneState(layout.focus);
  return p && p.active >= 0 ? { pane: layout.focus, index: p.active } : null;
}

/// Sposta la tab corrente di `delta` posizioni (shell.tab.move.left/right):
/// `-1` a sinistra, `+1` a destra. Fuori dai bordi = niente da fare.
export function moveCurrentTab(delta: -1 | 1): void {
  const at = commandTab();
  if (at && moveTab(at.pane, at.index, at.index + delta)) void synchronize();
}

/// Porta la tab corrente nel riquadro prima o dopo, in giro
/// (shell.tab.move.pane.previous/next). Un'appuntata resta dov'è: lo decide
/// `moveTabToPane`, come per il trascinamento e il contestuale.
export function moveCurrentTabToPane(delta: -1 | 1): void {
  const at = commandTab();
  if (!at) return;
  const order = layoutPanes();
  if (order.length < 2) return;
  const to = order[(order.indexOf(at.pane) + delta + order.length) % order.length]!;
  if (moveTabToPane(at.pane, at.index, to)) void synchronize();
}

/// Chiude le altre tab tenendo corrente + appuntate (shell.tab.close.others).
export function closeOtherTabs(): void {
  const id = layout.focus;
  const p = paneState(id);
  if (!p || p.active < 0) return;
  void closeOthersAndRelease(id, p.active);
}

/// Chiude le non appuntate del riquadro col fuoco (shell.tab.close.unpinned).
export function closeUnpinnedTabs(): void {
  void closeUnpinnedAndRelease(layout.focus);
}

/// Cronologia avanti/indietro del riquadro col fuoco (shell.pane.back/forward).
export function paneBack(): void {
  if (goBack(layout.focus)) void synchronize();
}

export function paneForward(): void {
  if (goForward(layout.focus)) void synchronize();
}

/// Collega o scollega il riquadro col fuoco (shell.pane.link/unlink): il
/// nome di default è `linked` — un gruppo solo, senza una seconda superficie
/// che deve restare d’accordo. Nome vuoto = scollegato.
export function linkCurrentPane(linked: boolean): void {
  setPaneLink(layout.focus, linked ? "linked" : null);
  void synchronize();
}

/// La Lettura accanto al testo (L03): il riquadro col fuoco resta nel modo in
/// cui si scrive (la Sorgente, se era in Lettura), quello nuovo a destra
/// mostra la Lettura dello stesso documento, e i due si collegano: scorrono
/// insieme (`linkScrolls`) e seguono le stesse aperture. Il collegamento è
/// quello che il riquadro aveva già, se ne aveva uno.
export async function showReadingBeside(): Promise<void> {
  const id = layout.focus;
  const r = panes.get(id);
  const doc = activeDoc(id);
  const surface = r?.surface;
  const reading = surface?.modes.find((mode) => mode.contextMode === "reading");
  const current = selectedMode(r);
  const writing = current && current.contextMode !== "reading"
    ? current
    : surface?.modes.find((mode) => mode.contextMode === "source") ?? surface?.modes.find((mode) => mode.contextMode !== "reading");
  if (!surface?.scrollLink || !doc || !reading || !writing) {
    notify(t("commands.pane.reading_beside.unavailable"), "info");
    return;
  }
  if (current?.id !== writing.id) await setMode(writing.id);
  const link = paneState(id)?.link ?? "linked";
  const added = split(id, "row");
  if (!added) return;
  setPaneMode(added, surface.family, reading.id);
  setPaneLink(id, link);
  setPaneLink(added, link);
  openIn(added, doc);
  focusPane(id);
  await synchronize();
  const point = surface.scrollLink.point();
  if (point) panes.get(added)?.surface?.scrollLink?.follow(point);
}

/// Gli ascolti che fanno scorrere insieme i riquadri collegati che mostrano
/// lo stesso documento: rifatti a ogni disegno, perché a ogni disegno possono
/// cambiare collegamenti, documenti e superfici. Il punto passa nelle
/// coordinate della sorgente, quindi Sorgente, Live e Lettura si seguono
/// anche con altezze diverse.
let scrollLinks = openLifetime();

function linkScrolls(): void {
  scrollLinks.close();
  const life = scrollLinks = openLifetime();
  const groups = new Map<string, SurfaceScrollLink[]>();
  for (const id of layoutPanes()) {
    const r = panes.get(id);
    const name = paneState(id)?.link;
    const link = r?.surface?.scrollLink;
    if (!name || !link || r?.shown?.k !== "doc") continue;
    const key = JSON.stringify([name, r.shown.doc]);
    groups.set(key, [...(groups.get(key) ?? []), link]);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const member of members) {
      life.add(member.onScroll(() => {
        const point = member.point();
        if (!point) return;
        for (const other of members) if (other !== member) other.follow(point);
      }));
    }
  }
}

/// Una linguetta è stata chiusa: si lascia andare ciò che teneva in vita.
///
/// Le due specie di linguetta hanno due cose diverse da rilasciare, e nessuna delle
/// due si raccoglie da sé: un documento ha un buffer che va **salvato** prima di
/// dimenticarlo, una view ha un pannello registrato e un albero montato. Che
/// stiano nella stessa funzione è ciò che tiene chi chiude una linguetta dal doversi
/// ricordare quale delle due aveva sotto le dita.
export async function releaseTab(paneId: string, tab: Tab | null): Promise<void> {
  if (!tab) return;
  if (tab.k === "doc") await dismissIfUnwatched(tab.doc, paneId);
  else unmountViewFromPane(tab.view, paneId);
}

/// Un documento che nessun riquadro mostra più viene rilasciato dalla sessione:
/// il flush, la bozza e la chiusura sono una sola decisione del suo owner.
async function dismissIfUnwatched(doc: string, paneId: string = layout.focus): Promise<void> {
  if (panesWithDoc(doc).length > 0) return;
  const outcome = await documentSessions.release(doc);
  if (outcome.kind === "unsaved") await keepOrDiscardUnsaved(doc, paneId);
}

/// La linguetta è già chiusa, ma il buffer non si è potuto salvare: la sessione
/// è ancora viva, ed è l'unica copia del lavoro. Si chiede, e senza una
/// risposta esplicita la nota torna aperta dov'era.
async function keepOrDiscardUnsaved(doc: string, paneId: string): Promise<void> {
  const discard = await confirm(t("document.close_unsaved", { doc: pageName(doc) }), {
    title: t("document.close_unsaved.title"),
    okLabel: t("document.close_unsaved.discard"),
    cancelLabel: t("document.close_unsaved.keep"),
    danger: true,
  }).catch(() => false);
  // Nel frattempo qualcuno può averla riaperta: allora ha già un riquadro.
  if (panesWithDoc(doc).length > 0) return;
  if (discard) {
    documentSessions.discardUnsaved(doc);
    return;
  }
  openIn(paneState(paneId) ? paneId : layout.focus, doc);
  await synchronize();
  view.drawSave();
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

/// Smonta ogni riquadro e chiude ogni sessione prima di un vault nuovo.
///
/// Le sessioni sono indicizzate per path, e due vault hanno spesso le stesse
/// note (`Benvenuto.md`): senza questo passo il vault nuovo riusava buffer,
/// superficie e coda di salvataggio del vecchio. Chi chiama ha già svuotato
/// la coda di salvataggio; ciò che resta sporco viene restituito.
export function resetDocumentsForVault(): Promise<string[]> {
  return drawQueue.enqueue(async () => {
    clearAllRemovedNotices();
    for (const [id, r] of panes) {
      if (r.shown?.k === "view") unmountViewFromPane(r.shown.view, id);
      detachSurface(r);
      destroySurface(r);
      view.removePane(r);
    }
    panes.clear();
    writingModes.clear();
    treeSignature = "";
    return documentSessions.closeAll();
  });
}

async function render(): Promise<void> {
  buildStructure();
  const active = activeDoc();
  let failure: { error: unknown } | null = null;
  for (const id of layoutPanes()) {
    const r = panes.get(id);
    const p = paneState(id);
    if (!r || !p) continue;
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
    const mode = selectedMode(r);
    if (mode) r.root.dataset.mode = mode.id;
    else delete r.root.dataset.mode;
    view.drawToolbar(r);
    view.drawConflict(r, activeDoc(id));
  }
  view.drawSave();
  linkScrolls();
  if (state.currentDoc !== active) {
    state.currentDoc = active;
    emit("active-doc", active);
  }
  if (failure) throw failure.error;
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

function redrawTabs(doc: string): void {
  for (const paneId of panesWithDoc(doc)) {
    const r = panes.get(paneId);
    const p = paneState(paneId);
    if (r && p) view.drawTabs(r, p.tabs, p.active);
  }
}

/// Ciò che tab, stato di salvataggio e banner mostrano della sessione di un
/// documento, com'era all'ultimo ridisegno. Ogni battuta emette `changed`, ma
/// di rado cambia qualcosa di visibile: ridisegnare lo stesso a ogni carattere
/// ridipingeva tutte le tab e forzava un layout (`scrollIntoView`).
const paintedSessions = new Map<string, string>();

/// Registra l'aspetto della sessione; falso se è quello già disegnato.
function sessionLookChanged(doc: string): boolean {
  const state = documentSessions.saveState(doc);
  if (state === null) {
    paintedSessions.delete(doc);
    return true;
  }
  const look = `${state}|${documentSessions.isDirty(doc)}|${documentSessions.isDeletionPending(doc)}`;
  if (paintedSessions.get(doc) === look) return false;
  paintedSessions.set(doc, look);
  return true;
}

function handleSessionEvent(event: DocumentSessionEvent): void | Promise<void> {
  // Gli altri eventi ridisegnano comunque: il gate va tenuto al passo.
  const looksDifferent = sessionLookChanged(event.id);
  if (event.kind === "deletion-changed") {
    setReadOnlyForDocument(event.id, event.pending);
    view.drawSave();
    redrawTabs(event.id);
    drawPaneConflict(event.id);
    return;
  }
  if (event.kind === "changed") {
    if (!looksDifferent) return;
    view.drawSave();
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
      // La bozza resta sporca e il salvataggio automatico ci riprova alla
      // prossima battuta; «Riprova» serve a chi non vuole scrivere per salvare.
      notify(t("document.save_failed", { doc: event.id, reason: errorText(event.error) }), "guasto", {
        label: t("app.retry"),
        run: saveNow,
      });
    }
    view.drawSave();
    redrawTabs(event.id);
    drawPaneConflict(event.id);
    return;
  }
  view.drawSave();
  redrawTabs(event.id);
  drawPaneConflict(event.id);
  if (event.kind === "saved") {
    // Il testo è su disco: ciò che l'avviso diceva di non ancora deciso è
    // passato. La bozza ritrovata no: dice da dove viene il testo, e il
    // salvataggio automatico che la scrive non lo cambia.
    for (const kind of ["changed_on_disk", "overwritten"] as const) dismissSheetNotice(event.id, kind);
    drawPaneConflict(event.id);
    redrawReading(event.id);
  }
  return publishContext();
}

/// Ridisegna il banner conflitto dei riquadri che mostrano questo documento.
/// Solo ridisegno + comandi esistenti; mai semantica sessione (R01-R04 intatti).
function drawPaneConflict(doc: string): void {
  for (const paneId of panesWithDoc(doc)) {
    const r = panes.get(paneId);
    if (r && activeDoc(paneId) === doc) view.drawConflict(r, doc);
  }
}

function setReadOnlyForDocument(doc: string, readOnly: boolean): void {
  for (const paneId of panesWithDoc(doc)) {
    panes.get(paneId)?.surface?.setReadOnly?.(readOnly || closeDraining);
  }
}

/** Ferma gli input locali prima del drain delle finestre e del salvataggio. */
export function freezeDocumentSurfaces(frozen: boolean): void {
  closeDraining = frozen;
  for (const [paneId, pane] of panes) {
    const doc = activeDoc(paneId);
    if (doc) pane.surface?.setReadOnly?.(frozen || documentSessions.isDeletionPending(doc));
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
async function show(r: Pane, tab: Tab | null): Promise<void> {
  const generation = ++r.loadGeneration;
  const changed = !r.shown || !tab || !sameTab(r.shown, tab)
    || !sameOverride(tabOverride(r.shown), tabOverride(tab));
  // Una view che se ne va porta con sé il suo pannello: senza, resterebbe
  // registrata a ridisegnarsi dentro un elemento che nessuno guarda.
  if (changed && r.shown?.k === "view") unmountViewFromPane(r.shown.view, r.id);
  // Sessione e superficie hanno ownership separate, ma terminano nello stesso
  // cambio di tab: prima si interrompe il flusso, poi si smonta l'istanza.
  if (changed) {
    detachSurface(r);
    destroySurface(r);
    r.sourceView = null;
  }
  r.shown = tab;
  view.drawViewSurface(r, tab?.k === "view");

  if (tab?.k === "view") {
    await mountViewInPane(tab.view, r.id, r.viewEl, tab.params ?? null);
    return;
  }
  if (!changed) return;
  if (!tab) {
    return;
  }

  // Un file che nessun formato del vault gestisce e che il registro sa
  // mostrare dai byte (un'immagine, un PDF) non ha una sorgente UTF-8: la
  // superficie dei byte possiede soltanto il suo prestito della risorsa, e la
  // sessione di testo resta dei documenti di testo. Un formato del vault per
  // la stessa estensione passa invece dal descrittore, come ogni documento.
  if (!handledByVault(tab.doc) && surfaceRegistry.showsBytes(tab.doc)) {
    // Dai byte non c'è un testo da guardare come sorgente: una scelta rimasta
    // sulla scheda (uno stato scritto a mano, un file cambiato di natura) si
    // scarta, e il visualizzatore si monta come sempre.
    tab = forgetOverride(r, tab);
    const surface = surfaceRegistry.mount(
      { formatId: null, sourceKind: "bytes", documentId: tab.doc },
      { paneId: r.id, documentId: tab.doc, parent: r.editorEl },
    );
    r.surface = surface;
    surface.setMode("view");
    r.root.dataset.mode = "view";
    if (theme) surface.setTheme?.(theme);
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
    if (generation !== r.loadGeneration || r.shown !== tab) return;
    showSurfaceError(r, tab.doc, error);
    forgetFailedRead(r);
    return;
  }
  if (generation !== r.loadGeneration || r.shown !== tab) return;
  // Durante le due attese un altro riquadro può aver cambiato la sessione, e
  // la sottoscrizione non riporta ciò che è passato prima di lei: il testo da
  // montare si prende adesso, senza attese fino a `attachSurface`.
  const text = documentSessions.text(tab.doc) ?? source.text;

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

  let surface: EditorSurface;
  try {
    surface = surfaceRegistry.mount(
      { ...request, ...(tab.override ? { override: tab.override } : {}) },
      {
        paneId: r.id,
        documentId: tab.doc,
        parent: r.editorEl,
        formatId: source.formatId,
        revision: source.revision,
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
  r.root.dataset.mode = mode.id;
  if (theme) surface.setTheme?.(theme);
  surface.setSyntaxForms?.(forms);
  try {
    surface.buffer?.setDoc(text);
  } catch (error) {
    destroySurface(r);
    showSurfaceError(r, tab.doc, error);
    return;
  }
  surface.setReadOnly?.(closeDraining || documentSessions.isDeletionPending(tab.doc));
  // Il contenuto è a posto: da qui la sessione può raggiungere questo
  // riquadro come superficie, finché non mostra altro.
  attachSurface(r, tab.doc);
  refreshNoteClasses(r, tab.doc);
  mountDocumentAttachments(r, tab.doc);
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

/// Un formato del vault gestisce il file: lo dicono le estensioni dei
/// provider registrati nel backend, non la tabella dei media della shell.
function handledByVault(doc: string): boolean {
  const base = pdfIdWithoutFragment(doc).split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  return point > 0 && state.handledExtensions.includes(base.slice(point + 1).toLowerCase());
}

/// Un file che nessun formato del vault gestisce si apre soltanto se una
/// superficie registrata sa mostrarlo: dai suoi byte (un'immagine, un PDF) o
/// come testo con un profilo suo (un SVG). L'esploratore chiede qui, invece di
/// ripetere la classificazione della shell.
export function canShowFile(id: string): boolean {
  return surfaceRegistry?.opensWithoutFormat(id) ?? false;
}

/// Il file si mostra dai byte e non ha un testo da condividere: una finestra
/// staccata, che monta soltanto un `TextEngine`, non ha niente da scrivere.
export function showsFileBytes(id: string): boolean {
  return surfaceRegistry?.showsBytes(id) ?? false;
}

/// Il profilo di testo con cui il registro mostrerebbe questo documento, o
/// `null` se la sua superficie non è di testo: una tela, un foglio, una base
/// hanno un motore che una finestra con il solo `TextEngine` non sa montare.
export function textProfileFor(id: string, source: DocumentSurfaceDescriptor): string | null {
  const resolved = surfaceRegistry?.resolve({ formatId: source.formatId, sourceKind: source.sourceKind, documentId: id });
  return resolved?.family === "text" ? resolved.profile : null;
}

async function followRemote(target: NavigateTarget, from: string): Promise<void> {
  try {
    if (target.kind === "tag") {
      deps.searchTag(target.tag);
      return;
    }
    if (target.kind === "wikilink") {
      await openWikilink(target.page, target.heading ?? undefined, target.block ?? undefined, from);
      return;
    }
    const resolved = await resolvedReference({ kind: "path", value: target.path }, from);
    if (!resolved) throw new Error(t("preview.target_missing"));
    await openDocument(resolved.doc);
    if (resolved.at) await reveal(resolved.doc, { span: resolved.at.span });
  } catch (error) {
    const page = target.kind === "wikilink" ? target.page : target.kind === "path" ? target.path : target.tag;
    notify(t("preview.open_failed", { page, reason: errorText(error) }), "guasto");
  }
}

/// Una lettura fallita non lascia la tab «mostrata»: la superficie d'errore
/// dice il motivo, ma la prossima sincronizzazione deve poter riprovare invece
/// di trovarla già a posto. Un disco che non risponde è spesso un momento, non
/// il contenuto del documento.
function forgetFailedRead(r: Pane): void {
  r.shown = null;
}

/// La politica d'errore di ogni formato: un documento che non si legge, una
/// superficie che non si monta o che non accetta il testo mostrano la
/// superficie d'errore col motivo, invece di un riquadro vuoto o del contenuto
/// di prima.
///
/// La superficie d'errore resta iscritta alla sessione del documento, se c'è:
/// quando il testo cambia (l'altra app lo ripara, un undo lo riporta indietro)
/// il riquadro riprova a montare la superficie vera.
function showSurfaceError(r: Pane, doc: string, error: unknown): void {
  const surface = surfaceRegistry.mount(
    { formatId: null, sourceKind: "text", documentId: doc, override: { family: "error" } },
    { paneId: r.id, documentId: doc, parent: r.editorEl, errorReason: errorText(error) },
  );
  r.surface = surface;
  surface.setMode("error");
  r.root.dataset.mode = "error";
  if (theme) surface.setTheme?.(theme);
  if (documentSessions.text(doc) === null) return;
  r.disposeSurface = documentSessions.attachSurface(doc, {
    id: surface.surfaceId,
    sync: () => retryShow(r, doc),
  });
}

/// Rimonta la superficie di un riquadro fermo sulla superficie d'errore, se
/// mostra ancora quel documento.
function retryShow(r: Pane, doc: string): void {
  const tab = r.shown;
  if (tab?.k !== "doc" || tab.doc !== doc) return;
  detachSurface(r);
  destroySurface(r);
  r.shown = null;
  void synchronize().catch((error) => console.error(error));
}

/// Una superficie che non accetta più il testo della sessione (un canvas
/// diventato JSON invalido, uno sheet rotto da una sync) non deve restare a
/// mostrare il contenuto di prima: chi la guarda crederebbe di modificare un
/// documento che non si salva. Passa alla superficie d'errore.
function failSurface(r: Pane, doc: string, error: unknown): void {
  detachSurface(r);
  destroySurface(r);
  showSurfaceError(r, doc, error);
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
  surface.setReadOnly?.(closeDraining || documentSessions.isDeletionPending(doc));
}

function detachSurface(r: Pane): void {
  r.disposeSurface?.();
  r.disposeSurface = null;
}

function destroySurface(r: Pane): void {
  r.noteClassGeneration++;
  applyNoteCssClasses(r.root, null);
  r.disposeAttachments?.();
  r.disposeAttachments = null;
  r.disposeRecorder?.();
  r.disposeRecorder = null;
  r.disposeSlides?.();
  r.disposeSlides = null;
  r.disposePrint?.();
  r.disposePrint = null;
  r.surface?.destroy();
  r.surface = null;
  r.editorEl.replaceChildren();
}

/// Applica alla superficie di questo riquadro il dato che la sessione ha
/// diffuso, se ne tiene il testo. `syncDoc` e non `setDoc`: il documento è lo
/// stesso, è cambiato il testo sotto — e chi lo sta guardando non perde il
/// punto in cui era. Il cambio non entra nella history locale: un
/// aggiornamento arrivato da un altro riquadro non diventa un undo di questo.
/// Le classi della nota non si rileggono qui: vengono dall'indice, che cambia
/// al salvataggio e lo dice con `index_updated`; chiederle a ogni battuta era
/// un IPC per carattere.
function applySurfaceUpdate(r: Pane, doc: string, update: DocumentSurfaceUpdate): void {
  if (r.shown?.k !== "doc" || r.shown.doc !== doc) return;
  try {
    r.surface?.buffer?.syncDoc(
      update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text,
    );
  } catch (error) {
    failSurface(r, doc, error);
  }
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

/// La sessione possiede il testo; questa notifica aggiorna soltanto la resa
/// delle superfici già aperte, senza ricreare buffer o cronologia.
function redrawReading(doc: string): void {
  for (const id of panesWithDoc(doc)) {
    const r = panes.get(id);
    if (!r || selectedMode(r)?.presentation !== "rendered" || activeDoc(id) !== doc) {
      continue;
    }
    // `syncDoc` col testo corrente ridisegna senza toccare cronologia o
    // selezione: la superficie conserva il punto e ricuce gli embed.
    const buffer = r.surface?.buffer;
    buffer?.syncDoc(buffer.getDoc());
  }
}
/// Il modo effettivo è quello che il riquadro ricorda per la famiglia della
/// superficie, quando la superficie lo dichiara; altrimenti la sua predefinita,
/// o la prima che supporta. Il fallback non riscrive il layout: tornando a
/// quella famiglia, il riquadro ritrova la sua modalità.
export function selectedMode(r: Pane | undefined): SurfaceMode | undefined {
  if (!r?.surface) return undefined;
  const { family, modes, defaultMode } = r.surface;
  const requested = paneState(r.id)?.modes[family];
  return modes.find((mode) => mode.id === requested)
    ?? modes.find((mode) => mode.id === defaultMode)
    ?? modes[0];
}

/// Il contesto della modalità del riquadro col fuoco (sorgente, Live,
/// Lettura), se la sua superficie ne offre più d'uno: è ciò che il menu Vista
/// spunta.
export function focusedContextMode(): PaneMode | undefined {
  const r = panes.get(layout.focus);
  if ((r?.surface?.modes.length ?? 0) < 2) return undefined;
  return selectedMode(r)?.contextMode;
}

/// Le modalità della superficie del riquadro col fuoco; nessuna senza superficie.
function focusedModes(): readonly SurfaceMode[] {
  return panes.get(layout.focus)?.surface?.modes ?? [];
}

/// Esegue un'azione dell'editor nella superficie del riquadro col fuoco: è
/// l'intento `fub.editor.action` di un comando invocato dalla palette o da una
/// scorciatoia. La barra non passa di qui: agisce sul proprio riquadro.
/// L'azione c'è nella superficie del riquadro col fuoco, e si può eseguire.
export function editorActionReady(action: string): boolean {
  const r = panes.get(layout.focus);
  const actions = r?.shown?.k === "doc" ? r.surface?.editorActions : undefined;
  return !!actions?.has(action) && actions.editable();
}

export function runEditorAction(action: string): "done" | "nothing" | "unavailable" {
  const r = panes.get(layout.focus);
  const surface = r?.shown?.k === "doc" ? r.surface : null;
  const actions = surface?.editorActions;
  if (!actions || !editorActionReady(action)) return "unavailable";
  if (!actions.run(action)) return "nothing";
  surface?.focus?.();
  return "done";
}

export async function toggleRecorder(r: Pane, doc: string): Promise<void> {
  if (r.disposeRecorder) {
    r.disposeRecorder();
    r.disposeRecorder = null;
    return;
  }
  const surface = r.surface;
  try {
    const attachment = await attachmentDeposit(doc);
    if (r.surface !== surface || r.shown?.k !== "doc" || r.shown.doc !== doc) return;
    r.disposeRecorder = mountRecorderSurface(view.recorderHost(r), {
      staging: createViewStateCrashDeposit({ get: (key) => api.viewState(key), set: api.setViewState }),
      attachment,
      onEmbed: (link) => {
        if (r.surface !== surface) throw new Error(t("errors.document.editor_closed"));
        insertAttachmentLinks(r, doc, [link]);
      },
    });
  } catch (error) {
    notify(t("document.recorder_unavailable", { reason: errorText(error) }), "guasto");
  }
}

/// Le slide spezzano la resa di presentazione che la superficie monta: cosa
/// sia quella resa lo sa la superficie, non il riquadro.
export function presentSlides(r: Pane, doc: string): void {
  const surface = r.surface;
  if (r.shown?.k !== "doc" || r.shown.doc !== doc || !surface?.mountPresentation) return;
  r.disposeSlides?.();
  const content = document.createElement("div");
  let contentStop: (() => void) | null = null;
  try {
    contentStop = surface.mountPresentation(content);
    const deck = mountSlidePresentation(document.body, content, {
      onClose: () => { contentStop?.(); contentStop = null; r.disposeSlides = null; },
    });
    r.disposeSlides = () => { deck.destroy(); contentStop?.(); contentStop = null; };
  } catch (error) {
    contentStop?.();
    notify(t("document.slides_unavailable", { reason: errorText(error) }), "guasto");
  }
}

export async function presentPrint(r: Pane, doc: string): Promise<void> {
  try {
    // La resa di stampa il kernel la legge dal disco: ciò che il buffer ha e
    // il disco non ancora ci arriva prima.
    await documentSessions.flush(doc);
    // La resa dell'host non marca i recinti che il vault dichiara: senza,
    // un diagramma si stamperebbe come codice.
    const declared = await syntaxForms(doc).then(
      (forms) => new Set(declaredFences(forms).map((info) => info.toLowerCase())),
      () => new Set<string>(),
    );
    const stop = await printDocument(doc, docTitle(doc), renderPrint, (container, rendered) =>
      mountRenderedDocument(container, rendered, { documentId: doc, declaredFences: declared, diagramAppearance: "light" }));
    if (r.shown?.k !== "doc" || r.shown.doc !== doc) {
      stop();
      return;
    }
    r.disposePrint?.();
    r.disposePrint = stop;
  } catch (error) {
    notify(t("document.print_unavailable", { reason: errorText(error) }), "guasto");
  }
}

/// Presidio locale: nessun mode con id ignoto persiste oltre il riquadro (U24).
/// Ritorna true se il mode persistito era sconosciuto (conservato, non cancellato).
export function hasUnknownPersistedMode(paneId: string): boolean {
  const r = panes.get(paneId);
  const modes = r?.surface?.modes ?? [];
  if (!r?.surface || modes.length === 0) return false;
  const requested = paneState(paneId)?.modes[r.surface.family];
  return requested !== undefined && !modes.some((mode) => mode.id === requested);
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
  void refreshLimitedMode();
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
    addSheetNotice(b.doc, "recovered", CASE_KEY[caseOf(b)]);
    drawPaneConflict(b.doc);
  }
  view.drawSave();
  for (const b of rejoined) redrawReading(b.doc);
  // Il conto dice quante sono **rientrate davvero**, non quante erano in fila:
  // la notifica dice «è stato ritrovato, aprile per decidere», e una bozza
  // saltata — il buffer sporco che la precede — non è ritrovata e non ha
  // nessun documento da aprire.
  return rejoined.length;
}

/// La modalità limitata dei componenti è del vault, e ogni foglio la porta
/// sopra il testo. Si chiede quando il vault si apre; un host che non risponde
/// vale «non limitata», e un avviso che non c'è non rompe niente.
async function refreshLimitedMode(): Promise<void> {
  try {
    setLimitedMode(await api.pluginLimitedMode());
  } catch {
    setLimitedMode(null);
  }
  for (const [paneId, r] of panes) view.drawConflict(r, activeDoc(paneId));
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
      if (selectedMode(panes.get(layout.focus))?.presentation !== "rendered") focusEditor();
    });
  } finally {
    releaseIntent();
    // A failed or superseded opening must not leave the owner retained solely
    // by its reservation. A tab already present still counts as a watcher.
    if (!isOpen(id)) await documentSessions.release(id);
  }
}

/// Apre una nota chiesta da una view che sta in un riquadro (il grafo, una
/// dashboard): la view resta dov'è e la nota si apre accanto — nel primo altro
/// riquadro, o in uno nuovo a destra. Chi clicca un nodo vuole leggere la nota
/// senza perdere il grafo che stava guardando.
export async function openFromView(id: string): Promise<void> {
  const here = layout.focus;
  if (activeTab(here)?.k !== "view") {
    await openDocument(id);
    return;
  }
  const other = layoutPanes().find((pane) => pane !== here) ?? split(here, "row");
  if (!other) {
    await openDocument(id);
    return;
  }
  focusPane(other);
  await openDocument(id);
}

/// Apre un documento in un riquadro nuovo accanto a quello col fuoco, a
/// destra (`row`) o sotto (`col`): è il `split` di un `fub://open`.
export async function openDocumentBeside(id: string, dir: "row" | "col"): Promise<void> {
  const other = split(layout.focus, dir);
  if (other) focusPane(other);
  await openDocument(id);
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
/// nome scritto nel link. Il backlink c'è già prima ancora
/// che l'utente abbia scritto la prima riga — è il grafo a ricucirlo.
///
/// `heading` e `block` sono il **punto** che il link nomina, quando lo nomina.
/// Fino alla [0049](../../../docs/decisions/0181-modello-documento-e-arene.md)
/// arrivavano fin qui e si fermavano: la risposta di `resolve` sapeva dire
/// *quale documento* e non *dove dentro*, quindi `[[Nota#^blocco]]` apriva la
/// nota in cima e niente lo diceva. Adesso la posizione torna dal kernel e la
/// si porta a schermo con lo stesso `reveal` dell'outline — uno span in byte
/// UTF-8, che la superficie traduce nella sua vista come ogni altro.
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
  from?: string,
): Promise<void> {
  const target = await resolvedReference(
    { kind: "wiki", value: { page, heading: heading ?? null, block: block ?? null } },
    from ?? activeDoc() ?? undefined,
  );
  if (target) {
    await openDocument(target.doc);
    // Il punto può non esserci — un heading rinominato, un `^abc` cancellato —
    // e allora resta la nota aperta in cima: è il degrado dichiarato di
    // `ResolvedRef.at`, non un caso da nascondere.
    if (target.at) await reveal(target.doc, { span: target.at.span });
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
/// rimasta indietro — la battuta si ribasa sul testo autorevole e si
/// ripresenta alla sessione, che resta l'unica a validarla; il riquadro
/// riceve soltanto ciò che gli mancava, fuori dalla sua history, e la battuta
/// resta sua e annullabile. Soltanto se le due modifiche si toccano vince il
/// testo autorevole, senza coprire la battuta arrivata altrove.
function written(paneId: string, change: EditorChange): void {
  const doc = activeDoc(paneId);
  if (!doc) return;
  const outcome = documentSessions.acceptSurfaceChange(doc, paneId, change);
  if (outcome.kind !== "realigned") return;
  const source = panes.get(paneId);
  const rebased = rebaseStaleChange(outcome.text, change);
  if (rebased && documentSessions.acceptSurfaceChange(doc, paneId, rebased).kind === "accepted") {
    if (source?.shown?.k === "doc" && source.shown.doc === doc) {
      source.surface?.buffer?.syncDoc({ text: rebased.text, operation: rebased.catchUp });
    }
    return;
  }
  if (source?.shown?.k === "doc" && source.shown.doc === doc) {
    source.surface?.buffer?.syncDoc(outcome.text);
  }
}

async function applyExternalChange(id: string, outcome: ExternalChangeResult): Promise<void> {
  if (outcome.kind === "echo") return;
  invalidateDocumentCaches(id);
  if (outcome.kind === "warning") {
    if (outcome.cause === "altra_app") {
      addSheetNotice(id, "overwritten");
      notify(t("document.overwritten", { doc: id }), "guasto");
    } else {
      addSheetNotice(id, "changed_on_disk");
      notify(t("document.changed_on_disk", { doc: id }), "info");
    }
    drawPaneConflict(id);
  } else if (outcome.kind === "untracked") {
    return;
  } else if (outcome.kind === "reloaded" && outcome.changed) {
    addSheetNotice(id, "reloaded");
    drawPaneConflict(id);
  }
  // L'editor, quando il testo autorevole è cambiato, è già stato allineato
  // dalla sessione, che lo ha diffuso alle sue superfici. La lettura segue
  // col suo refresh dal buffer corrente.
  redrawReading(id);
}

async function reloadDocument(id: string): Promise<void> {
  await documentSessions.reloadIfClean(id);
  redrawReading(id);
}

/// Rilegge dal disco il documento attivo (usato dopo un ripristino di versione,
/// che riscrive il file sotto al buffer).
export async function reloadCurrent(): Promise<void> {
  const doc = state.currentDoc;
  if (!doc) return;
  const outcome = await documentSessions.forceReload(doc);
  if (outcome.kind === "unavailable") notify(t("document.reload_failed", { doc }), "guasto");
  redrawReading(doc);
  view.drawSave();
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
  const mode = selectedMode(r);
  // Senza superficie (riquadro vuoto, view dichiarata) non c'è una modalità da
  // proiettare: vale la predefinita del contratto.
  const contextMode: PaneMode = mode?.contextMode ?? "live_preview";
  const editing = doc !== null && mode?.presentation !== "rendered";
  const dirty = doc ? documentSessions.isDirty(doc) : false;
  const selections = editing ? selectionSetOf(r?.surface ?? undefined, dirty) : null;
  return { pane: layout.focus, doc, selections, mode: contextMode };
}

/// Pubblica il contesto e annuncia **quali** view il kernel ha dichiarato
/// invecchiate. Chi le ridisegna è l'host dei pannelli (`ui/panel-host.ts`): il
/// verso passa dal bus e non da una chiamata, perché la catena che le monta
/// dipende già da questo modulo.
/// Esegue un comando del «/» scelto fuori dalla palette (il «/» nel testo,
/// «Comandi ▸» del tasto destro), per la stessa via della palette: il modulo
/// e il piano accanto ad `anchor`, il flush prima di scrivere, il contesto
/// pubblicato. Vale finché il documento del gesto resta quello a fuoco.
export function runSlashCommand(owner: HTMLElement, command: string, selection: string, anchor: SelectionBox | null): void {
  const doc = slashContextDoc();
  void openSlashPalette(
    owner,
    selection,
    () => owner.isConnected && slashContextDoc() === doc,
    { onEffect: applyIntent, notify, flushPendingSave, publishContext },
    undefined,
    anchor,
    command,
  );
}

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
/// L'ultima modalità di scrittura di ogni riquadro, per famiglia di superfici,
/// per tornare dalla Lettura: come `PaneState.modes`, un id vale dentro la sua
/// famiglia, e il «source» del testo non è quello della tela. Vive quanto il
/// riquadro (`buildStructure` la toglie con lui).
const writingModes = new Map<string, Map<string, string>>();

/// `Mod-e`: dalla scrittura alla prima lettura che la superficie dichiara,
/// dalla lettura alla scrittura di prima (`readingToggleTarget`).
async function toggleReading(): Promise<void> {
  const r = panes.get(layout.focus);
  if (!r?.surface) return;
  const { family, modes, defaultMode } = r.surface;
  const target = readingToggleTarget(modes, selectedMode(r)?.id, writingModes.get(r.id)?.get(family), defaultMode);
  if (target) await setMode(target.id);
}

/// `shell.mode.live` e `shell.mode.source`: la modalità della superficie col
/// fuoco che ha quel ruolo, qualunque sia il suo id.
async function setContextMode(context: PaneMode): Promise<void> {
  const r = panes.get(layout.focus);
  if (!r?.surface) return;
  const target = modeForContext(r.surface.modes, selectedMode(r)?.id, context);
  if (target) await setMode(target.id);
}

/// La vista sorgente che «Apri come sorgente» aprirebbe adesso nel riquadro:
/// la sua scheda attiva è il documento che mostra, non ne ha già scelta una,
/// e la superficie del documento ne dichiara una che si risolve.
export function offeredSourceView(r: Pane | undefined): SourceView | null {
  if (!r?.sourceView) return null;
  const tab = activeTab(r.id);
  if (tab?.k !== "doc" || tab.override || r.shown?.k !== "doc" || r.shown.doc !== tab.doc) return null;
  return r.sourceView;
}

async function openSourceView(): Promise<void> {
  const view = offeredSourceView(panes.get(layout.focus));
  if (view) await showSourceView(layout.focus, view);
}

async function closeSourceView(): Promise<void> {
  if (tabOverride(activeTab()) !== null) await showSourceView(layout.focus, null);
}

/// «Apri come sorgente accanto»: la vista sorgente della scheda attiva di un
/// riquadro, in un riquadro nuovo alla sua destra, sullo stesso documento e
/// sulla stessa sessione. La superficie resta dov'è e il testo le sta accanto,
/// nella modalità che lo mostra senza resa, perché la resa è già lì. Il fuoco
/// va sul testo, come dopo una divisione.
///
/// Se un altro riquadro ha già quella vista dello stesso documento si va lì,
/// invece di aprirne una seconda: chi ripete il gesto vuole il testo accanto,
/// non un terzo riquadro.
export async function openSourceViewBeside(id: string): Promise<void> {
  const view = offeredSourceView(panes.get(id));
  const doc = activeDoc(id);
  if (!view || !doc) return;
  const there = sourceTabElsewhere(id, doc, view);
  if (there) {
    activateTab(there.pane, there.index);
    await showSourceView(there.pane, view);
    return;
  }
  const added = split(id, "row");
  if (!added) return;
  openIn(added, doc);
  await showSourceView(added, view, "source");
}

/// La linguetta di un riquadro diverso da `id` che mostra `doc` nella vista
/// `view`: quella attiva, se c'è, altrimenti la prima.
function sourceTabElsewhere(id: string, doc: string, view: SourceView): { pane: string; index: number } | null {
  const shows = (tab: Tab): boolean => tab.k === "doc" && tab.doc === doc && sameOverride(tabOverride(tab), view);
  let first: { pane: string; index: number } | null = null;
  for (const other of layoutPanes()) {
    const p = paneState(other);
    if (other === id || !p) continue;
    if (p.active >= 0 && p.active < p.tabs.length && shows(p.tabs[p.active]!)) return { pane: other, index: p.active };
    const index = p.tabs.findIndex(shows);
    if (index >= 0) first ??= { pane: other, index };
  }
  return first;
}

/// Gli export che il riquadro offre adesso: quelli che la sua superficie
/// dichiara, finché mostra un documento e il registro ha il comando che li
/// esegue.
export function offeredExports(r: Pane | undefined): readonly SurfaceExport[] {
  const offered = r?.surface?.exports ?? [];
  if (offered.length === 0 || r?.shown?.k !== "doc") return [];
  return state.commandSpecs.some((spec) => spec.id === EXPORT_COMMAND) ? offered : [];
}

/// La finestra «Esporta» del riquadro, se la sua superficie ne ha una che si
/// apre adesso, e l'export si può eseguire.
export function exportWindow(r: Pane | undefined): SurfaceExportWindow | null {
  const own = r?.surface?.exportWindow;
  return own !== undefined && offeredExports(r).length > 0 && own.available() ? own : null;
}

/// «Esporta…»: la finestra della superficie, se ne ha una; se no l'export che
/// la superficie offre, o quello che si sceglie fra i suoi.
export async function chooseExport(paneId: string): Promise<void> {
  const r = panes.get(paneId);
  const offered = offeredExports(r);
  if (r?.shown?.k !== "doc" || offered.length === 0) return;
  const doc = r.shown.doc;
  const own = exportWindow(r);
  let chosen: SurfaceExport | null | undefined;
  if (own !== null) chosen = await own.open();
  else if (offered.length === 1) chosen = offered[0]!;
  else {
    chosen = await pickFromList({
      title: t("document.export.title", { doc: docTitle(doc) }),
      placeholder: t("document.export.placeholder"),
      items: offered.map((item) => ({ label: item.label(), detail: item.detail(), value: item })),
    });
  }
  if (chosen) await runExport(doc, chosen);
}

/// Esporta `doc`. L'host legge il documento dal vault, quindi prima si svuota
/// la coda di salvataggio: un export del testo di prima, con le ultime
/// modifiche sullo schermo, sarebbe un file che dice il falso. Il file arriva
/// al centro attività, che si apre senza prendere il fuoco e da cui lo si
/// salva dove si sceglie.
export async function runExport(doc: string, chosen: SurfaceExport): Promise<void> {
  const unsaved = await flushPendingSave();
  if (unsaved.includes(doc)) {
    notify(t("document.export.unsaved", { doc: docTitle(doc) }), "guasto");
    return;
  }
  const request = {
    target: chosen.target,
    selection: { kind: "documents", value: [doc] },
    options: chosen.options?.() ?? {},
  };
  try {
    await api.invokeCommand(EXPORT_COMMAND, { request_json: JSON.stringify(request) }, "apply");
  } catch (error) {
    notify(t("document.export.failed", { reason: errorText(error) }), "guasto");
    return;
  }
  notify(t("document.export.started", { doc: docTitle(doc), what: chosen.label() }), "info");
  showActivity();
}

/// Mette la scheda attiva di un riquadro nella vista sorgente, o la riporta
/// alla superficie del documento con `null`, e porta il fuoco sulla
/// superficie nuova: quella di prima non c'è più, e il fuoco che stava dentro
/// di lei finirebbe sul corpo della pagina, dove chi usa la tastiera o un
/// lettore di schermo perde il punto.
///
/// La vista sorgente si apre per scrivere: se il riquadro ricorda una lettura
/// per la sua famiglia (una nota lasciata in Lettura), si passa alla scrittura
/// che il toggle sceglierebbe, invece di mostrare un'altra resa a chi ha
/// chiesto il testo. Con `context` si passa invece alla modalità che ha quel
/// ruolo, se la vista ne ha una.
export async function showSourceView(id: string, view: SourceView | null, context?: PaneMode): Promise<void> {
  const p = paneState(id);
  if (!p || p.active < 0) return;
  setTabOverride(id, p.active, view);
  await synchronize();
  const r = panes.get(id);
  if (view && r?.surface && layout.focus === id && context) {
    const target = modeForContext(r.surface.modes, selectedMode(r)?.id, context);
    if (target && target.id !== selectedMode(r)?.id) await setMode(target.id);
  } else if (view && r?.surface && layout.focus === id && selectedMode(r)?.contextMode === "reading") {
    const { family, modes, defaultMode } = r.surface;
    const writing = readingToggleTarget(modes, selectedMode(r)?.id, writingModes.get(id)?.get(family), defaultMode);
    if (writing) await setMode(writing.id);
  }
  await publishContext();
  if (layout.focus === id) panes.get(id)?.surface?.focus?.();
}

/// `Mod-s`: il salvataggio è automatico, ma chi lo chiede vuole saperlo fatto
/// adesso — e dopo un guasto è il gesto che riprova.
async function saveNow(): Promise<void> {
  const pending = await flushPendingSave();
  view.drawSave();
  if (pending.length > 0) {
    notify(t("document.save_now_failed", { doc: pending.map(docTitle).join(", ") }), "guasto");
  }
}

export async function setMode(next: string): Promise<void> {
  const r = panes.get(layout.focus);
  const mode = r?.surface?.modes.find((candidate) => candidate.id === next);
  if (!r?.surface || !mode) return;
  const doc = activeDoc();
  // Nessun salvataggio per cambiare modo: la lettura si monta dal buffer
  // corrente, e il cambio è immediato anche con modifiche non salvate.
  const previous = selectedMode(r);
  if (mode.contextMode === "reading" && previous && previous.contextMode !== "reading") {
    const remembered = writingModes.get(layout.focus) ?? new Map<string, string>();
    remembered.set(r.surface.family, previous.id);
    writingModes.set(layout.focus, remembered);
  }
  setPaneMode(layout.focus, r.surface.family, mode.id);
  r.root.dataset.mode = mode.id;
  r.surface.setMode(mode.id);
  if (mode.presentation !== "rendered") r.surface.focus?.();
  view.drawToolbar(r);
  view.drawConflict(r, doc);
  await publishContext();
}

/// Porta a schermo un punto di un documento, nel riquadro che lo mostra.
///
/// Il riquadro è quello col fuoco se il documento è la sua tab attiva, poi il
/// primo altro che lo mostra — e prende il fuoco; altrimenti il documento si
/// apre nel riquadro col fuoco. Il punto si porta soltanto lì: mai in un
/// riquadro che mostra un altro documento, dove lo stesso offset nominerebbe
/// un altro testo. Cosa voglia dire «portarci» lo decide la superficie — il
/// cursore nel testo, la carta nella tela — e una che non ci arriva lo dice,
/// invece di lasciare il gesto senza risposta.
export async function reveal(doc: string, location: SurfaceLocation): Promise<void> {
  const showing = [layout.focus, ...layoutPanes()].find((id) => activeDoc(id) === doc);
  if (showing === undefined) {
    await openDocument(doc);
  } else if (showing !== layout.focus) {
    focusPane(showing);
    await synchronize();
    await publishContext();
  }
  const r = panes.get(layout.focus);
  // Un'apertura fallita o superata da un'altra lascia a fuoco un altro
  // documento, o nessuno: il punto non è di quel testo.
  if (activeDoc() !== doc || r?.shown?.k !== "doc" || r.shown.doc !== doc || !r.surface) return;
  if (!r.surface.reveal?.(location)) {
    notify(t("document.reveal_unavailable", { doc: docTitle(doc) }), "info");
  }
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
