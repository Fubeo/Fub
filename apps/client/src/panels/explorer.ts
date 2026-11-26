// La sidebar delle note: l'albero, le appuntate, la striscia degli spazi, le
// icone, il trascinamento e la rinomina in posto.
//
// È il pannello più grosso perché è quello con più *gesti*, non con più logica:
// la logica dell'alberatura (cosa è una cartella, cosa è una folder note, che
// ordine hanno i fratelli) sta in `rules/organizer.ts`, ed è pura e provata; il
// dato sta nel sidecar (`state/organization.ts`). Qui c'è il DOM.
//
// Qui restano lo stato del pannello, il montaggio, l'albero e i gesti che
// cambiano lo stato. Le parti stanno accanto: `explorer-rows.ts` (righe e
// menu), `explorer-spaces.ts` (appuntate, spazi, ordine), `explorer-entries.ts`
// (copiare, creare, rinominare, spostare, cestinare) ed `explorer-drag.ts`
// (rilasci e importazioni). Le esportazioni in più di questo modulo servono a
// quelle parti; nessuna parte assegna lo stato di qui, e nessuna lo legge al
// caricamento.
import { ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE, type DraggedEntry } from "../ui/drag-types";
import { revealSidePanel } from "../ui/side-panels";
import {
  vaultEntries,
  vaultFolders,
  folderContent,
  existingDocuments,
  settings,
  WITHOUT_PAGE,
} from "../host/query";
import { mountExplorerFilter, type ExplorerFilter, type FilterEntry } from "./explorer-filter";
import { Race } from "../ui/race";
import { onEvent } from "../state/kernel";
import { loadOrganization, setOrder } from "../state/organization";
import { on, saveActiveSpace, saveExpanded, state } from "../state/store";
import { openVaultRoot } from "../state/vault";
import { offerOutside } from "../ui/vault-transfer";
import {
  LEVEL_PAGE,
  childName,
  folderNoteCandidates,
  folderNoteOf,
  orderedNames,
  pageName,
  parentOf,
  sortContent,
  type FolderContent,
} from "../rules/organizer";
import { $ } from "../ui/dom";
import { formatTagOf } from "../ui/format-kind";
import { craftServed } from "../state/craft-previews";
import { mountTreeThumbnails, type TreeThumbnails } from "../state/tree-thumbnails";
import { iconEl } from "../ui/icons";
import { showContextMenu } from "../ui/menu";
import { dropOffersChanged, offerDropTargets } from "../editors/core/registry";
import {
  newKinds,
  registerNewKindHost,
  canImportFile,
  importDrawing,
  newDrawing,
  registerShellCommand,
} from "../ui/commands";
import { DEFAULT_ATTACHMENT_FOLDER } from "../editors/media/attachment-target";
import { showPanel } from "./sidebar";
import { refreshOn, registerPanel, registeredPanels, unregisterPanel } from "../ui/panel-host";
import { onComponents } from "../state/components";
import {
  canShowFile,
  copyNoteLinks,
  openDocument,
  presentBookExport,
} from "../state/document-controller";
import { newNoteInActiveSpace } from "../state/new-note";
import { mountExplorerTypes, type ExplorerTypes } from "./explorer-types";
import { renameKeepingBuffer } from "../state/document-session";
import { trashManyWithConfirm, trashWithConfirm } from "./trash";
import { mountTreeSelection, type TreeSelection } from "./explorer-selection";
import { beginTreeMotion, type TreeMotion } from "./explorer-motion";
import { changedOnlyInside, signatureOf, type View } from "./explorer-view";
import { errorText } from "../host/errors";
import { folderForNote, nameFault } from "../rules/mirrored";
import { onLanguage, plural, t } from "../i18n/strings";
import { notify } from "../ui/notify";
import type { Lifetime } from "../ui/lifetime";
import { nameFaultText } from "../ui/name-fault";
import { api } from "../host/ipc";
import { engineExtension, engineWarmup, type EngineWarmup } from "./engine-warmup";
import { primaryClicksOnly } from "../ui/primary-clicks";
import { composingKey } from "../kit/ime";
import {
  empty,
  entryRow,
  explorerTarget,
  fileRow,
  folderRow,
  folderRowOf,
  groupIntoNewFolder,
  noteOffers,
  noteRow,
  openNewMenu,
  openRowMenu,
  pickMoveFolders,
  renameEntry,
  reorderAdjacent,
  rootMenu,
  rowMenuAt,
  sortItems,
  toggleButtonMenu,
  treeFocused,
} from "./explorer-rows";
import {
  copyEntries,
  ensureSaved,
  newNote,
  parentPath,
  pasteEntries,
  pickedOr,
  renameFolderRow,
  renameFolderTo,
  renamedPath,
  reportRenameCollision,
  startNewFolder,
  trashFolderWithConfirm,
} from "./explorer-entries";
import {
  collapseAll,
  expandAll,
  openSpaceNote,
  renderAllTitle,
  renderPinned,
  renderSpaceStrip,
  renderSpaceTitle,
  setSort,
} from "./explorer-spaces";
import { clearDropMarks, dropGesture, moveGroupInto, wireOutsideDrops } from "./explorer-drag";

export const fileListEl = $("#file-list");

/// Il moto della cartella appena aperta o chiusa, finché l'albero non si
/// ridisegna; e la vita del pannello, che lo chiude.
let treeMotion: TreeMotion | null = null;

let treeLife: Lifetime | null = null;

export const filesTitleEl = $("#files-title");

export const spaceStripEl = $("#space-strip");

export const spaceTitleEl = $("#space-title");

export const pinnedTitleEl = $("#pinned-title");

export const pinnedListEl = $("#pinned-list");

export const allTitleEl = $("#all-title");

export const allCountEl = $("#all-count");

const sortButtonEl = $("#explorer-sort");

export const newNoteEl = $("#new-note");

/// Il drag in corso nella sidebar, se c'è.
/// Il trascinamento in corso dentro l'albero: la voce presa e, se era nella
/// scelta multipla, tutte le scelte (`group`, la presa compresa).
export let drag: { path: string; kind: "note" | "folder"; parent: string; group: string[] } | null = null;

/// Sostando su una cartella chiusa durante un trascinamento la si apre, come in
/// ogni file manager: così si arriva a una destinazione annidata senza mollare
/// la nota. Il timer ha un solo posto e un solo padrone (`mountExplorer`).
const HOVER_OPEN_MS = 700;

let hoverPath: string | null = null;

let hoverTimer: ReturnType<typeof setTimeout> | undefined;

export function cancelHoverOpen(): void {
  clearTimeout(hoverTimer);
  hoverTimer = undefined;
  hoverPath = null;
}

export function scheduleHoverOpen(path: string): void {
  if (hoverPath === path) return;
  cancelHoverOpen();
  if (state.expanded.has(path)) return;
  hoverPath = path;
  hoverTimer = setTimeout(() => {
    hoverTimer = undefined;
    hoverPath = null;
    // Un solo apri: se nel frattempo si è aperta da un'altra strada, resta così.
    if (drag === null || state.expanded.has(path)) return;
    state.expanded.add(path);
    saveExpanded();
    void refreshFromKernel(true);
  }, HOVER_OPEN_MS);
}

export let view: View = { folders: new Map(), existing: new Set(), total: null };

/// La cartella che `toggleFolder` ha appena aperto o chiuso, finché un giro
/// non ridisegna: se fuori da lei non è cambiato niente, quel giro tocca solo
/// il suo sottoalbero.
let toggled: string | null = null;

/// Chi scalda i motori dei formati al passaggio del puntatore e all'apertura
/// di una cartella: vive finché il pannello è montato (`mountExplorer`).
let warmup: EngineWarmup | null = null;

/// La riga di un file con motore scalda il motore quando il puntatore ci si
/// ferma; le altre righe non ascoltano niente.
export function wireWarmup(row: HTMLElement, id: string): void {
  if (engineExtension(id) === null) return;
  row.addEventListener("pointerenter", () => warmup?.hover(id));
  row.addEventListener("pointerleave", () => warmup?.leave());
}

/// La finestra richiesta per ogni livello visibile. Cresce solo per il livello
/// il cui pulsante «altre» è stato attivato; nessuna domanda perde il proprio
/// limite mentre gli altri livelli conservano il costo iniziale.
export const levelWindows = new Map<string, number>();

/// L'impronta dell'ultima vista disegnata: gli eventi del kernel arrivano a
/// ogni salvataggio con una risposta quasi sempre identica, e ricostruire
/// l'albero distrugge gli `<li>` sotto il mouse.
let lastSignature = "";

