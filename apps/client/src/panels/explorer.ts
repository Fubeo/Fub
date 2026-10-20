// La sidebar delle note: l'albero, le appuntate, la striscia degli spazi, le
// icone, il trascinamento e la rinomina in posto.
//
// È il pannello più grosso perché è quello con più *gesti*, non con più logica:
// la logica dell'alberatura (cosa è una cartella, cosa è una folder note, che
// ordine hanno i fratelli) sta in `rules/organizer.ts`, ed è pura e provata; il
// dato sta nel sidecar (`state/organization.ts`). Qui c'è il DOM.
import { ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE, type DraggedEntry } from "../ui/drag-types";
import { revealSidePanel } from "../ui/side-panels";
import { pickFromList, promptText } from "../ui/dialogs";
import { vaultEntries, vaultFolders, folderContent, existingDocuments, settings, WITHOUT_PAGE } from "../host/query";
import { mountExplorerFilter, type ExplorerFilter, type FilterEntry } from "./explorer-filter";
import { Race } from "../ui/race";
import type { VaultFolder } from "../host/contract";
import { onEvent } from "../state/kernel";
import {
  loadOrganization,
  setIcon,
  setOrder,
  setPinned,
  setSpace,
} from "../state/organization";
import { on, saveActiveSpace, saveExpanded, saveExplorerSort, state } from "../state/store";
import { createFolder, createNote, duplicateNote, handToSystem, importIntoVault, openVaultRoot, refreshDocuments, renameFolder, trashFolder, undoLastOperation } from "../state/vault";
import { carriesFiles, offerOutside, pickedFiles, readDropped, type Dropped } from "../ui/vault-transfer";
import { confirm } from "../platform/confirm";
import {
  LEVEL_PAGE,
  childName,
  folderNoteCandidates,
  folderNoteIn,
  folderNoteOf,
  orderedNames,
  pageName,
  parentOf,
  EXPLORER_SORTS,
  sortContent,
  type ExplorerSort,
  type FolderContent,
} from "../rules/organizer";
import { $ } from "../ui/dom";
import { pickIcon, showContextMenu, type MenuItem } from "../ui/menu";
import {
  canCreateDrawing,
  canImportDrawing,
  canImportFile,
  hasKernelCommand,
  importDrawing,
  launchCommand,
  newDrawing,
  pickDrawingImport,
  registerShellCommand,
} from "../ui/commands";
import { VAULT_EXPORT } from "../ui/vault-export";
import { DEFAULT_ATTACHMENT_FOLDER } from "../editors/media/attachment-target";
import { IMPORT_PREPARE } from "../ui/note-import";
import { showPanel } from "./sidebar";
import { writeClipboardText } from "../platform/clipboard";
import { searchFor } from "../state/search-port";
import { refreshOn, registerPanel, registeredPanels, unregisterPanel } from "../ui/panel-host";
import { canShowFile, focusEditor, openDocument, openDocumentBeside } from "../state/document-controller";
import { addBookmark, loadBookmarks, type BookmarkTarget } from "../state/bookmarks";
import { openCurrentInNewWindow } from "../state/document-windows";
import { flushPendingSave, renameKeepingBuffer, type RenameResult } from "../state/document-session";
import { contextMenuItems, hasContextMenuViews, type ContextTarget } from "../ui/context-views";
import { trashManyWithConfirm, trashWithConfirm } from "./trash";
import { mountTreeSelection, type TreeSelection } from "./explorer-selection";
import { errorText } from "../host/errors";
import { nameFault, normalizedName } from "../rules/mirrored";
import { onLanguage, plural, t } from "../i18n/strings";
import { notify } from "../ui/notify";
import type { Lifetime } from "../ui/lifetime";
import { nameFaultText } from "../ui/name-fault";
import { setTooltip } from "../ui/tooltip";
import { mediaKindOfId } from "../editors/media/media-types";
import type { ResourceKind } from "../host/contract";

const fileListEl = $("#file-list");
const filesTitleEl = $("#files-title");
const spaceStripEl = $("#space-strip");
const spaceTitleEl = $("#space-title");
const pinnedTitleEl = $("#pinned-title");
const pinnedListEl = $("#pinned-list");

/// Il drag in corso nella sidebar, se c'è.
/// Il trascinamento in corso dentro l'albero: la voce presa e, se era nella
/// scelta multipla, tutte le scelte (`group`, la presa compresa).
let drag: { path: string; kind: "note" | "folder"; parent: string; group: string[] } | null = null;

/// Sostando su una cartella chiusa durante un trascinamento la si apre, come in
/// ogni file manager: così si arriva a una destinazione annidata senza mollare
/// la nota. Il timer ha un solo posto e un solo padrone (`mountExplorer`).
const HOVER_OPEN_MS = 700;
let hoverPath: string | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

function cancelHoverOpen(): void {
  clearTimeout(hoverTimer);
  hoverTimer = undefined;
  hoverPath = null;
}