export function mountExplorer(lifetime: Lifetime): void {
  treeLife = lifetime;
  thumbnails = mountTreeThumbnails(lifetime);
  // Le note del cassetto sono bersagli di un blocco in mano (E13, «Sposta
  // in…»): la porta di T2b, che dice soltanto dove sta la riga e come si
  // chiama; che cosa fa il rilascio lo decide l'editor.
  lifetime.add(offerDropTargets({ offers: noteOffers }));
  lifetime.add(() => {
    treeLife = null;
    treeMotion = null;
    thumbnails = null;
    showXmp = true;
    treeThumbs = false;
  });
  // Le due azioni del titolo sono figure: il nome e il suggerimento li danno
  // gli attributi di `index.html`, che seguono la lingua.
  newNoteEl.replaceChildren(iconEl("compose") ?? "");
  sortButtonEl.replaceChildren(iconEl("sort") ?? "");
  // Il «+» chiede il tipo (S34): apre sotto di sé il menu «Nuovo» dello
  // spazio attivo. Ctrl+N resta la nota diretta, senza menu. La nota e la
  // cartella le fa l'albero, per ogni porta del menu (anche il menu File):
  // senza una cartella scelta la nota nasce dove la fa nascere Ctrl+N.
  lifetime.add(registerNewKindHost({
    note: (folder) => void (folder === undefined ? newNoteInActiveSpace() : newNote(folder === "" ? null : folder)),
    folder: (folder) => startNewFolder(folder ?? state.activeSpace ?? ""),
  }));
  // Il «+» e «Ordina» sono interruttori: il secondo clic chiude il menu che
  // il primo ha aperto.
  lifetime.listen(newNoteEl, "click", (e) => toggleButtonMenu(newNoteEl, () => openNewMenu(e.detail > 0)));
  lifetime.listen(sortButtonEl, "click", () =>
    toggleButtonMenu(sortButtonEl, () => {
      sortButtonEl.setAttribute("aria-expanded", "true");
      showContextMenu(sortButtonEl, sortItems(), {
        label: t("explorer.sort"),
        onClose: () => sortButtonEl.setAttribute("aria-expanded", "false"),
      });
    }),
  );
  // Il titolo del pannello è la radice di ciò che si vede (il vault o lo
  // spazio attivo), e così lo spazio vuoto sotto l'ultima riga: il loro
  // contestuale crea lì, importa e ordina l'albero.
  lifetime.listen(filesTitleEl, "contextmenu", (e) => {
    e.preventDefault();
    rootMenu(e);
  });
  lifetime.listen(fileListEl, "contextmenu", (e) => {
    // Una riga ha già aperto il suo menu.
    if (e.defaultPrevented) return;
    e.preventDefault();
    // Un contestuale arrivato sulla voce e non sulla sua riga (il tasto Menu
    // lo manda al `treeitem` a fuoco, un clic sul margine della voce pure) è
    // della voce: il menu della radice creerebbe fuori dalla cartella
    // (IMP-144).
    const item = e.target instanceof Element ? e.target.closest<HTMLElement>('[role="treeitem"][data-path]') : null;
    if (item && fileListEl.contains(item)) {
      rowMenuAt(e, item);
      return;
    }
    rootMenu(e);
  });
  lifetime.listen(spaceTitleEl, "click", openSpaceNote);
  registerShellCommand({
    id: "shell.explorer.filter",
    title: "commands.explorer.filter",
    description: "commands.explorer.filter.desc",
    layer: "global",
    available: () => openVaultRoot() !== undefined,
    run: () => {
      revealSidePanel("sidebar");
      showPanel("files");
      filter?.show();
    },
  });
  registerShellCommand({
    id: "shell.explorer.reveal",
    title: "commands.explorer.reveal",
    description: "commands.explorer.reveal.desc",
    layer: "global",
    available: () => state.currentDoc !== null,
    run: () => revealActive(),
  });
  registerShellCommand({
    id: "shell.explorer.reveal_attachments",
    title: "commands.explorer.reveal_attachments",
    description: "commands.explorer.reveal_attachments.desc",
    layer: "global",
    available: () => openVaultRoot() !== undefined,
    run: () => revealAttachments(),
  });
  // Dentro l'albero li prendono F2 e Canc (`treeArrows`); i comandi sono la
  // stessa azione per la palette e per un accordo che l'utente sceglie.
  registerShellCommand({
    id: "shell.explorer.rename",
    title: "commands.explorer.rename",
    description: "commands.explorer.rename.desc",
    layer: "global",
    available: () => explorerTarget() !== null,
    run: async () => {
      const id = explorerTarget();
      if (id === null) return;
      // Da fuori dell'albero la voce è la nota attiva, e il campo del nome
      // vive nella sua riga: prima la si porta in vista.
      if (!treeFocused()) await revealActive();
      renameEntry(id);
    },
  });
  registerShellCommand({
    id: "shell.explorer.trash",
    title: "commands.explorer.trash",
    description: "commands.explorer.trash.desc",
    layer: "global",
    available: () => explorerTarget() !== null,
    run: async () => {
      const id = explorerTarget();
      if (id !== null) await trashWithConfirm(id);
    },
  });
  registerShellCommand({
    id: "shell.explorer.collapse_all",
    title: "commands.explorer.collapse_all",
    description: "commands.explorer.collapse_all.desc",
    layer: "global",
    available: () => state.expanded.size > 0,
    run: () => collapseAll(),
  });
  registerShellCommand({
    id: "shell.explorer.expand_all",
    title: "commands.explorer.expand_all",
    description: "commands.explorer.expand_all.desc",
    layer: "global",
    run: () => expandAll(),
  });
  registerShellCommand({
    id: "shell.explorer.sort.manual",
    title: "commands.explorer.sort.manual",
    description: "commands.explorer.sort.manual.desc",
    layer: "global",
    run: () => setSort("manual"),
  });
  registerShellCommand({
    id: "shell.explorer.sort.name_asc",
    title: "commands.explorer.sort.name_asc",
    description: "commands.explorer.sort.name_asc.desc",
    layer: "global",
    run: () => setSort("name-asc"),
  });
  registerShellCommand({
    id: "shell.explorer.sort.name_desc",
    title: "commands.explorer.sort.name_desc",
    description: "commands.explorer.sort.name_desc.desc",
    layer: "global",
    run: () => setSort("name-desc"),
  });
  registerShellCommand({
    id: "shell.explorer.sort.modified_new",
    title: "commands.explorer.sort.modified_new",
    description: "commands.explorer.sort.modified_new.desc",
    layer: "global",
    run: () => setSort("modified-new"),
  });
  registerShellCommand({
    id: "shell.explorer.sort.modified_old",
    title: "commands.explorer.sort.modified_old",
    description: "commands.explorer.sort.modified_old.desc",
    layer: "global",
    run: () => setSort("modified-old"),
  });
  treeArrows(lifetime);
  // Prima della scelta multipla, che ascolta i clic sullo stesso albero.
  // Solo il sinistro apre, chiude e sceglie le righe (IMP-002).
  lifetime.add(primaryClicksOnly(fileListEl));
  lifetime.add(primaryClicksOnly(pinnedListEl));
  wireRootDropTarget(lifetime);
  wireOutsideDrops(lifetime);
  lifetime.add(cancelHoverOpen);
  const warming = engineWarmup((extension) => api.warmEngine(extension));
  warmup = warming;
  lifetime.add(() => {
    warming.dispose();
    if (warmup === warming) warmup = null;
  });
  // Un vault nuovo ha i suoi componenti: le estensioni si riscaldano.
  lifetime.add(on("vault", () => warming.reset()));
  selection = mountTreeSelection({
    list: fileListEl,
    currentDoc: () => state.currentDoc,
    trash: async (paths) => (await trashManyWithConfirm(paths)) > 0,
    move: (paths) => pickMoveFolders(paths),
    group: (paths) => groupIntoNewFolder(paths),
    copy: (paths) => copyEntries(paths),
    copyLinks: (paths) => copyNoteLinks(paths),
    exportPdf: (paths) => presentBookExport(paths, t("pdf_export.book.selection")),
    lifetime,
  });
  lifetime.add(() => {
    selection = null;
  });
  // Una voce che sparisce esce dalla scelta quando il kernel lo dice, anche se
  // l'ha spostata, rinominata o cestinata un altro programma: la barra non
  // offre mai un percorso che non c'è più (IMP-1803).
  lifetime.add(onEvent("document_renamed", (event) => selection?.forget(event.from)));
  lifetime.add(onEvent("document_removed", (event) => selection?.forget(event.id)));
  lifetime.add(onEvent("entry_renamed", (event) => selection?.forget(event.from)));
  lifetime.add(onEvent("entry_removed", (event) => selection?.forget(event.id)));
  // «Tutte le note» sta subito sopra l'albero; la barra della scelta multipla
  // sta subito sotto.
  fileListEl.before(allTitleEl);
  // Il titolo del pannello è **di qui** e non del testo fermo di `index.html`:
  // a casa dice «Note», dentro uno spazio dice il nome dello spazio. Un
  // `data-i18n` sopra glielo riscriverebbe a «Note» a ogni cambio di lingua,
  // cioè proprio quando l'utente non ha cambiato spazio.
  lifetime.add(onLanguage(renderSpaceTitle));
  renderSpaceTitle();

  // Una lista chiesta esplicitamente (apertura del vault, creazione, rinomina,
  // ripristino) si richiede sempre: il segnale dice *quando*, non *cosa*.
  lifetime.add(on("documents", () => void refreshFromKernel(true)));
  filter = mountExplorerFilter({
    lifetime,
    before: pinnedTitleEl,
    covering: (covered) => {
      fileListEl.hidden = covered;
      if (!lifetime.closed) renderFileList();
    },
    entries: filterEntries,
    open: openFiltered,
  });
  lifetime.add(() => (filter = null));
  // I tipi di nota (E5) fra le appuntate e «Tutte le note».
  types = mountExplorerTypes({
    lifetime,
    after: pinnedListEl,
    covered: () => filter?.active() === true,
    open: (doc) => void openDocument(doc, { gesture: true }),
  });
  lifetime.add(() => (types = null));
  lifetime.add(on("documents", () => filter?.stale()));
  lifetime.add(on("vault", () => filter?.hide()));
  // L'organizzazione cambiata ridisegna la stessa vista senza richiederla:
  // icone, pin e ordine non passano dal kernel. Un'appuntata nuova sì: quali
  // appuntate esistano lo dice il kernel (`view.existing`), e una nota appena
  // appuntata non c'era nella domanda di prima, così la lista restava vuota fino
  // al ridisegno dopo (IMP-009). Si chiede, e il giro ridisegna se è cambiato.
  lifetime.add(on("organization", () => {
    renderFileList();
    if (state.meta.pinned.some((id) => !view.existing.has(id))) void refreshFromKernel();
  }));
  lifetime.add(on("page-icons", renderFileList));
  lifetime.add(on("reveal-folder", (folder) => void revealPath(folder, true)));
  lifetime.add(on("reveal-path", (path) => void revealPath(path, false)));
  // L'elenco dei comandi arriva dopo l'apertura del vault: un albero vuoto
  // offre «Nuovo disegno…» solo da quel momento, e lo toglie se il comando se
  // ne va. Un albero con delle note non ha niente da ridisegnare.
  lifetime.add(on("commands", () => {
    if (fileListEl.querySelector(".tree-empty") !== null) renderFileList();
    // Le miniature le serve il componente «File delle app Craft»: acceso o
    // spento, lo dice l'elenco dei comandi.
    else paintThumbnails();
  }));
  // Le porte di un componente (i disegni) seguono ciò che è acceso.
  lifetime.add(onComponents(() => {
    if (fileListEl.querySelector(".tree-empty") !== null) renderFileList();
  }));
  lifetime.add(on("active-doc", markActive));
  // «Mostra la nota aperta»: cambiando nota l'albero segue, senza aprire il
  // pannello se è chiuso (a quello pensa il comando «Rivela»).
  const autoReads = new Race();
  const readAutoReveal = () => autoReads.last(async (expected) => {
    const entries = await expected(settings().catch(() => null));
    if (entries) autoReveal = entries.find((entry) => entry.spec.key === FILES_AUTO_REVEAL)?.value === true;
  });
  void readAutoReveal();
  // I vecchi nomi della pagina della cartella (decisione 0229): cambiano quale
  // nota la cartella apre e quale la lista dei figli nasconde.
  const legacyReads = new Race();
  const readLegacyPages = () => legacyReads.last(async (expected) => {
    const entries = await expected(settings().catch(() => null));
    if (!entries) return;
    const next = entries.find((entry) => entry.spec.key === FILES_LEGACY_FOLDER_PAGES)?.value === true;
    if (next === legacyPages) return;
    legacyPages = next;
    await expected(refreshFromKernel(true));
  });
  void readLegacyPages();
  // Gli XMP e le miniature nell'albero (T26): cambiano soltanto ciò che si
  // disegna, e l'albero si ridisegna senza chiedere niente al kernel.
  const craftTreeReads = new Race();
  const readCraftTree = () => craftTreeReads.last(async (expected) => {
    const entries = await expected(settings().catch(() => null));
    if (!entries) return;
    const toggle = (key: string, fallback: boolean): boolean => {
      const value = entries.find((entry) => entry.spec.key === key)?.value;
      return typeof value === "boolean" ? value : fallback;
    };
    const xmp = toggle(CRAFT_TREE_SHOW_XMP, true);
    const thumbs = toggle(CRAFT_TREE_THUMBNAILS, false);
    if (xmp === showXmp && thumbs === treeThumbs) return;
    showXmp = xmp;
    treeThumbs = thumbs;
    renderFileList();
  });
  void readCraftTree();
  lifetime.add(onEvent("setting_changed", (event) => {
    if (event.key === FILES_AUTO_REVEAL) void readAutoReveal();
    if (event.key === FILES_LEGACY_FOLDER_PAGES) void readLegacyPages();
    if (event.key === CRAFT_TREE_SHOW_XMP || event.key === CRAFT_TREE_THUMBNAILS) void readCraftTree();
  }));
  lifetime.add(on("active-doc", () => { if (autoReveal) void followActive(); }));

  // Una rinomina non è solo una lista invecchiata: l'organizzazione (icona,
  // pin, ordine) è indicizzata per path, e va riletta prima del ridisegno.
  //
  // **Traslocarla non è più affare di questa shell** (§11.3): la fa il kernel
  // dentro l'operazione che sposta l'identità, quindi vale anche per le
  // rinomine che questa finestra non ha innescato. Qui resta la rilettura —
  // e resta un'iscrizione diretta, non una riga nel `refresh` del pannello,
  // perché il router consegna gli ascoltatori generici prima dei tipizzati e un
  // ridisegno innescato dal registro partirebbe con l'organizzazione vecchia.
  lifetime.add(
    onEvent("document_renamed", () => {
      void (async () => {
        await loadOrganization();
        await refreshFromKernel();
      })();
    }),
  );

  // Dentro un lotto (decisione 0011) `index_updated` NON arriva: arriva
  // `batch_ended`, una volta sola. È tutta la differenza fra una rinomina con
  // 200 backlink che costa 201 giri di domande e una che ne costa uno.
  // Nessun `visible`: l'albero si tiene aggiornato anche mentre la sidebar
  // mostra la ricerca o il cestino, perché alimenta anche ciò che si vede
  // altrove (le appuntate, la striscia degli spazi).
  const panel = {
    id: "shell:explorer",
    title: "Note",
    placement: "left_sidebar" as const,
    refresh: refreshOn("index_updated", "batch_ended"),
    render: () => refreshFromKernel(),
  };
  registerPanel(panel);
  lifetime.add(() => {
    if (registeredPanels().some((current) => current === panel)) unregisterPanel(panel.id);
  });
  lifetime.add(() => {
    race.cancel();
    drag = null;
    levelWindows.clear();
    lastSignature = "";
    toggled = null;
    view = { folders: new Map(), existing: new Set(), total: null };
    fileListEl.replaceChildren();
  });
}

/// Chiede al kernel ciò che serve a disegnare, e ridisegna se è cambiato.
///
/// Le domande sono **per cartella** (§14.3, §14.4): una coppia per ogni
/// cartella visibile — le sue sottocartelle e le sue note — più una che chiede
/// quali fra le folder note possibili e le appuntate esistono davvero. Un
/// livello alla volta, in parallelo: aprire una cartella non costa il vault, e
/// aprirne una in fondo non costa più che aprirne una in cima.
///
/// Ricostruire la lista distrugge gli `<li>`: un click a cavallo del rebuild
/// (mousedown sul vecchio nodo, mouseup su quello nuovo) non produce nessun
/// `click` e all'utente sembra servire un doppio click. Gli eventi del kernel
/// arrivano a ogni salvataggio con una risposta quasi sempre identica: qui si
/// ricostruisce solo se è cambiata davvero, o se a chiederlo è un gesto
/// dell'utente (`forza`), che una risposta identica ce l'ha per costruzione.
/// I giri di questo pannello, di cui conta solo l'ultimo.
///
/// La firma qui sotto **sembra** questa cosa e non lo è: `ultimaFirma` toglie i
/// ridisegni identici, cioè risponde a «è cambiato qualcosa?». Non risponde a
/// «sono ancora io?», ed è la domanda che mancava — due giri partiti insieme
/// hanno quasi sempre firme *diverse* (una sottocartella aperta nel frattempo,
/// una nota salvata), quindi il vecchio passava il controllo e vinceva perché
/// arrivava dopo. Un dedup non è mai un ordinamento (decisione 0134).
const race = new Race();