function scheduleHoverOpen(path: string): void {
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

/// Ciò che serve a disegnare l'albero, come il kernel l'ha risposto (§14.3,
/// §14.4).
///
/// **Solo le cartelle visibili**: la radice (o lo spazio attivo) e ognuna di
/// quelle aperte. Prima qui c'era l'elenco di tutte le note del vault e
/// l'albero se lo costruiva la shell; adesso un vault da diecimila note ne
/// trasferisce quante ne sono a schermo.
interface View {
  /// Il contenuto di ogni cartella visibile, non ordinato: l'ordine dipende
  /// dall'organizzazione, che cambia senza che il kernel c'entri.
  folders: Map<string, FolderContent>;
  /// I documenti «attesi» che esistono davvero: le folder note possibili delle
  /// cartelle disegnate, e le note appuntate. Una domanda sola per entrambe —
  /// sono la stessa domanda, «quali di questi path ci sono».
  existing: Set<string>;
}

let view: View = { folders: new Map(), existing: new Set() };
/// La finestra richiesta per ogni livello visibile. Cresce solo per il livello
/// il cui pulsante «altre» è stato attivato; nessuna domanda perde il proprio
/// limite mentre gli altri livelli conservano il costo iniziale.
const levelWindows = new Map<string, number>();
/// L'impronta dell'ultima vista disegnata: gli eventi del kernel arrivano a
/// ogni salvataggio con una risposta quasi sempre identica, e ricostruire
/// l'albero distrugge gli `<li>` sotto il mouse.
let lastSignature = "";

export function mountExplorer(lifetime: Lifetime): void {
  lifetime.listen($("#new-note"), "click", () => void newNote());
  // Il titolo del pannello è la radice di ciò che si vede (il vault o lo
  // spazio attivo): il suo contestuale crea lì un disegno, se il kernel sa
  // farli, e una cartella.
  lifetime.listen(filesTitleEl, "contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e, [
      ...(canCreateDrawing()
        ? [{ label: t("explorer.new_drawing_here"), run: () => void newDrawing(state.activeSpace ?? "") }]
        : []),
      ...(canImportDrawing()
        ? [{ label: t("explorer.import_drawing_here"), run: () => void pickDrawingImport(state.activeSpace ?? "") }]
        : []),
      { label: t("explorer.new_folder"), run: () => startNewFolder(state.activeSpace ?? "") },
      { separator: true, label: t("explorer.import_files"), run: () => pickImport(state.activeSpace ?? "", false) },
      { label: t("explorer.import_folder"), run: () => pickImport(state.activeSpace ?? "", true) },
      { separator: true, label: t("explorer.sort"), run: () => sortMenu(e) },
      { label: t("explorer.collapse_all"), run: () => collapseAll() },
      { label: t("explorer.expand_all"), run: () => void expandAll() },
    ]);
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
  wireRootDropTarget(lifetime);
  wireOutsideDrops(lifetime);
  lifetime.add(cancelHoverOpen);
  selection = mountTreeSelection({
    list: fileListEl,
    currentDoc: () => state.currentDoc,
    trash: (paths) => trashManyWithConfirm(paths),
    move: (paths) => pickMoveFolders(paths),
    group: (paths) => groupIntoNewFolder(paths),
    lifetime,
  });
  lifetime.add(() => {
    selection = null;
  });
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
  lifetime.add(on("documents", () => filter?.stale()));
  lifetime.add(on("vault", () => filter?.hide()));
  // L'organizzazione cambiata ridisegna la stessa vista senza richiederla:
  // icone, pin e ordine non passano dal kernel.
  lifetime.add(on("organization", renderFileList));
  lifetime.add(on("reveal-folder", (folder) => void revealPath(folder, true)));
  // L'elenco dei comandi arriva dopo l'apertura del vault: un albero vuoto
  // offre «Nuovo disegno…» solo da quel momento, e lo toglie se il comando se
  // ne va. Un albero con delle note non ha niente da ridisegnare.
  lifetime.add(on("commands", () => {
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
  lifetime.add(onEvent("setting_changed", (event) => {
    if (event.key === FILES_AUTO_REVEAL) void readAutoReveal();
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
    view = { folders: new Map(), existing: new Set() };
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

async function refreshFromKernel(force = false): Promise<void> {
  await race.last(async (expected) => {
    const folders = await expected(loadVisible());
    const expectedItems = [
      ...[...folders.values()].flatMap((c) =>
        c.folders.flatMap((f) => folderNoteCandidates(f.path, state.handledExtensions)),
      ),
      ...state.meta.pinned,
    ];
    const newItem: View = { folders, existing: await expected(existingDocuments(expectedItems)) };
    const signature = signatureOf(newItem);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    view = newItem;
    renderFileList();
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

/// Cosa il kernel ha risposto, in una stringa: due viste con la stessa impronta
/// disegnano lo stesso albero.
function signatureOf(v: View): string {
  const folders = [...v.folders.entries()].map(
    ([path, c]) =>
      `${path}[${c.folders.map((f) => `${f.path}:${f.folders}:${f.entries}`).join(",")}][${c.notes.join(",")}][${c.files.join(",")}]`,
  );
  // La data entra nell'impronta solo se è lei a decidere l'ordine: altrimenti
  // ogni salvataggio ridisegnerebbe l'albero per niente.
  const dated = state.explorerSort.startsWith("modified")
    ? [...v.folders.values()].map((c) => JSON.stringify(c.mtimes ?? {})).join(";")
    : "";
  return `${folders.join(";")}|${[...v.existing].sort().join(",")}|${state.explorerSort}|${dated}`;
}

/// Il contenuto di una cartella nell'ordine in cui si vede, se è caricata.
function children(path: string): FolderContent | null {
  const content = view.folders.get(path);
  return content ? sortContent(content, state.meta, state.explorerSort) : null;
}

function renderFileList(): void {
  // Uno spazio rimosso (o la cui cartella non esiste più) non può restare
  // selezionato: si torna a casa senza dire niente.
  if (state.activeSpace !== null && !state.meta.spaces.includes(state.activeSpace)) {
    state.activeSpace = null;
    saveActiveSpace();
  }
  renderSpaceStrip();
  renderSpaceTitle();
  renderPinned();
  // Chi stava navigando da tastiera non deve perdere il posto: aprire una
  // cartella ridisegna **tutto** l'albero, e senza questa riga il fuoco
  // tornerebbe in cima al documento a ogni freccia destra — cioè la
  // navigazione da tastiera si romperebbe proprio nel momento in cui la si sta
  // usando.
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && fileListEl.contains(active) ? active : null;
  const toRestore = focused?.closest<HTMLElement>('li[role="treeitem"]')?.dataset.path;
  const onChevron = focused?.matches("button.chevron");

  // Durante un trascinamento la riga trascinata **non si ricrea**: un nodo
  // staccato non riceve più `dragend`, e il gesto resterebbe appeso a un
  // `drag` che nessuno azzera. Si tiene il nodo e, rifatto l'albero, lo si
  // rimette al posto della riga nuova con lo stesso path.
  const held = drag
    ? fileListEl.querySelector<HTMLElement>(`.tree-row[draggable="true"][data-path="${CSS.escape(drag.path)}"]`)
    : null;
  fileListEl.innerHTML = "";
  renderChildren(state.activeSpace ?? "", fileListEl);
  if (held && drag) {
    fileListEl
      .querySelector<HTMLElement>(`.tree-row[draggable="true"][data-path="${CSS.escape(drag.path)}"]`)
      ?.replaceWith(held);
  }
  // Un vault (o uno spazio) senza niente dentro lo dice, e offre il primo gesto.
  if (fileListEl.childElementCount === 0 && state.vaultRoot !== "" && children(state.activeSpace ?? "")) {
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
    if (canCreateDrawing()) {
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

  roving(toRestore);
  selection?.repaint();
  if (toRestore !== undefined) {
    const row = entry(toRestore);
    const control = onChevron
      ? row?.querySelector<HTMLElement>(":scope > .tree-row > .chevron:not(:disabled)")
      : null;
    (control ?? row)?.focus();
  }
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

function entry(path: string): HTMLElement | undefined {
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
  const folderNoteId = folderNoteOf(node, state.handledExtensions);
  for (const id of node.notes) {
    if (id === folderNoteId) continue;
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
let selection: TreeSelection | null = null;

/// La riga di una nota, usata sia nell'albero sia tra le appuntate (dove il
/// drag non ha senso: l'ordine delle appuntate è l'ordine in cui si appunta).
function noteRow(id: string, opts: { draggable: boolean }): HTMLElement {
  const row = document.createElement("div");
  row.className = "tree-row note";
  row.dataset.path = id;
  setTooltip(row, id);
  const icon = state.meta.icons[id];
  if (icon) row.appendChild(rowIcon(icon));
  // Senza icona la colonna resta (dal CSS, senza un nodo in più per riga): i
  // nomi si allineano con quelli che un'icona ce l'hanno.
  else row.classList.add("no-icon");
  if (opts.draggable) row.classList.add("leaf");
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = pageName(id);
  row.appendChild(name);

  row.addEventListener("click", () => void openDocument(id));
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    noteMenu(e, row, id);
  });
  if (opts.draggable) wireDrag(row, id, "note");
  return row;
}

const FILE_ICONS: Record<ResourceKind, string> = {
  image: "🖼️",
  audio: "🎵",
  video: "🎬",
  pdf: "📕",
  other: "📎",
};

/// La riga di un file che non è una nota: c'è sul disco, quindi c'è
/// nell'albero. L'icona dice che specie di media sembra; se si apre lo decide
/// il registro delle superfici, che sa quale vista mostra quei byte. Per il
/// resto la shell lo dice, invece di tentarne la lettura come testo.
function fileRow(id: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "tree-row file leaf";
  row.dataset.path = id;
  setTooltip(row, id);
  const kind = mediaKindOfId(id);
  row.appendChild(rowIcon(FILE_ICONS[kind]));
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = childName(id);
  row.appendChild(name);
  wireDrag(row, id, "note", false);
  // Un file di Excalidraw o di draw.io che Fub non mostra si apre
  // importandolo: la finestra lo prepara, e niente si scrive prima di
  // «Importa».
  row.addEventListener("click", () => {
    if (canShowFile(id)) void openDocument(id);
    else if (!(canImportFile(id) && importDrawing({ kind: "vault", path: id }))) notify(t("explorer.no_viewer", { name: childName(id) }), "info");
  });
  // Un allegato si rinomina (l'estensione resta) e si cestina come una nota:
  // il kernel li tratta allo stesso modo, e il cestino li ripristina uguali.
  // Uno che si importa lo offre per primo, anche quando Fub lo mostra, come
  // l'SVG o il PNG che draw.io esporta col disegno dentro.
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showMenuFor(
      e,
      [
        ...(canImportFile(id) ? [{ label: t("explorer.import_drawing"), run: () => void importDrawing({ kind: "vault", path: id }) }] : []),
        { label: t("explorer.rename"), hint: "F2", run: () => renameEntry(id, row) },
        { label: t("explorer.copy"), run: () => copyEntries(pickedOr(id)) },
        { label: t("explorer.move"), run: () => void pickMoveFolder(id) },
        { separator: true, label: t("explorer.delete"), hint: "Del", danger: true, run: () => void trashWithConfirm(id) },
      ],
      { kind: "file", id },
    );
  });
  return row;
}

/// Apre un contestuale con le voci della shell e, se ci sono view sulla
/// superficie `context_menu`, in coda le loro. Senza view non c'è niente da
/// aspettare e il menu compare subito, com'era.
function showMenuFor(at: MouseEvent, items: MenuItem[], target: ContextTarget): void {
  if (!hasContextMenuViews()) {
    showContextMenu(at, items);
    return;
  }
  void contextMenuItems(target).then((extra) => showContextMenu(at, [...items, ...extra]));
}

/// Le voci del contestuale di una **nota**, dalla stessa strada del click
/// destro e del tasto Menu/Shift+F10: un punto solo, o le due strade
/// divergono alla prima voce aggiunta.
function noteMenu(at: MouseEvent, row: HTMLElement, id: string): void {
  const pinned = state.meta.pinned.includes(id);
  const move = voceSpostamento(id);
  const reorder = reorderActions(id);
  showMenuFor(at, [
    { label: t("explorer.rename"), hint: "F2", run: () => renameEntry(id, row) },
    { label: t("explorer.open_beside"), run: () => void openDocumentBeside(id, "row") },
    { label: t("explorer.open_window"), run: () => void openCurrentInNewWindow(id) },
    { label: t("explorer.duplicate"), run: () => void duplicateEntry(id) },
    { label: t("explorer.copy"), run: () => copyEntries(pickedOr(id)) },
    { label: t("explorer.copy_path"), run: () => void copyPath(id) },
    { label: t("explorer.reveal_system"), run: () => void handToSystem(id, false) },
    { label: t("explorer.open_system"), run: () => void handToSystem(id, true) },
    { label: t("explorer.bookmark"), run: () => void bookmarkEntry({ k: "doc", doc: id }, id) },
    ...(move ? [move] : []),
    { label: t("explorer.to_folder"), run: () => void convertToFolder(id) },
    { separator: true, label: t("explorer.icon"), run: () => chooseIcon(at, id) },
    {
      label: pinned ? t("explorer.unpin") : t("explorer.pin"),
      run: () => togglePin(id),
    },
    ...reorder.map((action, index) => ({ ...action, separator: index === 0 })),
    { separator: true, label: t("explorer.delete"), hint: "Del", danger: true, run: () => void trashWithConfirm(id) },
  ], { kind: "note", id });
}
// Returns actions only when another sibling of the same kind is visible.
function reorderActions(id: string): Array<{ label: string; run: () => void }> {
  const row = entry(id);
  if (!row) return [];
  const siblings = reorderSiblings(row);
  const index = siblings.indexOf(row);
  return [
    ...(index > 0 ? [{ label: t("bookmarks.move_up"), run: () => reorderAdjacent(row, -1) }] : []),
    ...(index < siblings.length - 1 ? [{ label: t("bookmarks.move_down"), run: () => reorderAdjacent(row, 1) }] : []),
  ];
}

function reorderSiblings(row: HTMLElement): HTMLElement[] {
  const kind = row.querySelector(":scope > .tree-row.folder") ? "folder" : "note";
  return [...(row.parentElement?.children ?? [])]
    .filter((node): node is HTMLElement => node instanceof HTMLElement
      && node.getAttribute("role") === "treeitem"
      && !!node.querySelector(`:scope > .tree-row.${kind}`));
}

function reorderAdjacent(row: HTMLElement, delta: -1 | 1): void {
  const siblings = reorderSiblings(row);
  const at = siblings.indexOf(row);
  const other = siblings[at + delta];
  const source = row.dataset.path;
  const target = other?.dataset.path;
  if (!source || !target) return;
  applyReorder(parentOf(source), childName(source), childName(target), delta < 0);
}

/// La riga di una voce che si rinomina e si cestina da qui: una nota o un
/// allegato. Una cartella ha le sue voci nel proprio contestuale.
function entryRow(id: string): HTMLElement | null {
  const row = entry(id)?.querySelector<HTMLElement>(":scope > .tree-row");
  return row && !row.classList.contains("folder") ? row : null;
}

/// La riga di una cartella dell'albero, se `path` ne è una a schermo.
function folderRowOf(path: string): HTMLElement | null {
  const row = entry(path)?.querySelector<HTMLElement>(":scope > .tree-row");
  return row?.classList.contains("folder") ? row : null;
}

function treeFocused(): boolean {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && fileListEl.contains(focused);
}

/// La voce su cui agiscono i comandi di rinomina e cestino: quella col fuoco,
/// se il fuoco è nell'albero, altrimenti la nota attiva. Il fuoco su una
/// cartella non ricade sulla nota attiva: agire su una voce diversa da quella
/// che si guarda è la sorpresa da evitare.
function explorerTarget(): string | null {
  if (treeFocused()) {
    const li = (document.activeElement as HTMLElement).closest<HTMLElement>('li[role="treeitem"]');
    const path = li?.dataset.path;
    if (li && path) return entryRow(path) ? path : null;
  }
  return state.currentDoc;
}

/// Apre il campo del nome sulla riga della voce. Una strada sola per F2, per il
/// contestuale e per `shell.explorer.rename`: `false` se la riga non c'è. Il
/// contestuale passa la riga su cui si è aperto, che fra le appuntate non è
/// quella dell'albero.
function renameEntry(id: string, row: HTMLElement | null = entryRow(id)): boolean {
  if (!row) return false;
  startRename(row, id);
  return true;
}

/// Voce "Sposta in…" senza drag (U10): apre il selettore di destinazione.
function voceSpostamento(id: string): { label: string; run: () => void } | null {
  return { label: t("explorer.move"), run: () => void pickMoveFolder(id) };
}

/// Destinazione dello spostamento senza drag (U10): le cartelle del vault in
/// una finestra (stesso limite dell'albero), più la radice e il conto di ciò
/// che resta fuori.
async function pickMoveFolder(id: string): Promise<void> {
  await pickMoveFolders([id]);
}

/// Lo stesso selettore per più note insieme (la scelta multipla dell'albero):
/// le cartelle escluse sono quelle che non portano da nessuna parte per **tutte**
/// le note (la casa comune, le note stesse), e lo spostamento va in fila — un
/// rifiuto di una non ferma le altre, perché `moveIntoFolder` lo dice da sé.
async function pickMoveFolders(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  // Un selettore con filtro e non un menu contestuale: le cartelle di un vault
  // vero sono centinaia, e un menu senza posizione né scorrimento non le regge.
  const folders = await vaultFolders(FOLDER_PICK);
  const homes = new Set(ids.map(parentOf));
  const here = homes.size === 1 ? [...homes][0]! : null;
  const other = Math.max(0, folders.total - folders.items.length);
  const choice = await pickFromList<string>({
    title:
      ids.length === 1
        ? t("explorer.move_title", { name: childName(ids[0]!) })
        : t("explorer.move_many_title", { n: String(ids.length) }),
    placeholder: t("explorer.move_filter"),
    items: [
      // La radice (del vault) come prima destinazione: è dove il drag porta
      // trascinando sul titolo "Note".
      ...(here !== "" ? [{ label: t("explorer.root"), value: "" }] : []),
      ...folders.items
        .filter((f) => f.path !== here && !ids.some((id) => f.path === id || f.path.startsWith(`${id}/`)))
        .map((f) => ({ label: `${state.meta.icons[f.path] ?? "📁"} ${childName(f.path)}`, detail: f.path, value: f.path })),
    ],
    more: other,
  });
  if (choice === null) return;
  for (const id of ids) {
    if (folderRowOf(id)) await moveFolderInto(id, choice);
    else await moveIntoFolder(id, choice);
  }
}

/// «In una cartella nuova»: la cartella nasce nella casa comune delle note
/// scelte (la radice visibile, se ne hanno più d'una) e le note ci entrano con
/// lo stesso spostamento del menu. Se la cartella non nasce, nessuna si muove.
async function groupIntoNewFolder(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const homes = new Set(ids.map(parentOf));
  const parent = homes.size === 1 ? [...homes][0]! : (state.activeSpace ?? "");
  const name = (await promptText({ title: t("explorer.selection.group"), label: t("explorer.new_folder") }))?.trim();
  if (!name) return;
  const wanted = parent ? `${parent}/${name}` : name;
  try {
    await createFolder(wanted);
  } catch (e) {
    notify(t("explorer.new_folder_failed", { folder: wanted, reason: errorText(e) }), "guasto");
    return;
  }
  for (const folder of [parent, wanted]) if (folder) state.expanded.add(folder);
  saveExpanded();
  for (const id of ids) await moveIntoFolder(id, wanted);
  await refreshFromKernel(true);
}

/// Quante cartelle chiede il selettore di destinazione: più di un livello
/// dell'albero, perché qui si filtrano.
const FOLDER_PICK = { offset: 0, limit: 2000 };

/// Il contestuale della voce dell'albero a fuoco, per tastiera: apre il menu
/// della nota o della cartella sotto il `treeitem`, alla sua posizione.
function openRowMenu(li: HTMLElement): void {
  const row = li.querySelector<HTMLElement>(":scope > .tree-row");
  const path = li.dataset.path;
  if (!row || !path) return;
  const box = row.getBoundingClientRect();
  const at = new MouseEvent("contextmenu", {
    clientX: box.left + 24,
    clientY: box.top + box.height / 2,
    bubbles: true,
    cancelable: true,
  });
  if (row.classList.contains("folder")) folderMenu(at, path);
  else noteMenu(at, row, path);
}

/// Una cartella senza niente dentro: né sottocartelle né file, di nessuna
/// specie. I due conti arrivano dal kernel col resto della riga (§14.3), quindi
/// saperlo non costa una domanda in più.
function empty(folder: VaultFolder): boolean {
  return folder.folders === 0 && folder.entries === 0;
}

/// La riga di una cartella: freccia per aprire/chiudere, click che apre la
/// folder note se c'è (altrimenti apre/chiude, come la freccia).
function folderRow(folder: VaultFolder): HTMLElement {
  const row = document.createElement("div");
  row.className = "tree-row folder";
  setTooltip(row, folder.path);

  // Espansore separato dall'apertura (U09): un bottone nativo, quindi tabbabile
  // e attivabile da tastiera senza passare dall'albero. La riga resta
  // cliccabile intera: chi apre la folder note non deve centrare la freccia.
  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.className = "chevron";
  // Fuori dal giro del tab e dall'albero accessibile: da tastiera le frecce
  // aprono e chiudono il `treeitem`, e un bottone dentro una voce d'albero è un
  // interattivo annidato (e una fermata di tab per cartella).
  chevron.tabIndex = -1;
  chevron.setAttribute("aria-hidden", "true");
  // Niente freccia su una cartella vuota: lo spazio resta (l'allineamento dei
  // fratelli è lo stesso), ma non si promette un contenuto che non c'è —
  // e il bottone disabilitato resta fuori dal tab.
  if (empty(folder)) {
    chevron.disabled = true;
    chevron.setAttribute("aria-label", childName(folder.path));
  } else {
    const open = state.expanded.has(folder.path);
    chevron.textContent = open ? "▾" : "▸";
    chevron.setAttribute("aria-label", childName(folder.path));
    chevron.setAttribute("aria-expanded", String(open));
    chevron.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFolder(folder.path);
    });
  }
  row.appendChild(chevron);
  row.appendChild(rowIcon(state.meta.icons[folder.path] ?? "📁"));

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = childName(folder.path);
  row.appendChild(name);

  // La folder note di una cartella **non aperta** non si sa guardandoci dentro
  // — guardarci dentro è il giro che questa voce toglie. Si sa perché il
  // kernel ha già detto quali, fra i path che potrebbero esserlo, esistono.
  const folderNoteId = folderNoteIn(folder.path, state.handledExtensions, view.existing);
  if (folderNoteId) row.classList.add("has-note");
  row.addEventListener("click", () => {
    if (folderNoteId) {
      void openDocument(folderNoteId);
      if (!state.expanded.has(folder.path) && !empty(folder)) toggleFolder(folder.path);
    } else if (!empty(folder)) {
      toggleFolder(folder.path);
    }
  });
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    folderMenu(e, folder.path);
  });
  wireDrag(row, folder.path, "folder");
  return row;
}

/// Le voci del contestuale di una **cartella**: stesse voci del click destro e
/// del tasto Menu, un punto solo.
function folderMenu(at: MouseEvent, path: string): void {
  const reorder = reorderActions(path);
  showMenuFor(
    at,
    [
      { label: t("explorer.new_note_here"), run: () => void newNote(path) },
      // Accanto alla nota, se il kernel sa fare disegni: la cartella arriva alla
      // galleria già scelta.
      ...(canCreateDrawing()
        ? [{ label: t("explorer.new_drawing_here"), run: () => void newDrawing(path) }]
        : []),
      ...(canImportDrawing()
        ? [{ label: t("explorer.import_drawing_here"), run: () => void pickDrawingImport(path) }]
        : []),
      { label: t("explorer.new_folder"), run: () => startNewFolder(path) },
      ...(copied.length > 0 && copied[0]!.vault === openVaultRoot()
        ? [{ label: t("explorer.paste"), run: () => void pasteEntries(path) }]
        : []),
      { label: t("explorer.import_files"), run: () => pickImport(path, false) },
      { label: t("explorer.import_folder"), run: () => pickImport(path, true) },
      ...(hasKernelCommand(IMPORT_PREPARE)
        ? [{ label: t("explorer.import_notes"), run: () => void launchCommand(IMPORT_PREPARE, { folder: path }) }]
        : []),
      ...(hasKernelCommand(VAULT_EXPORT)
        ? [{ label: t("explorer.export_folder"), run: () => void launchCommand(VAULT_EXPORT, { folder: path }) }]
        : []),
      { separator: true, label: t("explorer.rename"), hint: "F2", run: () => void renameFolderRow(path) },
      { label: t("explorer.move"), run: () => void pickMoveFolders([path]) },
      { label: t("explorer.copy_path"), run: () => void copyPath(path) },
      { label: t("explorer.reveal_system"), run: () => void handToSystem(path, false) },
      { label: t("explorer.bookmark"), run: () => void bookmarkEntry({ k: "folder", path }, path) },
      { label: t("explorer.search_in_folder"), run: () => searchInFolder(path) },
      { separator: true, label: t("explorer.icon"), run: () => chooseIcon(at, path) },
      { label: t("explorer.as_space"), run: () => addSpace(path) },
      ...reorder.map((action, index) => ({ ...action, separator: index === 0 })),
      { separator: true, label: t("explorer.delete"), hint: "Del", danger: true, run: () => void trashFolderWithConfirm(path) },
    ],
    { kind: "folder", id: path },
  );
}

function rowIcon(icon: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "row-icon";
  span.textContent = icon;
  span.setAttribute("aria-hidden", "true");
  return span;
}

/// Apre o chiude una cartella. Aprirne una **chiede il suo contenuto**
/// (§14.4): non c'era in memoria, perché in memoria c'è ciò che si vede.
function toggleFolder(path: string): void {
  if (!state.expanded.delete(path)) state.expanded.add(path);
  saveExpanded();
  void refreshFromKernel(true);
}

/// Porta in vista nell'albero il documento attivo: esce da uno spazio che non
/// lo contiene, apre le cartelle che lo contengono e scorre fino alla riga.
///
/// Non prende il fuoco: chi rivela sta scrivendo, e il gesto serve a vedere
/// dove si trova, non a lasciare l'editor. La voce diventa però la fermata del
/// tab nell'albero, così chi ci entra da tastiera parte da lì.
const FILES_AUTO_REVEAL = "files.auto-reveal";
const FILES_CONFIRM_TRASH = "files.confirm-trash";

/// Vero se la macchina vuole che l'albero segua la nota aperta.
let autoReveal = false;

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
let filter: ExplorerFilter | null = null;

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
/// la crea il primo allegato.
async function revealAttachments(): Promise<void> {
  const configured = (await settings()).find((item) => item.spec.key === "files.attachment-folder")?.value;
  const folder = (typeof configured === "string" ? configured : DEFAULT_ATTACHMENT_FOLDER).trim().replace(/\/+$/g, "");
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

// --- appuntate, icone, spazi ------------------------------------------------

/// Le appuntate che esistono ancora.
///
/// Quali esistano lo dice il kernel — sono nella stessa domanda delle folder
/// note (§14.4) — e non un elenco del vault da cui pescarle: un'appuntata è un
/// path scritto nel sidecar, e verificarne cinque non è una ragione per
/// chiedere diecimila righe.
function renderPinned(): void {
  const pinned = state.meta.pinned.filter((id) => view.existing.has(id));
  // U08: la sezione Appuntate si vede soltanto se contiene elementi.
  // Col filtro aperto l'elenco filtrato sta al posto di albero e appuntate.
  const hidePinned = pinned.length === 0 || filter?.active() === true;
  pinnedTitleEl.hidden = hidePinned;
  pinnedListEl.hidden = hidePinned;
  pinnedListEl.innerHTML = "";
  for (const id of pinned) {
    const li = document.createElement("li");
    const row = noteRow(id, { draggable: false });
    if (id === state.currentDoc) row.setAttribute("aria-current", "true");
    li.appendChild(row);
    pinnedListEl.appendChild(li);
  }
}

function togglePin(id: string): void {
  void setPinned(id, !state.meta.pinned.includes(id));
}

function chooseIcon(at: MouseEvent, path: string): void {
  pickIcon(at, (icon) => {
    void setIcon(path, icon ?? null);
  });
}

// Uno spazio è una cartella registrata nella striscia di icone in cima alla
// sidebar (stile make.md): selezionarlo radica l'albero lì, e il resto del
// vault non esiste. La prima icona è "home", cioè il vault intero.

function renderSpaceStrip(): void {
  spaceStripEl.innerHTML = "";
  // U07: striscia col nome, non solo emoji — lo spazio attivo si legge, gli
  // altri hanno nome accessibile + tooltip col percorso completo. Overflow con
  // scroll locale del contenitore (mai hit-area ridotta sotto misura).
  spaceStripEl.setAttribute("role", "toolbar");
  spaceStripEl.setAttribute("aria-label", t("explorer.notes"));

  const home = document.createElement("button");
  home.className = "space-chip";
  home.setAttribute("aria-pressed", String(state.activeSpace === null));
  home.textContent = "🏠";
  home.setAttribute("aria-label", t("explorer.whole_vault"));
  setTooltip(home, t("explorer.whole_vault"));
  home.addEventListener("click", () => selectSpace(null));
  spaceStripEl.appendChild(home);

  for (const path of state.meta.spaces) {
    const chip = document.createElement("button");
    chip.className = "space-chip";
    chip.setAttribute("aria-pressed", String(state.activeSpace === path));
    chip.textContent = state.meta.icons[path] ?? "🗂️";
    // Nome annunciato (V15): emoji + nome spazio, non solo il simbolo.
    chip.setAttribute("aria-label", `${state.meta.icons[path] ?? "🗂️"} ${childName(path)}`);
    setTooltip(chip, path);
    chip.addEventListener("click", () => selectSpace(path));
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, [
        { label: t("explorer.icon"), run: () => chooseIcon(e, path) },
        { label: t("explorer.not_a_space"), run: () => removeSpace(path) },
      ]);
    });
    spaceStripEl.appendChild(chip);
  }

  const add = document.createElement("button");
  add.className = "space-chip add";
  // «+» non è uno degli spazi: apre il gesto che ne crea uno. Senza
  // `aria-pressed` non entra nel gruppo di quelli che si escludono a vicenda —
  // che è ciò che è, e ciò che va detto.
  add.textContent = "+";
  add.setAttribute("aria-label", t("explorer.new_space"));
  setTooltip(add, t("explorer.new_space"));
  add.addEventListener("click", (e) => void pickNewSpace(e));
  spaceStripEl.appendChild(add);
}

/// Il titolo del pannello: il nome dello spazio attivo (cliccarlo apre la sua
/// folder note), o "Note" a casa.
function renderSpaceTitle(): void {
  spaceTitleEl.textContent =
    state.activeSpace === null
      ? t("explorer.notes")
      : `${state.meta.icons[state.activeSpace] ?? "🗂️"} ${childName(state.activeSpace)}`;
  spaceTitleEl.classList.toggle("clickable", state.activeSpace !== null);
}

/// Cambiare spazio cambia la **radice** dell'albero, quindi cambia quali
/// cartelle sono visibili: si richiede, non si ridisegna soltanto.
function selectSpace(path: string | null): void {
  state.activeSpace = path;
  saveActiveSpace();
  void refreshFromKernel(true);
}

/// Registra una cartella come spazio (se già non lo è) e la seleziona.
function addSpace(path: string): void {
  if (!state.meta.spaces.includes(path)) void setSpace(path, true);
  selectSpace(path);
}

/// Toglie lo spazio dalla striscia. La cartella e le note restano dove sono:
/// uno spazio è solo un punto di vista, non un contenitore.
function removeSpace(path: string): void {
  if (!state.meta.spaces.includes(path)) return;
  if (state.activeSpace === path) state.activeSpace = null;
  saveActiveSpace();
  void setSpace(path, false);
}

/// Il "+" della striscia: un menu con le cartelle del vault non ancora spazi.
///
/// Le cartelle le elenca il kernel (§14.3), a ogni profondità: prima si
/// ricavavano dai path delle note, quindi una cartella vuota non compariva —
/// ed è esattamente quella che si vuole poter eleggere a spazio prima di
/// riempirla.
async function pickNewSpace(at: MouseEvent): Promise<void> {
  // Un menu contestuale con una voce per cartella del vault non è un menu: la
  // finestra è la stessa dell'albero, e le altre si dicono invece di sparire.
  const folders = await vaultFolders(LEVEL_PAGE);
  const candidate = folders.items.filter((f) => !state.meta.spaces.includes(f.path));
  if (candidate.length === 0) {
    showContextMenu(at, [{ label: t("explorer.no_folders"), run: () => {} }]);
    return;
  }
  const other = Math.max(0, folders.total - folders.items.length);
  showContextMenu(at, [
    ...candidate.map((f) => ({
      label: `${state.meta.icons[f.path] ?? "📁"} ${f.path}`,
      run: () => addSpace(f.path),
    })),
    ...(other > 0 ? [{ label: plural(other, "explorer.altre_cartelle.one", "explorer.altre_cartelle"), run: () => {} }] : []),
  ]);
}

/// Il nome dello spazio nel titolo apre la sua folder note, se esiste.
///
/// Lo spazio attivo è la **radice** dell'albero disegnato, quindi il suo
/// contenuto è già in mano: non serve chiederlo di nuovo.
function openSpaceNote(): void {
  if (state.activeSpace === null) return;
  const node = children(state.activeSpace);
  const folderNoteId = node && folderNoteOf(node, state.handledExtensions);
  if (folderNoteId) void openDocument(folderNoteId);
}

// --- crea, rinomina, converti -----------------------------------------------

/// Crea una nota e la apre.

const SORT_LABELS = {
  manual: "explorer.sort.manual",
  "name-asc": "explorer.sort.name-asc",
  "name-desc": "explorer.sort.name-desc",
  "modified-new": "explorer.sort.modified-new",
  "modified-old": "explorer.sort.modified-old",
} as const satisfies Record<ExplorerSort, string>;

/// Il sotto-menu dell'ordine, con quello in uso selezionato.
function sortMenu(at: MouseEvent): void {
  showContextMenu(
    at,
    EXPLORER_SORTS.map((mode) => ({
      label: t(SORT_LABELS[mode]),
      selected: state.explorerSort === mode,
      run: () => setSort(mode),
    })),
  );
}

/// Cambia l'ordine dell'albero e lo ridisegna: l'impronta lo include.
function setSort(mode: ExplorerSort): void {
  if (state.explorerSort === mode) return;
  state.explorerSort = mode;
  saveExplorerSort();
  void refreshFromKernel(true);
}

/// Chiude ogni cartella aperta.
function collapseAll(): void {
  if (state.expanded.size === 0) return;
  state.expanded.clear();
  saveExpanded();
  void refreshFromKernel(true);
}

/// Apre ogni cartella che l'albero conosce. Un livello si carica quando si
/// apre, quindi un livello nuovo porta le sue sottocartelle e ci si ferma
/// quando non ne arrivano più; il tetto difende da vault enormi.
async function expandAll(): Promise<void> {
  for (let round = 0; round < EXPAND_ROUNDS; round += 1) {
    let added = false;
    for (const content of view.folders.values()) {
      for (const sub of content.folders) {
        if (!state.expanded.has(sub.path)) {
          state.expanded.add(sub.path);
          added = true;
        }
      }
    }
    if (!added) break;
    saveExpanded();
    await refreshFromKernel(true);
  }
}

/// Quanti livelli di profondità `expandAll` scende al massimo.
const EXPAND_ROUNDS = 12;

/// I file copiati con Ctrl-C, ciascuno col vault da cui viene: un incolla in
/// un altro vault non troverebbe l'originale.
let copied: { vault: string | undefined; id: string }[] = [];

/// Le voci scelte se `id` è fra loro, altrimenti `id` da solo.
function pickedOr(id: string): string[] {
  const picked = selection?.paths() ?? [];
  return picked.includes(id) ? picked : [id];
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/// Copia: niente si scrive finché non si incolla.
function copyEntries(ids: string[]): void {
  if (ids.length === 0) return;
  const vault = openVaultRoot();
  copied = ids.map((id) => ({ vault, id }));
  notify(t("explorer.copied", { count: String(ids.length) }), "info");
}

/// Incolla nella cartella: ogni file è una copia dei suoi byte, col nome
/// dell'originale se lì è libero. Uno che non riesce non ferma gli altri.
async function pasteEntries(folder: string): Promise<void> {
  const vault = openVaultRoot();
  const ids = copied.filter((entry) => entry.vault === vault).map((entry) => entry.id);
  if (ids.length === 0) return;
  for (const id of ids) {
    try {
      await duplicateNote(id, folder);
    } catch (error) {
      notify(t("explorer.paste_failed", { name: childName(id), reason: errorText(error) }), "guasto");
    }
  }
}

/// Duplica il file e apre la copia: il nome libero lo sceglie il kernel.
async function duplicateEntry(id: string): Promise<void> {
  try {
    const copy = await duplicateNote(id);
    if (copy) await openDocument(copy);
  } catch (error) {
    notify(t("explorer.duplicate_failed", { reason: errorText(error) }), "guasto");
  }
}

/// Il percorso della voce relativo al vault, negli appunti.
/// «Segnalibro» dal menu di una riga: carica prima lo stato salvato, così
/// l'aggiunta non parte da una memoria vuota.
async function bookmarkEntry(target: BookmarkTarget, path: string): Promise<void> {
  await loadBookmarks();
  const title = path.split("/").filter(Boolean).pop() ?? path;
  if (addBookmark(title, target)) notify(t("bookmarks.saved"), "info");
  else notify(t("bookmarks.save_failed"), "guasto");
}

async function copyPath(path: string): Promise<void> {
  try {
    await writeClipboardText(path);
  } catch {
    // Senza appunti non c'è niente da dire: il gesto è un comodo, non un dato.
  }
}

/// Porta nel pannello Cerca una domanda ristretta alla cartella.
function searchInFolder(path: string): void {
  revealSidePanel("sidebar");
  showPanel("search");
  searchFor(`folder:"${path.replace(/"/g, "")}" `);
}

async function newNote(folder: string | null = state.activeSpace): Promise<void> {
  try {
    const created = await createNote(undefined, folder ?? undefined);
    if (created) {
      if (folder && !state.expanded.has(folder)) {
        state.expanded.add(folder);
        saveExpanded();
      }
      await openDocument(created);
    }
    focusEditor();
  } catch (error) {
    notify(t("explorer.create_failed", { reason: errorText(error) }), "guasto");
  }
}

/// Una cartella nuova dentro `parent` ("" è la radice): un campo in cima al
/// livello, lo stesso gesto della rinomina in posto.
///
/// Il nome passa dal kernel (`folder.create`) e non da una regola della shell:
/// recinto, nomi riservati e collisioni hanno un giudice solo, e il rifiuto
/// arriva come errore tipizzato da mostrare. Il campo resta finché il comando
/// non risponde, così un secondo Invio non parte due volte.
function startNewFolder(parent: string): void {
  const field = document.createElement("input");
  field.className = "new-folder";
  field.setAttribute("aria-label", t("explorer.new_folder"));
  field.placeholder = t("explorer.new_folder");
  const holder = parent ? entry(parent)?.querySelector(":scope > .tree-row") : null;
  if (holder) {
    holder.after(field);
  } else {
    fileListEl.prepend(field);
  }
  field.focus();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    field.remove();
  };
  const confirm = async () => {
    if (closed || field.disabled) return;
    const name = field.value.trim();
    if (!name) return close();
    field.disabled = true;
    const wanted = parent ? `${parent}/${name}` : name;
    try {
      await createFolder(wanted);
      if (parent && !state.expanded.has(parent)) {
        state.expanded.add(parent);
        saveExpanded();
      }
      close();
      await refreshFromKernel(true);
    } catch (e) {
      close();
      notify(t("explorer.new_folder_failed", { folder: wanted, reason: errorText(e) }), "guasto");
    }
  };
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void confirm();
    else if (e.key === "Escape") close();
  });
  field.addEventListener("blur", () => {
    if (!field.disabled) close();
  });
}

/// Rinomina in posto: la riga della lista diventa un campo di testo.
///
/// Si rinomina il **nome pagina**, non il path: cartella ed estensione restano
/// quelle di prima, perché è ciò che l'utente si aspetta scrivendo sopra un
/// titolo. Spostare una nota altrove è un'altra operazione.
function startRename(row: HTMLElement, id: string, preset?: string, problem?: string, folder = false): void {
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
  const confirm = async () => {
    if (closed || busy) return;
    const newItem = input.value.trim();
    if (!newItem || newItem === current) {
      closed = true;
      renderFileList();
      entry(id)?.focus();
      return;
    }
    // Conferma ottimista chiusa subito: il campo sparisce, la riga mostra il
    // progresso (U11) e un altro giro non può partire dallo stesso campo.
    busy = true;
    closed = true;
    input.disabled = true;
    row.setAttribute("aria-busy", "true");
    if (folder) await renameFolderTo(id, newItem, input.value);
    else await renameDoc(id, newItem, input.value);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void confirm();
    else if (e.key === "Escape") cancel();
  });
  // Cliccare altrove conferma il nome scritto, come nei file manager: solo
  // Esc annulla.
  input.addEventListener("blur", () => void confirm());
}

/// Una collisione riapre il campo col nome digitato e la frase accanto: il nome
/// è la cosa da correggere, e chiuderlo la farebbe ridigitare.
function reportRenameCollision(outcome: RenameResult, typed: string): boolean {
  if (outcome.kind !== "collision") return false;
  reopenRename(
    outcome.from,
    typed,
    t("explorer.rename_failed", {
      doc: outcome.from,
      to: outcome.to,
      reason: t("explorer.destination_open"),
    }),
  );
  return true;
}
async function renameDoc(from: string, newPageName: string, typed?: string): Promise<void> {
  const slash = from.lastIndexOf("/");
  const dir = slash === -1 ? "" : from.slice(0, slash + 1);
  const dot = from.lastIndexOf(".");
  const ext = dot > slash ? from.slice(dot) : "";
  const to = normalizedName(`${dir}${newPageName}${ext}`);

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
function reopenRename(id: string, typed: string, problem?: string, folder = false): void {
  renderFileList();
  const row = folder ? folderRowOf(id) : entry(id);
  if (!row) return;
  startRename(row, id, typed, problem, folder);
}

/// Il campo del nome sulla riga di una cartella (F2, contestuale): `false` se la
/// riga non c'è.
function renameFolderRow(path: string): boolean {
  const row = folderRowOf(path);
  if (!row) return false;
  startRename(row, path, undefined, undefined, true);
  return true;
}

/// Rinomina in posto di una cartella: cambia l'ultimo segmento, la madre resta.
/// Il nome passa dalla stessa regola di un nome che nasce, prima del giro IPC.
async function renameFolderTo(from: string, newName: string, typed: string): Promise<void> {
  const parent = parentOf(from);
  const to = normalizedName(parent ? `${parent}/${newName}` : newName);
  const failure = nameFault(to, "new");
  if (failure !== null) {
    reopenRename(from, typed, t("explorer.bad_name", { name: newName, reason: nameFaultText(failure) }), true);
    return;
  }
  const problem = await moveFolder(from, to);
  if (problem !== null) reopenRename(from, typed, problem, true);
}

/// Sposta una cartella dentro un'altra (drag, «Sposta in…»): stesso comando
/// della rinomina, col path intero nuovo.
async function moveFolderInto(path: string, folderPath: string): Promise<void> {
  if (folderPath === path || folderPath.startsWith(`${path}/`)) return;
  const to = folderPath ? `${folderPath}/${childName(path)}` : childName(path);
  const problem = await moveFolder(path, to);
  if (problem !== null) notify(problem, "guasto");
}

/// `folder.rename`, con ciò che gli serve intorno: i buffer in salvo prima — il
/// kernel riscrive i link entranti di ogni voce che sposta —, il progresso sulla
/// riga, e le cartelle aperte e lo spazio attivo che seguono il path nuovo.
/// Torna il perché di un rifiuto, `null` se è andata.
async function moveFolder(from: string, to: string): Promise<string | null> {
  if (to === from || moving.has(from)) return null;
  if (await ensureSaved()) return t("explorer.folder_move_failed", { folder: from, to, reason: t("explorer.folder_unsaved") });
  moving.add(from);
  markMoving(from, true);
  try {
    const outcome = await renameFolder(from, to);
    followFolder(from, to);
    notify(outcome.notify ?? t("explorer.folder_moved", { folder: from, to }), "info", undoGesture(outcome.undo !== null));
  } catch (e) {
    return t("explorer.folder_move_failed", { folder: from, to, reason: errorText(e) });
  } finally {
    moving.delete(from);
    markMoving(from, false);
  }
  const parent = parentOf(to);
  if (parent) state.expanded.add(parent);
  saveExpanded();
  await refreshFromKernel(true);
  return null;
}

/// Le cartelle aperte, le finestre dei livelli e lo spazio attivo sono stato
/// della shell scritto per path: una cartella che cambia path se li porta
/// dietro, o l'albero si richiuderebbe sotto le mani di chi l'ha spostata.
function followFolder(from: string, to: string): void {
  const moved = (path: string): string | null =>
    path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
  for (const path of [...state.expanded]) {
    const next = moved(path);
    if (next === null) continue;
    state.expanded.delete(path);
    state.expanded.add(next);
  }
  for (const [path, size] of [...levelWindows]) {
    const next = moved(path);
    if (next === null) continue;
    levelWindows.delete(path);
    levelWindows.set(next, size);
  }
  saveExpanded();
  const space = state.activeSpace === null ? null : moved(state.activeSpace);
  if (space !== null) {
    state.activeSpace = space;
    saveActiveSpace();
  }
}

/// Il gesto «Annulla» accanto all'esito di un'operazione sulle cartelle.
function undoGesture(undoable: boolean): { label: string; run: () => void } | undefined {
  if (!undoable) return undefined;
  return {
    label: t("app.undo"),
    run: () => void undoLastOperation().catch((error: unknown) =>
      notify(t("trash.undo_failed", { reason: errorText(error) }), "guasto")),
  };
}

/// Una cartella nel cestino del vault, con tutto ciò che contiene: si chiede,
/// perché sono molte voci con un gesto solo, finché `files.confirm-trash` non
/// è spenta; un'impostazione che non si legge chiede. Il cestino è quello del
/// vault anche quando `files.trash` sceglie il sistema: è da lì che
/// l'annullamento le riporta tutte insieme.
async function trashFolderWithConfirm(path: string): Promise<void> {
  const ask = await settings()
    .then((entries) => entries.find((entry) => entry.spec.key === FILES_CONFIRM_TRASH)?.value !== false)
    .catch(() => true);
  const ok = !ask || await confirm(t("explorer.folder_trash_confirm", { folder: childName(path) }), {
    title: t("explorer.folder_trash_title"),
    okLabel: t("explorer.delete"),
  }).catch(() => false);
  if (!ok) return;
  if (await ensureSaved()) return;
  try {
    const outcome = await trashFolder(path);
    notify(outcome.notify ?? t("explorer.folder_trashed", { folder: path }), "info", undoGesture(outcome.undo !== null));
  } catch (e) {
    notify(t("explorer.folder_trash_failed", { folder: path, reason: errorText(e) }), "guasto");
    return;
  }
  await refreshFromKernel(true);
}

/// **Il testo non salvato esce prima**, e se non ce la fa l'operazione non parte.
///
/// Vale per i gesti che **spostano un file**: il kernel, muovendo, riscrive
/// anche i wikilink entranti di file di terzi, e un buffer rimasto sporco li
/// ricoprirebbe col testo di prima al salvataggio successivo. Guarda ogni
/// documento appeso e non solo quello mosso, perché quelli riscritti dal kernel
/// sono gli **altri**: chi ha una battuta non salvata in una nota che cita
/// questa è precisamente chi ci rimette.
///
/// Chi legge un documento — aprirne un altro, un'azione di view — continua a
/// chiamare `flushPendingSave` e a proseguire: lì il testo non salvato resta nel
/// suo buffer, che è sporco, e il tentativo dopo riparte da lì.
async function ensureSaved(): Promise<boolean> {
  const pending = await flushPendingSave();
  if (pending.length === 0) return false;
  notify(t("document.unsaved_blocks", { doc: pending.join(", ") }), "guasto");
  return true;
}

/// `p/X.md` → `p/X/X.md`: la nota diventa la folder note di una cartella nuova
/// col suo nome. I wikilink entranti li riscrive il rename del kernel; icona e
/// pin migrano sull'evento `document_renamed`, come per ogni rename.
///
/// L'estensione non si sceglie: è quella che la nota ha già (`childName`). Prima
/// era `.md` cablata, che avrebbe cambiato formato a una nota per il solo fatto
/// di spostarla in una cartella.
async function convertToFolder(id: string): Promise<void> {
  // Sposta un file esattamente come la rinomina — è una rinomina — e prima non
  // metteva in salvo niente affatto (difetto 0206).
  if (await ensureSaved()) return;
  const stem = pageName(id);
  const dir = parentOf(id);
  const folderPath = dir ? `${dir}/${stem}` : stem;
  try {
    const outcome = await renameKeepingBuffer(id, `${folderPath}/${childName(id)}`);
    if (outcome.kind === "collision") {
      notify(t("explorer.to_folder_failed", { doc: id, reason: t("explorer.destination_open") }), "guasto");
      return;
    }
  } catch (e) {
    notify(t("explorer.to_folder_failed", { doc: id, reason: errorText(e) }), "guasto");
    return;
  }
  state.expanded.add(folderPath);
  saveExpanded();
  void refreshFromKernel(true);
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

function wireDrag(row: HTMLElement, path: string, kind: "note" | "folder", isNote = kind === "note"): void {
  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    // Una voce della scelta multipla porta con sé tutte le scelte.
    const picked = selection?.paths() ?? [];
    const group = picked.length > 1 && picked.includes(path) ? picked : [path];
    drag = { path, kind, parent: parentOf(path), group };
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

/// Che gesto sarebbe lasciar cadere qui? `before`/`after` = riordino tra
/// fratelli dello stesso tipo; `into` = nota dentro una cartella (di un'altra
/// cartella); null = niente da fare.
function dropGesture(
  row: HTMLElement,
  path: string,
  kind: "note" | "folder",
  e: DragEvent,
): "before" | "after" | "into" | null {
  if (!drag || drag.path === path) return null;
  const siblings = drag.kind === kind && drag.parent === parentOf(path);
  // Una cartella entra in un'altra, ma non in sé stessa né in una sua figlia.
  const ownSubtree = drag.group.some((each) => path === each || path.startsWith(`${each}/`));
  const inside = kind === "folder" && drag.parent !== path && !ownSubtree;
  // `offsetY` sarebbe relativo all'elemento più interno sotto il cursore (uno
  // span, magari): la frazione va calcolata sulla riga intera.
  const box = row.getBoundingClientRect();
  const y = (e.clientY - box.top) / box.height;
  if (inside && (!siblings || (y > 0.3 && y < 0.7))) return "into";
  if (siblings) return y < 0.5 ? "before" : "after";
  return null;
}

function clearDropMarks(): void {
  document
    .querySelectorAll(".drop-before, .drop-after, .drop-into")
    .forEach((el) => el.classList.remove("drop-before", "drop-after", "drop-into"));
}

/// Riscrive l'ordine scelto a mano di una cartella: la lista completa dei nomi
/// nell'ordine visibile, col trascinato nella posizione nuova.
///
/// La cartella è quella dei due fratelli che si stanno riordinando, quindi è a
/// schermo, quindi è caricata: `children` la trova senza chiedere niente.
function applyReorder(parent: string, dragged: string, target: string, before: boolean): void {
  const node = children(parent);
  if (!node) return;
  const names = orderedNames(node).filter((n) => n !== dragged);
  const at = names.indexOf(target);
  if (at === -1) return;
  names.splice(before ? at : at + 1, 0, dragged);
  void setOrder(parent, names);
}
/// Sposta una nota dentro un'altra cartella (drag "into", voce di menu o
/// tastiera): stesso rename del kernel, quindi stesso flush preventivo — un
/// buffer sporco coprirebbe la riscrittura dei wikilink — e progresso sulla
/// riga (U11) con no-op sul secondo invio.
const moving = new Set<string>();
async function moveIntoFolder(id: string, folderPath: string): Promise<void> {
  const to = folderPath ? `${folderPath}/${childName(id)}` : childName(id);
  if (to === id || moving.has(id)) return;
  if (await ensureSaved()) return;
  moving.add(id);
  markMoving(id, true);
  try {
    const outcome = await renameKeepingBuffer(id, to);
    if (outcome.kind === "collision") {
      notify(
        t("explorer.move_failed", {
          doc: id,
          folder: folderPath || t("explorer.root"),
          reason: t("explorer.destination_open"),
        }),
        "guasto",
      );
      return;
    }
  } catch (e) {
    notify(
      t("explorer.move_failed", {
        doc: id,
        folder: folderPath || t("explorer.root"),
        reason: errorText(e),
      }),
      "guasto",
    );
    return;
  } finally {
    moving.delete(id);
    markMoving(id, false);
  }
  if (folderPath) state.expanded.add(folderPath);
  saveExpanded();
  await refreshDocuments();
}

/// Progresso dello spostamento sulla riga (U11): `aria-busy` finché il rename
/// è in volo, tolto alla fine anche su errore.
function markMoving(id: string, busy: boolean): void {
  const li = entry(id);
  const row = li?.querySelector<HTMLElement>(":scope > .tree-row");
  if (busy) row?.setAttribute("aria-busy", "true");
  else {
    for (const stale of fileListEl.querySelectorAll<HTMLElement>('[aria-busy="true"]')) {
      const owner = stale.closest("li");
      if (owner instanceof HTMLElement && owner.dataset.path === id) stale.removeAttribute("aria-busy");
    }
  }
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

/// Sposta ciò che si trascina dentro una cartella: la voce presa o, se era
/// nella scelta, tutte le scelte, una alla volta e con lo stesso comando del
/// menu. Una cartella non entra in sé stessa né in una figlia: la si salta.
async function moveGroupInto(dragged: NonNullable<typeof drag>, folder: string): Promise<void> {
  for (const path of dragged.group) {
    if (path === folder || folder.startsWith(`${path}/`) || parentOf(path) === folder) continue;
    if (folderRowOf(path) || (path === dragged.path && dragged.kind === "folder")) await moveFolderInto(path, folder);
    else await moveIntoFolder(path, folder);
  }
  if (dragged.group.length > 1) selection?.clear();
}

/// La cartella che riceve un rilascio da fuori sotto `target`: la cartella
/// stessa se è la sua riga, la madre se è una nota o un file, la radice
/// visibile (vault o spazio attivo) altrimenti.
function outsideTarget(target: EventTarget | null): string {
  const row = target instanceof Element ? target.closest<HTMLElement>(".tree-row") : null;
  const path = row?.closest<HTMLElement>("li[data-path]")?.dataset.path ?? row?.dataset.path;
  if (!row || path === undefined) return state.activeSpace ?? "";
  return row.classList.contains("folder") ? path : parentOf(path);
}

/// File e cartelle del sistema lasciati cadere sull'albero o sul titolo del
/// pannello. Una cartella chiusa sotto il cursore si apre dopo una sosta, come
/// per un trascinamento interno.
function wireOutsideDrops(lifetime: Lifetime): void {
  const over = (e: DragEvent) => {
    if (drag || !carriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    const folder = e.currentTarget === filesTitleEl ? state.activeSpace ?? "" : outsideTarget(e.target);
    clearDropMarks();
    const row = folder ? folderRowOf(folder) : null;
    (row ?? filesTitleEl).classList.add("drop-into");
    if (row && !state.expanded.has(folder)) scheduleHoverOpen(folder);
  };
  const drop = async (e: DragEvent) => {
    if (drag || !carriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    cancelHoverOpen();
    clearDropMarks();
    filesTitleEl.classList.remove("drop-into");
    const folder = e.currentTarget === filesTitleEl ? state.activeSpace ?? "" : outsideTarget(e.target);
    let dropped: Dropped;
    try {
      dropped = await readDropped(e.dataTransfer!);
    } catch (error) {
      notify(t("explorer.import_failed", { reason: errorText(error) }), "guasto");
      return;
    }
    await importHere(dropped, folder);
  };
  const leave = (e: DragEvent) => {
    const into = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (into && (fileListEl.contains(into) || filesTitleEl.contains(into))) return;
    clearDropMarks();
    filesTitleEl.classList.remove("drop-into");
    cancelHoverOpen();
  };
  for (const target of [fileListEl, filesTitleEl]) {
    lifetime.listen(target, "dragover", over);
    lifetime.listen(target, "dragleave", leave);
    lifetime.listen(target, "drop", (e) => void drop(e));
  }
}

/// Il selettore dei file del sistema, per chi non trascina: «Importa file…»
/// sceglie dei file, «Importa una cartella…» una cartella intera.
function pickImport(folder: string, wholeFolder: boolean): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (wholeFolder) input.webkitdirectory = true;
  input.addEventListener("change", () => {
    if (input.files?.length) void importHere(pickedFiles(input.files), folder);
  }, { once: true });
  input.click();
}

/// Importa e racconta: quante voci sono entrate e, una per una, quelle che
/// non sono entrate col loro perché.
async function importHere(dropped: Dropped, folder: string): Promise<void> {
  if (!dropped.files.length && !dropped.folders.length) return;
  let outcome;
  try {
    outcome = await importIntoVault(dropped, folder);
  } catch (error) {
    notify(t("explorer.import_failed", { reason: errorText(error) }), "guasto");
    return;
  }
  if (folder) state.expanded.add(folder);
  saveExpanded();
  const where = folder || t("explorer.root");
  if (outcome.imported.length) {
    notify(t("explorer.imported", { count: String(outcome.imported.length), folder: where }), "info");
  }
  if (outcome.skipped.length) {
    const list = outcome.skipped.map((each) => `${each.name}: ${each.reason}`).join("; ");
    notify(t("explorer.import_skipped", { count: String(outcome.skipped.length), list }), "guasto");
  }
  await refreshFromKernel(true);
}