export async function refreshFromKernel(force = false): Promise<void> {
  await race.last(async (expected) => {
    const [folders, total] = await expected(Promise.all([loadVisible(), visibleTotal()]));
    const expectedItems = [
      ...[...folders.values()].flatMap((c) =>
        c.folders.flatMap((f) => folderNoteCandidates(f.path, state.handledExtensions, legacyPages)),
      ),
      ...state.meta.pinned,
    ];
    const newItem: View = { folders, existing: await expected(existingDocuments(expectedItems)), total };
    const signature = signatureOf(newItem, state.explorerSort);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    const before = view;
    view = newItem;
    // Il DOM disegna `before`: se da lì è cambiata soltanto la cartella
    // aperta o chiusa, si rifà solo lei.
    const only = toggled;
    toggled = null;
    const outside = only === null ? null : { folder: only, pinned: state.meta.pinned };
    renderFileList(outside !== null && changedOnlyInside(before, newItem, state.explorerSort, outside) ? only : null);
  });
}

/// Il contenuto delle sole cartelle **visibili**: la radice dello spazio
/// attivo, e ricorsivamente quelle aperte.
///
/// Un livello per volta, e le cartelle di un livello insieme: sono domande
/// indipendenti, e farle in fila vorrebbe dire pagare la latenza dell'IPC una
/// volta per cartella aperta.
async function loadVisible(): Promise<Map<string, FolderContent>> {
  const out = new Map<string, FolderContent>();
  let level = [state.activeSpace ?? ""];
  while (level.length > 0) {
    const contents = await Promise.all(
      level.map((path) =>
        folderContent(path, {
          ...LEVEL_PAGE,
          limit: levelWindows.get(path) ?? LEVEL_PAGE.limit,
        }),
      ),
    );
    const next: string[] = [];
    contents.forEach((content, i) => {
      const path = level[i]!;
      out.set(path, { path, ...content });
      for (const sub of content.folders) {
        if (state.expanded.has(sub.path)) next.push(sub.path);
      }
    });
    level = next;
  }
  return out;
}

/// Quante voci ha ciò che si vede, a ogni profondità: una domanda sola, con
/// una finestra di una riga, perché serve il conto e non le voci.
async function visibleTotal(): Promise<number | null> {
  const space = state.activeSpace;
  const scope = space ? { path: space, descendants: true } : undefined;
  try {
    return (await vaultEntries({ offset: 0, limit: 1 }, undefined, scope)).total;
  } catch {
    return null;
  }
}

/// Il contenuto di una cartella nell'ordine in cui si vede, se è caricata.
export function children(path: string): FolderContent | null {
  const content = view.folders.get(path);
  return content ? sortContent(content, state.meta, state.explorerSort) : null;
}

/// La voce che aveva il fuoco quando una rinomina in posto è stata confermata,
/// e il path che avrà: `renderFileList` porta il fuoco sulla riga nuova.
let renameFocus: { from: string; to: string } | null = null;

/// Ridisegna l'albero. Con `only`, la cartella aperta o chiusa da
/// `toggleFolder` quando fuori da lei non è cambiato niente: si rifà soltanto
/// il suo sottoalbero, e le altre righe restano gli stessi nodi.
function renderFileList(only: string | null = null): void {
  // Uno spazio rimosso (o la cui cartella non esiste più) non può restare
  // selezionato: si torna a casa senza dire niente.
  if (state.activeSpace !== null && !state.meta.spaces.includes(state.activeSpace)) {
    state.activeSpace = null;
    saveActiveSpace();
  }
  renderSpaceStrip();
  renderSpaceTitle();
  renderPinned();
  renderAllTitle();
  // Chi stava navigando da tastiera non deve perdere il posto: un ridisegno
  // intero rifà **tutto** l'albero, e senza questa riga il fuoco
  // tornerebbe in cima al documento a ogni freccia destra — cioè la
  // navigazione da tastiera si romperebbe proprio nel momento in cui la si sta
  // usando.
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && fileListEl.contains(active) ? active : null;
  const focusedEntry = focused?.closest<HTMLElement>('li[role="treeitem"]') ?? null;
  let toRestore = focusedEntry?.dataset.path;
  const onChevron = focused?.matches("button.chevron");
  const nearby = focusedEntry ? neighbours(focusedEntry) : [];

  if (only === null || !patchFolder(only)) rebuildTree();

  // Una voce appena rinominata col fuoco addosso: il fuoco la segue al path
  // nuovo appena l'albero lo disegna. Un ridisegno che arriva prima disegna
  // ancora la voce vecchia, e il fuoco resta lì; se intanto il fuoco è andato
  // altrove, la voce non lo riprende.
  const renamed = renameFocus;
  if (renamed !== null && toRestore !== renamed.from) renameFocus = null;
  else if (renamed !== null && entry(renamed.to)) {
    toRestore = renamed.to;
    renameFocus = null;
  }

  // La voce col fuoco non c'è più: cestinata con Canc, spostata altrove,
  // rinominata in un'altra cartella, nascosta da una cartella chiusa. Il fuoco
  // non cade su `body`, dove le battute dopo si perderebbero (IMP-154): va
  // alla voce vicina che resta.
  let fallback: HTMLElement | null = null;
  if (toRestore !== undefined && !entry(toRestore)) {
    toRestore = nearby.find((path) => entry(path) !== undefined);
    if (toRestore === undefined) {
      fallback = treeEntries()[0] ?? fileListEl.querySelector<HTMLElement>(".tree-empty button");
      toRestore = fallback?.dataset.path;
    }
  }

  roving(toRestore);
  selection?.repaint();
  treeMotion?.settle();
  treeMotion = null;
  paintThumbnails();
  // Righe ridisegnate: un blocco già fuori dalla colonna rimisura le note.
  dropOffersChanged();
  if (toRestore !== undefined) {
    const row = entry(toRestore);
    const control = onChevron
      ? row?.querySelector<HTMLElement>(":scope > .tree-row > .chevron:not(:disabled)")
      : null;
    (control ?? row)?.focus();
  } else {
    fallback?.focus();
  }
}

/// Dove va il fuoco se `item` sparisce dall'albero, in ordine di preferenza:
/// le voci che la seguono nello stesso gruppo, poi quelle che la precedono
/// (dalla più vicina), poi la cartella che la contiene e le sue antenate. Si
/// legge prima del ridisegno, dai nodi di prima; dopo vale la prima che c'è
/// ancora. Più voci sparite insieme (una scelta multipla nel cestino) si
/// saltano tutte.
function neighbours(item: HTMLElement): string[] {
  const out: string[] = [];
  const add = (each: Element | null) => {
    const path = each instanceof HTMLElement && each.matches('li[role="treeitem"]') ? each.dataset.path : undefined;
    if (path !== undefined) out.push(path);
  };
  for (let next = item.nextElementSibling; next; next = next.nextElementSibling) add(next);
  for (let previous = item.previousElementSibling; previous; previous = previous.previousElementSibling) add(previous);
  for (let parent = item.parentElement?.closest('li[role="treeitem"]') ?? null; parent; parent = parent.parentElement?.closest('li[role="treeitem"]') ?? null) {
    add(parent);
  }
  return out;
}

/// Rifà l'albero intero, dal contenuto caricato.
function rebuildTree(): void {
  // Durante un trascinamento la riga trascinata **non si ricrea**: un nodo
  // staccato non riceve più `dragend`, e il gesto resterebbe appeso a un
  // `drag` che nessuno azzera. Si tiene il nodo e, rifatto l'albero, lo si
  // rimette al posto della riga nuova con lo stesso path.
  const held = drag
    ? fileListEl.querySelector<HTMLElement>(`.tree-row[draggable="true"][data-path="${CSS.escape(drag.path)}"]`)
    : null;
  fileListEl.innerHTML = "";
  hiddenXmp = 0;
  renderChildren(state.activeSpace ?? "", fileListEl);
  if (held && drag) {
    fileListEl
      .querySelector<HTMLElement>(`.tree-row[draggable="true"][data-path="${CSS.escape(drag.path)}"]`)
      ?.replaceWith(held);
  }
  // Un vault (o uno spazio) senza niente dentro lo dice, e offre il primo gesto.
  // Gli XMP nascosti non fanno vuoto un vault che ha soltanto quelli.
  if (fileListEl.childElementCount === 0 && hiddenXmp === 0 && state.vaultRoot !== "" && children(state.activeSpace ?? "")) {
    const li = document.createElement("li");
    li.setAttribute("role", "none");
    li.className = "tree-empty";
    const text = document.createElement("p");
    text.textContent = t("explorer.empty");
    const create = document.createElement("button");
    create.type = "button";
    create.className = "link-button";
    create.textContent = t("commands.note.new");
    create.addEventListener("click", () => void newNote());
    li.append(text, create);
    // Il primo gesto può anche essere un disegno, se il kernel sa farli.
    if (newKinds().includes("drawing")) {
      const draw = document.createElement("button");
      draw.type = "button";
      draw.className = "link-button";
      draw.textContent = t("explorer.empty.new_drawing");
      draw.addEventListener("click", () => void newDrawing(state.activeSpace ?? ""));
      // Uno spazio fra i due, che vanno a capo insieme se non ci stanno.
      li.append(document.createTextNode(" "), draw);
    }
    fileListEl.append(li);
  }
}

/// Rifà il sottoalbero della cartella `path` appena aperta o chiusa, e la sua
/// freccia; il resto dell'albero non si tocca. `false` se la cartella non è
/// disegnata come ci si aspetta: allora si rifà tutto.
///
/// Aprire una cartella di duecento voci ricreava anche le righe di fuori, e
/// in un albero già lungo era quello a far saltare il fotogramma del moto. Le
/// righe di fuori restano gli stessi nodi: la riga trascinata non si stacca,
/// il puntatore che resta sulla cartella non trova una riga nuova.
function patchFolder(path: string): boolean {
  const li = fileListEl.querySelector<HTMLElement>(`li[role="treeitem"][data-path="${CSS.escape(path)}"]`);
  const row = li?.querySelector<HTMLElement>(":scope > .tree-row.folder");
  const chevron = row?.querySelector<HTMLElement>(":scope > .chevron:not(:disabled)");
  if (!li || !row || !chevron) return false;
  const open = state.expanded.has(path);
  // L'immagine di una chiusura ancora in corsa è `inert`: non è il gruppo.
  const group = li.querySelector<HTMLElement>(":scope > .tree-children:not([inert])");
  if (open === (group !== null)) return false;
  if (open) {
    const nested = document.createElement("ul");
    nested.className = "tree-children";
    nested.setAttribute("role", "group");
    renderChildren(path, nested);
    row.after(nested);
  } else {
    group?.remove();
  }
  li.setAttribute("aria-expanded", String(open));
  chevron.textContent = open ? "▾" : "▸";
  chevron.setAttribute("aria-expanded", String(open));
  return true;
}

/// Le voci dell'albero, nell'ordine in cui si vedono.
///
/// «Che si vedono» è gratis: una cartella chiusa non disegna i propri figli
/// (`renderChildren`), quindi ciò che è nel DOM è esattamente ciò che è a
/// schermo. Se un giorno l'albero disegnasse tutto e nascondesse col CSS,
/// questa funzione diventerebbe il posto da cui filtrare — ed è il motivo per
/// cui è una funzione e non una `querySelectorAll` ripetuta tre volte.
function treeEntries(): HTMLElement[] {
  return Array.from(fileListEl.querySelectorAll<HTMLElement>('li[role="treeitem"]'));
}

export function entry(path: string): HTMLElement | undefined {
  return treeEntries().find((v) => v.dataset.path === path);
}

/// Accende il `tabindex` di **una** voce sola: quella che il tab troverà
/// entrando nell'albero.
///
/// L'ordine di preferenza è quello che serve a chi arriva: dove si era, poi la
/// nota aperta, poi la prima. Senza il secondo caso, entrare nell'albero
/// riporterebbe sempre in cima anche quando si sta lavorando su una nota in
/// fondo.
function roving(preferred?: string): void {
  const targetPath = preferred ?? state.currentDoc;
  let targetLi: HTMLElement | null = null;
  if (targetPath) {
    try {
      targetLi = fileListEl.querySelector<HTMLElement>(
        `li[role="treeitem"][data-path="${CSS.escape(targetPath)}"]`,
      );
    } catch {
      targetLi = null;
    }
  }
  if (!targetLi) {
    targetLi = fileListEl.querySelector<HTMLElement>('li[role="treeitem"]');
  }
  if (!targetLi) return;

  fileListEl
    .querySelectorAll<HTMLElement>('li[role="treeitem"][tabindex="0"]')
    .forEach((li) => {
      if (li !== targetLi) li.tabIndex = -1;
    });
  targetLi.tabIndex = 0;
}

/// Le frecce dentro l'albero (§12.4).
///
/// Sono i tasti di un elenco di file, e sono quelli che chiunque prova per
/// primo: su e giù per scorrere, destra per aprire, sinistra per chiudere o per
/// risalire, Invio per aprire la nota. L'ascoltatore è **uno**, sul contenitore
/// — le voci si ridisegnano a ogni giro, e un ascoltatore per riga sarebbe un
/// ascoltatore in più a ogni ridisegno su elementi già buttati via.
///
/// **Un ascoltatore solo sul contenitore vede anche i tasti che non sono suoi**,
/// ed è il prezzo di quella scelta: la rinomina in posto mette un campo di testo
/// *dentro* una voce dell'albero (`startRename`), quindi ogni battuta là dentro
/// risaliva fin qui. Invio confermava la rinomina **e** faceva il `click` sulla
/// riga, cioè riapriva il path vecchio — che dopo la rinomina non esiste più:
/// una tab fantasma, e il salvataggio successivo che **ricrea il file appena
/// rinominato**. Le frecce erano lo stesso difetto in tono minore: il `preventDefault`
/// impediva di muovere il cursore nel nome che si stava scrivendo. La regola sta
/// qui e non nel campo — chi mette un input dentro l'albero non deve saperlo —
/// ed è la stessa che vale per ogni contenitore che ascolta la tastiera dei
/// propri figli: **i tasti di un campo sono del campo**.
function treeArrows(lifetime: Lifetime): void {
  lifetime.listen(fileListEl, "keydown", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    if ((e.key === "Enter" || e.key === " ") && target.closest("button, a[href]")) return;
    const current = target.closest<HTMLElement>('li[role="treeitem"]');
    if (!current) return;
    // I binding rimappabili prevalgono: un accordo con modificatori (anche su
    // Invio, Spazio o frecce) è della tastiera globale, non dell'albero.
    // Ctrl-C e Ctrl-V copiano file da una cartella all'altra, come nel file
    // manager del sistema. Nessuno dei due è un accordo della tastiera globale.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "c" || e.key === "v")) {
      const path = current.dataset.path;
      if (path === undefined) return;
      const folder = current.hasAttribute("aria-expanded");
      e.preventDefault();
      if (e.key === "c") copyEntries(folder ? [] : pickedOr(path));
      else void pasteEntries(folder ? path : parentPath(path));
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Tasto Menu / Shift+F10: il contestuale della voce a fuoco, per la stessa
    // strada del click destro — stesse voci, stessa disponibilità.
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      openRowMenu(current);
      return;
    }
    // Shift+arrows reorder the same siblings as drag-before/after.
    if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      reorderAdjacent(current, e.key === "ArrowUp" ? -1 : 1);
      return;
    }

    const entries = treeEntries();
    const i = entries.indexOf(current);
    const expanded = current.getAttribute("aria-expanded");
    const path = current.dataset.path;

    const move = (n: HTMLElement | undefined) => {
      if (!n) return;
      for (const v of entries) v.tabIndex = v === n ? 0 : -1;
      n.focus();
    };

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(entries[i + 1]);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(entries[i - 1]);
        return;
      case "Home":
        e.preventDefault();
        move(entries[0]);
        return;
      case "End":
        e.preventDefault();
        move(entries[entries.length - 1]);
        return;
      case "ArrowRight":
        e.preventDefault();
        // Chiusa: si apre. Aperta: si scende dentro. È la stessa freccia con
        // due significati, e sono l'uno la continuazione dell'altro.
        if (expanded === "false" && path !== undefined) toggleFolder(path);
        else if (expanded === "true") move(entries[i + 1]);
        return;
      case "ArrowLeft": {
        e.preventDefault();
        if (expanded === "true" && path !== undefined) {
          toggleFolder(path);
          return;
        }
        // Altrimenti si risale al genitore, che è il `treeitem` che contiene
        // questo — non il precedente nell'elenco, che sarebbe un fratello.
        move(current.parentElement?.closest<HTMLElement>('li[role="treeitem"]') ?? undefined);
        return;
      }
      case "Enter":
      case " ":
        e.preventDefault();
        current.querySelector<HTMLElement>(":scope > .tree-row")?.click();
        return;
      // I tasti nudi della keymap dell'albero: un accordo globale non può
      // esserlo. L'azione è quella di `shell.explorer.rename/trash`.
      case "F2": {
        if (path && (renameEntry(path) || renameFolderRow(path))) e.preventDefault();
        return;
      }
      case "Delete": {
        if (path && entryRow(path)) {
          e.preventDefault();
          void trashWithConfirm(path);
        } else if (path && folderRowOf(path)) {
          e.preventDefault();
          void trashFolderWithConfirm(path);
        }
        return;
      }
      default:
    }
  });
}

/// I figli di una cartella, ricorsivamente: prima le sottocartelle (col loro
/// sottoalbero, se aperte), poi le note. La folder note non compare tra i
/// figli: è la cartella stessa, e la apre il click sulla sua riga.
///
/// Si disegna da ciò che è **caricato**: una cartella aperta il cui contenuto
/// non è ancora arrivato non disegna figli, e li disegnerà il ridisegno che
/// segue il caricamento.
function renderChildren(path: string, ul: HTMLElement): void {
  const node = children(path);
  if (!node) return;
  for (const sub of node.folders) {
    const li = document.createElement("li");
    const row = folderRow(sub);
    li.appendChild(row);
    const open = state.expanded.has(sub.path);
    // Il ruolo sta sul `<li>` e non sulla riga, perché il `<li>` è ciò che
    // contiene anche il sottoalbero: un `treeitem` che non contiene il proprio
    // gruppo è un albero che, letto, risulta piatto. Il **nome** viene invece
    // dalla riga, o sarebbe la cartella più tutte le note che ci stanno dentro.
    treeEntry(li, row, sub.path);
    // `aria-expanded` solo su ciò che ha qualcosa da aprire: una cartella vuota
    // è una foglia, e annunciarla «compressa» prometterebbe un contenuto che
    // non c'è. Che una cartella possa essere vuota è nuovo (§14.3): prima una
    // cartella nasceva dal path di una nota, quindi ne aveva sempre almeno una.
    if (!empty(sub)) li.setAttribute("aria-expanded", String(open));
    if (open) {
      const nested = document.createElement("ul");
      nested.className = "tree-children";
      nested.setAttribute("role", "group");
      renderChildren(sub.path, nested);
      li.appendChild(nested);
    }
    ul.appendChild(li);
  }
  const folderNoteId = folderNoteOf(node, state.handledExtensions, legacyPages);
  for (const id of node.notes) {
    if (id === folderNoteId) continue;
    if (hidesXmp(id)) continue;
    const li = document.createElement("li");
    const row = noteRow(id, { draggable: true });
    li.appendChild(row);
    treeEntry(li, row, id);
    // Una nota non si espande: dichiarare `aria-expanded` su una foglia
    // annuncia «compressa» a chi non ha niente da aprire.
    if (id === state.currentDoc) li.setAttribute("aria-selected", "true");
    ul.appendChild(li);
  }
  for (const id of node.files) {
    if (hidesXmp(id)) continue;
    const li = document.createElement("li");
    const row = fileRow(id);
    li.appendChild(row);
    treeEntry(li, row, id);
    if (id === state.currentDoc) li.setAttribute("aria-selected", "true");
    ul.appendChild(li);
  }
  // Ciò che la finestra ha lasciato fuori **si dice e si può aprire**. Un
  // livello troncato in silenzio è peggio di un livello lento: chi guarda
  // conclude che la cartella contiene ciò che vede, e cerca altrove una nota
  // che c'è. Ogni gesto allarga soltanto questa finestra di una pagina.
  const other = node.otherFolders + node.otherNote;
  if (other > 0) ul.appendChild(truncatedRow(path, other));
}

/// La riga che dice quante voci di questo livello non sono disegnate.
function truncatedRow(path: string, count: number): HTMLElement {
  const li = document.createElement("li");
  li.setAttribute("role", "none");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tree-row troncata";
  button.textContent = plural(count, "explorer.altre_voci.one", "explorer.altre_voci");
  button.addEventListener("click", () => {
    const current = levelWindows.get(path) ?? LEVEL_PAGE.limit;
    levelWindows.set(path, current + LEVEL_PAGE.limit);
    void refreshFromKernel(true);
  });
  li.appendChild(button);
  return li;
}

/// Fa di un `<li>` una voce d'albero: il ruolo, il nome preso dalla riga, e il
/// posto nel giro del tab.
///
/// `tabIndex = -1` per tutti, e poi `roving()` ne accende **uno**: è la
/// convenzione dei widget ad albero, e la ragione è pratica. Un vault con
/// duecento note darebbe duecento fermate del tab fra la ricerca e l'editor;
/// con una sola, il tab entra nell'albero e le frecce ci si muovono dentro —
/// che è come si muove chiunque abbia mai usato un elenco di file.
function treeEntry(li: HTMLElement, row: HTMLElement, path: string): void {
  const name = row.querySelector<HTMLElement>(".row-name");
  if (name) {
    if (!name.id) name.id = `voce-${++entryCount}`;
    li.setAttribute("aria-labelledby", name.id);
  }
  li.setAttribute("role", "treeitem");
  li.dataset.path = path;
  li.tabIndex = -1;
}

let entryCount = 0;

/// La scelta multipla dell'albero, viva finché il pannello è montato.
export let selection: TreeSelection | null = null;

/// Apre o chiude una cartella. Aprirne una **chiede il suo contenuto**
/// (§14.4): non c'era in memoria, perché in memoria c'è ciò che si vede.
///
/// Il moto si misura qui, prima del giro, e si compie al ridisegno che segue:
/// se il giro è superato da un altro, lo compie quello. Il ridisegno tocca
/// solo il sottoalbero della cartella, se fuori da lei non è cambiato niente
/// (`patchFolder`).
export function toggleFolder(path: string): void {
  if (!state.expanded.delete(path)) state.expanded.add(path);
  saveExpanded();
  toggled = path;
  const motion = drag === null ? beginTreeMotion(fileListEl, path, treeLife ?? undefined) : null;
  treeMotion = motion;
  void refreshFromKernel(true).finally(() => {
    if (treeMotion === motion) treeMotion = null;
    // Aperta, la cartella scalda i motori dei suoi file.
    const content = state.expanded.has(path) ? view.folders.get(path) : undefined;
    if (content) warmup?.folder([...content.notes, ...content.files]);
  });
}

/// Porta in vista nell'albero il documento attivo: esce da uno spazio che non
/// lo contiene, apre le cartelle che lo contengono e scorre fino alla riga.
///
/// Non prende il fuoco: chi rivela sta scrivendo, e il gesto serve a vedere
/// dove si trova, non a lasciare l'editor. La voce diventa però la fermata del
/// tab nell'albero, così chi ci entra da tastiera parte da lì.
const FILES_AUTO_REVEAL = "files.auto-reveal";

export const FILES_CONFIRM_TRASH = "files.confirm-trash";

const FILES_LEGACY_FOLDER_PAGES = "files.legacy-folder-pages";

const CRAFT_TREE_SHOW_XMP = "craft.tree-show-xmp";

const CRAFT_TREE_THUMBNAILS = "craft.tree-thumbnails";

/// Vero se la macchina vuole che l'albero segua la nota aperta.
let autoReveal = false;

/// Falso se la macchina nasconde gli XMP dall'albero (`craft.tree-show-xmp`):
/// la ricerca, il selettore rapido, i backlink e i tag li trovano ancora.
let showXmp = true;

/// Vero se la macchina vuole le miniature nell'albero (`craft.tree-thumbnails`).
let treeThumbs = false;

/// Le miniature dell'albero, vive finché il pannello è montato.
let thumbnails: TreeThumbnails | null = null;

/// Quanti XMP l'ultimo disegno ha lasciato fuori.
let hiddenXmp = 0;

/// Un XMP che l'albero non disegna; lo conta.
function hidesXmp(id: string): boolean {
  if (showXmp || formatTagOf(id) !== "XMP") return false;
  hiddenXmp += 1;
  return true;
}

/// Dà alle righe disegnate le loro miniature, o le spegne. Senza il
/// componente `fub.craft` nessuno sa dirle.
function paintThumbnails(): void {
  if (!thumbnails) return;
  if (treeThumbs && craftServed()) thumbnails.paint(fileListEl);
  else thumbnails.reset();
}

/// Vero se il vault riconosce anche `X/X` e `X/index` come pagina di `X`.
export let legacyPages = false;

/// Apre le cartelle della nota aperta e la porta in vista, senza toccare il
/// pannello laterale né il filtro di spazio: se la nota è fuori dallo spazio
/// attivo l'albero resta com'è.
async function followActive(): Promise<void> {
  const doc = state.currentDoc;
  if (!doc) return;
  if (state.activeSpace !== null && !doc.startsWith(`${state.activeSpace}/`)) return;
  const root = state.activeSpace ?? "";
  let opened = false;
  for (let folder = parentOf(doc); folder !== "" && folder !== root; folder = parentOf(folder)) {
    if (!state.expanded.has(folder)) {
      state.expanded.add(folder);
      opened = true;
    }
  }
  if (opened) {
    saveExpanded();
    await refreshFromKernel(true);
  }
  if (state.currentDoc !== doc) return;
  entry(doc)?.scrollIntoView?.({ block: "nearest" });
}

/// Il filtro per percorso sopra l'albero, finché l'esplora è montata.
export let filter: ExplorerFilter | null = null;

/// La sezione «Tipi», finché l'esplora è montata.
export let types: ExplorerTypes | null = null;

/// Ogni voce e cartella dello spazio corrente, per il filtro: due domande sole
/// a tutto lo spazio, fatte una volta per filtro.
async function filterEntries(): Promise<FilterEntry[]> {
  const space = state.activeSpace;
  const scope = space ? { path: space, descendants: true } : undefined;
  const [folders, entries] = await Promise.all([
    vaultFolders(WITHOUT_PAGE, scope),
    vaultEntries(WITHOUT_PAGE, undefined, scope),
  ]);
  return [
    ...folders.items.filter((f) => f.path !== space).map((f): FilterEntry => ({ path: f.path, kind: "folder" })),
    ...entries.items.map((e): FilterEntry => ({ path: e.id, kind: e.kind === "document" ? "document" : "file" })),
  ];
}

/// Una voce scelta dall'elenco filtrato: la nota o il file si aprono come
/// dall'albero, e il filtro resta; una cartella chiude il filtro e si apre
/// nell'albero.
function openFiltered(entry: FilterEntry): void {
  if (entry.kind === "folder") {
    filter?.hide();
    void revealPath(entry.path, true);
  } else if (entry.kind === "document" || canShowFile(entry.path)) {
    void openDocument(entry.path);
  } else if (!(canImportFile(entry.path) && importDrawing({ kind: "vault", path: entry.path }))) {
    notify(t("explorer.no_viewer", { name: childName(entry.path) }), "info");
  }
}

async function revealActive(): Promise<void> {
  const doc = state.currentDoc;
  if (doc) await revealPath(doc, false);
}

/// Porta in vista una voce dell'albero: apre le cartelle che la contengono e,
/// con `open`, la cartella stessa. `false` se dopo il giro la voce non c'è.
async function revealPath(path: string, open: boolean): Promise<boolean> {
  if (state.activeSpace !== null && !path.startsWith(`${state.activeSpace}/`)) {
    state.activeSpace = null;
    saveActiveSpace();
  }
  const root = state.activeSpace ?? "";
  let opened = false;
  for (let folder = open ? path : parentOf(path); folder !== "" && folder !== root; folder = parentOf(folder)) {
    if (!state.expanded.has(folder)) {
      state.expanded.add(folder);
      opened = true;
    }
  }
  if (opened) saveExpanded();
  revealSidePanel("sidebar");
  showPanel("files");
  await refreshFromKernel(true);
  const li = entry(path);
  if (!li) {
    // Una cartella che non c'è non resta fra le aperte salvate.
    if (open && state.expanded.delete(path)) saveExpanded();
    return false;
  }
  roving(path);
  li.scrollIntoView?.({ block: "nearest" });
  return true;
}

/// La cartella in cui finiscono gli allegati (`files.attachment-folder`),
/// aperta nell'albero. Una cartella che non c'è ancora si dice, non si crea:
/// la crea il primo allegato. Con `./` è quella della nota aperta.
async function revealAttachments(): Promise<void> {
  const configured = (await settings()).find((item) => item.spec.key === "files.attachment-folder")?.value;
  const folder = folderForNote(typeof configured === "string" ? configured : DEFAULT_ATTACHMENT_FOLDER, state.currentDoc ?? "");
  if (!folder || !(await revealPath(folder, true))) {
    notify(t("explorer.attachments_missing", { folder }));
  }
}

/// Accende la nota aperta, nell'albero e fra le appuntate.
///
/// Prima qui si scriveva **due volte lo stesso fatto**: una classe `.active`
/// sulla riga, per chi guarda, e `aria-selected` sul `<li>`, per chi ascolta.
/// Due scritture della stessa cosa sono due cose che possono divergere, e la
/// pelle leggeva la classe — cioè quella che uno screen reader non vede. Adesso
/// c'è un solo segno per superficie, ed è quello che si annuncia: l'albero è un
/// widget di selezione, quindi `aria-selected` sul `treeitem`; le appuntate sono
/// una lista piatta, e in una lista «quello corrente» si dice `aria-current`
/// (la stessa distinzione del §2.1, in `ui/node.ts`).
function markActive(): void {
  for (const li of fileListEl.querySelectorAll<HTMLElement>(
    'li[role="treeitem"][aria-selected="true"]',
  )) {
    if (li.dataset.path !== state.currentDoc && li.dataset.picked === undefined) li.removeAttribute("aria-selected");
  }
  for (const row of pinnedListEl.querySelectorAll<HTMLElement>(".tree-row.note")) {
    if (row.dataset.path === state.currentDoc) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
  }

  if (!state.currentDoc) return;
  try {
    const esc = CSS.escape(state.currentDoc);
    const li = fileListEl.querySelector<HTMLElement>(
      `li[role="treeitem"][data-path="${esc}"]`,
    );
    if (li) li.setAttribute("aria-selected", "true");
  } catch {
    for (const li of treeEntries()) {
      if (li.dataset.path === state.currentDoc) li.setAttribute("aria-selected", "true");
      else li.removeAttribute("aria-selected");
    }
  }
}

/// Rinomina in posto: la riga della lista diventa un campo di testo.
///
/// Si rinomina il **nome pagina**, non il path: cartella ed estensione restano
/// quelle di prima, perché è ciò che l'utente si aspetta scrivendo sopra un
/// titolo. Spostare una nota altrove è un'altra operazione.
export function startRename(row: HTMLElement, id: string, preset?: string, problem?: string, folder = false): void {
  // Una cartella si chiama col suo ultimo segmento intero: non ha un'estensione
  // da tenere da parte, e `v1.2` resta `v1.2`.
  const current = folder ? childName(id) : pageName(id);
  // Il campo vive **dentro la riga**, non al posto del `li`: il `treeitem`
  // resta dov'è (stesso `data-path`, stesso `aria-selected`), quindi un
  // ridisegno concorrente non sposta il fuoco fuori dall'albero e la riga
  // può mostrare il progresso con `aria-busy`.
  const name = row.querySelector<HTMLElement>(".row-name");
  const input = document.createElement("input");
  input.value = preset ?? current;
  input.setAttribute("aria-label", current);
  if (name) {
    name.replaceWith(input);
  } else {
    row.appendChild(input);
  }
  // Perché il nome non è andato bene, **accanto al campo** e non in un avviso
  // che sparisce: chi corregge ha la frase davanti mentre scrive. Si toglie alla
  // prima battuta, che è già la correzione.
  if (problem) {
    const note = document.createElement("div");
    note.className = "tree-rename-problem";
    note.id = `rinomina-${++entryCount}`;
    note.setAttribute("role", "alert");
    note.textContent = problem;
    (row.querySelector<HTMLElement>(":scope > .tree-row") ?? row).after(note);
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", note.id);
    input.addEventListener("input", () => {
      note.remove();
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    }, { once: true });
  }
  input.focus();
  input.select();

  // Un invio in corso per questo campo: il secondo Invio è un no-op (U11),
  // ma resta il campo — chi preme due volte non perde il nome digitato.
  let busy = false;
  let closed = false;
  const cancel = () => {
    if (closed || busy) return;
    closed = true;
    renderFileList();
    entry(id)?.focus();
  };
  /// `next`: dove va il fuoco quando la conferma viene da un clic altrove
  /// (`relatedTarget` del `blur`); `null` se il clic non era su niente di
  /// focalizzabile.
  const confirm = async (next?: EventTarget | null) => {
    if (closed || busy) return;
    const newItem = input.value.trim();
    if (!newItem || newItem === current) {
      closed = true;
      renderFileList();
      if (!(next instanceof HTMLElement)) entry(id)?.focus();
      return;
    }
    // Conferma ottimista chiusa subito: il campo sparisce, la riga mostra il
    // progresso (U11) e un altro giro non può partire dallo stesso campo.
    busy = true;
    closed = true;
    // Il fuoco resta sulla voce, come con Esc: un campo disabilitato lo
    // perderebbe, e chi ha premuto Invio si ritroverebbe su `body`. Un clic su
    // qualcosa di focalizzabile lo porta lì, e lì resta.
    const item = row.closest<HTMLElement>('li[role="treeitem"]');
    if (item && fileListEl.contains(item) && !(next instanceof HTMLElement)) {
      renameFocus = { from: id, to: renamedPath(id, newItem, folder) };
      item.focus({ preventScroll: true });
    }
    input.disabled = true;
    row.setAttribute("aria-busy", "true");
    if (folder) await renameFolderTo(id, newItem, input.value);
    else await renameDoc(id, newItem, input.value);
  };

  input.addEventListener("keydown", (e) => {
    if (composingKey(e)) return;
    if (e.key === "Enter") void confirm();
    else if (e.key === "Escape") cancel();
  });
  // Cliccare altrove conferma il nome scritto, come nei file manager: solo
  // Esc annulla.
  input.addEventListener("blur", (e) => void confirm(e.relatedTarget));
}

async function renameDoc(from: string, newPageName: string, typed?: string): Promise<void> {
  const to = renamedPath(from, newPageName);

  // Il no arriva **prima** del giro IPC (§15.5), e con la stessa regola che il
  // kernel applicherebbe (`rules/mirrored.ts`, legata alla gemella Rust dalla
  // fixture del §6.2). Non è un doppione per comodità: la destinazione di un
  // rename è un nome che *nasce*, e chiederlo al kernel vorrebbe dire un giro
  // IPC, un `PluginError` da leggere e — soprattutto — il campo di testo già
  // chiuso, cioè il nome da ridigitare.
  //
  // `normalizedName` qui sopra non serve più a *giudicare* — dalla 0068 se la
  // calcola `nameFault` — ma a **mandare**: è la forma che verrebbe scritta sul
  // disco (NFC, senza spazi ai bordi dei segmenti), ed è quella che il kernel
  // deve ricevere perché il nome che l'utente rivede sia quello che c'è.
  const failure = nameFault(to, "new");
  if (failure !== null) {
    reopenRename(
      from,
      typed ?? newPageName,
      t("explorer.bad_name", { name: newPageName, reason: nameFaultText(failure) }),
    );
    return;
  }

  // Il rename riscrive i wikilink entranti, cioè file di terzi — e fra questi
  // può esserci il documento aperto. Il buffer va messo in salvo prima, o la
  // riscrittura del kernel finirebbe sotto una copia più vecchia.
  if (await ensureSaved()) {
    reopenRename(from, typed ?? newPageName);
    return;
  }
  try {
    const outcome = await renameKeepingBuffer(from, to);
    if (reportRenameCollision(outcome, typed ?? newPageName)) return;
  } catch (e) {
    // Su errore il nome precedente resta e l'input si recupera (U11): il campo
    // si riapre col testo digitato, non con un albero già ridisegnato, e la
    // ragione sta accanto al campo.
    reopenRename(from, typed ?? newPageName, t("explorer.rename_failed", { doc: from, to, reason: errorText(e) }));
    return;
  }
  // `currentDoc` lo aggiorna l'evento `document_renamed`: l'identità è il path,
  // e chi la migra è un solo punto.
}

/// Riapre il campo di rinomina sullo stesso `treeitem` col testo digitato:
/// su errore il nome precedente resta nel vault e l'input non si perde.
export function reopenRename(id: string, typed: string, problem?: string, folder = false): void {
  renameFocus = null;
  renderFileList();
  const row = folder ? folderRowOf(id) : entry(id);
  if (!row) return;
  startRename(row, id, typed, problem, folder);
}

// --- drag & drop ------------------------------------------------------------
//
// Due gesti: riordinare tra fratelli dello stesso tipo (l'ordine finisce in
// `meta.order`, per cartella) e trascinare una nota SU una cartella per
// spostarcela dentro (che è un rename: il kernel sposta il file e riscrive i
// wikilink). Una cartella trascinata su un'altra ci entra con tutto ciò che
// contiene: è `folder.rename`, una rinomina per voce con un annullamento solo.
//
// Questo gesto è della shell (decisione 0157): il contratto non dichiara un
// bersaglio di rilascio, e un terzo non ha una porta finché non esiste una
// seconda superficie che trascina. Il giorno che ci sarà, la forma è un campo
// in fondo a `ui-node` e il carico nel `payload` di `ui-action`.

export function wireDrag(row: HTMLElement, path: string, kind: "note" | "folder", isNote = kind === "note"): void {
  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    // Una voce della scelta multipla porta con sé tutte le scelte.
    const picked = selection?.paths() ?? [];
    const group = picked.length > 1 && picked.includes(path) ? picked : [path];
    drag = { path, kind, parent: parentOf(path), group };
    // La riga d'origine si solleva: il fantasma che segue il puntatore resta
    // quello del sistema, che sa uscire anche dalla finestra. La scala ha una
    // transizione, quindi l'immagine che il sistema prende adesso è a riposo.
    row.dataset.lifted = "";
    // Spostare dentro l'albero, lasciarla cadere in una nota per collegarla,
    // o fuori, in un altro programma, come il file vero che è sul disco.
    e.dataTransfer!.effectAllowed = "copyMove";
    e.dataTransfer!.setData("text/plain", group.join("\n"));
    offerOutside(e.dataTransfer!, openVaultRoot(), group);
    if (isNote && group.length === 1) e.dataTransfer!.setData(NOTE_DRAG_TYPE, path);
    // Le voci per un documento che le riceve: le cartelle non ci entrano.
    const entries: DraggedEntry[] = group
      .filter((each) => !folderRowOf(each))
      .map((each) => ({ id: each, note: each === path ? isNote : !entry(each)?.querySelector(":scope > .tree-row.file") }));
    if (entries.length) e.dataTransfer!.setData(ENTRIES_DRAG_TYPE, JSON.stringify(entries));
  });
  row.addEventListener("dragend", () => {
    row.removeAttribute("data-lifted");
    drag = null;
    cancelHoverOpen();
    clearDropMarks();
  });
  row.addEventListener("dragover", (e) => {
    const gesture = dropGesture(row, path, kind, e);
    if (!gesture) {
      cancelHoverOpen();
      return;
    }
    e.preventDefault();
    clearDropMarks();
    row.classList.add(`drop-${gesture}`);
    if (gesture === "into" && kind === "folder") scheduleHoverOpen(path);
    else cancelHoverOpen();
  });
  row.addEventListener("dragleave", (e) => {
    // Passare da un figlio all'altro della riga (icona, nome) fa risalire un
    // dragleave: la riga non è stata lasciata, e la sosta non va azzerata.
    if (e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) return;
    row.classList.remove("drop-before", "drop-after", "drop-into");
    if (hoverPath === path) cancelHoverOpen();
  });
  row.addEventListener("drop", async (e) => {
    cancelHoverOpen();
    const gesture = dropGesture(row, path, kind, e);
    clearDropMarks();
    if (!gesture || !drag) return;
    e.preventDefault();
    if (gesture === "into") await moveGroupInto(drag, path);
    else applyReorder(drag.parent, childName(drag.path), childName(path), gesture === "before");
    drag = null;
  });
}

/// Riscrive l'ordine scelto a mano di una cartella: la lista completa dei nomi
/// nell'ordine visibile, col trascinato nella posizione nuova.
///
/// La cartella è quella dei due fratelli che si stanno riordinando, quindi è a
/// schermo, quindi è caricata: `children` la trova senza chiedere niente.
///
/// Al ridisegno le righe scivolano dal posto che avevano al nuovo ordine, che
/// il gesto sia un rilascio o una voce di menu.
export function applyReorder(parent: string, dragged: string, target: string, before: boolean): void {
  const node = children(parent);
  if (!node) return;
  const names = orderedNames(node).filter((n) => n !== dragged);
  const at = names.indexOf(target);
  if (at === -1) return;
  names.splice(before ? at : at + 1, 0, dragged);
  const motion = beginTreeMotion(fileListEl, null, treeLife ?? undefined);
  treeMotion = motion;
  void setOrder(parent, names).finally(() => {
    if (treeMotion === motion) treeMotion = null;
  });
}

/// Il titolo "Note" accoglie le note trascinate fuori da ogni cartella: è la
/// radice (del vault, o dello spazio attivo).
function wireRootDropTarget(lifetime: Lifetime): void {
  lifetime.listen(filesTitleEl, "dragover", (e) => {
    const root = state.activeSpace ?? "";
    if (drag && drag.parent !== root) {
      e.preventDefault();
      filesTitleEl.classList.add("drop-into");
    }
  });
  lifetime.listen(filesTitleEl, "dragleave", () => filesTitleEl.classList.remove("drop-into"));
  lifetime.listen(filesTitleEl, "drop", async (e) => {
    filesTitleEl.classList.remove("drop-into");
    if (!drag) return;
    e.preventDefault();
    await moveGroupInto(drag, state.activeSpace ?? "");
    drag = null;
  });
}
